// Pure identity/compatibility checks. Always preload blockRealMysql.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('../server/sessionSubject');
const { id, digest } = require('../server/dataMapDefinitionValues');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const at = process.argv.indexOf('--output'); assert(at > 0);
const output = path.resolve(process.argv[at + 1]); assert(!fs.existsSync(output)); fs.mkdirSync(output);
const run = path.dirname(output), manifest = JSON.parse(fs.readFileSync(path.join(run, 'source-baseline.json')));
const input = manifest.files.find(x => x.path.endsWith('/analysisIssueClosure.js'));
const baseline = fs.readFileSync(input.snapshot, 'utf8'), current = fs.readFileSync(require.resolve('../server/analysisIssueClosure'), 'utf8');
assert.equal(sha(Buffer.from(baseline)), input.sha256);
const checks = [];
function test(name, f) { f(); checks.push(name); console.log('PASS ' + name); }
try {
  test('real MySQL factories are blocked before any pure repository construction', () => {
    assert.throws(() => require('mysql2/promise').createPool({}), /ISOLATED_TEST_REAL_MYSQL_FORBIDDEN/);
  });
  test('person/system_admin/null/account/authVersion meaning stays exact', () => {
    for (const personId of [7, '7', '9007199254740992', '9007199254740993']) {
      const s = { identityKind: 'person', personId, accountId: '9007199254741301', authVersion: '9007199254741401' }, subject = sessionSubject(s);
      assert.equal(subject.kind, 'person'); assert.equal(subject.personId, personId); assert.equal(subject.accountId, s.accountId); assert.equal(subject.authVersion, s.authVersion); assert(Object.isFrozen(subject));
    }
    assert.deepEqual(sessionSubject({ identityKind: 'system_admin', personId: 7, accountId: '9007199254741301', authVersion: 1 }), { kind: 'system_admin', principal: 'system-admin:9007199254741301', personId: null, accountId: '9007199254741301', authVersion: 1 });
    assert.equal(sessionSubject(null).personId, null);
  });
  test('adjacent BIGINT string IDs cannot collide and rounded numbers are rejected', () => {
    assert.equal(identityInteger('9007199254740992'), '9007199254740992'); assert.equal(identityInteger('9007199254740993'), '9007199254740993');
    assert(!sameIdentityInteger('9007199254740992', '9007199254740993')); assert.equal(identityInteger(Number('9007199254740993')), null);
    assert.throws(() => id(Number('9007199254740993')), e => e.code === 'DEFINITION_ID_INVALID'); assert.equal(id(7), '7'); assert.equal(identityInteger('0007'), 7);
  });
  test('construction exposes both original public methods without IO or cached authority', () => {
    const repo = makeDataMapDefinitionRepository({ getConnection() { throw Error('unexpected IO during construction'); } });
    assert.equal(typeof repo.reviewAnalysisIssueTask, 'function'); assert.equal(typeof repo.getAnalysisIssueClosure, 'function');
  });
  test('current qualification changes do not alter historical identity bindings or digest inputs', () => {
    const sql = source => [...source.matchAll(/(?:INSERT INTO data_map_analysis_issue_closure_events|INSERT INTO process_governance_issue_events)[^\n]+/g)].map(m => m[0]);
    assert.deepEqual(sql(current), sql(baseline));
    assert(current.includes('account_id:String(user.accountId),auth_version:String(user.authVersion)'));
    assert(current.includes('departmentId:user.current_department_id==null?null:String(user.current_department_id)'));
  });
  test('protected dependencies routes and other consumers match input byte-for-byte', () => {
    const root = path.resolve(__dirname, '../../..');
    for (const f of manifest.files.filter(x => /apps\/mdm-platform\/server\//.test(x.path) && !x.path.endsWith('/analysisIssueClosure.js'))) assert.equal(sha(fs.readFileSync(path.join(root, f.path))), f.sha256, f.path);
  });
  test('historical canonical digest preserves null/unknown JSON/order and exact person strings', () => {
    const input = { actor_person_id: '9007199254740993', reviewer: { person_id: '9007199254740992', department: null }, previous_event_digest: null, unknown: { legacy: 'line\nbreak', ids: ['9007199254740992', '9007199254740993'] } };
    const clone = JSON.parse(JSON.stringify(input)); assert.equal(digest(input), digest(clone)); assert.notEqual(digest(input), digest({ ...input, actor_person_id: '9007199254740992' })); assert.deepEqual(input, clone);
  });
  fs.writeFileSync(path.join(output, 'validation.json'), JSON.stringify({ passed: true, checks, inputSha256: input.sha256, currentSha256: sha(Buffer.from(current)), mysqlBlocked: true, publicWriteProof: 'separate owned MySQL test', businessAcceptance: false }, null, 2) + '\n', { flag: 'wx' });
} catch (e) {
  fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ passed: false, checks, message: e.message, stack: e.stack }, null, 2) + '\n', { flag: 'wx' }); throw e;
} finally {
  fs.writeFileSync(path.join(output, 'loaded-dependencies.json'), JSON.stringify(Object.keys(require.cache).map(p => ({ path: p, sha256: sha(fs.readFileSync(p)) })), null, 2) + '\n', { flag: 'wx' });
}
