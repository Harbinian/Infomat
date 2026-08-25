(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.GraphEditCommands = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createGraphEditCommands() {
  'use strict';

  const FLOW_TYPES = new Set(['', 'sequence', 'condition', 'loop', 'parallel']);
  const NODE_TYPES = new Set(['', 'action', 'decision', 'parallel_split', 'parallel_join']);
  const DATA_OPERATIONS = new Set(['create', 'update', 'use', 'pending_confirmation']);
  const DECISION_VERB_PATTERN = /(?:校对|复核|审核|核查|审批|批准|验收|确认)/;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))];
  }

  function refIsValid(value) {
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text(value));
  }

  function resultError(code, message, details = {}) {
    return { ok: false, code, message, details };
  }

  function resultOk(documentValue, details = {}) {
    return { ok: true, document: documentValue, details };
  }

  function duplicateRefs(items, key) {
    const seen = new Set();
    const duplicates = [];
    array(items).forEach(item => {
      const ref = item?.[key];
      if (!ref) return;
      if (seen.has(ref)) duplicates.push(ref);
      seen.add(ref);
    });
    return unique(duplicates);
  }

  function technicalIntegrity(documentValue) {
    const errors = [];
    const collections = [
      [documentValue?.behaviors, 'behavior_ref', '业务行为'],
      [documentValue?.flow_relations, 'relation_ref', '流程关系'],
      [documentValue?.data_objects, 'data_ref', '数据对象'],
      [documentValue?.forms, 'form_ref', '表单'],
      [documentValue?.terms, 'term_ref', '术语']
    ];
    collections.forEach(([items, key, label]) => {
      array(items).forEach((item, index) => {
        if (!refIsValid(item?.[key])) errors.push({ code: 'INVALID_REF', path: `${key}:${index}`, message: `${label}技术标识无效` });
      });
      duplicateRefs(items, key).forEach(ref => errors.push({ code: 'DUPLICATE_REF', ref, message: `${label}技术标识${ref}重复` }));
    });
    const behaviorRefs = new Set(array(documentValue?.behaviors).map(item => item.behavior_ref));
    const dataRefs = new Set(array(documentValue?.data_objects).map(item => item.data_ref));
    const dataFieldOwners = new Map();
    array(documentValue?.flow_relations).forEach(relation => {
      if (relation.from_behavior_ref && !behaviorRefs.has(relation.from_behavior_ref)) {
        errors.push({ code: 'BROKEN_REF', ref: relation.from_behavior_ref, message: `流程关系${relation.relation_ref}的起点不存在` });
      }
      if (relation.to_behavior_ref && !behaviorRefs.has(relation.to_behavior_ref)) {
        errors.push({ code: 'BROKEN_REF', ref: relation.to_behavior_ref, message: `流程关系${relation.relation_ref}的终点不存在` });
      }
    });
    array(documentValue?.data_objects).forEach(dataObject => {
      duplicateRefs(dataObject.fields, 'field_ref').forEach(ref => errors.push({ code: 'DUPLICATE_REF', ref, message: `对象字段技术标识${ref}重复` }));
      array(dataObject.fields).forEach(field => {
        if (dataFieldOwners.has(field.field_ref)) {
          errors.push({ code: 'DUPLICATE_REF', ref: field.field_ref, message: `对象字段技术标识${field.field_ref}跨数据对象重复` });
        }
        dataFieldOwners.set(field.field_ref, dataObject.data_ref);
      });
      duplicateRefs(dataObject.behavior_links, 'link_ref').forEach(ref => errors.push({ code: 'DUPLICATE_REF', ref, message: `数据关系技术标识${ref}重复` }));
      array(dataObject.behavior_links).forEach(link => {
        if (!behaviorRefs.has(link.behavior_ref)) errors.push({ code: 'BROKEN_REF', ref: link.behavior_ref, message: `数据${dataObject.data_name || dataObject.data_ref}引用的行为不存在` });
        const updatedFieldRefs = unique(array(link.updated_field_refs));
        if (link.operation !== 'update' && updatedFieldRefs.length) {
          errors.push({ code: 'UPDATED_FIELDS_OPERATION_MISMATCH', ref: link.link_ref, message: `只有更新操作可以登记更新字段` });
        }
        updatedFieldRefs.forEach(fieldRef => {
          if (!array(dataObject.fields).some(field => field.field_ref === fieldRef)) {
            errors.push({ code: 'BROKEN_REF', ref: fieldRef, message: `数据${dataObject.data_name || dataObject.data_ref}的更新字段不存在` });
          }
        });
      });
      array(dataObject.source_relations).forEach(source => {
        if (source.available_from_behavior_ref && !behaviorRefs.has(source.available_from_behavior_ref)) {
          errors.push({ code: 'BROKEN_REF', ref: source.available_from_behavior_ref, message: `数据${dataObject.data_name || dataObject.data_ref}的可用位置不存在` });
        }
      });
    });
    array(documentValue?.behaviors).forEach(behavior => {
      if (behavior.actor_department_data_ref && !dataRefs.has(behavior.actor_department_data_ref)) {
        errors.push({ code: 'BROKEN_REF', ref: behavior.actor_department_data_ref, message: `行为${behavior.behavior_name || behavior.behavior_ref}的动态责任数据不存在` });
      }
    });
    array(documentValue?.forms).forEach(form => array(form.areas).forEach(area => array(area.items).forEach(item => {
      if (!item.data_field_ref) return;
      const ownerRef = dataFieldOwners.get(item.data_field_ref);
      if (!ownerRef) {
        errors.push({ code: 'BROKEN_REF', ref: item.data_field_ref, message: `表单字段${item.item_name || item.item_ref}引用的对象字段不存在` });
      } else if (ownerRef !== item.business_data_ref) {
        errors.push({ code: 'FIELD_OWNER_MISMATCH', ref: item.data_field_ref, message: `表单字段${item.item_name || item.item_ref}引用的对象字段与业务数据归属不一致` });
      }
    })));
    return errors;
  }

  function relationDuplicateKey(relation) {
    const base = [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref];
    if (relation.relation_type === 'condition' || relation.relation_type === 'loop') base.push(text(relation.condition).trim());
    return base.join('|');
  }

  function relationHardErrors(documentValue, relation, ignoreRef = '') {
    const errors = [];
    const behaviorRefs = new Set(array(documentValue.behaviors).map(item => item.behavior_ref));
    if (!FLOW_TYPES.has(relation.relation_type)) errors.push('关系类型不受支持');
    if (!relation.from_behavior_ref || !behaviorRefs.has(relation.from_behavior_ref)) errors.push('起点不存在');
    if (!relation.to_behavior_ref || !behaviorRefs.has(relation.to_behavior_ref)) errors.push('终点不存在');
    if (relation.from_behavior_ref && relation.from_behavior_ref === relation.to_behavior_ref) errors.push('起点和终点相同');
    const key = relationDuplicateKey(relation);
    if (array(documentValue.flow_relations).some(item => item.relation_ref !== ignoreRef && relationDuplicateKey(item) === key)) {
      errors.push('已存在完全相同的关系');
    }
    return errors;
  }

  function relationWarnings(documentValue, relation) {
    const warnings = [];
    const from = array(documentValue.behaviors).find(item => item.behavior_ref === relation.from_behavior_ref);
    const to = array(documentValue.behaviors).find(item => item.behavior_ref === relation.to_behavior_ref);
    if (relation.relation_type === 'parallel' && from?.node_type !== 'parallel_split' && to?.node_type !== 'parallel_join') {
      warnings.push('并行路线未连接并行开始或并行汇合');
    }
    if (['condition', 'loop'].includes(relation.relation_type) && !text(relation.condition).trim()) warnings.push('关系条件尚未填写');
    const decisionOutcomes = array(documentValue.flow_relations).filter(item =>
      item.from_behavior_ref === relation.from_behavior_ref
      && ['sequence', 'condition', 'loop'].includes(item.relation_type)
      && item.to_behavior_ref
    );
    const outgoing = decisionOutcomes.filter(item =>
      item.from_behavior_ref === relation.from_behavior_ref
      && item.relation_type !== 'loop'
      && item.to_behavior_ref
    );
    const hasLoopOutcome = decisionOutcomes.some(item => item.relation_type === 'loop');
    const hasConditionOutcome = decisionOutcomes.some(item => item.relation_type === 'condition');
    if (from?.node_type === 'action' && (
      hasConditionOutcome
      || (hasLoopOutcome && (outgoing.length || DECISION_VERB_PATTERN.test(text(from.behavior_name))))
    )) {
      warnings.push('普通业务行为承载了条件分叉；请保留该业务行为，并在其后增加独立判断节点');
    }
    if (from?.node_type === 'action' && new Set(outgoing.map(item => item.to_behavior_ref)).size > 1) {
      warnings.push('普通业务行为直接连接多个后续节点；请核对这是判断分支还是并行开始');
    }
    if (from?.node_type === 'decision') {
      const defaultRoutes = outgoing.filter(item => item.relation_type === 'sequence' && !text(item.condition).trim());
      if (defaultRoutes.length > 1) warnings.push('判断节点最多只能保留一条无条件默认路径');
    }
    if (relation.relation_type !== 'loop' && relation.from_behavior_ref && relation.to_behavior_ref) {
      const adjacency = new Map();
      array(documentValue.flow_relations).filter(item => item.relation_type !== 'loop').forEach(item => {
        if (!adjacency.has(item.from_behavior_ref)) adjacency.set(item.from_behavior_ref, []);
        adjacency.get(item.from_behavior_ref).push(item.to_behavior_ref);
      });
      const pending = [relation.to_behavior_ref];
      const visited = new Set();
      while (pending.length) {
        const ref = pending.pop();
        if (ref === relation.from_behavior_ref) {
          warnings.push('该非回路关系与其他关系形成闭环；如果表示退回前序行为，请改用流程内部回路');
          break;
        }
        if (visited.has(ref)) continue;
        visited.add(ref);
        pending.push(...(adjacency.get(ref) || []));
      }
    }
    return warnings;
  }

  function dataOperationHardErrors(documentValue, dataRef, behaviorRef, operations, ignoreLinkRefs = []) {
    const dataObject = array(documentValue.data_objects).find(item => item.data_ref === dataRef);
    const behavior = array(documentValue.behaviors).find(item => item.behavior_ref === behaviorRef);
    if (!dataObject) return ['数据对象不存在'];
    if (!behavior) return ['业务行为不存在'];
    if (behavior.node_type !== 'action') return ['判断和并行控制节点不是业务行为，不能建立数据操作关系'];
    const selected = unique(array(operations));
    if (selected.some(operation => !DATA_OPERATIONS.has(operation))) return ['数据操作类型无效'];
    if (!selected.length) return [];
    if (selected.includes('pending_confirmation') && selected.length > 1) return ['待确认不能与已确认操作同时存在'];
    const remaining = array(dataObject.behavior_links).filter(link => !ignoreLinkRefs.includes(link.link_ref));
    if (selected.includes('create')) {
      const otherCreators = remaining.filter(link => link.operation === 'create' && link.behavior_ref !== behaviorRef);
      if (otherCreators.length) return ['该数据对象已经有已确认创建行为'];
    }
    const combinedOperations = new Set([
      ...remaining.filter(link => link.behavior_ref === behaviorRef).map(link => link.operation),
      ...selected
    ]);
    if (combinedOperations.has('pending_confirmation') && combinedOperations.size > 1) return ['待确认不能与已确认操作同时存在'];
    return [];
  }

  function migrationReferences(documentValue, kind, ref) {
    const migration = documentValue?.migration || {};
    const impacts = [];
    if (kind === 'behavior') {
      array(migration.work_roles).forEach(item => {
        if (item.behavior_ref === ref) impacts.push({ kind: 'migration.work_role', ref: item.archive_ref, label: '历史工作角色' });
      });
      array(migration.unresolved_actor_roles).forEach(item => {
        if (item.behavior_ref === ref) impacts.push({ kind: 'migration.unresolved_actor', ref: item.record_ref, label: '待确认执行主体' });
      });
      array(migration.internal_process_calls).forEach(item => {
        if (item.caller_behavior_ref === ref || item.return_behavior_ref === ref) impacts.push({ kind: 'migration.internal_call', ref: item.call_ref, label: '历史部门内调用' });
      });
      array(migration.legacy_cross_department_records).forEach(item => {
        if (item.created_behavior_ref === ref || item.source_handoff?.anchor_behavior_ref === ref || item.source_handoff?.resume_behavior_ref === ref) {
          impacts.push({ kind: 'migration.legacy_cross_department', ref: item.record_ref, label: '旧跨部门记录' });
        }
      });
    }
    if (kind === 'relation') {
      array(migration.unresolved_join_modes).forEach(item => {
        if (item.relation_ref === ref) impacts.push({ kind: 'migration.unresolved_join', ref: item.record_ref, label: '待确认汇合方式' });
      });
      array(migration.legacy_cross_department_records).forEach(item => {
        if (array(item.created_relation_refs).includes(ref)) impacts.push({ kind: 'migration.legacy_cross_department', ref: item.record_ref, label: '旧跨部门记录' });
      });
    }
    if (kind === 'data') {
      array(migration.internal_process_calls).forEach(item => {
        if (array(item.input_data_refs).includes(ref) || array(item.output_data_refs).includes(ref)) {
          impacts.push({ kind: 'migration.internal_call', ref: item.call_ref, label: '历史部门内调用' });
        }
      });
      array(migration.legacy_cross_department_records).forEach(item => {
        const handoff = item.source_handoff || {};
        if (handoff.transfer_data_ref === ref || handoff.returned_data_ref === ref) {
          impacts.push({ kind: 'migration.legacy_cross_department', ref: item.record_ref, label: '旧跨部门记录' });
        }
      });
    }
    return impacts;
  }

  function analyzeDeletion(documentValue, kind, ref) {
    const impacts = [];
    if (kind === 'behavior') {
      array(documentValue.flow_relations).forEach(item => {
        if (item.from_behavior_ref === ref || item.to_behavior_ref === ref) impacts.push({ kind: 'flow_relation', ref: item.relation_ref, label: '流程关系' });
      });
      array(documentValue.data_objects).forEach(dataObject => array(dataObject.behavior_links).forEach(link => {
        if (link.behavior_ref === ref) impacts.push({ kind: 'data_relation', ref: link.link_ref, ownerRef: dataObject.data_ref, label: '数据关系' });
      }));
      array(documentValue.data_objects).forEach(dataObject => array(dataObject.source_relations).forEach(source => {
        if (source.available_from_behavior_ref === ref) impacts.push({ kind: 'data_availability', ref: source.source_ref, ownerRef: dataObject.data_ref, label: '数据可用位置' });
      }));
      array(documentValue.forms).forEach(form => array(form.behavior_links).forEach(link => {
        if (link.behavior_ref === ref) impacts.push({ kind: 'form_relation', ref: link.link_ref, ownerRef: form.form_ref, label: '表单关系' });
      }));
    }
    if (kind === 'data') {
      const dataObject = array(documentValue.data_objects).find(item => item.data_ref === ref);
      array(dataObject?.behavior_links).forEach(link => impacts.push({ kind: 'data_relation', ref: link.link_ref, ownerRef: ref, label: '数据关系' }));
      array(dataObject?.source_relations).forEach(source => impacts.push({ kind: 'data_source', ref: source.source_ref, ownerRef: ref, label: '数据来源线索' }));
      array(documentValue.behaviors).forEach(item => {
        if (item.actor_department_data_ref === ref) impacts.push({ kind: 'dynamic_actor', ref: item.behavior_ref, label: '动态执行主体' });
      });
      array(documentValue.forms).forEach(form => array(form.areas).forEach(area => array(area.items).forEach(item => {
        if (item.business_data_ref === ref) impacts.push({ kind: 'field_ownership', ref: item.item_ref, ownerRef: form.form_ref, label: '字段业务数据归属' });
        array(item.source_links).forEach(link => {
          if (link.source_data_ref === ref) impacts.push({ kind: 'field_source', ref: link.source_link_ref, ownerRef: item.item_ref, label: '字段取值来源' });
        });
      })));
    }
    if (kind === 'form') {
      const form = array(documentValue.forms).find(item => item.form_ref === ref);
      array(form?.behavior_links).forEach(link => impacts.push({ kind: 'form_relation', ref: link.link_ref, label: '表单关系' }));
    }
    impacts.push(...migrationReferences(documentValue, kind, ref));
    return impacts;
  }

  function deleteObject(documentValue, kind, ref) {
    const collectionKey = { behavior: 'behaviors', relation: 'flow_relations', data: 'data_objects', form: 'forms' }[kind];
    const refKey = { behavior: 'behavior_ref', relation: 'relation_ref', data: 'data_ref', form: 'form_ref' }[kind];
    if (!collectionKey) return resultError('UNSUPPORTED_DELETE', '不支持删除该对象');
    const index = array(documentValue[collectionKey]).findIndex(item => item?.[refKey] === ref);
    if (index < 0) return resultError('OBJECT_NOT_FOUND', '待删除对象不存在');
    const impacts = analyzeDeletion(documentValue, kind, ref);
    if (impacts.length) return resultError('DELETE_BLOCKED', '该对象仍被引用，不能删除', { impacts });
    const next = clone(documentValue);
    next[collectionKey].splice(index, 1);
    return resultOk(next, { deletedRef: ref, previousIndex: index });
  }

  function mergePreview(documentValue, keepRef, removeRefs) {
    const keep = array(documentValue.data_objects).find(item => item.data_ref === keepRef);
    const removing = unique(array(removeRefs)).map(ref => array(documentValue.data_objects).find(item => item.data_ref === ref)).filter(Boolean);
    if (!keep || !removing.length) return resultError('MERGE_SELECTION_INVALID', '请选择保留对象和至少一个待归并对象');
    if (removing.some(item => item.data_ref === keepRef)) return resultError('MERGE_SELECTION_INVALID', '保留对象不能同时作为待删除对象');
    const normalizedName = text(keep.data_name).trim();
    if (!normalizedName || removing.some(item => text(item.data_name).trim() !== normalizedName)) {
      return resultError('MERGE_NAME_MISMATCH', '只有去除首尾空白后名称完全相同的数据对象可以归并');
    }
    const objects = [keep, ...removing];
    const confirmedTypes = unique(objects.map(item => item.information_type).filter(value => value && value !== 'pending_confirmation'));
    if (confirmedTypes.length > 1) return resultError('MERGE_INFORMATION_TYPE_CONFLICT', '数据对象存在不同的已确认信息类型');
    const creators = unique(objects.flatMap(item => array(item.behavior_links).filter(link => link.operation === 'create').map(link => link.behavior_ref)));
    if (creators.length > 1) return resultError('MERGE_CREATOR_CONFLICT', '数据对象存在不同的已确认创建行为');
    const hasPending = objects.some(item => array(item.behavior_links).some(link => link.operation === 'pending_confirmation'));
    const hasConfirmed = objects.some(item => array(item.behavior_links).some(link => link.operation !== 'pending_confirmation'));
    if (hasPending && hasConfirmed) return resultError('MERGE_PENDING_CONFLICT', '待确认操作不能与已确认操作一起归并');
    const archiveImpacts = removing.flatMap(item => migrationReferences(documentValue, 'data', item.data_ref));
    if (archiveImpacts.length) return resultError('MERGE_ARCHIVE_BLOCKED', '迁移归档仍引用待删除数据对象，不能归并', { impacts: archiveImpacts });
    const valueConflicts = [];
    ['description'].forEach(field => {
      const values = unique(objects.map(item => text(item[field])).filter(Boolean));
      if (values.length > 1) valueConflicts.push({ field, values });
    });
    return {
      ok: true,
      details: {
        keepRef,
        removeRefs: removing.map(item => item.data_ref),
        valueConflicts,
        impacts: removing.map(item => ({
          dataRef: item.data_ref,
          behaviorLinks: array(item.behavior_links).length,
          sourceRelations: array(item.source_relations).length,
          fieldReferences: analyzeDeletion(documentValue, 'data', item.data_ref).filter(impact => !impact.kind.startsWith('migration.')).length
        }))
      }
    };
  }

  function mergeDataObjects(documentValue, keepRef, removeRefs, valueChoices = {}) {
    const preview = mergePreview(documentValue, keepRef, removeRefs);
    if (!preview.ok) return preview;
    const unresolvedChoice = preview.details.valueConflicts.find(conflict => !valueChoices[conflict.field]);
    if (unresolvedChoice) return resultError('MERGE_VALUE_CHOICE_REQUIRED', `字段${unresolvedChoice.field}存在不同值，请明确选择保留值`, { conflict: unresolvedChoice });
    const next = clone(documentValue);
    const keep = next.data_objects.find(item => item.data_ref === keepRef);
    const removing = preview.details.removeRefs.map(ref => next.data_objects.find(item => item.data_ref === ref));
    preview.details.valueConflicts.forEach(conflict => {
      const choice = valueChoices[conflict.field];
      if (choice === 'keep') return;
      const source = removing.find(item => item.data_ref === choice);
      if (source) keep[conflict.field] = source[conflict.field];
    });
    const relationKey = link => `${link.behavior_ref}|${link.operation}`;
    keep.behavior_links = [...new Map([keep, ...removing].flatMap(item => array(item.behavior_links)).map(link => [relationKey(link), link])).values()];
    const sourceKey = source => [
      source.source_department, source.source_process_name, source.source_behavior_name, source.source_data_name,
      source.availability_mode, source.available_from_behavior_ref
    ].map(text).join('|');
    keep.source_relations = [...new Map([keep, ...removing].flatMap(item => array(item.source_relations)).map(source => [sourceKey(source), source])).values()];
    const fieldRefRemap = new Map();
    const fieldKey = field => `${text(field.field_name).trim().replace(/\s+/g, ' ').toLocaleLowerCase()}|${text(field.field_type).trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
    const mergedFields = [];
    const fieldsByKey = new Map();
    [keep, ...removing].flatMap(item => array(item.fields)).forEach(field => {
      const key = fieldKey(field);
      const existing = key !== '|' ? fieldsByKey.get(key) : null;
      if (existing) {
        fieldRefRemap.set(field.field_ref, existing.field_ref);
        return;
      }
      if (key !== '|') fieldsByKey.set(key, field);
      mergedFields.push(field);
    });
    keep.fields = mergedFields;
    if (keep.information_type === 'pending_confirmation') {
      const confirmed = [keep, ...removing].find(item => item.information_type !== 'pending_confirmation');
      if (confirmed) keep.information_type = confirmed.information_type;
    }
    const removeSet = new Set(preview.details.removeRefs);
    next.behaviors.forEach(behavior => {
      if (removeSet.has(behavior.actor_department_data_ref)) behavior.actor_department_data_ref = keepRef;
    });
    next.forms.forEach(form => form.areas.forEach(area => area.items.forEach(item => {
      if (removeSet.has(item.business_data_ref)) item.business_data_ref = keepRef;
      if (fieldRefRemap.has(item.data_field_ref)) item.data_field_ref = fieldRefRemap.get(item.data_field_ref);
      item.source_links.forEach(link => {
        if (link.source_type === 'process_data' && removeSet.has(link.source_data_ref)) link.source_data_ref = keepRef;
      });
    })));
    next.data_objects = next.data_objects.filter(item => !removeSet.has(item.data_ref));
    const integrityErrors = technicalIntegrity(next);
    if (integrityErrors.length) return resultError('MERGE_VALIDATION_FAILED', '归并后的技术引用检查未通过', { errors: integrityErrors });
    return resultOk(next, { ...preview.details, mergedInto: keepRef });
  }

  function applyCommand(documentValue, command) {
    if (!documentValue || typeof documentValue !== 'object') return resultError('DRAFT_MISSING', '当前没有可编辑草稿');
    const next = clone(documentValue);
    switch (command?.type) {
      case 'add_behavior': {
        const item = clone(command.behavior || {});
        if (!refIsValid(item.behavior_ref)) return resultError('INVALID_REF', '业务行为技术标识无效');
        if (!NODE_TYPES.has(item.node_type)) return resultError('INVALID_NODE_TYPE', '节点类型无效');
        if (next.behaviors.some(existing => existing.behavior_ref === item.behavior_ref)) return resultError('DUPLICATE_REF', '业务行为技术标识重复');
        next.behaviors.push(item);
        return resultOk(next, { selected: { kind: 'behavior', ref: item.behavior_ref } });
      }
      case 'update_behavior': {
        const item = clone(command.behavior || {});
        const index = next.behaviors.findIndex(existing => existing.behavior_ref === item.behavior_ref);
        if (index < 0) return resultError('OBJECT_NOT_FOUND', '业务行为不存在');
        if (!NODE_TYPES.has(item.node_type)) return resultError('INVALID_NODE_TYPE', '节点类型无效');
        next.behaviors[index] = item;
        return resultOk(next, { selected: { kind: 'behavior', ref: item.behavior_ref } });
      }
      case 'upsert_flow_relation': {
        const relation = clone(command.relation || {});
        if (!refIsValid(relation.relation_ref)) return resultError('INVALID_REF', '流程关系技术标识无效');
        const index = next.flow_relations.findIndex(item => item.relation_ref === relation.relation_ref);
        const errors = relationHardErrors(next, relation, index >= 0 ? relation.relation_ref : '');
        if (errors.length) return resultError('FLOW_RELATION_BLOCKED', `关系未建立：${errors.join('；')}`, { errors });
        if (index >= 0) next.flow_relations[index] = relation;
        else next.flow_relations.push(relation);
        return resultOk(next, { selected: { kind: 'relation', ref: relation.relation_ref }, warnings: relationWarnings(next, relation) });
      }
      case 'set_data_operations': {
        const dataObject = next.data_objects.find(item => item.data_ref === command.dataRef);
        if (!dataObject) return resultError('OBJECT_NOT_FOUND', '数据对象不存在');
        const existing = dataObject.behavior_links.filter(link => link.behavior_ref === command.behaviorRef);
        const errors = dataOperationHardErrors(next, command.dataRef, command.behaviorRef, command.operations, existing.map(link => link.link_ref));
        if (errors.length) return resultError('DATA_RELATION_BLOCKED', `数据关系未建立：${errors.join('；')}`, { errors });
        const requestedUpdatedFieldRefs = unique(array(command.updatedFieldRefs));
        if (
          unique(command.operations).includes('update')
          && command.updatedFieldRefs !== undefined
          && requestedUpdatedFieldRefs.some(fieldRef => !array(dataObject.fields).some(field => field.field_ref === fieldRef))
        ) {
          return resultError('DATA_RELATION_BLOCKED', '数据关系未建立：所选更新字段不属于当前数据对象');
        }
        const byOperation = new Map(existing.map(link => [link.operation, link]));
        dataObject.behavior_links = dataObject.behavior_links.filter(link => link.behavior_ref !== command.behaviorRef);
        unique(command.operations).forEach(operation => {
          const previous = byOperation.get(operation);
          const updatedFieldRefs = operation === 'update'
            ? unique(array(command.updatedFieldRefs === undefined ? previous?.updated_field_refs : command.updatedFieldRefs))
            : [];
          dataObject.behavior_links.push({ ...(previous || {
            link_ref: command.refFactory(operation),
            behavior_ref: command.behaviorRef,
            operation
          }), updated_field_refs: updatedFieldRefs });
        });
        const integrityErrors = technicalIntegrity(next);
        if (integrityErrors.length) return resultError('DATA_RELATION_BLOCKED', `数据关系未建立：${integrityErrors[0].message}`, { errors: integrityErrors });
        return resultOk(next, { selected: { kind: 'data', ref: command.dataRef } });
      }
      case 'add_data_object': {
        const item = clone(command.dataObject || {});
        if (!refIsValid(item.data_ref)) return resultError('INVALID_REF', '数据对象技术标识无效');
        if (next.data_objects.some(existing => existing.data_ref === item.data_ref)) return resultError('DUPLICATE_REF', '数据对象技术标识重复');
        next.data_objects.push(item);
        return resultOk(next, { selected: { kind: 'data', ref: item.data_ref } });
      }
      case 'update_data_object': {
        const item = clone(command.dataObject || {});
        const index = next.data_objects.findIndex(existing => existing.data_ref === item.data_ref);
        if (index < 0) return resultError('OBJECT_NOT_FOUND', '数据对象不存在');
        next.data_objects[index] = item;
        return resultOk(next, { selected: { kind: 'data', ref: item.data_ref } });
      }
      case 'delete_object':
        return deleteObject(next, command.kind, command.ref);
      case 'merge_data_objects':
        return mergeDataObjects(next, command.keepRef, command.removeRefs, command.valueChoices);
      default:
        return resultError('UNKNOWN_COMMAND', '不支持的图编辑命令');
    }
  }

  return {
    clone,
    technicalIntegrity,
    relationHardErrors,
    relationWarnings,
    dataOperationHardErrors,
    analyzeDeletion,
    migrationReferences,
    mergePreview,
    mergeDataObjects,
    deleteObject,
    applyCommand
  };
}));
