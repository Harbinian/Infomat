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
  const CONCRETE_BUSINESS_ACTION_PATTERN = /(?:核对|比对|查验|检查|检验|测量|计算|统计|汇总|筛选|选择|查询|调取|读取|识别|判断|评审|审核|复核|审批|批准|确认|填写|填报|登记|录入|编制|创建|生成|修改|更新|补充|删除|作废|归档|保存|上传|下载|导出|打印|签署|盖章|提交|发送|下发|转交|移交|交接|接收|领取|发放|分配|安排|通知|反馈|退回|驳回|办理|处理|处置|验收|盘点|清点|入库|出库|结算|付款|开具|分析|拆分|合并|关联|匹配|标记|记录|维护|校验)/;
  const ABSTRACT_QUALITATIVE_PATTERNS = Object.freeze([
    Object.freeze({
      label: '确保……可以完成',
      pattern: /确保[^。；，,\n]{0,30}(?:可以|能够)?[^。；，,\n]{0,12}完成/
    }),
    Object.freeze({
      label: '保证……真实性、合理性等定性结果',
      pattern: /保证[^。；，,\n]{0,30}(?:真实性|合理性|准确性|完整性|有效性|合规性)/
    })
  ]);

  const RULE = Object.freeze({
    id: 'structure-learning-score-v5',
    label: '结构化学习评分 v5（process-governance-v7）',
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
        description: '逐个检查节点类型、行为名称是否写清主体、动作和对象，以及执行岗位、流程入口说明和完成标准；进入条件及输入输出由流程关系和数据关系提供。'
      }),
      Object.freeze({
        key: 'relation',
        label: '行为关系',
        max: 20,
        description: '检查关系字段、节点覆盖、判断出口、回路条件和并行结构。'
      }),
      Object.freeze({
        key: 'dataHandoff',
        label: '数据与跨部门行为',
        max: 20,
      description: '数据对象与生命周期占15分，检查信息类型、创建更新使用关系、可用时间，以及生命周期是否适用、业务使用状态、保管方式和确实适用的匿名处理状态；跨部门行为完整性占5分。'
      }),
      Object.freeze({
        key: 'form',
        label: '表单结构',
        max: 10,
      description: '检查表单状态、表单处理关系、字段归属、取值方式、明细表区分信息和字段内容。'
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

  const REVIEW_READINESS = Object.freeze({
    id: 'process-review-readiness-v7',
    label: '流程评审六方面标准',
    aspects: Object.freeze([
      Object.freeze({
        key: 'boundary',
        number: 1,
        label: '流程目的、范围和结束边界',
        description: '确认为什么启动、适用于什么范围、从哪里开始，以及在哪些业务结果形成后结束。',
        confirmations: Object.freeze([
          '归口部门确认流程目的和适用范围符合真实做法。',
          '确认流程入口条件，以及每个实际结束位置的完成结果。'
        ])
      }),
      Object.freeze({
        key: 'behavior',
        number: 2,
        label: 'A1业务行为和责任角色',
        description: '逐个确认做什么、由哪个部门和岗位执行，以及做到什么程度才算完成。',
        confirmations: Object.freeze([
          '逐个确认业务行为名称、执行部门、执行岗位和完成标准。',
          '动态责任部门必须说明前序数据和办理人员确定规则。'
        ])
      }),
      Object.freeze({
        key: 'behaviorExecutability',
        number: 3,
        label: '业务行为逐动作可执行性',
        description: '逐个核对“具体做什么”是否按实际顺序写清每个动作、处理对象和结果，使业务人员不需要猜测就能照着执行。',
        confirmations: Object.freeze([
          '每个业务行为都要在“具体做什么”中按实际顺序写清每个动作、处理对象和结果。',
          '不得用“确保……可以完成”“保证……真实性、合理性”等抽象或定性表述代替实际动作。',
          '责任主体、业务条件或处理对象变化时分开描述，不把多条责任链压在一句话中。'
        ])
      }),
      Object.freeze({
        key: 'routing',
        number: 4,
        label: '条件分支、退回和跨部门流转',
        description: '逐条确认流程如何向前、何时退回、并行路线如何汇合，以及跨部门行为之间如何流转。',
        confirmations: Object.freeze([
          '确认判断条件、退回条件、并行路线和返回位置符合真实做法。',
          '嵌套循环的每一层都必须有明确退出条件和退出去向；内层退出可以进入外层，最外层必须退出到循环外。',
          '并行路线必须全部进入同一个并行汇合；任一路线可能在汇合前中止整个流程时，不得使用并行。',
          '确认跨部门行为的执行部门、岗位、前后流程关系和数据关系；不能确认时保持待定。'
        ])
      }),
      Object.freeze({
        key: 'dataForm',
        number: 5,
        label: '表单、业务对象和数据输入输出',
        description: '逐项确认信息类型、创建更新使用关系、可用时间、来源线索、表单处理关系、字段归属和取值来源。',
        confirmations: Object.freeze([
          '表单有几张明细表就分别保留，主表字段和各明细表字段不得混合。',
          '表单字段只关联数据对象；字段值依赖其他流程时，核对来源部门、流程、行为、数据名称和当前可用位置。',
          '没有数据或表单时确认确实不适用，不为满足检查虚构对象。'
        ])
      }),
      Object.freeze({
        key: 'lifecycle',
        number: 6,
        label: '数据生命周期与异常处理',
        description: '按数据对象核对入口状态、当前流程路径上的生命周期事件、出口状态、作用范围、责任和异常处理。',
        confirmations: Object.freeze([
          '停用、作废和失效分别核对，不把系统删除当作业务生命周期动作。',
          '销毁、不可逆匿名化和全部记录处置必须人工核对触发、范围、责任和例外。',
          '当前流程没有覆盖对象的其他生命周期阶段时，不补造事实，也不因此扣分。'
        ])
      })
    ]),
    acceptance: Object.freeze([
      '业务部门逐项确认页面展示的是当前真实流程事实。',
      '当前文件符合process-governance-v7结构，稳定引用和导出回读检查通过。',
      '表单、字段和稳定引用在导入、修改、导出和重新导入后没有丢失。',
      '当场不能确认的事项另行记录缺少的依据和确认主体，不在JSON中伪造结论。'
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

  function behaviorNameCompleteness(behavior) {
    const name = text(behavior?.behavior_name);
    const nodeType = text(behavior?.node_type);
    if (nodeType && nodeType !== 'action') {
      return Object.freeze({
        complete: complete(name),
        missingSubject: false,
        missingAction: false,
        missingObject: false
      });
    }
    const matches = [...name.matchAll(new RegExp(CONCRETE_BUSINESS_ACTION_PATTERN.source, 'g'))];
    const completeMatch = matches.find(match => {
      const subject = name.slice(0, match.index).trim();
      const object = name.slice(match.index + match[0].length).trim();
      return Boolean(subject && object);
    });
    if (completeMatch) {
      return Object.freeze({
        complete: true,
        missingSubject: false,
        missingAction: false,
        missingObject: false
      });
    }
    const firstMatch = matches[0];
    return Object.freeze({
      complete: false,
      missingSubject: !firstMatch || !name.slice(0, firstMatch.index).trim(),
      missingAction: !firstMatch,
      missingObject: !firstMatch || !name.slice(firstMatch.index + firstMatch[0].length).trim()
    });
  }

  function lifecycleStateReview(lifecycle) {
    const applicability = text(lifecycle?.applicability);
    const reasonRecorded = complete(lifecycle?.decision_reason);
    if (applicability === 'not_applicable') {
      return Object.freeze({
        applicabilityResolved: true,
        businessValidityResolved: reasonRecorded,
        custodyAndIdentifiabilityResolved: reasonRecorded
      });
    }
    if (applicability !== 'applicable') {
      return Object.freeze({
        applicabilityResolved: false,
        businessValidityResolved: false,
        custodyAndIdentifiabilityResolved: false
      });
    }
    const states = [lifecycle?.entry_state]
      .concat((lifecycle?.routes || []).flatMap(route => [
        route?.exit_state,
        ...(route?.events || []).map(event => event?.result_state)
      ]))
      .filter(state => state && typeof state === 'object');
    const businessValidityResolved = states.length > 0
      && states.every(state => text(state.business_validity) && state.business_validity !== 'pending_confirmation');
    const custodyAndIdentifiabilityResolved = states.length > 0 && states.every(state => {
      const custodyResolved = text(state.custody) && state.custody !== 'pending_confirmation';
      const applicabilityValue = text(state.identifiability_applicability);
      const identifiabilityValue = text(state.identifiability);
      const identifiabilityResolved = applicabilityValue === 'applicable'
        ? ['identifiable', 'irreversibly_anonymized'].includes(identifiabilityValue)
        : applicabilityValue === 'not_applicable'
          ? identifiabilityValue === 'not_applicable'
          : false;
      return custodyResolved && identifiabilityResolved;
    });
    return Object.freeze({
      applicabilityResolved: true,
      businessValidityResolved,
      custodyAndIdentifiabilityResolved
    });
  }

  function advancedLifecycleChecklist(documentValue) {
    const checklist = [];
    (documentValue?.data_objects || []).forEach((dataObject, dataIndex) => {
      (dataObject?.lifecycle?.routes || []).forEach((route, routeIndex) => {
        (route?.events || []).forEach((event, eventIndex) => {
          const label = `${text(dataObject.data_name) || `数据对象${dataIndex + 1}`}的${text(event.action) || `事件${eventIndex + 1}`}`;
          const basePath = `data_objects.${dataIndex}.lifecycle.routes.${routeIndex}.events.${eventIndex}`;
          if (!event?.trigger || event.trigger.mode === 'pending_confirmation' || !complete(event.trigger.expression)) {
            checklist.push({ message: `${label}尚未写清触发条件`, focusPath: `${basePath}.trigger` });
          }
          if (!event?.target_scope || event.target_scope === 'pending_confirmation') {
            checklist.push({ message: `${label}尚未写清作用范围`, focusPath: `${basePath}.target_scope` });
          }
          if (!event?.responsibility || event.responsibility.mode === 'pending_confirmation') {
            checklist.push({ message: `${label}尚未写清责任确定方式`, focusPath: `${basePath}.responsibility` });
          }
          if (!complete(event?.exception_handling)) {
            checklist.push({ message: `${label}尚未说明发生异常时怎么处理`, focusPath: `${basePath}.exception_handling` });
          }
        });
      });
    });
    return checklist;
  }

  function behaviorExecutabilityDetails(documentValue) {
    const source = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(source.behaviors) ? source.behaviors : [];
    const issues = [];
    behaviors.forEach((behavior, index) => {
      if (text(behavior?.node_type) !== 'action') return;
      const description = text(behavior?.behavior_description);
      const behaviorLabel = text(behavior?.behavior_name) || `第${index + 1}项业务行为`;
      const base = {
        behavior,
        behaviorIndex: index,
        behaviorRef: text(behavior?.behavior_ref),
        behaviorLabel,
        description
      };
      if (!complete(description)) {
        issues.push({ ...base, reason: 'missing_description', matchedPattern: '' });
        return;
      }
      const abstractPattern = ABSTRACT_QUALITATIVE_PATTERNS.find(item => item.pattern.test(description));
      if (abstractPattern) {
        issues.push({
          ...base,
          reason: 'abstract_qualitative_description',
          matchedPattern: abstractPattern.label
        });
        return;
      }
      if (!CONCRETE_BUSINESS_ACTION_PATTERN.test(description)) {
        issues.push({ ...base, reason: 'no_concrete_action', matchedPattern: '' });
      }
    });
    return {
      actionCount: behaviors.filter(item => text(item?.node_type) === 'action').length,
      issues
    };
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

  function actorDepartment(value, departments) {
    const normalized = text(value);
    if (!normalized || normalized === '全公司') return '';
    return departments
      .filter(department => department && department !== '全公司')
      .sort((left, right) => right.length - left.length)
      .find(department => normalized === department || normalized.startsWith(department)) || '';
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
    if (category === '跨部门行为') {
      return ['在“业务流程”补充执行部门和岗位，并在“流程关系”中确认该行为的前后关系。'];
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

  function reviewAspectKey(item = {}) {
    const explicit = text(item.reviewAspect);
    if (REVIEW_READINESS.aspects.some(aspect => aspect.key === explicit)) return explicit;
    const message = text(item.message);
    const category = text(item.category);
    const editorSection = text(item.editorSection);
    const processSection = text(item.processSection);
    const focusPath = text(item.focusPath);
    if (
      explicit === 'lifecycle'
      || /^data_objects\.\d+\.lifecycle/.test(focusPath)
      || /生命周期|停用|重新启用|作废|失效|归档|销毁|匿名化/.test(category)
      || /生命周期|停用|重新启用|作废|失效|归档|销毁|匿名化/.test(message)
    ) return 'lifecycle';
    if (
      editorSection === 'forms'
      || processSection === 'data'
      || /^(?:data_objects|forms)\./.test(focusPath)
      || /数据对象|数据时序|表单结构|表单|字段/.test(category)
      || /输出物|数据时序|表单|明细表|主表|字段归属/.test(message)
    ) return 'dataForm';
    if (
      processSection === 'relations'
      || /^flow_relations\./.test(focusPath)
      || /countersign/.test(focusPath)
      || /行为关系|判断出口|回路|并行结构|跨部门/.test(category)
      || /判断|分支|回路|退回|并行|跨部门|交接|承接|待办|确认知悉/.test(message)
    ) return 'routing';
    if (
      editorSection === 'basic'
      || editorSection === 'profile'
      || /^(?:export_meta|process)\./.test(focusPath)
      || /behaviors\.\d+\.trigger$/.test(focusPath)
      || /流程入口|流程开始|结束位置|流程出口/.test(message)
    ) return 'boundary';
    if (
      processSection === 'behaviors'
      || /^behaviors\./.test(focusPath)
      || /业务行为/.test(category)
    ) return 'behavior';
    return 'boundary';
  }

  function reviewIssueIdentity(item = {}) {
    return [
      text(item.message),
      text(item.editorSection),
      text(item.processSection),
      text(item.focusKind),
      text(item.focusRef),
      text(item.focusPath),
      ...(Array.isArray(item.focusPaths) ? item.focusPaths.map(text) : [])
    ].join('::');
  }

  function evaluateReviewReadiness(documentValue, options = {}) {
    const source = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const businessIssues = Array.isArray(options.businessIssues) ? options.businessIssues : [];
    const technicalIssues = Array.isArray(options.technicalIssues) ? options.technicalIssues : [];
    const deduplicate = items => [...new Map(items.map(item => [reviewIssueIdentity(item), item])).values()];
    const normalizedBusinessIssues = deduplicate(businessIssues);
    const normalizedTechnicalIssues = deduplicate(technicalIssues);
    const technical = options.technical && typeof options.technical === 'object'
      ? options.technical
      : { status: 'pending', blocker: false };
    const aspects = REVIEW_READINESS.aspects.map(definition => {
      const aspectBusinessIssues = normalizedBusinessIssues.filter(item => reviewAspectKey(item) === definition.key);
      const aspectTechnicalIssues = normalizedTechnicalIssues.filter(item => reviewAspectKey(item) === definition.key);
      const status = aspectTechnicalIssues.length
        ? 'blocker'
        : aspectBusinessIssues.length
          ? 'prompt'
          : 'confirmation_required';
      return {
        ...definition,
        status,
        businessIssues: aspectBusinessIssues,
        technicalIssues: aspectTechnicalIssues,
        issueCount: aspectBusinessIssues.length + aspectTechnicalIssues.length,
        applicabilityNote: definition.key === 'dataForm' && !(source.data_objects || []).length && !(source.forms || []).length
          ? '当前JSON没有登记输出物、数据或表单。请部门确认确实不适用，不要为满足检查补造内容。'
          : ''
      };
    });
    const technicalStatus = text(technical.status) || 'pending';
    let operationStatus = 'ready';
    let operationLabel = '可下载并提交部门核对';
    if (technicalStatus === 'pending') {
      operationStatus = 'checking';
      operationLabel = '正在检查结构';
    } else if (technicalStatus === 'unavailable') {
      operationStatus = 'unavailable';
      operationLabel = '技术检查暂不可用';
    } else if (technical.blocker || normalizedTechnicalIssues.length) {
      operationStatus = 'blocker';
      operationLabel = '存在结构错误';
    } else if (normalizedBusinessIssues.length) {
      operationStatus = 'prompt';
      operationLabel = '有业务提示，可以下载';
    }
    return {
      ruleSetVersion: REVIEW_READINESS.id,
      operationStatus,
      operationLabel,
      businessIssueCount: normalizedBusinessIssues.length,
      technicalIssueCount: normalizedTechnicalIssues.length,
      aspects
    };
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

  function parallelStructureDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const behaviorRefs = new Set(behaviors.map(item => text(item.behavior_ref)).filter(Boolean));
    const splitBehaviors = behaviors.filter(item => item.node_type === 'parallel_split');
    const joinBehaviors = behaviors.filter(item => item.node_type === 'parallel_join');
    const parallelRelations = relations.filter(relation =>
      relation.relation_type === 'parallel'
      && behaviorRefs.has(text(relation.from_behavior_ref))
      && behaviorRefs.has(text(relation.to_behavior_ref))
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
      const relationSourceCount = relationSources.size;
      const sourceCount = relationSourceCount;
      const sequenceRelations = relations.filter(relation =>
        relation.relation_type === 'sequence'
        && text(relation.to_behavior_ref) === text(behavior.behavior_ref)
        && behaviorRefs.has(text(relation.from_behavior_ref))
        && !relationSources.has(text(relation.from_behavior_ref))
      );
      return {
        behavior,
        relationSourceCount,
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
    const sourceBreakdown = `${detail.relationSourceCount}条并行路线来源`;
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

  function createReviewForwardGraph(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const behaviorRefs = new Set(behaviors.map(item => text(item.behavior_ref)).filter(Boolean));
    const adjacency = new Map([...behaviorRefs].map(ref => [ref, []]));
    const reverse = new Map([...behaviorRefs].map(ref => [ref, []]));
    const edges = [];
    const addEdge = (fromRef, toRef, kind, source) => {
      const from = text(fromRef);
      const to = text(toRef);
      if (!behaviorRefs.has(from) || !behaviorRefs.has(to)) return;
      const edge = { from, to, kind, source };
      adjacency.get(from).push(edge);
      reverse.get(to).push({ ...edge, from: to, to: from });
      edges.push(edge);
    };

    relations.forEach(relation => {
      if (!['sequence', 'condition', 'parallel'].includes(relation.relation_type)) return;
      addEdge(relation.from_behavior_ref, relation.to_behavior_ref, 'relation', relation);
    });

    return { behaviors, relations, behaviorRefs, adjacency, reverse, edges };
  }

  function reachableDistanceMap(adjacency, startRef) {
    const start = text(startRef);
    const distances = new Map();
    if (!adjacency.has(start)) return distances;
    distances.set(start, 0);
    const queue = [start];
    while (queue.length) {
      const current = queue.shift();
      (adjacency.get(current) || []).forEach(edge => {
        if (distances.has(edge.to)) return;
        distances.set(edge.to, distances.get(current) + 1);
        queue.push(edge.to);
      });
    }
    return distances;
  }

  function loopExitDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const graph = createReviewForwardGraph(data);
    const loopRelations = graph.relations.filter(relation =>
      relation.relation_type === 'loop'
      && graph.behaviorRefs.has(text(relation.from_behavior_ref))
      && graph.behaviorRefs.has(text(relation.to_behavior_ref))
    );
    const loops = loopRelations.map(relation => {
      const sourceRef = text(relation.from_behavior_ref);
      const targetRef = text(relation.to_behavior_ref);
      const forward = reachableDistanceMap(graph.adjacency, targetRef);
      const backward = reachableDistanceMap(graph.reverse, sourceRef);
      const bodyRefs = new Set(
        [...forward.keys()].filter(ref => backward.has(ref))
      );
      bodyRefs.add(sourceRef);
      bodyRefs.add(targetRef);
      const hasForwardPath = sourceRef === targetRef || forward.has(sourceRef);
      const exitEdges = hasForwardPath
        ? (graph.adjacency.get(sourceRef) || []).filter(edge => !bodyRefs.has(edge.to))
        : [];
      return {
        relation,
        relationRef: text(relation.relation_ref),
        sourceRef,
        targetRef,
        hasForwardPath,
        bodyRefs,
        exitEdges,
        exitCount: exitEdges.length,
        nestedWithinRefs: []
      };
    });
    loops.forEach(inner => {
      inner.nestedWithinRefs = loops
        .filter(outer => outer !== inner && outer.bodyRefs.size > inner.bodyRefs.size)
        .filter(outer => [...inner.bodyRefs].every(ref => outer.bodyRefs.has(ref)))
        .map(outer => outer.relationRef);
    });
    return { loops };
  }

  function parallelRouteSafetyDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const graph = createReviewForwardGraph(data);
    const behaviorMap = new Map(graph.behaviors.map(item => [text(item.behavior_ref), item]));
    const joinRefs = graph.behaviors
      .filter(item => item.node_type === 'parallel_join')
      .map(item => text(item.behavior_ref))
      .filter(Boolean);
    const splits = graph.behaviors
      .filter(item => item.node_type === 'parallel_split')
      .map(split => {
        const splitRef = text(split.behavior_ref);
        const routeTargets = [...new Set(graph.relations
          .filter(relation => relation.relation_type === 'parallel' && text(relation.from_behavior_ref) === splitRef)
          .map(relation => text(relation.to_behavior_ref))
          .filter(ref => graph.behaviorRefs.has(ref)))];
        const distancesByRoute = routeTargets.map(routeRef => reachableDistanceMap(graph.adjacency, routeRef));
        const commonJoinCandidates = joinRefs
          .filter(joinRef => joinRef !== splitRef && distancesByRoute.every(distances => distances.has(joinRef)))
          .map(joinRef => {
            const distances = distancesByRoute.map(routeDistances => routeDistances.get(joinRef));
            return {
              joinRef,
              maximumDistance: Math.max(...distances),
              totalDistance: distances.reduce((sum, value) => sum + value, 0)
            };
          })
          .sort((left, right) =>
            left.maximumDistance - right.maximumDistance
            || left.totalDistance - right.totalDistance
            || joinRefs.indexOf(left.joinRef) - joinRefs.indexOf(right.joinRef)
          );
        const commonJoinRef = commonJoinCandidates[0]?.joinRef || '';
        const routes = routeTargets.map(routeTargetRef => {
          const visited = new Set();
          const queue = [routeTargetRef];
          const terminalRefs = new Set();
          while (queue.length) {
            const currentRef = queue.shift();
            if (visited.has(currentRef) || currentRef === commonJoinRef) continue;
            if (!commonJoinRef && behaviorMap.get(currentRef)?.node_type === 'parallel_join') continue;
            visited.add(currentRef);
            const outgoing = graph.adjacency.get(currentRef) || [];
            if (!outgoing.length) {
              terminalRefs.add(currentRef);
              continue;
            }
            outgoing.forEach(edge => {
              if (!visited.has(edge.to)) queue.push(edge.to);
            });
          }
          return {
            routeTargetRef,
            terminalRefs: [...terminalRefs]
          };
        });
        const terminalRefs = [...new Set(routes.flatMap(route => route.terminalRefs))];
        return {
          split,
          splitRef,
          routeTargets,
          routeCount: routeTargets.length,
          commonJoinRef,
          commonJoin: behaviorMap.get(commonJoinRef) || null,
          hasCommonJoin: Boolean(commonJoinRef),
          routes,
          terminalRefs,
          safe: routeTargets.length >= 2 && Boolean(commonJoinRef) && terminalRefs.length === 0
        };
      });
    return { splits };
  }

  function dataFlowConsistencyDetails(documentValue) {
    const data = documentValue && typeof documentValue === 'object' ? documentValue : {};
    const behaviors = Array.isArray(data.behaviors) ? data.behaviors : [];
    const relations = Array.isArray(data.flow_relations) ? data.flow_relations : [];
    const dataObjects = Array.isArray(data.data_objects) ? data.data_objects : [];
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
      const v4Links = Array.isArray(item.behavior_links) ? item.behavior_links : [];
      const v4CreateRefs = v4Links
        .filter(link => link?.operation === 'create')
        .map(link => text(link.behavior_ref))
        .filter(ref => behaviorRefs.has(ref));
      const v4PendingRefs = v4Links
        .filter(link => link?.operation === 'pending_confirmation')
        .map(link => text(link.behavior_ref))
        .filter(ref => behaviorRefs.has(ref));
      const canonicalProducerRef = v4CreateRefs.length === 1
        ? v4CreateRefs[0]
        : text(item.produced_by_behavior_ref);
      const modernDataModel = ['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version);
      const legacyProducerRefs = modernDataModel
        ? v4PendingRefs
        : behaviors
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
      const canonicalConsumerRefs = modernDataModel
        ? v4Links.filter(link => link?.operation === 'use').map(link => text(link.behavior_ref)).filter(ref => behaviorRefs.has(ref))
        : Array.isArray(item.consumed_by_behavior_refs)
          ? item.consumed_by_behavior_refs.map(text).filter(ref => behaviorRefs.has(ref))
          : [];
      const legacyConsumerRefs = modernDataModel
        ? []
        : behaviors
          .filter(behavior => Array.isArray(behavior.input_data_refs) && behavior.input_data_refs.includes(dataRef))
          .map(behavior => text(behavior.behavior_ref))
          .filter(ref => behaviorRefs.has(ref));
      const consumerRefs = [...new Set([...canonicalConsumerRefs, ...legacyConsumerRefs])];
      const availabilityStarts = [];
      const availableAtProcessStart = (item.source_relations || []).some(source => source?.availability_mode === 'process_start');
      (item.source_relations || []).forEach(source => {
        if (source?.availability_mode === 'at_behavior' && behaviorRefs.has(text(source.available_from_behavior_ref))) {
          availabilityStarts.push(text(source.available_from_behavior_ref));
        }
      });
      const uniqueAvailabilityStarts = [...new Set(availabilityStarts)];
      const issues = [];
      if (v4CreateRefs.length > 1 || (!canonicalProducerRef && producerRefs.length > 1)) {
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
        } else if (availableAtProcessStart) {
          reason = '';
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
          before_external_return: `${dataLabel}尚未在登记的数据可用位置形成，前序行为“${consumerLabel}”不能引用`,
          unordered_external_data: `${dataLabel}的可用位置与使用行为“${consumerLabel}”没有明确先后关系，不能引用`
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
          before_external_return: [`从${dataLabel}的使用行为中移除可用位置之前的“${consumerLabel}”。`],
          unordered_external_data: [
            `在流程关系中建立从数据可用位置到“${consumerLabel}”的可达路径。`,
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
        availableAtProcessStart,
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
      if (detail.availableAtProcessStart || !detail.availabilityStarts.length) return true;
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
      if (detail.availableAtProcessStart) return true;
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
    let behaviorTotal = 0;
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
      const isControlNode = ['decision', 'parallel_split', 'parallel_join'].includes(item.node_type);
      const nameReview = behaviorNameCompleteness(item);
      const hasDerivedEntry = (dataFlowDetails.incomingByBehavior.get(text(item.behavior_ref)) || [])
        .some(entry => entry.relation?.relation_type !== 'loop');
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
          isControlNode || nameReview.complete,
          `${label}的名称没有写清谁对什么做什么；请补齐主体、动作和对象，例如“编制人员编制产品制造大纲”`,
          fieldTarget(target, `behaviors.${index}.behavior_name`)
        ],
        [
          isControlNode || actorAssignmentPassed,
          actorAssignmentMessage,
          fieldTarget(target, actorAssignmentFocusPath)
        ],
        [
          isControlNode || hasDerivedEntry || complete(item.trigger),
          `${label}是流程入口，但未说明流程如何开始`,
          fieldTarget(target, `behaviors.${index}.trigger`)
        ],
        [
          isControlNode || complete(item.completion_standard),
          `${label}未填写完成标准`,
          fieldTarget(target, `behaviors.${index}.completion_standard`)
        ]
      ];
      behaviorTotal += checks.length;
      checks.forEach(([passed, message, issueTarget]) => {
        if (passed) behaviorPassed += 1;
        else issues.push(issue('业务行为', message, issueTarget, '影响业务行为维度'));
      });
    });
    const behaviorScore = behaviors.length ? 25 * (behaviorPassed / Math.max(1, behaviorTotal)) : 0;

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
      const usableLocalOutlets = localOutlets.filter(relation =>
        relation.relation_type === 'sequence' || complete(relation.condition)
      );
      const defaultSequenceRelations = localOutlets.filter(relation =>
        relation.relation_type === 'sequence' && !complete(relation.condition)
      );
      const defaultSequenceCount = defaultSequenceRelations.length;
      const outletCount = usableLocalOutlets.length;
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
      const dataTotal = dataObjects.length * 4;
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
            !['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version)
              || (complete(item.information_type) && item.information_type !== 'pending_confirmation'),
            `${label}的信息类型待确认`,
            fieldTarget(target, `data_objects.${index}.information_type`)
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
            fieldTarget(target, `data_objects.${index}.behavior_links`),
            '影响数据对象子项',
            flowIssue.suggestions
          ));
        });
      });
      const dataCoreScore = 12 * (dataPassed / dataTotal);
      let lifecyclePassed = 0;
      const lifecycleTotal = dataObjects.length * 3;
      dataObjects.forEach((item, index) => {
        if (data.schema_version !== 'process-governance-v7') {
          lifecyclePassed += 3;
          return;
        }
        const lifecycle = item.lifecycle;
        const label = item.data_name || `输出物与数据${index + 1}`;
        const target = {
          editorSection: 'process',
          processSection: 'data',
          focusKind: 'data',
          focusRef: item.data_ref,
          focusPath: `data_objects.${index}.lifecycle`,
          reviewAspect: 'lifecycle'
        };
        const lifecycleReview = lifecycleStateReview(lifecycle);
        if (lifecycleReview.applicabilityResolved) lifecyclePassed += 1;
        else issues.push(issue('数据生命周期', `${label}尚未回答当前流程会不会改变这条数据的状态或保管方式`, target, '影响生命周期核对子项'));
        if (lifecycleReview.businessValidityResolved) lifecyclePassed += 1;
        else if (lifecycleReview.applicabilityResolved) issues.push(issue(
          '数据生命周期',
          lifecycle?.applicability === 'not_applicable'
            ? `${label}已选择“不改变”，但尚未记录原因`
            : `${label}尚未说明业务上还能不能使用`,
          target,
          '影响生命周期核对子项'
        ));
        if (lifecycleReview.custodyAndIdentifiabilityResolved) lifecyclePassed += 1;
        else if (lifecycleReview.applicabilityResolved) issues.push(issue(
          '数据生命周期',
          lifecycle?.applicability === 'not_applicable'
            ? `${label}已选择“不改变”，但尚未记录原因`
            : `${label}尚未说明怎么保管，或尚未回答确实适用的匿名处理问题`,
          target,
          '影响生命周期核对子项；高级结构核对内容不计分'
        ));
      });
      dataScore = dataCoreScore + 3 * (lifecyclePassed / lifecycleTotal);
    }

    const ownerDepartment = text(process.owning_department);
    const crossDepartmentBehaviors = behaviors.filter(item => {
      if (actorAssignmentMode(item) !== 'fixed_department') return false;
      const department = actorDepartment(item.current_actor_role, departments);
      return Boolean(ownerDepartment && department && department !== ownerDepartment);
    });
    let crossDepartmentScore = 5;
    if (crossDepartmentBehaviors.length) {
      let crossDepartmentPassed = 0;
      const crossDepartmentTotal = crossDepartmentBehaviors.length * 3;
      crossDepartmentBehaviors.forEach(item => {
        const index = behaviors.indexOf(item);
        const label = text(item.behavior_name) || `第${index + 1}项行为`;
        const department = actorDepartment(item.current_actor_role, departments);
        const target = {
          editorSection: 'process', processSection: 'behaviors', focusKind: 'behavior', focusRef: item.behavior_ref
        };
        const checks = [
          [complete(department), `${label}未选择有效执行部门`, `behaviors.${index}.current_actor_role`],
          [recognizedActor(item.current_actor_role, departments), `${label}未选择有效执行岗位`, `behaviors.${index}.current_actor_role`],
          [validRelations.some(relation => relation.from_behavior_ref === item.behavior_ref || relation.to_behavior_ref === item.behavior_ref), `${label}尚未建立有效流程关系`, '']
        ];
        checks.forEach(([passed, message, focusPath]) => {
          if (passed) crossDepartmentPassed += 1;
          else issues.push(issue(
            '跨部门行为', message,
            focusPath ? fieldTarget(target, focusPath) : { editorSection: 'process', processSection: 'relations' },
            '影响跨部门行为完整性子项'
          ));
        });
      });
      crossDepartmentScore = 5 * (crossDepartmentPassed / crossDepartmentTotal);
    }
    const dataHandoffScore = dataScore + crossDepartmentScore;

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
        const formBehaviorLinks = Array.isArray(form.behavior_links) ? form.behavior_links : [];
        const formBehaviorPassed = !['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version) || (
          formBehaviorLinks.length > 0
          && formBehaviorLinks.every(link => behaviorRefs.has(text(link.behavior_ref)) && Array.isArray(link.operations) && link.operations.length > 0)
        );
        assignmentChecks.push(formBehaviorPassed);
        if (!formBehaviorPassed) issues.push(issue(
          '表单结构',
          `${formLabel}尚未确认由哪些行为按什么方式处理`,
          fieldTarget(formTarget, `forms.${formIndex}.behavior_links`),
          '影响表单关系子项'
        ));
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
              ],
              [
                !['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version)
                  || (item.value_origin_mode && item.value_origin_mode !== 'pending_confirmation'),
                `${formLabel}的字段${itemIndex + 1}取值方式待确认`,
                `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.value_origin_mode`
              ],
              [
                !['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version)
                  || item.value_origin_mode !== 'depends_on_data'
                  || (Array.isArray(item.source_links) && item.source_links.length > 0),
                `${formLabel}的字段${itemIndex + 1}选择依赖数据但未登记来源`,
                `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.source_links`
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
            if (['process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data.schema_version)) {
              (Array.isArray(item.source_links) ? item.source_links : []).forEach((link, linkIndex) => {
                const externalSystemSource = link.source_type === 'external_system';
                const sourceComplete = externalSystemSource
                  ? complete(link.source_system_name) && complete(link.source_data_name)
                  : complete(link.source_data_ref);
                itemChecks.push(sourceComplete);
                if (!sourceComplete) {
                  issues.push(issue(
                    '表单结构',
                    externalSystemSource
                      ? `${formLabel}的字段${itemIndex + 1}未完整填写外部系统和来源数据名称`
                      : `${formLabel}的字段${itemIndex + 1}未选择本流程来源数据`,
                    fieldTarget(
                      itemTarget,
                      externalSystemSource
                        ? `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.source_links.${linkIndex}.source_system_name`
                        : `forms.${formIndex}.areas.${areaIndex}.items.${itemIndex}.source_links.${linkIndex}.source_data_ref`
                    ),
                    '影响填写项子项'
                  ));
                }
              });
            }
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
    REVIEW_READINESS,
    behaviorNameCompleteness,
    behaviorExecutabilityDetails,
    lifecycleStateReview,
    advancedLifecycleChecklist,
    complete,
    isPlaceholder,
    chainProfile,
    chainCoefficient,
    grade,
    parallelStructureDetails,
    parallelSplitGuidance,
    parallelJoinGuidance,
    loopExitDetails,
    parallelRouteSafetyDetails,
    dataFlowConsistencyDetails,
    evaluateContent,
    technicalResult,
    finalize,
    reviewAspectKey,
    evaluateReviewReadiness,
    semanticProjection,
    stableStringify
  });
}));
