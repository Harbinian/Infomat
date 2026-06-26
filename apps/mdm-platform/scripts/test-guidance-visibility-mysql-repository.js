const assert = require('assert');
const { makeGovernanceGuidanceMysqlRepository } = require('../server/governanceGuidanceMysqlRepository');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function makePool() {
  const guidance = {
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
    delegate_person_id: 601,
    delegate_person_name: '授权代理',
    delegation_id: 9001,
    delegation_can_final_confirm: 0,
    is_major: 1,
    visibility_scope: 'department',
    status: 'pending_response',
    created_at: '2026-06-26 09:00:00',
    updated_at: '2026-06-26 09:00:00'
  };

  function activeDelegationFor(params) {
    const delegatePersonId = Number(params[2]);
    if (delegatePersonId !== 601) return null;
    return {
      delegation_id: 9001,
      department_id: 20,
      final_responsible_person_id: 501,
      delegate_person_id: 601,
      can_final_confirm: 0,
      status: 'active'
    };
  }

  return {
    async execute(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized.includes('SELECT g.*, d.name AS related_department_name') &&
          normalized.includes('FROM process_governance_guidance g') &&
          normalized.includes('WHERE g.guidance_id=?')) {
        return [[guidance], undefined];
      }

      if (normalized.includes('SELECT g.*, d.name AS related_department_name') &&
          normalized.includes('FROM process_governance_guidance g') &&
          normalized.includes('ORDER BY g.updated_at DESC')) {
        if (!normalized.includes('EXISTS')) {
          const personId = Number(params[0]);
          if ([501, 701].includes(personId)) return [[guidance], undefined];
          return [[], undefined];
        }
        const personId = Number(params[0]);
        if ([501, 601, 701].includes(personId)) return [[guidance], undefined];
        return [[], undefined];
      }

      if (normalized.includes('FROM department_responsibility_delegations')) {
        return [[activeDelegationFor(params)].filter(Boolean), undefined];
      }

      throw new Error(`Unhandled SQL in guidance visibility fake pool: ${normalized}`);
    }
  };
}

(async () => {
  const repo = makeGovernanceGuidanceMysqlRepository(makePool());

  const delegateList = await repo.listGuidanceForPerson(601, new Set(['guidance:respond']));
  assert.strictEqual(delegateList.length, 1, 'active delegate should see delegated guidance in the list');
  assert.strictEqual(delegateList[0].guidanceActions.canRespond, true, 'active delegate can respond when permission allows');

  const outsiderList = await repo.listGuidanceForPerson(777, new Set(['guidance:respond']));
  assert.strictEqual(outsiderList.length, 0, 'unrelated person should not see guidance list rows');

  const delegateDetail = await repo.getGuidanceDetail(77, 601, new Set(['guidance:respond']));
  assert.ok(delegateDetail, 'active delegate should see guidance detail');
  assert.strictEqual(delegateDetail.guidanceActions.canRespond, true);

  const outsiderDetail = await repo.getGuidanceDetail(77, 777, new Set(['guidance:respond']));
  assert.strictEqual(outsiderDetail, null, 'unrelated person should not read guidance detail by id');

  const globalDetail = await repo.getGuidanceDetail(77, 999, new Set(['process_governance:view_global']));
  assert.ok(globalDetail, 'global viewer should see guidance detail');

  console.log('Guidance visibility MySQL repository test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
