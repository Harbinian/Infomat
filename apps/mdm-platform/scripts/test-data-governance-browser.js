// P21: owned tmpfs MySQL, real HTTP/session and Edge; no private configuration.
// --output must name a new directory under artifacts. All owned resources close in finally.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { digest } = require('../server/processDataGovernance');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'preserve previous evidence'); fs.mkdirSync(output, { recursive: true });
const root = '/api/process-data-governance';
async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const checks = [], pageErrors = [], consoleErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const field = name => page.getByLabel(name, { exact: true });
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function idle() { await button('刷新工作包状态').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新工作包状态')?.disabled); }
    async function refresh() { await button('刷新工作包状态').click(); await idle(); }
    async function commit() { await button('确认提交本次操作').click(); await page.getByText('本次操作已完成', { exact: true }).waitFor(); await idle(); }
    async function discard() { page.once('dialog', d => d.accept()); await button('放弃本次输入').click(); }
    async function as(who) { await button('退出登录').click(); await login(who); await idle(); }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      const response = await page.goto(fixture.baseURL + '/app/data-governance'); assert.equal(response.status(), 200, 'new page registered');
      await login('lead'); await idle(); await page.getByText('当前范围没有工作包。', { exact: true }).waitFor();
      // Publish through the existing native V7 lifecycle. No automatic package creation.
      const doc = structuredClone(fixture.document); doc.schema_version = 'process-governance-v7';
      const preview = '/api/process-v7-preview';
      const data = await expect('contact', preview + '/cases', 'POST', { document: doc, source_file_name: 'synthetic-v7.json' }, 201);
      const bind = { expected_revision_no: data.case.current_revision_no, expected_content_hash: data.case.current_content_hash };
      for (const who of ['reviewA', 'reviewB']) for (const item of data.items) await expect(who, preview + '/items/' + item.id + '/decision', 'POST', { ...bind, decision: 'confirmed', basis: '合成核对依据' });
      const promotion = await expect('lead', preview + '/cases/' + data.case.id + '/promote', 'POST', { ...bind, target: { mode: 'create', document_no: 'P21-PDG', document_title: '合成数据治理流程' } }, 201);
      const formal = { expected_revision_no: promotion.draft.revision_no, expected_content_hash: promotion.draft.content_hash };
      const submitted = await expect('contact', '/api/process-design/drafts/' + promotion.draft.id + '/submit', 'POST', formal);
      await expect('reviewA', '/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision', 'POST', { ...formal, decision: 'approve', note: '合成审核依据' });
      const published = await expect('lead', '/api/process-design/drafts/' + promotion.draft.id + '/publish', 'POST', formal);
      const versionId = published.process_version_id;
      assert.equal((await expect('lead', root + '/workbench', 'GET')).work_packages.length, 0);
      await refresh(); await button('建立工作包').click(); assert.equal(await field('已发布流程版本').inputValue(), '');
      await field('已发布流程版本').selectOption(String(versionId)); await commit();
      let work = (await expect('lead', root + '/workbench', 'GET')).work_packages[0];
      const read = () => expect('lead', root + '/work-packages/' + work.id, 'GET');
      assert.equal(work.process_version_id, versionId);
      assert.equal((await expect('lead', root + '/creation-tasks/reconcile', 'POST', { process_version_id: versionId }, 201)).package.id, work.id);
      await button('生成待核对明细').click(); await commit(); let detail = await read(); assert.ok(detail.details.length);
      await page.getByText(/工作包修订.*MDM治理中/).waitFor();
      checks.push('native published V7, explicit creation, idempotency, deterministic details and fixed source');
      await button('记录治理结论').click(); await field('治理结论').fill('尚待核实的合成结论'); await field('判断依据').fill('合成依据，不作为业务事实');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '当前身份', exact: true }).click();
      assert.equal(await field('治理结论').inputValue(), '尚待核实的合成结论');
      await refresh(); assert.equal(await field('治理结论').inputValue(), '尚待核实的合成结论');
      page.once('dialog', d => d.dismiss()); await page.reload().catch(() => {}); assert.equal(await field('治理结论').inputValue(), '尚待核实的合成结论');
      for (const status of [403,409,503]) {
        await page.route('**/api/process-data-governance/work-packages/*/details/*', route => route.fulfill({ status, json: { error: '合成失败注入' } }), { times: 1 });
        await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); assert.equal(await field('治理结论').inputValue(), '尚待核实的合成结论');
      }
      await context.setOffline(true); await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); await context.setOffline(false);
      assert.equal(await field('治理结论').inputValue(), '尚待核实的合成结论');
      // Another actor changes the real revision. Draft stays bound to the old revision.
      await expect('lead', root + '/work-packages/' + work.id + '/details/' + detail.details[0].id, 'PATCH', { expected_revision: detail.package.revision_no, status: 'pending', governance: { basis: '另一会话更新' } });
      await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); await refresh();
      await page.getByText('来源或修订已变化', { exact: true }).waitFor(); assert.equal(await button('确认提交本次操作').isDisabled(), true);
      await discard(); checks.push('navigation/reload/error/offline preserve inputs; real concurrency cannot silently rebind');
      await button('向业务部门提问').click(); await field('目标部门').selectOption('91'); await field('需要的事实').selectOption('source_evidence');
      await field('具体问题').fill('合成问题：请说明此流程是否涉及数据记录？'); await field('提出原因').fill('合成待核对范围'); await commit();
      detail = await read(); const fact = detail.fact_requests[0]; assert.equal(fact.status, 'open');
      await page.getByText(/工作包修订.*等待业务事实/).waitFor();
      await expect('outsider', root + '/fact-requests/' + fact.id, 'GET', undefined, 403);
      await expect('contact', root + '/work-packages/' + work.id, 'GET', undefined, 403);
      await as('contact'); await button('返回工作包待办').click(); await button('查看事实问题 ' + fact.id).click(); await idle();
      assert.equal(await button('记录治理结论').count(), 0); await button('答复业务事实').click();
      const answer = '合成答复<script>alert(1)</script>。' + '中文长文只记录已经核对的实际做法。'.repeat(14);
      await field('事实答复').fill(answer); await field('来源依据').fill('合成表单第1页');
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('确认提交本次操作').click(); await page.locator('#login-name').waitFor(); await login('contact'); await idle();
      assert.equal(await field('事实答复').inputValue(), answer);
      await noOverflow(); await page.screenshot({ path: path.join(output, 'desktop-answer.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow(); await page.screenshot({ path: path.join(output, 'mobile-answer.png'), fullPage: true }); await page.setViewportSize({ width: 1699, height: 828 });
      await commit(); assert.equal((await read()).fact_requests[0].answer_text, answer);
      await page.reload(); await idle(); await page.getByText(answer, { exact: true }).waitFor();
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle();
      assert.equal(new URL(page.url()).searchParams.get('factRequest'), String(fact.id));
      checks.push('department-limited fact response, actual 401 recovery, deep link/back/reload, long safe Chinese desktop/mobile');
      await as('lead'); await button('返回工作包待办').click(); await button('查看工作包 ' + work.id).click(); await idle();
      await button('核对并关闭问题 ' + fact.id).click(); assert.equal(await field('采用情况和关闭依据').inputValue(), '', 'closing requires its own explicit basis'); await field('采用情况和关闭依据').fill('合成答复已核对，继续由MDM判断'); await commit();
      detail = await read(); assert.equal(detail.fact_requests[0].status, 'closed'); assert.equal(detail.details[0].status, 'pending');
      await button('完成工作包审核').click(); await field('完成审核依据').fill('合成未完成尝试'); await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); await discard();
      for (const row of detail.details) {
        await field('治理明细').selectOption(String(row.id)); await button('记录治理结论').click(); await field('处理状态').selectOption('not_applicable'); await field('判断依据').fill('合成流程无数据声明，人工判断不适用，仅用于测试'); await commit();
      }
      await button('完成工作包审核').click(); assert.equal(await field('完成审核依据').inputValue(), '', 'completion must not reuse a detail decision as review basis'); await field('完成审核依据').fill('合成明细及事实问题逐项核对完成'); await commit();
      detail = await read(); assert.equal(detail.package.status, 'completed'); assert.equal(detail.package.process_version_id, versionId); assert.equal(detail.package.source_content_hash, digest(doc)); assert.equal(detail.reviews.length, 1);
      await page.screenshot({ path: path.join(output, 'completed.png'), fullPage: true }); assert.equal(await button('记录治理结论').count(), 0);
      checks.push('MDM closes answered fact, completion blocked until decisions, completed package and review retain immutable version');
      await as('adminMulti'); assert.equal(await button('建立工作包').count(), 0); assert.equal(await button('生成待核对明细').count(), 0);
      assert.equal((await request('adminMulti', root + '/creation-tasks/reconcile', 'POST', { process_version_id: versionId })).status, 403);
      checks.push('administrator combined role remains read-only');
      // Keep original page/API compatibility and historical fixed versions.
      const legacy = await context.newPage(); await legacy.goto(fixture.baseURL + '/#/processGovernance?workspace=dataGovernance&package=' + work.id);
      await legacy.locator('#pdgModalTitle').waitFor(); assert.ok((await legacy.locator('#pdgModalSubtitle').textContent()).includes(String(versionId))); await legacy.close();
      await as('lead'); await button('返回工作包待办').click(); await idle();
      const [[source]] = await pool.query('SELECT * FROM process_design_versions WHERE id=?', [versionId]);
      const nextDoc = structuredClone(doc); nextDoc.process.process_name = '合成新版不改旧工作包';
      // A synthetic retained V7 version exercises every detail renderer in the real repository.
      nextDoc.data_objects = [{ data_ref:'data_sample', data_name:'合成记录', description:'仅用于界面验证', information_type:'identifier',
        fields:[{field_ref:'field_code',field_name:'记录编号',field_type:'文本',definition:'合成唯一编号'}],
        behavior_links:[{link_ref:'link_sample',behavior_ref:'behavior_prepare',operation:'create'}], source_relations:[],
        lifecycle:{routes:[{route_ref:'route_sample',route_label:'合成销毁路径',events:[{event_ref:'event_sample',action:'destroy',target_scope:'all_records',high_risk:true,trigger:{mode:'business_condition'},responsibility:{mode:'explicit',department:'合成甲部'},exception_handling:'存在争议时停止'}]}]} }];
      async function cloneVersion(edition, document, schema) {
        const [result] = await pool.execute(`INSERT INTO process_design_versions
          (draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,'published')`, [source.draft_id, source.document_id, source.document_no, document.process.process_name, edition, source.document_no + ':' + edition, source.department_id, schema, JSON.stringify(document), digest(document), source.source_revision_no]);
        return Number(result.insertId);
      }
      const newerId = await cloneVersion('B', nextDoc, 'process-governance-v7');
      const v8 = { ...nextDoc, schema_version:'process-governance-v8' }; const v8Id = await cloneVersion('C', v8, v8.schema_version);
      await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=?", [versionId]);
      await refresh(); await button('建立工作包').click();
      assert.ok((await field('已发布流程版本').textContent()).includes('历史已发布'));
      assert.equal(await field('已发布流程版本').locator('option[value="' + v8Id + '"]').count(), 0);
      await field('已发布流程版本').selectOption(String(newerId)); await commit();
      const newer = (await expect('lead', root + '/workbench', 'GET')).work_packages.find(p => p.process_version_id === newerId);
      assert.ok(newer && newer.id !== work.id); assert.equal((await read()).package.source_content_hash, digest(doc));
      await expect('lead', root + '/creation-tasks/reconcile', 'POST', { process_version_id:v8Id }, 409);
      checks.push('old page retains same package; historical V7 selectable; distinct newer package cannot rebind old source; V8 remains unsupported');
      await button('生成待核对明细').click();
      await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?', [JSON.stringify(doc), newerId]);
      await button('确认提交本次操作').click(); await page.getByRole('alert').waitFor(); assert.equal(await button('放弃本次输入').count(), 1);
      await pool.execute('UPDATE process_design_versions SET process_content_json=? WHERE id=?', [JSON.stringify(nextDoc), newerId]);
      await commit();
      const rich = await expect('lead', root + '/work-packages/' + newer.id, 'GET');
      assert.deepEqual([...new Set(rich.details.map(v => v.detail_type))].sort(), ['critical_field','data_flow','data_object_identity','lifecycle_rule']);
      for (const item of rich.details) {
        await field('治理明细').selectOption(String(item.id));
        await page.getByText('系统未自动确认', { exact:false }).waitFor();
        if (item.detail_type === 'lifecycle_rule') await page.getByText(/不可逆动作/).waitFor();
      }
      await page.screenshot({ path:path.join(output,'lifecycle-detail.png'), fullPage:true });
      await page.setViewportSize({width:390,height:844}); await noOverflow(); await page.screenshot({path:path.join(output,'mobile-detail.png'),fullPage:true}); await page.setViewportSize({width:1699,height:828});
      checks.push('retained synthetic V7 object/field/data-flow/lifecycle details, high-risk reasons, responsive rendering');
      await button('记录治理结论').click(); await field('治理结论').fill('不得跨身份展示');
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('确认提交本次操作').click(); await page.locator('#login-name').waitFor(); await login('admin'); await idle();
      assert.equal(await field('治理结论').count(), 0); assert.ok(!(await page.locator('body').textContent()).includes('不得跨身份展示'));
      checks.push('real source-digest mismatch rejects writes and retains editor; changed login identity clears private draft');
      await as('lead'); await button('返回工作包待办').click(); await idle();
      let started, release; const pending = new Promise(resolve => { started = resolve; }); const gate = new Promise(resolve => { release = resolve; });
      const detailUrl = root + '/work-packages/' + newer.id;
      await page.route('**' + detailUrl, async route => { const res = await route.fetch(); started(); await gate; await route.fulfill({ response:res }).catch(() => {}); }, { times:1 });
      await button('查看工作包 ' + newer.id).click(); await pending; await button('返回工作包待办').click(); release(); await idle();
      assert.equal(await field('治理明细').count(), 0);
      await page.route('**/api/process-data-governance/workbench?*', route => route.fulfill({ status:503, json:{ error:'合成读取失败' } }), { times:1 });
      await refresh(); await page.getByRole('alert').waitFor(); assert.equal(await button('查看工作包 ' + work.id).count(), 0); await refresh();
      await page.route('**/api/process-data-governance/status', route => route.fulfill({ json:{ enabled:false, read_only:false } }), { times:1 });
      await refresh(); await page.getByText('数据治理尚未开启', { exact:true }).waitFor(); assert.equal(await button('建立工作包').count(), 0); await refresh();
      // UI projection only; existing API suite separately exercises actual readonly route/repository guards.
      await page.route('**/api/process-data-governance/status', route => route.fulfill({ json:{ enabled:true, read_only:true } }), { times:1 });
      await refresh(); await page.getByText('成果查阅模式', { exact:true }).waitFor(); assert.equal(await button('建立工作包').count(), 0);
      await refresh(); checks.push('late responses discarded; read failure clears stale rows; disabled/readonly UI fault projections hide actions');
      assert.deepEqual(pageErrors, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, consoleErrors, source: { versionId, packageId: work.id }, boundary: 'owned MySQL/HTTP/Edge; faults explicitly injected; no production or manual acceptance' }, null, 2));
    } catch (error) { await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.stack, checks, pageErrors, consoleErrors }, null, 2)); throw error; }
    finally { await context.close(); await browser.close(); }
  }, { processDataGovernanceVersionId: 1, evidenceDir: output });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
