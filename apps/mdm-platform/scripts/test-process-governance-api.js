const assert = require('assert');
const { spawn } = require('child_process');
const path = require('path');
const { cleanupDb, stopServer } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const PORT = 3226;
const BASE_URL = `http://127.0.0.1:${PORT}`;

db.prepare(`
  INSERT INTO users (name, employee_no, post, role, password_hash)
  VALUES (?, ?, ?, ?, ?)
`).run('系统管理员', 'ADMIN001', '系统管理员', 'admin', hashPassword('admin123'));
db.prepare(`
  INSERT INTO users (name, employee_no, post, role, password_hash)
  VALUES (?, ?, ?, ?, ?)
`).run('普通提交人', 'USER001', '业务提交人', 'submitter', hashPassword('user123'));

importProcessGovernanceSnapshot({
  db,
  sourceJsonPath: path.join(__dirname, 'fixtures', 'process-governance-snapshot.json'),
  a1MarkdownPaths: [path.join(__dirname, 'fixtures', 'process-governance-a1.md')],
  qualityFindings: [
    {
      severity: 'BLOCK',
      area: 'ORG',
      file: 'docs/organization/组织架构和部门职责.md',
      line: 1,
      message: '组织真源路径需要统一',
      suggestion: '规则文件统一引用当前组织真源。'
    },
    {
      severity: 'WARN',
      area: 'BBM',
      file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
      line: 42,
      message: '经营发展部 A1 待补充核验提醒',
      suggestion: '回源补充核验提醒。'
    }
  ],
  importedBy: null,
  note: 'api fixture'
});

db.prepare(`
  UPDATE process_governance_quality_cases
  SET status='source_resolved'
  WHERE severity='BLOCK'
`).run();
db.prepare(`
  UPDATE process_mapping_todos
  SET status='source_resolved'
  WHERE todo_type='verification'
`).run();

db.close();

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

