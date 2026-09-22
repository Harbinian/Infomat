// Read-only INF-MDM-DAT-00001 parser. No filesystem, database, network or formula evaluation.
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ExcelJS = require('exceljs');
const profile = require('./masterDataTemplateProfile.json');

const PARSER_VERSION = 'master-data-template-v1';
const LIMITS = Object.freeze({ bytes: 5 * 1024 * 1024, expanded: 32 * 1024 * 1024, entries: 1000,
  rows: 5000, columns: 64, cells: 100000, cellBytes: 16384, sheets: 8 });
const text = value => value == null ? '' : String(value).trim();
const fold = value => text(value).replace(/[\s*＊]/g, '');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
function failure(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function reject(code, message, status) { throw failure(code, message, status); }

function inspectArchive(bytes, limits = LIMITS, onEntry = null) {
  const LIMITS = limits;
  // Bound actual expansion before ExcelJS allocates the workbook. Do not trust ZIP size declarations.
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) {
    if (bytes.readUInt32LE(p) === 0x06054b50 && p + 22 + bytes.readUInt16LE(p + 20) === bytes.length) { end = p; break; }
  }
  const bad = () => reject('TEMPLATE_ARCHIVE_INVALID', '工作簿压缩结构损坏或不受支持。');
  if (end < 0) bad();
  const count = bytes.readUInt16LE(end + 10), size = bytes.readUInt32LE(end + 12);
  let cursor = bytes.readUInt32LE(end + 16), total = 0;
  if (bytes.readUInt32LE(end + 4) !== 0 || bytes.readUInt16LE(end + 8) !== count || cursor + size !== end) bad();
  if (count > LIMITS.entries) reject('TEMPLATE_LIMIT_EXCEEDED', '工作簿压缩条目超过限制。', 413);
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > end || bytes.readUInt32LE(cursor) !== 0x02014b50) bad();
    const flags = bytes.readUInt16LE(cursor + 8), method = bytes.readUInt16LE(cursor + 10);
    const compressed = bytes.readUInt32LE(cursor + 20), expanded = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const next = cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    const local = bytes.readUInt32LE(cursor + 42);
    if (next > end || local + 30 > cursor || bytes.readUInt32LE(local) !== 0x04034b50 ||
      flags & 1 || ![0, 8].includes(method) || bytes.readUInt16LE(cursor + 34) !== 0) bad();
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    if (names.has(name) || /(^\/|\\|(^|\/)\.\.(\/|$))/.test(name)) bad();
    names.add(name);
    if (/vbaproject|externallinks\/|embeddings\/|activex\//i.test(name)) {
      reject('TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED', '文件含宏、外部工作簿链接或嵌入内容，请另存为纯 .xlsx 值文件后核对。');
    }
    const localNameLength = bytes.readUInt16LE(local + 26);
    const start = local + 30 + localNameLength + bytes.readUInt16LE(local + 28);
    if (start + compressed > cursor || bytes.readUInt16LE(local + 8) !== method ||
      bytes.subarray(local + 30, local + 30 + localNameLength).toString('utf8') !== name) bad();
    total += expanded;
    if (total > LIMITS.expanded) reject('TEMPLATE_LIMIT_EXCEEDED', '工作簿解压内容超过32MB。', 413);
    let data;
    try { data = method === 0 ? bytes.subarray(start, start + compressed) : zlib.inflateRawSync(bytes.subarray(start, start + compressed), { maxOutputLength: LIMITS.expanded - total + expanded + 1 }); }
    catch (error) {
      if (error.code === 'ERR_BUFFER_TOO_LARGE') reject('TEMPLATE_LIMIT_EXCEEDED', '工作簿实际解压内容超过32MB。', 413);
      reject('TEMPLATE_ARCHIVE_INVALID', '工作簿压缩数据损坏。');
    }
    if (data.length > expanded) reject('TEMPLATE_LIMIT_EXCEEDED', '工作簿实际解压大小超出声明，已拒绝解析。', 413);
    if (data.length !== expanded) bad();
    if (LIMITS.validateCrc && zlib.crc32(data) !== bytes.readUInt32LE(cursor + 16)) bad();
    if (/\.xml$|\.rels$/i.test(name)) {
      const xml = data.toString('utf8');
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) reject('TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED', '不支持包含外部实体声明的工作簿。');
      if (/macroEnabled|vbaProject|externalLinkPath/i.test(xml)) reject('TEMPLATE_ACTIVE_CONTENT_UNSUPPORTED', '不支持宏或外部工作簿链接。');
      // Detect hostile sparse dimensions before ExcelJS creates sparse row/cell arrays.
      if (/^xl\/worksheets\/[^/]+\.xml$/i.test(name)) {
        for (const match of xml.matchAll(/\b(?:r|ref|sqref)=["']([^"']*)["']/g)) {
          if (LIMITS.ignoreValidationRanges && match[0].startsWith('sqref=')) continue;
          for (const coordinate of match[1].matchAll(/([A-Z]*)(\d+)/g)) {
            const column = [...coordinate[1]].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
            if (Number(coordinate[2]) > LIMITS.rows || column > LIMITS.columns) reject('TEMPLATE_LIMIT_EXCEEDED', '工作表超过5000行或64列。', 413);
          }
        }
      }
    }
    if (onEntry) onEntry(name, data);
    cursor = next;
  }
  if (cursor !== end || !(LIMITS.requiredParts || ['[Content_Types].xml', 'xl/workbook.xml']).every(name => names.has(name))) bad();
  return { entries: count, expanded_bytes: total };
}

