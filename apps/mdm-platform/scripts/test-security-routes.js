const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const ExcelJS = require('exceljs');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword, verifyPassword } = require('../server/auth');

const PORT = 3199;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function envWithoutSessionSecret(extra = {}) {
  const env = { ...process.env, ...extra };
  delete env.SESSION_SECRET;
  return env;
}

function resetData() {
  db.exec(`
    UPDATE departments SET manager_user_id=NULL, created_by=NULL, updated_by=NULL, data_owner_user_id=NULL;
    DELETE FROM version_log;
    DELETE FROM conflict_coordination_history;
    DELETE FROM conflict_assignments;
    DELETE FROM change_set;
    DELETE FROM field_rejection_reasons;
    DELETE FROM todos;
    DELETE FROM approval_history;
    DELETE FROM approval_tasks;
    DELETE FROM field_conflicts;
    DELETE FROM term_conflicts;
    DELETE FROM field_identities;
    DELETE FROM field_entries;
    DELETE FROM attribute_value;
    DELETE FROM entity_class_membership;
    DELETE FROM external_identity;
    DELETE FROM product;
    DELETE FROM product_family;
    DELETE FROM person_position_assignment;
    DELETE FROM person;
    DELETE FROM position;
    DELETE FROM org_unit;
    DELETE FROM class_node;
    DELETE FROM attribute_def;
    DELETE FROM code_sequences;
    DELETE FROM mapping_related_departments;
    DELETE FROM mapping_systems;
    DELETE FROM mappings;
    DELETE FROM processes;
    DELETE FROM capabilities;
    DELETE FROM systems;
    DELETE FROM terms;
    DELETE FROM user_dept_roles;
    DELETE FROM users;
    DELETE FROM departments;
  `);
}

function insertUser(name, employeeNo, departmentId, role) {
  return db.prepare('INSERT INTO users (name, employee_no, department_id, post, role, password_hash) VALUES (?, ?, ?, ?, ?, ?)').run(
    name,
    employeeNo,
    departmentId,
    role,
    role,
    hashPassword('pass1234')
  ).lastInsertRowid;
}

