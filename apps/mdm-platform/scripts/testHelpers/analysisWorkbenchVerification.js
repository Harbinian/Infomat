// P15 real UI/API/worker extension of the owned P09 MySQL fixture. Synthetic only.
// No existing service/DB: own Edge, worker and in-memory backup are closed/restored.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { fork } = require('node:child_process'), { once } = require('node:events');
const { isolatedEnvironment } = require('./isolatedProcess');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
module.exports = async function ({ repo, lead, pool, run, historical, fixture, source, mapping, fieldMap, get, check, save, backup, restore, output }) {
  await require('../../server/analysisQueueMigration').applyAnalysisQueue(pool);
  const dump = backup(), own = [], errors = [], consoleErrors = [], events = [];
  let server, browser, worker, context, page;
  const test = async (name, fn) => { await check('P15 ' + name, fn); own.push(name); };
  const wait = async fn => { const end = Date.now() + 45000; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 100)); } throw Error('P15_WAIT_TIMEOUT'); };
  async function stopWorker() { if (worker && worker.exitCode === null && worker.signalCode === null) { const stopped = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await stopped; clearTimeout(timer); } }
  try {
    const pair = { source_mapping_version_id: fieldMap.mapping_version_id, target_mapping_version_id: fieldMap.mapping_version_id, identifier: true,
      checks: Object.fromEntries(['field', 'format', 'enum', 'unit', 'version'].map(k => [k, { mode: 'same', rule: null, basis: '合成固定字段对照依据' }])) };
    const h = await repo.saveDesignHandoff(lead, { request_id: crypto.randomUUID(), handoff_id: null, expected_revision: 0, definition: {
      title: 'P15 合成交接两端与长中文字段验证', claim_status: 'material_declared',
      source: { mapping_version_id: mapping.mapping_version_id, behavior_ref: 'behavior_prepare', operations: ['deliver'] },
      target: { mapping_version_id: mapping.mapping_version_id, behavior_ref: 'behavior_receive', operations: ['receive'] },
      identifier_kind: 'single', identity_rule: '合成编号精确相等', identity_basis: '合成字段声明', delivery_condition: '合成交付条件', reception_requirement: '合成接收条件',
      pairs: [pair], evidence: [{ side: 'source', locator: '合成制度第 1 节', note: '声明定位' }, { side: 'target', locator: '合成表单第 2 行', note: '声明定位' }]
    } });
    const broken = await repo.registerV7Source(lead, { request_id: crypto.randomUUID(), source_kind: 'uploaded_material', original_name: 'P15-broken.json' }, Buffer.from('P15-SYNTHETIC-UNPARSEABLE'));
    const pw = runtime(), net = require('node:net'); let port;
    for (let i = 0; i < 20; i++) { const listener = net.createServer(), p = crypto.randomInt(42000, 49000); if (await new Promise(r => { listener.once('error', () => r(false)); listener.listen(p, '127.0.0.1', () => r(true)); })) { await new Promise(r => listener.close(r)); port = p; break; } }
    assert(port);
    server = await pw.chromium.launchServer({ channel: 'msedge', headless: true, host: '127.0.0.1', port }); browser = await pw.chromium.connect(server.wsEndpoint());
    context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    const button = n => page.getByRole('button', { name: n, exact: true }), label = n => page.getByLabel(n, { exact: true });
    const idle = async () => { await button('刷新分析记录').waitFor(); await wait(async () => !(await button('刷新分析记录').isDisabled())); };
    const overflow = async () => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); };
    const screenshot = async n => { await page.screenshot({ path: path.join(output, n), fullPage: true }); };
    async function login(who = 'lead') { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await idle(); }
    const runId = () => new URL(page.url()).hash.match(/(?:#|&)run=(\d+)/)?.[1];
    async function choose(id) { await label('当前运行').selectOption(id); await idle(); }
    async function create(kind, ref, description) { if (await label('分析对象').inputValue() !== kind) { await label('分析对象').selectOption(kind); await idle(); } await label('固定来源').selectOption(ref); await label('本轮范围说明').fill(description); await button('创建并排队分析').click(); await idle(); return runId(); }
    async function finished(id) { const result = await wait(async () => { const r = await repo.getAnalysisRun(lead, id); return ['succeeded', 'partial', 'failed'].includes(r.status) ? r : null; }); await button('刷新分析记录').click(); await idle(); return result; }
    let first, second, cancelled;
    await test('Edge creates a real queued run and cancels with revision; input and navigation guard', async () => {
      await page.goto(fixture.baseURL + '/app/analysis'); await login();
      await label('固定来源').selectOption(source.source_id); await label('本轮范围说明').fill('合成未提交范围');
      const dialog = page.waitForEvent('dialog'); const click = page.getByRole('link', { name: '对象与字段', exact: true }).click(); await (await dialog).dismiss(); await click;
      assert.equal(await label('本轮范围说明').inputValue(), '合成未提交范围');
      const reloadDialog = page.waitForEvent('dialog'); const reloading = page.reload().catch(() => {}); await (await reloadDialog).dismiss(); await reloading;
      assert.equal(await label('本轮范围说明').inputValue(), '合成未提交范围');
      await button('创建并排队分析').click(); await idle(); cancelled = runId(); assert(cancelled); assert.equal((await repo.getAnalysisRun(lead, cancelled)).status, 'queued');
      await button('取消本次运行').click(); await idle(); assert.equal((await repo.getAnalysisRun(lead, cancelled)).status, 'cancelled');
      assert.equal(await label('本轮范围说明').inputValue(), '');
    });
    const c = pool.pool.config.connectionConfig;
    worker = fork(path.resolve(__dirname, '../analysis-worker.js'), ['start', '--target', `${c.host}:${c.port}/${c.database}`], { env: isolatedEnvironment({ MYSQL_HOST: c.host, MYSQL_PORT: String(c.port), MYSQL_USER: c.user, MYSQL_PASSWORD: c.password, MYSQL_DATABASE: c.database }), silent: true, windowsHide: true, execArgv: [] });
    worker.stdout.on('data', b => { for (const line of String(b).trim().split('\n')) try { events.push(JSON.parse(line)); } catch {} });
    await wait(() => events.some(e => e.event === 'worker_started'));
    await test('real creation worker partial results coverage and two-end evidence with fixed field links', async () => {
      first = await create('handoff', h.handoff_version_id, 'P15 合成确定性交接核对，范围仅限固定两端及字段，不确认主链完整性。');
      const result = await finished(first); assert.equal(result.status, 'partial'); assert(result.coverage.some(c => c.missing.includes('handoff.chain')));
      save('p15-worker-result.json', result);
      await label('发现类别').selectOption('business_question'); await label('搜索发现').fill('人工确认');
      const item = page.locator('[data-finding]').first(); const id = await item.getAttribute('data-finding'); await item.click(); await idle();
      assert(await page.getByRole('heading', { name: `发现 ${id} · 待核实` }).evaluate(e => e === document.activeElement));
      await button('查看证据 3').click(); await idle();
      await page.getByRole('heading', { name: '固定字段对应', exact: true }).waitFor();
      assert.equal(await page.getByRole('link', { name: /来源字段版本/ }).count(), 1);
      const href = await page.getByRole('link', { name: /来源字段版本/ }).getAttribute('href'); assert.equal((await context.request.get(fixture.baseURL + href)).status(), 200);
      await overflow(); await screenshot('p15-evidence-1699.png');
      await page.reload(); await idle(); await page.getByRole('heading', { name: '固定字段对应', exact: true }).waitFor(); assert.equal(await label('搜索发现').inputValue(), '人工确认');
      await button('返回原筛选位置').click(); await idle(); assert.equal(await label('搜索发现').inputValue(), '人工确认'); assert.equal(await page.locator('[data-finding]').count(), 1);
      assert(await page.locator('[data-finding]').first().evaluate(e => e === document.activeElement));
    });
    await test('directed graph arrows geometry zoom empty graph and narrow viewport', async () => {
      const graph = page.getByRole('img', { name: '当前筛选的分析路径（箭头不代表业务流转）' });
      const geometry = await graph.evaluate(svg => ({ nodes: [...svg.querySelectorAll('[data-graph-node]')].map(n => { const b = n.getBBox(); return { x: b.x, y: b.y, width: b.width, height: b.height }; }), arrows: [...svg.querySelectorAll('[data-graph-edge]')].map(e => ({ d: e.getAttribute('d'), marker: e.getAttribute('marker-end') })) }));
      assert.equal(geometry.arrows.length, 2); assert(geometry.arrows.every(e => e.marker.startsWith('url(#'))); assert(geometry.nodes.every((n, i, a) => !i || n.y > a[i - 1].y + a[i - 1].height)); save('p15-geometry.json', geometry);
      await button('放大图形').click(); assert.equal(await page.locator('output').textContent(), '125%'); await button('重置缩放').click();
      await page.setViewportSize({ width: 390, height: 844 }); await overflow(); await screenshot('p15-filter-390.png');
      await label('搜索发现').fill('不存在的合成筛选'); assert.equal(await page.locator('[data-finding]').count(), 0); assert.equal(await page.getByRole('img', { name: '当前筛选的分析路径（箭头不代表业务流转）' }).count(), 0);
      await button('清除筛选').click(); await overflow(); await page.setViewportSize({ width: 1699, height: 828 });
    });
    await test('second real run comparison and filtered export contains only selected authorized evidence locators', async () => {
      second = await create('handoff', h.handoff_version_id, '同一固定来源的第二次合成分析'); await finished(second);
      await label('对比运行').selectOption(first); await idle(); assert((await page.locator('body').textContent()).includes('对照不完整'));
      await label('发现类别').selectOption('not_covered'); const n = await page.locator('[data-finding]').count(); assert(n > 0);
      const downloading = page.waitForEvent('download'); await button('导出当前筛选范围').click(); const download = await downloading; const file = path.join(output, 'p15-filtered-export.json'); await download.saveAs(file);
      const result = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(result.findings.length, n); assert(result.findings.every(f => f.finding_type === 'not_covered')); assert(result.evidence.every(e => !Object.hasOwn(e, 'excerpt'))); assert.equal(result.changes_governance, false);
      await overflow(); await screenshot('p15-comparison-1699.png');
    });
    await test('V7 parse failure is partial or failed with explicit uncovered checks and safe evidence', async () => {
      const id = await create('v7_source', broken.source_id, '仅核对合成损坏 JSON'); const r = await finished(id); assert(['partial', 'failed'].includes(r.status)); assert(r.coverage.some(c => c.missing.length));
      await button('清除筛选').click(); assert((await page.locator('body').textContent()).includes('固定来源未能解析为JSON')); assert((await page.locator('body').textContent()).includes('INPUT_INCOMPLETE')); save('p15-parse-result.json', r);
    });
    await test('401 403 409 503 network failures retain creation input; relogin and stale async rejection', async () => {
      await label('固定来源').selectOption(source.source_id); await label('本轮范围说明').fill('受限失败仍保留的合成中文输入');
      const longInput = '受限失败仍保留的合成中文输入'.repeat(30);
      await label('本轮范围说明').fill(longInput); await overflow(); await screenshot('p15-long-input-1699.png');
      const url = '**/api/analysis/runs';
      for (const status of [403, 409, 503]) {
        await page.route(url, route => route.request().method() === 'POST' ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: 'synthetic', code: 'SYNTHETIC_FAILURE' }) }) : route.continue());
        await button('创建并排队分析').click(); await idle(); assert.equal(await label('本轮范围说明').inputValue(), longInput); await page.unroute(url);
      }
      await page.route(url, route => route.request().method() === 'POST' ? route.abort('failed') : route.continue()); await button('创建并排队分析').click(); await idle(); assert.equal(await label('本轮范围说明').inputValue(), longInput); await page.unroute(url);
      await page.route(url, route => route.request().method() === 'POST' ? route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }) : route.continue()); await button('创建并排队分析').click(); await page.locator('#login-name').waitFor(); await page.unroute(url); await login(); assert.equal(await label('本轮范围说明').inputValue(), longInput);
      const accept = page.waitForEvent('dialog'); const selected = label('当前运行').selectOption(first); await (await accept).accept(); await selected; await idle();
      let release; const gate = new Promise(r => { release = r; }); let seen; const observed = new Promise(r => { seen = r; });
      await page.route('**/api/analysis/runs/' + first, async route => { seen(); await gate; await route.continue().catch(() => {}); });
      await button('刷新分析记录').click(); await observed;
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); release(); await page.unroute('**/api/analysis/runs/' + first); assert.equal(await page.getByRole('heading', { name: '当前身份', exact: true }).count(), 1);
      await page.getByRole('link', { name: '分析检查台', exact: true }).click(); await idle(); assert.equal(await label('本轮范围说明').inputValue(), '');
    });
    await test('admin read only outsider hidden data and static asset isolation', async () => {
      await button('退出登录').click(); await login('adminMulti'); assert(await button('创建并排队分析').isDisabled());
      await button('退出登录').click(); await login('outsider'); assert.equal(await label('当前运行').locator('option').count(), 1);
      for (const suffix of ['', '/findings', '/export']) { const r = await context.request.get(fixture.baseURL + '/api/analysis/runs/' + first + suffix); assert.equal(r.status(), 404); assert(!(await r.text()).includes('合成订单')); }
      for (const url of ['/app/src/AnalysisWorkbench.jsx', '/artifacts/p15.json', '/server/analysisApi.js']) assert.equal((await context.request.get(fixture.baseURL + url)).status(), 404);
      const dist = path.resolve(__dirname, '../../frontend/dist'); for (const file of fs.readdirSync(path.join(dist, 'assets'))) { const value = fs.readFileSync(path.join(dist, 'assets', file), 'utf8'); for (const sentinel of ['P15-SYNTHETIC-UNPARSEABLE', 'P09合成订单', 'P15 合成交接两端']) assert(!value.includes(sentinel)); }
    });
    assert.deepEqual(errors, []); assert(consoleErrors.every(e => /^Failed to load resource:/.test(e) && /403|409|503|401|net::ERR_FAILED/.test(e))); save('p15-browser-results.json', { passed: true, checks: own, real_mysql: true, real_api: true, real_worker: true, browser: 'Edge', viewports: ['1699x828', '390x844'], page_errors: errors, console_errors: consoleErrors, synthetic_fault_injection: [401, 403, 409, 503, 'network'], human_acceptance: false });
  } catch (error) {
    if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'p15-failure.png'), fullPage: true }).catch(() => {}); save('p15-failure-state.json', { errors, consoleErrors, body: await page.locator('body').innerText().catch(() => ''), message: error.message }); }
    throw error;
  } finally {
    await stopWorker(); if (context) await context.close(); if (browser) await browser.close(); if (server) await server.close();
    save('p15-worker-events.json', events); restore(dump); save('p15-cleanup.json', { worker_stopped: !worker || worker.exitCode !== null || worker.signalCode !== null, browser_closed: !browser || !browser.isConnected(), in_memory_backup_restored: true });
  }
  assert.deepEqual(await get(run), historical);
};
