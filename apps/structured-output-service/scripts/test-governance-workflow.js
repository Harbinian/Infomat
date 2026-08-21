const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Workflow = require('../public/governance-workflow.js');

async function main() {
  assert.deepEqual(
    Workflow.STEPS.map(step => step.label),
    ['JSON基本信息', '流程边界', '流程骨架', '动作与异常', '数据与表单', '跨部门核对', '评审与交接']
  );
  assert.deepEqual(
    Workflow.ROLE_SEQUENCE.map(item => `${item.order}.${item.role}`),
    ['1.编制人', '2.业务核对人', '3.编制人', '4.MDM工作组']
  );
  assert.equal(Workflow.ROLE_SEQUENCE[0].handoff, '阶段草稿');
  assert.match(Workflow.ROLE_SEQUENCE[3].handoff, /暂不导入3000/);
  assert.equal(
    Workflow.primaryActionForStep('start', { hasDocument: false }),
    '新建流程或继续已有流程'
  );
  assert.equal(
    Workflow.primaryActionForStep('start', { hasDocument: true }),
    '新建流程或继续已有流程'
  );
  assert.equal(Workflow.stageForStep('boundary').label, '第1轮-流程骨架');
  assert.equal(Workflow.stageForStep('action').label, '第2轮-动作与异常');
  assert.equal(Workflow.stageForStep('data').label, '第3轮-数据与表单');
  assert.equal(Workflow.stageForStep('cross-department').label, '第4轮-跨部门核对');
  assert.equal(Workflow.stageForStep('handoff').label, '最终待核对');
  assert.equal(Workflow.stepForTarget({ editorSection: 'basic' }), 'boundary');
  assert.equal(Workflow.stepForTarget({ focusKind: 'behavior', focusPath: 'behaviors.0.behavior_description' }), 'action');
  assert.equal(Workflow.stepForTarget({ focusKind: 'relation', focusPath: 'flow_relations.0.relation_type' }), 'skeleton');
  assert.equal(Workflow.stepForTarget({ focusKind: 'relation', focusPath: 'flow_relations.0.condition' }), 'action');
  assert.equal(Workflow.stepForTarget({ focusKind: 'area' }), 'data');

  assert.deepEqual(
    Workflow.statusForStep('handoff', { hasDocument: true, technicalCount: 2, issueCounts: {} }),
    { key: 'error', label: '结构错误2项' }
  );
  assert.equal(
    Workflow.statusForStep('action', { hasDocument: true, issueCounts: { action: 3 } }).label,
    '待补充3项'
  );
  assert.deepEqual(
    Workflow.statusForStep('data', { hasDocument: true, issueCounts: {}, startedSteps: [] }),
    { key: 'not-started', label: '未开始' }
  );
  assert.deepEqual(
    Workflow.statusForStep('data', { hasDocument: true, activeStep: 'data', issueCounts: {}, startedSteps: [] }),
    { key: 'in-progress', label: '编制中' }
  );

  const vectors = ['', 'abc', '3001流程治理'];
  for (const value of vectors) {
    const expected = crypto.createHash('sha256').update(value, 'utf8').digest('hex');
    assert.equal(Workflow.sha256Fallback(value), expected);
    assert.equal(await Workflow.sha256Hex(value, { subtle: null }), expected);
  }
  console.log('structured-output-service governance workflow tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
