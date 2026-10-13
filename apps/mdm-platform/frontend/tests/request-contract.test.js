// Shared transport behavior and the actual retained-page adapter. No service,
// database, private configuration or browser persistence is accessed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { protocol } from '../src/protocol.js';
import { createApiClient, ApiError } from '../src/api.js';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function retainedClient(fetchImpl) {
  const source = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const start = source.indexOf('// ===== API helper (with 401 handling and CSRF protection) =====');
  const end = source.indexOf('// ===== Tag rendering =====', start);
  assert(start > 0 && end > start);
  const showLoginStart = source.indexOf('function showLogin(');
  const showLoginEnd = source.indexOf('function showApp(', showLoginStart);
  assert(showLoginStart > end && showLoginEnd > showLoginStart);
  let logins = 0, toasts = 0;
  const elements = new Map();
  const observedProtocol = { ...protocol, createRequestClient: options => {
    assert.equal(options.timeoutMs, 0, 'retained long requests keep their existing duration contract');
    return protocol.createRequestClient({ ...options, setTimer: () => assert.fail('retained request must not acquire an implicit timeout') });
  } };
  const context = vm.createContext({
    window: { fetch: fetchImpl }, location: { origin: 'http://isolated.invalid' }, MdmProtocol: observedProtocol,
    Headers, FormData, DOMException, AbortController, AbortSignal, setTimeout, clearTimeout, URL,
    publicationImport: { mode: 'retained' }, hasV7Edits: () => false,
    resetSessionUi: () => { logins++; }, showToast: () => { toasts++; },
    $: id => { if (!elements.has(id)) elements.set(id, { style: {} }); return elements.get(id); }
  });
  vm.runInContext(source.slice(start, end) + source.slice(showLoginStart, showLoginEnd) + '\nglobalThis.adapter = { api, fetch: window.fetch, resetSession: requestClient.resetSession, ensureCsrfToken: loadCsrfToken, generation: () => requestClient.generation };', context);
  return { ...context.adapter, get logins() { return logins; }, get toasts() { return toasts; } };
}

test('construction owns no IO; clients have independent CSRF caches and session generations', async () => {
  const calls = [];
  function make(identity) {
    return protocol.createRequestClient({ fetchImpl: async (url, options) => {
      calls.push({ identity, url, options });
      if (url === '/api/csrf-token') return response(200, { csrfToken: identity });
      assert.equal(options.headers['X-CSRF-Token'], identity);
      return response(200, { identity });
    } });
  }
  const one = make('one'), two = make('two');
  assert.equal(calls.length, 0);
  await one.request('/api/write', { method: 'POST' });
  await two.request('/api/write', { method: 'POST' });
  one.resetSession();
  await two.request('/api/write', { method: 'POST' });
  await one.request('/api/write', { method: 'POST' });
  assert.equal(calls.filter(call => call.url === '/api/csrf-token' && call.identity === 'one').length, 2);
  assert.equal(calls.filter(call => call.url === '/api/csrf-token' && call.identity === 'two').length, 1);
  assert.equal(one.generation, 1); assert.equal(two.generation, 0);
});

test('parallel writes share a CSRF read; cancelling one waiter does not dispatch it or cancel the other', async () => {
  const token = deferred(), entered = deferred(), calls = [];
  let csrfSignal;
  const client = createApiClient({ fetchImpl: async (url, options) => {
    calls.push(url);
    if (url === '/api/csrf-token') { csrfSignal = options.signal; entered.resolve(); return token.promise; }
    return response(200, { saved: url });
  } });
  const controller = new AbortController();
  const cancelled = client.request('/api/cancelled', { method: 'POST', signal: controller.signal });
  const rejected = assert.rejects(cancelled, { name: 'AbortError' });
  const kept = client.request('/api/kept', { method: 'POST' });
  await entered.promise; controller.abort(); await rejected;
  assert.equal(csrfSignal.aborted, false);
  token.resolve(response(200, { csrfToken: 'shared' }));
  assert.deepEqual(await kept, { saved: '/api/kept' });
  assert.deepEqual(calls, ['/api/csrf-token', '/api/kept']);
});

test('403 invalidates the cached token without replaying a write or expiring identity', async () => {
  let reads = 0, writes = 0, expired = 0;
  const client = createApiClient({ fetchImpl: async (url, options) => {
    if (url === '/api/csrf-token') return response(200, { csrfToken: 'token-' + ++reads });
    writes++;
    assert.equal(options.headers['X-CSRF-Token'], 'token-' + reads);
    return response(writes === 1 ? 403 : 200, { code: 'SYNTHETIC_DENIED' });
  }, onUnauthorized: () => { expired++; } });
  await assert.rejects(client.request('/api/write', { method: 'POST' }), error => error.status === 403);
  assert.equal(writes, 1); assert.equal(expired, 0);
  await client.request('/api/write', { method: 'POST' });
  assert.equal(reads, 2); assert.equal(writes, 2);
});

