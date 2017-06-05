const queryString = require('query-string');
const xml2js = require('xml2js').parseString;
const stripPrefix = require('xml2js/lib/processors').stripPrefix;
const utils = require('./utils');
const is = require('is-type-of');

const REG_TICKET = /^ST-[\w\d_\-.]+$/;

/*
 * Validate ticket from CAS server
 *
 * @param ctx
 * @param options
 */
function* validateTicket(ctx, options) {
  const logger = utils.getLogger(ctx, options);
  const query = {
    service: utils.getPath('service', options),
    ticket: ctx.query.ticket,
  };
  if (options.paths.proxyCallback) query.pgtUrl = utils.getPath('pgtUrl', options);
  const serviceValidateUrl = `${utils.getPath('serviceValidate', options)}?${queryString.stringify(query)}`;
  logger.info(`Sending request to serviceValidateUrl "${serviceValidateUrl}" to validate ticket.`);

  const startTime = Date.now();
  try {
    const response = yield utils.getRequest(serviceValidateUrl);
    logger.access(`|GET|${serviceValidateUrl}|${response.status}|${Date.now() - startTime}`);
    return response;
  } catch (err) {
    /* istanbul ignore if */
    logger.access(`|GET|${serviceValidateUrl}|500|${Date.now() - startTime}`);
    logger.error('Error when sending request to CAS server, error: ', err.toString());
    logger.error(err);
    throw err;
  }
}

/*
 * 从cas的响应的xml中解析出数据
 *
 * @param casBody
 * @param logger
 * @param callback
 */
function parseCasResponse(casBody, logger) {
  return new Promise((resolve, reject) => {
    xml2js(casBody, {
      explicitRoot: false,
      tagNameProcessors: [ stripPrefix ],
    }, function(err, serviceResponse) {
      /* istanbul ignore if */
      if (err) {
        logger.error('Failed to parse CAS server response when trying to validate ticket.');
        logger.error(err);
        return reject(new Error('Failed to parse CAS server response when trying to validate ticket.'));
      } else if (!serviceResponse) {
        logger.error('Invalid CAS server response.');
        return reject(new Error('Invalid CAS server response, serviceResponse empty.'));
      } else {
        const success = serviceResponse.authenticationSuccess && serviceResponse.authenticationSuccess[0];

        if (!success) {
          logger.error('Receive response from CAS when validating ticket, but the validation is failed.');
          logger.error('Cas response:', serviceResponse);
          return resolve({});
        }

        const casResponse = {};
        for (const casProperty in success) {
          casResponse[casProperty] = success[casProperty][0];
        }

        return resolve(casResponse);
      }
    });
  });
}

/*
 * Find PGT by PGTIOU
 *
 * @param ctx
 * @param afterHook
 * @param pgtIou
 * @param options
 */
function* retrievePGTFromPGTIOU(ctx, afterHook, pgtIou, options) {
  const logger = utils.getLogger(ctx, options);
  logger.info('Trying to retrieve pgtId from pgtIou...');
  try {
    const session = yield ctx.sessionStore.get(pgtIou);
    if (session && session.pgtId) {
      let lastUrl = utils.getLastUrl(ctx, options, logger);

      if (!ctx.session || (ctx.session && !ctx.session.cas)) {
        logger.error('Here session.cas should not be empty!', ctx.session);
        ctx.session.cas = {};
      }

      ctx.session.cas.pgt = session.pgtId;
      try {
        // 释放
        yield ctx.sessionStore.destroy(pgtIou);
        lastUrl = getLastUrl(ctx, options, logger, lastUrl);
        logger.info(`CAS proxy mode login and validation succeed, pgtId finded. Redirecting to lastUrl: ${lastUrl}`);
        yield afterHook();
        return ctx.redirect(lastUrl);
      } catch (err) {
        logger.error('Trying to save session failed!');
        logger.error(err);
        yield afterHook();
        ctx.status = 500;
        ctx.body = {
          message: 'Trying to save session failed!',
          error: err,
        };
        return;
      }
    } else {
      logger.error(`CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou: \`${pgtIou}\`, maybe something wrong with sessionStroe!`);
      yield afterHook();
      ctx.status = 401;
      ctx.body = {
        message: `CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou, maybe something wrong with sessionStroe!`,
      };
      return;
    }
  } catch (err) {
    logger.error('Get pgtId from sessionStore failed!');
    logger.error(err);
    yield ctx.sessionStore.destroy(pgtIou);
    yield afterHook();
    ctx.status = 500;
    ctx.body = {
      message: 'Get pgtId from sessionStore failed!',
      error: err,
    };
    return;
  }
}

