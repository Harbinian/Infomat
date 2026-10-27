// Real isolated MySQL + real HTTP/session regression for the joint formal chain.
// Inputs: --output <new artifacts directory>, --v4-model <reviewed candidate file>.
// Only owns its labelled tmpfs database and random local HTTP port. No private
// config, formal services, notifications or business acceptance are used.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const at=key=>process.argv.indexOf(key),arg=key=>at(key)>0?process.argv[at(key)+1]:null;
const appRoot=path.resolve(__dirname,'..'),candidateRoot=arg('--candidate-root')?path.resolve(arg('--candidate-root')):appRoot;
assert(candidateRoot===appRoot||candidateRoot.startsWith(path.resolve(appRoot,'../../artifacts')+path.sep),'candidate root must be a reviewed artifact');
if(candidateRoot!==appRoot){
  const Module=require('node:module');process.env.NODE_PATH=[path.join(appRoot,'node_modules'),process.env.NODE_PATH||''].filter(Boolean).join(path.delimiter);Module._initPaths();
  const resolve=Module._resolveFilename;Module._resolveFilename=function(request,parent,...rest){const file=resolve.call(this,request,parent,...rest);
    if(typeof file==='string'&&['server','shared'].some(name=>file.startsWith(path.join(appRoot,name)+path.sep))){const selected=path.join(candidateRoot,path.relative(appRoot,file));assert(fs.existsSync(selected),'candidate runtime dependency missing: '+path.relative(appRoot,file));return selected;}return file;};
}
const output=path.resolve(arg('--output')||'');
assert(arg('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output),'new artifacts --output required');
const v4=path.resolve(arg('--v4-model')||'');assert(arg('--v4-model')&&v4.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));
if(candidateRoot!==appRoot)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(v4)).digest('hex'),crypto.createHash('sha256').update(fs.readFileSync(path.join(candidateRoot,'server/roleDefinitions.js'))).digest('hex'),'selected role definitions must equal the exact candidate file');
const modelId=require.resolve('../server/roleDefinitions');require.cache[modelId]={id:modelId,filename:modelId,loaded:true,exports:require(v4)};
assert.equal(require('../server/roleDefinitions').ACCESS_MODEL_VERSION,'rbac-raci-v4-2026-10-19');
Object.assign(process.env,{NODE_ENV:'test',MDM_DB_QUIET:'1',MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',
  MDM_ALLOW_LEGACY_TEST_MODE:'0',MDM_SYSTEM_ADMIN_ENABLED:'0',PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1',PROCESS_V7_AUTHORING_ENABLED:'0',TERMINOLOGY_GOVERNANCE_ENABLED:'1',PROCESS_DATA_GOVERNANCE_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'});
