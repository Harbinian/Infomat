const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const express = require('express');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { hashPassword, verifyPassword } = require('../server/auth');
const mappingsRouter = require('../server/routes/mappings');
const { setDataMapRepositoryFactory, resetDataMapRepositoryFactory } = require('../server/dataMapMysqlRepository');
const fieldEntriesRouter = require('../server/routes/fieldEntries');
const fieldIdentitiesRouter = require('../server/routes/fieldIdentities');

const PORT = 3199;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
delete process.env.MDM_IDENTITY_READ_MODEL;

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

  return {
    deptA,
    deptB,
    capA,
    processA,
    processB,
    mappingA,
    mappingB,
    fieldB,
    todoB,
    conflict,
    termConflict,
    admin,
    reviewer,
    submitterA,
    submitterB,
    rbacOwner,
    orgUnitId,
    orgUnitCode: 'SALE-ORG'
  };
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
  const requestOptions = { ...options };
  const skipCsrf = !!requestOptions.skipCsrf;
  delete requestOptions.skipCsrf;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = {
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {}),
    ...(requestOptions.headers || {})
  };
  if (!skipCsrf && cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && routePath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${routePath}`, { ...requestOptions, headers });
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

const csrfTokens = new Map();

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

function cookieFrom(result) {
  const setCookie = result.res.headers.get('set-cookie');
  return setCookie ? setCookie.split(';')[0] : '';
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function login(employeeNo) {
  const result = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password: 'pass1234' })
  });
  assert.strictEqual(result.res.status, 200);
  return cookieFrom(result);
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

async function assertSecurityHeaders() {
  const health = await request('/api/health');
  assert.strictEqual(health.res.status, 200);
  assert.strictEqual(health.res.headers.get('x-content-type-options'), 'nosniff', 'responses should set X-Content-Type-Options');
  assert.ok(health.res.headers.get('referrer-policy'), 'responses should set Referrer-Policy');
  assert.ok(health.res.headers.get('content-security-policy'), 'responses should set Content-Security-Policy');
}

async function assertLoginRegeneratesSession() {
  const initialLogin = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: 'REV001', password: 'pass1234' })
  });
  assert.strictEqual(initialLogin.res.status, 200);
  const initialCookie = cookieFrom(initialLogin);
  assert.ok(initialCookie, 'initial login should issue a session cookie');

  const secondLogin = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: 'ADMIN001', password: 'pass1234' })
  }, initialCookie);
  assert.strictEqual(secondLogin.res.status, 200);
  const regeneratedCookie = cookieFrom(secondLogin);
  assert.ok(regeneratedCookie, 'login should issue a session cookie');
  assert.notStrictEqual(regeneratedCookie, initialCookie, 'successful login should regenerate the session id');
}

async function assertCsrfProtection(adminCookie) {
  const tokenResult = await request('/api/csrf-token', {}, adminCookie);
  assert.strictEqual(tokenResult.res.status, 200, 'authenticated users should receive a CSRF token');
  assert.ok(tokenResult.body.csrfToken, 'CSRF token response should include csrfToken');

  const missingToken = await request('/api/org/users', {
    method: 'POST',
    skipCsrf: true,
    body: JSON.stringify({
      name: 'CSRF 未授权写入',
      employee_no: 'CSRFBAD',
      role: 'submitter'
    })
  }, adminCookie);
  assert.strictEqual(missingToken.res.status, 403, 'authenticated unsafe writes without CSRF token should be rejected');
}

async function assertLoginRateLimit() {
  let lastResult;
  for (let i = 0; i < 9; i += 1) {
    lastResult = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'RATE001', password: `wrong-password-${i}` })
    });
  }
  assert.strictEqual(lastResult.res.status, 429, 'repeated failed login attempts should be rate limited');
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
  const customCreate = await request('/api/org/users', {
    method: 'POST',
    body: JSON.stringify({
      name: '自定义初始密码账号',
      employee_no: 'CUSTOMPW',
      role: 'submitter',
      password: 'pass1234'
    })
  }, adminCookie);
  assert.strictEqual(customCreate.res.status, 400, '管理员不能指定自定义初始密码');

  const generatedCreate = await request('/api/org/users', {
    method: 'POST',
    body: JSON.stringify({
      name: '随机初始口令账号',
      employee_no: 'GENPW',
      role: 'submitter'
    })
  }, adminCookie);
  assert.strictEqual(generatedCreate.res.status, 200, '未提供密码时应由服务端设置统一首次登录密码');
  assert.ok(generatedCreate.body.id);
  assert.ok(generatedCreate.body.initial_password, '创建响应应返回随机首次登录密码');
  assert.notStrictEqual(generatedCreate.body.initial_password, '000000', '创建响应不能返回固定首次登录密码 000000');
  assert.notStrictEqual(generatedCreate.body.initial_password, 'init1234', '创建响应不能返回历史固定口令 init1234');
  assert.ok(generatedCreate.body.initial_password.length >= 12, '随机首次登录密码应具备基础长度');

  const createdRow = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id=?').get(generatedCreate.body.id);
  assert.ok(createdRow);
  assert.strictEqual(createdRow.must_change_password, 1, '首次登录账号应要求首次改密');
  assert.ok(verifyPassword(generatedCreate.body.initial_password, createdRow.password_hash), '创建响应的随机首次登录密码应能登录');
  assert.ok(!verifyPassword('000000', createdRow.password_hash), '创建用户不应使用固定首次登录密码 000000');

  const customReset = await request(`/api/org/users/${generatedCreate.body.id}/password`, {
    method: 'POST',
    body: JSON.stringify({ password: 'pass1234' })
  }, adminCookie);
  assert.strictEqual(customReset.res.status, 400, '管理员不能把密码重置为自定义初始密码');

  const generatedReset = await request(`/api/org/users/${generatedCreate.body.id}/password`, {
    method: 'POST',
    body: JSON.stringify({})
  }, adminCookie);
  assert.strictEqual(generatedReset.res.status, 200, '未提供重置密码时应由服务端设置统一首次登录密码');
  assert.ok(generatedReset.body.initial_password, '重置响应应返回随机首次登录密码');
  assert.notStrictEqual(generatedReset.body.initial_password, '000000', '重置响应不能返回固定首次登录密码 000000');
  assert.notStrictEqual(generatedReset.body.initial_password, 'init1234', '重置响应不能返回历史固定口令 init1234');
  assert.notStrictEqual(generatedReset.body.initial_password, generatedCreate.body.initial_password, '每次重置应生成新的随机首次登录密码');
  const resetRow = db.prepare('SELECT password_hash, must_change_password FROM users WHERE id=?').get(generatedCreate.body.id);
  assert.strictEqual(resetRow.must_change_password, 1, '重置后应要求改密');
  assert.ok(verifyPassword(generatedReset.body.initial_password, resetRow.password_hash), '重置响应的随机首次登录密码应能登录');
  assert.ok(!verifyPassword('000000', resetRow.password_hash), '重置后不应使用固定首次登录密码 000000');
}

async function assertPasswordStrengthGuards(submitterCookie) {
  const cases = [
    { password: 'short1', label: '短密码' },
    { password: '000000', label: '固定默认口令' },
    { password: 'init1234', label: '历史固定口令' },
    { password: 'SALE001abc123', label: '包含工号' },
    { password: 'onlyletters', label: '缺少数字' }
  ];

  for (const item of cases) {
    const result = await request('/api/org/me/password', {
      method: 'POST',
      body: JSON.stringify({ current_password: 'pass1234', new_password: item.password })
    }, submitterCookie);
    assert.strictEqual(result.res.status, 400, `自助改密应拒绝${item.label}`);
  }
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

function makeSecurityDataMapRepository(seed) {
  const state = {
    context: {
      id: seed.mappingB,
      context_id: seed.mappingB,
      mapping_id: seed.mappingB,
      dept_id: seed.deptB,
      dept_name: '财务部',
      owner_user_id: seed.rbacOwner,
      created_by: seed.submitterB,
      title: '财务客户维护字段上下文',
      status: 'active'
    },
    field: {
      id: seed.fieldB,
      context_id: seed.mappingB,
      mapping_id: seed.mappingB,
      data_object: '客户',
      field_name_cn: '客户名称',
      field_name_en: 'customer_name',
      field_type: '文本',
      data_type: '文本',
      submitted_by: seed.submitterB,
      status: 'draft'
    },
    identity: null
  };

  return {
    state,
    async getContext(id) {
      return Number(id) === Number(state.context.id) ? state.context : null;
    },
    async getFieldsByContext(contextId) {
      return Number(contextId) === Number(state.context.id) ? [state.field] : [];
    },
    async getField(fieldId) {
      return Number(fieldId) === Number(state.field.id) ? state.field : null;
    },
    async updateField(fieldId, payload) {
      if (Number(fieldId) !== Number(state.field.id)) return null;
      Object.assign(state.field, {
        field_name_cn: payload.field_name_cn || state.field.field_name_cn,
        field_type: payload.field_type || payload.data_type || state.field.field_type,
        data_type: payload.field_type || payload.data_type || state.field.data_type
      });
      return state.field;
    },
    async getFieldIdentity(fieldId) {
      return Number(fieldId) === Number(state.field.id) ? state.identity : null;
    },
    async upsertFieldIdentity(fieldId, payload) {
      if (Number(fieldId) !== Number(state.field.id)) return null;
      state.identity = {
        id: 7001,
        field_id: Number(fieldId),
        authoritative_system: payload.authoritative_system || null,
        authoritative_system_name: payload.authoritative_system || null,
        maintain_dept_id: payload.maintain_dept_id || null,
        owner_user_id: payload.owner_user_id || null,
        confirmed: payload.confirmed ? 1 : 0,
        note: payload.note || null,
        status: 'candidate'
      };
      return state.identity;
    },
    async confirmFieldIdentity(fieldId, payload, actorUserId) {
      if (Number(fieldId) !== Number(state.field.id) || !state.identity) return null;
      state.identity.authoritative_system = payload.authoritative_system || state.identity.authoritative_system;
      state.identity.authoritative_system_name = payload.authoritative_system || state.identity.authoritative_system_name;
      state.identity.confirmed = 1;
      state.identity.confirmed_by = actorUserId;
      state.identity.status = 'confirmed';
      return state.identity;
    }
  };
}

async function withDataMapFieldApp(seed, routePathPrefix, router, run) {
  const repo = makeSecurityDataMapRepository(seed);
  setDataMapRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.headers['x-test-actor'] === 'owner'
      ? { userId: seed.rbacOwner, userRole: 'submitter', departmentId: seed.deptB }
      : { userId: seed.submitterA, userRole: 'submitter', departmentId: seed.deptA };
    req.session = {
      userId: actor.userId,
      userRole: actor.userRole,
      userName: '安全测试用户',
      departmentId: actor.departmentId
    };
    next();
  });
  app.use(routePathPrefix, router);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  async function localRequest(actor, pathName, options = {}) {
    const res = await fetch(`${baseUrl}${pathName}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-test-actor': actor,
        ...(options.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  try {
    await run(localRequest, repo);
  } finally {
    await closeServer(server);
    resetDataMapRepositoryFactory();
  }
}

async function assertRbacOwnerCanEditOwnerFieldColumns(seed) {
  await withDataMapFieldApp(seed, '/api/field-entries', fieldEntriesRouter, async (localRequest, repo) => {
    const hiddenFields = await localRequest('submitter', `/api/field-entries/mapping/${seed.mappingB}`);
    assert.strictEqual(hiddenFields.res.status, 403, '其他部门报送人不能查看该字段台账上下文');

    const update = await localRequest('owner', `/api/field-entries/${seed.fieldB}`, {
      method: 'PUT',
      body: JSON.stringify({ field_name_cn: '客户名称确认', field_type: '文本' })
    });
    assert.strictEqual(update.res.status, 200, '拥有 owner RBAC 角色的用户应能维护本部门字段 owner 列');
    assert.strictEqual(repo.state.field.field_name_cn, '客户名称确认');
    assert.strictEqual(repo.state.field.field_type, '文本');
  });
}

async function assertRbacOwnerCanMaintainFieldIdentity(seed) {
  await withDataMapFieldApp(seed, '/api/field-identities', fieldIdentitiesRouter, async (localRequest, repo) => {
    const upsertIdentity = await localRequest('owner', `/api/field-identities/${seed.fieldB}`, {
      method: 'PUT',
      body: JSON.stringify({
        candidate_systems: ['ERP'],
        authoritative_system: 'ERP',
        maintain_dept_id: null,
        confirmed: false,
        note: 'RBAC owner 维护黄金源'
      })
    });
    assert.strictEqual(upsertIdentity.res.status, 200, '拥有 owner RBAC 角色的用户应能维护本部门字段身份');

    const confirmIdentity = await localRequest('owner', `/api/field-identities/${seed.fieldB}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ authoritative_system: 'ERP' })
    });
    assert.strictEqual(confirmIdentity.res.status, 200, '拥有 owner RBAC 角色的用户应能确认本部门字段权威系统');
    assert.strictEqual(repo.state.identity.authoritative_system, 'ERP');
    assert.strictEqual(repo.state.identity.confirmed, 1);
    assert.strictEqual(repo.state.identity.confirmed_by, seed.rbacOwner);
  });
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

function makeSecurityMappingRepository(seed) {
  const state = {
    nextId: 5000,
    mappings: [
      {
        id: seed.mappingA,
        process_id: seed.processA,
        process_name: '销售客户维护',
        cap_name: '流程治理读模型',
        description: '销售映射',
        owner_dept_id: seed.deptA,
        owner_dept_name: '销售部',
        status: 'published',
        submitted_by: seed.submitterA,
        current_step: 5,
        systems: 'CRM',
        systemsList: []
      },
      {
        id: seed.mappingB,
        process_id: seed.processB,
        process_name: '财务客户维护',
        cap_name: '流程治理读模型',
        description: '财务映射',
        owner_dept_id: seed.deptB,
        owner_dept_name: '财务部',
        status: 'published',
        submitted_by: seed.submitterB,
        current_step: 5,
        systems: 'ERP',
        systemsList: []
      },
      {
        id: 4999,
        process_id: seed.processA,
        process_name: '销售客户维护',
        cap_name: '流程治理读模型',
        description: '待发布草稿',
        owner_dept_id: seed.deptA,
        owner_dept_name: '销售部',
        status: 'draft',
        submitted_by: seed.submitterA,
        current_step: 1,
        systems: '',
        systemsList: []
      }
    ]
  };

  function visible(mapping, scope) {
    return scope.canViewAll ||
      Number(mapping.submitted_by) === Number(scope.userId) ||
      Number(mapping.owner_dept_id) === Number(scope.departmentId) ||
      Number(mapping.approval_dept_id || 0) === Number(scope.departmentId);
  }

  return {
    async listMappings(filters, scope) {
      return state.mappings
        .filter(mapping => visible(mapping, scope))
        .filter(mapping => !filters.status || mapping.status === filters.status);
    },
    async getMapping(id, scope) {
      const mapping = state.mappings.find(item => Number(item.id) === Number(id));
      if (!mapping || !visible(mapping, scope)) return null;
      return { ...mapping, systems: mapping.systemsList, fields: [], relatedDepts: [], approvalTasks: [] };
    },
    async createMapping(payload, actorUserId) {
      const mapping = {
        id: state.nextId++,
        process_id: payload.process_id,
        process_name: payload.process_id === seed.processB ? '财务客户维护' : '销售客户维护',
        cap_name: '流程治理读模型',
        description: payload.description || null,
        owner_dept_id: payload.owner_dept_id,
        owner_dept_name: payload.owner_dept_id === seed.deptB ? '财务部' : '销售部',
        status: 'draft',
        submitted_by: actorUserId,
        current_step: 1,
        systems: '',
        systemsList: []
      };
      state.mappings.push(mapping);
      return mapping;
    },
    async publishMapping(id) {
      const mapping = state.mappings.find(item => Number(item.id) === Number(id));
      if (!mapping) return { ok: false, statusCode: 404, error: '映射不存在' };
      if (mapping.status !== 'final_reviewed') return { ok: false, statusCode: 409, error: '仅终审完成后可发布' };
      mapping.status = 'published';
      return { ok: true };
    }
  };
}

async function assertMappingDraftCreateGuards(seed) {
  const repo = makeSecurityMappingRepository(seed);
  mappingsRouter.setMappingRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.headers['x-test-actor'] || 'submitter';
    if (actor === 'admin') {
      req.session = { userId: seed.admin, userRole: 'admin', userName: '系统管理员', departmentId: seed.deptA };
    } else if (actor === 'reviewer') {
      req.session = { userId: seed.reviewer, userRole: 'reviewer', userName: '评审人', departmentId: seed.deptA };
    } else {
      req.session = { userId: seed.submitterA, userRole: 'submitter', userName: '销售报送人', departmentId: seed.deptA };
    }
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function mappingRequest(actor, routePath, options = {}) {
    const res = await fetch(`${baseUrl}${routePath}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-test-actor': actor,
        ...(options.headers || {})
      }
    });
    const body = await res.json().catch(() => ({}));
    return { res, body };
  }

  try {
    const reviewerCreate = await mappingRequest('reviewer', '/api/mappings', {
    method: 'POST',
    body: JSON.stringify({
      process_id: seed.processA,
      description: '评审人越权创建草稿',
      owner_dept_id: seed.deptA
    })
    });
    assert.strictEqual(reviewerCreate.res.status, 403, '非报送人或管理员不能创建映射草稿');

    const submitterCreate = await mappingRequest('submitter', '/api/mappings', {
    method: 'POST',
    body: JSON.stringify({
      process_id: seed.processA,
      description: '报送人创建草稿',
      owner_dept_id: seed.deptA
    })
    });
    assert.strictEqual(submitterCreate.res.status, 200, '报送人应能创建映射草稿');

    const adminCreate = await mappingRequest('admin', '/api/mappings', {
    method: 'POST',
    body: JSON.stringify({
      process_id: seed.processB,
      description: '管理员创建草稿',
      owner_dept_id: seed.deptB
    })
    });
    assert.strictEqual(adminCreate.res.status, 200, '管理员应能创建映射草稿');

    const mappings = await mappingRequest('submitter', '/api/mappings');
    assert.strictEqual(mappings.res.status, 200);
    assert.ok(mappings.body.every(row => row.submitted_by === seed.submitterA));

    const hiddenMapping = await mappingRequest('submitter', `/api/mappings/${seed.mappingB}`);
    assert.strictEqual(hiddenMapping.res.status, 404);

    const publishDraft = await mappingRequest('admin', '/api/mappings/4999/publish', { method: 'POST' });
    assert.strictEqual(publishDraft.res.status, 409);
  } finally {
    await closeServer(server);
    mappingsRouter.resetMappingRepositoryFactory();
  }
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
    await assertSecurityHeaders();

    await assertLoginRegeneratesSession();
    const adminCookie = await login('ADMIN001');
    await assertCsrfProtection(adminCookie);
    await assertLoginRateLimit();
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
    await assertMappingDraftCreateGuards(seed);
    await assertUserDirectoryGuards(adminCookie, reviewerCookie, submitterCookie);
    await assertDefaultPasswordGuards(adminCookie);
    await assertPasswordStrengthGuards(submitterCookie);
    await assertFieldConstraintsAreApplied(submitterCookie);
    await assertReadonlyFieldConstraintsAreEnforced(adminCookie, limitedEditorCookie);
    await assertRbacOwnerCanEditOwnerFieldColumns(seed);
    await assertRbacOwnerCanMaintainFieldIdentity(seed);

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
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
