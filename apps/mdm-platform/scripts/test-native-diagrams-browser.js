// Owned temporary MySQL/HTTP/Edge, synthetic documents only; no formal services.
// Input: --output <fresh artifacts directory>. Writes screenshots/results, closes owned resources.
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
    // Bound a stalled renderer/evaluate call as well as ordinary locator waits.
    const deadline = setTimeout(() => { console.error('DIAGRAM_SUITE_DEADLINE'); browser.close().catch(() => {}); }, 240000);
    const errors = [], checks = [], consoleErrors = [], geometry = [];
    let writes = 0;
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('request', r => { if (/\/api\/(process-v7-preview|process-design|data-map|field-entries|import)\//.test(r.url()) && r.method() !== 'GET') writes++; });
    const button = name => page.getByRole('button', { name, exact: true });
    const ready = () => page.locator('[data-diagram-state="ready"]').waitFor();
    const refresh = async () => { await button('刷新图形').click(); await ready(); };
    const select = async id => { await page.getByLabel('图形流程', { exact: true }).selectOption(String(id)); await ready(); };
    const sourceText = () => page.locator('[data-diagram-source]').innerText();
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await button('登录').click(); await page.getByRole('heading', { name: '流程与数据关系图', exact: true }).waitFor();
    }
    try {
      await page.goto(fixture.baseURL + '/app/data-map');
      await login('contact'); await page.getByText('当前可见范围暂无流程。', { exact: true }).waitFor();
      const root = '/api/process-v7-preview';
      const doc = structuredClone(fixture.document);
      doc.data_objects = [{ data_ref: 'data_synthetic', data_name: '合成核对记录', description: '合成原始说明<script>不可执行</script>', information_type: 'file_attachment', fields: [{ field_ref: 'field_result', field_name: '合成结论', field_type: '文本', definition: '合成结果' }], behavior_links: [{ link_ref: 'link_prepare', behavior_ref: 'behavior_prepare', operation: 'create', updated_field_refs: [] }, { link_ref: 'link_receive', behavior_ref: 'behavior_receive', operation: 'use', updated_field_refs: [] }], source_relations: [], lifecycle: require('../../structured-output-service/public/process-governance-migration').pendingLifecycle() }];
      doc.behaviors[0].behavior_description = '合成长中文核对说明。'.repeat(30);
      const preview = await expect('contact', root + '/cases', 'POST', { document: doc, source_file_name: 'synthetic-v7.json' }, 201);
      const id = preview.case.id;
      const emptyDoc = structuredClone(fixture.document); emptyDoc.process.process_ref = 'synthetic_empty_diagram'; emptyDoc.process.process_name = '无数据对象的合成流程';
      const empty = await expect('contact', root + '/cases', 'POST', { document: emptyDoc, source_file_name: 'empty-v7.json' }, 201);
      const publishedDoc = structuredClone(doc); publishedDoc.schema_version = 'process-governance-v8'; publishedDoc.process.process_ref = 'synthetic_published_diagram'; publishedDoc.process.process_name = '已发布合成图形流程';
      let formal = await expect('contact', root + '/cases', 'POST', { document: publishedDoc, source_file_name: 'synthetic-v8.json' }, 201);
      const bind = { expected_revision_no: formal.case.current_revision_no, expected_content_hash: formal.case.current_content_hash };
      for (const who of ['reviewA', 'reviewB']) for (const item of formal.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...bind, decision: 'confirmed', basis: '合成图形测试核对依据' });
      const promotion = await expect('lead', root + '/cases/' + formal.case.id + '/promote', 'POST', { ...bind, target: { mode: 'create', document_no: 'P21-DIAGRAM-SYNTHETIC', document_title: '合成图形制度' } }, 201);
      const binding = { expected_revision_no: promotion.draft.revision_no, expected_content_hash: promotion.draft.content_hash };
      const submitted = await expect('contact', '/api/process-design/drafts/' + promotion.draft.id + '/submit', 'POST', binding);
      await expect('reviewA', '/api/process-design/review-tasks/' + submitted.reviewTask.id + '/decision', 'POST', { ...binding, decision: 'approve', note: '仅合成测试审核依据' });
      const historical = await expect('lead', '/api/process-design/drafts/' + promotion.draft.id + '/publish', 'POST', binding);
      const revised = structuredClone(publishedDoc); revised.behaviors[0].behavior_description = '新版合成说明，与历史版本不同';
      const newer = await expect('contact', root + '/cases/' + formal.case.id + '/revisions', 'POST', { ...bind, document: revised, source_file_name: 'synthetic-v8-revised.json' }, 201);
      const newerBind = { expected_revision_no: newer.case.current_revision_no, expected_content_hash: newer.case.current_content_hash };
      for (const who of ['reviewA', 'reviewB']) for (const item of newer.items) await expect(who, root + '/items/' + item.id + '/decision', 'POST', { ...newerBind, decision: 'confirmed', basis: '合成新版图形核对依据' });
      const nextPromotion = await expect('lead', root + '/cases/' + formal.case.id + '/promote', 'POST', { ...newerBind, target: { mode: 'existing', document_id: promotion.document.id } }, 201);
      const nextBinding = { expected_revision_no: nextPromotion.draft.revision_no, expected_content_hash: nextPromotion.draft.content_hash };
      const nextSubmitted = await expect('contact', '/api/process-design/drafts/' + nextPromotion.draft.id + '/submit', 'POST', nextBinding);
      await expect('reviewA', '/api/process-design/review-tasks/' + nextSubmitted.reviewTask.id + '/decision', 'POST', { ...nextBinding, decision: 'approve', note: '合成新版审核依据' });
      const published = await expect('lead', '/api/process-design/drafts/' + nextPromotion.draft.id + '/publish', 'POST', nextBinding);
      const snapshot = async () => {
        const a = await expect('lead', root + '/cases/' + id, 'GET');
        const b = await expect('lead', '/api/process-design/versions/' + published.process_version_id + '/content', 'GET');
        const history = await expect('lead', '/api/process-design/versions/' + historical.process_version_id + '/content', 'GET');
        return { revision: a.revision, case: a.case, formal: b, history };
      };
      const before = await snapshot();
      await button('刷新图形').click(); await page.getByLabel('图形流程').locator(`option[value="${id}"]`).waitFor({ state: 'attached' });
      await page.route('**/api/process-diagrams/assets/data-relation-diagram.js', route => route.abort(), { times: 1 });
      await page.getByLabel('图形流程', { exact: true }).selectOption(String(id)); await page.locator('[data-diagram-state="error"]').waitFor(); await refresh();
      assert.match(await sourceText(), /预览修订 1.*尚未形成正式发布结论/);
      await page.getByLabel('上下文标题', { exact: true }).fill('未保存的图形旁台账输入');
      const preserved = async () => { assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '未保存的图形旁台账输入'); assert.equal(writes, 0); };
      async function inspectGraph(label) {
        const result = await page.locator('.native-diagram-viewport').evaluate(el => {
          const cy = el._cyreg.cy;
          const nodes = cy.nodes().filter(n => n.data('focusKind') === 'behavior' || ['behavior', 'data'].includes(n.data('kind'))).map(n => ({ id: n.id(), box: n.boundingBox(), rendered: n.renderedBoundingBox() }));
          const edges = cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), arrow: e.style('target-arrow-shape') }));
          return { nodes, edges, zoom: cy.zoom(), width: el.clientWidth, height: el.clientHeight };
        });
        assert.ok(result.nodes.length >= 3); assert.ok(result.edges.length >= 2);
        for (const node of result.nodes) { assert.ok(Number.isFinite(node.box.x1)); assert.ok(node.rendered.x1 >= -2 && node.rendered.y1 >= -2); assert.ok(node.rendered.x2 <= result.width + 2 && node.rendered.y2 <= result.height + 2); }
        for (let i = 0; i < result.nodes.length; i++) for (let j = i + 1; j < result.nodes.length; j++) {
          const a = result.nodes[i].box, b = result.nodes[j].box;
          assert.ok(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1, 'nodes must not overlap');
        }
        assert.ok(result.edges.every(edge => edge.arrow !== 'none'));
        geometry.push({ label, ...result });
      }
      await inspectGraph('process-desktop');
      const clicked = await page.locator('.native-diagram-viewport').evaluate(el => { const cy=el._cyreg.cy; const n=cy.nodes('.behavior-node').filter(n => n.data('focusRef') === 'behavior_prepare').first(); n.emit('tap'); return n.data(); });
      await page.waitForTimeout(100);
      fs.writeFileSync(path.join(output,'focus-debug.json'),JSON.stringify({clicked,inspector:await page.locator('.native-diagram-inspector').innerText(),source:before.revision.document.behaviors[0]},null,2));
      await page.locator('.native-diagram-inspector').getByText(doc.behaviors[0].behavior_description, { exact: true }).waitFor();
      await page.getByText('键盘查阅原始内容', { exact: true }).click();
      await button('准备合成材料').focus(); await page.keyboard.press('Enter'); await preserved();
      await page.getByLabel('图形视图', { exact: true }).selectOption('data'); await ready(); await inspectGraph('data-desktop');
      const fitted = await page.locator('.native-diagram-viewport').evaluate(el => el._cyreg.cy.zoom());
      await button('清晰视图').click();
      assert.ok(await page.locator('.native-diagram-viewport').evaluate(el => el._cyreg.cy.zoom()) >= fitted);
      await button('完整视图').click();
      await page.locator('.native-diagram-viewport').evaluate(el => el._cyreg.cy.nodes().filter(n => n.data('kind') === 'data').emit('tap'));
      await page.locator('.native-diagram-inspector').getByText(doc.data_objects[0].description, { exact: true }).waitFor();
      const downloaded = page.waitForEvent('download'); downloaded.catch(() => {}); await button('下载图形 PNG').click(); const file = await downloaded;
      assert.match(file.suggestedFilename(), /数据关系图\.png$/); await file.saveAs(path.join(output, 'diagram.png'));
      const png = fs.readFileSync(path.join(output, 'diagram.png')); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.readUInt32BE(16) >= 1000); assert.ok(png.readUInt32BE(20) > 100);
      // Hold image decoding to prove switching views cannot download a stale image.
      let downloadCount = 0; const counted = () => downloadCount++; page.on('download', counted);
      await page.evaluate(() => { const original = HTMLImageElement.prototype.decode; window.restoreDiagramDecode = () => { HTMLImageElement.prototype.decode = original; }; HTMLImageElement.prototype.decode = function () { return new Promise((resolve, reject) => { window.releaseDiagramDecode = () => original.call(this).then(resolve, reject); }); }; });
      await button('下载图形 PNG').click(); await page.waitForFunction(() => Boolean(window.releaseDiagramDecode));
      await page.getByLabel('图形视图', { exact: true }).selectOption('process'); await ready();
      await page.evaluate(async () => { window.restoreDiagramDecode(); await window.releaseDiagramDecode(); }); await page.waitForTimeout(100);
      assert.equal(downloadCount, 0); page.off('download', counted);
      await page.getByLabel('图形视图', { exact: true }).selectOption('data'); await ready();
      await page.locator('.native-diagram-viewport').evaluate(el => el._cyreg.cy.nodes().filter(n => n.data('kind') === 'data').emit('tap'));
      await preserved(); checks.push('real V7 preview, process/data geometry, safe original details, keyboard and source-labelled PNG without writes');
      checks.push('injected local asset failure recovers; clear/full view and late PNG canceled after view switch');
      for (const [width, height, name] of [[1699,828,'desktop']]) {
        await page.setViewportSize({ width, height }); await button('完整视图').click(); await page.waitForTimeout(100);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        await inspectGraph(name); await page.locator('.native-diagrams').screenshot({ path: path.join(output, name + '.png') });
      }
      await page.setViewportSize({ width: 1699, height: 828 });
      console.log('DIAGRAM_STAGE_HISTORICAL');
      await select(empty.case.id); await page.getByText('当前流程没有数据对象，无法绘制数据关系。', { exact: true }).waitFor(); assert.equal(await button('下载图形 PNG').isDisabled(), true);
      await select(formal.case.id); assert.match(await sourceText(), new RegExp('已发布.*正式版本 ' + published.process_version_id));
      const versionChoice = page.getByLabel('图形版本', { exact: true });
      const selectVersion = async value => { await versionChoice.selectOption(String(value)); await ready(); };
      await selectVersion(historical.process_version_id);
      assert.match(await sourceText(), new RegExp('历史版本（superseded）.*正式版本 ' + historical.process_version_id));
      await page.getByLabel('图形视图', { exact: true }).selectOption('process'); await ready();
      await page.locator('.native-diagram-viewport').evaluate(el => el._cyreg.cy.nodes('.behavior-node').filter(n => n.data('focusRef') === 'behavior_prepare').first().emit('tap'));
      await page.locator('.native-diagram-inspector').getByText(publishedDoc.behaviors[0].behavior_description, { exact: true }).waitFor();
      await inspectGraph('historical-process');
      await page.getByLabel('图形视图', { exact: true }).selectOption('data'); await ready(); await inspectGraph('historical-data');
      const historyDownload = page.waitForEvent('download'); historyDownload.catch(() => {});
      await button('下载图形 PNG').click(); await (await historyDownload).saveAs(path.join(output, 'historical-diagram.png'));
      await page.locator('.native-diagrams').screenshot({ path: path.join(output, 'historical-desktop.png') });
      await preserved(); await refresh(); assert.equal(await versionChoice.inputValue(), String(historical.process_version_id));
      await selectVersion(published.process_version_id); await page.goBack(); await ready(); assert.equal(await versionChoice.inputValue(), String(historical.process_version_id));
      await preserved();
      await page.route('**/api/process-design/drafts/' + nextPromotion.draft.id, route => route.fulfill({ status: 403, json: {} }), { times: 1 });
      await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor();
      assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await preserved(); await refresh();
      const historyUrl = '/api/process-design/versions/' + historical.process_version_id + '/content';
      for (const status of [403,409,503]) {
        await page.route('**' + historyUrl, route => route.fulfill({ status, json: {} }), { times: 1 });
        await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor();
        assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await preserved(); await refresh();
      }
      let releaseHistory, historyArrived;
      const historyHeld = new Promise(resolve => { releaseHistory = resolve; }), historyArrival = new Promise(resolve => { historyArrived = resolve; });
      await page.route('**' + historyUrl, async route => { historyArrived(); await historyHeld; await route.fulfill({ json: before.history }).catch(() => {}); }, { times: 1 });
      await button('刷新图形').click(); await historyArrival; await selectVersion(published.process_version_id); releaseHistory();
      await page.waitForTimeout(100); assert.match(await sourceText(), new RegExp('已发布.*正式版本 ' + published.process_version_id));
      // A URL cannot smuggle another version into the selected process.
      await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set('diagramVersion', '99999999'); history.pushState({}, '', url); dispatchEvent(new PopStateEvent('popstate')); });
      await page.getByText('所选正式版本不在该流程可见版本列表中，请重新选择。', { exact: false }).waitFor();
      assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await selectVersion('');
      checks.push('real superseded/current versions selected independently; process/data/PNG source, back, retry, stale response, invalid version and neighboring input protection');
      const url = '/api/process-design/versions/' + published.process_version_id + '/content';
      console.log('DIAGRAM_STAGE_FAULTS');
      await page.route('**' + url, route => route.fulfill({ json: { ...before.formal, content_hash_verified: false } }), { times: 1 });
      await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor(); assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await refresh();
      checks.push('real native V8 published version priority and empty data; injected bad digest fails closed');
      await select(id);
      for (const status of [403,409,503]) {
        await page.route('**' + root + '/cases/' + id, route => route.fulfill({ status, json: {} }), { times: 1 });
        await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor(); assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await preserved(); await refresh();
      }
      await context.setOffline(true); await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor(); await context.setOffline(false); await refresh();
      let release, entered;
      const block = new Promise(r => { release = r; }), arrival = new Promise(r => { entered = r; });
      await page.route('**' + root + '/cases/' + id, async route => { entered(); await block; await route.fulfill({ json: { revision: { document: { ...doc, process: { ...doc.process, process_name: '迟到图形' } }, revision_no: 999 } } }).catch(() => {}); }, { times: 1 });
      await button('刷新图形').click(); await arrival; await select(formal.case.id); release(); await page.waitForTimeout(100);
      assert.equal(await page.getByRole('heading', { name: '迟到图形', exact: true }).count(), 0); assert.match(await sourceText(), /已发布/); await preserved();
      checks.push('403/409/503/offline retry, concurrent late read discarded, unsaved neighboring input preserved');
      page.once('dialog', dialog => dialog.dismiss()); await page.reload().catch(() => {}); await preserved();
      await page.getByLabel('上下文标题', { exact: true }).fill('');
      await selectVersion(historical.process_version_id);
      page.once('dialog', dialog => dialog.accept()); await page.reload(); await ready();
      assert.equal(await versionChoice.inputValue(), String(historical.process_version_id));
      assert.match(await sourceText(), new RegExp('历史版本.*正式版本 ' + historical.process_version_id));
      await selectVersion('');
      await page.reload(); await ready(); assert.match(await sourceText(), /已发布/);
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await ready(); assert.match(await sourceText(), /已发布/);
      await page.getByRole('link', { name: '打开原数据地图入口', exact: true }).click(); await page.waitForURL('**/#/dataMap');
      await page.locator('#nativeDiagramCase').selectOption(String(id)); await page.locator('#nativeDataDiagramButton').click(); await page.locator('#nativeDiagramCanvas canvas').first().waitFor();
      await page.getByText('预览修订 1 · 尚未形成正式发布结论', { exact: true }).waitFor(); await page.goBack(); await ready();
      // A fixed version is readable without consulting the preview list or draft.
      let caseReads = 0;
      const countCaseReads = r => { if (/\/api\/process-v7-preview\/cases|\/api\/process-design\/drafts/.test(r.url())) caseReads++; };
      page.on('request', countCaseReads);
      const direct = async value => {
        await page.evaluate(value => { const url = new URL(location.href); url.searchParams.delete('diagramCase'); url.searchParams.set('diagramVersion', value); history.pushState(history.state, '', url); dispatchEvent(new PopStateEvent('popstate')); }, String(value));
      };
      await direct(historical.process_version_id); await ready();
      await page.locator('[data-direct-version]').waitFor();
      assert.match(await sourceText(), new RegExp('历史版本.*正式版本 ' + historical.process_version_id));
      await page.getByLabel('上下文标题', { exact: true }).fill('独立查图保留的输入');
      for (const mode of ['process', 'data']) {
        await page.getByLabel('图形视图', { exact: true }).selectOption(mode); await ready(); await inspectGraph('direct-' + mode);
      }
      const directDownload = page.waitForEvent('download'); await button('下载图形 PNG').click();
      await (await directDownload).saveAs(path.join(output, 'direct-version.png'));
      await page.locator('.native-diagrams').screenshot({ path: path.join(output, 'direct-version-desktop.png') });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      const directPath = '/api/process-design/versions/' + historical.process_version_id + '/content';
      for (const status of [403, 409, 503]) {
        await page.route('**' + directPath, route => route.fulfill({ status, json: { error: 'synthetic direct version fault' } }), { times: 1 });
        await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor();
        assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await refresh();
      }
      await page.route('**' + directPath, route => route.abort(), { times: 1 });
      await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor(); await refresh();
      for (const patch of [{ process_version_id: 99999 }, { content_hash_verified: false }, { status: 'draft' }, { schema_version: 'process-governance-v3' }, { document: { ...before.history.document, schema_version: 'process-governance-v7' } }]) {
        await page.route('**' + directPath, route => route.fulfill({ json: { ...before.history, ...patch } }), { times: 1 });
        await button('刷新图形').click(); await page.locator('[data-diagram-state="error"]').waitFor();
        assert.equal(await page.locator('.native-diagram-viewport').count(), 0); await refresh();
      }
      let finishDirect, directArrived;
      const pendingDirect = new Promise(resolve => { finishDirect = resolve; });
      const directArrival = new Promise(resolve => { directArrived = resolve; });
      await page.route('**' + directPath, async route => { directArrived(); await pendingDirect; await route.fulfill({ json: before.history }).catch(() => {}); }, { times: 1 });
      await button('刷新图形').click(); await directArrival;
      await direct(published.process_version_id); await ready(); finishDirect(); await page.waitForTimeout(100);
      assert.match(await sourceText(), new RegExp('已发布.*正式版本 ' + published.process_version_id));
      await direct('invalid'); await page.locator('[data-diagram-state="error"]').waitFor(); assert.equal(await page.locator('.native-diagram-viewport').count(), 0);
      await direct('99999999'); await page.locator('[data-diagram-state="error"]').waitFor();
      await direct(historical.process_version_id); await ready();
      assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '独立查图保留的输入');
      page.once('dialog', dialog => dialog.dismiss()); await page.reload().catch(() => {});
      assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '独立查图保留的输入');
      await page.getByLabel('上下文标题', { exact: true }).fill('');
      await page.reload(); await ready(); assert.match(await sourceText(), /历史版本/);
      await direct(published.process_version_id); await ready(); await page.goBack(); await ready(); assert.match(await sourceText(), /历史版本/);
      assert.equal(caseReads, 0, 'independent reads never depend on case/draft list visibility'); page.off('request', countCaseReads);
      await button('返回案例选图').click(); await page.getByLabel('图形流程', { exact: true }).waitFor();
      await select(formal.case.id); await direct(published.process_version_id); await ready();
      assert.equal((await request('outsider', directPath)).status, 403);
      assert.equal((await request('anonymous', directPath)).status, 401);
      checks.push('independent fixed-version process/data/PNG, no case/draft reads; errors/mismatches/missing ID, stale response, input, reload/back and return to cases');
      console.log('DIAGRAM_STAGE_SEARCH');
      // Extra versions are explicit synthetic fixtures, never inferred historical records.
      const searchIds = [];
      for (let i = 0; i < 25; i++) {
        const native = structuredClone(doc); native.schema_version = i % 2 ? 'process-governance-v8' : 'process-governance-v7';
        const [inserted] = await pool.execute(`INSERT INTO process_design_versions
          (draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [promotion.draft.id, promotion.document.id, 'SEARCH-' + i,
          '检索合成版本' + (i === 0 ? '%_字面量' : ''), 'S' + i, 'SEARCH-SYNTHETIC-' + i,
          i === 24 ? 93 : 91, native.schema_version, JSON.stringify(native),
          require('../server/processV7PreviewReview').contentHash(native), i % 3 === 0 ? 'retired' : i % 3 === 1 ? 'superseded' : 'published']);
        searchIds.push(String(inserted.insertId));
      }
      const searchRoot = '/api/process-design/versions?q=' + encodeURIComponent('检索合成版本');
      let cursor = '', found = [];
      do {
        const result = await expect('contact', searchRoot + (cursor ? '&before_id=' + cursor : ''), 'GET');
        assert.ok(result.items.every(row => row.department_id === '91' && typeof row.id === 'string' && !Object.hasOwn(row, 'process_content_json')));
        found.push(...result.items.map(row => row.id)); cursor = result.next_cursor;
      } while (cursor);
      assert.deepEqual(found, searchIds.slice(0, 24).reverse()); assert.equal(new Set(found).size, 24);
      assert.equal((await expect('outsider', searchRoot, 'GET')).items.length, 1);
      assert.equal((await expect('adminMulti', searchRoot, 'GET')).items[0].id, searchIds[24]);
      assert.equal((await request('anonymous', searchRoot)).status, 401);
      for (const bad of ['before_id=-1', 'before_id=9223372036854775808', 'q[]=x', 'q=' + 'x'.repeat(201)]) {
        assert.equal((await request('contact', '/api/process-design/versions?' + bad)).status, 400);
      }
      assert.equal((await expect('contact', '/api/process-design/versions?q=%25_', 'GET')).items.length, 1);
      assert.equal((await request('contact', '/api/process-design/versions/' + searchIds[0] + '/procedure-markdown')).status, 409);
      assert.equal((await request('contact', '/api/process-design/versions/' + searchIds[24] + '/content')).status, 403);
      const searchPanel = page.locator('[data-version-search]');
      const searchInput = page.getByLabel('制度编号或标题', { exact: true });
      await page.getByLabel('上下文标题', { exact: true }).fill('检索不清空台账输入');
      await searchInput.fill('检索合成版本'); await button('检索版本').click();
      await searchPanel.locator('[data-version-result]').first().waitFor();
      assert.equal(await searchPanel.locator('[data-version-result]').count(), 20);
      await button('更早版本').click(); await searchPanel.locator(`[data-version-result="${searchIds[0]}"]`).waitFor();
      assert.equal(await searchPanel.locator('[data-version-result]').count(), 4);
      const retiredRow = searchPanel.locator(`[data-version-result="${searchIds[0]}"]`);
      assert.equal(await retiredRow.getByRole('button', { name: '下载版本程序文件' }).isDisabled(), true);
      await retiredRow.getByRole('button', { name: '查阅版本正文' }).click();
      await page.locator('[data-version-search-content]').waitFor();
      await retiredRow.getByRole('button', { name: '查看版本图形' }).click(); await ready(); assert.match(await sourceText(), /retired/);
      const downloadRow = searchPanel.locator(`[data-version-result="${searchIds[1]}"]`);
      const procedureDownload = page.waitForEvent('download'); await downloadRow.getByRole('button', { name: '下载版本程序文件' }).click();
      await (await procedureDownload).saveAs(path.join(output, 'searched-procedure.md'));
      for (const status of [403, 409, 503]) {
        await page.route('**/api/process-design/versions?*', route => route.fulfill({ status, json: { error: 'synthetic search fault' } }), { times: 1 });
        await button('检索版本').click(); await button('重试版本检索').waitFor();
        assert.equal(await searchPanel.locator('[data-version-result]').count(), 0);
        assert.equal(await searchInput.inputValue(), '检索合成版本');
        await button('重试版本检索').click(); await searchPanel.locator('[data-version-result]').first().waitFor();
      }
      let releaseSearch, searchEntered;
      const searchBlock = new Promise(resolve => { releaseSearch = resolve; }), searchArrival = new Promise(resolve => { searchEntered = resolve; });
      await page.route('**/api/process-design/versions?*', async route => {
        searchEntered(); await searchBlock;
        await route.fulfill({ json: { items: [{ id: '999', document_title: '迟到检索' }], coverage: 'visible_native_versions' } }).catch(() => {});
      }, { times: 1 });
      await button('检索版本').click(); await searchArrival; await searchInput.fill('不存在的版本');
      await button('检索版本').click(); await searchPanel.getByText('当前条件和权限范围内没有版本。').waitFor();
      releaseSearch(); await page.waitForTimeout(100); assert.equal(await searchPanel.getByText('迟到检索').count(), 0);
      assert.equal(await page.getByLabel('上下文标题', { exact: true }).inputValue(), '检索不清空台账输入');
      await searchInput.fill('检索合成版本'); await button('检索版本').click(); await searchPanel.locator('[data-version-result]').first().waitFor();
      await page.getByLabel('上下文标题', { exact: true }).fill('');
      await page.reload(); await searchPanel.locator('[data-version-result]').first().waitFor();
      assert.equal(await searchInput.inputValue(), '检索合成版本');
      await button('更早版本').click(); await searchPanel.locator(`[data-version-result="${searchIds[0]}"]`).waitFor();
      await page.goBack(); await searchPanel.locator(`[data-version-result="${searchIds[23]}"]`).waitFor();
      assert.equal(await searchPanel.locator('[data-version-result]').count(), 20);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await searchPanel.screenshot({ path: path.join(output, 'version-search-desktop.png') });
      checks.push('version search real V7/V8 mixed states, scope before pagination, literal search, invalid queries, anonymous/admin, content/procedure/graph, errors/late response, input preservation and reload/back');
      // Restore the original published graph before the existing session-revocation scenario.
      await direct(published.process_version_id); await ready();
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=183');
      await button('刷新图形').click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor(); await login('outsider');
      await page.locator('[data-diagram-state="error"]').waitFor(); assert.equal(await page.locator('.native-diagram-viewport').count(), 0);
      assert.equal((await request('outsider', root + '/cases/' + id)).status, 403);
      await button('退出登录').click(); await login('adminMulti'); await ready(); assert.match(await sourceText(), /已发布/);
      assert.equal((await request('anonymous', root + '/cases/' + id)).status, 401);
      assert.deepEqual(await snapshot(), before); assert.equal(writes, 0);
      checks.push('refresh/back and old entry, real session revocation, department isolation, anonymous denial, admin read-only and unchanged source/version');
      assert.deepEqual(errors, []);
      const unexpectedConsole = consoleErrors.filter(x => !/Failed to load resource|net::ERR_|status of (401|403|409|503)/.test(x)); assert.deepEqual(unexpectedConsole, []);
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, errors, unexpectedConsole, writes, geometry }, null, 2));
    } catch (e) {
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ error: e.message, stack: e.stack, errors }, null, 2));
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true, timeout: 10000 }).catch(() => {}); throw e;
    } finally { clearTimeout(deadline); await browser.close(); }
  }, { evidenceDir: output });
}
main().catch(e => { console.error(e); process.exitCode = 1; });
