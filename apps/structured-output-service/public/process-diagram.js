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
  const DYNAMIC_DEPARTMENT_LANE = '__dynamic_department__';
  const UNKNOWN_DEPARTMENT_LANE = '__unknown_department__';
  const CONTROL_LANE = '__process_control__';
  const LANE_HEADER_WIDTH = 190;
  const LANE_MIN_HEIGHT = 154;
  const LANE_NODE_GAP = 36;
  const LANE_VERTICAL_PADDING = 28;
  const EDGE_LABEL_MAX_WIDTH = 220;
  const MIN_COLUMN_GAP = 440;
  const COLUMN_LABEL_CLEARANCE = 48;
  const ROUTE_TRACK_GAP = 24;
  const FULL_VIEW_MIN_ZOOM = 0.6;
  const POOL_TITLE_HEIGHT = 52;
  const LANE_FONT_SIZE = 14;
  const POOL_TITLE_FONT_SIZE = 16;
  const NODE_FONT_SIZE = 15;
  const EXTERNAL_NODE_FONT_SIZE = 14;
  const BADGE_FONT_SIZE = 12;
  const EDGE_FONT_SIZE = 13;
  const RELATION_CYCLE_REVIEW_MESSAGE = '该关系与其他非回路关系形成闭环；如果这是退回前序行为，请选择“流程内部回路”。';

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

  function characterUnits(character) {
    return /^[\u0000-\u00ff]$/.test(character) ? 0.56 : 1;
  }

  function wrapDisplayText(value, maxUnits) {
    const rawLabel = value == null ? '' : String(value);
    if (!rawLabel) {
      return {
        rawLabel,
        label: '',
        lineCount: 0,
        maxLineUnits: 0
      };
    }
    const lines = [];
    rawLabel.split('\n').forEach(paragraph => {
      if (!paragraph) {
        lines.push('');
        return;
      }
      let current = '';
      let currentUnits = 0;
      Array.from(paragraph).forEach(character => {
        const units = characterUnits(character);
        if (current && currentUnits + units > maxUnits) {
          lines.push(current);
          current = character;
          currentUnits = units;
          return;
        }
        current += character;
        currentUnits += units;
      });
      lines.push(current);
    });
    return {
      rawLabel,
      label: lines.join('\n'),
      lineCount: lines.length,
      maxLineUnits: Math.max(
        0,
        ...lines.map(line => Array.from(line).reduce((sum, character) => sum + characterUnits(character), 0))
      )
    };
  }

  function nodeDisplayMetrics(rawLabel, nodeKind) {
    const diamond = nodeKind === 'decision'
      || nodeKind === 'parallel-split'
      || nodeKind === 'parallel-join';
    const external = nodeKind === 'external';
    const internal = nodeKind === 'internal';
    const maxUnits = diamond ? 11 : external ? 19 : internal ? 16 : 15;
    const wrapped = wrapDisplayText(rawLabel, maxUnits);
    const lineHeight = external ? 21 : 22;
    const verticalPadding = diamond ? 0 : external ? 40 : 36;
    const measuredTextWidth = Math.ceil(wrapped.maxLineUnits * (external ? 13.2 : 14.4));
    const measuredTextHeight = wrapped.lineCount * lineHeight;
    if (diamond) {
      const textMaxWidth = Math.max(154, measuredTextWidth);
      const labelHeight = measuredTextHeight + 16;
      return {
        ...wrapped,
        nodeWidth: Math.ceil(Math.max(312, textMaxWidth / 0.46)),
        nodeHeight: Math.ceil(Math.max(220, labelHeight / 0.42)),
        textMaxWidth,
        labelWidth: textMaxWidth,
        labelHeight,
        lineHeight,
        verticalPadding: 16
      };
    }
    const baseWidth = external ? 320 : internal ? 280 : 268;
    const baseHeight = external ? 150 : internal ? 112 : 106;
    const textMaxWidth = Math.max(1, Math.min(
      external ? 280 : internal ? 240 : 232,
      Math.max(measuredTextWidth, external ? 180 : 150)
    ));
    return {
      ...wrapped,
      nodeWidth: baseWidth,
      nodeHeight: Math.max(baseHeight, measuredTextHeight + verticalPadding),
      textMaxWidth,
      labelWidth: textMaxWidth,
      labelHeight: measuredTextHeight + verticalPadding,
      lineHeight,
      verticalPadding
    };
  }

  function edgeDisplayMetrics(rawLabel) {
    const wrapped = wrapDisplayText(rawLabel, 16);
    const measuredWidth = Math.ceil(wrapped.maxLineUnits * 12.7 + 16);
    return {
      ...wrapped,
      labelWidth: wrapped.lineCount ? Math.min(EDGE_LABEL_MAX_WIDTH, Math.max(84, measuredWidth)) : 0,
      labelHeight: wrapped.lineCount ? wrapped.lineCount * 20 + 10 : 0
    };
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

  function compactCount(value) {
    return value > 99 ? '99+' : String(value);
  }

  function aggregateBadges(data, behaviorRecords) {
    const dataCounts = new Map();
    items(data.data_objects).forEach(dataObject => {
      items(dataObject.behavior_links).forEach(link => {
        if (!dataCounts.has(link.behavior_ref)) dataCounts.set(link.behavior_ref, { create: 0, update: 0, use: 0, pending_confirmation: 0 });
        const counts = dataCounts.get(link.behavior_ref);
        if (Object.prototype.hasOwnProperty.call(counts, link.operation)) counts[link.operation] += 1;
      });
    });
    const formCounts = new Map();
    items(data.forms).forEach(form => {
      unique(items(form.behavior_links).map(link => text(link.behavior_ref))).forEach(behaviorRef => {
        formCounts.set(behaviorRef, (formCounts.get(behaviorRef) || 0) + 1);
      });
    });
    const badges = [];
    behaviorRecords.forEach(record => {
      const behaviorRef = text(record.behavior.behavior_ref);
      const counts = dataCounts.get(behaviorRef);
      const dataTotal = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : 0;
      if (dataTotal) {
        const label = `数据 创${compactCount(counts.create)} 更${compactCount(counts.update)} 用${compactCount(counts.use)}${counts.pending_confirmation ? ` ?${compactCount(counts.pending_confirmation)}` : ''}`;
        badges.push({
          group: 'nodes',
          classes: 'aggregate-badge data-aggregate-badge',
          data: {
            id: `data-badge:${record.index}:${behaviorRef}`,
            label,
            focusKind: 'data-badge',
            focusRef: behaviorRef
          },
          position: {
            x: record.node.position.x - record.node.data.nodeWidth / 2 + 74,
            y: record.node.position.y + record.node.data.nodeHeight / 2 - 7
          }
        });
      }
      const formCount = formCounts.get(behaviorRef) || 0;
      if (formCount) {
        badges.push({
          group: 'nodes',
          classes: 'aggregate-badge form-aggregate-badge',
          data: {
            id: `form-badge:${record.index}:${behaviorRef}`,
            label: `表单 ${compactCount(formCount)}`,
            focusKind: 'form-badge',
            focusRef: behaviorRef
          },
          position: {
            x: record.node.position.x + record.node.data.nodeWidth / 2 - 54,
            y: record.node.position.y + record.node.data.nodeHeight / 2 - 7
          }
        });
      }
    });
    return badges;
  }

  function internalCallLabel(call) {
    return [
      '内部流程调用',
      `目标流程：${text(call.target_process_name) || '待明确'}`
    ].join('\n');
  }

  function actorAssignmentMode(behavior) {
    const explicit = text(behavior?.actor_assignment_mode);
    if (['fixed_department', 'company_wide', 'dynamic_from_data'].includes(explicit)) return explicit;
    return text(behavior?.current_actor_role) === '全公司' ? 'company_wide' : 'fixed_department';
  }

  function actorPlacement(behavior, departmentOrder, dataNameByRef) {
    if (['decision', 'parallel_split', 'parallel_join'].includes(text(behavior?.node_type))) {
      return {
        laneKey: CONTROL_LANE,
        laneLabel: '流程控制',
        subtitle: '流程控制，不代表执行部门',
        recognized: true,
        raw: '',
        dynamic: false,
        control: true
      };
    }
    const assignmentMode = actorAssignmentMode(behavior);
    const raw = text(behavior?.current_actor_role);
    if (assignmentMode === 'dynamic_from_data') {
      const dataRef = text(behavior?.actor_department_data_ref);
      const dataName = dataNameByRef.get(dataRef) || '';
      return {
        laneKey: DYNAMIC_DEPARTMENT_LANE,
        laneLabel: '运行时责任部门',
        subtitle: dataName ? `部门：按“${dataName}”动态确定` : '部门：按前序数据动态确定',
        recognized: Boolean(dataName),
        raw: dataName ? `按${dataName}动态确定` : '按前序数据动态确定',
        dynamic: true
      };
    }
    if (assignmentMode === 'company_wide' || raw === '全公司') {
      return {
        laneKey: ALL_COMPANY_LANE,
        laneLabel: '全公司通用',
        subtitle: '岗位：全公司通用',
        recognized: true,
        raw: '全公司',
        dynamic: false
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
        raw,
        dynamic: false
      };
    }
    return {
      laneKey: UNKNOWN_DEPARTMENT_LANE,
      laneLabel: '执行部门待明确',
      subtitle: raw ? `执行信息：${raw}` : '岗位：待填写',
      recognized: false,
      raw,
      dynamic: false
    };
  }

  function behaviorLabel(behavior, placement) {
    const name = text(behavior.behavior_name) || '业务行为名称待填写';
    const nodeType = text(behavior.node_type);
    if (nodeType === 'decision') return `×  ${name}\n${placement.subtitle}`;
    if (nodeType === 'parallel_split') return `＋  ${name}\n${placement.subtitle}\n同时启动多条路线`;
    if (nodeType === 'parallel_join') return `＋  ${name}\n${placement.subtitle}\n等待多条路线完成`;
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

  function analyzeRelationGraph(nodeIds, relations, orderById) {
    const nonLoopRelations = relations
      .filter(item => item.relation.relation_type !== 'loop')
      .sort((left, right) => left.index - right.index);
    const outgoing = new Map(nodeIds.map(id => [id, []]));
    nonLoopRelations.forEach(item => outgoing.get(item.sourceId)?.push(item));
    outgoing.forEach(entries => entries.sort((left, right) => left.index - right.index));

    let nextIndex = 0;
    const indexById = new Map();
    const lowLinkById = new Map();
    const stack = [];
    const onStack = new Set();
    const components = [];

    function visit(nodeId) {
      indexById.set(nodeId, nextIndex);
      lowLinkById.set(nodeId, nextIndex);
      nextIndex += 1;
      stack.push(nodeId);
      onStack.add(nodeId);
      (outgoing.get(nodeId) || []).forEach(item => {
        const targetId = item.targetId;
        if (!indexById.has(targetId)) {
          visit(targetId);
          lowLinkById.set(nodeId, Math.min(lowLinkById.get(nodeId), lowLinkById.get(targetId)));
        } else if (onStack.has(targetId)) {
          lowLinkById.set(nodeId, Math.min(lowLinkById.get(nodeId), indexById.get(targetId)));
        }
      });
      if (lowLinkById.get(nodeId) !== indexById.get(nodeId)) return;
      const component = [];
      while (stack.length) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === nodeId) break;
      }
      component.sort((left, right) => orderById.get(left) - orderById.get(right));
      components.push(component);
    }

    [...nodeIds]
      .sort((left, right) => orderById.get(left) - orderById.get(right))
      .forEach(nodeId => {
        if (!indexById.has(nodeId)) visit(nodeId);
      });

    components.sort((left, right) => orderById.get(left[0]) - orderById.get(right[0]));
    const componentByNode = new Map();
    components.forEach((component, componentIndex) => {
      component.forEach(nodeId => componentByNode.set(nodeId, componentIndex));
    });
    const cyclicComponents = new Set();
    components.forEach((component, componentIndex) => {
      if (component.length > 1) cyclicComponents.add(componentIndex);
    });
    nonLoopRelations.forEach(item => {
      if (item.sourceId === item.targetId) cyclicComponents.add(componentByNode.get(item.sourceId));
    });
    const reviewRelationIndexes = new Set(
      nonLoopRelations
        .filter(item => {
          const sourceComponent = componentByNode.get(item.sourceId);
          return sourceComponent === componentByNode.get(item.targetId)
            && cyclicComponents.has(sourceComponent);
        })
        .map(item => item.index)
    );

    const componentOutgoing = new Map(components.map((_component, index) => [index, new Set()]));
    const componentIndegree = new Map(components.map((_component, index) => [index, 0]));
    nonLoopRelations.forEach(item => {
      const sourceComponent = componentByNode.get(item.sourceId);
      const targetComponent = componentByNode.get(item.targetId);
      if (sourceComponent === targetComponent || componentOutgoing.get(sourceComponent).has(targetComponent)) return;
      componentOutgoing.get(sourceComponent).add(targetComponent);
      componentIndegree.set(targetComponent, componentIndegree.get(targetComponent) + 1);
    });
    const componentRank = new Map(components.map((_component, index) => [index, 0]));
    const componentOrder = index => orderById.get(components[index][0]);
    const queue = [...componentIndegree.entries()]
      .filter(([, indegree]) => indegree === 0)
      .map(([componentIndex]) => componentIndex)
      .sort((left, right) => componentOrder(left) - componentOrder(right));
    while (queue.length) {
      const componentIndex = queue.shift();
      [...componentOutgoing.get(componentIndex)]
        .sort((left, right) => componentOrder(left) - componentOrder(right))
        .forEach(targetComponent => {
          componentRank.set(
            targetComponent,
            Math.max(
              componentRank.get(targetComponent),
              componentRank.get(componentIndex) + components[componentIndex].length
            )
          );
          componentIndegree.set(targetComponent, componentIndegree.get(targetComponent) - 1);
          if (componentIndegree.get(targetComponent) === 0) {
            queue.push(targetComponent);
            queue.sort((left, right) => componentOrder(left) - componentOrder(right));
          }
        });
    }
    const rankById = new Map();
    components.forEach((component, componentIndex) => {
      component.forEach((nodeId, localIndex) => {
        rankById.set(nodeId, componentRank.get(componentIndex) + localIndex);
      });
    });
    return {
      rankById,
      reviewRelationIndexes
    };
  }

  function buildLaneOrder(usedLaneKeys, owningDepartment, departmentOrder) {
    const used = new Set(usedLaneKeys);
    const ordered = [];
    if (used.has(CONTROL_LANE)) ordered.push(CONTROL_LANE);
    if (owningDepartment && used.has(owningDepartment)) ordered.push(owningDepartment);
    departmentOrder.forEach(department => {
      if (used.has(department) && !ordered.includes(department)) ordered.push(department);
    });
    [...used]
      .filter(key =>
        !ordered.includes(key)
        && key !== ALL_COMPANY_LANE
        && key !== DYNAMIC_DEPARTMENT_LANE
        && key !== UNKNOWN_DEPARTMENT_LANE
        && key !== CONTROL_LANE
      )
      .sort((left, right) => left.localeCompare(right, 'zh-CN'))
      .forEach(key => ordered.push(key));
    if (used.has(ALL_COMPANY_LANE)) ordered.push(ALL_COMPANY_LANE);
    if (used.has(DYNAMIC_DEPARTMENT_LANE)) ordered.push(DYNAMIC_DEPARTMENT_LANE);
    if (used.has(UNKNOWN_DEPARTMENT_LANE)) ordered.push(UNKNOWN_DEPARTMENT_LANE);
    return ordered;
  }

  function laneDisplayName(laneKey) {
    if (laneKey === CONTROL_LANE) return '流程控制\n不代表执行部门';
    if (laneKey === ALL_COMPANY_LANE) return '全公司通用';
    if (laneKey === DYNAMIC_DEPARTMENT_LANE) return '运行时责任部门';
    if (laneKey === UNKNOWN_DEPARTMENT_LANE) return '执行部门待明确';
    return laneKey;
  }

  function allocateRelationRoutes(validRelations, behaviorRecordById, rankById, routeTrackGap = ROUTE_TRACK_GAP) {
    const outgoingCount = new Map();
    const endpointCount = new Map();
    validRelations.forEach(item => {
      outgoingCount.set(item.sourceId, (outgoingCount.get(item.sourceId) || 0) + 1);
      const endpointKey = `${item.sourceId}->${item.targetId}`;
      endpointCount.set(endpointKey, (endpointCount.get(endpointKey) || 0) + 1);
    });
    const recordsByRank = new Map();
    behaviorRecordById.forEach((record, nodeId) => {
      const rank = rankById.get(nodeId) || 0;
      if (!recordsByRank.has(rank)) recordsByRank.set(rank, []);
      recordsByRank.get(rank).push(record);
    });
    const verticalScoreById = new Map();
    recordsByRank.forEach(records => {
      records.sort((left, right) => left.node.data.layoutOrder - right.node.data.layoutOrder);
      const centerIndex = (records.length - 1) / 2;
      records.forEach((record, index) => {
        verticalScoreById.set(record.node.data.id, index - centerIndex);
      });
    });
    const trackStateByBucket = new Map();
    const laneReserves = new Map();

    validRelations
      .sort((left, right) => left.index - right.index)
      .forEach(item => {
        const sourceRecord = behaviorRecordById.get(item.sourceId);
        const targetRecord = behaviorRecordById.get(item.targetId);
        const sourceRank = rankById.get(item.sourceId) || 0;
        const targetRank = rankById.get(item.targetId) || 0;
        const endpointKey = `${item.sourceId}->${item.targetId}`;
        const sourceNodeType = text(sourceRecord?.behavior?.node_type);
        const branchSource = (sourceNodeType === 'decision' || sourceNodeType === 'parallel_split')
          && (outgoingCount.get(item.sourceId) || 0) > 1;
        const backward = targetRank <= sourceRank;
        const crossesRanks = targetRank - sourceRank > 1;
        const duplicateRoute = (endpointCount.get(endpointKey) || 0) > 1;
        const parallelRelation = item.relation.relation_type === 'parallel';
        const sourceVerticalScore = verticalScoreById.get(item.sourceId) || 0;
        const targetVerticalScore = verticalScoreById.get(item.targetId) || 0;
        const branchVerticalDelta = targetVerticalScore - sourceVerticalScore;
        let routePlacement = 'direct';
        if (item.relation.relation_type === 'loop' || backward) {
          routePlacement = 'lower';
        } else if (duplicateRoute) {
          routePlacement = sourceVerticalScore > 0 ? 'lower' : 'upper';
        } else if (branchSource && !parallelRelation) {
          routePlacement = branchVerticalDelta < 0
            ? 'upper'
            : branchVerticalDelta > 0
              ? 'lower'
              : 'direct';
        } else if (crossesRanks) {
          routePlacement = sourceVerticalScore < 0
            ? 'upper'
            : sourceVerticalScore > 0
              ? 'lower'
              : targetVerticalScore < 0 ? 'upper' : 'lower';
        }
        const labelDisplay = edgeDisplayMetrics(relationLabel(item.relation));
        const sameLane = sourceRecord?.node.data.laneKey === targetRecord?.node.data.laneKey;
        let routeSlot = 0;
        let routeOffset = 0;
        let routeBucket = 'direct';
        if (routePlacement !== 'direct') {
          routeBucket = `${routePlacement}:${sameLane ? sourceRecord.node.data.laneKey : 'cross-lane'}`;
          const state = trackStateByBucket.get(routeBucket) || {
            count: 0,
            nextOffset: 0
          };
          routeSlot = state.count + 1;
          const sourceHalfHeight = (sourceRecord?.node.data.nodeHeight || 90) / 2;
          const targetHalfHeight = (targetRecord?.node.data.nodeHeight || 90) / 2;
          const baseClearance = Math.max(sourceHalfHeight, targetHalfHeight) + 42;
          routeOffset = Math.max(
            baseClearance + labelDisplay.labelHeight / 2,
            state.nextOffset + labelDisplay.labelHeight / 2
          );
          state.count = routeSlot;
          state.nextOffset = routeOffset + labelDisplay.labelHeight / 2 + routeTrackGap;
          trackStateByBucket.set(routeBucket, state);
          if (sameLane) {
            const laneKey = sourceRecord.node.data.laneKey;
            const reserve = laneReserves.get(laneKey) || { upper: 0, lower: 0 };
            reserve[routePlacement] = Math.max(
              reserve[routePlacement],
              routeOffset + labelDisplay.labelHeight / 2 + routeTrackGap
            );
            laneReserves.set(laneKey, reserve);
          }
        }
        item.route = {
          placement: routePlacement,
          slot: routeSlot,
          offset: Math.ceil(routeOffset),
          forwardBranch: routePlacement !== 'direct' && branchSource && !crossesRanks && !duplicateRoute,
          parallelOrthogonal: parallelRelation && routePlacement !== 'direct',
          bucket: routeBucket,
          trackKey: `${routeBucket}:${routeSlot}:${item.index}`,
          labelDisplay
        };
      });
    return laneReserves;
  }

  function relationEdge(item, behaviorRecordById, reviewRelationIndexes) {
    const sourceNode = behaviorRecordById.get(item.sourceId).node;
    const targetNode = behaviorRecordById.get(item.targetId).node;
    const crossLane = sourceNode.data.laneKey !== targetNode.data.laneKey;
    const route = item.route;
    const sourcePosition = sourceNode.position;
    const targetPosition = targetNode.position;
    const deltaX = targetPosition.x - sourcePosition.x;
    const deltaY = targetPosition.y - sourcePosition.y;
    const length = Math.max(1, Math.hypot(deltaX, deltaY));
    const normalX = -deltaY / length;
    const normalY = deltaX / length;
    const desiredVerticalDirection = route.placement === 'upper' ? -1 : 1;
    const normalDirection = normalY === 0 ? (deltaX >= 0 ? 1 : -1) : Math.sign(normalY);
    const signedOffset = route.placement === 'direct'
      ? 0
      : route.offset * desiredVerticalDirection / normalDirection;
    const orthogonalTrack = route.forwardBranch || route.parallelOrthogonal;
    const labelCenter = orthogonalTrack
      ? {
          x: (sourcePosition.x + targetPosition.x) / 2,
          y: sourcePosition.y + (route.placement === 'upper' ? -route.offset : route.offset)
        }
      : {
          x: (sourcePosition.x + targetPosition.x) / 2 + normalX * signedOffset,
          y: (sourcePosition.y + targetPosition.y) / 2 + normalY * signedOffset
        };
    const labelBounds = route.labelDisplay.labelWidth
      ? {
          x1: labelCenter.x - route.labelDisplay.labelWidth / 2,
          x2: labelCenter.x + route.labelDisplay.labelWidth / 2,
          y1: labelCenter.y - route.labelDisplay.labelHeight / 2,
          y2: labelCenter.y + route.labelDisplay.labelHeight / 2
        }
      : null;
    const edge = {
      group: 'edges',
      classes: [
        'flow-edge',
        `relation-${item.relation.relation_type}`,
        crossLane ? 'cross-lane-relation' : '',
        item.relation.relation_type === 'parallel'
          ? route.placement === 'direct' ? 'parallel-straight-edge' : 'parallel-orthogonal-edge'
          : '',
        route.forwardBranch ? 'route-forward-branch' : '',
        route.placement !== 'direct' ? `route-${route.placement}` : '',
        reviewRelationIndexes.has(item.index) ? 'relation-review' : ''
      ].filter(Boolean).join(' '),
      data: {
        id: graphRef('relation', item.index, item.relationRef),
        source: item.sourceId,
        target: item.targetId,
        label: route.labelDisplay.label,
        rawLabel: route.labelDisplay.rawLabel,
        labelWidth: route.labelDisplay.labelWidth,
        labelHeight: route.labelDisplay.labelHeight,
        labelLineCount: route.labelDisplay.lineCount,
        labelBounds,
        routePlacement: route.placement,
        routeSlot: route.slot,
        routeOffset: route.offset,
        taxiTurn: route.offset || 64,
        taxiDirection: route.placement === 'upper' ? 'upward' : 'downward',
        segmentDistances: [Math.round(signedOffset), Math.round(signedOffset)],
        segmentWeights: [0.18, 0.82],
        routeTrackKey: route.trackKey,
        needsRelationReview: reviewRelationIndexes.has(item.index),
        crossLane,
        focusKind: 'relation',
        focusRef: item.relationRef
      }
    };
    return edge;
  }

  function elementBounds(node) {
    if (!node?.position || !node?.data?.nodeWidth || !node?.data?.nodeHeight) return null;
    return {
      id: node.data.id,
      x1: node.position.x - node.data.nodeWidth / 2,
      x2: node.position.x + node.data.nodeWidth / 2,
      y1: node.position.y - node.data.nodeHeight / 2,
      y2: node.position.y + node.data.nodeHeight / 2
    };
  }

  function rectanglesOverlap(left, right) {
    return left.x1 < right.x2
      && left.x2 > right.x1
      && left.y1 < right.y2
      && left.y2 > right.y1;
  }

  function findLayoutCollisions(positionedNodes, localEdges) {
    const collisions = [];
    const nodeBounds = positionedNodes.map(elementBounds).filter(Boolean);
    nodeBounds.forEach((left, leftIndex) => {
      nodeBounds.slice(leftIndex + 1).forEach(right => {
        if (rectanglesOverlap(left, right)) collisions.push(`node:${left.id}:${right.id}`);
      });
    });
    const labelRecords = localEdges
      .filter(edge => edge.data.labelBounds)
      .map(edge => ({
        edge,
        bounds: edge.data.labelBounds
      }));
    labelRecords.forEach(({ edge, bounds }) => {
      nodeBounds.forEach(nodeBoundsItem => {
        if (nodeBoundsItem.id === edge.data.source || nodeBoundsItem.id === edge.data.target) return;
        if (rectanglesOverlap(bounds, nodeBoundsItem)) {
          collisions.push(`label-node:${edge.data.id}:${nodeBoundsItem.id}`);
        }
      });
    });
    labelRecords.forEach((left, leftIndex) => {
      labelRecords.slice(leftIndex + 1).forEach(right => {
        if (rectanglesOverlap(left.bounds, right.bounds)) {
          collisions.push(`label:${left.edge.data.id}:${right.edge.data.id}`);
        }
      });
    });
    return collisions;
  }

  function buildGraphModel(documentData, options = {}) {
    const data = documentData && typeof documentData === 'object' ? documentData : {};
    const collisionPass = Math.max(0, Math.min(6, Number(options.__collisionPass) || 0));
    const laneNodeGap = LANE_NODE_GAP + collisionPass * 28;
    const minColumnGap = MIN_COLUMN_GAP + collisionPass * 72;
    const routeTrackGap = ROUTE_TRACK_GAP + collisionPass * 18;
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
    const reviewItems = [];
    const behaviorNodeByRef = new Map();
    const behaviorRecordById = new Map();
    const behaviorRecords = [];
    const dataNameByRef = new Map(items(data.data_objects).map(item => [
      text(item.data_ref),
      text(item.data_name)
    ]));
    const orderById = new Map();
    let namedBehaviorCount = 0;
    let localEdgeCount = 0;

    items(data.behaviors).forEach((behavior, index) => {
      const behaviorRef = text(behavior.behavior_ref);
      const graphId = graphRef('behavior', index, behaviorRef);
      if (behaviorRef && !behaviorNodeByRef.has(behaviorRef)) behaviorNodeByRef.set(behaviorRef, graphId);
      if (text(behavior.behavior_name)) namedBehaviorCount += 1;
      const nodeType = text(behavior.node_type);
      const placement = actorPlacement(behavior, departmentOrder, dataNameByRef);
      const rawLabel = behaviorLabel(behavior, placement);
      const display = nodeDisplayMetrics(rawLabel, behaviorClass(nodeType));
      const crossDepartment = actorAssignmentMode(behavior) === 'fixed_department'
        && !placement.control
        && Boolean(owningDepartment)
        && placement.recognized
        && placement.laneKey !== owningDepartment;
      const node = {
        group: 'nodes',
        classes: `behavior-node node-${behaviorClass(nodeType)}${placement.dynamic ? ' dynamic-actor-node' : ''}${crossDepartment ? ' external-node cross-department-behavior' : ''}`,
        data: {
          id: graphId,
          label: display.label,
          rawLabel: display.rawLabel,
          nodeWidth: display.nodeWidth,
          nodeHeight: display.nodeHeight,
          textMaxWidth: display.textMaxWidth,
          labelWidth: display.labelWidth,
          labelHeight: display.labelHeight,
          labelLineCount: display.lineCount,
          labelLineHeight: display.lineHeight,
          labelVerticalPadding: display.verticalPadding,
          detail: placement.dynamic
            ? `运行时责任部门 · ${NODE_TYPES.has(nodeType) ? nodeType : '节点类型待判断'}`
            : crossDepartment
            ? `跨部门行为 · ${NODE_TYPES.has(nodeType) ? nodeType : '节点类型待判断'}`
            : NODE_TYPES.has(nodeType) ? nodeType : '节点类型待判断',
          focusKind: 'behavior',
          focusRef: behaviorRef,
          laneKey: placement.laneKey,
          laneLabel: placement.laneLabel,
          actorRole: placement.raw,
          layoutRank: 0,
          layoutOrder: index
        }
      };
      const record = { node, behavior, index, placement };
      behaviorRecords.push(record);
      behaviorRecordById.set(graphId, record);
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
    });

    const graphAnalysis = analyzeRelationGraph(
      behaviorRecords.map(record => record.node.data.id),
      validRelations,
      orderById
    );
    const rankById = graphAnalysis.rankById;
    validRelations.forEach(item => {
      if (!graphAnalysis.reviewRelationIndexes.has(item.index)) return;
      reviewItems.push({
        focusKind: 'relation',
        focusRef: item.relationRef,
        message: RELATION_CYCLE_REVIEW_MESSAGE
      });
    });
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
      const rawLabel = internalCallLabel(call);
      const display = nodeDisplayMetrics(rawLabel, 'internal');
      const callNode = {
        group: 'nodes',
        classes: 'internal-call-node',
        data: {
          id: callNodeId,
          label: display.label,
          rawLabel: display.rawLabel,
          nodeWidth: display.nodeWidth,
          nodeHeight: display.nodeHeight,
          textMaxWidth: display.textMaxWidth,
          labelWidth: display.labelWidth,
          labelHeight: display.labelHeight,
          labelLineCount: display.lineCount,
          labelLineHeight: display.lineHeight,
          labelVerticalPadding: display.verticalPadding,
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
      const callOutDisplay = edgeDisplayMetrics('调用内部流程');
      edges.push({
        group: 'edges',
        classes: 'flow-edge internal-call-edge',
        data: {
          id: graphRef('call-out', index, callRef),
          source: callerNodeId,
          target: callNodeId,
          label: callOutDisplay.label,
          rawLabel: callOutDisplay.rawLabel,
          labelWidth: callOutDisplay.labelWidth,
          labelHeight: callOutDisplay.labelHeight,
          labelLineCount: callOutDisplay.lineCount,
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
        const callReturnDisplay = edgeDisplayMetrics('调用完成后返回');
        edges.push({
          group: 'edges',
          classes: 'flow-edge internal-call-edge internal-return-edge',
          data: {
            id: graphRef('call-return', index, callRef),
            source: callNodeId,
            target: behaviorNodeByRef.get(returnRef),
            label: callReturnDisplay.label,
            rawLabel: callReturnDisplay.rawLabel,
            labelWidth: callReturnDisplay.labelWidth,
            labelHeight: callReturnDisplay.labelHeight,
            labelLineCount: callReturnDisplay.lineCount,
            focusKind: 'call',
            focusRef: callRef
          }
        });
      }
    });

    const laneRouteReserves = allocateRelationRoutes(
      validRelations,
      behaviorRecordById,
      rankById,
      routeTrackGap
    );
    const positionedNodes = [
      ...behaviorRecords.map(record => record.node),
      ...internalCallRecords.map(record => record.node)
    ];
    const laneKeys = buildLaneOrder(
      positionedNodes.map(node => node.data.laneKey),
      owningDepartment,
      departmentOrder
    );
    const maxRank = Math.max(0, ...positionedNodes.map(node => node.data.layoutRank || 0));
    const rankHalfWidths = Array.from({ length: maxRank + 1 }, (_value, rank) => {
      const halfWidths = positionedNodes
        .filter(node => (node.data.layoutRank || 0) === rank)
        .map(node => (node.data.nodeWidth || 188) / 2);
      return Math.max(94, ...halfWidths);
    });
    const rankPositions = [];
    rankPositions[0] = LANE_HEADER_WIDTH + 48 + rankHalfWidths[0];
    for (let rank = 1; rank <= maxRank; rank += 1) {
      const centerGap = Math.max(
        minColumnGap,
        rankHalfWidths[rank - 1]
          + rankHalfWidths[rank]
          + EDGE_LABEL_MAX_WIDTH
          + COLUMN_LABEL_CLEARANCE
      );
      rankPositions[rank] = rankPositions[rank - 1] + centerGap;
    }
    const lastRankX = rankPositions[maxRank] || rankPositions[0];
    const laneBodyWidth = Math.max(
      860,
      lastRankX + rankHalfWidths[maxRank] + 96 - LANE_HEADER_WIDTH
    );
    const poolWidth = LANE_HEADER_WIDTH + laneBodyWidth;
    let laneTop = POOL_TITLE_HEIGHT + 18;
    const laneMetadata = [];

    laneKeys.forEach((laneKey, laneIndex) => {
      const laneNodes = positionedNodes.filter(node => node.data.laneKey === laneKey);
      const nodesByRank = new Map();
      laneNodes.forEach(node => {
        const rank = node.data.layoutRank || 0;
        if (!nodesByRank.has(rank)) nodesByRank.set(rank, []);
        nodesByRank.get(rank).push(node);
      });
      nodesByRank.forEach(rankNodes =>
        rankNodes.sort((left, right) => left.data.layoutOrder - right.data.layoutOrder)
      );
      const stackHeightByRank = new Map();
      nodesByRank.forEach((rankNodes, rank) => {
        stackHeightByRank.set(
          rank,
          rankNodes.reduce((sum, node) => sum + (node.data.nodeHeight || 90), 0)
            + Math.max(0, rankNodes.length - 1) * laneNodeGap
        );
      });
      const contentHeight = Math.max(90, ...stackHeightByRank.values());
      const routeReserve = laneRouteReserves.get(laneKey) || { upper: 0, lower: 0 };
      const upperReserve = routeReserve.upper || 0;
      const lowerReserve = routeReserve.lower || 0;
      const laneHeight = Math.max(
        LANE_MIN_HEIGHT,
        upperReserve + contentHeight + lowerReserve + LANE_VERTICAL_PADDING * 2
      );
      const laneCenterY = laneTop + laneHeight / 2;
      const contentCenterY = laneTop + upperReserve + LANE_VERTICAL_PADDING + contentHeight / 2;
      const laneLabel = laneDisplayName(laneKey);
      laneMetadata.push({
        key: laneKey,
        label: laneLabel,
        index: laneIndex,
        top: laneTop,
        height: laneHeight,
        centerY: laneCenterY,
        contentCenterY,
        upperRouteReserve: upperReserve,
        lowerRouteReserve: lowerReserve
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
      backgrounds.push({
        group: 'nodes',
        classes: 'lane-focus-anchor-node',
        data: {
          id: `lane-focus-anchor:${laneIndex}`,
          width: LANE_HEADER_WIDTH,
          height: 36
        },
        position: {
          x: LANE_HEADER_WIDTH / 2,
          y: laneCenterY
        }
      });

      nodesByRank.forEach((rankNodes, rank) => {
        const stackHeight = stackHeightByRank.get(rank);
        let nodeTop = contentCenterY - stackHeight / 2;
        rankNodes.forEach(node => {
          const nodeHeight = node.data.nodeHeight || 90;
          node.position = {
            x: rankPositions[rank],
            y: nodeTop + nodeHeight / 2
          };
          nodeTop += nodeHeight + laneNodeGap;
        });
      });
      laneTop += laneHeight;
    });

    const localRelationEdges = validRelations.map(item =>
      relationEdge(item, behaviorRecordById, graphAnalysis.reviewRelationIndexes)
    );
    edges.push(...localRelationEdges);

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
          x: record.node.position.x + record.node.data.nodeWidth / 2 - 28,
          y: record.node.position.y - record.node.data.nodeHeight / 2 + 8
        }
      });
    });
    nodes.push(...countersignBadges);
    if (options.showAggregateBadges !== false) nodes.push(...aggregateBadges(data, behaviorRecords));

    const layoutNodes = nodes.filter(node =>
      node.position && Number.isFinite(node.data.nodeWidth) && Number.isFinite(node.data.nodeHeight)
    );
    const layoutCollisions = findLayoutCollisions(layoutNodes, localRelationEdges);

    if (layoutCollisions.length && collisionPass < 6) {
      return buildGraphModel(documentData, {
        ...options,
        __collisionPass: collisionPass + 1
      });
    }

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
      reviewItems,
      reviewCount: reviewItems.length,
      layout: {
        rankPositions,
        routeTracks: localRelationEdges.map(edge => ({
          relationRef: edge.data.focusRef,
          placement: edge.data.routePlacement,
          slot: edge.data.routeSlot,
          offset: edge.data.routeOffset,
          trackKey: edge.data.routeTrackKey,
          labelBounds: edge.data.labelBounds
        })),
        collisions: layoutCollisions,
        iterations: collisionPass
      },
      viewportSuggestion: {
        fullViewMinZoom: FULL_VIEW_MIN_ZOOM,
        initialRankMax: 1
      },
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
          'font-size': LANE_FONT_SIZE,
          'font-weight': 700,
          'text-wrap': 'wrap',
          'text-overflow-wrap': 'anywhere',
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
        selector: '.lane-focus-anchor-node',
        style: {
          width: 'data(width)',
          height: 'data(height)',
          opacity: 0,
          events: 'no',
          'overlay-opacity': 0,
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
          'font-size': POOL_TITLE_FONT_SIZE,
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
          width: 'data(nodeWidth)',
          height: 'data(nodeHeight)',
          shape: 'round-rectangle',
          'background-color': '#fffaf0',
          'border-color': '#8c3f33',
          'border-width': 2,
          color: '#2f302b',
          label: 'data(label)',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': NODE_FONT_SIZE,
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-overflow-wrap': 'anywhere',
          'text-max-width': 'data(textMaxWidth)',
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
          shape: 'diamond',
          'background-color': '#f5e5df'
        }
      },
      {
        selector: '.node-parallel-split, .node-parallel-join',
        style: {
          shape: 'diamond',
          'background-color': '#f3e7ca',
          'border-color': '#9b783d'
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
          'border-width': 5,
          'border-color': '#52665a',
          'background-color': '#e5eadf'
        }
      },
      {
        selector: '.external-node',
        style: {
          'border-style': 'dashed',
          'border-width': 2,
          'border-color': '#526973',
          'background-color': '#e7edef',
          'font-size': EXTERNAL_NODE_FONT_SIZE
        }
      },
      {
        selector: '.dynamic-actor-node',
        style: {
          'border-style': 'dashed',
          'border-width': 2,
          'border-color': '#5f6f8a',
          'background-color': '#e9edf4'
        }
      },
      {
        selector: '.countersign-badge',
        style: {
          width: 72,
          height: 30,
          shape: 'round-rectangle',
          'background-color': '#8c3f33',
          'border-width': 1,
          'border-color': '#fffaf0',
          color: '#ffffff',
          label: 'data(label)',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': BADGE_FONT_SIZE,
          'font-weight': 700,
          'text-valign': 'center',
          'text-halign': 'center',
          'overlay-opacity': 0,
          'z-index': 30,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: '.aggregate-badge',
        style: {
          width: 112,
          height: 26,
          shape: 'round-rectangle',
          'background-color': '#edf2ea',
          'border-width': 1,
          'border-color': '#71826c',
          color: '#34413a',
          label: 'data(label)',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': 11,
          'font-weight': 700,
          'text-valign': 'center',
          'text-halign': 'center',
          'overlay-opacity': 0,
          'z-index': 31,
          'z-index-compare': 'manual'
        }
      },
      {
        selector: '.form-aggregate-badge',
        style: {
          width: 78,
          'background-color': '#e8eef4',
          'border-color': '#6f8193',
          color: '#314455'
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
          'taxi-radius': 0,
          'line-style': 'solid',
          'line-color': '#5b625d',
          'target-arrow-color': '#5b625d',
          'target-arrow-shape': 'triangle',
          'target-arrow-fill': 'filled',
          'arrow-scale': 0.9,
          label: 'data(label)',
          color: '#454843',
          'font-family': '"Microsoft YaHei", "PingFang SC", sans-serif',
          'font-size': EDGE_FONT_SIZE,
          'font-weight': 600,
          'text-wrap': 'wrap',
          'text-overflow-wrap': 'anywhere',
          'text-max-width': 'data(labelWidth)',
          'text-background-color': '#fffdf8',
          'text-background-opacity': 0.96,
          'text-background-padding': 4,
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
        selector: '.cross-lane-relation',
        style: {
          width: 3,
          'line-color': '#526973',
          'target-arrow-color': '#526973',
          color: '#3f5660'
        }
      },
      {
        selector: '.route-upper',
        style: {
          'curve-style': 'segments',
          'segment-distances': 'data(segmentDistances)',
          'segment-weights': 'data(segmentWeights)'
        }
      },
      {
        selector: '.route-lower',
        style: {
          'curve-style': 'segments',
          'segment-distances': 'data(segmentDistances)',
          'segment-weights': 'data(segmentWeights)'
        }
      },
      {
        selector: '.route-forward-branch',
        style: {
          'curve-style': 'taxi',
          'taxi-turn': 'data(taxiTurn)',
          'taxi-turn-min-distance': 24,
          'taxi-radius': 0
        }
      },
      {
        selector: '.route-forward-branch.route-upper',
        style: {
          'taxi-direction': 'upward'
        }
      },
      {
        selector: '.route-forward-branch.route-lower',
        style: {
          'taxi-direction': 'downward'
        }
      },
      {
        selector: '.relation-loop',
        style: {
          'line-style': 'solid',
          'line-color': '#8c3f33',
          'target-arrow-color': '#8c3f33',
          color: '#7b2f27'
        }
      },
      {
        selector: '.internal-return-edge',
        style: {
          'curve-style': 'segments',
          'segment-distances': [-126, -126],
          'segment-weights': [0.18, 0.82],
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
          'curve-style': 'straight',
          'line-color': '#8a6a30',
          'target-arrow-color': '#8a6a30',
          color: '#6f5223'
        }
      },
      {
        selector: '.relation-parallel.parallel-orthogonal-edge',
        style: {
          'curve-style': 'taxi',
          'taxi-turn': 'data(taxiTurn)',
          'taxi-turn-min-distance': 24,
          'taxi-radius': 0
        }
      },
      {
        selector: '.relation-parallel.parallel-orthogonal-edge.route-upper',
        style: {
          'taxi-direction': 'upward'
        }
      },
      {
        selector: '.relation-parallel.parallel-orthogonal-edge.route-lower',
        style: {
          'taxi-direction': 'downward'
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
        selector: 'node:active, edge:active',
        style: {
          'overlay-color': '#9b783d',
          'overlay-opacity': 0.18,
          'overlay-padding': 8
        }
      }
    ];
  }

  function showInitialViewport(cy, model) {
    cy.resize();
    cy.fit(undefined, 34);
    const fullFitZoom = cy.zoom();
    if (fullFitZoom >= (model.viewportSuggestion?.fullViewMinZoom || FULL_VIEW_MIN_ZOOM)) {
      return {
        mode: 'full',
        fullFitZoom
      };
    }
    const laneHeaders = cy.nodes('.lane-focus-anchor-node');
    const firstColumns = cy.nodes('.behavior-node, .internal-call-node').filter(node =>
      Number(node.data('layoutRank')) <= (model.viewportSuggestion?.initialRankMax ?? 1)
    );
    const initialElements = laneHeaders.union(firstColumns);
    if (initialElements.length) {
      cy.fit(initialElements, 28);
      const renderedBox = initialElements.renderedBoundingBox();
      cy.panBy({ x: 28 - renderedBox.x1, y: 0 });
      return {
        mode: 'start',
        fullFitZoom
      };
    }
    return {
      mode: 'full',
      fullFitZoom
    };
  }

  function mount(options) {
    const container = options?.container;
    if (!container) throw new Error('缺少流程图画布。');
    const cytoscapeFactory = options.cytoscape
      || (typeof globalThis !== 'undefined' ? globalThis.cytoscape : null);
    if (typeof cytoscapeFactory !== 'function') throw new Error('流程图组件未加载。');
    const model = buildGraphModel(options.documentData, {
      departmentOrder: options.departmentOrder,
      showAggregateBadges: options.showAggregateBadges
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
      autounselectify: options.editable !== true,
      boxSelectionEnabled: false,
      userPanningEnabled: true,
      userZoomingEnabled: true,
      minZoom: 0.03,
      maxZoom: 1.8
    });
    cy.on('tap', '.behavior-node, .internal-call-node, .external-node, .countersign-badge, .aggregate-badge, edge', event => {
      const element = event.target;
      const focusKind = element.data('focusKind');
      const focusRef = element.data('focusRef');
      if (focusKind && typeof options.onFocus === 'function') options.onFocus(focusKind, focusRef);
    });
    cy.ready(() => {
      let viewport;
      if (options.viewport && Number.isFinite(options.viewport.zoom) && options.viewport.pan) {
        cy.zoom(options.viewport.zoom);
        cy.pan(options.viewport.pan);
        viewport = { mode: 'restored', fullFitZoom: options.viewport.zoom };
      } else {
        viewport = showInitialViewport(cy, model);
      }
      if (typeof options.onViewportModeChange === 'function') {
        options.onViewportModeChange(viewport);
      }
    });
    return {
      cy,
      model,
      fit() {
        cy.resize();
        cy.fit(undefined, 34);
        const viewport = {
          mode: 'full',
          fullFitZoom: cy.zoom()
        };
        if (typeof options.onViewportModeChange === 'function') {
          options.onViewportModeChange(viewport);
        }
        return viewport;
      },
      reset() {
        const viewport = showInitialViewport(cy, model);
        if (typeof options.onViewportModeChange === 'function') {
          options.onViewportModeChange(viewport);
        }
        return viewport;
      },
      viewport() {
        return { zoom: cy.zoom(), pan: cy.pan() };
      },
      restore(viewport) {
        if (!viewport || !Number.isFinite(viewport.zoom) || !viewport.pan) return this.reset();
        cy.zoom(viewport.zoom);
        cy.pan(viewport.pan);
        return { mode: 'restored', fullFitZoom: viewport.zoom };
      },
      destroy() {
        cy.destroy();
      }
    };
  }

  return {
    buildGraphModel,
    wrapDisplayText,
    nodeDisplayMetrics,
    mount
  };
});
