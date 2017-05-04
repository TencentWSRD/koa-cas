const Koa = require('koa');
const co = require('co');
const supertest = require('supertest');
const { logger } = require('./lib/test-utils');
const { expect } = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');

describe('logout中间件正常', function() {
  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;

  let casClientApp;
  let casClientServer;
  let casServerApp;
  let casServer;
  let request;
  let serverRequest;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;

  beforeEach(function(done) {

    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      paths: {
        proxyCallback: '',
      },
      logger,
    }, {
      beforeCasConfigHook(app) {
        app.use(function* (next) {
          if (typeof hookBeforeCasConfig === 'function') {
            return yield hookBeforeCasConfig(this, next);
          } else {
            return yield next;
          }
        });
      },
      afterCasConfigHook(app) {
        app.use(function* (next) {
          if (typeof hookAfterCasConfig === 'function') {
            return yield hookAfterCasConfig(this, next);
          } else {
            return yield next;
          }
        });
      },
    });

    co(function* () {
      yield new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
      console.log(`casServer listen ${casPort}`);
      serverRequest = supertest.agent(casServerApp.listen());

      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      console.log(`casClientServer listen ${clientPort}`);
      request = supertest.agent(casClientApp.listen());
      done();
    });
  });

  afterEach(function(done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    co(function* () {
      yield new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
      done();
    });
  });

  it('调用logout中间件后, 注销session, 并302到/cas/logout', function(done) {
    hookAfterCasConfig = function*(ctx, next) {
      if (ctx.path === '/') {
        ctx.body = ctx.session.cas || '';
      } else {
        yield next;
      }
    };

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      const cookies = handleCookies.setCookies(res.header);
      expect(res.header.location).to.equal('/');

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const body = JSON.parse(res.text);
      expect(body.user).to.not.be.empty;
      expect(body.st).to.not.be.empty;

      res = yield request.get('/logout').set('Cookie', handleCookies.getCookies(cookies)).expect(302);
      expect(res.header.location.indexOf(`${serverPath}/cas/logout`) > -1).to.be.true;
      done();
    });
  });
});
