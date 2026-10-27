// Pure authoring contracts shared by 3000/3001. Input: caller-owned Ajv constructor.
// Reads technical schemas only; returns new documents or validation diagnostics.
// No HTTP application, database, private configuration, organization snapshot or listening socket.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { validateProcessGovernanceV7, validateProcessGovernanceV8, validateProcessGovernanceV9 } = require('./v7-validator');
function createAuthoringContracts({ Ajv2020 }) {
const MAX_JSON_DEPTH = 64;
const MAX_JSON_STRING_LENGTH = 1024 * 1024;
const MAX_JSON_NODES = 100000;


const schemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'document-structured-output.schema.json');
const STANDARD_SCHEMA = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const validateStandardDocument = new Ajv2020({ allErrors: true, strict: false }).compile(STANDARD_SCHEMA);
const processGovernanceV1SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v1.schema.json');
const processGovernanceV2SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v2.schema.json');
const processGovernanceV3SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v3.schema.json');
const processGovernanceV4SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v4.schema.json');
const processGovernanceV5SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v5.schema.json');
const processGovernanceV6SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v6.schema.json');
const processGovernanceV7SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v7.schema.json');
const processGovernanceV8SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v8.schema.json');
const processGovernanceV9SchemaPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-v9.schema.json');
const processGovernanceVersionHistoryPath = path.join(__dirname, '..', '..', 'docs', 'contracts', 'process-governance-version-history.json');
const PROCESS_GOVERNANCE_V1_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV1SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V2_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV2SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V3_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV3SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V4_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV4SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V5_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV5SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V6_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV6SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V7_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV7SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V8_SCHEMA = JSON.parse(fs.readFileSync(processGovernanceV8SchemaPath, 'utf8'));
const PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST = crypto.createHash('sha256').update(fs.readFileSync(processGovernanceV8SchemaPath)).digest('hex');
const PROCESS_GOVERNANCE_SCHEMA_SOURCE = fs.readFileSync(processGovernanceV9SchemaPath);
const PROCESS_GOVERNANCE_SCHEMA = JSON.parse(PROCESS_GOVERNANCE_SCHEMA_SOURCE.toString('utf8'));
const PROCESS_GOVERNANCE_VERSION_HISTORY = JSON.parse(fs.readFileSync(processGovernanceVersionHistoryPath, 'utf8'));
const PROCESS_GOVERNANCE_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(PROCESS_GOVERNANCE_SCHEMA_SOURCE)
  .digest('hex');
const PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(fs.readFileSync(processGovernanceV5SchemaPath))
  .digest('hex');
const PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST = crypto
  .createHash('sha256')
  .update(fs.readFileSync(processGovernanceV6SchemaPath))
  .digest('hex');
const processGovernanceAjv = new Ajv2020({
  allErrors: true,
  strict: false,
  validateFormats: false
});
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V1_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V2_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V3_SCHEMA);
processGovernanceAjv.addSchema(PROCESS_GOVERNANCE_V4_SCHEMA);
const validateProcessGovernanceV1Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V1_SCHEMA.$id);
const validateProcessGovernanceV2Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V2_SCHEMA.$id);
const validateProcessGovernanceV3Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V3_SCHEMA.$id);
const validateProcessGovernanceV4Document = processGovernanceAjv.getSchema(PROCESS_GOVERNANCE_V4_SCHEMA.$id);
const validateProcessGovernanceV5Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V5_SCHEMA);
const validateProcessGovernanceV6Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V6_SCHEMA);
const validateProcessGovernanceV7Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V7_SCHEMA);
const validateProcessGovernanceV8Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_V8_SCHEMA);
const validateProcessGovernanceV9Document = processGovernanceAjv.compile(PROCESS_GOVERNANCE_SCHEMA);
const earlyV7CompatibilitySchema = JSON.parse(JSON.stringify(PROCESS_GOVERNANCE_V7_SCHEMA));
earlyV7CompatibilitySchema.$id = 'https://infomat.local/contracts/process-governance-v7-early-data-fields.schema.json';
const earlyV7OptionalProperties = new Set(['fields', 'updated_field_refs', 'data_field_ref', 'value_usage_mode']);
(function relaxEarlyV7DataFieldRequirements(node) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node.required)) {
    node.required = node.required.filter(property => !earlyV7OptionalProperties.has(property));
  }
  Object.values(node).forEach(relaxEarlyV7DataFieldRequirements);
}(earlyV7CompatibilitySchema));
const earlyV7CompatibilityAjv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
earlyV7CompatibilityAjv.addSchema(PROCESS_GOVERNANCE_V1_SCHEMA);
earlyV7CompatibilityAjv.addSchema(PROCESS_GOVERNANCE_V2_SCHEMA);
const validateEarlyV7DataFieldsDocument = earlyV7CompatibilityAjv.compile(earlyV7CompatibilitySchema);

