const qs = require('query-string');
const url = require('url');
const http = require('http');
const https = require('https');
const _ = require('lodash');

/*
 * Return `true` when pathname match the rule.
 *
 * @param req
 * @param pathname
 * @param rule
 * @returns {*}
 */
function isMatchRule(req, pathname, rule) {
  if (typeof rule === 'string') {
    return pathname.indexOf(rule) > -1;
  } else if (rule instanceof RegExp) {
    return rule.test(pathname);
  } else if (typeof rule === 'function') {
    return rule(pathname, req);
  }
}

/*
 * 获取去掉ticket参数后的完整路径
 *
 * @param req
 * @param options
 * @returns {string}
 */
function getOrigin(req, options) {
  const query = req.query;
  if (query.ticket) delete query.ticket;
  const querystring = qs.stringify(query);
  if (!options) {
    throw new Error('no options!!!');
  }

  return options.servicePrefix + url.parse(req.originalUrl, true).pathname + (querystring ? `?${querystring}` : '');
}

/*
 * Check options.match first, if match, return `false`, then check the options.ignore, if match, return `true`.
 *
 * If returned `true`, then this request will bypass CAS directly.
 *
 * @param req
 * @param options
 * @param logger
 */
function shouldIgnore(req, options) {
  const logger = getLogger(req, options);
  if (options.match && options.match.splice && options.match.length) {
    let matchedRule;
    const hasMatch = options.match.some(function(rule) {
      matchedRule = rule;
      return isMatchRule(req, req.path, rule);
    });

    if (hasMatch) {
      logger.info('Matched match rule.', matchedRule, ' Go into CAS authentication.');
      return false;
    }

    return true;
  }

  if (options.ignore && options.ignore.splice && options.ignore.length) {
    let matchedIgnoreRule;
    const hasMatchIgnore = options.ignore.some(function(rule) {
      matchedIgnoreRule = rule;
      return isMatchRule(req, req.path, rule);
    });

    if (hasMatchIgnore) {
      logger.info('Matched ignore rule.', matchedIgnoreRule, ' Go through CAS.');
      return true;
    }

    return false;
  }

  return false;
}

function getLastUrl(req, options) {
  const logger = getLogger(req, options);
  let lastUrl = (req.session && req.session.lastUrl) ? req.session.lastUrl : '/';

  const uri = url.parse(lastUrl, true);

  if (uri.pathname === options.paths.validate) lastUrl = '/';

  logger.info(`Get lastUrl: ${lastUrl}`);

  return lastUrl;
}

/*
 * Send a GET request
 * @param path
 * @param {Object} options (Optional)
 * @param callback
 */
function getRequest(path, options, callback) {
  if (typeof options === 'function') {
    callback = options;
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

  sendRequest(path, options, callback);
}

function postRequest(path, data, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {
      method: 'post',
      data,
    };
  } else {
    options.method = 'post';
    options.data = data;
  }

  sendRequest(path, options, callback);
}

function deleteRequest(path, callback) {
  sendRequest(path, {
    method: 'delete',
  }, callback);
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

  const req = (isHttps ? https : http).request(requestOptions, function(res) {
    res.setEncoding('utf8');
    res.on('data', function(chunk) {
      chunks.push(chunk);
    });
    res.on('end', function() {
      callback(null, {
        status: res.statusCode,
        body: chunks.join(''),
        header: res.headers,
      });
    });
  });

  req.on('error', function(e) {
    console.error('sendRequest on error', e, path, options);
    callback(e);
  });

  if (isPost && options.data) {
    req.write(options.data);
  }

  req.end();
}

function getPath(name, options) {
  if (!name || !options) return '';
  let path = '';

  switch (name) {
    case 'login':
      path = `${options.serverPath + options.paths.login}?service=${encodeURIComponent(options.servicePrefix + options.paths.validate)}`;
      break;
    case 'logout':
      path = `${options.serverPath + options.paths.logout}?service=${encodeURIComponent(options.servicePrefix + options.paths.validate)}`;
      break;
    case 'pgtUrl': {
      const proxyCallbackUri = url.parse(options.paths.proxyCallback, true);
      path = (proxyCallbackUri.protocol && proxyCallbackUri.host) ? (options.paths.proxyCallback) : (options.servicePrefix + options.paths.proxyCallback);
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
      path = options.servicePrefix + options.paths.validate;
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

function getLogger(req, options) {
  const factory = (options && (typeof options.logger === 'function')) ? options.logger : function(req, type) {
    if (console[type] !== undefined) {
      return console[type].bind(console[type]);
    }
    return console.log.bind(console.log);
  };

  // console.info(factory(req, 'log').toString());

  return {
    access: factory(req, 'access'),
    debug: factory(req, 'log'),
    info: factory(req, 'log'),
    error: factory(req, 'error'),
    warn: factory(req, 'warn'),
    log: factory(req, 'log'),
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
