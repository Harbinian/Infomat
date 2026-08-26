import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const migration = require('../../../../apps/structured-output-service/public/process-governance-migration.js');
const service = require('../../../../apps/structured-output-service/server.js');

const EVIDENCE_STATUSES = new Set(['结构已确认', '配置已确认', '实时已核验', '分析候选', '待业务确认']);
const TECHNICAL_TEXT_PATTERN = /ExcelServer|WorkItem|ES_WorkItem|(?:^|[^A-Za-z])_wi(?:[^A-Za-z]|$)|CXSYSYS|\bdbo\.|Operator|ITEM|FONO/i;
const FORBIDDEN_KEY_PATTERN = /password|token|secret|credential|connection|string|phone|mobile|email|contact|密码|令牌|联系方式|手机号|邮箱/i;
const TECHNICAL_FIELD_PATTERN = /(?:Operator|ITEM|FONO)$/i;
const DECISION_VERB_PATTERN = /(?:校对|复核|审核|核查|审批|批准|验收|确认)/;

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function digest(value) {
  const source = Buffer.isBuffer(value) ? value : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  return crypto.createHash('sha256').update(source).digest('hex');
}

function stableRef(prefix, value) {
  return `${prefix}_${digest(String(value)).slice(0, 12)}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeBusinessFileNamePart(value, fallback) {
  const text = String(value || '').trim() || fallback;
  return text
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '') || fallback;
}

export function businessProcessJsonFileName(documentValue) {
  const exportedAt = new Date(documentValue?.export_meta?.exported_at || Date.now());
  if (Number.isNaN(exportedAt.getTime())) throw new Error('导出时间无效，无法生成业务文件名');
  const dateToken = [
    exportedAt.getFullYear(),
    String(exportedAt.getMonth() + 1).padStart(2, '0'),
    String(exportedAt.getDate()).padStart(2, '0')
  ].join('');
  const department = safeBusinessFileNamePart(documentValue?.process?.owning_department, '待确认部门');
  const processName = safeBusinessFileNamePart(documentValue?.process?.process_name, '待确认流程');
  return `未审核-${department}-${processName}-最终待核对-${dateToken}.json`;
}

function walkKeys(value, currentPath = '$') {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkKeys(item, `${currentPath}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  Object.entries(value).forEach(([key, child]) => {
    if (FORBIDDEN_KEY_PATTERN.test(key)) {
      throw new Error(`结构快照包含禁止字段：${currentPath}.${key}`);
    }
    walkKeys(child, `${currentPath}.${key}`);
  });
}

export function assertSafeSnapshot(snapshot) {
  if (snapshot?.schema_version !== 'database-process-evidence-v1') {
    throw new Error('结构快照版本必须为 database-process-evidence-v1');
  }
  if (snapshot.database !== 'CXSYSYS' || snapshot.schema !== 'dbo') {
    throw new Error('第一版只允许读取 CXSYSYS.dbo 的结构快照');
  }
  if (!snapshot.captured_at || !Array.isArray(snapshot.forms) || !Array.isArray(snapshot.workflows)) {
    throw new Error('结构快照缺少 captured_at、forms[] 或 workflows[]');
  }
  walkKeys(snapshot);
  return snapshot;
}

export function selectWorkflow(snapshot, rootTable, workflowId = '') {
  const formMatches = snapshot.forms.filter(form => form.root_table === rootTable || form.form_template === rootTable);
  if (formMatches.length !== 1) {
    throw new Error(formMatches.length
      ? `主表或表单模板“${rootTable}”匹配到${formMatches.length}个表单配置，请先整理快照`
      : `结构快照中找不到主表或表单模板“${rootTable}”`);
  }
  const candidates = snapshot.workflows.filter(workflow => workflow.root_table === formMatches[0].root_table);
  if (workflowId) {
    const selected = candidates.find(workflow => workflow.workflow_id === workflowId);
    if (!selected) throw new Error(`找不到工作流“${workflowId}”；候选：${candidates.map(item => item.workflow_id).join('、') || '无'}`);
    return { form: formMatches[0], workflow: selected, candidates };
  }
  if (candidates.length !== 1) {
    const listing = candidates.map(item => `${item.workflow_id}（${item.workflow_name || '未命名'}）`).join('、') || '无';
    throw new Error(`主表“${formMatches[0].root_table}”匹配到${candidates.length}个工作流，停止生成。候选：${listing}`);
  }
  return { form: formMatches[0], workflow: candidates[0], candidates };
}

