const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, legacyTestEnv, stopServer, testDbPath } = require('./testHelpers/isolatedDb');

const PORT = 3219;
const BASE_URL = `http://127.0.0.1:${PORT}`;

const db = require('../server/db');
if (path.resolve(db.__dbPath) !== path.resolve(testDbPath)) {
  throw new Error('delete route test is not using the isolated database');
}
const { hashPassword } = require('../server/auth');
const csrfTokens = new Map();

function seed() {
  const dept = db.prepare("INSERT INTO departments (name, code, status) VALUES ('信息化部', 'IT', 'active')").run().lastInsertRowid;
  const admin = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '系统管理员', 'ADMIN001', dept, '系统管理员', 'admin', hashPassword('admin123')
  ).lastInsertRowid;
  const adminRole = db.prepare("SELECT role_id FROM roles WHERE role_code='admin'").get();
  assert.ok(adminRole, 'admin role should exist');
  db.prepare('INSERT INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(admin, adminRole.role_id, admin);

  const submitter = db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    '普通用户', 'SUB001', dept, '专员', 'submitter', hashPassword('pass1234')
  ).lastInsertRowid;

  const capRoot = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, created_by) VALUES ('根能力', 'L1', ?, ?)").run(dept, admin).lastInsertRowid;
  const capChild = db.prepare("INSERT INTO capabilities (name, level, owner_dept_id, parent_id, created_by) VALUES ('子能力', 'L2', ?, ?, ?)").run(dept, capRoot, admin).lastInsertRowid;
  const proc = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, created_by) VALUES (?, ?, ?, ?)').run('删除测试流程', capChild, dept, admin).lastInsertRowid;
  const mapping = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(proc, dept, submitter).lastInsertRowid;
  const field = db.prepare("INSERT INTO field_entries (mapping_id, field_name_cn, submitted_by) VALUES (?, '测试字段', ?)").run(mapping, submitter).lastInsertRowid;
  db.prepare("INSERT INTO field_identities (field_entry_id, authoritative_system) VALUES (?, 'MDM')").run(field);
  db.prepare("INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content) VALUES (?, ?, 'general', ?, '删除测试待办')").run(dept, dept, mapping);
  db.prepare("INSERT INTO terms (term, definition, process_id, created_by) VALUES ('删除测试术语', '定义', ?, ?)").run(proc, admin);

  const ou = db.prepare("INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, status, created_by) VALUES ('OU_DEL', '删除组织', 'department', 'OUD', 'active', ?)").run(admin).lastInsertRowid;
  const person = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_DEL', '删除人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  const position = db.prepare("INSERT INTO position (position_code, position_name, org_unit_id, pos_mnemonic, status, created_by) VALUES ('POS_DEL', '删除岗位', ?, 'POSD', 'active', ?)").run(ou, admin).lastInsertRowid;
  db.prepare('INSERT INTO person_position_assignment (person_id, position_id, is_primary, status, created_by) VALUES (?, ?, ?, ?, ?)').run(person, position, 1, 'active', admin);
  db.prepare('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?').run(person, ou);

  const ouPositionOnly = db.prepare("INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, status, created_by) VALUES ('OU_POS', '岗位测试组织', 'department', 'OUP', 'active', ?)").run(admin).lastInsertRowid;
  const personPositionOnly = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_POS', '岗位测试人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  const positionOnly = db.prepare("INSERT INTO position (position_code, position_name, org_unit_id, pos_mnemonic, status, created_by) VALUES ('POS_ONLY', '单独删除岗位', ?, 'POSO', 'active', ?)").run(ouPositionOnly, admin).lastInsertRowid;
  db.prepare('INSERT INTO person_position_assignment (person_id, position_id, is_primary, status, created_by) VALUES (?, ?, ?, ?, ?)').run(personPositionOnly, positionOnly, 1, 'active', admin);

  const personOnly = db.prepare("INSERT INTO person (employee_no, person_name, employment_status, status, created_by) VALUES ('P_ONLY', '单独删除人员', 'active', 'active', ?)").run(admin).lastInsertRowid;
  db.prepare('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?').run(personOnly, ouPositionOnly);

  const pf = db.prepare("INSERT INTO product_family (product_family_code, model_name, model_code, class_major, status, created_by) VALUES ('PF_DEL', '产品接口测试族', 'PFD', 'A', 'active', ?)").run(admin).lastInsertRowid;
  const prod = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, created_by) VALUES ('PROD_DEL', ?, 'A', 'released', ?)").run(pf, admin).lastInsertRowid;
  const prod2 = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, superseded_by_product_id, created_by) VALUES ('PROD_REF', ?, 'B', 'released', ?, ?)").run(pf, prod, admin).lastInsertRowid;
  const pfCascade = db.prepare("INSERT INTO product_family (product_family_code, model_name, model_code, class_major, status, created_by) VALUES ('PF_CASCADE', '产品族级联测试', 'PFC', 'A', 'active', ?)").run(admin).lastInsertRowid;
  const prodCascade = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, created_by) VALUES ('PROD_CASCADE', ?, 'A', 'released', ?)").run(pfCascade, admin).lastInsertRowid;
  const prodCascadeRef = db.prepare("INSERT INTO product (product_code, product_family_id, revision, lifecycle_state, superseded_by_product_id, created_by) VALUES ('PROD_CASCADE_REF', ?, 'B', 'released', ?, ?)").run(pfCascade, prodCascade, admin).lastInsertRowid;
  const attr = db.prepare("INSERT INTO attribute_def (attribute_code, attribute_name, data_type, applies_to, created_by) VALUES ('ATTR_DEL', '删除属性', 'string', 'product', ?)").run(admin).lastInsertRowid;
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product', ?, ?, 'v', ?)").run(prod, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product_family', ?, ?, 'v', ?)").run(pf, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product', ?, ?, 'v', ?)").run(prodCascade, attr, admin);
  db.prepare("INSERT INTO attribute_value (entity_type, entity_id, attribute_def_id, value_string, created_by) VALUES ('product_family', ?, ?, 'v', ?)").run(pfCascade, attr, admin);
  const classRoot = db.prepare("INSERT INTO class_node (class_code, class_name, class_type, created_by) VALUES ('CLS_ROOT', '根分类', 'product', ?)").run(admin).lastInsertRowid;
  const classChild = db.prepare("INSERT INTO class_node (class_code, class_name, class_type, parent_class_node_id, created_by) VALUES ('CLS_CHILD', '子分类', 'product', ?, ?)").run(classRoot, admin).lastInsertRowid;
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product', ?, ?, ?)").run(prod, classChild, admin);
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product', ?, ?, ?)").run(prodCascade, classChild, admin);
  db.prepare("INSERT INTO entity_class_membership (entity_type, entity_id, class_node_id, created_by) VALUES ('product_family', ?, ?, ?)").run(pfCascade, classChild, admin);
  db.prepare("INSERT INTO external_system (system_code, system_name, created_by) VALUES ('EXTDEL', '外部删除系统', ?)").run(admin);
  db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('product', ?, 'EXTDEL', 'P-1', ?)").run(prod, admin);
  db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('person', ?, 'EXTDEL', 'P-2', ?)").run(personOnly, admin);
  const externalIdentity = db.prepare("INSERT INTO external_identity (entity_type, entity_id, system_code, external_key, created_by) VALUES ('manual_test', 999, 'EXTDEL', 'MANUAL-1', ?)").run(admin).lastInsertRowid;

  return { proc, capRoot, mapping, ou, person, position, positionOnly, personOnly, pf, prod, prod2, pfCascade, prodCascade, prodCascadeRef, attr, externalIdentity };
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) {
          clearInterval(timer);
          resolve();
        }
      } catch (e) {
        if (Date.now() - started > 10000) {
          clearInterval(timer);
          reject(new Error('server did not start'));
        }
      }
    }, 200);
  });
}

