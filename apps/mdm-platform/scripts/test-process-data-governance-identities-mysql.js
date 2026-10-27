// Input: a fresh output directory under artifacts. Creates only an owner-labelled
// tmpfs MySQL fixture, exact synthetic fixed sources and local test identities.
// Output: checks and source hashes. No private env, production DB or deployment.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed}=require('./testHelpers/dataMapHandoffFixture');
const {makeProcessDataGovernanceRepository}=require('../server/processDataGovernanceRepository');
const scope=require('../server/processDataGovernanceScope');
const {digest,json}=require('../server/dataMapHandoffPolicy');
const output=path.resolve(process.argv[2]);
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[];let owned,passed=false,failure;
const check=async(name,work)=>{await work();checks.push(name);console.log('PASS '+name);};
async function main(){try{
 await withFreshMysql(async target=>{
  owned={owner:target.owner,database:target.database,port:target.port,containerId:target.containerId};
  const {pool}=target,{session,packageSeed}=await seed(target),repo=makeProcessDataGovernanceRepository(pool),actor=session(11);
  await packageSeed('871');
  const sources=['9007199254740993','9007199254740994'];
  const [[source]]=await pool.execute('SELECT * FROM process_design_versions WHERE id=871');
  for(const [index,id]of sources.entries()){
   const document=typeof source.process_content_json==='string'?JSON.parse(source.process_content_json):structuredClone(source.process_content_json);document.process.process_name='Synthetic exact source '+index;
   await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,871,871,'EXACT','Synthetic exact source',?,?,91,?,?,?,?)",[id,'EXACT-'+index,'EXACT-'+index,document.schema_version,json(document),digest(document),index?'published':'superseded']);
  }
  await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=871',[sources[1]]);
  await check('existing safe integer task and package fields retain their numeric JSON representation',async()=>{
   await pool.execute("INSERT INTO process_data_governance_creation_tasks(id,task_ref,process_version_id,status,requested_by_person_id) VALUES(77,'pdg-task-v871',871,'queued',11)");
   const result=await repo.queueAndMaterialize('871',actor);assert.equal(result.idempotent,true);assert.equal(result.task.id,77);assert.equal(result.task.process_version_id,871);assert.equal(result.task.completed_work_package_id,871);assert.equal(result.package.id,871);assert.equal(result.package.process_version_id,871);
  });
  await pool.execute('ALTER TABLE process_data_governance_creation_tasks AUTO_INCREMENT=9007199254740993');
  await pool.execute('ALTER TABLE process_data_governance_work_packages AUTO_INCREMENT=9007199254741199');
  const before=await pool.execute('SELECT CAST(id AS CHAR) id,process_content_json,content_hash,status FROM process_design_versions WHERE id IN (?,?) ORDER BY id',sources);
  fs.writeFileSync(path.join(output,'source-before.json'),JSON.stringify(before[0],null,2));
  const created=[];
  await check('adjacent exact fixed source IDs create distinct work packages and task receipts without numeric rounding',async()=>{
   for(const id of sources){const result=await repo.queueAndMaterialize(id,actor);created.push(result);assert.equal(result.package.process_version_id,id);assert.equal(result.task.process_version_id,id);assert.equal(result.task.completed_work_package_id,result.package.id);assert.equal(result.task.status,'completed');}
   assert.deepEqual(created.map(x=>x.task.id),['9007199254740993','9007199254740994']);
   assert.deepEqual(created.map(x=>x.package.id),['9007199254741199','9007199254741200']);
   for(const [index,id]of sources.entries()){
    const list=await repo.listWorkPackages(id);assert.equal(list.length,1);assert.equal(list[0].id,created[index].package.id);assert.equal(list[0].process_version_id,id);
    const detail=await repo.getWorkPackageDetail(created[index].package.id);assert.equal(detail.package.id,created[index].package.id);assert.equal(detail.source_version.process_version_id,id);
   }
   const published=await repo.listPublishedVersions();for(const id of sources)assert.equal(published.find(row=>row.process_version_id===id).work_package_id,created[sources.indexOf(id)].package.id);
   assert.deepEqual(await pool.execute('SELECT CAST(id AS CHAR) id,process_content_json,content_hash,status FROM process_design_versions WHERE id IN (?,?) ORDER BY id',sources),before);
  });
  await check('same fixed source retries return its original task and package without duplicating history',async()=>{
   for(const [index,id]of sources.entries()){const result=await repo.queueAndMaterialize(id,actor);assert.equal(result.idempotent,true);assert.equal(result.package.id,created[index].package.id);assert.equal(result.task.id,created[index].task.id);}
   const [[count]]=await pool.execute('SELECT COUNT(*) n FROM process_data_governance_work_packages WHERE process_version_id IN (?,?)',sources);assert.equal(Number(count.n),2);
  });
  await check('invalid or already rounded numeric source IDs refuse before task registration',async()=>{
   const [[before]]=await pool.execute('SELECT COUNT(*) n FROM process_data_governance_creation_tasks');
   for(const id of [Number(sources[0]),0,'9223372036854775808','1e3','-1'])await assert.rejects(repo.queueAndMaterialize(id,actor),{code:'PROCESS_DATA_GOVERNANCE_VERSION_REQUIRED'});
   const [[after]]=await pool.execute('SELECT COUNT(*) n FROM process_data_governance_creation_tasks');assert.equal(after.n,before.n);
  });
  await check('HTTP source selection preserves exact BIGINT strings and safe numeric compatibility',async()=>{
   assert.equal(scope.assertProcessVersionAllowed(sources[0]),sources[0]);assert.equal(scope.assertProcessVersionAllowed('77'),77);
   assert.equal(scope.isProcessVersionAllowed(Number(sources[0])),false);assert.equal(scope.isProcessVersionAllowed('9223372036854775808'),false);
  });
 },{stage:'87',randomDatabase:true});passed=true;
 }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
 finally{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed,checks,owned,failure,formal_database_connected:false,deployed:false},null,2));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
