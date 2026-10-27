// Stage05 real HTTP/Edge fixture. Fresh labelled tmpfs MySQL, synthetic identities.
// Reuses the stage04 ownership-checked container helper. No private env, existing DB or formal service.
// --serve keeps this owned fixture until Enter/SIGINT; the browser runner uses the same lifetime.
// Callers may supply document/departments for an unreviewed source inspection;
// previewOnly disables formal writes. These options still use the owned temporary DB.
// randomDatabase uses a UUID-suffixed database inside that same owned container;
// the runtime grant/config and credential-free target record bind its exact name.
// departmentAccountability explicitly installs the policy and appoints only the
// synthetic reviewA/reviewB actors; legacy fixture callers remain unchanged.
// beforeStart and handoffEnabled explicitly opt into the owned stage05 handoff
// rehearsal. The callback receives only that temporary DB's pool and identity.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { fork } = require('node:child_process');
const { once } = require('node:events');
const http = require('node:http');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const appRoot = path.resolve(__dirname, '..');
const evidenceDir = path.resolve(appRoot, '../../artifacts/mdm-3000-launch/stage05-20260910');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function withStage05Fixture(action, options = {}) {
  if(options.authoringWorkspace!==undefined)assert.equal(typeof options.authoringWorkspace,'boolean');
  if(options.handoffEnabled!==undefined)assert.equal(typeof options.handoffEnabled,'boolean');
  if(options.terminologyEnabled!==undefined)assert.equal(typeof options.terminologyEnabled,'boolean');
  if(options.beforeStart!==undefined)assert.equal(typeof options.beforeStart,'function');
  const startupTimeoutMs=options.startupTimeoutMs===undefined?10000:options.startupTimeoutMs;
  assert(Number.isSafeInteger(startupTimeoutMs)&&startupTimeoutMs>=1000&&startupTimeoutMs<=120000,'startupTimeoutMs must be an explicit bounded startup budget');
  const evidenceDir = options.evidenceDir || path.resolve(appRoot, '../../artifacts/mdm-3000-launch/stage05-20260910');
  const candidateAt = process.argv.indexOf('--frontend-dist');
  const candidateDist = options.frontendDist || (candidateAt > 0 ? path.resolve(process.argv[candidateAt + 1]) : null);
  const modulesAt = process.argv.indexOf('--test-node-path');
  const testNodePath = options.testNodePath || (modulesAt > 0 ? path.resolve(process.argv[modulesAt + 1]) : null);
  const candidateRoot=options.candidateRoot||process.env.MDM_TEST_CANDIDATE_ROOT;
  if(candidateRoot){assert(path.resolve(candidateRoot).startsWith(path.resolve(appRoot,'../../artifacts')+path.sep));assert(fs.statSync(path.join(candidateRoot,'server/index.js')).isFile());}
  if (testNodePath) assert(testNodePath.startsWith(path.resolve(appRoot, '../../artifacts') + path.sep));
  if (candidateDist) {
    assert(candidateDist.startsWith(path.resolve(appRoot, '../../artifacts') + path.sep));
    assert(fs.statSync(path.join(candidateDist, 'index.html')).isFile());
  }
  await withFreshMysql(async ({ pool, port, password, owner, database, backup, restore }) => {
    const identity = require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
    await identity.initSchema();
    const design = require('../server/routes/processDesignMysql');
    for (const name of ['ensureProcessDesignEditionSchema', 'ensureProcessDesignEvidenceStatusSchema', 'ensureProcessDesignFormStructureSchema', 'ensureProcessDesignStepTransitionSchema']) await design[name](pool);
    await require('../server/crossDeptHandoffV2Migration').applyCrossDeptHandoffV2(pool);
    await require('../server/sessionMigration').manageSessionSchema(pool, 'apply');
    await require('../server/processV7PreviewReviewMigration').applyProcessV7PreviewReview(pool);
    await require('../server/processV7FormalMigration').applyProcessV7FormalFoundation(pool);
    // Explicit opt-in on this fixture's freshly owned tmpfs MySQL only. The
    // runtime receives DML grants and cannot prepare or migrate these tables.
    if (options.authoringWorkspace) {
      for (const name of ['processAuthoringWorkspaceSchema','processCaseGovernanceSchema','governanceResponsibilitiesMigration']) {
        const definition = require('../server/' + name);
        for (const sql of require('../server/mysqlSchema').splitSqlStatements(definition.SCHEMA_SQL)) await pool.execute(sql);
        await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)', [definition.MIGRATION_KEY]);
      }
      await require('../server/processFormalControlMigration').applyMigration(pool, { authorized: true });
      // The platform readiness contract always requires this base migration.
      // A fresh core schema has the column but no explicit migration receipt.
      await require('../server/todoTermSourceMigration').manageTodoTermSource(pool, 'apply');
    }
    if (options.systemAdmin) {
      const connection = await pool.getConnection();
      try { await require('../server/systemAdminMigration').applySystemAdmin(connection); } finally { connection.release(); }
    }
    if (options.authoring) {
      const connection = await pool.getConnection();
      try { await require('../server/processV7AuthoringMigration').applyAuthoring(connection); } finally { connection.release(); }
    }
    if (options.processDataGovernanceVersionId) await require('../server/processDataGovernanceMigration').applyProcessDataGovernance(pool);
    for (const [id, name] of options.departments || [[91,'合成甲部'],[92,'合成乙部'],[93,'合成丙部']]) await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)', [id,'SYNTHETIC_'+id,name]);
    const actors = [['admin',['admin'],91], ['lead',['mdm_lead'],91], ['contact',['department_contact'],91], ['reviewA',['department_mdm_reviewer'],91], ['reviewB',['department_mdm_reviewer'],92], ['outsider',['department_mdm_reviewer'],93], ['multi',['department_contact','department_mdm_reviewer'],91], ['adminMulti',['admin','department_mdm_reviewer'],91], ['hr',['hr_directory_manager'],91]];
    if(candidateRoot&&!require('../server/roleDefinitions').ROLE_GUIDES.some(role=>role.code==='hr_directory_manager'))actors.splice(actors.findIndex(actor=>actor[0]==='hr'),1);
    const loginPassword = 'Stage05-Synthetic-Only!2026';
    const passwordHash = require('bcryptjs').hashSync(loginPassword,10);
    for (let i=0; i<actors.length; i++) {
      const [name, roles, dept] = actors[i];
      // Existing callers reserve 89/189 for a compiler fixture after these eight
      // base actors. The directory actor uses separate IDs without moving them.
      const personId = name === 'hr' ? 19081 : 81+i, accountId = name === 'hr' ? 19181 : 181+i;
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)', [personId,'SYNTHETIC_'+name,'合成'+name,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)", [accountId,personId,'SYNTHETIC_'+name,passwordHash]);
      for (const role of roles) {
        const global = ['admin','mdm_lead','hr_directory_manager'].includes(role);
        await pool.execute('INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,?,CURRENT_DATE FROM roles WHERE role_code=?', [personId,global?'global':'department',global?null:dept,'stage05 synthetic authorization',role]);
      }
    }
    if (options.departmentAccountability) {
      const connection = await pool.getConnection();
      try { await require('../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(connection); } finally { connection.release(); }
      await pool.execute('UPDATE departments SET final_responsible_person_id=84 WHERE id=91');
      await pool.execute('UPDATE departments SET final_responsible_person_id=85 WHERE id=92');
    }
    let document = options.createDocument ? options.createDocument() : require('../../structured-output-service/server').createEmptyProcessGovernanceV7Document();
    document.export_meta.package_ref = 'package_stage05_synthetic';
    document.process.process_ref = 'process_stage05_synthetic';
    document.process.process_name = '合成材料核对流程';
    document.process.owning_department = '合成甲部';
    document.process.purpose = '验证材料接收、核对及结果留存的完整操作。';
    document.process.scope = '仅适用于本机合成数据功能验证。';
    document.terms = [{term_ref:'term_synthetic_record',term_name:'合成核对记录',definition:'本机功能测试使用的虚构记录。'}];
    document.behaviors = ['prepare','check','receive'].map((name,i) => ({
      behavior_ref:'behavior_'+name,node_type:'action',behavior_name:['准备合成材料','核对合成内容','接收合成结果'][i],
      behavior_description:'按合成表单逐项核对材料并记录结果。',current_actor_role:(i?'合成乙部':'合成甲部')+'经办人',
      actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'收到待核对材料',precondition:'',input_description:'合成材料',timing:null,
      completion_standard:'已核对并记录合成依据。',output_description:'合成核对记录',countersign_all_required:false,countersign_target_departments:[]
    }));
    document.flow_relations = [0,1].map(i=>({relation_ref:'relation_'+i,relation_type:'sequence',from_behavior_ref:document.behaviors[i].behavior_ref,to_behavior_ref:document.behaviors[i+1].behavior_ref,condition:''}));
    if (options.document) document = structuredClone(options.document);
    // Explicit candidate rehearsal option, synthetic facts only. Keep incomplete-source
    // regression callers unchanged unless they request a complete happy-path baseline.
    if (options.completeSource || process.argv.includes('--complete-source')) {
      document.export_meta.initiating_department ||= '合成甲部';
      document.export_meta.compiler ||= '合成编制人员';
      for (const behavior of document.behaviors) {
        const completeNames = { '准备合成材料': '合成经办人员填写合成核对记录', '核对合成内容': '合成核对人员核对合成内容', '接收合成结果': '合成接收人员接收合成结果' };
        if (completeNames[behavior.behavior_name]) behavior.behavior_name = completeNames[behavior.behavior_name];
      }
    }
    if(options.beforeStart) {
      assert.equal(typeof options.beforeStart,'function');
      await options.beforeStart({pool,owner,database,document});
    }
    await pool.query("CREATE USER 'stage05_runtime'@'%' IDENTIFIED BY ?", [password]);
    await pool.execute(`GRANT SELECT,INSERT,UPDATE,DELETE ON ${database}.* TO 'stage05_runtime'@'%'`);
    const server = http.createServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
    const appPort = server.address().port; await new Promise(resolve=>server.close(resolve));
    assert.ok(![3000,3001,3306,3307,5173,63805].includes(appPort));
    const env = isolatedEnvironment({NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(appPort),MDM_ACCESS_MODE:'http-local',MDM_SESSION_STORE:'mysql',
      MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_USER:'stage05_runtime',MYSQL_PASSWORD:password,MYSQL_DATABASE:database,
      MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
      PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:options.previewOnly?'0':'1',PROCESS_V7_TRIAL_PROCESS_REF:document.process.process_ref,
      PROCESS_V7_AUTHORING_ENABLED:options.authoring?'1':'0',
      PROCESS_AUTHORING_WORKSPACE_ENABLED:options.authoringWorkspace?'1':'0',
      MDM_SYSTEM_ADMIN_ENABLED:options.systemAdmin?'1':'0',
      DATA_MAP_HANDOFF_ENABLED:options.handoffEnabled===true?'1':'0',
      TERMINOLOGY_GOVERNANCE_ENABLED:options.terminologyEnabled===true?'1':'0',
      PROCESS_DATA_GOVERNANCE_ENABLED:options.processDataGovernanceVersionId?'1':'0',PROCESS_DATA_GOVERNANCE_TRIAL_PROCESS_VERSION_ID:String(options.processDataGovernanceVersionId||''),
      ...(candidateRoot?{MDM_TEST_CANDIDATE_ROOT:path.resolve(candidateRoot),MDM_TEST_CANDIDATE_TRACE_FILE:path.join(evidenceDir,'candidate-server-sources.json'),NODE_PATH:[testNodePath,path.join(appRoot,'node_modules')].filter(Boolean).join(path.delimiter)}:{}),
      ...(candidateDist ? { MDM_TEST_FRONTEND_DIST: candidateDist, ...(testNodePath ? { MDM_TEST_NODE_PATH: testNodePath } : {}) } : {})});
    const runtimeRoot=candidateRoot||appRoot;
    const child = fork(path.join(runtimeRoot,'server/index.js'),[],{cwd:runtimeRoot,env,execArgv:candidateDist ? ['--require', path.join(__dirname, 'testHelpers/candidateFrontend.js')] : [],silent:true,windowsHide:true});
    const diagnostics=[];
    child.stdout.on('data',data=>diagnostics.push(String(data))); child.stderr.on('data',data=>diagnostics.push(String(data)));
    const baseURL = 'http://127.0.0.1:'+appPort;
    fs.mkdirSync(evidenceDir,{recursive:true});
    fs.writeFileSync(path.join(evidenceDir,'owned-target.json'),JSON.stringify({owner,database,mysqlHost:'127.0.0.1',mysqlPort:port,baseURL,runnerPid:process.pid,serverPid:child.pid,candidateDist,randomDatabase:options.randomDatabase===true},null,2));
    const clients = {};
    async function request(who,url,method='GET',body) {
      const c=clients[who]||(clients[who]={});
      const response=await fetch(baseURL+url,{method,headers:{'Content-Type':'application/json',Cookie:c.cookie||'',...(c.csrf?{'X-CSRF-Token':c.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(response.headers.get('set-cookie'))c.cookie=response.headers.get('set-cookie').split(';')[0];
      const value=await response.json(); return {status:response.status,body:value};
    }
    async function expect(who,url,method,body,status=200) { const result=await request(who,url,method,body); assert.equal(result.status,status,`${who} ${method} ${url}: ${JSON.stringify(result.body)}`); return result.body; }
    try {
      const startupAt=Date.now(),deadline=startupAt+startupTimeoutMs;let ready=false,lastHealth=null;
      while(Date.now()<deadline&&!ready){
        if(child.exitCode!==null){lastHealth={child_exit_code:child.exitCode};break;}
        try{const response=await fetch(baseURL+'/api/health',{signal:AbortSignal.timeout(Math.max(1,Math.min(1000,deadline-Date.now())))});lastHealth={status:response.status};ready=response.ok;}
        catch(error){lastHealth={code:error.cause?.code||error.code||error.name};}
        if(!ready&&Date.now()<deadline)await sleep(Math.min(100,deadline-Date.now()));
      }
      fs.writeFileSync(path.join(evidenceDir,'startup-readiness.json'),JSON.stringify({ready,startup_timeout_ms:startupTimeoutMs,elapsed_ms:Date.now()-startupAt,last_health:lastHealth,base_url:baseURL,server_pid:child.pid},null,2));
      assert(ready,`OWNED_HTTP_STARTUP_TIMEOUT: health did not become ready within ${startupTimeoutMs}ms; ${JSON.stringify(lastHealth)}`);
      if (options.authoringWorkspace) {
        const readinessResponse = await fetch(baseURL + '/api/ready', { signal: AbortSignal.timeout(5000) });
        const applicationReadiness = await readinessResponse.json();
        fs.writeFileSync(path.join(evidenceDir, 'startup-application-readiness.json'), JSON.stringify({ status: readinessResponse.status, body: applicationReadiness }, null, 2));
        assert.equal(readinessResponse.status, 200, 'owned authoring fixture must satisfy actual application readiness');
        assert.equal(applicationReadiness.ready, true);
      }
      for (const [who] of actors) {
        await expect(who,'/api/org/login','POST',{loginName:'SYNTHETIC_'+who,password:loginPassword});
        clients[who].csrf=(await expect(who,'/api/csrf-token','GET')).csrfToken;
      }
      fs.mkdirSync(evidenceDir,{recursive:true});
      const fixture={baseURL,loginPassword,document,evidenceDir,actors:actors.map(([name])=>name)};
      if(options.randomDatabase)fs.writeFileSync(path.join(evidenceDir,'owned-target.json'),JSON.stringify({owner,database,mysqlHost:'127.0.0.1',mysqlPort:port,baseURL,randomDatabase:true,runnerPid:process.pid,serverPid:child.pid,candidateDist},null,2));
      await action({pool,owner,fixture,expect,request,backup,restore});
    } finally {
      if(child.exitCode===null){const ended=once(child,'exit');child.send('mdm:stop',()=>{});const timer=setTimeout(()=>child.kill(),17000);await ended;clearTimeout(timer);}
      // Only synthetic application logs; credentials/session cookies are never logged.
      fs.writeFileSync(path.join(evidenceDir,'fixture-app.log'),diagnostics.join(''));
      console.log('STAGE05_OWNED_HTTP_STOPPED');
    }
  }, {stage:options.beforeStart||options.handoffEnabled!==undefined?'05':'04',randomDatabase:options.randomDatabase===true});
}

async function main() {
  await withStage05Fixture(async ({fixture,expect,pool,owner})=>{
    if(process.argv.includes('--serve')) {
      fixture.stopFile=path.join(evidenceDir,'stop-'+owner);
      fs.writeFileSync(path.join(evidenceDir,'browser-fixture.json'),JSON.stringify(fixture,null,2));
      console.log('STAGE05_SYNTHETIC_FIXTURE '+fixture.baseURL);
      await new Promise(resolve=>{const timer=setInterval(()=>{if(fs.existsSync(fixture.stopFile)){clearInterval(timer);resolve();}},500);process.stdin.resume();process.stdin.once('data',()=>{clearInterval(timer);resolve();});process.once('SIGINT',()=>{clearInterval(timer);resolve();});});
      if(fs.existsSync(fixture.stopFile))fs.unlinkSync(fixture.stopFile);
      process.stdin.pause();
      return;
    }
    const checks=await require('./stage05-workbench-scenario')({fixture,expect,pool});
    fs.writeFileSync(path.join(evidenceDir,'mysql-workbench-results.json'),JSON.stringify({at:new Date().toISOString(),checks,dependency:'real owned MySQL 8.4, real HTTP/session; synthetic data only'},null,2));
  });
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={withStage05Fixture};
