// Runs owned temporary SQLite fixtures and subprocesses; never connects MySQL,
// starts an existing service, or writes the shared application database.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ORGANIZATION_STRUCTURE_UNITS } = require('./sync-organization-structure');

const appRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-legacy-entrypoints-'));
const fixtureDb = path.join(tempRoot, 'fixture.db');
const sourcePath = path.join(tempRoot, 'historical-organization-fixture.md');
const sharedPath = path.join(appRoot, 'data/platform.db');
const before = fs.existsSync(sharedPath) ? fs.statSync(sharedPath) : null;
const env = { ...process.env, NODE_ENV: 'test', MDM_DB_QUIET: '1' };
for (const key of ['MDM_DB_PATH', 'MDM_ALLOW_LEGACY_TEST_MODE', 'MDM_IDENTITY_READ_MODEL', 'PROCESS_GOVERNANCE_READ_MODEL']) delete env[key];

function run(script, overrides = {}, args = []) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: appRoot, env: { ...env, ...overrides }, encoding: 'utf8', timeout: 30000
  });
  if (result.error) throw result.error;
  return result;
}

try {
  fs.writeFileSync(sourcePath, ORGANIZATION_STRUCTURE_UNITS.map(unit => `${unit.code} ${unit.sourceLabel}`).join('\n'));
  const blocked = [
    [{ MDM_DB_PATH: fixtureDb }, 'LEGACY_ORGANIZATION_SYNC_ISOLATED_ONLY'],
    [{ MDM_ALLOW_LEGACY_TEST_MODE: '1' }, 'MDM_DB_PATH is required'],
    [{ MDM_ALLOW_LEGACY_TEST_MODE: '1', MDM_DB_PATH: sharedPath }, 'LEGACY_SQLITE_SHARED_DB_FORBIDDEN'],
    [{ NODE_ENV: 'production', MDM_ALLOW_LEGACY_TEST_MODE: '1', MDM_DB_PATH: fixtureDb }, 'LEGACY_ORGANIZATION_SYNC_ISOLATED_ONLY']
  ];
  for (const [overrides, code] of blocked) {
    const result = run('sync-organization-structure.js', overrides, ['--source', sourcePath]);
    assert.notEqual(result.status, 0);
    assert(result.stderr.includes(code), result.stderr);
    assert(!fs.existsSync(fixtureDb), 'rejected invocation must not create a database');
  }
  const fixtureEnv = { MDM_ALLOW_LEGACY_TEST_MODE: '1', MDM_DB_PATH: fixtureDb };
  const missingSource = run('sync-organization-structure.js', fixtureEnv);
  assert.notEqual(missingSource.status, 0);
  assert(missingSource.stderr.includes('LEGACY_ORGANIZATION_SOURCE_REQUIRED'));
  assert(!fs.existsSync(fixtureDb), 'missing source must be rejected before loading SQLite');
  const missingBaselineSource = run('setup-local-baseline.js', fixtureEnv);
  assert.notEqual(missingBaselineSource.status, 0);
  assert(missingBaselineSource.stderr.includes('LEGACY_SOURCE_REQUIRED'));
  assert(!fs.existsSync(fixtureDb), 'baseline missing source must not initialize SQLite');
  const sharedBaseline = run('setup-local-baseline.js', { ...fixtureEnv, MDM_DB_PATH: sharedPath }, ['--source', sourcePath]);
  assert.notEqual(sharedBaseline.status, 0);
  assert(sharedBaseline.stderr.includes('LEGACY_SQLITE_SHARED_DB_FORBIDDEN'));
  const invalidSourcePath = path.join(tempRoot, 'incomplete-fixture.md');
  fs.writeFileSync(invalidSourcePath, '# incomplete historical fixture');
  const invalidBaseline = run('setup-local-baseline.js', fixtureEnv, ['--source', invalidSourcePath]);
  assert.notEqual(invalidBaseline.status, 0);
  assert(invalidBaseline.stderr.includes('历史组织夹具输入缺少'));
  assert(!fs.existsSync(fixtureDb), 'invalid baseline source must not initialize SQLite');
  const success = run('sync-organization-structure.js', fixtureEnv, ['--source', sourcePath]);
  assert.equal(success.status, 0, success.stderr);
  const second = run('sync-organization-structure.js', fixtureEnv, ['--source', sourcePath]);
  assert.equal(second.status, 0, second.stderr);
  assert(fs.existsSync(fixtureDb));

  const smoke = run('smoke-test.js', { MDM_DB_PATH: sharedPath });
  assert.equal(smoke.status, 0, smoke.stderr);
  assert(smoke.stdout.includes('isolated schema smoke passed'));
  const after = fs.existsSync(sharedPath) ? fs.statSync(sharedPath) : null;
  assert.equal(Boolean(after), Boolean(before));
  if (before) {
    assert.equal(after.mtimeMs, before.mtimeMs);
    assert.equal(after.size, before.size);
  }
  const scripts = require('../package.json').scripts;
  assert(!scripts.smoke && !scripts['sync:organization-structure'] && !scripts['setup:local-baseline']);
  for (const name of ['legacy-sqlite:smoke', 'legacy-sqlite:sync-organization-structure', 'legacy-sqlite:setup-local-baseline']) assert(scripts[name]);
  for (const name of ['legacy-sqlite:init-db', 'legacy-sqlite:sync-process-org', 'legacy-sqlite:import-process-governance', 'legacy-sqlite:check-process-governance']) assert(!scripts[name]);
  console.log('Legacy SQLite entrypoints passed: refusal before DB load, explicit fixture sync/repeat, owned smoke fixture, shared DB unchanged');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
