// Candidate-only Edge evidence: synthetic HTTP API, no database or production listener.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { frontendRouter, publicEntryRouter } = require('../server/frontend');
const { securityHeaders } = require('../server/security');
const { pages } = require('../shared/browserProtocol');
const arg = name => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : null; };
const output = path.resolve(arg('--output') || '');
const dist = path.resolve(arg('--dist') || '');
const artifacts = path.resolve(__dirname, '../../../artifacts');
assert(arg('--output') && arg('--dist') && output.startsWith(artifacts + path.sep) && dist.startsWith(artifacts + path.sep));
assert(!fs.existsSync(output), 'Evidence directory must be new'); fs.mkdirSync(output, { recursive: true });
const runtime = () => { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } };
const luminance = color => { const values=color.match(/[\d.]+/g).slice(0,3).map(Number).map(value=>{value/=255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});return values[0]*.2126+values[1]*.7152+values[2]*.0722; };
const contrast = (a,b) => { const values=[luminance(a),luminance(b)].sort((x,y)=>y-x);return (values[0]+.05)/(values[1]+.05); };
async function main() {
  const app = express(); app.use(securityHeaders); app.use('/app', frontendRouter(dist)); app.use(publicEntryRouter()); app.use((req, res) => res.sendStatus(404));
  const server = await new Promise(resolve => { const handle = app.listen(0, '127.0.0.1', () => resolve(handle)); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const browserServer = await runtime().chromium.launchServer({ channel: 'msedge', headless: true });
  const browser = await runtime().chromium.connect(browserServer.wsEndpoint());
  fs.writeFileSync(path.join(output, 'ownership.json'), JSON.stringify({ runnerPid: process.pid, browserPid: browserServer.process().pid, host: '127.0.0.1', port: server.address().port, dist, databaseConnected: false }));
  const checks = [], errors = [], requests = [], failures = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    page.on('pageerror', error => errors.push(error.message));
    context.on('request', request => requests.push({ url: request.url(), method: request.method() }));
    page.on('requestfailed', request => failures.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.addInitScript(() => { window.presentationCspViolations = []; document.addEventListener('securitypolicyviolation', event => window.presentationCspViolations.push(event.violatedDirective)); });
    let sessionDelay = 5000, authenticated = false, loginStatus = 401;
    const user = { personId: 987, personName: '合成验证人员', departmentId: 988, departmentName: '合成部门', permissions: [], rbacRoles: [], identityKind: 'person' };
    await page.route('**/api/**', async route => {
      const endpoint = new URL(route.request().url()).pathname;
      let json = {}, status = 200;
      if (endpoint === '/api/org/session') { await new Promise(resolve => setTimeout(resolve, sessionDelay)); json = { authenticated, csrfToken: 'synthetic-token' }; }
      else if (endpoint === '/api/csrf-token') json = { csrfToken: 'synthetic-token' };
      else if (endpoint === '/api/org/me') json = user;
      else if (endpoint === '/api/org/me/password-status') json = { is_default_password: false };
      else if (endpoint === '/api/org/login') { status = loginStatus; authenticated = status === 200; json = status === 200 ? { success: true } : { error: 'synthetic denied' }; }
      else if (endpoint === '/api/org/logout') { authenticated = false; json = { success: true }; }
      else { status = 403; json = { error: '合成验证：此身份无权访问', code: 'FORBIDDEN' }; }
      try { await route.fulfill({ status, json }); } catch {}
    });
    await page.goto(base + '/app/identity');
    await page.locator('.status-lottie').waitFor();
    await page.waitForTimeout(1600);
    await page.getByRole('heading', { name: '登录 MDM 平台' }).waitFor();
    const actualColors = await page.locator('#login-name').evaluate(node => {const s=getComputedStyle(node);return {text:s.color,background:s.backgroundColor,border:s.borderTopColor};});
    assert(contrast(actualColors.text,actualColors.background)>=4.5);assert(contrast(actualColors.border,actualColors.background)>=3);
    await page.getByRole('button',{name:'登录',exact:true}).hover();await page.waitForTimeout(180);
    const buttonColors=await page.getByRole('button',{name:'登录',exact:true}).evaluate(node=>{const s=getComputedStyle(node);return {text:s.color,background:s.backgroundColor};});
    assert(contrast(buttonColors.text,buttonColors.background)>=4.5);
    fs.writeFileSync(path.join(output,'control-contrast.json'),JSON.stringify({input:actualColors,inputText:contrast(actualColors.text,actualColors.background),inputBorder:contrast(actualColors.border,actualColors.background),hoveredPrimary:buttonColors,hoveredPrimaryText:contrast(buttonColors.text,buttonColors.background)},null,2));
    await page.screenshot({path:path.join(output,'login-desktop.png')});
    await page.locator('#login-name').fill('SYNTHETIC_UI'); await page.locator('#login-password').fill('synthetic-password');
    await page.getByRole('button', { name: '登录', exact: true }).click();
    await page.getByRole('alert').waitFor(); await page.locator('.status-lottie').waitFor(); await page.waitForTimeout(1600);
    await page.screenshot({ path: path.join(output, 'login-feedback.png'), mask: [page.locator('input[type=password]')] });
    await page.getByText('显示诊断', { exact: true }).click(); await page.getByRole('button', { name: '更新诊断' }).click();
    const snapshot = JSON.parse(await page.locator('.presentation-diagnostics pre').textContent());
    assert(snapshot.events.some(event => event.reason === 'lottie-loading' && event.type === 'ready'), 'loading Worker must actually load');
    assert(snapshot.events.some(event => event.reason === 'lottie-error' && event.type === 'ready'), 'result Worker must actually load');
    assert(!snapshot.events.some(event => event.type === 'fallback'), JSON.stringify(snapshot.events));
    const resourceRequests = requests.filter(request => /dotlottie.*\.(?:js|wasm)|(?:loading|error)-.*\.json/.test(request.url));
    assert(resourceRequests.some(request => request.url.endsWith('.wasm')));
    assert(resourceRequests.every(request => request.url.startsWith(base + '/app/assets/')));
    for (const resource of resourceRequests) { const response = await context.request.get(resource.url); assert.equal(response.status(), 200); if (resource.url.endsWith('.wasm')) { assert.match(response.headers()['content-type'], /application\/wasm/); assert.deepEqual([...new Uint8Array(await response.body()).slice(0, 4)], [0, 97, 115, 109]); } }
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
    await page.getByText('显示诊断', { exact: true }).click();
    await page.getByRole('combobox', { name: '显示效果' }).selectOption('reduced'); await page.waitForTimeout(500);
    assert.equal(await page.locator('.status-lottie').count(), 0); assert.equal(await page.locator('#login-password').inputValue(), 'synthetic-password');
    checks.push('real loading and denied-result Worker/WASM rendering; same-origin MIME; reduced mode preserves input');
    await page.emulateMedia({ reducedMotion: 'reduce' }); await page.getByRole('combobox', { name: '显示效果' }).selectOption('enhanced');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.presentation), 'reduced');
    checks.push('system reduced motion overrides enhanced mode');
    if (!process.argv.includes('--pilot')) {
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.getByRole('combobox', { name: '显示效果' }).selectOption('auto');
      loginStatus = 200; sessionDelay = 0;
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('button', { name: '退出登录', exact: true }).waitFor();
      const coverage = [];
      for (const entry of pages) {
        const query = entry.href === '/app/identity' ? '?retained=synthetic' : '';
        await page.goto(base + entry.href + query);
        await page.locator('.page-heading h1').waitFor(); await page.waitForTimeout(350);
        assert.equal(await page.locator('.page-heading h1').textContent(), entry.title);
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, entry.href);
        assert.equal(await page.evaluate(() => document.activeElement === document.querySelector('.page-heading h1')), true, entry.href);
        const state = await page.evaluate(() => ({ alerts: document.querySelectorAll('[role=alert]').length, statuses: document.querySelectorAll('[role=status]').length, buttons: document.querySelectorAll('#main button').length, disabled: document.querySelectorAll('#main button:disabled').length, fields: document.querySelectorAll('#main input,#main textarea,#main select').length, title: getComputedStyle(document.querySelector('.page-heading h1')).color, background: getComputedStyle(document.body).backgroundColor }));
        coverage.push({ ...entry, ...state, screenshot: entry.href.replace(/\W/g, '_') + '.png', evidence: 'synthetic restricted identity; native page and UI error/disabled states' });
        await page.screenshot({ path: path.join(output, coverage.at(-1).screenshot) });
      }
      fs.writeFileSync(path.join(output, 'route-coverage.json'), JSON.stringify(coverage, null, 2));
      checks.push('every current protocol entry: real React page, focus, desktop overflow, restricted/error/disabled state and screenshot');
      await page.goto(base + '/app/identity'); await page.locator('.page-heading h1').waitFor();
      const activeWorkers = new Set(); page.on('worker', worker => { activeWorkers.add(worker); worker.on('close', () => activeWorkers.delete(worker)); });
      for (let index = 0; index < 20; index++) {
        await page.locator('nav a[href="/app/workbench"]').click(); await page.locator('[data-scene-host][data-ready=true]').waitFor();
        await page.locator('nav a[href="/app/identity"]').click(); await page.locator('.page-heading h1').waitFor();
        // Worker target closure is asynchronous across the browser protocol. Wait
        // for the actual bounded condition instead of a fixed transport delay.
        for (let attempt=0;attempt<60&&[...activeWorkers].some(worker=>!/dotlottie\.worker-/.test(worker.url()));attempt++) await page.waitForTimeout(50);
        assert(activeWorkers.size <= 1 && [...activeWorkers].every(worker => /dotlottie\.worker-/.test(worker.url())), 'scene must close; only one idle library feedback worker may remain on navigation ' + index + ': ' + [...activeWorkers].map(worker => worker.url()).join(', '));
      }
      await page.waitForTimeout(250);await page.getByText('显示诊断', { exact: true }).click(); await page.getByRole('button', { name: '更新诊断' }).click();
      const released = JSON.parse(await page.locator('.presentation-diagnostics pre').textContent());
      assert.equal(released.resources.workers, 0); assert.equal(released.resources.scenes, 0); assert.equal(released.resources.lottie, 0);
      assert.equal(released.resources.observers, released.support.filter(type => ['longtask', 'long-animation-frame', 'event'].includes(type)).length);
      assert.equal(released.resources.listeners, 5); assert(!released.effects.some(effect => effect.continuous));
      fs.writeFileSync(path.join(output, 'after-20-switches.json'), JSON.stringify({ ...released, actualActiveWorkers: activeWorkers.size }, null, 2));
      await page.getByText('显示诊断', { exact: true }).click();
      checks.push('20 SPA scene route switches: scene Workers close, renderer/observer/listener counts return to baseline; library pool bounded to one idle feedback Worker');
      await page.emulateMedia({ forcedColors: 'active' }); await page.screenshot({ path: path.join(output, 'forced-colors.png') }); await page.emulateMedia({ forcedColors: 'none' });
      await page.getByRole('button', { name: '暂停动效', exact: true }).click();
      await page.locator('nav a[href="/app/workbench"]').click(); assert.equal(await page.locator('[data-scene-host]').count(), 0);
      checks.push('forced colors presentation; pause survives navigation without removing business controls');
      await page.emulateMedia({ media: 'print' });
      const printColors=await page.locator('.card h2').first().evaluate(node=>({text:getComputedStyle(node).color,background:getComputedStyle(node.closest('.card')).backgroundColor}));
      assert(contrast(printColors.text,printColors.background)>=4.5);
      assert.equal(await page.locator('.tech-scene').first().evaluate(node=>getComputedStyle(node).display),'none');
      fs.writeFileSync(path.join(output,'print-contrast.json'),JSON.stringify({...printColors,contrast:contrast(printColors.text,printColors.background)},null,2));
      await page.screenshot({path:path.join(output,'print-desktop.png')});await page.emulateMedia({ media: 'screen' });
      checks.push('actual print media: opaque light surfaces, readable headings and no decorative canvas');
    }
    assert.deepEqual(await page.evaluate(() => window.presentationCspViolations), []); assert.deepEqual(errors, []);
    assert(!requests.some(request => !request.url.startsWith(base + '/') && !request.url.startsWith('data:')));
    fs.writeFileSync(path.join(output, 'pilot-diagnostics.json'), JSON.stringify(snapshot, null, 2));
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, phase: process.argv.includes('--pilot') ? 'worker-pilot' : 'desktop-integration', checks, browser: browser.version(), viewport: { width: 1699, height: 828 }, resources: resourceRequests, databaseConnected: false, errors, failures }, null, 2));
    await context.tracing.stop({ path: path.join(output, 'trace.zip') });
    console.log(JSON.stringify({ passed: true, checks: checks.length, output }));
  } catch (error) { fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, errors, requests, failures }, null, 2)); throw error; }
  finally {
    let timer;
    try { await Promise.race([browser.close(), new Promise(resolve => { timer = setTimeout(resolve, 8000); })]); } finally { clearTimeout(timer); await browserServer.kill().catch(() => {}); }
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
