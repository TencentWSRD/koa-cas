const utils = require('./utils');

/*
 * 权限判断
 * @param ctx
 * @param afterHook
 * @param options
 * @returns {*}
 */
module.exports = function* (ctx, afterHook, next, options) {
  const logger = utils.getLogger(ctx.request, options);
  logger.info('Doing authenticating...');
  if (ctx.session && ctx.session.cas && ctx.session.cas.st) {
    logger.info('Find st in session');
    if ((options.paths.proxyCallback && ctx.session.cas.pgt) || !options.paths.proxyCallback) {
      if (!options.paths.proxyCallback) logger.info('Non-proxy mode, go next()');
      if (options.paths.proxyCallback && ctx.session.cas.pgt) logger.info('Proxy-mode, pgt is valid.');
      yield afterHook();
      yield next;
      logger.debug('after hook');
    } else if (options.paths.proxyCallback && !ctx.session.cas.pgt) {
      logger.error('Using proxy-mode CAS, but pgtId is not found in session.');
    }
  } else {
    logger.info('Can not find st in session: ', ctx.session);
  }

  ctx.session.lastUrl = utils.getOrigin(ctx.request, options);
  const params = {};
  params.service = utils.getPath('service', options);

  // TODO: renew & gateway is not implement yet
  // if (options.renew === true) {
  //   params.renew = true;
  // } else if (options.gateway === true) {
  //   params.gateway = true;
  // }

  if (options.fromAjax && options.fromAjax.header && ctx.get(options.fromAjax.header)) {
    logger.info(`Need to redirect, but matched AJAX request, send ${options.fromAjax.status}`);
    yield afterHook();
    return ctx.status(options.fromAjax.status).send({
      message: 'Login status expired, need refresh path',
    });
  }

  let loginPath;
  if (options.paths.login && typeof options.paths.login === 'function') {
    logger.info('use function manner for custom config');
    loginPath = options.paths.login(ctx.request, logger);
  } else {
    logger.info('use default manner');
    loginPath = utils.getPath('login', options);
  }
  loginPath += `&sn=${ctx.request.sn}`;
  logger.info('redirect to login page ', loginPath);
  yield afterHook();
  return ctx.redirect(302, loginPath);
};
