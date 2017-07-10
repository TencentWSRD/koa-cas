const Koa = require('koa');
const { expect } = require('chai');
const casServerFactory = require('./lib/casServer');
const casClientFactory = require('./lib/casClientFactory');
const handleCookies = require('./lib/handleCookie');
const { logger } = require('./lib/test-utils');
const supertest = require('supertest');
const co = require('co');

const rootPathRoute = function* (ctx, next) {
  if (ctx.path === '/') {
    const pt = yield ctx.getProxyTicket('http://xxx.com');
    ctx.body = pt;
  } else {
    yield next;
  }
};

describe('能够正确获取proxy ticket: ', function() {

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
    casServer.close();
    casClientServer.close();
    done();
  });

  it('登陆成功后能够成功获取pt', function(done) {
    hookAfterCasConfig = rootPathRoute;

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      const cookies = handleCookies.setCookies(res.header);
      expect(res.header.location).to.equal('/');

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const pt = res.text;
      expect(pt).to.not.be.empty;
      done();
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 再次请求的pt应与上一次相同', function(done) {
    hookAfterCasConfig = rootPathRoute;

    co(function* () {
      console.log('::: GET /cas/login :');
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      console.log('::: GET redirect location: ', redirectLocation);
      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      const cookies = handleCookies.setCookies(res.header);
      expect(res.header.location).to.equal('/');

      console.log('::: GET / first time: ');
      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const pt = res.text;
      expect(pt).to.not.be.empty;

      console.log('::: GET / second time:');
      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      const cachePt = res.text;
      expect(cachePt).to.not.be.empty;
      expect(cachePt).to.equal(pt);
      done();
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 但是设置disableCache, 再次请求的pt应与上一次不同', function(done) {
    hookAfterCasConfig = function* (ctx, next) {
      if (ctx.path === '/') {
        ctx.body = yield ctx.getProxyTicket('http://xxx.com');
      } else if (ctx.path === '/noCache') {
        ctx.body = yield ctx.getProxyTicket('http://xxx.com', {
          disableCache: true,
        });
      } else if (ctx.path === '/noCache/old') {
        ctx.body = yield ctx.getProxyTicket('http://xxx.com', true);
      } else {
        yield next;
      }
    };

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const pt = res.text;

      res = yield request.get('/noCache').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const renewPt = res.text;
      expect(renewPt).to.not.equal(pt);

      // req.getProxyTicket proxyOptions is boolean, equal disableCache
      res = yield request.get('/noCache/old').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const anotherPt = res.text;
      expect(anotherPt).to.not.equal(pt);
      expect(anotherPt).to.not.equal(renewPt);
      done();
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 设置renew, 再次请求的pt应与上一次不同, 再下一次与上一次相同', function(done) {
    hookAfterCasConfig = function* (ctx, next) {
      if (ctx.path === '/') {
        ctx.body = yield ctx.getProxyTicket('http://xxx.com');
      } else if (ctx.path === '/renew') {
        ctx.body = yield ctx.getProxyTicket('http://xxx.com', {
          renew: true,
        });
      } else {
        return yield next;
      }
    };

    co(function* () {
      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const pt = res.text;

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const secondPt = res.text;
      expect(secondPt).to.equal(pt);

      res = yield request.get('/renew').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const renewPt = res.text;
      expect(renewPt).to.not.equal(pt);

      res = yield request.get('/').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const fourthPt = res.text;
      expect(fourthPt).to.equal(renewPt);
      done();
    });
  });

  it('登陆成功后能够成功获取pt,不使用缓存, 再次请求的pt应与上一次不同', function(done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          enable: false,
        },
        logger,
      });
      casClientApp.use(function* (next) {
        if (this.path === '/getPt') {
          this.body = yield this.getProxyTicket('http://xxx.com');
        } else {
          yield next;
        }
      });
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/getPt').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const pt = res.text;

      res = yield request.get('/getPt').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const secondPt = res.text;
      expect(secondPt).to.not.equal(pt);
      done();
    });
  });

  it('登陆成功后能够成功获取pt, 使用缓存, 缓存有效时获取的与上一次相同, 过期后再获取, 请求的pt与上一次不同', function(done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          enable: true,
          ttl: 500,
        },
        logger,
      });
      casClientApp.use(function* (next) {
        if (this.path === '/getPt') {
          this.body = yield this.getProxyTicket('http://xxx.com');
        } else {
          yield next;
        }
      });
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/getPt').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const pt = res.text;

      res = yield request.get('/getPt').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const secondPt = res.text;
      expect(secondPt).to.equal(pt);

      yield new Promise((r) => setTimeout(() => r(), 1000));
      res = yield request.get('/getPt').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const thirdPt = res.text;
      expect(thirdPt).to.not.equal(secondPt);

      done();
    });
  });

  it('登陆成功后能够成功获取pt, 使用缓存, 设置filter, filter外的使用缓存, 与上次相同, filter内的与上次不同', function(done) {
    co(function* () {
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));

      casClientApp = new Koa();
      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          filter: [
            'http://specialPath1.com',
            /http:\/\/specialPath2\.com/,
            function (path, ctx) { // eslint-disable-line
              return path.indexOf('http://specialPath3.com') > -1;
            },
          ],
        },
        logger,
      });
      casClientApp.use(function* (next) {
        if (this.path === '/getPt') {
          const targetService = this.query && this.query.targetService ? this.query.targetService : '';
          this.body = yield this.getProxyTicket(targetService);
        } else {
          return yield next;
        }
      });
      yield new Promise((r, j) => casClientServer = casClientApp.listen(clientPort, (err) => err ? j(err) : r()));
      request = supertest.agent(casClientApp.listen());

      let res = yield serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`).expect(302);
      const redirectLocation = res.header.location;

      res = yield request.get(redirectLocation.replace(clientPath, '')).expect(302);
      expect(res.header.location).to.equal('/');
      const cookies = handleCookies.setCookies(res.header);

      const targetServices = [
        'http://xxx.com',
        'http://specialPath1.com',
        'http://specialPath2.com',
        'http://specialPath3.com',
      ];

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[0])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts0Pt = res.text;

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[0])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts0Pt2 = res.text;
      expect(ts0Pt2).to.equal(ts0Pt);

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[1])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts1Pt = res.text;
      expect(ts1Pt).to.not.equal(ts0Pt2);

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[1])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts1Pt2 = res.text;
      expect(ts1Pt2).to.not.equal(ts1Pt);

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[2])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts2Pt = res.text;

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[2])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts2Pt2 = res.text;
      expect(ts2Pt2).to.not.equal(ts2Pt);

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[3])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts3Pt = res.text;

      res = yield request.get(`/getPt?targetService=${encodeURIComponent(targetServices[3])}`).set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      const ts3Pt2 = res.text;
      expect(ts3Pt2).to.not.equal(ts3Pt);
      done();
    });
  });
});
