// B02 focused repository checks. --output must be a new directory under artifacts.
// Uses freshMysql's owned UUID/tmpfs container and synthetic rows only. No env file,
// formal service/database, worker, AI or notification. Finally removes owned resources.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { makeProcessDataGovernanceRepository, queueProcessDataGovernanceCreationTask } = require('../server/processDataGovernanceRepository');
const { makePublicationRepository } = require('../server/publicationRepository');
const { normalizePublication } = require('../server/publicationSpreadsheet');
const { digest } = require('../server/processDataGovernance');
const index = process.argv.indexOf('--output');
const output = index < 0 ? null : path.resolve(process.argv[index + 1] || '');
assert(output && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const checks = [];
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
const P = '9007199254740993', A = '9007199254740995', V = '9007199254740997';

async function main() {
  const previous = Object.fromEntries(['MDM_SYSTEM_ADMIN_ENABLED', 'PROCESS_DATA_GOVERNANCE_READ_ONLY'].map(key => [key, process.env[key]]));
  process.env.MDM_SYSTEM_ADMIN_ENABLED = '1'; delete process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY;
  let target;
  try {
    await withFreshMysql(async ({ pool, owner, database, containerId, port }) => {
      target = { owner, database, containerId, port }; save('owned-target.json', target);
      await makeIdentityMysqlRepository(pool).initSchema();
      await require('../server/processDataGovernanceMigration').applyProcessDataGovernance(pool);
      await require('../server/publicationSchema').managePublicationSchema(pool, 'apply');
      const migration = await pool.getConnection();
      try { await require('../server/systemAdminMigration').applySystemAdmin(migration); } finally { migration.release(); }
      for (const id of [91, 92]) await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)', [id, 'B02W_' + id, 'B02 synthetic ' + id]);
      const people = [
        { personId: P, accountId: A, authVersion: V, departmentId: 91, roles: ['mdm_lead'] },
        { personId: '9007199254741011', accountId: '9007199254741013', authVersion: V, departmentId: 91, roles: ['department_contact'] },
        { personId: 13, accountId: 113, authVersion: 1, departmentId: 91, roles: ['admin'] },
        { personId: 14, accountId: 114, authVersion: 1, departmentId: 91, roles: ['admin', 'mdm_lead', 'department_contact'] },
        { personId: 15, accountId: 115, authVersion: 1, departmentId: 91, roles: [] },
        { personId: 16, accountId: 116, authVersion: 1, departmentId: 92, roles: ['department_contact'] }
      ];
      for (const person of people) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)', [person.personId, 'B02W_' + person.personId, 'B02 synthetic', person.departmentId]);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-not-used','active',0,?)", [person.accountId, person.personId, 'B02W_' + person.personId, person.authVersion]);
        for (const role of person.roles) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?, 'B02 synthetic',CURRENT_DATE FROM roles WHERE role_code=?", [person.personId, ['admin', 'mdm_lead'].includes(role) ? 'global' : 'department', ['admin', 'mdm_lead'].includes(role) ? null : person.departmentId, role]);
      }
      const lead = people[0], contact = people[1], outsider = people[5];
      const system = { identityKind: 'system_admin', accountId: '9007199254741021', authVersion: V, personId: null };
      await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,must_change_password,account_status,auth_version,authorization_basis) VALUES (?,'admin','synthetic-not-used',0,'active',?,'B02 synthetic')", [system.accountId, V]);
      const forged = actor => ({ ...actor, roleCodes: new Set(['mdm_lead', 'department_contact']), permissions: new Set(['governance:assign-work', 'governance:structure-gate', 'governance:publish', 'governance:draft-department']) });
      const trace = [];
      const observedPool = new Proxy(pool, { get(target, key) {
        if (key === 'getConnection') return async () => {
          const connection = await pool.getConnection();
          return new Proxy(connection, { get(target, key) {
            if (key === 'execute') return async (sql, params = []) => {
              const item = { connectionId: connection.connection.threadId, accountLock: /user_accounts.*FOR UPDATE/s.test(sql), currentIdentityRead: /FOR SHARE\s*$/i.test(sql) && /FROM (person|roles|person_roles|role_permissions)/i.test(sql), finished: false };
              trace.push(item); try { return await connection.execute(sql, params); } finally { item.finished = true; }
            };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
          } });
        };
        const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
      } });
      const repo = makeProcessDataGovernanceRepository(observedPool), publications = makePublicationRepository(observedPool);
      let versionSerial = 0;
      async function version(format = 'v8') {
        const document = JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-' + format + '.json')));
        const key = 'B02W_' + (++versionSerial); document.process.process_ref = key; document.process.process_name = key;
        const [master] = await pool.execute("INSERT INTO process_design_documents(document_no,document_title,owning_department_id,process_ref) VALUES (?,?,91,?)", [key, key, key]);
        const [draft] = await pool.execute("INSERT INTO process_design_drafts(document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES (?,?,?,'A',?,'synthetic','synthetic','synthetic',91)", [master.insertId, key, key, key]);
        const [result] = await pool.execute("INSERT INTO process_design_versions(draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status) VALUES (?,?,?,?,'A',?,91,?,?,?,1,'published')", [draft.insertId, master.insertId, key, key, key + ':A', document.schema_version, JSON.stringify(document), digest(document)]);
        return result.insertId;
      }
      async function queue(id, actor) {
        const db = await observedPool.getConnection(); try { await db.beginTransaction(); const result = await queueProcessDataGovernanceCreationTask(db, id, actor); await db.commit(); return result; } catch (error) { await db.rollback(); throw error; } finally { db.release(); }
      }
      async function unchangedRejection(action, expected) {
        const before = await snapshot(); await assert.rejects(action, expected); assert.equal(await snapshot(), before, 'rejected actor must not mutate governance data or diagnostics');
      }
      async function snapshot() {
        const values = [];
        for (const table of ['creation_tasks', 'work_packages', 'details', 'fact_requests', 'reviews', 'events']) {
          const [rows] = await pool.query('SELECT * FROM process_data_governance_' + table + ' ORDER BY id'); values.push(rows);
        }
        const [published] = await pool.query('SELECT * FROM mdm_publications ORDER BY id'); values.push(published);
        return digest(values);
      }
      async function deniedMatrix(name, action, fact = false) {
        await check(name + ' rejects independent admin, admin overlay and forged route grants', async () => {
          for (const actor of [system, people[2], people[3]]) await unchangedRejection(() => action(forged(actor)), { code: 'PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY' });
          await unchangedRejection(() => action(forged(people[4])), { code: fact ? 'PROCESS_DATA_GOVERNANCE_FACT_RESPONSE_DENIED' : 'PROCESS_DATA_GOVERNANCE_MDM_ONLY' });
        });
      }
      async function afterWait(name, action, actor, mutate, restore, expected) {
        await check(name + ' revalidates after actual account lock wait', async () => {
          const blocker = await pool.getConnection(); let pending;
          const before = await snapshot();
          try {
            await blocker.beginTransaction();
            const [locked] = await blocker.execute('SELECT CAST(account_id AS CHAR) AS id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [actor.accountId]);
            assert.equal(locked[0].id, String(actor.accountId));
            const start = trace.length; let finished = false;
            pending = action(actor).then(value => ({ value }), error => ({ error })).finally(() => { finished = true; });
            const deadline = Date.now() + 10000; let observed;
            while (Date.now() < deadline) {
              const item = trace.slice(start).find(item => item.accountLock && !item.finished);
              if (item) {
                const [[row]] = await pool.query('SELECT COMMAND,STATE FROM information_schema.PROCESSLIST WHERE ID=?', [item.connectionId]);
                if (row?.COMMAND === 'Execute') { await new Promise(resolve => setTimeout(resolve, 150)); if (!finished) { observed = { connectionId: item.connectionId, state: row.STATE, heldAccountRowLock: true, protectedStatementPendingBeforeRelease: true }; break; } }
              }
              assert(!finished, 'write settled before protected lock wait'); await new Promise(resolve => setTimeout(resolve, 30));
            }
            assert(observed, 'actual protected account statement must wait');
            save('lock-' + name + '.json', observed);
            await mutate(blocker); await blocker.commit();
            const result = await pending; assert.equal(result.error?.code, expected, result.error?.stack || 'unexpected allowed write');
            assert.equal(await snapshot(), before);
          } finally { await blocker.rollback(); blocker.release(); if (pending) await pending; await restore(); }
        });
      }
      const revoke = db => db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=CAST(? AS SIGNED)", [P]);
      const restoreLead = () => pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=CAST(? AS SIGNED)", [P]);
      const loss = (name, action) => afterWait(name, action, lead, revoke, restoreLead, 'PROCESS_DATA_GOVERNANCE_MDM_ONLY');
      const source = await version();
      await check('queue pool/autocommit branch is suspended without writes', () => unchangedRejection(() => queueProcessDataGovernanceCreationTask(pool, source, lead), { code: 'PROCESS_DATA_GOVERNANCE_TRANSACTION_REQUIRED' }));
      await deniedMatrix('queue', actor => queue(source, actor));
      await loss('queue', actor => queue(source, actor)); await queue(source, lead);
      await deniedMatrix('materialize', actor => repo.materializeCreationTask(source, actor));
      await loss('materialize', actor => repo.materializeCreationTask(source, actor));
      let work = (await repo.materializeCreationTask(source, lead)).package;
      const revision = async () => (await repo.getWorkPackageDetail(work.id)).package.revision_no;
      const generate = async actor => repo.generateCandidates(work.id, await revision(), actor);
      await deniedMatrix('generate', generate); await loss('generate', generate); await generate(lead);
      let detail = (await repo.getWorkPackageDetail(work.id)).details[0]; assert(detail);
      const update = async actor => repo.updateDetail(work.id, detail.id, await revision(), { status: 'not_applicable', governance: { basis: 'B02 synthetic basis' } }, actor);
      await deniedMatrix('update', update); await loss('update', update); await update(lead);
      const request = async actor => repo.createFactRequest(work.id, await revision(), { detail_id: detail.id, target_department_id: 91, requested_fact_type: 'process_fact', question_text: 'B02 synthetic question', request_reason: 'B02 synthetic reason' }, actor);
      await deniedMatrix('request', request); await loss('request', request);
      const fact = (await request(lead)).fact_request;
      const respond = async actor => repo.respondFactRequest(fact.id, await revision(), { answer_text: 'B02 synthetic answer', evidence_ref: 'B02 synthetic evidence' }, actor);
      await deniedMatrix('respond', respond, true);
      await check('fact response uses current department and rejects cross-department', () => unchangedRejection(() => respond({ ...outsider, departmentId: 91 }), { code: 'PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED' }));
      await afterWait('respond-department', respond, contact,
        db => db.execute('UPDATE person SET current_department_id=92 WHERE person_id=CAST(? AS SIGNED)', [contact.personId]),
        () => pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=CAST(? AS SIGNED)', [contact.personId]), 'PROCESS_DATA_GOVERNANCE_FACT_RESPONSE_DENIED');
      await afterWait('respond-password', respond, contact,
        db => db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)', [contact.accountId]),
        () => pool.execute('UPDATE user_accounts SET auth_version=CAST(? AS SIGNED) WHERE account_id=CAST(? AS SIGNED)', [V, contact.accountId]), 'PROCESS_DATA_GOVERNANCE_ACCESS_CHANGED');
      // Disabling the account while the request waits for the business lock must be re-read from
      // the current row, not from the caller-supplied actor snapshot.
      await afterWait('respond-disabled', respond, contact,
        db => db.execute("UPDATE user_accounts SET account_status='disabled' WHERE account_id=CAST(? AS SIGNED)", [contact.accountId]),
        () => pool.execute("UPDATE user_accounts SET account_status='active' WHERE account_id=CAST(? AS SIGNED)", [contact.accountId]), 'PROCESS_DATA_GOVERNANCE_ACCESS_CHANGED');
      const answered = await respond(contact); assert.equal(answered.fact_request.answered_by_person_id, contact.personId); assert.equal(answered.fact_request.requested_by_person_id, P);
      const close = async actor => repo.closeFactRequest(fact.id, await revision(), { basis: 'B02 synthetic close' }, actor);
      await deniedMatrix('close', close); await loss('close', close); await close(lead);
      await update(lead);
      const complete = async actor => repo.completeWorkPackage(work.id, await revision(), 'B02 synthetic review', actor);
      await deniedMatrix('complete', complete); await loss('complete', complete);
      await check('completion separately requires existing publish permission', async () => {
        const [[role]] = await pool.execute("SELECT role_id FROM roles WHERE role_code='mdm_lead'");
        await pool.execute("UPDATE role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE rp.role_id=? AND p.perm_code='governance:publish'", [role.role_id]);
        try { await unchangedRejection(() => complete(lead), { code: 'PROCESS_DATA_GOVERNANCE_COMPLETE_DENIED' }); }
        finally { await pool.execute("UPDATE role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='allow' WHERE rp.role_id=? AND p.perm_code='governance:publish'", [role.role_id]); }
      });
      const completed = await complete(lead); assert.equal(completed.review.actor_person_id, P);
      await check('BIGINT actor is exact in all audits and legacy safe integers retain number type', async () => {
        const final = await repo.getWorkPackageDetail(work.id); assert.equal(final.reviews[0].actor_person_id, P);
        assert(final.events.every(event => [P, contact.personId].includes(event.actor_person_id)));
        assert.equal(final.source_version.schema_version, 'process-governance-v8');
        const legacy = await repo.queueAndMaterialize(await version('v7'), lead); assert.equal(legacy.package.schema_version, 'process-governance-v7');
        assert.equal(typeof legacy.package.id, 'number');
      });
      await check('creation and materialization stay separate; changed session after queue commit leaves queued task untouched', async () => {
        const id = await version(); let commits = 0, begins = 0;
        const boundaryPool = { async getConnection() { const db = await pool.getConnection(); return new Proxy(db, { get(target, key) {
          if (key === 'beginTransaction') return async () => { begins++; return db.beginTransaction(); };
          if (key === 'commit') return async () => { await db.commit(); if (++commits === 1) await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)', [A]); };
          const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
        } }); }, execute: pool.execute.bind(pool) };
        try { await assert.rejects(makeProcessDataGovernanceRepository(boundaryPool).queueAndMaterialize(id, lead), { code: 'PROCESS_DATA_GOVERNANCE_ACCESS_CHANGED' });
          const [[task]] = await pool.execute('SELECT status,attempt_count,last_error_code FROM process_data_governance_creation_tasks WHERE process_version_id=?', [id]);
          assert.deepEqual(task, { status: 'queued', attempt_count: 0, last_error_code: null }); assert.equal(begins, 2); assert.equal(commits, 1);
          const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM process_data_governance_work_packages WHERE process_version_id=?', [id]); assert.equal(count.n, 0);
        } finally { await pool.execute('UPDATE user_accounts SET auth_version=CAST(? AS SIGNED) WHERE account_id=CAST(? AS SIGNED)', [V, A]); }
      });
      await check('failed source binding preserves operational diagnostics after rollback without allowing rejected actors to write', async () => {
        const id = await version(); await queue(id, lead);
        await pool.execute("UPDATE process_design_versions SET content_hash=? WHERE id=?", ['0'.repeat(64), id]);
        await unchangedRejection(() => repo.materializeCreationTask(id, people[4]), { code: 'PROCESS_DATA_GOVERNANCE_MDM_ONLY' });
        await assert.rejects(() => repo.materializeCreationTask(id, lead), { code: 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED' });
        const [[task]] = await pool.execute('SELECT status,attempt_count,last_error_code,last_error_message,next_retry_at FROM process_data_governance_creation_tasks WHERE process_version_id=?', [id]);
        assert.equal(task.status, 'failed'); assert.equal(task.attempt_count, 0);
        assert.equal(task.last_error_code, 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED');
        assert(task.last_error_message); assert(task.next_retry_at);
        const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM process_data_governance_work_packages WHERE process_version_id=?', [id]); assert.equal(count.n, 0);
      });
      for (const diagnosticFails of [false, true]) await check('storage failure rolls back and preserves the original error; diagnostic failure=' + diagnosticFails, async () => {
        const id = await version(); await queue(id, lead);
        const primaryError = Object.assign(new Error('Synthetic materialization storage failure'), { code: 'B02_STORAGE_FAILED' });
        const failurePool = { async getConnection() {
          const db = await observedPool.getConnection(); return new Proxy(db, { get(target, key) {
            if (key === 'execute') return async (sql, params) => {
              if (/INSERT INTO process_data_governance_work_packages/.test(sql)) throw primaryError;
              return db.execute(sql, params);
            };
            const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
          } });
        }, async execute(sql, params) {
          if (diagnosticFails) throw new Error('Synthetic diagnostic storage failure');
          return pool.execute(sql, params);
        } };
        await assert.rejects(() => makeProcessDataGovernanceRepository(failurePool).materializeCreationTask(id, lead), error => error === primaryError);
        const [[task]] = await pool.execute('SELECT status,attempt_count,last_error_code,next_retry_at FROM process_data_governance_creation_tasks WHERE process_version_id=?', [id]);
        assert.equal(task.attempt_count, 0);
        assert.equal(task.status, diagnosticFails ? 'queued' : 'failed');
        assert.equal(task.last_error_code, diagnosticFails ? null : 'B02_STORAGE_FAILED');
        assert.equal(Boolean(task.next_retry_at), !diagnosticFails);
        const [[count]] = await pool.execute('SELECT COUNT(*) AS n FROM process_data_governance_work_packages WHERE process_version_id=?', [id]); assert.equal(count.n, 0);
      });
      await check('failed recheck cannot downgrade an already completed creation task', async () => {
        const id = await version(); await repo.queueAndMaterialize(id, lead);
        await pool.execute("UPDATE process_design_versions SET content_hash=? WHERE id=?", ['0'.repeat(64), id]);
        await assert.rejects(() => repo.materializeCreationTask(id, lead), { code: 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED' });
        const [[task]] = await pool.execute('SELECT status,last_error_code,next_retry_at FROM process_data_governance_creation_tasks WHERE process_version_id=?', [id]);
        assert.deepEqual(task, { status: 'completed', last_error_code: null, next_retry_at: null });
      });
      const normalized = normalizePublication({ kind: 'master_data', title: 'B02 synthetic', sourceFileName: 'synthetic.csv', headers: ['code', 'name'], rows: [['A', 'synthetic']], keyHeader: 'code', mapping: {} });
      const reviewed = await publications.preview(normalized, 'b02_synthetic');
      const input = { ...reviewed, content: normalized.content, datasetKey: 'b02_synthetic', requestId: crypto.randomUUID() };
      const publish = actor => publications.publish(input, actor);
      await check('publication independent admin, overlay, no permission and wrong account refused', async () => {
        await assert.rejects(publish(system), { code: 'PUBLICATION_INPUT_INVALID' });
        for (const actor of [people[2], people[3], people[4], { ...lead, accountId: '9007199254740994' }]) await assert.rejects(publish(forged(actor)), { code: 'PUBLICATION_ACCESS_CHANGED' });
      });
      await afterWait('publication-revoke', publish, lead, revoke, restoreLead, 'PUBLICATION_ACCESS_CHANGED');
      await afterWait('publication-password', publish, lead,
        db => db.execute('UPDATE user_accounts SET must_change_password=1 WHERE account_id=CAST(? AS SIGNED)', [A]),
        () => pool.execute('UPDATE user_accounts SET must_change_password=0 WHERE account_id=CAST(? AS SIGNED)', [A]), 'PUBLICATION_ACCESS_CHANGED');
      await check('publication exact actor, idempotency and immutable readback preserve source digest', async () => {
        const result = await publish(lead); assert.equal(result.published_by_person_id, P);
        assert.equal((await publish(lead)).id, result.id);
        const old = await publications.get(result.id); assert.equal(old.published_by_person_id, P); assert.equal(old.content_hash, normalized.contentHash); assert.deepEqual(old.content.rows, normalized.content.rows);
        assert(trace.some(item => item.currentIdentityRead));
      });
      save('results.json', { checks, passed: true, dependency: 'owned real MySQL; synthetic rows', target });
    }, { stage: '02', randomDatabase: true });
    save('cleanup.json', { ...target, removed: true });
  } finally {
    for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
}
main().catch(error => { save('failure.json', { code: error.code, message: error.message, stack: error.stack, checks }); console.error(error.stack); process.exitCode = 1; });