function createEmptyProcessGovernanceV5Document() {
  return {
    schema_version: 'process-governance-v5',
    export_meta: {
      package_ref: `package_${crypto.randomBytes(8).toString('hex')}`,
      exported_at: new Date().toISOString(),
      initiating_department: '',
      compiler: ''
    },
    process: {
      process_ref: `process_${crypto.randomBytes(8).toString('hex')}`,
      process_name: '',
      owning_department: '',
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
    internal_process_calls: [],
    forms: [],
    terms: []
  };
}

function createEmptyProcessGovernanceV6Document() {
  const source = createEmptyProcessGovernanceV5Document();
  return {
    schema_version: 'process-governance-v6',
    export_meta: source.export_meta,
    process: source.process,
    behaviors: [],
    flow_relations: [],
    data_objects: [],
    forms: [],
    terms: [],
    migration: {
      source_schema_version: 'process-governance-v6',
      source_process_ref: null,
      source_process_count: 1,
      legacy_cross_department_records: [],
      reference_materials: [],
      internal_process_calls: [],
      work_roles: [],
      unresolved_actor_roles: [],
      unresolved_join_modes: []
    }
  };
}

function createEmptyProcessGovernanceV7Document() {
  const source = createEmptyProcessGovernanceV6Document();
  source.schema_version = 'process-governance-v7';
  source.migration.source_schema_version = 'process-governance-v7';
  return source;
}

function createEmptyProcessGovernanceDocument() {
  const document = createEmptyProcessGovernanceV7Document();
  document.schema_version = 'process-governance-v9';
  document.process.entry_behavior_refs = [];
  document.migration.source_schema_version = 'process-governance-v9';
  return document;
}


function contractValidationResult(data) {
  const valid = validateStandardDocument(data);
  return {
    valid: Boolean(valid),
    errors: valid
      ? []
      : (validateStandardDocument.errors || []).map(error => ({
          path: error.instancePath || '/',
          keyword: error.keyword,
          message: error.message || '不符合统一结构规则',
          params: error.params || {}
        }))
  };
}

function processGovernanceValidationResult(data, options = {}) {
  if (data?.schema_version === 'process-governance-v9') {
    return validateProcessGovernanceV9(data, { schemaValidator: validateProcessGovernanceV9Document });
  }
  if (data?.schema_version === 'process-governance-v8') {
    return validateProcessGovernanceV8(data, { schemaValidator: validateProcessGovernanceV8Document });
  }
  if (data?.schema_version === 'process-governance-v7') {
    return validateProcessGovernanceV7(data, {
      schemaValidator: options.validationProfile === 'early-v7-data-fields'
        ? validateEarlyV7DataFieldsDocument
        : validateProcessGovernanceV7Document
    });
  }
  const validators = {
    'process-governance-v1': validateProcessGovernanceV1Document,
    'process-governance-v2': validateProcessGovernanceV2Document,
    'process-governance-v3': validateProcessGovernanceV3Document,
    'process-governance-v4': validateProcessGovernanceV4Document,
    'process-governance-v5': validateProcessGovernanceV5Document,
    'process-governance-v6': validateProcessGovernanceV6Document,
    'process-governance-v7': validateProcessGovernanceV7Document
  };
  const validator = validators[data?.schema_version] || validateProcessGovernanceV5Document;
  const schemaValid = validator(data);
  const errors = schemaValid
    ? []
    : (validator.errors || []).map(error => ({
        path: error.instancePath || '/',
        keyword: error.keyword,
        message: error.message || '不符合单流程结构规则',
        params: error.params || {}
      }));

  const addError = (pathKey, message, params = {}) => {
    errors.push({ path: pathKey, keyword: 'localReference', message, params });
  };
  const uniqueRefs = (items, key, basePath) => {
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach((item, index) => {
      const value = item?.[key];
      if (!value) return;
      if (seen.has(value)) addError(`${basePath}/${index}/${key}`, `技术标识 ${value} 在当前文件中重复`, { ref: value });
      seen.add(value);
    });
    return seen;
  };
  const requireLocalRef = (set, value, pathKey, label) => {
    if (value && !set.has(value)) addError(pathKey, `${label} ${value} 不在当前文件中`, { ref: value });
  };

  const behaviors = Array.isArray(data?.behaviors) ? data.behaviors : [];
  const behaviorByRef = new Map(behaviors.map(behavior => [behavior?.behavior_ref, behavior]));
  const flowRelations = Array.isArray(data?.flow_relations) ? data.flow_relations : [];
  const dataObjects = Array.isArray(data?.data_objects) ? data.data_objects : [];
  const handoffs = Array.isArray(data?.cross_department_handoffs) ? data.cross_department_handoffs : [];
  const currentStructuredVersion = ['process-governance-v6', 'process-governance-v7'].includes(data?.schema_version);
  const modernDataVersion = ['process-governance-v4', 'process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data?.schema_version);
  const internalCalls = currentStructuredVersion
    ? (Array.isArray(data?.migration?.internal_process_calls) ? data.migration.internal_process_calls : [])
    : (Array.isArray(data?.internal_process_calls) ? data.internal_process_calls : []);
  const forms = Array.isArray(data?.forms) ? data.forms : [];

  const behaviorRefs = uniqueRefs(behaviors, 'behavior_ref', '/behaviors');
  const dataRefs = uniqueRefs(dataObjects, 'data_ref', '/data_objects');
  const dataFieldOwners = new Map();
  uniqueRefs(flowRelations, 'relation_ref', '/flow_relations');
  uniqueRefs(handoffs, 'handoff_ref', '/cross_department_handoffs');
  uniqueRefs(internalCalls, 'call_ref', '/internal_process_calls');
  uniqueRefs(forms, 'form_ref', '/forms');
  const referenceMaterials = currentStructuredVersion
    ? data?.migration?.reference_materials
    : data?.reference_materials;
  uniqueRefs(referenceMaterials, 'material_ref', currentStructuredVersion ? '/migration/reference_materials' : '/reference_materials');
  uniqueRefs(data?.terms, 'term_ref', '/terms');

  behaviors.forEach((behavior, index) => {
    requireLocalRef(
      dataRefs,
      behavior?.actor_department_data_ref,
      `/behaviors/${index}/actor_department_data_ref`,
      '动态执行部门来源数据'
    );
    (behavior?.input_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/input_data_refs/${refIndex}`, '输入数据标识');
    });
    (behavior?.output_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/behaviors/${index}/output_data_refs/${refIndex}`, '输出数据标识');
    });
    if (behavior?.work_role) {
      requireLocalRef(behaviorRefs, behavior.work_role.behavior_ref, `/behaviors/${index}/work_role/behavior_ref`, '工作角色绑定的业务行为');
      if (behavior.work_role.behavior_ref !== behavior.behavior_ref) {
        addError(`/behaviors/${index}/work_role/behavior_ref`, '工作角色必须绑定当前业务行为', {
          expected: behavior.behavior_ref,
          actual: behavior.work_role.behavior_ref
        });
      }
    }
  });

  flowRelations.forEach((relation, index) => {
    requireLocalRef(behaviorRefs, relation?.from_behavior_ref, `/flow_relations/${index}/from_behavior_ref`, '起点业务行为');
    requireLocalRef(behaviorRefs, relation?.to_behavior_ref, `/flow_relations/${index}/to_behavior_ref`, '终点业务行为');
  });

  dataObjects.forEach((dataObject, index) => {
    if (modernDataVersion) {
      const currentDataFieldRefs = new Set((dataObject?.fields || []).map(field => field?.field_ref).filter(Boolean));
      if (data?.schema_version === 'process-governance-v7') {
        uniqueRefs(dataObject?.fields, 'field_ref', `/data_objects/${index}/fields`);
        const fieldKeys = new Map();
        (dataObject?.fields || []).forEach((field, fieldIndex) => {
          const fieldPath = `/data_objects/${index}/fields/${fieldIndex}`;
          if (field?.field_ref) dataFieldOwners.set(field.field_ref, dataObject.data_ref);
          const key = `${String(field?.field_name || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}|${String(field?.field_type || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()}`;
          if (key !== '|') {
            if (fieldKeys.has(key)) {
              addError(fieldPath, `对象字段与${fieldKeys.get(key)}的名称和数据类型重复`, { ref: field?.field_ref });
            } else {
              fieldKeys.set(key, fieldPath);
            }
          }
        });
      }
      uniqueRefs(dataObject?.behavior_links, 'link_ref', `/data_objects/${index}/behavior_links`);
      uniqueRefs(dataObject?.source_relations, 'source_ref', `/data_objects/${index}/source_relations`);
      (dataObject?.behavior_links || []).forEach((link, linkIndex) => {
        requireLocalRef(behaviorRefs, link?.behavior_ref, `/data_objects/${index}/behavior_links/${linkIndex}/behavior_ref`, '数据关系对应行为');
        if (data?.schema_version === 'process-governance-v7') {
          if (link?.behavior_ref && behaviorByRef.get(link.behavior_ref)?.node_type !== 'action') {
            addError(
              `/data_objects/${index}/behavior_links/${linkIndex}/behavior_ref`,
              '数据关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
              { ref: link.behavior_ref }
            );
          }
          const updatedFieldRefs = Array.isArray(link?.updated_field_refs) ? link.updated_field_refs : [];
          if (link?.operation !== 'update' && updatedFieldRefs.length) {
            addError(`/data_objects/${index}/behavior_links/${linkIndex}/updated_field_refs`, '只有更新操作可以登记更新字段', { ref: link?.link_ref });
          }
          updatedFieldRefs.forEach((fieldRef, fieldIndex) => {
            requireLocalRef(
              currentDataFieldRefs,
              fieldRef,
              `/data_objects/${index}/behavior_links/${linkIndex}/updated_field_refs/${fieldIndex}`,
              '更新字段'
            );
          });
        }
      });
      (dataObject?.source_relations || []).forEach((source, sourceIndex) => {
        requireLocalRef(
          behaviorRefs,
          source?.available_from_behavior_ref,
          `/data_objects/${index}/source_relations/${sourceIndex}/available_from_behavior_ref`,
          '数据可用位置'
        );
      });
      return;
    }
    requireLocalRef(behaviorRefs, dataObject?.produced_by_behavior_ref, `/data_objects/${index}/produced_by_behavior_ref`, '数据产生行为');
    (dataObject?.consumed_by_behavior_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(behaviorRefs, ref, `/data_objects/${index}/consumed_by_behavior_refs/${refIndex}`, '数据使用行为');
    });
  });

  handoffs.forEach((handoff, index) => {
    if (data?.schema_version === 'process-governance-v1') {
      requireLocalRef(behaviorRefs, handoff?.send_behavior_ref, `/cross_department_handoffs/${index}/send_behavior_ref`, '发送行为');
      requireLocalRef(dataRefs, handoff?.input_data_ref, `/cross_department_handoffs/${index}/input_data_ref`, '承接输入数据');
      requireLocalRef(dataRefs, handoff?.returned_data_ref, `/cross_department_handoffs/${index}/returned_data_ref`, '承接返回数据');
      requireLocalRef(behaviorRefs, handoff?.return_behavior_ref, `/cross_department_handoffs/${index}/return_behavior_ref`, '主流程恢复行为');
      return;
    }
    requireLocalRef(behaviorRefs, handoff?.anchor_behavior_ref, `/cross_department_handoffs/${index}/anchor_behavior_ref`, '本流程锚点行为');
    requireLocalRef(dataRefs, handoff?.transfer_data_ref, `/cross_department_handoffs/${index}/transfer_data_ref`, '跨部门传递数据');
    requireLocalRef(dataRefs, handoff?.returned_data_ref, `/cross_department_handoffs/${index}/returned_data_ref`, '跨部门返回数据');
    requireLocalRef(behaviorRefs, handoff?.resume_behavior_ref, `/cross_department_handoffs/${index}/resume_behavior_ref`, '本流程恢复行为');
  });

  internalCalls.forEach((call, index) => {
    requireLocalRef(behaviorRefs, call?.caller_behavior_ref, `/internal_process_calls/${index}/caller_behavior_ref`, '调用行为');
    requireLocalRef(behaviorRefs, call?.return_behavior_ref, `/internal_process_calls/${index}/return_behavior_ref`, '返回后的恢复行为');
    (call?.input_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/input_data_refs/${refIndex}`, '调用输入数据');
    });
    (call?.output_data_refs || []).forEach((ref, refIndex) => {
      requireLocalRef(dataRefs, ref, `/internal_process_calls/${index}/output_data_refs/${refIndex}`, '调用输出数据');
    });
  });

  forms.forEach((form, formIndex) => {
    if (modernDataVersion) {
      uniqueRefs(form?.behavior_links, 'link_ref', `/forms/${formIndex}/behavior_links`);
      (form?.behavior_links || []).forEach((link, linkIndex) => {
        requireLocalRef(behaviorRefs, link?.behavior_ref, `/forms/${formIndex}/behavior_links/${linkIndex}/behavior_ref`, '表单关系对应行为');
        if (data?.schema_version === 'process-governance-v7' && link?.behavior_ref && behaviorByRef.get(link.behavior_ref)?.node_type !== 'action') {
          addError(
            `/forms/${formIndex}/behavior_links/${linkIndex}/behavior_ref`,
            '表单处理关系关联了控制节点；请保留原内容，并将关系改到实际办理业务的行为',
            { ref: link.behavior_ref }
          );
        }
      });
    } else {
      requireLocalRef(behaviorRefs, form?.behavior_ref, `/forms/${formIndex}/behavior_ref`, '表单对应行为');
    }
    uniqueRefs(form?.areas, 'area_ref', `/forms/${formIndex}/areas`);
    const itemRefs = new Set();
    (form?.areas || []).forEach((area, areaIndex) => {
      (area?.items || []).forEach((item, itemIndex) => {
        if (item?.item_ref && itemRefs.has(item.item_ref)) {
          addError(`/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/item_ref`, `技术标识 ${item.item_ref} 在当前表单中重复`, { ref: item.item_ref });
        }
        if (item?.item_ref) itemRefs.add(item.item_ref);
        if (!modernDataVersion) return;
        requireLocalRef(dataRefs, item?.business_data_ref, `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/business_data_ref`, '字段归属数据');
        if (data?.schema_version === 'process-governance-v7' && item?.data_field_ref) {
          const fieldPath = `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/data_field_ref`;
          const ownerRef = dataFieldOwners.get(item.data_field_ref);
          if (!ownerRef) {
            addError(fieldPath, `引用的对象字段 ${item.data_field_ref} 不在当前文件中`, { ref: item.data_field_ref });
          } else if (ownerRef !== item.business_data_ref) {
            addError(fieldPath, `引用的对象字段不属于字段已选择的数据对象 ${item.business_data_ref || '未选择'}`, {
              ref: item.data_field_ref,
              expected_data_ref: ownerRef
            });
          } else {
            const owner = dataObjects.find(dataObject => dataObject.data_ref === ownerRef);
            const dataField = (owner?.fields || []).find(field => field.field_ref === item.data_field_ref);
            if (dataField && dataField.field_type !== item.item_type) {
              addError(`/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/item_type`, '表单字段的数据类型与引用的对象字段不一致', {
                ref: item.data_field_ref,
                expected: dataField.field_type,
                actual: item.item_type
              });
            }
          }
        }
        uniqueRefs(item?.source_links, 'source_link_ref', `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links`);
        (item?.source_links || []).forEach((link, linkIndex) => {
          if (['process-governance-v5', 'process-governance-v6', 'process-governance-v7'].includes(data?.schema_version) && link?.source_type === 'external_system') return;
          requireLocalRef(dataRefs, link?.source_data_ref, `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links/${linkIndex}/source_data_ref`, '字段取值来源数据');
        });
      });
    });
  });

  if (currentStructuredVersion) {
    const relationRefs = new Set(flowRelations.map(item => item?.relation_ref).filter(Boolean));
    const dataLinkRefs = new Set(dataObjects.flatMap(item => (item?.behavior_links || []).map(link => link?.link_ref)).filter(Boolean));
    const migration = data?.migration || {};
    const technicalIdentifiers = new Map();
    const registerIdentifiers = (items, key, basePath) => {
      (Array.isArray(items) ? items : []).forEach((item, index) => {
        const value = item?.[key];
        if (!value) return;
        const currentPath = `${basePath}/${index}/${key}`;
        if (technicalIdentifiers.has(value)) {
          addError(currentPath, `技术标识 ${value} 与 ${technicalIdentifiers.get(value)} 重复`, { ref: value });
        } else {
          technicalIdentifiers.set(value, currentPath);
        }
      });
    };
    registerIdentifiers([data.export_meta], 'package_ref', '/export_meta');
    registerIdentifiers([data.process], 'process_ref', '/process');
    registerIdentifiers(behaviors, 'behavior_ref', '/behaviors');
    registerIdentifiers(flowRelations, 'relation_ref', '/flow_relations');
    registerIdentifiers(dataObjects, 'data_ref', '/data_objects');
    registerIdentifiers(forms, 'form_ref', '/forms');
    registerIdentifiers(data.terms, 'term_ref', '/terms');
    dataObjects.forEach((dataObject, dataIndex) => {
      if (data?.schema_version === 'process-governance-v7') {
        registerIdentifiers(dataObject.fields, 'field_ref', `/data_objects/${dataIndex}/fields`);
      }
      registerIdentifiers(dataObject.behavior_links, 'link_ref', `/data_objects/${dataIndex}/behavior_links`);
      registerIdentifiers(dataObject.source_relations, 'source_ref', `/data_objects/${dataIndex}/source_relations`);
      if (data?.schema_version === 'process-governance-v7') {
        registerIdentifiers(dataObject?.lifecycle?.routes, 'route_ref', `/data_objects/${dataIndex}/lifecycle/routes`);
        (dataObject?.lifecycle?.routes || []).forEach((route, routeIndex) => {
          registerIdentifiers(route?.events, 'event_ref', `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events`);
        });
      }
      const operationsByBehavior = new Map();
      (dataObject.behavior_links || []).forEach(link => {
        if (!operationsByBehavior.has(link.behavior_ref)) operationsByBehavior.set(link.behavior_ref, new Set());
        operationsByBehavior.get(link.behavior_ref).add(link.operation);
      });
      operationsByBehavior.forEach((operations, behaviorRef) => {
        if (operations.has('pending_confirmation') && operations.size > 1) {
          addError(`/data_objects/${dataIndex}/behavior_links`, `数据对象与行为 ${behaviorRef} 的待确认操作不能与已确认操作并存`, { ref: behaviorRef });
        }
      });
    });
    forms.forEach((form, formIndex) => {
      registerIdentifiers(form.behavior_links, 'link_ref', `/forms/${formIndex}/behavior_links`);
      (form.areas || []).forEach((area, areaIndex) => {
        registerIdentifiers([area], 'area_ref', `/forms/${formIndex}/areas/${areaIndex}`);
        registerIdentifiers(area.items, 'item_ref', `/forms/${formIndex}/areas/${areaIndex}/items`);
        (area.items || []).forEach((item, itemIndex) => {
          registerIdentifiers(item.source_links, 'source_link_ref', `/forms/${formIndex}/areas/${areaIndex}/items/${itemIndex}/source_links`);
        });
      });
    });
    registerIdentifiers(migration.reference_materials, 'material_ref', '/migration/reference_materials');
    registerIdentifiers(migration.internal_process_calls, 'call_ref', '/migration/internal_process_calls');
    registerIdentifiers(migration.work_roles, 'archive_ref', '/migration/work_roles');
    registerIdentifiers(migration.unresolved_actor_roles, 'record_ref', '/migration/unresolved_actor_roles');
    registerIdentifiers(migration.unresolved_join_modes, 'record_ref', '/migration/unresolved_join_modes');
    registerIdentifiers(migration.legacy_cross_department_records, 'record_ref', '/migration/legacy_cross_department_records');
    if (data?.schema_version === 'process-governance-v7') {
      dataObjects.forEach((dataObject, dataIndex) => {
        (dataObject?.lifecycle?.routes || []).forEach((route, routeIndex) => {
          (route?.flow_relation_refs || []).forEach((relationRef, relationIndex) => {
            requireLocalRef(relationRefs, relationRef, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/flow_relation_refs/${relationIndex}`, '生命周期路径对应流程关系');
          });
          (route?.events || []).forEach((event, eventIndex) => {
            requireLocalRef(behaviorRefs, event?.trigger?.behavior_ref, `/data_objects/${dataIndex}/lifecycle/routes/${routeIndex}/events/${eventIndex}/trigger/behavior_ref`, '生命周期事件触发行为');
          });
        });
      });
    }
    const exactRelations = new Map();
    flowRelations.forEach((relation, index) => {
      if (relation?.from_behavior_ref && relation.from_behavior_ref === relation.to_behavior_ref) {
        addError(`/flow_relations/${index}/to_behavior_ref`, '流程关系的起点和终点不能相同', { ref: relation.relation_ref });
      }
      const duplicateKey = ['condition', 'loop'].includes(relation?.relation_type)
        ? [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref, relation.condition].join('|')
        : [relation.relation_type, relation.from_behavior_ref, relation.to_behavior_ref].join('|');
      if (exactRelations.has(duplicateKey)) {
        addError(`/flow_relations/${index}`, `流程关系与${exactRelations.get(duplicateKey)}完全重复`, { ref: relation.relation_ref });
      } else {
        exactRelations.set(duplicateKey, relation.relation_ref);
      }
    });
    uniqueRefs(migration?.work_roles, 'archive_ref', '/migration/work_roles');
    uniqueRefs(migration?.unresolved_actor_roles, 'record_ref', '/migration/unresolved_actor_roles');
    uniqueRefs(migration?.unresolved_join_modes, 'record_ref', '/migration/unresolved_join_modes');
    uniqueRefs(migration?.legacy_cross_department_records, 'record_ref', '/migration/legacy_cross_department_records');
    (migration?.work_roles || []).forEach((archive, index) => {
      requireLocalRef(behaviorRefs, archive?.behavior_ref, `/migration/work_roles/${index}/behavior_ref`, '历史工作角色对应行为');
      requireLocalRef(behaviorRefs, archive?.work_role?.behavior_ref, `/migration/work_roles/${index}/work_role/behavior_ref`, '历史工作角色绑定行为');
      if (archive?.work_role?.behavior_ref && archive.work_role.behavior_ref !== archive.behavior_ref) {
        addError(`/migration/work_roles/${index}/work_role/behavior_ref`, '历史工作角色的行为引用必须一致');
      }
    });
    (migration?.unresolved_actor_roles || []).forEach((archive, index) => {
      requireLocalRef(behaviorRefs, archive?.behavior_ref, `/migration/unresolved_actor_roles/${index}/behavior_ref`, '待确认执行主体对应行为');
    });
    (migration?.unresolved_join_modes || []).forEach((archive, index) => {
      requireLocalRef(relationRefs, archive?.relation_ref, `/migration/unresolved_join_modes/${index}/relation_ref`, '待确认汇合方式对应关系');
    });
    (migration?.legacy_cross_department_records || []).forEach((archive, index) => {
      const handoff = archive?.source_handoff || {};
      requireLocalRef(behaviorRefs, handoff.anchor_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/anchor_behavior_ref`, '旧跨部门记录锚点行为');
      requireLocalRef(behaviorRefs, handoff.resume_behavior_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/resume_behavior_ref`, '旧跨部门记录恢复行为');
      requireLocalRef(dataRefs, handoff.transfer_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/transfer_data_ref`, '旧跨部门记录传递数据');
      requireLocalRef(dataRefs, handoff.returned_data_ref, `/migration/legacy_cross_department_records/${index}/source_handoff/returned_data_ref`, '旧跨部门记录返回数据');
      requireLocalRef(behaviorRefs, archive?.created_behavior_ref, `/migration/legacy_cross_department_records/${index}/created_behavior_ref`, '旧跨部门记录创建行为');
      (archive?.created_relation_refs || []).forEach((ref, refIndex) => {
        requireLocalRef(relationRefs, ref, `/migration/legacy_cross_department_records/${index}/created_relation_refs/${refIndex}`, '旧跨部门记录创建关系');
      });
      (archive?.created_data_link_refs || []).forEach((ref, refIndex) => {
        requireLocalRef(dataLinkRefs, ref, `/migration/legacy_cross_department_records/${index}/created_data_link_refs/${refIndex}`, '旧跨部门记录创建数据关系');
      });
    });
  }

  const errorsById = new Map();
  errors.forEach(error => {
    const qualifier = error.params?.ref
      || error.params?.missingProperty
      || error.params?.expected
      || (error.params?.allowedValues ? JSON.stringify(error.params.allowedValues) : '');
    const errorId = `${error.keyword || 'validation'}:${error.path || '/'}:${qualifier}`;
    if (!errorsById.has(errorId)) errorsById.set(errorId, { ...error, error_id: errorId });
  });
  const deduplicatedErrors = [...errorsById.values()];
  return { valid: deduplicatedErrors.length === 0, errors: deduplicatedErrors };
}

function containsUnpairedSurrogate(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xD800 && code <= 0xDBFF) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
      index += 1;
    } else if (code >= 0xDC00 && code <= 0xDFFF) return true;
  }
  return false;
}

function jsonSafetyProblem(root) {
  const stack = [{ value: root, depth: 0, path: '/' }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > MAX_JSON_NODES) {
      return { code: 'JSON_NODE_LIMIT_EXCEEDED', error: '结构化内容包含的对象和字段过多。请拆分或精简内容后重试。', path: current.path };
    }
    if (current.depth > MAX_JSON_DEPTH) {
      return { code: 'JSON_DEPTH_EXCEEDED', error: '结构化内容嵌套层级过深。请修正文件结构后重试。', path: current.path };
    }
    if (typeof current.value === 'string') {
      if (Buffer.byteLength(current.value, 'utf8') > MAX_JSON_STRING_LENGTH) {
        return { code: 'JSON_TEXT_TOO_LONG', error: '结构化内容中的单段文字超过1MB。请拆分或精简该段文字后重试。', path: current.path };
      }
      if (containsUnpairedSurrogate(current.value)) {
        return { code: 'INVALID_UNICODE', error: '结构化内容包含无效字符。请从原系统重新导出UTF-8 JSON后重试。', path: current.path };
      }
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (Array.isArray(current.value)) {
      current.value.forEach((value, index) => stack.push({ value, depth: current.depth + 1, path: `${current.path}${index}/` }));
      continue;
    }
    Object.entries(current.value).forEach(([key, value]) => {
      stack.push({ value: key, depth: current.depth + 1, path: `${current.path}${key}/` });
      stack.push({ value, depth: current.depth + 1, path: `${current.path}${key}/` });
    });
  }
  return null;
}


return {
  STANDARD_SCHEMA,
  PROCESS_GOVERNANCE_V1_SCHEMA,
  PROCESS_GOVERNANCE_V2_SCHEMA,
  PROCESS_GOVERNANCE_V3_SCHEMA,
  PROCESS_GOVERNANCE_V4_SCHEMA,
  PROCESS_GOVERNANCE_V5_SCHEMA,
  PROCESS_GOVERNANCE_V6_SCHEMA,
  PROCESS_GOVERNANCE_V7_SCHEMA,
  PROCESS_GOVERNANCE_V8_SCHEMA,
  PROCESS_GOVERNANCE_SCHEMA,
  PROCESS_GOVERNANCE_VERSION_HISTORY,
  PROCESS_GOVERNANCE_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V5_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V6_SCHEMA_DIGEST,
  PROCESS_GOVERNANCE_V8_SCHEMA_DIGEST,
  processGovernanceV7SchemaPath,
  createEmptyProcessGovernanceDocument,
  createEmptyProcessGovernanceV5Document,
  createEmptyProcessGovernanceV6Document,
  createEmptyProcessGovernanceV7Document,
  processGovernanceValidationResult,
  contractValidationResult,
  jsonSafetyProblem
};
}
module.exports = { createAuthoringContracts };
