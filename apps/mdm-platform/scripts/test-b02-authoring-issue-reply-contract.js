// Public repository contract with SQL doubles; real MySQL must be preloaded blocked.
// No HTTP, worker, configuration file, database socket or persistent product write.
const assert=require('node:assert/strict');
const {sessionSubject,identityInteger,sameIdentityInteger}=require('../server/sessionSubject');
const {makeProcessPreviewReviewRepository}=require('../server/processPreviewReviewRepository');
const {digest}=require('../server/dataMapDefinitionValues');
const checks=[];
const actor=session=>{const s=sessionSubject(session);return {identityKind:s.kind,personId:s.kind==='system_admin'?null:identityInteger(s.personId),accountId:identityInteger(s.accountId),authVersion:identityInteger(s.authVersion)};};
const P='9007199254740993',A='9007199254741301',V='9007199254741401';
function fixture({subject=actor({personId:7,accountId:107,authVersion:1}),dept='91',compiler='7',grants=[],account=true,marker=true,missing=false}={}){
  const issue={issue_id:'17',title:'synthetic',display_status:'waiting_my_action'},trace=[];
  const db={beginTransaction:async()=>trace.push({event:'begin'}),commit:async()=>trace.push({event:'commit'}),rollback:async()=>trace.push({event:'rollback'}),release:()=>trace.push({event:'release'}),execute:async(sql,params=[])=>{
    trace.push({sql,params});
    if(missing)throw Object.assign(new Error('missing'),{code:'ER_NO_SUCH_TABLE'});
    if(sql.includes('FROM schema_migrations'))return [marker?[{migration_key:params[0]}]:[]];
    if(sql.includes('FROM process_governance_issues'))return [[issue]];
    if(sql.includes('FROM data_map_analysis_issue_bindings'))return [[{revision_no:7,issue_digest:digest(issue),owner_department_id:dept}]];
    if(sql.includes('FROM process_v7_preview_cases'))return [[{id:'17',current_revision_id:'17',owning_department_id:dept,status:'under_review'}]];
    if(sql.includes('FROM user_accounts'))return [account?[{account_id:subject.accountId,auth_version:subject.authVersion,person_id:subject.personId,current_department_id:dept}]:[]];
    if(sql.includes('FROM person_roles'))return [grants];
    if(sql.includes('FROM process_v7_authoring a'))return [[{compiler_person_id:compiler,assignment_version:7,started_epoch:null}]];
    if(sql.includes('FROM data_map_analysis_finding_reviews'))return [[]];
    throw new Error('UNREVIEWED_SQL '+sql);
  }};
  return {subject,trace,repo:makeProcessPreviewReviewRepository({getConnection:async()=>db})};
}
async function reject(name,options,error){const f=fixture(options);await assert.rejects(f.repo.replyAuthoringIssue('17','17',{},f.subject),error);assert.equal(f.trace.at(-2).event,'rollback');assert.equal(f.trace.at(-1).event,'release');assert(!f.trace.some(q=>q.event==='commit'));checks.push(name);return f;}
async function main(){
  process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.PROCESS_V7_AUTHORING_ENABLED='1';
  const f=fixture();process.env.PROCESS_V7_PREVIEW_ENABLED='0';await assert.rejects(f.repo.replyAuthoringIssue('17','17',{},f.subject),{code:'V7_PREVIEW_DISABLED',statusCode:503,message:'流程预览核对功能当前未启用'});assert.deepEqual(f.trace,[]);checks.push('preview disabled before transaction');process.env.PROCESS_V7_PREVIEW_ENABLED='1';
  process.env.PROCESS_V7_AUTHORING_ENABLED='0';await reject('authoring disabled rollback',{}, {code:'V7_AUTHORING_DISABLED',statusCode:503});process.env.PROCESS_V7_AUTHORING_ENABLED='1';
  await reject('unprepared marker preserves 503', {marker:false},{code:'V7_AUTHORING_ISSUE_MIGRATION_REQUIRED',statusCode:503});
  await reject('absent physical table maps original message',{missing:true},{code:'V7_AUTHORING_ISSUE_MIGRATION_REQUIRED',statusCode:503,message:'关联问题所需的存储结构尚未准备'});
  for(const s of [{personId:7,accountId:107,authVersion:1},{personId:'0007',accountId:'0107',authVersion:'01'},{personId:P,accountId:A,authVersion:V}]){
    const subject=actor(s),f=await reject('typed identity '+String(s.personId),{subject,compiler:String(subject.personId)},{code:'V7_AUTHORING_ISSUE_SOURCE_UNRESOLVED',statusCode:409});
    const sql=f.trace.filter(q=>q.sql),account=sql.find(q=>q.sql.includes('FROM user_accounts'));
    assert.deepEqual(account.params,[String(subject.accountId),String(subject.personId)]);assert(sql.indexOf(account)>sql.findIndex(q=>q.sql.includes('FROM process_v7_preview_cases')));
    assert(sql.indexOf(account)<sql.findIndex(q=>q.sql.includes('FROM process_v7_authoring a')));assert.match(account.sql,/FOR SHARE/);
  }
  for(const s of [{identityKind:'system_admin',accountId:107,personId:7,authVersion:1},{personId:null,accountId:107,authVersion:1},{personId:Number(P),accountId:107,authVersion:1},{personId:P,accountId:Number(A),authVersion:1},{personId:P,accountId:A,authVersion:Number(V)}]){
    const subject=actor(s);assert(subject.personId===null||subject.accountId===null||subject.authVersion===null);
    await reject('invalid routed typed identity '+JSON.stringify(s),{subject,account:false},{code:'SESSION_AUTHORIZATION_CHANGED',statusCode:401});
  }
  for(const grants of [[{role_code:'admin',scope_type:'global',perm_code:'governance:read-global',effect:'allow'}],[{role_code:'admin',scope_type:'global',perm_code:'governance:read-global',effect:'allow'},{role_code:'department_contact',scope_type:'department',scope_department_id:'91',perm_code:'governance:draft-department',effect:'allow'}],[{role_code:'department_contact',perm_code:'governance:draft-department',effect:'deny'}]])
    await reject('current admin or explicit deny remains compiler-required',{grants},{code:'V7_AUTHORING_COMPILER_REQUIRED',statusCode:403});
  await reject('different compiler denied',{compiler:'8'},{code:'V7_AUTHORING_COMPILER_REQUIRED',statusCode:403});
  assert(sameIdentityInteger('0007',7));assert(!sameIdentityInteger(P,'9007199254740992'));assert(!sameIdentityInteger(Number(P),P));checks.push('representation never recovers unsafe numbers');
  const {readFixedPublishedVersion}=require('../server/processDataGovernanceRepository');
  for(const department of ['91',P,null]){const version={id:17,department_id:department,status:'published',schema_version:'process-governance-v8',process_content_json:'original body',content_hash:'original hash',process_ref:'original ref'},trace=[];
    const db={execute:async(sql,params)=>{trace.push({sql,params});return [[version]];}};
    assert.strictEqual(await readFixedPublishedVersion(db,'17',true),version);assert.equal(trace.length,1);assert.deepEqual(trace[0].params,['17']);assert.match(trace[0].sql,/CAST\(v\.department_id AS CHAR\) AS department_id/);assert.match(trace[0].sql,/FOR UPDATE/);assert.equal(version.department_id,department);
    trace.length=0;assert.strictEqual(await readFixedPublishedVersion(db,'17'),version);assert.equal(trace.length,1);assert(!trace[0].sql.includes('FOR UPDATE'));checks.push('fixed published version original fields and lock choice '+department);
  }
  console.log(JSON.stringify({passed:true,checks,publicEntry:'makeProcessPreviewReviewRepository.replyAuthoringIssue',scope:'SQL-free public-chain rejection and routed identity representation; actual locking/commit/compatibility in MySQL companion'}));
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
