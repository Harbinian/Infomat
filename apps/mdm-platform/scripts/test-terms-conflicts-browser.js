// P21 terminology/conflicts: owned tmpfs MySQL, synthetic identities, real HTTP/Edge.
// Input: --output <new artifacts directory>. Writes only evidence and owned fixtures.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const arg = process.argv.indexOf('--output');
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const checks = [], pageErrors = [], consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const button = name => page.getByRole('button', { name, exact: true });
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function switchUser(who) { await button('退出登录').click(); await login(who); }
    const termsReady = () => page.locator('[data-terms-ready]').waitFor();
    const conflictReady = () => page.locator('[data-conflict-detail]').waitFor();
    async function confirmAction() { await button('确认提交').click(); await page.getByText('操作已完成，请核对最新记录。', { exact: true }).waitFor(); }
    async function capture(name) { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true }); }
    try {
      assert.equal((await fetch(fixture.baseURL + '/app/terms')).status, 200, 'new terminology route');
      await require('../server/terminologyMysqlRepository').seedDefaultTerminologyTermTypes(pool);
      await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(1,'synthetic-terms.json','synthetic','{}')");
      await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,dept_name,l3_name,status) VALUES(501,'synthetic_terms_a','l3',1,1,'合成甲部','合成甲流程','active'),(502,'synthetic_terms_b','l3',1,1,'合成乙部','合成乙流程','active')");
      for (const [id, role] of [[85, 'data_conflict_handler'], [86, 'decision_group']]) {
        await pool.execute('DELETE FROM person_roles WHERE person_id=?', [id]);
        await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic browser fixture',CURRENT_DATE FROM roles WHERE role_code=?", [id, role]);
      }
      await page.goto(fixture.baseURL + '/app/terms'); await login('contact'); await termsReady();
      await button('新增术语').click(); await page.getByLabel('术语名称', { exact:true }).fill('   '); await page.getByLabel('所属业务流程', { exact:true }).selectOption('501'); await button('确认提交').click();
      await page.getByText('请填写术语名称，不能只填写空格。', { exact:true }).waitFor();
      const [blankTerms]=await pool.query("SELECT COUNT(*) n FROM terminology_terms WHERE term=''"); assert.equal(blankTerms[0].n,0);
      await page.getByLabel('术语名称', { exact: true }).fill('合成业务记录'); await page.getByLabel('定义', { exact: true }).fill('甲部定义'); await page.getByLabel('所属业务流程', { exact: true }).selectOption('501');
      await confirmAction(); await termsReady();
      const terms = await expect('contact', '/api/terminology', 'GET'); const term = terms.find(r => r.term === '合成业务记录'); assert.ok(term); assert.equal(term.status, 'pending');
      await button('查看术语 ' + term.id).click(); await button('修改术语').click(); await page.getByLabel('定义', { exact: true }).fill('甲部更新定义');
      await button('刷新术语').click(); await termsReady(); assert.equal(await page.getByLabel('定义', { exact: true }).inputValue(), '甲部更新定义');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '冲突管理', exact: true }).first().click(); assert.ok(page.url().includes('/app/terms'));
      const draftUrl = page.url(); const dismissBack = d => d.dismiss(); page.on('dialog', dismissBack);
      await page.evaluate(() => history.back()); await page.waitForTimeout(350);
      assert.equal(page.url(), draftUrl, 'cancelled back restores the selected-record URL without reloading');
      assert.equal(await page.getByLabel('定义', { exact: true }).inputValue(), '甲部更新定义'); page.off('dialog', dismissBack);
      await confirmAction(); assert.equal((await expect('contact', '/api/terminology', 'GET')).find(r => r.id === term.id).definition, '甲部更新定义');
      await switchUser('reviewA'); await termsReady(); await button('查看术语 ' + term.id).click(); await button('审核通过').click(); await confirmAction();
      assert.equal((await expect('reviewA', '/api/terminology', 'GET')).find(r => r.id === term.id).status, 'approved');
      checks.push('real term creation/edit/review, refresh preserves draft, cancelled navigation preserves input');
      await pool.execute("INSERT INTO mdm_term_conflicts(id,term,term_a_id,dept_a,dept_a_meaning,dept_b,dept_b_meaning,severity,status) VALUES(601,'合成业务记录',?,91,'甲部更新定义',92,'乙部不同定义','warn','pending')", [term.id]);
      await page.getByRole('link', { name: '冲突管理', exact: true }).first().click(); await switchUser('lead');
      await button('查看冲突 term-601').click(); await conflictReady(); await button('指定责任人').click(); await page.getByLabel('冲突处理人', { exact: true }).selectOption('85'); await confirmAction(); await conflictReady();
      await switchUser('reviewB'); await conflictReady(); await button('提交协调结果').click(); await page.getByLabel('协调选择', { exact: true }).selectOption('compromise'); await page.getByLabel('协调依据', { exact: true }).fill('合成协调依据'); await confirmAction(); await conflictReady();
      await button('形成处理决定').click(); await page.getByLabel('处理决定与依据', { exact: true }).fill('合成统一口径'); await confirmAction(); await conflictReady();
      assert.equal((await expect('lead', '/api/conflicts/601?type=term', 'GET')).status, 'resolved');
      await switchUser('lead'); await conflictReady(); await button('重新打开').click(); await confirmAction(); await conflictReady(); await button('指定责任人').click(); await page.getByLabel('冲突处理人', { exact: true }).selectOption('85'); await confirmAction(); await conflictReady();
      await button('升级冲突').click(); await confirmAction(); await conflictReady();
      await switchUser('outsider'); await conflictReady(); await button('决定升级事项').click(); await page.getByLabel('处理决定与依据', { exact: true }).fill('合成升级决定'); await confirmAction();
      await switchUser('lead'); await conflictReady(); await button('归档冲突').click(); await confirmAction(); await conflictReady();
      const detail = await expect('lead', '/api/conflicts/601?type=term', 'GET'); assert.equal(detail.status, 'archived'); assert.equal(detail.assignmentHistory.length, 2); assert.equal(detail.coordinationHistory.length, 1); assert.equal(detail.term_a_id, term.id);
      checks.push('real assignment/coordination/resolution/reopen/escalated decision/archive; stable term reference and histories');
      await capture('conflicts-desktop'); await page.setViewportSize({ width: 390, height: 844 }); await capture('conflicts-mobile'); await page.setViewportSize({ width: 1699, height: 828 });
      await page.reload(); await conflictReady(); await page.getByRole('link', { name: '术语词典', exact: true }).first().click(); await termsReady(); await button('查看术语 ' + term.id).click(); await capture('terms-desktop'); await page.setViewportSize({ width: 390, height: 844 }); await capture('terms-mobile');
      for (const url of ['/api/terminology', '/api/conflicts/601/assign?type=term', '/api/conflicts/detect']) assert.equal((await request('adminMulti', url, 'POST', {})).status, 403);
      assert.equal((await request('contact', '/api/terminology/' + term.id + '/review', 'POST', { action: 'approve' })).status, 403);
      assert.equal((await request('reviewB', '/api/conflicts/601?type=term')).status, 404);
      await page.setViewportSize({ width: 1699, height: 828 });
      // Historical field and term IDs may collide; the type must remain part of selection.
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES(701,'synthetic_fields','合成字段来源',91)");
      await pool.execute("INSERT INTO data_map_fields(id,context_id,field_key,field_name_cn) VALUES(701,701,'synthetic_a','合成同名字段'),(702,701,'synthetic_b','合成同名字段')");
      await pool.execute("INSERT INTO mdm_field_conflicts(id,field_id_a,field_id_b,conflict_field,value_a,value_b,dept_a,dept_b,status) VALUES(601,701,702,'data_type','文本','整数',91,92,'pending')");
      await page.goto(fixture.baseURL + '/app/conflicts'); await page.locator('[data-conflicts-ready]').waitFor(); await button('查看冲突 field-601').click(); await conflictReady();
      assert.ok((await page.locator('[data-conflict-detail]').textContent()).includes('文本'));
      await button('指定责任人').click(); await page.getByLabel('冲突处理人', { exact:true }).selectOption('85'); await confirmAction(); await conflictReady();
      await button('改派责任人').click(); await page.getByLabel('冲突处理人', { exact:true }).selectOption('85'); await confirmAction(); await conflictReady();
      assert.equal((await expect('lead', '/api/conflicts/601?type=field', 'GET')).assignmentHistory.length, 2);
      assert.equal((await expect('lead', '/api/conflicts/601?type=term', 'GET')).status, 'archived');
      await page.getByLabel('冲突类型', { exact:true }).selectOption('term'); await page.locator('[data-conflicts-ready]').waitFor(); assert.equal(await button('查看冲突 field-601').count(), 0);
      await button('查看冲突 term-601').click(); await conflictReady(); await page.goBack(); await conflictReady(); assert.ok(page.url().includes('type=field'));
      await page.goForward(); await conflictReady(); assert.ok(page.url().includes('type=term'));
      await page.getByRole('link', { name:'原冲突管理入口', exact:true }).click(); await page.waitForURL('**/#/conflicts'); await page.locator('#conflicts').waitFor(); await page.goBack(); await conflictReady();
      checks.push('field/term same ID isolation, assignment/reassignment, query filtering, reload/back/forward, retained old conflict entry');
      // Hold one response while selecting another record: an old response cannot replace it.
      await page.getByLabel('冲突类型', { exact:true }).selectOption(''); await page.locator('[data-conflicts-ready]').waitFor();
      let release, arrived; const hold = new Promise(r => { release=r; }), entered = new Promise(r => { arrived=r; });
      await page.route('**/api/conflicts/601?type=field', async route => { arrived(); await hold; await route.fulfill({ json:{ ...detail, term:'STALE_FORBIDDEN' } }).catch(()=>{}); }, { times:1 });
      await button('查看冲突 field-601').click(); await entered; await button('查看冲突 term-601').click(); await conflictReady(); release(); await page.waitForTimeout(200);
      assert.ok(!(await page.locator('.governance-utilities').textContent()).includes('STALE_FORBIDDEN'));
      for (const status of [403,409,503]) {
        await page.route('**/api/conflicts/601?type=term', route => route.fulfill({ status, json:{} }), { times:1 });
        await button('刷新冲突').click(); await page.getByText('冲突详情暂不可用', { exact:true }).waitFor(); assert.equal(await page.locator('[data-conflict-detail]').count(),0);
        await button('刷新冲突').click(); await conflictReady();
      }
      await context.setOffline(true); await button('刷新冲突').click(); await page.getByText('冲突读取或办理未完成', { exact:true }).waitFor(); await context.setOffline(false); await button('刷新冲突').click(); await conflictReady();
      await page.route('**/api/conflicts?*', route => route.fulfill({ json:[] }), { times:1 }); await button('刷新冲突').click(); await page.getByText('暂无符合条件的冲突记录', { exact:true }).waitFor(); await button('刷新冲突').click(); await conflictReady();
      checks.push('late detail, empty listing, injected 403/409/503/offline feedback, stale details removed, explicit recovery');
      await pool.execute("INSERT INTO terminology_terms(term,definition,process_mapping_record_id,status) VALUES('合成检测词项','A定义',501,'approved'),('合成检测词','B定义',502,'approved')");
      const [foreignTerms]=await pool.execute("SELECT id FROM terminology_terms WHERE term='合成检测词'");
      await expect('contact','/api/terminology','POST',{term:'越部门申报',process_id:502,term_type_code:'noun'},403);
      await expect('reviewA','/api/terminology/'+foreignTerms[0].id+'/review','POST',{action:'approve'},403);
      await expect('reviewA','/api/conflicts/601/coordination?type=field','POST',{result:'A',note:'no permission'},403);
      await expect('lead','/api/conflicts/601/assign?type=field','POST',{assignee_user_id:83},422);
      await button('检测冲突').click(); await button('确认提交').click(); await page.getByText(/检测已完成，新建/).waitFor();
      const detected = (await expect('lead','/api/conflicts?type=term','GET')).find(r=>r.term==='合成检测词项'); assert.ok(detected); assert.equal(detected.status,'silenced');
      const [detectedBefore]=await pool.query('SELECT COUNT(*) n FROM mdm_term_conflicts');
      await button('检测冲突').click(); await button('确认提交').click(); await page.getByText('检测已完成，新建 0 条冲突；请核对记录。', { exact:true }).waitFor();
      const [detectedAfter]=await pool.query('SELECT COUNT(*) n FROM mdm_term_conflicts'); assert.deepEqual(detectedAfter,detectedBefore);
      checks.push('manual real detection creates related term conflict; repeated detection retains original records');
      await page.getByRole('link', { name:'术语词典', exact:true }).first().click(); await switchUser('contact'); await termsReady();
      const makeDraft = async name => { await button('新增术语').click(); await page.getByLabel('术语名称', { exact:true }).fill(name); await page.getByLabel('所属业务流程', { exact:true }).selectOption('501'); };
      const cancelDraft = async () => { page.once('dialog',d=>d.accept()); await button('取消本次办理').click(); };
      await makeDraft('合成异常保留');
      for (const status of [403,409]) { await page.route('**/api/terminology',route=>route.fulfill({status,json:{}}),{times:1}); await button('确认提交').click(); await page.getByText('术语读取或办理未完成',{exact:true}).waitFor(); assert.equal(await page.getByLabel('术语名称',{exact:true}).inputValue(),'合成异常保留'); }
      await confirmAction(); await termsReady();
      const [createdRows]=await pool.execute("SELECT id FROM terminology_terms WHERE term='合成异常保留'"); const editedId=createdRows[0].id;
      await button('查看术语 '+editedId).click(); await button('修改术语').click(); await page.getByLabel('定义',{exact:true}).fill('必须保留的并发输入');
      await pool.execute("UPDATE terminology_terms SET definition='其他人员已更新' WHERE id=?",[editedId]);
      await button('确认提交').click(); await page.getByText('原记录已变化，当前输入保留',{exact:true}).waitFor(); assert.equal(await button('确认提交').isDisabled(),true);
      assert.equal(await page.getByLabel('定义',{exact:true}).inputValue(),'必须保留的并发输入'); await cancelDraft(); await button('刷新术语').click(); await termsReady();
      await button('查看术语 '+editedId).click(); await button('删除待审术语').click(); await confirmAction(); await termsReady(); assert.equal(await button('查看术语 '+editedId).count(),0);
      await makeDraft('合成响应丢失'); let writes=0;
      await page.route('**/api/terminology',async route=>{ writes++; await route.fetch(); await route.fulfill({status:503,json:{}}); },{times:1});
      await button('确认提交').click(); await page.getByText('写入结果不明，已阻止重复提交',{exact:true}).waitFor(); assert.equal(await button('确认提交').isDisabled(),true);
      await button('刷新术语').click(); await termsReady(); assert.equal(await page.getByLabel('术语名称',{exact:true}).inputValue(),'合成响应丢失');
      const [lost]=await pool.execute("SELECT COUNT(*) n FROM terminology_terms WHERE term='合成响应丢失'"); assert.equal(lost[0].n,1); assert.equal(writes,1); await cancelDraft();
      checks.push('real pre-submit concurrent update rejected; delete confirmation; injected write failures preserve input; committed-but-lost response blocks replay');
      await makeDraft('同身份恢复草稿'); await page.getByLabel('术语名称',{exact:true}).focus(); assert.equal(await page.getByLabel('术语名称',{exact:true}).evaluate(el=>el===document.activeElement),true);
      await page.getByLabel('定义',{exact:true}).fill('合成长中文输入用于检查窄屏表单和未提交内容。'.repeat(12));
      await capture('term-form-desktop'); await page.setViewportSize({width:390,height:844}); await capture('term-form-mobile'); await page.setViewportSize({width:1699,height:828});
      assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=83'); await button('刷新术语').click(); await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor(); await login('contact'); await termsReady();
      assert.equal(await page.getByLabel('术语名称',{exact:true}).inputValue(),'同身份恢复草稿');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=83'); await button('刷新术语').click(); await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor(); await login('adminMulti'); await termsReady(); assert.equal(await page.getByLabel('术语名称',{exact:true}).count(),0); assert.equal(await button('新增术语').count(),0);
      assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
      await page.getByRole('link',{name:'原术语词典入口',exact:true}).click(); await page.waitForURL('**/#/terms'); await page.locator('#terms').waitFor(); await page.goBack(); await termsReady();
      checks.push('real cross-department/permission/assignee denial, session revocation, same-person restoration, other-person clearing, admin read-only, long Chinese form, keyboard/unload protection, no persistence, old terms entry');
      assert.deepEqual(pageErrors, []); const unexpectedConsole = consoleErrors.filter(m => !/Failed to load resource|net::ERR_/.test(m)); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, pageErrors, unexpectedConsole }, null, 2));
    } catch (error) { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, pageErrors }, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout:5000 }).catch(() => {}); throw error; }
    finally { await browser.close(); }
  }, { evidenceDir: output, previewOnly: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
