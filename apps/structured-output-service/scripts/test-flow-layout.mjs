// Isolated ELK projection/routing/scheduling regressions. Synthetic data only; no service or storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';
import { createContext, runInContext } from 'node:vm';
import { buildFlowLayoutInput, materializeFlowLayout, cytoscapeFlowElements, applyFlowRouteGeometry } from '../frontend/flow-layout.mjs';
import { createFlowLayoutScheduler } from '../frontend/flow-layout-client.mjs';

const require = createRequire(import.meta.url);
const ELK = require('elkjs/lib/elk.bundled.js');
const cytoscape = require('cytoscape');
const Migration = require('../public/process-governance-migration.js');
const { createProcessVersionFixture } = require('./process-version-fixtures.js');
const clone = value => JSON.parse(JSON.stringify(value));
const bytes = value => JSON.stringify(value);
const finite = value => Number.isFinite(value);
const near = (a, b, epsilon = 0.05) => Math.abs(a - b) <= epsilon;
let checks = 0;

async function check(label, action) {
  await action();
  checks += 1;
  process.stdout.write(`PASS ${label}\n`);
}

function behavior(ref, type = 'action', name = ref, department = '合成测试部门') {
  return {
    behavior_ref: ref, node_type: type, behavior_name: name,
    behavior_description: '仅供隔离布局回归，不代表真实业务。',
    actor_assignment_mode: 'fixed_department', current_actor_role: department,
    actor_department_data_ref: null, countersign_target_departments: []
  };
}

function route(ref, from, to, type = 'sequence', condition = '') {
  return {
    relation_ref: ref, from_behavior_ref: from, to_behavior_ref: to,
    relation_type: type, condition
  };
}

function fixture() {
  return {
    schema_version: 'process-governance-v8',
    process: { process_ref: 'process_synthetic_layout', process_name: '合成流程图布局测试' },
    behaviors: [behavior('start', 'action', '同名环节'), behavior('decision', 'decision', '核对已记录条件'), behavior('branch_a', 'action', '同名环节'), behavior('branch_b'), behavior('split', 'parallel_split'), behavior('parallel_a'), behavior('parallel_b'), behavior('join', 'parallel_join'), behavior('end')],
    flow_relations: [
      route('r_start', 'start', 'decision'),
      route('r_yes', 'decision', 'branch_a', 'condition', '已记录路线一：核对资料完整性后继续'),
      route('r_no', 'decision', 'branch_b', 'condition', '已记录路线二：资料有缺项时退回补充'),
      route('r_a_split', 'branch_a', 'split'), route('r_b_split', 'branch_b', 'split'),
      route('r_split_a', 'split', 'parallel_a', 'parallel'), route('r_split_b', 'split', 'parallel_b', 'parallel'),
      route('r_a_join', 'parallel_a', 'join', 'parallel'), route('r_b_join', 'parallel_b', 'join', 'parallel'),
      route('r_end', 'join', 'end'), route('r_return', 'branch_b', 'start', 'loop', '返回原办理位置补充已记录资料'),
      route('r_self', 'branch_a', 'branch_a', 'loop', '在当前环节再次核对'),
      route('r_parallel_path', 'decision', 'branch_a', 'condition', '相同端点的另一条独立逻辑关系')
    ],
    data_objects: [], forms: [], terms: []
  };
}

function largeFixture(count = 96) {
  const document = fixture();
  const departments = ['合成工程技术部', '合成制造部', '合成质量部', '合成计划部', '合成采购部', '合成财务部'];
  document.behaviors = Array.from({ length: count }, (_, i) => behavior(`large_${i}`, i % 11 === 5 ? 'decision' : i === 8 ? 'parallel_split' : i === 13 ? 'parallel_join' : 'action', `合成长中文环节名称第${i}项：核对申请记录、取值来源与填写说明后继续`, departments[i % departments.length]));
  document.flow_relations = [];
  for (let i = 0; i < count - 1; i += 1) {
    document.flow_relations.push(route(`large_sequence_${i}`, `large_${i}`, `large_${i + 1}`, 'sequence', i % 11 === 5 ? `合成已记录条件第${i}项：资料完整、稳定标识清楚且父级归属可核对时沿此路线阅读，不推断实际执行结果` : ''));
    if (i > 18 && i % 17 === 3) document.flow_relations.push(route(`large_return_${i}`, `large_${i}`, `large_${i - 14}`, 'loop', `合成退回路线第${i}项：回到先前环节补充完整中文说明与引用来源`));
    if (i % 23 === 5) document.flow_relations.push(route(`large_alternative_${i}`, `large_${i}`, `large_${i + 1}`, 'condition', `合成同端点备选路线第${i}项：此条件属于独立关系，不与另一条连线合并`));
  }
  document.flow_relations.push(route('large_parallel_a', 'large_8', 'large_10', 'parallel'), route('large_parallel_b', 'large_8', 'large_12', 'parallel'), route('large_parallel_join_a', 'large_10', 'large_13', 'parallel'), route('large_parallel_join_b', 'large_12', 'large_13', 'parallel'), route('large_self', 'large_48', 'large_48', 'loop', '合成原位循环：保留箭头与独立路线标识'));
  return document;
}

