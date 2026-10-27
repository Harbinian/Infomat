// Input: --output <new artifacts directory>, optional isolated frontend/module overlay.
// Owns a fresh synthetic MySQL/HTTP fixture. No private configuration or formal services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { applyDepartmentAccountabilityPolicy } = require('../server/departmentAccountabilityMigration');
const { makeProcessPreviewReviewRepository } = require('../server/processPreviewReviewRepository');
const { contentHash } = require('../server/processPreviewReview');
const outputAt = process.argv.indexOf('--output');
assert(outputAt > 0, '--output required');
const output = path.resolve(process.argv[outputAt + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const root = '/api/process-v7-preview';
const binding = row => ({ expected_revision_no: row.current_revision_no, expected_content_hash: row.current_content_hash });
const formalBinding = row => ({ expected_revision_no: row.revision_no, expected_content_hash: row.content_hash });
function syntheticSource() {
  return { schema_version: 'process-governance-v8', export_meta: { package_ref: 'package_accountability', exported_at: '2026-10-19T00:00:00Z', initiating_department: '合成甲部', compiler: '合成编制人员' },
    process: { process_ref: 'process_accountability', process_name: '', owning_department: '', purpose: '', scope: '', capability_domain: null, business_capability: null, classification_status: 'unclassified' },
    behaviors: [], flow_relations: [], data_objects: [], forms: [], terms: [], migration: { source_schema_version: 'process-governance-v8', source_process_ref: null, source_process_count: 1,
      legacy_cross_department_records: [], reference_materials: [], internal_process_calls: [], work_roles: [], unresolved_actor_roles: [], unresolved_join_modes: [] } };
}

async function main() {
  const appRoot = path.resolve(__dirname, '..');
  const runtimeVersion = require('../server/runtimeVersion').runtimeVersion;
  const sourceDigest = runtimeVersion(appRoot).sourceDigest;
  const sourceHashes = Object.fromEntries(['server/departmentAccountability.js', 'server/departmentHeadAppointment.js',
    'server/governanceAccessMysqlRepository.js', 'server/routes/accounts.js', 'scripts/test-process-department-accountability-mysql.js']
    .map(file => [file, crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot, file))).digest('hex')]));
  await withStage05Fixture(async ({ fixture, expect: fixtureExpect, request: fixtureRequest, pool }) => {
    const checks = [];
    const runtimeHealth = await fetch(fixture.baseURL + '/api/health').then(response => response.json());
    assert.equal(runtimeHealth.version.sourceDigest, sourceDigest, 'real HTTP fixture must use the selected candidate source');
    // Handover invalidates the old and new account sessions. Keep fresh real
    // HTTP logins local to this regression without changing the shared fixture.
    const refreshedSessions = new Map();
    async function request(who, url, method = 'GET', body) {
      const client = refreshedSessions.get(who);
      if (!client) return fixtureRequest(who, url, method, body);
      const response = await fetch(fixture.baseURL + url, { method, headers: {
        'Content-Type': 'application/json', Cookie: client.cookie, ...(client.csrf ? { 'X-CSRF-Token': client.csrf } : {})
      }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie').split(';')[0];
      return { status: response.status, body: await response.json() };
    }
    async function expect(who, url, method, body, status = 200) {
      if (!refreshedSessions.has(who)) return fixtureExpect(who, url, method, body, status);
      const result = await request(who, url, method, body);
      assert.equal(result.status, status, `${who} ${method} ${url}: ${JSON.stringify(result.body)}`);
      return result.body;
    }
    async function refreshLogin(who) {
      const client = { cookie: '', csrf: null };
      refreshedSessions.set(who, client);
      await expect(who, '/api/org/login', 'POST', { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword });
      client.csrf = (await expect(who, '/api/csrf-token', 'GET')).csrfToken;
      assert(client.cookie && client.csrf, 'fresh synthetic session and CSRF token required');
    }
    const read = (id, who = 'lead') => expect(who, root + '/cases/' + id, 'GET');
    const confirm = (who, item, row, status = 200) => expect(who, root + '/items/' + item.id + '/decision', 'POST', {
      ...binding(row), decision: 'confirmed', basis: '合成负责人本人核对依据'
    }, status);
    const create = async (schema, suffix) => {
      const doc = structuredClone(fixture.document); doc.schema_version = schema; doc.process.process_ref = 'accountability_' + suffix;
      const detail = await expect('contact', root + '/cases', 'POST', { document: doc, source_file_name: 'synthetic.json' }, 201);
      return { ...detail, doc };
    };
    const first = await create('process-governance-v8', 'policy_gate');
    const notPrepared = await confirm('reviewA', first.items[0], first.case, 503);
    assert.equal(notPrepared.code, 'DEPARTMENT_ACCOUNTABILITY_POLICY_REQUIRED');
    const connection = await pool.getConnection();
    try { await applyDepartmentAccountabilityPolicy(connection); } finally { connection.release(); }
    const unset = await confirm('reviewA', first.items[0], first.case, 403);
    assert.equal(unset.code, 'DEPARTMENT_FINAL_RESPONSIBLE_UNSET');
    await pool.execute('UPDATE departments SET final_responsible_person_id=CASE id WHEN 91 THEN 84 WHEN 92 THEN 85 ELSE NULL END WHERE id IN (91,92)');
    await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
    assert.equal((await confirm('contact', first.items[0], first.case, 403)).code, 'DEPARTMENT_ACCOUNTABILITY_ROLE_REQUIRED');
    await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
    await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE r.role_code='department_mdm_reviewer' AND p.perm_code='governance:record-department-decision'");
    assert.equal((await confirm('reviewA', first.items[0], first.case, 403)).code, 'DEPARTMENT_ACCOUNTABILITY_PERMISSION_REQUIRED');
    await pool.execute("UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='allow' WHERE r.role_code='department_mdm_reviewer' AND p.perm_code='governance:record-department-decision'");
    for (const who of ['contact', 'multi', 'outsider', 'admin', 'adminMulti']) await confirm(who, first.items[0], first.case, 403);
    const compilerView = await read(first.case.id, 'contact');
    assert.equal(compilerView.authoring.can_record, true);
    assert(compilerView.items.every(item => item.can_act === false));
    checks.push('policy/unset head blocked; valid reviewer alone and managed compiler cannot confirm; admin remains read-only');

    async function confirmBoth(detail) {
      for (const who of ['reviewA', 'reviewB']) for (const item of detail.items) await confirm(who, item, detail.case);
      return read(detail.case.id);
    }
    async function promote(detail, documentNo) {
      await expect('lead', root + '/cases/' + detail.case.id + '/promote', 'POST', { ...binding(detail.case), target: { mode: 'create', document_no: documentNo, document_title: '合成负责人核对流程' } }, 201);
      return read(detail.case.id);
    }
    async function submit(detail) {
      await expect('contact', '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/submit', 'POST', formalBinding(detail.formal_promotion.draft));
      return read(detail.case.id);
    }
    async function approve(detail, who = 'reviewA', status = 200) {
      return expect(who, '/api/process-design/review-tasks/' + detail.formal_promotion.review_task.id + '/decision', 'POST', {
        ...formalBinding(detail.formal_promotion.draft), decision: 'approve', note: '合成负责人本人最终确认依据'
      }, status);
    }
    async function publish(detail, status = 200) {
      return expect('lead', '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/publish', 'POST', formalBinding(detail.formal_promotion.draft), status);
    }
    async function reopen(detail, who = 'reviewA', status = 200) {
      return expect(who, '/api/process-design/drafts/' + detail.formal_promotion.draft.id + '/return-for-changes', 'POST', {
        ...formalBinding(detail.formal_promotion.draft), expected_review_task_id: detail.formal_promotion.review_task.id, note: '合成旧意见保留并重新提交本人确认'
      }, status);
    }
    for (const schema of ['process-governance-v8', 'process-governance-v7']) {
      const created = await create(schema, schema);
      let detail = await confirmBoth(created);
      assert.equal(detail.preview_confirmation.valid, true);
      // Model an unchanged historical opinion without inventing a personal-confirmation marker.
      await pool.execute("UPDATE process_v7_preview_events SET payload_json=JSON_REMOVE(payload_json,'$.department_accountability') WHERE case_id=? AND event_type='department_review_decision_recorded'", [detail.case.id]);
      detail = await read(detail.case.id);
      assert(detail.items.every(item => item.status === 'confirmed'));
      assert.equal(detail.preview_confirmation.valid, false);
      await expect('lead', root + '/cases/' + detail.case.id + '/promote', 'POST', { ...binding(detail.case), target: { mode: 'create', document_no: schema + '-ACCOUNTABLE', document_title: '合成历史意见' } }, 409);
      for (const item of detail.items) await confirm('reviewA', item, detail.case);
      detail = await read(detail.case.id);
      assert(detail.preview_confirmation.missing.every(item => item.party === 'counterparty'));
      const repository = makeProcessPreviewReviewRepository(pool);
      const previousFlag = process.env.PROCESS_V7_PREVIEW_ENABLED;
      process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
      try {
        await assert.rejects(repository.decideItem(detail.items[0], 'counterparty', 'confirmed', '合成越权请求', detail.case.current_revision_no, detail.case.current_content_hash,
          { personId: 84, accountId: 184, authVersion: 1 }), { code: 'V7_PREVIEW_SCOPE_DENIED' });
      } finally {
        if (previousFlag == null) delete process.env.PROCESS_V7_PREVIEW_ENABLED; else process.env.PROCESS_V7_PREVIEW_ENABLED = previousFlag;
      }
      for (const item of detail.items) await confirm('reviewB', item, detail.case);
      detail = await read(detail.case.id);
      assert.equal(detail.preview_confirmation.valid, true);
      const unchanged = structuredClone(created.doc); unchanged.process.purpose += ' 无关说明补充';
      await expect('contact', root + '/cases/' + detail.case.id + '/revisions', 'POST', { ...binding(detail.case), document: unchanged, source_file_name: 'synthetic-unrelated.json' }, 201);
      detail = await read(detail.case.id);
      assert(detail.items.every(item => item.carry_state === 'carried_forward'));
      assert.equal(detail.preview_confirmation.valid, true);
      detail = await promote(detail, schema + '-ACCOUNTABLE');
      detail = await submit(detail);
      for (const who of ['contact', 'multi', 'reviewB', 'admin', 'adminMulti']) await approve(detail, who, 403);
      await approve(detail);
      detail = await read(detail.case.id);
      assert.equal(detail.formal_promotion.department_confirmation.valid, true);
      const originalTask = structuredClone(detail.formal_promotion.review_task);
      await pool.execute("UPDATE process_design_events SET payload_json=JSON_REMOVE(payload_json,'$.department_accountability') WHERE draft_id=? AND event_type='review_approve'", [detail.formal_promotion.draft.id]);
      detail = await read(detail.case.id);
      assert.equal(detail.formal_promotion.department_confirmation.valid, false);
      assert(!detail.formal_allowed_actions.includes('publish_formal_draft'));
      await publish(detail, 409);
      await reopen(detail, 'multi', 403);
      await reopen(detail);
      const returned = await read(detail.case.id);
      assert.deepEqual(returned.formal_promotion.review_task, originalTask);
      detail = await submit(returned);
      assert.notEqual(detail.formal_promotion.review_task.id, originalTask.id);
      await approve(detail);
      detail = await read(detail.case.id);
      const published = await publish(detail);
      const before = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
      await pool.execute('UPDATE departments SET final_responsible_person_id=87 WHERE id=91');
      const after = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
      assert.deepEqual(after, before);
      await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
      checks.push(schema + ': old opinions preserved and re-confirmed per department; unchanged digest carries binding; old approval cannot publish; return/resubmit fixes it; fixed published version preserved');
    }

    let changing = await confirmBoth(await create('process-governance-v8', 'head_change'));
    changing = await promote(changing, 'HEAD-CHANGE'); changing = await submit(changing); await approve(changing);
    changing = await read(changing.case.id);
    await pool.execute('UPDATE departments SET final_responsible_person_id=87 WHERE id=91');
    let changed = await read(changing.case.id, 'multi');
    assert.equal(changed.department_accountability.eligible, true);
    assert.equal(changed.preview_confirmation.valid, false);
    assert.equal(changed.formal_promotion.department_confirmation.valid, false);
    await publish(changed, 409);
    await reopen(changed, 'reviewA', 403);
    for (const item of changed.items) await confirm('multi', item, changed.case);
    await reopen(changed, 'multi');
    changed = await submit(await read(changed.case.id));
    await approve(changed, 'multi');
    changed = await read(changed.case.id);
    assert.equal(changed.formal_promotion.department_confirmation.valid, true);
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='expired' WHERE pr.person_id=87 AND r.role_code='department_mdm_reviewer'");
    assert.equal((await read(changed.case.id)).formal_promotion.department_confirmation.valid, false);
    await publish(changed, 409);
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='active' WHERE pr.person_id=87 AND r.role_code='department_mdm_reviewer'");
    await publish(changed);
    await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
    checks.push('head change invalidates previous preview/formal evidence; successor re-confirms; current grant revocation blocks publication');

    const raced = await create('process-governance-v8', 'concurrent_revoke');
    const lock = await pool.getConnection();
    try {
      await lock.beginTransaction();
      await lock.execute('SELECT id FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [raced.case.id]);
      const pending = request('reviewA', root + '/items/' + raced.items[0].id + '/decision', 'POST', { ...binding(raced.case), decision: 'confirmed', basis: '合成并发前端已读取权限' });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [[row]] = await pool.execute("SELECT COUNT(*) count FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND ID<>CONNECTION_ID() AND INFO LIKE '%process_v7_preview_cases%' AND INFO LIKE '%FOR UPDATE%'");
        waiting = Number(row.count) > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(waiting, 'request must reach the business-row lock before authority changes');
      await lock.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='expired' WHERE pr.person_id=84 AND r.role_code='department_mdm_reviewer'");
      await lock.commit();
      assert.equal((await pending).status, 403);
      const detail = await read(raced.case.id);
      assert.equal(detail.items[0].origin_status, 'pending');
      assert(!detail.events.some(event => event.event_type === 'department_review_decision_recorded'));
    } finally { await lock.rollback(); lock.release(); }
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='active' WHERE pr.person_id=84 AND r.role_code='department_mdm_reviewer'");
    checks.push('role revoked while request waits on case lock is revalidated in transaction; no opinion/event committed');

    let formalRace = await confirmBoth(await create('process-governance-v8', 'formal_concurrent_revoke'));
    formalRace = await promote(formalRace, 'FORMAL-CONCURRENT'); formalRace = await submit(formalRace);
    const formalLock = await pool.getConnection();
    try {
      await formalLock.beginTransaction();
      await formalLock.execute('SELECT id FROM process_v7_preview_cases WHERE id=? FOR UPDATE', [formalRace.case.id]);
      const pending = request('reviewA', '/api/process-design/review-tasks/' + formalRace.formal_promotion.review_task.id + '/decision', 'POST', {
        ...formalBinding(formalRace.formal_promotion.draft), decision: 'approve', note: '合成并发最终确认'
      });
      let waiting = false;
      for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
        const [[row]] = await pool.execute("SELECT COUNT(*) count FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND ID<>CONNECTION_ID() AND INFO LIKE '%process_v7_preview_cases%' AND INFO LIKE '%FOR UPDATE%'");
        waiting = Number(row.count) > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      assert(waiting, 'formal request must wait for its case before final authority changes');
      await formalLock.execute('UPDATE departments SET final_responsible_person_id=87 WHERE id=91');
      await formalLock.commit();
      assert.equal((await pending).status, 403);
      const detail = await read(formalRace.case.id);
      assert.equal(detail.formal_promotion.review_task.status, 'pending');
      assert.equal(detail.formal_promotion.draft.status, 'submitted');
    } finally { await formalLock.rollback(); formalLock.release(); }
    await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
    await approve(formalRace);
    await approve(formalRace, 'reviewA', 409);
    checks.push('head changed while formal request waits is revalidated; task remains pending; later valid confirmation commits once');

    for (const decision of ['needs_changes', 'reject']) {
      let negative = await confirmBoth(await create('process-governance-v8', 'negative_' + decision));
      negative = await promote(negative, 'NEGATIVE-' + decision); negative = await submit(negative);
      if (decision === 'needs_changes') {
        await expect('reviewB', root + '/items/' + negative.items[0].id + '/decision', 'POST', {
          ...binding(negative.case), decision: 'needs_changes', basis: '合成对方部门发现需修订的事实'
        });
      } else {
        // Reproduce an old preview/formal mismatch without altering the original source.
        const revised = structuredClone(negative.revision.document); revised.process.purpose += ' 合成历史后续修订';
        const hash = contentHash(revised);
        const [next] = await pool.execute(`INSERT INTO process_v7_preview_revisions
          (case_id,revision_no,source_file_name,source_schema_version,content_hash,content_json,uploaded_by_person_id)
          VALUES (?,?,'synthetic-historical.json',?,?,?,83)`, [negative.case.id, Number(negative.case.current_revision_no) + 1, revised.schema_version, hash, JSON.stringify(revised)]);
        await pool.execute('UPDATE process_v7_preview_cases SET current_revision_id=?,current_revision_no=current_revision_no+1,current_content_hash=? WHERE id=?', [next.insertId, hash, negative.case.id]);
      }
      const current = await read(negative.case.id, 'reviewA');
      assert(current.formal_allowed_actions.includes('review_formal_draft'));
      assert.deepEqual(current.formal_allowed_decisions, ['needs_changes', 'reject']);
      const result = await expect('reviewA', '/api/process-design/review-tasks/' + current.formal_promotion.review_task.id + '/decision', 'POST', {
        ...formalBinding(current.formal_promotion.draft), decision, note: '合成原正式依据已核对，退回处理'
      });
      assert.equal(result.draft.status, decision === 'reject' ? 'rejected' : decision);
    }
    checks.push('pending negative decisions remain possible after participant reopens review or historical preview/formal mismatch; positive approval remains unavailable');

    async function appointHead(personId, expectedPersonId) {
      const account = await expect('admin', '/api/org/accounts/' + personId, 'GET');
      const result = await expect('admin', '/api/org/accounts/' + personId + '/role-assignments', 'POST', {
        roleCode: 'department_mdm_reviewer', scopeDepartmentId: 91,
        authorizationBasis: 'synthetic audited department head handover', effectiveFrom: account.server_current_date,
        expectedFinalResponsiblePersonId: expectedPersonId, confirmReplaceFinalResponsiblePerson: true
      }, 201);
      assert.equal(result.departmentAppointment.finalResponsiblePersonId, String(personId));
      assert.equal(result.departmentAppointment.previousFinalResponsiblePersonId, String(expectedPersonId));
      return result.departmentAppointment;
    }
    for (const schema of ['process-governance-v8', 'process-governance-v7']) {
      let aba = await confirmBoth(await create(schema, 'aba_' + schema));
      aba = await promote(aba, 'ABA-' + schema); aba = await submit(aba); await approve(aba); aba = await read(aba.case.id);
      assert.equal(aba.preview_confirmation.valid, true);
      assert.equal(aba.formal_promotion.department_confirmation.valid, true);
      const originalTask = structuredClone(aba.formal_promotion.review_task);
      const [originalGrants] = await pool.execute("SELECT * FROM person_roles WHERE person_id IN (84,87) ORDER BY person_role_id");
      const [originalOpinions] = await pool.execute("SELECT * FROM process_v7_preview_events WHERE case_id=? AND event_type='department_review_decision_recorded' ORDER BY id", [aba.case.id]);
      const [originalApprovals] = await pool.execute("SELECT * FROM process_design_events WHERE draft_id=? AND event_type='review_approve' ORDER BY id", [aba.formal_promotion.draft.id]);
      assert.equal((await appointHead(87, 84)).changed, true);
      await refreshLogin('reviewA'); await refreshLogin('multi');
      let afterHandover = await read(aba.case.id, 'multi');
      assert.equal(afterHandover.department_accountability.eligible, true);
      assert.equal(afterHandover.preview_confirmation.valid, false);
      assert.equal(afterHandover.formal_promotion.department_confirmation.valid, false);
      await reopen(afterHandover, 'reviewA', 403);
      assert.equal((await appointHead(84, 87)).changed, true);
      await refreshLogin('reviewA'); await refreshLogin('multi');
      aba = await read(aba.case.id, 'reviewA');
      assert.equal(aba.department_accountability.eligible, true, 'A is qualified again under a new appointment');
      assert(aba.items.every(item => item.status === 'confirmed'), 'historical opinions remain visible');
      assert.equal(aba.preview_confirmation.valid, false, 'A to B to A must not revive old preview opinions');
      assert(aba.preview_confirmation.missing.some(item => item.party === 'origin' && item.reason === 'DEPARTMENT_ACCOUNTABILITY_APPOINTMENT_CHANGED'));
      assert.equal(aba.formal_promotion.department_confirmation.valid, false, 'A to B to A must not revive old approval');
      assert.equal(aba.formal_promotion.department_confirmation.reason, 'DEPARTMENT_ACCOUNTABILITY_APPOINTMENT_CHANGED');
      assert(!aba.formal_allowed_actions.includes('publish_formal_draft'));
      await publish(aba, 409);
      assert.deepEqual((await pool.execute("SELECT * FROM person_roles WHERE person_id IN (84,87) ORDER BY person_role_id"))[0], originalGrants);
      assert.deepEqual((await pool.execute("SELECT * FROM process_v7_preview_events WHERE case_id=? AND event_type='department_review_decision_recorded' ORDER BY id", [aba.case.id]))[0], originalOpinions);
      assert.deepEqual((await pool.execute("SELECT * FROM process_design_events WHERE draft_id=? AND event_type='review_approve' ORDER BY id", [aba.formal_promotion.draft.id]))[0], originalApprovals);
      assert.deepEqual(aba.formal_promotion.review_task, originalTask);

      for (const item of aba.items) await confirm('reviewA', item, aba.case);
      aba = await read(aba.case.id);
      assert.equal(aba.preview_confirmation.valid, true, 'A personally rechecks facts in the current appointment');
      assert.equal(aba.formal_promotion.department_confirmation.valid, false, 'new fact checks do not revive old formal approval');
      const blockedApproval = await publish(aba, 409); assert.equal(blockedApproval.code, 'DEPARTMENT_CONFIRMATION_REQUIRED');
      await reopen(aba); aba = await read(aba.case.id);
      assert.deepEqual(aba.formal_promotion.review_task, originalTask);
      aba = await submit(aba); assert.notEqual(aba.formal_promotion.review_task.id, originalTask.id);
      await approve(aba); aba = await read(aba.case.id);
      assert.equal(aba.formal_promotion.department_confirmation.valid, true);
      assert.equal((await appointHead(84, 84)).changed, false);
      await refreshLogin('reviewA');
      aba = await read(aba.case.id);
      assert.equal(aba.preview_confirmation.valid, true, 'same-head unchanged registration must not rotate the appointment');
      assert.equal(aba.formal_promotion.department_confirmation.valid, true);
      const published = await publish(aba); assert(published.process_version_id);
      const [oldTask] = await pool.execute('SELECT status FROM process_design_review_tasks WHERE id=?', [originalTask.id]);
      assert.equal(oldTask[0].status, 'approved', 'old task history is preserved');
      checks.push(schema + ': audited A-B-A handover preserves grants and old opinions but invalidates their authority; fresh personal review and approval recover publication; unchanged re-registration retains current evidence');
    }

    // The same person may be author and final responsible when both assignments are current.
    await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 83,role_id,'department',91,'synthetic self-confirm qualification',CURRENT_DATE FROM roles WHERE role_code='department_mdm_reviewer'");
    let self = await create('process-governance-v8', 'same_author');
    for (const item of self.items) { await confirm('contact', item, self.case); await confirm('reviewB', item, self.case); }
    self = await promote(await read(self.case.id), 'SELF-AUTHORIZED'); self = await submit(self); await approve(self, 'contact');
    await publish(await read(self.case.id));
    checks.push('qualified author may personally confirm; no unrequested separation-of-duty restriction');
    assert.equal(runtimeVersion(appRoot).sourceDigest, sourceDigest, 'candidate source must remain fixed during this regression');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', sourceDigest,
      modelVersion: require('../server/roleDefinitions').ACCESS_MODEL_VERSION, sourceHashes, checks }, null, 2));
    console.log('PROCESS_DEPARTMENT_ACCOUNTABILITY_MYSQL_PASS ' + checks.length + ' groups');
  }, { evidenceDir: output, completeSource: true, randomDatabase: true, createDocument: syntheticSource, authoring: true });
}
main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
