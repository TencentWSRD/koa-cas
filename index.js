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


module.exports = class ConnectCas {

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

    if (options.hooks && is.generatorFunction(options.hooks.before)) {
      return function* (next) {
        yield options.hooks.before(this, next);
        yield coreMiddleware.bind(this, next);
      };
    } else {
      return coreMiddleware;
    }

    function* coreMiddleware(next) {
      const ctx = this;
      const req = this.request;
      if (!this.request.sessionStore) throw new Error('You must setup a session store before you can use CAS client!');
      if (!this.request.session) throw new Error(`Unexpected req.session ${this.request.session}`);

      const logger = utils.getLogger(this.request, options);
      const pathname = this.path;
      const method = this.method;

      let matchedRestletIntegrateRule;

      if (options.restletIntegration) {
        if (options.paths.restletIntegration) {
          this.request.clearRestlet = clearRestletTGTs.bind(null, options, logger);

          for (const i in options.restletIntegration) {
            if (options.restletIntegration[i] &&
              is.function(options.restletIntegration[i].trigger) &&
              options.restletIntegration[i].trigger(this.request)) {
              matchedRestletIntegrateRule = i;
              break;
            }
          }
        } else {
          logger.warn('options.restletIntegration is set, but options.paths.restletIntegration is undefined! Maybe you forget to set all your paths.');
        }
      }

      /*
       *
       * @param {String}     targetService  (Required) targetService for this proxy ticket
       * @param {Object}    [proxyOptions] (Optional) If this option is true, will force to request a new proxy ticket, ignore the cahce.
       *                                              Otherwise, whether to use cache or not depending on the options.cache.enable
       * @param {String}    proxyOptions.targetService   (Required)
       * @param {Boolean}   proxyOptions.disableCache    Whether to force disable cache and to request a new one.
       * @param {String}    proxyOptions.specialPgt      Use this pgt to request a PT, instead of req.session.cas.pgt
       * @param {Boolean}   proxyOptions.renew           Don't use cache, request a new one, reset it to cache
       * @param {Function}  proxyOptions.retryHandler    When trying to fetch a PT failed due to authentication issue, this callback will be called, it will receive one param `error`, which introduce the fail reason.
       *                                                 Be careful when you setting up this option because it might occur an retry loop.
       * @param {Function}  callback
       * @returns {*}
       */
      this.request.getProxyTicket = function(targetService, proxyOptions, callback) {

        if (typeof proxyOptions === 'function') {
          callback = proxyOptions; // eslint-disable-line no-param-reassign
          proxyOptions = { // eslint-disable-line no-param-reassign
            disableCache: false,
          };
        } else if (typeof proxyOptions === 'boolean') {
          proxyOptions = { // eslint-disable-line no-param-reassign
            disableCache: proxyOptions,
          };
        }

        proxyOptions.targetService = targetService;

        if (options.paths.proxyCallback) {
          let restletIntegrateParams;
          if (matchedRestletIntegrateRule) {
            if (is.function(options.restletIntegration[matchedRestletIntegrateRule].params)) {
              logger.info('Match restlet integration rule and using aync manner, whitch using function to return `object`, to get restlet integration params: ', matchedRestletIntegrateRule);
              restletIntegrateParams = options.restletIntegration[matchedRestletIntegrateRule].params(this.request);
            } else {
              logger.info('Match restlet integration rule and using default manner, whitch just directly return `object`, to get restlet integration params: ', matchedRestletIntegrateRule);
              restletIntegrateParams = options.restletIntegration[matchedRestletIntegrateRule].params;
            }
          }
          matchedRestletIntegrateRule ? getProxyTicketThroughRestletReq.call(that, this.request, targetService, {
            name: matchedRestletIntegrateRule,
            params: restletIntegrateParams,
            cache: options.restletIntegrationIsUsingCache,
          }, callback) : getProxyTicket.call(that, this.request, proxyOptions, callback);
        } else {
          logger.warn('options.paths.proxyCallback is not set, CAS is on non-proxy mode, you should not request a proxy ticket for non-proxy mode!');
          // TODO: Should this throw an error?
          // new Error('options.paths.proxyCallback is not set, CAS is on non-proxy mode, you should not request a proxy ticket for non-proxy mode!'
          callback();
        }
      };

      if (matchedRestletIntegrateRule) {
        logger.info('Match restlet integration rule: ', matchedRestletIntegrateRule);
        return yield doNext(next);
      }

      if (utils.shouldIgnore(req, options)) {
        return yield doNext(next);
      }

      if (method === 'GET') {
        switch (pathname) {
          case options.paths.validate:
            return yield validate(ctx, doNext, options);
          case that.proxyCallbackPathName:
            return yield proxyCallback(req, doNext, options);
          default:
            throw new Error(`koa-cas middleware don't support GET ${this.path}`);
        }
      } else if (method === 'POST' && pathname === options.paths.validate && options.slo) {
        return slo(req, doNext, options);
      } else {
        return authenticate(req, doNext, options);
      }


      function* doNext(callback) {
        if (options.hooks && is.generatorFunction(options.hooks.after)) {
          yield options.hooks.after(ctx, next);
        }
        yield callback();
      }
    }
  }

  logout() {
    const options = this.options;

    return function(req, res) {
      if (!req.session) {
        return res.redirect('/');
      }
      // Forget our own login session

      if (req.session.destroy) {
        req.session.destroy();
      } else {
        // Cookie-based sessions have no destroy()
        req.session = null;
      }

      // Send the user to the official campus-wide logout URL
      return res.redirect(utils.getPath('logout', options));
    };
  }

  getPath(name) {
    return utils.getPath(name, this.options);
  }

};
