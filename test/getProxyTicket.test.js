import Koa from 'koa';
import {
  expect,
} from 'chai';
import casServerFactory from './lib/casServer';
import casClientFactory from './lib/casClientFactory';
import utils from '../lib/utils';
import handleCookies from './lib/handleCookie';
import {
  logger,
} from './lib/test-utils';
import supertest from 'supertest';

describe('能够正确获取proxy ticket', function() {

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

    casServer = casServerApp.listen(casPort, (err) => {
      if (err) throw err;

      serverRequest = supertest.agent(casServerApp.listen());
      casClientServer = casClientApp.listen(clientPort, (err) => {
        if (err) throw err;
        request = supertest.agent(casClientApp.listen());
        done();
      });
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
    hookAfterCasConfig = function* (ctx, next) {
      if (ctx.path === '/') {
        const pt = ctx.request.getProxyTicket('xxx');
        ctx.body = pt;
      } else {
        yield next;
      }
    };

    serverRequest.get(`/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`)
      .expect(302)
      .end((err, res) => {

        const redirectLocation = res.header.location;
        let cookies;

        request.get(redirectLocation)
          .expect(302)
          .end((err, res) => {

            cookies = handleCookies.setCookies(res.header);
            expect(res.header.location).to.equal('/');

            request.get('/')
              .set('Cookie', handleCookies.getCookies(cookies))
              .expect(200)
              .end((err, res) => {

              });

            utils.getRequest(`${clientPath}/`, {
              headers: {
                Cookie: handleCookies.getCookies(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);
              expect(response.body).to.not.be.empty;

              done();
            });
          });
      });
    utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);

      const redirectLocation = response.header.location;
      let cookies;

      utils.getRequest(redirectLocation, function(err, response) {
        if (err) throw err;

        cookies = handleCookies.setCookies(response.header);

        expect(response.status).to.equal(302);
        expect(response.header.location).to.equal('/');

        utils.getRequest(`${clientPath}/`, {
          headers: {
            Cookie: handleCookies.getCookies(cookies),
          },
        }, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(200);
          expect(response.body).to.not.be.empty;

          done();
        });
      });
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 再次请求的pt应与上一次相同', function(done) {
    hookAfterCasConfig = function(req, res, next) {
      if (req.path === '/') {
        req.getProxyTicket('xxx', function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else {
        next();
      }
    };

    utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);

      const redirectLocation = response.header.location;
      let cookies;

      utils.getRequest(redirectLocation, function(err, response) {
        if (err) throw err;

        cookies = handleCookies.setCookies(response.header);

        expect(response.status).to.equal(302);
        expect(response.header.location).to.equal('/');

        utils.getRequest(`${clientPath}/`, {
          headers: {
            Cookie: handleCookies.getCookies(cookies),
          },
        }, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(200);
          expect(response.body).to.not.be.empty;

          const pt = response.body;

          utils.getRequest(`${clientPath}/`, {
            headers: {
              Cookie: handleCookies.getCookies(cookies),
            },
          }, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(200);
            expect(response.body).to.not.be.empty;

            expect(response.body).to.equal(pt);

            done();
          });
        });
      });
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 但是设置disableCache, 再次请求的pt应与上一次不同', function(done) {
    hookAfterCasConfig = function(req, res, next) {
      if (req.path === '/') {
        req.getProxyTicket('xxx', function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else if (req.path === '/noCache') {
        req.getProxyTicket('xxx', {
          disableCache: true,
        }, function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else if (req.path === '/noCache/old') {
        req.getProxyTicket('xxx', true, function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else {
        next();
      }
    };

    utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);

      const redirectLocation = response.header.location;
      let cookies;

      utils.getRequest(redirectLocation, function(err, response) {
        if (err) throw err;

        cookies = handleCookies.setCookies(response.header);

        expect(response.status).to.equal(302);
        expect(response.header.location).to.equal('/');

        utils.getRequest(`${clientPath}/`, {
          headers: {
            Cookie: handleCookies.getCookies(cookies),
          },
        }, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(200);
          expect(response.body).to.not.be.empty;

          const pt = response.body;

          utils.getRequest(`${clientPath}/noCache`, {
            headers: {
              Cookie: handleCookies.getCookies(cookies),
            },
          }, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(200);
            expect(response.body).to.not.be.empty;

            expect(response.body).to.not.equal(pt);

            utils.getRequest(`${clientPath}/noCache/old`, {
              headers: {
                Cookie: handleCookies.getCookies(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);
              expect(response.body).to.not.be.empty;

              expect(response.body).to.not.equal(pt);

              done();
            });
          });
        });
      });
    });
  });

  it('登陆成功后能够成功获取pt,使用缓存, 设置renew, 再次请求的pt应与上一次不同, 再下一次与上一次相同', function(done) {
    hookAfterCasConfig = function(req, res, next) {
      if (req.path === '/') {
        req.getProxyTicket('xxx', function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else if (req.path === '/renew') {
        req.getProxyTicket('xxx', {
          renew: true,
        }, function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      } else {
        next();
      }
    };

    utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);

      const redirectLocation = response.header.location;
      let cookies;

      utils.getRequest(redirectLocation, function(err, response) {
        if (err) throw err;

        cookies = handleCookies.setCookies(response.header);

        expect(response.status).to.equal(302);
        expect(response.header.location).to.equal('/');

        utils.getRequest(`${clientPath}/`, {
          headers: {
            Cookie: handleCookies.getCookies(cookies),
          },
        }, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(200);
          expect(response.body).to.not.be.empty;

          let pt = response.body;

          utils.getRequest(`${clientPath}/`, {
            headers: {
              Cookie: handleCookies.getCookies(cookies),
            },
          }, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(200);
            expect(response.body).to.not.be.empty;

            expect(response.body).to.equal(pt);

            utils.getRequest(`${clientPath}/renew`, {
              headers: {
                Cookie: handleCookies.getCookies(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);
              expect(response.body).to.not.be.empty;

              expect(response.body).to.not.equal(pt);

              pt = response.body;

              utils.getRequest(`${clientPath}/`, {
                headers: {
                  Cookie: handleCookies.getCookies(cookies),
                },
              }, function(err, response) {
                if (err) throw err;

                expect(response.status).to.equal(200);
                expect(response.body).to.not.be.empty;

                expect(response.body).to.equal(pt);
                done();
              });
            });

          });
        });
      });
    });
  });

  it('登陆成功后能够成功获取pt,不使用缓存, 再次请求的pt应与上一次不同', function(done) {
    const cookies = {};

    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          enable: false,
        },
        logger(req, type) {
          return function() {};
        },
      });

      casClientApp.get('/getPt', function(req, res) {
        req.getProxyTicket('xxx', function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;
          let cookies;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            cookies = handleCookies.setCookies(response.header);

            expect(response.status).to.equal(302);
            expect(response.header.location).to.equal('/');

            utils.getRequest(`${clientPath}/getPt`, {
              headers: {
                Cookie: handleCookies.getCookies(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);
              expect(response.body).to.not.be.empty;

              const pt = response.body;

              utils.getRequest(`${clientPath}/getPt`, {
                headers: {
                  Cookie: handleCookies.getCookies(cookies),
                },
              }, function(err, response) {
                if (err) throw err;

                expect(response.status).to.equal(200);
                expect(response.body).to.not.be.empty;

                expect(response.body).to.not.equal(pt);

                done();
              });
            });
          });
        });


      });
    });
  });

  it('登陆成功后能够成功获取pt, 使用缓存, 缓存有效时获取的与上一次相同, 过期后再获取, 请求的pt与上一次不同', function(done) {
    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          enable: true,
          ttl: 500,
        },
        logger(req, type) {
          return function() {};
        },
      });

      casClientApp.get('/getPt', function(req, res) {
        req.getProxyTicket('xxx', function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;
          let cookies;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            cookies = handleCookies.setCookies(response.header);

            expect(response.status).to.equal(302);
            expect(response.header.location).to.equal('/');

            utils.getRequest(`${clientPath}/getPt`, {
              headers: {
                Cookie: handleCookies.getCookies(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);

              const pt = response.body;

              utils.getRequest(`${clientPath}/getPt`, {
                headers: {
                  Cookie: handleCookies.getCookies(cookies),
                },
              }, function(err, response) {
                if (err) throw err;

                expect(response.status).to.equal(200);

                expect(response.body).to.equal(pt);

                setTimeout(function() {

                  utils.getRequest(`${clientPath}/getPt`, {
                    headers: {
                      Cookie: handleCookies.getCookies(cookies),
                    },
                  }, function(err, response) {
                    if (err) throw err;

                    expect(response.status).to.equal(200);

                    expect(response.body).to.not.equal(pt);

                    done();
                  });

                }, 1000);
              });
            });
          });
        });
      });
    });
  });

  it('登陆成功后能够成功获取pt, 使用缓存, 设置filter, filter外的使用缓存, 与上次相同, filter外的与上次不同', function(done) {
    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath,
        cache: {
          filter: [
            'http://specialPath1.com',
            /http:\/\/specialPath2\.com/,
            function(path, req) {
              return path.indexOf('http://specialPath3.com') > -1;
            },
          ],
        },
        logger(req, type) {
          return function() {};
        },
      });

      casClientApp.get('/getPt', function(req, res) {
        let targetService = '';
        if (req.query && req.query.targetService) {
          targetService = req.query.targetService;
        }
        req.getProxyTicket(targetService, function(err, pt) {
          if (err) throw err;

          res.send(pt);
        });
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${serverPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;
          let cookies;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            cookies = handleCookies.setCookies(response.header);

            expect(response.status).to.equal(302);
            expect(response.header.location).to.equal('/');

            const testTargetServiceArr = [ 'xxx', 'http://specialPath1.com', 'http://specialPath2.com', 'http://specialPath3.com' ];

            const pts = {};

            function queryPt(targetService) {
              return new Promise(function(resolve, reject) {
                utils.getRequest(`${clientPath}/getPt?targetService=${encodeURIComponent(targetService)}`, {
                  headers: {
                    Cookie: handleCookies.getCookies(cookies),
                  },
                }, function(err, response) {
                  if (err) return reject(err);
                  resolve(response);
                });
              });
            }

            // outside filter
            queryPt(testTargetServiceArr[0])
              .then(function(response) {
                pts[testTargetServiceArr[0]] = response.body;
              })
              .then(function() {
                return queryPt(testTargetServiceArr[0]);
              })
              .then(function(response) {
                expect(pts[testTargetServiceArr[0]]).to.equal(response.body);
              })
              // in filter
              .then(function() {
                return queryPt(testTargetServiceArr[1]);
              })
              .then(function(response) {
                pts[testTargetServiceArr[1]] = response.body;
              })
              .then(function() {
                return queryPt(testTargetServiceArr[1]);
              })
              .then(function(response) {
                expect(pts[testTargetServiceArr[1]]).to.not.equal(response.body);
              })
              // in filter
              .then(function() {
                return queryPt(testTargetServiceArr[2]);
              })
              .then(function(response) {
                pts[testTargetServiceArr[2]] = response.body;
              })
              .then(function() {
                return queryPt(testTargetServiceArr[2]);
              })
              .then(function(response) {
                expect(pts[testTargetServiceArr[2]]).to.not.equal(response.body);
              })
              // in filter
              .then(function() {
                return queryPt(testTargetServiceArr[3]);
              })
              .then(function(response) {
                pts[testTargetServiceArr[3]] = response.body;
              })
              .then(function() {
                return queryPt(testTargetServiceArr[3]);
              })
              .then(function(response) {
                expect(pts[testTargetServiceArr[3]]).to.not.equal(response.body);
              })
              .then(function() {
                done();
              }, function(err) {
                throw err;
              });
          });
        });


      });
    });
  });
});
