const assert = require('assert');
const { makeProcessGovernanceIssuePoolRepository } = require('../server/processGovernanceIssuePoolRepository');

const procedurePath = 'docs/norms/项目管理部业务资料/GLTX-XM-08-A沈阳、总部工装业务联合管理程序/GLTX-XM-08-A沈阳、总部工装业务联合管理程序2.28/GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx';
const formPath = 'docs/norms/项目管理部业务资料/GLTX-XM-08-A沈阳、总部工装业务联合管理程序/GLTX-XM-08-A沈阳、总部工装业务联合管理程序2.28/GLTX-XM-08-A-01《工装技术条件评审表》.xlsx';

function normalized(sql) {
  return String(sql || '').replace(/\s+/g, ' ').trim();
}

function sourceRow() {
  return {
    record_id: 308,
    mapping_key: 'mysql-source-resolution-record',
    dept_name: '项目管理部',
    domain_name: '生产副总',
    l2_name: '工装挂账回款管理',
    l3_name: '验收移交后专票提交、ERP 挂账手续办理、回款进度跟踪',
    a1_code: 'XM-L3-37-A02',
    behavior: '办理 ERP 挂账及跟踪回款',
    execution_role: '经营发展部',
    approval_type: '',
    output_target_dept: '财务部',
    suggested_systems: '["ERP"]',
    verification_note: '输出给哪个部门：财务部，没有看到制度或表单里写清交接依据，需要补清',
    record_source_file: 'docs/norms/项目管理部部门-能力-流程-系统映射关系.md',
    todo_id: 308,
    todo_key: 'mysql-source-resolution-todo',
    todo_type: 'verification',
    target_dept_name: '财务部',
    source_file: 'docs/norms/项目管理部部门-能力-流程-系统映射关系.md',
    source_line: null,
    message: '输出给哪个部门：财务部，没有看到制度或表单里写清交接依据，需要补清',
    suggestion: '请部门确认是否需要验收/完成标准',
    todo_status: 'open',
    priority: 'high',
    due_date: null,
    source_snapshot_id: 77,
    evidence_required: 1,
    evidence_raw_text: '',
    evidence_source_label: 'GLTX-XM-08-A-01《工装技术条件评审表》.xlsx 第5.9.1条',
    evidence_source_anchor: 'GLTX-XM-08-A §5.9.1',
    evidence_source_file: formPath,
    evidence_document_name: 'GLTX-XM-08-A-01《工装技术条件评审表》.xlsx',
    source_documents: `GLTX-XM-08||${formPath}`
  };
}

async function main() {
  const captured = { exactLookupCount: 0, issue: null, point: null };
  const fakePool = {
    async execute(sql, params = []) {
      const text = normalized(sql);
      if (text.startsWith('SELECT id FROM process_governance_snapshots')) {
        return [[{ id: 77 }], []];
      }
      if (text.startsWith('INSERT INTO process_governance_issue_batches')) {
        return [{ insertId: 501 }, []];
      }
      if (text.includes('FROM process_mapping_records r')) {
        return [[sourceRow()], []];
      }
      if (text.includes('FROM process_source_files') && text.includes('LIMIT 20')) {
        captured.exactLookupCount += 1;
        assert.deepStrictEqual(params, [77, 'GLTX-XM-08-A', 'GLTX-XM-08-A']);
        return [[
          { file_no: 'GLTX-XM-08', file_path: formPath },
          { file_no: 'GLTX-XM-08', file_path: procedurePath }
        ], []];
      }
      if (text.startsWith('INSERT INTO process_governance_issues')) {
        captured.issue = {
          issue_id: 101,
          issue_key: params[0],
          where_text: params[16],
          a1_code: params[11],
          a1_name: params[12]
        };
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('SELECT * FROM process_governance_issues WHERE issue_key=')) {
        return [[captured.issue], []];
      }
      if (text.includes("event_type='created'")) {
        return [[{ count: 1 }], []];
      }
      if (text.startsWith('INSERT INTO process_governance_issue_points')) {
        captured.point = {
          point_id: 1001,
          issue_id: params[0],
          point_key: params[1],
          evidence_json: params[6]
        };
        return [{ affectedRows: 1 }, []];
      }
      if (text.startsWith('SELECT * FROM process_governance_issue_points WHERE point_key=')) {
        return [[captured.point], []];
      }
      if (
        text.startsWith('DELETE FROM process_governance_issue_participants')
        || text.startsWith('INSERT INTO process_governance_issue_participants')
        || text.startsWith('UPDATE process_governance_issue_batches')
      ) {
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected SQL in fake MySQL source resolution test: ${text}`);
    }
  };

  const repo = makeProcessGovernanceIssuePoolRepository(fakePool);
  const result = await repo.generateIssuePool({ batchKey: 'mysql-source-resolution-test', sourceType: 'process_mapping_source_recheck' });
  assert.strictEqual(result.summary.issue_count, 1);
  assert.strictEqual(captured.exactLookupCount, 1, 'MySQL issue pool generation should perform exact source lookup from evidence anchor');
  assert.ok(captured.issue.where_text.includes('源文件编号：GLTX-XM-08-A'));
  assert.ok(captured.issue.where_text.includes('制度或表单名称：GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx'));
  assert.ok(captured.issue.where_text.includes('大概位置：第5.9.1条'));
  assert.ok(!captured.issue.where_text.includes('GLTX-XM-08-A-01《工装技术条件评审表》.xlsx'));
  const evidence = JSON.parse(captured.point.evidence_json);
  assert.strictEqual(evidence.source_file_no, 'GLTX-XM-08-A');
  assert.ok(evidence.source_document_name.includes('GLTX-XM-08-A沈阳、总部工装业务联合管理程序3.9.docx'));
  assert.ok(!evidence.source_document_name.includes('GLTX-XM-08-A-01'));
  console.log('Process governance issue pool MySQL source resolution test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
