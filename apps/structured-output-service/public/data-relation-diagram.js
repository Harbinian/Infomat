(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.DataRelationDiagram = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createDataRelationDiagramApi() {
  'use strict';

  const OPERATION_ORDER = ['create', 'update', 'use', 'pending_confirmation'];
  const OPERATION_LABEL = {
    create: '创建',
    update: '更新',
    use: '使用',
    pending_confirmation: '待确认'
  };

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function wrap(value, perLine = 10) {
    const raw = text(value).trim() || '未命名';
    const sharedMeasure = typeof globalThis !== 'undefined' ? globalThis.ProcessDiagram?.wrapDisplayText : null;
    if (typeof sharedMeasure === 'function') return sharedMeasure(raw, perLine).label;
    const lines = [];
    for (let index = 0; index < raw.length; index += perLine) lines.push(raw.slice(index, index + perLine));
    return lines.join('\n');
  }

  function buildModel(documentValue, selectedDataRef) {
    const dataObjects = array(documentValue?.data_objects);
    const selected = dataObjects.find(item => item.data_ref === selectedDataRef) || dataObjects[0] || null;
    if (!selected) return { dataRef: '', nodes: [], edges: [], relatedBehaviorRefs: [], operationCounts: {} };
    const behaviorIndex = new Map(array(documentValue?.behaviors).map((item, index) => [item.behavior_ref, { item, index }]));
    const operationsByBehavior = new Map();
    array(selected.behavior_links).forEach(link => {
      if (!behaviorIndex.has(link.behavior_ref)) return;
      if (!operationsByBehavior.has(link.behavior_ref)) operationsByBehavior.set(link.behavior_ref, []);
      const operations = operationsByBehavior.get(link.behavior_ref);
      if (!operations.includes(link.operation)) operations.push(link.operation);
    });
    const related = [...operationsByBehavior.entries()].sort((left, right) => {
      const leftOperation = Math.min(...left[1].map(operation => OPERATION_ORDER.indexOf(operation)).filter(index => index >= 0));
      const rightOperation = Math.min(...right[1].map(operation => OPERATION_ORDER.indexOf(operation)).filter(index => index >= 0));
      if (leftOperation !== rightOperation) return leftOperation - rightOperation;
      return behaviorIndex.get(left[0]).index - behaviorIndex.get(right[0]).index;
    });
    const relatedBySide = { left: [], right: [] };
    related.forEach(entry => {
      const side = entry[1].includes('use') ? 'right' : 'left';
      relatedBySide[side].push(entry);
    });
    const rowSpacing = 108;
    const maxSideRows = Math.max(relatedBySide.left.length, relatedBySide.right.length, 1);
    const totalHeight = Math.max(0, (maxSideRows - 1) * rowSpacing);
    const sideStartY = {
      left: 140 + (maxSideRows - relatedBySide.left.length) * rowSpacing / 2,
      right: 140 + (maxSideRows - relatedBySide.right.length) * rowSpacing / 2
    };
    const nodes = [{
      data: {
        id: `data:${selected.data_ref}`,
        ref: selected.data_ref,
        kind: 'data',
        label: wrap(selected.data_name, 11),
        subtitle: '当前数据对象'
      },
      position: { x: 420, y: 140 + totalHeight / 2 }
    }];
    const edges = [];
    const operationCounts = {};
    const sideIndexes = { left: 0, right: 0 };
    related.forEach(([behaviorRef, operations]) => {
      const side = operations.includes('use') ? 'right' : 'left';
      const sideIndex = sideIndexes[side];
      sideIndexes[side] += 1;
      const behavior = behaviorIndex.get(behaviorRef).item;
      const y = sideStartY[side] + sideIndex * rowSpacing;
      nodes.push({
        data: {
          id: `behavior:${behaviorRef}`,
          ref: behaviorRef,
          kind: 'behavior',
          label: wrap(behavior.behavior_name, 11),
          subtitle: behavior.node_type === 'action' ? '业务行为（只读端点）' : '流程节点（只读端点）'
        },
        position: { x: side === 'right' ? 720 : 120, y }
      });
      const ordered = OPERATION_ORDER.filter(operation => operations.includes(operation));
      ordered.forEach(operation => { operationCounts[operation] = (operationCounts[operation] || 0) + 1; });
      const onlyCreate = ordered.length === 1 && ordered[0] === 'create';
      const onlyUse = ordered.length === 1 && ordered[0] === 'use';
      edges.push({
        data: {
          id: `data-edge:${selected.data_ref}:${behaviorRef}`,
          dataRef: selected.data_ref,
          behaviorRef,
          kind: 'data-relation',
          label: ordered.map(operation => OPERATION_LABEL[operation] || operation).join(' / '),
          operations: ordered.join(','),
          curveStyle: 'straight',
          arrowMode: ordered.includes('pending_confirmation') ? 'pending'
            : ordered.includes('update') || (ordered.includes('create') && ordered.includes('use')) ? 'both'
              : onlyCreate ? 'forward'
                : onlyUse ? 'reverse'
                  : 'both',
          source: onlyUse ? `data:${selected.data_ref}` : `behavior:${behaviorRef}`,
          target: onlyUse ? `behavior:${behaviorRef}` : `data:${selected.data_ref}`
        }
      });
    });
    return {
      dataRef: selected.data_ref,
      dataName: selected.data_name,
      nodes,
      edges,
      relatedBehaviorRefs: related.map(([ref]) => ref),
      operationCounts
    };
  }

  function styles() {
    return [
      {
        selector: 'node',
        style: {
          width: 210,
          height: 72,
          shape: 'round-rectangle',
          'background-color': '#fffdf7',
          'border-color': '#8e9f86',
          'border-width': 2,
          label: 'data(label)',
          color: '#30352f',
          'font-family': 'SimSun, serif',
          'font-size': 15,
          'text-wrap': 'wrap',
          'text-max-width': 180,
          'text-valign': 'center',
          'text-halign': 'center'
        }
      },
      {
        selector: 'node[kind="data"]',
        style: {
          width: 230,
          height: 92,
          'background-color': '#f4ead1',
          'border-color': '#a27732',
          'border-width': 3
        }
      },
      {
        selector: 'node:selected',
        style: { 'overlay-opacity': 0, 'border-color': '#8f2f26', 'border-width': 4 }
      },
      {
        selector: 'edge',
        style: {
          width: 2.5,
          'line-color': '#657866',
          'curve-style': 'data(curveStyle)',
          'target-arrow-shape': 'triangle',
          'target-arrow-color': '#657866',
          'source-arrow-shape': 'none',
          label: 'data(label)',
          color: '#4e524c',
          'font-size': 13,
          'font-family': 'SimSun, serif',
          'text-background-color': '#fffdf7',
          'text-background-opacity': 1,
          'text-background-padding': 4,
          'text-margin-y': -9
        }
      },
      { selector: 'edge[arrowMode="both"]', style: { 'source-arrow-shape': 'triangle', 'source-arrow-color': '#657866' } },
      { selector: 'edge[arrowMode="pending"]', style: { 'source-arrow-shape': 'none', 'target-arrow-shape': 'none', 'line-style': 'dashed' } },
      { selector: 'edge:selected', style: { 'line-color': '#8f2f26', 'target-arrow-color': '#8f2f26', 'source-arrow-color': '#8f2f26', width: 4 } }
    ];
  }

  function mount(options) {
    const cytoscape = options?.cytoscape || globalThis.cytoscape;
    if (typeof cytoscape !== 'function') throw new Error('图形组件未加载');
    if (!options?.container) throw new Error('缺少数据关系图容器');
    const model = buildModel(options.documentData, options.selectedDataRef);
    const cy = cytoscape({
      container: options.container,
      elements: [...model.nodes, ...model.edges],
      layout: { name: 'preset', fit: false },
      style: styles(),
      minZoom: 0.25,
      maxZoom: 2.2,
      wheelSensitivity: 0.18,
      autoungrabify: true,
      autounselectify: false,
      boxSelectionEnabled: false
    });
    cy.on('tap', 'node, edge', event => {
      const data = event.target.data();
      if (typeof options.onFocus === 'function') options.onFocus(data);
    });
    function fit() {
      if (!model.nodes.length) return;
      cy.fit(cy.elements(), 48);
      if (cy.zoom() > 1.1) cy.zoom({ level: 1.1, renderedPosition: { x: options.container.clientWidth / 2, y: options.container.clientHeight / 2 } });
    }
    function reset() {
      fit();
    }
    function viewport() {
      return { zoom: cy.zoom(), pan: cy.pan() };
    }
    function restore(view) {
      if (!view || !Number.isFinite(view.zoom) || !view.pan) return fit();
      cy.zoom(view.zoom);
      cy.pan(view.pan);
    }
    cy.ready(() => options.viewport ? restore(options.viewport) : fit());
    return { cy, model, fit, reset, viewport, restore, destroy: () => cy.destroy() };
  }

  return { OPERATION_ORDER: [...OPERATION_ORDER], OPERATION_LABEL: { ...OPERATION_LABEL }, buildModel, mount };
}));
