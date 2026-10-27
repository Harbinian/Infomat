import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, frameWindow, badWindow, lowerQuality } from '../src/presentation/performance.js';
test('refresh-aware dropped estimates and bounded quality never fabricate frame samples', () => {
  assert.equal(frameWindow([], 16.67), null);
  const highRefresh = frameWindow([8.33, 8.33, 16.66], 8.33);
  assert.equal(highRefresh.droppedRatio, 1 / 3);
  assert(badWindow(highRefresh));
  assert.equal(lowerQuality('high'), 'standard'); assert.equal(lowerQuality('standard'), 'basic'); assert.equal(lowerQuality('basic'), 'basic');
});
test('effect ownership releases independently and diagnostics contain no business fields', () => {
  const monitor = createDiagnostics(), a = monitor.effect('lottie-loading', true), b = monitor.effect('lottie-loading', true);
  a(); assert.equal(monitor.effects.size, 1); b(); assert.equal(monitor.effects.size, 0);
  assert.throws(() => monitor.effect('/app/identity?person=secret'), /Unknown/);
  const snapshot = monitor.snapshot(); assert.equal(snapshot.inp, null); assert.equal(snapshot.estimateOnly, true);
  for (const key of ['personId', 'accountId', 'url', 'payload', 'password']) assert(!Object.hasOwn(snapshot, key));
});
