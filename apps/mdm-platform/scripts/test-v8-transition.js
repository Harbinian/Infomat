// Pure native V8/legacy-version compatibility. No service, DB or source-file writes.
const test=require('node:test'),assert=require('node:assert/strict');
const rules=require('../server/v7AnalysisRules');
const {document,binding}=require('./testHelpers/v7AnalysisSamples');
const run=(d,version=rules.PREVIOUS_VERSION)=>rules.analyze({parser_version:version,rule_version:version,step:{check_ids:rules.checksForVersion(version)},inputs:[{input_key:'source',snapshot:{validation_status:'valid',schema_version:d.schema_version},document:d}]});
function native(){const d=binding();d.schema_version='process-governance-v8';d.behaviors[0].node_type='decision';d.data_objects[0].behavior_links=[{link_ref:'link_decision',behavior_ref:d.behaviors[0].behavior_ref,operation:'use',updated_field_refs:[]}];return d;}
test('native V8 decision/use succeeds; old V7 still rejects this relationship',()=>{
 const d=native(),before=JSON.stringify(d),r=run(d);assert.equal(r.status,'succeeded');assert.deepEqual(r.findings,[]);assert.equal(JSON.stringify(d),before);
 const v7=structuredClone(d);v7.schema_version='process-governance-v7';assert(run(v7).findings.some(f=>f.rule_id==='v7.local_integrity'));
});
test('native V8 refuses decision create and non-action control node data operations',()=>{
 for(const [type,operation] of [['decision','create'],['parallel_split','use'],['parallel_join','use']]){const d=native();d.behaviors[0].node_type=type;d.data_objects[0].behavior_links[0].operation=operation;const r=run(d);assert.equal(r.status,'partial');assert(r.findings.some(f=>f.rule_id==='v7.local_integrity'));assert(r.findings.every(f=>!f.message.includes('共享V7')));}
});
test('old rule versions refuse V8 and keep V7 outcomes byte-identical',()=>{
 for(const version of [rules.LEGACY_VERSION,rules.V2_VERSION]){const r=run(native(),version);assert.equal(r.status,'failed');assert.equal(r.error_code,'SOURCE_FORMAT_UNSUPPORTED');assert.deepEqual(r.findings,[]);assert.deepEqual(run(document(),version),run(document()));}
});
test('V8 metadata drift, duplicate and missing field binding are explicit and preserve input',()=>{
 let d=native();d.data_objects[0].fields.push({...d.data_objects[0].fields[0]});assert(run(d).findings.some(f=>f.rule_id==='v7.duplicate'));
 d=native();d.forms[0].areas[0].items[0].data_field_ref='missing_field';assert(run(d).findings.some(f=>f.rule_id==='v7.field_binding'));
 const task={step:{check_ids:rules.CHECKS},inputs:[{input_key:'source',snapshot:{schema_version:'process-governance-v7'},document:native()}]};assert.equal(rules.analyze(task).error_code,'SOURCE_FORMAT_METADATA_MISMATCH');
});
test('formal V8 and V7 documents verify exact format and digest without converting bodies',()=>{
 const {versionDocument}=require('../server/processDataGovernanceRepository'),{digest}=require('../server/processDataGovernance');
 for(const d of [native(),document()]){const row={schema_version:d.schema_version,process_content_json:JSON.stringify(d),content_hash:digest(d)};assert.deepEqual(versionDocument(row),d);assert.throws(()=>versionDocument({...row,schema_version:d.schema_version==='process-governance-v8'?'process-governance-v7':'process-governance-v8'}),e=>e.code==='PROCESS_DATA_GOVERNANCE_SOURCE_VERSION_UNSUPPORTED');assert.throws(()=>versionDocument({...row,content_hash:'0'.repeat(64)}),e=>e.code==='PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED');}
});
test('current capabilities advertise V9 primary while V8 admission stays native and historical rules remain fenced',()=>{
 const f=require('../server/processDataGovernanceScope').featureStatus({});assert.equal(f.primary_schema_version,'process-governance-v9');assert.deepEqual(f.supported_schema_versions,['process-governance-v9','process-governance-v8','process-governance-v7']);
 const input={input_key:'source',document:native()};const manifest={steps:[{parser_key:rules.PARSER,input_keys:['source']}],parser_versions:{[rules.PARSER]:rules.VERSION}};rules.assertSourceFormats(manifest,[input]);rules.assertSourceFormats({...manifest,parser_versions:{[rules.PARSER]:rules.PREVIOUS_VERSION}},[input]);for(const v of [rules.LEGACY_VERSION,rules.V2_VERSION])assert.throws(()=>rules.assertSourceFormats({...manifest,parser_versions:{[rules.PARSER]:v}},[input]),e=>e.code==='DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED');
});
test('preview canonical and historical module paths share one implementation and preserve native bodies',()=>{
 const current=require('../server/processPreviewReview'),legacy=require('../server/processV7PreviewReview');
 assert.equal(current,legacy);assert.equal(legacy.validateAndProjectV7,current.validateAndProjectProcess);
 const repo=require('../server/processPreviewReviewRepository'),oldRepo=require('../server/processV7PreviewReviewRepository');
 assert.equal(repo,oldRepo);assert.equal(oldRepo.makeProcessV7PreviewReviewRepository,repo.makeProcessPreviewReviewRepository);
 for(const d of [native(),document()]){const before=JSON.stringify(d);const r=current.validateAndProjectProcess(d,[{id:1,name:'合成甲部'}]);assert.deepEqual(r.errors,[]);assert.equal(r.document.schema_version,d.schema_version);assert.equal(JSON.stringify(d),before);assert.equal(current.contentHash(d),legacy.contentHash(d));}
 const invalid=native();invalid.data_objects[0].behavior_links[0].operation='create';assert(current.validateAndProjectProcess(invalid,[{id:1,name:'合成甲部'}]).errors.length);
 const r=current.validateAndProjectProcess(null,[]);assert(!r.errors[0].message.includes('V7'));
});
test('canonical preview route keeps the old router and injection hooks',()=>{
 const current=require('../server/routes/processPreviewReview'),legacy=require('../server/routes/processV7PreviewReview');
 assert.equal(current,legacy);assert.equal(current.setProcessPreviewRepositoryFactory,legacy.setProcessV7PreviewRepositoryFactory);assert.equal(current.resetProcessPreviewRepositoryFactory,legacy.resetProcessV7PreviewRepositoryFactory);assert.equal(current.listProcessWorkbenchItems,legacy.listV7WorkbenchItems);
});
