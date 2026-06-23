const assert = require('assert');
const fs = require('fs');
const path = require('path');

const appRoot = path.join(__dirname, '..');
const scriptPath = path.join(__dirname, 'perf-local-concurrency.js');
const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));

assert.strictEqual(
  packageJson.scripts['perf:local-concurrency'],
  'node scripts/perf-local-concurrency.js',
  'package.json should expose the local concurrency performance script'
);

assert.ok(fs.existsSync(scriptPath), 'local concurrency performance script should exist');
const source = fs.readFileSync(scriptPath, 'utf8');

[
  '/api/org/login',
  '/api/org/me',
  '/api/role-workbench?mode=todo',
  '/api/role-workbench?mode=all',
  '/api/process-governance/sankey',
  '/api/activity/heatmap'
].forEach(endpoint => {
  assert.ok(source.includes(endpoint), `performance script should cover ${endpoint}`);
});

assert.ok(source.includes('ROLE_WORKBENCH_P95_LIMIT_MS'), 'performance script should enforce role workbench p95 threshold');
assert.ok(source.includes('LOGIN_P95_LIMIT_MS'), 'performance script should enforce login p95 threshold');
assert.ok(source.includes('availability_percent'), 'performance script should report availability');
assert.ok(source.includes('response_kb'), 'performance script should report response size');
assert.ok(!source.includes('Promise.all(READ_ENDPOINTS'), 'performance script should not multiply 10 users into 50 parallel endpoint requests');
assert.ok(!source.includes('console.log(password'), 'performance script must not print passwords');
assert.ok(!source.includes('console.log(cookie'), 'performance script must not print cookies');

console.log('Local performance script contract test passed');
