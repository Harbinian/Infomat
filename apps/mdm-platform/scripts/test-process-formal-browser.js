// P21 formal lifecycle: owned temporary MySQL, real HTTP and Edge, synthetic identities only.
// Input: --output <new artifacts directory>. Writes evidence there; closes only owned resources.
// Requires built frontend, existing mysql:8.4 image and Edge. Never loads private configuration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'preserve earlier evidence'); fs.mkdirSync(output, { recursive: true });
const root = '/api/process-v7-preview';
const binding = c => ({ expected_revision_no: c.current_revision_no, expected_content_hash: c.current_content_hash });
async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const checks = [], pageErrors = [], consoleErrors = [], failures = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    page.on('response', r => { if (r.status() >= 400) failures.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    const button = name => page.getByRole('button', { name, exact: true });
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor();
    }
    async function idle() { await button('刷新正式办理状态').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新正式办理状态')?.disabled); }
    async function as(who) { await button('退出登录').click(); await login(who); await idle(); }
    async function refresh() { await button('刷新正式办理状态').click(); await idle(); }
    async function select(id) { await page.getByLabel('选择流程案例', { exact: true }).selectOption(String(id)); await idle(); }
    async function commit() { await button('确认执行本次操作').click(); await page.getByText('操作已完成', { exact: true }).waitFor(); await idle(); }
    async function discard() { page.once('dialog', d => d.accept()); await button('放弃本次输入').click(); }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    async function readyCase(ref, version = 'process-governance-v8') {
      const doc = structuredClone(fixture.document); doc.schema_version = version; doc.process.process_ref = ref; doc.process.process_name = '正式流转合成流程' + ref;
      const data = await expect('contact', root + '/cases', 'POST', { document: doc, source_file_name: ref + '.json' }, 201);
      for (const who of ['reviewA', 'reviewB']) for (const item of data.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...binding(data.case), decision: 'confirmed', basis: '合成部门独立核对依据' });
      return { id: data.case.id, doc };
    }
    const read = id => expect('lead', root + '/cases/' + id, 'GET');
    async function checkDraftContent(draft, expected, faults = false) {
      const panel = page.locator('[data-formal-content]');
      const contentPath = '/api/process-design/drafts/' + draft.id + '/content';
      const exportPath = '/api/process-design/drafts/' + draft.id + '/export';
      const truth = await expect('lead', contentPath, 'GET');
      const writes = [], downloads = [];
      const track = r => { if (r.method() !== 'GET') writes.push(r.url()); };
      const recordDownload = d => downloads.push(d);
      page.on('request', track); page.on('download', recordDownload);
      async function load() { await button('核对正式草稿正文').click(); await panel.locator('[data-formal-content-result]').waitFor(); }
      async function failed() {
        await panel.getByText('正式草稿正文暂不可用', { exact: true }).waitFor();
        assert.equal(await panel.locator('[data-formal-content-result]').count(), 0);
      }
      try {
        await button('核对正式草稿正文').focus(); await page.keyboard.press('Enter');
        await panel.locator('[data-formal-content-result]').waitFor();
        await panel.getByText('正式草稿原生正文', { exact: true }).click();
        assert.deepEqual(JSON.parse(await panel.locator('pre').innerText()), expected);
        const downloadPromise = page.waitForEvent('download'); await button('下载正式草稿 JSON').click();
        const download = await downloadPromise;
        assert.equal(download.suggestedFilename(), `formal-draft-${draft.id}-r${draft.revision_no}-${expected.schema_version}.json`);
        const destination = path.join(output, download.suggestedFilename()); await download.saveAs(destination);
        assert.deepEqual(JSON.parse(fs.readFileSync(destination, 'utf8')), expected);
        assert.deepEqual((await expect('lead', exportPath, 'GET')), expected);
        assert.equal((await request('outsider', contentPath, 'GET')).status, 403);
        assert.equal((await request('outsider', exportPath, 'GET')).status, 403);
        if (faults) {
          await noOverflow(); await panel.screenshot({ path: path.join(output, 'formal-content.png') });
          for (const endpoint of [contentPath, exportPath]) for (const status of [403, 409, 503]) {
            await page.route('**' + endpoint, route => route.fulfill({ status, json: { error: 'synthetic draft read fault' } }), { times: 1 });
            await button('下载正式草稿 JSON').click(); await failed(); await load();
          }
          await page.route('**' + exportPath, route => route.abort(), { times: 1 });
          await button('下载正式草稿 JSON').click(); await failed(); await load();
          for (const change of [{ revision: truth.revision + 1 }, { content_hash: '0'.repeat(64) }, { schema_version: 'process-governance-v3' }]) {
            await page.route('**' + contentPath, route => route.fulfill({ json: { ...truth, ...change } }), { times: 1 });
            await button('下载正式草稿 JSON').click(); await failed();
          }
          await page.route('**' + exportPath, route => route.fulfill({ json: { ...expected, process: { ...expected.process, purpose: 'changed between requests' } } }), { times: 1 });
          await button('下载正式草稿 JSON').click(); await failed(); await load();
          assert.equal(downloads.length, 1, 'failed or mismatched reads never download');
        }
        assert.deepEqual(writes, [], 'content and export do not write');
        checks.push(expected.schema_version + ' native draft content/export matches API; stable IDs; scope; ' + (faults ? 'error retry and revision/hash/format/export-race rejection' : 'compatibility'));
      } finally { page.off('request', track); page.off('download', recordDownload); }
    }
    try {
      await page.goto(fixture.baseURL + '/app/process-formal'); await login('lead'); await idle();
      await page.getByText('当前范围暂无案例。', { exact: true }).waitFor(); checks.push('empty authenticated formal page');
      const first = await readyCase('formal_v8'); await refresh(); await select(first.id);
      let before = await read(first.id);
      await pool.execute("UPDATE departments SET name='合成乙部已调整' WHERE id=92");
      assert.equal((await request('lead', root + '/cases/' + first.id + '/promote', 'POST', { ...binding(before.case), target: { mode: 'create', document_no: 'NO-GATE-BYPASS', document_title: '不得绕过' } })).status, 409);
      await pool.execute("UPDATE departments SET name='合成乙部' WHERE id=92");
      await button('提升当前修订').click();
      assert.equal(await page.evaluate(() => document.activeElement?.textContent), '提升当前修订');
      assert.equal(await page.getByLabel('正式承接方式', { exact: true }).inputValue(), '', 'no implicit target selection');
      await page.getByLabel('正式承接方式', { exact: true }).selectOption('create');
      await page.getByLabel('新主档制度编号', { exact: true }).fill('P21-FORMAL-V8');
      await page.getByLabel('新主档制度名称', { exact: true }).fill('合成正式制度<script>alert(1)</script>');
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '当前身份', exact: true }).click();
      assert.equal(await page.getByLabel('新主档制度编号', { exact: true }).inputValue(), 'P21-FORMAL-V8');
      await refresh(); assert.equal(await page.getByLabel('新主档制度编号', { exact: true }).inputValue(), 'P21-FORMAL-V8');
      page.once('dialog', d => d.dismiss()); await page.reload().catch(() => {});
      assert.equal(await page.getByLabel('新主档制度编号', { exact: true }).inputValue(), 'P21-FORMAL-V8');
      for (const status of [403, 409, 503]) {
        await page.route('**/api/process-v7-preview/cases/' + first.id + '/promote', route => route.fulfill({ status, json: { error: 'synthetic fault' } }), { times: 1 });
        await button('确认执行本次操作').click(); await page.getByRole('alert').waitFor();
        assert.equal(await page.getByLabel('新主档制度编号', { exact: true }).inputValue(), 'P21-FORMAL-V8');
      }
      await commit(); let detail = await read(first.id); let draft = detail.formal_promotion.draft;
      await button('读取或刷新正式历史').focus(); await page.keyboard.press('Enter');
      await page.getByText('该正式草稿尚无审核任务记录。', { exact: true }).waitFor();
      await checkDraftContent(draft, first.doc, true);
      assert.equal(draft.schema_version, 'process-governance-v8');
      assert.deepEqual((await expect('contact', '/api/process-design/drafts/' + draft.id + '/content', 'GET')).document, first.doc);
      assert.equal((await request('lead', root + '/cases/' + first.id + '/promote', 'POST', { ...binding(detail.case), target: { mode: 'create', document_no: 'P21-FORMAL-V8', document_title: '合成正式制度<script>alert(1)</script>' } })).status, 200);
      checks.push('explicit native V8 promotion; duplicate promotion idempotent; navigation/refresh/403/409/503 retain input; safe text');
      await page.reload(); await idle(); assert.equal(new URL(page.url()).searchParams.get('case'), String(first.id));
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle();
      assert.equal(new URL(page.url()).searchParams.get('case'), String(first.id));
      await as('contact');
      await pool.execute("UPDATE departments SET name='合成乙部已调整' WHERE id=92");
      await refresh(); assert.equal(await button('提交正式审核').count(), 0);
      assert.equal((await request('contact', '/api/process-design/drafts/' + draft.id + '/submit', 'POST', { expected_revision_no: draft.revision_no, expected_content_hash: draft.content_hash })).status, 409);
      await pool.execute("UPDATE departments SET name='合成乙部' WHERE id=92"); await refresh();
      await button('提交正式审核').click(); await commit();
      await as('reviewA'); await button('办理正式审核').click();
      await page.getByLabel('正式审核结论', { exact: true }).selectOption('needs_changes');
      const note = '请回到同一案例补充依据。' + '中文长意见保留完整内容。'.repeat(16);
      await page.getByLabel('正式审核意见', { exact: true }).fill(note);
      // Revoke this browser session through the real same-origin logout endpoint.
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('确认执行本次操作').click(); await page.locator('#login-name').waitFor(); await login('reviewA'); await idle();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), note);
      await noOverflow(); await page.screenshot({ path: path.join(output, 'desktop-review.png'), fullPage: true });
      await commit(); detail = await read(first.id); assert.equal(detail.formal_promotion.draft.status, 'needs_changes');
      assert.equal(detail.formal_promotion.review_task.decision_note, note);
      await page.getByText(note, { exact: true }).first().waitFor();
      assert.ok((await page.getByRole('link', { name: '返回本案例预览与修订', exact: true }).getAttribute('href')).includes('case=' + first.id));
      checks.push('real submit/needs-changes and actor audit; session expiration restores same-identity input; desktop only');
      await as('contact'); await button('提交正式审核').click(); await commit();
      await as('reviewA'); await button('办理正式审核').click(); await page.getByLabel('正式审核结论', { exact: true }).selectOption('approve'); await page.getByLabel('正式审核意见', { exact: true }).fill('当前修订核对完成'); await commit();
      await as('lead');
      await pool.execute("UPDATE departments SET name='合成乙部已调整' WHERE id=92");
      await refresh(); assert.equal(await button('发布正式版本').count(), 0);
      assert.equal((await request('lead', '/api/process-design/drafts/' + draft.id + '/publish', 'POST', { expected_revision_no: draft.revision_no, expected_content_hash: draft.content_hash })).status, 409);
      await pool.execute("UPDATE departments SET name='合成乙部' WHERE id=92"); await refresh();
      await button('发布正式版本').click(); await commit();
      detail = await read(first.id); const version = detail.formal_promotion.current_version;
      assert.ok(version.id); assert.equal(detail.formal_promotion.draft.status, 'published');
      assert.equal(await page.getByText('审核通过，待发布', { exact: false }).count(), 0, 'published case must not present review result as awaiting publication');
      await page.getByText('当前修订已发布，可在下方核对固定版本正文和下载程序文件。', { exact: true }).waitFor();
      await button('核对已发布正文').click(); await page.getByText('正式版本摘要校验通过', { exact: true }).waitFor();
      const oldVersion = await expect('lead', '/api/process-design/versions/' + version.id + '/content', 'GET');
      assert.deepEqual(oldVersion.document, first.doc); assert.equal(oldVersion.content_hash_verified, true);
      const downloaded = page.waitForEvent('download'); await button('下载程序文件（Markdown）').click(); const artifact = await downloaded;
      await artifact.saveAs(path.join(output, 'procedure.md'));
      const markdown = fs.readFileSync(path.join(output, 'procedure.md'), 'utf8');
      assert.equal(markdown, (await expect('lead', '/api/process-design/versions/' + version.id + '/procedure-markdown', 'GET')).markdown, 'download is exactly the fixed-version API artifact');
      assert.ok(markdown.includes('正式版本标识：' + version.id)); assert.ok(markdown.includes('合成核对记录'));
      await page.screenshot({ path: path.join(output, 'published.png'), fullPage: true });
      checks.push('approval/publish/readback/download use fixed process_version_id and native content');
      // A new source revision must not mutate the previously published version.
      const revised = structuredClone(first.doc); revised.process.purpose += ' 新修订';
      let newer = await expect('contact', root + '/cases/' + first.id + '/revisions', 'POST', { ...binding(detail.case), document: revised, source_file_name: 'revised.json' }, 201);
      assert.equal((await request('lead', root + '/cases/' + first.id + '/promote', 'POST', { ...binding(detail.case), target: { mode: 'existing', document_id: detail.formal_promotion.document.id } })).status, 409, 'old source binding cannot promote a new revision');
      for (const who of ['reviewA', 'reviewB']) for (const item of newer.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...binding(newer.case), decision: 'confirmed', basis: '新修订核对' });
      await refresh(); await button('提升当前修订').click(); await page.getByLabel('正式承接方式', { exact: true }).selectOption('existing');
      await page.getByLabel('已有主档完整制度编号', { exact: true }).fill('P21-FORMAL-V8');
      await button('精确查找已有主档').click(); await page.getByText('已找到可承接主档', { exact: true }).waitFor(); await commit();
      detail = await read(first.id); assert.equal(detail.formal_promotion.document.id, oldVersion.document_id);
      assert.equal(detail.formal_promotion.draft.revision_no, 2); assert.deepEqual((await expect('lead', '/api/process-design/versions/' + version.id + '/content', 'GET')).document, first.doc);
      checks.push('explicit existing target and source revision retain immutable published version');
      // A concurrent submit changes the task/state; stale visible review must never rebind.
      await as('contact'); await button('提交正式审核').click(); await commit();
      await as('reviewA'); await button('办理正式审核').click(); await page.getByLabel('正式审核结论', { exact: true }).selectOption('needs_changes'); await page.getByLabel('正式审核意见', { exact: true }).fill('并发输入应保留');
      await button('读取或刷新正式历史').click(); await page.locator('[data-formal-history] h4').first().waitFor();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), '并发输入应保留');
      await button('核对正式草稿正文').click(); await page.locator('[data-formal-content-result]').waitFor();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), '并发输入应保留');
      await button('读取或刷新已发布版本列表').click(); await page.getByLabel('已发布历史版本', { exact: true }).waitFor();
      await page.getByLabel('已发布历史版本', { exact: true }).selectOption(String(version.id));
      await button('核对所选历史正文').click(); await page.locator('[data-published-history-result]').waitFor();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), '并发输入应保留');
      detail = await read(first.id); let task = detail.formal_promotion.review_task;
      await expect('reviewA', '/api/process-design/review-tasks/' + task.id + '/decision', 'POST', { expected_revision_no: task.draft_revision_no, expected_content_hash: task.content_hash, decision: 'needs_changes', note: '另一窗口已处理' });
      await button('确认执行本次操作').click(); await page.getByRole('alert').waitFor(); await refresh();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), '并发输入应保留'); assert.equal(await button('确认执行本次操作').isDisabled(), true);
      await discard(); checks.push('real concurrent review conflict preserves input and blocks silent rebind');
      // Department drift must block approve but leave needs_changes and reject available.
      await as('contact'); await button('提交正式审核').click(); await commit();
      await pool.execute("UPDATE departments SET name='合成乙部已调整' WHERE id=92");
      await as('reviewA'); await button('办理正式审核').click();
      const decisions = await page.getByLabel('正式审核结论', { exact: true }).locator('option').evaluateAll(rows => rows.map(r => r.value));
      assert.deepEqual(decisions, ['', 'needs_changes', 'reject']);
      detail = await read(first.id); task = detail.formal_promotion.review_task;
      const denied = await request('reviewA', '/api/process-design/review-tasks/' + task.id + '/decision', 'POST', { expected_revision_no: task.draft_revision_no, expected_content_hash: task.content_hash, decision: 'approve', note: '不得绕过部门卡口' });
      assert.equal(denied.status, 409); assert.equal(denied.body.code, 'V7_FORMAL_BLOCKING_ISSUES');
      assert.ok(detail.blocking_issues.some(issue => issue.code === 'ACTOR_DEPARTMENT_UNRESOLVED'), 'detail identifies the actor gate while write API returns its existing bounded error');
      await page.getByLabel('正式审核结论', { exact: true }).selectOption('reject'); await page.getByLabel('正式审核意见', { exact: true }).fill('部门事实待明确，拒绝本次审核'); await commit();
      assert.equal((await read(first.id)).formal_promotion.draft.status, 'rejected');
      await pool.execute("UPDATE departments SET name='合成乙部' WHERE id=92");
      checks.push('live department gate denies approve and preserves needs_changes/reject; rejection persists');
      const historyDraft = (await read(first.id)).formal_promotion.draft;
      const historyPath = '/api/process-design/drafts/' + historyDraft.id;
      const historyTruth = await expect('lead', historyPath, 'GET');
      const historyPanel = page.locator('[data-formal-history]');
      async function loadHistory() { await button('读取或刷新正式历史').click(); await historyPanel.locator('h4').first().waitFor(); }
      const writes = []; const trackWrites = r => { if (r.method() !== 'GET') writes.push(r.url()); };
      page.on('request', trackWrites);
      await loadHistory();
      assert.equal(await historyPanel.locator('[data-formal-review]').count(), historyTruth.reviewTasks.length);
      assert.equal(await historyPanel.locator('[data-formal-event]').count(), historyTruth.events.length);
      for (const row of historyTruth.reviewTasks) {
        const text = await historyPanel.locator('[data-formal-review="' + row.id + '"]').innerText();
        assert.ok(text.includes(row.content_hash)); assert.ok(text.includes(row.decision_note || '未记录'));
        assert.ok(text.includes(String(row.decided_by)));
      }
      for (const row of historyTruth.events) assert.ok((await historyPanel.locator('[data-formal-event="' + row.id + '"]').innerText()).includes(row.note));
      await noOverflow(); await page.screenshot({ path: path.join(output, 'formal-history.png'), fullPage: true });
      for (const status of [403, 409, 503]) {
        await page.route('**' + historyPath, route => route.fulfill({ status, json: { error: 'synthetic history fault' } }), { times: 1 });
        await button('读取或刷新正式历史').click(); await historyPanel.getByText('正式历史暂不可用', { exact: true }).waitFor();
        assert.equal(await historyPanel.locator('[data-formal-review]').count(), 0); await loadHistory();
      }
      await page.route('**' + historyPath, route => route.abort(), { times: 1 });
      await button('读取或刷新正式历史').click(); await historyPanel.getByText('正式历史暂不可用', { exact: true }).waitFor(); await loadHistory();
      await page.route('**' + historyPath, route => route.fulfill({ json: { ...historyTruth, draft: { ...historyTruth.draft, id: 999999 } } }), { times: 1 });
      await button('读取或刷新正式历史').click(); await historyPanel.getByText('正式历史暂不可用', { exact: true }).waitFor();
      assert.equal(await historyPanel.locator('[data-formal-review]').count(), 0); await loadHistory();
      assert.deepEqual(writes, []); page.off('request', trackWrites);
      assert.equal((await request('outsider', historyPath, 'GET')).status, 403);
      assert.deepEqual((await expect('lead', historyPath, 'GET')).reviewTasks, historyTruth.reviewTasks);
      checks.push('formal history matches real API revision/digest/actor/note; read-only; cross-department denied; faults clear stale history and retry; mismatched response rejected');
      await page.reload(); await idle(); await loadHistory();
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle(); await loadHistory();
      let releaseHistory, startedHistory;
      const historyHeld = new Promise(r => { releaseHistory = r; }); const historyReceived = new Promise(r => { startedHistory = r; });
      await page.route('**' + historyPath, async route => { startedHistory(); await historyHeld; await route.fulfill({ json: historyTruth }).catch(() => {}); }, { times: 1 });
      await button('读取或刷新正式历史').click(); await historyReceived; await select(''); releaseHistory();
      assert.equal(await historyPanel.count(), 0); await select(first.id);
      assert.equal(await historyPanel.locator('[data-formal-review]').count(), 0); await loadHistory();
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('读取或刷新正式历史').click(); await page.locator('#login-name').waitFor();
      assert.equal(await historyPanel.count(), 0); await login('outsider'); await idle();
      assert.equal(await historyPanel.count(), 0); await as('lead'); await select(first.id); await loadHistory();
      checks.push('formal history refresh/back, cancelled late response, real session expiry and cross-identity isolation');
      await button('核对正式草稿正文').click(); await page.locator('[data-formal-content-result]').waitFor();
      await page.reload(); await idle();
      assert.equal(await page.locator('[data-formal-content-result]').count(), 0);
      await button('核对正式草稿正文').click(); await page.locator('[data-formal-content-result]').waitFor();
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle();
      let releaseContent, startedContent;
      const contentHeld = new Promise(r => { releaseContent = r; }); const contentReceived = new Promise(r => { startedContent = r; });
      const lateContent = await expect('lead', historyPath + '/content', 'GET');
      let cancelledDownloads = 0; const countDownload = () => cancelledDownloads++;
      page.on('download', countDownload);
      await page.route('**' + historyPath + '/export', async route => { startedContent(); await contentHeld; await route.fulfill({ json: lateContent.document }).catch(() => {}); }, { times: 1 });
      await button('下载正式草稿 JSON').click(); await contentReceived; await select(''); releaseContent();
      await select(first.id); await button('核对正式草稿正文').click(); await page.locator('[data-formal-content-result]').waitFor();
      assert.equal(cancelledDownloads, 0, 'leaving during export cannot trigger a late download'); page.off('download', countDownload);
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('下载正式草稿 JSON').click(); await page.locator('#login-name').waitFor();
      assert.equal(await page.locator('[data-formal-content]').count(), 0); await login('outsider'); await idle();
      assert.equal(await page.locator('[data-formal-content]').count(), 0);
      checks.push('draft content refresh/back, cancelled late export, real 401 and cross-identity data isolation');
      const legacy = await readyCase('formal_v7', 'process-governance-v7'); await as('lead'); await select(legacy.id);
      await button('提升当前修订').click(); await page.getByLabel('正式承接方式', { exact: true }).selectOption('create'); await page.getByLabel('新主档制度编号', { exact: true }).fill('P21-V7'); await page.getByLabel('新主档制度名称', { exact: true }).fill('历史V7兼容'); await commit();
      const legacyDetail = await read(legacy.id); assert.equal(legacyDetail.formal_promotion.draft.schema_version, 'process-governance-v7');
      await checkDraftContent(legacyDetail.formal_promotion.draft, legacy.doc);
      // No published version is invented for an unpublished native V7 draft.
      await button('读取或刷新已发布版本列表').click();
      await page.getByText('该主档尚无可查阅的原生 V7/V8 已发布版本。', { exact: true }).waitFor();
      // A separate synthetic case avoids reusing the deliberately rejected/locked draft.
      const historyCase = await readyCase('published_history_v8');
      let revisedFormal;
      for (let round = 0; round < 2; round++) {
        let source = await read(historyCase.id);
        if (round) {
          const nextDocument = structuredClone(historyCase.doc); nextDocument.process.purpose += ' 第二正式版本';
          const nextSource = await expect('contact', root + '/cases/' + historyCase.id + '/revisions', 'POST', { ...binding(source.case), document: nextDocument, source_file_name: 'published-history-revision.json' }, 201);
          for (const who of ['reviewA', 'reviewB']) for (const item of nextSource.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...binding(nextSource.case), decision: 'confirmed', basis: '历史版本新修订核对' });
          source = await read(historyCase.id);
        }
        const target = round ? { mode: 'existing', document_id: revisedFormal.document.id } : { mode: 'create', document_no: 'P21-PUBLISHED-HISTORY', document_title: '合成历史版本制度' };
        await expect('lead', root + '/cases/' + historyCase.id + '/promote', 'POST', { ...binding(source.case), target }, 201);
        revisedFormal = (await read(historyCase.id)).formal_promotion;
        await expect('contact', '/api/process-design/drafts/' + revisedFormal.draft.id + '/submit', 'POST', { expected_revision_no: revisedFormal.draft.revision_no, expected_content_hash: revisedFormal.draft.content_hash });
        revisedFormal = (await read(historyCase.id)).formal_promotion;
        await expect('reviewA', '/api/process-design/review-tasks/' + revisedFormal.review_task.id + '/decision', 'POST', { expected_revision_no: revisedFormal.review_task.draft_revision_no, expected_content_hash: revisedFormal.review_task.content_hash, decision: 'approve', note: '合成历史版本验证' });
        await expect('lead', '/api/process-design/drafts/' + revisedFormal.draft.id + '/publish', 'POST', { expected_revision_no: revisedFormal.draft.revision_no, expected_content_hash: revisedFormal.draft.content_hash });
      }
      await refresh(); await select(historyCase.id);
      const publishedPanel = page.locator('[data-published-history]');
      const versionSelect = page.getByLabel('已发布历史版本', { exact: true });
      const listPath = '/api/process-design/drafts/' + revisedFormal.draft.id;
      const publishedTruth = await expect('lead', listPath, 'GET');
      const listPublished = async () => { await button('读取或刷新已发布版本列表').click(); await versionSelect.waitFor(); };
      const readPublished = async () => { await button('核对所选历史正文').click(); await publishedPanel.locator('[data-published-history-result]').waitFor(); };
      const historyWrites = []; const trackHistory = r => { if (r.method() !== 'GET') historyWrites.push(r.url()); }; page.on('request', trackHistory);
      await button('读取或刷新已发布版本列表').focus(); await page.keyboard.press('Enter'); await versionSelect.waitFor();
      assert.equal(await versionSelect.inputValue(), '');
      assert.equal(await versionSelect.locator('option').count(), publishedTruth.versions.length + 1);
      assert.equal(publishedTruth.versions.length, 2);
      assert.ok(publishedTruth.versions.some(v => v.status === 'superseded'));
      for (const item of publishedTruth.versions) {
        await versionSelect.selectOption(String(item.id)); await readPublished();
        const native = await expect('lead', '/api/process-design/versions/' + item.id + '/content', 'GET');
        await publishedPanel.getByText('所选历史版本原生正文', { exact: true }).click();
        assert.deepEqual(JSON.parse(await publishedPanel.locator('pre').innerText()), native.document);
        const waiting = page.waitForEvent('download'); await button('下载所选历史程序文件').click(); const downloaded = await waiting;
        const dest = path.join(output, downloaded.suggestedFilename()); await downloaded.saveAs(dest);
        const markdown = await expect('lead', '/api/process-design/versions/' + item.id + '/procedure-markdown', 'GET');
        assert.equal(fs.readFileSync(dest, 'utf8'), markdown.markdown);
        assert.equal((await request('outsider', '/api/process-design/versions/' + item.id + '/content', 'GET')).status, 403);
        for (const [mode, name] of [['process', '查阅所选版本流程图'], ['data', '查阅所选版本数据关系图']]) {
          const link = publishedPanel.getByRole('link', { name, exact: true });
          assert.equal(await link.getAttribute('href'), '/app/data-map?diagramVersion=' + item.id + '&diagramMode=' + mode);
          const opened = page.waitForEvent('popup'); await link.click(); const diagramPage = await opened;
          try {
            await diagramPage.locator('[data-diagram-state="ready"]').waitFor();
            assert.ok((await diagramPage.locator('[data-diagram-source]').innerText()).includes('正式版本 ' + item.id));
            assert.equal(await diagramPage.getByLabel('图形视图', { exact: true }).inputValue(), mode);
            assert.equal(await diagramPage.evaluate(() => window.opener), null);
          } finally { await diagramPage.close(); }
          assert.equal(await versionSelect.inputValue(), String(item.id));
        }
      }
      checks.push('selected current/historical version links open both diagram modes in isolated tabs with no opener');
      await noOverflow(); await publishedPanel.screenshot({ path: path.join(output, 'published-history.png') });
      const selectedVersion = publishedTruth.versions[1]; const versionPath = '/api/process-design/versions/' + selectedVersion.id;
      await versionSelect.selectOption(String(selectedVersion.id));
      const versionTruth = await expect('lead', versionPath + '/content', 'GET');
      const failedPublished = async () => { await publishedPanel.getByText('已发布版本暂不可用', { exact: true }).waitFor(); assert.equal(await publishedPanel.locator('[data-published-history-result]').count(), 0); };
      for (const status of [403,409,503]) {
        await page.route('**' + versionPath + '/content', r => r.fulfill({ status, json: { error: 'synthetic version fault' } }), { times: 1 });
        await button('核对所选历史正文').click(); await failedPublished(); await readPublished();
      }
      await page.route('**' + versionPath + '/content', r => r.abort(), { times: 1 });
      await button('核对所选历史正文').click(); await failedPublished(); await readPublished();
      for (const mismatch of [{ process_version_id: 99999 }, { document_id: 99999 }, { content_hash: '0'.repeat(64) }]) {
        await page.route('**' + versionPath + '/content', r => r.fulfill({ json: { ...versionTruth, ...mismatch } }), { times: 1 });
        await button('核对所选历史正文').click(); await failedPublished();
      }
      let badDownloads = 0; const trackDownload = () => badDownloads++; page.on('download', trackDownload);
      await page.route('**' + versionPath + '/procedure-markdown', r => r.fulfill({ json: { process_version_id: 99999, content_hash: versionTruth.content_hash, markdown: 'wrong' } }), { times: 1 });
      await button('下载所选历史程序文件').click(); await failedPublished();
      let finishVersion, versionStarted;
      const versionHeld = new Promise(r => { finishVersion = r; }), versionArrived = new Promise(r => { versionStarted = r; });
      await page.route('**' + versionPath + '/procedure-markdown', async r => { const response = await r.fetch(); versionStarted(); await versionHeld; await r.fulfill({ response }).catch(() => {}); }, { times: 1 });
      await button('下载所选历史程序文件').click(); await versionArrived;
      await versionSelect.selectOption(String(publishedTruth.versions[0].id)); finishVersion(); await readPublished();
      assert.equal(badDownloads, 0); page.off('download', trackDownload);
      await page.route('**' + listPath, r => r.fulfill({ json: { ...publishedTruth, versions: [{ ...selectedVersion, document_id: 99999 }] } }), { times: 1 });
      await button('读取或刷新已发布版本列表').click(); await failedPublished(); assert.equal(await versionSelect.count(), 0); await listPublished();
      await page.reload(); await idle(); assert.equal(await versionSelect.count(), 0); await listPublished();
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle(); await listPublished();
      assert.deepEqual(historyWrites, []); page.off('request', trackHistory);
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('读取或刷新已发布版本列表').click(); await page.locator('#login-name').waitFor();
      assert.equal(await publishedPanel.count(), 0); await login('outsider'); await idle();
      assert.equal(await publishedPanel.count(), 0); await as('lead');
      checks.push('published/superseded native V8 history and markdown match real APIs; explicit selection, empty V7, read-only, scope, keyboard, refresh/back, errors/mismatch rejection and late download cancellation');
      // Cross-draft reads use the existing master and retained audit rows; synthetic copies
      // below exercise pagination and scope only, not invented historical business evidence.
      await select(historyCase.id);
      const masterPath = '/api/process-design/drafts/' + revisedFormal.draft.id + '/document-drafts';
      const baselineMaster = await expect('lead', masterPath, 'GET');
      assert.equal(baselineMaster.items.length, 2, 'both published drafts remain discoverable');
      assert.equal(baselineMaster.next_cursor, null);
      const olderDraft = baselineMaster.items.find(row => row.id !== String(revisedFormal.draft.id));
      const olderTruth = await expect('lead', '/api/process-design/drafts/' + olderDraft.id, 'GET');
      const clones = [];
      for (let index = 0; index < 23; index++) {
        const [result] = await pool.execute(`INSERT INTO process_design_drafts
          (document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,
           department_id,schema_version,process_content_json,content_hash,revision_no,status)
          SELECT document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,
                 ?,?,process_content_json,content_hash,revision_no,?
          FROM process_design_drafts WHERE id=?`, [index === 22 ? 92 : 91,
          index === 21 ? 'process-governance-v3' : 'process-governance-v8',
          index % 2 ? 'rejected' : 'needs_changes', revisedFormal.draft.id]);
        clones.push(String(result.insertId));
      }
      const contactPage = await expect('contact', masterPath, 'GET');
      assert.equal(contactPage.items.length, 20); assert.ok(contactPage.next_cursor);
      assert.ok(contactPage.items.every(row => row.department_id === '91'));
      assert.ok(contactPage.items.some(row => row.status === 'rejected'));
      const contactTail = await expect('contact', masterPath + '?before_id=' + contactPage.next_cursor, 'GET');
      assert.equal(contactTail.next_cursor, null);
      const visibleIds = [...contactPage.items, ...contactTail.items].map(row => row.id);
      assert.equal(visibleIds.length, 23); assert.equal(new Set(visibleIds).size, 23);
      assert.ok(!visibleIds.includes(clones[21]) && !visibleIds.includes(clones[22]));
      const globalPage = await expect('adminMulti', masterPath, 'GET');
      assert.ok(globalPage.items.some(row => row.id === clones[22]), 'global read retains admin read-only visibility');
      assert.equal((await request('outsider', masterPath, 'GET')).status, 403);
      assert.equal((await fetch(fixture.baseURL + masterPath)).status, 401);
      assert.equal((await request('lead', '/api/process-design/drafts/' + clones[21] + '/document-drafts', 'GET')).status, 410);
      for (const cursor of ['0', '-1', '1.5', '1e2', '9223372036854775808', 'x']) {
        assert.equal((await request('lead', masterPath + '?before_id=' + cursor, 'GET')).status, 400);
      }
      assert.equal((await expect('lead', masterPath + '?before_id=1', 'GET')).items.length, 0);
      const masterPanel = page.locator('[data-document-history]');
      const masterButton = name => masterPanel.getByRole('button', { name, exact: true });
      const masterSelect = masterPanel.getByLabel('选择历史草稿', { exact: true });
      const readMaster = async () => { await masterButton('读取或刷新主档草稿列表').click(); await masterSelect.waitFor(); };
      const crossWrites = []; const trackCross = req => { if (req.method() !== 'GET') crossWrites.push(req.url()); }; page.on('request', trackCross);
      await readMaster(); assert.equal(await masterSelect.locator('option').count(), 21);
      await masterButton('读取更早草稿').click(); await masterPanel.getByText(/已到当前可见范围的末页/).waitFor();
      await masterSelect.selectOption(olderDraft.id);
      await masterButton('读取或刷新正式历史').click();
      await masterPanel.locator('[data-formal-review]').first().waitFor();
      assert.equal(await masterPanel.locator('[data-formal-review]').count(), olderTruth.reviewTasks.length);
      assert.equal(await masterPanel.locator('[data-formal-event]').count(), olderTruth.events.length);
      await noOverflow(); await masterPanel.screenshot({ path: path.join(output, 'cross-draft-history.png') });
      await masterButton('返回最新草稿').click(); await masterSelect.waitFor();
      assert.equal(await masterPanel.locator('[data-formal-history]').count(), 0);
      for (const status of [403, 409, 503]) {
        await page.route('**' + masterPath, r => r.fulfill({ status, json: { error: 'synthetic master history fault' } }), { times: 1 });
        await masterButton('读取或刷新主档草稿列表').click();
        await masterPanel.getByText('主档草稿历史暂不可用', { exact: true }).waitFor();
        assert.equal(await masterSelect.count(), 0);
        await masterButton('重试本页草稿').click(); await masterSelect.waitFor();
      }
      await page.route('**' + masterPath, r => r.fulfill({ json: { ...baselineMaster, document_id: '999999' } }), { times: 1 });
      await masterButton('读取或刷新主档草稿列表').click();
      await masterPanel.getByText('主档草稿历史暂不可用', { exact: true }).waitFor(); await readMaster();
      let releaseMaster, receivedMaster;
      const masterHeld = new Promise(resolve => { releaseMaster = resolve; });
      const masterReceived = new Promise(resolve => { receivedMaster = resolve; });
      await page.route('**' + masterPath, async r => { receivedMaster(); await masterHeld; await r.continue().catch(() => {}); }, { times: 1 });
      await masterButton('读取或刷新主档草稿列表').click(); await masterReceived;
      await select(legacy.id); releaseMaster(); assert.equal(await masterSelect.count(), 0);
      assert.deepEqual(crossWrites, []); page.off('request', trackCross);
      // Read while editing must not apply or discard the adjacent review note.
      await as('contact'); await button('提交正式审核').click(); await commit(); await as('reviewA');
      await button('办理正式审核').click(); await page.getByLabel('正式审核意见', { exact: true }).fill('跨草稿查阅保留的未提交意见');
      await readMaster(); await masterSelect.selectOption(String(legacyDetail.formal_promotion.draft.id));
      await masterButton('读取或刷新正式历史').click(); await masterPanel.locator('h4').first().waitFor();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).inputValue(), '跨草稿查阅保留的未提交意见');
      await discard(); await refresh();
      checks.push('cross-draft real MySQL pagination and current scope; old schemas excluded; global read-only; 401/403/400/410; retained audits, desktop, errors, mismatch, late response and unsaved input');
      await select(legacy.id);
      await button('办理正式审核').click();
      await page.getByLabel('正式审核意见', { exact: true }).fill('只能原身份看到的输入');
      await page.evaluate(async () => { const t = await (await fetch('/api/csrf-token')).json(); await fetch('/api/org/logout', { method: 'POST', headers: { 'X-CSRF-Token': t.csrfToken } }); });
      await button('刷新正式办理状态').click(); await page.locator('#login-name').waitFor(); await login('adminMulti'); await idle();
      assert.equal(await page.getByLabel('正式审核意见', { exact: true }).count(), 0); assert.equal(await button('办理正式审核').count(), 0); assert.equal(await button('提升当前修订').count(), 0);
      task = (await read(legacy.id)).formal_promotion.review_task;
      assert.equal((await request('adminMulti', '/api/process-design/review-tasks/' + task.id + '/decision', 'POST', { expected_revision_no: task.draft_revision_no, expected_content_hash: task.content_hash, decision: 'approve', note: '无权' })).status, 403);
      assert.equal((await request('outsider', '/api/process-design/drafts/' + legacyDetail.formal_promotion.draft.id, 'GET')).status, 403);
      await as('outsider'); await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('heading', { name: legacy.doc.process.process_name, exact: true }).count(), 0);
      checks.push('V7 remains native; cross-identity draft cleared; administrator multi-role and unrelated department denied');
      await as('reviewA'); await button('办理正式审核').click(); await page.getByLabel('正式审核结论', { exact: true }).selectOption('approve'); await page.getByLabel('正式审核意见', { exact: true }).fill('既有V7仍可原生审核发布'); await commit();
      await as('lead'); await button('发布正式版本').click(); await commit();
      const legacyVersion = (await read(legacy.id)).formal_promotion.current_version;
      await loadHistory();
      const legacyHistory = await expect('lead', '/api/process-design/drafts/' + legacyDetail.formal_promotion.draft.id, 'GET');
      assert.equal(await historyPanel.locator('[data-formal-review]').count(), legacyHistory.reviewTasks.length);
      assert.equal(await historyPanel.locator('[data-formal-event]').count(), legacyHistory.events.length);
      assert.deepEqual((await expect('lead', '/api/process-design/versions/' + legacyVersion.id + '/content', 'GET')).document, legacy.doc);
      await listPublished(); await versionSelect.selectOption(String(legacyVersion.id));
      for (const name of ['查阅所选版本流程图', '查阅所选版本数据关系图']) {
        const opened = page.waitForEvent('popup'); await publishedPanel.getByRole('link', { name, exact: true }).click();
        const diagramPage = await opened;
        try {
          await diagramPage.locator('[data-diagram-state="ready"]').waitFor();
          assert.ok((await diagramPage.locator('[data-diagram-source]').innerText()).includes('正式版本 ' + legacyVersion.id));
          if (name.includes('数据关系')) await diagramPage.getByText('当前流程没有数据对象，无法绘制数据关系。', { exact: true }).waitFor();
        } finally { await diagramPage.close(); }
      }
      checks.push('real published native V7 independent graph links and empty-data state');
      checks.push('native V7 full lifecycle completes; current department gate denies promotion/submit/publish and stale source binding');
      let release, started; const held = new Promise(r => { release = r; }); const received = new Promise(r => { started = r; });
      await page.route('**/api/process-v7-preview/cases/' + legacy.id, async route => { started(); await held; await route.continue().catch(() => {}); }, { times: 1 });
      await button('刷新正式办理状态').click(); await received; await page.getByRole('link', { name: '当前身份', exact: true }).click(); release();
      await page.getByRole('link', { name: '流程正式流转', exact: true }).click(); await idle();
      assert.equal(await page.getByRole('heading', { name: legacy.doc.process.process_name, exact: true }).count(), 0);
      checks.push('late response after navigation cannot restore prior case');
      assert.deepEqual(pageErrors, []); assert.ok(consoleErrors.every(e => /Failed to load resource|net::ERR_FAILED/.test(e)));
      const [versions] = await pool.execute('SELECT id,schema_version,status,content_hash FROM process_design_versions');
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, consoleErrors, failures, versions, note: 'Owned isolated API/browser evidence; injected HTTP failures listed separately; no production or manual acceptance.' }, null, 2));
    } catch (e) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: e.message, stack: e.stack, checks, pageErrors, failures }, null, 2)); throw e;
    } finally { await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
