const http = require('http');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:3000';
// Use project-local temp to avoid cross-platform path issues
const COOKIE_FILE = path.join(__dirname, '..', '.smoke-cookie.txt');

function readCookie() {
  try {
    const raw = fs.readFileSync(COOKIE_FILE, 'utf8');
    // Parse Netscape cookie file format: skip comment lines, extract Tab-separated fields
    const lines = raw.split(/\r?\n/);
    let cookie = '';
    for (const line of lines) {
      if (line.startsWith('# ') || line.startsWith('#\t') || line === '#HttpOnly_' || !line.trim()) continue;
      // Handle #HttpOnly_ prefix in Netscape cookie format
      const cleanLine = line.startsWith('#HttpOnly_') ? line.substring(1) : line;
      const parts = cleanLine.split('\t');
      if (parts.length >= 7) {
        if (cookie) cookie += '; ';
        cookie += parts[5] + '=' + parts[6];
      }
    }
    if (!cookie) throw new Error('No cookie parsed');
    return cookie;
  } catch (e) {
    console.error('Cookie error:', e.message);
    process.exit(1);
  }
}

async function request(method, path, body, cookie) {
  const url = new URL(path, BASE);
  const options = {
    hostname: url.hostname, port: url.port, path: url.pathname + url.search,
    method, headers: { 'Content-Type': 'application/json' }
  };
  if (cookie) options.headers['Cookie'] = cookie;
  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function main() {
  const cookie = readCookie();
  let pass = 0, fail = 0;
  function check(name, ok) { if (ok) { pass++; console.log('  PASS ' + name); } else { fail++; console.error('  FAIL ' + name); } }

  console.log('\n=== RBAC Smoke Test ===\n');

  // 1. List roles
  const listRes = await request('GET', '/api/roles', null, cookie);
  check('GET /api/roles returns array', Array.isArray(listRes.body) && listRes.body.length >= 4);

  // 2. Create custom role
  const createRes = await request('POST', '/api/roles', { role_code: 'smoke_test', role_name: '冒烟测试角色', description: 'test' }, cookie);
  check('POST /api/roles creates role', createRes.status === 201 && createRes.body.role_id);
  const newRoleId = createRes.body.role_id;

  // 3. Get role detail
  const detailRes = await request('GET', '/api/roles/' + newRoleId, null, cookie);
  check('GET /api/roles/:id returns detail', detailRes.status === 200 && detailRes.body.role_code === 'smoke_test');

  // 4. Update role
  const updateRes = await request('PUT', '/api/roles/' + newRoleId, { role_name: '冒烟测试角色改名' }, cookie);
  check('PUT /api/roles/:id updates role', updateRes.body.success);

  // 5. Get permissions list
  const permsRes = await request('GET', '/api/org/permissions', null, cookie);
  check('GET /api/org/permissions returns grouped perms', permsRes.status === 200 && typeof permsRes.body === 'object');

  // 6. Get role permission matrix
  const matrixRes = await request('GET', '/api/roles/' + newRoleId + '/permissions', null, cookie);
  check('GET /api/roles/:id/permissions returns matrix', matrixRes.status === 200 && Array.isArray(matrixRes.body.matrix));

  // 7. Assign permissions to role
  const somePermIds = matrixRes.body.matrix.slice(0, 3).map(p => p.perm_id);
  const assignRes = await request('PUT', '/api/roles/' + newRoleId + '/permissions', { perm_ids: somePermIds }, cookie);
  check('PUT /api/roles/:id/permissions assigns perms', assignRes.body.success && assignRes.body.count === somePermIds.length);

  // 8. Verify permission assignment
  const matrixRes2 = await request('GET', '/api/roles/' + newRoleId + '/permissions', null, cookie);
  const assignedCount = matrixRes2.body.matrix.filter(p => p.assigned).length;
  check('Role has correct perm count after assignment', assignedCount === somePermIds.length);

  // 9. Get user roles (admin user)
  const usersList = await request('GET', '/api/org/users', null, cookie);
  const adminUserId = usersList.body[0]?.id;
  if (adminUserId) {
    const userRolesRes = await request('GET', '/api/org/users/' + adminUserId + '/roles', null, cookie);
    check('GET /api/org/users/:id/roles returns array', Array.isArray(userRolesRes.body));
  } else {
    check('SKIP: no users found', true);
  }

  // 10. Password status
  const pwStatusRes = await request('GET', '/api/org/me/password-status', null, cookie);
  check('GET /api/org/me/password-status returns boolean', typeof pwStatusRes.body.is_default_password === 'boolean');

  // 11. Delete custom role
  const delRes = await request('DELETE', '/api/roles/' + newRoleId, null, cookie);
  check('DELETE /api/roles/:id deletes role', delRes.body.success);

  // 12. Cannot delete system role
  const adminRole = listRes.body.find(r => r.is_system);
  if (adminRole) {
    const delSysRes = await request('DELETE', '/api/roles/' + adminRole.role_id, null, cookie);
    check('DELETE system role returns 403', delSysRes.status === 403);
  }

  // 13. Permission check — unauthenticated request
  const noAuthRes = await request('GET', '/api/roles', null, null);
  check('Unauthenticated GET /api/roles returns 401', noAuthRes.status === 401);

  console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
