const utils = require('./utils');

/*
 * Handle single-signed off request from CAS server
 *
 * @param ctx
 * @param afterHook
 * @param options
 */
module.exports = function* (ctx, afterHook, options) {
  const logger = utils.getLogger(ctx, options);

    /* istanbul ignore if */
  if (!ctx.sessionStore) {
    const error = new Error('req.sessionStore is not defined, maybe you havn\'t initialize cookie session.');
    logger.error(error.stack);
    yield afterHook();
    ctx.status = 500;
    ctx.body = {
      message: error.message,
    };
    return;
  }

  const body = yield new Promise((resolve, reject) => {
    let _body = '';
    ctx.req.on('data', (chunk) => {
      _body += chunk;
    });
    ctx.req.on('end', () => {
      resolve(_body);
    });
    ctx.req.on('error', (err) => reject(err));
  });

  logger.info('Receive slo request... Trying to logout. body=', body);

  if (!/<samlp:SessionIndex>(.*)<\/samlp:SessionIndex>/.exec(body)) {
    logger.info('Slo request receive, but body content is not valid');
      // 响应已经end了, 没next了
    yield afterHook();
    ctx.status = 202;
    return;
  }
  const st = RegExp.$1;
  try {
    logger.info('Slo body parse st: ', st);
    const result = yield ctx.sessionStore.get(st);
      /* istanbul ignore else */
    if (result && result.sid) {
      logger.info('Find sid by st succeed, trying to destroy it.', 'st: ', st, 'sessionId: ', result.sid);
      try {
        yield ctx.sessionStore.destroy(result.sid);
        yield ctx.sessionStore.destroy(st);
        yield afterHook();
        ctx.status = 200;
        return;
      } catch (err) {
        logger.error(`Error when destroy session for id: ${result.sid}`);
        logger.error(err);
        yield afterHook();
        ctx.status = 202;
        return;
      }
    } else {
      logger.info('Can not find sid by st, result: ', result);
      try {
        yield ctx.sessionStore.destroy(st);
        yield afterHook();
        ctx.status = 200;
        return;
      } catch (err) {
        logger.error('Error when destroy st in session store. st: ', st);
        logger.error(err);
        yield afterHook();
        ctx.status = 202;
        return;
      }
    }
  } catch (err) {
    logger.error('Trying to ssoff, but get st from session failed!');
    logger.error(err);
    yield afterHook();
    ctx.status = 202;
    return;
  }
};
