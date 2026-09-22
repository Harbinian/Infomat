// P19 synthetic API/owned MySQL/Edge/worker verification. No real model or material.
const assert = require('node:assert/strict'), crypto = require('node:crypto'), path = require('node:path');
const { fork, execFileSync } = require('node:child_process'), { once } = require('node:events');
const ai = require('../../server/analysisAiOffline');
module.exports = async function ({ repo, lead, pool, fixture, source, check, save, backup, restore, output }) {
  const uuid = () => crypto.randomUUID(), own = [], clients = {}, errors = [], consoleErrors = [], events = [];
  const test = async (name, fn) => { await check('P19 ' + name, fn); own.push(name); };
  const migration = require('../../server/analysisAiMigration');
  const apply = async fn => { const c = await pool.getConnection(); try { return await fn(c); } finally { c.release(); } };
  await apply(require('../../server/analysisQueueMigration').applyAnalysisQueue);
  const cfg = pool.pool.config.connectionConfig, target = `${cfg.host}:${cfg.port}/${cfg.database}`;
  const env = require('./isolatedProcess').isolatedEnvironment({ MYSQL_HOST: cfg.host, MYSQL_PORT: String(cfg.port), MYSQL_USER: cfg.user, MYSQL_PASSWORD: cfg.password, MYSQL_DATABASE: cfg.database, PROCESS_V7_PREVIEW_ENABLED: '1', PROCESS_V7_FORMAL_ENABLED: '1' });
  const payload = () => ai.createPayload(source.source_id, uuid(), 'P19 合成离线验证');
  const cli = args => execFileSync(process.execPath, [require.resolve('../manage-analysis-ai'), ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  await test('explicit additive migration: absent refused, dry-run, target, partial DDL, repeat and drift', async () => {
    await assert.rejects(repo.createQueuedAnalysis(lead, payload()), e => e.code === 'DEFINITION_ANALYSIS_QUEUE_AI_MIGRATION_REQUIRED');
    const before = await migration.inspectAnalysisAi(pool); assert.equal(before.ready, false); assert.deepEqual(before.drift, []);
    assert.deepEqual(JSON.parse(cli(['--target', target])), before); assert.throws(() => cli(['--apply', '--target', 'wrong']));
    await pool.execute(require('../../server/analysisAiSchema').statements()[0]); assert.equal((await migration.inspectAnalysisAi(pool)).ready, false);
    assert.equal((await apply(migration.applyAnalysisAi)).ready, true); assert.equal((await apply(migration.applyAnalysisAi)).ready, true);
    await pool.execute('ALTER TABLE data_map_analysis_ai_outputs ADD COLUMN synthetic_drift INT'); await assert.rejects(apply(migration.applyAnalysisAi), e => e.code === 'DEFINITION_ANALYSIS_SCHEMA_DRIFT');
    await pool.execute('ALTER TABLE data_map_analysis_ai_outputs DROP COLUMN synthetic_drift');
    save('p19-migration.json', { before, after: await migration.inspectAnalysisAi(pool), partial_resumed: true, repeated: true, drift_rejected: true });
  });
  // Include all already-supported review/material tables in the backup. The existing
  // finding component reads them; a missing fixture migration is not an AI failure.
  await apply(require('../../server/wordEvidenceMigration').applyWordEvidence);
  await apply(require('../../server/analysisIssueMigration').applyAnalysisIssues);
  await apply(db => require('../../server/officeSchema').manageOfficeSchema(db, 'apply'));
  await apply(require('../../server/analysisTaskMigration').applyAnalysisTasks);
  await apply(require('../../server/analysisClosureMigration').applyAnalysisClosure);
  const issueCount = async () => (await pool.query('SELECT COUNT(*) n FROM process_governance_issues'))[0][0].n;
  const originalIssueCount = await issueCount();
  const dump = backup(); let worker, browser, context, server, page;
  async function http(who, url, method = 'GET', body, status = 200, headers = {}) {
    const c = clients[who] || (clients[who] = {}), form = body instanceof FormData;
    const r = await fetch(fixture.baseURL + url, { method, headers: { ...(form ? {} : { 'Content-Type': 'application/json' }), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(c.csrf ? { 'X-CSRF-Token': c.csrf } : {}), ...headers }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
    if (r.headers.get('set-cookie')) c.cookie = r.headers.get('set-cookie').split(';')[0];
    const v = await r.json(); assert.equal(r.status, status, JSON.stringify(v)); return v;
  }
  const wait = async fn => { const end = Date.now() + 40000; while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 80)); } throw Error('P19_TIMEOUT'); };
  async function startWorker() { worker = fork(require.resolve('../analysis-worker'), ['start', '--target', target], { env, silent: true, windowsHide: true }); worker.stdout.on('data', b => { for (const line of String(b).trim().split(/\r?\n/)) { try { events.push(JSON.parse(line)); } catch {} } }); worker.stderr.on('data', () => {}); }
  async function stopWorker() { if (worker && worker.exitCode === null && worker.signalCode === null) { const stopped = once(worker, 'exit'); worker.send('stop'); const timer = setTimeout(() => worker.kill('SIGKILL'), 10000); await stopped; clearTimeout(timer); } }
  async function completeFixture(runId, mode) {
    const claim = await repo.claimAnalysis(uuid()); assert.equal(claim.run_id, runId);
    for (;;) {
      const task = await repo.nextAnalysisStep(claim); if (!task) break;
      let result;
      if (task.step.parser_key !== ai.PARSER) result = await require('../../server/analysisWorker').dispatch(task, new AbortController().signal);
      else {
        const request = ai.context(task), e = request.evidence.find(e => e.locator === '/process/process_name');
        const opinion = { rule_id: 'ai.body_structure', subject_key: e.subject_key, assessment: 'concern', message: '<img src=x onerror="window.p19Injected=true"> 合成待核实意见',
          citations: [{ evidence_id: e.evidence_id, input_key: e.input_key, ref_id: e.ref_id, content_digest: e.content_digest, quote: e.excerpt }] };
        const raw = JSON.stringify({ schema_version: ai.VERSION, checked_ids: ['ai.body_structure'], opinions: [opinion] });
        const session = ai.createSession({ responses: [mode === 'invalid' ? '{"truncated":' : raw], ...(mode === 'timeout' ? { delay_ms: 50, limits: { timeout_ms: 5 } } : {}) });
        result = await ai.analyze(task, { session }); save('p19-' + mode + '-output.json', { result, task_manifest_digest: task.manifest_digest });
      }
      await repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, ...result });
    }
    return repo.getAnalysisRun(lead, runId);
  }
  let accepted, invalid, timedout, linkedRun;
  try {
    for (const who of ['lead', 'contact', 'outsider', 'adminMulti']) { await http(who, '/api/org/login', 'POST', { loginName: 'SYNTHETIC_' + who, password: fixture.loginPassword }); clients[who].csrf = (await http(who, '/api/csrf-token')).csrfToken; }
    await test('API atomicity, permission, CSRF, metadata and process scope gates', async () => {
      await http('anonymous', '/api/analysis/runs', 'POST', payload(), 401); await http('contact', '/api/analysis/runs', 'POST', payload(), 403); await http('adminMulti', '/api/analysis/runs', 'POST', payload(), 404);
      await http('lead', '/api/analysis/runs', 'POST', payload(), 403, { 'X-CSRF-Token': '' });
      const count = async () => (await pool.query('SELECT COUNT(*) n FROM data_map_analysis_runs'))[0][0].n, before = await count();
      const external = payload(); external.ai_metadata.provider = 'real'; await http('lead', '/api/analysis/runs', 'POST', external, 400); assert.equal(await count(), before);
      const p = payload(); accepted = (await http('lead', '/api/analysis/runs', 'POST', p)).run_id; assert.equal((await http('lead', '/api/analysis/runs', 'POST', p)).run_id, accepted);
      await http('outsider', '/api/analysis/runs/' + accepted, 'GET', undefined, 404);
    });
    await test('valid offline output retained exactly and pending; trace corruption rejected', async () => {
      const run = await completeFixture(accepted, 'accepted'), attempt = run.attempts.find(a => a.ai_trace);
      assert.equal(run.status, 'partial'); assert.equal(attempt.findings.length, 1); assert.equal(attempt.findings[0].verification_status, 'pending_verification'); assert.equal(attempt.findings[0].issue_id, null);
      assert(attempt.ai_trace.output_raw.includes('onerror')); assert.equal(attempt.ai_trace.usage.real_calls, 0);
      const stored = (await pool.execute('SELECT snapshot_json FROM data_map_analysis_ai_outputs WHERE attempt_id=?', [attempt.attempt_id]))[0][0].snapshot_json;
      await pool.execute("UPDATE data_map_analysis_ai_outputs SET snapshot_json=JSON_SET(snapshot_json,'$.output_raw','corrupt') WHERE attempt_id=?", [attempt.attempt_id]);
      await assert.rejects(repo.getAnalysisRun(lead, accepted), e => e.code === 'DEFINITION_ANALYSIS_INTEGRITY_CONFLICT');
      await pool.execute('UPDATE data_map_analysis_ai_outputs SET snapshot_json=? WHERE attempt_id=?', [JSON.stringify(typeof stored === 'string' ? JSON.parse(stored) : stored), attempt.attempt_id]);
      const visible = await http('lead', '/api/analysis/runs/' + accepted); assert(!JSON.stringify(visible).includes('output_raw'));
      save('p19-accepted-run.json', await repo.getAnalysisRun(lead, accepted));
    });
    await test('AI truncation and timeout keep deterministic coverage and cannot create AI findings', async () => {
      for (const mode of ['invalid', 'timeout']) {
        const id = (await http('lead', '/api/analysis/runs', 'POST', payload())).run_id, run = await completeFixture(id, mode);
        const a = run.attempts.find(a => a.ai_trace), d = run.attempts.find(a => a.step_key === 'deterministic');
        assert.equal(run.status, 'partial'); assert(d.coverage.checked.length > 0); assert.equal(a.status, 'failed'); assert.equal(a.findings.length, 0); assert.equal(a.attempt_no, 1); assert(a.coverage.missing.includes('ai.live_evaluation'));
        assert.equal(a.error_code, mode === 'timeout' ? 'AI_TIMEOUT' : 'AI_OUTPUT_TRUNCATED_OR_INVALID'); if (mode === 'invalid') invalid = id; else timedout = id;
      }
    });
    await test('P18 explicit DOCX fixed link enters offline context; unlinked material fails only AI', async () => {
      await apply(require('../../server/wordEvidenceMigration').applyWordEvidence);
      const bytes = await require('../test-word-evidence').fixture();
      const parsed = await require('../../server/wordEvidenceParser').parseWordEvidence(bytes, '合成.docx');
      for (const linked of [true, false]) {
        const material = await repo.registerWordEvidence(lead, { request_id: uuid(), original_name: 'P19合成关联.docx', links: linked ? [{ kind: 'v7_source', ref_id: source.source_id, anchor_id: parsed.document.anchors[0].anchor_id, basis: '合成固定引用' }] : [] }, bytes);
        const p = ai.createPayload(source.source_id, uuid(), 'P19合成固定附件', [material.batch_id]); const r = await repo.createQueuedAnalysis(lead, p);
        const claim = await repo.claimAnalysis(uuid()); assert.equal(claim.run_id, r.run_id);
        for (;;) { const task = await repo.nextAnalysisStep(claim); if (!task) break; const result = await require('../../server/analysisWorker').dispatch(task, new AbortController().signal); await repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, ...result }); }
        const run = await repo.getAnalysisRun(lead, r.run_id), a = run.attempts.find(a => a.ai_trace); assert.equal(run.status, 'partial'); assert.equal(a.error_code, linked ? 'AI_OFFLINE_NOT_BUSINESS_EVALUATED' : 'AI_MATERIAL_NOT_LINKED');
        if (linked) linkedRun = r.run_id;
      }
    });
    await test('cancelled AI attempt rejects late output and trace in one transaction', async () => {
      const r = await repo.createQueuedAnalysis(lead, payload()), claim = await repo.claimAnalysis(uuid()); assert.equal(claim.run_id, r.run_id);
      let task = await repo.nextAnalysisStep(claim);
      while (task.step.parser_key !== ai.PARSER) {
        const result = await require('../../server/analysisWorker').dispatch(task, new AbortController().signal);
        await repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, ...result }); task = await repo.nextAnalysisStep(claim);
      }
      const result = await ai.analyze(task), before = await repo.getAnalysisRun(lead, r.run_id);
      const forged = JSON.parse(JSON.stringify(result)); forged.ai_trace.context_sha256 = 'b'.repeat(64);
      await assert.rejects(repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, ...forged }), e => e.code === 'DEFINITION_ANALYSIS_QUEUE_AI_TRACE_INVALID');
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_analysis_ai_outputs WHERE attempt_id=?', [task.attempt_id]))[0][0].n, 0);
      await repo.cancelQueuedAnalysis(lead, { request_id: uuid(), run_id: r.run_id, expected_revision: before.revision_no });
      await assert.rejects(repo.completeQueuedAnalysis(claim, { request_id: uuid(), attempt_id: task.attempt_id, expected_revision: task.revision_no, ...result }), e => ['DEFINITION_ANALYSIS_QUEUE_LEASE_LOST', 'DEFINITION_ANALYSIS_QUEUE_RUN_TERMINAL'].includes(e.code));
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_analysis_ai_outputs WHERE attempt_id=?', [task.attempt_id]))[0][0].n, 0);
      save('p19-cancelled.json', await repo.getAnalysisRun(lead, r.run_id));
    });
    await test('real Edge creates offline run through real worker; errors, plain text XSS and widths', async () => {
      let pw; try { pw = require('playwright'); } catch { pw = require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
      // Use an owned OS-assigned CDP port and refuse business ports.
      const net = require('node:net'), listener = net.createServer(); await new Promise(r => listener.listen(0, '127.0.0.1', r)); const port = listener.address().port; await new Promise(r => listener.close(r)); assert(![3000, 3001, 5173, 63805].includes(port));
      server = await pw.chromium.launchServer({ channel: 'msedge', headless: true, host: '127.0.0.1', port }); browser = await pw.chromium.connect(server.wsEndpoint());
      context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 }); page = await context.newPage(); page.setDefaultTimeout(15000);
      page.on('pageerror', e => errors.push(e.message)); page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
      const button = name => page.getByRole('button', { name, exact: true }), label = name => page.getByLabel(name, { exact: true });
      const idle = async () => { await button('刷新分析记录').waitFor(); await wait(async () => !await button('刷新分析记录').isDisabled()); };
      await page.goto(fixture.baseURL + '/app/analysis'); await page.locator('#login-name').fill('SYNTHETIC_lead'); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await idle();
      await label('分析对象').selectOption('ai_offline'); await idle(); await label('固定来源').selectOption(source.source_id); await label('本轮范围说明').fill('P19 页面创建离线校验');
      await page.route('**/api/analysis/runs', async route => route.request().method() === 'POST' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'UNAVAILABLE' }) }) : route.continue());
      await button('创建并排队分析').click(); await wait(async () => !await button('创建并排队分析').isDisabled()); assert.equal(await label('本轮范围说明').inputValue(), 'P19 页面创建离线校验'); await page.unroute('**/api/analysis/runs');
      await startWorker(); await button('创建并排队分析').click(); await idle(); const id = new URL(page.url()).hash.match(/(?:#|&)run=(\d+)/)[1];
      await wait(async () => (await repo.getAnalysisRun(lead, id)).status === 'partial'); await button('刷新分析记录').click(); await idle();
      await page.getByRole('note').waitFor(); await wait(async () => (await page.getByRole('heading', { name: '运行 ' + id + ' · 部分完成', exact: true }).count()) === 1);
      assert.match(await page.locator('body').innerText(), /本轮仅使用离线替身/); assert.match(await page.locator('body').innerText(), /未覆盖/);
      await page.screenshot({ path: path.join(output, 'p19-offline-desktop.png'), fullPage: true }); await stopWorker();
      await label('当前运行').selectOption(accepted); await idle();
      const f = (await repo.getAnalysisRun(lead, accepted)).attempts.find(a => a.ai_trace).findings[0];
      await page.goto(fixture.baseURL + '/app/analysis#run=' + accepted + '&finding=' + f.finding_id); await idle();
      await page.getByText(f.message, { exact: true }).first().waitFor();
      assert.match(await page.locator('body').innerText(), /<img src=x/); assert.equal(await page.evaluate(() => window.p19Injected), undefined); assert.equal(await page.locator('img[onerror]').count(), 0);
      for (const [width, height, name] of [[1699, 828, 'desktop'], [390, 844, 'narrow']]) { await page.setViewportSize({ width, height }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); await page.screenshot({ path: path.join(output, 'p19-opinion-' + name + '.png'), fullPage: true }); }
      await label('当前运行').selectOption(invalid); await idle(); await page.getByText(/offline_opinions.*AI_OUTPUT_TRUNCATED_OR_INVALID/).waitFor(); assert.match(await page.locator('body').innerText(), /AI_OUTPUT_TRUNCATED_OR_INVALID/); assert.match(await page.locator('body').innerText(), /确定性检查结果/);
      await page.screenshot({ path: path.join(output, 'p19-failed-narrow.png'), fullPage: true });
      assert.deepEqual(errors, []); assert.equal(consoleErrors.length, 1); assert(consoleErrors.every(e => /503/.test(e))); assert.equal(await issueCount(), originalIssueCount);
      save('p19-browser.json', { passed: true, page_errors: errors, console_errors: consoleErrors, failure_injection: [503], viewports: ['1699x828', '390x844'], real_worker: true, real_models: false, issue_count_unchanged: true });
    });
    save('p19-results.json', { passed: true, checks: own, accepted, invalid, timedout, linkedRun, real_calls: 0, business_acceptance: false });
  } catch (e) { if (page && !page.isClosed()) { await page.screenshot({ path: path.join(output, 'p19-failure.png'), fullPage: true }).catch(() => {}); save('p19-failure-ui.json', { body: await page.locator('body').innerText().catch(() => ''), errors, consoleErrors }); } throw e;
  } finally {
    await stopWorker(); const pid = server?.process()?.pid; let forced = false;
    // Windows Edge can leave its close handshake waiting. Follow the existing P18 ownership fence.
    const timer = setTimeout(() => {
      forced = true;
      if (process.platform === 'win32' && pid) {
        const command = "$owned=Get-CimInstance Win32_Process -Filter 'ProcessId=" + pid + "'; if ($owned -and $owned.ParentProcessId -eq " + process.pid + " -and $owned.Name -eq 'msedge.exe' -and $owned.CommandLine -like '*playwright_chromiumdev_profile-*') { $r=Invoke-CimMethod -InputObject $owned -MethodName Terminate; if ($r.ReturnValue -ne 0) { exit 1 } }";
        try { execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 10000, stdio: 'ignore' }); } catch {}
      }
      server?.kill().catch(() => {});
    }, 10000);
    try { if (context) await context.close(); if (browser) await browser.close(); if (server) await server.close(); } finally { clearTimeout(timer); }
    restore(dump); save('p19-cleanup.json', { worker_stopped: !worker || worker.exitCode !== null || worker.signalCode !== null, browser_closed: !browser || !browser.isConnected(), forced_browser_shutdown: forced, owned_browser_pid: pid, in_memory_backup_restored: true, events });
  }
};
