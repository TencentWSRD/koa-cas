const Koa = require('koa');
const co = require('co');
const supertest = require('supertest');
const {
  logger,
  hooks
} = require('./lib/test-utils');
const {
  expect
} = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');

describe('validate是否符合预期', function () {

  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;

  let casClientApp;
  let casClientServer;
  let casServerApp;
  let casServer;
  let serverRequest;
  let request;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;

  const casConfigHooks = {
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
  };

  beforeEach(function (done) {

    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      logger,
      hooks,
    }, casConfigHooks);

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

  afterEach(function (done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    co(function* () {
      yield new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
      done();
    });
  });

  it('req.query中无ticket参数,302重定向到lastUrl', function (done) {
    co(function* () {
      const res = yield request.get('/cas/validate').expect(302);
      expect(res.header.location).to.equal('/');
      done();
    });
  });

  it('req.query中带ticket参数,但是与session中的st一样, 302回lastUrl', function (done) {

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get(redirectLocation.replace(clientPath, '')).set('Cookie', handleCookies.getCookies(cookies)).expect(302);
      expect(res.header.location).to.equal('/');
      done();
    }).catch(done);
  });

  it('校验ticket请求失败,响应非200,返回401', function (done) {
    co(function* () {
      yield new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

      casServerApp = new Koa();
      casServerFactory(casServerApp, {
        expectStatus: 500,
      });
      yield new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
      serverRequest = supertest.agent(casServerApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(401);
      done();
    }).catch(done);
  });

  it('校验ticket请求成功,但解析响应xml失败,返回500', function (done) {
    co(function* () {
      yield new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

      casServerApp = new Koa();
      casServerFactory(casServerApp, {
        expectStatusStr: 'invalid',
      });
      yield new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
      serverRequest = supertest.agent(casServerApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(500);
      const body = JSON.parse(res.text);
      expect(body.message).to.not.be.empty;
      done();
    }).catch(done);
  });

  it('校验ticket请求成功,解析响应xml成功,但响应内容为非成功,响应401', function (done) {
    co(function* () {
      yield new Promise((r, j) => casServer.close((err) => err ? j(err) : r()));

      casServerApp = new Koa();
      casServerFactory(casServerApp, {
        expectStatusStr: 'fail',
      });
      yield new Promise((r, j) => casServer = casServerApp.listen(casPort, (err) => err ? j(err) : r()));
      serverRequest = supertest.agent(casServerApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(401);
      const body = JSON.parse(res.text);
      expect(body.message).to.not.be.empty;
      expect(body.message.indexOf('validation is failed') !== -1).to.be.true;
      done();
    }).catch(done);
  });

  it('非代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,并直接302到lastUrl', function (done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        paths: {
          proxyCallback: '',
        },
        logger,
      }, casConfigHooks);
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      hookAfterCasConfig = function* (ctx, next) {
        if (ctx.path === '/') {
          ctx.body = {
            sid: ctx.sessionId,
            cas: ctx.session.cas,
          };
        } else {
          return yield next;
        }
      };

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.be.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const body = res.body;
      expect(body.cas.user).to.not.be.empty;
      expect(body.cas.st).to.not.be.empty;
      expect(body.sid).to.not.be.empty;
      done();
    }).catch(done);
  });

  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,但是没pgtIou,响应401');
  //
  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,但找不到pgtId,响应401');

  it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,找到pgtId,设置pgtId到session,302到lastUrl', function (done) {
    hookAfterCasConfig = function* (ctx, next) {
      if (ctx.path === '/') {
        ctx.body = {
          sid: ctx.sessionId,
          cas: ctx.session.cas,
        };
      } else {
        return yield next;
      }
    };

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.be.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const body = JSON.parse(res.text);
      expect(body.cas.user).to.not.be.empty;
      expect(body.cas.st).to.not.be.empty;
      expect(body.cas.pgt).to.not.be.empty;
      expect(body.sid).to.not.be.empty;
      done();
    }).catch(done);
  });

  it('options.redirect工作正常', function (done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        paths: {
          proxyCallback: '',
        },
        redirect(ctx) { // eslint-disable-line
          return '/helloworld';
        },
        logger,
      });
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      hookAfterCasConfig = function* (ctx, next) {
        if (ctx.pah === '/helloworld') {
          ctx.body = 'ok';
        } else {
          return yield next;
        }
      };

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.be.equal('/helloworld');
      done();
    }).catch(done);
  });

  it('hooks工作正常', function (done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        paths: {
          proxyCallback: '',
        },
        logger,
        hooks: {
          * before(ctx) {
            ctx.start = Date.now();
          },
          * after(ctx) {
            expect(ctx.start).to.not.be.empty;
          },
        },
      });
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.be.equal('/');
      done();
    }).catch(done);
  });

  it('servicePrefix配置, 域名后面带上path, 校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,找到pgtId,设置pgtId到session,302到lastUrl', function (done) {
    co(function* () {
      const clientPath = `${localhost}:${clientPort}/ci`;
      hookAfterCasConfig = function* (ctx, next) {
        if (ctx.path === '/') {
          ctx.body = {
            sid: ctx.sessionId,
            cas: ctx.session.cas,
          };
        } else {
          return yield next;
        }
      };

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        logger,
        paths: {
          validate: '/ci/cas/validate',
          proxyCallback: `/ci/cas/proxyCallback`,
        },
      }, casConfigHooks);

      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(`${localhost}:${clientPort}`, '')).expect(302);
      expect(res.header.location).to.be.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const body = JSON.parse(res.text);
      expect(body.cas.user).to.not.be.empty;
      expect(body.cas.st).to.not.be.empty;
      expect(body.cas.pgt).to.not.be.empty;
      expect(body.sid).to.not.be.empty;
      done();
    }).catch(done);
  });

});