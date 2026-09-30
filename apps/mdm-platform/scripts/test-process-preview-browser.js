// P21 real Edge/HTTP/MySQL verification. Input: --output <new repository artifacts directory>.
// Uses only the ownership-checked tmpfs fixture and synthetic documents/identities.
// Browser faults are explicitly injected; all other writes reach the real isolated repository.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const { pendingLifecycle } = require('../../structured-output-service/public/process-governance-migration');
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
assert.ok(!fs.existsSync(output), 'do not overwrite prior evidence'); fs.mkdirSync(output, { recursive: true });
async function main() {
  await withStage05Fixture(async ({ fixture, expect, request, pool }) => {
    const browser = await runtime().chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ viewport: { width: 1699, height: 828 }, deviceScaleFactor: 1 });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const checks = [], pageErrors = [], responses = [], consoleErrors = [], geometry = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    page.on('console', e => { if (e.type() === 'error') consoleErrors.push(e.text()); });
    page.on('response', r => { if (r.status() >= 400) responses.push({ path: new URL(r.url()).pathname, status: r.status() }); });
    const base = fixture.baseURL, root = '/api/process-v7-preview';
    async function login(who) {
      await page.locator('#login-name').fill('SYNTHETIC_' + who);
      await page.locator('#login-password').fill(fixture.loginPassword);
      await page.getByRole('button', { name: '登录', exact: true }).click();
      await page.getByRole('button', { name: '退出登录' }).waitFor();
    }
    async function logout() { await page.getByRole('button', { name: '退出登录' }).click(); await page.locator('#login-name').waitFor(); }
    async function idle() { await page.getByRole('button', { name: '刷新案例与当前修订' }).waitFor(); await page.waitForFunction(() => ![...document.querySelectorAll('button')].find(b => b.textContent === '刷新案例与当前修订')?.disabled); }
    async function upload(doc, name = 'synthetic.json') { await page.getByLabel('流程JSON文件', { exact: true }).setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(doc)) }); await page.getByText(name, { exact: false }).first().waitFor(); }
    async function discard() { page.once('dialog', d => d.accept()); await page.getByRole('button', { name: '放弃本次编辑' }).click(); }
    async function noOverflow() { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.equal(await page.evaluate(() => visualViewport.scale), 1); }
    async function graphEvidence(mode) {
      const state = await page.locator('.preview-canvas').evaluate(el => {
        const cy = el._cyreg?.cy;
        if (!cy) return null;
        const nodes = cy.nodes().filter(n => !n.isParent() && (n.hasClass('behavior-node') || n.data('kind') === 'behavior' || n.data('kind') === 'data'));
        return { nodes: nodes.map(n => ({ id: n.id(), box: n.boundingBox() })), edges: cy.edges().map(e => ({ id: e.id(), source: e.source().id(), target: e.target().id(), arrow: e.style('target-arrow-shape') })), width: el.clientWidth, height: el.clientHeight };
      });
      assert.ok(state && state.edges.length, 'actual Cytoscape graph contains edges');
      assert.ok(state.edges.some(e => e.arrow !== 'none'), 'visible direction arrows');
      for (let i = 0; i < state.nodes.length; i++) for (let j = i + 1; j < state.nodes.length; j++) {
        const a = state.nodes[i].box, b = state.nodes[j].box;
        assert.ok(a.x2 <= b.x1 || b.x2 <= a.x1 || a.y2 <= b.y1 || b.y2 <= a.y1, 'graph nodes do not overlap');
      }
      geometry.push({ mode, ...state });
      await page.locator('.preview-graph').screenshot({ path: path.join(output, mode + '-graph.png') });
    }
    const source = structuredClone(fixture.document); source.schema_version = 'process-governance-v8';
    source.behaviors.push({ ...source.behaviors[0], behavior_ref: 'decision_basis', node_type: 'decision', behavior_name: '是否具备合格证明', actor_assignment_mode: 'company_wide', current_actor_role: '全公司' });
    source.flow_relations.push({ relation_ref: 'relation_decision', relation_type: 'sequence', from_behavior_ref: 'behavior_receive', to_behavior_ref: 'decision_basis', condition: '' });
    source.data_objects = [{ data_ref: 'data_basis', data_name: '合成判断依据对象', description: '用于核对判断数据依据', information_type: 'file_attachment', fields: [{ field_ref: 'field_result', field_name: '合格结论', field_type: '文本', definition: '合成结果' }], behavior_links: [{ link_ref: 'link_basis', behavior_ref: 'decision_basis', operation: 'use', updated_field_refs: [] }, { link_ref: 'link_check', behavior_ref: 'behavior_check', operation: 'use', updated_field_refs: [] }], source_relations: [], lifecycle: pendingLifecycle() }];
    fs.writeFileSync(path.join(output, 'source-v8.json'), JSON.stringify(source, null, 2));
    try {
      await page.goto(base + '/app/process-preview'); await login('contact'); await idle();
      await page.getByText('当前范围暂无案例。', { exact: false }).waitFor(); checks.push('empty authenticated list');
      await page.getByRole('button', { name: '新建流程预览案例' }).click(); await upload(source);
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      const id = new URL(page.url()).searchParams.get('case'); assert.ok(id);
      let detail = await expect('lead', root + '/cases/' + id, 'GET');
      assert.deepEqual(detail.revision.document, source); assert.equal(detail.preview_only, true); assert.equal(detail.formal_process_version_id, null);
      await page.getByText('判断节点', { exact: true }).waitFor(); assert.ok(await page.getByText('合格结论', { exact: false }).count());
      checks.push('V8 browser upload persists native JSON/version and decision-use fields');
      await page.reload(); await idle(); await page.getByRole('heading', { name: source.process.process_name, exact: true }).waitFor();
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); await page.goBack(); await idle();
      assert.equal(new URL(page.url()).searchParams.get('case'), id); checks.push('deep link refresh and back restore selected case');
      await page.getByRole('button', { name: '查看本修订图形' }).click(); await page.locator('.preview-canvas canvas').first().waitFor();
      await graphEvidence('process');
      await noOverflow(); await page.screenshot({ path: path.join(output, 'desktop-process.png'), fullPage: true });
      await page.getByLabel('图形视图', { exact: true }).selectOption('data'); await page.locator('.preview-canvas canvas').first().waitFor();
      await graphEvidence('data');
      const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: '下载图形PNG' }).click();
      await (await downloadEvent).saveAs(path.join(output, 'export-data.png'));
      assert.ok(fs.statSync(path.join(output, 'export-data.png')).size > 1000);
      await page.screenshot({ path: path.join(output, 'desktop-data.png'), fullPage: true });
      await noOverflow();
      await page.setViewportSize({ width: 1699, height: 828 }); checks.push('local process/data renderers and desktop containment');
      const old = structuredClone(fixture.document); old.process.process_ref = 'legacy_v7_p21'; old.process.process_name = '历史V7合成案例';
      const legacy = await expect('contact', root + '/cases', 'POST', { document: old, source_file_name: 'legacy-v7.json' }, 201);
      const legacyId = legacy.case.id;
      await page.getByRole('button', { name: '刷新案例与当前修订' }).click(); await idle();
      await page.getByLabel('选择流程案例', { exact: true }).selectOption(String(legacyId)); await idle();
      await page.getByText('process-governance-v7 ·', { exact: false }).waitFor();
      assert.deepEqual((await expect('lead', root + '/cases/' + legacyId, 'GET')).revision.document, old); checks.push('V7 history read unchanged');
      await page.getByLabel('选择流程案例', { exact: true }).selectOption(id); await idle();
      await page.getByRole('button', { name: '上传3001新修订' }).click();
      const bad = structuredClone(source); bad.data_objects[0].behavior_links[0].operation = 'create'; await upload(bad, 'invalid-v8.json');
      await page.getByRole('button', { name: '比较新修订影响' }).click(); await page.getByRole('alert').waitFor();
      assert.equal((await expect('lead', root + '/cases/' + id, 'GET')).case.current_revision_no, 1);
      assert.ok(await page.getByText('invalid-v8.json', { exact: false }).count()); await discard(); checks.push('decision-create rejected without losing upload or changing revision');
      await logout(); await login('reviewA'); await idle();
      await page.getByRole('button', { name: '记录本部门核对结果' }).first().click();
      await page.getByLabel('核对结果', { exact: true }).selectOption('needs_changes'); await page.getByLabel('核对依据', { exact: true }).fill('合成证据需要补充，请回3001修订。');
      for (const status of [403, 409, 503]) {
        await page.route('**/api/process-v7-preview/items/*/decision', r => r.fulfill({ status, contentType: 'application/json', body: '{"error":"internal diagnostic"}' }), { times: 1 });
        await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByRole('alert').waitFor();
        assert.equal(await page.getByLabel('核对依据', { exact: true }).inputValue(), '合成证据需要补充，请回3001修订。');
        assert.ok(!(await page.getByRole('alert').innerText()).includes('diagnostic'));
      }
      await page.route('**/api/process-v7-preview/items/*/decision', r => r.abort('failed'), { times: 1 });
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByRole('alert').waitFor();
      page.once('dialog', d => d.dismiss()); await page.getByRole('link', { name: '当前身份', exact: true }).click();
      page.once('dialog', d => d.dismiss()); await page.reload().catch(() => {});
      assert.equal(await page.getByLabel('核对依据', { exact: true }).inputValue(), '合成证据需要补充，请回3001修订。');
      checks.push('403/409/503/network feedback and cancelled navigation/reload retain input');
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      detail = await expect('lead', root + '/cases/' + id, 'GET'); assert.ok(detail.items.some(i => i.origin_status === 'needs_changes'));
      checks.push('real needs-changes write with revision/hash and audit');
      await page.getByRole('button', { name: '记录本部门核对结果' }).first().click();
      await page.getByLabel('核对结果', { exact: true }).selectOption('confirmed'); await page.getByLabel('核对依据', { exact: true }).fill('登录失效仍保留的核对依据');
      await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=84');
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByRole('heading', { name: '请重新登录', exact: true }).waitFor();
      await login('reviewA'); await idle(); assert.equal(await page.getByLabel('核对依据', { exact: true }).inputValue(), '登录失效仍保留的核对依据');
      checks.push('real 401 reauthentication retains only same-identity draft');
      const next = structuredClone(source); next.data_objects[0].fields[0].definition = '修改后的合成结果定义';
      const revisionBody = { document: next, source_file_name: 'next-v8.json', expected_revision_no: detail.case.current_revision_no, expected_content_hash: detail.case.current_content_hash };
      const nextResult = await expect('contact', root + '/cases/' + id + '/revisions', 'POST', revisionBody, 201);
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByRole('alert').waitFor();
      await page.getByRole('button', { name: '刷新案例与当前修订' }).click(); await idle(); await page.getByText('来源已变化，当前输入仍保留').waitFor();
      assert.equal(await page.getByRole('button', { name: '保存预览核对记录' }).isDisabled(), true); await discard();
      detail = await expect('lead', root + '/cases/' + id, 'GET'); assert.ok(detail.items.some(i => i.carry_state === 'reopened')); assert.ok(detail.items.some(i => i.carry_state === 'carried_forward'));
      checks.push('real concurrent revision rejects old opinion; changed object reopens only affected items');
      await logout(); await login('contact'); await idle(); await page.getByRole('button', { name: '上传3001新修订' }).click();
      const third = structuredClone(next); third.process.purpose += ' 第三修订'; await upload(third, 'third-v8.json');
      await page.getByRole('button', { name: '比较新修订影响' }).click(); await page.getByRole('button', { name: '确认上传新修订' }).waitFor();
      assert.equal((await expect('lead', root + '/cases/' + id, 'GET')).case.current_revision_no, 2);
      await page.getByRole('button', { name: '确认上传新修订' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      detail = await expect('lead', root + '/cases/' + id, 'GET'); assert.equal(detail.case.current_revision_no, 3); assert.deepEqual(detail.revision.document, third);
      assert.equal((await request('contact', root + '/cases/' + id + '/revisions', 'POST', revisionBody)).status, 409); checks.push('browser comparison is non-writing; explicit confirmation saves once; stale replay rejected');
      for (const who of ['reviewA', 'reviewB']) {
        await logout(); await login(who); await idle();
        const count = await page.getByRole('button', { name: '记录本部门核对结果' }).count();
        for (let i = 0; i < count; i++) {
          await page.getByRole('button', { name: '记录本部门核对结果' }).nth(i).click();
          assert.equal(await page.locator('.preview-editor').evaluate(el => el === document.activeElement), true);
          await page.getByLabel('核对结果', { exact: true }).selectOption('confirmed');
          await page.getByLabel('核对依据', { exact: true }).fill('依据合成样本核对本部门事实，无正式审核含义。');
          await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
        }
      }
      assert.equal((await expect('lead', root + '/cases/' + id, 'GET')).case.status, 'review_complete');
      checks.push('both department reviewers complete preview with keyboard focus; no formal draft created');
      await logout(); await login('lead'); await idle();
      const unassigned = structuredClone(source); unassigned.process.process_ref = 'p21_pending_owner'; unassigned.process.owning_department = '';
      unassigned.process.process_name = '待分派合成案例';
      await page.getByRole('button', { name: '新建流程预览案例' }).click(); await upload(unassigned, 'unassigned-v8.json');
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      await page.getByRole('button', { name: '分派归口部门', exact: true }).click(); await page.getByLabel('归口部门', { exact: true }).selectOption('91');
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      const assignedId = new URL(page.url()).searchParams.get('case');
      assert.equal((await expect('lead', root + '/cases/' + assignedId, 'GET')).case.owning_department_id, 91);
      const zero = structuredClone(source); zero.process.process_ref = 'p21_zero_scope'; zero.process.process_name = '零跨部门合成案例';
      for (const b of zero.behaviors) { b.actor_assignment_mode = 'company_wide'; b.current_actor_role = '全公司'; }
      const zeroResult = await expect('lead', root + '/cases', 'POST', { document: zero, source_file_name: 'zero-v8.json' }, 201);
      await page.getByRole('button', { name: '刷新案例与当前修订' }).click(); await idle();
      await page.getByLabel('选择流程案例', { exact: true }).selectOption(String(zeroResult.case.id)); await idle();
      await page.getByRole('button', { name: '记录范围决定', exact: true }).click();
      await page.getByLabel('核对结果', { exact: true }).selectOption('confirmed_no_cross_department'); await page.getByLabel('核对依据', { exact: true }).fill('合成材料经明确核对，不涉及跨部门。');
      await page.getByRole('button', { name: '保存预览核对记录' }).click(); await page.getByText('保存完成', { exact: true }).waitFor(); await idle();
      assert.equal((await expect('lead', root + '/cases/' + zeroResult.case.id, 'GET')).case.status, 'review_complete');
      assert.equal(await page.getByText('待处理卡口', { exact: true }).count(), 0);
      const unresolved = structuredClone(zero); unresolved.behaviors[0].actor_assignment_mode = 'fixed_department'; unresolved.behaviors[0].current_actor_role = '未登记部门经办人';
      const z = (await expect('lead', root + '/cases/' + zeroResult.case.id, 'GET')).case;
      await expect('lead', root + '/cases/' + z.id + '/revisions', 'POST', { document: unresolved, source_file_name: 'unresolved-v8.json', expected_revision_no: z.current_revision_no, expected_content_hash: z.current_content_hash }, 201);
      await page.getByRole('button', { name: '刷新案例与当前修订' }).click(); await idle();
      await page.getByText('ACTOR_DEPARTMENT_UNRESOLVED', { exact: true }).waitFor(); assert.equal(await page.getByRole('button', { name: '记录范围决定', exact: true }).count(), 0);
      const uz = (await expect('lead', root + '/cases/' + z.id, 'GET')).case;
      assert.equal((await request('lead', root + '/cases/' + z.id + '/scope-decision', 'POST', { decision: 'confirmed_no_cross_department', basis: '不能绕过', expected_revision_no: uz.current_revision_no, expected_content_hash: uz.current_content_hash })).status, 409);
      checks.push('real owner assignment, zero-cross scope decision and unresolved actor gate cannot be bypassed');
      // A delayed result from an unmounted page must not replace the newly selected case.
      let release; const held = new Promise(resolve => { release = resolve; });
      let received; const started = new Promise(resolve => { received = resolve; });
      await page.route('**/api/process-v7-preview/cases/' + z.id, async route => { received(); await held; await route.continue().catch(() => {}); }, { times: 1 });
      await page.getByRole('button', { name: '刷新案例与当前修订' }).click(); await started;
      await page.getByRole('link', { name: '当前身份', exact: true }).click(); release();
      await page.getByRole('link', { name: '流程预览与核对', exact: true }).click(); await idle();
      assert.equal(await page.getByRole('heading', { name: zero.process.process_name, exact: true }).count(), 0);
      await page.getByLabel('选择流程案例', { exact: true }).selectOption(id); await idle();
      checks.push('late response after navigation does not restore previous case');
      await logout(); await login('adminMulti'); await idle();
      assert.equal(await page.getByRole('button', { name: '上传3001新修订' }).count(), 0); assert.equal(await page.getByRole('button', { name: '记录本部门核对结果' }).count(), 0);
      assert.equal((await request('adminMulti', root + '/cases', 'POST', { document: third, source_file_name: 'forbidden.json' })).status, 403);
      await logout(); await login('outsider'); await page.getByRole('alert').waitFor(); assert.equal(await page.getByRole('heading', { name: source.process.process_name, exact: true }).count(), 0);
      checks.push('admin multi-role read-only and unrelated department cannot read selected detail');
      const [formal] = await pool.execute('SELECT COUNT(*) AS n FROM process_design_drafts'); assert.equal(formal[0].n, 0);
      assert.deepEqual((await expect('lead', root + '/cases/' + legacyId, 'GET')).revision.document, old);
      assert.deepEqual(pageErrors, []);
      assert.ok(consoleErrors.every(e => /Failed to load resource|net::ERR_FAILED/.test(e)), 'no unexpected console errors');
      fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ passed: true, checks, pageErrors, consoleErrors, geometry, errorResponses: responses, formalDraftCount: formal[0].n, note: 'Fault-injected HTTP cases are separate from real repository writes; no manual business acceptance.' }, null, 2));
    } catch (error) {
      await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
      fs.writeFileSync(path.join(output, 'failure.json'), JSON.stringify({ message: error.message, stack: error.stack, checks, pageErrors, responses }, null, 2)); throw error;
    } finally { await browser.close(); }
  }, { evidenceDir: output, previewOnly: true });
}
main().catch(error => { console.error(error); process.exitCode = 1; });
