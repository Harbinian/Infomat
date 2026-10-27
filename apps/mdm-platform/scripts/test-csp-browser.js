// Current single-entry frontend and password gate in Edge at the supported desktop geometry.
// Uses synthetic API responses; does not connect to any database or change real passwords.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const serverAt = process.argv.indexOf('--server-root');
const serverRoot = serverAt > 0 ? path.resolve(process.argv[serverAt + 1]) : path.resolve(__dirname, '../server');
const { frontendRouter, publicEntryRouter } = require(path.join(serverRoot, 'frontend'));
const { securityHeaders } = require(path.join(serverRoot, 'security'));

const at = process.argv.indexOf('--output');
assert(at > 0 && process.argv[at + 1], '--output is required');
const output = path.resolve(process.argv[at + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
function runtime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
async function main() {
  const distAt = process.argv.indexOf('--dist');
  const app = express(); app.use(securityHeaders);
  app.get('/app/assets/test-security-probe.js', (req, res) => res.type('js').send("window.evalProbe=false;window.evalBlocked=false;try{window.eval('window.evalProbe=true')}catch{window.evalBlocked=true}window.blobWorkerBlocked=false;const url=URL.createObjectURL(new Blob(['self.close()'],{type:'application/javascript'}));try{const worker=new Worker(url);worker.onerror=event=>{event.preventDefault();window.blobWorkerBlocked=true;worker.terminate();URL.revokeObjectURL(url);}}catch{window.blobWorkerBlocked=true;URL.revokeObjectURL(url)}window.securityProbeComplete=true;"));
  app.use('/app', frontendRouter(distAt > 0 ? path.resolve(process.argv[distAt + 1]) : undefined)); app.use(publicEntryRouter());
  app.use((req, res) => res.sendStatus(404));
  const server = await new Promise(resolve => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browserServer = await runtime().chromium.launchServer({ channel: 'msedge', headless: true });
  fs.writeFileSync(path.join(output, 'browser-owner.json'), JSON.stringify({ runnerPid: process.pid, browserPid: browserServer.process().pid, owned: true }));
  const browser = await runtime().chromium.connect(browserServer.wsEndpoint());
  const checks = [], errors = [], violations = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000); page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => { window.cspViolations = []; document.addEventListener('securitypolicyviolation', event => window.cspViolations.push(event.violatedDirective)); });
    let required = true, authenticated = true, fail = true, writes = 0;
    const calls = [];
    const user = { personId: 987, employeeNo: 'SYNTHETIC_SINGLE_ENTRY', personName: '合成验证身份', departmentId: 988, departmentName: '合成部门', permissions: [], rbacRoles: [], accountStatus: 'active' };
    await page.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()), endpoint = url.pathname;
      calls.push(endpoint);
      let status = 200, json = {};
      if (endpoint === '/api/csrf-token') json = { csrfToken: 'synthetic-csrf' };
      else if (endpoint === '/api/org/session') json = { authenticated, csrfToken: 'synthetic-csrf' };
      else if (endpoint === '/api/org/me') json = user;
      else if (endpoint === '/api/org/me/password-status') json = { is_default_password: required };
      else if (endpoint === '/api/org/login') { authenticated = true; json = { success: true }; }
      else if (endpoint === '/api/org/me/password') {
        writes += 1;
        assert.equal(request.headers()['x-csrf-token'], 'synthetic-csrf');
        assert.deepEqual(Object.keys(request.postDataJSON()).sort(), ['current_password', 'new_password']);
        status = fail ? 403 : 200; json = fail ? { error: 'synthetic rejected' } : { success: true }; authenticated = fail;
      } else if (endpoint === '/api/rbac/model') json = { roles: [], permissions: [], activities: [] };
      else json = { workItems: [], roles: [], summary: {}, availability: {} };
      return route.fulfill({ status, json });
    });
    const response = await page.goto(base + '/');
    assert.equal(new URL(page.url()).pathname, '/app/');
    assert.match(response.headers()['content-security-policy'], /script-src 'self' 'wasm-unsafe-eval'; worker-src 'self';/);
    await page.getByRole('heading', { name: '请先修改当前账号密码' }).waitFor();
    assert.deepEqual([...new Set(calls)].sort(), ['/api/org/me', '/api/org/me/password-status', '/api/org/session'].sort());
    assert.equal(await page.locator('a[href*="/#/"], a.legacy-link').count(), 0);
    checks.push('root redirects to current frontend; password gate precedes business reads');
    console.log('PASSWORD_GATE_PASS');
    const button = () => page.getByRole('button', { name: '修改密码并重新登录', exact: true });
    await button().click(); assert.equal(writes, 0);
    assert.equal(await page.locator('#change-password-current').evaluate(node => node === document.activeElement), true);
    await page.locator('#change-password-current').fill('synthetic-old-123');
    await page.locator('#change-password-next').fill('synthetic-new-456');
    await page.locator('#change-password-repeat').fill('different');
    await button().click(); assert.equal(writes, 0);
    await page.locator('#change-password-repeat').fill('synthetic-new-456');
    await button().click(); await page.getByRole('alert').waitFor(); assert.equal(writes, 1);
    assert.equal(await page.locator('#change-password-current').inputValue(), 'synthetic-old-123');
    assert.equal(await page.locator('#change-password-next').inputValue(), 'synthetic-new-456');
    await page.screenshot({ path: path.join(output, 'password-gate.png'), mask: [page.locator('input[type=password]')] });
    fail = false; await button().click(); await page.getByRole('heading', { name: '请重新登录' }).waitFor();
    assert.equal(writes, 2); assert.equal(await page.locator('#login-password').inputValue(), '');
    await page.getByText('密码已修改，请使用新密码重新登录。', { exact: true }).waitFor();
    checks.push('required fields, mismatch, CSRF contract, rejected input preservation and successful re-login');
    console.log('PASSWORD_SUBMIT_PASS');
    required = false; await page.goto(base + '/app/password');
    await page.locator('#login-name').fill('SYNTHETIC_SINGLE_ENTRY'); await page.locator('#login-password').fill('synthetic-new-456');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.locator('#password-required-title').waitFor();
    await page.locator('#change-password-current').fill('synthetic-new-456');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('nav a[href="/app/identity"]').click();
    assert.equal(new URL(page.url()).pathname, '/app/password');
    assert.equal(await page.locator('#change-password-current').inputValue(), 'synthetic-new-456');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('nav a[href="/app/identity"]').click(); await page.getByRole('heading', { name: '当前账号与归属' }).waitFor();
    await page.getByRole('link', { name: '修改本人密码', exact: true }).click();
    assert.equal(await page.locator('#change-password-current').inputValue(), '');
    assert.equal(await page.locator('a[href*="/#/"], a.legacy-link').count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await page.evaluate(() => visualViewport.scale), 1);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    violations.push(...await page.evaluate(() => window.cspViolations)); assert.deepEqual(violations, []); assert.deepEqual(errors, []);
    checks.push('current navigation, password input leave confirmation, no persistent storage, desktop layout and normal CSP');
    await page.evaluate(() => { window.inlineProbe = false; const script = document.createElement('script'); script.textContent = 'window.inlineProbe=true'; document.body.append(script); });
    assert.equal(await page.evaluate(() => window.inlineProbe), false);
    assert.ok((await page.evaluate(() => window.cspViolations)).includes('script-src-elem'));
    checks.push('unapproved inline script is blocked');
    await page.evaluate(() => { const script=document.createElement('script');script.src='/app/assets/test-security-probe.js';document.head.appendChild(script); });
    await page.waitForFunction(() => window.securityProbeComplete);
    assert.equal(await page.evaluate(() => window.evalProbe), false);
    assert.equal(await page.evaluate(() => window.evalBlocked), true);
    await page.waitForFunction(() => window.blobWorkerBlocked);
    assert.equal(await page.evaluate(() => window.blobWorkerBlocked), true);
    assert((await page.evaluate(() => window.cspViolations)).includes('worker-src'));
    checks.push('same-origin external probe confirms JS eval and blob Worker are blocked while WASM permission remains separate');
    for (const endpoint of ['/index.html', '/mdm-protocol.js']) assert.equal((await context.request.get(base + endpoint)).status(), 410);
    await page.screenshot({ path: path.join(output, 'desktop.png') });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, viewport: { width: 1699, height: 828 }, databaseConnected: false, realPasswordsChanged: false }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
  } catch (error) {
    fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, errors }, null, 2));
    console.error(error.message); throw error;
  } finally {
    const timer = setTimeout(() => {
      const browserPid = browserServer.process().pid;
      if (process.platform === 'win32') {
        const command = `$ownedBrowser = Get-CimInstance Win32_Process -Filter 'ProcessId=${browserPid}'; if ($ownedBrowser -and $ownedBrowser.ParentProcessId -eq ${process.pid} -and $ownedBrowser.Name -eq 'msedge.exe' -and $ownedBrowser.CommandLine -like '*playwright_chromiumdev_profile-*') { $result = Invoke-CimMethod -InputObject $ownedBrowser -MethodName Terminate; if ($result.ReturnValue -ne 0) { exit 1 } }`;
        try { require('node:child_process').execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000, stdio: 'ignore' }); } catch {}
      }
      browserServer.kill().catch(() => {});
    }, 10000);
    try { await browser.close(); await browserServer.close(); } finally { clearTimeout(timer); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
