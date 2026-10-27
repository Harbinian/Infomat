// Current frontend CSP contract. No listener, private configuration or database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildCsp, DEPLOYED_CSP } = require('../server/cspPolicy');
const { securityHeaders } = require('../server/security');
test('scripts are same-origin only with no inline hashes, eval or re-enable option', () => {
  const directives = Object.fromEntries(DEPLOYED_CSP.split('; ').map(value => { const [name, ...tokens] = value.split(' '); return [name, tokens]; }));
  assert.deepEqual(directives['script-src'], ["'self'", "'wasm-unsafe-eval'"]);
  assert.deepEqual(directives['worker-src'], ["'self'"]);
  assert(!directives['script-src'].includes("'unsafe-eval'"));
  assert(!directives['script-src'].includes("'unsafe-inline'"));
  assert(!directives['script-src'].some(token => token.startsWith("'sha256-")));
  assert.equal(buildCsp({ allowInlineScript: true, scriptHash: 'old' }), DEPLOYED_CSP);
  const headers = {}; let called = false;
  securityHeaders({}, { setHeader: (key, value) => { headers[key] = value; } }, () => { called = true; });
  assert(called); assert.equal(headers['Content-Security-Policy'], DEPLOYED_CSP);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
});
test('current source and built entry contain no inline scripts or HTML event handlers', () => {
  for (const relative of ['frontend/index.html', 'frontend/dist/index.html']) {
    const html = fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');
    assert(!/<script\b(?![^>]*\bsrc\s*=)[^>]*>/i.test(html), relative);
    assert(!/\son\w+\s*=/i.test(html), relative);
    assert.match(html, /id="root"/);
  }
});
