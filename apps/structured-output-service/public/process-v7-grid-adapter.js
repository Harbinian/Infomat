(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ProcessV7GridAdapter = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const INFORMATION_TYPES = [
    'pending_confirmation', 'business_information', 'business_conclusion', 'business_status',
    'identifier', 'file_attachment', 'other_information_output'
  ];
  const DATA_OPERATIONS = ['create', 'update', 'use', 'pending_confirmation'];
  const AVAILABILITY_MODES = ['process_start', 'at_behavior', 'pending_confirmation'];
  const FORM_DESIGN_STATES = ['unspecified', 'current_state', 'proposed_design'];
  const FORM_OPERATIONS = ['create', 'fill', 'modify', 'review', 'approve', 'confirm', 'read', 'archive', 'void'];
  const AREA_TYPES = ['', '基本信息', '明细清单'];
  const VALUE_USAGE_MODES = ['authoritative_input', 'reuse_existing', 'calculated', 'external_source', 'pending_confirmation'];
  const VALUE_ORIGIN_MODES = ['direct_current_process', 'depends_on_data', 'pending_confirmation'];
  const FIELD_SOURCE_TYPES = ['process_data', 'external_system'];
  const FIELD_SOURCE_ROLES = ['provides_value', 'calculation_input', 'validation_basis'];

  const LABELS = Object.freeze({
    pending_confirmation: '待确认',
    business_information: '业务信息', business_conclusion: '业务结论', business_status: '业务状态',
    identifier: '标识符', file_attachment: '文件或附件', other_information_output: '其他信息输出',
    create: '创建', update: '更新', use: '使用', process_start: '流程开始时', at_behavior: '指定业务行为后',
    current_state: '现状表单', proposed_design: '新建或优化表单', unspecified: '待确认',
    fill: '填写', modify: '修改', review: '复核', approve: '批准', confirm: '确认', read: '查阅', archive: '归档', void: '作废',
    authoritative_input: '本流程权威录入点', reuse_existing: '沿用已有值', calculated: '系统计算', external_source: '外部来源自动取得',
    direct_current_process: '当前流程直接取得', depends_on_data: '依赖数据取得',
    process_data: '本流程输出物与数据', external_system: '外部系统',
    provides_value: '提供字段值', calculation_input: '参与计算', validation_basis: '作为校验依据'
  });

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function arrays(value) {
    return Array.isArray(value) ? value : [];
  }

  function clean(value) {
    return value == null ? '' : String(value).trim();
  }

  function nullable(value) {
    const normalized = clean(value);
    return normalized || null;
  }

  function bool(value) {
    if (value === true || value === false) return value;
    return ['true', '1', '是', '必填'].includes(clean(value).toLowerCase());
  }

  function list(value) {
    const source = Array.isArray(value) ? value : clean(value).split(/[,，、\n]/);
    return [...new Set(source.map(clean).filter(Boolean))];
  }

  function options(values) {
    return values.map(value => ({ value, label: LABELS[value] || value || '待确认' }));
  }

  function meta(ref, order, existing = true) {
    return { _row_id: ref, _existing: existing, _deleted: false, _order: order };
  }

  function column(key, label, extra = {}) {
    return { key, label, ...extra };
  }

  function definitions(_documentValue, adapterOptions = {}) {
    const fieldTypes = arrays(adapterOptions.allowedFieldTypes);
    return [
      {
        id: 'data_objects', label: '数据对象', refField: 'data_ref',
        columns: [
          column('data_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('data_name', '数据对象名称', { required: true }),
          column('information_type', '信息类型', { required: true, editor: 'select', values: options(INFORMATION_TYPES) }),
          column('description', '说明', { editor: 'textarea', width: 320 })
        ]
      },
      {
        id: 'data_fields', label: '对象字段', refField: 'field_ref', parentTableId: 'data_objects', parentKey: 'data_ref',
        columns: [
          column('field_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('data_ref', '所属数据对象', { required: true, technicalRef: true, editor: 'lookup', lookup: 'data_objects' }),
          column('field_name', '字段名称', { required: true }),
          column('field_type', '字段类型', { required: true, editor: fieldTypes.length ? 'select' : 'text', values: fieldTypes.map(value => ({ value, label: value })) }),
          column('definition', '业务定义', { editor: 'textarea', width: 320 })
        ]
      },
      {
        id: 'data_behavior_links', label: '数据行为关系', refField: 'link_ref', parentTableId: 'data_objects', parentKey: 'data_ref',
        columns: [
          column('link_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('data_ref', '数据对象', { required: true, technicalRef: true, editor: 'lookup', lookup: 'data_objects' }),
          column('behavior_ref', '业务行为', { required: true, technicalRef: true, editor: 'lookup', lookup: 'behaviors' }),
          column('operation', '数据操作', { required: true, editor: 'select', values: options(DATA_OPERATIONS) }),
          column('updated_field_refs', '更新字段（可多选）', { editor: 'update-fields', width: 300 })
        ]
      },
      {
        id: 'data_source_relations', label: '跨流程数据来源', refField: 'source_ref', parentTableId: 'data_objects', parentKey: 'data_ref',
        columns: [
          column('source_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('data_ref', '数据对象', { required: true, technicalRef: true, editor: 'lookup', lookup: 'data_objects' }),
          column('source_department', '来源部门'), column('source_process_name', '来源流程'),
          column('source_behavior_name', '来源行为'), column('source_data_name', '来源数据'),
          column('availability_mode', '可用时间', { required: true, editor: 'select', values: options(AVAILABILITY_MODES) }),
          column('available_from_behavior_ref', '本流程可用起点', { technicalRef: true, nullable: true, editor: 'lookup', lookup: 'behaviors' })
        ]
      },
      {
        id: 'forms', label: '表单或记录', refField: 'form_ref',
        columns: [
          column('form_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('form_name', '表单或记录名称', { required: true }), column('form_no', '编号', { nullable: true }),
          column('form_design_state', '表单状态', { required: true, editor: 'select', values: options(FORM_DESIGN_STATES) })
        ]
      },
      {
        id: 'form_behavior_links', label: '表单行为关系', refField: 'link_ref', parentTableId: 'forms', parentKey: 'form_ref',
        columns: [
          column('link_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('form_ref', '表单', { required: true, technicalRef: true, editor: 'lookup', lookup: 'forms' }),
          column('behavior_ref', '业务行为', { required: true, technicalRef: true, editor: 'lookup', lookup: 'behaviors' }),
          column('operations', '操作（可多选）', { editor: 'list', allowedValues: FORM_OPERATIONS, width: 240 }),
          column('notes', '说明', { editor: 'textarea', width: 260 })
        ]
      },
      {
        id: 'form_areas', label: '主表与明细表', refField: 'area_ref', parentTableId: 'forms', parentKey: 'form_ref',
        columns: [
          column('area_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('form_ref', '表单', { required: true, technicalRef: true, editor: 'lookup', lookup: 'forms' }),
          column('area_type', '区域类型', { editor: 'select', values: AREA_TYPES.map(value => ({ value, label: value || '归属待确认' })) }),
          column('area_title', '主表或明细表名称', { width: 280 })
        ]
      },
      {
        id: 'form_items', label: '表单字段', refField: 'item_ref', parentTableId: 'form_areas', parentKey: 'area_ref',
        columns: [
          column('item_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('form_ref', '表单', { required: true, technicalRef: true, readOnly: true, editor: 'lookup', lookup: 'forms' }),
          column('area_ref', '主表或明细表', { required: true, technicalRef: true, editor: 'lookup', lookup: 'form_areas' }),
          column('item_name', '字段显示名称', { required: true }),
          column('item_type', '字段类型', { required: true, editor: fieldTypes.length ? 'select' : 'text', values: fieldTypes.map(value => ({ value, label: value })) }),
          column('required', '必填', { editor: 'boolean' }), column('instructions', '填写说明', { editor: 'textarea', width: 300 }),
          column('business_data_ref', '业务数据归属', { technicalRef: true, nullable: true, editor: 'lookup', lookup: 'data_objects' }),
          column('data_field_ref', '引用对象字段', { technicalRef: true, nullable: true, editor: 'lookup', lookup: 'data_fields', dependsOn: 'business_data_ref' }),
          column('value_usage_mode', '字段值使用方式', { required: true, editor: 'select', values: options(VALUE_USAGE_MODES) }),
          column('value_origin_mode', '取值方式', { required: true, editor: 'select', values: options(VALUE_ORIGIN_MODES) })
        ]
      },
      {
        id: 'field_source_links', label: '字段取值来源', refField: 'source_link_ref', parentTableId: 'form_items', parentKey: 'item_ref',
        columns: [
          column('source_link_ref', '技术标识', { technicalRef: true, readOnly: true }),
          column('item_ref', '表单字段', { required: true, technicalRef: true, editor: 'lookup', lookup: 'form_items' }),
          column('source_type', '来源类型', { required: true, editor: 'select', values: options(FIELD_SOURCE_TYPES) }),
          column('source_data_ref', '本流程数据对象', { technicalRef: true, nullable: true, editor: 'lookup', lookup: 'data_objects' }),
          column('source_system_name', '外部系统名称'), column('source_data_name', '外部来源数据'),
          column('source_role', '来源作用', { required: true, editor: 'select', values: options(FIELD_SOURCE_ROLES) })
        ]
      }
    ];
  }

  function read(documentValue) {
    const rows = Object.fromEntries(definitions(documentValue).map(item => [item.id, []]));
    arrays(documentValue?.data_objects).forEach((dataObject, dataIndex) => {
      rows.data_objects.push({ ...meta(dataObject.data_ref, dataIndex), data_ref: dataObject.data_ref, data_name: dataObject.data_name, information_type: dataObject.information_type, description: dataObject.description });
      arrays(dataObject.fields).forEach((field, index) => rows.data_fields.push({
        ...meta(field.field_ref, index), _source_parent_ref: dataObject.data_ref,
        field_ref: field.field_ref, data_ref: dataObject.data_ref, field_name: field.field_name, field_type: field.field_type, definition: field.definition
      }));
      arrays(dataObject.behavior_links).forEach((link, index) => rows.data_behavior_links.push({
        ...meta(link.link_ref, index), _source_parent_ref: dataObject.data_ref,
        link_ref: link.link_ref, data_ref: dataObject.data_ref, behavior_ref: link.behavior_ref, operation: link.operation,
        updated_field_refs: arrays(link.updated_field_refs)
      }));
      arrays(dataObject.source_relations).forEach((source, index) => rows.data_source_relations.push({
        ...meta(source.source_ref, index), _source_parent_ref: dataObject.data_ref,
        source_ref: source.source_ref, data_ref: dataObject.data_ref, source_department: source.source_department,
        source_process_name: source.source_process_name, source_behavior_name: source.source_behavior_name,
        source_data_name: source.source_data_name, availability_mode: source.availability_mode,
        available_from_behavior_ref: source.available_from_behavior_ref
      }));
    });
    arrays(documentValue?.forms).forEach((form, formIndex) => {
      rows.forms.push({ ...meta(form.form_ref, formIndex), form_ref: form.form_ref, form_name: form.form_name, form_no: form.form_no, form_design_state: form.form_design_state });
      arrays(form.behavior_links).forEach((link, index) => rows.form_behavior_links.push({
        ...meta(link.link_ref, index), _source_parent_ref: form.form_ref,
        link_ref: link.link_ref, form_ref: form.form_ref, behavior_ref: link.behavior_ref,
        operations: arrays(link.operations).join('、'), notes: link.notes
      }));
      arrays(form.areas).forEach((area, areaIndex) => {
        rows.form_areas.push({
          ...meta(area.area_ref, areaIndex), _source_parent_ref: form.form_ref,
          area_ref: area.area_ref, form_ref: form.form_ref, area_type: area.area_type, area_title: area.area_title
        });
        arrays(area.items).forEach((item, itemIndex) => {
          rows.form_items.push({
            ...meta(item.item_ref, itemIndex), _source_parent_ref: area.area_ref, _source_form_ref: form.form_ref,
            item_ref: item.item_ref, form_ref: form.form_ref, area_ref: area.area_ref, item_name: item.item_name,
            item_type: item.item_type, required: item.required, instructions: item.instructions,
            business_data_ref: item.business_data_ref, data_field_ref: item.data_field_ref,
            value_usage_mode: item.value_usage_mode, value_origin_mode: item.value_origin_mode
          });
          arrays(item.source_links).forEach((source, sourceIndex) => rows.field_source_links.push({
            ...meta(source.source_link_ref, sourceIndex), _source_parent_ref: item.item_ref,
            source_link_ref: source.source_link_ref, item_ref: item.item_ref, source_type: source.source_type,
            source_data_ref: source.source_data_ref, source_system_name: source.source_system_name,
            source_data_name: source.source_data_name, source_role: source.source_role
          }));
        });
      });
    });
    return rows;
  }

  function nextOrder(rows, parentKey, parentRef) {
    const matching = parentKey ? rows.filter(row => row[parentKey] === parentRef) : rows;
    return matching.reduce((maximum, row) => Math.max(maximum, Number(row._order) || 0), -1) + 1;
  }

  function createRow(tableId, context) {
    const refFactory = context.adapterOptions?.refFactory;
    if (typeof refFactory !== 'function') throw new Error('页面未提供技术标识生成器');
    const source = context.sourceRow || {};
    const parent = context.parentRef || '';
    const rows = arrays(context.rows);
    const configs = {
      data_objects: { ref: 'data_ref', prefix: 'data', defaults: { data_name: '', information_type: 'pending_confirmation', description: '' } },
      data_fields: { ref: 'field_ref', prefix: 'data_field', parent: 'data_ref', defaults: { field_name: '', field_type: '', definition: '' } },
      data_behavior_links: { ref: 'link_ref', prefix: 'data_link', parent: 'data_ref', defaults: { behavior_ref: '', operation: 'pending_confirmation', updated_field_refs: [] } },
      data_source_relations: { ref: 'source_ref', prefix: 'data_source', parent: 'data_ref', defaults: { source_department: '', source_process_name: '', source_behavior_name: '', source_data_name: '', availability_mode: 'pending_confirmation', available_from_behavior_ref: null } },
      forms: { ref: 'form_ref', prefix: 'form', defaults: { form_name: '', form_no: null, form_design_state: 'current_state' } },
      form_behavior_links: { ref: 'link_ref', prefix: 'form_link', parent: 'form_ref', defaults: { behavior_ref: '', operations: '', notes: '' } },
      form_areas: { ref: 'area_ref', prefix: 'area', parent: 'form_ref', defaults: { area_type: '明细清单', area_title: '' } },
      form_items: { ref: 'item_ref', prefix: 'item', parent: 'area_ref', defaults: { form_ref: context.formRef || '', item_name: '', item_type: '', required: false, instructions: '', business_data_ref: null, data_field_ref: null, value_usage_mode: 'pending_confirmation', value_origin_mode: 'pending_confirmation' } },
      field_source_links: { ref: 'source_link_ref', prefix: 'field_source', parent: 'item_ref', defaults: { source_type: 'process_data', source_data_ref: null, source_system_name: '', source_data_name: '', source_role: 'provides_value' } }
    };
    const config = configs[tableId];
    if (!config) throw new Error(`未知表格：${tableId}`);
    const ref = refFactory(config.prefix);
    const row = {
      ...clone(config.defaults),
      ...(context.duplicate ? clone(source) : {}),
      ...meta(ref, nextOrder(rows, config.parent, parent), false),
      [config.ref]: ref
    };
    delete row._source_parent_ref;
    delete row._source_form_ref;
    if (config.parent) row[config.parent] = parent || clean(source[config.parent]);
    return row;
  }

  function problem(errors, row, tableId, column, code, message, severity = 'error') {
    errors.push({ tableId, rowId: row?._row_id || '', column, severity, code, message, focusPath: '' });
  }

  function orderedActive(tables, tableId) {
    return arrays(tables[tableId]).filter(row => !row._deleted).sort((left, right) => Number(left._order || 0) - Number(right._order || 0));
  }

  function validateRows(tables, adapterOptions, result) {
    const defs = definitions(null, adapterOptions);
    defs.forEach(definition => {
      const refs = new Map();
      orderedActive(tables, definition.id).forEach(row => {
        definition.columns.forEach(spec => {
          const value = row[spec.key];
          const derivesFromObjectField = definition.id === 'form_items' && spec.key === 'item_type' && clean(row.data_field_ref);
          if (spec.required && clean(value) === '' && !derivesFromObjectField) {
            problem(result.errors, row, definition.id, spec.key, 'REQUIRED', `${spec.label}不能为空`);
          }
          if (spec.technicalRef && value != null && clean(value) && !REF_PATTERN.test(clean(value))) {
            problem(result.errors, row, definition.id, spec.key, 'REF_INVALID', `${spec.label}必须以字母或数字开头，只能包含字母、数字、点、下划线、冒号或连字符`);
          }
          if (spec.values?.length && clean(value) && !spec.values.some(option => option.value === value)) {
            problem(result.errors, row, definition.id, spec.key, 'ENUM_INVALID', `${spec.label}“${clean(value)}”不在允许范围内`);
          }
          if (spec.allowedValues) {
            const invalid = list(value).filter(item => !spec.allowedValues.includes(item));
            if (invalid.length) problem(result.errors, row, definition.id, spec.key, 'ENUM_INVALID', `${spec.label}包含无效值：${invalid.join('、')}`);
          }
        });
        const ref = clean(row[definition.refField]);
        if (ref) {
          if (refs.has(ref)) problem(result.errors, row, definition.id, definition.refField, 'REF_DUPLICATE', `技术标识“${ref}”在当前表格中重复`);
          refs.set(ref, row);
        }
      });
    });
  }

  function existingOwners(documentValue, collectionName, childName, refKey) {
    const owners = new Map();
    arrays(documentValue[collectionName]).forEach(parent => arrays(parent[childName]).forEach(child => owners.set(child[refKey], parent)));
    return owners;
  }

  function ensureParent(result, row, tableId, column, ref, parentMap, parentLabel) {
    if (!parentMap.has(ref)) {
      problem(result.errors, row, tableId, column, 'PARENT_MISSING', `${parentLabel}“${ref || '空白'}”不存在或已标记删除`);
      return false;
    }
    return true;
  }

  function forbidMove(result, row, tableId, column, nextParent) {
    if (row._existing && row._source_parent_ref && row._source_parent_ref !== nextParent) {
      problem(result.errors, row, tableId, column, 'OWNER_CHANGE_BLOCKED', '既有记录不能通过表格移动到其他上级记录；请删除原记录后再新增');
      return false;
    }
    return true;
  }

  function summarize(sourceDocument, candidateDocument) {
    const before = read(sourceDocument);
    const after = read(candidateDocument);
    const diff = [];
    const summary = { added: 0, updated: 0, deleted: 0, unchanged: 0 };
    Object.keys(after).forEach(tableId => {
      const previous = new Map(before[tableId].map(row => [row._row_id, row]));
      const current = new Map(after[tableId].map(row => [row._row_id, row]));
      previous.forEach((row, ref) => {
        if (!current.has(ref)) {
          summary.deleted += 1;
          diff.push({ tableId, rowId: ref, action: 'delete', label: ref });
        }
      });
      current.forEach((row, ref) => {
        if (!previous.has(ref)) {
          summary.added += 1;
          diff.push({ tableId, rowId: ref, action: 'add', label: ref });
          return;
        }
        const strip = value => Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('_')));
        if (JSON.stringify(strip(previous.get(ref))) !== JSON.stringify(strip(row))) {
          summary.updated += 1;
          diff.push({ tableId, rowId: ref, action: 'update', label: ref });
        } else summary.unchanged += 1;
      });
    });
    return { diff, summary };
  }

  function prepare(documentValue, tables, adapterOptions = {}) {
    const result = { ok: false, document: clone(documentValue), errors: [], warnings: [], diff: [], summary: { added: 0, updated: 0, deleted: 0, unchanged: 0 } };
    if (!documentValue || typeof documentValue !== 'object') {
      result.errors.push({ tableId: '', rowId: '', column: '', severity: 'error', code: 'DRAFT_MISSING', message: '当前没有可编辑流程', focusPath: '' });
      return result;
    }
    validateRows(tables, adapterOptions, result);
    if (result.errors.length) return result;

    const candidate = clone(documentValue);
    const sourceData = new Map(arrays(documentValue.data_objects).map(item => [item.data_ref, item]));
    const sourceForms = new Map(arrays(documentValue.forms).map(item => [item.form_ref, item]));

    candidate.data_objects = orderedActive(tables, 'data_objects').map(row => {
      const existing = sourceData.get(row.data_ref);
      const base = existing ? clone(existing) : (adapterOptions.dataObjectFactory?.(row.data_ref) || {
        data_ref: row.data_ref, fields: [], behavior_links: [], source_relations: [], lifecycle: clone(adapterOptions.pendingLifecycle?.() || {})
      });
      return { ...base, data_ref: row.data_ref, data_name: clean(row.data_name), description: clean(row.description), information_type: row.information_type };
    });
    const dataMap = new Map(candidate.data_objects.map(item => [item.data_ref, item]));

    const sourceFieldOwners = existingOwners(documentValue, 'data_objects', 'fields', 'field_ref');
    candidate.data_objects.forEach(item => { item.fields = []; });
    orderedActive(tables, 'data_fields').forEach(row => {
      if (!ensureParent(result, row, 'data_fields', 'data_ref', row.data_ref, dataMap, '数据对象')) return;
      if (!forbidMove(result, row, 'data_fields', 'data_ref', row.data_ref)) return;
      const sourceOwner = sourceFieldOwners.get(row.field_ref);
      const existing = arrays(sourceOwner?.fields).find(item => item.field_ref === row.field_ref);
      dataMap.get(row.data_ref).fields.push({
        ...(existing ? clone(existing) : {}), field_ref: row.field_ref, field_name: clean(row.field_name),
        field_type: clean(row.field_type), definition: clean(row.definition)
      });
    });

    const behaviorMap = new Map(arrays(candidate.behaviors).map(item => [item.behavior_ref, item]));
    const sourceDataLinkOwners = existingOwners(documentValue, 'data_objects', 'behavior_links', 'link_ref');
    candidate.data_objects.forEach(item => { item.behavior_links = []; });
    orderedActive(tables, 'data_behavior_links').forEach(row => {
      if (!ensureParent(result, row, 'data_behavior_links', 'data_ref', row.data_ref, dataMap, '数据对象')) return;
      if (!ensureParent(result, row, 'data_behavior_links', 'behavior_ref', row.behavior_ref, behaviorMap, '业务行为')) return;
      if (!forbidMove(result, row, 'data_behavior_links', 'data_ref', row.data_ref)) return;
      const sourceOwner = sourceDataLinkOwners.get(row.link_ref);
      const existing = arrays(sourceOwner?.behavior_links).find(item => item.link_ref === row.link_ref);
      dataMap.get(row.data_ref).behavior_links.push({
        ...(existing ? clone(existing) : {}),
        link_ref: row.link_ref,
        behavior_ref: row.behavior_ref,
        operation: row.operation,
        updated_field_refs: row.operation === 'update' ? list(row.updated_field_refs) : []
      });
    });

    const sourceRelationOwners = existingOwners(documentValue, 'data_objects', 'source_relations', 'source_ref');
    candidate.data_objects.forEach(item => { item.source_relations = []; });
    orderedActive(tables, 'data_source_relations').forEach(row => {
      if (!ensureParent(result, row, 'data_source_relations', 'data_ref', row.data_ref, dataMap, '数据对象')) return;
      if (!forbidMove(result, row, 'data_source_relations', 'data_ref', row.data_ref)) return;
      const availableRef = nullable(row.available_from_behavior_ref);
      if (availableRef && !behaviorMap.has(availableRef)) problem(result.errors, row, 'data_source_relations', 'available_from_behavior_ref', 'REFERENCE_MISSING', `业务行为“${availableRef}”不存在`);
      const sourceOwner = sourceRelationOwners.get(row.source_ref);
      const existing = arrays(sourceOwner?.source_relations).find(item => item.source_ref === row.source_ref);
      dataMap.get(row.data_ref).source_relations.push({
        ...(existing ? clone(existing) : {}), source_ref: row.source_ref, source_department: clean(row.source_department),
        source_process_name: clean(row.source_process_name), source_behavior_name: clean(row.source_behavior_name),
        source_data_name: clean(row.source_data_name), availability_mode: row.availability_mode,
        available_from_behavior_ref: availableRef
      });
    });

    candidate.forms = orderedActive(tables, 'forms').map(row => {
      const existing = sourceForms.get(row.form_ref);
      return {
        ...(existing ? clone(existing) : { behavior_links: [], areas: [] }), form_ref: row.form_ref,
        form_name: clean(row.form_name), form_no: nullable(row.form_no), form_design_state: row.form_design_state
      };
    });
    const formMap = new Map(candidate.forms.map(item => [item.form_ref, item]));

    const sourceFormLinkOwners = existingOwners(documentValue, 'forms', 'behavior_links', 'link_ref');
    candidate.forms.forEach(item => { item.behavior_links = []; });
    orderedActive(tables, 'form_behavior_links').forEach(row => {
      if (!ensureParent(result, row, 'form_behavior_links', 'form_ref', row.form_ref, formMap, '表单')) return;
      if (!ensureParent(result, row, 'form_behavior_links', 'behavior_ref', row.behavior_ref, behaviorMap, '业务行为')) return;
      if (!forbidMove(result, row, 'form_behavior_links', 'form_ref', row.form_ref)) return;
      const sourceOwner = sourceFormLinkOwners.get(row.link_ref);
      const existing = arrays(sourceOwner?.behavior_links).find(item => item.link_ref === row.link_ref);
      formMap.get(row.form_ref).behavior_links.push({
        ...(existing ? clone(existing) : {}), link_ref: row.link_ref, behavior_ref: row.behavior_ref,
        operations: list(row.operations), notes: clean(row.notes)
      });
    });

    const sourceAreaOwners = existingOwners(documentValue, 'forms', 'areas', 'area_ref');
    candidate.forms.forEach(item => { item.areas = []; });
    orderedActive(tables, 'form_areas').forEach(row => {
      if (!ensureParent(result, row, 'form_areas', 'form_ref', row.form_ref, formMap, '表单')) return;
      if (!forbidMove(result, row, 'form_areas', 'form_ref', row.form_ref)) return;
      const sourceOwner = sourceAreaOwners.get(row.area_ref);
      const existing = arrays(sourceOwner?.areas).find(item => item.area_ref === row.area_ref);
      formMap.get(row.form_ref).areas.push({
        ...(existing ? clone(existing) : {}), area_ref: row.area_ref, area_type: row.area_type,
        area_title: clean(row.area_title), items: []
      });
    });
    const areaMap = new Map(candidate.forms.flatMap(form => form.areas.map(area => [area.area_ref, { form, area }])));

    const sourceItemOwners = new Map();
    arrays(documentValue.forms).forEach(form => arrays(form.areas).forEach(area => arrays(area.items).forEach(item => sourceItemOwners.set(item.item_ref, { form, area, item }))));
    orderedActive(tables, 'form_items').forEach(row => {
      const areaOwner = areaMap.get(row.area_ref);
      if (!areaOwner) {
        problem(result.errors, row, 'form_items', 'area_ref', 'PARENT_MISSING', `主表或明细表“${row.area_ref || '空白'}”不存在或已标记删除`);
        return;
      }
      if (areaOwner.form.form_ref !== row.form_ref) {
        problem(result.errors, row, 'form_items', 'form_ref', 'FORM_AREA_MISMATCH', '所选主表或明细表不属于当前表单');
        return;
      }
      if (!forbidMove(result, row, 'form_items', 'area_ref', row.area_ref)) return;
      if (row._existing && row._source_form_ref && row._source_form_ref !== row.form_ref) {
        problem(result.errors, row, 'form_items', 'form_ref', 'OWNER_CHANGE_BLOCKED', '既有表单字段不能移动到其他表单');
        return;
      }
      const existing = sourceItemOwners.get(row.item_ref)?.item;
      areaOwner.area.items.push({
        ...(existing ? clone(existing) : {}), item_ref: row.item_ref, item_name: clean(row.item_name),
        item_type: clean(row.item_type), required: bool(row.required), instructions: clean(row.instructions),
        business_data_ref: nullable(row.business_data_ref), data_field_ref: nullable(row.data_field_ref),
        value_usage_mode: row.value_usage_mode, value_origin_mode: row.value_origin_mode, source_links: []
      });
    });
    const itemMap = new Map(candidate.forms.flatMap(form => form.areas.flatMap(area => area.items.map(item => [item.item_ref, item]))));

    const sourceLinkOwners = new Map();
    arrays(documentValue.forms).forEach(form => arrays(form.areas).forEach(area => arrays(area.items).forEach(item => arrays(item.source_links).forEach(source => sourceLinkOwners.set(source.source_link_ref, { item, source })))));
    orderedActive(tables, 'field_source_links').forEach(row => {
      if (!ensureParent(result, row, 'field_source_links', 'item_ref', row.item_ref, itemMap, '表单字段')) return;
      if (!forbidMove(result, row, 'field_source_links', 'item_ref', row.item_ref)) return;
      const sourceDataRef = row.source_type === 'external_system' ? null : nullable(row.source_data_ref);
      if (row.source_type === 'process_data' && !sourceDataRef) {
        problem(result.errors, row, 'field_source_links', 'source_data_ref', 'SOURCE_DATA_REQUIRED', '来源类型为本流程数据时，必须选择数据对象');
      } else if (sourceDataRef && !dataMap.has(sourceDataRef)) {
        problem(result.errors, row, 'field_source_links', 'source_data_ref', 'REFERENCE_MISSING', `数据对象“${sourceDataRef}”不存在`);
      }
      const existing = sourceLinkOwners.get(row.source_link_ref)?.source;
      itemMap.get(row.item_ref).source_links.push({
        ...(existing ? clone(existing) : {}), source_link_ref: row.source_link_ref, source_type: row.source_type,
        source_data_ref: sourceDataRef, source_system_name: row.source_type === 'external_system' ? clean(row.source_system_name) : '',
        source_data_name: row.source_type === 'external_system' ? clean(row.source_data_name) : '', source_role: row.source_role
      });
    });

    const fieldOwners = new Map();
    candidate.data_objects.forEach(dataObject => dataObject.fields.forEach(field => fieldOwners.set(field.field_ref, { dataObject, field })));
    candidate.forms.forEach(form => form.areas.forEach(area => area.items.forEach(item => {
      if (item.business_data_ref && !dataMap.has(item.business_data_ref)) {
        const row = orderedActive(tables, 'form_items').find(entry => entry.item_ref === item.item_ref);
        problem(result.errors, row, 'form_items', 'business_data_ref', 'REFERENCE_MISSING', `业务数据归属“${item.business_data_ref}”不存在`);
      }
      if (item.data_field_ref) {
        const owner = fieldOwners.get(item.data_field_ref);
        const row = orderedActive(tables, 'form_items').find(entry => entry.item_ref === item.item_ref);
        if (!owner) problem(result.errors, row, 'form_items', 'data_field_ref', 'REFERENCE_MISSING', `对象字段“${item.data_field_ref}”不存在`);
        else if (item.business_data_ref && owner.dataObject.data_ref !== item.business_data_ref) {
          problem(result.errors, row, 'form_items', 'data_field_ref', 'FIELD_OWNER_MISMATCH', '引用对象字段不属于所选业务数据对象');
        } else {
          item.business_data_ref = owner.dataObject.data_ref;
          item.item_type = owner.field.field_type;
        }
      }
    })));

    candidate.data_objects.forEach(dataObject => {
      const creators = dataObject.behavior_links.filter(link => link.operation === 'create');
      if (creators.length > 1) {
        const conflictingRef = creators[1]?.link_ref || creators[0]?.link_ref;
        const row = orderedActive(tables, 'data_behavior_links').find(item => item.link_ref === conflictingRef);
        problem(result.errors, row, 'data_behavior_links', 'operation', 'CREATOR_CONFLICT', `数据对象“${dataObject.data_name || dataObject.data_ref}”存在多个已确认创建行为`);
      }
      const pairs = new Map();
      dataObject.behavior_links.forEach(link => {
        const row = orderedActive(tables, 'data_behavior_links').find(item => item.link_ref === link.link_ref);
        const validFieldRefs = new Set(dataObject.fields.map(field => field.field_ref));
        const invalidFieldRefs = arrays(link.updated_field_refs).filter(fieldRef => !validFieldRefs.has(fieldRef));
        if (invalidFieldRefs.length) {
          problem(result.errors, row, 'data_behavior_links', 'updated_field_refs', 'REFERENCE_MISSING', `更新字段不属于数据对象“${dataObject.data_name || dataObject.data_ref}”：${invalidFieldRefs.join('、')}`);
        }
        if (link.operation === 'update' && !arrays(link.updated_field_refs).length) {
          problem(result.warnings, row, 'data_behavior_links', 'updated_field_refs', 'UPDATED_FIELDS_REQUIRED', `数据对象“${dataObject.data_name || dataObject.data_ref}”的更新操作尚未选择更新字段`, 'warning');
        }
        if (!pairs.has(link.behavior_ref)) pairs.set(link.behavior_ref, []);
        pairs.get(link.behavior_ref).push(link.operation);
      });
      pairs.forEach((operations, behaviorRef) => {
        const row = orderedActive(tables, 'data_behavior_links').find(item => item.data_ref === dataObject.data_ref && item.behavior_ref === behaviorRef);
        if (new Set(operations).size !== operations.length) {
          problem(result.errors, row, 'data_behavior_links', 'operation', 'RELATION_DUPLICATE', `数据对象“${dataObject.data_name || dataObject.data_ref}”与同一业务行为存在重复数据操作`);
        }
        if (operations.includes('pending_confirmation') && operations.length > 1) {
          problem(result.errors, row, 'data_behavior_links', 'operation', 'PENDING_OPERATION_CONFLICT', '待确认操作不能与已确认操作同时存在');
        }
      });
    });

    if (!result.errors.length && typeof adapterOptions.technicalIntegrity === 'function') {
      arrays(adapterOptions.technicalIntegrity(candidate)).forEach(item => result.errors.push({
        tableId: '', rowId: '', column: '', severity: 'error', code: item.code || 'TECHNICAL_INTEGRITY',
        message: item.message || '候选数据未通过技术引用检查', focusPath: item.path || ''
      }));
    }

    const duplicateNames = new Map();
    candidate.data_objects.forEach(item => {
      const name = clean(item.data_name);
      if (name) duplicateNames.set(name, (duplicateNames.get(name) || 0) + 1);
    });
    duplicateNames.forEach((count, name) => {
      if (count > 1) result.warnings.push({ tableId: 'data_objects', rowId: '', column: 'data_name', severity: 'warning', code: 'DUPLICATE_NAME', message: `数据对象名称“${name}”存在${count}条记录；建立引用时必须按技术标识区分`, focusPath: '' });
    });
    const duplicateBehaviorNames = new Map();
    arrays(candidate.behaviors).forEach(item => {
      const name = clean(item.behavior_name);
      if (name) duplicateBehaviorNames.set(name, (duplicateBehaviorNames.get(name) || 0) + 1);
    });
    duplicateBehaviorNames.forEach((count, name) => {
      if (count > 1) result.warnings.push({ tableId: 'data_behavior_links', rowId: '', column: 'behavior_ref', severity: 'warning', code: 'DUPLICATE_BEHAVIOR_NAME', message: `业务行为名称“${name}”存在${count}条记录；表格按技术标识保持引用，不会按名称合并`, focusPath: '' });
    });

    if (result.errors.length) return result;
    const changes = summarize(documentValue, candidate);
    result.document = candidate;
    result.diff = changes.diff;
    result.summary = changes.summary;
    result.ok = true;
    return result;
  }

  return Object.freeze({
    TABLE_IDS: Object.freeze(['data_objects', 'data_fields', 'data_behavior_links', 'data_source_relations', 'forms', 'form_behavior_links', 'form_areas', 'form_items', 'field_source_links']),
    LABELS,
    definitions,
    read,
    createRow,
    prepare
  });
}));