async function layout(document, options = {}) {
  const input = buildFlowLayoutInput(document, options);
  const elk = new ELK();
  // The Node bundled implementation runs in-process; it does not own a native Worker.
  const graph = await elk.layout(clone(input.graph));
  return { input, graph, output: materializeFlowLayout(input, graph) };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function flatGraphNodes(graph, offset = { x: 0, y: 0 }) {
  return (graph.children || []).flatMap(node => {
    const absolute = { ...node, x: (node.x || 0) + offset.x, y: (node.y || 0) + offset.y };
    return [absolute, ...flatGraphNodes(node, { x: absolute.x, y: absolute.y })];
  });
}

function sectionPoints(section) {
  return [section.startPoint, ...(section.bendPoints || []), section.endPoint];
}

function assertOrthogonal(points, message) {
  assert(points.length >= 2, `${message}: route is incomplete`);
  for (const point of points) assert(finite(point?.x) && finite(point?.y), `${message}: non-finite route point`);
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    assert(near(a.x, b.x) || near(a.y, b.y), `${message}: diagonal segment ${index - 1}`);
  }
}

function assertNoNodeOverlap(graph) {
  const nodes = flatGraphNodes(graph).filter(node => !(node.children || []).length);
  for (let left = 0; left < nodes.length; left += 1) {
    const a = nodes[left];
    assert(finite(a.x) && finite(a.y) && finite(a.width) && finite(a.height) && a.width > 0 && a.height > 0, `Invalid node geometry ${a.id}`);
    for (let right = left + 1; right < nodes.length; right += 1) {
      const b = nodes[right];
      const overlapX = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
      assert(overlapX <= 0.05 || overlapY <= 0.05, `Node boxes overlap: ${a.id} / ${b.id}`);
    }
  }
}

class FakeWorker {
  constructor() {
    this.listeners = new Map(); this.messages = []; this.queuedHandlers = [];
    this.terminateCount = 0; this.onmessage = null; this.onerror = null;
  }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || new Set(); listeners.add(listener); this.listeners.set(type, listeners);
  }
  removeEventListener(type, listener) { this.listeners.get(type)?.delete(listener); }
  postMessage(message) {
    this.messages.push(clone(message));
    this.queuedHandlers = [...(this.listeners.get('message') || []), ...(this.onmessage ? [this.onmessage] : [])];
  }
  terminate() { this.terminateCount += 1; }
  emit(data, { queued = false } = {}) {
    const handlers = queued ? this.queuedHandlers : [...(this.listeners.get('message') || []), ...(this.onmessage ? [this.onmessage] : [])];
    handlers.forEach(handler => handler({ data }));
  }
  fail(message) {
    const event = { message, error: new Error(message), preventDefault() {} };
    [...(this.listeners.get('error') || []), ...(this.onerror ? [this.onerror] : [])].forEach(handler => handler(event));
  }
}

function schedulerHarness(timeoutMs = 2000) {
  const workers = [];
  const scheduler = createFlowLayoutScheduler({ timeoutMs, workerFactory: () => { const worker = new FakeWorker(); workers.push(worker); return worker; } });
  return { scheduler, workers };
}

function reply(worker, graph, extra = {}) {
  const request = worker.messages.at(-1);
  worker.emit({ generation: request.generation, identity: request.identity, graph, ...extra });
}

