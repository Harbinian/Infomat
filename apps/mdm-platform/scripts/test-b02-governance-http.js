// Owned V8/V7 HTTP regression through the existing stage05 fixture. --output must
// be new under artifacts. Synthetic rows only; owned HTTP/MySQL cleaned by fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const index = process.argv.indexOf('--output');
const output = index < 0 ? null : path.resolve(process.argv[index + 1] || '');
assert(output && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
async function main() {
  const results = [];
  for (const format of ['process-governance-v8', 'process-governance-v7']) {
    const evidenceDir = path.join(output, format); let target;
    await withStage05Fixture(async ({ pool, owner, fixture, expect }) => {
      target = { owner, format, stage: '04' };
      fs.writeFileSync(path.join(evidenceDir, 'owner.json'), JSON.stringify(target, null, 2));
      const checks = await require('./stage05-workbench-scenario')({ pool, fixture, expect });
      const [[source]] = await pool.query('SELECT id,schema_version,content_hash,process_content_json FROM process_design_versions ORDER BY id LIMIT 1');
      assert.equal(source.schema_version, format);
      const prefix = '/api/process-data-governance';
      for (const actor of ['admin', 'adminMulti', 'contact']) await expect(actor, prefix + '/creation-tasks/reconcile', 'POST', { process_version_id: source.id }, 403);
      let work = (await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id: source.id }, 201)).package;
      const repeated = await expect('lead', prefix + '/creation-tasks/reconcile', 'POST', { process_version_id: source.id }, 201); assert.equal(repeated.package.id, work.id); assert(repeated.idempotent);
      work = (await expect('lead', `${prefix}/work-packages/${work.id}/generate-candidates`, 'POST', { expected_revision: work.revision_no })).package;
      const read = () => expect('lead', `${prefix}/work-packages/${work.id}`, 'GET');
      let detail = await read(); assert.equal(detail.source_version.schema_version, format); assert.equal(detail.source_version.content_hash, source.content_hash);
      const fact = await expect('lead', `${prefix}/work-packages/${work.id}/fact-requests`, 'POST', { expected_revision: work.revision_no, detail_id: detail.details[0].id, target_department_id: 91, requested_fact_type: 'process_fact', question_text: 'B02 synthetic question', request_reason: 'B02 synthetic reason' }, 201);
      await expect('reviewB', `${prefix}/fact-requests/${fact.fact_request.id}/respond`, 'POST', { expected_revision: fact.package.revision_no, answer_text: 'cross-department synthetic' }, 403);
      const answer = await expect('contact', `${prefix}/fact-requests/${fact.fact_request.id}/respond`, 'POST', { expected_revision: fact.package.revision_no, answer_text: 'B02 synthetic answer', evidence_ref: 'B02 synthetic evidence' });
      work = (await expect('lead', `${prefix}/fact-requests/${fact.fact_request.id}/close`, 'POST', { expected_revision: answer.package.revision_no, basis: 'B02 synthetic close' })).package;
      detail = await read();
      for (const item of detail.details) work = (await expect('lead', `${prefix}/work-packages/${work.id}/details/${item.id}`, 'PATCH', { expected_revision: work.revision_no, status: 'not_applicable', governance: { basis: 'B02 synthetic basis' } })).package;
      await expect('adminMulti', `${prefix}/work-packages/${work.id}/complete`, 'POST', { expected_revision: work.revision_no, basis: 'B02 synthetic admin denied' }, 403);
      const completed = await expect('lead', `${prefix}/work-packages/${work.id}/complete`, 'POST', { expected_revision: work.revision_no, basis: 'B02 synthetic review' }); assert.equal(completed.package.status, 'completed');
      const final = await read(); assert.equal(final.source_version.content_hash, source.content_hash);
      const [[retained]] = await pool.query('SELECT process_content_json,content_hash FROM process_design_versions WHERE id=?', [source.id]); assert.deepEqual(retained, { process_content_json: source.process_content_json, content_hash: source.content_hash });
      results.push({ format, passed: true, formalChecks: checks, workPackage: work.id, exactSourcePreserved: true, allGovernanceHttpWrites: true });
      console.log('PASS B02 full formal and work-package HTTP ' + format);
    }, { evidenceDir, randomDatabase: true, processDataGovernanceVersionId: 1, createDocument() { const document = require('../../structured-output-service/server').createEmptyProcessGovernanceV7Document(); document.schema_version = format; return document; } });
    fs.writeFileSync(path.join(evidenceDir, 'cleanup.json'), JSON.stringify({ ...target, removed: true, httpStopped: true }, null, 2));
  }
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, results }, null, 2));
}
main().catch(error => { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ code: error.code, message: error.message, stack: error.stack }, null, 2)); console.error(error.stack); process.exitCode = 1; });
