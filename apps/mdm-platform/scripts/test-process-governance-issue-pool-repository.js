const assert = require('assert');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';

const db = require('../server/db');
const { hashPassword } = require('../server/auth');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const {
  makeProcessGovernanceIssuePoolRepository,
  makeSqliteProcessGovernanceIssuePoolRepository
} = require('../server/processGovernanceIssuePoolRepository');

function seedMappingSource() {
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('项目管理部', 'PMO')").run();
  db.prepare("INSERT OR IGNORE INTO departments (name, code) VALUES ('工程技术部', 'ENG')").run();
  const dept = db.prepare("SELECT id FROM departments WHERE name='项目管理部'").get();
  db.prepare(`
    INSERT INTO users (id, name, employee_no, department_id, post, role, password_hash)
    VALUES (1, '系统管理员', 'ADMIN001', ?, '系统管理员', 'admin', ?)
  `).run(dept.id, hashPassword('admin123'));
  const snapshot = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json, status, note)
    VALUES ('fixture/process-governance.json', 'issue-pool-test', '{}', 'active', 'issue pool test')
  `).run();
  const snapshotId = snapshot.lastInsertRowid;
  const record = db.prepare(`
    INSERT INTO process_mapping_records (
      mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, domain_name,
      l2_name, l3_name, a1_code, behavior, execution_role, output_target_dept,
      suggested_systems, verification_note, source_file, status
    ) VALUES (
      'issue-pool-record-001', 'a1', ?, ?, '项目管理部', '生产副总',
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
      'issue-pool-todo-001', 'verification', ?, ?, ?, '项目管理部',
      '工程技术部', '项目阶段划分与阶段评审', 'XM-L3-03-A01',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系.md',
      '阶段评审计划的责任人不够具体', '请确认执行岗位和完成标准', 'open', 'high'
    )
  `).run(record.lastInsertRowid, snapshotId, snapshotId);
}

async function main() {
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_issue_batches'), 'MySQL schema should include issue batches');
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_issue_points'), 'MySQL schema should include issue points');
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_term_tasks'), 'MySQL schema should include terminology tasks');

  seedMappingSource();
  const repo = makeSqliteProcessGovernanceIssuePoolRepository(db);
  await repo.initSchema();

  const batch = await repo.generateIssuePool({ generatedBy: 1, departmentName: '项目管理部' });
  assert.strictEqual(batch.batch.status, 'ready');
  assert.strictEqual(batch.summary.issue_count, 1);
  assert.strictEqual(batch.summary.point_count, 1);

  const queues = await repo.listQueues({ departmentName: '项目管理部' });
  assert.ok(queues.items.some(item => item.display_status === 'waiting_my_action' && Number(item.count) === 1), 'queue summary should count actionable issues');
  assert.ok(queues.items[0].preview.length <= 5, 'queue preview should stay small');

  const globalQueues = await repo.listQueues();
  assert.ok(globalQueues.items.some(item => item.display_status === 'waiting_my_action' && Number(item.count) === 1), 'global queue summary should not require a department filter');

  const list = await repo.listIssues({ departmentName: '项目管理部', queue: 'waiting_my_action', limit: 20, offset: 0 });
  assert.strictEqual(list.pagination.limit, 20);
  assert.strictEqual(list.items.length, 1);
  assert.strictEqual(list.items[0].a1_name, '设置阶段评审计划');
  assert.strictEqual(list.items[0].a1_code, 'XM-L3-03-A01');

  const detail = await repo.getIssueDetail(list.items[0].issue_id);
  assert.strictEqual(detail.issue.a1_name, '设置阶段评审计划');
  assert.ok(detail.issue.what_text);
  assert.ok(detail.issue.why_text);
  assert.ok(detail.points.length >= 1);
  assert.ok(detail.events.length >= 1);
  const firstEventCount = detail.events.length;

  const action = await repo.applyPointAction(detail.points[0].point_id, {
    action: 'confirm',
    selectedOption: '已有具体岗位',
    note: '项目负责人负责设置阶段评审计划。',
    actorUserId: 1,
    actorDeptName: '项目管理部',
    actorRoleCode: 'business_contact'
  });
  assert.strictEqual(action.point.selected_option, '已有具体岗位');
  assert.ok(action.events.length > firstEventCount, 'point action should append event history');

  const task = await repo.createTermTask({
    issueId: detail.issue.issue_id,
    pointId: detail.points[0].point_id,
    termText: '项目主管领导',
    contextText: '阶段评审计划确认意见',
    selectedDepartments: ['项目管理部', '工程技术部'],
    createdBy: 1
  });
  assert.strictEqual(task.task.term_text, '项目主管领导');
  assert.deepStrictEqual(task.task.selected_departments, ['项目管理部', '工程技术部']);

  const answer = await repo.answerTermTask(task.task.term_task_id, {
    departmentName: '项目管理部',
    answer: '保留原表达，并说明原因',
    note: '本部门制度当前这样表述。',
    actorUserId: 1
  });
  assert.strictEqual(answer.success, true);

  const decision = await repo.decideTermTask(task.task.term_task_id, {
    decision: {
      standard_term: '项目负责人',
      allowed_aliases: ['项目主管领导', '项目经理'],
      discouraged_terms: ['项目老大'],
      business_scope: '项目阶段评审',
      departments: ['项目管理部', '工程技术部']
    },
    decidedBy: 1
  });
  assert.strictEqual(decision.decision.standard_term, '项目负责人');

  const mysqlCalls = [];
  const fakeMysqlPool = {
    async execute(sql, params = []) {
      mysqlCalls.push({ sql, params });
      if (sql.includes('COUNT(DISTINCT i.issue_id)')) return [[{ count: 1 }], []];
      if (sql.includes('SELECT DISTINCT i.*')) return [[{
        issue_id: 1,
        issue_key: 'todo:mysql-limit-test',
        primary_dept_name: '项目管理部',
        display_status: 'waiting_my_action',
        a1_name: '设置阶段评审计划'
      }], []];
      return [[], []];
    }
  };
  const mysqlRepo = makeProcessGovernanceIssuePoolRepository(fakeMysqlPool);
  const mysqlList = await mysqlRepo.listIssues({ queue: 'waiting_my_action', limit: 3, offset: 0 });
  assert.strictEqual(mysqlList.pagination.total, 1);
  const mysqlListCall = mysqlCalls.find(call => call.sql.includes('LIMIT ? OFFSET ?'));
  assert.deepStrictEqual(mysqlListCall.params.slice(-2), ['3', '0'], 'MySQL LIMIT/OFFSET params should be strings for prepared execution');

  console.log('Process governance issue pool repository test passed');
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    db.close();
    cleanupDb();
  });
