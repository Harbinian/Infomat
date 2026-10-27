// All data is synthetic in a new owner-labelled tmpfs MySQL container.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const {withFreshMysql} = require('./testHelpers/freshMysql');
const {makeIdentityMysqlRepository} = require('../server/identityMysqlRepository');
const {makeDirectoryRepository} = require('../server/directoryRepository');
const {makePublicationRepository} = require('../server/publicationRepository');
const {normalizePublication} = require('../server/publicationSpreadsheet');
const checks = [];
async function check(name,action) {await action();checks.push(name);console.log('PASS '+name);}
async function main() {
  await withFreshMysql(async({pool})=>{
    await makeIdentityMysqlRepository(pool).initSchema();
    await require('../server/publicationSchema').managePublicationSchema(pool,'apply');
    await require('../server/officeSchema').manageOfficeSchema(pool,'apply');
    await pool.execute("INSERT INTO departments(id,code,name,path) VALUES (91,'HR','合成人事部','/91/'),(92,'OPS','合成运营部','/92/'),(93,'EMPTY','合成空部门','/93/')");
    const bigPerson = '9007199254741001';
    await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES (81,'HR01','合成人事维护人',91),(82,'LEAD01','合成治理负责人',91),(83,'ADMIN01','合成管理员',91),(?,'P01','合成人员',92)",[bigPerson]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES (181,81,'HR01','unused-test-value','active',0),(182,82,'LEAD01','unused-test-value','active',0),(183,83,'ADMIN01','unused-test-value','active',0)");
    for (const [personId,role] of [[81,'hr_directory_manager'],[82,'mdm_lead'],[83,'admin'],[83,'hr_directory_manager']]) await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','isolated synthetic',CURRENT_DATE FROM roles WHERE role_code=?",[personId,role]);
    await pool.execute("INSERT INTO org_unit(org_unit_id,org_unit_code,org_unit_name,org_type,department_id) VALUES (31,'O1','合成办公室','office',92)");
    await pool.execute('INSERT INTO office_membership(office_id,person_id) VALUES (31,?)',[bigPerson]);
    const hr={personId:81,accountId:181,authVersion:1},lead={personId:82,accountId:182,authVersion:1},admin={personId:83,accountId:183,authVersion:1};
    const repo=makeDirectoryRepository(pool),publications=makePublicationRepository(pool);
    async function input(entity,operation,values,targetId=null) {return {entity,operation,values,...(targetId?{id:targetId}:{}),reason:'合成业务变更依据',expected_snapshot_hash:(await repo.snapshot()).snapshot_hash};}
    async function checked(request) {const preview=await repo.preview(request,hr);return {...request,request_hash:preview.request_hash,request_id:crypto.randomUUID()};}
    async function save(entity,operation,values,targetId) {return repo.save(await checked(await input(entity,operation,values,targetId)),hr);}
    let savedRequest,saved;
    await check('basic projection excludes contacts and preserves large IDs',async()=>{
      const basic=await repo.snapshot(),full=await repo.snapshot({includeContacts:true});
      assert.equal(basic.schema_version,'organization-person-directory-v1');assert.equal(basic.snapshot_hash,full.snapshot_hash);
      const person=basic.persons.find(p=>p.employee_no==='P01');assert.equal(person.person_id,bigPerson);assert.equal('mobile' in person,false);assert.equal('account_id' in person,false);assert.deepEqual(person.office_ids,['31']);
    });
    await check('exact-ID update retains references and records before after reason and actor',async()=>{
      savedRequest=await checked(await input('person','update',{person_name:'修改后的合成人员',mobile:'123456'},bigPerson));
      saved=await repo.save(savedRequest,hr);assert.equal(saved.entity_id,bigPerson);
      const result=await publications.get(saved.id);assert.equal(result.audit.before.person_id,bigPerson);assert.equal(result.audit.before.person_name,'合成人员');assert.equal(result.audit.after.person_name,'修改后的合成人员');assert.equal(result.audit.reason,savedRequest.reason);assert.equal(result.audit.actor_person_id,'81');
      assert.equal(result.audit.actor_name,'合成人事维护人');
      await pool.execute('UPDATE person SET person_name=? WHERE person_id=81',['合成人事新姓名']);
      assert.equal((await publications.get(saved.id)).audit.actor_name,'合成人事维护人');
      await pool.execute('UPDATE person SET person_name=? WHERE person_id=81',['合成人事维护人']);
      assert.equal((await repo.snapshot()).persons.find(p=>p.person_id===bigPerson).current_department_id,'92');
    });
    await check('same request replays once and changed request cannot reuse its ID',async()=>{
      assert.equal((await repo.save(savedRequest,hr)).idempotent,true);
      const changed=await checked(await input('person','update',{person_name:'另一姓名'},bigPerson));changed.request_id=savedRequest.request_id;
      await assert.rejects(()=>repo.save(changed,hr),{code:'DIRECTORY_REQUEST_REUSED'});
      const [[count]]=await pool.query('SELECT COUNT(*) AS n FROM mdm_publications');assert.equal(Number(count.n),1);
    });
    await check('stale preview fails after another person changes directory',async()=>{
      const stale=await checked(await input('person','update',{email:'synthetic@example.invalid'},bigPerson));
      await save('department','create',{code:'NEW',name:'合成新部门'});
      await assert.rejects(()=>repo.save(stale,hr),{code:'DIRECTORY_SOURCE_CHANGED'});
    });
    await check('create rejects duplicate employee and exact hierarchy loop is rejected',async()=>{
      await assert.rejects(async()=>repo.preview(await input('person','create',{employee_no:'P01',person_name:'另一个人',current_department_id:'92'}),hr),{code:'DIRECTORY_DUPLICATE_KEY'});
    }).catch(error=>{throw error;});
    await check('department hierarchy loop and active-child retirement are blocked',async()=>{
      await save('department','update',{parent_id:'91'},'92');
      const loop=await checked(await input('department','update',{parent_id:'92'},'91'));
      await assert.rejects(()=>repo.save(loop,hr),{code:'DIRECTORY_REVIEW_REQUIRED'});
      await assert.rejects(async()=>repo.preview(await input('department','update',{status:'inactive'},'91'),hr),{code:'DIRECTORY_CHILD_DEPARTMENT_IN_USE'});
    });
    await check('office retirement with members and employee departure with active account are blocked',async()=>{
      const request=await checked(await input('office','update',{status:'inactive'},'31'));
      await assert.rejects(()=>repo.save(request,hr),{code:'DIRECTORY_REVIEW_REQUIRED'});
      await pool.execute("INSERT INTO user_accounts(person_id,login_name,password_hash,account_status,must_change_password) VALUES (?,'P01','unused-test-value','active',0)",[bigPerson]);
      const leaving=await checked(await input('person','update',{employment_status:'leave'},bigPerson));
      await assert.rejects(()=>repo.save(leaving,hr),{code:'DIRECTORY_REVIEW_REQUIRED'});
      await pool.execute("UPDATE user_accounts SET account_status='disabled' WHERE person_id=?",[bigPerson]);
    });
    await check('department roles prevent uncoordinated department transfer',async()=>{
      await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,'department',92,'synthetic',CURRENT_DATE FROM roles WHERE role_code='department_contact'",[bigPerson]);
      const moving=await checked(await input('person','update',{current_department_id:'91'},bigPerson));
      await assert.rejects(()=>repo.save(moving,hr),{code:'DIRECTORY_REVIEW_REQUIRED'});
      await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=?",[bigPerson]);
    });
    await check('spreadsheet and direct maintenance share responsibility and active-child protections',async()=>{
      const move=normalizePublication({kind:'roster',title:'合成职责保护',sourceFileName:'synthetic.csv',headers:['工号','姓名','部门编码'],rows:[['P01','修改后的合成人员','HR']],mapping:{employee_no:'工号',person_name:'姓名',department_code:'部门编码'}});
      const reviewed=await publications.preview(move);
      assert.equal(reviewed.errors.length,0);
      await pool.execute('UPDATE departments SET final_responsible_person_id=? WHERE id=93',[bigPerson]);
      assert.match((await publications.preview(move)).errors.map(item=>item.message).join(''),/部门负责人/);
      await assert.rejects(()=>publications.publish({...reviewed,content:move.content,requestId:crypto.randomUUID(),reason:'合成职责保护'},hr),{code:'PUBLICATION_REVIEW_REQUIRED'});
      await assert.rejects(async()=>repo.preview(await input('person','update',{employment_status:'leave'},bigPerson),hr),{code:'DIRECTORY_RESPONSIBILITY_IN_USE'});
      await pool.execute('UPDATE departments SET final_responsible_person_id=NULL WHERE id=93');
      await save('department','create',{code:'CHILD',name:'合成子部门',parent_id:'93'});
      const disable=normalizePublication({kind:'organization',title:'合成子部门保护',sourceFileName:'synthetic.csv',headers:['组织编码','组织名称','状态'],rows:[['EMPTY','合成空部门','inactive']],mapping:{code:'组织编码',name:'组织名称',status:'状态'}});
      const preview=await publications.preview(disable);assert.match(preview.errors.map(item=>item.message).join(''),/下级部门/);
      await assert.rejects(()=>publications.publish({...preview,content:disable.content,requestId:crypto.randomUUID(),reason:'合成子部门保护'},hr),{code:'PUBLICATION_REVIEW_REQUIRED'});
    });
    await check('HR may correct an admin employee name and contacts while leaving authority unchanged',async()=>{
      const [beforeAccounts]=await pool.query('SELECT * FROM user_accounts WHERE person_id=83'),[beforeRoles]=await pool.query('SELECT * FROM person_roles WHERE person_id=83');
      const corrected=await save('person','update',{person_name:'更正管理员员工姓名',mobile:'synthetic-mobile',email:'admin@example.invalid'},'83');
      assert.equal(corrected.entity_id,'83');
      assert.deepEqual((await pool.query('SELECT * FROM user_accounts WHERE person_id=83'))[0],beforeAccounts);assert.deepEqual((await pool.query('SELECT * FROM person_roles WHERE person_id=83'))[0],beforeRoles);
      const moving=await checked(await input('person','update',{current_department_id:'92'},'83'));
      await assert.rejects(()=>repo.save(moving,hr),{code:'DIRECTORY_REVIEW_REQUIRED'});
    });
    await check('MDM lead and admin overlay cannot directly maintain directory',async()=>{
      const request=await input('person','update',{person_name:'拒绝写入'},bigPerson);
      await assert.rejects(()=>repo.preview(request,lead),{code:'DIRECTORY_ACCESS_CHANGED'});
      await assert.rejects(()=>repo.preview(request,admin),{code:'DIRECTORY_ACCESS_CHANGED'});
    });
    await check('spreadsheet directory writes use HR permission and mandatory audit reason',async()=>{
      const normalized=normalizePublication({kind:'roster',title:'合成导入',sourceFileName:'synthetic.csv',headers:['工号','姓名','部门编码'],rows:[['P01','合成导入姓名','OPS']],mapping:{employee_no:'工号',person_name:'姓名',department_code:'部门编码'}});
      const preview=await publications.preview(normalized,'roster');
      const request={...preview,content:normalized.content,datasetKey:'roster',requestId:crypto.randomUUID(),reason:'合成导入变更依据'};
      await assert.rejects(()=>publications.publish(request,lead),{code:'PUBLICATION_ACCESS_CHANGED'});
      await assert.rejects(()=>publications.publish({...request,reason:''},hr),{code:'DIRECTORY_REASON_REQUIRED'});
      const savedImport=await publications.publish(request,hr),detail=await publications.get(savedImport.id);
        assert.equal(detail.audit.reason,request.reason);assert.equal(detail.audit.records[0].before.person_id,bigPerson);assert.equal(detail.audit.records[0].after.person_name,'合成导入姓名');assert.equal(detail.audit.actor_name,'合成人事维护人');
      assert.equal((await publications.publish(request,hr)).idempotent,true);
      await assert.rejects(()=>publications.publish({...request,reason:'另一变更原因'},hr),{code:'PUBLICATION_SOURCE_CHANGED'});
    });
    await check('failed audit insert rolls back directory and publication together',async()=>{
      const request=await checked(await input('person','update',{person_name:'必须回滚'},bigPerson));
      const brokenPool=new Proxy(pool,{get(target,property){if(property==='getConnection')return async()=>{const db=await target.getConnection();return new Proxy(db,{get(connection,name){if(name==='execute')return (sql,params)=>{if(sql.startsWith('INSERT INTO mdm_version_log'))throw new Error('SYNTHETIC_AUDIT_FAILURE');return connection.execute(sql,params);};const value=connection[name];return typeof value==='function'?value.bind(connection):value;}});};const value=target[property];return typeof value==='function'?value.bind(target):value;}});
      await assert.rejects(()=>makeDirectoryRepository(brokenPool).save(request,hr),/SYNTHETIC_AUDIT_FAILURE/);
      const [[count]]=await pool.execute('SELECT COUNT(*) AS n FROM mdm_publications WHERE request_id=?',[request.request_id]);assert.equal(Number(count.n),0);
      assert.equal((await repo.snapshot()).persons.find(p=>p.person_id===bigPerson).person_name,'合成导入姓名');
    });
    await check('revoked HR authority prevents even idempotent saved-request replay',async()=>{
      await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=81");
      await assert.rejects(()=>repo.save(savedRequest,hr),{code:'DIRECTORY_ACCESS_CHANGED'});
      await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=81");
    });
    await check('account lock wait rechecks HR revocation before modifying a target',async()=>{
      const request=await checked(await input('person','update',{person_name:'锁等待不得保存'},bigPerson)),blocker=await pool.getConnection();
      let outcome;
      try {
        await blocker.beginTransaction();await blocker.execute('SELECT account_id FROM user_accounts WHERE person_id=81 FOR UPDATE');
        const pending=repo.save(request,hr);outcome=pending.then(value=>({value}),error=>({error}));
        let waiting=false;
        for(let i=0;i<100;i++){const [[row]]=await pool.query('SELECT COUNT(*) AS n FROM performance_schema.data_lock_waits');if(Number(row.n)>0){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,20));}
        assert.equal(waiting,true,'actual owned database lock wait observed');
        await blocker.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=81");await blocker.commit();
      } finally {await blocker.rollback();blocker.release();}
      assert.equal((await outcome).error.code,'DIRECTORY_ACCESS_CHANGED');
      assert.equal((await repo.snapshot()).persons.find(p=>p.person_id===bigPerson).person_name,'合成导入姓名');
    });
  },{stage:'19',randomDatabase:true});
  console.log(JSON.stringify({result:'DIRECTORY_MAINTENANCE_MYSQL_PASS',checks:checks.length}));
}
main().catch(err=>{console.error(err.stack);process.exitCode=1;});
