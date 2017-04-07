const utils = require('./utils');

/*
 * Receive callback from CAS server, receiving PGTIOU and PGTID from this request, store them somewhere in sessionStore.
 *
 * @param req
 * @param options
 */
module.exports = function* proxyCallback(ctx, afterHook, options) {
  const req = ctx.request;
  const logger = utils.getLogger(req, options);
  logger.info('Receiving pgtIou from CAS server...');
  logger.info('req.path: ', req.path, ', req.query: ', req.query);

  if (!req.query || !req.query.pgtIou || !req.query.pgtId) {
    logger.warn(`Receiving pgtIou from CAS server, but with unexpected pgtIou: ${req.query.pgtIou} or pgtId: ${req.query.pgtId}`);
    yield afterHook();
    return ctx.sendStatus(200);
  }

  // TODO: PGTIOU -> PGTID should expire quick
  // _.extend(req.session, {
  //   pgtId: req.query.pgtId
  // })
  try {
    yield req.sessionStore.set(req.query.pgtIou, {
      pgtId: req.query.pgtId,
      cookie: req.session.cookie,
    });
    logger.info('Receive and store pgtIou together with pgtId succeed!');
    yield afterHook();
    return ctx.sendStatus(200);
  } catch (err) {
    logger.error('Error happened when trying to store pgtIou in sessionStore.');
    logger.error(err);

    yield afterHook();
    return ctx.status(500).send({
      message: 'Error happened when trying to store pgtIou in sessionStore.',
      error: err,
    });
  }
};
