const assert = require('assert');
const { makeGovernanceGuidanceMysqlRepository } = require('../server/governanceGuidanceMysqlRepository');

function normalizeSql(sql) {
  return sql.replace(/\s+/g, ' ').trim();
}

function makePool() {
  const state = {
    guidance: {
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
      executor_person_id: null,
      is_major: 1,
      visibility_scope: 'department',
      status: 'pending_response',
      created_at: '2026-06-26 09:00:00',
      updated_at: '2026-06-26 09:00:00'
    },
    persons: [
      { person_id: 501, status: 'active' },
      { person_id: 601, status: 'active' },
      { person_id: 602, status: 'active' },
      { person_id: 700, status: 'inactive' }
    ],
    delegations: [],
    events: []
  };

  return {
    state,
    async execute(sql, params = []) {
      const normalized = normalizeSql(sql);

      if (normalized.includes('SELECT g.*, d.name AS related_department_name') &&
          normalized.includes('FROM process_governance_guidance g')) {
        return [[state.guidance], undefined];
      }

      if (normalized === "SELECT person_id FROM person WHERE person_id=? AND status='active' LIMIT 1") {
        const person = state.persons.find(row => Number(row.person_id) === Number(params[0]) && row.status === 'active');
        return [[person ? { person_id: person.person_id } : null].filter(Boolean), undefined];
      }

      if (normalized.includes('FROM department_responsibility_delegations') &&
          normalized.startsWith('SELECT *')) {
        return [[], undefined];
      }

      if (normalized.startsWith('INSERT INTO department_responsibility_delegations')) {
        const delegation = {
          delegation_id: 9001 + state.delegations.length,
          department_id: params[0],
          final_responsible_person_id: params[1],
          delegate_person_id: params[2]
        };
        state.delegations.push(delegation);
        return [{ insertId: delegation.delegation_id, affectedRows: 1 }, undefined];
      }

      if (normalized.startsWith('UPDATE process_governance_guidance SET executor_person_id=?,')) {
        state.guidance.executor_person_id = params[0];
        state.guidance.current_handler_person_id = params[1];
        state.guidance.status = params[2];
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalized.startsWith('INSERT INTO process_governance_guidance_events')) {
        state.events.push({ guidance_id: params[0], event_type: params[1], actor_person_id: params[2] });
        return [{ insertId: state.events.length, affectedRows: 1 }, undefined];
      }

      throw new Error(`Unhandled SQL in guidance person validation fake pool: ${normalized}`);
    }
  };
}

(async () => {
  const pool = makePool();
  const repo = makeGovernanceGuidanceMysqlRepository(pool);

  const invalidDelegate = await repo.delegateGuidance(77, 501, { delegate_person_id: 999 });
  assert.deepStrictEqual(invalidDelegate, { updated: false, reason: 'invalid_delegate' });
  assert.strictEqual(pool.state.delegations.length, 0, 'invalid delegate should not be inserted');

  const inactiveDelegate = await repo.delegateGuidance(77, 501, { delegate_person_id: 700 });
  assert.deepStrictEqual(inactiveDelegate, { updated: false, reason: 'invalid_delegate' });
  assert.strictEqual(pool.state.delegations.length, 0, 'inactive delegate should not be inserted');

  const validDelegate = await repo.delegateGuidance(77, 501, { delegate_person_id: 601 });
  assert.strictEqual(validDelegate.updated, true);
  assert.strictEqual(pool.state.delegations[0].delegate_person_id, 601);

  const invalidExecutor = await repo.assignGuidanceExecutor(77, 501, { executor_person_id: 999 });
  assert.deepStrictEqual(invalidExecutor, { updated: false, reason: 'invalid_executor' });
  assert.strictEqual(pool.state.guidance.executor_person_id, null, 'invalid executor should not be written');

  const validExecutor = await repo.assignGuidanceExecutor(77, 501, { executor_person_id: 602 });
  assert.strictEqual(validExecutor.updated, true);
  assert.strictEqual(pool.state.guidance.executor_person_id, 602);
  assert.strictEqual(pool.state.guidance.current_handler_person_id, 602);

  console.log('Guidance person validation MySQL repository test passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
