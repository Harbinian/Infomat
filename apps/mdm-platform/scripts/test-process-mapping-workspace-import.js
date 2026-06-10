const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const db = require('../server/db');
const { importProcessGovernanceSnapshot } = require('./lib/processGovernanceImport');

const fixtureDir = path.join(__dirname, 'fixtures');
const sourceJsonPath = path.join(fixtureDir, 'process-governance-snapshot.json');
const a1MarkdownPath = path.join(fixtureDir, 'process-governance-a1.md');
const noVerifyA1Path = path.join(fixtureDir, 'process-governance-a1-no-verify.tmp.md');

try {
  const firstSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    note: 'mapping workspace first import'
  });

  const records = db.prepare(`
    SELECT record_type, dept_name, l2_name, l3_name, a1_code, behavior, status, latest_snapshot_id
    FROM process_mapping_records
    ORDER BY record_type, id
  `).all();
  assert.strictEqual(records.length, 2, 'workspace should persist one L3 record and one A1 record');
  assert.strictEqual(records.find(row => row.record_type === 'l3').l3_name, '销售订单评审和执行管理');
  assert.strictEqual(records.find(row => row.record_type === 'l3').l2_name, '合同管理');
  assert.strictEqual(records.find(row => row.record_type === 'a1').a1_code, 'JY-L3-01-A1-001');
  assert.ok(records.every(row => row.status === 'active'));
  assert.ok(records.every(row => row.latest_snapshot_id === firstSnapshotId));

  const todos = db.prepare(`
    SELECT todo_type, status, priority, dept_name, target_dept_name, a1_code, message, latest_snapshot_id
    FROM process_mapping_todos
    ORDER BY todo_type
  `).all();
  assert.strictEqual(todos.length, 2, 'verification note and cross-dept risk should create mapping todos');
  const verificationTodo = todos.find(row => row.todo_type === 'verification');
  const crossDeptTodo = todos.find(row => row.todo_type === 'cross_dept');
  assert.ok(verificationTodo.message.includes('核对技术条款输入'));
  assert.strictEqual(verificationTodo.dept_name, '经营发展部');
  assert.strictEqual(crossDeptTodo.target_dept_name, '工程技术部');
  assert.strictEqual(crossDeptTodo.priority, 'high');

  const verificationId = db.prepare("SELECT id FROM process_mapping_todos WHERE todo_type='verification'").get().id;
  db.prepare(`
    UPDATE process_mapping_todos
    SET status='rectifying', due_date='2026-06-20'
    WHERE id=?
  `).run(verificationId);

  const secondSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    note: 'mapping workspace second import'
  });
  const persistedTodo = db.prepare(`
    SELECT status, due_date, latest_snapshot_id
    FROM process_mapping_todos
    WHERE id=?
  `).get(verificationId);
  assert.strictEqual(persistedTodo.status, 'rectifying', 'manual todo status should survive re-import');
  assert.strictEqual(persistedTodo.due_date, '2026-06-20', 'manual due date should survive re-import');
  assert.strictEqual(persistedTodo.latest_snapshot_id, secondSnapshotId, 'latest snapshot should update on re-import');

  fs.writeFileSync(noVerifyA1Path, `# 经营发展部部门-能力-流程-系统映射关系

## 业务行为（A1）映射

##### 业务流程（L3）-001 销售订单评审和执行管理

| A1编号 | 业务行为 | 执行角色 | 审批类型 | 输入来源部门 | 输出目标部门 | 应用系统 | 核验提醒 |
|---|---|---|---|---|---|---|---|
| JY-L3-01-A1-001 | 接收订单并组织评审 | 合同管理员 | 审批 | 项目管理部 | 工程技术部 | OA / ERP |  |
`);
  const thirdSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [noVerifyA1Path],
    note: 'mapping workspace source resolved import'
  });
  const resolvedTodo = db.prepare(`
    SELECT status, latest_snapshot_id
    FROM process_mapping_todos
    WHERE id=?
  `).get(verificationId);
  assert.strictEqual(resolvedTodo.status, 'source_resolved', 'missing source todo should become source_resolved instead of being deleted');
  assert.strictEqual(resolvedTodo.latest_snapshot_id, thirdSnapshotId);

  db.prepare(`
    UPDATE process_mapping_todos
    SET status='closed', closed_at=CURRENT_TIMESTAMP, closure_note='测试关闭'
    WHERE id=?
  `).run(verificationId);
  const fourthSnapshotId = importProcessGovernanceSnapshot({
    db,
    sourceJsonPath,
    a1MarkdownPaths: [a1MarkdownPath],
    note: 'mapping workspace reappeared import'
  });
  const reopenedTodo = db.prepare(`
    SELECT status, reopened_count, latest_snapshot_id, closed_at, closure_note
    FROM process_mapping_todos
    WHERE id=?
  `).get(verificationId);
  assert.strictEqual(reopenedTodo.status, 'reopened', 'closed mapping todo should reopen if the source reminder reappears');
  assert.strictEqual(reopenedTodo.reopened_count, 1);
  assert.strictEqual(reopenedTodo.latest_snapshot_id, fourthSnapshotId);
  assert.strictEqual(reopenedTodo.closed_at, null);
  assert.strictEqual(reopenedTodo.closure_note, null);

  const events = db.prepare(`
    SELECT event_type
    FROM process_mapping_todo_events
    WHERE todo_id=?
    ORDER BY id
  `).all(verificationId).map(row => row.event_type);
  assert.ok(events.includes('import_created'), 'history should include import-created event');
  assert.ok(events.includes('source_resolved'), 'history should include source-resolved event');
  assert.ok(events.includes('reopened'), 'history should include reopen event');

  console.log('Process mapping workspace import test passed');
} finally {
  db.close();
  if (fs.existsSync(noVerifyA1Path)) fs.unlinkSync(noVerifyA1Path);
  cleanupDb();
}
