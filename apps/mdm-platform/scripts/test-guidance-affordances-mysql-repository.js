const assert = require('assert');
const { makeGovernanceGuidanceMysqlRepository } = require('../server/governanceGuidanceMysqlRepository');

function makePool(status = 'pending_response') {
  return {
    async execute(sql) {
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('SELECT g.*, d.name AS related_department_name') &&
          normalized.includes('FROM process_governance_guidance g')) {
        return [[{
          guidance_id: 77,
          guidance_code: 'GUID-20260626-0001',
          related_entity_type: 'process_mapping_record',
          related_entity_id: 3001,
          related_department_id: 20,
          related_department_name: '工程技术部',
          created_by_person_id: 701,
          guidance_type: '指导',
          content: '请补充跨部门输入输出。',
          final_responsible_person_id: 501,
          final_responsible_person_name: '工程负责人',
          current_handler_person_id: 501,
          current_handler_person_name: '工程负责人',
          is_major: 1,
          visibility_scope: 'department',
          status,
          created_at: '2026-06-26 09:00:00',
          updated_at: '2026-06-26 09:00:00'
        }], undefined];
      }
      if (normalized.includes('FROM department_responsibility_delegations')) {
        return [[], undefined];
      }
      throw new Error(`Unhandled SQL: ${normalized}`);
    }
  };
}

(async () => {
  const pendingRepo = makeGovernanceGuidanceMysqlRepository(makePool('pending_response'));
  const pendingList = await pendingRepo.listGuidanceForPerson(
    501,
    new Set(['guidance:respond', 'guidance:final_confirm'])
  );
  const pendingActions = pendingList[0].guidanceActions;
  assert.strictEqual(pendingActions.canRespond, true, 'final responsible person can respond while pending');
  assert.strictEqual(pendingActions.canClarify, true, 'final responsible person can request clarification while pending');
  assert.strictEqual(pendingActions.canObject, true, 'final responsible person can object while pending');
  assert.strictEqual(pendingActions.canFinalConfirm, false, 'final confirm waits for pending_final_confirm');
  assert.strictEqual(pendingList[0].finalResponsiblePerson, '工程负责人');
  assert.strictEqual(pendingList[0].currentHandlerPerson, '工程负责人');

  const confirmRepo = makeGovernanceGuidanceMysqlRepository(makePool('pending_final_confirm'));
  const confirmList = await confirmRepo.listGuidanceForPerson(
    501,
    new Set(['guidance:respond', 'guidance:final_confirm'])
  );
  assert.strictEqual(confirmList[0].guidanceActions.canRespond, false);
  assert.strictEqual(confirmList[0].guidanceActions.canFinalConfirm, true);

  const objectedRepo = makeGovernanceGuidanceMysqlRepository(makePool('objected'));
  const objectedList = await objectedRepo.listGuidanceForPerson(
    501,
    new Set(['guidance:respond', 'guidance:final_confirm'])
  );
  assert.strictEqual(objectedList[0].guidanceActions.canRespond, true, 'objected guidance can be answered again');
  assert.strictEqual(objectedList[0].guidanceActions.canClarify, false, 'objected guidance should not open clarify again');
  assert.strictEqual(objectedList[0].guidanceActions.canObject, false, 'objected guidance should not open object again');

  const adminList = await confirmRepo.listGuidanceForPerson(
    999,
    new Set(['admin:access', 'process_governance:view_global'])
  );
  assert.strictEqual(adminList[0].guidanceActions.canRespond, false);
  assert.strictEqual(adminList[0].guidanceActions.canFinalConfirm, false);

  console.log('Guidance affordances MySQL repository test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