export function assertExplicitDecisionRouting(workflow) {
  const nodes = Array.isArray(workflow?.nodes) ? workflow.nodes : [];
  const edges = Array.isArray(workflow?.edges) ? workflow.edges : [];
  const errors = [];
  const nodeByRef = new Map(nodes.map(node => [node.behavior_ref, node]));
  nodes.forEach(node => {
    const nodeRef = node.behavior_ref;
    const nodeName = node.business_name || nodeRef || '未命名节点';
    const outgoing = edges.filter(edge => edge.from_behavior_ref === nodeRef
      && ['sequence', 'condition', 'loop'].includes(edge.relation_type));
    const forwardRoutes = outgoing.filter(edge => edge.relation_type !== 'loop');
    const loopRoutes = outgoing.filter(edge => edge.relation_type === 'loop');
    const conditionRoutes = outgoing.filter(edge => edge.relation_type === 'condition');
    if (node.node_type === 'action') {
      const hidesDecision = conditionRoutes.length > 0
        || (loopRoutes.length > 0 && (forwardRoutes.length > 0 || DECISION_VERB_PATTERN.test(nodeName)));
      if (hidesDecision) {
        errors.push(`“${nodeName}”把判断结果藏在流程关系条件中；请保留业务行为，并在其后增加独立判断节点`);
      }
      if (forwardRoutes.length > 1) {
        errors.push(`“${nodeName}”直接连接${forwardRoutes.length}条后续路线；请在业务行为后增加判断节点或并行开始节点`);
      }
      return;
    }
    if (node.node_type !== 'decision') return;
    const usableRoutes = outgoing.filter(edge => edge.relation_type === 'sequence' || String(edge.condition || '').trim());
    if (usableRoutes.length < 2) {
      errors.push(`判断节点“${nodeName}”只有${usableRoutes.length}条完整出口；每个判断结果都必须有明确去向`);
    }
    const defaultRoutes = outgoing.filter(edge => edge.relation_type === 'sequence' && !String(edge.condition || '').trim());
    if (defaultRoutes.length > 1) {
      errors.push(`判断节点“${nodeName}”存在${defaultRoutes.length}条无条件默认路线；最多只能保留1条`);
    }
    outgoing.filter(edge => ['condition', 'loop'].includes(edge.relation_type)).forEach(edge => {
      if (!String(edge.condition || '').trim()) {
        errors.push(`判断节点“${nodeName}”的关系“${edge.relation_ref || edge.edge_key || '未命名关系'}”缺少判断结果`);
      }
    });
  });
  (workflow?.data_operations || []).forEach(operation => {
    const node = nodeByRef.get(operation.behavior_ref);
    if (!node) return;
    if (node.node_type !== 'action') {
      errors.push(`控制节点“${node.business_name || node.behavior_ref}”不是业务行为，不能承载数据创建、更新或使用关系`);
    }
  });
  if (errors.length) {
    throw new Error(`工作流没有显式表达判断节点：${errors.join('；')}`);
  }
  return workflow;
}

function pendingLifecycle() {
  return migration.pendingLifecycle();
}

function behaviorTemplate(node) {
  return {
    behavior_ref: node.behavior_ref || stableRef('behavior', node.node_key || node.business_name),
    node_type: node.node_type || 'action',
    behavior_name: node.business_name || '',
    behavior_description: node.business_description || '',
    current_actor_role: '',
    actor_assignment_mode: 'fixed_department',
    actor_department_data_ref: null,
    actor_position_rule: '',
    trigger: node.trigger || '',
    precondition: '',
    input_description: '',
    timing: null,
    completion_standard: node.completion_standard || '',
    output_description: '',
    countersign_all_required: false,
    countersign_target_departments: []
  };
}

