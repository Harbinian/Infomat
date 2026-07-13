const assert = require('assert');
const path = require('path');
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
  db.prepare(`
    INSERT INTO process_source_files (
      snapshot_id, file_key, file_path, dept_name, asset_type, file_no, revision, process_status, process_reason
    ) VALUES (
      ?, 'pmo-stage-review-procedure',
      'docs/norms/项目管理部业务资料/项目阶段评审管理程序.docx',
      '项目管理部', '制度', 'GL-PMO-03', 'A', '纳入', '流程治理依据'
    )
  `).run(snapshotId);
  const record = db.prepare(`
    INSERT INTO process_mapping_records (
      mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, domain_name,
      l2_name, l3_name, a1_code, behavior, execution_role, output_target_dept,
      suggested_systems, verification_note, source_file, status
    ) VALUES (
      'issue-pool-record-001', 'a1', ?, ?, '项目管理部', '生产副总',
      '项目计划管理', '项目阶段划分与阶段评审', 'XM-L3-03-A01', '设置阶段评审计划',
      '项目负责人', NULL, '["OA"]', '责任人和完成标准需要确认',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系-测试缺失.md', 'active'
    )
  `).run(snapshotId, snapshotId);
  db.prepare(`
    INSERT INTO process_mapping_todos (
      todo_key, todo_type, mapping_record_id, first_snapshot_id, latest_snapshot_id, dept_name,
      target_dept_name, l3_name, a1_code, source_file, source_line, message, suggestion, status, priority
    ) VALUES (
      'issue-pool-todo-001', 'verification', ?, ?, ?, '项目管理部',
      NULL, '项目阶段划分与阶段评审', 'XM-L3-03-A01',
      'docs/norms/项目管理部部门-能力-流程-系统映射关系-测试缺失.md', 32,
      '阶段评审计划的责任人不够具体', '请确认执行岗位和完成标准', 'open', 'high'
    )
  `).run(record.lastInsertRowid, snapshotId, snapshotId);
  db.prepare(`
    INSERT INTO process_input_baseline_review_runs
      (run_id, review_run_path, issue_count, embedding_status, embedding_model)
    VALUES ('issue-pool-review-run', 'artifacts/process-input-baseline-review/issue-pool-review-run', 1, 'rules', '')
  `).run();
  db.prepare(`
    INSERT INTO process_input_baseline_review_items
      (run_id, stable_key, review_item_id, department, document_name, source_file, source_anchor,
       issue_type, content, mapping_location, suggested_action, definition_status, owner, display_order)
    VALUES (
      'issue-pool-review-run', 'issue-pool-review-item-001', 'IBR-001', '项目管理部',
      '项目主进度计划策划.docx',
      'docs/norms/项目管理部业务资料/14.1-生产计划管理/GLC140102-项目主进度计划策划/项目主进度计划策划.docx',
      'GLC140102 §6.5 P122',
      '角色待确认',
      '阶段评审计划的责任人不够具体',
      'XM-L3-03-A01 设置阶段评审计划',
      '请确认执行岗位和完成标准',
      '原文定义不足',
      '项目管理部',
      1
    )
  `).run();
  db.prepare(`
    INSERT INTO process_input_baseline_review_excerpts
      (run_id, stable_key, chunk_id, source_anchor, source_label, raw_text,
       evidence_status, verification_status, allowed_downstream_use, display_order)
    VALUES (
      'issue-pool-review-run', 'issue-pool-review-item-001', 'chunk-001',
      'GLC140102 §6.5 P122', '项目主进度计划策划.docx 第6.5条',
      '当项目主进度计划编制与调整依据发生变化时，应及时升版更新。',
      'reviewItem', 'unverified', 'review_only', 1
    )
  `).run();
}

