// --output <new artifacts directory> --baseline <input-manifest.json> [--probe].
// Snapshot/current comparison on freshMysql mysql:8.4 --pull never, owned tmpfs,
// UUID database and random loopback port. No config file or existing DB is read.
// Actual RR snapshots and performance_schema lock waits supply race evidence.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeIdentityMysqlRepository,readPersonAuthority}=require('../server/identityMysqlRepository');
const {snapshot:sourceSnapshot,digest}=require('../server/dataMapDefinitionValues');
const arg=name=>process.argv.includes(name)?process.argv[process.argv.indexOf(name)+1]:null;
const output=path.resolve(arg('--output')||'');
assert(arg('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
fs.mkdirSync(output,{recursive:true});
const manifest=JSON.parse(fs.readFileSync(path.resolve(arg('--baseline')))),input=manifest.inputs.find(f=>f.path==='apps/mdm-platform/server/dataMapDefinitionRepository.js');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const beforeBytes=fs.readFileSync(input.snapshot);assert.equal(sha(beforeBytes),input.sha256);
const filename=require.resolve('../server/dataMapDefinitionRepository');
const beforeModules=new Map(),beforeInputs=manifest.inputs.filter(f=>/^apps\/mdm-platform\/server\/(dataMapDefinitionRepository|v7Mappings|fixedMappingContext|definitionConsumers)\.js$/.test(f.path));
function loadBefore(sourceFile){
  if(beforeModules.has(sourceFile))return beforeModules.get(sourceFile).exports;
  const input=beforeInputs.find(f=>path.resolve(f.absolutePath)===sourceFile);assert(input,'declared input snapshot');
  const bytes=fs.readFileSync(input.snapshot);assert.equal(sha(bytes),input.sha256);
  const loaded=new Module(sourceFile,module);loaded.filename=sourceFile;loaded.paths=Module._nodeModulePaths(path.dirname(sourceFile));beforeModules.set(sourceFile,loaded);
  const localRequire=Module.createRequire(sourceFile);
  loaded.require=name=>{const resolved=localRequire.resolve(name);return beforeInputs.some(f=>path.resolve(f.absolutePath)===resolved)?loadBefore(resolved):localRequire(name);};
  loaded._compile(bytes.toString(),sourceFile);return loaded.exports;
}
const factories={before:loadBefore(filename).makeDataMapDefinitionRepository,current:require(filename).makeDataMapDefinitionRepository};
const probe=process.argv.includes('--probe');
const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
const P='9007199254740993',N='9007199254740992',A='9007199254741093',NA='9007199254741092',V='9007199254741193',NV='9007199254741192';
const D='9007199254741293',ND='9007199254741292';
const checks=[],comparisons=[],races=[],held=[],transactions=[];let target,passed=false,failure;
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
async function timeout(p,label){let timer;try{return await Promise.race([p,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Timeout '+label)),12000);})]);}finally{clearTimeout(timer);}}
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
async function outcome(fn){try{return {ok:true,result:await fn()};}catch(e){return {ok:false,code:e.code,statusCode:e.statusCode,message:e.message};}}
async function observeWait(pool,database,object,connectionId){
  for(let i=0;i<500;i++){
    const [rows]=await pool.query(`SELECT r.OBJECT_SCHEMA,r.OBJECT_NAME,r.INDEX_NAME,r.LOCK_MODE,r.LOCK_STATUS,r.LOCK_DATA,
      r.ENGINE_TRANSACTION_ID requesting_transaction,b.ENGINE_TRANSACTION_ID blocking_transaction,
      t.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection,b.LOCK_MODE blocking_mode
      FROM performance_schema.data_lock_waits w
      JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID
      JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID
      JOIN performance_schema.threads t ON t.THREAD_ID=r.THREAD_ID JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID
      WHERE r.OBJECT_SCHEMA=? AND r.OBJECT_NAME=? AND t.PROCESSLIST_ID=?`,[database,object,connectionId]);
    if(rows.length)return rows;await new Promise(done=>setTimeout(done,15));
  }throw Error('No actual lock wait '+object+' / '+connectionId);
}
const refused=port=>new Promise(resolve=>{const s=net.connect({host:'127.0.0.1',port});s.setTimeout(1500);s.on('connect',()=>{s.destroy();resolve(false);});s.on('error',e=>{s.destroy();resolve(e.code==='ECONNREFUSED');});s.on('timeout',()=>{s.destroy();resolve(false);});});
async function main(){
  try{await withFreshMysql(async fixture=>{
    const {pool,owner,database,containerId,port}=fixture;target={owner,database,containerId,port,stage:'02',host:'127.0.0.1',storage:'owned tmpfs',pull:'never'};save('owned-target.json',target);
    await makeIdentityMysqlRepository(pool).initSchema();
    const migration=await pool.getConnection();try{await require('../server/dataMapDefinitionMigration').applyDefinitions(migration);await require('../server/v7MappingMigration').applyV7Mappings(migration);}finally{migration.release();}
    for(const [id,name]of [[91,'B02D Alpha'],[92,'B02D Beta'],[D,'B02D Big'],[ND,'B02D Adjacent']])await pool.execute('INSERT INTO departments(id,code,name) VALUES (CAST(? AS SIGNED),?,?)',[String(id),'B02D_'+id,name]);
    const people=[
      {personId:11,accountId:111,authVersion:1,departmentId:91,roles:['department_contact']},
      {personId:12,accountId:112,authVersion:1,departmentId:91,roles:['mdm_lead']},
      {personId:13,accountId:113,authVersion:1,departmentId:91,roles:['admin','mdm_lead','department_contact']},
      {personId:14,accountId:114,authVersion:1,departmentId:91,roles:[]},
      {personId:15,accountId:115,authVersion:1,departmentId:92,roles:['department_contact']},
      {personId:16,accountId:116,authVersion:1,departmentId:91,roles:['department_mdm_reviewer']},
      {personId:17,accountId:117,authVersion:1,departmentId:91,roles:['admin']},
      {personId:P,accountId:A,authVersion:V,departmentId:D,roles:['mdm_lead','department_contact']},
      {personId:N,accountId:NA,authVersion:NV,departmentId:ND,roles:['department_contact']}
    ];
    for(const p of people){
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (CAST(? AS SIGNED),?,?,CAST(? AS SIGNED))',[String(p.personId),'B02D_'+p.personId,'B02 synthetic',String(p.departmentId)]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (CAST(? AS SIGNED),CAST(? AS SIGNED),?,'synthetic-no-login','active',0,CAST(? AS SIGNED))",[String(p.accountId),String(p.personId),'B02D_'+p.personId,String(p.authVersion)]);
      for(const role of p.roles){const global=['admin','mdm_lead'].includes(role);await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT CAST(? AS SIGNED),role_id,?,CAST(? AS SIGNED),'B02 synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[String(p.personId),global?'global':'department',global?null:String(p.departmentId),role]);}
    }
    const [contact,lead,overlay,roleless,outsider,reader,admin,big,neighbour]=people;
    const system={identityKind:'system_admin',userId:'system-admin:911',personId:null,accountId:911,authVersion:1};
    const forged=p=>({...p,permissions:new Set(['governance:structure-gate','governance:draft-department','governance:read-global']),roleCodes:['mdm_lead'],departmentId:91});
    const repo=factories.current(pool),old=factories.before(pool),uuid=()=>crypto.randomUUID();
    const object=await repo.saveDefinition(contact,{request_id:uuid(),entity_type:'object',department_id:'91',definition:{name:'B02 object',business_meaning:'synthetic baseline'}});
    await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES (11,'b02_context','B02 synthetic',91)");
    const field=await repo.saveDefinition(contact,{request_id:uuid(),entity_type:'field',context_id:'11',object_id:object.entity_id,object_version_id:object.version_id,definition:{name:'B02 field',business_meaning:'synthetic field'}});
    const source=await repo.registerSource(contact,{request_id:uuid(),department_id:'91',original_name:'B02 synthetic.xlsx',parser_version:'b02',template_profile_version:'b02'},Buffer.from('B02 source bytes'));
    const docs={};const sources={},maps={};
    for(const format of ['v8','v7']){
      const doc=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json')));doc.process.process_ref='b02_'+format;doc.process.process_name='B02 '+format;doc.process.owning_department='B02D Alpha';
      doc.data_objects=[{data_ref:'b02_object',data_name:'B02 object',description:'synthetic',information_type:'business_conclusion',fields:[{field_ref:'b02_field',field_name:'B02 field',field_type:'文本',definition:'synthetic'}],behavior_links:[],source_relations:[],lifecycle:{applicability:'pending_confirmation',entry_state:{business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'},routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''}}];
      docs[format]=doc;sources[format]=await repo.registerV7Source(lead,{request_id:uuid(),source_kind:'uploaded_material',original_name:'b02-'+format+'.json'},Buffer.from(JSON.stringify(doc)));assert.equal(sources[format].validation_status,'valid');
      maps[format]=await repo.saveV7Mapping(lead,sources[format].source_id,{request_id:uuid(),expected_revision:0,source_digest:require('../server/v7FixedSource').contentHash(doc),local_object_ref:'b02_object',local_field_ref:null,object_version_id:object.version_id,field_version_id:null,status:'candidate',basis:'B02 synthetic'});
    }
    const tables=['data_map_objects','data_map_fields','data_map_field_identities','data_map_field_system_links','data_map_contexts','data_map_import_batches','data_map_definition_versions','data_map_definition_heads','data_map_definition_events','data_map_definition_requests','data_map_source_files','data_map_source_cells','data_map_source_mappings','data_map_v7_sources','data_map_v7_mappings','data_map_v7_mapping_versions'];
    async function physical(db=pool){const state={};for(const table of tables){const [columns]=await db.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','timestamp','datetime') ORDER BY ORDINAL_POSITION",[table]);const casts=columns.map(c=>'CAST(`'+c.COLUMN_NAME+'` AS CHAR) AS `'+c.COLUMN_NAME+'`').join(',');state[table]=(await db.query('SELECT *'+(casts?', '+casts:'')+' FROM '+table+' ORDER BY 1'))[0];}return state;}
    const existing=()=>({request_id:uuid(),entity_type:'object',entity_id:object.entity_id,expected_revision:1,definition:{business_meaning:'B02 update'}});
    const mapping=(department='91')=>({request_id:uuid(),batch_id:source.batch_id,sheet_name:'B02 sheet',record_type:'object',local_id:uuid(),source_row:1,platform_version_id:object.version_id,cells:[{address:'A1',raw_type:'string',raw_value:'B02 cell'}]});
    const mapPayload=()=>({request_id:uuid(),expected_revision:1,source_digest:require('../server/v7FixedSource').contentHash(docs.v8),local_object_ref:'b02_object',local_field_ref:null,object_version_id:object.version_id,field_version_id:null,status:'candidate',basis:'B02 update'});
    const workbookBytes=await require('./testHelpers/masterDataTemplateFixture').fixture().bytes();
    const preparedImport=await require('../server/masterDataTemplateImport').prepareImport(workbookBytes,'B02 import.xlsx',[],{personId:'11',departmentId:'91'});assert(preparedImport.preview.validation_passed);
    const ops={
      saveDefinition:r=>s=>r.saveDefinition(s,existing()),
      recordReview:r=>s=>r.recordReview(s,{request_id:uuid(),version_id:object.version_id,expected_revision:1,decision:'fact_checked',basis:['B02 synthetic']}),
      registerSource:r=>s=>r.registerSource(s,{request_id:uuid(),department_id:'91',original_name:uuid()+'.xlsx',parser_version:'b02',template_profile_version:'b02'}),
      addSourceMapping:r=>s=>r.addSourceMapping(s,mapping()),
      templateImportActor:r=>s=>r.templateImportActor(s),
      importTemplate:r=>s=>r.importTemplate(s,{request_id:uuid(),original_name:'B02 import.xlsx',links:[],preview_digest:preparedImport.preview_digest,confirm:true},workbookBytes),
      getCurrent:r=>s=>r.getCurrent(s,'object',object.entity_id),
      getVersion:r=>s=>r.getVersion(s,object.version_id),
      getCurrentField:r=>s=>r.getCurrent(s,'field',field.entity_id),
      getVersionField:r=>s=>r.getVersion(s,field.version_id),
      getSource:r=>s=>r.getSource(s,source.batch_id),
      capabilities:r=>s=>r.v7MappingCapabilities(s),
      listV7Sources:r=>s=>r.listV7Sources(s),
      registerV7Source:r=>s=>r.registerV7Source(s,{request_id:uuid(),source_kind:'uploaded_material',original_name:uuid()+'.json'},Buffer.from('{}')),
      getV7Source:r=>s=>r.getV7Source(s,sources.v8.source_id),
      getV7Evidence:r=>s=>r.getV7Evidence(s,sources.v8.source_id,{object:'b02_object',field:'b02_field'}),
      getV7MappingHistory:r=>s=>r.getV7MappingHistory(s,sources.v8.source_id,maps.v8.mapping_id),
      saveV7Mapping:r=>s=>r.saveV7Mapping(s,sources.v8.source_id,mapPayload())
    };
    const writers=['saveDefinition','recordReview','registerSource','addSourceMapping','templateImportActor','importTemplate','registerV7Source','saveV7Mapping'];
    const whoFor=name=>['recordReview','registerV7Source','saveV7Mapping','capabilities','listV7Sources','getV7Source','getV7Evidence','getV7MappingHistory'].includes(name)?lead:contact;
    // Observed wrapper keeps the original transaction on one real connection.
    // Rollback-at-commit is explicit for differential fixtures only, and captures
    // physical changes before rollback. Separate checks below actually commit.
    function observed(version,{begin,onExecute,atCommit,rollbackCommit=false}={}){
      const entries=[];let connectionId,released=false,committed=false,rolledBack=false;
      const wrapper={getConnection:async()=>{const db=await pool.getConnection();connectionId=db.connection.threadId;released=false;committed=false;rolledBack=false;return new Proxy(db,{get(t,key){
        if(key==='beginTransaction')return async()=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await db.beginTransaction();entries.push({transaction:'begin',connectionId});if(begin)await begin(db);};
        if(key==='execute')return async(sql,params=[])=>{const entry={sql,params,connectionId};entries.push(entry);if(onExecute)await onExecute(db,sql,params);try{return await db.execute(sql,params);}catch(e){entry.error=e.code;throw e;}};
        if(key==='commit')return async()=>{if(atCommit)await atCommit(db);if(rollbackCommit){await db.rollback();rolledBack=true;entries.push({transaction:'fixture_rollback_at_commit',connectionId});}else{await db.commit();committed=true;entries.push({transaction:'commit',connectionId});}};
        if(key==='rollback')return async()=>{rolledBack=true;entries.push({transaction:'rollback',connectionId});await db.rollback();};
        if(key==='release')return()=>{released=true;entries.push({transaction:'release',connectionId});db.release();};
        const value=t[key];return typeof value==='function'?value.bind(t):value;
      }});}};
      const repository=factories[version](wrapper);return {repository,entries,state:()=>({connectionId,released,committed,rolledBack})};
    }
    async function rejected(fn,code){const before=await physical();const result=await outcome(fn);assert.equal(result.ok,false);assert.equal(result.code,code);assert.deepEqual(await physical(),before);return result;}
    await check('full legal small-integer definition/source/mapping reads preserve baseline API bytes',async()=>{
      for(const name of Object.keys(ops).filter(n=>!writers.includes(n))){const actor=whoFor(name),expected=await ops[name](old)(actor),actual=await ops[name](repo)(actor);assert.deepEqual(actual,expected,name);comparisons.push({name,exactEqual:true});}
      assert.equal((await repo.getVersion(contact,field.version_id)).object_version_id,object.version_id);
      for(const name of writers){const h=observed('current',{rollbackCommit:true});const result=await outcome(()=>ops[name](h.repository)(whoFor(name)));assert.equal(result.ok,true,name+': '+JSON.stringify(result));assert(h.state().released&&h.state().rolledBack);transactions.push({name,...h.state(),entries:h.entries});}
    });
    await check('no cached grant bypass; independent admin/null, admin overlay, no authority and cross department retain original failures',async()=>{
      for(const name of writers){for(const actor of [system,null])await rejected(()=>ops[name](repo)(actor),'DEFINITION_AUTH_REQUIRED');for(const actor of [overlay,admin,roleless])await rejected(()=>ops[name](repo)(forged(actor)),'DEFINITION_ACCESS_DENIED');}
      for(const name of ['saveDefinition','getCurrent','getVersion','getSource','addSourceMapping','getV7Source','getV7Evidence'])await rejected(()=>ops[name](repo)(outsider),'DEFINITION_ACCESS_DENIED');
      assert.equal((await repo.v7MappingCapabilities(overlay)).can_write,false);assert.equal((await repo.v7MappingCapabilities(admin)).can_write,false);
      assert.equal((await repo.getVersion(admin,object.version_id)).version_id,object.version_id);
    });
    await check('adjacent person/account/generation/departments and original prepared statements remain exact across reuse',async()=>{
      const db=await pool.getConnection();try{
        const shared={getConnection:async()=>new Proxy(db,{get(t,key){if(key==='release')return()=>{};const v=t[key];return typeof v==='function'?v.bind(t):v;}})};
        const small=factories.current(shared),previous=factories.before(shared);
        for(const actor of [contact,big,neighbour,big,contact,neighbour,big]){
          const a=await small.templateImportActor(actor),b=await previous.templateImportActor(actor);assert.deepEqual(a,b);assert.equal(a.personId,String(actor.personId));assert.equal(a.departmentId,String(actor.departmentId));comparisons.push({name:'prepared reuse',personId:a.personId,departmentId:a.departmentId,connectionId:db.connection.threadId});
        }
        for(const [key,value]of [['personId',N],['accountId',NA],['authVersion',NV]])await rejected(()=>small.templateImportActor({...big,[key]:value}),'DEFINITION_AUTH_REQUIRED');
        for(const key of ['personId','accountId','authVersion'])await rejected(()=>small.templateImportActor({...big,[key]:Number(big[key])}),'DEFINITION_ID_INVALID');
        const raw=await small.saveDefinition(big,{request_id:uuid(),entity_type:'object',department_id:D,definition:{name:'B02 big-owned'}});
        await rejected(()=>small.getCurrent(neighbour,'object',raw.entity_id),'DEFINITION_ACCESS_DENIED');
      }finally{db.release();}
    });
    const assignments=(id,change)=>({sql:'UPDATE person_roles SET '+change+' WHERE person_id=?',params:[id]});
    const changes=[
      ['revoked',s=>assignments(s.personId,"assignment_status='revoked'"),'DEFINITION_ACCESS_DENIED'],
      ['basis-null',s=>assignments(s.personId,'authorization_basis=NULL'),'DEFINITION_ACCESS_DENIED'],
      ['start-null',s=>assignments(s.personId,'effective_from=NULL'),'DEFINITION_ACCESS_DENIED'],
      ['future-start',s=>assignments(s.personId,'effective_from=DATE_ADD(CURRENT_DATE,INTERVAL 1 DAY)'),'DEFINITION_ACCESS_DENIED'],
      ['expired',s=>assignments(s.personId,'effective_to=DATE_SUB(CURRENT_DATE,INTERVAL 1 DAY)'),'DEFINITION_ACCESS_DENIED'],
      ['role-retired',s=>({sql:"UPDATE roles SET status='retired' WHERE role_code=?",params:[s.roles[0]]}),'DEFINITION_ACCESS_DENIED'],
      ['role-model',s=>({sql:"UPDATE roles SET model_version='b02-other-model' WHERE role_code=?",params:[s.roles[0]]}),'DEFINITION_ACCESS_DENIED'],
      ['permission-deny',s=>({sql:"UPDATE role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id SET rp.effect='deny' WHERE r.role_code=? AND p.perm_code=?",params:[s.roles[0],s===lead?'governance:structure-gate':'governance:draft-department']}),'DEFINITION_ACCESS_DENIED'],
      ['permission-removed',s=>({sql:'DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id JOIN permissions p ON p.perm_id=rp.perm_id WHERE r.role_code=? AND p.perm_code=?',params:[s.roles[0],s===lead?'governance:structure-gate':'governance:draft-department']}),'DEFINITION_ACCESS_DENIED'],
      ['permission-code',s=>({sql:"UPDATE permissions SET perm_code='b02:changed' WHERE perm_code=?",params:[s===lead?'governance:structure-gate':'governance:draft-department']}),'DEFINITION_ACCESS_DENIED'],
      ['generation',s=>({sql:'UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=?',params:[s.accountId]}),'DEFINITION_AUTH_REQUIRED'],
      ['password',s=>({sql:'UPDATE user_accounts SET must_change_password=1 WHERE account_id=?',params:[s.accountId]}),'DEFINITION_AUTH_REQUIRED'],
      ['disabled',s=>({sql:"UPDATE user_accounts SET account_status='disabled' WHERE account_id=?",params:[s.accountId]}),'DEFINITION_AUTH_REQUIRED'],
      ['person-inactive',s=>({sql:"UPDATE person SET status='inactive' WHERE person_id=?",params:[s.personId]}),'DEFINITION_AUTH_REQUIRED'],
      ['department',s=>({sql:'UPDATE person SET current_department_id=92 WHERE person_id=?',params:[s.personId]}),'DEFINITION_ACCESS_DENIED'],
      ['admin-added',s=>({sql:"INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','B02 overlay',CURRENT_DATE FROM roles WHERE role_code='admin'",params:[s.personId]}),'DEFINITION_ACCESS_DENIED']
    ];
    // Exact original rows restore qualification fixtures after committed races.
    const authBackup={};for(const table of ['person','user_accounts','person_roles','roles','permissions','role_permissions']){
      const [columns]=await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE='bigint' ORDER BY ORDINAL_POSITION",[table]);
      const casts=columns.map(c=>'CAST(`'+c.COLUMN_NAME+'` AS CHAR) AS `'+c.COLUMN_NAME+'`').join(',');authBackup[table]=(await pool.query('SELECT *'+(casts?', '+casts:'')+' FROM '+table+' ORDER BY 1'))[0];
    }
    async function restoreAuthority(){const db=await pool.getConnection();try{await db.beginTransaction();for(const table of ['person_roles','role_permissions'])await db.execute('DELETE FROM '+table);
      for(const table of ['person','user_accounts','roles','permissions'])for(const row of authBackup[table]){const cols=Object.keys(row).filter(c=>!['password_hash'].includes(c)),pk=Object.keys(row)[0];await db.query('UPDATE '+table+' SET '+cols.filter(c=>c!==pk).map(c=>'`'+c+'`=?').join(',')+' WHERE `'+pk+'`=?',[...cols.filter(c=>c!==pk).map(c=>row[c]),row[pk]]);}
      for(const table of ['person_roles','role_permissions'])for(const row of authBackup[table])await db.query('INSERT INTO '+table+' SET ?',row);await db.commit();
    }catch(e){await db.rollback();throw e;}finally{db.release();}}
    async function race(version,name,operation,actor,mutation,expected,{targetRace=false,waitObject='user_accounts',snapshotTransaction=1}={}){
      await restoreAuthority();const snap=deferred(),proceed=deferred();let prior,atCommit;
      let beginCount=0;
      const h=observed(version,{begin:async db=>{
        if(++beginCount!==snapshotTransaction)return;
        const auth=await readPersonAuthority(db,actor,actor.personId);assert(auth.valid);
        prior={valid:auth.valid,personId:auth.user.personId,accountId:auth.user.accountId,authVersion:auth.user.authVersion,departmentId:auth.user.current_department_id,permissions:[...auth.permissions],readOnly:auth.readOnly,object:await sourceSnapshot(db,'object',object.entity_id),source:(await db.execute('SELECT CAST(scope_department_id AS CHAR) departmentId FROM data_map_source_files WHERE batch_id=?',[source.batch_id]))[0][0],fixed:(await db.execute('SELECT CAST(scope_department_id AS CHAR) departmentId FROM data_map_v7_sources WHERE source_id=?',[sources.v8.source_id]))[0][0]};
        snap.resolve();await timeout(proceed.promise,'race gate');
      },rollbackCommit:true,atCommit:async db=>{atCommit=await physical(db);}});
      const blocker=await pool.getConnection();let pending,waits,result;
      const original=await physical();
      try{pending=outcome(()=>ops[operation](h.repository)(actor));await timeout(snap.promise,'RR snapshot');await blocker.beginTransaction();
        await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE',[actor.accountId]);
        await blocker.execute(mutation.sql,mutation.params);proceed.resolve();waits=await observeWait(pool,database,waitObject,h.state().connectionId);assert.notEqual(waits[0].requesting_connection,waits[0].blocking_connection);await blocker.commit();
        result=await timeout(pending,'race result');assert(h.state().released,'same connection release');
        const txEntries=h.entries.slice(h.entries.findLastIndex(e=>e.transaction==='begin'));
        const accountAt=txEntries.findIndex(e=>e.sql&&/FROM user_accounts.*FOR UPDATE/s.test(e.sql)),personAt=txEntries.findIndex(e=>e.sql&&/FROM person WHERE.*FOR UPDATE/s.test(e.sql)),assignmentsAt=txEntries.findIndex(e=>e.sql&&/FROM person_roles.*FOR UPDATE/s.test(e.sql));
        assert(accountAt>=0&&personAt>accountAt,'original account/person lock order');
        if(!['generation','password','disabled','person-inactive'].includes(name)){assert(assignmentsAt>personAt,'original assignment lock order');}
        if(['success','listed-source','hidden-source','hidden-mapping'].includes(expected)){
          assert(result.ok,name+': '+JSON.stringify(result));
          if(expected==='listed-source')assert(result.result.items.some(r=>r.source_id===sources.v8.source_id));
          if(expected==='hidden-source')assert(!result.result.items.some(r=>r.source_id===sources.v8.source_id));
          if(expected==='hidden-mapping')assert.equal(result.result.mappings.length,0);
        }else{assert.equal(result.ok,false,name+': '+JSON.stringify(result));assert.equal(result.code,expected,name);assert(h.state().rolledBack);}
        const after=await physical();if(targetRace){const normalized=structuredClone(after);for(const table of tables)if(mutation.sql.includes('UPDATE '+table+' '))normalized[table]=original[table];assert.deepEqual(normalized,original,'no dependent writes after moved target');}else assert.deepEqual(after,original,'business state rollback');
        const record={version,name,operation,expected,result,RR:true,prior,mutation,waits,entries:h.entries,...h.state(),stateAtCommitSha256:atCommit?digest(atCommit):null};races.push(record);save('qualification-races.json',races);
        return result;
      }finally{
        proceed.resolve();await blocker.rollback();blocker.release();if(pending)await timeout(pending,'race finally');await restoreAuthority();
        if(targetRace){
          const table=mutation.sql.match(/^UPDATE (\w+)/)[1],column=mutation.sql.match(/ SET (\w+)=92/)[1],rows=original[table],key=Object.keys(rows[0])[0];
          const row=rows.find(r=>String(r[key])===String(mutation.params[0]||11));assert(row,'exact original target row');
          await pool.query('UPDATE '+table+' SET '+column+'=?'+(Object.hasOwn(row,'updated_at')?',updated_at=?':'')+' WHERE '+key+'=?',[row[column],...(Object.hasOwn(row,'updated_at')?[row.updated_at]:[]),row[key]]);
          assert.deepEqual(await physical(),original,'restore scope fixture and automatic timestamp exactly');
        }
      }
    }
    await check('RR old snapshot and actual account lock waits compare role/permission/evidence/date/password/department mutations',async()=>{
      for(const operation of ['saveDefinition','saveV7Mapping'])for(const [name,change,code]of changes){
        const actor=whoFor(operation),mutation=change(actor);
        const baselineDenial=['generation','password','disabled','person-inactive','department'].includes(name);
        const currentExpected=name==='department'&&operation==='saveV7Mapping'?'success':code;
        await race('before',name,operation,actor,mutation,baselineDenial?currentExpected:'success');
        if(!probe)await race('current',name,operation,actor,mutation,currentExpected);
      }
      for(const operation of ['registerSource','addSourceMapping','templateImportActor','recordReview','registerV7Source']){
        const actor=whoFor(operation),mutation=assignments(actor.personId,"assignment_status='revoked'");await race('before','consumer revoke',operation,actor,mutation,'success');if(!probe)await race('current','consumer revoke',operation,actor,mutation,'DEFINITION_ACCESS_DENIED');
      }
      const revoked=assignments(contact.personId,"assignment_status='revoked'");
      await race('before','prepared import final transaction revoke','importTemplate',contact,revoked,'success',{snapshotTransaction:2});
      if(!probe)await race('current','prepared import final transaction revoke','importTemplate',contact,revoked,'DEFINITION_ACCESS_DENIED',{snapshotTransaction:2});
      for(const operation of Object.keys(ops).filter(n=>!writers.includes(n))){const actor=whoFor(operation),mutation=assignments(actor.personId,"assignment_status='revoked'");await race('before','read consumer revoke',operation,actor,mutation,'success');if(!probe)await race('current','read consumer revoke',operation,actor,mutation,'DEFINITION_ACCESS_DENIED');}
    });
    // Scope checks must read current targets even if actor reads are now current.
    await check('current target object/source/list scope does not disclose or bind stale old-department rows',async()=>{
      const targets=[
        ['object moved','getCurrent',{sql:'UPDATE data_map_objects SET owner_dept_id=92 WHERE id=?',params:[object.entity_id]},'DEFINITION_ACCESS_DENIED'],
        ['version object moved','getVersion',{sql:'UPDATE data_map_objects SET owner_dept_id=92 WHERE id=?',params:[object.entity_id]},'DEFINITION_ACCESS_DENIED'],
        ['source mapping object moved','addSourceMapping',{sql:'UPDATE data_map_objects SET owner_dept_id=92 WHERE id=?',params:[object.entity_id]},'DEFINITION_ACCESS_DENIED'],
        ['raw source moved','getSource',{sql:'UPDATE data_map_source_files SET scope_department_id=92 WHERE batch_id=?',params:[source.batch_id]},'DEFINITION_ACCESS_DENIED'],
        ['field context moved','getCurrentField',{sql:'UPDATE data_map_contexts SET dept_id=92 WHERE id=11',params:[]},'DEFINITION_ACCESS_DENIED'],
        ['field version context moved','getVersionField',{sql:'UPDATE data_map_contexts SET dept_id=92 WHERE id=11',params:[]},'DEFINITION_ACCESS_DENIED'],
        ['listed fixed source moved','listV7Sources',{sql:'UPDATE data_map_v7_sources SET scope_department_id=92 WHERE source_id=?',params:[sources.v8.source_id]},'hidden-source']
      ];
      for(const [name,operation,mutation,code]of targets){await race('before',name,operation,contact,mutation,code==='hidden-source'?'listed-source':'success',{targetRace:true});if(!probe)await race('current',name,operation,contact,mutation,code,{targetRace:true});}
      for(const [operation,expected]of [['getV7MappingHistory','DEFINITION_ACCESS_DENIED'],['getV7Source','hidden-mapping']]){
        const mutation={sql:'UPDATE data_map_objects SET owner_dept_id=92 WHERE id=?',params:[object.entity_id]};
        await race('before','existing mapping target lock',operation,contact,mutation,expected,{targetRace:true});if(!probe)await race('current','existing mapping target lock',operation,contact,mutation,expected,{targetRace:true});
      }
    });
    if(!probe){
      await check('latest roles and permission rows wait independently and stay locked until the original real commit',async()=>{
        for(const table of ['roles','role_permissions','permissions']){
          await restoreAuthority();const gate=deferred(),continueGate=deferred(),end=deferred(),commitGate=deferred();let snapshot,heldLocks;
          const [[leadRole]]=await pool.execute("SELECT CAST(role_id AS CHAR) role_id FROM roles WHERE role_code='mdm_lead'");
          const [[gatePermission]]=await pool.execute("SELECT CAST(perm_id AS CHAR) perm_id FROM permissions WHERE perm_code='governance:structure-gate'");
          const h=observed('current',{begin:async db=>{snapshot=await readPersonAuthority(db,lead,lead.personId);gate.resolve();await continueGate.promise;},atCommit:async db=>{heldLocks=(await db.query('SELECT OBJECT_NAME,INDEX_NAME,LOCK_MODE,LOCK_STATUS,LOCK_DATA FROM performance_schema.data_locks WHERE OBJECT_SCHEMA=? AND THREAD_ID=(SELECT THREAD_ID FROM performance_schema.threads WHERE PROCESSLIST_ID=?)',[database,db.connection.threadId]))[0];end.resolve();await commitGate.promise;}});
          const blocker=await pool.getConnection(),writer=await pool.getConnection();let op,write;
          try{op=outcome(()=>h.repository.recordReview(lead,{request_id:uuid(),version_id:object.version_id,expected_revision:1,decision:'fact_checked',basis:['B02 committed']}));await timeout(gate.promise,'current adapter start');await blocker.beginTransaction();
            const sql=table==='roles'?'SELECT role_id FROM roles WHERE role_id=? FOR UPDATE':table==='permissions'?'SELECT perm_id FROM permissions WHERE perm_id=? FOR UPDATE':'SELECT role_id FROM role_permissions WHERE role_id=? AND perm_id=? FOR UPDATE';
            const params=table==='roles'?[leadRole.role_id]:table==='permissions'?[gatePermission.perm_id]:[leadRole.role_id,gatePermission.perm_id];
            await blocker.execute(sql,params);continueGate.resolve();const waits=await observeWait(pool,database,table,h.state().connectionId);await blocker.commit();await timeout(end.promise,'held through commit');
            assert(heldLocks.some(l=>l.OBJECT_NAME===table&&l.LOCK_MODE.includes('S')),'real shared current locks '+table);
            for(const locked of ['user_accounts','person','person_roles'])assert(heldLocks.some(l=>l.OBJECT_NAME===locked&&l.LOCK_MODE.includes('X')),'original exclusive lock '+locked);
            const writerSql=table==='roles'?'UPDATE roles SET role_name=role_name WHERE role_id=?':table==='permissions'?'UPDATE permissions SET description=description WHERE perm_id=?':'UPDATE role_permissions SET effect=effect WHERE role_id=? AND perm_id=?';
            await writer.beginTransaction();write=writer.execute(writerSql,params);const writerWait=await observeWait(pool,database,table,writer.connection.threadId);commitGate.resolve();const result=await timeout(op,'commit');assert(result.ok,JSON.stringify(result));await timeout(write,'post commit writer');await writer.rollback();assert(h.state().committed&&h.state().released);
            held.push({table,waits,heldLocks,writerWait,writerSql,result,...h.state(),entries:h.entries});save('locks-through-commit.json',held);
          }finally{continueGate.resolve();commitGate.resolve();await blocker.rollback();blocker.release();await writer.rollback();writer.release();if(op)await timeout(op,'holder finally');if(write)await timeout(write,'writer finally');}
        }
      });
      await check('original failure rolls back physical definition/source/mapping writes and releases connection',async()=>{
        for(const [operation,pattern]of [['saveDefinition',/INSERT INTO data_map_definition_events/],['addSourceMapping',/INSERT INTO data_map_source_mappings/],['saveV7Mapping',/INSERT INTO data_map_v7_mapping_versions/]]){
          const before=await physical(),h=observed('current',{onExecute:async(db,sql)=>{if(pattern.test(sql))throw Object.assign(Error('B02 injected transaction failure'),{code:'B02_INJECTED_FAILURE'});}});
          const result=await outcome(()=>ops[operation](h.repository)(whoFor(operation)));assert.equal(result.code,'B02_INJECTED_FAILURE');assert.deepEqual(await physical(),before);assert(h.state().rolledBack&&h.state().released);transactions.push({operation,result,...h.state(),entries:h.entries});
        }
      });
    }
    await check('native V8 / supported V7 fixed bytes, full physical snapshots and old hashes remain unchanged',async()=>{
      const v=await repo.getCurrent(contact,'object',object.entity_id);assert.equal(v.base_digest,digest(await sourceSnapshot(pool,'object',object.entity_id)));assert.equal(v.definition.business_meaning,'synthetic baseline');
      for(const format of ['v8','v7']){const detail=await repo.getV7Source(lead,sources[format].source_id);assert.equal(detail.schema_version,docs[format].schema_version);assert.equal(detail.content_digest,require('../server/v7FixedSource').contentHash(docs[format]));assert.equal(detail.mappings[0].mapping_version_id,maps[format].mapping_version_id);assert.equal(detail.raw_sha256,sha(Buffer.from(JSON.stringify(docs[format]))));}
      save('preservation.json',{objectVersion:v,fieldVersion:await repo.getVersion(contact,field.version_id),sources,maps,formats:Object.values(docs).map(d=>d.schema_version),noHashAlgorithmChange:true});
    });
    save('transactions.json',transactions);save('comparisons.json',comparisons);passed=true;
  },{stage:'02',randomDatabase:true});
  }catch(e){failure={code:e.code,message:e.message,stack:e.stack};save('failure.json',failure);throw e;}
  finally{
    let cleanup;if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','label=infomat.stage02='+target.owner],{env:isolatedEnvironment(),encoding:'utf8',windowsHide:true}).trim();const mysqlPortClosed=await refused(target.port);cleanup={...target,remaining,mysqlPortClosed,containerRemoved:remaining==='',poolEnded:true};save('resource-cleanup.json',cleanup);assert.equal(remaining,'');assert(mysqlPortClosed);}
    save('results.json',{passed,failure,probe,checks,beforeSha256:input.sha256,currentSha256:sha(fs.readFileSync(filename)),beforeModules:beforeInputs.map(f=>({path:f.path,sha256:f.sha256,snapshot:f.snapshot})),races:races.map(r=>({version:r.version,name:r.name,operation:r.operation,expected:r.expected,code:r.result.code,ok:r.result.ok,realWaitCount:r.waits.length,released:r.released})),heldLockChecks:held.length,comparisons:comparisons.length,cleanup,formalDatabaseAccess:false,businessAccepted:false});
  }
}
main().catch(e=>{console.error(e);process.exitCode=1;});
