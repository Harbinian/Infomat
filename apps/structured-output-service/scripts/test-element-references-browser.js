'use strict';

// Uses only synthetic V8 data in an explicitly selected, already running candidate.
// NODE_PATH or --PlaywrightModule may point to an existing Playwright installation.
// Run: node scripts/test-element-references-browser.js --BaseUrl http://127.0.0.1:3011
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createReviewLayoutFixture } = require('./review-layout-fixture');
const Lifecycle = require('../public/lifecycle-analyzer');

const VIEWPORT = Object.freeze({ width: 1699, height: 828 });
const PREVIEWS = [
  'enterprise-catalog', 'enterprise-mapping', 'cross-process', 'mapping-recheck',
  'department-review', 'publish', 'data-governance', 'flow-animation',
  'lifecycle-execution', 'form-execution'
];

function optionsFrom(argv) {
  const options = { headed: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--Headed' || key === '--headed') options.headed = true;
    else if (['--BaseUrl', '--base-url', '--OutputDir', '--PlaywrightModule'].includes(key)) {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      options[key === '--base-url' ? 'BaseUrl' : key.slice(2)] = value;
    } else throw new Error(`Unknown argument: ${key}`);
  }
  if (!options.BaseUrl) throw new Error('--BaseUrl is required; this script never defaults to port 3001.');
  const url = new URL(options.BaseUrl);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || !url.port || ['3000', '3001'].includes(url.port) || url.username || url.password
      || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('--BaseUrl must be an explicit loopback candidate origin; ports 3000 and 3001 are forbidden.');
  }
  options.BaseUrl = url.origin;
  options.OutputDir = path.resolve(options.OutputDir || path.join(__dirname, '../../..',
    'output/playwright/element-references', `run-${Date.now()}`));
  return options;
}

function createFixture() {
  const fixture = createReviewLayoutFixture();
  fixture.process.process_name = '元素关系引用：合成浏览器验证';
  fixture.process.scope = '虚构测试数据，只用于隔离候选验证';
  const object = fixture.data_objects[0];
  const review = fixture.behaviors.find(item => item.behavior_ref === 'behavior_review');
  Object.assign(review, {
    actor_assignment_mode: 'dynamic_from_data', current_actor_role: '',
    actor_department_data_ref: object.data_ref, actor_position_rule: '按合成申请数据确定测试岗位',
    behavior_description: '核对合成申请，归档申请资料。'
  });
  object.behavior_links.push({
    link_ref: 'data_link_reference_update', behavior_ref: review.behavior_ref,
    operation: 'update', updated_field_refs: ['field_amount']
  });
  object.source_relations.push({
    source_ref: 'source_reference_fixture', source_department: '财务部',
    source_process_name: '合成外部流程', source_behavior_name: '合成来源环节',
    source_data_name: '合成来源记录', availability_mode: 'at_behavior',
    available_from_behavior_ref: 'behavior_fixture_submit'
  });
  fixture.forms[0].areas[0].items[0].source_links.push({
    source_link_ref: 'field_source_reference_fixture', source_type: 'process_data',
    source_data_ref: 'data_unlinked', source_system_name: '', source_data_name: '',
    source_role: 'validation_basis'
  });
  object.lifecycle = Lifecycle.analyzeDataObject(fixture, object.data_ref).lifecycle;
  assert.ok(object.lifecycle.routes.some(route => route.flow_relation_refs.length
    && route.events.some(event => event.trigger.behavior_ref === review.behavior_ref)),
  'The synthetic fixture must cover lifecycle route and trigger references');
  return fixture;
}