function getLastUrl(ctx, options, logger, lastUrl) {
  if (is.function(options.redirect)) {
    let customRedirectUrl;
    if ((customRedirectUrl = options.redirect(ctx)) && typeof customRedirectUrl === 'string') {
      logger.info('Specific options.redirect matched, redirect to customize location: ', customRedirectUrl);
      return customRedirectUrl;
    }
  }

  return lastUrl;
}


/*
 * Validate a ticket from CAS server
 *
 * @param ctx
 * @param afterHook
 * @param options
 */
module.exports = function* validate(ctx, afterHook, options) {
  // check ticket first
  const session = ctx.session;
  const ticket = (ctx.query && ctx.query.ticket) || null;
  let lastUrl = utils.getLastUrl(ctx, options);
  const logger = utils.getLogger(ctx, options);

  logger.info('Start validating ticket...');
  if (!ticket) {
    logger.warn(`Can\' find ticket in query, redirect to last url: ${lastUrl}`);
    yield afterHook();
    return ctx.redirect(lastUrl);
  }

  if (!ticket.match(REG_TICKET)) {
    logger.warn(`Ticket '${ticket}' is invalid, validate failed!`);
    yield afterHook();
    ctx.status = 400;
    ctx.body = `Ticket is invalid, validate failed!`;
    return;
  }

  logger.info('Found ticket in query', ticket);
  if (session && session.cas && session.cas.st && session.cas.st === ticket) {
    logger.info(`Ticket in query is equal to the one in session, go last url: ${lastUrl}`);
    yield afterHook();
    return ctx.redirect(lastUrl);
  }
  try {
    const response = yield validateTicket(ctx, options);
    logger.info(`Response service validate from CAS server, status: ${response.status}`);
    if (response.status !== 200) {
      logger.error(`Receive response from cas when validating ticket, but request failed with status code: ${response.status}!`);
      yield afterHook();
      ctx.status = 401;
      ctx.body = {
        message: `Receive response from cas when validating ticket, but request failed with status code: ${response.status}.`,
      };
      return;
    }
    try {
      const info = yield parseCasResponse(response.body, logger);
      if (!info || (info && !info.user)) {
        yield afterHook();
        ctx.status = 401;
        ctx.body = {
          message: 'Receive response from CAS when validating ticket, but the validation is failed.',
        };
        return;
      }

      const pgtIou = info.proxyGrantingTicket;
      delete info.proxyGrantingTicket;
      ctx.session.cas = info;
      ctx.session.cas.st = ticket;
      if (options.slo) {
        try {
          yield ctx.sessionStore.set(ticket, {
            sid: ctx.sessionId,
            cookie: ctx.session.cookie,
          });
        } catch (err) {
          /* istanbul ignore if */
          logger.info('Trying to store ticket in sessionStore for ssoff failed!');
          logger.error(err);
        }
      }

      if (pgtIou) {
        return yield retrievePGTFromPGTIOU(ctx, afterHook, pgtIou, options);
      } else if (options.paths.proxyCallback) {
        logger.error('pgtUrl is specific, but havn\'t find pgtIou from CAS validation response! Response status 401. cas server response: ', response.body);
        yield afterHook();
        ctx.status = 401;
        ctx.body = {
          message: 'pgtUrl is specific, but havn\'t find pgtIou from CAS validation response!',
        };
        return;
      } else {
        lastUrl = getLastUrl(ctx, options, logger, lastUrl);
        logger.info(`None-proxy mode, validate ticket succeed, redirecting to lastUrl: ${lastUrl}`);
        yield afterHook();
        return ctx.redirect(lastUrl);
      }
    } catch (err) {
      const resBody = {
        error: err,
        message: err.message,
      };
      yield afterHook();
      ctx.status = 500;
      ctx.body = resBody;
      return;
    }
  } catch (err) {
    yield afterHook();
    ctx.status = 500;
    ctx.body = {
      message: 'Receive response from cas when validating ticket, but request failed because an error happened.',
      error: err.message,
    };
  }
};


module.exports.parseCasResponse = parseCasResponse;