function dataObjectFromTable(table) {
  const dataRef = table.data_ref || stableRef('data', table.physical_name);
  const fields = (table.fields || [])
    .filter(field => field.classification !== 'technical')
    .filter(field => !TECHNICAL_FIELD_PATTERN.test(field.physical_name || field.business_name || ''))
    .map(field => ({
      field_ref: field.field_ref || stableRef('data_field', `${dataRef}:${field.physical_name || field.business_name}`),
      field_name: field.business_name || field.physical_name,
      field_type: field.field_type || '文本',
      definition: field.definition || ''
    }));
  return {
    data_ref: dataRef,
    data_name: table.business_name || '未命名业务记录',
    description: table.business_description || `记录${table.business_name || '本页'}的业务内容；字段责任和权威来源待业务确认。`,
    information_type: table.information_type || 'business_information',
    fields,
    behavior_links: [],
    source_relations: [],
    lifecycle: pendingLifecycle()
  };
}

function formItemFromField(table, field, dataObject) {
  const dataField = dataObject.fields.find(item => item.field_name === (field.business_name || field.physical_name));
  return {
    item_ref: field.item_ref || stableRef('item', `${table.form_ref || table.physical_name}:${field.physical_name}`),
    item_name: field.business_name || field.physical_name,
    item_type: field.field_type || '文本',
    required: Boolean(field.required),
    instructions: field.business_instructions || '字段用途、必填要求和取值方式待业务确认。',
    business_data_ref: dataObject.data_ref,
    data_field_ref: dataField?.field_ref || null,
    value_usage_mode: field.value_usage_mode || 'pending_confirmation',
    value_origin_mode: field.value_origin_mode || 'pending_confirmation',
    source_links: []
  };
}

function buildFromSnapshot(snapshot, form, workflow) {
  const documentValue = service.createEmptyProcessGovernanceV7Document();
  const processKey = `${form.form_ref || form.root_table}:${workflow.workflow_id}`;
  documentValue.export_meta.package_ref = stableRef('package', processKey);
  documentValue.process = {
    process_ref: stableRef('process', processKey),
    process_name: workflow.process_name || form.business_name || '',
    owning_department: '',
    purpose: form.business_content?.purpose || '',
    scope: form.business_content?.scope || '',
    capability_domain: null,
    business_capability: null,
    classification_status: 'unclassified'
  };
  documentValue.behaviors = (workflow.nodes || []).map(behaviorTemplate);
  documentValue.flow_relations = (workflow.edges || []).map(edge => ({
    relation_ref: edge.relation_ref || stableRef('relation', `${workflow.workflow_id}:${edge.edge_key}`),
    relation_type: edge.relation_type || 'sequence',
    from_behavior_ref: edge.from_behavior_ref,
    to_behavior_ref: edge.to_behavior_ref,
    condition: edge.condition || ''
  }));
  documentValue.data_objects = (form.tables || []).map(dataObjectFromTable);
  const tablesByForm = new Map();
  (form.tables || []).forEach(table => {
    const formRef = table.form_ref || form.form_ref || stableRef('form', table.physical_name);
    if (!tablesByForm.has(formRef)) tablesByForm.set(formRef, []);
    tablesByForm.get(formRef).push(table);
  });
  documentValue.forms = [...tablesByForm.entries()].map(([formRef, tables]) => ({
    form_ref: formRef,
    form_name: tables[0].form_name || form.business_name || '',
    form_no: null,
    form_design_state: 'current_state',
    behavior_links: [],
    areas: tables.map(table => {
      const dataObject = documentValue.data_objects.find(item => item.data_ref === (table.data_ref || stableRef('data', table.physical_name)));
      const businessFields = (table.fields || [])
        .filter(field => field.classification !== 'technical')
        .filter(field => !TECHNICAL_FIELD_PATTERN.test(field.physical_name || field.business_name || ''));
      return {
        area_ref: table.area_ref || stableRef('area', table.physical_name),
        area_type: table.area_type || (table.table_kind === 'detail' ? '明细清单' : '基本信息'),
        area_title: table.area_title || `${table.form_name || form.business_name}${table.table_kind === 'detail' ? '明细' : '基本信息'}`,
        items: businessFields.map(field => formItemFromField(table, field, dataObject))
      };
    })
  }));
  documentValue.terms = (form.term_candidates || []).map(term => ({
    term_ref: term.term_ref || stableRef('term', term.term_name),
    term_name: term.term_name,
    definition: term.definition || ''
  }));
  documentValue.migration.source_process_ref = null;
  return documentValue;
}

