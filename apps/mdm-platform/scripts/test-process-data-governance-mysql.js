// Owned tmpfs MySQL and synthetic identities only; no live service or private configuration.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { digest } = require('../server/processDataGovernance');
const prefix = '/api/process-data-governance';

async function publishAnotherProcess({ fixture, expect }) {
  const document = structuredClone(fixture.document);
  document.process.process_ref = 'process_stage05_independent';
  document.process.process_name = '合成独立流程';
  document.export_meta.package_ref = 'package_stage05_independent';
  let detail = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document, source_file_name:'independent-process.json' }, 201);
  const caseId = detail.case.id;
  const binding = { expected_revision_no:detail.case.current_revision_no, expected_content_hash:detail.case.current_content_hash };
  await expect('outsider', '/api/process-v7-preview/cases/' + caseId, 'GET', undefined, 403);
  await expect('admin', '/api/process-v7-preview/items/' + detail.items[0].id + '/decision', 'POST', { ...binding, decision:'confirmed', basis:'合成管理员越权检查' }, 403);
  const original = await expect('lead', '/api/process-v7-preview/cases/1', 'GET');
  const wrongRevision = await expect('contact', '/api/process-v7-preview/cases/1/revisions', 'POST', {
    document, source_file_name:'wrong-case.json', expected_revision_no:original.case.current_revision_no,
    expected_content_hash:original.case.current_content_hash
  }, 422);
  assert.equal(wrongRevision.code, 'V7_PREVIEW_PROCESS_REF_MISMATCH');
  for (const who of ['reviewA','reviewB']) for (const item of detail.items) {
    await expect(who, '/api/process-v7-preview/items/' + item.id + '/decision', 'POST', { ...binding, decision:'confirmed', basis:'合成独立流程核对依据' });
  }
  const target = { mode:'create', document_no:'STAGE05-INDEPENDENT', document_title:document.process.process_name };
  await expect('contact', '/api/process-v7-preview/cases/' + caseId + '/promote', 'POST', { ...binding, target }, 403);
  const promoted = await expect('lead', '/api/process-v7-preview/cases/' + caseId + '/promote', 'POST', { ...binding, target }, 201);
  const formal = { expected_revision_no:promoted.draft.revision_no, expected_content_hash:promoted.draft.content_hash };
  const submitted = await expect('contact', '/api/process-design/drafts/' + promoted.draft.id + '/submit', 'POST', formal);
  await expect('reviewB', '/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision', 'POST', { ...formal, decision:'approve', note:'合成跨部门正式审核拒绝检查' }, 403);
  await expect('reviewA', '/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision', 'POST', { ...formal, decision:'approve', note:'合成独立流程正式审核依据' });
  const published = await expect('lead', '/api/process-design/drafts/' + promoted.draft.id + '/publish', 'POST', formal);
  const readback = await expect('contact', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
  assert.equal(readback.content_hash_verified, true);
  assert.deepEqual(readback.document, document);
  const workbench = await expect('lead', prefix + '/workbench', 'GET');
  const newVersion = workbench.published_versions.find(v => v.process_version_id === published.process_version_id);
  assert.ok(newVersion);
  assert.equal(newVersion.work_package_id, null, 'newly published independent process waits for manual work package creation');
  console.log('Independent V7 process complete HTTP flow passed: upload, both departments, promote, submit, review, publish and immutable readback');
  return { caseId, processVersionId:published.process_version_id };
}

