const utils = require('./utils');

/**
 * Handle single-signed off request from CAS server
 *
 * @param ctx
 * @param afterHook
 * @param options
 */
module.exports = function* (ctx, afterHook, options) {
  const logger = utils.getLogger(ctx.request, options);

    /* istanbul ignore if */
  if (!ctx.sessionStore) {
    const error = new Error('req.sessionStore is not defined, maybe you havn\'t initialize cookie session.');
    logger.error(error.stack);
    yield afterHook();
    return ctx.status(500).send({
      message: error.message,
    });
  }

  logger.info('Receive slo request... Trying to logout.');
  const body = yield new Promise((resolve, reject) => {
    let _body = '';
    ctx.request.on('data', function(chunk) {
      _body += chunk;
    });

    ctx.request.on('end', function() {
      resolve(_body);
    });
    ctx.request.on('error', (err) => reject(err));
  });

  if (!/<samlp:SessionIndex>(.*)<\/samlp:SessionIndex>/.exec(body)) {
    logger.info('Slo request receive, but body content is not valid');
      // 响应已经end了, 没next了
    yield afterHook();
    return ctx.sendStatus(202);
  }
  const st = RegExp.$1;
  try {
    const result = yield ctx.sessionStore.get(st);
      /* istanbul ignore else */
    if (result && result.sid) {
      logger.info('Find sid by st succeed, trying to destroy it.', 'st: ', st, 'sessionId: ', result.sid);
      try {
        yield ctx.sessionStore.destroy(result.sid);
        yield ctx.sessionStore.destroy(st);
        yield afterHook();
        return ctx.sendStatus(200);
      } catch (err) {
        logger.error(`Error when destroy session for id: ${result.sid}`);
        logger.error(err);
        yield afterHook();
        return ctx.sendStatus(202);
      }
    } else {
      logger.info('Can not find sid by st, result: ', result);
      try {
        yield ctx.sessionStore.destroy(st);
        yield afterHook();
        return ctx.sendStatus(200);
      } catch (err) {
        logger.error('Error when destroy st in session store. st: ', st);
        logger.error(err);
        yield afterHook();
        return ctx.sendStatus(202);
      }
    }
  } catch (err) {
    logger.error('Trying to ssoff, but get st from session failed!');
    logger.error(err);
    yield afterHook();
    return ctx.sendStatus(202);
  }
};