async function dedicatedWorkerHarness() {
  const vendorPath = require.resolve('elkjs/lib/elk-worker.min.js');
  const vendor = await readFile(vendorPath, 'utf8');
  const wrapper = await readFile(new URL('../frontend/flow-layout.worker.mjs', import.meta.url), 'utf8');
  const importLine = /^import\s+['"]elkjs\/lib\/elk-worker\.min\.js['"];?\s*$/m;
  assert(importLine.test(wrapper), 'Dedicated Worker must load the pinned official worker dispatcher');
  const messages = [], context = createContext({ postMessage: message => messages.push(clone(message)), setTimeout, clearTimeout });
  runInContext('self = globalThis;', context);
  assert.equal(runInContext('typeof document', context), 'undefined');
  assert.equal(runInContext('self === globalThis', context), true);
  runInContext(vendor, context, { filename: vendorPath, timeout: 5000 });
  assert.equal(runInContext('typeof self.onmessage', context), 'function', 'Real vendor must initialize the worker protocol');
  // An IIFE retains the wrapper's ES module scope; only its resolved import is replaced.
  runInContext(`(() => { ${wrapper.replace(importLine, '')}\n})()`, context, { filename: 'flow-layout.worker.mjs', timeout: 5000 });
  return {
    messages,
    dispatch(data) {
      // JSON.parse runs inside the VM: ELK's GWT array checks require input from this realm.
      context.requestJson = bytes(data);
      runInContext('self.onmessage({ data: JSON.parse(requestJson) });', context, { timeout: 5000 });
      delete context.requestJson;
    },
    publishAfterCompletion() { runInContext('self.postMessage({ id: 1, data: { id: "unowned-late-result" } });', context); }
  };
}

function assertRoutes({ input, graph, output }) {
  assert.equal(output.layout.engine, 'elk-layered');
  assert.equal(output.edges.length, input.edges.length, 'Every logical edge must survive materialization');
  assert.equal(output.nodes.length, input.nodes.length, 'Every projected object must remain available');
  assert(output.layout.width > 0 && output.layout.height > 0);
  const originalEdges = new Map(graph.edges.map(edge => [edge.id, edge]));
  let segmentCount = 0;
  for (const edge of output.edges) {
    const original = originalEdges.get(edge.id);
    assert.equal(edge.sections.length, original.sections.length, `${edge.ref}: lost ELK sections`);
    assert.deepEqual(edge.sections.map(section => section.points), original.sections.map(sectionPoints), `${edge.ref}: incomplete route geometry`);
    edge.sections.forEach(section => { assertOrthogonal(section.points, edge.ref); segmentCount += section.points.length - 1; });
    const rendered = output.elements.filter(element => element.group === 'edges' && element.data.semanticSource === edge.semanticSource && element.data.semanticTarget === edge.semanticTarget && element.data.path === edge.path);
    assert.equal(rendered.length, edge.sections.length);
    for (let index = 0; index < rendered.length; index += 1) {
      const element = rendered[index], section = edge.sections[index];
      assert.deepEqual(element.data.startPoint, section.startPoint);
      assert.deepEqual(element.data.endPoint, section.endPoint);
      assert.equal(element.style['target-arrow-shape'], index === rendered.length - 1 ? 'triangle' : 'none', 'Only the final route section owns the arrow');
      if (section.bendPoints.length) {
        const weights = element.style['segment-weights'].split(' ').map(Number);
        const distances = element.style['segment-distances'].split(' ').map(Number);
        assert.equal(weights.length, section.bendPoints.length);
        assert.equal(distances.length, section.bendPoints.length);
        const dx = section.endPoint.x - section.startPoint.x, dy = section.endPoint.y - section.startPoint.y;
        const length = Math.hypot(dx, dy);
        assert(length > 0, `${edge.ref}: non-reconstructable section geometry`);
        section.bendPoints.forEach((point, i) => {
          const x = section.startPoint.x + weights[i] * dx - distances[i] * dy / length;
          const y = section.startPoint.y + weights[i] * dy + distances[i] * dx / length;
          assert(near(x, point.x) && near(y, point.y), `${edge.ref}: Cytoscape segment loses ELK bend point ${i}`);
        });
      }
    }
  }
  assert.equal(output.layout.routeSegments.length, segmentCount);
  for (const label of output.labels) {
    const expected = input.edges.find(edge => edge.id === label.edgeId);
    const b = label.bounds;
    assert(expected && label.relationRef === expected.ref && label.text === expected.label);
    assert(Object.values(b).every(finite) && b.width > 0 && b.height > 0);
    assert(near(b.x2 - b.x1, b.width) && near(b.y2 - b.y1, b.height));
    const element = output.elements.find(item => item.classes.startsWith('flow-label') && item.data.edgeId === label.edgeId);
    assert(element && near(element.position.x, (b.x1 + b.x2) / 2) && near(element.position.y, (b.y1 + b.y2) / 2));
  }
  assert.equal(output.labels.length, input.edges.filter(edge => edge.label).length, 'Every condition/direction label must be placed');
}

function assertBoundary(point, node, label) {
  const dx = point.x - (node.x + node.width / 2), dy = point.y - (node.y + node.height / 2);
  if (node.shape === 'diamond') assert(near(Math.abs(dx) / (node.width / 2) + Math.abs(dy) / (node.height / 2), 1), `${label}: endpoint floats off diamond boundary`);
  else assert((near(Math.abs(dx), node.width / 2) && Math.abs(dy) <= node.height / 2 + 0.05) || (near(Math.abs(dy), node.height / 2) && Math.abs(dx) <= node.width / 2 + 0.05), `${label}: endpoint floats off rectangle boundary`);
}

function assertNoRouteThroughOtherNodes(output) {
  for (const edge of output.edges) {
    for (const section of edge.sections) {
      for (let i = 1; i < section.points.length; i += 1) {
        const a = section.points[i - 1], b = section.points[i];
        for (const node of output.nodes) {
          if (node.id === edge.semanticSource || node.id === edge.semanticTarget) continue;
          const interiorX = [node.x + 0.05, node.x + node.width - 0.05], interiorY = [node.y + 0.05, node.y + node.height - 0.05];
          const crosses = near(a.x, b.x)
            ? a.x > interiorX[0] && a.x < interiorX[1] && Math.min(a.y, b.y) < interiorY[1] && Math.max(a.y, b.y) > interiorY[0]
            : a.y > interiorY[0] && a.y < interiorY[1] && Math.min(a.x, b.x) < interiorX[1] && Math.max(a.x, b.x) > interiorX[0];
          assert(!crosses, `${edge.ref}: route crosses unrelated node ${node.ref}`);
        }
      }
    }
  }
}

function assertNoLabelOverlap(output) {
  const boxes = output.labels.map(label => ({ id: label.relationRef, ...label.bounds }));
  const overlaps = (a, b) => Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1) > 0.05 && Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1) > 0.05;
  for (let i = 0; i < boxes.length; i += 1) {
    const label = boxes[i];
    for (const node of output.nodes) assert(!overlaps(label, { x1: node.x, y1: node.y, x2: node.x + node.width, y2: node.y + node.height }), `${label.id}: label overlaps node ${node.ref}`);
    for (let j = i + 1; j < boxes.length; j += 1) assert(!overlaps(label, boxes[j]), `Label boxes overlap: ${label.id} / ${boxes[j].id}`);
  }
}

