(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LegacyCrossDepartmentDiagnostics = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createLegacyCrossDepartmentDiagnostics() {
  'use strict';

  function text(value) {
    return value == null ? '' : String(value).trim();
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function unique(value) {
    return [...new Set(array(value).map(text).filter(Boolean))];
  }

  function behaviorName(behavior) {
    return text(behavior?.behavior_name) || '未命名业务行为';
  }

  function behaviorLabel(behavior) {
    return `“${behaviorName(behavior)}”`;
  }

  function relationLabel(relation, behaviorByRef) {
    const from = behaviorByRef.get(text(relation?.from_behavior_ref));
    const to = behaviorByRef.get(text(relation?.to_behavior_ref));
    return `${behaviorLabel(from)} → ${behaviorLabel(to)}`;
  }

  function resolveTriggerBehavior(source, behaviors) {
    const trigger = text(source?.trigger_condition);
    const direction = source?.handoff_direction === 'inbound_prerequisite'
      ? 'inbound_prerequisite'
      : 'outbound_followup';
    const match = direction === 'inbound_prerequisite'
      ? trigger.match(/^“(.+)”开始前$/)
      : trigger.match(/^“(.+)”完成后，系统生成跨部门待办$/);
    if (!match) return null;
    const matched = behaviors.filter(item => behaviorName(item) === match[1]);
    return matched.length === 1 ? matched[0] : null;
  }

  function directionSummary(source, documentValue) {
    const owner = text(documentValue?.process?.owning_department)
      || text(documentValue?.export_meta?.initiating_department);
    if (source?.handoff_direction === 'inbound_prerequisite') {
      return `${text(source.source_department) || '提供部门待确认'}提供、${text(source.target_department) || owner || '本流程部门待确认'}接收`;
    }
    return `${text(source?.source_department) || owner || '本流程部门待确认'}发出、${text(source?.target_department) || '承接部门待确认'}承接`;
  }

  function externalDepartment(source) {
    return source?.handoff_direction === 'inbound_prerequisite'
      ? text(source.source_department)
      : text(source?.target_department);
  }

  function recordSubject(index, source, externalBehavior) {
    const department = externalDepartment(source) || '外部门待确认';
    const action = (externalBehavior ? behaviorName(externalBehavior) : '')
      || text(source?.counterparty_behavior_name)
      || text(source?.requested_matter)
      || '办理动作待确认';
    return `旧版跨部门记录${index + 1}对应${department}的“${action}”行为`;
  }

  function positionPhrase(direction, behavior) {
    return direction === 'inbound_prerequisite'
      ? `${behaviorLabel(behavior)}开始前`
      : `${behaviorLabel(behavior)}之后`;
  }

  function candidateRelations(documentValue, source, externalBehaviorRef) {
    const direction = source?.handoff_direction === 'inbound_prerequisite'
      ? 'inbound_prerequisite'
      : 'outbound_followup';
    return array(documentValue?.flow_relations)
      .map((relation, relationIndex) => ({ relation, relationIndex }))
      .filter(({ relation }) => relation?.relation_type !== 'loop')
      .filter(({ relation }) => direction === 'inbound_prerequisite'
        ? text(relation?.from_behavior_ref) === externalBehaviorRef
        : text(relation?.to_behavior_ref) === externalBehaviorRef);
  }

  function relationTarget(candidates) {
    if (!candidates.length) {
      return { editorSection: 'process', processSection: 'relations' };
    }
    const focusPaths = candidates.flatMap(({ relationIndex }) => [
      `flow_relations.${relationIndex}.from_behavior_ref`,
      `flow_relations.${relationIndex}.to_behavior_ref`
    ]);
    return {
      editorSection: 'process',
      processSection: 'relations',
      focusKind: 'relation',
      focusRef: text(candidates[0].relation?.relation_ref),
      ...(candidates.length > 1 ? { focusPaths } : {})
    };
  }

  function flowIssue(documentValue, record, context) {
    if (array(record?.created_relation_refs).length) return null;
    const {
      source, subject, direction, externalBehavior,
      triggerBehavior, candidates, behaviorByRef
    } = context;
    if (!externalBehavior) return null;
    const directionText = directionSummary(source, documentValue);
    const base = `${subject}，交接方向为${directionText}。`;
    const target = relationTarget(candidates);
    const triggerPosition = triggerBehavior ? positionPhrase(direction, triggerBehavior) : '';
    const rawTrigger = text(source?.trigger_condition);

    if (candidates.length === 1) {
      const candidate = candidates[0].relation;
      const relationPositionRef = direction === 'inbound_prerequisite'
        ? text(candidate.to_behavior_ref)
        : text(candidate.from_behavior_ref);
      const relationPositionBehavior = behaviorByRef.get(relationPositionRef);
      const relationPosition = positionPhrase(direction, relationPositionBehavior);
      const currentRelation = relationLabel(candidate, behaviorByRef);
      if (triggerBehavior && text(triggerBehavior.behavior_ref) !== relationPositionRef) {
        const keepRelationSuggestion = direction === 'inbound_prerequisite'
          ? `如果${behaviorLabel(externalBehavior)}应在${behaviorLabel(relationPositionBehavior)}开始前完成，保留${currentRelation}，无需新增流程关系。`
          : `如果${behaviorLabel(externalBehavior)}应在${behaviorLabel(relationPositionBehavior)}完成后进入，保留${currentRelation}，无需新增流程关系。`;
        const useTriggerSuggestion = direction === 'inbound_prerequisite'
          ? `如果${behaviorLabel(externalBehavior)}应在${behaviorLabel(triggerBehavior)}开始前完成，请修改对应流程关系或触发说明。`
          : `如果${behaviorLabel(externalBehavior)}应由${behaviorLabel(triggerBehavior)}直接触发，请修改对应流程关系或触发说明。`;
        return {
          kind: 'flow_position_conflict',
          message: `${base}旧记录的触发说明指向${triggerPosition}，现有流程关系则为${currentRelation}，两个衔接位置不一致。请确认实际衔接位置。`,
          suggestions: [keepRelationSuggestion, useTriggerSuggestion],
          ...target
        };
      }
      if (triggerBehavior) {
        return {
          kind: 'flow_position_consistent',
          message: `${base}旧记录未单独保存衔接位置，但旧触发说明和现有流程关系都指向${relationPosition}。请确认该先后顺序是否符合实际。`,
          suggestions: [
            `如果该顺序符合实际，保留${currentRelation}，无需新增流程关系。`,
            '如果该顺序不符合实际，请按实际先后关系修改流程关系。'
          ],
          ...target
        };
      }
      const triggerText = rawTrigger ? `旧记录的触发说明为“${rawTrigger}”，` : '旧记录没有写明可识别的触发位置，';
      return {
        kind: 'single_current_relation',
        message: `${base}${triggerText}当前只有一条相关流程关系：${currentRelation}。请确认该关系是否就是实际衔接位置。`,
        suggestions: [
          `如果该关系符合实际，保留${currentRelation}，无需新增流程关系。`,
          '如果该关系不符合实际，请修改流程关系，并同步核对触发说明。'
        ],
        ...target
      };
    }

    if (candidates.length > 1) {
      const labels = candidates.map(({ relation }) => relationLabel(relation, behaviorByRef));
      const triggerText = triggerPosition
        ? `旧记录的触发说明指向${triggerPosition}；`
        : rawTrigger
          ? `旧记录的触发说明为“${rawTrigger}”；`
          : '旧记录没有写明可识别的触发位置；';
      return {
        kind: 'multiple_current_relations',
        message: `${base}${triggerText}当前有${labels.length}条相关流程关系：${labels.join('；')}。请确认哪一条表示实际衔接位置。`,
        suggestions: [
          '保留符合实际先后顺序的流程关系。',
          '不符合实际的关系应由业务人员确认后修改，不要按记录名称自动选择。'
        ],
        ...target
      };
    }

    const triggerText = triggerPosition
      ? `旧记录的触发说明指向${triggerPosition}`
      : rawTrigger
        ? `旧记录的触发说明为“${rawTrigger}”`
        : '旧记录没有写明可识别的触发位置';
    return {
      kind: 'missing_current_relation',
      message: `${base}${triggerText}，当前流程中没有找到与${behaviorLabel(externalBehavior)}相连的普通流程关系。请确认实际衔接位置。`,
      suggestions: [
        '根据实际先后顺序补充流程关系。',
        '无法从现有材料确认时，保留待确认，不要按记录名称猜测。'
      ],
      ...target
    };
  }

  function behaviorIssue(record, context) {
    if (context.externalBehavior) return null;
    const source = context.source;
    const action = text(source?.counterparty_behavior_name)
      || text(source?.requested_matter)
      || '办理动作待确认';
    const department = externalDepartment(source) || '外部门待确认';
    return {
      kind: 'missing_external_behavior',
      message: `旧版跨部门记录${context.index + 1}指向${department}的“${action}”行为，但当前流程中没有找到对应的可编辑业务行为。`,
      suggestions: [
        '根据原记录核对实际执行部门、岗位和办理动作后，在“业务流程”中补建对应行为。',
        '原记录没有写清实际办理动作时，保留待确认，不要用记录名称代替业务动作。'
      ],
      editorSection: 'process',
      processSection: 'behaviors'
    };
  }

  function dataIssues(documentValue, record, context) {
    if (array(record?.created_data_link_refs).length) return [];
    const source = context.source;
    const dataByRef = new Map(array(documentValue?.data_objects).map(item => [text(item?.data_ref), item]));
    const issues = [];
    const addIssue = (dataRef, roleText, suggestion) => {
      if (!dataRef) return;
      const dataObject = dataByRef.get(text(dataRef));
      const dataName = text(dataObject?.data_name) || '名称待确认的数据';
      issues.push({
        kind: 'missing_data_relation',
        message: `${context.subject}。旧记录把“${dataName}”作为${roleText}，但当前没有形成可核对的数据行为关系。`,
        suggestions: [suggestion, '无法确认数据去向时，保留待确认，不要自动选择创建、更新或使用关系。'],
        editorSection: 'process',
        processSection: 'data',
        focusKind: 'data',
        focusRef: text(dataObject?.data_ref)
      });
    };
    const externalName = context.externalBehavior
      ? behaviorName(context.externalBehavior)
      : text(source?.counterparty_behavior_name) || text(source?.requested_matter) || '外部门办理动作';
    if (source?.transfer_data_ref) {
      const roleText = context.direction === 'inbound_prerequisite'
        ? `${externalName}提供给本流程使用的数据`
        : `本流程交给${externalName}使用的数据`;
      addIssue(source.transfer_data_ref, roleText, '在“输出物与数据”中核对实际创建和使用该数据的业务行为。');
    }
    if (source?.returned_data_ref) {
      addIssue(source.returned_data_ref, `${externalName}办理后返回本流程的数据`, '在“输出物与数据”中核对返回数据的创建行为和后续使用行为。');
    }
    return issues;
  }

  function diagnoseRecord(documentValue, record, index, behaviorByRef) {
    const source = record?.source_handoff || {};
    const direction = source.handoff_direction === 'inbound_prerequisite'
      ? 'inbound_prerequisite'
      : 'outbound_followup';
    const externalBehaviorRef = text(record?.created_behavior_ref || source.counterparty_behavior_ref);
    const externalBehavior = behaviorByRef.get(externalBehaviorRef) || null;
    const behaviors = array(documentValue?.behaviors);
    const triggerBehavior = resolveTriggerBehavior(source, behaviors);
    const candidates = externalBehavior
      ? candidateRelations(documentValue, source, externalBehaviorRef)
      : [];
    const relatedBehaviorRefs = unique([
      record?.created_behavior_ref,
      source.counterparty_behavior_ref,
      source.anchor_behavior_ref,
      source.resume_behavior_ref
    ]);
    const context = {
      index,
      source,
      direction,
      externalBehaviorRef,
      externalBehavior,
      triggerBehavior,
      candidates,
      behaviorByRef,
      subject: recordSubject(index, source, externalBehavior)
    };
    const issues = [
      behaviorIssue(record, context),
      flowIssue(documentValue, record, context),
      ...dataIssues(documentValue, record, context)
    ].filter(Boolean);
    return {
      recordIndex: index,
      recordRef: text(record?.record_ref),
      relatedBehaviorRefs,
      subject: context.subject,
      issues
    };
  }

  function diagnose(documentValue) {
    const behaviorByRef = new Map(array(documentValue?.behaviors).map(item => [text(item?.behavior_ref), item]));
    return array(documentValue?.migration?.legacy_cross_department_records)
      .map((record, index) => ({ record, index }))
      .filter(({ record }) => record?.conversion_status === 'needs_manual_completion')
      .map(({ record, index }) => diagnoseRecord(documentValue, record, index, behaviorByRef));
  }

  return { diagnose, resolveTriggerBehavior };
}));
