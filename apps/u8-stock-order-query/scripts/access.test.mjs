import test from 'node:test';
import assert from 'node:assert/strict';
import { isRequestAllowed } from '../access.mjs';

const network = { listenHost: '0.0.0.0', port: 3088, publicPort: 3099 };
const loopback = { ...network, listenHost: '127.0.0.1' };

test('accepts LAN IPs and same-origin browser requests with all-IP listening', () => {
  for (const host of ['192.168.19.199:3088', '192.168.10.184:3088', '127.0.0.1:3088', 'localhost:3088', '[::1]:3099']) {
    assert.equal(isRequestAllowed({ host }, network), true);
    assert.equal(isRequestAllowed({ host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin' }, network), true);
  }
});
test('preserves local access when explicitly bound to loopback', () => {
  assert.equal(isRequestAllowed({ host: 'localhost:3088' }, loopback), true);
  assert.equal(isRequestAllowed({ host: '127.0.0.1:3099' }, loopback), true);
  assert.equal(isRequestAllowed({ host: '192.168.19.199:3088' }, loopback), false);
});
test('rejects cross-origin requests even when both addresses are allowed IPs', () => {
  for (const origin of ['http://127.0.0.1:3088', 'http://192.168.10.184:3088', 'http://192.168.19.199:3099', 'https://192.168.19.199:3088', 'null', '']) {
    assert.equal(isRequestAllowed({ host: '192.168.19.199:3088', origin }, network), false);
  }
  assert.equal(isRequestAllowed({ host: '192.168.19.199:3088', 'sec-fetch-site': 'cross-site' }, network), false);
});
test('rejects DNS names, missing or malformed hosts and non-service ports', () => {
  for (const host of [undefined, '', 'other.invalid:3088', '192.168.19.199:3000', '192.168.19.199', '127.1:3088', 'user@192.168.19.199:3088', '192.168.19.199:3088/path', '192.168.19.199:3088?x=1', '192.168.19.199:3088#x', '192.168.19.199:3088 ']) {
    assert.equal(isRequestAllowed({ host }, network), false, String(host));
  }
});
