// Synthetic fixed-source behavior tests. Run with blockRealMysql; no database,
// server, private configuration or source writes. Uses existing public contracts.
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const values = require('../server/fixedSourceValues');
const {createFixedSource} = require('../server/v7FixedSource');
const {document} = require('./testHelpers/v7AnalysisSamples');
const enabled = {PROCESS_V7_PREVIEW_ENABLED: '1', PROCESS_V7_FORMAL_ENABLED: '1'};
const noop = () => {};
function previewRow(body = document()) {
  return {content_json: JSON.stringify(body), content_hash: values.contentHash(body), scope_department_id: '91'};
}
function previewDependencies(extra = {}) {
  return {env: enabled, assertReference: async () => {}, readPreview: async () => previewRow(), ...extra};
}
test('fixed-source load and construction do not read schemas, invoke IO adapters or start resources', () => {
  const code = `const assert=require('node:assert/strict'),Module=require('node:module');
    const original=Module._load;const blocked=['./processV7PreviewReview','./processV7PreviewReviewRepository','./processDataGovernanceRepository','./analysisDependencyReadiness'];
    Module._load=function(request,...args){if(blocked.includes(request))throw Error('EAGER_IO_ADAPTER:'+request);return original.call(this,request,...args);};
    const {createFixedSource}=require('./server/v7FixedSource');
    const fail=()=>assert.fail('CONSTRUCTOR_IO');
    createFixedSource();createFixedSource({readCapabilities:fail,readDepartments:fail,project:fail,assertReference:fail,readPreview:fail,readPublished:fail,decodePublished:fail});`;
  const run = spawnSync(process.execPath, ['-r', './scripts/testHelpers/blockRealMysql.js', '-e', code], {cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true});
  assert.equal(run.status, 0, run.stderr);
});
test('upload parsing preserves bytes, rejects invalid UTF-8 and size/depth limits, returns independent documents', () => {
  const bytes = Buffer.from('{"schema_version":"process-governance-v8","name":"合成来源"}');
  const before = Buffer.from(bytes), first = values.parseUpload(bytes), second = values.parseUpload(bytes);
  assert.deepEqual(first, second);assert.deepEqual(bytes, before);
  first.document.name = 'changed';assert.equal(second.document.name, '合成来源');
  assert.equal(values.parseUpload(Buffer.from([0xff])).parse_failed, true);
  assert.equal(values.parseUpload(Buffer.from('{broken')).parse_failed, true);
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(values.MAX_BYTES + 1), Buffer.from('['.repeat(65) + '0' + ']'.repeat(65))]) assert.throws(() => values.parseUpload(bytes), {code: 'DEFINITION_V7_UPLOAD_LIMIT', statusCode: 413});
});
test('native V8 and supported V7 keep the historical stable JSON digest exactly', () => {
  const legacy = require('../server/processV7PreviewReview').contentHash;
  for (const schema of ['process-governance-v8', 'process-governance-v7']) {
    const body = {...document(), schema_version: schema}, before = structuredClone(body);
    assert.equal(values.contentHash(body), legacy(body));
    assert.equal(values.contentHash(body), values.contentHash(Object.fromEntries(Object.entries(body).reverse())));
    assert.deepEqual(body, before);
  }
  assert.equal(values.ALGORITHM, 'sha256-v7-stable-json-v1');
  assert.equal(Reflect.set(values, 'ALGORITHM', 'changed'), false);
  assert.equal(Reflect.set(values, 'MAX_BYTES', 1), false);
});
test('validation takes detached inputs and returns detached errors from reused validator results', async () => {
  const body = document(), departments = [{id: 91, name: '合成部门'}], options = {owningDepartmentName: '合成部门'};
  const before = structuredClone({body, departments, options});
  const shared = {errors: [{code: 'SYNTHETIC'}], blockingIssues: [{code: 'PENDING'}], warnings: []};
  const fixed = createFixedSource({env: {}, readDepartments: async () => departments, project: (body, departments, options) => {
    body.schema_version = 'changed';departments[0].name = 'changed';options.owningDepartmentName = 'changed';return shared;
  }});
  const first = await fixed.validation({}, body, options), second = await fixed.validation({}, body, options);
  assert.deepEqual({body, departments, options}, before);
  first.errors[0].code = 'changed';first.blocking_issues.length = 0;
  assert.equal(second.errors[0].code, 'SYNTHETIC');assert.equal(shared.errors[0].code, 'SYNTHETIC');assert.equal(second.blocking_issues.length, 1);
});
test('default real validator preserves results and input for native V8 and V7', async () => {
  const {validateAndProjectV7} = require('../server/processV7PreviewReview');
  const departments = [{id: 91, code: 'SYNTHETIC', name: '合成部门'}], options = {};
  for (const schema of ['process-governance-v8', 'process-governance-v7']) {
    const body = {...document(), schema_version: schema}, before = structuredClone(body);
    const fixed = createFixedSource({env: {}, readDepartments: async () => departments});
    const actual = await fixed.validation({}, body, options);
    assert.deepEqual(actual, values.normalizeValidation(validateAndProjectV7(body, departments, options)));
    assert.deepEqual(body, before);
  }
});
test('two explicit source instances do not share environments, readers or returned documents', async () => {
  const envA = {...enabled}, envB = {PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0'};
  let readsA = 0, readsB = 0;
  const a = createFixedSource(previewDependencies({env: envA, readPreview: async () => {readsA++;return previewRow();}}));
  const b = createFixedSource(previewDependencies({env: envB, readPreview: async () => {readsB++;return previewRow();}}));
  envA.PROCESS_V7_PREVIEW_ENABLED = '0';envB.PROCESS_V7_PREVIEW_ENABLED = '1';
  const first = await a.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop);
  first.document.process.process_name = 'changed';
  const second = await a.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop);
  assert.notEqual(second.document.process.process_name, 'changed');
  await assert.rejects(b.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop), {code: 'DEFINITION_V7_PREVIEW_DISABLED'});
  assert.equal(readsA, 2);assert.equal(readsB, 0);
});
test('one capability read binds reference readiness and preserves live kill switches', async () => {
  let enabledNow = true, reads = 0, guards = 0;
  const fixed = createFixedSource(previewDependencies({readCapabilities: () => {reads++;return {preview: enabledNow, formal: false};}, assertReference: async (_db, _kind, env) => {
    guards++;assert.equal(env.PROCESS_V7_PREVIEW_ENABLED, '1');assert.equal(env.PROCESS_V7_FORMAL_ENABLED, '0');
  }}));
  assert.equal(reads, 0);
  await fixed.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop);
  enabledNow = false;
  await assert.rejects(fixed.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop), {code: 'DEFINITION_V7_PREVIEW_DISABLED'});
  assert.equal(reads, 2);assert.equal(guards, 1);
});
test('default reference instance observes operation-time runtime disablement without touching DB', async () => {
  const previous = process.env.PROCESS_V7_PREVIEW_ENABLED;
  let count = 0;
  try {
    process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
    const fixed = createFixedSource({assertReference: async () => {}, readPreview: async () => {count++;return previewRow();}});
    await fixed.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop);
    process.env.PROCESS_V7_PREVIEW_ENABLED = '0';
    await assert.rejects(fixed.readReference({}, 'preview_revision', {case_id: '1', revision_id: '2'}, {}, noop), {code: 'DEFINITION_V7_PREVIEW_DISABLED'});
    assert.equal(count, 1);
  } finally { if (previous === undefined) delete process.env.PROCESS_V7_PREVIEW_ENABLED;else process.env.PROCESS_V7_PREVIEW_ENABLED = previous; }
});
test('fixed published projection preserves row, status, old IDs, native formats and source error mapping', async () => {
  const decode = require('../server/processDataGovernanceRepository').versionDocument;
  for (const schema of ['process-governance-v8', 'process-governance-v7']) {
    const body = {...document(), schema_version: schema}, row = {status: 'superseded', department_id: '9007199254740993', schema_version: schema, content_json: JSON.stringify(body), content_hash: values.contentHash(body)};
    const before = structuredClone(row);
    const fixed = createFixedSource({env: enabled, assertReference: async () => {}, readPublished: async (_db, version, lock) => {assert.equal(version, '9007199254740994');assert.equal(lock, true);return row;}, decodePublished: decode});
    const result = await fixed.readReference({}, 'published_version', {process_version_id: '9007199254740994'}, {}, (_who, dept) => assert.equal(dept, '9007199254740993'));
    assert.deepEqual(result.document, body);assert.deepEqual(row, before);
    assert.throws(() => values.projectReference('published_version', {...row, status: 'reviewed'}, decode), {code: 'DEFINITION_V7_NOT_PUBLISHED'});
    assert.throws(() => values.projectReference('published_version', {...row, content_hash: '0'.repeat(64)}, decode), {code: 'DEFINITION_V7_SOURCE_CHANGED'});
    assert.throws(() => values.projectReference('published_version', {...row, content_json: '{broken'}, decode), {code: 'DEFINITION_V7_SOURCE_INVALID'});
  }
});
test('scope rejection happens before fixed body decoding and each source failure is fresh', async () => {
  let decoded = 0;
  const row = {status: 'published', department_id: '91', schema_version: 'process-governance-v8', content_json: '{broken', content_hash: 'x'};
  const fixed = createFixedSource({env: enabled, assertReference: async () => {}, readPublished: async () => row, decodePublished: () => {decoded++;throw Error('NO');}});
  await assert.rejects(fixed.readReference({}, 'published_version', {process_version_id: '1'}, {}, () => {throw Object.assign(Error('SCOPE'), {code: 'DEFINITION_ACCESS_DENIED'});}), {code: 'DEFINITION_ACCESS_DENIED'});
  assert.equal(decoded, 0);
  const disabled = createFixedSource({env: {}}), errors = [];
  for (let i = 0; i < 2; i++) try { await disabled.readReference({}, 'preview_revision', {}, {}, noop); } catch (error) { errors.push(error); }
  assert.notEqual(errors[0], errors[1]);errors[0].code = 'changed';assert.equal(errors[1].code, 'DEFINITION_V7_PREVIEW_DISABLED');
});
test('definition composition injects one fixed-source instance into consumer and context without IO', async () => {
  const {createDefinitionConsumers} = require('../server/definitionConsumers');
  const {createFixedMappingContext} = require('../server/fixedMappingContext');
  let seen, validations = 0;
  const body = document(), row = {source_id: '1', source_kind: 'uploaded_material', content_json: JSON.stringify(body), validation_json: '{"errors":[],"blocking_issues":[],"warnings":[]}', validation_status: 'valid', content_digest: values.contentHash(body), digest_algorithm: values.ALGORITHM};
  const db = {execute: async () => [[structuredClone(row)]]};
  const dependencies = {scope: noop, fixedSourceDependencies: {env: {}, readDepartments: async () => [], project: () => {validations++;return {errors: [], blockingIssues: [], warnings: []};}}};
  const operations = createDefinitionConsumers(dependencies, [helpers => {seen = helpers;return {load: () => helpers.mappingContext.loadSource(db, {readOnly: false, permissions: new Set(['governance:structure-gate'])}, '1')};}]);
  assert.equal(validations, 0);
  const source = await operations.load();assert.equal(source.can_confirm, true);assert.equal(validations, 1);
  const context = createFixedMappingContext({...dependencies, fixedSource: seen.fixedSource});
  assert.deepEqual(context.nodes(body), values.sourceNodes(body));
  const bodyBefore = structuredClone(body);values.sourceNodes(body);assert.deepEqual(body, bodyBefore);
  // The preserved standalone factory path must inject the same adapter into its
  // fallback context, instead of silently constructing a default-global adapter.
  const standalone = require('../server/v7Mappings')({
    ...dependencies, transaction: action => action({execute: async sql => sql.includes('schema_migrations') ? [[{migration_key: 'synthetic'}]] : sql.includes('data_map_v7_mapping_versions') ? [[]] : [[structuredClone(row)]]}),
    actor: async () => ({readOnly: false, permissions: new Set(['governance:structure-gate'])})
  });
  const direct = await standalone.getV7Source({}, '1');assert.equal(direct.can_confirm, true);assert.equal(validations, 2);
});
