// P25/03+09 technical preparation only. --output must name a new artifacts directory.
// Owned labelled tmpfs MySQL/UUID database, random loopback HTTP, synthetic identities.
// Uses existing APIs/repositories; no private env, business services, real AI or new identity decisions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const {digest,parse}=require('../server/dataMapDefinitionValues');
const arg=process.argv.indexOf('--output'),output=path.resolve(process.argv[arg+1]||'');
assert(arg>=0&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});
const uuid=()=>crypto.randomUUID(),checks=[],observations=[];
const save=(name,value)=>fs.writeFileSync(path.join(output,name+'.json'),JSON.stringify(value,null,2));
async function check(name,fn){await fn();checks.push(name);save('progress',{checks,observations});console.log('PASS '+name);}
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function main(){await withStage05Fixture(async({pool,fixture,expect,request,backup,restore})=>{
 const repo=makeDataMapDefinitionRepository(pool),lead={personId:82,accountId:182,authVersion:1},contact={personId:83,accountId:183,authVersion:1};
 const root='/api/data-map-definitions',get=(s,who='lead',status=200)=>expect(who,root+s,'GET',undefined,status);
 const define=b=>expect('contact',root+'/save','POST',{request_id:uuid(),...b});
 const query=async(sql,args=[])=>{const rows=(await pool.execute(sql,args))[0];return rows;};
 const tables=['data_map_objects','data_map_fields','data_map_definition_versions','data_map_definition_heads','data_map_definition_events','data_map_definition_requests','data_map_source_files','data_map_source_cells','data_map_source_mappings','data_map_fact_requests','data_map_fact_events','data_map_v7_sources','data_map_v7_mappings','data_map_v7_mapping_versions','data_map_design_handoffs','data_map_design_handoff_versions','data_map_design_handoff_refs','data_map_analysis_runs','data_map_analysis_inputs'];
 const hashes=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,digest(await query('SELECT * FROM '+t+' ORDER BY 1'))])));
 let browser,context,upload;
 try{
  await check('definition dependency absent is 503; runtime does not create definition storage',async()=>{await get('/objects','lead',503);assert.equal((await query("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_definition_versions'")).length,0);});
  let db=await pool.getConnection();try{await require('../server/dataMapDefinitionMigration').applyDefinitions(db);}finally{db.release();}
  let base,field,second,sameName,alias,foreignField,identityField,sourceBatch,groups;
  await check('synthetic template IDs and source cells resolve to distinct stable platform/version IDs',async()=>{
   const bytes=await require('./testHelpers/masterDataTemplateFixture').fixture().bytes(),actor=await repo.templateImportActor(contact);
   const prepared=await require('../server/masterDataTemplateImport').prepareImport(bytes,'synthetic-identity.xlsx',[],actor);
   const imported=await repo.importTemplate(contact,{request_id:uuid(),original_name:'synthetic-identity.xlsx',links:[],preview_digest:prepared.preview_digest,confirm:true},bytes);
   sourceBatch=await get('/source/'+imported.batch_id);base=imported.mappings.find(m=>m.record_type==='object');field=imported.mappings.find(m=>m.record_type==='field');
   second=await define({entity_type:'field',object_id:base.entity_id,object_version_id:base.version_id,definition:{name:'合成批次号',identifier_role:'仅假设组合标识的第二分量',source:{description:'合成来源，待核实'}}});
   sameName=await define({entity_type:'object',definition:{name:'合成对象',business_meaning:'同名异物假设：工具登记对象，未确认企业事实'}});
   alias=await define({entity_type:'object',definition:{name:'合成订单别称',business_meaning:'可能同物异名的假设；尚无等价关系和批准依据'}});
   foreignField=await define({entity_type:'field',object_id:alias.entity_id,object_version_id:alias.version_id,definition:{name:'合成编号'}});
   assert.notEqual(base.entity_id,sameName.entity_id);assert.notEqual(base.entity_id,alias.entity_id);
   assert.equal(sourceBatch.mappings.find(m=>m.record_type==='object').local_id,'OBJ-001');assert.equal(sourceBatch.mappings.find(m=>m.record_type==='field').local_id,'FLD-001');
   assert.equal(sourceBatch.mappings[0].platform_entity_id,base.entity_id);assert.equal(sourceBatch.raw_digest_status,'available');
   save('identity-samples',{synthetic:true,business_approved:false,base,field,second,sameName,alias,foreignField,source:sourceBatch});
  });
  await check('optional fact/P07 counts absent are unknown coverage, never reported as zero',async()=>{
   const r=await get('/impact/object/'+base.entity_id);assert(!Object.hasOwn(r.counts,'fact_requests'));assert(!Object.hasOwn(r.counts,'v7_mapping_versions'));
   save('partial-dependencies',{api:r,coverage:{fact_requests:'unknown: table not installed',v7_mapping_versions:'unknown: table not installed',handoffs:'not counted by this API',analysis:'not counted by this API'},complete:false});
  });
  db=await pool.getConnection();try{for(const [mod,method] of [['dataMapFactMigration','applyFacts'],['v7MappingMigration','applyV7Mappings'],['designHandofaNFigration','applyDesignHandoffs'],['analysisRunMigration','applyAnalysisRuns'],['analysisQueueMigration','applyAnalysisQueue']])await require('../server/'+mod)[method](db);}finally{db.release();}
  await check('single/composite fixed identifiers keep ordered components and stable IDs under array reordering',async()=>{
   groups=[{group_id:uuid(),kind:'single',field_version_ids:[field.version_id]},{group_id:uuid(),kind:'composite',field_version_ids:[field.version_id,second.version_id]}];
   const initial=await get('/version/'+base.version_id);base=await define({entity_type:'object',entity_id:base.entity_id,expected_revision:1,definition:{unique_identifiers:groups}});
   const before=await get('/version/'+base.version_id);
   base=await define({entity_type:'object',entity_id:base.entity_id,expected_revision:2,definition:{unique_identifiers:[...groups].reverse()}});
   const reordered=await get('/version/'+base.version_id);assert.equal(reordered.entity_id,initial.entity_id);assert.notEqual(before.content_digest,reordered.content_digest);
   assert.deepEqual(reordered.definition.unique_identifiers,[...groups].reverse());
   const reverse=[{...groups[1],field_version_ids:[second.version_id,field.version_id]},groups[0]];
   base=await define({entity_type:'object',entity_id:base.entity_id,expected_revision:3,definition:{unique_identifiers:reverse}});
   assert.deepEqual((await get('/version/'+base.version_id)).definition.unique_identifiers,reverse);assert.deepEqual(await get('/version/'+before.version_id),before);
   save('ordered-identifiers',{initial,before,reordered,reversed:await get('/version/'+base.version_id),note:'Arrays retain order in definition digest; entity identity remains stable. Component order is preserved, not silently normalized.'});
  });
  await check('foreign fields, duplicate stable field and mixed fixed parent versions reject without new versions',async()=>{
   const newer=await define({entity_type:'field',entity_id:second.entity_id,expected_revision:1,object_id:base.entity_id,object_version_id:base.version_id,definition:{business_meaning:'新父版本下的合成批次号'}});
   const before=(await query('SELECT COUNT(*) n FROM data_map_definition_versions'))[0].n;
   for(const refs of [[field.version_id,foreignField.version_id],[field.version_id,field.version_id],[field.version_id,newer.version_id]])await expect('contact',root+'/save','POST',{request_id:uuid(),entity_type:'object',entity_id:base.entity_id,expected_revision:4,definition:{unique_identifiers:[{group_id:uuid(),kind:'composite',field_version_ids:refs}]}},400);
   assert.equal((await query('SELECT COUNT(*) n FROM data_map_definition_versions'))[0].n,before);
   second=newer;
  });
  const factRoot='/api/data-map-facts';let fact;
  await check('directed fact response has minimal fixed context; checking never becomes formal identity decision',async()=>{
   await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 85,role_id,'department',92,'SYNTHETIC directed responder only',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
   fact=await expect('lead',factRoot,'POST',{request_id:uuid(),subject_version_id:field.version_id,object_version_id:base.version_id,focus:['source.description','name'],question:'合成字段来源是否明确？仅核对事实。',target_department_id:'92',target_person_id:'85'});
   fact=await expect('lead',factRoot+'/'+fact.fact_id+'/send','POST',{request_id:uuid(),expected_revision:1});
   const limited=await expect('reviewB',factRoot+'/'+fact.fact_id,'GET');assert.equal(limited.latest,null);assert.equal(limited.formal_governance.status,'pending');
   await get('/source/'+sourceBatch.batch_id,'reviewB',403);await get('/version/'+field.version_id,'reviewB',403);
   await expect('outsider',factRoot+'/'+fact.fact_id,'GET',undefined,404);
   fact=await expect('reviewB',factRoot+'/'+fact.fact_id+'/answer','POST',{request_id:uuid(),expected_revision:2,answer:'SYNTHETIC 仅据定向字段快照答复，非企业事实',evidence_refs:['SYNTHETIC field snapshot'],needs_more_info:false});
   fact=await expect('lead',factRoot+'/'+fact.fact_id+'/check','POST',{request_id:uuid(),expected_revision:3,reason:'SYNTHETIC 技术事实核对',evidence_refs:['SYNTHETIC recorded answer']});
   const checked=await expect('lead',factRoot+'/'+fact.fact_id,'GET');assert.equal(checked.status,'checked');assert.equal(checked.formal_governance.decision,null);
   await expect('lead',factRoot+'/'+fact.fact_id+'/recognize','POST',{request_id:uuid(),expected_revision:4},403);
   assert.equal((await get('/version/'+base.version_id)).definition.governance,null);save('fact-context',{limited,checked});
  });
  const pw=runtime();upload=await pw.request.newContext({baseURL:fixture.baseURL});
  assert.equal((await upload.post('/api/org/login',{data:{loginName:'SYNTHETIC_lead',password:fixture.loginPassword}})).status(),200);
  const csrf=(await(await upload.get('/api/csrf-token')).json()).csrfToken;
  const members=[];let handoff,run;
  await check('two explicit native V7 sources bind local refs and exact fixed object/field mappings',async()=>{
   for(const [key,dept] of [['a','91'],['b','92']]){
    const document=structuredClone(fixture.document);document.process.process_ref='process_identity_'+key;document.process.process_name='合成身份来源'+key;
    document.data_objects=[{data_ref:'data_order',data_name:'合成对象',description:'合成来源身份样本',information_type:'business_conclusion',fields:[{field_ref:'field_code',field_name:'合成编号',field_type:'文本',definition:'合成固定编号'}],behavior_links:[{link_ref:'link_create',behavior_ref:'behavior_prepare',operation:'create',updated_field_refs:[]}],source_relations:[],lifecycle:require('../../structured-output-service/public/process-governance-migration').pendingLifecycle()}];
    const bytes=Buffer.from(JSON.stringify(document)),response=await upload.post('/api/v7-mappings/uploads',{headers:{'X-CSRF-Token':csrf},multipart:{request_id:uuid(),file:{name:'synthetic-identity-'+key+'.json',mimeType:'application/json',buffer:bytes}}});
    assert.equal(response.status(),200);const source=await response.json();if(dept==='92')await pool.execute('UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?',[source.source_id]);
    const metadata=await expect('lead','/api/v7-mappings/sources/'+source.source_id,'GET');assert.equal(metadata.validation_status,'valid');
    const parentVersion=(await get('/version/'+field.version_id)).object_version_id;
    const body={request_id:uuid(),source_digest:metadata.content_digest,local_object_ref:'data_order',local_field_ref:null,object_version_id:parentVersion,field_version_id:null,expected_revision:0,status:'confirmed',basis:'SYNTHETIC 显式固定历史父对象/字段映射，不是业务等价或主数据认定'};
    const objectMap=await expect('lead','/api/v7-mappings/sources/'+source.source_id+'/mappings','POST',body);
    const fieldMap=await expect('lead','/api/v7-mappings/sources/'+source.source_id+'/mappings','POST',{...body,request_id:uuid(),local_field_ref:'field_code',field_version_id:field.version_id});
    members.push({key,department_id:dept,source:metadata,objectMap,fieldMap});
   }
   assert.notEqual(members[0].source.source_id,members[1].source.source_id);save('fixed-source-mappings',members);
  });
  await check('P08 reference graph and queued analysis retain fixed definitions/mapping/handoff versions',async()=>{
   const definition={title:'合成身份只读影响样本',claim_status:'analysis_pending',source:{mapping_version_id:members[0].objectMap.mapping_version_id,behavior_ref:'behavior_prepare',operations:['deliver']},target:{mapping_version_id:members[1].objectMap.mapping_version_id,behavior_ref:'behavior_receive',operations:['receive']},identifier_kind:'single',identity_rule:'SYNTHETIC 编号逐项对照；仅假设',identity_basis:'SYNTHETIC 非企业批准依据',delivery_condition:'待确认实际交付',reception_requirement:'待确认实际接收',evidence:[{side:'source',locator:'SYNTHETIC /data_objects/0',note:'来源a合成证据'},{side:'target',locator:'SYNTHETIC /data_objects/0',note:'来源b合成证据'}],pairs:[{source_mapping_version_id:members[0].fieldMap.mapping_version_id,target_mapping_version_id:members[1].fieldMap.mapping_version_id,identifier:true,checks:Object.fromEntries(['field','format','enum','unit','version'].map(k=>[k,{mode:'pending',rule:'',basis:'SYNTHETIC 待核实'}]))}]};
   handoff=await expect('lead','/api/design-handoffs','POST',{request_id:uuid(),handoff_id:null,expected_revision:0,definition});
   const inputs=[{input_key:'object',kind:'definition',ref_id:base.version_id},{input_key:'field',kind:'definition',ref_id:field.version_id},{input_key:'mapping',kind:'mapping',ref_id:members[0].fieldMap.mapping_version_id},{input_key:'handoff',kind:'handoff',ref_id:handoff.handoff_version_id},{input_key:'template',kind:'template',ref_id:sourceBatch.batch_id}];
   const payload={request_id:uuid(),inputs,check_scope:{description:'SYNTHETIC 仅登记固定输入消费引用，不执行规则',check_ids:['references']},parser_versions:{synthetic_reader:'synthetic-reader-v1'},rule_version:'synthetic-read-preparation-v1',steps:[{step_key:'read',input_keys:inputs.map(i=>i.input_key),check_ids:['references'],parser_key:'synthetic_reader'}]};
   const denied=await expect('lead','/api/analysis/runs','POST',payload,400);assert.equal(denied.code,'DEFINITION_ANALYSIS_ADAPTER_NOT_ENABLED');
   // Existing P09 repository accepts synthetic storage fixtures; the public API
   // deliberately rejects this unregistered adapter. No worker executes it.
   run=await repo.createAnalysisRun(lead,payload);save('analysis-registration-boundary',{api_rejected:denied,fixture_registration:'existing P09 repository only',analysis_executed:false});
   const fixed=await expect('lead','/api/analysis/runs/'+run.run_id,'GET');assert.equal(fixed.status,'queued');save('fixed-consumers',{handoff:await expect('lead','/api/design-handoffs/'+handoff.handoff_id,'GET'),run:fixed,analysis_executed:false});
   await expect('contact','/api/design-handoffs/'+handoff.handoff_id,'GET',undefined,403);await expect('contact','/api/analysis/runs/'+run.run_id,'GET',undefined,404);
  });
  async function refs(type,entityId){
   const versions=await query('SELECT CAST(version_id AS CHAR) version_id,version_no,CAST(object_version_id AS CHAR) object_version_id,definition_json,content_digest,base_digest FROM data_map_definition_versions WHERE entity_type=? AND entity_id=? ORDER BY version_id',[type,entityId]);
   const maps=await query(`SELECT CAST(m.mapping_version_id AS CHAR) mapping_version_id,CAST(m.mapping_id AS CHAR) mapping_id,m.revision_no,m.status,CAST(m.object_version_id AS CHAR) object_version_id,CAST(m.field_version_id AS CHAR) field_version_id,m.snapshot_digest FROM data_map_v7_mapping_versions m JOIN data_map_definition_versions o ON o.version_id=m.object_version_id LEFT JOIN data_map_definition_versions f ON f.version_id=m.field_version_id WHERE (?='object' AND o.entity_id=?) OR (?='field' AND f.entity_id=?) ORDER BY m.mapping_version_id`,[type,entityId,type,entityId]);
   const exact={source_mappings:await query('SELECT CAST(m.mapping_id AS CHAR) mapping_id,CAST(m.batch_id AS CHAR) batch_id,m.local_id,CAST(m.platform_version_id AS CHAR) platform_version_id FROM data_map_source_mappings m JOIN data_map_definition_versions v ON v.version_id=m.platform_version_id WHERE v.entity_type=? AND v.entity_id=? ORDER BY m.mapping_id',[type,entityId]),review_events:await query("SELECT CAST(e.event_id AS CHAR) event_id,CAST(e.version_id AS CHAR) version_id,e.event_type FROM data_map_definition_events e JOIN data_map_definition_versions v ON v.version_id=e.version_id WHERE v.entity_type=? AND v.entity_id=? AND e.event_type<>'definition_saved' ORDER BY e.event_id",[type,entityId]),fact_requests:await query("SELECT CAST(r.fact_id AS CHAR) fact_id,r.status,CAST(r.subject_version_id AS CHAR) subject_version_id,CAST(r.object_version_id AS CHAR) object_version_id,r.revision_no FROM data_map_fact_requests r JOIN data_map_definition_versions v ON v.version_id=r.subject_version_id JOIN data_map_definition_versions o ON o.version_id=r.object_version_id WHERE (v.entity_type=? AND v.entity_id=?) OR (?='object' AND o.entity_id=?) ORDER BY r.fact_id",[type,entityId,type,entityId]),v7_mapping_versions:maps};
   if(type==='object'){
    exact.fields=await query('SELECT CAST(id AS CHAR) field_id,status FROM data_map_fields WHERE object_id=? ORDER BY id',[entityId]);exact.live_fields=exact.fields.filter(f=>f.status!=='archived');
    exact.fixed_field_versions=await query("SELECT CAST(f.version_id AS CHAR) version_id,CAST(f.entity_id AS CHAR) field_id,CAST(f.object_version_id AS CHAR) object_version_id FROM data_map_definition_versions f JOIN data_map_definition_versions o ON o.version_id=f.object_version_id WHERE o.entity_type='object' AND o.entity_id=? ORDER BY f.version_id",[entityId]);
   }else{
    for(const [label,table,where,args] of [['system_links','data_map_field_system_links','field_id=?',[entityId]],['identity_records','data_map_field_identities','field_id=?',[entityId]],['conflicts','mdm_field_conflicts','field_id_a=? OR field_id_b=?',[entityId,entityId]],['quality_issues','data_map_quality_issues','field_id=?',[entityId]]])exact[label]=await query('SELECT * FROM '+table+' WHERE '+where+' ORDER BY id',args);
    const set=new Set(versions.map(v=>v.version_id));exact.identifier_versions=(await query("SELECT CAST(version_id AS CHAR) version_id,CAST(entity_id AS CHAR) object_id,definition_json FROM data_map_definition_versions WHERE entity_type='object' ORDER BY version_id")).filter(v=>(parse(v.definition_json).unique_identifiers||[]).some(g=>g.field_version_ids.some(id=>set.has(id))));
   }
   const mapIds=new Set(maps.map(m=>m.mapping_version_id));
   const handoffRefs=(await query('SELECT CAST(handoff_version_id AS CHAR) handoff_version_id,CAST(mapping_version_id AS CHAR) mapping_version_id,side FROM data_map_design_handoff_refs ORDER BY handoff_version_id,mapping_version_id,side')).filter(r=>mapIds.has(r.mapping_version_id));
   const versionIds=new Set(versions.map(v=>v.version_id)),handoffIds=new Set(handoffRefs.map(r=>r.handoff_version_id));
   const relatedDefinitions=new Set((type==='object'?exact.fixed_field_versions:exact.identifier_versions).map(v=>v.version_id));
   const analysisRefs=(await query('SELECT CAST(run_id AS CHAR) run_id,input_key,CAST(definition_version_id AS CHAR) definition_version_id,CAST(mapping_version_id AS CHAR) mapping_version_id,CAST(handoff_version_id AS CHAR) handoff_version_id,CAST(batch_id AS CHAR) batch_id,snapshot_digest FROM data_map_analysis_inputs ORDER BY run_id,input_key')).map(r=>({...r,matched_by:[versionIds.has(r.definition_version_id)?'direct_definition':null,relatedDefinitions.has(r.definition_version_id)?(type==='object'?'fixed_child_field_definition':'identifier_object_definition'):null,mapIds.has(r.mapping_version_id)?'fixed_mapping':null,handoffIds.has(r.handoff_version_id)?'mapping_to_handoff':null,exact.source_mappings.some(m=>m.batch_id===r.batch_id)?'same_template_batch':null].filter(Boolean)})).filter(r=>r.matched_by.length);
   const impact=await get('/impact/'+type+'/'+entityId);const independent=Object.fromEntries(Object.entries(exact).map(([k,rs])=>[k,rs.length]));assert.deepEqual(impact.counts,independent);
   assert.equal(impact.impact_digest,digest({type,entityId,revision:impact.revision_no,counts:independent}));
   return {entity_type:type,entity_id:entityId,impact,versions,refs:exact,derived_refs:{handoff_refs:handoffRefs,analysis_refs:analysisRefs},derived_counts:{handoff_versions:handoffIds.size,handoff_ref_rows:handoffRefs.length,analysis_runs:new Set(analysisRefs.map(r=>r.run_id)).size,analysis_input_rows:analysisRefs.length},coverage:{counted_families:'matched exact SQL refs',handoff_analysis:'derived audit only, not included in retirement API digest',work_packages:'no definition FK; process/local refs only, semantic association unknown',publications:'spreadsheet payload/dataset versions; no definition FK, semantic association unknown',business_identity:'not decided',complete:false}};
  }
  let inventory;
  await check('object and field retirement counts/digest match independent exact SQL refs; derived consumers stay separately labelled',async()=>{
   const before=await hashes();inventory={synthetic:true,read_actor:'SYNTHETIC_lead global read',base:await refs('object',base.entity_id),field:await refs('field',field.entity_id)};
   save('reference-inventory',inventory);assert.equal(inventory.base.impact.counts.v7_mapping_versions,4);assert.equal(inventory.field.impact.counts.v7_mapping_versions,2);assert.equal(inventory.base.derived_counts.handoff_ref_rows,4);assert.equal(inventory.field.derived_counts.handoff_ref_rows,2);assert.equal(inventory.base.derived_counts.analysis_input_rows,5);assert.equal(inventory.field.derived_counts.analysis_input_rows,5);
   assert.deepEqual(await hashes(),before);save('reference-inventory',inventory);
  });
  await check('current scope/admin read-only and missing required table/marker reject, never zero impact',async()=>{
   for(const s of ['/impact/object/'+base.entity_id,'/impact/field/'+field.entity_id]){await get(s,'outsider',403);assert.deepEqual(await get(s,'admin'),await get(s));}
   await expect('adminMulti',root+'/save','POST',{request_id:uuid(),entity_type:'object',definition:{name:'禁止治理写入'}},403);
   const marker=require('../server/dataMapDefinitionSchema').MIGRATION_KEY;await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[marker]);await get('/impact/object/'+base.entity_id,'lead',503);await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[marker]);
   await pool.execute('RENAME TABLE data_map_source_mappings TO synthetic_missing_source_mappings');try{await get('/impact/object/'+base.entity_id,'lead',503);}finally{await pool.execute('RENAME TABLE synthetic_missing_source_mappings TO data_map_source_mappings');}
   await pool.execute('UPDATE person_roles SET effective_to=DATE_SUB(CURRENT_DATE, INTERVAL 1 DAY) WHERE person_id=83');try{await get('/impact/object/'+base.entity_id,'contact',403);}finally{await pool.execute('UPDATE person_roles SET effective_to=NULL WHERE person_id=83');}
   save('target-columns',await query('SELECT TABLE_NAME,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COLUMN_KEY FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION'));
   save('installed-markers',await query('SELECT migration_key FROM schema_migrations ORDER BY migration_key'));
  });
  await check('current object/field definition changes retain fixed old refs and make factual answer stale',async()=>{
   const fixedObject=await get('/version/'+base.version_id),fixedField=await get('/version/'+field.version_id),fixedRun=await expect('lead','/api/analysis/runs/'+run.run_id,'GET');
   const updated=await define({entity_type:'field',entity_id:field.entity_id,expected_revision:1,object_id:base.entity_id,object_version_id:base.version_id,definition:{source:{description:'SYNTHETIC 新来源说明，当前结果需重新核对'}}});
   const updatedObject=await define({entity_type:'object',entity_id:base.entity_id,expected_revision:4,definition:{business_meaning:'SYNTHETIC 当前定义修订，不替换固定历史'}});
   const stale=await expect('lead',factRoot+'/'+fact.fact_id,'GET');assert.equal(stale.stale,true);assert.equal(stale.subject_version_id,field.version_id);assert.equal(stale.status,'checked');
   assert.deepEqual(await get('/version/'+fixedObject.version_id),fixedObject);assert.deepEqual(await get('/version/'+fixedField.version_id),fixedField);
   assert.deepEqual((await expect('lead','/api/analysis/runs/'+run.run_id,'GET')).manifest,fixedRun.manifest);
   const handoffNow=await expect('lead','/api/design-handoffs/'+handoff.handoff_id,'GET');assert(handoffNow.issues.some(i=>i.code==='DEFINITION_VERSION_ADVANCED'));
   save('source-change',{updated,updatedObject,stale,handoffNow,fixedRun_after:await expect('lead','/api/analysis/runs/'+run.run_id,'GET')});
  });
  await check('golden-source responsibility/confirmation retains original semantics; external identity change rejects current definition impact',async()=>{
   const current=(await get('/detail/object/'+base.entity_id)).current;
   identityField=await define({entity_type:'field',object_id:base.entity_id,object_version_id:current.version_id,definition:{name:'合成黄金源示例字段'}});
   const frozen=await get('/version/'+identityField.version_id);
   const identity=await expect('contact','/api/field-identities/'+identityField.entity_id,'PUT',{authoritative_system:'SYNTHETIC ERP候选',maintain_dept_id:91,owner_person_id:83,note:'SYNTHETIC 专项；非正式主数据'});
   await expect('admin','/api/field-identities/'+identityField.entity_id+'/confirm','POST',{},403);
   const confirmed=await expect('reviewA','/api/field-identities/'+identityField.entity_id+'/confirm','POST',{expected_identity:identity});assert.equal(confirmed.success,true);
   assert.deepEqual(await get('/version/'+identityField.version_id),frozen);const failed=await get('/impact/field/'+identityField.entity_id,'lead',409);assert.equal(failed.code,'DEFINITION_LEGACY_SOURCE_CHANGED');
   const history=await expect('lead','/api/field-identities/field/'+identityField.entity_id+'/history','GET');
   save('golden-source-boundary',{identity,confirmed,history,fixed_definition:frozen,current_impact:failed,note:'Confirmed golden source does not capture a new fixed field definition or recognize master data.'});
  });
  await check('existing retirement digest rejects stale count and revision; concurrent maintenance has one committed version; no merge/delete',async()=>{
   const impact=await get('/impact/object/'+sameName.entity_id);
   const added=await define({entity_type:'field',object_id:sameName.entity_id,object_version_id:sameName.version_id,definition:{name:'合成新增依赖'}});
   const rejected=await expect('contact',root+'/retire/object/'+sameName.entity_id,'POST',{request_id:uuid(),expected_revision:1,confirm:true,reason:'SYNTHETIC 旧摘要拒绝验证',impact_digest:impact.impact_digest},409);assert.equal(rejected.code,'DEFINITION_IMPACT_CHANGED');
   const results=await Promise.all(['一','二'].map(x=>request('contact',root+'/save','POST',{request_id:uuid(),entity_type:'object',entity_id:alias.entity_id,expected_revision:1,definition:{business_meaning:'SYNTHETIC 并发维护'+x}})));assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
   assert.equal((await get('/detail/object/'+sameName.entity_id)).current.base_snapshot.row.status,'draft');assert.equal((await get('/version/'+added.version_id)).entity_id,added.entity_id);
   save('maintenance-race',{rejected,statuses:results.map(r=>r.status),scope:'existing maintenance only; identity decision/revocation not implemented or exercised'});
  });
  await check('owned in-memory backup/restore preserves exact stable refs/history/counts after synthetic corruption',async()=>{
   const before=await hashes(),dump=backup();await pool.execute("UPDATE data_map_definition_versions SET content_digest=REPEAT('0',64) WHERE version_id=?",[field.version_id]);await get('/version/'+field.version_id,'lead',409);restore(dump);assert.deepEqual(await hashes(),before);save('restore',{before,after:await hashes(),backup_sha256:crypto.createHash('sha256').update(dump).digest('hex'),in_memory_only:true,owned_database_only:true});
  });
  // Product UI is unchanged. This validates the existing read preview, not new identity actions.
  await check('Edge desktop existing retirement preview/history reads are truthful and do not mutate business rows',async()=>{
   const before=await hashes();browser=await pw.chromium.launch({channel:'msedge',headless:true});context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e)));
   await page.goto(fixture.baseURL+'/app/objects');await page.locator('#login-name').fill('SYNTHETIC_contact');await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();
   await page.locator('.object-choice').filter({hasText:'合成对象'}).first().click();await page.getByRole('button',{name:'查看停用影响',exact:true}).click();await page.getByRole('heading',{name:'停用影响确认',exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   const preview=await page.locator('.management-main').innerText();assert(preview.includes('所属字段'));assert(!preview.includes('合并'));await page.screenshot({path:path.join(output,'existing-impact-desktop.png'),fullPage:true});
   await page.getByRole('button',{name:'取消停用',exact:true}).click();await page.getByRole('button',{name:'查看版本历史',exact:true}).click();await page.locator('.history-list button').filter({hasText:'修订 1 ·'}).click();await page.screenshot({path:path.join(output,'fixed-history-desktop.png'),fullPage:true});
   const old=await page.locator('.definition-detail').innerText();assert(old.includes('合成对象'));assert.deepEqual(errors,[]);assert.deepEqual(await hashes(),before);
   save('browser',{engine:'Microsoft Edge',zoom:1,viewport:{width:1699,height:828},preview,history:old,pageErrors:errors,read_business_rows_unchanged:true,ui_modified:false});
  });
  save('validation',{passed:true,checks,observations,real_model_calls:0,external_cli_calls:0,analysis_executed:false,identity_decision_executed:false,owned_fixture:true});
 }finally{if(upload)await upload.dispose();if(context)await context.close();if(browser)await browser.close();}
},{randomDatabase:true,evidenceDir:output,previewOnly:true});save('cleanup',{owned_http_stopped:true,owned_mysql_removed:true});console.log('P25_OBJECT_IDENTITY_PREVIEW_PASS '+checks.length);}
main().catch(e=>{save('failure',{code:e.code||null,message:e.message,stack:e.stack,checks});console.error(e);process.exitCode=1;});