function assertCytoscapeLifecycle(model) {
  const before = bytes(model), warnings = [], savedWarn = console.warn;
  let cy;
  console.warn = (...args) => warnings.push(args.map(String).join(' '));
  try {
    const elements = cytoscapeFlowElements(model);
    assert(elements.every(element => !Object.hasOwn(element, 'style')), 'Constructor must receive endpoints before geometry bypasses');
    cy = cytoscape({ headless: true, styleEnabled: true, layout: { name: 'preset' }, elements, style: [
      { selector: 'node', style: { width: 'data(nodeWidth)', height: 'data(nodeHeight)' } },
      { selector: 'edge', style: { 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', width: 2 } },
      { selector: 'edge.call-auxiliary', style: { 'line-style': 'dashed' } }
    ] });
    applyFlowRouteGeometry(cy, model);
    const assertStyles = () => {
      for (const planned of model.elements.filter(element => element.group === 'edges')) {
        const edge = cy.getElementById(planned.data.id);
        assert.equal(edge.length, 1); assert(edge.isEdge());
        assert.equal(edge.source().id(), planned.data.source); assert.equal(edge.target().id(), planned.data.target);
        for (const key of ['curve-style', 'edge-distances', 'target-arrow-shape']) assert.equal(edge.pstyle(key).value, planned.style[key], `${edge.id()}: actual ${key} changed after endpoint restoration`);
        for (const key of ['segment-weights', 'segment-distances', 'source-endpoint', 'target-endpoint']) {
          const expected = planned.style[key].split(' ').map(Number), actual = edge.pstyle(key).value;
          assert.equal(actual.length, expected.length, `${edge.id()}: missing actual ${key}`);
          actual.forEach((value, index) => assert(near(value, expected[index]), `${edge.id()}: actual ${key} loses geometry`));
        }
        if (planned.data.auxiliary) assert.equal(edge.pstyle('line-style').value, 'dashed', 'Auxiliary calls must remain visually distinct');
      }
    };
    assertStyles();
    cy.style().selector('edge').style({ 'curve-style': 'bezier', width: 3 }).selector('edge.workbench-selected').style({ width: 4 }).update();
    cy.edges().addClass('workbench-selected');
    assertStyles();
    assert.equal(bytes(model), before, 'Renderer lifecycle cannot mutate projected source geometry');
  } finally {
    cy?.destroy(); console.warn = savedWarn;
  }
  assert.deepEqual(warnings, [], 'Cytoscape constructor/style update must not warn or coerce routed segments to bezier');
}

const base = fixture();
const baseResult = await layout(base);

await check('same names retain distinct stable nodes and independent same-endpoint relations', () => {
  const { input, output } = baseResult;
  assert.equal(input.nodes.filter(node => node.focusKind === 'behavior').length, base.behaviors.length);
  assert.equal(new Set(input.nodes.map(node => node.id)).size, input.nodes.length);
  assert.notEqual(input.nodes.find(node => node.ref === 'start').id, input.nodes.find(node => node.ref === 'branch_a').id);
  assert.equal(output.edges.filter(edge => edge.fromRef === 'decision' && edge.toRef === 'branch_a').length, 2);
  assert.deepEqual(output.edges.filter(edge => edge.fromRef === 'decision' && edge.toRef === 'branch_a').map(edge => edge.relationRefs), [['r_yes'], ['r_parallel_path']]);
});

await check('duplicate or missing object refs remain explicit unresolved endpoints', () => {
  const document = fixture();
  document.behaviors.push(behavior('start', 'action', '同名环节'), behavior('', 'action', '同名环节'));
  document.flow_relations.push(route('r_missing', '', 'not_present'), route('r_padded', ' start ', 'end'));
  const before = bytes(document), input = buildFlowLayoutInput(document);
  assert.equal(bytes(document), before);
  const starts = input.nodes.filter(node => node.focusKind === 'behavior' && node.ref === 'start');
  assert.equal(starts.length, 2); assert(starts.every(node => node.status === 'ambiguous'));
  const first = input.edges.find(edge => edge.ref === 'r_start');
  assert(first.source.startsWith('unresolved-endpoint:')); assert.equal(first.fromRef, 'start');
  const missing = input.edges.find(edge => edge.ref === 'r_missing');
  assert(missing.source.startsWith('unresolved-endpoint:') && missing.target.startsWith('unresolved-endpoint:'));
  const padded = input.edges.find(edge => edge.ref === 'r_padded');
  assert.equal(padded.fromRef, ' start '); assert(padded.source.startsWith('unresolved-endpoint:'));
  assert(input.issues.some(issue => issue.ref === ' start ' && issue.path.endsWith('/from_behavior_ref')));
  assert(input.nodes.some(node => node.focusKind === 'behavior' && node.ref === '' && node.status === 'missing'));
});

await check('full-document collisions with process/data/package identities cannot connect a guessed behavior', () => {
  for (const collision of ['process', 'data', 'package', 'migration-call', 'legacy-call']) {
    const document = fixture();
    if (collision === 'process') document.process.process_ref = 'start';
    if (collision === 'data') document.data_objects = [{ data_ref: 'start', data_name: '同名数据对象', fields: [] }];
    if (collision === 'package') document.export_meta = { package_ref: 'start' };
    if (collision === 'migration-call') document.migration = { internal_process_calls: [{ call_ref: 'start', caller_behavior_ref: 'end', return_behavior_ref: null }] };
    if (collision === 'legacy-call') document.internal_process_calls = [{ call_ref: 'start', caller_behavior_ref: 'end', return_behavior_ref: null }];
    const input = buildFlowLayoutInput(document);
    assert.equal(input.nodes.find(node => node.focusKind === 'behavior' && node.ref === 'start').status, 'ambiguous', collision);
    assert(input.edges.find(edge => edge.ref === 'r_start').source.startsWith('unresolved-endpoint:'), collision);
  }
});

await check('duplicate and missing relation refs retain separate records, direction and anomalies', () => {
  const document = fixture();
  document.flow_relations.push(route('r_yes', 'branch_b', 'end'), route('', 'end', 'start', 'loop', '合成缺失标识记录'));
  const input = buildFlowLayoutInput(document);
  const duplicates = input.edges.filter(edge => edge.ref === 'r_yes');
  assert.equal(duplicates.length, 2); assert.notEqual(duplicates[0].id, duplicates[1].id);
  assert(duplicates.every(edge => edge.status === 'unresolved'));
  assert.deepEqual(duplicates.map(edge => [edge.fromRef, edge.toRef]), [['decision', 'branch_a'], ['branch_b', 'end']]);
  assert.equal(input.edges.length, document.flow_relations.length);
  assert(input.issues.some(issue => issue.path.endsWith('/relation_ref') && issue.ref === ''));
});

await check('real ELK routes missing/ambiguous references as explicit anomaly nodes without reconnecting them', async () => {
  const document = fixture();
  document.behaviors.push(behavior('start', 'action', '同名环节'));
  document.flow_relations.push(route('r_unknown', ' start ', 'absent', 'condition', '合成未解析原值'));
  const before = bytes(document), result = await layout(deepFreeze(document));
  assertRoutes(result); assert.equal(bytes(document), before);
  const edge = result.output.edges.find(item => item.ref === 'r_unknown');
  assert.equal(edge.fromRef, ' start '); assert.equal(edge.toRef, 'absent');
  assert(edge.semanticSource.startsWith('unresolved-endpoint:') && edge.semanticTarget.startsWith('unresolved-endpoint:'));
  assert(result.output.elements.some(item => item.group === 'nodes' && item.data.id === edge.semanticSource && item.classes.includes('flow-anomaly')));
  assert(result.output.elements.some(item => item.group === 'edges' && item.data.path === edge.path && item.classes.includes('flow-anomaly')));
  assert(result.output.labels.find(item => item.edgeId === edge.id).text.includes('原引用已保留'));
  assert(!result.output.labels.find(item => item.edgeId === edge.id).text.includes(' start '));
});

await check('cycles/self-loops/parallel/multi-edges preserve original semantic direction and type', () => {
  const { output } = baseResult;
  for (const relation of base.flow_relations) {
    const edge = output.edges.find(item => item.ref === relation.relation_ref);
    assert(edge); assert.equal(edge.fromRef, relation.from_behavior_ref); assert.equal(edge.toRef, relation.to_behavior_ref);
    assert.equal(edge.relationType, relation.relation_type);
    assert.equal(edge.semanticSource, `behavior:${encodeURIComponent(relation.from_behavior_ref)}`);
    assert.equal(edge.semanticTarget, `behavior:${encodeURIComponent(relation.to_behavior_ref)}`);
  }
  assert.equal(output.edges.find(edge => edge.ref === 'r_self').semanticSource, output.edges.find(edge => edge.ref === 'r_self').semanticTarget);
  assert.equal(output.edges.find(edge => edge.ref === 'r_return').loop, true);
  assert.equal(output.edges.filter(edge => edge.relationType === 'parallel').length, 4);
});

await check('all real ELK sections/bends/labels are consumed and Cytoscape geometry reconstructs them', () => assertRoutes(baseResult));

await check('real Cytoscape lifecycle restores endpoints before segment geometry and preserves styles after selector updates', () => {
  const curves = new Set(baseResult.output.elements.filter(element => element.group === 'edges').map(element => element.style['curve-style']));
  assert(curves.has('segments') && curves.has('straight'), 'Lifecycle fixture must exercise both routed and straight sections');
  assertCytoscapeLifecycle(baseResult.output);
});

await check('diamond and rectangle endpoints lie on visible boundaries, including self-loops', () => {
  const { output } = baseResult, nodes = new Map(output.nodes.map(node => [node.id, node]));
  for (const edge of output.edges) {
    assertBoundary(edge.sections[0].startPoint, nodes.get(edge.semanticSource), `${edge.ref} source`);
    assertBoundary(edge.sections.at(-1).endPoint, nodes.get(edge.semanticTarget), `${edge.ref} target`);
  }
  const self = output.edges.find(edge => edge.ref === 'r_self');
  assert(self.points.length >= 4, 'Self-loop needs a real routed return path');
  assert(!near(self.points[0].x, self.points.at(-1).x) || !near(self.points[0].y, self.points.at(-1).y), 'Self-loop cannot collapse to one floating point');
  const selfElements = output.elements.filter(element => element.group === 'edges' && element.data.path === self.path);
  assert(selfElements.every(element => element.data.source.includes(':section:') && element.data.target.includes(':section:')));
});

await check('multi-section routes retain each section and only final arrow without changing logical ownership', () => {
  const graph = clone(baseResult.graph), edge = graph.edges.find(item => item.id === 'relation:r_start'), original = edge.sections[0];
  const points = sectionPoints(original), a = points[0], b = points[1];
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  edge.sections = [{ id: `${edge.id}:part0`, startPoint: a, endPoint: middle, bendPoints: [] }, { id: `${edge.id}:part1`, startPoint: middle, endPoint: points.at(-1), bendPoints: points.slice(1, -1) }];
  const output = materializeFlowLayout(baseResult.input, graph);
  assertRoutes({ input: baseResult.input, graph, output });
  const record = output.edges.find(item => item.ref === 'r_start');
  assert.equal(record.sections.length, 2); assert.equal(record.semanticSource, 'behavior:start'); assert.equal(record.semanticTarget, 'behavior:decision');
  assert.equal(output.elements.filter(element => element.group === 'nodes' && element.classes === 'flow-route-anchor' && element.data.ownerEdge === edge.id).length, 4);
});

await check('projection/materialization never change frozen business JSON or planned geometry', async () => {
  const document = deepFreeze(fixture()), before = bytes(document);
  const input = deepFreeze(buildFlowLayoutInput(document)), planned = bytes(input);
  const elk = new ELK();
  const graph = await elk.layout(clone(input.graph)), placedBefore = bytes(graph);
  const output = materializeFlowLayout(input, deepFreeze(graph));
  assert.equal(bytes(document), before); assert.equal(bytes(input), planned); assert.equal(bytes(graph), placedBefore);
  assert.equal(output.fingerprint, input.documentFingerprint);
  assert(document.behaviors.every(node => !Object.hasOwn(node, 'x') && !Object.hasOwn(node, 'y')));
});

await check('supported V7 projects through ELK without upgrading or rewriting the source', async () => {
  const document = Migration.migrateProcessDocument(createProcessVersionFixture('process-governance-v6'));
  assert.equal(document.schema_version, 'process-governance-v7');
  const before = bytes(document), result = await layout(deepFreeze(document));
  assert.equal(bytes(document), before); assertRoutes(result);
  assert.equal(result.output.nodes.filter(node => node.focusKind === 'behavior').length, document.behaviors.length);
  assert.equal(result.output.edges.filter(edge => edge.focusKind === 'relation').length, document.flow_relations.length);
});

await check('legacy and migration internal calls remain read-only auxiliary clues with original source and navigation', async () => {
  const document = fixture(); document.schema_version = 'process-governance-v7';
  document.internal_process_calls = [{ call_ref: 'call_top', caller_behavior_ref: 'start', return_behavior_ref: 'end', target_process_name: '合成历史内部调用', notes: '保留旧调用线索' }];
  document.migration = { internal_process_calls: [{ call_ref: 'call_retained', caller_behavior_ref: 'branch_a', return_behavior_ref: 'branch_b', target_process_name: '合成迁移留存调用', notes: '保留迁移原值' }] };
  const before = bytes(document), result = await layout(deepFreeze(document));
  assertRoutes(result); assert.equal(bytes(document), before);
  for (const [ref, path, title, migrationRetained, rawCall] of [
    ['call_top', '/internal_process_calls/0', '内部流程调用线索', false, document.internal_process_calls[0]],
    ['call_retained', '/migration/internal_process_calls/0', '迁移留存 · 辅助引用', true, document.migration.internal_process_calls[0]]
  ]) {
    const node = result.output.nodes.find(item => item.focusKind === 'call' && item.ref === ref);
    assert(node && node.rawLabel.startsWith(title)); assert.equal(node.path, path); assert.equal(node.auxiliary, true); assert.equal(node.migrationRetained, migrationRetained);
    assert.deepEqual(node.rawCall, rawCall);
    assert.deepEqual(node.navigationTarget, { kind: 'behavior', ref: rawCall.caller_behavior_ref, parentRef: '', relatedKind: 'call' });
    const edges = result.output.edges.filter(item => item.ref === ref);
    assert.equal(edges.length, 2);
    for (const edge of edges) {
      assert.equal(edge.focusKind, 'call'); assert.equal(edge.path, path); assert.equal(edge.auxiliary, true); assert.equal(edge.migrationRetained, migrationRetained);
      assert.deepEqual(edge.rawCall, rawCall); assert.deepEqual(edge.navigationTarget, node.navigationTarget);
      assert(!edge.path.startsWith('/flow_relations/'));
      assert(result.output.elements.some(element => element.group === 'edges' && element.data.id === edge.id && element.classes.includes('call-auxiliary')));
    }
  }
  assert.equal(result.output.edges.filter(edge => edge.focusKind === 'relation').length, document.flow_relations.length, 'Auxiliary calls cannot become logical process relations');
  assertCytoscapeLifecycle(result.output);
  assert.equal(bytes(document), before);
});

await check('real ELK node placement is deterministic for identical stable documents', async () => {
  const another = await layout(fixture());
  // GWT assigns private $H object hashes per invocation; compare the actual display geometry.
  const geometry = output => ({
    width: output.layout.width, height: output.layout.height,
    nodes: output.nodes.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })),
    routes: output.edges.map(({ id, sections }) => ({ id, points: sections.map(section => section.points) })),
    labels: output.labels
  });
  assert.deepEqual(geometry(another.output), geometry(baseResult.output));
  assert.equal(another.output.fingerprint, baseResult.output.fingerprint);
});

