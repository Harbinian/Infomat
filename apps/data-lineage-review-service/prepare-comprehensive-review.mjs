// Build audited catalog, naming and coverage snapshots from SELECT-only exports.
// Inputs stay immutable. Only new files in the requested output directory are created.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fieldId, loadCatalog, loadFieldCatalog } from './store.mjs';

const [reviewFile, baseFile, addendumFile, extensionFile, auditDir, customFile, outputDir] = process.argv.slice(2);
if (!outputDir) throw new Error('Usage: node prepare-comprehensive-review.mjs <review> <base> <addendum> <extension> <audited-directory> <custom-fields> <new-output-directory>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonFile = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const chinese = /[\u3400-\u9fff]/u;
const clean = text => text.trim().replace(/\bID\b/gi, '标识').replace(/\bBOM\b/gi, '物料清单');
const key = (system, table, name = '') => JSON.stringify([system, table.toLowerCase(), name.toLowerCase()]);
const shortTable = value => (value ?? '').replace(/[\[\]]/g, '').replace(/^dbo\./i, '').toLowerCase();
const excluded = (system, table, name) => system === '勤哲' && (/^dbo\.ES/i.test(table) || /ExcelServer/i.test(name));
const review = loadCatalog(reviewFile);
const base = loadFieldCatalog(baseFile, review);
const addendum = loadFieldCatalog(addendumFile, review, base);
const extension = loadFieldCatalog(extensionFile, review, base);
const previous = new Map([...base.fields, ...addendum.fields, ...extension.fields]);
const previousPhysical = new Map([...previous.values()].map(field => [key(field.system, field.table, field.name), field]));
const sources = [];
function extract(name, source) {
  const bytes = readFileSync(join(auditDir, name + '.ndjson'));
  const audit = jsonFile(join(auditDir, name + '.ndjson.audit.json'));
  if (audit.status !== 'succeeded' || audit.source !== source || audit.sha256 !== hash(bytes) ||
      audit.querySha256 !== hash(readFileSync(join(auditDir, 'sql', audit.queryFile)))) throw new Error('Unverified source: ' + name);
  const rows = bytes.toString('utf8').trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
  if (rows.length !== audit.count) throw new Error('Unexpected source count: ' + name);
  sources.push({ file: name + '.ndjson', system: source, finishedAt: audit.finishedAt, sha256: audit.sha256,
    queryFile: audit.queryFile, querySha256: audit.querySha256 });
  return rows;
}
const scope = jsonFile(join(auditDir, 'scope.json'));
const physical = new Map();
const liveTables = new Map();
for (const [source, system, database] of [['u8', '用友U8', 'UFDATA_333_2025'], ['mes', '勤哲', 'CXSYSYS'], ['kfu', 'KFU8QZ', 'KFU8QZ']]) {
  for (const row of extract(source + '-scope-columns', source)) {
    if (row.database_name !== database || row.schema_name !== 'dbo' || !['U', 'V'].includes(row.object_type.trim())) throw new Error('Wrong physical source');
    const table = row.schema_name + '.' + row.object_name;
    const identity = key(system, table, row.column_name);
    if (physical.has(identity)) throw new Error('Ambiguous physical identity');
    const entry = { ...row, system, table };
    physical.set(identity, entry);
    const tableKey = key(system, table);
    if (!liveTables.has(tableKey)) liveTables.set(tableKey, []);
    liveTables.get(tableKey).push(entry);
  }
}
for (const table of scope.tables.filter(table => !table.excluded)) {
  if (!liveTables.has(key(table.system, table.table))) throw new Error('Referenced object is unresolved: ' + table.table);
}
for (const field of previous.values()) {
  if (excluded(field.system, field.table, field.name)) continue;
  const live = physical.get(key(field.system, field.table, field.name));
  if (!live) throw new Error('Existing field disappeared: ' + field.table + '.' + field.name);
  if (field.identity !== (live.is_identity === 'True') || field.computed !== (live.is_computed === 'True') ||
      field.primaryKeyOrdinal !== Number(live.primary_key_ordinal)) throw new Error('Existing field properties drifted');
}

const dictionary = [...extract('u8-full-captions', 'u8'), ...extract('u8-full-archive-captions', 'u8')];
const forms = extract('u8-voucher-tables', 'u8');
const sections = extract('u8-module-field-sections', 'u8');
extract('u8-archive-tables', 'u8');
const kfuDictionary = extract('kfu-field-dictionary', 'kfu');
const kfuTableDictionary = extract('kfu-table-dictionary', 'kfu');
const viewOrigins = new Map();
for (const [file, table] of [['kfu-so-view-origins', 'dbo.SO_SODetails'],
  ['kfu-mo-detail-origins', 'dbo.mom_orderdetail'], ['kfu-mo-view-origins', 'dbo.mom_order']]) {
  for (const row of extract(file, 'kfu')) {
    if (row.error_number || row.is_hidden === 'True' || !row.source_column || row.source_database !== 'UFDATA_333_2025' || row.source_schema !== 'dbo') {
      throw new Error('View origin is unresolved');
    }
    viewOrigins.set(key('KFU8QZ', table, row.column_name), { system: '用友U8', table: 'dbo.' + row.source_table,
      name: row.source_column, evidence: 'SQL Server结果集来源元数据；使用TOP (0)核对，未读取业务单据行。' });
  }
}
const dictionaryByName = new Map();
for (const row of dictionary) {
  if (!chinese.test(row.caption ?? '') || (row.locale_id && row.locale_id.toLowerCase() !== 'zh-cn')) continue;
  const name = row.source_field.toLowerCase().split('.').at(-1);
  if (!dictionaryByName.has(name)) dictionaryByName.set(name, []);
  dictionaryByName.get(name).push(row);
}
// CardSection is taken from the dictionary, so a header caption cannot silently
// become a detail-field caption merely because its technical name is identical.
const formRows = new Map();
for (const section of sections) {
  if (!chinese.test(section.caption ?? '') || !['T', 'B'].includes(section.card_section)) continue;
  const tables = new Set(forms.filter(form => form.context_key === section.context_key)
    .map(form => shortTable(section.card_section === 'T' ? form.head_table : form.body_table)).filter(Boolean));
  for (const table of tables) {
    const id = table + '.' + section.source_field.toLowerCase();
    if (!formRows.has(id)) formRows.set(id, []);
    formRows.get(id).push({ ...section, dictionary_name: 'voucheritems + vouchers', source_table: table });
  }
}
const kfuRows = new Map();
const kfuTableNames = new Map();
for (const row of kfuTableDictionary) {
  for (const table of new Set([row.physical_table, row.table_key].filter(Boolean).map(shortTable))) {
    if (!kfuTableNames.has(table)) kfuTableNames.set(table, new Set());
    if (chinese.test(row.table_caption ?? '')) kfuTableNames.get(table).add(row.table_caption.trim());
  }
}
for (const row of kfuDictionary) {
  const tables = new Set([row.physical_table, row.column_table].filter(Boolean).map(shortTable));
  for (const table of tables) {
    if (!kfuTableNames.has(table)) kfuTableNames.set(table, new Set());
    if (chinese.test(row.table_caption ?? '')) kfuTableNames.get(table).add(row.table_caption.trim());
    if (!chinese.test(row.column_caption ?? '')) continue;
    const id = table + '.' + row.column_name.toLowerCase();
    if (!kfuRows.has(id)) kfuRows.set(id, []);
    kfuRows.get(id).push({ dictionary_name: 'Sys_TableInfo + Sys_TableColumn', context_key: row.table_id,
      source_table: table, source_field: row.column_name, caption: row.column_caption });
  }
}
const tableNames = {
  bas_part: '物料基础档案', bom_bom: '物料清单主表', bom_parent: '物料清单母件',
  bom_opcomponent: '物料清单子件', bom_opcomponentopt: '物料清单子件选项',
  dispatchlist: '发货退货单主表', dispatchlists: '发货退货单明细', inventory: '存货档案', inventoryclass: '存货分类',
  ext_stockorderattribution: '出入库订单归属扩展', so_somain: '销售订单主表', so_sodetails: '销售订单明细',
  rdrecord10: '产成品入库单主表', rdrecords10: '产成品入库单明细', rdrecord11: '材料出库单主表', rdrecords11: '材料出库单明细',
  rdrecord32: '销售出库单主表', rdrecords32: '销售出库单明细', rdrecord09: '其他出库单主表', rdrecords09: '其他出库单明细',
  mom_order: '生产订单主表', mom_orderdetail: '生产订单明细', mom_moallocate: '生产订单用料',
  fitem: '项目分类档案', fitemss01: '项目明细档案', salebillvouchs: '销售发票明细', ia_subsidiary: '存货核算明细账',
};
const tableLabels = new Map();
let tableNumber = 0;
for (const [id, rows] of liveTables) {
  const row = rows[0];
  const names = kfuTableNames.get(shortTable(row.object_name));
  let label = row.system === 'KFU8QZ' && names?.size === 1 ? [...names][0] : null;
  if (!label && chinese.test(row.object_name)) label = row.object_name;
  if (!label && row.system === '用友U8') label = tableNames[shortTable(row.object_name)];
  if (!label && chinese.test(row.table_description ?? '')) label = row.table_description;
  label ??= '业务对象待核实（第' + (++tableNumber) + '项）';
  tableLabels.set(id, label);
}
const customBytes = readFileSync(customFile);
const customNames = new Map([...customBytes.toString('utf8').split('].map(', 1)[0].matchAll(/^\s*\['([^']+)', '([^']+)'/gm)]
  .map(match => [match[1], clean(match[2])]));
if (customNames.size !== 24) throw new Error('Custom field dictionary has changed');
const evidence = options => [...new Map(options.map(row => [JSON.stringify([row.dictionary_name, row.context_key, row.source_table, row.caption]), row])).values()]
  .slice(0, 8).map(row => ({ dictionary: row.dictionary_name, context: row.context_key, sourceTable: row.source_table,
    sourceField: row.source_field, caption: row.caption, templateId: row.template_id ?? null, section: row.card_section ?? null }));
const unique = options => {
  const captions = new Set(options.map(row => clean(row.caption)));
  return captions.size === 1 ? [...captions][0] : null;
};
const kfuByName = new Map();
for (const rows of kfuRows.values()) {
  for (const row of rows) {
    const id = row.source_field.toLowerCase();
    if (!kfuByName.has(id)) kfuByName.set(id, []);
    kfuByName.get(id).push(row);
  }
}
const fields = [];
const names = [];
const namedPhysical = new Map();
let excludedColumns = 0;
for (const row of physical.values()) {
  const { system, table, column_name: name } = row;
  if (excluded(system, table, name)) { excludedColumns++; continue; }
  const old = previousPhysical.get(key(system, table, name));
  const id = old?.id ?? fieldId(system, table, name);
  if (!old) fields.push({ system, table, name, identity: row.is_identity === 'True', computed: row.is_computed === 'True',
    primaryKeyOrdinal: Number(row.primary_key_ordinal) });
  const exactTable = shortTable(row.object_name);
  const choices = dictionaryByName.get(name.toLowerCase()) ?? [];
  const exact = choices.filter(choice => shortTable(choice.source_table) === exactTable);
  const tableLabel = tableLabels.get(key(system, table));
  let displayName;
  let labelStatus;
  let labelSource;
  let proofs = [];
  const origin = viewOrigins.get(key(system, table, name));
  const originName = origin && namedPhysical.get(key(origin.system, origin.table, origin.name));
  if (system === '用友U8' && table === 'dbo.Inventory' && name === 'cInvCode') {
    displayName = '存货编码（PDM产品图号或物料编码）'; labelStatus = 'user_confirmed'; labelSource = '用户确认的公司业务含义';
  } else if (system === '用友U8' && table === 'dbo.SO_SODetails' && ['cSOCode', 'cDefine25'].includes(name)) {
    displayName = name === 'cSOCode' ? '销售订单号' : '生产编号'; labelStatus = 'user_confirmed'; labelSource = '用户确认口径与账套字典';
    proofs = evidence(choices.filter(choice => choice.caption === displayName));
    if (!proofs.length) throw new Error('Confirmed sales field lacks its dictionary evidence');
  } else if (system === '用友U8' && table === 'dbo.ext_StockOrderAttribution') {
    displayName = customNames.get(name); labelStatus = 'local_dictionary'; labelSource = '订单归属扩展技术字段说明';
  } else if (chinese.test(name)) {
    displayName = name; labelStatus = 'native_name'; labelSource = '数据库原有中文字段名';
  } else if (chinese.test(row.column_description ?? '')) {
    displayName = clean(row.column_description); labelStatus = 'database_description'; labelSource = '本表字段的数据库注释';
  } else if (originName) {
    displayName = originName.displayName;
    labelStatus = originName.labelStatus === 'needs_verification' ? 'needs_verification' : 'view_source_dictionary';
    labelSource = labelStatus === 'needs_verification' ? '视图来源已定位；源字段含义仍待核实' : '已定位跨库视图来源，引用源字段中文定义';
    proofs = [{ dictionary: 'SQL Server结果集来源元数据', sourceTable: origin.table, sourceField: origin.name,
      caption: originName.displayName }, ...originName.evidence];
  } else {
    const tiers = system === '用友U8' ? [
      ['dictionary_table', exact.filter(choice => ['GC_FIELD', 'RP_TableField'].includes(choice.dictionary_name))],
      ['dictionary_table', exact],
      ['dictionary_form_table', formRows.get(exactTable + '.' + name.toLowerCase()) ?? []],
      ['dictionary_context', ['inventory', 'bas_part'].includes(exactTable) ? choices.filter(choice =>
        choice.context_key.toLowerCase().startsWith(exactTable === 'inventory' ? 'inventory' : 'bas_part')) : []],
    ] : [['dictionary_table', kfuRows.get(exactTable + '.' + name.toLowerCase()) ?? []]];
    for (const [status, options] of tiers) {
      displayName = unique(options);
      if (!displayName) continue;
      labelStatus = status;
      labelSource = system === 'KFU8QZ' ? 'KFU本表字段字典' : status === 'dictionary_form_table' ? '单据主明细与字段分区联合定位' : '本表字段字典';
      proofs = evidence(options);
      break;
    }
  }
  if (!displayName) {
    if (row.data_type === 'timestamp') { displayName = '数据版本标记'; labelStatus = 'metadata_type'; labelSource = '数据库时间戳类型'; }
    else if (Number(row.primary_key_ordinal)) { displayName = '本表记录主键'; labelStatus = 'metadata_key'; labelSource = '数据库主键属性'; }
    else {
      const proposed = system === '用友U8' ? choices.filter(choice => !/自定义|自定義|自定项|自定項/.test(choice.caption)) :
        system === 'KFU8QZ' ? kfuByName.get(name.toLowerCase()) ?? [] : [];
      const candidate = unique(proposed);
      displayName = candidate ? candidate + '（含义待核实）' : '业务含义待核实（第' + row.column_id + '项）';
      labelStatus = 'needs_verification';
      labelSource = candidate ? '仅有同名字典线索，尚未定位到本表' : choices.length ? '字典解释存在歧义或只有泛化名称' : '未取得本表中文定义';
      proofs = evidence(proposed.length ? proposed : choices);
    }
  }
  if (!displayName || !chinese.test(displayName)) throw new Error('Chinese field label unresolved');
  const named = { id, system, table: old?.table ?? table, name: old?.name ?? name, displayName, tableLabel, labelStatus, labelSource,
    objectKind: row.object_type.trim() === 'V' ? 'view' : 'table', evidence: proofs,
    ...(origin ? { parentReference: { ...origin, fieldId: originName?.id } } : {}) };
  names.push(named);
  namedPhysical.set(key(system, table, name), named);
}
const nameCounts = {};
for (const field of names) {
  nameCounts[field.system] ??= {};
  nameCounts[field.system][field.labelStatus] = (nameCounts[field.system][field.labelStatus] ?? 0) + 1;
}
const scopeTables = scope.tables.filter(table => !table.excluded).map(table => {
  const columns = liveTables.get(key(table.system, table.table));
  const visible = columns.filter(row => !excluded(row.system, row.table, row.column_name));
  const before = visible.filter(row => previousPhysical.has(key(row.system, row.table, row.column_name))).length;
  return { system: table.system, table: columns[0].table, displayName: tableLabels.get(key(table.system, table.table)),
    sources: table.sources, objectKind: columns[0].object_type.trim() === 'V' ? 'view' : 'table', physicalFields: columns.length,
    excludedFields: columns.length - visible.length, beforeFields: before, completeFields: visible.length,
    addedFields: visible.length - before, missingFields: 0 };
});
const summary = ['勤哲', '用友U8', 'KFU8QZ'].map(system => {
  const tables = scopeTables.filter(table => table.system === system);
  return { system, tables: tables.length, fields: tables.reduce((sum, table) => sum + table.completeFields, 0),
    beforeFields: tables.reduce((sum, table) => sum + table.beforeFields, 0),
    addedFields: tables.reduce((sum, table) => sum + table.addedFields, 0),
    views: tables.filter(table => table.objectKind === 'view').length,
    namesPending: nameCounts[system]?.needs_verification ?? 0 };
});
const audit = { format: 'review-catalog-audit-v1', snapshotAt: sources.map(source => source.finishedAt).sort().at(-1),
  scope: '当前评审底册、候选与父级参考及9997已引用的数据库对象', sources, summary, tables: scopeTables,
  excludedTables: scope.tables.filter(table => table.excluded), excludedColumns, missingExistingFields: 0,
  attributeDrift: 0, unresolvedReferences: 0, viewColumnOrigins: viewOrigins.size, expectedSelectableFields: names.length };
const supplemental = { format: 'review-field-metadata-addendum-v1', reviewCatalogDigest: review.digest, fieldCatalogDigest: base.digest,
  precedingDigests: [base.digest, addendum.digest, extension.digest], sources: sources.filter(source => /scope-columns/.test(source.file)), fields };
const presentation = { format: 'review-field-presentation-v2', systems: summary.map(row => row.system), sources,
  localDictionary: { file: customFile, sha256: hash(customBytes) }, countsBySystem: nameCounts, fields: names };
mkdirSync(outputDir, { recursive: true });
for (const [file, data] of [['field-audit-extension.json', supplemental], ['field-presentation.json', presentation], ['catalog-audit.json', audit]]) {
  writeFileSync(join(outputDir, file), JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
}
console.log(JSON.stringify({ tables: scopeTables.length, newFields: fields.length, visibleFields: names.length, excludedColumns, summary }));