function simpleInstruction(original) {
  const value = String(original || '');
  const parts = [];
  if (value.includes('截图确认必填')) parts.push('页面中标记为必填。');
  else if (value.includes('截图确认非必填')) parts.push('页面中未标记为必填，业务上是否允许为空待确认。');
  if (value.includes('当前用户姓名')) parts.push('页面按当前办理人员姓名自动填写。');
  if (value.includes('当前日期')) parts.push('页面按办理日期自动填写。');
  if (value.includes('表编号') && !value.includes('当前用户姓名')) parts.push('编号的具体形成规则待业务确认。');
  return parts.join('') || '字段用途、必填要求和取值方式待业务确认。';
}

function sanitizeMigratedDocument(documentValue, form, workflow) {
  documentValue.process.process_name = workflow.process_name || documentValue.process.process_name;
  if (form.business_content?.purpose) documentValue.process.purpose = form.business_content.purpose;
  if (form.business_content?.scope) documentValue.process.scope = form.business_content.scope;
  const oldBehaviors = new Map((documentValue.behaviors || []).map(item => [item.behavior_ref, item]));
  documentValue.behaviors = (workflow.nodes || []).map(node => {
    const previous = oldBehaviors.get(node.behavior_ref);
    return {
      ...behaviorTemplate(node),
      ...(previous || {}),
      behavior_ref: node.behavior_ref || previous?.behavior_ref || stableRef('behavior', node.node_key || node.business_name),
      node_type: node.node_type || previous?.node_type || 'action',
      behavior_name: node.business_name || previous?.behavior_name || '',
      behavior_description: node.business_description || previous?.behavior_description || '',
      trigger: node.trigger || previous?.trigger || '',
      completion_standard: node.completion_standard || previous?.completion_standard || ''
    };
  });
  documentValue.flow_relations = (workflow.edges || []).map(edge => ({
    relation_ref: edge.relation_ref || stableRef('relation', `${workflow.workflow_id}:${edge.edge_key}`),
    relation_type: edge.relation_type,
    from_behavior_ref: edge.from_behavior_ref,
    to_behavior_ref: edge.to_behavior_ref,
    condition: edge.condition || ''
  }));
  const tableByDataRef = new Map((form.tables || []).map(table => [table.data_ref, table]));
  documentValue.data_objects = (documentValue.data_objects || []).filter(dataObject => tableByDataRef.has(dataObject.data_ref));
  documentValue.data_objects.forEach(dataObject => {
    const table = tableByDataRef.get(dataObject.data_ref);
    dataObject.data_name = table.business_name || dataObject.data_name;
    dataObject.description = table.business_description || `记录${dataObject.data_name}的业务内容；字段责任和权威来源待业务确认。`;
    const excluded = new Set(table.excluded_fields || []);
    dataObject.fields = (dataObject.fields || []).filter(field =>
      !excluded.has(field.field_name) && !TECHNICAL_FIELD_PATTERN.test(field.field_name)
    );
    dataObject.behavior_links = [];
    dataObject.source_relations = [];
  });
  const formNames = new Map((form.tables || []).map(table => [table.form_ref, table.form_name]));
  documentValue.forms = (documentValue.forms || []).filter(item => formNames.has(item.form_ref));
  documentValue.forms.forEach(formItem => {
    formItem.form_name = formNames.get(formItem.form_ref) || formItem.form_name;
    formItem.behavior_links = (formItem.behavior_links || []).map(link => ({
      ...link,
      notes: '业务处理关系来自现有流程配置，具体处理范围待业务确认。'
    }));
    formItem.areas.forEach(area => {
      area.area_title = `${formItem.form_name}${area.area_type === '明细清单' ? '明细' : '基本信息'}`;
      area.items = area.items.filter(item => {
        if (TECHNICAL_FIELD_PATTERN.test(item.item_name)) return false;
        const dataObject = documentValue.data_objects.find(data => data.data_ref === item.business_data_ref);
        return !item.data_field_ref || dataObject?.fields.some(field => field.field_ref === item.data_field_ref);
      });
      area.items.forEach(item => {
        item.instructions = simpleInstruction(item.instructions);
        if ((item.source_links || []).some(link => link.source_type === 'external_system')) {
          item.source_links = [];
          item.value_usage_mode = 'pending_confirmation';
          item.value_origin_mode = 'pending_confirmation';
        }
      });
    });
  });
  documentValue.terms = (form.term_candidates || []).map(term => ({
    term_ref: term.term_ref || stableRef('term', term.term_name),
    term_name: term.term_name,
    definition: term.definition || ''
  }));
  documentValue.migration.reference_materials = [];
  documentValue.migration.internal_process_calls = [];
  documentValue.migration.work_roles = [];
  documentValue.migration.unresolved_actor_roles = [];
  documentValue.migration.unresolved_join_modes = [];
  return documentValue;
}

