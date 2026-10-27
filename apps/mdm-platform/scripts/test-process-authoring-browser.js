// Real Edge desktop integration. Input: --frontend-dist <artifacts build> and
// --output <new artifacts evidence directory>. Uses only a new labelled tmpfs
// MySQL fixture, synthetic identities/documents and a random loopback HTTP port.
// Writes screenshots, synthetic downloaded JSON and credential-free evidence.
// API fault injection is limited to explicit browser requests. Formal services,
// private env files, existing databases and external AI services are untouched.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { withProcessAuthoringCandidate } = require('./serve-process-authoring-candidate');
require('./testHelpers/ownedBrowserRuntime');

function runtime() {
  try { return require('playwright'); }
  catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); }
}
function argument(name) {
  const at = process.argv.indexOf(name);
  assert(at > 0 && process.argv[at + 1] && !process.argv[at + 1].startsWith('--'), name + ' is required');
  return path.resolve(process.argv[at + 1]);
}
const root = '/api/process-authoring';
const binding = draft => ({ expected_revision_no: draft.revision_no, expected_content_hash: draft.content_hash });
const caseBinding = row => ({ expected_revision_no: row.current_revision_no, expected_content_hash: row.current_content_hash });
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  const output = argument('--output'), frontendDist = argument('--frontend-dist');
  await withProcessAuthoringCandidate(async ({ fixture, expect, request, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1, locale: 'zh-CN', acceptDownloads: true });
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(20000);
    const checks = [], pageErrors = [], consoleErrors = [], errors = [], externalRequests = [], downloads = [], geometry = [];
    const origin = fixture.baseURL;
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
    page.on('response', response => { if (response.status() >= 400) errors.push({ path: new URL(response.url()).pathname, status: response.status() }); });
    context.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url()); });
    const button = name => page.getByRole('button', { name, exact: true });
    const read = id => expect('contact', root + '/drafts/' + id, 'GET');
    const getCase = id => expect('contact', '/api/process-v7-preview/cases/' + id, 'GET');
    async function idle() {
      await page.locator('[data-process-authoring]').waitFor();
      await button('刷新草稿列表').waitFor();
      await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新草稿列表')?.disabled);
    }
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await button('退出登录').waitFor();
    }
    async function openOther(who, id) {
      const ownedContext = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1, locale: 'zh-CN' });
      const ownedPage = await ownedContext.newPage(); ownedPage.setDefaultTimeout(20000);
      ownedPage.on('pageerror', error => pageErrors.push(who + ': ' + error.message));
      ownedPage.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
      ownedContext.on('request', request => { if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url()); });
      await ownedPage.goto(origin + '/app/process-authoring?draft=' + id);
      await ownedPage.locator('#login-name').fill('SYNTHETIC_' + who);
      await ownedPage.locator('#login-password').fill(fixture.loginPassword);
      await ownedPage.getByRole('button', { name: '登录', exact: true }).click();
      await ownedPage.locator('.process-authoring-editor .workbench-shell').waitFor();
      return { context: ownedContext, page: ownedPage };
    }
    async function closeDrawer() {
      const close = page.locator('.ant-drawer-open .ant-drawer-close');
      if (await close.count()) await close.click();
      await page.locator('.ant-drawer-open').waitFor({ state: 'hidden' });
    }
    async function upload(document, name, { discard = false, raw = false } = {}) {
      if (discard) page.once('dialog', dialog => dialog.accept());
      await page.getByLabel('上传JSON草稿', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(raw ? document : JSON.stringify(document)) });
    }
    async function editProcess(values, apply = true) {
      await page.locator('.process-authoring-editor .process-title').click();
      if (await button('编辑本对象').count()) await button('编辑本对象').click();
      for (const [label, value] of Object.entries(values)) await page.getByLabel(label, { exact: true }).fill(value);
      if (apply) { await button('应用本对象修改').click(); await applied(); }
    }
    async function applied() {
      await page.waitForFunction(() => document.querySelector('button[aria-label="应用本对象修改"]')?.disabled === true && !document.querySelector('.busy-strip'));
    }
    async function save() {
      const response = page.waitForResponse(response => response.url().includes(root + '/drafts') && ['POST', 'PUT'].includes(response.request().method()));
      await button('保存草稿').click(); const result = await response;
      assert([200, 201].includes(result.status()), 'draft save succeeded with status ' + result.status());
      await idle(); return result.json();
    }
    async function download(name) {
      const [item] = await Promise.all([page.waitForEvent('download'), button('下载编制文件').click()]);
      const target = path.join(output, name); await item.saveAs(target); await closeDrawer();
      const bytes = fs.readFileSync(target), value = JSON.parse(bytes.toString('utf8'));
      downloads.push({ file: name, suggested_name: item.suggestedFilename(), bytes: bytes.length, sha256: hash(bytes), schema_version: value.schema_version, process_ref: value.process?.process_ref });
      return value;
    }
    async function shot(name) {
      const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale, scrollWidth: document.documentElement.scrollWidth }));
      assert.deepEqual({ width: viewport.width, height: viewport.height, scale: viewport.scale }, { width: 1699, height: 828, scale: 1 });
      assert(viewport.scrollWidth <= viewport.width, 'no document horizontal overflow at desktop baseline');
      await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
    }
    async function graph() {
      const canvas = page.locator('.process-authoring-editor .graph-canvas');
      await canvas.waitFor(); await page.waitForFunction(() => document.querySelector('.process-authoring-editor .graph-canvas')?.getAttribute('data-layout-status') === 'ready');
      const result = await canvas.evaluate(element => {
        const cy = element._cyreg?.cy;
        return cy ? { width: element.clientWidth, height: element.clientHeight,
          nodes: cy.nodes('.behavior-node').map(node => ({ id: node.id(), box: node.boundingBox() })),
          edges: cy.edges().map(edge => ({ id: edge.id(), arrow: edge.style('target-arrow-shape') })) } : null;
      });
      assert(result && result.nodes.length >= 2 && result.edges.length >= 1, 'real Cytoscape graph is rendered');
      assert(result.edges.some(edge => edge.arrow !== 'none'), 'flow direction arrows are present');
      for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
        const a = result.nodes[i].box, b = result.nodes[j].box;
        assert(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1, 'behavior node boxes do not overlap');
      }
      geometry.push(result);
    }
    async function materials() {
      await button('编辑提交材料').click();
      await page.getByLabel('新编目的', { exact: true }).fill('验证3000编制草稿与既有核对链。');
      await page.getByLabel('修订原因（新编请明确说明新编）', { exact: true }).fill('合成功能验证新编。');
      await page.getByLabel('本次变化说明（无变化请明确说明）', { exact: true }).fill('仅使用合成资料核对保存与提交。');
      await page.getByLabel('来源名称 1', { exact: true }).fill('合成验证材料');
      await page.getByLabel('来源定位 1', { exact: true }).fill('synthetic:authoring-browser:source');
      await page.getByLabel('编制依据 1', { exact: true }).fill('仅为隔离自动化检查，不能作为业务确认。');
      for (const [index, department] of ['91', '92'].entries()) {
        await button('新增参与部门').click();
        await page.getByLabel('参与部门 ' + (index + 1), { exact: true }).selectOption(department);
        await page.getByLabel('本部门责任范围 ' + (index + 1), { exact: true }).fill('合成部门独立核对整份合成流程。');
        await page.getByLabel('参与依据 ' + (index + 1), { exact: true }).fill('明确的合成测试参与范围。');
      }
      await button('收起提交材料').click();
    }
    try {
      await page.goto(origin + '/app/process-authoring'); await login('contact'); await idle();
      const userAgent = await page.evaluate(() => navigator.userAgent); assert.match(userAgent, /Edg\//);
      await button('新建编制草稿').click(); await page.locator('.process-authoring-editor .workbench-shell').waitFor();
      const source = structuredClone(fixture.document);
      source.process.process_ref = 'process_authoring_browser_' + crypto.randomUUID();
      source.export_meta.package_ref = 'package_authoring_browser_' + crypto.randomUUID();
      source.process.process_name = '3000内编制合成检查流程';
      await upload(source, 'synthetic-authoring-v9.json', { discard: true });
      await page.locator('.process-title').getByText(source.process.process_name, { exact: true }).waitFor();
      await editProcess({ '目的': '浏览器明确填写并保存的合成流程目的。' }, false);
      await button('保存草稿').click(); await page.getByRole('alert').filter({ hasText: '当前有未应用输入' }).waitFor();
      assert.equal(await page.getByLabel('目的', { exact: true }).inputValue(), '浏览器明确填写并保存的合成流程目的。');
      await button('应用本对象修改').click(); await applied(); await save();
      const draftId = new URL(page.url()).searchParams.get('draft'); assert(draftId);
      let stored = (await read(draftId)).draft;
      assert.equal(stored.document.process.purpose, '浏览器明确填写并保存的合成流程目的。');
      assert.equal(stored.document.process.process_ref, source.process.process_ref);
      checks.push('new draft, imported V9, unapplied input save guard, explicit apply and real MySQL save');

      await page.reload(); await idle(); await page.locator('.process-title').getByText(source.process.process_name, { exact: true }).waitFor();
      await page.locator('.process-authoring-editor .process-title').click(); await button('编辑本对象').click();
      assert.equal(await page.getByLabel('目的', { exact: true }).inputValue(), stored.document.process.purpose);
      await button('退出编辑').click();
      await graph(); await shot('01-saved-draft-restored');
      const exported = await download('downloaded-native-v9.json');
      assert.equal(exported.schema_version, 'process-governance-v9'); assert.equal(exported.process.process_ref, source.process.process_ref);
      assert.equal(exported.process.purpose, stored.document.process.purpose);
      checks.push('saved draft survives full reload; native JSON download preserves process and package identity');

      const aiEdited = structuredClone(exported); aiEdited.process.scope += ' 已由合成AI对话编辑稿补充范围。';
      await upload(aiEdited, 'governance-knowledge-edited.json');
      await page.waitForFunction(() => document.querySelector('.document-status')?.textContent.includes('未保存'));
      await save(); stored = (await read(draftId)).draft;
      assert.equal(stored.document.process.scope, aiEdited.process.scope);
      assert.deepEqual(stored.document.behaviors, source.behaviors);
      const beforeBad = structuredClone(stored.document);
      await upload('{invalid json', 'invalid-json.json', { raw: true });
      await page.locator('.error-strip').first().waitFor();
      assert.deepEqual((await read(draftId)).draft.document, beforeBad);
      assert.equal((await download('after-invalid-import.json')).process.scope, aiEdited.process.scope);
      checks.push('Governance-Knowledge JSON round trip saves explicit user file; malformed import preserves current and saved content');

      const localPurpose = '真实并发冲突后仍保留的浏览器输入。';
      await editProcess({ '目的': localPurpose });
      const remote = structuredClone(stored.document); remote.process.scope += ' 另一合成会话已保存。';
      await expect('contact', root + '/drafts/' + draftId, 'PUT', { request_id: crypto.randomUUID(), ...binding(stored), document: remote, submission: stored.submission });
      const conflictResponse = page.waitForResponse(response => response.url().endsWith('/drafts/' + draftId) && response.request().method() === 'PUT');
      await button('保存草稿').click(); assert.equal((await conflictResponse).status(), 409);
      await page.getByRole('alert').filter({ hasText: '草稿已被其他人修改' }).waitFor();
      assert.equal((await download('conflict-local-recovery.json')).process.purpose, localPurpose);
      assert.equal((await read(draftId)).draft.document.process.scope, remote.process.scope);
      page.once('dialog', dialog => dialog.accept()); await button('重新打开已保存草稿').click(); await idle();
      assert.equal((await download('reopened-latest.json')).process.scope, remote.process.scope);
      checks.push('real concurrent MySQL save rejects stale browser write; local recovery JSON and latest server draft remain distinct');

      await materials(); await save();
      const submitResponse = page.waitForResponse(response => response.url().endsWith('/drafts/' + draftId + '/submit'));
      await button('提交当前草稿及本次材料').click(); const submitted = await submitResponse; assert.equal(submitted.status(), 200);
      const receipt = await submitted.json(), caseId = receipt.draft.case_id; assert(caseId);
      let detail = await getCase(caseId); assert.equal(detail.case.current_revision_no, 1);
      assert.equal(detail.revision.document.process.process_ref, source.process.process_ref);
      await page.getByRole('link', { name: '查看核对、退回原因及历史记录', exact: true }).click();
      await button('刷新案例与当前修订').waitFor();
      await page.waitForFunction(id => document.querySelector('select[aria-label="选择流程案例"]')?.value === String(id), caseId);
      const entryGeometry = await page.locator('.review-case-picker').evaluate(element => {
        const box = selector => { const rect = element.querySelector(selector).getBoundingClientRect(); return { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom }; };
        return { picker: box('label'), actions: box('.import-actions'), authoring: box('.authoring-case-actions') };
      });
      assert(entryGeometry.authoring.y >= Math.max(entryGeometry.picker.bottom, entryGeometry.actions.bottom), 'authoring links occupy a separate row below the case picker');
      geometry.push({ preview_entry: entryGeometry });
      await shot('02-submitted-existing-review');
      checks.push('explicit saved-draft submission creates one preview snapshot and opens existing department review workspace');

      const returnBasis = '合成退回依据：请补充流程目的后在原案例续修。';
      assert(detail.items.length > 0);
      await expect('reviewA', '/api/process-v7-preview/items/' + detail.items[0].id + '/decision', 'POST', { ...caseBinding(detail.case), decision: 'needs_changes', basis: returnBasis });
      await button('刷新案例与当前修订').click(); await page.getByText(returnBasis, { exact: false }).first().waitFor();
      await page.getByRole('link', { name: '在3000继续编制本案例', exact: true }).click(); await idle();
      assert.equal(await page.locator('.ant-drawer-open').count(), 0, 'returning to authoring does not replay an old download drawer');
      await button('从原案例继续编制').click(); await idle();
      assert.equal(await page.locator('.ant-drawer-open').count(), 0, 'switching source draft clears previous drawer state');
      const revisionDraftId = new URL(page.url()).searchParams.get('draft'); assert(revisionDraftId && revisionDraftId !== draftId);
      assert.equal((await read(revisionDraftId)).draft.case_id, caseId);
      await editProcess({ '目的': '按合成退回依据补充后的流程目的。' }); await save();
      const revisionResponse = page.waitForResponse(response => response.url().endsWith('/drafts/' + revisionDraftId + '/submit'));
      await button('提交当前草稿及本次材料').click(); assert.equal((await revisionResponse).status(), 200);
      detail = await getCase(caseId); assert.equal(detail.case.current_revision_no, 2);
      assert.equal(detail.revision.document.process.process_ref, source.process.process_ref);
      assert(detail.events.some(event => event.basis_text === returnBasis), 'return opinion remains in case history');
      const [[caseCount]] = await pool.execute('SELECT COUNT(*) AS n FROM process_v7_preview_cases'); assert.equal(caseCount.n, 1);
      await page.getByRole('link', { name: '查看核对、退回原因及历史记录', exact: true }).click(); await button('刷新案例与当前修订').waitFor();
      await button('责任与历史').click();
      await shot('03-returned-revision-same-case');
      checks.push('needs-changes opinion, in-app original-case continuation and resubmission retain one case and historical opinion');

      const legacyDraftIds = [];
      for (const version of ['v7', 'v8']) {
        const legacy = require('./testHelpers/processCaseGovernanceFixture').document();
        legacy.schema_version = 'process-governance-' + version; legacy.migration.source_schema_version = legacy.schema_version;
        Object.assign(legacy.export_meta, { initiating_department: '合成甲部', compiler: '合成历史编制人' });
        Object.assign(legacy.process, { owning_department: '合成甲部', process_name: '受支持' + version.toUpperCase() + '合成历史案例' });
        legacy.behaviors[0].current_actor_role = '合成甲部核对人';
        const old = await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: legacy, source_file_name: 'legacy-supported-' + version + '.json' }, 201);
        await page.goto(origin + '/app/process-authoring?case=' + old.case.id); await idle();
        await button('从原案例继续编制').click(); await idle();
        const oldDraftId = new URL(page.url()).searchParams.get('draft'); assert(oldDraftId); legacyDraftIds.push(oldDraftId);
        assert.deepEqual((await read(oldDraftId)).draft.document, legacy);
        await save(); assert.deepEqual((await read(oldDraftId)).draft.document, legacy);
        const oldExport = await download('legacy-native-' + version + '.json');
        assert.equal(oldExport.schema_version, legacy.schema_version);
        assert.equal(oldExport.process.process_ref, legacy.process.process_ref);
        assert.equal(oldExport.export_meta.package_ref, legacy.export_meta.package_ref);
        assert.deepEqual((await getCase(old.case.id)).revision.document, legacy);
        await shot('04-legacy-native-' + version + '-preserved');
      }
      checks.push('supported native V7/V8 existing cases open, save and download without rewriting original bodies, identities or historical formats');

      const assignedDocument = structuredClone(source);
      assignedDocument.process.process_ref += '_assigned'; assignedDocument.export_meta.package_ref += '_assigned';
      assignedDocument.process.process_name = '编制与提交分工合成流程';
      const assignedSubmission = (await read(draftId)).draft.submission;
      const assignedCase = (await expect('contact', '/api/process-v7-preview/cases', 'POST', { document: assignedDocument, source_file_name: '合成待分派编制材料.json', submission: assignedSubmission }, 201)).case;
      const assignmentDetail = await getCase(assignedCase.id);
      await expect('contact', '/api/process-v7-preview/cases/' + assignedCase.id + '/authoring-records', 'POST', {
        request_key: crypto.randomUUID(), record_kind: 'transfer', content: '合成主对接人明确转交本部门编制人员', recipient_person_id: '84',
        expected_assignment_version: assignmentDetail.authoring.assignment_version, ...caseBinding(assignedCase)
      });
      let assigned = (await expect('contact', root + '/drafts/from-case/' + assignedCase.id, 'POST', { request_id: crypto.randomUUID(), ...caseBinding(assignedCase) }, 201)).draft;
      const compiler = await openOther('reviewA', assigned.id), compilerButton = name => compiler.page.getByRole('button', { name, exact: true });
      assert.equal(await compilerButton('保存草稿').isEnabled(), true);
      assert.equal(await compilerButton('提交当前草稿及本次材料').isDisabled(), true);
      await compiler.page.locator('.process-authoring-editor .process-title').click(); await compilerButton('编辑本对象').click();
      await compiler.page.getByLabel('目的', { exact: true }).fill('由明确编制者保存的合成目的。');
      await compilerButton('应用本对象修改').click();
      await compiler.page.waitForFunction(() => document.querySelector('button[aria-label="应用本对象修改"]')?.disabled === true && !document.querySelector('.busy-strip'));
      const compilerResponse = compiler.page.waitForResponse(response => response.url().endsWith('/drafts/' + assigned.id) && response.request().method() === 'PUT');
      await compilerButton('保存草稿').click(); assert.equal((await compilerResponse).status(), 200);
      await compiler.context.close();
      await page.goto(origin + '/app/process-authoring?draft=' + assigned.id); await idle(); await page.locator('.process-authoring-editor .workbench-shell').waitFor();
      assert.equal(await button('保存草稿').isDisabled(), true);
      assert.equal(await page.locator('.process-authoring-editor .process-title').evaluate(element => Boolean(element.closest('[inert]'))), true);
      await button('编辑提交材料').click();
      const submittedMaterial = '当前主对接人独立补充的合成本次提交材料。';
      await page.getByLabel('本次变化说明（无变化请明确说明）', { exact: true }).fill(submittedMaterial);
      await button('收起提交材料').click();
      assert.equal(await button('提交当前草稿及本次材料').isEnabled(), true);
      await shot('05-contact-materials-readonly-body');
      const contactSubmission = page.waitForResponse(response => response.url().endsWith('/drafts/' + assigned.id + '/submit'));
      await button('提交当前草稿及本次材料').click(); const submittedMaterialResponse = await contactSubmission; assert.equal(submittedMaterialResponse.status(), 200);
      const assignedDetail = await getCase(assignedCase.id);
      assert.equal(assignedDetail.case.current_revision_no, 2);
      assert.equal(assignedDetail.revision.document.process.purpose, '由明确编制者保存的合成目的。');
      assert.equal(assignedDetail.governance.submission.change_summary, submittedMaterial);
      const administrator = await openOther('adminMulti', assigned.id), adminButton = name => administrator.page.getByRole('button', { name, exact: true });
      assert.equal(await adminButton('保存草稿').isDisabled(), true);
      assert.equal(await adminButton('提交当前草稿及本次材料').isDisabled(), true);
      assert.equal(await administrator.page.locator('.process-authoring-editor .process-title').evaluate(element => Boolean(element.closest('[inert]'))), true);
      await adminButton('编辑提交材料').click();
      assert.equal(await administrator.page.getByLabel('本次变化说明（无变化请明确说明）', { exact: true }).isDisabled(), true);
      await administrator.page.screenshot({ path: path.join(output, '06-administrator-readonly.png'), fullPage: true }); await administrator.context.close();
      checks.push('named compiler saves but cannot submit; current contact submits new materials with immutable compiler body; administrator body and materials remain read-only');

      assert.equal((await request('outsider', root + '/drafts/' + draftId, 'GET')).status, 403);
      assert.equal((await request('adminMulti', root + '/drafts/' + draftId, 'PUT', { request_id: crypto.randomUUID(), ...binding((await read(draftId)).draft), document: remote })).status, 403);
      checks.push('unrelated department cannot read and administrator multi-role cannot write compiler draft');
      const storage = await page.evaluate(async () => ({
        localStorage: Object.keys(localStorage).map(key => ({ key, bytes: localStorage.getItem(key).length })),
        sessionStorage: Object.keys(sessionStorage).map(key => ({ key, bytes: sessionStorage.getItem(key).length })),
        indexedDB: typeof indexedDB.databases === 'function' ? (await indexedDB.databases()).map(item => ({ name: item.name, version: item.version })) : 'unavailable'
      }));
      assert.deepEqual(pageErrors, []); assert.deepEqual(externalRequests, []);
      assert(consoleErrors.every(value => /Failed to load resource.*(?:409|403)/.test(value)), 'no unexpected console errors: ' + JSON.stringify(consoleErrors));
      fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify({ checks, browser: { channel: 'msedge', version: browser.version(), userAgent, viewport: { width: 1699, height: 828 }, zoom: 1 },
        evidence: { draftId, revisionDraftId, caseId, legacyDraftIds, assignedDraftId: assigned.id, downloads, geometry, storage, httpErrors: errors, pageErrors, consoleErrors, externalRequests },
        boundary: { synthetic_only: true, owned_temporary_mysql: true, formal_services_changed: false, business_acceptance: false } }, null, 2) + '\n');
      console.log('PROCESS_AUTHORING_BROWSER_PASS ' + checks.length);
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 5000 }).catch(() => {});
      fs.writeFileSync(path.join(output, 'browser-failure.json'), JSON.stringify({ error: error.message, pageErrors, consoleErrors, httpErrors: errors, externalRequests, checks }, null, 2));
      throw error;
    } finally { await browser.close(); }
  }, { frontendDist, evidenceDir: output });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