async function checks(context) {
  const { pool, fixture, expect } = context;
  await require('./stage05-workbench-scenario')({ fixture, expect });
  const [[source]] = await pool.query('SELECT * FROM process_design_versions ORDER BY id LIMIT 1');
  const [[counts]] = await pool.query('SELECT COUNT(*) total FROM process_data_governance_creation_tasks');
  assert.equal(Number(counts.total), 0, 'publication never creates governance work automatically');
  const original = JSON.parse(source.process_content_json);
  async function clone(edition, schema, document, status = 'published') {
    const [result] = await pool.execute(`INSERT INTO process_design_versions
      (draft_id,document_id,document_no,document_title,edition,version_no,department_id,
       schema_version,process_content_json,content_hash,source_revision_no,status)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, [source.draft_id, source.document_id, source.document_no,
      document.process.process_name, edition, source.document_no + ':' + edition, source.department_id,
      schema, JSON.stringify(document), digest(document), source.source_revision_no, status]);
    return Number(result.insertId);
  }
  const revised = structuredClone(original);
  revised.process.process_name = '合成材料核对流程新版';
  revised.process.purpose = '只用于验证两个独立正式版本的工作包。';
  const secondId = await clone('B', 'process-governance-v7', revised);
  await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?", [source.id]);
  const nonV7Id = await clone('C', 'process-governance-v3', original);
  const mismatchedId = await clone('D', 'process-governance-v7', { ...original, schema_version:'process-governance-v3' });
  const retiredId = await clone('E', 'process-governance-v7', original, 'retired');
  const malformedId = await clone('F', 'process-governance-v7', original);
  await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?', ['invalid JSON', malformedId]);
  const versionIds = [Number(source.id), secondId];
  let workbench = await expect('lead', prefix + '/workbench', 'GET');
  assert.equal(workbench.feature.scope_mode, 'published_v7_versions');
  assert.equal(workbench.feature.configured_process_version_id, null);
  assert.deepEqual(workbench.published_versions.map(v => v.process_version_id).sort((a,b) => a-b), versionIds);
  assert.ok(workbench.published_versions.some(v => v.status === 'superseded'));
  assert.equal(workbench.work_packages.length, 0);
  const packages = [];
  for (const versionId of versionIds) {
    await expect('admin', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:versionId }, 403);
    await expect('contact', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:versionId }, 403);
    const created = await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:versionId }, 201);
    const repeated = await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:versionId }, 201);
    assert.equal(created.package.id, repeated.package.id);
    assert.equal(repeated.idempotent, true);
    assert.equal(created.package.process_version_id, versionId);
    packages.push(created.package);
  }
  assert.notEqual(packages[0].id, packages[1].id);
  assert.notEqual(packages[0].source_content_hash, packages[1].source_content_hash);
  for (const versionId of [nonV7Id, mismatchedId, retiredId, malformedId, 999999]) {
    await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:versionId }, 409);
  }
  workbench = await expect('lead', prefix + '/workbench', 'GET');
  assert.equal(workbench.work_packages.length, 2);
  assert.ok(workbench.published_versions.every(v => v.work_package_id));
  assert.equal((await expect('lead', prefix + '/workbench?process_version_id=' + secondId, 'GET')).work_packages.length, 1);
  assert.deepEqual((await expect('contact', prefix + '/workbench', 'GET')).published_versions, []);
  for (const workPackage of packages) {
    await expect('lead', prefix + '/work-packages/' + workPackage.id + '/generate-candidates', 'POST', { expected_revision:workPackage.revision_no });
  }
  const getPackage = id => expect('lead', prefix + '/work-packages/' + id, 'GET');
  const first = await getPackage(packages[0].id);
  const second = await getPackage(packages[1].id);
  assert.equal(first.source_version.content_hash, source.content_hash);
  assert.equal(second.source_version.content_hash, digest(revised));
  assert.notEqual(first.details[0].id, second.details[0].id);
  await expect('lead', prefix + '/work-packages/' + first.package.id + '/details/' + second.details[0].id, 'PATCH', {
    expected_revision:first.package.revision_no, status:'not_applicable', governance:{ basis:'合成跨包拒绝检查' }
  }, 404);
  for (const detail of [first, second]) {
    const requested = await expect('lead', prefix + '/work-packages/' + detail.package.id + '/fact-requests', 'POST', {
      expected_revision:detail.package.revision_no, detail_id:detail.details[0].id, target_department_id:91,
      requested_fact_type:'process_fact', question_text:'合成问题：该版本是否有需补充的数据事实？', request_reason:'合成多版本隔离检查'
    }, 201);
    await expect('reviewB', prefix + '/fact-requests/' + requested.fact_request.id + '/respond', 'POST', {
      expected_revision:requested.package.revision_no, answer_text:'越部门合成答复', evidence_ref:'合成依据'
    }, 403);
  }
  assert.equal((await expect('contact', prefix + '/workbench', 'GET')).fact_requests.length, 2);
  const roleWorkbench = await expect('contact', '/api/role-workbench', 'GET');
  assert.equal(roleWorkbench.workItems.filter(item => item.type === 'process_data_business_fact').length, 2);
  // Corruption and replacement must stop both new materialization and existing writes.
  await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?', [JSON.stringify(revised), source.id]);
  let failed = await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:source.id }, 409);
  assert.equal(failed.code, 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED');
  await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=?', [digest(revised), source.id]);
  failed = await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id:source.id }, 409);
  assert.equal(failed.code, 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED', 'valid replacement still cannot rebind an existing package');
  await expect('lead', prefix + '/work-packages/' + first.package.id + '/generate-candidates', 'POST', { expected_revision:first.package.revision_no + 1 }, 409);
  await pool.execute('UPDATE process_design_versions SET process_content_json=?,content_hash=? WHERE id=?', [source.process_content_json, source.content_hash, source.id]);
  assert.equal((await getPackage(first.package.id)).package.source_content_hash, source.content_hash);
  assert.equal((await getPackage(second.package.id)).package.source_content_hash, digest(revised));
  const independentProcess = await publishAnotherProcess(context);
  console.log('Published V7 multi-version MySQL/HTTP checks passed: independent packages, legacy configuration ignored, immutable sources, idempotency, role/department isolation');
  return { versionIds, packageIds:packages.map(p => p.id), independentProcess };
}

async function main() {
  await withStage05Fixture(async context => {
    const result = await checks(context);
    if (!process.argv.includes('--serve')) return;
    const stopFile = path.join(context.fixture.evidenceDir, 'stop-' + context.owner);
    fs.writeFileSync(path.join(context.fixture.evidenceDir, 'browser-fixture.json'), JSON.stringify({ ...result, baseURL:context.fixture.baseURL, stopFile }));
    console.log(JSON.stringify({ ...result, baseURL:context.fixture.baseURL, stopFile }));
    await new Promise(resolve => {
      const timer = setInterval(() => { if (fs.existsSync(stopFile)) { clearInterval(timer); resolve(); } }, 500);
      process.once('SIGINT', () => { clearInterval(timer); resolve(); });
    });
    if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  }, { processDataGovernanceVersionId:1, evidenceDir:path.resolve(__dirname, '../../../artifacts/mdm-data-governance-versions') });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
