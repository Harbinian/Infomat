const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Pass an isolated Playwright page and the report's downloaded v7 JSON.
// All business edits use the UI. Evaluation only reads runtime verification evidence.
module.exports = async function checkInteractionReadability(page, { sourcePath, outputDir }) {
  fs.mkdirSync(outputDir, { recursive: true });
  const errors = [];
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const baseUrl = page.url();
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const importFile = async (target, file) => {
    console.log('Import through chooser');
    const chooser = target.waitForEvent('filechooser');
    await target.getByRole('button', { name: '继续已有流程', exact: true }).click();
    await (await chooser).setFiles(file);
    await target.locator('#processDiagramCanvas').waitFor({ state: 'visible' });
    await target.waitForFunction(() => document.getElementById('processDiagramCanvas')?._cyreg?.cy?.nodes().length > 0);
  };
  await importFile(page, sourcePath);
  console.log('Imported representative document');
  const before = await page.evaluate(() => JSON.stringify(currentDocument()));
  console.log('Read current document');
  assert.deepEqual(JSON.parse(before), source, 'The representative v7 input must import without normalization');
  const geometry = async () => {
    const result = await page.waitForFunction(() => {
    const canvas = document.getElementById('processDiagramCanvas');
    const cy = canvas?._cyreg?.cy;
    if (!cy || cy.destroyed()) return null;
    const selected = cy.nodes(':selected').first();
    return {
      viewport: diagramView.viewport(), canvas: canvas.getBoundingClientRect().toJSON(),
      width: cy.width(), height: cy.height(), bounds: cy.elements().renderedBoundingBox(),
      selectedRef: selected.data('focusRef'), selectedBounds: selected.length ? selected.renderedBoundingBox() : null,
      selectedLabel: selected.data('label'),
      innerWidth, innerHeight, overflow: document.documentElement.scrollWidth > innerWidth
    };
    });
    return result.jsonValue();
  };
  const fullyFits = value => {
    assert.ok(value.bounds.x1 >= 22 && value.bounds.y1 >= 22
      && value.bounds.x2 <= value.width - 22 && value.bounds.y2 <= value.height - 22,
    'Full view must include every rendered element');
  };
  console.log('Reading initial viewport');
  const initial = await geometry();
  console.log('Initial readable view');
  assert.equal(initial.viewport.zoom, 0.4, 'Long flows must start at a readable font size');
  await page.getByRole('button', { name: '查看全图', exact: true }).click();
  const normalFull = await geometry();
  fullyFits(normalFull);
  await page.getByRole('button', { name: '全屏检查流程图', exact: true }).click();
  await page.waitForFunction(() => document.getElementById('processDiagramCanvas').getBoundingClientRect().bottom >= innerHeight - 14);
  const expandedFull = await geometry();
  console.log('Expanded full view');
  fullyFits(expandedFull);
  assert.ok(expandedFull.viewport.zoom > normalFull.viewport.zoom * 1.5, 'Fullscreen must recompute the small-pane zoom');
  assert.equal(expandedFull.overflow, false);
  await page.screenshot({ path: path.join(outputDir, 'fullscreen-overview.png') });

  const readingChecks = [];
  for (const behavior of source.behaviors) {
    await page.getByRole('combobox', { name: '定位流程节点', exact: true }).selectOption(behavior.behavior_ref);
    const value = await geometry();
    const b = value.selectedBounds;
    assert.equal(value.selectedRef, behavior.behavior_ref);
    assert.ok(b.x1 >= 0 && b.y1 >= 0 && b.x2 <= value.width && b.y2 <= value.height,
      `The selected node must be entirely visible: ${behavior.behavior_ref}`);
    assert.ok(value.viewport.zoom * 45 >= 17.9, 'Representative nodes must remain readable');
    assert.ok(!value.selectedLabel.includes('部\n门'), 'The department word must not split across lines');
    readingChecks.push({ ref: behavior.behavior_ref, zoom: value.viewport.zoom });
  }
  const decision = source.behaviors.find(item => item.node_type === 'decision');
  await page.getByRole('combobox', { name: '定位流程节点', exact: true }).selectOption(decision.behavior_ref);
  await page.screenshot({ path: path.join(outputDir, 'fullscreen-decision.png') });
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  const normalClear = await geometry();
  assert.equal(normalClear.selectedRef, decision.behavior_ref, 'Leaving fullscreen must retain the reading target');
  await page.getByRole('button', { name: '全屏检查流程图', exact: true }).click();
  const preserved = await geometry();
  assert.equal(preserved.selectedRef, decision.behavior_ref);
  await page.mouse.move(preserved.canvas.x + preserved.canvas.width / 2, preserved.canvas.y + preserved.canvas.height / 2);
  await page.mouse.wheel(0, -160);
  await page.waitForFunction(() => diagramView.viewport().mode === 'manual');
  const manual = await geometry();
  const center = value => ({
    x: (value.width / 2 - value.viewport.pan.x) / value.viewport.zoom,
    y: (value.height / 2 - value.viewport.pan.y) / value.viewport.zoom
  });
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  const manualRestored = await geometry();
  assert.equal(manualRestored.viewport.zoom, manual.viewport.zoom, 'Manual zoom must survive a viewport resize');
  assert.ok(Math.abs(center(manualRestored).x - center(manual).x) < 2
    && Math.abs(center(manualRestored).y - center(manual).y) < 2, 'Manual reading center must survive fullscreen exit');
  await page.getByRole('button', { name: '全屏检查流程图', exact: true }).click();
  for (const size of [{ width: 1280, height: 720 }, { width: 1920, height: 889 }, { width: 1699, height: 828 }]) {
    await page.setViewportSize(size);
    await page.getByRole('button', { name: '查看全图', exact: true }).click();
    await page.waitForFunction(() => document.getElementById('processDiagramCanvas').getBoundingClientRect().bottom >= innerHeight - 14);
    fullyFits(await geometry());
  }
  await page.getByRole('button', { name: '退出全屏', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.stringify(currentDocument())), before, 'All diagram view operations must preserve business JSON');

  await page.getByRole('button', { name: '环节清单', exact: true }).click();
  await page.locator('[data-action="select-skeleton-item"][data-kind="behavior"]').nth(1).click();
  await page.getByRole('button', { name: '流程图', exact: true }).click();
  await page.getByRole('button', { name: '清晰检查', exact: true }).click();
  assert.equal(await page.getByRole('combobox', { name: '定位流程节点', exact: true }).inputValue(), source.behaviors[1].behavior_ref,
    'The reading picker must follow a newer selection from the node list');

  // Keep the existing geometric route/label/focus regression as part of this check.
  const routes = await require('./process-diagram-rendering-browser-scenario')(page);
  await page.getByRole('tab', { name: /全流程数据与表单/ }).click();
  await page.getByRole('button', { name: '整理数据对象与关联', exact: true }).click();
  await page.getByRole('combobox', { name: '当前数据对象', exact: true }).selectOption(source.data_objects[0].data_ref);
  await page.getByRole('button', { name: '生命周期', exact: true }).click();
  const details = page.locator('[data-lifecycle-details]');
  await details.locator('summary').click();
  const root = 'data_objects.0.lifecycle';
  const main = page.locator(`[data-bind="${root}.applicability"]`);
  const anonymity = page.locator(`[data-bind="${root}.entry_state.identifiability_applicability"]`);
  assert.equal(await main.inputValue(), 'pending_confirmation');
  assert.equal(await anonymity.inputValue(), 'not_applicable');
  assert.equal(await page.evaluate(() => JSON.stringify(currentDocument())), before, 'Expanding pending details must not change facts');
  await main.selectOption('not_applicable');
  assert.equal(await anonymity.isVisible(), true, 'An unchanged object must still expose existing entry details');
  await main.selectOption('pending_confirmation');
  assert.equal(await page.evaluate(() => JSON.stringify(currentDocument())), before, 'Changing the main choice back must preserve all existing details');
  await anonymity.selectOption('applicable');
  assert.equal(await main.inputValue(), 'pending_confirmation');
  assert.equal(await details.getAttribute('open'), '', 'Anonymity changes must keep the detail editor expanded');
  await page.locator(`[data-bind="${root}.entry_state.identifiability"]`).selectOption('identifiable');
  await anonymity.selectOption('not_applicable');
  assert.equal(await main.inputValue(), 'pending_confirmation');
  const changedState = await page.evaluate(() => currentDocument().data_objects[0].lifecycle.entry_state);
  assert.equal(changedState.identifiability, 'not_applicable');
  assert.equal(await page.evaluate(() => JSON.stringify(currentDocument())), before, 'Restoring the explicit state must leave no temporary main status');

  // Maintain one real field value for round-trip verification; this isolated page is disposable.
  await page.locator(`[data-bind="${root}.entry_state.custody"]`).selectOption('archived');
  const edited = await page.evaluate(() => JSON.stringify(currentDocument()));
  const expectEdited = JSON.parse(before);
  expectEdited.data_objects[0].lifecycle.entry_state.custody = 'archived';
  assert.deepEqual(JSON.parse(edited), expectEdited, 'A detail change must only update its owned field');
  await anonymity.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(outputDir, 'pending-lifecycle-details.png') });
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: '保存当前草稿', exact: true }).click();
  const downloadPath = path.join(outputDir, 'roundtrip.json');
  await (await downloadEvent).saveAs(downloadPath);
  const downloaded = JSON.parse(fs.readFileSync(downloadPath, 'utf8'));
  expectEdited.export_meta.exported_at = downloaded.export_meta.exported_at;
  assert.deepEqual(downloaded, expectEdited, 'Download must preserve main pending status, anonymous state and all unrelated fields');
  const second = await page.context().newPage();
  await second.goto(baseUrl);
  await importFile(second, downloadPath);
  assert.deepEqual(await second.evaluate(() => currentDocument()), downloaded, 'Downloaded v7 must reimport without differences');
  const storage = await page.evaluate(async () => ({
    local: localStorage.length, session: sessionStorage.length,
    databases: (await indexedDB.databases()).length, cookies: document.cookie
  }));
  assert.deepEqual(storage, { local: 0, session: 0, databases: 0, cookies: '' });
  await second.close();
  assert.deepEqual(errors, [], 'No browser errors may remain');
  const result = { initial, normalFull, expandedFull, readingChecks, normalClear, preserved, manual, manualRestored, routes, storage, errors, roundtrip: true };
  fs.writeFileSync(path.join(outputDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(`INTERACTION_READABILITY_PASS nodes=${readingChecks.length} roundtrip=true`);
  return result;
};
