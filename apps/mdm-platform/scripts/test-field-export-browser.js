// Real owned MySQL/HTTP/Edge with synthetic data only; requires frontend build.
// --output is a fresh artifacts directory. Saves workbooks/screenshots; cleans its own fixture.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const arg = process.argv.indexOf('--output');
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
const mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
async function main() {
  await withStage05Fixture(async ({ fixture, pool, owner }) => {
    fs.writeFileSync(path.join(output, 'owned-fixture.json'), JSON.stringify({ owner, baseURL: fixture.baseURL }, null, 2));
    await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id,dept_name) VALUES(911,'SYNTHETIC_A','合成上下文甲',91,'合成甲部'),(912,'SYNTHETIC_B','其他部门上下文',92,'合成乙部'),(913,'SYNTHETIC_C','同部门另一上下文',91,'合成甲部')");
    await pool.execute("INSERT INTO data_map_fields(id,context_id,field_key,field_name_cn,field_name_en,business_definition) VALUES(921,911,'a','合成甲字段','alpha','=合成文本'),(922,912,'b','其他部门字段','beta','保留原文'),(923,913,'c','同部门另一字段','gamma','中文长说明')");
    await pool.execute("INSERT INTO data_map_field_identities(field_id,authoritative_system_name,maintain_dept_id,confirmed,confirmed_by,confirmed_at,status) VALUES(921,'合成原系统',91,1,83,'2026-09-01 01:02:03','confirmed')");
    const snapshot = async () => {
      const result = {};
      for (const table of ['data_map_contexts', 'data_map_fields', 'data_map_field_identities', 'data_map_import_batches']) result[table] = (await pool.query('SELECT * FROM ' + table + ' ORDER BY id'))[0];
      return result;
    };
    const before = await snapshot();
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], consoleErrors = [], checks = []; let downloads = 0, exports = 0, writes = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('download', () => downloads++);
    page.on('request', r => { if (new URL(r.url()).pathname === '/api/export/excel') exports++; if (/\/api\/(data-map|import)\//.test(r.url()) && r.method() !== 'GET') writes++; });
    const ready = () => page.locator('[data-map-state="ready"]').waitFor();
    const button = () => page.getByRole('button', { name: '下载可见范围台账', exact: true });
    const select = () => page.getByLabel('数据地图上下文', { exact: true });
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click(); await ready(); }
    async function download(name, action = () => button().click()) {
      const wait = page.waitForEvent('download'); wait.catch(() => {}); await action(); const file = await wait;
      assert.equal(file.suggestedFilename(), 'mdm-data-map-field-ledger.xlsx');
      await file.saveAs(path.join(output, name + '.xlsx'));
      const book = new ExcelJS.Workbook(); await book.xlsx.readFile(path.join(output, name + '.xlsx'));
      assert.deepEqual(book.worksheets.map(s => s.name), ['字段台账', '黄金源矩阵']);
      assert.equal(book.worksheets[0].columnCount, 13); assert.equal(book.worksheets[1].columnCount, 9);
      return book.worksheets.map(s => s.getSheetValues());
    }
    const preserved = async () => {
      assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '尚未保存的上下文');
      assert.match(await page.locator('[data-field-import-file]').innerText(), /尚未导入.xlsx/);
      assert.equal(writes, 0);
    };
    try {
      await page.goto(fixture.baseURL + '/app/data-map?context=911'); await login('contact');
      await page.getByLabel('上下文标题', { exact: true }).fill('尚未保存的上下文');
      await page.getByLabel('字段台账 Excel', { exact: true }).setInputFiles({ name: '尚未导入.xlsx', mimeType: mime, buffer: fs.readFileSync(path.join(__dirname, '../public/template.xlsx')) });
      const scoped = await download('department');
      assert.equal(scoped[0].length, 4); assert.equal(scoped[1].length, 4);
      assert.match(JSON.stringify(scoped), /合成甲字段/); assert.match(JSON.stringify(scoped), /同部门另一字段/); assert.doesNotMatch(JSON.stringify(scoped), /其他部门字段/);
      const legacyRow = scoped[0].find(row => row?.[4] === '合成甲字段');
      assert.equal(legacyRow[13], '=合成文本');
      const matrixRow = scoped[1].find(row => row?.[3] === '合成甲字段');
      assert.equal(matrixRow[5], '合成原系统'); assert.equal(matrixRow[7], '是');
      await preserved();
      await select().selectOption('913'); await ready(); assert.deepEqual(await download('other-selection'), scoped); await preserved();
      checks.push('real scoped two-sheet workbook, unchanged columns/cell values, selection does not filter scope, draft/file preserved without writes');
      for (const status of [403, 409, 503]) {
        const count = downloads;
        await page.route('**/api/export/excel', r => r.fulfill({ status, json: { error: 'sensitive SQL' } }), { times: 1 });
        await button().click(); await page.locator('[data-field-export-error]').waitFor();
        assert.doesNotMatch(await page.locator('[data-field-export-error]').innerText(), /SQL/); assert.equal(downloads, count); await preserved();
      }
      await context.setOffline(true); await button().click(); await page.locator('[data-field-export-error]').waitFor(); await context.setOffline(false); await preserved();
      await page.route('**/api/export/excel', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<html>not a workbook</html>' }), { times: 1 });
      const invalidCount = downloads; await button().click(); await page.locator('[data-field-export-error]').waitFor(); assert.equal(downloads, invalidCount);
      assert.deepEqual(await download('retry'), scoped);
      checks.push('injected 403/409/503/network/invalid content gives no file; explicit retry and input preservation');
      let release, arrived;
      const held = new Promise(resolve => { release = resolve; }), entered = new Promise(resolve => { arrived = resolve; });
      const bytes = fs.readFileSync(path.join(output, 'department.xlsx'));
      await page.route('**/api/export/excel', async r => { arrived(); await held; await r.fulfill({ contentType: mime, body: bytes }).catch(() => {}); }, { times: 1 });
      const count = downloads, requests = exports;
      await button().click(); await entered;
      assert.equal(await page.getByRole('button', { name: '正在准备台账…' }).isDisabled(), true);
      await page.getByRole('button', { name: '正在准备台账…' }).evaluate(el => el.click()); assert.equal(exports, requests + 1);
      await page.getByRole('button', { name: '取消台账下载' }).click(); release();
      await page.waitForTimeout(150); assert.equal(downloads, count); await preserved();
      assert.deepEqual(await download('after-cancel'), scoped);
      checks.push('concurrent clicks issue one request, explicit cancellation suppresses late download, retry succeeds');
      for (const [width, height, name] of [[1699,828,'desktop'],[390,844,'mobile']]) {
        await page.setViewportSize({ width, height }); await button().scrollIntoViewIfNeeded();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      }
      await button().focus(); assert.deepEqual(await download('keyboard', () => page.keyboard.press('Enter')), scoped);
      page.once('dialog', d => d.dismiss()); await page.reload({ timeout: 1000 }).catch(() => {}); await preserved();
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button().click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('contact'); await preserved();
      page.once('dialog', d => d.accept()); await page.getByRole('link', { name: '打开原数据地图入口', exact: true }).click(); await page.waitForURL('**/#/dataMap');
      assert.deepEqual(await download('legacy', () => page.locator('#dataMap a[href="/api/export/excel"]').click()), scoped);
      await page.goBack(); await ready(); assert.equal(await select().inputValue(), '913'); await page.reload(); await ready();
      checks.push('desktop/mobile/keyboard, cancelled reload protects inputs, old/new workbook cell parity, browser back and reload');
      let finishOld, startedOld;
      const oldHeld = new Promise(resolve => { finishOld = resolve; }), oldEntered = new Promise(resolve => { startedOld = resolve; });
      await page.route('**/api/export/excel', async r => { startedOld(); await oldHeld; await r.fulfill({ contentType: mime, body: bytes }).catch(() => {}); }, { times: 1 });
      const beforeLeave = downloads; await button().click(); await oldEntered;
      await page.getByRole('link', { name: '数据质量', exact: true }).click(); await page.waitForURL('**/app/quality');
      finishOld(); await page.waitForTimeout(150); assert.equal(downloads, beforeLeave);
      await page.goBack(); await ready(); assert.deepEqual(await download('after-return'), scoped);
      checks.push('same-identity re-login retains draft/file; navigation suppresses old download and return supports new download');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button().click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('adminMulti');
      const global = await download('global'); assert.equal(global[0].length, 5); assert.match(JSON.stringify(global), /其他部门字段/);
      await page.getByRole('button', { name: '退出登录', exact: true }).click(); await login('outsider');
      const empty = await download('empty'); assert.equal(empty[0].length, 2); assert.equal(empty[1].length, 2);
      await pool.execute('DELETE FROM person_roles WHERE person_id=86');
      assert.equal((await context.request.get(fixture.baseURL + '/api/export/excel')).status(), 403);
      await button().click(); await page.locator('[data-field-export-error]').waitFor();
      assert.equal((await fetch(fixture.baseURL + '/api/export/excel')).status, 401);
      checks.push('real session expiry, admin global read-only export, empty department headers, revoked permission 403 and anonymous 401');
      assert.deepEqual(await snapshot(), before); assert.equal(writes, 0); assert.deepEqual(errors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x)); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, unexpectedConsole, downloads, writes }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, errors, text: await page.locator('body').innerText() }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
