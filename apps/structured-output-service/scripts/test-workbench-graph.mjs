// Runs local, isolated projection/animation/reading checks; no service, database or persistent storage.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { MOTION_MS, buildDirectRelationGraph, createMotionCoordinator, createReadingSession, locationViewport, targetKey } from '../frontend/graph-motion.mjs';
const require = createRequire(import.meta.url);
const References = require('../public/element-references.js');
const ProcessDiagram = require('../public/process-diagram.js');
const cytoscape = require('cytoscape');

let checks = 0;
function check(label, action) { action(); checks += 1; console.log(`PASS ${label}`); }
const behavior = (ref, type = 'action') => ({ behavior_ref: ref, node_type: type, behavior_name: ref, actor_assignment_mode: 'fixed_department', current_actor_role: '测试部门', countersign_target_departments: [] });
const route = (ref, from, to, type = 'sequence', condition = '') => ({ relation_ref: ref, from_behavior_ref: from, to_behavior_ref: to, relation_type: type, condition });
const base = () => ({ process: { process_ref: 'process_test', process_name: '虚构测试流程' }, behaviors: [behavior('a'), behavior('b'), behavior('c')], flow_relations: [route('ab', 'a', 'b'), route('bc', 'b', 'c')], data_objects: [], forms: [], terms: [] });
const target = (kind, ref, parentRef = '') => ({ kind, ref, parentRef });
function graph(document, selected) { const catalog = References.buildCatalog(document); return buildDirectRelationGraph(document, catalog, References, selected); }

check('recorded sequential reading is immutable and stops at the end', () => {
  const document = base(); const before = JSON.stringify(document);
  const session = createReadingSession(document, 'a', { viewport: { zoom: 0.4, pan: { x: 0, y: 0 } } });
  assert.deepEqual(session.snapshot().refs, ['a']);
  assert.deepEqual(session.step().refs, ['b']);
  assert.deepEqual(session.step().refs, ['c']);
  assert.equal(session.step().stopped, 'end');
  assert.equal(session.snapshot().canNext, false);
  session.previous(); assert.equal(session.step().stopped, 'end');
  assert.equal(JSON.stringify(document), before);
});

check('decision requires a recorded user choice and never evaluates its condition', () => {
  const document = base(); document.behaviors[0].node_type = 'decision';
  document.flow_relations = [route('ab', 'a', 'b', 'condition', '假设条件一'), route('ac', 'a', 'c', 'condition', '假设条件二')];
  const session = createReadingSession(document, 'a');
  const paused = session.step();
  assert.equal(paused.stopped, 'choice'); assert.deepEqual(paused.refs, ['a']); assert.equal(paused.choices.length, 2);
  assert.deepEqual(session.step('ac').refs, ['c']);
});

check('parallel destinations are one group and converge without fabricated ordering', () => {
  const document = base(); document.behaviors = [behavior('split', 'parallel_split'), behavior('b'), behavior('c'), behavior('join', 'parallel_join')];
  document.flow_relations = [route('sb', 'split', 'b', 'parallel'), route('sc', 'split', 'c', 'parallel'), route('bj', 'b', 'join', 'parallel'), route('cj', 'c', 'join', 'parallel')];
  const session = createReadingSession(document, 'split');
  assert.deepEqual(new Set(session.step().refs), new Set(['b', 'c']));
  const merged = session.step(); assert.deepEqual(merged.refs, ['join']); assert.equal(merged.routeRefs.length, 2);
});

check('parallel decision choices retain the other recorded branches', () => {
  const document = base(); document.behaviors = [behavior('split', 'parallel_split'), behavior('decision', 'decision'), behavior('other'), behavior('yes'), behavior('no'), behavior('continuation')];
  document.flow_relations = [route('sd', 'split', 'decision', 'parallel'), route('so', 'split', 'other', 'parallel'), route('dy', 'decision', 'yes', 'condition'), route('dn', 'decision', 'no', 'condition'), route('oc', 'other', 'continuation')];
  const session = createReadingSession(document, 'split'); session.step();
  assert.equal(session.step().stopped, 'choice');
  assert.deepEqual(new Set(session.step('dn').refs), new Set(['no', 'continuation']));
});

check('cycles pause on the first revisited node and history cannot bypass that pause', () => {
  const document = base(); document.flow_relations = [route('ab', 'a', 'b'), route('ba', 'b', 'a', 'loop')];
  const session = createReadingSession(document, 'a'); session.step();
  assert.equal(session.step().stopped, 'loop'); assert.equal(session.step().position, 2);
  session.previous(); assert.equal(session.step().stopped, 'loop'); assert.equal(session.step().position, 2);
});

check('missing and ambiguous stable IDs never become a reading route', () => {
  const document = base(); document.behaviors.push(behavior('b'));
  assert.equal(createReadingSession(document, 'a').step().stopped, 'broken');
  assert.throws(() => createReadingSession(document, 'b'), /唯一稳定标识/);
  document.behaviors = [behavior('a')]; document.flow_relations = [route('ax', 'a', 'missing')];
  assert.equal(createReadingSession(document, 'a').step().stopped, 'broken');
});

