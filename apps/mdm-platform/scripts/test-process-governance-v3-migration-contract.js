const assert = require('node:assert/strict');
const {
  CURRENT_VERSION,
  contentHash,
  createEmptyProcessGovernanceDocument
} = require('../server/processGovernanceV2');
const {
  planStoredRows,
  applyProcessGovernanceV3
} = require('../server/processGovernanceV3Migration');

function previousV2Document() {
  const document = createEmptyProcessGovernanceDocument({
    process_name: '迁移测试流程',
    owning_department: '财务部'
  });
  document.schema_version = 'process-governance-v2';
  document.forms = [{
    form_ref: 'form_migration',
    behavior_ref: null,
    form_name: '历史纸质表单',
    form_no: null,
    areas: [{
      area_ref: 'area_main',
      area_type: '基本信息',
      area_title: '历史主表标题',
      items: [{
        item_ref: 'item_stable',
        item_name: '申请人',
        item_type: '人员',
        required: true,
        instructions: '填写申请人姓名'
      }]
    }]
  }];
  return document;
}

const source = previousV2Document();
const sourceBefore = JSON.stringify(source);
const plan = planStoredRows([{
  id: 1,
  schema_version: 'process-governance-v2',
  process_content_json: JSON.stringify(source),
  content_hash: 'old'
}], 'draft');
assert.equal(plan.manual.length, 0);
assert.equal(plan.changes.length, 1);
assert.equal(plan.changes[0].document.schema_version, CURRENT_VERSION);
assert.equal(plan.changes[0].document.forms[0].form_design_state, 'unspecified');
assert.equal(plan.changes[0].document.forms[0].areas[0].items[0].item_ref, 'item_stable');
assert.equal(JSON.stringify(source), sourceBefore, 'migration planning must not modify the source object');

const migrated = plan.changes[0].document;
const repeatPlan = planStoredRows([{
  id: 1,
  schema_version: CURRENT_VERSION,
  process_content_json: JSON.stringify(migrated),
  content_hash: contentHash(migrated)
}], 'draft');
assert.equal(repeatPlan.changes.length, 0, 'repeated migration must be idempotent');
assert.equal(repeatPlan.manual.length, 0);

const currentState = JSON.parse(JSON.stringify(migrated));
currentState.forms[0].form_design_state = 'current_state';
const currentPlan = planStoredRows([{
  id: 2,
  schema_version: CURRENT_VERSION,
  process_content_json: JSON.stringify(currentState),
  content_hash: contentHash(currentState)
}], 'version');
assert.equal(currentPlan.changes.length, 0, 'v3 form state must be preserved');

const invalidPlan = planStoredRows([{
  id: 3,
  schema_version: 'process-governance-v2',
  process_content_json: '{broken',
  content_hash: null
}], 'draft');
assert.equal(invalidPlan.changes.length, 0);
assert.equal(invalidPlan.manual.length, 1);

let rolledBack = false;
let committed = false;
const failingConnection = {
  async beginTransaction() {},
  async execute(sql) {
    if (/UPDATE process_design_drafts/.test(sql)) throw new Error('simulated write failure');
    return [[]];
  },
  async commit() { committed = true; },
  async rollback() { rolledBack = true; },
  release() {}
};
const failingPool = {
  async execute(sql) {
    if (/SELECT migration_key/.test(sql)) return [[]];
    if (/FROM process_design_drafts/.test(sql)) {
      return [[{
        id: 1,
        schema_version: 'process-governance-v2',
        process_content_json: JSON.stringify(source),
        content_hash: 'old'
      }]];
    }
    if (/FROM process_design_versions/.test(sql)) return [[]];
    return [[]];
  },
  async getConnection() { return failingConnection; }
};

assert.rejects(
  () => applyProcessGovernanceV3(failingPool, { batchKey: 'test-v3-failure' }),
  /simulated write failure/
).then(() => {
  assert.equal(rolledBack, true, 'failed migration must roll back the transaction');
  assert.equal(committed, false, 'failed migration must not commit');
  console.log('process-governance-v3 migration contract tests passed');
});
