// Actual built UI in Edge at 1699x828. Synthetic HTTP only; no real sessions/database.
// Input: --build <artifacts build directory> --output <new artifacts evidence directory>.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const express = require('express');
const artifacts = path.resolve(__dirname, '../../../artifacts');
function argument(name) {
  const index = process.argv.indexOf(name);
  assert(index >= 0 && process.argv[index + 1], `${name} is required`);
  const value = path.resolve(process.argv[index + 1]);
  assert(value.startsWith(artifacts + path.sep), 'test inputs/outputs must stay in artifacts');
  return value;
}
const build = argument('--build'), output = argument('--output');
assert(fs.existsSync(path.join(build, 'index.html')));
assert(!fs.existsSync(output), 'preserve prior evidence');
fs.mkdirSync(output, { recursive: true });
function runtime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
async function main() {
  let enabled = false, statusFailure = false, caseRequests = 0;
  const app = express();
  app.get('/api/org/session', (_req, res) => res.json({ authenticated: true }));
  app.get('/api/org/me', (_req, res) => res.json({
    identityKind: 'person', personId: 42, departmentId: 91, name: '合成验证人员', departmentName: '合成部门',
    roleCodes: ['department_contact'], rbacRoles: [{ code: 'department_contact', name: '部门主对接人' }],
    permissions: ['governance:read-global', 'governance:draft-department']
  }));
  app.get('/api/org/me/password-status', (_req, res) => res.json({ is_default_password: false }));
  app.get('/api/process-v7-preview/status', (_req, res) => {
    if (statusFailure) return res.status(503).json({ error: 'synthetic unavailable' });
    res.json({ enabled, formal_enabled: false, preview_only: true, publishable: false, formal_process_version_id: null });
  });
  app.get('/api/process-v7-preview/cases', (_req, res) => {
    caseRequests++;
    assert(enabled, 'disabled feature must never be queried');
    res.json({ items: [], allowed_actions: ['create_case'], my_action_count: 0 });
  });
  app.get('/api/data-map/contexts', (_req, res) => res.json([]));
  app.get('/logo.png', (_req, res) => res.sendFile(path.resolve(__dirname, '../public/logo.png')));
  app.use('/app', express.static(build));
  app.get(/^\/app(?:\/.*)?$/, (_req, res) => res.sendFile(path.join(build, 'index.html')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  let browser;
  try {
    browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = [], responses = [], checks = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) responses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const refresh = () => page.getByRole('button', { name: '刷新案例与当前修订', exact: true }).click();
    const geometry = async () => {
      assert.equal(await page.evaluate(() => visualViewport.scale), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    };
    await page.goto(base + '/app/process-preview');
    await page.getByText('流程预览与核对尚未开启', { exact: true }).waitFor();
    assert.equal(caseRequests, 0);
    assert.equal(await page.getByLabel('选择流程案例').count(), 0);
    assert.equal(await page.getByText('当前范围暂无案例。', { exact: false }).count(), 0);
    await geometry(); await page.screenshot({ path: path.join(output, 'preview-disabled.png'), fullPage: true });
    checks.push('disabled preview shows availability instead of querying cases or claiming no records');

    enabled = true; await refresh();
    await page.getByRole('button', { name: '新建流程预览案例', exact: true }).click();
    await page.getByLabel('流程JSON文件', { exact: true }).setInputFiles({
      name: 'synthetic-retained-v8.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ schema_version: 'process-governance-v8' }))
    });
    await page.getByText('synthetic-retained-v8.json', { exact: false }).waitFor();
    const beforeDisable = caseRequests;
    enabled = false; await refresh();
    await page.getByText('流程预览与核对尚未开启', { exact: true }).waitFor();
    assert.equal(caseRequests, beforeDisable);
    await page.getByText('synthetic-retained-v8.json', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: '保存预览核对记录', exact: true }).isDisabled(), true);
    await geometry(); await page.screenshot({ path: path.join(output, 'preview-input-retained.png'), fullPage: true });
    enabled = true; await refresh();
    await page.getByLabel('选择流程案例').waitFor();
    assert.equal(await page.getByRole('button', { name: '保存预览核对记录', exact: true }).isDisabled(), false);
    await page.getByText('synthetic-retained-v8.json', { exact: false }).waitFor();
    checks.push('disable/re-enable retains uploaded draft and blocks submission while disabled');

    // Clear the owned synthetic draft before navigating; no saved business data exists.
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: '放弃本次编辑', exact: true }).click();
    enabled = false; const beforeDiagram = caseRequests;
    await page.goto(base + '/app/data-map');
    await page.locator('.native-diagrams').getByText('流程预览与核对尚未开启。', { exact: false }).waitFor();
    assert.equal(caseRequests, beforeDiagram);
    assert.equal(await page.getByLabel('图形流程', { exact: true }).count(), 0);
    assert.equal(await page.getByText('当前可见范围暂无流程。', { exact: true }).count(), 0);
    await geometry(); await page.screenshot({ path: path.join(output, 'diagram-disabled.png'), fullPage: true });
    checks.push('diagram case selector respects disabled preview while formal version search remains visible');
    assert.equal(await page.getByRole('button', { name: '检索版本', exact: true }).count(), 1);
    assert.deepEqual(errors, []); assert.deepEqual(responses, []);

    statusFailure = true; await page.goto(base + '/app/process-preview');
    await page.getByText('操作未完成', { exact: true }).waitFor();
    assert.equal(await page.getByText('流程预览与核对尚未开启', { exact: true }).count(), 0);
    assert.equal(await page.getByText('当前范围暂无案例。', { exact: false }).count(), 0);
    checks.push('status service failure stays an error rather than a disabled/empty result');
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({
      checks, browser: 'Microsoft Edge', viewport: { width: 1699, height: 828 }, zoom: 1,
      isolated: true, databaseConnected: false, expectedFault: responses, caseRequests
    }, null, 2));
    console.log(`Availability browser checks passed (${checks.length}); evidence: ${output}`);
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
