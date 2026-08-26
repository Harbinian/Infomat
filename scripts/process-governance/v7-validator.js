const V7 = 'process-governance-v7';

function list(value) {
  return Array.isArray(value) ? value : [];
}

function validateProcessGovernanceV7(document, options = {}) {
  const schemaValidator = options.schemaValidator;
  if (typeof schemaValidator !== 'function') {
    throw new TypeError('validateProcessGovernanceV7 requires a schemaValidator compiled from process-governance-v7.schema.json');
  }
  const schemaValid = schemaValidator(document);
  const errors = schemaValid ? [] : list(schemaValidator.errors).map(error => ({
    path: error.instancePath || '/',
    keyword: error.keyword,
    message: error.message || '不符合process-governance-v7结构规则',
    params: error.params || {}
  }));

  const addError = (pathValue, message, params = {}, keyword = 'localReference', ruleCode = '') => {
    errors.push({
      path: pathValue,
      keyword,
      message,
      params,
      ...(ruleCode ? { rule_code: ruleCode } : {})
    });
  };
  const uniqueRefs = (items, key, basePath, registry = null) => {
    const seen = new Set();
    list(items).forEach((item, index) => {
      const value = item && item[key];
      if (!value) return;
      const itemPath = `${basePath}/${index}/${key}`;
      if (seen.has(value)) addError(itemPath, `技术标识 ${value} 在当前范围内重复`, { ref: value });
      seen.add(value);
      if (registry) {
        if (registry.has(value)) addError(itemPath, `技术标识 ${value} 与 ${registry.get(value)} 重复`, { ref: value });
        else registry.set(value, itemPath);
      }
    });
    return seen;
  };
  const requireRef = (allowed, value, pathValue, label) => {
    if (value && !allowed.has(value)) addError(pathValue, `${label} ${value} 不在当前文件中`, { ref: value });
  };

  const behaviors = list(document && document.behaviors);
  const flowRelations = list(document && document.flow_relations);
  const dataObjects = list(document && document.data_objects);
  const forms = list(document && document.forms);
  const migration = document && document.migration || {};
  const technicalIds = new Map();

  uniqueRefs([document && document.export_meta], 'package_ref', '/export_meta', technicalIds);
  uniqueRefs([document && document.process], 'process_ref', '/process', technicalIds);
  const behaviorRefs = uniqueRefs(behaviors, 'behavior_ref', '/behaviors', technicalIds);
  const relationRefs = uniqueRefs(flowRelations, 'relation_ref', '/flow_relations', technicalIds);
  const dataRefs = uniqueRefs(dataObjects, 'data_ref', '/data_objects', technicalIds);
  const formRefs = uniqueRefs(forms, 'form_ref', '/forms', technicalIds);
  uniqueRefs(document && document.terms, 'term_ref', '/terms', technicalIds);

  const behaviorByRef = new Map(behaviors.map(item => [item && item.behavior_ref, item]));
  behaviors.forEach((behavior, index) => {
    requireRef(dataRefs, behavior && behavior.actor_department_data_ref, `/behaviors/${index}/actor_department_data_ref`, '动态执行部门来源数据');
  });

  const exactRelations = new Map();
  flowRelations.forEach((relation, index) => {
    requireRef(behaviorRefs, relation && relation.from_behavior_ref, `/flow_relations/${index}/from_behavior_ref`, '起点业务行为');
    requireRef(behaviorRefs, relation && relation.to_behavior_ref, `/flow_relations/${index}/to_behavior_ref`, '终点业务行为');
    if (relation && relation.from_behavior_ref && relation.from_behavior_ref === relation.to_behavior_ref) {
      addError(`/flow_relations/${index}/to_behavior_ref`, '流程关系的起点和终点不能相同', { ref: relation.relation_ref });
    }
    const duplicateKey = relation && ['condition', 'loop'].includes(relation.relation_type)
      ? [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref, relation.condition].join('|')
      : [relation && relation.relation_type, relation && relation.from_behavior_ref, relation && relation.to_behavior_ref].join('|');
    if (exactRelations.has(duplicateKey)) {
      addError(`/flow_relations/${index}`, `流程关系与${exactRelations.get(duplicateKey)}完全重复`, { ref: relation && relation.relation_ref });
    } else {
      exactRelations.set(duplicateKey, relation && relation.relation_ref);
    }
  });

  const fieldOwners = new Map();
  const dataLinkRefs = new Set();
  dataObjects.forEach((dataObject, dataIndex) => {
    const fields = list(dataObject && dataObject.fields);
    const fieldRefs = uniqueRefs(fields, 'field_ref', `/data_objects/${dataIndex}/fields`, technicalIds);
    const fieldKeys = new Map();
    fields.forEach((field, fieldIndex) => {
      if (field && field.field_ref) fieldOwners.set(field.field_ref, dataObject.data_ref);
      const normalizedName = String(field && field.field_name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
      const normalizedType = String(field && field.field_type || '').trim().toLocaleLowerCase();
      const key = `${normalizedName}|${normalizedType}`;
      if (key === '|') return;
      if (fieldKeys.has(key)) {
        addError(`/data_objects/${dataIndex}/fields/${fieldIndex}`, `对象字段与${fieldKeys.get(key)}的名称和数据类型重复`, { ref: field && field.field_ref });
      } else {
        fieldKeys.set(key, `/data_objects/${dataIndex}/fields/${fieldIndex}`);
      }
    });

    uniqueRefs(dataObject && dataObject.behavior_links, 'link_ref', `/data_objects/${dataIndex}/behavior_links`, technicalIds)
      .forEach(ref => dataLinkRefs.add(ref));
    uniqueRefs(dataObject && dataObject.source_relations, 'source_ref', `/data_objects/${dataIndex}/source_relations`, technicalIds);
    const operationsByBehavior = new Map();
    list(dataObject && dataObject.behavior_links).forEach((link, linkIndex) => {
      const linkPath = `/data_objects/${dataIndex}/behavior_links/${linkIndex}`;
      requireRef(behaviorRefs, link && link.behavior_ref, `${linkPath}/behavior_ref`, '数据关系对应行为');
      if (link && link.behavior_ref && behaviorByRef.get(link.behavior_ref) && behaviorByRef.get(link.behavior_ref).node_type !== 'action') {
        addError(
          `${linkPath}/behavior_ref`,
          '数据关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
          { ref: link.behavior_ref },
          'localReference',
          'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'
        );
      }
      const updatedRefs = list(link && link.updated_field_refs);
      if (link && link.operation !== 'update' && updatedRefs.length) {
        addError(`${linkPath}/updated_field_refs`, '只有更新操作可以登记更新字段', { ref: link.link_ref });
      }
      updatedRefs.forEach((fieldRef, fieldIndex) => requireRef(fieldRefs, fieldRef, `${linkPath}/updated_field_refs/${fieldIndex}`, '更新字段'));
      if (!operationsByBehavior.has(link && link.behavior_ref)) operationsByBehavior.set(link && link.behavior_ref, new Set());
      operationsByBehavior.get(link && link.behavior_ref).add(link && link.operation);
    });
    operationsByBehavior.forEach((operations, behaviorRef) => {
      if (operations.has('pending_confirmation') && operations.size > 1) {
        addError(`/data_objects/${dataIndex}/behavior_links`, `数据对象与行为 ${behaviorRef} 的待确认操作不能与已确认操作并存`, { ref: behaviorRef });
      }
    });
    list(dataObject && dataObject.source_relations).forEach((source, sourceIndex) => {
      requireRef(behaviorRefs, source && source.available_from_behavior_ref, `/data_objects/${dataIndex}/source_relations/${sourceIndex}/available_from_behavior_ref`, '数据可用位置');
    });
    uniqueRefs(dataObject && dataObject.lifecycle && dataObject.lifecycle.routes, 'route_ref', `/data_objects/${dataIndex}/lifecycle/routes`, technicalIds);
    list(dataObject && dataObject.lifecycle && dataObject.lifecycle.routes).forEach((route, routeIndex) => {
      list(route && route.flow_relation_refs).forEach((ref, refIndex) => requireRef(relationRefs, ref, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/flow_relation_refs/${refIndex}`, '生命周期路径对应流程关系'));
      uniqueRefs(route && route.events, 'event_ref', `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events`, technicalIds);
      list(route && route.events).forEach((event, eventIndex) => {
        requireRef(behaviorRefs, event && event.trigger && event.trigger.behavior_ref, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events/${eventIndex}/trigger/behavior_ref`, '生命周期事件触发行为');
      });
    });
  });

  forms.forEach((form, formIndex) => {
    uniqueRefs(form && form.behavior_links, 'link_ref', `/forms/${formIndex}/behavior_links`, technicalIds);
    list(form && form.behavior_links).forEach((link, linkIndex) => {
      const linkPath = `/forms/${formIndex}/behavior_links/${linkIndex}/behavior_ref`;
      requireRef(behaviorRefs, link && link.behavior_ref, linkPath, '表单关系对应行为');
      if (link && link.behavior_ref && behaviorByRef.get(link.behavior_ref) && behaviorByRef.get(link.behavior_ref).node_type !== 'action') {
        addError(
          linkPath,
          '表单处理关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
          { ref: link.behavior_ref },
          'localReference',
          'FORM_RELATION_ACTION_BEHAVIOR_REQUIRED'
        );
      }
    });
    uniqueRefs(form && form.areas, 'area_ref', `/forms/${formIndex}/areas`, technicalIds);
    list(form && form.areas).forEach((area, areaIndex) => {
      uniqueRefs(area && area.items, 'item_ref', `/forms/${formIndex}/areas/${areaIndex}/items`, technicalIds);
      list(area && area.items).forEach((item, itemIndex) => {
        const itemPath = `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}`;
        requireRef(dataRefs, item && item.business_data_ref, `${itemPath}/business_data_ref`, '字段归属数据');
        if (item && item.data_field_ref) {
          const ownerRef = fieldOwners.get(item.data_field_ref);
          if (!ownerRef) addError(`${itemPath}/data_field_ref`, `引用的对象字段 ${item.data_field_ref} 不在当前文件中`, { ref: item.data_field_ref });
          else if (ownerRef !== item.business_data_ref) addError(`${itemPath}/data_field_ref`, `引用的对象字段不属于字段已选择的数据对象 ${item.business_data_ref || '未选择'}`, { ref: item.data_field_ref, expected_data_ref: ownerRef });
          else {
            const owner = dataObjects.find(dataObject => dataObject && dataObject.data_ref === ownerRef);
            const field = list(owner && owner.fields).find(candidate => candidate && candidate.field_ref === item.data_field_ref);
            if (field && field.field_type !== item.item_type) addError(`${itemPath}/item_type`, '表单字段的数据类型与引用的对象字段不一致', { ref: item.data_field_ref, expected: field.field_type, actual: item.item_type });
          }
        }
        uniqueRefs(item && item.source_links, 'source_link_ref', `${itemPath}/source_links`, technicalIds);
        list(item && item.source_links).forEach((source, sourceIndex) => {
          if (source && source.source_type !== 'external_system') requireRef(dataRefs, source.source_data_ref, `${itemPath}/source_links/${sourceIndex}/source_data_ref`, '字段取值来源数据');
        });
      });
    });
  });

  uniqueRefs(migration.reference_materials, 'material_ref', '/migration/reference_materials', technicalIds);
  uniqueRefs(migration.internal_process_calls, 'call_ref', '/migration/internal_process_calls', technicalIds);
  uniqueRefs(migration.work_roles, 'archive_ref', '/migration/work_roles', technicalIds);
  uniqueRefs(migration.unresolved_actor_roles, 'record_ref', '/migration/unresolved_actor_roles', technicalIds);
  uniqueRefs(migration.unresolved_join_modes, 'record_ref', '/migration/unresolved_join_modes', technicalIds);
  uniqueRefs(migration.legacy_cross_department_records, 'record_ref', '/migration/legacy_cross_department_records', technicalIds);
  list(migration.internal_process_calls).forEach((call, index) => {
    requireRef(behaviorRefs, call && call.caller_behavior_ref, `/migration/internal_process_calls/${index}/caller_behavior_ref`, '调用行为');
    requireRef(behaviorRefs, call && call.return_behavior_ref, `/migration/internal_process_calls/${index}/return_behavior_ref`, '返回后的恢复行为');
    list(call && call.input_data_refs).forEach((ref, refIndex) => requireRef(dataRefs, ref, `/migration/internal_process_calls/${index}/input_data_refs/${refIndex}`, '调用输入数据'));
    list(call && call.output_data_refs).forEach((ref, refIndex) => requireRef(dataRefs, ref, `/migration/internal_process_calls/${index}/output_data_refs/${refIndex}`, '调用输出数据'));
  });
  list(migration.unresolved_actor_roles).forEach((record, index) => requireRef(behaviorRefs, record && record.behavior_ref, `/migration/unresolved_actor_roles/${index}/behavior_ref`, '待确认执行主体对应行为'));
  list(migration.unresolved_join_modes).forEach((record, index) => requireRef(relationRefs, record && record.relation_ref, `/migration/unresolved_join_modes/${index}/relation_ref`, '待确认汇合方式对应关系'));
  list(migration.legacy_cross_department_records).forEach((record, index) => {
    const source = record && record.source_handoff || {};
    requireRef(behaviorRefs, source.anchor_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/anchor_behavior_ref`, '旧跨部门记录锚点行为');
    requireRef(behaviorRefs, source.resume_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/resume_behavior_ref`, '旧跨部门记录恢复行为');
    requireRef(dataRefs, source.transfer_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/transfer_data_ref`, '旧跨部门记录传递数据');
    requireRef(dataRefs, source.returned_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/returned_data_ref`, '旧跨部门记录返回数据');
    requireRef(behaviorRefs, record && record.created_behavior_ref, `/migration/legacy_cross_department_records/${index}/created_behavior_ref`, '旧跨部门记录创建行为');
    list(record && record.created_relation_refs).forEach((ref, refIndex) => requireRef(relationRefs, ref, `/migration/legacy_cross_department_records/${index}/created_relation_refs/${refIndex}`, '旧跨部门记录创建关系'));
    list(record && record.created_data_link_refs).forEach((ref, refIndex) => requireRef(dataLinkRefs, ref, `/migration/legacy_cross_department_records/${index}/created_data_link_refs/${refIndex}`, '旧跨部门记录创建数据关系'));
  });

  const errorsById = new Map();
  errors.forEach(error => {
    const qualifier = error.params && (error.params.ref || error.params.missingProperty || error.params.expected || (error.params.allowedValues ? JSON.stringify(error.params.allowedValues) : ''));
    const errorId = `${error.keyword || 'validation'}:${error.path || '/'}:${qualifier || ''}`;
    if (!errorsById.has(errorId)) errorsById.set(errorId, { ...error, error_id: errorId });
  });
  const deduplicatedErrors = [...errorsById.values()];
  return { valid: deduplicatedErrors.length === 0, errors: deduplicatedErrors };
}

module.exports = {
  V7,
  validateProcessGovernanceV7
};
