(function universalModule(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BulkDataEditor = api;
}(typeof globalThis === 'undefined' ? this : globalThis, function createBulkDataEditor() {
  'use strict';

  const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
  const ACTIONS = new Map([
    ['', 'upsert'],
    ['新增或更新', 'upsert'],
    ['新增', 'upsert'],
    ['更新', 'upsert'],
    ['upsert', 'upsert'],
    ['删除', 'delete'],
    ['delete', 'delete']
  ]);
  const INFORMATION_TYPES = Object.freeze([
    ['pending_confirmation', '待确认'],
    ['business_information', '业务信息'],
    ['business_conclusion', '业务结论'],
    ['business_status', '业务状态'],
    ['identifier', '标识符'],
    ['file_attachment', '文件或附件'],
    ['other_information_output', '其他信息输出']
  ]);
  const DATA_OPERATIONS = Object.freeze([
    ['create', '创建'],
    ['update', '更新'],
    ['use', '使用'],
    ['pending_confirmation', '待确认']
  ]);
  const TABLES = Object.freeze({
    objects: Object.freeze({
      label: '数据对象',
      columns: Object.freeze([
        ['action', '处理方式'],
        ['data_ref', '数据对象标识'],
        ['data_name', '数据对象名称'],
        ['information_type', '信息类型'],
        ['description', '说明']
      ])
    }),
    fields: Object.freeze({
      label: '对象字段',
      columns: Object.freeze([
        ['action', '处理方式'],
        ['field_ref', '字段标识'],
        ['data_ref', '数据对象标识'],
        ['data_name', '数据对象名称'],
        ['field_name', '字段名称'],
        ['field_type', '字段类型'],
        ['definition', '字段定义']
      ])
    }),
    relations: Object.freeze({
      label: '数据行为关系',
      columns: Object.freeze([
        ['action', '处理方式'],
        ['link_ref', '关系标识'],
        ['data_ref', '数据对象标识'],
        ['data_name', '数据对象名称'],
        ['behavior_ref', '业务行为标识'],
        ['behavior_name', '业务行为名称'],
        ['operation', '数据操作']
      ])
    })
  });

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function text(value) {
    return value == null ? '' : String(value);
  }

  function clean(value) {
    return text(value).trim();
  }

  function arrays(value) {
    return Array.isArray(value) ? value : [];
  }

  function error(row, column, code, message) {
    return { row, column, code, message };
  }

  function warning(row, column, code, message) {
    return { row, column, code, message };
  }

  function parseDelimited(input) {
    const source = text(input);
    if (!source.trim()) return { rows: [], errors: [error(1, '', 'EMPTY_INPUT', '请先粘贴表格内容')] };
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let index = 0; index < source.length; index += 1) {
      const char = source[index];
      if (char === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = !quoted;
        }
        continue;
      }
      if (!quoted && char === '\t') {
        row.push(cell);
        cell = '';
        continue;
      }
      if (!quoted && (char === '\r' || char === '\n')) {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        if (char === '\r' && source[index + 1] === '\n') index += 1;
        continue;
      }
      cell += char;
    }
    if (quoted) return { rows: [], errors: [error(rows.length + 1, '', 'UNCLOSED_QUOTE', '表格中存在未闭合的双引号')] };
    row.push(cell);
    if (row.some(value => text(value).length) || !rows.length) rows.push(row);
    if (rows[0]?.length) rows[0][0] = rows[0][0].replace(/^\uFEFF/, '');
    return { rows, errors: [] };
  }

  function tableDefinition(kind) {
    return TABLES[kind] || null;
  }

  function headerText(kind) {
    const definition = tableDefinition(kind);
    return definition ? definition.columns.map(([, label]) => label).join('\t') : '';
  }

  function parseTable(kind, input) {
    const definition = tableDefinition(kind);
    if (!definition) return { rows: [], errors: [error(1, '', 'TABLE_KIND_INVALID', '不支持该批量表格类型')], warnings: [] };
    const parsed = parseDelimited(input);
    if (parsed.errors.length) return { rows: [], errors: parsed.errors, warnings: [] };
    const headers = parsed.rows[0].map(clean);
    const positions = new Map();
    const errors = [];
    const warnings = [];
    headers.forEach((header, index) => {
      if (!header) return;
      if (positions.has(header)) errors.push(error(1, header, 'DUPLICATE_HEADER', `列头“${header}”重复`));
      positions.set(header, index);
    });
    definition.columns.forEach(([, label]) => {
      if (!positions.has(label)) errors.push(error(1, label, 'HEADER_MISSING', `缺少列头“${label}”`));
    });
    const supported = new Set(definition.columns.map(([, label]) => label));
    headers.filter(Boolean).forEach(header => {
      if (!supported.has(header)) warnings.push(warning(1, header, 'HEADER_IGNORED', `列“${header}”不属于当前模板，预览时将忽略`));
    });
    if (errors.length) return { rows: [], errors, warnings };
    const rows = [];
    parsed.rows.slice(1).forEach((values, index) => {
      if (!values.some(value => clean(value))) return;
      const mapped = { _row: index + 2 };
      definition.columns.forEach(([key, label]) => {
        mapped[key] = text(values[positions.get(label)]);
      });
      rows.push(mapped);
    });
    if (!rows.length) errors.push(error(2, '', 'DATA_ROW_MISSING', '列头下方没有可处理的数据行'));
    return { rows, errors, warnings };
  }

  function enumMap(pairs) {
    const values = new Map();
    pairs.forEach(([code, label]) => {
      values.set(code, code);
      values.set(label, code);
    });
    return values;
  }

  const INFORMATION_TYPE_MAP = enumMap(INFORMATION_TYPES);
  const DATA_OPERATION_MAP = enumMap(DATA_OPERATIONS);
  const INFORMATION_TYPE_LABELS = new Map(INFORMATION_TYPES);
  const DATA_OPERATION_LABELS = new Map(DATA_OPERATIONS);

  function normalizeAction(value, row, errors) {
    const raw = clean(value);
    const action = ACTIONS.get(raw);
    if (!action) errors.push(error(row, '处理方式', 'ACTION_INVALID', `处理方式“${raw}”无效，只能留空、填写“新增或更新”或“删除”`));
    return action || '';
  }

  function normalizeEnum(value, map, row, column, errors) {
    const raw = clean(value);
    const normalized = map.get(raw);
    if (!normalized) errors.push(error(row, column, 'ENUM_INVALID', `${column}“${raw || '空白'}”无效`));
    return normalized || '';
  }

  function validRef(value, row, column, errors, allowEmpty = false) {
    const normalized = clean(value);
    if (!normalized && allowEmpty) return '';
    if (!REF_PATTERN.test(normalized)) errors.push(error(row, column, 'REF_INVALID', `${column}必须以字母或数字开头，只能包含字母、数字、点、下划线、冒号或连字符`));
    return normalized;
  }

  function requireText(value, row, column, errors) {
    const normalized = clean(value);
    if (!normalized) errors.push(error(row, column, 'VALUE_REQUIRED', `${column}不能为空`));
    return normalized;
  }

  function findByRefOrName(collection, refKey, nameKey, refValue, nameValue, row, labels, errors) {
    const ref = clean(refValue);
    const name = clean(nameValue);
    if (ref) {
      const item = collection.find(candidate => candidate?.[refKey] === ref);
      if (!item) {
        errors.push(error(row, labels.ref, 'REFERENCE_NOT_FOUND', `${labels.ref}“${ref}”不存在`));
        return null;
      }
      if (name && clean(item[nameKey]) !== name) {
        errors.push(error(row, labels.name, 'REFERENCE_CONFLICT', `${labels.ref}与${labels.name}指向的记录不一致`));
        return null;
      }
      return item;
    }
    if (!name) {
      errors.push(error(row, labels.ref, 'REFERENCE_REQUIRED', `请填写${labels.ref}，或填写唯一的${labels.name}`));
      return null;
    }
    const matches = collection.filter(candidate => clean(candidate?.[nameKey]) === name);
    if (!matches.length) errors.push(error(row, labels.name, 'REFERENCE_NOT_FOUND', `${labels.name}“${name}”不存在`));
    if (matches.length > 1) errors.push(error(row, labels.name, 'REFERENCE_AMBIGUOUS', `${labels.name}“${name}”存在重名，请补充${labels.ref}`));
    return matches.length === 1 ? matches[0] : null;
  }

  function valuesEqual(left, right) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  function changesFor(before, after, fields) {
    return fields.filter(([key]) => !valuesEqual(before?.[key], after?.[key])).map(([key, label]) => ({
      field: key,
      label,
      before: text(before?.[key]),
      after: text(after?.[key])
    }));
  }

  function defaultDataObject(ref, values) {
    return {
      data_ref: ref,
      data_name: values.data_name,
      description: values.description,
      information_type: values.information_type,
      fields: [],
      behavior_links: [],
      source_relations: [],
      lifecycle: {
        applicability: 'pending_confirmation',
        entry_state: {
          business_validity: 'pending_confirmation',
          custody: 'pending_confirmation',
          identifiability_applicability: 'pending_confirmation',
          identifiability: 'pending_confirmation'
        },
        routes: [],
        analysis: { analyzer_version: '', source_fingerprint: '', status: 'not_analyzed' },
        decision_reason: '',
        decision_notes: ''
      }
    };
  }

  function deleteDataObjectDefault(documentValue, ref) {
    const object = arrays(documentValue.data_objects).find(item => item.data_ref === ref);
    if (!object) return { ok: false, message: '待删除数据对象不存在' };
    const referenced = arrays(documentValue.behaviors).some(item => item.actor_department_data_ref === ref)
      || arrays(documentValue.forms).some(form => arrays(form.areas).some(area => arrays(area.items).some(item =>
        item.business_data_ref === ref || arrays(item.source_links).some(link => link.source_data_ref === ref)
      )))
      || arrays(object.behavior_links).length
      || arrays(object.source_relations).length;
    if (referenced) return { ok: false, message: '该数据对象仍被行为、表单、数据关系或来源线索引用，不能删除' };
    const next = clone(documentValue);
    next.data_objects = arrays(next.data_objects).filter(item => item.data_ref !== ref);
    return { ok: true, document: next };
  }

  function ensureUniqueInputRefs(rows, key, column, errors) {
    const seen = new Map();
    rows.forEach(row => {
      const ref = clean(row[key]);
      if (!ref) return;
      if (seen.has(ref)) errors.push(error(row._row, column, 'INPUT_REF_DUPLICATE', `${column}“${ref}”在第${seen.get(ref)}行和第${row._row}行重复`));
      else seen.set(ref, row._row);
    });
  }

  function applyObjects(documentValue, rows, options, result) {
    ensureUniqueInputRefs(rows, 'data_ref', '数据对象标识', result.errors);
    rows.forEach(row => {
      const action = normalizeAction(row.action, row._row, result.errors);
      const providedRef = validRef(row.data_ref, row._row, '数据对象标识', result.errors, action === 'upsert');
      if (!action) return;
      if (action === 'delete') {
        if (!providedRef) return;
        const existing = arrays(result.document.data_objects).find(item => item.data_ref === providedRef);
        if (!existing) {
          result.errors.push(error(row._row, '数据对象标识', 'OBJECT_NOT_FOUND', `待删除数据对象“${providedRef}”不存在`));
          return;
        }
        const deletion = (options.deleteDataObject || deleteDataObjectDefault)(result.document, providedRef);
        if (!deletion?.ok || !deletion.document) {
          result.errors.push(error(row._row, '处理方式', 'DELETE_BLOCKED', deletion?.message || '数据对象删除被引用检查阻止'));
          return;
        }
        result.document = clone(deletion.document);
        result.diff.push({ row: row._row, action: 'delete', kind: 'objects', ref: providedRef, label: existing.data_name || providedRef, changes: [] });
        result.summary.deleted += 1;
        return;
      }

      const dataName = requireText(row.data_name, row._row, '数据对象名称', result.errors);
      const informationType = normalizeEnum(row.information_type, INFORMATION_TYPE_MAP, row._row, '信息类型', result.errors);
      if (!dataName || !informationType) return;
      const existing = providedRef ? arrays(result.document.data_objects).find(item => item.data_ref === providedRef) : null;
      const ref = providedRef || validRef(options.refFactory('data'), row._row, '数据对象标识', result.errors);
      if (!ref) return;
      if (providedRef && !existing && arrays(result.document.data_objects).some(item => item.data_ref === ref)) {
        result.errors.push(error(row._row, '数据对象标识', 'REF_DUPLICATE', `数据对象标识“${ref}”已存在`));
        return;
      }
      const values = { data_name: dataName, information_type: informationType, description: clean(row.description) };
      if (existing) {
        const next = { ...existing, ...values };
        const changes = changesFor(existing, next, [['data_name', '数据对象名称'], ['information_type', '信息类型'], ['description', '说明']]);
        const index = result.document.data_objects.indexOf(existing);
        result.document.data_objects[index] = next;
        if (changes.length) {
          result.summary.updated += 1;
          result.diff.push({ row: row._row, action: 'update', kind: 'objects', ref, label: dataName, changes });
        } else {
          result.summary.unchanged += 1;
        }
      } else {
        if (arrays(result.document.data_objects).some(item => item.data_ref === ref)) {
          result.errors.push(error(row._row, '数据对象标识', 'REF_DUPLICATE', `数据对象标识“${ref}”重复`));
          return;
        }
        const factory = options.dataObjectFactory || defaultDataObject;
        result.document.data_objects.push(factory(ref, values));
        result.summary.added += 1;
        result.diff.push({ row: row._row, action: 'add', kind: 'objects', ref, label: dataName, changes: [] });
      }
    });
    const names = new Map();
    arrays(result.document.data_objects).forEach(item => {
      const name = clean(item.data_name);
      if (!name) return;
      names.set(name, (names.get(name) || 0) + 1);
    });
    names.forEach((count, name) => {
      if (count > 1) result.warnings.push(warning(0, '数据对象名称', 'DUPLICATE_NAME', `数据对象名称“${name}”存在${count}条记录；后续批量表格必须使用数据对象标识`));
    });
  }

  function fieldOwners(documentValue) {
    const owners = new Map();
    arrays(documentValue.data_objects).forEach(dataObject => arrays(dataObject.fields).forEach(field => {
      if (!owners.has(field.field_ref)) owners.set(field.field_ref, []);
      owners.get(field.field_ref).push({ dataObject, field });
    }));
    return owners;
  }

  function fieldReferences(documentValue, fieldRef) {
    return arrays(documentValue.forms).flatMap(form => arrays(form.areas).flatMap(area => arrays(area.items).filter(item => item.data_field_ref === fieldRef)));
  }

  function applyFields(documentValue, rows, options, result) {
    ensureUniqueInputRefs(rows, 'field_ref', '字段标识', result.errors);
    rows.forEach(row => {
      const action = normalizeAction(row.action, row._row, result.errors);
      const providedRef = validRef(row.field_ref, row._row, '字段标识', result.errors, action === 'upsert');
      if (!action) return;
      const owners = fieldOwners(result.document);
      const existingOwners = providedRef ? arrays(owners.get(providedRef)) : [];
      if (existingOwners.length > 1) {
        result.errors.push(error(row._row, '字段标识', 'REFERENCE_AMBIGUOUS', `字段标识“${providedRef}”在多个数据对象中重复，不能批量处理`));
        return;
      }
      if (action === 'delete') {
        if (!providedRef) return;
        const current = existingOwners[0];
        if (!current) {
          result.errors.push(error(row._row, '字段标识', 'OBJECT_NOT_FOUND', `待删除字段“${providedRef}”不存在`));
          return;
        }
        const references = fieldReferences(result.document, providedRef);
        if (references.length) {
          result.errors.push(error(row._row, '处理方式', 'DELETE_BLOCKED', `字段“${current.field.field_name || providedRef}”仍被${references.length}个表单字段引用，不能删除`));
          return;
        }
        current.dataObject.fields = arrays(current.dataObject.fields).filter(item => item.field_ref !== providedRef);
        result.summary.deleted += 1;
        result.diff.push({ row: row._row, action: 'delete', kind: 'fields', ref: providedRef, label: current.field.field_name || providedRef, changes: [] });
        return;
      }
      const owner = findByRefOrName(
        arrays(result.document.data_objects), 'data_ref', 'data_name', row.data_ref, row.data_name,
        row._row, { ref: '数据对象标识', name: '数据对象名称' }, result.errors
      );
      const fieldName = requireText(row.field_name, row._row, '字段名称', result.errors);
      const fieldType = requireText(row.field_type, row._row, '字段类型', result.errors);
      const existing = existingOwners[0];
      if (fieldType && Object.prototype.hasOwnProperty.call(options, 'allowedFieldTypes')) {
        const allowedFieldTypes = arrays(options.allowedFieldTypes);
        const preservingLegacyType = Boolean(existing && clean(existing.field.field_type) === fieldType);
        if (!allowedFieldTypes.length && !preservingLegacyType) {
          result.errors.push(error(row._row, '字段类型', 'FIELD_TYPE_CATALOG_UNAVAILABLE', '字段类型目录暂不可用，不能新增或修改字段类型'));
        } else if (allowedFieldTypes.length && !allowedFieldTypes.includes(fieldType)) {
          if (preservingLegacyType) {
            result.warnings.push(warning(row._row, '字段类型', 'LEGACY_FIELD_TYPE_PRESERVED', `字段类型“${fieldType}”不在当前受控目录中，本批只原样保留，不会自动改写`));
          } else {
            result.errors.push(error(row._row, '字段类型', 'FIELD_TYPE_INVALID', `字段类型“${fieldType}”不在当前受控目录中`));
          }
        }
      }
      if (!owner || !fieldName || !fieldType) return;
      const ref = providedRef || validRef(options.refFactory('data_field'), row._row, '字段标识', result.errors);
      if (!ref) return;
      if (existing && existing.dataObject.data_ref !== owner.data_ref) {
        result.errors.push(error(row._row, '数据对象标识', 'FIELD_OWNER_CHANGE_BLOCKED', '既有字段不能通过批量表格移动到其他数据对象'));
        return;
      }
      const values = { field_name: fieldName, field_type: fieldType, definition: clean(row.definition) };
      if (existing) {
        const next = { ...existing.field, ...values };
        const changes = changesFor(existing.field, next, [['field_name', '字段名称'], ['field_type', '字段类型'], ['definition', '字段定义']]);
        const index = existing.dataObject.fields.indexOf(existing.field);
        existing.dataObject.fields[index] = next;
        if (changes.length) {
          result.summary.updated += 1;
          result.diff.push({ row: row._row, action: 'update', kind: 'fields', ref, label: fieldName, changes });
        } else {
          result.summary.unchanged += 1;
        }
      } else {
        if (owners.has(ref)) {
          result.errors.push(error(row._row, '字段标识', 'REF_DUPLICATE', `字段标识“${ref}”已存在`));
          return;
        }
        if (!Array.isArray(owner.fields)) owner.fields = [];
        owner.fields.push({ field_ref: ref, ...values });
        result.summary.added += 1;
        result.diff.push({ row: row._row, action: 'add', kind: 'fields', ref, label: fieldName, changes: [] });
      }
    });
  }

  function relationOwners(documentValue) {
    const owners = new Map();
    arrays(documentValue.data_objects).forEach(dataObject => arrays(dataObject.behavior_links).forEach(link => {
      if (!owners.has(link.link_ref)) owners.set(link.link_ref, []);
      owners.get(link.link_ref).push({ dataObject, link });
    }));
    return owners;
  }

  function validateRelationSets(documentValue, result) {
    arrays(documentValue.data_objects).forEach(dataObject => {
      const byPair = new Map();
      let createCount = 0;
      arrays(dataObject.behavior_links).forEach(link => {
        if (!DATA_OPERATION_MAP.has(clean(link.operation))) return;
        if (link.operation === 'create') createCount += 1;
        const key = link.behavior_ref;
        if (!byPair.has(key)) byPair.set(key, []);
        byPair.get(key).push(link.operation);
      });
      if (createCount > 1) result.errors.push(error(0, '数据操作', 'CREATOR_CONFLICT', `数据对象“${dataObject.data_name || dataObject.data_ref}”存在多个已确认创建行为`));
      byPair.forEach((operations, behaviorRef) => {
        if (operations.includes('pending_confirmation') && operations.length > 1) {
          result.errors.push(error(0, '数据操作', 'PENDING_OPERATION_CONFLICT', `数据对象“${dataObject.data_name || dataObject.data_ref}”与业务行为“${behaviorRef}”的待确认操作不能和已确认操作并存`));
        }
        if (new Set(operations).size !== operations.length) {
          result.errors.push(error(0, '数据操作', 'RELATION_DUPLICATE', `数据对象“${dataObject.data_name || dataObject.data_ref}”与业务行为“${behaviorRef}”存在重复数据操作`));
        }
      });
    });
  }

  function applyRelations(documentValue, rows, options, result) {
    ensureUniqueInputRefs(rows, 'link_ref', '关系标识', result.errors);
    rows.forEach(row => {
      const action = normalizeAction(row.action, row._row, result.errors);
      const providedRef = validRef(row.link_ref, row._row, '关系标识', result.errors, action === 'upsert');
      if (!action) return;
      const owners = relationOwners(result.document);
      const existingOwners = providedRef ? arrays(owners.get(providedRef)) : [];
      if (existingOwners.length > 1) {
        result.errors.push(error(row._row, '关系标识', 'REFERENCE_AMBIGUOUS', `关系标识“${providedRef}”在多个数据对象中重复，不能批量处理`));
        return;
      }
      if (action === 'delete') {
        if (!providedRef) return;
        const current = existingOwners[0];
        if (!current) {
          result.errors.push(error(row._row, '关系标识', 'OBJECT_NOT_FOUND', `待删除关系“${providedRef}”不存在`));
          return;
        }
        current.dataObject.behavior_links = arrays(current.dataObject.behavior_links).filter(item => item.link_ref !== providedRef);
        result.summary.deleted += 1;
        result.diff.push({ row: row._row, action: 'delete', kind: 'relations', ref: providedRef, label: current.link.operation || providedRef, changes: [] });
        return;
      }
      const dataObject = findByRefOrName(
        arrays(result.document.data_objects), 'data_ref', 'data_name', row.data_ref, row.data_name,
        row._row, { ref: '数据对象标识', name: '数据对象名称' }, result.errors
      );
      const behavior = findByRefOrName(
        arrays(result.document.behaviors), 'behavior_ref', 'behavior_name', row.behavior_ref, row.behavior_name,
        row._row, { ref: '业务行为标识', name: '业务行为名称' }, result.errors
      );
      const operation = normalizeEnum(row.operation, DATA_OPERATION_MAP, row._row, '数据操作', result.errors);
      if (!dataObject || !behavior || !operation) return;
      const ref = providedRef || validRef(options.refFactory('data_link'), row._row, '关系标识', result.errors);
      if (!ref) return;
      const existing = existingOwners[0];
      if (existing && existing.dataObject.data_ref !== dataObject.data_ref) {
        result.errors.push(error(row._row, '数据对象标识', 'RELATION_OWNER_CHANGE_BLOCKED', '既有数据行为关系不能通过批量表格移动到其他数据对象'));
        return;
      }
      const values = { behavior_ref: behavior.behavior_ref, operation };
      if (existing) {
        const next = { ...existing.link, ...values };
        const changes = changesFor(existing.link, next, [['behavior_ref', '业务行为标识'], ['operation', '数据操作']]);
        const index = existing.dataObject.behavior_links.indexOf(existing.link);
        existing.dataObject.behavior_links[index] = next;
        if (changes.length) {
          result.summary.updated += 1;
          result.diff.push({ row: row._row, action: 'update', kind: 'relations', ref, label: `${dataObject.data_name || dataObject.data_ref} / ${behavior.behavior_name || behavior.behavior_ref}`, changes });
        } else {
          result.summary.unchanged += 1;
        }
      } else {
        if (owners.has(ref)) {
          result.errors.push(error(row._row, '关系标识', 'REF_DUPLICATE', `关系标识“${ref}”已存在`));
          return;
        }
        if (!Array.isArray(dataObject.behavior_links)) dataObject.behavior_links = [];
        dataObject.behavior_links.push({ link_ref: ref, ...values });
        result.summary.added += 1;
        result.diff.push({ row: row._row, action: 'add', kind: 'relations', ref, label: `${dataObject.data_name || dataObject.data_ref} / ${behavior.behavior_name || behavior.behavior_ref}`, changes: [] });
      }
    });
    validateRelationSets(result.document, result);
  }

  function prepare(kind, input, documentValue, options = {}) {
    const parsed = parseTable(kind, input);
    const result = {
      ok: false,
      kind,
      document: clone(documentValue),
      errors: [...parsed.errors],
      warnings: [...parsed.warnings],
      diff: [],
      summary: { added: 0, updated: 0, deleted: 0, unchanged: 0 }
    };
    if (!documentValue || typeof documentValue !== 'object') {
      result.errors.push(error(0, '', 'DRAFT_MISSING', '当前没有可编辑流程'));
      return result;
    }
    if (typeof options.refFactory !== 'function') {
      result.errors.push(error(0, '', 'REF_FACTORY_MISSING', '页面未提供技术标识生成器'));
      return result;
    }
    if (parsed.errors.length) return result;
    if (kind === 'objects') applyObjects(documentValue, parsed.rows, options, result);
    else if (kind === 'fields') applyFields(documentValue, parsed.rows, options, result);
    else if (kind === 'relations') applyRelations(documentValue, parsed.rows, options, result);
    if (!result.errors.length && typeof options.technicalIntegrity === 'function') {
      arrays(options.technicalIntegrity(result.document)).forEach(item => {
        result.errors.push(error(0, '', item.code || 'TECHNICAL_INTEGRITY', item.message || '候选数据未通过技术引用检查'));
      });
    }
    result.ok = result.errors.length === 0;
    if (!result.ok) result.document = clone(documentValue);
    return result;
  }

  function quoteCell(value) {
    const raw = text(value);
    return /[\t\r\n"]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
  }

  function serializeRows(rows) {
    return rows.map(row => row.map(quoteCell).join('\t')).join('\r\n');
  }

  function exportRows(kind, documentValue) {
    const definition = tableDefinition(kind);
    if (!definition) return [];
    const header = definition.columns.map(([, label]) => label);
    const rows = [header];
    if (kind === 'objects') {
      arrays(documentValue?.data_objects).forEach(item => rows.push([
        '', item.data_ref, item.data_name, INFORMATION_TYPE_LABELS.get(item.information_type) || item.information_type, item.description
      ]));
    } else if (kind === 'fields') {
      arrays(documentValue?.data_objects).forEach(dataObject => arrays(dataObject.fields).forEach(field => rows.push([
        '', field.field_ref, dataObject.data_ref, dataObject.data_name, field.field_name, field.field_type, field.definition
      ])));
    } else if (kind === 'relations') {
      const behaviors = new Map(arrays(documentValue?.behaviors).map(item => [item.behavior_ref, item]));
      arrays(documentValue?.data_objects).forEach(dataObject => arrays(dataObject.behavior_links).forEach(link => rows.push([
        '', link.link_ref, dataObject.data_ref, dataObject.data_name, link.behavior_ref,
        behaviors.get(link.behavior_ref)?.behavior_name || '', DATA_OPERATION_LABELS.get(link.operation) || link.operation
      ])));
    }
    return rows;
  }

  function exportTsv(kind, documentValue) {
    return serializeRows(exportRows(kind, documentValue));
  }

  return Object.freeze({
    TABLES,
    INFORMATION_TYPES,
    DATA_OPERATIONS,
    clone,
    parseDelimited,
    parseTable,
    headerText,
    exportRows,
    exportTsv,
    prepare
  });
}));
