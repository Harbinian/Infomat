// Read-only display projection. Coordinates and diagnostics never enter business JSON.
import { catalog } from './model.mjs';
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' ? value.trim() : '';
const rawRef = value => typeof value === 'string' ? value : '';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const copyPoint = point => ({ x: point.x, y: point.y });
export const FLOW_LAYOUT_VERSION = 'elk-layered-0.12.0-v1';
export const FLOW_FONT_SIZE = 14;
export const FLOW_LABEL_FONT_SIZE = 13;
export const FLOW_LAYOUT_OPTIONS = Object.freeze({
  'elk.algorithm': 'layered', 'elk.direction': 'RIGHT', 'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=32,left=32,bottom=32,right=32]',
  'elk.spacing.nodeNode': '40', 'elk.spacing.edgeNode': '24', 'elk.spacing.edgeEdge': '18',
  'elk.layered.spacing.nodeNodeBetweenLayers': '76',
  'elk.layered.spacing.edgeNodeBetweenLayers': '24',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '18',
  'elk.layered.mergeEdges': 'false', 'elk.layered.unnecessaryBendpoints': 'true',
  'elk.layered.edgeLabels.centerLabelPlacementStrategy': 'MEDIAN_LAYER',
  'elk.randomSeed': '1'
});

function fingerprint(value) {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) hash = Math.imul(hash ^ serialized.charCodeAt(index), 16777619);
  return `${FLOW_LAYOUT_VERSION}:${serialized.length}:${(hash >>> 0).toString(16)}`;
}
function defaultMeasure(value, size) { return [...value].reduce((sum, char) => sum + (char.charCodeAt(0) > 255 ? size : size * 0.56), 0); }
function wrap(value, maxWidth, size, measure) {
  const lines = [];
  for (const paragraph of String(value || '').split('\n')) {
    let line = '';
    for (const char of paragraph) {
      if (line && measure(line + char, size) > maxWidth) { lines.push(line); line = ''; }
      line += char;
    }
    lines.push(line);
  }
  return { label: lines.join('\n'), width: Math.ceil(Math.max(0, ...lines.map(line => measure(line, size)))), height: lines.length * (size + 6), lineCount: lines.length };
}
function indexBy(items, key) {
  const index = new Map();
  items.forEach(item => { const ref = rawRef(item?.[key]); if (ref) index.set(ref, [...(index.get(ref) || []), item]); });
  return index;
}
function actorFact(behavior, dataIndex, uniqueIdentity) {
  if (['decision', 'parallel_split', 'parallel_join'].includes(behavior.node_type)) return '流程控制';
  if (behavior.actor_assignment_mode === 'dynamic_from_data') {
    const ref = rawRef(behavior.actor_department_data_ref);
    const matches = dataIndex.get(ref) || [];
    return `部门：按数据动态确定\n${matches.length === 1 && uniqueIdentity('data', ref) ? text(matches[0].data_name) || ref : `${ref || '来源未填写'}（${matches.length ? '标识歧义' : '引用缺失'}）`}`;
  }
  if (behavior.actor_assignment_mode === 'company_wide' || text(behavior.current_actor_role) === '全公司') return '执行范围：全公司';
  return text(behavior.current_actor_role) ? `执行信息：${text(behavior.current_actor_role)}` : '执行部门／岗位待明确';
}
function relationLabel(relation) {
  const condition = text(relation.condition);
  if (relation.relation_type === 'loop') return `退回${condition ? `：${condition}` : ''}`;
  if (relation.relation_type === 'parallel') return condition ? `并行：${condition}` : relation.join_mode === 'all' ? '并行：全部分支完成后汇合' : '并行';
  return condition || (relation.relation_type === 'condition' ? '条件待填写' : '');
}