function ensureLimitedProductFamilyEditor(userId, assignedBy) {
  db.prepare(`
    INSERT OR IGNORE INTO roles (role_code, role_name, description)
    VALUES ('security_pf_editor', '安全测试产品族受限维护', '仅用于安全测试的字段约束角色')
  `).run();
  const role = db.prepare("SELECT role_id FROM roles WHERE role_code='security_pf_editor'").get();

  db.prepare(`
    INSERT OR IGNORE INTO permissions (perm_code, resource, action, field_constraints, description)
    VALUES ('product_family:update', 'product_family', 'update', ?, '受限产品族维护')
  `).run(JSON.stringify({ readonly: ['model_name'] }));
  db.prepare(`
    UPDATE permissions
    SET field_constraints=?
    WHERE perm_code='product_family:update'
  `).run(JSON.stringify({ readonly: ['model_name'] }));

  db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, perm_id)
    SELECT ?, perm_id FROM permissions WHERE perm_code='product_family:update'
  `).run(role.role_id);
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(userId, role.role_id, assignedBy);
}

function seedData() {
  const deptA = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('销售部', 'SALE').lastInsertRowid;
  const deptB = db.prepare('INSERT INTO departments (name, code) VALUES (?, ?)').run('财务部', 'FIN').lastInsertRowid;
  const admin = insertUser('系统管理员', 'ADMIN001', deptA, 'admin');
  const reviewer = insertUser('评审人', 'REV001', deptA, 'reviewer');
  const submitterA = insertUser('销售报送人', 'SALE001', deptA, 'submitter');
  const submitterB = insertUser('财务报送人', 'FIN001', deptB, 'submitter');
  const ownerB = insertUser('财务负责人', 'OWNFIN', deptB, 'owner');
  const rbacAdmin = insertUser('RBAC管理员', 'RBACADM', deptA, 'submitter');
  const rbacOwner = insertUser('RBAC负责人', 'RBACOWN', deptB, 'submitter');
  const limitedProductFamilyEditor = insertUser('受限产品族维护员', 'PFEDIT', deptA, 'submitter');
  const adminRole = db.prepare("SELECT role_id FROM roles WHERE role_code='admin'").get();
  const ownerRole = db.prepare("SELECT role_id FROM roles WHERE role_code='owner'").get();
  assert.ok(adminRole, 'admin RBAC role should exist');
  assert.ok(ownerRole, 'owner RBAC role should exist');
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(rbacAdmin, adminRole.role_id, admin);
  db.prepare('INSERT OR IGNORE INTO user_roles (user_id, role_id, assigned_by) VALUES (?, ?, ?)').run(rbacOwner, ownerRole.role_id, admin);
  ensureLimitedProductFamilyEditor(limitedProductFamilyEditor, admin);
  const orgUnitId = db.prepare(`
    INSERT INTO org_unit (org_unit_code, org_unit_name, org_type, org_mnemonic, created_by, updated_by)
    VALUES ('SALE-ORG', '销售组织', 'department', 'SALEORG', ?, ?)
  `).run(admin, admin).lastInsertRowid;

  const systemA = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('CRM', deptA).lastInsertRowid;
  const systemB = db.prepare('INSERT INTO systems (name, dept_id) VALUES (?, ?)').run('ERP', deptB).lastInsertRowid;
  const capA = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('销售能力', 'L1', deptA, 'pending').lastInsertRowid;
  const capB = db.prepare('INSERT INTO capabilities (name, level, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('财务能力', 'L1', deptB, 'pending').lastInsertRowid;
  const processA = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('销售客户维护', capA, deptA, 'pending').lastInsertRowid;
  const processB = db.prepare('INSERT INTO processes (name, capability_id, owner_dept_id, status) VALUES (?, ?, ?, ?)').run('财务客户维护', capB, deptB, 'pending').lastInsertRowid;

  const mappingA = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'published', ?, 5)").run(processA, deptA, submitterA).lastInsertRowid;
  const mappingB = db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'published', ?, 5)").run(processB, deptB, submitterB).lastInsertRowid;
  db.prepare("INSERT INTO mappings (process_id, owner_dept_id, status, submitted_by, current_step) VALUES (?, ?, 'draft', ?, 1)").run(processA, deptA, submitterA);
  db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role) VALUES (?, ?, 'primary')").run(mappingA, systemA);
  db.prepare("INSERT INTO mapping_systems (mapping_id, system_id, system_role) VALUES (?, ?, 'primary')").run(mappingB, systemB);

  const fieldA = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', '销售字段', ?)
  `).run(mappingA, submitterA).lastInsertRowid;
  const fieldB = db.prepare(`
    INSERT INTO field_entries (mapping_id, field_name_cn, field_name_en, data_object, field_type, note, submitted_by)
    VALUES (?, '客户名称', 'customer_name', '客户', '文本', '财务字段', ?)
  `).run(mappingB, submitterB).lastInsertRowid;

  const todoB = db.prepare(`
    INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, urgency)
    VALUES (?, ?, 'field_confirm', ?, ?, '财务字段待确认', 'high')
  `).run(deptA, deptB, mappingB, fieldB).lastInsertRowid;

  const conflict = db.prepare(`
    INSERT INTO field_conflicts (field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a, submitter_b, value_b, dept_a, dept_b, severity)
    VALUES (?, ?, 'note', ?, '销售字段', ?, '财务字段', ?, ?, 'warn')
  `).run(fieldA, fieldB, submitterA, submitterB, deptA, deptB).lastInsertRowid;
  const termConflict = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity)
    VALUES ('客户', ?, '销售客户', ?, '开票客户', 'warn')
  `).run(deptA, deptB).lastInsertRowid;
  db.prepare("INSERT INTO terms (term, definition, scope, created_by, status) VALUES ('客户', '客户定义', '集团', ?, 'approved')").run(admin);
  db.prepare("INSERT INTO terms (term, definition, scope, created_by, status) VALUES ('客户号', '客户编号', '系统', ?, 'approved')").run(admin);

  return { capA, processA, mappingA, mappingB, fieldB, todoB, conflict, termConflict, submitterA, orgUnitId, orgUnitCode: 'SALE-ORG' };
}

async function waitForServer() {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch (error) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }
  throw new Error('server did not start');
}

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(options.headers || {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('spreadsheet')) {
    return { res, buffer: Buffer.from(await res.arrayBuffer()) };
  }
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = { raw: text };
    }
  }
  return { res, body };
}

async function login(employeeNo) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password: 'pass1234' })
  });
  assert.strictEqual(result.res.status, 200);
  return result.res.headers.get('set-cookie').split(';')[0];
}

function columnIndexByHeader(worksheet, headerText) {
  const headerRow = worksheet.getRow(1);
  for (let column = 1; column <= headerRow.cellCount; column += 1) {
    if (headerRow.getCell(column).value === headerText) return column;
  }
  throw new Error(`missing worksheet header: ${headerText}`);
}

async function assertForbidden(label, routePath, options, cookie) {
  const result = await request(routePath, options, cookie);
  assert.strictEqual(result.res.status, 403, label);
  return result;
}

async function assertServerRequiresSessionSecret() {
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: envWithoutSessionSecret({ PORT: '3299', NODE_ENV: 'production' }),
    stdio: ['ignore', 'ignore', 'pipe']
  });

  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr += chunk.toString('utf8');
  });

  const exitCode = await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill();
      resolve(null);
    }, 1500);
    child.on('exit', code => {
      clearTimeout(timer);
      resolve(code);
    });
  });

  assert.notStrictEqual(exitCode, null, '生产模式缺少 SESSION_SECRET 时服务不应继续运行');
  assert.notStrictEqual(exitCode, 0, '生产模式缺少 SESSION_SECRET 时服务应失败退出');
  assert.ok(stderr.includes('SESSION_SECRET'), '失败信息应提示 SESSION_SECRET');
}

async function assertUserDirectoryGuards(adminCookie, reviewerCookie, submitterCookie) {
  const submitterUsers = await request('/api/org/users', {}, submitterCookie);
  assert.strictEqual(submitterUsers.res.status, 403, '普通用户不能查看全员用户目录');

  const adminUsers = await request('/api/org/users', {}, adminCookie);
  assert.strictEqual(adminUsers.res.status, 200, '管理员仍可查看用户目录');
  assert.ok(adminUsers.body.some(row => row.employee_no === 'SALE001'));
  assert.ok(adminUsers.body.every(row => row.password_hash === undefined));

  const submitterAssignableUsers = await request('/api/org/users/assignable', {}, submitterCookie);
  assert.strictEqual(submitterAssignableUsers.res.status, 403, '普通报送人不能查看指派候选人列表');

  const reviewerAssignableUsers = await request('/api/org/users/assignable', {}, reviewerCookie);
  assert.strictEqual(reviewerAssignableUsers.res.status, 200, '冲突处理角色可查看最小指派候选人列表');
  assert.ok(reviewerAssignableUsers.body.some(row => row.name === '财务负责人'));
  assert.ok(reviewerAssignableUsers.body.every(row => row.id && row.name));
  assert.ok(reviewerAssignableUsers.body.every(row => row.employee_no === undefined));
  assert.ok(reviewerAssignableUsers.body.every(row => row.post === undefined));
  assert.ok(reviewerAssignableUsers.body.every(row => row.role === undefined));
}

async function assertDefaultPasswordGuards(adminCookie) {
  const fixedCreate = await request('/api/org/users', {
    method: 'POST',
    body: JSON.stringify({
      name: '固定默认口令账号',
      employee_no: 'FIXPW',
      role: 'submitter',
      password: 'init1234'
    })
  }, adminCookie);
  assert.strictEqual(fixedCreate.res.status, 400, '管理员不能使用固定默认口令创建账号');

  const generatedCreate = await request('/api/org/users', {
    method: 'POST',
    body: JSON.stringify({
      name: '随机初始口令账号',
      employee_no: 'GENPW',
      role: 'submitter'
    })
  }, adminCookie);
  assert.strictEqual(generatedCreate.res.status, 200, '未提供密码时应由服务端生成一次性初始密码');
  assert.ok(generatedCreate.body.id);
  assert.ok(generatedCreate.body.initial_password, '创建响应应返回一次性初始密码给管理员');
  assert.notStrictEqual(generatedCreate.body.initial_password, 'init1234');
  assert.ok(generatedCreate.body.initial_password.length >= 12);

  const createdRow = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id=?').get(generatedCreate.body.id);
  assert.ok(createdRow);
  assert.strictEqual(createdRow.must_change_password, 1, '随机初始口令账号应要求首次改密');
  assert.ok(!verifyPassword('init1234', createdRow.password_hash), '生成的初始密码不能等于固定默认口令');
  assert.ok(verifyPassword(generatedCreate.body.initial_password, createdRow.password_hash), '生成的初始密码应能登录');

  const fixedReset = await request(`/api/org/users/${generatedCreate.body.id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password: 'init1234' })
  }, adminCookie);
  assert.strictEqual(fixedReset.res.status, 400, '管理员不能把密码重置为固定默认口令');

  const generatedReset = await request(`/api/org/users/${generatedCreate.body.id}/password`, {
    method: 'POST',
    body: JSON.stringify({})
  }, adminCookie);
  assert.strictEqual(generatedReset.res.status, 200, '未提供重置密码时应由服务端生成一次性初始密码');
  assert.ok(generatedReset.body.initial_password);
  assert.notStrictEqual(generatedReset.body.initial_password, 'init1234');
  assert.ok(generatedReset.body.initial_password.length >= 12);
}

