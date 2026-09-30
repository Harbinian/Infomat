// P21 office UI: owned tmpfs MySQL, synthetic HTTP identities and Edge only.
// --output is a new artifacts directory. No private configuration or shared service.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const spreadsheet = require('../server/publicationSpreadsheet');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive:true });
async function main() {
  await withStage05Fixture(async ({ pool, fixture, expect, request }) => {
    const browser = await runtime().chromium.launch({ channel:'msedge', headless:true });
    const context = await browser.newContext({ viewport:{ width:1699, height:828 }, deviceScaleFactor:1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const checks = [], pageErrors = [], consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    const button = name => page.getByRole('button', { name, exact:true });
    const field = name => page.getByLabel(name, { exact:true });
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function idle() { await button('刷新办公室任务').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新办公室任务')?.disabled); }
    async function refresh() { await button('刷新办公室任务').click(); await idle(); }
    async function commit() { await button('确认提交本次操作').click(); await page.getByText('本次操作已保存', { exact:true }).waitFor(); await idle(); }
    async function discard() { page.once('dialog', d => d.accept()); await button('放弃本次输入').click(); }
    async function as(who) { await button('退出登录').click(); await login(who); await idle(); }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      assert.equal((await page.goto(fixture.baseURL + '/app/offices')).status(), 200, 'office page registered');
      await login('lead'); await idle(); await page.getByText('当前没有可查看的办公室。', { exact:true }).waitFor();
      const repo = require('../server/publicationRepository').makePublicationRepository(pool);
      async function publish(kind, headers, rows) {
        const input = spreadsheet.normalizePublication({ kind, title:'合成办公室', sourceFileName:'synthetic.xlsx', headers, rows, mapping:spreadsheet.suggestedMapping(kind, headers) });
        return repo.publish({ content:input.content, ...await repo.preview(input), requestId:crypto.randomUUID() }, { personId:82, accountId:182, authVersion:1 });
      }
      await publish('organization', ['组织编码','组织名称','组织层级','归口部门编码','办公室负责人工号'], [
        ['OFFICE_A','合成核对办公室','办公室','SYNTHETIC_91','SYNTHETIC_contact'],
        ['OFFICE_B','合成接收办公室','办公室','SYNTHETIC_92','SYNTHETIC_reviewA']]);
      await publish('roster', ['工号','姓名','部门编码','办公室编码'], [['SYNTHETIC_reviewB','合成跨办公室成员','SYNTHETIC_92','OFFICE_A;OFFICE_B']]);
      const offices = (await expect('lead','/api/offices/workbench','GET')).offices;
      const a = offices.find(o => o.code === 'OFFICE_A').id, b = offices.find(o => o.code === 'OFFICE_B').id;
      // Native V7 publication supplies a real fixed source for the existing office API.
      const doc = structuredClone(fixture.document); doc.schema_version = 'process-governance-v7';
      const preview = await expect('contact','/api/process-v7-preview/cases','POST',{ document:doc, source_file_name:'synthetic-v7.json' },201);
      const bind = { expected_revision_no:preview.case.current_revision_no, expected_content_hash:preview.case.current_content_hash };
      for (const who of ['reviewA','reviewB']) for (const item of preview.items) await expect(who, '/api/process-v7-preview/items/' + item.id + '/decision','POST',{...bind, decision:'confirmed', basis:'合成依据'});
      const promotion = await expect('lead','/api/process-v7-preview/cases/' + preview.case.id + '/promote','POST',{...bind,target:{mode:'create',document_no:'P21-OFFICE',document_title:'合成办公室流程'}},201);
      const formal = { expected_revision_no:promotion.draft.revision_no, expected_content_hash:promotion.draft.content_hash };
      const submitted = await expect('contact','/api/process-design/drafts/' + promotion.draft.id + '/submit','POST',formal);
      await expect('reviewA','/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision','POST',{...formal,decision:'approve',note:'合成审核'});
      const version = (await expect('lead','/api/process-design/drafts/' + promotion.draft.id + '/publish','POST',formal)).process_version_id;
      await refresh(); await field('办公室').selectOption(String(a)); await idle();
      await button('交办到办公室').click();
      assert.equal(await field('工作内容').evaluate(e => e === document.activeElement), true);
      await field('工作内容').fill('合成任务<script>alert(1)</script>');
      await field('关联正式流程（可选）').selectOption(String(version)); await field('业务行为（可选）').selectOption('behavior_check');
      await field('截止日期').fill('2026-10-01');
      page.once('dialog', d => d.dismiss()); await field('办公室').selectOption(String(b));
      assert.equal(await field('办公室').inputValue(), String(a));
      page.once('dialog', d => d.dismiss()); await page.getByRole('link',{name:'当前身份',exact:true}).click();
      assert.equal(await field('工作内容').inputValue(), '合成任务<script>alert(1)</script>');
      page.once('dialog', d => d.dismiss()); await page.reload().catch(() => {});
      for (const status of [403,409,503]) {
        await page.route('**/api/offices/tasks', route => route.fulfill({status,json:{error:'合成故障'}}), {times:1});
        await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor();
        assert.equal(await field('工作内容').inputValue(), '合成任务<script>alert(1)</script>');
      }
      await context.setOffline(true); await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); await context.setOffline(false);
      await commit();
      let task = (await expect('lead','/api/offices/workbench?office_id=' + a,'GET')).tasks[0];
      assert.equal(task.process_version_id, version); assert.equal(task.behavior_ref, 'behavior_check');
      const url = '/api/offices/tasks/' + task.id;
      checks.push('empty, explicit imports, native fixed source, create, input focus, switch/navigation/reload and fault protection');
      const old = await expect('lead','/api/todos','POST',{to_dept_id:91,content:'合成原部门待办',type:'test'});
      await refresh(); await button('指定办公室 ' + old.id).click();
      assert.equal(await field('承接办公室').locator('option[value="' + b + '"]').count(), 0);
      await field('承接办公室').selectOption(String(a)); await commit();
      await expect('lead','/api/offices/tasks/' + old.id + '/receive','POST',{office_id:a},409);
      await expect('outsider','/api/offices/workbench?office_id=' + a,'GET',undefined,403);
      await expect('lead',url + '/assign','POST',{assignee_person_id:85,expected_revision:1},403);
      await as('contact'); await button('分配人员 ' + task.id).click(); await field('办理人').selectOption('85');
      await expect('contact',url + '/assign','POST',{assignee_person_id:85,expected_revision:1});
      await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); await refresh();
      await page.getByText('任务或办理权限已变化', {exact:true}).waitFor();
      assert.equal(await field('办理人').inputValue(),'85'); assert.equal(await button('确认提交本次操作').isDisabled(),true);
      await discard(); await button('重新分配 ' + task.id).click(); await field('办理人').selectOption('85'); await commit();
      checks.push('legacy department receipt, department constraint, explicit manager assignment and real stale revision');
      await as('reviewB'); await field('办公室').selectOption(String(a)); await idle();
      await button('填写结果并办结 ' + task.id).click();
      const note = '合成办理结果<script>alert(1)</script>。' + '中文长文核对材料并保留依据。'.repeat(25);
      await field('办理结果').fill(note); await refresh(); assert.equal(await field('办理结果').inputValue(), note);
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout',{method:'POST',headers:{'X-CSRF-Token':t.csrfToken}}); });
      await button('确认提交本次操作').click(); await page.locator('#login-name').waitFor(); await login('reviewB'); await idle();
      assert.equal(await field('办理结果').inputValue(), note);
      await noOverflow(); await page.screenshot({path:path.join(output,'desktop-complete.png'),fullPage:true});
      await noOverflow(); await page.setViewportSize({width:1699,height:828}); await commit();
      task = (await expect('lead','/api/offices/workbench?office_id=' + a,'GET')).tasks.find(t => t.id === task.id);
      assert.equal(task.status,'done'); assert.equal(JSON.parse(task.completion_json).note,note);
      await expect('reviewB',url + '/complete','POST',{note:'重复',expected_revision:task.revision_no},409);
      await field('办理状态').selectOption('done'); await page.getByText(note,{exact:true}).waitFor();
      await page.reload(); await idle(); await page.getByText(note,{exact:true}).waitFor();
      await page.getByRole('link',{name:'当前身份',exact:true}).click(); await page.goBack(); await idle();
      assert.equal(new URL(page.url()).searchParams.get('office_id'),String(a));
      await page.screenshot({path:path.join(output,'completed.png'),fullPage:true});
      checks.push('cross-office member, actual 401 same identity restores draft, real completion/history and deep-link refresh/back');
      await as('adminMulti'); assert.equal(await button('交办到办公室').count(),0); assert.equal(await button('分配人员 ' + old.id).count(),0);
      await expect('adminMulti','/api/offices/tasks','POST',{request_id:crypto.randomUUID(),office_id:a,content:'禁止'},403);
      await expect('adminMulti','/api/offices/tasks/' + old.id + '/assign','POST',{assignee_person_id:85,expected_revision:1},403);
      const legacy = await context.newPage(); await legacy.goto(fixture.baseURL + '/#/officeWorkbench?office_id=' + a);
      const legacyRow = legacy.locator('#officeTaskRows tr').filter({hasText:'合成任务<script>alert(1)</script>'});
      await legacyRow.waitFor(); assert.ok((await legacyRow.textContent()).includes(note)); await legacy.close();
      await as('contact'); await button('分配人员 ' + old.id).click(); await field('办理人').selectOption('85');
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout',{method:'POST',headers:{'X-CSRF-Token':t.csrfToken}}); });
      await button('确认提交本次操作').click(); await page.locator('#login-name').waitFor(); await login('outsider'); await idle();
      assert.equal(await field('办理人').count(),0); assert.equal(await page.getByText('合成任务<script>alert(1)</script>',{exact:true}).count(),0);
      checks.push('admin combined role read-only, old page compatibility and cross-identity draft clearing');
      await as('lead');
      await page.route('**/api/offices/workbench*', route => route.fulfill({status:503,json:{error:'合成读取故障'}}), {times:1});
      await refresh(); await page.getByRole('alert').waitFor(); assert.equal(await button('交办到办公室').count(),0);
      await button('重试').click(); await idle();
      let entered; const seen = new Promise(resolve => {entered=resolve;}); let release; const gate = new Promise(resolve => {release=resolve;});
      await page.route('**/api/offices/workbench*', async route => {entered(); await gate; await route.fulfill({json:{offices:[],tasks:[],members:[],versions:[],unallocated:[]}}).catch(()=>{});}, {times:1});
      const first = button('刷新办公室任务').click(); await seen;
      await page.getByRole('link',{name:'当前身份',exact:true}).click();
      await page.unroute('**/api/offices/workbench*'); release(); await first;
      await page.getByRole('link',{name:'办公室工作台',exact:true}).click(); await idle();
      assert.ok(await field('办公室').locator('option').count() >= 2);
      checks.push('read failure clears stale controls, retry and late unmounted response ignored');
      await button('交办到办公室').click(); await field('工作内容').fill('合成响应丢失交办');
      await field('承接办公室').selectOption(String(a));
      let savedRequest;
      await page.route('**/api/offices/tasks', async route => {
        savedRequest = route.request().postDataJSON();
        const response = await route.fetch(); assert.equal(response.status(),201);
        await route.fulfill({status:503,json:{error:'合成已保存但响应丢失'}});
      }, {times:1});
      await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor();
      assert.equal(await field('工作内容').inputValue(),'合成响应丢失交办');
      await button('确认提交本次操作').click();
      await page.getByText('此交办请求已保存。请刷新列表核对；当前输入保留，不会重复创建任务。',{exact:true}).waitFor();
      const [[duplicates]] = await pool.execute('SELECT COUNT(*) n FROM mdm_todo_office_assignments WHERE request_id=?',[savedRequest.request_id]);
      assert.equal(Number(duplicates.n),1); await discard(); await refresh();
      checks.push('real create with lost-response injection and retry retains request identity; no duplicate task');
      // Projection only: the P17 repository remains unchanged; this checks the migrated renderer.
      await field('办公室').selectOption(String(a)); await idle();
      const projected = await expect('lead','/api/offices/workbench?office_id=' + a,'GET');
      projected.tasks.find(t => t.id === old.id).analysis_task = {issue_id:'999',purpose:'verify',round_no:1,source_revision:4,instruction:'合成最小办理说明：只补证据，不关闭问题。',close_enabled:false};
      await page.route('**/api/offices/workbench*', route => route.fulfill({json:projected}), {times:1});
      await refresh(); await page.getByText('问题办理说明',{exact:true}).click();
      await page.getByText('合成最小办理说明：只补证据，不关闭问题。',{exact:true}).waitFor();
      assert.equal(await button('关闭问题').count(),0);
      checks.push('explicit injected P17 minimum instruction projection, no problem closure action');
      const unexpectedConsole = consoleErrors.filter(s => !/Failed to load resource: (the server responded with a status of (401|403|409|503)|net::ERR_INTERNET_DISCONNECTED)/.test(s));
      assert.deepEqual(unexpectedConsole,[]);
      assert.deepEqual(pageErrors,[]);
      fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,pageErrors,consoleErrors,unexpectedConsole,boundary:'owned MySQL/HTTP/Edge; faults and P17 renderer projection injected explicitly; no production or manual acceptance'},null,2));
    } catch(error) { await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{}); fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,checks,pageErrors,consoleErrors},null,2)); throw error; }
    finally { await context.close(); await browser.close(); }
  }, {evidenceDir:output});
}
main().catch(error => {console.error(error); process.exitCode=1;});
