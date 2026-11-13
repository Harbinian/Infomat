// Inputs: the fixed application catalog and PORTAL_* runtime settings.
// Serves portal assets and read-only webpage probes. No database, Docker API or file writes.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';

const catalog = JSON.parse(await readFile(new URL('./services.json', import.meta.url), 'utf8'));
const ids = new Set();
for (const item of catalog) {
  if (!/^[a-z][a-z0-9-]+$/.test(item.id) || ids.has(item.id) ||
      !Number.isInteger(item.port) || item.port < 1 || item.port > 65535 ||
      !/^\/(?!\/)/.test(item.path) || /[\\\r\n?#]/.test(item.path) ||
      !['host', 'loopback', 'fixed'].includes(item.access) || !item.pageMarker ||
      (item.access === 'fixed' && !/^[\d.]+$/.test(item.host))) {
    throw new Error('Invalid portal catalog');
  }
  ids.add(item.id);
}

export const services = catalog.map(({ pageMarker, ...item }) => item);

export function fetchWebpage(url, { signal, headers }) {
  return new Promise((resolve, reject) => {
    // The Docker gateway is transport only; preserve the host-side entry authority for Host validation.
    const request = http.request(url, { method: 'GET', signal, headers: { ...headers, host: `127.0.0.1:${url.port}` } }, incoming => {
      try {
        const empty = [204, 205, 304].includes(incoming.statusCode);
        if (empty) incoming.resume();
        resolve(new Response(empty ? null : Readable.toWeb(incoming), { status: incoming.statusCode, headers: incoming.headers }));
      } catch (error) {
        incoming.destroy();
        reject(error);
      }
    });
    request.on('error', reject);
    request.on('upgrade', (_response, socket) => { socket.destroy(); reject(new Error('Unexpected protocol upgrade')); });
    request.end();
  });
}

export async function probeService(item, { host = '127.0.0.1', fetcher = fetchWebpage, timeout = 3000 } = {}) {
  const start = performance.now();
  const origin = `http://${host.includes(':') ? `[${host}]` : host}:${item.port}`;
  let url = new URL(item.path, origin);
  const signal = AbortSignal.timeout(timeout);
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await fetcher(url, { signal, redirect: 'manual', headers: { Accept: 'text/html' } });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!location) break;
        const next = new URL(location, url);
        // A webpage probe must never become a request to another service or an external site.
        if (next.origin !== url.origin) break;
        url = next;
        continue;
      }
      if (!response.ok || !response.headers.get('content-type')?.includes('text/html')) {
        await response.body?.cancel();
        return { id: item.id, state: 'unexpected', httpStatus: response.status };
      }
      const reader = response.body?.getReader();
      let prefix = '';
      let bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (reader && bytes < 65536) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          prefix += decoder.decode(value.subarray(0, 65536 - (bytes - value.byteLength)), { stream: true });
          if (prefix.includes(item.pageMarker)) break;
        }
      } finally {
        await reader?.cancel();
      }
      return {
        id: item.id, state: prefix.includes(item.pageMarker) ? 'reachable' : 'unexpected',
        httpStatus: response.status, durationMs: Math.round(performance.now() - start)
      };
    }
    return { id: item.id, state: 'unexpected' };
  } catch {
    return { id: item.id, state: 'unreachable' };
  }
}

export function createStatusReader({ items = catalog, host, fetcher, ttl = 30000 } = {}) {
  let cached;
  let pending;
  let checkedAt = 0;
  return async () => {
    if (cached && Date.now() - checkedAt < ttl) return cached;
    if (!pending) {
      pending = Promise.all(items.map(item => probeService(item, { host, fetcher })))
        .then(results => {
          checkedAt = Date.now();
          cached = { checkedAt: new Date(checkedAt).toISOString(), scope: 'webpage', services: results };
          return cached;
        }).finally(() => { pending = undefined; });
    }
    return pending;
  };
}

const staticFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']]
]);

export function createPortalServer({ probeHost = '127.0.0.1', statusReader = createStatusReader({ host: probeHost }) } = {}) {
  return http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    response.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(request.method)) {
      response.writeHead(405, { Allow: 'GET, HEAD' });
      response.end();
      return;
    }
    try {
      const path = new URL(request.url, 'http://portal.local').pathname;
      let body;
      let contentType = 'application/json; charset=utf-8';
      if (path === '/api/health') body = JSON.stringify({ status: 'ok', service: 'infomat-portal', version: '1.0.0' });
      else if (path === '/api/services') body = JSON.stringify({ services });
      else if (path === '/api/status') body = JSON.stringify(await statusReader());
      else if (staticFiles.has(path)) {
        const [filename, type] = staticFiles.get(path);
        body = await readFile(new URL(`./public/${filename}`, import.meta.url));
        contentType = type;
      } else {
        response.writeHead(404);
        response.end('Not found');
        return;
      }
      response.writeHead(200, { 'Content-Type': contentType });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      response.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify({ error: 'PORTAL_UNAVAILABLE' }));
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORTAL_PORT || 8080);
  const bindHost = process.env.PORTAL_BIND_HOST || '127.0.0.1';
  const server = createPortalServer({ probeHost: process.env.PORTAL_PROBE_HOST || '127.0.0.1' });
  server.listen(port, bindHost, () => console.log(`Infomat portal listening on http://${bindHost}:${port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