async function request(routePath, options = {}, cookie = '') {
  const headers = {
    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    ...(cookie ? { Cookie: cookie } : {})
  };
  const res = await fetch(`${BASE_URL}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

async function main() {
  const server = spawn(process.execPath, ['server/index.js'], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      PORT: String(PORT),
      SESSION_SECRET: 'process-governance-api-test',
      MDM_DB_QUIET: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let stderr = '';
  server.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  try {
    await waitForServer();

    const unauthorized = await request('/api/process-governance/current');
    assert.strictEqual(unauthorized.res.status, 401);

    const login = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'ADMIN001', password: 'admin123' })
    });
    assert.strictEqual(login.res.status, 200);
    const cookie = login.res.headers.get('set-cookie').split(';')[0];

    const current = await request('/api/process-governance/current', {}, cookie);
    assert.strictEqual(current.res.status, 200);
    assert.strictEqual(current.body.stats.mappings, 1);
    assert.deepStrictEqual(current.body.qualitySummary, { BLOCK: 1, WARN: 1, INFO: 0 });

    const snapshots = await request('/api/process-governance/snapshots', {}, cookie);
    assert.strictEqual(snapshots.res.status, 200);
    assert.strictEqual(snapshots.body.length, 1);

    const sankey = await request('/api/process-governance/sankey', {}, cookie);
    assert.strictEqual(sankey.res.status, 200);
    assert.strictEqual(sankey.body.stats.mappings, 1);
    assert.strictEqual(sankey.body.systems.join(','), 'ERP,OA');
    assert.strictEqual(sankey.body.crossDept.stats.highRisk, 1);
    assert.ok(sankey.body.nodes.some(node => node.name === '经营发展部'));

    const a1 = await request('/api/process-governance/a1?dept=经营发展部', {}, cookie);
    assert.strictEqual(a1.res.status, 200);
    assert.strictEqual(a1.body.items[0].a1_code, 'JY-L3-01-A1-001');
    assert.deepStrictEqual(a1.body.items[0].suggested_systems, ['OA', 'ERP']);

    const filteredA1 = await request('/api/process-governance/a1?system=ERP', {}, cookie);
    assert.strictEqual(filteredA1.res.status, 200);
    assert.strictEqual(filteredA1.body.items.length, 1);

    const risks = await request('/api/process-governance/cross-dept?risk=high', {}, cookie);
    assert.strictEqual(risks.res.status, 200);
    assert.strictEqual(risks.body.items[0].target_dept, '工程技术部');

    const chains = await request('/api/process-governance/chains', {}, cookie);
    assert.strictEqual(chains.res.status, 200);
    assert.deepStrictEqual(chains.body.items[0].breaks, ['工程技术部: 技术条款评审节点待补全']);

    const quality = await request('/api/process-governance/quality', {}, cookie);
    assert.strictEqual(quality.res.status, 200);
    assert.deepStrictEqual(quality.body.summary, { BLOCK: 1, WARN: 1, INFO: 0 });
    assert.strictEqual(quality.body.items.length, 2);
    assert.strictEqual(quality.body.items[0].source_file.includes('docs/'), true);

    const warnQuality = await request('/api/process-governance/quality?severity=WARN', {}, cookie);
    assert.strictEqual(warnQuality.res.status, 200);
    assert.strictEqual(warnQuality.body.items.length, 1);
    assert.strictEqual(warnQuality.body.items[0].severity, 'WARN');

    const deptQuality = await request('/api/process-governance/quality?dept=经营发展部', {}, cookie);
    assert.strictEqual(deptQuality.res.status, 200);
    assert.strictEqual(deptQuality.body.items.length, 1);
    assert.strictEqual(deptQuality.body.items[0].dept_name, '经营发展部');

    const cases = await request('/api/process-governance/quality-cases', {}, cookie);
    assert.strictEqual(cases.res.status, 200);
    assert.strictEqual(cases.body.summary.total, 2);
    assert.deepStrictEqual(cases.body.summary.bySeverity, { BLOCK: 1, WARN: 1 });
    assert.strictEqual(cases.body.summary.byStatus.source_resolved, 1);
    assert.ok(cases.body.items.every(item => item.finding_key && item.latest_snapshot_id), 'cases should expose stable keys and latest snapshot');

    const openCases = await request('/api/process-governance/quality-cases?status=open', {}, cookie);
    assert.strictEqual(openCases.res.status, 200);
    assert.strictEqual(openCases.body.items.length, 1);
    assert.strictEqual(openCases.body.items[0].severity, 'WARN');

    const deptCases = await request('/api/process-governance/quality-cases?dept=经营发展部', {}, cookie);
    assert.strictEqual(deptCases.res.status, 200);
    assert.strictEqual(deptCases.body.items.length, 1);
    const warnCaseId = deptCases.body.items[0].id;

    const warnDetail = await request(`/api/process-governance/quality-cases/${warnCaseId}`, {}, cookie);
    assert.strictEqual(warnDetail.res.status, 200);
    assert.strictEqual(warnDetail.body.case.id, warnCaseId);
    assert.ok(Array.isArray(warnDetail.body.events) && warnDetail.body.events.length >= 1, 'case detail should include history events');

    const assign = await request(`/api/process-governance/quality-cases/${warnCaseId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ priority: 'high', due_date: '2026-06-15', note: '分派给数据质量闭环' })
    }, cookie);
    assert.strictEqual(assign.res.status, 200);
    assert.strictEqual(assign.body.case.status, 'assigned');
    assert.strictEqual(assign.body.case.priority, 'high');
    assert.strictEqual(assign.body.case.due_date, '2026-06-15');

    const status = await request(`/api/process-governance/quality-cases/${warnCaseId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status: 'rectifying', note: '已回源确认' })
    }, cookie);
    assert.strictEqual(status.res.status, 200);
    assert.strictEqual(status.body.case.status, 'rectifying');

    const comment = await request(`/api/process-governance/quality-cases/${warnCaseId}/comment`, {
      method: 'POST',
      body: JSON.stringify({ note: '需补充 A1 核验提醒' })
    }, cookie);
    assert.strictEqual(comment.res.status, 200);
    assert.ok(comment.body.events.some(event => event.event_type === 'commented'));

    const submit = await request(`/api/process-governance/quality-cases/${warnCaseId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: '已提交整改说明，等待重新导入验证' })
    }, cookie);
    assert.strictEqual(submit.res.status, 200);
    assert.strictEqual(submit.body.case.status, 'submitted');

    const sourceResolvedCase = cases.body.items.find(item => item.status === 'source_resolved');
    const normalLogin = await request('/api/org/login', {
      method: 'POST',
      body: JSON.stringify({ employee_no: 'USER001', password: 'user123' })
    });
    assert.strictEqual(normalLogin.res.status, 200);
    const normalCookie = normalLogin.res.headers.get('set-cookie').split(';')[0];
    const forbiddenClose = await request(`/api/process-governance/quality-cases/${sourceResolvedCase.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: '普通用户不能关闭' })
    }, normalCookie);
    assert.strictEqual(forbiddenClose.res.status, 403);

    const close = await request(`/api/process-governance/quality-cases/${sourceResolvedCase.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: '重新质检未再出现，确认关闭' })
    }, cookie);
    assert.strictEqual(close.res.status, 200);
    assert.strictEqual(close.body.case.status, 'closed');
    assert.strictEqual(close.body.case.closure_note, '重新质检未再出现，确认关闭');

    const reopen = await request(`/api/process-governance/quality-cases/${sourceResolvedCase.id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ note: '复核后需要继续跟踪' })
    }, cookie);
    assert.strictEqual(reopen.res.status, 200);
    assert.strictEqual(reopen.body.case.status, 'reopened');

    const workspace = await request('/api/process-governance/mapping-workspace', {}, cookie);
    assert.strictEqual(workspace.res.status, 200);
    assert.strictEqual(workspace.body.summary.total, 2);
    assert.strictEqual(workspace.body.summary.byType.l3, 1);
    assert.strictEqual(workspace.body.summary.byType.a1, 1);
    assert.ok(workspace.body.items.some(item => item.a1_code === 'JY-L3-01-A1-001'), 'workspace should expose imported A1 mapping records');

    const mappingTodos = await request('/api/process-governance/mapping-todos', {}, cookie);
    assert.strictEqual(mappingTodos.res.status, 200);
    assert.strictEqual(mappingTodos.body.summary.total, 2);
    assert.strictEqual(mappingTodos.body.summary.byType.verification, 1);
    assert.strictEqual(mappingTodos.body.summary.byType.cross_dept, 1);
    assert.ok(mappingTodos.body.items.every(item => item.todo_key && item.latest_snapshot_id), 'mapping todos should expose stable keys and latest snapshot');

    const crossDeptTodos = await request('/api/process-governance/mapping-todos?type=cross_dept', {}, cookie);
    assert.strictEqual(crossDeptTodos.res.status, 200);
    assert.strictEqual(crossDeptTodos.body.items.length, 1);
    assert.strictEqual(crossDeptTodos.body.items[0].target_dept_name, '工程技术部');
    const crossTodoId = crossDeptTodos.body.items[0].id;

    const mappingTodoDetail = await request(`/api/process-governance/mapping-todos/${crossTodoId}`, {}, cookie);
    assert.strictEqual(mappingTodoDetail.res.status, 200);
    assert.strictEqual(mappingTodoDetail.body.todo.id, crossTodoId);
    assert.ok(Array.isArray(mappingTodoDetail.body.events) && mappingTodoDetail.body.events.length >= 1, 'mapping todo detail should include events');

    const assignMappingTodo = await request(`/api/process-governance/mapping-todos/${crossTodoId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ priority: 'high', due_date: '2026-06-18', note: '分派跨部门确认' })
    }, cookie);
    assert.strictEqual(assignMappingTodo.res.status, 200);
    assert.strictEqual(assignMappingTodo.body.todo.status, 'assigned');
    assert.strictEqual(assignMappingTodo.body.todo.due_date, '2026-06-18');

    const submitMappingTodo = await request(`/api/process-governance/mapping-todos/${crossTodoId}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: '已提交跨部门确认说明' })
    }, cookie);
    assert.strictEqual(submitMappingTodo.res.status, 200);
    assert.strictEqual(submitMappingTodo.body.todo.status, 'submitted');

    const verificationTodo = mappingTodos.body.items.find(item => item.status === 'source_resolved');
    const forbiddenMappingClose = await request(`/api/process-governance/mapping-todos/${verificationTodo.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: '普通用户不能关闭映射待办' })
    }, normalCookie);
    assert.strictEqual(forbiddenMappingClose.res.status, 403);

    const closeMappingTodo = await request(`/api/process-governance/mapping-todos/${verificationTodo.id}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: '回源整改并重新导入后确认关闭' })
    }, cookie);
    assert.strictEqual(closeMappingTodo.res.status, 200);
    assert.strictEqual(closeMappingTodo.body.todo.status, 'closed');

    const reopenMappingTodo = await request(`/api/process-governance/mapping-todos/${verificationTodo.id}/reopen`, {
      method: 'POST',
      body: JSON.stringify({ note: '继续跟踪该映射提醒' })
    }, cookie);
    assert.strictEqual(reopenMappingTodo.res.status, 200);
    assert.strictEqual(reopenMappingTodo.body.todo.status, 'reopened');

    console.log('Process governance API test passed');
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
  process.exit(1);
});
