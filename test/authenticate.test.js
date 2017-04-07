import {
  expect,
} from 'chai';
import http from 'http';
import Koa from 'koa';
import utils from '../lib/utils';
import casClientFactory from './lib/casClientFactory';
import co from 'co';

const hooks = {
  * before(ctx, next) {
    ctx.start = Date.now();
    yield next;
  },
  * after(ctx, next) {
    console.log('startTime: ', ctx.start);
    expect(ctx.start).to.not.be.empty;
    yield next;
  },
};

const logger = (req, type) => {
  switch (type) { // cas日志不用那么详细, 有问题后再打开
    case 'access':
      return (log) => {
        const m = log.match(/\|(\w+)\|([^|]+)\|(\d+)\|(\d+)/i);
        if (m) {
          const [ , , apiName, status, costTime ] = m;
          req.ppReport({
            serviceName: 'CAS',
            apiName,
            success: status >= 200 && status <= 309,
            costTime,
          });
        } else {
          console.error(`CAS access log ${log} not match regex!`);
        }
      };
    case 'log':
    case 'debug':
    case 'info':
    case 'warn':
    case 'error':
    default:
      return console.log.bind(null, type, '[CONNECT-CAS]::');
  }
};

describe('校验判断登陆状态', function() {

  const reqUrl = 'http://localhost:3002';
  let server;
  let app;

  beforeEach(function(done) {
    app = new Koa();
    server = http.createServer(app.callback());
    server.listen(3002, function(err) {
      if (err) throw err;
      done();
    });
  });

  it('非proxy模型,session中无pt, 跳登录页', function(done) {

    casClientFactory(app, {
      logger,
      hooks,
      paths: {
        proxyCallback: null,
      },
    });

    utils.getRequest(reqUrl).then((response) => {
      expect(response.status).to.equal(302);
      done();
    });
  });

  it('proxy模型,session中无pt, 跳登录页', function(done) {

    casClientFactory(app, {
      hooks,
      logger,
    });

    utils.getRequest(reqUrl).then((response) => {
      expect(response.status).to.equal(302);
      done();
    });
  });

  it.only('非proxy模型,session中有st, 正常响应', function(done) {

    casClientFactory(app, {
      hooks,
      logger,
      paths: {
        proxyCallback: null,
      },
    }, function(app) {
      app.use(co.wrap(function* (ctx, next) {
        ctx.session.cas = {
          user: '156260767',
          st: 'st',
        };
        yield next;
      }));
    });

    utils.getRequest(reqUrl).then((response) => {
      expect(response.status).to.equal(200);
      done();
    });
  });

  it('proxy模型,session中有st,无pgt,302', function(done) {
    casClientFactory(app, {
      hooks,
      logger,
    }, function(app) {
      app.use(function(req, res, next) {
        req.session.st = 'st';
        req.session.cas = {
          userId: '156260767',
        };
        req.session.save(function(err) {
          if (err) throw err;
          next();
        });

      });
    });

    utils.getRequest(reqUrl, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(302);
      done();
    });
  });

  it('proxy模型,session中有st,无pgt,POST请求, 302', function(done) {
    casClientFactory(app, {
      // paths: {
      //   proxyCallback: null
      // },
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
        return function() {};
      },
    }, function(app) {
      app.use(function(req, res, next) {
        req.session.st = 'st';
        req.session.cas = {
          userId: '156260767',
        };
        req.session.save(function(err) {
          if (err) throw err;
          next();
        });

      });
    });

    app.post('/', function(req, res) {
      res.send('ok');
    });

    utils.postRequest(reqUrl, {}, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(302);
      done();
    });
  });

  it('proxy模型,session中有st,有pgt,正常响应', function(done) {
    casClientFactory(app, {
      // paths: {
      //   proxyCallback: null
      // },
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
        return function() {};
      },
    }, function(app) {
      app.use(function(req, res, next) {
        req.session.cas = {
          userId: '156260767',
          st: 'st',
          pgt: 'pgt',
        };
        req.session.save(function(err) {
          if (err) throw err;
          next();
        });

      });
    });

    utils.getRequest(reqUrl, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(200);
      done();
    });
  });

  it('身份无效, 但是有fetch头, 响应418', function(done) {
    casClientFactory(app, {
      fromAjax: {
        header: 'x-client-ajax',
        status: 418,
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
        return function() {};
      },
    });

    utils.getRequest(reqUrl, {
      headers: {
        'x-client-ajax': 'fetch',
      },
    }, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(418);
      done();
    });
  });

  it('配置ignore字符串规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        '/',
      ],
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
        return function() {};
      },
    });

    utils.getRequest(reqUrl, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(200);
      done();
    });
  });

  it('配置ignore正则规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        /\//,
      ],
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
        return function() {};
      },
    });

    utils.getRequest(reqUrl, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(200);
      done();
    });
  });

  it('配置ignore函数规则,匹配跳过cas鉴权', function(done) {
    casClientFactory(app, {
      ignore: [
        function(pathname, req) {
          if (pathname === '/') return true;
        },
      ],
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
        return function() {};
      },
    });

    utils.getRequest(reqUrl, function(err, response) {
      if (err) throw err;
      expect(response.status).to.equal(200);
      done();
    });
  });

  afterEach(function() {
    app = null;
    server.close();
    server = null;
  });
});
