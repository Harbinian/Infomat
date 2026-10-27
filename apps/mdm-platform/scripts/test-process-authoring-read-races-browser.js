// Targeted Edge regression for delayed authoring reads/templates and old null
// material scope. Input: --frontend-dist <artifacts build>, --output <new artifacts
// directory>. Owns a fresh labelled tmpfs MySQL and random loopback HTTP only.
// Uses synthetic identities/documents, controlled delayed browser responses and
// screenshots; no private env, external AI or existing service/database access.
// --query-race-only narrows execution to same-component URL changes and recovery.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withProcessAuthoringCandidate, syntheticSubmission } = require('./serve-process-authoring-candidate');
require('./testHelpers/ownedBrowserRuntime');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
function argument(name) { const at = process.argv.indexOf(name); assert(at > 0 && process.argv[at + 1]); return path.resolve(process.argv[at + 1]); }
const root = '/api/process-authoring';
async function main() {
  const frontendDist = argument('--frontend-dist'), output = argument('--output');
  await withProcessAuthoringCandidate(async ({ fixture, expect }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(20000);
    const checks = [], pageErrors = [], consoleErrors = [], dialogs = [], externalRequests = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('dialog', dialog => { dialogs.push(dialog.message()); dialog.accept(); });
    context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== fixture.baseURL) externalRequests.push(request.url()); });
    const button = name => page.getByRole('button', { name, exact: true });
    async function idle() { await page.locator('[data-process-authoring]').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '刷新草稿列表')?.disabled); }
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function pause(url, body) {
      let release, received, finished;
      const held = new Promise(resolve => { release = resolve; }), seen = new Promise(resolve => { received = resolve; }), handled = new Promise(resolve => { finished = resolve; });
      await page.route(url, async route => {
        received(); await held;
        try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }); }
        catch { /* Aborted requests cannot alter the application after navigation. */ }
        finally { finished(); }
      }, { times: 1 });
      return { seen, release: async () => { release(); await handled; await page.waitForTimeout(300); } };
    }
    async function identity() { await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.waitForURL('**/app/identity'); }
    async function authoring() { await page.getByRole('link', { name: '流程编制与草稿', exact: true }).click(); await idle(); }
    async function shot(name) {
      assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale })), { width: 1699, height: 828, scale: 1 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    }
    try {
      const firstDocument = structuredClone(fixture.document); firstDocument.process.process_name = '迟到读取期间保留的合成草稿'; firstDocument.process.process_ref += '_read_a'; firstDocument.export_meta.package_ref += '_read_a';
      const firstSubmission = syntheticSubmission(); firstSubmission.participants = null;
      const first = (await expect('contact', root + '/drafts', 'POST', { request_id: crypto.randomUUID(), document: firstDocument, submission: firstSubmission }, 201)).draft;
      const nextDocument = structuredClone(fixture.document); nextDocument.process.process_name = '被延迟读取的另一合成草稿'; nextDocument.process.process_ref += '_read_b'; nextDocument.export_meta.package_ref += '_read_b';
      const next = (await expect('contact', root + '/drafts', 'POST', { request_id: crypto.randomUUID(), document: nextDocument, submission: syntheticSubmission() }, 201)).draft;
      const nextResponse = await expect('contact', root + '/drafts/' + next.id, 'GET');
      await page.goto(fixture.baseURL + '/app/process-authoring?draft=' + first.id); await login('contact'); await idle(); await page.locator('.workbench-shell').waitFor();
      if (process.argv.includes('--query-race-only')) {
        const changedQuery = async marker => page.evaluate(marker => {
          const target = new URL(location.href); target.searchParams.set('query_race', marker);
          history.replaceState(history.state, '', target.pathname + target.search);
          window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
        }, marker);
        const readInSameView = await pause('**/api/process-authoring/drafts/' + next.id, nextResponse);
        await page.getByLabel('选择已保存编制草稿', { exact: true }).selectOption(next.id); await readInSameView.seen;
        await changedQuery('read'); await readInSameView.release();
        assert.equal(new URL(page.url()).searchParams.get('query_race'), 'read');
        await idle(); assert.equal(await button('新建编制草稿').isEnabled(), true);
        await page.locator('.process-title').getByText(firstDocument.process.process_name, { exact: true }).waitFor();
        await page.getByLabel('选择已保存编制草稿', { exact: true }).selectOption(next.id); await idle();
        await page.locator('.process-title').getByText(nextDocument.process.process_name, { exact: true }).waitFor();
        const savedAfterRead = page.waitForResponse(response => response.url().endsWith('/drafts/' + next.id) && response.request().method() === 'PUT');
        await button('保存草稿').click(); assert.equal((await savedAfterRead).status(), 200); await idle();
        await shot('01-same-view-read-recovered');
        checks.push('same-component query change rejects delayed read while releasing only its own busy/lock; a subsequent different-draft read and save succeed');
        const templateResponse = await expect('contact', root + '/editor/template', 'GET');
        const templateInSameView = await pause('**/api/process-authoring/editor/template', templateResponse);
        await button('新建编制草稿').click(); await templateInSameView.seen;
        await changedQuery('template'); await templateInSameView.release();
        assert.equal(new URL(page.url()).searchParams.get('query_race'), 'template');
        await idle(); assert.equal(await button('新建编制草稿').isEnabled(), true);
        await page.locator('.process-title').getByText(nextDocument.process.process_name, { exact: true }).waitFor();
        await button('新建编制草稿').click(); await idle();
        await page.locator('.process-title').getByText('未命名流程', { exact: true }).waitFor();
        await shot('02-same-view-template-recovered');
        checks.push('same-component query change rejects delayed template and restores buttons; the next explicit new-workspace operation succeeds');
        assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(externalRequests, []);
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, pageErrors, consoleErrors, externalRequests,
          browser: { channel: 'msedge', version: browser.version(), viewport: { width: 1699, height: 828 }, zoom: 1 },
          frontend_dist: frontendDist, synthetic_only: true, formal_services_changed: false, business_accepted: false }, null, 2) + '\n');
        console.log('PROCESS_AUTHORING_QUERY_RACES_BROWSER_PASS ' + checks.length); return;
      }
      await button('编辑提交材料').click(); await page.getByText('尚未明确参与部门，不能据此确认无需跨部门核对。', { exact: true }).waitFor();
      await button('收起提交材料').click(); assert.deepEqual(pageErrors, []); checks.push('legacy participants:null renders as unresolved scope without inventing department facts');
      await page.locator('.process-title').click(); await button('编辑本对象').click();
      const localPurpose = '暂离与迟到读取后仍保留的合成本地输入。';
      await page.getByLabel('目的', { exact: true }).fill(localPurpose); await button('应用本对象修改').click();
      await page.waitForFunction(() => document.querySelector('button[aria-label="应用本对象修改"]')?.disabled === true && !document.querySelector('.busy-strip'));
      const delayedRead = await pause('**/api/process-authoring/drafts/' + next.id, nextResponse);
      await page.getByLabel('选择已保存编制草稿', { exact: true }).selectOption(next.id); await delayedRead.seen;
      await identity(); await delayedRead.release(); assert.equal(new URL(page.url()).pathname, '/app/identity');
      await authoring(); await page.locator('.process-title').getByText(firstDocument.process.process_name, { exact: true }).waitFor();
      assert.equal(await page.getByLabel('选择已保存编制草稿', { exact: true }).inputValue(), first.id);
      const downloadEvent = page.waitForEvent('download'); await button('下载JSON草稿').click(); const downloaded = await downloadEvent;
      const recoveryFile = path.join(output, 'late-read-local-recovery.json'); await downloaded.saveAs(recoveryFile);
      assert.equal(JSON.parse(fs.readFileSync(recoveryFile, 'utf8')).process.purpose, localPurpose);
      await page.locator('.ant-drawer-open .ant-drawer-close').click(); await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
      const saveResponse = page.waitForResponse(response => response.url().endsWith('/drafts/' + first.id) && response.request().method() === 'PUT');
      await button('保存草稿').click(); assert.equal((await saveResponse).status(), 200); await idle();
      assert.equal((await expect('contact', root + '/drafts/' + first.id, 'GET')).draft.document.process.purpose, localPurpose);
      assert.equal((await expect('contact', root + '/drafts/' + first.id, 'GET')).draft.submission.participants, null);
      assert.equal((await expect('contact', root + '/drafts/' + next.id, 'GET')).draft.document.process.purpose, nextDocument.process.purpose);
      await shot('01-read-race-local-input-restored');
      checks.push('delayed saved-draft read after navigation cannot rewrite URL or replace original owner/input; retained input saves to its original draft');

      const timestampEdited = JSON.parse(fs.readFileSync(recoveryFile, 'utf8'));
      timestampEdited.export_meta.exported_at = new Date(Date.now() + 1000).toISOString();
      await page.getByLabel('上传JSON草稿', { exact: true }).setInputFiles({ name: 'synthetic-export-time-edited.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(timestampEdited)) });
      await page.locator('.authoring-savebar').getByText('正文有未保存修改', { exact: false }).waitFor();
      const timestampSave = page.waitForResponse(response => response.url().endsWith('/drafts/' + first.id) && response.request().method() === 'PUT');
      await button('保存草稿').click(); assert.equal((await timestampSave).status(), 200); await idle();
      assert.equal((await expect('contact', root + '/drafts/' + first.id, 'GET')).draft.document.export_meta.exported_at, timestampEdited.export_meta.exported_at);
      checks.push('JSON changed only in exported_at is visibly unsaved and persists the exact imported timestamp after explicit save');

      await page.goto(fixture.baseURL + '/app/process-authoring'); await idle();
      const template = await expect('contact', root + '/editor/template', 'GET');
      const delayedTemplate = await pause('**/api/process-authoring/editor/template', template);
      await button('新建编制草稿').click(); await delayedTemplate.seen;
      await identity(); await delayedTemplate.release(); assert.equal(new URL(page.url()).pathname, '/app/identity');
      await authoring(); assert.equal(await page.locator('.workbench-shell').count(), 0);
      checks.push('delayed template completion after leaving cannot create a hidden workspace or pull URL back to authoring');

      const delayedIdentityRead = await pause('**/api/process-authoring/drafts/' + next.id, nextResponse);
      await page.getByLabel('选择已保存编制草稿', { exact: true }).selectOption(next.id); await delayedIdentityRead.seen;
      await button('退出登录').click(); await login('adminMulti'); await delayedIdentityRead.release(); await idle();
      assert.equal(new URL(page.url()).searchParams.get('draft'), null);
      assert.equal(await page.locator('.workbench-shell').count(), 0);
      checks.push('a delayed prior-account read cannot mount its editor or rewrite the new identity route after logout/login');

      const caseDetail = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: nextDocument, submission: syntheticSubmission(), source_file_name: 'synthetic-read-races.json' }, 201);
      await page.goto(fixture.baseURL + '/app/process-preview?case=' + caseDetail.case.id);
      await button('刷新案例与当前修订').waitFor();
      await page.waitForFunction(() => !document.querySelector('.process-preview .status-loading'));
      await page.getByText('阅读本次提交材料', { exact: false }).waitFor();
      await page.getByText('检查3000内编制、保存、JSON对话编辑与提交衔接。', { exact: true }).waitFor();
      await shot('02-stable-existing-review');
      assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
      assert(consoleErrors.every(message => /net::ERR_ABORTED|net::ERR_FAILED|Failed to fetch/.test(message)), 'no unexpected console errors: ' + JSON.stringify(consoleErrors));
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks, pageErrors, consoleErrors, dialogs, externalRequests,
        browser: { channel: 'msedge', version: browser.version(), viewport: { width: 1699, height: 828 }, zoom: 1 },
        frontend_dist: frontendDist, synthetic_only: true, formal_services_changed: false, business_accepted: false }, null, 2) + '\n');
      console.log('PROCESS_AUTHORING_READ_RACES_BROWSER_PASS ' + checks.length);
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, checks, pageErrors, consoleErrors, dialogs, externalRequests }, null, 2)); throw error;
    } finally { await browser.close(); }
  }, { frontendDist, evidenceDir: output });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
