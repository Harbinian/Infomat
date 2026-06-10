const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3107;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';
const TEST_PREFIX = 'TEST_PROJECT_ROLE_';

function request(method, urlPath, body, cookie) {
  const url = new URL(urlPath, BASE);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
    method,
    headers: { 'Content-Type': 'application/json' }
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
  const termIds = db.prepare("SELECT id FROM term_conflicts WHERE term LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const mappingIds = db.prepare("SELECT id FROM mappings WHERE description LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const processIds = db.prepare("SELECT id FROM processes WHERE name LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const capabilityIds = db.prepare("SELECT id FROM capabilities WHERE name LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const roleIds = db.prepare("SELECT role_id FROM roles WHERE role_code LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.role_id);
  const userIds = db.prepare("SELECT id FROM users WHERE employee_no LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);
  const deptIds = db.prepare("SELECT id FROM departments WHERE code LIKE ?").all(`${TEST_PREFIX}%`).map(row => row.id);

  db.transaction(() => {
    for (const id of termIds) {
      db.prepare("DELETE FROM conflict_coordination_history WHERE conflict_id=? AND conflict_type='term'").run(id);
      db.prepare("DELETE FROM conflict_assignments WHERE conflict_id=? AND conflict_type='term'").run(id);
    }
    for (const id of deptIds) {
      db.prepare('DELETE FROM todos WHERE from_dept_id=? OR to_dept_id=?').run(id, id);
    }
    db.prepare('DELETE FROM todos WHERE content LIKE ?').run(`%${TEST_PREFIX}%`);
    db.prepare("DELETE FROM term_conflicts WHERE term LIKE ?").run(`${TEST_PREFIX}%`);
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

  createUser(`${TEST_PREFIX}INFO`, '测试信息化负责人', deptA, infoRole);
  createUser(`${TEST_PREFIX}DECISION`, '测试决策组成员', deptA, decisionRole);

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

  db.prepare(`
    INSERT INTO mappings (process_id, description, owner_dept_id, status, current_step)
    VALUES (?, ?, ?, 'published', 5)
  `).run(procA, `${TEST_PREFIX}映射A`, deptA);
  db.prepare(`
    INSERT INTO mappings (process_id, description, owner_dept_id, status, current_step)
    VALUES (?, ?, ?, 'published', 5)
  `).run(procB, `${TEST_PREFIX}映射B`, deptB);

  const generalTerm = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status)
    VALUES (?, ?, 'A', ?, 'B', 'high', 'coordinating')
  `).run(`${TEST_PREFIX}GENERAL`, deptA, deptB).lastInsertRowid;
  const escalateTerm = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status)
    VALUES (?, ?, 'A', ?, 'B', 'high', 'coordinating')
  `).run(`${TEST_PREFIX}ESCALATE`, deptA, deptB).lastInsertRowid;
  const escalatedTerm = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, escalated)
    VALUES (?, ?, 'A', ?, 'B', 'blocking', 'escalated', 1)
  `).run(`${TEST_PREFIX}ESCALATED`, deptA, deptB).lastInsertRowid;
  const decisionDeniedTerm = db.prepare(`
    INSERT INTO term_conflicts (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status)
    VALUES (?, ?, 'A', ?, 'B', 'medium', 'coordinating')
  `).run(`${TEST_PREFIX}DECISION_DENIED`, deptA, deptB).lastInsertRowid;

  return { generalTerm, escalateTerm, escalatedTerm, decisionDeniedTerm };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  let child;

  try {
    const ids = seedData();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: { ...process.env, PORT: String(PORT), SESSION_SECRET: 'project-role-access-test' },
      stdio: 'ignore'
    });

    await waitForServer(child);
    const infoCookie = await login(`${TEST_PREFIX}INFO`);
    const decisionCookie = await login(`${TEST_PREFIX}DECISION`);

    const infoMappings = await request('GET', `/api/mappings`, null, infoCookie);
    assert(infoMappings.status === 200, `信息化负责人查看映射失败: ${infoMappings.status}`);
    const visibleTestMappings = infoMappings.body.filter(row => String(row.description || '').startsWith(TEST_PREFIX));
    assert(visibleTestMappings.length === 2, `信息化负责人应可查看全部测试映射，实际 ${visibleTestMappings.length}`);

    const decisionMappings = await request('GET', `/api/mappings`, null, decisionCookie);
    assert(decisionMappings.status === 200, `决策组查看映射失败: ${decisionMappings.status}`);
    const decisionVisibleMappings = decisionMappings.body.filter(row => String(row.description || '').startsWith(TEST_PREFIX));
    assert(decisionVisibleMappings.length === 2, `决策组应可查看全部测试映射，实际 ${decisionVisibleMappings.length}`);

    const infoResolveGeneral = await request('POST', `/api/conflicts/${ids.generalTerm}/final-decide?type=term`, {
      resolution: '信息化负责人处理一般冲突'
    }, infoCookie);
    assert(infoResolveGeneral.status === 200, `信息化负责人应可处理一般冲突，实际 ${infoResolveGeneral.status}`);

    const infoEscalate = await request('POST', `/api/conflicts/${ids.escalateTerm}/escalate?type=term`, null, infoCookie);
    assert(infoEscalate.status === 200, `信息化负责人应可升级冲突，实际 ${infoEscalate.status}`);

    const infoResolveEscalated = await request('POST', `/api/conflicts/${ids.escalatedTerm}/final-decide?type=term`, {
      resolution: '信息化负责人不应终裁升级冲突'
    }, infoCookie);
    assert(infoResolveEscalated.status === 403, `信息化负责人不应处理升级冲突，实际 ${infoResolveEscalated.status}`);

    const decisionResolveEscalated = await request('POST', `/api/conflicts/${ids.escalatedTerm}/final-decide?type=term`, {
      resolution: '决策组处理升级冲突'
    }, decisionCookie);
    assert(decisionResolveEscalated.status === 200, `决策组应可处理升级冲突，实际 ${decisionResolveEscalated.status}`);

    const decisionResolveGeneral = await request('POST', `/api/conflicts/${ids.decisionDeniedTerm}/final-decide?type=term`, {
      resolution: '决策组不应处理一般冲突'
    }, decisionCookie);
    assert(decisionResolveGeneral.status === 403, `决策组不应处理一般冲突，实际 ${decisionResolveGeneral.status}`);

    console.log('Project role access test passed');
  } finally {
    await stopServer(child);
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
});
