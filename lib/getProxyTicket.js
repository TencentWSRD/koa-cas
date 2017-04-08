const utils = require('./utils');
const queryString = require('query-string');

/*
 * Parse proxy ticket from /proxy response
 *
 * @param body
 * @returns {string} proxy ticket
 */
function parseCasResponse(body) {
  body = body || '';
  let pt = '';
  if (/<cas:proxySuccess/.exec(body)) {
    if (/<cas:proxyTicket>(.*)<\/cas:proxyTicket>/.exec(body)) {
      pt = RegExp.$1;
    }
  }

  return pt;
}

/*
 * Get a proxy ticket from CAS server.
 *
 * @context {ConnectCas}
 * @param req
 * @param {Object}   proxyOptions
 * @param {String}   proxyOptions.targetService   (Required)
 * @param {Boolean}  proxyOptions.disableCache    Whether to force disable cache and to request a new one.
 * @param {Boolean}  proxyOptions.renew           Don't use cache, request a new one, reset it to cache
 * @param {String}   proxyOptions.specialPgt
 * @param {Function} proxyOptions.retryHandler
 * @param callback
 * @returns {*}
 */
module.exports = function* (ctx, proxyOptions) {
  const req = ctx.request;
  const logger = utils.getLogger(req, this.options);

  const options = this.options;
  const ptStore = this.ptStore;

  const disableCache = proxyOptions.disableCache;
  const targetService = proxyOptions.targetService;
  const specialPgt = proxyOptions.specialPgt;
  const retryHandler = proxyOptions.retryHandler;
  const renew = proxyOptions.renew;

  if (!targetService) {
    throw new Error(`Unexpected targetService of ${targetService}, a String is expired.`);
  }

  if (specialPgt) {
    logger.info('specialPgt is set, use specialPgt: ', specialPgt);
  }

  const pgt = specialPgt || (ctx.session && ctx.session.cas && ctx.session.cas.pgt);

  if (!pgt) {
    throw new Error(`Unexpected pgt of ${pgt}, a String is expired.`);
  }


  const params = {};
  params.targetService = targetService;
  params.pgt = pgt;

  const proxyPath = `${utils.getPath('proxy', options)}?${queryString.stringify(params)}`;

  const isMatchFilter = (options.cache && options.cache.filter && typeof options.cache.filter.some === 'function') ? options.cache.filter.some(function(rule) {
    return utils.isMatchRule(req, targetService, rule);
  }) : false;

  if (options.cache.filter && typeof options.cache.filter.some !== 'function') {
    logger.warn('options.cache.filter is set, but it is not an function! Will be ignore directly.');
  }

  if (isMatchFilter) {
    logger.info('Matched filer rules, ignore cache');
  }

  // Decide whether to use cached proxy ticket
  if (disableCache || !options.cache.enable || isMatchFilter || renew) {
    // Not to use cache
    logger.info(disableCache ? 'Enforce request pt, ignore cache' : 'renew is true, refetch a new pt');
    try {
      const pt = yield requestPT(proxyPath);
      if (renew) {
        logger.info(`Refetch a new pt succeed, pt: ${pt}. Try store it in cache.`);
        yield ptStore.set(ctx, targetService, pt);
      }
      return pt;
    } catch (err) {
      logger.error(`Error happened when sending request to: ${proxyPath}`);
      logger.error(err);
      throw err;
    }
  }

  logger.info('Using cached pt, trying to find cached pt for service: ', targetService);
  // Use cache
  try {
    let pt = yield ptStore.get(ctx, targetService);
    if (pt) {
      logger.info('Find cached pt succeed, ', pt);
      return pt;
    }

    logger.info('Can not find cached pt, trying to request a new one again.');
    // Can not find pt from pt, request a new one
    try {
      pt = yield requestPT(proxyPath, retryHandler);
      logger.info('Request for a pt succeed, trying to store them to cache.');
      yield ptStore.set(ctx, targetService, pt);
      return pt;
    } catch (err) {
      logger.error(`Error happened when sending request to: ${proxyPath}`);
      logger.error(err);
      throw err;
    }
  } catch (err) {
    /* istanbul ignore if */
    logger.error('Error when trying to find cached pt.');
    logger.error(err);
    throw err;
  }

  /*
   * Request a proxy ticket
   * @param req
   * @param path
   * @param callback
   * @param {Function} retryHandler If this callback is set, it will be called only if request failed due to authentication issue.
   */
  function* requestPT(path, retryHandler) {
    logger.info('Trying to request proxy ticket from ', proxyPath);
    const startTime = Date.now();
    try {
      const response = yield utils.getRequest(path);
      logger.access(`|GET|${path}|${response.status}|${Date.now() - startTime}`);
      if (response.status !== 200) {
        logger.error('Request fail when trying to get proxy ticket', response);
        throw new Error(`Request fail when trying to get proxy ticket, response status: ${response.status
          }, response body: ${response.body}`);
      }

      const pt = parseCasResponse(response.body);

      if (pt) {
        logger.info('Request proxy ticket succeed, receive pt: ', pt);
        return pt;
      } else {
        logger.error('Can\' get pt from get proxy ticket response.');
        logger.error('Request for PT succeed, but response is invalid, response: ', response.body);
        if (typeof retryHandler === 'function') {
          return yield retryHandler(new Error(`Request for PT succeed, but response is invalid, response: ${response.body}`));
        }
        throw new Error(`Request for PT succeed, but the response from CAS service is invalid, response: ${response.body}`);
      }
    } catch (err) {
      /* istanbul ignore if */
      logger.access(`|GET|${path}|500|${Date.now() - startTime}`);
      logger.error(`Error happened when sending request to: ${path}`);
      logger.error(err);
      if (typeof retryHandler === 'function') return yield retryHandler(err);
      throw err;
    }
  }
};

module.exports.parseProxyTicketResponse = parseCasResponse;