/** Project stable identities, explicit unresolved endpoints, measured labels and boundary ports. */
export function buildFlowLayoutInput(document, { measureText = defaultMeasure } = {}) {
  const source = document || {};
  const behaviors = list(source.behaviors);
  const relations = list(source.flow_relations);
  const behaviorIndex = indexBy(behaviors, 'behavior_ref');
  const dataIndex = indexBy(list(source.data_objects), 'data_ref');
  const identities = catalog(source);
  const uniqueIdentity = (kind, ref) => identities.some(item => item.kind === kind && item.ref === ref && !item.ambiguous)
    && !list(source.internal_process_calls).some(call => rawRef(call.call_ref) === ref);
  const nodes = [], edges = [], issues = [];
  const behaviorIds = new Map();
  const addIssue = (path, ref, message) => issues.push({ path, ref, message });
  const counts = new Map();
  const countFor = ref => { if (!counts.has(ref)) counts.set(ref, { create: 0, update: 0, use: 0, pending_confirmation: 0, form: 0 }); return counts.get(ref); };
  list(source.data_objects).forEach(object => list(object.behavior_links).forEach(link => {
    if (uniqueIdentity('behavior', rawRef(link.behavior_ref)) && Object.hasOwn(countFor(link.behavior_ref), link.operation)) countFor(link.behavior_ref)[link.operation] += 1;
  }));
  list(source.forms).forEach(form => [...new Set(list(form.behavior_links).map(link => rawRef(link.behavior_ref)))].forEach(ref => { if (uniqueIdentity('behavior', ref)) countFor(ref).form += 1; }));

  function makeNode({ id, ref, focusKind, rawLabel, nodeType = 'action', path, status = 'valid', extra = {} }) {
    const diamond = ['decision', 'parallel_split', 'parallel_join'].includes(nodeType);
    const wrapped = wrap(rawLabel, diamond ? 150 : 200, FLOW_FONT_SIZE, measureText);
    const height = diamond ? Math.max(184, wrapped.height * 2 + 32) : Math.max(96, wrapped.height + 32);
    const width = diamond ? Math.max(248, wrapped.width * 2 + 32) : Math.max(224, wrapped.width + 32);
    const node = { id, ref, focusKind, focusRef: ref, rawLabel, label: wrapped.label, labelWidth: wrapped.width, labelHeight: wrapped.height, textMaxWidth: diamond ? 150 : 200, width, height, nodeType, shape: diamond ? 'diamond' : 'rectangle', path, status, ...extra };
    nodes.push(node);
    return node;
  }
  behaviors.forEach((behavior, index) => {
    const ref = rawRef(behavior.behavior_ref);
    const status = !ref ? 'missing' : uniqueIdentity('behavior', ref) ? 'valid' : 'ambiguous';
    const id = status === 'valid' ? `behavior:${encodeURIComponent(ref)}` : `unresolved-behavior:${index}`;
    if (status === 'valid') behaviorIds.set(ref, id);
    else addIssue(`/behaviors/${index}/behavior_ref`, ref, ref ? `环节标识歧义，保留原值：${ref}` : '环节缺少稳定标识，不能推断身份');
    const control = { decision: '◇ 判断', parallel_split: '＋ 并行开始', parallel_join: '＋ 并行汇合' }[behavior.node_type];
    const actor = actorFact(behavior, dataIndex, uniqueIdentity);
    if (behavior.actor_assignment_mode === 'dynamic_from_data' && !uniqueIdentity('data', rawRef(behavior.actor_department_data_ref))) addIssue(`/behaviors/${index}/actor_department_data_ref`, rawRef(behavior.actor_department_data_ref), actor.replaceAll('\n', ' · '));
    const aggregate = counts.get(ref);
    const aggregateLines = aggregate ? [aggregate.create + aggregate.update + aggregate.use + aggregate.pending_confirmation ? `数据 创${aggregate.create} 更${aggregate.update} 用${aggregate.use}${aggregate.pending_confirmation ? ` 待确认${aggregate.pending_confirmation}` : ''}` : '', aggregate.form ? `表单 ${aggregate.form}` : ''].filter(Boolean) : [];
    const rawLabel = [control, text(behavior.behavior_name) || '环节名称待填写', actor, ...aggregateLines, status === 'valid' ? '' : `${status === 'ambiguous' ? '标识歧义' : '标识缺失'}${ref ? `：${ref}` : ''}`].filter(Boolean).join('\n');
    makeNode({ id, ref, focusKind: 'behavior', rawLabel, nodeType: behavior.node_type, path: `/behaviors/${index}`, status, extra: { actorFact: actor, dynamicActor: behavior.actor_assignment_mode === 'dynamic_from_data', aggregates: aggregate || null } });
  });
  function endpoint(ref, path, role) {
    const id = behaviorIds.get(ref);
    if (id) return id;
    const status = behaviorIndex.has(ref) ? 'ambiguous' : 'missing';
    const unresolvedId = `unresolved-endpoint:${path}:${role}`;
    const rawLabel = `${role === 'source' ? '起点' : '终点'}引用${status === 'ambiguous' ? '歧义' : '缺失'}\n原值：${ref || '未填写'}\n未自动连接到同名环节`;
    makeNode({ id: unresolvedId, ref, focusKind: 'unresolved', rawLabel, path, status, extra: { unresolvedRole: role } });
    addIssue(path, ref, rawLabel.replaceAll('\n', ' · '));
    return unresolvedId;
  }
  function makeEdge({ id, ref, sourceId, targetId, rawLabel, path, status = 'valid', focusKind = 'relation', extra = {} }) {
    const wrapped = rawLabel ? wrap(rawLabel, 196, FLOW_LABEL_FONT_SIZE, measureText) : { label: '', width: 0, height: 0, lineCount: 0 };
    edges.push({ id, ref, focusRef: ref, focusKind, source: sourceId, target: targetId, semanticSource: sourceId, semanticTarget: targetId, rawLabel, label: wrapped.label, labelWidth: wrapped.width ? wrapped.width + 12 : 0, labelHeight: wrapped.height ? wrapped.height + 8 : 0, path, status, relationRefs: ref ? [ref] : [], ...extra });
  }
  relations.forEach((relation, index) => {
    const ref = rawRef(relation.relation_ref);
    const path = `/flow_relations/${index}`;
    const status = !ref ? 'missing' : uniqueIdentity('relation', ref) ? 'valid' : 'ambiguous';
    if (status !== 'valid') addIssue(`${path}/relation_ref`, ref, ref ? `流转标识歧义，保留原值：${ref}` : '流转缺少稳定标识，保留记录');
    const from = rawRef(relation.from_behavior_ref), to = rawRef(relation.to_behavior_ref);
    const sourceId = endpoint(from, `${path}/from_behavior_ref`, 'source');
    const targetId = endpoint(to, `${path}/to_behavior_ref`, 'target');
    const anomaly = status !== 'valid' || !behaviorIds.has(from) || !behaviorIds.has(to);
    makeEdge({ id: status === 'valid' ? `relation:${encodeURIComponent(ref)}` : `unresolved-relation:${index}`, ref, sourceId, targetId, rawLabel: [relationLabel(relation), anomaly ? `引用异常 · 原值 ${from || '未填写'} → ${to || '未填写'}` : ''].filter(Boolean).join('\n'), path, status: anomaly ? 'unresolved' : 'valid', extra: { fromRef: from, toRef: to, relationType: relation.relation_type, loop: relation.relation_type === 'loop' || from === to } });
  });
  // Supported legacy calls remain explicit auxiliary information; they never create enterprise identities.
  const calls = [...list(source.internal_process_calls).map((call, index) => ({ call, path: `/internal_process_calls/${index}` })), ...list(source.migration?.internal_process_calls).map((call, index) => ({ call, path: `/migration/internal_process_calls/${index}` }))];
  const callIndex = indexBy(calls.map(item => item.call), 'call_ref');
  calls.forEach(({ call, path }, index) => {
    const ref = rawRef(call.call_ref), caller = rawRef(call.caller_behavior_ref), returned = rawRef(call.return_behavior_ref);
    const status = !ref ? 'missing' : callIndex.get(ref)?.length === 1 ? 'valid' : 'ambiguous';
    const id = status === 'valid' ? `call:${encodeURIComponent(ref)}` : `unresolved-call:${index}`;
    const migrationRetained = path.startsWith('/migration/');
    const navigationTarget = behaviorIds.has(caller) ? { kind: 'behavior', ref: caller, parentRef: '', relatedKind: 'call' } : null;
    const auxiliary = { auxiliary: true, migrationRetained, rawCall: { ...call }, callerRef: caller, returnRef: returned, navigationTarget };
    makeNode({ id, ref, focusKind: 'call', rawLabel: `${migrationRetained ? '迁移留存 · 辅助引用' : '内部流程调用线索'}\n${text(call.target_process_name) || '目标流程待明确'}\n${ref || '调用标识未填写'}`, path, status, extra: auxiliary });
    makeEdge({ id: `${id}:out`, ref, sourceId: endpoint(caller, `${path}/caller_behavior_ref`, 'source'), targetId: id, rawLabel: migrationRetained ? '迁移留存 · 调用引用' : '内部流程调用线索', path, focusKind: 'call', extra: auxiliary });
    if (returned) makeEdge({ id: `${id}:return`, ref, sourceId: id, targetId: endpoint(returned, `${path}/return_behavior_ref`, 'target'), rawLabel: migrationRetained ? '迁移留存 · 返回引用' : '返回环节线索', path, focusKind: 'call', extra: { ...auxiliary, loop: true } });
  });

  // Fixed side-centre ports coincide with actual diamond vertices as well as rectangle boundaries.
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const portsByNode = new Map(nodes.map(node => [node.id, []]));
  edges.forEach(edge => {
    for (const [role, side, nodeId] of [['source', 'EAST', edge.source], ['target', 'WEST', edge.target]]) {
      const node = nodeById.get(nodeId);
      const portId = `${edge.id}:${role}`;
      portsByNode.get(nodeId).push({ id: portId, x: side === 'EAST' ? node.width : 0, y: node.height / 2, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } });
      edge[`${role}Port`] = portId;
    }
  });
  const graph = { id: 'flow', layoutOptions: { ...FLOW_LAYOUT_OPTIONS }, children: nodes.map(node => ({ id: node.id, width: node.width, height: node.height, ports: portsByNode.get(node.id), layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } })), edges: edges.map(edge => ({ id: edge.id, sources: [edge.sourcePort], targets: [edge.targetPort], labels: edge.label ? [{ id: `${edge.id}:label`, text: edge.label, width: edge.labelWidth, height: edge.labelHeight, layoutOptions: { 'elk.edgeLabels.placement': 'CENTER' } }] : [] })) };
  return { graph, nodes, edges, issues, documentFingerprint: fingerprint(source) };
}

