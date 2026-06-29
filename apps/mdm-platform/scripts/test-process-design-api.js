const assert = require('assert');
const { spawn } = require('child_process');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { cleanupDb, legacyTestEnv, stopServer } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const APP_ROOT = path.join(__dirname, '..');
const PORT = 3238;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'pass1234';

function roleId(code) {
  const row = db.prepare('SELECT role_id FROM roles WHERE role_code=?').get(code);
  assert.ok(row, `missing role ${code}`);
  return row.role_id;
}

function createUser(employeeNo, name, departmentId, legacyRole, roleCodes) {
  const userId = db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, '流程治理测试岗', ?, ?)
  `).run(name, employeeNo, departmentId, legacyRole, hashPassword(PASSWORD)).lastInsertRowid;

  const insertRole = db.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)');
  roleCodes.forEach(code => insertRole.run(userId, roleId(code)));
  return userId;
}

function seedData() {
  const operatingDeptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES ('经营发展部', 'PD_PROC_DESIGN', '业务')
  `).run().lastInsertRowid;
  const engineeringDeptId = db.prepare(`
    INSERT INTO departments (name, code, department_type)
    VALUES ('工程技术部', 'ENG_PROC_DESIGN', '职能')
  `).run().lastInsertRowid;

  createUser('PD_SUBMITTER', '经营填报人', operatingDeptId, 'submitter', ['submitter']);
  createUser('PD_BUSINESS', '业务对接人', operatingDeptId, 'owner', ['business_contact']);
  createUser('PD_REVIEWER', '流程审核人', operatingDeptId, 'reviewer', ['reviewer', 'data_quality']);
  createUser('PD_ADMIN', '流程管理员', engineeringDeptId, 'admin', ['admin', 'it_lead']);
  createUser('PD_NODEPT', '无部门人员', null, 'submitter', ['submitter']);

  const snapshotId = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, stats_json, status, note)
    VALUES ('test-process-design.json', 'process-design-hash', '2026-06-22', ?, 'active', 'process design test snapshot')
  `).run(JSON.stringify({ mappings: 0, a1: 0, departmentsWithData: 0, departmentsEmpty: 0 })).lastInsertRowid;
  db.prepare(`
    INSERT INTO process_governance_nodes
      (snapshot_id, node_key, node_type, name, domain_name, dept_name, parent_key, sort_order)
    VALUES
      (?, '昌兴复材', 'root', '昌兴复材', NULL, NULL, NULL, 1),
      (?, '经营域', 'domain', '经营域', '经营域', NULL, '昌兴复材', 2)
  `).run(snapshotId, snapshotId);
  db.prepare(`
    INSERT INTO process_governance_edges (snapshot_id, source_key, target_key, edge_type, value)
    VALUES (?, '昌兴复材', '经营域', 'root_domain', 1)
  `).run(snapshotId);

  return { operatingDeptId, engineeringDeptId };
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

async function waitForServer(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${child.exitCode}`);
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) return;
    } catch {
      await wait(200);
    }
  }
  throw new Error('server did not start');
}

const csrfTokens = new Map();