function cellSource(cell, sheet) {
  const value = cell.value;
  let rawType = 'blank', normalized = null, formulaState = null;
  if (value instanceof Date) { rawType = 'date'; normalized = Number.isNaN(value.getTime()) ? null : value.toISOString(); }
  else if (value !== null && value !== undefined) {
    if (typeof value !== 'object') { rawType = typeof value; normalized = value; }
    else if (Object.hasOwn(value, 'formula') || Object.hasOwn(value, 'sharedFormula')) {
      rawType = 'formula';
      const result = value.result;
      formulaState = result === undefined || result === null || (result instanceof Date && Number.isNaN(result.getTime())) || (typeof result === 'object' && !(result instanceof Date)) ? 'missing_or_invalid' : 'cached_unverified';
      normalized = formulaState === 'cached_unverified' ? (result instanceof Date ? result.toISOString() : result) : null;
    } else {
      rawType = 'string';
      normalized = value.richText ? value.richText.map(part => part.text).join('') : value.hyperlink ? value.text : null;
    }
  }
  if (typeof normalized === 'number' && Number.isInteger(normalized) && /^0+$/.test(cell.numFmt || '')) normalized = String(normalized).padStart(cell.numFmt.length, '0');
  if (typeof normalized === 'string') normalized = normalized.trim();
  const raw = value == null ? null : plain(value);
  if (Buffer.byteLength(JSON.stringify(raw)) > LIMITS.cellBytes) reject('TEMPLATE_LIMIT_EXCEEDED', '单元格原值超过16KB，请缩减后重试。', 413);
  return { sheet_name: sheet, address: cell.address, cell_address: cell.address, column: cell.col,
    raw_type: rawType, raw_value: raw, num_fmt: cell.numFmt || null, normalized_value: normalized,
    ...(formulaState ? { formula_state: formulaState } : {}), ...(value?.hyperlink ? { hyperlink_not_followed: true } : {}) };
}

