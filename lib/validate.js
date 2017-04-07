const queryString = require('query-string');
const xml2js = require('xml2js').parseString;
const stripPrefix = require('xml2js/lib/processors').stripPrefix;
const utils = require('./utils');
const is = require('is-type-of');

/*
 * Validate ticket from CAS server
 *
 * @param req
 * @param options
 */
function* validateTicket(req, options) {
  const logger = utils.getLogger(req, options);
  const query = {
    service: utils.getPath('service', options),
    ticket: req.query.ticket,
  };
  if (options.paths.proxyCallback) query.pgtUrl = utils.getPath('pgtUrl', options);
  const casServerValidPath = `${utils.getPath('serviceValidate', options)}?${queryString.stringify(query)}`;
  logger.info(`Sending request to: "${casServerValidPath}" to validate ticket.`);

  const startTime = Date.now();
  try {
    const response = yield utils.getRequest(casServerValidPath);
    logger.access(`|GET|${casServerValidPath}|${response.status}|${Date.now() - startTime}`);
    return response;
  } catch (err) {
    /* istanbul ignore if */
    logger.access(`|GET|${casServerValidPath}|500|${Date.now() - startTime}`);
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
  console.log('casBody: ', casBody);
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
  const req = ctx.request;
  const logger = utils.getLogger(req, options);
  logger.info('Trying to retrieve pgtId from pgtIou...');
  try {
    const session = yield ctx.sessionStore.get(pgtIou);
    if (session && session.pgtId) {
      let lastUrl = utils.getLastUrl(req, options, logger);

      if (!req.session || req.session && !req.session.cas) {
        logger.error('Here session.cas should not be empty!', req.session);
        req.session.cas = {};
      }

      req.session.cas.pgt = session.pgtId;
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
        return ctx.status(500).send({
          message: 'Trying to save session failed!',
          error: err,
        });
      }
    } else {
      logger.error(`CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou: \`${pgtIou}\`, maybe something wrong with sessionStroe!`);
      yield afterHook();
      return ctx.status(401).send({
        message: `CAS proxy mode login and validation succeed, but can\' find pgtId from pgtIou: \`${pgtIou}\`, maybe something wrong with sessionStroe!`,
      });
    }
  } catch (err) {
    logger.error('Get pgtId from sessionStore failed!');
    logger.error(err);
    yield ctx.sessionStore.destroy(pgtIou);
    yield afterHook();
    return ctx.status(500).send({
      message: 'Get pgtId from sessionStore failed!',
      error: err,
    });
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
  const req = ctx.request;
  const session = req.session;
  const ticket = req.query && req.query.ticket || null;
  let lastUrl = utils.getLastUrl(req, options);
  const logger = utils.getLogger(req, options);

  logger.info('Start validating ticket...');
  if (!ticket) {
    logger.info(`Can\' find ticket in query, redirect to last url: ${lastUrl}`);
    yield afterHook();
    return ctx.redirect(lastUrl);
  }

  logger.info('Found ticket in query', ticket);
  if (session && session.cas && session.cas.st && session.cas.st === ticket) {
    logger.info(`Ticket in query is equal to the one in session, go last url: ${lastUrl}`);
    yield afterHook();
    return ctx.redirect(lastUrl);
  }
  try {
    const response = validateTicket(req, options);
    logger.info(`Receive from CAS server, status: ${response.status}`);
    if (response.status !== 200) {
      logger.error(`Receive response from cas when validating ticket, but request failed with status code: ${response.status}!`);
      yield afterHook();
      return ctx.status(401).send({
        message: `Receive response from cas when validating ticket, but request failed with status code: ${response.status}.`,
      });
    }
    try {
      const info = yield parseCasResponse(response.body, logger);
      if (!info || (info && !info.user)) {
        yield afterHook();
        return ctx.status(401).send({
          message: 'Receive response from CAS when validating ticket, but the validation is failed.',
        });
      }

      const pgtIou = info.proxyGrantingTicket;
      delete info.proxyGrantingTicket;
      req.session.cas = info;
      req.session.cas.st = ticket;

      if (options.slo) {
        try {
          yield ctx.sessionStore.set(ticket, {
            sid: req.session.id,
            cookie: req.session.cookie,
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
        logger.error('pgtUrl is specific, but havn\'t find pgtIou from CAS validation response! Response status 401.');
        yield afterHook();
        return ctx.status(401).send({
          message: 'pgtUrl is specific, but havn\'t find pgtIou from CAS validation response!',
        });
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
      return ctx.status(500).send(resBody);
    }
  } catch (err) {
    yield afterHook();
    return ctx.status(500).send({
      message: 'Receive response from cas when validating ticket, but request failed because an error happened.',
      error: err.message,
    });
  }
};


module.exports.parseCasResponse = parseCasResponse;
