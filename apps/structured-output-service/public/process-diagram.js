(function initializeProcessDiagram(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProcessDiagram = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProcessDiagramApi() {
  const RELATION_TYPES = new Set(['sequence', 'condition', 'loop', 'parallel']);

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function items(value) {
    return Array.isArray(value) ? value : [];
  }

  function relationLabel(relation) {
    const condition = text(relation.condition);
    if (relation.relation_type === 'condition') return `判断：${condition || '条件待填写'}`;
    if (relation.relation_type === 'loop') return `回路：${condition || '退出条件待填写'}`;
    if (relation.relation_type === 'parallel') {
      return relation.join_mode === 'all' ? '并行：全部分支完成后汇合' : '并行关系';
    }
    return '顺序';
  }

  function handoffLabel(handoff) {
    return [
      '跨部门承接',
      `承接部门：${text(handoff.target_department) || '待明确'}`,
      `目标流程：${text(handoff.target_process_name) || '待明确'}`,
      `目标行为：${text(handoff.target_behavior_name) || '待明确'}`,
      `承接事项：${text(handoff.requested_matter) || '待明确'}`
    ].join('\n');
  }

  function internalCallLabel(call) {
    return [
      '内部流程调用',
      `目标流程：${text(call.target_process_name) || '待明确'}`
    ].join('\n');
  }

  function buildGraphModel(documentData) {
    const data = documentData && typeof documentData === 'object' ? documentData : {};
    const nodes = [];
    const edges = [];
    const unresolvedItems = [];
    const behaviorNodeByRef = new Map();
    let namedBehaviorCount = 0;
    let localEdgeCount = 0;

    items(data.behaviors).forEach((behavior, index) => {
      const behaviorRef = text(behavior.behavior_ref);
      const graphId = `behavior:${index}:${behaviorRef || 'missing-ref'}`;
      if (behaviorRef && !behaviorNodeByRef.has(behaviorRef)) behaviorNodeByRef.set(behaviorRef, graphId);
      if (text(behavior.behavior_name)) namedBehaviorCount += 1;
      const nodeType = text(behavior.node_type);
      const classType = ['action', 'decision', 'parallel_split', 'parallel_join'].includes(nodeType)
        ? nodeType.replace(/_/g, '-')
        : 'pending';
      const behaviorName = text(behavior.behavior_name) || '业务行为名称待填写';
      nodes.push({
        group: 'nodes',
        classes: `behavior-node node-${classType}`,
        data: {
          id: graphId,
          label: nodeType ? behaviorName : `${behaviorName}\n节点类型待判断`,
          detail: nodeType || '节点类型待判断',
          focusKind: 'behavior',
          focusRef: behaviorRef
        }
      });
    });

    items(data.flow_relations).forEach((relation, index) => {
      const relationRef = text(relation.relation_ref);
      const fromRef = text(relation.from_behavior_ref);
      const toRef = text(relation.to_behavior_ref);
      const missing = [];
      if (!RELATION_TYPES.has(relation.relation_type)) missing.push('关系类型');
      if (!fromRef) missing.push('起点');
      else if (!behaviorNodeByRef.has(fromRef)) missing.push('有效起点');
      if (!toRef) missing.push('终点');
      else if (!behaviorNodeByRef.has(toRef)) missing.push('有效终点');
      if (missing.length) {
        unresolvedItems.push({
          focusKind: 'relation',
          focusRef: relationRef,
          message: `流程关系${index + 1}未显示：请补齐${missing.join('、')}。`
        });
        return;
      }
      localEdgeCount += 1;
      edges.push({
        group: 'edges',
        classes: `flow-edge relation-${relation.relation_type}`,
        data: {
          id: `relation:${index}:${relationRef || 'missing-ref'}`,
          source: behaviorNodeByRef.get(fromRef),
          target: behaviorNodeByRef.get(toRef),
          label: relationLabel(relation),
          focusKind: 'relation',
          focusRef: relationRef
        }
      });
    });

    items(data.cross_department_handoffs).forEach((handoff, index) => {
      const handoffRef = text(handoff.handoff_ref);
      const sendRef = text(handoff.send_behavior_ref);
      const sendNode = behaviorNodeByRef.get(sendRef);
      if (!sendNode) {
        unresolvedItems.push({
          focusKind: 'handoff',
          focusRef: handoffRef,
          message: `跨部门承接${index + 1}未显示：请指定有效的发送行为。`
        });
        return;
      }
      const externalNodeId = `handoff:${index}:${handoffRef || 'missing-ref'}`;
      nodes.push({
        group: 'nodes',
        classes: 'external-node handoff-node',
        data: {
          id: externalNodeId,
          label: handoffLabel(handoff),
          detail: '流程边界外',
          focusKind: 'handoff',
          focusRef: handoffRef
        }
      });
      edges.push({
        group: 'edges',
        classes: 'external-edge handoff-edge',
        data: {
          id: `handoff-out:${index}:${handoffRef || 'missing-ref'}`,
          source: sendNode,
          target: externalNodeId,
          label: '跨部门承接',
          focusKind: 'handoff',
          focusRef: handoffRef
        }
      });
      const returnRef = text(handoff.return_behavior_ref);
      if (returnRef && !behaviorNodeByRef.has(returnRef)) {
        unresolvedItems.push({
          focusKind: 'handoff',
          focusRef: handoffRef,
          message: `跨部门承接${index + 1}的返回箭头未显示：恢复位置没有对应当前流程中的业务行为。`
        });
      } else if (returnRef) {
        edges.push({
          group: 'edges',
          classes: 'external-edge return-edge',
          data: {
            id: `handoff-return:${index}:${handoffRef || 'missing-ref'}`,
            source: externalNodeId,
            target: behaviorNodeByRef.get(returnRef),
            label: '承接完成后返回',
            focusKind: 'handoff',
            focusRef: handoffRef
          }
        });
      }
    });

    items(data.internal_process_calls).forEach((call, index) => {
      const callRef = text(call.call_ref);
      const callerRef = text(call.caller_behavior_ref);
      const callerNode = behaviorNodeByRef.get(callerRef);
      if (!callerNode) {
        unresolvedItems.push({
          focusKind: 'call',
          focusRef: callRef,
          message: `内部流程调用${index + 1}未显示：请指定有效的调用行为。`
        });
        return;
      }
      const externalNodeId = `call:${index}:${callRef || 'missing-ref'}`;
      nodes.push({
        group: 'nodes',
        classes: 'external-node internal-call-node',
        data: {
          id: externalNodeId,
          label: internalCallLabel(call),
          detail: '当前流程之外',
          focusKind: 'call',
          focusRef: callRef
        }
      });
      edges.push({
        group: 'edges',
        classes: 'external-edge internal-call-edge',
        data: {
          id: `call-out:${index}:${callRef || 'missing-ref'}`,
          source: callerNode,
          target: externalNodeId,
          label: '内部流程调用',
          focusKind: 'call',
          focusRef: callRef
        }
      });
      const returnRef = text(call.return_behavior_ref);
      if (returnRef && !behaviorNodeByRef.has(returnRef)) {
        unresolvedItems.push({
          focusKind: 'call',
          focusRef: callRef,
          message: `内部流程调用${index + 1}的返回箭头未显示：返回位置没有对应当前流程中的业务行为。`
        });
      } else if (returnRef) {
        edges.push({
          group: 'edges',
          classes: 'external-edge return-edge',
          data: {
            id: `call-return:${index}:${callRef || 'missing-ref'}`,
            source: externalNodeId,
            target: behaviorNodeByRef.get(returnRef),
            label: '调用完成后返回',
            focusKind: 'call',
            focusRef: callRef
          }
        });
      }
    });

    return {
      nodes,
      edges,
      elements: [...nodes, ...edges],
      namedBehaviorCount,
      localEdgeCount,
      unresolvedItems,
      unresolvedCount: unresolvedItems.length
    };
  }

  function normalizeLayerPositions(nodes) {
    const ordered = nodes.toArray().sort((left, right) => left.position('x') - right.position('x'));
    const levels = [];
    ordered.forEach(node => {
      const x = node.position('x');
      const current = levels[levels.length - 1];
      if (!current || Math.abs(current.x - x) > 2) levels.push({ x, nodes: [node] });
      else current.nodes.push(node);
    });
    levels.forEach((level, levelIndex) => {
      level.nodes.sort((left, right) => left.position('y') - right.position('y'));
      level.nodes.forEach((node, nodeIndex) => {
        node.position({
          x: levelIndex * 250,
          y: (nodeIndex - (level.nodes.length - 1) / 2) * 190
        });
      });
    });
  }

  function runLayout(cy, model) {
    if (!model.edges.length) {
      cy.layout({
        name: 'grid',
        avoidOverlap: true,
        condense: false,
        nodeDimensionsIncludeLabels: true,
        padding: 36,
        fit: false
      }).run();
      return;
    }
    const layoutNeutralEdges = cy.edges().filter(edge =>
      edge.hasClass('relation-loop') || edge.hasClass('return-edge')
    );
    const removedEdges = cy.remove(layoutNeutralEdges);
    try {
      if (!cy.edges().length) {
        cy.layout({
          name: 'grid',
          avoidOverlap: true,
          condense: false,
          nodeDimensionsIncludeLabels: true,
          padding: 36,
          fit: false
        }).run();
        return;
      }
      cy.layout({
        name: 'breadthfirst',
        directed: true,
        direction: 'rightward',
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        spacingFactor: 1.1,
        padding: 42,
        animate: false,
        fit: false
      }).run();
      normalizeLayerPositions(cy.nodes());
    } finally {
      removedEdges.restore();
    }
  }

  function graphStyles() {
    return [
      {
        selector: 'node',
        style: {
          width: 168,
          height: 72,
          shape: 'round-rectangle',
          'background-color': '#fffaf0',
          'border-color': '#8c3f33',
          'border-width': 2,
          color: '#2f302b',
          label: 'data(label)',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 12,
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-max-width': 145,
          'text-valign': 'center',
          'text-halign': 'center',
          'overlay-opacity': 0
        }
      },
      {
        selector: '.node-decision',
        style: {
          width: 126,
          height: 106,
          shape: 'diamond',
          'background-color': '#f5e5df',
          'text-max-width': 84
        }
      },
      {
        selector: '.node-parallel-split',
        style: {
          width: 132,
          height: 92,
          shape: 'hexagon',
          'background-color': '#f3e7ca',
          'border-color': '#9b783d',
          'text-max-width': 96
        }
      },
      {
        selector: '.node-parallel-join',
        style: {
          width: 132,
          height: 92,
          shape: 'hexagon',
          'background-color': '#e5eadf',
          'border-color': '#66745f',
          'text-max-width': 96
        }
      },
      {
        selector: '.node-pending',
        style: {
          'border-style': 'dashed',
          'border-color': '#8a8171',
          'background-color': '#f4f0e7'
        }
      },
      {
        selector: '.external-node',
        style: {
          width: 224,
          height: 134,
          shape: 'round-rectangle',
          'border-style': 'dashed',
          'border-width': 2,
          'border-color': '#5d6f78',
          'background-color': '#e7edef',
          'text-max-width': 195,
          'font-size': 11
        }
      },
      {
        selector: '.internal-call-node',
        style: {
          height: 88,
          'border-color': '#66745f',
          'background-color': '#e5eadf'
        }
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'curve-style': 'bezier',
          'line-color': '#66745f',
          'target-arrow-color': '#66745f',
          'target-arrow-shape': 'triangle',
          'arrow-scale': 0.9,
          label: 'data(label)',
          color: '#4b4a44',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 10,
          'text-wrap': 'wrap',
          'text-max-width': 150,
          'text-background-color': '#fffaf0',
          'text-background-opacity': 0.94,
          'text-background-padding': 3,
          'text-rotation': 'autorotate',
          'overlay-opacity': 0
        }
      },
      {
        selector: '.relation-condition',
        style: {
          'line-color': '#5d6f78',
          'target-arrow-color': '#5d6f78',
          color: '#42555f'
        }
      },
      {
        selector: '.relation-loop',
        style: {
          'curve-style': 'unbundled-bezier',
          'control-point-distances': 92,
          'control-point-weights': 0.5,
          'line-style': 'dashed',
          'line-color': '#8c3f33',
          'target-arrow-color': '#8c3f33',
          color: '#7b2f27'
        }
      },
      {
        selector: '.relation-parallel',
        style: {
          width: 3,
          'line-color': '#9b783d',
          'target-arrow-color': '#9b783d',
          color: '#785b2b'
        }
      },
      {
        selector: '.external-edge',
        style: {
          'line-style': 'dashed',
          'line-color': '#5d6f78',
          'target-arrow-color': '#5d6f78',
          color: '#42555f'
        }
      },
      {
        selector: '.return-edge',
        style: {
          'curve-style': 'unbundled-bezier',
          'control-point-distances': -130,
          'control-point-weights': 0.5,
          'line-style': 'dotted',
          'line-color': '#8c3f33',
          'target-arrow-color': '#8c3f33',
          color: '#7b2f27'
        }
      },
      {
        selector: 'node:active, edge:active',
        style: {
          'overlay-color': '#9b783d',
          'overlay-opacity': 0.16,
          'overlay-padding': 8
        }
      }
    ];
  }

  function showInitialViewport(cy) {
    cy.fit(undefined, 34);
    if (cy.zoom() >= 0.5) return;
    const firstBehaviorNodes = cy.nodes('.behavior-node').slice(0, 2);
    if (firstBehaviorNodes.length) cy.fit(firstBehaviorNodes, 28);
  }

  function mount(options) {
    const container = options?.container;
    if (!container) throw new Error('缺少流程图画布。');
    const cytoscapeFactory = options.cytoscape
      || (typeof globalThis !== 'undefined' ? globalThis.cytoscape : null);
    if (typeof cytoscapeFactory !== 'function') throw new Error('流程图组件未加载。');
    const model = buildGraphModel(options.documentData);
    const cy = cytoscapeFactory({
      container,
      elements: model.elements,
      style: graphStyles(),
      layout: {
        name: 'grid',
        fit: false,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        padding: 36
      },
      autoungrabify: true,
      autounselectify: true,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      minZoom: 0.22,
      maxZoom: 1.8
    });
    cy.on('tap', 'node, edge', event => {
      const element = event.target;
      const focusKind = element.data('focusKind');
      const focusRef = element.data('focusRef');
      if (focusKind && typeof options.onFocus === 'function') options.onFocus(focusKind, focusRef);
    });
    cy.ready(() => {
      runLayout(cy, model);
      showInitialViewport(cy);
    });
    return {
      cy,
      model,
      fit() {
        cy.resize();
        cy.fit(undefined, 34);
      },
      reset() {
        runLayout(cy, model);
        showInitialViewport(cy);
      },
      destroy() {
        cy.destroy();
      }
    };
  }

  return {
    buildGraphModel,
    mount
  };
});
