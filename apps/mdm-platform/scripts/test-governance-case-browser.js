// Real Edge 1699x828 at 100% against an owned tmpfs MySQL and synthetic identities.
// Input: --output <new directory under artifacts>. Creates no formal business data.
// Explicit fault injections verify input protection; all successful writes use real HTTP.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { applyResponsibilities } = require('../server/governanceResponsibilitiesMigration');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'preserve prior evidence'); fs.mkdirSync(output, { recursive: true });
async function main() {
  await withStage05Fixture(async ({ fixture, expect, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true, timeout: 20000 });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], errors = [], responses = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) responses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const button = name => page.getByRole('button', { name, exact: true });
    const field = name => page.getByLabel(name, { exact: true });
    const root = '/api/process-v7-preview', responsibility = '/api/governance-responsibilities', dispute = '/api/process-case-disputes';
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function as(who, target) { await button('退出登录').click(); await login(who); if (target) await page.goto(fixture.baseURL + target); }
    async function idle() { await button('刷新案例与当前修订').waitFor(); await page.locator('[data-case-governance][data-governance-ready="true"]').waitFor(); }
    async function formalIdle() { await button('刷新正式办理状态').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(item => item.textContent === '刷新正式办理状态')?.disabled); }
    async function save() { await button('保存本次治理办理').click(); await page.getByText('治理办理已保存', { exact: true }).waitFor(); await button('放弃本次治理输入').waitFor({ state: 'hidden' }); await page.locator('[data-case-governance][data-governance-ready="true"]').waitFor(); }
    async function discard() { page.once('dialog', d => d.accept()); await button('放弃本次治理输入').click(); }
    async function current(id) { return expect('lead', root + '/cases/' + id, 'GET'); }
    async function bind(id) { const row = (await current(id)).case; return { expected_revision_no: row.current_revision_no, expected_content_hash: row.current_content_hash }; }
    async function opinionBind(id) { const data = await current(id); return { expected_revision_no: data.case.current_revision_no, expected_content_hash: data.case.current_content_hash, expected_dispute_event_id: data.review_dispute_event_id || '0' }; }
    async function geometry() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'desktop has no horizontal overflow'); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    const doc = structuredClone(fixture.document); doc.schema_version = 'process-governance-v8';
    const created = await expect('contact', root + '/cases', 'POST', { document: doc, source_file_name: 'synthetic-governance-v8.json' }, 201);
    const id = String(created.case.id), target = '/app/process-preview?case=' + id;
    const second = structuredClone(doc); second.process.process_ref = 'synthetic_other_governance'; second.process.process_name = '另一合成流程';
    const other = await expect('contact', root + '/cases', 'POST', { document: second, source_file_name: 'synthetic-other.json' }, 201);
    try {
      await page.goto(fixture.baseURL + target); await login('lead'); await idle();
      await page.getByText('治理责任暂不可办理', { exact: true }).waitFor();
      await button('上传3001新修订').waitFor();
      checks.push('missing additive tables are displayed independently and do not block existing preview');
      const connection = await pool.getConnection(); try { await applyResponsibilities(connection); } finally { connection.release(); }
      await pool.execute('UPDATE departments SET final_responsible_person_id=NULL WHERE id=91');
      await button('刷新案例与当前修订').click(); await idle();
      await page.getByText('尚未明确部门负责人，不能最终确认。', { exact: false }).first().waitFor();
      assert.equal(await button('记录本部门核对结果').count(), 0);
      await page.getByText('尚未明确部门负责人，不能最终确认。', { exact: false }).first().scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-department-responsible-unset.png'), fullPage: true });
      const unassigned = await current(id);
      await expect('reviewA', root + '/items/' + unassigned.items[0].id + '/decision', 'POST', { ...await opinionBind(id), decision: 'confirmed', basis: 'synthetic role-only actor must be rejected' }, 403);
      await expect('contact', root + '/items/' + unassigned.items[0].id + '/decision', 'POST', { ...await opinionBind(id), decision: 'confirmed', basis: 'synthetic submitter cannot confirm' }, 403);
      checks.push('missing department responsible person is explicit; role-only reviewer and submitter cannot confirm');
      const hash = require('bcryptjs').hashSync(fixture.loginPassword, 10);
      for (const [personId, who, role] of [[89, 'steward', 'mdm_steward'], [90, 'coordinator', 'data_conflict_handler'], [94, 'decider', 'decision_group'], [95, 'businessOwner', null]]) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,91)', [personId, 'SYNTHETIC_' + who, '合成' + who]);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)", [personId + 100, personId, 'SYNTHETIC_' + who, hash]);
        if (role) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic browser authorization',CURRENT_DATE FROM roles WHERE role_code=?", [personId, role]);
      }
      await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
      await button('刷新案例与当前修订').click(); await idle();
      await button('分派治理经办人').click();
      assert.equal(await field('治理经办人').inputValue(), '', 'no implicit appointment or revocation');
      await field('治理经办人').selectOption('89'); await field('本次办理依据').fill('合成指定依据：核实本案例材料并记录治理建议。');
      assert.equal(await page.locator('[data-case-governance] .preview-editor').evaluate(el => el === document.activeElement), false, 'input focus remains editable after initial panel focus');
      page.once('dialog', d => d.dismiss()); await field('选择流程案例').selectOption(String(other.case.id));
      assert.equal(await field('本次办理依据').inputValue(), '合成指定依据：核实本案例材料并记录治理建议。');
      assert.equal(await field('选择流程案例').inputValue(), id);
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '当前身份', exact: true }).click();
      await page.route('**/api/governance-responsibilities/cases/' + id + '/steward', route => route.fulfill({ status: 409, json: { code: 'RESPONSIBILITY_REVISION_CONFLICT' } }), { times: 1 });
      await button('保存本次治理办理').click(); await page.getByText('本次治理办理未完成', { exact: true }).waitFor();
      assert.equal(await field('本次办理依据').inputValue(), '合成指定依据：核实本案例材料并记录治理建议。');
      await save();
      assert.equal((await expect('lead', responsibility + '/cases/' + id, 'GET')).assignments.steward.person_id, '89');
      checks.push('real steward appointment; explicit selection, canceled case/page navigation and conflict response retain input');

      await as('reviewA', target); await idle(); await button('指定流程业务负责人').click();
      await field('流程业务负责人').selectOption('95'); await field('本次办理依据').fill('合成部门最终负责人明确指定本流程业务责任。'); await save();
      assert.equal((await expect('lead', responsibility + '/cases/' + id, 'GET')).assignments.owner.person_id, '95');
      await as('businessOwner', '/app/workbench'); await page.getByRole('link', { name: '查看责任事项', exact: true }).waitFor();
      await page.getByRole('link', { name: '查看责任事项', exact: true }).click(); await idle();
      assert.equal(await field('选择流程案例').inputValue(), id, 'assigned case remains the actual selected option even outside the department list');
      assert.equal(await page.getByText('当前范围暂无案例。', { exact: false }).count(), 0);
      assert.equal(await button('分派治理经办人').count(), 0); assert.equal(await button('记录治理经办情况').count(), 0);
      await page.getByText('流程业务负责人：合成businessOwner', { exact: false }).waitFor();
      checks.push('final responsible person appoints a no-fixed-role business owner, who discovers exact case from workbench without gaining governance writes');
      await pool.execute('UPDATE departments SET final_responsible_person_id=95 WHERE id=91');
      await button('刷新案例与当前修订').click(); await idle();
      await page.getByText('部门负责人尚缺本部门有效角色授权，不能最终确认。', { exact: false }).first().waitFor();
      assert.equal(await button('指定流程业务负责人').count(), 0);
      assert.equal(await button('记录本部门核对结果').count(), 0);
      await page.getByText('部门负责人尚缺本部门有效角色授权，不能最终确认。', { exact: false }).first().scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-department-role-missing.png'), fullPage: true });
      await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
      checks.push('organization responsibility without a department grant cannot appoint a process owner or confirm facts');

      await as('steward', '/app/workbench'); await page.getByRole('link', { name: '查看责任事项', exact: true }).click(); await idle();
      await button('记录治理经办情况').click(); await field('治理经办内容').fill('已核对材料清单；归属意见仍待业务方确认。'); await field('本次办理依据').fill('合成材料记录编号 T-001。');
      await page.route('**/api/governance-responsibilities/cases/' + id + '/work-records', route => route.fulfill({ status: 503, json: { code: 'RESPONSIBILITY_UNAVAILABLE' } }), { times: 1 });
      await button('保存本次治理办理').click(); await page.getByText('提交结果需核对', { exact: true }).waitFor();
      assert.equal(await field('治理经办内容').inputValue(), '已核对材料清单；归属意见仍待业务方确认。');
      assert.equal(await button('保存本次治理办理').isDisabled(), true);
      await button('刷新责任与争议记录').click(); await discard();
      await button('记录治理经办情况').click(); await field('治理经办内容').fill('登录失效后仍保留的治理经办输入。'); await field('本次办理依据').fill('合成核对资料。');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=89');
      await button('保存本次治理办理').click(); await page.locator('#login-name').waitFor(); await login('steward'); await idle();
      assert.equal(await field('治理经办内容').inputValue(), '登录失效后仍保留的治理经办输入。'); await discard();
      await button('记录治理经办情况').click(); await field('治理经办内容').fill('经办结果保留在当前案例。'); await field('本次办理依据').fill('合成核对资料。'); await save();
      assert.equal((await expect('lead', responsibility + '/cases/' + id, 'GET')).work_records.length, 1);
      checks.push('assigned steward records real work; ambiguous failure and real expired-session reauthentication retain the same-identity input');

      const initial = await current(id);
      await expect('reviewA', root + '/items/' + initial.items[0].id + '/decision', 'POST', { ...await opinionBind(id), decision: 'disputed', basis: '合成双方职责分歧，需要协调。' });
      await as('lead', target); await idle(); await button('分派争议协调人').click();
      await field('争议协调人').selectOption('90'); await field('本次办理依据').fill('由合成冲突处理人组织双方核对。'); await save();
      await as('coordinator', '/app/workbench'); await page.getByRole('link', { name: '查看争议办理', exact: true }).click(); await idle();
      await button('记录争议协调').click(); await field('本次办理依据').fill('双方已说明分歧，需有权主体决定。'); await save();
      await button('提交项目决策组').click(); await field('本次办理依据').fill('职责边界无法由双方自行一致，需要项目决策组确定。'); await save();
      await as('decider', '/app/workbench'); await page.getByRole('link', { name: '查看争议办理', exact: true }).click(); await idle();
      await button('记录项目决策').click(); assert.equal(await field('项目决策结果').inputValue(), '');
      await field('项目决策结果').selectOption('recheck'); await field('本次办理依据').fill('按合成决定依据交回双方，分别重新核对当前流程事实。'); await save();
      assert.equal((await expect('lead', dispute + '/cases/' + id, 'GET')).state, 'awaiting_recheck');
      const pending = await current(id); assert.ok(pending.items.some(item => item.status !== 'confirmed'));
      checks.push('coordinator and decision group discover assigned/escalated disputes; decision requires explicit result and never confirms department facts');
      await geometry(); await page.screenshot({ path: path.join(output, 'desktop-dispute-recheck.png'), fullPage: true });

      const reviewContext = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
      const reviewPage = await reviewContext.newPage(); reviewPage.setDefaultTimeout(15000);
      try {
        await reviewPage.goto(fixture.baseURL + target);
        await reviewPage.locator('#login-name').fill('SYNTHETIC_reviewA'); await reviewPage.locator('#login-password').fill(fixture.loginPassword);
        await reviewPage.getByRole('button', { name: '登录', exact: true }).click();
        await reviewPage.getByRole('button', { name: '记录本部门核对结果', exact: true }).first().click();
        await reviewPage.getByLabel('核对结果', { exact: true }).selectOption('confirmed');
        await reviewPage.getByLabel('核对依据', { exact: true }).fill('争议协调记录变化之前形成的核对意见。');
        await as('lead', target); await idle(); await button('分派争议协调人').click();
        await field('争议协调人').selectOption('90'); await field('本次办理依据').fill('重新记录协调责任；参与部门仍须按当前争议记录核对。'); await save();
        await reviewPage.getByRole('button', { name: '刷新案例与当前修订', exact: true }).click();
        await reviewPage.getByText('来源已变化，当前输入仍保留', { exact: true }).waitFor();
        assert.equal(await reviewPage.getByRole('button', { name: '保存预览核对记录', exact: true }).isDisabled(), true);
        assert.equal(await reviewPage.getByLabel('核对依据', { exact: true }).inputValue(), '争议协调记录变化之前形成的核对意见。');
        reviewPage.once('dialog', dialog => dialog.accept()); await reviewPage.getByRole('button', { name: '放弃本次编辑', exact: true }).click();
      } finally { await Promise.race([reviewContext.close(), new Promise(resolve => setTimeout(resolve, 5000))]); }
      checks.push('unchanged source content with changed dispute event still blocks a stale department approval draft');

      for (const who of ['reviewA', 'reviewB']) for (const item of (await current(id)).items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...await opinionBind(id), decision: 'confirmed', basis: '合成参与部门依据决定重新核对本部门事实。' });
      assert.equal((await expect('lead', dispute + '/cases/' + id, 'GET')).state, 'resolved');
      await as('steward', target); await idle(); await button('记录治理经办情况').click();
      await field('治理经办内容').fill('来源变化前写入的意见必须保留。'); await field('本次办理依据').fill('原修订依据。');
      const changed = structuredClone(doc); changed.process.purpose += ' 合成修订变化。';
      await expect('contact', root + '/cases/' + id + '/revisions', 'POST', { ...await bind(id), document: changed, source_file_name: 'synthetic-revised.json' }, 201);
      await button('刷新案例与当前修订').click(); await idle();
      await page.getByText('责任、来源或争议记录已变化', { exact: true }).waitFor();
      assert.equal(await button('保存本次治理办理').isDisabled(), true); assert.equal(await field('治理经办内容').inputValue(), '来源变化前写入的意见必须保留。');
      await page.locator('[data-case-governance] .preview-editor').scrollIntoViewIfNeeded();
      await geometry(); await page.screenshot({ path: path.join(output, 'desktop-stale-input.png'), fullPage: true }); await discard();
      checks.push('both departments actually recheck; later source revision preserves old steward draft and blocks stale submission');

      const latest = await current(id);
      for (const who of ['reviewA', 'reviewB']) for (const item of latest.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...await opinionBind(id), decision: 'confirmed', basis: '合成核对当前修订。' });
      const promoted = await expect('lead', root + '/cases/' + id + '/promote', 'POST', { ...await bind(id), target: { mode: 'create', document_no: 'GOV-UI-SYNTHETIC', document_title: '合成治理UI流程' } }, 201);
      const formal = { expected_revision_no: promoted.draft.revision_no, expected_content_hash: promoted.draft.content_hash };
      const submitted = await expect('contact', '/api/process-design/drafts/' + promoted.draft.id + '/submit', 'POST', formal);
      await as('contact', '/app/process-formal?case=' + id); await button('撤回负责人确认').click();
      await field('撤回或退回原因').fill('合成提交人撤回原因：需要补充核对说明。');
      await button('确认执行本次操作').click(); await page.getByText('撤回负责人确认已完成，请查看当前办理状态。', { exact: true }).waitFor();
      const withdrawn = await current(id);
      assert.equal(withdrawn.formal_promotion.draft.status, 'needs_changes');
      assert.equal(withdrawn.formal_promotion.review_task.id, submitted.reviewTask.id);
      assert.match(withdrawn.formal_promotion.review_task.decision_note, /合成提交人撤回原因/);
      const resubmitted = await expect('contact', '/api/process-design/drafts/' + promoted.draft.id + '/submit', 'POST', formal);
      assert.notEqual(resubmitted.reviewTask.id, submitted.reviewTask.id);
      await expect('reviewA', '/api/process-design/review-tasks/' + resubmitted.reviewTask.id + '/decision', 'POST', { ...formal, decision: 'approve', note: '合成通过依据，退回后仍须保留。' });
      const approvedTask = structuredClone((await current(id)).formal_promotion.review_task);
      await pool.execute('UPDATE departments SET final_responsible_person_id=87 WHERE id=91');
      await as('lead', '/app/process-formal?case=' + id);
      await page.getByText('须由当前部门负责人重新确认', { exact: true }).waitFor();
      assert.equal(await button('发布正式版本').count(), 0);
      await as('multi', '/app/process-formal?case=' + id); await button('退回修改').click();
      await field('撤回或退回原因').fill('合成现任部门负责人退回原因：原通过记录须按当前责任重新确认。');
      await page.locator('.process-formal .preview-editor').scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-formal-return-input.png'), fullPage: true });
      await button('确认执行本次操作').click(); await page.getByText('退回修改已完成，请查看当前办理状态。', { exact: true }).waitFor(); await formalIdle();
      const returned = await current(id);
      assert.equal(returned.formal_promotion.draft.status, 'needs_changes');
      assert.deepEqual(returned.formal_promotion.review_task, approvedTask, 'return retains the original approved review and basis');
      await button('读取或刷新正式历史').click();
      await page.locator(`[data-formal-review="${approvedTask.id}"]`).getByText('合成通过依据，退回后仍须保留。', { exact: true }).waitFor();
      await page.locator(`[data-formal-review="${approvedTask.id}"]`).scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-formal-retained-history.png'), fullPage: true });
      await as('multi', target); await idle();
      await page.getByText('历史已确认，须当前部门负责人重新核对', { exact: false }).first().waitFor();
      for (const item of (await current(id)).items) await expect('multi', root + '/items/' + item.id + '/decision', 'POST', { ...await opinionBind(id), decision: 'confirmed', basis: '现任部门负责人重新核对本部门事实，原记录保留。' });
      const finalSubmission = await expect('contact', '/api/process-design/drafts/' + promoted.draft.id + '/submit', 'POST', formal);
      await as('contact', '/app/process-formal?case=' + id); await button('刷新正式办理状态').waitFor();
      assert.equal(await button('部门负责人最终确认').count(), 0);
      await expect('contact', '/api/process-design/review-tasks/' + finalSubmission.reviewTask.id + '/decision', 'POST', { ...formal, decision: 'approve', note: 'synthetic submitter must not confirm' }, 403);
      await expect('reviewA', '/api/process-design/review-tasks/' + finalSubmission.reviewTask.id + '/decision', 'POST', { ...formal, decision: 'approve', note: 'synthetic former responsible person must not confirm' }, 403);
      await as('multi', '/app/process-formal?case=' + id); await button('部门负责人最终确认').click();
      await field('部门负责人确认结论').selectOption('approve'); await field('部门负责人确认依据').fill('重新提交后由现任部门负责人本人最终确认。');
      await pool.execute('UPDATE departments SET final_responsible_person_id=NULL WHERE id=91');
      await button('刷新正式办理状态').click(); await formalIdle();
      await page.getByText('办理来源或状态已变化', { exact: true }).waitFor();
      assert.equal(await field('部门负责人确认依据').inputValue(), '重新提交后由现任部门负责人本人最终确认。');
      assert.equal(await button('确认执行本次操作').isDisabled(), true);
      await page.locator('.process-formal .preview-editor').scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-responsibility-changed-input.png'), fullPage: true });
      page.once('dialog', dialog => dialog.accept()); await button('放弃本次输入').click();
      await pool.execute('UPDATE departments SET final_responsible_person_id=87 WHERE id=91');
      await button('刷新正式办理状态').click(); await formalIdle(); await button('部门负责人最终确认').click();
      await field('部门负责人确认结论').selectOption('approve'); await field('部门负责人确认依据').fill('重新提交后由现任部门负责人本人最终确认。');
      await page.locator('.process-formal .preview-editor').scrollIntoViewIfNeeded(); await geometry();
      await page.screenshot({ path: path.join(output, 'desktop-current-responsible-final-confirmation.png'), fullPage: true });
      await button('确认执行本次操作').click(); await page.getByText('部门负责人最终确认已完成，请查看当前办理状态。', { exact: true }).waitFor();
      checks.push('real formal UI withdrawal, changed-responsible-person return, retained prior history, new fact recheck and final self-confirmation; submitter and former responsible person cannot approve');
      const published = await expect('lead', '/api/process-design/drafts/' + promoted.draft.id + '/publish', 'POST', formal);
      const work = await expect('lead', '/api/process-data-governance/creation-tasks/reconcile', 'POST', { process_version_id: published.process_version_id }, 201);
      await as('lead', '/app/data-governance?package=' + work.package.id); await button('分派治理经办人').click();
      await field('治理经办人').selectOption('89'); await field('本次办理依据').fill('按固定版本分派合成工作包经办。'); await save();
      await as('steward', '/app/workbench'); await page.locator(`a[href="/app/data-governance?package=${work.package.id}"]`).filter({ hasText: '查看责任事项' }).click();
      await button('生成待核对明细').waitFor(); assert.equal(await button('完成工作包审核').count(), 0);
      await geometry(); await page.screenshot({ path: path.join(output, 'desktop-assigned-work-package.png'), fullPage: true });
      checks.push('work package assignment is discoverable and grants execution while completion review remains with lead');
      assert.deepEqual(errors, []);
      fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ checks, errors, responses, viewport: { width: 1699, height: 828, scale: 1 }, synthetic: true, realHttp: true, realMysql: true }, null, 2));
      console.log('GOVERNANCE_CASE_BROWSER_PASS ' + checks.length);
    } catch (error) {
      console.error('BROWSER_CHECK_FAILED', error.message);
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify({ checks, errors, responses, url: page.url(), text: await page.locator('body').innerText().catch(() => '') }, null, 2));
      throw error;
    } finally {
      let closed = false;
      await Promise.race([browser.close().then(() => { closed = true; }), new Promise(resolve => setTimeout(resolve, 5000))]);
      fs.writeFileSync(path.join(output, 'browser-close.json'), JSON.stringify({ close_settled: closed, timeout_ms: 5000, fixture_cleanup: 'owned HTTP/MySQL cleanup runs after browser callback' }, null, 2));
      console.log(closed ? 'EDGE_CLOSE_SETTLED' : 'EDGE_CLOSE_HANDLE_TIMEOUT_5000MS');
    }
  }, { evidenceDir: output, completeSource: true, departmentAccountability: true, processDataGovernanceVersionId: 1, createDocument: () => JSON.parse(fs.readFileSync(path.join(__dirname, 'testHelpers/p25-empty-v8.json'), 'utf8')) });
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
