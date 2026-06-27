const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const PORT = 3236;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function seedFixture() {
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('项目管理部', 'PMO')").run();
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('工程技术部', 'ENG')").run();
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('公司领导', 'EXEC')").run();
  const dept = db.prepare("SELECT id FROM departments WHERE name='项目管理部'").get();
  const execDept = db.prepare("SELECT id FROM departments WHERE name='公司领导'").get();
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('系统管理员', 'ADMIN001', execDept.id, '系统管理员', 'admin', hashPassword('admin123'));
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run('流程确认人', 'USER001', dept.id, '业务对接人', 'submitter', hashPassword('user123'));

  const snapshot = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json, status, note)
    VALUES ('fixture/process-governance.json', 'issue-pool-api', '{}', 'active', 'issue pool api')
  `).run();
  const snapshotId = snapshot.lastInsertRowid;
  const record = db.prepare(`
    INSERT INTO process_mapping_records (
      mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, domain_name,
      l2_name, l3_name, a1_code, behavior, execution_role, output_target_dept,
      suggested_systems, verification_note, source_file, status
    ) VALUES (
      'issue-pool-api-record-001', 'a1', ?, ?, '项目管理部', '生产副总',
      '项目计划管理', '项目阶段划分与阶段评审', 'XM-L3-03-A01', '设置阶段评审计划',
      '项目负责人', '工程技术部', '["OA"]', '责任人和完成标准需要确认',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系.md', 'active'
    )
  `).run(snapshotId, snapshotId);
  db.prepare(`
    INSERT INTO process_mapping_todos (
      todo_key, todo_type, mapping_record_id, first_snapshot_id, latest_snapshot_id, dept_name,
      target_dept_name, l3_name, a1_code, source_file, message, suggestion, status, priority
    ) VALUES (
      'issue-pool-api-todo-001', 'verification', ?, ?, ?, '项目管理部',
      '工程技术部', '项目阶段划分与阶段评审', 'XM-L3-03-A01',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系.md',
      '阶段评审计划的责任人不够具体', '请确认执行岗位和完成标准', 'open', 'high'
    )
  `).run(record.lastInsertRowid, snapshotId, snapshotId);
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 8000;
    const tick = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/health`);
        if (res.ok) return resolve();
      } catch (error) {
        if (Date.now() > deadline) return reject(error);
      }
      setTimeout(tick, 200);
    };
    tick();
  });
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
  const body = await res.json();
  return { res, body };
}

async function csrfTokenFor(cookie) {
  if (csrfTokens.has(cookie)) return csrfTokens.get(cookie);
  const result = await request('/api/csrf-token', {}, cookie);
  if (result.res.status !== 200 || !result.body.csrfToken) return '';
  csrfTokens.set(cookie, result.body.csrfToken);
  return result.body.csrfToken;
}

