import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertSafeSnapshot,
  generateProcessPackage,
  selectWorkflow
} from './run-database-to-process-json.mjs';

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'database-to-process-json-'));

function testSnapshot() {
  return {
    schema_version: 'database-process-evidence-v1',
    database: 'CXSYSYS',
    schema: 'dbo',
    captured_at: '2026-08-24T00:00:00+08:00',
    snapshot_digest: 'test-snapshot',
    source_summary: '脱敏结构测试快照',
    forms: [{
      form_ref: 'form_test',
      form_template: '测试业务表单',
      root_table: '测试业务_主表',
      business_name: '测试业务表单',
      business_content: {
        purpose: '',
        scope: '适用于测试业务记录的编制、判断和批准。'
      },
      anonymous_processing: false,
      tables: [{
        physical_name: '测试业务_主表',
        data_ref: 'data_main',
        business_name: '测试业务首页记录',
        form_ref: 'form_test',
        form_name: '测试业务首页',
        table_kind: 'main',
        area_type: '基本信息',
        fields: [{ physical_name: '业务编号', business_name: '业务编号', field_type: '文本', required: true },
          { physical_name: '是否复核', business_name: '是否复核', field_type: '枚举', required: true },
          { physical_name: '批准', business_name: '批准', field_type: '文本', required: false },
          { physical_name: '批准日期', business_name: '批准日期', field_type: '日期', required: false },
          { physical_name: 'Operator', business_name: '', field_type: '文本', required: false, classification: 'technical' }]
      }, {
        physical_name: '测试业务_明细',
        data_ref: 'data_detail',
        business_name: '测试业务明细记录',
        form_ref: 'form_test',
        form_name: '测试业务首页',
        table_kind: 'detail',
        area_type: '明细清单',
        fields: [{ physical_name: '明细序号', business_name: '明细序号', field_type: '数字', required: true },
          { physical_name: '明细内容', business_name: '明细内容', field_type: '文本', required: true }]
      }],
      formula_mappings: [{
        target_form_ref: 'form_test',
        target_data_ref: 'data_detail',
        target_field_name: '明细内容',
        source_data_ref: 'data_main',
        source_field_name: '业务编号',
        source_business_name: '测试业务首页记录中的业务编号'
      }],
      term_candidates: [{ term_name: '业务编号', definition: '', source_object: '测试业务_主表', source_field: '业务编号' }],
      verification_targets: [{ table: '测试业务_主表', columns: ['是否复核', '批准', '批准日期'], max_rows: 20 }],
      pending_issues: ['请确认测试业务记录的权威来源。']
    }],
    workflows: [{
      workflow_id: 'workflow_test',
      workflow_name: '测试业务审批',
      root_table: '测试业务_主表',
      process_name: '测试业务编制与审批',
      nodes: [{ behavior_ref: 'b_compile', node_key: 'compile', node_type: 'action', business_name: '编制人员编制测试业务记录', business_description: '编制人员填写首页和明细。', completion_standard: '首页和明细已填写，能够提交判断。' },
        { behavior_ref: 'b_decide', node_key: 'decide', node_type: 'decision', business_name: '测试业务记录是否需要复核', business_description: '根据“是否复核”选择后续路线。', completion_standard: '已选择需要复核或不需要复核。' },
        { behavior_ref: 'b_review', node_key: 'review', node_type: 'action', business_name: '复核人员复核测试业务记录', business_description: '复核人员核对业务内容。', completion_standard: '已给出复核结论。' },
        { behavior_ref: 'b_approve', node_key: 'approve', node_type: 'action', business_name: '批准人员批准测试业务记录', business_description: '批准人员给出批准结论。', completion_standard: '已记录批准结论。' }],
      edges: [{ relation_ref: 'r1', edge_key: 'r1', relation_type: 'sequence', from_behavior_ref: 'b_compile', to_behavior_ref: 'b_decide', condition: '' },
        { relation_ref: 'r2', edge_key: 'r2', relation_type: 'condition', from_behavior_ref: 'b_decide', to_behavior_ref: 'b_review', condition: '需要复核' },
        { relation_ref: 'r3', edge_key: 'r3', relation_type: 'condition', from_behavior_ref: 'b_decide', to_behavior_ref: 'b_approve', condition: '不需要复核' },
        { relation_ref: 'r4', edge_key: 'r4', relation_type: 'sequence', from_behavior_ref: 'b_review', to_behavior_ref: 'b_approve', condition: '' }],
      data_operations: [{ behavior_ref: 'b_compile', operation: 'create', data_refs: ['*'] },
        { behavior_ref: 'b_decide', operation: 'use', data_refs: ['data_main'] },
        { behavior_ref: 'b_review', operation: 'use', data_refs: ['data_main', 'data_detail'] },
        { behavior_ref: 'b_approve', operation: 'update', data_refs: ['data_main'], updated_fields: ['批准', '批准日期'] },
        { behavior_ref: 'b_approve', operation: 'use', data_refs: ['data_detail'] }],
      role_candidates: [{ behavior_ref: 'b_approve', business_node_name: '批准测试业务记录', role_name: '配置中的批准角色' }],
      pending_issues: ['请确认“不需要复核”分支的业务条件。']
    }],
    pending_issues: []
  };
}

