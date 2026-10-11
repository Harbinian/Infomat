// R13 content security policy contract. Pure unit test: no listener, no browser.
// It pins what must not regress, and it checks the policy's script hash against the page, because
// a stale hash does not fail loudly in a browser -- it blocks the page's own script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { buildCsp, DEPLOYED_CSP, PREVIOUS_CSP, INLINE_SCRIPT_SHA256 } = require('../server/cspPolicy');

const PAGE = path.resolve(__dirname, '../public/index.html');

function pageFacts() {
  const html = fs.readFileSync(PAGE, 'utf8');
  const open = html.indexOf('<script>', html.indexOf('  <script>')) + '<script>'.length;
  const close = html.indexOf('</script>', open);
  const code = html.slice(open, close);
  return {
    html,
    code,
    hash: `sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}`,
    inlineScripts: (html.match(/<script(?![^>]*\bsrc=)[^>]*>/gi) || []).length,
    handlers: (html.match(/\son(click|change|input|submit|keydown|keyup|focus|blur|load|error)\s*=/gi) || []).length
  };
}

test('the deployed policy allows the page script by hash and blocks everything else inline', () => {
  assert.ok(!/script-src[^;]*unsafe-inline/.test(DEPLOYED_CSP), 'inline script is no longer generally allowed');
  assert.ok(!/unsafe-eval/.test(DEPLOYED_CSP), 'eval was never allowed and stays that way');
  assert.ok(DEPLOYED_CSP.includes(`script-src 'self' '${INLINE_SCRIPT_SHA256}'`), DEPLOYED_CSP);
});

test('the hash in the policy is the hash of the page that is shipped', () => {
  const facts = pageFacts();
  assert.equal(INLINE_SCRIPT_SHA256, facts.hash,
    'a stale script hash blocks the page\'s own script in production; recompute it when the block changes');
});

test('the page no longer relies on inline event-handler attributes', () => {
  const facts = pageFacts();
  assert.equal(facts.handlers, 0, 'no inline handler attribute may remain: a hash cannot cover one');
  assert.equal(facts.inlineScripts, 1, 'exactly the one retained script block is allowed');
});

test('every directive that protects the page is still present', () => {
  for (const directive of ["default-src 'self'", "img-src 'self' data:", "style-src 'self' 'unsafe-inline'", "frame-ancestors 'self'"]) {
    assert.ok(DEPLOYED_CSP.includes(directive), directive);
    assert.ok(PREVIOUS_CSP.includes(directive), directive);
  }
});

test('buildCsp is the single source of both policies', () => {
  assert.equal(buildCsp({ allowInlineScript: false }), DEPLOYED_CSP);
  assert.equal(buildCsp({ allowInlineScript: true }), PREVIOUS_CSP);
  assert.ok(/script-src 'self' 'unsafe-inline'/.test(PREVIOUS_CSP), 'the previous policy is retained for comparison');
});
