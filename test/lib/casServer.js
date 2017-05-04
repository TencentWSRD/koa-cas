/**
 * Simple CAS server implement for test case.
 *
 */
const session = require('koa-generic-session');
const convert = require('koa-convert');
const bodyParser = require('koa-bodyparser');
const cookie = require('koa-cookie');
const Router = require('koa-router');
const json = require('koa-json');
const uuid = require('uuid');
const utils = require('../../lib/utils');
const url = require('url');
const qs = require('querystring');

// var st = uuid.v4();
// var pgtIou = 'PGTIOU-3-cyz9mq6SaNYsGXj7BEO2-login.rdm.org';
// var pgtId = uuid.v4();

function getSuccessResponse(pgtIou) {
  let res = `
  <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'> +
    <cas:authenticationSuccess>
    <cas:user>DEFAULT_USER_NAME</cas:user>
  `;

  if (pgtIou) res += `<cas:proxyGrantingTicket>${pgtIou}</cas:proxyGrantingTicket>`;

  res += '</cas:authenticationSuccess></cas:serviceResponse > ';

  return res;
}

function getFailResponse(st) {
  return `
      <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:authenticationFailure code='INVALID_TICKET'>
      未能够识别出目标 &#039;${st}&#039;票根
      </cas:authenticationFailure>
      </cas:serviceResponse>
    `;
}

function getSuccessProxyResponse(pt) {
  const res = `
    <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
    <cas:proxySuccess>
  <cas:proxyTicket>${pt}</cas:proxyTicket>
  </cas:proxySuccess>
  </cas:serviceResponse>`;

  return res;
}

function getFailProxyResponse(status, pgtId) {
  let res = '';
  pgtId = pgtId || 'TGT--EiiRpxOYfq2PZNjK7jBMiID9Wy55YUFRvVNLXbKDXZNQtXVpjn-login.rdm.org';
  switch (status) {
    case 'success':
      res = `
        <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:proxySuccess>
    <cas:proxyTicket>ST-77742-NZGCCAKlSCwLfaVBhpch-login.rdm.org</cas:proxyTicket>
    </cas:proxySuccess>
    </cas:serviceResponse>`;
      break;
    case 'invalidPgt':
      res = `
        <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
      <cas:proxyFailure code='INVALID_TICKET'>
      未能够识别出目标 &#039;${pgtId}&#039;票根
    </cas:proxyFailure>
    </cas:serviceResponse>`;
      break;
    case 'emptyPgt':
      res = `
        <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
        <cas:proxyFailure code='INVALID_REQUEST'>
        必须同时提供&#039;pgt&#039;和&#039;targetService&#039;参数
        </cas:proxyFailure>
        </cas:serviceResponse>`;
      break;
    case 'emptyRequest':
    case 'emptyTargetService':
    default:
      res = `
        <cas:serviceResponse xmlns:cas='http://www.yale.edu/tp/cas'>
        <cas:proxyFailure code='INVALID_REQUEST'>
        必须同时提供&#039;pgt&#039;和&#039;targetService&#039;参数
        </cas:proxyFailure>
        </cas:serviceResponse>`;
      break;
  }

  return res;
}

function getRestletIntegrationPGT(pgt) {
  pgt = pgt || 'TGT-2-c9av4cPM1ig7e5DZEiCBZjAATXspVuoDZVqDkvo9aSJabRReb-login.rdm.org';
  const res = `<!DOCTYPE HTML PUBLIC "-//IETF//DTD HTML 2.0//EN">
    <html>
    <head>
    <title>201 The requesst has been fulfilled and resulted in a new resource being created</title>
  </head>
  <body>
  <h1>TGT Created</h1>
  <form action="http://remdev.oa.com/buglycas/vi/tickets/${pgt}" method="POST">Service:
  <input type="text" name="service" value="">
    <br>
    <input type="submit" value="Submit">
    </form>
    </body>
    </html>`;

  return res;
}

function initTgt() {
  return {
    st: {},
    pt: {},
  };
}

function initTicket(service) {
  return {
    valid: true,
    service,
  };
}

/*
 *
 * @param {Express} app
 * @param options
 * @param {Number} options.expectStatus
 * @param {String} options.expectStatusStr   Supported: fail, invalid
 * @param {*}      options.expectResponse
 * @returns {*}
 */