function expandDataOperations(workflow, dataRefs) {
  return (workflow.data_operations || []).flatMap(operation => {
    const excluded = new Set(operation.exclude_data_refs || []);
    const targets = (operation.data_refs?.includes('*') ? dataRefs : (operation.data_refs || [operation.data_ref]))
      .filter(dataRef => !excluded.has(dataRef));
    return targets.filter(Boolean).map(dataRef => ({ ...operation, data_ref: dataRef }));
  });
}

function applyDataOperations(documentValue, workflow) {
  const dataByRef = new Map(documentValue.data_objects.map(item => [item.data_ref, item]));
  expandDataOperations(workflow, [...dataByRef.keys()]).forEach((operation, index) => {
    const dataObject = dataByRef.get(operation.data_ref);
    if (!dataObject) throw new Error(`数据操作引用不存在的数据对象：${operation.data_ref}`);
    const behavior = documentValue.behaviors.find(item => item.behavior_ref === operation.behavior_ref);
    if (!behavior) throw new Error(`数据操作引用不存在的行为：${operation.behavior_ref}`);
    const updatedFieldRefs = (operation.updated_fields || []).map(fieldName => {
      const field = dataObject.fields.find(item => item.field_name === fieldName);
      if (!field) throw new Error(`${behavior.behavior_name}要更新的字段不存在：${dataObject.data_name}.${fieldName}`);
      return field.field_ref;
    });
    if (operation.operation !== 'update' && updatedFieldRefs.length) {
      throw new Error(`${behavior.behavior_name}不是更新操作，不能填写 updated_fields`);
    }
    if (operation.operation === 'update' && !updatedFieldRefs.length) {
      throw new Error(`${behavior.behavior_name}的更新操作必须列出实际更新字段`);
    }
    if (dataObject.behavior_links.some(link => link.behavior_ref === operation.behavior_ref)) {
      throw new Error(`${behavior.behavior_name}与${dataObject.data_name}存在重复数据关系`);
    }
    dataObject.behavior_links.push({
      link_ref: operation.link_ref || stableRef('datalink', `${workflow.workflow_id}:${operation.behavior_ref}:${operation.data_ref}:${index}`),
      behavior_ref: operation.behavior_ref,
      operation: operation.operation,
      updated_field_refs: updatedFieldRefs
    });
  });
}

function applyFormulaMappings(documentValue, form) {
  (form.formula_mappings || []).forEach((formula, index) => {
    const targetForm = documentValue.forms.find(item => item.form_ref === formula.target_form_ref);
    const targetItem = targetForm?.areas.flatMap(area => area.items)
      .find(item => item.business_data_ref === formula.target_data_ref && item.item_name === formula.target_field_name);
    const sourceData = documentValue.data_objects.find(item => item.data_ref === formula.source_data_ref);
    if (!targetItem || !sourceData) return;
    targetItem.value_usage_mode = formula.value_usage_mode || 'reuse_existing';
    targetItem.value_origin_mode = 'depends_on_data';
    targetItem.source_links = [{
      source_link_ref: formula.source_link_ref || stableRef('source', `${formula.target_data_ref}:${formula.target_field_name}:${index}`),
      source_type: 'process_data',
      source_data_ref: sourceData.data_ref,
      source_system_name: '',
      source_data_name: formula.source_business_name || `${sourceData.data_name}中的${formula.source_field_name}`,
      source_role: formula.source_role || 'provides_value'
    }];
  });
}

function applyAnonymizationEvidence(documentValue, form) {
  if (form.anonymous_processing !== false) return;
  const updateState = state => {
    if (!state) return;
    state.identifiability_applicability = 'not_applicable';
    state.identifiability = 'not_applicable';
  };
  documentValue.data_objects.forEach(dataObject => {
    updateState(dataObject.lifecycle?.entry_state);
    (dataObject.lifecycle?.routes || []).forEach(route => {
      updateState(route.exit_state);
      (route.events || []).forEach(event => updateState(event.result_state));
    });
  });
}

