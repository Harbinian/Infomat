// Persistent owned UI rehearsal. --output <new artifacts dir>, optional
// --frontend <built dist>. Freezes public frontend only, real current server.
// Restores synthetic source to one labelled stage99 tmpfs MySQL, creates empty
// quality schema and a DML-only runtime user. No real config/service is touched.
// Optional --synthetic-account-initialization creates a random test credential
// inside this fixture only. No formal credential/configuration is reused.
// Optional --synthetic-conflict-fixture creates two pending synthetic conflicts,
// never successful coordination, department decisions or closure events.
// Optional --runtime-grants <SHOW GRANTS JSON> clones captured table/column DML
// into this fixture only; omitted retains the historical broad-DML fixture.
// Write the fixture.json stop_file to drain the child and remove owned MySQL.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{fork}=require('node:child_process');
const withFixture=require('./testHelpers/qualityAuditOwnedFixture'),{isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const value=key=>{const at=process.argv.indexOf(key);return at>0?process.argv[at+1]:null;};
const output=value('--output');assert(output,'--output required');
const dist=path.resolve(value('--frontend')||path.join(__dirname,'../frontend/dist'));assert(fs.statSync(path.join(dist,'index.html')).isFile());
const {parseRuntimeGrantSnapshot,applyOwnedRuntimeGrants}=require('./testHelpers/ownedRuntimeGrants');
const grantsFile=value('--runtime-grants');assert(!process.argv.includes('--runtime-grants')||grantsFile,'--runtime-grants requires a JSON path');
if(grantsFile)assert.equal(path.extname(grantsFile).toLowerCase(),'.json','SHOW GRANTS JSON required');
const capturedGrants=grantsFile?parseRuntimeGrantSnapshot(fs.readFileSync(path.resolve(grantsFile))):null;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function main(){await withFixture(async({pool,password,database,owner,containerId,port,people,save,output:directory})=>{
  let initialPasswordFile=null;
  if(process.argv.includes('--synthetic-account-initialization')){
    const privateDirectory=path.join(directory,'private');fs.mkdirSync(privateDirectory,{recursive:false});
    initialPasswordFile=path.join(privateDirectory,'synthetic-account-initial-password');
    fs.writeFileSync(initialPasswordFile,'Aa1!'+crypto.randomBytes(24).toString('hex'),{flag:'wx',mode:0o600});
  }
  const schema=require('../server/qualityAuditSchema');for(const ddl of require('../server/mysqlSchema').splitSqlStatements(schema.SCHEMA_SQL))await pool.execute(ddl);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[schema.MIGRATION_KEY]);assert.equal((await schema.inspectSchema(pool)).ready,true);
  for(const table of schema.TABLES)assert.equal(Number((await pool.execute('SELECT COUNT(*) total FROM `'+table+'`'))[0][0].total),0);
  const pendingConflicts=[];
  if(process.argv.includes('--synthetic-conflict-fixture')){
    const departmentA=people.find(row=>row.employee_no==='PERSONA_headA')?.department_id;
    const departmentB=people.find(row=>row.employee_no==='PERSONA_headB')?.department_id;
    assert(departmentA&&departmentB&&departmentA!==departmentB,'explicit synthetic department sources required');
    const fields=[];
    for(const [label,department]of [['甲',departmentA],['乙',departmentB]]){
      const [context]=await pool.execute('INSERT INTO data_map_contexts(context_key,title,dept_id) VALUES(?,?,CAST(? AS SIGNED))',[crypto.randomUUID(),'角色交接演练'+label+'方上下文',department]);
      const [field]=await pool.execute('INSERT INTO data_map_fields(context_id,field_key,field_name_cn) VALUES(CAST(? AS SIGNED),?,?)',[String(context.insertId),crypto.randomUUID(),'角色交接演练'+label+'方字段']);fields.push(String(field.insertId));
    }
    const [fieldConflict]=await pool.execute("INSERT INTO mdm_field_conflicts(field_id_a,field_id_b,conflict_field,value_a,value_b,dept_a,dept_b,severity,status) VALUES(CAST(? AS SIGNED),CAST(? AS SIGNED),'field_type','合成甲方口径','合成乙方口径',CAST(? AS SIGNED),CAST(? AS SIGNED),'error','pending')",[...fields,departmentA,departmentB]);
    pendingConflicts.push({type:'field',id:String(fieldConflict.insertId),status:'pending'});
    const [termConflict]=await pool.execute("INSERT INTO mdm_term_conflicts(term,dept_a,dept_a_meaning,dept_b,dept_b_meaning,severity,status) VALUES(?,CAST(? AS SIGNED),'合成甲方释义',CAST(? AS SIGNED),'合成乙方释义','error','pending')",['角色交接演练术语',departmentA,departmentB]);
    pendingConflicts.push({type:'term',id:String(termConflict.insertId),status:'pending'});
  }
  const frozen=path.join(directory,'frontend-dist');fs.cpSync(dist,frozen,{recursive:true,errorOnExist:true});
  const walk=root=>fs.readdirSync(root,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(path.join(root,entry.name)):[path.join(root,entry.name)]);
  const frontHashes=walk(frozen).map(file=>{const entry={file:path.relative(frozen,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};fs.chmodSync(file,0o444);return entry;});save('frontend-manifest.json',frontHashes);
  const runtimeUser='qa_ui_'+owner.replaceAll('-','').slice(0,12),runtimePassword=crypto.randomBytes(24).toString('hex');
  await pool.query('CREATE USER \''+runtimeUser+"'@'%' IDENTIFIED BY ?",[runtimePassword]);
  let runtimeGrantEvidence;
  if(capturedGrants){
    runtimeGrantEvidence=await applyOwnedRuntimeGrants(pool,capturedGrants,{owner,database,containerId,port,runtimeUser});
    runtimeGrantEvidence.source_file=path.resolve(grantsFile);
  }else{
    const [tables]=await pool.execute('SELECT TABLE_NAME table_name FROM information_schema.tables WHERE table_schema=?',[database]);
    for(const row of tables){const table=row.table_name||row.TABLE_NAME;assert(/^[a-z0-9_]+$/.test(table));const rights=/events$/.test(table)?'SELECT,INSERT':'SELECT,INSERT,UPDATE,DELETE';await pool.execute('GRANT '+rights+' ON `'+database+'`.`'+table+'` TO \''+runtimeUser+"'@'%'");}
    runtimeGrantEvidence={mode:'historical_broad_dml_fixture',proves_formal_runtime_permissions:false};
  }
  save('runtime-grants.json',runtimeGrantEvidence);
  const serverRoot=path.resolve(__dirname,'../server');
  save('server-source-manifest.json',walk(serverRoot).map(file=>({file:path.relative(serverRoot,file).replaceAll('\\','/'),sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')})));
  const env=isolatedEnvironment({NODE_ENV:'test',HOST:'127.0.0.1',PORT:'0',MDM_ACCESS_MODE:'http-local',MDM_SESSION_STORE:'mysql',MYSQL_HOST:'127.0.0.1',MYSQL_PORT:String(port),MYSQL_USER:runtimeUser,MYSQL_PASSWORD:runtimePassword,MYSQL_DATABASE:database,MYSQL_CONNECTION_LIMIT:'8',SESSION_SECRET:crypto.randomBytes(48).toString('hex'),MDM_IDENTITY_READ_MODEL:'mysql',PROCESS_GOVERNANCE_READ_MODEL:'mysql',MDM_ALLOW_LEGACY_TEST_MODE:'0',MDM_SYSTEM_ADMIN_ENABLED:'1',QUALITY_AUDIT_ENABLED:'1',PROCESS_AUTHORING_WORKSPACE_ENABLED:'1',PROCESS_V7_PREVIEW_ENABLED:'1',PROCESS_V7_FORMAL_ENABLED:'1',PROCESS_V7_AUTHORING_ENABLED:'0',PROCESS_DATA_GOVERNANCE_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0',DATA_MAP_HANDOFF_ENABLED:'1',TERMINOLOGY_GOVERNANCE_ENABLED:'1',...(initialPasswordFile?{MDM_ACCOUNT_INITIAL_PASSWORD_FILE:initialPasswordFile}:{})});
  const stdout=fs.openSync(path.join(directory,'server.log'),'a'),stderr=fs.openSync(path.join(directory,'server-error.log'),'a');
  const child=fork(path.join(__dirname,'testHelpers/qualityAuditUiServer.cjs'),[frozen],{env,cwd:directory,windowsHide:true,stdio:['ignore',stdout,stderr,'ipc']});
  let exited=null;child.on('exit',(code,signal)=>{exited={code,signal};});
  try{
    const listening=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('UI_RUNTIME_START_TIMEOUT')),20000);child.once('message',message=>{clearTimeout(timer);resolve(message);});child.once('error',error=>{clearTimeout(timer);reject(error);});child.once('exit',code=>{clearTimeout(timer);reject(Error('UI_RUNTIME_EARLY_EXIT_'+code));});});
    assert.equal(listening.type,'listening');const target=new URL(listening.baseURL);assert.equal(target.hostname,'127.0.0.1');assert(![3000,3001,3306,3307,5173].includes(Number(target.port)));
    let readiness;for(let attempt=0;attempt<60;attempt++){if(exited)throw Error('UI_RUNTIME_EXITED');const response=await fetch(target.origin+'/api/ready');readiness={status:response.status,body:await response.json()};if(response.ok&&readiness.body.ready)break;await sleep(500);}
    save('readiness.json',readiness);assert.equal(readiness.status,200);assert.equal(readiness.body.ready,true);
    const stopFile=path.join(directory,'stop'),fixture={synthetic_only:true,baseURL:target.origin,owner,database,mysql_container_id:containerId,mysql_port:port,server_pid:child.pid,runner_pid:process.pid,stop_file:stopFile,frontend_dist:frozen,
      source:'real-current-server/index.js',runtime_grants_mode:runtimeGrantEvidence.mode,runtime_grants_sha256:runtimeGrantEvidence.source_sha256||null,quality_schema_ready:true,new_quality_success_seeded:false,synthetic_initial_password_file:initialPasswordFile,synthetic_pending_conflicts:pendingConflicts,new_conflict_success_seeded:false,actors:people.map(row=>({person_id:row.person_id,name:row.person_name,login:row.employee_no,account_id:row.account_id})),formal_database_connected:false,formal_services_changed:false};
    save('fixture.json',fixture);console.log(JSON.stringify({baseURL:target.origin,fixture:path.join(directory,'fixture.json'),stopFile}));
    while(!fs.existsSync(stopFile)){if(exited)throw Error('UI_RUNTIME_UNEXPECTED_EXIT_'+exited.code);await sleep(500);}
  }finally{
    if(!exited&&child.connected)child.send('quality-ui:stop');for(let i=0;i<40&&!exited;i++)await sleep(250);if(!exited)child.kill();
    fs.closeSync(stdout);fs.closeSync(stderr);save('server-cleanup.json',{pid:child.pid,exit:exited});
    if(initialPasswordFile){
      assert.equal(path.dirname(initialPasswordFile),path.join(directory,'private'));
      fs.unlinkSync(initialPasswordFile);save('synthetic-credential-cleanup.json',{synthetic_only:true,removed:true});
    }
  }
},{evidenceDirectory:path.resolve(output)});}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
