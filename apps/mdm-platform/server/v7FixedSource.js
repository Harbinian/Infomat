// Fixed-source IO adapter. Each repository owns its capability provider and
// injected readers. Construction does not read schemas, run SQL or create pools.
const {failure, id} = require('./dataMapDefinitionValues');
const values = require('./fixedSourceValues');
function createFixedSource({env, readCapabilities, readDepartments, project, assertReference, readPreview, readPublished, decodePublished} = {}) {
  const configured = env === undefined ? null : values.referenceCapabilities(env);
  // Preserve the default runtime kill switch. Explicit environments are detached
  // instance configuration; callers may inject a live provider when needed.
  const capabilityProvider = readCapabilities || (configured ? () => configured : () => values.referenceCapabilities(process.env));
  const departments = readDepartments || (async db => (await db.execute("SELECT id,code,name FROM departments WHERE status='active' FOR SHARE"))[0]);
  const projection = project || ((...args) => require('./processPreviewReview').validateAndProjectProcess(...args));
  const guard = assertReference || ((...args) => require('./analysisDependencyReadiness').assertFixedReference(...args));
  const preview = readPreview || ((...args) => require('./processPreviewReviewRepository').readFixedPreviewRevision(...args));
  const published = readPublished || ((...args) => require('./processDataGovernanceRepository').readFixedPublishedVersion(...args));
  const decode = decodePublished || (row => require('./processDataGovernanceRepository').versionDocument(row));
  async function validation(db, document, options = {}) {
    return values.validateDocument(document, await departments(db), options, projection);
  }
  async function readReference(db, kind, refs, who, scope) {
    const capabilities = capabilityProvider();
    const referenceEnv = Object.freeze({PROCESS_V7_PREVIEW_ENABLED: capabilities.preview ? '1' : '0', PROCESS_V7_FORMAL_ENABLED: capabilities.formal ? '1' : '0'});
    values.assertReferenceEnabled(kind, capabilities);
    await guard(db, kind, referenceEnv);
    const row = kind === 'preview_revision' ? await preview(db, id(refs.case_id), id(refs.revision_id)) : await published(db, id(refs.process_version_id), true);
    if (!row) throw failure('DEFINITION_V7_SOURCE_NOT_FOUND', 404);
    scope(who, values.referenceScope(kind, row));
    return values.projectReference(kind, row, decode);
  }
  return Object.freeze({ALGORITHM: values.ALGORITHM, MAX_BYTES: values.MAX_BYTES, parseUpload: values.parseUpload, contentHash: values.contentHash, validation, readReference});
}
// Historical direct callers retain operation-time environment lookup. Current
// definition consumers receive one explicit instance from their composition root.
module.exports = {
  ALGORITHM: values.ALGORITHM, MAX_BYTES: values.MAX_BYTES, parseUpload: values.parseUpload, contentHash: values.contentHash, createFixedSource,
  validation: (...args) => createFixedSource().validation(...args),
  readReference: (...args) => createFixedSource().readReference(...args)
};