function seedMappingSourceWithoutReviewItem() {
  const snapshot = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json, status, note)
    VALUES ('fixture/process-governance-risk.json', 'issue-pool-risk-test', '{}', 'active', 'issue pool risk test')
  `).run();
  const snapshotId = snapshot.lastInsertRowid;
  db.prepare(`
    INSERT INTO process_source_files (
      snapshot_id, file_key, file_path, dept_name, asset_type, file_no, revision, process_status, process_reason
    ) VALUES (
      ?, 'project-risk-procedure',
      'docs/norms/项目管理部业务资料/GLTX-XM-06-A项目风险管理程序.docx',
      '项目管理部', '制度', 'GLTX-XM-06', 'A', '纳入', '流程治理依据'
    )
  `).run(snapshotId);
  const mappingSource = path.resolve(__dirname, 'fixtures', 'project-risk-mapping-source.md');
  const records = [
    ['001', 'XM-L3-32-A01', '建立项目风险档案', '项目组', '原输出目标部门：后续项目（参考），未见受控传递证据，待补'],
    ['002', 'XM-L3-32-A02', '组织项目风险复盘总结', '项目相关人员', '请部门确认是否需要验收/完成标准']
  ];
  for (const [suffix, a1Code, behavior, role, message] of records) {
    const record = db.prepare(`
      INSERT INTO process_mapping_records (
        mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, domain_name,
        l2_name, l3_name, a1_code, behavior, execution_role, output_target_dept,
        suggested_systems, verification_note, source_file, status
      ) VALUES (
        ?, 'a1', ?, ?, '项目管理部', '生产副总',
        '风险记录与复盘', '风险档案建立、项目结束后复盘总结与流程优化', ?, ?,
        ?, NULL, '["OA"]', ?,
        ?, 'active'
      )
    `).run(`issue-pool-risk-record-${suffix}`, snapshotId, snapshotId, a1Code, behavior, role, message, mappingSource);
    db.prepare(`
      INSERT INTO process_mapping_todos (
        todo_key, todo_type, mapping_record_id, first_snapshot_id, latest_snapshot_id, dept_name,
        target_dept_name, l3_name, a1_code, source_file, source_line, message, suggestion, status, priority
      ) VALUES (
        ?, 'verification', ?, ?, ?, '项目管理部',
        NULL, '风险档案建立、项目结束后复盘总结与流程优化', ?,
        ?, NULL,
        ?, '回到制度或表单源文件查看来源位置', 'open', 'medium'
      )
    `).run(`issue-pool-risk-todo-${suffix}`, record.lastInsertRowid, snapshotId, snapshotId, a1Code, mappingSource, message);
  }
}

function seedToolingReceivableSourceWithFormPrefixCollision() {
  const snapshot = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, stats_json, status, note)
    VALUES ('fixture/process-governance-tooling-receivable.json', 'issue-pool-tooling-receivable-test', '{}', 'active', 'issue pool tooling receivable test')
  `).run();
  const snapshotId = snapshot.lastInsertRowid;
  const procedurePath = 'docs/norms/项目管理部业务资料/GLTX-XM-08-A沈阳、总部工装业务联合管理程序/GLTX-XM-08-A沈阳、总部工装业务联合管理程序2.28/GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx';
  const formPath = 'docs/norms/项目管理部业务资料/GLTX-XM-08-A沈阳、总部工装业务联合管理程序/GLTX-XM-08-A沈阳、总部工装业务联合管理程序2.28/GLTX-XM-08-A-01《工装技术条件评审表》.xlsx';
  db.prepare(`
    INSERT INTO process_source_files (
      snapshot_id, file_key, file_path, dept_name, asset_type, file_no, revision, process_status, process_reason
    ) VALUES
      (?, 'tooling-receivable-procedure', ?, '项目管理部', '制度', 'GLTX-XM-08-A', 'A', '纳入', '流程治理依据'),
      (?, 'tooling-technical-review-form', ?, '项目管理部', '表单', 'GLTX-XM-08-A-01', 'A', '纳入', '规定表格')
  `).run(snapshotId, procedurePath, snapshotId, formPath);
  const mappingSource = path.resolve(__dirname, 'fixtures', 'project-tooling-receivable-mapping-source.md');
  const record = db.prepare(`
    INSERT INTO process_mapping_records (
      mapping_key, record_type, first_snapshot_id, latest_snapshot_id, dept_name, domain_name,
      l2_name, l3_name, a1_code, behavior, execution_role, output_target_dept,
      suggested_systems, verification_note, source_file, status
    ) VALUES (
      'issue-pool-tooling-receivable-record', 'a1', ?, ?, '项目管理部', '生产副总',
      '工装挂账回款管理', '验收移交后专票提交、ERP 挂账手续办理、回款进度跟踪',
      'XM-L3-37-A02', '办理 ERP 挂账及跟踪回款',
      '经营发展部', '财务部', '["ERP"]',
      '输出给哪个部门：财务部，没有看到制度或表单里写清交接依据，需要补清',
      ?, 'active'
    )
  `).run(snapshotId, snapshotId, mappingSource);
  db.prepare(`
    INSERT INTO process_mapping_todos (
      todo_key, todo_type, mapping_record_id, first_snapshot_id, latest_snapshot_id, dept_name,
      target_dept_name, l3_name, a1_code, source_file, source_line, message, suggestion, status, priority
    ) VALUES (
      'issue-pool-tooling-receivable-todo', 'verification', ?, ?, ?, '项目管理部',
      '财务部', '验收移交后专票提交、ERP 挂账手续办理、回款进度跟踪',
      'XM-L3-37-A02', ?, NULL,
      '输出给哪个部门：财务部，没有看到制度或表单里写清交接依据，需要补清',
      '请部门确认是否需要验收/完成标准', 'open', 'high'
    )
  `).run(record.lastInsertRowid, snapshotId, snapshotId, mappingSource);
  db.prepare(`
    INSERT INTO process_input_baseline_review_runs
      (run_id, review_run_path, issue_count, embedding_status, embedding_model)
    VALUES ('issue-pool-tooling-review-run', 'artifacts/process-input-baseline-review/issue-pool-tooling-review-run', 1, 'rules', '')
  `).run();
  db.prepare(`
    INSERT INTO process_input_baseline_review_items
      (run_id, stable_key, review_item_id, department, document_name, source_file, source_anchor,
       issue_type, content, mapping_location, suggested_action, definition_status, owner, display_order)
    VALUES (
      'issue-pool-tooling-review-run', 'issue-pool-tooling-review-item', 'IBR-XM-08-A02', '项目管理部',
      'GLTX-XM-08-A-01《工装技术条件评审表》.xlsx',
      ?,
      'GLTX-XM-08-A §5.9.1',
      '受控传递待确认',
      '输出给哪个部门：财务部，没有看到制度或表单里写清交接依据，需要补清',
      'XM-L3-37-A02 办理 ERP 挂账及跟踪回款',
      '请部门确认是否需要验收/完成标准',
      '原文定义不足',
      '项目管理部',
      1
    )
  `).run(formPath);
  db.prepare(`
    INSERT INTO process_input_baseline_review_excerpts
      (run_id, stable_key, chunk_id, source_anchor, source_label, raw_text,
       evidence_status, verification_status, allowed_downstream_use, display_order)
    VALUES (
      'issue-pool-tooling-review-run', 'issue-pool-tooling-review-item', 'chunk-tooling-001',
      'GLTX-XM-08-A §5.9.1', 'GLTX-XM-08-A-01《工装技术条件评审表》.xlsx 第5.9.1条',
      '对接民机科创部相关人员，根据预算情况办理ERP收货及挂账手续，跟踪回款进度。',
      'reviewItem', 'unverified', 'review_only', 1
    )
  `).run();
}

