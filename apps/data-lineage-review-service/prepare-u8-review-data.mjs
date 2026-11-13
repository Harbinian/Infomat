// Reads audited metadata/dictionary extracts and the existing extension field
// descriptions. Creates new local catalog/presentation files; never connects to SQL Server.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldId, loadCatalog, loadFieldCatalog } from './store.mjs';

const [reviewPath, fieldPath, addendumPath, metadataDir, customFieldPath, extensionPath, labelsPath] = process.argv.slice(2);
if (!labelsPath) throw new Error('Usage: node prepare-u8-review-data.mjs <review> <fields> <addendum> <audited-extracts> <custom-fields> <extension-output> <labels-output>');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const review = loadCatalog(reviewPath);
const base = loadFieldCatalog(fieldPath, review);
const addendum = loadFieldCatalog(addendumPath, review, base);
const existing = new Map([...base.fields, ...addendum.fields]);
const sources = [];
function extract(file) {
  const bytes = readFileSync(join(metadataDir, file));
  const audit = JSON.parse(readFileSync(join(metadataDir, file + '.audit.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (audit.status !== 'succeeded' || audit.source !== 'u8' || audit.sha256 !== hash(bytes) ||
      audit.querySha256 !== hash(readFileSync(join(metadataDir, 'sql', audit.queryFile)))) throw new Error('Unaudited U8 extract: ' + file);
  const rows = bytes.toString('utf8').trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
  if (rows.length !== audit.count) throw new Error('Extract count mismatch: ' + file);
  sources.push({ file, finishedAt: audit.finishedAt, sha256: audit.sha256, queryFile: audit.queryFile, querySha256: audit.querySha256 });
  return rows;
}
const metadata = extract('u8-review-columns.ndjson');
const dictionary = [...extract('u8-dictionary-captions.ndjson'), ...extract('u8-archive-captions.ndjson')];
const tableNames = {
  bas_part: '物料基础档案', bom_bom: '物料清单主表', bom_parent: '物料清单母件',
  bom_opcomponent: '物料清单子件', bom_opcomponentopt: '物料清单子件选项',
  DispatchLists: '发货退货单明细', ext_StockOrderAttribution: '出入库订单归属扩展', Inventory: '存货档案',
  SO_SOMain: '销售订单主表', SO_SODetails: '销售订单明细',
  rdrecord10: '产成品入库单主表', rdrecords10: '产成品入库单明细',
  rdrecord11: '材料出库单主表', rdrecords11: '材料出库单明细',
  rdrecord32: '销售出库单主表', rdrecords32: '销售出库单明细',
};
const contexts = {
  Inventory: ['inventoryref', 'inventorykcref'], bas_part: ['bas_partref', 'bas_partkcref'],
  SO_SOMain: ['17'], SO_SODetails: ['17'], DispatchLists: ['03', '01'],
  rdrecord10: ['0411'], rdrecords10: ['0411'], rdrecord11: ['0412'], rdrecords11: ['0412'],
  rdrecord32: ['0303'], rdrecords32: ['0303'],
};
const chinese = /[\u3400-\u9fff]/u;
const cleanLabel = text => text.trim().replace(/\bID\b/gi, '标识').replace(/\bBOM\b/gi, '物料清单');
const byName = new Map();
for (const row of dictionary) {
  if (!chinese.test(row.caption ?? '') || (row.locale_id && row.locale_id.toLowerCase() !== 'zh-cn')) continue;
  const key = row.source_field.toLowerCase().split('.').at(-1);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(row);
}
const customBytes = readFileSync(customFieldPath);
const customText = customBytes.toString('utf8').split('].map(', 1)[0];
const customNames = new Map([...customText.matchAll(/^\s*\['([^']+)', '([^']+)'/gm)].map(match => [match[1], cleanLabel(match[2])]));
if (customNames.size !== 24) throw new Error('Unexpected custom extension field descriptions');

const known = new Set();
const newFields = [];
const labels = [];
for (const row of metadata) {
  const table = 'dbo.' + row.object_name;
  const name = row.column_name;
  const id = fieldId('用友U8', table, name);
  if (row.database_name !== 'UFDATA_333_2025' || row.schema_name !== 'dbo' || row.object_type.trim() !== 'U' ||
      !tableNames[row.object_name] || known.has(id)) throw new Error('Unexpected U8 physical metadata');
  known.add(id);
  const physical = { system: '用友U8', table, name, identity: row.is_identity === 'True',
    computed: row.is_computed === 'True', primaryKeyOrdinal: Number(row.primary_key_ordinal) };
  const old = existing.get(id);
  if (old) {
    if (old.identity !== physical.identity || old.computed !== physical.computed || old.primaryKeyOrdinal !== physical.primaryKeyOrdinal) {
      throw new Error('Existing field metadata drift: ' + table + '.' + name);
    }
  } else {
    if (row.object_name !== 'SO_SODetails') throw new Error('Unexpected extension table');
    newFields.push(physical);
  }
  const choices = byName.get(name.toLowerCase()) ?? [];
  const exact = choices.filter(item => item.source_table?.toLowerCase() === row.object_name.toLowerCase());
  const preferred = contexts[row.object_name] ?? [];
  const tiers = [
    ['dictionary_custom', /^c?define\d+$/i.test(name) ? choices.filter(item => item.dictionary_name === 'AA_ColumnDic' &&
      !/自定义|自定義|自定项|自定項/.test(item.caption)) : []],
    ['dictionary_table', exact.filter(item => item.dictionary_name === 'GC_FIELD' || item.dictionary_name === 'RP_TableField')],
    ['dictionary_context', ['Inventory', 'bas_part'].includes(row.object_name) ? choices.filter(item => preferred.includes(item.context_key.toLowerCase())) : []],
    ['dictionary_table', exact.filter(item => preferred.includes(item.context_key.toLowerCase()))],
    ['dictionary_table', exact],
    ['dictionary_module', row.object_name.startsWith('bom_') ? choices.filter(item => /^BO\d/.test(item.context_key)) : []],
    ['dictionary_field', choices],
  ];
  let displayName;
  let labelStatus;
  let labelSource;
  let evidence = [];
  if (row.object_name === 'Inventory' && name === 'cInvCode') {
    displayName = '存货编码（PDM产品图号或物料编码）';
    labelStatus = 'user_confirmed';
    labelSource = '用户确认的公司业务含义';
  } else if (row.object_name === 'SO_SODetails' && name === 'cSOCode') {
    if (!choices.some(item => item.caption === '销售订单号')) throw new Error('Sales-order caption evidence missing');
    displayName = '销售订单号';
    labelStatus = 'dictionary_context';
    labelSource = '账套字典与已有字段说明';
    evidence = choices.filter(item => item.caption === '销售订单号').slice(0, 3).map(item =>
      ({ dictionary: item.dictionary_name, context: item.context_key, sourceField: item.source_field, caption: item.caption }));
  } else if (row.object_name === 'ext_StockOrderAttribution') {
    displayName = customNames.get(name);
    if (!displayName) throw new Error('Custom field label missing');
    labelStatus = 'local_dictionary';
    labelSource = '订单归属扩展字段说明';
  } else {
    for (const [method, options] of tiers) {
      const distinct = new Set(options.map(item => cleanLabel(item.caption)));
      if (distinct.size !== 1) continue;
      displayName = [...distinct][0];
      labelStatus = method;
      labelSource = method === 'dictionary_custom' ? '账套自定义字段字典（同名定义匹配）' : '当前账套字段字典';
      evidence = [...new Map(options.map(item => [JSON.stringify([item.dictionary_name, item.context_key, item.source_table, item.caption]), item])).values()]
        .slice(0, 6).map(item => ({ dictionary: item.dictionary_name, context: item.context_key,
          sourceTable: item.source_table, sourceField: item.source_field, caption: item.caption, templateId: item.template_id ?? null }));
      break;
    }
  }
  if (!displayName) {
    if (row.data_type === 'timestamp') {
      displayName = '数据版本标记'; labelStatus = 'metadata_type'; labelSource = '数据库时间戳类型';
    } else if (physical.primaryKeyOrdinal) {
      displayName = tableNames[row.object_name] + '主键'; labelStatus = 'metadata_key'; labelSource = '数据库主键属性';
    } else {
      displayName = '业务含义待核实（第' + row.column_id + '项）'; labelStatus = 'needs_verification';
      labelSource = choices.length ? '字典名称存在歧义，待核对' : '字典缺少中文说明，待补充';
      evidence = [...new Set(choices.map(item => item.caption))].slice(0, 8).map(caption => ({ caption }));
    }
  }
  if (!chinese.test(displayName)) throw new Error('Chinese label required: ' + id);
  labels.push({ id, system: '用友U8', table, name, displayName, tableLabel: tableNames[row.object_name],
    labelStatus, labelSource, evidence });
}
if ([...existing.values()].some(field => field.system === '用友U8' && !known.has(field.id))) throw new Error('Existing U8 field disappeared');
if (newFields.length !== 136 || metadata.filter(row => row.object_name === 'SO_SODetails').length !== 137) throw new Error('SO_SODetails completeness mismatch');
const extension = { format: 'review-field-metadata-addendum-v1', reviewCatalogDigest: review.digest,
  fieldCatalogDigest: base.digest, sources: [sources[0]], fields: newFields };
const counts = Object.fromEntries([...new Set(labels.map(field => field.labelStatus))].map(status =>
  [status, labels.filter(field => field.labelStatus === status).length]));
const presentation = { format: 'review-field-presentation-v1', system: '用友U8', database: 'UFDATA_333_2025',
  sources, localDictionary: { file: customFieldPath, sha256: hash(customBytes) },
  counts, fields: labels };
writeFileSync(extensionPath, JSON.stringify(extension, null, 2) + '\n', { flag: 'wx' });
writeFileSync(labelsPath, JSON.stringify(presentation, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ extensionFields: newFields.length, u8Fields: labels.length, counts }));
