// Owned candidate only. Input: --frontend-dist <built artifacts directory> and
// --output <new artifacts evidence directory>; --serve keeps the fixture alive.
// Creates a fresh labelled tmpfs MySQL container with synthetic identities and
// explicitly prepares authoring schema there. Binds HTTP only to a random
// 127.0.0.1 port. Reads no private configuration or existing database; never
// operates formal ports 3000/3001. Writes synthetic evidence below --output.
// A real /api/ready HTTP 200 with ready:true is required before any candidate
// action. /api/health alone is only HTTP liveness and never readiness evidence.
// Enter, SIGINT, SIGTERM or the recorded stop file stops this owned fixture;
// its database is temporary and is removed by the ownership-checked helper.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');

const artifacts = path.resolve(__dirname, '../../../artifacts');
function syntheticDocument() {
  // Use a pure synthetic shape. Requiring the standalone 3001 HTTP server would
  // couple this candidate launcher to that service's installed dependencies.
  return require('./testHelpers/processAuthoringWorkspaceFixture').document();
}
function syntheticSubmission() {
  return {
    sources: [{ reference: 'synthetic:candidate:source', title: '合成候选检查材料', basis: '仅用于本机功能检查，不构成真实业务依据。' }],
    purpose: '检查3000内编制、保存、JSON对话编辑与提交衔接。', revision_reason: '合成候选新编', change_summary: '仅使用合成事实展示编制闭环。',
    participants: ['91', '92'].map(department_id => ({ department_id, behavior_refs: [], responsibilities: '合成部门核对本部门参与事项。', basis: '明确的合成演示参与范围。' }))
  };
}
function artifactPath(value, label) {
  assert.equal(typeof value, 'string', label + ' is required');
  const resolved = path.resolve(value);
  assert(resolved.startsWith(artifacts + path.sep), label + ' must be below repository artifacts');
  return resolved;
}
function candidateOptions({ frontendDist, evidenceDir, ...extra }) {
  const dist = artifactPath(frontendDist, 'frontendDist');
  const output = artifactPath(evidenceDir, 'evidenceDir');
  assert(fs.statSync(path.join(dist, 'index.html')).isFile(), 'candidate frontend index.html is required');
  assert(!fs.existsSync(output), 'use a new evidence directory; previous evidence is preserved');
  fs.mkdirSync(output, { recursive: true });
  return {
    ...extra,
    frontendDist: dist,
    evidenceDir: output,
    randomDatabase: true,
    departmentAccountability: true,
    completeSource: true,
    authoring: true,
    authoringWorkspace: true,
    createDocument: syntheticDocument,
    document: syntheticDocument(),
    beforeStart: async target => {
      // These are wholly synthetic fixture facts, never inferred business data.
      target.document.process.entry_behavior_refs = [target.document.behaviors[0].behavior_ref];
      if (extra.beforeStart) await extra.beforeStart(target);
    }
  };
}
async function withProcessAuthoringCandidate(action, options) {
  return withStage05Fixture(async context => {
    const response = await fetch(context.fixture.baseURL + '/api/ready', { signal: AbortSignal.timeout(10000) });
    const body = await response.json();
    const applicationReadiness = { http_status: response.status, body, checked_at: new Date().toISOString(), endpoint: '/api/ready' };
    fs.writeFileSync(path.join(context.fixture.evidenceDir, 'application-readiness.json'), JSON.stringify(applicationReadiness, null, 2) + '\n');
    assert.equal(response.status, 200, 'owned candidate /api/ready must return HTTP 200');
    assert.equal(body.ready, true, 'owned candidate must pass the complete application readiness contract');
    return action({ ...context, applicationReadiness });
  }, candidateOptions(options));
}
function argument(name) {
  const index = process.argv.indexOf(name);
  assert(index > 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--'), name + ' is required');
  return process.argv[index + 1];
}
async function main() {
  if (process.argv.includes('--help')) {
    console.log('node scripts/serve-process-authoring-candidate.js --frontend-dist <artifacts build> --output <new artifacts evidence> [--serve]');
    return;
  }
  const frontendDist = argument('--frontend-dist');
  const evidenceDir = argument('--output');
  await withProcessAuthoringCandidate(async ({ fixture, expect, owner, applicationReadiness }) => {
    const healthResponse = await fetch(fixture.baseURL + '/api/health');
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    await expect('contact', '/api/process-authoring/drafts', 'GET');
    let sample = await expect('contact', '/api/process-authoring/drafts', 'POST', {
      request_id: crypto.randomUUID(), document: fixture.document, submission: syntheticSubmission()
    }, 201);
    const checkedDocument = structuredClone(fixture.document);
    checkedDocument.process.scope += ' 本候选使用合成数据检查草稿保存与读取。';
    sample = await expect('contact', '/api/process-authoring/drafts/' + sample.draft.id, 'PUT', {
      request_id: crypto.randomUUID(), expected_revision_no: sample.draft.revision_no, expected_content_hash: sample.draft.content_hash,
      document: checkedDocument, submission: syntheticSubmission()
    });
    const reopened = await expect('contact', '/api/process-authoring/drafts/' + sample.draft.id, 'GET');
    assert.deepEqual(reopened.draft.document, checkedDocument, 'candidate draft save must survive a fresh server read');
    assert.deepEqual(reopened.draft.submission, syntheticSubmission(), 'candidate materials must survive a fresh server read');
    const pageResponse = await fetch(fixture.baseURL + '/app/process-authoring');
    assert.equal(pageResponse.status, 200);
    assert.match(pageResponse.headers.get('content-type') || '', /text\/html/);
    const stopFile = path.join(fixture.evidenceDir, 'stop-' + owner);
    const candidate = {
      synthetic_only: true,
      temporary_database: true,
      authoring_workspace_enabled: true,
      formal_services_changed: false,
      base_url: fixture.baseURL,
      entry_url: fixture.baseURL + '/app/process-authoring?draft=' + sample.draft.id,
      synthetic_sample_draft_id: sample.draft.id,
      draft_read_write_verified: true,
      login_name: 'SYNTHETIC_contact',
      synthetic_password: fixture.loginPassword,
      other_synthetic_logins: fixture.actors.map(name => 'SYNTHETIC_' + name),
      stop_file: stopFile,
      frontend_dist: path.resolve(frontendDist),
      frontend_index_sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(frontendDist, 'index.html'))).digest('hex'),
      health,
      application_readiness: applicationReadiness,
      note: '仅供本机功能检查；全部数据和身份为合成夹具。停止候选后临时数据库删除，需保留内容请先下载JSON。'
    };
    fs.writeFileSync(path.join(fixture.evidenceDir, 'candidate.json'), JSON.stringify(candidate, null, 2) + '\n');
    console.log('PROCESS_AUTHORING_CANDIDATE_READY ' + candidate.entry_url);
    console.log('SYNTHETIC_LOGIN ' + candidate.login_name + ' / ' + candidate.synthetic_password);
    if (!process.argv.includes('--serve')) return;
    console.log('OWNED_CANDIDATE_STOP_FILE ' + stopFile);
    await new Promise(resolve => {
      let stopped = false;
      const stop = () => {
        if (stopped) return;
        stopped = true;
        clearInterval(timer);
        process.off('SIGINT', stop);
        process.off('SIGTERM', stop);
        process.stdin.off('data', stop);
        process.stdin.pause();
        resolve();
      };
      const timer = setInterval(() => { if (fs.existsSync(stopFile)) stop(); }, 500);
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
      if (process.stdin.isTTY) { process.stdin.resume(); process.stdin.once('data', stop); }
    });
    if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
  }, { frontendDist, evidenceDir });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { artifactPath, candidateOptions, syntheticDocument, syntheticSubmission, withProcessAuthoringCandidate };
