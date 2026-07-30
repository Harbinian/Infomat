const assert = require('assert');
const express = require('express');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cleanupDb } = require('./testHelpers/isolatedDb');
const { groupReviewItemsForReview } = require('../server/processInputBaselineReviewRepository');

process.env.MDM_DB_QUIET = '1';

const reviewArtifactsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdm-input-baseline-review-api-'));
const reviewRunDir = path.join(reviewArtifactsDir, 'review-run-001');
const previousArtifactsDir = process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR = reviewArtifactsDir;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
const auth = require('../server/auth');

function writeReviewItemFixture() {
  fs.mkdirSync(reviewRunDir, { recursive: true });
  fs.writeFileSync(path.join(reviewRunDir, 'mapping_diff_items.json'), JSON.stringify([
    {
      id: 'IBR-MDM-001',
      stable_key: 'review-item-mdm-001',
      department: '工程技术部',
      document_name: '产品设计需求定义管理程序.docx',
      source_file: 'docs/norms/工程技术部业务资料/产品设计需求定义管理程序.docx',
      source_anchor: 'GLC120102 §5.2 P71',
      issue_type: '角色待确认',
      content: '审核人审核产品设计需求文件',
      mapping_location: '当前已确认流程映射未见同名受控覆盖',
      suggested_action: '回到原文确认角色是否定义充分。',
      definition_status: '原文定义不足',
      status: '待处理',
      owner: '工程技术部确认人'
    },
    {
      id: 'IBR-FIN-001',
      stable_key: 'review-item-fin-001',
      department: '财务部',
      document_name: '财务成本核算管理程序.docx',
      source_file: 'docs/norms/财务部业务资料/财务成本核算管理程序.docx',
      source_anchor: 'GLTX-CW-01 §8',
      issue_type: '归档要求可能没写清',
      content: '相关报表由财务部负责存档，保存年限30年。',
      mapping_location: '当前已确认流程映射未见归档要求',
      suggested_action: '确认归档对象和保存要求。',
      definition_status: '原文定义不足',
      status: '待处理',
      owner: '财务部确认人'
    }
  ], null, 2), 'utf8');
  fs.writeFileSync(path.join(reviewRunDir, 'chunks.jsonl'), `${JSON.stringify({
    chunk_id: 'eng-P0071',
    source_file: 'docs/norms/工程技术部业务资料/产品设计需求定义管理程序.docx',
    doc_no: 'GLC120102',
    clause: '5.2',
    paragraph_id: 'P71',
    raw_text: '审核人审核产品设计需求文件，工程技术部审核人复核设计更改记录。',
    evidence_status: 'needs_review',
    verification_status: 'unverified',
    allowed_downstream_use: 'review_only'
  })}\n`, 'utf8');
  fs.writeFileSync(path.join(reviewRunDir, 'embedding_manifest.json'), JSON.stringify({
    status: 'skipped',
    model: 'qwen3-embedding:latest'
  }, null, 2), 'utf8');
  fs.writeFileSync(path.join(reviewRunDir, 'mapping_diff_report.md'), '# 测试报告\n', 'utf8');
}

