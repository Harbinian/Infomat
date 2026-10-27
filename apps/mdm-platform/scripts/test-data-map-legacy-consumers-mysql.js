// Synthetic fixed-consumer compatibility in a new owned tmpfs MySQL only.
// Input: canonical application DDL and supported native fixtures. Output: artifacts.
// No environment file, formal target, deployment, activation or original-row migration.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {digest,json}=require('../server/dataMapDefinitionValues');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-05/legacy-consumers-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[],save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const request=value=>({request_id:crypto.randomUUID(),...value});let owned,passed=false,failure;
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){const envKeys=['PROCESS_V7_FORMAL_ENABLED','PROCESS_V7_PREVIEW_ENABLED','DATA_MAP_HANDOFF_ENABLED','PROCESS_DATA_GOVERNANCE_READ_ONLY'],prior=Object.fromEntries(envKeys.map(key=>[key,process.env[key]]));process.env.PROCESS_V7_FORMAL_ENABLED='1';process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.DATA_MAP_HANDOFF_ENABLED='1';process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='0';
try{await withFreshMysql(async target=>{
  const {pool}=target;owned={owner:target.owner,database:target.database,port:target.port,containerId:target.containerId,storage:'tmpfs',address:'127.0.0.1'};save('owned-target.json',owned);
  const fixture=await seed(target),lead=fixture.session(11);
  for(const sql of require('../server/mysqlSchema').splitSqlStatements(require('../server/mysqlSchema').mdmMysqlSchemaSql()))await pool.execute(sql);
  for(const module of ['v7MappingSchema','designHandoffSchema','analysisRunSchema','analysisIssueSchema']){const schema=require('../server/'+module);for(const sql of schema.statements())await pool.execute(sql);await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[schema.MIGRATION_KEY]);}
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[require('../server/processV7FormalMigration').MIGRATION_KEY]);
  const traces=[];let activeTrace=null;
  const traced={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(connection,key){if(['execute','query'].includes(key))return async(sql,args)=>{if(activeTrace)activeTrace.push({connection_id:connection.threadId,sql});return connection[key](sql,args);};return typeof connection[key]==='function'?connection[key].bind(connection):connection[key];}});}};
  const repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}}),consumer=makeDataMapDefinitionRepository(traced);
  const query=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  const sourceDocument=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-v8.json')));
  sourceDocument.process.process_ref='syn_881';sourceDocument.process.process_name='Synthetic fixed source';sourceDocument.process.owning_department='Synthetic A';
  sourceDocument.behaviors=[{behavior_ref:'behavior_prepare',node_type:'action',behavior_name:'Synthetic prepare',behavior_description:'Synthetic fixed action',current_actor_role:'Synthetic A',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'Synthetic trigger',precondition:'',input_description:'Synthetic input',timing:null,completion_standard:'Synthetic complete',output_description:'Synthetic output',countersign_all_required:false,countersign_target_departments:[]}];
  sourceDocument.data_objects=[{data_ref:'data_a',data_name:'Synthetic object',description:'Synthetic object meaning',information_type:'business_conclusion',fields:[],behavior_links:[],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
  await fixture.packageSeed(881);
  await pool.execute('UPDATE process_design_versions SET process_content_json=?,content_hash=? WHERE id=881',[json(sourceDocument),digest(sourceDocument)]);
  await pool.execute('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=881',[digest(sourceDocument)]);
  const intake=await repo.prepareIntake('881',request({expected_revision:0}),lead),review=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'Synthetic existing facts rechecked',detail_evidence:intake.required_detail_evidence.map(x=>({...x,basis:'Synthetic fixed fact',evidence_refs:['synthetic:fact']}))}),lead);
  let draft=await repo.fromWorkPackage('881',request({expected_revision:0,binding_id:review.binding_id,draft:draftBody()}),lead);
  draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);
  const evaluated=await repo.get(draft.handoff_id,lead);assert.equal(evaluated.report.ready_for_approval,true,JSON.stringify(evaluated.report.gates));
  const approval=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'Synthetic local publication',binding_digest:evaluated.report.binding_digest}),lead),publication=await repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),lead);
  const object=publication.items.find(x=>x.target_kind==='object'),context=publication.items.find(x=>x.target_kind==='context');
  await check('exact handoff source-kind extension is accepted by fixed-consumer readiness only with its migration marker',async()=>{
    assert.equal((await require('../server/analysisDependencyReadiness').inspectSourceStorage(pool)).ready,true);
    const db=await pool.getConnection();try{await db.beginTransaction();await db.execute('DELETE FROM schema_migrations WHERE migration_key=?',[require('../server/dataMapHandoffSchema').MIGRATION_KEY]);assert.equal((await require('../server/analysisDependencyReadiness').inspectSourceStorage(db)).ready,false);await db.rollback();}finally{db.release();}
  });
  await check('unrecognized fixed-consumer schema drift remains unavailable and canonical restoration recovers readiness',async()=>{
    await pool.execute('ALTER TABLE data_map_definition_versions ADD COLUMN synthetic_unknown INT NULL');
    try{assert.equal((await require('../server/analysisDependencyReadiness').inspectSourceStorage(pool)).ready,false);}finally{await pool.execute('ALTER TABLE data_map_definition_versions DROP COLUMN synthetic_unknown');}
    assert.equal((await require('../server/analysisDependencyReadiness').inspectSourceStorage(pool)).ready,true);
  });
  let source,mapping,handoff,run,fixed,findingDecision;const dependentRuns=[];
  const mappingBody=()=>request({source_digest:digest(sourceDocument),local_object_ref:'data_a',local_field_ref:null,object_version_id:object.target_version_ref,field_version_id:null,expected_revision:0,status:'candidate',basis:'Synthetic explicitly bound fixed version'});
  const analysisBody=(kind='v7_source',ref=source.source_id)=>request({inputs:[{input_key:'source',kind,ref_id:ref}],check_scope:{description:'Synthetic fixed compatibility',check_ids:['fixed']},parser_versions:{fixture:'synthetic-v1'},rule_version:'synthetic-v1',steps:[{step_key:'fixed',input_keys:['source'],check_ids:['fixed'],parser_key:'fixture'}]});
  await check('real fixed-source mapping, design handoff and analysis bind exact approved version without changing effective heads',async()=>{
    const heads=await query('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id');
    source=await consumer.registerV7Source(lead,request({source_kind:'published_version',process_version_id:'881'}));assert.equal(source.validation_status,'valid');
    activeTrace=[];mapping=await consumer.saveV7Mapping(lead,source.source_id,mappingBody());traces.push({operation:'fixed_mapping',statements:activeTrace});activeTrace=null;
    const definition={title:'Synthetic fixed handoff',claim_status:'material_declared',source:{mapping_version_id:mapping.mapping_version_id,behavior_ref:'behavior_prepare',operations:['deliver']},target:null,identifier_kind:'unknown',identity_rule:null,identity_basis:null,delivery_condition:'Synthetic delivery',reception_requirement:null,evidence:[{side:'source',locator:'Synthetic fixed locator',note:'Synthetic fixed evidence'}],pairs:[]};
    activeTrace=[];handoff=await consumer.saveDesignHandoff(lead,request({handoff_id:null,expected_revision:0,definition}));traces.push({operation:'design_handoff',statements:activeTrace});activeTrace=null;
    activeTrace=[];run=await consumer.createAnalysisRun(lead,analysisBody());traces.push({operation:'analysis_input',statements:activeTrace});activeTrace=null;
    for(const [kind,ref]of [['definition',object.target_version_ref],['mapping',mapping.mapping_version_id],['handoff',handoff.handoff_version_id]]){const created=await consumer.createAnalysisRun(lead,analysisBody(kind,ref));dependentRuns.push({kind,created,original:await consumer.getAnalysisRun(lead,created.run_id)});}
    const attempt=await consumer.beginAnalysisAttempt(lead,request({run_id:run.run_id,expected_revision:run.revision_no,step_key:'fixed'}));
    const completed=await consumer.completeAnalysisAttempt(lead,request({run_id:run.run_id,attempt_id:attempt.attempt_id,expected_revision:attempt.revision_no,status:'succeeded',checked_ids:['fixed'],error_code:null,evidence:[{evidence_key:'root',input_key:'source',locator_kind:'json_pointer',locator:'',note:'Synthetic evidence'}],findings:[{rule_id:'fixed',finding_type:'observation',message:'Synthetic source finding',subject_input_keys:['source'],semantic_locator:'process:syn_881',evidence_keys:['root']}]}));
    await consumer.finishAnalysisRun(lead,request({run_id:run.run_id,expected_revision:completed.revision_no,status:'succeeded'}));
    fixed={mapping:(await consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id)).items[0],handoff:await consumer.getDesignHandoff(lead,handoff.handoff_id),run:await consumer.getAnalysisRun(lead,run.run_id)};
    findingDecision=request({run_id:run.run_id,finding_id:fixed.run.attempts[0].findings[0].finding_id,expected_revision:1,action:'confirm',reason:'Synthetic explicit evidence decision',owner_department_id:'91',owner_basis:'Synthetic explicit scope',evidence_ids:[fixed.run.attempts[0].evidence[0].evidence_id]});
    assert.deepEqual(await query('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'),heads);assert.equal(fixed.mapping.governance_status,'mapping_evidence_only');assert.equal(fixed.handoff.governance_status,'design_evidence_only');save('fixed-consumers-before.json',fixed);
  });
  await check('new fixed mapping, design references and analysis inputs take the graph lock before insertion on the same transaction connection',async()=>{
    for(const trace of traces){const graph=trace.statements.findIndex(x=>/FROM data_map_governance_control WHERE control_id=1 FOR UPDATE/.test(x.sql)),insert=trace.statements.findIndex(x=>/INSERT INTO data_map_(v7_mappings|design_handoffs|analysis_runs)/.test(x.sql));assert(graph>=0&&insert>graph,trace.operation);assert.equal(new Set(trace.statements.map(x=>x.connection_id)).size,1);if(trace.operation!=='analysis_input')assert(trace.statements.some(x=>/SET graph_revision=graph_revision\+1/.test(x.sql)));}save('reference-transaction-traces.json',traces);
  });
  await check('mutable physical labels never hydrate or rewrite fixed mapping, design and analysis bodies',async()=>{
    await pool.execute('UPDATE data_map_objects SET object_name_cn=? WHERE id=?',['Synthetic physical drift',object.target_id]);
    const mapped=(await consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id)).items[0],designed=await consumer.getDesignHandoff(lead,handoff.handoff_id),analyzed=await consumer.getAnalysisRun(lead,run.run_id);
    assert.equal(mapped.object_name,fixed.mapping.object_name);assert.equal(mapped.snapshot_digest,fixed.mapping.snapshot_digest);assert.equal(designed.snapshot_digest,fixed.handoff.snapshot_digest);assert.equal(designed.source.object_name,fixed.handoff.source.object_name);assert.deepEqual(analyzed.manifest,fixed.run.manifest);
  });
  await fixture.packageSeed(882,{documentId:881});
  await check('source upgrade keeps fixed history readable, reports superseded status and rejects new reference to old source',async()=>{
    const s=await consumer.getV7Source(lead,source.source_id),m=(await consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id)).items[0],h=await consumer.getDesignHandoff(lead,handoff.handoff_id),r=await consumer.getAnalysisRun(lead,run.run_id);
    assert.equal(s.current_source_status,'superseded');assert.equal(s.new_reference_allowed,false);assert.equal(m.current_source_status,'superseded');assert.equal(m.snapshot_digest,fixed.mapping.snapshot_digest);assert.equal(h.snapshot_digest,fixed.handoff.snapshot_digest);assert.deepEqual(r.manifest,fixed.run.manifest);assert.equal(r.input_reference_states[0].new_reference_allowed,false);
    await assert.rejects(consumer.createAnalysisRun(lead,analysisBody()),{code:'HANDOFF_SCOPE_STALE'});await assert.rejects(consumer.saveV7Mapping(lead,source.source_id,mappingBody()),{code:'HANDOFF_SCOPE_STALE'});save('source-upgraded-consumers.json',{source:s,mapping:m,handoff:h,analysis:r});
  });
  await check('current contexts expose source-upgrade pending, fixed old and actual current source IDs without current fields',async()=>{
    const data=require('../server/dataMapMysqlRepository').makeDataMapMysqlRepository(pool),listed=await data.listContexts({view:'current'}),value=await data.getContext(context.target_id,{view:'current'});
    assert(listed.some(x=>x.id===context.target_id&&x.availability==='source_upgrade_pending'));assert.equal(value.current,null);assert.equal(value.process_version_id,'881');assert.equal(value.current_process_version_id,'882');assert.equal(value.new_reference_allowed,false);assert(value.last_published_definition);
    const fields=await require('../server/dataMapEffectiveReader').contextFields(pool,{contextId:context.target_id,view:'current'});assert.deepEqual(fields.items,[]);save('pending-context.json',{listed,value,fields});
  });
  await check('source-upgraded analysis findings stay readable while explicit issue decisions reject the stale source and write no review',async()=>{
    const prior=await query('SELECT * FROM data_map_analysis_finding_reviews');await assert.rejects(consumer.decideAnalysisFinding(lead,findingDecision),{code:'DEFINITION_ANALYSIS_ISSUE_SOURCE_SUPERSEDED'});assert.deepEqual(await query('SELECT * FROM data_map_analysis_finding_reviews'),prior);const value=await consumer.getFindingReview(lead,run.run_id,findingDecision.finding_id);assert.equal(value.state.decision,'pending_verification');assert.equal(value.can_confirm,false);assert.equal(value.input_reference_states[0].new_reference_allowed,false);
  });
  await check('formal flag shutdown preserves exact stored source/design/analysis history, no current-value fallback or new writes',async()=>{
    process.env.PROCESS_V7_FORMAL_ENABLED='0';
    try{const listed=await consumer.listV7Sources(lead),s=await consumer.getV7Source(lead,source.source_id),h=await consumer.getDesignHandoff(lead,handoff.handoff_id),r=await consumer.getAnalysisRun(lead,run.run_id);assert(listed.items.some(x=>x.source_id===source.source_id&&x.new_reference_allowed===false));assert.equal(listed.partial,true);assert.equal(s.current_source_issue,'DEFINITION_V7_FORMAL_DISABLED');assert.equal(s.new_reference_allowed,false);assert.equal(h.snapshot_digest,fixed.handoff.snapshot_digest);assert.deepEqual(r.manifest,fixed.run.manifest);assert.equal(r.input_reference_states[0].new_reference_allowed,false);await assert.rejects(consumer.createAnalysisRun(lead,analysisBody()),{code:'DEFINITION_V7_SOURCE_CHANGED'});save('disabled-fixed-consumers.json',{listed,source:s,handoff:h,analysis:r});}finally{process.env.PROCESS_V7_FORMAL_ENABLED='1';}
  });
  await pool.execute('UPDATE process_design_documents SET current_version_id=881 WHERE id=881');
  await check('actual withdrawal leaves fixed evidence intact and marks new mapping, handoff and analysis targets unavailable',async()=>{
    const db=await pool.getConnection();try{await db.beginTransaction();await require('../server/dataMapHandoffControl').lockGraph(db);const lifecycle=require('../server/dataMapPublicationLifecycle'),actor=await require('../server/dataMapHandoffAuthority').handoffActor(db,lead,'withdraw',{packageId:'881',writeFields:[]}),report=await lifecycle.withdrawalReport(db,publication.publication_id,{reason:'Synthetic owned withdrawal'}),approval=await lifecycle.approveWithdrawal(db,{report,actor,requestId:crypto.randomUUID(),basis:'Synthetic full impact reviewed'});await lifecycle.withdrawPublication(db,{report,approval,actor,requestId:crypto.randomUUID(),reason:'Synthetic owned withdrawal'});await db.commit();}catch(error){await db.rollback();throw error;}finally{db.release();}
    const m=(await consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id)).items[0],h=await consumer.getDesignHandoff(lead,handoff.handoff_id);assert.equal(m.snapshot_digest,fixed.mapping.snapshot_digest);assert.equal(m.target_reference_states[0].eligibility_status,'withdrawn');assert.equal(m.new_reference_allowed,false);assert.equal(h.snapshot_digest,fixed.handoff.snapshot_digest);assert.equal(h.fixed_reference_states[0].target_reference_states[0].new_reference_allowed,false);
    await assert.rejects(consumer.createAnalysisRun(lead,analysisBody('definition',object.target_version_ref)),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});await assert.rejects(consumer.saveV7Mapping(lead,source.source_id,mappingBody()),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});save('withdrawn-fixed-consumers.json',{mapping:m,handoff:h});
  });
  await check('fixed analysis definition and mapping inputs retain stored manifests with current reference status after withdrawal',async()=>{
    // The source-only run remains source evidence; it does not inherit a target it never bound.
    const value=await consumer.getAnalysisRun(lead,run.run_id);assert.deepEqual(value.manifest,fixed.run.manifest);assert.equal(value.input_reference_states[0].new_reference_allowed,true);
    for(const dependent of dependentRuns){const current=await consumer.getAnalysisRun(lead,dependent.created.run_id);assert.deepEqual(current.manifest,dependent.original.manifest);assert.equal(current.input_reference_states[0].new_reference_allowed,false);assert.equal(current.input_reference_states[0].issue,'HANDOFF_REFERENCE_UNAVAILABLE');}save('withdrawn-analysis-statuses.json',await Promise.all(dependentRuns.map(x=>consumer.getAnalysisRun(lead,x.created.run_id))));
  });
  await check('legacy inventory includes original mapping workflows and spreadsheet publications without approval, bindings or reconstructed history',async()=>{
    const migration=require('../server/dataMapHandoffMigration'),before=await query('SELECT COUNT(*) n FROM data_map_handoff_approvals'),value=await migration.inspectCompatibility(pool,{owner:target.owner,database:target.database});
    for(const table of ['mdm_mapping_records','mdm_mapping_approval_history','mdm_publications'])assert(value.manifest.tables.some(x=>x.table===table&&x.installed));assert.equal(value.manifest.approval_generated,false);assert.equal(value.manifest.history_reconstructed,false);assert.deepEqual(await query('SELECT COUNT(*) n FROM data_map_handoff_approvals'),before);save('compatibility-inventory.json',value);
  });
  await check('stored snapshot or source digest corruption fails closed without fallback to current physical projection',async()=>{
    await pool.execute('UPDATE data_map_v7_sources SET content_digest=? WHERE source_id=?',['0'.repeat(64),source.source_id]);try{await assert.rejects(consumer.getV7Source(lead,source.source_id),{code:'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT'});await assert.rejects(consumer.getAnalysisRun(lead,run.run_id),{code:'DEFINITION_V7_SOURCE_INTEGRITY_CONFLICT'});}finally{await pool.execute('UPDATE data_map_v7_sources SET content_digest=? WHERE source_id=?',[digest(sourceDocument),source.source_id]);}
    const old=(await query('SELECT snapshot_digest FROM data_map_v7_mapping_versions WHERE mapping_version_id=?',[mapping.mapping_version_id]))[0].snapshot_digest;await pool.execute('UPDATE data_map_v7_mapping_versions SET snapshot_digest=? WHERE mapping_version_id=?',['0'.repeat(64),mapping.mapping_version_id]);try{await assert.rejects(consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id),{code:'DEFINITION_V7_MAPPING_INTEGRITY_CONFLICT'});}finally{await pool.execute('UPDATE data_map_v7_mapping_versions SET snapshot_digest=? WHERE mapping_version_id=?',[old,mapping.mapping_version_id]);}
  });
  await check('prepared control preserves fixed history and reports unavailable new-reference states',async()=>{
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
    try{const m=(await consumer.getV7MappingHistory(lead,source.source_id,mapping.mapping_id)).items[0];assert.equal(m.snapshot_digest,fixed.mapping.snapshot_digest);assert.equal(m.target_reference_states[0].eligibility_status,'maintenance');assert.equal(m.new_reference_allowed,false);await assert.rejects(consumer.saveV7Mapping(lead,source.source_id,mappingBody()),{code:'HANDOFF_MAINTENANCE'});}finally{await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1");}
  });
}, {stage:'87',randomDatabase:true});passed=true;}catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}finally{for(const key of envKeys)if(prior[key]===undefined)delete process.env[key];else process.env[key]=prior[key];save('results.json',{passed,checks,target:owned,owned_container_removed:true,formal_database_connected:false,business_accepted:false,...(failure?{failure}:{})});}return {passed,checks};}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
module.exports={main};
