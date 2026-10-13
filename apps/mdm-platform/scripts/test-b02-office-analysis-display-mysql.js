// Input: --output <new direct child of this dispatch>. Output: evidence JSON.
// Only reviewed freshMysql creates mysql:8.4 --pull never with UUID/tmpfs and
// random 127.0.0.1 port. Select existing CREATE statements in its empty database;
// all fixture inserts/updates are synthetic. No migration entry, private config,
// default DB, HTTP server, worker, AI, notification or browser is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {makeOfficeRepository}=require('../server/officeRepository');
const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
const {ROLE_GUIDES,ACCESS_MODEL_VERSION}=require('../server/roleDefinitions');
const {digest,json}=require('../server/dataMapDefinitionValues');
const {contentHash}=require('../server/processPreviewReview');
const reply=require('../server/authoringReplyEvent');
const run=path.resolve(__dirname,'../../../artifacts/mdm-3000-upgrade-20260916/p00-20260916-120151/evidence/p25/architecture-first-plan-20261008-01/runs/B02-20261009-051831-63b2cd4a');
const index=process.argv.indexOf('--output'),output=path.resolve(index<0?'':process.argv[index+1]);
assert(index>=0&&path.dirname(output)===run&&!fs.existsSync(output));fs.mkdirSync(output);
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sourceBaseline=JSON.parse(fs.readFileSync(path.join(run,'source-baseline.json'),'utf8'));
const originalEntry=sourceBaseline.files.find(f=>f.path==='apps/mdm-platform/server/officeAnalysisTasks.js');
assert.equal(originalEntry.sha256,'6b788bba19311efe17f7329fce5e4cb592526ff8b8581b0dc4f8228588045df1');
assert.equal(sha(fs.readFileSync(originalEntry.snapshot)),originalEntry.sha256);
const originalDecorator=new Module(require.resolve('../server/officeAnalysisTasks'),module);originalDecorator.filename=require.resolve('../server/officeAnalysisTasks');originalDecorator.paths=Module._nodeModulePaths(path.dirname(originalDecorator.filename));originalDecorator._compile(fs.readFileSync(originalEntry.snapshot,'utf8'),originalDecorator.filename);
const beforeModule=new Module(require.resolve('../server/officeRepository'),module);beforeModule.filename=require.resolve('../server/officeRepository');beforeModule.paths=Module._nodeModulePaths(path.dirname(beforeModule.filename));
const nativeRequire=beforeModule.require.bind(beforeModule);beforeModule.require=name=>name==='./officeAnalysisTasks'?originalDecorator.exports:nativeRequire(name);beforeModule._compile(fs.readFileSync(beforeModule.filename,'utf8'),beforeModule.filename);
const P='9007199254740992',N='9007199254740993',U='9007199254740994',X='9007199254740995',D='9007199254741001',D2='9007199254741002';
const O='9007199254741100',O2='9007199254741101',EMPTY='9007199254741102';
const T='9007199254741800',T2='9007199254741801',SECRET='9007199254741803',I='9007199254741900',I2='9007199254741901';
const denial={code:'OFFICE_ACCESS_DENIED',statusCode:403,message:'当前登录状态已变化或需要修改密码，请重新登录处理。'};
const conflict={code:'DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT',statusCode:409,message:'DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT'};
const checks=[],operations=[],negatives=[],limits=[];let target,helperReturned=false;
const people=[{personId:P,accountId:'9007199254741300',authVersion:'9007199254741400',dept:D},{personId:N,accountId:'9007199254741301',authVersion:'9007199254741401',dept:D2},
  {personId:U,accountId:'9007199254741302',authVersion:1,dept:D},{personId:X,accountId:'9007199254741303',authVersion:1,dept:D2},
  {personId:7,accountId:107,authVersion:1,dept:91},{personId:81,accountId:181,authVersion:1,dept:91,roles:['mdm_lead']},
  {personId:82,accountId:182,authVersion:1,dept:91,roles:['admin']},{personId:83,accountId:183,authVersion:1,dept:91,roles:['admin','mdm_lead']}];