function createFakeRepository() {
  const state = {
    upsertedBundles: [],
    savedDecisions: [],
    bundles: new Map(),
    decisions: new Map()
  };
  function decisionKey(runId, stableKey) {
    return `${runId}\u0000${stableKey}`;
  }
  function applyDecision(runId, item) {
    const decision = state.decisions.get(decisionKey(runId, item.stable_key));
    if (!decision) return item;
    return {
      ...item,
      decision: decision.decision,
      decision_evidence_status: decision.evidence_status,
      issue_type: decision.issue_type,
      decision_definition_status: decision.definition_status,
      definition_status: decision.definition_status,
      normalized_note: decision.normalized_note,
      reviewer: decision.reviewer,
      reviewed_at: decision.reviewed_at,
      decision_updated_at: decision.updated_at
    };
  }
  return {
    state,
    async upsertBundle(bundle) {
      state.upsertedBundles.push(bundle);
      state.bundles.set(bundle.run.run_id, bundle);
    },
    async listRuns() {
      return [...state.bundles.values()].map(bundle => bundle.run);
    },
    async getReviewItems(runId, filters = {}) {
      const bundle = state.bundles.get(runId);
      let items = bundle ? bundle.items.map(item => applyDecision(runId, item)) : [];
      items = items.filter(item => {
        if (filters.dept && item.department !== String(filters.dept)) return false;
        if (filters.document && item.document_name !== String(filters.document)) return false;
        if (filters.type && item.issue_type !== String(filters.type)) return false;
        return true;
      });
      return {
        summary: { total: items.length },
        groups: groupReviewItemsForReview(items),
        items
      };
    },
    async saveDecision(runId, stableKey, payload) {
      const saved = {
        ...payload,
        reviewed_at: '2026-06-16 00:00:00',
        updated_at: '2026-06-16 00:00:00'
      };
      state.savedDecisions.push({ runId, stableKey, payload });
      state.decisions.set(decisionKey(runId, stableKey), saved);
      return saved;
    }
  };
}

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function main() {
  writeReviewItemFixture();

  const processGovernanceRouter = require('../server/routes/processGovernance');
  assert.strictEqual(
    typeof processGovernanceRouter.setInputBaselineReviewRepositoryFactory,
    'function',
    'input baseline review route should allow repository injection for route-level MySQL tests'
  );

  const fakeRepo = createFakeRepository();
  processGovernanceRouter.setInputBaselineReviewRepositoryFactory(() => fakeRepo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(personId) {
      const permissionsByPerson = {
        1: ['governance:read-department', 'governance:review-department', 'governance:record-department-decision'],
        2: ['identity:read', 'identity:manage-account', 'identity:assign-role', 'identity:read-audit', 'governance:read-global'],
        3: ['governance:read-global', 'governance:assign-work', 'governance:structure-gate', 'governance:publish']
      };
      return {
        permSet: new Set(permissionsByPerson[Number(personId)] || []),
        fieldConstraints: {}
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const rawDepartmentName = req.headers['x-test-department'] || 'engineering';
    const departmentNameMap = {
      engineering: '工程技术部',
      finance: '财务部',
      leadership: '公司领导'
    };
    const departmentName = departmentNameMap[rawDepartmentName] || rawDepartmentName;
    const userRole = req.headers['x-test-role'] || 'department_mdm_reviewer';
    const personId = userRole === 'admin' ? 2 : (userRole === 'mdm_lead' ? 3 : 1);
    req.session = {
      personId,
      userId: personId,
      userName: '系统管理员',
      userRole,
      roleCodes: [userRole],
      departmentId: departmentName === '财务部' ? 2 : 1,
      departmentName
    };
    next();
  });
  app.use('/api/process-governance', processGovernanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items/review-item-mdm-001/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'needs_correction',
        evidence_status: 'need_original_review',
        issue_type: 'role_definition_insufficient',
        definition_status: 'source_definition_insufficient',
        normalized_note: '审核人缺少部门前缀，应回源确认。',
        correction_note: '不得作为结构化字段保存',
        reviewer: '客户端传入人'
      })
    });
    const body = await res.json();

    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(fakeRepo.state.upsertedBundles.length, 1);
    assert.strictEqual(fakeRepo.state.savedDecisions.length, 1);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].run.run_id, 'review-run-001');
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].run.issue_count, 2);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].items[0].source_label.includes('内部锚点P71'), false);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].items[0].source_label.includes('原文位置待核对'), false);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].items[0].source_label.includes('第5.2条'), true);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].items[0].source_label.includes('第71页'), false);
    assert.strictEqual(fakeRepo.state.upsertedBundles[0].items[0].source_label.includes('段落P71'), false);

    assert.strictEqual(body.reviewItem.stable_key, 'review-item-mdm-001');
    assert.strictEqual(body.reviewItem.department, '工程技术部');
    assert.strictEqual(body.reviewItem.document_name, '产品设计需求定义管理程序.docx');
    assert.strictEqual(body.reviewItem.source_label.includes('内部锚点P71'), false);
    assert.strictEqual(body.reviewItem.source_label.includes('原文位置待核对'), false);
    assert.strictEqual(body.reviewItem.source_label.includes('第5.2条'), true);
    assert.strictEqual(body.reviewItem.source_label.includes('第71页'), false);
    assert.strictEqual(body.reviewItem.source_label.includes('段落P71'), false);

    assert.strictEqual(body.review.decision, 'needs_correction');
    assert.strictEqual(body.review.evidence_status, 'need_original_review');
    assert.strictEqual(body.review.issue_type, 'role_definition_insufficient');
    assert.strictEqual(body.review.definition_status, 'source_definition_insufficient');
    assert.strictEqual(body.review.normalized_note, '审核人缺少部门前缀，应回源确认。');
    assert.strictEqual(body.review.correction_note, undefined);
    assert.strictEqual(body.review.reviewer, '系统管理员');
    assert.strictEqual(body.review.reviewed_at, '2026-06-16 00:00:00');
    assert.strictEqual(body.review.updated_at, '2026-06-16 00:00:00');
    assert.strictEqual(fakeRepo.state.savedDecisions[0].payload.correction_note, undefined);
    assert.strictEqual(fakeRepo.state.savedDecisions[0].payload.reviewer, '系统管理员');

    const getRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items?dept=${encodeURIComponent('工程技术部')}`);
    const getBody = await getRes.json();
    assert.strictEqual(getRes.status, 200, JSON.stringify(getBody));
    assert.strictEqual(getBody.summary.total, 1);
    assert.strictEqual(getBody.items[0].stable_key, 'review-item-mdm-001');
    assert.strictEqual(getBody.items[0].decision, 'needs_correction');
    assert.strictEqual(getBody.items[0].issue_type, 'role_definition_insufficient');
    assert.strictEqual(getBody.items[0].definition_status, 'source_definition_insufficient');
    assert.strictEqual(getBody.items[0].normalized_note, '审核人缺少部门前缀，应回源确认。');
    assert.strictEqual(getBody.items[0].reviewer, '系统管理员');
    assert.strictEqual(getBody.items[0].reviewed_at, '2026-06-16 00:00:00');
    assert.strictEqual(getBody.items[0].decision_updated_at, '2026-06-16 00:00:00');
    const groupedReviewItem = getBody.groups[0].documents[0].types[0].reviewItems[0];
    assert.strictEqual(groupedReviewItem.stable_key, 'review-item-mdm-001');
    assert.strictEqual(groupedReviewItem.decision, 'needs_correction');
    assert.strictEqual(groupedReviewItem.definition_status, 'source_definition_insufficient');
    assert.strictEqual(groupedReviewItem.normalized_note, '审核人缺少部门前缀，应回源确认。');

    const runsRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs`);
    const runsBody = await runsRes.json();
    assert.strictEqual(runsRes.status, 200, JSON.stringify(runsBody));
    assert.strictEqual(runsBody.summary.total, 1, '本部门成员只能看到包含本部门待确认问题的运行');
    assert.strictEqual(runsBody.items[0].run_id, 'review-run-001');
    assert.strictEqual(runsBody.items[0].issue_count, 1, '本部门成员看到的运行计数应按本部门重算');

    const crossDeptListRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items?dept=${encodeURIComponent('财务部')}`);
    const crossDeptListBody = await crossDeptListRes.json();
    assert.strictEqual(crossDeptListRes.status, 200, JSON.stringify(crossDeptListBody));
    assert.strictEqual(crossDeptListBody.summary.total, 0, '本部门成员不能通过 dept 参数读取其他部门待确认问题');
    assert.deepStrictEqual(crossDeptListBody.items.map(item => item.department), []);

    const adminListRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items`, {
      headers: { 'x-test-role': 'admin', 'x-test-department': 'leadership' }
    });
    const adminListBody = await adminListRes.json();
    assert.strictEqual(adminListRes.status, 200, JSON.stringify(adminListBody));
    assert.strictEqual(adminListBody.summary.total, 2, '管理员不应被自身部门收窄，应能看到全部待确认问题');
    assert.deepStrictEqual(
      new Set(adminListBody.items.map(item => item.department)),
      new Set(['工程技术部', '财务部'])
    );

    const adminRunsRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs`, {
      headers: { 'x-test-role': 'admin', 'x-test-department': 'leadership' }
    });
    const adminRunsBody = await adminRunsRes.json();
    assert.strictEqual(adminRunsRes.status, 200, JSON.stringify(adminRunsBody));
    assert.strictEqual(adminRunsBody.summary.total, 1, '管理员应能看到全部运行');
    assert.strictEqual(adminRunsBody.items[0].issue_count, 2, '管理员运行计数应保留全量待确认数');

    const adminDeptListRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items?dept=${encodeURIComponent('财务部')}`, {
      headers: { 'x-test-role': 'admin', 'x-test-department': 'leadership' }
    });
    const adminDeptListBody = await adminDeptListRes.json();
    assert.strictEqual(adminDeptListRes.status, 200, JSON.stringify(adminDeptListBody));
    assert.strictEqual(adminDeptListBody.summary.total, 1, '管理员应能主动筛选任一部门待确认问题');
    assert.strictEqual(adminDeptListBody.items[0].department, '财务部');

    const crossDeptSaveRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items/review-item-fin-001/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: 'confirm_issue',
        evidence_status: 'source_verified',
        issue_type: 'missing_delivery',
        definition_status: 'source_definition_insufficient',
        normalized_note: '尝试跨部门保存。'
      })
    });
    const crossDeptSaveBody = await crossDeptSaveRes.json();
    assert.strictEqual(crossDeptSaveRes.status, 403, JSON.stringify(crossDeptSaveBody));
    assert.strictEqual(crossDeptSaveBody.error, '只能处理本部门待确认问题');

    const adminCrossDeptSaveRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items/review-item-fin-001/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'admin', 'x-test-department': 'leadership' },
      body: JSON.stringify({
        decision: 'confirm_issue',
        evidence_status: 'source_verified',
        issue_type: 'missing_delivery',
        definition_status: 'source_definition_insufficient',
        normalized_note: '管理员确认财务部问题。'
      })
    });
    const adminCrossDeptSaveBody = await adminCrossDeptSaveRes.json();
    assert.strictEqual(adminCrossDeptSaveRes.status, 403, JSON.stringify(adminCrossDeptSaveBody));
    assert.strictEqual(adminCrossDeptSaveBody.error, '无权复核流程输入问题');

    const leadCrossDeptSaveRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items/review-item-fin-001/review`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-test-role': 'mdm_lead', 'x-test-department': 'leadership' },
      body: JSON.stringify({
        decision: 'confirm_issue',
        evidence_status: 'source_verified',
        issue_type: 'missing_delivery',
        definition_status: 'source_definition_insufficient',
        normalized_note: 'MDM工作组组长完成结构与证据复核。'
      })
    });
    const leadCrossDeptSaveBody = await leadCrossDeptSaveRes.json();
    assert.strictEqual(leadCrossDeptSaveRes.status, 200, JSON.stringify(leadCrossDeptSaveBody));
    assert.strictEqual(leadCrossDeptSaveBody.reviewItem.department, '财务部');
    assert.strictEqual(leadCrossDeptSaveBody.review.reviewer, '系统管理员');

    processGovernanceRouter.setInputBaselineReviewRepositoryFactory(() => ({
      async listRuns() {
        return [];
      },
      async upsertBundle() {
        throw new Error('simulated input baseline review MySQL read-model failure');
      },
      async getReviewItems() {
        throw new Error('simulated input baseline review MySQL read-model failure');
      }
    }));
    const fallbackRes = await fetch(`${baseUrl}/api/process-governance/input-baseline-review/runs/review-run-001/review-items?dept=${encodeURIComponent('工程技术部')}`);
    const fallbackBody = await fallbackRes.json();
    assert.strictEqual(fallbackRes.status, 200, JSON.stringify(fallbackBody));
    assert.strictEqual(fallbackBody.summary.total, 1, '输入基线问题复核 MySQL 读模型失败时，存在 artifact 的只读列表应回退并继续按部门收口');
    assert.strictEqual(fallbackBody.items[0].department, '工程技术部');

    console.log('Process input baseline review API route test passed');
  } finally {
    await closeServer(server);
    processGovernanceRouter.resetInputBaselineReviewRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousArtifactsDir === undefined) {
    delete process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR;
  } else {
    process.env.PROCESS_INPUT_BASELINE_REVIEW_ARTIFACTS_DIR = previousArtifactsDir;
  }
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  fs.rmSync(reviewArtifactsDir, { recursive: true, force: true });
  cleanupDb({ ignoreErrors: true });
});
