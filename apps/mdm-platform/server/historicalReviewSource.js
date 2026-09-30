// Read-only adapter for the explicitly selected 63805 snapshot. Never runs its builders.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { digest, json } = require('./dataMapDefinitionValues');
const VERSION = 'historical-review-v1';
const FILES = ['README.md', 'review-data.json', 'data-continuity.json', 'department-review.json',
  'source-verification.json', 'materials-source-manifest.json', 'materials-review.json',
  'materials-workbook-manifest.json', 'materials-workbook-extract.json'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const fail = code => Object.assign(new Error('HISTORY_' + code), { code: 'HISTORY_' + code });
function pointer(doc, locator) {
  if (locator === '') return { found: true, value: doc };
  if (typeof locator !== 'string' || !locator.startsWith('/') || /~(?:[^01]|$)/.test(locator)) return { found: false };
  let value = doc;
  for (const key of locator.slice(1).split('/').map(k => k.replace(/~1/g, '/').replace(/~0/g, '~'))) {
    if (!value || typeof value !== 'object' || !Object.hasOwn(value, key)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}
function loadSnapshot(directory) {
  const root = fs.realpathSync(directory), sources = [], missing = [], data = {};
  for (const name of FILES) {
    try {
      const full = fs.realpathSync(path.join(root, name));
      if (path.dirname(full) !== root) throw fail('SOURCE_ESCAPE');
      const bytes = fs.readFileSync(full);
      sources.push({ name, sha256: hash(bytes), bytes: bytes.length });
      if (name.endsWith('.json')) data[name] = JSON.parse(bytes.toString('utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      missing.push({ source: name, reason: 'file_missing' });
    }
  }
  const review = data['review-data.json'], continuity = data['data-continuity.json'];
  if (!review || !continuity) throw fail('CORE_SNAPSHOT_MISSING');
  const unique = (items, key) => {
    const result = new Map();
    for (const item of items) {
      if (!item || typeof item[key] !== 'string' || !item[key] || result.has(item[key])) throw fail('DUPLICATE_OR_INVALID_ID');
      result.set(item[key], item);
    }
    return result;
  };
  const records = unique([...review.records, ...continuity.addedRecords], 'id');
  const assignments = unique(data['department-review.json']?.assignments || [], 'issueId');
  const opinions = [...review.issues.map(x => ({ dataset: 'structure', raw: x })), ...continuity.findings.map(x => ({ dataset: 'data', raw: x }))];
  unique(opinions.map(x => x.raw), 'id');
  // Only source manifests are allowed to assert an original-byte checksum.
  const manifest = [...(data['source-verification.json']?.files || []), ...(data['materials-source-manifest.json'] || [])];
  const manifestById = unique(manifest, 'id');
  const sourceRecords = [...records.values()].map(r => {
    const m = manifestById.get(r.id);
    if (!m || m.sha256 !== r.sha256 || (m.file && m.file !== r.file) || (m.relative && m.relative !== r.relative)) missing.push({ source: r.id, reason: 'manifest_missing_or_conflicting' });
    const expectedPath = path.resolve(review.sourceBase, r.relative);
    const allowed = expectedPath.startsWith(path.resolve(review.sourceBase) + path.sep) && expectedPath === path.resolve(r.file) && path.extname(r.file).toLowerCase() === '.json';
    if (!allowed) missing.push({ source: r.id, reason: 'original_path_outside_source' });
    return { id: r.id, file: r.file, relative: r.relative, original_sha256: r.sha256,
      snapshot_digest: digest(r.doc), snapshot_algorithm: 'sha256-canonical-json-v1', original_path_allowed: allowed };
  });
  const workbook = data['materials-workbook-manifest.json'], extract = data['materials-workbook-extract.json'];
  const extractMatches = !!workbook && sources.some(s => s.name === 'materials-workbook-extract.json' && s.sha256 === workbook.extractSha256);
  if (!extractMatches) missing.push({ source: 'materials-workbook-extract.json', reason: 'extract_digest_unverified' });
  const cells = new Map((extract?.sheets || []).map(s => [s.name, Object.assign({}, ...s.rows)]));
  const batchKey = digest({ namespace: VERSION, sources });
  const items = opinions.map(({ dataset, raw }) => {
    const responsibility = assignments.get(raw.id) || null;
    const gaps = [];
    if (!responsibility) gaps.push({ reason: 'responsibility_record_missing' });
    if (responsibility && responsibility.dataset !== dataset) gaps.push({ reason: 'responsibility_dataset_conflict' });
    for (const file of raw.files || []) if (!records.has(file)) gaps.push({ file, reason: 'material_missing' });
    const evidence = [...(raw.refs || []).map(ref => {
      const record = records.get(ref.file), located = record ? pointer(record.doc, ref.path) : { found: false };
      if (!located.found) gaps.push({ ...ref, reason: record ? 'pointer_missing' : 'material_missing' });
      return { ...ref, kind: 'json_pointer', status: located.found ? 'snapshot_located' : 'missing',
        source_sha256: record?.sha256 || null, snapshot_value_digest: located.found ? digest(located.value) : null };
    }), ...(raw.workbookRefs || []).map(ref => {
      const sheet = cells.get(ref.sheet);
      const checks = Object.entries(ref.cells || {}).map(([cell, value]) => {
        const actual = sheet?.[cell];
        // The source explicitly renders absent cells as this label; retain that convention separately.
        const matched = actual === value || (value === '（空）' && (actual == null || actual === ''));
        return { cell, status: extractMatches && sheet && matched ? 'snapshot_located' : 'missing_or_changed' };
      });
      if (!checks.length || checks.some(c => c.status !== 'snapshot_located')) gaps.push({ sheet: ref.sheet, range: ref.range, reason: 'workbook_evidence_unverified' });
      return { ...ref, kind: 'workbook_cells', source_sha256: workbook?.sourceWorkbookSha256 || null, checks };
    })];
    if (!evidence.length) gaps.push({ reason: 'no_evidence_registered' });
    return { platform_ref: 'history:' + batchKey + ':' + raw.id, original_id: raw.id, provenance: 'historical_review',
      dataset, opinion_type: raw.kind ?? null, original: raw, responsibility_suggestion: responsibility,
      owner_department_id: null, person_id: null, issue_id: null, evidence, gaps };
  });
  for (const id of assignments.keys()) if (!opinions.some(i => i.raw.id === id)) missing.push({ source: id, reason: 'orphan_responsibility' });
  const totals = { materials: records.size, opinions: items.length, structure: review.issues.length, data: continuity.findings.length,
    pending_owner: items.filter(x => !x.responsibility_suggestion?.department).length };
  const historical = { materials: 126, opinions: 169, structure: 149, data: 20, pending_owner: 43 };
  return { format: VERSION, batch_key: batchKey, sources, source_base: review.sourceBase,
    snapshot_at: { review: review.generatedAt, continuity: continuity.generatedAt },
    totals, historical_count_differences: Object.keys(totals).filter(k => totals[k] !== historical[k]).map(k => ({ field: k, historical: historical[k], actual: totals[k] })),
    missing, source_records: sourceRecords, workbook: workbook || null, items,
    formal_link_enabled: false, changes_governance: false };
}
function verifyOriginals(plan) {
  const files = plan.source_records.map(r => ({ id: r.id, file: r.file, expected_sha256: r.original_sha256, allowed: r.original_path_allowed }));
  if (plan.workbook) files.push({ id: 'workbook', file: plan.workbook.file, expected_sha256: plan.workbook.sourceWorkbookSha256,
    allowed: path.resolve(plan.workbook.file).startsWith(path.resolve(plan.source_base) + path.sep) && path.extname(plan.workbook.file).toLowerCase() === '.xlsx' });
  return files.map(r => {
    if (!r.allowed) return { ...r, status: 'path_rejected' };
    try { const actual_sha256 = hash(fs.readFileSync(r.file)); return { ...r, actual_sha256, status: actual_sha256 === r.expected_sha256 ? 'matches' : 'changed' }; }
    catch (e) { return { ...r, status: 'unavailable', error: ['ENOENT', 'EACCES', 'EPERM'].includes(e.code) ? e.code : 'READ_FAILED' }; }
  });
}
function compareSnapshots(before, after) {
  if (before.source_base !== after.source_base) throw fail('SNAPSHOT_LINEAGE_UNCONFIRMED');
  const old = new Map(before.items.map(x => [x.original_id, x]));
  const current = new Set(after.items.map(x => x.original_id));
  return { identity_basis: 'original_id_within_explicit_snapshot_lineage', implies_remediation: false, changes_governance: false,
    items: [...after.items.map(x => ({ original_id: x.original_id, before_ref: old.get(x.original_id)?.platform_ref || null, after_ref: x.platform_ref,
      status: !old.has(x.original_id) ? 'added' : json({ ...old.get(x.original_id), platform_ref: null }) === json({ ...x, platform_ref: null }) ? 'unchanged' : 'changed' })),
    ...before.items.filter(x => !current.has(x.original_id)).map(x => ({ original_id: x.original_id, before_ref: x.platform_ref, after_ref: null, status: 'not_in_snapshot_not_resolved' }))] };
}
module.exports = { VERSION, FILES, hash, fail, pointer, loadSnapshot, verifyOriginals, compareSnapshots };
