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
  const events = [];
  const permissionsByPerson = new Map([
    [701, new Set(['guidance:create', 'process_governance:view_global'])],
    [501, new Set(['guidance:respond', 'guidance:final_confirm'])],
    [601, new Set(['guidance:respond'])],
    [999, new Set(['admin:access', 'process_governance:view_global', 'guidance:final_confirm'])]
  ]);

  let sessionPersonId = 701;
  guidanceRouter.setIdentityRepositoryFactory(() => ({
    async getUserEffectivePermissions(personId) {
      return { permSet: permissionsByPerson.get(Number(personId)) || new Set(), fieldConstraints: {} };
    }
  }));

  guidanceRouter.setGuidanceRepositoryFactory(() => {
    const guidance = {
      guidance_id: 77,
      guidance_code: 'GUID-20260626-0001',
      related_entity_type: 'process_mapping_record',
      related_entity_id: 3001,
      related_department_id: 20,
      final_responsible_person_id: 501,
      current_handler_person_id: 501,
      is_major: true,
      status: 'pending_response'
    };

    return {
      async createGuidance(payload) {
        events.push({ type: 'created', actor: payload.created_by_person_id });
        return Object.assign({}, guidance, payload, { status: 'pending_response' });
      },
      async listGuidanceForPerson() {
        return [guidance];
      },
      async respondGuidance(id, personId, payload) {
        if (Number(id) !== 77) return { updated: false, reason: 'missing' };
        if (Number(personId) === 999) return { updated: false, reason: 'not_responsible' };
        if (Number(personId) === 601 && payload.final_confirm) return { updated: false, reason: 'final_confirm_denied' };
        events.push({ type: payload.final_confirm ? 'final_confirmed' : 'responded', actor: Number(personId) });
        return { updated: true, status: payload.final_confirm ? 'closed' : 'pending_final_confirm' };
      },
      async clarifyGuidance(id, personId) {
        events.push({ type: 'clarification_requested', actor: Number(personId) });
        return { updated: true, status: 'clarification_requested' };
      },
      async objectGuidance(id, personId) {
        events.push({ type: 'objected', actor: Number(personId) });
        return { updated: true, status: 'objected' };
      },
      async delegateGuidance(id, personId) {
        events.push({ type: 'delegated', actor: Number(personId) });
        return { updated: true, status: 'pending_response' };
      },
      async finalConfirmGuidance(id, personId) {
        if (Number(id) !== 77) return { updated: false, reason: 'missing' };
        if (Number(personId) === 999) return { updated: false, reason: 'not_responsible' };
        if (Number(personId) === 601) return { updated: false, reason: 'final_confirm_denied' };
        events.push({ type: 'final_confirmed', actor: Number(personId) });
        return { updated: true, status: 'closed' };
      }
    };
  });

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: sessionPersonId, personId: sessionPersonId, userRole: 'owner' };
    next();
  });
  app.use('/api/process-governance/guidance', guidanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const createRes = await fetch(`${baseUrl}/api/process-governance/guidance`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        related_entity_type: 'process_mapping_record',
        related_entity_id: 3001,
        related_department_id: 20,
        content: '请补充跨部门输入输出。',
        is_major: true
      })
    });
    assert.strictEqual(createRes.status, 201, JSON.stringify(await createRes.json()));

    sessionPersonId = 501;
    const respondRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response_content: '已组织补充材料。' })
    });
    const respondBody = await respondRes.json();
    assert.strictEqual(respondRes.status, 200, JSON.stringify(respondBody));
    assert.strictEqual(respondBody.status, 'pending_final_confirm');

    const clarifyRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/clarify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '请明确材料范围。' })
    });
    const clarifyText = await clarifyRes.text();
    assert.strictEqual(clarifyRes.status, 200, clarifyText);

    sessionPersonId = 999;
    const adminCloseRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    const adminCloseText = await adminCloseRes.text();
    assert.strictEqual(adminCloseRes.status, 403, adminCloseText);

    sessionPersonId = 601;
    const delegateCloseRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    const delegateCloseText = await delegateCloseRes.text();
    assert.strictEqual(delegateCloseRes.status, 403, delegateCloseText);

    sessionPersonId = 501;
    const closeRes = await fetch(`${baseUrl}/api/process-governance/guidance/77/final-confirm`, { method: 'POST' });
    const closeBody = await closeRes.json();
    assert.strictEqual(closeRes.status, 200, JSON.stringify(closeBody));
    assert.strictEqual(closeBody.status, 'closed');
    assert.ok(events.some(event => event.type === 'final_confirmed' && event.actor === 501));

    console.log('Guidance workflow MySQL API test passed');
  } finally {
    await closeServer(server);
    guidanceRouter.resetGuidanceRepositoryFactory();
    guidanceRouter.resetIdentityRepositoryFactory();
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