function collectBusinessTexts(documentValue) {
  return [
    documentValue.process.purpose,
    documentValue.process.scope,
    ...documentValue.behaviors.flatMap(item => [item.behavior_name, item.behavior_description, item.trigger, item.completion_standard]),
    ...documentValue.data_objects.flatMap(item => [item.data_name, item.description, ...item.fields.flatMap(field => [field.field_name, field.definition])]),
    ...documentValue.forms.flatMap(item => [item.form_name, ...item.areas.flatMap(area => [area.area_title, ...area.items.flatMap(field => [
      field.item_name,
      field.instructions,
      ...field.source_links.flatMap(link => [link.source_system_name, link.source_data_name])
    ])])]),
    ...documentValue.terms.flatMap(item => [item.term_name, item.definition])
  ].filter(Boolean);
}

function assertBusinessTextClean(documentValue) {
  const leaked = collectBusinessTexts(documentValue).find(value => TECHNICAL_TEXT_PATTERN.test(String(value)));
  if (leaked) throw new Error(`业务JSON仍含技术名称：${String(leaked).slice(0, 120)}`);
}

function evidenceEntry({ sourceObject, sourceField = '', relation = '', targetPath, capturedAt, summary, status }) {
  if (!EVIDENCE_STATUSES.has(status)) throw new Error(`未知证据状态：${status}`);
  return {
    database: 'CXSYSYS',
    schema: 'dbo',
    source_object: sourceObject,
    source_field: sourceField,
    source_relation: relation,
    target_json_path: targetPath,
    evidence_time: capturedAt,
    summary,
    status
  };
}

function buildEvidence(documentValue, snapshot, form, workflow, liveVerified) {
  const entries = [];
  const tableByDataRef = new Map((form.tables || []).map(table => [table.data_ref, table]));
  documentValue.data_objects.forEach((dataObject, dataIndex) => {
    const table = tableByDataRef.get(dataObject.data_ref);
    entries.push(evidenceEntry({
      sourceObject: table?.physical_name || '', targetPath: `$.data_objects[${dataIndex}]`, capturedAt: snapshot.captured_at,
      summary: `业务对象“${dataObject.data_name}”及其表单区域来自表结构对应关系。`, status: liveVerified ? '实时已核验' : '结构已确认'
    }));
    dataObject.fields.forEach((field, fieldIndex) => entries.push(evidenceEntry({
      sourceObject: table?.physical_name || '', sourceField: field.field_name,
      targetPath: `$.data_objects[${dataIndex}].fields[${fieldIndex}]`, capturedAt: snapshot.captured_at,
      summary: `业务字段“${field.field_name}”来自当前表单字段结构。`, status: liveVerified ? '实时已核验' : '结构已确认'
    })));
    dataObject.behavior_links.forEach((link, linkIndex) => entries.push(evidenceEntry({
      sourceObject: table?.physical_name || '', relation: `${link.behavior_ref}:${link.operation}`,
      targetPath: `$.data_objects[${dataIndex}].behavior_links[${linkIndex}]`, capturedAt: snapshot.captured_at,
      summary: link.operation === 'update' ? `配置和字段结构表明该节点填写${link.updated_field_refs.length}个字段；实际写入时点仍待实时核验。` : `当前关系按${link.operation}处理。`,
      status: link.operation === 'update' && !liveVerified ? '分析候选' : liveVerified ? '实时已核验' : '配置已确认'
    })));
  });
  (workflow.nodes || []).forEach((node, index) => entries.push(evidenceEntry({
    sourceObject: workflow.workflow_id, relation: node.node_key,
    targetPath: `$.behaviors[${index}]`, capturedAt: snapshot.captured_at,
    summary: node.evidence_summary || (node.node_type === 'action'
      ? `工作流配置形成业务行为“${node.business_name}”；正式岗位仍待业务确认。`
      : `为明确表达流程分支，从工作流节点和连线条件拆分出控制节点“${node.business_name}”；该节点不是业务行为。`),
    status: node.evidence_status || (node.node_type === 'action' ? '配置已确认' : '分析候选')
  })));
  (workflow.edges || []).forEach((edge, index) => entries.push(evidenceEntry({
    sourceObject: workflow.workflow_id, relation: `${edge.from_behavior_ref}->${edge.to_behavior_ref}`,
    targetPath: `$.flow_relations[${index}]`, capturedAt: snapshot.captured_at,
    summary: edge.evidence_summary || (edge.condition ? `流程关系条件为“${edge.condition}”。` : '当前流程结构形成顺序关系。'),
    status: edge.evidence_status || '分析候选'
  })));
  (form.term_candidates || []).forEach((term, index) => entries.push(evidenceEntry({
    sourceObject: term.source_object || form.root_table, sourceField: term.source_field || term.term_name,
    targetPath: `$.terms[${index}]`, capturedAt: snapshot.captured_at,
    summary: `“${term.term_name}”由业务字段或列表规范形成术语候选。`, status: term.definition ? '配置已确认' : '分析候选'
  })));
  (workflow.role_candidates || []).forEach(candidate => entries.push(evidenceEntry({
    sourceObject: workflow.workflow_id, relation: candidate.behavior_ref,
    targetPath: `$.behaviors[?(@.behavior_ref=='${candidate.behavior_ref}')].current_actor_role`, capturedAt: snapshot.captured_at,
    summary: `配置角色“${candidate.role_name}”仅作为执行角色候选，未写成正式岗位。`, status: '分析候选'
  })));
  return entries;
}

