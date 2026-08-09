const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processDesignRouter = require('../server/routes/processDesignMysql');
const { createEmptyProcessGovernanceDocument } = require('../server/processGovernanceV2');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

const identities = {
  contact: { userId: 10, personId: 10, userName: '经营部门主对接人', departmentId: 1, roles: ['department_contact'], permissions: ['governance:read-department', 'governance:draft-department'] },
  admin: { userId: 11, personId: 11, userName: '管理员', departmentId: 1, roles: ['admin'], permissions: ['governance:read-global'] },
  lead: { userId: 12, personId: 12, userName: 'MDM工作组组长', departmentId: 1, roles: ['mdm_lead'], permissions: ['governance:read-global', 'governance:assign-work', 'governance:structure-gate'] },
  handler: { userId: 13, personId: 13, userName: '冲突处理人', departmentId: 1, roles: ['data_conflict_handler'], permissions: ['governance:read-global', 'governance:coordinate-conflict'] },
  originReviewer: { userId: 14, personId: 14, userName: '归口部门审核员', departmentId: 1, roles: ['department_mdm_reviewer'], permissions: ['governance:read-department', 'governance:review-department'] },
  targetReviewer: { userId: 15, personId: 15, userName: '承接部门审核员', departmentId: 2, roles: ['department_mdm_reviewer'], permissions: ['governance:read-department', 'governance:review-department'] },
  decision: { userId: 16, personId: 16, userName: '项目决策组', departmentId: 1, roles: ['decision_group'], permissions: ['governance:read-global', 'governance:decide-escalation'] }
};