async function parseMasterDataTemplate(bytes, { originalName = 'template.xlsx' } = {}) {
  if (!Buffer.isBuffer(bytes)) reject('TEMPLATE_INPUT_INVALID', '解析输入必须是原始文件字节。');
  if (!bytes.length) reject('TEMPLATE_INPUT_INVALID', '文件为空。');
  if (bytes.length > LIMITS.bytes) reject('TEMPLATE_LIMIT_EXCEEDED', '文件超过5MB。', 413);
  if (typeof originalName !== 'string' || originalName.length > 512 || !/\.xlsx$/i.test(originalName)) reject('TEMPLATE_FILE_TYPE_INVALID', '仅支持文件名不超过512字符的 .xlsx 文件。');
  const archive = inspectArchive(bytes);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.load(bytes); } catch (_) { reject('TEMPLATE_WORKBOOK_INVALID', 'Excel文件无法读取，请检查文件是否损坏。'); }
  if (workbook.worksheets.length > LIMITS.sheets) reject('TEMPLATE_LIMIT_EXCEEDED', '工作表超过8张。', 413);
  const sheet = workbook.getWorksheet(profile.sheet_name);
  if (!sheet) reject('TEMPLATE_SHEET_MISSING', '未找到“主数据清单”工作表。');
  const out = { schema_version: 'master-data-template-preview-v1', preview_only: true, persisted: false,
    source: { batch_id: null, original_name: originalName.split(/[\\/]/).pop(), raw_sha256: digest(bytes), raw_digest_status: 'available',
      digest_algorithm: 'sha256', byte_length: bytes.length, parser_version: PARSER_VERSION, template_profile_version: profile.profile_version },
    archive, template: { version: null, expected_version: profile.template_version, rules: [], metadata: {}, headers: {}, enum_declarations: [],
      date_system: workbook.properties.date1904 ? '1904' : '1900', other_sheets: workbook.worksheets.filter(s => s !== sheet).map(s => s.name) },
    objects: [], fields: [], source_cells: [], rows: [], issues: [] };
  const issue = (code, message, source = {}, severity = 'error') => {
    out.issues.push({ code, severity, message, sheet_name: sheet.name, ...source });
  };
  if (out.template.other_sheets.length) issue('TEMPLATE_OTHER_SHEETS', '其他工作表不在此模板解析范围，请人工核对。', {}, 'warning');
  let cells = 0;
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > LIMITS.rows || ws.columnCount > LIMITS.columns) reject('TEMPLATE_LIMIT_EXCEEDED', '工作表超过5000行或64列。', 413);
    ws.eachRow(row => row.eachCell(() => { if (++cells > LIMITS.cells) reject('TEMPLATE_LIMIT_EXCEEDED', '非空单元格超过100000个。', 413); }));
  }
  const rowMap = new Map();
  sheet.eachRow(row => {
    const values = [];
    row.eachCell(cell => { if (cell.type !== ExcelJS.ValueType.Merge) { const source = cellSource(cell, sheet.name); values.push(source); out.source_cells.push(source); } });
    rowMap.set(row.number, values);
  });
  const headers = {};
  for (const [kind, definitions] of Object.entries(profile.sections)) {
    const candidates = [...rowMap].filter(([, values]) => values.filter(c => definitions.some(d => fold(d.label) === fold(c.normalized_value))).length >= Math.ceil(definitions.length / 2));
    if (candidates.length !== 1) { issue('TEMPLATE_HEADER_UNRECOGNIZED', `无法唯一识别${kind === 'object' ? '对象' : '字段'}表头，请检查缺列或重复表头。`); continue; }
    const [row, values] = candidates[0], columns = [];
    for (const cell of values) {
      const definition = definitions.find(d => fold(d.label) === fold(cell.normalized_value));
      columns.push({ ...cell, key: definition?.key || null, label: text(cell.normalized_value) });
      if (!definition) issue('TEMPLATE_UNKNOWN_COLUMN', '存在无法识别的列，原值已保留，请核对模板版本。', { row, address: cell.address });
    }
    for (const definition of definitions) {
      const found = columns.filter(c => c.key === definition.key);
      if (found.length !== 1) issue('TEMPLATE_COLUMN_MISMATCH', `“${definition.label}”列缺失或重复。`, { row, key: definition.key });
    }
    headers[kind] = { row, columns };
    out.template.headers[kind] = headers[kind];
  }
  const declarations = new Map();
  for (const [address, validation] of Object.entries(sheet.dataValidations.model)) {
    const signature = JSON.stringify({ type: validation.type, formulae: validation.formulae || [] });
    if (!declarations.has(signature)) declarations.set(signature, { ...JSON.parse(signature), addresses: [] });
    declarations.get(signature).addresses.push(address);
  }
  out.template.enum_declarations = [...declarations.values()];
  const metadataLabels = ['填报部门*', '填报人*', '部门事实确认人*', '填报日期*', 'MDM 工作组复核人', '模板版本'];
  const enumHeader = [...rowMap].find(([, values]) => ['类别', '术语或枚举项', '定义与填写边界'].every(label => values.some(c => c.normalized_value === label)))?.[0];
  if (!enumHeader) issue('TEMPLATE_ENUM_SECTION_MISSING', '缺少模板枚举说明区，请核对版本。', {}, 'warning');
  if (headers.object && headers.field && headers.object.row >= headers.field.row) issue('TEMPLATE_SECTION_ORDER', '对象表必须位于字段表前。');
  const instructionSignatures = [...profile.instructions, ...profile.enum_explanations].map(values => JSON.stringify(values));
  for (const [row, values] of rowMap) {
    const literal = values.filter(c => c.raw_type !== 'formula' && c.normalized_value !== null && c.normalized_value !== '').map(c => c.normalized_value);
    const rowInfo = { row, classification: 'unclassified', addresses: values.map(c => c.address) };
    out.rows.push(rowInfo);
    if (Object.values(headers).some(h => h.row === row)) { rowInfo.classification = 'header'; continue; }
    if (values.some(c => metadataLabels.includes(c.normalized_value))) {
      rowInfo.classification = 'metadata';
      for (const cell of values.filter(c => metadataLabels.includes(c.normalized_value))) {
        const target = cellSource(sheet.getRow(row).getCell(cell.column + 1), sheet.name);
        out.template.metadata[cell.normalized_value] = target;
        if (cell.normalized_value === '模板版本') out.template.version = target.normalized_value;
      }
      continue;
    }
    if (profile.rule_texts.some(rule => literal.includes(rule)) || (row < (headers.object?.row || 1) && literal.some(v => /^\d+\.\s/.test(text(v))))) {
      rowInfo.classification = 'instruction'; out.template.rules.push(...literal); continue;
    }
    if (instructionSignatures.includes(JSON.stringify(literal))) { rowInfo.classification = row > enumHeader ? 'enum_explanation' : 'instruction'; continue; }
    if (row < (headers.object?.row || 1)) { rowInfo.classification = 'template_metadata'; continue; }
    const kind = headers.field && row > headers.field.row && (!enumHeader || row < enumHeader) ? 'field'
      : headers.object && row > headers.object.row && (!headers.field || row < headers.field.row) ? 'object' : null;
    if (!kind) {
      rowInfo.classification = literal.length ? 'unrecognized_outside_table' : 'blank';
      if (literal.length) issue('TEMPLATE_UNCLASSIFIED_ROW', '表格区外有无法识别的内容，已保留原值，请人工核对。', { row });
      continue;
    }
    const definitions = profile.sections[kind], columns = headers[kind].columns;
    const record = { record_type: kind, sheet_name: sheet.name, source_row: row, local_id: null,
      platform_entity_id: null, platform_version_id: null, unresolved_reason: 'preview_not_imported', values: {}, cells: [], extra_cells: [] };
    for (const column of columns) {
      const source = cellSource(sheet.getRow(row).getCell(column.column), sheet.name);
      record.cells.push({ ...source, key: column.key, original_column: column.label });
      if (column.key) record.values[column.key] = source.normalized_value;
    }
    record.extra_cells = values.filter(c => !columns.some(column => column.column === c.column));
    const meaningful = record.cells.filter(c => c.key !== 'local_id' &&
      !(definitions.find(d => d.key === c.key)?.derived && c.raw_type === 'formula') &&
      (text(c.normalized_value) || c.raw_type === 'formula' || c.raw_value?.error));
    const hasExtra = record.extra_cells.some(c => text(c.normalized_value) || c.raw_type === 'formula' || c.raw_value?.error);
    if (!meaningful.length && !hasExtra) { rowInfo.classification = record.values.local_id ? 'reserved' : 'blank'; continue; }
    const example = !record.values.local_id && !hasExtra && definitions.filter(d => !d.derived).every(d => {
      const actual = record.values[d.key];
      return d.example === undefined ? !text(actual) : text(actual) === d.example ||
        (d.key === 'expected_date' && text(actual) === new Date(d.example).toISOString());
    });
    if (example) { rowInfo.classification = 'example'; continue; }
    rowInfo.classification = 'record';
    if (hasExtra) issue('TEMPLATE_UNMAPPED_CELL', '该记录含表头外的内容，已保留，请补齐列含义。', { row });
    record.local_id = text(record.values.local_id) || null;
    if (!record.local_id || record.local_id.length > 128) issue('TEMPLATE_LOCAL_ID_REQUIRED', '请填写不超过128字符的批次内编号。', { row, key: 'local_id' });
    for (const definition of definitions) {
      const cell = record.cells.find(c => c.key === definition.key);
      if (!cell) continue;
      const value = text(cell.normalized_value), loc = { row, address: cell.address, key: definition.key };
      if (definition.required && !value) issue('TEMPLATE_REQUIRED', `请填写“${definition.label.replace('*', '')}”。`, loc);
      if (definition.enum_values && value && !definition.enum_values.includes(value)) {
        issue(definition.key === 'maintaining_department' ? 'TEMPLATE_DEPARTMENT_REVIEW' : 'TEMPLATE_ENUM_INVALID',
          definition.key === 'maintaining_department' ? '该部门不在原模板旧清单中，须用当前有效组织核对；本解析器不决定归属。' : `“${definition.label.replace('*', '')}”不属于已核对的允许选项。`,
          loc, definition.key === 'maintaining_department' ? 'warning' : 'error');
      }
      if (cell.raw_type === 'formula') issue(cell.formula_state === 'cached_unverified' ? 'TEMPLATE_FORMULA_CACHE_UNVERIFIED' : 'TEMPLATE_FORMULA_NO_VALUE',
        cell.formula_state === 'cached_unverified' ? '仅保留公式缓存，未重算；请核对缓存是否过时。' : '公式无有效缓存值，未执行重算；请在源文件核对或填写明确值。', loc, definition.derived ? 'warning' : cell.formula_state === 'cached_unverified' ? 'warning' : 'error');
      if (cell.raw_type === 'string' && cell.raw_value?.error) issue('TEMPLATE_CELL_ERROR', '单元格含Excel错误值。', loc);
      const validation = sheet.getCell(cell.address).dataValidation;
      if (validation?.type === 'list') {
        const formulae = validation.formulae || [];
        if (definition.enum_values && formulae[0] !== `"${definition.enum_values.join(',')}"`) issue('TEMPLATE_ENUM_DECLARATION_CHANGED', '源文件下拉选项与已核对模板不同，原声明已保留；不会自动放宽校验。', loc, 'warning');
      }
    }
    const ids = record.cells.filter(c => ['local_id', 'object_local_id'].includes(c.key));
    for (const cell of ids) {
      if (typeof cell.raw_value === 'number' && (!Number.isSafeInteger(cell.raw_value) || (cell.num_fmt && !/^(General|0+|@)$/.test(cell.num_fmt)))) issue('TEMPLATE_IDENTIFIER_FORMAT', '编号格式无法无损解释，请使用文本编号或纯零占位格式。', { row, address: cell.address });
    }
    if (kind === 'field') {
      record.object_local_id = text(record.values.object_local_id) || null;
      record.object_source_row = null;
      record.definition = { required: record.values.required === '是' ? true : record.values.required === '否' ? false : null, enum_values: null };
      if (record.values.format === '枚举') issue('TEMPLATE_FIELD_ENUM_VALUES_UNSPECIFIED', '“枚举”仅声明格式，模板未提供该字段的业务允许值集合。', { row, key: 'format' }, 'warning');
      if (record.values.format === '代码') {
        const cell = record.cells.find(c => c.key === 'sample_value');
        if (typeof cell?.raw_value === 'number' && (!Number.isSafeInteger(cell.raw_value) || (cell.num_fmt && !/^(General|0+|@)$/.test(cell.num_fmt)))) issue('TEMPLATE_CODE_FORMAT', '代码实例的数值或格式无法无损解释，请改用文本。', { row, address: cell.address });
        else if (typeof cell?.raw_value === 'number' && (!cell.num_fmt || cell.num_fmt === 'General')) issue('TEMPLATE_CODE_LEADING_ZERO_UNKNOWN', '数值型代码没有前导零格式，不能恢复可能已丢失的零，请核对原值。', { row, address: cell.address }, 'warning');
      }
      const sample = text(record.values.sample_value);
      if (record.values.masking === '待处理' || (record.values.sensitivity && !['无敏感信息', '待确认'].includes(record.values.sensitivity) && record.values.masking === '无需脱敏')) issue('TEMPLATE_SAMPLE_NOT_MASKED', '实例脱敏尚未完成或与敏感类型冲突，不能提交。', { row, key: 'masking' });
      if (record.values.sensitivity === '待确认') issue('TEMPLATE_SAMPLE_SENSITIVITY_UNRESOLVED', '实例是否敏感尚未确认，请先人工核对。', { row, key: 'sensitivity' });
      if (/(?:^|\D)1[3-9]\d{9}(?:\D|$)|(?:^|\D)\d{17}[0-9Xx](?:\D|$)|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(sample)) {
        issue('TEMPLATE_SENSITIVE_SAMPLE_REVIEW', '实例疑似含完整联系方式或身份号码，即使选择已脱敏，也必须人工复核。', { row, key: 'sample_value' });
      }
    }
    out[kind === 'object' ? 'objects' : 'fields'].push(record);
  }
  if (out.template.version !== profile.template_version) issue('TEMPLATE_VERSION_DIFFERENCE', '模板版本与已核对版本不同；已按可识别列预览，请人工核对版本说明。', {}, 'warning');
  if (JSON.stringify(out.template.rules) !== JSON.stringify(profile.rule_texts)) issue('TEMPLATE_RULES_DIFFERENCE', '填报规则发生变化或缺失，不能据旧规则认定本文件可提交。');
  issue('TEMPLATE_HISTORICAL_SCOPE', '原模板第8周及部门说明仅作为来源背景，不限制本次范围，也不授予部门归属。', {}, 'warning');
  for (const records of [out.objects, out.fields]) {
    const groups = new Map();
    for (const record of records) { if (record.local_id) groups.set(record.local_id, [...(groups.get(record.local_id) || []), record]); }
    for (const group of groups.values()) if (group.length > 1) for (const record of group) issue('TEMPLATE_DUPLICATE_LOCAL_ID', '同类记录的批次内编号重复，不能选择第一条匹配。', { row: record.source_row, key: 'local_id' });
  }
  for (const field of out.fields) {
    const parents = out.objects.filter(object => object.local_id !== null && object.local_id === field.object_local_id);
    if (parents.length !== 1) issue('TEMPLATE_OBJECT_REFERENCE', parents.length ? '字段对象编号对应多个对象。' : '字段未关联到明确的已填写对象，不能关联示例或预留行。', { row: field.source_row, key: 'object_local_id' });
    else field.object_source_row = parents[0].source_row;
  }
  for (const object of out.objects) {
    const fields = out.fields.filter(field => field.object_source_row === object.source_row);
    const composites = fields.filter(f => f.values.role === '复合唯一标识字段');
    const singles = fields.filter(f => f.values.role === '唯一标识字段');
    object.identifier_preview = { single_field_local_ids: singles.map(f => f.local_id), composite_field_local_ids: composites.map(f => f.local_id), composite_groups: null };
    if (!fields.length) issue('TEMPLATE_FIELDS_REQUIRED', '对象尚无可明确关联的关键字段。', { row: object.source_row });
    if (composites.length === 1) issue('TEMPLATE_COMPOSITE_INCOMPLETE', '复合唯一标识至少需要两个不同字段。', { row: composites[0].source_row, key: 'role' });
    if (composites.length > 1) issue('TEMPLATE_COMPOSITE_GROUP_PENDING', '模板没有组合标识组及顺序，已保留候选字段，后续须明确分组，不能自动认定。', { row: object.source_row }, 'warning');
    if (['已有稳定唯一标识', '有标识但规则不清'].includes(object.values.identifier_status) && !singles.length && !composites.length) issue('TEMPLATE_IDENTIFIER_FIELDS_REQUIRED', '对象声明有标识，但没有对应的标识字段。', { row: object.source_row, key: 'identifier_status' });
    if (object.values.identifier_status === '无唯一标识' && (singles.length || composites.length)) issue('TEMPLATE_IDENTIFIER_CONFLICT', '对象标识现状与字段角色冲突，请核对。', { row: object.source_row });
    const pending = profile.sections.object.filter(d => d.enum_values).some(d => ['待确认', '待补证据', '待部门确认', '待跨部门确认'].includes(object.values[d.key])) ||
      fields.some(f => profile.sections.field.filter(d => d.enum_values).some(d => f.values[d.key] === '待确认'));
    if (pending) for (const key of ['missing_evidence', 'confirmation_actor', 'expected_date', 'closure_condition']) {
      if (!text(object.values[key])) issue('TEMPLATE_PENDING_CLOSURE_REQUIRED', '待定事项必须填写缺少内容、确认主体、预计完成日期和关闭条件。', { row: object.source_row, key });
    }
    const date = text(object.values.expected_date);
    if (date) {
      const day = date.slice(0, 10), parsed = new Date(`${day}T00:00:00Z`);
      if (!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(date) || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) issue('TEMPLATE_DATE_INVALID', '预计完成日期须为有效日期或YYYY-MM-DD文本。', { row: object.source_row, key: 'expected_date' });
      else object.values.expected_date = day;
    }
  }
  if (out.objects.length || out.fields.length) for (const label of metadataLabels.filter(v => v.endsWith('*'))) {
    if (!text(out.template.metadata[label]?.normalized_value)) issue('TEMPLATE_METADATA_REQUIRED', `请填写“${label.replace('*', '')}”。`, { address: out.template.metadata[label]?.address || null });
  }
  for (const item of out.issues) if (item.row && item.key && !item.address) {
    const record = [...out.objects, ...out.fields].find(r => r.source_row === item.row);
    item.address = record?.cells.find(c => c.key === item.key)?.address || null;
  }
  out.summary = { object_count: out.objects.length, field_count: out.fields.length, example_rows: out.rows.filter(r => r.classification === 'example').length,
    reserved_rows: out.rows.filter(r => r.classification === 'reserved').length, errors: out.issues.filter(i => i.severity === 'error').length, warnings: out.issues.filter(i => i.severity === 'warning').length };
  out.validation_passed = out.summary.errors === 0;
  out.status = out.summary.errors ? 'needs_correction' : out.objects.length || out.fields.length ? 'preview_ready' : 'empty';
  out.safety_review = '脱敏选择和规则检查不能证明数据安全；原值仅用于本地核对，未对外发送。';
  return out;
}

