// Synthetic HTTP/MySQL/Edge only; owns and cleans its fixture. Requires frontend build.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });
async function main() {
  await withStage05Fixture(async ({ fixture, pool, expect, request }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    const errors = [], consoleErrors = [], checks = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    const title = () => page.getByLabel('上下文标题', { exact: true });
    const submit = () => page.getByRole('button', { name: '创建数据地图上下文', exact: true });
    const ready = () => page.locator('[data-map-state="ready"]').waitFor();
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await page.getByRole('button', { name: '登录', exact: true }).click(); await ready(); }
    async function writeResponse(action) { const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/data-map/contexts' && r.request().method() === 'POST'); await action(); return response; }
    try {
      await page.goto(fixture.baseURL + '/app/data-map'); await login('contact');
      await title().fill('合成新增上下文');
      await page.getByLabel('来源文件', { exact: true }).fill('合成来源.xlsx');
      await page.getByLabel('来源位置', { exact: true }).fill('主数据清单 A15');
      for (const status of [403,409,503]) {
        await page.route('**/api/data-map/contexts', route => route.request().method() === 'POST' ? route.fulfill({ status, json: {} }) : route.continue(), { times: 1 });
        await writeResponse(() => submit().click());
        await page.locator('[data-context-create-error]').waitFor(); assert.equal(await title().inputValue(), '合成新增上下文');
      }
      await page.getByRole('button', { name: '刷新数据地图', exact: true }).click(); await ready(); assert.equal(await title().inputValue(), '合成新增上下文');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '数据质量', exact: true }).click(); assert.match(page.url(), /\/app\/data-map/);
      let reloadBlocked = false;
      page.once('dialog', async d => { assert.equal(d.type(), 'beforeunload'); reloadBlocked = true; await d.dismiss(); });
      await page.reload({ timeout: 1500 }).catch(e => { assert.equal(e.name, 'TimeoutError'); });
      assert.equal(reloadBlocked, true); await ready(); assert.equal(await title().inputValue(), '合成新增上下文');
      checks.push('injected 403/409/503, refresh, navigation and reload cancellation preserve visible input');
      for (const [width,height,name] of [[1699,828,'desktop'],[390,844,'mobile']]) {
        await page.setViewportSize({ width,height }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        assert.equal(await page.evaluate(() => visualViewport.scale),1); await page.screenshot({ path:path.join(output,name+'.png'),fullPage:true });
      }
      await page.setViewportSize({ width:1699,height:828 });
      await context.setOffline(true); await submit().click(); await page.locator('[data-context-create-error]').waitFor();
      assert.equal(await title().inputValue(),'合成新增上下文'); await context.setOffline(false);
      await title().focus(); await page.keyboard.press('Tab'); assert.equal(await page.getByLabel('来源文件',{exact:true}).evaluate(el=>el===document.activeElement),true);
      let release, arrived, posts=0;
      const blocked=new Promise(r=>{release=r;}), entered=new Promise(r=>{arrived=r;});
      await page.route('**/api/data-map/contexts',async route=>{
        if(route.request().method()!=='POST')return route.continue();
        posts++; arrived(); await blocked; return route.continue();
      });
      const createdResponse=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/data-map/contexts'&&r.request().method()==='POST');
      createdResponse.catch(() => {});
      await submit().click(); await entered;
      assert.equal(await title().isDisabled(),true);
      await page.locator('form').filter({has:title()}).evaluate(form=>{form.requestSubmit();form.requestSubmit();});
      release(); assert.equal((await createdResponse).status(),201); assert.equal(posts,1); await page.unroute('**/api/data-map/contexts');
      await page.getByText(/已创建上下文/).waitFor(); await ready(); assert.equal(await title().inputValue(),'');
      const created = (await expect('contact','/api/data-map/contexts','GET')).find(r=>r.title==='合成新增上下文');
      assert.ok(created); assert.equal(created.dept_id,91); assert.equal(created.source_anchor,'主数据清单 A15');
      assert.equal(await page.getByLabel('数据地图上下文',{exact:true}).inputValue(),String(created.id));
      await page.reload(); await ready(); assert.equal(await page.getByLabel('数据地图上下文',{exact:true}).inputValue(),String(created.id));
      const payload={title:'合成并发',dept_id:91,source_file:'same.xlsx'};
      const results=await Promise.all([request('contact','/api/data-map/contexts','POST',payload),request('contact','/api/data-map/contexts','POST',payload)]);
      assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
      for(const who of ['admin','adminMulti','outsider']) assert.equal((await request(who,'/api/data-map/contexts','POST',{title:'拒绝写入',dept_id:91})).status,403);
      assert.equal((await request('contact','/api/data-map/contexts','POST',{title:'越部门',dept_id:92})).status,403);
      checks.push('real create, source values, URL refresh, duplicate concurrency, admin and cross-department rejection');
      const snapshot=JSON.stringify((await pool.query('SELECT * FROM data_map_contexts ORDER BY id'))[0]);
      await title().fill('合成新增上下文'); await page.getByLabel('来源文件',{exact:true}).fill('合成来源.xlsx');
      assert.equal((await writeResponse(()=>submit().click())).status(),409); await page.locator('[data-context-create-error]').waitFor();
      assert.equal(await title().inputValue(),'合成新增上下文');
      await title().fill('会话失效保留');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await submit().click(); await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor(); await login('contact');
      assert.equal(await title().inputValue(),'会话失效保留');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await submit().click(); await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor(); await login('adminMulti');
      assert.equal(await title().count(),0); assert.equal(await submit().count(),0);
      assert.equal(JSON.stringify((await pool.query('SELECT * FROM data_map_contexts ORDER BY id'))[0]),snapshot);
      await page.getByRole('link',{name:'打开原数据地图入口',exact:true}).click(); await page.waitForURL('**/#/dataMap');
      await page.locator('#dataMapContextSelect').selectOption(String(created.id));
      assert.ok((await page.locator('#dataMapContextSelect').textContent()).includes('合成新增上下文'));
      checks.push('real session expiry, same identity draft restoration, different identity clears draft, legacy reads new row');
      const unexpectedConsole=consoleErrors.filter(x=>!/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x));
      assert.deepEqual(errors,[]); assert.deepEqual(unexpectedConsole,[]); fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks,errors,unexpectedConsole},null,2));
    } catch(e) { fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:e.message,text:await page.locator('body').innerText()},null,2)); await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}); throw e; }
    finally { await browser.close(); }
  },{evidenceDir:output});
}
main().catch(e=>{console.error(e);process.exitCode=1;});
