/**
 * Records the API calls a site makes from inside the WebView. Plugins use it
 * to reuse the site's own login (the Authorization header it sends), and the
 * log can be shared to see how a site loads data the plugin cannot reach yet.
 * Injected before the page's scripts run, so it sees their first requests.
 */
export const NETWORK_RECORDER_SCRIPT = `(function () {
  if (window.__lnrNet) return;
  var net = (window.__lnrNet = { log: [], auth: null });
  var MAX = 80;

  function readHeaders(headers) {
    if (!headers) return;
    var pairs = [];
    try {
      if (Array.isArray(headers)) pairs = headers;
      else if (typeof headers.forEach === 'function' && !headers.length)
        headers.forEach(function (v, k) { pairs.push([k, v]); });
      else pairs = Object.keys(headers).map(function (k) { return [k, headers[k]]; });
    } catch (e) {}
    pairs.forEach(function (h) {
      if (h && /^authorization$/i.test(h[0]) && h[1]) net.auth = String(h[1]);
    });
  }

  function note(url, method, body, status, text) {
    try {
      url = String(url || '');
      if (!/\\/api\\//.test(url)) return;
      var entry = { url: url.slice(0, 300), method: method || 'GET', status: status };
      if (typeof body === 'string' && body) {
        try {
          var b = JSON.parse(body);
          if (b && b.path) entry.path = String(b.path).slice(0, 300);
          if (b && b.method) entry.apiMethod = b.method;
          if (b && b.query) entry.query = b.query;
          if (b && b.headers) readHeaders(b.headers);
        } catch (e) {
          entry.body = body.slice(0, 200);
        }
      }
      if (text) entry.response = String(text).slice(0, 400);
      net.log.push(entry);
      if (net.log.length > MAX) net.log.shift();
    } catch (e) {}
  }

  var originalFetch = window.fetch;
  if (originalFetch) {
    window.fetch = function (input, init) {
      var url = typeof input === 'string' ? input : input && input.url;
      var method = (init && init.method) || (input && input.method);
      var body = init && init.body;
      readHeaders(init && init.headers);
      return originalFetch.apply(this, arguments).then(function (res) {
        try {
          res.clone().text().then(function (text) {
            note(url, method, body, res.status, text);
          });
        } catch (e) {}
        return res;
      });
    };
  }

  var open = XMLHttpRequest.prototype.open;
  var send = XMLHttpRequest.prototype.send;
  var setHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__lnr = { method: method, url: url };
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    readHeaders([[k, v]]);
    return setHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    var xhr = this;
    var info = xhr.__lnr || {};
    xhr.addEventListener('loadend', function () {
      var text;
      try { text = xhr.responseText; } catch (e) {}
      note(info.url, info.method, body, xhr.status, text);
    });
    return send.apply(this, arguments);
  };
})();
true;`;

export type NetworkLog = {
  log?: Record<string, unknown>[];
  auth?: string | null;
};

/** The recorded calls as shareable text, without the login itself. */
export const formatNetworkLog = (url: string, net?: NetworkLog) =>
  JSON.stringify(
    {
      page: url,
      signedIn: !!net?.auth,
      requests: net?.log ?? [],
    },
    null,
    1,
  ).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<token>');
