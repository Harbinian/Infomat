// Route-only identity projection checks. Synthetic sessions/repositories; preload
// blockRealMysql. Random loopback HTTP is closed in finally. No credentials or DB IO.
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const { sessionSubject, sameIdentityInteger } = require('../server/sessionSubject');
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
process.env.PROCESS_DATA_GOVERNANCE_ENABLED = '1';
delete process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY;
const auth = require('../server/auth');
const governance = require('../server/routes/processDataGovernance');
const preview = require('../server/routes/processV7PreviewReview');
const publications = require('../server/routes/publications');
const P = '9007199254740993', A = '9007199254740995', V = '9007199254740997';
const identities = {
  person: { personId: P, accountId: A, authVersion: V, current_department_id: 91, roleCodes: ['mdm_lead'], permissions: ['governance:read-global', 'governance:assign-work', 'governance:structure-gate', 'governance:publish'] },
  system: { identityKind: 'system_admin', personId: null, accountId: '9007199254741011', authVersion: V, current_department_id: null, roleCodes: ['admin'], permissions: ['identity:read', 'identity:manage-account', 'governance:read-global'] },
  overlay: { personId: 14, accountId: 114, authVersion: 1, current_department_id: 91, roleCodes: ['admin', 'mdm_lead'], permissions: ['identity:read', 'governance:read-global', 'governance:assign-work', 'governance:structure-gate', 'governance:publish'] },
  none: { personId: 15, accountId: 115, authVersion: 1, current_department_id: 91, roleCodes: ['mdm_lead'], permissions: [] }
};
const calls = [], actors = [];
function find(principal) { calls.push(principal); return Object.values(identities).find(identity => String(sessionSubject(identity).principal) === String(principal)); }
auth.setIdentityRepositoryFactory(() => ({
  async validateSession(session) { const user = Object.values(identities).find(user => sameIdentityInteger(user.accountId, session.accountId)); return { valid: !!user && sameIdentityInteger(user.authVersion, session.authVersion), user }; },
  async getUserEffectivePermissions(principal) { return { permSet: new Set(find(principal)?.permissions || []) }; },
  async getUserRoleCodes(principal) { return (find(principal)?.roleCodes || []).map(code => ({ code })); },
  async getDepartmentById(id) { assert.equal(id, 91); return { id: 91, name: 'B02 synthetic' }; }
}));
governance.setProcessDataGovernanceRepositoryFactory(() => ({ async queueAndMaterialize(id, actor) { actors.push(actor); return { id }; } }));
preview.setProcessV7PreviewRepositoryFactory(() => ({ async listCases(actor) { actors.push(actor); return { items: [], total: 0 }; } }));
publications.setRepositoryFactory(() => ({ async status() { return { ready: true }; }, async publish(input, actor) { actors.push(actor); return { id: 1, idempotent: false }; } }));
async function main() {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => {
    const identity = identities[req.get('x-test-identity') || 'person'];
    req.session = { ...identity, departmentId: identity.current_department_id, destroy(callback) { callback(); } };
    if (req.get('x-test-version')) req.session.authVersion = req.get('x-test-version');
    next();
  });
  app.use('/governance', governance); app.use('/preview', preview); app.use('/publications', publications);
  const server = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  async function request(url, identity, body, version) {
    const form = url === '/publications/publish'; let payload = body;
    if (form) { payload = new FormData(); payload.append('file', new Blob(['code,name\nA,synthetic\n']), 'synthetic.csv'); for (const [key, value] of Object.entries({ kind: 'master_data', title: 'B02 synthetic', keyHeader: 'code', datasetKey: 'b02', confirmed: 'true', requestId: crypto.randomUUID(), checked: '{}' })) payload.append(key, value); }
    const response = await fetch(base + url, { method: body || form ? 'POST' : 'GET', headers: { 'x-test-identity': identity, ...(version ? { 'x-test-version': version } : {}), ...(!form && body ? { 'Content-Type': 'application/json' } : {}) }, body: form ? payload : body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  }
  try {
    for (const [url, body] of [['/governance/creation-tasks/reconcile', { process_version_id: 1 }], ['/preview/cases'], ['/publications/publish']]) {
      const result = await request(url, 'person', body); assert([200, 201].includes(result.status), JSON.stringify(result));
      const actor = actors.at(-1); assert.equal(actor.personId, P); assert.equal(actor.accountId, A); assert.equal(actor.authVersion, V); assert.equal(sessionSubject(actor).kind, 'person');
    }
    for (const identity of ['system', 'overlay']) {
      const result = await request('/preview/cases', identity); assert.equal(result.status, 200);
      const actor = actors.at(-1); if (identity === 'system') { assert.equal(actor.personId, null); assert.equal(actor.userId, null); assert.equal(sessionSubject(actor).principal, 'system-admin:9007199254741011'); }
      assert.equal((await request('/governance/creation-tasks/reconcile', identity, { process_version_id: 1 })).body.code, 'PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY');
      assert.equal((await request('/preview/cases', identity, { document: {} })).body.code, 'V7_PREVIEW_ADMIN_READ_ONLY');
      assert.equal((await request('/publications/publish', identity)).body.code, 'PUBLICATION_ACCESS_DENIED');
    }
    assert(calls.includes('system-admin:9007199254741011')); assert(calls.includes(P));
    for (const [url, body] of [['/governance/creation-tasks/reconcile', { process_version_id: 1 }], ['/preview/cases'], ['/publications/publish']]) assert.equal((await request(url, 'none', body)).status, 403);
    const saved = identities.person.permissions; identities.person.permissions = [];
    try { assert.equal((await request('/governance/creation-tasks/reconcile', 'person', { process_version_id: 1 })).status, 403); } finally { identities.person.permissions = saved; }
    for (const [url, body] of [['/governance/creation-tasks/reconcile', { process_version_id: 1 }], ['/preview/cases'], ['/publications/publish']]) assert.equal((await request(url, 'person', body, '9007199254740996')).body.code, 'SESSION_AUTHORIZATION_CHANGED');
    console.log('B02_ROUTE_SUBJECTS_PASS: three exact projections, typed admin, overlay, live deny, changed authVersion');
  } finally {
    await new Promise(resolve => server.close(resolve));
    auth.resetIdentityRepositoryFactory(); governance.resetProcessDataGovernanceRepositoryFactory(); preview.resetProcessV7PreviewRepositoryFactory(); publications.setRepositoryFactory(null);
    console.log('B02_ROUTE_OWNED_HTTP_STOPPED');
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
