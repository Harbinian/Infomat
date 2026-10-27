// Synthetic cases on a fresh caller-owned tmpfs MySQL. Reader credentials are
// passed through stdin only; no existing service, private env or database is used.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const mode=process.argv.includes('--reader')?'reader':process.argv.includes('--expect-offset')?'baseline':'fixed';
const gov=require('../server/processCaseGovernance'),controls=require('../server/processFormalControls');
function timeProjection(value){return {changes:value.changes.map(row=>({change_id:row.change_id,created_at:row.created_at,registered_at:row.registered_at,
  confirmations:row.confirmations.map(item=>({confirmation_id:item.confirmation_id,created_at:item.created_at}))}))};}
function payloadProjection(value){return {...value,changes:value.changes.map(row=>{const {created_at,registered_at,...rest}=row;return {...rest,confirmations:row.confirmations.map(item=>{const {created_at,...rest}=item;return rest;})};})};}
async function reader(){const mysql=require('mysql2/promise'),input=JSON.parse(fs.readFileSync(0,'utf8')),db=await mysql.createConnection({host:'127.0.0.1',port:input.port,user:'root',password:input.password,database:input.database});
  try{
    await db.execute('SET time_zone=?',[input.mysqlTimeZone]);
    const [[clock]]=await db.execute('SELECT @@session.time_zone mysql_time_zone');
    const [[c]]=await db.execute('SELECT * FROM process_v7_preview_cases WHERE id=?',[input.caseId]);
    const current=await gov.read(db,c),formal=await controls.readControls(db,c),receipt=await gov.receipt(db,c,{personId:input.personId},input.receiptId);
    const [[raw]]=await db.execute('SELECT created_at,UNIX_TIMESTAMP(created_at) epoch FROM process_case_changes WHERE case_id=? ORDER BY record_no LIMIT 1',[input.caseId]);
    const result={nodeTimeZone:process.env.TZ,mysqlTimeZone:clock.mysql_time_zone,rawDriverTime:raw.created_at.toISOString(),expectedFirstTime:new Date(Number(raw.epoch)*1000).toISOString(),
      times:timeProjection(current),payload:payloadProjection(current),formal,receipt};
    process.stdout.write(JSON.stringify(result));
  }finally{await db.end();}
}
async function main(){
  process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.PROCESS_V7_FORMAL_ENABLED='0';process.env.PROCESS_V7_AUTHORING_ENABLED='0';process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_DB_QUIET='1';
  const output=path.resolve(process.argv[2]||''),artifactRoot=path.resolve(__dirname,'../../../artifacts')+path.sep;assert(output.startsWith(artifactRoot));assert(!fs.existsSync(output),'preserve prior evidence');fs.mkdirSync(output,{recursive:true});
  const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n'),checks=[];let owned,passed=false,failure;
  async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks});}
  try{await require('./testHelpers/freshMysql').withFreshMysql(async target=>{
    const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port,storage:'new labelled tmpfs'};
    const fixture=require('./testHelpers/processCaseGovernanceFixture'),actors=await fixture.seed(pool),repo=require('../server/processPreviewReviewRepository').makeProcessPreviewReviewRepository(pool);
    const document=fixture.document(),departments=await repo.listDepartments(),preview=require('../server/processPreviewReview').validateAndProjectProcess(document,departments);
    assert.deepEqual(preview.errors,[]);const created=await repo.createCase(preview,{sourceFileName:'synthetic-time-only.json',submission:fixture.submission()},actors.contactA),caseId=String(created.case.id);
    await fixture.completeSidecar(repo,caseId,actors);
    const add=await fixture.act(repo,caseId,'formal_controls',actors.lead,{action:'add_suggestion',expected_event_id:'0',title:'Synthetic time projection suggestion',affected_scope:'Synthetic case',non_blocking_reason:'Synthetic current facts unchanged'});
    const suggestionId=add.result.suggestions[0].suggestion_id;
    const dispose=await fixture.act(repo,caseId,'formal_controls',actors.lead,{action:'dispose_suggestion',expected_event_id:add.result.event_id,suggestion_id:suggestionId,status:'planned',disposition:'Synthetic future revision'});
    const receiptId=dispose.request_id||dispose.result.request_id;
    const pending=await fixture.act(repo,caseId,'propose',actors.lead,{kind:'deadline',reason:'Synthetic second deadline proposal',due_date:'2026-12-30',department_ids:['91']});
    const incompleteDocument=fixture.document(),incompletePreview=require('../server/processPreviewReview').validateAndProjectProcess(incompleteDocument,departments);
    const incomplete=await repo.createCase(incompletePreview,{sourceFileName:'synthetic-incomplete-materials.json'},actors.contactA);
    const [[incompleteRow]]=await pool.execute('SELECT * FROM process_v7_preview_cases WHERE id=?',[incomplete.case.id]);
    const [[originalIncomplete]]=await pool.execute('SELECT submission_json FROM process_case_submissions WHERE case_id=? ORDER BY record_no DESC LIMIT 1',[incomplete.case.id]);
    // Deliberate synthetic old payload, including an unknown future machine key.
    // The read projection must explain it without altering its missing array.
    const incompleteValue=typeof originalIncomplete.submission_json==='string'?JSON.parse(originalIncomplete.submission_json):originalIncomplete.submission_json;
    incompleteValue.missing=['purpose','revision_reason','change_summary','sources','participants','revision_reason_and_change_summary','purpose_or_revision_reason','SYNTHETIC_UNKNOWN_REQUIRED_FIELD'];
    await pool.execute('UPDATE process_case_submissions SET submission_json=? WHERE case_id=?',[JSON.stringify(incompleteValue),incomplete.case.id]);
    const [receipts]=await pool.execute('SELECT request_id FROM process_case_requests WHERE case_id=? AND actor_person_id=? ORDER BY created_at,request_id',[caseId,actors.lead.personId]);
    const selectedReceipt=receiptId||receipts[0].request_id;
    const sql=async(statement,args=[])=>(await pool.execute(statement,args))[0];
    await pool.execute("SET time_zone='+00:00'");
    // Explicit synthetic historical instants: precise known values, not inferred
    // real business times. NULL registration marks the genuinely pending record.
    await sql("UPDATE process_case_submissions SET created_at='2026-09-17 01:02:03.123' WHERE case_id=?",[caseId]);
    await sql("UPDATE process_case_changes SET created_at='2026-09-17 02:03:04.234',registered_at=IF(state='registered','2026-09-17 03:04:05.456',NULL) WHERE case_id=?",[caseId]);
    await sql("UPDATE process_case_change_confirmations SET created_at='2026-09-17 04:05:06.789' WHERE change_id IN (SELECT change_id FROM process_case_changes WHERE case_id=?)",[caseId]);
    await sql("UPDATE process_v7_preview_events SET created_at='2026-09-17 05:06:07' WHERE case_id=? AND event_type='process_formal_control'",[caseId]);
    await check('actual case columns are TIMESTAMP(3), formal event columns are TIMESTAMP, and pending registration is NULL',async()=>{
      const columns=await sql("SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATETIME_PRECISION,IS_NULLABLE FROM information_schema.columns WHERE TABLE_SCHEMA=DATABASE() AND ((TABLE_NAME IN ('process_case_submissions','process_case_changes','process_case_change_confirmations') AND COLUMN_NAME IN ('created_at','registered_at')) OR (TABLE_NAME='process_v7_preview_events' AND COLUMN_NAME='created_at')) ORDER BY TABLE_NAME,COLUMN_NAME");
      assert.equal(columns.length,5);for(const row of columns){assert.equal(row.DATA_TYPE,'timestamp');assert.equal(Number(row.DATETIME_PRECISION),row.TABLE_NAME==='process_v7_preview_events'?0:3);}
      assert.equal((await sql('SELECT registered_at FROM process_case_changes WHERE change_id=?',[pending.result.change_id]))[0].registered_at,null);save('actual-time-schema.json',columns);
    });
    const tracked=['process_case_submissions','process_case_changes','process_case_change_confirmations','process_case_requests','process_v7_preview_events'];
    async function originalRows(){const result={};for(const table of tracked)result[table]=await sql('SELECT * FROM '+table+' ORDER BY '+(table==='process_case_change_confirmations'?'record_no':table==='process_case_requests'?'request_id':table==='process_v7_preview_events'?'id':'record_no'));return JSON.parse(JSON.stringify(result));}
    async function payloadBytes(){return {
      submissions:await sql('SELECT submission_id,HEX(CAST(submission_json AS CHAR)) original_bytes FROM process_case_submissions ORDER BY record_no'),
      changes:await sql('SELECT change_id,change_digest,HEX(CAST(change_json AS CHAR)) original_bytes FROM process_case_changes ORDER BY record_no'),
      confirmations:await sql('SELECT confirmation_id,HEX(CAST(evidence_json AS CHAR)) original_bytes FROM process_case_change_confirmations ORDER BY record_no'),
      requests:await sql('SELECT request_id,request_digest,HEX(CAST(response_json AS CHAR)) original_bytes FROM process_case_requests ORDER BY request_id'),
      events:await sql('SELECT id,HEX(CAST(payload_json AS CHAR)) original_bytes FROM process_v7_preview_events ORDER BY id')};}
    const before=await originalRows(),bytesBefore=await payloadBytes(),results=[];
    for(const TZ of ['UTC','Asia/Shanghai'])for(const mysqlTimeZone of ['+00:00','+08:00']){
      const result=JSON.parse(cp.execFileSync(process.execPath,[__filename,'--reader'],{input:JSON.stringify({port,password:target.password,database,caseId,personId:actors.lead.personId,receiptId:selectedReceipt,mysqlTimeZone}),env:{...process.env,TZ},encoding:'utf8',windowsHide:true,timeout:30000,stdio:['pipe','pipe','pipe']}));results.push(result);
    }
    save('timezone-combinations.json',results);
    if(mode!=='baseline')await check('missing-material messages use business labels and preserve original machine arrays and blocking conditions',async()=>{
      const value=await gov.read(pool,incompleteRow),message=value.blocking_issues.find(row=>row.code==='PROCESS_CASE_SUBMISSION_INCOMPLETE').message;
      for(const label of ['编制目的','修订原因','本次变化说明','来源材料','参与部门及责任范围','其他必要材料'])assert(message.includes(label));
      assert(!/sources|participants|purpose|revision_reason|change_summary|SYNTHETIC_UNKNOWN_REQUIRED_FIELD/.test(message));assert.deepEqual(value.submission.missing,incompleteValue.missing);
      assert(value.blocking_issues.some(row=>row.code==='PROCESS_CASE_PARTICIPANTS_PENDING'));save('missing-material-message.json',{message,originalMissingPreserved:true,blockingPreserved:true});
    });
    await check('all reads preserve stored history, source JSON, evidence, digest and original receipt bytes',async()=>{
      assert.deepEqual(await originalRows(),before);
      const bytesAfter=await payloadBytes();assert.deepEqual(bytesAfter,bytesBefore);save('payload-byte-verification.json',{equal:true,beforeDigest:gov.digest(bytesBefore),afterDigest:gov.digest(bytesAfter),counts:Object.fromEntries(Object.entries(bytesBefore).map(([table,rows])=>[table,rows.length]))});
      const receipt=before.process_case_requests.find(row=>row.request_id===selectedReceipt);assert(receipt);
      for(const result of results){assert.deepEqual(result.receipt.response,typeof receipt.response_json==='string'?JSON.parse(receipt.response_json):receipt.response_json);assert.equal(result.receipt.request_digest,receipt.request_digest);}
      assert.equal(new Set(results.map(row=>row.rawDriverTime)).size,3,'raw driver must expose real host/session timezone differences');
    });
    const normalized=results.map(row=>JSON.stringify(row.times)),formal=results.map(row=>JSON.stringify(row.formal));
    if(mode==='baseline'){
      await check('reproduced baseline Node/MySQL timezone offset in case history and formal suggestion history',async()=>{assert(new Set(normalized).size>1);assert(new Set(formal).size>1);assert(results.some(row=>row.times.changes[0].created_at!==row.expectedFirstTime));});
    }else{
      await check('case times are identical across all four Node/MySQL timezone combinations with milliseconds and NULL retained',async()=>{
        assert.equal(new Set(normalized).size,1);for(const result of results){assert.equal(result.times.changes[0].created_at,result.expectedFirstTime);assert.match(result.times.changes[0].created_at,/\.234Z$/);assert(result.times.changes.some(row=>row.registered_at===null));assert(result.times.changes.some(row=>/\.456Z$/.test(row.registered_at||'')));assert(result.times.changes.flatMap(row=>row.confirmations).every(row=>/\.789Z$/.test(row.created_at)));}
      });
      await check('formal suggestion times are identical across all four combinations and payload-only date strings are unchanged',async()=>{
        assert.equal(new Set(formal).size,1);assert(results.every(row=>row.formal.suggestions[0].created_at==='2026-09-17T05:06:07.000Z'));
        const payload=results.map(row=>JSON.stringify(row.payload));assert.equal(new Set(payload).size,1);for(const result of results)assert(result.payload.changes.filter(row=>row.kind==='deadline').every(row=>/^2026-12-3[01]$/.test(row.change.due_date)));
      });
    }
  },{stage:'89',randomDatabase:true});passed=true;}catch(error){failure={name:error.name,message:error.message,code:error.code,stack:error.stack};console.error(error.stack);}finally{save('results.json',{passed,mode,checks,owned,failure});}if(!passed)process.exitCode=1;
}
(mode==='reader'?reader():main()).catch(()=>{console.error('Isolated time test failed; credential-bearing diagnostics suppressed.');process.exitCode=1;});
