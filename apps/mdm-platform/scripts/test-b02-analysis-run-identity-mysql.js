// Owned synthetic public repository contract. No HTTP, worker, AI or runtime DDL.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cp = require('node:child_process'), net = require('node:net'), Module = require('node:module');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ROLE_GUIDES, ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const { json, digest, parse } = require('../server/dataMapDefinitionValues');
const schemas = ['dataMapDefinitionSchema', 'v7MappingSchema', 'designHandoffSchema', 'analysisRunSchema'];
const schemaModules = schemas.map(m => require('../server/' + m));
const queueSchema = require('../server/analysisQueueSchema');
const P = '9007199254740992', N = '9007199254740993', D = '9007199254741100', E = '9007199254741101';
const people = [
  { personId: 7, accountId: 107, authVersion: 1, role: 'mdm_lead' },
  { personId: 8, accountId: 108, authVersion: 1, role: 'mdm_lead' },
  { personId: 9, accountId: 109, authVersion: 1, role: 'admin' },
  { personId: 10, accountId: 110, authVersion: 1, role: 'admin', extra: 'mdm_lead' },
  { personId: 11, accountId: 111, authVersion: 1, role: 'department_contact', dept: '92' },
  { personId: 12, accountId: 112, authVersion: 1, role: 'department_contact' },
  { personId: 13, accountId: 113, authVersion: 1, role: null },
  { personId: P, accountId: '9007199254741300', authVersion: '9007199254741400', role: 'mdm_lead', dept: D },
  { personId: N, accountId: '9007199254741301', authVersion: '9007199254741401', role: 'mdm_lead', dept: E }
];
const session = value => { const p = people.find(p => String(p.personId) === String(value)); return { identityKind: 'person', personId: p.personId, userId: p.personId, accountId: p.accountId, authVersion: p.authVersion }; };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const errorValue = e => ({ code: e.code, statusCode: e.statusCode, message: e.message, name: e.name, errno: e.errno, sqlState: e.sqlState });
const at = process.argv.indexOf('--output'); assert(at > 0, '--output required');
const output = path.resolve(process.argv[at + 1]), run = path.dirname(output);
assert.match(path.basename(run), /^B02-\d+-[a-f0-9]+$/); assert(!fs.existsSync(output), 'evidence is append only'); fs.mkdirSync(output);
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'source-baseline.json')));
const input = manifest.files.find(f => f.path === 'apps/mdm-platform/server/analysisRuns.js');
assert.equal(sha(fs.readFileSync(input.snapshot)), input.sha256);
const filename = require.resolve('../server/analysisRuns'), archived = new Module(filename, module);
archived.filename = filename; archived.paths = Module._nodeModulePaths(path.dirname(filename)); archived._compile(fs.readFileSync(input.snapshot, 'utf8'), filename);
const checks = [], operations = [], negatives = [], waits = [], precision = [];
let target, active, fault, beforeCommit;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = () => crypto.randomUUID();
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  try {
    await withFreshMysql(async ctx => {
      const { pool, owner, database, containerId, port, backup, restore } = ctx;
      target = { owner, database, containerId, port, host: '127.0.0.1', stage: '02', image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);
      const ddl = new Map(splitSqlStatements(mdmMysqlSchemaSql()).map(s => [s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1], s]));
      for (const s of [...schemaModules.flatMap(m => m.statements()), ...queueSchema.statements()]) ddl.set(s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1], s);
      const created = new Set(), casts = new Map();
      async function create(t) {
        if (created.has(t)) return; assert(ddl.has(t), 'reviewed CREATE ' + t); created.add(t);
        const s = ddl.get(t); assert.match(s, /^CREATE TABLE IF NOT EXISTS /);
        for (const m of s.matchAll(/REFERENCES\s+(\w+)\s*\(/g)) if (m[1] !== t) await create(m[1]);
        await pool.query(s);
        const [cols] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','datetime','timestamp') ORDER BY ORDINAL_POSITION", [t]);
        casts.set(t, cols.map(c => 'CAST(`' + c.COLUMN_NAME + '` AS CHAR) AS `' + c.COLUMN_NAME + '`').join(','));
      }
      for (const t of [...require('../server/dataMapDefinitionMigration').baseTables, ...require('../server/analysisDependencyReadiness').identityTables, ...schemaModules.flatMap(m => m.tables), ...queueSchema.tables]) await create(t);
      save('reviewed-create-fixture.json', [...created].sort().map(t => ({ table: t, sql: ddl.get(t), sha256: sha(ddl.get(t)) })));
      for (const m of schemaModules) await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [m.MIGRATION_KEY]);
      for (const d of ['91', '92', D, E]) await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (CAST(? AS SIGNED),?,?,?)', [d, 'D' + d, 'synthetic ' + d, '/' + d + '/']);
      for (const r of ROLE_GUIDES) {
        await pool.execute('INSERT INTO roles(role_code,role_name,model_version,role_group) VALUES (?,?,?,?)', [r.code, r.name, ACCESS_MODEL_VERSION, r.code === 'admin' ? 'system' : 'mdm']);
        for (const p of r.permissions) {
          await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action) VALUES (?,?,?)', [p.code, p.resource, p.action]);
          await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?", [p.code, r.code]);
        }
      }
      for (const p of people) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))', [String(p.personId), 'P' + p.personId, 'synthetic ' + p.personId, p.dept || '91']);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?,'synthetic-unused','active',0,CAST(? AS SIGNED))", [String(p.accountId), String(p.personId), 'P' + p.personId, String(p.authVersion)]);
        for (const r of [p.role, p.extra].filter(Boolean)) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,CAST(? AS SIGNED),'synthetic B02',CURRENT_DATE FROM roles WHERE role_code=?", [String(p.personId), ['admin', 'mdm_lead'].includes(r) ? 'global' : 'department', ['admin', 'mdm_lead'].includes(r) ? null : p.dept || '91', r]);
      }
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (14,'P14','synthetic without account',91)");
      async function physical() {
        const value = {};
        for (const t of [...created].sort()) value[t] = (await pool.query('SELECT *' + (casts.get(t) ? ',' + casts.get(t) : '') + ' FROM `' + t + '` ORDER BY 1,2'))[0];
        return value;
      }
      const pinned = await pool.getConnection();
      const observed = { getConnection: async () => {
        const op = active; assert(op, 'public operation traced'); op.connectionId = pinned.threadId;
        const db = {};
        for (const method of ['execute', 'query']) db[method] = async (sql, params = []) => {
          assert(!/^(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql.trim()), 'consumer cannot execute DDL');
          const q = { method, sql, params, connectionId: pinned.threadId, completed: false }; op.trace.push(q);
          if (fault?.(sql, params)) throw Object.assign(new Error('B02_INJECTED_WRITE_FAILURE'), { code: 'B02_INJECTED_WRITE_FAILURE' });
          const result = await pinned[method](sql, params); q.completed = true; return result;
        };
        db.beginTransaction = async () => { op.trace.push({ event: 'begin' }); return pinned.beginTransaction(); };
        db.commit = async () => { if (beforeCommit) await beforeCommit(pinned, op); await pinned.commit(); op.trace.push({ event: 'commit' }); };
        db.rollback = async () => { await pinned.rollback(); op.trace.push({ event: 'rollback' }); };
        db.release = () => op.trace.push({ event: 'release', pinned: true }); return db;
      } };
      const repo = makeDataMapDefinitionRepository(observed), current = require.cache[filename].exports;
      let oldRepo; try { require.cache[filename].exports = archived.exports; oldRepo = makeDataMapDefinitionRepository(observed); } finally { require.cache[filename].exports = current; }
      async function call(label, method, args, repository = repo) {
        const op = { label, method, args, variant: repository === oldRepo ? 'input-baseline' : 'current', trace: [] }; active = op;
        try { op.result = await repository[method](...args); return op.result; }
        catch (e) { op.error = errorValue(e); throw e; }
        finally { operations.push(op); active = null; }
      }
      async function reject(label, method, args, code, status = 409) {
        const before = await physical(); await assert.rejects(call(label, method, args), e => { assert.equal(e.code, code); if (status !== null) assert.equal(e.statusCode, status); return true; });
        assert.deepEqual(await physical(), before, label + ' every physical row unchanged'); negatives.push({ label, method, code, status, physicalRollback: true });
      }
      const sources = [];
      const payload = (source = sources[0], extra = {}) => ({ request_id: uuid(), inputs: [{ input_key: 'source', kind: 'v7_source', ref_id: source.id }], check_scope: { description: 'synthetic identity contract', check_ids: ['references'] }, parser_versions: { native: 'synthetic-v1' }, rule_version: 'synthetic-v1', steps: [{ step_key: 'read', input_keys: ['source'], check_ids: ['references'], parser_key: 'native' }], ai_metadata: null, rerun_of_run_id: null, ...extra });
      const begin = r => ({ request_id: uuid(), run_id: r.run_id, expected_revision: r.revision_no, step_key: 'read' });
      const complete = (r, a, status = 'succeeded') => ({ request_id: uuid(), run_id: r.run_id, attempt_id: a.attempt_id, expected_revision: a.revision_no, status, checked_ids: status === 'succeeded' ? ['references'] : [], error_code: status === 'succeeded' ? null : 'SYNTHETIC_FAILURE', evidence: status === 'succeeded' ? [{ evidence_key: 'root', input_key: 'source', locator_kind: 'json_pointer', locator: '', note: 'synthetic' }] : [], findings: status === 'succeeded' ? [{ rule_id: 'references', finding_type: 'observation', message: 'synthetic', subject_input_keys: ['source'], semantic_locator: 'process:synthetic', evidence_keys: ['root'] }] : [] });
      const finish = (r, status, revision = r.revision_no) => ({ request_id: uuid(), run_id: r.run_id, expected_revision: revision, status });
      async function createRun(actor = 7, body = payload(), repository = repo) { return call('create-' + actor, 'createAnalysisRun', [session(actor), body], repository); }
      try {
        await check('reviewed native V8 and supported V7 source fixtures through public upload', async () => {
          for (const format of ['v8', 'v7']) {
            const document = JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-' + format + '.json')));
            const source = await call('source-' + format, 'registerV7Source', [session(7), { request_id: uuid(), source_kind: 'uploaded_material', original_name: 'synthetic-' + format + '.json' }, Buffer.from(JSON.stringify(document))]);
            assert.equal(source.validation_status, 'valid'); sources.push({ id: source.source_id, document, format });
          }
        });
        await check('small then adjacent BIGINT same execute connection full persisted write chain', async () => {
          for (const actor of [7, P, N]) {
            const s = session(actor), department = people.find(p => String(p.personId) === String(actor)).dept || '91';
            const body = payload(), r = await createRun(actor, body), a = await call('precision-begin-' + actor, 'beginAnalysisAttempt', [s, begin(r)]);
            const c = await call('precision-complete-' + actor, 'completeAnalysisAttempt', [s, complete(r, a)]);
            await call('precision-finish-' + actor, 'finishAnalysisRun', [s, finish(r, 'succeeded', c.revision_no)]);
            const cancelled = await createRun(actor), running = await call('precision-cancel-begin-' + actor, 'beginAnalysisAttempt', [s, begin(cancelled)]);
            await call('precision-cancel-' + actor, 'finishAnalysisRun', [s, finish(cancelled, 'cancelled', running.revision_no)]);
            const stored = await physical(), runRows = stored.data_map_analysis_runs.filter(x => [r.run_id, cancelled.run_id].includes(x.run_id));
            const attempts = stored.data_map_analysis_attempts.filter(x => [a.attempt_id, running.attempt_id].includes(x.attempt_id));
            const record = { actor: String(actor), department, connectionId: pinned.threadId, runRows, attempts, requests: stored.data_map_definition_requests.filter(x => x.actor_person_id === String(actor) && x.action.startsWith('analysis_')) };
            precision.push(record); save('precision-' + actor + '.json', record);
            assert.equal(runRows.length, 2); assert.equal(attempts.length, 2);
            for (const x of runRows) { assert.equal(x.created_by_person_id, String(actor)); assert.equal(x.scope_department_id, department); assert.equal(x.manifest_digest, digest(parse(x.manifest_json))); }
            for (const x of attempts) { assert.equal(x.actor_person_id, String(actor)); assert.equal(x.completed_by_person_id, String(actor)); }
            for (const x of record.requests) assert.equal(x.scope_department_id, department);
            assert.deepEqual(await createRun(actor, body), r); assert.deepEqual(await physical(), stored, 'create replay has no new writes');
            await reject('adjacent-account-' + actor, 'createAnalysisRun', [{ ...s, accountId: actor === N ? people[7].accountId : people[8].accountId }, payload()], 'DEFINITION_AUTH_REQUIRED', 401);
            await reject('adjacent-generation-' + actor, 'createAnalysisRun', [{ ...s, authVersion: actor === N ? people[7].authVersion : people[8].authVersion }, payload()], 'DEFINITION_AUTH_REQUIRED', 401);
            const loaded = await call('precision-read-' + actor, 'getAnalysisRun', [s, r.run_id]); assert.equal(loaded.created_by_person_id, String(actor)); assert.equal(loaded.scope_department_id, department);
            assert.deepEqual(await call('baseline-history-' + actor, 'getAnalysisRun', [s, r.run_id], oldRepo), loaded);
          }
        });
        const queued = await createRun(), running = await createRun(), a = await call('setup-begin', 'beginAnalysisAttempt', [session(7), begin(running)]);
        const done = await createRun(), da = await call('setup-done-begin', 'beginAnalysisAttempt', [session(7), begin(done)]);
        const dc = await call('setup-done-complete', 'completeAnalysisAttempt', [session(7), complete(done, da)]);
        const base = await physical(), dump = backup(); save('base-physical.json', base);
        async function reset() { restore(dump); assert.deepEqual(await physical(), base); }
        const entries = [
          ['createAnalysisRun', () => [session(7), payload()]],
          ['beginAnalysisAttempt', () => [session(7), begin(queued)]],
          ['completeAnalysisAttempt', () => [session(7), complete(running, a)]],
          ['finishAnalysisRun', () => [session(7), finish(done, 'succeeded', dc.revision_no)]],
          ['finishAnalysisRun', () => [session(7), finish(running, 'cancelled', a.revision_no)]]
        ];
        await check('person admin overlay system-admin no-auth no-grant and cross-department all public writers', async () => {
          for (const [method, args] of entries) for (const [label, actor, code, status] of [
            ['admin', session(9), 'DEFINITION_ACCESS_DENIED', 403], ['admin-plus-person', session(10), 'DEFINITION_ACCESS_DENIED', 403],
            ['system-admin', { identityKind: 'system_admin', personId: 7, accountId: 107, authVersion: 1 }, 'DEFINITION_AUTH_REQUIRED', 401],
            ['no-auth', {}, 'DEFINITION_AUTH_REQUIRED', 401], ['no-grant', session(13), 'DEFINITION_ACCESS_DENIED', 403],
            ['cross-department', session(11), 'DEFINITION_ACCESS_DENIED', 403]
          ]) { const values = args(); values[0] = actor; await reject(label + '-' + method + '-' + values[1].status, method, values, code, status); }
          for (const actor of [9, 10]) assert((await call('admin-read', 'getAnalysisRun', [session(actor), queued.run_id])).run_id === queued.run_id);
          await reject('cross-department-read', 'getAnalysisRun', [session(11), queued.run_id], 'DEFINITION_ACCESS_DENIED', 403);
          await reject('system-admin-read', 'getAnalysisRun', [{ identityKind: 'system_admin', accountId: 107, authVersion: 1 }, queued.run_id], 'DEFINITION_AUTH_REQUIRED', 401);
        });
        const mutations = [
          ['account-disabled', 'user_accounts', 'account_id', '107', { account_status: 'disabled' }, 'DEFINITION_AUTH_REQUIRED', 401],
          ['password-gate', 'user_accounts', 'account_id', '107', { must_change_password: 1 }, 'DEFINITION_AUTH_REQUIRED', 401],
          ['password-generation', 'user_accounts', 'account_id', '107', { password_hash: 'synthetic-changed', auth_version: '2' }, 'DEFINITION_AUTH_REQUIRED', 401],
          ['person-inactive', 'person', 'person_id', '7', { status: 'inactive' }, 'DEFINITION_AUTH_REQUIRED', 401],
          ['account-rebound', 'user_accounts', 'account_id', '107', { person_id: '14' }, 'DEFINITION_AUTH_REQUIRED', 401],
          ['department-cleared', 'person', 'person_id', '7', { current_department_id: null }, 'DEFINITION_DEPARTMENT_REQUIRED', 403],
          ['role-revoked', 'person_roles', 'person_role_id', base.person_roles.find(x => x.person_id === '7').person_role_id, { assignment_status: 'revoked' }, 'DEFINITION_ACCESS_DENIED', 403]
        ];
        async function change(db, table, key, value, fields) { return db.execute('UPDATE `' + table + '` SET ' + Object.keys(fields).map(k => '`' + k + '`=?').join(',') + ' WHERE `' + key + '`=CAST(? AS SIGNED)', [...Object.values(fields), value]); }
        await check('each write rechecks current account password person binding department and grant', async () => {
          for (const [label, table, key, value, fields, code, status] of mutations) for (const [method, args] of entries) {
            await change(pool, table, key, value, fields); await reject('current-' + label + '-' + method + '-' + args()[1].status, method, args(), code, status); await reset();
          }
          await change(pool, 'person', 'person_id', '7', { current_department_id: '92' });
          const moved = await createRun(); assert.equal((await call('moved-read', 'getAnalysisRun', [session(7), moved.run_id])).scope_department_id, '92');
          await reject('moved-request-replay', 'createAnalysisRun', [session(7), operations.find(o => o.label === 'create-7' && o.result?.run_id === queued.run_id).args[1]], 'DEFINITION_ACCESS_DENIED', 403); await reset();
        });
        async function lockChange(label, method, args, table, key, value, fields, code, status) {
          const before = await physical(), blocker = await pool.getConnection(); let pending;
          try {
            await blocker.beginTransaction(); await blocker.execute('SELECT `' + key + '` FROM `' + table + '` WHERE `' + key + '`=CAST(? AS SIGNED) FOR UPDATE', [value]);
            pending = call('lock-' + label, method, args()).then(result => ({ result }), error => ({ error })); let evidence;
            for (let i = 0; i < 200; i++) {
              const [locks] = await pool.execute('SELECT l.OBJECT_NAME object_name,l.LOCK_MODE lock_mode,t.PROCESSLIST_ID connection_id,b.PROCESSLIST_ID blocking_connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID JOIN performance_schema.threads b ON b.THREAD_ID=w.BLOCKING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [pinned.threadId]);
              if (locks.length) { evidence = locks; break; } await sleep(25);
            }
            assert(evidence, 'real data_lock_waits ' + label); await change(blocker, table, key, value, fields);
            const [[externalRow]] = await blocker.query('SELECT *' + (casts.get(table) ? ',' + casts.get(table) : '') + ' FROM `' + table + '` WHERE `' + key + '`=CAST(? AS SIGNED)', [value]);
            await blocker.commit();
            const outcome = await pending; assert.equal(outcome.error?.code, code); assert.equal(outcome.error?.statusCode, status);
            const expected = structuredClone(before), index = expected[table].findIndex(x => String(x[key]) === String(value)); assert(index >= 0); expected[table][index] = externalRow;
            assert.deepEqual(await physical(), expected, 'only external invalidation persists');
            waits.push({ label, method, table, key, value, fields, externalRow, evidence, actorConnectionId: pinned.threadId, blockerConnectionId: blocker.threadId, error: errorValue(outcome.error), physicalRollback: true });
          } finally { await blocker.rollback().catch(() => {}); blocker.release(); if (pending) await pending; await reset(); }
        }
        await check('all five write branches reject after actual identity lock waits', async () => {
          for (let i = 0; i < entries.length; i++) for (const [label, table, key, value, fields, code, status] of mutations.filter(x => x[0] !== 'department-cleared')) {
            const [method, args] = entries[i]; await lockChange(label + '-' + i, method, args, table, key, value, fields, code, status);
          }
        });
        await check('department scope changed during role lock wait is current for every write', async () => {
          const grant = base.person_roles.find(x => x.person_id === '12');
          for (let i = 0; i < entries.length; i++) {
            const [method, args] = entries[i], values = () => { const v = args(); v[0] = session(12); return v; };
            await lockChange('department-scope-' + i, method, values, 'person_roles', 'person_role_id', grant.person_role_id, { scope_department_id: '92' }, 'DEFINITION_ACCESS_DENIED', 403);
          }
        });
        await check('person department move after real person lock wait invalidates department-scoped writes', async () => {
          for (let i = 0; i < entries.length; i++) {
            const [method, args] = entries[i], values = () => { const v = args(); v[0] = session(12); return v; };
            await lockChange('person-department-moved-' + i, method, values, 'person', 'person_id', '12', { current_department_id: '92' }, 'DEFINITION_ACCESS_DENIED', 403);
          }
        });
        await check('native V8 and supported V7 v1 v2 v3 full manual chains retain body manifest outcome and coverage', async () => {
          const rules = require('../server/v7AnalysisRules'), checkIds = rules.CHECKS.slice(0, 2);
          for (const source of sources) for (const version of source.format === 'v8' ? [rules.VERSION] : [rules.LEGACY_VERSION, rules.PREVIOUS_VERSION, rules.VERSION]) {
            const body = payload(source, { check_scope: { description: 'synthetic native contract', check_ids: checkIds }, parser_versions: { [rules.PARSER]: version }, rule_version: version, steps: [{ step_key: 'read', input_keys: ['source'], check_ids: checkIds, parser_key: rules.PARSER }] });
            const r = await createRun(7, body), attempt = await call('native-begin-' + source.format + '-' + version, 'beginAnalysisAttempt', [session(7), begin(r)]);
            const c = await call('native-complete-' + source.format + '-' + version, 'completeAnalysisAttempt', [session(7), { ...complete(r, attempt), checked_ids: checkIds, findings: [] }]);
            await call('native-finish-' + source.format + '-' + version, 'finishAnalysisRun', [session(7), finish(r, 'succeeded', c.revision_no)]);
            const loaded = await call('native-read', 'getAnalysisRun', [session(7), r.run_id]);
            assert.deepEqual(await call('native-read-baseline', 'getAnalysisRun', [session(7), r.run_id], oldRepo), loaded);
            assert.equal(loaded.manifest.rule_version, version); assert.equal(loaded.manifest.inputs[0].snapshot.schema_version, source.document.schema_version); assert.deepEqual(loaded.coverage[0].missing, []);
            const stored = await physical(); assert.deepEqual(stored.data_map_v7_sources, base.data_map_v7_sources); save('native-' + source.format + '-' + version + '.json', { loaded, historicalConsumerEqual: true, fixedBodyUntouched: true }); await reset();
          }
          const body = payload(sources[0], { check_scope: { description: 'synthetic partial coverage', check_ids: checkIds }, parser_versions: { [rules.PARSER]: rules.VERSION }, rule_version: rules.VERSION, steps: [{ step_key: 'read', input_keys: ['source'], check_ids: checkIds, parser_key: rules.PARSER }] });
          const r = await createRun(7, body), attempt = await call('partial-begin', 'beginAnalysisAttempt', [session(7), begin(r)]);
          const c = await call('partial-complete', 'completeAnalysisAttempt', [session(7), { ...complete(r, attempt), status: 'partial', checked_ids: [checkIds[0]], error_code: 'SYNTHETIC_PARTIAL', findings: [] }]);
          assert.equal((await call('partial-finish', 'finishAnalysisRun', [session(7), finish(r, 'partial', c.revision_no)])).status, 'partial');
          const loaded = await call('partial-read', 'getAnalysisRun', [session(7), r.run_id]); assert.deepEqual(loaded.coverage[0].missing, [checkIds[1]]); assert.deepEqual(await call('partial-old-read', 'getAnalysisRun', [session(7), r.run_id], oldRepo), loaded); await reset();
          for (const [method, args] of entries) { const values = args(); values[0] = { ...session(N), personId: Number(N) }; await reject('rounded-person-' + method + '-' + values[1].status, method, values, 'DEFINITION_ID_INVALID', 400); }
        });
        await check('idempotency coverage failure retry cancel rerun and original errors keep every physical row', async () => {
          for (const [method, args] of entries) {
            const values = args(), result = await call('success-' + method + '-' + values[1].status, method, values), stored = await physical();
            assert.deepEqual(await call('replay-' + method, method, values), result); assert.deepEqual(await physical(), stored); await reset();
          }
          const b = begin(queued), ab = await call('begin-before-different-replay', 'beginAnalysisAttempt', [session(7), b]);
          await reject('different-replay', 'beginAnalysisAttempt', [session(7), { ...b, step_key: 'other' }], 'DEFINITION_IDEMPOTENCY_CONFLICT'); await reset();
          await reject('revision-before-state', 'beginAnalysisAttempt', [session(7), { ...begin(running), expected_revision: 99 }], 'DEFINITION_ANALYSIS_REVISION_CONFLICT');
          await reject('step-state', 'beginAnalysisAttempt', [session(7), { ...begin(running), expected_revision: a.revision_no }], 'DEFINITION_ANALYSIS_STEP_STATE_CONFLICT');
          await reject('attempt-state', 'completeAnalysisAttempt', [session(7), { ...complete(running, a), attempt_id: '999999' }], 'DEFINITION_ANALYSIS_ATTEMPT_STATE_CONFLICT');
          await reject('coverage', 'completeAnalysisAttempt', [session(7), { ...complete(running, a), checked_ids: [] }], 'DEFINITION_ANALYSIS_COVERAGE_INVALID', 400);
          await reject('still-running', 'finishAnalysisRun', [session(7), finish(running, 'succeeded', a.revision_no)], 'DEFINITION_ANALYSIS_ATTEMPT_STILL_RUNNING');
          await reject('finish-coverage', 'finishAnalysisRun', [session(7), finish(done, 'failed', dc.revision_no)], 'DEFINITION_ANALYSIS_RUN_COVERAGE_CONFLICT');
          const failed = await call('fail-attempt', 'completeAnalysisAttempt', [session(7), complete(running, a, 'failed')]);
          const retry = await call('retry-attempt', 'beginAnalysisAttempt', [session(7), { ...begin(running), expected_revision: failed.revision_no }]); assert.equal(retry.attempt_no, 2);
          const cancelled = await call('cancel-retry', 'finishAnalysisRun', [session(7), finish(running, 'cancelled', retry.revision_no)]);
          await reject('terminal', 'beginAnalysisAttempt', [session(7), { ...begin(running), expected_revision: cancelled.revision_no }], 'DEFINITION_ANALYSIS_RUN_TERMINAL');
          const rerun = await createRun(7, payload(sources[1], { rerun_of_run_id: running.run_id })); assert.equal((await call('rerun-read', 'getAnalysisRun', [session(7), rerun.run_id])).rerun_of_run_id, running.run_id); await reset();
        });
        await check('all consumer mutations and request-result failures roll back the complete physical database', async () => {
          for (const [method, args] of entries) {
            const values = args(); await call('fault-probe-' + method + '-' + values[1].status, method, values);
            const writes = operations.at(-1).trace.filter(q => /^(INSERT|UPDATE)\b/i.test(q.sql || '')).map(q => q.sql); await reset();
            for (const sql of [...new Set(writes)]) {
              fault = value => value === sql;
              try { await reject('injected-' + method + '-' + writes.indexOf(sql), method, args(), 'B02_INJECTED_WRITE_FAILURE', null); }
              finally { fault = null; } await reset();
            }
          }
        });
        await check('compare and read retain baseline JSON digests and physical BIGINT lock sorting', async () => {
          const values = [session(7), precision[0].runRows.find(r => r.status === 'succeeded').run_id];
          assert.deepEqual(await call('read-current', 'getAnalysisRun', values), await call('read-baseline', 'getAnalysisRun', values, oldRepo));
          const before = precision[1].runRows.find(r => r.status === 'succeeded').run_id, after = precision[2].runRows.find(r => r.status === 'succeeded').run_id;
          const forward = await call('compare-current', 'compareAnalysisRuns', [session(7), before, after]);
          assert.deepEqual(forward, await call('compare-baseline', 'compareAnalysisRuns', [session(7), before, after], oldRepo));
          await call('compare-reverse', 'compareAnalysisRuns', [session(7), after, before]);
          const ids = operations.at(-1).trace.filter(q => q.sql?.includes('FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE')).map(q => q.params[0]); assert.deepEqual(ids, [before, after].sort((a, b) => BigInt(a) < BigInt(b) ? -1 : 1));
          for (const source of sources) {
            const row = base.data_map_v7_sources.find(x => x.source_id === source.id); assert.deepEqual(parse(row.content_json), source.document); assert.equal(digest(parse(row.content_json)), row.content_digest);
          }
          assert.deepEqual(await physical(), base);
        });
        await check('adjacent BIGINT physical run IDs read exactly and comparisons lock ascending in both directions', async () => {
          const r = await createRun(); await call('big-id-prototype-cancel', 'finishAnalysisRun', [session(7), finish(r, 'cancelled')]);
          const high = ['9007199254741500', '9007199254741501'];
          for (const runId of high) for (const table of ['data_map_analysis_runs', 'data_map_analysis_inputs', 'data_map_analysis_steps']) {
            const [cols] = await pool.execute('SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? ORDER BY ORDINAL_POSITION', [table]);
            const names = cols.map(c => '`' + c.COLUMN_NAME + '`'), expressions = cols.map(c => c.COLUMN_NAME === 'run_id' ? 'CAST(? AS SIGNED)' : '`' + c.COLUMN_NAME + '`');
            await pool.execute('INSERT INTO `' + table + '`(' + names.join(',') + ') SELECT ' + expressions.join(',') + ' FROM `' + table + '` WHERE run_id=?', [runId, r.run_id]);
          }
          for (const runId of high) { const loaded = await call('big-run-read-' + runId, 'getAnalysisRun', [session(7), runId]); assert.equal(loaded.run_id, runId); assert.deepEqual(await call('big-run-old-read', 'getAnalysisRun', [session(7), runId], oldRepo), loaded); }
          const traces = [];
          for (const [left, right] of [high, high.slice().reverse()]) {
            const result = await call('big-run-compare', 'compareAnalysisRuns', [session(7), left, right]), op = operations.at(-1);
            const ids = op.trace.filter(q => q.sql?.includes('FROM data_map_analysis_runs WHERE run_id=? FOR UPDATE')).map(q => q.params[0]); assert.deepEqual(ids, high); assert.equal(result.before_run_id, left); assert.equal(result.after_run_id, right);
            assert.deepEqual(await call('big-run-old-compare', 'compareAnalysisRuns', [session(7), left, right], oldRepo), result); traces.push(op);
          }
          save('big-run-compare-order.json', { high, sameConnectionId: pinned.threadId, publicComparisons: traces, ascendingExactIds: true });
          await reject('rounded-run-read', 'getAnalysisRun', [session(7), Number(high[1])], 'DEFINITION_ID_INVALID', 400); await reset();
        });
        await check('original SQL lock order held through commit with only proven numeric-bind changes', async () => {
          for (const [method, args] of entries) {
            const values = args(), oldResult = await call('order-old-' + method, method, values, oldRepo), oldTrace = operations.at(-1).trace; await reset();
            beforeCommit = async (db, op) => {
              const [locks] = await pool.execute('SELECT l.OBJECT_NAME,l.LOCK_MODE,l.LOCK_TYPE,l.LOCK_STATUS FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=DATABASE()', [db.threadId]);
              for (const t of ['user_accounts', 'person', 'person_roles', 'data_map_v7_sources', 'data_map_analysis_runs', 'data_map_definition_requests']) assert(locks.some(x => x.OBJECT_NAME === t && x.LOCK_TYPE === 'RECORD' && x.LOCK_STATUS === 'GRANTED'), t + ' locks retained'); op.heldLocks = locks;
            };
            const result = await call('order-new-' + method, method, values); beforeCommit = null; const trace = operations.at(-1).trace;
            assert.deepEqual(result, oldResult); assert.equal(trace.length, oldTrace.length);
            for (let i = 0; i < trace.length; i++) { assert.equal(trace[i].method, oldTrace[i].method); assert.equal(trace[i].event, oldTrace[i].event); assert.deepEqual(trace[i].params, oldTrace[i].params); assert.equal(trace[i].sql?.replaceAll('CAST(? AS SIGNED)', '?'), oldTrace[i].sql?.replaceAll('CAST(? AS SIGNED)', '?')); }
            await reset();
          }
        });
        await check('queue enrollment preserves worker token guard and cancellation exception without worker startup', async () => {
          await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [queueSchema.MIGRATION_KEY]);
          await pool.execute("INSERT INTO data_map_analysis_queue(run_id,session_json,policy_json,state,available_at,created_at,updated_at) VALUES (?,?,?,'ready',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3))", [running.run_id, json(session(7)), json({ synthetic: true })]);
          await reject('queue-begin', 'beginAnalysisAttempt', [session(7), { ...begin(running), expected_revision: a.revision_no }], 'DEFINITION_ANALYSIS_WORKER_TOKEN_REQUIRED');
          await reject('queue-complete', 'completeAnalysisAttempt', [session(7), complete(running, a)], 'DEFINITION_ANALYSIS_WORKER_TOKEN_REQUIRED');
          await reject('queue-finish', 'finishAnalysisRun', [session(7), finish(running, 'failed', a.revision_no)], 'DEFINITION_ANALYSIS_WORKER_TOKEN_REQUIRED');
          assert.equal((await call('queue-cancel', 'finishAnalysisRun', [session(7), finish(running, 'cancelled', a.revision_no)])).status, 'cancelled'); await reset();
        });
        save('operations.json', operations); save('negative-results.json', negatives); save('lock-waits.json', waits); save('precision.json', precision);
        assert.deepEqual(await physical(), base); save('restored-physical.json', await physical());
      } finally { beforeCommit = null; fault = null; pinned.release(); }
    }, { stage: '02', randomDatabase: true });
  } catch (e) { save('failure.json', { error: errorValue(e), stack: e.stack, checks, operations, negatives, waits, precision, target }); throw e; }
  finally {
    if (target) {
      const remaining = cp.execFileSync('docker', ['ps', '-aq', '--filter', 'id=' + target.containerId], { env: isolatedEnvironment(), encoding: 'utf8', windowsHide: true }).trim();
      const portResult = await new Promise(resolve => { const socket = net.connect(target.port, '127.0.0.1'); socket.once('connect', () => { socket.destroy(); resolve('CONNECTED'); }); socket.once('error', e => resolve(e.code)); socket.setTimeout(1500, () => { socket.destroy(); resolve('TIMEOUT'); }); });
      save('cleanup.json', { ...target, remaining, portResult, passed: remaining === '' && portResult === 'ECONNREFUSED' }); assert.equal(remaining, ''); assert.equal(portResult, 'ECONNREFUSED');
    }
    save('loaded-dependencies.json', Object.keys(require.cache).filter(p => fs.existsSync(p)).map(p => ({ path: path.relative(path.resolve(__dirname, '../../..'), p).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(p)) })).sort((a, b) => a.path.localeCompare(b.path)));
  }
  save('validation.json', { passed: true, fullWriteChainPassed: true, consumerIdentityPrecisionPassed: true, checks, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, httpStarted: false, workerStarted: false, businessAcceptance: false }); console.log('B02_ANALYSIS_RUN_IDENTITY_PASSED');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
