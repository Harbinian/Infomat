const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'roleWorkbench.js'), 'utf8');

assert.ok(source.includes('WORKBENCH_CACHE_TTL_MS'), 'role workbench should declare a short cache TTL');
assert.ok(source.includes('cachedProcessContextBundle'), 'role workbench should cache process context nodes and edges');
assert.ok(source.includes('buildRoleGroupsCached'), 'role workbench should cache role guide grouping');
assert.ok(source.includes('Promise.all(['), 'role workbench should load independent work item sources in parallel');
assert.ok(source.includes('clearWorkbenchCaches'), 'role workbench should expose cache reset for tests');

console.log('Role workbench performance contract test passed');