async function assertRbacAdminUsesAdminPermission(seed, rbacAdminCookie) {
  db.prepare(`
    UPDATE field_conflicts
    SET status='resolved', resolution='已处理', resolved_at=datetime('now')
    WHERE id=?
  `).run(seed.conflict);

  const archived = await request(`/api/conflicts/${seed.conflict}/archive`, { method: 'POST' }, rbacAdminCookie);
  assert.strictEqual(archived.res.status, 200, '拥有 admin RBAC 角色的用户应具备管理员归档权限');

  const row = db.prepare('SELECT status FROM field_conflicts WHERE id=?').get(seed.conflict);
  assert.strictEqual(row.status, 'archived');
}

async function assertRbacRolesDriveTodoList(seed, rbacOwnerCookie) {
  const todos = await request('/api/todos', {}, rbacOwnerCookie);
  assert.strictEqual(todos.res.status, 200);
  assert.ok(
    todos.body.some(row => Number(row.id) === Number(seed.todoB)),
    '拥有 owner RBAC 角色的用户应看到本部门待确认字段待办'
  );
}

async function assertRbacOwnerCanEditOwnerFieldColumns(seed, rbacOwnerCookie) {
  const update = await request(`/api/field-entries/${seed.fieldB}`, {
    method: 'PUT',
    body: JSON.stringify({ field_name_cn: '客户名称确认', field_type: '文本' })
  }, rbacOwnerCookie);
  assert.strictEqual(update.res.status, 200, '拥有 owner RBAC 角色的用户应能维护本部门字段 owner 列');

  const row = db.prepare('SELECT field_name_cn, field_type FROM field_entries WHERE id=?').get(seed.fieldB);
  assert.strictEqual(row.field_name_cn, '客户名称确认');
  assert.strictEqual(row.field_type, '文本');
}