await check('measured Chinese labels wrap and dynamic departments identify source data without inventing identities', () => {
  const document = fixture();
  document.behaviors[0].behavior_name = '合成长中文环节名称：核对申请记录、取值来源与填写说明';
  document.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
  document.behaviors[0].actor_department_data_ref = 'source_data';
  document.data_objects = [{ data_ref: 'source_data', data_name: '合成申请数据', fields: [] }];
  const calls = [], input = buildFlowLayoutInput(document, { measureText: (value, size) => { calls.push(size); return [...value].length * size; } });
  const node = input.nodes.find(item => item.ref === 'start');
  assert(calls.includes(14) && calls.includes(13)); assert(node.label.includes('\n') && node.labelWidth <= node.textMaxWidth);
  assert.equal(node.dynamicActor, true); assert(node.actorFact.includes('按数据动态确定') && node.actorFact.includes('合成申请数据'));
  assert.equal(input.nodes.filter(item => item.focusKind === 'department').length, 0);
  document.data_objects.push({ data_ref: 'source_data', data_name: '合成重复数据', fields: [] });
  assert(buildFlowLayoutInput(document).nodes.find(item => item.ref === 'start').actorFact.includes('无法唯一确定'));
});

await check('dynamic department source obeys full-document ambiguity, not a data-name guess', () => {
  for (const collision of ['term', 'package', 'migration']) {
    const document = fixture();
    document.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
    document.behaviors[0].actor_department_data_ref = 'actor_source';
    document.data_objects = [{ data_ref: 'actor_source', data_name: '合成动态部门来源', fields: [] }];
    if (collision === 'term') document.terms = [{ term_ref: 'actor_source', term_name: '合成术语', definition: '' }];
    if (collision === 'package') document.export_meta = { package_ref: 'actor_source' };
    if (collision === 'migration') document.migration = { reference_materials: [{ material_ref: 'actor_source' }] };
    const before = bytes(document), input = buildFlowLayoutInput(document), node = input.nodes.find(item => item.focusKind === 'behavior' && item.ref === 'start');
    assert(node.actorFact.includes('无法唯一确定'), `${collision}: dynamic actor source must not appear resolved`);
    assert(!node.actorFact.includes('actor_source'), `${collision}: original ref cannot appear in the business label`);
    assert.equal(document.behaviors[0].actor_department_data_ref, 'actor_source', `${collision}: preserve the original ref internally`);
    assert.equal(bytes(document), before);
  }
});