test('CSRF 401/403 and malformed tokens fail before the write, with one authentication notification', async () => {
  for (const status of [401, 403, 200]) {
    let expired = 0; const calls = [];
    const client = createApiClient({ fetchImpl: async url => {
      calls.push(url); return response(status, status === 200 ? { csrfToken: '' } : { code: 'SYNTHETIC_DENIED' });
    }, onUnauthorized: () => { expired++; } });
    await assert.rejects(client.request('/api/write', { method: 'POST' }), error => error instanceof ApiError && error.status === (status === 200 ? 502 : status));
    assert.deepEqual(calls, ['/api/csrf-token']);
    assert.equal(expired, status === 401 ? 1 : 0);
  }
});

test('one 401 expires its generation; delayed responses cannot restore data or trigger another notification', async () => {
  const old = deferred(); let expired = 0;
  const client = protocol.createRequestClient({ fetchImpl: async url => url === '/api/old' ? old.promise : response(401, { code: 'EXPIRED' }), onUnauthorized: () => { expired++; } });
  const late = client.request('/api/old'); const rejected = assert.rejects(late, { name: 'AbortError' });
  await assert.rejects(client.request('/api/current'), error => error.status === 401);
  old.resolve(response(401, { code: 'OLDER_SESSION' })); await rejected;
  assert.equal(expired, 1);
  const generation = client.generation;
  await assert.rejects(client.request('/api/org/login', { method: 'POST' }), error => error.status === 401);
  assert.equal(expired, 1); assert.equal(client.generation, generation);
});

test('an old 403 cannot invalidate a newer session token', async () => {
  const old = deferred(); let reads = 0;
  const client = protocol.createRequestClient({ fetchImpl: async url => {
    if (url === '/api/old') return old.promise;
    if (url === '/api/csrf-token') return response(200, { csrfToken: 'fresh-' + ++reads });
    return response(200, { saved: true });
  } });
  const late = client.request('/api/old'); const rejected = assert.rejects(late, { name: 'AbortError' });
  client.resetSession(); await client.request('/api/write', { method: 'POST' });
  old.resolve(response(403, {})); await rejected;
  await client.request('/api/write', { method: 'POST' }); assert.equal(reads, 1);
});

test('reset cancels the owned CSRF read and prevents its late value replacing a new token', async () => {
  const old = deferred(), entered = deferred(); let reads = 0, oldSignal;
  const client = protocol.createRequestClient({ fetchImpl: async (url, options) => {
    if (url !== '/api/csrf-token') { assert.equal(options.headers['X-CSRF-Token'], 'new'); return response(200, {}); }
    if (++reads > 1) return response(200, { csrfToken: 'new' });
    oldSignal = options.signal; entered.resolve(); return old.promise;
  } });
  const late = client.request('/api/old-write', { method: 'POST' }); const rejected = assert.rejects(late, { name: 'AbortError' });
  await entered.promise; client.resetSession(); assert.equal(oldSignal.aborted, true);
  await client.request('/api/new-write', { method: 'POST' });
  old.resolve(response(200, { csrfToken: 'old' })); await rejected;
  await client.request('/api/new-write', { method: 'POST' }); assert.equal(reads, 2);
});

test('a 403 also invalidates a pending CSRF read; its late token cannot replace the next token', async () => {
  const old = deferred(), entered = deferred(); let reads = 0; const writes = [];
  const client = protocol.createRequestClient({ fetchImpl: async (url, options) => {
    if (url === '/api/denied') return response(403, {});
    if (url === '/api/csrf-token') {
      if (++reads === 1) { entered.resolve(); return old.promise; }
      return response(200, { csrfToken: 'fresh' });
    }
    writes.push(url); assert.equal(options.headers['X-CSRF-Token'], 'fresh'); return response(200, {});
  } });
  const late = client.request('/api/old-write', { method: 'POST' }); const rejected = assert.rejects(late, { name: 'AbortError' });
  await entered.promise;
  await assert.rejects(client.request('/api/denied'), error => error.status === 403);
  await client.request('/api/new-write', { method: 'POST' });
  old.resolve(response(200, { csrfToken: 'invalidated' })); await rejected;
  await client.request('/api/new-write', { method: 'POST' });
  assert.equal(reads, 2); assert.deepEqual(writes, ['/api/new-write', '/api/new-write']);
});

test('raw retained fetch preserves Response and its own 401 body, but rejects stale body reads and clones', async () => {
  let expired = 0;
  const client = protocol.createRequestClient({ fetchImpl: async url => response(url === '/api/denied' ? 401 : 200, { value: url }), onUnauthorized: () => { expired++; } });
  const raw = await client.fetch('/api/current'); assert(raw instanceof Response);
  const clone = raw.clone();
  const denied = await client.fetch('/api/denied');
  assert.equal(denied.status, 401); assert.deepEqual(await denied.json(), { value: '/api/denied' });
  await assert.rejects(raw.json(), { name: 'AbortError' });
  await assert.rejects(clone.json(), { name: 'AbortError' }); assert.equal(expired, 1);
});