fs.mkdirSync(output,{recursive:true});
const {withFreshMysql}=require('./testHelpers/freshMysql'),fixture=require('./testHelpers/processCaseGovernanceFixture');
const {contentHash,validateAndProjectProcess}=require('../server/processPreviewReview');
const express=require('express'),session=require('express-session');
const sourceFiles=['server/processDesignApplication.js','server/processDesignMysqlRepository.js','server/routes/processDesignMysql.js','server/processFormalControls.js','server/processFormalControlPolicy.js','server/processFormalControlMigration.js','server/processCaseGovernance.js','server/processCaseGovernanceSchema.js','server/processPreviewReviewRepository.js','server/routes/processPreviewReview.js','server/processCaseDisputes.js','server/routes/processCaseDisputes.js','server/processDisputeMaterials.js','server/processContentChecks.js','server/terminologyUsages.js','server/processDataGovernanceRepository.js','server/routes/processDataGovernance.js','server/processDataGovernanceMigration.js','server/dataMapHandoffSchema.js'];
if(candidateRoot!==appRoot){const walk=directory=>{for(const entry of fs.readdirSync(path.join(candidateRoot,directory),{withFileTypes:true})){const relative=path.join(directory,entry.name);if(entry.isDirectory())walk(relative);else if(/\.(?:js|cjs|json|sql)$/.test(entry.name)&&!sourceFiles.includes(relative.replaceAll('\\','/')))sourceFiles.push(relative.replaceAll('\\','/'));}};for(const directory of ['server','shared'])walk(directory);sourceFiles.sort();}
const sourceHashes=()=>Object.fromEntries(sourceFiles.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(path.join(candidateRoot,file))).digest('hex')]));
const loadedSourceHashes=sourceHashes();
const generationRoot=candidateRoot===appRoot?null:path.resolve(candidateRoot,'../../..');
const candidateManifest=generationRoot?JSON.parse(fs.readFileSync(path.join(generationRoot,'source-manifest.json'),'utf8')):null;
function assertCandidateManifest(){if(!candidateManifest)return;for(const file of candidateManifest.files)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(generationRoot,'source',file.path))).digest('hex'),file.sha256,'candidate manifest byte mismatch: '+file.path);}
assertCandidateManifest();
const checks=[],check=name=>{checks.push(name);fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify({checks},null,2));},root='/api/process-v7-preview';
const caseBinding=c=>({expected_revision_no:c.current_revision_no,expected_content_hash:c.current_content_hash});
const draftBinding=d=>({expected_revision_no:d.revision_no,expected_content_hash:d.content_hash});
function source(){
  const d=fixture.document();d.schema_version='process-governance-v9';d.migration.source_schema_version=d.schema_version;
  Object.assign(d.export_meta,{initiating_department:'Synthetic A',compiler:'Synthetic compiler'});
  Object.assign(d.process,{process_name:'合成材料核对流程',purpose:'填写合成记录后由另一个部门核对结果。',scope:'仅用于隔离技术回归。',entry_behavior_refs:['behavior_create']});
  d.behaviors=['create','review'].map((s,i)=>({behavior_ref:'behavior_'+s,node_type:'action',behavior_name:i?'合成核对人员核对合成记录':'合成经办人员填写合成记录',behavior_description:i?'核对合成记录中的结论并记录核对结果。':'填写合成记录中的结论并提交记录。',current_actor_role:(i?'Synthetic B':'Synthetic A')+'经办人',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'收到明确的合成材料',precondition:'',input_description:'合成材料',timing:null,completion_standard:'合成记录已填写并核对。',output_description:'合成记录',countersign_all_required:false,countersign_target_departments:[]}));
  d.flow_relations=[{relation_ref:'relation_create_review',from_behavior_ref:'behavior_create',to_behavior_ref:'behavior_review',relation_type:'sequence',condition:''}];
  d.data_objects=[{data_ref:'data_synthetic',data_name:'合成记录',description:'每次接收一条明确的合成记录，填写后核对。',information_type:'business_conclusion',record_model:'record_collection',collection_field_refs:[],fields:[{field_ref:'field_result',field_name:'核对结论',field_type:'文本',definition:'填写并核对的合成结论。'}],behavior_links:[{link_ref:'link_create',behavior_ref:'behavior_create',operation:'create',updated_field_refs:[],record_scope:'new_instance',presence:'required'},{link_ref:'link_review',behavior_ref:'behavior_review',operation:'use',updated_field_refs:[],record_scope:'current_instance',presence:'required'}],source_relations:[],lifecycle:{applicability:'not_applicable',entry_state:{business_validity:'effective',custody:'active_custody',identifiability_applicability:'not_applicable',identifiability:'not_applicable'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'no_lifecycle_in_current_process',decision_notes:'合成流程只填写及核对记录，不另行改变其有效性、保管或可识别状态。'}}];
  d.forms=[{form_ref:'form_synthetic',form_name:'合成记录表',form_no:'SYN-FORM',form_design_state:'current_state',behavior_links:[{behavior_ref:'behavior_create',operations:['fill'],notes:'填写合成结论'},{behavior_ref:'behavior_review',operations:['review'],notes:'核对填写结果'}],areas:[{area_ref:'area_synthetic',area_type:'基本信息',area_title:'合成信息',items:[{item_ref:'item_result',item_name:'核对结论',item_type:'文本',required:true,instructions:'填写真实合成结论',business_data_ref:'data_synthetic',data_field_ref:'field_result',value_usage_mode:'reuse_existing',value_origin_mode:'depends_on_data',source_links:[{source_type:'process_data',source_data_ref:'data_synthetic',source_role:'provides_value'}]}]}]}];
  d.data_objects[0].collection_field_refs=['field_result'];
  d.forms[0].behavior_links.forEach((link,index)=>{link.link_ref='form_link_'+index;});
  Object.assign(d.forms[0].areas[0].items[0].source_links[0],{source_link_ref:'form_source_result',source_system_name:'',source_data_name:'合成记录'});
  return d;
}
async function main(){
  const initial=validateAndProjectProcess(source(),[{id:91,name:'Synthetic A',code:'SYN_A'},{id:92,name:'Synthetic B',code:'SYN_B'}]);
  fs.writeFileSync(path.join(output,'initial-source-validation.json'),JSON.stringify({errors:initial.errors,content_checks:initial.contentChecks,blocking_issues:initial.blockingIssues},null,2));
  assert.deepEqual(initial.errors,[]);assert.deepEqual(initial.blockingIssues,[]);
  await withFreshMysql(async({pool,database,owner,port:mysqlPort})=>{
  fs.writeFileSync(path.join(output,'owned-target.json'),JSON.stringify({database,owner,runner_pid:process.pid,stage:'84',synthetic_only:true}));
  let identity=require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);await identity.initSchema();
  await require('../server/processV7PreviewReviewMigration').applyProcessV7PreviewReview(pool);
  const actors=await fixture.seed(pool);
  for(const [person,role] of [[23,'data_conflict_handler'],[24,'decision_group']])await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic dispute authority',CURRENT_DATE FROM roles WHERE role_code=?",[person,role]);
  await require('../server/processV7FormalMigration').applyProcessV7FormalFoundation(pool);
  const authoringDb=await pool.getConnection();try{await require('../server/processV7AuthoringMigration').applyAuthoring(authoringDb);}finally{authoringDb.release();}
  const responsibilitySchema=require('../server/governanceResponsibilitiesMigration');for(const sql of require('../server/mysqlSchema').splitSqlStatements(responsibilitySchema.SCHEMA_SQL))await pool.execute(sql);await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[responsibilitySchema.MIGRATION_KEY]);
  await require('../server/processDataGovernanceMigration').applyProcessDataGovernance(pool);
  const definitionSchema=require('../server/dataMapDefinitionSchema');for(const sql of definitionSchema.statements())await pool.execute(sql);await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[definitionSchema.MIGRATION_KEY]);
  await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database});
  // This owned, synthetic fixture models an authorized controlled target. It
  // does not create packages or claim a real deployment's cutover evidence.
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  let preview=require('../server/processPreviewReviewRepository').makeProcessPreviewReviewRepository(pool),formal=require('../server/processDesignMysqlRepository').makeProcessDesignMysqlRepository(pool);
  const departments=await preview.listDepartments(),document=source(),projection=validateAndProjectProcess(document,departments);
  fs.writeFileSync(path.join(output,'source-validation.json'),JSON.stringify({errors:projection.errors,content_checks:projection.contentChecks,blocking_issues:projection.blockingIssues},null,2));
  assert.deepEqual(projection.errors,[]);assert.deepEqual(projection.blockingIssues,[]);
  // Exercise known legacy NOT NULL preparation against real preserved rows.
  await pool.execute('ALTER TABLE process_design_drafts MODIFY planned_edition VARCHAR(16) NOT NULL');
  await pool.execute('ALTER TABLE process_design_versions MODIFY edition VARCHAR(16) NOT NULL');
  await pool.execute('ALTER TABLE process_design_versions MODIFY effective_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await pool.execute("INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id,current_edition) VALUES(901,'SYN-LEGACY','Synthetic historical institution',91,'B')");
  await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,status,schema_version,process_content_json,content_hash,revision_no) VALUES(901,901,'SYN-LEGACY','Synthetic historical institution','C','Synthetic historical institution','synthetic','synthetic','synthetic',91,'published',?,?,?,1)",[document.schema_version,JSON.stringify(document),projection.contentHash]);
  await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status,effective_at) VALUES(901,901,901,'SYN-LEGACY','Synthetic historical institution','B','SYN-LEGACY-B',91,?,?,?,1,'published','2026-01-01 00:00:00')",[document.schema_version,JSON.stringify(document),projection.contentHash]);
  const before=(await pool.execute('SELECT edition,CAST(effective_at AS CHAR) effective_at FROM process_design_versions WHERE id=901'))[0][0];
  const migration=require('../server/processFormalControlMigration');assert.equal((await migration.inspectSchema(pool)).ready,false);
  await assert.rejects(migration.applyMigration(pool),/AUTHORIZATION_REQUIRED/);await migration.applyMigration(pool,{authorized:true});assert.equal((await migration.applyMigration(pool,{authorized:true})).changed,0);
  assert.deepEqual((await pool.execute('SELECT edition,CAST(effective_at AS CHAR) effective_at FROM process_design_versions WHERE id=901'))[0][0],before);
  check('real additive nullability preparation is authorized, idempotent, and preserves legacy institution fields');
  for(const sql of [...require('../server/terminologyGovernanceSchema').statements(),...require('../server/terminologyUsageSchema').statements()])await pool.execute(sql);
  await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES(?)',[require('../server/terminologyGovernanceSchema').MIGRATION_KEY]);
  const termId=crypto.randomUUID(),termVersion=crypto.randomUUID(),termContent={term:document.process.process_name,definition:'合成材料填写并核对的测试流程。',context:'隔离治理测试',source_kind:'custom',standard_number:'',standard_version:'',standard_clause:'',original_definition:'',company_application:'仅适用于本隔离合成流程'};
  await pool.execute("INSERT INTO tg_terms(term_id,current_version_id,adoption_status,department_id) VALUES(?,?,'adopted',91)",[termId,termVersion]);
  await pool.execute('INSERT INTO tg_term_versions(version_id,term_id,version_no,content_json,content_hash) VALUES(?,?,1,?,?)',[termVersion,termId,JSON.stringify(termContent),require('../server/terminologyGovernancePolicy').hash(termContent)]);
  const password='Synthetic-Formal-Only!2026',hash=require('bcryptjs').hashSync(password,10);
  await pool.execute('UPDATE user_accounts SET password_hash=?,must_change_password=0',[hash]);
  const runtimeUser='formal_runtime_'+owner.replaceAll('-','').slice(0,12),runtimePassword=crypto.randomBytes(24).toString('hex');
  await pool.query(`CREATE USER '${runtimeUser}'@'%' IDENTIFIED BY ?`,[runtimePassword]);
  const [tables]=await pool.execute('SELECT TABLE_NAME table_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[database]);
  for(const {table_name:table} of tables){assert(/^[a-z0-9_]+$/.test(table));const privileges=['process_v7_preview_events','process_design_events'].includes(table)?'SELECT,INSERT':'SELECT,INSERT,UPDATE,DELETE';await pool.execute(`GRANT ${privileges} ON \`${database}\`.\`${table}\` TO '${runtimeUser}'@'%'`);}
  const appPool=require('mysql2/promise').createPool({host:'127.0.0.1',port:mysqlPort,user:runtimeUser,password:runtimePassword,database,connectionLimit:8});
  await assert.rejects(appPool.execute('UPDATE process_v7_preview_events SET basis_text=basis_text WHERE 1=0'),{code:'ER_TABLEACCESS_DENIED_ERROR'});
  identity=require('../server/identityMysqlRepository').makeIdentityMysqlRepository(appPool);preview=require('../server/processPreviewReviewRepository').makeProcessPreviewReviewRepository(appPool);formal=require('../server/processDesignMysqlRepository').makeProcessDesignMysqlRepository(appPool);
  check('application runtime has only SELECT and INSERT on immutable preview/formal event tables; UPDATE is actually denied');
  const auth=require('../server/auth'),org=require('../server/routes/org'),previewRoute=require('../server/routes/processPreviewReview'),formalRoute=require('../server/routes/processDesignMysql'),disputeRoute=require('../server/routes/processCaseDisputes'),responsibilityRoute=require('../server/routes/governanceResponsibilities'),termRoute=require('../server/routes/terminologyUsages'),dataRoute=require('../server/routes/processDataGovernance');
  auth.setIdentityRepositoryFactory(()=>identity);org.setIdentityRepositoryFactory(()=>identity);previewRoute.setProcessPreviewRepositoryFactory(()=>preview);formalRoute.setProcessDesignRepositoryFactory(()=>formal);
  disputeRoute.setRepositoryFactory(()=>require('../server/processCaseDisputes').makeProcessCaseDisputes(appPool));responsibilityRoute.setRepositoryFactory(()=>require('../server/governanceResponsibilities').makeGovernanceResponsibilitiesRepository(appPool));termRoute.setRepositoryFactory(()=>require('../server/terminologyUsages').makeTerminologyUsages(appPool));
  dataRoute.setProcessDataGovernanceRepositoryFactory(()=>require('../server/processDataGovernanceRepository').makeProcessDataGovernanceRepository(appPool));
  const app=express();app.use(express.json({limit:'3mb'}));app.use(session({secret:crypto.randomBytes(32).toString('hex'),resave:false,saveUninitialized:false,cookie:{httpOnly:true}}));app.use(require('../server/security').csrfProtection);app.get('/api/csrf-token',auth.requireAuth,require('../server/security').issueCsrfToken);app.use('/api/org',org);app.use(root,previewRoute);app.use('/api/process-design',formalRoute);app.use('/api/process-case-disputes',disputeRoute);app.use('/api/governance-responsibilities',responsibilityRoute);app.use('/api/terminology-governance',termRoute);
  app.use('/api/process-data-governance',dataRoute);
  if(arg('--frontend-dist')){const dist=path.resolve(arg('--frontend-dist'));assert(dist.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(fs.statSync(path.join(dist,'index.html')).isFile());app.use('/app',require('../server/frontend').frontendRouter(dist));app.use(require('../server/frontend').publicEntryRouter());}
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const port=server.address().port;assert(![3000,3001,3306,3307,5173].includes(port));const base='http://127.0.0.1:'+port,cookies=new Map(),tokens=new Map();
  const request=async(who,url,method='GET',body)=>{const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',Cookie:cookies.get(who)||'',...(tokens.has(who)?{'X-CSRF-Token':tokens.get(who)}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});if(response.headers.get('set-cookie'))cookies.set(who,response.headers.get('set-cookie').split(';')[0]);return {status:response.status,body:await response.json()};};
  const api=async(who,url,method='GET',body,status=200)=>{const r=await request(who,url,method,body);assert.equal(r.status,status,`${who} ${method} ${url}: ${JSON.stringify(r.body)}`);return r.body;};
  try{
    for(const [who,actor] of Object.entries(actors)){await api(who,'/api/org/login','POST',{loginName:'CASE_SYN_'+actor.personId,password});tokens.set(who,(await api(who,'/api/csrf-token')).csrfToken);}
    check('real synthetic login sessions and current database authorization guard every HTTP operation');
    if(process.argv.includes('--browser-only')){assert(arg('--frontend-dist'),'browser-only requires explicit isolated frontend build');await require('./test-process-joint-browser')({baseURL:base,pool,actors,api,preview,password,source:document,termId,termVersion,output});assert.deepEqual(sourceHashes(),loadedSourceHashes);assertCandidateManifest();fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'passed',browser_only:true,candidate_root:candidateRoot,source_hashes:loadedSourceHashes,source_unchanged_through_run:true,formal_database_connected:false,business_accepted:false},null,2));console.log('JOINT_EDGE_ONLY_PASS');return;}
    const created=await api('contactA',root+'/cases','POST',{document,source_file_name:'synthetic-formal-v9.json',submission:fixture.submission(['91','92'])},201),caseId=created.case.id;
    const read=()=>api('lead',root+'/cases/'+caseId);
    async function confirmItems(){const items=(await read()).items;for(const item of items)for(const [who,dept] of [['headA',91],['headB',92]])if([Number(item.origin_department_id),Number(item.target_department_id)].includes(dept)){const latest=await read();await api(who,root+'/items/'+item.id+'/decision','POST',{...caseBinding(latest.case),decision:'confirmed',basis:'合成负责人本人确认本部门事实',expected_dispute_event_id:latest.review_dispute_event_id});}return read();}
    async function ready(){await fixture.completeSidecar(preview,caseId,actors,['91','92']);return confirmItems();}
    let d=await read();await api('lead',root+'/cases/'+caseId+'/promote','POST',{...caseBinding(d.case),target:{mode:'create',document_no:'SYN-FORMAL',document_title:'合成正式流程'}},409);
    d=await ready();
    // A project decision records the complete escalation and reopens both
    // departments' own fact checks. It cannot substitute for their confirmation.
    const disputed=d.items.find(item=>Number(item.target_department_id)===92);
    await api('headB',root+'/items/'+disputed.id+'/decision','POST',{...caseBinding(d.case),decision:'disputed',basis:'合成乙部对接口事实存在明确分歧',expected_dispute_event_id:d.review_dispute_event_id});
    const disputes=require('../server/processCaseDisputes').makeProcessCaseDisputes(appPool);
    const disputeAct=async(actor,action,extra={})=>{const s=await disputes.detail(actor,caseId);return disputes.act(actor,caseId,{action,request_id:crypto.randomUUID(),expected_event_id:s.event_id,expected_revision_no:s.source_revision_no,expected_content_hash:s.source_content_hash,basis:'合成明确办理依据 '+action,...extra});};
    await disputeAct(actors.lead,'assign',{coordinator_person_id:'23'});
    const concurrency=await disputes.detail(actors.replacementA,caseId),coordinate=()=>disputes.act(actors.replacementA,caseId,{action:'coordinate',request_id:crypto.randomUUID(),expected_event_id:concurrency.event_id,expected_revision_no:concurrency.source_revision_no,expected_content_hash:concurrency.source_content_hash,basis:'合成同来源并发协调'});
    const coordinated=await Promise.allSettled([coordinate(),coordinate()]);assert.equal(coordinated.filter(r=>r.status==='fulfilled').length,1);assert.equal(coordinated.find(r=>r.status==='rejected').reason.code,'PROCESS_DISPUTE_SOURCE_CHANGED');
    await assert.rejects(disputeAct(actors.replacementA,'escalate'),{code:'PROCESS_DISPUTE_MATERIALS_REQUIRED'});
    const materials={issue_summary:'合成接口事实分歧',impact_scope:'合成甲乙两部门当前接口',coordination_history:'两轮合成协调仍未一致',positions:[{department_id:'91',position:'合成甲方观点',basis:'合成甲方实际记录'},{department_id:'92',position:'合成乙方观点',basis:'合成乙方实际记录'}]};
    const priorEscalation=await disputes.detail(actors.replacementA,caseId),escalationInput={action:'escalate',request_id:crypto.randomUUID(),expected_event_id:priorEscalation.event_id,expected_revision_no:priorEscalation.source_revision_no,expected_content_hash:priorEscalation.source_content_hash,basis:'合成完整升级材料',escalation_materials:materials};
    const escalated=await disputes.act(actors.replacementA,caseId,escalationInput);assert.equal(escalated.state,'escalated');assert.equal((await disputes.act(actors.replacementA,caseId,escalationInput)).idempotent,true);
    const decided=await disputeAct(actors.contactC,'decide',{decision:'recheck'});assert.equal(decided.state,'awaiting_recheck');
    d=await read();const reopened=d.items.find(i=>i.id===disputed.id);assert.equal(reopened.origin_status,'pending');assert.equal(reopened.counterparty_status,'pending');
    await api('lead',root+'/cases/'+caseId+'/promote','POST',{...caseBinding(d.case),target:{mode:'create',document_no:'SYN-FORMAL',document_title:'合成正式流程'}},409);
    d=await confirmItems();assert.equal((await disputes.detail(actors.lead,caseId)).state,'resolved');check('INSERT-only event runtime serializes competing coordination and idempotent escalation; complete project decision still requires both departments to recheck');
    const promote=async()=>{const target=d.formal_promotion?.document?{mode:'existing',document_id:d.formal_promotion.document.id}:{mode:'create',document_no:'SYN-FORMAL',document_title:'合成正式流程'};await api('lead',root+'/cases/'+caseId+'/promote','POST',{...caseBinding(d.case),target},201);d=await read();};
    await promote();check('source materials, named department scope, both current heads and agreed deadline precede promotion');
    const controls=()=>api('contactA',root+'/cases/'+caseId+'/formal-controls');
    let ctrl=await controls();assert(ctrl.allowed_actions.includes('record_institution_editions'));const unknown={...caseBinding(d.case),expected_event_id:ctrl.event_id,request_id:crypto.randomUUID(),action:'record_institution_editions',basis:'明确对应已登记的来源材料',materials:[{reference:'synthetic:source:1',source_edition:'A',proposed_edition:'B'}]};
    await api('contactA',root+'/cases/'+caseId+'/formal-controls','POST',unknown);ctrl=await controls();assert.equal(ctrl.institution_editions.materials[0].proposed_edition,'B');
    await api('admin',root+'/cases/'+caseId+'/formal-controls','POST',{...unknown,request_id:crypto.randomUUID(),expected_event_id:ctrl.event_id},403);
    await api('contactA',root+'/cases/'+caseId+'/formal-controls','POST',{...unknown,request_id:crypto.randomUUID(),expected_event_id:ctrl.event_id,materials:[{reference:'unknown:source',source_edition:'A'}]},422);
    const suggestion={...caseBinding(d.case),expected_event_id:ctrl.event_id,request_id:crypto.randomUUID(),action:'add_suggestion',basis:'当前现状已准确记录',title:'后续减少重复核对',affected_scope:'未来流程优化',non_blocking_reason:'不改变当前事实、责任和接口'};
    const proposed=await api('contactA',root+'/cases/'+caseId+'/formal-controls','POST',suggestion);assert.equal(proposed.suggestions.length,1);assert.equal((await api('contactA',root+'/cases/'+caseId+'/formal-controls','POST',suggestion)).suggestions.length,1);check('source edition supplement references existing material; suggestions remain independent, audited, and idempotent');
    const submit=()=>api('contactA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/submit','POST',draftBinding(d.formal_promotion.draft));
    const blocked=await api('contactA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/submit','POST',draftBinding(d.formal_promotion.draft),409);assert.equal(blocked.code,'TERM_GOVERNANCE_USAGE_REVIEW_REQUIRED');
    const usage=require('../server/terminologyUsages').makeTerminologyUsages(appPool),subject={target_type:'process_draft',target_id:String(d.formal_promotion.draft.id)},termItem={location:'/process/process_name',source_text:document.process.process_name,term_id:termId,version_id:termVersion,decision:'match',reason:'合成语义与明确场景一致'};
    async function reviewTerms(){const value=await usage.read(actors.contactA,subject);const saved=await usage.save(actors.contactA,{...subject,source_digest:value.source_digest,request_id:crypto.randomUUID(),expected_revision:value.revision_no||0,items:[termItem]});await usage.action(actors.headA,{...subject,source_digest:value.source_digest,request_id:crypto.randomUUID(),expected_revision:saved.revision_no,action:'department_confirm'});}
    await reviewTerms();
    await pool.execute('INSERT INTO process_v7_authoring(case_id,compiler_person_id) VALUES(?,18)',[caseId]);
    process.env.PROCESS_V7_AUTHORING_ENABLED='1';
    await api('headA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/submit','POST',draftBinding(d.formal_promotion.draft),403);
    await submit();process.env.PROCESS_V7_AUTHORING_ENABLED='0';d=await read();check('a content compiler without contact authority cannot submit; the qualified owner contact submits even when another person compiles');
    const negative=async(decision)=>{const task=d.formal_promotion.review_task,draft=d.formal_promotion.draft;await api('headA','/api/process-design/review-tasks/'+task.id+'/decision','POST',{...draftBinding(draft),decision,note:'通用文本不足'},422);await api('headA','/api/process-design/review-tasks/'+task.id+'/decision','POST',{...draftBinding(draft),decision,review_evidence:{problem:'合成必要事实需修订',basis:'当前合成定稿核对依据',revision_request:'回3001明确修订说明并重传'}});d=await read();};
    await negative('needs_changes');const firstTask=d.formal_promotion.review_task.id;
    const revised=structuredClone(document);revised.process.purpose+=' 本轮补充了明确的合成修订说明。';
    await api('contactA',root+'/cases/'+caseId+'/revisions','POST',{...caseBinding(d.case),document:revised,source_file_name:'synthetic-formal-r2.json',submission:fixture.submission(['91','92'])},201);d=await ready();await promote();
    await api('contactA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/submit','POST',draftBinding(d.formal_promotion.draft),409);await reviewTerms();await submit();d=await read();await negative('reject');
    const rejectedTask=structuredClone(d.formal_promotion.review_task),recovery={...draftBinding(d.formal_promotion.draft),expected_review_task_id:rejectedTask.id,note:'合成负责人明确退回保留原决定'};
    await api('headA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/return-for-changes','POST',recovery);d=await read();assert.equal(d.formal_promotion.review_task.id,rejectedTask.id);await submit();d=await read();
    await api('contactA','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/withdraw','POST',{...draftBinding(d.formal_promotion.draft),expected_review_task_id:d.formal_promotion.review_task.id,note:'合成原提交人撤回后重新提交'});d=await read();await submit();d=await read();
    await api('headA','/api/process-design/review-tasks/'+d.formal_promotion.review_task.id+'/decision','POST',{...draftBinding(d.formal_promotion.draft),decision:'approve',note:'合成现任归口负责人本人最终确认'});d=await read();check('needs-changes/revision/re-promotion, rejection/return, withdrawal and fresh current-head approval retain prior decisions');
    // Supplements never carry themselves to a new source revision.
    ctrl=await controls();assert.equal(ctrl.institution_editions,null);await api('contactA',root+'/cases/'+caseId+'/formal-controls','POST',{...unknown,...caseBinding(d.case),request_id:crypto.randomUUID(),expected_event_id:ctrl.event_id});
    await pool.execute("UPDATE tg_terms SET source_status='withdrawn',revision_no=revision_no+1 WHERE term_id=?",[termId]);
    const count=Number((await pool.execute('SELECT COUNT(*) n FROM process_design_versions'))[0][0].n);await api('lead','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/publish','POST',draftBinding(d.formal_promotion.draft),409);assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM process_design_versions'))[0][0].n),count);
    await pool.execute("UPDATE tg_terms SET source_status='current',revision_no=revision_no+1 WHERE term_id=?",[termId]);await reviewTerms();
    const published=await api('lead','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/publish','POST',draftBinding(d.formal_promotion.draft));const version=await api('lead','/api/process-design/versions/'+published.process_version_id+'/content');
    assert.match(version.version_no,/^PV\d+-R2$/);assert.equal(version.edition,null);assert.equal(version.effective_at,null);assert.equal(version.publication_meaning.enterprise_approval_status,'unknown');assert.equal(version.publication_context.sources[0].reference,'synthetic:source:1');assert.equal(version.publication_context.institution_editions[0].proposed_edition,'B');assert.deepEqual(version.document,revised);
    const current=(await pool.execute('SELECT current_edition FROM process_design_documents WHERE id=?',[version.document_id]))[0][0];assert.equal(current.current_edition,null);const legacy=await api('lead','/api/process-design/versions/901/content');assert.equal(legacy.edition,'B');assert.equal(legacy.publication_meaning.enterprise_approval_status,'unknown');
    const fixed=await usage.read(actors.lead,{target_type:'process_version',target_id:String(version.process_version_id)});assert.equal(fixed.fixed,true);assert.equal(fixed.items[0].version_id,termVersion);
    await pool.execute("UPDATE tg_terms SET source_status='withdrawn',revision_no=revision_no+1 WHERE term_id=?",[termId]);assert.equal((await usage.read(actors.lead,{target_type:'process_version',target_id:String(version.process_version_id)})).findings.length,0);assert.deepEqual(await api('lead','/api/process-design/versions/'+version.process_version_id+'/content'),version);
    await api('lead','/api/process-design/drafts/'+d.formal_promotion.draft.id+'/publish','POST',draftBinding(d.formal_promotion.draft),409);check('term change blocks new publication atomically; successful PV pins exact term version and remains immutable after withdrawal');
    const history=await api('lead','/api/process-design/drafts/'+d.formal_promotion.draft.id);assert(history.reviewTasks.some(t=>t.id===firstTask&&t.status==='needs_changes'));assert(history.reviewTasks.some(t=>t.id===rejectedTask.id&&t.status==='rejected'));assert(history.events.some(e=>e.payload?.review_evidence?.revision_request));check('new PV fields stay NULL, institution A/B snapshot is separate, legacy values and complete decisions remain readable');
    assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_work_packages WHERE process_version_id=?',[version.process_version_id]))[0][0].n),0,'platform publication never creates a governance work package automatically');
    await api('admin','/api/process-data-governance/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},403);
    const packageCreated=await api('lead','/api/process-data-governance/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},201);
    assert.equal(packageCreated.idempotent,false);assert.equal(String(packageCreated.package.process_version_id),String(version.process_version_id));assert.equal(packageCreated.package.status,'mdm_preparing');
    const dataDetail=await api('lead','/api/process-data-governance/work-packages/'+packageCreated.package.id);
    assert.equal(dataDetail.source_version.schema_version,'process-governance-v9');assert.equal(dataDetail.source_version.edition,null);assert.equal(dataDetail.source_version.content_hash,version.content_hash);assert.equal(String(dataDetail.source_version.process_version_id),String(version.process_version_id));
    assert.equal((await api('lead','/api/process-data-governance/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},201)).idempotent,true);
    assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_work_packages WHERE process_version_id=?',[version.process_version_id]))[0][0].n),1);check('current mdm lead actively creates exactly one work package from the real native V9 PV; unknown institution edition remains NULL and source hash stays fixed');
    if(process.argv.includes('--browser')){assert(arg('--frontend-dist'),'browser requires explicit isolated frontend build');await require('./test-process-joint-browser')({baseURL:base,pool,actors,api,preview,password,source:document,termId,termVersion,output});}
    assert.deepEqual(sourceHashes(),loadedSourceHashes,'test-loaded production source must remain identical through final evidence');
    assertCandidateManifest();
    if(candidateRoot!==appRoot)assert.deepEqual(Object.keys(require.cache).filter(file=>['server','shared'].some(name=>file.startsWith(path.join(appRoot,name)+path.sep))),[],'runtime must never fall back from exact candidate to worktree');
    fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'passed',checks,candidate_root:candidateRoot,exact_candidate:candidateRoot!==appRoot,access_model:require('../server/roleDefinitions').ACCESS_MODEL_VERSION,role_definitions_sha256:crypto.createHash('sha256').update(fs.readFileSync(v4)).digest('hex'),source_hashes:loadedSourceHashes,source_unchanged_through_run:true,target:{database,owner,http_port:port},published:{process_version_id:version.process_version_id,version_no:version.version_no,edition:version.edition,effective_at:version.effective_at},business_accepted:false,formal_database_connected:false},null,2));
    console.log(JSON.stringify({status:'passed',checks:checks.length,output}));
  }finally{await new Promise(resolve=>{const timer=setTimeout(()=>{server.closeAllConnections();resolve();},3000);server.close(()=>{clearTimeout(timer);resolve();});});auth.resetIdentityRepositoryFactory();org.resetIdentityRepositoryFactory();previewRoute.resetProcessPreviewRepositoryFactory();formalRoute.resetProcessDesignRepositoryFactory();disputeRoute.resetRepositoryFactory();responsibilityRoute.resetFactories();termRoute.setRepositoryFactory(null);dataRoute.resetProcessDataGovernanceRepositoryFactory();await appPool.end();}
},{stage:'84',randomDatabase:true});}
main().catch(error=>{const failure={code:error.code,message:error.message,stack:error.stack};fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify(failure,null,2));console.error(JSON.stringify(failure));process.exitCode=1;});
