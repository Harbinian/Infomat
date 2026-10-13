// Public-office target qualification regression. --output: new directory inside
// this dispatch; --baseline: its immutable officeRepository input snapshot.
// --probe-only proves the reachable before defect without changing production.
// Only freshMysql owns UUID/tmpfs mysql:8.4 --pull never on a random loopback port.
// Synthetic schema/rows only; no env file, worker, HTTP, AI, notification or UI.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),Module=require('node:module'),cp=require('node:child_process'),net=require('node:net');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {makeIdentityMysqlRepository}=require('../server/identityMysqlRepository');
const {makeOfficeRepository}=require('../server/officeRepository');
const {contentHash}=require('../server/processPreviewReview');
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const output=path.resolve(arg('--output')||''),baseline=path.resolve(arg('--baseline')||''),probeOnly=process.argv.includes('--probe-only');
const dispatchRoot=path.resolve(__dirname,'../../../artifacts/mdm-3000-upgrade-20260916/p00-20260916-120151/evidence/p25/architecture-first-plan-20261008-01/runs/B02-20261009-033408-8f025b95');
assert(process.argv.includes('--output')&&path.dirname(output)===dispatchRoot&&!fs.existsSync(output));
assert.equal(baseline,path.join(dispatchRoot,'input-snapshots/165-apps__mdm-platform__server__officeRepository.js'));
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const baselineHash=sha(fs.readFileSync(baseline));assert.equal(baselineHash,'55edaeedb529c5fcf60936d46620fd9f79dcfd9d4b1e3d74f5f14f7d4bdf2398');
fs.mkdirSync(output);const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const filename=path.resolve(__dirname,'../server/officeRepository.js'),old=new Module(filename,module);old.filename=filename;old.paths=Module._nodeModulePaths(path.dirname(filename));old._compile(fs.readFileSync(baseline,'utf8'),filename);
const factories={before:old.exports.makeOfficeRepository,current:makeOfficeRepository};
const D0='9007199254740992',D1='9007199254740993',O='9007199254741101',M='9007199254741001',P='9007199254741002',N='9007199254741003';
const lead={personId:81,accountId:181,authVersion:1},manager={personId:M,accountId:'9007199254741301',authVersion:'9007199254741401'},member={personId:P,accountId:'9007199254741302',authVersion:'9007199254741402'};
const denied={code:'OFFICE_ACCESS_DENIED',statusCode:403},inactiveDepartment={code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办公室所属部门未启用'};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const checks=[],races=[],transactions=[],comparisons=[],commitLocks=[];let target,cleanup=false;
const businessTables=['mdm_todos','mdm_todo_office_assignments','mdm_todo_events','process_governance_issues','data_map_analysis_issue_bindings','data_map_analysis_issue_tasks'];
async function main(){
  try {await withFreshMysql(async context=>{
    const {pool,port,containerId,owner,database}=context;target={owner,database,containerId,port,host:'127.0.0.1',storage:'owned tmpfs',image:'mysql:8.4',pull:'never',stage:'02'};save('owned-target.json',target);
    await makeIdentityMysqlRepository(pool).initSchema();
    await pool.execute(require('../server/analysisIssueSchema').statements()[0]);
    await pool.execute(require('../server/analysisTaskSchema').statements()[0]);
    for(const [id,code]of [[91,'SAFE'],[92,'OTHER'],[D0,'D0'],[D1,'D1']])await pool.execute('INSERT INTO departments(id,code,name,path) VALUES (?,?,?,?)',[String(id),code,code,'/'+id+'/']);
    const actors=[{...lead,dept:91,roles:['mdm_lead']},{...manager,dept:D0,roles:[]},{...member,dept:D0,roles:[]},{personId:N,accountId:'9007199254741303',authVersion:1,dept:D0,roles:[]},{personId:85,accountId:185,authVersion:1,dept:91,roles:['admin','mdm_lead']},{personId:86,accountId:186,authVersion:1,dept:92,roles:['department_contact']}];
    for(const actor of actors){
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[String(actor.personId),'P'+actor.personId,'synthetic '+actor.personId,String(actor.dept)]);
      await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-unused','active',0,?)",[String(actor.accountId),String(actor.personId),'P'+actor.personId,String(actor.authVersion)]);
      for(const role of actor.roles)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'B02 owned synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[String(actor.personId),role==='department_contact'?'department':'global',role==='department_contact'?String(actor.dept):null,role]);
    }
    for(const [id,dept,person]of [[31,91,81],[O,D1,M]])await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (?,?,?,'office',?,?)",[String(id),'O'+id,'O'+id,String(dept),String(person)]);
    for(const [office,person]of [[31,81],[O,M],[O,P]])await pool.execute('INSERT INTO office_membership(office_id,person_id) VALUES (?,?)',[String(office),String(person)]);
    await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,content) VALUES (7,91,'general','legacy office todo')");
    await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,note) VALUES (7,'legacy_imported',?)",['{"legacy":"保留原JSON\\n与旧ID","unknown":null}']);
    // Offset makes all new todo IDs BIGINT; adjacent assignees retain exact values.
    await pool.execute('ALTER TABLE mdm_todos AUTO_INCREMENT=9007199254741800');
    const versions=[];
    for(const [format,id]of [['v8','9007199254743000'],['v7','9007199254743001']]){
      const document=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json')));document.process.process_ref='B02_TARGET_'+format;
      const body=JSON.stringify(document),hash=contentHash(document),key=document.process.process_ref;
      const [master]=await pool.execute('INSERT INTO process_design_documents(document_no,document_title,owning_department_id,process_ref) VALUES (?,?,?,?)',[key,key,D1,key]);
      const [draft]=await pool.execute("INSERT INTO process_design_drafts(document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES (?,?,?,'A',?,'synthetic','synthetic','synthetic',?)",[String(master.insertId),key,key,key,D1]);
      await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status) VALUES (?,?,?,?,?,'A',?,?,?,?,?,1,'published')",[id,String(draft.insertId),String(master.insertId),key,key,key+':A',D1,document.schema_version,body,hash]);versions.push({id,body,hash,schema:document.schema_version});
    }
    const immutable=async()=>{const [rows]=await pool.query('SELECT *,CAST(id AS CHAR) exact_id FROM process_design_versions ORDER BY id');return rows;},immutableBefore=await immutable();
    const snapshot=async()=>{const result={};for(const table of businessTables){const [rows]=await pool.query('SELECT * FROM '+table);result[table]=rows;}return result;};
    const trace=[];let commitHook=null,injected=null;
    const observed=new Proxy(pool,{get(object,key){if(key==='getConnection')return async()=>{
      const db=await pool.getConnection();const connectionId=db.connection.threadId;return new Proxy(db,{get(object,key){
        if(key==='beginTransaction')return async()=>{const [[row]]=await db.query('SELECT @@session.transaction_isolation isolation_level');assert.equal(row.isolation_level,'REPEATABLE-READ');trace.push({connectionId,method:'beginTransaction',isolation:row.isolation_level});return db.beginTransaction();};
        if(['execute','query'].includes(key))return async(sql,params=[])=>{const entry={connectionId,sql,params,finished:false};trace.push(entry);try {if(injected&&sql.startsWith(injected))throw Object.assign(new Error('B02_SYNTHETIC_WRITE_FAILURE'),{code:'B02_SYNTHETIC_WRITE_FAILURE'});return await db[key](sql,params);}finally{entry.finished=true;}};
        if(key==='commit')return async()=>{trace.push({connectionId,method:'commitRequested'});const afterCommit=commitHook?await commitHook(db):null;await db.commit();trace.push({connectionId,method:'committed'});if(afterCommit)await afterCommit();};
        if(key==='rollback')return async()=>{await db.rollback();trace.push({connectionId,method:'rollback'});};
        if(key==='release')return ()=>{db.release();trace.push({connectionId,method:'release'});};
        const value=object[key];return typeof value==='function'?value.bind(object):value;
      }});
    };const value=object[key];return typeof value==='function'?value.bind(object):value;}});
    const repos=Object.fromEntries(Object.entries(factories).map(([name,factory])=>[name,factory(observed)]));
    async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
    const create=(repo,office=O,version=null,request=crypto.randomUUID())=>repo.createTask(lead,{office_id:office,request_id:request,content:'B02 target synthetic',process_version_id:version});
    async function prepare(operation){
      if(operation==='create')return null;
      if(operation==='route'){const [result]=await pool.execute("INSERT INTO mdm_todos(to_dept_id,type,content) VALUES (?,'general','original todo')",[D1]);const [[id]]=await pool.query('SELECT CAST(id AS CHAR) id FROM mdm_todos WHERE content=\'original todo\' ORDER BY id DESC LIMIT 1');assert(result.affectedRows);return id.id;}
      const value=await create(repos.current);if(operation==='complete')await repos.current.assignPerson(manager,value.id,{assignee_person_id:P,expected_revision:1});return value.id;
    }
    const act=(repo,operation,id)=>operation==='create'?create(repo):operation==='route'?repo.routeExistingTask(lead,id,{office_id:O}):operation==='assign'?repo.assignPerson(manager,id,{assignee_person_id:P,expected_revision:1}):repo.completeTask(member,id,{note:'original completion note',expected_revision:2});
    async function engineWait(waiter,blocker){
      const [rows]=await pool.query(`SELECT r.OBJECT_NAME table_name,r.INDEX_NAME index_name,r.LOCK_DATA lock_data,r.LOCK_MODE lock_mode,rt.PROCESSLIST_ID requesting_connection,bt.PROCESSLIST_ID blocking_connection
        FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks r ON r.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND r.ENGINE=w.ENGINE
        JOIN performance_schema.data_locks b ON b.ENGINE_LOCK_ID=w.BLOCKING_ENGINE_LOCK_ID AND b.ENGINE=w.ENGINE
        JOIN performance_schema.threads rt ON rt.THREAD_ID=r.THREAD_ID JOIN performance_schema.threads bt ON bt.THREAD_ID=b.THREAD_ID
        WHERE rt.PROCESSLIST_ID=? AND bt.PROCESSLIST_ID=?`,[waiter,blocker]);return rows;
    }
    async function waitFor(pending,start,blocker){
      for(let i=0;i<160;i++){const entry=trace.slice(start).find(e=>e.sql&&!e.finished);if(entry){const rows=await engineWait(entry.connectionId,blocker);if(rows.length)return {rows,waitSql:entry.sql,waiter:entry.connectionId,blocker};}if(pending.finished)break;await sleep(25);}throw Error('B02_REAL_DATA_LOCK_WAIT_REQUIRED');
    }
    function assertTrace(entries,operation){
      const connections=new Set(entries.map(e=>e.connectionId));assert.equal(connections.size,1,'one original transaction connection');
      const sql=entries.filter(e=>e.sql),locks=sql.filter(e=>/FOR UPDATE$/.test(e.sql));
      assert(locks[0].sql.includes('user_accounts'));assert(locks[1].sql.includes('FROM person WHERE'));assert(locks[2].sql.includes('person_roles'));
      if(['assign','complete'].includes(operation)){assert(sql[0].sql.includes('information_schema'));assert.equal(sql[1].sql,'SELECT issue_id FROM data_map_analysis_issue_tasks WHERE todo_id=?');assert(!/FOR (UPDATE|SHARE)/.test(sql[1].sql));}
      assert.equal(entries.at(-1).method,'release');assert(entries.some(e=>['committed','rollback'].includes(e.method)));
    }
    async function race(name,operation,lockSql,lockParams,mutation,restore,expected,{departmentGap=false,expectedSuccess=false}={}){
      const evidence={name,operation,productionSnapshot: ['assign','complete'].includes(operation)?'original analysisTaskLock SELECT issue_id (unlinked ordinary office task) before actor locks':'no earlier consistent InnoDB read added',variants:[]};
      for(const variant of ['before','current']){
        const id=await prepare(operation),blocker=await pool.getConnection(),start=trace.length;let pending;
        try {
          await blocker.beginTransaction();await blocker.execute(lockSql,lockParams);const businessBefore=await snapshot();
          pending={finished:false};pending.promise=act(repos[variant],operation,id).then(value=>({value}),error=>({error:{code:error.code,statusCode:error.statusCode,message:error.message}})).finally(()=>{pending.finished=true;});
          const wait=await waitFor(pending,start,blocker.connection.threadId);assert.deepEqual(await snapshot(),businessBefore,'no business mutation while waiting');
          await mutation(blocker,id);await blocker.commit();const result=await pending.promise,entries=trace.slice(start);assertTrace(entries,operation);
          const gapExpected=departmentGap&&(variant==='before'||probeOnly);
          if(gapExpected||expectedSuccess){assert(result.value,'expected original legal operation or reproduced gap');assert.notDeepEqual(await snapshot(),businessBefore);}else{assert.deepEqual(result.error,expected);assert.deepEqual(await snapshot(),businessBefore,'refusal completely rolls back business rows');}
          evidence.variants.push({variant,id,wait,result,trace:entries,businessUnchanged:!gapExpected&&!expectedSuccess,staleQualificationAccepted:gapExpected,expectedSuccess});
        }finally{await blocker.rollback();blocker.release();if(pending)await pending.promise;await restore(id);}
      }
      races.push(evidence);save('qualification-races.json',races);
    }
    for(const operation of ['assign','complete'])await check(operation+' reachable target department RR gap before/current',()=>race('department-inactive-'+operation,operation,'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>db.execute("UPDATE departments SET status='inactive' WHERE id=?",[D1]),()=>pool.execute("UPDATE departments SET status='active' WHERE id=?",[D1]),inactiveDepartment,{departmentGap:true}));
    if(probeOnly){save('probe-result.json',{passed:true,actualPublicPath:true,injectedEarlySnapshot:false,gapReproduced:races.every(r=>r.variants.every(v=>v.staleQualificationAccepted))});return;}
    for(const operation of ['create','route'])await check(operation+' original target department locking read already protects current state',()=>race('department-inactive-'+operation,operation,'SELECT id FROM departments WHERE id=? FOR UPDATE',[D1],db=>db.execute("UPDATE departments SET status='inactive' WHERE id=?",[D1]),()=>pool.execute("UPDATE departments SET status='active' WHERE id=?",[D1]),inactiveDepartment));
    const inactiveOffice={code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办公室尚未启用或未明确归口部门，请先发布组织架构。'};
    for(const operation of ['create','route','assign','complete'])await check(operation+' office status after real lock wait',()=>race('office-inactive-'+operation,operation,'SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute("UPDATE org_unit SET status='inactive' WHERE org_unit_id=?",[O]),()=>pool.execute("UPDATE org_unit SET status='active' WHERE org_unit_id=?",[O]),inactiveOffice));
    await check('manager relation after real office lock wait',()=>race('manager-replaced','assign','SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[N,O]),()=>pool.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[M,O]),{...denied,message:'只有该办公室负责人可以分配人员'}));
    await check('office department current relation retains original route scope',()=>race('department-moved','route','SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute('UPDATE org_unit SET department_id=? WHERE org_unit_id=?',[D0,O]),()=>pool.execute('UPDATE org_unit SET department_id=? WHERE org_unit_id=?',[D1,O]),{code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办公室必须属于原待办的接收部门'}));
    for(const change of ['membership-inactive','membership-deleted','person-inactive','employment-leave'])await check('assign target '+change+' after real lock wait',()=>race(change,'assign',change.startsWith('membership')?'SELECT person_id FROM office_membership WHERE office_id=? AND person_id=? FOR UPDATE':'SELECT person_id FROM person WHERE person_id=? FOR UPDATE',change.startsWith('membership')?[O,P]:[P],db=>change==='membership-inactive'?db.execute("UPDATE office_membership SET status='inactive' WHERE office_id=? AND person_id=?",[O,P]):change==='membership-deleted'?db.execute('DELETE FROM office_membership WHERE office_id=? AND person_id=?',[O,P]):db.execute(`UPDATE person SET ${change==='person-inactive'?"status='inactive'":"employment_status='leave'"} WHERE person_id=?`,[P]),async()=>{await pool.execute("UPDATE person SET status='active',employment_status='active' WHERE person_id=?",[P]);await pool.execute("INSERT INTO office_membership(office_id,person_id,status) VALUES (?,?,'active') ON DUPLICATE KEY UPDATE status='active'",[O,P]);},{code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办理人员必须是该办公室当前有效成员'}));
    // Blocker's parent-person lock precedes its membership mutation, matching
    // the foreign-key lock dependency; do not invert actor/person and member locks.
    await check('complete original current membership after real lock wait',()=>race('completion-membership-inactive','complete','SELECT person_id FROM person WHERE person_id=? FOR UPDATE',[P],db=>db.execute("UPDATE office_membership SET status='inactive' WHERE office_id=? AND person_id=?",[O,P]),()=>pool.execute("UPDATE office_membership SET status='active' WHERE office_id=? AND person_id=?",[O,P]),{...denied,message:'只有当前被分配的办公室成员可以办结此任务'}));
    await check('no new completion manager requirement after real office lock wait',()=>race('completion-manager-replaced','complete','SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[N,O]),()=>pool.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[M,O]),null,{expectedSuccess:true}));
    await check('existing unresolved department guard after real office lock wait',()=>race('office-department-null','assign','SELECT org_unit_id FROM org_unit WHERE org_unit_id=? FOR UPDATE',[O],db=>db.execute('UPDATE org_unit SET department_id=NULL WHERE org_unit_id=?',[O]),()=>pool.execute('UPDATE org_unit SET department_id=? WHERE org_unit_id=?',[D1,O]),inactiveOffice));
    // Task mutations use the task's own prepared ID, without creating another authority.
    for(const operation of ['assign','complete'])await check(operation+' task current revision/status guard',async()=>{
      const id=await prepare(operation),blocker=await pool.getConnection(),start=trace.length;let pending;
      try{await blocker.beginTransaction();await blocker.execute('SELECT id FROM mdm_todos WHERE id=? FOR UPDATE',[id]);pending={finished:false};pending.promise=act(repos.current,operation,id).then(value=>({value}),error=>({error:{code:error.code,statusCode:error.statusCode,message:error.message}})).finally(()=>{pending.finished=true;});
        const wait=await waitFor(pending,start,blocker.connection.threadId);await blocker.execute("UPDATE mdm_todos SET status='done' WHERE id=?",[id]);await blocker.commit();const state=await snapshot(),result=await pending.promise;assert.deepEqual(result.error,{code:'OFFICE_TASK_CHANGED',statusCode:409,message:'任务已被其他人更新，请刷新后再办理。'});assert.deepEqual(await snapshot(),state);assertTrace(trace.slice(start),operation);races.push({name:'task-done-'+operation,operation,current:{id,wait,result,trace:trace.slice(start)}});
      }finally{await blocker.rollback();blocker.release();if(pending)await pending.promise;}
    });save('qualification-races.json',races);
    async function outcome(repo,operation,id,session){try{return {value:await (session?repo.createTask(session,{office_id:O,content:'denied',request_id:crypto.randomUUID()}):act(repo,operation,id))};}catch(e){return {error:{code:e.code,statusCode:e.statusCode,message:e.message}};}}
    await check('legal exact BIGINT and original serialized JSON agree with baseline',async()=>{
      for(const version of versions){const variants=[];for(const variant of ['before','current']){
        const request=crypto.randomUUID(),created=await create(repos[variant],O,version.id,request);assert.equal(typeof created.id,'string');
        const assigned=await repos[variant].assignPerson(manager,created.id,{assignee_person_id:P,expected_revision:1});
        const complete=await repos[variant].completeTask(member,created.id,{note:'original completion note',expected_revision:2});
        const [[assignment]]=await pool.execute('SELECT CAST(todo_id AS CHAR) todo_id,CAST(office_id AS CHAR) office_id,CAST(assignee_person_id AS CHAR) assignee_person_id,CAST(process_version_id AS CHAR) process_version_id,request_id,revision_no FROM mdm_todo_office_assignments WHERE todo_id=?',[created.id]);
        const [events]=await pool.execute('SELECT event_type,CAST(actor_person_id AS CHAR) actor_person_id,note FROM mdm_todo_events WHERE todo_id=? ORDER BY id',[created.id]);
        assert.equal(assignment.request_id,request);assert.equal(assignment.process_version_id,version.id);assert.equal(assignment.assignee_person_id,P);assert.equal(assignment.revision_no,3);
        variants.push({variant,created,assigned,complete,assignment,events,normalized:{created:{...created,id:'todo'},assigned:{...assigned,id:'todo'},complete:{...complete,id:'todo'},assignment:{...assignment,todo_id:'todo',request_id:'request'},events}});
      }assert.deepEqual(variants[0].normalized,variants[1].normalized);comparisons.push({schema:version.schema,variants});}
      const small=await create(repos.current,31);await repos.current.assignPerson(lead,small.id,{assignee_person_id:81,expected_revision:1});await repos.current.completeTask(lead,small.id,{note:'small integers retained',expected_revision:2});
      const [[legacy]]=await pool.execute("SELECT note FROM mdm_todo_events WHERE todo_id=7 AND event_type='legacy_imported'");
      assert.deepEqual(await repos.current.routeExistingTask(lead,7,{office_id:31}),{id:7,revision_no:1});await repos.current.assignPerson(lead,7,{assignee_person_id:81,expected_revision:1});assert.deepEqual(await repos.current.completeTask(lead,7,{note:'old ID retained',expected_revision:2}),{id:7,status:'done',revision_no:3});
      const [[preserved]]=await pool.execute("SELECT note FROM mdm_todo_events WHERE todo_id=7 AND event_type='legacy_imported'");assert.equal(preserved.note,legacy.note);
      assert.equal((await repos.current.workbench(lead,31)).selected_office_id,31);
      save('comparisons.json',comparisons);
    });
    await check('unchanged typed sessions, admin overlay, no permission and cross-department errors',async()=>{
      const sessions=[{identityKind:'system_admin',accountId:'9007199254741701',personId:null,authVersion:1},{accountId:181,personId:null,authVersion:1},{...manager,accountId:'9007199254741302'},{...manager,authVersion:'9007199254741402'},{...manager,personId:Number(M)},actors[4],actors[5],member];
      for(const session of sessions){const a=await outcome(repos.before,'create',null,session),state=await snapshot(),b=await outcome(repos.current,'create',null,session);assert.deepEqual(a,b);assert.equal(b.error.code,'OFFICE_ACCESS_DENIED');assert.deepEqual(await snapshot(),state);comparisons.push({session,expected:'OFFICE_ACCESS_DENIED',before:a,current:b});}
      await assert.rejects(repos.current.workbench(actors[5],O),{code:'OFFICE_ACCESS_DENIED'});
      const adminView=await repos.current.workbench(actors[4],O);assert.equal(adminView.can_route,false);assert.equal(adminView.can_assign,false);assert.equal(adminView.can_complete,false);assert.deepEqual(await repos.current.personalWorkItems(actors[4]),[]);
      const id=await prepare('assign');for(const repo of Object.values(repos))for(const actor of [actors[4],actors[5],member])await assert.rejects(repo.assignPerson(actor,id,{assignee_person_id:P,expected_revision:1}),{code:'OFFICE_ACCESS_DENIED'});
      await repos.current.assignPerson(manager,id,{assignee_person_id:P,expected_revision:1});await assert.rejects(repos.current.completeTask(manager,id,{note:'adjacent person',expected_revision:2}),{code:'OFFICE_ACCESS_DENIED'});
      await assert.rejects(repos.current.completeTask(member,id,{note:'old revision',expected_revision:1}),{code:'OFFICE_TASK_CHANGED'});
      const request=crypto.randomUUID();await create(repos.current,O,null,request);await assert.rejects(create(repos.current,O,null,request),{code:'OFFICE_TASK_ALREADY_CREATED',statusCode:409});save('comparisons.json',comparisons);
    });
    await check('all mutation failures roll back complete physical business rows and release',async()=>{
      for(const operation of ['create','route','assign','complete'])for(const failure of [operation==='create'?'INSERT INTO mdm_todo_office_assignments':operation==='route'?'UPDATE mdm_todos':operation==='assign'?'UPDATE mdm_todo_office_assignments':'UPDATE mdm_todo_office_assignments','INSERT INTO mdm_todo_events']){
        const id=await prepare(operation),state=await snapshot(),start=trace.length;injected=failure;try{await assert.rejects(act(repos.current,operation,id),{code:'B02_SYNTHETIC_WRITE_FAILURE'});}finally{injected=null;}
        assert.deepEqual(await snapshot(),state);const entries=trace.slice(start);assertTrace(entries,operation);assert(entries.some(e=>e.method==='rollback'));transactions.push({operation,failure,completePhysicalStateEqual:true,trace:entries});
      }save('transactions.json',transactions);
    });
    await check('existing target locks are held through actual commit',async()=>{
      for(const table of ['departments','org_unit','office_membership','person']){
        const id=await prepare('assign');commitHook=async db=>{
          const [locks]=await pool.query(`SELECT l.OBJECT_NAME table_name,l.INDEX_NAME index_name,l.LOCK_DATA lock_data,l.LOCK_MODE lock_mode,l.LOCK_STATUS lock_status FROM performance_schema.data_locks l JOIN performance_schema.threads t ON t.THREAD_ID=l.THREAD_ID WHERE t.PROCESSLIST_ID=? AND l.LOCK_TYPE='RECORD'`,[db.connection.threadId]);
          assert(locks.some(l=>l.table_name===table&&l.lock_status==='GRANTED'));
          const blocker=await pool.getConnection();let update,finished=false;try{
            await blocker.beginTransaction();const sql=table==='departments'?'UPDATE departments SET name=name WHERE id=?':table==='org_unit'?'UPDATE org_unit SET org_unit_name=org_unit_name WHERE org_unit_id=?':table==='person'?'UPDATE person SET person_name=person_name WHERE person_id=?':'UPDATE office_membership SET status=status WHERE office_id=? AND person_id=?';
            update=blocker.execute(sql,table==='office_membership'?[O,P]:[table==='departments'?D1:table==='org_unit'?O:P]).finally(()=>{finished=true;});
            let waits=[];for(let i=0;i<160&&!finished;i++){waits=await engineWait(blocker.connection.threadId,db.connection.threadId);if(waits.length)break;await sleep(25);}assert(waits.length,'lock must block actual second-connection UPDATE before commit');
            commitLocks.push({table,connectionId:db.connection.threadId,blocker:blocker.connection.threadId,locks,waits,actualCommit:true});
            return async()=>{try{await update;await blocker.rollback();}finally{blocker.release();}};
          }catch(error){await blocker.rollback();blocker.release();if(update)await update;throw error;}
        };
        try{await repos.current.assignPerson(manager,id,{assignee_person_id:P,expected_revision:1});}finally{commitHook=null;}
      }save('locks-through-commit.json',commitLocks);
    });
    await check('linked task completion preserves independent issue, reply JSON and closed/completed guards',async()=>{
      const evidence=[];
      for(const variant of ['before','current']){
        const repo=repos[variant],created=await create(repo),issueId=variant==='before'?97:98;
        await pool.execute("INSERT INTO process_governance_issues(issue_id,issue_key,primary_dept_name,source_type,title,what_text,why_text,where_text,who_text,when_text,how_text,how_much_text) VALUES (?,?,'D1','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic','synthetic')",[String(issueId),'B02_TARGET_'+variant]);
        await pool.execute('INSERT INTO data_map_analysis_issue_bindings(issue_id,owner_department_id,revision_no,issue_digest,created_by_person_id,created_at) VALUES (?,?,1,?,?,UTC_TIMESTAMP(3))',[String(issueId),D1,'0'.repeat(64),M]);
        const source={issue_id:String(issueId),office_id:O,purpose:'verify',round_no:1,issue_revision:1,issue_digest:'0'.repeat(64),instruction:'synthetic original instruction'},sourceJson=JSON.stringify(source);
        await pool.execute("INSERT INTO data_map_analysis_issue_tasks(todo_id,issue_id,purpose,round_no,snapshot_json,snapshot_digest,created_by_person_id,created_at) VALUES (?,?,'verify',1,?,?,?,UTC_TIMESTAMP(3))",[created.id,String(issueId),sourceJson,contentHash(source),M]);
        await repo.assignPerson(manager,created.id,{assignee_person_id:P,expected_revision:1});
        const originalReply='{"record_id":"old-record","unknown":"原答复\\n保持","revision":2}';await pool.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_person_id,note) VALUES (?,'compiler_replied',?,?)",[created.id,P,originalReply]);
        const [[issueBefore]]=await pool.execute('SELECT * FROM process_governance_issues WHERE issue_id=?',[String(issueId)]),[[linkBefore]]=await pool.execute('SELECT * FROM data_map_analysis_issue_tasks WHERE todo_id=?',[created.id]);
        const result=await repo.completeTask(member,created.id,{note:'independent completion',expected_revision:2});
        const [[issueAfter]]=await pool.execute('SELECT * FROM process_governance_issues WHERE issue_id=?',[String(issueId)]),[[linkAfter]]=await pool.execute('SELECT * FROM data_map_analysis_issue_tasks WHERE todo_id=?',[created.id]);assert.deepEqual(issueAfter,issueBefore);assert.deepEqual(linkAfter,linkBefore);
        const [[reply]]=await pool.execute("SELECT note FROM mdm_todo_events WHERE todo_id=? AND event_type='compiler_replied'",[created.id]);assert.equal(reply.note,originalReply);
        // Existing per-issue state guard remains ahead of any business write.
        await pool.execute("UPDATE mdm_todos SET status='pending',done_at=NULL WHERE id=?",[created.id]);
        for(const status of ['closed','completed','not_in_scope']){await pool.execute('UPDATE process_governance_issues SET display_status=? WHERE issue_id=?',[status,String(issueId)]);const state=await snapshot();await assert.rejects(repo.completeTask(member,created.id,{note:'must not bypass guard',expected_revision:3}),{code:'DEFINITION_ANALYSIS_CLOSURE_STATE_CONFLICT',statusCode:409,message:'问题已关闭，须由归口部门最终负责人重新打开后继续办理。'});assert.deepEqual(await snapshot(),state);}
        evidence.push({variant,id:created.id,result,issueUnchanged:true,linkSnapshotUnchanged:true,replyJsonUnchanged:true,closedCompletedNotInScopeProtected:true});
      }save('independent-completion.json',evidence);
    });
    assert.deepEqual(await immutable(),immutableBefore);save('preservation.json',{passed:true,versions,immutableRowsEqual:true,originalRequestRevisionAndEventJson:true,oldTestsUnchanged:true,originalSnapshotPrelude:true,noInjectedEarlySnapshot:true});
    save('trace.json',trace);save('loaded-sources.json',Object.keys(require.cache).filter(file=>!file.includes('node_modules')).map(file=>({path:file,sha256:sha(fs.readFileSync(file))})));save('results.json',{passed:true,checks,raceCount:races.length,transactions:transactions.length,commitLocks:commitLocks.length,baselineHash,currentHash:sha(fs.readFileSync(filename)),workerStarted:false,httpStarted:false});
  },{stage:'02',randomDatabase:true});cleanup=true;
  }catch(error){save('failure.json',{code:error.code,message:error.message,stack:error.stack,checks,target});throw error;}
  finally{
    if(target){const remaining=cp.execFileSync('docker',['ps','-aq','--filter','id='+target.containerId],{encoding:'utf8',windowsHide:true,timeout:30000}).trim();
      const closed=await new Promise(resolve=>{const socket=net.connect(target.port,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(false);});socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));socket.setTimeout(2000,()=>{socket.destroy();resolve(false);});});
      save('cleanup.json',{...target,freshHelperReturned:cleanup,remaining,portClosed:closed,passed:remaining===''&&closed});assert.equal(remaining,'');assert(closed,'owned loopback port closed');
    }
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
