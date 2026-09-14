// Real HTTP/session/CSRF middleware, fixed roles; explicitly injected synthetic repositories.
// Legacy entity APIs are checked at their formal 410 boundary. No database connections.
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', HOST: '127.0.0.1', MDM_ACCESS_MODE: 'http-local', MDM_SESSION_STORE: 'memory',
  MDM_IDENTITY_READ_MODEL: 'mysql', PROCESS_GOVERNANCE_READ_MODEL: 'mysql',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only', MYSQL_DATABASE: 'unreachable_test',
  SESSION_SECRET: 'synthetic-stage04-session-secret-only', PROCESS_V7_PREVIEW_ENABLED: '0', PROCESS_V7_FORMAL_ENABLED: '0'
});
require('./testHelpers/blockRealMysql');
const Module = require('node:module');
const load = Module._load;
Module._load = function(name, ...args) {
  if (name === 'better-sqlite3' || /^(\.\.?\/)+db$/.test(name)) throw new Error('FORMAL_SECURITY_SQLITE_FORBIDDEN');
  return load.call(this, name, ...args);
};
const auth = require('../server/auth');
const org = require('../server/routes/org');
const { getAccessModel } = require('../server/roleDefinitions');
const roles = getAccessModel().roles;
const password = 'SyntheticSecurity04!';
const passwordHash = auth.hashPassword(password);
const users = ['admin', 'mdm_lead', 'department_contact', 'department_mdm_reviewer', 'data_conflict_handler'].map((role, i) => ({
  personId: i + 81, id: i + 81, accountId: i + 181, authVersion: 1, auth_version: 1,
  employeeNo: role, personName: role, name: role, roleCodes: [role], rbacRoles: [{code: role}],
  current_department_id: 91, departmentId: 91, departmentName: '合成甲部', accountStatus: 'active',
  account_status: 'active', must_change_password: 0, permissions: roles.find(r => r.code === role).permissions
}));
const identity = {
  async getUserByEmployeeNo(name) { const u = users.find(u => u.employeeNo === name); return u && {...u, password_hash: passwordHash}; },
  async getCurrentUserPayload(id) { return users.find(u => u.id === Number(id)); },
  async recordSuccessfulLogin() {},
  async validateSession(s) { const u = users.find(u => u.id === s.personId); return {valid: !!u && u.accountStatus === 'active' && u.authVersion === s.authVersion, user: u}; },
  async getUserEffectivePermissions(id) { return {permSet: new Set(users.find(u => u.id === Number(id)).permissions), fieldConstraints: {}}; },
  async getUserRoleCodes(id) { return users.find(u => u.id === Number(id)).rbacRoles; },
  async getDepartmentById(id) { return {id, name: '合成甲部'}; },
  async listDepartments() { return [{id: 91, name: '合成甲部'}]; },
  async getPasswordStatus() { return {is_default_password: false}; }
};
auth.setIdentityRepositoryFactory(() => identity);
org.setIdentityRepositoryFactory(() => identity);
const events = [];
const todos = [];
const comments = [];
let assignedPerson=85;
let coordinationWrites=0;
require('../server/conflictMysqlRepository').setConflictRepositoryFactory(() => ({
  async submitCoordination(id,type,actor) {
    if(actor.actor_person_id!==assignedPerson)return {ok:false,statusCode:403,error:'not assigned'};
    coordinationWrites++;return {ok:true};
  }
}));
require('../server/routes/processGovernance').setProcessGovernanceRepositoryFactory(() => ({
  async getQualityCase() { return {id:1,owner_dept_id:91}; },
  async getMappingTodo() { return {id:1,owner_dept_id:91}; },
  async addQualityCaseComment(id,payload) { comments.push({id,...payload});return {id}; },
  async addMappingTodoComment(id,payload) { comments.push({id,...payload});return {id}; }
}));
require('../server/todoMysqlRepository').setTodoRepositoryFactory(() => ({
  async createTodo(body, actor) { const todo = {id: todos.length + 1, to_dept_id: body.to_dept_id, status: 'open'}; todos.push(todo); events.push({type:'create',actor}); return todo; },
  async getTodo(id) { return todos.find(t => t.id === Number(id)); },
  async completeTodo(id, actor) { const todo = todos.find(t => t.id === Number(id)); todo.status='done'; events.push({type:'done',actor}); return todo; },
  async deleteTodo() { throw new Error('UNEXPECTED_DELETE'); }
}));

