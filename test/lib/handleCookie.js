function setCookies(headers) {
  if (!headers) headers = {};

  const cookies = {};

  if ('set-cookie' in headers) {
    headers['set-cookie'].forEach(function(cookie) {
      const cookieArr = cookie.split(';');

      const keyValuePair = cookieArr[0].split('=');

      cookies[keyValuePair[0]] = keyValuePair[1];
    });
  }

  return cookies;
}

function getCookies(cookies) {
  if (!cookies) cookies = {};

  const cookieArr = [];

  for (const i in cookies) {
    cookieArr.push(`${i}=${cookies[i]}`);
  }

  return cookieArr.join('; ');
}

module.exports = {
  getCookies,
  setCookies,
};
