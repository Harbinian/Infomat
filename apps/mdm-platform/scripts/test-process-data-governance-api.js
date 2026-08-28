const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
process.env.PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID = '77';

const router = require('../server/routes/processDataGovernance');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

const actors = {
  lead: {
    userId: 1, personId: 1, departmentId: 10, departmentName: '质量管理部',
    roleCode: 'mdm_lead', roleCodes: new Set(['mdm_lead']),
    permissions: new Set(['governance:read-global', 'governance:assign-work', 'governance:structure-gate', 'governance:publish']), canReadGlobal: true
  },
  contact: {
    userId: 2, personId: 2, departmentId: 10, departmentName: '质量管理部',
    roleCode: 'department_contact', roleCodes: new Set(['department_contact']),
    permissions: new Set(['governance:read-department', 'governance:draft-department']), canReadGlobal: false
  },
  otherContact: {
    userId: 3, personId: 3, departmentId: 11, departmentName: '工程技术部',
    roleCode: 'department_contact', roleCodes: new Set(['department_contact']),
    permissions: new Set(['governance:read-department', 'governance:draft-department']), canReadGlobal: false
  },
  admin: {
    userId: 4, personId: 4, departmentId: 10, departmentName: '质量管理部',
    roleCode: 'admin', roleCodes: new Set(['admin']),
    permissions: new Set(['governance:read-global']), canReadGlobal: true
  }
};

function packageDetail() {
  return {
    package: { id: 8, package_ref: 'pdg-package-v77', process_version_id: 77, process_name: '测试流程', status: 'mdm_governing', revision_no: 3 },
    source_version: { process_version_id: 77, immutable: true, process: { process_ref: 'process_test' } },
    details: [{ id: 81, work_package_id: 8, detail_ref: 'object:data_test', detail_type: 'data_object_identity', status: 'pending', source: { data_name: '测试记录' } }],
    fact_requests: [{ id: 91, work_package_id: 8, detail_id: 81, target_department_id: 10, status: 'open', question_text: '实际触发条件是什么？' }],
    reviews: [], events: []
  };
}

const calls = [];
const repository = {
  async listWorkPackages() { return [packageDetail().package]; },
  async listBusinessFactRequests(departmentId) {
    return Number(departmentId) === 10 ? [{
      id: 91, work_package_id: 8, detail_id: 81, target_department_id: 10, status: 'open',
      question_text: '实际触发条件是什么？', request_reason: '影响生命周期规则', process_version_id: 77,
      process_name: '测试流程', package_revision_no: 3
    }] : [];
  },
  async listWorkbenchItems(actor) {
    if (actor.roleCodes.has('mdm_lead')) return [{ id: 'package:8', type: 'process_data_governance_package', canAct: true }];
    if (Number(actor.departmentId) === 10) return [{ id: 'fact:91', type: 'process_data_business_fact', canAct: true }];
    return [];
  },
  async getWorkPackageDetail(id) { return Number(id) === 8 ? packageDetail() : null; },
  async getFactRequest(id) {
    if (Number(id) !== 91) return null;
    return { id: 91, work_package_id: 8, detail_id: 81, target_department_id: 10, process_version_id: 77, status: 'open', question_text: '实际触发条件是什么？' };
  },
  async getFactRequestContext(id) {
    if (Number(id) !== 91) return null;
    return {
      package: packageDetail().package,
      source_version: packageDetail().source_version,
      fact_request: {
        id: 91, work_package_id: 8, detail_id: 81, target_department_id: 10,
        process_version_id: 77, package_revision_no: 3, status: 'open', question_text: '实际触发条件是什么？'
      },
      source_context: {
        detail_id: 81, detail_ref: 'object:data_test', detail_type: 'data_object_identity', source: { data_name: '测试记录' }
      }
    };
  },
  async queueAndMaterialize(versionId) { calls.push(['reconcile', versionId]); return { package: packageDetail().package, idempotent: false }; },
  async generateCandidates(packageId, revision) { calls.push(['generate', packageId, revision]); return { package: packageDetail().package, created: 1, automatic_confirmation: false }; },
  async updateDetail(packageId, detailId, revision, body) { calls.push(['decision', packageId, detailId, revision, body.status]); return { package: packageDetail().package, detail: packageDetail().details[0] }; },
  async createFactRequest(packageId, revision) { calls.push(['request', packageId, revision]); return { package: packageDetail().package, fact_request: packageDetail().fact_requests[0] }; },
  async respondFactRequest(requestId, revision, body, actor) {
    if (Number(actor.departmentId) !== 10) {
      const error = new Error('department denied'); error.statusCode = 403; error.payload = { error: 'department denied', code: 'PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED' }; throw error;
    }
    calls.push(['respond', requestId, revision, body.answer_text]);
    return { package: packageDetail().package, fact_request: { ...packageDetail().fact_requests[0], status: 'answered' } };
  },
  async closeFactRequest(requestId, revision) { calls.push(['close', requestId, revision]); return { package: packageDetail().package, fact_request: { id: requestId, status: 'closed' } }; },
  async completeWorkPackage(packageId, revision) { calls.push(['complete', packageId, revision]); return { package: { ...packageDetail().package, status: 'completed' }, review: { decision: 'approved' } }; }
};