async function main() {
  const app = require('../server/index');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(client, url, method = 'GET', body, csrf = true) {
    const res = await fetch(base + url, {method, headers:{'Content-Type':'application/json', Cookie:client.cookie || '',
      ...(csrf && client.csrf ? {'X-CSRF-Token':client.csrf} : {})}, body:body === undefined ? undefined : JSON.stringify(body)});
    if (res.headers.get('set-cookie')) client.cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status, body:await res.json(), headers:res.headers};
  }
  async function login(name, client = {}) {
    const r = await request(client, '/api/org/login','POST',{loginName:name,password});
    assert.equal(r.status,200);
    client.csrf=(await request(client,'/api/csrf-token')).body.csrfToken;
    return client;
  }
  try {
    assert.equal((await request({},'/api/todos','POST',{})).status,401);
    const health=await request({},'/api/health');
    assert.equal(health.headers.get('x-content-type-options'),'nosniff');
    assert.ok(health.headers.get('content-security-policy'));
    const admin=await login('admin'), lead=await login('mdm_lead'), contact=await login('department_contact');
    const handler=await login('data_conflict_handler');
    assert.equal((await request(handler,'/api/conflicts/1/coordination','POST',{result:'A'})).status,200);
    assert.equal(coordinationWrites,1);
    assignedPerson=83;
    assert.equal((await request(contact,'/api/conflicts/1/coordination','POST',{result:'A'})).status,403,'old assignment cannot grant revoked handling permission');
    assert.equal((await request(handler,'/api/conflicts/1/coordination','POST',{result:'A'})).status,403,'permission alone cannot bypass assignment');
    assignedPerson=81;
    assert.equal((await request(admin,'/api/conflicts/1/coordination','POST',{result:'A'})).status,403,'admin cannot coordinate even with historical assignment');
    assert.equal(coordinationWrites,1);
    const oldCookie=contact.cookie; await login('department_contact',contact);
    assert.notEqual(contact.cookie,oldCookie,'login regenerates session');
    assert.equal((await request({cookie:oldCookie},'/api/org/me')).status,401);
    assert.equal((await request(lead,'/api/todos','POST',{to_dept_id:91},false)).status,403,'CSRF required');
    assert.equal((await request(admin,'/api/todos','POST',{to_dept_id:91})).status,403);
    assert.equal((await request(contact,'/api/todos','POST',{to_dept_id:91})).status,403);
    assert.equal(events.length,0,'denied writes must not reach repository');
    assert.equal((await request(lead,'/api/todos','POST',{to_dept_id:91})).status,200,'lead can assign work');
    assert.equal((await request(admin,'/api/todos/1/done','POST',{})).status,403);
    users[2].departmentId=92; users[2].current_department_id=92;
    assert.equal((await request(contact,'/api/todos/1/done','POST',{})).status,403,'cross-department denied');
    assert.equal(todos[0].status,'open'); assert.equal(events.length,1);
    users[2].departmentId=91; users[2].current_department_id=91;
    assert.equal((await request(contact,'/api/todos/1/done','POST',{})).status,200,'contact can complete own department work');
    assert.equal(todos[0].status,'done'); assert.equal(events[1].actor.actor_user_id,83);
    for(const url of ['/api/process-governance/quality-cases/1/comment','/api/process-governance/mapping-todos/1/comment']) {
      const before=comments.length;
      assert.equal((await request(admin,url,'POST',{note:'must not write'})).status,403,'admin governance comments are writes');
      users[2].departmentId=92;users[2].current_department_id=92;
      assert.equal((await request(contact,url,'POST',{note:'must not write'})).status,403);
      assert.equal(comments.length,before);
      users[2].departmentId=91;users[2].current_department_id=91;
      assert.equal((await request(contact,url,'POST',{note:'synthetic department evidence'})).status,200);
      assert.equal(comments.at(-1).actor_user_id,83);
      assert.equal((await request(lead,url,'POST',{note:'synthetic working group note'})).status,200);
    }
    for (const basePath of ['/org-units','/positions','/persons','/product-families','/products','/class-nodes','/attributes','/systems','/external','/integration']) {
      for (const method of ['POST','PUT','PATCH','DELETE']) {
        const result=await request(admin,'/api'+basePath,method,{});
        assert.equal(result.status,410,basePath); assert.equal(result.body.code,'LEGACY_SQLITE_ROUTE_ISOLATED');
      }
    }
    for (const [url,method,code] of [['/api/org/users','POST','LEGACY_IDENTITY_API_RETIRED'],['/api/import-rbac/full','POST','LEGACY_IDENTITY_API_RETIRED'],['/api/rbac/model','PUT','CORE_GOVERNANCE_MODEL_READ_ONLY'],['/api/roles','POST','CORE_GOVERNANCE_MODEL_READ_ONLY']]) {
      const r=await request(admin,url,method,{}); assert.ok([405,410].includes(r.status)); assert.equal(r.body.code,code);
    }
    users[2].must_change_password=1;
    assert.equal((await request(contact,'/api/org/departments')).body.code,'PASSWORD_CHANGE_REQUIRED');
    assert.equal((await request(contact,'/api/csrf-token')).status,200);
    users[2].must_change_password=0;
    users[2].authVersion++;
    assert.equal((await request(contact,'/api/org/me')).status,401,'revoked old authorization invalidates session');
    await login('department_contact',contact); users[2].accountStatus='disabled';
    assert.equal((await request(contact,'/api/org/me')).status,401,'disabled account invalidates session');
    const beforeLogout=lead.cookie;
    assert.equal((await request(lead,'/api/org/logout','POST',{})).status,200);
    assert.equal((await request({cookie:beforeLogout},'/api/org/me')).status,401);
    let limited;
    for(let i=0;i<9;i++) limited=await request({},'/api/org/login','POST',{loginName:'missing',password:'incorrect'});
    assert.equal(limited.status,429);
    console.log('Formal security HTTP checks passed: real session/CSRF, synthetic fixed-role repositories; no MySQL/SQLite');
  } finally {
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)); await app.locals.closeRuntime();
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
