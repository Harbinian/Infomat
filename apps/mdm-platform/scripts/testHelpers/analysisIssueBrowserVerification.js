// Real Edge over the owned HTTP/MySQL fixture; real isolated worker; no user data.
const assert = require('node:assert/strict'), path = require('node:path'), crypto = require('node:crypto');
const { fork } = require('node:child_process'), { once } = require('node:events');
const { isolatedEnvironment } = require('./isolatedProcess');
module.exports = async ({ repo, lead, pool, fixture, handoff, test, save, output }) => {
  let browser, server, worker, page, context;
  const errors = [], consoleErrors = [], events = [];
  const wait = async fn => { const end = Date.now() + 45000; while (Date.now() < end) { const r = await fn(); if (r) return r; await new Promise(resolve => setTimeout(resolve, 100)); } throw Error('P16_WAIT_TIMEOUT'); };
  try {
    const rules = require('../../server/handoffAnalysisRules');
    const run = await repo.createQueuedAnalysis(lead, { request_id: crypto.randomUUID(), inputs: [{ input_key: 'handoff', kind: 'handoff', ref_id: handoff.handoff_version_id }],
      check_scope: { description: 'P16合成实际规则发现转问题验证', check_ids: rules.CHECKS }, parser_versions: { [rules.PARSER]: rules.VERSION }, rule_version: rules.VERSION,
      steps: [{ step_key: 'check', input_keys: ['handoff'], check_ids: rules.CHECKS, parser_key: rules.PARSER }], ai_metadata: null, rerun_of_run_id: null });
    const cfg = pool.pool.config.connectionConfig;
    worker = fork(path.resolve(__dirname, '../analysis-worker.js'), ['start', '--target', `${cfg.host}:${cfg.port}/${cfg.database}`], { env: isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database }), silent: true, windowsHide: true, execArgv: [] });
    worker.stdout.on('data', b => { for (const line of String(b).trim().split('\n')) try { events.push(JSON.parse(line)); } catch {} });
    const finished = await wait(async () => { const r = await repo.getAnalysisRun(lead, run.run_id); return ['succeeded','partial','failed'].includes(r.status) ? r : null; });
    const actual = finished.attempts.flatMap(a => a.findings.map(f => ({ ...f, evidence: a.evidence.filter(e => f.evidence_keys.includes(e.evidence_key)) }))).find(f => f.evidence.some(e => e.locator_kind === 'json_pointer'));
    assert(actual, 'real worker must generate a finding backed by a parsed location');
    let pw; try { pw = require('playwright'); } catch { pw = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
    const net = require('node:net'); let port;
    for (let i = 0; i < 20; i++) { const listener = net.createServer(), p = crypto.randomInt(42000,49000); if (await new Promise(r => { listener.once('error', () => r(false)); listener.listen(p, '127.0.0.1', () => r(true)); })) { await new Promise(r => listener.close(r)); port = p; break; } }
    assert(port);
    server = await pw.chromium.launchServer({ channel: 'msedge', headless: true, host: '127.0.0.1', port }); browser = await pw.chromium.connect(server.wsEndpoint());
    save('p16-browser-owner.json', { runner_pid: process.pid, browser_pid: server.process().pid, browser: 'Edge', owned: true });
    context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    const button = n => page.getByRole('button', { name: n, exact: true }), label = n => page.getByLabel(n, { exact: true });
    await page.goto(fixture.baseURL + `/app/analysis#run=${run.run_id}&finding=${actual.finding_id}`);
    await page.locator('#login-name').fill('SYNTHETIC_lead'); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click();
    await wait(async () => await label('明确归口部门').count() && !(await label('明确归口部门').isDisabled()));
    const reason = '合成核对理由：已逐项核实固定交接条件和来源定位。'.repeat(12);
    await test('Edge inputs survive navigation refusal and injected 401/403/409/503/network failures', async () => {
      await label('确认动作').selectOption('create'); await label('明确归口部门').selectOption('91');
      await label('归口依据').fill('合成业务说明明确归口部门 91，不从上传身份推断。'); await label('确认理由').fill(reason);
      await label('问题标题').fill('P16合成浏览器问题');
      const index = actual.evidence.findIndex(e => e.locator_kind === 'json_pointer'); await label(`确认依据 ${index + 1}`).check();
      const dialog = page.waitForEvent('dialog'), click = button('返回原筛选位置').click(); await (await dialog).dismiss(); await click;
      assert.equal(await label('确认理由').inputValue(), reason);
      const reloadDialog = page.waitForEvent('dialog'), reload = page.reload().catch(() => {}); await (await reloadDialog).dismiss(); await reload;
      assert.equal(await label('确认理由').inputValue(), reason);
      const url = `**/api/analysis/runs/${run.run_id}/findings/${actual.finding_id}/review`;
      for (const status of [403,409,503,0]) {
        await page.route(url, route => route.request().method() === 'POST' ? status ? route.fulfill({ status, contentType: 'application/json', body: JSON.stringify({ error: '合成故障注入', code: 'DEFINITION_SYNTHETIC' }) }) : route.abort() : route.continue());
        await button('提交人工确认').click(); await wait(async () => !(await button('提交人工确认').isDisabled()));
        assert.equal(await label('确认理由').inputValue(), reason); await page.unroute(url);
      }
      // A 401 hides identity-bound content; the same identity must log in again.
      await page.route(url, route => route.request().method() === 'POST' ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: '合成会话失效' }) }) : route.continue());
      await button('提交人工确认').click(); await page.locator('#login-name').waitFor(); await page.unroute(url);
      await page.locator('#login-name').fill('SYNTHETIC_lead'); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click();
      await label('确认理由').waitFor(); assert.equal(await label('确认理由').inputValue(), reason);
    });
    await test('Edge desktop/mobile layout, keyboard focus and real worker finding becomes one traceable issue', async () => {
      await wait(async () => !(await button('提交人工确认').isDisabled()));
      for (const [width,height,name] of [[1699,828,'desktop'],[390,844,'mobile']]) {
        await page.setViewportSize({ width,height }); assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await label('确认理由').focus(); assert.equal(await label('确认理由').evaluate(e => document.activeElement === e), true);
        await page.keyboard.press('Tab');
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.getByRole('region', { name: '发现人工确认' }).count();
        await page.screenshot({ path: path.join(output, `p16-${name}.png`), fullPage: true });
        await page.getByLabel('发现人工确认', { exact: true }).screenshot({ path: path.join(output, `p16-${name}-panel.png`) });
      }
      await button('提交人工确认').click(); await wait(async () => (await repo.getFindingReview(lead, run.run_id, actual.finding_id)).state.issue_id);
      await page.getByLabel('关联问题', { exact: true }).waitFor();
      const state = await repo.getFindingReview(lead, run.run_id, actual.finding_id), issue = await repo.getAnalysisIssue(lead, state.state.issue_id);
      assert.equal(issue.links.length, 1); assert.equal(issue.links[0].finding_id, actual.finding_id);
      assert.equal((await repo.getAnalysisRun(lead, run.run_id)).attempts[0].findings.find(f => f.finding_id === actual.finding_id).issue_id, null);
      await button(`追溯运行 ${run.run_id} / 发现 ${actual.finding_id}`).click(); await page.getByLabel('关联问题', { exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, 'p16-linked.png'), fullPage: true });
      save('p16-real-worker-trace.json', { run_id: run.run_id, finding_id: actual.finding_id, review: state, issue, events });
    });
    await test('Edge explicitly reads an existing issue before linking; not-an-issue changes only its finding', async () => {
      const candidates = finished.attempts.flatMap(a=>a.findings.map(f=>({...f,evidence:a.evidence.filter(e=>f.evidence_keys.includes(e.evidence_key))}))).filter(f=>f.finding_id!==actual.finding_id&&f.evidence.some(e=>e.locator_kind==='json_pointer'));
      assert(candidates.length >= 2);
      const issueId = (await repo.getFindingReview(lead,run.run_id,actual.finding_id)).state.issue_id;
      async function open(f, action) {
        await button('返回原筛选位置').click(); await button('查看发现 '+f.finding_id).click();
        await wait(async()=>await label('确认动作').count()&&!(await label('确认动作').isDisabled()));
        await label('确认动作').selectOption(action); await label('明确归口部门').selectOption('91');
        await label('归口依据').fill('合成已明确归口'); await label('确认理由').fill('按固定来源逐条核对，不影响其他发现');
        await label('确认依据 '+(f.evidence.findIndex(e=>e.locator_kind==='json_pointer')+1)).check();
      }
      await open(candidates[0],'link'); await label('已有问题编号').fill(issueId); await button('读取已有问题').click();
      await page.getByLabel('关联问题',{exact:true}).waitFor(); await wait(async()=>!(await button('提交人工确认').isDisabled()));
      await button('提交人工确认').click(); await wait(async()=>(await repo.getAnalysisIssue(lead,issueId)).links.length===2);
      await wait(async()=>await page.getByTestId('finding-review-state').textContent().then(t=>t.includes('已关联')));
      await open(candidates[1],'not_an_issue'); await button('提交人工确认').click();
      await wait(async()=>(await repo.getFindingReview(lead,run.run_id,candidates[1].finding_id)).state.decision==='not_an_issue');
      assert.equal((await repo.getAnalysisIssue(lead,issueId)).issue.display_status,'waiting_my_action');
      assert.equal((await repo.getAnalysisIssue(lead,issueId)).links.length,2);
      save('p16-ui-decisions.json',{linked_issue:await repo.getAnalysisIssue(lead,issueId),rejected_finding:await repo.getFindingReview(lead,run.run_id,candidates[1].finding_id)});
    });
    assert.deepEqual(errors, []);
    assert(consoleErrors.every(t => /Failed to load resource|net::ERR_FAILED/.test(t)), consoleErrors.join('\n'));
    save('p16-browser-results.json', { passed: true, page_errors: errors, expected_injected_console_errors: consoleErrors, viewports: ['1699x828','390x844'], zoom: 1, human_acceptance: false });
  } finally {
    if (worker && worker.exitCode === null && worker.signalCode === null) { const stopped = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await stopped; clearTimeout(timer); }
    // Windows can hold Edge shutdown after the protocol disconnect. The fallback
    // uses only this launchServer handle, never a process-name-wide termination.
    let forced = false;
    const timer = setTimeout(() => {
      forced = true;
      if (server && process.platform === 'win32') {
        const pid = server.process().pid;
        // Some Windows Edge instances outlive Playwright's process handle. WMI
        // is used only after matching BOTH this launcher and automation profile.
        const script = `$owned = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($owned -and $owned.ParentProcessId -eq ${process.pid} -and $owned.Name -eq 'msedge.exe' -and $owned.CommandLine -like '*playwright_chromiumdev_profile-*') { $result = Invoke-CimMethod -InputObject $owned -MethodName Terminate; if ($result.ReturnValue -ne 0) { exit 1 } }`;
        try { require('node:child_process').execFileSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], { windowsHide: true, timeout: 10000, stdio: 'ignore' }); } catch { /* The assertions below still require the owned connection to close. */ }
      }
      server?.kill().catch(() => {});
    }, 10000);
    try { await context?.close().catch(() => {}); await browser?.close().catch(() => {}); await server?.close(); } finally { clearTimeout(timer); }
    save('p16-cleanup.json', { worker_stopped: !worker || worker.exitCode !== null || worker.signalCode !== null, browser_closed: !browser || !browser.isConnected(), owned_browser_forced_shutdown: forced });
  }
};
