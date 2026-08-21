(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProcessGovernanceMigration = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createMigrationApi() {
  'use strict';

  const TARGET_VERSION = 'process-governance-v7';
  const SUPPORTED_PROCESS_VERSIONS = [
    'process-governance-v1',
    'process-governance-v2',
    'process-governance-v3',
    'process-governance-v4',
    'process-governance-v5',
    'process-governance-v6',
    TARGET_VERSION
  ];
  const LEGACY_DOCUMENT_VERSION = 'document-structured-output-v2';
  const NODE_TYPES = new Set(['', 'action', 'decision', 'parallel_split', 'parallel_join']);
  const RELATION_TYPES = new Set(['', 'sequence', 'condition', 'loop', 'parallel']);
  const INFORMATION_TYPES = new Set([
    'pending_confirmation',
    'business_information',
    'business_conclusion',
    'business_status',
    'identifier',
    'file_attachment',
    'other_information_output'
  ]);
  const DATA_OPERATIONS = new Set(['create', 'update', 'use', 'pending_confirmation']);
  const FORM_OPERATIONS = new Set(['create', 'fill', 'modify', 'review', 'approve', 'confirm', 'read', 'archive', 'void']);
  const FIELD_ORIGIN_MODES = new Set(['direct_current_process', 'depends_on_data', 'pending_confirmation']);
  const FIELD_SOURCE_ROLES = new Set(['provides_value', 'calculation_input', 'validation_basis']);
  const FIELD_VALUE_USAGE_MODES = new Set([
    'authoritative_input', 'reuse_existing', 'calculated', 'external_source', 'pending_confirmation'
  ]);
  const ACTOR_MODES = new Set(['fixed_department', 'company_wide', 'dynamic_from_data']);
  const DEFAULT_DEPARTMENTS = [
    '公司领导', '工程技术部', '质量管理部', '财务部', '行政人事部',
    '经营发展部', '物资保障部', '项目管理部', '复材车间', '运维安环部'
  ];
  const DUTY_BY_PARTICIPATION = {
    initiator: '发起', executor: '办理', reviewer: '审核', approver: '批准',
    collaborator: '会签', provider: '发送', sender: '发送', receiver: '接收', countersigner: '会签'
  };

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function nullable(value) {
    const result = text(value).trim();
    return result || null;
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function uniqueStrings(value) {
    return [...new Set(array(value).map(item => text(item).trim()).filter(Boolean))];
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

  function pendingLifecycle() {
    return {
      applicability: 'pending_confirmation',
      entry_state: {
        business_validity: 'pending_confirmation',
        custody: 'pending_confirmation',
        identifiability_applicability: 'pending_confirmation',
        identifiability: 'pending_confirmation'
      },
      routes: [],
      analysis: {
        analyzer_version: '',
        source_fingerprint: '',
        status: 'not_analyzed'
      },
      decision_reason: '',
      decision_notes: ''
    };
  }

  function technicalRef(value, prefix, ...parts) {
    const candidate = text(value).trim();
    if (/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(candidate)) return candidate;
    return stableRef(prefix, candidate, ...parts);
  }

  function validationSucceeded(result) {
    if (result === true || result == null) return true;
    if (result === false) return false;
    return result.valid !== false;
  }

  function validationMessage(result, fallback) {
    if (!result || result === true) return fallback;
    if (typeof result === 'string') return result;
    const first = array(result.errors)[0];
    return first?.message || result.error || fallback;
  }

  function assertSource(source, options) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
      throw new Error('待迁移内容必须是一个结构化文件对象。');
    }
    const version = text(source.schema_version);
    if (!SUPPORTED_PROCESS_VERSIONS.includes(version) && version !== LEGACY_DOCUMENT_VERSION) {
      throw new Error(`不支持的结构化文件版本：${version || '未提供'}`);
    }
    if (typeof options.validateSource === 'function') {
      const result = options.validateSource(source);
      if (!validationSucceeded(result)) {
        throw new Error(`源文件未通过结构与引用检查：${validationMessage(result, '结构不完整')}`);
      }
    }
  }

  function assertTargets(documents, options) {
    if (typeof options.validateTarget !== 'function') return;
    documents.forEach((documentValue, index) => {
      const result = options.validateTarget(documentValue, index);
      if (!validationSucceeded(result)) {
        throw new Error(`第${index + 1}条流程迁移后未通过v7检查：${validationMessage(result, '结构不完整')}`);
      }
    });
  }

  function emptyMigration(sourceVersion, processRef, processCount) {
    return {
      source_schema_version: sourceVersion,
      source_process_ref: processRef || null,
      source_process_count: Math.max(1, Number(processCount) || 1),
      legacy_cross_department_records: [],
      reference_materials: [],
      internal_process_calls: [],
      work_roles: [],
      unresolved_actor_roles: [],
      unresolved_join_modes: []
    };
  }

  function normalizeLegacyHandoff(item, index) {
    const source = item && typeof item === 'object' ? item : {};
    const v1Inbound = source.handoff_direction == null && source.send_behavior_ref == null;
    return {
      handoff_ref: technicalRef(source.handoff_ref, 'legacy_handoff', index),
      handoff_direction: source.handoff_direction === 'inbound_prerequisite' || v1Inbound
        ? 'inbound_prerequisite'
        : 'outbound_followup',
      anchor_behavior_ref: nullable(source.anchor_behavior_ref || source.send_behavior_ref),
      counterparty_resolution: source.counterparty_resolution === 'identified' ? 'identified' : 'needs_identification',
      source_department: text(source.source_department),
      target_department: text(source.target_department),
      transfer_data_ref: nullable(source.transfer_data_ref || source.input_data_ref),
      returned_data_ref: nullable(source.returned_data_ref),
      requested_matter: text(source.requested_matter || source.handoff_matter),
      trigger_condition: text(source.trigger_condition),
      completion_standard: text(source.completion_standard || source.handoff_standard),
      counterparty_process_ref: nullable(source.counterparty_process_ref || source.target_process_ref),
      counterparty_process_name: text(source.counterparty_process_name || source.target_process_name),
      counterparty_behavior_ref: nullable(source.counterparty_behavior_ref || source.target_behavior_ref),
      counterparty_behavior_name: text(source.counterparty_behavior_name || source.target_behavior_name),
      requires_return: Boolean(source.requires_return || source.returned_data_ref || source.return_behavior_ref),
      resume_behavior_ref: nullable(source.resume_behavior_ref || source.return_behavior_ref)
    };
  }

  function normalizeLegacyRecord(record, index) {
    return {
      record_ref: technicalRef(record?.record_ref, 'legacy_cross_department_record', index),
      source_handoff: normalizeLegacyHandoff(record?.source_handoff, index),
      conversion_status: record?.conversion_status === 'converted' ? 'converted' : 'needs_manual_completion',
      conversion_reason: text(record?.conversion_reason),
      created_behavior_ref: nullable(record?.created_behavior_ref),
      created_relation_refs: uniqueStrings(record?.created_relation_refs),
      created_data_link_refs: uniqueStrings(record?.created_data_link_refs)
    };
  }

  function normalizeReferenceMaterial(item, index) {
    return {
      material_ref: technicalRef(item?.material_ref, 'material', index),
      material_type: ['', '现有制度', '表单或记录', '现行业务操作说明', '会议或访谈', '其他参考材料'].includes(item?.material_type)
        ? item.material_type
        : '其他参考材料',
      material_name: text(item?.material_name),
      document_no: nullable(item?.document_no),
      version: nullable(item?.version),
      file_sha256: nullable(item?.file_sha256),
      readable_text: text(item?.readable_text),
      provider_department: text(item?.provider_department),
      provider_name: text(item?.provider_name),
      as_of_date: nullable(item?.as_of_date)
    };
  }

  function normalizeInternalCall(item, index) {
    return {
      call_ref: technicalRef(item?.call_ref, 'internal_call', index),
      caller_behavior_ref: nullable(item?.caller_behavior_ref),
      target_process_ref: nullable(item?.target_process_ref),
      target_process_name: text(item?.target_process_name),
      input_data_refs: uniqueStrings(item?.input_data_refs),
      output_data_refs: uniqueStrings(item?.output_data_refs),
      return_behavior_ref: nullable(item?.return_behavior_ref)
    };
  }

  function normalizeWorkRoleArchive(item, index) {
    const workRole = item?.work_role || {};
    const behaviorRef = technicalRef(item?.behavior_ref || workRole.behavior_ref, 'behavior', index);
    return {
      archive_ref: technicalRef(item?.archive_ref, 'work_role_archive', behaviorRef, index),
      behavior_ref: behaviorRef,
      original_behavior_name: text(item?.original_behavior_name),
      work_role: {
        behavior_ref: behaviorRef,
        work_role_code: nullable(workRole.work_role_code),
        role_duty: ['', '发起', '办理', '审核', '批准', '判断', '发送', '接收', '会签'].includes(workRole.role_duty)
          ? workRole.role_duty
          : '',
        work_role_name: text(workRole.work_role_name),
        assignment_status: workRole.assignment_status === 'assigned' ? 'assigned' : 'pending_assignment'
      }
    };
  }

  function normalizeUnresolvedActor(item, index) {
    return {
      record_ref: technicalRef(item?.record_ref, 'unresolved_actor_role', index),
      behavior_ref: technicalRef(item?.behavior_ref, 'behavior', index),
      raw_actor_role: text(item?.raw_actor_role),
      original_actor_assignment_mode: text(item?.original_actor_assignment_mode),
      source_schema_version: text(item?.source_schema_version),
      reason: text(item?.reason)
    };
  }

  function normalizeUnresolvedJoin(item, index) {
    return {
      record_ref: technicalRef(item?.record_ref, 'unresolved_join_mode', index),
      relation_ref: technicalRef(item?.relation_ref, 'relation', index),
      original_join_mode: 'all',
      source_schema_version: text(item?.source_schema_version),
      reason: text(item?.reason)
    };
  }

  function normalizeExistingMigration(source, sourceVersion, processRef, processCount) {
    const existing = source?.migration && typeof source.migration === 'object' ? source.migration : {};
    const migration = emptyMigration(
      text(existing.source_schema_version) || sourceVersion,
      nullable(existing.source_process_ref) || processRef,
      existing.source_process_count || processCount
    );
    migration.legacy_cross_department_records = array(existing.legacy_cross_department_records).map(normalizeLegacyRecord);
    migration.reference_materials = array(existing.reference_materials).map(normalizeReferenceMaterial);
    migration.internal_process_calls = array(existing.internal_process_calls).map(normalizeInternalCall);
    migration.work_roles = array(existing.work_roles).map(normalizeWorkRoleArchive);
    migration.unresolved_actor_roles = array(existing.unresolved_actor_roles).map(normalizeUnresolvedActor);
    migration.unresolved_join_modes = array(existing.unresolved_join_modes).map(normalizeUnresolvedJoin);
    return migration;
  }

  function actorMode(item) {
    if (ACTOR_MODES.has(item?.actor_assignment_mode)) return item.actor_assignment_mode;
    if (text(item?.current_actor_role).trim() === '全公司') return 'company_wide';
    if (item?.actor_department_data_ref) return 'dynamic_from_data';
    return 'fixed_department';
  }

  function normalizeBehavior(item, index, context) {
    const behaviorRef = technicalRef(item?.behavior_ref, 'behavior', index);
    const mode = actorMode(item);
    const rawActor = text(item?.current_actor_role);
    let currentActorRole = mode === 'company_wide' ? '全公司' : mode === 'dynamic_from_data' ? '' : rawActor;
    if (mode === 'fixed_department' && rawActor.trim()) {
      const matchedDepartment = context.departments.find(department => rawActor.trim().startsWith(department));
      if (!matchedDepartment) {
        context.migration.unresolved_actor_roles.push({
          record_ref: stableRef('unresolved_actor_role', behaviorRef, rawActor),
          behavior_ref: behaviorRef,
          raw_actor_role: rawActor,
          original_actor_assignment_mode: text(item?.actor_assignment_mode) || 'fixed_department',
          source_schema_version: context.sourceVersion,
          reason: '固定执行主体无法匹配现行部门前缀；活动部门和岗位留空，原值保存在迁移归档。'
        });
        currentActorRole = '';
      }
    }
    if (item?.work_role) {
      const archiveRef = stableRef('work_role_archive', behaviorRef);
      if (!context.migration.work_roles.some(archive => archive.archive_ref === archiveRef)) {
        context.migration.work_roles.push(normalizeWorkRoleArchive({
          archive_ref: archiveRef,
          behavior_ref: behaviorRef,
          original_behavior_name: text(item?.behavior_name),
          work_role: item.work_role
        }, index));
      }
    }
    return {
      behavior_ref: behaviorRef,
      node_type: NODE_TYPES.has(item?.node_type) ? item.node_type : '',
      behavior_name: text(item?.behavior_name),
      behavior_description: text(item?.behavior_description),
      current_actor_role: currentActorRole,
      actor_assignment_mode: mode,
      actor_department_data_ref: mode === 'dynamic_from_data' ? nullable(item?.actor_department_data_ref) : null,
      actor_position_rule: mode === 'dynamic_from_data' ? text(item?.actor_position_rule) : '',
      trigger: text(item?.trigger),
      precondition: text(item?.precondition),
      input_description: text(item?.input_description),
      timing: nullable(item?.timing),
      completion_standard: text(item?.completion_standard),
      output_description: text(item?.output_description),
      countersign_all_required: Boolean(item?.countersign_all_required),
      countersign_target_departments: uniqueStrings(item?.countersign_target_departments)
    };
  }

  function normalizeRelation(item, index, context, behaviorByRef) {
    const relationRef = technicalRef(item?.relation_ref, 'relation', index);
    if (item?.join_mode === 'all') {
      const target = behaviorByRef.get(nullable(item?.to_behavior_ref));
      if (target?.node_type !== 'parallel_join') {
        const archiveRef = stableRef('unresolved_join_mode', relationRef);
        if (!context.migration.unresolved_join_modes.some(archive => archive.record_ref === archiveRef)) {
          context.migration.unresolved_join_modes.push({
            record_ref: archiveRef,
            relation_ref: relationRef,
            original_join_mode: 'all',
            source_schema_version: context.sourceVersion,
            reason: '原关系使用all，但终点不是并行汇合；关系保留，原值移入待确认归档。'
          });
        }
      }
    }
    return {
      relation_ref: relationRef,
      relation_type: RELATION_TYPES.has(item?.relation_type) ? item.relation_type : '',
      from_behavior_ref: nullable(item?.from_behavior_ref),
      to_behavior_ref: nullable(item?.to_behavior_ref),
      condition: text(item?.condition)
    };
  }

  function normalizeDataObject(item, index, sourceVersion) {
    const dataRef = technicalRef(item?.data_ref, 'data', index);
    const modern = ['process-governance-v4', 'process-governance-v5', 'process-governance-v6', TARGET_VERSION].includes(sourceVersion);
    const links = modern
      ? array(item?.behavior_links).map((link, linkIndex) => ({
          link_ref: technicalRef(link?.link_ref, 'data_link', dataRef, linkIndex),
          behavior_ref: technicalRef(link?.behavior_ref, 'behavior', linkIndex),
          operation: DATA_OPERATIONS.has(link?.operation) ? link.operation : 'pending_confirmation'
        }))
      : [
          ...(item?.produced_by_behavior_ref ? [{
            link_ref: stableRef('data_link', dataRef, 'create', item.produced_by_behavior_ref),
            behavior_ref: technicalRef(item.produced_by_behavior_ref, 'behavior', index),
            operation: 'create'
          }] : []),
          ...uniqueStrings(item?.consumed_by_behavior_refs).map((behaviorRef, linkIndex) => ({
            link_ref: stableRef('data_link', dataRef, 'use', behaviorRef, linkIndex),
            behavior_ref: technicalRef(behaviorRef, 'behavior', linkIndex),
            operation: 'use'
          }))
        ];
    return {
      data_ref: dataRef,
      data_name: text(item?.data_name),
      description: text(item?.description),
      information_type: INFORMATION_TYPES.has(item?.information_type) ? item.information_type : 'pending_confirmation',
      fields: sourceVersion === TARGET_VERSION ? array(item?.fields).map((field, fieldIndex) => ({
        field_ref: technicalRef(field?.field_ref, 'data_field', dataRef, fieldIndex),
        field_name: text(field?.field_name),
        field_type: text(field?.field_type),
        definition: text(field?.definition)
      })) : [],
      behavior_links: links,
      source_relations: modern ? array(item?.source_relations).map((source, sourceIndex) => ({
        source_ref: technicalRef(source?.source_ref, 'data_source', dataRef, sourceIndex),
        source_department: text(source?.source_department),
        source_process_name: text(source?.source_process_name),
        source_behavior_name: text(source?.source_behavior_name),
        source_data_name: text(source?.source_data_name),
        availability_mode: ['process_start', 'at_behavior', 'pending_confirmation'].includes(source?.availability_mode)
          ? source.availability_mode
          : 'pending_confirmation',
        available_from_behavior_ref: nullable(source?.available_from_behavior_ref)
      })) : [],
      lifecycle: sourceVersion === TARGET_VERSION && item?.lifecycle
        ? clone(item.lifecycle)
        : pendingLifecycle()
    };
  }

  function normalizeForm(item, formIndex, sourceVersion) {
    const modern = ['process-governance-v4', 'process-governance-v5', 'process-governance-v6', TARGET_VERSION].includes(sourceVersion);
    const formRef = technicalRef(item?.form_ref, 'form', formIndex);
    return {
      form_ref: formRef,
      form_name: text(item?.form_name),
      form_no: nullable(item?.form_no),
      form_design_state: ['unspecified', 'current_state', 'proposed_design'].includes(item?.form_design_state)
        ? item.form_design_state
        : 'unspecified',
      behavior_links: modern
        ? array(item?.behavior_links).map((link, linkIndex) => ({
            link_ref: technicalRef(link?.link_ref, 'form_link', formRef, linkIndex),
            behavior_ref: technicalRef(link?.behavior_ref, 'behavior', linkIndex),
            operations: uniqueStrings(link?.operations).filter(operation => FORM_OPERATIONS.has(operation)),
            notes: text(link?.notes)
          }))
        : (item?.behavior_ref ? [{
            link_ref: stableRef('form_link', formRef, item.behavior_ref),
            behavior_ref: technicalRef(item.behavior_ref, 'behavior', formIndex),
            operations: [],
            notes: ''
          }] : []),
      areas: array(item?.areas).map((area, areaIndex) => ({
        area_ref: technicalRef(area?.area_ref, 'area', formRef, areaIndex),
        area_type: ['', '基本信息', '明细清单'].includes(area?.area_type) ? area.area_type : '',
        area_title: text(area?.area_title),
        items: array(area?.items).map((field, fieldIndex) => ({
          item_ref: technicalRef(field?.item_ref, 'item', formRef, areaIndex, fieldIndex),
          item_name: text(field?.item_name),
          item_type: text(field?.item_type),
          required: Boolean(field?.required),
          instructions: text(field?.instructions),
          business_data_ref: modern ? nullable(field?.business_data_ref) : null,
          data_field_ref: sourceVersion === TARGET_VERSION ? nullable(field?.data_field_ref) : null,
          value_usage_mode: sourceVersion === TARGET_VERSION && FIELD_VALUE_USAGE_MODES.has(field?.value_usage_mode)
            ? field.value_usage_mode
            : '',
          value_origin_mode: modern && FIELD_ORIGIN_MODES.has(field?.value_origin_mode)
            ? field.value_origin_mode
            : 'pending_confirmation',
          source_links: modern ? array(field?.source_links).map((link, linkIndex) => {
            const sourceType = link?.source_type === 'external_system' ? 'external_system' : 'process_data';
            return {
              source_link_ref: technicalRef(link?.source_link_ref, 'field_source', formRef, areaIndex, fieldIndex, linkIndex),
              source_type: sourceType,
              source_data_ref: sourceType === 'external_system' ? null : nullable(link?.source_data_ref),
              source_system_name: sourceType === 'external_system' ? text(link?.source_system_name) : '',
              source_data_name: sourceType === 'external_system' ? text(link?.source_data_name) : '',
              source_role: FIELD_SOURCE_ROLES.has(link?.source_role) ? link.source_role : 'provides_value'
            };
          }) : []
        }))
      }))
    };
  }

  function normalizeFieldMatchPart(value) {
    return text(value).trim().replace(/\s+/g, ' ').toLocaleLowerCase();
  }

  function dataFieldMatchKey(fieldName, fieldType) {
    return `${normalizeFieldMatchPart(fieldName)}|${normalizeFieldMatchPart(fieldType)}`;
  }

  function inferredUsageMode(item) {
    if (FIELD_VALUE_USAGE_MODES.has(item?.value_usage_mode)) return item.value_usage_mode;
    if (array(item?.source_links).some(link => link?.source_type === 'external_system')) return 'external_source';
    if (array(item?.source_links).some(link => link?.source_role === 'calculation_input')) return 'calculated';
    if (item?.value_origin_mode === 'direct_current_process') return 'authoritative_input';
    if (item?.value_origin_mode === 'depends_on_data') return 'reuse_existing';
    return 'pending_confirmation';
  }

  function ensureDataFieldReferences(documentValue) {
    const dataObjects = array(documentValue?.data_objects);
    const dataByRef = new Map(dataObjects.map(item => [item.data_ref, item]));
    const fieldOwners = new Map();
    const fieldRefRemap = new Map();

    dataObjects.forEach(dataObject => {
      const uniqueFields = [];
      const fieldsByKey = new Map();
      array(dataObject.fields).forEach((field, fieldIndex) => {
        const normalized = {
          field_ref: technicalRef(field?.field_ref, 'data_field', dataObject.data_ref, fieldIndex),
          field_name: text(field?.field_name),
          field_type: text(field?.field_type),
          definition: text(field?.definition)
        };
        const key = dataFieldMatchKey(normalized.field_name, normalized.field_type);
        const existing = key !== '|' ? fieldsByKey.get(key) : null;
        if (existing) {
          fieldRefRemap.set(normalized.field_ref, existing.field_ref);
          return;
        }
        if (key !== '|') fieldsByKey.set(key, normalized);
        uniqueFields.push(normalized);
        fieldOwners.set(normalized.field_ref, dataObject.data_ref);
      });
      dataObject.fields = uniqueFields;
    });

    const contexts = [];
    array(documentValue?.forms).forEach((form, formIndex) => {
      array(form?.areas).forEach((area, areaIndex) => {
        array(area?.items).forEach((item, itemIndex) => {
          if (fieldRefRemap.has(item.data_field_ref)) item.data_field_ref = fieldRefRemap.get(item.data_field_ref);
          contexts.push({ form, formIndex, area, areaIndex, item, itemIndex });
        });
      });
    });

    contexts.forEach(context => {
      const { item } = context;
      const existingOwnerRef = fieldOwners.get(item.data_field_ref);
      if (existingOwnerRef) {
        const owner = dataByRef.get(existingOwnerRef);
        const field = array(owner?.fields).find(candidate => candidate.field_ref === item.data_field_ref);
        item.business_data_ref = existingOwnerRef;
        if (field?.field_type) item.item_type = field.field_type;
        return;
      }
      item.data_field_ref = null;
      const owner = dataByRef.get(item.business_data_ref);
      const fieldName = text(item.item_name).trim();
      if (!owner || !fieldName) return;
      const key = dataFieldMatchKey(fieldName, item.item_type);
      let field = array(owner.fields).find(candidate => dataFieldMatchKey(candidate.field_name, candidate.field_type) === key);
      if (!field) {
        field = {
          field_ref: stableRef('data_field', owner.data_ref, normalizeFieldMatchPart(fieldName), normalizeFieldMatchPart(item.item_type)),
          field_name: fieldName,
          field_type: text(item.item_type),
          definition: ''
        };
        owner.fields.push(field);
        fieldOwners.set(field.field_ref, owner.data_ref);
      }
      item.data_field_ref = field.field_ref;
      if (field.field_type) item.item_type = field.field_type;
    });

    const contextsByField = new Map();
    contexts.forEach(context => {
      const ref = context.item.data_field_ref;
      if (!ref) {
        context.item.value_usage_mode = FIELD_VALUE_USAGE_MODES.has(context.item.value_usage_mode)
          ? context.item.value_usage_mode
          : 'pending_confirmation';
        return;
      }
      if (!contextsByField.has(ref)) contextsByField.set(ref, []);
      contextsByField.get(ref).push(context);
    });
    contextsByField.forEach(group => {
      const unresolved = group.filter(context => !FIELD_VALUE_USAGE_MODES.has(context.item.value_usage_mode));
      if (!unresolved.length) return;
      const direct = unresolved.filter(context => context.item.value_origin_mode === 'direct_current_process');
      if (direct.length === 1) {
        direct[0].item.value_usage_mode = 'authoritative_input';
        unresolved.filter(context => context !== direct[0]).forEach(context => {
          const inferred = inferredUsageMode(context.item);
          context.item.value_usage_mode = ['external_source', 'calculated'].includes(inferred) ? inferred : 'reuse_existing';
        });
        return;
      }
      if (direct.length > 1) {
        direct.forEach(context => { context.item.value_usage_mode = 'authoritative_input'; });
        unresolved.filter(context => !direct.includes(context)).forEach(context => {
          const inferred = inferredUsageMode(context.item);
          context.item.value_usage_mode = ['external_source', 'calculated'].includes(inferred) ? inferred : 'reuse_existing';
        });
        return;
      }
      const establishing = unresolved.filter(context => ['external_source', 'calculated'].includes(inferredUsageMode(context.item)));
      if (establishing.length === 1 && group.length > 1) {
        establishing[0].item.value_usage_mode = inferredUsageMode(establishing[0].item);
        unresolved.filter(context => context !== establishing[0]).forEach(context => {
          context.item.value_usage_mode = 'reuse_existing';
        });
        return;
      }
      unresolved.forEach(context => { context.item.value_usage_mode = inferredUsageMode(context.item); });
    });
    return documentValue;
  }

  function needsDataFieldUpgrade(source) {
    if (source?.schema_version !== TARGET_VERSION) return false;
    if (array(source?.data_objects).some(dataObject => !Array.isArray(dataObject?.fields))) return true;
    return array(source?.forms).some(form => array(form?.areas).some(area => array(area?.items).some(item =>
      !Object.prototype.hasOwnProperty.call(item || {}, 'data_field_ref')
      || !FIELD_VALUE_USAGE_MODES.has(item?.value_usage_mode)
    )));
  }

  function addSequence(documentValue, fromRef, toRef, handoffRef, suffix) {
    if (!fromRef || !toRef || fromRef === toRef) return null;
    const existing = documentValue.flow_relations.find(relation =>
      relation.from_behavior_ref === fromRef && relation.to_behavior_ref === toRef && relation.relation_type !== 'loop'
    );
    if (existing) return existing.relation_ref;
    const relationRef = stableRef('relation', handoffRef, suffix, fromRef, toRef);
    documentValue.flow_relations.push({
      relation_ref: relationRef,
      relation_type: 'sequence',
      from_behavior_ref: fromRef,
      to_behavior_ref: toRef,
      condition: ''
    });
    return relationRef;
  }

  function addDataLink(documentValue, dataRef, behaviorRef, operation, handoffRef, suffix, reasons) {
    if (!dataRef || !behaviorRef) return null;
    const dataObject = documentValue.data_objects.find(item => item.data_ref === dataRef);
    if (!dataObject) {
      reasons.push(`数据${dataRef}不存在`);
      return null;
    }
    const existing = dataObject.behavior_links.find(link => link.behavior_ref === behaviorRef && link.operation === operation);
    if (existing) return existing.link_ref;
    if (operation === 'create' && dataObject.behavior_links.some(link => link.operation === 'create' && link.behavior_ref !== behaviorRef)) {
      reasons.push(`数据“${dataObject.data_name || dataRef}”已有其他创建行为`);
      return null;
    }
    const linkRef = stableRef('data_link', handoffRef, suffix, dataRef, behaviorRef);
    dataObject.behavior_links.push({ link_ref: linkRef, behavior_ref: behaviorRef, operation });
    return linkRef;
  }

  function convertLegacyHandoffs(documentValue, sourceHandoffs, context) {
    const insertCounts = new Map();
    return sourceHandoffs.map((raw, index) => {
      const handoff = normalizeLegacyHandoff(raw, index);
      const reasons = [];
      const createdRelationRefs = [];
      const createdDataLinkRefs = [];
      const externalDepartment = handoff.handoff_direction === 'inbound_prerequisite'
        ? handoff.source_department
        : handoff.target_department;
      let external = handoff.counterparty_behavior_ref
        ? documentValue.behaviors.find(item => item.behavior_ref === handoff.counterparty_behavior_ref)
        : null;
      let createdBehaviorRef = null;
      if (!external) {
        const actionName = handoff.counterparty_behavior_name || handoff.requested_matter;
        if (externalDepartment && actionName) {
          const behaviorRef = stableRef('behavior', 'legacy_cross_department', handoff.handoff_ref);
          external = documentValue.behaviors.find(item => item.behavior_ref === behaviorRef);
          if (!external) {
            external = {
              behavior_ref: behaviorRef,
              node_type: 'action',
              behavior_name: actionName,
              behavior_description: handoff.requested_matter !== actionName ? handoff.requested_matter : '',
              current_actor_role: externalDepartment,
              actor_assignment_mode: 'fixed_department',
              actor_department_data_ref: null,
              actor_position_rule: '',
              trigger: '',
              precondition: '',
              input_description: '',
              timing: null,
              completion_standard: handoff.completion_standard,
              output_description: '',
              countersign_all_required: false,
              countersign_target_departments: []
            };
            const anchorIndex = documentValue.behaviors.findIndex(item => item.behavior_ref === handoff.anchor_behavior_ref);
            if (anchorIndex < 0) documentValue.behaviors.push(external);
            else if (handoff.handoff_direction === 'inbound_prerequisite') documentValue.behaviors.splice(anchorIndex, 0, external);
            else {
              const offset = insertCounts.get(handoff.anchor_behavior_ref) || 0;
              documentValue.behaviors.splice(anchorIndex + offset + 1, 0, external);
              insertCounts.set(handoff.anchor_behavior_ref, offset + 1);
            }
            createdBehaviorRef = behaviorRef;
          }
        } else reasons.push('无法确定外部门业务行为');
      }
      const anchorExists = documentValue.behaviors.some(item => item.behavior_ref === handoff.anchor_behavior_ref);
      if (!anchorExists) reasons.push('本流程关联行为不存在');
      if (external && anchorExists) {
        const relationRef = handoff.handoff_direction === 'inbound_prerequisite'
          ? addSequence(documentValue, external.behavior_ref, handoff.anchor_behavior_ref, handoff.handoff_ref, 'inbound')
          : addSequence(documentValue, handoff.anchor_behavior_ref, external.behavior_ref, handoff.handoff_ref, 'outbound');
        if (relationRef) createdRelationRefs.push(relationRef);
      }
      const resumeExists = documentValue.behaviors.some(item => item.behavior_ref === handoff.resume_behavior_ref);
      if (handoff.requires_return) {
        if (!resumeExists) reasons.push('旧记录要求返回，但无法确定恢复行为');
        else if (external) {
          const relationRef = addSequence(documentValue, external.behavior_ref, handoff.resume_behavior_ref, handoff.handoff_ref, 'return');
          if (relationRef) createdRelationRefs.push(relationRef);
        }
      }
      const rememberDataLink = (dataRef, behaviorRef, operation, suffix) => {
        const linkRef = addDataLink(documentValue, dataRef, behaviorRef, operation, handoff.handoff_ref, suffix, reasons);
        if (linkRef) createdDataLinkRefs.push(linkRef);
      };
      if (handoff.transfer_data_ref) {
        if (handoff.handoff_direction === 'inbound_prerequisite') {
          if (external) rememberDataLink(handoff.transfer_data_ref, external.behavior_ref, 'create', 'transfer_create');
          if (anchorExists) rememberDataLink(handoff.transfer_data_ref, handoff.anchor_behavior_ref, 'use', 'transfer_use');
        } else if (external) rememberDataLink(handoff.transfer_data_ref, external.behavior_ref, 'use', 'transfer_use');
      }
      if (handoff.returned_data_ref) {
        if (external) rememberDataLink(handoff.returned_data_ref, external.behavior_ref, 'create', 'return_create');
        if (resumeExists) rememberDataLink(handoff.returned_data_ref, handoff.resume_behavior_ref, 'use', 'return_use');
      }
      return {
        record_ref: stableRef('legacy_cross_department_record', handoff.handoff_ref),
        source_handoff: handoff,
        conversion_status: reasons.length ? 'needs_manual_completion' : 'converted',
        conversion_reason: reasons.length ? [...new Set(reasons)].join('；') : '已转换为业务行为、普通流程关系和数据行为关系',
        created_behavior_ref: createdBehaviorRef,
        created_relation_refs: [...new Set(createdRelationRefs)],
        created_data_link_refs: [...new Set(createdDataLinkRefs)]
      };
    });
  }

  function migrateProcessDocument(source, options = {}) {
    const sourceVersion = text(source.schema_version);
    const processSource = source.process || {};
    const processRef = technicalRef(processSource.process_ref, 'process', 0);
    const migration = normalizeExistingMigration(source, sourceVersion, processRef, 1);
    const context = {
      sourceVersion,
      migration,
      departments: uniqueStrings(options.departments).length ? uniqueStrings(options.departments) : DEFAULT_DEPARTMENTS
    };
    const behaviors = array(source.behaviors).map((item, index) => normalizeBehavior(item, index, context));
    const behaviorByRef = new Map(behaviors.map(item => [item.behavior_ref, item]));
    const documentValue = {
      schema_version: TARGET_VERSION,
      export_meta: {
        package_ref: technicalRef(source.export_meta?.package_ref, 'package', processRef),
        exported_at: text(source.export_meta?.exported_at) || '1970-01-01T00:00:00.000Z',
        initiating_department: text(source.export_meta?.initiating_department),
        compiler: text(source.export_meta?.compiler)
      },
      process: {
        process_ref: processRef,
        process_name: text(processSource.process_name),
        owning_department: text(processSource.owning_department),
        purpose: text(processSource.purpose),
        scope: text(processSource.scope),
        capability_domain: nullable(processSource.capability_domain),
        business_capability: nullable(processSource.business_capability),
        classification_status: ['unclassified', 'needs_review', 'confirmed'].includes(processSource.classification_status)
          ? processSource.classification_status
          : 'unclassified'
      },
      behaviors,
      flow_relations: array(source.flow_relations).map((item, index) => normalizeRelation(item, index, context, behaviorByRef)),
      data_objects: array(source.data_objects).map((item, index) => normalizeDataObject(item, index, sourceVersion)),
      forms: array(source.forms).map((item, index) => normalizeForm(item, index, sourceVersion)),
      terms: array(source.terms).map((item, index) => ({
        term_ref: technicalRef(item?.term_ref, 'term', index),
        term_name: text(item?.term_name),
        definition: text(item?.definition)
      })),
      migration
    };
    migration.reference_materials.push(...array(source.reference_materials).map(normalizeReferenceMaterial));
    migration.internal_process_calls.push(...array(source.internal_process_calls).map(normalizeInternalCall));
    migration.reference_materials = [...new Map(migration.reference_materials.map(item => [item.material_ref, item])).values()];
    migration.internal_process_calls = [...new Map(migration.internal_process_calls.map(item => [item.call_ref, item])).values()];
    const legacyHandoffs = array(source.cross_department_handoffs);
    if (legacyHandoffs.length) {
      migration.legacy_cross_department_records = convertLegacyHandoffs(documentValue, legacyHandoffs, context);
    }
    return ensureDataFieldReferences(documentValue);
  }

  function legacyMaterial(source, options, processRef) {
    const profile = source.document_profile || {};
    const draft = source.draft || {};
    return {
      material_ref: stableRef('material', processRef, 'legacy_document'),
      material_type: draft.basis_type === '表单 / 台账' ? '表单或记录' : '现有制度',
      material_name: text(profile.document_title || draft.document_title || options.fileName || '历史结构化文件'),
      document_no: nullable(profile.document_no || draft.document_no),
      version: nullable(draft.planned_edition),
      file_sha256: nullable(options.fileSha256),
      readable_text: text(source.markdown_draft),
      provider_department: text(draft.department?.department_name),
      provider_name: '',
      as_of_date: null
    };
  }

  function splitLegacyDocument(source, options = {}) {
    const processList = array(source.processes).length ? source.processes : [{
      process_ref: source.draft?.draft_ref || stableRef('legacy_process', source.draft?.process_name),
      l1_name: source.draft?.l1_name || '',
      l2_name: source.draft?.l2_name || '',
      l3_name: source.draft?.l3_name || source.draft?.process_name || ''
    }];
    return processList.map((legacyProcess, processIndex) => {
      const oldProcessRef = legacyProcess.process_ref;
      let steps = array(source.steps).filter(step => step.process_ref === oldProcessRef);
      if (!steps.length && processList.length === 1) steps = array(source.steps);
      const stepMap = new Map(steps.map((step, index) => [step.step_ref, technicalRef(step.step_ref, 'behavior', processIndex, index)]));
      const dataObjects = [];
      const outputByStep = new Map();
      const bindings = array(source.work_role_bindings);
      const behaviors = steps.map((step, index) => {
        const behaviorRef = stepMap.get(step.step_ref);
        const detail = array(source.behavior_details).find(item => item.step_ref === step.step_ref) || {};
        const binding = bindings.find(item => item.step_ref === step.step_ref);
        const outputDescription = text(step.output_result || detail.delivery_object);
        if (outputDescription) {
          const dataRef = stableRef('data', oldProcessRef, step.step_ref, 'output');
          outputByStep.set(step.step_ref, dataRef);
          dataObjects.push({
            data_ref: dataRef,
            data_name: outputDescription.slice(0, 120),
            description: outputDescription,
            governance_status: 'candidate',
            produced_by_behavior_ref: behaviorRef,
            consumed_by_behavior_refs: []
          });
        }
        const duty = DUTY_BY_PARTICIPATION[binding?.participation_type] || '';
        return {
          behavior_ref: behaviorRef,
          node_type: step.step_type === 'decision' ? 'decision' : step.step_type === 'action' ? 'action' : '',
          behavior_name: text(step.step_name),
          behavior_description: '',
          current_actor_role: text(step.actor_role || binding?.source_role_text),
          actor_assignment_mode: 'fixed_department',
          actor_department_data_ref: null,
          actor_position_rule: '',
          trigger: text(detail.trigger_scene),
          precondition: text(detail.precondition),
          input_description: text(step.input_materials),
          timing: nullable(step.timing),
          completion_standard: text(detail.execution_standard),
          output_description: outputDescription,
          work_role: binding ? {
            behavior_ref: behaviorRef,
            work_role_code: nullable(binding.work_role_code),
            role_duty: duty,
            work_role_name: text(binding.work_role_name) || `${text(step.step_name).replace(/行为$/, '')}行为的${duty}角色`,
            assignment_status: binding.work_role_code ? 'assigned' : 'pending_assignment'
          } : null,
          countersign_all_required: duty === '会签',
          countersign_target_departments: []
        };
      });
      const forms = array(source.forms).filter(form => stepMap.has(form.step_ref)).map((form, formIndex) => {
        const tables = array(source.form_tables).filter(table => table.form_ref === form.form_ref);
        return {
          form_ref: technicalRef(form.form_ref, 'form', processIndex, formIndex),
          behavior_ref: stepMap.get(form.step_ref) || null,
          form_name: text(form.form_name),
          form_no: nullable(form.form_code),
          form_design_state: 'unspecified',
          areas: tables.map((table, areaIndex) => ({
            area_ref: technicalRef(table.table_ref, 'area', processIndex, formIndex, areaIndex),
            area_type: table.table_kind === 'detail' ? '明细清单' : '基本信息',
            area_title: text(table.table_name),
            items: array(source.form_table_fields).filter(field => field.table_ref === table.table_ref).map((field, fieldIndex) => ({
              item_ref: technicalRef(field.table_field_ref, 'item', processIndex, formIndex, areaIndex, fieldIndex),
              item_name: text(field.field_name),
              item_type: text(field.field_type),
              required: Boolean(field.required),
              instructions: text(field.description)
            }))
          }))
        };
      });
      const processRef = technicalRef(oldProcessRef, 'process', processIndex);
      const v3 = {
        schema_version: 'process-governance-v3',
        export_meta: {
          package_ref: stableRef('package', processRef),
          exported_at: text(source.generated_at) || '1970-01-01T00:00:00.000Z',
          initiating_department: text(source.draft?.department?.department_name),
          compiler: ''
        },
        process: {
          process_ref: processRef,
          process_name: text(legacyProcess.l3_name || source.draft?.process_name || source.draft?.l3_name),
          owning_department: text(source.draft?.department?.department_name),
          purpose: text(source.document_profile?.purpose),
          scope: text(source.document_profile?.scope),
          capability_domain: nullable(legacyProcess.l1_name || source.draft?.l1_name),
          business_capability: nullable(legacyProcess.l2_name || source.draft?.l2_name),
          classification_status: 'unclassified'
        },
        reference_materials: [legacyMaterial(source, options, processRef)],
        behaviors,
        flow_relations: array(source.step_transitions).filter(relation => stepMap.has(relation.from_step_ref)).map((relation, relationIndex) => ({
          relation_ref: technicalRef(relation.transition_ref, 'relation', processIndex, relationIndex),
          relation_type: 'condition',
          from_behavior_ref: stepMap.get(relation.from_step_ref),
          to_behavior_ref: relation.to_step_ref ? (stepMap.get(relation.to_step_ref) || null) : null,
          condition: text(relation.condition),
          join_mode: ''
        })),
        data_objects: dataObjects,
        cross_department_handoffs: array(source.cross_dept_handoffs).filter(handoff => stepMap.has(handoff.step_ref)).map((handoff, handoffIndex) => ({
          handoff_ref: technicalRef(handoff.handoff_ref, 'handoff', processIndex, handoffIndex),
          handoff_direction: 'outbound_followup',
          anchor_behavior_ref: stepMap.get(handoff.step_ref),
          counterparty_resolution: text(handoff.target_department) ? 'identified' : 'needs_identification',
          source_department: text(source.draft?.department?.department_name),
          target_department: text(handoff.target_department),
          transfer_data_ref: outputByStep.get(handoff.step_ref) || null,
          returned_data_ref: null,
          requested_matter: text(handoff.target_behavior_name || handoff.handoff_standard),
          trigger_condition: '',
          completion_standard: text(handoff.handoff_standard),
          counterparty_process_ref: nullable(handoff.target_process_code),
          counterparty_process_name: text(handoff.target_process_name),
          counterparty_behavior_ref: nullable(handoff.target_behavior_code),
          counterparty_behavior_name: text(handoff.target_behavior_name),
          requires_return: false,
          resume_behavior_ref: null
        })),
        internal_process_calls: [],
        forms,
        terms: array(source.terms).map((item, termIndex) => ({
          term_ref: technicalRef(item.term_ref, 'term', processIndex, termIndex),
          term_name: text(item.term_name),
          definition: text(item.definition)
        }))
      };
      const migrated = migrateProcessDocument(v3, options);
      migrated.migration.source_schema_version = LEGACY_DOCUMENT_VERSION;
      migrated.migration.source_process_ref = nullable(oldProcessRef);
      migrated.migration.source_process_count = processList.length;
      return migrated;
    });
  }

  function migrateDocument(source, options = {}) {
    assertSource(source, options);
    const sourceSnapshot = clone(source);
    const documents = source.schema_version === LEGACY_DOCUMENT_VERSION
      ? splitLegacyDocument(sourceSnapshot, options)
      : [migrateProcessDocument(sourceSnapshot, options)];
    assertTargets(documents, options);
    return documents;
  }

  return {
    TARGET_VERSION,
    SUPPORTED_PROCESS_VERSIONS: [...SUPPORTED_PROCESS_VERSIONS],
    LEGACY_DOCUMENT_VERSION,
    clone,
    stableRef,
    pendingLifecycle,
    ensureDataFieldReferences,
    needsDataFieldUpgrade,
    normalizeFieldMatchPart,
    migrateDocument,
    migrateProcessDocument,
    splitLegacyDocument
  };
}));
