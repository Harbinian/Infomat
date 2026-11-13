import http from 'node:http';
import { readFileSync } from 'node:fs';
import { isAllowedHost, json, port, responseHeaders, send } from './http-interface.mjs';

const api = new URL(process.env.REVIEW_API_ORIGIN || 'http://api:3093');
if (api.protocol !== 'http:' || api.href !== api.origin + '/') throw new Error('Invalid review API origin');

const assets = new Map([
  ['/', ['text/html; charset=utf-8', 'index.html']],
  ['/matrix', ['text/html; charset=utf-8', 'matrix.html']],
  ['/app.js', ['text/javascript; charset=utf-8', 'app.js']],
  ['/candidates.js', ['text/javascript; charset=utf-8', 'candidates.js']],
  ['/comparison.js', ['text/javascript; charset=utf-8', 'comparison.js']],
  ['/review-model.js', ['text/javascript; charset=utf-8', 'review-model.js']],
  ['/field-presentation.js', ['text/javascript; charset=utf-8', 'field-presentation.js']],
  ['/audit-ui.js', ['text/javascript; charset=utf-8', 'audit-ui.js']],
  ['/style.css', ['text/css; charset=utf-8', 'style.css']],
].map(([route, [type, file]]) => [route, [type, readFileSync(new URL(`./public/${file}`, import.meta.url))]]));

function forwardApi(request, response, path) {
  const headers = { host: request.headers.host };
  for (const header of ['origin', 'content-type', 'content-length']) {
    if (request.headers[header] !== undefined) headers[header] = request.headers[header];
  }
  const upstream = http.request({ hostname: api.hostname, port: api.port, path, method: request.method, headers }, incoming => {
    const disposition = incoming.headers['content-disposition'];
    response.writeHead(incoming.statusCode, responseHeaders(incoming.headers['content-type'] ?? 'application/json',
      disposition ? { 'Content-Disposition': disposition } : undefined));
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.setTimeout(15000, () => upstream.destroy());
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else if (!response.destroyed) json(response, 502, { message: '评审服务暂时不可用，请稍后重试。' });
  });
  request.on('error', () => upstream.destroy());
  response.on('close', () => {
    if (!response.writableFinished) upstream.destroy();
  });
  request.pipe(upstream);
}

const server = http.createServer((request, response) => {
  const host = request.headers.host;
  if (!isAllowedHost(host)) return json(response, 403, { message: '请通过评审服务的 IP 地址和端口打开页面。' });
  if (!request.url?.startsWith('/') || request.url.startsWith('//')) {
    return json(response, 400, { message: '页面地址无效。' });
  }
  const { pathname, search } = new URL(request.url, `http://${host}`);
  if (pathname.startsWith('/api/')) return forwardApi(request, response, pathname + search);
  if (request.method === 'GET' || request.method === 'HEAD') {
    if (pathname === '/favicon.ico') return send(response, 204, 'image/x-icon', '');
    const asset = assets.get(pathname);
    if (asset) return send(response, 200, ...asset);
  }
  return json(response, 404, { message: '评审页面不存在。' });
});

server.listen(port, '0.0.0.0');
