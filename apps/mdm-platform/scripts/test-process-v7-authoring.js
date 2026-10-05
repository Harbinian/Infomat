// --output <new artifacts directory>. Real owned MySQL/HTTP/Edge, synthetic identities only.
// No private configuration, formal target, external notifications, AI or 3001 service.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const migration = require('../server/processV7AuthoringMigration');
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'preserve earlier evidence'); fs.mkdirSync(output, { recursive: true });
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
async function main() {
  const checks = [];
  await withStage05Fixture(async ({ fixture, expect, request, pool, backup, restore }) => {
    const root = '/api/process-v7-preview';
    const connection = await pool.getConnection();
    try {
      assert.equal((await migration.inspectAuthoring(connection)).ready, true);
      assert.equal((await migration.applyAuthoring(connection)).ready, true);
      await connection.execute('ALTER TABLE process_v7_authoring ADD COLUMN unexpected_drift INT NULL');
      assert.ok((await migration.inspectAuthoring(connection)).drift.length);
      await assert.rejects(migration.applyAuthoring(connection), e => e.code === 'V7_AUTHORING_SCHEMA_DRIFT');
      await connection.execute('ALTER TABLE process_v7_authoring DROP COLUMN unexpected_drift');
      await connection.execute('DELETE FROM schema_migrations WHERE migration_key=?', [migration.MIGRATION_KEY]);
      await connection.query('DROP TABLE process_v7_authoring_records');
      assert.deepEqual((await migration.inspectAuthoring(connection)).missing, ['process_v7_authoring_records']);
      assert.equal((await migration.applyAuthoring(connection)).ready, true);
      checks.push('migration is additive/idempotent; unknown schema drift rejected');
    } finally { connection.release(); }
    const passwordHash = require('bcryptjs').hashSync(fixture.loginPassword, 10);
    for (const [id, who, dept] of [[89, 'compiler', 91], [90, 'peer', 91], [94, 'foreignCompiler', 93]]) {
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)', [id, 'SYNTHETIC_' + who, '合成' + who, dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)", [id + 100, id, 'SYNTHETIC_' + who, passwordHash]);
      await expect(who, '/api/org/login', 'POST', { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword });
      await expect(who, '/api/csrf-token'); // fixture.request obtains cookies; set CSRF via session-independent helper below
    }
    // Fixture automatically sets CSRF for its standard identities. Additional users need explicit headers.
    const clients = {};
    async function extra(who, url, method = 'GET', body) {
      if (!clients[who]) {
        const login = await fetch(fixture.baseURL + '/api/org/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword }) });
        assert.equal(login.status, 200); const cookie = login.headers.get('set-cookie').split(';')[0];
        const csrf = await fetch(fixture.baseURL + '/api/csrf-token', { headers: { Cookie: cookie } });
        clients[who] = { cookie, csrf: (await csrf.json()).csrfToken };
      }
      const c = clients[who];
      const response = await fetch(fixture.baseURL + url, { method, headers: { Cookie: c.cookie, 'X-CSRF-Token': c.csrf, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      return { status: response.status, body: await response.json() };
    }
    async function ex(who, url, method = 'GET', body, status = 200) { const r = ['compiler', 'peer', 'foreignCompiler'].includes(who) ? await extra(who, url, method, body) : await request(who, url, method, body); assert.equal(r.status, status, `${who} ${url}: ${JSON.stringify(r.body)}`); return r.body; }
    async function create(ref, who = 'contact') {
      const document = structuredClone(fixture.document); document.process.process_ref = ref; document.process.process_name = '合成' + ref;
      const c = await ex(who, root + '/cases', 'POST', { document, source_file_name: ref + '.json' }, 201);
      return ex('contact', root + '/cases/' + c.case.id);
    }
    const detail = await create('authoring_main');
    assert.equal(detail.authoring.compiler_person_id, '83'); assert.equal(detail.authoring.started_at, null);
    const id = detail.case.id, url = root + '/cases/' + id;
    const bind = d => ({ expected_revision_no: d.case.current_revision_no, expected_content_hash: d.case.current_content_hash, expected_assignment_version: d.authoring.assignment_version });
    const transfer = { ...bind(detail), record_kind: 'transfer', content: '合成明确交接依据', recipient_person_id: '89', request_key: crypto.randomUUID() };
    const candidates = await ex('contact', url + '/authoring-candidates');
    assert.ok(candidates.items.some(p => p.person_id === '89')); assert.ok(!candidates.items.some(p => ['81', '88', '94'].includes(p.person_id)));
    await ex('lead', url + '/authoring-records', 'POST', transfer, 403);
    await ex('adminMulti', url + '/authoring-records', 'POST', transfer, 403);
    await ex('contact', url + '/authoring-records', 'POST', { ...transfer, recipient_person_id: '94' }, 422);
    await pool.execute("UPDATE person SET employment_status='inactive' WHERE person_id=90");
    await ex('contact', url + '/authoring-records', 'POST', { ...transfer, recipient_person_id: '90' }, 422);
    await pool.execute("UPDATE person SET employment_status='active' WHERE person_id=90");
    await ex('contact', url + '/authoring-records', 'POST', { ...transfer, expected_content_hash: 'a'.repeat(64) }, 409);
    assert.equal((await ex('contact', url)).authoring.compiler_person_id, '83');
    checks.push('new contact self-authoring; only current departmental people candidates; admin/foreign/inactive/stale transfer rejected and rollback preserves assignment');
    await ex('contact', url + '/authoring-records', 'POST', transfer);
    assert.equal((await ex('contact', url + '/authoring-records', 'POST', transfer)).idempotent, true);
    const oldFlag = process.env.PROCESS_V7_AUTHORING_ENABLED;
    process.env.PROCESS_V7_AUTHORING_ENABLED = '0';
    try { await assert.rejects(require('../server/processV7Authoring').assertCompiler(pool, detail.case, {}), e => e.code === 'V7_AUTHORING_DISABLED'); }
    finally { if (oldFlag === undefined) delete process.env.PROCESS_V7_AUTHORING_ENABLED; else process.env.PROCESS_V7_AUTHORING_ENABLED = oldFlag; }
    await ex('contact', url + '/authoring-records', 'POST', { ...transfer, content: '不同依据' }, 409);
    assert.equal((await ex('peer', root + '/cases')).items.length, 0);
    await ex('peer', url, 'GET', undefined, 403);
    await ex('foreignCompiler', url, 'GET', undefined, 403);
    assert.equal((await ex('compiler', root + '/cases')).items.length, 1);
    const workbench = await ex('compiler', '/api/role-workbench?mode=todo');
    assert.ok(workbench.workItems.some(i => i.type === 'v7_preview_review' && Number(i.caseId) === Number(id)));
    let current = await ex('compiler', url);
    assert.ok(current.allowed_actions.includes('upload_revision')); assert.equal(current.authoring.compiler_person_id, '89');
    assert.deepEqual(current.revision.document, detail.revision.document);
    const doc = structuredClone(current.revision.document); doc.process.purpose += ' 合成修订';
    const revision = { ...bind(current), document: doc, source_file_name: 'revised.json' };
    await ex('contact', url + '/revisions', 'POST', revision, 403);
    await ex('peer', url + '/revisions', 'POST', revision, 403);
    await ex('compiler', '/api/data-map/contexts', 'POST', {}, 403);
    checks.push('transfer idempotency/conflict; assigned roleless user exact-case read/write; other department/member denied; contact remains reader, source compiler/history unchanged, no global governance grant');
    const coordinate = { ...bind(current), record_kind: 'reminder', content: '合成催办记录', request_key: crypto.randomUUID() };
    await ex('contact', url + '/authoring-records', 'POST', coordinate);
    current = await ex('compiler', url); assert.equal(current.authoring.started_at, null); assert.equal(current.case.current_content_hash, detail.case.current_content_hash);
    await ex('compiler', url + '/authoring-records', 'POST', { ...coordinate, request_key: crypto.randomUUID() }, 403);
    await pool.query("CREATE TRIGGER fail_authoring_insert BEFORE INSERT ON process_v7_authoring_records FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic failure'");
    const note = { ...bind(current), record_kind: 'governance_suggestion', content: '合成建议，仍待MDM核验', request_key: crypto.randomUUID() };
    await ex('compiler', url + '/authoring-records', 'POST', note, 500);
    assert.equal((await ex('compiler', url)).authoring.started_at, null);
    await pool.query('DROP TRIGGER fail_authoring_insert');
    await ex('compiler', url + '/revisions/preview', 'POST', revision);
    assert.equal((await ex('compiler', url)).authoring.started_at, null);
    await ex('compiler', url + '/revisions', 'POST', revision, 201);
    current = await ex('compiler', url); assert.ok(current.authoring.started_at); assert.equal(current.authoring.transfer_available, false);
    await ex('contact', url + '/authoring-records', 'POST', { ...transfer, ...bind(current), request_key: crypto.randomUUID() }, 409);
    await ex('contact', url + '/authoring-records', 'POST', { ...coordinate, ...bind(current), record_kind: 'supplement_request', request_key: crypto.randomUUID() });
    await ex('compiler', url + '/authoring-records', 'POST', { ...note, ...bind(current) });
    checks.push('coordination independent of facts/window; readonly comparison keeps window open; failed save fully rolls back; successful revision permanently closes transfer; post-transfer coordination and suggestions persist separately');
    const race = await create('authoring_race');
    const raceDoc = structuredClone(race.revision.document); raceDoc.process.purpose += ' 并发保存';
    const raced = await Promise.all([
      request('contact', root + '/cases/' + race.case.id + '/authoring-records', 'POST', { ...bind(race), ...transfer, ...bind(race), request_key: crypto.randomUUID() }),
      request('contact', root + '/cases/' + race.case.id + '/revisions', 'POST', { ...bind(race), document: raceDoc, source_file_name: 'race.json' })
    ]);
    assert.equal(raced.filter(r => r.status < 300).length, 1, 'transfer and old compiler save cannot both succeed');
    assert.ok(raced.some(r => [403, 409].includes(r.status)));
    checks.push('real concurrent save versus transfer: exactly one success with case lock');
    for (const item of current.items) {
      await ex('compiler', root + '/items/' + item.id + '/decision', 'POST', { ...bind(current), decision: 'confirmed', basis: '合成归口事实已核对' });
      await ex('reviewB', root + '/items/' + item.id + '/decision', 'POST', { ...bind(current), decision: 'confirmed', basis: '合成承接事实已核对' });
    }
    current = await ex('lead', url); assert.equal(current.case.status, 'review_complete');
    const promotion = await ex('lead', url + '/promote', 'POST', { ...bind(current), target: { mode: 'create', document_no: 'SYN-AUTH-001', document_title: '合成编制职责验证' } }, 201);
    const draftId = promotion.draft.id;
    const formalBinding = { expected_revision_no: promotion.draft.revision_no, expected_content_hash: promotion.draft.content_hash };
    await ex('peer', '/api/process-design/drafts/' + draftId, 'GET', undefined, 403);
    await ex('compiler', '/api/process-design/drafts/' + draftId);
    await ex('contact', '/api/process-design/drafts/' + draftId + '/submit', 'POST', formalBinding, 403);
    await ex('compiler', '/api/process-design/drafts/' + draftId + '/submit', 'POST', formalBinding);
    current = await ex('compiler', url); const task = current.formal_promotion.review_task;
    await ex('compiler', '/api/process-design/review-tasks/' + task.id + '/decision', 'POST', { ...formalBinding, decision: 'approve', note: '越权测试' }, 403);
    await ex('compiler', '/api/process-design/drafts/' + draftId + '/publish', 'POST', formalBinding, 403);
    await ex('reviewA', '/api/process-design/review-tasks/' + task.id + '/decision', 'POST', { ...formalBinding, decision: 'approve', note: '合成有权审核，保留既有链路' });
    const published = await ex('lead', '/api/process-design/drafts/' + draftId + '/publish', 'POST', formalBinding);
    await ex('compiler', '/api/process-design/versions/' + published.process_version_id + '/content');
    await ex('peer', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET', undefined, 403);
    checks.push('roleless compiler can submit exact promoted draft; contact cannot substitute; compiler cannot approve or publish; original formal source/status checks retained');
    await pool.execute('UPDATE person SET current_department_id=93 WHERE person_id=89');
    // A live session notices its current department; reauthenticate to test list-level scope too.
    delete clients.compiler;
    const moved = await extra('compiler', root + '/cases'); assert.equal(moved.status, 200); assert.equal(moved.body.items.length, 0);
    await ex('compiler', url, 'GET', undefined, 403);
    await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=89'); delete clients.compiler;
    await pool.execute('DELETE FROM process_v7_authoring WHERE case_id=?', [race.case.id]); // synthetic legacy fixture only, never a migration action
    const legacy = await ex('contact', root + '/cases/' + race.case.id); assert.equal(legacy.authoring.managed, false); assert.equal(legacy.authoring.transfer_available, false);
    await ex('contact', root + '/cases/' + race.case.id + '/authoring-records', 'POST', { ...transfer, ...bind(legacy) }, 409);
    checks.push('department changes revoke case scope; supported unestablished legacy history remains unchanged and nontransferable');
    for (let i=0; i<21; i++) await create('overview_' + i, i%2 ? 'lead' : 'contact');
    const first = await ex('contact', root + '/department-overview'); assert.equal(first.items.length,20); assert.ok(first.next_cursor);
    const second = await ex('contact', root + '/department-overview?before=' + first.next_cursor); assert.ok(second.items.some(c => Number(c.id) === Number(id)));
    assert.equal(second.items.find(c => Number(c.id) === Number(id)).formal_status, 'published');
    assert.ok(!second.items.some(c => first.items.some(p => p.id === c.id)));
    await ex('compiler', root + '/department-overview', 'GET', undefined, 403);
    await ex('outsider', root + '/department-overview', 'GET', undefined, 403);
    await ex('contact', root + '/department-overview?before=9223372036854775808', 'GET', undefined, 422);
    checks.push('department contact paginates all owned cases including other uploaders, preserves compiler/progress/current returns; compiler/foreign role cannot read department overview');
    const dump = backup();
    const [[before]] = await pool.execute('SELECT COUNT(*) AS n FROM process_v7_authoring_records');
    await pool.execute('UPDATE process_v7_authoring SET compiler_person_id=90 WHERE case_id=?', [id]);
    restore(dump);
    assert.equal((await ex('compiler', url)).authoring.compiler_person_id, '89');
    const [[after]] = await pool.execute('SELECT COUNT(*) AS n FROM process_v7_authoring_records'); assert.equal(after.n, before.n);
    checks.push('owned in-memory backup/restore retains assignments, audit records and fixed source');
    // Browser branch is in the same real synthetic environment, with desktop-only viewport.
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    try {
      const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
      const page = await context.newPage(); page.setDefaultTimeout(15000); const pageErrors = [];
      page.on('pageerror', e => pageErrors.push(e.message));
      async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click(); await page.getByRole('button', { name: '退出登录' }).waitFor(); }
      async function idle() { await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新案例与当前修订')?.disabled); }
      const ui = await create('authoring_browser');
      await page.goto(fixture.baseURL + '/app/process-preview?case=' + ui.case.id); await login('contact'); await idle();
      await page.getByRole('button', { name: '查看本部门流程全貌' }).click(); await page.getByRole('button', { name: '下一页部门流程' }).waitFor();
      await page.getByRole('button', { name: '下一页部门流程' }).click();
      await page.getByRole('button', { name: '查看案例' + id, exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, 'desktop-overview.png'), fullPage: true });
      await page.getByRole('button', { name: '上传3001新修订' }).click();
      assert.equal(await page.getByRole('button', { name: '编制前转办', exact: true }).isDisabled(), true);
      page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '放弃本次编辑' }).click();
      await page.getByRole('button', { name: '编制前转办', exact: true }).click();
      assert.equal(await page.locator('.preview-editor').evaluate(el => el === document.activeElement), true);
      await page.getByLabel('接收编制者', { exact: true }).selectOption('89'); await page.getByLabel('交接依据', { exact: true }).fill('界面合成交接依据，长中文保留');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '当前身份', exact: true }).click();
      assert.equal(await page.getByLabel('交接依据', { exact: true }).inputValue(), '界面合成交接依据，长中文保留');
      await page.route('**/api/process-v7-preview/cases/*/authoring-records', async route => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
      await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByRole('button', { name: '核对本次提交结果' }).waitFor();
      assert.equal(await page.getByLabel('交接依据', { exact: true }).inputValue(), '界面合成交接依据，长中文保留');
      await page.getByRole('button', { name: '核对本次提交结果' }).click(); await page.getByText('已核对本次记录保存成功，请按当前编制归属继续。').waitFor();
      assert.equal((await ex('contact', root + '/cases/' + ui.case.id)).authoring.records.filter(r => r.record_kind === 'transfer').length, 1);
      await page.getByRole('button', { name: '记录协调事项' }).click();
      await page.getByLabel('记录内容', { exact: true }).fill('长中文协调要求：请核对订单、客户与合同的对应依据。');
      await page.route('**/api/process-v7-preview/cases/*/authoring-records', r => r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic"}' }), { times: 1 });
      await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByRole('button', { name: '核对本次提交结果' }).waitFor();
      await page.getByRole('button', { name: '核对本次提交结果' }).click(); await page.getByRole('button', { name: '保存预览核对记录', exact: true }).waitFor({ state: 'visible' });
      await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      await page.getByText('交接、编制与协调记录', { exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => visualViewport.scale), 1);
      await page.screenshot({ path: path.join(output, 'desktop-contact.png'), fullPage: true });
      await page.getByRole('button', { name: '退出登录' }).click(); await login('compiler'); await idle();
      assert.equal(await page.getByRole('button', { name: '编制前转办', exact: true }).count(), 0);
      await page.getByRole('button', { name: '记录编制说明' }).click(); await page.getByLabel('记录类别', { exact: true }).selectOption('problem_reply');
      await page.getByLabel('记录内容', { exact: true }).fill('合成问题答复，不自动关闭问题。');
      for (const status of [403, 409]) {
        await page.route('**/api/process-v7-preview/cases/*/authoring-records', r => r.fulfill({ status, contentType: 'application/json', body: '{"error":"synthetic"}' }), { times: 1 });
        await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByRole('button', { name: '核对本次提交结果' }).waitFor();
        assert.equal(await page.getByLabel('记录内容', { exact: true }).inputValue(), '合成问题答复，不自动关闭问题。');
        await page.getByRole('button', { name: '核对本次提交结果' }).click();
        await page.waitForFunction(() => { const b=[...document.querySelectorAll('button')].find(el => el.textContent === '保存预览核对记录'); return b && !b.disabled; });
      }
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=89');
      await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('compiler'); await idle(); assert.equal(await page.getByLabel('记录内容', { exact: true }).inputValue(), '合成问题答复，不自动关闭问题。');
      await page.getByRole('button', { name: '核对本次提交结果' }).click();
      await page.getByRole('button', { name: '保存预览核对记录', exact: true }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      await page.screenshot({ path: path.join(output, 'desktop-compiler.png'), fullPage: true });
      assert.deepEqual(pageErrors, []);
      checks.push('real Edge 100% 1699x828: department overview pagination, explicit discard before transfer, editor focus, cancelled navigation preserves input, committed transfer with lost response reconciles once, 401/403/409/503 retain and reconcile inputs, same-person reauthentication, roleless compiler records reply, no page errors/desktop overflow');
    } finally { await browser.close(); }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, scope: 'real isolated MySQL/HTTP/Edge; synthetic only; not formal enablement or business acceptance' }, null, 2));
  }, { authoring: true, evidenceDir: output });
  console.log('V7_AUTHORING_CHECKS_PASSED ' + checks.length);
}
main().catch(e => { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: e.message, stack: e.stack, inspection: e.inspection }, null, 2)); console.error(e); process.exitCode = 1; });
