import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fields, relatedFields, reasons, qualityUniquenessMeta, qualitySourceFields } from './fields.mjs';
import { parseQuery, parseQualityQuery } from './query.mjs';
import { isRequestAllowed } from './access.mjs';

const host = process.env.U8_LISTEN_HOST || '127.0.0.1';
if (!['127.0.0.1','0.0.0.0'].includes(host)) throw new Error('U8_LISTEN_HOST is invalid.');
const port = Number(process.env.U8_QUERY_PORT || 3088);
const publicPort = Number(process.env.U8_PUBLIC_PORT || port);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('U8_QUERY_PORT is invalid.');
if (!Number.isInteger(publicPort) || publicPort < 1024 || publicPort > 65535) throw new Error('U8_PUBLIC_PORT is invalid.');
const bridgePath = fileURLToPath(new URL('./scripts/read-query.ps1', import.meta.url));
const staticRoutes = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/quality-uniqueness', ['quality-uniqueness.html', 'text/html; charset=utf-8']],
  ['/quality-uniqueness.js', ['quality-uniqueness.js', 'text/javascript; charset=utf-8']],
  ['/quality-uniqueness.css', ['quality-uniqueness.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]
]);
let activeQueries = 0;
const databaseDriver = process.env.U8_DB_DRIVER || (process.platform === 'win32' ? 'powershell' : 'node');
if (!['node','powershell'].includes(databaseDriver)) throw new Error('U8_DB_DRIVER is invalid.');
const nodeDatabase = databaseDriver === 'node' ? await import('./database.mjs') : null;
async function queryDatabase(operation, filters = {}) {
  if (activeQueries >= 3) return Promise.reject(Object.assign(new Error('查询繁忙，请稍后重试。'), { status: 429 }));
  if (nodeDatabase) {
    activeQueries++;
    try { return await nodeDatabase.queryDatabase(operation,filters); }
    catch { throw Object.assign(new Error('数据库查询暂不可用，请稍后重试。'),{status:503}); }
    finally { activeQueries--; }
  }
  activeQueries++;
  return new Promise((resolve, reject) => {
    const child = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', bridgePath], { windowsHide: true, timeout: 20000, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
      activeQueries--;
      if (error) return reject(Object.assign(new Error('数据库查询暂不可用，请稍后重试。'), { status: 503 }));
      try {
        const result = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
        if (!result.ok) throw new Error('Database query failed');
        resolve(result);
      } catch { reject(Object.assign(new Error('数据库查询暂不可用，请稍后重试。'), { status: 503 })); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ operation, filters }));
  });
}
function reply(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type, 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  });
  response.end(typeof body === 'object' && !Buffer.isBuffer(body) ? JSON.stringify(body) : body);
}
const server = http.createServer(async (request, response) => {
  try {
    if (!isRequestAllowed(request.headers, { listenHost: host, port, publicPort })) return reply(response, 403, { error: '请使用本服务 IP 地址或 localhost，并从同一地址访问。' });
    if (request.method !== 'GET') return reply(response, 405, { error: '此服务仅提供只读查询。' });
    const url = new URL(request.url, `http://${host}:${port}`);
    if (url.pathname === '/favicon.ico') return reply(response, 204, '', 'image/x-icon');
    if (url.pathname === '/api/schema') return reply(response, 200, { fields, relatedFields, reasons, timeZone: 'UTC+8', database: 'UFDATA_333_2025' });
    if (url.pathname === '/api/health') return reply(response, 200, await queryDatabase('health'));
    if (['/api/quality-uniqueness','/api/quality-uniqueness/details'].includes(url.pathname)) {
      const details=url.pathname.endsWith('/details');let filters;
      try {filters=parseQualityQuery(url.searchParams,details);} catch(error){return reply(response,400,{error:error.message});}
      const result=await queryDatabase(details?'quality-uniqueness-details':'quality-uniqueness',filters);
      return reply(response,200,details?{...result,fields:qualitySourceFields}:{...result,meta:qualityUniquenessMeta});
    }
    if (url.pathname === '/api/quality-alerts') {
      if (url.search) return reply(response,400,{error:'全量质量告警不接受筛选参数。'});
      const result = await queryDatabase('list', {qualityCheck:'different',page:1,pageSize:100});
      return reply(response,200,{ok:true,total:result.totals.total,rows:result.rows,checkedAtUtc8:result.checkedAtUtc8,limit:100,hasMore:result.totals.total>100,timeZone:'UTC+8'});
    }
    if (url.pathname === '/api/mappings') {
      let filters;
      try { filters = parseQuery(url.searchParams); }
      catch (error) { return reply(response, 400, { error: error.message }); }
      return reply(response, 200, await queryDatabase('list', filters));
    }
    const staticFile = staticRoutes.get(url.pathname);
    if (staticFile) return reply(response, 200, await readFile(new URL(`./public/${staticFile[0]}`, import.meta.url)), staticFile[1]);
    return reply(response, 404, { error: '页面不存在。' });
  } catch (error) { reply(response, error.status || 500, { error: error.status ? error.message : '服务暂不可用，请稍后重试。' }); }
});
server.requestTimeout = 25000;
server.headersTimeout = 10000;
server.listen(port, host, () => console.log(`U8 stock order query ready: http://${host}:${port}`));
server.on('error', error => { console.error(`U8 query service startup failed: ${error.code || 'UNKNOWN'}`); process.exitCode = 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(async () => {await nodeDatabase?.closeDatabase();}));
