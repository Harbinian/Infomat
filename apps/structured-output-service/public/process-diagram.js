(function initializeProcessDiagram(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProcessDiagram = api;
})(typeof window !== 'undefined' ? window : globalThis, function createProcessDiagramApi() {
  const RELATION_TYPES = new Set(['sequence', 'condition', 'loop', 'parallel']);
  const NODE_TYPES = new Set(['action', 'decision', 'parallel_split', 'parallel_join']);
  const DEFAULT_DEPARTMENT_ORDER = [
    '工程技术部',
    '质量管理部',
    '财务部',
    '行政人事部',
    '经营发展部',
    '物资保障部',
    '项目管理部',
    '复材车间',
    '运维安环部',
    '公司领导'
  ];
  const ALL_COMPANY_LANE = '__all_company__';
  const UNKNOWN_DEPARTMENT_LANE = '__unknown_department__';
  const LANE_HEADER_WIDTH = 190;
  const LANE_MIN_HEIGHT = 154;
  const LANE_SLOT_GAP = 126;
  const COLUMN_GAP = 290;
  const POOL_TITLE_HEIGHT = 52;

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function items(value) {
    return Array.isArray(value) ? value : [];
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function graphRef(prefix, index, value) {
    return `${prefix}:${index}:${text(value) || 'missing-ref'}`;
  }

  function relationLabel(relation) {
    const condition = text(relation.condition);
    if (relation.relation_type === 'condition') return `条件：${condition || '条件待填写'}`;
    if (relation.relation_type === 'loop') return `回路：${condition || '退出条件待填写'}`;
    if (relation.relation_type === 'parallel') {
      return relation.join_mode === 'all' ? '并行：全部分支完成后汇合' : '并行';
    }
    return '';
  }

  function handoffLabel(handoff) {
    const targetProcess = text(handoff.target_process_name);
    const targetBehavior = text(handoff.target_behavior_name);
    const target = [targetProcess, targetBehavior].filter(Boolean).join(' / ') || '待明确';
    return [
      '跨部门承接',
      `承接部门：${text(handoff.target_department) || '待明确'}`,
      `目标流程或行为：${target}`,
      `承接事项：${text(handoff.requested_matter) || '待明确'}`
    ].join('\n');
  }

  function internalCallLabel(call) {
    return [
      '内部流程调用',
      `目标流程：${text(call.target_process_name) || '待明确'}`
    ].join('\n');
  }

  function actorPlacement(actorRole, departmentOrder) {
    const raw = text(actorRole);
    if (raw === '全公司') {
      return {
        laneKey: ALL_COMPANY_LANE,
        laneLabel: '全公司通用',
        subtitle: '岗位：全公司通用',
        recognized: true,
        raw
      };
    }
    const department = departmentOrder.find(name => raw === name || raw.startsWith(name));
    if (department) {
      const position = raw.slice(department.length).trim();
      return {
        laneKey: department,
        laneLabel: department,
        subtitle: `岗位：${position || '待填写'}`,
        recognized: true,
        raw
      };
    }
    return {
      laneKey: UNKNOWN_DEPARTMENT_LANE,
      laneLabel: '执行部门待明确',
      subtitle: raw ? `执行信息：${raw}` : '岗位：待填写',
      recognized: false,
      raw
    };
  }

  function behaviorLabel(behavior, placement) {
    const name = text(behavior.behavior_name) || '业务行为名称待填写';
    const nodeType = text(behavior.node_type);
    if (nodeType === 'decision') return `×  ${name}\n${placement.subtitle}`;
    if (nodeType === 'parallel_split') return `＋  ${name}\n${placement.subtitle}\n同时开始`;
    if (nodeType === 'parallel_join') return `＋  ${name}\n${placement.subtitle}\n并行汇合`;
    if (!NODE_TYPES.has(nodeType)) return `${name}\n${placement.subtitle}\n节点类型待判断`;
    return `${name}\n${placement.subtitle}`;
  }

  function behaviorClass(nodeType) {
    if (nodeType === 'decision') return 'decision';
    if (nodeType === 'parallel_split') return 'parallel-split';
    if (nodeType === 'parallel_join') return 'parallel-join';
    if (nodeType === 'action') return 'action';
    return 'pending';
  }

  function calculateRanks(nodeIds, relations, orderById) {
    const rankById = new Map(nodeIds.map(id => [id, 0]));
    const outgoing = new Map(nodeIds.map(id => [id, []]));
    const indegree = new Map(nodeIds.map(id => [id, 0]));

    relations
      .filter(item => item.relation.relation_type !== 'loop' && item.sourceId !== item.targetId)
      .forEach(item => {
        outgoing.get(item.sourceId)?.push(item.targetId);
        indegree.set(item.targetId, (indegree.get(item.targetId) || 0) + 1);
      });

    const queue = nodeIds
      .filter(id => indegree.get(id) === 0)
      .sort((left, right) => orderById.get(left) - orderById.get(right));
    const processed = new Set();
    while (queue.length) {
      const current = queue.shift();
      if (processed.has(current)) continue;
      processed.add(current);
      (outgoing.get(current) || []).forEach(target => {
        rankById.set(target, Math.max(rankById.get(target) || 0, (rankById.get(current) || 0) + 1));
        indegree.set(target, (indegree.get(target) || 0) - 1);
        if (indegree.get(target) === 0) {
          queue.push(target);
          queue.sort((left, right) => orderById.get(left) - orderById.get(right));
        }
      });
    }
    return rankById;
  }

  function buildLaneOrder(usedLaneKeys, owningDepartment, departmentOrder) {
    const used = new Set(usedLaneKeys);
    const ordered = [];
    if (owningDepartment && used.has(owningDepartment)) ordered.push(owningDepartment);
    departmentOrder.forEach(department => {
      if (used.has(department) && !ordered.includes(department)) ordered.push(department);
    });
    [...used]
      .filter(key => !ordered.includes(key) && key !== ALL_COMPANY_LANE && key !== UNKNOWN_DEPARTMENT_LANE)
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      .forEach(key => ordered.push(key));
    if (used.has(ALL_COMPANY_LANE)) ordered.push(ALL_COMPANY_LANE);
    if (used.has(UNKNOWN_DEPARTMENT_LANE)) ordered.push(UNKNOWN_DEPARTMENT_LANE);
    return ordered;
  }

  function laneDisplayName(laneKey) {
    if (laneKey === ALL_COMPANY_LANE) return '全公司通用';
    if (laneKey === UNKNOWN_DEPARTMENT_LANE) return '执行部门待明确';
    return laneKey;
  }

  function buildGraphModel(documentData, options = {}) {
    const data = documentData && typeof documentData === 'object' ? documentData : {};
    const owningDepartment = text(data.process?.owning_department);
    const departmentOrder = unique([
      owningDepartment,
      ...items(options.departmentOrder).map(text),
      ...DEFAULT_DEPARTMENT_ORDER
    ]);
    const nodes = [];
    const backgrounds = [];
    const edges = [];
    const unresolvedItems = [];
    const behaviorNodeByRef = new Map();
    const behaviorRecords = [];
    const orderById = new Map();
    let namedBehaviorCount = 0;
    let localEdgeCount = 0;

    items(data.behaviors).forEach((behavior, index) => {
      const behaviorRef = text(behavior.behavior_ref);
      const graphId = graphRef('behavior', index, behaviorRef);
      if (behaviorRef && !behaviorNodeByRef.has(behaviorRef)) behaviorNodeByRef.set(behaviorRef, graphId);
      if (text(behavior.behavior_name)) namedBehaviorCount += 1;
      const nodeType = text(behavior.node_type);
      const placement = actorPlacement(behavior.current_actor_role, departmentOrder);
      const node = {
        group: 'nodes',
        classes: `behavior-node node-${behaviorClass(nodeType)}`,
        data: {
          id: graphId,
          label: behaviorLabel(behavior, placement),
          detail: NODE_TYPES.has(nodeType) ? nodeType : '节点类型待判断',
          focusKind: 'behavior',
          focusRef: behaviorRef,
          laneKey: placement.laneKey,
          laneLabel: placement.laneLabel,
          actorRole: placement.raw,
          layoutRank: 0,
          layoutOrder: index
        }
      };
      behaviorRecords.push({ node, behavior, index, placement });
      orderById.set(graphId, index);
    });

    const validRelations = [];
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
      const sourceId = behaviorNodeByRef.get(fromRef);
      const targetId = behaviorNodeByRef.get(toRef);
      validRelations.push({ relation, index, relationRef, sourceId, targetId });
      localEdgeCount += 1;
      edges.push({
        group: 'edges',
        classes: `flow-edge relation-${relation.relation_type}`,
        data: {
          id: graphRef('relation', index, relationRef),
          source: sourceId,
          target: targetId,
          label: relationLabel(relation),
          focusKind: 'relation',
          focusRef: relationRef
        }
      });
    });

    const rankById = calculateRanks(
      behaviorRecords.map(record => record.node.data.id),
      validRelations,
      orderById
    );
    behaviorRecords.forEach(record => {
      record.node.data.layoutRank = rankById.get(record.node.data.id) || 0;
      nodes.push(record.node);
    });

    const internalCallRecords = [];
    items(data.internal_process_calls).forEach((call, index) => {
      const callRef = text(call.call_ref);
      const callerRef = text(call.caller_behavior_ref);
      const callerNodeId = behaviorNodeByRef.get(callerRef);
      const callerRecord = behaviorRecords.find(record => record.node.data.id === callerNodeId);
      if (!callerNodeId || !callerRecord) {
        unresolvedItems.push({
          focusKind: 'call',
          focusRef: callRef,
          message: `内部流程调用${index + 1}未显示：请指定有效的调用行为。`
        });
        return;
      }
      const callNodeId = graphRef('call', index, callRef);
      const callNode = {
        group: 'nodes',
        classes: 'internal-call-node',
        data: {
          id: callNodeId,
          label: internalCallLabel(call),
          detail: '由MDM平台正式功能维护',
          focusKind: 'call',
          focusRef: callRef,
          laneKey: callerRecord.node.data.laneKey,
          laneLabel: callerRecord.node.data.laneLabel,
          layoutRank: (rankById.get(callerNodeId) || 0) + 1,
          layoutOrder: behaviorRecords.length + index
        }
      };
      internalCallRecords.push({ node: callNode, index });
      nodes.push(callNode);
      edges.push({
        group: 'edges',
        classes: 'flow-edge internal-call-edge',
        data: {
          id: graphRef('call-out', index, callRef),
          source: callerNodeId,
          target: callNodeId,
          label: '调用内部流程',
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
          classes: 'flow-edge internal-call-edge internal-return-edge',
          data: {
            id: graphRef('call-return', index, callRef),
            source: callNodeId,
            target: behaviorNodeByRef.get(returnRef),
            label: '调用完成后返回',
            focusKind: 'call',
            focusRef: callRef
          }
        });
      }
    });

    const positionedNodes = [...behaviorRecords.map(record => record.node), ...internalCallRecords.map(record => record.node)];
    const laneKeys = buildLaneOrder(
      positionedNodes.map(node => node.data.laneKey),
      owningDepartment,
      departmentOrder
    );
    const maxRank = Math.max(0, ...positionedNodes.map(node => node.data.layoutRank || 0));
    const laneBodyWidth = Math.max(860, (maxRank + 1) * COLUMN_GAP + 180);
    const poolWidth = LANE_HEADER_WIDTH + laneBodyWidth;
    let laneTop = POOL_TITLE_HEIGHT + 18;
    const laneMetadata = [];

    laneKeys.forEach((laneKey, laneIndex) => {
      const laneNodes = positionedNodes.filter(node => node.data.laneKey === laneKey);
      const countsByRank = new Map();
      laneNodes.forEach(node => {
        const rank = node.data.layoutRank || 0;
        countsByRank.set(rank, (countsByRank.get(rank) || 0) + 1);
      });
      const maxSlots = Math.max(1, ...countsByRank.values());
      const laneHeight = Math.max(LANE_MIN_HEIGHT, maxSlots * LANE_SLOT_GAP + 36);
      const laneCenterY = laneTop + laneHeight / 2;
      const laneLabel = laneDisplayName(laneKey);
      laneMetadata.push({
        key: laneKey,
        label: laneLabel,
        index: laneIndex,
        top: laneTop,
        height: laneHeight,
        centerY: laneCenterY
      });
      backgrounds.push({
        group: 'nodes',
        classes: 'lane-background-node lane-header-node',
        data: {
          id: `lane-header:${laneIndex}`,
          label: laneLabel,
          width: LANE_HEADER_WIDTH,
          height: laneHeight
        },
        position: {
          x: LANE_HEADER_WIDTH / 2,
          y: laneCenterY
        }
      });
      backgrounds.push({
        group: 'nodes',
        classes: 'lane-background-node lane-body-node',
        data: {
          id: `lane-body:${laneIndex}`,
          label: '',
          width: laneBodyWidth,
          height: laneHeight
        },
        position: {
          x: LANE_HEADER_WIDTH + laneBodyWidth / 2,
          y: laneCenterY
        }
      });

      const nodesByRank = new Map();
      laneNodes.forEach(node => {
        const rank = node.data.layoutRank || 0;
        if (!nodesByRank.has(rank)) nodesByRank.set(rank, []);
        nodesByRank.get(rank).push(node);
      });
      nodesByRank.forEach((rankNodes, rank) => {
        rankNodes.sort((left, right) => left.data.layoutOrder - right.data.layoutOrder);
        rankNodes.forEach((node, slotIndex) => {
          node.position = {
            x: LANE_HEADER_WIDTH + 150 + rank * COLUMN_GAP,
            y: laneCenterY + (slotIndex - (rankNodes.length - 1) / 2) * LANE_SLOT_GAP
          };
        });
      });
      laneTop += laneHeight;
    });

    const poolHeight = Math.max(POOL_TITLE_HEIGHT, laneTop);
    backgrounds.unshift({
      group: 'nodes',
      classes: 'lane-background-node pool-title-node',
      data: {
        id: 'pool-title',
        label: text(data.process?.process_name) || '当前流程',
        width: poolWidth,
        height: POOL_TITLE_HEIGHT
      },
      position: {
        x: poolWidth / 2,
        y: POOL_TITLE_HEIGHT / 2
      }
    });

    const countersignBadges = [];
    behaviorRecords.forEach(record => {
      const targetDepartments = unique(items(record.behavior.countersign_target_departments).map(text));
      if (!record.behavior.countersign_all_required && !targetDepartments.length) return;
      countersignBadges.push({
        group: 'nodes',
        classes: 'countersign-badge',
        data: {
          id: `countersign:${record.index}:${text(record.behavior.behavior_ref) || 'missing-ref'}`,
          label: `会签×${targetDepartments.length}`,
          focusKind: 'behavior',
          focusRef: text(record.behavior.behavior_ref)
        },
        position: {
          x: record.node.position.x + (record.behavior.node_type === 'decision' ? 62 : 86),
          y: record.node.position.y - (record.behavior.node_type === 'decision' ? 58 : 47)
        }
      });
    });
    nodes.push(...countersignBadges);

    let externalItemIndex = 0;
    items(data.cross_department_handoffs).forEach((handoff, index) => {
      const handoffRef = text(handoff.handoff_ref);
      const sendRef = text(handoff.send_behavior_ref);
      const sendNodeId = behaviorNodeByRef.get(sendRef);
      const sendNode = behaviorRecords.find(record => record.node.data.id === sendNodeId)?.node;
      if (!sendNodeId || !sendNode) {
        unresolvedItems.push({
          focusKind: 'handoff',
          focusRef: handoffRef,
          message: `跨部门承接${index + 1}未显示：请指定有效的发送行为。`
        });
        return;
      }
      const externalNodeId = graphRef('handoff', index, handoffRef);
      const externalY = poolHeight + 102 + externalItemIndex * 164;
      const externalX = Math.max(
        LANE_HEADER_WIDTH + 170,
        Math.min(poolWidth - 150, sendNode.position.x + 230)
      );
      externalItemIndex += 1;
      nodes.push({
        group: 'nodes',
        classes: 'external-node handoff-node',
        data: {
          id: externalNodeId,
          label: handoffLabel(handoff),
          detail: '流程泳道区域外',
          focusKind: 'handoff',
          focusRef: handoffRef
        },
        position: {
          x: externalX,
          y: externalY
        }
      });
      edges.push({
        group: 'edges',
        classes: 'message-flow handoff-edge',
        data: {
          id: graphRef('handoff-out', index, handoffRef),
          source: sendNodeId,
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
          classes: 'message-flow return-message-flow',
          data: {
            id: graphRef('handoff-return', index, handoffRef),
            source: externalNodeId,
            target: behaviorNodeByRef.get(returnRef),
            label: '承接完成后返回',
            focusKind: 'handoff',
            focusRef: handoffRef
          }
        });
      }
    });

    return {
      nodes,
      backgrounds,
      edges,
      elements: [...backgrounds, ...nodes, ...edges],
      lanes: laneMetadata,
      namedBehaviorCount,
      localEdgeCount,
      unresolvedItems,
      unresolvedCount: unresolvedItems.length,
      pool: {
        width: poolWidth,
        height: poolHeight
      }
    };
  }

  function graphStyles() {
    return [
      {
        selector: '.lane-background-node',
        style: {
          width: 'data(width)',
          height: 'data(height)',
          shape: 'rectangle',
          label: 'data(label)',
          color: '#34342f',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 12,
          'font-weight': 700,
          'text-wrap': 'wrap',
          'text-max-width': 150,
          'text-valign': 'center',
          'text-halign': 'center',
          'background-color': '#fbf8f0',
          'border-color': '#9a927f',
          'border-width': 1,
          'overlay-opacity': 0,
          events: 'no',
          'z-index': 0,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: '.pool-title-node',
        style: {
          'background-color': '#e7dfce',
          'border-color': '#6f695c',
          'border-width': 1.5,
          'font-size': 14,
          'text-max-width': 640,
          'z-index': 1
        }
      },
      {
        selector: '.lane-header-node',
        style: {
          'background-color': '#eee7d9',
          'border-color': '#827968',
          'border-width': 1.5,
          'z-index': 1
        }
      },
      {
        selector: '.lane-body-node',
        style: {
          'background-color': '#fffdf8',
          'border-color': '#b7ae9d'
        }
      },
      {
        selector: '.behavior-node, .internal-call-node, .external-node',
        style: {
          width: 188,
          height: 82,
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
          'text-max-width': 164,
          'text-valign': 'center',
          'text-halign': 'center',
          'overlay-opacity': 0,
          'z-index': 20,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: '.node-decision',
        style: {
          width: 152,
          height: 122,
          shape: 'diamond',
          'background-color': '#f5e5df',
          'text-max-width': 100
        }
      },
      {
        selector: '.node-parallel-split, .node-parallel-join',
        style: {
          width: 158,
          height: 122,
          shape: 'diamond',
          'background-color': '#f3e7ca',
          'border-color': '#9b783d',
          'text-max-width': 105
        }
      },
      {
        selector: '.node-parallel-join',
        style: {
          'background-color': '#e5eadf',
          'border-color': '#66745f'
        }
      },
      {
        selector: '.node-pending',
        style: {
          shape: 'rectangle',
          'border-style': 'dashed',
          'border-color': '#746f64',
          'background-color': '#f4f0e7'
        }
      },
      {
        selector: '.internal-call-node',
        style: {
          width: 214,
          height: 92,
          'border-width': 5,
          'border-color': '#52665a',
          'background-color': '#e5eadf',
          'text-max-width': 182
        }
      },
      {
        selector: '.external-node',
        style: {
          width: 254,
          height: 132,
          'border-style': 'dashed',
          'border-width': 2,
          'border-color': '#526973',
          'background-color': '#e7edef',
          'text-max-width': 224,
          'font-size': 11
        }
      },
      {
        selector: '.countersign-badge',
        style: {
          width: 64,
          height: 25,
          shape: 'round-rectangle',
          'background-color': '#8c3f33',
          'border-width': 1,
          'border-color': '#fffaf0',
          color: '#ffffff',
          label: 'data(label)',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 10,
          'font-weight': 700,
          'text-valign': 'center',
          'text-halign': 'center',
          'overlay-opacity': 0,
          'z-index': 30,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: 'edge',
        style: {
          width: 2,
          'curve-style': 'taxi',
          'taxi-direction': 'rightward',
          'taxi-turn': 56,
          'taxi-turn-min-distance': 18,
          'taxi-radius': 7,
          'line-style': 'solid',
          'line-color': '#5b625d',
          'target-arrow-color': '#5b625d',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'filled',
          'arrow-scale': 0.9,
          label: 'data(label)',
          color: '#454843',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 10,
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-max-width': 180,
          'text-background-color': '#fffdf8',
          'text-background-opacity': 0.96,
          'text-background-padding': 3,
          'text-rotation': 'none',
          'overlay-opacity': 0,
          'z-index': 10,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: '.relation-condition',
        style: {
          'line-color': '#526973',
          'target-arrow-color': '#526973',
          color: '#3f5660'
        }
      },
      {
        selector: '.relation-loop, .internal-return-edge',
        style: {
          'curve-style': 'unbundled-bezier',
          'control-point-distances': -112,
          'control-point-weights': 0.5,
          'line-style': 'solid',
          'line-color': '#8c3f33',
          'target-arrow-color': '#8c3f33',
          color: '#7b2f27'
        }
      },
      {
        selector: '.relation-parallel',
        style: {
          width: 3,
          'line-color': '#8a6a30',
          'target-arrow-color': '#8a6a30',
          color: '#6f5223'
        }
      },
      {
        selector: '.internal-call-edge',
        style: {
          width: 3,
          'line-color': '#52665a',
          'target-arrow-color': '#52665a',
          color: '#405448'
        }
      },
      {
        selector: '.message-flow',
        style: {
          'curve-style': 'taxi',
          'line-style': 'dashed',
          'line-color': '#526973',
          'source-arrow-shape': 'circle',
          'source-arrow-fill': 'hollow',
          'source-arrow-color': '#526973',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'hollow',
          'target-arrow-color': '#526973',
          color: '#3f5660'
        }
      },
      {
        selector: '.return-message-flow',
        style: {
          'curve-style': 'unbundled-bezier',
          'control-point-distances': 126,
          'control-point-weights': 0.5,
          'line-style': 'dashed',
          color: '#7b2f27',
          'line-color': '#8c3f33',
          'source-arrow-color': '#8c3f33',
          'target-arrow-color': '#8c3f33'
        }
      },
      {
        selector: 'node:active, edge:active',
        style: {
          'overlay-color': '#9b783d',
          'overlay-opacity': 0.18,
          'overlay-padding': 8
        }
      }
    ];
  }

  function showInitialViewport(cy) {
    cy.resize();
    const laneHeaders = cy.nodes('.lane-header-node');
    const firstColumns = cy.nodes('.behavior-node, .internal-call-node').filter(node =>
      Number(node.data('layoutRank')) <= 1
    );
    const initialElements = laneHeaders.union(firstColumns);
    if (initialElements.length) {
      cy.fit(initialElements, 28);
      const renderedBox = initialElements.renderedBoundingBox();
      cy.panBy({ x: 28 - renderedBox.x1, y: 0 });
    } else {
      cy.fit(undefined, 34);
    }
  }

  function mount(options) {
    const container = options?.container;
    if (!container) throw new Error('缺少流程图画布。');
    const cytoscapeFactory = options.cytoscape
      || (typeof globalThis !== 'undefined' ? globalThis.cytoscape : null);
    if (typeof cytoscapeFactory !== 'function') throw new Error('流程图组件未加载。');
    const model = buildGraphModel(options.documentData, {
      departmentOrder: options.departmentOrder
    });
    const cy = cytoscapeFactory({
      container,
      elements: model.elements,
      style: graphStyles(),
      layout: {
        name: 'preset',
        fit: false,
        animate: false
      },
      autoungrabify: true,
      autounselectify: true,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      minZoom: 0.16,
      maxZoom: 1.8
    });
    cy.on('tap', '.behavior-node, .internal-call-node, .external-node, .countersign-badge, edge', event => {
      const element = event.target;
      const focusKind = element.data('focusKind');
      const focusRef = element.data('focusRef');
      if (focusKind && typeof options.onFocus === 'function') options.onFocus(focusKind, focusRef);
    });
    cy.ready(() => {
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
