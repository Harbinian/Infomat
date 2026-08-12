(function attachStructureLearningScore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StructureLearningScore = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createStructureLearningScore() {
  'use strict';

  const NODE_TYPES = new Set(['action', 'decision', 'parallel_split', 'parallel_join']);
  const RELATION_TYPES = new Set(['sequence', 'condition', 'loop', 'parallel']);
  const AREA_TYPES = new Set(['基本信息', '明细清单']);
  const ACTOR_ASSIGNMENT_MODES = new Set(['fixed_department', 'company_wide', 'dynamic_from_data']);
  const PLACEHOLDER_PATTERN = /待(?:填写|补充|确认)/;
  const EXACT_PLACEHOLDER_PATTERN = /^(?:无|暂无|未知|不适用|N\/?A)$/i;

  const RULE = Object.freeze({
    id: 'structure-learning-score-v1',
    label: '结构化学习评分 v1（试行）',
    dimensions: Object.freeze([
      Object.freeze({
        key: 'technical',
        label: '技术结构',
        max: 15,
        description: '检查JSON解析、当前版本兼容、结构规则与技术引用、导出回读和内容保持。'
      }),
      Object.freeze({
        key: 'basic',
        label: '基础信息',
        max: 10,
        description: '检查发起部门、编制人、流程名称、归口部门、目的和范围。'
      }),
      Object.freeze({
        key: 'behavior',
        label: '业务行为',
        max: 25,
        description: '逐个检查节点类型、名称、执行岗位、流程入口说明和完成标准；进入条件及输入输出由流程关系和数据关系提供。'
      }),
      Object.freeze({
        key: 'relation',
        label: '行为关系',
        max: 20,
        description: '检查关系字段、节点覆盖、判断出口、回路条件和并行结构。'
      }),
      Object.freeze({
        key: 'dataHandoff',
        label: '数据与承接',
        max: 20,
      description: '数据对象占15分，跨部门待办（候选）占5分。'
      }),
      Object.freeze({
        key: 'form',
        label: '表单结构',
        max: 10,
      description: '检查表单状态、字段归属、明细表区分信息和字段内容。'
      })
    ]),
    technicalChecks: Object.freeze([
      Object.freeze({ key: 'parse', label: '序列化解析', points: 3 }),
      Object.freeze({ key: 'compatibility', label: '当前版本兼容', points: 3 }),
      Object.freeze({ key: 'validation', label: '结构规则及技术引用', points: 4 }),
      Object.freeze({ key: 'roundTrip', label: '导出回读', points: 3 }),
      Object.freeze({ key: 'preservation', label: '内容与引用保持', points: 2 })
    ]),
    chainCoefficients: Object.freeze([
      Object.freeze({ label: '0—1个行为', coefficient: 0.80 }),
      Object.freeze({ label: '2个行为', coefficient: 0.85 }),
      Object.freeze({ label: '3个行为', coefficient: 0.90 }),
      Object.freeze({ label: '4个行为', coefficient: 0.95 }),
      Object.freeze({ label: '5个及以上', coefficient: 1.00 })
    ]),
    grades: Object.freeze([
      Object.freeze({ grade: 'A', label: '90—100' }),
      Object.freeze({ grade: 'B', label: '75—89.9' }),
      Object.freeze({ grade: 'C', label: '60—74.9' }),
      Object.freeze({ grade: 'D', label: '低于60' })
    ])
  });

  function round(value, digits = 1) {
    const scale = 10 ** digits;
    return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
  }

  function text(value) {
    return value === null || value === undefined ? '' : String(value).trim();
  }

  function isPlaceholder(value) {
    const normalized = text(value);
    if (!normalized) return false;
    return PLACEHOLDER_PATTERN.test(normalized) || EXACT_PLACEHOLDER_PATTERN.test(normalized);
  }

  function complete(value) {
    if (typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.length > 0;
    const normalized = text(value);
    return Boolean(normalized) && !isPlaceholder(normalized);
  }

  function recognizedActor(value, departments) {
    const normalized = text(value);
    if (!complete(normalized)) return false;
    if (normalized === '全公司') return true;
    return departments
      .filter(department => department && department !== '全公司')
      .sort((left, right) => right.length - left.length)
      .some(department => normalized.startsWith(department) && complete(normalized.slice(department.length)));
  }

  function actorAssignmentMode(behavior) {
    const explicit = text(behavior?.actor_assignment_mode);
    if (ACTOR_ASSIGNMENT_MODES.has(explicit)) return explicit;
    return text(behavior?.current_actor_role) === '全公司' ? 'company_wide' : 'fixed_department';
  }

  function defaultIssueSuggestions(category, target = {}) {
    if (target.focusPath || (Array.isArray(target.focusPaths) && target.focusPaths.length)) {
      return ['点击本项返回对应位置，补充并核对页面高亮的字段。'];
    }
    if (['行为关系', '判断出口', '回路', '并行结构'].includes(category)) {
      return ['进入“流程步骤—流程关系”，补充并核对相关关系。'];
    }
    if (['数据对象', '数据时序'].includes(category)) {
      return ['进入“流程步骤—输出物与数据”，补充并核对相关数据对象。'];
    }
    if (category === '表单结构') {
      return ['进入“表单与记录”，补充并核对相关表单内容。'];
    }
    if (['跨部门待办（候选）', 'MDM平台承接待办'].includes(category)) {
      return ['进入“流程步骤—业务流程”，打开关联的跨部门业务并补充待办信息。'];
    }
    if (category === '基础信息') {
      return ['进入对应基本信息页面，补充页面标记的内容。'];
    }
    return ['点击本项返回对应位置，核对并补充相关内容。'];
  }

  function issue(category, message, target = {}, effect = '', suggestions = []) {
    const normalizedSuggestions = (Array.isArray(suggestions) ? suggestions : [suggestions])
      .map(text)
      .filter(Boolean);
    return {
      category,
      message,
      effect,
      suggestions: normalizedSuggestions.length ? normalizedSuggestions : defaultIssueSuggestions(category, target),
      editorSection: target.editorSection || '',
      processSection: target.processSection || '',
      focusKind: target.focusKind || '',
      focusRef: target.focusRef || '',
      focusPath: target.focusPath || '',
      focusPaths: Array.isArray(target.focusPaths) ? target.focusPaths : []
    };
  }

  function fieldTarget(target, focusPath) {
    return { ...target, focusPath };
  }

  function chainProfile(behaviors, validRelations) {
    const refs = behaviors.map(item => item.behavior_ref).filter(Boolean);
    if (!refs.length) {
      return { effectiveLength: 0, isolatedRefs: [], entryCount: 0, exitCount: 0, hasNonLoopCycle: false };
    }

    const nonLoopEdges = validRelations
      .filter(relation => relation.relation_type !== 'loop')
      .map(relation => [relation.from_behavior_ref, relation.to_behavior_ref]);
    const active = new Set(nonLoopEdges.flat());
    if (!nonLoopEdges.length) {
      return {
        effectiveLength: 1,
        isolatedRefs: refs.length > 1 ? refs : [],
        entryCount: refs.length,
        exitCount: refs.length,
        hasNonLoopCycle: false
      };
    }

    const activeRefs = refs.filter(ref => active.has(ref));
    const isolatedRefs = refs.filter(ref => !active.has(ref));
    const adjacency = new Map(activeRefs.map(ref => [ref, []]));
    const reverse = new Map(activeRefs.map(ref => [ref, []]));
    nonLoopEdges.forEach(([from, to]) => {
      if (!adjacency.has(from) || !adjacency.has(to)) return;
      adjacency.get(from).push(to);
      reverse.get(to).push(from);
    });

    let currentIndex = 0;
    const stack = [];
    const onStack = new Set();
    const indices = new Map();
    const lowlinks = new Map();
    const components = [];

    function strongConnect(node) {
      indices.set(node, currentIndex);
      lowlinks.set(node, currentIndex);
      currentIndex += 1;
      stack.push(node);
      onStack.add(node);
      (adjacency.get(node) || []).forEach(target => {
        if (!indices.has(target)) {
          strongConnect(target);
          lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(target)));
        } else if (onStack.has(target)) {
          lowlinks.set(node, Math.min(lowlinks.get(node), indices.get(target)));
        }
      });
      if (lowlinks.get(node) !== indices.get(node)) return;
      const component = [];
      while (stack.length) {
        const member = stack.pop();
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      components.push(component);
    }

    activeRefs.forEach(ref => {
      if (!indices.has(ref)) strongConnect(ref);
    });

    const componentIndex = new Map();
    components.forEach((component, componentId) => {
      component.forEach(ref => componentIndex.set(ref, componentId));
    });
    const dag = new Map(components.map((_, componentId) => [componentId, new Set()]));
    const indegree = new Map(components.map((_, componentId) => [componentId, 0]));
    let selfCycle = false;
    nonLoopEdges.forEach(([from, to]) => {
      const fromId = componentIndex.get(from);
      const toId = componentIndex.get(to);
      if (fromId === undefined || toId === undefined) return;
      if (fromId === toId) {
        if (from === to) selfCycle = true;
        return;
      }
      if (dag.get(fromId).has(toId)) return;
      dag.get(fromId).add(toId);
      indegree.set(toId, indegree.get(toId) + 1);
    });

    const queue = [...indegree.entries()]
      .filter(([, count]) => count === 0)
      .map(([componentId]) => componentId);
    const longest = new Map(
      components.map((component, componentId) => [componentId, component.length])
    );
    while (queue.length) {
      const componentId = queue.shift();
      dag.get(componentId).forEach(targetId => {
        longest.set(
          targetId,
          Math.max(longest.get(targetId), longest.get(componentId) + components[targetId].length)
        );
        indegree.set(targetId, indegree.get(targetId) - 1);
        if (indegree.get(targetId) === 0) queue.push(targetId);
      });
    }

    return {
      effectiveLength: Math.max(1, ...longest.values()),
      isolatedRefs,
      entryCount: activeRefs.filter(ref => (reverse.get(ref) || []).length === 0).length,
      exitCount: activeRefs.filter(ref => (adjacency.get(ref) || []).length === 0).length,
      hasNonLoopCycle: selfCycle || components.some(component => component.length > 1)
    };
  }

  function chainCoefficient(length) {
    if (length >= 5) return 1;
    if (length <= 1) return 0.8;
    return 0.75 + (0.05 * length);
  }

  function grade(score) {
    if (score >= 90) return 'A';
    if (score >= 75) return 'B';
    if (score >= 60) return 'C';
    return 'D';
  }

  function handoffDirection(item) {
    return item.handoff_direction || 'outbound_followup';
  }

  function handoffAnchorRef(item) {
    return item.anchor_behavior_ref || item.send_behavior_ref || null;
  }

  function handoffTransferDataRef(item) {
    return item.transfer_data_ref || item.input_data_ref || null;
  }

  function handoffCounterpartyResolved(item) {
    const direction = handoffDirection(item);
    const resolution = item.counterparty_resolution
      || (complete(direction === 'inbound_prerequisite' ? item.source_department : item.target_department)
        ? 'identified'
        : 'needs_identification');
    if (resolution === 'needs_identification') return true;
    if (resolution !== 'identified') return false;
    return complete(direction === 'inbound_prerequisite' ? item.source_department : item.target_department);
  }

  function isCompleteHandoff(item, behaviorRefs, dataRefs) {
    const transferDataRef = handoffTransferDataRef(item);
    return ['inbound_prerequisite', 'outbound_followup'].includes(handoffDirection(item))
      && behaviorRefs.has(handoffAnchorRef(item))
      && handoffCounterpartyResolved(item)
      && ((complete(transferDataRef) && dataRefs.has(transferDataRef)) || complete(item.requested_matter))
      && (complete(item.trigger_condition) || complete(item.completion_standard));
  }

  function parallelStructureDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const handoffs = Array.isArray(data.cross_department_handoffs) ? data.cross_department_handoffs : [];
    const behaviorRefs = new Set(behaviors.map(item => text(item.behavior_ref)).filter(Boolean));
    const splitBehaviors = behaviors.filter(item => item.node_type === 'parallel_split');
    const joinBehaviors = behaviors.filter(item => item.node_type === 'parallel_join');
    const parallelRelations = relations.filter(relation =>
      relation.relation_type === 'parallel'
      && behaviorRefs.has(text(relation.from_behavior_ref))
      && behaviorRefs.has(text(relation.to_behavior_ref))
    );
    const returningHandoffs = handoffs.filter(handoff =>
      handoffDirection(handoff) === 'outbound_followup'
      && handoff.requires_return === true
      && behaviorRefs.has(handoffAnchorRef(handoff))
      && behaviorRefs.has(text(handoff.resume_behavior_ref))
    );
    const splits = splitBehaviors.map(behavior => {
      const routeTargets = new Set(parallelRelations
        .filter(relation => text(relation.from_behavior_ref) === text(behavior.behavior_ref))
        .map(relation => text(relation.to_behavior_ref)));
      const sequenceRelations = relations.filter(relation =>
        relation.relation_type === 'sequence'
        && text(relation.from_behavior_ref) === text(behavior.behavior_ref)
        && behaviorRefs.has(text(relation.to_behavior_ref))
        && !routeTargets.has(text(relation.to_behavior_ref))
      );
      const routeCount = routeTargets.size;
      return {
        behavior,
        routeCount,
        missingCount: Math.max(0, 2 - routeCount),
        sequenceRelations
      };
    });
    const joins = joinBehaviors.map(behavior => {
      const relationSources = new Set(parallelRelations
        .filter(relation => text(relation.to_behavior_ref) === text(behavior.behavior_ref))
        .map(relation => text(relation.from_behavior_ref)));
      const handoffSources = new Set(returningHandoffs
        .filter(handoff => text(handoff.resume_behavior_ref) === text(behavior.behavior_ref))
        .map((handoff, index) => text(handoff.handoff_ref) || `handoff-${index}`));
      const relationSourceCount = relationSources.size;
      const handoffSourceCount = handoffSources.size;
      const sourceCount = relationSourceCount + handoffSourceCount;
      const sequenceRelations = relations.filter(relation =>
        relation.relation_type === 'sequence'
        && text(relation.to_behavior_ref) === text(behavior.behavior_ref)
        && behaviorRefs.has(text(relation.from_behavior_ref))
        && !relationSources.has(text(relation.from_behavior_ref))
      );
      return {
        behavior,
        relationSourceCount,
        handoffSourceCount,
        sourceCount,
        missingCount: Math.max(0, 2 - sourceCount),
        sequenceRelations
      };
    });
    return {
      hasParallel: splitBehaviors.length > 0 || joinBehaviors.length > 0 || parallelRelations.length > 0,
      missingSplit: parallelRelations.length > 0 && splitBehaviors.length === 0,
      missingJoin: parallelRelations.length > 0 && joinBehaviors.length === 0,
      splits,
      joins
    };
  }

  function quotedBehaviorLabels(relations, endpointKey, behaviors) {
    const labelsByRef = new Map(behaviors.map(item => [text(item.behavior_ref), text(item.behavior_name) || text(item.behavior_ref)]));
    return [...new Set(relations.map(relation => labelsByRef.get(text(relation[endpointKey]))).filter(Boolean))]
      .map(label => `“${label}”`)
      .join('、');
  }

  function relationTypeFocusPaths(candidateRelations, relations) {
    return candidateRelations
      .map(relation => relations.indexOf(relation))
      .filter(index => index >= 0)
      .map(index => `flow_relations.${index}.relation_type`);
  }

  function parallelSplitGuidance(detail, documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const label = text(detail?.behavior?.behavior_name) || text(detail?.behavior?.behavior_ref) || '并行开始节点';
    const candidates = Array.isArray(detail?.sequenceRelations) ? detail.sequenceRelations : [];
    const candidateTargets = new Set(candidates.map(relation => text(relation.to_behavior_ref)).filter(Boolean));
    const targetLabels = quotedBehaviorLabels(candidates, 'to_behavior_ref', behaviors);
    const missingAfterConversion = Math.max(0, 2 - (Number(detail?.routeCount) + candidateTargets.size));
    if (candidates.length) {
      const suggestions = [`将通往${targetLabels}的现有顺序关系改为“并行路线”。`];
      const focusPaths = relationTypeFocusPaths(candidates, relations);
      if (missingAfterConversion) {
        suggestions.push(`再新增${missingAfterConversion}条从本节点流向不同后续行为的并行路线。`);
      }
      return {
        message: `${label}已有${candidateTargets.size}条通往${targetLabels}的顺序关系，顺序关系不计入并行路线；当前有效并行路线为${detail.routeCount}条，规则要求至少2条。`,
        suggestions,
        target: {
          editorSection: 'process',
          processSection: 'relations',
          focusKind: 'relation',
          focusRef: text(candidates[0]?.relation_ref),
          focusPath: focusPaths[0] || '',
          focusPaths
        }
      };
    }
    return {
      message: `${label}当前有效并行路线为${detail.routeCount}条，规则要求至少2条。`,
      suggestions: [`新增${detail.missingCount}条从本节点流向不同后续行为的并行路线。`],
      target: { editorSection: 'process', processSection: 'relations' }
    };
  }

  function parallelJoinGuidance(detail, documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const label = text(detail?.behavior?.behavior_name) || text(detail?.behavior?.behavior_ref) || '并行汇合节点';
    const candidates = Array.isArray(detail?.sequenceRelations) ? detail.sequenceRelations : [];
    const candidateSources = new Set(candidates.map(relation => text(relation.from_behavior_ref)).filter(Boolean));
    const sourceLabels = quotedBehaviorLabels(candidates, 'from_behavior_ref', behaviors);
    const missingAfterConversion = Math.max(0, 2 - (Number(detail?.sourceCount) + candidateSources.size));
    const sourceBreakdown = `${detail.relationSourceCount}条并行路线来源、${detail.handoffSourceCount}个跨部门返回来源`;
    if (candidates.length) {
      const suggestions = [`将${sourceLabels}进入本节点的现有顺序关系改为“并行路线”。`];
      const focusPaths = relationTypeFocusPaths(candidates, relations);
      if (missingAfterConversion) {
        suggestions.push(`再补充${missingAfterConversion}个有效来源。`);
      }
      return {
        message: `${label}已有${candidateSources.size}条来自${sourceLabels}的顺序关系，顺序关系不计入并行汇合来源；当前共有${detail.sourceCount}个有效来源（${sourceBreakdown}），规则要求至少2个。`,
        suggestions,
        target: {
          editorSection: 'process',
          processSection: 'relations',
          focusKind: 'relation',
          focusRef: text(candidates[0]?.relation_ref),
          focusPath: focusPaths[0] || '',
          focusPaths
        }
      };
    }
    return {
      message: `${label}当前共有${detail.sourceCount}个有效来源（${sourceBreakdown}），规则要求至少2个。`,
      suggestions: [`补充${detail.missingCount}条以本节点为目标的并行路线。`],
      target: { editorSection: 'process', processSection: 'relations' }
    };
  }

  function dataFlowConsistencyDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const dataObjects = Array.isArray(data.data_objects) ? data.data_objects : [];
    const handoffs = Array.isArray(data.cross_department_handoffs) ? data.cross_department_handoffs : [];
    const behaviorRefs = new Set(behaviors.map(item => text(item.behavior_ref)).filter(Boolean));
    const adjacency = new Map([...behaviorRefs].map(ref => [ref, new Set()]));
    const incomingByBehavior = new Map([...behaviorRefs].map(ref => [ref, []]));

    relations.forEach(relation => {
      const fromRef = text(relation.from_behavior_ref);
      const toRef = text(relation.to_behavior_ref);
      if (!['sequence', 'condition', 'parallel'].includes(relation.relation_type)) return;
      if (!behaviorRefs.has(fromRef) || !behaviorRefs.has(toRef)) return;
      adjacency.get(fromRef).add(toRef);
      incomingByBehavior.get(toRef).push({ kind: 'relation', relation });
    });
    handoffs.forEach(handoff => {
      const direction = handoffDirection(handoff);
      const anchorRef = text(handoffAnchorRef(handoff));
      const counterpartyRef = text(handoff.counterparty_behavior_ref);
      const resumeRef = text(handoff.resume_behavior_ref);
      const hasLocalCounterparty = behaviorRefs.has(counterpartyRef) && counterpartyRef !== anchorRef;
      if (direction === 'inbound_prerequisite' && behaviorRefs.has(anchorRef)) {
        incomingByBehavior.get(anchorRef).push({ kind: 'inbound_handoff', handoff });
        if (hasLocalCounterparty) adjacency.get(counterpartyRef).add(anchorRef);
      }
      if (direction === 'outbound_followup' && behaviorRefs.has(anchorRef) && hasLocalCounterparty) {
        adjacency.get(anchorRef).add(counterpartyRef);
        incomingByBehavior.get(counterpartyRef).push({ kind: 'outbound_handoff', handoff });
      }
      if (
        direction === 'outbound_followup'
        && handoff.requires_return === true
        && behaviorRefs.has(anchorRef)
        && behaviorRefs.has(resumeRef)
      ) {
        adjacency.get(hasLocalCounterparty ? counterpartyRef : anchorRef).add(resumeRef);
        incomingByBehavior.get(resumeRef).push({ kind: 'returning_handoff', handoff });
      }
    });

    const reachability = new Map();
    function reachableFrom(startRef) {
      if (reachability.has(startRef)) return reachability.get(startRef);
      const reached = new Set();
      const queue = [...(adjacency.get(startRef) || [])];
      while (queue.length) {
        const nextRef = queue.shift();
        if (reached.has(nextRef)) continue;
        reached.add(nextRef);
        (adjacency.get(nextRef) || []).forEach(ref => {
          if (!reached.has(ref)) queue.push(ref);
        });
      }
      reachability.set(startRef, reached);
      return reached;
    }
    const canReach = (fromRef, toRef) => behaviorRefs.has(text(fromRef))
      && behaviorRefs.has(text(toRef))
      && reachableFrom(text(fromRef)).has(text(toRef));

    const dataDetails = dataObjects.map((item, dataIndex) => {
      const dataRef = text(item.data_ref);
      const canonicalProducerRef = text(item.produced_by_behavior_ref);
      const legacyProducerRefs = behaviors
        .filter(behavior => Array.isArray(behavior.output_data_refs) && behavior.output_data_refs.includes(dataRef))
        .map(behavior => text(behavior.behavior_ref))
        .filter(ref => behaviorRefs.has(ref));
      const producerRefs = [...new Set([
        ...(behaviorRefs.has(canonicalProducerRef) ? [canonicalProducerRef] : []),
        ...legacyProducerRefs
      ])];
      const effectiveProducerRef = behaviorRefs.has(canonicalProducerRef)
        ? canonicalProducerRef
        : producerRefs.length === 1 ? producerRefs[0] : '';
      const canonicalConsumerRefs = Array.isArray(item.consumed_by_behavior_refs)
        ? item.consumed_by_behavior_refs.map(text).filter(ref => behaviorRefs.has(ref))
        : [];
      const legacyConsumerRefs = behaviors
        .filter(behavior => Array.isArray(behavior.input_data_refs) && behavior.input_data_refs.includes(dataRef))
        .map(behavior => text(behavior.behavior_ref))
        .filter(ref => behaviorRefs.has(ref));
      const consumerRefs = [...new Set([...canonicalConsumerRefs, ...legacyConsumerRefs])];
      const availabilityStarts = [];
      handoffs.forEach(handoff => {
        const direction = handoffDirection(handoff);
        if (
          direction === 'inbound_prerequisite'
          && text(handoffTransferDataRef(handoff)) === dataRef
          && behaviorRefs.has(text(handoffAnchorRef(handoff)))
        ) {
          availabilityStarts.push(text(handoffAnchorRef(handoff)));
        }
        if (
          direction === 'outbound_followup'
          && handoff.requires_return === true
          && text(handoff.returned_data_ref) === dataRef
          && behaviorRefs.has(text(handoff.resume_behavior_ref))
        ) {
          availabilityStarts.push(text(handoff.resume_behavior_ref));
        }
      });
      const uniqueAvailabilityStarts = [...new Set(availabilityStarts)];
      const issues = [];
      if (!canonicalProducerRef && producerRefs.length > 1) {
        issues.push({
          reason: 'multiple_legacy_producers',
          dataRef,
          dataIndex,
          producerRefs,
          consumerRef: '',
          message: `${text(item.data_name) || `输出物与数据${dataIndex + 1}`}保留了${producerRefs.length}个历史产生行为，当前无法确定唯一产生行为。`,
          suggestions: ['进入“输出物与数据”，确认并保留唯一产生行为。']
        });
      }
      consumerRefs.forEach(consumerRef => {
        let reason = '';
        if (effectiveProducerRef) {
          if (consumerRef === effectiveProducerRef) reason = 'self_consumption';
          else {
            const producerBeforeConsumer = canReach(effectiveProducerRef, consumerRef);
            const consumerBeforeProducer = canReach(consumerRef, effectiveProducerRef);
            if (producerBeforeConsumer && consumerBeforeProducer) reason = 'non_loop_cycle';
            else if (consumerBeforeProducer) reason = 'future_data';
            else if (!producerBeforeConsumer) reason = 'unordered_data';
          }
        } else if (uniqueAvailabilityStarts.length) {
          const available = uniqueAvailabilityStarts.some(startRef => startRef === consumerRef || canReach(startRef, consumerRef));
          if (!available) {
            const consumerBeforeAvailability = uniqueAvailabilityStarts.some(startRef => canReach(consumerRef, startRef));
            reason = consumerBeforeAvailability ? 'before_external_return' : 'unordered_external_data';
          }
        }
        if (!reason) return;
        const dataLabel = text(item.data_name) || `输出物与数据${dataIndex + 1}`;
        const consumer = behaviors.find(behavior => text(behavior.behavior_ref) === consumerRef);
        const producer = behaviors.find(behavior => text(behavior.behavior_ref) === effectiveProducerRef);
        const consumerLabel = text(consumer?.behavior_name) || consumerRef;
        const producerLabel = text(producer?.behavior_name) || effectiveProducerRef;
        const reasonMessage = {
          self_consumption: `${dataLabel}由“${consumerLabel}”产生，不能同时作为该行为的输入`,
          future_data: `${dataLabel}由后续行为“${producerLabel}”产生，前序行为“${consumerLabel}”不能引用`,
          unordered_data: `${dataLabel}的产生行为“${producerLabel}”与使用行为“${consumerLabel}”没有明确先后关系，不能跨并行路线引用`,
          non_loop_cycle: `${dataLabel}的产生行为“${producerLabel}”与使用行为“${consumerLabel}”形成非回路循环，无法确认数据先后`,
          before_external_return: `${dataLabel}尚未在跨部门返回位置形成，前序行为“${consumerLabel}”不能引用`,
          unordered_external_data: `${dataLabel}的跨部门返回位置与使用行为“${consumerLabel}”没有明确先后关系，不能引用`
        }[reason];
        const reasonSuggestions = {
          self_consumption: [`从${dataLabel}的使用行为中移除“${consumerLabel}”。`],
          future_data: [
            `从${dataLabel}的使用行为中移除前序行为“${consumerLabel}”。`,
            `前序行为确实需要输入时，登记一个在“${consumerLabel}”开始前已经形成的数据。`
          ],
          unordered_data: [
            `两个行为确有先后顺序时，在流程关系中补充从“${producerLabel}”到“${consumerLabel}”的可达路径。`,
            `两个行为属于互不依赖的并行路线时，从${dataLabel}的使用行为中移除“${consumerLabel}”。`
          ],
          non_loop_cycle: ['先修正形成闭环的普通流程关系，再核对该数据的产生行为和使用行为。'],
          before_external_return: [`从${dataLabel}的使用行为中移除返回位置之前的“${consumerLabel}”。`],
          unordered_external_data: [
            `在流程关系中建立从跨部门返回位置到“${consumerLabel}”的可达路径。`,
            `两者没有先后依赖时，从${dataLabel}的使用行为中移除“${consumerLabel}”。`
          ]
        }[reason] || [];
        issues.push({
          reason,
          dataRef,
          dataIndex,
          producerRef: effectiveProducerRef,
          consumerRef,
          availabilityStarts: uniqueAvailabilityStarts,
          message: reasonMessage,
          suggestions: reasonSuggestions
        });
      });
      return {
        data: item,
        dataRef,
        dataIndex,
        canonicalProducerRef,
        producerRefs,
        effectiveProducerRef,
        canonicalConsumerRefs,
        legacyConsumerRefs,
        consumerRefs,
        availabilityStarts: uniqueAvailabilityStarts,
        issues
      };
    });
    const issues = dataDetails.flatMap(detail => detail.issues);
    function consumerIssue(dataRef, behaviorRef) {
      return dataDetails.find(detail => detail.dataRef === text(dataRef))?.issues
        .find(item => item.consumerRef === text(behaviorRef)) || null;
    }
    function isConsumerAvailable(dataRef, behaviorRef) {
      const detail = dataDetails.find(item => item.dataRef === text(dataRef));
      if (!detail || !behaviorRefs.has(text(behaviorRef))) return false;
      if (detail.issues.some(item => item.reason === 'multiple_legacy_producers')) return false;
      if (consumerIssue(dataRef, behaviorRef)) return false;
      const producerRef = detail.effectiveProducerRef;
      if (producerRef) {
        return producerRef !== text(behaviorRef)
          && canReach(producerRef, text(behaviorRef))
          && !canReach(text(behaviorRef), producerRef);
      }
      if (!detail.availabilityStarts.length) return true;
      return detail.availabilityStarts.some(startRef => startRef === text(behaviorRef) || canReach(startRef, text(behaviorRef)));
    }
    function isAvailableBeforeBehavior(dataRef, behaviorRef) {
      const detail = dataDetails.find(item => item.dataRef === text(dataRef));
      const normalizedBehaviorRef = text(behaviorRef);
      if (!detail || !behaviorRefs.has(normalizedBehaviorRef)) return false;
      if (detail.issues.some(item => item.reason === 'multiple_legacy_producers')) return false;
      if (detail.effectiveProducerRef) {
        return detail.effectiveProducerRef !== normalizedBehaviorRef
          && canReach(detail.effectiveProducerRef, normalizedBehaviorRef)
          && !canReach(normalizedBehaviorRef, detail.effectiveProducerRef);
      }
      if (!detail.availabilityStarts.length) return false;
      return detail.availabilityStarts.some(startRef =>
        startRef === normalizedBehaviorRef || canReach(startRef, normalizedBehaviorRef)
      );
    }
    return {
      adjacency,
      incomingByBehavior,
      canReach,
      dataDetails,
      issues,
      consumerIssue,
      isConsumerAvailable,
      isAvailableBeforeBehavior
    };
  }

  function evaluateContent(documentValue, options = {}) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const process = data.process || {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const dataObjects = Array.isArray(data.data_objects) ? data.data_objects : [];
    const handoffs = Array.isArray(data.cross_department_handoffs) ? data.cross_department_handoffs : [];
    const forms = Array.isArray(data.forms) ? data.forms : [];
    const departments = Array.isArray(options.departments) ? [...new Set(options.departments)] : [];
    const behaviorRefs = new Set(behaviors.map(item => item.behavior_ref).filter(Boolean));
    const dataRefs = new Set(dataObjects.map(item => item.data_ref).filter(Boolean));
    const issues = [];
    const previewIssues = [];

    const basicChecks = [
      [data.export_meta?.initiating_department, '未填写发起部门', { editorSection: 'basic', focusPath: 'export_meta.initiating_department' }],
      [data.export_meta?.compiler, '未填写编制人', { editorSection: 'basic', focusPath: 'export_meta.compiler' }],
      [process.process_name, '未填写流程名称', { editorSection: 'basic', focusPath: 'process.process_name' }],
      [process.owning_department, '未填写归口部门', { editorSection: 'basic', focusPath: 'process.owning_department' }],
      [process.purpose, '未填写流程目的', { editorSection: 'profile', focusPath: 'process.purpose' }],
      [process.scope, '未填写适用范围', { editorSection: 'profile', focusPath: 'process.scope' }]
    ];
    let basicPassed = 0;
    basicChecks.forEach(([value, message, target]) => {
      if (complete(value)) basicPassed += 1;
      else issues.push(issue('基础信息', message, target, '影响基础信息维度'));
    });
    const basicScore = 10 * (basicPassed / basicChecks.length);

    const dataFlowDetails = dataFlowConsistencyDetails(data);
    let behaviorPassed = 0;
    const behaviorTotal = Math.max(1, behaviors.length * 5);
    if (!behaviors.length) {
      issues.push(issue(
        '业务行为',
        '尚未添加流程节点',
        { editorSection: 'process', processSection: 'behaviors' },
        '业务行为维度0分'
      ));
    }
    behaviors.forEach((item, index) => {
      const label = item.behavior_name || `第${index + 1}项行为`;
      const target = {
        editorSection: 'process',
        processSection: 'behaviors',
        focusKind: 'behavior',
        focusRef: item.behavior_ref
      };
      const isControlNode = ['parallel_split', 'parallel_join'].includes(item.node_type);
      const hasDerivedEntry = (dataFlowDetails.incomingByBehavior.get(text(item.behavior_ref)) || []).length > 0;
      const assignmentMode = actorAssignmentMode(item);
      const actorDataRef = text(item.actor_department_data_ref);
      let actorAssignmentPassed = false;
      let actorAssignmentMessage = `${label}未选择执行部门`;
      let actorAssignmentFocusPath = `behaviors.${index}.current_actor_role`;
      if (assignmentMode === 'company_wide') {
        actorAssignmentPassed = true;
      } else if (assignmentMode === 'dynamic_from_data') {
        actorAssignmentFocusPath = `behaviors.${index}.actor_department_data_ref`;
        if (!actorDataRef || !dataRefs.has(actorDataRef)) {
          actorAssignmentMessage = `${label}未选择用于确定执行部门的前序数据`;
        } else if (!dataFlowDetails.isAvailableBeforeBehavior(actorDataRef, item.behavior_ref)) {
          actorAssignmentMessage = `${label}选择的执行部门来源数据尚未在本行为开始前形成`;
        } else if (!complete(item.actor_position_rule)) {
          actorAssignmentMessage = `${label}未填写执行岗位或责任人确定规则`;
          actorAssignmentFocusPath = `behaviors.${index}.actor_position_rule`;
        } else {
          actorAssignmentPassed = true;
        }
      } else {
        actorAssignmentPassed = recognizedActor(item.current_actor_role, departments);
        actorAssignmentMessage = complete(item.current_actor_role)
          ? `${label}未选择执行岗位`
          : `${label}未选择执行部门`;
      }
      const checks = [
        [NODE_TYPES.has(item.node_type), `${label}未选择节点类型`, fieldTarget(target, `behaviors.${index}.node_type`)],
        [complete(item.behavior_name), `第${index + 1}项行为未填写名称`, fieldTarget(target, `behaviors.${index}.behavior_name`)],
        [
          actorAssignmentPassed,
          actorAssignmentMessage,
          fieldTarget(target, actorAssignmentFocusPath)
        ],
        [
          hasDerivedEntry || complete(item.trigger),
          `${label}是流程入口，但未说明流程如何开始`,
          fieldTarget(target, `behaviors.${index}.trigger`)
        ],
        [
          isControlNode || complete(item.completion_standard),
          `${label}未填写完成标准`,
          fieldTarget(target, `behaviors.${index}.completion_standard`)
        ]
      ];
      checks.forEach(([passed, message, issueTarget]) => {
        if (passed) behaviorPassed += 1;
        else issues.push(issue('业务行为', message, issueTarget, '影响业务行为维度'));
      });
    });
    const behaviorScore = behaviors.length ? 25 * (behaviorPassed / behaviorTotal) : 0;

    const validRelations = relations.filter(relation =>
      RELATION_TYPES.has(relation.relation_type)
      && behaviorRefs.has(relation.from_behavior_ref)
      && behaviorRefs.has(relation.to_behavior_ref)
    );
    let relationFieldPassed = 0;
    const relationFieldTotal = relations.length * 3;
    relations.forEach((relation, index) => {
      const target = {
        editorSection: 'process',
        processSection: 'relations',
        focusKind: 'relation',
        focusRef: relation.relation_ref
      };
      const checks = [
        [
          RELATION_TYPES.has(relation.relation_type),
          `流程关系${index + 1}未选择关系类型`,
          fieldTarget(target, `flow_relations.${index}.relation_type`)
        ],
        [
          behaviorRefs.has(relation.from_behavior_ref),
          `流程关系${index + 1}未选择有效起点行为`,
          fieldTarget(target, `flow_relations.${index}.from_behavior_ref`)
        ],
        [
          behaviorRefs.has(relation.to_behavior_ref),
          `流程关系${index + 1}未选择有效目标行为`,
          fieldTarget(target, `flow_relations.${index}.to_behavior_ref`)
        ]
      ];
      checks.forEach(([passed, message, issueTarget]) => {
        if (passed) relationFieldPassed += 1;
        else issues.push(issue('行为关系', message, issueTarget, '影响关系字段子项'));
      });
      if (relation.relation_type === 'condition' && !complete(relation.condition)) {
        issues.push(issue(
          '判断出口',
          `流程关系${index + 1}已选择“判断分支”，但判断条件为空。`,
          fieldTarget(target, `flow_relations.${index}.condition`),
          '影响判断出口子项',
          ['填写进入目标行为必须满足的具体判断结果。']
        ));
      }
      if (relation.relation_type === 'loop' && !complete(relation.condition)) {
        issues.push(issue(
          '回路',
          `流程关系${index + 1}已选择“流程内部回路”，但回路触发条件为空。`,
          fieldTarget(target, `flow_relations.${index}.condition`),
          '影响回路子项',
          ['填写退回前序行为的具体触发条件。']
        ));
      }
    });
    const relationFieldScore = relations.length
      ? 8 * (relationFieldPassed / relationFieldTotal)
      : behaviors.length <= 1 ? 8 : 0;
    if (behaviors.length > 1 && !relations.length) {
      issues.push(issue(
        '行为关系',
        '多个业务行为之间尚未建立流程关系',
        { editorSection: 'process', processSection: 'relations' },
        '关系字段子项0分'
      ));
    }

    const touchedRefs = new Set(
      validRelations.flatMap(relation => [relation.from_behavior_ref, relation.to_behavior_ref])
    );
    const coverageScore = behaviors.length <= 1 ? 6 : 6 * (touchedRefs.size / behaviors.length);
    const profile = chainProfile(behaviors, validRelations);
    if (behaviors.length > 1) {
      profile.isolatedRefs.forEach(ref => {
        const index = behaviors.findIndex(item => item.behavior_ref === ref);
        const item = behaviors[index] || {};
        issues.push(issue(
          '行为关系',
          `${item.behavior_name || ref}未进入任何有效流程关系`,
          {
            editorSection: 'process',
            processSection: 'behaviors',
            focusKind: 'behavior',
            focusRef: ref
          },
          '影响节点覆盖和行为链长度'
        ));
      });
    }

    const decisionBehaviors = behaviors.filter(item => item.node_type === 'decision');
    let decisionPassed = 0;
    decisionBehaviors.forEach(item => {
      const localOutlets = validRelations.filter(relation =>
        relation.from_behavior_ref === item.behavior_ref
        && ['condition', 'sequence', 'loop'].includes(relation.relation_type)
      );
      const completeHandoffs = handoffs.filter(handoff =>
        handoffDirection(handoff) === 'outbound_followup'
        && handoffAnchorRef(handoff) === item.behavior_ref
        && isCompleteHandoff(handoff, behaviorRefs, dataRefs)
      );
      const usableLocalOutlets = localOutlets.filter(relation =>
        relation.relation_type === 'sequence' || complete(relation.condition)
      );
      const defaultSequenceRelations = localOutlets.filter(relation =>
        relation.relation_type === 'sequence' && !complete(relation.condition)
      );
      const defaultSequenceCount = defaultSequenceRelations.length;
      const outletCount = usableLocalOutlets.length + completeHandoffs.length;
      const passed = outletCount >= 2 && defaultSequenceCount <= 1;
      if (passed) {
        decisionPassed += 1;
        return;
      }
      const target = {
        editorSection: 'process',
        processSection: 'behaviors',
        focusKind: 'behavior',
        focusRef: item.behavior_ref
      };
      const label = item.behavior_name || item.behavior_ref || '判断节点';
      if (outletCount < 2) {
        issues.push(issue(
          '判断出口',
          `${label}当前只有${outletCount}条完整出口，判断节点至少需要2条。`,
          target,
          '影响判断出口子项',
          [`补充${2 - outletCount}条具有明确去向的判断出口。`]
        ));
      }
      if (defaultSequenceCount > 1) {
        defaultSequenceRelations.slice(1).forEach((relation, branchIndex) => {
          const relationIndex = relations.indexOf(relation);
          issues.push(issue(
            '判断出口',
            `${label}的流程关系${relationIndex + 1}形成第${branchIndex + 2}条默认继续路径，判断节点只能保留1条`,
            {
              editorSection: 'process',
              processSection: 'relations',
              focusKind: 'relation',
              focusRef: relation.relation_ref,
              focusPath: `flow_relations.${relationIndex}.relation_type`
            },
            '影响判断出口子项',
            [
              '需要保留该关系时，为它填写判断条件并改为“判断分支”。',
              '不需要保留该关系时，删除该默认继续关系。'
            ]
          ));
        });
      }
    });
    const decisionScore = decisionBehaviors.length
      ? 2 * (decisionPassed / decisionBehaviors.length)
      : 2;

    const loopRelations = validRelations.filter(relation => relation.relation_type === 'loop');
    const loopPassed = loopRelations.filter(relation => complete(relation.condition)).length;
    const loopScore = loopRelations.length ? 2 * (loopPassed / loopRelations.length) : 2;

    const parallelDetails = parallelStructureDetails(data);
    const hasParallel = parallelDetails.hasParallel;
    const parallelChecks = [];
    if (hasParallel) {
      parallelChecks.push(!parallelDetails.missingSplit, !parallelDetails.missingJoin);
      if (parallelDetails.missingSplit) {
        issues.push(issue(
          '并行结构',
          '当前存在并行路线，但业务流程中没有“并行开始（同时启动多条路线）”控制节点。',
          { editorSection: 'process', processSection: 'behaviors' },
          '影响并行结构子项',
          ['新增“并行开始”控制节点，并让现有并行路线从该节点发出。']
        ));
      }
      if (parallelDetails.missingJoin) {
        issues.push(issue(
          '并行结构',
          '当前存在并行路线，但业务流程中没有“并行汇合（等待多条路线完成）”控制节点。',
          { editorSection: 'process', processSection: 'behaviors' },
          '影响并行结构子项',
          ['新增“并行汇合”控制节点，并让需要等待的并行路线进入该节点。']
        ));
      }
      parallelDetails.splits.forEach(detail => {
        const passed = detail.routeCount >= 2;
        parallelChecks.push(passed);
        if (!passed) {
          const guidance = parallelSplitGuidance(detail, data);
          issues.push(issue(
            '并行结构',
            guidance.message,
            guidance.target,
            '影响并行结构子项',
            guidance.suggestions
          ));
        }
      });
      parallelDetails.joins.forEach(detail => {
        const passed = detail.sourceCount >= 2;
        parallelChecks.push(passed);
        if (!passed) {
          const guidance = parallelJoinGuidance(detail, data);
          issues.push(issue(
            '并行结构',
            guidance.message,
            guidance.target,
            '影响并行结构子项',
            guidance.suggestions
          ));
        }
      });
    }
    const parallelScore = hasParallel
      ? 2 * (parallelChecks.filter(Boolean).length / parallelChecks.length)
      : 2;
    const relationScore = relationFieldScore + coverageScore + decisionScore + loopScore + parallelScore;

    let dataScore = 0;
    if (!dataObjects.length) {
      issues.push(issue(
        '数据对象',
        '尚未登记结构化数据对象',
        { editorSection: 'process', processSection: 'data' },
        '数据对象子项0分；不要为得分虚构对象',
        [
          '流程确有结构化输入输出时，登记实际数据对象并关联产生行为和使用行为。',
          '流程没有结构化数据对象时，保留现状，不为提高分数虚构数据。'
        ]
      ));
    } else {
      let dataPassed = 0;
      const dataTotal = dataObjects.length * 3;
      dataObjects.forEach((item, index) => {
        const label = item.data_name || `输出物与数据${index + 1}`;
        const target = {
          editorSection: 'process',
          processSection: 'data',
          focusKind: 'data',
          focusRef: item.data_ref
        };
        const flowDetail = dataFlowDetails.dataDetails.find(detail => detail.data === item);
        const producerValid = Boolean(flowDetail?.effectiveProducerRef);
        const consumerValid = Boolean(flowDetail?.consumerRefs.length);
        const flowValid = !flowDetail?.issues.length;
        const checks = [
          [
            complete(item.data_name),
            `输出物与数据${index + 1}未填写名称`,
            fieldTarget(target, `data_objects.${index}.data_name`)
          ],
          [
            complete(item.description),
            `${label}未填写数据说明`,
            fieldTarget(target, `data_objects.${index}.description`)
          ],
          [
            (producerValid || consumerValid) && flowValid,
            producerValid || consumerValid ? `${label}存在不符合流程先后顺序的数据引用` : `${label}未关联产生行为或使用行为`,
            target
          ]
        ];
        checks.forEach(([passed, message, issueTarget]) => {
          if (passed) dataPassed += 1;
          else issues.push(issue('数据对象', message, issueTarget, '影响数据对象子项'));
        });
        flowDetail?.issues.forEach(flowIssue => {
          issues.push(issue(
            '数据时序',
            flowIssue.message,
            fieldTarget(target, `data_objects.${index}.consumed_by_behavior_refs`),
            '影响数据对象子项',
            flowIssue.suggestions
          ));
        });
      });
      dataScore = 15 * (dataPassed / dataTotal);
    }

    let handoffScore = 5;
    if (handoffs.length) {
      let handoffPassed = 0;
      const handoffTotal = handoffs.length * 5;
      handoffs.forEach((item, index) => {
        const target = {
          editorSection: 'process',
          processSection: 'handoffs',
          focusKind: 'handoff',
          focusRef: item.handoff_ref
        };
        const direction = handoffDirection(item);
        const anchorRef = handoffAnchorRef(item);
        const transferDataRef = handoffTransferDataRef(item);
        const counterpartyBehavior = behaviors.find(behavior =>
          text(behavior.behavior_ref) === text(item.counterparty_behavior_ref)
        );
        const checks = [
          [
            ['inbound_prerequisite', 'outbound_followup'].includes(direction),
          `跨部门待办（候选）${index + 1}未明确承接方向`,
            `cross_department_handoffs.${index}.handoff_direction`,
            ['根据跨部门业务在本流程中的位置，在“开始前提供”“完成后交给外部门”中选择一项。']
          ],
          [
            complete(anchorRef) && behaviorRefs.has(anchorRef),
          `跨部门待办（候选）${index + 1}未关联有效的本流程行为`,
            `cross_department_handoffs.${index}.anchor_behavior_ref`,
            ['选择与该跨部门业务直接关联的本流程行为。']
          ],
          [
            handoffCounterpartyResolved(item),
          `跨部门待办（候选）${index + 1}尚未说明承接部门是否明确`,
            `cross_department_handoffs.${index}.counterparty_resolution`,
            ['根据当前事实，在“已明确承接部门”“承接部门待明确”中选择一项。']
          ],
          [
            (complete(transferDataRef) && dataRefs.has(transferDataRef)) || complete(item.requested_matter),
          `跨部门待办（候选）${index + 1}未说明跨部门交界对象`,
            `cross_department_handoffs.${index}.requested_matter`,
            [
              '已有结构化数据时，在“传递数据”中选择对应数据。',
              '没有对应结构化数据时，填写承接部门具体需要办理的事项。'
            ]
          ],
          [
            complete(item.trigger_condition) || complete(item.completion_standard) || complete(counterpartyBehavior?.completion_standard),
          `跨部门待办（候选）${index + 1}没有可识别的触发条件和完成标准`,
            `cross_department_handoffs.${index}.trigger_condition`,
            ['补充不能由关联流程关系表达的触发条件，并在承接部门业务行为中填写完成标准。']
          ]
        ];
        checks.forEach(([passed, message, focusPath, suggestions]) => {
          if (passed) handoffPassed += 1;
      else issues.push(issue('跨部门待办（候选）', message, fieldTarget(target, focusPath), '影响跨部门待办子项', suggestions));
        });
      });
      handoffScore = 5 * (handoffPassed / handoffTotal);
    }
    const dataHandoffScore = dataScore + handoffScore;

    let formScore = 0;
    if (!forms.length) {
      issues.push(issue(
        '表单结构',
        '尚未登记结构化表单或记录',
        { editorSection: 'forms' },
        '表单结构维度0分；不要为得分虚构表单',
        [
          '流程实际使用表单或记录时，登记真实表单及其字段。',
          '流程没有表单或记录时，保留现状，不为提高分数虚构表单。'
        ]
      ));
    } else {
      const perFormScores = [];
      forms.forEach((form, formIndex) => {
        const formLabel = form.form_name || `第${formIndex + 1}项表单记录`;
        const formTarget = {
          editorSection: 'forms',
          focusKind: 'form',
          focusRef: form.form_ref
        };
        let current = 0;
        if (complete(form.form_name)) current += 2;
        else issues.push(issue(
          '表单结构',
          `第${formIndex + 1}项表单记录未填写名称`,
          fieldTarget(formTarget, `forms.${formIndex}.form_name`),
          '影响表单名称子项'
        ));

        if (form.form_design_state && form.form_design_state !== 'unspecified') current += 1.5;
        else issues.push(issue(
          '表单结构',
          `${formLabel}的表单状态待确认`,
          fieldTarget(formTarget, `forms.${formIndex}.form_design_state`),
          '影响表单状态子项'
        ));

        const areas = Array.isArray(form.areas) ? form.areas : [];
        const detailCount = areas.filter(area => area.area_type === '明细清单').length;
        const assignmentChecks = [];
        areas.forEach((area, areaIndex) => {
          const areaTarget = {
            editorSection: 'forms',
            focusKind: 'area',
            focusRef: area.area_ref
          };
          if (area.area_type === '明细清单' && detailCount > 1) {
            const passed = complete(area.area_title);
            assignmentChecks.push(passed);
            if (!passed) issues.push(issue(
              '表单结构',
              `${formLabel}的明细表标题暂缺，当前多张明细表无法区分`,
              fieldTarget(areaTarget, `forms.${formIndex}.areas.${areaIndex}.area_title`),
              '影响明细表区分信息子项'
            ));
          }
          (Array.isArray(area.items) ? area.items : []).forEach((item, itemIndex) => {
            const passed = AREA_TYPES.has(area.area_type);
            assignmentChecks.push(passed);
            if (!passed) issues.push(issue(
              '表单结构',
              `${formLabel}的字段“${item.item_name || `字段${itemIndex + 1}`}”归属待确认`,
              fieldTarget(areaTarget, `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.assignment`),
              '影响字段归属子项'
            ));
          });
        });
        current += 1.5 * (
          assignmentChecks.length ? assignmentChecks.filter(Boolean).length / assignmentChecks.length : 1
        );

        const itemChecks = [];
        areas.forEach((area, areaIndex) => {
          (Array.isArray(area.items) ? area.items : []).forEach((item, itemIndex) => {
            const itemTarget = {
              editorSection: 'forms',
              focusKind: 'area',
              focusRef: area.area_ref
            };
            const checks = [
              [
                complete(item.item_name),
                `${formLabel}的字段${itemIndex + 1}未填写名称`,
                `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.item_name`
              ],
              [
                complete(item.item_type),
                `${formLabel}的字段${itemIndex + 1}未选择类型`,
                `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.item_type`
              ],
              [
                typeof item.required === 'boolean',
                `${formLabel}的字段${itemIndex + 1}未明确是否必填`,
                `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.required`
              ]
            ];
            checks.forEach(([passed, message, focusPath]) => {
              itemChecks.push(passed);
              if (!passed) {
                issues.push(issue(
                  '表单结构',
                  message,
                  fieldTarget(itemTarget, focusPath),
                  '影响填写项子项'
                ));
              }
            });
          });
        });
        current += 5 * (
          itemChecks.length ? itemChecks.filter(Boolean).length / itemChecks.length : 0
        );
        perFormScores.push(current);
      });
      formScore = perFormScores.reduce((sum, value) => sum + value, 0) / perFormScores.length;
    }

    const missingDescriptions = behaviors.filter(item => !complete(item.behavior_description)).length;
    if (missingDescriptions) {
      previewIssues.push(issue(
        '后续评审预告',
        `${missingDescriptions}/${behaviors.length}个业务行为未填写“具体做什么”`,
        { editorSection: 'process', processSection: 'behaviors' },
        '本期不扣分；集中评审时关注每个行为实际执行的工作'
      ));
    }

    handoffs.forEach((item, index) => {
      const direction = handoffDirection(item);
      const target = {
        editorSection: 'process',
        processSection: 'handoffs',
        focusKind: 'handoff',
        focusRef: item.handoff_ref
      };
      const counterpartyBehavior = behaviors.find(behavior =>
        text(behavior.behavior_ref) === text(item.counterparty_behavior_ref)
      );
      if (!complete(item.counterparty_process_name)) {
        previewIssues.push(issue(
          'MDM平台承接待办',
        `跨部门待办（候选）${index + 1}未填写承接部门流程`,
          target,
          '本期不扣分；MDM平台审核导入后由对应部门补充',
          ['当前阶段可以保留该项；导入MDM平台后，由承接部门补充对应流程。']
        ));
      }
      if (!counterpartyBehavior && !complete(item.counterparty_behavior_name)) {
        previewIssues.push(issue(
          'MDM平台承接待办',
          `跨部门待办（候选）${index + 1}未填写承接部门业务行为`,
          target,
          '本期不扣分；承接部门业务行为需要继续补充',
          ['填写承接部门办理该事项时执行的业务动作。']
        ));
      }
      if (
        direction === 'outbound_followup'
        && item.requires_return
        && !complete(item.returned_data_ref)
      ) {
        previewIssues.push(issue(
          'MDM平台承接待办',
          `跨部门待办（候选）${index + 1}已要求返回，但未选择返回数据`,
          fieldTarget(target, `cross_department_handoffs.${index}.returned_data_ref`),
          '本期不扣分；返回数据需要继续补充',
          ['选择承接部门办理完成后返回本流程的数据。']
        ));
      }
      if (
        direction === 'outbound_followup'
        && item.requires_return
        && !complete(item.resume_behavior_ref)
      ) {
        previewIssues.push(issue(
          'MDM平台承接待办',
          `跨部门待办（候选）${index + 1}已要求返回，但未选择返回后的恢复位置`,
          fieldTarget(target, `cross_department_handoffs.${index}.resume_behavior_ref`),
          '本期不扣分；返回后的恢复位置需要继续补充',
          ['选择本流程收到返回结果后继续办理的行为。']
        ));
      }
    });

    const dimensions = {
      basic: round(basicScore),
      behavior: round(behaviorScore),
      relation: round(relationScore),
      dataHandoff: round(dataHandoffScore),
      form: round(formScore)
    };
    return {
      rule: RULE,
      dimensions,
      subtotal: round(Object.values(dimensions).reduce((sum, value) => sum + value, 0)),
      effectiveChainLength: profile.effectiveLength,
      chainCoefficient: chainCoefficient(profile.effectiveLength),
      issues,
      previewIssues
    };
  }

  function technicalResult(input = {}) {
    const checks = {
      parse: Boolean(input.checks?.parse),
      compatibility: Boolean(input.checks?.compatibility),
      validation: Boolean(input.checks?.validation),
      roundTrip: Boolean(input.checks?.roundTrip),
      preservation: Boolean(input.checks?.preservation)
    };
    const score = RULE.technicalChecks.reduce(
      (sum, item) => sum + (checks[item.key] ? item.points : 0),
      0
    );
    return {
      status: input.status || 'ready',
      checks,
      score: round(score),
      blocker: Object.values(checks).some(passed => !passed),
      errors: Array.isArray(input.errors) ? input.errors : [],
      message: text(input.message)
    };
  }

  function finalize(contentResult, technicalInput) {
    const technical = technicalResult(technicalInput);
    const dimensions = {
      technical: technical.status === 'ready' ? technical.score : null,
      ...contentResult.dimensions
    };
    if (technical.status !== 'ready') {
      return {
        ...contentResult,
        dimensions,
        technical,
        available: false,
        completenessScore: null,
        displayScore: null,
        grade: '',
        blocker: false
      };
    }

    const completenessScore = round(
      RULE.dimensions.reduce((sum, item) => sum + Number(dimensions[item.key] || 0), 0)
    );
    const displayBeforeCap = completenessScore * contentResult.chainCoefficient;
    const displayScore = round(
      technical.blocker ? Math.min(59, displayBeforeCap) : displayBeforeCap
    );
    const technicalIssues = technical.errors.map(error => issue(
      '技术结构',
      error.message || '技术结构检查未通过',
      error.target || {},
      '技术阻断；展示分最高59分'
    ));
    if (technical.blocker && !technicalIssues.length) {
      technicalIssues.push(issue(
        '技术结构',
        '当前流程未通过技术结构检查',
        {},
        '技术阻断；展示分最高59分'
      ));
    }
    return {
      ...contentResult,
      dimensions,
      technical,
      available: true,
      completenessScore,
      displayScore,
      grade: grade(displayScore),
      blocker: technical.blocker,
      issues: technicalIssues.concat(contentResult.issues)
    };
  }

  function semanticProjection(value) {
    if (!value || typeof value !== 'object') return value;
    const clone = JSON.parse(JSON.stringify(value));
    if (clone.export_meta && typeof clone.export_meta === 'object') {
      delete clone.export_meta.exported_at;
    }
    return clone;
  }

  function stableStringify(value) {
    if (Array.isArray(value)) {
      return `[${value.map(item => stableStringify(item)).join(',')}]`;
    }
    if (value && typeof value === 'object') {
      return `{${Object.keys(value)
        .sort()
        .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  }

  return Object.freeze({
    RULE,
    complete,
    isPlaceholder,
    chainProfile,
    chainCoefficient,
    grade,
    parallelStructureDetails,
    parallelSplitGuidance,
    parallelJoinGuidance,
    dataFlowConsistencyDetails,
    evaluateContent,
    technicalResult,
    finalize,
    semanticProjection,
    stableStringify
  });
}));
