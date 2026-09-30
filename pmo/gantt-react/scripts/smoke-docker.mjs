import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';

// Read-only deployment check. No business records or browser storage are changed.
const base = process.argv[2] || 'http://127.0.0.1:5173';
const get = async route => {
  const response = await fetch(base + route, { signal: AbortSignal.timeout(20000) });
  assert.equal(response.status, 200, route);
  return response;
};
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const html = await (await get('/')).text();
assert.match(html, /id="root"/);
await get('/src/main.jsx');
for (const file of ['tasks.json', 'pmo-source-manifest.json']) {
  const actual = Buffer.from(await (await get('/' + file)).arrayBuffer());
  const expected = fs.readFileSync(new URL('../public/' + file, import.meta.url));
  assert.equal(digest(actual), digest(expected), file + ' must match generated local data');
  JSON.parse(actual);
}
for (const [route, source] of [
  ['/procedure-management/dashboard.html', '../../procedure-management/dashboard.html'],
  ['/echarts.min.js', '../../../echarts.min.js'],
]) {
  const actual = Buffer.from(await (await get(route)).arrayBuffer());
  assert.equal(digest(actual), digest(fs.readFileSync(new URL(source, import.meta.url))), route);
}
const list = await (await get('/api/pmo/deliverables')).json();
assert.equal(list.ok, true);
assert.ok(Array.isArray(list.data));
assert.ok(list.data.length > 0, 'deliverables must be available');
const id = list.data[0].deliverableId;
const detail = await (await get('/api/pmo/deliverables/' + id)).json();
assert.equal(detail.ok, true);
assert.ok((await (await get('/api/pmo/deliverables/' + id + '/raw')).text()).includes(id));

// 台账索引与责任部门名册：镜像必须带新版插件，否则前端拿不到受控行，行动项入口不会出现
const ledger = await (await get('/api/pmo/deliverables/ledger')).json();
assert.equal(ledger.ok, true);
assert.ok(Array.isArray(ledger.data.controlled), 'ledger.controlled must be an array');
assert.ok(ledger.data.controlled.length > 0, 'ledger must expose controlled deliverables');
assert.match(ledger.data.suggestedNextId, /^DLV-\d{3}$/, 'suggestedNextId must look like DLV-###');

const roster = await (await get('/api/pmo/deliverables/roster')).json();
assert.equal(roster.ok, true);
assert.ok(Array.isArray(roster.data) && roster.data.length > 0, 'roster must resolve department contacts');

console.log(JSON.stringify({
  base,
  generatedDataMatches: true,
  procedureAssetsMatch: true,
  deliverables: list.data.length,
  controlled: ledger.data.controlled.length,
  departments: roster.data.length,
  detailRead: true,
}));