async function main() {
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_issue_batches'), 'MySQL schema should include issue batches');
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_issue_points'), 'MySQL schema should include issue points');
  assert.ok(mdmMysqlSchemaSql().includes('process_governance_term_tasks'), 'MySQL schema should include terminology tasks');

  const repo = makeSqliteProcessGovernanceIssuePoolRepository(db);
  await repo.initSchema();
  seedMappingSource();

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
  assert.ok(!detail.issue.where_text.includes('.md'), 'issue card should not expose intermediate markdown source files');
  assert.ok(detail.issue.where_text.includes('业务流程：项目阶段划分与阶段评审'), 'issue card should show the business process in source location text');
  assert.ok(detail.issue.where_text.includes('业务行为：XM-L3-03-A01 设置阶段评审计划'), 'issue card should show the business behavior in source location text');
  assert.ok(detail.issue.where_text.includes('源文件编号：GLC140102'), 'issue card should derive source document number from input baseline evidence');
  assert.ok(detail.issue.where_text.includes('制度或表单名称：项目主进度计划策划.docx'), 'issue card should show the input baseline source document name');
  assert.ok(detail.issue.where_text.includes('大概位置：第6.5条'), 'issue card should prefer the original source anchor when it is available');
  assert.ok(!detail.issue.where_text.includes('流程治理输入基线第32段附近'), 'issue card should not fall back to the input baseline position when an original source anchor exists');
  assert.ok(!detail.issue.where_text.includes('第32行'), 'issue card should not show line numbers for Word/source documents');
  assert.ok(!detail.issue.where_text.includes('大概位置：尚未'), 'issue card should not put missing-conversion wording in the approximate location field');
  assert.ok(!detail.issue.where_text.includes('尚未从制度或表单源文件转换出具体段落或页码'), 'issue card should avoid the old missing-conversion wording');
  assert.ok(!detail.issue.where_text.includes('残留问题'), 'issue card should not flag a residual source-location gap when the original source anchor exists');
  assert.ok(!detail.issue.where_text.includes('待补'), 'source location text should not use vague pending wording');
  assert.ok(!detail.issue.where_text.includes('相关原文段落'), 'issue card should not pretend a missing anchor is an approximate source location');
  assert.ok(detail.points[0].evidence.raw_text.includes('当项目主进度计划编制与调整依据发生变化时'), 'issue card should include the original source excerpt');
  assert.strictEqual(detail.points[0].evidence.can_confirm, true, 'issue card should allow confirmation only when original source excerpt exists');
  const documentStructure = detail.points[0].evidence.document_structure || {};
  assert.strictEqual(documentStructure.structured_object_type, 'A1 业务行为', 'issue point should name the document-structure object for business review');
  assert.strictEqual(documentStructure.structured_object_key, 'XM-L3-03-A01', 'issue point should carry the A1 object key');
  assert.strictEqual(documentStructure.target_block, 'a1_catalog', 'owner role issues should map to the A1 structure block');
  assert.strictEqual(documentStructure.target_field, 'role', 'owner role issues should ask about the A1 role field');
  assert.strictEqual(documentStructure.current_value, '项目负责人', 'issue point should show the current structured-field value');
  assert.ok(documentStructure.question_for_user.includes('执行角色'), 'issue point should ask a business-readable structured-field question');
  assert.deepStrictEqual(documentStructure.allowed_actions, ['修改制度或表单源文件后重新导入', '说明这条核验项不是问题'], 'issue point should expose only controlled business actions');

  db.prepare("DELETE FROM process_input_baseline_review_excerpts WHERE run_id='issue-pool-review-run'").run();
  db.prepare("UPDATE process_input_baseline_review_items SET source_anchor='' WHERE run_id='issue-pool-review-run'").run();
  db.prepare("UPDATE process_mapping_todos SET source_line=NULL WHERE todo_key='issue-pool-todo-001'").run();
  await repo.generateIssuePool({ generatedBy: 1, departmentName: '项目管理部', batchKey: 'issue-pool-without-anchor' });
  const noAnchorDetail = await repo.getIssueDetail(detail.issue.issue_id);
  assert.ok(noAnchorDetail.issue.where_text.includes('大概位置：来源依据不足：未标注可核对段落号'), 'issue card should mark missing source anchors as insufficient evidence');
  assert.ok(noAnchorDetail.issue.where_text.includes('源文件编号：GLC140102'), 'issue card without anchor should still derive source document number from input baseline evidence');
  assert.ok(noAnchorDetail.issue.where_text.includes('制度或表单名称：项目主进度计划策划.docx'), 'issue card without anchor should still show the input baseline source document name');
  assert.ok(!noAnchorDetail.issue.where_text.includes('相关原文段落'), 'issue card should not use vague related-paragraph wording when the anchor is missing');
  assert.strictEqual(noAnchorDetail.points[0].evidence.can_confirm, false, 'issue card should block confirmation when original source excerpt is missing');
  assert.ok(noAnchorDetail.points[0].evidence.missing_reason.includes('缺少制度或表单原文摘录'), 'issue card should explain that confirmation is blocked by missing original text');

  const blockedAction = await repo.applyPointAction(noAnchorDetail.points[0].point_id, {
    action: 'confirm',
    selectedOption: '已有具体岗位',
    handlingMethod: 'source_revision',
    actorUserId: 1,
    actorDeptName: '项目管理部',
    actorRoleCode: 'business_contact'
  });
  assert.strictEqual(blockedAction.blocked, true, 'point action should refuse confirmation without original source text');

  db.prepare("UPDATE process_mapping_todos SET source_line=32 WHERE todo_key='issue-pool-todo-001'").run();
  db.prepare("UPDATE process_input_baseline_review_items SET source_anchor='GLC140102 §6.5 P122' WHERE run_id='issue-pool-review-run'").run();
  db.prepare(`
    INSERT OR REPLACE INTO process_input_baseline_review_excerpts
      (run_id, stable_key, chunk_id, source_anchor, source_label, raw_text,
       evidence_status, verification_status, allowed_downstream_use, display_order)
    VALUES (
      'issue-pool-review-run', 'issue-pool-review-item-001', 'chunk-001',
      'GLC140102 §6.5 P122', '项目主进度计划策划.docx 第6.5条',
      '当项目主进度计划编制与调整依据发生变化时，应及时升版更新。',
      'reviewItem', 'unverified', 'review_only', 1
    )
  `).run();
  await repo.generateIssuePool({ generatedBy: 1, departmentName: '项目管理部', batchKey: 'issue-pool-restored-anchor' });
  const restoredDetail = await repo.getIssueDetail(detail.issue.issue_id);

  assert.ok(!restoredDetail.issue.what_text.includes('原输出目标部门'), 'issue card should not expose technical field names');
  assert.ok(restoredDetail.issue.who_text.includes('\n'), 'responsibility facts should be split into readable lines');
  assert.ok(restoredDetail.issue.how_text.includes('回到制度或表单源文件查看'), 'handling guide should use business language for source review');
  assert.ok(restoredDetail.issue.how_text.includes('确认业务行为'), 'handling guide should say business behavior instead of A1 confirmation');
  assert.ok(restoredDetail.issue.how_text.includes('尚未建立“确认业务行为”的标准流程'), 'handling guide should surface the missing standard process');
  assert.ok(!restoredDetail.issue.how_text.includes('回源'), 'handling guide should not use shorthand jargon');
  assert.ok(restoredDetail.issue.how_much_text.includes('暂未识别涉及对象'), 'impact text should use readable empty-state wording');
  assert.ok(restoredDetail.points.length >= 1);
  assert.ok(restoredDetail.events.length >= 1);
  const firstEventCount = restoredDetail.events.length;

  const action = await repo.applyPointAction(restoredDetail.points[0].point_id, {
    action: 'confirm',
    selectedOption: '已有具体岗位',
    handlingMethod: 'source_revision',
    handlingReason: '',
    actorUserId: 1,
    actorDeptName: '项目管理部',
    actorRoleCode: 'business_contact'
  });
  assert.strictEqual(action.point.selected_option, '已有具体岗位');
  assert.ok(action.events.length > firstEventCount, 'point action should append event history');
  const latestEvent = action.events[action.events.length - 1];
  assert.strictEqual(latestEvent.actor_user_name, '系统管理员');
  assert.ok(latestEvent.created_at, 'event history should include a timestamp');
  assert.ok(latestEvent.note.includes('修改制度或表单源文件后重新导入'), 'event history should record the controlled handling method');
  assert.strictEqual(latestEvent.payload.handling_method, 'source_revision');

  const notIssueAction = await repo.applyPointAction(restoredDetail.points[0].point_id, {
    action: 'confirm',
    selectedOption: '不适用',
    handlingMethod: 'not_issue',
    handlingReason: 'source_already_clear',
    actorUserId: 1,
    actorDeptName: '项目管理部',
    actorRoleCode: 'business_contact'
  });
  const notIssueEvent = notIssueAction.events[notIssueAction.events.length - 1];
  assert.ok(notIssueEvent.note.includes('问题原因：制度或表单原文已经写清楚'), 'event history should label the reason as problem reason');
  assert.ok(!notIssueEvent.note.includes('固定原因'), 'event history should not use fixed reason wording');
  assert.strictEqual(notIssueEvent.payload.handling_reason, 'source_already_clear');

  seedMappingSourceWithoutReviewItem();
  const riskBatch = await repo.generateIssuePool({ generatedBy: 1, departmentName: '项目管理部', batchKey: 'issue-pool-risk-source-evidence' });
  assert.ok(riskBatch.summary.issue_count >= 2, 'risk source batch should generate issue cards');
  const riskList = await repo.listIssues({ departmentName: '项目管理部', queue: 'waiting_my_action', limit: 20, offset: 0 });
  const riskIssueA01 = riskList.items.find(item => item.a1_code === 'XM-L3-32-A01');
  const riskIssueA02 = riskList.items.find(item => item.a1_code === 'XM-L3-32-A02');
  assert.ok(riskIssueA01, 'risk archive issue should be listed');
  assert.ok(riskIssueA02, 'risk review issue should be listed');
  const riskDetail = await repo.getIssueDetail(riskIssueA01.issue_id);
  assert.ok(riskDetail.issue.where_text.includes('业务流程：风险档案建立、项目结束后复盘总结与流程优化'), 'risk issue should show business process');
  assert.ok(riskDetail.issue.where_text.includes('业务行为：XM-L3-32-A01 建立项目风险档案'), 'risk issue should show business behavior');
  assert.ok(riskDetail.issue.where_text.includes('源文件编号：GLTX-XM-06-A'), 'risk issue should derive source file number from mapping evidence');
  assert.ok(riskDetail.issue.where_text.includes('制度或表单名称：GLTX-XM-06-A项目风险管理程序.docx'), 'risk issue should resolve source document name from source file manifest');
  assert.ok(riskDetail.issue.where_text.includes('大概位置：（5）风险记录与复盘'), 'risk issue should use the source-verified original paragraph position');
  assert.ok(riskDetail.issue.where_text.includes('未在制度或表单源文件中核到对应条款'), 'risk issue should explain the mapping anchor mismatch');
  assert.ok(!riskDetail.issue.where_text.includes('大概位置：第5.5条'), 'risk issue should not show an unverified 5.5 clause from mapping evidence');
  assert.ok(!riskDetail.issue.where_text.includes('源文件编号未随输入基线入库'), 'risk issue should not show missing source file number fallback');
  assert.ok(!riskDetail.issue.where_text.includes('制度或表单源文件未识别'), 'risk issue should not show missing document fallback');
  assert.ok(!riskDetail.issue.where_text.includes('来源依据不足：未标注可核对段落号'), 'risk issue should not show missing source anchor fallback');
  assert.ok(riskDetail.points[0].evidence.raw_text.includes('项目组全程记录风险识别、评估、应对过程'), 'risk issue should carry source-verified original text');
  assert.strictEqual(riskDetail.points[0].evidence.can_confirm, true, 'risk issue should be confirmable only after the mapping excerpt is found in the source document');
  assert.strictEqual(riskDetail.points[0].evidence.verification_status, 'source_verified_anchor_mismatch', 'risk issue evidence should record the wrong mapping anchor');

  const riskReviewDetail = await repo.getIssueDetail(riskIssueA02.issue_id);
  assert.ok(riskReviewDetail.issue.where_text.includes('业务行为：XM-L3-32-A02 组织项目风险复盘总结'), 'risk review issue should show business behavior');
  assert.ok(riskReviewDetail.issue.where_text.includes('大概位置：（5）风险记录与复盘'), 'risk review issue should also use the verified source paragraph position');
  assert.ok(!riskReviewDetail.issue.where_text.includes('大概位置：第5.5条'), 'risk review issue should not show the unverified 5.5 clause');
  assert.ok(riskReviewDetail.points[0].evidence.raw_text.includes('复盘总结：项目结束后，组织相关人员复盘风险管理工作'), 'risk review issue should carry source-verified original text');

  seedToolingReceivableSourceWithFormPrefixCollision();
  const toolingBatch = await repo.generateIssuePool({ generatedBy: 1, departmentName: '项目管理部', batchKey: 'issue-pool-tooling-receivable-source-evidence' });
  assert.ok(toolingBatch.summary.issue_count >= 1, 'tooling receivable source batch should generate issue cards');
  const toolingList = await repo.listIssues({ departmentName: '项目管理部', queue: 'waiting_my_action', limit: 50, offset: 0 });
  const toolingIssue = toolingList.items.find(item => item.a1_code === 'XM-L3-37-A02');
  assert.ok(toolingIssue, 'tooling receivable issue should be listed');
  const toolingDetail = await repo.getIssueDetail(toolingIssue.issue_id);
  assert.ok(toolingDetail.issue.where_text.includes('业务流程：验收移交后专票提交、ERP 挂账手续办理、回款进度跟踪'), 'tooling issue should show business process');
  assert.ok(toolingDetail.issue.where_text.includes('业务行为：XM-L3-37-A02 办理 ERP 挂账及跟踪回款'), 'tooling issue should show business behavior');
  assert.ok(toolingDetail.issue.where_text.includes('源文件编号：GLTX-XM-08-A'), 'tooling issue should show procedure source file number');
  assert.ok(toolingDetail.issue.where_text.includes('制度或表单名称：GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx'), 'tooling issue should resolve the procedure document name, not the prefixed form');
  assert.ok(toolingDetail.issue.where_text.includes('大概位置：第5.9.1条'), 'tooling issue should keep the clause position on the procedure body');
  assert.ok(!toolingDetail.issue.where_text.includes('GLTX-XM-08-A-01《工装技术条件评审表》.xlsx'), 'tooling issue should not attach procedure clause 5.9.1 to the prefixed form');
  assert.strictEqual(toolingDetail.points[0].point_type, 'controlled_transfer', 'output-target issues should be treated as controlled transfer review');
  assert.strictEqual(toolingDetail.points[0].evidence.document_structure.issue_type, '跨部门承接待确认');
  assert.strictEqual(toolingDetail.points[0].evidence.source_document_name.includes('GLTX-XM-08-A-01'), false, 'original evidence metadata should not show the prefixed form as the source document');
  assert.ok(toolingDetail.points[0].evidence.source_document_name.includes('GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx'), 'original evidence metadata should show the procedure body document');

  const task = await repo.createTermTask({
    issueId: restoredDetail.issue.issue_id,
    pointId: restoredDetail.points[0].point_id,
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
