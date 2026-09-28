// P21 statistics: owned MySQL, real HTTP and Edge; synthetic records only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const arg = process.argv.indexOf('--output');
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    assert.equal((await fetch(fixture.baseURL + '/app/dashboard')).status, 200);
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], pageErrors = [], consoleErrors = [], failures = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    const button = name => page.getByRole('button', { name, exact: true });
    const metric = key => page.locator(`[data-metric="${key}"]`);
    async function ready() { await page.locator('[data-dashboard-ready="true"]').waitFor(); }
    async function activityReady() { await page.locator('[data-dashboard-activity="ready"]').waitFor(); }
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor(); await ready(); await activityReady();
    }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      await page.goto(fixture.baseURL + '/app/dashboard'); await login('lead');
      const initial = await expect('lead', '/api/mappings', 'GET');
      assert.equal(await metric('mappings').textContent(), String(initial.length));
      assert.equal(await metric('fields').textContent(), '0');
      await page.getByText('暂无流程映射记录。', { exact: true }).waitFor();
      checks.push('real empty scoped API results render zero and explicit empty distributions');
      await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(901,'synthetic-dashboard.json','synthetic','{}')");
      await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,l3_name,dept_name) VALUES(901,'SYNTHETIC_DASH_A','l3',901,901,'合成甲流程','合成甲部'),(902,'SYNTHETIC_DASH_B','l3',901,901,'合成乙流程','合成乙部')");
      await pool.execute("INSERT INTO mdm_mapping_records(id,process_mapping_record_id,owner_dept_id,status) VALUES (901,901,91,'draft'),(902,902,92,'published')");
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id,dept_name) VALUES(911,'SYNTHETIC_CTX_A','合成统计上下文',91,'合成甲部')");
      await pool.execute("INSERT INTO data_map_fields(id,context_id,field_key,field_name_cn) VALUES(921,911,'synthetic_field','合成字段')");
      // Historical actor labels are compatibility data only; login remains person/user_accounts.
      await pool.execute("INSERT INTO users(id,name,employee_no,department_id,password_hash) VALUES(82,'合成长中文治理人员名称用于验证筛选和统计展示','SYNTHETIC_HISTORY_A',91,'disabled-synthetic'),(85,'合成乙人员','SYNTHETIC_HISTORY_B',92,'disabled-synthetic')");
      await pool.execute("INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES('synthetic',901,'update',82),('synthetic',902,'update',85)");
      await pool.execute("INSERT INTO mdm_todos(content,to_dept_id,status) VALUES('合成未完成待办',91,'pending'),('合成已完成待办',91,'done')");
      await button('刷新统计').click(); await ready();
      assert.equal(await metric('mappings').textContent(), '2');
      assert.equal(await metric('fields').textContent(), '1');
      await page.locator('[data-dashboard-chart] canvas').first().waitFor();
      const counts = await page.locator('[data-dashboard-chart]').evaluateAll(els => els.map(el => window.echarts.getInstanceByDom(el).getOption().series[0].data));
      assert.equal(counts.length, 2); assert.equal(counts[0].reduce((sum, n) => sum + n, 0), 2);
      assert.equal(counts[1].reduce((sum, n) => sum + n.value, 0), 2);
      const todos = await expect('lead', '/api/todos', 'GET'), conflicts = await expect('lead', '/api/conflicts', 'GET');
      assert.equal(await metric('todos').textContent(), String(todos.filter(x => x.status === 'pending').length));
      assert.equal(await metric('conflicts').textContent(), String(conflicts.filter(x => ['pending', 'coordinating'].includes(x.status)).length));
      checks.push('real historical mapping/field records, pending counts and rendered charts agree with original APIs');
      await page.getByRole('link', { name: '查看原统计看板', exact: true }).click(); await page.waitForURL('**/#/dashboard');
      await page.waitForFunction(() => document.getElementById('metricMappings')?.textContent === '2');
      assert.equal(await page.locator('#metricFields').textContent(), '1');
      await page.goBack(); await ready(); await page.reload(); await ready();
      for (const status of [403, 409, 503]) {
        await page.route('**/api/mappings', route => route.fulfill({ status, json: {} }), { times: 1 });
        await button('刷新统计').click(); await ready();
        assert.equal(await metric('mappings').textContent(), '暂不可用');
        assert.equal(await metric('fields').textContent(), '1');
        assert.equal(await page.locator('[data-dashboard-chart]').count(), 0);
        await button('刷新统计').click(); await ready(); assert.equal(await metric('mappings').textContent(), '2');
      }
      await page.route('**/api/field-entries/mapping/911', route => route.fulfill({ status: 503, json: {} }), { times: 1 });
      await button('刷新统计').click(); await ready(); assert.equal(await metric('fields').textContent(), '暂不可用');
      await button('刷新统计').click(); await ready();
      checks.push('legacy entry preserved; reload/back; failed independent statistics never become zero or stale charts');
      await button('刷新治理活动').click(); await activityReady();
      const activityPayload = await expect('lead', '/api/activity/heatmap?scope=all&days=180', 'GET');
      const rawActivity = await require('../server/auditMysqlRepository').makeAuditMysqlRepository(pool).listActivityRows({ startDate: activityPayload.startDate, endDate: activityPayload.endDate });
      const [dateProbe] = await pool.execute('SELECT DATE(operated_at) AS d FROM mdm_version_log LIMIT 1');
      fs.writeFileSync(path.join(output, 'activity-source.json'), JSON.stringify({ databaseRows: rawActivity, mysqlDateType: Object.prototype.toString.call(dateProbe[0].d), api: activityPayload }, null, 2));
      assert.ok((await page.locator('[data-activity-total]').textContent()).startsWith('2 次'));
      await page.getByLabel('治理活跃部门').selectOption('92'); await activityReady();
      assert.ok((await page.locator('[data-activity-total]').textContent()).startsWith('1 次'));
      await page.getByLabel('治理活跃人员').selectOption('82'); await activityReady();
      assert.ok((await page.locator('[data-activity-total]').textContent()).startsWith('0 次'));
      await page.getByLabel('治理活跃部门').selectOption(''); await activityReady();
      assert.ok((await page.locator('[data-activity-total]').textContent()).startsWith('1 次'));
      await page.getByLabel('治理活跃人员').selectOption(''); await activityReady();
      await page.getByLabel('治理活跃范围').selectOption('team'); await activityReady();
      assert.ok(page.url().includes('scope=team'));
      assert.ok((await page.locator('[data-activity-total]').textContent()).startsWith('1 次'));
      await page.route('**/api/activity/heatmap?scope=team*', route => route.fulfill({ status: 503, json: {} }), { times: 1 });
      await button('刷新治理活动').click(); await page.getByText('治理活动暂不可用', { exact: true }).waitFor();
      assert.equal(await page.getByLabel('治理活跃范围').inputValue(), 'team');
      assert.equal(await page.locator('[data-dashboard-day]').count(), 0);
      await button('刷新治理活动').click(); await activityReady();
      await page.reload(); await ready(); await activityReady(); assert.equal(await page.getByLabel('治理活跃范围').inputValue(), 'team');
      await page.locator('[data-dashboard-day]').last().focus(); await page.keyboard.press('Enter');
      assert.ok((await page.locator('[data-day-detail]').textContent()).includes('次有效治理动作'));
      await noOverflow(); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
      await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1699, height: 828 });
      checks.push('applied filters survive failures and reload; keyboard day inspection; desktop/mobile layout');
      await context.setOffline(true); await button('刷新统计').click(); await ready(); assert.equal(await metric('mappings').textContent(), '暂不可用');
      await context.setOffline(false); await button('刷新统计').click(); await ready();
      let release;
      const blocked = new Promise(resolve => { release = resolve; });
      let entered;
      const arrived = new Promise(resolve => { entered = resolve; });
      await page.route('**/api/activity/heatmap?*scope=team*', async route => { entered(); await blocked; await route.fulfill({ json: { dates: [], summary: { totalActions: 999999 }, users: [], departments: [] } }).catch(() => {}); }, { times: 1 });
      await button('刷新治理活动').click(); await arrived;
      await page.getByLabel('治理活跃范围').selectOption('me'); await activityReady(); release();
      await page.waitForTimeout(100); assert.ok(!(await page.locator('[data-dashboard-activity]').textContent()).includes('999999'));
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=182');
      await button('刷新统计').click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('outsider');
      assert.equal(await metric('mappings').textContent(), '0');
      assert.equal(await page.getByLabel('治理活跃范围').inputValue(), 'me');
      assert.equal(await page.getByLabel('治理活跃范围').isDisabled(), true);
      assert.equal((await request('outsider', '/api/activity/heatmap?scope=all')).status, 403);
      assert.equal((await request('outsider', '/api/activity/heatmap?scope=me&user_id=82')).status, 403);
      await button('退出登录').click(); await login('adminMulti');
      assert.equal(await metric('mappings').textContent(), '2');
      const persisted = await expect('adminMulti', '/api/mappings', 'GET');
      assert.deepEqual(persisted.map(x => [x.id, x.status]).sort(), [[901, 'draft'], [902, 'published']]);
      assert.equal(await page.getByRole('button', { name: /审核通过|发布|办结|保存/ }).count(), 0);
      checks.push('offline retry, concurrent late response ignored, real expired session and cross-identity scope enforcement');
      assert.deepEqual(pageErrors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x));
      assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, unexpectedConsole, failures }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'browser-failure.json'), JSON.stringify({ error: error.message, pageErrors, failures, text: await page.locator('body').innerText() }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); process.exitCode = 1; });
