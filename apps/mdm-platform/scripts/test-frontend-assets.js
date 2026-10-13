// Current frontend/public-resource contract. No database or application startup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readdirSync(path.join(root, 'frontend/src')).filter(f => /\.(jsx|js|css)$/.test(f))
  .map(f => fs.readFileSync(path.join(root, 'frontend/src', f), 'utf8')).join('\n');
assert(!fs.existsSync(path.join(root, 'public/index.html')), 'retired page source must be removed');
assert(!fs.existsSync(path.join(root, 'public/mdm-protocol.js')), 'shared contracts are not a second public frontend');
assert(!/onLegacy|legacy-link|使用原入口|进入原入口|返回原入口|\/#\//.test(source), 'current frontend must not expose the retired UI');
for (const file of ['logo.png', 'echarts.min.js', 'template.xlsx']) assert(fs.statSync(path.join(root, 'public', file)).isFile());
const protocol = require('../shared/browserProtocol');
for (const name of ['createRequestClient', 'createRequestSession', 'targetHref']) assert.equal(typeof protocol[name], 'function');
const endpoints = new Set();
for (const page of protocol.pages) { assert(!endpoints.has(page.href)); endpoints.add(page.href); }
assert(endpoints.has('/app/password'));
console.log('Current frontend resources and retired-entry removal checks passed');
