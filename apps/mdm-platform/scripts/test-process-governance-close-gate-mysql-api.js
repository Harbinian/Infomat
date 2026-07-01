const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousProcessReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

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

function jsonPost(body) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

async function main() {
  const auth = require('../server/auth');
  const processGovernanceRouter = require('../server/routes/processGovernance');
  const qualityFingerprint = 'quality-fingerprint-001';
  const mappingFingerprint = 'mapping-fingerprint-001';
  const state = {
    latest: {
      quality: null,
      mapping: null
    },
    existing: {
      quality: new Set(),
      mapping: new Set()
    },
    cases: new Map([
      [11, { id: 11, status: 'open', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }],
      [12, { id: 12, status: 'source_resolved', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }],
      [13, { id: 13, status: 'source_resolved', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }],
      [14, { id: 14, status: 'source_resolved', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }],
      [15, { id: 15, status: 'source_resolved', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }],
      [16, { id: 16, status: 'closed', fingerprint: qualityFingerprint, dept_name: '经营发展部', finding_key: 'quality-source-001', area: 'source' }]
    ]),
    todos: new Map([
      [21, { id: 21, status: 'source_resolved', fingerprint: mappingFingerprint, todo_type: 'verification', dept_name: '经营发展部', l3_name: '销售订单评审和执行管理', a1_code: 'JY-L3-01-A1-001' }],
      [22, { id: 22, status: 'source_resolved', fingerprint: mappingFingerprint, todo_type: 'verification', dept_name: '经营发展部', l3_name: '销售订单评审和执行管理', a1_code: 'JY-L3-01-A1-001' }]
    ]),
    caseEvents: [],
    todoEvents: []
  };

  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions() {
      return {
        permSet: new Set(['admin:access', 'process_quality:close', 'process_mapping:close']),
        fieldConstraints: {}
      };
    },
    async getUserRoleCodes() {
      return [{ code: 'admin', name: '管理员' }];
    },
    async getDepartmentById(id) {
      return { id, name: '经营发展部' };
    },
    async getUserById(id) {
      return { id, name: '系统管理员', department_id: 8 };
    }
  }));

  processGovernanceRouter.setProcessGovernanceRepositoryFactory(() => ({
    async getQualityCase(caseId) {
      return state.cases.get(caseId) || null;
    },
    async getMappingTodo(todoId) {
      return state.todos.get(todoId) || null;
    },
    async closeQualityCase(caseId, payload = {}) {
      const item = state.cases.get(caseId);
      item.status = 'closed';
      item.closure_note = payload.note;
      state.caseEvents.push({
        case_id: caseId,
        event_type: 'closed',
        payload: payload.close_gate || null
      });
      return { case: item, events: state.caseEvents.filter(event => event.case_id === caseId) };
    },
    async closeMappingTodo(todoId, payload = {}) {
      const item = state.todos.get(todoId);
      item.status = 'closed';
      item.closure_note = payload.note;
      state.todoEvents.push({
        todo_id: todoId,
        event_type: 'closed',
        payload: payload.close_gate || null
      });
      return { todo: item, events: state.todoEvents.filter(event => event.todo_id === todoId) };
    },
    async assertLatestImportResolved(scope, item, payload = {}) {
      if (payload.resolution === 'not_an_issue') {
        return { action: 'close', from_state: payload.from_status, to_state: 'closed', resolution: 'not_an_issue', reason: payload.reason };
      }
      const latestBatchId = state.latest[scope];
      if (!latestBatchId) {
        const error = new Error('尚无重新导入记录，无法关闭');
        error.statusCode = 409;
        throw error;
      }
      if (state.existing[scope].has(item.fingerprint)) {
        const error = new Error('该问题在最新快照中仍然存在，请回源修改源文件后重新导入');
        error.statusCode = 409;
        throw error;
      }
      return { action: 'close', from_state: payload.from_status, to_state: 'closed', import_batch_id: latestBatchId, fingerprint: item.fingerprint };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: 1, userName: '系统管理员', userRole: 'admin', departmentId: 8 };
    next();
  });
  app.use('/api/process-governance', processGovernanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const wrongState = await fetch(`${baseUrl}/api/process-governance/quality-cases/11/close`, jsonPost({ note: '状态未完成' }));
    assert.strictEqual(wrongState.status, 409);

    const noImport = await fetch(`${baseUrl}/api/process-governance/quality-cases/12/close`, jsonPost({ note: '没有重新导入' }));
    assert.strictEqual(noImport.status, 409);
    assert.ok((await noImport.json()).error.includes('尚无重新导入记录'));

    state.latest.quality = 'batch-001';
    state.existing.quality.add(qualityFingerprint);
    const stillExists = await fetch(`${baseUrl}/api/process-governance/quality-cases/13/close`, jsonPost({ note: '最新批次仍存在' }));
    assert.strictEqual(stillExists.status, 409);
    assert.ok((await stillExists.json()).error.includes('仍然存在'));

    state.latest.quality = 'batch-002';
    state.existing.quality.clear();
    const closed = await fetch(`${baseUrl}/api/process-governance/quality-cases/14/close`, jsonPost({ note: '最新批次已消失' }));
    const closedBody = await closed.json();
    assert.strictEqual(closed.status, 200, JSON.stringify(closedBody));
    assert.strictEqual(closedBody.case.status, 'closed');
    assert.strictEqual(closedBody.events[0].event_type, 'closed');
    assert.strictEqual(closedBody.events[0].payload.action, 'close');
    assert.strictEqual(closedBody.events[0].payload.import_batch_id, 'batch-002');
    assert.strictEqual(closedBody.events[0].payload.fingerprint, qualityFingerprint);

    const emptyReason = await fetch(`${baseUrl}/api/process-governance/quality-cases/15/close`, jsonPost({ note: '非问题关闭', resolution: 'not_an_issue' }));
    assert.strictEqual(emptyReason.status, 400);

    const notIssue = await fetch(`${baseUrl}/api/process-governance/quality-cases/15/close`, jsonPost({ resolution: 'not_an_issue', reason: '核验项不适用于该来源' }));
    const notIssueBody = await notIssue.json();
    assert.strictEqual(notIssue.status, 200, JSON.stringify(notIssueBody));
    assert.strictEqual(notIssueBody.events[0].payload.resolution, 'not_an_issue');
    assert.strictEqual(notIssueBody.events[0].payload.reason, '核验项不适用于该来源');

    const closedAgain = await fetch(`${baseUrl}/api/process-governance/quality-cases/16/close`, jsonPost({ note: '重复关闭' }));
    assert.strictEqual(closedAgain.status, 409);
    assert.strictEqual(state.caseEvents.filter(event => event.case_id === 16).length, 0);

    state.latest.mapping = 'batch-003';
    state.existing.mapping.add(mappingFingerprint);
    const mappingStillExists = await fetch(`${baseUrl}/api/process-governance/mapping-todos/21/close`, jsonPost({ note: '映射仍存在' }));
    assert.strictEqual(mappingStillExists.status, 409);
    assert.ok((await mappingStillExists.json()).error.includes('仍然存在'));

    state.latest.mapping = 'batch-004';
    state.existing.mapping.clear();
    const mappingClosed = await fetch(`${baseUrl}/api/process-governance/mapping-todos/22/close`, jsonPost({ note: '映射已消失' }));
    const mappingClosedBody = await mappingClosed.json();
    assert.strictEqual(mappingClosed.status, 200, JSON.stringify(mappingClosedBody));
    assert.strictEqual(mappingClosedBody.todo.status, 'closed');
    assert.strictEqual(mappingClosedBody.events[0].payload.action, 'close');
    assert.strictEqual(mappingClosedBody.events[0].payload.import_batch_id, 'batch-004');
    assert.strictEqual(mappingClosedBody.events[0].payload.fingerprint, mappingFingerprint);

    console.log('Process governance MySQL close gate API test passed');
  } finally {
    await closeServer(server);
    processGovernanceRouter.resetProcessGovernanceRepositoryFactory();
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