async function assertFieldConstraintsAreApplied(submitterCookie) {
  const submitterRole = db.prepare("SELECT role_id FROM roles WHERE role_code='submitter'").get();
  assert.ok(submitterRole, 'submitter role should exist');

  db.prepare(`
    INSERT OR IGNORE INTO permissions (perm_code, resource, action, field_constraints, description)
    VALUES ('product_family:read', 'product_family', 'read', ?, '产品族字段约束测试')
  `).run(JSON.stringify({ exclude: ['product_type'], readonly: ['model_name'] }));
  db.prepare(`
    UPDATE permissions
    SET field_constraints=?
    WHERE perm_code='product_family:read'
  `).run(JSON.stringify({ exclude: ['product_type'], readonly: ['model_name'] }));
  db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role_id, perm_id)
    SELECT ?, perm_id FROM permissions WHERE perm_code='product_family:read'
  `).run(submitterRole.role_id);

  const constrained = await request('/api/product-families', {}, submitterCookie);
  assert.strictEqual(constrained.res.status, 200);
  assert.ok(constrained.body.rows.length > 0, 'product family fixture should exist before field constraint assertion');
  const row = constrained.body.rows[0];
  assert.strictEqual(Object.prototype.hasOwnProperty.call(row, 'product_type'), false, 'exclude 字段应被剥离');
  assert.ok(Array.isArray(row._readonly_fields), 'readonly 字段应在响应中标记');
  assert.ok(row._readonly_fields.includes('model_name'), 'model_name 应标记为 readonly');
}

async function assertReadonlyFieldConstraintsAreEnforced(adminCookie, limitedEditorCookie) {
  const created = await request('/api/product-families', {
    method: 'POST',
    body: JSON.stringify({ model_name: '字段约束产品族', model_code: 'FCON', class_major: 'A', product_type: '原类型' })
  }, adminCookie);
  assert.strictEqual(created.res.status, 201);

  const readonlyUpdate = await request(`/api/product-families/${created.body.product_family_code}`, {
    method: 'PUT',
    body: JSON.stringify({ model_name: '越权改名' })
  }, limitedEditorCookie);
  assert.strictEqual(readonlyUpdate.res.status, 403, '受限维护员不能写入 readonly 字段');
  assert.ok(String(readonlyUpdate.body.error || '').includes('只读'));

  const allowedUpdate = await request(`/api/product-families/${created.body.product_family_code}`, {
    method: 'PUT',
    body: JSON.stringify({ product_type: '允许维护类型' })
  }, limitedEditorCookie);
  assert.strictEqual(allowedUpdate.res.status, 200, '受限维护员仍可写入非 readonly 字段');

  const row = db.prepare('SELECT model_name, product_type FROM product_family WHERE product_family_code=?').get(created.body.product_family_code);
  assert.strictEqual(row.model_name, '字段约束产品族');
  assert.strictEqual(row.product_type, '允许维护类型');
}

async function assertMasterDataWriteGuards(seed, adminCookie, submitterCookie) {
  const submitterOrgCreate = await request('/api/org-units', {
    method: 'POST',
    body: JSON.stringify({ org_unit_name: '越权组织', org_type: 'department', org_mnemonic: 'BADORG' })
  }, submitterCookie);
  assert.strictEqual(submitterOrgCreate.res.status, 403);

  const adminOrgUpdate = await request(`/api/org-units/${seed.orgUnitCode}`, {
    method: 'PUT',
    body: JSON.stringify({ org_unit_name: '销售组织维护' })
  }, adminCookie);
  assert.strictEqual(adminOrgUpdate.res.status, 200);

  await assertForbidden('普通用户不能更新组织单元', `/api/org-units/${seed.orgUnitCode}`, {
    method: 'PUT',
    body: JSON.stringify({ org_unit_name: '越权组织维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增岗位', '/api/positions', {
    method: 'POST',
    body: JSON.stringify({ position_name: '越权岗位', pos_mnemonic: 'BADPOS', org_unit_id: seed.orgUnitId })
  }, submitterCookie);

  const adminPosition = await request('/api/positions', {
    method: 'POST',
    body: JSON.stringify({ position_name: '安全测试岗位', pos_mnemonic: 'SAFE', org_unit_id: seed.orgUnitId })
  }, adminCookie);
  assert.strictEqual(adminPosition.res.status, 201);
  const positionRow = db.prepare('SELECT position_id FROM position WHERE position_code=?').get(adminPosition.body.position_code);

  await assertForbidden('普通用户不能更新岗位', `/api/positions/${adminPosition.body.position_code}`, {
    method: 'PUT',
    body: JSON.stringify({ position_name: '越权岗位维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增人员', '/api/persons', {
    method: 'POST',
    body: JSON.stringify({ person_name: '越权人员' })
  }, submitterCookie);

  const adminPerson = await request('/api/persons', {
    method: 'POST',
    body: JSON.stringify({ person_name: '安全测试人员', position_id: positionRow.position_id, org_unit_id: seed.orgUnitId })
  }, adminCookie);
  assert.strictEqual(adminPerson.res.status, 201);

  await assertForbidden('普通用户不能更新人员', `/api/persons/${adminPerson.body.employee_no}`, {
    method: 'PUT',
    body: JSON.stringify({ person_name: '越权人员维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能挂接人员岗位', `/api/persons/${adminPerson.body.employee_no}/assignments`, {
    method: 'POST',
    body: JSON.stringify({ position_id: positionRow.position_id, is_primary: false })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增产品族', '/api/product-families', {
    method: 'POST',
    body: JSON.stringify({ model_name: '越权产品族', model_code: 'BADPF', class_major: 'A' })
  }, submitterCookie);

  const adminFamily = await request('/api/product-families', {
    method: 'POST',
    body: JSON.stringify({ model_name: '安全测试产品族', model_code: 'SAFEFAM', class_major: 'A' })
  }, adminCookie);
  assert.strictEqual(adminFamily.res.status, 201);
  const familyRow = db.prepare('SELECT product_family_id FROM product_family WHERE product_family_code=?').get(adminFamily.body.product_family_code);

  await assertForbidden('普通用户不能更新产品族', `/api/product-families/${adminFamily.body.product_family_code}`, {
    method: 'PUT',
    body: JSON.stringify({ model_name: '越权产品族维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增产品', '/api/products', {
    method: 'POST',
    body: JSON.stringify({ product_family_id: familyRow.product_family_id, revision: 'A' })
  }, submitterCookie);

  const adminProduct = await request('/api/products', {
    method: 'POST',
    body: JSON.stringify({ product_family_id: familyRow.product_family_id, revision: 'A' })
  }, adminCookie);
  assert.strictEqual(adminProduct.res.status, 201);

  await assertForbidden('普通用户不能更新产品', `/api/products/${adminProduct.body.product_code}`, {
    method: 'PUT',
    body: JSON.stringify({ revision: 'B' })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增分类节点', '/api/class-nodes', {
    method: 'POST',
    body: JSON.stringify({ class_code: 'BADCLASS', class_name: '越权分类', class_type: 'product' })
  }, submitterCookie);

  const adminClass = await request('/api/class-nodes', {
    method: 'POST',
    body: JSON.stringify({ class_code: 'SAFECLASS', class_name: '安全测试分类', class_type: 'product' })
  }, adminCookie);
  assert.strictEqual(adminClass.res.status, 201);

  await assertForbidden('普通用户不能更新分类节点', '/api/class-nodes/SAFECLASS', {
    method: 'PUT',
    body: JSON.stringify({ class_name: '越权分类维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能挂接分类成员', '/api/class-nodes/memberships', {
    method: 'POST',
    body: JSON.stringify({
      entity_type: 'product_family',
      entity_id: familyRow.product_family_id,
      class_node_id: adminClass.body.class_node_id,
      is_primary: true
    })
  }, submitterCookie);

  await assertForbidden('普通用户不能新增属性定义', '/api/attributes/defs', {
    method: 'POST',
    body: JSON.stringify({ attribute_code: 'BAD_ATTR', attribute_name: '越权属性', data_type: 'string', applies_to: 'product_family' })
  }, submitterCookie);

  const adminAttribute = await request('/api/attributes/defs', {
    method: 'POST',
    body: JSON.stringify({ attribute_code: 'SAFE_ATTR', attribute_name: '安全属性', data_type: 'string', applies_to: 'product_family' })
  }, adminCookie);
  assert.strictEqual(adminAttribute.res.status, 201);

  await assertForbidden('普通用户不能更新属性定义', '/api/attributes/defs/SAFE_ATTR', {
    method: 'PUT',
    body: JSON.stringify({ attribute_name: '越权属性维护' })
  }, submitterCookie);

  await assertForbidden('普通用户不能写入属性值', '/api/attributes/values', {
    method: 'PUT',
    body: JSON.stringify({ entity_type: 'product_family', entity_id: familyRow.product_family_id, values: { SAFE_ATTR: 'red' } })
  }, submitterCookie);

  const adminAttributeValue = await request('/api/attributes/values', {
    method: 'PUT',
    body: JSON.stringify({ entity_type: 'product_family', entity_id: familyRow.product_family_id, values: { SAFE_ATTR: 'blue' } })
  }, adminCookie);
  assert.strictEqual(adminAttributeValue.res.status, 200);
}

async function main() {
  let server;

  try {
    await assertServerRequiresSessionSecret();

    resetData();
    const seed = seedData();

    server = spawn(process.execPath, ['server/index.js'], {
      cwd: path.join(__dirname, '..'),
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'test-secret' },
      stdio: ['ignore', 'pipe', 'pipe']
    });

    await waitForServer();

    const adminCookie = await login('ADMIN001');
    const reviewerCookie = await login('REV001');
    const submitterCookie = await login('SALE001');
    const ownerBCookie = await login('OWNFIN');
    const rbacAdminCookie = await login('RBACADM');
    const rbacOwnerCookie = await login('RBACOWN');
    const limitedEditorCookie = await login('PFEDIT');

    const createSystem = await request('/api/systems', {
      method: 'POST',
      body: JSON.stringify({ name: '越权系统', dept_id: null })
    }, submitterCookie);
    assert.strictEqual(createSystem.res.status, 403);

    await assertMasterDataWriteGuards(seed, adminCookie, submitterCookie);
    await assertUserDirectoryGuards(adminCookie, reviewerCookie, submitterCookie);
    await assertDefaultPasswordGuards(adminCookie);
    await assertFieldConstraintsAreApplied(submitterCookie);
    await assertReadonlyFieldConstraintsAreEnforced(adminCookie, limitedEditorCookie);
    await assertRbacRolesDriveTodoList(seed, rbacOwnerCookie);
    await assertRbacOwnerCanEditOwnerFieldColumns(seed, rbacOwnerCookie);

    const capBadAction = await request(`/api/capabilities/${seed.capA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'aprove' })
    }, reviewerCookie);
    assert.strictEqual(capBadAction.res.status, 400);

    const capSubmitterReview = await request(`/api/capabilities/${seed.capA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'approve' })
    }, submitterCookie);
    assert.strictEqual(capSubmitterReview.res.status, 403);

    const processSubmitterReview = await request(`/api/processes/${seed.processA}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'reject' })
    }, submitterCookie);
    assert.strictEqual(processSubmitterReview.res.status, 403);

    const termBadAction = await request(`/api/terminology/${seed.termConflict}/review`, {
      method: 'POST',
      body: JSON.stringify({ action: 'aprove' })
    }, adminCookie);
    assert.strictEqual(termBadAction.res.status, 400);

    const mappings = await request('/api/mappings', {}, submitterCookie);
    assert.strictEqual(mappings.res.status, 200);
    assert.ok(mappings.body.every(row => row.submitted_by === seed.submitterA));

    const hiddenMapping = await request(`/api/mappings/${seed.mappingB}`, {}, submitterCookie);
    assert.strictEqual(hiddenMapping.res.status, 404);

    const hiddenFields = await request(`/api/field-entries/mapping/${seed.mappingB}`, {}, submitterCookie);
    assert.strictEqual(hiddenFields.res.status, 403);

    const exportResult = await request('/api/export/excel', {}, submitterCookie);
    assert.strictEqual(exportResult.res.status, 200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exportResult.buffer);
    const values = [];
    const noteColumn = columnIndexByHeader(workbook.getWorksheet('字段台账'), '字段说明');
    workbook.getWorksheet('字段台账').eachRow((row, rowNumber) => {
      if (rowNumber > 1) values.push(row.getCell(noteColumn).value);
    });
    assert.deepStrictEqual(values, ['销售字段']);

    const doneOtherDept = await request(`/api/todos/${seed.todoB}/done`, { method: 'POST' }, submitterCookie);
    assert.strictEqual(doneOtherDept.res.status, 403);

    const doneOwnDept = await request(`/api/todos/${seed.todoB}/done`, { method: 'POST' }, ownerBCookie);
    assert.strictEqual(doneOwnDept.res.status, 200);

    const deleteOtherDept = await request(`/api/todos/${seed.todoB}`, { method: 'DELETE' }, submitterCookie);
    assert.strictEqual(deleteOtherDept.res.status, 403);

    const oldResolve = await request(`/api/conflicts/${seed.conflict}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '普通用户越权解决' })
    }, submitterCookie);
    assert.strictEqual(oldResolve.res.status, 403);

    const oldTermResolve = await request(`/api/conflicts/term/${seed.termConflict}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ resolution: '普通用户越权解决' })
    }, submitterCookie);
    assert.strictEqual(oldTermResolve.res.status, 403);

    await assertRbacAdminUsesAdminPermission(seed, rbacAdminCookie);

    const detect = await request('/api/conflicts/detect', { method: 'POST' }, reviewerCookie);
    assert.strictEqual(detect.res.status, 200);
    assert.ok(Number.isInteger(detect.body.detected));

    const draft = db.prepare("SELECT id FROM mappings WHERE status='draft'").get();
    const publishDraft = await request(`/api/mappings/${draft.id}/publish`, { method: 'POST' }, adminCookie);
    assert.strictEqual(publishDraft.res.status, 409);

    console.log('Security route integration test passed');
  } finally {
    await stopServer(server);
    try {
      resetData();
    } finally {
      try {
        db.close();
      } finally {
        cleanupDb();
      }
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
