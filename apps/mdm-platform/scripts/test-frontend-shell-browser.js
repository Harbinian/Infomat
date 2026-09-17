// P01: real Edge and HTTP against the existing ownership-checked tmpfs MySQL
// fixture. Synthetic identities only. Explicit HTTP failures are browser-injected.
// Input: --output <new evidence directory>. No private env, production service,
// model call, browser download, shared DB or persistent application credentials.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');

function runtime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
const outputArg = process.argv.indexOf('--output');
assert.ok(outputArg >= 0 && process.argv[outputArg + 1], '--output is required');
const output = path.resolve(process.argv[outputArg + 1]);
const artifacts = path.resolve(__dirname, '../../../artifacts');
assert.ok(output.startsWith(artifacts + path.sep), 'evidence must be inside repository artifacts');
assert.ok(!fs.existsSync(output), 'use a new evidence directory; do not overwrite prior results');
fs.mkdirSync(output, { recursive: true });

async function main() {
  await withStage05Fixture(async ({ fixture, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const checks = [], pageErrors = [], consoleErrors = [], errorResponses = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    page.on('response', r => { if (r.status() >= 400) errorResponses.push({ status: r.status(), path: new URL(r.url()).pathname }); });
    const base = fixture.baseURL;
    const waitHeading = text => page.getByRole('heading', { name: text, exact: true }).waitFor();
    const assertInput = async () => {
      assert.equal(await page.locator('#login-name').inputValue(), 'SYNTHETIC_contact');
      assert.equal(await page.locator('#login-password').inputValue(), fixture.loginPassword);
    };
    async function fillLogin() {
      await page.locator('#login-name').fill('SYNTHETIC_contact');
      await page.locator('#login-password').fill(fixture.loginPassword);
    }
    async function submitLogin() {
      await fillLogin(); await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
    }
    async function noOverflow(label) {
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label);
      assert.equal(await page.evaluate(() => window.visualViewport.scale), 1, '100% zoom');
      checks.push(label);
    }
    try {
      await page.goto(base + '/app/identity');
      await waitHeading('登录 MDM 平台');
      await page.screenshot({ path: path.join(output, 'login-desktop.png') });
      await page.getByRole('button', { name: '登录', exact: true }).click();
      assert.equal(await page.locator('#login-name').getAttribute('aria-invalid'), 'true');
      assert.equal(await page.locator('#login-name').evaluate(el => el === document.activeElement), true);
      checks.push('anonymous deep link and required field focus');
      await fillLogin();
      const leaving = page.waitForEvent('dialog');
      const leaveClick = page.getByRole('link', { name: '使用原入口', exact: true }).click();
      await (await leaving).dismiss(); await leaveClick; await assertInput();
      const reloading = page.waitForEvent('dialog');
      const reload = page.reload().catch(() => {});
      await (await reloading).dismiss(); await reload; await assertInput();
      checks.push('cancelled navigation and reload preserve visible login input');

      for (const status of [403, 409, 503]) {
        await page.route('**/api/org/login', route => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ code: 'SYNTHETIC_FAILURE', error: 'must not expose internal diagnostics' }) }), { times: 1 });
        await page.getByRole('button', { name: '登录', exact: true }).click();
        await page.getByRole('alert').waitFor(); await assertInput();
        assert.ok(!(await page.getByRole('alert').innerText()).includes('diagnostics'));
        await page.screenshot({ path: path.join(output, `login-${status}.png`) });
        checks.push(`${status} feedback preserves inputs without replay`);
      }
      await page.route('**/api/org/login', route => route.abort('failed'), { times: 1 });
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('alert').waitFor(); await assertInput(); checks.push('network failure retains input');
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await waitHeading('当前身份');
      const me = await context.request.get(base + '/api/org/me');
      assert.equal(me.status(), 200); assert.equal((await me.json()).employeeNo, 'SYNTHETIC_contact');
      const cookies = await context.cookies();
      const cookie = cookies.find(c => c.name === 'infomat.mdm.sid');
      assert.ok(cookie && cookie.httpOnly && cookie.sameSite === 'Lax' && cookie.path === '/');
      // This fixture is deliberately HTTP loopback; production Secure rules remain tested separately.
      assert.equal((await context.request.post(base + '/api/org/logout', { data: {} })).status(), 403);
      checks.push('real login/me/MySQL session cookie and CSRF rejection');
      await noOverflow('desktop identity without horizontal overflow');
      await page.screenshot({ path: path.join(output, 'identity-desktop.png') });
      await page.reload(); await waitHeading('当前身份');
      await page.getByRole('link', { name: '我的工作台', exact: true }).click();
      await waitHeading('我的工作台');
      await page.screenshot({ path: path.join(output, 'workbench-desktop.png') });
      await page.goBack(); await waitHeading('当前身份');
      await page.goForward(); await waitHeading('我的工作台');
      checks.push('deep link refresh and browser back/forward');
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('390x844 workbench without horizontal overflow');
      await page.screenshot({ path: path.join(output, 'workbench-mobile.png') });
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await waitHeading('当前身份');
      await noOverflow('390x844 identity without horizontal overflow');
      await page.screenshot({ path: path.join(output, 'identity-mobile.png') });
      await page.setViewportSize({ width: 1699, height: 828 });
      await page.getByRole('link', { name: '我的工作台', exact: true }).click();
      await page.getByRole('link', { name: '查看我的待办 ↗', exact: true }).click();
      await page.locator('#appContent').waitFor({ state: 'visible' });
      assert.equal(new URL(page.url()).hash, '#/roleWorkbench');
      checks.push('old workbench opens with same authenticated session');
      await page.goBack(); await waitHeading('我的工作台');

      await page.route('**/api/org/logout', route => route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }), { times: 1 });
      await page.getByRole('button', { name: '退出登录' }).click(); await page.getByRole('alert').waitFor();
      assert.equal((await context.request.get(base + '/api/org/me')).status(), 200);
      await page.getByRole('button', { name: '重试', exact: true }).click(); await waitHeading('登录 MDM 平台');
      assert.equal((await context.request.get(base + '/api/org/me')).status(), 401);
      checks.push('failed logout remains authenticated; explicit retry logs out and invalidates API');
      await submitLogin();
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=83');
      await page.getByRole('button', { name: '刷新身份' }).click(); await waitHeading('请重新登录');
      assert.equal(await page.getByRole('button', { name: '退出登录' }).count(), 0);
      await submitLogin(); checks.push('real authorization revision expiration hides identity and reauthentication recovers');

      const realIdentity = await (await context.request.get(base + '/api/org/me')).json();
      await page.route('**/api/org/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...realIdentity, personName: '合成中文长姓名用于检查窄屏换行与页面边界', departmentName: '合成跨业务协同与主数据治理办公室长名称用于布局验证', rbacRoles: [] }) }), { times: 1 });
      await page.getByRole('link', { name: '当前身份', exact: true }).click();
      await page.getByRole('button', { name: '刷新身份' }).click();
      await page.getByText('暂无有效工作角色', { exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('long Chinese identity and empty roles without horizontal overflow');
      await page.screenshot({ path: path.join(output, 'identity-long-empty-mobile.png') });
      await page.getByRole('button', { name: '刷新身份' }).click();
      await page.getByText('部门主对接人', { exact: true }).waitFor();

      for (const url of ['/api/p01-not-found', '/app/assets/missing.js', '/app/uploads/no-file', '/app/src/main.jsx']) {
        const response = await context.request.get(base + url); assert.equal(response.status(), 404, url);
        assert.ok(!(await response.text()).includes('id="root"'));
      }
      assert.equal((await context.request.get(base + '/echarts.min.js')).status(), 200);
      checks.push('real API/asset/upload/source 404 boundaries and local ECharts');
      await page.getByRole('button', { name: '退出登录' }).click(); await waitHeading('登录 MDM 平台');
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow('390x844 login without horizontal overflow');
      await page.screenshot({ path: path.join(output, 'login-mobile.png') });

      // Run the real dev proxy only against this owned backend. No .env loading.
      const frontendRoot = path.resolve(__dirname, '../frontend');
      const { createServer } = await import(pathToFileURL(path.join(frontendRoot, 'node_modules/vite/dist/node/index.js')).href);
      const previousBackend = process.env.MDM_ISOLATED_BACKEND;
      let dev;
      try {
        process.env.MDM_ISOLATED_BACKEND = base;
        dev = await createServer({ root: frontendRoot, configFile: path.join(frontendRoot, 'vite.config.js'), logLevel: 'error' });
        await dev.listen();
        const devPort = dev.httpServer.address().port;
        assert.ok(![3000,3001,3306,3307,5173,63805].includes(devPort));
        const devBase = 'http://127.0.0.1:' + devPort;
        await page.goto(devBase + '/app/identity'); await waitHeading('登录 MDM 平台');
        await submitLogin(); await waitHeading('当前身份');
        assert.equal((await context.request.get(devBase + '/api/org/me')).status(), 200);
        const cors = await context.request.get(devBase + '/api/org/me', { headers: { Origin: 'https://external.invalid' } });
        assert.equal(cors.headers()['access-control-allow-origin'], undefined);
        await page.getByRole('button', { name: '退出登录' }).click(); await waitHeading('登录 MDM 平台');
        checks.push('actual Vite random-port proxy login/me/logout with no broad CORS');
      } finally {
        if (dev) await dev.close();
        if (previousBackend === undefined) delete process.env.MDM_ISOLATED_BACKEND;
        else process.env.MDM_ISOLATED_BACKEND = previousBackend;
      }
      assert.deepEqual(pageErrors, []);
      // Failed requests above intentionally produce Chromium resource error messages.
      const unexpectedConsole = consoleErrors.filter(message => !/Failed to load resource: net::ERR_FAILED|Failed to load resource: the server responded with a status of (401|403|409|503)/.test(message));
      assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'browser-results.json'), JSON.stringify({ passed: true, checks, pageErrors, unexpectedConsole, expectedResourceErrors: consoleErrors, errorResponses, dependency: 'real Edge / owned tmpfs MySQL / real HTTP; browser-injected failures explicitly listed; no human acceptance', viewport: [1699,828,390,844] }, null, 2));
      console.log('P01_EDGE_MYSQL_PASS ' + checks.length);
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, checks, pageErrors, consoleErrors, errorResponses }, null, 2));
      throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output, previewOnly: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