const snapshot = testSnapshot();
assert.equal(assertSafeSnapshot(snapshot), snapshot);
assert.equal(selectWorkflow(snapshot, '测试业务_主表').workflow.workflow_id, 'workflow_test');

const snapshotPath = path.join(tempRoot, 'snapshot.json');
fs.writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2), 'utf8');
const outputDir = path.join(tempRoot, 'output');
const result = generateProcessPackage({
  snapshotPath,
  rootTable: '测试业务_主表',
  outputDir
});

assert.equal(result.document.schema_version, 'process-governance-v7');
assert.equal(result.document.data_objects.length, 2, 'main and detail tables must become separate data objects');
assert.equal(result.document.forms[0].areas.length, 2, 'main and detail tables must become separate form areas');
assert.equal(result.document.data_objects[0].fields.some(field => field.field_name === 'Operator'), false, 'technical fields must be excluded');
assert.equal(result.document.behaviors.every(behavior => behavior.current_actor_role === ''), true, 'role configuration is not a formal actor');
assert.ok(result.pendingIssues.some(item => item.includes('配置中的批准角色')));

const approveLink = result.document.data_objects[0].behavior_links.find(link => link.behavior_ref === 'b_approve');
assert.equal(approveLink.operation, 'update');
assert.deepEqual(
  approveLink.updated_field_refs.map(ref => result.document.data_objects[0].fields.find(field => field.field_ref === ref).field_name),
  ['批准', '批准日期']
);
const noReviewBranch = result.document.flow_relations.find(relation => relation.condition === '不需要复核');
assert.equal(noReviewBranch.to_behavior_ref, 'b_approve');
const detailFormulaItem = result.document.forms[0].areas.flatMap(area => area.items).find(item => item.item_name === '明细内容');
assert.equal(detailFormulaItem.source_links[0].source_type, 'process_data');
assert.equal(detailFormulaItem.source_links[0].source_data_ref, 'data_main');
assert.equal(result.document.data_objects[0].lifecycle.entry_state.identifiability_applicability, 'not_applicable');
assert.equal(result.summary.read_only_verification, 'not_provided', 'unavailable database connection stays an explicit pending boundary');
assert.ok(result.pendingIssues.some(item => item.includes('本轮未连接实时数据库')));
assert.equal(fs.existsSync(path.join(outputDir, 'read-only-verification.json')), false);

for (const fileName of [
  'process-governance-v7.json', 'source-manifest.json', 'schema-snapshot.json', 'evidence-map.jsonl',
  'pending-issues.md', 'generation-summary.json'
]) {
  assert.equal(fs.existsSync(path.join(outputDir, fileName)), true, `${fileName} must be generated`);
}

assert.throws(() => generateProcessPackage({ snapshotPath, rootTable: '测试业务_主表', outputDir }), /拒绝覆盖/);

const ambiguous = testSnapshot();
ambiguous.workflows.push({ ...ambiguous.workflows[0], workflow_id: 'workflow_other', workflow_name: '另一个工作流' });
assert.throws(() => selectWorkflow(ambiguous, '测试业务_主表'), /匹配到2个工作流.*workflow_test.*workflow_other/);
assert.equal(selectWorkflow(ambiguous, '测试业务_主表', 'workflow_other').workflow.workflow_id, 'workflow_other');

const unsafe = testSnapshot();
unsafe.connection_string = 'must never be accepted';
assert.throws(() => assertSafeSnapshot(unsafe), /禁止字段/);

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const powerShellSource = fs.readFileSync(path.join(scriptDir, 'export-cxsysys-readonly-snapshot.ps1'), 'utf8');
assert.equal(/SELECT\s+\*/i.test(powerShellSource), false, 'read-only verifier must never use SELECT *');
assert.equal(/ExecuteNonQuery/i.test(powerShellSource), false, 'read-only verifier must not expose a database write path');
assert.match(powerShellSource, /ApplicationIntent.*ReadOnly/);
assert.match(powerShellSource, /database_write_operations = 0/);

console.log('database-to-process-json skill tests passed');
