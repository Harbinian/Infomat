// R13 content security policy contract. Pure unit test: no listener, no browser.
// It pins what must not regress, and it checks the policy's script hash against the page, because
// a stale hash does not fail loudly in a browser -- it blocks the page's own script.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { scriptCspHash, inlineScriptBlocks } = require('./testHelpers/retainedPageCsp');
const { buildCsp, DEPLOYED_CSP, PREVIOUS_CSP, INLINE_SCRIPT_SHA256 } = require('../server/cspPolicy');

const PAGE = path.resolve(__dirname, '../public/index.html');

test('the retained page ships its external scripts and the request client it calls', () => {
  const head = fs.readFileSync(PAGE, 'utf8').split('</head>')[0];
  const scripts = [...head.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gi)].map(match => match[1]);
  assert(scripts.includes('mdm-protocol.js'));
  for (const script of scripts) assert(fs.statSync(path.join(path.dirname(PAGE), script)).isFile(), script);
  const protocol = require('../public/mdm-protocol');
  assert.equal(typeof protocol.createRequestClient, 'function');
  assert.equal(typeof protocol.RequestError, 'function');
});

function pageFacts(html = fs.readFileSync(PAGE, 'utf8')) {
  const blocks = inlineScriptBlocks(html);
  const code = blocks.length === 1 ? blocks[0].code : null;
  return {
    html,
    code,
    hash: code === null ? null : scriptCspHash(code),
    inlineScripts: blocks.length,
    handlers: (html.match(/\son[a-z][a-z0-9]*\s*=/gi) || []).length
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

test('LF, CRLF and isolated CR produce the same browser script hash', () => {
  const lf = fs.readFileSync(PAGE, 'utf8').replace(/\r\n?/g, '\n');
  const baseline = pageFacts(lf);
  for (const html of [lf, lf.replace(/\n/g, '\r\n'), lf.replace(/\n/g, '\r')]) {
    const facts = pageFacts(html);
    assert.equal(facts.inlineScripts, 1);
    assert.equal(facts.hash, INLINE_SCRIPT_SHA256);
    assert.equal(inlineScriptBlocks(html)[0].line, inlineScriptBlocks(lf)[0].line);
    assert.equal(facts.handlers, baseline.handlers);
  }
});

test('real script and whitespace changes still invalidate the policy hash', () => {
  const { code } = pageFacts();
  for (const changed of [code + ' ', code + '\n', code + '\nvoid 0;']) {
    assert.notEqual(scriptCspHash(changed), INLINE_SCRIPT_SHA256);
  }
});

test('a missing or additional inline script cannot match the single-script policy', () => {
  assert.equal(pageFacts('<script src = "local.js"></script>').hash, null);
  const html = fs.readFileSync(PAGE, 'utf8');
  assert.equal(pageFacts(html + '<script>void 0;</script>').hash, null);
});

test('the inventory CLI accepts newline variants and rejects real policy violations', () => {
  const lf = fs.readFileSync(PAGE, 'utf8').replace(/\r\n?/g, '\n');
  const cases = [
    ['LF', lf, 0],
    ['CRLF', lf.replace(/\n/g, '\r\n'), 0],
    ['CR', lf.replace(/\n/g, '\r'), 0],
    ['changed script', lf.replace('<script>', '<script>void 0;'), 1],
    ['missing script', lf.replace(/<script>[\s\S]*?<\/script>/i, ''), 1],
    ['extra script', lf + '<script>void 0;</script>', 1],
    ['double quoted handler', lf + '<button onclick="void(0)">test</button>', 1],
    ['single quoted handler', lf + "<button onclick='void(0)'>test</button>", 1],
    ['unquoted handler', lf + '<button onclick=void(0)>test</button>', 1],
    ['other event type', lf + "<button onpointerdown='void(0)'>test</button>", 1]
  ];
  // Supply a synthetic page over stdin, without rewriting the real page or its policy.
  const harness = `
    const fs = require('node:fs'), path = require('node:path');
    const [page, guard] = process.argv.slice(1);
    const original = fs.readFileSync.bind(fs);
    const html = original(0, 'utf8');
    fs.readFileSync = (filename, ...args) =>
      typeof filename === 'string' && path.resolve(filename) === page ? html : original(filename, ...args);
    process.argv = [process.execPath, guard, '--require-clean'];
    require(guard);
  `;
  for (const [name, html, expected] of cases) {
    const result = spawnSync(process.execPath, ['-e', harness, PAGE, path.resolve(__dirname, 'audit-inline-script-inventory.js')], {
      input: html, encoding: 'utf8', env: isolatedEnvironment(), windowsHide: true, timeout: 10000
    });
    assert.equal(result.status, expected, `${name}: ${result.error || result.stderr}`);
  }
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
