const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const express = require('express');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const mappingsRouter = require('../server/routes/mappings');
const conflictsRouter = require('../server/routes/conflicts');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3107;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';
const TEST_PREFIX = 'TEST_PROJECT_ROLE_';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
delete process.env.MDM_IDENTITY_READ_MODEL;

const csrfTokens = new Map();

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const res = await rawRequest('GET', '/api/csrf-token', null, cookie);
  const token = res.status === 200 && res.body ? res.body.csrfToken : '';
  if (token) csrfTokens.set(cookie, token);
  return token;
}

function rawRequest(method, urlPath, body, cookie, extraHeaders = {}) {
  const url = new URL(urlPath, BASE);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  };
  if (cookie) options.headers.Cookie = cookie;

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (error) { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function request(method, urlPath, body, cookie) {
  const headers = {};
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase()) && urlPath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  return rawRequest(method, urlPath, body, cookie, headers);
}

async function waitForServer(child) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    if (child.exitCode !== null) throw new Error(`测试服务提前退出: ${child.exitCode}`);
    try {
      const res = await request('GET', '/api/health');
      if (res.status === 200) return;
    } catch (error) {
      // keep waiting
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('测试服务启动超时');
}

async function login(employeeNo) {
  const res = await request('POST', '/api/org/login', { employee_no: employeeNo, password: PASSWORD });
  if (res.status !== 200) throw new Error(`登录失败 ${employeeNo}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'];
  if (!cookie || cookie.length === 0) throw new Error(`登录未返回 Cookie: ${employeeNo}`);
  return cookie.map(value => value.split(';')[0]).join('; ');
}

function cleanTestData() {
  const mappingIds = db.prepare("SELECT id FROM mappings WHERE description LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const processIds = db.prepare("SELECT id FROM processes WHERE name LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const capabilityIds = db.prepare("SELECT id FROM capabilities WHERE name LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const roleIds = db.prepare("SELECT role_id FROM roles WHERE role_code LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.role_id);
  const userIds = db.prepare("SELECT id FROM users WHERE employee_no LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const deptIds = db.prepare("SELECT id FROM departments WHERE code LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);

  db.transaction(() => {
    for (const id of mappingIds) {
      db.prepare('DELETE FROM approval_tasks WHERE mapping_id=?').run(id);
      db.prepare('DELETE FROM approval_history WHERE mapping_id=?').run(id);
      db.prepare('DELETE FROM field_entries WHERE mapping_id=?').run(id);
      db.prepare('DELETE FROM mapping_related_departments WHERE mapping_id=?').run(id);
      db.prepare('DELETE FROM mapping_systems WHERE mapping_id=?').run(id);
      db.prepare('DELETE FROM mappings WHERE id=?').run(id);
    }
    for (const id of processIds) db.prepare('DELETE FROM processes WHERE id=?').run(id);
    for (const id of capabilityIds) db.prepare('DELETE FROM capabilities WHERE id=?').run(id);
    for (const id of userIds) {
      db.prepare('DELETE FROM user_roles WHERE user_id=?').run(id);
      db.prepare('DELETE FROM users WHERE id=?').run(id);
    }
    for (const id of roleIds) {
      db.prepare('DELETE FROM role_permissions WHERE role_id=?').run(id);
      db.prepare('DELETE FROM roles WHERE role_id=?').run(id);
    }
    for (const id of deptIds) db.prepare('DELETE FROM departments WHERE id=?').run(id);
  })();
}

function ensurePermission(code, resource, action, description) {
  db.prepare(`
    INSERT OR IGNORE INTO permissions (perm_code, resource, action, description)
    VALUES (?, ?, ?, ?)
  `).run(code, resource, action, description);
}

function createRole(code, name, permissionCodes) {
  const roleId = db.prepare(`
    INSERT INTO roles (role_code, role_name, description)
    VALUES (?, ?, ?)
  `).run(code, name, `${TEST_PREFIX}role`).lastInsertRowid;
  const link = db.prepare(`
    INSERT INTO role_permissions (role_id, perm_id)
    SELECT ?, perm_id FROM permissions WHERE perm_code=?
  `);
  for (const permCode of permissionCodes) link.run(roleId, permCode);
  return roleId;
}

function createUser(employeeNo, name, departmentId, roleId) {
  const userId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, 'submitter', ?)
  `).run(name, employeeNo, departmentId, `${TEST_PREFIX}岗位`, hashPassword(PASSWORD)).lastInsertRowid;
  db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').run(userId, roleId);
  return userId;
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

async function assertMappingAccessViaRepository(seed) {
  const mappings = [
    {
      id: 901,
      process_id: 901,
      process_name: `${TEST_PREFIX}流程A`,
      cap_name: '流程治理读模型',
      description: `${TEST_PREFIX}映射A`,
      owner_dept_id: seed.deptA,
      owner_dept_name: `${TEST_PREFIX}部门A`,
      status: 'published',
      submitted_by: seed.infoUserId,
      current_step: 5,
      systems: ''
    },
    {
      id: 902,
      process_id: 902,
      process_name: `${TEST_PREFIX}流程B`,
      cap_name: '流程治理读模型',
      description: `${TEST_PREFIX}映射B`,
      owner_dept_id: seed.deptB,
      owner_dept_name: `${TEST_PREFIX}部门B`,
      status: 'published',
      submitted_by: seed.decisionUserId,
      current_step: 5,
      systems: ''
    }
  ];

  mappingsRouter.setMappingRepositoryFactory(async () => ({
    async listMappings(filters, scope) {
      assert(scope.canViewAll === true, '项目角色的 data:view_all 权限应传入映射 MySQL repository');
      return mappings;
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const actor = req.headers['x-test-actor'] === 'decision'
      ? { userId: seed.decisionUserId, employeeNo: `${TEST_PREFIX}DECISION` }
      : { userId: seed.infoUserId, employeeNo: `${TEST_PREFIX}INFO` };
    req.session = {
      userId: actor.userId,
      userRole: 'submitter',
      userName: actor.employeeNo,
      departmentId: seed.deptA
    };
    next();
  });
  app.use('/api/mappings', mappingsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const infoRes = await fetch(`${baseUrl}/api/mappings`, { headers: { 'x-test-actor': 'info' } });
    const infoBody = await infoRes.json();
    assert(infoRes.status === 200, `信息化负责人查看映射失败: ${infoRes.status}`);
    const visibleTestMappings = infoBody.filter(row => String(row.description || '').startsWith(TEST_PREFIX));
    assert(visibleTestMappings.length === 2, `信息化负责人应可查看全部测试映射，实际 ${visibleTestMappings.length}`);

    const decisionRes = await fetch(`${baseUrl}/api/mappings`, { headers: { 'x-test-actor': 'decision' } });
    const decisionBody = await decisionRes.json();
    assert(decisionRes.status === 200, `决策组查看映射失败: ${decisionRes.status}`);
    const decisionVisibleMappings = decisionBody.filter(row => String(row.description || '').startsWith(TEST_PREFIX));
    assert(decisionVisibleMappings.length === 2, `决策组应可查看全部测试映射，实际 ${decisionVisibleMappings.length}`);
  } finally {
    await closeServer(server);
    mappingsRouter.resetMappingRepositoryFactory();
  }
}

function seedData() {
  cleanTestData();
  ensurePermission('data:view_all', 'data', 'view_all', '查看全部业务数据');
  ensurePermission('conflict:manage', 'conflict', 'manage', '处理一般冲突');
  ensurePermission('conflict:escalate', 'conflict', 'escalate', '升级冲突');
  ensurePermission('conflict:final_decide_escalated', 'conflict', 'final_decide_escalated', '处理升级后的冲突');
  ensurePermission('mapping:read', 'mapping', 'read', '查看业务映射');

  const infoRole = createRole(`${TEST_PREFIX}it_lead`, '测试信息化负责人', [
    'data:view_all',
    'mapping:read',
    'conflict:manage',
    'conflict:escalate'
  ]);
  const decisionRole = createRole(`${TEST_PREFIX}decision_group`, '测试决策组', [
    'data:view_all',
    'mapping:read',
    'conflict:final_decide_escalated'
  ]);

  const deptA = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}部门A`, `${TEST_PREFIX}DEPT_A`).lastInsertRowid;
  const deptB = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}部门B`, `${TEST_PREFIX}DEPT_B`).lastInsertRowid;

  const infoUserId = createUser(`${TEST_PREFIX}INFO`, '测试信息化负责人', deptA, infoRole);
  const decisionUserId = createUser(`${TEST_PREFIX}DECISION`, '测试决策组成员', deptA, decisionRole);

  const cap = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id)
    VALUES (?, 'L1', ?)
  `).run(`${TEST_PREFIX}能力`, deptA).lastInsertRowid;
  const procA = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id)
    VALUES (?, ?, ?)
  `).run(`${TEST_PREFIX}流程A`, cap, deptA).lastInsertRowid;
  const procB = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id)
    VALUES (?, ?, ?)
  `).run(`${TEST_PREFIX}流程B`, cap, deptB).lastInsertRowid;

  const generalTerm = 1001;
  const escalateTerm = 1002;
  const escalatedTerm = 1003;
  const decisionDeniedTerm = 1004;

  return { generalTerm, escalateTerm, escalatedTerm, decisionDeniedTerm, deptA, deptB, procA, procB, infoUserId, decisionUserId };
}

function makeConflictRepositoryForProjectRoleTest(ids) {
  const conflicts = [
    { id: ids.generalTerm, conflict_type: 'term', term: `${TEST_PREFIX}GENERAL`, status: 'coordinating', severity: 'high', dept_a: ids.deptA, dept_b: ids.deptB },
    { id: ids.escalateTerm, conflict_type: 'term', term: `${TEST_PREFIX}ESCALATE`, status: 'coordinating', severity: 'high', dept_a: ids.deptA, dept_b: ids.deptB },
    { id: ids.escalatedTerm, conflict_type: 'term', term: `${TEST_PREFIX}ESCALATED`, status: 'escalated', severity: 'blocking', dept_a: ids.deptA, dept_b: ids.deptB, escalated: 1 },
    { id: ids.decisionDeniedTerm, conflict_type: 'term', term: `${TEST_PREFIX}DECISION_DENIED`, status: 'coordinating', severity: 'medium', dept_a: ids.deptA, dept_b: ids.deptB }
  ];

  function findConflict(id, type) {
    return conflicts.find(conflict => Number(conflict.id) === Number(id) && conflict.conflict_type === type);
  }

  return {
    async getConflict(id, type) {
      return findConflict(id, type) || null;
    },
    async finalDecideConflict(id, type, payload) {
      const conflict = findConflict(id, type);
      if (!conflict) return { ok: false, statusCode: 404, error: '冲突不存在' };
      conflict.status = 'resolved';
      conflict.resolution = payload.resolution || null;
      return { ok: true };
    },
    async escalateConflict(id, type) {
      const conflict = findConflict(id, type);
      if (!conflict) return { ok: false, statusCode: 404, error: '冲突不存在' };
      if (conflict.status !== 'coordinating') return { ok: false, statusCode: 409, error: '仅协调中的冲突可升级' };
      conflict.status = 'escalated';
      conflict.escalated = 1;
      return { ok: true };
    }
  };
}

async function assertConflictAccessViaRepository(ids) {
  const repo = makeConflictRepositoryForProjectRoleTest(ids);
  conflictsRouter.setConflictRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const userKey = req.headers['x-test-user'] || 'info';
    req.session = {
      userId: userKey === 'decision' ? ids.decisionUserId : ids.infoUserId,
      userRole: userKey === 'decision' ? 'decision_group' : 'it_lead',
      userName: userKey === 'decision' ? '测试决策组成员' : '测试信息化负责人',
      departmentId: ids.deptA
    };
    next();
  });
  app.use('/api/conflicts', conflictsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  async function conflictRequest(userKey, routePath, body) {
    const res = await fetch(`${baseUrl}${routePath}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-User': userKey },
      body: body ? JSON.stringify(body) : undefined
    });
    let parsed = {};
    try { parsed = await res.json(); } catch (error) { /* keep empty */ }
    return { status: res.status, body: parsed };
  }

  try {
    const infoResolveGeneral = await conflictRequest('info', `/api/conflicts/${ids.generalTerm}/final-decide?type=term`, {
      resolution: '信息化负责人处理一般冲突'
    });
    assert(infoResolveGeneral.status === 200, `信息化负责人应可处理一般冲突，实际 ${infoResolveGeneral.status}`);

    const infoEscalate = await conflictRequest('info', `/api/conflicts/${ids.escalateTerm}/escalate?type=term`);
    assert(infoEscalate.status === 200, `信息化负责人应可升级冲突，实际 ${infoEscalate.status}`);

    const infoResolveEscalated = await conflictRequest('info', `/api/conflicts/${ids.escalatedTerm}/final-decide?type=term`, {
      resolution: '信息化负责人不应终裁升级冲突'
    });
    assert(infoResolveEscalated.status === 403, `信息化负责人不应处理升级冲突，实际 ${infoResolveEscalated.status}`);

    const decisionResolveEscalated = await conflictRequest('decision', `/api/conflicts/${ids.escalatedTerm}/final-decide?type=term`, {
      resolution: '决策组处理升级冲突'
    });
    assert(decisionResolveEscalated.status === 200, `决策组应可处理升级冲突，实际 ${decisionResolveEscalated.status}`);

    const decisionResolveGeneral = await conflictRequest('decision', `/api/conflicts/${ids.decisionDeniedTerm}/final-decide?type=term`, {
      resolution: '决策组不应处理一般冲突'
    });
    assert(decisionResolveGeneral.status === 403, `决策组不应处理一般冲突，实际 ${decisionResolveGeneral.status}`);
  } finally {
    await closeServer(server);
    conflictsRouter.resetConflictRepositoryFactory();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  try {
    const ids = seedData();
    await assertMappingAccessViaRepository(ids);
    await assertConflictAccessViaRepository(ids);

    console.log('Project role access test passed');
  } finally {
    try {
      cleanTestData();
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
  console.error(error.message);
  process.exit(1);
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
