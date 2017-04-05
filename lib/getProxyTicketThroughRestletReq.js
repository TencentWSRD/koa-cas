var globalPGTStore = require('./globalStoreCache');
var getProxyTickets = require('./getProxyTicket');
var utils = require('./utils');
var url = require('url');

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
function getProxyTicketThroughRestletReq(req, targetService, restletOptions, callback) {
  var options = this.options;
  var that = this;
  var logger = utils.getLogger(req, options);
  var restletIntegrateRuleKey = restletOptions.name;
  var doNotRetry = restletOptions.doNotRetry;
  var restletParams = restletOptions.params;
  var isUsingCache = restletOptions.cache;

  var pgt = isUsingCache ? globalPGTStore.get(restletIntegrateRuleKey) : null;

  function retryHandler(err) {
    if (doNotRetry === true) {
      logger.info('Use cached pgt request failed, but doNotRetry set to true, use original callback with err', err);
      return callback(err);
    }
    logger.info('Use cached pgt request failed, maybe expired, retry once.');

    globalPGTStore.remove(restletIntegrateRuleKey);

    // Set doNotRetry=true, retry once, no more.
    getProxyTicketThroughRestletReq.call(that, req, targetService, {
      name: restletIntegrateRuleKey,
      params: restletParams,
      doNotRetry: true
    }, callback);
  }

  if (pgt) {
    logger.info('Find PGT for ' + restletIntegrateRuleKey + ' succeed from cache, PGT: ', pgt);
    // Don't use cache for a restlet PT, because they are special and will effect the normal PT by a logined user.
    return getProxyTickets.call(that, req, {
      targetService: targetService,
      specialPgt: pgt,
      disableCache: true,
      retryHandler: retryHandler
    }, callback);
  } else {
    var path = utils.getPath('restletIntegration', options);
    var startTime = Date.now();
    logger.info('Send request to ' + path + ' to get PGT.');
    utils.postRequest(path, restletParams, function (err, response) {
      logger.access('|POST|' + path + '|' + (err ? 500 : response.status) + "|" + (Date.now() - startTime));
      if (err) {
        logger.error('Request to get PGT through restletIntegration failed.');
        logger.error(err.message);
        return callback(err);
      }

      if (!response) {
        logger.error('Receive empty response from restletIntegration from CAS server');
        return callback(new Error('Receive empty response from restletIntegration from CAS server'));
      }

      if (response.status === 200 || response.status === 201) {
        logger.info('Request to get PGT through restlet integration succeed, status: ' + response.status);
        pgt = parseResponse(response.body);

        if (pgt) {
          logger.info('Parse pgtId from response succeed, pgt: ', pgt);
          globalPGTStore.set(restletIntegrateRuleKey, pgt);

          logger.info('Trying to get PT using restletIntegration PGT.');
          // Don't use cache for a restlet PT, because they are special and will effect the normal PT by a logined user.
          return getProxyTickets.call(that, req, {
            targetService: targetService,
            specialPgt: pgt,
            disableCache: true,
            retryHandler: retryHandler
          }, callback);
        } else {
          logger.info('Parse pgt from response failed!, response: ', response);
          return callback(new Error('Not a valid response from CAS Server!'));
        }
      } else {
        logger.error('Request for PT from restletIntegration failed!');
        logger.info(response);
        return callback(new Error('Request for TGT from restletIntegration failed!'));
      }
    });
  }
}

/**
 * 解析出pgt
 * @param body
 * @return {String} pgtId
 */
function parseResponse(body) {
  var pgt = '';
  var result = body.match(/action="([\s\S]*?)"/);
  if (result) {
    result = result[1];

    var uri = url.parse(result, true);
    var pathname = uri.pathname;

    pgt = pathname.substr(pathname.lastIndexOf('/') + 1);
  }

  return pgt;
}

module.exports = getProxyTicketThroughRestletReq;
