// Owns one new labelled tmpfs MySQL only. No env file, existing DB or HTTP service.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {isolatedEnvironment}=require('./testHelpers/isolatedProcess');
const {makeProcessDesignMysqlRepository}=require('../server/processDesignMysqlRepository');
const expected='2026-10-22T02:54:39.000Z';
const timestampFields={
  process_design_documents:['created_at','updated_at'],
  process_design_drafts:['content_updated_at','submitted_at','published_at','created_at','updated_at'],
  process_design_review_tasks:['decided_at','created_at'],
  process_design_events:['created_at'],
  process_design_versions:['published_at','effective_at']
};
function checkTimes(row,fields){for(const field of fields)assert.equal(row[field],expected,field);}
async function worker(){
  const mysql=require('mysql2/promise');
  assert.equal(process.env.FORMAL_TIMESTAMP_TEST_HOST,'127.0.0.1');
  assert.match(process.env.FORMAL_TIMESTAMP_TEST_DATABASE,/^stage22_isolated_[a-f0-9]{32}$/);
  const port=Number(process.env.FORMAL_TIMESTAMP_TEST_PORT);assert(![3000,3001,3306,3307].includes(port));
  const pool=mysql.createPool({host:'127.0.0.1',port,user:'root',password:process.env.FORMAL_TIMESTAMP_TEST_PASSWORD,database:process.env.FORMAL_TIMESTAMP_TEST_DATABASE,connectionLimit:1});
  try{
    await pool.execute('SET time_zone=?',[process.env.FORMAL_TIMESTAMP_TEST_SQL_ZONE]);
    let selects=0;
    const readOnly={execute(sql,args){assert.match(sql,/^\s*SELECT\b/i,'repository verification must be read only');selects++;return pool.execute(sql,args);}};
    const repo=makeProcessDesignMysqlRepository(readOnly);
    const draft=await repo.getDraft(1),document=await repo.getDocumentById(1),task=await repo.getReviewTask(1),detail=await repo.detail(1);
    checkTimes(draft,timestampFields.process_design_drafts);
    checkTimes(document,timestampFields.process_design_documents);
    checkTimes(task,timestampFields.process_design_review_tasks);
    checkTimes(detail.draft,timestampFields.process_design_drafts);
    checkTimes(detail.document,timestampFields.process_design_documents);
    checkTimes(detail.reviewTasks[0],timestampFields.process_design_review_tasks);
    checkTimes(detail.events[0],timestampFields.process_design_events);
    for(const version of detail.versions){assert.equal(version.published_at,expected);assert.equal(version.effective_at,version.id===1?null:expected);}
    const content=await repo.getVersionContent(1),dated=await repo.getVersionContent(2);
    assert.equal(content.published_at,expected);assert.equal(content.effective_at,null);
    assert.equal(dated.effective_at,expected);assert.equal(dated.publication_meaning.legacy_effective_at,expected);
    const history=await repo.listDocumentDrafts('1',{beforeId:null,departmentId:'91',globalRead:true});
    checkTimes(history[0],['created_at','updated_at']);
    assert.equal(detail.events[0].payload.actor_snapshot.person_name,'合成当时负责人');
    assert.equal(detail.draft.content_hash,content.content_hash);
    assert.deepEqual(detail.content,content.document);
    assert.doesNotMatch(JSON.stringify({draft,document,task,detail,content,dated,history}),/__formal_\w+_epoch/);
    const [[raw]]=await pool.execute('SELECT created_at,UNIX_TIMESTAMP(created_at) AS epoch FROM process_design_events WHERE id=1');
    assert.equal(Number(raw.epoch)*1000,Date.parse(expected));
    return {node_timezone:process.env.TZ,mysql_session_timezone:process.env.FORMAL_TIMESTAMP_TEST_SQL_ZONE,expected,repository_event:detail.events[0].created_at,raw_driver_event:raw.created_at.toISOString(),selects,repository_writes:0};
  }finally{await pool.end();}
}
async function main(){
  const index=process.argv.indexOf('--output');assert(index>0,'--output <new artifacts directory> required');
  const output=path.resolve(process.argv[index+1]),artifacts=path.resolve(__dirname,'../../../artifacts');
  assert(output.startsWith(artifacts+path.sep)&&!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
  const {withFreshMysql}=require('./testHelpers/freshMysql');
  await withFreshMysql(async({pool,port,password,database,owner,containerId})=>{
    fs.writeFileSync(path.join(output,'owned-target.json'),JSON.stringify({owner,containerId,database,host:'127.0.0.1',port,tmpfs:true,formalDatabaseConnected:false},null,2));
    await pool.execute("SET time_zone='+00:00'");
    await pool.execute('CREATE TABLE departments(id BIGINT PRIMARY KEY,name VARCHAR(255)) ENGINE=InnoDB');
    await pool.execute('CREATE TABLE users(id BIGINT PRIMARY KEY,name VARCHAR(255)) ENGINE=InnoDB');
    const {mdmMysqlSchemaSql,splitSqlStatements}=require('../server/mysqlSchema');
    const statements=splitSqlStatements(mdmMysqlSchemaSql());
    for(const table of Object.keys(timestampFields)){
      const ddl=statements.find(sql=>new RegExp('^CREATE TABLE IF NOT EXISTS '+table+' \\(').test(sql.trim()));
      assert(ddl,'current formal schema required: '+table);await pool.execute(ddl);
    }
    const [columns]=await pool.execute("SELECT TABLE_NAME table_name,COLUMN_NAME column_name,DATA_TYPE data_type FROM information_schema.columns WHERE TABLE_SCHEMA=? AND TABLE_NAME LIKE 'process_design_%'",[database]);
    for(const [table,fields]of Object.entries(timestampFields))for(const field of fields)assert.equal(columns.find(row=>row.table_name===table&&row.column_name===field)?.data_type,'timestamp');
    await pool.execute("INSERT INTO departments VALUES (91,'合成甲部')");
    const at='2026-10-22 02:54:39',body={schema_version:'process-governance-v9',process:{process_ref:'synthetic_formal_time',process_name:'合成时间读取检查'}};
    const hash=require('../server/processPreviewReview').contentHash(body),json=JSON.stringify(body);
    await pool.execute(`INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id,created_at,updated_at) VALUES(1,'SYNTHETIC-TIME','合成时间读取检查',91,?,?)`,[at,at]);
    await pool.execute(`INSERT INTO process_design_drafts(id,document_id,document_no,document_title,process_name,reason,basis_type,basis_description,department_id,schema_version,process_content_json,content_hash,revision_no,status,content_updated_at,submitted_at,published_at,created_at,updated_at)
      VALUES(1,1,'SYNTHETIC-TIME','合成时间读取检查','合成时间读取检查','仅验证读取时间','合成','非真实业务',91,'process-governance-v9',?,?,1,'needs_changes',?,?,?,?,?)`,[json,hash,at,at,at,at,at]);
    await pool.execute(`INSERT INTO process_design_review_tasks(id,draft_id,draft_revision_no,content_hash,status,decided_at,created_at) VALUES(1,1,1,?,'needs_changes',?,?)`,[hash,at,at]);
    const payload=JSON.stringify({review_task_id:1,draft_revision_no:1,content_hash:hash,actor_snapshot:{person_id:'84',person_name:'合成当时负责人'}});
    await pool.execute("INSERT INTO process_design_events(id,draft_id,event_type,payload_json,created_at) VALUES(1,1,'review_needs_changes',?,?)",[payload,at]);
    for(const id of [1,2])await pool.execute(`INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,source_revision_no,published_at,effective_at)
      VALUES(?,1,1,'SYNTHETIC-TIME','合成时间读取检查',?,?,91,'process-governance-v9',?,?,1,?,?)`,[id,id===1?'A':'B','SYNTHETIC-TIME-'+id,json,hash,at,id===1?null:at]);
    const persisted=async()=>{
      const result={};
      for(const [table,fields]of Object.entries(timestampFields))result[table]=(await pool.execute('SELECT id,'+fields.map(field=>'UNIX_TIMESTAMP('+field+') AS '+field).join(',')+' FROM '+table+' ORDER BY id'))[0];
      result.payload=(await pool.execute('SELECT CAST(payload_json AS CHAR) payload FROM process_design_events ORDER BY id'))[0];
      result.content=(await pool.execute('SELECT content_hash,process_content_json FROM process_design_drafts ORDER BY id'))[0];
      return result;
    };
    const before=await persisted(),results=[];
    for(const nodeTimezone of ['UTC','Asia/Shanghai','America/New_York'])for(const sqlZone of ['+00:00','+08:00']){
      const child=spawnSync(process.execPath,[__filename,'--worker'],{encoding:'utf8',windowsHide:true,timeout:30000,env:isolatedEnvironment({TZ:nodeTimezone,FORMAL_TIMESTAMP_TEST_HOST:'127.0.0.1',FORMAL_TIMESTAMP_TEST_PORT:String(port),FORMAL_TIMESTAMP_TEST_PASSWORD:password,FORMAL_TIMESTAMP_TEST_DATABASE:database,FORMAL_TIMESTAMP_TEST_SQL_ZONE:sqlZone})});
      assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout.trim());results.push(result);
      fs.writeFileSync(path.join(output,'progress.json'),JSON.stringify(results,null,2));console.log('PASS '+nodeTimezone+' / '+sqlZone);
    }
    assert.deepEqual(await persisted(),before,'read matrix must not rewrite stored times, payload or content');
    assert(results.some(row=>row.raw_driver_event!==row.expected),'matrix must reproduce host/session wall-time ambiguity');
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,results,metadata:columns.filter(row=>timestampFields[row.table_name]?.includes(row.column_name)),persisted_unchanged:true,source_sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../server/processDesignMysqlRepository.js'))).digest('hex')},null,2));
  },{stage:'22',randomDatabase:true});
  fs.writeFileSync(path.join(output,'cleanup.json'),JSON.stringify({owned_mysql_removed:true},null,2));
}
(process.argv.includes('--worker')?worker().then(result=>console.log(JSON.stringify(result))):main()).catch(error=>{console.error(error.stack);process.exitCode=1;});
