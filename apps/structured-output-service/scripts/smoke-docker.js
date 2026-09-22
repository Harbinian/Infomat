const assert = require('node:assert/strict');
const { createProcessVersionFixture } = require('./process-version-fixtures');
const Migration = require('../public/process-governance-migration');

// Sends synthetic fixtures only. Does not save or modify business data.
async function main() {
  const base = process.argv[2] || 'http://127.0.0.1:3011';
  const request = (url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(15000) });
  const get = async url => {
    const response = await request(url);
    assert.equal(response.status, 200, url);
    return response;
  };
  const health = await (await get('/api/health')).json();
  assert.equal(health.status, 'ok');
  assert.equal(health.schema_version, 'process-governance-v7');
  assert.equal(health.release_status, 'released');
  assert.notEqual(health.app_commit, 'unknown');
  assert.equal((await get('/api/schema')).headers.get('x-infomat-schema-digest'), health.schema_digest);
  await get('/');
  await get('/vendor/cytoscape.min.js');
  for (const version of ['v3', 'v6']) {
    const source = createProcessVersionFixture(`process-governance-${version}`);
    const migrated = Migration.migrateDocument(source)[0];
    const roundtrip = Migration.migrateDocument(JSON.parse(JSON.stringify(migrated)))[0];
    assert.deepEqual(roundtrip, migrated);
    const response = await request('/api/validate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ data: roundtrip })
    });
    assert.equal(response.status, 200);
    const validation = await response.json();
    assert.equal(validation.valid, true, JSON.stringify(validation.errors));
  }
  for (const filename of ['retired.docx', 'retired.txt', 'retired.md']) {
    const form = new FormData();
    form.append('file', new Blob(['retired parser input']), filename);
    const response = await request('/api/upload', { method: 'POST', body: form });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'API_NOT_FOUND');
  }
  const paste = await request('/api/paste', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'retired parser input' })
  });
  assert.equal(paste.status, 404);
  assert.equal((await paste.json()).code, 'API_NOT_FOUND');
  console.log(JSON.stringify({ base, health, staticAssets: true, v3v6ToV7: true, jsonRoundtrip: true, retiredParsersRejected: true }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