check('duplicate route IDs stop reading even when their names or endpoints differ', () => {
  const document = base(); document.flow_relations.push(route('ab', 'c', 'a'));
  assert.equal(createReadingSession(document, 'a').step().stopped, 'broken');
});

check('relation graph uses recorded direction and stable identity, not identical labels', () => {
  const document = base(); document.behaviors[0].behavior_name = document.behaviors[1].behavior_name = '同名环节';
  const model = graph(document, target('behavior', 'a'));
  const flow = model.elements.find(item => item.data.category === 'flow');
  const from = model.elements.find(item => item.data.id === flow.data.source);
  const to = model.elements.find(item => item.data.id === flow.data.target);
  assert.equal(from.data.target.ref, 'a'); assert.equal(to.data.target.ref, 'b');
  assert.equal(flow.data.detailTarget.ref, 'ab');
  const instance = cytoscape({ headless: true, elements: model.elements, layout: { name: 'preset' } });
  assert.equal(instance.edges().length, model.relationshipCount); instance.destroy();
});

check('parent ownership and a wrong-parent reference remain separate and explicit', () => {
  const document = base();
  document.data_objects = [{ data_ref: 'data_1', data_name: '数据一', fields: [{ field_ref: 'field_1', field_name: '同名字段' }] }, { data_ref: 'data_2', data_name: '数据二', fields: [{ field_ref: 'field_2', field_name: '同名字段' }] }];
  document.forms = [{ form_ref: 'form_1', form_name: '测试表单', areas: [{ area_ref: 'area_1', area_title: '区域一', items: [{ item_ref: 'item_1', item_name: '测试字段', business_data_ref: 'data_2', data_field_ref: 'field_1' }] }] }];
  const model = graph(document, target('form-item', 'item_1', 'form_1'));
  assert(model.elements.some(item => item.data.category === 'ownership' && item.data.label.includes('区域')));
  const failed = model.elements.find(item => item.data.anomaly && item.data.category === 'reference');
  assert(failed.data.label.includes('父级不符')); assert(failed.data.label.includes('field_1'));
  const unresolved = model.elements.find(item => item.data.id === failed.data.target);
  assert.equal(unresolved.data.target, null);
});

check('aggregated field references name their source without inventing parent references', () => {
  const document = base();
  document.data_objects = [{ data_ref: 'data_1', data_name: '数据一', fields: [{ field_ref: 'field_1', field_name: '业务定义' }] }];
  document.forms = [{ form_ref: 'form_1', form_name: '测试表单', areas: [{ area_ref: 'area_1', area_title: '区域一', items: [{ item_ref: 'item_1', item_name: '显示名称', business_data_ref: 'data_1', data_field_ref: 'field_1' }] }] }];
  const model = graph(document, target('form-area', 'area_1', 'form_1'));
  const aggregate = model.elements.filter(item => item.data.category === 'reference');
  assert.equal(aggregate.length, 2); assert(aggregate.every(item => item.data.label.includes('来自子项 item_1')));
  assert(aggregate.every(item => item.data.source === model.centerId));
});

check('terms have definitions and containment, never invented structured usage', () => {
  const document = base(); document.terms = [{ term_ref: 'term_1', term_name: '测试术语', definition: '测试定义' }];
  const model = graph(document, target('term', 'term_1'));
  assert.equal(model.noTermUsage, true); assert.equal(model.anomalyCount, 0);
  assert(!model.elements.some(item => item.data.category === 'reference'));
});

check('structured data link references are outward, with their data owner separate', () => {
  const document = base();
  document.data_objects = [{ data_ref: 'data_1', data_name: '数据一', fields: [{ field_ref: 'field_1', field_name: '字段一' }], behavior_links: [{ link_ref: 'link_1', operation: 'update', behavior_ref: 'b', updated_field_refs: ['field_1'] }] }];
  const model = graph(document, target('data-link', 'link_1', 'data_1'));
  const refs = model.elements.filter(item => item.data.category === 'reference');
  assert.equal(refs.length, 2); assert(refs.every(item => item.data.source === model.centerId));
  assert(model.elements.some(item => item.data.category === 'ownership' && item.data.target === model.centerId));
});

check('lifecycle event parent is its route and trigger reference points outward', () => {
  const document = base();
  document.data_objects = [{ data_ref: 'data_1', data_name: '数据一', lifecycle: { routes: [{ route_ref: 'life_route', route_label: '测试路径', flow_relation_refs: ['ab'], events: [{ event_ref: 'event_1', action: 'archive', trigger: { behavior_ref: 'b' } }] }] } }];
  const model = graph(document, target('lifecycle-event', 'event_1', 'life_route'));
  assert(model.elements.some(item => item.data.target?.kind === 'lifecycle-route'));
  const ref = model.elements.find(item => item.data.category === 'reference');
  assert.equal(ref.data.source, model.centerId);
  const destination = model.elements.find(item => item.data.id === ref.data.target); assert.equal(destination.data.target.ref, 'b');
});

