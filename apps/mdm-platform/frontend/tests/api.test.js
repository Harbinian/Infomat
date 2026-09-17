import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient, ApiError } from '../src/api.js';
import { isolatedBackend, checkDevPort, freeDevPort } from '../devBoundary.js';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('write requests reuse session cookie and CSRF without automatic write retries', async () => {
  const calls = [];
  const api = createApiClient({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return url === '/api/csrf-token' ? response(200, { csrfToken: 'synthetic-csrf' }) : response(409, { code: 'REVISION_CHANGED' });
  } });
  await assert.rejects(api.request('/api/synthetic', { method: 'POST', body: { expected_revision: 1 } }), error => error.status === 409);
  assert.deepEqual(calls.map(c => c.url), ['/api/csrf-token', '/api/synthetic']);
  assert.equal(calls[1].options.credentials, 'same-origin');
  assert.equal(calls[1].options.headers['X-CSRF-Token'], 'synthetic-csrf');
  assert.equal(calls[1].options.body, '{"expected_revision":1}');
});

test('401 expires identity except failed login; 403/409/503 give bounded Chinese feedback', async () => {
  let expired = 0;
  for (const status of [401, 403, 409, 503]) {
    const api = createApiClient({ fetchImpl: async () => response(status, { error: 'sensitive SQL must not be shown' }), onUnauthorized: () => expired++ });
    await assert.rejects(api.request('/api/org/me'), e => e instanceof ApiError && e.status === status && !e.message.includes('SQL'));
  }
  assert.equal(expired, 1);
  const api = createApiClient({ fetchImpl: async () => response(401, {}), onUnauthorized: () => expired++ });
  await assert.rejects(api.request('/api/org/login', { method: 'POST', body: {} }));
  assert.equal(expired, 1);
});

test('late response after session change cannot restore old identity', async () => {
  let resolve;
  const api = createApiClient({ fetchImpl: () => new Promise(done => { resolve = done; }) });
  const pending = api.request('/api/org/me');
  api.resetSession(); resolve(response(200, { name: 'old identity' }));
  await assert.rejects(pending, error => error.name === 'AbortError');
});

test('request cancellation differs from timeout and network errors', async () => {
  const fetchImpl = (url, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const api = createApiClient({ fetchImpl, timeoutMs: 20 });
  await assert.rejects(api.request('/api/org/me'), error => error.code === 'REQUEST_TIMEOUT');
  const controller = new AbortController(); const pending = api.request('/api/org/me', { signal: controller.signal }); controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  await assert.rejects(createApiClient({ fetchImpl: async () => { throw new Error('network'); } }).request('/api/org/me'), e => e.code === 'NETWORK_ERROR');
});

test('client cannot transmit credentials to external or path-traversing URLs', async () => {
  const api = createApiClient({ fetchImpl: () => { throw new Error('must not fetch'); } });
  for (const value of ['https://external.invalid/api', '//external.invalid/api', '/api/../elsewhere', '/api/\\external']) await assert.rejects(api.request(value), /same-origin/);
});

test('multipart uploads keep the original bytes and browser-generated boundary with CSRF and no replay',async()=>{
  const form=new FormData();form.append('file',new Blob(['original bytes']),'test.xlsx');form.append('options','{}');const calls=[];
  const api=createApiClient({fetchImpl:async(url,options)=>{calls.push({url,options});return url==='/api/csrf-token'?response(200,{csrfToken:'synthetic'}):response(409,{code:'CONFLICT'});}});
  await assert.rejects(api.request('/api/master-data-template/confirm',{method:'POST',body:form}),e=>e.status===409);
  assert.equal(calls.length,2);assert.equal(calls[1].options.body,form);assert.equal(calls[1].options.headers['Content-Type'],undefined);assert.equal(calls[1].options.headers['X-CSRF-Token'],'synthetic');
});

test('development fails closed without an explicit isolated backend and non-business port', () => {
  for (const value of [undefined, 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:63805', 'http://192.168.1.10:3456', 'http://user:pass@127.0.0.1:12345', 'http://127.0.0.1:12345/path']) assert.throws(() => isolatedBackend(value));
  assert.equal(isolatedBackend('http://127.0.0.1:12345'), 'http://127.0.0.1:12345');
  for (const port of [3000, 3001, 5173, 63805, 3306, 3307, -1, 0]) assert.throws(() => checkDevPort(port));
  checkDevPort(12345);
});

test('OS-assigned development port is explicit and outside the reserved set', async () => {
  const port = await freeDevPort();
  checkDevPort(port);
});
