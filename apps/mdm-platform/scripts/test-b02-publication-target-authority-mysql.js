// --output <NEW dispatch-owned artifacts folder> --baseline <source snapshot>
// [--probe-only | --baseline-current]. The latter compares an already-fixed HR
// before snapshot; the default retains the historical vulnerability comparator.
// Uses reviewed freshMysql only: mysql:8.4 --pull never, owned
// UUID/tmpfs and random loopback port. Synthetic fixture schema/roles only.
// Public publish operations supply their ORIGINAL request-id RR snapshot; no
// injected early SELECT. performance_schema records actual two-connection waits.
// No private config, default DB, HTTP, worker, AI, notification or browser.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module');
const cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {normalizePublication,suggestedMapping}=require('../server/publicationSpreadsheet');
const current=require('../server/publicationRepository');
const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
const {seedFixedAccessModel}=require('../server/rbacRaciMysqlMigration');
const arg=n=>process.argv[process.argv.indexOf(n)+1],sha=x=>crypto.createHash('sha256').update(x).digest('hex'),hash=x=>sha(JSON.stringify(x));
const output=path.resolve(arg('--output')||''),baseline=path.resolve(arg('--baseline')||''),probe=process.argv.includes('--probe-only'),baselineCurrent=process.argv.includes('--baseline-current');
const baselineMode=baselineCurrent?'current-hr-v5':'historical-before-fix';
assert(!(probe&&baselineCurrent),'--probe-only reproduces the historical defect; do not combine it with --baseline-current');
assert(process.argv.includes('--output')&&output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&!fs.existsSync(output));
assert(process.argv.includes('--baseline')&&baseline.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep)&&fs.existsSync(baseline));
fs.mkdirSync(output,{recursive:true});const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const filename=path.resolve(__dirname,'../server/publicationRepository.js'),old=new Module(filename,module);old.filename=filename;old.paths=Module._nodeModulePaths(path.dirname(filename));old._compile(fs.readFileSync(baseline,'utf8'),filename);
const D0='9007199254740992',D1='9007199254740993',P='9007199254741000',N='9007199254741001',O='9007199254741100',O2='9007199254741101';
const lead={personId:11,accountId:111,authVersion:1},bigLead={personId:'9007199254741200',accountId:'9007199254741300',authVersion:'9007199254741400'};
const historicalLead={personId:12,accountId:112,authVersion:1,roles:['mdm_lead']};
const document=(kind,rows,headers)=>normalizePublication({kind,title:'B02 target synthetic',sourceFileName:'B02-target.csv',headers,rows,mapping:suggestedMapping(kind,headers)});
const roster=(name='P',department='D0',office='O',employment='在职')=>document('roster',[['P',name,department,office,employment]],['工号','姓名','部门编码','办公室编码','在职状态']);
const office=(status='启用',department='D1',manager='N')=>document('organization',[['O','office changed','办公室',department,manager,status]],['组织编码','组织名称','组织层级','归口部门编码','办公室负责人工号','状态']);
const department=()=>document('organization',[['D1','D1','部门','停用']],['组织编码','组织名称','组织层级','状态']);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),checks=[];let target,helperReturned=false;
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
async function main(){try{await withFreshMysql(async context=>{
  const {pool,owner,database,containerId,port}=context;target={owner,database,containerId,port};save('owned-target.json',target);
  // Select exact existing CREATE statements and their foreign-key dependencies.
  // This does not call initSchema, migrations, or a formal/default DB entry.
  const ddl=new Map(splitSqlStatements(mdmMysqlSchemaSql()).map(sql=>[sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)?.[1],sql]));
  const created=new Set();async function create(table){if(created.has(table))return;assert(ddl.has(table),'existing DDL '+table);created.add(table);const sql=ddl.get(table);for(const m of sql.matchAll(/REFERENCES (\w+)\(/g))if(m[1]!==table)await create(m[1]);await pool.query(sql);}
  for(const table of ['departments','person','user_accounts','roles','permissions','role_permissions','person_roles','org_unit','office_membership','mdm_todos','mdm_todo_office_assignments','mdm_todo_events','mdm_publications','mdm_version_log'])await create(table);
  await seedFixedAccessModel(pool,{skipEnsure:true});save('fixture-ddl.json',[...created].map(table=>({table,sql:ddl.get(table),sha256:sha(ddl.get(table))})));
  for(const [id,code] of [[91,'SAFE'],[D0,'D0'],[D1,'D1']])await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (?,?,?,?)',[String(id),code,code,'/'+id+'/']);
  // Historical mode preserves each version's authorized single-role actor.
  // Current-baseline mode uses the same legitimate HR actor for both versions;
  // no actor receives extra grants merely to change a qualification lock plan.
  const actors=[lead,bigLead,{personId:85,accountId:185,authVersion:1,roles:['admin','mdm_lead','hr_directory_manager']},{personId:86,accountId:186,authVersion:1,roles:['department_contact']},historicalLead];
  for(const a of actors){await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,91)',[String(a.personId),'A'+a.personId,'A'+a.personId]);await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,must_change_password,account_status,auth_version) VALUES (?,?,?,'synthetic-unused',0,'active',?)",[String(a.accountId),String(a.personId),'A'+a.personId,String(a.authVersion)]);
    for(const role of a.roles||['hr_directory_manager'])await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'B02 synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[String(a.personId),role==='department_contact'?'department':'global',role==='department_contact'?'91':null,role]);}
  for(const [id,no,dept] of [[P,'P',D0],[N,'N',D1],['81','ALT','91']])await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[id,no,no,dept]);
  await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,must_change_password,account_status) VALUES (? ,?,'P','synthetic-unused',0,'disabled')",['9007199254741500',P]);
  const [[adminRole]]=await pool.query("SELECT CAST(role_id AS CHAR) id FROM roles WHERE role_code='admin'");const [[contactRole]]=await pool.query("SELECT CAST(role_id AS CHAR) id FROM roles WHERE role_code='department_contact'");
  // Both target roles exist before transactions; all later changes are owned fixture SQL.
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,assignment_status,authorization_basis,effective_from) VALUES (?,?,'global',NULL,'revoked','B02 synthetic',CURRENT_DATE),(?,?,'department',?,'revoked','B02 synthetic',CURRENT_DATE)",[P,adminRole.id,P,contactRole.id,D0]);
  for(const [id,code] of [[O,'O'],[O2,'O2']])await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (?,?,?,'office',?,?)",[id,code,code,D1,N]);
  await pool.execute('INSERT INTO office_membership(office_id,person_id) VALUES (?,?)',[O,P]);
  const [todo]=await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,content) VALUES (7,?,'general','old original todo')",[D1]);assert.equal(todo.affectedRows,1);
  await pool.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assignee_person_id,assigned_by_person_id,request_id,revision_no) VALUES (7,?,?,11,?,7)',[O,P,crypto.randomUUID()]);await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_person_id,note) VALUES (7,'legacy_imported',?,'{\"record_id\":\"old-record\",\"revision\":7,\"unknown\":\"原值\"}')",[P]);
  const versions=[];
  for(const [i,schema] of ['v8','v7'].entries()){
    const body=fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+schema+'.json'),'utf8'),parsed=JSON.parse(body),id=String(61+i);
    await pool.execute('INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id) VALUES (?,?,?,?)',[id,'B02-'+schema,'synthetic '+schema,D1]);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,department_id,planned_edition,process_name,reason,basis_type,basis_description) VALUES (?,?,?,?,?,'A','synthetic','synthetic','synthetic','synthetic')",[id,id,'B02-'+schema,'synthetic '+schema,D1]);
    await pool.execute('INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no) VALUES (?,?,?,?,?,\'A\',?,?,?,?,?,7)',[id,id,id,'B02-'+schema,'synthetic '+schema,'B02-'+schema,D1,parsed.schema_version,body,hash(parsed)]);versions.push({id,schema:parsed.schema_version,bodySha256:sha(body),contentHash:hash(parsed)});
  }
  const tables=[...created];
  const casts=new Map();for(const table of created){const [cols]=await pool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND DATA_TYPE IN ('bigint','datetime','timestamp') ORDER BY ORDINAL_POSITION",[table]);casts.set(table,cols.map(c=>'CAST(`'+c.COLUMN_NAME+'` AS CHAR) AS `'+c.COLUMN_NAME+'`').join(','));}
  async function physical(selected=tables){const state={};for(const table of selected){state[table]=(await pool.query('SELECT *'+(casts.get(table)?','+casts.get(table):'')+' FROM '+table+' ORDER BY 1'))[0];}return state;}
  const immutableTables=['process_design_versions','process_design_documents','process_design_drafts','mdm_todo_events','mdm_todos','mdm_todo_office_assignments'];const immutableBefore=await physical(immutableTables);
  const trace=[],races=[],rollbacks=[],locks=[],comparisons=[];let injected=null,commitHook=null;
  const observed=new Proxy(pool,{get(object,name){if(name==='getConnection')return async()=>{
    const db=await pool.getConnection();return new Proxy(db,{get(object,name){
      if(name==='beginTransaction')return async()=>{await db.beginTransaction();trace.push({connectionId:db.connection.threadId,method:'begin'});};
      if(name==='commit')return async()=>{const cleanup=commitHook?await commitHook(db):null;trace.push({connectionId:db.connection.threadId,method:'commit-start'});await db.commit();trace.push({connectionId:db.connection.threadId,method:'committed'});if(cleanup)await cleanup();};
      if(['rollback','release'].includes(name))return (...args)=>{trace.push({connectionId:db.connection.threadId,method:name});return db[name](...args);};
      if(['execute','query'].includes(name))return async(sql,params=[])=>{const entry={connectionId:db.connection.threadId,method:name,sql,params,finished:false};trace.push(entry);try{
        if(injected&&sql.startsWith(injected))throw Object.assign(new Error('B02_SYNTHETIC_WRITE_FAILURE'),{code:'B02_SYNTHETIC_WRITE_FAILURE'});
        const result=await db[name](sql,params);if(sql.includes('SELECT DISTINCT pr.person_id'))entry.adminRows=result[0];return result;
      }finally{entry.finished=true;}};
      const value=object[name];return typeof value==='function'?value.bind(object):value;
    }});
  };const value=object[name];return typeof value==='function'?value.bind(object):value;}});
  const repos={before:old.exports.makePublicationRepository(observed),current:current.makePublicationRepository(observed)};
  const publish=(repo,doc,review,actor=lead,request=crypto.randomUUID())=>repo.publish({content:doc.content,...review,requestId:request,reason:'B02 synthetic directory change'},!baselineCurrent&&repo===repos.before&&actor===lead?historicalLead:actor);
  async function outcome(action){try{return {value:await action()};}catch(e){return {error:{code:e.code,statusCode:e.statusCode,message:e.message,details:e.details}};}}
  function assertTrace(entries){assert.equal(new Set(entries.map(e=>e.connectionId)).size,1);const sql=entries.filter(e=>e.sql);const updates=sql.filter(e=>/FOR UPDATE$/.test(e.sql));assert(updates[0].sql.includes('user_accounts'));assert(updates[1].sql.includes('FROM person WHERE'));assert(updates[2].sql.includes('person_roles'));
    const original=sql.findIndex(e=>e.sql.includes('WHERE request_id=?'));assert(original>=0&&!/FOR (UPDATE|SHARE)/.test(sql[original].sql));const dept=sql.findIndex(e=>e.sql.includes('FROM departments ORDER'));assert(dept>original,'original request SELECT establishes snapshot before target locks');
    const targetSql=sql.filter(e=>e.method==='query'&&/FOR UPDATE$/.test(e.sql));const expected=['FROM departments ORDER','FROM person ORDER','FROM org_unit','FROM office_membership','FROM mdm_todo_office_assignments'];for(let i=0;i<expected.length;i++)assert(targetSql[i].sql.includes(expected[i]));
    assert.equal(entries.at(-1).method,'release');assert(entries.some(e=>['rollback','committed'].includes(e.method)));}
  async function engineWait(waiter,blocker){return (await pool.query(`SELECT r.OBJECT_NAME table_name,r.INDEX_NAME index_name,r.LOCK_DATA lock_data,r.LOCK_MODE lock_mode,rt.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND r.ENGINE=w.ENGINE JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE JOIN performance_schema.threads rt ON rt.THREAD_ID=r.THREAD_ID JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID WHERE rt.PROCESSLIST_ID=? AND bt.PROCESSLIST_ID=?`,[waiter,blocker]))[0];}
  async function waitFor(pending,start,blocker){for(let i=0;i<160;i++){const entry=trace.slice(start).find(e=>e.sql&&!e.finished);if(entry){const rows=await engineWait(entry.connectionId,blocker);if(rows.length)return {rows,waitSql:entry.sql,waiter:entry.connectionId,blocker};}if(pending.finished)break;await sleep(25);}throw Error('B02_REAL_DATA_LOCK_WAIT_REQUIRED');}
  const sourceError={code:'PUBLICATION_SOURCE_CHANGED',statusCode:409,message:'核对后目录或发布版本已变化，请重新核对',details:{}};
  async function race(name,doc,lockSql,params,mutation,restore,{gap=false,staleError=false}={}){
    const evidence={name,baselineMode,originalSnapshot:'publish SELECT mdm_publications WHERE request_id=?',injectedEarlySnapshot:false,variants:[]};
    for(const variant of ['before','current']){const repo=repos[variant],review=await repo.preview(doc),blocker=await pool.getConnection(),start=trace.length;let pending;
      try{await blocker.beginTransaction();const [[isolation]]=await blocker.query('SELECT @@transaction_isolation isolation_level');assert.equal(isolation.isolation_level,'REPEATABLE-READ');await blocker.execute(lockSql,params);const waitingState=await physical();pending={finished:false};pending.promise=outcome(()=>publish(repo,doc,review)).finally(()=>{pending.finished=true;});
        const wait=await waitFor(pending,start,blocker.connection.threadId);assert.deepEqual(await physical(),waitingState,'no writes while locked');await mutation(blocker);await blocker.commit();const externalState=await physical(),expectedPreview=await repos.current.preview(doc),result=await pending.promise,entries=trace.slice(start);assertTrace(entries);
        const originalGap=!baselineCurrent&&gap&&(variant==='before'||probe);if(originalGap&&!staleError){assert(result.value,'reproduce stale admin acceptance');assert(entries.some(e=>e.method==='committed'));}else if(originalGap&&staleError){assert.equal(result.error.code,'PUBLICATION_REVIEW_REQUIRED');assert(expectedPreview.errors.every(e=>!e.message.includes('管理员')),'current admin removed');assert.deepEqual(await physical(),externalState);}else{assert.deepEqual(result.error,sourceError);assert.deepEqual(await physical(),externalState);}
        evidence.variants.push({variant,review,wait,isolation:isolation.isolation_level,expectedCurrentErrors:expectedPreview.errors,result,trace:entries,staleQualificationAccepted:originalGap&&!staleError,staleQualificationRejected:originalGap&&staleError,physicalRowsUnchanged:!originalGap||staleError,completePhysicalDigest:hash(externalState)});
      }finally{await blocker.rollback();blocker.release();if(pending)await pending.promise;await restore();if(gap)await pool.execute("UPDATE person SET person_name='P',current_department_id=? WHERE person_id=?",[D0,P]);}
    }races.push(evidence);fs.writeFileSync(path.join(output,'qualification-races.json'),JSON.stringify(races,null,2)+'\n');
  }
  const targetAdmin=(db,status)=>db.execute('UPDATE person_roles SET assignment_status=? WHERE person_id=? AND role_id=?',[status,P,adminRole.id]);
  await check(baselineCurrent?'before/current HR publish reject a newly granted target admin after real department lock wait':'public publish original request RR snapshot misses new global admin after target department wait',()=>race('admin-granted',roster('changed','D1'),'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>targetAdmin(db,'active'),()=>targetAdmin(pool,'revoked'),{gap:true}));
  if(probe){save('probe-result.json',{passed:true,publicRepositoryOperation:'publish',publicRoute:'/api/publications/publish',originalRequestSnapshot:true,injectedEarlySnapshot:false,realDataLockWaits:true,gapReproduced:races.every(r=>r.variants.every(v=>v.staleQualificationAccepted))});return;}
  await targetAdmin(pool,'active');
  await check('public publish does not retain revoked admin from original RR snapshot',()=>race('admin-revoked',roster('changed','D1'),'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>targetAdmin(db,'revoked'),()=>targetAdmin(pool,'active'),{gap:true,staleError:true}));await targetAdmin(pool,'revoked');
  await targetAdmin(pool,'active');await pool.execute("UPDATE roles SET status='retired' WHERE role_id=?",[adminRole.id]);
  await check('target admin role activation reads current joined role',()=>race('admin-role-activated',roster('changed','D1'),'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>db.execute("UPDATE roles SET status='active' WHERE role_id=?",[adminRole.id]),()=>pool.execute("UPDATE roles SET status='retired' WHERE role_id=?",[adminRole.id]),{gap:true}));await pool.execute("UPDATE roles SET status='active' WHERE role_id=?",[adminRole.id]);await targetAdmin(pool,'revoked');
  await check('existing target department lock reads active status after real wait',()=>race('department-inactive',roster('P'),'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>db.execute("UPDATE departments SET status='inactive' WHERE id=?",[D1]),()=>pool.execute("UPDATE departments SET status='active' WHERE id=?",[D1])));
  await check('existing manager person lock reads current employment status',()=>race('manager-employment',office(),'SELECT person_id FROM person WHERE person_id=? FOR UPDATE',[N],db=>db.execute("UPDATE person SET employment_status='leave' WHERE person_id=?",[N]),()=>pool.execute("UPDATE person SET employment_status='active' WHERE person_id=?",[N])));
  await check('existing target office lock reads current status',()=>race('office-inactive',roster(),'SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute("UPDATE org_unit SET status='inactive' WHERE org_unit_id=?",[O]),()=>pool.execute("UPDATE org_unit SET status='active' WHERE org_unit_id=?",[O])));
  // Parent locks precede FK-child mutations on the blocker. The public operation
  // waits at its ORIGINAL person lock; later original member/assignment reads
  // must include the committed mutation. Do not invert the product's lock order.
  await check('existing membership lock reads current members',()=>race('membership-inactive',office('停用'),'SELECT person_id FROM person WHERE person_id=? FOR UPDATE',[P],db=>db.execute("UPDATE office_membership SET status='inactive' WHERE office_id=? AND person_id=?",[O,P]),()=>pool.execute("UPDATE office_membership SET status='active' WHERE office_id=? AND person_id=?",[O,P])));
  // Use a distinct legacy raw value so both supported before modes observe the
  // original source conflict; adjacent-ID precision has separate coverage.
  await check('existing pending assignment lock reads current assigned person',()=>race('pending-assignee-changed',roster('P','D0','O2'),'SELECT person_id FROM person WHERE person_id=? FOR UPDATE',['81'],db=>db.execute('UPDATE mdm_todo_office_assignments SET assignee_person_id=? WHERE todo_id=7',['81']),()=>pool.execute('UPDATE mdm_todo_office_assignments SET assignee_person_id=? WHERE todo_id=7',[P])));
  await check('existing target account lock reads active account before employment changes',()=>race('account-activated',roster('P','D0','O','离职'),'SELECT account_id FROM user_accounts WHERE person_id=? FOR UPDATE',[P],db=>db.execute("UPDATE user_accounts SET account_status='active' WHERE person_id=?",[P]),()=>pool.execute("UPDATE user_accounts SET account_status='disabled' WHERE person_id=?",[P])));
  await check('existing target assignment lock reads current department scope',()=>race('department-assignment-activated',roster('P','D1'),'SELECT person_role_id FROM person_roles WHERE person_id=? FOR UPDATE',[P],db=>db.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=? AND role_id=?",[P,contactRole.id]),()=>pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=? AND role_id=?",[P,contactRole.id])));
  await check('existing person department/status protects organization disable plan',()=>race('person-department-changed',department(),'SELECT person_id FROM person WHERE person_id=? FOR UPDATE',['81'],db=>db.execute('UPDATE person SET current_department_id=? WHERE person_id=?',[D1,'81']),()=>pool.execute('UPDATE person SET current_department_id=? WHERE person_id=?',['91','81'])));
  await check('original legal paths, hashes, full rows, old IDs and exact adjacent BIGINT retained',async()=>{
    for(const doc of [roster('P'),office(),document('organization',[['D0','D0','部门','启用']],['组织编码','组织名称','组织层级','状态'])]){
      const bodyBefore=JSON.stringify(doc.content),before=await repos.before.preview(doc),now=await repos.current.preview(doc);
      const legacyPlan=await old.exports.directoryPlan(pool,doc),exactPlan=await current.directoryPlan(pool,doc);
      const {baseHash:legacySourceHash,...beforeMetadata}=before;
      const {baseHash:exactSourceHash,sourceHashVersion,...currentMetadata}=now;
      assert.deepEqual(currentMetadata,beforeMetadata,'existing preview metadata, changes and validation remain equivalent');
      assert.equal(Object.hasOwn(before,'sourceHashVersion'),false,'the before implementation supplies an unversioned transient check');
      assert.equal(legacySourceHash,legacyPlan.baseHash);assert.equal(exactPlan.baseHash,legacyPlan.baseHash,'the original snapshot hash projection is preserved');
      assert.equal(sourceHashVersion,current.DIRECTORY_SOURCE_HASH_VERSION);assert.equal(exactPlan.sourceHashVersion,sourceHashVersion);
      assert.equal(exactSourceHash,exactPlan.sourceHash,'the current public check uses the exact source projection');
      assert.notEqual(exactSourceHash,legacySourceHash,'the versioned transient check must not silently reuse the unversioned digest');
      assert.equal(now.contentHash,doc.contentHash);assert.equal(before.contentHash,doc.contentHash);assert.equal(JSON.stringify(doc.content),bodyBefore);
      comparisons.push({kind:doc.content.kind,previewMetadataEqual:true,legacySnapshotHashEqual:true,contentHash:doc.contentHash,legacySourceHash,exactSourceHash,sourceHashVersion,publishedContentUnchanged:true});
    }
    const doc=roster('legal current'),review=await repos.current.preview(doc);assert.equal(review.errors.length,0);const request=crypto.randomUUID(),published=await publish(repos.current,doc,review,bigLead,request);assert.equal(published.published_by_person_id,bigLead.personId);const version=await repos.current.get(published.id);assert.deepEqual(version.content,doc.content);assert.equal(version.content_hash,doc.contentHash);
    const again=await publish(repos.current,doc,review,bigLead,request);assert.equal(again.id,published.id);assert(again.idempotent);assert.equal(typeof published.id,'number');
    const [[person]]=await pool.execute('SELECT CAST(person_id AS CHAR) id,CAST(current_department_id AS CHAR) department FROM person WHERE person_id=?',[P]);assert.deepEqual(person,{id:P,department:D0});const [[neighbour]]=await pool.execute('SELECT person_name FROM person WHERE person_id=?',[N]);assert.equal(neighbour.person_name,'N');
    const unchanged=roster('legal current');await targetAdmin(pool,'active');assert.equal((await repos.current.preview(unchanged)).errors.length,0);await publish(repos.current,unchanged,await repos.current.preview(unchanged));await targetAdmin(pool,'revoked');
    await pool.execute("UPDATE person SET person_name='P' WHERE person_id=?",[P]);
    comparisons.push({published,again,request,oldId7Revision7:true,bodyJsonEqual:true,hashEqual:true,adjacentPersonUntouched:true,originalCrossDepartmentOfficeMembership:true});save('comparisons.json',comparisons);
  });
  await check('system admin, admin overlay, no permission, null/unsafe/mismatched identities retain original denials',async()=>{
    const doc=roster('blocked'),review=await repos.current.preview(doc),actorsToCheck=[{identityKind:'system_admin',accountId:'9007199254741701',personId:null,authVersion:1},{personId:null,accountId:111,authVersion:1},{...bigLead,personId:Number(bigLead.personId)},{...lead,accountId:112},{...bigLead,authVersion:'9007199254741401'},actors[2],actors[3]];
    const results=[];for(const a of actorsToCheck){const physicalBefore=await physical(),before=await outcome(()=>publish(repos.before,doc,review,a)),now=await outcome(()=>publish(repos.current,doc,review,a));assert.deepEqual(now,before);assert(now.error);assert.deepEqual(await physical(),physicalBefore);results.push({actor:a,before,current:now});}save('identity-denials.json',results);
  });
  await check('business write and publication/audit failures roll back every physical row and release',async()=>{
    for(const [doc,failures] of [[roster('rollback'),['UPDATE person SET','INSERT INTO mdm_publications','INSERT INTO mdm_version_log']],[office(),['UPDATE org_unit SET','INSERT INTO mdm_version_log']]])for(const failure of failures){const review=await repos.current.preview(doc),physicalBefore=await physical(),start=trace.length;injected=failure;try{await assert.rejects(publish(repos.current,doc,review),{code:'B02_SYNTHETIC_WRITE_FAILURE'});}finally{injected=null;}assert.deepEqual(await physical(),physicalBefore);const entries=trace.slice(start);assertTrace(entries);assert(entries.some(e=>e.method==='rollback'));rollbacks.push({failure,kind:doc.content.kind,completePhysicalRowsEqual:true,trace:entries});}save('rollbacks.json',rollbacks);
  });
  await check('original target locks and current admin qualification held to actual COMMIT',async()=>{
    await targetAdmin(pool,'active');await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=? AND role_id=?",[P,contactRole.id]);
    const cases=[['department','departments','UPDATE departments SET name=name WHERE id=?',[D1]],['person','person','UPDATE person SET person_name=person_name WHERE person_id=?',[N]],['office','org_unit','UPDATE org_unit SET org_unit_name=org_unit_name WHERE org_unit_id=?',[O]],['membership','office_membership','UPDATE office_membership SET status=status WHERE office_id=? AND person_id=?',[O,P]],['pending assignment','mdm_todo_office_assignments','UPDATE mdm_todo_office_assignments SET revision_no=revision_no WHERE todo_id=7',[]],['account','user_accounts','UPDATE user_accounts SET account_status=account_status WHERE person_id=?',[P]],['assignment','person_roles','UPDATE person_roles SET assignment_status=assignment_status WHERE person_id=? AND role_id=?',[P,contactRole.id]],['admin assignment','person_roles','UPDATE person_roles SET assignment_status=assignment_status WHERE person_id=? AND role_id=?',[P,adminRole.id]],['admin role','roles','UPDATE roles SET status=status WHERE role_id=?',[adminRole.id]]];
    for(const [name,table,sql,params] of cases){const doc=roster('P'),review=await repos.current.preview(doc),start=trace.length;commitHook=async db=>{
      const [held]=await pool.query('SELECT l.OBJECT_NAME table_name,l.INDEX_NAME index_name,l.LOCK_DATA lock_data,l.LOCK_MODE lock_mode,l.LOCK_STATUS lock_status FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.LOCK_TYPE=\'RECORD\'',[db.connection.threadId]);assert(held.some(l=>l.table_name===table&&l.lock_status==='GRANTED'));
      const blocker=await pool.getConnection();let finished=false,update;try{await blocker.beginTransaction();update=blocker.execute(sql,params).finally(()=>{finished=true;});let waits=[];for(let i=0;i<160&&!finished;i++){waits=await engineWait(blocker.connection.threadId,db.connection.threadId);if(waits.length)break;await sleep(25);}assert(waits.length,'actual second connection UPDATE must wait until commit: '+name);locks.push({name,table,held,waits,commitConnection:db.connection.threadId,updateConnection:blocker.connection.threadId});return async()=>{try{await update;await blocker.rollback();}finally{blocker.release();}};
      }catch(e){await blocker.rollback();blocker.release();if(update)await update;throw e;}
    };try{await publish(repos.current,doc,review);}finally{commitHook=null;}assertTrace(trace.slice(start));assert(trace.slice(start).some(e=>e.method==='committed'));}await targetAdmin(pool,'revoked');await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=? AND role_id=?",[P,contactRole.id]);save('locks-through-commit.json',locks);
  });
  // Explicitly restore only the owned assignment timestamp changed by the
  // external race fixture, then compare the complete original physical rows.
  await pool.execute('UPDATE mdm_todo_office_assignments SET updated_at=? WHERE todo_id=7',[immutableBefore.mdm_todo_office_assignments[0].updated_at]);
  assert.deepEqual(await physical(immutableTables),immutableBefore);save('preservation.json',{passed:true,versions,completeImmutablePhysicalRowsEqual:true,originalTodoId:7,originalAssignmentRevision:7,originalReplyJson:true,fixtureAssignmentTimestampRestored:true});
  save('trace.json',trace);save('loaded-sources.json',Object.keys(require.cache).filter(file=>!file.includes('node_modules')).map(file=>({path:file,sha256:sha(fs.readFileSync(file))})));save('results.json',{passed:true,checks,baselineMode,races:races.length,rollbacks:rollbacks.length,commitLocks:locks.length,baselineSha256:sha(fs.readFileSync(baseline)),currentSha256:sha(fs.readFileSync(filename)),originalSnapshot:true,noInjectedEarlySnapshot:true,workerStarted:false,httpStarted:false});
},{stage:'02',randomDatabase:true});helperReturned=true;
}catch(e){save('failure.json',{code:e.code,message:e.message,stack:e.stack,baselineMode,checks,target});throw e;}
finally{if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','id='+target.containerId],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();const portClosed=await new Promise(resolve=>{const s=net.connect(target.port,'127.0.0.1');s.once('connect',()=>{s.destroy();resolve(false);});s.once('error',e=>resolve(e.code==='ECONNREFUSED'));s.setTimeout(2000,()=>{s.destroy();resolve(false);});});save('cleanup.json',{...target,helperReturned,remaining,portClosed,passed:remaining===''&&portClosed});assert.equal(remaining,'');assert(portClosed);}}}
main().catch(e=>{console.error(e);process.exitCode=1;});
