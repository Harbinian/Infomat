// P25 03+12 continuous synthetic chain, executed from a verified candidate layout.
// New artifacts --output only; owned tmpfs/UUID MySQL, random loopback HTTP, Edge desktop,
// own worker and in-memory synthetic backup/restore. No private config/formal data/notifications.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {fork}=require('node:child_process'),{once}=require('node:events');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const nativeV8=process.argv.includes('--native-v8');
const formatLabel=nativeV8?'V8':'V7';
const output=path.resolve(process.argv[process.argv.indexOf('--output')+1]||'');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});
const checks=[],uuid=()=>crypto.randomUUID(),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
function playwright(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function main(){
  for(const key of ['PROCESS_V7_PREVIEW_ENABLED','PROCESS_V7_FORMAL_ENABLED','PROCESS_V7_AUTHORING_ENABLED','MDM_SYSTEM_ADMIN_ENABLED'])process.env[key]='1';
  await withStage05Fixture(async({pool,fixture,expect,backup,restore})=>{
    const clients={};
    async function call(who,url,method='GET',body,status=200){
      const c=clients[who]||(clients[who]={});
      const response=await fetch(fixture.baseURL+url,{method,headers:{'Content-Type':'application/json',Cookie:c.cookie||'',...(c.csrf?{'X-CSRF-Token':c.csrf}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
      if(response.headers.get('set-cookie'))c.cookie=response.headers.get('set-cookie').split(';')[0];
      const result=await response.json();assert.equal(response.status,status,who+' '+url+' '+(result.code||''));return result;
    }
    async function login(who,name,password){await call(who,'/api/org/login','POST',{loginName:name,password});clients[who].csrf=(await call(who,'/api/csrf-token')).csrfToken;}
    const lead={personId:82,accountId:182,authVersion:1},contact={personId:83,accountId:183,authVersion:1};
    const repo=require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository(pool);
    const browser=await playwright().chromium.launch({channel:'msedge',headless:true});
    let worker;const workerEvents=[];
    try{
      const health=await (await fetch(fixture.baseURL+'/api/health')).json();
      await check('candidate HTTP health and compiled asset bytes bind to packaged source; server source is not public',async()=>{
        assert.equal(health.version.sourceDigest,require('../server/runtimeVersion').runtimeVersion().sourceDigest);
        const dist=path.resolve(__dirname,'../frontend/dist'),index=fs.readFileSync(path.join(dist,'index.html'),'utf8');
        const asset=index.match(/src="(\/app\/assets\/[^\"]+\.js)"/)[1];
        const response=await fetch(fixture.baseURL+asset);assert.equal(response.status,200);assert.equal(hash(Buffer.from(await response.arrayBuffer())),hash(fs.readFileSync(path.join(dist,asset.slice('/app/'.length)))));
        for(const url of ['/server/index.js','/manifest.json','/package-lock.json'])assert.equal((await fetch(fixture.baseURL+url)).status,404);
        save('candidate-health.json',{...health,compiledAsset:asset,compiledAssetDigestMatches:true,serverSourceNotPublic:true});
      });
      await check('same candidate: independent system admin first-password gate, revoked session and separate governance person',async()=>{
        const password=crypto.randomBytes(24).toString('base64url')+'9a',updated=crypto.randomBytes(24).toString('base64url')+'7a';
        await require('../server/systemAdminIdentity').bootstrapSystemAdmin(pool,{passwordHash:require('../server/auth').hashPassword(password),authorizationBasis:'P25 owned synthetic chain only'});
        const page=await browser.newPage({viewport:{width:1699,height:828},deviceScaleFactor:1});
        let protectedReads=0;page.on('request',r=>{if(new URL(r.url()).pathname==='/api/org/accounts')protectedReads++;});
        await page.goto(fixture.baseURL+'/app/accounts');await page.locator('#login-name').fill('admin');await page.locator('#login-password').fill(password);await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByRole('heading',{name:'请先完成首次改密',exact:true}).waitFor();
        assert.equal(protectedReads,0);assert.equal(await page.evaluate(()=>visualViewport.scale),1);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
        await page.screenshot({path:path.join(output,'admin-gate-desktop.png')});await page.close();
        await login('sys','admin',password);const me=await call('sys','/api/org/me');assert.equal(me.personId,null);assert.equal(me.identityKind,'system_admin');
        await call('sys','/api/org/accounts','GET',undefined,403);
        await call('sys','/api/org/me/password','POST',{current_password:password,new_password:updated});await call('sys','/api/org/me','GET',undefined,401);
        await login('sys','admin',updated);assert.equal((await call('sys','/api/org/me/password-status')).is_default_password,false);
        await call('sys','/api/process-v7-preview/cases','POST',{document:fixture.document,source_file_name:'must-not-import.json'},403);
        await login('lead','SYNTHETIC_lead',fixture.loginPassword);const person=await call('lead','/api/org/me');assert.equal(Number(person.personId),82);assert.equal(Number(person.accountId),182);assert(person.roleCodes.includes('mdm_lead'));assert.notEqual(person.identityKind,'system_admin');
      });
      for(const [personId,who] of [[89,'compiler'],[90,'peer']]){
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,91)',[personId,'SYNTHETIC_'+who,'合成'+who]);
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)",[personId+100,personId,'SYNTHETIC_'+who,require('../server/auth').hashPassword(fixture.loginPassword)]);
        await login(who,'SYNTHETIC_'+who,fixture.loginPassword);
      }
      const bind=d=>({expected_revision_no:d.case.current_revision_no,expected_content_hash:d.case.current_content_hash,expected_assignment_version:d.authoring.assignment_version});
      let detail,version,source,object,field,objectMap,fieldMap,handoff;
      await check(`one ${formatLabel} case: ordinary contact uploads, explicit roleless compiler handles and submits; separate review/publish authority`,async()=>{
        const document=structuredClone(fixture.document);document.process.process_ref='p25_continuous_synthetic';
        document.data_objects=[{data_ref:'data_record',data_name:'合成固定记录',description:'连续技术链的非敏感记录',information_type:'business_conclusion',
          fields:[{field_ref:'field_record_id',field_name:'记录编号',field_type:'文本',definition:'合成编号'}],
          behavior_links:[{link_ref:'link_create',behavior_ref:'behavior_prepare',operation:'create',updated_field_refs:[]},{link_ref:'link_use',behavior_ref:'behavior_receive',operation:'use',updated_field_refs:[]}],source_relations:[],
          lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
        document.behaviors.push({...document.behaviors[0],behavior_ref:'behavior_isolated',behavior_name:'合成孤立行为待核实'});
        if(nativeV8){document.behaviors[1].node_type='decision';document.data_objects[0].behavior_links.push({link_ref:'link_decision_use',behavior_ref:'behavior_check',operation:'use',updated_field_refs:[]});}
        const imported=await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'p25-continuous-synthetic.json'},201);
        const url='/api/process-v7-preview/cases/'+imported.case.id;detail=await expect('contact',url,'GET');
        await expect('contact',url+'/authoring-records','POST',{...bind(detail),record_kind:'transfer',recipient_person_id:'89',content:'合成归口人员明确指定该案例编制者',request_key:uuid()});
        detail=await call('compiler',url);
        await call('compiler',url+'/authoring-records','POST',{...bind(detail),record_kind:'governance_suggestion',content:'仅登记编制依据，不原地编辑流程正文',request_key:uuid()});detail=await call('compiler',url);
        for(const item of detail.items){await call('compiler','/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind(detail),decision:'confirmed',basis:'合成归口事实核对'});await expect('reviewB','/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind(detail),decision:'confirmed',basis:'合成承接事实核对'});}
        detail=await call('compiler',url);const promotion=await expect('lead',url+'/promote','POST',{...bind(detail),target:{mode:'create',document_no:'SYN-P25-CONTINUOUS',document_title:'合成连续链路'}},201);
        const formal={expected_revision_no:promotion.draft.revision_no,expected_content_hash:promotion.draft.content_hash};
        await expect('contact','/api/process-design/drafts/'+promotion.draft.id+'/submit','POST',formal,403);
        await call('compiler','/api/process-design/drafts/'+promotion.draft.id+'/submit','POST',formal);detail=await call('compiler',url);
        const decision={...formal,decision:'approve',note:'合成有权独立正式审核'};
        await call('compiler','/api/process-design/review-tasks/'+detail.formal_promotion.review_task.id+'/decision','POST',decision,403);
        await expect('reviewA','/api/process-design/review-tasks/'+detail.formal_promotion.review_task.id+'/decision','POST',decision);
        await call('compiler','/api/process-design/drafts/'+promotion.draft.id+'/publish','POST',formal,403);
        version=await expect('lead','/api/process-design/drafts/'+promotion.draft.id+'/publish','POST',formal);detail=await call('compiler',url);
        const fixed=await expect('lead','/api/process-design/versions/'+version.process_version_id+'/content','GET');assert.deepEqual(fixed.document,document);assert.equal(fixed.schema_version,nativeV8?'process-governance-v8':'process-governance-v7');
      });
      if(nativeV8)await check('published native V8: explicit work package creation, retry and read-only admin preserve fixed source',async()=>{
        const base='/api/process-data-governance';const before=await expect('lead',base+'/workbench');assert(before.published_versions.some(v=>v.process_version_id===version.process_version_id));assert(before.feature.supported_schema_versions.includes('process-governance-v8'));
        await expect('admin',base+'/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},403);
        const created=await expect('lead',base+'/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},201);assert(created.package);assert.equal((await expect('lead',base+'/work-packages/'+created.package.id)).source_version.schema_version,'process-governance-v8');
        const retried=await expect('lead',base+'/creation-tasks/reconcile','POST',{process_version_id:version.process_version_id},201);assert.equal(retried.package.id,created.package.id);assert.equal(retried.package.source_content_hash,detail.case.current_content_hash);
        save('v8-work-package.json',{created,retried,automaticCreation:false});
      });
      const db=await pool.getConnection();try{
        for(const [module,action] of [['dataMapDefinitionMigration','applyDefinitions'],['v7MappingMigration','applyV7Mappings'],['designHandoffMigration','applyDesignHandoffs'],['analysisRunMigration','applyAnalysisRuns'],['analysisQueueMigration','applyAnalysisQueue'],['analysisIssueMigration','applyAnalysisIssues']])await require('../server/'+module)[action](db);
        await require('../server/officeSchema').manageOfficeSchema(db,'apply');await require('../server/analysisTaskMigration').applyAnalysisTasks(db);await require('../server/analysisClosureMigration').applyAnalysisClosure(db);
      }finally{db.release();}
      await check(`same published ${formatLabel}: fixed object/field definitions, explicit mappings and relation preserve exact historical references`,async()=>{
        const define=b=>expect('contact','/api/data-map-definitions/save','POST',{request_id:uuid(),...b});
        object=await define({entity_type:'object',definition:{name:'合成固定记录',business_meaning:'非正式主数据认定的合成对象'}});
        field=await define({entity_type:'field',object_id:object.entity_id,object_version_id:object.version_id,definition:{name:'记录编号',data_type:'text',required:true,enum_values:[]}});
        source=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'published_version',process_version_id:String(version.process_version_id)});
        const map=(s,b,who='lead',status=200)=>expect(who,'/api/v7-mappings/sources/'+s+'/mappings','POST',{request_id:uuid(),...b},status);
        const base={source_digest:require('../server/processV7PreviewReview').contentHash(detail.revision.document),local_object_ref:'data_record',local_field_ref:null,object_version_id:object.version_id,field_version_id:null,expected_revision:0,status:'confirmed',basis:'合成固定定义逐项对照'};
        await map(source.source_id,base,'admin',403);objectMap=await map(source.source_id,base);
        fieldMap=await map(source.source_id,{...base,local_field_ref:'field_record_id',field_version_id:field.version_id});
        const receiver=structuredClone(detail.revision.document);receiver.process.process_ref='p25_continuous_receiver';receiver.process.process_name='合成接收流程';
        const bytes=Buffer.from(JSON.stringify(receiver));const target=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'uploaded_material',original_name:'p25-continuous-receiver.json'},bytes);
        const targetBase={...base,source_digest:require('../server/processV7PreviewReview').contentHash(receiver)};
        const targetObject=await map(target.source_id,targetBase),targetField=await map(target.source_id,{...targetBase,local_field_ref:'field_record_id',field_version_id:field.version_id});
        const definition={title:'合成固定记录交付与接收',claim_status:'human_confirmed',source:{mapping_version_id:objectMap.mapping_version_id,behavior_ref:'behavior_prepare',operations:['produce','deliver']},target:{mapping_version_id:targetObject.mapping_version_id,behavior_ref:'behavior_receive',operations:['receive','use']},identifier_kind:'single',identity_rule:'合成编号按明确规则对应',identity_basis:'合成对照说明',delivery_condition:'合成记录齐备',reception_requirement:'合成编号核对后接收，未执行实际接收',evidence:[{side:'source',locator:'合成来源第一行',note:'合成说明'},{side:'target',locator:'合成接收第一行',note:'合成说明'}],pairs:[{source_mapping_version_id:fieldMap.mapping_version_id,target_mapping_version_id:targetField.mapping_version_id,identifier:true,checks:Object.fromEntries(['field','format','enum','unit','version'].map(k=>[k,{mode:'same',rule:'',basis:'合成'+k+'核对依据'}]))}]};
        const payload={request_id:uuid(),handoff_id:null,expected_revision:0,definition};
        handoff=await expect('lead','/api/design-handoffs','POST',payload);
        assert.deepEqual(await expect('lead','/api/design-handoffs','POST',payload),handoff);
        await expect('lead','/api/design-handoffs','POST',{...payload,definition:{...definition,title:'同键异内容'}},409);
        await expect('admin','/api/design-handoffs','POST',{...payload,request_id:uuid()},403);
        const renamed=await define({entity_type:'field',entity_id:field.entity_id,object_id:object.entity_id,object_version_id:object.version_id,expected_revision:1,definition:{name:'修订后合成记录编号',data_type:'text'}});
        assert.equal(renamed.entity_id,field.entity_id);
        assert.equal((await expect('lead','/api/data-map-definitions/version/'+field.version_id,'GET')).definition.name,'记录编号');
        save('fixed-definitions-relations.json',{object,field,objectMap,fieldMap,source,target,handoff,syntheticOnly:true,formalIdentityDecision:false,actualReception:false});
      });
      let run,finding,issueId,todo;
      await check(`same published ${formatLabel} source: real isolated worker finding remains pending until explicit human issue association`,async()=>{
        const rules=require('../server/v7AnalysisRules');
        run=await repo.createAnalysisRun(lead,{request_id:uuid(),inputs:[{input_key:'source',kind:'v7_source',ref_id:source.source_id}],check_scope:{description:'合成单案例确定性分析',check_ids:rules.CHECKS},rule_version:rules.VERSION,parser_versions:{[rules.PARSER]:rules.VERSION},steps:[{step_key:'v7',parser_key:rules.PARSER,input_keys:['source'],check_ids:rules.CHECKS}]});
        await repo.enqueueAnalysis(lead,{request_id:uuid(),run_id:run.run_id,policy:{lease_ms:5000,timeout_ms:20000}});
        const c=pool.pool.config.connectionConfig;
        worker=fork(path.join(__dirname,'analysis-worker.js'),['start','--target',`${c.host}:${c.port}/${c.database}`],{cwd:path.resolve(__dirname,'..'),env:isolatedEnvironment({MYSQL_HOST:c.host,MYSQL_PORT:String(c.port),MYSQL_USER:c.user,MYSQL_PASSWORD:c.password,MYSQL_DATABASE:c.database,PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1'}),silent:true,windowsHide:true,execArgv:[]});
        worker.stdout.on('data',b=>{for(const line of String(b).trim().split('\n')){try{workerEvents.push(JSON.parse(line));}catch{}}});
        const end=Date.now()+45000;do{run=await repo.getAnalysisRun(lead,run.run_id);if(['succeeded','partial','failed'].includes(run.status))break;await sleep(100);}while(Date.now()<end);
        save('worker-observation.json',run);assert.equal(run.status,'succeeded');const attempt=run.attempts.find(a=>a.findings.some(f=>f.rule_id==='v7.isolated'));assert(attempt);
        finding=attempt.findings.find(f=>f.rule_id==='v7.isolated');assert.equal(finding.issue_id,null);assert.equal(finding.verification_status,'pending_verification');
        const evidence=attempt.evidence.filter(e=>finding.evidence_keys.includes(e.evidence_key));assert(evidence.length);
        const linked=await repo.decideAnalysisFinding(lead,{request_id:uuid(),run_id:run.run_id,finding_id:finding.finding_id,expected_revision:1,action:'create',title:'合成孤立行为依据待核实',owner_department_id:'91',owner_basis:'明确合成归口',reason:'合成人工核对后关联原问题',evidence_ids:evidence.map(e=>e.evidence_id)});issueId=linked.issue_id;
        save('worker-result.json',run);
      });
      await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (19,'SYNTHETIC_OFFICE','合成核实办公室','office',91,83)");
      await pool.execute("INSERT INTO office_membership(office_id,person_id,status) VALUES (19,89,'active')");
      if(nativeV8)await check('office tasks bind the published native V8 version and exact behavior without new authority',async()=>{
        await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (20,'SYNTHETIC_V8_OFFICE','合成V8版本办公室','office',91,83)");
        const body={request_id:uuid(),office_id:20,content:'合成V8固定版本任务',process_version_id:version.process_version_id,behavior_ref:'behavior_check'};
        await expect('admin','/api/offices/tasks','POST',body,403);const task=await expect('lead','/api/offices/tasks','POST',body,201);const [[bound]]=await pool.execute('SELECT process_version_id,behavior_ref FROM mdm_todo_office_assignments WHERE todo_id=?',[task.id]);assert.equal(Number(bound.process_version_id),version.process_version_id);assert.equal(bound.behavior_ref,'behavior_check');save('v8-office-version.json',{task,bound});
      });
      await check('same issue: compiler replies in Edge; valid office member completes separately without closing the issue',async()=>{
        const state=await repo.getAnalysisIssueTasks(lead,issueId);
        todo=await repo.dispatchAnalysisIssueTask(lead,{request_id:uuid(),issue_id:issueId,expected_revision:state.revision_no,expected_issue_digest:state.issue_digest,office_id:'19',purpose:'correct',round_no:1,instruction:'合成核对孤立行为声明依据'});
        await expect('contact','/api/offices/tasks/'+todo.todo_id+'/assign','POST',{assignee_person_id:89,expected_revision:1});
        const base='/api/process-v7-preview/cases/'+detail.case.id+'/authoring-issues';
        const visible=(await call('compiler',base)).items.find(i=>i.issue_id===issueId);assert(visible.can_reply);assert.equal(visible.fixed_sources[0].source_ref.process_version_id,String(version.process_version_id));
        await call('peer',base,'GET',undefined,403);
        const page=await browser.newPage({viewport:{width:1699,height:828},deviceScaleFactor:1}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        await page.goto(fixture.baseURL+'/app/process-preview?case='+detail.case.id);await page.locator('#login-name').fill('SYNTHETIC_compiler');await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();await page.getByRole('button',{name:'答复任务'+todo.todo_id,exact:true}).click();
        await page.getByLabel('问题答复',{exact:true}).fill('合成编制者补充孤立行为依据，仅答复，不办结不关闭');await page.getByRole('button',{name:'保存问题答复',exact:true}).click();
        await page.getByText(/答复已保存到原问题历史/).waitFor();assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
        // A saved notice precedes the asynchronous case read; capture settled content.
        const nativeVersion = page.getByText(new RegExp((nativeV8?'process-governance-v8':'process-governance-v7')+' · 当前修订'));
        await nativeVersion.waitFor();await nativeVersion.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,'native-preview-desktop.png')});
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();
        const sourceScope = page.getByText(/仅显示固定流程证据全部属于本案例/);
        await sourceScope.waitFor();await sourceScope.scrollIntoViewIfNeeded();
        await page.screenshot({path:path.join(output,'compiler-reply-desktop.png')});
        assert.equal((await repo.getAnalysisIssueTasks(lead,issueId)).items[0].status,'pending');
        await page.goto(fixture.baseURL+'/app/offices?office_id=19');
        await page.locator('#office-task-'+todo.todo_id).getByText('流程编制者答复',{exact:true}).waitFor();
        assert.equal((await call('compiler','/api/offices/workbench?office_id=19')).tasks[0].analysis_task.compiler_replies.length,1);
        await page.getByRole('button',{name:'填写结果并办结 '+todo.todo_id,exact:true}).click();
        await page.getByLabel('办理结果',{exact:true}).fill('合成独立办理证据：孤立行为已核对');
        const completion=page.waitForResponse(r=>r.url().endsWith('/api/offices/tasks/'+todo.todo_id+'/complete')&&r.request().method()==='POST');
        await page.getByRole('button',{name:'确认提交本次操作',exact:true}).click();assert.equal((await completion).status(),200);
        await page.getByText(/办结时间：/).waitFor();assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
        await page.screenshot({path:path.join(output,'office-completion-desktop.png')});await page.close();
        assert.equal((await repo.getAnalysisIssue(lead,issueId)).issue.display_status,'waiting_my_action');
      });
      await check('same issue: authorized responsible person designates a qualified independent reviewer; only that reviewer closes',async()=>{
        await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
        await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 89,role_id,'global','synthetic exclusion check',CURRENT_DATE FROM roles WHERE role_code='data_quality_auditor'");
        let state=await repo.getAnalysisIssueClosure(contact,issueId);assert(state.candidates.some(p=>p.person_id==='82'));assert(!state.candidates.some(p=>p.person_id==='89'));
        const bind=s=>({request_id:uuid(),expected_revision:s.revision_no,expected_issue_digest:s.issue_digest,expected_context_digest:s.context_digest});
        const url='/api/analysis/issues/'+issueId+'/review',designate={...bind(state),action:'designate',reviewer_person_id:'82',conditions:['孤立行为已核对'],reason:'合成有权主体明确指定'};
        await call('compiler',url,'POST',designate,404);await expect('contact',url,'POST',designate);
        state=await repo.getAnalysisIssueClosure(contact,issueId);
        const close={...bind(state),action:'review',reason:'合成独立复核',checks:state.assignment.conditions.map(c=>({condition_id:c.condition_id,satisfied:true,basis:'独立核对办理证据',todo_id:todo.todo_id,task_revision:3,excerpt:'孤立行为已核对'}))};
        await call('compiler',url,'POST',close,404);await expect('contact',url,'POST',close,404);await expect('lead',url,'POST',close);
        assert.equal((await repo.getAnalysisIssueClosure(contact,issueId)).status,'closed');
      });
      await check('same fixed chain: changed formal source blocks new mapping; existing run/definition history stays unchanged and restores',async()=>{
        const historical=await repo.getAnalysisRun(lead,run.run_id),[[original]]=await pool.execute('SELECT content_hash FROM process_design_versions WHERE id=?',[version.process_version_id]);
        try{
          await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=?',['f'.repeat(64),version.process_version_id]);
          await expect('lead','/api/v7-mappings/sources/'+source.source_id+'/mappings','POST',{request_id:uuid(),source_digest:original.content_hash,local_object_ref:'data_record',local_field_ref:null,object_version_id:object.version_id,field_version_id:null,expected_revision:1,status:'confirmed',basis:'合成变更来源拒写'},409);
        }finally{await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=?',[original.content_hash,version.process_version_id]);}
        assert.deepEqual(await repo.getAnalysisRun(lead,run.run_id),historical);
        assert.equal((await expect('lead','/api/data-map-definitions/version/'+field.version_id,'GET')).definition.name,'记录编号');
      });
      if(worker&&worker.exitCode===null){const ended=once(worker,'exit');worker.send('stop');const timer=setTimeout(()=>worker.kill(),10000);await ended;clearTimeout(timer);}
      save('worker-events.json',workerEvents);
      async function snapshot(){
        const tables=(await pool.query('SHOW TABLES'))[0].map(r=>Object.values(r)[0]).sort(),result={};
        for(const table of tables){assert.match(table,/^[a-z0-9_]+$/i);const rows=(await pool.query('SELECT * FROM `'+table+'`'))[0];result[table]={rows:rows.length,sha256:hash(JSON.stringify(rows.map(r=>JSON.stringify(r)).sort()))};}
        return result;
      }
      await check('synthetic full backup restores password state, identities, fixed IDs/JSON/versions, source/run, issue/task/closure and audit rows',async()=>{
        const before=await snapshot(),dump=backup();
        await pool.execute('UPDATE system_admin_accounts SET auth_version=auth_version+1');await pool.execute("UPDATE process_governance_issues SET display_status='waiting_my_action' WHERE issue_id=?",[issueId]);
        assert.notDeepEqual(await snapshot(),before);restore(dump);assert.deepEqual(await snapshot(),before);
        save('synthetic-restore.json',{syntheticOnly:true,backupBytes:dump.length,backupSha256:hash(dump),fullTableDigests:before,afterRestoreMatches:true,actualTargetRecoveryVerified:false});
      });
      save('chain.json',{syntheticOnly:true,sameCase:true,case_id:detail.case.id,revision_id:detail.case.current_revision_id,content_hash:detail.case.current_content_hash,schema_version:detail.revision.document.schema_version,process_version_id:version.process_version_id,source_id:source.source_id,run_id:run.run_id,finding_id:finding.finding_id,issue_id:issueId,todo_id:todo.todo_id,compiler_person_id:89,office_id:19,reviewer_person_id:82,closure_status:'closed',realWorker:true});
      save('results.json',{passed:true,checks,sourceDigest:health.version.sourceDigest,scope:'one continuous synthetic '+(nativeV8?'V8':'V7')+' chain; not actual target enablement or business acceptance'});
    }finally{
      if(worker&&worker.exitCode===null){const ended=once(worker,'exit');worker.send('stop');const timer=setTimeout(()=>worker.kill(),10000);await ended;clearTimeout(timer);}
      await browser.close();save('cleanup.json',{browserClosed:true,workerStopped:!worker||worker.exitCode!==null||worker.signalCode!==null});
    }
  },{authoring:true,systemAdmin:true,randomDatabase:true,evidenceDir:output,...(nativeV8?{createDocument:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-v8.json'),'utf8')),processDataGovernanceVersionId:77}:{createDocument:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-v7.json'),'utf8'))})});
}
main().catch(e=>{save('failure.json',{message:e.message,stack:e.stack,checks});console.error(e.message);process.exitCode=1;});
