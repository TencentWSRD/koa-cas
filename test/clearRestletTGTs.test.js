import Koa from 'koa';
import supertest from 'supertest';
import {
  expect,
} from 'chai';
import casServerFactory from './lib/casServer';
import casClientFactory from './lib/casClientFactory';
import handleCookies from './lib/handleCookie';
import globalPGTStore from '../lib/globalStoreCache';
import {
  parseRestletResponse,
} from '../lib/getProxyTicketThroughRestletReq.js';
import {
  logger,
} from './lib/test-utils';

describe('清理全局tgt工作正常', function() {

  this.timeout(10000);
  const localhost = 'http://127.0.0.1';
  const casPort = 3004;
  const clientPort = 3002;
  const serverPath = `${localhost}:${casPort}`;
  const clientPath = `${localhost}:${clientPort}`;

  let casClientApp;
  let casClientServer;
  let casServerApp;
  let casServer;
  let hookBeforeCasConfig;
  let hookAfterCasConfig;
  let clientRequest;
  let serverRequest;

  beforeEach(function(done) {

    casServerApp = new Koa();
    casServerFactory(casServerApp);

    casClientApp = new Koa();
    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath,
      paths: {
        restletIntegration: '/cas/v1/tickets',
      },
      restletIntegration: {
        demo1: {
          trigger(req) {
            if (req.path.indexOf('restlet') > -1 || req.path.indexOf('clearRestlet') > -1) return true;
          },
          params: {
            username: 'username',
            password: 'password',
            from: 'somewhere',
            type: 8,
          },
        },
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

    casServer = casServerApp.listen(casPort, (err) => {
      if (err) throw err;
      console.log('casServer started to listen ', casPort);
      serverRequest = supertest.agent(casServerApp.listen());

      casClientServer = casClientApp.listen(clientPort, (err) => {
        if (err) throw err;
        console.log(`clientServer started to listen: ${clientPort}`);
        clientRequest = supertest.agent(casClientApp.listen());
        done();
      });
    });
  });

  afterEach(function(done) {
    hookAfterCasConfig = null;
    hookBeforeCasConfig = null;
    casServer.close(function(err) {
      if (err) throw err;
      casClientServer.close(function(err) {
        if (err) throw err;
        done();
      });
    });
  });

  it('正常获取tgt, 并且能够正常获取pt后, 调用清理tgt接口, 再用老tgt换pt失败', function(done) {
    let pgt;

    hookAfterCasConfig = function* (ctx, next) {
      console.log('hookAfterCasConfig');
      if (ctx.path === '/restlet') {
        if (ctx.query && ctx.query.time) {
          const cachedPgt = globalPGTStore.get('demo1');
          expect(cachedPgt).to.equal(pgt);
        }
        console.log('hookAfterCasConfig start getProxyTicket...');
        const pt = yield ctx.getProxyTicket('some targetService');
        console.log('final pt: ', pt);
        pgt = globalPGTStore.get('demo1');
        expect(pgt).to.not.be.empty;
        ctx.body = pt;
        return;
      } else if (ctx.path === '/clearRestlet') {
        yield ctx.clearRestlet();
        ctx.body = 'ok';
        return;
      } else {
        return yield next;
      }
    };

    let cookies;
    clientRequest.get('/restlet')
      .expect(200)
      .end((err, response) => {
        if (err) throw err;
        console.log('/restlet header:', response.header);
        cookies = handleCookies.setCookies(response.header);
        const pt = response.text;
        expect(pt).to.not.be.empty;

        clientRequest.get('/clearRestlet')
          .set('Cookie', handleCookies.getCookies(cookies))
          .expect(200)
          .end((err1) => {
            if (err1) throw err1;
            serverRequest.get(`/cas/proxy?pgt=${pgt}&targetService=xxx`)
              .expect(200)
              .end((err2, res) => {
                if (err2) throw err2;
                console.log('/cas/proxy: ', res.text);
                const nowPt = parseRestletResponse(res.text);
                expect(nowPt).to.be.empty;
                done(err || err1 || err2);
              });
          });
      });
  });
});
