// Uses only a newly owned tmpfs MySQL container, synthetic identities and explicit
// fixture DDL. No env file, configured database, existing container or volume.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { applyDepartmentAccountabilityPolicy } = require('../server/departmentAccountabilityMigration');
const { statements,MIGRATION_KEY } = require('../server/terminologyGovernanceSchema');
const { makeTerminologyGovernanceRepository,resolveTerm } = require('../server/terminologyGovernanceRepository');
const p = require('../server/terminologyGovernancePolicy');
const request = () => crypto.randomUUID();
const scalar = async(db,sql,params=[]) => (await db.execute(sql,params))[0][0];
async function main() {
  await withFreshMysql(async({pool,owner,database,port}) => {
    process.stdout.write(JSON.stringify({owned_fixture:true,owner,database,port})+'\n');
    await makeIdentityMysqlRepository(pool).initSchema();
    const setup=await pool.getConnection();try{await applyDepartmentAccountabilityPolicy(setup);}finally{setup.release();}
    for (const statement of statements()) await pool.execute(statement);
    await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
    for(const id of ['10','20','30'])await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[id,'SYN_D'+id,'Synthetic Department '+id]);
    const people={contact:['1','10','department_contact'],head:['2','10','department_mdm_reviewer'],lead:['3','20','mdm_lead'],employee:['4','30',null],steward:['5','20','mdm_steward'],admin:['6','10','admin'],hr:['7','20','hr_directory_manager'],newHead:['8','10','department_mdm_reviewer'],otherHead:['9','30','department_mdm_reviewer'],decider:['10','20','decision_group'],observer:['11',null,null]};
    async function grant(id,code,department=null) {
      await pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from)
        SELECT ?,role_id,?,?,?,CURRENT_DATE FROM roles WHERE role_code=?`,[id,department?'department':'global',department,'synthetic controlled test',code]);
    }
    for(const [id,department,role] of Object.values(people)) {
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[id,'SYN_TERM_'+id,'Synthetic Term Person '+id,department]);
      await pool.execute("INSERT INTO user_accounts(person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,'synthetic-unusable','active',0)",[id,'SYN_TERM_'+id]);
      if(role)await grant(id,role,['department_contact','department_mdm_reviewer'].includes(role)?department:null);
    }
    await grant('6','department_contact','10');await grant('6','mdm_lead');
    await pool.execute('UPDATE departments SET final_responsible_person_id=2 WHERE id=10');
    await pool.execute('UPDATE departments SET final_responsible_person_id=9 WHERE id=30');
    async function session(name) {
      const [id,department]=people[name];
      const account=await scalar(pool,'SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=?',[id]);
      return {personId:id,userId:id,departmentId:department,accountId:account.account_id,authVersion:account.auth_version,identityKind:'person'};
    }
    const repo=makeTerminologyGovernanceRepository(pool,{env:{TERMINOLOGY_GOVERNANCE_ENABLED:'1'}});
    assert.equal((await repo.capabilities(await session('contact'))).ready,true);
    const body=(kind='custom',context='采购语境',concept='采购设备') => ({reason:'合成明确修订依据',request_id:request(),term:'设备',definition:'合成原始定义',context,concept_key:concept,source_kind:kind,
      ...(kind==='custom'?{}:{standard_number:kind==='gb'?'GB 99999-2026':kind==='gbt'?'GB/T 99999-2026':'GB/Z 99999-2026',standard_version:'2026',standard_clause:'3.1',original_definition:'合成原始定义'})});
    const create=async(kind,context,concept)=>repo.createTerm(await session('contact'),body(kind,context,concept));
    const detail=async id=>repo.getTerm(await session('contact'),id);
    const act=async(id,name,action,extra={})=>repo.action(await session(name),id,{request_id:request(),expected_revision:(await detail(id)).revision_no,action,reason:'合成明确办理依据',...extra});
    const submit=async id=>{await act(id,'contact','submit');await act(id,'head','department_confirm');};
    const adopt=async(kind,context,concept)=>{const term=await create(kind,context,concept);await submit(term.term_id);await act(term.term_id,'lead','source_check',{verified:true});if(kind!=='gb')await act(term.term_id,'lead','adopt');return term.term_id;};
    const originalPayload=body();
    delete originalPayload.concept_key;
    const created=await repo.createTerm(await session('contact'),originalPayload),id=created.term_id;
    assert.match(created.concept_key,/^[a-f0-9-]{36}$/);
    assert.equal((await repo.createTerm(await session('contact'),originalPayload)).term_id,id);
    await assert.rejects(repo.createTerm(await session('contact'),{...originalPayload,definition:'changed'}),{code:'TERM_GOVERNANCE_REQUEST_REUSED'});
    for(const name of ['employee','admin','hr'])await assert.rejects(repo.createTerm(await session(name),body()),error=>[401,403].includes(error.statusCode));
    await assert.rejects(repo.getTerm(await session('employee'),id),{code:'TERM_GOVERNANCE_NOT_FOUND'});
    await submit(id);
    await pool.execute('UPDATE departments SET final_responsible_person_id=8 WHERE id=10');
    await assert.rejects(act(id,'lead','source_check',{verified:true}),{code:'TERM_GOVERNANCE_DEPARTMENT_RECONFIRM_REQUIRED'});
    await assert.rejects(act(id,'head','department_return'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await pool.execute('UPDATE departments SET final_responsible_person_id=2 WHERE id=10');
    await assert.rejects(act(id,'steward','source_check',{verified:true}),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await act(id,'lead','assign',{assignee_person_id:'5'});
    assert.ok((await repo.listTerms(await session('steward'))).items.some(term=>term.term_id===id&&term.can_read_process));
    assert.equal((await repo.capabilities(await session('steward'))).assigned_terms_count,1);
    assert.equal((await repo.listTerms(await session('steward'),{assigned:true})).items.length,1);
    await act(id,'steward','source_check',{verified:true});
    await assert.rejects(act(id,'steward','adopt'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await act(id,'lead','adopt');
    const active=await resolveTerm(pool,id),oldVersion=await scalar(pool,'SELECT * FROM tg_term_versions WHERE version_id=?',[active.version_id]);
    const beforeReasonCheck=Number((await scalar(pool,'SELECT COUNT(*) n FROM tg_term_versions WHERE term_id=?',[id])).n);
    await assert.rejects(repo.updateTerm(await session('contact'),id,{...body(),reason:'',expected_revision:(await detail(id)).revision_no}),{code:'TERM_GOVERNANCE_INPUT_INVALID'});
    assert.equal(Number((await scalar(pool,'SELECT COUNT(*) n FROM tg_term_versions WHERE term_id=?',[id])).n),beforeReasonCheck);
    assert.equal(active.usable,true);
    assert.equal((await repo.getTerm(await session('observer'),id)).definition,active.definition);
    await repo.createChallenge(await session('observer'),id,{request_id:request(),expected_revision:(await detail(id)).revision_no,reason:'合成无部门有效人员质疑'});
    assert.ok((await repo.getTerm(await session('employee'),id)).allowed_actions.includes('create_challenge'));
    const pendingBody={...body(),concept_key:created.concept_key,request_id:request(),expected_revision:(await detail(id)).revision_no,definition:'新修订，旧版本应保留'};
    await repo.updateTerm(await session('contact'),id,pendingBody);
    assert.equal((await resolveTerm(pool,id)).usage_token,active.usage_token);
    assert.deepEqual(await scalar(pool,'SELECT * FROM tg_term_versions WHERE version_id=?',[active.version_id]),oldVersion);
    const hidden=await repo.getTerm(await session('employee'),id);assert.equal(hidden.pending_version,undefined);assert.equal(hidden.versions.length,1);
    await submit(id);await act(id,'lead','source_check',{verified:true});await act(id,'lead','not_adopt');
    assert.equal((await resolveTerm(pool,id)).version_id,active.version_id);
    const challenge=await repo.createChallenge(await session('employee'),id,{request_id:request(),expected_revision:(await detail(id)).revision_no,reason:'合成自定义质疑'});
    assert.ok(challenge.challenge_id);assert.equal((await resolveTerm(pool,id)).usage_token,active.usage_token);
    const cAction=async(name,action,extra={})=>{
      const c=(await repo.listChallenges(await session('lead'),id)).items.find(item=>item.challenge_id===challenge.challenge_id);
      return repo.challengeAction(await session(name),id,c.challenge_id,{request_id:request(),expected_revision:(await detail(id)).revision_no,expected_challenge_revision:c.revision_no,action,reason:'合成质疑办理依据',...extra});
    };
    await cAction('lead','coordinate',{affected_department_ids:['10','30']});
    await cAction('head','department_opinion',{conclusion_key:'维持定义'});await cAction('otherHead','department_opinion',{conclusion_key:'维持定义'});
    await assert.rejects(cAction('steward','coordinate',{finalize:true}),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await cAction('lead','coordinate',{finalize:true});await cAction('lead','feedback');await cAction('lead','close');
    assert((await repo.getTerm(await session('observer'),id)).events.some(e=>e.event_type==='challenge_close'&&e.conclusion.conclusion_key==='维持定义'),'final conclusion is public and closure does not require challenger consent');
    await cAction('employee','reopen');await cAction('lead','coordinate',{affected_department_ids:['10','30']});
    await assert.rejects(cAction('lead','coordinate',{finalize:true}),{code:'TERM_GOVERNANCE_OPINIONS_NOT_AGREED'});
    await cAction('head','department_opinion',{conclusion_key:'需修改'});await cAction('otherHead','department_opinion',{conclusion_key:'维持定义'});
    await assert.rejects(cAction('lead','coordinate',{finalize:true}),{code:'TERM_GOVERNANCE_OPINIONS_NOT_AGREED'});
    await assert.rejects(cAction('lead','escalate'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await cAction('head','escalate');await cAction('decider','decide',{conclusion_key:'先补充依据'});await cAction('lead','feedback');await cAction('employee','close');
    assert.equal((await resolveTerm(pool,id)).usage_token,active.usage_token);
    const gb=await adopt('gb','GB适用语境','GB设备');
    await assert.rejects(act(gb,'lead','stop_adoption'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await act(gb,'lead','source_withdrawn',{effective_from:'2026-10-20'});assert.equal((await resolveTerm(pool,gb)).usable,false);
    const gbt=await adopt('gbt','GBT适用语境','GBT设备'),gbtOld=await resolveTerm(pool,gbt);
    await act(gbt,'lead','source_superseded',{effective_from:'2026-10-20'});assert.equal((await resolveTerm(pool,gbt)).source_status,'superseded');assert.equal((await resolveTerm(pool,gbt)).usable,true);
    await act(gbt,'lead','continue_adoption');assert.equal((await resolveTerm(pool,gbt)).source_status,'superseded');
    await act(gbt,'lead','source_withdrawn',{effective_from:'2026-10-20'});assert.equal((await resolveTerm(pool,gbt)).usable,true);assert.equal((await resolveTerm(pool,gbt)).source_status,'withdrawn');
    await act(gbt,'lead','continue_adoption');await act(gbt,'lead','stop_adoption');await assert.rejects(act(gbt,'lead','continue_adoption'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
    await repo.updateTerm(await session('contact'),gbt,{...body('gbt','GBT适用语境','GBT设备'),expected_revision:(await detail(gbt)).revision_no,standard_version:'2027',standard_number:'GB/T 99999-2027'});
    await submit(gbt);await act(gbt,'lead','source_check',{verified:true});assert.equal((await resolveTerm(pool,gbt)).version_id,gbtOld.version_id);
    await act(gbt,'lead','adopt');assert.notEqual((await resolveTerm(pool,gbt)).version_id,gbtOld.version_id);
    const rejected=await create('gbt','未采纳公开语境','未采纳公开概念');await submit(rejected.term_id);await act(rejected.term_id,'lead','source_check',{verified:true});await act(rejected.term_id,'lead','not_adopt');
    const rejectedPublic=await repo.getTerm(await session('observer'),rejected.term_id);assert.equal(rejectedPublic.adoption_status,'not_adopted');assert.equal(rejectedPublic.usable,false);assert(rejectedPublic.events.some(e=>e.event_type==='not_adopt'&&e.conclusion));
    const gbz=await create('gbz','GBZ适用语境','GBZ设备');await submit(gbz.term_id);
    await assert.rejects(act(gbz.term_id,'lead','source_check',{verified:true}),{code:'TERM_GOVERNANCE_GBZ_NOT_ADOPTABLE'});
    const dates=await scalar(pool,"SELECT DATE_FORMAT(CURRENT_DATE,'%Y-%m-%d') today,DATE_FORMAT(CURRENT_DATE+INTERVAL 1 DAY,'%Y-%m-%d') tomorrow,DATE_FORMAT(CURRENT_DATE+INTERVAL 2 DAY,'%Y-%m-%d') later,DATE_FORMAT(CURRENT_DATE-INTERVAL 1 DAY,'%Y-%m-%d') yesterday");
    await act(id,'lead','suspend',{effective_from:dates.today,scope:'采购语境'});
    await act(id,'lead','restore',{effective_from:dates.tomorrow});
    assert.equal((await resolveTerm(pool,id,{today:dates.today})).suspended,true);assert.equal((await resolveTerm(pool,id,{today:dates.tomorrow})).suspended,false);
    await act(id,'lead','suspend',{effective_from:dates.today,scope:'采购语境'});
    await assert.rejects(act(id,'lead','restore',{effective_from:dates.yesterday}),{code:'TERM_GOVERNANCE_INPUT_INVALID'});
    await act(id,'lead','restore',{effective_from:dates.today});
    const sameContext=await adopt('custom','采购语境','采购设备同义概念'),differentContext=await adopt('custom','其他语境','其他设备');
    await assert.rejects(act(id,'lead','merge',{target_term_id:differentContext,confirm_same_concept:true}),{code:'TERM_GOVERNANCE_MERGE_CONTEXT_INVALID'});
    await assert.rejects(act(id,'lead','merge',{target_term_id:sameContext}),{code:'TERM_GOVERNANCE_MERGE_CONFIRM_REQUIRED'});
    await act(id,'lead','merge',{target_term_id:sameContext,confirm_same_concept:true});
    const preferred=await adopt('gb','规范表述优先语境','优先GB概念'),lower=await adopt('custom','规范表述优先语境','待合并自定义概念');
    await assert.rejects(act(preferred,'lead','merge',{target_term_id:lower,confirm_same_concept:true}),{code:'TERM_GOVERNANCE_MERGE_STANDARD_PRIORITY'});
    await act(lower,'lead','merge',{target_term_id:preferred,confirm_same_concept:true});assert.equal((await resolveTerm(pool,lower)).merged_into_id,preferred);
    const oldLegacy=request(),legacyVersionId=request(),legacyContent={term:'历史设备',definition:'原历史定义',context:null,source_kind:'legacy'};
    await pool.execute("INSERT INTO tg_terms(term_id,current_version_id,adoption_status,source_status,legacy_unverified,legacy_status,legacy_usable) VALUES(?,?,'legacy_preserved','unverified',1,'approved',1)",[oldLegacy,legacyVersionId]);
    await pool.execute('INSERT INTO tg_term_versions(version_id,term_id,version_no,content_json,content_hash) VALUES(?,?,1,?,?)',[legacyVersionId,oldLegacy,JSON.stringify(legacyContent),p.hash(legacyContent)]);
    await assert.rejects(act(oldLegacy,'lead','merge',{target_term_id:preferred,confirm_same_concept:true}),{code:'TERM_GOVERNANCE_MERGE_CONTEXT_INVALID'});
    await act(oldLegacy,'lead','merge',{target_term_id:preferred,confirm_same_concept:true,confirm_legacy_context:true});assert.equal((await resolveTerm(pool,oldLegacy)).merged_into_id,preferred);
    assert.equal((await resolveTerm(pool,id)).usable,false);assert.equal((await resolveTerm(pool,sameContext)).usable,true);assert.equal((await resolveTerm(pool,id)).merged_into_id,sameContext);
    assert.deepEqual(await scalar(pool,'SELECT * FROM tg_term_versions WHERE version_id=?',[active.version_id]),oldVersion);
    const raceTerm=await create('custom','并发语境','并发设备');
    const s=await session('contact');
    const raceCurrent=await detail(raceTerm.term_id);
    const concurrent=await Promise.allSettled([1,2].map(index=>repo.updateTerm(s,raceTerm.term_id,{...body('custom','并发语境','并发设备'),expected_revision:raceCurrent.revision_no,definition:'实际并发定义'+index})));
    assert.equal(concurrent.filter(result=>result.status==='fulfilled').length,1);assert.equal(concurrent.find(result=>result.status==='rejected').reason.code,'TERM_GOVERNANCE_REVISION_CONFLICT');
    assert.equal(Number((await scalar(pool,'SELECT COUNT(*) n FROM mdm_todos')).n),0);
    process.stdout.write('terminology-governance-core-mysql: PASS (real identities, current head, assigned steward, immutable revisions, GB/GBT/GBZ, dates, manual merge, challenge agreement/escalation/review rounds, actual MySQL concurrent revision gate, no implicit todos)\n');
  },{stage:'24',randomDatabase:true});
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
