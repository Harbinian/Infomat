#!/usr/bin/env node
// R13 inventory and guard for the retained page.
//
// `script-src 'unsafe-inline'` cannot be removed while the retained page still has inline event
// handlers: a nonce does not apply to `onclick=` attributes, and `'unsafe-hashes'` cannot cover
// handler values that are composed at runtime. This script reports exactly what stands in the
// way, so the conversion has a checklist and a number that has to reach zero.
//
// With --require-clean it requires one matching script hash and no inline handler attributes.
const fs = require('node:fs');
const path = require('node:path');
const { scriptCspHash, inlineScriptBlocks } = require('./testHelpers/retainedPageCsp');

const PAGE = path.resolve(__dirname, '../public/index.html');
const requireClean = process.argv.includes('--require-clean');
const html = fs.readFileSync(PAGE, 'utf8');
const { INLINE_SCRIPT_SHA256 } = require('../server/cspPolicy');

// Inline <script> blocks (those without a src attribute).
const scripts = inlineScriptBlocks(html);
const blocks = scripts.map(({ line, code }) => ({ line, bytes: Buffer.byteLength(code), chars: code.length }));
let match;

// Inline event-handler attributes. The handler text is normalised so a runtime-composed call is
// counted once with the call that composes it, instead of once per rendered row.
const attributes = {};
const handlerRe = /\son([a-z][a-z0-9]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>\x60]+))/gi;
while ((match = handlerRe.exec(html)) !== null) {
  if (!attributes[match[1]]) attributes[match[1]] = { count: 0, templates: new Map() };
  const entry = attributes[match[1]];
  entry.count += 1;
  const template = (match[2] ?? match[3] ?? match[4])
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
  const value = match[2] ?? match[3] ?? match[4];
  if (match[1] === 'click' && (/'\s*\+/.test(value) || /\$\{/.test(value))) runtimeComposed += 1;
}

// Conversion safety: an attribute that lost its separating whitespace is fatal and silent.
// `disableddata-click="…"` parses as a single attribute named `disableddata-click`, so the button
// keeps neither `disabled` nor its handler, and `<buttondata-click="…">` becomes an unknown element
// instead of a button. The handler inventory above only matches `\son…=`, so these are counted
// separately. Only two shapes can occur, because a valued attribute always ends in a quote and the
// parser recovers after one: the tag name itself (`<adata-click=`) or a valueless boolean attribute
// (`disableddata-click=`).
const BOOLEAN_ATTRIBUTES = 'disabled|hidden|readonly|checked|required|selected|multiple|autofocus|open|controls|loop|muted|default|reversed|novalidate|itemscope';
const GLUED_NAME = '(?:on[a-z]+|data-[a-z-]+)=';
const glued = [];
const gluedRe = new RegExp(`<([a-z][a-z0-9]*)(?=${GLUED_NAME})|\\s(${BOOLEAN_ATTRIBUTES})(?=${GLUED_NAME})`, 'g');
while ((match = gluedRe.exec(html)) !== null) {
  const name = html.slice(match.index + match[0].length).match(new RegExp(`^${GLUED_NAME}`))[0];
  glued.push({ line: html.slice(0, match.index).split('\n').length, glued: `${match[1] || match[2]}${name}` });
}

const blockHash = scripts.length === 1 ? scriptCspHash(scripts[0].code) : null;
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
  gluedAttributes: glued,
  // The retained block is allowed by its hash, so what still forces 'unsafe-inline' is only an
  // inline event-handler attribute -- a hash cannot cover one of those.
  stillRequiresUnsafeInline: onclick.count > 0 || Object.entries(attributes).some(([name, entry]) => name !== 'click' && entry.count > 0)
};

for (const block of blocks) console.log(`inline <script> at line ${block.line}, ${block.bytes} bytes`);
for (const [name, count] of Object.entries(report.inlineHandlerAttributes)) console.log(`inline ${name}= attributes: ${count}`);
console.log(`distinct onclick templates: ${report.distinctOnclickTemplates} (of which ${runtimeComposed} are composed while the page renders)`);
console.log(`retained inline script hash: ${blockHash} (policy matches page: ${report.policyHashMatchesPage})`);
console.log(`glued attributes (name lost its separating whitespace): ${glued.length}`);
for (const item of glued) console.log(`  line ${item.line}: ${item.glued}`);
console.log(`script-src 'unsafe-inline' is still required: ${report.stillRequiresUnsafeInline}`);

const output = process.argv.indexOf('--output');
if (output > 0 && process.argv[output + 1]) {
  const target = path.resolve(process.argv[output + 1]);
  if (!target.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)) throw new Error('evidence must be inside repository artifacts');
  if (fs.existsSync(target)) throw new Error('use a new evidence path');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
}

if (requireClean && (report.stillRequiresUnsafeInline || !report.policyHashMatchesPage || glued.length > 0)) {
  console.error('CSP inventory rejected: expected one matching script hash, no inline event handlers and no glued attributes');
  process.exitCode = 1;
}