async function request(routePath, options = {}, cookie = '') {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && routePath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  let body = {};
  try { body = await res.json(); } catch (e) {}
  return { res, body };
}

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

async function login(employeeNo, password) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
}

(async () => {
  let server;

  try {
    const ids = seed();
    server = spawn(process.execPath, ['server/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: legacyTestEnv({ PORT: String(PORT), SESSION_SECRET: 'delete-test-secret' }),
      stdio: 'inherit'
    });

    await waitForServer();

    const unauth = await request('/api/products/PROD_DEL', { method: 'DELETE' });
    assert.strictEqual(unauth.res.status, 401);

    const submitterCookie = await login('SUB001', 'pass1234');
    const forbidden = await request('/api/products/PROD_DEL', { method: 'DELETE' }, submitterCookie);
    assert.strictEqual(forbidden.res.status, 403);

    const adminCookie = await login('ADMIN001', 'admin123');

    let del = await request('/api/products/PROD_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product WHERE product_code=?').get('PROD_DEL').c, 0);
    assert.strictEqual(db.prepare('SELECT superseded_by_product_id FROM product WHERE product_id=?').get(ids.prod2).superseded_by_product_id, null);

    del = await request('/api/product-families/PF_CASCADE', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product_family WHERE product_family_id=?').get(ids.pfCascade).c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM product WHERE product_family_id=?').get(ids.pfCascade).c, 0);

    del = await request('/api/class-nodes/CLS_ROOT', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare("SELECT COUNT(*) AS c FROM class_node WHERE class_code IN ('CLS_ROOT','CLS_CHILD')").get().c, 0);

    del = await request(`/api/processes/${ids.proc}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM mappings WHERE id=?').get(ids.mapping).c, 0);
    assert.strictEqual(db.prepare("SELECT process_id FROM terms WHERE term='删除测试术语'").get().process_id, null);

    del = await request(`/api/capabilities/${ids.capRoot}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM capabilities WHERE id=?').get(ids.capRoot).c, 0);

    del = await request('/api/positions/POS_ONLY', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM position WHERE position_code=?').get('POS_ONLY').c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM person_position_assignment WHERE position_id=?').get(ids.positionOnly).c, 0);

    del = await request('/api/persons/P_ONLY', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM person WHERE employee_no=?').get('P_ONLY').c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM org_unit WHERE manager_person_id=?').get(ids.personOnly).c, 0);

    del = await request('/api/org-units/OU_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM org_unit WHERE org_unit_code=?').get('OU_DEL').c, 0);

    del = await request('/api/attributes/defs/ATTR_DEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);

    del = await request(`/api/external/identities/${ids.externalIdentity}`, { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM external_identity WHERE external_identity_id=?').get(ids.externalIdentity).c, 0);

    del = await request('/api/external/systems/EXTDEL', { method: 'DELETE' }, adminCookie);
    assert.strictEqual(del.res.status, 200);

    console.log('Delete route smoke passed');
  } finally {
    await stopServer(server);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
})().catch(err => {
  console.error(err);
  process.exit(1);
});
