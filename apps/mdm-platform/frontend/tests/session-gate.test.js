import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api.js';
import { readAuthenticatedSession } from '../src/sessionGate.js';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('personnel and separate system identities stay gated until password status is known', async () => {
  for (const user of [{ personId: 1 }, { personId: null, identityKind: 'system_admin', accountId: 1 }]) {
    for (const required of [true, false]) {
      const calls = [];
      const api = createApiClient({ fetchImpl: async url => {
        calls.push(url);
        return response(200, url === '/api/org/me' ? user : { is_default_password: required });
      } });
      assert.deepEqual(await readAuthenticatedSession(api), { user, state: required ? 'password-required' : 'ready' });
      assert.deepEqual(calls, ['/api/org/me', '/api/org/me/password-status']);
    }
  }
});

test('failed or unknown password status cannot yield a ready session', async () => {
  for (const status of [401, 403, 409, 503]) {
    const api = createApiClient({ fetchImpl: async url => response(url === '/api/org/me' ? 200 : status, { personId: 1 }) });
    await assert.rejects(readAuthenticatedSession(api), e => e.status === status);
  }
  for (const value of [null, {}, { is_default_password: 'false' }]) {
    const api = createApiClient({ fetchImpl: async url => response(200, url === '/api/org/me' ? { personId: 1 } : value) });
    await assert.rejects(readAuthenticatedSession(api), e => e.status === 502);
  }
});

test('replaced session cannot publish a delayed password status', async () => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const api = createApiClient({ fetchImpl: async url => {
    if (url === '/api/org/me') return response(200, { personId: 1 });
    entered(); return new Promise(resolve => { release = resolve; });
  } });
  const pending = readAuthenticatedSession(api); await started;
  api.resetSession(); release(response(200, { is_default_password: false }));
  await assert.rejects(pending, e => e.name === 'AbortError');
});
