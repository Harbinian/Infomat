(function attachStructureLearningScore(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.StructureLearningScore = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createStructureLearningScore() {
  'use strict';

  const NODE_TYPES = new Set(['action', 'decision', 'parallel_split', 'parallel_join']);
  const RELATION_TYPES = new Set(['sequence', 'condition', 'loop', 'parallel']);
  const AREA_TYPES = new Set(['基本信息', '明细清单']);
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
        description: '逐个检查节点类型、名称、执行岗位、触发或前置、输出结果和完成标准。'
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
        description: '数据对象占15分，跨部门承接占5分。'
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

  function issue(category, message, target = {}, effect = '') {
    return {
      category,
      message,
      effect,
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

  function fieldsTarget(target, focusPaths) {
    return { ...target, focusPaths };
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

    let behaviorPassed = 0;
    const behaviorTotal = Math.max(1, behaviors.length * 6);
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
      const checks = [
        [NODE_TYPES.has(item.node_type), `${label}未选择节点类型`, fieldTarget(target, `behaviors.${index}.node_type`)],
        [complete(item.behavior_name), `第${index + 1}项行为未填写名称`, fieldTarget(target, `behaviors.${index}.behavior_name`)],
        [
          recognizedActor(item.current_actor_role, departments),
          complete(item.current_actor_role) ? `${label}未选择执行岗位` : `${label}未选择执行部门`,
          fieldTarget(target, `behaviors.${index}.current_actor_role`)
        ],
        [
          complete(item.trigger) || complete(item.precondition),
          `${label}的触发条件和前置条件均为空，请至少填写一项`,
          fieldsTarget(target, [`behaviors.${index}.trigger`, `behaviors.${index}.precondition`])
        ],
        [
          complete(item.output_description),
          `${label}未填写输出结果`,
          fieldTarget(target, `behaviors.${index}.output_description`)
        ],
        [
          complete(item.completion_standard),
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
          `流程关系${index + 1}为判断分支，但未填写判断条件`,
          fieldTarget(target, `flow_relations.${index}.condition`),
          '影响判断出口子项'
        ));
      }
      if (relation.relation_type === 'loop' && !complete(relation.condition)) {
        issues.push(issue(
          '回路',
          `流程关系${index + 1}为流程内部回路，但未填写回路触发条件`,
          fieldTarget(target, `flow_relations.${index}.condition`),
          '影响回路子项'
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
          `${label}当前只有${outletCount}条完整出口，判断节点至少需要2条`,
          target,
          '影响判断出口子项'
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
            '影响判断出口子项'
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

    const splitBehaviors = behaviors.filter(item => item.node_type === 'parallel_split');
    const joinBehaviors = behaviors.filter(item => item.node_type === 'parallel_join');
    const parallelRelations = validRelations.filter(relation => relation.relation_type === 'parallel');
    const hasParallel = splitBehaviors.length > 0 || joinBehaviors.length > 0 || parallelRelations.length > 0;
    const parallelChecks = [];
    if (hasParallel) {
      parallelChecks.push(splitBehaviors.length > 0, joinBehaviors.length > 0);
      splitBehaviors.forEach(item => {
        parallelChecks.push(
          parallelRelations.filter(relation => relation.from_behavior_ref === item.behavior_ref).length >= 2
        );
      });
      joinBehaviors.forEach(item => {
        parallelChecks.push(
          parallelRelations.filter(relation => relation.to_behavior_ref === item.behavior_ref).length >= 2
        );
      });
      if (parallelChecks.some(passed => !passed)) {
        issues.push(issue(
          '并行结构',
          '并行分支、并行汇合或并行关系尚未形成完整结构',
          { editorSection: 'process', processSection: 'relations' },
          '影响并行结构子项'
        ));
      }
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
        '数据对象子项0分；不要为得分虚构对象'
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
        const producerValid = complete(item.produced_by_behavior_ref)
          && behaviorRefs.has(item.produced_by_behavior_ref);
        const consumerValid = Array.isArray(item.consumed_by_behavior_refs)
          && item.consumed_by_behavior_refs.some(ref => behaviorRefs.has(ref));
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
            producerValid || consumerValid,
            `${label}未关联产生行为或使用行为`,
            target
          ]
        ];
        checks.forEach(([passed, message, issueTarget]) => {
          if (passed) dataPassed += 1;
          else issues.push(issue('数据对象', message, issueTarget, '影响数据对象子项'));
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
        const checks = [
          [
            ['inbound_prerequisite', 'outbound_followup'].includes(direction),
            `跨部门承接${index + 1}未明确前置输入或后续承接方向`,
            `cross_department_handoffs.${index}.handoff_direction`
          ],
          [
            complete(anchorRef) && behaviorRefs.has(anchorRef),
            `跨部门承接${index + 1}未关联有效的本流程行为`,
            `cross_department_handoffs.${index}.anchor_behavior_ref`
          ],
          [
            handoffCounterpartyResolved(item),
            `跨部门承接${index + 1}既未明确外部门，也未标记待明确责任部门`,
            `cross_department_handoffs.${index}.counterparty_resolution`
          ],
          [
            (complete(transferDataRef) && dataRefs.has(transferDataRef)) || complete(item.requested_matter),
            `跨部门承接${index + 1}未说明传递数据或承接事项`,
            `cross_department_handoffs.${index}.requested_matter`
          ],
          [
            complete(item.trigger_condition) || complete(item.completion_standard),
            `跨部门承接${index + 1}未填写触发条件或完成标准`,
            `cross_department_handoffs.${index}.trigger_condition`
          ]
        ];
        checks.forEach(([passed, message, focusPath]) => {
          if (passed) handoffPassed += 1;
          else issues.push(issue('跨部门承接', message, fieldTarget(target, focusPath), '影响跨部门承接子项'));
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
        '表单结构维度0分；不要为得分虚构表单'
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
      if (!complete(item.counterparty_process_name) || !complete(item.counterparty_behavior_name)) {
        previewIssues.push(issue(
          'MDM平台承接待办',
          `跨部门承接${index + 1}的外部门流程或行为尚未补齐`,
          target,
          '本期不扣分；MDM平台审核导入后由对应部门补充'
        ));
      }
      if (
        direction === 'outbound_followup'
        && item.requires_return
        && (!complete(item.returned_data_ref) || !complete(item.resume_behavior_ref))
      ) {
        previewIssues.push(issue(
          'MDM平台承接待办',
          `跨部门承接${index + 1}已要求返回，但返回数据或本流程恢复行为尚未补齐`,
          target,
          '本期不扣分；MDM平台审核导入后继续完善'
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
    evaluateContent,
    technicalResult,
    finalize,
    semanticProjection,
    stableStringify
  });
}));
