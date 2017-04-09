import  Express  from 'express';
import  http  from 'http';
import  url  from 'url';
import  expect  from 'chai'.expect;
import  casServerFactory  from './lib/casServer';
import  casClientFactory  from './lib/casClientFactory';
import  utils  from '../lib/utils';
import  handleCookies  from './lib/handleCookie';

describe('validate是否符合预期', function() {

  let casClientApp, casClientServer, casServerApp, casServer,
    localhost = 'http://localhost',
    casPort = '3004',
    clientPort = '3002',
    casRootPath = `${localhost}:${casPort}`,
    clientPath = `${localhost}:${clientPort}`,
    hookBeforeCasConfig, hookAfterCasConfig;

  beforeEach(function(done) {

    casServerApp = new Express();

    casServerFactory(casServerApp);

    casServer = http.createServer(casServerApp);

    casClientApp = new Express();

    casClientFactory(casClientApp, {
      servicePrefix: clientPath,
      serverPath: casRootPath,
      logger(req, type) {
        return function() {
        };
      },
      hooks: {
        before(req, res, next) {
          req.start = Date.now();
          next();
        },
        after(req, res, next) {
          expect(req.start).to.not.be.empty;
          next();
        },
      },
    }, function(app) {
      app.use(function(req, res, next) {
        if (typeof hookBeforeCasConfig === 'function') {
          hookBeforeCasConfig(req, res, next);
        } else {
          next();
        }
      });
    }, function(app) {
      app.use(function(req, res, next) {
        if (typeof hookAfterCasConfig === 'function') {
          hookAfterCasConfig(req, res, next);
        } else {
          next();
        }
      });
    });

    casClientServer = http.createServer(casClientApp);

    casServer.listen(3004, function(err) {
      if (err) throw err;

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

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

  it('req.query中无ticket参数,302重定向到lastUrl', function(done) {

    utils.getRequest(`${clientPath}/cas/validate`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);
      expect(response.header.location).to.equal('/');

      done();
    });
  });

  it('req.query中带ticket参数,但是与session中的st一样, 302回lastUrl', function(done) {
    utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath }/cas/validate`)}`, function(err, response) {
      if (err) throw err;

      expect(response.status).to.equal(302);

      const redirectLocation = response.header.location;
      let cookies;

      utils.getRequest(redirectLocation, function(err, response) {
        if (err) throw err;

        cookies = handleCookies.setCookies(response.header);

        expect(response.status).to.equal(302);
        expect(response.header.location).to.equal('/');

        utils.getRequest(redirectLocation, {
          headers: {
            Cookie: handleCookies.getCookies(cookies),
          },
        }, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);
          expect(response.header.location).to.equal('/');
          done();
        });
      });
    });
  });

  it('校验ticket请求失败,响应非200,返回401', function(done) {
    casServer.close(function(err) {
      if (err) throw err;

      casServerApp = new Express();

      casServerFactory(casServerApp, {
        expectStatus: 500,
      });

      casServer = http.createServer(casServerApp);

      casServer.listen(3004, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(401);
            done();
          });
        });
      });
    });
  });

  it('校验ticket请求成功,但解析响应xml失败,返回500', function(done) {
    casServer.close(function(err) {
      if (err) throw err;

      casServerApp = new Express();

      casServerFactory(casServerApp, {
        expectStatusStr: 'invalid',
      });

      casServer = http.createServer(casServerApp);

      casServer.listen(3004, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          expect(redirectLocation).to.not.be.empty;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(500);
            done();
          });
        });
      });
    });
  });

  it('校验ticket请求成功,解析响应xml成功,但响应内容为非成功,响应401', function(done) {
    casServer.close(function(err) {
      if (err) throw err;

      casServerApp = new Express();

      casServerFactory(casServerApp, {
        expectStatusStr: 'fail',
      });

      casServer = http.createServer(casServerApp);

      casServer.listen(3004, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath }/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          expect(redirectLocation).to.not.be.empty;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(401);
            done();
          });
        });
      });
    });
  });

  it('非代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,并直接302到lastUrl', function(done) {

    const cookies = {};

    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath: casRootPath,
        paths: {
          proxyCallback: '',
        },
        logger(req, type) {
          return function() {
          };
        },

      }, function(app) {
        app.use(function(req, res, next) {
          // console.log(req.session);
          next();
        });
      }, function(app) {
        app.use(function(req, res, next) {
          expect(req.session.cas.user).to.not.be.empty;
          expect(req.session.cas.st).to.not.be.empty;
          next();
        });
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          expect(redirectLocation).to.not.be.empty;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(302);

            expect(response.header.location).to.not.be.empty;

            expect(response.header['set-cookie']).to.not.be.empty;

            response.header['set-cookie'].forEach(function(row) {
              const cookieArr = row.split(';');
              const keyValuePair = cookieArr[0].split('=');
              cookies[keyValuePair[0]] = keyValuePair[1];
            });

            // console.log('cookies', cookies);

            const lastUri = url.parse(response.header.location);
            let lastUrl;

            if (!lastUri.protocal) {
              lastUrl = clientPath + response.header.location;
            }

            function makeCookieStr(cookies) {
              const arr = [];
              for (const i in cookies) {
                arr.push(`${i}=${cookies[i]}`);
              }
              return arr.join('; ');
            }

            utils.getRequest(lastUrl, {
              headers: {
                Cookie: makeCookieStr(cookies),
              },
            }, function(err, response) {
              if (err) throw err;

              expect(response.status).to.equal(200);

              done();
            });
          });
        });


      });
    });
  });

  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,但是没pgtIou,响应401');
  //
  // it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,但找不到pgtId,响应401');

  it('代理模型,校验ticket请求成功,解析响应xml成功,响应内容成功,设置st到session,设置cas信息到session.cas,有pgtIou,找到pgtId,设置pgtId到session,302到lastUrl', function(done) {

    hookAfterCasConfig = function(req, res, next) {
      if (req.path === '/') {
        res.send(req.session.cas);
      } else {
        next();
      }
    };

    utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath }/cas/validate`)}`, function(err, response) {
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
          const body = JSON.parse(response.body);

          expect(body.user).to.not.be.empty;
          expect(body.st).to.not.be.empty;
          expect(body.pgt).to.not.be.empty;

          done();
        });
      });
    });
  });

  it('options.redirect工作正常', function(done) {
    const cookies = {};

    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientApp.get('/helloworld', function(req, res) {
        res.send('ok');
      });

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath: casRootPath,
        paths: {
          proxyCallback: '',
        },
        redirect(req, res) {
          return '/helloworld';
        },
        logger(req, type) {
          return function() {
          };
        },
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath }/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          expect(redirectLocation).to.not.be.empty;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(302);

            expect(response.header.location).to.not.be.empty;

            expect(response.header.location).to.equal('/helloworld');

            done();
          });
        });
      });
    });
  });

  it('hooks工作正常', function(done) {
    casClientServer.close(function(err) {
      if (err) throw err;

      casClientApp = new Express();

      casClientApp.get('/helloworld', function(req, res) {
        res.send('ok');
      });

      casClientFactory(casClientApp, {
        servicePrefix: clientPath,
        serverPath: casRootPath,
        paths: {
          proxyCallback: '',
        },
        hooks: {
          before(req, res, next) {
            req.start = Date.now();
            next();
          },
          after(req, res, next) {
            expect(req.start).to.not.be.empty;
            next();
          },
        },
        logger(req, type) {
          return function() {
          };
        },
      });

      casClientServer = http.createServer(casClientApp);

      casClientServer.listen(3002, function(err) {
        if (err) throw err;

        utils.getRequest(`${casRootPath}/cas/login?service=${encodeURIComponent(`${clientPath}/cas/validate`)}`, function(err, response) {
          if (err) throw err;

          expect(response.status).to.equal(302);

          const redirectLocation = response.header.location;

          expect(redirectLocation).to.not.be.empty;

          utils.getRequest(redirectLocation, function(err, response) {
            if (err) throw err;

            expect(response.status).to.equal(302);

            expect(response.header.location).to.not.be.empty;

            // expect(response.header.location).to.equal('/helloworld');

            done();
          });
        });
      });
    });
  });

});
