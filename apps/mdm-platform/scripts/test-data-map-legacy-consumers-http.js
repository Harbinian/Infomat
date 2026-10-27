// Real HTTP compatibility reads over a new owner-labelled tmpfs MySQL only.
// Synthetic mapping/Excel identities remain independent of controlled map approval.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const root=path.resolve(__dirname,'../../..');
const output=path.resolve(process.argv[2]||path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-05/legacy-http-'+crypto.randomUUID()));
assert(output.startsWith(path.join(root,'artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const frontend=path.join(output,'api-only-frontend');fs.mkdirSync(frontend);fs.writeFileSync(path.join(frontend,'index.html'),'<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>API isolation fixture</title><main>隔离 API 验证</main></html>');
const mappingId='9007199254741071',processId='9007199254741072',logId='9007199254741073';
const checks=[],exchanges=[];let owned,passed=false,failure,publication;
async function seed({pool,owner,database}){
  if(process.env.MDM_TEST_CANDIDATE_ROOT){
    // Explicit fresh-target readiness for the actual formal-enabled application.
    // No case, confirmation, task, package or approval is manufactured here.
    const cases=require('../server/processCaseGovernanceSchema');for(const sql of require('../server/mysqlSchema').splitSqlStatements(cases.SCHEMA_SQL))await pool.execute(sql);
    await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[cases.MIGRATION_KEY]);
    await require('../server/processFormalControlMigration').applyMigration(pool,{authorized:true});
  }
  await require('../server/publicationSchema').managePublicationSchema(pool,'apply');
  await require('../server/officeSchema').manageOfficeSchema(pool,'apply');
  for(const sql of require('../server/dataMapDefinitionSchema').statements())await pool.execute(sql);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)',[require('../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database});
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  await pool.execute("INSERT INTO process_governance_snapshots(id,source_json_path,source_hash,stats_json) VALUES(471,'synthetic-only','synthetic-snapshot','{}')");
  await pool.execute("INSERT INTO process_mapping_records(id,mapping_key,record_type,first_snapshot_id,latest_snapshot_id,l3_name) VALUES(?,'synthetic-legacy-http','l3',471,471,'Synthetic old process display')",[processId]);
  await pool.execute("INSERT INTO mdm_mapping_records(id,process_mapping_record_id,description,approval_dept_id,owner_dept_id,status,submitted_by_person_id,current_step) VALUES(?,?,'Synthetic preserved legacy mapping',91,91,'published',82,5)",[mappingId,processId]);
  await pool.execute("INSERT INTO mdm_version_log(id,entity_type,entity_id,field_name,old_value,new_value,operation,operated_by_person_id,metadata_json) VALUES(?,'mapping',?,'description','Synthetic before','Synthetic recorded value','publish',82,?)",[logId,mappingId,JSON.stringify({recorded_context:{process_name:'Synthetic recorded process name'},history_source:'synthetic stored audit'})]);
  const repo=require('../server/publicationRepository').makePublicationRepository(pool);
  const normalized=require('../server/publicationSpreadsheet').normalizePublication({kind:'master_data',title:'Synthetic spreadsheet dataset',sourceFileName:'synthetic.csv',headers:['Key','Name'],rows:[['KEY-1','Synthetic preserved value']],mapping:{},keyHeader:'Key'});
  const checked=await repo.preview(normalized,'synthetic_legacy_http');
  publication=await repo.publish({...checked,content:normalized.content,requestId:crypto.randomUUID(),datasetKey:'synthetic_legacy_http'},{personId:'82',accountId:'182',authVersion:'1'});
}
async function main(){
 try{
  await withStage05Fixture(async({pool,owner,request})=>{
   owned={owner,...JSON.parse(fs.readFileSync(path.join(output,'fixture/owned-target.json'),'utf8'))};
   async function call(who,url,method='GET',body,status=200){const r=await request(who,url,method,body);exchanges.push({who,url,method,status:r.status,code:r.body?.code||null});assert.equal(r.status,status,`${who} ${url}: ${JSON.stringify(r.body)}`);return r.body;}
   async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,exchanges});}
   const counts=async()=>{const result={};for(const table of ['data_map_publications','data_map_effective_heads','data_map_handoff_approvals','data_map_definition_versions'])result[table]=Number((await pool.execute('SELECT COUNT(*) n FROM '+table))[0][0].n);return result;};
   const before=await counts();let history,excel;
   await check('legacy mapping HTTP detail/list preserves exact BIGINT and real identity without map approval',async()=>{
    const value=await call('lead','/api/mappings/'+mappingId);assert.equal(value.id,mappingId);assert.equal(value.process_mapping_record_id,processId);assert.equal(value.status,'published');assert.equal(value.governance_status,'legacy_unapproved');assert.equal(value.source_identity.table,'mdm_mapping_records');assert.equal(value.source_identity.primary_key.id,mappingId);assert.equal(value.new_reference_allowed,false);assert.equal(value.map_approval_generated,false);
    assert.equal(value.display_context_status,'current_read_model_not_historical_snapshot');
    const list=await call('lead','/api/mappings');assert(JSON.stringify(list).includes(mappingId));save('mapping-detail.json',value);
   });
   await check('all version routes retain recorded audit content and exact mapping IDs after physical display drift',async()=>{
    history=await call('lead','/api/versions/mapping/'+mappingId);assert.equal(history[0].id,logId);assert.equal(history[0].entity_id,mappingId);assert.equal(history[0].new_value,'Synthetic recorded value');
    const generic=await call('lead','/api/versions/entity/mapping/'+mappingId);assert.deepEqual(generic.logs,history);
    await pool.execute("UPDATE process_mapping_records SET l3_name='Synthetic current changed display' WHERE id=?",[processId]);
    await pool.execute("UPDATE mdm_mapping_records SET description='Synthetic current changed mapping' WHERE id=?",[mappingId]);
    assert.deepEqual(await call('lead','/api/versions/mapping/'+mappingId),history);save('mapping-history.json',history);
   });
   await check('legacy mapping and audit scope remain department-scoped and administrator read-only',async()=>{
    await call('outsider','/api/mappings/'+mappingId,'GET',undefined,404);
    await call('outsider','/api/versions/mapping/'+mappingId,'GET',undefined,404);
    await call('admin','/api/mappings/'+mappingId);
    await call('adminMulti','/api/mappings/'+mappingId,'PUT',{description:'must not apply'},403);
    await call('admin','/api/mappings/'+mappingId+'/publish','POST',{},403);
   });
   await check('independent Excel publication GET/list/JSON download preserve payload and namespace',async()=>{
    excel=await call('lead','/api/publications/'+publication.id);assert.equal(excel.governance_status,'legacy_unapproved');assert.equal(excel.source_identity.table,'mdm_publications');assert.equal(excel.new_reference_allowed,false);assert.equal(excel.map_approval_generated,false);assert.equal(excel.content.rows[0][1],'Synthetic preserved value');
    const list=await call('lead','/api/publications?kind=master_data');assert(list.rows.some(r=>String(r.id)===String(publication.id)&&r.governance_status==='legacy_unapproved'));
    assert.deepEqual(await call('lead','/api/publications/'+publication.id+'/download?format=json'),excel);save('spreadsheet-publication.json',excel);
   });
   await check('independent publication digest corruption blocks read and restores no current fallback',async()=>{
    const [[original]]=await pool.execute('SELECT payload_json FROM mdm_publications WHERE id=?',[publication.id]);
    const changed=JSON.parse(original.payload_json);changed.rows[0][1]='Synthetic tampered';
    await pool.execute('UPDATE mdm_publications SET payload_json=? WHERE id=?',[JSON.stringify(changed),publication.id]);
    const refused=await call('lead','/api/publications/'+publication.id,'GET',undefined,409);assert.equal(refused.code,'PUBLICATION_SOURCE_CHANGED');
    await pool.execute('UPDATE mdm_publications SET payload_json=? WHERE id=?',[original.payload_json,publication.id]);
    assert.deepEqual(await call('lead','/api/publications/'+publication.id),excel);
   });
   await check('prepared control does not promote or hide fixed old records and all reads leave map state unchanged',async()=>{
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
    assert.deepEqual(await call('lead','/api/versions/mapping/'+mappingId),history);
    assert.deepEqual(await call('lead','/api/publications/'+publication.id),excel);
    assert.equal((await call('lead','/api/mappings/'+mappingId)).governance_status,'legacy_unapproved');
    assert.deepEqual(await counts(),before);save('map-state-counts.json',{before,after:await counts()});
   });
  },{randomDatabase:true,handoffEnabled:false,processDataGovernanceVersionId:901,completeSource:true,departmentAccountability:true,evidenceDir:path.join(output,'fixture'),frontendDist:frontend,testNodePath:path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules'),createDocument:()=>({schema_version:'process-governance-v8',export_meta:{},process:{},behaviors:[],flow_relations:[],data_objects:[],data_fields:[],data_relations:[],forms:[]}),beforeStart:seed});
  owned.cleaned=true;passed=true;
 }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
 finally{save('http-results.json',{passed,checks,exchanges,owned,failure,formal_database_connected:false,formal_migration:false,deployed:false,feature_activation:false,business_accepted:false});}
}
main().then(()=>console.log('LEGACY_CONSUMERS_HTTP_PASS '+checks.length+' '+output)).catch(e=>{console.error(e.code||e.message);if(e.code==='ERR_ASSERTION')console.error(e.message);process.exitCode=1;});
