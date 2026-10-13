// B02 ordinary preview writes on an owned UUID/tmpfs MySQL only.
// Input: --output <new artifacts directory>. Output: checks, lock evidence, cleanup.
// No env file, formal DB/service, worker, AI, notification or runtime replacement.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { makeProcessV7PreviewReviewRepository } = require('../server/processV7PreviewReviewRepository');
const { validateAndProjectV7 } = require('../server/processV7PreviewReview');
const { sameIdentityInteger } = require('../server/sessionSubject');
const at = process.argv.indexOf('--output');
const output = at < 0 ? null : path.resolve(process.argv[at + 1] || '');
assert(output && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
const P = '9007199254740993', A = '9007199254740995', V = '9007199254740997';
// These adjacent departments round to the same Number. Their identities must differ.
const D = '9007199254740992', E = '9007199254740993';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const flags = ['PROCESS_V7_PREVIEW_ENABLED', 'PROCESS_V7_FORMAL_ENABLED', 'PROCESS_V7_AUTHORING_ENABLED'];
  const previous = Object.fromEntries(flags.map(key => [key, process.env[key]]));
  process.env.PROCESS_V7_PREVIEW_ENABLED = '1'; process.env.PROCESS_V7_FORMAL_ENABLED = '1'; process.env.PROCESS_V7_AUTHORING_ENABLED = '0';
  let target;
  try {
    await withFreshMysql(async ({ pool, owner, database, containerId, port }) => {
      target = { owner, database, containerId, port, stage: '04' }; save('owned-target.json', target);
      await makeIdentityMysqlRepository(pool).initSchema();
      const design = require('../server/routes/processDesignMysql');
      for (const name of ['ensureProcessDesignEditionSchema', 'ensureProcessDesignEvidenceStatusSchema', 'ensureProcessDesignFormStructureSchema', 'ensureProcessDesignStepTransitionSchema']) await design[name](pool);
      await require('../server/processV7PreviewReviewMigration').applyProcessV7PreviewReview(pool);
      await require('../server/processV7FormalMigration').applyProcessV7FormalFoundation(pool);
      const migration = await pool.getConnection();
      try { await require('../server/processV7AuthoringMigration').applyAuthoring(migration); } finally { migration.release(); }
      for (const [id, name] of [[91, 'B02 Alpha'], [92, 'B02 Beta'], [93, 'B02 Other'], [D, 'B02 Large Alpha'], [E, 'B02 Large Beta']]) {
        await pool.execute('INSERT INTO departments(id,code,name) VALUES (CAST(? AS SIGNED),?,?)', [id, 'B02P_' + id, name]);
      }
      const people = [
        { personId: P, accountId: A, authVersion: V, departmentId: 91, roles: ['mdm_lead'] },
        { personId: 12, accountId: 112, authVersion: 1, departmentId: 91, roles: ['department_contact'] },
        { personId: 13, accountId: 113, authVersion: 1, departmentId: 91, roles: ['department_mdm_reviewer'] },
        { personId: 14, accountId: 114, authVersion: 1, departmentId: 92, roles: ['department_mdm_reviewer'] },
        { personId: 15, accountId: 115, authVersion: 1, departmentId: 91, roles: ['admin', 'mdm_lead', 'department_contact', 'department_mdm_reviewer'] },
        { personId: 16, accountId: 116, authVersion: 1, departmentId: 91, roles: [] },
        { personId: 17, accountId: 117, authVersion: 1, departmentId: 93, roles: ['department_contact', 'department_mdm_reviewer'] },
        { personId: 18, accountId: 118, authVersion: 1, departmentId: 91, roles: ['admin'] },
        { personId: 19, accountId: 119, authVersion: 1, departmentId: D, roles: ['department_contact', 'department_mdm_reviewer'] },
        { personId: 20, accountId: 120, authVersion: 1, departmentId: E, roles: ['department_contact', 'department_mdm_reviewer'] }
      ];
      for (const person of people) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))', [person.personId, 'B02P_' + person.personId, 'B02 synthetic', person.departmentId]);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?,'synthetic-not-used','active',0,CAST(? AS SIGNED))", [person.accountId, person.personId, 'B02P_' + person.personId, person.authVersion]);
        for (const role of person.roles) {
          const global = ['admin', 'mdm_lead'].includes(role);
          await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,CAST(? AS SIGNED), 'B02 synthetic',CURRENT_DATE FROM roles WHERE role_code=?", [person.personId, global ? 'global' : 'department', global ? null : person.departmentId, role]);
        }
      }
      const [lead, contact, origin, counterparty, overlay, roleless, outsider, admin, largeOrigin, largeTarget] = people;
      const system = { userId: 'system-admin:' + A, identityKind: 'system_admin', accountId: A, authVersion: V, personId: null };
      const forged = actor => ({ ...actor, userId: actor.personId, roleCodes: new Set(['mdm_lead', 'department_contact', 'department_mdm_reviewer']), permissions: new Set(['governance:assign-work', 'governance:draft-department', 'governance:review-department']), canReadGlobal: true, canReviewDepartment: true });
      const repo = makeProcessV7PreviewReviewRepository(pool);
      const protectedTables = ['process_v7_preview_cases', 'process_v7_preview_revisions', 'process_v7_preview_review_items', 'process_v7_preview_events', 'process_v7_promotions', 'process_design_documents', 'process_design_drafts', 'process_design_events', 'process_v7_authoring'];
      async function snapshot() { const value = {}; for (const table of protectedTables) value[table] = (await pool.query('SELECT * FROM ' + table + ' ORDER BY 1'))[0]; return value; }
      async function denied(fn, code) { const before = await snapshot(); await assert.rejects(fn, e => code ? e.code === code : [401, 403].includes(e.statusCode)); assert.deepEqual(await snapshot(), before); }
      let serial = 0;
      async function preview(format = 'v8', options = {}) {
        const document = JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-' + format + '.json')));
        document.process.process_ref = 'B02P_' + (++serial); document.process.process_name = document.process.process_ref;
        document.process.owning_department = options.owner === undefined ? 'B02 Alpha' : options.owner;
        if (options.cross !== false) document.behaviors = [{ behavior_ref: 'b02_behavior', node_type: 'action', behavior_name: 'B02 synthetic check', behavior_description: '',
          current_actor_role: (options.target || 'B02 Beta') + ' reviewer', actor_assignment_mode: 'fixed_department', actor_department_data_ref: null,
          actor_position_rule: '', trigger: '', precondition: '', input_description: '', timing: null, completion_standard: '', output_description: '', countersign_all_required: false, countersign_target_departments: [] }];
        const value = validateAndProjectV7(document, await repo.listDepartments()); assert.deepEqual(value.errors, []); return value;
      }
      const meta = detail => ({ expectedRevisionNo: detail.case.current_revision_no, expectedContentHash: detail.case.current_content_hash, sourceFileName: 'B02-synthetic.json' });
      const create = (value, actor = lead, repository = repo) => repository.createCase(value, { sourceFileName: 'B02-synthetic.json' }, forged(actor));
      async function prepared(kind) {
        const value = await preview('v8', { owner: kind === 'owner' ? '' : 'B02 Alpha', cross: kind !== 'scope' });
        const detail = await create(value);
        if (kind === 'promotion') {
          for (const [party, actor] of [['origin', origin], ['counterparty', counterparty]]) await repo.decideItem(detail.items[0], party, 'confirmed', 'B02 basis', 1, value.contentHash, forged(actor));
          return { value, detail: await repo.getCaseDetail(detail.case.id) };
        }
        return { value, detail };
      }
      function operation(kind, fixture, repository = repo) {
        const { value, detail } = fixture;
        if (kind === 'create') return actor => create(value, actor, repository);
        if (kind === 'owner') return actor => repository.assignOwner(detail.case, { id: 91 }, value, meta(detail), forged(actor));
        if (kind === 'revision') return actor => repository.addRevision(detail.case, value, meta(detail), forged(actor));
        if (kind === 'scope') return actor => repository.recordScopeDecision(detail.case, 'confirmed_no_cross_department', 'B02 basis', value, 1, value.contentHash, forged(actor));
        if (kind === 'promotion') return actor => repository.promoteCase(detail, value, { mode: 'create', document_no: value.processRef, document_title: value.processRef }, meta(detail), forged(actor));
        const party = kind === 'origin' ? 'origin' : 'counterparty';
        return actor => repository.decideItem(detail.items[0], party, 'confirmed', 'B02 basis', 1, value.contentHash, forged(actor));
      }
      const revoke = db => db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=CAST(? AS SIGNED)", [lead.personId]);
      const restoreLead = () => pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=CAST(? AS SIGNED)", [lead.personId]);
      async function afterWait(name, kind, fixture, actor, mutate, restore, expectedCode) {
        await check(name, async () => {
          const blocker = await pool.getConnection(); let pending;
          const trace = [];
          const observedPool = { async getConnection() {
            const db = await pool.getConnection();
            return new Proxy(db, { get(target, key) {
              if (key === 'beginTransaction') return async () => { await db.beginTransaction(); await db.execute('SELECT auth_version FROM user_accounts WHERE account_id=CAST(? AS SIGNED)', [actor.accountId]); };
              if (key === 'execute') return async (sql, params) => { const row = { sql, params, connectionId: db.connection.threadId, finished: false }; trace.push(row); try { return await db.execute(sql, params); } finally { row.finished = true; } };
              const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
            } });
          } };
          try {
            await blocker.beginTransaction();
            await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [actor.accountId]);
            await blocker.execute('SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [actor.personId]);
            const before = await snapshot();
            pending = operation(kind, fixture, makeProcessV7PreviewReviewRepository(observedPool))(actor).then(value => ({ value }), error => ({ error }));
            let observed, settled;
            pending.then(value => { settled = value; });
            for (let i = 0; i < 200; i++) {
              const waiting = trace.find(t => !t.finished && /FOR SHARE\s*$/i.test(t.sql) && /FROM person p/.test(t.sql));
              if (waiting) {
                const [locks] = await pool.execute(`SELECT l.OBJECT_NAME object_name,l.LOCK_TYPE lock_type,t.PROCESSLIST_ID connection_id FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID JOIN performance_schema.threads t ON t.THREAD_ID=w.REQUESTING_THREAD_ID WHERE t.PROCESSLIST_ID=?`, [waiting.connectionId]);
                if (locks.length) { observed = { connectionId: waiting.connectionId, locks, earlierSnapshotEstablished: true }; break; }
              }
              await sleep(25);
            }
            if (!observed) save('wait-failure-' + name + '.json', { trace, settled: settled && { code: settled.error?.code, message: settled.error?.message, value: settled.value } });
            assert(observed, 'actual identity read must wait: ' + (settled?.error?.stack || 'pending')); save('lock-' + name + '.json', observed);
            await mutate(blocker); await blocker.commit();
            const result = await pending; assert.equal(result.error?.code, expectedCode, result.error?.stack || 'unexpected allowed write');
            assert.deepEqual(await snapshot(), before);
          } finally { await blocker.rollback(); blocker.release(); if (pending) await pending; await restore(); }
        });
      }
      for (const kind of ['create', 'owner', 'revision', 'origin', 'counterparty', 'scope', 'promotion']) {
        const fixture = kind === 'create' ? { value: await preview() } : await prepared(kind);
        const act = operation(kind, fixture);
        await check(kind + ' rejects system/admin overlay/roleless with forged authority and no writes', async () => {
          for (const actor of [system, admin, overlay, roleless]) await denied(() => act(actor));
          await denied(() => act({ ...lead, accountId: '9007199254740994' }), 'SESSION_AUTHORIZATION_CHANGED');
          await denied(() => act({ ...lead, authVersion: '9007199254740996' }), 'SESSION_AUTHORIZATION_CHANGED');
          await denied(() => act({ ...lead, personId: 'system-admin:' + P }), 'V7_PREVIEW_ADMIN_READ_ONLY');
        });
        if (!['origin', 'counterparty'].includes(kind)) {
          const code = kind === 'promotion' ? 'V7_FORMAL_SCOPE_DENIED' : 'V7_PREVIEW_SCOPE_DENIED';
          await afterWait(kind + '-revoke', kind, fixture, lead, revoke, restoreLead, code);
          await afterWait(kind + '-password', kind, fixture, lead,
            db => db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)', [A]),
            () => pool.execute('UPDATE user_accounts SET auth_version=CAST(? AS SIGNED) WHERE account_id=CAST(? AS SIGNED)', [V, A]), 'SESSION_AUTHORIZATION_CHANGED');
        } else {
          const actor = kind === 'origin' ? origin : counterparty;
          await afterWait(kind + '-revoke', kind, fixture, actor,
            db => db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=CAST(? AS SIGNED)", [actor.personId]),
            () => pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=CAST(? AS SIGNED)", [actor.personId]), 'V7_PREVIEW_SCOPE_DENIED');
          await afterWait(kind + '-department', kind, fixture, actor,
            db => db.execute('UPDATE person SET current_department_id=93 WHERE person_id=CAST(? AS SIGNED)', [actor.personId]),
            () => pool.execute('UPDATE person SET current_department_id=? WHERE person_id=CAST(? AS SIGNED)', [actor.departmentId, actor.personId]), 'V7_PREVIEW_SCOPE_DENIED');
          await afterWait(kind + '-password', kind, fixture, actor,
            db => db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=CAST(? AS SIGNED)', [actor.accountId]),
            () => pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=CAST(? AS SIGNED)', [actor.accountId]), 'SESSION_AUTHORIZATION_CHANGED');
        }
      }
      const contactFixture = await prepared('revision');
      await check('ordinary upload and create deny current cross-department despite supplied old department', async () => {
        await denied(() => operation('revision', contactFixture)({ ...outsider, departmentId: 91 }), 'V7_PREVIEW_SCOPE_DENIED');
        await denied(() => create(awaitValue(contactFixture), { ...outsider, departmentId: 91 }), 'V7_PREVIEW_SCOPE_DENIED');
      });
      function awaitValue(fixture) { return fixture.value; }
      await afterWait('revision-contact-department', 'revision', contactFixture, contact,
        db => db.execute('UPDATE person SET current_department_id=93 WHERE person_id=12'),
        () => pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=12'), 'V7_PREVIEW_SCOPE_DENIED');
      await check('password-required/inactive account/inactive person cannot write', async () => {
        for (const [sql, restore] of [
          ['UPDATE user_accounts SET must_change_password=1 WHERE account_id=CAST(? AS SIGNED)', 'UPDATE user_accounts SET must_change_password=0 WHERE account_id=CAST(? AS SIGNED)'],
          ["UPDATE user_accounts SET account_status='disabled' WHERE account_id=CAST(? AS SIGNED)", "UPDATE user_accounts SET account_status='active' WHERE account_id=CAST(? AS SIGNED)"]
        ]) { await pool.execute(sql, [A]); try { await denied(() => operation('revision', contactFixture)(lead), 'SESSION_AUTHORIZATION_CHANGED'); } finally { await pool.execute(restore, [A]); } }
        await pool.execute("UPDATE person SET status='inactive' WHERE person_id=CAST(? AS SIGNED)", [P]); try { await denied(() => operation('revision', contactFixture)(lead), 'SESSION_AUTHORIZATION_CHANGED'); } finally { await pool.execute("UPDATE person SET status='active' WHERE person_id=CAST(? AS SIGNED)", [P]); }
      });
      for (const format of ['v8', 'v7']) await check(format + ' ordinary create/revision/carry/party decisions/promotion retains content and historic digests', async () => {
        const value = await preview(format); const created = await create(value, contact);
        assert.equal(typeof created.case.id, 'number'); assert.equal(typeof created.case.owning_department_id, 'number');
        assert((await create(value, contact)).idempotent);
        for (const [party, actor] of [['origin', origin], ['counterparty', counterparty]]) await repo.decideItem(created.items[0], party, 'confirmed', 'B02 basis', 1, value.contentHash, forged(actor));
        const historic = await repo.getCaseDetail(created.case.id);
        const changed = structuredClone(value.document); changed.process.process_name += ' revision';
        const next = validateAndProjectV7(changed, await repo.listDepartments());
        const revised = await repo.addRevision(historic.case, next, meta(historic), forged(contact));
        assert.equal(revised.items[0].item_digest, historic.items[0].item_digest); assert.equal(revised.items[0].carry_state, 'carried_forward'); assert.equal(revised.items[0].status, 'confirmed');
        const detail = await repo.getCaseDetail(created.case.id);
        const result = await repo.promoteCase(detail, next, { mode: 'create', document_no: value.processRef, document_title: value.processRef }, meta(detail), forged(lead));
        assert.equal(result.draft.schema_version, next.document.schema_version); assert.equal(result.draft.content_hash, next.contentHash);
        assert.equal(result.document.created_by, P); assert.equal(result.draft.content_updated_by, P); assert.equal(result.promotion.promoted_by_person_id, P);
        const [[draft]] = await pool.execute('SELECT process_content_json FROM process_design_drafts WHERE id=?', [result.draft.id]); assert.deepEqual(JSON.parse(draft.process_content_json), changed);
        assert((await repo.promoteCase(detail, next, { mode: 'create', document_no: value.processRef, document_title: value.processRef }, meta(detail), forged(lead))).idempotent);
        const [[retained]] = await pool.execute('SELECT content_json,content_hash FROM process_v7_preview_revisions WHERE id=?', [historic.revision.id]); assert.deepEqual(JSON.parse(retained.content_json), value.document); assert.equal(retained.content_hash, value.contentHash);
      });
      await check('assign owner and accept source owner preserve original scope/status rules', async () => {
        const fixture = await prepared('owner'); await operation('owner', fixture)(lead);
        let detail = await repo.getCaseDetail(fixture.detail.case.id);
        const changed = structuredClone(fixture.value.document); changed.process.owning_department = 'B02 Other';
        const next = validateAndProjectV7(changed, await repo.listDepartments(), { owningDepartmentName: detail.case.owning_department_name });
        await repo.addRevision(detail.case, next, meta(detail), forged(lead)); detail = await repo.getCaseDetail(detail.case.id);
        const accepted = await repo.recordScopeDecision(detail.case, 'accept_source_owner', 'B02 basis', next, detail.case.current_revision_no, detail.case.current_content_hash, forged(lead)); assert.equal(accepted.owning_department_id, 93);
      });
      await check('adjacent BIGINT departments stay distinct in scope, projection, audit and promotion', async () => {
        const value = await preview('v8', { owner: 'B02 Large Alpha', target: 'B02 Large Beta' }); assert.equal(value.items.length, 1);
        assert.equal(value.items[0].origin_department_id, D); assert.equal(value.items[0].target_department_id, E);
        const created = await create(value, largeOrigin); assert.equal(created.case.owning_department_id, D);
        const onlyOrigin = await create(await preview('v8', { owner: 'B02 Large Alpha', cross: false }), largeOrigin);
        const onlyTarget = await create(await preview('v8', { owner: 'B02 Large Beta', cross: false }), largeTarget);
        for (const actor of [origin, largeOrigin, largeTarget, origin]) {
          const listing = await repo.listCases({ ...actor, permissions: new Set(['governance:read-department']), canReadGlobal: false, canReviewDepartment: true });
          if (actor === largeOrigin) { assert(listing.items.some(c => c.id === onlyOrigin.case.id)); assert(!listing.items.some(c => c.id === onlyTarget.case.id)); }
          if (actor === largeTarget) { assert(listing.items.some(c => c.id === onlyTarget.case.id)); assert(!listing.items.some(c => c.id === onlyOrigin.case.id)); }
        }
        const currentDepartments = [];
        for (const actor of [largeOrigin, largeTarget]) {
          const user = await makeIdentityMysqlRepository(pool).getUserById(actor.personId);
          currentDepartments.push({ personId: actor.personId, expectedDepartment: actor.departmentId, actualDepartment: user.current_department_id });
        }
        save('bigint-departments.json', { projected: value.items, persisted: created.items, currentDepartments });
        for (const item of currentDepartments) assert.equal(item.actualDepartment, item.expectedDepartment);
        await denied(() => repo.decideItem(created.items[0], 'origin', 'confirmed', 'B02 basis', 1, value.contentHash, forged(largeTarget)), 'V7_PREVIEW_SCOPE_DENIED');
        for (const [party, actor] of [['origin', largeOrigin], ['counterparty', largeTarget]]) await repo.decideItem(created.items[0], party, 'confirmed', 'B02 basis', 1, value.contentHash, forged(actor));
        const detail = await repo.getCaseDetail(created.case.id); assert.equal(detail.items[0].target_department_id, E); assert.equal(detail.events[0].actor_department_id, E);
        const promoted = await repo.promoteCase(detail, value, { mode: 'create', document_no: value.processRef, document_title: value.processRef }, meta(detail), forged(lead)); assert.equal(promoted.document.owning_department_id, D); assert.equal(promoted.draft.department_id, D);
        const [[draft]] = await pool.execute('SELECT related_departments_json FROM process_design_drafts WHERE id=?', [promoted.draft.id]); assert.deepEqual(typeof draft.related_departments_json === 'string' ? JSON.parse(draft.related_departments_json) : draft.related_departments_json, [E]);
        assert(!sameIdentityInteger(Number(E), E));
      });
      await check('event storage failure rolls back create/revision/owner/decision/scope/promotion atomically', async () => {
        for (const kind of ['create', 'owner', 'revision', 'origin', 'scope', 'promotion']) {
          const fixture = kind === 'create' ? { value: await preview() } : await prepared(kind);
          if (kind === 'revision') { fixture.value.document.process.process_name += ' changed'; fixture.value = validateAndProjectV7(fixture.value.document, await repo.listDepartments()); }
          const before = await snapshot();
          await pool.query("CREATE TRIGGER b02_preview_fail BEFORE INSERT ON process_v7_preview_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='B02_SYNTHETIC_EVENT_FAILURE'");
          try { await assert.rejects(() => operation(kind, fixture)(kind === 'origin' ? origin : lead), /B02_SYNTHETIC_EVENT_FAILURE/); } finally { await pool.query('DROP TRIGGER b02_preview_fail'); }
          assert.deepEqual(await snapshot(), before);
        }
      });
      await check('managed compiler remains separate: roleless compiler writes, lead/contact cannot replace compiler', async () => {
        process.env.PROCESS_V7_AUTHORING_ENABLED = '1';
        try {
          const value = await preview(); const created = await create(value, contact);
          await pool.execute('UPDATE process_v7_authoring SET compiler_person_id=? WHERE case_id=?', [roleless.personId, created.case.id]);
          const detail = await repo.getCaseDetail(created.case.id); const changed = structuredClone(value.document); changed.process.process_name += ' compiler';
          const next = validateAndProjectV7(changed, await repo.listDepartments());
          for (const actor of [contact, lead]) await denied(() => repo.addRevision(detail.case, next, meta(detail), forged(actor)), 'V7_AUTHORING_COMPILER_REQUIRED');
          await repo.addRevision(detail.case, next, meta(detail), forged(roleless));
          const updated = await repo.getCaseDetail(created.case.id);
          await repo.decideItem(updated.items[0], 'origin', 'confirmed', 'B02 compiler', updated.case.current_revision_no, updated.case.current_content_hash, forged(roleless));
          await repo.decideItem(updated.items[0], 'counterparty', 'confirmed', 'B02 reviewer', updated.case.current_revision_no, updated.case.current_content_hash, forged(counterparty));
          await pool.execute('UPDATE person SET current_department_id=93 WHERE person_id=CAST(? AS SIGNED)', [roleless.personId]);
          try { await denied(() => repo.addRevision(updated.case, next, meta(updated), forged(roleless)), 'V7_AUTHORING_COMPILER_REQUIRED'); } finally { await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=CAST(? AS SIGNED)', [roleless.personId]); }
          await pool.execute('UPDATE process_v7_authoring SET compiler_person_id=CAST(? AS SIGNED) WHERE case_id=?', [P, created.case.id]);
          assert.equal((await require('../server/processV7Authoring').state(pool, created.case.id)).compiler_person_id, P);
          const bigCompilerDocument = structuredClone(next.document); bigCompilerDocument.process.purpose += ' B02 exact compiler';
          const bigCompilerPreview = validateAndProjectV7(bigCompilerDocument, await repo.listDepartments());
          const bigCompiled = await repo.addRevision(updated.case, bigCompilerPreview, meta(updated), forged(lead));
          assert.equal(bigCompiled.revision.uploaded_by_person_id, P);
        } finally { process.env.PROCESS_V7_AUTHORING_ENABLED = '0'; }
      });
      save('results.json', { passed: true, checks, ownedTarget: target, formalEnvironment: false, businesoRgaeptance: false });
    }, { randomDatabase: true });
    save('cleanup.json', { ...target, removed: true });
  } finally { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
main().catch(error => { save('failure.json', { code: error.code, message: error.message, stack: error.stack, checks }); console.error(error.stack); process.exitCode = 1; });
