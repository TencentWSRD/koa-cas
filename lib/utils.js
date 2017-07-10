const qs = require('query-string');
const url = require('url');
const http = require('http');
const https = require('https');
const _ = require('lodash');

/*
 * Return `true` when pathname match the rule.
 *
 * @param ctx
 * @param pathname
 * @param rule
 * @returns {*}
 */
function isMatchRule(ctx, pathname, rule) {
  if (typeof rule === 'string') {
    return pathname.indexOf(rule) > -1;
  } else if (rule instanceof RegExp) {
    return rule.test(pathname);
  } else if (typeof rule === 'function') {
    return rule(pathname, ctx);
  }
  throw new Error('Unsupport rule: ', rule);
}

/*
 * 获取去掉ticket参数后的完整路径
 *
 * @param ctx
 * @param options
 * @returns {string}
 */
function getOrigin(ctx, options) {
  const query = ctx.query;
  if (query.ticket) delete query.ticket;
  const querystring = qs.stringify(query);
  if (!options) {
    throw new Error('no options!!!');
  }

  return options.servicePrefix + url.parse(ctx.originalUrl, true).pathname + (querystring ? `?${querystring}` : '');
}

/*
 * Check options.match first, if match, return `false`, then check the options.ignore, if match, return `true`.
 *
 * If returned `true`, then this request will bypass CAS directly.
 *
 * @param ctx
 * @param options
 * @param logger
 */
function shouldIgnore(ctx, options) {
  const logger = getLogger(ctx, options);
  if (options.match && options.match.splice && options.match.length) {
    let matchedRule;
    const hasMatch = options.match.some((rule) => {
      matchedRule = rule;
      return isMatchRule(ctx, ctx.path, rule);
    });

    if (hasMatch) {
      logger.info('Matched match rule.', matchedRule, ' Go into CAS authentication.');
      return false;
    }

    return true;
  }

  if (options.ignore && options.ignore.splice && options.ignore.length) {
    let matchedIgnoreRule;
    const hasMatchIgnore = options.ignore.some((rule) => {
      matchedIgnoreRule = rule;
      return isMatchRule(ctx, ctx.path, rule);
    });

    if (hasMatchIgnore) {
      logger.info('Matched ignore rule.', matchedIgnoreRule, ' Go through CAS.');
      return true;
    }

    return false;
  }

  return false;
}

function getLastUrl(ctx, options) {
  const logger = getLogger(ctx, options);
  let lastUrl = (ctx.session && ctx.session.lastUrl) ? ctx.session.lastUrl : '/';

  const uri = url.parse(lastUrl, true);

  if (uri.pathname === options.paths.validate) lastUrl = '/';

  logger.info(`Get lastUrl: ${lastUrl}`);

  return lastUrl;
}


function sendRequest(path, options, callback) {
  const requestOptions = url.parse(path, true);
  requestOptions.method = options.method;

  if (options.headers) {
    requestOptions.headers = options.headers;
  }

  const isPost = options.method.toLowerCase() === 'post';

  if (isPost) {
    if (!requestOptions.headers) requestOptions.headers = {};

    if (!requestOptions.headers['Content-Type'] && !requestOptions.headers['content-type']) {
      requestOptions.headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    if (options.data) {
      if (typeof options.data === 'object') {
        const postData = [];
        for (const i in options.data) {
          postData.push(`${i}=${encodeURIComponent(options.data[i])}`);
        }
        options.data = postData.join('&');
      } else if (typeof options.data !== 'string') {
        return callback(new Error('Invalid type of options.data'));
      }
      requestOptions.headers['Content-Length'] = Buffer.byteLength(options.data);
    }
  }

  const chunks = [];
  const isHttps = requestOptions.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const req = (isHttps ? https : http).request(requestOptions, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        chunks.push(chunk);
      });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          body: chunks.join(''),
          header: res.headers,
        });
      });
    });

    req.on('error', (e) => {
      console.error('sendRequest on error', e, path, options);
      reject(e);
    });

    if (isPost && options.data) {
      req.write(options.data);
    }

    req.end();
  });
}