async function request(routePath, options = {}, cookie = '') {
  const requestOptions = { ...options };
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const headers = {
    ...(requestOptions.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  if (cookie && !['GET', 'HEAD', 'OPTIONS'].includes(method) && routePath !== '/api/org/login') {
    const token = await csrfTokenFor(cookie);
    if (token) headers['X-CSRF-Token'] = token;
  }
  const res = await fetch(`${BASE_URL}${routePath}`, { ...requestOptions, headers });
  const text = await res.text();
  let body = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }
  return { res, body };
}

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

async function login(employeeNo) {
  const res = await request('/api/org/login', {
    method: 'POST',
    body: JSON.stringify({ employee_no: employeeNo, password: PASSWORD })
  });
  assert.strictEqual(res.res.status, 200, JSON.stringify(res.body));
  return res.res.headers.get('set-cookie').split(';')[0];
}

async function runMysqlIdentityDepartmentBridgeRegression() {
  const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
  const auth = require('../server/auth');
  const processDesignRouter = require('../server/routes/processDesign');
  let permissionReads = 0;
  let departmentReads = 0;

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      permissionReads += 1;
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId) {
      assert.strictEqual(userId, 42);
      return [
        { code: 'admin', name: '管理员' },
        { code: 'it_lead', name: '信息化负责人' }
      ];
    },
    async getDepartmentById(departmentId) {
      departmentReads += 1;
      assert.strictEqual(Number(departmentId), 900);
      return { id: 900, name: '经营发展部', code: 'DEPT_JYFZ' };
    },
    async getUserById(userId) {
      assert.strictEqual(userId, 42);
      return {
        id: 42,
        name: 'MySQL 身份用户',
        employee_no: 'MYSQL_PROC_42',
        department_id: 900,
        post: '流程治理测试岗',
        role: 'admin'
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'admin',
      userName: 'MySQL 身份用户',
      departmentId: 900
    };
    next();
  });
  app.use('/api/process-design', processDesignRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/process-design/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_name: 'MySQL 身份部门创建草稿',
        reason: '身份读取模型返回的部门尚未进入本地草稿库',
        basis_type: '现场实际',
        basis_description: '浏览器联调发现 MySQL 部门 ID 与本地草稿库不同步',
        involves_other_departments: false,
        related_departments: []
      })
    });
    const body = await response.json();
    assert.strictEqual(response.status, 201, JSON.stringify(body));
    assert.strictEqual(body.department_id, 900);
    assert.strictEqual(body.department_name, '经营发展部');
    assert.ok(permissionReads > 0, '应通过 MySQL 身份仓储读取权限');
    assert.ok(departmentReads > 0, '应通过 MySQL 身份仓储补齐部门');
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

