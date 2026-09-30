// Owned tmpfs MySQL + real HTTP/Edge; synthetic identities/data only.
// Requires frontend build; --output must be a fresh directory under repo artifacts.
// Writes evidence/screenshots and cleans only resources created by withStage05Fixture.
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
  await withStage05Fixture(async ({ fixture, pool, owner, expect, request }) => {
    fs.writeFileSync(path.join(output, 'owned-fixture.json'), JSON.stringify({ owner, baseURL: fixture.baseURL }, null, 2));
    await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id,dept_name) VALUES(911,'SYNTHETIC_A','合成上下文甲',91,'合成甲部'),(912,'SYNTHETIC_B','其他部门上下文',92,'合成乙部'),(913,'SYNTHETIC_C','同部门另一上下文',91,'合成甲部')");
    await pool.execute("INSERT INTO data_map_fields(id,context_id,field_key,field_name_cn,field_name_en,business_definition) VALUES(921,911,'a','合成甲字段','alpha','原定义'),(922,912,'b','其他部门字段','beta','原文保留'),(923,911,'c','无身份字段','gamma','中文长说明'),(924,913,'d','另一上下文字段','delta','原文')");
    await pool.execute("INSERT INTO data_map_field_identities(field_id,authoritative_system_name,authoritative_system_code,maintain_dept_id,owner_user_id,owner_person_id,confidence_level,confirmed,confirmed_by,confirmed_by_person_id,confirmed_at,note,status) VALUES(921,'合成原系统','OLD',91,83,83,'high',1,84,84,'2026-09-01 01:02:03','旧确认备注','confirmed'),(922,'其他部门系统','B',92,NULL,NULL,'medium',0,NULL,NULL,NULL,'保留其他部门原值','needs_review')");
    const originalFields = (await pool.query('SELECT * FROM data_map_fields ORDER BY id'))[0];
    const originalContexts = (await pool.query('SELECT * FROM data_map_contexts ORDER BY id'))[0];
    const otherIdentity = (await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=922'))[0];
    await pool.execute("INSERT INTO data_map_field_identities(field_id,authoritative_system_name,owner_user_id,owner_person_id,confirmed,status) VALUES(924,'历史人员映射待核实',83,NULL,0,'needs_review')");
    const unresolvedIdentity = (await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=924'))[0];
    const row = async () => (await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=921'))[0][0];
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], consoleErrors = [], checks = [], requests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', r => { if (/\/api\/field-identities\//.test(r.url())) requests.push({ method: r.method(), path: new URL(r.url()).pathname }); });
    const ready = () => page.locator('[data-map-state="ready"]').waitFor();
    const identityReady = () => page.locator('[data-field-identity-state="ready"]').waitFor();
    const detail = () => page.locator('[data-field-identity-detail]');
    const target = () => page.getByLabel('字段身份目标', { exact: true });
    const button = name => page.getByRole('button', { name, exact: true });
    const writes = () => requests.filter(r => r.method !== 'GET').length;
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await ready(); }
    async function choose(id) { await target().selectOption(id); await identityReady(); }
    async function edit(value) { await button('维护黄金源信息').click(); await page.getByLabel('权威系统名称', { exact: true }).fill(value); }
    async function discard() { page.once('dialog', d => d.accept()); await button('放弃本次字段身份输入').click(); }
    async function relogin(who) { await button('退出登录').click(); await login(who); await identityReady(); }
    async function save() { await button('保存黄金源信息（待核实）').click(); await page.locator('[data-field-identity-success]').waitFor(); await identityReady(); }
    const refresh = async () => { await button('刷新字段身份').click(); await identityReady(); };
    try {
      await page.goto(fixture.baseURL + '/app/data-map?context=911&identityField=921'); await login('contact'); await identityReady();
      assert.match(await detail().innerText(), /合成原系统/); assert.match(await detail().innerText(), /旧确认备注/);
      assert.equal(await button('办理部门确认').count(), 0);
      await expect('contact', '/api/field-identities/921/confirm', 'POST', { authoritative_system: 'FORBIDDEN' }, 403);
      await expect('reviewB', '/api/field-identities/921', 'PUT', {}, 403);
      await expect('reviewB', '/api/field-identities/field/921', 'GET', undefined, 403);
      await expect('admin', '/api/field-identities/921', 'PUT', {}, 403);
      await expect('admin', '/api/field-identities/921/confirm', 'POST', {}, 403);
      // A maintainer must not bypass the separate reviewer action via PUT.
      await expect('contact', '/api/field-identities/921', 'PUT', { authoritative_system: 'FORBIDDEN', confirmed: true }, 403);
      await expect('contact', '/api/field-identities/921', 'PUT', { authoritative_system: 'FORBIDDEN', status: 'confirmed' }, 403);
      await expect('contact', '/api/field-identities/921', 'PUT', { authoritative_system: 'FORBIDDEN', status: ' confirmed ' }, 403);
      await expect('contact', '/api/field-identities/924', 'PUT', { authoritative_system: 'FORBIDDEN' }, 409);
      assert.equal((await fetch(fixture.baseURL + '/api/field-identities/field/921')).status, 401);
      const csrf = await context.request.put(fixture.baseURL + '/api/field-identities/921', { data: { authoritative_system: 'FORBIDDEN' } }); assert.equal(csrf.status(), 403);
      checks.push('real department scope, anonymous/CSRF rejection, contact cannot confirm and admin cannot write');

      await page.getByLabel('上下文标题', { exact: true }).fill('保留相邻上下文输入');
      await edit('合成新系统');
      await page.getByLabel('权威系统代码', { exact: true }).fill('NEW');
      await page.getByLabel('黄金源备注', { exact: true }).fill('维护后的说明');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('[data-field-identity-form]').screenshot({ path: path.join(output, 'identity-form.png') });
      await button('刷新数据地图').click(); await ready(); await identityReady();
      assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '合成新系统');
      await page.getByLabel('数据地图上下文', { exact: true }).selectOption('913'); await ready();
      assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true);
      assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '合成新系统');
      await page.getByLabel('数据地图上下文', { exact: true }).selectOption('911'); await ready(); await identityReady();
      page.once('dialog', d => d.dismiss()); await target().selectOption('923'); assert.equal(await target().inputValue(), '921');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '数据质量', exact: true }).click(); assert.match(page.url(), /app\/data-map/);
      page.once('dialog', d => d.dismiss()); await page.reload({ timeout: 1000 }).catch(() => {});
      assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '合成新系统');
      const beforeSave = await row(); await save(); const saved = await row();
      assert.equal(saved.authoritative_system_name, '合成新系统'); assert.equal(saved.authoritative_system_code, 'NEW');
      assert.equal(saved.confirmed, 0); assert.equal(saved.status, 'needs_review');
      for (const key of ['id','field_id','maintain_dept_id','owner_user_id','owner_person_id','confirmed_by','confirmed_by_person_id','confirmed_at']) assert.deepEqual(saved[key], beforeSave[key]);
      assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '保留相邻上下文输入');
      checks.push('real maintenance preserves stable IDs/ownership/prior confirmation metadata, resets confirmation only; context switches/refresh/reload/navigation protect inputs');
      // Explicitly discard the neighboring context draft when switching identity.
      page.once('dialog', d => d.accept()); await relogin('reviewA');
      assert.equal(await button('维护黄金源信息').count(), 0);
      await button('办理部门确认').click(); assert.equal(await page.getByLabel('权威系统名称', { exact: true }).getAttribute('readonly'), '');
      await button('确认已保存的黄金源').click(); await page.locator('[data-field-identity-success]').waitFor(); await identityReady();
      const confirmed = await row(); assert.equal(confirmed.confirmed, 1); assert.equal(confirmed.confirmed_by, 84); assert.equal(confirmed.authoritative_system_name, '合成新系统');
      const progress = await expect('reviewA', '/api/quality/field-identities/progress', 'GET'); assert.equal(progress.overall.confirmed, 1);
      await relogin('contact');
      await choose('923'); assert.match(await detail().innerText(), /尚无身份记录/);
      await edit('第二合成系统'); assert.equal(await page.getByLabel('置信度', { exact: true }).inputValue(), '');
      await page.getByLabel('置信度', { exact: true }).selectOption('low'); await save();
      const created = (await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=923'))[0][0];
      assert.equal(created.maintain_dept_id, null); assert.equal(created.owner_user_id, null); assert.equal(created.confirmed, 0);
      checks.push('real separate reviewer confirmation updates progress; new identity leaves unknown ownership NULL and requires explicit confidence');

      await page.getByLabel('数据地图上下文', { exact: true }).selectOption('913'); await ready(); await choose('924');
      assert.match(await page.locator('[aria-labelledby="field-identity-heading"]').innerText(), /暂停维护/);
      assert.equal(await button('维护黄金源信息').count(), 0);
      await page.getByLabel('数据地图上下文', { exact: true }).selectOption('911'); await ready();

      await choose('921'); await edit('并发前草稿');
      await pool.execute("UPDATE data_map_field_identities SET note='另一办理人已变更' WHERE field_id=921");
      const beforeConflict = writes(); await button('保存黄金源信息（待核实）').click(); await page.locator('[data-field-identity-error]').waitFor();
      assert.match(await page.locator('[data-field-identity-error]').innerText(), /原记录已变化/); assert.equal(writes(), beforeConflict);
      await refresh(); assert.match(await detail().innerText(), /另一办理人已变更/); assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '并发前草稿');
      assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true); await discard();
      for (const status of [403,409,503]) {
        await edit('错误保留' + status);
        await page.route('**/api/field-identities/921', r => r.fulfill({ status, json: { error: 'sensitive SQL' } }), { times: 1 });
        await button('保存黄金源信息（待核实）').click(); await page.locator('[data-field-identity-error]').waitFor();
        assert.doesNotMatch(await page.locator('[data-field-identity-error]').innerText(), /SQL/);
        assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true);
        assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '错误保留' + status);
        await refresh(); await discard();
      }
      await edit('断网保留'); await context.setOffline(true); await button('保存黄金源信息（待核实）').click(); await page.locator('[data-field-identity-error]').waitFor(); await context.setOffline(false);
      assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '断网保留'); await discard();
      checks.push('changed record detected before write; injected 403/409/503 and network failures retain input and never replay writes');

      await edit('已写入但响应丢失');
      await page.route('**/api/field-identities/921', async route => { const response = await route.fetch(); assert.equal(response.status(), 200); await route.abort('failed'); }, { times: 1 });
      await button('保存黄金源信息（待核实）').click(); await page.locator('[data-field-identity-error]').waitFor();
      assert.equal((await row()).authoritative_system_name, '已写入但响应丢失'); assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true);
      await refresh(); assert.match(await detail().innerText(), /已写入但响应丢失/);
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button('刷新字段身份').click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('contact'); await identityReady();
      assert.equal(await page.getByLabel('权威系统名称', { exact: true }).inputValue(), '已写入但响应丢失'); assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true);
      await discard();
      checks.push('real write then lost response remains uncertain across same-person session expiry/re-login until explicit reconciliation/discard');

      await edit('单次点击写入'); let release, entered;
      const hold = new Promise(resolve => { release = resolve; }), arrived = new Promise(resolve => { entered = resolve; });
      await page.route('**/api/field-identities/921', async route => { entered(); await hold; await route.continue(); }, { times: 1 });
      const beforeDuplicate = writes(); await button('保存黄金源信息（待核实）').click(); await arrived;
      await button('正在提交…').evaluate(el => el.click()); assert.equal(writes(), beforeDuplicate + 1); release();
      await page.locator('[data-field-identity-success]').waitFor(); await identityReady();
      let releaseRead, enteredRead;
      const holdRead = new Promise(resolve => { releaseRead = resolve; }), arrivedRead = new Promise(resolve => { enteredRead = resolve; });
      await page.route('**/api/field-identities/field/921', async route => { const response = await route.fetch(); enteredRead(); await holdRead; await route.fulfill({ response }).catch(() => {}); }, { times: 1 });
      await button('刷新字段身份').click(); await arrivedRead; await choose('923'); releaseRead(); await page.waitForTimeout(150);
      assert.match(await detail().innerText(), /第二合成系统/); assert.doesNotMatch(await detail().innerText(), /单次点击写入/);
      await page.goBack(); await identityReady(); assert.equal(await target().inputValue(), '921'); await page.goForward(); await identityReady(); assert.equal(await target().inputValue(), '923');
      await page.reload(); await ready(); await identityReady(); assert.equal(await target().inputValue(), '923');
      checks.push('duplicate clicks produce one write; late response cannot replace new target; back/forward/reload retain field selection');

      await choose('921');
      for (const status of [403,409,503]) {
        await page.route('**/api/field-identities/field/921', r => r.fulfill({ status, json: { error: 'sensitive SQL' } }), { times: 1 });
        await button('刷新字段身份').click(); await page.locator('[data-field-identity-state="error"]').waitFor(); assert.equal(await detail().count(), 0); await refresh();
      }
      await page.route('**/api/field-identities/field/921', r => r.fulfill({ json: { id: 1, field_id: 922, authoritative_system: '错字段' } }), { times: 1 });
      await button('刷新字段身份').click(); await page.locator('[data-field-identity-state="error"]').waitFor(); assert.equal(await detail().count(), 0); await refresh();
      await edit('跨身份不可见草稿'); await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button('刷新字段身份').click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('admin'); await identityReady();
      assert.equal(await page.locator('[data-field-identity-form]').count(), 0); assert.equal(await button('维护黄金源信息').count(), 0); assert.equal(await button('办理部门确认').count(), 0);
      await page.goto(fixture.baseURL + '/app/data-map?context=911&identityField=922'); await ready();
      const forbiddenReads = requests.filter(r => r.path === '/api/field-identities/field/922').length;
      assert.equal(forbiddenReads, 0); assert.equal(await detail().count(), 0);
      await choose('921'); await detail().scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1);
      await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.locator('[aria-labelledby="field-identity-heading"]').screenshot({ path: path.join(output, 'identity-detail.png') });
      await button('刷新字段身份').focus(); await page.keyboard.press('Enter'); await identityReady();
      await page.getByRole('link', { name: '打开原数据地图入口', exact: true }).click(); await page.waitForURL('**/#/dataMap');
      await page.locator('#dataMapContextSelect option[value="911"]').waitFor({ state: 'attached' }); await page.locator('#dataMapContextSelect').selectOption('911');
      await page.waitForFunction(() => document.querySelector('#dataMap')?.textContent.includes('合成甲字段'));
      checks.push('read failures clear stale detail, invalid response blocked, cross-identity draft hidden, unseen target not fetched, keyboard/desktop geometry and old entry preserved');
      // Prior expiry tests invalidated the fixture's original HTTP client session.
      const freshClients = {};
      request = async (who, url, method = 'GET', body) => {
        const client = freshClients[who] || (freshClients[who] = {});
        const response = await fetch(fixture.baseURL + url, { method, headers: { 'Content-Type':'application/json', Cookie:client.cookie || '', ...(client.csrf ? {'X-CSRF-Token':client.csrf} : {}) }, body:body === undefined ? undefined : JSON.stringify(body) });
        if (response.headers.get('set-cookie')) client.cookie = response.headers.get('set-cookie').split(';')[0];
        const result = await response.json(); if (url === '/api/csrf-token') client.csrf = result.csrfToken;
        return { status:response.status, body:result };
      };
      expect = async (who,url,method,body,status=200) => { const result = await request(who,url,method,body); assert.equal(result.status,status,`${who} ${method} ${url}: ${JSON.stringify(result.body)}`); return result.body; };
      for (const who of ['contact','reviewA','reviewB','admin']) {
        await expect(who,'/api/org/login','POST',{loginName:'SYNTHETIC_'+who,password:fixture.loginPassword}); await expect(who,'/api/csrf-token','GET');
      }
      await page.goto(fixture.baseURL + '/app/data-map?context=911&identityField=921'); await ready(); await identityReady(); await relogin('contact');
      await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id,status,employment_status) VALUES(901,'SYNTHETIC_INACTIVE','合成停用人员',91,'inactive','inactive')");
      const options = await expect('contact', '/api/field-identities/field/921/responsibility-options', 'GET');
      assert.equal(options.department.id, 91); assert.ok(options.people.some(p => p.person_id === 84));
      assert.ok(!options.people.some(p => [85,901].includes(p.person_id)));
      await expect('admin', '/api/field-identities/field/921/responsibility-options', 'GET', undefined, 403);
      await expect('reviewB', '/api/field-identities/field/921/history', 'GET', undefined, 403);
      assert.equal((await fetch(fixture.baseURL + '/api/field-identities/field/921/history')).status, 401);
      for (const body of [{ maintain_dept_id: 92, owner_person_id: 85 }, { maintain_dept_id: 91, owner_person_id: 85 }, { maintain_dept_id: 91, owner_person_id: 901 }, { maintain_dept_id: 91, owner_person_id: 999999 }, { owner_user_id: 901 }, { maintain_dept_id: 91, owner_person_id: '84.5' }]) {
        const previous = await row();
        await expect('contact', '/api/field-identities/921', 'PUT', { authoritative_system: 'REJECTED', ...body }, 400);
        assert.deepEqual(await row(), previous);
      }
      await edit('责任范围验证');
      await page.getByLabel('维护部门', { exact: true }).selectOption('91');
      await page.getByLabel('维护负责人', { exact: true }).selectOption('84');
      await save(); assert.equal((await row()).owner_person_id, 84); assert.equal((await row()).owner_user_id, 83);
      await button('查阅维护与确认记录').click(); await page.locator('[data-field-identity-history]').waitFor();
      assert.match(await page.locator('[data-field-identity-history]').innerText(), /维护字段身份信息/);
      await page.locator('[data-field-identity-history] summary').first().click();
      assert.match(await page.locator('[data-field-identity-history]').innerText(), /负责人员编号/);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('[aria-labelledby="field-identity-heading"]').screenshot({ path: path.join(output, 'responsibility-history.png') });
      const history = await expect('contact', '/api/field-identities/field/921/history', 'GET');
      assert.equal(history.legacy_history_available, false); assert.equal(history.items[0].operated_by_person_id, '83');
      assert.equal(history.items[0].changes.find(c => c.field_name === 'owner_person_id').new_value, '84');
      assert.ok(history.items.some(item => item.description === '部门确认字段身份'));
      const historical = await expect('admin', '/api/field-identities/field/924/history', 'GET'); assert.deepEqual(historical.items, []);
      checks.push('same-department active responsibility options and writes; foreign/inactive/malformed identities rejected; legacy user ID preserved; authorized operation history and honest legacy gap');

      // The new compare-and-write check is under the field lock, including concurrent requests.
      const snapshot = await expect('contact', '/api/field-identities/field/921', 'GET');
      const simultaneous = await Promise.all(['并发甲','并发乙'].map(authoritative_system => request('contact', '/api/field-identities/921', 'PUT', { authoritative_system, expected_identity: snapshot })));
      assert.deepEqual(simultaneous.map(r => r.status).sort(), [200,409]);
      await expect('reviewA', '/api/field-identities/921/confirm', 'POST', { authoritative_system: '不匹配的系统' }, 409);
      await expect('reviewA', '/api/field-identities/921/confirm', 'POST', { authoritative_system_name: '不匹配的旧调用字段' }, 409);
      const confirmedSnapshot = await expect('reviewA', '/api/field-identities/field/921', 'GET');
      await expect('reviewA', '/api/field-identities/921/confirm', 'POST', { authoritative_system: confirmedSnapshot.authoritative_system, expected_identity: confirmedSnapshot });
      await expect('reviewA', '/api/field-identities/921/confirm', 'POST', {}, 409);
      const beforeRollback = await row();
      const beforeCount = (await pool.query("SELECT COUNT(*) n FROM data_map_change_sets WHERE entity_type='data_map_field_identity'"))[0][0].n;
      const failingPool = { async getConnection() {
        const connection = await pool.getConnection();
        return new Proxy(connection, { get(target, key) {
          if (key === 'execute') return (sql, params) => { if (sql.startsWith('INSERT INTO data_map_version_log')) throw new Error('SYNTHETIC_AUDIT_FAILURE'); return target.execute(sql, params); };
          return typeof target[key] === 'function' ? target[key].bind(target) : target[key];
        } });
      } };
      await assert.rejects(require('../server/fieldIdentityGovernance').makeFieldIdentityGovernance(failingPool).mutate(921, { authoritative_system: '必须回滚' }, { personId:83, departmentId:91, contextId:911 }, 'maintain'), /SYNTHETIC_AUDIT_FAILURE/);
      assert.deepEqual(await row(), beforeRollback);
      assert.equal((await pool.query("SELECT COUNT(*) n FROM data_map_change_sets WHERE entity_type='data_map_field_identity'"))[0][0].n, beforeCount);
      // Real missing audit dependency must fail closed, with no partial business write.
      await pool.execute('RENAME TABLE data_map_version_log TO p21_owned_audit_unavailable');
      try {
        await expect('contact', '/api/field-identities/field/921/history', 'GET', undefined, 503);
        await expect('contact', '/api/field-identities/921', 'PUT', { authoritative_system:'必须完整回滚' }, 503);
        assert.deepEqual(await row(), beforeRollback);
        assert.equal((await pool.query("SELECT COUNT(*) n FROM data_map_change_sets WHERE entity_type='data_map_field_identity'"))[0][0].n, beforeCount);
      } finally { await pool.execute('RENAME TABLE p21_owned_audit_unavailable TO data_map_version_log'); }
      for (let i=0; i<22; i++) await expect('contact', '/api/field-identities/923', 'PUT', { authoritative_system: '历史分页' + i });
      const firstPage = await expect('contact', '/api/field-identities/field/923/history', 'GET');
      const secondPage = await expect('contact', '/api/field-identities/field/923/history?before=' + firstPage.next_cursor, 'GET');
      assert.equal(firstPage.items.length, 20); assert.ok(secondPage.items.length >= 3);
      assert.equal(new Set([...firstPage.items, ...secondPage.items].map(i => i.id)).size, firstPage.items.length + secondPage.items.length);
      checks.push('locked compare-and-write yields one success/one conflict; mismatched/repeated confirmation rejected; audit failure rolls back identity and header; history pagination has no duplicates');

      await refresh(); await edit('查历史时保留输入');
      for (const status of [403,409,503]) {
        await page.route('**/api/field-identities/field/921/history', r => r.fulfill({ status, json: { error:'injected' } }), { times:1 });
        await button('查阅维护与确认记录').click(); await page.getByText('记录读取失败，请重试；失败不表示没有记录。', { exact:true }).waitFor();
        assert.equal(await page.locator('[data-field-identity-history]').count(), 0);
        assert.equal(await page.getByLabel('权威系统名称', { exact:true }).inputValue(), '查历史时保留输入');
      }
      await button('查阅维护与确认记录').click(); await page.locator('[data-field-identity-history]').waitFor();
      await discard();
      await page.route('**/api/field-identities/field/921/responsibility-options', r => r.fulfill({ status:503, json:{error:'injected'} }), { times:1 });
      await edit('名单失败保留输入'); await button('重试责任名单').waitFor();
      assert.equal(await button('保存黄金源信息（待核实）').isDisabled(), true);
      await button('重试责任名单').click(); await page.getByLabel('维护负责人', { exact:true }).selectOption('84');
      assert.equal(await page.getByLabel('权威系统名称', { exact:true }).inputValue(), '名单失败保留输入');
      await page.locator('[data-field-identity-form]').screenshot({path:path.join(output,'responsibility-form.png')}); await discard();
      checks.push('history read faults clear stale results and preserve active input; responsibility options failure blocks save and explicit retry preserves input');
      let releaseHistory, enteredHistory;
      const historyHold = new Promise(resolve => { releaseHistory = resolve; }), historyArrived = new Promise(resolve => { enteredHistory = resolve; });
      await page.route('**/api/field-identities/field/921/history', async route => { const response = await route.fetch(); enteredHistory(); await historyHold; await route.fulfill({response}).catch(() => {}); }, {times:1});
      await button('查阅维护与确认记录').click(); await historyArrived; await choose('923'); releaseHistory();
      await button('查阅维护与确认记录').click(); await page.locator('[data-field-identity-history]').waitFor();
      const pageOne = await page.locator('[data-field-identity-history] summary').allTextContents(); assert.equal(pageOne.length,20);
      await button('查看更早记录').click(); await page.locator(`[data-field-identity-history="${firstPage.next_cursor}"]`).waitFor();
      assert.ok((await page.locator('[data-field-identity-history] summary').count()) < 20);
      assert.doesNotMatch(await page.locator('[data-field-identity-history]').innerText(), /部门确认字段身份/);
      await page.reload(); await ready(); await identityReady(); assert.equal(await target().inputValue(),'923');
      assert.equal(await page.locator('[data-field-identity-history]').count(),0);
      checks.push('missing real audit table returns 503 and rolls back writes; delayed history cannot cross fields; history UI pagination/reload preserve target without stale history');
      assert.deepEqual((await pool.query('SELECT * FROM data_map_fields ORDER BY id'))[0], originalFields);
      assert.deepEqual((await pool.query('SELECT * FROM data_map_contexts ORDER BY id'))[0], originalContexts);
      assert.deepEqual((await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=922'))[0], otherIdentity);
      assert.deepEqual((await pool.query('SELECT * FROM data_map_field_identities WHERE field_id=924'))[0], unresolvedIdentity);
      assert.deepEqual(errors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x)); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, unexpectedConsole, writes: writes(), viewport: { width: 1699, height: 828 }, unchanged: ['contexts','fields','other-department identity'] }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, stack: error.stack, errors, text: await page.locator('body').innerText() }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {}); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