test('raw body completion is discarded if the session changes during decoding', async () => {
  const body = deferred(), entered = deferred();
  const client = protocol.createRequestClient({ fetchImpl: async () => ({ status: 200, ok: true, json: () => { entered.resolve(); return body.promise; } }) });
  const raw = await client.fetch('/api/current'); const pending = raw.json();
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await entered.promise; client.resetSession(); body.resolve({ stale: true }); await rejected;
});

test('same-origin Request objects preserve headers, body and signal while receiving shared CSRF', async () => {
  const input = new Request('http://isolated.invalid/api/write', { method: 'POST', body: 'original', headers: { 'X-Synthetic': 'kept' } });
  const client = protocol.createRequestClient({ origin: 'http://isolated.invalid', fetchImpl: async (url, options) => {
    if (url === '/api/csrf-token') return response(200, { csrfToken: 'token' });
    assert.equal(url, input); assert.equal(options.method, 'POST');
    assert.equal(new Headers(options.headers).get('X-Synthetic'), 'kept'); assert.equal(options.headers['X-CSRF-Token'], 'token');
    assert.equal(await input.clone().text(), 'original'); return response(200, {});
  } });
  await client.fetch(input);
});

test('actual old api retains native JSON, multipart, text, empty and error payload contracts', async () => {
  const calls = [], form = new FormData(); form.append('file', new Blob(['bytes']), 'synthetic.xlsx');
  const client = retainedClient(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/csrf-token') return response(200, { csrfToken: 'token' });
    if (url === '/api/text') return new Response('plain text');
    if (url === '/api/empty') return new Response(null, { status: 204 });
    if (url === '/api/error') return response(409, { code: 'REVISION_CHANGED', details: [{ message: 'detail' }], extra: 'kept', error: 'original error' });
    return response(200, { saved: true });
  });
  const json = '{"expected_revision":1}';
  await client.api('/api/write', { method: 'POST', body: json });
  await client.api('/api/upload', { method: 'POST', body: form });
  assert.equal(calls[1].options.body, json); assert.equal(calls[1].options.headers['Content-Type'], 'application/json');
  assert.equal(calls[2].options.body, form); assert.equal(calls[2].options.headers['Content-Type'], undefined);
  assert.equal(calls.filter(call => call.url === '/api/csrf-token').length, 1);
  assert.equal(await client.api('/api/text'), 'plain text');
  assert.equal(Object.keys(await client.api('/api/empty')).length, 0);
  await assert.rejects(client.api('/api/error'), error => error.status === 409 && error.code === 'REVISION_CHANGED' && error.extra === 'kept' && error.message === 'original error' && error.details[0].message === 'detail');
});

test('actual old native fetch and api share token invalidation and silent 401 handling', async () => {
  let tokens = 0; const calls = [];
  const client = retainedClient(async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/csrf-token') return response(200, { csrfToken: 'token-' + ++tokens });
    if (url === '/api/denied') return response(403, {});
    if (url === '/api/expired') return response(401, { error: 'expired' });
    return response(200, { saved: true });
  });
  await client.api('/api/write', { method: 'POST', body: '{}' });
  const denied = await client.fetch('/api/denied', { method: 'DELETE' }); assert.equal(denied.status, 403);
  await client.api('/api/write', { method: 'POST', body: '{}' }); assert.equal(tokens, 2);
  await assert.rejects(client.api('/api/expired', { silentUnauthorized: true }), error => error.status === 401);
  assert.equal(client.logins, 1); assert.equal(client.toasts, 0);
  assert.equal(client.generation(), 1);
  const priorCalls = calls.length; await client.fetch('/echarts.min.js'); assert.equal(calls.length, priorCalls + 1);
  assert.equal(calls.at(-1).options, undefined);
});

test('React maps shared receipts to bounded errors while retaining import and field data', async () => {
  const client = createApiClient({ fetchImpl: async () => response(400, { error: 'sensitive SQL', code: 'IMPORT_INVALID', field_errors: { name: 'required' }, import_status: 'invalid' }) });
  await assert.rejects(client.request('/api/import'), error => error instanceof ApiError && error.code === 'IMPORT_INVALID' && error.fieldErrors.name === 'required' && error.importStatus === 'invalid' && !error.message.includes('SQL'));
});

test('encoded traversal, remote Request objects and malformed paths allocate no timer or transport', async () => {
  const client = protocol.createRequestClient({ origin: 'http://isolated.invalid', fetchImpl: () => assert.fail('transport'), setTimer: () => assert.fail('timer') });
  for (const input of ['/api/%2e%2e/elsewhere', '/api/%5cexternal', '/api/bad%ZZ', new Request('http://external.invalid/api/read')]) {
    await assert.rejects(client.request(input), /same-origin/);
  }
});
