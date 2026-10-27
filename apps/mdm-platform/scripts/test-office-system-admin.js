// Synthetic sessions, SQL doubles and random loopback HTTP only; run with
// -r ./scripts/testHelpers/blockRealMysql.js --test. No private config or DB.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { makeOfficeRepository } = require('../server/officeRepository');
const offices = require('../server/routes/offices');
const accounts = require('../server/routes/accounts');
const auth = require('../server/auth');
const { installRequestLogging } = require('../server/securityLog');

process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
const session = {identityKind:'system_admin',userId:'system-admin:7',accountId:7,authVersion:3};
function fixture(options = {}) {
  const calls = [], transactions = [];
  const permissions = options.permissions || [{perm_code:'governance:read-global',effect:'allow'}];
  const pool = {
    async execute(sql, params) {
      calls.push({sql,params});
      assert.match(sql, /^SELECT /, 'read path must issue SELECT only');
      if (sql.includes('FROM schema_migrations')) return [[{migration_key:'synthetic'}]];
      if (sql.includes('FROM system_admin_accounts')) return [[{account_id:String(params[0]),auth_version:'3',account_status:'active',must_change_password:0,...options.account}]];
      if (sql.includes("role_code='admin'")) return [[{role_id:1,role_name:'admin'}]];
      if (sql.includes('FROM role_permissions')) return [permissions];
      if (sql.includes('FROM org_unit o')) {
        assert(!sql.includes('o.manager_person_id=?'), 'system account must not become an employee scope');
        assert.deepEqual(params, []);
        return [[{id:'91',code:'SYNTHETIC_OFFICE',name:'合成办公室',department_id:'11',manager_person_id:'7',status:'active'}]];
      }
      if (sql.includes('FROM office_membership')) return [[{person_id:'7',person_name:'合成员工',current_department_id:'11'}]];
      if (sql.includes('FROM mdm_todo_office_assignments') || sql.includes('information_schema.tables')) return [[]];
      assert.fail('unexpected SQL');
    },
    async getConnection() { return {...pool,
      async beginTransaction() { transactions.push('begin'); },
      async rollback() { transactions.push('rollback'); },
      async commit() { transactions.push('commit'); },
      release() { transactions.push('release'); }
    }; }
  };
  return {repo:makeOfficeRepository(pool),calls,transactions};
}
async function withServer(action) {
  const app = express();
  app.use(express.json());
  installRequestLogging(app);
  app.use((req,_res,next) => {req.session={...session};next();});
  auth.setIdentityRepositoryFactory(() => ({
    async validateSession() { return {valid:true,user:{identityKind:'system_admin',identityRef:session.userId,accountId:7,authVersion:3,must_change_password:0}}; },
    async getUserEffectivePermissions() { return {permSet:new Set(['identity:assign-role']),fieldConstraints:{}}; }
  }));
  app.use('/api/offices',offices);
  app.use('/api/org/accounts',accounts);
  const server = await new Promise(resolve => {const listener=app.listen(0,'127.0.0.1',()=>resolve(listener));});
  try { await action('http://127.0.0.1:'+server.address().port); }
  finally {await new Promise(resolve=>server.close(resolve));auth.resetIdentityRepositoryFactory();accounts.resetRepositoryFactory();}
}

test('independent system administrator reads offices and members without becoming a task actor', async () => {
  const {repo,calls} = fixture();
  const result = await repo.workbench(session,91);
  assert.equal(result.offices.length,1);
  assert.equal(result.members[0].person_id,7);
  assert.equal(result.actor_person_id,null);
  assert.equal(result.can_route,false);
  assert.equal(result.can_assign,false);
  assert.equal(result.can_complete,false);
  assert.deepEqual(result.versions,[]);
  assert.deepEqual(await repo.personalWorkItems(session),[]);
  assert.deepEqual(await repo.closureWorkItems(session),[]);
  assert(!calls.some(call=>call.sql.includes('FROM user_accounts')));
});

test('current status, password, version, feature switch and exact identity still restrict read access', async () => {
  for (const [patch,options] of [
    [{authVersion:2},{}], [{personId:7},{}], [{accountId:8},{}], [{accountId:0},{}],
    [{accountId:Number('9007199254741201')},{}], [{authVersion:3},{account:{account_status:'disabled'}}],
    [{authVersion:3},{account:{must_change_password:1}}], [{authVersion:3},{permissions:[]}],
    [{authVersion:3},{permissions:[{perm_code:'identity:read',effect:'allow'},{perm_code:'identity:read',effect:'deny'}]}]
  ]) {
    const {repo,calls}=fixture(options);
    await assert.rejects(repo.workbench({...session,...patch}),error=>error.statusCode===403);
    assert(!calls.some(call=>call.sql.includes('FROM org_unit o')));
  }
  process.env.MDM_SYSTEM_ADMIN_ENABLED='0';
  try {await assert.rejects(fixture().repo.workbench(session),error=>error.statusCode===403);}
  finally {process.env.MDM_SYSTEM_ADMIN_ENABLED='1';}
  const large='9007199254741201';
  assert.equal((await fixture().repo.workbench({...session,userId:'system-admin:'+large,accountId:large})).actor_person_id,null);
});

test('all system administrator office writes roll back without executing a mutation', async () => {
  for (const [method,args] of [['createTask',[{}]],['routeExistingTask',[91,{}]],['assignPerson',[91,{}]],['completeTask',[91,{}]]]) {
    const {repo,calls,transactions}=fixture();
    await assert.rejects(repo[method](session,...args),error=>error.statusCode===403);
    assert.deepEqual(transactions,['begin','rollback','release']);
    assert(!calls.some(call=>/FOR UPDATE|FOR SHARE|^(INSERT|UPDATE|DELETE)/.test(call.sql)));
  }
});

test('office HTTP read succeeds and writes remain forbidden for an independent administrator', async () => {
  offices.setRepositoryFactory(()=>fixture().repo);
  await withServer(async base=>{
    const response=await fetch(base+'/api/offices/workbench');
    assert.equal(response.status,200);
    assert.equal((await response.json()).actor_person_id,null);
    const denied=await fetch(base+'/api/offices/tasks',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(denied.status,403);
  });
});

test('account 503 keeps bounded feedback while logs preserve only the driver code and request correlation', async () => {
  const lines=[],original=process.stdout.write.bind(process.stdout);
  const error={code:'ER_TABLEACCESS_DENIED_ERROR'};
  for(const field of ['message','sql','sqlMessage','parameters','stack']) Object.defineProperty(error,field,{get(){throw new Error('sensitive field read');}});
  accounts.setRepositoryFactory(()=>({forSystemAdmin(){return this;},async grantRole(){throw error;}}));
  process.stdout.write=(chunk,...args)=>{lines.push(String(chunk));return original(chunk,...args);};
  try {
    await withServer(async base=>{
      const response=await fetch(base+'/api/org/accounts/1/role-assignments',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(response.status,503);
      assert.deepEqual(await response.json(),{error:'账号与授权服务暂不可用',code:'IDENTITY_ACCESS_SERVICE_UNAVAILABLE'});
      const record=lines.flatMap(line=>line.trim().split('\n')).map(line=>{try{return JSON.parse(line);}catch{return {};}}).find(line=>line.event==='request_failed');
      assert.equal(record.code,'ER_TABLEACCESS_DENIED_ERROR');
      assert.equal(record.request_id,response.headers.get('X-Request-Id'));
      assert.equal(record.actor_ref,'system-admin:7');
    });
  } finally {process.stdout.write=original;}
});
