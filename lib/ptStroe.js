const _ = require('lodash');
const utils = require('./utils');
const co = require('co');

const VALUE = 'v';
const UPDATE_TIME = 't';

const DEFAULT_OPTIONS = {
  ttl: 5 * 60 * 1000, // In millisecond
};

/*
 *
 * @param options
 * @param {Number}   options.ttl    缓存时间
 * @param {Function} options.logger (Optional)
 * @constructor
 */
function PTStore(options) {
  this.options = _.merge(DEFAULT_OPTIONS, options);
}

PTStore.prototype.set = function(ctx, key, value) {
  const logger = utils.getLogger(ctx, this.options);
  if (!ctx.session.ptStorage) ctx.session.ptStorage = {};

  return co(function* () {
    try {
      // If this key exist, overwrite directly
      ctx.session.ptStorage[key] = {};
      ctx.session.ptStorage[key][VALUE] = value;
      ctx.session.ptStorage[key][UPDATE_TIME] = Date.now();
      logger.info(`Store pt for cache succeed, service: ${key}, pt: ${value}`);
      return value;
    } catch (err) {
      logger.error('Error when trying to cache pt in session.');
      logger.error(err);
      throw err;
    }
  });
};

PTStore.prototype.get = function(ctx, key) {
  const self = this;
  const logger = utils.getLogger(ctx, this.options);
  if (!ctx.session.ptStorage) ctx.session.ptStorage = {};

  return co(function* () {
    const ptData = ctx.session.ptStorage[key];
    if (!ptData) return null;
    const updateTime = ptData[UPDATE_TIME];
    const value = ptData[VALUE];
    logger.info('Find PT from cache', ptData);
    logger.info(`Current ttl is ${self.options.ttl}, start checking validation.`);
    if (Date.now() - updateTime > self.options.ttl) {
      logger.info('Find PT from cache, but it is expired!');
      return yield self.remove(ctx, key);
    }
    logger.info(`Find PT from cache for service: ${key}, pt: ${value}`);
      // PT still valid
    return value;
  });
};

PTStore.prototype.remove = function(ctx, key) {
  const logger = utils.getLogger(ctx, this.options);
  if (!ctx.session.ptStorage) ctx.session.ptStorage = {};

  return co(function* () {
    if (!ctx.session.ptStorage[key]) {
      logger.info(`Trying to remove PT for service: ${key}, but it don\' exist!`);
      return null;
    }
    try {
      delete ctx.session.ptStorage[key];
      logger.info('Delete PT from cache succeed!');
      return null;
    } catch (err) {
      logger.error('Error when deleting pt');
      logger.error(err);
      throw err;
    }
  });
};

PTStore.prototype.clear = function(ctx) {
  const logger = utils.getLogger(ctx, this.options);
  return co(function* () {
    try {
      if (!ctx.session.ptStorage) return null;
      ctx.session.ptStorage = {};
      logger.info('clear pt succeed!');
      return null;
    } catch (err) {
      logger.error('Error when clear pt');
      logger.error(err);
      throw err;
    }
  });
};

module.exports = PTStore;