function previewMarkdown(preview) {
  const safe = value => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
  const lines = ['# 主数据模板只读预览', '', '本预览尚未写入台账，未形成主数据认定。实例原值仅保存在本地JSON中，以下不展示实例值。', '',
    `文件：${safe(preview.source.original_name)}`, '', `原始字节 SHA-256：${preview.source.raw_sha256}`, '',
    `对象 ${preview.summary.object_count} 项，字段 ${preview.summary.field_count} 项；示例 ${preview.summary.example_rows} 行，预留 ${preview.summary.reserved_rows} 行；错误 ${preview.summary.errors} 项，提示 ${preview.summary.warnings} 项。`, '',
    '## 对象预览', '', '| 原行 | 局部编号 | 对象名称 | 当前来源 | 状态 |', '|---|---|---|---|---|'];
  for (const item of preview.objects) lines.push(`| ${item.source_row} | ${safe(item.local_id)} | ${safe(item.values.name)} | ${safe(item.values.current_source)} | 待核实 |`);
  lines.push('', '## 字段预览', '', '| 原行 | 局部编号 | 对象编号 | 字段名称 | 字段值来源 |', '|---|---|---|---|---|');
  for (const item of preview.fields) lines.push(`| ${item.source_row} | ${safe(item.local_id)} | ${safe(item.object_local_id)} | ${safe(item.values.name)} | ${safe(item.values.value_source_description)} |`);
  lines.push('', '## 逐项校验', '', '| 级别 | 位置 | 错误码 | 说明 |', '|---|---|---|---|');
  for (const item of preview.issues) lines.push(`| ${item.severity === 'error' ? '错误' : '提示'} | ${safe(item.address || (item.row ? `第${item.row}行 ${item.key || ''}` : '工作簿'))} | ${item.code} | ${safe(item.message)} |`);
  lines.push('', preview.safety_review, '');
  return lines.join('\n');
}

module.exports = { parseMasterDataTemplate, previewMarkdown, PARSER_VERSION, LIMITS, inspectArchive, cellSource };