const actor=id=>({...people.find(p=>String(p.personId)===String(id))});
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){try{await withFreshMysql(async context=>{
  const {pool,port,containerId,owner,database}=context;target={owner,database,containerId,port,host:'127.0.0.1',stage:'02',image:'mysql:8.4',pull:'never',storage:'UUID tmpfs'};save('owned-target.json',target);
  const ddl=new Map(splitSqlStatements(mdmMysqlSchemaSql()).map(sql=>[sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1],sql]));
  for(const sql of [...splitSqlStatements(require('../server/processV7PreviewReviewMigration').PROCESS_V7_PREVIEW_SCHEMA_SQL),...splitSqlStatements(require('../server/processV7AuthoringMigration').SCHEMA_SQL),...require('../server/analysisIssueSchema').statements(),...require('../server/analysisTaskSchema').statements()])ddl.set(sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1],sql);
  const created=new Set(),casts=new Map();
  async function create(table){if(created.has(table))return;assert(ddl.has(table),'existing DDL '+table);created.add(table);const sql=ddl.get(table);
    for(const m of sql.matchAll(/REFERENCES\s+(\w+)\s*\(/g))if(m[1]!==table)await create(m[1]);await pool.query(sql);
    const [columns]=await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','timestamp','datetime') ORDER BY ORDINAL_POSITION",[table]);
    casts.set(table,columns.map(c=>'CAST(`'+c.COLUMN_NAME+'` AS CHAR) AS `'+c.COLUMN_NAME+'`').join(','));
  }
  async function physical(){const state={};for(const table of [...created].sort())state[table]=(await pool.query('SELECT *'+(casts.get(table)?','+casts.get(table):'')+' FROM `'+table+'` ORDER BY 1'))[0];return state;}
  for(const table of ['departments','person','user_accounts','roles','permissions','role_permissions','person_roles','office_membership','mdm_todo_office_assignments','mdm_todo_events'])await create(table);
  // Seeds copy only the existing fixed role model into this owned empty fixture.
  // No authorization/maintenance helper is called.
  for(const role of ROLE_GUIDES){await pool.execute('INSERT INTO roles(role_code,role_name,model_version,role_group) VALUES (?,?,?,?)',[role.code,role.name,ACCESS_MODEL_VERSION,role.code==='admin'?'system':'mdm']);
    for(const perm of role.permissions){await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action) VALUES (?,?,?)',[perm.code,perm.resource,perm.action]);
      await pool.execute('INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,\'allow\' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?',[perm.code,role.code]);}}
  for(const dept of ['91',D,D2])await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (?,?,?,?)',[dept,'D'+dept,'D'+dept,'/'+dept+'/']);
  for(const a of people){await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[String(a.personId),'P'+a.personId,'synthetic '+a.personId,String(a.dept)]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-unused','active',0,?)",[String(a.accountId),String(a.personId),'P'+a.personId,String(a.authVersion)]);
    for(const role of a.roles||[])await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','B02 synthetic fixture',CURRENT_DATE FROM roles WHERE role_code=?",[String(a.personId),role]);}
  for(const [id,manager,dept]of [[O,P,D],[O2,N,D2],[EMPTY,P,D],[17,7,91]])await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (?,?,?,'office',?,?)",[String(id),'O'+id,'O'+id,String(dept),String(manager)]);
  for(const [office,person]of [[O,P],[O,N],[O,U],[O2,N],[17,7]])await pool.execute('INSERT INTO office_membership(office_id,person_id) VALUES (?,?)',[String(office),String(person)]);
  const versions=[];for(const [format,id]of [['v8','9007199254743000'],['v7','9007199254743001']]){
    const body=fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json'),'utf8'),document=JSON.parse(body),hash=contentHash(document);
    await pool.execute('INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id) VALUES (?,?,?,?)',[id,'B02-'+format,'B02 '+format,D]);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES (?,?,?,?,'A','synthetic','synthetic','synthetic','synthetic',?)",[id,id,'B02-'+format,'B02 '+format,D]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status) VALUES (?,?,?,?,?,'A',?,?,?,?,?,7,'published')",[id,id,id,'B02-'+format,'B02 '+format,'B02-'+format+':A',D,document.schema_version,body,hash]);versions.push({id,body,hash,schema:document.schema_version});
  }
  async function todo(id,office,assignee,version=null){await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,content) VALUES (?,?,'office_work',?)",[String(id),office===O2?D2:office===17?'91':D,'minimal instruction '+id]);
    await pool.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assignee_person_id,process_version_id,assigned_by_person_id,request_id,revision_no) VALUES (?,?,?,?,?,?,7)',[String(id),String(office),assignee==null?null:String(assignee),version,P,crypto.randomUUID()]);}
  await todo(T,O,N,versions[0].id);await todo(T2,O,P,versions[1].id);await todo(7,O,null);await todo(SECRET,O2,N,versions[1].id);await todo(17,17,null);
  const legacy='{"record_id":"old-record","revision":7,"unknown":"原JSON\\n保持","nullable":null}';
  await pool.execute("INSERT INTO mdm_todo_events(id,todo_id,event_type,actor_person_id,note) VALUES (7,7,'legacy_imported',?,?)",[P,legacy]);
  let trace=[];
  const observed={};for(const method of ['execute','query'])observed[method]=async(sql,params=[])=>{
    const entry={method,sql,params};trace.push(entry);
    assert.match(sql,/^\s*SELECT\b/i,'display must only select');assert.doesNotMatch(sql,/FOR (UPDATE|SHARE)|GET_LOCK|RELEASE_LOCK/i,'display must not acquire write/transaction locks');
    const result=await pool[method](sql,params);entry.rowCount=Array.isArray(result[0])?result[0].length:null;
    if(sql.includes('FROM mdm_todo_events e JOIN'))entry.replyRows=result[0];
    if(sql.includes('FROM data_map_analysis_issue_tasks WHERE'))entry.linkRows=result[0];return result;
  };
  observed.getConnection=()=>{throw new Error('DISPLAY_TRANSACTION_FORBIDDEN');};
  const repo=makeOfficeRepository(observed),beforeRepo=beforeModule.exports.makeOfficeRepository(observed);
  async function call(label,session,office,repository=repo){const before=await physical();trace=[];let result,error;
    try{result=await repository.workbench(session,office);}catch(e){error=e;}
    assert.deepEqual(await physical(),before,label+' preserves all physical rows');
    operations.push({label,variant:repository===beforeRepo?'input-baseline':'current',session,office:office??null,result,error:error?{code:error.code??null,statusCode:error.statusCode??null,message:error.message,name:error.name}:null,trace});
    if(error)throw error;return result;
  }
  await check('optional table absent preserves raw tasks; empty selected office stays empty',async()=>{
    assert.equal((await call('no-table',actor(U),O)).tasks.length,3);
    assert.deepEqual((await call('empty-tasks-no-table',actor(P),EMPTY)).tasks,[]);
  });
  await create('data_map_analysis_issue_tasks');
  const links=[];
  for(const [todoId,issueId,officeId,format]of [[T,I,O,'v8'],[T2,I2,O,'v7'],[SECRET,'9007199254741902',O2,'v7'],['17','17','17','v7']]){
    await pool.execute("INSERT INTO process_governance_issues(issue_id,issue_key,primary_dept_name,source_type,title,what_text,why_text,where_text,who_text,when_text,how_text,how_much_text) VALUES (?,?,'synthetic','synthetic','synthetic','s','s','s','s','s','s','s')",[issueId,'B02-'+issueId]);
    await pool.execute('INSERT INTO data_map_analysis_issue_bindings(issue_id,owner_department_id,revision_no,issue_digest,created_by_person_id,created_at) VALUES (?,?,7,?,?,UTC_TIMESTAMP(3))',[issueId,officeId===O2?D2:officeId==='17'?'91':D,'a'.repeat(64),P]);
    const snapshot={issue_id:issueId,office_id:officeId,purpose:'verify',round_no:1,issue_revision:7,issue_digest:'a'.repeat(64),instruction:'minimal analysis '+todoId,actor_person_id:P,sources:[{version_id:versions.find(v=>v.schema==='process-governance-'+format).id}]};
    await pool.execute('INSERT INTO data_map_analysis_issue_tasks(todo_id,issue_id,purpose,round_no,snapshot_json,snapshot_digest,created_by_person_id,created_at) VALUES (?,?,\'verify\',1,?,?,?,UTC_TIMESTAMP(3))',[todoId,issueId,json(snapshot),digest(snapshot),P]);links.push({todoId,issueId,officeId,snapshot});
  }
  await check('authoring table absent yields empty replies; unlinked old todo is retained',async()=>{
    const value=await call('no-authoring',actor(P),O);assert.equal(value.tasks.length,3);assert(value.tasks.filter(t=>t.analysis_task).every(t=>t.analysis_task.compiler_replies.length===0));assert(!value.tasks.find(t=>t.id===7).analysis_task);
  });
  for(const table of ['process_v7_preview_revisions','process_v7_authoring_records'])await create(table);
  const replyRows=[];
  for(const [offset,link]of links.entries()){
    const caseId=link.todoId==='17'?'17':String(9007199254742500n+BigInt(offset)),recordId=link.todoId==='17'?'17':String(9007199254742600n+BigInt(offset));
    const eventId=link.todoId==='17'?'17':String(9007199254742700n+BigInt(offset)),version=versions[offset===0?0:1],compiler=link.todoId==='17'?'7':N;
    await pool.execute("INSERT INTO process_v7_preview_cases(id,case_ref,process_ref,process_name,owning_department_id,current_revision_no,current_revision_id,current_content_hash,blocking_issues_json) VALUES (?,?,?,?,?,7,?,?, '[]')",[caseId,'case-'+caseId,'process-'+caseId,'synthetic',link.officeId==='17'?'91':D,caseId,version.hash]);
    await pool.execute('INSERT INTO process_v7_preview_revisions(id,case_id,revision_no,source_file_name,source_schema_version,content_hash,content_json) VALUES (?,?,7,?,?,?,?)',[caseId,caseId,'synthetic.json',version.schema,version.hash,version.body]);
    const content='original reply '+link.todoId;
    await pool.execute("INSERT INTO process_v7_authoring_records(id,case_id,request_key,request_hash,record_kind,content_text,actor_person_id,revision_no,content_hash,assignment_version) VALUES (?,?,?,?,'problem_reply',?,?,7,?,7)",[recordId,caseId,'reply-'+recordId,'b'.repeat(64),content,compiler,version.hash]);
    const payload=reply.issuePayload({recordId,caseId,requestKey:'reply-'+recordId,reference:{issue_id:link.issueId,todo_id:link.todoId,expected_task_revision:7},revisionNo:7,contentHash:version.hash,actorPersonId:compiler,fixedSources:[{process_version_id:version.id,content_hash:version.hash}]});
    const note=JSON.stringify({...reply.officeNote(payload,content),unknown:{legacy:null,escaped:'original\nvalue'}});
    await pool.execute("INSERT INTO mdm_todo_events(id,todo_id,event_type,actor_person_id,note) VALUES (?,?,'compiler_replied',?,?)",[eventId,link.todoId,compiler,note]);replyRows.push({eventId,recordId,caseId,compiler,note,content});
  }
  save('fixture-ddl.json',[...created].map(table=>({table,sql:ddl.get(table),sha256:sha(ddl.get(table))})));
  const finalBefore=await physical(),visible=value=>value.tasks.map(t=>String(t.id)).sort();
  await check('original public small-then-BIGINT display reproduces adjacent reply lookup; current binding keeps exact replies',async()=>{
    await call('baseline-small-number',actor(7),17,beforeRepo);
    await assert.rejects(call('baseline-big-after-small',actor(P),O,beforeRepo),conflict);
    const baseline=operations.at(-1),lookup=baseline.trace.find(q=>q.sql.includes('FROM mdm_todo_events e JOIN')&&q.params[0]===T2);
    assert(lookup);assert.equal(JSON.parse(lookup.replyRows[0].note).todo_id,T);assert.notEqual(JSON.parse(lookup.replyRows[0].note).todo_id,T2);
    await call('baseline-small-before-link',actor(7),17,beforeRepo);
    const lost=await call('baseline-big-link-after-small',actor(N),O2,beforeRepo);
    assert(!lost.tasks[0].analysis_task,'original reused one-parameter link lookup omits odd BIGINT link');
    const missingLink=operations.at(-1);
    const small=await call('fixed-small-number',actor(7),17),big=await call('fixed-big-after-small',actor(P),O);
    assert.equal(small.tasks[0].analysis_task.compiler_replies[0].id,'17');
    for(const [id,expected]of [[T,replyRows[0]],[T2,replyRows[1]]]){const task=big.tasks.find(t=>t.id===id);assert.equal(task.analysis_task.compiler_replies[0].id,expected.eventId);assert.equal(task.analysis_task.compiler_replies[0].content,expected.content);}
    const current=operations.at(-1),smallOperation=operations.at(-2);
    const exact=await call('fixed-big-link-after-small',actor(N),O2);assert.equal(exact.tasks[0].analysis_task.compiler_replies[0].id,replyRows[2].eventId);
    save('binding-before-after.json',{originalDecoratorSha256:originalEntry.sha256,baseline,missingLink,small:smallOperation,current,currentLink:operations.at(-1),originalPublicSmallIdSuppliedNumber:true,syntheticEarlySelectInjected:false});
  });
  await check('manager, assignee, unrelated member and nonmember preserve original data scopes',async()=>{
    assert.deepEqual(visible(await call('manager',actor(P),O)),['7',T,T2].sort());
    const assigned=await call('assignee-cross-department',actor(N),O);assert.deepEqual(visible(assigned),['7',T].sort());assert.equal(assigned.can_assign,false);assert.equal(assigned.tasks.find(t=>t.id===T).analysis_task.compiler_replies[0].content,replyRows[0].content);
    assert.deepEqual(visible(await call('other-member',actor(U),O)),['7']);
    await assert.rejects(call('nonmember-office-denied',actor(X),O),{code:'OFFICE_ACCESS_DENIED',statusCode:403,message:'无权查看该办公室'});
    assert.deepEqual((await call('nonmember-default',actor(X))).tasks,[]);
    for(const op of operations.filter(o=>['assignee-cross-department','other-member','nonmember-office-denied'].includes(o.label))){assert(!op.trace.some(q=>q.sql.includes('FROM mdm_todo_events e JOIN')&&q.params.includes(T2)));assert(!op.trace.some(q=>q.params.includes(SECRET)));}
  });
  await check('global reader, person-admin and admin-overlay retain flags and scope',async()=>{
    for(const id of [81,82,83]){const value=await call('global-'+id,actor(id),O);assert.deepEqual(visible(value),['7',T,T2].sort());assert.equal(value.can_assign,false);
      assert.equal(value.can_complete,id===81);assert.equal(value.can_route,id===81);
      assert.equal((await call('global-other-office-'+id,actor(id),O2)).tasks[0].analysis_task.compiler_replies[0].content,replyRows[2].content);}
  });
  await check('small number/string aliases and adjacent BIGINT sessions remain distinct',async()=>{
    const a=await call('small-number',actor(7),17),b=await call('small-decimal-string',{personId:'0007',accountId:'0107',authVersion:'01'},'0017');assert.deepEqual(a,b);assert.equal(a.tasks[0].id,17);assert.equal(a.tasks[0].analysis_task.compiler_replies[0].id,'17');
    const manager=await call('big-decimal-alias',{...actor(P),personId:'0'+P,accountId:'0'+actor(P).accountId,authVersion:'0'+actor(P).authVersion},O);assert.equal(manager.actor_person_id,P);assert(manager.can_assign);
    await assert.rejects(call('adjacent-account-mismatch',{...actor(P),accountId:actor(N).accountId},O),denial);
    await assert.rejects(call('adjacent-person-mismatch',{...actor(P),personId:N},O),denial);
    await assert.rejects(call('adjacent-auth-version-mismatch',{...actor(P),authVersion:actor(N).authVersion},O),denial);
  });
  await check('null, system-admin, malformed and unsafe-number subjects are denied without material access',async()=>{
    for(const [name,session]of [['system-admin',{identityKind:'system_admin',userId:'system-admin:9',personId:null,accountId:9,authVersion:1}],['null-person',{personId:null,accountId:9,authVersion:1}],['null-account',{...actor(P),accountId:null}],['null-auth',{...actor(P),authVersion:null}],['unsafe-person',{...actor(P),personId:Number(P)}],['unsafe-account',{...actor(P),accountId:Number(actor(P).accountId)}],['unsafe-auth',{...actor(P),authVersion:Number(actor(P).authVersion)}],['invalid-person',{...actor(P),personId:'1e3'}]]){
      await assert.rejects(call(name,session,O),denial);const op=operations.at(-1);assert.equal(op.trace.length,0);negatives.push({name,...op.error});}
    await assert.rejects(call('unsafe-office',actor(P),Number(O)),{code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办公室无效'});
  });
  async function mutate(table,key,keyValue,patch,action){const row=(await physical())[table].find(r=>String(r[key])===String(keyValue));assert(row);
    const fields=Object.keys(patch),set=fields.map(f=>'`'+f+'`=?').join(',');await pool.execute('UPDATE `'+table+'` SET '+set+' WHERE `'+key+'`=?',[...fields.map(f=>patch[f]),String(keyValue)]);
    try{await action();}finally{const restore=[...fields];if(Object.hasOwn(row,'updated_at')&&!restore.includes('updated_at'))restore.push('updated_at');await pool.execute('UPDATE `'+table+'` SET '+restore.map(f=>'`'+f+'`=?').join(',')+' WHERE `'+key+'`=?',[...restore.map(f=>row[f]),String(keyValue)]);}
  }
  await check('current account, password, person and role changes affect each new public read',async()=>{
    for(const [name,table,key,value,patch]of [['disabled','user_accounts','account_id',actor(P).accountId,{account_status:'disabled'}],['password','user_accounts','account_id',actor(P).accountId,{must_change_password:1}],['auth-generation','user_accounts','account_id',actor(P).accountId,{auth_version:'9007199254741402'}],['person-inactive','person','person_id',P,{status:'inactive'}]]){
      await mutate(table,key,value,patch,async()=>{await assert.rejects(call(name,actor(P),O),denial);negatives.push({name,...operations.at(-1).error});});}
    const roles=finalBefore.person_roles.filter(r=>String(r.person_id)==='81');assert.equal(roles.length,1);
    await mutate('person_roles','person_role_id',roles[0].person_role_id,{assignment_status:'revoked'},async()=>{await assert.rejects(call('revoked-global',actor(81),O),{code:'OFFICE_ACCESS_DENIED',statusCode:403,message:'无权查看该办公室'});});
    await mutate('person','person_id',N,{current_department_id:D},async()=>{assert.deepEqual(visible(await call('department-change-original-membership',actor(N),O)),['7',T].sort());});
    await mutate('office_membership','person_id',U,{status:'inactive'},async()=>{await assert.rejects(call('membership-revoked',actor(U),O),{code:'OFFICE_ACCESS_DENIED',statusCode:403,message:'无权查看该办公室'});});
    await mutate('org_unit','org_unit_id',O,{manager_person_id:null},async()=>{assert.deepEqual(visible(await call('null-manager',actor(P),O)),['7',T2].sort());});
  });
  await check('link integrity errors remain exact; hidden members do not consume corrupt instructions',async()=>{
    for(const field of ['issue_id','office_id','purpose','round_no']){const snapshot={...links[0].snapshot,[field]:field==='round_no'?2:field==='issue_id'?I2:field==='office_id'?O2:'correct'};
      await mutate('data_map_analysis_issue_tasks','todo_id',T,{snapshot_json:json(snapshot),snapshot_digest:digest(snapshot)},async()=>{await assert.rejects(call('link-'+field,actor(P),O),conflict);assert.deepEqual(visible(await call('hidden-link-'+field,actor(U),O)),['7']);negatives.push({name:'link-'+field,...operations.at(-2).error});});}
    await mutate('data_map_analysis_issue_tasks','todo_id',T,{snapshot_digest:'c'.repeat(64)},async()=>{await assert.rejects(call('link-digest',actor(P),O),conflict);});
  });
  await check('reply issue/todo/actor/content/source mismatch keeps 409 and unsafe note actors are not recovered',async()=>{
    for(const field of ['source_type','issue_id','todo_id','actor_person_id','content']){
      const note={...JSON.parse(replyRows[0].note),[field]:field==='actor_person_id'?P:field==='issue_id'?I2:field==='todo_id'?T2:'mismatch'};
      await mutate('mdm_todo_events','id',replyRows[0].eventId,{note:JSON.stringify(note)},async()=>{await assert.rejects(call('reply-'+field,actor(P),O),conflict);assert.deepEqual(visible(await call('hidden-reply-'+field,actor(U),O)),['7']);negatives.push({name:'reply-'+field,...operations.at(-2).error});});}
    await mutate('process_v7_authoring_records','id',replyRows[0].recordId,{actor_person_id:P},async()=>{await assert.rejects(call('record-actor-mismatch',actor(P),O),conflict);});
    await mutate('process_v7_authoring_records','id',replyRows[0].recordId,{content_text:'changed record body'},async()=>{await assert.rejects(call('record-content-mismatch',actor(P),O),conflict);});
    const note={...JSON.parse(replyRows[0].note),actor_person_id:Number(N)};
    await mutate('mdm_todo_events','id',replyRows[0].eventId,{note:JSON.stringify(note)},async()=>{await assert.rejects(call('unsafe-note-actor',actor(P),O),conflict);});
  });
  await check('existing join and event actor boundaries are recorded without adding filtering rules',async()=>{
    const note={...JSON.parse(replyRows[0].note),record_id:'missing-record'};
    await mutate('mdm_todo_events','id',replyRows[0].eventId,{note:JSON.stringify(note)},async()=>{const value=await call('unjoined-record-original-empty',actor(P),O);assert.deepEqual(value.tasks.find(t=>t.id===T).analysis_task.compiler_replies,[]);});
    await mutate('mdm_todo_events','id',replyRows[0].eventId,{note:'{'},async()=>{const value=await call('invalid-note-original-empty',actor(P),O);assert.deepEqual(value.tasks.find(t=>t.id===T).analysis_task.compiler_replies,[]);});
    await mutate('mdm_todo_events','id',replyRows[0].eventId,{actor_person_id:P},async()=>{const value=await call('physical-event-actor-original-boundary',actor(P),O);assert.equal(value.tasks.find(t=>t.id===T).analysis_task.compiler_replies[0].content,replyRows[0].content);});
    limits.push('Original query binds note.record_id to authoring record and checks note actor against record actor; physical e.actor_person_id is not selected or compared. No new gate added.','Missing/malformed/unjoined record_id is excluded by the original inner join; malformed event note is not parsed when JSON_VALID rejects it.','Display does not recompute formal source hashes or reauthorize historical compiler eligibility. Immutable sources are preservation checks, not business validation.');
  });
  await check('all physical fields, V8/V7 complete bodies, old IDs/revision/events and JSON remain intact',async()=>{
    assert.deepEqual(await physical(),finalBefore);
    for(const version of versions){const [[row]]=await pool.execute('SELECT CAST(id AS CHAR) id,process_content_json,content_hash,schema_version FROM process_design_versions WHERE id=?',[version.id]);assert.deepEqual(row,{id:version.id,process_content_json:version.body,content_hash:version.hash,schema_version:version.schema});}
    const [[old]]=await pool.execute('SELECT note FROM mdm_todo_events WHERE id=7');assert.equal(old.note,legacy);
    const [[assignment]]=await pool.execute('SELECT revision_no FROM mdm_todo_office_assignments WHERE todo_id=7');assert.equal(assignment.revision_no,7);
    save('preservation.json',{allPhysicalRowsEqual:true,physicalSha256:sha(json(finalBefore)),tables:[...created],versions:versions.map(v=>({...v,bodySha256:sha(v.body),body:undefined})),legacyNote:legacy,replyNotes:replyRows,legacyRevision:7});
  });
  save('operations.json',operations);save('negative-results.json',negatives);save('existing-boundaries.json',limits);
  save('read-only-summary.json',{operations:operations.length,selectStatements:operations.reduce((n,o)=>n+o.trace.length,0),writes:0,ddl:0,transactions:0,explicitLocks:0,allPhysicalComparisonsPassed:true});
},{stage:'02',randomDatabase:true});helperReturned=true;
}catch(error){save('failure.json',{name:error.name,code:error.code??null,message:error.message,stack:error.stack,checks,operations,negatives,target});throw error;
}finally{if(target){const env=require('./testHelpers/isolatedProcess').isolatedEnvironment();const remaining=cp.execFileSync('docker',['ps','-aq','--filter','id='+target.containerId],{env,encoding:'utf8',windowsHide:true,timeout:30000}).trim();
  const portResult=await new Promise(resolve=>{const socket=net.connect(target.port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve('CONNECTED');});socket.once('error',e=>resolve(e.code));socket.setTimeout(1500,()=>{socket.destroy();resolve('TIMEOUT');});});
  save('cleanup.json',{...target,helperReturned,remaining,portResult,passed:remaining===''&&portResult==='ECONNREFUSED'});assert.equal(remaining,'');assert.equal(portResult,'ECONNREFUSED');}}
  save('validation.json',{passed:true,checks,operationCount:operations.length,negativeCount:negatives.length,sourcePatch:'existing identityParam applied to link and reply query bindings only'});console.log('B02_OFFICE_DISPLAY_MYSQL_PASSED '+checks.length);
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