await check('flow business labels and diagnostics hide machine refs while retaining original values and auxiliary clues', async () => {
  const document = fixture();
  document.behaviors.forEach((item, index) => { item.behavior_name = `业务环节${index + 1}`; });
  document.behaviors[0].actor_assignment_mode = 'dynamic_from_data';
  document.behaviors[0].actor_department_data_ref = 'machine_actor_source_hidden';
  document.behaviors.push(behavior('start', 'action', '同名业务环节'));
  document.flow_relations.push(route('machine_route_hidden', ' machine_endpoint_hidden ', 'machine_missing_hidden', 'condition'));
  document.internal_process_calls = [{ call_ref: 'machine_call_hidden', caller_behavior_ref: 'end', return_behavior_ref: 'decision', target_process_name: '设备制度 GLTX-JY-34' }];
  document.migration = { internal_process_calls: [{ call_ref: 'machine_retained_hidden', caller_behavior_ref: 'branch_a', target_process_name: '申请表 GLTX-JY-34-A-01' }] };
  const before = bytes(document), result = await layout(deepFreeze(document));
  assertRoutes(result);
  const captions = [...result.input.nodes.map(node => node.rawLabel), ...result.input.edges.map(edge => edge.rawLabel), ...result.input.issues.map(issue => issue.message)].join('\n');
  assert(!/machine_[a-z_]+|\/behaviors\/|\/flow_relations\/|actor_department_data_ref/.test(captions));
  assert(captions.includes('来源数据引用缺失') && captions.includes('无法唯一确定') && captions.includes('原引用已保留'));
  assert(captions.includes('GLTX-JY-34') && captions.includes('GLTX-JY-34-A-01'));
  const invalid = result.output.edges.find(edge => edge.ref === 'machine_route_hidden');
  assert.equal(invalid.fromRef, ' machine_endpoint_hidden '); assert.equal(invalid.toRef, 'machine_missing_hidden');
  assert(invalid.semanticSource.startsWith('unresolved-endpoint:') && invalid.semanticTarget.startsWith('unresolved-endpoint:'));
  assert(result.input.issues.some(issue => issue.ref === 'machine_actor_source_hidden' && issue.path.endsWith('/actor_department_data_ref')));
  assert.equal(result.output.nodes.find(node => node.ref === 'machine_call_hidden').rawCall.call_ref, 'machine_call_hidden');
  assert.equal(bytes(document), before);
});

