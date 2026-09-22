// P17 continuation: real owned MySQL + API, per-issue authority and retained history.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
module.exports=async ctx=>{
  const {pool,repo,lead,contact,expect,test,save,issueId,officeId,backup,restore}=ctx;
  const uuid=()=>crypto.randomUUID(),url='/api/analysis/issues/'+issueId;
  const state=()=>repo.getAnalysisIssueClosure(contact,issueId);
  const bind=s=>({request_id:uuid(),expected_revision:s.revision_no,expected_issue_digest:s.issue_digest,expected_context_digest:s.context_digest});
  const designate=s=>({...bind(s),action:'designate',reviewer_person_id:'82',conditions:['接收条件已有明确办理证据'],reason:'合成归口部门最终负责人本人确认关闭条件'});
  const decision=(s,pass)=>{const t=s.tasks.filter(t=>t.status==='done'&&t.completion).at(-1);return {...bind(s),action:'review',reason:pass?'已逐项核对固定来源和办理证据':'条件未满足，请补充接收说明',checks:s.assignment.conditions.map(c=>({condition_id:c.condition_id,satisfied:pass,basis:pass?'办理记录对应本条件，摘录已核对':'缺少完整接收条件',...(pass?{todo_id:t.todo_id,task_revision:t.revision_no,excerpt:t.completion.note.note}:{})}))};};
  await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
  await test('closure migration dry-run repeat drift and no legacy backfill',async()=>{
    const m=require('../../server/analysisClosureMigration'),c=await pool.getConnection();
    try{
      await c.execute('DELETE FROM schema_migrations WHERE migration_key=?',[m.MIGRATION_KEY]);
      await assert.rejects(state(),e=>e.code==='DEFINITION_ANALYSIS_CLOSURE_MIGRATION_REQUIRED');
      assert.equal((await c.execute('SELECT COUNT(*) n FROM data_map_analysis_issue_closure_events'))[0][0].n,0);
      await c.execute('DROP TABLE data_map_analysis_issue_closure_heads');
      await c.execute('DROP TABLE data_map_analysis_issue_closure_events');
      await c.execute(require('../../server/analysisClosureSchema').statements()[0]);
      assert.deepEqual((await m.inspectAnalysisClosure(c)).missing,['data_map_analysis_issue_closure_heads']);
      assert.equal((await m.applyAnalysisClosure(c)).ready,true);
      assert.equal((await m.inspectAnalysisClosure(c)).ready,true);assert.equal((await m.applyAnalysisClosure(c)).ready,true);
      const cfg=pool.pool.config.connectionConfig,env=require('./isolatedProcess').isolatedEnvironment({MYSQL_HOST:cfg.host,MYSQL_PORT:String(cfg.port),MYSQL_USER:cfg.user,MYSQL_PASSWORD:cfg.password,MYSQL_DATABASE:cfg.database});
      const result=require('node:child_process').execFileSync(process.execPath,[require.resolve('../manage-analysis-closure'),'--target',`${cfg.host}:${cfg.port}/${cfg.database}`],{env,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});assert.equal(JSON.parse(result).ready,true);
      await c.execute('ALTER TABLE data_map_analysis_issue_closure_events ADD COLUMN synthetic_drift INT');await assert.rejects(m.applyAnalysisClosure(c),e=>e.code==='DEFINITION_ANALYSIS_SCHEMA_DRIFT');await c.execute('ALTER TABLE data_map_analysis_issue_closure_events DROP COLUMN synthetic_drift');
      assert.equal((await state()).assignment,null);save('p17-closure-migration.json',{ready:true,repeat:true,drift_rejected:true,no_backfill:true,cli:true});
    }finally{c.release();}
  });
  await test('only current department final owner can appoint eligible nonparticipating reviewer',async()=>{
    const s=await state(),p=designate(s);assert(s.can_designate);assert(s.candidates.some(c=>c.person_id==='82'));assert(!s.candidates.some(c=>c.person_id==='85'));
    const ownerWorkbench=await expect('contact','/api/role-workbench?mode=todo','GET');assert(ownerWorkbench.workItems.some(t=>t.id==='analysis-closure:'+issueId));assert(ownerWorkbench.nextActions.length<=3);
    for(const who of ['lead','reviewA','adminMulti','outsider'])await expect(who,url+'/review','POST',p,404);
    await expect('contact',url+'/review','POST',{...p,reviewer_person_id:'83'},404);
    await expect('contact',url+'/review','POST',{...p,reviewer_person_id:'85'},404);
    await expect('contact',url+'/review','POST',{...p,expected_revision:999},409);
    const result=await expect('contact',url+'/review','POST',p);assert.deepEqual(await expect('contact',url+'/review','POST',p),result);
    await expect('contact',url+'/review','POST',{...p,reason:'不同输入'},409);
    assert.equal((await state()).assignment.reviewer.person_id,'82');
  });
  await test('pending actions block close; negative review keeps issue and no automatic dispatch',async()=>{
    let s=await state();await expect('lead',url+'/review','POST',decision(s,true),409);
    await expect('reviewA',url+'/review','POST',decision(s,false),404);await expect('contact',url+'/review','POST',decision(s,false),404);
    const count=s.tasks.length;await expect('lead',url+'/review','POST',decision(s,false));s=await state();assert.equal(s.status,'waiting_my_action');assert.equal(s.tasks.length,count);assert.equal(s.events.at(-1).action,'reject');
    await expect('lead',url+'/tasks','POST',{request_id:uuid(),expected_revision:s.revision_no,expected_issue_digest:s.issue_digest,office_id:officeId,purpose:'coordinate',round_no:1,instruction:'复核未通过后明确交办补充接收证据'});
    const pending=(await state()).tasks.filter(t=>t.purpose!=='review'&&t.status!=='done');
    for(const t of pending){await expect('contact',`/api/offices/tasks/${t.todo_id}/assign`,'POST',{assignee_person_id:85,expected_revision:t.revision_no});await expect('reviewB',`/api/offices/tasks/${t.todo_id}/complete`,'POST',{expected_revision:t.revision_no+1,note:'合成补充证据：接收条件已核对并记录'});}
    assert.equal((await state()).status,'waiting_my_action');
    const reviewerWorkbench=await expect('lead','/api/role-workbench?mode=todo','GET');assert(reviewerWorkbench.workItems.some(t=>t.id==='analysis-closure:'+issueId));assert(!(await expect('reviewA','/api/role-workbench?mode=todo','GET')).workItems.some(t=>t.id==='analysis-closure:'+issueId));
  });
  await test('fixed task/source/condition snapshots reject stale review and rollback half close',async()=>{
    let s=await state();const stale=decision(s,true);await expect('contact',url+'/review','POST',{...designate(s),conditions:['接收条件已有明确办理证据','记录已复核']});await expect('lead',url+'/review','POST',stale,409);
    s=await state();const p=decision(s,true);p.checks[0].task_revision=999;await expect('lead',url+'/review','POST',p,409);
    const changed=decision(s,true);changed.checks[0].excerpt='伪造摘录不得作为证据';await expect('lead',url+'/review','POST',changed,409);
    await pool.execute('UPDATE data_map_v7_mappings SET revision_no=revision_no+1 WHERE mapping_id=?',[ctx.mapping.mapping_id]);await expect('lead',url+'/review','POST',decision(s,true),409);await pool.execute('UPDATE data_map_v7_mappings SET revision_no=revision_no-1 WHERE mapping_id=?',[ctx.mapping.mapping_id]);
    await pool.query("CREATE TRIGGER p17_close_fail BEFORE INSERT ON data_map_analysis_issue_closure_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_CLOSURE_FAILURE'");
    await expect('lead',url+'/review','POST',decision(s,true),503);await pool.query('DROP TRIGGER p17_close_fail');assert.deepEqual(await state(),s);
  });
  await test('reviewer suspension persists after role restoration; owner must explicitly redesignate',async()=>{
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='revoked' WHERE pr.person_id=82 AND r.role_code='mdm_lead'");
    assert.equal((await state()).suspended,true);
    await pool.execute("UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET pr.assignment_status='active' WHERE pr.person_id=82 AND r.role_code='mdm_lead'");
    let s=await state();assert.equal(s.suspended,true);await expect('lead',url+'/review','POST',decision(s,true),404);
    await expect('contact',url+'/review','POST',designate(s));assert.equal((await state()).suspended,false);
    // Supported account lifecycle changes increment auth_version, even when no review request occurs during the gap.
    await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=82');
    assert.equal((await state()).suspended,true);
    await pool.execute('UPDATE user_accounts SET auth_version=auth_version-1 WHERE person_id=82');
    s=await state();assert(s.suspended);await expect('contact',url+'/review','POST',designate(s));
  });
  await test('candidate group is exact; historic assignees remain excluded after membership and assignment changes',async()=>{
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 85,role_id,'global','P17 synthetic candidate qualification',CURRENT_DATE FROM roles WHERE role_code='data_quality_auditor'");
    const s=await state();assert(!s.candidates.some(c=>c.person_id==='85'));await expect('contact',url+'/review','POST',{...designate(s),reviewer_person_id:'85'},404);
    await pool.execute("DELETE pr FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=85 AND r.role_code='data_quality_auditor'");
    await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');await expect('contact',url+'/review','POST',designate(s),404);await pool.execute('UPDATE departments SET final_responsible_person_id=83 WHERE id=91');
  });
  await test('positive close is idempotent, new-source linking and legacy close remain guarded; owner reopen preserves history',async()=>{
    let s=await state(),p=decision(s,true);
    const original=(await repo.getV7MappingHistory(lead,ctx.source.source_id,ctx.mapping.mapping_id)).items[0];
    await repo.saveV7Mapping(lead,ctx.source.source_id,{request_id:uuid(),expected_revision:original.revision_no,source_digest:original.source_digest,local_object_ref:original.local_object_ref,local_field_ref:null,object_version_id:original.object_version_id,field_version_id:null,status:original.status,basis:'合成来源修订变化，复核须明确重新核对'});
    await expect('lead',url+'/review','POST',p,409);s=await state();assert(s.source_heads.some(h=>h.original_ref!==h.current_ref));p=decision(s,true);
    const receipts=await Promise.all([expect('lead',url+'/review','POST',p),expect('lead',url+'/review','POST',p)]);assert.deepEqual(receipts[0],receipts[1]);
    s=await state();assert.equal(s.status,'closed');assert.equal(s.events.at(-1).action,'close');assert((await repo.getAnalysisIssue(lead,issueId)).issue.closed_at);
    await expect('lead',url+'/tasks','POST',{request_id:uuid(),expected_revision:s.revision_no,expected_issue_digest:s.issue_digest,office_id:officeId,purpose:'coordinate',round_no:1,instruction:'已关闭不得交办'},409);
    const reopen={...bind(s),action:'reopen',reviewer_person_id:'82',conditions:['新增证据已重新核对'],reason:'原关闭依据出现新情况',reopen_evidence:'合成新增证据 R-02：接收条件发生变化'};
    await expect('lead',url+'/review','POST',reopen,404);await expect('reviewA',url+'/review','POST',reopen,404);await expect('contact',url+'/review','POST',reopen);
    const after=await state();assert.equal(after.status,'waiting_my_action');assert.deepEqual(after.tasks,s.tasks);assert.deepEqual(after.events.slice(0,s.events.length),s.events);
    await expect('lead',url+'/review','POST',{...p,request_id:uuid()},409);save('p17-closure-api-history.json',after);
  });
  await require('./analysisClosureBrowserVerification')({...ctx,state,bind,designate,decision});
  await test('closure evidence integrity and backup restore keep previous appointments reviews and todo results',async()=>{
    const before=await state(),dump=backup();await pool.execute("UPDATE data_map_analysis_issue_closure_events SET snapshot_digest=REPEAT('0',64) WHERE issue_id=? ORDER BY event_id DESC LIMIT 1",[issueId]);await assert.rejects(state(),e=>e.code==='DEFINITION_ANALYSIS_CLOSURE_INTEGRITY_CONFLICT');restore(dump);assert.deepEqual(await state(),before);save('p17-closure-restore.json',{sha256:crypto.createHash('sha256').update(dump).digest('hex'),equal:true,persisted:false});
  });
};
