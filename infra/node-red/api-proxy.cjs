const http = require('node:http');
const routes = [
  ['GET', /^\/(me|state|health|audit|emr\/records)$/],
  ['GET', /^\/patients\/[^/]+\/(history|care)$/],
  ['GET', /^\/requests\/[^/]+\/events$/],
  ['GET', /^\/export\/[^/]+$/],
  ['POST', /^\/(login|logout|emr\/confirm|emr\/care|assignments\/swap)$/],
  ['POST', /^\/requests\/[^/]+\/transition$/],
  ['POST', /^\/devices\/[^/]+\/call$/],
  ['PUT', /^\/devices\/[^/]+\/scenario$/],
  ['PUT', /^\/rules$/],
];
module.exports = function createProxy(base = process.env.HEALTH_API_URL || 'http://api:3000') {
  const upstream = new URL(base);
  if (upstream.protocol !== 'http:') throw new Error('Internal HEALTH_API_URL must use HTTP');
  return function healthApiProxy(req, res, next) {
    if (!req.url.startsWith('/health-api/')) return next();
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname.slice('/health-api'.length);
    const fail = (status, error) => {
      if (res.headersSent) return res.destroy();
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error }));
    };
    if (!routes.some(([method, pattern]) => method === req.method && pattern.test(path)))
      return fail(404, 'API không được công bố qua dashboard');
    if (!['GET', 'HEAD'].includes(req.method) && req.headers.origin) {
      try {
        if (new URL(req.headers.origin).host !== req.headers.host)
          return fail(403, 'Origin không hợp lệ');
      } catch {
        return fail(403, 'Origin không hợp lệ');
      }
    }
    // Forward only the user's session. No shared nurse/admin or ingest token is used.
    const session = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith('ff_health_session='));
    const headers = { host: req.headers.host, accept: 'application/json' };
    if (session) headers.cookie = session.replace(/^ff_health_session=/, 'health_session=');
    for (const key of ['origin', 'content-type', 'content-length'])
      if (req.headers[key]) headers[key] = req.headers[key];
    const request = http.request(
      {
        hostname: upstream.hostname,
        port: upstream.port || 80,
        path: '/api' + path + url.search,
        method: req.method,
        headers,
      },
      (response) => {
        const outgoing = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
        for (const key of ['content-type', 'content-disposition'])
          if (response.headers[key]) outgoing[key] = response.headers[key];
        if (response.headers['set-cookie'])
          outgoing['set-cookie'] = response.headers['set-cookie'].map((cookie) =>
            cookie
              .replace(/^health_session=/, 'ff_health_session=')
              .replace(/;\s*Path=[^;]*/i, '; Path=/health-api')
          );
        res.writeHead(response.statusCode, outgoing);
        response.on('error', () => res.destroy());
        response.pipe(res);
      }
    );
    request.setTimeout(7000, () => request.destroy(new Error('Upstream timeout')));
    request.on('error', () => fail(502, 'Không kết nối được backend. Vui lòng thử lại.'));
    req.on('aborted', () => request.destroy());
    // Node-RED versions may invoke middleware before or after body parsing.
    if (req.readableEnded) {
      const body = req.body === undefined ? '' : JSON.stringify(req.body);
      request.removeHeader('content-length');
      request.end(body);
    } else req.pipe(request);
  };
};
