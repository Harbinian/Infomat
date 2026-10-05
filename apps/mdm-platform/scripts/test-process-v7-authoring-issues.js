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
    async function create(ref, transfer=true) {
      const document = structuredClone(fixture.document); document.process.process_ref = ref; document.process.process_name = '合成' + ref;
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
        for(const [module,action] of [['dataMapDefinitionMigration','applyDefinitions'],['v7MappingMigration','applyV7Mappings'],['designHandoffMigration','applyDesignHandoffs'],['analysisRunMigration','applyAnalysisRuns'],['analysisIssueMigration','applyAnalysisIssues']]) await require('../server/'+module)[action](db);
        await require('../server/officeSchema').manageOfficeSchema(db,'apply');
        await require('../server/analysisTaskMigration').applyAnalysisTasks(db);
      } finally {db.release();}
      assert.equal((await ex('compiler',base)).items.length,0);
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
      assert.equal((await ex('contact',base)).items[0].can_reply,false);
      await ex('peer',base,'GET',undefined,403); await ex('outsider',base,'GET',undefined,403);
      for(const who of ['contact','peer','adminMulti','outsider']) await ex(who,url,'POST',command(),403);
      await ex('compiler','/api/analysis/issues/'+issueId,'GET',undefined,404);
      assert(!JSON.stringify(work).includes('fixed_inputs')); assert(!JSON.stringify(work).includes('process_content_json'));
    });
    await check('atomic failure rolls back authoring start, issue/task events and revisions',async()=>{
      await pool.query("CREATE TRIGGER fail_compiler_reply BEFORE INSERT ON process_governance_issue_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_FAILURE'");
      await ex('compiler',url,'POST',command(),500); await pool.query('DROP TRIGGER fail_compiler_reply');
      assert.equal((await ex('compiler',root+'/'+caseId)).authoring.started_at,null);
      assert.equal((await ex('compiler',base)).items[0].replies.length,0);
      assert.equal((await ex('compiler',base)).items[0].revision_no,work.revision_no);
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
      await ex('compiler',pBase+'/'+linked.issueId+'/reply','POST',{...bind(latest),request_key:uuid(),content:'合成固定正式版本事实答复',expected_issue_revision:issue.revision_no,expected_issue_digest:issue.issue_digest});
      assert.equal((await ex('compiler',pBase)).items[0].replies.length,1);
      await ex('peer',pBase,'GET',undefined,403);
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
    await check('Edge desktop real task reply, lost response reconciliation, failed request and cancelled navigation preserve input',async()=>{
      const browser=await runtime().chromium.launch({channel:'msedge',headless:true});
      try {
        const page=await browser.newPage({viewport:{width:1699,height:828},deviceScaleFactor:1}),errors=[];
        page.on('pageerror',e=>errors.push(e.message));
        await page.goto(fixture.baseURL+'/app/process-preview?case='+caseId);
        await page.locator('#login-name').fill('SYNTHETIC_compiler'); await page.locator('#login-password').fill(fixture.loginPassword);
        await page.getByRole('button',{name:'登录',exact:true}).click();
        await page.getByRole('button',{name:'查看关联治理问题与任务',exact:true}).click();
        await page.getByRole('button',{name:'答复问题'+issueId,exact:true}).click();
        assert.equal(await page.locator('.preview-editor').evaluate(el=>el===document.activeElement),true);
        const note='合成页面答复：订单、客户和合同的对应依据仍待核验。';
        await page.getByLabel('问题答复',{exact:true}).fill(note);
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
        assert.equal(await page.evaluate(()=>visualViewport.scale),1); assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await page.screenshot({path:path.join(output,'desktop-issues.png'),fullPage:true});
        page.once('dialog',d=>d.accept()); await page.getByRole('button',{name:'放弃本次编辑',exact:true}).click();
        await page.goto(fixture.baseURL+'/app/offices?office_id=19');
        await page.getByText('流程编制者答复',{exact:true}).waitFor();
        await page.screenshot({path:path.join(output,'desktop-office.png'),fullPage:true}); assert.deepEqual(errors,[]);
      } finally {await browser.close();}
    });
    await check('new preview revision marks old fixed-source reply unavailable and leaves issue history intact',async()=>{
      const current=await ex('compiler',root+'/'+caseId), document=structuredClone(current.revision.document); document.process.purpose+=' 合成新修订';
      await ex('compiler',root+'/'+caseId+'/revisions','POST',{...bind(current),document,source_file_name:'changed.json'},201);
      const latest=(await ex('compiler',base)).items[0]; assert.equal(latest.source_current,false); assert.equal(latest.can_reply,false);
      const updated=await ex('compiler',root+'/'+caseId);
      await ex('compiler',url,'POST',{...command(updated,latest),todo_id:undefined,expected_task_revision:undefined},409);
      assert.equal(latest.replies.length,2);
    });
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,scope:'owned synthetic MySQL/HTTP/Edge only; exact fixed V7 case sources; no formal enablement or business acceptance'},null,2));
  },{authoring:true,evidenceDir:output}); } finally { flags.forEach((k,i)=>{if(prior[i]===undefined)delete process.env[k];else process.env[k]=prior[i];}); }
}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error);process.exitCode=1;});