export function pointsToSegments(points, start, end) {
  const dx = end.x - start.x, dy = end.y - start.y;
  const squared = dx * dx + dy * dy;
  if (!squared) return { weights: [], distances: [] };
  const length = Math.sqrt(squared);
  return { weights: points.map(point => ((point.x - start.x) * dx + (point.y - start.y) * dy) / squared), distances: points.map(point => (dx * (point.y - start.y) - dy * (point.x - start.x)) / length) };
}
function checkPoint(point, description) { if (!point || !finite(point.x) || !finite(point.y)) throw new Error(`ELK返回无效${description}坐标，未显示替代布局。`); }

/** Consume every section and label position; transparent anchors preserve self-loop geometry too. */
export function materializeFlowLayout(input, graph) {
  if (!graph || !finite(graph.width) || !finite(graph.height)) throw new Error('ELK未返回有效画布尺寸。');
  const outputNodes = new Map(list(graph.children).map(node => [node.id, node]));
  const outputEdges = new Map(list(graph.edges).map(edge => [edge.id, edge]));
  const elements = [], nodes = [], edges = [], labels = [], routeSegments = [];
  input.nodes.forEach(node => {
    const placed = outputNodes.get(node.id);
    checkPoint(placed, '节点');
    if (!finite(placed.width) || !finite(placed.height)) throw new Error('ELK未返回有效节点尺寸。');
    const record = { ...node, x: placed.x, y: placed.y, width: placed.width, height: placed.height };
    nodes.push(record);
    elements.push({ group: 'nodes', classes: `${node.focusKind === 'behavior' ? 'behavior-node' : node.focusKind === 'call' ? 'internal-call-node' : 'unresolved-flow-node'} node-${node.nodeType}${node.status !== 'valid' ? ' flow-anomaly' : ''}${node.dynamicActor ? ' dynamic-actor-node' : ''}`, data: { ...node, nodeWidth: placed.width, nodeHeight: placed.height }, position: { x: placed.x + placed.width / 2, y: placed.y + placed.height / 2 } });
  });
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  input.edges.forEach(edge => {
    const placed = outputEdges.get(edge.id);
    if (!placed || !list(placed.sections).length) throw new Error(`ELK未返回路线 ${edge.ref || edge.path} 的完整路由。`);
    const sections = placed.sections.map(section => {
      const points = [section.startPoint, ...list(section.bendPoints), section.endPoint];
      points.forEach(point => checkPoint(point, '路线'));
      return { ...section, startPoint: copyPoint(section.startPoint), endPoint: copyPoint(section.endPoint), bendPoints: list(section.bendPoints).map(copyPoint), points: points.map(copyPoint) };
    });
    const record = { ...edge, sections, points: sections.flatMap(section => section.points) };
    edges.push(record);
    sections.forEach((section, index) => {
      const start = section.startPoint, end = section.endPoint;
      const sourceNode = nodeById.get(edge.source), targetNode = nodeById.get(edge.target);
      // Normal one-section edges attach directly to semantic nodes. Self loops use presentation-only anchors.
      const direct = sections.length === 1 && edge.source !== edge.target;
      const sourceId = direct ? edge.source : `${edge.id}:section:${index}:source`;
      const targetId = direct ? edge.target : `${edge.id}:section:${index}:target`;
      if (!direct) [[sourceId, start], [targetId, end]].forEach(([id, point]) => elements.push({ group: 'nodes', classes: 'flow-route-anchor', data: { id, ownerEdge: edge.id, nodeWidth: 1, nodeHeight: 1, shape: 'rectangle', textMaxWidth: 1, label: '' }, position: copyPoint(point) }));
      const geometry = pointsToSegments(section.bendPoints, start, end);
      const sourceCenter = direct ? { x: sourceNode.x + sourceNode.width / 2, y: sourceNode.y + sourceNode.height / 2 } : start;
      const targetCenter = direct ? { x: targetNode.x + targetNode.width / 2, y: targetNode.y + targetNode.height / 2 } : end;
      const style = { 'source-endpoint': `${start.x - sourceCenter.x} ${start.y - sourceCenter.y}`, 'target-endpoint': `${end.x - targetCenter.x} ${end.y - targetCenter.y}`, 'curve-style': section.bendPoints.length ? 'segments' : 'straight', 'edge-distances': 'endpoints', 'segment-weights': geometry.weights.length ? geometry.weights.join(' ') : '0.5', 'segment-distances': geometry.distances.length ? geometry.distances.join(' ') : '0', 'target-arrow-shape': index === sections.length - 1 ? 'triangle' : 'none' };
      elements.push({ group: 'edges', classes: `flow-edge elk-route${edge.loop ? ' relation-loop' : ''}${edge.auxiliary ? ' call-auxiliary' : ''}${edge.status !== 'valid' ? ' flow-anomaly' : ''}`, data: { ...edge, id: index === 0 ? edge.id : `${edge.id}:section:${index}`, source: sourceId, target: targetId, sectionIndex: index, sections, points: record.points, label: '', rawLabel: edge.rawLabel, startPoint: start, endPoint: end, labelBounds: null }, style });
      for (let pointIndex = 1; pointIndex < section.points.length; pointIndex += 1) routeSegments.push({ edgeId: edge.id, relationRef: edge.ref, sectionIndex: index, from: section.points[pointIndex - 1], to: section.points[pointIndex] });
    });
    const outputLabels = list(placed.labels);
    if (edge.label && !outputLabels.length) throw new Error(`ELK未返回路线 ${edge.ref || edge.path} 的标签位置。`);
    outputLabels.forEach((label, index) => {
      checkPoint(label, '标签');
      if (!finite(label.width) || !finite(label.height)) throw new Error('ELK未返回有效标签尺寸。');
      const bounds = { x1: label.x, y1: label.y, x2: label.x + label.width, y2: label.y + label.height, width: label.width, height: label.height };
      labels.push({ id: label.id, edgeId: edge.id, relationRef: edge.ref, text: edge.label, bounds });
      elements.push({ group: 'nodes', classes: `flow-label${edge.loop ? ' relation-loop' : ''}${edge.status !== 'valid' ? ' flow-anomaly' : ''}`, data: { id: `${edge.id}:label-node:${index}`, edgeId: edge.id, focusKind: edge.focusKind, focusRef: edge.ref, label: edge.label, rawLabel: edge.rawLabel, nodeWidth: label.width, nodeHeight: label.height, labelBounds: bounds, textMaxWidth: Math.max(1, label.width - 12), semanticSource: edge.source, semanticTarget: edge.target, path: edge.path, navigationTarget: edge.navigationTarget, auxiliary: edge.auxiliary, migrationRetained: edge.migrationRetained }, position: { x: label.x + label.width / 2, y: label.y + label.height / 2 } });
    });
  });
  return { elements, nodes, edges, labels, issues: input.issues, fingerprint: input.documentFingerprint, layout: { engine: 'elk-layered', version: FLOW_LAYOUT_VERSION, width: graph.width, height: graph.height, routeSegments, labelBounds: labels.map(label => ({ relationRef: label.relationRef, ...label.bounds })) } };
}

/** Edge endpoints must be restored before Cytoscape applies segment geometry. */
export function cytoscapeFlowElements(model) {
  return model.elements.map(({ style, ...element }) => element);
}

export function applyFlowRouteGeometry(cy, model) {
  cy.batch(() => {
    for (const element of model.elements) {
      if (!element.style) continue;
      const edge = cy.getElementById(element.data.id);
      if (!edge.length || !edge.isEdge()) throw new Error(`流程图路线 ${element.data.ref || element.data.id} 未完成端点关联。`);
      edge.style(element.style);
    }
  });
}
