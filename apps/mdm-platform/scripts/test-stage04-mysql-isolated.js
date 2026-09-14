// Real app HTTP + persistent sessions + real MySQL transactions, synthetic data only.
// Explicit DDL is limited to a fresh owned tmpfs container, including a rollback fault trigger.
// Does not consume stage06 backups, historical data or existing MySQL instances.
const assert=require('node:assert/strict');
const path=require('node:path');
const http=require('node:http');
const crypto=require('node:crypto');
const {fork}=require('node:child_process');
const {once}=require('node:events');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const appRoot=path.resolve(__dirname,'..');
const passed=[];
const pass=name=>{passed.push(name);console.log('PASS '+name);};

async function runMysqlHttpScenario(context, hooks = {}) {
    const {pool,port,password,database='stage04_isolated'}=context;
    if (hooks.prepareSchema) await hooks.prepareSchema(context);
    else {
    const identity=require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
    await identity.initSchema(); // Explicit synthetic fixture setup, never an application request.
    const design=require('../server/routes/processDesignMysql');
    for(const name of ['ensureProcessDesignEditionSchema','ensureProcessDesignEvidenceStatusSchema','ensureProcessDesignFormStructureSchema','ensureProcessDesignStepTransitionSchema']) await design[name](pool);
    await require('../server/sessionMigration').manageSessionSchema(pool,'apply');
    await require('../server/processV7PreviewReviewMigration').applyProcessV7PreviewReview(pool);
    await require('../server/processV7FormalMigration').applyProcessV7FormalFoundation(pool);
    }
    for(const [id,name] of [[91,'合成甲部'],[92,'合成乙部'],[93,'合成丙部']]) await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)',[id,'SYNTHETIC_'+id,name]);
    const actors=[['admin','admin',91],['lead','mdm_lead',91],['contact','department_contact',91],['reviewA','department_mdm_reviewer',91],['reviewB','department_mdm_reviewer',92],['outsider','department_mdm_reviewer',93],['first','department_contact',91]];
    const passwordHash=require('bcryptjs').hashSync(password,10);
    for(let i=0;i<actors.length;i++) {
      const [name,role,dept]=actors[i]; const personId=81+i;
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[personId,'SYNTHETIC_'+name,'合成'+name,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',?)",[181+i,personId,'SYNTHETIC_'+name,passwordHash,name==='first'?1:0]);
      const global=['admin','mdm_lead'].includes(role);
      await pool.execute('INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,?,CURRENT_DATE FROM roles WHERE role_code=?',[personId,global?'global':'department',global?null:dept,'stage04 synthetic authorization',role]);
    }
    await pool.query("CREATE USER 'stage04_runtime'@'%' IDENTIFIED BY ?",[password]);
    assert.match(database, /^stage\d{2}_isolated$/);
    await pool.execute(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${database}.* TO 'stage04_runtime'@'%'`);
    const [mysqlVersion]=await pool.execute('SELECT VERSION() AS version');
    const document=require('../../structured-output-service/server').createEmptyProcessGovernanceV7Document();
    document.export_meta.package_ref='package_stage04_synthetic'; document.process.process_ref='process_stage04_synthetic';
    document.process.process_name='第04阶段合成安全流程'; document.process.owning_department='合成甲部';
    document.behaviors=[['prepare','合成甲部'],['review','合成乙部']].map(([name,dept])=>({
      behavior_ref:'behavior_'+name,node_type:'action',behavior_name:dept+'核对合成材料',behavior_description:'',current_actor_role:dept+'经办人',
      actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'',precondition:'',input_description:'',timing:null,
      completion_standard:'已核对合成材料。',output_description:'',countersign_all_required:false,countersign_target_departments:[]
    }));
    document.flow_relations=[{relation_ref:'relation_prepare_review',relation_type:'sequence',from_behavior_ref:'behavior_prepare',to_behavior_ref:'behavior_review',condition:''}];
    const runtime=isolatedEnvironment({NODE_ENV:'test',HOST:'127.0.0.1',MDM_ACCESS_MODE:'http-local',MDM_SESSION_STORE:'mysql',
      MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_USER:'stage04_runtime',MYSQL_PASSWORD:password,MYSQL_DATABASE:database,
      MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
      PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1',PROCESS_V7_TRIAL_PROCESS_REF:document.process.process_ref,PROCESS_DATA_GOVERNANCE_ENABLED:'0'});
    const reserve=http.createServer(); reserve.listen(0,'127.0.0.1');await once(reserve,'listening');
    const appPort=reserve.address().port;await new Promise(r=>reserve.close(r));
    assert.ok(![3000,3001,5173].includes(appPort));
    let child; const output=[]; const clients={};
    async function stop() {
      if(!child) return;
      const current=child;child=null;
      if(current.exitCode!==null) return;
      const exited=once(current,'exit');current.send('mdm:stop',()=>{});
      const timer=setTimeout(()=>current.kill(),16000);await exited;clearTimeout(timer);
    }
    async function start(overrides={}) {
      await stop();
      child=fork(path.join(appRoot,'server/index.js'),[],{cwd:appRoot,env:{...runtime,...overrides,PORT:String(appPort)},execArgv:[],silent:true,windowsHide:true});
      child.stdout.on('data',d=>output.push(String(d)));child.stderr.on('data',d=>output.push(String(d)));
      for(let i=0;i<100;i++) {try{if((await fetch(`http://127.0.0.1:${appPort}/api/health`)).ok)return;}catch{} await sleep(100);}
      throw Error('STAGE04_APP_NOT_READY');
    }
    async function request(who,url,method='GET',body,csrf=true) {
      const c=clients[who]||(clients[who]={});
      const r=await fetch(`http://127.0.0.1:${appPort}`+url,{method,headers:{'Content-Type':'application/json',Cookie:c.cookie||'',...(csrf&&c.csrf?{'X-CSRF-Token':c.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(r.headers.get('set-cookie'))c.cookie=r.headers.get('set-cookie').split(';')[0];
      return {status:r.status,body:await r.json()};
    }
    async function expect(who,url,method,body,status) {const r=await request(who,url,method,body);assert.equal(r.status,status,`${who} ${method} ${url}: ${JSON.stringify(r.body)}`);return r.body;}
    async function login(who,secret=password) {clients[who]={};await expect(who,'/api/org/login','POST',{loginName:'SYNTHETIC_'+who,password:secret},200);clients[who].csrf=(await expect(who,'/api/csrf-token','GET',undefined,200)).csrfToken;}
    const businessTables=['process_v7_preview_cases','process_v7_preview_revisions','process_v7_preview_review_items','process_v7_preview_events','process_v7_promotions','process_design_documents','process_design_drafts','process_design_review_tasks','process_design_versions','process_design_events'];
    async function snapshot(tables=businessTables) {const result={};for(const table of tables){const [rows]=await pool.execute(`SELECT * FROM ${table} ORDER BY id`);result[table]={count:rows.length,digest:hash(rows)};}return result;}
    const binding=c=>({expected_revision_no:c.current_revision_no,expected_content_hash:c.current_content_hash});
    const formalBinding=d=>({expected_revision_no:d.revision_no,expected_content_hash:d.content_hash});
    try {
      await start();
      const health=await expect('anonymous','/api/health','GET',undefined,200);
      assert.deepEqual(health.version,require('../server/runtimeVersion').runtimeVersion());
      if(hooks.onRuntime) await hooks.onRuntime({appPort,version:health.version});
      await expect('anonymous','/api/process-v7-preview/cases','POST',{document,source_file_name:'synthetic.json'},401);
      for(const [who] of actors)await login(who);
      assert.equal((await request('first','/api/org/departments')).body.code,'PASSWORD_CHANGE_REQUIRED');
      await expect('first','/api/org/me/password','POST',{current_password:password,new_password:'000000'},400);
      const newPassword=crypto.randomBytes(24).toString('hex');
      await expect('first','/api/org/me/password','POST',{current_password:password,new_password:newPassword},200);
      await login('first',newPassword);await expect('first','/api/org/departments','GET',undefined,200);
      pass('real first-password flow and ordinary login');
      const empty=await snapshot();
      await expect('admin','/api/process-v7-preview/cases','POST',{document,source_file_name:'synthetic.json'},403);
      await expect('outsider','/api/process-v7-preview/cases','POST',{document,source_file_name:'synthetic.json'},403);
      assert.equal((await request('contact','/api/process-v7-preview/cases','POST',{document},false)).status,403);
      assert.deepEqual(await snapshot(),empty);
      const created=await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'synthetic.json'},201);
      assert.equal(created.preview_only,true);assert.equal(created.publishable,false);assert.equal(created.formal_process_version_id,null);
      const caseId=created.case.id;let detail=created;
      const formalTables=businessTables.filter(t=>t.startsWith('process_design_'));
      assert.deepEqual(await snapshot(formalTables),Object.fromEntries(formalTables.map(t=>[t,empty[t]])),'preview must not write formal tables');
      const one=await snapshot();
      const repeated=await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'synthetic.json'},200);
      assert.equal(repeated.idempotent,true);assert.deepEqual(await snapshot(),one);
      pass('preview isolation, duplicate upload, admin/no-permission/CSRF zero-write');
      await expect('outsider',`/api/process-v7-preview/cases/${caseId}`,'GET',undefined,403);
      await expect('outsider',`/api/process-v7-preview/items/${detail.items[0].id}/decision`,'POST',{...binding(detail.case),decision:'confirmed',basis:'合成越权'},403);
      assert.deepEqual(await snapshot(),one);
      for(const who of ['reviewA','reviewB']) await expect(who,`/api/process-v7-preview/items/${detail.items[0].id}/decision`,'POST',{...binding(detail.case),decision:'confirmed',basis:'合成核对依据'},200);
      detail=await expect('lead',`/api/process-v7-preview/cases/${caseId}`,'GET',undefined,200);assert.equal(detail.case.status,'review_complete');
      const target={mode:'create',document_no:'STAGE04-SYNTHETIC',document_title:document.process.process_name};
      const promoted=await expect('lead',`/api/process-v7-preview/cases/${caseId}/promote`,'POST',{...binding(detail.case),target},201);
      let draft=promoted.draft;const draftId=draft.id;
      const submitted=await expect('contact',`/api/process-design/drafts/${draftId}/submit`,'POST',formalBinding(draft),200);
      await expect('reviewA',`/api/process-design/review-tasks/${submitted.reviewTask.id}/decision`,'POST',{...formalBinding(draft),decision:'needs_changes',note:'合成退回修改'},200);
      pass('separate departments confirm, controlled promotion and formal return');
      const changed=clone(document);changed.behaviors[1].completion_standard='已核对并记录合成依据。';
      const beforeDiff=await snapshot();
      const diff=await expect('contact',`/api/process-v7-preview/cases/${caseId}/revisions/preview`,'POST',{...binding(detail.case),document:changed},200);
      assert.equal(diff.comparison.counts.reopened,1);assert.deepEqual(await snapshot(),beforeDiff);
      const revisionBody={...binding(detail.case),document:changed,source_file_name:'synthetic-r2.json'};
      const revisions=await Promise.all([request('contact',`/api/process-v7-preview/cases/${caseId}/revisions`,'POST',revisionBody),request('contact',`/api/process-v7-preview/cases/${caseId}/revisions`,'POST',revisionBody)]);
      assert.deepEqual(revisions.map(r=>r.status).sort(),[201,409]);
      detail=await expect('lead',`/api/process-v7-preview/cases/${caseId}`,'GET',undefined,200);
      assert.equal(detail.case.current_revision_no,2);assert.equal(detail.items[0].origin_status,'pending');assert.equal(detail.items[0].counterparty_status,'pending');
      for(const who of ['reviewA','reviewB']) await expect(who,`/api/process-v7-preview/items/${detail.items[0].id}/decision`,'POST',{...binding(detail.case),decision:'confirmed',basis:'合成修订2依据'},200);
      detail=await expect('lead',`/api/process-v7-preview/cases/${caseId}`,'GET',undefined,200);
      const repromoted=await expect('lead',`/api/process-v7-preview/cases/${caseId}/promote`,'POST',{...binding(detail.case),target:{mode:'existing',document_id:promoted.document.id}},201);
      draft=repromoted.draft;assert.equal(draft.id,draftId);
      const staleBefore=await snapshot();
      await expect('contact',`/api/process-design/drafts/${draftId}/submit`,'POST',formalBinding(promoted.draft),409);
      assert.deepEqual(await snapshot(),staleBefore);
      const resubmitted=await expect('contact',`/api/process-design/drafts/${draftId}/submit`,'POST',formalBinding(draft),200);
      await expect('reviewA',`/api/process-design/review-tasks/${resubmitted.reviewTask.id}/decision`,'POST',{...formalBinding(promoted.draft),decision:'approve',note:'过期合成意见'},409);
      await expect('reviewA',`/api/process-design/review-tasks/${resubmitted.reviewTask.id}/decision`,'POST',{...formalBinding(draft),decision:'approve',note:'合成当前修订审核通过'},200);
      pass('revision comparison/reopen, concurrent revision conflict, stale submit/review and reprocessing');
      const beforePublish=await snapshot();
      await expect('admin',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft),403);
      await expect('outsider',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft),403);
      await pool.query("CREATE TRIGGER stage04_publish_failure BEFORE INSERT ON process_design_events FOR EACH ROW BEGIN IF NEW.event_type='publish' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='STAGE04_SYNTHETIC_PUBLISH_FAILURE'; END IF; END");
      await expect('lead',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft),500);
      assert.deepEqual(await snapshot(),beforePublish,'late audit fault rolls back version/draft/document/event together');
      await pool.query('DROP TRIGGER stage04_publish_failure');
      const publishes=await Promise.all([request('lead',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft)),request('lead',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft))]);
      assert.deepEqual(publishes.map(r=>r.status).sort(),[200,409]);
      const published=publishes.find(r=>r.status===200).body;
      assert.ok(published.process_version_id);
      const readback=await expect('contact',`/api/process-design/versions/${published.process_version_id}/content`,'GET',undefined,200);
      assert.equal(readback.content_hash_verified,true);assert.deepEqual(readback.document,changed);
      await expect('outsider',`/api/process-design/versions/${published.process_version_id}/content`,'GET',undefined,403);
      const afterPublish=await snapshot();
      await expect('lead',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft),409);
      assert.deepEqual(await snapshot(),afterPublish);
      pass('real publish rollback, concurrent/repeated uniqueness and immutable full V7 readback');
      await start({PROCESS_V7_PREVIEW_ENABLED:'0',PROCESS_V7_FORMAL_ENABLED:'0'});
      const closedBefore=await snapshot();
      await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'closed.json'},503);
      await expect('lead',`/api/process-design/drafts/${draftId}/publish`,'POST',formalBinding(draft),503);
      assert.deepEqual(await snapshot(),closedBefore);
      await start({PROCESS_V7_TRIAL_PROCESS_REF:'different_synthetic_process'});
      await expect('contact','/api/process-v7-preview/cases','POST',{document,source_file_name:'outside.json'},403);
      await expect('lead',`/api/process-v7-preview/cases/${caseId}/promote`,'POST',{...binding(detail.case),target},403);
      assert.deepEqual(await snapshot(),closedBefore);
      pass('closed switches and exact trial scope reject without business writes');
      // A synthetic historical V3 row remains readable through the supported version endpoint.
      const v3=require('../server/processGovernanceV2').createEmptyProcessGovernanceDocument({process_name:'合成V3历史版本',owning_department:'合成甲部'});
      const v3Hash=require('../server/processGovernanceV2').normalizeProcessGovernanceDocument(v3).content_hash;
      const [v3Doc]=await pool.execute("INSERT INTO process_design_documents(document_no,document_title,owning_department_id) VALUES ('STAGE04-V3','合成V3历史版本',91)");
      const [v3Draft]=await pool.execute("INSERT INTO process_design_drafts(document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,status) VALUES (?,'STAGE04-V3','合成V3历史版本','A','合成V3','合成兼容夹具','现场实际','合成依据',91,'published')",[v3Doc.insertId]);
      const [v3Version]=await pool.execute("INSERT INTO process_design_versions(draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash) VALUES (?,?,'STAGE04-V3','合成V3历史版本','A','STAGE04-V3-A',91,'process-governance-v3',?,?)",[v3Draft.insertId,v3Doc.insertId,JSON.stringify(v3),v3Hash]);
      const v3Before=await snapshot(formalTables);
      const v3Read=await expect('contact',`/api/process-design/versions/${v3Version.insertId}/content`,'GET',undefined,200);
      assert.equal(v3Read.schema_version,'process-governance-v3');assert.deepEqual(v3Read.document,v3);
      assert.deepEqual(await snapshot(formalTables),v3Before);
      pass('synthetic historical V3 full content remains readable without migration or writes');
      // Account operations use the real identity API; role revocation must invalidate old sessions.
      await expect('admin','/api/org/accounts/86/disable','POST',{reason:'合成停用'},200);
      await expect('outsider','/api/org/me','GET',undefined,401);
      // A second synthetic role keeps the account active: test revocation independently of disable.
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 83,role_id,'department',91,'stage04 synthetic remaining role',CURRENT_DATE FROM roles WHERE role_code='department_mdm_reviewer'");
      const [beforeRevocation]=await pool.execute('SELECT account_status,auth_version FROM user_accounts WHERE person_id=83');
      const [assignments]=await pool.execute("SELECT pr.person_role_id FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=83 AND r.role_code='department_contact'");
      await expect('admin',`/api/org/accounts/83/role-assignments/${assignments[0].person_role_id}/revoke`,'POST',{reason:'合成撤权',disableAccount:false},200);
      const [afterRevocation]=await pool.execute('SELECT account_status,auth_version FROM user_accounts WHERE person_id=83');
      assert.equal(afterRevocation[0].account_status,'active');
      assert.equal(afterRevocation[0].auth_version,beforeRevocation[0].auth_version+1);
      assert.equal((await expect('contact','/api/org/me','GET',undefined,401)).code,'SESSION_AUTHORIZATION_CHANGED');
      await login('contact');await expect('contact','/api/org/me','GET',undefined,200);
      const [audit]=await pool.execute("SELECT event_type FROM identity_access_events WHERE event_type IN ('account_disabled','role_revoked')");
      assert.ok(audit.some(event=>event.event_type==='account_disabled'));
      assert.ok(audit.some(event=>event.event_type==='role_revoked'));
      pass('real admin account disable/revoke, stale sessions and access audit');
      if(hooks.afterHttp) await hooks.afterHttp({...context,request,expect});
    } finally {await stop();}
    console.log(JSON.stringify({result:'STAGE04_MYSQL_HTTP_PASS',mysqlVersion:mysqlVersion[0].version,passed,dependency:'fresh mysql:8.4, real HTTP/auth/CSRF/session/repositories; synthetic data; no historical restore'}));
    return {passed:[...passed],mysqlVersion:mysqlVersion[0].version};
}
async function main() { return withFreshMysql(runMysqlHttpScenario); }
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={runMysqlHttpScenario};
