import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fieldId, loadCatalog } from './store.mjs';

const [reviewPath, metadataDir, outputPath] = process.argv.slice(2);
if (!reviewPath || !metadataDir || !outputPath) {
  throw new Error('Usage: node prepare-field-catalog.mjs <review-catalog> <metadata-directory> <output>');
}

const review = loadCatalog(reviewPath);
const sources = [
  ['勤哲', 'CXSYSYS', 'mes-columns.ndjson'],
  ['用友U8', 'UFDATA_333_2025', 'u8-review-columns.ndjson'],
  ['KFU8QZ', 'KFU8QZ', 'kfu-columns.ndjson'],
];
const fields = new Map();
const audits = [];
for (const [system, database, file] of sources) {
  const path = join(metadataDir, file);
  const audit = JSON.parse(readFileSync(path + '.audit.json', 'utf8').replace(/^\uFEFF/, ''));
  const bytes = readFileSync(path);
  if (audit.status !== 'succeeded' || createHash('sha256').update(bytes).digest('hex') !== audit.sha256) {
    throw new Error('Metadata export does not match its audit: ' + file);
  }
  const rows = bytes.toString('utf8').trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
  if (rows.length !== audit.count || rows.some(row => row.database_name !== database)) {
    throw new Error('Unexpected metadata target or count: ' + file);
  }
  const tables = new Set([...review.fields.values()].filter(field => field.system === system).map(field => field.table));
  if (system === '用友U8') tables.add('dbo.SO_SOMain');
  const verifiedTables = new Set();
  for (const row of rows) {
    const table = row.schema_name + '.' + row.object_name;
    if (!tables.has(table) || (system === '勤哲' && /^ES/i.test(row.object_name))) continue;
    const name = row.column_name;
    const id = fieldId(system, table, name);
    if (fields.has(id)) throw new Error('Duplicate physical field: ' + table + '.' + name);
    verifiedTables.add(table);
    fields.set(id, { system, table, name, identity: row.is_identity === 'True',
      computed: row.is_computed === 'True', primaryKeyOrdinal: Number(row.primary_key_ordinal) });
  }
  if (verifiedTables.size !== tables.size) {
    throw new Error('A review table is missing from metadata: ' + system);
  }
  audits.push({ system, database, file, finishedAt: audit.finishedAt, sha256: audit.sha256 });
}
if ([...review.fields.keys()].some(id => !fields.has(id))) throw new Error('An existing review field is missing from metadata');

const catalog = { format: 'review-field-metadata-v1', reviewCatalogDigest: review.digest, sources: audits, fields: [...fields.values()] };
writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ fieldCount: fields.size, existingFieldCount: review.fields.size }));