async function runMysqlIdentityIdCollisionRegression() {
  db.prepare(`
    INSERT INTO departments (id, name, code, department_type, source_system, external_id)
    VALUES (901, '质量管理部', 'LOCAL_COLLISION_DEPT_901', '职能', 'PROCESS_GOVERNANCE', 'LOCAL_DEPT_901')
  `).run();
  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (43, '本地同号用户', 'LOCAL_COLLISION_USER_43', 901, '本地旧用户', 'submitter', ?)
  `).run(hashPassword(PASSWORD));

  const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
  const auth = require('../server/auth');
  const processDesignRouter = require('../server/routes/processDesign');
  let departmentReads = 0;
  let userReads = 0;

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 43);
      return { permSet: new Set(['admin:access']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId) {
      assert.strictEqual(userId, 43);
      return [
        { code: 'admin', name: '管理员' },
        { code: 'it_lead', name: '信息化负责人' }
      ];
    },
    async getDepartmentById(departmentId) {
      departmentReads += 1;
      assert.strictEqual(Number(departmentId), 901);
      return { id: 901, name: '经营发展部', code: 'DEPT_JYFZ' };
    },
    async getUserById(userId) {
      userReads += 1;
      assert.strictEqual(userId, 43);
      return {
        id: 43,
        name: 'MySQL 身份用户',
        employee_no: 'MYSQL_PROC_43',
        department_id: 901,
        post: '流程治理测试岗',
        role: 'admin'
      };
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
  app.use('/api/process-design', processDesignRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const response = await fetch(`${baseUrl}/api/process-design/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        process_name: 'MySQL 身份 ID 碰撞草稿',
        reason: '身份读取模型与本地 SQLite 存在同 ID 不同语义',
        basis_type: '现场实际',
        basis_description: '页面烟测发现草稿错误落到本地同 ID 部门',
        involves_other_departments: false,
        related_departments: []
      })
    });
    const body = await response.json();
    assert.strictEqual(response.status, 201, JSON.stringify(body));
    assert.notStrictEqual(body.department_id, 901, '不应复用本地同 ID 但不同语义的部门');
    assert.strictEqual(body.department_name, '经营发展部');
    assert.notStrictEqual(body.created_by, 43, '不应复用本地同 ID 但不同语义的用户');
    assert.strictEqual(body.created_by_name, 'MySQL 身份用户');
    const event = db.prepare(`
      SELECT e.actor_user_id, u.name AS actor_user_name
      FROM process_design_events e
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.draft_id=? AND e.event_type='draft_created'
    `).get(body.id);
    assert.strictEqual(event.actor_user_id, body.created_by);
    assert.strictEqual(event.actor_user_name, 'MySQL 身份用户');
    assert.ok(departmentReads > 0, '应读取 MySQL 身份部门以识别 ID 碰撞');
    assert.ok(userReads > 0, '应读取 MySQL 身份用户以识别 ID 碰撞');
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
  const { operatingDeptId, engineeringDeptId } = seedData();
  const normFile = path.join(__dirname, '..', '..', '..', 'docs', 'norms', '经营发展部部门-能力-流程-系统映射关系.md');
  const beforeNorm = fs.existsSync(normFile) ? fs.readFileSync(normFile, 'utf8') : null;
  let child;

  try {
    child = spawn(process.execPath, ['server/index.js'], {
      cwd: APP_ROOT,
      env: legacyTestEnv({ PORT: String(PORT), SESSION_SECRET: 'process-design-api-test' }),
      stdio: 'ignore'
    });
    await waitForServer(child);

    const anonymous = await request('/api/process-design/summary');
    assert.strictEqual(anonymous.res.status, 401);

    const submitterCookie = await login('PD_SUBMITTER');
    const reviewerCookie = await login('PD_REVIEWER');
    const adminCookie = await login('PD_ADMIN');
    const noDeptCookie = await login('PD_NODEPT');

    const noDeptDraft = await request('/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        process_name: '无部门流程',
        reason: '现场新增管理动作',
        basis_type: '现场实际',
        basis_description: '现场已有执行动作',
        involves_other_departments: false
      })
    }, noDeptCookie);
    assert.strictEqual(noDeptDraft.res.status, 400);
    assert.ok(String(noDeptDraft.body.error).includes('组织信息'));

    const missingDraft = await request('/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({ process_name: '缺必填流程' })
    }, submitterCookie);
    assert.strictEqual(missingDraft.res.status, 422);
    assert.ok(missingDraft.body.details.some(item => item.field === 'reason'));

    const otherDeptDraft = await request('/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        department_id: engineeringDeptId,
        process_name: '跨部门创建应拒绝',
        reason: '现场新增管理动作',
        basis_type: '现场实际',
        basis_description: '现场已有执行动作',
        involves_other_departments: false
      })
    }, submitterCookie);
    assert.strictEqual(otherDeptDraft.res.status, 403);

    const adminMissingReason = await request('/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        department_id: operatingDeptId,
        process_name: '管理员代建流程',
        reason: '补充跨部门流程',
        basis_type: '访谈',
        basis_description: '部门访谈确认',
        involves_other_departments: true
      })
    }, adminCookie);
    assert.strictEqual(adminMissingReason.res.status, 422);
    assert.ok(adminMissingReason.body.details.some(item => item.field === 'proxy_reason'));

    const draftRes = await request('/api/process-design/drafts', {
      method: 'POST',
      body: JSON.stringify({
        process_name: '客户资料变更确认流程',
        reason: '业务已经在执行，但当前快照未覆盖',
        basis_type: '现场实际',
        basis_description: '经营发展部每周会收到客户资料变更需求并确认',
        involves_other_departments: true,
        related_departments: ['工程技术部']
      })
    }, submitterCookie);
    assert.strictEqual(draftRes.res.status, 201, JSON.stringify(draftRes.body));
    assert.strictEqual(draftRes.body.department_id, operatingDeptId);
    assert.strictEqual(draftRes.body.status, 'draft');
    assert.ok(draftRes.body.outcome.formed.includes('流程草稿'));
    const draftId = draftRes.body.id;

    const stepRes = await request(`/api/process-design/drafts/${draftId}/steps`, {
      method: 'POST',
      body: JSON.stringify({
        step_name: '确认客户资料变更需求',
        actor_role: '经营发展部经办人',
        timing: '收到客户资料变更需求时',
        input_materials: '客户变更说明',
        output_result: '',
        need_confirmation: true,
        related_departments: '工程技术部',
        basis: '现场实际'
      })
    }, submitterCookie);
    assert.strictEqual(stepRes.res.status, 201, JSON.stringify(stepRes.body));

    const formRes = await request(`/api/process-design/drafts/${draftId}/forms`, {
      method: 'POST',
      body: JSON.stringify({
        form_name: '客户资料变更确认表',
        step_id: stepRes.body.id,
        archive_rule: ''
      })
    }, submitterCookie);
    assert.strictEqual(formRes.res.status, 201, JSON.stringify(formRes.body));

    const fieldRes = await request(`/api/process-design/forms/${formRes.body.id}/fields`, {
      method: 'POST',
      body: JSON.stringify({
        field_name_cn: '变更类型',
        field_name_en: 'change_type',
        data_object: '客户',
        field_type: '枚举',
        enum_options: '',
        evidence_note: '现场表单已有此字段'
      })
    }, submitterCookie);
    assert.strictEqual(fieldRes.res.status, 201, JSON.stringify(fieldRes.body));
    assert.strictEqual(fieldRes.body.status, 'suggested');

    const evidenceRes = await request(`/api/process-design/drafts/${draftId}/evidence`, {
      method: 'POST',
      body: JSON.stringify({
        object_type: 'process',
        object_id: draftId,
        evidence_type: '现场实际',
        description: '经营发展部经办人按客户邮件登记并确认',
        source_name: '',
        source_anchor: '',
        confirmer: '',
        record_time: ''
      })
    }, submitterCookie);
    assert.strictEqual(evidenceRes.res.status, 201, JSON.stringify(evidenceRes.body));
    assert.strictEqual(evidenceRes.body.maturity, '可提交审核');

    const risks = await request(`/api/process-design/drafts/${draftId}/risks`, {}, submitterCookie);
    assert.strictEqual(risks.res.status, 200);
    assert.ok(risks.body.items.some(item => item.object_type === 'step' && item.message.includes('产生什么结果')));
    assert.ok(risks.body.items.some(item => item.object_type === 'field' && item.message.includes('选项还没列出来')));
    assert.ok(risks.body.items.some(item => item.object_type === 'evidence' && item.message.includes('还不够支撑正式发布')));
    assert.ok(risks.body.items.every(item => !String(item.message).includes('RULE_')));

    const preview = await request(`/api/process-design/drafts/${draftId}/outcome-preview`, {}, submitterCookie);
    assert.strictEqual(preview.res.status, 200);
    assert.strictEqual(preview.body.counts.steps, 1);
    assert.strictEqual(preview.body.counts.fields, 1);
    assert.ok(preview.body.outcome.missing.some(item => item.includes('来源锚点')));

    const submit = await request(`/api/process-design/drafts/${draftId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: '提交部门内审' })
    }, submitterCookie);
    assert.strictEqual(submit.res.status, 200, JSON.stringify(submit.body));
    assert.strictEqual(submit.body.draft.status, 'submitted');
    assert.ok(submit.body.reviewTask.id);

    const publishMissingClassification = await request(`/api/process-design/drafts/${draftId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ note: '尝试发布' })
    }, reviewerCookie);
    assert.strictEqual(publishMissingClassification.res.status, 422);
    assert.ok(publishMissingClassification.body.details.some(item => item.includes('L1')));

    const issueClassification = await request(`/api/process-design/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        l1_name: '客户管理',
        l1_status: 'needs_review',
        l2_name: '客户资料管理',
        l2_status: 'confirmed',
        l3_name: '客户资料变更确认流程'
      })
    }, reviewerCookie);
    assert.strictEqual(issueClassification.res.status, 200, JSON.stringify(issueClassification.body));

    const publishReviewItem = await request(`/api/process-design/drafts/${draftId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ note: '待确认能力不可发布' })
    }, reviewerCookie);
    assert.strictEqual(publishReviewItem.res.status, 422);
    assert.ok(publishReviewItem.body.details.some(item => item.includes('待确认')));

    const confirmedClassification = await request(`/api/process-design/drafts/${draftId}`, {
      method: 'PUT',
      body: JSON.stringify({
        l1_status: 'confirmed',
        l2_status: 'confirmed'
      })
    }, reviewerCookie);
    assert.strictEqual(confirmedClassification.res.status, 200);

    const fixStep = await request(`/api/process-design/steps/${stepRes.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ output_result: '客户资料变更确认记录' })
    }, submitterCookie);
    assert.strictEqual(fixStep.res.status, 200);

    const fixField = await request(`/api/process-design/form-fields/${fieldRes.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ enum_options: '新增;变更;停用', status: 'business_confirmed' })
    }, submitterCookie);
    assert.strictEqual(fixField.res.status, 200);

    const fixForm = await request(`/api/process-design/forms/${formRes.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({ archive_rule: '发布版本保存在 MDM 在线表单' })
    }, submitterCookie);
    assert.strictEqual(fixForm.res.status, 200);

    const fixEvidence = await request(`/api/process-design/evidence/${evidenceRes.body.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        source_name: '客户资料变更访谈纪要',
        source_anchor: '2026-06-22 访谈记录第 2 条',
        confirmer: '经营发展部负责人',
        record_time: '2026-06-22'
      })
    }, submitterCookie);
    assert.strictEqual(fixEvidence.res.status, 200);
    assert.strictEqual(fixEvidence.body.maturity, '可支撑发布');

    const publish = await request(`/api/process-design/drafts/${draftId}/publish`, {
      method: 'POST',
      body: JSON.stringify({ note: '审核通过并发布' })
    }, reviewerCookie);
    assert.strictEqual(publish.res.status, 200, JSON.stringify(publish.body));
    assert.strictEqual(publish.body.draft.status, 'published');
    assert.ok(publish.body.version.version_no);
    assert.ok(publish.body.outcome.formed.includes('发布版本'));

    const detail = await request(`/api/process-design/drafts/${draftId}`, {}, submitterCookie);
    assert.strictEqual(detail.res.status, 200);
    assert.strictEqual(detail.body.draft.status, 'published');
    assert.strictEqual(detail.body.steps.length, 1);
    assert.strictEqual(detail.body.forms[0].fields.length, 1);
    assert.strictEqual(detail.body.events.some(event => event.event_type === 'published'), true);

    const a1 = await request('/api/process-governance/a1?dept=经营发展部', {}, reviewerCookie);
    assert.strictEqual(a1.res.status, 200);
    assert.ok(a1.body.items.some(item => item.l3_name === '客户资料变更确认流程'), 'published design should appear in process governance A1 view');

    const sankey = await request('/api/process-governance/sankey', {}, reviewerCookie);
    assert.strictEqual(sankey.res.status, 200);
    assert.ok(sankey.body.nodes.some(node => node.label === '客户资料变更确认流程'), 'published design should appear in process governance map');

    const summary = await request('/api/process-design/summary', {}, reviewerCookie);
    assert.strictEqual(summary.res.status, 200);
    assert.strictEqual(summary.body.summary.totalDrafts, 1);
    assert.strictEqual(summary.body.summary.publishedVersions, 1);

    if (beforeNorm !== null) {
      assert.strictEqual(fs.readFileSync(normFile, 'utf8'), beforeNorm, 'process design publish must not modify docs/norms');
    }

    await runMysqlIdentityDepartmentBridgeRegression();
    await runMysqlIdentityIdCollisionRegression();
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
  console.error(error);
  process.exit(1);
});
