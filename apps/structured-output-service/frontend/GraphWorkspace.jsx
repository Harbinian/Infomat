import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Space, Tag, Tooltip } from 'antd';
import cytoscape from 'cytoscape';
import { MOTION_MS, buildDirectRelationGraph, createMotionCoordinator, createReadingSession, kindLabel, locationViewport, targetKey } from './graph-motion.mjs';

const array = value => Array.isArray(value) ? value : [];
const READING_MESSAGES = { choice: '判断或多路线处已暂停：请选择文件中已记录的路线。', loop: '再次到达已读环节，已暂停，避免无限循环。', broken: '下一路线的稳定标识缺失或存在歧义，阅读已暂停。', end: '已到达当前记录路线的末端。' };
const relationStyles = [
  { selector: 'node', style: { width: 264, height: 104, shape: 'round-rectangle', 'background-color': '#f8f1e2', 'border-color': '#92977d', 'border-width': 2, label: 'data(label)', color: '#443d32', 'font-family': 'Microsoft YaHei', 'font-size': 14, 'text-wrap': 'wrap', 'text-max-width': 232, 'text-valign': 'center', 'text-halign': 'center' } },
  { selector: 'node[?current]', style: { 'background-color': '#ebdfc8', 'border-color': '#9b483d', 'border-width': 3, 'font-weight': 600 } },
  { selector: 'node[?anomaly]', style: { 'background-color': '#f4e1d7', 'border-color': '#a35244', 'border-style': 'dashed' } },
  { selector: 'edge', style: { width: 2, 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#6f7c63', 'line-color': '#6f7c63', label: 'data(label)', color: '#514d3f', 'font-size': 13, 'font-family': 'Microsoft YaHei', 'text-wrap': 'wrap', 'text-max-width': 264, 'text-background-color': '#f4ecdc', 'text-background-opacity': 1, 'text-background-padding': 5, 'text-rotation': 'autorotate', 'control-point-step-size': 60 } },
  { selector: 'edge[category="ownership"]', style: { 'line-style': 'dashed', 'line-color': '#9e8c6c', 'target-arrow-color': '#9e8c6c' } },
  { selector: 'edge[?anomaly]', style: { 'line-color': '#a35244', 'target-arrow-color': '#a35244', color: '#a35244', 'line-style': 'dashed' } },
  { selector: '.workbench-selected', style: { 'border-color': '#9b483d', 'border-width': 4, 'background-color': '#efe0c4' } },
  { selector: 'edge.workbench-selected, edge.workbench-direction', style: { width: 4, 'line-color': '#9b483d', 'target-arrow-color': '#9b483d' } },
  { selector: 'node.workbench-direction', style: { 'border-width': 4, 'border-color': '#9b483d' } },
  { selector: 'node.workbench-applied', style: { 'border-width': 4, 'border-color': '#567247' } }
];

function flowTargetElements(cy, target, document) {
  if (!target) return cy.collection();
  if (target.kind === 'behavior' || target.kind === 'relation') return cy.elements().filter(item => item.data('focusKind') === target.kind && item.data('focusRef') === target.ref);
  if (['data-link', 'data-source', 'form-link', 'field-source', 'lifecycle-route', 'lifecycle-event'].includes(target.kind)) {
    const references = globalThis.ElementReferences;
    const resolved = references?.lookup(references.buildCatalog(document), target);
    if (resolved?.status !== 'valid') return cy.collection();
    const node = resolved.node;
    const entity = node.path.split('/').slice(1).reduce((value, key) => value?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], document);
    if (target.kind === 'lifecycle-route') return cy.edges().filter(item => item.data('focusKind') === 'relation' && array(entity?.flow_relation_refs).includes(item.data('focusRef')));
    if (target.kind === 'field-source') {
      return entity?.source_type === 'external_system'
        ? flowTargetElements(cy, { kind: 'form-item', ref: node.parentRef, parentRef: node.scope.formRef }, document)
        : flowTargetElements(cy, { kind: 'data', ref: entity?.source_data_ref }, document);
    }
    const ref = target.kind === 'data-source' ? entity?.available_from_behavior_ref : target.kind === 'lifecycle-event' ? entity?.trigger?.behavior_ref : entity?.behavior_ref;
    return ref ? flowTargetElements(cy, { kind: 'behavior', ref }, document) : cy.collection();
  }
  const dataMatches = target.kind === 'data' || target.kind === 'data-field'
    ? array(document.data_objects).filter(item => item.data_ref === (target.kind === 'data' ? target.ref : target.parentRef)) : [];
  const formMatches = target.kind === 'form' || target.kind === 'form-area' || target.kind === 'form-item'
    ? array(document.forms).filter(item => item.form_ref === (target.kind === 'form' ? target.ref : target.parentRef)) : [];
  const data = dataMatches.length === 1 ? dataMatches[0] : null;
  const form = formMatches.length === 1 ? formMatches[0] : null;
  const refs = new Set(array(data?.behavior_links || form?.behavior_links).map(item => item.behavior_ref));
  return cy.nodes().filter(item => item.data('focusKind') === 'behavior' && refs.has(item.data('focusRef')));
}

function withLogicalTrunks(cy, elements) {
  const bundleIds = new Set(elements.filter(item => item.isEdge()).map(item => item.data('bundleId')).filter(Boolean));
  return elements.union(cy.edges('.relation-bundle-trunk').filter(item => bundleIds.has(item.data('bundleId'))));
}

export default function GraphWorkspace({ document, candidateKey = '', selection, onSelect, relationTarget = null, onReturn, onDrill, reducedMotion = false, onViewportChange, viewport, revision, onReadingChange, appliedTarget = null }) {
  const containerRef = useRef(null);
  const graphRef = useRef(null);
  const callbacks = useRef({});
  callbacks.current = { onSelect, onReturn, onDrill, onViewportChange, onReadingChange, reducedMotion, selection, document };
  const viewportRef = useRef(viewport);
  const candidateRef = useRef(candidateKey);
  const flowReturnViewport = useRef(null);
  const relationActive = useRef(false);
  const readingSession = useRef(null);
  const pendingReadingRestore = useRef(null);
  const [reading, setReading] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const [relationInfo, setRelationInfo] = useState(null);
  const [direction, setDirection] = useState(false);
  const [reducedPreference, setReducedPreference] = useState(false);
  const [zoomPercent, setZoomPercent] = useState(100);
  const reduce = reducedMotion || reducedPreference;
  const reducedRef = useRef(reduce);
  reducedRef.current = reduce;
  const relationKey = targetKey(relationTarget);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedPreference(preference.matches);
    update(); preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  function stopReading({ restore = true } = {}) {
    const saved = readingSession.current?.snapshot().saved;
    readingSession.current = null;
    setReading(null);
    setPlaying(false);
    callbacks.current.onReadingChange?.(false);
    pendingReadingRestore.current = restore ? saved : null;
  }

  useLayoutEffect(() => {
    if (reading || !pendingReadingRestore.current || !graphRef.current) return;
    const saved = pendingReadingRestore.current;
    pendingReadingRestore.current = null;
    // Restore after the reading toolbar has left the DOM, using the original canvas size.
    graphRef.current.cy.resize();
    graphRef.current.motion.move(saved.viewport, 0);
    graphRef.current.highlight(saved.selection, false);
  }, [reading]);

  // Document identity changes only after a controller commit. Typing never rebuilds the graph.
  useEffect(() => {
    if (!containerRef.current || !document) return;
    stopReading({ restore: false });
    setError('');
    setDirection(false);
    let diagram;
    let cy;
    let motion;
    let resizeObserver;
    let nativeGesture = false;
    let gestureMoved = false;
    let gestureTimer;
    let relationModel = null;
    try {
      if (candidateRef.current !== candidateKey) {
        candidateRef.current = candidateKey;
        viewportRef.current = viewport || null;
        flowReturnViewport.current = null;
        relationActive.current = false;
      }
      const ProcessDiagram = globalThis.ProcessDiagram;
      const references = globalThis.ElementReferences;
      if (!ProcessDiagram || !references) throw new Error('图形领域模块尚未加载，请重新打开工作台。');
      if (relationTarget) {
        if (!relationActive.current) flowReturnViewport.current = graphRef.current?.motion.snapshot('located') || viewportRef.current || viewport;
        relationActive.current = true;
        const catalog = references.buildCatalog(document);
        relationModel = buildDirectRelationGraph(document, catalog, references, relationTarget);
        setRelationInfo(relationModel);
        cy = cytoscape({ container: containerRef.current, elements: relationModel.elements, style: relationStyles, layout: { name: 'preset', fit: true, padding: 48 }, minZoom: 0.15, maxZoom: 1.6, autoungrabify: true, autounselectify: true, boxSelectionEnabled: false });
      } else {
        const restore = relationActive.current ? flowReturnViewport.current : viewportRef.current || viewport;
        relationActive.current = false;
        setRelationInfo(null);
        diagram = ProcessDiagram.mount({ container: containerRef.current, cytoscape, documentData: document, selectedFocus: selection, viewport: restore, showAggregateBadges: true, editable: false });
        cy = diagram.cy;
        // The mount's layout and shared trunks are retained. Viewport ownership moves to the coordinator.
        cy.off('pan zoom');
        cy.off('tap');
        cy.style().selector('.lane-body-node').style({ 'background-color': '#f8f1e2' })
          .selector('edge').style({ 'text-background-color': '#f4ecdc' })
          .selector('.flow-edge').style({ 'line-color': '#6f7c63', 'target-arrow-color': '#6f7c63', color: '#514d3f' })
          .selector('.relation-loop, .internal-return-edge, .relation-bundle-trunk.bundle-loop').style({ 'line-color': '#8c3f33', 'target-arrow-color': '#8c3f33', color: '#7b2f27' })
          .selector('.aggregate-badge, .form-aggregate-badge').style({ 'background-color': '#edf0e1', 'border-color': '#92977d', color: '#443d32' })
          .selector('.behavior-node, .internal-call-node, .external-node').style({ 'background-color': '#f8efdc', 'transition-property': 'background-color, border-color', 'transition-duration': reduce ? 0 : MOTION_MS.select })
          .selector('.workbench-selected').style({ 'border-color': '#9b483d', 'border-width': 9, 'background-color': '#ead9b8' })
          .selector('edge.workbench-selected, edge.workbench-direction').style({ 'line-color': '#9b483d', 'target-arrow-color': '#9b483d', width: 12 })
          .selector('.workbench-neighbour').style({ 'border-color': '#6e8061' })
          .selector('.workbench-applied').style({ 'border-color': '#567247', 'border-width': 12 })
          .selector('.workbench-reading').style({ 'border-color': '#9b483d', 'border-width': 12, 'background-color': '#ead9b8' }).update();
      }
      motion = createMotionCoordinator({ cy, reduced: () => reducedRef.current, report: value => {
        // restore updates the legacy resize mode, never the business JSON or undo history.
        diagram?.restore(value);
        setZoomPercent(Math.round(value.zoom * 100));
        if (!relationTarget && !readingSession.current) {
          viewportRef.current = value;
          callbacks.current.onViewportChange?.(value);
        }
      } });
      const clearTransient = () => { cy.elements().removeClass('workbench-direction workbench-applied'); if (graphRef.current?.cy === cy) graphRef.current.appliedUntil = 0; setDirection(false); };
      const highlight = (target, locate = true, duration = MOTION_MS.select) => {
        motion.cancel();
        clearTransient();
        cy.elements().removeClass('workbench-selected workbench-neighbour workbench-reading');
        let elements = relationTarget ? cy.nodes().filter(item => targetKey(item.data('target')) === targetKey(target)) : flowTargetElements(cy, target, document);
        elements = withLogicalTrunks(cy, elements);
        elements.addClass('workbench-selected');
        // At most the immediate recorded neighbours receive secondary emphasis.
        if (elements.nodes().length === 1) elements.nodes().connectedEdges().connectedNodes().difference(elements).slice(0, 6).addClass('workbench-neighbour');
        if (locate) {
          const located = locationViewport(cy, elements, { maxZoom: relationTarget ? 1 : 0.65, readableZoom: relationTarget ? 0.9 : 0.4 });
          if (located) motion.move(located, duration);
        }
      };
      graphRef.current = { cy, diagram, motion, highlight, clearTransient, relationModel, appliedUntil: 0 };
      cy.on('tap', 'node, edge', event => {
        if (readingSession.current) return;
        const element = event.target;
        if (relationTarget) {
          const target = element.isNode() ? element.data('target') : element.data('detailTarget');
          if (target) callbacks.current.onSelect?.(target);
        } else {
          const kind = element.data('focusKind');
          const ref = element.data('focusRef');
          if (['behavior', 'relation'].includes(kind) && ref) callbacks.current.onSelect?.({ kind, ref, parentRef: '' });
          else if (['data-badge', 'form-badge'].includes(kind) && ref) callbacks.current.onSelect?.({ kind: 'behavior', ref, parentRef: '', relatedKind: kind === 'data-badge' ? 'data' : 'form' });
        }
      });
      cy.on('pan zoom', () => { if (nativeGesture && !motion.isProgrammatic()) { gestureMoved = true; motion.reportManual(); } });
      cy.on('dragpan', () => { motion.cancel({ user: true }); clearTransient(); });
      const gestureStart = event => {
        nativeGesture = true;
        gestureMoved = event.type === 'wheel';
        motion.cancel({ user: event.type === 'wheel' });
        clearTransient();
        if (event.type === 'wheel') {
          clearTimeout(gestureTimer);
          gestureTimer = setTimeout(() => { nativeGesture = false; motion.reportManual(); }, 160);
        }
      };
      const gestureEnd = () => { if (nativeGesture && gestureMoved) motion.reportManual(); nativeGesture = false; gestureMoved = false; };
      containerRef.current.addEventListener('pointerdown', gestureStart, true);
      containerRef.current.addEventListener('wheel', gestureStart, { capture: true, passive: true });
      window.addEventListener('pointerup', gestureEnd);
      window.addEventListener('pointercancel', gestureEnd);
      const container = containerRef.current;
      if (typeof ResizeObserver === 'function') {
        let dimensions = { width: container.clientWidth, height: container.clientHeight };
        resizeObserver = new ResizeObserver(() => {
          if (graphRef.current?.cy !== cy || cy.destroyed()) return;
          const next = { width: container.clientWidth, height: container.clientHeight };
          if (next.width === dimensions.width && next.height === dimensions.height) return;
          dimensions = next;
          const applied = cy.elements('.workbench-applied');
          const appliedUntil = graphRef.current?.cy === cy ? graphRef.current.appliedUntil : 0;
          // The flow mount centres its preserved viewport before this observer reports it.
          if (diagram) { motion.cancel(); cy.resize(); motion.move(motion.snapshot('located'), 0); }
          else motion.preserveResize();
          if (!readingSession.current) highlight(callbacks.current.selection, true);
          // Closing the validation strip resizes the canvas after a commit. Preserve only
          // the remainder of that commit's cue, without restarting its 600ms lifetime.
          if (applied.length && appliedUntil > Date.now()) {
            applied.addClass('workbench-applied');
            if (graphRef.current?.cy === cy) graphRef.current.appliedUntil = appliedUntil;
            if (Number.isFinite(appliedUntil)) motion.later(() => applied.removeClass('workbench-applied'), appliedUntil - Date.now());
          }
        });
        resizeObserver.observe(container);
      }
      highlight(relationTarget || selection, false);
      setZoomPercent(Math.round(cy.zoom() * 100));
      if (!relationTarget) { viewportRef.current = motion.snapshot('located'); callbacks.current.onViewportChange?.(viewportRef.current); }
      return () => {
        clearTimeout(gestureTimer);
        resizeObserver?.disconnect();
        container.removeEventListener('pointerdown', gestureStart, true);
        container.removeEventListener('wheel', gestureStart, true);
        window.removeEventListener('pointerup', gestureEnd);
        window.removeEventListener('pointercancel', gestureEnd);
        if (!relationTarget && !readingSession.current) viewportRef.current = motion.snapshot('located');
        motion.destroy();
        if (diagram) diagram.destroy(); else cy.destroy();
        if (graphRef.current?.cy === cy) graphRef.current = null;
      };
    } catch (failure) {
      motion?.destroy();
      if (diagram) diagram.destroy(); else cy?.destroy();
      setError(failure.message);
    }
    // Selection, editing and preference changes have their own effects and do not rerun layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, candidateKey, relationKey]);

  useEffect(() => {
    if (readingSession.current) return;
    graphRef.current?.highlight(selection, true, selection?.locateReason === 'issue' ? MOTION_MS.locate : MOTION_MS.select);
  }, [targetKey(selection), selection?.locateReason, selection?.locateSequence]);

  useEffect(() => {
    graphRef.current?.cy.style().selector('.behavior-node, .internal-call-node, .external-node').style({ 'transition-duration': reduce ? 0 : MOTION_MS.select }).update();
    if (!reduce) return;
    setPlaying(false);
    const graph = graphRef.current;
    if (graph) { graph.motion.cancel(); graph.clearTransient(); }
  }, [reduce]);

  useEffect(() => {
    if (!appliedTarget || !graphRef.current || readingSession.current) return;
    const graph = graphRef.current;
    const elements = relationTarget
      ? graph.cy.nodes().filter(item => targetKey(item.data('target')) === targetKey(appliedTarget))
      : flowTargetElements(graph.cy, appliedTarget, document);
    graph.motion.cancel(); graph.clearTransient();
    graph.appliedUntil = reduce ? Infinity : Date.now() + MOTION_MS.applied;
    elements.addClass('workbench-applied');
    if (!reduce) graph.motion.later(() => elements.removeClass('workbench-applied'), MOTION_MS.applied);
  }, [targetKey(appliedTarget), revision]);

  function updateReading(next) {
    setReading(next);
    const graph = graphRef.current;
    if (!graph) return;
    graph.motion.cancel(); graph.clearTransient();
    graph.cy.elements().removeClass('workbench-selected workbench-neighbour workbench-reading');
    const elements = graph.cy.nodes('.behavior-node').filter(item => next.refs.includes(item.data('focusRef')));
    elements.addClass('workbench-reading');
    withLogicalTrunks(graph.cy, graph.cy.edges().filter(item => next.routeRefs.includes(item.data('focusRef')))).addClass('workbench-direction');
    const location = locationViewport(graph.cy, elements, { keepVisible: false, maxZoom: 0.65 });
    if (location) graph.motion.move(location, MOTION_MS.locate);
    if (next.stopped) setPlaying(false);
  }
  function startReading() {
    try {
      const graph = graphRef.current;
      if (!graph || selection?.kind !== 'behavior') return;
      readingSession.current = createReadingSession(document, selection.ref, { selection, viewport: graph.motion.snapshot('located') });
      callbacks.current.onReadingChange?.(true);
      updateReading(readingSession.current.snapshot());
    } catch (failure) { setError(failure.message); }
  }
  useEffect(() => {
    if (!playing || reduce || !readingSession.current) return;
    const session = readingSession.current;
    const timer = setTimeout(() => {
      if (!reducedRef.current && readingSession.current === session) updateReading(session.step());
    }, MOTION_MS.reading);
    return () => clearTimeout(timer);
  }, [playing, reading, reduce]);
  useEffect(() => () => { readingSession.current = null; callbacks.current.onReadingChange?.(false); }, []);

  function showDirection() {
    const graph = graphRef.current;
    if (!graph) return;
    graph.motion.cancel(); graph.clearTransient();
    const elements = relationTarget ? graph.cy.edges() : withLogicalTrunks(graph.cy, flowTargetElements(graph.cy, selection, document).connectedEdges().union(flowTargetElements(graph.cy, selection, document).edges()));
    elements.addClass('workbench-direction');
    setDirection(true);
    if (!reduce) graph.motion.later(() => { elements.removeClass('workbench-direction'); setDirection(false); }, MOTION_MS.direction);
  }
  function fitGraph() {
    const graph = graphRef.current;
    if (!graph) return;
    graph.motion.cancel(); graph.clearTransient();
    const bounds = graph.cy.elements().boundingBox({ includeLabels: true });
    const zoom = Math.max(graph.cy.minZoom(), Math.min(graph.cy.maxZoom(), (graph.cy.width() - 64) / Math.max(1, bounds.w), (graph.cy.height() - 64) / Math.max(1, bounds.h)));
    graph.motion.move({ zoom, pan: { x: graph.cy.width() / 2 - (bounds.x1 + bounds.x2) / 2 * zoom, y: graph.cy.height() / 2 - (bounds.y1 + bounds.y2) / 2 * zoom } }, MOTION_MS.locate);
  }

  const empty = !relationTarget && !array(document?.behaviors).length;
  const selectedRelationshipObject = relationTarget && selection && targetKey(selection) !== relationKey;
  return <section className="workbench-graph" aria-label={relationTarget ? '对象直接关系图' : '流程图工作台'} style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, background: '#f4ecdc' }}>
    <div className="graph-toolbar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '8px 16px', minHeight: 48, borderBottom: '1px solid #dfd1b9', background: '#f1e7d4' }}>
      <Space size={8}>
        {relationTarget ? <><Button onClick={() => callbacks.current.onReturn?.()}>← 返回流程图</Button><strong>{relationInfo?.title || '当前对象'}的一层直接关系</strong><Tag>{relationInfo?.relationshipCount || 0}条关系</Tag>{relationInfo?.anomalyCount > 0 && <Tag color="error">异常 {relationInfo.anomalyCount}</Tag>}</> : <strong>流程图</strong>}
        {reading && <Tag color="volcano">阅读演示</Tag>}
      </Space>
      <Space size={8}>
        {!reading && !relationTarget && <Tooltip title={selection?.kind === 'behavior' ? '以当前选中环节作为阅读起点' : '先选择一个起点环节'}><Button onClick={startReading} disabled={selection?.kind !== 'behavior' || empty}>从当前环节阅读</Button></Tooltip>}
        {!reading && <Button onClick={showDirection} disabled={!relationTarget && !selection}>查看关系方向</Button>}
        {selectedRelationshipObject && <Button onClick={() => callbacks.current.onDrill?.(selection)}>查看此对象的直接关系</Button>}
        <Button onClick={fitGraph} disabled={empty}>全图</Button>
      </Space>
    </div>
    {error && <Alert type="error" showIcon title={error} closable onClose={() => setError('')} />}
    {relationInfo?.noTermUsage && <Alert type="info" showIcon title="术语已有定义和标识，当前文件没有结构化的术语使用关系。" />}
    {reading && <div className="graph-reading-controls" style={{ padding: '8px 16px', background: '#efe3cc', borderBottom: '1px solid #dfd1b9' }}>
      <Space size={8} wrap>
        <Button disabled={!reading.canPrevious} onClick={() => { setPlaying(false); updateReading(readingSession.current.previous()); }}>上一步</Button>
        <Button disabled={!reading.canNext} onClick={() => { setPlaying(false); updateReading(readingSession.current.step()); }}>下一步</Button>
        <Button disabled={reduce || !!reading.stopped} onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</Button>
        <Button onClick={() => stopReading()}>退出阅读</Button>
        <span>位置 {reading.position + 1}{reading.refs.length > 1 ? ` · 并行阅读组（${reading.refs.length}个环节）` : ''}</span>
        <span style={{ fontSize: 13, color: '#6c6455' }}>仅阅读已记录路线，不代表执行或审核状态</span>
        {reduce && <Tag>减少动态效果 · 手动阅读</Tag>}
      </Space>
      {reading.stopped && <div role="status" style={{ marginTop: 8, color: '#8f4337' }}>{READING_MESSAGES[reading.stopped]}</div>}
      {reading.choices.length > 0 && <Select aria-label="选择已记录路线" placeholder="选择已记录路线" style={{ width: 520, marginTop: 8 }} value={null} options={reading.choices.map(item => ({ value: item.ref, label: `${item.label} → ${array(document.behaviors).find(behavior => behavior.behavior_ref === item.toRef)?.behavior_name || item.toRef || '终点未填写'}` }))} onChange={ref => updateReading(readingSession.current.step(ref))} />}
    </div>}
    <div ref={containerRef} className="graph-canvas" role="img" aria-label={relationTarget ? `${kindLabel(relationTarget.kind)}直接关系画布` : '流程图画布，可拖动和缩放'} style={{ flex: 1, minHeight: 0, position: 'relative', background: '#f4ecdc' }} />
    {empty && <div style={{ position: 'absolute', inset: '100px 24px 24px', display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><Empty description="尚未编制环节。使用“新增环节”开始。" /></div>}
    <div role="status" className="graph-status" style={{ minHeight: 32, padding: '8px 16px', display: 'flex', justifyContent: 'space-between', gap: 16, background: '#f1e7d4', color: '#6c6455', fontSize: 13 }}>
      <span>{relationTarget ? '实线为引用或流转，虚线为父子归属；异常原值保留。选择关联对象后可逐层查看。' : '拖动移动画布，滚轮缩放；选择环节或路线查看详情。'}{direction ? ' 方向提示已显示，箭头与关系文字持续保留。' : ''}</span>
      <span className="graph-zoom" aria-label="画布缩放">{zoomPercent}%{reduce ? ' · 减少动态效果已开启' : ''}</span>
    </div>
  </section>;
}
