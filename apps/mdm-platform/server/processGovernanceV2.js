const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const V1 = 'process-governance-v1';
const V2 = 'process-governance-v2';
const DIRECTIONS = new Set(['inbound_prerequisite', 'outbound_followup']);
const RESOLUTIONS = new Set(['identified', 'needs_identification']);
const CONTRACTS_DIR = path.resolve(__dirname, '../../../docs/contracts');
const V1_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'process-governance-v1.schema.json'), 'utf8'));
const V2_SCHEMA = JSON.parse(fs.readFileSync(path.join(CONTRACTS_DIR, 'process-governance-v2.schema.json'), 'utf8'));
const schemaValidator = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
schemaValidator.addSchema(V1_SCHEMA);
const validateV1 = schemaValidator.getSchema(V1_SCHEMA.$id);
const validateV2 = schemaValidator.compile(V2_SCHEMA);
const UNTRUSTED_REVIEW_FIELDS = [
  'approved',
  'status',
  'reviewer',
  'reviewed_by',
  'reviewed_at',
  'approved_by',
  'approved_at'
];

function text(value) {
  return String(value == null ? '' : value).trim();
}

function nullableText(value) {
  const cleaned = text(value);
  return cleaned || null;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function schemaErrors(errors) {
  return list(errors).map(error => ({
    field: String(error.instancePath || '/').replace(/^\//, '').replace(/\//g, '.') || 'data',
    message: error.message || '不符合结构规则',
    keyword: error.keyword
  }));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stableValue(value[key]);
    return result;
  }, {});
}

function stableStringify(value) {
  return JSON.stringify(stableValue(value));
}

function contentHash(value) {
  return crypto.createHash('sha256').update(stableStringify(value), 'utf8').digest('hex');
}

