const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const scriptPath = path.join(__dirname, 'audit-route-write-permissions.js');
const output = execFileSync(process.execPath, [scriptPath, '--json'], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8'
});
const audit = JSON.parse(output);

assert.strictEqual(audit.unclassified.length, 0, 'all write routes must be classified');

assert.ok(
  audit.permissionGuarded.some(route =>
    route.file.endsWith('person.js') &&
    route.method === 'post' &&
    route.path === '/' &&
    route.permission === 'person:create'
  ),
  'person create route should be classified as permission guarded'
);

assert.ok(
  audit.permissionGuarded.some(route =>
    route.file.endsWith('org.js') &&
    route.method === 'post' &&
    route.path === '/users' &&
    route.permission === 'admin:access'
  ),
  'org user creation through requireOrgPermission should be classified as permission guarded'
);

assert.ok(
  audit.permissionGuarded.some(route =>
    route.file.endsWith('roles.js') &&
    route.method === 'post' &&
    route.path === '/' &&
    route.permission === 'admin:access'
  ),
  'role creation through writeAdminOnly should be classified as permission guarded'
);

assert.ok(
  audit.businessGuarded.some(route =>
    route.file.endsWith('todos.js') &&
    route.method === 'post' &&
    route.path === '/'
  ),
  'todo create route should be classified as business guarded'
);

assert.ok(
  audit.businessGuarded.some(route =>
    route.file.endsWith('mappings.js') &&
    route.method === 'post' &&
    route.path === '/' &&
    route.reason.includes('草稿创建')
  ),
  'mapping draft creation should be classified as business guarded'
);

console.log('Route write permission audit test passed');
