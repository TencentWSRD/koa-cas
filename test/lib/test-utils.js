import {
  expect,
} from 'chai';
const hideLog = false;

export const hooks = {
  * before(ctx) {
    ctx.start = Date.now();
  },
  * after(ctx) {
    console.log(`after hook: costTime=${Date.now() - ctx.start} ms. `);
    expect(ctx.start).to.not.be.empty;
  },
};

export const logger = hideLog ? null : (req, type) => {
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
      return console.log.bind(console, type, '[CONNECT-CAS]::');
  }
};

export const sessionStHook = (app) => {
  app.use(function* (next) {
    this.session.cas = {
      user: '156260767',
      st: 'st',
    };
    yield next;
  });
};

export const sessionStAndPgtHook = (app) => {
  app.use(function* (next) {
    this.session.cas = {
      user: '156260767',
      st: 'st',
      pgt: 'pgt',
    };
    yield next;
  });
};
