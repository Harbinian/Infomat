// Synthetic display contracts through makeOfficeRepository.workbench and the
// existing pure overlay. Run with the dispatch's reviewed sanitized runner and
// blockRealMysql. No IO authority grants, services, writes or private config.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('../server/sessionSubject');
const { digest, json } = require('../server/dataMapDefinitionValues');
const { decorate } = require('../server/officeAnalysisTasks');
const reply = require('../server/authoringReplyEvent');
const P = '9007199254740992', N = '9007199254740993', O = '9007199254741101', T = '9007199254741801', I = '9007199254741901';
const denied = { code:'OFFICE_ACCESS_DENIED', statusCode:403 };
const conflict = { code:'DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT', statusCode:409, message:'DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT' };
function fixture(options = {}) {
  const trace = [], actor = options.actor || {personId:P, accountId:'9007199254741301', authVersion:'9007199254741401'};
  const office = {id:O, department_id:'91', manager_person_id:options.manager ?? P, status:'active'};
  const tasks = options.tasks || [{id:T, office_id:O, assignee_person_id:options.assignee ?? N, revision_no:7, content:'minimal task'}];
  const snapshot = {issue_id:I, office_id:O, purpose:'verify', round_no:1, issue_revision:7, issue_digest:'a'.repeat(64), instruction:'minimal instruction', sources:[{version_id:'9007199254743001'}]};
  const link = {todo_id:T, issue_id:I, purpose:'verify', round_no:1, snapshot_json:json(snapshot), snapshot_digest:digest(snapshot)};
  const note = {source_type:reply.SOURCE_TYPE, record_id:'9007199254742001', issue_id:I, todo_id:T, actor_person_id:N, content:'original reply', unknown:{retained:null}};
  const event = {id:'9007199254742101', note:JSON.stringify(note), actor_person_id:N, content_text:note.content, actor_name:'synthetic compiler', created_epoch:1700000000};
  const db = {execute:async(sql, params = []) => {
    trace.push({sql, params}); assert.match(sql, /^SELECT\b/); assert.doesNotMatch(sql, /FOR (UPDATE|SHARE)|GET_LOCK/);
    if (sql.includes('information_schema.tables')) return [sql.includes("'data_map_analysis_issue_tasks'") ? options.noTable ? [] : [{TABLE_NAME:'data_map_analysis_issue_tasks'}] : options.noAuthoring ? [] : [{TABLE_NAME:'process_v7_authoring_records'}]];
    if (sql.includes("WHERE o.org_type='office'")) return [options.outside ? [] : [office]];
    if (sql.includes('FROM office_membership m JOIN person p')) return [[]];
    if (sql.includes('FROM mdm_todo_office_assignments a JOIN mdm_todos')) return [tasks];
    if (sql.includes('FROM data_map_analysis_issue_tasks WHERE')) return [options.noLink ? [] : [link]];
    if (sql.includes('FROM mdm_todo_events e JOIN process_v7_authoring_records')) return [[event]];
    throw new Error('UNREVIEWED_SQL '+sql);
  }};
  db.query = db.execute;
  const filename = path.resolve(__dirname, '../server/officeRepository.js'), loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const original = loaded.require.bind(loaded);
  loaded.require = name => name === './identityMysqlRepository' ? {readPersonAuthority:async(connection, session, personId, flags) => {
    assert.equal(connection, db); assert.deepEqual(flags, {currentRead:false});
    const subject = sessionSubject(session); assert.equal(personId, identityInteger(subject.personId));
    trace.push({authority:{...subject}, flags});
    return {valid:options.valid !== false, readOnly:!!options.admin, permissions:new Set(options.global ? ['governance:read-global'] : options.identityRead ? ['identity:read'] : [])};
  }} : original(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return {db, trace, actor, tasks, link, snapshot, note, event, repository:loaded.exports.makeOfficeRepository(db)};
}
const replied = f => f.trace.filter(row => row.sql?.includes('FROM mdm_todo_events e JOIN'));
test('absent optional table, empty tasks and absent links retain original task results', async() => {
  for (const options of [{noTable:true}, {tasks:[]}, {noLink:true}]) {
    const f=fixture(options), before=JSON.stringify(f.tasks), value=await f.repository.workbench(f.actor,O);
    assert.deepEqual(value.tasks,f.tasks.map(t=>({...t,behavior_name:''})));
    assert.equal(JSON.stringify(f.tasks),before); assert.equal(replied(f).length,0);
  }
  const f=fixture({noTable:true});assert.equal(await decorate(f.db,{personId:P},f.tasks,P),f.tasks);
});
test('manager, assignee and original global/identity readers retain access; other members do not read replies', async() => {
  for (const [options, allowed] of [[{},true],[{manager:N,assignee:P},true],[{manager:N,assignee:N,global:true},true],[{manager:N,assignee:N,identityRead:true},true],[{manager:N,assignee:N},false]]) {
    const f=fixture(options), value=await f.repository.workbench(f.actor,O);
    assert.equal(value.tasks.length,allowed?1:0); assert.equal(replied(f).length,allowed?1:0);
    if (allowed) assert.equal(value.tasks[0].analysis_task.compiler_replies[0].id,f.event.id);
  }
});
test('sameIdentityInteger handles small decimal aliases, adjacent BIGINT, null and unsafe values without recovery', async() => {
  for (const [person, manager, assignee, expected] of [[7,'0007',8,true],['0007',8,7,true],[P,N,N,false],[N,P,P,false],[P,P,N,true],[P,null,null,false],[P,Number(P),Number(P),false],[Number(P),P,P,false]]) {
    const f=fixture(), actor={personId:person,canReadAll:false};
    const task={...f.tasks[0],assignee_person_id:assignee};
    const result=await decorate(f.db,actor,[task],manager);
    assert.equal(result.length,expected?1:0);
  }
  assert.equal(sameIdentityInteger(null,null),false);
});
test('typed session failures retain original denial before any material query', async() => {
  for (const patch of [{identityKind:'system_admin',userId:'system-admin:9',personId:null},{personId:null,userId:null},{personId:Number(P)},{accountId:Number(P)},{authVersion:Number(P)},{accountId:null},{authVersion:null}]) {
    const f=fixture(); await assert.rejects(f.repository.workbench({...f.actor,...patch},O),denied); assert.equal(f.trace.length,0);
  }
  const f=fixture({valid:false}); await assert.rejects(f.repository.workbench(f.actor,O),denied); assert.equal(f.trace.filter(t=>t.sql).length,0);
});
test('outside-office denial and admin display flags retain their original meaning', async() => {
  const f=fixture({outside:true});await assert.rejects(f.repository.workbench(f.actor,O),{...denied,message:'无权查看该办公室'});
  const admin=fixture({admin:true,global:true}), value=await admin.repository.workbench(admin.actor,O);
  assert.equal(value.can_assign,false);assert.equal(value.can_complete,false);assert.equal(value.can_route,false);
});
test('link digest, issue, purpose, round and office integrity failures retain original 409', async() => {
  for (const field of ['issue_id','purpose','round_no','office_id']) {
    const f=fixture(); const changed={...f.snapshot,[field]:field==='round_no'?2:'mismatch'};
    f.link.snapshot_json=json(changed);f.link.snapshot_digest=digest(changed);
    await assert.rejects(f.repository.workbench(f.actor,O),conflict);
  }
  const f=fixture(); f.link.snapshot_digest='b'.repeat(64);await assert.rejects(f.repository.workbench(f.actor,O),conflict);
});
test('reply source, issue, todo, actor and content failures preserve original 409 and strict JSON typing', async() => {
  for (const field of ['source_type','issue_id','todo_id','actor_person_id','content']) {
    const f=fixture();f.event.note=JSON.stringify({...f.note,[field]:'mismatch'});
    await assert.rejects(f.repository.workbench(f.actor,O),conflict);
  }
  const f=fixture();f.event.note={...f.note,actor_person_id:Number(N)};
  await assert.rejects(f.repository.workbench(f.actor,O),conflict);
  assert.throws(()=>reply.officeReply({...f.event,note:{...f.note,todo_id:7}},{issueId:I,todoId:7}),conflict);
});
test('invalid JSON preserves parsing failure; unauthorized members skip corrupt analysis content', async() => {
  for (const target of ['link','event']) {
    const f=fixture();if(target==='link')f.link.snapshot_json='{';else f.event.note='{';
    await assert.rejects(f.repository.workbench(f.actor,O),SyntaxError);
  }
  const f=fixture({manager:N,assignee:N});f.link.snapshot_json='{';
  assert.deepEqual((await f.repository.workbench(f.actor,O)).tasks,[]);assert.equal(replied(f).length,0);
});
test('missing authoring table returns empty replies and preserves legacy/unknown fields byte for byte', async() => {
  const f=fixture({noAuthoring:true}), before=JSON.stringify({tasks:f.tasks,link:f.link,event:f.event});
  const value=await f.repository.workbench(f.actor,O);
  assert.deepEqual(value.tasks[0].analysis_task.compiler_replies,[]);
  assert.equal(JSON.stringify({tasks:f.tasks,link:f.link,event:f.event}),before);
  const payload=reply.issuePayload({recordId:'7',caseId:'8',requestKey:'original',reference:{issue_id:'9',todo_id:'10',unknown:null},revisionNo:7,contentHash:'old',actorPersonId:P,fixedSources:[{version_id:N}]});
  assert.equal(payload.actor_person_id,P); assert.deepEqual(reply.officeNote(payload,'original'),{...payload,content:'original'});
});
test('display has no writes, transaction acquisition, locks or input/snapshot normalization', async() => {
  const f=fixture(), before=JSON.stringify({tasks:f.tasks,link:f.link,event:f.event});await f.repository.workbench(f.actor,O);
  assert(f.trace.some(e=>e.authority));assert(f.trace.filter(e=>e.sql).every(e=>/^SELECT\b/.test(e.sql)));
  assert.equal(JSON.stringify({tasks:f.tasks,link:f.link,event:f.event}),before);
  const actorQuery=f.trace.find(e=>e.sql?.includes("WHERE o.org_type='office'"));assert.deepEqual(actorQuery.params,[P,P]);
});
test('link and reply lookup use the existing decimal identity binding for small and BIGINT todo IDs',async()=>{
  for(const id of [7,T]){
    const f=fixture();f.tasks[0].id=id;f.link.todo_id=String(id);f.event.note=JSON.stringify({...f.note,todo_id:String(id)});
    await f.repository.workbench(f.actor,O);
    const link=f.trace.find(e=>e.sql?.includes('FROM data_map_analysis_issue_tasks WHERE'));
    assert.deepEqual(link.params,[String(id)]);assert.deepEqual(replied(f)[0].params,[String(id)]);
    assert.match(link.sql,/todo_id IN \(CAST\(\? AS SIGNED\)\)/);assert.match(replied(f)[0].sql,/e.todo_id=CAST\(\? AS SIGNED\)/);
  }
});
