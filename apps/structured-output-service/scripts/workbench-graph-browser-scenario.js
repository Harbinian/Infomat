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
  result.businessDisplay = [];
  const assert = (value, text) => { if (!value) throw new Error(`[Graph phase: ${phase}] ${text}`); };
  let phase = 'candidate initialization';
  const check = name => { result.checks.push(name); phase = `after ${name}`; };
  const nativeWaitForFunction = page.waitForFunction.bind(page);
  page.waitForFunction = async (...args) => {
    try { return await nativeWaitForFunction(...args); }
    catch (failure) { failure.message = `[Graph phase: ${phase}] ${failure.message}`; throw failure; }
  };
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
    // Run the actual same-origin ELK Worker; delay only delivery of a completed reply.
    // This proves that a queued real reply cannot mount its disposed graph owner.
    const BrowserWorker = window.Worker;
    window.__elkWorkerDelay = 0;
    window.__elkWorkerAudit = [];
    window.Worker = class extends BrowserWorker {
      constructor(url, options) { super(url, options); this.audit = { url: String(url), created: performance.now(), queued: false, terminated: false, late: false }; window.__elkWorkerAudit.push(this.audit); }
      set onmessage(listener) { this.addEventListener('message', event => { const delay = window.__elkWorkerDelay; this.audit.queued = true; const deliver = () => { this.audit.late ||= this.audit.terminated; listener(event); }; if (delay) setTimeout(deliver, delay); else deliver(); }); }
      terminate() { this.audit.terminated = true; return super.terminate(); }
    };
    window.__workbenchGraphStorageWrites = [];
    window.__workbenchGraphDownloadHashes = [];
    const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, bytes) => {
      const hash = await nativeDigest(algorithm, bytes);
      window.__workbenchGraphDownloadHashes.push({ algorithm: typeof algorithm === 'string' ? algorithm : algorithm.name, byteLength: bytes.byteLength, digest: [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('') });
      return hash;
    };
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
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试：判断分支与并行阅读') || [...document.querySelectorAll('.ant-modal-title')].some(title => title.textContent === '先保留尚未下载的内容'));
  const discard = page.getByRole('button', { name: '放弃未下载内容并继续', exact: true });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试：判断分支与并行阅读'));
  const ready = () => page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.layoutStatus === 'ready' && document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.behavior-node').length === 7);
  await ready();
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
  const readable = () => page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy; return cy.nodes('.behavior-node').first().numericStyle('font-size') * cy.zoom(); });
  const full = async () => { await page.getByRole('button', { name: '全 图', exact: true }).click(); await stable(); };
  const clickNode = async ref => {
    const point = await page.evaluate(ref => { const canvas = document.querySelector('.graph-canvas'), cy = canvas._cyreg.cy; const node = cy.nodes('.behavior-node').filter(node => node.data('focusRef') === ref).first(), bounds = canvas.getBoundingClientRect(), point = node.renderedPosition(); return { x: bounds.x + point.x, y: bounds.y + point.y, width: bounds.width, height: bounds.height, localX: point.x, localY: point.y }; }, ref);
    assert(point.localX > 0 && point.localY > 0 && point.localX < point.width && point.localY < point.height, `The ${ref} node must be visible before a real click.`);
    await page.mouse.click(point.x, point.y); await stable();
  };
  const selectObject = async ref => {
    const names = new Map();
    const collectNames = value => {
      if (!value || typeof value !== 'object') return;
      for (const [refKey, nameKey] of [['behavior_ref','behavior_name'], ['data_ref','data_name'], ['field_ref','field_name'], ['form_ref','form_name'], ['area_ref','area_title'], ['item_ref','item_name'], ['term_ref','term_name']]) {
        if (value[refKey] && value[nameKey]) names.set(value[refKey], value[nameKey]);
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') collectNames(child);
    };
    collectNames(before.json);
    const route = before.json.flow_relations.find(item => item.relation_ref === ref);
    const name = route ? `${names.get(route.from_behavior_ref)} → ${names.get(route.to_behavior_ref)}${route.condition ? ` · ${route.condition}` : ''}` : names.get(ref);
    assert(name, 'The synthetic selection requires a business name, never a machine-reference search.');
    await page.getByRole('radio', { name: '对象清单', exact: true }).locator('..').click();
    await page.getByRole('radio', { name: '全部', exact: true }).locator('..').click();
    await page.getByPlaceholder('按名称或所属范围查找').fill(name);
    await page.locator('.object-name').first().click();
    await page.getByRole('radio', { name: '流程图', exact: true }).locator('..').click();
    await stable();
  };
  const download = async name => {
    const hashCursor = await page.evaluate(() => window.__workbenchGraphDownloadHashes.length);
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: '↓ 下载草稿', exact: true }).click();
    const file = await pending; assert(await file.failure() === null, 'The synthetic draft download must succeed.');
    await file.saveAs(`${config.outputDir}/${name}.json`);
    const stream = await file.createReadStream(), chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const bytes = Buffer.concat(chunks), json = JSON.parse(bytes.toString('utf8'));
    const captured = await page.evaluate(({ cursor, byteLength }) => window.__workbenchGraphDownloadHashes.slice(cursor).filter(item => item.algorithm.toUpperCase() === 'SHA-256' && item.byteLength === byteLength).at(-1), { cursor: hashCursor, byteLength: bytes.length });
    assert(captured && /^[a-f0-9]{64}$/.test(captured.digest), 'Capture the actual export hash in the test page, never through production UI.');
    const digest = captured.digest;
    const actualDigest = await page.evaluate(async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))].map(value => value.toString(16).padStart(2, '0')).join(''), [...bytes]);
    assert(actualDigest === digest, 'The captured export digest must match the actual downloaded bytes.');
    await page.locator('.ant-drawer-body').getByText(`${bytes.length} 字节`, { exact: true }).waitFor();
    assert(!(await page.locator('.ant-drawer-body').innerText()).includes(digest), 'The business download summary must not display machine digests.');
    await page.locator('.ant-drawer-close').click();
    delete json.export_meta.exported_at;
    return { json, digest, byteLength: bytes.length, fileName: file.suggestedFilename() };
  };
  const before = await download('before-reading');
  const assertBusinessDisplay = async (stage, source = before.json) => {
    const refs = new Set();
    const collect = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, item] of Object.entries(value)) {
        if (/_refs?$/.test(key)) for (const ref of Array.isArray(item) ? item : [item]) if (typeof ref === 'string' && ref) refs.add(ref);
        if (item && typeof item === 'object') collect(item);
      }
    };
    collect(source);
    const display = await page.evaluate(refs => {
      const visibleValues = [...document.querySelectorAll('input, textarea')].filter(element => { const box = element.getBoundingClientRect(), style = getComputedStyle(element); return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && !element.closest('[aria-hidden="true"]'); }).map(element => element.value);
      const cy = document.querySelector('.graph-canvas')?._cyreg?.cy;
      const canvasLabels = cy ? cy.elements().map(element => element.data('label') || '').join('\n') : '';
      const visible = `${document.body.innerText}\n${visibleValues.join('\n')}\n${canvasLabels}`;
      return { leakedRefs: refs.filter(ref => visible.includes(ref)), technicalFields: visible.match(/\b(?:behavior_ref|relation_ref|data_ref|field_ref|form_ref|area_ref|item_ref|term_ref|source_ref|process_ref|package_ref|actor_department_data_ref|data_field_ref|business_data_ref|schema_version|export_meta)\b/g) || [], paths: visible.match(/\/(?:behaviors|flow_relations|data_objects|forms|migration|terms)\/[0-9]+(?:\/[a-z_0-9]+)*/g) || [] };
    }, [...refs]);
    assert(!display.leakedRefs.length && !display.technicalFields.length && !display.paths.length, `Business text and rendered canvas labels must hide internal references and paths: ${JSON.stringify(display)}`);
    result.businessDisplay.push({ stage, ...display });
  };
  await assertBusinessDisplay('flow');
  assert(await readable() >= 13.5, 'Import must discard the previous blank candidate viewport and use readable 14px text.');
  await shot('initial-readable-start');
  check('import discards the previous candidate viewport and shows a readable start');
  const workerCount = await page.evaluate(() => { window.__elkWorkerDelay = 900; return window.__elkWorkerAudit.length; });
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(config.fixturePath);
  await page.waitForFunction(count => window.__elkWorkerAudit.slice(count).some(worker => worker.queued && !worker.terminated), workerCount);
  assert(await page.getByRole('button', { name: '从当前环节阅读', exact: true }).isDisabled(), 'Reading must be disabled until the current layout is ready.');
  await page.getByRole('radio', { name: '对象清单', exact: true }).locator('..').click();
  await page.getByPlaceholder('按名称或所属范围查找').fill('测试起点：提交资料');
  await page.locator('.object-name').first().click();
  await page.getByRole('radio', { name: '流程图', exact: true }).locator('..').click();
  await ready(); await stable();
  result.workers = await page.evaluate(() => { window.__elkWorkerDelay = 0; return window.__elkWorkerAudit; });
  assert(result.workers.slice(workerCount).some(worker => worker.late && worker.terminated) && result.workers.every(worker => new URL(worker.url).origin === origin), 'A terminated real local Worker reply must be ignored after a view replacement.');
  assert((await cyState()).selected.includes('behavior_fixture_submit'), 'The newly ready graph must use the latest controlled selection.');
  check('actual local ELK Worker termination and queued late-reply rejection on view replacement');
  await full();
  result.geometry = await page.evaluate(() => {
    const cy = document.querySelector('.graph-canvas')._cyreg.cy;
    const nodes = cy.nodes('.behavior-node');
    const overlap = (a, b) => a.x1 < b.x2 - 1 && a.x2 > b.x1 + 1 && a.y1 < b.y2 - 1 && a.y2 > b.y1 + 1;
    const nodeCollisions = [], labelCollisions = [], labelPairCollisions = [], invalidPaths = [], endpointMismatches = [], routeNodeCrossings = [], routeLabelCrossings = [], bendMismatches = [];
    const bounds = node => node.boundingBox({ includeLabels: false, includeOverlays: false });
    for (let i = 0; i < nodes.length; i += 1) for (let j = i + 1; j < nodes.length; j += 1) if (overlap(bounds(nodes[i]), bounds(nodes[j]))) nodeCollisions.push([nodes[i].data('focusRef'), nodes[j].data('focusRef')]);
    const logical = cy.edges().filter(edge => edge.data('focusKind') === 'relation');
    const labels = cy.nodes('.flow-label');
    labels.forEach(label => nodes.forEach(node => { if (overlap(label.boundingBox({ includeLabels: true, includeOverlays: false }), bounds(node))) labelCollisions.push([label.data('focusRef'), node.data('focusRef')]); }));
    for (let i = 0; i < labels.length; i += 1) for (let j = i + 1; j < labels.length; j += 1) if (overlap(labels[i].boundingBox({ includeLabels: true, includeOverlays: false }), labels[j].boundingBox({ includeLabels: true, includeOverlays: false }))) labelPairCollisions.push([labels[i].data('focusRef'), labels[j].data('focusRef')]);
    const segmentCrosses = (a, b, rect) => {
      const margin = 1;
      if (Math.abs(a.x - b.x) < 0.1) return a.x > rect.x1 + margin && a.x < rect.x2 - margin && Math.max(a.y, b.y) > rect.y1 + margin && Math.min(a.y, b.y) < rect.y2 - margin;
      if (Math.abs(a.y - b.y) < 0.1) return a.y > rect.y1 + margin && a.y < rect.y2 - margin && Math.max(a.x, b.x) > rect.x1 + margin && Math.min(a.x, b.x) < rect.x2 - margin;
      return false;
    };
    logical.forEach(edge => {
      const scratch = edge._private.rscratch;
      if (!scratch.allpts?.length || scratch.allpts.some(value => !Number.isFinite(value)) || scratch.badLine) invalidPaths.push(edge.data('focusRef'));
      const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const start = edge.data('startPoint'), end = edge.data('endPoint');
      const startDistance = distance(start, { x: scratch.startX, y: scratch.startY });
      const endDistance = distance(end, { x: scratch.arrowEndX, y: scratch.arrowEndY });
      if (!Number.isFinite(startDistance) || !Number.isFinite(endDistance) || startDistance > 3 || endDistance > 3) endpointMismatches.push({ ref: edge.data('focusRef'), startDistance, endDistance });
      const actual = [];
      for (let index = 0; index < (scratch.allpts?.length || 0); index += 2) actual.push({ x: scratch.allpts[index], y: scratch.allpts[index + 1] });
      const plannedBends = edge.data('sections')?.[edge.data('sectionIndex')]?.bendPoints || [];
      plannedBends.forEach(bend => { if (!actual.some(point => distance(point, bend) < 0.2)) bendMismatches.push({ ref: edge.data('focusRef'), bend }); });
      for (let index = 1; index < actual.length; index += 1) {
        nodes.forEach(node => { if (![edge.data('semanticSource'), edge.data('semanticTarget')].includes(node.id()) && segmentCrosses(actual[index - 1], actual[index], bounds(node))) routeNodeCrossings.push([edge.data('focusRef'), node.data('focusRef')]); });
        labels.forEach(label => { if (label.data('edgeId') !== edge.id() && segmentCrosses(actual[index - 1], actual[index], label.boundingBox({ includeLabels: true, includeOverlays: false }))) routeLabelCrossings.push([edge.data('focusRef'), label.data('focusRef')]); });
      }
    });
    return { nodeCount: nodes.length, logicalCount: logical.length, labelCount: labels.length, nodeCollisions, labelCollisions, labelPairCollisions, invalidPaths, endpointMismatches, bendMismatches, routeNodeCrossings, routeLabelCrossings, engine: document.querySelector('.graph-canvas').dataset.layoutEngine, labels: labels.map(label => ({ ref: label.data('focusRef'), text: label.data('rawLabel'), background: label.style('background-color'), fontSize: label.numericStyle('font-size') })), aggregates: nodes.filter(node => node.data('aggregates')?.form).map(node => ({ ref: node.data('focusRef'), label: node.data('rawLabel') })), arrows: logical.map(edge => ({ ref: edge.data('focusRef'), shape: edge.style('target-arrow-shape'), lineColor: edge.style('line-color'), arrowColor: edge.style('target-arrow-color'), loop: edge.hasClass('relation-loop') })) };
  });
  assert(result.geometry.logicalCount === 8 && result.geometry.nodeCount === 7, 'All recorded routes and nodes must render.');
  assert(result.geometry.engine === 'elk-layered' && !result.geometry.nodeCollisions.length && !result.geometry.labelCollisions.length && !result.geometry.labelPairCollisions.length && !result.geometry.invalidPaths.length && !result.geometry.endpointMismatches.length && !result.geometry.bendMismatches.length && !result.geometry.routeNodeCrossings.length && !result.geometry.routeLabelCrossings.length, `Actual ELK routes, endpoints, bends, nodes and labels must match and remain clear: ${JSON.stringify(result.geometry)}`);
  assert(result.geometry.arrows.every(edge => edge.shape === 'triangle' && edge.lineColor === (edge.loop ? 'rgb(140,63,51)' : 'rgb(111,124,99)') && edge.arrowColor === edge.lineColor), 'Each recorded route must retain its own warm arrow, including brick-red returns.');
  assert(result.geometry.labels.length > 0 && result.geometry.labels.every(label => label.fontSize === 13 && label.background === 'rgb(244,236,220)'), 'Measured route labels must render in 13px on warm paper.');
  assert(result.geometry.aggregates.length > 0 && result.geometry.aggregates.every(node => node.label.includes('表单')), 'Recorded data and form counts must remain visible in the node summary.');
  await shot('full-flow-geometry');
  check('actual ELK node/label geometry, complete bend positions, endpoint arrows and individual logical route direction');
  await clickNode('behavior_fixture_submit');
  assert(await readable() >= 13.5, 'Selection from the overview must restore readable 14px text.');
  await page.getByRole('button', { name: '编辑本对象', exact: true }).click();
  await page.evaluate(() => { window.__workbenchGraphInstanceBeforeInput = document.querySelector('.graph-canvas')._cyreg.cy; window.__workerCountBeforeInput = window.__elkWorkerAudit.length; });
  await page.getByRole('textbox', { name: '环节名称', exact: true }).fill('测试起点：提交资料（提示测试）');
  assert(await page.evaluate(() => document.querySelector('.graph-canvas')._cyreg.cy === window.__workbenchGraphInstanceBeforeInput && window.__elkWorkerAudit.length === window.__workerCountBeforeInput), 'Ordinary visible input must not recreate the graph or request another Worker layout.');
  await page.evaluate(() => {
    const probe = { first: null, last: null };
    window.__workbenchAppliedCueProbe = probe;
    window.__workbenchAppliedCueTimer = setInterval(() => {
      if (document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.workbench-applied').length) { const now = performance.now(); probe.first ??= now; probe.last = now; }
    }, 10);
  });
  await page.getByRole('button', { name: '应用本对象修改', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.layoutStatus === 'ready' && document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.workbench-applied').some(node => node.data('focusRef') === 'behavior_fixture_submit'));
  await page.locator('.busy-strip').waitFor({ state: 'hidden' });
  await shot('applied-object-cue');
  await page.waitForTimeout(680);
  assert(await page.evaluate(() => document.querySelector('.graph-canvas')._cyreg.cy.elements('.workbench-applied').length === 0), 'The 600ms applied-object cue must clear and return to static presentation.');
  assert(await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy, point = cy.nodes('.behavior-node').filter(node => node.data('focusRef') === 'behavior_fixture_submit').first().renderedPosition(); return cy.zoom() >= 0.97 && point.x > 0 && point.y > 0 && point.x < cy.width() && point.y < cy.height(); }), 'After applying a wrapped name and relayout, the selected object must remain visibly located at readable size.');
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
  await page.getByText(/测试路线：资料完整 → 测试并行开始$/).click();
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
  const manualCanvas = await page.locator('.graph-canvas').boundingBox();
  await page.mouse.move(manualCanvas.x + manualCanvas.width - 60, manualCanvas.y + manualCanvas.height - 45); await page.mouse.down();
  await page.mouse.move(manualCanvas.x + 80, manualCanvas.y + manualCanvas.height - 45, { steps: 12 }); await page.mouse.up(); await stable();
  assert(await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy, point = cy.nodes('.behavior-node').filter(node => node.data('focusRef') === 'behavior_fixture_submit').first().renderedPosition(); return point.x < 0; }), 'The physical drag must move the selected node offscreen for the restoration check.');
  const offscreenSaved = await cyState();
  await page.getByRole('button', { name: '从当前环节阅读', exact: true }).click(); await stable();
  await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await stable();
  const offscreenRestored = await cyState();
  assert(Math.abs(offscreenSaved.zoom - offscreenRestored.zoom) < 0.001 && Math.abs(offscreenSaved.pan.x - offscreenRestored.pan.x) < 1 && Math.abs(offscreenSaved.pan.y - offscreenRestored.pan.y) < 1, 'Reading exit and toolbar resize must preserve the exact manually panned offscreen viewport.');
  check('reading exit preserves a real manually panned viewport even with the selected object offscreen');
  await page.getByRole('button', { name: '从当前环节阅读', exact: true }).click();
  await page.getByRole('button', { name: '下一步', exact: true }).click(); await page.getByRole('button', { name: '下一步', exact: true }).click();
  await page.getByRole('combobox', { name: '选择已记录路线', exact: true }).click();
  await page.getByText(/测试路线：资料待补充 → 测试起点：提交资料$/).click();
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
  await page.getByText(/测试路线：资料完整 → 测试并行开始$/).click();
  assert((await cyState()).reading.join(',') === 'graph_split', 'Reduced motion must retain manual route reading.');
  await shot('reduced-motion-manual'); await page.getByRole('button', { name: '退出阅读', exact: true }).click(); await stable();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  check('1.5-second playback and system reduced-motion preference with manual reading retained');
  await selectObject('graph_finance_join');
  await page.getByRole('button', { name: '查看关系方向', exact: true }).click();
  const emphasis = await cyState();
  assert(emphasis.highlightedRoutes.includes('graph_finance_join') && !emphasis.highlightedRoutes.includes('graph_quality_join'), 'Direction emphasis must follow the selected recorded route rather than an unrelated route to the same target.');
  await page.waitForTimeout(1300); assert(!(await cyState()).highlightedRoutes.length, 'The 1.2-second cue must finish and remain static.');
  const canvas = await page.locator('.graph-canvas').boundingBox();
  await page.getByRole('button', { name: '全 图', exact: true }).click();
  await page.waitForTimeout(40);
  await page.mouse.move(canvas.x + 200, canvas.y + canvas.height - 50); await page.mouse.down(); await page.mouse.move(canvas.x + 310, canvas.y + canvas.height - 80, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(360); assert(!(await cyState()).animated, 'A real canvas drag must cancel the older camera animation.');
  await page.getByRole('button', { name: '全 图', exact: true }).click(); await page.getByRole('button', { name: '查看关系方向', exact: true }).click();
  await page.getByRole('button', { name: '全 图', exact: true }).click(); await stable();
  await page.waitForTimeout(1300); assert(!(await cyState()).animated && !(await cyState()).highlightedRoutes.length, 'Newer positioning must clear old motion and cue callbacks.');
  check('specific logical route cue, consecutive cancellation and real pointer drag control');
  await selectObject('graph_area');
  await page.getByRole('button', { name: '查看关系图', exact: true }).click(); await stable();
  const relation = await page.evaluate(() => { const cy = document.querySelector('.graph-canvas')._cyreg.cy; return { edges: cy.edges().map(edge => ({ label: edge.data('label'), category: edge.data('category'), source: edge.source().data('target'), target: edge.target().data('target') })), nodes: cy.nodes().map(node => node.data('target')) }; });
  assert(relation.edges.some(edge => edge.category === 'ownership') && relation.edges.some(edge => edge.label.includes('来自子项：表单字段') && !edge.label.includes('graph_item_amount')), 'Area relationships must distinguish containment and named aggregated item references without displaying machine identifiers.');
  await assertBusinessDisplay('direct-relations');
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
  await page.getByText('术语已有定义，当前文件没有结构化的术语使用关系。', { exact: true }).waitFor();
  await shot('term-honest-empty-usage');
  await page.getByRole('button', { name: '← 返回流程图', exact: true }).click(); await stable();
  check('direct parent/item reference labels and honest term usage limitation');
  const after = await download('after-reading');
  assert(JSON.stringify(before.json) === JSON.stringify(after.json), 'All graph, relationship, viewport and reading actions must preserve every business JSON field.');
  result.downloads = { before: { digest: before.digest, byteLength: before.byteLength }, after: { digest: after.digest, byteLength: after.byteLength }, businessJsonUnchanged: true, excludedOnly: 'export_meta.exported_at (generated separately for each actual export)' };
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(config.largeFixturePath);
  await page.waitForFunction(() => document.querySelector('.process-title')?.textContent.includes('虚构测试：长图全图边界') && document.querySelector('.graph-canvas')?.dataset.layoutStatus === 'ready' && document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.behavior-node').length === 97);
  await stable(); await clickNode('behavior_fixture_submit');
  await page.locator('.detail-heading h2').filter({ hasText: '测试起点：提交资料' }).waitFor(); await full();
  result.largeOverview = await page.evaluate(() => {
    const cy = document.querySelector('.graph-canvas')._cyreg.cy, bounds = cy.elements().renderedBoundingBox({ includeLabels: true, includeOverlays: false });
    return { nodes: cy.nodes('.behavior-node').length, zoom: cy.zoom(), minZoom: cy.minZoom(), bounds, width: cy.width(), height: cy.height() };
  });
  assert(result.largeOverview.zoom < 0.08 && result.largeOverview.bounds.x1 >= 0 && result.largeOverview.bounds.y1 >= 0 && result.largeOverview.bounds.x2 <= result.largeOverview.width && result.largeOverview.bounds.y2 <= result.largeOverview.height, 'A large full overview must include all rendered content even when the actual fit is below 8%.');
  await shot('large-full-overview'); check('97-node full overview lowers its zoom boundary and retains the entire rendered graph');
  const largeSaved = await cyState();
  await page.getByRole('button', { name: '查看关系图', exact: true }).click(); await stable();
  await page.getByRole('button', { name: '← 返回流程图', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.graph-canvas')?.dataset.layoutStatus === 'ready' && document.querySelector('.graph-canvas')?._cyreg?.cy?.nodes('.behavior-node').length === 97); await stable();
  const largeReturned = await cyState();
  assert(Math.abs(largeReturned.zoom - largeSaved.zoom) < 0.001 && Math.abs(largeReturned.pan.x - largeSaved.pan.x) < 1 && Math.abs(largeReturned.pan.y - largeSaved.pan.y) < 1, 'Returning from direct relationships must restore even a full-view zoom below the default 8% limit.');
  check('large full-view relation return preserves its exact low-zoom viewport');
  const anomaly = JSON.parse(JSON.stringify(before.json));
  anomaly.export_meta.exported_at = new Date().toISOString();
  anomaly.process.process_name = '虚构测试：中文引用异常提示';
  anomaly.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
  anomaly.behaviors[0].actor_department_data_ref = 'graph_unknown_department_source';
  anomaly.behaviors.push({ ...anomaly.behaviors[0], behavior_name: '测试重复对象' });
  anomaly.flow_relations.push({ relation_ref: 'graph_missing_business_route', from_behavior_ref: 'graph_unknown_business_source', to_behavior_ref: anomaly.behaviors[0].behavior_ref, relation_type: 'condition', condition: '测试异常路线' });
  const beforeRejectedDownload = await download('before-rejected-import');
  const beforeRejected = await cyState();
  const beforeRejectedWorkerCount = await page.evaluate(() => { window.__graphCandidateBeforeRejectedImport = document.querySelector('.graph-canvas')._cyreg.cy; return window.__elkWorkerAudit.length; });
  phase = 'invalid import is rejected and current graph remains unchanged';
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'fictional-business-anomalies.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(anomaly), 'utf8') });
  await page.waitForFunction(() => document.querySelector('.error-strip')?.textContent.includes('源文件检查失败') || [...document.querySelectorAll('.ant-modal-title')].some(title => title.textContent === '先保留尚未下载的内容'));
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await page.locator('.error-strip').filter({ hasText: '源文件检查失败' }).waitFor();
  const rejectedMessage = await page.locator('.error-strip').innerText();
  assert(/重复|无法唯一确定/.test(rejectedMessage) && /不存在|缺失|不在当前文件|未找到/.test(rejectedMessage), `Rejected duplicate objects and missing references must retain clear business-language explanations. Actual: ${rejectedMessage}`);
  await stable();
  await assertBusinessDisplay('missing-and-ambiguous', anomaly);
  const afterRejected = await cyState();
  const center = value => ({ x: (value.width / 2 - value.pan.x) / value.zoom, y: (value.height / 2 - value.pan.y) / value.zoom });
  const centerBefore = center(beforeRejected), centerAfter = center(afterRejected);
  assert(Math.abs(beforeRejected.zoom - afterRejected.zoom) < 0.001 && Math.abs(centerBefore.x - centerAfter.x) < 1 && Math.abs(centerBefore.y - centerAfter.y) < 1, 'An import-error strip may resize the canvas but must preserve reading scale and centre without locating the selected object.');
  assert(await page.evaluate(workerCount => document.querySelector('.process-title')?.textContent.includes('虚构测试：长图全图边界') && document.querySelector('.graph-canvas')._cyreg.cy === window.__graphCandidateBeforeRejectedImport && window.__elkWorkerAudit.length === workerCount && document.querySelector('.graph-canvas')._cyreg.cy.nodes('.behavior-node').length === 97, beforeRejectedWorkerCount), 'A rejected source must preserve candidate identity and the graph instance without requesting a replacement layout.');
  await shot('business-anomalies-without-machine-identifiers');
  await page.locator('.error-strip .ant-alert-close-icon').click(); await stable();
  const errorDismissed = await cyState();
  assert(Math.abs(beforeRejected.zoom - errorDismissed.zoom) < 0.001 && Math.abs(beforeRejected.pan.x - errorDismissed.pan.x) < 1 && Math.abs(beforeRejected.pan.y - errorDismissed.pan.y) < 1, 'Dismissing the import error must restore the original effective viewport exactly.');
  const afterRejectedDownload = await download('after-rejected-import');
  assert(JSON.stringify(beforeRejectedDownload.json) === JSON.stringify(afterRejectedDownload.json), 'A rejected file must preserve every current business JSON field.');
  result.rejectedImport = { message: rejectedMessage, before: beforeRejected, after: afterRejected, restored: errorDismissed, businessJsonUnchanged: true, beforeDownload: { digest: beforeRejectedDownload.digest, byteLength: beforeRejectedDownload.byteLength }, afterDownload: { digest: afterRejectedDownload.digest, byteLength: afterRejectedDownload.byteLength } };
  check('business rejection text hides identifiers and preserves missing/ambiguous explanations, candidate, JSON and viewport');
  const storage = await page.evaluate(() => ({ writes: window.__workbenchGraphStorageWrites, cookies: document.cookie, local: localStorage.length, session: sessionStorage.length, overflow: document.documentElement.scrollWidth > innerWidth }));
  assert(!storage.writes.length && !storage.cookies && !storage.local && !storage.session, 'The workbench must not persist business data or reading state.');
  assert(!storage.overflow && !result.forbiddenRequests.length && !result.pageErrors.length && !result.consoleProblems.length, 'There must be no overflow, remote service traffic or browser errors.');
  result.storage = storage; check('actual export byte summaries, unchanged business JSON, no browser persistence or remote traffic');
  result.passed = true;
  return result;
}
