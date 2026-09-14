// Stage05 real HTTP/Edge fixture. Fresh labelled tmpfs MySQL only, synthetic identities/data.
// Reuses the stage04 ownership-checked container helper. No private env, existing DB or formal service.
// --serve keeps this owned fixture until Enter/SIGINT; the browser runner uses the same lifetime.
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

async function withStage05Fixture(action) {
  await withFreshMysql(async ({ pool, port, password, owner }) => {
    const identity = require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool);
    await identity.initSchema();
    const design = require('../server/routes/processDesignMysql');
    for (const name of ['ensureProcessDesignEditionSchema', 'ensureProcessDesignEvidenceStatusSchema', 'ensureProcessDesignFormStructureSchema', 'ensureProcessDesignStepTransitionSchema']) await design[name](pool);
    await require('../server/crossDeptHandoffV2Migration').applyCrossDeptHandoffV2(pool);
    await require('../server/sessionMigration').manageSessionSchema(pool, 'apply');
    await require('../server/processV7PreviewReviewMigration').applyProcessV7PreviewReview(pool);
    await require('../server/processV7FormalMigration').applyProcessV7FormalFoundation(pool);
    for (const [id, name] of [[91,'合成甲部'],[92,'合成乙部'],[93,'合成丙部']]) await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)', [id,'SYNTHETIC_'+id,name]);
    const actors = [['admin',['admin'],91], ['lead',['mdm_lead'],91], ['contact',['department_contact'],91], ['reviewA',['department_mdm_reviewer'],91], ['reviewB',['department_mdm_reviewer'],92], ['outsider',['department_mdm_reviewer'],93], ['multi',['department_contact','department_mdm_reviewer'],91], ['adminMulti',['admin','department_mdm_reviewer'],91]];
    const loginPassword = 'Stage05-Synthetic-Only!2026';
    const passwordHash = require('bcryptjs').hashSync(loginPassword,10);
    for (let i=0; i<actors.length; i++) {
      const [name, roles, dept] = actors[i];
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)', [81+i,'SYNTHETIC_'+name,'合成'+name,dept]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,?,?,?,'active',0)", [181+i,81+i,'SYNTHETIC_'+name,passwordHash]);
      for (const role of roles) {
        const global = ['admin','mdm_lead'].includes(role);
        await pool.execute('INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,?,CURRENT_DATE FROM roles WHERE role_code=?', [81+i,global?'global':'department',global?null:dept,'stage05 synthetic authorization',role]);
      }
    }
    const document = require('../../structured-output-service/server').createEmptyProcessGovernanceV7Document();
    document.export_meta.package_ref = 'package_stage05_synthetic';
    document.process.process_ref = 'process_stage05_synthetic';
    document.process.process_name = '合成材料核对流程';
    document.process.owning_department = '合成甲部';
    document.behaviors = ['prepare','check','receive'].map((name,i) => ({
      behavior_ref:'behavior_'+name,node_type:'action',behavior_name:['准备合成材料','核对合成内容','接收合成结果'][i],
      behavior_description:'按合成表单逐项核对材料并记录结果。',current_actor_role:(i?'合成乙部':'合成甲部')+'经办人',
      actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'收到待核对材料',precondition:'',input_description:'合成材料',timing:null,
      completion_standard:'已核对并记录合成依据。',output_description:'合成核对记录',countersign_all_required:false,countersign_target_departments:[]
    }));
    document.flow_relations = [0,1].map(i=>({relation_ref:'relation_'+i,relation_type:'sequence',from_behavior_ref:document.behaviors[i].behavior_ref,to_behavior_ref:document.behaviors[i+1].behavior_ref,condition:''}));
    await pool.query("CREATE USER 'stage05_runtime'@'%' IDENTIFIED BY ?", [password]);
    await pool.execute("GRANT SELECT,INSERT,UPDATE,DELETE ON stage04_isolated.* TO 'stage05_runtime'@'%'");
    const server = http.createServer(); server.listen(0,'127.0.0.1'); await once(server,'listening');
    const appPort = server.address().port; await new Promise(resolve=>server.close(resolve));
    assert.ok(![3000,3001,3306,3307,5173].includes(appPort));
    const env = isolatedEnvironment({NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(appPort),MDM_ACCESS_MODE:'http-local',MDM_SESSION_STORE:'mysql',
      MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_USER:'stage05_runtime',MYSQL_PASSWORD:password,MYSQL_DATABASE:'stage04_isolated',
      MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',SESSION_SECRET:crypto.randomBytes(32).toString('hex'),
      PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1',PROCESS_V7_TRIAL_PROCESS_REF:document.process.process_ref,PROCESS_DATA_GOVERNANCE_ENABLED:'0'});
    const child = fork(path.join(appRoot,'server/index.js'),[],{cwd:appRoot,env,execArgv:[],silent:true,windowsHide:true});
    const diagnostics=[];
    child.stdout.on('data',data=>diagnostics.push(String(data))); child.stderr.on('data',data=>diagnostics.push(String(data)));
    const baseURL = 'http://127.0.0.1:'+appPort;
    const clients = {};
    async function request(who,url,method='GET',body) {
      const c=clients[who]||(clients[who]={});
      const response=await fetch(baseURL+url,{method,headers:{'Content-Type':'application/json',Cookie:c.cookie||'',...(c.csrf?{'X-CSRF-Token':c.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
      if(response.headers.get('set-cookie'))c.cookie=response.headers.get('set-cookie').split(';')[0];
      const value=await response.json(); return {status:response.status,body:value};
    }
    async function expect(who,url,method,body,status=200) { const result=await request(who,url,method,body); assert.equal(result.status,status,`${who} ${method} ${url}: ${JSON.stringify(result.body)}`); return result.body; }
    try {
      for(let i=0;i<100;i++){try{if((await fetch(baseURL+'/api/health')).ok)break;}catch{} await sleep(100);}
      for (const [who] of actors) {
        await expect(who,'/api/org/login','POST',{loginName:'SYNTHETIC_'+who,password:loginPassword});
        clients[who].csrf=(await expect(who,'/api/csrf-token','GET')).csrfToken;
      }
      fs.mkdirSync(evidenceDir,{recursive:true});
      const fixture={baseURL,loginPassword,document,evidenceDir,actors:actors.map(([name])=>name)};
      await action({pool,owner,fixture,expect,request});
    } finally {
      if(child.exitCode===null){const ended=once(child,'exit');child.send('mdm:stop',()=>{});const timer=setTimeout(()=>child.kill(),17000);await ended;clearTimeout(timer);}
      // Only synthetic application logs; credentials/session cookies are never logged.
      fs.writeFileSync(path.join(evidenceDir,'fixture-app.log'),diagnostics.join(''));
      console.log('STAGE05_OWNED_HTTP_STOPPED');
    }
  });
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
