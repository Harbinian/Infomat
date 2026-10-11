// R03 login admission contract, driven directly against the limiter.
// Pure unit test: no HTTP listener, no database, no env file.
const test = require('node:test');
const assert = require('node:assert/strict');
const security = require('../server/security');

function fakeRequest(body, ip = '127.0.0.1') {
  return { body, ip };
}

function fakeResponse() {
  const listeners = new Map();
  return {
    statusCode: null,
    body: null,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(handler);
      return this;
    },
    settle() {
      for (const handler of listeners.get('finish') || []) handler();
    }
  };
}

function attempt(body, ip) {
  const req = fakeRequest(body, ip);
  const res = fakeResponse();
  let passed = false;
  security.loginRateLimit(req, res, () => { passed = true; });
  return { req, res, admitted: passed };
}

test.beforeEach(() => security.resetLoginRateLimit());

test('whitespace variants of one account are one admission key', () => {
  const variants = ['name', ' name', 'name ', '\tname', 'name\t', ' name', 'name ', '\nname', 'name\r', '\u000bname'];
  for (const variant of variants.slice(0, 8)) {
    const outcome = attempt({ loginName: variant, password: 'x' });
    assert.equal(outcome.admitted, true, variant);
    // Each finished request gives its in-flight slot back; only the failure count accumulates.
    outcome.res.settle();
  }
  const ninth = attempt({ loginName: variants[8], password: 'x' });
  assert.equal(ninth.admitted, false, 'the ninth spelling of the same account is refused');
  assert.equal(ninth.res.statusCode, 429);
  assert.equal(ninth.res.body.code, 'LOGIN_RATE_LIMITED');
  assert.ok(Number(ninth.res.headers['Retry-After']) > 0, 'the refusal carries a retry hint');
});

test('a refused request leaves no trace of its own', () => {
  const ip = '10.1.1.1';
  for (let i = 0; i < 8; i += 1) {
    const outcome = attempt({ loginName: 'refused_trace', password: 'x' }, ip);
    assert.equal(outcome.admitted, true, `failure ${i} is counted`);
    outcome.res.settle(); // the slot is given back; the failure stays in the window
  }
  const before = security.loginRateLimitStats();
  for (let i = 0; i < 5; i += 1) {
    const refused = attempt({ loginName: 'refused_trace', password: 'x' }, ip);
    assert.equal(refused.admitted, false);
  }
  const after = security.loginRateLimitStats();
  // Refusals must not inflate the counters they were refused by, or a stuck client would push
  // the window out forever.
  assert.deepEqual({ size: after.size, inFlight: after.inFlight }, { size: before.size, inFlight: before.inFlight });
  assert.equal(after.rejectedByCapacity, before.rejectedByCapacity);
});

test('each attempt opens its own account key plus the shared address key', () => {
  const first = attempt({ loginName: 'shared_a', password: 'x' }, '10.2.2.2');
  assert.equal(first.admitted, true);
  first.res.settle();
  // Another account from the same address starts from its own window.
  const second = attempt({ loginName: 'shared_b', password: 'x' }, '10.2.2.2');
  assert.equal(second.admitted, true);
  second.res.settle();
  assert.equal(security.loginRateLimitStats().size, 3, 'two account keys and one shared address key');
});

test('one address cannot exceed its own bound across many accounts', () => {
  const ip = '10.3.3.3';
  const limit = security.loginRateLimitStats().addressLimit;
  let refusedAt = null;
  for (let i = 0; i < limit + 5; i += 1) {
    const outcome = attempt({ loginName: `random_${i}`, password: 'x' }, ip);
    if (!outcome.admitted) { refusedAt = i; break; }
    outcome.res.settle();
  }
  assert.equal(refusedAt, limit, 'the address window refuses exactly at its bound');
});

test('a successful login gives its admission back to the address window', () => {
  const ip = '10.4.4.4';
  for (let i = 0; i < 50; i += 1) {
    const outcome = attempt({ loginName: `successful_${i}`, password: 'x' }, ip);
    assert.equal(outcome.admitted, true, `successful login ${i} must not accumulate against the address`);
    security.clearLoginFailures(outcome.req);
    outcome.res.settle();
  }
  assert.ok(security.loginRateLimitStats().size <= 1, 'each success also forgets the account window');
});

test('storage stays bounded under many distinct accounts', () => {
  const limit = security.loginRateLimitStats().maxEntries;
  for (let i = 0; i < limit * 4; i += 1) {
    const outcome = attempt({ loginName: `flood_${i}`, password: 'x' }, `10.5.${i % 250}.${(i >> 8) % 250}`);
    if (outcome.admitted) outcome.res.settle();
  }
  const stats = security.loginRateLimitStats();
  assert.ok(stats.size <= limit, `limiter storage is bounded: ${stats.size} <= ${limit}`);
  assert.ok(stats.rejectedByCapacity > 0, 'the capacity bound is what kept it bounded');
  // The limiter still works after eviction: a fresh key is counted normally.
  const fresh = attempt({ loginName: 'after_flood', password: 'x' }, '10.9.9.9');
  assert.equal(fresh.admitted, true);
  assert.equal(attempt({ loginName: 'after_flood', password: 'x' }, '10.9.9.9').admitted, true);
});

test('in-flight admissions are bounded and released on a refused request', () => {
  const ip = '10.6.6.6';
  const concurrent = security.loginRateLimitStats().concurrencyLimit;
  const held = [];
  for (let i = 0; i < concurrent; i += 1) {
    const outcome = attempt({ loginName: 'parallel', password: 'x' }, ip);
    assert.equal(outcome.admitted, true, `admission ${i}`);
    held.push(outcome);
  }
  const overflow = attempt({ loginName: 'parallel', password: 'x' }, ip);
  assert.equal(overflow.admitted, false, 'the in-flight bound refuses instead of queueing');
  assert.equal(overflow.res.body.code, 'LOGIN_BUSY');
  // Every admitted attempt holds a slot on both its account key and the shared address key.
  assert.equal(security.loginRateLimitStats().inFlight, concurrent * 2, 'the refused request released what it took');
  for (const outcome of held) outcome.res.settle();
  assert.equal(security.loginRateLimitStats().inFlight, 0, 'every finished request gives its slot back');
});
