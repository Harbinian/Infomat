// Owned MySQL + real HTTP + Edge. All identities and records are synthetic.
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
const endpoint = '/api/quality/field-identities/progress';
async function main() {
  await withStage05Fixture(async ({ fixture, pool, expect, request }) => {
    assert.equal((await fetch(fixture.baseURL + '/app/quality')).status, 200);
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], pageErrors = [], consoleErrors = [], requests = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', r => { if (r.url().includes('/api/quality/')) requests.push({ path: new URL(r.url()).pathname, method: r.method() }); });
    const button = name => page.getByRole('button', { name, exact: true });
    const ready = () => page.locator('[data-quality-state="ready"]').waitFor();
    const overall = () => page.locator('[data-quality-overall]').textContent();
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor(); await ready();
    }
    async function refresh() {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint && r.status() === 200);
      await button('刷新确认进度').click(); await response; await ready();
    }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      await page.goto(fixture.baseURL + '/app/quality'); await login('lead');
      assert.equal(await overall(), '0 / 0 条已确认（0%）');
      await page.getByText('当前可见范围暂无字段身份记录。', { exact: true }).waitFor();
      checks.push('real empty scoped response and zero denominator');
      const longName = '合成中文长对象名称'.repeat(20);
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES(911,'SYNTHETIC_A','合成甲',91),(912,'SYNTHETIC_B','合成乙',92)");
      await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn) VALUES(931,'SYNTHETIC_O1',?),(932,'SYNTHETIC_O2',?)", [longName, longName]);
      await pool.execute("INSERT INTO data_map_fields(id,context_id,object_id,field_key,field_name_cn) VALUES(921,911,931,'a','甲字段'),(922,911,NULL,'b','未归类字段'),(923,912,932,'c','乙字段'),(924,911,931,'d','无身份字段')");
      await pool.execute('INSERT INTO data_map_field_identities(field_id,confirmed) VALUES(921,1),(922,0),(923,1)');
      const [before] = await pool.query('SELECT * FROM data_map_field_identities ORDER BY id');
      const data = await expect('lead', endpoint, 'GET');
      assert.deepEqual(data.overall, { total: 3, confirmed: 2, pct: 67 });
      assert.equal(data.by_domain.find(row => row.domain === longName).total, 2);
      await refresh(); assert.equal(await overall(), '2 / 3 条已确认（67%）');
      assert.equal(await page.getByRole('row').count(), 3);
      await noOverflow(); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
      await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      const table = page.getByLabel('对象分组确认进度', { exact: true });
      await table.focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.identity-table').scrollLeft > 0);
      await button('刷新确认进度').focus(); await page.keyboard.press('Enter'); await ready();
      await page.setViewportSize({ width: 1699, height: 828 });
      checks.push('real nonzero totals, unclassified group, same-name aggregation, missing identity excluded, long Chinese layout');
      await page.reload(); await ready(); assert.equal(await overall(), '2 / 3 条已确认（67%）');
      await page.getByRole('link', { name: '统计看板', exact: true }).click();
      await page.goBack(); await ready();
      await page.getByRole('link', { name: '打开原数据质量入口', exact: true }).click();
      await page.waitForURL('**/#/quality');
      await page.locator('#goldenSourceProgress').getByText(/总体进度：2\/3/).waitFor();
      await page.goBack(); await ready();
      checks.push('reload, back and original quality entry use compatible stored records');
      for (const status of [403, 409, 503]) {
        await page.route('**' + endpoint, route => route.fulfill({ status, json: {} }), { times: 1 });
        await button('刷新确认进度').click(); await page.locator('[data-quality-state="error"]').waitFor();
        assert.equal(await page.locator('[data-quality-overall]').count(), 0);
        await refresh();
      }
      await context.setOffline(true); await button('刷新确认进度').click(); await page.locator('[data-quality-state="error"]').waitFor();
      await context.setOffline(false); await refresh();
      let release, entered;
      const blocked = new Promise(resolve => { release = resolve; });
      const arrived = new Promise(resolve => { entered = resolve; });
      await page.route('**' + endpoint, async route => { entered(); await blocked; await route.fulfill({ json: { overall: { total: 999999, confirmed: 0, pct: 0 }, by_domain: [] } }).catch(() => {}); }, { times: 1 });
      await button('刷新确认进度').click(); await arrived; await refresh(); release();
      await page.waitForTimeout(150); assert.equal(await overall(), '2 / 3 条已确认（67%）');
      checks.push('injected 403/409/503, offline recovery, stale concurrent response ignored');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=182');
      await button('刷新确认进度').click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('contact'); assert.equal(await overall(), '1 / 2 条已确认（50%）');
      assert.equal((await expect('contact', endpoint + '?department_id=92', 'GET')).overall.total, 2);
      await button('退出登录').click(); await login('outsider'); assert.equal(await overall(), '0 / 0 条已确认（0%）');
      await button('退出登录').click(); await login('adminMulti'); assert.equal(await overall(), '2 / 3 条已确认（67%）');
      await pool.execute('DELETE FROM person_roles WHERE person_id=86');
      assert.equal((await request('outsider', endpoint)).status, 403);
      const [after] = await pool.query('SELECT * FROM data_map_field_identities ORDER BY id');
      assert.deepEqual(after, before);
      assert.ok(requests.every(row => row.method === 'GET' && row.path === endpoint));
      assert.equal(await page.getByRole('button', { name: /审核通过|发布|办结|保存|确认字段/ }).count(), 0);
      checks.push('real expiry, department and outsider isolation, admin read-only, permission denial, records unchanged and no retired endpoint');
      assert.deepEqual(pageErrors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x));
      assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, unexpectedConsole, requests }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, pageErrors, text: await page.locator('body').innerText() }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
