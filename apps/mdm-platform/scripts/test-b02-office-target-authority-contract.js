// Pure public-operation contracts. Input: synthetic sessions and explicit SQL
// doubles. Output: node:test results. Run via the dispatch's reviewed, sanitized
// runner with blockRealMysql; no sockets, worker, persistence or default DB.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const {sessionSubject,identityInteger}=require('../server/sessionSubject');
const P='9007199254741001',A='9007199254741301',D='9007199254740993',O='9007199254741101',T='9007199254741801';
function fixture({admin=false,canRoute=true,inactive=false}={}) {
  const trace=[],connection={};
  for(const method of ['beginTransaction','commit','rollback','release'])connection[method]=async()=>trace.push({method});
  connection.execute=connection.query=async(sql,params=[])=>{
    trace.push({sql,params});
    if(sql.includes('information_schema.tables'))return [[{TABLE_NAME:'data_map_analysis_issue_tasks'}]];
    if(sql.startsWith('SELECT issue_id FROM data_map_analysis_issue_tasks'))return [[]];
    if(sql.startsWith('SELECT t.*'))return [[{id:T,to_dept_id:D,office_id:O,assignee_person_id:P,status:'pending',revision_no:2}]];
    if(sql.includes("WHERE o.org_type='office'"))return [[{id:O,department_id:D,manager_person_id:P,status:'active'}]];
    if(sql.startsWith('SELECT id FROM departments'))return [inactive?[]:[{id:D}]];
    if(sql.includes('FROM office_membership'))return [[{person_id:P}]];
    if(sql.startsWith('SELECT CAST(id AS CHAR)'))return [[{id:T,to_dept_id:D,status:'pending'}]];
    if(sql.startsWith('SELECT todo_id FROM mdm_todo_office_assignments'))return [[]];
    if(sql.includes('LAST_INSERT_ID'))return [[{id:T}]];
    return [{affectedRows:1,insertId:0}];
  };
  const filename=path.resolve(__dirname,'../server/officeRepository.js'),loaded=new Module(filename,module);loaded.filename=filename;loaded.paths=Module._nodeModulePaths(path.dirname(filename));
  const requireOriginal=loaded.require.bind(loaded);
  loaded.require=name=>name==='./identityMysqlRepository'?{readPersonAuthority:async(db,session,personId,options)=>{
    assert.equal(db,connection);assert.deepEqual(options,{currentRead:true});assert.equal(personId,identityInteger(session.personId));trace.push({method:'currentAuthority'});
    return {valid:true,permissions:new Set(canRoute?['governance:assign-work']:[]),readOnly:admin};
  }}:requireOriginal(name);
  loaded._compile(fs.readFileSync(filename,'utf8'),filename);
  return {repository:loaded.exports.makeOfficeRepository({getConnection:async()=>connection}),trace,session:{personId:P,accountId:A,authVersion:'9007199254741401'},connection};
}
const actions={create:(f)=>f.repository.createTask(f.session,{office_id:O,request_id:'00000000-0000-4000-8000-000000000001',content:'retain content'}),
  route:f=>f.repository.routeExistingTask(f.session,T,{office_id:O}),assign:f=>f.repository.assignPerson(f.session,T,{assignee_person_id:P,expected_revision:2}),
  complete:f=>f.repository.completeTask(f.session,T,{note:'retain note',expected_revision:2})};
for(const [name,action]of Object.entries(actions))test(name+' uses original transaction, exact IDs and current department qualification',async()=>{
  const f=fixture();await action(f);
  const statements=f.trace.filter(e=>e.sql),locks=statements.filter(e=>/FOR UPDATE$/.test(e.sql));
  assert(locks[0].sql.includes('user_accounts'));assert(locks[1].sql.includes('FROM person WHERE'));assert(locks[2].sql.includes('person_roles'));
  const dept=statements.find(e=>e.sql.startsWith('SELECT id FROM departments'));assert.match(dept.sql,/FOR SHARE$/);assert.deepEqual(dept.params,[D]);
  assert(statements.find(e=>e.sql.includes("WHERE o.org_type='office'")).sql.endsWith('FOR UPDATE'));
  if(['assign','complete'].includes(name)){assert(statements[0].sql.includes('information_schema'));assert(statements[1].sql.includes('data_map_analysis_issue_tasks'));assert(statements.some(e=>e.sql.includes('FROM office_membership')&&e.sql.endsWith('FOR UPDATE')));}
  assert.deepEqual(f.trace.filter(e=>e.method).map(e=>e.method),['beginTransaction','currentAuthority','commit','release']);
  for(const entry of statements)for(const value of entry.params.filter(v=>[P,A,D,O,T].includes(v)))assert.equal(typeof value,'string');
});
test('existing inactive department rejection rolls back and releases all public mutations',async()=>{
  for(const action of Object.values(actions)){const f=fixture({inactive:true});await assert.rejects(action(f),{code:'PUBLICATION_INPUT_INVALID',statusCode:422,message:'办公室所属部门未启用'});assert.deepEqual(f.trace.filter(e=>e.method).map(e=>e.method),['beginTransaction','currentAuthority','rollback','release']);}
});
test('admin overlay and no-route permission retain original write denials',async()=>{
  for(const action of Object.values(actions)){const f=fixture({admin:true,canRoute:false});await assert.rejects(action(f),{code:'OFFICE_ACCESS_DENIED',statusCode:403});assert(!f.trace.some(e=>e.sql&&/^(INSERT|UPDATE)/.test(e.sql)));}
  const f=fixture({canRoute:false});await assert.rejects(actions.create(f),{code:'OFFICE_ACCESS_DENIED'});
});
test('typed system admin/null and adjacent identifiers keep person/account/version meaning',async()=>{
  const system=sessionSubject({identityKind:'system_admin',accountId:A,authVersion:1,personId:P});assert.equal(system.personId,null);assert.equal(system.principal,'system-admin:'+A);
  for(const session of [{identityKind:'system_admin',accountId:A,authVersion:1},{personId:null,accountId:A,authVersion:1},{personId:Number(P),accountId:A,authVersion:1}]){const f=fixture();f.session=session;await assert.rejects(actions.create(f),{code:'OFFICE_ACCESS_DENIED',message:'当前登录状态已变化或需要修改密码，请重新登录处理。'});}
  assert.equal(sessionSubject({personId:P,accountId:A,authVersion:'9007199254741401'}).personId,P);assert.equal(identityInteger('81'),81);assert.equal(identityInteger(P),P);assert.notEqual(identityInteger(P),identityInteger('9007199254741000'));
});
