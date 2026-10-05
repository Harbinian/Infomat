// In-memory presentation helpers. They never modify the business document or persist state.
export const MOTION_MS = Object.freeze({ select: 150, locate: 250, direction: 1200, applied: 600, reading: 1500 });

export const targetKey = target => target ? JSON.stringify([target.kind, target.parentRef || '', target.ref]) : '';
const list = value => Array.isArray(value) ? value : [];
const sameTarget = (a, b) => targetKey(a) === targetKey(b);
export const kindLabel = kind => ({ process: '流程', behavior: '环节', relation: '环节流转', data: '数据对象', 'data-field': '数据字段', form: '表单／记录', 'form-area': '表单区域', 'form-item': '表单字段', term: '术语', 'data-link': '数据与环节关系', 'data-source': '数据来源', 'form-link': '表单与环节关系', 'field-source': '字段取值来源', 'lifecycle-route': '生命周期路径', 'lifecycle-event': '生命周期事件' }[kind] || '辅助信息');
export const statusLabel = status => ({ missing: '引用缺失', ambiguous: '标识歧义', 'wrong-owner': '父级不符', external: '外部标识，当前文件不解析' }[status] || '');

/** One cancellable owner for animation, pulse timers and final viewport reporting. */
export function createMotionCoordinator({ cy, reduced = () => false, report = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let generation = 0;
  let programmatic = false;
  let destroyed = false;
  const timers = new Set();
  const snapshot = mode => ({ mode, zoom: cy.zoom(), pan: { ...cy.pan() }, width: cy.width(), height: cy.height() });
  function finalViewport(mode = 'located') {
    if (destroyed) return;
    const previous = programmatic;
    programmatic = true;
    try { report(snapshot(mode)); } finally { programmatic = previous; }
  }
  function cancel({ user = false } = {}) {
    generation += 1;
    // Keep the guard raised while stop() flushes any final pan/zoom events.
    programmatic = true;
    cy.stop(true, false);
    for (const timer of timers) clearTimer(timer);
    timers.clear();
    programmatic = false;
    finalViewport(user ? 'manual' : 'located');
  }
  function later(callback, duration) {
    const captured = generation;
    const timer = setTimer(() => {
      timers.delete(timer);
      if (!destroyed && captured === generation) callback();
    }, duration);
    timers.add(timer);
    return timer;
  }
  function move(viewport, duration = MOTION_MS.select) {
    cancel();
    if (destroyed) return;
    const captured = generation;
    programmatic = true;
    const finish = () => {
      if (destroyed || captured !== generation) return;
      programmatic = false;
      finalViewport('located');
    };
    if (reduced() || !duration) {
      cy.zoom(viewport.zoom);
      cy.pan(viewport.pan);
      finish();
    } else {
      cy.animate({ zoom: viewport.zoom, pan: viewport.pan }, { duration, queue: false, complete: finish });
    }
  }
  function preserveResize() {
    const old = snapshot('located');
    cancel();
    programmatic = true;
    cy.resize();
    cy.zoom(old.zoom);
    cy.pan({ x: old.pan.x + (cy.width() - old.width) / 2, y: old.pan.y + (cy.height() - old.height) / 2 });
    programmatic = false;
    finalViewport('located');
  }
  function destroy() { destroyed = true; cancel(); }
  return { cancel, move, later, preserveResize, destroy, snapshot, isProgrammatic: () => programmatic, reportManual: () => { if (!programmatic) finalViewport('manual'); } };
}

export function locationViewport(cy, elements, { padding = 32, maxZoom = 0.65, readableZoom = 0.4, keepVisible = true } = {}) {
  if (!elements?.length) return null;
  const rendered = elements.renderedBoundingBox({ includeLabels: true });
  if (keepVisible && cy.zoom() >= readableZoom && rendered.x1 >= padding && rendered.y1 >= padding && rendered.x2 <= cy.width() - padding && rendered.y2 <= cy.height() - padding) return null;
  const bounds = elements.boundingBox({ includeLabels: true });
  const zoom = Math.max(cy.minZoom(), Math.min(maxZoom, Math.max(cy.zoom(), readableZoom), (cy.width() - 2 * padding) / Math.max(1, bounds.w), (cy.height() - 2 * padding) / Math.max(1, bounds.h)));
  return { zoom, pan: { x: cy.width() / 2 - (bounds.x1 + bounds.x2) / 2 * zoom, y: cy.height() / 2 - (bounds.y1 + bounds.y2) / 2 * zoom } };
}

/** Recorded routes only: no condition evaluation and no execution-time interpretation. */
export function createReadingSession(document, startRef, saved = {}) {
  const index = new Map();
  for (const behavior of list(document.behaviors)) {
    const ref = behavior.behavior_ref;
    if (!index.has(ref)) index.set(ref, []);
    index.get(ref).push(behavior);
  }
  if (!startRef || index.get(startRef)?.length !== 1) throw new Error('请选择具有唯一稳定标识的起点环节。');
  const routes = list(document.flow_relations);
  const history = [{ refs: [startRef], routeRefs: [], stopReason: '' }];
  let position = 0;
  let stopped = '';
  let choices = [];
  const selectedBySource = new Map();
  const visited = new Set([startRef]);
  const current = () => history[position];
  const stopAtCurrent = reason => { stopped = reason; current().stopReason = reason; };
  const available = ref => routes.filter(route => route.from_behavior_ref === ref);
  const snapshot = () => ({ ...current(), position, length: history.length, stopped, choices: [...choices], saved, canPrevious: position > 0, canNext: !['end', 'broken', 'loop'].includes(stopped) });
  function step(selectedRouteRef) {
    if (position < history.length - 1) { position += 1; stopped = current().stopReason || ''; choices = []; return snapshot(); }
    if (['loop', 'broken', 'end'].includes(stopped)) return snapshot();
    const group = current().refs;
    const candidates = group.flatMap(available);
    if (!candidates.length) { stopAtCurrent('end'); choices = []; return snapshot(); }
    // A split presents all its recorded destinations as one reading group.
    // Group merging only follows a single recorded route per member. Otherwise require an explicit choice.
    const parallel = group.length === 1 && index.get(group[0])?.[0]?.node_type === 'parallel_split';
    const decisionRefs = parallel ? [] : group.filter(ref => available(ref).length && (index.get(ref)?.[0]?.node_type === 'decision' || available(ref).length > 1));
    if (selectedRouteRef) {
      const picked = candidates.filter(route => route.relation_ref === selectedRouteRef);
      if (picked.length !== 1 || !decisionRefs.includes(picked[0].from_behavior_ref)) { stopAtCurrent('broken'); return snapshot(); }
      selectedBySource.set(picked[0].from_behavior_ref, selectedRouteRef);
    }
    const unresolvedDecisions = decisionRefs.filter(ref => !selectedBySource.has(ref));
    if (unresolvedDecisions.length) {
      stopped = 'choice';
      choices = candidates.filter(route => unresolvedDecisions.includes(route.from_behavior_ref)).map(route => ({ ref: route.relation_ref, fromRef: route.from_behavior_ref, toRef: route.to_behavior_ref, label: route.condition || `路线 ${route.relation_ref || '标识待补充'}` }));
      return snapshot();
    }
    const selected = candidates.filter(route => !decisionRefs.includes(route.from_behavior_ref) || selectedBySource.get(route.from_behavior_ref) === route.relation_ref);
    if (selected.some(route => !route.relation_ref || routes.filter(item => item.relation_ref === route.relation_ref).length !== 1 || !route.to_behavior_ref || index.get(route.to_behavior_ref)?.length !== 1)) { stopAtCurrent('broken'); choices = []; return snapshot(); }
    const refs = [...new Set(selected.map(route => route.to_behavior_ref))];
    const loop = refs.some(ref => visited.has(ref));
    history.push({ refs, routeRefs: selected.map(route => route.relation_ref), stopReason: loop ? 'loop' : '' });
    position += 1;
    for (const ref of refs) visited.add(ref);
    stopped = loop ? 'loop' : '';
    choices = [];
    selectedBySource.clear();
    return snapshot();
  }
  function previous() { if (position > 0) position -= 1; stopped = current().stopReason || ''; choices = []; selectedBySource.clear(); return snapshot(); }
  return { snapshot, step, previous };
}

/** A read-only direct-neighbour projection. Bad references remain explicit separate nodes. */
export function buildDirectRelationGraph(document, catalog, references, target) {
  const resolved = references.lookup(catalog, target);
  const nodes = new Map();
  const edges = [];
  const centerKey = targetKey(target);
  const uniqueNode = candidate => references.lookup(catalog, candidate);
  const nodeId = key => `object:${key}`;
  function addNode(candidate, fallback = '', status = 'valid', explicitKey = '') {
    const result = candidate ? uniqueNode(candidate) : null;
    const valid = status === 'valid' && result?.status === 'valid';
    const key = explicitKey || (valid ? targetKey(candidate) : `unresolved:${status}:${fallback}:${targetKey(candidate)}`);
    if (!nodes.has(key)) nodes.set(key, { data: { id: nodeId(key), target: valid ? candidate : null, label: `${candidate ? kindLabel(candidate.kind) + ' · ' : ''}${valid ? result.node.label : fallback || candidate?.ref || '未确定对象'}${valid ? '' : '\n' + (statusLabel(status === 'valid' ? result?.status : status) || '引用异常')}`, current: key === centerKey, anomaly: !valid }, position: { x: 0, y: 0 } });
    return nodeId(key);
  }
  const centerId = addNode(target, resolved.node?.label || target?.ref || '当前对象', resolved.status, centerKey);
  const edge = (id, source, destination, label, category = 'reference', anomaly = false, detailTarget = null) => edges.push({ data: { id: `link:${id}`, source, target: destination, label, category, anomaly, detailTarget } });
  const addOther = candidate => addNode(candidate, candidate?.ref || '迁移留存', 'valid');
  const node = resolved.node;
  if (node && !node.parentRef && target.kind !== 'process') {
    const processNodes = catalog.nodes.filter(item => item.kind === 'process');
    if (processNodes.length === 1) edge('file-parent', addOther(processNodes[0].target), centerId, '文件结构 · 包含', 'ownership');
  }
  const parent = node?.parentRef && catalog.nodes.filter(item => item.ref === node.parentRef);
  if (parent?.length === 1) edge('parent', addOther(parent[0].target), centerId, '父子归属 · 包含', 'ownership');
  if (target.kind === 'form-item') {
    const area = catalog.nodes.filter(item => item.kind === 'form-area' && item.ref === node?.scope?.areaRef && item.parentRef === target.parentRef);
    if (area.length === 1) edge('area-parent', addOther(area[0].target), centerId, '父子归属 · 区域包含字段', 'ownership');
  }
  const children = catalog.nodes.filter(item => {
    if (target.kind === 'data') return ['data-field', 'data-link', 'data-source', 'lifecycle-route'].includes(item.kind) && item.parentRef === target.ref;
    if (target.kind === 'form') return ['form-area', 'form-link'].includes(item.kind) && item.parentRef === target.ref;
    if (target.kind === 'form-area') return item.kind === 'form-item' && item.scope?.areaRef === target.ref && item.parentRef === target.parentRef;
    if (target.kind === 'form-item') return item.kind === 'field-source' && item.parentRef === target.ref;
    if (target.kind === 'lifecycle-route') return item.kind === 'lifecycle-event' && item.parentRef === target.ref;
    if (target.kind === 'process') return !item.parentRef && item.kind !== 'process';
    return false;
  });
  children.forEach(child => edge(`child:${child.path}`, centerId, addOther(child.target), target.kind === 'process' ? '文件结构 · 包含' : '父子归属 · 包含', 'ownership'));
  const direct = references.forTarget(catalog, target, { includeDescendants: true });
  for (const entry of new Set([...direct.outgoing, ...direct.incoming])) {
    // Display recorded flow direction below, instead of treating endpoint references as business direction.
    if ((target.kind === 'behavior' || target.kind === 'relation') && entry.sourceTarget?.kind === 'relation' && /\/(from|to)_behavior_ref$/.test(entry.path)) continue;
    const outgoing = direct.outgoing.includes(entry);
    const otherTarget = outgoing ? entry.elementTarget || entry.target : entry.sourceTarget;
    const anomaly = entry.status !== 'valid';
    const canIdentifySource = !outgoing && otherTarget && uniqueNode(otherTarget).status === 'valid';
    const otherId = otherTarget && (!anomaly || canIdentifySource) ? addOther(otherTarget) : addNode(null, entry.targetLabel || entry.ref || `迁移留存 ${entry.path}`, entry.status || 'missing', `unresolved:${entry.path}`);
    const sourceRecord = catalog.nodes.filter(item => entry.path.startsWith(`${item.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
    const sourceIdentity = sourceRecord?.target || entry.sourceTarget;
    const aggregate = outgoing ? !sameTarget(sourceIdentity, target) : !sameTarget(sourceIdentity, entry.sourceTarget);
    const sourceLabel = aggregate ? `（来自子项 ${sourceRecord?.ref || entry.sourceTarget?.ref}${sourceRecord?.label ? ' · ' + sourceRecord.label : ''}）` : '';
    const description = `引用 · ${entry.relationLabel}${sourceLabel}${anomaly ? ` · ${statusLabel(entry.status)} · 原值 ${entry.ref}` : ''}`;
    edge(entry.path, outgoing ? centerId : otherId, outgoing ? otherId : centerId, description, 'reference', anomaly, otherTarget);
  }
  if (target.kind === 'behavior' || target.kind === 'relation') {
    const routes = list(document.flow_relations).filter(route => target.kind === 'relation' ? route.relation_ref === target.ref : route.from_behavior_ref === target.ref || route.to_behavior_ref === target.ref);
    routes.forEach((route, i) => {
      const source = { kind: 'behavior', ref: route.from_behavior_ref, parentRef: '' };
      const destination = { kind: 'behavior', ref: route.to_behavior_ref, parentRef: '' };
      const sourceStatus = uniqueNode(source).status;
      const destinationStatus = uniqueNode(destination).status;
      const from = sameTarget(source, target) ? centerId : addNode(source, source.ref || '起点未填写', sourceStatus);
      const to = sameTarget(destination, target) ? centerId : addNode(destination, destination.ref || '终点未填写', destinationStatus);
      const routeTarget = { kind: 'relation', ref: route.relation_ref, parentRef: '' };
      const description = `${{ sequence: '顺序流转', condition: '条件流转', loop: '退回路线', parallel: '并行流转' }[route.relation_type] || '类型待填写'}${route.condition ? ' · ' + route.condition : ''}`;
      if (target.kind === 'relation') {
        edge(`route-from:${i}`, from, centerId, '流转 · 起点', 'flow', sourceStatus !== 'valid', routeTarget);
        edge(`route-to:${i}`, centerId, to, `流转 · 终点${route.condition ? ' · ' + route.condition : ''}`, 'flow', destinationStatus !== 'valid', routeTarget);
      } else edge(`route:${i}`, from, to, description, 'flow', sourceStatus !== 'valid' || destinationStatus !== 'valid', routeTarget);
    });
  }
  const incoming = [];
  const outgoing = [];
  for (const item of nodes.values()) {
    if (item.data.id === centerId) continue;
    (edges.some(itemEdge => itemEdge.data.source === item.data.id && itemEdge.data.target === centerId) ? incoming : outgoing).push(item);
  }
  for (const [side, collection] of [[-1, incoming], [1, outgoing]]) collection.forEach((item, index) => { item.position = { x: side * 520, y: (index - (collection.length - 1) / 2) * 152 }; });
  return { elements: [...nodes.values(), ...edges], centerId, relationshipCount: edges.length, anomalyCount: edges.filter(item => item.data.anomaly).length, noTermUsage: target.kind === 'term', title: node?.label || target.ref };
}
