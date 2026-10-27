// Actual MySQL 8.4 qualification/lock verification. Creates two fresh owner-labelled
// tmpfs containers (one per v4/v5 fixture), random loopback ports and databases.
// No env file, existing service or formal database is read. Output: artifacts JSON.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { handoffActor, assertApprover, inspectHandoffAccessModel } = require('../server/dataMapHandoffAuthority');
const v4 = require('../server/accessModelV4Baseline');
const v5 = require('../server/roleDefinitions');
const output = path.resolve(process.argv[2] || path.join(__dirname, '../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/authority-' + crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert(!fs.existsSync(output), 'fresh evidence directory required');
fs.mkdirSync(output, { recursive: true });
const checks = [], races = [], targets = [], holds = [];
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const outcome = async work => { try { return { ok: true, result: await work() }; } catch (error) { return { ok: false, code: error.code, statusCode: error.statusCode }; } };
async function check(model, name, work) { await work(); checks.push({ model, name, passed: true }); console.log('PASS ' + model + ' ' + name); }
async function waitForLock(pool, database, connectionId, table) {
  for (let i = 0; i < 400; i++) {
    const [waits] = await pool.query(`SELECT r.OBJECT_NAME,r.INDEX_NAME,r.LOCK_MODE,r.LOCK_DATA,
      t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection,b.LOCK_MODE blocking_mode
      FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
      JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID
      WHERE r.OBJECT_SCHEMA=? AND t.PROCESSLIST_ID=? AND r.OBJECT_NAME=?`, [database, connectionId, table]);
    if (waits.length) return waits;
    await sleep(15);
  }
  throw Error('No actual InnoDB wait on ' + table);
}

async function scenario(model) {
  await withFreshMysql(async target => {
    const { pool, database, owner, port, containerId } = target;
    const targetRecord = { model: model.ACCESS_MODEL_VERSION, database, owner, port, containerId, storage: 'owner-labelled tmpfs', existingDatabase: false };
    targets.push(targetRecord); save('owned-targets.json', targets);
    for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await pool.execute(sql);
    await pool.execute(splitSqlStatements(require('../server/governanceResponsibilitiesMigration').SCHEMA_SQL)[0]);
    for (const role of model.ROLE_GUIDES) {
      await pool.execute('INSERT INTO roles(role_code,role_name,role_group,status,model_version) VALUES (?,?,?,\'active\',?)', [role.code, role.name, role.code === 'admin' ? 'system' : role.code === 'hr_directory_manager' ? 'directory' : 'mdm', model.ACCESS_MODEL_VERSION]);
      for (const p of role.permissions) {
        await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action,default_scope) VALUES (?,?,?,?)', [p.code, p.resource, p.action, p.defaultScope || 'department']);
        await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?", [p.code, role.code]);
      }
    }
    await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'SYNTH_A','Synthetic A'),(92,'SYNTH_B','Synthetic B')");
    const people = [
      ['11', '111', 'mdm_lead', null], ['12', '112', 'mdm_steward', null], ['13', '113', 'admin', null],
      ['14', '114', 'department_contact', '91'], ['15', '115', 'department_contact', '92'],
      ['16', '116', 'data_conflict_handler', null], ['17', '117', 'decision_group', null], ['18', '118', 'department_mdm_reviewer', '91'],
      ['19', '119', 'mdm_steward', null], ['9007199254740993', '9007199254741093', 'mdm_lead', null]
    ];
    for (const [person, account, role, department] of people) {
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(CAST(? AS SIGNED),?,?,?)', [person, 'SYNTH_' + person, 'Synthetic ' + person, department || '91']);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(CAST(? AS SIGNED),CAST(? AS SIGNED),?,'unusable-synthetic-password-hash','active')", [account, person, 'SYNTH_' + person]);
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,CAST(? AS SIGNED),'synthetic fixture authorization',CURRENT_DATE FROM roles WHERE role_code=?", [person, department ? 'department' : 'global', department, role]);
    }
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 13,role_id,'global','synthetic admin overlap',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
    await pool.execute('UPDATE departments SET final_responsible_person_id=18 WHERE id=91');
    const policy = await pool.getConnection();
    try { await require('../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(policy); } finally { policy.release(); }
    await pool.execute("INSERT INTO process_governance_responsibilities(target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id) VALUES('work_package',501,'steward','synthetic-process',12,91,1,'synthetic current assignment',11)");
    // Minimal fact/conflict targets retain the real authority-column contract;
    // other governance-source/publishing behaviour belongs to its own suite.
    await pool.execute("CREATE TABLE process_data_governance_fact_requests(id BIGINT PRIMARY KEY,work_package_id BIGINT,target_department_id BIGINT,status VARCHAR(24)) ENGINE=InnoDB");
    await pool.execute("INSERT INTO process_data_governance_fact_requests VALUES(601,501,91,'open'),(602,502,92,'open')");
    await pool.execute('CREATE TABLE process_data_governance_fact_versions(fact_version_id CHAR(36) PRIMARY KEY,fact_id VARCHAR(96),package_id BIGINT,revision_no INT,snapshot_json JSON,UNIQUE KEY uq_authority_fact_revision(fact_id,revision_no)) ENGINE=InnoDB');
    const correctionFactId = crypto.randomUUID();
    await pool.execute('INSERT INTO process_data_governance_fact_versions VALUES(?,?,501,1,?)', [crypto.randomUUID(), correctionFactId, JSON.stringify({ fact_id: correctionFactId, target_department_id: '91', status: 'open' })]);
    await pool.execute("CREATE TABLE data_map_handoff_conflicts(conflict_id CHAR(36) PRIMARY KEY,package_id BIGINT,state VARCHAR(24),assignee_person_id BIGINT,decision_person_id BIGINT,revision_no INT) ENGINE=InnoDB");
    const conflictId = crypto.randomUUID();
    await pool.execute("INSERT INTO data_map_handoff_conflicts VALUES(?,501,'escalated',16,17,1)", [conflictId]);
    await pool.execute('CREATE TABLE handoff_authority_probes(id INT PRIMARY KEY,protected_writes INT NOT NULL) ENGINE=InnoDB');
    await pool.execute('INSERT INTO handoff_authority_probes VALUES(1,0)');
    const session = person => { const p = people.find(row => row[0] === String(person)); return { personId: p[0], accountId: p[1], authVersion: '1', departmentId: 'forged-client-department', permissions: new Set(['governance:publish']), roleCode: 'mdm_lead' }; };
    async function transaction(work) { const db = await pool.getConnection(); try { await db.beginTransaction(); const result = await work(db); await db.rollback(); return result; } catch (error) { await db.rollback(); throw error; } finally { db.release(); } }
    const actor = (person, action, extra = {}) => transaction(db => handoffActor(db, session(person), action, { packageId: '501', ...extra }));
    const deny = (work, code) => assert.rejects(work, { code });
    const name = model.ACCESS_MODEL_VERSION;
    await check(name, 'actual target model selected without model migration or permission creation', async () => { assert.equal(await inspectHandoffAccessModel(pool, { lock: false }), name); assert.equal((await actor(11, 'approve')).modelVersion, name); });
    await check(name, 'lead/steward/current assignment and admin overlap action matrix', async () => {
      for (const action of ['read', 'prepare', 'review', 'approve', 'publish', 'withdraw', 'restore']) assert.equal((await actor(11, action)).roleCode, 'mdm_lead');
      for (const action of ['read', 'prepare']) assert.equal((await actor(12, action)).roleCode, 'mdm_steward');
      for (const action of ['review', 'approve', 'publish']) await deny(() => actor(12, action), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(19, 'prepare'), 'HANDOFF_ACTION_DENIED');
      assert((await actor(13, 'read')).roleCodes.has('admin'));
      for (const action of ['prepare', 'approve', 'publish', 'withdraw', 'fact_answer']) await deny(() => actor(13, action, action === 'fact_answer' ? { factRequestId: '601' } : {}), 'HANDOFF_ADMIN_READ_ONLY');
      await deny(() => handoffActor(pool, { identityKind: 'system_admin' }, 'publish'), 'HANDOFF_ADMIN_READ_ONLY');
    });
    await check(name, 'targeted department facts, final person and MDM closure remain distinct', async () => {
      assert.equal((await actor(14, 'fact_answer', { factRequestId: '601' })).departmentId, '91');
      await deny(() => actor(14, 'read'), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(14, 'prepare'), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(15, 'fact_answer', { factRequestId: '601' }), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(14, 'fact_answer', { factRequestId: '602' }), 'HANDOFF_FACT_SCOPE_DENIED');
      await deny(() => actor(14, 'fact_answer'), 'HANDOFF_FACT_SCOPE_REQUIRED');
      assert((await actor(18, 'fact_confirm', { factRequestId: '601' })).permissions.has('governance:record-department-decision'));
      await deny(() => actor(14, 'fact_confirm', { factRequestId: '601' }), 'HANDOFF_ACTION_DENIED');
      await pool.execute("UPDATE process_data_governance_fact_requests SET status='answered' WHERE id=601");
      assert.equal((await actor(12, 'fact_close', { factRequestId: '601' })).roleCode, 'mdm_steward');
      await deny(() => actor(14, 'fact_close', { factRequestId: '601' }), 'HANDOFF_ACTION_DENIED');
      await pool.execute("UPDATE process_data_governance_fact_requests SET status='closed' WHERE id=601");
      await deny(() => actor(14, 'fact_answer', { factRequestId: '601' }), 'HANDOFF_FACT_NOT_OPEN');
      assert.equal((await actor(14, 'fact_read', { factRequestId: '601', lock: false })).factScope.status, 'closed');
      await pool.execute("UPDATE process_data_governance_fact_requests SET status='open' WHERE id=601");
    });
    await check(name, 'UUID correction fact reads use latest revision and closed-receipt scope stays readable', async () => {
      const scope = { factRequestId: correctionFactId, factKind: 'handoff_correction' };
      assert.equal((await actor(14, 'fact_answer', scope)).factScope.department_id, '91');
      await deny(() => actor(15, 'fact_answer', scope), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(14, 'fact_answer', { ...scope, packageId: '502' }), 'HANDOFF_FACT_SCOPE_DENIED');
      await pool.execute('INSERT INTO process_data_governance_fact_versions VALUES(?,?,501,2,?)', [crypto.randomUUID(), correctionFactId, JSON.stringify({ fact_id: correctionFactId, target_department_id: '91', status: 'answered' })]);
      assert.equal((await actor(14, 'fact_read', { ...scope, lock: false })).factScope.revision_no, 2);
      assert.equal((await actor(12, 'fact_close', scope)).factScope.status, 'answered');
      await deny(() => actor(14, 'fact_answer', scope), 'HANDOFF_FACT_NOT_OPEN');
      await deny(() => actor(14, 'fact_close', scope), 'HANDOFF_ACTION_DENIED');
      await pool.execute('INSERT INTO process_data_governance_fact_versions VALUES(?,?,501,3,?)', [crypto.randomUUID(), correctionFactId, JSON.stringify({ fact_id: correctionFactId, target_department_id: '91', status: 'closed' })]);
      assert.equal((await actor(14, 'fact_read', { ...scope, lock: false })).factScope.status, 'closed');
    });
    await check(name, 'independent administrator remains exact authenticated read-only principal in both actual models', async () => {
      const adminMigration = require('../server/systemAdminMigration');
      for (const sql of splitSqlStatements(adminMigration.SCHEMA_SQL)) await pool.execute(sql);
      await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)', [adminMigration.MIGRATION_KEY]);
      await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,must_change_password,authorization_basis) VALUES(901,'admin','unusable-synthetic-password-hash',0,'synthetic fixture authorization')");
      const system = { identityKind: 'system_admin', userId: 'system-admin:901', accountId: '901', authVersion: '1' };
      const previous = process.env.MDM_SYSTEM_ADMIN_ENABLED;
      try {
        process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
        const current = await transaction(db => handoffActor(db, system, 'read', { lock: false }));
        assert.equal(current.personId, null); assert.equal(current.userId, 'system-admin:901'); assert.equal(current.modelVersion, name);
        await deny(() => handoffActor(pool, system, 'prepare'), 'HANDOFF_ADMIN_READ_ONLY');
        await deny(() => handoffActor(pool, { ...system, authVersion: '2' }, 'read', { lock: false }), 'HANDOFF_ACCESS_CHANGED');
        await pool.execute("UPDATE system_admin_accounts SET account_status='disabled' WHERE account_id=901");
        await deny(() => handoffActor(pool, system, 'read', { lock: false }), 'HANDOFF_ACCESS_CHANGED');
      } finally { if (previous === undefined) delete process.env.MDM_SYSTEM_ADMIN_ENABLED; else process.env.MDM_SYSTEM_ADMIN_ENABLED = previous; }
    });
    await check(name, 'conflict assignee and escalated decision scope are exact', async () => {
      assert((await actor(16, 'conflict', { conflictId })).permissions.has('governance:handle-assigned-conflict'));
      assert((await actor(16, 'escalate', { conflictId })).permissions.has('governance:escalate-conflict'));
      assert((await actor(17, 'decide', { conflictId })).permissions.has('governance:read-escalated-context'));
      await deny(() => actor(11, 'conflict', { conflictId }), 'HANDOFF_ACTION_DENIED');
      await deny(() => actor(17, 'decide', { conflictId, packageId: '502' }), 'HANDOFF_CONFLICT_SCOPE_DENIED');
      await pool.execute("UPDATE data_map_handoff_conflicts SET state='open' WHERE conflict_id=?", [conflictId]);
      await deny(() => actor(17, 'decide', { conflictId }), 'HANDOFF_ACTION_DENIED');
      await pool.execute("UPDATE data_map_handoff_conflicts SET state='escalated' WHERE conflict_id=?", [conflictId]);
    });
    await check(name, 'current effect deny and insufficient scope cannot be bypassed by role name or session cache', async () => {
      await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE r.role_code='mdm_lead' AND p.perm_code='governance:publish'");
      await deny(() => actor(11, 'publish'), 'HANDOFF_ACTION_DENIED');
      await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='allow' WHERE r.role_code='mdm_lead' AND p.perm_code='governance:publish'");
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.scope_type='department',pr.scope_department_id=91 WHERE pr.person_id=11 AND r.role_code='mdm_lead'");
      await deny(() => actor(11, 'approve'), 'HANDOFF_ACTION_DENIED');
      await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.scope_type='global',pr.scope_department_id=NULL WHERE pr.person_id=11 AND r.role_code='mdm_lead'");
    });
    await check(name, 'actual required permission readonly fields are checked with exact keys and invalidate prior approval', async () => {
      const approved = (await actor(11, 'approve')).qualificationSnapshot;
      await pool.execute("UPDATE permissions SET field_constraints=? WHERE perm_code='governance:publish'", [JSON.stringify({ readonly: ['definition.name', 'immutable_code'] })]);
      try {
        await deny(() => actor(11, 'publish'), 'HANDOFF_FIELD_SCOPE_REQUIRED');
        await deny(() => actor(11, 'publish', { writeFields: ['definition.name'] }), 'HANDOFF_FIELDS_READ_ONLY');
        assert.equal((await actor(11, 'publish', { writeFields: ['reason'] })).roleCode, 'mdm_lead');
        // Publishing constraints do not invent constraints on prepare/review.
        assert.equal((await actor(11, 'prepare')).roleCode, 'mdm_lead');
        await deny(() => transaction(db => assertApprover(db, approved, { packageId: '501' })), 'HANDOFF_APPROVER_CHANGED');
      } finally { await pool.execute("UPDATE permissions SET field_constraints=NULL WHERE perm_code='governance:publish'"); }
    });
    await check(name, 'exact BIGINT actor and approval qualification bound to current auth version and assignment', async () => {
      assert.equal((await actor('9007199254740993', 'publish')).personId, '9007199254740993');
      const approved = (await actor(11, 'approve')).qualificationSnapshot;
      await transaction(db => assertApprover(db, approved, { packageId: '501' }));
      await pool.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=111');
      await deny(() => transaction(db => assertApprover(db, approved, { packageId: '501' })), 'HANDOFF_APPROVER_CHANGED');
      await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=111');
      await pool.execute('UPDATE process_governance_responsibilities SET revision_no=2 WHERE target_id=501');
      await deny(() => transaction(db => assertApprover(db, approved, { packageId: '501' })), 'HANDOFF_APPROVER_CHANGED');
      await pool.execute('UPDATE process_governance_responsibilities SET revision_no=1 WHERE target_id=501');
    });
    async function race(label, person, table, lockSql, lockParams, mutate, restore, expected, action = 'prepare', extra = {}) {
      const blocker = await pool.getConnection(), contender = await pool.getConnection(); let pending;
      try {
        await blocker.beginTransaction(); await blocker.execute(lockSql, lockParams);
        await contender.beginTransaction();
        await contender.execute('SELECT person_id FROM person WHERE person_id=?', [String(person)]); // establishes stale RR snapshot
        pending = outcome(async () => { await handoffActor(contender, session(person), action, { packageId: '501', ...extra }); await contender.execute('UPDATE handoff_authority_probes SET protected_writes=protected_writes+1 WHERE id=1'); await contender.commit(); return 'committed'; });
        const waits = await waitForLock(pool, database, contender.connection.threadId, table);
        await mutate(blocker); await blocker.commit(); const result = await pending;
        assert.equal(result.ok, false, label); assert.equal(result.code, expected, label); await contender.rollback();
        assert.equal(Number((await pool.execute('SELECT protected_writes FROM handoff_authority_probes'))[0][0].protected_writes), 0);
        races.push({ model: name, label, table, waits, result, staleRepeatableReadSnapshot: true, protectedWrites: 0 }); save('lock-waits.json', races);
      } finally { await blocker.rollback(); await contender.rollback(); if (pending) await pending; blocker.release(); contender.release(); await restore(); }
    }
    await check(name, 'actual RR waits reject revoke, account disable, department change, generation and package reassignment', async () => {
      const accountLock = 'SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE';
      await race('role-revoked-during-wait', 12, 'user_accounts', accountLock, ['112'], db => db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=12"), () => pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=12"), 'HANDOFF_ACTION_DENIED');
      await race('account-disabled-during-wait', 12, 'user_accounts', accountLock, ['112'], db => db.execute("UPDATE user_accounts SET account_status='disabled' WHERE account_id=112"), () => pool.execute("UPDATE user_accounts SET account_status='active' WHERE account_id=112"), 'HANDOFF_ACCESS_CHANGED');
      await race('generation-changed-during-wait', 12, 'user_accounts', accountLock, ['112'], db => db.execute('UPDATE user_accounts SET auth_version=2 WHERE account_id=112'), () => pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=112'), 'HANDOFF_ACCESS_CHANGED');
      await race('fact-department-changed-during-wait', 14, 'user_accounts', accountLock, ['114'], db => db.execute('UPDATE person SET current_department_id=92 WHERE person_id=14'), () => pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=14'), 'HANDOFF_ACTION_DENIED', 'fact_answer', { factRequestId: '601' });
      await race('assignment-changed-during-wait', 12, 'process_governance_responsibilities', "SELECT id FROM process_governance_responsibilities WHERE target_type='work_package' AND target_id=501 AND assignment_kind='steward' FOR UPDATE", [], db => db.execute('UPDATE process_governance_responsibilities SET person_id=19,revision_no=2 WHERE target_id=501'), () => pool.execute('UPDATE process_governance_responsibilities SET person_id=12,revision_no=1 WHERE target_id=501'), 'HANDOFF_ACTION_DENIED');
    });
    await check(name, 'person-role insertion gap and current permissions remain locked through caller commit', async () => {
      const reader = await pool.getConnection(), writer = await pool.getConnection(); let pending;
      try {
        await reader.beginTransaction(); await handoffActor(reader, session(11), 'approve', { packageId: '501' });
        const [locks] = await pool.query(`SELECT l.OBJECT_NAME,l.INDEX_NAME,l.LOCK_TYPE,l.LOCK_MODE,l.LOCK_STATUS FROM performance_schema.data_locks l
          JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE l.OBJECT_SCHEMA=? AND t.PROCESSLIST_ID=?`, [database, reader.connection.threadId]);
        for (const table of ['user_accounts', 'person', 'person_roles', 'roles', 'permissions', 'role_permissions', 'process_governance_responsibilities']) assert(locks.some(row => row.OBJECT_NAME === table && row.LOCK_STATUS === 'GRANTED'), table);
        await writer.beginTransaction();
        pending = writer.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 11,role_id,'global','synthetic concurrent role insertion',CURRENT_DATE FROM roles WHERE role_code='admin'");
        const waits = await waitForLock(pool, database, writer.connection.threadId, 'person_roles');
        await reader.commit(); await pending; await writer.rollback();
        holds.push({ model: name, locks, waits, roleInsertionBlockedThroughCallerCommit: true }); save('qualification-lock-retention.json', holds);
      } finally { await reader.rollback(); await writer.rollback(); if (pending) await pending; reader.release(); writer.release(); }
    });
    if (name === v5.ACCESS_MODEL_VERSION) await check(name, 'actual current account-maintenance role grant waits for caller qualification transaction and invalidates approval', async () => {
      const reader = await pool.getConnection(); let pending, maintenanceConnectionId;
      const maintenancePool = { async getConnection() { const db = await pool.getConnection(); maintenanceConnectionId = db.connection.threadId; return db; } };
      const context = { kind: 'person', personId: '13', accountId: '113', authVersion: '1', method: 'POST', body: { roleCode: true, authorizationBasis: true, effectiveFrom: true } };
      const repository = require('../server/governanceAccessMysqlRepository').makeGovernanceAccessMysqlRepository(maintenancePool, context);
      try {
        await reader.beginTransaction(); const approved = (await handoffActor(reader, session(11), 'approve', { packageId: '501' })).qualificationSnapshot;
        pending = outcome(() => repository.grantRole('11', { roleCode: 'admin', scopeType: 'global', authorizationBasis: 'synthetic actual account-maintenance grant', effectiveFrom: '2000-01-01', actorPersonId: '13' }));
        for (let i = 0; !maintenanceConnectionId && i < 400; i++) await sleep(5);
        assert(maintenanceConnectionId);
        const waits = await waitForLock(pool, database, maintenanceConnectionId, 'person_roles');
        await reader.commit(); const result = await pending; assert.equal(result.ok, true);
        const account = (await pool.execute('SELECT auth_version FROM user_accounts WHERE account_id=111'))[0][0];
        assert.equal(String(account.auth_version), '2');
        await deny(() => transaction(db => assertApprover(db, approved, { packageId: '501' })), 'HANDOFF_APPROVER_CHANGED');
        await deny(() => transaction(db => handoffActor(db, { ...session(11), authVersion: '2' }, 'prepare', { packageId: '501' })), 'HANDOFF_ADMIN_READ_ONLY');
        holds.push({ model: name, actualMaintenance: 'governanceAccessMysqlRepository.grantRole', waits, accountAuthVersionAfter: '2', oldApprovalInvalidated: true }); save('qualification-lock-retention.json', holds);
      } finally {
        await reader.rollback(); if (pending) await pending; reader.release();
        await pool.execute("DELETE pr FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=11 AND r.role_code='admin'");
        await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=111');
      }
    });
    await check(name, 'unsupported or mixed actual target models fail closed and no automatic migration occurs', async () => {
      await pool.execute("UPDATE roles SET model_version='synthetic-unverified' WHERE role_code='mdm_lead'");
      await deny(() => actor(11, 'prepare'), 'HANDOFF_ACCESS_MODEL_UNSUPPORTED');
      assert.equal((await pool.execute("SELECT model_version FROM roles WHERE role_code='mdm_lead'"))[0][0].model_version, 'synthetic-unverified');
      await pool.execute('UPDATE roles SET model_version=? WHERE role_code=\'mdm_lead\'', [name]);
    });
    targetRecord.fixtureModelsRetained = (await pool.execute('SELECT DISTINCT model_version FROM roles'))[0].map(row => row.model_version);
    assert.deepEqual(targetRecord.fixtureModelsRetained, [name]); save('owned-targets.json', targets);
  }, { stage: '04', randomDatabase: true });
  targets.at(-1).cleaned = true; save('owned-targets.json', targets);
}

async function main() {
  let passed = false, failure;
  try { await scenario(v4); await scenario(v5); passed = true; }
  catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error; }
  finally { save('results.json', { passed, checks, races: races.length, targets, qualificationLocks: holds.length, failure,
    formalDatabaseAccess: false, modelMigration: false, featureEnabled: false, businessAccepted: false }); }
  console.log('PASS HANDOFF_AUTHORITY_MYSQL ' + checks.length + ' checks, ' + races.length + ' real lock waits, evidence ' + output);
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
