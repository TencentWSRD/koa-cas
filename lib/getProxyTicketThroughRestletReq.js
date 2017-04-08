const globalPGTStore = require('./globalStoreCache');
const getProxyTicket = require('./getProxyTicket');
const utils = require('./utils');
const url = require('url');

/**
 *
 * @param req
 * @param targetService
 * @param {Object}  restletOptions            (Required)
 * @param {String}  restletOptions.name       (Required)
 * @param {Object}  restletOptions.params     (Required)
 * @param {Boolean} restletOptions.doNotRetry (Optional)
 * @param callback
 */
// restletIntegrateRuleKey, restletIntegrateOption, doNotRetry
function* getProxyTicketThroughRestletReq(ctx, targetService, restletOptions) {
  const options = this.options;
  const that = this;
  const logger = utils.getLogger(ctx.request, options);
  const restletIntegrateRuleKey = restletOptions.name;
  const doNotRetry = restletOptions.doNotRetry;
  const restletParams = restletOptions.params;
  const isUsingCache = restletOptions.cache;

  let pgt = isUsingCache ? globalPGTStore.get(restletIntegrateRuleKey) : null;

  function* retryHandler(err) {
    if (doNotRetry === true) {
      logger.info('Use cached pgt request failed, but doNotRetry set to true, use original callback with err', err);
      throw err;
    }
    logger.info('Use cached pgt request failed, maybe expired, retry once.');
    globalPGTStore.remove(restletIntegrateRuleKey);
    // Set doNotRetry=true, retry once, no more.
    yield getProxyTicketThroughRestletReq.call(that, ctx, targetService, {
      name: restletIntegrateRuleKey,
      params: restletParams,
      doNotRetry: true,
    });
  }
  if (pgt) {
    logger.info(`Find PGT for ${restletIntegrateRuleKey} succeed from cache, PGT: `, pgt);
    // Don't use cache for a restlet PT, because they are special and will effect the normal PT by a logined user.
    return yield getProxyTicket.call(that, ctx, {
      targetService,
      specialPgt: pgt,
      disableCache: true,
      retryHandler,
    });
  }

  const path = utils.getPath('restletIntegration', options);
  const startTime = Date.now();
  logger.info(`Send post request to ${path} to get PGT.`);
  let response = null;
  try {
    response = yield utils.postRequest(path, restletParams);
    logger.access(`|POST|${path}|${response.status}|${Date.now() - startTime}`);
  } catch (err) {
    logger.access(`|POST|${path}|500|${Date.now() - startTime}`);
    logger.error('Request to get PGT through restletIntegration failed.');
    logger.error(err.message);
    throw err;
  }

  if (!response) {
    logger.error('Receive empty response from restletIntegration from CAS server');
    throw new Error('Receive empty response from restletIntegration from CAS server');
  }

  if (response.status !== 200 && response.status !== 201) {
    logger.error('Request for PT from restletIntegration failed!');
    logger.info(response);
    throw new Error('Request for TGT from restletIntegration failed!');
  }

  logger.info(`Request to get PGT through restlet integration succeed, status: ${response.status}`);
  pgt = parseResponse(response.body);

  if (!pgt) {
    logger.info('Parse pgt from response failed!, response: ', response);
    throw new Error('Not a valid response from CAS Server!');
  }

  logger.info('Parse pgtId from response succeed, pgt: ', pgt);
  globalPGTStore.set(restletIntegrateRuleKey, pgt);

  logger.info('Trying to get PT using restletIntegration PGT.');
  // Don't use cache for a restlet PT, because they are special and will effect the normal PT by a logined user.
  return yield getProxyTicket.call(that, ctx, {
    targetService,
    specialPgt: pgt,
    disableCache: true,
    retryHandler,
  });
}

/*
 * 解析出pgt
 * @param body
 * @return {String} pgtId
 */
function parseResponse(body) {
  let pgt = '';
  let result = body.match(/action="([\s\S]*?)"/);
  if (result) {
    result = result[1];

    const uri = url.parse(result, true);
    const pathname = uri.pathname;

    pgt = pathname.substr(pathname.lastIndexOf('/') + 1);
  }

  return pgt;
}

module.exports = getProxyTicketThroughRestletReq;
module.exports.parseRestletResponse = parseResponse;
