// B02 directory/office precision regression. --output is a NEW artifacts folder;
// --baseline is this dispatch's before snapshot folder. Existing freshMysql only:
// owned tmpfs/UUID DB and synthetic rows, finally owner cleanup. No private config,
// production DB, worker, AI, notification, browser or application replacement.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const Module = require('node:module');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { makeIdentityMysqlRepository, readPersonQualification } = require('../server/identityMysqlRepository');
const { makePublicationRepository, directoryPlan, DIRECTORY_SOURCE_HASH_VERSION } = require('../server/publicationRepository');
const { makeOfficeRepository } = require('../server/officeRepository');
const { normalizePublication, suggestedMapping } = require('../server/publicationSpreadsheet');
const { officeSnapshot, officePublicationState } = require('../server/officePublication');
const { sameIdentityInteger } = require('../server/sessionSubject');
const arg = name => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(arg('--output') || ''), baseline = path.resolve(arg('--baseline') || '');
assert(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
assert(process.argv.includes('--baseline') && baseline.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep));
fs.mkdirSync(output, {recursive:true});
const save = (name,value) => fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const checks = [], hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function check(name,action) { await action(); checks.push(name); console.log('PASS '+name); }
function oldModule(file, override) {
  const absolute = path.resolve(__dirname,'../server',file), old = new Module(absolute,module);
  old.filename=absolute; old.paths=Module._nodeModulePaths(path.dirname(absolute));
  const originalRequire=old.require.bind(old); old.require=name=>override?.[name]||originalRequire(name);
  old._compile(fs.readFileSync(path.join(baseline,'apps__mdm-platform__server__'+file),'utf8'),absolute);
  return old.exports;
}
const oldOffice = oldModule('officePublication.js'), oldPublication = oldModule('publicationRepository.js',{'./officePublication':oldOffice});
const D0='9007199254740992', D1='9007199254740993', P0='9007199254741000', P1='9007199254741001', P2='9007199254741012', P3='9007199254741013';
const O0='9007199254741100', O1='9007199254741101';
function document(kind,rows,headers) { return normalizePublication({kind,title:'B02 synthetic',sourceFileName:'B02-synthetic.xlsx',headers,rows,mapping:suggestedMapping(kind,headers)}); }
const org=(rows,headers=['组织编码','组织名称','组织层级','归口部门编码','办公室负责人工号','上级部门编码','状态'])=>document('organization',rows,headers);
const roster=(rows,headers=['工号','姓名','部门编码','办公室编码','在职状态'])=>document('roster',rows,headers);
let target, cleanup=false;
const receipts=[];
async function main() {
  const prior=process.env.MDM_SYSTEM_ADMIN_ENABLED;process.env.MDM_SYSTEM_ADMIN_ENABLED='1';
  try {
    await withFreshMysql(async context=>{
      const {pool,owner,database,containerId,port}=context;target={owner,database,containerId,port};save('owned-target.json',target);
      const identity=makeIdentityMysqlRepository(pool);await identity.initSchema();
      await require('../server/publicationSchema').managePublicationSchema(pool,'apply');
      await require('../server/officeSchema').manageOfficeSchema(pool,'apply');
      const connection=await pool.getConnection();try{await require('../server/systemAdminMigration').applySystemAdmin(connection);}finally{connection.release();}
      for(const [id,code,parent] of [[91,'SAFE',null],[92,'OTHER',null],[D0,'D0',null],[D1,'D1',D0]])
        await pool.execute('INSERT INTO departments(id,code,name,parent_id,path) VALUES (?,?,?,?,?)',[String(id),code,code,parent,'/'+id+'/']);
      // These two synthetic multi-role actors exercise both directory maintenance
      // and the independent governance office-work permissions in this suite.
      const actors=[{personId:81,accountId:181,authVersion:1,dept:91,roles:['mdm_lead','hr_directory_manager']},
        {personId:P0,accountId:'9007199254741300',authVersion:1,dept:D0,roles:['admin']},
        {personId:P1,accountId:'9007199254741301',authVersion:'9007199254741401',dept:D1,roles:[]},
        {personId:P2,accountId:'9007199254741302',authVersion:1,dept:D0,roles:['department_contact']},
        {personId:P3,dept:D1,roles:[]},
        {personId:85,accountId:185,authVersion:1,dept:91,roles:['admin','mdm_lead','hr_directory_manager']},
        {personId:86,accountId:186,authVersion:1,dept:92,roles:['department_contact']},
        {personId:'9007199254741200',accountId:'9007199254741500',authVersion:'9007199254741601',dept:D1,roles:['mdm_lead','hr_directory_manager']}];
      for(const actor of actors) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (?,?,?,?)',[String(actor.personId),'P'+actor.personId,'P'+actor.personId,String(actor.dept)]);
        if(actor.accountId)await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version) VALUES (?,?,?,'synthetic-unused','active',0,?)",[String(actor.accountId),String(actor.personId),'P'+actor.personId,String(actor.authVersion)]);
        for(const role of actor.roles)await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'B02 owned synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[String(actor.personId),['admin','mdm_lead','hr_directory_manager'].includes(role)?'global':'department',['admin','mdm_lead','hr_directory_manager'].includes(role)?null:String(actor.dept),role]);
      }
      const lead=actors[0], manager=actors[2], bigLead=actors.at(-1), admin=actors[1], overlay=actors[5], outsider=actors[6];
      const system={identityKind:'system_admin',accountId:'9007199254741701',authVersion:1};
      await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,account_status,must_change_password,auth_version,authorization_basis) VALUES (?,'admin','synthetic-unused','active',0,1,'B02 synthetic')",[system.accountId]);
      for(const [id,code,dept,person] of [[31,'SAFE_OFFICE',91,81],[O0,'O0',D0,P0],[O1,'O1',D1,P1]])
        await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id,manager_person_id) VALUES (?,?,?,'office',?,?)",[String(id),code,code,String(dept),String(person)]);
      await pool.execute('INSERT INTO office_membership(office_id,person_id) VALUES (?,?),(?,?)',[O0,P0,O1,P1]);
      const trace=[];let injected=null, earlySnapshot=false;
      const observed=new Proxy(pool,{get(object,name){
        if(name==='getConnection')return async()=>{const db=await pool.getConnection();return new Proxy(db,{get(object,name){
          if(name==='beginTransaction')return async()=>{await db.beginTransaction();if(earlySnapshot)await db.query('SELECT COUNT(*) FROM person');};
          if(['execute','query'].includes(name))return async(sql,params=[])=>{
            const entry={connectionId:db.connection.threadId,accountLock:/user_accounts.*FOR UPDATE/s.test(sql),sql,params,finished:false};trace.push(entry);
            if(injected&&sql.startsWith(injected))throw Object.assign(new Error('B02_SYNTHETIC_AUDIT_FAILURE'),{code:'B02_SYNTHETIC_AUDIT_FAILURE'});
            try{return await db[name](sql,params);}finally{entry.finished=true;}
          };
          const value=object[name];return typeof value==='function'?value.bind(object):value;
        }});};
        const value=object[name];return typeof value==='function'?value.bind(object):value;
      }});
      const publications=makePublicationRepository(observed), offices=makeOfficeRepository(observed);
      const publish=async(doc,actor=lead,review)=>publications.publish({content:doc.content,...(review||await publications.preview(doc)),requestId:crypto.randomUUID(),reason:'B02 synthetic directory change'},actor);
      const create=(actor=lead,office=O1)=>offices.createTask(actor,{office_id:office,content:'B02 synthetic task',request_id:crypto.randomUUID()});
      const tables=['departments','person','user_accounts','person_roles','org_unit','office_membership','mdm_todos','mdm_todo_office_assignments','mdm_todo_events','mdm_publications','mdm_version_log'];
      const snapshot=async()=>{const state={};for(const table of tables){const [rows]=await pool.query('SELECT * FROM '+table);state[table]=rows;}return state;};
      async function rejectUnchanged(action,code){const before=hash(await snapshot());await assert.rejects(action,e=>e.code===code);assert.equal(hash(await snapshot()),before);}
      async function compareDigest(doc) {
        const old=await oldPublication.directoryPlan(pool,doc), current=await directoryPlan(pool,doc);
        assert.equal(current.baseHash,old.baseHash,'legacy snapshot digest is retained independently from the new transient check');
        assert.equal(current.sourceHashVersion,DIRECTORY_SOURCE_HASH_VERSION);
        assert.equal((await publications.preview(doc)).baseHash,current.sourceHash);return current;
      }
      await check('legacy source hash and original physical fields survive separate exact views',async()=>{
        const plain=await oldOffice.officeSnapshot(pool,false),current=await officeSnapshot(pool,false),state=await officePublicationState(pool,false);
        assert.deepEqual(current,plain);assert.deepEqual(state.snapshot,plain);assert.equal(state.identities.offices.find(o=>o.org_unit_code==='O1').org_unit_id,O1);
        assert(!JSON.stringify(current).includes('exact_'));assert(!JSON.stringify(state.snapshot).includes('identities'));
        await compareDigest(org([['D1','D1','部门','','','D0','启用']]));
        await compareDigest(roster([['P'+P1,'P'+P1,'D1','O1','在职']]));
      });
      await check('adjacent BIGINT department parent and hierarchy paths stay distinct',async()=>{
        const doc=org([['D1','D1 renamed','部门','','','D0','启用']]);
        const review=await publications.preview(doc);assert.equal(review.errors.length,0,JSON.stringify(review.errors));
        assert(!review.changes[0].fields.some(f=>f.field==='parent_code'));
        await publish(doc);const [[row]]=await pool.execute('SELECT CAST(parent_id AS CHAR) parent_id,path FROM departments WHERE id=?',[D1]);
        assert.equal(row.parent_id,D0);assert.equal(row.path,'/'+D0+'/'+D1+'/');
        assert((await publications.preview(org([['D0','D0','部门','','','D1','启用']]))).errors.some(e=>e.message.includes('循环')));
      });
      await check('directory admin preservation applies only to exact person, including overlay',async()=>{
        const adjacent=roster([['P'+P1,'adjacent allowed','D1','O1','在职']]);assert.equal((await publications.preview(adjacent)).errors.length,0);
        await publish(adjacent);
        for(const personId of [P0,85])assert((await publications.preview(roster([['P'+personId,'admin blocked','D1','','在职']]))).errors.some(e=>e.message.includes('管理员')));
      });
      await check('exact account and department-role constraints do not attach to adjacent person',async()=>{
        assert((await publications.preview(roster([['P'+P2,'P'+P2,'D1','','在职']]))).errors.some(e=>e.message.includes('撤销')));
        assert((await publications.preview(roster([['P'+P2,'P'+P2,'D0','','离职']]))).errors.some(e=>e.message.includes('停用账号')));
        const doc=roster([['P'+P3,'P'+P3,'D0','','离职']]);assert.equal((await publications.preview(doc)).errors.length,0);await publish(doc);
        const [[row]]=await pool.execute('SELECT CAST(current_department_id AS CHAR) department_id,employment_status FROM person WHERE person_id=?',[P3]);assert.equal(row.department_id,D0);assert.equal(row.employment_status,'leave');
      });
      await check('manual manager retention and multi-office membership remain exact',async()=>{
        const doc=org([['O1','O1 renamed','办公室','D1']],['组织编码','组织名称','组织层级','归口部门编码']);await publish(doc);
        const [[office]]=await pool.execute('SELECT CAST(manager_person_id AS CHAR) manager FROM org_unit WHERE org_unit_id=?',[O1]);assert.equal(office.manager,P1);
        await publish(roster([['P'+P1,'adjacent allowed','D1','O1;SAFE_OFFICE','在职']]));
        const person=(await identity.listRoster()).find(row=>row.person_id===P1);assert.equal(person.current_department_id,D1);assert.deepEqual(person.offices.map(o=>o.id),[O1,31]);
        const adminPerson=(await identity.listRoster()).find(row=>row.person_id===P0);assert.deepEqual(adminPerson.offices.map(o=>o.id),[O0]);
        await publish(roster([['P'+P1,'adjacent allowed','D1']],['工号','姓名','部门编码']));
        assert.equal((await identity.listRoster()).find(row=>row.person_id===P1).offices.length,2);
      });
      await check('office manager/member distinction and adjacent/unauthorized routing',async()=>{
        assert.equal((await offices.workbench(manager,O1)).can_assign,true);assert.equal((await offices.workbench(manager,O1)).selected_office_id,O1);
        await assert.rejects(offices.workbench(manager,O0),{code:'OFFICE_ACCESS_DENIED'});
        const created=await create();
        await rejectUnchanged(()=>offices.assignPerson(admin,created.id,{assignee_person_id:P1,expected_revision:1}),'OFFICE_ACCESS_DENIED');
        await rejectUnchanged(()=>offices.assignPerson(lead,created.id,{assignee_person_id:P1,expected_revision:1}),'OFFICE_ACCESS_DENIED');
        await offices.assignPerson(manager,created.id,{assignee_person_id:P1,expected_revision:1});
        await rejectUnchanged(()=>offices.completeTask(admin,created.id,{note:'forbidden',expected_revision:2}),'OFFICE_ACCESS_DENIED');
        const removal=roster([['P'+P1,'adjacent allowed','D1','SAFE_OFFICE','在职']]);assert((await publications.preview(removal)).errors.some(e=>e.message.includes('未办结')));
        assert((await publications.preview(org([['O1','O1','办公室','D0','P'+P1,'','启用']]))).errors.some(e=>e.message.includes('未办结')));
        await pool.execute("UPDATE office_membership SET status='inactive' WHERE office_id=? AND person_id=?",[O1,P1]);
        await rejectUnchanged(()=>offices.completeTask(manager,created.id,{note:'revoked',expected_revision:2}),'OFFICE_ACCESS_DENIED');
        await pool.execute("UPDATE office_membership SET status='active' WHERE office_id=? AND person_id=?",[O1,P1]);
        await offices.completeTask(manager,created.id,{note:'synthetic complete',expected_revision:2});
        const wb=await offices.workbench(manager,O1);assert.equal(wb.tasks.find(t=>t.id===created.id).status,'done');assert.equal(wb.tasks.find(t=>t.id===created.id).assignee_person_id,P1);
        const [events]=await pool.execute('SELECT CAST(actor_person_id AS CHAR) actor FROM mdm_todo_events WHERE todo_id=? ORDER BY id',[String(created.id)]);assert.equal(events.at(-1).actor,P1);
        const [pending]=await pool.execute("INSERT INTO mdm_todos(to_dept_id,type,content) VALUES (?,'synthetic','cross-department')",[D0]);
        await rejectUnchanged(()=>offices.routeExistingTask(lead,pending.insertId,{office_id:O1}),'PUBLICATION_INPUT_INVALID');
        await offices.routeExistingTask(lead,pending.insertId,{office_id:O0});
      });
      await check('department/office inactive guards use exact owners and pending members',async()=>{
        const disabled=await publications.preview(org([['D0','D0','部门','','','','停用']]));assert(disabled.errors.some(e=>e.message.includes('在职人员')));assert(disabled.errors.some(e=>e.message.includes('办公室')));
        const officeDisabled=await publications.preview(org([['O1','O1','办公室','D1','P'+P1,'','停用']]));assert(officeDisabled.errors.some(e=>e.message.includes('有效成员')));
      });
      await check('publication source changes, immutable payload/version chain and idempotency',async()=>{
        const doc=roster([['P'+P1,'new name','D1','O1;SAFE_OFFICE','在职']]),review=await publications.preview(doc);
        await pool.execute("UPDATE office_membership SET status='inactive' WHERE office_id='31' AND person_id=?",[P1]);
        await rejectUnchanged(()=>publications.publish({content:doc.content,...review,requestId:crypto.randomUUID(),reason:'B02 synthetic directory change'},lead),'PUBLICATION_SOURCE_CHANGED');
        const next=await publications.preview(doc),input={content:doc.content,...next,requestId:crypto.randomUUID(),reason:'B02 synthetic directory change'};
        const first=await publications.publish(input,bigLead),again=await publications.publish(input,bigLead);assert.equal(first.id,again.id);assert(again.idempotent);assert.equal(first.published_by_person_id,bigLead.personId);
        await rejectUnchanged(()=>publications.publish(input,lead),'PUBLICATION_SOURCE_CHANGED');
        const old=await publications.get(first.id);assert.deepEqual(old.content,doc.content);assert.equal(old.content_hash,doc.contentHash);
        await publish(roster([['P'+P1,'next name','D1','O1','在职']]));assert.deepEqual((await publications.get(first.id)).content,old.content);
        const historical=await snapshot();save('physical-row-summary.json',Object.fromEntries(Object.entries(historical).map(([table,rows])=>[table,{count:rows.length,fields:Object.keys(rows[0]||{}),digest:hash(rows)}])));
      });
      await check('system/admin/overlay/no-role/cross-department cannot publish or route',async()=>{
        const doc=org([['SAFE','SAFE','部门','','','','启用']]);
        for(const actor of [admin,overlay,manager,outsider]){
          await rejectUnchanged(()=>publish(doc,actor),'PUBLICATION_ACCESS_CHANGED');await rejectUnchanged(()=>create(actor),'OFFICE_ACCESS_DENIED');
        }
        await rejectUnchanged(()=>publish(doc,system),'PUBLICATION_INPUT_INVALID');await rejectUnchanged(()=>create(system),'OFFICE_ACCESS_DENIED');
        assert.equal((await offices.workbench(overlay,O1)).can_assign,false);assert.equal((await offices.workbench(overlay,O1)).can_route,false);
        assert((await readPersonQualification(pool,bigLead.personId)).valid);assert.equal((await readPersonQualification(pool,'9007199254741201')).valid,false);
      });
      await check('audit failure rolls back full publication and office business transactions',async()=>{
        injected='INSERT INTO mdm_version_log';try{await rejectUnchanged(()=>publish(org([['SAFE','should rollback','部门','','','','启用']])),'B02_SYNTHETIC_AUDIT_FAILURE');}finally{injected=null;}
        injected='INSERT INTO mdm_todo_events';try{await rejectUnchanged(()=>create(),'B02_SYNTHETIC_AUDIT_FAILURE');}finally{injected=null;}
        const task=await create();injected='INSERT INTO mdm_todo_events';try{await rejectUnchanged(()=>offices.assignPerson(manager,task.id,{assignee_person_id:P1,expected_revision:1}),'B02_SYNTHETIC_AUDIT_FAILURE');}finally{injected=null;}
      });
      await check('new BIGINT task ID is read from server rather than rounded insert metadata',async()=>{
        const seed='9007199254742000',next='9007199254742001';
        await pool.execute("INSERT INTO mdm_todos(id,to_dept_id,type,content,status) VALUES (?,'91','synthetic','ID boundary seed','done')",[seed]);
        const task=await create();assert.equal(task.id,next);
        await offices.assignPerson(manager,next,{assignee_person_id:P1,expected_revision:1});
        await offices.completeTask(manager,next,{note:'exact task completed',expected_revision:2});
        const [[row]]=await pool.execute('SELECT CAST(todo_id AS CHAR) id,CAST(assignee_person_id AS CHAR) person_id FROM mdm_todo_office_assignments WHERE todo_id=?',[next]);assert.equal(row.id,next);assert.equal(row.person_id,P1);
        assert.equal((await offices.workbench(manager,O1)).tasks.find(t=>t.id===next).status,'done');
      });
      await check('V8 and supported V7 fixed office sources retain exact version ID and full native body/hash',async()=>{
        for(const [format,id] of [['v8','9007199254743000'],['v7','9007199254743001']]) {
          const document=JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-'+format+'.json'))),key='B02_NATIVE_'+format;
          document.process.process_ref=key;const body=JSON.stringify(document),digest=require('../server/processV7PreviewReview').contentHash(document);
          const [master]=await pool.execute('INSERT INTO process_design_documents(document_no,document_title,owning_department_id,process_ref) VALUES (?,?,?,?)',[key,key,D1,key]);
          const [draft]=await pool.execute("INSERT INTO process_design_drafts(document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES (?,?,?,'A',?,'synthetic','synthetic','synthetic',?)",[String(master.insertId),key,key,key,D1]);
          await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,status) VALUES (?,?,?,?,?,'A',?,?,?,?,?,1,'published')",[id,String(draft.insertId),String(master.insertId),key,key,key+':A',D1,document.schema_version,body,digest]);
          const task=await offices.createTask(lead,{office_id:O1,content:key,request_id:crypto.randomUUID(),process_version_id:id});
          assert.equal((await offices.workbench(manager,O1)).tasks.find(t=>t.id===task.id).process_version_id,id);
          const [[stored]]=await pool.execute('SELECT process_content_json,content_hash FROM process_design_versions WHERE id=?',[id]);assert.equal(stored.process_content_json,body);assert.equal(stored.content_hash,digest);
        }
      });
      async function lockedLoss(name,actor,action,mutation,code) {
        const blocker=await pool.getConnection();let pending;earlySnapshot=true;const start=trace.length,before=hash(await snapshot());
        try {
          await blocker.beginTransaction();await blocker.execute('SELECT account_id FROM user_accounts WHERE account_id=? FOR UPDATE',[String(actor.accountId)]);
          let finished=false;pending=action().then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
          let observedWait=false;for(let i=0;i<300&&!finished;i++) {
            const entry=trace.slice(start).find(e=>e.accountLock&&!e.finished);
            if(entry){const [[waiting]]=await pool.query('SELECT COUNT(*) n FROM performance_schema.data_lock_waits');if(waiting.n>0){observedWait=true;receipts.push({name,connectionId:entry.connectionId,engineWaits:waiting.n,earlyRepeatableRead:true});break;}}
            await new Promise(resolve=>setTimeout(resolve,25));
          }
          assert(observedWait,'real MySQL lock wait required');assert.equal(hash(await snapshot()),before);
          await mutation(blocker);await blocker.commit();const state=hash(await snapshot()),result=await pending;assert.equal(result.error?.code,code);assert.equal(hash(await snapshot()),state,'blocked write has no committed business effects');
        } finally {await blocker.rollback();blocker.release();if(pending)await pending;earlySnapshot=false;}
      }
      await check('publication real lock wait observes role revocation after earlier snapshot',async()=>{
        await lockedLoss('publication-revocation',lead,()=>publish(org([['SAFE','lost permission','部门','','','','启用']])),db=>db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id='81'"),'PUBLICATION_ACCESS_CHANGED');
        await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id='81'");
      });
      await check('office real lock wait observes password/authVersion change after earlier snapshot',async()=>{
        await lockedLoss('office-password',bigLead,()=>create(bigLead),db=>db.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=?',[String(bigLead.accountId)]),'OFFICE_ACCESS_DENIED');
        assert.equal((await identity.validateSession(bigLead)).valid,false);
      });
      await check('office real lock wait observes routing permission revocation',async()=>{
        await lockedLoss('office-revocation',lead,()=>create(lead),db=>db.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id='81'"),'OFFICE_ACCESS_DENIED');
        await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id='81'");
      });
      await check('versioned exact import source detects adjacent IDs while preserving the legacy snapshot digest',async()=>{
        const doc=org([['SAFE','SAFE','部门','','','','启用']]),before=await publications.preview(doc),oldBefore=await oldPublication.directoryPlan(pool,doc);
        await pool.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[P0,O1]);
        const after=await publications.preview(doc),oldAfter=await oldPublication.directoryPlan(pool,doc);
        assert.equal(oldBefore.baseHash,oldAfter.baseHash,'historical driver projection still reproduces its known collision');
        assert.equal(before.sourceHashVersion,DIRECTORY_SOURCE_HASH_VERSION);assert.equal(after.sourceHashVersion,DIRECTORY_SOURCE_HASH_VERSION);
        assert.notEqual(before.baseHash,after.baseHash,'the current import check binds exact decimal identities');
        await rejectUnchanged(()=>publish(doc,lead,before),'PUBLICATION_SOURCE_CHANGED');
        for(const sourceHashVersion of [undefined,'directory-publication-source-v1','directory-publication-source-unknown']) {
          await rejectUnchanged(()=>publish(doc,lead,{...after,sourceHashVersion}),'PUBLICATION_SOURCE_CHECK_EXPIRED');
        }
        save('versioned-source-hash.json',{sourceHashVersion:DIRECTORY_SOURCE_HASH_VERSION,legacyBefore:oldBefore.baseHash,legacyAfter:oldAfter.baseHash,before:before.baseHash,after:after.baseHash,oldPersonId:P1,newPersonId:P0,exactViewsDistinct:!sameIdentityInteger(P0,P1),oldUncommittedChecksRejected:true,staleExactCheckRejected:true});
        await pool.execute('UPDATE org_unit SET manager_person_id=? WHERE org_unit_id=?',[P1,O1]);
      });
      await check('successful legacy request recovers the original receipt and preserves published bytes without another write',async()=>{
        const legacy=oldPublication.makePublicationRepository(observed),doc=org([['SAFE','legacy saved content','部门','','','','启用']]);
        const reviewed=await legacy.preview(doc),input={content:doc.content,...reviewed,requestId:crypto.randomUUID(),reason:'B02 legacy saved synthetic request'};
        assert.equal(input.sourceHashVersion,undefined,'the before implementation supplies an unversioned check');
        const saved=await legacy.publish(input,lead),historical=await legacy.get(saved.id),state=hash(await snapshot());
        const receipt=await publications.publish(input,lead);assert.equal(receipt.id,saved.id);assert.equal(receipt.idempotent,true);
        assert.equal(hash(await snapshot()),state,'receipt recovery must not write business or audit rows');
        const current=await publications.get(saved.id);assert.deepEqual(current.content,historical.content);assert.equal(current.content_hash,historical.content_hash);
        const [[stored]]=await pool.execute('SELECT payload_json,content_hash FROM mdm_publications WHERE id=?',[saved.id]);
        assert.equal(stored.payload_json,JSON.stringify(doc.content));assert.equal(stored.content_hash,doc.contentHash);
        await rejectUnchanged(()=>publications.publish({...input,reason:'different reason'},lead),'PUBLICATION_SOURCE_CHANGED');
      });
      // Identity bindings are checked on both small and large writes sharing the
      // same connection/prepared SQL, in addition to final DB value assertions.
      const identityPositions = [
        [/^SELECT .*FROM user_accounts.*FOR UPDATE/s,[0]], [/^SELECT .*FROM person(?: |_)WHERE.*FOR UPDATE/s,[0]],
        [/^UPDATE person SET/,[1,5]], [/^UPDATE departments SET name/,[3]], [/^UPDATE departments SET parent_id/,[0,1]], [/^UPDATE departments SET path/,[1]],
        [/^UPDATE org_unit SET/,[1,2,4,5]], [/^UPDATE office_membership SET/,[0,1]], [/^INSERT INTO office_membership\(/,[0,1,2,3,4]],
        [/^INSERT INTO mdm_todo_office_assignments\(todo_id,office_id,process_version_id/,[0,1,2,4]], [/^INSERT INTO mdm_todo_office_assignments\(todo_id,office_id,assigned_by/,[0,1,2]],
        [/^UPDATE mdm_todo_office_assignments SET assignee/,[0,1,2]], [/^UPDATE mdm_todo_office_assignments SET revision/,[0]],
        [/^INSERT INTO mdm_todo_events/,[0,2,3]], [/^UPDATE mdm_todos SET status/,[0,1,2]], [/^UPDATE mdm_todos SET to_dept/,[0,1]]
      ];
      for(const entry of trace)for(const [pattern,positions] of identityPositions)if(entry.params.length&&pattern.test(entry.sql))for(const position of positions)assert(entry.params[position]===null||typeof entry.params[position]==='string','identity SQL parameters must always be exact decimals');
      const bindings=trace.filter(e=>identityPositions.some(([pattern])=>pattern.test(e.sql)));
      assert(bindings.length);save('lock-waits.json',receipts);
      save('binding-shapes.json',bindings.map(e=>({operation:e.sql.split(/\s+/).slice(0,4).join(' '),types:e.params.map(p=>p===null?'null':typeof p)})));
    },{stage:'02',randomDatabase:true});cleanup=true;
    save('results.json',{passed:true,checks,target,ownedResourcesCleaned:cleanup,lockWaitReceipts:receipts,sourceHashVersion:DIRECTORY_SOURCE_HASH_VERSION,legacyPublishedContentPreserved:true,formalDatabaseAccess:false});
  } catch(error) {save('results.json',{passed:false,checks,target,error:{code:error.code,message:error.message,stack:error.stack},ownedResourcesCleaned:cleanup});throw error;}
  finally {if(prior===undefined)delete process.env.MDM_SYSTEM_ADMIN_ENABLED;else process.env.MDM_SYSTEM_ADMIN_ENABLED=prior;}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
