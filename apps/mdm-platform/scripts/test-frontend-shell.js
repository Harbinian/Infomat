// Local public-build and routing regression. No database or real service.
// Requires frontend build. Uses one ephemeral loopback HTTP server, closed in finally.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { frontendRouter } = require('../server/frontend');
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
  const dist = path.resolve(__dirname, '../frontend/dist');
  const files = fs.readdirSync(dist, { recursive: true }).filter(f => fs.statSync(path.join(dist, f)).isFile());
  assert.ok(files.includes('index.html'));
  for (const file of files) {
    assert.ok(file === 'index.html' || /^assets[\\/][\w.-]+\.(js|css)$/.test(file), 'unexpected public build file: ' + file);
    const content = fs.readFileSync(path.join(dist, file), 'utf8');
    assert.ok(!/SYNTHETIC_|Stage05-Synthetic|MYSQL_PASSWORD|SESSION_SECRET|192\.168\.19\.220/.test(content));
  }
  const app = express(); app.use(securityHeaders);
  app.use('/app', frontendRouter());
  app.use('/unbuilt', frontendRouter(path.join(dist, 'does-not-exist')));
  app.use(express.static(path.resolve(__dirname, '../public')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  assert.ok(![3000, 3001, 5173, 63805, 3306, 3307].includes(server.address().port));
  try {
    const base = 'http://127.0.0.1:' + server.address().port;
    for (const url of ['/app/', '/app/workbench', '/app/identity', '/app/template-import', '/app/objects', '/app/fact-checks', '/app/v7-mappings', '/app/design-handoffs']) {
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
    assert.ok((await (await fetch(base + '/')).text()).includes('id="appContent"'));
    assert.equal((await fetch(base + '/echarts.min.js')).status, 200);
    for (const file of files.filter(f => f !== 'index.html')) assert.equal((await fetch(base + '/app/' + file.replaceAll('\\', '/'))).status, 200);
    console.log('P01_PUBLIC_BUILD_AND_ROUTING_PASS: runtime build identity, page allowlist, API/assets/upload/source 404, old entry, local chart, bounded public build');
  } finally { await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
