const _ = require('lodash');
const validate = require('./lib/validate');
const proxyCallback = require('./lib/proxyCallback');
const authenticate = require('./lib/authenticate');
const slo = require('./lib/slo');
const getProxyTicket = require('./lib/getProxyTicket');
const getProxyTicketThroughRestletReq = require('./lib/getProxyTicketThroughRestletReq');
const PTStroe = require('./lib/ptStroe');
const utils = require('./lib/utils');
const clearRestletTGTs = require('./lib/clearRestletTGTs');
const url = require('url');
const deprecate = require('deprecate');
const is = require('is-type-of');
const co = require('co');

const DEFAULT_OPTIONS = {
  ignore: [],
  match: [],
  servicePrefix: '',
  serverPath: '',
  paths: {
    validate: '/cas/validate',
    serviceValidate: '/cas/serviceValidate',
    proxy: '/cas/proxy',
    login: '/cas/login',
    logout: '/cas/logout',
    proxyCallback: '/cas/proxyCallback',
  },
  hooks: {
    before: null,
    after: null,
  },
  redirect: false,
  gateway: false,
  renew: false,
  slo: true,
  // Is proxy-ticket cacheable
  cache: {
    enable: false,
    ttl: 5 * 60 * 1000, // In millisecond
    filter: [],
  },
  fromAjax: {
    header: 'x-client-ajax',
    status: 418,
  },
  restletIntegration: {},
  restletIntegrationIsUsingCache: true,
};


class ConnectCas {

  constructor(options) {
    /* istanbul ignore if */
    if (!(this instanceof ConnectCas)) return new ConnectCas(options);

    this.options = _.merge({}, DEFAULT_OPTIONS, options);

    /* istanbul ignore if */
    if (this.options.ssoff) {
      deprecate('options.ssoff is deprecated, use option.slo instead.');
      this.options.slo = this.options.ssoff;
    }

    if (this.options.debug) {
      deprecate('options.debug is deprecated, please control the console output by a custom logger.');
    }

    /* istanbul ignore if */
    if (!this.options.servicePrefix || !this.options.serverPath) throw new Error('Unexpected options.service or options.serverPath!');

    if (this.options.cache && this.options.cache.enable) {
      this.ptStore = new PTStroe({
        ttl: this.options.cache.ttl,
        logger: this.options.logger,
      });
    }

    if (this.options.renew || this.options.gateway) {
      console.warn('options.renew and options.gateway is not implement yet!');
    }

    const pgtURI = url.parse(this.options.paths.proxyCallback || '', true);
    this.proxyCallbackPathName = (pgtURI.protocol && pgtURI.host) ? pgtURI.pathname : this.options.paths.proxyCallback;
  }