async function main(options) {
  let playwright;
  try { playwright = require(options.PlaywrightModule || 'playwright'); }
  catch (error) {
    throw new Error(`Installed Playwright is required. Set NODE_PATH or --PlaywrightModule; no package is installed by this script. ${error.code || error.message}`);
  }
  const fixture = createFixture();
  const checks = [];
  const forbiddenRequests = [];
  const requests = [];
  const pageErrors = [];
  const consoleProblems = [];
  const apiErrors = [];
  const previewIds = new Set();
  const result = { passed: false, BaseUrl: options.BaseUrl, browser: 'msedge', viewport: VIEWPORT, checks };
  await fs.mkdir(options.OutputDir, { recursive: true });
  const browser = await playwright.chromium.launch({ channel: 'msedge', headless: !options.headed });
  const context = await browser.newContext({ viewport: VIEWPORT, baseURL: options.BaseUrl, acceptDownloads: true });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const remote = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== options.BaseUrl;
    const governanceApi = /^\/api\/(data-map-definitions|v7-mappings|process-v7-preview|process-design|process-data-governance)(\/|$)/.test(url.pathname);
    if (remote || governanceApi) {
      forbiddenRequests.push({ method: request.method(), origin: url.origin, path: url.pathname });
      await route.abort('blockedbyclient');
    } else await route.continue();
  });
  await context.addInitScript(() => {
    window.__elementReferenceStorageWrites = [];
    for (const method of ['setItem', 'removeItem', 'clear']) {
      const original = Storage.prototype[method];
      Storage.prototype[method] = function (...args) {
        window.__elementReferenceStorageWrites.push(`Storage.${method}`);
        return original.apply(this, args);
      };
    }
    const originalOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => {
      window.__elementReferenceStorageWrites.push('indexedDB.open');
      return originalOpen(...args);
    };
  });
  context.on('request', request => {
    const url = new URL(request.url());
    requests.push({ method: request.method(), origin: url.origin, path: url.pathname });
  });
  context.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.startsWith('/api/') && response.status() >= 400) apiErrors.push({ path: url.pathname, status: response.status() });
  });
  const page = await context.newPage();
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('console', message => {
    if (['warning', 'error'].includes(message.type())) consoleProblems.push({ type: message.type(), text: message.text() });
  });
  const panel = () => page.locator('[data-element-references]');
  const direction = name => panel().locator(`[data-element-reference-direction="${name}"]`);
  const targetLink = (scope, kind, ref) => scope.locator(`[data-action="review-open"][data-kind="${kind}"][data-ref="${ref}"]`).first();
  const detailTargetKey = () => page.locator('#reviewDetail').getAttribute('data-target-key');
  const expectTarget = async (kind, ref, parentRef = '') => {
    const expected = JSON.stringify([kind, parentRef, ref]);
    await page.waitForFunction(key => document.querySelector('#reviewDetail')?.dataset.targetKey === key, expected);
  };
  const documentText = () => page.evaluate(() => JSON.stringify(currentDocument()));
  const snapshot = () => page.evaluate(() => {
    const state = graphStateManager.snapshot(candidateStateKey(), currentDocument());
    return { document: JSON.stringify(currentDocument()), canUndo: state.canUndo, canRedo: state.canRedo };
  });
  const goTask = label => page.locator('.workspace-tabs [data-action="switch-governance-step"]').filter({ hasText: label }).click();
  const openFlowList = async () => {
    await goTask('编制环节与流转');
    await page.locator('[data-action="switch-step-view"][data-view="list"]').click();
  };
  const selectBehavior = async ref => {
    await openFlowList();
    await page.locator(`[data-action="select-skeleton-item"][data-kind="behavior"][data-ref="${ref}"]`).click();
    await expectTarget('behavior', ref);
  };
  const openFormItem = async () => {
    await selectBehavior('behavior_review');
    await targetLink(direction('incoming'), 'form', 'form_application').click();
    await expectTarget('form', 'form_application');
    await targetLink(page.locator('#reviewDetail'), 'form-item', 'item_amount').click();
    await expectTarget('form-item', 'item_amount', 'form_application');
  };
  const collectPreviews = async () => {
    const buttons = page.locator('[data-feature-preview]');
    const before = requests.length;
    for (let index = 0; index < await buttons.count(); index += 1) {
      const button = buttons.nth(index);
      const id = await button.getAttribute('data-feature-preview');
      assert.ok(await button.isDisabled(), `Preview ${id} must be disabled`);
      assert.match(await button.textContent(), /预览/, `Preview ${id} must be labeled`);
      await button.evaluate(element => element.click());
      previewIds.add(id);
    }
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(requests.length, before, 'Disabled preview controls must issue no requests');
  };
  const restoreFixture = async () => {
    // Fault injection/restoration affects this synthetic browser document only.
    await page.evaluate(value => {
      const documentValue = currentDocument();
      for (const key of Object.keys(documentValue)) delete documentValue[key];
      Object.assign(documentValue, structuredClone(value));
      editSessionManager.reset();
      reviewContext().editingGroup = '';
      render();
    }, fixture);
  };

  try {
    const health = await context.request.get('/api/health');
    assert.ok(health.ok(), 'The explicitly selected candidate must respond to /api/health');
    assert.equal((await health.json()).schema_version, 'process-governance-v8');
    const validation = await context.request.post('/api/validate', { data: { data: fixture } });
    assert.ok(validation.ok(), 'Synthetic fixture validation must respond successfully');
    const validated = await validation.json();
    assert.equal(validated.valid, true, `Synthetic fixture is invalid: ${JSON.stringify(validated.errors)}`);
    checks.push('candidate-v8-health-and-synthetic-fixture-validation');

    await page.goto(options.BaseUrl, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.body.classList.contains('compact-task-ui'));
    assert.match(await page.evaluate(() => navigator.userAgent), /Edg\//);
    assert.deepEqual(await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scale: visualViewport.scale })), { ...VIEWPORT, scale: 1 });
    const chooserPromise = page.waitForEvent('filechooser');
    await page.locator('#workspace [data-action="open-import-file"]').click();
    await (await chooserPromise).setFiles({ name: 'element-references-synthetic-v8.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture), 'utf8') });
    await page.waitForFunction(ref => !busy && candidates.length === 1
      && currentDocument()?.process.process_ref === ref
      && document.querySelector('#statusBox')?.classList.contains('success'), fixture.process.process_ref);
    assert.equal(await documentText(), JSON.stringify(fixture), 'Native V8 import must preserve the synthetic JSON');
    const imported = await snapshot();
    checks.push('real-filechooser-v8-import-edge-desktop');

    await selectBehavior('behavior_review');
    await panel().waitFor({ state: 'visible' });
    assert.ok(await direction('outgoing').locator('[data-reference-path$="/actor_department_data_ref"]').count());
    assert.ok(await direction('incoming').locator('[data-reference-path*="/behavior_links/"]').count());
    await targetLink(direction('outgoing'), 'data', 'data_fixture_application').click();
    await expectTarget('data', 'data_fixture_application');
    assert.ok(await direction('outgoing').locator('[data-reference-path*="/flow_relation_refs/"]').count(), 'Lifecycle route references must be visible');
    assert.ok(await direction('outgoing').locator('[data-reference-path$="/trigger/behavior_ref"]').count(), 'Lifecycle trigger references must be visible');
    await targetLink(page.locator('#reviewDetail'), 'data-field', 'field_amount').click();
    await expectTarget('data-field', 'field_amount', 'data_fixture_application');
    assert.ok(await direction('incoming').locator('[data-reference-path$="/data_field_ref"]').count());
    assert.ok(await direction('incoming').locator('[data-reference-path*="/updated_field_refs/"]').count());
    await page.screenshot({ path: path.join(options.OutputDir, 'field-reverse-references.png'), fullPage: false });
    await panel().evaluate(element => {
      const detail = element.closest('#reviewDetail');
      detail.scrollTop += element.getBoundingClientRect().top - detail.getBoundingClientRect().top - 12;
    });
    await page.screenshot({ path: path.join(options.OutputDir, 'field-reference-panel.png'), fullPage: false });
    await targetLink(direction('incoming'), 'form-item', 'item_amount').click();
    await expectTarget('form-item', 'item_amount', 'form_application');
    assert.ok(await direction('outgoing').locator('[data-reference-path$="/source_data_ref"]').count());
    await targetLink(direction('outgoing'), 'data', 'data_unlinked').click();
    await expectTarget('data', 'data_unlinked');
    assert.ok(await direction('incoming').locator('[data-reference-path$="/source_data_ref"]').count());
    await page.locator('#reviewDetail [data-action="review-back"]:not([data-index])').click();
    await expectTarget('form-item', 'item_amount', 'form_application');
    checks.push('forward-reverse-dynamic-actor-update-field-form-source-lifecycle-navigation-and-back');

    await collectPreviews();
    await goTask('整理数据与表单');
    const catalogButton = page.locator('[data-action="review-catalog"]').first();
    if (await catalogButton.count()) await catalogButton.click();
    await collectPreviews();
    await targetLink(page.locator('#workspace'), 'data', 'data_fixture_application').click();
    await expectTarget('data', 'data_fixture_application');
    await page.locator('#reviewDetail [data-action="review-manage"]').click();
    await page.locator('[data-action="switch-data-mode"][data-mode="lifecycle"]').click();
    await collectPreviews();
    await goTask('检查问题并下载');
    await collectPreviews();
    await goTask('编制环节与流转');
    await page.locator('[data-action="switch-step-view"][data-view="diagram"]').click();
    await collectPreviews();
    const flowControls = await page.locator('[data-action="toggle-diagram-expanded"]').evaluate(button => {
      const controls = button.closest('.diagram-controls');
      const preview = controls.querySelector('[data-feature-preview="flow-animation"]').closest('.feature-preview');
      const textRange = document.createRange();
      textRange.selectNodeContents(button);
      const lineTops = [...textRange.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top));
      const bounds = controls.getBoundingClientRect();
      const previewBounds = preview.getBoundingClientRect();
      const precedingBottom = Math.max(...[...controls.children].filter(child => child !== preview).map(child => child.getBoundingClientRect().bottom));
      return {
        fullScreenTextLines: new Set(lineTops).size,
        previewTop: previewBounds.top, precedingBottom,
        previewWidth: previewBounds.width, controlsWidth: bounds.width,
        controlsOverflow: controls.scrollWidth > controls.clientWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth
      };
    });
    assert.equal(flowControls.fullScreenTextLines, 1, 'The full-screen flow button must display on one line');
    assert.ok(flowControls.previewTop >= flowControls.precedingBottom - 1, 'The animation preview must occupy a separate row below the actual flow controls');
    assert.ok(flowControls.previewWidth >= flowControls.controlsWidth - 1, 'The preview row must span the flow controls width');
    assert.equal(flowControls.controlsOverflow, false, 'Flow controls must not overflow horizontally');
    assert.equal(flowControls.pageOverflow, false, 'The 1699px desktop flow page must not overflow horizontally');
    result.flowControlGeometry = flowControls;
    checks.push('flow-fullscreen-button-single-line-preview-separate-row-no-horizontal-overflow');
    assert.deepEqual([...previewIds].sort(), [...PREVIEWS].sort(), 'Every declared unsupported feature must have a disabled preview entry');
    assert.deepEqual(await snapshot(), imported, 'Read-only navigation and previews must not change JSON or transaction history');
    await page.screenshot({ path: path.join(options.OutputDir, 'flow-reference-previews.png'), fullPage: false });
    checks.push('all-ten-disabled-preview-entries-no-requests-and-read-only-json-history');

    await selectBehavior('behavior_review');
    const actorDataSelect = () => page.locator('#reviewDetail [data-graph-property="actor_department_data_ref"]');
    const actorEdit = () => page.locator('#reviewDetail [data-action="review-edit"][data-group="people"]');
    await actorEdit().click();
    const availableActorOption = actorDataSelect().locator('option[value="data_fixture_application"]');
    assert.equal(await availableActorOption.count(), 1, 'The produced predecessor data must remain a candidate for the dynamic actor');
    assert.equal(await availableActorOption.evaluate(option => option.disabled), false, 'Available predecessor option must be enabled');
    assert.equal(await actorDataSelect().locator('option[value="data_unlinked"]:not([disabled])').count(), 0, 'Unproduced data must not become a new dynamic-actor candidate');
    assert.equal(await documentText(), imported.document, 'Reading dynamic-actor options must not change JSON');
    await restoreFixture();
    await page.evaluate(() => {
      currentDocument().behaviors.find(item => item.behavior_ref === 'behavior_review').actor_department_data_ref = 'data_missing_actor_fixture';
    });
    const missingActorDocument = await documentText();
    await selectBehavior('behavior_review');
    await actorEdit().click();
    assert.equal(await actorDataSelect().inputValue(), 'data_missing_actor_fixture', 'The missing existing reference must remain selected');
    const missingActorOption = actorDataSelect().locator('option[value="data_missing_actor_fixture"]');
    assert.equal(await missingActorOption.count(), 1);
    assert.equal(await missingActorOption.evaluate(option => option.disabled), true, 'Missing original reference option must be disabled');
    assert.equal(await missingActorOption.evaluate(option => option.selected), true, 'Missing original reference option must stay selected');
    assert.match(await missingActorOption.textContent(), /不存在.*原值保留/);
    assert.equal(await documentText(), missingActorDocument, 'Viewing a missing dynamic actor reference must neither clear nor apply it');
    await restoreFixture();
    checks.push('dynamic-actor-picker-produced-predecessor-only-missing-reference-selected-disabled-preserved');

    for (const status of ['missing', 'ambiguous', 'wrong-owner']) {
      await restoreFixture();
      await openFormItem();
      const staleLink = targetLink(direction('outgoing'), 'data-field', 'field_amount');
      const initialTarget = await detailTargetKey();
      await page.evaluate(kind => {
        const value = currentDocument();
        if (kind === 'missing') value.data_objects[0].fields = [];
        else if (kind === 'ambiguous') value.data_objects[1].fields.push(structuredClone(value.data_objects[0].fields[0]));
        else value.forms[0].areas[0].items[0].business_data_ref = 'data_unlinked';
      }, status);
      const injected = await documentText();
      await staleLink.click();
      assert.equal(await detailTargetKey(), initialTarget, `A stale ${status} reference must not navigate`);
      assert.equal(await documentText(), injected);
      await page.evaluate(() => render());
      const row = direction('outgoing').locator(`[data-element-reference-status="${status}"][data-reference-path$="/data_field_ref"]`);
      assert.equal(await row.count(), 1, `${status} must have an explicit reference status`);
      assert.equal(await row.locator('[data-action="review-open"]').count(), 0, `${status} must offer no navigation`);
      await row.click();
      assert.equal(await detailTargetKey(), initialTarget);
      assert.equal(await documentText(), injected, `${status} reading must not repair or alter the JSON`);
      checks.push(`${status}-reference-explicit-status-no-navigation-no-mutation`);
    }

    await restoreFixture();
    await selectBehavior('behavior_fixture_submit');
    const edit = () => page.locator('#reviewDetail [data-action="review-edit"][data-group="people"]');
    const input = () => page.locator('#reviewDetail [data-graph-property="behavior_name"]');
    const incomingRoute = () => page.locator('[data-action="select-skeleton-item"][data-kind="relation"][data-ref="flow_submit_review"]');
    const pending = page.locator('#pendingEditModal');
    const beforeEdit = await documentText();
    const changedName = '候选验证：修改环节名称';
    await edit().click();
    await input().fill(changedName);
    await incomingRoute().click();
    await pending.waitFor({ state: 'visible' });
    assert.ok(await page.locator('#applyPendingEditButton').isEnabled());
    await page.locator('#continuePendingEditingButton').click();
    await pending.waitFor({ state: 'hidden' });
    await expectTarget('behavior', 'behavior_fixture_submit');
    assert.equal(await input().inputValue(), changedName);
    assert.equal(await documentText(), beforeEdit);
    await incomingRoute().click();
    await pending.waitFor({ state: 'visible' });
    await page.locator('#discardPendingEditButton').click();
    await expectTarget('relation', 'flow_submit_review');
    assert.equal(await documentText(), beforeEdit);
    await selectBehavior('behavior_fixture_submit');
    await edit().click();
    await input().fill(changedName);
    await incomingRoute().click();
    await pending.waitFor({ state: 'visible' });
    await page.locator('#applyPendingEditButton').click();
    await expectTarget('relation', 'flow_submit_review');
    const expectedApplied = JSON.parse(beforeEdit);
    expectedApplied.behaviors[0].behavior_name = changedName;
    assert.equal(await documentText(), JSON.stringify(expectedApplied), 'Apply-and-continue must commit only the original object patch');
    checks.push('reference-navigation-pending-continue-discard-apply-preserves-input-and-patch-scope');

    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-action="download-current-stage"]').first().click();
    const download = await downloadPromise;
    const downloadedBytes = await fs.readFile(await download.path());
    const downloadedDocument = JSON.parse(downloadedBytes.toString('utf8'));
    await page.waitForFunction(() => !busy && currentEntry()?.lastDownload);
    const downloadedMetadata = await page.evaluate(() => currentEntry().lastDownload);
    assert.match(download.suggestedFilename(), /^未审核-.*\.json$/);
    assert.equal(downloadedMetadata.sha256, createHash('sha256').update(downloadedBytes).digest('hex'), 'Download summary must hash the actual downloaded bytes');
    const expectedDownloaded = structuredClone(expectedApplied);
    expectedDownloaded.export_meta.exported_at = downloadedDocument.export_meta.exported_at;
    assert.deepEqual(downloadedDocument, expectedDownloaded, 'Download must preserve the applied patch and all references');
    assert.equal(await documentText(), JSON.stringify(downloadedDocument), 'Downloaded document must become the current snapshot');
    await page.locator('.governance-header-actions .header-menu summary').filter({ hasText: /^文件$/ }).click();
    const reimportChooser = page.waitForEvent('filechooser');
    await page.locator('.governance-header-actions [data-action="open-import-file"]').click();
    await (await reimportChooser).setFiles({ name: download.suggestedFilename(), mimeType: 'application/json', buffer: downloadedBytes });
    await page.waitForFunction(expected => !busy && candidates.length === 1
      && JSON.stringify(currentDocument()) === expected
      && document.querySelector('#statusBox')?.classList.contains('success'), JSON.stringify(downloadedDocument));
    await openFormItem();
    assert.equal(await direction('outgoing').locator('[data-element-reference-status="valid"][data-reference-path$="/data_field_ref"]').count(), 1);
    assert.equal(await documentText(), JSON.stringify(downloadedDocument));
    checks.push('real-download-byte-sha256-reimport-reference-preservation');

    const storage = await page.evaluate(async () => ({
      localStorage: localStorage.length, sessionStorage: sessionStorage.length,
      writes: window.__elementReferenceStorageWrites,
      databases: typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    }));
    assert.deepEqual(storage, { localStorage: 0, sessionStorage: 0, writes: [], databases: [] });
    assert.deepEqual(await context.cookies(), []);
    assert.deepEqual(forbiddenRequests, [], 'No request may leave the selected candidate or access a governance API');
    assert.deepEqual(apiErrors, []);
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(consoleProblems, []);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Desktop page must not overflow horizontally');
    checks.push('no-browser-persistence-no-3000-or-external-request-no-console-errors-no-horizontal-overflow');
    Object.assign(result, { passed: true, previewIds: [...previewIds].sort(), requestCount: requests.length, storage });
  } catch (error) {
    Object.assign(result, { error: error.message, forbiddenRequests, pageErrors, consoleProblems, apiErrors });
    await page.screenshot({ path: path.join(options.OutputDir, 'failure.png'), fullPage: false }).catch(() => {});
    throw error;
  } finally {
    await fs.writeFile(path.join(options.OutputDir, 'report.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8');
    await context.close();
    await browser.close();
    console.log(JSON.stringify({ ...result, OutputDir: options.OutputDir }, null, 2));
  }
}

if (require.main === module) {
  Promise.resolve().then(() => main(optionsFrom(process.argv.slice(2)))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { optionsFrom, createFixture };
