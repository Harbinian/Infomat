// P25: owned UUID tmpfs MySQL / synthetic XLSX and identities / random loopback HTTP.
// --reproduce captures the pre-fix defects. --output must be a NEW artifacts directory.
// No private env, existing services, real DB, notification or production migration.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const {withStage05Fixture} = require('./test-stage05-mysql-isolated');
const output = path.resolve(process.argv[process.argv.indexOf('--output')+1] || '');
assert.ok(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));
assert.ok(!fs.existsSync(output)); fs.mkdirSync(output,{recursive:true});
const reproduce = process.argv.includes('--reproduce');
async function workbook(rows, headers=['数据对象','字段说明','中文字段名','英文字段名','字段类型','消费系统','同步方式']) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet('字段台账');
  sheet.addRow(headers); rows.forEach(r=>sheet.addRow(r)); return Buffer.from(await book.xlsx.writeBuffer());
}
async function main() {
 await withStage05Fixture(async ({fixture,pool,expect,request,backup,restore})=>{
  const checks=[], observations={};
  const save=()=>fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({reproduce,checks,observations},null,2));
  const clients={};
  async function upload(who,contextId,buffer,requestId) {
   if(!clients[who]) {
    const r=await fetch(fixture.baseURL+'/api/org/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({loginName:'SYNTHETIC_'+who,password:fixture.loginPassword})});
    assert.equal(r.status,200); const cookie=r.headers.get('set-cookie').split(';')[0];
    const csrf=(await (await fetch(fixture.baseURL+'/api/csrf-token',{headers:{Cookie:cookie}})).json()).csrfToken;
    clients[who]={cookie,csrf};
   }
   const c=clients[who], body=new FormData();body.append('context_id',String(contextId));body.append('file',new Blob([buffer]),'synthetic.xlsx');
   if(requestId!==undefined) body.append('request_id',requestId);
   const r=await fetch(fixture.baseURL+'/api/import/field-entries',{method:'POST',headers:{Cookie:c.cookie,'X-CSRF-Token':c.csrf},body});return {status:r.status,body:await r.json()};
  }
  const context=await expect('contact','/api/data-map/contexts','POST',{title:'合成原子导入',dept_id:91},201);
  const counts=async()=>{const [[r]]=await pool.query('SELECT (SELECT COUNT(*) FROM data_map_fields WHERE context_id=?) fields,(SELECT COUNT(*) FROM data_map_import_batches WHERE context_id=?) batches',[context.id,context.id]);return r;};
  await pool.execute("INSERT INTO data_map_naming_rules(rule_type,match_value,severity,status) VALUES('contains','BLOCK_SYNTHETIC','block','active')");
  const bad=await workbook([['SYNTHETIC_OBJECT','valid','VALID_SYNTHETIC','row_valid'],['SYNTHETIC_OBJECT','invalid','BLOCK_SYNTHETIC','row_blocked']]);
  observations.nthRow={response:await upload('contact',context.id,bad),counts:await counts()};
  save();
  assert.equal(observations.nthRow.response.status,400);
  if(!reproduce) {assert.deepEqual(observations.nthRow.counts,{fields:0,batches:0});checks.push('Nth-row validation rolls back fields, objects, links and issues');}
  await pool.query("CREATE TRIGGER synthetic_batch_failure BEFORE INSERT ON data_map_import_batches FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic batch failure'");
  observations.batchLog={response:await upload('contact',context.id,await workbook([['SYNTHETIC_LOG','note','LOG_SYNTHETIC','row_log']])),counts:await counts()};
  await pool.query('DROP TRIGGER synthetic_batch_failure');
  if(!reproduce) {assert.equal(observations.batchLog.response.status,400);assert.deepEqual(observations.batchLog.counts,{fields:0,batches:0});checks.push('batch log failure rolls back whole import');}
  await require('../server/terminologyMysqlRepository').seedDefaultTerminologyTermTypes(pool);
  await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(1,'synthetic.json','synthetic','{}')");
  await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,dept_name,l3_name,status) VALUES(501,'synthetic_a','l3',1,1,'合成甲部','合成流程','active'),(502,'synthetic_b','l3',1,1,'合成乙部','合成乙流程','active')");
  const term=await expect('contact','/api/terminology','POST',{term:'SYNTHETIC_TERM',term_type_code:'noun',definition:'initial',process_id:501});
  const before=(await expect('contact','/api/terminology','GET')).find(t=>t.id===term.id);
  await expect('contact','/api/terminology/'+term.id,'PUT',{...before,definition:'winner',expected_token:before.write_token});
  observations.staleTerm=await request('contact','/api/terminology/'+term.id,'PUT',{...before,definition:'stale loser',expected_token:before.write_token});
  if(!reproduce) {assert.equal(observations.staleTerm.status,409);checks.push('stale term content rejected in transaction');}
  await pool.execute("INSERT INTO mdm_term_conflicts(id,term,dept_a,dept_b,severity,status) VALUES(601,'SYNTHETIC_TERM',91,92,'error','pending')");
  await pool.execute("DELETE FROM person_roles WHERE person_id=85");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 85,role_id,'global','synthetic',CURRENT_DATE FROM roles WHERE role_code='data_conflict_handler'");
  await pool.query("CREATE TRIGGER synthetic_todo_failure BEFORE INSERT ON mdm_todo_events FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='synthetic event failure'");
  observations.assignmentFailure=await request('lead','/api/conflicts/601/assign?type=term','POST',{assignee_user_id:85});
  await pool.query('DROP TRIGGER synthetic_todo_failure');
  observations.assignmentAfter=await expect('lead','/api/conflicts/601?type=term','GET');
  if(!reproduce) {assert.equal(observations.assignmentAfter.status,'pending');assert.equal(observations.assignmentAfter.assignmentHistory.length,0);checks.push('assignment + todo + event rolls back on event failure');}
  save();
  if(reproduce) {
   assert.ok(observations.nthRow.counts.fields>0 && observations.nthRow.counts.batches===0);
   assert.equal(observations.staleTerm.status,200);assert.equal(observations.assignmentAfter.status,'coordinating');
   console.log('LEGACY_DEFECTS_REPRODUCED');return;
  }
  await require('./testHelpers/legacyConcurrencyVerification')({fixture,pool,expect,request,upload,workbook,context,term,checks,observations,output,backup,restore});
  save();console.log('LEGACY_IMPORT_CONCURRENCY_PASS '+checks.length);
 },{randomDatabase:true,evidenceDir:output,createDocument:()=>JSON.parse(fs.readFileSync(path.join(__dirname,'testHelpers/p25-empty-v7.json'),'utf8'))});
}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:error.message,stack:error.stack},null,2));console.error(error);process.exitCode=1;});
