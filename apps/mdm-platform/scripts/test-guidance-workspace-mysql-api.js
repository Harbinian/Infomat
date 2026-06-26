const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function main() {
  const guidanceRouter = require('../server/routes/governanceGuidance');
  const orgRouter = require('../server/routes/org');

  let sessionPersonId = 501;
  const listFilters = [];
  const delegated = [];
  const revoked = [];
  const executorAssignments = [];

  const identityRepo = {
    async getUserEffectivePermissions(personId) {
      const permissions = Number(personId) === 501
        ? ['guidance:respond', 'guidance:delegate', 'guidance:final_confirm', 'process_governance:view_global']
        : ['guidance:respond'];
      return { permSet: new Set(permissions), fieldConstraints: {} };
    },
    async listAssignableUsers() {
      return [
        { id: 501, personId: 501, name: '质量负责人', department_id: 2, dept_name: '质量管理部' },
        { id: 602, personId: 602, name: '执行专员', department_id: 2, dept_name: '质量管理部' }
      ];
    }
  };

  const guidance = {
    guidance_id: 77,
    guidance_code: 'GUID-20260626-0001',
    related_entity_type: 'process_mapping_record',
    related_entity_id: 3001,
    related_department_id: 2,
    related_department_name: '质量管理部',
    content: '请补充跨部门输入输出证据。',
    final_responsible_person_id: 501,
    finalResponsiblePerson: '质量负责人',
    current_handler_person_id: 601,
    currentHandlerPerson: '代理处理人',
    delegate_person_id: 601,
    delegatePerson: '代理处理人',
    executor_person_id: 602,
    executorPerson: '执行专员',
    status: 'pending_response',
    guidanceActions: {
      canRespond: false,
      canDelegate: true,
      canAssignExecutor: true,
      canFinalConfirm: false,
      disabledReasons: {
        canRespond: '当前处理人是代理处理人'
      }
    }
  };

  guidanceRouter.setIdentityRepositoryFactory(() => identityRepo);
  orgRouter.setIdentityRepositoryFactory(() => identityRepo);
  guidanceRouter.setGuidanceRepositoryFactory(() => ({
    async listGuidanceForPerson(personId, permissions, filters) {
      listFilters.push({ personId, permissions, filters });
      return [guidance];
    },
    async getGuidanceDetail(guidanceId, personId) {
      assert.strictEqual(Number(guidanceId), 77);
      return { ...guidance, requestedBy: Number(personId) };
    },
    async listGuidanceEvents(guidanceId) {
      assert.strictEqual(Number(guidanceId), 77);
      return [
        { event_id: 1, event_type: 'created', actor_person_id: 701, actorPerson: '公司领导', note: '形成指导意见' },
        { event_id: 2, event_type: 'delegated', actor_person_id: 501, actorPerson: '质量负责人', note: '授权代理处理' }
      ];
    },
    async delegateGuidance(guidanceId, personId, payload) {
      delegated.push({ guidanceId, personId, payload });
      return { updated: true, status: 'pending_response', delegationId: 9001 };
    },
    async revokeGuidanceDelegation(guidanceId, delegationId, personId) {
      revoked.push({ guidanceId, delegationId, personId });
      return { updated: true, status: 'pending_response' };
    },
    async assignGuidanceExecutor(guidanceId, personId, payload) {
      executorAssignments.push({ guidanceId, personId, payload });
      return { updated: true, status: 'in_progress' };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionPersonId, personId: sessionPersonId, userRole: 'owner', departmentId: 2 };
    next();
  });
  app.use('/api/process-governance/guidance', guidanceRouter);
  app.use('/api/org', orgRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const listRes = await fetch(`${baseUrl}/api/process-governance/guidance?related_entity_type=process_mapping_record&related_entity_id=3001`);
    const listBody = await listRes.json();
    assert.strictEqual(listRes.status, 200, JSON.stringify(listBody));
    assert.strictEqual(listBody.length, 1);
    assert.deepStrictEqual(listFilters[0].filters, {
      related_entity_type: 'process_mapping_record',
      related_entity_id: 3001
    });

    const detailRes = await fetch(`${baseUrl}/api/process-governance/guidance/77`);
    const detailBody = await detailRes.json();
    assert.strictEqual(detailRes.status, 200, JSON.stringify(detailBody));
    assert.strictEqual(detailBody.executorPerson, '执行专员');
    assert.strictEqual(detailBody.guidanceActions.disabledReasons.canRespond, '当前处理人是代理处理人');

    const eventsRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/events`);
    const eventsBody = await eventsRes.json();
    assert.strictEqual(eventsRes.status, 200, JSON.stringify(eventsBody));
    assert.deepStrictEqual(eventsBody.map(event => event.event_type), ['created', 'delegated']);

    const peopleRes = await fetch(`${baseUrl}/api/org/persons/assignable`);
    const peopleBody = await peopleRes.json();
    assert.strictEqual(peopleRes.status, 200, JSON.stringify(peopleBody));
    assert.strictEqual(peopleBody[1].personId, 602);

    const delegateRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delegate_person_id: 601, can_final_confirm: true, reason: '本周由代理处理' })
    });
    const delegateBody = await delegateRes.json();
    assert.strictEqual(delegateRes.status, 200, JSON.stringify(delegateBody));
    assert.strictEqual(delegateBody.delegationId, 9001);
    assert.strictEqual(delegated[0].payload.delegate_person_id, 601);

    const revokeRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/delegations/9001`, { method: 'DELETE' });
    const revokeBody = await revokeRes.json();
    assert.strictEqual(revokeRes.status, 200, JSON.stringify(revokeBody));
    assert.deepStrictEqual(revoked[0], { guidanceId: 77, delegationId: 9001, personId: 501 });

    const executorRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/assign-executor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ executor_person_id: 602, note: '请执行材料补充' })
    });
    const executorBody = await executorRes.json();
    assert.strictEqual(executorRes.status, 200, JSON.stringify(executorBody));
    assert.strictEqual(executorAssignments[0].payload.executor_person_id, 602);

    console.log('Guidance workspace MySQL API test passed');
  } finally {
    await closeServer(server);
    guidanceRouter.resetGuidanceRepositoryFactory();
    guidanceRouter.resetIdentityRepositoryFactory();
    orgRouter.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  }
});
