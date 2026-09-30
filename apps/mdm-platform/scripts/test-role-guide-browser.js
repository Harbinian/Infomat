// P21 fixed role guide: owned synthetic MySQL, HTTP and Edge only.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function playwright() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const arg = process.argv.indexOf('--output');
assert.ok(arg >= 0 && process.argv[arg + 1]);
const output = path.resolve(process.argv[arg + 1]);
assert.ok(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output, { recursive: true });

async function main() {
  await withStage05Fixture(async ({ fixture, expect, pool }) => {
    assert.equal((await fetch(fixture.baseURL + '/app/role-guide')).status, 200);
    const model = await expect('contact', '/api/rbac/model', 'GET');
    const workbench = await expect('contact', '/api/role-workbench?mode=todo', 'GET');
    const browser = await playwright().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], pageErrors = [], consoleErrors = [], modelRequests = [], workbenchRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('request', request => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === '/api/rbac/model') modelRequests.push(request.method());
      if (pathname === '/api/role-workbench') workbenchRequests.push(request.method());
    });
    const ready = () => page.locator('[data-role-guide-state="ready"]').waitFor();
    const button = name => page.getByRole('button', { name, exact: true });
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor(); await ready();
    }
    try {
      await page.goto(fixture.baseURL + '/app/role-guide'); await login('contact');
      assert.equal(await page.getByLabel('查看角色').locator('option').count(), model.roles.length);
      assert.equal(await page.getByRole('row').count(), model.activities.length + 1);
      await page.getByText('当前账号角色：部门主对接人。').waitFor();
      await page.getByText(/当前身份未获 identity:manage-account/).waitFor();
      const contactRole = model.roles.find(role => role.code === 'department_contact');
      assert.ok(contactRole);
      const contactCard = page.locator('[data-role-guide-code="department_contact"]');
      await contactCard.locator('dt:text-is("可见功能标签") + dd').getByText(contactRole.visibleTabs[0].name, { exact: false }).waitFor();
      await contactCard.locator('dt:text-is("角色 RACI 责任") + dd').getByText(contactRole.raciResponsibilities[0].name, { exact: false }).waitFor();
      const expectedTodos = workbench.workItems.filter(item => item.type !== 'guidance' &&
        (item.roleCode === contactRole.code || item.role_code === contactRole.code || (item.sourceRoles || []).includes(contactRole.code))).length;
      await page.locator('dt:text-is("当前待办") + dd').getByText(`${expectedTodos} 项`, { exact: false }).waitFor();
      const permissionDescription = model.permissions.find(item => item.code === contactRole.permissions[0])?.description;
      assert.ok(permissionDescription);
      await contactCard.locator('dt:text-is("允许动作") + dd').getByText(permissionDescription, { exact: false }).waitFor();
      await page.getByRole('link', { name: contactRole.firstEntry.label }).click();
      await page.waitForFunction(expected => location.hash === expected, contactRole.firstEntry.target);
      await page.goBack(); await ready();
      assert.equal(await page.getByRole('button', { name: /保存|授予|发布/ }).count(), 0);
      const selection = page.getByLabel('查看角色');
      await selection.selectOption('mdm_lead');
      await page.locator('[data-role-guide-code="mdm_lead"]').waitFor();
      assert.match(page.url(), /role=mdm_lead/);
      await page.reload(); await ready();
      assert.equal(await selection.inputValue(), 'mdm_lead');
      await selection.selectOption('admin'); await page.goBack(); await ready();
      assert.equal(await selection.inputValue(), 'mdm_lead');
      await page.getByRole('link', { name: '查看原角色与责任入口' }).click();
      await page.waitForURL('**/#/roleGuide');
      await page.locator('#roleGuideRaci table tbody tr').first().waitFor();
      assert.equal(await page.locator('#roleGuideRaci table tbody tr').count(), model.activities.length);
      await page.goBack(); await ready();
      checks.push('real fixed model, effective identity, role actions/tabs/RACI/todos, first entry, role switch, old active guide, refresh/back');
      await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.equal(await page.evaluate(() => visualViewport.scale), 1);
      await page.route('**/api/role-workbench?mode=todo', route => route.fulfill({ status: 503, json: { error: '合成故障' } }), { times: 1 });
      await button('刷新角色说明').click(); await ready();
      await page.getByText('暂不可用，请到我的工作台核对').waitFor();
      assert.equal(await page.locator('dt:text-is("当前待办") + dd').getByText('0 项').count(), 0);
      await button('刷新角色说明').click(); await ready();
      await page.locator('dt:text-is("当前待办") + dd').getByText(`${expectedTodos} 项`, { exact: false }).waitFor();
      for (const status of [403, 409, 503]) {
        await page.route('**/api/rbac/model', route => route.fulfill({ status, json: { error: '合成故障' } }), { times: 1 });
        await button('刷新角色说明').click(); await page.locator('[data-role-guide-state="error"]').waitFor();
        assert.equal(await page.locator('[data-role-guide-code]').count(), 0);
        await button('重试').click(); await ready();
      }
      await context.setOffline(true); await button('刷新角色说明').click(); await page.locator('[data-role-guide-state="error"]').waitFor();
      await context.setOffline(false); await button('重试').click(); await ready();
      let release, entered;
      const blocked = new Promise(resolve => { release = resolve; });
      const arrived = new Promise(resolve => { entered = resolve; });
      await page.route('**/api/rbac/model', async route => {
        entered(); await blocked;
        await route.fulfill({ json: { roles: [], activities: [], permissions: [] } }).catch(() => {});
      }, { times: 1 });
      await button('刷新角色说明').click(); await arrived;
      await button('刷新角色说明').click(); await ready(); release();
      await page.waitForTimeout(100);
      assert.equal(await page.getByLabel('查看角色').locator('option').count(), model.roles.length);
      checks.push('injected model/workbench errors, offline and stale response preserve only current model; unavailable todos never shown as zero');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button('刷新角色说明').click();
      await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('admin');
      await page.getByText('当前账号角色：MDM系统管理员。').waitFor();
      assert.equal(await page.getByText(/当前身份未获 identity:manage-account/).count(), 0);
      assert.deepEqual(modelRequests.every(method => method === 'GET'), true);
      assert.deepEqual(workbenchRequests.every(method => method === 'GET'), true);
      assert.deepEqual(pageErrors, []);
      const unexpectedConsole = consoleErrors.filter(text => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(text));
      assert.deepEqual(unexpectedConsole, []);
      checks.push('real revocation and identity switch; model requests read-only; desktop no overflow');
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, unexpectedConsole, modelRequests, workbenchRequests }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, body: await page.locator('body').innerText(), pageErrors }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output, previewOnly: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