async function main() {
  seedFixture();
  db.close();

  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      SESSION_SECRET: 'process-governance-issue-pool-api-test',
      MDM_DB_QUIET: '1',
      MDM_IDENTITY_READ_MODEL: '',
      PROCESS_GOVERNANCE_READ_MODEL: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', chunk => { stderr += chunk.toString(); });

  try {
    await waitForServer();

    const unauthorized = await request('/api/process-governance/issue-pool/queues');
    assert.strictEqual(unauthorized.res.status, 401);

    const normalLogin = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'USER001', password: 'user123' })
    });
    assert.strictEqual(normalLogin.res.status, 200);
    const normalCookie = normalLogin.res.headers.get('set-cookie').split(';')[0];

    const forbiddenBatch = await request('/api/process-governance/issue-pool/batches/generate', {
      method: 'POST',
      body: JSON.stringify({})
    }, normalCookie);
    assert.strictEqual(forbiddenBatch.res.status, 403);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const batch = await request('/api/process-governance/issue-pool/batches/generate', {
      method: 'POST',
      body: JSON.stringify({})
    }, cookie);
    assert.strictEqual(batch.res.status, 200);
    assert.ok(batch.body.batch.batch_key);
    assert.strictEqual(batch.body.batch.status, 'ready');

    const queues = await request('/api/process-governance/issue-pool/queues', {}, cookie);
    assert.strictEqual(queues.res.status, 200);
    assert.strictEqual(queues.body.dataStatus, 'ready');
    assert.strictEqual(queues.body.departmentName, '全部部门');
    assert.ok(queues.body.queues.some(queue => queue.label === '需要我确认' && queue.count === 1));
    assert.ok(queues.body.queues.some(queue => queue.label === '需要我协同'));

    const normalQueues = await request('/api/process-governance/issue-pool/queues', {}, normalCookie);
    assert.strictEqual(normalQueues.res.status, 200);
    assert.strictEqual(normalQueues.body.departmentName, '项目管理部');
    assert.ok(normalQueues.body.queues.some(queue => queue.label === '需要我确认' && queue.count === 1));

    const issues = await request('/api/process-governance/issue-pool/issues?queue=waiting_my_action&limit=20', {}, cookie);
    assert.strictEqual(issues.res.status, 200);
    assert.strictEqual(issues.body.pagination.limit, 20);
    assert.strictEqual(issues.body.items[0].a1_name, '设置阶段评审计划');

    const detail = await request(`/api/process-governance/issue-pool/issues/${issues.body.items[0].issue_id}`, {}, cookie);
    assert.strictEqual(detail.res.status, 200);
    assert.strictEqual(detail.body.issue.a1_name, '设置阶段评审计划');
    assert.ok(detail.body.issue.what_text);
    assert.ok(detail.body.issue.why_text);
    assert.ok(detail.body.points.length >= 1);
    assert.ok(detail.body.events.length >= 1);
    const eventCount = detail.body.events.length;
    const pointId = detail.body.points[0].point_id;

    const confirm = await request(`/api/process-governance/issue-pool/points/${pointId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ selected_option: '已有具体岗位', note: '项目负责人负责设置阶段评审计划。' })
    }, cookie);
    assert.strictEqual(confirm.res.status, 200);
    assert.strictEqual(confirm.body.point.selected_option, '已有具体岗位');
    assert.ok(confirm.body.events.length > eventCount);

    const termTask = await request('/api/process-governance/issue-pool/term-tasks', {
      method: 'POST',
      body: JSON.stringify({
        issue_id: detail.body.issue.issue_id,
        point_id: pointId,
        term_text: '项目主管领导',
        context_text: '阶段评审计划确认意见',
        selected_departments: ['项目管理部', '工程技术部']
      })
    }, cookie);
    assert.strictEqual(termTask.res.status, 200);
    assert.strictEqual(termTask.body.task.term_text, '项目主管领导');
    assert.deepStrictEqual(termTask.body.task.selected_departments, ['项目管理部', '工程技术部']);

    const answer = await request(`/api/process-governance/issue-pool/term-tasks/${termTask.body.task.term_task_id}/answer`, {
      method: 'POST',
      body: JSON.stringify({ department_name: '项目管理部', answer: '保留原表达，并说明原因', note: '本部门制度当前这样表述。' })
    }, cookie);
    assert.strictEqual(answer.res.status, 200);
    assert.strictEqual(answer.body.success, true);

    const decision = await request(`/api/process-governance/issue-pool/term-tasks/${termTask.body.task.term_task_id}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: {
          standard_term: '项目负责人',
          allowed_aliases: ['项目主管领导', '项目经理'],
          discouraged_terms: ['项目老大'],
          business_scope: '项目阶段评审',
          departments: ['项目管理部', '工程技术部'],
          source_issue_id: detail.body.issue.issue_id
        }
      })
    }, cookie);
    assert.strictEqual(decision.res.status, 200);
    assert.strictEqual(decision.body.decision.standard_term, '项目负责人');

    console.log('Process governance issue pool API test passed');
  } catch (error) {
    if (stderr) console.error(stderr);
    throw error;
  } finally {
    await stopServer(server);
    cleanupDb();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