/*
 * Send a GET request
 * @param path
 * @param {Object} options (Optional)
 */
function getRequest(path, options = {}) {
  if (typeof options === 'function') {
    options = {
      method: 'get',
    };
  } else {
    options.method = 'get';
  }

  if (options.params) {
    const uri = url.parse(path, true);
    uri.query = _.merge({}, uri.query, options.params);
    path = url.format(uri);
    delete options.params;
  }

  return sendRequest(path, options);
}

function postRequest(path, data, options = {}) {
  if (typeof options === 'function') {
    options = {
      method: 'post',
      data,
    };
  } else {
    options.method = 'post';
    options.data = data;
  }
  return sendRequest(path, options);
}

function deleteRequest(path) {
  return sendRequest(path, {
    method: 'delete',
  });
}

function getValidateUrl(options) {
  const {
    servicePrefix,
    paths,
  } = options;
  const uri = url.parse(servicePrefix);
  let path = '';
  if (uri.pathname && uri.pathname !== '/' && paths.validate.startsWith(uri.pathname)) {
    path = servicePrefix.replace(uri.pathname, '') + paths.validate;
  } else {
    path = servicePrefix + paths.validate;
  }
  return path;
}

function getPath(name, options) {
  if (!name || !options) return '';
  let path = '';

  switch (name) {
    case 'login':
      path = `${options.serverPath + options.paths.login}?service=${encodeURIComponent(getValidateUrl(options))}`;
      break;
    case 'logout':
      path = `${options.serverPath + options.paths.logout}?service=${encodeURIComponent(getValidateUrl(options))}`;
      break;
    case 'pgtUrl': {
      const {
          servicePrefix,
          paths,
        } = options;
      const proxyCallbackUri = url.parse(paths.proxyCallback, true);
      if (proxyCallbackUri.protocol && proxyCallbackUri.host) {
        path = paths.proxyCallback;
      } else {
        const uri = url.parse(servicePrefix, false);
        if (uri.pathname && uri.pathname !== '/' && paths.proxyCallback.startsWith(uri.pathname)) {
          path = servicePrefix.replace(uri.pathname, '') + paths.proxyCallback;
        } else {
          path = servicePrefix + paths.proxyCallback;
        }
      }
      break;
    }
    case 'serviceValidate':
      path = options.serverPath + options.paths.serviceValidate;
      break;
    case 'proxy':
      path = options.serverPath + options.paths.proxy;
      break;
    case 'service':
    case 'validate':
      path = getValidateUrl(options);
      break;
    case 'restletIntegration':
      path = options.serverPath + options.paths.restletIntegration;
      break;
    default:
      throw new Error(`utils.getPath argv name = ${name} is not support`);
  }
  return path;
}

function toArray(arrayLike) {
  if (!arrayLike) return [];
  return Array.prototype.slice.call(arrayLike);
}

function getLogger(ctx, options) {
  const factory = (options && (typeof options.logger === 'function')) ? options.logger : function (ctx, type) {
    if (console[type] !== undefined) {
      return console[type].bind(console[type]);
    }
    return console.log.bind(console.log);
  };

  // console.info(factory(ctx, 'log').toString());

  return {
    access: factory(ctx, 'access'),
    debug: factory(ctx, 'log'),
    info: factory(ctx, 'log'),
    error: factory(ctx, 'error'),
    warn: factory(ctx, 'warn'),
    log: factory(ctx, 'log'),
  };
}

module.exports = {
  sendRequest,
  getLogger,
  toArray,
  getLastUrl,
  getOrigin,
  shouldIgnore,
  deleteRequest,
  getRequest,
  postRequest,
  getPath,
  isMatchRule,
};
