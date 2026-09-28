// P21: real same-origin HTTP, Edge and owned tmpfs MySQL with synthetic identities.
// --output must name a new repository artifacts directory. No private configuration.
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
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const checks = [], pageErrors = [], failures = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    const button = name => page.getByRole('button', { name, exact: true });
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor(); await idle();
    }
    async function idle() { await page.locator('.role-workbench[data-ready="true"]').waitFor(); }
    async function refresh() { const response = page.waitForResponse(r => r.url().includes('/api/role-workbench?')); await button('刷新工作台').click(); await response; await idle(); }
    async function as(who) { await button('退出登录').click(); await login(who); }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    try {
      await page.goto(fixture.baseURL + '/app/workbench'); await login('multi');
      await page.getByRole('heading', { name: '我现在该做什么', exact: true }).waitFor();
      assert.equal(await page.locator('[data-workbench-count]').textContent(), '我的待处理：0 项');
      assert.ok(await page.locator('[data-next-action]').count() <= 3);
      await button('全量职责').click(); await idle();
      assert.ok(await page.locator('[data-role-guide]').count() >= 2);
      await page.getByText('暂无职责链路数据。', { exact: true }).waitFor();
      await page.getByRole('heading', { name: '我的治理活动', exact: true }).waitFor();
      checks.push('real multi-role identity, zero actionable count distinct from guidance, all role guides and empty graph');
      const doc = structuredClone(fixture.document); doc.schema_version = 'process-governance-v8';
      doc.process.process_name = '合成角色工作台流程<script>不执行</script>';
      const created = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: doc, source_file_name: 'synthetic-v8.json' }, 201);
      await button('待办优先').click(); await idle();
      const payload = await expect('multi', '/api/role-workbench?mode=todo', 'GET');
      assert.ok(payload.summary.actionableCount > 0);
      assert.equal(await page.locator('[data-workbench-count]').textContent(), `我的待处理：${payload.summary.actionableCount} 项`);
      assert.equal(await page.locator('[data-next-action]').count(), Math.min(3, payload.nextActions.length));
      for (const action of payload.nextActions.slice(0, 3)) assert.ok((await page.locator('[data-next-actions]').textContent()).includes(action.title));
      const target = page.locator('[data-next-action] a').first();
      assert.equal(await target.getAttribute('href'), '/' + payload.nextActions[0].target);
      await target.click(); await page.waitForURL('**/#/processGovernance**');
      await page.goBack(); await idle(); await page.reload(); await idle();
      checks.push('native V8 tasks and source roles from real API, preserved full legacy item target, browser back and reload');
      await button('全量职责').click(); await idle(); await noOverflow();
      await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
      await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      await page.setViewportSize({ width: 1699, height: 828 });
      for (const status of [403, 409, 503]) {
        await page.route('**/api/role-workbench?*', route => route.fulfill({ status, json: { error: 'synthetic failure' } }), { times: 1 });
        await button('刷新工作台').click(); await page.getByRole('alert').waitFor();
        assert.equal(await page.locator('[data-next-action]').count(), 0);
        assert.ok((await page.locator('[data-workbench-count]').textContent()).includes('暂不可用'));
        await button('重试读取待办').click(); await idle();
      }
      checks.push('desktop/mobile geometry, 403/409/503 clear stale actionable data and retry');
      await page.route('**/api/activity/heatmap?*', route => route.fulfill({ status: 503, json: {} }), { times: 1 });
      await refresh(); await page.getByText('治理活动暂不可用', { exact: true }).waitFor();
      assert.ok(await page.locator('[data-next-action]').count() > 0);
      await button('重试读取治理活动').click(); await page.locator('[data-activity-ready="true"]').waitFor();
      checks.push('activity failure isolated from actionable tasks and independently retryable');
      await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (701,'SYNTHETIC_OFFICE','合成办公室','office',91,84)");
      await pool.execute("INSERT INTO office_membership(office_id,person_id,status) VALUES (701,87,'active')");
      const officeTask = await expect('lead', '/api/offices/tasks', 'POST', { office_id: 701, content: '合成办公室任务', request_id: require('node:crypto').randomUUID() }, 201);
      await expect('reviewA', `/api/offices/tasks/${officeTask.id}/assign`, 'POST', { assignee_person_id: 87, expected_revision: officeTask.revision_no });
      await refresh();
      await page.getByRole('link', { name: '办理办公室任务', exact: true }).first().waitFor();
      assert.equal(await page.getByRole('link', { name: '办理办公室任务', exact: true }).first().getAttribute('href'), '/#/officeWorkbench?office_id=701');
      await expect('multi', `/api/offices/tasks/${officeTask.id}/complete`, 'POST', { expected_revision: 2, note: '合成办理完成，不代表正式审核通过' });
      await refresh(); assert.equal(await page.getByRole('link', { name: '办理办公室任务', exact: true }).count(), 0);
      checks.push('real office assignment appears in personal workbench and disappears after task completion');
      const v7 = structuredClone(fixture.document); v7.process.process_ref = 'p21_role_legacy_v7';
      const oldCase = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: v7, source_file_name: 'synthetic-v7.json' }, 201);
      await as('reviewB');
      let prior = await expect('reviewB', '/api/role-workbench?mode=todo', 'GET');
      for (const item of oldCase.items) await expect('reviewB', '/api/process-v7-preview/items/' + item.id + '/decision', 'POST', { expected_revision_no: oldCase.case.current_revision_no, expected_content_hash: oldCase.case.current_content_hash, decision: 'confirmed', basis: '合成V7独立核对依据' });
      await refresh();
      const after = await expect('reviewB', '/api/role-workbench?mode=todo', 'GET');
      assert.ok(after.summary.actionableCount < prior.summary.actionableCount);
      assert.equal(await page.locator('[data-workbench-count]').textContent(), `我的待处理：${after.summary.actionableCount} 项`);
      checks.push('real V7 review removes completed items on refresh without changing native source');
      // Synthetic response tests renderer capability only; production currently returns no context links.
      const graphData = structuredClone(after);
      graphData.sankey = { nodes: ['role', 'capability', 'l3', 'a1', 'entry'].map((type, i) => ({ id: type, type, label: ['核对角色', '合成业务能力', '合成L3流程', '合成A1行为', '合成办理入口'][i], target: after.nextActions[0]?.target, sample: '合成图形交互样例' })), links: ['role', 'capability', 'l3', 'a1'].map((source, i) => ({ source, target: ['capability', 'l3', 'a1', 'entry'][i], value: 1 })) };
      await page.route('**/api/role-workbench?mode=all', route => route.fulfill({ json: graphData }), { times: 1 });
      await button('全量职责').click(); await idle();
      await page.locator('.wb-chart canvas').waitFor();
      const geometry = await page.locator('.wb-chart').evaluate(el => {
        const chart = window.echarts.getInstanceByDom(el), series = chart.getModel().getSeriesByIndex(0), nodes = series.getData();
        return Array.from({ length: nodes.count() }, (_, index) => ({ id: nodes.getName(index), ...nodes.getItemLayout(index) }));
      });
      assert.equal(geometry.length, 5);
      for (let i = 1; i < geometry.length; i++) assert.ok(geometry[i].x > geometry[i - 1].x + geometry[i - 1].dx, 'five graph levels must not collide');
      fs.writeFileSync(path.join(output, 'graph-geometry.json'), JSON.stringify(geometry, null, 2));
      await button('合成A1行为').click();
      await page.waitForFunction(() => document.activeElement?.className === 'wb-node-detail');
      await page.getByText('合成图形交互样例', { exact: true }).waitFor(); await noOverflow();
      await page.screenshot({ path: path.join(output, 'graph.png'), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 }); await noOverflow();
      await page.setViewportSize({ width: 1699, height: 828 });
      checks.push('synthetic five-level local ECharts graph, keyboard node detail and contained mobile scroll');
      let release, arrived;
      const held = new Promise(resolve => { release = resolve; });
      const started = new Promise(resolve => { arrived = resolve; });
      await page.route('**/api/role-workbench?mode=todo', async route => { arrived(); await held; await route.fulfill({ json: { ...after, nextActions: [{ title: '迟到待办不得覆盖', target: '#/roleWorkbench' }] } }).catch(() => {}); }, { times: 1 });
      await button('待办优先').click(); await started;
      await button('全量职责').click(); await idle(); release();
      await page.waitForTimeout(200);
      assert.ok(!(await page.locator('.role-workbench').textContent()).includes('迟到待办不得覆盖'));
      // Existing editor guard still applies when navigating into the new workbench.
      await as('contact');
      await page.getByRole('link', { name: '流程预览与核对', exact: true }).click();
      await page.getByRole('button', { name: '新建流程预览案例', exact: true }).click();
      const editable = page.locator('input[type=file]'); await editable.setInputFiles({ name: 'unsaved-v7.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(v7)) });
      await page.getByText('unsaved-v7.json process-governance-v7', { exact: true }).waitFor();
      page.once('dialog', d => d.dismiss());
      await page.getByRole('link', { name: '我的工作台', exact: true }).click();
      await page.getByText('unsaved-v7.json process-governance-v7', { exact: true }).waitFor();
      page.once('dialog', d => d.accept());
      await page.getByRole('link', { name: '我的工作台', exact: true }).click(); await idle();
      checks.push('late mode response ignored and existing editor input protected on workbench navigation');
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('刷新工作台').click(); await page.locator('#login-name').waitFor(); await login('outsider');
      assert.ok(!(await page.locator('.role-workbench').textContent()).includes(doc.process.process_name));
      assert.equal((await request('outsider', '/api/process-v7-preview/cases/' + created.case.id)).status, 403);
      await as('adminMulti');
      assert.equal(await page.locator('[data-workbench-count]').textContent(), '我的待处理：0 项');
      checks.push('real session expiry and cross-identity scope; administrator multi-role remains non-actionable');
      assert.deepEqual(pageErrors, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, failures, note: 'Synthetic isolated verification; no production or manual acceptance.' }, null, 2));
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(error => { fs.writeFileSync(path.join(output, 'failure.txt'), error.stack); console.error(error); process.exitCode = 1; });
