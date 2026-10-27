// Targeted review-presentation regression. Input: --frontend-dist <artifacts
// build> and --output <new artifacts evidence directory>. Uses a fresh owned
// tmpfs MySQL, synthetic identities, random loopback HTTP and Edge at 100%,
// 1699x828 CSS pixels only. Writes screenshots/JSON evidence, creates synthetic
// drafts/revisions/decisions and removes only its own fixture at completion.
// Never reads private env, connects to an existing DB, or operates candidate
// 51647, formal 3000/3001, notifications or deployment. Shared disabled wording
// is checked statically; browser checks use the enabled isolated workspace.
// --workbench-only narrows the run to todo/all workbench presentation, history
// and a read-only department-contact role guide check.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withProcessAuthoringCandidate, syntheticSubmission } = require('./serve-process-authoring-candidate');
require('./testHelpers/ownedBrowserRuntime');

function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
function argument(name) { const at = process.argv.indexOf(name); assert(at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--'), name + ' is required'); return path.resolve(process.argv[at + 1]); }
const authoringRoot = '/api/process-authoring', previewRoot = '/api/process-v7-preview';
const caseBinding = row => ({ expected_revision_no: row.current_revision_no, expected_content_hash: row.current_content_hash });
const appRoot = path.resolve(__dirname, '..');

async function main() {
  const frontendDist = argument('--frontend-dist'), output = argument('--output');
  await withProcessAuthoringCandidate(async ({ fixture, expect, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1, locale: 'zh-CN' });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(20000);
    const checks = [], pageErrors = [], consoleErrors = [], externalRequests = [], httpErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== fixture.baseURL) externalRequests.push(request.url()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const readCase = id => expect('contact', previewRoot + '/cases/' + id, 'GET');
    async function login(who) { await page.locator('#login-name').fill('SYNTHETIC_' + who); await page.locator('#login-password').fill(fixture.loginPassword); await button('登录').click(); await button('退出登录').waitFor(); }
    async function authoringIdle() { await page.locator('[data-process-authoring]').waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '刷新草稿列表')?.disabled); }
    async function previewIdle() { await button('刷新案例与当前修订').waitFor(); await page.waitForFunction(() => !document.querySelector('.process-preview .status-loading') && ![...document.querySelectorAll('button')].find(button => button.textContent === '刷新案例与当前修订')?.disabled); }
    async function noOldInstruction() {
      const text = await page.locator('body').innerText();
      const legacy = text.split('\n').filter(line => /回\s*3001|在\s*3001\s*(?:完成|补充|修订|修改)|上传\s*3001/.test(line));
      assert.deepEqual(legacy, [], 'enabled page does not send the user back to 3001');
    }
    async function shot(name) {
      assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale })), { width: 1699, height: 828, scale: 1 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    }
    async function submitDraft(id) {
      const response = page.waitForResponse(response => response.url().endsWith('/drafts/' + id + '/submit'));
      await button('提交当前草稿及本次材料').click(); const result = await response; assert.equal(result.status(), 200); await authoringIdle(); return result.json();
    }
    async function originalRows(caseId, itemId, lastEventId) {
      const [revisions] = await pool.execute('SELECT * FROM process_v7_preview_revisions WHERE case_id=? AND revision_no=1', [caseId]);
      const [items] = await pool.execute('SELECT * FROM process_v7_preview_review_items WHERE id=?', [itemId]);
      const [events] = await pool.execute('SELECT * FROM process_v7_preview_events WHERE case_id=? AND id<=? ORDER BY id', [caseId, lastEventId]);
      // Creating a new revision legitimately clears is_current on the old item;
      // MySQL's ON UPDATE timestamp follows that technical flag change. Compare
      // the stored opinion, snapshot, identifiers and decision times exactly.
      return { revisions, items: items.map(({ is_current, updated_at, ...immutable }) => immutable), events };
    }
    try {
      const document = structuredClone(fixture.document); document.process.process_name = '重新提交提示合成检查流程';
      const initial = (await expect('contact', authoringRoot + '/drafts', 'POST', { request_id: crypto.randomUUID(), document, submission: syntheticSubmission() }, 201)).draft;
      await page.goto(fixture.baseURL + '/app/process-authoring?draft=' + initial.id); await login('contact'); await authoringIdle(); await page.locator('.workbench-shell').waitFor();
      const created = await submitDraft(initial.id), caseId = created.draft.case_id; assert.equal(caseId, 1);
      let detail = await readCase(caseId); assert.equal(detail.case.current_revision_no, 1); assert(detail.items.length);
      const firstItem = detail.items[0], oldBasis = '合成历史修改意见：请明确填写环节的完成说明，待负责人重新核对。';
      await expect('reviewA', previewRoot + '/items/' + firstItem.id + '/decision', 'POST', { ...caseBinding(detail.case), expected_dispute_event_id: detail.review_dispute_event_id || '0', decision: 'needs_changes', basis: oldBasis });
      detail = await readCase(caseId);
      const original = await originalRows(caseId, firstItem.id, Math.max(...detail.events.map(event => event.id)));
      const originalLastEventId = Math.max(...detail.events.map(event => event.id));
      const originalOpinion = detail.items.find(item => item.id === firstItem.id);
      assert.equal(originalOpinion.origin_status, 'needs_changes'); assert.equal(originalOpinion.origin_basis, oldBasis);
      checks.push('synthetic first revision receives an actual department needs-changes opinion with original immutable evidence captured');

      if (process.argv.includes('--workbench-only')) {
        let next = (await expect('contact', authoringRoot + '/drafts/from-case/' + caseId, 'POST', { request_id: crypto.randomUUID(), ...caseBinding(detail.case) }, 201)).draft;
        const changed = structuredClone(next.document); changed.behaviors[0].completion_standard += ' 合成工作台检查补充说明。';
        next = (await expect('contact', authoringRoot + '/drafts/' + next.id, 'PUT', {
          request_id: crypto.randomUUID(), expected_revision_no: next.revision_no, expected_content_hash: next.content_hash, document: changed, submission: next.submission
        })).draft;
        const waitMs = Math.max(0, Date.parse(originalOpinion.origin_decided_at) + 1100 - Date.now());
        if (waitMs) await page.waitForTimeout(waitMs);
        const posted = await expect('contact', authoringRoot + '/drafts/' + next.id + '/submit', 'POST', { request_id: crypto.randomUUID(), expected_revision_no: next.revision_no, expected_content_hash: next.content_hash });
        detail = posted.case_detail;
        const inherited = detail.items.find(item => item.carried_from_item_id === firstItem.id);
        assert(inherited); assert.equal(inherited.carry_state, 'carried_forward'); assert.equal(inherited.origin_basis, oldBasis);
        assert.equal(detail.case.status, 'needs_revision'); assert(Date.parse(inherited.origin_decided_at) < Date.parse(detail.revision.created_at));
        const returned = data => [...(data.workItems || []), ...(data.nextActions || [])].find(item => (item.type === 'v7_returned' || item.governanceType === 'v7_returned') && String(item.caseId) === String(caseId));
        const returnedRecords = data => {
          const workItem = returned(data);
          return { workItem, nextActions: (data.nextActions || []).filter(action => workItem && ['target', 'title', 'actionLabel', 'sample'].every(field => action[field] === workItem[field])) };
        };
        const raw = {};
        for (const mode of ['todo', 'all']) {
          const data = await expect('contact', '/api/role-workbench?mode=' + mode, 'GET'); raw[mode] = returnedRecords(data);
          assert(raw[mode].workItem, 'real workbench response contains the synthetic returned item in ' + mode);
          assert.equal(raw[mode].nextActions.length, 1, 'real server priority projection matches exactly one source row');
          assert(raw[mode].workItem.sample.includes('回3001'), 'fixture exercises the historical generated suffix before presentation');
          assert(raw[mode].workItem.sample.includes(oldBasis));
        }
        async function workbenchMode(mode, label, expectedBasis = oldBasis) {
          await button(mode === 'todo' ? '待办优先' : '全量职责').click();
          await page.locator('.role-workbench[data-ready="true"]').waitFor();
          await page.getByRole('link', { name: label, exact: true }).first().waitFor();
          const priority = page.locator('[data-next-action]').filter({ hasText: document.process.process_name }).filter({ hasText: label });
          await priority.waitFor(); assert((await priority.innerText()).includes(expectedBasis));
          assert((await priority.getByRole('link', { name: label, exact: true }).getAttribute('href')).includes('/app/process-preview?case=' + caseId));
          await priority.scrollIntoViewIfNeeded();
          if (mode === 'all') {
            const section = page.getByRole('heading', { name: '当前事项与办理指引', exact: true }).locator('..');
            const card = section.locator('article').filter({ hasText: document.process.process_name }).filter({ hasText: label });
            await card.waitFor(); assert((await card.innerText()).includes(expectedBasis));
            await card.scrollIntoViewIfNeeded();
          }
          await noOldInstruction();
        }
        await page.goto(fixture.baseURL + '/app/workbench');
        const awaitingLabel = '已提交，查看负责人重新核对进度';
        await workbenchMode('todo', awaitingLabel); await shot('workbench-01-todo-awaiting-recheck');
        await workbenchMode('all', awaitingLabel); await shot('workbench-02-all-awaiting-recheck');
        for (const mode of ['todo', 'all']) assert.deepEqual(returnedRecords(await expect('contact', '/api/role-workbench?mode=' + mode, 'GET')), raw[mode]);
        assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original);
        checks.push('real todo/all workbench views replace only the generated legacy instruction, preserve original basis and point to recheck progress while raw API records and history stay unchanged');
        const newBasis = '合成当前修订工作台意见：本次内容仍需明确。';
        await expect('reviewA', previewRoot + '/items/' + inherited.id + '/decision', 'POST', { ...caseBinding(detail.case), expected_dispute_event_id: detail.review_dispute_event_id || '0', decision: 'needs_changes', basis: newBasis });
        await page.reload();
        const currentLabel = '查看修改意见与当前修订';
        await workbenchMode('todo', currentLabel, newBasis); assert.equal(await page.getByRole('link', { name: awaitingLabel, exact: true }).count(), 0);
        await shot('workbench-03-todo-current-opinion');
        await workbenchMode('all', currentLabel, newBasis); assert.equal(await page.getByRole('link', { name: awaitingLabel, exact: true }).count(), 0);
        await shot('workbench-04-all-current-opinion');
        assert((await page.locator('body').innerText()).includes(newBasis));
        assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original);
        checks.push('a fresh current-revision negative opinion uses the neutral current-revision action in both workbench views without a misleading awaiting-recheck action');
        const roleModel = await expect('contact', '/api/rbac/model', 'GET');
        await page.goto(fixture.baseURL + '/app/role-guide?role=department_contact');
        await page.locator('[data-role-guide-state="ready"]').waitFor();
        const roleGuide = page.locator('[data-role-guide-code="department_contact"]');
        await roleGuide.getByText('在3000从原案例续修，保存并提交新修订后重新核对', { exact: false }).waitFor();
        assert((await roleGuide.innerText()).includes('在3000编制并保存未审核草稿，也可导入JSON草稿'));
        await noOldInstruction(); await roleGuide.scrollIntoViewIfNeeded(); await shot('workbench-05-role-guide');
        assert.deepEqual(await expect('contact', '/api/rbac/model', 'GET'), roleModel);
        assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original);
        checks.push('the read-only department-contact role guide shows the enabled 3000 authoring/revision instructions while the original RBAC model and case history remain exact');
        assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(httpErrors, []); assert.deepEqual(externalRequests, []);
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', mode: 'workbench-only', checks,
          browser: { channel: 'msedge', version: browser.version(), viewport: { width: 1699, height: 828 }, zoom: 1 },
          case_id: caseId, original_basis: oldBasis, current_basis: newBasis, original_history_unchanged: true, raw_returned_records_unchanged: true,
          raw_returned_records: raw,
          history_comparison_exclusions: ['review_item.is_current', 'review_item.updated_at changed by its existing ON UPDATE timestamp'],
          pageErrors, consoleErrors, httpErrors, externalRequests, frontend_dist: frontendDist,
          synthetic_only: true, existing_candidate_changed: false, formal_database_connected: false, business_accepted: false }, null, 2) + '\n');
        console.log('PROCESS_REVIEW_WORKBENCH_BROWSER_PASS ' + checks.length); return;
      }

      await page.getByRole('link', { name: '查看核对、退回原因及历史记录', exact: true }).click(); await previewIdle();
      await page.getByRole('link', { name: '在3000继续编制本案例', exact: true }).click(); await authoringIdle();
      await button('从原案例继续编制').click(); await authoringIdle();
      const revisionDraftId = new URL(page.url()).searchParams.get('draft'); assert(revisionDraftId && revisionDraftId !== initial.id);
      await page.getByText('对象清单', { exact: true }).click();
      await page.getByRole('button', { name: document.behaviors[0].behavior_name, exact: true }).click();
      await button('编辑本对象').click();
      await page.getByLabel('完成标准', { exact: true }).fill('合成记录已填写并核对，补充明确的填写完成说明。');
      await button('应用本对象修改').click();
      await page.waitForFunction(() => document.querySelector('button[aria-label="应用本对象修改"]')?.disabled === true && !document.querySelector('.busy-strip'));
      const savedResponse = page.waitForResponse(response => response.url().endsWith('/drafts/' + revisionDraftId) && response.request().method() === 'PUT');
      await button('保存草稿').click(); assert.equal((await savedResponse).status(), 200); await authoringIdle();
      // The real database has second-precision decision times. Wait only if
      // necessary so this positive inherited-opinion case has strict ordering.
      const timestampWaitMs = Math.max(0, Date.parse(originalOpinion.origin_decided_at) + 1100 - Date.now());
      if (timestampWaitMs) await page.waitForTimeout(timestampWaitMs);
      const resubmitted = await submitDraft(revisionDraftId);
      assert.equal(resubmitted.draft.case_id, caseId); assert.equal(resubmitted.case_detail.case.current_revision_no, 2);
      await page.getByText('已提交，待负责人重新核对。原核对意见和历史记录保留，请进入原案例查看本次修订。', { exact: true }).waitFor();
      await noOldInstruction(); await shot('01-authoring-resubmission-notice');
      detail = await readCase(caseId);
      const inherited = detail.items.find(item => item.behavior_ref === firstItem.behavior_ref && item.target_department_id === firstItem.target_department_id);
      assert(inherited); assert.equal(inherited.carry_state, 'carried_forward'); assert.equal(inherited.carried_from_item_id, firstItem.id);
      assert.equal(inherited.origin_status, 'needs_changes'); assert.equal(inherited.origin_basis, oldBasis); assert.equal(detail.case.status, 'needs_revision');
      assert(Date.parse(inherited.origin_decided_at) < Date.parse(detail.revision.created_at));
      assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original, 'original body, opinion and historical events remain unchanged');
      checks.push('UI resubmits a completion-standard edit to the same case; machine state and carried opinion stay intact while authoring notice reports waiting for recheck');

      await page.getByRole('link', { name: '查看核对、退回原因及历史记录', exact: true }).click(); await previewIdle();
      const selectedLabel = () => page.getByLabel('选择流程案例', { exact: true }).locator('option:checked').innerText();
      assert((await selectedLabel()).includes('已提交，待负责人重新核对'));
      await page.getByText('已提交，待负责人重新核对', { exact: true }).waitFor();
      await page.getByText('待负责人重新核对（原意见：需要修改）', { exact: false }).first().waitFor();
      await page.getByText(oldBasis, { exact: false }).first().waitFor(); await noOldInstruction(); await shot('02-carried-opinion-awaiting-recheck');
      await page.reload(); await previewIdle(); assert((await selectedLabel()).includes('已提交，待负责人重新核对'));
      await page.getByText('已提交，待负责人重新核对', { exact: true }).waitFor();
      await page.getByText(oldBasis, { exact: false }).first().waitFor();
      checks.push('case list, detail opinion, awaiting-recheck panel and full-page reload consistently distinguish inherited modification opinions');

      await page.getByText('办理说明', { exact: true }).click(); await noOldInstruction();
      await button('流程图').click(); await page.locator('.preview-canvas canvas').first().waitFor(); await noOldInstruction();
      await page.getByText('需要修改内容时，进入本案例的编制草稿，保存并提交新修订。', { exact: false }).waitFor();
      await button('责任与历史').click(); await page.locator('[data-process-checks]').waitFor(); await noOldInstruction();
      await page.locator('[data-process-checks]').getByText('在3000从原案例续修，保存并提交新修订后重新核对', { exact: false }).waitFor();
      await page.getByText('操作历史', { exact: true }).click();
      await page.locator('details').filter({ has: page.locator('summary').getByText('操作历史', { exact: true }) }).getByText(oldBasis, { exact: false }).waitFor();
      await shot('03-original-history-retained');
      assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original);
      await page.goto(fixture.baseURL + '/app/process-formal?case=' + caseId); await button('刷新正式办理状态').waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(button => button.textContent === '刷新正式办理状态')?.disabled);
      await noOldInstruction();
      checks.push('enabled preview diagrams/checks/history and formal page keep the 3000 revision path; original history rows are not rewritten by presentation');

      const currentBasis = '合成当前修订新意见：本次提交仍需补充当前事实。';
      await expect('reviewA', previewRoot + '/items/' + inherited.id + '/decision', 'POST', { ...caseBinding(detail.case), expected_dispute_event_id: detail.review_dispute_event_id || '0', decision: 'needs_changes', basis: currentBasis });
      await page.goto(fixture.baseURL + '/app/process-preview?case=' + caseId); await previewIdle();
      assert((await selectedLabel()).includes('当前修订需要修改')); assert(!(await selectedLabel()).includes('已提交，待负责人重新核对'));
      assert.equal(await page.getByText('已提交，待负责人重新核对', { exact: true }).count(), 0);
      assert.equal(await page.getByText('待负责人重新核对（原意见：需要修改）', { exact: false }).count(), 0);
      await page.getByText(currentBasis, { exact: false }).first().waitFor(); await noOldInstruction(); await shot('04-current-revision-new-opinion');
      const fresh = await readCase(caseId);
      assert(fresh.events.some(event => event.revision_id === fresh.revision.id && event.item_id === inherited.id && event.decision === 'needs_changes' && event.basis_text === currentBasis));
      assert.deepEqual(await originalRows(caseId, firstItem.id, originalLastEventId), original);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_v7_preview_cases'))[0][0].n, 1);
      checks.push('a fresh needs-changes decision on a carried item is shown as a current revision problem and never mislabeled waiting for recheck');

      const sharedFiles = ['ProcessChecks.jsx', 'CaseGovernance.jsx'];
      for (const file of sharedFiles) {
        const source = fs.readFileSync(path.join(appRoot, 'frontend/src', file), 'utf8');
        assert(source.includes('authoringEnabled = false')); assert(source.includes('完成修订后上传原案例'));
        assert(!/回\s*3001|在\s*3001/.test(source), file + ' disabled shared wording stays neutral');
      }
      checks.push('static disabled shared-component fallbacks say to complete revision and upload the original case without requiring 3001');
      assert.deepEqual(pageErrors, []); assert.deepEqual(consoleErrors, []); assert.deepEqual(externalRequests, []); assert.deepEqual(httpErrors, []);
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', checks,
        browser: { channel: 'msedge', version: browser.version(), viewport: { width: 1699, height: 828 }, zoom: 1 },
        case_id: caseId, original_item_id: firstItem.id, inherited_item_id: inherited.id,
        original_basis: oldBasis, current_basis: currentBasis, original_decided_at: inherited.origin_decided_at, resubmitted_at: detail.revision.created_at,
        machine_status: detail.case.status, original_history_unchanged: true, timestamp_wait_ms: timestampWaitMs,
        history_comparison_exclusions: ['review_item.is_current', 'review_item.updated_at changed by its existing ON UPDATE timestamp'],
        pageErrors, consoleErrors, httpErrors, externalRequests, frontend_dist: frontendDist,
        synthetic_only: true, existing_candidate_changed: false, formal_database_connected: false, business_accepted: false }, null, 2) + '\n');
      console.log('PROCESS_REVIEW_PRESENTATION_BROWSER_PASS ' + checks.length);
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: error.message, checks, pageErrors, consoleErrors, httpErrors, externalRequests }, null, 2)); throw error;
    } finally { await browser.close(); }
  }, { frontendDist, evidenceDir: output });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
