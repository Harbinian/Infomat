// Deterministic fixed-source computations. No environment, database, filesystem,
// clock or mutable validation singleton is owned by this module.
const crypto = require('node:crypto');
const {supports} = require('./processNativeFormats');
const ALGORITHM = 'sha256-v7-stable-json-v1';
const MAX_BYTES = 4 * 1024 * 1024;
const failure = (code, statusCode = 400) => Object.assign(new Error(code), {code, statusCode});
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = stable(value[key]);
    return result;
  }, {});
}
// Preserve the existing stored algorithm and stable JSON bytes for V8 and V7.
const contentHash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value)), 'utf8').digest('hex');
function parseUpload(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw failure('DEFINITION_V7_UPLOAD_LIMIT', 413);
  const raw_sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  let document;
  try { document = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); }
  catch { return {document: null, raw_sha256, byte_length: bytes.length, parse_failed: true}; }
  const pending = [[document, 0]];
  let count = 0;
  while (pending.length) {
    const [value, depth] = pending.pop();
    if (++count > 100000 || depth > 64) throw failure('DEFINITION_V7_UPLOAD_LIMIT', 413);
    if (value && typeof value === 'object') for (const item of Object.values(value)) pending.push([item, depth + 1]);
  }
  return {document, raw_sha256, byte_length: bytes.length};
}
function normalizeValidation(value) {
  return structuredClone({errors: value.errors || [], blocking_issues: value.blockingIssues || [], warnings: value.warnings || []});
}
function validateDocument(document, departments, options, project) {
  // Some schema validators reuse their error arrays. Give the caller its own
  // result and protect the original inputs even if an injected validator mutates.
  return normalizeValidation(project(structuredClone(document), structuredClone(departments), structuredClone(options || {})));
}
function referenceCapabilities(env) {
  return Object.freeze({preview: env.PROCESS_V7_PREVIEW_ENABLED === '1', formal: env.PROCESS_V7_FORMAL_ENABLED === '1'});
}
function assertReferenceEnabled(kind, capabilities) {
  if (kind === 'preview_revision') {
    if (!capabilities.preview) throw failure('DEFINITION_V7_PREVIEW_DISABLED', 503);
  } else if (kind === 'published_version') {
    if (!capabilities.formal) throw failure('DEFINITION_V7_FORMAL_DISABLED', 503);
  } else throw failure('DEFINITION_V7_SOURCE_KIND_INVALID');
}
const referenceScope = (kind, row) => kind === 'published_version' ? String(row.department_id) : row.scope_department_id;
function projectReference(kind, row, decodePublished) {
  if (kind === 'published_version' && (!['published', 'superseded'].includes(row.status) || !supports(row.schema_version))) throw failure('DEFINITION_V7_NOT_PUBLISHED', 409);
  let document;
  try { document = kind === 'published_version' ? decodePublished(structuredClone(row)) : typeof row.content_json === 'string' ? JSON.parse(row.content_json) : row.content_json; }
  catch (error) { throw failure(error.code === 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED' ? 'DEFINITION_V7_SOURCE_CHANGED' : 'DEFINITION_V7_SOURCE_INVALID', 409); }
  const hash = contentHash(document);
  if (!row.content_hash || hash !== row.content_hash) throw failure('DEFINITION_V7_SOURCE_CHANGED', 409);
  return {document: structuredClone(document), content_digest: hash, scope_department_id: referenceScope(kind, row), options: row.owning_department_name ? {owningDepartmentName: row.owning_department_name} : {}};
}
function sourceRefs(row) {
  return row.source_kind === 'uploaded_material' ? {batch_id: row.source_id, material_version: 1} : row.source_kind === 'preview_revision' ? {case_id: row.case_id, revision_id: row.revision_id} : {process_version_id: row.process_version_id};
}
function sourceNodes(document) {
  return (document?.data_objects || []).map(object => ({local_object_ref: object.data_ref, name: object.data_name, fields: (object.fields || []).map(field => ({local_field_ref: field.field_ref, name: field.field_name}))}));
}
module.exports = Object.freeze({ALGORITHM, MAX_BYTES, contentHash, parseUpload, normalizeValidation, validateDocument, referenceCapabilities, assertReferenceEnabled, referenceScope, projectReference, sourceRefs, sourceNodes});
