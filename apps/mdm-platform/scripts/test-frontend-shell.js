// Local public-build and routing regression. No database or real service.
// Requires frontend build; --frontend-dist selects an artifacts candidate without
// replacing frontend/dist. Uses one ephemeral loopback HTTP server, closed in finally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { frontendRouter, publicEntryRouter } = require('../server/frontend');
const { securityHeaders } = require('../server/security');
const { runtimeVersion } = require('../server/runtimeVersion');

async function main() {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-p01-version-'));
  try {
    for (const dir of ['server', 'public', 'frontend/dist/assets']) fs.mkdirSync(path.join(temporaryRoot, dir), { recursive: true });
    fs.writeFileSync(path.join(temporaryRoot, 'package.json'), '{"version":"0.0.0"}');
    fs.writeFileSync(path.join(temporaryRoot, 'frontend/dist/index.html'), '<html>one</html>');
    const first = runtimeVersion(temporaryRoot).sourceDigest;
    fs.writeFileSync(path.join(temporaryRoot, 'frontend/dist/index.html'), '<html>two</html>');
    assert.notEqual(runtimeVersion(temporaryRoot).sourceDigest, first, 'frontend build must affect runtime identity');
  } finally {
    assert.ok(path.resolve(temporaryRoot).startsWith(path.resolve(os.tmpdir()) + path.sep));
    assert.ok(path.basename(temporaryRoot).startsWith('mdm-p01-version-'));
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
  const argument = process.argv.indexOf('--frontend-dist');
  const dist = argument < 0 ? path.resolve(__dirname, '../frontend/dist') : path.resolve(process.argv[argument + 1]);
  if (argument >= 0) assert.ok(dist.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep), 'candidate must be in artifacts');
  const files = fs.readdirSync(dist, { recursive: true }).filter(f => fs.statSync(path.join(dist, f)).isFile());
  assert.ok(files.includes('index.html'));
  for (const file of files) {
    const softwareWasm = /^assets[\\/]dotlottie-player-[\w-]+\.wasm$/.test(file);
    const feedbackJson = /^assets[\\/](loading|error|success)-[\w-]+\.json$/.test(file);
    assert.ok(file === 'index.html' || /^assets[\\/][\w.-]+\.(js|css)$/.test(file) || softwareWasm || feedbackJson, 'unexpected public build file: ' + file);
    if (softwareWasm) {
      assert.deepEqual(fs.readFileSync(path.join(dist, file)).subarray(0, 8), Buffer.from([0,97,115,109,1,0,0,0]), 'software renderer must be a WASM module');
      continue;
    }
    const content = fs.readFileSync(path.join(dist, file), 'utf8');
    if (feedbackJson) assert.doesNotThrow(() => JSON.parse(content), 'feedback asset must be valid JSON');
    assert.ok(!/SYNTHETIC_|Stage05-Synthetic|MYSQL_PASSWORD|SESSION_SECRET|192\.168\.19\.220/.test(content));
  }
  const app = express(); app.use(securityHeaders);
  app.use('/app', frontendRouter(dist));
  app.use('/unbuilt', frontendRouter(path.join(dist, 'does-not-exist')));
  app.use(publicEntryRouter());
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  assert.ok(![3000, 3001, 5173, 63805, 3306, 3307].includes(server.address().port));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const route of ['todos','data-map','quality','publications','terms','conflicts','accounts','access-audit','organization','roster']) assert.equal((await fetch(base + '/app/' + route)).status, 200, route + ' route');
    assert.equal((await fetch(base + '/app/roles')).status, 200, 'role detail route');
    for (const url of ['/app/', '/app/workbench', '/app/identity', '/app/template-import', '/app/objects', '/app/fact-checks', '/app/v7-mappings', '/app/design-handoffs', '/app/process-preview', '/app/process-formal', '/app/data-governance', '/app/data-map-handoffs', '/app/data-map-handoffs?package=synthetic', '/app/offices', '/app/dashboard']) {
      const res = await fetch(base + url); assert.equal(res.status, 200);
      assert.ok((await res.text()).includes('id="root"'));
      assert.equal(res.headers.get('cache-control'), 'no-store');
    }
    for (const url of ['/api/not-found', '/app/assets/missing.js', '/app/missing.js', '/app/uploads/file', '/app/api/org/me', '/app/package.json', '/app/src/main.jsx', '/app/unknown']) {
      const res = await fetch(base + url); assert.equal(res.status, 404, url);
      assert.ok(!(await res.text()).includes('id="root"'), url + ' must not return SPA');
    }
    assert.equal((await fetch(base + '/app/identity', { method: 'POST' })).status, 404);
    assert.equal((await fetch(base + '/unbuilt/')).status, 503);
    const root = await fetch(base + '/', { redirect: 'manual' });
    assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/app/');
    assert.equal(root.headers.get('cache-control'), 'no-store');
    for (const url of ['/index.html', '/mdm-protocol.js']) {
      const response = await fetch(base + url); assert.equal(response.status, 410);
      assert(!(await response.text()).includes('id="appContent"'));
    }
    assert.equal((await fetch(base + '/app/password')).status, 200);
    const unavailable = await fetch(base + '/unbuilt/');
    assert(!(await unavailable.text()).includes('原入口'));
    assert.equal((await fetch(base + '/echarts.min.js')).status, 200);
    const favicon = await fetch(base + '/favicon.ico');
    assert.equal(favicon.status, 200);
    assert.match(favicon.headers.get('content-type'), /^image\/png(?:;|$)/);
    assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), fs.readFileSync(path.resolve(__dirname, '../public/logo.png')));
    for (const file of files.filter(f => f !== 'index.html')) assert.equal((await fetch(base + '/app/' + file.replaceAll('\\', '/'))).status, 200);
    console.log('CURRENT_PUBLIC_ROUTING_PASS: root redirect, retired resources 410, current pages, asset allowlist and unbuilt 503');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
