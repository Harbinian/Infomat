import http from 'node:http';
import { isIPv4 } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Store } from './store.mjs';
import { executeCommand, getPublicState, importMaterials, ReviewError } from './domain.mjs';

const appDir = fileURLToPath(new URL('.', import.meta.url));
const loopbackHosts = ['127.0.0.1', 'localhost'];
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
const vendors = {
  '/vendor/cytoscape.min.js': ['cytoscape/dist/cytoscape.min.js'],
  '/vendor/dagre.min.js': ['@dagrejs/dagre/dist/dagre.min.js', 'dagre/dist/dagre.min.js'],
  '/vendor/cytoscape-dagre.js': ['cytoscape-dagre/cytoscape-dagre.js']
};
const json = (response, status, body, extraHeaders = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  response.end(JSON.stringify(body));
};
const deny = (message, code = 'FORBIDDEN', status = 403) => { throw new ReviewError(message, code, status); };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function validateHost(request, allowedHosts) {
  const host = request.headers.host;
  const match = /^(localhost|(?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?$/.exec(host || '');
  if (!match || !allowedHosts.includes(match[1])) deny('访问地址未列入评审服务的允许清单', 'INVALID_HOST');
  if (Number(match[2] || 80) !== request.socket.localPort) deny('访问端口与评审服务不一致', 'INVALID_HOST');
  return `http://${host}`;
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') deny('请求必须使用 application/json', 'CONTENT_TYPE', 415);
  let bytes = 0; const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 64 * 1024 * 1024) deny('请求内容过大', 'BODY_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) deny('请求内容必须为 JSON 对象', 'INVALID_JSON', 400);
    return body;
  } catch (error) {
    if (error instanceof ReviewError) throw error;
    deny('请求不是有效 JSON', 'INVALID_JSON', 400);
  }
}

export function createApp({ dataDir, store = new Store({ dataDir }), publicDir = path.join(appDir, 'public'),
  allowedHosts = loopbackHosts, network = 'loopback' } = {}) {
  const sessions = new Map();
  const sessionCookie = request => String(request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith('review_session='))?.slice('review_session='.length);
  const sessionFor = request => {
    const cookie = sessionCookie(request);
    const session = cookie && sessions.get(cookie);
    if (!session || session.expiresAt < Date.now()) { if (cookie) sessions.delete(cookie); return null; }
    return session;
  };
  const sessionResult = session => {
    const state = store.read();
    return { users: state.users, currentUser: session ? state.users.find(user => user.id === session.userId) || null : null, csrfToken: session?.csrfToken || '', mode: 'local-isolated', network };
  };

  async function staticFile(pathname, response) {
    let filename;
    if (vendors[pathname]) {
      for (const candidate of vendors[pathname]) {
        const candidatePath = path.join(appDir, 'node_modules', candidate);
        try { if ((await stat(candidatePath)).isFile()) { filename = candidatePath; break; } } catch { /* A missing optional alias is tried next. */ }
      }
      if (!filename) deny('本地前端依赖尚未安装', 'STATIC_NOT_FOUND', 404);
    } else {
      const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
      if (!relative || relative.split(/[\\/]/).some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.')) || !MIME[path.extname(relative)]) deny('页面不存在', 'NOT_FOUND', 404);
      let publicRoot;
      try { publicRoot = await realpath(publicDir); filename = await realpath(path.resolve(publicDir, relative)); } catch { deny('页面不存在', 'NOT_FOUND', 404); }
      if (!filename.startsWith(`${publicRoot}${path.sep}`) || !(await stat(filename)).isFile()) deny('页面不存在', 'NOT_FOUND', 404);
    }
    const content = await readFile(filename);
    response.writeHead(200, { 'Content-Type': MIME[path.extname(filename)] || 'application/octet-stream' });
    response.end(content);
  }

  async function handler(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    try {
      const origin = validateHost(request, allowedHosts);
      if (request.method !== 'GET' && request.method !== 'POST') deny('不支持此请求方法', 'METHOD_NOT_ALLOWED', 405);
      if (!request.url?.startsWith('/') || request.url.startsWith('//')) deny('请求路径无效', 'INVALID_PATH', 400);
      let pathname;
      try { pathname = decodeURIComponent(request.url.split('?')[0]); } catch { deny('请求路径编码无效', 'INVALID_PATH', 400); }
      if (pathname.includes('\0') || pathname.includes('\\') || pathname.split('/').some(segment => segment === '..' || segment === '.')) deny('请求路径无效', 'INVALID_PATH', 400);
      const session = sessionFor(request);
      if (request.method === 'POST') {
        if (request.headers.origin !== origin) deny('写入请求必须来自当前评审服务页面', 'INVALID_ORIGIN');
        if (request.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(request.headers['sec-fetch-site'])) deny('不允许跨站写入', 'INVALID_ORIGIN');
      }
      if (pathname === '/api/health' && request.method === 'GET') {
        json(response, 200, { service: 'process-review-service', version: '0.1.0', mode: 'local-isolated', storage: 'isolated-sqlite', formalIntegration: false, network }); return;
      }
      if (pathname === '/api/session') {
        if (request.method === 'GET') { json(response, 200, sessionResult(session)); return; }
        const body = await readJson(request);
        if (body.userId === '') {
          sessions.delete(sessionCookie(request));
          json(response, 200, sessionResult(null), { 'Set-Cookie': 'review_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' }); return;
        }
        const state = store.read();
        if (!state.users.some(user => user.id === body.userId)) deny('演练身份不存在', 'INVALID_USER', 400);
        for (const [key, value] of sessions) if (value.expiresAt < Date.now()) sessions.delete(key);
        if (sessions.size >= 1000) deny('本机演练会话过多', 'SESSION_LIMIT', 429);
        const token = randomBytes(32).toString('hex');
        const created = { userId: body.userId, csrfToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + 12 * 60 * 60 * 1000 };
        sessions.set(token, created);
        json(response, 200, sessionResult(created), { 'Set-Cookie': `review_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` }); return;
      }
      if (!pathname.startsWith('/api/')) {
        if (request.method !== 'GET') deny('页面不存在', 'NOT_FOUND', 404);
        await staticFile(pathname, response); return;
      }
      if (!session) deny('请先选择本地演练身份', 'AUTH_REQUIRED', 401);
      if (request.method === 'POST' && !equal(request.headers['x-review-csrf'], session.csrfToken)) deny('会话校验已变化，请核对身份后重试', 'INVALID_CSRF');
      if (pathname === '/api/bootstrap' && request.method === 'GET') { json(response, 200, getPublicState(store.read(), session.userId)); return; }
      const materialMatch = pathname.match(/^\/api\/materials\/([A-Za-z0-9-]+)$/);
      if (materialMatch && request.method === 'GET') {
        const metadata = store.read().materials.find(material => material.id === materialMatch[1]);
        if (!metadata) deny('材料不存在', 'NOT_FOUND', 404);
        json(response, 200, { ...metadata, ...store.material(metadata.id) }); return;
      }
      if (pathname === '/api/commands' && request.method === 'POST') {
        const body = await readJson(request);
        const state = executeCommand(store, { type: body.type, payload: body.payload, expectedRevision: body.expectedRevision, actorId: session.userId });
        json(response, 200, { state: getPublicState(state, session.userId) }); return;
      }
      if (pathname === '/api/import' && request.method === 'POST') {
        const body = await readJson(request);
        const state = importMaterials(store, { files: body.files, expectedRevision: body.expectedRevision, actorId: session.userId });
        json(response, 200, { state: getPublicState(state, session.userId) }); return;
      }
      if (pathname === '/api/export' && request.method === 'GET') {
        const state = getPublicState(store.read(), session.userId);
        json(response, 200, { format: 'process-review-local-export-v1', mode: 'local-isolated', exportedAt: new Date().toISOString(), ...state, materials: state.materials.map(material => ({ ...material, ...store.material(material.id) })) }, { 'Content-Disposition': 'attachment; filename="process-review-local-export.json"' }); return;
      }
      deny('接口不存在', 'NOT_FOUND', 404);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      const known = error instanceof ReviewError;
      json(response, known ? error.status : 500, { error: known ? error.message : '本地服务处理失败，本次操作未确认保存', code: known ? error.code : 'INTERNAL_ERROR' });
    }
  }
  return { handler, store, close: () => { sessions.clear(); store.close(); } };
}

export async function startServer({ port = Number(process.env.REVIEW_PORT || 3090), dataDir = process.env.REVIEW_DATA_DIR,
  host = '127.0.0.1', lanHosts = [], ...options } = {}) {
  const lanEnabled = host === '0.0.0.0' && lanHosts.length > 0 && lanHosts.every(address =>
    isIPv4(address) && /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(address));
  if ((!lanEnabled && host !== '127.0.0.1') || !Number.isInteger(port) || port < 0 || port > 65535 || [3000, 3001].includes(port)) {
    throw new ReviewError('默认仅监听 127.0.0.1。全地址监听须明确配置局域网 IPv4，禁止使用 3000/3001', 'INVALID_LISTEN');
  }
  const network = lanEnabled ? 'lan' : 'loopback';
  const allowedHosts = lanEnabled ? [...loopbackHosts, ...lanHosts] : loopbackHosts;
  const app = createApp({ dataDir, ...options, allowedHosts, network });
  const server = http.createServer(app.handler);
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); }); }
  catch (error) { app.close(); throw error; }
  return { server, store: app.store, port: server.address().port, close: async () => { server.closeIdleConnections(); await new Promise(resolve => server.close(resolve)); app.close(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const host = process.env.REVIEW_BIND_HOST || '127.0.0.1';
    const lanHosts = (process.env.REVIEW_LAN_IP || '').split(',').map(address => address.trim()).filter(Boolean);
    const running = await startServer({ host, lanHosts });
    console.log(`Isolated process review listening on ${host}:${running.port} (synthetic rehearsal identities)`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await running.close(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  } catch (error) { console.error(error.code === 'EADDRINUSE' ? 'Review port is already in use; no existing service was stopped.' : error.message); process.exitCode = 1; }
}
