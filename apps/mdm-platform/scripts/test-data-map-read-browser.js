// Synthetic data only. Owns isolated MySQL, HTTP and Edge; requires frontend build.
// Writes logs/screenshots to a new --output directory under artifacts; no formal service.
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
  await withStage05Fixture(async ({ fixture, pool, expect, request }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], consoleErrors = [], checks = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const ready = () => page.locator('[data-map-state="ready"]').waitFor();
    const select = () => page.getByLabel('数据地图上下文', { exact: true });
    const refresh = async () => { const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/data-map/contexts'); await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await response; await ready(); };
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click(); await ready(); }
    async function logout() { await page.getByRole('button', { name: '退出登录', exact: true }).click(); }
    try {
      await page.goto(fixture.baseURL + '/app/data-map'); await login('lead');
      await page.getByText('当前可见范围暂无上下文。', { exact: true }).waitFor();
      const longName = '合成中文字段'.repeat(35);
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id,dept_name,source_file,source_anchor) VALUES(911,'SYNTHETIC_A','合成甲',91,'合成甲部','原始合成材料.xlsx','表一 A15'),(912,'SYNTHETIC_B','合成乙',92,'合成乙部',NULL,NULL),(913,'SYNTHETIC_EMPTY','空上下文',91,'合成甲部',NULL,NULL)");
      await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn) VALUES(931,'SYNTHETIC_O1','合成对象')");
      await pool.execute("INSERT INTO data_map_fields(id,context_id,object_id,field_key,field_name_cn,field_name_en) VALUES(921,911,931,'a',?,'alpha'),(922,912,NULL,'b','乙字段','beta')", [longName]);
      const snapshot = async () => { const [a] = await pool.query('SELECT * FROM data_map_contexts ORDER BY id'); const [b] = await pool.query('SELECT * FROM data_map_fields ORDER BY id'); return { a, b }; };
      const before = await snapshot();
      await refresh(); await select().selectOption('911'); await ready();
      await page.getByRole('cell', { name: longName, exact: true }).waitFor();
      assert.equal((await expect('lead', '/api/field-entries/mapping/911', 'GET'))[0].id, 921);
      assert.equal(await page.getByRole('cell', { name: '[]', exact: true }).count(), 0);
      await page.getByText('原始合成材料.xlsx', { exact: true }).waitFor();
      checks.push('real empty and scoped context/field/source reads, stable IDs');
      for (const [width, height, name] of [[1699,828,'desktop']]) {
        await page.setViewportSize({ width, height });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      }
      await page.getByLabel('关联字段台账', { exact: true }).focus(); await page.keyboard.press('ArrowRight');
      await page.waitForFunction(() => document.querySelector('.identity-table').scrollLeft > 0);
      await page.setViewportSize({ width: 1699, height: 828 });
      await page.reload(); await ready(); assert.equal(await select().inputValue(), '911');
      await page.getByRole('link', { name: '数据质量', exact: true }).click(); await page.goBack(); await ready(); assert.equal(await select().inputValue(), '911');
      await select().selectOption('913'); await ready(); await page.getByText('当前上下文暂无字段。', { exact: true }).waitFor();
      await select().selectOption('911'); await ready();
      checks.push('refresh/back/deep-link selection, empty fields, long Chinese, desktop and keyboard');
      for (const status of [403,409,503]) {
        await page.route('**/api/field-entries/mapping/911', route => route.fulfill({ status, json: {} }), { times: 1 });
        await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await page.locator('[data-map-state="error"]').waitFor();
        assert.equal(await page.getByRole('cell', { name: longName, exact: true }).count(), 0); await refresh();
      }
      await context.setOffline(true); await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await page.locator('[data-map-state="error"]').waitFor(); await context.setOffline(false); await refresh();
      let release, arrived;
      const block = new Promise(r => { release = r; }), entered = new Promise(r => { arrived = r; });
      await page.route('**/api/field-entries/mapping/911', async route => { arrived(); await block; await route.fulfill({ json: [{ id: 999, field_name_cn: '迟到旧结果' }] }).catch(() => {}); }, { times: 1 });
      await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await entered; await refresh(); release();
      await page.waitForTimeout(150); assert.equal(await page.getByText('迟到旧结果', { exact: true }).count(), 0);
      checks.push('injected failure/retry, offline and stale concurrent result protection');
      await page.getByRole('link', { name: '打开原数据地图入口', exact: true }).click(); await page.waitForURL('**/#/dataMap');
      await page.locator('#dataMapContextSelect').selectOption('911'); await page.locator('#dataMapFieldRows').getByText(longName, { exact: true }).waitFor();
      await page.goBack(); await ready();
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=182');
      await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('contact'); assert.equal(await select().locator('option[value="912"]').count(), 0);
      assert.equal((await request('contact', '/api/field-entries/mapping/912')).status, 403);
      await logout(); await login('outsider'); await page.getByText('指定上下文不存在或不在当前可见范围，请重新选择。', { exact: true }).waitFor();
      assert.equal(await page.getByRole('cell', { name: longName, exact: true }).count(), 0);
      await logout(); await login('adminMulti'); await page.getByRole('cell', { name: longName, exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: /创建上下文|导入字段|保存|审核通过/ }).count(), 0);
      await pool.execute('DELETE FROM person_roles WHERE person_id=86'); assert.equal((await request('outsider', '/api/data-map/contexts')).status, 403);
      assert.deepEqual(await snapshot(), before);
      checks.push('old/new compatibility, real expiry, department/unauthorized isolation, admin read-only, original rows unchanged');
      assert.deepEqual(errors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x)); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, unexpectedConsole }, null, 2));
    } catch (e) { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: e.message, errors, text: await page.locator('body').innerText() }, null, 2)); await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw e; }
    finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