  core() {
    const options = this.options;
    const that = this;
    return function* coreMiddleware(next) {
      const ctx = this;
      console.log('ctx.originalUrl: ', ctx.originalUrl, ', path: ', ctx.path);
      if (!ctx.sessionStore) throw new Error('You must setup a session store before you can use CAS client!');
      if (!ctx.session) throw new Error(`Unexpected ctx.session ${ctx.session}`);

      if (options.hooks && is.function(options.hooks.before)) {
        yield options.hooks.before(this, next);
      }

      const logger = utils.getLogger(ctx, options);
      let matchedRestletIntegrateRule;

      if (options.restletIntegration) {
        if (!options.paths.restletIntegration) {
          logger.warn('options.restletIntegration is set, but options.paths.restletIntegration is undefined! Maybe you forget to set all your paths.');
        } else {
          ctx.clearRestlet = co.wrap(function* () {
            return yield clearRestletTGTs.bind(ctx, options, logger);
          });

          ctx.request.clearRestlet = () => {
            deprecate('ctx.request.clearRestlet is deprecated, please use \'ctx.clearResetlet\'');
            return ctx.clearRestlet(...Array.from(arguments));
          };

          for (const i in options.restletIntegration) {
            if (options.restletIntegration[i] &&
              is.function(options.restletIntegration[i].trigger) &&
              options.restletIntegration[i].trigger(ctx)) {
              matchedRestletIntegrateRule = i;
              break;
            }
          }
        }
      }

      /*
       *
       * @param {String}     targetService  (Required) targetService for this proxy ticket
       * @param {Object}    [proxyOptions] (Optional) If this option is true, will force to request a new proxy ticket, ignore the cahce.
       *                                              Otherwise, whether to use cache or not depending on the options.cache.enable
       * @param {String}    proxyOptions.targetService   (Required)
       * @param {Boolean}   proxyOptions.disableCache    Whether to force disable cache and to request a new one.
       * @param {String}    proxyOptions.specialPgt      Use this pgt to request a PT, instead of ctx.session.cas.pgt
       * @param {Boolean}   proxyOptions.renew           Don't use cache, request a new one, reset it to cache
       * @param {Function}  proxyOptions.retryHandler    When trying to fetch a PT failed due to authentication issue, this callback will be called, it will receive one param `error`, which introduce the fail reason.
       *                                                 Be careful when you setting up this option because it might occur an retry loop.
       * @param {Function}  callback
       * @returns {*}
       */
      ctx.getProxyTicket = co.wrap(function* (targetService, proxyOptions = {}) {
        if (typeof proxyOptions === 'function') {
          proxyOptions = { // eslint-disable-line no-param-reassign
            disableCache: false,
          };
        } else if (typeof proxyOptions === 'boolean') {
          proxyOptions = { // eslint-disable-line no-param-reassign
            disableCache: proxyOptions,
          };
        }

        proxyOptions.targetService = targetService;
        if (!options.paths.proxyCallback) {
          logger.warn('options.paths.proxyCallback is not set, CAS is on non-proxy mode, you should not request a proxy ticket for non-proxy mode!');
          throw new Error('options.paths.proxyCallback is not set, CAS is on non-proxy mode, you should not request a proxy ticket for non-proxy mode!');
        }

        let restletIntegrateParams;
        if (matchedRestletIntegrateRule) {
          if (is.function(options.restletIntegration[matchedRestletIntegrateRule].params)) {
            logger.info('Match restlet integration rule and using aync manner, whitch using function to return `object`, to get restlet integration params: ', matchedRestletIntegrateRule);
            restletIntegrateParams = options.restletIntegration[matchedRestletIntegrateRule].params(ctx);
          } else {
            logger.info('Match restlet integration rule and using default manner, whitch just directly return `object`, to get restlet integration params: ', matchedRestletIntegrateRule);
            restletIntegrateParams = options.restletIntegration[matchedRestletIntegrateRule].params;
          }
        }
        const pt = matchedRestletIntegrateRule ? yield getProxyTicketThroughRestletReq.call(that, ctx, targetService, {
          name: matchedRestletIntegrateRule,
          params: restletIntegrateParams,
          cache: options.restletIntegrationIsUsingCache,
        }) : yield getProxyTicket.call(that, ctx, proxyOptions);
        return pt;
      });

      ctx.request.getProxyTicket = () => {
        deprecate('"ctx.request.getProxyTicket" is deprecated, please use "ctx.getProxyTicket"');
        return ctx.getProxyTicket(...Array.from(arguments));
      };

      const afterHook = options.hooks && is.function(options.hooks.after) ? options.hooks.after.bind(this, ctx, next) : () => Promise.resolve();
      if (matchedRestletIntegrateRule) {
        logger.info('Match restlet integration rule: ', matchedRestletIntegrateRule);
        ctx.sessionSave = true; // generate a new session to keep sessionid in cookie
        yield afterHook();
        return yield next;
      }

      if (utils.shouldIgnore(ctx, options)) {
        yield afterHook();
        return yield next;
      }
      if (this.method === 'GET') {
        switch (this.path) {
          case options.paths.validate:
            return yield validate(ctx, afterHook, options);
          case that.proxyCallbackPathName:
            return yield proxyCallback(ctx, afterHook, options);
          default:
            break;
        }
      } else if (this.method === 'POST' && this.path === options.paths.validate && options.slo) {
        return yield slo(ctx, afterHook, options);
      }
      return yield authenticate(ctx, afterHook, next, options);
    };
  }

  logout() {
    const options = this.options;

    return function* () {
      if (!this.session) {
        return this.redirect('/');
      }
      // Forget our own login session

      if (this.session.destroy) {
        yield this.session.destroy();
      } else {
        // Cookie-based sessions have no destroy()
        this.session = null;
      }
      // Send the user to the official campus-wide logout URL
      return this.redirect(utils.getPath('logout', options));
    };
  }

  getPath(name) {
    return utils.getPath(name, this.options);
  }

}

module.exports = ConnectCas;
