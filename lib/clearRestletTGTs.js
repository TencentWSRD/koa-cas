const globalStore = require('./globalStoreCache');
const utils = require('./utils');

module.exports = function *clearRestletTGTs(options, logger) {
  logger.info('Start to clear restlet tgts');
  const tgts = globalStore.getAll();
  const deleteTgtPath = utils.getPath('restletIntegration', options);


  for (const i in tgts) {
    const tgtPath = `${deleteTgtPath}/${tgts[i]}`;
    try {
      const response = yield execQueue(tgtPath);
      if (!response) {
        globalStore.clear();
        return;
      }
    } catch (err) {
      logger.warn('Request to delete TGT failed!');
      logger.error(err);
    }
  }


  function* execQueue(path) {
    if (!path) return null;
    const startTime = Date.now();
    try {
      const response = yield utils.deleteRequest(path);
      logger.access(`|DELETE|${path}|${response.status}|${Date.now() - startTime}`);
      return response;
    } catch (err) {
      logger.access(`|DELETE|${path}|500|${Date.now() - startTime}`);
      throw err;
    }
  }
};

