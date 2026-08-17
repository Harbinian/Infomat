'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

async function main() {
  const pluginUrl = pathToFileURL(path.join(__dirname, '..', 'dsh-plugin', 'index.mjs')).href;
  const { createWorkspaceStore } = await import(pluginUrl);
  let current = Date.parse('2026-08-17T00:00:00.000Z');
  const store = createWorkspaceStore({ now: () => current });

  const created = store.create('  费用报销治理案例  ');
  assert.equal(created.name, '费用报销治理案例');
  assert.equal(created.revision, 0);
  assert.equal(store.read().workspaces.length, 1);
  assert.equal(store.read().active_workspace_id, created.id);

  current += 1000;
  const saved = store.save(created.id, 0, { fillDocument: { schema_version: 'process-governance-v5' } });
  assert.equal(saved.revision, 1);
  assert.deepEqual(store.read().workspace.content, {
    fillDocument: { schema_version: 'process-governance-v5' }
  });
  assert.throws(
    () => store.save(created.id, 0, { fillDocument: null }),
    error => error.code === 'STATE_CONFLICT' && error.status === 409 && error.currentRevision === 1
  );
  assert.throws(() => store.create(''), error => error.code === 'WORKSPACE_NAME_REQUIRED');
  assert.throws(() => store.activate('missing'), error => error.code === 'WORKSPACE_NOT_FOUND');

  store.remove(created.id);
  assert.equal(store.read().workspaces.length, 0);
  assert.equal(store.read().workspace, null);
}

main().then(() => {
  console.log('structure-assistant DSH plugin tests passed');
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
