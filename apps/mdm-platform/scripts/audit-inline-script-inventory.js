#!/usr/bin/env node
// R13 inventory and guard for the retained page.
//
// `script-src 'unsafe-inline'` cannot be removed while the retained page still has inline event
// handlers: a nonce does not apply to `onclick=` attributes, and `'unsafe-hashes'` cannot cover
// handler values that are composed at runtime. This script reports exactly what stands in the
// way, so the conversion has a checklist and a number that has to reach zero.
//
// With --require-clean it exits non-zero while any inline handler remains; that is the gate the
// CSP can be tightened behind.
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.resolve(__dirname, '../public/index.html');
const requireClean = process.argv.includes('--require-clean');
const html = fs.readFileSync(PAGE, 'utf8');
const { INLINE_SCRIPT_SHA256 } = require('../server/cspPolicy');

// Inline <script> blocks (those without a src attribute).
const blocks = [];
const scriptRe = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
while ((match = scriptRe.exec(html)) !== null) {
  const before = html.slice(0, match.index);
  blocks.push({
    line: before.split('\n').length,
    bytes: Buffer.byteLength(match[1]),
    chars: match[1].length
  });
}

// Inline event-handler attributes. The handler text is normalised so a runtime-composed call is
// counted once with the call that composes it, instead of once per rendered row.
const attributes = {};
const handlerRe = /\son(click|change|submit|input|keydown|keyup|focus|blur|load|error)\s*=\s*"([^"]*)"/gi;
while ((match = handlerRe.exec(html)) !== null) {
  if (!attributes[match[1]]) attributes[match[1]] = { count: 0, templates: new Map() };
  const entry = attributes[match[1]];
  entry.count += 1;
  const template = match[2]
    .replace(/'[^']*'/g, "'…'")
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\$\{[^}]*\}/g, '${…}')
    .replace(/'\s*\+\s*[^+]*\+\s*'/g, "'+…+'")
    .replace(/\b\d+\b/g, 'N')
    .replace(/\s+/g, ' ')
    .trim();
  entry.templates.set(template, (entry.templates.get(template) || 0) + 1);
}

const onclick = attributes.click || { count: 0, templates: new Map() };
// A handler whose argument is built while the page renders (concatenation or interpolation)
// cannot be covered by 'unsafe-hashes', which is why these are the ones that force a rewrite.
let runtimeComposed = 0;
handlerRe.lastIndex = 0;
while ((match = handlerRe.exec(html)) !== null) {
  if (match[1] === 'click' && (/'\s*\+/.test(match[2]) || /\$\{/.test(match[2]))) runtimeComposed += 1;
}

const blockHash = blocks.length ? `sha256-${require("node:crypto").createHash("sha256").update(html.slice(html.indexOf("<script>", html.indexOf("  <script>")) + 8, html.indexOf("</script>", html.indexOf("<script>", html.indexOf("  <script>")))), "utf8").digest("base64")}` : null;
const report = {
  inlineScriptSha256: blockHash,
  policySha256: INLINE_SCRIPT_SHA256,
  policyHashMatchesPage: blockHash === INLINE_SCRIPT_SHA256,
  page: path.relative(path.resolve(__dirname, '../../..'), PAGE).split(path.sep).join('/'),
  inlineScriptBlocks: blocks,
  inlineHandlerAttributes: Object.fromEntries(Object.entries(attributes).map(([name, entry]) => [name, entry.count])),
  distinctOnclickTemplates: onclick.templates.size,
  onclickTemplates: [...onclick.templates.entries()].sort((a, b) => b[1] - a[1]).map(([template, count]) => ({ template, count })),
  runtimeComposedHandlers: runtimeComposed,
  // The retained block is allowed by its hash, so what still forces 'unsafe-inline' is only an
  // inline event-handler attribute -- a hash cannot cover one of those.
  stillRequiresUnsafeInline: onclick.count > 0 || Object.entries(attributes).some(([name, entry]) => name !== 'click' && entry.count > 0)
};

for (const block of blocks) console.log(`inline <script> at line ${block.line}, ${block.bytes} bytes`);
for (const [name, count] of Object.entries(report.inlineHandlerAttributes)) console.log(`inline ${name}= attributes: ${count}`);
console.log(`distinct onclick templates: ${report.distinctOnclickTemplates} (of which ${runtimeComposed} are composed while the page renders)`);
console.log(`retained inline script hash: ${blockHash} (policy matches page: ${report.policyHashMatchesPage})`);
console.log(`script-src 'unsafe-inline' is still required: ${report.stillRequiresUnsafeInline}`);

const output = process.argv.indexOf('--output');
if (output > 0 && process.argv[output + 1]) {
  const target = path.resolve(process.argv[output + 1]);
  if (!target.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)) throw new Error('evidence must be inside repository artifacts');
  if (fs.existsSync(target)) throw new Error('use a new evidence path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}

if (requireClean && (report.stillRequiresUnsafeInline || !report.policyHashMatchesPage)) {
  console.error('inline script still present: the content security policy cannot be tightened yet');
  process.exitCode = 1;
}
