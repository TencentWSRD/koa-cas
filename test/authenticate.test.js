import Koa from 'koa';
import casClientFactory from './lib/casClientFactory';
import supertest from 'supertest';
import {
  hooks,
  logger,
  sessionStAndPgtHook,
  sessionStHook,
} from './lib/test-utils';

describe('校验判断登陆状态', function() {
  let server;
  let app;
  let request;
  this.timeout(5000);

  beforeEach(function(done) {
    app = new Koa();
    server = app.listen(3002, function(err) {
      if (err) throw err;
      console.log(' listen 3002 succeed');
      done();
    });
    request = supertest.agent(app.listen()); // 必须如此, 不然在所有的router handler中都需要加上this.res.end(), why?
  });

  afterEach(function() {
    server.close();
    app = null;
    server = null;
  });

  it('非proxy模型,session中无pt, 跳登录页', function(done) {

    casClientFactory(app, {
      logger,
      hooks,
      paths: {
        proxyCallback: null,
      },
    });

    request.get('/').expect(302).end(done);
  });

  it('proxy模型,session中无pt, 跳登录页', function(done) {

    casClientFactory(app, {
      hooks,
      logger,
    });

    request.get('/').expect(302).end(done);
  });

  it('非proxy模型,session中有st, 正常响应', function(done) {

    casClientFactory(app, {
      hooks,
      logger,
      paths: {
        proxyCallback: null,
      },
    }, {
      beforeCasConfigHook: sessionStHook,
    });

    request.get('/')
      .expect(200)
      .end(done);
  });

  it('proxy模型,session中有st,无pgt,302', function(done) {
    casClientFactory(app, {
      hooks,
      logger,
    }, {
      beforeCasConfigHook: sessionStHook,
    });

    request.get('/').expect(302).end(done);
  });

  it('proxy模型,session中有st,无pgt,POST请求, 302', function(done) {
    casClientFactory(app, {
      hooks,
      logger,
    }, {
      beforeCasConfigHook: sessionStHook,
    });

    request.post('/').expect(302).end(done);
  });

  it('proxy模型,session中有st,有pgt,正常响应', function(done) {
    casClientFactory(app, {
      hooks,
      logger,
    }, {
      beforeCasConfigHook: sessionStAndPgtHook,
    });

    request.get('/').expect(200).end(done);
  });

  it('身份无效, 但是有fetch头, 响应418', function(done) {
    casClientFactory(app, {
      fromAjax: {
        header: 'x-client-ajax',
        status: 418,
      },
      hooks,
      logger,
    });

    request.get('/').set('x-client-ajax', 418).expect(418).end(done);
  });

  it('配置ignore字符串规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        '/',
      ],
      hooks,
      logger,
    });

    request.get('/').expect(200).end(done);
  });

  it('配置ignore正则规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        /\//,
      ],
      hooks,
      logger,
    });

    request.get('/').expect(200).end(done);
  });

  it('配置ignore函数规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        function(pathname) {
          if (pathname === '/') return true;
        },
      ],
      hooks,
      logger,
    });

    request.get('/').expect(200).end(done);
  });
});
