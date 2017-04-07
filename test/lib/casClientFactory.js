/**
 * For testing usage, separate the global config of the app
 */
import convert from 'koa-convert';
import session from 'koa-generic-session';
import bodyParser from 'koa-bodyparser';
import cookie from 'koa-cookie';
import Router from 'koa-router';
import CasClient from '../../index';
import _ from 'lodash';

/*
 *
 * @param app
 * @param {Object} casOptions (Optional)
 * @param {Function} hookBeforeCasConfig (Optional)
 * @param {Function} hookAfterCasConfig (Optional)
 * @returns {*}
 */
module.exports = function(app, casOptions, hookBeforeCasConfig, hookAfterCasConfig) {

  app.keys = [ 'cas', 'test' ];
  app.use(cookie('here is some secret'));
  app.use(session({
    key: 'SESSIONID', // default "koa:sess"
    store: session.MemoryStore(),
  }));
  app.use(convert(bodyParser()));

  const demoParams = {
    appId: '900007430',
    pid: '1',
    type: 8,
    appKey: 'BXEKfudgcgVDBb8k',
  };

  if (typeof hookBeforeCasConfig === 'function') hookBeforeCasConfig(app);

  const defaultOptions = {
    ignore: [
      /\/ignore/,
    ],
    match: [],
    servicePrefix: 'http://10.17.86.87:8080',
    serverPath: 'http://cas.sdet.wsd.com',
    paths: {
      validate: '/cas/validate',
      serviceValidate: '/cas/serviceValidate',
      proxy: '/cas/proxy',
      login: '/cas/login',
      logout: '/cas/logout',
      proxyCallback: '/cas/proxyCallback',
      restletIntegration: '/buglycas/v1/tickets',
    },
    redirect: false,
    gateway: false,
    renew: false,
    slo: true,
    cache: {
      enable: true,
      ttl: 5 * 60 * 1000,
      filter: [
        // /betaserverpre\.et\.wsd\.com/
      ],
    },
    fromAjax: {
      header: 'x-client-ajax',
      status: 418,
    },
    logger(req, type) {
      return function() {};
    },
    restletIntegration: {
      demo1: {
        trigger(ctx) {
          // console.log('Checking restletIntegration rules');
          return false;
        },
        params: {
          username: `${demoParams.appId}_${demoParams.pid}`,
          from: 'http://10.17.86.87:8080/cas/validate',
          type: demoParams.type,
          password: JSON.stringify({
            appId: `${demoParams.appId}_${demoParams.pid}`,
            appKey: demoParams.appKey,
          }),
        },
      },
    },
  };

  if (casOptions) {
    _.merge(defaultOptions, casOptions);
  }
  // CAS config
  // =============================================================================
  const casClient = new CasClient(defaultOptions);
  app.use(casClient.core());


  // console.log('defaultOptions', defaultOptions);

  // if (defaultOptions.slo) {
  //   app.use(casClient.slo());
  // }

  if (typeof hookAfterCasConfig === 'function') hookAfterCasConfig(app);

  // if (typeof hookAfterCasConfig === 'function') {
  //   console.log('hookAfterCasConfig', hookAfterCasConfig);
  //   hookAfterCasConfig(app);
  // }

  const router = new Router();
  router.get('/logout', casClient.logout());
  router.get('/', function* () {
    console.log('hello /');
    this.body = 'ok';
  });
  app.use(router.routes(), router.allowedMethods());

  return app;
};
