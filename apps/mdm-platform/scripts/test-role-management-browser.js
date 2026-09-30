// P21 role detail: synthetic identities, owned MySQL/HTTP/Edge only.
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
    assert.equal((await fetch(fixture.baseURL + '/app/roles')).status, 200);
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], pageErrors = [], consoleErrors = [], writeRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', r => { if (/\/api\/(roles|rbac)/.test(r.url()) && r.method() !== 'GET') writeRequests.push(r.method()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const ready = () => page.locator('[data-role-ready="true"]').waitFor();
    const refresh = () => button('刷新角色资料').click();
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor();
    }
    async function layout() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      const roles = await expect('admin', '/api/roles', 'GET');
      const admin = roles.find(r => r.role_code === 'admin');
      const lead = roles.find(r => r.role_code === 'mdm_lead');
      await pool.execute("INSERT INTO roles(role_code,role_name,description,status,parent_role_id) VALUES('SYNTHETIC_HISTORY','历史角色合成记录','长中文说明仅用于隔离兼容验证','legacy',?)", [admin.role_id]);
      const [legacyRows] = await pool.execute("SELECT role_id FROM roles WHERE role_code='SYNTHETIC_HISTORY'");
      const historicalId = legacyRows[0].role_id;
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from,assignment_status) VALUES(81,?,'department',91,'synthetic historical record',CURRENT_DATE,'revoked')", [historicalId]);
      const [before] = await pool.query('SELECT * FROM person_roles ORDER BY person_role_id');
      await page.goto(fixture.baseURL + '/app/roles?role_id=' + admin.role_id); await login('admin'); await ready();
      const detail = await expect('admin', '/api/roles/' + admin.role_id, 'GET');
      const model = await expect('admin', '/api/rbac/model', 'GET');
      assert.ok((await page.locator('[data-role-ready]').textContent()).includes(detail.role_name));
      assert.ok((await page.locator('.role-management').textContent()).includes(model.modelVersion));
      assert.equal(await page.getByLabel('选择角色').locator('option').count(), roles.length + 1);
      const table = name => page.locator('section').filter({ has: page.getByRole('heading', { name, exact: true }) });
      assert.equal(await table('角色权限详情').locator('tbody tr').count(), detail.permissions.length);
      assert.equal(await table('人员授权记录').locator('tbody tr').count(), detail.users.length);
      await page.getByLabel('选择角色').selectOption(String(historicalId)); await ready();
      assert.ok((await page.locator('[data-role-ready]').textContent()).includes('历史继承记录'));
      assert.ok((await table('人员授权记录').textContent()).includes('已撤销'));
      await page.reload(); await ready(); assert.equal(await page.getByLabel('选择角色').inputValue(), String(historicalId));
      await page.getByLabel('选择角色').selectOption(String(lead.role_id)); await ready();
      await page.goBack(); await ready(); assert.equal(await page.getByLabel('选择角色').inputValue(), String(historicalId));
      await page.goForward(); await ready(); assert.equal(await page.getByLabel('选择角色').inputValue(), String(lead.role_id));
      await page.getByRole('link', { name: '原账号管理与访问审计' }).click(); await page.waitForURL('**/#/rbac');
      await page.locator('#rbacPanel').getByRole('button', { name: '手工创建账号', exact: true }).waitFor();
      await page.locator('.rbac-nav-item[data-panel="visibleTabs"]').click();
      await page.locator('#visibleTabRoleSelect').waitFor();
      assert.equal(await page.locator('#visibleTabRoleSelect option').count(), model.roles.length);
      await page.goBack(); await ready();
      checks.push('real model/list/detail/matrix, historical inheritance and revoked assignments; old entry; reload/back/forward');
      for (const status of [403, 409, 503]) {
        await page.route('**/api/roles/' + lead.role_id + '/permissions', route => route.fulfill({ status, json: {} }), { times: 1 });
        await refresh(); await page.getByText('角色详情暂不可用', { exact: true }).waitFor();
        assert.equal(await page.locator('[data-role-ready]').count(), 0);
        assert.equal(await page.getByLabel('选择角色').inputValue(), String(lead.role_id));
        await refresh(); await ready();
      }
      await context.setOffline(true); await refresh(); await page.getByText('角色资料暂不可用', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-role-ready]').count(), 0);
      await context.setOffline(false); await refresh(); await ready();
      await page.route('**/api/roles', route => route.fulfill({ json: [] }), { times: 1 });
      await refresh(); await page.getByText('暂无可读取角色', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-role-ready]').count(), 0);
      await refresh(); await ready();
      let release, entered;
      const held = new Promise(resolve => { release = resolve; });
      const arrived = new Promise(resolve => { entered = resolve; });
      await page.route('**/api/roles/' + admin.role_id, async route => { entered(); await held; await route.fulfill({ json: { ...detail, role_name: 'STALE_DETAIL_FORBIDDEN' } }).catch(() => {}); }, { times: 1 });
      await page.getByLabel('选择角色').selectOption(String(admin.role_id)); await arrived;
      await page.getByLabel('选择角色').selectOption(String(lead.role_id)); await ready(); release();
      await page.waitForTimeout(150); assert.ok(!(await page.locator('.role-management').textContent()).includes('STALE_DETAIL_FORBIDDEN'));
      checks.push('403/409/503 and offline injection clear stale data, preserve selected role; late detail cannot replace latest selection');
      await page.getByLabel('选择角色').selectOption(String(admin.role_id)); await ready();
      await page.getByLabel('选择角色').focus(); assert.equal(await page.getByLabel('选择角色').evaluate(el => el === document.activeElement), true);
      await layout(); await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.screenshot({ path: path.join(output, 'desktop-viewport.png') });
      await layout();
      await page.setViewportSize({ width: 1699, height: 828 });
      await page.goto(fixture.baseURL + '/app/roles?role_id=999999'); await page.getByText('角色详情暂不可用', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-role-ready]').count(), 0);
      await page.getByLabel('选择角色').selectOption(String(admin.role_id)); await ready();
      checks.push('desktop no page overflow, keyboard focus, explicit unknown-role feedback');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=181');
      await refresh(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('contact'); await page.getByText('角色资料暂不可用', { exact: true }).waitFor();
      assert.equal(await page.locator('[data-role-ready]').count(), 0);
      assert.equal((await request('contact', '/api/roles')).status, 403);
      assert.equal((await request('contact', '/api/roles/' + admin.role_id)).status, 403);
      assert.equal((await request('contact', '/api/roles/' + admin.role_id + '/permissions')).status, 403);
      await button('退出登录').click(); await login('adminMulti'); await ready();
      for (const [url, method] of [['/api/roles', 'POST'], ['/api/roles/' + admin.role_id, 'PUT'], ['/api/roles/' + admin.role_id, 'DELETE'], ['/api/roles/' + admin.role_id + '/permissions', 'PUT'], ['/api/rbac/model', 'PUT']]) {
        const result = await request('adminMulti', url, method, {}); assert.equal(result.status, 405); assert.equal(result.body.code, 'CORE_GOVERNANCE_MODEL_READ_ONLY');
      }
      const [after] = await pool.query('SELECT * FROM person_roles ORDER BY person_role_id');
      assert.deepEqual(after, before); assert.deepEqual(writeRequests, []);
      assert.deepEqual(pageErrors, []);
      const unexpectedConsole = consoleErrors.filter(m => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(m));
      assert.deepEqual(unexpectedConsole, []);
      checks.push('real session revocation, cross-identity data clearing, backend read denial and admin multi-role write rejection; assignments unchanged');
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ checks, pageErrors, unexpectedConsole, expectedConsoleCount: consoleErrors.length, writeRequests }, null, 2));
    } catch (error) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, pageErrors }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {}); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output, previewOnly: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