check('incoming object references retain the exact structured-record source label', () => {
  const document = base();
  document.data_objects = [{ data_ref: 'data_1', data_name: '数据一', behavior_links: [{ link_ref: 'link_1', operation: 'create', behavior_ref: 'b' }, { link_ref: 'link_2', operation: 'use', behavior_ref: 'b' }] }];
  const model = graph(document, target('behavior', 'b'));
  const refs = model.elements.filter(item => item.data.category === 'reference');
  assert.equal(refs.length, 2);
  assert(refs.some(item => item.data.label.includes('来自子项 link_1')));
  assert(refs.some(item => item.data.label.includes('来自子项 link_2')));
  assert(refs.every(item => item.data.target === model.centerId));
});

check('existing shared trunks retain their specific logical source and destination', () => {
  const document = base(); document.flow_relations = [route('ac', 'a', 'c'), route('bc', 'b', 'c')];
  const model = ProcessDiagram.buildGraphModel(document);
  const logical = model.edges.filter(item => item.data.focusKind === 'relation');
  assert.equal(logical.length, 2);
  assert(logical.every(item => item.data.semanticSource && item.data.semanticTarget));
  assert.equal(new Set(logical.map(item => item.data.focusRef)).size, 2);
});

function motionHarness(reduced = false) {
  let zoom = 1; let pan = { x: 0, y: 0 }; let width = 1000; let height = 600; let nextWidth = width;
  const callbacks = []; const timers = new Map(); const reports = [];
  let timerCount = 0; let coordinator;
  const cy = { zoom(value) { if (value !== undefined) zoom = value; return zoom; }, pan(value) { if (value) pan = { ...value }; return pan; }, width: () => width, height: () => height, stop() {}, resize() { width = nextWidth; }, animate(value, options) { zoom = value.zoom; pan = { ...value.pan }; callbacks.push(options.complete); } };
  coordinator = createMotionCoordinator({ cy, reduced: () => reduced, report: value => { assert.equal(coordinator.isProgrammatic(), true); reports.push(value); }, setTimer: callback => { const id = ++timerCount; timers.set(id, callback); return id; }, clearTimer: id => timers.delete(id) });
  return { cy, coordinator, callbacks, timers, reports, resize: () => { nextWidth = 580; } };
}

check('a newer locate cancels old completion callbacks and old pulses', () => {
  const h = motionHarness(); h.coordinator.move({ zoom: 0.5, pan: { x: 10, y: 20 } });
  let expired = false; h.coordinator.later(() => { expired = true; }, MOTION_MS.direction);
  const oldTimer = [...h.timers.values()][0];
  h.coordinator.move({ zoom: 0.7, pan: { x: 40, y: 50 } });
  const count = h.reports.length; h.callbacks[0](); oldTimer();
  assert.equal(h.reports.length, count); assert.equal(expired, false); assert.equal(h.coordinator.isProgrammatic(), true);
  h.callbacks[1](); assert.equal(h.coordinator.isProgrammatic(), false);
  assert.deepEqual(h.reports.at(-1).pan, { x: 40, y: 50 });
});

check('dragging cancels motion, reports manual position, and destroyed callbacks stay silent', () => {
  const h = motionHarness(); h.coordinator.move({ zoom: 0.5, pan: { x: 10, y: 20 } }); h.coordinator.cancel({ user: true });
  assert.equal(h.reports.at(-1).mode, 'manual');
  const count = h.reports.length; h.coordinator.destroy(); assert.equal(h.reports.length, count); h.callbacks[0]();
  assert.equal(h.reports.length, count);
});

check('reduced motion directly locates and resize preserves the centre', () => {
  const h = motionHarness(true); h.coordinator.move({ zoom: 0.5, pan: { x: 10, y: 20 } });
  assert.equal(h.callbacks.length, 0); assert.equal(h.coordinator.isProgrammatic(), false);
  h.resize(); h.coordinator.preserveResize(); assert.equal(h.cy.pan().x, -200); assert.equal(h.cy.zoom(), 0.5);
  assert.equal(MOTION_MS.select, 150); assert.equal(MOTION_MS.locate, 250); assert.equal(MOTION_MS.reading, 1500);
});

check('a fully visible target highlights without unnecessary camera movement', () => {
  const fake = { width: () => 1000, height: () => 600, zoom: () => 1 };
  const visible = { length: 1, renderedBoundingBox: () => ({ x1: 100, y1: 100, x2: 200, y2: 200 }) };
  assert.equal(locationViewport(fake, visible), null);
  assert.notEqual(targetKey(target('data-field', 'same', 'parent_1')), targetKey(target('data-field', 'same', 'parent_2')));
});

console.log(`Workbench graph: ${checks} isolated checks passed.`);