function createEmptyProcessGovernanceDocument(options = {}) {
  const owningDepartment = text(options.owning_department);
  const processRef = text(options.process_ref) || `process_${crypto.randomBytes(8).toString('hex')}`;
  return {
    schema_version: V2,
    export_meta: {
      package_ref: text(options.package_ref) || `package_${crypto.randomBytes(8).toString('hex')}`,
      exported_at: new Date().toISOString(),
      initiating_department: owningDepartment,
      compiler: text(options.compiler)
    },
    process: {
      process_ref: processRef,
      process_name: text(options.process_name),
      owning_department: owningDepartment,
      purpose: '',
      scope: '',
      capability_domain: null,
      business_capability: null,
      classification_status: 'unclassified'
    },
    reference_materials: [],
    behaviors: [],
    flow_relations: [],
    data_objects: [],
    cross_department_handoffs: [],
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function conflictWarning(warnings, handoffRef, legacyField, currentField, legacyValue, currentValue) {
  if (!text(legacyValue) || !text(currentValue) || text(legacyValue) === text(currentValue)) return;
  warnings.push({
    code: 'V1_FIELD_CONFLICT',
    handoff_ref: handoffRef,
    field: currentField,
    message: `${handoffRef}的${legacyField}与${currentField}不一致；已保留v2字段原值，未猜测正确答案。`
  });
}

function normalizeHandoff(item, index, sourceVersion, owningDepartment, warnings) {
  const source = item && typeof item === 'object' ? item : {};
  const handoffRef = text(source.handoff_ref) || `handoff_${index + 1}`;
  if (sourceVersion === V1) {
    conflictWarning(warnings, handoffRef, 'send_behavior_ref', 'anchor_behavior_ref', source.send_behavior_ref, source.anchor_behavior_ref);
    conflictWarning(warnings, handoffRef, 'input_data_ref', 'transfer_data_ref', source.input_data_ref, source.transfer_data_ref);
    conflictWarning(warnings, handoffRef, 'target_process_ref', 'counterparty_process_ref', source.target_process_ref, source.counterparty_process_ref);
    conflictWarning(warnings, handoffRef, 'target_behavior_ref', 'counterparty_behavior_ref', source.target_behavior_ref, source.counterparty_behavior_ref);
    conflictWarning(warnings, handoffRef, 'return_behavior_ref', 'resume_behavior_ref', source.return_behavior_ref, source.resume_behavior_ref);
  }

  const direction = DIRECTIONS.has(text(source.handoff_direction))
    ? text(source.handoff_direction)
    : 'outbound_followup';
  const sourceDepartment = text(source.source_department)
    || (direction === 'outbound_followup' ? owningDepartment : '');
  const targetDepartment = text(source.target_department)
    || (direction === 'inbound_prerequisite' ? owningDepartment : '');
  const externalDepartment = direction === 'inbound_prerequisite' ? sourceDepartment : targetDepartment;
  const resolution = RESOLUTIONS.has(text(source.counterparty_resolution))
    ? text(source.counterparty_resolution)
    : (externalDepartment ? 'identified' : 'needs_identification');
  const returnedDataRef = nullableText(source.returned_data_ref);
  const resumeBehaviorRef = nullableText(source.resume_behavior_ref || source.return_behavior_ref);

  return {
    handoff_ref: handoffRef,
    handoff_direction: direction,
    anchor_behavior_ref: nullableText(source.anchor_behavior_ref || source.send_behavior_ref),
    counterparty_resolution: resolution,
    source_department: sourceDepartment,
    target_department: targetDepartment,
    transfer_data_ref: nullableText(source.transfer_data_ref || source.input_data_ref),
    requested_matter: text(source.requested_matter),
    trigger_condition: text(source.trigger_condition),
    completion_standard: text(source.completion_standard),
    counterparty_process_ref: nullableText(source.counterparty_process_ref || source.target_process_ref),
    counterparty_process_name: text(source.counterparty_process_name || source.target_process_name),
    counterparty_behavior_ref: nullableText(
      source.counterparty_behavior_ref || source.target_behavior_ref || source.receive_behavior_ref
    ),
    counterparty_behavior_name: text(source.counterparty_behavior_name || source.target_behavior_name),
    requires_return: typeof source.requires_return === 'boolean'
      ? source.requires_return
      : Boolean(returnedDataRef || resumeBehaviorRef),
    returned_data_ref: returnedDataRef,
    resume_behavior_ref: resumeBehaviorRef
  };
}

function validateNormalizedDocument(document) {
  const errors = [];
  const process = document && document.process || {};
  if (text(document && document.schema_version) !== V2) {
    errors.push({ field: 'schema_version', message: `结构化文件必须规范化为${V2}` });
  }
  if (!text(process.process_ref)) errors.push({ field: 'process.process_ref', message: '流程技术标识不能为空' });
  if (!text(process.process_name)) errors.push({ field: 'process.process_name', message: '流程名称不能为空' });
  if (!text(process.owning_department)) errors.push({ field: 'process.owning_department', message: '归口部门不能为空' });
  ['reference_materials', 'behaviors', 'flow_relations', 'data_objects', 'cross_department_handoffs', 'internal_process_calls', 'forms', 'terms']
    .forEach(field => {
      if (!Array.isArray(document && document[field])) errors.push({ field, message: `${field}必须是数组` });
    });

  const behaviorRefs = new Set();
  list(document && document.behaviors).forEach((behavior, index) => {
    const ref = text(behavior && behavior.behavior_ref);
    if (!ref) errors.push({ field: `behaviors.${index}.behavior_ref`, message: '业务行为技术标识不能为空' });
    else if (behaviorRefs.has(ref)) errors.push({ field: `behaviors.${index}.behavior_ref`, message: '业务行为技术标识不能重复' });
    else behaviorRefs.add(ref);
  });
  const dataRefs = new Set(list(document && document.data_objects).map(item => text(item && item.data_ref)).filter(Boolean));
  const handoffRefs = new Set();
  list(document && document.cross_department_handoffs).forEach((handoff, index) => {
    const prefix = `cross_department_handoffs.${index}`;
    const ref = text(handoff && handoff.handoff_ref);
    if (!ref) errors.push({ field: `${prefix}.handoff_ref`, message: '承接技术标识不能为空' });
    else if (handoffRefs.has(ref)) errors.push({ field: `${prefix}.handoff_ref`, message: '承接技术标识不能重复' });
    else handoffRefs.add(ref);
    if (!DIRECTIONS.has(text(handoff && handoff.handoff_direction))) {
      errors.push({ field: `${prefix}.handoff_direction`, message: '承接方向无效' });
    }
    if (!RESOLUTIONS.has(text(handoff && handoff.counterparty_resolution))) {
      errors.push({ field: `${prefix}.counterparty_resolution`, message: '外部门识别状态无效' });
    }
    if (!text(handoff && handoff.anchor_behavior_ref) || !behaviorRefs.has(text(handoff && handoff.anchor_behavior_ref))) {
      errors.push({ field: `${prefix}.anchor_behavior_ref`, message: '承接关系必须关联本流程中的有效业务行为' });
    }
    if (handoff && handoff.transfer_data_ref && !dataRefs.has(text(handoff.transfer_data_ref))) {
      errors.push({ field: `${prefix}.transfer_data_ref`, message: '传递数据必须引用本文件中的有效数据对象' });
    }
    if (handoff && handoff.returned_data_ref && !dataRefs.has(text(handoff.returned_data_ref))) {
      errors.push({ field: `${prefix}.returned_data_ref`, message: '返回数据必须引用本文件中的有效数据对象' });
    }
    if (handoff && handoff.resume_behavior_ref && !behaviorRefs.has(text(handoff.resume_behavior_ref))) {
      errors.push({ field: `${prefix}.resume_behavior_ref`, message: '恢复行为必须引用本流程中的有效业务行为' });
    }
  });
  return errors;
}

function governanceWarnings(document, migrationWarnings = []) {
  const warnings = [...migrationWarnings];
  list(document.cross_department_handoffs).forEach((handoff, index) => {
    const direction = handoff.handoff_direction;
    const externalDepartment = direction === 'inbound_prerequisite'
      ? text(handoff.source_department)
      : text(handoff.target_department);
    if (handoff.counterparty_resolution === 'needs_identification' || !externalDepartment) {
      warnings.push({
        code: 'COUNTERPARTY_NEEDS_IDENTIFICATION',
        handoff_ref: handoff.handoff_ref,
        field: `cross_department_handoffs.${index}`,
        message: '责任部门尚未明确；审核导入后由MDM工作组组长分派。'
      });
    }
    if (!text(handoff.counterparty_process_name) || !text(handoff.counterparty_behavior_name)) {
      warnings.push({
        code: 'COUNTERPARTY_DETAIL_INCOMPLETE',
        handoff_ref: handoff.handoff_ref,
        field: `cross_department_handoffs.${index}`,
        message: '外部门对应流程和业务行为尚未补齐；审核导入后形成承接待办。'
      });
    }
    if (!text(handoff.trigger_condition) && !text(handoff.completion_standard)) {
      warnings.push({
        code: 'HANDOFF_STANDARD_INCOMPLETE',
        handoff_ref: handoff.handoff_ref,
        field: `cross_department_handoffs.${index}`,
        message: '触发条件和完成标准均未填写；审核导入后继续完善。'
      });
    }
    if (handoff.requires_return && (!handoff.returned_data_ref || !handoff.resume_behavior_ref)) {
      warnings.push({
        code: 'RETURN_PATH_INCOMPLETE',
        handoff_ref: handoff.handoff_ref,
        field: `cross_department_handoffs.${index}`,
        message: '已要求返回，但返回数据或本流程恢复行为尚未补齐。'
      });
    }
  });
  return warnings;
}

function normalizeProcessGovernanceDocument(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { document: null, errors: [{ field: 'data', message: '结构化文件必须是JSON对象' }], warnings: [] };
  }
  const sourceVersion = text(input.schema_version);
  if (![V1, V2].includes(sourceVersion)) {
    return {
      document: null,
      errors: [{ field: 'schema_version', message: `仅支持${V1}或${V2}` }],
      warnings: []
    };
  }
  const source = clone(input);
  UNTRUSTED_REVIEW_FIELDS.forEach(field => delete source[field]);
  const validateSchema = sourceVersion === V1 ? validateV1 : validateV2;
  if (!validateSchema(source)) {
    return {
      document: null,
      errors: schemaErrors(validateSchema.errors),
      warnings: [],
      source_schema_version: sourceVersion,
      content_hash: null
    };
  }
  const warnings = [];
  const owningDepartment = text(source.process && source.process.owning_department);
  const document = {
    schema_version: V2,
    export_meta: source.export_meta && typeof source.export_meta === 'object' ? source.export_meta : {},
    process: source.process && typeof source.process === 'object' ? source.process : {},
    reference_materials: list(source.reference_materials),
    behaviors: list(source.behaviors),
    flow_relations: list(source.flow_relations),
    data_objects: list(source.data_objects),
    cross_department_handoffs: list(source.cross_department_handoffs).map((item, index) =>
      normalizeHandoff(item, index, sourceVersion, owningDepartment, warnings)
    ),
    internal_process_calls: list(source.internal_process_calls),
    forms: list(source.forms),
    terms: list(source.terms)
  };
  if (source.migration && typeof source.migration === 'object') document.migration = source.migration;
  if (sourceVersion === V1 && !document.migration) {
    document.migration = {
      source_schema_version: V1,
      source_process_ref: nullableText(document.process && document.process.process_ref),
      source_process_count: 1
    };
  }
  const errors = validateNormalizedDocument(document);
  return {
    document,
    errors,
    warnings: governanceWarnings(document, warnings),
    source_schema_version: sourceVersion,
    content_hash: errors.length ? null : contentHash(document)
  };
}

function dataObjectNameMap(document) {
  return new Map(list(document.data_objects).map(item => [text(item && item.data_ref), text(item && item.data_name)]));
}

function behaviorNameMap(document) {
  return new Map(list(document.behaviors).map(item => [text(item && item.behavior_ref), text(item && item.behavior_name)]));
}

function handoffCandidates(document) {
  const dataNames = dataObjectNameMap(document);
  const behaviorNames = behaviorNameMap(document);
  return list(document.cross_department_handoffs).map(handoff => ({
    ...handoff,
    anchor_behavior_name: behaviorNames.get(text(handoff.anchor_behavior_ref)) || '',
    transfer_data_name: dataNames.get(text(handoff.transfer_data_ref)) || '',
    returned_data_name: dataNames.get(text(handoff.returned_data_ref)) || '',
    resume_behavior_name: behaviorNames.get(text(handoff.resume_behavior_ref)) || ''
  }));
}

function previewProcessGovernanceDocument(input) {
  const normalized = normalizeProcessGovernanceDocument(input);
  if (normalized.errors.length) return normalized;
  const document = normalized.document;
  return {
    ...normalized,
    summary: {
      schema_version: V2,
      source_schema_version: normalized.source_schema_version,
      process_ref: text(document.process && document.process.process_ref),
      process_name: text(document.process && document.process.process_name),
      owning_department: text(document.process && document.process.owning_department),
      behavior_count: list(document.behaviors).length,
      data_object_count: list(document.data_objects).length,
      handoff_count: list(document.cross_department_handoffs).length,
      governance_warning_count: normalized.warnings.length
    },
    handoff_candidates: handoffCandidates(document)
  };
}

module.exports = {
  V1,
  V2,
  stableStringify,
  contentHash,
  createEmptyProcessGovernanceDocument,
  normalizeProcessGovernanceDocument,
  previewProcessGovernanceDocument,
  handoffCandidates,
  validateNormalizedDocument
};
