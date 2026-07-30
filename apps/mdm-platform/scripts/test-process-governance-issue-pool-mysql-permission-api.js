const assert = require('assert');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousProcessReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processGovernanceRouter = require('../server/routes/processGovernance');

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

function sessionForUser(userKey) {
  const sessions = {
    dept: { personId: 10, userId: 10, userName: '项目管理部主对接人', departmentId: 1 },
    other: { personId: 20, userId: 20, userName: '财务部主对接人', departmentId: 2 },
    reviewer: { personId: 30, userId: 30, userName: '项目管理部MDM审核员', departmentId: 1 },
    global: { personId: 99, userId: 99, userName: '项目决策组成员', departmentId: 3 }
  };
  return sessions[userKey] || sessions.dept;
}

async function request(baseUrl, userKey, routePath, options = {}) {
  const headers = {
    'X-Test-User': userKey,
    ...(options.body ? { 'Content-Type': 'application/json' } : {})
  };
  const res = await fetch(`${baseUrl}${routePath}`, { ...options, headers });
  const body = await res.json();
  return { res, body };
}

async function main() {
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/processGovernance.js'), 'utf8');
  assert.ok(
    !routeSource.includes('makeSqliteProcessGovernanceIssuePoolRepository'),
    '统一问题池路由不得回落 SQLite repository'
  );
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
  assert.ok(
    !packageJson.scripts['test:process-governance-issue-pool'].includes('test-process-governance-issue-pool-api.js') &&
      !packageJson.scripts['test:process-governance-issue-pool'].includes('test-process-governance-issue-pool-repository.js') &&
      !packageJson.scripts['test:process-governance-issue-pool'].includes('test-process-governance-issue-pool-batch.js'),
    '当前问题池回归不得纳入遗留 SQLite 服务器/仓储测试'
  );

  const identityCalls = { permissions: 0, roles: 0, departments: 0 };
  const permissionsByUser = new Map([
    [10, ['governance:read-department', 'governance:draft-department', 'governance:submit-department']],
    [20, ['governance:read-department', 'governance:draft-department', 'governance:submit-department']],
    [30, ['governance:read-department', 'governance:review-department', 'governance:record-department-decision']],
    [99, ['governance:read-escalated-context', 'governance:decide-escalation']]
  ]);
  const rolesByUser = new Map([
    [10, [{ code: 'department_contact', name: '部门主对接人' }]],
    [20, [{ code: 'department_contact', name: '部门主对接人' }]],
    [30, [{ code: 'department_mdm_reviewer', name: '部门MDM审核员' }]],
    [99, [{ code: 'decision_group', name: '项目决策组' }]]
  ]);
  const departments = new Map([
    [1, { id: 1, name: '项目管理部' }],
    [2, { id: 2, name: '财务部' }],
    [3, { id: 3, name: '公司领导' }]
  ]);

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      identityCalls.permissions += 1;
      return { permSet: new Set(permissionsByUser.get(userId) || []), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      identityCalls.roles += 1;
      return rolesByUser.get(userId) || [{ code: legacyRole, name: legacyRole }];
    },
    async getDepartmentById(departmentId) {
      identityCalls.departments += 1;
      return departments.get(departmentId) || null;
    },
    async getUserById() {
      return null;
    }
  }));

  const issueDetail = {
    issue: {
      issue_id: 101,
      issue_key: 'issue:mysql-permission',
      title: '阶段评审计划责任人待确认',
      primary_dept_name: '项目管理部',
      owner_dept_name: '工程技术部',
      display_status: 'waiting_my_action'
    },
    points: [{ point_id: 1001, issue_id: 101, point_type: 'responsibility' }],
    participants: [
      { issue_id: 101, dept_name: '项目管理部', role_code: 'department_contact' },
      { issue_id: 101, dept_name: '工程技术部', role_code: 'department_mdm_reviewer' }
    ],
    events: [],
    termTasks: [{
      term_task_id: 501,
      issue_id: 101,
      point_id: 1001,
      selected_departments: ['项目管理部', '工程技术部'],
      status: 'pending_departments'
    }]
  };
  const repoCalls = {
    detail: 0,
    apply: 0,
    close: 0,
    answer: 0,
    decide: 0
  };

  processGovernanceRouter.setIssuePoolRepositoryFactory(() => ({
    async getIssueDetail(issueId) {
      repoCalls.detail += 1;
      assert.strictEqual(issueId, 101);
      return issueDetail;
    },
    async getIssueDetailByPoint(pointId) {
      assert.strictEqual(pointId, 1001);
      return issueDetail;
    },
    async applyPointAction(pointId, payload) {
      repoCalls.apply += 1;
      assert.strictEqual(pointId, 1001);
      return { point: { point_id: pointId, selected_option: payload.selectedOption }, events: [], issue: issueDetail.issue };
    },
    async closeIssue(issueId) {
      repoCalls.close += 1;
      assert.strictEqual(issueId, 101);
      return issueDetail;
    },
    async getTermTask(termTaskId) {
      assert.strictEqual(termTaskId, 501);
      return issueDetail.termTasks[0];
    },
    async answerTermTask(termTaskId) {
      repoCalls.answer += 1;
      assert.strictEqual(termTaskId, 501);
      return { success: true, task: issueDetail.termTasks[0] };
    },
    async decideTermTask(termTaskId) {
      repoCalls.decide += 1;
      assert.strictEqual(termTaskId, 501);
      return { success: true, decision: { standard_term: '项目负责人' }, task: issueDetail.termTasks[0] };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessionForUser(req.get('X-Test-User'));
    next();
  });
  app.use('/api/process-governance', processGovernanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const otherDetail = await request(baseUrl, 'other', '/api/process-governance/issue-pool/issues/101');
    assert.strictEqual(otherDetail.res.status, 403, JSON.stringify(otherDetail.body));

    const deptDetail = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/issues/101');
    assert.strictEqual(deptDetail.res.status, 200, JSON.stringify(deptDetail.body));

    const otherConfirm = await request(baseUrl, 'other', '/api/process-governance/issue-pool/points/1001/confirm', {
      method: 'POST',
      body: JSON.stringify({ selected_option: '已有具体岗位', handling_method: 'source_revision' })
    });
    assert.strictEqual(otherConfirm.res.status, 403, JSON.stringify(otherConfirm.body));
    assert.strictEqual(repoCalls.apply, 0, '越权确认不应进入仓储写入');

    const deptConfirm = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/points/1001/confirm', {
      method: 'POST',
      body: JSON.stringify({ selected_option: '已有具体岗位', handling_method: 'source_revision' })
    });
    assert.strictEqual(deptConfirm.res.status, 200, JSON.stringify(deptConfirm.body));
    assert.strictEqual(repoCalls.apply, 1, '本部门确认应进入仓储写入');

    const deptDecision = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/points/1001/mdm-decision', {
      method: 'POST',
      body: JSON.stringify({ selected_option: '提交 MDM 裁决', handling_method: 'source_revision' })
    });
    assert.strictEqual(deptDecision.res.status, 403, JSON.stringify(deptDecision.body));
    assert.strictEqual(repoCalls.apply, 1, '普通部门用户不能执行 MDM 裁决写入');

    const globalDecision = await request(baseUrl, 'global', '/api/process-governance/issue-pool/points/1001/mdm-decision', {
      method: 'POST',
      body: JSON.stringify({ selected_option: '裁决为项目负责人', handling_method: 'source_revision' })
    });
    assert.strictEqual(globalDecision.res.status, 200, JSON.stringify(globalDecision.body));
    assert.strictEqual(repoCalls.apply, 2, '决策组可执行 MDM 裁决');

    const deptClose = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/issues/101/close', {
      method: 'POST',
      body: JSON.stringify({ note: '确认关闭' })
    });
    assert.strictEqual(deptClose.res.status, 403, JSON.stringify(deptClose.body));
    assert.strictEqual(repoCalls.close, 0, '普通部门用户不能关闭问题卡');

    const reviewerClose = await request(baseUrl, 'reviewer', '/api/process-governance/issue-pool/issues/101/close', {
      method: 'POST',
      body: JSON.stringify({ note: '复核关闭' })
    });
    assert.strictEqual(reviewerClose.res.status, 200, JSON.stringify(reviewerClose.body));
    assert.strictEqual(repoCalls.close, 1, '本部门复核人可关闭问题卡');

    const otherAnswer = await request(baseUrl, 'other', '/api/process-governance/issue-pool/term-tasks/501/answer', {
      method: 'POST',
      body: JSON.stringify({ department_name: '财务部', answer: '本部门无意见' })
    });
    assert.strictEqual(otherAnswer.res.status, 403, JSON.stringify(otherAnswer.body));
    assert.strictEqual(repoCalls.answer, 0, '未被选择的部门不能回复术语待办');

    const deptAnswer = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/term-tasks/501/answer', {
      method: 'POST',
      body: JSON.stringify({ department_name: '项目管理部', answer: '建议使用项目负责人' })
    });
    assert.strictEqual(deptAnswer.res.status, 200, JSON.stringify(deptAnswer.body));
    assert.strictEqual(repoCalls.answer, 1, '被选择部门可以回复术语待办');

    const deptTermDecision = await request(baseUrl, 'dept', '/api/process-governance/issue-pool/term-tasks/501/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: { standard_term: '项目负责人' } })
    });
    assert.strictEqual(deptTermDecision.res.status, 403, JSON.stringify(deptTermDecision.body));
    assert.strictEqual(repoCalls.decide, 0, '普通部门用户不能裁决术语');

    const globalTermDecision = await request(baseUrl, 'global', '/api/process-governance/issue-pool/term-tasks/501/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: { standard_term: '项目负责人' } })
    });
    assert.strictEqual(globalTermDecision.res.status, 200, JSON.stringify(globalTermDecision.body));
    assert.strictEqual(repoCalls.decide, 1, '决策组可以裁决术语');

    assert.ok(identityCalls.permissions > 0, '问题池权限判断应读取 MySQL 权限');
    assert.ok(identityCalls.roles > 0, '问题池权限判断应读取 MySQL 角色');
    assert.ok(identityCalls.departments > 0, '问题池权限判断应读取 MySQL 部门');

    console.log('Process governance issue pool MySQL permission API test passed');
  } finally {
    await closeServer(server);
    processGovernanceRouter.resetIssuePoolRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousProcessReadModel === undefined) {
    delete process.env.PROCESS_GOVERNANCE_READ_MODEL;
  } else {
    process.env.PROCESS_GOVERNANCE_READ_MODEL = previousProcessReadModel;
  }
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