function resolvedSnapshot(snapshot, form, documentValue) {
  const output = clone(snapshot);
  const dataByRef = new Map(documentValue.data_objects.map(item => [item.data_ref, item]));
  output.forms = output.forms.map(item => item === form ? {
    ...item,
    tables: (item.tables || []).map(table => ({
      ...table,
      resolved_business_fields: (dataByRef.get(table.data_ref)?.fields || []).map(field => ({
        physical_name: field.field_name,
        business_name: field.field_name,
        field_type: field.field_type
      }))
    }))
  } : item);
  return output;
}

function verifyReadOnlyFile(filePath, snapshot, form, workflow) {
  if (!filePath) return null;
  const verification = readJson(filePath);
  if (verification.read_only_verified !== true || verification.database !== 'CXSYSYS' || verification.schema !== 'dbo') {
    throw new Error('实时核验文件未通过只读标记或数据库边界检查');
  }
  if (verification.root_table !== form.root_table || verification.workflow_id !== workflow.workflow_id) {
    throw new Error('实时核验文件与本次主表或工作流不一致');
  }
  walkKeys(verification);
  return verification;
}

function buildPendingIssues(snapshot, form, workflow, liveVerified) {
  const issues = [
    ...(snapshot.pending_issues || []),
    ...(form.pending_issues || []),
    ...(workflow.pending_issues || [])
  ];
  if (!form.business_content?.purpose) issues.push('请业务负责人说明本流程要解决的业务问题。');
  issues.push('请业务负责人确认归口部门和每个节点的正式责任岗位。');
  issues.push('请业务负责人确认批准后何时生效，以及是否归档、由谁保管。');
  (workflow.role_candidates || []).forEach(candidate => {
    issues.push(`请确认“${candidate.business_node_name || candidate.behavior_ref}”的正式执行岗位；现有角色配置“${candidate.role_name}”只作为候选。`);
  });
  if (!liveVerified) issues.push('本轮未连接实时数据库：工作流节点、审批字段实际写入时点和退回条件仍需使用专用只读账号核验。');
  return [...new Set(issues)];
}

function assertOutputDirectory(outputDir) {
  if (fs.existsSync(outputDir) && fs.readdirSync(outputDir).length) {
    throw new Error(`输出目录已存在且非空，拒绝覆盖：${outputDir}`);
  }
}

