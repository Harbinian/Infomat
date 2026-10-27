// P25 fixed-format UI checks on the caller's owned synthetic API/database.
// Own Edge100%1699x828 only; no other service, external calls or browser storage.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
module.exports = async ({ fixture, pool, repo, lead, v7, v8, unknown, first, oldHistory, output, check, save }) => {
  let browser, context, page; const errors = [], consoleErrors = [], own = [];
  const test = async (name, fn) => { await check('Edge ' + name, fn); own.push(name); };
  const pw = (() => { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } })();
  try {
    browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
    context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    const label = name => page.getByLabel(name, { exact: true }), button = name => page.getByRole('button', { name, exact: true });
    const idle = async () => { await button('刷新检查记录').waitFor(); await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === '刷新检查记录'); return b && !b.disabled; }); };
    const refresh = async () => { const reading = page.waitForResponse(r => r.request().method() === 'GET' && r.url().endsWith('/api/analysis/capabilities')); await button('刷新检查记录').click(); await reading; await idle(); };
    const layout = async () => { assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, zoom: visualViewport.scale, overflow: document.documentElement.scrollWidth > innerWidth })), { width: 1699, height: 828, zoom: 1, overflow: false }); };
    const login = async who => { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await idle(); };
    const shot = async n => { await layout(); await page.screenshot({ path: path.join(output, n + '.png'), fullPage: true }); };
    await page.goto(fixture.baseURL + '/app/analysis'); await login('lead');
    await test('actual capabilities enable V8 and V7, disable unknown and preserve Chinese scope', async () => {
      await label('检查材料类型').selectOption('v7_source'); await idle();
      assert.equal(await label('已保存材料').locator(`option[value="${unknown.source_id}"]`).evaluate(o => o.disabled), true);
      assert.equal(await label('已保存材料').locator(`option[value="${v8.source_id}"]`).evaluate(o => o.disabled), false);
      assert.equal(await label('已保存材料').locator(`option[value="${v7.source_id}"]`).evaluate(o => o.disabled), false);
      await label('已保存材料').selectOption(v7.source_id); await label('本轮范围说明').fill('本轮已保存材料核对范围：保留中文输入，尚未提交。');
      await refresh(); assert.equal(await label('本轮范围说明').inputValue(), '本轮已保存材料核对范围：保留中文输入，尚未提交。'); await shot('format-selection');
    });
    const listURL = '**/api/analysis/sources?kind=v7_source*';
    await test('backend 409 remains accurate through shared client and failed submission retains input', async () => {
      // Simulate outdated advertised support; the real API must still refuse.
      await page.route(listURL, async route => { const response = await route.fetch(), data = await response.json(); for (const s of data.items) if (s.ref_id === unknown.source_id) s.deterministic_format.supported = true; await route.fulfill({ response, json: data }); });
      await refresh(); await label('已保存材料').selectOption(unknown.source_id);
      await button('建立检查任务').click(); await idle(); assert((await page.locator('body').innerText()).includes('文件格式暂不能用于本次检查')); assert((await label('本轮范围说明').inputValue()).includes('保留中文输入')); await shot('accurate-refusal');
      await page.unroute(listURL); await refresh(); assert(await button('建立检查任务').isDisabled());
      await label('已保存材料').selectOption(v7.source_id);
    });
    await test('committed response loss requires explicit same-request reconciliation and no auto replay', async () => {
      let committed, originalBody, posts = 0;
      const url = '**/api/analysis/runs';
      await page.route(url, async route => { if (route.request().method() !== 'POST') return route.continue(); posts++; originalBody = route.request().postDataJSON(); const r = await route.fetch(); assert.equal(r.status(), 200); committed = await r.json(); await route.abort('failed'); });
      await button('建立检查任务').click(); await idle(); await button('核对同一请求结果').waitFor(); assert.equal(posts, 1); assert(await button('建立检查任务').isDisabled());
      await refresh(); assert.equal(posts, 1); assert((await label('本轮范围说明').inputValue()).includes('保留中文输入')); await shot('write-unknown');
      await page.unroute(url);
      const response = page.waitForResponse(r => r.request().method() === 'POST' && r.url().endsWith('/api/analysis/runs'));
      await button('核对同一请求结果').click(); const r = await response; assert.deepEqual(r.request().postDataJSON(), originalBody); assert.deepEqual(await r.json(), committed); await idle();
      assert.equal(await label('本轮范围说明').inputValue(), ''); assert.equal((await repo.getAnalysisRun(lead, committed.run_id)).manifest.check_scope.description, originalBody.check_scope.description); save('browser-reconciliation.json', { original_request_id: originalBody.request_id, committed_run: committed, repeated_same_body: true, automatic_replays: 0 });
    });
    await test('scope loss clears results selection rejects stale replies and input survives 401 relogin', async () => {
      await label('已保存材料').selectOption(v7.source_id); await label('本轮范围说明').fill('身份与范围变化后仍保留的中文说明');
      await page.route('**/api/analysis/runs', route => route.request().method() === 'POST' ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'AUTH_REQUIRED' }) }) : route.continue());
      await button('建立检查任务').click(); await page.locator('#login-name').waitFor(); await page.unroute('**/api/analysis/runs'); await login('lead'); assert.equal(await label('本轮范围说明').inputValue(), '身份与范围变化后仍保留的中文说明');
      await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?', [v7.source_id]);
      // mdm_lead remains global: remove only the selected row in a stale list to
      // verify UI invalidation, while real departmental scope is tested via HTTP.
      await page.route(listURL, async route => { const response = await route.fetch(), data = await response.json(); data.items = data.items.filter(s => s.ref_id !== v7.source_id); await route.fulfill({ response, json: data }); });
      await refresh(); assert(await button('建立检查任务').isDisabled()); assert.equal(await label('本轮范围说明').inputValue(), '身份与范围变化后仍保留的中文说明');
      await page.unroute(listURL); await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=91 WHERE source_id=?', [v7.source_id]); await refresh();
      const accept = page.waitForEvent('dialog'); const select = label('查看检查记录').selectOption(first.run_id); await (await accept).accept(); await select; await idle();
      let release, observed; const gate = new Promise(r => { release = r; }), seen = new Promise(r => { observed = r; });
      await page.route('**/api/analysis/runs/' + first.run_id, async route => { observed(); await gate; await route.continue().catch(() => {}); });
      await button('刷新检查记录').click(); await seen; await page.getByRole('link', { name: '当前身份', exact: true }).click(); release(); await page.unroute('**/api/analysis/runs/' + first.run_id); await page.getByRole('heading', { name: '当前身份', exact: true }).waitFor();
      await page.getByRole('link', { name: '分析检查台', exact: true }).click(); await idle();
    });
    await test('legacy V8 read-only limitation and administrator read-only controls render at desktop size', async () => {
      await label('查看检查记录').selectOption(oldHistory.run_id); await idle(); assert((await page.locator('body').innerText()).includes('旧结果适用范围受限')); assert(!(await page.locator('body').innerText()).includes('process-governance-v8')); await shot('legacy-v8-limitation');
      await button('退出登录').click(); await login('adminMulti'); assert(await button('建立检查任务').isDisabled()); await shot('admin-read-only');
    });
    assert.deepEqual(errors, []); assert(consoleErrors.every(e => /^Failed to load resource:/.test(e) && /409|401|net::ERR_FAILED/.test(e)));
    save('browser-results.json', { passed: true, checks: own, browser: 'Microsoft Edge', viewport: { width: 1699, height: 828 }, zoom: 1, page_errors: errors, console_errors: consoleErrors, real_api: true, human_ime: false, business_acceptance: false });
  } catch (e) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'browser-failure.png'), fullPage: true }).catch(() => {}); save('browser-failure-state.json', { error: e.message, body: await page.locator('body').innerText().catch(() => ''), options: await page.locator('#analysis-source option').evaluateAll(os => os.map(o => ({ value: o.value, text: o.textContent, disabled: o.disabled }))).catch(() => []), errors, consoleErrors }); } throw e; }
  finally { if (context) await context.close(); if (browser) await browser.close(); save('browser-cleanup.json', { browser_closed: !browser || !browser.isConnected() }); }
};