async function request(baseUrl, identityKey, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    ...options,
    headers: {
      'X-Test-User': identityKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  return { response, body: await response.json() };
}

function conflictRecord(id, status) {
  return {
    id,
    handoff_id: id + 100,
    status,
    assigned_handler_person_id: status === 'pending_assignment' ? null : 13,
    origin_department_id: 1,
    counterparty_department_id: 2,
    origin_confirmation: id === 2 ? 'rejected' : null,
    counterparty_confirmation: null,
    handoff_ref: `H-${id}`,
    process_name: '客户需求变更',
    opened_reason: '承接范围存在明确分歧'
  };
}

function makeRepository() {
  const document = createEmptyProcessGovernanceDocument({
    process_ref: 'P-001',
    process_name: '客户需求变更',
    owning_department: '经营发展部'
  });
  const draft = {
    id: 1,
    document_no: 'PG-P-001',
    process_name: '客户需求变更',
    department_id: 1,
    department_name: '经营发展部',
    status: 'draft',
    schema_version: 'process-governance-v2',
    revision_no: 1
  };
  const conflicts = new Map([
    [1, conflictRecord(1, 'pending_assignment')],
    [2, conflictRecord(2, 'pending_department_confirmation')]
  ]);
  const calls = [];

  return {
    calls,
    draft,
    document,
    conflicts,
    async listCanonicalDrafts() {
      return [draft];
    },
    async getDraft(id) {
      return Number(id) === draft.id ? draft : null;
    },
    async canonicalContent() {
      return { document, revision: draft.revision_no, source: 'draft' };
    },
    async saveCanonicalContent(_draft, content, expectedRevision) {
      calls.push(['saveCanonicalContent', expectedRevision]);
      if (Number(expectedRevision) !== Number(draft.revision_no)) {
        const error = new Error('草稿已被其他人员修改，请重新载入后再保存');
        error.statusCode = 409;
        error.payload = {
          error: error.message,
          code: 'DRAFT_REVISION_CONFLICT',
          expected_revision: Number(expectedRevision),
          actual_revision: Number(draft.revision_no)
        };
        throw error;
      }
      draft.revision_no += 1;
      return { document: content, revision: draft.revision_no, changed: true };
    },
    async listHandoffQueue(actor) {
      return {
        items: [{
          id: 101,
          handoff_ref: 'H-001',
          process_name: '客户需求变更',
          status: 'pending_origin_review',
          origin_department_id: 1,
          counterparty_department_id: 2,
          current_stage: { code: 'origin_review', name: '归口部门审核' },
          can_act: actor.roleCodes.includes('department_mdm_reviewer') && actor.departmentId === 1
        }],
        total: 1
      };
    },
    async getHandoffStory(id) {
      if (Number(id) !== 101) return null;
      return {
        current_stage: { code: 'origin_review', name: '归口部门审核' },
        next_actions: [{
          responsible_role: 'department_mdm_reviewer',
          department_id: 1,
          department_name: '经营发展部',
          handler_person_id: null,
          handler_person_name: null,
          can_act: false
        }],
        milestones: [
          { stage_code: 'assignment', stage_name: '责任部门分派（需要时）', state: 'completed' },
          { stage_code: 'origin_review', stage_name: '归口部门审核', state: 'current' }
        ],
        events: [{ event_type: 'handoff_candidate_created', basis_text: '来自v2承接关系' }],
        conflict: null,
        handoff: { id: 101, handoff_ref: 'H-001' }
      };
    },
    async listHandoffConflictQueue() {
      return { items: Array.from(conflicts.values()), total: conflicts.size };
    },
    async getHandoffConflictContext(id) {
      return conflicts.get(Number(id)) || null;
    },
    async personHasActiveRole(personId, roleCode) {
      return Number(personId) === 13 && roleCode === 'data_conflict_handler';
    },
    async assignHandoffConflict(conflict, handlerPersonId) {
      conflict.status = 'coordinating';
      conflict.assigned_handler_person_id = Number(handlerPersonId);
      calls.push(['assign', conflict.id]);
      return conflict;
    },
    async saveHandoffConflictProposal(conflict, body) {
      conflict.status = 'pending_department_confirmation';
      Object.assign(conflict, body);
      calls.push(['proposal', conflict.id]);
      return conflict;
    },
    async confirmHandoffConflictProposal(conflict, departmentId, accepted) {
      const field = Number(departmentId) === 1 ? 'origin_confirmation' : 'counterparty_confirmation';
      conflict[field] = accepted ? 'accepted' : 'rejected';
      if (conflict.origin_confirmation === 'accepted' && conflict.counterparty_confirmation === 'accepted') {
        conflict.status = 'resolved';
      }
      calls.push(['confirmation', conflict.id, Number(departmentId), accepted]);
      return conflict;
    },
    async escalateHandoffConflict(conflict) {
      conflict.status = 'pending_decision';
      calls.push(['escalate', conflict.id]);
      return conflict;
    },
    async decideHandoffConflict(conflict, decision, basis) {
      conflict.status = 'resolved';
      conflict.decision = decision;
      conflict.decision_basis = basis;
      calls.push(['decision', conflict.id, decision]);
      return conflict;
    }
  };
}

async function main() {
  const identityByUserId = new Map(Object.values(identities).map(item => [item.userId, item]));
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      return { permSet: new Set(identityByUserId.get(Number(userId))?.permissions || []), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId) {
      return (identityByUserId.get(Number(userId))?.roles || []).map(code => ({ code }));
    },
    async getDepartmentById(departmentId) {
      return { id: Number(departmentId), name: Number(departmentId) === 2 ? '工程技术部' : '经营发展部' };
    },
    async getUserById(userId) {
      const identity = identityByUserId.get(Number(userId));
      return identity ? { id: identity.userId, personId: identity.personId, name: identity.userName } : null;
    }
  }));

  const repository = makeRepository();
  processDesignRouter.setProcessDesignRepositoryFactory(() => repository);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const identity = identities[req.get('X-Test-User')] || identities.contact;
    req.session = {
      userId: identity.userId,
      personId: identity.personId,
      userName: identity.userName,
      departmentId: identity.departmentId
    };
    next();
  });
  app.use('/api/process-design', processDesignRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    const drafts = await request(baseUrl, 'contact', '/api/process-design/drafts');
    assert.strictEqual(drafts.response.status, 200);
    assert.strictEqual(drafts.body.schema_version, 'process-governance-v3');

    const content = await request(baseUrl, 'contact', '/api/process-design/drafts/1/content');
    assert.strictEqual(content.response.status, 200);
    assert.strictEqual(content.body.document.schema_version, 'process-governance-v3');
    assert.strictEqual(content.body.revision, 1);

    const conflictSave = await request(baseUrl, 'contact', '/api/process-design/drafts/1/content', {
      method: 'PUT',
      body: JSON.stringify({ content: repository.document, expected_revision: 0 })
    });
    assert.strictEqual(conflictSave.response.status, 409);
    assert.strictEqual(conflictSave.body.code, 'DRAFT_REVISION_CONFLICT');
    assert.strictEqual(conflictSave.body.actual_revision, 1);

    const saved = await request(baseUrl, 'contact', '/api/process-design/drafts/1/content', {
      method: 'PUT',
      body: JSON.stringify({ content: repository.document, expected_revision: 1 })
    });
    assert.strictEqual(saved.response.status, 200);
    assert.strictEqual(saved.body.revision, 2);

    const adminWrite = await request(baseUrl, 'admin', '/api/process-design/drafts/1/content', {
      method: 'PUT',
      body: JSON.stringify({ content: repository.document, expected_revision: 2 })
    });
    assert.strictEqual(adminWrite.response.status, 403);
    assert.match(adminWrite.body.error, /管理员.*只读/);

    const handoffs = await request(baseUrl, 'originReviewer', '/api/process-design/cross-dept-handoffs');
    assert.strictEqual(handoffs.response.status, 200);
    assert.strictEqual(handoffs.body.items[0].can_act, true);

    const story = await request(baseUrl, 'admin', '/api/process-design/cross-dept-handoffs/101/story');
    assert.strictEqual(story.response.status, 200);
    ['current_stage', 'next_actions', 'milestones', 'events', 'conflict'].forEach(field => {
      assert.ok(Object.prototype.hasOwnProperty.call(story.body, field), `story must include ${field}`);
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(story.body, 'progress_percentage'), 'story must not infer a progress percentage');
    assert.strictEqual(story.body.next_actions[0].responsible_role, 'department_mdm_reviewer');
    assert.strictEqual(story.body.next_actions[0].department_name, '经营发展部');

    const adminConflictWrite = await request(baseUrl, 'admin', '/api/process-design/handoff-conflicts/1/assign', {
      method: 'POST',
      body: JSON.stringify({ handler_person_id: 13 })
    });
    assert.strictEqual(adminConflictWrite.response.status, 403);

    const assigned = await request(baseUrl, 'lead', '/api/process-design/handoff-conflicts/1/assign', {
      method: 'POST',
      body: JSON.stringify({ handler_person_id: 13 })
    });
    assert.strictEqual(assigned.response.status, 200);
    assert.strictEqual(assigned.body.status, 'coordinating');

    const proposal = await request(baseUrl, 'handler', '/api/process-design/handoff-conflicts/1/proposal', {
      method: 'PUT',
      body: JSON.stringify({
        origin_position: '按原流程继续',
        counterparty_position: '需补充边界',
        proposal_text: '补齐范围后继续承接',
        evidence: ['制度第4条', '双方确认记录']
      })
    });
    assert.strictEqual(proposal.response.status, 200);
    assert.strictEqual(proposal.body.status, 'pending_department_confirmation');

    const originAccepted = await request(baseUrl, 'originReviewer', '/api/process-design/handoff-conflicts/1/department-confirmation', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'accepted', basis: '归口部门确认' })
    });
    assert.strictEqual(originAccepted.response.status, 200);
    assert.strictEqual(originAccepted.body.status, 'pending_department_confirmation');

    const targetAccepted = await request(baseUrl, 'targetReviewer', '/api/process-design/handoff-conflicts/1/department-confirmation', {
      method: 'POST',
      body: JSON.stringify({ confirmation: 'accepted', basis: '承接部门确认' })
    });
    assert.strictEqual(targetAccepted.response.status, 200);
    assert.strictEqual(targetAccepted.body.status, 'resolved');

    const escalated = await request(baseUrl, 'handler', '/api/process-design/handoff-conflicts/2/escalate', {
      method: 'POST',
      body: JSON.stringify({ basis: '承接部门不接受协调方案' })
    });
    assert.strictEqual(escalated.response.status, 200);
    assert.strictEqual(escalated.body.status, 'pending_decision');

    const decided = await request(baseUrl, 'decision', '/api/process-design/handoff-conflicts/2/decision', {
      method: 'POST',
      body: JSON.stringify({ decision: 'return_revision', basis: '需重新明确承接边界' })
    });
    assert.strictEqual(decided.response.status, 200);
    assert.strictEqual(decided.body.decision, 'return_revision');

    console.log('Unified process governance API test passed');
  } finally {
    await closeServer(server);
    processDesignRouter.resetProcessDesignRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
