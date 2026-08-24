(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LifecycleAnalyzer = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createLifecycleAnalyzer() {
  'use strict';

  const ANALYZER_VERSION = 'lifecycle-analysis-v1';
  const PROTECTED_REVIEW_STATUSES = new Set(['confirmed', 'needs_recheck', 'not_applicable', 'rejected']);
  const ACTION_LABELS = {
    activate: '生效',
    deactivate: '停用',
    reactivate: '重新启用',
    void: '作废',
    expire: '失效',
    archive: '归档',
    restore_active_custody: '恢复在用保管',
    destroy: '销毁',
    irreversible_anonymize: '不可逆匿名化'
  };
  const ACTION_RULES = [
    { action: 'irreversible_anonymize', pattern: /不可逆匿名化|永久匿名化/ },
    { action: 'restore_active_custody', pattern: /恢复在用保管|恢复在用状态/ },
    { action: 'reactivate', pattern: /重新启用|恢复有效|恢复业务效力/ },
    { action: 'deactivate', pattern: /停用|暂停业务使用/ },
    { action: 'void', pattern: /作废|取消业务效力/ },
    { action: 'expire', pattern: /失效|期限届满|到期失效/ },
    { action: 'archive', pattern: /归档|转为归档保管/ },
    { action: 'destroy', pattern: /销毁|受控销毁/ },
    { action: 'activate', pattern: /首次生效|正式生效|生效|启用/ }
  ];

  function text(value) {
    return value == null ? '' : String(value);
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function stableRef(prefix, ...parts) {
    const input = parts.map(part => text(part)).join('|');
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `${prefix}_${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== 'object') return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }

  function fingerprint(value) {
    return stableRef('fingerprint', JSON.stringify(canonicalize(value))).replace(/^fingerprint_/, 'fnv1a32:');
  }

  function pendingState() {
    return {
      business_validity: 'pending_confirmation',
      custody: 'pending_confirmation',
      identifiability_applicability: 'pending_confirmation',
      identifiability: 'pending_confirmation'
    };
  }

  function stateWithoutAnonymousProcessing() {
    return {
      business_validity: 'pending_confirmation',
      custody: 'pending_confirmation',
      identifiability_applicability: 'not_applicable',
      identifiability: 'not_applicable'
    };
  }

  function resultStateFor(action) {
    const state = action === 'irreversible_anonymize'
      ? pendingState()
      : stateWithoutAnonymousProcessing();
    if (action === 'activate' || action === 'reactivate') state.business_validity = 'effective';
    if (action === 'deactivate') state.business_validity = 'deactivated';
    if (action === 'void') state.business_validity = 'voided';
    if (action === 'expire') state.business_validity = 'expired';
    if (action === 'archive') state.custody = 'archived';
    if (action === 'restore_active_custody') state.custody = 'active_custody';
    if (action === 'destroy') state.custody = 'destroyed';
    if (action === 'irreversible_anonymize') {
      state.identifiability_applicability = 'applicable';
      state.identifiability = 'irreversibly_anonymized';
    }
    return state;
  }

  function behaviorSource(behavior) {
    return [
      ['behavior_name', behavior?.behavior_name],
      ['behavior_description', behavior?.behavior_description],
      ['trigger', behavior?.trigger],
      ['precondition', behavior?.precondition],
      ['timing', behavior?.timing],
      ['completion_standard', behavior?.completion_standard],
      ['output_description', behavior?.output_description]
    ].filter(([, value]) => text(value).trim());
  }

  function triggerFrom(behavior, fieldName, sourceText) {
    if (fieldName === 'timing' || /期限|届满|到期|每年|每月|每季度|定期/.test(sourceText)) {
      return { mode: 'time_period', operator: 'single', behavior_ref: behavior?.behavior_ref || null, expression: sourceText };
    }
    if (fieldName === 'trigger' || fieldName === 'precondition') {
      return { mode: 'business_condition', operator: 'single', behavior_ref: behavior?.behavior_ref || null, expression: sourceText };
    }
    return { mode: 'behavior', operator: 'single', behavior_ref: behavior?.behavior_ref || null, expression: sourceText };
  }

  function relationRefsForBehavior(document, behaviorRef) {
    const outgoing = array(document?.flow_relations)
      .filter(relation => relation?.from_behavior_ref === behaviorRef)
      .map(relation => relation.relation_ref)
      .filter(Boolean)
      .sort();
    if (outgoing.length) return outgoing;
    return array(document?.flow_relations)
      .filter(relation => relation?.to_behavior_ref === behaviorRef)
      .map(relation => relation.relation_ref)
      .filter(Boolean)
      .sort();
  }

  function candidateEvent(document, dataObject, behavior, match, source) {
    const relationRefs = relationRefsForBehavior(document, behavior?.behavior_ref);
    const sourcePath = `/behaviors/${source.behaviorIndex}/${source.fieldName}`;
    const sourceFingerprint = fingerprint({
      sourcePath,
      sourceText: source.sourceText,
      behaviorRef: behavior?.behavior_ref || null,
      relationRefs
    });
    const highRisk = ['destroy', 'irreversible_anonymize'].includes(match.action);
    const normalizedName = text(behavior?.behavior_name).replace(/业务行为|处理|办理/g, '').trim();
    const exactName = normalizedName === ACTION_LABELS[match.action];
    const routeRef = stableRef('lifecycle_route', dataObject.data_ref, relationRefs.join('|') || behavior?.behavior_ref || 'object');
    return {
      route_ref: routeRef,
      route_label: relationRefs.length ? `关联${relationRefs.length}条流程关系` : '当前行为所在路径',
      flow_relation_refs: relationRefs,
      event: {
        event_ref: stableRef('lifecycle_event', dataObject.data_ref, routeRef, match.action, sourcePath),
        action: match.action,
        trigger: triggerFrom(behavior, source.fieldName, source.sourceText),
        result_state: resultStateFor(match.action),
        target_scope: 'pending_confirmation',
        carrier_scope: ['archive', 'restore_active_custody', 'destroy'].includes(match.action)
          ? 'pending_confirmation'
          : 'not_applicable',
        responsibility: {
          mode: behavior?.behavior_ref ? 'inherit_behavior' : 'pending_confirmation',
          department: '',
          position: text(behavior?.current_actor_role)
        },
        exception_handling: '',
        review_status: highRisk || !exactName ? 'pending_confirmation' : 'auto_generated',
        high_risk: highRisk,
        decision_reason: '',
        decision_notes: '',
        provenance: {
          source_type: 'behavior_description',
          source_ref: behavior?.behavior_ref || null,
          source_path: sourcePath,
          basis: source.sourceText,
          analyzer_version: ANALYZER_VERSION,
          source_fingerprint: sourceFingerprint
        }
      }
    };
  }

  function behaviorCandidates(document, dataObject) {
    const behaviorByRef = new Map(array(document?.behaviors).map((behavior, index) => [behavior.behavior_ref, { behavior, index }]));
    const results = [];
    array(dataObject?.behavior_links).forEach(link => {
      const entry = behaviorByRef.get(link?.behavior_ref);
      if (!entry) return;
      const seenActions = new Set();
      behaviorSource(entry.behavior).forEach(([fieldName, sourceText]) => {
        const matches = ACTION_RULES.filter(rule => {
          if (!rule.pattern.test(sourceText)) return false;
          if (rule.action === 'activate' && /重新启用|恢复有效|恢复业务效力/.test(sourceText)) return false;
          return true;
        });
        matches.forEach(match => {
          if (seenActions.has(match.action)) return;
          seenActions.add(match.action);
          results.push(candidateEvent(document, dataObject, entry.behavior, match, {
            behaviorIndex: entry.index,
            fieldName,
            sourceText
          }));
        });
      });
    });
    return results;
  }

  function formCandidates(document, dataObject) {
    const behaviorByRef = new Map(array(document?.behaviors).map(behavior => [behavior.behavior_ref, behavior]));
    const linkedBehaviorRefs = new Set(array(dataObject?.behavior_links).map(link => link?.behavior_ref));
    const results = [];
    array(document?.forms).forEach((form, formIndex) => {
      const containsData = array(form?.areas).some(area => array(area?.items).some(item => item?.business_data_ref === dataObject.data_ref));
      array(form?.behavior_links).forEach((link, linkIndex) => {
        if (!containsData && !linkedBehaviorRefs.has(link?.behavior_ref)) return;
        const behavior = behaviorByRef.get(link?.behavior_ref) || null;
        array(link?.operations).filter(operation => operation === 'archive' || operation === 'void').forEach(operation => {
          const action = operation === 'archive' ? 'archive' : 'void';
          const relationRefs = relationRefsForBehavior(document, link?.behavior_ref);
          const routeRef = stableRef('lifecycle_route', dataObject.data_ref, relationRefs.join('|') || link?.behavior_ref || form.form_ref);
          const sourcePath = `/forms/${formIndex}/behavior_links/${linkIndex}/operations`;
          const sourceFingerprint = fingerprint({ sourcePath, operation, formRef: form.form_ref, relationRefs });
          results.push({
            route_ref: routeRef,
            route_label: relationRefs.length ? `关联${relationRefs.length}条流程关系` : '表单办理所在路径',
            flow_relation_refs: relationRefs,
            event: {
              event_ref: stableRef('lifecycle_event', dataObject.data_ref, routeRef, action, sourcePath),
              action,
              trigger: { mode: 'behavior', operator: 'single', behavior_ref: link?.behavior_ref || null, expression: `${form.form_name}${operation === 'archive' ? '归档' : '作废'}` },
              result_state: resultStateFor(action),
              target_scope: 'pending_confirmation',
              carrier_scope: action === 'archive' ? 'pending_confirmation' : 'not_applicable',
              responsibility: {
                mode: link?.behavior_ref ? 'inherit_behavior' : 'pending_confirmation',
                department: '',
                position: text(behavior?.current_actor_role)
              },
              exception_handling: '',
              review_status: 'auto_generated',
              high_risk: false,
              decision_reason: '',
              decision_notes: '',
              provenance: {
                source_type: 'structured_relation',
                source_ref: form?.form_ref || null,
                source_path: sourcePath,
                basis: `${form.form_name}的办理操作包含${operation === 'archive' ? '归档' : '作废'}`,
                analyzer_version: ANALYZER_VERSION,
                source_fingerprint: sourceFingerprint
              }
            }
          });
        });
      });
    });
    return results;
  }

  function sourceSnapshot(document, dataObject) {
    const linkedBehaviorRefs = new Set(array(dataObject?.behavior_links).map(link => link?.behavior_ref));
    return {
      data: {
        data_ref: dataObject?.data_ref,
        data_name: dataObject?.data_name,
        description: dataObject?.description,
        information_type: dataObject?.information_type,
        behavior_links: dataObject?.behavior_links,
        source_relations: dataObject?.source_relations
      },
      behaviors: array(document?.behaviors).filter(behavior => linkedBehaviorRefs.has(behavior?.behavior_ref)),
      relations: array(document?.flow_relations).filter(relation => linkedBehaviorRefs.has(relation?.from_behavior_ref) || linkedBehaviorRefs.has(relation?.to_behavior_ref)),
      forms: array(document?.forms).filter(form =>
        array(form?.behavior_links).some(link => linkedBehaviorRefs.has(link?.behavior_ref))
        || array(form?.areas).some(area => array(area?.items).some(item => item?.business_data_ref === dataObject?.data_ref))
      )
    };
  }

  function mergeCandidates(existingLifecycle, candidates, sourceFingerprint) {
    const previousFingerprint = text(existingLifecycle?.analysis?.source_fingerprint);
    const sourceChanged = Boolean(previousFingerprint && previousFingerprint !== sourceFingerprint);
    const protectedRoutes = [];
    array(existingLifecycle?.routes).forEach(route => {
      const protectedEvents = array(route?.events).filter(event => PROTECTED_REVIEW_STATUSES.has(event?.review_status)).map(event => {
        const retained = clone(event);
        if (sourceChanged && retained.review_status === 'confirmed') retained.review_status = 'needs_recheck';
        return retained;
      });
      if (protectedEvents.length) protectedRoutes.push({ ...clone(route), events: protectedEvents });
    });

    const routeByRef = new Map(protectedRoutes.map(route => [route.route_ref, route]));
    const protectedEventRefs = new Set(protectedRoutes.flatMap(route => route.events.map(event => event.event_ref)));
    candidates.forEach(candidate => {
      if (protectedEventRefs.has(candidate.event.event_ref)) return;
      if (!routeByRef.has(candidate.route_ref)) {
        routeByRef.set(candidate.route_ref, {
          route_ref: candidate.route_ref,
          route_label: candidate.route_label,
          flow_relation_refs: candidate.flow_relation_refs,
          events: [],
          exit_state: candidate.event.action === 'irreversible_anonymize'
            ? pendingState()
            : stateWithoutAnonymousProcessing()
        });
      }
      const route = routeByRef.get(candidate.route_ref);
      if (!route.events.some(event => event.event_ref === candidate.event.event_ref)) route.events.push(candidate.event);
    });
    return [...routeByRef.values()].sort((left, right) => left.route_ref.localeCompare(right.route_ref));
  }

  function classifyMasterDataHint(document, dataObject) {
    const name = text(dataObject?.data_name);
    const description = text(dataObject?.description);
    const combined = `${name} ${description}`;
    const reasons = [];
    const stableEntity = /供应商|客户|人员|员工|组织|部门|物料|产品|设备|场所/.test(combined);
    const stableIdentifier = dataObject?.information_type === 'identifier' || /统一社会信用代码|稳定标识|唯一编码|对象编码|主键/.test(combined);
    const reused = array(dataObject?.behavior_links).length > 1 || array(dataObject?.source_relations).length > 0;
    if (/冲突|同名不同编码|编码不一致|定义不一致|责任边界不一致/.test(combined)) {
      return {
        type: 'conflict',
        label: '存在冲突',
        message: '发现可能不是同一对象的证据。请保持待定，不要自动合并。',
        reasons: ['对象说明中存在身份、编码、定义或责任边界冲突线索。']
      };
    }
    if (/表单|申请表|登记表|记录表|台账|模板|单据/.test(combined)) {
      return {
        type: 'form_relationship',
        label: '表单关系说明',
        message: '表单通常不是主数据。请继续判断表单字段是否引用供应商、人员、部门等主数据。',
        reasons: ['对象名称或说明表现为表单、台账、模板或单据。']
      };
    }
    const explicitTransaction = /申请|订单|发票|付款|凭证|审批|检验|验收|交易|合同/.test(combined);
    const recordWithoutStableEntity = /记录/.test(combined) && !stableEntity;
    if (explicitTransaction || recordWithoutStableEntity) {
      return {
        type: 'transaction_record',
        label: '当前更像业务记录',
        message: '该数据对象当前更像交易记录或业务证据。即使跨部门流转，也不会因此自动成为主数据。',
        reasons: ['对象名称或说明表现为一次业务事件、交易记录或业务证据。']
      };
    }
    if (stableEntity) reasons.push('对象名称或说明表现为可稳定识别的业务实体。');
    if (stableIdentifier) reasons.push('现有信息包含稳定标识线索。');
    if (reused) reasons.push('对象被多个行为使用，或存在跨流程来源线索。');
    if (stableEntity && (stableIdentifier || reused)) {
      return {
        type: 'later_recognition',
        label: '建议后续认定',
        message: '该数据对象可能需要后续主数据认定。请核对业务定义、稳定标识、责任部门和权威来源，并交由MDM工作组认定。',
        reasons
      };
    }
    return {
      type: 'insufficient_information',
      label: '信息不足',
      message: '现有信息不足，暂不能判断是否需要主数据认定。请补充对象事实，或将其列入交接待定事项。',
      reasons: reasons.length ? reasons : ['现有对象事实不足以判断稳定身份、复用范围、责任部门和权威来源。']
    };
  }

  function analyzeDataObject(document, dataRef) {
    const dataObject = array(document?.data_objects).find(item => item?.data_ref === dataRef);
    if (!dataObject) throw new Error(`找不到数据对象: ${dataRef || '未提供'}`);
    const snapshot = sourceSnapshot(document, dataObject);
    const sourceFingerprint = fingerprint(snapshot);
    const candidates = [...behaviorCandidates(document, dataObject), ...formCandidates(document, dataObject)];
    const lifecycle = clone(dataObject.lifecycle || {});
    lifecycle.applicability = lifecycle.applicability || 'pending_confirmation';
    lifecycle.entry_state = lifecycle.entry_state || pendingState();
    lifecycle.routes = mergeCandidates(lifecycle, candidates, sourceFingerprint);
    lifecycle.analysis = {
      analyzer_version: ANALYZER_VERSION,
      source_fingerprint: sourceFingerprint,
      status: 'analyzed'
    };
    lifecycle.decision_reason = lifecycle.decision_reason || '';
    lifecycle.decision_notes = lifecycle.decision_notes || '';
    return {
      data_ref: dataRef,
      lifecycle,
      master_data_hint: classifyMasterDataHint(document, dataObject),
      candidate_count: candidates.length
    };
  }

  function analyzeAll(document) {
    return array(document?.data_objects).map(dataObject => analyzeDataObject(document, dataObject.data_ref));
  }

  return {
    ANALYZER_VERSION,
    ACTION_LABELS: { ...ACTION_LABELS },
    fingerprint,
    pendingState,
    resultStateFor,
    classifyMasterDataHint,
    analyzeDataObject,
    analyzeAll
  };
}));
