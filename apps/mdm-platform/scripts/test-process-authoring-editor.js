// Input: repository editing contracts. Output: Node test assertions; owns only random loopback HTTP.
// No private configuration, MySQL connection, 3000/3001 service or external AI request.
const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const editor = require('../server/processAuthoringEditor');
const { createRouter } = require('../server/routes/processAuthoringEditor');
test('version-specific blank drafts preserve supported contracts and identifiers', () => {
  for (const version of [5, 6, 7, 8, 9]) {
    const template = editor.template(`process-governance-v${version}`);
    assert.equal(template.data.schema_version, template.schema_version);
    assert.match(template.schema_digest, /^[a-f0-9]{64}$/);
    assert.equal(editor.validate({ data: template.data }).valid, true, JSON.stringify(editor.validate({ data: template.data }).errors));
    if (template.data.migration) assert.equal(template.data.migration.source_schema_version, template.schema_version);
    const before = structuredClone(template.data);
    editor.validate({ data: template.data });
    assert.deepEqual(template.data, before);
  }
});
test('validation keeps failures visible and never imports approval claims', () => {
  const data = editor.template().data;
  data.approved = true;
  const result = editor.validate({ data });
  assert.equal(result.valid, false);
  assert.equal(result.data.approved, true); // caller can show the error; nothing is stripped or trusted
  assert.throws(() => editor.validate({ data: { schema_version: 'unknown' } }), { code: 'UNSUPPORTED_SCHEMA_VERSION' });
  assert.throws(() => editor.validate({ data, validation_profile: 'approved' }), { code: 'UNSUPPORTED_VALIDATION_PROFILE' });
  let deep = data;
  for (let i = 0; i < 66; i++) deep = { child: deep };
  assert.throws(() => editor.validate({ data: deep }), { code: 'JSON_DEPTH_EXCEEDED' });
});
test('directory hints contain only supplied current departments and no inferred positions', () => {
  const result = editor.enums([{ name: '明确甲部' }, { name: '明确乙部' }, { name: '明确甲部' }]);
  assert.deepEqual(result.rosterRolesByDepartment, { 明确甲部: [], 明确乙部: [] });
  assert.equal(result.organizationCatalogMode, 'departments_only');
  assert.equal(result.organizationCatalogSource.source, '3000');
  assert.equal(result.positionInfo.status, 'unavailable');
  assert.equal(editor.asset('server.js'), null);
  assert.equal(editor.asset('../server.js'), null);
});
test('editing HTTP uses an authenticated allowlist and does not capture workspace routes', async () => {
  const app = express();
  app.use(express.json());
  let enabled = true;
  app.use(createRouter({ isEnabled: () => enabled,
    authorization: (req, res, next) => req.headers['x-synthetic-actor'] ? next() : res.sendStatus(401),
    readDepartments: async () => [{ name: '明确甲部' }] }));
  app.get('/status', (req, res) => res.json({ enabled }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { 'x-synthetic-actor': 'test', 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(base + '/editor/schema')).status, 401);
    const response = await fetch(base + '/editor/template', { headers });
    const template = await response.json();
    assert.equal(response.status, 200);
    const checked = await fetch(base + '/editor/validate', { method: 'POST', headers, body: JSON.stringify({ data: template.data }) });
    assert.equal((await checked.json()).valid, true);
    assert.equal((await fetch(base + '/editor/schema?version=unsupported', { headers })).status, 400);
    for (const file of editor.ASSET_FILES) assert.equal((await fetch(base + '/assets/' + file, { headers })).status, 200, file);
    assert.equal((await fetch(base + '/assets/server.js', { headers })).status, 404);
    const catalog = await (await fetch(base + '/editor/enums', { headers })).json();
    assert.deepEqual(catalog.departments, [{ department_name: '明确甲部', domain: '' }]);
    enabled = false;
    assert.equal((await fetch(base + '/editor/template', { headers })).status, 503);
    assert.equal((await fetch(base + '/status')).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
