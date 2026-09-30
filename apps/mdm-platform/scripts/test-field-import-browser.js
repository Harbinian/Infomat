// Synthetic HTTP/MySQL/Edge only. Requires frontend build; owns and cleans its fixture.
// --output must be a fresh repository artifacts directory. No formal DB or private config.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
async function workbook(rows, headers = ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']) {
  const book = new ExcelJS.Workbook(); const sheet = book.addWorksheet('字段台账'); sheet.addRow(headers); rows.forEach(row => sheet.addRow(row));
  return Buffer.from(await book.xlsx.writeBuffer());
}
async function main() {
  await withStage05Fixture(async ({ fixture, pool, expect, request, owner }) => {
    fs.writeFileSync(path.join(output, 'owned-fixture.json'), JSON.stringify({ owner, baseURL: fixture.baseURL }, null, 2));
    const own = await expect('contact', '/api/data-map/contexts', 'POST', { title: '合成导入上下文甲', dept_id: 91 }, 201);
    const other = await expect('contact', '/api/data-map/contexts', 'POST', { title: '合成导入上下文乙', dept_id: 91 }, 201);
    await pool.execute("INSERT INTO data_map_contexts(context_key,title,dept_id,dept_name) VALUES ('synthetic_foreign','其他部门不可见上下文',92,'合成乙部')");
    const [[foreign]] = await pool.query("SELECT id FROM data_map_contexts WHERE context_key='synthetic_foreign'");
    const original = await expect('contact', '/api/field-entries', 'POST', { context_id: own.id, data_object: '历史合成对象', field_name_cn: '历史字段', field_name_en: 'legacy_field', note: '原有字段' });
    const [[legacyBefore]] = await pool.query('SELECT * FROM data_map_fields WHERE id=?', [original.id]);
    const good = await workbook([['合成对象', '字段导入说明', '合成导入字段', 'synthetic_import', '字符串', '合成系统甲、合成系统乙', '手工']]);
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], consoleErrors = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    const ready = () => page.locator('[data-map-state="ready"]').waitFor();
    const file = () => page.getByLabel('字段台账 Excel', { exact: true });
    const submit = () => page.locator('section[aria-labelledby="field-import-heading"] button[type="submit"]');
    const refresh = async () => { await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await ready(); };
    const chooseFile = async (buffer, name = '合成字段.xlsx') => {
      if (await page.locator('[data-field-import-file]').count()) page.once('dialog', dialog => dialog.accept());
      await file().setInputFiles({ name, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    };
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click(); await ready(); }
    async function send() { const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/import/field-entries'); response.catch(() => {}); await submit().click(); return response; }
    async function acknowledge() { await refresh(); await page.getByLabel('我已核对目标台账，并已从文件中移除已导入的行').check(); }
    try {
      await page.goto(fixture.baseURL + '/app/data-map?context=' + own.id); await login('contact');
      await chooseFile(good);
      assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/);
      const downloadWait = page.waitForEvent('download'); await page.getByRole('link', { name: '下载字段台账模板', exact: true }).click();
      const download = await downloadWait; const templatePath = path.join(output, 'downloaded-template.xlsx'); await download.saveAs(templatePath);
      const template = new ExcelJS.Workbook(); await template.xlsx.readFile(templatePath);
      assert.deepEqual(template.getWorksheet('字段台账').getRow(1).values.slice(1), ['数据对象', '字段说明', '中文字段名', '英文字段名', '字段类型', '消费系统', '同步方式']);
      assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/);
      await refresh(); assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/);
      await page.getByLabel('数据地图上下文', { exact: true }).selectOption(String(other.id)); await ready();
      assert.equal(await submit().isDisabled(), true);
      assert.match(await page.locator('[data-field-import-target]').innerText(), /合成导入上下文甲/);
      await page.getByLabel('数据地图上下文', { exact: true }).selectOption(String(own.id)); await ready();
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '数据质量', exact: true }).click(); assert.match(page.url(), /\/app\/data-map/);
      let reloadBlocked = false; page.once('dialog', async d => { reloadBlocked = d.type() === 'beforeunload'; await d.dismiss(); });
      await page.reload({ timeout: 1500 }).catch(e => assert.equal(e.name, 'TimeoutError')); assert.equal(reloadBlocked, true);
      assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/);
      checks.push('template headers, refresh/navigation protection, and immutable import target');
      for (const status of [403, 409, 503]) {
        await page.route('**/api/import/field-entries', route => route.fulfill({ status, json: {} }), { times: 1 });
        assert.equal((await send()).status(), status); await page.locator('[data-field-import-error]').waitFor();
        assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/); assert.equal(await submit().isDisabled(), true);
        await acknowledge();
      }
      await context.setOffline(true); await submit().click(); await page.locator('[data-field-import-error]').waitFor();
      assert.match(await page.locator('[data-field-import-file]').innerText(), /合成字段.xlsx/); await context.setOffline(false); await acknowledge();
      let release; let started; const waiting = new Promise(resolve => { started = resolve; }); const hold = new Promise(resolve => { release = resolve; }); let posts = 0;
      await page.route('**/api/import/field-entries', async route => { posts++; started(); await hold; await route.continue(); }, { times: 1 });
      const response = send(); await waiting;
      assert.equal(await submit().isDisabled(), true); assert.equal(await file().isDisabled(), true);
      assert.equal(await page.getByLabel('数据地图上下文', { exact: true }).isDisabled(), true);
      await submit().evaluate(el => el.click()); release(); assert.equal((await response).status(), 200); await ready();
      await page.getByText('已导入 1 行', { exact: false }).waitFor(); assert.equal(posts, 1);
      const fields = await expect('contact', '/api/field-entries/mapping/' + own.id, 'GET');
      assert.equal(fields.length, 2); const imported = fields.find(row => row.field_name_en === 'synthetic_import');
      assert.ok(imported); assert.equal(imported.business_definition, '字段导入说明');
      assert.match(await page.locator('[aria-label="关联字段台账"]').innerText(), /合成导入字段/);
      assert.equal((await expect('contact', '/api/field-entries/mapping/' + other.id, 'GET')).length, 0);
      checks.push('injected failures retain file; real multipart import targets original context; duplicate clicks blocked');
      await chooseFile(await workbook([['合成对象', '重复字段说明', '合成导入字段', 'synthetic_import']]));
      assert.equal((await send()).status(), 400); await page.locator('[data-field-import-error]').waitFor();
      assert.equal((await expect('contact', '/api/field-entries/mapping/' + own.id, 'GET')).length, 2);
      await acknowledge();
      await chooseFile(await workbook([['缺表头']], ['错误表头'])); await acknowledge(); assert.equal((await send()).status(), 400);
      await page.locator('[data-field-import-error]').waitFor(); assert.match(await page.locator('[data-field-import-error]').innerText(), /表头/);
      checks.push('real malformed-header and duplicate-key errors preserve file and existing rows');
      await pool.execute("INSERT INTO data_map_naming_rules(rule_type,match_value,severity,status) VALUES ('contains','禁止测试','block','active'),('contains','警告测试','warn','active')");
      await chooseFile(await workbook([
        ['合成对象', '允许行', '部分成功字段', 'partial_success'],
        ['合成对象', '应被阻断', '禁止测试字段', 'blocked_field']
      ])); await acknowledge(); assert.equal((await send()).status(), 400); await page.locator('[data-field-import-error]').waitFor();
      assert.match(await page.locator('[data-field-import-error]').innerText(), /部分行/);
      const partial = await expect('contact', '/api/field-entries/mapping/' + own.id, 'GET');
      assert.ok(partial.some(row => row.field_name_en === 'partial_success')); assert.ok(!partial.some(row => row.field_name_en === 'blocked_field'));
      assert.equal(await submit().isDisabled(), true);
      await page.locator('section[aria-labelledby="field-import-heading"]').screenshot({ path: path.join(output, 'partial-error.png') });
      await chooseFile(await workbook([['合成对象', '警告仍保留', '警告测试字段', 'warning_field']])); await acknowledge(); assert.equal((await send()).status(), 200);
      await page.getByText('已导入 1 行', { exact: false }).waitFor(); await ready();
      const warning = (await expect('contact', '/api/field-entries/mapping/' + own.id, 'GET')).find(row => row.field_name_en === 'warning_field');
      assert.equal(warning.quality_status, 'warn');
      assert.equal((await pool.query('SELECT * FROM data_map_quality_issues WHERE field_id=?', [warning.id]))[0].length, 1);
      checks.push('real blocked-name partial write is explicit; warning quality state and issue retained');
      await chooseFile(good, '很长的合成字段台账文件名用于验证桌面视口中文件说明仍然完整可读.xlsx');
      await file().setInputFiles({ name: '不支持.xls', mimeType: 'application/vnd.ms-excel', buffer: good });
      await page.locator('[data-field-import-error]').waitFor(); assert.match(await page.locator('[data-field-import-file]').innerText(), /很长/);
      await file().setInputFiles({ name: '超大.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.alloc(5 * 1024 * 1024 + 1) });
      assert.match(await page.locator('[data-field-import-error]').innerText(), /5MB/);
      page.once('dialog', d => d.dismiss()); await file().setInputFiles({ name: '替换取消.xlsx', mimeType: 'application/octet-stream', buffer: good });
      assert.match(await page.locator('[data-field-import-file]').innerText(), /很长/);
      for (const [width, height, name] of [[1699, 828, 'desktop']]) {
        await page.setViewportSize({ width, height }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
      }
      await page.setViewportSize({ width: 1699, height: 828 }); await page.getByRole('button', { name: '选择字段台账文件', exact: true }).focus(); await page.keyboard.press('Tab'); assert.equal(await submit().evaluate(el => el === document.activeElement), true);
      checks.push('file limits, replacement cancellation, keyboard, Edge 1699x828 desktop at 100 percent');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await submit().click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('contact');
      assert.match(await page.locator('[data-field-import-file]').innerText(), /很长/); assert.equal(await submit().isDisabled(), true); await acknowledge();
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await submit().click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('adminMulti');
      assert.equal(await page.locator('[data-field-import-file]').count(), 0); assert.equal(await file().count(), 0);
      checks.push('real session expiry retains file for same person and clears it for different identity');
      async function rawImport(who, contextId, withCsrf = true, buffer = good) {
        const client = await runtime().request.newContext({ baseURL: fixture.baseURL });
        try {
          assert.equal((await client.post('/api/org/login', { data: { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword } })).status(), 200);
          const csrf = (await (await client.get('/api/csrf-token')).json()).csrfToken;
          return await client.post('/api/import/field-entries', { headers: withCsrf ? { 'X-CSRF-Token': csrf } : {}, multipart: { context_id: String(contextId), file: { name: '合成.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer } } });
        } finally { await client.dispose(); }
      }
      for (const who of ['admin', 'adminMulti', 'outsider']) assert.equal((await rawImport(who, own.id)).status(), 403);
      assert.equal((await rawImport('contact', foreign.id)).status(), 403);
      assert.equal((await rawImport('contact', own.id, false)).status(), 403);
      const concurrent = await workbook([['并发合成对象', '并发字段', '并发导入字段', 'concurrent_import']]);
      const raced = await Promise.all([rawImport('contact', other.id, true, concurrent), rawImport('contact', other.id, true, concurrent)]);
      assert.deepEqual(raced.map(r => r.status()).sort(), [200, 400]);
      const [racedFields] = await pool.query('SELECT * FROM data_map_fields WHERE context_id=?', [other.id]); assert.equal(racedFields.length, 1);
      const [[legacyAfter]] = await pool.query('SELECT * FROM data_map_fields WHERE id=?', [original.id]); assert.deepEqual(legacyAfter, legacyBefore);
      await page.getByRole('link', { name: '打开原数据地图入口', exact: true }).click(); await page.waitForURL('**/#/dataMap');
      await page.locator('#dataMapContextSelect').selectOption(String(own.id)); await page.locator('#dataMapFieldRows').getByText('合成导入字段', { exact: true }).waitFor();
      await page.goBack(); await ready(); assert.match(await page.locator('[aria-label="关联字段台账"]').innerText(), /合成导入字段/);
      await page.reload(); await ready(); assert.equal(await page.getByLabel('数据地图上下文', { exact: true }).inputValue(), String(own.id));
      checks.push('real admin/cross-department/CSRF refusal, concurrent unique key, original rows and legacy readback');
      await page.getByRole('button', { name: '退出登录', exact: true }).click(); await login('contact'); await chooseFile(good);
      let finishLate, enteredLate; const late = new Promise(resolve => { finishLate = resolve; }); const entered = new Promise(resolve => { enteredLate = resolve; });
      await page.route('**/api/import/field-entries', async route => { enteredLate(); await late; await route.fulfill({ json: { imported: 999, context_id: own.id } }).catch(() => {}); }, { times: 1 });
      await submit().click(); await entered;
      page.once('dialog', d => d.accept()); await page.getByRole('link', { name: '数据质量', exact: true }).click(); await page.waitForURL('**/app/quality');
      finishLate(); await page.goBack(); await ready();
      assert.equal(await page.locator('[data-field-import-file]').count(), 0); assert.equal(await page.getByText('已导入 999 行', { exact: false }).count(), 0);
      checks.push('explicit leave during delayed submission prevents stale result and discarded-file resurrection');
      const unexpectedConsole = consoleErrors.filter(value => !/Failed to load resource|net::ERR_|status of (400|401|403|409|503)/.test(value));
      assert.deepEqual(errors, []); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, unexpectedConsole }, null, 2));
      console.log('FIELD_IMPORT_BROWSER_PASS', checks.length);
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, errors }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {}); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