module.exports = (app, options) => {
  const tgts = {};
  options = options || {
    expectStatus: 200,
  };
  options.expectStatus = options.expectStatus || 200;

  app.keys = [ 'cas', 'test' ];
  app.use(convert.back(cookie.default('here is some secret')));
  app.use(session({
    key: 'SESSIONID', // default "koa:sess"
    store: session.MemoryStore(),
  }));
  app.use(bodyParser());
  app.use(convert.back(json()));

  const router = new Router();
  router.get('/cas/serviceValidate', function* () {
    if (options.expectStatus !== 200) {
      this.status = options.expectStatus;
      return;
    }
    if (options.expectStatusStr === 'fail') {
      this.status = 200;
      this.body = getFailResponse('xxx');
      return;
    }
    if (options.expectStatusStr === 'invalid') {
      this.status = 200;
      this.body = 'i am a invalid xml';
      return;
    }
    if (this.query) {
      if (!this.query.ticket || !this.query.service) {
        this.body = getFailResponse('xxx');
        return;
      }
      const ticket = this.query.ticket;
      const service = this.query.service;
      let finded = false;
      let tgtId;
      let tgt; // eslint-disable-line

      outer: // eslint-disable-line
        for (const i in tgts) {
          for (const j in tgts[i].st) {
            if (j === ticket && tgts[i].st[j].valid && tgts[i].st[j].service === service) {
              finded = true;
              tgts[i].st[j].valid = false;
              tgt = tgts[i];
              tgtId = i;
              break outer; // eslint-disable-line
            }
          }
        }

      if (!finded) {
        console.log('2');
        this.body = getFailResponse(ticket);
        return;
      }

      const pgtIou = uuid.v4();

      if (this.query.pgtUrl) {
        const proxyCallbackUrl = `${this.query.pgtUrl}?${qs.stringify({ pgtId: tgtId, pgtIou })}`;
        console.log('cas server: sending request to proxyCallback, url=', proxyCallbackUrl);
        try {
          yield utils.getRequest(proxyCallbackUrl);
          this.body = getSuccessResponse(pgtIou);
          return;
        } catch (err) {
          console.error('Error when sending request to pgtUrl', err);
        }
      } else {
        this.body = getSuccessResponse();
        return;
      }
    }
  });

  router.get('/cas/proxy', function* () {
    if (!this.query) {
      this.body = getFailProxyResponse('emptyRequest');
      return;
    }
    if (!this.query.pgt) {
      this.body = getFailProxyResponse('emptyPgt');
    } else if (!this.query.targetService) {
      this.body = getFailProxyResponse('emptyTargetService');
    } else if (this.query.targetService === 'invalid') {
      this.body = getFailProxyResponse('emptyTargetService');
    } else if (this.query.pgt in tgts || this.query.pgt === 'fakePgtId') {
      const pt = uuid.v4();
      this.body = getSuccessProxyResponse(pt);
    } else {
      this.body = getFailProxyResponse('invalidPgt', this.query.pgt);
    }
  });

  router.get('/cas/login', function* () {
    console.log('GET /cas/login');
    if (this.query && this.query.service) {
      const pgtId = uuid.v4();
      tgts[pgtId] = initTgt();
      const st = uuid.v4();
      tgts[pgtId].st[st] = initTicket(this.query.service);
      const path = decodeURIComponent(this.query.service);
      const uri = url.parse(path, true);
      if (!uri.query) uri.query = {};
      uri.query.ticket = st;
      this.redirect(url.format(uri));
    } else {
      this.body = 'ok';
    }
  });

  router.get('/cas/logout', function* () {
    this.body = 'ok';
  });

  router.post('/cas/v1/tickets', function* () {

    const username = 'username';
    const password = 'password';
    const type = '8';
    const body = this.request.body;
    console.log('/cas/v1/tickets body: ', body);
    if (body &&
      body.username === username &&
      `${body.type}` === type &&
      body.password === password) {
      const pgtId = uuid.v4();
      tgts[pgtId] = initTgt();
      this.body = getRestletIntegrationPGT(pgtId);
    } else {
      this.status = 400;
    }
  });

  router.delete('/cas/v1/tickets/:tgt', function* () {
    if (this.params && this.params.tgt && (this.params.tgt in tgts)) {
      delete tgts[this.params.tgt];
    }
    this.status = 200;
  });

  router.get('/cas/v1/tickets', function* () {
    this.body = JSON.stringify(tgts);
  });
  app.use(router.routes()).use(router.allowedMethods());

  return app;
};
