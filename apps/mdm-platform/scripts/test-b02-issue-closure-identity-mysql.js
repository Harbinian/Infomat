// Public repository tests on an owned UUID/tmpfs MySQL. No HTTP or worker.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cp = require('node:child_process'), net = require('node:net'), Module = require('node:module');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeDataMapDefinitionRepository } = require('../server/dataMapDefinitionRepository');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ROLE_GUIDES, ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const { json, digest, parse } = require('../server/dataMapDefinitionValues');
const arg = process.argv.indexOf('--output');
assert(arg > 0, '--output required');
const output = path.resolve(process.argv[arg + 1]), run = path.dirname(output);
assert(path.basename(run).startsWith('B02-') || (path.basename(run).startsWith('coordinator-') && path.basename(path.dirname(run)).startsWith('B02-')), 'output must belong to the dispatch or its coordinator correction');
assert(!fs.existsSync(output), 'never overwrite evidence'); fs.mkdirSync(output);
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const manifest = JSON.parse(fs.readFileSync(path.join(run, 'source-baseline.json')));
const input = manifest.files.find(f => f.path === 'apps/mdm-platform/server/analysisIssueClosure.js');
assert.equal(sha(fs.readFileSync(input.snapshot)), input.sha256);
const filename = require.resolve('../server/analysisIssueClosure');
const archived = new Module(filename, module); archived.filename = filename;
archived.paths = Module._nodeModulePaths(path.dirname(filename)); archived._compile(fs.readFileSync(input.snapshot, 'utf8'), filename);
const P = '9007199254740992', N = '9007199254740993';
const people = [
  { personId: 7, accountId: 107, authVersion: 1, role: 'department_contact' },
  { personId: 8, accountId: 108, authVersion: 1, role: 'mdm_lead' },
  { personId: 9, accountId: 109, authVersion: 1, role: 'admin' },
  { personId: 10, accountId: 110, authVersion: 1, role: 'admin', extra: 'mdm_lead' },
  { personId: 11, accountId: 111, authVersion: 1, role: 'department_contact', dept: '92' },
  { personId: 12, accountId: 112, authVersion: 1, role: 'data_quality_auditor' },
  { personId: 13, accountId: 113, authVersion: 1, role: null },
  { personId: P, accountId: '9007199254741300', authVersion: '9007199254741400', role: 'mdm_lead' },
  { personId: N, accountId: '9007199254741301', authVersion: '9007199254741401', role: 'data_quality_auditor' }
];
const person = id => people.find(p => String(p.personId) === String(id));
const session = id => { const p = person(id); return { identityKind: 'person', personId: p.personId, userId: p.personId, accountId: p.accountId, authVersion: p.authVersion }; };
const errorValue = e => ({ code: e.code, statusCode: e.statusCode, message: e.message, name: e.name, errno: e.errno, sqlState: e.sqlState });
const checks = [], operations = [], negatives = [], waits = [], failures = [];
let target, active, fault, beforeCommit;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
async function main() {
  try {
    await withFreshMysql(async ctx => {
      const { pool, owner, database, containerId, port, backup, restore } = ctx;
      target = { owner, database, containerId, port, host: '127.0.0.1', stage: '02', image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);
      const schemas = ['dataMapDefinitionSchema', 'v7MappingSchema', 'designHandoffSchema', 'analysisRunSchema', 'analysisIssueSchema', 'analysisTaskSchema', 'analysisClosureSchema'];
      const ddl = new Map(splitSqlStatements(mdmMysqlSchemaSql()).map(s => [s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1], s]));
      for (const s of [...schemas.flatMap(m => require('../server/' + m).statements()), ...require('../server/officeSchema').officeSchemaStatements()]) ddl.set(s.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1], s);
      const created = new Set(), casts = new Map();
      async function create(t) {
        if (created.has(t)) return; assert(ddl.has(t), 'reviewed CREATE ' + t); created.add(t);
        const s = ddl.get(t); assert.match(s, /^CREATE TABLE IF NOT EXISTS /);
        for (const m of s.matchAll(/REFERENCES\s+(\w+)\s*\(/g)) if (m[1] !== t) await create(m[1]);
        await pool.query(s);
        const [cols] = await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','datetime','timestamp') ORDER BY ORDINAL_POSITION", [t]);
        casts.set(t, cols.map(c => 'CAST(`' + c.COLUMN_NAME + '` AS CHAR) AS `' + c.COLUMN_NAME + '`').join(','));
      }
      for (const t of [...require('../server/dataMapDefinitionMigration').baseTables, ...require('../server/analysisDependencyReadiness').identityTables, ...schemas.flatMap(m => require('../server/' + m).tables), 'process_governance_issue_events', 'mdm_todo_events']) await create(t);
      save('reviewed-create-fixture.json', [...created].sort().map(t => ({ table: t, sql: ddl.get(t), sha256: sha(ddl.get(t)) })));
      for (const m of schemas) await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)', [require('../server/' + m).MIGRATION_KEY]);
      for (const d of ['91', '92']) await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (?,?,?,?)', [d, 'D' + d, 'D' + d, '/' + d + '/']);
      for (const r of ROLE_GUIDES) {
        await pool.execute('INSERT INTO roles(role_code,role_name,model_version,role_group) VALUES (?,?,?,?)', [r.code, r.name, ACCESS_MODEL_VERSION, r.code === 'admin' ? 'system' : 'mdm']);
        for (const p of r.permissions) {
          await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action) VALUES (?,?,?)', [p.code, p.resource, p.action]);
          await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?", [p.code, r.code]);
        }
      }
      for (const p of people) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,?)', [String(p.personId), 'P' + p.personId, 'synthetic ' + p.personId, p.dept || '91']);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?,'synthetic-unused','active',0,CAST(? AS SIGNED))", [String(p.accountId), String(p.personId), 'P' + p.personId, String(p.authVersion)]);
        for (const r of [p.role, p.extra].filter(Boolean)) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,?, 'synthetic B02',CURRENT_DATE FROM roles WHERE role_code=?", [String(p.personId), ['admin', 'mdm_lead', 'data_quality_auditor'].includes(r) ? 'global' : 'department', ['admin', 'mdm_lead', 'data_quality_auditor'].includes(r) ? null : p.dept || '91', r]);
      }
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (14,'P14','synthetic without account',91)");
      await pool.execute('UPDATE departments SET final_responsible_person_id=7 WHERE id=91');
      async function physical() {
        const value = {};
        for (const t of [...created].sort()) value[t] = (await pool.query('SELECT *' + (casts.get(t) ? ',' + casts.get(t) : '') + ' FROM `' + t + '` ORDER BY 1,2'))[0];
        return value;
      }
      const pinned = await pool.getConnection();
      const observed = { getConnection: async () => {
        const op = active; assert(op, 'every public operation traced'); op.connectionId = pinned.threadId;
        const w = {};
        for (const method of ['execute', 'query']) w[method] = async (sql, params = []) => {
          assert(!/^(CREATE|ALTER|DROP|TRUNCATE)\b/i.test(sql.trim()), 'consumer cannot run DDL');
          const q = { method, sql, params, connectionId: pinned.threadId, completed: false }; op.trace.push(q);
          const injected = fault?.(sql, params);
          if (injected === 'server') await pinned.execute('SELECT B02_OWNED_NONEXISTENT_FUNCTION()');
          if (injected) throw Object.assign(new Error('B02_INJECTED_WRITE_FAILURE'), { code: 'B02_INJECTED_WRITE_FAILURE' });
          const result = await pinned[method](sql, params); q.completed = true;
          if (sql.includes('FROM person p') || sql.includes('FROM person WHERE')) q.identityProjection = result[0].map(r => Object.fromEntries(['person_id', 'current_department_id', 'department_id', 'account_id', 'auth_version', 'status'].filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]])));
          return result;
        };
        w.beginTransaction = async () => { op.trace.push({ event: 'begin' }); return pinned.beginTransaction(); };
        w.commit = async () => { if (beforeCommit) await beforeCommit(pinned, op); await pinned.commit(); op.trace.push({ event: 'commit' }); };
        w.rollback = async () => { await pinned.rollback(); op.trace.push({ event: 'rollback' }); };
        w.release = () => op.trace.push({ event: 'release', pinned: true }); return w;
      } };
      const repo = makeDataMapDefinitionRepository(observed);
      const current = require.cache[filename].exports; let oldRepo;
      try { require.cache[filename].exports = archived.exports; oldRepo = makeDataMapDefinitionRepository(observed); } finally { require.cache[filename].exports = current; }
      async function call(label, method, args, repository = repo) {
        const op = { label, method, args, variant: repository === oldRepo ? 'input-baseline' : 'current', trace: [] }; active = op;
        try { op.result = await repository[method](...args); return op.result; }
        catch (e) { op.error = errorValue(e); throw e; }
        finally { operations.push(op); active = null; }
      }
      const uuid = () => crypto.randomUUID();
      const state = (f, actor = 7, repository = repo) => call('state-' + f.issue, 'getAnalysisIssueClosure', [session(actor), f.issue], repository);
      const binding = s => ({ request_id: uuid(), expected_revision: s.revision_no, expected_issue_digest: s.issue_digest, expected_context_digest: s.context_digest });
      const appoint = (s, reviewer = 8) => ({ ...binding(s), action: 'designate', reviewer_person_id: String(reviewer), conditions: ['synthetic condition'], reason: 'synthetic appointment' });
      const review = (s, pass = false) => ({ ...binding(s), action: 'review', reason: 'synthetic review', checks: s.assignment.conditions.map(c => ({ condition_id: c.condition_id, satisfied: pass, basis: 'synthetic basis', ...(pass ? { todo_id: s.tasks[0].todo_id, task_revision: s.tasks[0].revision_no, excerpt: 'synthetic completion' } : {}) })) });
      const write = (f, actor, body, label = body.action, repository = repo) => call(label, 'reviewAnalysisIssueTask', [session(actor), f.issue, body], repository);
      async function reject(label, f, actor, body, code, status = 409) {
        const before = await physical(); await assert.rejects(write(f, actor, body, label), e => { assert.equal(e.code, code); assert.equal(e.statusCode, status); return true; });
        assert.deepEqual(await physical(), before, label + ' whole physical rollback'); negatives.push({ label, code, status, physicalRollback: true });
      }
      const fixtures = [];
      try {
        await check('public linked V8/V7 sources and current tasks prepare without worker or migration', async () => {
          for (const format of ['v8', 'v7']) {
            const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-' + format + '.json')));
            const source = await call('source-' + format, 'registerV7Source', [session(8), { request_id: uuid(), source_kind: 'uploaded_material', original_name: 'synthetic-' + format + '.json' }, Buffer.from(JSON.stringify(doc))]);
            assert.equal(source.validation_status, 'valid');
            const runResult = await call('run-' + format, 'createAnalysisRun', [session(8), { request_id: uuid(), inputs: [{ input_key: 'process', kind: 'v7_source', ref_id: source.source_id }], check_scope: { description: 'synthetic', check_ids: ['synthetic'] }, parser_versions: { fixture: 'synthetic-v1' }, rule_version: 'synthetic-v1', steps: [{ step_key: 'check', input_keys: ['process'], check_ids: ['synthetic'], parser_key: 'fixture' }] }]);
            const begun = await call('begin-' + format, 'beginAnalysisAttempt', [session(8), { request_id: uuid(), run_id: runResult.run_id, expected_revision: 1, step_key: 'check' }]);
            const completed = await call('complete-' + format, 'completeAnalysisAttempt', [session(8), { request_id: uuid(), run_id: runResult.run_id, expected_revision: begun.revision_no, attempt_id: begun.attempt_id, status: 'succeeded', checked_ids: ['synthetic'], evidence: [{ evidence_key: 'basis', input_key: 'process', locator_kind: 'json_pointer', locator: '/schema_version', note: 'synthetic' }], findings: [{ rule_id: 'synthetic', finding_type: 'synthetic', message: 'synthetic issue', subject_input_keys: ['process'], semantic_locator: 'process:synthetic', evidence_keys: ['basis'] }] }]);
            await call('finish-' + format, 'finishAnalysisRun', [session(8), { request_id: uuid(), run_id: runResult.run_id, expected_revision: completed.revision_no, status: 'succeeded' }]);
            const loaded = await call('load-' + format, 'getAnalysisRun', [session(8), runResult.run_id]);
            const finding = loaded.attempts[0].findings[0], evidence = loaded.attempts[0].evidence[0];
            const linked = await call('issue-' + format, 'decideAnalysisFinding', [session(8), { request_id: uuid(), run_id: loaded.run_id, finding_id: finding.finding_id, expected_revision: 1, action: 'create', reason: 'synthetic issue', owner_department_id: '91', owner_basis: 'synthetic', evidence_ids: [evidence.evidence_id], title: 'synthetic ' + format }]);
            const f = { issue: linked.issue_id, run: loaded.run_id, source: source.source_id, format, document: doc }; fixtures.push(f);
            await pool.execute("INSERT INTO org_unit(org_unit_code,org_unit_name,org_type,department_id) VALUES (?,?,'office',91)", ['O' + f.issue, 'synthetic']);
            const [[office]] = await pool.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) id');
            await pool.execute("INSERT INTO mdm_todos(content,status,created_by_person_id,completed_by_person_id) VALUES ('synthetic task','done',7,12)");
            const [[todo]] = await pool.execute('SELECT CAST(LAST_INSERT_ID() AS CHAR) id'); f.todo = todo.id;
            await pool.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assignee_person_id,assigned_by_person_id) VALUES (?,?,12,7)', [f.todo, office.id]);
            await pool.execute("INSERT INTO data_map_analysis_issue_tasks(todo_id,issue_id,purpose,round_no,snapshot_json,snapshot_digest,created_by_person_id,created_at) VALUES (?,?,'correct',1,?,?,7,UTC_TIMESTAMP(3))", [f.todo, f.issue, json({ unknown: null }), digest({ unknown: null })]);
            await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_person_id,note) VALUES (?,'office_task_completed',12,?)", [f.todo, json({ note: 'synthetic completion' })]);
            assert.equal((await state(f)).status, 'waiting_my_action', 'completion does not close issue');
          }
        });
        const f = fixtures[0];
        await check('small then adjacent BIGINT public event identities and hashes on the same connection', async () => {
          for (const actor of [7, P, N]) {
            await pool.execute('UPDATE departments SET final_responsible_person_id=CAST(? AS SIGNED) WHERE id=91', [String(actor)]);
            const s = await state(f, actor); const body = appoint(s, 8); const result = await write(f, actor, body, 'precision-owner-' + actor);
            const stored = await physical(); const e = stored.data_map_analysis_issue_closure_events.at(-1), p = stored.process_governance_issue_events.at(-1), snapshot = parse(e.snapshot_json);
            save('precision-owner-' + actor + '.json', { actor: String(actor), result, event: e, issueEvent: p, snapshot, connectionId: pinned.threadId, operation: operations.at(-1) });
            assert.equal(e.actor_person_id, String(actor)); assert.equal(p.actor_person_id, String(actor)); assert.equal(snapshot.actor_person_id, String(actor)); assert.equal(parse(p.payload_json).actor_person_id, String(actor)); assert.equal(e.snapshot_digest, digest(snapshot));
            assert.deepEqual(await write(f, actor, body, 'precision-retry-' + actor), result); assert.deepEqual(await physical(), stored);
          }
          await pool.execute('UPDATE departments SET final_responsible_person_id=7 WHERE id=91');
          for (const actor of [8, P, N]) {
            await write(f, 7, appoint(await state(f), actor)); const s = await state(f); const body = review(s); const result = await write(f, actor, body, 'precision-reviewer-' + actor);
            const stored = await physical(), e = stored.data_map_analysis_issue_closure_events.at(-1), p = stored.process_governance_issue_events.at(-1);
            assert.equal(e.action, 'reject'); assert.equal(e.actor_person_id, String(actor)); assert.equal(p.actor_person_id, String(actor)); assert.equal(parse(e.snapshot_json).actor_person_id, String(actor)); assert.equal(e.snapshot_digest, digest(parse(e.snapshot_json)));
            assert.deepEqual(await write(f, actor, body, 'reviewer-retry-' + actor), result); assert.deepEqual(await physical(), stored);
          }
        });
        // Remaining checks use ordinary identities so paused historic identity collisions are not reinterpreted.
        await pool.execute('UPDATE departments SET final_responsible_person_id=7 WHERE id=91');
        await write(f, 7, appoint(await state(f)));
        const base = await physical(), dump = backup(); save('base-physical.json', base);
        async function reset() { restore(dump); assert.deepEqual(await physical(), base); }
        await check('input consumer reads retained history and authorization digests byte-for-byte', async () => {
          assert.deepEqual(await state(f, 7, oldRepo), await state(f));
          save('retained-history.json', { oldInputSha256: input.sha256, equal: true, state: await state(f) });
        });
        await check('BIGINT close reopen and suspension keep physical event payload and previous digest identity', async () => {
          for (const actor of [P, N]) {
            await write(f, 7, appoint(await state(f), actor)); const before = await state(f); await write(f, actor, review(before, true), 'big-close-' + actor);
            const closed = await state(f); assert.equal(closed.status, 'closed');
            await pool.execute('UPDATE departments SET final_responsible_person_id=CAST(? AS SIGNED) WHERE id=91', [actor]);
            await write(f, actor, { ...appoint(closed, 8), action: 'reopen', reopen_evidence: 'synthetic new evidence' }, 'big-reopen-' + actor);
            const reopened = await state(f, actor); assert.equal(reopened.status, 'waiting_my_action'); assert.deepEqual(reopened.events.slice(0, closed.events.length), closed.events);
            await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=108');
            const suspended = await state(f, actor); assert(suspended.suspended); assert.equal(suspended.events.at(-1).action, 'suspend');
            const stored = await physical();
            for (const e of stored.data_map_analysis_issue_closure_events.filter(e => e.issue_id === f.issue).slice(-3)) {
              assert.equal(e.actor_person_id, actor); const snapshot = parse(e.snapshot_json); assert.equal(snapshot.actor_person_id, actor); assert.equal(e.snapshot_digest, digest(snapshot));
              const issueEvent = stored.process_governance_issue_events.find(p => p.issue_id === f.issue && p.payload_json && parse(p.payload_json).revision_no === e.revision_no);
              assert(issueEvent); assert.equal(issueEvent.actor_person_id, actor); assert.deepEqual(parse(issueEvent.payload_json), snapshot);
            }
            save('big-all-actions-' + actor + '.json', { events: suspended.events, identity: actor, connectionId: pinned.threadId, exact: true }); await reset();
          }
        });
        await check('admin/no grant/cross department/nonowner/participant and replay contracts remain', async () => {
          const s = await state(f), a = appoint(s);
          for (const actor of [9, 10, 13, 11, 8]) await reject('not-owner-' + actor, f, actor, a, actor === 11 || actor === 13 ? 'DEFINITION_ACCESS_DENIED' : 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED', 403);
          const before = await physical(); await assert.rejects(call('system-admin', 'reviewAnalysisIssueTask', [{ identityKind: 'system_admin', userId: 'system-admin:109', accountId: 109, authVersion: 1 }, f.issue, a]), e => e.code === 'DEFINITION_AUTH_REQUIRED' && e.statusCode === 401); assert.deepEqual(await physical(), before);
          await reject('participant-assignee', f, 7, appoint(s, 12), 'DEFINITION_ANALYSIS_CLOSURE_REVIEWER_INELIGIBLE', 403);
          await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_person_id,note) VALUES (?,'office_person_assigned',7,?)", [f.todo, json({ from_person_id: N, to_person_id: '12', unknown: null })]);
          await reject('historic-participant', f, 7, appoint(await state(f), N), 'DEFINITION_ANALYSIS_CLOSURE_REVIEWER_INELIGIBLE', 403); await reset();
          await reject('wrong-reviewer', f, P, review(s), 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED', 403);
          await reject('revision', f, 7, { ...a, expected_revision: 999 }, 'DEFINITION_ANALYSIS_CLOSURE_REVISION_CONFLICT');
          await reject('context', f, 7, { ...a, expected_context_digest: '0'.repeat(64) }, 'DEFINITION_ANALYSIS_CLOSURE_REVISION_CONFLICT');
          const receipt = await write(f, 7, a); await reject('changed-request', f, 7, { ...a, reason: 'changed' }, 'DEFINITION_IDEMPOTENCY_CONFLICT'); assert.deepEqual(await write(f, 7, a), receipt); await reset();
        });
        await check('source/task/conditions close guards and negative review preserve open status', async () => {
          let s = await state(f); await reject('task-revision', f, 8, { ...review(s, true), checks: [{ ...review(s, true).checks[0], task_revision: 999 }] }, 'DEFINITION_ANALYSIS_CLOSURE_EVIDENCE_CHANGED');
          await reject('conditions', f, 8, { ...review(s), checks: [] }, 'DEFINITION_ANALYSIS_CLOSURE_CHECKS_REQUIRED', 400);
          await pool.execute("UPDATE mdm_todos SET status='pending' WHERE id=?", [f.todo]);
          s = await state(f); await reject('pending-task', f, 8, review(s, true), 'DEFINITION_ANALYSIS_CLOSURE_EVIDENCE_CHANGED'); await reset();
          const originalSourceBody = review(await state(f));
          await pool.execute('UPDATE data_map_v7_sources SET content_digest=REPEAT(\'0\',64) WHERE source_id=?', [f.source]);
          await reject('source-integrity', f, 8, originalSourceBody, 'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT'); await reset();
          s = await state(f); await write(f, 8, review(s)); const after = await state(f); assert.equal(after.status, 'waiting_my_action'); assert.equal(after.events.at(-1).action, 'reject'); assert.deepEqual(after.tasks, s.tasks); await reset();
        });
        await check('positive close/reopen on V8/V7 retains prior events full body and task evidence', async () => {
          for (const item of fixtures) {
            if (! (await state(item)).assignment) await write(item, 7, appoint(await state(item)));
            const s = await state(item), body = review(s, true), receipt = await write(item, 8, body, 'close-' + item.format);
            let closed = await state(item); assert.equal(closed.status, 'closed'); assert.equal(closed.events.at(-1).action, 'close');
            const stored = await physical(); assert.deepEqual(await write(item, 8, body), receipt); assert.deepEqual(await physical(), stored);
            const reopenedBody = { ...appoint(closed), action: 'reopen', reopen_evidence: 'synthetic new evidence' }; await write(item, 7, reopenedBody, 'reopen-' + item.format);
            const after = await state(item); assert.equal(after.status, 'waiting_my_action'); assert.deepEqual(after.events.slice(0, closed.events.length), closed.events); assert.deepEqual(after.tasks, closed.tasks);
            assert.deepEqual(await state(item, 7, oldRepo), after); save('history-' + item.format + '.json', after);
          } await reset();
        });
        await check('all append/head/binding/outer SQL faults roll back every physical row', async () => {
          for (const prefix of ['INSERT INTO data_map_analysis_issue_closure_events', 'INSERT INTO data_map_analysis_issue_closure_heads', 'UPDATE data_map_analysis_issue_bindings', 'INSERT INTO process_governance_issue_events', 'UPDATE data_map_definition_requests SET result_json']) {
            const s = await state(f); fault = sql => sql.startsWith(prefix);
            try { await assert.rejects(write(f, 8, review(s, true), 'failure-' + prefix), e => e.code === 'B02_INJECTED_WRITE_FAILURE'); } finally { fault = null; }
            assert.deepEqual(await physical(), base); negatives.push({ label: prefix, physicalRollback: true, externalSqlErrorUnchanged: true });
          }
          const s = await state(f); fault = sql => sql.startsWith('INSERT INTO process_governance_issue_events') ? 'server' : false;
          try { await assert.rejects(write(f, 8, review(s, true), 'real-server-error'), e => e.code === 'ER_SP_DOES_NOT_EXIST' && e.errno === 1305 && e.sqlState === '42000'); } finally { fault = null; }
          assert.deepEqual(await physical(), base); negatives.push({ label: 'real-server-error', physicalRollback: true, mysqlErrorPreserved: true });
        });
        await check('candidate qualification suspension persists and candidate reads never lock the other actor', async () => {
          const changes = [
            ['user_accounts', 'account_id', 108, { account_status: 'disabled' }], ['user_accounts', 'account_id', 108, { must_change_password: 1 }],
            ['user_accounts', 'account_id', 108, { auth_version: 2 }], ['person', 'person_id', 8, { status: 'inactive' }], ['person', 'person_id', 8, { current_department_id: '92' }],
            ['departments', 'id', 91, { status: 'inactive' }]
          ];
          for (const [table, key, value, fields] of changes.slice(0, 5)) {
            await pool.execute('UPDATE ' + table + ' SET ' + Object.keys(fields).map(k => k + '=?').join(',') + ' WHERE ' + key + '=?', [...Object.values(fields), value]);
            const s = await state(f); assert(s.suspended); assert.equal(s.events.at(-1).action, 'suspend'); const first = s.events.length;
            const original = base[table].find(r => String(r[key]) === String(value)); await pool.execute('UPDATE ' + table + ' SET ' + Object.keys(fields).map(k => k + '=?').join(',') + ' WHERE ' + key + '=?', [...Object.keys(fields).map(k => original[k]), value]);
            const restored = await state(f); assert(restored.suspended); assert.equal(restored.events.length, first); await reject('suspended-review', f, 8, review(restored), 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED', 403); await reset();
          }
          await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=8"); assert((await state(f)).suspended); await reset();
          const blocker = await pool.getConnection(); try {
            await blocker.beginTransaction(); await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=108 FOR UPDATE'); await blocker.execute('SELECT person_id FROM person WHERE person_id=8 FOR UPDATE');
            const value = await Promise.race([state(f), sleep(2500).then(() => { throw new Error('CANDIDATE_WRITE_LOCK_ACQUIRED'); })]); assert(!value.suspended); save('candidate-no-write-lock.json', { completedWhileCandidateLocked: true });
          } finally { await blocker.rollback(); blocker.release(); }
          await reset();
        });
        async function lockChange(label, table, key, value, fields, actor = 8, code = 'DEFINITION_AUTH_REQUIRED', status = 401) {
          const s = await state(f), body = actor === 7 ? appoint(s) : review(s), before = await physical(), blocker = await pool.getConnection(); let pending;
          try {
            await blocker.beginTransaction(); await blocker.execute('SELECT ' + key + ' FROM ' + table + ' WHERE ' + key + '=? FOR UPDATE', [value]);
            pending = write(f, actor, body, 'lock-' + label).then(result => ({ result }), error => ({ error })); let evidence;
            for (let i = 0; i < 200; i++) { const [locks] = await pool.execute('SELECT l.OBJECT_NAME object_name,l.LOCK_MODE lock_mode,t.PROCESSLIST_ID connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [pinned.threadId]); if (locks.length) { evidence = locks; break; } await sleep(25); }
            assert(evidence, 'actual data_lock_waits ' + label);
            await blocker.execute('UPDATE ' + table + ' SET ' + Object.keys(fields).map(k => k + '=?').join(',') + ' WHERE ' + key + '=?', [...Object.values(fields), value]); await blocker.commit();
            const outcome = await pending; assert(outcome.error, 'lock invalidation must reject'); assert.equal(outcome.error.code, code); assert.equal(outcome.error.statusCode, status);
            const after = await physical(), expected = structuredClone(before), row = expected[table].find(r => String(r[key]) === String(value)); Object.assign(row, fields);
            if ('updated_at' in row) row.updated_at = after[table].find(r => String(r[key]) === String(value)).updated_at;
            // Actor failure/revision/source failure rolls back. Suspension is only committed by a qualified current actor.
            assert.deepEqual(after, expected, label + ' full rows except externally committed mutation');
            waits.push({ label, table, evidence, error: errorValue(outcome.error), operation: operations.at(-1), physicalRollback: true });
          } finally { await blocker.rollback().catch(() => {}); blocker.release(); if (pending) await pending; await reset(); }
        }
        await check('actual existing lock waits consume account/person/role/password/version/department/task/source changes', async () => {
          for (const [label, fields] of [['account-disabled', { account_status: 'disabled' }], ['password-gate', { must_change_password: 1 }], ['auth-generation', { auth_version: '2' }], ['password-changed', { password_hash: 'synthetic-changed', auth_version: '2' }]]) await lockChange(label, 'user_accounts', 'account_id', 108, fields);
          await lockChange('person-inactive', 'person', 'person_id', 8, { status: 'inactive' });
          await lockChange('department-inactive-owner', 'departments', 'id', 91, { status: 'inactive' }, 7, 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED', 403);
          await lockChange('owner-department-moved', 'person', 'person_id', 7, { current_department_id: '92' }, 7, 'DEFINITION_ACCESS_DENIED', 403);
          await lockChange('person-account-reassociated', 'user_accounts', 'account_id', 108, { person_id: '14' });
          const grant = base.person_roles.find(r => r.person_id === '8'); await lockChange('role-revoked', 'person_roles', 'person_role_id', grant.person_role_id, { assignment_status: 'revoked' }, 8, 'DEFINITION_ACCESS_DENIED', 403);
          await lockChange('task-revision', 'mdm_todo_office_assignments', 'todo_id', f.todo, { revision_no: 2 }, 8, 'DEFINITION_ANALYSIS_CLOSURE_REVISION_CONFLICT', 409);
          await lockChange('source-integrity', 'data_map_v7_sources', 'source_id', f.source, { content_digest: '0'.repeat(64) }, 8, 'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT', 409);
        });
        try {
          await check('reject and close use current appointment qualification after an actual lock wait', async () => {
            for (const pass of [false, true]) {
            const label = 'reviewer-department-after-wait-' + (pass ? 'close' : 'reject');
            const body = review(await state(f), pass), blocker = await pool.getConnection(); let pending;
            try {
              await blocker.beginTransaction(); await blocker.execute('SELECT person_id FROM person WHERE person_id=8 FOR UPDATE');
              pending = write(f, 8, body, label).then(result => ({ result }), error => ({ error })); let evidence;
              for (let i = 0; i < 200; i++) { const [locks] = await pool.execute('SELECT l.OBJECT_NAME object_name,t.PROCESSLIST_ID connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [pinned.threadId]); if (locks.length) { evidence = locks; break; } await sleep(25); }
              assert(evidence); await blocker.execute('UPDATE person SET current_department_id=92 WHERE person_id=8'); await blocker.commit();
              const outcome = await pending, physicalBeforeFollowup = await physical(), direct = await state(f);
              save(label + '.json', { evidence, outcome: outcome.error ? { error: errorValue(outcome.error) } : outcome, physicalBeforeFollowup, directAfterCommit: direct, operation: operations.findLast(o => o.label === label), expected: 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED and committed suspend, not a review decision under the previous appointment' });
              assert.equal(outcome.error?.code, 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED'); assert(direct.suspended); assert.equal(direct.events.at(-1).action, 'suspend');
              assert(!direct.events.some(e => e.revision_no > body.expected_revision && ['reject', 'close'].includes(e.action)), 'old appointment must not authorize a post-wait decision');
              const committed = physicalBeforeFollowup.data_map_analysis_issue_closure_events.filter(e => e.issue_id === f.issue);
              assert.equal(committed.at(-1).action, 'suspend'); assert.equal(committed.at(-1).revision_no, body.expected_revision + 1);
              assert.equal(physicalBeforeFollowup.process_governance_issues.find(i => i.issue_id === f.issue).display_status, 'waiting_my_action');
              assert.deepEqual(await physical(), physicalBeforeFollowup, 'followup read must not append a second suspension');
              waits.push({ label, evidence, suspensionCommitted: true });
            } finally { await blocker.rollback().catch(() => {}); blocker.release(); if (pending) await pending; await reset(); }
            }
          });
        } catch (e) {
          failures.push({ name: 'current reviewer department after lock wait', error: errorValue(e), evidence: 'reviewer-department-after-wait-reject.json', sourceBoundary: 'Authorized coordinator correction keeps original stage failure evidence unchanged' });
          console.error('FAILED reviewer department after lock wait; continuing independent compatibility checks');
        }
        await check('null department and historical appointment digests remain compatible with current reads', async () => {
          await pool.execute('UPDATE person SET current_department_id=NULL WHERE person_id=8');
          await write(f, 7, appoint(await state(f)));
          const old = await state(f, 8, oldRepo), current = await state(f, 8);
          assert.deepEqual(current, old); assert(!current.suspended); assert(current.can_review);
          const before = await physical();
          await reject('null-department', f, 8, review(current), 'DEFINITION_DEPARTMENT_REQUIRED', 403);
          assert.deepEqual(await physical(), before, 'the original department requirement must reject without any write');
          assert.deepEqual((await state(f)).events, current.events);
          save('null-department-history.json', { sameHistoricalDigest: true, state: current, physicalBefore: before, originalDepartmentRequiredPreserved: true }); await reset();
        });
        await check('current grant digest after a real role lock wait invalidates the prior appointment', async () => {
          const body = review(await state(f)), grant = base.person_roles.find(r => r.person_id === '8'), blocker = await pool.getConnection(); let pending;
          try {
            await blocker.beginTransaction(); await blocker.execute('SELECT person_role_id FROM person_roles WHERE person_role_id=? FOR UPDATE', [grant.person_role_id]);
            pending = write(f, 8, body, 'grant-digest-after-wait').then(result => ({ result }), error => ({ error })); let evidence;
            for (let i = 0; i < 200; i++) { const [locks] = await pool.execute('SELECT l.OBJECT_NAME object_name,t.PROCESSLIST_ID connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?', [pinned.threadId]); if (locks.length) { evidence = locks; break; } await sleep(25); }
            assert(evidence); await blocker.execute("UPDATE person_roles SET effective_to='2099-12-31' WHERE person_role_id=?", [grant.person_role_id]); await blocker.commit();
            const outcome = await pending, committed = await physical(); assert.equal(outcome.error?.code, 'DEFINITION_ANALYSIS_CLOSURE_ACCESS_DENIED');
            const events = committed.data_map_analysis_issue_closure_events.filter(e => e.issue_id === f.issue); assert.equal(events.at(-1).action, 'suspend'); assert.equal(events.at(-1).revision_no, body.expected_revision + 1);
            assert((await state(f)).suspended); assert.deepEqual(await physical(), committed);
            save('grant-digest-after-wait.json', { evidence, error: errorValue(outcome.error), operation: operations.findLast(o => o.label === 'grant-digest-after-wait'), physical: committed }); waits.push({ label: 'grant-digest-after-wait', evidence, suspensionCommitted: true });
          } finally { await blocker.rollback().catch(() => {}); blocker.release(); if (pending) await pending; await reset(); }
        });
        await check('raw SQL order and parameters differ only in current acting qualification reads; original locks remain held', async () => {
          const body = review(await state(f)); const old = await write(f, 8, body, 'baseline-order', oldRepo); const oldTrace = operations.at(-1).trace; await reset();
          beforeCommit = async (db, op) => {
            const [locks] = await pool.execute('SELECT l.OBJECT_NAME,l.LOCK_MODE,l.LOCK_TYPE,l.LOCK_STATUS FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.OBJECT_SCHEMA=DATABASE()', [db.threadId]);
            for (const t of ['process_governance_issues', 'user_accounts', 'person', 'person_roles', 'departments', 'data_map_analysis_issue_bindings', 'data_map_analysis_runs', 'data_map_v7_sources', 'mdm_todos', 'mdm_todo_office_assignments', 'data_map_analysis_issue_closure_events']) assert(locks.some(l => l.OBJECT_NAME === t && l.LOCK_TYPE === 'RECORD' && l.LOCK_STATUS === 'GRANTED'), t + ' held through commit');
            save('held-locks.json', { connectionId: db.threadId, locks, trace: op.trace });
          };
          const result = await write(f, 8, body, 'current-order'); beforeCommit = null; assert.deepEqual(result, old);
          const trace = operations.at(-1).trace, changes = []; assert.equal(trace.length, oldTrace.length);
          for (let i = 0; i < trace.length; i++) {
            const now = trace[i], previous = oldTrace[i];
            if (!now.sql) { assert.deepEqual(now, previous); continue; }
            assert.deepEqual(now.params, previous.params); assert.equal(now.method, previous.method); assert.equal(now.connectionId, previous.connectionId); assert.equal(now.completed, previous.completed);
            if (now.sql !== previous.sql) {
              assert.equal(now.sql, previous.sql + ' FOR SHARE');
              assert(/FROM (person p|person_roles pr|roles WHERE|role_permissions rp|person_roles WHERE)/.test(previous.sql));
              changes.push({ index: i, sqlBefore: previous.sql, sqlAfter: now.sql, params: now.params });
            }
          }
          assert.equal(changes.length, 6, 'five original qualification reads and the original grant digest read');
          save('sql-order.json', { rawOrderAndParametersPreserved: true, onlyActingQualificationCurrentRead: true, changes, current: trace, baseline: oldTrace }); await reset();
        });
        await check('full physical recovery and retained source body ID/hash/null/unknown JSON preserved', async () => {
          assert.deepEqual(await physical(), base); const s = await state(f); const d = backup(); await pool.execute("UPDATE data_map_analysis_issue_closure_events SET snapshot_digest=REPEAT('0',64) WHERE issue_id=?", [f.issue]);
          await assert.rejects(state(f), e => e.code === 'DEFINITION_ANALYSIS_CLOSURE_INTEGRITY_CONFLICT'); restore(d); assert.deepEqual(await physical(), base); assert.deepEqual(await state(f), s);
          save('restore.json', { wholePhysicalRowsEqual: true, dumpSha256: sha(d), dumpPersisted: false, v8v7: fixtures.map(x => ({ format: x.format, sourceId: x.source, bodySha256: sha(json(x.document)) })) });
        });
        save('operations.json', operations); save('negative-results.json', negatives); save('lock-waits.json', waits);
        if (failures.length) { save('validation.json', { passed: false, fullWriteChainPassed: false, consumerIdentityPrecisionPassed: true, checks, failures, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, businesoRgaeptance: false }); throw Object.assign(new Error('B02_RELATED_VALIDATION_FAILED'), { code: 'B02_RELATED_VALIDATION_FAILED' }); }
      } finally { pinned.release(); }
    }, { stage: '02', randomDatabase: true });
  } catch (e) { save('failure.json', { error: errorValue(e), stack: e.stack, checks, operations, negatives, waits, failures, target }); throw e; }
  finally {
    if (target) {
      const remaining = cp.execFileSync('docker', ['ps', '-aq', '--filter', 'id=' + target.containerId], { env: isolatedEnvironment(), encoding: 'utf8', windowsHide: true, timeout: 30000 }).trim();
      const portResult = await new Promise(resolve => { const s = net.connect(target.port, '127.0.0.1'); s.once('connect', () => { s.destroy(); resolve('CONNECTED'); }); s.once('error', e => resolve(e.code)); s.setTimeout(1500, () => { s.destroy(); resolve('TIMEOUT'); }); });
      save('cleanup.json', { ...target, remaining, portResult, passed: remaining === '' && portResult === 'ECONNREFUSED' }); assert.equal(remaining, ''); assert.equal(portResult, 'ECONNREFUSED');
    }
    save('loaded-dependencies.json', Object.keys(require.cache).filter(p => fs.existsSync(p)).map(p => ({ path: path.relative(path.resolve(__dirname, '../../..'), p).replaceAll('\\', '/'), sha256: sha(fs.readFileSync(p)) })).sort((a, b) => a.path.localeCompare(b.path)));
  }
  save('validation.json', { passed: true, fullWriteChainPassed: true, consumerIdentityPrecisionPassed: true, checks, operationCount: operations.length, negativeCount: negatives.length, lockWaitCount: waits.length, httpStarted: false, workerStarted: false, businesoRgaeptance: false }); console.log('B02_ISSUE_CLOSURE_WRITE_CHAIN_PASSED');
}
main().catch(e => { console.error(e.stack); process.exitCode = 1; });
