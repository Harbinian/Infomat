// Isolated HTTP regression: no real database, credentials or running service.
const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { syntheticSession, validateSyntheticSession } = require('./testHelpers/syntheticSession');
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
const auth = require('../server/auth');
const router = require('../server/routes/processDesignMysql');
let writes = 0;
const drafts = new Map([['1', { id: 1, schema_version: 'process-governance-v3', department_id: 1 }],
  ['2', { id: 2, schema_version: 'process-governance-v7', department_id: 1 }]]);
const original = JSON.stringify([...drafts]);
auth.setIdentityRepositoryFactory(async () => ({
  validateSession: validateSyntheticSession,
  async getUserEffectivePermissions() { return { permSet: new Set(['governance:read-global', 'governance:submit-department', 'governance:publish']), fieldConstraints: {} }; },
  async getUserRoleCodes() { return [{ code: 'mdm_lead' }]; }
}));
router.setProcessDesignRepositoryFactory(async () => ({
  async getDraft(id) { return drafts.get(String(id)); },
  async getReviewTask() { return { draft_id: 1 }; },
  async canonicalContent(draft) { return { document: { schema_version: draft.schema_version }, revision: 1 }; },
  async submitDraft() { writes++; }, async decideReviewTask() { writes++; }, async publishDraft() { writes++; }
}));
const app = express();
app.use(express.json());
app.use((req, res, next) => { req.session = req.get('X-Test-Anonymous') ? {} : syntheticSession({ personId: 1, userId: 1, departmentId: 1 }); next(); });
app.use('/api/process-design', router);
app.use(express.static(path.resolve(__dirname, '../public')));
(async () => {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const [method, url] of [['GET', '/api/process-design/editor/schema'], ['GET', '/process-governance-editor/index.html'],
      ['POST', '/api/process-design/import-structured-output'], ['POST', '/api/process-design/import-structured-output/preview'],
      ['POST', '/api/process-design/import-structured-output/approve'], ['POST', '/api/process-design/drafts/canonical'],
      ['POST', '/api/process-design/drafts'], ['PUT', '/api/process-design/drafts/1/content'],
      ['GET', '/api/process-design/cross-dept-handoffs'], ['GET', '/api/process-design/handoff-conflicts']]) {
      const response = await fetch(base + url, { method });
      assert.equal(response.status, 404, method + ' ' + url);
    }
    for (const [method, url] of [['GET', '/drafts/1/content'], ['GET', '/drafts/1/export'], ['POST', '/drafts/1/submit'],
      ['POST', '/review-tasks/1/decision'], ['POST', '/drafts/1/publish']]) {
      const response = await fetch(base + '/api/process-design' + url, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.equal(response.status, 410, method + ' ' + url);
      assert.equal((await response.json()).code, 'LEGACY_PROCESS_RETIRED');
    }
    assert.equal(writes, 0, 'retired drafts must never enter write repositories');
    assert.equal(JSON.stringify([...drafts]), original, 'retirement must preserve historical content');
    const retained = await fetch(base + '/api/process-design/drafts/2/content');
    assert.equal(retained.status, 200);
    assert.equal((await retained.json()).document.schema_version, 'process-governance-v7');
    const anonymous = await fetch(base + '/api/process-design/drafts/2/content', { headers: { 'X-Test-Anonymous': '1' } });
    assert.equal(anonymous.status, 401);
    const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(script[1]);
    for (const id of ['pgNewProcessWorkspace', 'pgLegacyV3History', 'pgCanonicalJsonEditor', 'pgHandoffQueueSection', 'pgHandoffConflictSection']) assert.ok(!html.includes(`id="${id}"`));
    assert.ok(html.includes('id="pgV7PreviewSection"'));
    assert.ok(html.includes('id="pdgReconcileBtn"'));
    console.log('Retired capabilities HTTP regression passed; V7 read and authentication retained; zero historical writes');
  } finally {
    await new Promise(resolve => server.close(resolve));
    router.resetProcessDesignRepositoryFactory(); auth.resetIdentityRepositoryFactory();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