await check('synthetic condition/loop labels do not overlap object or label boxes', () => assertNoLabelOverlap(baseResult.output));

await check('incomplete ELK results reject visibly instead of publishing invented fallback geometry', () => {
  const noRoute = clone(baseResult.graph); noRoute.edges[0].sections = [];
  assert.throws(() => materializeFlowLayout(baseResult.input, noRoute), /完整路由/);
  const noLabel = clone(baseResult.graph); noLabel.edges.find(edge => edge.labels?.length).labels = [];
  assert.throws(() => materializeFlowLayout(baseResult.input, noLabel), /标签位置/);
  const nonFinite = clone(baseResult.graph); nonFinite.edges[0].sections[0].startPoint.x = NaN;
  assert.throws(() => materializeFlowLayout(baseResult.input, nonFinite), /坐标/);
});

await check('96-node Chinese/multi-department/return-loop fixture routes locally without overlap or missing geometry', async () => {
  const document = largeFixture(), before = bytes(document), start = performance.now(), result = await layout(deepFreeze(document));
  assert.equal(bytes(document), before); assertRoutes(result); assertNoNodeOverlap(result.graph); assertNoRouteThroughOtherNodes(result.output); assertNoLabelOverlap(result.output);
  assert.equal(result.input.issues.length, 0);
  assert.equal(result.output.nodes.length, 96); assert.equal(result.output.edges.length, document.flow_relations.length);
  assert.equal(new Set(document.behaviors.map(item => item.current_actor_role)).size, 6);
  process.stdout.write(`EVIDENCE real ELK synthetic: ${result.output.nodes.length} nodes, ${result.output.edges.length} edges, ${result.output.labels.length} labels, ${Math.round(result.output.layout.width)}x${Math.round(result.output.layout.height)}, ${Math.round(performance.now() - start)}ms\n`);
});

