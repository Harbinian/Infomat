// Runs only inside the caller's owned UUID/tmpfs fixture. No private config.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {MIGRATION_KEY}=require('../../server/todoTermSourceMigration');
module.exports=async function verify({pool,fixture,expect,request,body,checks,output}) {
  const observations=[];
  const ready=async()=>{await new Promise(r=>setTimeout(r,3200));const r=await fetch(fixture.baseURL+'/api/ready');return {status:r.status,body:await r.json()};};
  await pool.execute('DELETE FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]);
  try {
    const r=await fetch(fixture.baseURL+'/api/ready'); observations.push({case:'missing migration marker',readiness:r.status});
    // expect records actual HTTP failure; restore the marker even on red runs.
    await expect('lead','/api/todos','POST',body(),503);
    assert.equal(r.status,503);
  } finally {
    await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[MIGRATION_KEY]);
    fs.writeFileSync(path.join(output,'preflight-observations.json'),JSON.stringify(observations,null,2));
  }
  assert.equal((await ready()).status,200);
  for(const table of ['terminology_terms','terminology_term_types','process_mapping_records','mdm_todo_events','mdm_version_log']) {
    await pool.query(`RENAME TABLE ${table} TO synthetic_hidden_${table}`);
    try {
      const r=await ready();observations.push({case:'missing '+table,readiness:r.status});
      const terms=table.startsWith('terminology')||table==='process_mapping_records';
      await expect('lead',terms?'/api/terminology':'/api/todos',terms?'GET':'POST',terms?undefined:body(),503);
      assert.equal(r.status,503,table+' readiness');
    } finally {await pool.query(`RENAME TABLE synthetic_hidden_${table} TO ${table}`);fs.writeFileSync(path.join(output,'preflight-observations.json'),JSON.stringify(observations,null,2));}
  }
  checks.push('missing marker and five physical dependencies accurately unavailable; no request/startup DDL');
  for(const [table,column] of [['terminology_terms','definition'],['mdm_version_log','metadata_json']]) {
    await pool.query(`ALTER TABLE ${table} RENAME COLUMN ${column} TO synthetic_hidden_column`);
    try {assert.equal((await ready()).status,503);await expect('lead','/api/todos','POST',body(),503);}
    finally {await pool.query(`ALTER TABLE ${table} RENAME COLUMN synthetic_hidden_column TO ${column}`);}
  }
  checks.push('missing physical source/log columns give 503 and recover without automatic repair');
  const counts=async()=>{const [[r]]=await pool.query('SELECT (SELECT COUNT(*) FROM mdm_todos) todos,(SELECT COUNT(*) FROM mdm_todo_events) events,(SELECT COUNT(*) FROM mdm_version_log) logs');return r;};
  for(const table of ['mdm_todo_events','mdm_version_log']) {
    const before=await counts();const p=body();
    await pool.query(`CREATE TRIGGER synthetic_term_failure BEFORE INSERT ON ${table} FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic transaction failure'`);
    try {await expect('lead','/api/todos','POST',p,400);assert.deepEqual(await counts(),before);}
    finally {await pool.query('DROP TRIGGER synthetic_term_failure');}
    await expect('lead','/api/todos','POST',p);
  }
  checks.push('event/log failure rolls back todo event and request record; original request remains usable after failed transaction');
  const payload=body({content:'  规范化同请求  '});const first=await expect('lead','/api/todos','POST',payload);
  assert.equal((await expect('lead','/api/todos','POST',{...payload,content:'规范化同请求'})).id,first.id);
  for(const change of [{content:'其他内容'},{to_dept_id:'92'},{related_term_id:'702'},{urgency:'high'}]) {
    const r=await expect('lead','/api/todos','POST',{...payload,...change},409);assert.equal(r.code,'TODO_TERM_REQUEST_CONFLICT');
  }
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 85,role_id,'global','synthetic second actor',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
  const [sameActor,another]=await Promise.all([expect('lead','/api/todos','POST',payload),expect('reviewB','/api/todos','POST',payload)]);assert.equal(sameActor.id,first.id);assert.notEqual(another.id,first.id);
  assert.equal((await expect('reviewB','/api/todos','POST',payload)).id,another.id);
  await pool.execute("DELETE FROM person_roles WHERE person_id=85 AND role_id IN(SELECT role_id FROM roles WHERE role_code='mdm_lead')");
  checks.push('trim normalization same receipt, same key changed content/department/source/urgency conflict, per-actor key isolation');
  const blocker=await pool.getConnection();const busyBody=body();
  const name='todo-term:'+crypto.createHash('sha256').update(`82:${busyBody.request_id}`).digest('hex').slice(0,48);
  try {await blocker.execute('SELECT GET_LOCK(?,1)',[name]);assert.equal((await expect('lead','/api/todos','POST',busyBody,409)).code,'TODO_TERM_BUSY');}
  finally {await blocker.execute('SELECT RELEASE_LOCK(?)',[name]);blocker.release();}
  const id=(await expect('lead','/api/todos','POST',busyBody)).id;
  await pool.execute("UPDATE terminology_terms SET definition='合成已更新的当前定义' WHERE id=701");
  assert.equal((await expect('lead','/api/todos','POST',busyBody)).id,id);
  await pool.execute("UPDATE terminology_terms SET definition='明确术语来源' WHERE id=701");
  await pool.execute("UPDATE departments SET status='inactive' WHERE id=91");
  try {await expect('lead','/api/todos','POST',busyBody,400);}finally {await pool.execute("UPDATE departments SET status='active' WHERE id=91");}
  await pool.execute('UPDATE person SET current_department_id=92 WHERE person_id=82');
  try {assert.equal((await expect('lead','/api/todos','POST',busyBody,409)).code,'TODO_TERM_REQUEST_CONFLICT');}
  finally {await pool.execute('UPDATE person SET current_department_id=91 WHERE person_id=82');}
  await pool.execute("DELETE FROM person_roles WHERE person_id=82 AND role_id IN(SELECT role_id FROM roles WHERE role_code='mdm_lead')");
  try {await expect('lead','/api/todos','POST',busyBody,403);}finally {await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 82,role_id,'global','synthetic restore',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");}
  checks.push('busy request no write, changed current term keeps receipt without frozen text, receiver validity/current department/current permission rechecked');
  const deletion=body();const deletable=await expect('lead','/api/todos','POST',deletion);
  const before=await counts();await pool.query("CREATE TRIGGER synthetic_delete_failure BEFORE INSERT ON mdm_version_log FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic deletion audit failure'");
  try {await expect('lead',`/api/todos/${deletable.id}`,'DELETE',undefined,400);assert.deepEqual(await counts(),before);}
  finally {await pool.query('DROP TRIGGER synthetic_delete_failure');}
  await expect('lead',`/api/todos/${deletable.id}`,'DELETE');
  assert.equal((await expect('lead','/api/todos','POST',deletion,409)).code,'TODO_TERM_REQUEST_DELETED');
  const [history]=await pool.query("SELECT operation,metadata_json FROM mdm_version_log WHERE entity_type='todo' AND entity_id=? ORDER BY id",[deletable.id]);
  assert.deepEqual(history.map(r=>r.operation),['create','delete']);
  const saved=JSON.parse(history[1].metadata_json);assert.equal(String(saved.todo.related_term_id),'701');assert.ok(saved.events.some(e=>e.event_type==='created'));
  fs.writeFileSync(path.join(output,'synthetic-deletion-history.json'),JSON.stringify(history,null,2));
  checks.push('deletion audit failure rolls back, successful deletion keeps original request and prior events in version log; replay never rebuilds');
  const [[next]]=await pool.query("SELECT AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='mdm_todos'");
  const safeBefore=await counts();await pool.query('ALTER TABLE mdm_todos AUTO_INCREMENT=9007199254740993');
  try {const r=await expect('lead','/api/todos','POST',body(),409);assert.equal(r.code,'TODO_TERM_INVALID');assert.deepEqual(await counts(),safeBefore);}
  finally {await pool.query(`ALTER TABLE mdm_todos AUTO_INCREMENT=${next.AUTO_INCREMENT}`);}
  checks.push('out-of-safe-range generated numeric todo ID accurately rejected and entire transaction rolled back');
  await pool.query("UPDATE mdm_version_log SET entity_id=9007199254740993 WHERE entity_type='todo' AND field_name=? AND operated_by_person_id=82",['term_request:'+payload.request_id]);
  try {assert.equal((await expect('lead','/api/todos','POST',payload,409)).code,'TODO_TERM_INVALID');}
  finally {await pool.query("UPDATE mdm_version_log SET entity_id=? WHERE entity_type='todo' AND field_name=? AND operated_by_person_id=82",[first.id,'term_request:'+payload.request_id]);}
  checks.push('old out-of-range request reference rejected precisely without rounding or rewriting history');
  const racing=body();const racingLock='todo-term:'+crypto.createHash('sha256').update(`82:${racing.request_id}`).digest('hex').slice(0,48);
  const db=await pool.getConnection();const raceBefore=await counts();let pending;
  try {
    await db.execute('SELECT GET_LOCK(?,1)',[racingLock]);
    pending=request('lead','/api/todos','POST',racing);
    let waiting=false;
    for(let i=0;i<100;i++){const [[r]]=await pool.query("SELECT COUNT(*) n FROM information_schema.PROCESSLIST WHERE USER='stage05_runtime' AND STATE='User lock'");if(Number(r.n)){waiting=true;break;}await new Promise(r=>setTimeout(r,20));}
    assert.ok(waiting,'request actually waiting on owned request lock');
    await pool.execute("DELETE FROM person_roles WHERE person_id=82 AND role_id IN(SELECT role_id FROM roles WHERE role_code='mdm_lead')");
    await db.execute('SELECT RELEASE_LOCK(?)',[racingLock]);
    const result=await pending;fs.writeFileSync(path.join(output,'current-permission-race.json'),JSON.stringify({status:result.status,code:result.body.code,actuallyWaited:true},null,2));
    assert.equal(result.status,403,'current permission rechecked after waiting for request lock');assert.deepEqual(await counts(),raceBefore);
  } finally {
    await db.execute('SELECT RELEASE_LOCK(?)',[racingLock]);db.release();if(pending)await pending.catch(()=>{});
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 82,role_id,'global','synthetic restore',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
  }
  checks.push('permission revoked while awaiting same-key lock is rejected before transaction and creates no todo/event/log');
};
