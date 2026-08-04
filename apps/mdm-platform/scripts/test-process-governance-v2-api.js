const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const processDesignRouter = require('../server/routes/processDesignMysql');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function request(baseUrl, userKey, routePath, options = {}) {
  const response = await fetch(`${baseUrl}${routePath}`, {
    ...options,
    headers: {
      'X-Test-User': userKey,
      ...(options.body ? { 'Content-Type': 'application/json' } : {})
    }
  });
  return { response, body: await response.json() };
}

function createDocument(options = {}) {
  return {
    schema_version: 'process-governance-v2',
    export_meta: {
      package_ref: 'package_1',
      exported_at: '2026-07-31T00:00:00.000Z',
      initiating_department: '经营发展部',
      compiler: '测试编制人'
    },
    process: {
      process_ref: options.processRef || 'process_1',
      process_name: '月度绩效考核',
      owning_department: '经营发展部',
      purpose: '完成月度绩效评价',
      scope: '公司各部门',
      capability_domain: '战略规划及经营指标治理',
      business_capability: '月度绩效考核管理',
      classification_status: 'confirmed'
    },
    reference_materials: [],
    behaviors: [{
      behavior_ref: 'behavior_1',
      node_type: 'action',
      behavior_name: '汇总绩效数据',
      current_actor_role: '经营发展部规划员',
      trigger: '月末',
      precondition: '',
      input_description: '部门绩效数据',
      timing: '月底',
      completion_standard: '汇总完成',
      output_description: '绩效汇总表',
      input_data_refs: ['data_1'],
      output_data_refs: [],
      work_role: null,
      countersign_all_required: false,
      countersign_target_departments: []
    }],
    flow_relations: [],
    data_objects: [{
      data_ref: 'data_1',
      data_name: '部门绩效数据',
      description: '外部门提交的月度绩效数据',
      governance_status: 'candidate',
      produced_by_behavior_ref: null,
      consumed_by_behavior_refs: ['behavior_1']
    }],
    cross_department_handoffs: [{
      handoff_ref: 'handoff_1',
      handoff_direction: 'inbound_prerequisite',
      anchor_behavior_ref: 'behavior_1',
      counterparty_resolution: options.unresolved ? 'needs_identification' : 'identified',
      source_department: options.unresolved ? '' : '工程技术部',
      target_department: '经营发展部',
      transfer_data_ref: 'data_1',
      requested_matter: '提供本部门月度绩效数据',
      trigger_condition: '月末',
      completion_standard: '数据完整并经部门确认',
      counterparty_process_ref: null,
      counterparty_process_name: '',
      counterparty_behavior_ref: null,
      counterparty_behavior_name: '',
      requires_return: false,
      returned_data_ref: null,
      resume_behavior_ref: null
    }],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function fakeRepository() {
  const state = {
    writes: 0,
    imports: new Map(),
    handoffs: new Map(),
    nextHandoffId: 1
  };
  return {
    state,
    async importProcessGovernanceCandidate(preview, review, actor) {
      state.writes += 1;
      if (state.imports.has(preview.content_hash)) {
        return { ...state.imports.get(preview.content_hash), idempotent: true };
      }
      const candidate = preview.handoff_candidates[0];
      const unresolved = candidate.counterparty_resolution === 'needs_identification';
      const id = state.nextHandoffId++;
      const handoff = {
        id,
        is_current: 1,
        issue_id: 100 + id,
        point_id: 200 + id,
        status: unresolved ? 'pending_assignment' : 'pending_origin_review',
        handoff_direction: candidate.handoff_direction,
        origin_department_id: 1,
        origin_department: '经营发展部',
        origin_final_responsible_person_id: 101,
        counterparty_department_id: unresolved ? null : 2,
        counterparty_department: unresolved ? '' : '工程技术部',
        counterparty_final_responsible_person_id: unresolved ? null : 201,
        candidate_version: preview.content_hash,
        anchor_behavior_ref: candidate.anchor_behavior_ref,
        transfer_data_ref: candidate.transfer_data_ref,
        requested_matter: candidate.requested_matter,
        trigger_condition: candidate.trigger_condition,
        completion_standard: candidate.completion_standard,
        participants: [
          ['department_mdm_reviewer', 1],
          ['mdm_lead', null],
          ...(!unresolved ? [['department_contact', 2], ['department_mdm_reviewer', 2]] : [])
        ]
      };
      state.handoffs.set(id, handoff);
      const result = {
        idempotent: false,
        import_id: state.imports.size + 1,
        draft: { id: 10, department_id: 1, process_name: preview.summary.process_name },
        handoffs: [handoff],
        content_hash: preview.content_hash
      };
      state.imports.set(preview.content_hash, result);
      return result;
    },
    async getHandoffContext(id) {
      return state.handoffs.get(Number(id)) || null;
    },
    async hasHandoffParticipant(handoff, actor) {
      return handoff.participants.some(([roleCode, departmentId]) =>
        roleCode === actor.roleCode && (departmentId == null || departmentId === actor.departmentId)
      );
    },
    async assignHandoffCounterparty(handoff, department) {
      state.writes += 1;
      handoff.counterparty_department_id = department.id;
      handoff.counterparty_department = department.name;
      handoff.counterparty_final_responsible_person_id = 201;
      handoff.status = 'pending_origin_review';
      handoff.participants.push(['department_contact', department.id], ['department_mdm_reviewer', department.id]);
      return handoff;
    },
    async saveHandoffCounterpartyResponse(handoff, body) {
      state.writes += 1;
      handoff.counterparty_process_name = body.counterparty_process_name;
      handoff.counterparty_behavior_name = body.counterparty_behavior_name;
      handoff.completion_standard = body.completion_standard;
      handoff.status = 'pending_counterparty_review';
      return handoff;
    },
    async recordHandoffDepartmentDecision(handoff, department) {
      state.writes += 1;
      if (handoff.status === 'pending_origin_review') handoff.status = 'pending_counterparty_scope';
      else if (handoff.status === 'pending_counterparty_scope') handoff.status = 'pending_counterparty_detail';
      else if (handoff.status === 'pending_counterparty_review') handoff.status = 'pending_structure_gate';
      return { handoff, decision_record_id: state.writes };
    },
    async runHandoffStructureGate(handoff) {
      state.writes += 1;
      handoff.status = 'confirmed';
      return handoff;
    }
  };
}

async function main() {
  const sessions = {
    contact: { personId: 10, userId: 10, departmentId: 1 },
    targetContact: { personId: 30, userId: 30, departmentId: 2 },
    reviewer: { personId: 20, userId: 20, departmentId: 1 },
    targetReviewer: { personId: 40, userId: 40, departmentId: 2 },
    mdmLead: { personId: 99, userId: 99, departmentId: 2 },
    admin: { personId: 1, userId: 1, departmentId: 1 }
  };
  const roles = new Map([
    [10, [{ code: 'department_contact' }]],
    [30, [{ code: 'department_contact' }]],
    [20, [{ code: 'department_mdm_reviewer' }]],
    [40, [{ code: 'department_mdm_reviewer' }]],
    [99, [{ code: 'mdm_lead' }]],
    [1, [{ code: 'admin' }]]
  ]);
  const permissions = new Map([
    [10, ['governance:read-department']],
    [30, ['governance:read-department']],
    [20, ['governance:read-department', 'governance:review-department']],
    [40, ['governance:read-department', 'governance:review-department']],
    [99, ['governance:read-global', 'governance:structure-gate']],
    [1, ['governance:read-global']]
  ]);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserRoleCodes(userId) {
      return roles.get(Number(userId)) || [];
    },
    async getUserEffectivePermissions(userId) {
      return { permSet: new Set(permissions.get(Number(userId)) || []), fieldConstraints: {} };
    },
    async getDepartmentById(id) {
      return Number(id) === 1
        ? { id: 1, name: '经营发展部', final_responsible_person_id: 101 }
        : { id: 2, name: '工程技术部', final_responsible_person_id: 201 };
    },
    async getDepartmentByName(name) {
      return name === '经营发展部'
        ? { id: 1, name }
        : name === '工程技术部'
          ? { id: 2, name }
          : null;
    }
  }));

  const repo = fakeRepository();
  let repositoryCalls = 0;
  processDesignRouter.setProcessDesignRepositoryFactory(() => {
    repositoryCalls += 1;
    return repo;
  });
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = sessions[req.get('X-Test-User')] || sessions.contact;
    next();
  });
  app.use('/api/process-design', processDesignRouter);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const source = createDocument();
    source.approved = true;
    source.status = 'approved';
    source.reviewer = '伪造审核人';
    const preview = await request(baseUrl, 'contact', '/api/process-design/import-structured-output/preview', {
      method: 'POST',
      body: JSON.stringify({ data: source })
    });
    assert.strictEqual(preview.response.status, 200, JSON.stringify(preview.body));
    assert.strictEqual(repo.state.writes, 0, 'preview must not write business data');
    assert.strictEqual(repositoryCalls, 0, 'preview must not initialize the process repository');
    assert.strictEqual(preview.body.normalized_schema_version, 'process-governance-v2');
    assert.strictEqual(preview.body.handoff_candidates.length, 1);

    const forbiddenContactApprove = await request(baseUrl, 'contact', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({ data: source, preview_hash: preview.body.content_hash, decision_basis: '部门审核通过' })
    });
    assert.strictEqual(forbiddenContactApprove.response.status, 403);
    const forbiddenAdminApprove = await request(baseUrl, 'admin', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({ data: source, preview_hash: preview.body.content_hash, decision_basis: '管理员代审' })
    });
    assert.strictEqual(forbiddenAdminApprove.response.status, 403);
    const tamperedApprove = await request(baseUrl, 'reviewer', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({ data: source, preview_hash: '0'.repeat(64), decision_basis: '部门审核通过' })
    });
    assert.strictEqual(tamperedApprove.response.status, 409);
    assert.strictEqual(tamperedApprove.body.code, 'PREVIEW_HASH_MISMATCH');
    assert.strictEqual(repo.state.writes, 0);

    const approved = await request(baseUrl, 'reviewer', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({ data: source, preview_hash: preview.body.content_hash, decision_basis: '归口部门确认内容来自本月绩效梳理' })
    });
    assert.strictEqual(approved.response.status, 201, JSON.stringify(approved.body));
    assert.strictEqual(approved.body.handoffs[0].status, 'pending_origin_review');
    const handoffId = approved.body.handoffs[0].id;
    const duplicate = await request(baseUrl, 'reviewer', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({ data: source, preview_hash: preview.body.content_hash, decision_basis: '重复提交' })
    });
    assert.strictEqual(duplicate.response.status, 200);
    assert.strictEqual(duplicate.body.idempotent, true);

    const originDecision = await request(baseUrl, 'reviewer', `/api/process-design/cross-dept-handoffs/${handoffId}/department-decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', decision_basis: '归口部门确认该前置输入真实存在' })
    });
    assert.strictEqual(originDecision.response.status, 200, JSON.stringify(originDecision.body));
    assert.strictEqual(originDecision.body.handoff.status, 'pending_counterparty_scope');
    const crossDepartmentOverreach = await request(baseUrl, 'reviewer', `/api/process-design/cross-dept-handoffs/${handoffId}/department-decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', decision_basis: '试图代替工程技术部决定' })
    });
    assert.strictEqual(crossDepartmentOverreach.response.status, 403);
    const counterpartyScope = await request(baseUrl, 'targetReviewer', `/api/process-design/cross-dept-handoffs/${handoffId}/department-decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', decision_basis: '工程技术部确认由本部门提供' })
    });
    assert.strictEqual(counterpartyScope.response.status, 200, JSON.stringify(counterpartyScope.body));
    assert.strictEqual(counterpartyScope.body.handoff.status, 'pending_counterparty_detail');
    const wrongDepartmentResponse = await request(baseUrl, 'contact', `/api/process-design/cross-dept-handoffs/${handoffId}/counterparty-response`, {
      method: 'PUT',
      body: JSON.stringify({
        counterparty_process_name: '工程月度绩效数据报送',
        counterparty_behavior_name: '提交绩效数据',
        completion_standard: '经部门审核后提交'
      })
    });
    assert.strictEqual(wrongDepartmentResponse.response.status, 403);
    const response = await request(baseUrl, 'targetContact', `/api/process-design/cross-dept-handoffs/${handoffId}/counterparty-response`, {
      method: 'PUT',
      body: JSON.stringify({
        counterparty_process_name: '工程月度绩效数据报送',
        counterparty_behavior_name: '提交绩效数据',
        completion_standard: '经部门审核后提交'
      })
    });
    assert.strictEqual(response.response.status, 200, JSON.stringify(response.body));
    assert.strictEqual(response.body.status, 'pending_counterparty_review');
    const counterpartyReview = await request(baseUrl, 'targetReviewer', `/api/process-design/cross-dept-handoffs/${handoffId}/department-decision`, {
      method: 'POST',
      body: JSON.stringify({ decision: 'approved', decision_basis: '外部门审核补充内容属实' })
    });
    assert.strictEqual(counterpartyReview.response.status, 200, JSON.stringify(counterpartyReview.body));
    assert.strictEqual(counterpartyReview.body.handoff.status, 'pending_structure_gate');
    const gate = await request(baseUrl, 'mdmLead', `/api/process-design/cross-dept-handoffs/${handoffId}/structure-gate`, {
      method: 'POST',
      body: JSON.stringify({ action: 'confirmed', note: '结构、双方决定和责任部门均已核验' })
    });
    assert.strictEqual(gate.response.status, 200, JSON.stringify(gate.body));
    assert.strictEqual(gate.body.status, 'confirmed');

    const unresolvedSource = createDocument({ unresolved: true, processRef: 'process_2' });
    const unresolvedPreview = await request(baseUrl, 'reviewer', '/api/process-design/import-structured-output/preview', {
      method: 'POST',
      body: JSON.stringify({ data: unresolvedSource })
    });
    const unresolvedApprove = await request(baseUrl, 'reviewer', '/api/process-design/import-structured-output/approve', {
      method: 'POST',
      body: JSON.stringify({
        data: unresolvedSource,
        preview_hash: unresolvedPreview.body.content_hash,
        decision_basis: '责任部门待MDM工作组分派'
      })
    });
    assert.strictEqual(unresolvedApprove.response.status, 201, JSON.stringify(unresolvedApprove.body));
    const unresolvedHandoffId = unresolvedApprove.body.handoffs[0].id;
    assert.strictEqual(unresolvedApprove.body.handoffs[0].status, 'pending_assignment');
    const assigned = await request(baseUrl, 'mdmLead', `/api/process-design/cross-dept-handoffs/${unresolvedHandoffId}/assign-counterparty`, {
      method: 'POST',
      body: JSON.stringify({ department_id: 2 })
    });
    assert.strictEqual(assigned.response.status, 200, JSON.stringify(assigned.body));
    assert.strictEqual(assigned.body.status, 'pending_origin_review');

    const routeSource = require('fs').readFileSync(require('path').join(__dirname, '../server/routes/processDesignMysql.js'), 'utf8');
    assert.ok(routeSource.includes("handoff.status NOT IN ('confirmed','closed_not_required')"), 'publish gate must block unfinished current handoffs');
    console.log('Process governance v2 API tests passed');
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
