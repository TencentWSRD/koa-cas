const utils = require('./utils');

/*
 * Receive callback from CAS server, receiving PGTIOU and PGTID from this request, store them somewhere in sessionStore.
 *
 * @param ctx
 * @param options
 */
module.exports = function* proxyCallback(ctx, afterHook, options) {
  const logger = utils.getLogger(ctx, options);
  logger.info('Receiving proxyCallback request from CAS server..., path=', ctx.path, ', query=', ctx.query);

  if (!ctx.query || !ctx.query.pgtIou || !ctx.query.pgtId) {
    logger.warn(`Receiving pgtIou from CAS server, but with unexpected pgtIou: ${ctx.query.pgtIou} or pgtId: ${ctx.query.pgtId}`);
    yield afterHook();
    ctx.status = 200;
    return;
  }

  // TODO: PGTIOU -> PGTID should expire quick
  // _.extend(ctx.session, {
  //   pgtId: ctx.query.pgtId
  // })
  try {
    yield ctx.sessionStore.set(ctx.query.pgtIou, {
      pgtId: ctx.query.pgtId,
      cookie: ctx.session.cookie,
    });
    logger.info('Receive and store pgtIou together with pgtId succeed!');
    yield afterHook();
    ctx.status = 200;
    return;
  } catch (err) {
    logger.error('Error happened when trying to store pgtIou in sessionStore.');
    logger.error(err);

    yield afterHook();
    ctx.status = 500;
    ctx.body = {
      message: 'Error happened when trying to store pgtIou in sessionStore.',
      error: err,
    };
  }
};
