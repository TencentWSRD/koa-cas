import Koa from 'koa';
import co from 'co';
import supertest from 'supertest';
import {
  logger, hooks,
} from './lib/test-utils';
import { expect } from 'chai';
import casClientFactory from './lib/casClientFactory';
import PTStore from '../lib/ptStroe';
import handleCookies from './lib/handleCookie';

describe('PTStore功能正常', function() {

  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;
  const ptKey = 'key';
  const ptValue = 'I am a pt';

  let casClientApp;
  let casClientServer;
  let request;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;
  let ptStore;

  beforeEach(function(done) {

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      logger,
      hooks,
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

    hookBeforeCasConfig = function* (ctx, next) {
      ctx.sessionSave = true; // 确保创建一个session, 在cookie中存储sessionid
      switch (ctx.path) {
        case '/get':
          ctx.body = (yield ptStore.get(ctx, ptKey)) || '';
          break;
        case '/set':
          ctx.body = (yield ptStore.set(ctx, ptKey, ptValue)) || '';
          break;
        case '/remove':
          yield ptStore.remove(ctx, ptKey);
          ctx.body = 'ok';
          break;
        case '/clear':
          yield ptStore.clear(ctx);
          ctx.body = 'ok';
          break;
        default:
          return yield next;
      }
    };

    co(function* () {
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
      yield new Promise((r, j) => casClientServer.close((err) => err ? j(err) : r()));
      done();
    });
  });

  it('未初始化, 直接get, remove, clear, 不会出现异常', function(done) {
    ptStore = new PTStore({
      logger() {
        return () => {};
      },
    });

    co(function* () {
      let res = yield request.get('/get').expect(200);
      expect(res.text).to.be.empty;
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/remove').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;

      res = yield request.get('/clear').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      done();
    });
  });

  it('set后, 在过期时间内, 可以正常获取', function(done) {
    ptStore = new PTStore();

    co(function* () {
      let res = yield request.get('/set').expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);
      done();
    });
  });

  it('set后, 立刻获取能够获取, 但超过过期时间, 无法获取', function(done) {
    ptStore = new PTStore({
      ttl: 1000,
    });

    co(function* () {
      let res = yield request.get('/set').expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);
      const cookies = handleCookies.setCookies(res.header);

      yield new Promise((r) => setTimeout(() => r(), 500));
      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);

      yield new Promise((r) => setTimeout(() => r(), 1000));
      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.be.empty;

      done();
    });
  });

  it('remove后, 无论存不存在都正常响应, 删除后get不到该pt', function(done) {
    ptStore = new PTStore();

    co(function* () {
      let res = yield request.get('/set').expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);

      res = yield request.get('/remove').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.equal('ok');

      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.be.empty;
      done();
    });
  });

  it('clear后, 啥都获取不到', function(done) {
    ptStore = new PTStore();

    co(function* () {
      let res = yield request.get('/set').expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);
      const cookies = handleCookies.setCookies(res.header);

      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.not.be.empty;
      expect(res.text).to.equal(ptValue);

      res = yield request.get('/clear').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.equal('ok');

      res = yield request.get('/get').set('Cookie', handleCookies.getCookies(cookies)).expect(200);
      expect(res.text).to.be.empty;
      done();
    });
  });

});