export function generateProcessPackage(options) {
  const snapshotPath = path.resolve(options.snapshotPath);
  const outputDir = path.resolve(options.outputDir);
  const snapshot = assertSafeSnapshot(readJson(snapshotPath));
  const { form, workflow } = selectWorkflow(snapshot, options.rootTable, options.workflowId);
  assertExplicitDecisionRouting(workflow);
  const verification = verifyReadOnlyFile(options.verificationPath, snapshot, form, workflow);
  let documentValue;
  let baseDigest = '';
  if (options.baseJsonPath) {
    const baseBytes = fs.readFileSync(path.resolve(options.baseJsonPath));
    baseDigest = digest(baseBytes);
    documentValue = migration.migrateProcessDocument(JSON.parse(baseBytes.toString('utf8')));
    documentValue = sanitizeMigratedDocument(documentValue, form, workflow);
  } else {
    documentValue = buildFromSnapshot(snapshot, form, workflow);
  }
  documentValue.export_meta.exported_at = new Date().toISOString();
  applyDataOperations(documentValue, workflow);
  applyFormulaMappings(documentValue, form);
  applyAnonymizationEvidence(documentValue, form);
  assertBusinessTextClean(documentValue);
  const validation = service.processGovernanceValidationResult(documentValue);
  if (!validation.valid) {
    throw new Error(`生成的V7未通过结构校验：${validation.errors.slice(0, 5).map(item => `${item.path || item.instancePath || '/'} ${item.message}${item.params?.additionalProperty ? `（${item.params.additionalProperty}）` : ''}`).join('；')}`);
  }
  assertOutputDirectory(outputDir);
  const evidence = buildEvidence(documentValue, snapshot, form, workflow, Boolean(verification));
  const pendingIssues = buildPendingIssues(snapshot, form, workflow, Boolean(verification));
  const schemaSnapshot = resolvedSnapshot(snapshot, form, documentValue);
  const outputJsonFile = businessProcessJsonFileName(documentValue);
  const sourceManifest = {
    generated_at: documentValue.export_meta.exported_at,
    database: snapshot.database,
    schema: snapshot.schema,
    root_table: form.root_table,
    workflow_id: workflow.workflow_id,
    sources: [
      { source_type: 'structure_snapshot', path: snapshotPath, captured_at: snapshot.captured_at, sha256: digest(fs.readFileSync(snapshotPath)) },
      ...(options.baseJsonPath ? [{ source_type: 'base_process_json', path: path.resolve(options.baseJsonPath), captured_at: '', sha256: baseDigest }] : []),
      ...(options.verificationPath ? [{ source_type: 'read_only_verification', path: path.resolve(options.verificationPath), captured_at: verification.verified_at || '', sha256: digest(fs.readFileSync(options.verificationPath)) }] : [])
    ]
  };
  const summary = {
    schema_version: 'database-process-generation-summary-v1',
    generated_at: documentValue.export_meta.exported_at,
    output_schema_version: documentValue.schema_version,
    output_json_file: outputJsonFile,
    review_status: '未审核',
    database_write_operations: 0,
    root_table: form.root_table,
    workflow_id: workflow.workflow_id,
    read_only_verification: verification ? 'verified' : 'not_provided',
    counts: {
      behaviors: documentValue.behaviors.length,
      relations: documentValue.flow_relations.length,
      data_objects: documentValue.data_objects.length,
      forms: documentValue.forms.length,
      terms: documentValue.terms.length,
      evidence_items: evidence.length,
      pending_issues: pendingIssues.length
    },
    validation: { valid: true, schema: 'process-governance-v7' }
  };
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(path.join(outputDir, outputJsonFile), `${JSON.stringify(documentValue, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'source-manifest.json'), `${JSON.stringify(sourceManifest, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'schema-snapshot.json'), `${JSON.stringify(schemaSnapshot, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'evidence-map.jsonl'), `${evidence.map(item => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'pending-issues.md'), `# 待确认问题\n\n${pendingIssues.map((item, index) => `${index + 1}. ${item}`).join('\n')}\n`, 'utf8');
  fs.writeFileSync(path.join(outputDir, 'generation-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  if (verification) {
    fs.writeFileSync(path.join(outputDir, 'read-only-verification.json'), `${JSON.stringify(verification, null, 2)}\n`, 'utf8');
  }
  return { document: documentValue, summary, evidence, pendingIssues, outputDir, outputJsonFile };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`无法识别的参数：${key}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`参数${key}缺少值`);
    args[key.slice(2)] = value;
    index += 1;
  }
  for (const required of ['snapshot', 'root-table', 'output']) {
    if (!args[required]) throw new Error(`缺少必填参数 --${required}`);
  }
  return args;
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = generateProcessPackage({
      snapshotPath: args.snapshot,
      rootTable: args['root-table'],
      workflowId: args.workflow || '',
      baseJsonPath: args['base-json'] || '',
      verificationPath: args['read-only-verification'] || '',
      outputDir: args.output
    });
    process.stdout.write(`${JSON.stringify({ ok: true, output: result.outputDir, summary: result.summary }, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
