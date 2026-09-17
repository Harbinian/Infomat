// P17: owned MySQL/HTTP/Edge, synthetic identities and imported office memberships.
const assert = require('node:assert/strict'), crypto = require('node:crypto');
module.exports = async ctx => {
  const { pool,repo,lead,run,historical,check,save,backup,restore,expect } = ctx;
  const uuid = () => crypto.randomUUID(), own = [];
  const test = async (name,fn) => { await check('P17 '+name,fn); own.push(name); };
  const migration = require('../../server/analysisTaskMigration');
  const db = await pool.getConnection();
  try { await require('../../server/analysisIssueMigration').applyAnalysisIssues(db); await require('../../server/officeSchema').manageOfficeSchema(db,'apply'); } finally { db.release(); }
  const apply = async () => { const c = await pool.getConnection(); try { return await migration.applyAnalysisTasks(c); } finally { c.release(); } };
  await test('missing gate, exact-target CLI dry-run, interrupted DDL, repeat apply and drift', async () => {
    await assert.rejects(repo.getAnalysisIssueTasks(lead,'1'),e=>e.code==='DEFINITION_ANALYSIS_TASK_MIGRATION_REQUIRED');
    const cfg=pool.pool.config.connectionConfig,target=`${cfg.host}:${cfg.port}/${cfg.database}`;
    const env=require('./isolatedProcess').isolatedEnvironment({MYSQL_HOST:cfg.host,MYSQL_PORT:String(cfg.port),MYSQL_USER:cfg.user,MYSQL_PASSWORD:cfg.password,MYSQL_DATABASE:cfg.database});
    const cli=args=>require('node:child_process').execFileSync(process.execPath,[require.resolve('../manage-analysis-tasks'),...args],{env,encoding:'utf8',timeout:30000,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const before=await migration.inspectAnalysisTasks(pool); assert.equal(before.missing.length,1); assert.deepEqual(before.drift,[]);
    assert.deepEqual(JSON.parse(cli(['--target',target])),before); assert.throws(()=>cli(['--apply','--target','wrong']));
    await pool.execute(require('../../server/analysisTaskSchema').statements()[0]);
    assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_analysis_issue_tasks'))[0][0].n,0);
    await pool.execute('DROP TABLE data_map_analysis_issue_tasks'); // Exact owned empty partial table only.
    await pool.execute(require('../../server/analysisTaskSchema').statements()[0]);
    assert.equal(JSON.parse(cli(['--apply','--target',target])).ready,true); assert.equal((await apply()).ready,true);
    await pool.execute('ALTER TABLE data_map_analysis_issue_tasks ADD COLUMN p17_drift INT');
    await assert.rejects(apply(),e=>e.code==='DEFINITION_ANALYSIS_SCHEMA_DRIFT');
    await pool.execute('ALTER TABLE data_map_analysis_issue_tasks DROP COLUMN p17_drift');
    save('p17-migration.json',{before,after:await migration.inspectAnalysisTasks(pool),empty_compensation:true,repeated:true});
  });
  const dump=backup();
  try {
    const spreadsheet=require('../../server/publicationSpreadsheet'), publication=require('../../server/publicationRepository').makePublicationRepository(pool);
    const publish=async(kind,headers,rows)=>{const value=spreadsheet.normalizePublication({kind,title:'P17合成导入',sourceFileName:'p17-synthetic.xlsx',headers,rows,mapping:spreadsheet.suggestedMapping(kind,headers)});return publication.publish({content:value.content,...await publication.preview(value),requestId:uuid()},lead);};
    await publish('organization',['组织编码','组织名称','组织层级','归口部门编码','办公室负责人工号'],[['P17_A','P17合成核实办公室','办公室','SYNTHETIC_91','SYNTHETIC_contact'],['P17_B','P17合成另一办公室','办公室','SYNTHETIC_92','SYNTHETIC_reviewA']]);
    await publish('roster',['工号','姓名','部门编码','办公室编码'],[['SYNTHETIC_reviewB','合成reviewB','SYNTHETIC_92','P17_A'],['SYNTHETIC_outsider','合成outsider','SYNTHETIC_93','P17_A']]);
    const [offices]=await pool.execute("SELECT CAST(org_unit_id AS CHAR) id FROM org_unit WHERE org_unit_code IN ('P17_A','P17_B') ORDER BY org_unit_code"); const officeId=offices[0].id;
    const f=historical.attempts[0].findings[0], evidence=historical.attempts[0].evidence.filter(e=>f.evidence_keys.includes(e.evidence_key)&&e.locator_kind==='json_pointer');
    const created=await repo.decideAnalysisFinding(lead,{request_id:uuid(),run_id:run.run_id,finding_id:f.finding_id,expected_revision:1,action:'create',title:'P17合成问题',owner_department_id:'91',owner_basis:'合成业务明确归口',reason:'合成核验依据',evidence_ids:evidence.map(e=>e.evidence_id)});
    const issueId=created.issue_id,url='/api/analysis/issues/'+issueId, initial=await repo.getAnalysisIssueTasks(lead,issueId);
    const payload={request_id:uuid(),expected_revision:initial.revision_no,expected_issue_digest:initial.issue_digest,office_id:officeId,purpose:'verify',round_no:1,instruction:'P17_ONLY_ASSIGNEE_CONTEXT：请核对合成接收条件，记录结果，不含原材料。'};
    let dispatched;
    await test('dispatch authorization, explicit office scope, stale revision and admin readonly',async()=>{
      await expect('contact',url+'/tasks','POST',payload,403); await expect('admin',url+'/tasks','POST',payload,403);
      await expect('adminMulti',url+'/tasks','POST',payload,404);
      await expect('lead',url+'/tasks','POST',{...payload,office_id:offices[1].id},404);
      await expect('lead',url+'/tasks','POST',{...payload,expected_revision:999},409);
      await expect('lead',url+'/tasks','POST',{...payload,office_id:''},400);
      await assert.rejects(repo.dispatchAnalysisIssueTask({...lead,authVersion:999},{...payload,issue_id:issueId}),e=>e.code==='DEFINITION_AUTH_REQUIRED');
      assert.equal((await repo.getAnalysisIssueTasks(lead,issueId)).items.length,0);
    });
    await test('halfway failure rolls back todo assignment link receipt and issue revision',async()=>{
      const [[before]]=await pool.execute('SELECT COUNT(*) n FROM mdm_todos');
      await pool.query("CREATE TRIGGER p17_fail BEFORE INSERT ON data_map_analysis_issue_tasks FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='SYNTHETIC_P17_FAILURE'");
      await expect('lead',url+'/tasks','POST',payload,503); await pool.query('DROP TRIGGER p17_fail');
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM mdm_todos'))[0][0].n,before.n);
      assert.equal((await repo.getAnalysisIssueTasks(lead,issueId)).revision_no,initial.revision_no);
    });
    await test('concurrent duplicate dispatch returns same receipt; different request cannot duplicate action',async()=>{
      const results=await Promise.all([expect('lead',url+'/tasks','POST',payload),expect('lead',url+'/tasks','POST',payload)]);
      assert.deepEqual(results[0],results[1]); dispatched=results[0];
      await expect('lead',url+'/tasks','POST',{...payload,instruction:'changed'},409);
      await expect('lead',url+'/tasks','POST',{...payload,request_id:uuid(),expected_revision:dispatched.revision_no},409);
      assert.equal((await repo.getAnalysisIssueTasks(lead,issueId)).items.length,1);
    });
    const taskURL='/api/offices/tasks/'+dispatched.todo_id;
    await test('manager-only assignment; inactive membership, cross office and old revision rejected',async()=>{
      await expect('reviewA',taskURL+'/assign','POST',{assignee_person_id:85,expected_revision:1},403);
      await expect('admin',taskURL+'/assign','POST',{assignee_person_id:85,expected_revision:1},403);
      await expect('contact',taskURL+'/assign','POST',{assignee_person_id:84,expected_revision:1},422);
      await expect('contact',taskURL+'/assign','POST',{assignee_person_id:85,expected_revision:1});
      await expect('contact',taskURL+'/assign','POST',{assignee_person_id:85,expected_revision:1},409);
      await pool.execute("UPDATE office_membership SET status='inactive' WHERE office_id=? AND person_id=85",[officeId]);
      await expect('reviewB',taskURL+'/complete','POST',{expected_revision:2,note:'失效成员不得办理'},403);
      await expect('contact',taskURL+'/assign','POST',{assignee_person_id:85,expected_revision:2},422);
      await pool.execute("UPDATE office_membership SET status='active' WHERE office_id=? AND person_id=85",[officeId]);
    });
    await test('minimum task context never grants restricted issue or source access',async()=>{
      const member=await expect('reviewB','/api/offices/workbench?office_id='+officeId,'GET');
      assert.equal(member.tasks.find(t=>String(t.id)===dispatched.todo_id).analysis_task.instruction,payload.instruction);
      const outsider=await expect('outsider','/api/offices/workbench?office_id='+officeId,'GET');
      assert(!JSON.stringify(outsider).includes('P17_ONLY_ASSIGNEE_CONTEXT'));
      assert(!JSON.stringify(await expect('lead','/api/todos','GET')).includes('P17_ONLY_ASSIGNEE_CONTEXT'));
      await expect('reviewB',url,'GET',undefined,404); await expect('reviewB',url+'/tasks','GET',undefined,404);
      const personal=await expect('reviewB','/api/role-workbench?mode=todo','GET');
      assert(personal.workItems.some(t=>t.id==='office-task:'+dispatched.todo_id));
      save('p17-minimal-context.json',{task:member.tasks.find(t=>String(t.id)===dispatched.todo_id),outsider_hidden:true,source_access_denied:true});
    });
    await test('completion stays done without closing issue; legacy writes and unconfirmed review rejected',async()=>{
      await expect('contact',taskURL+'/complete','POST',{expected_revision:2,note:'负责人不能代办'},403);
      await expect('reviewB',taskURL+'/complete','POST',{expected_revision:1,note:'过期'},409);
      await expect('reviewB',taskURL+'/complete','POST',{expected_revision:2,note:'合成核实结果：条件仍缺失，请继续处理'});
      await expect('reviewB',taskURL+'/complete','POST',{expected_revision:2,note:'重复'},409);
      assert.equal((await repo.getAnalysisIssue(lead,issueId)).issue.display_status,'waiting_my_action');
      await expect('lead',url+'/review','POST',{expected_revision:dispatched.revision_no,decision:'close'},404);
      await expect('admin',url+'/review','POST',{decision:'close'},404);
      await assert.rejects(repo.reviewAnalysisIssueTask(lead,issueId),e=>e.code==='DEFINITION_ANALYSIS_TASK_REVIEW_AUTHORITY_UNCONFIRMED');
      await assert.rejects(require('../../server/processGovernanceIssuePoolRepository').makeProcessGovernanceIssuePoolRepository(pool).closeIssue(issueId),e=>e.code==='DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED');
      const prior=await repo.getAnalysisIssueTasks(lead,issueId);
      await expect('lead',url+'/tasks','POST',{...payload,request_id:uuid(),expected_revision:prior.revision_no,round_no:2,instruction:'再次核实，保留前轮已办结历史'});
      const next=await repo.getAnalysisIssueTasks(lead,issueId); assert.deepEqual(next.items[0],prior.items[0]); assert.equal(next.items.length,2);
      save('p17-task-history.json',next);
    });
    await test('ordinary office todo remains compatible',async()=>{
      const ordinary=await expect('lead','/api/offices/tasks','POST',{request_id:uuid(),office_id:officeId,content:'P17普通任务回归'},201);
      await expect('contact',`/api/offices/tasks/${ordinary.id}/assign`,'POST',{assignee_person_id:85,expected_revision:1});
      await expect('reviewB',`/api/offices/tasks/${ordinary.id}/complete`,'POST',{note:'普通办理结果',expected_revision:2});
      assert(!(await expect('contact','/api/offices/workbench?office_id='+officeId,'GET')).tasks.find(t=>t.id===ordinary.id).analysis_task);
    });
    await test('source head changes prevent fresh dispatch without altering prior actions',async()=>{
      const before=await repo.getAnalysisIssueTasks(lead,issueId);
      const [[mapping]]=await pool.execute('SELECT revision_no FROM data_map_v7_mappings WHERE mapping_id=?',[ctx.mapping.mapping_id]);
      await pool.execute('UPDATE data_map_v7_mappings SET revision_no=revision_no+1 WHERE mapping_id=?',[ctx.mapping.mapping_id]);
      await expect('lead',url+'/tasks','POST',{...payload,request_id:uuid(),expected_revision:before.revision_no,purpose:'coordinate'},409);
      await pool.execute('UPDATE data_map_v7_mappings SET revision_no=? WHERE mapping_id=?',[mapping.revision_no,ctx.mapping.mapping_id]);
      assert.deepEqual(await repo.getAnalysisIssueTasks(lead,issueId),before);
    });
    await require('./analysisTaskBrowserVerification')({...ctx,test,issueId,officeId,findingId:f.finding_id});
    const before=await repo.getAnalysisIssueTasks(lead,issueId),snapshot=backup();
    await pool.execute("UPDATE data_map_analysis_issue_tasks SET snapshot_digest=REPEAT('0',64) WHERE todo_id=?",[dispatched.todo_id]);
    await assert.rejects(repo.getAnalysisIssueTasks(lead,issueId),e=>e.code==='DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT');
    restore(snapshot); assert.deepEqual(await repo.getAnalysisIssueTasks(lead,issueId),before);
    save('p17-backup-restore.json',{sha256:crypto.createHash('sha256').update(snapshot).digest('hex'),equal:true,persisted:false});
    save('p17-results.json',{passed:true,checks:own,closure_enabled:false,review_authority_unconfirmed:true,formal_environment:false,human_acceptance:false});
  } finally { restore(dump); }
};