async function request(baseUrl, method, path, user, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Test-User': user },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  return { status: response.status, body: payload };
}

(async () => {
  router.setProcessDataGovernanceRepositoryFactory(() => repository);
  router.setProcessDataGovernanceActorFactory(req => actors[req.get('X-Test-User')] || actors.contact);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.session = { userId: 1, personId: 1, departmentId: 10 }; next(); });
  app.use('/api/process-data-governance', router);
  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    let result = await request(baseUrl, 'GET', '/api/process-data-governance/status', 'contact');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.enabled, true);
    assert.deepStrictEqual(result.body.responsibilities.business_department.cannot, ['认定主数据', '合并统一数据对象', '决定关键字段', '制定生命周期规则', '发布数据地图']);
    assert.strictEqual(result.body.responsibilities.automatic_processing.ai_used, false);

    result = await request(baseUrl, 'GET', '/api/process-data-governance/workbench', 'contact');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.work_packages.length, 0, 'business users must not receive the MDM package list');
    assert.strictEqual(result.body.fact_requests.length, 1);

    result = await request(baseUrl, 'GET', '/api/process-data-governance/work-packages/8', 'contact');
    assert.strictEqual(result.status, 403, 'business users must not read the full MDM package');

    result = await request(baseUrl, 'GET', '/api/process-data-governance/fact-requests/91', 'contact');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.source_context.detail_ref, 'object:data_test');
    assert.ok(!result.body.source_context.candidate, 'business fact context must not expose MDM decision payloads');

    result = await request(baseUrl, 'POST', '/api/process-data-governance/creation-tasks/reconcile', 'admin', { process_version_id: 77 });
    assert.strictEqual(result.status, 403, 'admin must remain read-only');

    result = await request(baseUrl, 'POST', '/api/process-data-governance/creation-tasks/reconcile', 'lead', { process_version_id: 78 });
    assert.strictEqual(result.status, 403, 'writes must be restricted to the exact configured process_version_id');

    result = await request(baseUrl, 'POST', '/api/process-data-governance/creation-tasks/reconcile', 'lead', { process_version_id: 77 });
    assert.strictEqual(result.status, 201);

    result = await request(baseUrl, 'PATCH', '/api/process-data-governance/work-packages/8/details/81', 'contact', { expected_revision: 3, status: 'confirmed', governance: { basis: 'x' } });
    assert.strictEqual(result.status, 403, 'department contact must not write MDM decisions');

    result = await request(baseUrl, 'POST', '/api/process-data-governance/fact-requests/91/respond', 'otherContact', { expected_revision: 3, answer_text: '其他部门答复' });
    assert.strictEqual(result.status, 403, 'other departments must not answer the targeted question');

    result = await request(baseUrl, 'POST', '/api/process-data-governance/fact-requests/91/respond', 'contact', { expected_revision: 3, answer_text: '经制度核对，满足条件后触发。' });
    assert.strictEqual(result.status, 200);

    result = await request(baseUrl, 'POST', '/api/process-data-governance/work-packages/8/complete', 'lead', { expected_revision: 3, basis: '全部核对完成' });
    assert.strictEqual(result.status, 200);
    assert.ok(calls.some(call => call[0] === 'complete'));

    process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '0';
    result = await request(baseUrl, 'GET', '/api/process-data-governance/status', 'lead');
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.enabled, false, 'status remains readable while the feature is disabled');
    result = await request(baseUrl, 'GET', '/api/process-data-governance/workbench', 'lead');
    assert.strictEqual(result.status, 503);
    assert.strictEqual(result.body.code, 'PROCESS_DATA_GOVERNANCE_DISABLED');
  } finally {
    process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
    router.resetProcessDataGovernanceRepositoryFactory();
    router.resetProcessDataGovernanceActorFactory();
    await closeServer(server);
  }
  console.log('Process data governance API responsibility tests passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
