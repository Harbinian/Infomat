async page => {
  // The CLI invokes an async page function. Only fictional candidate data is used.
  // Screenshots and actual downloaded JSON are saved in the supplied local output directory.
  const config = await page.evaluate(() => globalThis.__workbenchGraphTestConfig);
  if (!config?.fixturePath || !config?.outputDir) throw new Error('Use test-workbench-graph-browser.ps1 to supply explicit local test paths.');
  const origin = new URL(config.BaseUrl).origin;
  const candidate = new URL(origin);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(candidate.hostname) || ['3000', '3001'].includes(candidate.port) || !candidate.port) throw new Error('Only an explicit loopback candidate is permitted.');
  const result = { passed: false, browser: 'msedge', viewport: { width: 1699, height: 828 }, origin, checks: [], screenshots: [], consoleProblems: [], pageErrors: [], forbiddenRequests: [], geometry: null };
  result.applyDiagnostics = { validations: [], states: [] };
  const assert = (value, text) => { if (!value) throw new Error(text); };
  const check = name => result.checks.push(name);
  page.on('pageerror', error => result.pageErrors.push(error.message));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload') await dialog.accept();
    else await dialog.dismiss();
  });
  page.on('console', message => { if (['warning', 'error'].includes(message.type())) result.consoleProblems.push(`${message.type()}: ${message.text()}`); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.pathname === '/api/validate' && request.method() === 'POST') {
      const data = request.postDataJSON()?.data;
      result.applyDiagnostics.validations.push({ at: Date.now(), name: data?.behaviors?.find(item => item.behavior_ref === 'behavior_fixture_submit')?.behavior_name });
    }
    if (/^(http|https|ws|wss):$/.test(url.protocol) && url.origin !== origin) result.forbiddenRequests.push({ method: request.method(), origin: url.origin, path: url.pathname });
    if (/\/api\/(session|data|export|process-design|v7-mappings|data-map-definitions)(\/|$)/.test(url.pathname)) result.forbiddenRequests.push({ method: request.method(), path: url.pathname });
  });
  await page.context().addInitScript(() => {
    window.__workbenchGraphStorageWrites = [];
    for (const key of ['setItem', 'removeItem', 'clear']) {
      const previous = Storage.prototype[key];
      Storage.prototype[key] = function (...args) { window.__workbenchGraphStorageWrites.push(`Storage.${key}`); return previous.apply(this, args); };
    }
    const previousOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = (...args) => { window.__workbenchGraphStorageWrites.push('indexedDB.open'); return previousOpen(...args); };
  });
  await page.setViewportSize(result.viewport);
  await page.bringToFront();
  await page.goto(`${origin}/workbench/`, { waitUntil: 'networkidle' });
  await page.getByLabel('导入文件', { exact: true }).waitFor({ state: 'attached' });
  const runtime = await page.evaluate(() => ({ userAgent: navigator.userAgent, zoom: visualViewport?.scale, width: innerWidth, height: innerHeight, assets: [...document.scripts].map(script => script.src).filter(Boolean) }));
  assert(/Edg\//.test(runtime.userAgent) && runtime.zoom === 1 && runtime.width === 1699 && runtime.height === 828, 'The browser must be Microsoft Edge at 100%, 1699×828 CSS pixels.');
  result.runtime = runtime;
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(config.fixturePath);
  const discard = page.getByRole('button', { name: '放弃未下载内容并继续', exact: true });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试：判断分支与并行阅读'));
  await page.waitForFunction(() => document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.behavior-node').length === 7);
  const shot = async name => { const filename = `${config.outputDir}/${name}.png`; await page.screenshot({ path: filename, scale: 'css' }); result.screenshots.push(filename); };
  const cyState = () => page.evaluate(() => {
    const cy = document.querySelector('.graph-canvas')?._cyreg?.cy;
    return cy ? { zoom: cy.zoom(), pan: cy.pan(), width: cy.width(), height: cy.height(), reading: cy.nodes('.workbench-reading').map(node => node.data('focusRef')), highlightedRoutes: cy.edges('.workbench-direction').map(edge => edge.data('focusRef') || edge.id()), selected: cy.elements('.workbench-selected').map(element => element.data('focusRef') || element.id()), animated: cy.animated() } : null;
  });
  const inputDiagnostic = async stage => {
    const value = await page.evaluate(() => ({ input: document.querySelector('#detail-behavior_name')?.value, heading: document.querySelector('.detail-heading h2')?.textContent, status: document.querySelector('.document-status')?.textContent, inert: document.querySelector('.detail-panel')?.inert, ariaHidden: document.querySelector('.apply-row')?.closest('[aria-hidden="true"]')?.outerHTML?.slice(0,200), buttons: [...document.querySelectorAll('.apply-row button')].map(button => button.outerHTML), busy: document.querySelector('.busy-strip')?.textContent, error: document.querySelector('.error-strip')?.textContent, reading: Boolean(document.querySelector('.reading-controls')) }));
    value.buttonCount = await page.getByRole('button', { name: '应用本对象修改', exact: true }).count();
    value.accessibility = await page.locator('.apply-row').ariaSnapshot();
    result.applyDiagnostics.states.push({ stage, at: Date.now(), ...value });
  };
  const stable = async () => { await page.waitForTimeout(360); await page.waitForFunction(() => !document.querySelector('.graph-canvas')?._cyreg?.cy?.animated()); };
  const full = async () => { await page.getByRole('button', { name: '全 图', exact: true }).click(); await stable(); };
  const clickNode = async ref => {
    const point = await page.evaluate(ref => { const canvas = document.querySelector('.graph-canvas'), cy = canvas._cyreg.cy; const node = cy.nodes('.behavior-node').filter(node => node.data('focusRef') === ref).first(), bounds = canvas.getBoundingClientRect(), point = node.renderedPosition(); return { x: bounds.x + point.x, y: bounds.y + point.y, width: bounds.width, height: bounds.height, localX: point.x, localY: point.y }; }, ref);
    assert(point.localX > 0 && point.localY > 0 && point.localX < point.width && point.localY < point.height, `The ${ref} node must be visible before a real click.`);
    await page.mouse.click(point.x, point.y); await stable();
  };
  const selectObject = async ref => {
    await page.getByRole('radio', { name: '对象清单', exact: true }).locator('..').click();
    await page.getByRole('radio', { name: '全部', exact: true }).locator('..').click();
    await page.getByPlaceholder('按名称或标识查找').fill(ref);
    await page.locator('.object-name').first().click();
    await page.getByRole('radio', { name: '流程图', exact: true }).locator('..').click();
    await stable();
  };
  const download = async name => {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '↓ 下载草稿', exact: true }).click();
    const file = await pending; assert(await file.failure() === null, 'The synthetic draft download must succeed.');
    await file.saveAs(`${config.outputDir}/${name}.json`);
    const stream = await file.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), json = JSON.parse(bytes.toString('utf8'));
    const digest = await page.evaluate(async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map(value => value.toString(16).padStart(2, '0')).join(''), [...bytes]);
    await page.locator('.ant-drawer-body').filter({ hasText: digest }).waitFor();
    await page.locator('.ant-drawer-close').click();
    delete json.export_meta.exported_at;
    return { json, digest, byteLength: bytes.length, fileName: file.suggestedFilename() };
  };
  const before = await download('before-reading');
  assert((await cyState()).zoom <= 0.65, 'Import must discard the previous blank candidate viewport.');
  await shot('initial-readable-start');
  check('import discards the previous candidate viewport and shows a readable start');
  await full();
  result.geometry = await page.evaluate(() => {
    const cy = document.querySelector('.graph-canvas')._cyreg.cy;
    const nodes = cy.nodes('.behavior-node');
    const overlap = (a, b) => a.x1 < b.x2 - 1 && a.x2 > b.x1 + 1 && a.y1 < b.y2 - 1 && a.y2 > b.y1 + 1;
    const nodeCollisions = [], labelCollisions = [], invalidPaths = [];
    const bounds = node => node.boundingBox({ includeLabels: false, includeOverlays: false });
    for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) if (overlap(bounds(nodes[i]), bounds(nodes[j]))) nodeCollisions.push([nodes[i].data('focusRef'), nodes[j].data('focusRef')]);
    const logical = cy.edges().filter(edge => edge.data('focusKind') === 'relation');
    logical.forEach(edge => {
      const style = edge._private.rstyle, scratch = edge._private.rscratch;
      if (!scratch.allpts?.length || scratch.allpts.some(value => !Number.isFinite(value)) || scratch.badLine) invalidPaths.push(edge.data('focusRef'));
      if (edge.data('label') && Number.isFinite(style.labelX)) {
        const rect = { x1: style.labelX - style.labelWidth / 2, x2: style.labelX + style.labelWidth / 2, y1: style.labelY - style.labelHeight / 2, y2: style.labelY + style.labelHeight / 2 };
        nodes.forEach(node => { if (![edge.data('semanticSource'), edge.data('semanticTarget')].includes(node.id()) && overlap(rect, bounds(node))) labelCollisions.push([edge.data('focusRef'), node.data('focusRef')]); });
      }
    });
    const trunks = cy.edges('.relation-bundle-trunk').map(trunk => ({ id: trunk.id(), semanticTarget: trunk.data('semanticTarget'), target: trunk.target().id(), relations: trunk.data('relationRefs'), arrow: trunk.style('target-arrow-shape'), arrowAt: [trunk._private.rscratch.arrowEndX, trunk._private.rscratch.arrowEndY], path: trunk._private.rscratch.allpts, members: logical.filter(edge => edge.data('bundleId') === trunk.data('bundleId')).map(edge => ({ ref: edge.data('focusRef'), semanticSource: edge.data('semanticSource'), semanticTarget: edge.data('semanticTarget'), source: edge.source().id(), target: edge.target().id(), arrow: edge.style('target-arrow-shape'), path: edge._private.rscratch.allpts, label: edge.data('label') })) }));
    return { nodeCount: nodes.length, logicalCount: logical.length, nodeCollisions, labelCollisions, invalidPaths, trunks, badges: cy.nodes('.aggregate-badge').map(node => ({ background: node.style('background-color'), border: node.style('border-color') })), arrows: logical.map(edge => ({ ref: edge.data('focusRef'), shape: edge.style('target-arrow-shape'), label: edge.data('label'), lineColor: edge.style('line-color'), arrowColor: edge.style('target-arrow-color'), labelBackground: edge.style('text-background-color'), loop: edge.hasClass('relation-loop') })) };
  });
  assert(result.geometry.logicalCount === 8 && result.geometry.nodeCount === 7, 'All recorded routes and nodes must render.');
  assert(!result.geometry.nodeCollisions.length && !result.geometry.labelCollisions.length && !result.geometry.invalidPaths.length, 'Rendered node, label and route geometry must be clear.');
  assert(result.geometry.arrows.every(edge => edge.labelBackground === 'rgb(244,236,220)' && edge.lineColor === (edge.loop ? 'rgb(140,63,51)' : 'rgb(111,124,99)') && edge.arrowColor === edge.lineColor), 'Rendered labels and arrows must follow the warm theme, retaining brick-red recorded returns.');
  assert(result.geometry.badges.length > 0 && result.geometry.badges.every(badge => badge.background === 'rgb(237,240,225)' && badge.border === 'rgb(146,151,125)'), 'Data and form aggregate badges must use the same warm sage theme.');
  const trunk = result.geometry.trunks[0];
  assert(result.geometry.trunks.length === 1 && trunk.arrow === 'triangle' && trunk.target === trunk.semanticTarget && trunk.members.length === 2 && trunk.members.every(member => member.arrow === 'none' && member.semanticTarget === trunk.semanticTarget), 'The shared trunk must carry one arrow for its two specific logical members.');
  await shot('full-flow-geometry');
  check('actual Cytoscape geometry, labels and specific logical shared-trunk direction');
  await clickNode('behavior_fixture_submit');
  assert((await cyState()).zoom >= 0.39, 'Selection from the overview must restore readable text.');
  await page.getByRole('button', { name: '编辑本对象', exact: true }).click();
  await page.evaluate(() => { window.__workbenchGraphInstanceBeforeInput = document.querySelector('.graph-canvas')._cyreg.cy; });
  await page.getByRole('textbox', { name: '环节名称', exact: true }).fill('测试起点：提交资料（提示测试）');
  assert(await page.evaluate(() => document.querySelector('.graph-canvas')._cyreg.cy === window.__workbenchGraphInstanceBeforeInput), 'Ordinary visible input must not recreate or relayout the graph.');
  await page.evaluate(() => {
    const probe = { first: null, last: null };
    window.__workbenchAppliedCueProbe = probe;
    window.__workbenchAppliedCueTimer = setInterval(() => {
      if (document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.workbench-applied').length) { const now = performance.now(); probe.first ??= now; probe.last = now; }
    }, 10);
  });
  await page.getByRole('button', { name: '应用本对象修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.graph-canvas')._cyreg.cy.nodes('.workbench-applied').some(node => node.data('focusRef') === 'behavior_fixture_submit'));
  await page.locator('.busy-strip').waitFor({ state: 'hidden' });
  await shot('applied-object-cue');
  await page.waitForTimeout(680);
  assert(await page.evaluate(() => document.querySelector('.graph-canvas')._cyreg.cy.elements('.workbench-applied').length === 0), 'The 600ms applied-object cue must clear and return to static presentation.');
  result.appliedCue = await page.evaluate(() => { clearInterval(window.__workbenchAppliedCueTimer); const probe = window.__workbenchAppliedCueProbe; return { ...probe, observedMs: probe.last - probe.first }; });
  assert(result.appliedCue.first !== null && result.appliedCue.observedMs >= 450 && result.appliedCue.observedMs <= 650, 'Canvas resizing after validation must retain only the original 600ms cue, without erasing or extending it.');
  await inputDiagnostic('before-restoring-input');
  await page.getByRole('textbox', { name: '环节名称', exact: true }).fill('测试起点：提交资料');
  await inputDiagnostic('after-restoring-input');
  try {
    await page.locator('.busy-strip').waitFor({ state: 'hidden' });
    const secondApply = page.getByRole('button', { name: '应用本对象修改', exact: true });
    await secondApply.waitFor({ state: 'visible', timeout: 5000 });
    assert(await secondApply.evaluate(element => !element.closest('[inert]') && !element.closest('[aria-hidden="true"]')), 'The restored apply control must remain interactive and accessible.');
    await secondApply.click();
    await inputDiagnostic('after-second-click');
    await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试') && document.querySelector('.detail-heading h2')?.textContent === '测试起点：提交资料', null, { timeout: 5000 });
  }
  catch (error) { await inputDiagnostic('second-apply-failed'); await shot('second-apply-diagnostics'); result.failure = error.message; return result; }
  await page.waitForTimeout(680);
  check('ordinary input retains the graph instance and applied-object feedback becomes static after 600ms');
  const saved = await cyState();
  await page.getByRole('button', { name: '从当前环节阅读', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByText('判断或多路线处已暂停：请选择文件中已记录的路线。', { exact: true }).waitFor();
  assert((await cyState()).reading.join(',') === 'graph_decision', 'Decision conditions must never be evaluated automatically.');
  await page.getByRole('combobox', { name: '选择已记录路线', exact: true }).click();
  await page.getByText('测试路线：资料完整 → 测试并行开始', { exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click(); await stable();
  const group = await cyState();
  assert(group.reading.length === 2 && group.reading.includes('graph_finance') && group.reading.includes('graph_quality'), 'Parallel branches must be shown as one group.');
  await shot('parallel-reading-group');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  assert((await cyState()).reading.join(',') === 'graph_join', 'The recorded group must converge at its common join.');
  await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await stable();
  const restored = await cyState();
  assert(Math.abs(saved.zoom - restored.zoom) < 0.001 && Math.abs(saved.pan.x - restored.pan.x) < 1 && Math.abs(saved.pan.y - restored.pan.y) < 1, 'Exiting must restore the exact effective viewport.');
  assert(await page.locator('.detail-panel .object-form').count() === 1 && await page.getByText('测试起点：提交资料', { exact: true }).count() > 0, 'The selected object and existing editing mode must survive reading.');
  check('decision choice, grouped parallel reading, and original object/editing/viewport restoration');
  await page.getByRole('button', { name: '从当前环节阅读', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('combobox', { name: '选择已记录路线', exact: true }).click();
  await page.getByText('测试路线：资料待补充 → 测试起点：提交资料', { exact: true }).click();
  await page.getByText('再次到达已读环节，已暂停，避免无限循环。', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: '下一步', exact: true }).isDisabled(), 'Reading must stop at the first repeated node.');
  await shot('loop-paused'); await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await stable();
  check('recorded loop stops on a repeated node');
  await page.getByRole('button', { name: '从当前环节阅读', exact: true }).click();
  await page.getByRole('button', { name: '播 放', exact: true }).click();
  await page.waitForTimeout(1600); assert((await cyState()).reading.join(',') === 'graph_decision', 'Playback must move on the 1.5-second cadence.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.getByText('减少动态效果 · 手动阅读', { exact: true }).waitFor();
  assert(await page.getByRole('button', { name: '播 放', exact: true }).isDisabled(), 'Reduced motion must pause and disable automatic playback.');
  await page.waitForTimeout(1600); assert((await cyState()).reading.join(',') === 'graph_decision', 'Reduced motion must not continue automatic reading.');
  await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('combobox', { name: '选择已记录路线', exact: true }).click();
  await page.getByText('测试路线：资料完整 → 测试并行开始', { exact: true }).click();
  assert((await cyState()).reading.join(',') === 'graph_split', 'Reduced motion must retain manual route reading.');
  await shot('reduced-motion-manual'); await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await stable();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('1.5-second playback and system reduced-motion preference with manual reading retained');
  await selectObject('graph_finance_join');
  await page.getByRole('button', { name: '查看关系方向', exact: true }).click();
  const emphasis = await cyState();
  assert(emphasis.highlightedRoutes.includes('graph_finance_join') && !emphasis.highlightedRoutes.includes('graph_quality_join') && emphasis.highlightedRoutes.some(ref => ref.endsWith(':trunk')), 'A highlighted shared trunk must belong to the selected logical member only.');
  await page.waitForTimeout(1300); assert(!(await cyState()).highlightedRoutes.length, 'The 1.2-second cue must finish and remain static.');
  const canvas = await page.locator('.graph-canvas').boundingBox();
  await page.getByRole('button', { name: '全 图', exact: true }).click();
  await page.waitForTimeout(40);
  await page.mouse.move(canvas.x + 200, canvas.y + canvas.height - 50); await page.mouse.down(); await page.mouse.move(canvas.x + 310, canvas.y + canvas.height - 80, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(360); assert(!(await cyState()).animated, 'A real canvas drag must cancel the older camera animation.');
  await page.getByRole('button', { name: '全 图', exact: true }).click(); await page.getByRole('button', { name: '查看关系方向', exact: true }).click();
  await page.getByRole('button', { name: '全 图', exact: true }).click(); await stable();
  await page.waitForTimeout(1300); assert(!(await cyState()).animated && !(await cyState()).highlightedRoutes.length, 'Newer positioning must clear old motion and cue callbacks.');
  check('specific shared-trunk cue, consecutive cancellation and real pointer drag control');
  await selectObject('graph_area');
  await page.getByRole('button', { name: '查看关系图', exact: true }).click(); await stable();
  const relation = await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy; return { edges: cy.edges().map(edge => ({ label: edge.data('label'), category: edge.data('category'), source: edge.source().data('target'), target: edge.target().data('target') })), nodes: cy.nodes().map(node => node.data('target')) }; });
  assert(relation.edges.some(edge => edge.category === 'ownership') && relation.edges.some(edge => edge.label.includes('来自子项 graph_item_amount')), 'Area relationships must distinguish containment and aggregated item references.');
  await shot('area-direct-relationships');
  const relationPoint = await page.evaluate(() => { const canvas = document.querySelector('.graph-canvas'), cy = canvas._cyreg.cy, node = cy.nodes().filter(node => node.data('target')?.ref === 'graph_item_amount').first(), bounds = canvas.getBoundingClientRect(), point = node.renderedPosition(); return { x: bounds.x + point.x, y: bounds.y + point.y }; });
  await page.getByRole('textbox', { name: '区域名称', exact: true }).fill('测试基本区（暂存）');
  const beforeGuard = await cyState();
  await page.mouse.click(relationPoint.x, relationPoint.y);
  await page.getByRole('dialog', { name: '先处理当前修改', exact: true }).waitFor();
  assert(await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy; return cy.elements(':selected').length === 0 && cy.nodes('.workbench-selected').every(node => node.data('target')?.ref === 'graph_area'); }), 'A guarded relation click must not create a native selection or change the controlled current object.');
  await page.getByRole('button', { name: '继续编辑', exact: true }).click();
  const afterGuard = await cyState();
  assert(Math.abs(beforeGuard.zoom - afterGuard.zoom) < 0.001 && Math.abs(beforeGuard.pan.x - afterGuard.pan.x) < 1 && Math.abs(beforeGuard.pan.y - afterGuard.pan.y) < 1 && await page.getByRole('textbox', { name: '区域名称', exact: true }).inputValue() === '测试基本区（暂存）', 'Cancelling guarded relation selection must preserve input, object and effective viewport.');
  await page.getByRole('button', { name: '取消修改', exact: true }).click();
  await page.mouse.click(relationPoint.x, relationPoint.y); await stable();
  assert(await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy; return cy.elements(':selected').length === 0 && cy.nodes('.workbench-selected').some(node => node.data('target')?.ref === 'graph_item_amount'); }), 'An unguarded physical relation click must select through Controller props without a native Cytoscape selection.');
  await page.getByRole('button', { name: '查看此对象的直接关系', exact: true }).click(); await stable();
  assert(await page.evaluate(() => document.querySelector('.graph-canvas')._cyreg.cy.nodes().some(node => node.data('current') && node.data('target')?.ref === 'graph_item_amount')), 'The selected related object must support a further direct-relation layer.');
  await page.getByRole('button', { name: '← 返回流程图', exact: true }).click(); await stable();
  await selectObject('graph_term'); await page.getByRole('button', { name: '查看关系图', exact: true }).click();
  await page.getByText('术语已有定义和标识，当前文件没有结构化的术语使用关系。', { exact: true }).waitFor();
  await shot('term-honest-empty-usage');
  await page.getByRole('button', { name: '← 返回流程图', exact: true }).click(); await stable();
  check('direct parent/item reference labels and honest term usage limitation');
  const after = await download('after-reading');
  assert(JSON.stringify(before.json) === JSON.stringify(after.json), 'All graph, relationship, viewport and reading actions must preserve every business JSON field.');
  result.downloads = { before: { digest: before.digest, byteLength: before.byteLength }, after: { digest: after.digest, byteLength: after.byteLength }, businessJsonUnchanged: true, excludedOnly: 'export_meta.exported_at (generated separately for each actual export)' };
  const storage = await page.evaluate(() => ({ writes: window.__workbenchGraphStorageWrites, cookies: document.cookie, local: localStorage.length, session: sessionStorage.length, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert(!storage.writes.length && !storage.cookies && !storage.local && !storage.session, 'The workbench must not persist business data or reading state.');
  assert(!storage.overflow && !result.forbiddenRequests.length && !result.pageErrors.length && !result.consoleProblems.length, 'There must be no overflow, remote service traffic or browser errors.');
  result.storage = storage; check('actual export byte summaries, unchanged business JSON, no browser persistence or remote traffic');
  result.passed = true;
  return result;
}
