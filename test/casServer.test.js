import Koa from 'koa';
import Router from 'koa-router';
import supertest from 'supertest';
import casServerFactory from './lib/casServer';
import {
  expect,
} from 'chai';
import url from 'url';
import {
  parseRestletResponse,
} from '../lib/getProxyTicketThroughRestletReq';
import {
  parseProxyTicketResponse,
} from '../lib/getProxyTicket';
import {
  parseCasResponse,
} from '../lib/validate';

const logger = {
  info() {},
  error() {},
};

describe('cas server如预期', function() {
  let server;
  let app;
  let request;
  this.timeout(5000);

  beforeEach(function(done) {
    app = new Koa();
    server = app.listen(3004, function(err) {
      if (err) throw err;
      done();
    });
    request = supertest.agent(app.listen());
  });
  afterEach(function() {
    server.close();
    app = null;
    server = null;
  });

  it('访问/cas/login, 啥都不带, 直接响应200', function(done) {
    casServerFactory(app);
    request.get('/cas/login').expect(200).end(done);
  });

  it('访问/cas/login,带service,当做成功登陆, 设置cookie, 302到service参数的路径, 带上ticket', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/login?service=${encodeURIComponent(service)}`)
      .expect(302)
      .expect((res) => {
        const serviceUri = url.parse(service, true);
        const locationUri = url.parse(res.header.location, true);
        expect(locationUri.host + locationUri.pathname).to.equal(serviceUri.host + locationUri.pathname);
      }).end(done);
  });

  it('访问/cas/serviceValidate, 没带ticket, 返回200, xml内authenticationFailure', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/servicevalidate?service=${encodeURIComponent(service)}`)
      .expect(200)
      .end((err, res) => {
        parseCasResponse(res.text, logger)
          .then((info) => {
            expect(info).to.deep.equal({});
            done();
          }).catch(done);
      });
  });

  it('访问/cas/serviceValidate, 带ticket, 但是ticket非法, 返回200, xml内authenticationFailure', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/serviceValidate?service=${encodeURIComponent(service)}&ticket=xxx`)
      .expect(200)
      .end((err, res) => {
        parseCasResponse(res.text, logger)
          .then((info) => {
            expect(info).to.deep.equal({});
            done();
          }).catch(done);
      });
  });

  it('访问/cas/serviceValidate, 带ticket, 但没带service, 返回200, xml内authenticationFailure', function(done) {
    casServerFactory(app);
    request.get('/cas/serviceValidate?&ticket=xxx')
      .expect(200)
      .end((err, res) => {
        parseCasResponse(res.text, logger)
          .then((info) => {
            expect(info).to.deep.equal({});
            done();
          }).catch(done);
      });
  });

  it('访问/cas/serviceValidate, 带ticket, ticket合法, 无pgtUrl, 直接响应成功xml, 带userId', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/login?service=${encodeURIComponent(service)}`)
      .expect(200)
      .end((err, response) => {
        const uri = url.parse(response.header.location, true);
        const ticket = uri.query.ticket;

        request.get(`/cas/serviceValidate?service=${encodeURIComponent(service)}&ticket=${ticket}`)
          .expect(200)
          .end((err, res) => {
            parseCasResponse(res.text, logger).then((info) => {
              expect(info.user).to.not.be.empty;
              done();
            }).catch(done);
          });
      });
  });

  it('访问/cas/serviceValidate, 带ticket, ticket合法, 有pgtUrl, 先调pgtUrl, 传过去pgtIou和pgtId, 然后响应成功xml, 带userId和pgtIou', function(done) {
    casServerFactory(app);

    // cas client
    const store = {};
    const localHost = 'http://localhost';
    const localPort = 3002;
    const appLocal = new Koa();
    const router = new Router();
    router.get('/cas/proxyCallback', function* () {
      console.log('/cas/proxyCallback query:', this.query);
      if (this.query) {
        expect(this.query.pgtIou).to.not.be.empty;
        expect(this.query.pgtId).to.not.be.empty;
        store[this.query.pgtIou] = this.query.pgtId;
        this.body = 'ok';
      } else {
        this.status = 400;
      }
    });
    appLocal.use(router.routes()).use(router.allowedMethods());

    const serverLocal = appLocal.listen(localPort, (err) => {
      if (err) throw err;
      const service = `${localHost}:${localPort}/cas/validate`;
      const pgtUrl = `${localHost}:${localPort}/cas/proxyCallback`;

      request.get(`/cas/login?service=${encodeURIComponent(service)}`).end((err, response) => {
        const uri = url.parse(response.header.location, true);
        const ticket = uri.query.ticket;
        expect(ticket).to.not.be.empty;
        console.log('ticket: ', ticket);

        request.get(`/cas/serviceValidate?service=${encodeURIComponent(service)}&ticket=${ticket}&pgtUrl=${encodeURIComponent(pgtUrl)}`)
          .expect(200)
          .end((err, res) => {
            parseCasResponse(res.text, logger)
              .then((info) => {
                console.log('info: ', info);
                expect(info.user).to.not.be.empty;
                expect(info.proxyGrantingTicket).to.not.be.empty;
                expect(store[info.proxyGrantingTicket]).to.not.be.empty;
                serverLocal.close((err) => done(err));
              }).catch(done);
          });
      });
    });
  });

  it('访问/cas/serviceValidate, options设置期望的500响应码, 接口响应500', function(done) {

    // 期望状态码500
    casServerFactory(app, {
      expectStatus: 500,
    });
    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/login?service=${encodeURIComponent(service)}`).end((err, response) => {
      const uri = url.parse(response.header.location, true);
      const ticket = uri.query.ticket;

      request.get(`/cas/serviceValidate?service=${encodeURIComponent(service)}&ticket=${ticket}`)
        .expect(500).end(done);
    });
  });

  it('访问/cas/serviceValidate, options设置期望的响应码200和字符串fail, 接口响应对应响应码或失败的xml响应', function(done) {
    casServerFactory(app, {
      expectStatus: 200,
      expectStatusStr: 'fail',
    });

    const service = 'http://localhost:3002/cas/validate';
    request.get(`/cas/login?service=${encodeURIComponent(service)}`).end((err, response) => {
      const uri = url.parse(response.header.location, true);
      const ticket = uri.query.ticket;

      request.get(`/cas/serviceValidate?service=${encodeURIComponent(service)}&ticket=${ticket}`)
        .expect(200)
        .end((err, res) => {
          parseCasResponse(res.text, logger).then((info) => {
            expect(info.user).to.be.empty;
            done();
          }).catch(done);
        });
    });
  });

  it('/cas/proxy接口,参数正确能够正确获取pt', function(done) {
    casServerFactory(app);
    request.get('/cas/proxy?pgt=fakePgtId&targetService=xxx')
      .expect(200)
      .end((err, response) => {
        expect(response.text).to.not.be.empty;
        const pt = parseProxyTicketResponse(response.text);
        expect(pt).to.not.be.empty;
        done();
      });
  });

  it('/cas/proxy接口,无pgt参数, 无法正确获取pt', function(done) {
    casServerFactory(app);
    request.get('/cas/proxy?targetService=xxx')
      .expect(200)
      .end((err, res) => {
        expect(res.text).to.not.be.empty;
        const pt = parseProxyTicketResponse(res.text);
        expect(pt).to.be.empty;
        done();
      });
  });

  it('/cas/proxy接口,无targetService参数, 无法获取正确的pt', function(done) {
    casServerFactory(app);

    request.get('/cas/proxy?pgt=fakePgtId').expect(200).end((err, res) => {
      expect(res.text).to.not.be.empty;
      const pt = parseProxyTicketResponse(res.text);
      expect(pt).to.be.empty;
      done();
    });
  });

  it('/cas/v1/tickets接口, 参数全部正确, 返回新的pgtId, 能够正确调用/proxy接口换st', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.post('/cas/v1/tickets').send({
      username: 'username',
      password: 'password',
      type: 8,
      from: service,
    }).expect(200).end((err, response) => {
      const pgtId = parseRestletResponse(response.text);
      expect(pgtId).to.not.be.empty;

      request.get(`/cas/proxy?pgt=${pgtId}&targetService=xxx`)
        .expect(200)
        .end((err, res) => {
          const pt = parseProxyTicketResponse(res.text);
          expect(pt).to.not.be.empty;
          done(err);
        });
    });
  });

  it('/cas/v1/tickets接口, 参数异常, 响应400', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.post('/cas/v1/tickets').send({
      username: 'wrong_username',
      password: 'password',
      type: 8,
      from: service,
    }).expect(400).end(done);
  });

  it('/cas/v1/tickets/:tgt接口可以正常删除tgt', function(done) {
    casServerFactory(app);
    const service = 'http://localhost:3002/cas/validate';
    request.post('/cas/v1/tickets').send({
      username: 'username',
      password: 'password',
      type: 8,
      from: service,
    }).expect(200)
      .end((_, res) => {
        const pgtId = parseRestletResponse(res.text);
        expect(pgtId).to.not.be.empty;

        request.get(`/cas/proxy?pgt=${pgtId}&targetService=xxx`)
          .expect(200)
          .end((_, res) => {
            const pt = parseProxyTicketResponse(res.text);
            expect(pt).to.not.be.empty;

            request.delete(`/cas/proxy?pgt=${pgtId}&targetService=xxx`)
              .expect(200)
              .end((_, res) => {
                const nowPt = parseRestletResponse(res.text);
                expect(nowPt).to.be.empty;
                done();
              });
          });
      });
  });

});
