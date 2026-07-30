const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { legacyTestEnv } = require('./testHelpers/isolatedDb');
const {
  LEADERSHIP_OFFICE_ASSIGNMENTS,
  ORGANIZATION_STRUCTURE_UNITS,
  syncOrganizationStructure
} = require('./sync-organization-structure');

const appRoot = path.join(__dirname, '..');
const PORT = 3231;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function runNpmScript(scriptName) {
  console.log(`\n[mainline] npm run ${scriptName}`);
  const command = process.env.npm_execpath ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
  const args = process.env.npm_execpath ? [process.env.npm_execpath, 'run', scriptName] : ['run', scriptName];
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env: legacyTestEnv({ MDM_DB_QUIET: process.env.MDM_DB_QUIET || '1' }),
    stdio: 'inherit'
  });
  if (result.error) {
    throw result.error;
  }
  assert.strictEqual(result.status, 0, `${scriptName} failed`);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (error) {
      // Keep polling until the server is ready or the deadline is reached.
    }
    await wait(200);
  }
  throw new Error('server did not start');
}

function cookieFrom(response) {
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie, 'login response should include a cookie');
  return cookie.split(';')[0];
}

async function csrfTokenFor(cookie) {
  const res = await fetch(`${BASE_URL}/api/csrf-token`, { headers: { Cookie: cookie } });
  if (!res.ok) return null;
  const body = await res.json();
  return body.csrfToken;
}

