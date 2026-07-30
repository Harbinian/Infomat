const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3121;
const BASE = `http://localhost:${PORT}`;
const PASSWORD = 'pass1234';
const TEST_PREFIX = 'TEST_PAGE_WF_';

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
  assert(res.status === 200, `登录失败 ${employeeNo}: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers['set-cookie'];
  assert(cookie && cookie.length > 0, `登录未返回 Cookie: ${employeeNo}`);
  return cookie.map(value => value.split(';')[0]).join('; ');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function getRoleId(code) {
  const role = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(code);
  assert(role, `缺少角色编码: ${code}`);
  return role.role_id;
}

function createUser(employeeNo, name, departmentId, legacyRole, roleCodes) {
  const userId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, employeeNo, departmentId, `${TEST_PREFIX}岗位`, legacyRole, hashPassword(PASSWORD)).lastInsertRowid;

  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  for (const code of roleCodes) insertRole.run(userId, getRoleId(code));
  return userId;
}

function seedData() {
  const deptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}经营发展部`, `${TEST_PREFIX}DEPT`).lastInsertRowid;

  const otherDeptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES (?, ?, '业务')
  `).run(`${TEST_PREFIX}工程技术部`, `${TEST_PREFIX}DEPT_B`).lastInsertRowid;

  const submitterId = createUser(`${TEST_PREFIX}SUB`, '报送用户', deptId, 'submitter', ['department_contact']);
  createUser(`${TEST_PREFIX}ADMIN`, '管理员用户', deptId, 'admin', ['admin', 'mdm_lead']);

  const capId = db.prepare(`
    INSERT INTO capabilities (name, level, owner_dept_id, status)
    VALUES (?, 'L1', ?, 'approved')
  `).run(`${TEST_PREFIX}能力`, deptId).lastInsertRowid;
  const processId = db.prepare(`
    INSERT INTO processes (name, capability_id, owner_dept_id, status)
    VALUES (?, ?, ?, 'approved')
  `).run(`${TEST_PREFIX}流程`, capId, deptId).lastInsertRowid;
  const mappingId = db.prepare(`
    INSERT INTO mappings (process_id, description, owner_dept_id, status, current_step, submitted_by)
    VALUES (?, ?, ?, 'submitted', 2, ?)
  `).run(processId, `${TEST_PREFIX}映射`, deptId, submitterId).lastInsertRowid;

  db.prepare(`
    INSERT INTO todos (from_dept_id, to_dept_id, type, related_mapping_id, content, urgency, due_date)
    VALUES (?, ?, 'field_confirm', ?, ?, 'high', '2026-06-12')
  `).run(otherDeptId, deptId, mappingId, `${TEST_PREFIX}字段确认待办`);

  return { deptId, processId, mappingId };
}

function assertWorkflowPayload(body, tab, view) {
  assert(body.tab === tab, `${tab} 应保留 tab`);
  assert(body.view === view, `${tab} 应保留 view`);
  assert(body.user && body.user.departmentName, `${tab} 应返回用户部门`);
  assert(body.page && body.page.title, `${tab} 应返回页面标题`);
  assert(body.summary && typeof body.summary.priorityCount === 'number', `${tab} 应返回汇总`);
  assert(Array.isArray(body.nextActions) && body.nextActions.length >= 1, `${tab} 应返回下一步动作`);
  assert(body.nextActions[0].title && body.nextActions[0].target && body.nextActions[0].actionLabel, `${tab} 下一步动作结构不完整`);
  assert(Array.isArray(body.workflow) && body.workflow.length >= 2, `${tab} 应返回工作流步骤`);
  assert(body.workflow.some(step => step.status === 'current'), `${tab} 工作流应包含当前步骤`);
  assert(body.context && body.context.sample && body.context.doneCriteria, `${tab} 应返回上下文说明`);
  assert(Array.isArray(body.detailActions), `${tab} 应返回 detailActions 数组`);
}

async function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function runMysqlIdentityPageWorkflowCollisionRegression() {
  const express = require('express');
  const auth = require('../server/auth');
  const pageWorkflowsRouter = require('../server/routes/pageWorkflows');
  const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

  db.prepare(`
    INSERT INTO departments (id, name, code, department_type, source_system, external_id)
    VALUES (901, '质量管理部', 'PAGE_WF_LOCAL_COLLISION_DEPT_901', '职能', 'PROCESS_GOVERNANCE', 'PAGE_WF_LOCAL_DEPT_901')
  `).run();
  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (43, '本地同号用户', 'PAGE_WF_LOCAL_COLLISION_USER_43', 901, '本地旧用户', 'submitter', ?)
  `).run(hashPassword(PASSWORD));

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert(userId === 43, `权限读取用户应为 43，实际 ${userId}`);
      return { permSet: new Set(['governance:read-global']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId) {
      assert(userId === 43, `角色读取用户应为 43，实际 ${userId}`);
      return [
        { code: 'admin', name: '管理员' },
        { code: 'mdm_lead', name: 'MDM工作组组长' }
      ];
    },
    async getDepartmentById(departmentId) {
      assert(Number(departmentId) === 901, `部门读取应为 901，实际 ${departmentId}`);
      return { id: 901, name: '经营发展部', code: 'DEPT_JYFZ' };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 43,
      userRole: 'admin',
      userName: 'MySQL 身份用户',
      departmentId: 901
    };
    next();
  });
  app.use('/api/page-workflows', pageWorkflowsRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/page-workflows?tab=processGovernance&view=list`);
    const body = await response.json();
    assert(response.status === 200, `MySQL 身份页面工作流失败: ${response.status} ${JSON.stringify(body)}`);
    assert(body.user.departmentName === '经营发展部', `页面工作流应返回 MySQL 身份部门，实际 ${body.user.departmentName}`);
    assert(body.user.roleCodes.includes('mdm_lead'), '页面工作流应返回 MySQL 身份角色');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
    if (previousReadModel === undefined) {
      delete process.env.MDM_IDENTITY_READ_MODEL;
    } else {
      process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
    }
  }
}

async function main() {
  let child;

  try {
    const seeded = seedData();
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: {
        ...process.env,
        PORT: String(PORT),
        SESSION_SECRET: 'page-workflow-test',
        MDM_IDENTITY_READ_MODEL: '',
        PROCESS_GOVERNANCE_READ_MODEL: ''
      },
      stdio: 'ignore'
    });
    await waitForServer(child);

    const unauth = await request('GET', '/api/page-workflows?tab=dashboard');
    assert(unauth.status === 401, `未登录访问页面工作流应返回 401，实际 ${unauth.status}`);

    const submitterCookie = await login(`${TEST_PREFIX}SUB`);
    const tabs = [
      'dashboard', 'roleGuide', 'mySubmissions', 'capabilities', 'businessMap', 'processGovernance',
      'todos', 'reviews', 'terms', 'conflicts', 'orgUnits', 'persons', 'products', 'quality', 'rbac'
    ];

    for (const tab of tabs) {
      const res = await request('GET', `/api/page-workflows?tab=${encodeURIComponent(tab)}&view=list`, null, submitterCookie);
      assert(res.status === 200, `${tab} 页面工作流失败: ${res.status} ${JSON.stringify(res.body)}`);
      assertWorkflowPayload(res.body, tab, 'list');
    }

    const roleGuide = await request('GET', '/api/page-workflows?tab=roleGuide&view=list', null, submitterCookie);
    assert(roleGuide.status === 200, `角色使用说明工作流失败: ${roleGuide.status}`);
    assert(roleGuide.body.page.title === '角色与责任', `角色与责任页面不应返回其他页面标题: ${roleGuide.body.page.title}`);

    const detail = await request(
      'GET',
      `/api/page-workflows?tab=mySubmissions&view=detail&entityType=mapping&entityId=${seeded.mappingId}`,
      null,
      submitterCookie
    );
    assert(detail.status === 200, `详情页工作流失败: ${detail.status}`);
    assertWorkflowPayload(detail.body, 'mySubmissions', 'detail');
    assert(detail.body.detailActions.some(action => action.target.includes(String(seeded.mappingId))), '详情页动作应包含当前实体入口');

    const form = await request(
      'GET',
      '/api/page-workflows?tab=persons&view=form&entityType=person&entityId=new',
      null,
      submitterCookie
    );
    assert(form.status === 200, `表单页工作流失败: ${form.status}`);
    assertWorkflowPayload(form.body, 'persons', 'form');
    assert(form.body.workflow.some(step => step.key === 'save'), '表单页应包含保存步骤');

    const adminCookie = await login(`${TEST_PREFIX}ADMIN`);
    const adminRbac = await request('GET', '/api/page-workflows?tab=rbac&view=list', null, adminCookie);
    assert(adminRbac.status === 200, `管理员 RBAC 工作流失败: ${adminRbac.status}`);
    assert(adminRbac.body.nextActions.some(action => action.roleCode === 'admin' || String(action.target).includes('rbac')), '管理员应看到角色权限优先动作');

    console.log('Page workflows API test passed');
    await runMysqlIdentityPageWorkflowCollisionRegression();
  } finally {
    await stopServer(child);
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
