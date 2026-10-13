// Owned tmpfs MySQL, random HTTP port and Edge desktop; synthetic-only fixed sources.
// Input --output must name a new artifacts directory. No formal DB/config/AI/notifications.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const { withStage05Fixture } = require('./test-stage05-mysql-isolated');
const output = path.resolve(process.argv[process.argv.indexOf('--output') + 1] || '');
assert(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const checks = [], uuid = () => crypto.randomUUID();
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS ' + name); }
function runtime() { try { return require('playwright'); } catch { return require(path.join(process.env.APPDATA, 'npm/node_modules/@playwright/cli/node_modules/playwright')); } }
async function main() {
  const flags = ['PROCESS_V7_PREVIEW_ENABLED', 'PROCESS_V7_FORMAL_ENABLED', 'PROCESS_V7_AUTHORING_ENABLED'];
  const prior = flags.map(k => process.env[k]); flags.forEach(k => { process.env[k] = '1'; });
  try { await withStage05Fixture(async ({ pool, fixture, expect, request, backup, restore }) => {
    const root = '/api/process-v7-preview/cases';
    const repository = require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository(pool);
    const lead = { personId: 82, accountId: 182, authVersion: 1 };
    const clients = {};
    async function extra(who, url, method = 'GET', body) {
      if (!clients[who]) {
        const login = await fetch(fixture.baseURL + '/api/org/login', { method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({ loginName:'SYNTHETIC_' + who,password:fixture.loginPassword }) });
        assert.equal(login.status,200); const cookie = login.headers.get('set-cookie').split(';')[0];
        const csrf = await fetch(fixture.baseURL + '/api/csrf-token',{headers:{Cookie:cookie}});
        clients[who] = { cookie, csrf:(await csrf.json()).csrfToken };
      }
      const c = clients[who], response = await fetch(fixture.baseURL + url,{method,headers:{Cookie:c.cookie,'X-CSRF-Token':c.csrf,'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)})});
      return {status:response.status,body:await response.json()};
    }
    async function ex(who,url,method='GET',body,status=200) {
      const r = ['compiler','peer'].includes(who) ? await extra(who,url,method,body) : await request(who,url,method,body);
      assert.equal(r.status,status,`${who} ${url}: ${JSON.stringify(r.body)}`); return r.body;
    }
    for (const [personId,who] of [[89,'compiler'],[90,'peer']]) {
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,91)',[personId,'SYNTHETIC_' + who,'合成' + who]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)",[personId+100,personId,'SYNTHETIC_' + who,require('bcryptjs').hashSync(fixture.loginPassword,10)]);
    }
    async function create(ref, transfer=true, schemaVersion='process-governance-v7') {
      const document = structuredClone(fixture.document); document.process.process_ref = ref; document.process.process_name = '合成' + ref;
      document.schema_version=schemaVersion; document.migration.source_schema_version=schemaVersion;
      const imported = await ex('contact',root,'POST',{document,source_file_name:ref+'.json'},201);
      let detail = await ex('contact',root+'/'+imported.case.id);
      if (transfer) { await ex('contact',root+'/'+detail.case.id+'/authoring-records','POST',{...bind(detail),record_kind:'transfer',recipient_person_id:'89',content:'明确合成转办依据',request_key:uuid()}); detail = await ex('compiler',root+'/'+detail.case.id); }
      return detail;
    }
    function bind(d) { return {expected_revision_no:d.case.current_revision_no,expected_content_hash:d.case.current_content_hash,expected_assignment_version:d.authoring.assignment_version}; }
    const detail = await create('p25_issue_main'), caseId = detail.case.id, base = root+'/'+caseId+'/authoring-issues';
    await check('missing migration refuses read; no startup tables or inferred issue binding',async()=>{
      await ex('compiler',base,'GET',undefined,503);
      const db=await pool.getConnection();
      try {
        for(const [module,action] of [['dataMapDefinitionMigration','applyDefinitions'],['v7MappingMigration','applyV7Mappings'],['designHandofaNFigration','applyDesignHandoffs'],['analysisRunMigration','applyAnalysisRuns'],['analysisIssueMigration','applyAnalysisIssues']]) await require('../server/'+module)[action](db);
        await require('../server/officeSchema').manageOfficeSchema(db,'apply');
        await require('../server/analysisTaskMigration').applyAnalysisTasks(db);
      } finally {db.release();}
      assert.equal((await ex('compiler',base)).items.length,0);
      for(const module of ['dataMapDefinitionSchema','v7MappingSchema','analysisRunSchema','analysisIssueSchema','officeSchema','analysisTaskSchema']) {
        const key=require('../server/'+module).MIGRATION_KEY;
        await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[key]);
        assert.equal((await ex('compiler',base,'GET',undefined,503)).code,'V7_AUTHORING_ISSUE_MIGRATION_REQUIRED');
        await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[key]);
      }
    });
    async function makeIssue(d, additional=[], versionId=null) {
      const source=await repository.registerV7Source(lead,{request_id:uuid(),...(versionId ? {source_kind:'published_version',process_version_id:String(versionId)} : {source_kind:'preview_revision',case_id:String(d.case.id),revision_id:String(d.case.current_revision_id)})});
      const inputs=[{input_key:'source',kind:'v7_source',ref_id:source.source_id},...additional];
      const run=await repository.createAnalysisRun(lead,{request_id:uuid(),inputs,check_scope:{description:'合成流程固定来源',check_ids:['references']},parser_versions:{native_v7:'synthetic-parser-v1'},rule_version:'synthetic-rules-v1',steps:[{step_key:'read',input_keys:inputs.map(i=>i.input_key),check_ids:['references'],parser_key:'native_v7'}],ai_metadata:null,rerun_of_run_id:null});
      const get=()=>repository.getAnalysisRun(lead,run.run_id);
      const attempt=await repository.beginAnalysisAttempt(lead,{request_id:uuid(),run_id:run.run_id,expected_revision:(await get()).revision_no,step_key:'read'});
      await repository.completeAnalysisAttempt(lead,{request_id:uuid(),run_id:run.run_id,expected_revision:(await get()).revision_no,attempt_id:attempt.attempt_id,status:'succeeded',checked_ids:['references'],error_code:null,
        evidence:[{evidence_key:'location',input_key:'source',locator_kind:'json_pointer',locator:'/process/purpose',note:'合成事实依据'}],
        findings:[{rule_id:'references',finding_type:'missing_basis',message:'合成流程事实待补充',subject_input_keys:['source'],semantic_locator:'process_ref='+d.case.process_ref,evidence_keys:['location']}]});
      await repository.finishAnalysisRun(lead,{request_id:uuid(),run_id:run.run_id,expected_revision:(await get()).revision_no,status:'succeeded'});
      const stored=await get(), finding=stored.attempts[0].findings[0], evidence=stored.attempts[0].evidence[0];
      const result=await repository.decideAnalysisFinding(lead,{request_id:uuid(),run_id:run.run_id,finding_id:finding.finding_id,expected_revision:1,action:'create',title:'合成订单条件待核对',owner_department_id:'91',owner_basis:'明确合成归口',reason:'合成材料已人工核对',evidence_ids:[evidence.evidence_id]});
      return {source,issueId:result.issue_id};
    }
    const {issueId,source}=await makeIssue(detail);
    await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (19,'SYNTHETIC_OFFICE','合成核实办公室','office',91,83)");
    await pool.execute("INSERT INTO office_membership(office_id,person_id,status) VALUES (19,89,'active')");
    const taskState=await repository.getAnalysisIssueTasks(lead,issueId);
    const dispatched=await repository.dispatchAnalysisIssueTask(lead,{request_id:uuid(),issue_id:issueId,expected_revision:taskState.revision_no,expected_issue_digest:taskState.issue_digest,office_id:'19',purpose:'correct',round_no:1,instruction:'合成最小办理说明：补充订单条件依据'});
    await ex('contact','/api/offices/tasks/'+dispatched.todo_id+'/assign','POST',{assignee_person_id:89,expected_revision:1});
    let work=(await ex('compiler',base)).items[0];
    const command=(d=detail,w=work)=>({...bind(d),request_key:uuid(),content:'合成编制者问题答复，请继续有权复核。',expected_issue_revision:w.revision_no,expected_issue_digest:w.issue_digest,todo_id:dispatched.todo_id,expected_task_revision:2});
    const url=base+'/'+issueId+'/reply';
    await check('exact-case roleless read; contact coordinates but cannot substitute; unrelated/admin/foreign writes rejected',async()=>{
      assert.equal(work.issue_id,issueId); assert.equal(work.can_reply,true); assert.equal(work.tasks.length,1);
      assert.deepEqual(work.fixed_sources.map(s=>s.source_ref),[{case_id:String(caseId),revision_id:String(detail.case.current_revision_id)}]);
      assert.equal(work.fixed_sources[0].schema_version,'process-governance-v7');
      assert.equal(work.fixed_sources[0].content_digest,detail.case.current_content_hash);
      assert.equal((await ex('contact',base)).items[0].can_reply,false);
      await ex('peer',base,'GET',undefined,403); await ex('outsider',base,'GET',undefined,403);
      for(const who of ['contact','peer','adminMulti','outsider']) await ex(who,url,'POST',command(),403);
      await ex('compiler','/api/analysis/issues/'+issueId,'GET',undefined,404);
      assert(!JSON.stringify(work).includes('fixed_inputs')); assert(!JSON.stringify(work).includes('process_content_json'));
    });
    await check('atomic failure rolls back authoring start, issue/task events and revisions',async()=>{
      const snapshot=async()=>({detail:await ex('compiler',root+'/'+caseId),work:await ex('compiler',base),
        taskEvents:(await pool.execute('SELECT id,event_type,note FROM mdm_todo_events WHERE todo_id=? ORDER BY id',[dispatched.todo_id]))[0]});
      const before=await snapshot();
      for(const [table,operation] of [['process_v7_authoring_records','INSERT'],['process_governance_issue_events','INSERT'],['mdm_todo_events','INSERT'],['data_map_analysis_issue_bindings','UPDATE']]) {
        await pool.query(`CREATE TRIGGER fail_compiler_reply BEFORE ${operation} ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_FAILURE'`);
        try {await ex('compiler',url,'POST',command(),500);} finally {await pool.query('DROP TRIGGER fail_compiler_reply');}
        assert.deepEqual(await snapshot(),before,table+' failure leaves all records and assignment unchanged');
      }
    });
    await check('marked but incomplete storage is unavailable; reads and replies never repair tables',async()=>{
      const before=await ex('compiler',root+'/'+caseId);
      await pool.query('RENAME TABLE data_map_analysis_finding_reviews TO synthetic_missing_reviews');
      try {
        assert.equal((await ex('compiler',base,'GET',undefined,503)).code,'V7_AUTHORING_ISSUE_MIGRATION_REQUIRED');
        assert.equal((await ex('compiler',url,'POST',command(),503)).code,'V7_AUTHORING_ISSUE_MIGRATION_REQUIRED');
        assert.equal((await pool.execute("SELECT COUNT(*) n FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_analysis_finding_reviews'"))[0][0].n,0);
      } finally {await pool.query('RENAME TABLE synthetic_missing_reviews TO data_map_analysis_finding_reviews');}
      assert.deepEqual(await ex('compiler',root+'/'+caseId),before);
    });
    const body=command();
    await check('duplicate concurrent reply retains one record/event and bumps issue revision once; status unchanged',async()=>{
      const replies=await Promise.all([ex('compiler',url,'POST',body),ex('compiler',url,'POST',body)]);
      assert.equal(replies[0].record_id,replies[1].record_id);
      const latest=(await ex('compiler',base)).items[0]; assert.equal(latest.revision_no,work.revision_no+1); assert.equal(latest.replies.length,1); assert.equal(latest.status,work.status); assert.equal(latest.tasks[0].status,'pending');
      await ex('compiler',url,'POST',{...body,content:'同键不同内容'},409);
      const member=await ex('compiler','/api/offices/workbench?office_id=19');
      assert.equal(member.tasks[0].analysis_task.compiler_replies.length,1);
      assert.equal(member.tasks[0].analysis_task.compiler_replies[0].content,body.content);
      await ex('peer','/api/offices/workbench?office_id=19','GET',undefined,403);
      await ex('compiler',url,'POST',{...body,request_key:uuid()},409);
      const current=await ex('compiler',root+'/'+caseId); work=latest;
      await ex('compiler',url,'POST',{...command(current,work),expected_task_revision:1},409);
      await ex('compiler',url,'POST',{...command(current,work),todo_id:'99999'},409);
    });
    await check('optional-task reply creates no task/event or issue and leaves all task states unchanged',async()=>{
      const before=(await pool.execute('SELECT (SELECT COUNT(*) FROM mdm_todos) todos,(SELECT COUNT(*) FROM process_governance_issues) issues,(SELECT COUNT(*) FROM mdm_todo_events) events'))[0][0];
      const d=await ex('compiler',root+'/'+caseId),w=(await ex('compiler',base)).items[0];
      const p={...command(d,w),todo_id:undefined,expected_task_revision:undefined};
      const result=await ex('compiler',url,'POST',p);assert.equal((await ex('compiler',url,'POST',p)).record_id,result.record_id);
      const after=(await pool.execute('SELECT (SELECT COUNT(*) FROM mdm_todos) todos,(SELECT COUNT(*) FROM process_governance_issues) issues,(SELECT COUNT(*) FROM mdm_todo_events) events'))[0][0];
      assert.deepEqual(after,before);assert.equal((await ex('compiler',base)).items[0].tasks[0].status,'pending');
      work=(await ex('compiler',base)).items[0];
    });
    await check('office completion keeps existing membership/assignment and independent issue closure boundary',async()=>{
      const taskURL='/api/offices/tasks/'+dispatched.todo_id+'/complete';
      await ex('contact',taskURL,'POST',{expected_revision:2,note:'不得代办'},403);
      await pool.execute("UPDATE office_membership SET status='inactive' WHERE office_id=19 AND person_id=89");
      await ex('compiler',taskURL,'POST',{expected_revision:2,note:'失效成员'},403);
      await pool.execute("UPDATE office_membership SET status='active' WHERE office_id=19 AND person_id=89");
      await ex('compiler',taskURL,'POST',{expected_revision:2,note:'合成答复已作为办理依据，问题另待复核'});
      assert.equal((await ex('compiler',base)).items[0].status,'waiting_my_action');
      const c=await ex('compiler',root+'/'+caseId);
      await ex('compiler',url,'POST',command(c,work),409);
    });
    await check('fixed-source corruption rejected; mixed-case source stays hidden without title/name inference',async()=>{
      const [[storedSource]]=await pool.execute('SELECT content_digest FROM data_map_v7_sources WHERE source_id=?',[source.source_id]);
      const original=storedSource.content_digest;
      await pool.execute('UPDATE data_map_v7_sources SET content_digest=? WHERE source_id=?',['a'.repeat(64),source.source_id]);
      await ex('compiler',base,'GET',undefined,409);
      await pool.execute('UPDATE data_map_v7_sources SET content_digest=? WHERE source_id=?',[original,source.source_id]);
      const other=await create('p25_issue_other');
      const extraSource=await repository.registerV7Source(lead,{request_id:uuid(),source_kind:'preview_revision',case_id:String(other.case.id),revision_id:String(other.case.current_revision_id)});
      const mixed=await makeIssue(detail,[{input_key:'other',kind:'v7_source',ref_id:extraSource.source_id}]);
      const scoped=await ex('compiler',base); assert(!scoped.items.some(i=>i.issue_id===mixed.issueId)); assert.equal(scoped.excluded,1);
      await ex('compiler',base+'/'+mixed.issueId+'/reply','POST',command(await ex('compiler',root+'/'+caseId),scoped.items[0]),409);
    });
    await check('one matching case input cannot expose independent uploads or standalone definitions',async()=>{
      const independent=await repository.registerV7Source(lead,{request_id:uuid(),source_kind:'uploaded_material',original_name:'same-name.json'},Buffer.from(JSON.stringify(detail.revision.document)));
      const definition=await repository.saveManaged({personId:83,accountId:183,authVersion:1},{request_id:uuid(),entity_type:'object',definition:{name:detail.case.process_name}});
      for(const extraInput of [{input_key:'independent',kind:'v7_source',ref_id:independent.source_id},{input_key:'definition',kind:'definition',ref_id:definition.version_id}]) {
        const mixed=await makeIssue(detail,[extraInput]);
        assert(!(await ex('compiler',base)).items.some(i=>i.issue_id===mixed.issueId));
        const denied=await ex('compiler',base+'/'+mixed.issueId+'/reply','POST',command(await ex('compiler',root+'/'+caseId),work),409);
        assert.equal(denied.code,'V7_AUTHORING_ISSUE_SOURCE_UNRESOLVED');
      }
    });
    await check('case-locked reply versus transfer cannot both succeed; successful reply closes transfer',async()=>{
      const race=await create('p25_issue_race',false), linked=await makeIssue(race), raceBase=root+'/'+race.case.id+'/authoring-issues';
      const w=(await ex('contact',raceBase)).items[0];
      const results=await Promise.all([request('contact',raceBase+'/'+linked.issueId+'/reply','POST',{...bind(race),request_key:uuid(),content:'合成首次问题答复',expected_issue_revision:w.revision_no,expected_issue_digest:w.issue_digest}),request('contact',root+'/'+race.case.id+'/authoring-records','POST',{...bind(race),request_key:uuid(),record_kind:'transfer',content:'合成并发转办',recipient_person_id:'89'})]);
      assert.equal(results.filter(r=>r.status===200).length,1); assert(results.some(r=>[403,409].includes(r.status)));
    });
    await check('owned backup/restore preserves reply stable ids/events and assignments',async()=>{
      const before=await ex('compiler',base), dump=backup();
      await pool.execute('DELETE FROM process_governance_issue_events WHERE issue_id=? AND event_type=?',[issueId,'commented']);
      restore(dump); assert.deepEqual(await ex('compiler',base),before);
    });
    await check('published fixed V7 version resolves through its promotion; compiler still cannot approve or publish',async()=>{
      const publishedCase=await create('p25_issue_published'), pRoot=root+'/'+publishedCase.case.id;
      for (const item of publishedCase.items) {
        await ex('compiler','/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind(publishedCase),decision:'confirmed',basis:'合成归口事实已核对'});
        await ex('reviewB','/api/process-v7-preview/items/'+item.id+'/decision','POST',{...bind(publishedCase),decision:'confirmed',basis:'合成接收事实已核对'});
      }
      const ready=await ex('lead',pRoot);
      const promotion=await ex('lead',pRoot+'/promote','POST',{...bind(ready),target:{mode:'create',document_no:'SYN-ISSUE-PUBLISHED',document_title:'合成固定正式问题来源'}},201);
      const formal={expected_revision_no:promotion.draft.revision_no,expected_content_hash:promotion.draft.content_hash};
      await ex('compiler','/api/process-design/drafts/'+promotion.draft.id+'/submit','POST',formal);
      const promoted=await ex('lead',pRoot), task=promoted.formal_promotion.review_task;
      await ex('compiler','/api/process-design/review-tasks/'+task.id+'/decision','POST',{...formal,decision:'approve',note:'越权检查'},403);
      await ex('reviewA','/api/process-design/review-tasks/'+task.id+'/decision','POST',{...formal,decision:'approve',note:'合成有权正式审核'});
      const published=await ex('lead','/api/process-design/drafts/'+promotion.draft.id+'/publish','POST',formal);
      const latest=await ex('compiler',pRoot), linked=await makeIssue(latest,[],published.process_version_id);
      const pBase=pRoot+'/authoring-issues', issue=(await ex('compiler',pBase)).items.find(i=>i.issue_id===linked.issueId);
      assert(issue && issue.can_reply && issue.source_current);
      const pCommand={...bind(latest),request_key:uuid(),content:'合成固定正式版本事实答复',expected_issue_revision:issue.revision_no,expected_issue_digest:issue.issue_digest};
      const saved=await ex('compiler',pBase+'/'+linked.issueId+'/reply','POST',pCommand);
      assert.equal((await ex('compiler',pBase)).items[0].replies.length,1);
      await ex('peer',pBase,'GET',undefined,403);
      const current=await ex('compiler',pRoot),updated=structuredClone(current.revision.document);updated.process.purpose+=' 合成正式来源后新修订';
      await ex('compiler',pRoot+'/revisions','POST',{...bind(current),document:updated,source_file_name:'published-next.json'},201);
      const old=(await ex('compiler',pBase)).items[0];assert.equal(old.source_current,false);assert.equal(old.can_reply,false);
      assert.equal(old.fixed_sources[0].source_ref.process_version_id,String(published.process_version_id));
      assert.equal((await ex('compiler',pBase+'/'+linked.issueId+'/reply','POST',pCommand)).record_id,saved.record_id);
      await ex('compiler',pBase+'/'+linked.issueId+'/reply','POST',{...pCommand,...bind(await ex('compiler',pRoot)),request_key:uuid(),expected_issue_revision:old.revision_no},409);
    });
    await check('V8 exact-case sources stay native and allow bound compiler replies without closing issues',async()=>{
      const v8=await create('p25_issue_v8',true,'process-governance-v8'),linked=await makeIssue(v8);
      const vBase=root+'/'+v8.case.id+'/authoring-issues',view=await ex('compiler',vBase);
      assert.equal(view.items.length,1);assert.equal(view.excluded,0);const item=view.items[0];assert.equal(item.fixed_sources[0].schema_version,'process-governance-v8');assert(item.can_reply);
      const replied=await ex('compiler',vBase+'/'+linked.issueId+'/reply','POST',{...bind(v8),request_key:uuid(),content:'V8原生固定来源答复，仍需有权复核',expected_issue_revision:item.revision_no,expected_issue_digest:item.issue_digest});assert.equal(replied.close_enabled,false);
      assert.equal((await ex('compiler',root+'/'+v8.case.id)).revision.document.schema_version,'process-governance-v8');
    });
    await check('compiler reply, assigned office completion and qualified independent review remain separate',async()=>{
      const d=await create('p25_issue_closure'),linked=await makeIssue(d),issueURL='/api/analysis/issues/'+linked.issueId;
      const initial=await repository.getAnalysisIssueTasks(lead,linked.issueId);
      const task=await repository.dispatchAnalysisIssueTask(lead,{request_id:uuid(),issue_id:linked.issueId,expected_revision:initial.revision_no,expected_issue_digest:initial.issue_digest,office_id:'19',purpose:'correct',round_no:1,instruction:'合成独立复核前的实际办理'});
      await ex('contact','/api/offices/tasks/'+task.todo_id+'/assign','POST',{assignee_person_id:89,expected_revision:1});
      const w=(await ex('compiler',root+'/'+d.case.id+'/authoring-issues')).items[0];
      await ex('compiler',root+'/'+d.case.id+'/authoring-issues/'+linked.issueId+'/reply','POST',{...bind(d),request_key:uuid(),content:'仅补充事实，不办结不关闭',expected_issue_revision:w.revision_no,expected_issue_digest:w.issue_digest,todo_id:task.todo_id,expected_task_revision:2});
      assert.equal((await repository.getAnalysisIssueTasks(lead,linked.issueId)).items[0].status,'pending');
      await ex('compiler','/api/offices/tasks/'+task.todo_id+'/complete','POST',{expected_revision:2,note:'合成独立办理证据：接收条件已核对'});
      assert.equal((await repository.getAnalysisIssue(lead,linked.issueId)).issue.display_status,'waiting_my_action');
      const connection=await pool.getConnection();try {await require('../server/analysisClosureMigration').applyAnalysisClosure(connection);} finally {connection.release();}
      const contact={personId:83,accountId:183,authVersion:1};
      await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 89,role_id,'global','synthetic reviewer exclusion',CURRENT_DATE FROM roles WHERE role_code='data_quality_auditor'");
      try {
        let state=await repository.getAnalysisIssueClosure(contact,linked.issueId);
        assert(state.candidates.some(p=>p.person_id==='82'));assert(!state.candidates.some(p=>p.person_id==='89'));
        const bindClosure=s=>({request_id:uuid(),expected_revision:s.revision_no,expected_issue_digest:s.issue_digest,expected_context_digest:s.context_digest});
        const designate={...bindClosure(state),action:'designate',reviewer_person_id:'82',conditions:['接收条件已核对'],reason:'合成有权负责人明确指定独立复核'};
        for(const who of ['compiler','lead','adminMulti'])await ex(who,issueURL+'/review','POST',designate,404);
        await ex('contact',issueURL+'/review','POST',{...designate,reviewer_person_id:'89'},404);
        await ex('contact',issueURL+'/review','POST',designate);
        state=await repository.getAnalysisIssueClosure(contact,linked.issueId);
        const close={...bindClosure(state),action:'review',reason:'合成逐项复核证据',checks:state.assignment.conditions.map(c=>({condition_id:c.condition_id,satisfied:true,basis:'独立核对实际办理记录',todo_id:task.todo_id,task_revision:3,excerpt:'接收条件已核对'}))};
        await ex('compiler',issueURL+'/review','POST',close,404);await ex('contact',issueURL+'/review','POST',close,404);
        await ex('lead',issueURL+'/review','POST',close);
        assert.equal((await repository.getAnalysisIssueClosure(contact,linked.issueId)).status,'closed');
        const closed=(await ex('compiler',root+'/'+d.case.id+'/authoring-issues')).items[0];assert.equal(closed.can_reply,false);assert.equal(closed.replies.length,1);
      } finally {
        await pool.execute("DELETE pr FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=89 AND r.role_code='data_quality_auditor'");
        await pool.execute('UPDATE departments SET final_responsible_person_id=NULL WHERE id=91');
      }
    });
    await check('disabled switch, changed identity and mandatory-password state cannot regain assigned write access',async()=>{
      const repo=require('../server/processV7PreviewReviewRepository').makeProcessV7PreviewReviewRepository(pool), actor={personId:89,accountId:189,authVersion:1};
      await assert.rejects(repo.authoringIssues(caseId,{...actor,authVersion:999}),e=>e.code==='SESSION_AUTHORIZATION_CHANGED');
      await pool.execute('UPDATE user_accounts SET must_change_password=1 WHERE account_id=189');
      await assert.rejects(repo.authoringIssues(caseId,actor),e=>e.code==='SESSION_AUTHORIZATION_CHANGED');
      await pool.execute('UPDATE user_accounts SET must_change_password=0 WHERE account_id=189');
      process.env.PROCESS_V7_AUTHORING_ENABLED='0';
      try { await assert.rejects(repo.authoringIssues(caseId,actor),e=>e.code==='V7_AUTHORING_DISABLED'); }
      finally {process.env.PROCESS_V7_AUTHORING_ENABLED='1';}
    });
    await check('issue cursor advances through excluded mixed inputs and preserves distinct fixed-source pages',async()=>{
      for(let i=0;i<21;i++)await makeIssue(detail);
      const first=await ex('compiler',base);assert(first.next_cursor);assert(first.excluded>=3);
      const second=await ex('compiler',base+'?after='+first.next_cursor);assert.equal(second.next_cursor,null);
      const ids=[...first.items,...second.items].map(i=>i.issue_id);assert.equal(ids.length,22);assert.equal(new Set(ids).size,ids.length);
      assert(second.items.every(i=>i.fixed_sources.every(s=>s.source_ref.case_id===String(caseId))));
    });
    await check('Edge fixed sources/pagination, lost response, 401/403/409/503, late reads and input protection',async()=>{
      const browser=await runtime().chromium.launch({channel:'msedge',headless:true});
      try {
        const page=await browser.newPage({viewport:{width:1699,height:828},deviceScaleFactor:1}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(fixture.baseURL+'/app/process-preview?case='+caseId);
        await page.locator('#login-name').fill('SYNTHETIC_compiler'); await page.locator('#login-password').fill(fixture.loginPassword);
        await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();
        await page.getByText('固定内容摘要：'+detail.case.current_content_hash,{exact:true}).first().waitFor();
        await page.getByText(/跨页不是同一快照；每个问题最多展示200个任务和最近50条答复/).waitFor();
        await page.getByRole('button',{name:'答复问题'+issueId,exact:true}).click();
        assert.equal(await page.locator('.preview-editor').evaluate(el=>el===document.activeElement),true);
        const note='合成页面答复：订单、客户和合同的对应依据仍待核验。';
        await page.getByLabel('问题答复',{exact:true}).fill(note);
        await page.getByRole('button',{name:'下一页关联问题',exact:true}).click();
        await page.getByRole('button',{name:'上一页关联问题',exact:true}).waitFor({state:'visible'});
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='上一页关联问题'&&!b.disabled));
        assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),note);
        await page.getByRole('button',{name:'上一页关联问题',exact:true}).click();
        await page.getByRole('button',{name:'答复问题'+issueId,exact:true}).waitFor();
        page.once('dialog',d=>d.dismiss()); await page.getByRole('link',{name:'当前身份',exact:true}).click();
        assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),note);
        await page.route('**/authoring-issues/*/reply',async route=>{await route.fetch();await route.abort('failed');},{times:1});
        await page.getByRole('button',{name:'保存问题答复',exact:true}).click(); await page.getByRole('button',{name:'核对本次提交结果',exact:true}).waitFor();
        assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),note);
        await page.getByRole('button',{name:'核对本次提交结果',exact:true}).click();
        await page.getByText('已核对本次记录保存成功，请按当前编制归属继续。',{exact:true}).waitFor();
        assert.equal((await ex('compiler',base)).items[0].replies.filter(r=>r.note===note).length,1);
        await page.getByRole('button',{name:'答复问题'+issueId,exact:true}).click(); await page.getByLabel('问题答复',{exact:true}).fill('合成失败输入须保留');
        await page.route('**/authoring-issues/*/reply',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"合成失败"}'}),{times:1});
        await page.getByRole('button',{name:'保存问题答复',exact:true}).click(); await page.getByRole('button',{name:'核对本次提交结果',exact:true}).waitFor();
        assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),'合成失败输入须保留');
        await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=189');delete clients.compiler;
        await page.getByRole('button',{name:'核对本次提交结果',exact:true}).click();
        await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();
        await page.locator('#login-name').fill('SYNTHETIC_compiler');await page.locator('#login-password').fill(fixture.loginPassword);
        await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByLabel('问题答复',{exact:true}).waitFor();
        assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),'合成失败输入须保留');
        await page.getByRole('button',{name:'核对本次提交结果',exact:true}).click();
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存问题答复'&&!b.disabled));
        for(const status of [403,409]) {
          await page.route('**/authoring-issues/*/reply',route=>route.fulfill({status,contentType:'application/json',body:'{"error":"合成失败"}'}),{times:1});
          await page.getByRole('button',{name:'保存问题答复',exact:true}).click();
          await page.getByRole('button',{name:'核对本次提交结果',exact:true}).waitFor();
          assert.equal(await page.getByLabel('问题答复',{exact:true}).inputValue(),'合成失败输入须保留');
          await page.getByRole('button',{name:'核对本次提交结果',exact:true}).click();
          await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='保存问题答复'&&!b.disabled));
        }
        await page.getByRole('button',{name:'保存问题答复',exact:true}).click();
        await page.getByText('答复已保存到原问题历史。本次没有关联办公室任务，问题仍须有权人员复核。',{exact:true}).waitFor();
        await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='查看关联治理问题与任务'&&!b.disabled));
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();
        await page.getByRole('button',{name:'答复问题'+issueId,exact:true}).click();
        await page.getByLabel('问题答复',{exact:true}).fill('合成未提交输入，人工办理另行验收');
        assert.equal(await page.evaluate(()=>visualViewport.scale),1); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,'desktop-issues.png'),fullPage:true});
        await page.screenshot({path:path.join(output,'desktop-issues-viewport.png.md')});
        page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'放弃本次编辑',exact:true}).click();
        await page.goto(fixture.baseURL+'/app/offices?office_id=19');
        await page.locator('#office-task-'+dispatched.todo_id).getByText('流程编制者答复',{exact:true}).waitFor();
        await page.getByText('最多展示最近50条答复，历史保留。',{exact:true}).first().waitFor();
        assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,'desktop-office-viewport.png.md')});
        await page.screenshot({path:path.join(output,'desktop-office.png'),fullPage:true}); assert.deepEqual(errors,[]);
        await page.goto(fixture.baseURL+'/app/process-preview?case='+caseId);
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).waitFor();
        let release,arrive,finish;
        const delayed=new Promise(r=>release=r),arrived=new Promise(r=>arrive=r),finished=new Promise(r=>finish=r);
        await page.route('**/authoring-issues',async route=>{const response=await route.fetch();arrive();await delayed;await route.fulfill({response});finish();},{times:1});
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();await arrived;
        await page.getByRole('link',{name:'当前身份',exact:true}).click();release();await finished;
        await page.waitForTimeout(100);assert.equal(await page.getByText('关联治理问题与任务',{exact:true}).count(),0);
        assert.deepEqual(errors,[]);
      } finally {await browser.close();}
    });
    await check('new preview revision marks old fixed-source reply unavailable and leaves issue history intact',async()=>{
      const current=await ex('compiler',root+'/'+caseId), document=structuredClone(current.revision.document); document.process.purpose+=' 合成新修订';
      await ex('compiler',root+'/'+caseId+'/revisions','POST',{...bind(current),document,source_file_name:'changed.json'},201);
      const latest=(await ex('compiler',base)).items[0]; assert.equal(latest.source_current,false); assert.equal(latest.can_reply,false);
      const updated=await ex('compiler',root+'/'+caseId);
      await ex('compiler',url,'POST',{...command(updated,latest),todo_id:undefined,expected_task_revision:undefined},409);
      assert.equal(latest.replies.length,4);
    });
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,scope:'owned synthetic MySQL/HTTP/Edge only; exact fixed V7 case sources; no formal enablement or business acceptance'},null,2));
  },{authoring:true,randomDatabase:true,evidenceDir:output}); } finally { flags.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}); }
}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error);process.exitCode=1;});