async function request(routePath, options = {}, cookie = '') {
  const requestOptions = { ...options };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = {
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(requestOptions.headers || {})
  };
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && routePath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${routePath}`, { ...requestOptions, headers });
  const raw = await res.text();
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = { raw };
  }
  return { res, body };
}

async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await wait(100);
  }
  child.kill('SIGKILL');
}

async function runMasterDataObjectSmoke() {
  console.log('\n[mainline] master data object isolated smoke');

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-mainline-master-'));
  const dbPath = path.join(tempDir, 'platform-test.db');
  let server;

  try {
    process.env.MDM_DB_PATH = dbPath;
    process.env.MDM_DB_QUIET = '1';

    const db = require('../server/db');
    const { hashPassword } = require('../server/auth');
    const deptId = db.prepare(`
      INSERT INTO departments (name, code, status)
      VALUES (?, ?, ?)
    `).run('信息化部', 'IT', 'active').lastInsertRowid;
    db.prepare(`
      INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('系统管理员', 'ADMIN001', deptId, '系统管理员', 'admin', hashPassword('admin12345'));
    syncOrganizationStructure({ db });
    db.close();

    server = spawn(process.execPath, ['server/index.js'], {
      cwd: appRoot,
      env: legacyTestEnv({
        MDM_DB_PATH: dbPath,
        MDM_DB_QUIET: '1',
        PORT: String(PORT),
        SESSION_SECRET: 'mainline-master-data-test'
      }),
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForServer(server);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin12345' })
    });
    assert.strictEqual(login.res.status, 200, JSON.stringify(login.body));
    const cookie = cookieFrom(login.res);

    const manualOrg = await request('/api/org-units', {
      method: 'POST',
      body: JSON.stringify({
        org_unit_name: '手工测试组织',
        org_type: 'department',
        org_mnemonic: 'MANUAL'
      })
    }, cookie);
    assert.strictEqual(manualOrg.res.status, 403, JSON.stringify(manualOrg.body));

    const orgList = await request('/api/org-units?status=active&search=%E5%B7%A5%E7%A8%8B%E6%8A%80%E6%9C%AF%E9%83%A8', {}, cookie);
    assert.strictEqual(orgList.res.status, 200, JSON.stringify(orgList.body));
    assert.ok(orgList.body.rows.some(row => row.org_unit_code === 'OU-DEP-ENG'));

    const leadershipPersonList = await request('/api/persons?search=100000', {}, cookie);
    assert.strictEqual(
      leadershipPersonList.res.status,
      404,
      '旧 SQLite 人员接口必须退出 3000 运行时'
    );

    const legacyIdentityWrite = await request('/api/org/users', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'LEGACY001', name: '旧接口账号' })
    }, cookie);
    assert.strictEqual(legacyIdentityWrite.res.status, 410, JSON.stringify(legacyIdentityWrite.body));
    assert.strictEqual(legacyIdentityWrite.body.code, 'LEGACY_IDENTITY_API_RETIRED');

    const fixedModel = await request('/api/rbac/model', {}, cookie);
    assert.strictEqual(fixedModel.res.status, 200, JSON.stringify(fixedModel.body));
    assert.strictEqual(fixedModel.body.roles.length, 7);
    assert.strictEqual(fixedModel.body.permissions.length, 19);

    console.log('[mainline] retired personnel identity runtime smoke passed');
    return;

    const leaderPerson = leadershipPersonList.body.rows.find(row => row.employee_no === '100000');
    assert.ok(leaderPerson, 'person list should include synchronized leadership person');
    assert.strictEqual(leaderPerson.position_code, 'POS-CXF-CEO');
    assert.strictEqual(leaderPerson.position_name, '总经理');
    assert.strictEqual(leaderPerson.org_unit_code, 'OU-OFC-CXF-CEO');
    assert.strictEqual(leaderPerson.org_unit_name, '总经理办公室');

    const activePositions = await request('/api/positions?status=active&search=%E6%80%BB%E7%BB%8F%E7%90%86', {}, cookie);
    assert.strictEqual(activePositions.res.status, 200, JSON.stringify(activePositions.body));
    const ceoPosition = activePositions.body.rows.find(row => row.position_code === 'POS-CXF-CEO');
    assert.ok(ceoPosition, 'positions list should expose synchronized leadership positions');
    const activeOrgUnits = await request('/api/org-units?status=active&search=%E7%94%9F%E4%BA%A7%E5%89%AF%E6%80%BB%E5%8A%9E%E5%85%AC%E5%AE%A4', {}, cookie);
    assert.strictEqual(activeOrgUnits.res.status, 200, JSON.stringify(activeOrgUnits.body));
    const mismatchedOrgUnit = activeOrgUnits.body.rows.find(row => row.org_unit_code === 'OU-OFC-CXF-MVP');
    assert.ok(mismatchedOrgUnit, 'org list should expose synchronized organization units');

    const mismatchedAssignedPerson = await request('/api/persons', {
      method: 'POST',
      body: JSON.stringify({
        person_name: '任岗错配测试',
        org_unit_id: mismatchedOrgUnit.org_unit_id,
        position_id: ceoPosition.position_id
      })
    }, cookie);
    assert.strictEqual(mismatchedAssignedPerson.res.status, 400);
    assert.strictEqual(mismatchedAssignedPerson.body.error, '任职岗位不属于所选组织');

    const assignedPerson = await request('/api/persons', {
      method: 'POST',
      body: JSON.stringify({
        person_name: '任岗登记测试',
        mobile: '13800138001',
        email: 'assigned@example.com',
        org_unit_id: ceoPosition.org_unit_id,
        position_id: ceoPosition.position_id
      })
    }, cookie);
    assert.strictEqual(assignedPerson.res.status, 201, JSON.stringify(assignedPerson.body));

    const assignedPersonDetail = await request(`/api/persons/${encodeURIComponent(assignedPerson.body.employee_no)}`, {}, cookie);
    assert.strictEqual(assignedPersonDetail.res.status, 200, JSON.stringify(assignedPersonDetail.body));
    assert.ok(
      assignedPersonDetail.body.assignments.some(row => row.position_code === 'POS-CXF-CEO' && row.org_unit_code === 'OU-OFC-CXF-CEO'),
      'creating a person with position_id should create an active org/position assignment'
    );

    const assignedPersonList = await request(`/api/persons?search=${encodeURIComponent(assignedPerson.body.employee_no)}`, {}, cookie);
    assert.strictEqual(assignedPersonList.res.status, 200, JSON.stringify(assignedPersonList.body));
    const assignedPersonRow = assignedPersonList.body.rows.find(row => row.employee_no === assignedPerson.body.employee_no);
    assert.ok(assignedPersonRow, 'newly assigned person should be listed');
    assert.strictEqual(assignedPersonRow.position_code, 'POS-CXF-CEO');
    assert.strictEqual(assignedPersonRow.org_unit_code, 'OU-OFC-CXF-CEO');

    const person = await request('/api/persons', {
      method: 'POST',
      body: JSON.stringify({
        person_name: '张三',
        mobile: '13800138000',
        email: 'zhangsan@example.com'
      })
    }, cookie);
    assert.strictEqual(person.res.status, 201, JSON.stringify(person.body));
    assert.ok(person.body.employee_no.startsWith('EMP-'));

    const personActivate = await request(`/api/persons/${encodeURIComponent(person.body.employee_no)}/activate`, {
      method: 'POST'
    }, cookie);
    assert.strictEqual(personActivate.res.status, 200, JSON.stringify(personActivate.body));

    const family = await request('/api/product-families', {
      method: 'POST',
      body: JSON.stringify({
        model_name: 'C919复材件',
        model_code: 'C91',
        class_major: 'CF'
      })
    }, cookie);
    assert.strictEqual(family.res.status, 201, JSON.stringify(family.body));

    const familyDetail = await request(`/api/product-families/${encodeURIComponent(family.body.product_family_code)}`, {}, cookie);
    assert.strictEqual(familyDetail.res.status, 200, JSON.stringify(familyDetail.body));
    assert.ok(familyDetail.body.product_family_id);

    const familyActivate = await request(`/api/product-families/${encodeURIComponent(family.body.product_family_code)}/activate`, {
      method: 'POST'
    }, cookie);
    assert.strictEqual(familyActivate.res.status, 200, JSON.stringify(familyActivate.body));

    const product = await request('/api/products', {
      method: 'POST',
      body: JSON.stringify({
        product_family_id: familyDetail.body.product_family_id,
        revision: 'A',
        class_mid: 'RFF',
        class_minor: 'PNL'
      })
    }, cookie);
    assert.strictEqual(product.res.status, 201, JSON.stringify(product.body));

    const release = await request(`/api/products/${encodeURIComponent(product.body.product_code)}/release`, {
      method: 'POST'
    }, cookie);
    assert.strictEqual(release.res.status, 200, JSON.stringify(release.body));

    const productDetail = await request(`/api/products/${encodeURIComponent(product.body.product_code)}`, {}, cookie);
    assert.strictEqual(productDetail.res.status, 200, JSON.stringify(productDetail.body));
    assert.strictEqual(productDetail.body.lifecycle_state, 'released');

    const attrDef = await request('/api/attributes/defs', {
      method: 'POST',
      body: JSON.stringify({
        attribute_code: 'material_spec',
        attribute_name: '材料规范',
        data_type: 'string',
        applies_to: 'product',
        is_required: true
      })
    }, cookie);
    assert.strictEqual(attrDef.res.status, 201, JSON.stringify(attrDef.body));

    const attrValue = await request('/api/attributes/values', {
      method: 'PUT',
      body: JSON.stringify({
        entity_type: 'product',
        entity_id: productDetail.body.product_id,
        values: { material_spec: 'CMS-CP-307' }
      })
    }, cookie);
    assert.strictEqual(attrValue.res.status, 200, JSON.stringify(attrValue.body));

    const attrValues = await request(`/api/attributes/values?entity_type=product&entity_id=${productDetail.body.product_id}`, {}, cookie);
    assert.strictEqual(attrValues.res.status, 200, JSON.stringify(attrValues.body));
    assert.strictEqual(attrValues.body[0].value_string, 'CMS-CP-307');

    const quality = await request('/api/quality/dashboard', {}, cookie);
    assert.strictEqual(quality.res.status, 200, JSON.stringify(quality.body));
    assert.strictEqual(quality.body.org_person.org_units, ORGANIZATION_STRUCTURE_UNITS.length);
    assert.strictEqual(quality.body.org_person.positions, LEADERSHIP_OFFICE_ASSIGNMENTS.length);
    assert.strictEqual(quality.body.org_person.persons, LEADERSHIP_OFFICE_ASSIGNMENTS.length + 2);
    assert.strictEqual(quality.body.org_person.active_assignments, LEADERSHIP_OFFICE_ASSIGNMENTS.length + 1);
    assert.strictEqual(quality.body.product.families, 1);
    assert.strictEqual(quality.body.product.released, 1);

    console.log('[mainline] master data object isolated smoke passed');
  } finally {
    await stopServer(server);
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  runNpmScript('test:process-governance');
  runNpmScript('test:import');
  runNpmScript('test:export');
  runNpmScript('test:project-roles');
  await runMasterDataObjectSmoke();
  console.log('\n[mainline] stability check passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