const dedicated = await dedicatedWorkerHarness();
await check('actual ELK worker dispatcher initializes in DedicatedWorkerGlobalScope and returns complete tagged geometry', () => {
  const identity = { candidateKey: 'vm-worker-candidate', revision: 7, documentKey: baseResult.input.documentFingerprint };
  const inputBefore = bytes(baseResult.input);
  dedicated.dispatch({ generation: 23, identity, graph: baseResult.input.graph });
  assert.equal(dedicated.messages.length, 1, 'Register acknowledgement must not be published as a layout result');
  const response = dedicated.messages[0];
  assert.equal(response.generation, 23); assert.deepEqual(response.identity, identity); assert(!response.error);
  const output = materializeFlowLayout(baseResult.input, response.graph);
  assertRoutes({ input: baseResult.input, graph: response.graph, output });
  assertNoNodeOverlap(response.graph); assertNoLabelOverlap(output); assert.equal(bytes(baseResult.input), inputBefore);
  dedicated.publishAfterCompletion();
  assert.equal(dedicated.messages.length, 1, 'Dispatcher cannot publish a result without pending request ownership');
});

await check('actual ELK Dedicated Worker failures preserve generation/identity and return an explicit error', () => {
  const identity = { candidateKey: 'vm-worker-invalid', revision: 8, documentKey: 'synthetic-invalid-algorithm' };
  const graph = { id: 'invalid-algorithm', layoutOptions: { 'elk.algorithm': 'synthetic-unregistered-algorithm' }, children: [{ id: 'one', width: 100, height: 60 }], edges: [] };
  dedicated.dispatch({ generation: 24, identity, graph });
  assert.equal(dedicated.messages.length, 2);
  const response = dedicated.messages.at(-1);
  assert.equal(response.generation, 24); assert.deepEqual(response.identity, identity);
  assert.equal(typeof response.error, 'string'); assert(response.error.length > 0); assert(!response.graph);
  dedicated.publishAfterCompletion(); assert.equal(dedicated.messages.length, 2);
});

await check('scheduler supersedes and rejects old work; queued late replies cannot publish an obsolete graph', async () => {
  const { scheduler, workers } = schedulerHarness(), writes = [];
  const first = scheduler.layout(baseResult.input, { candidateKey: 'candidate-one', revision: 1 });
  const rejected = assert.rejects(first, error => error.name === 'AbortError');
  first.then(result => writes.push(result), () => {});
  const second = scheduler.layout(baseResult.input, { candidateKey: 'candidate-two', revision: 2, documentKey: 'document-two' });
  assert.equal(workers[0].terminateCount, 1);
  const old = workers[0].messages[0];
  workers[0].emit({ generation: old.generation, identity: old.identity, graph: { id: 'obsolete' } }, { queued: true });
  const current = workers[1].messages[0];
  workers[1].emit({ generation: current.generation - 1, identity: current.identity, graph: { id: 'wrong-generation' } });
  workers[1].emit({ generation: current.generation, identity: { ...current.identity, revision: 1 }, graph: { id: 'wrong-revision' } });
  reply(workers[1], { id: 'current' });
  const result = await second; await rejected;
  assert.equal(result.graph.id, 'current'); assert.deepEqual(result.identity, { candidateKey: 'candidate-two', revision: 2, documentKey: 'document-two' });
  assert.deepEqual(writes, []); assert.equal(workers[1].terminateCount, 1);
  scheduler.destroy();
});

await check('explicit cancellation and destruction reject, terminate and ignore queued late replies', async () => {
  for (const action of ['cancel', 'destroy']) {
    const { scheduler, workers } = schedulerHarness(), writes = [];
    const pending = scheduler.layout(baseResult.input, { candidateKey: 'candidate-cancel', revision: 1 });
    pending.then(result => writes.push(result), () => {});
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    scheduler[action]();
    const request = workers[0].messages[0];
    workers[0].emit({ generation: request.generation, identity: request.identity, graph: { id: 'late' } }, { queued: true });
    await rejected; assert.equal(workers[0].terminateCount, 1); assert.deepEqual(writes, []);
    if (action === 'destroy') { await assert.rejects(scheduler.layout(baseResult.input), error => error.name === 'AbortError'); assert.equal(workers.length, 1); }
    scheduler.destroy();
  }
});

await check('scheduler timeout/error rejects and terminates without publishing late or invalid results', async () => {
  const timeout = schedulerHarness(20), writes = [];
  const pending = timeout.scheduler.layout(baseResult.input);
  pending.then(result => writes.push(result), () => {});
  await assert.rejects(pending, /超过/);
  const request = timeout.workers[0].messages[0];
  assert.equal(request.identity.documentKey, baseResult.input.documentFingerprint);
  timeout.workers[0].emit({ generation: request.generation, identity: request.identity, graph: { id: 'after-timeout' } }, { queued: true });
  assert.equal(timeout.workers[0].terminateCount, 1); assert.deepEqual(writes, []); timeout.scheduler.destroy();
  for (const failure of ['runtime', 'returned', 'message']) {
    const { scheduler, workers } = schedulerHarness();
    const promise = scheduler.layout(baseResult.input), rejected = assert.rejects(promise, /布局|无法读取/);
    if (failure === 'runtime') workers[0].fail('synthetic worker error');
    if (failure === 'returned') reply(workers[0], null, { error: 'synthetic ELK error' });
    if (failure === 'message') workers[0].onmessageerror();
    await rejected; assert.equal(workers[0].terminateCount, 1); scheduler.destroy();
  }
});

process.stdout.write(`Flow layout regression passed (${checks} checks; real local ELK and worker dispatcher VM, mock scheduler only).\n`);
