import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadCandidates } from './candidates.mjs';
import { fieldId, loadCatalog, loadFieldCatalog } from './store.mjs';

const [reviewPath, fieldPath, candidatePath, metadataDir, outputPath] = process.argv.slice(2);
if (!reviewPath || !fieldPath || !candidatePath || !metadataDir || !outputPath) {
  throw new Error('Usage: node prepare-candidate-fields.mjs <review-catalog> <field-catalog> <candidates> <metadata-directory> <output>');
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const review = loadCatalog(reviewPath);
const base = loadFieldCatalog(fieldPath, review);
const candidates = loadCandidates(candidatePath, new Set(base.fields.keys()), new Map());
const missing = new Set(candidates.targets.filter(target => target.scope === 'missing').map(target => target.id));
const fields = [];
const sources = [];
for (const [system, database, source] of [['勤哲', 'CXSYSYS', 'mes'], ['用友U8', 'UFDATA_333_2025', 'u8']]) {
  const file = source + '-candidate-columns.ndjson';
  const path = join(metadataDir, file);
  const bytes = readFileSync(path);
  const audit = JSON.parse(readFileSync(path + '.audit.json', 'utf8').replace(/^\uFEFF/, ''));
  const query = source + '-candidate-columns.sql';
  const queryHash = hash(readFileSync(join(metadataDir, 'sql', query)));
  if (audit.source !== source || audit.status !== 'succeeded' || audit.sha256 !== hash(bytes) ||
      audit.queryFile !== query || audit.querySha256 !== queryHash) throw new Error('Unverified candidate metadata: ' + file);
  const rows = bytes.toString('utf8').trimEnd().split(/\r?\n/).map(line => JSON.parse(line));
  if (rows.length !== audit.count) throw new Error('Unexpected candidate metadata count: ' + file);
  for (const row of rows) {
    const table = row.schema_name + '.' + row.object_name;
    const name = row.column_name;
    const id = fieldId(system, table, name);
    if (row.database_name !== database || row.schema_name !== 'dbo' || row.object_type.trim() !== 'U' || !missing.delete(id)) {
      throw new Error('Unexpected or duplicate candidate metadata: ' + table + '.' + name);
    }
    fields.push({ system, table, name, identity: row.is_identity === 'True', computed: row.is_computed === 'True',
      primaryKeyOrdinal: Number(row.primary_key_ordinal) });
  }
  sources.push({ system, database, file, finishedAt: audit.finishedAt, sha256: audit.sha256, querySha256: queryHash });
}
if (missing.size) throw new Error('Candidate metadata is incomplete');

const catalog = { format: 'review-field-metadata-addendum-v1', reviewCatalogDigest: review.digest,
  fieldCatalogDigest: base.digest, candidateSourceDigest: candidates.source.sha256, sources, fields };
writeFileSync(outputPath, JSON.stringify(catalog, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ addedFields: fields.length }));
