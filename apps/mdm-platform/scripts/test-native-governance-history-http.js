// Synthetic native history contract through real HTTP, sessions and CSRF.
// Usage: node scripts/test-native-governance-history-http.js --output <new artifacts directory>
//   --test-node-path <artifacts test dependencies/node_modules>
// Owns one random loopback server and labelled tmpfs MySQL; finally removes only those.
// No env files, existing databases, migrations of formal data or feature activation.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {withStage05Fixture} = require('./test-stage05-mysql-isolated');
const {digest, json, parse} = require('../server/dataMapHandoffPolicy');
const arg = name => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null;
const output = path.resolve(arg('--output') || path.join(__dirname, '../../../artifacts/mdm-data-governance-handoff-implementation-20261020-02/native-http-' + crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep)); assert(!fs.existsSync(output)); fs.mkdirSync(output, {recursive:true});
const frontend = path.join(output, 'api-only-frontend'); fs.mkdirSync(frontend);
fs.writeFileSync(path.join(frontend, 'index.html'), '<!doctype html><title>Native API isolation fixture</title><main>合成 API 验证</main>');
const root = '/api/process-data-governance', checks = [], exchanges = [];
let target, passed = false;
const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({passed, checks, exchanges, target,
  scope:'real isolated HTTP/session/CSRF and MySQL; synthetic business data; no Edge or business acceptance'}, null, 2) + '\n');
async function seed({pool, owner, database, document}) {
  for (const sql of require('../server/dataMapDefinitionSchema').statements()) await pool.execute(sql);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)', [require('../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  for (const sql of require('../server/mysqlSchema').splitSqlStatements(require('../server/governanceResponsibilitiesMigration').SCHEMA_SQL)) await pool.execute(sql);
  assert((await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database})).ready);
  const hash = require('../server/processDataGovernance').digest(document);
  await pool.execute("INSERT INTO process_design_documents(id,document_no,process_ref,document_title,owning_department_id) VALUES(901,'NATIVE-HISTORY-HTTP',?,'合成来源',91)", [document.process.process_ref]);
  await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id,schema_version,process_content_json,content_hash,status) VALUES(901,901,'NATIVE-HISTORY-HTTP','合成来源','A','合成流程','合成','合成','合成',91,?,?,?,'published')", [document.schema_version,json(document),hash]);
  await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(901,901,901,'NATIVE-HISTORY-HTTP','合成来源','A','NATIVE-HISTORY-A',91,?,?,?,'published')", [document.schema_version,json(document),hash]);
  await pool.execute('UPDATE process_design_documents SET current_version_id=901 WHERE id=901');
  await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status,created_by_person_id) VALUES(501,'native-history-http',901,901,91,?,?,'[]','mdm_preparing',82)", [hash,require('../server/processDataGovernance').RULE_VERSION]);
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1");
}
async function main() {
  await withStage05Fixture(async ({pool, owner, fixture, request}) => {
    target = {owner, ...JSON.parse(fs.readFileSync(path.join(output,'fixture','owned-target.json'),'utf8'))}; save();
    async function call(who, url, method='GET', body, status=200) {
      const value = await request(who,url,method,body); exchanges.push({who,url,method,status:value.status,code:value.body?.code||null}); save();
      assert.equal(value.status,status,`${who} ${method} ${url}: ${JSON.stringify(value.body)}`); return value.body;
    }
    async function check(name, action) { await action(); checks.push(name); save(); console.log('PASS ' + name); }
    const read = () => call('lead',root+'/work-packages/501');
    const receipt = (who,id,status=200) => call(who,'/api/data-map-handoffs/requests/'+id,'GET',undefined,status);
    let work, fact, answerId, generationBody;
    await check('missing UUID is rejected before native projection or history changes',async()=>{
      await call('lead',root+'/work-packages/501/generate-candidates','POST',{expected_revision:1},422);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM process_data_governance_detail_versions'))[0][0].n,0);
    });
    await check('disabled handoff consumer still permits native UUID generation with exact replay',async()=>{
      generationBody={request_id:crypto.randomUUID(),expected_revision:1};
      const first=await call('lead',root+'/work-packages/501/generate-candidates','POST',generationBody);
      assert.equal(first.request_id,generationBody.request_id);
      assert.deepEqual(await call('lead',root+'/work-packages/501/generate-candidates','POST',generationBody),first);
      assert.equal((await receipt('lead',generationBody.request_id)).state,'committed');
      work=await read(); assert(work.details.length>0);
    });
    await check('native question answer and close each append fixed versions with minimal department receipt access',async()=>{
      const asked=await call('lead',root+'/work-packages/501/fact-requests','POST',{request_id:crypto.randomUUID(),expected_revision:work.package.revision_no,
        detail_id:String(work.details[0].id),target_department_id:'91',requested_fact_type:'source_evidence',question_text:'合成问题：请核对记录来源。',request_reason:'合成原始证据缺口'},201);
      fact=asked.fact_request; work=await read(); answerId=crypto.randomUUID();
      const body={request_id:answerId,expected_revision:work.package.revision_no,answer_text:'合成部门已核对表单',evidence_ref:'合成表单第1页'};
      const answer=await call('contact',root+'/fact-requests/'+fact.id+'/respond','POST',body);
      assert.deepEqual(await call('contact',root+'/fact-requests/'+fact.id+'/respond','POST',body),answer);
      const observed=await receipt('contact',answerId); assert.equal(observed.state,'committed'); assert.equal(observed.result.request_id,answerId);
      await receipt('outsider',answerId,403); await call('contact',root+'/work-packages/501','GET',undefined,403);
      work=await read(); const closed=await call('lead',root+'/fact-requests/'+fact.id+'/close','POST',{
        request_id:crypto.randomUUID(),expected_revision:work.package.revision_no,basis:'合成答复及证据已核对，继续由 MDM 判断'});
      assert.equal((await receipt('lead',closed.request_id)).state,'committed');
      const versions=(await pool.execute('SELECT * FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no',[String(fact.id)]))[0];
      assert.deepEqual(versions.map(v=>parse(v.snapshot_json).status),['open','answered','closed']);
      assert.equal(parse(versions[1].snapshot_json).answer_text,'合成部门已核对表单');
      for(const v of versions) assert.equal(digest(parse(v.snapshot_json)),v.snapshot_digest);
    });
    await check('each detail decision is immutable and admin overlap cannot write or create a receipt',async()=>{
      work=await read(); const first=work.details[0], id=crypto.randomUUID();
      const denied={request_id:id,expected_revision:work.package.revision_no,status:'not_applicable',governance:{basis:'合成只读拒绝'}};
      await call('adminMulti',root+'/work-packages/501/details/'+first.id,'PATCH',denied,403);
      assert.equal((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests WHERE request_id=?',[id]))[0][0].n,0);
      for(const item of work.details){work=await read();const result=await call('lead',root+'/work-packages/501/details/'+item.id,'PATCH',{
        request_id:crypto.randomUUID(),expected_revision:work.package.revision_no,status:'not_applicable',governance:{basis:'仅为合成隔离测试的人工判断，不构成业务结论'}});assert(result.request_id);}
      const versions=(await pool.execute('SELECT * FROM process_data_governance_detail_versions WHERE detail_id=? ORDER BY revision_no',[String(first.id)]))[0];
      assert(versions.length>=3); for(const v of versions) assert.equal(digest(parse(v.snapshot_json)),v.snapshot_digest);
    });
    await check('completion UUID binds final detail and fact versions and creates only pending generation',async()=>{
      work=await read(); const body={request_id:crypto.randomUUID(),expected_revision:work.package.revision_no,basis:'合成逐项审核完成'};
      const result=await call('lead',root+'/work-packages/501/complete','POST',body);
      assert.equal(result.business_outcome,'native_review_bound_pending_generation'); assert.equal(result.handoff.generation_state,'pending');
      assert.deepEqual(await call('lead',root+'/work-packages/501/complete','POST',body),result);
      const [[binding]]=await pool.execute('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE request_id=?',[body.request_id]);
      const fixed=parse(binding.snapshot_json); assert(fixed.detail_versions.every(d=>d.detail_version_id));
      assert.equal(fixed.current_fact_versions.length,1);
      const [[lastFact]]=await pool.execute('SELECT fact_version_id,revision_no FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no DESC LIMIT 1',[String(fact.id)]);
      assert.equal(fixed.current_fact_versions[0].fact_version_id,lastFact.fact_version_id);
      assert.equal(fixed.current_fact_versions[0].revision_no,lastFact.revision_no);
      assert.equal(fixed.current_fact_versions[0].status,'closed');
      const [[counts]]=await pool.execute('SELECT (SELECT COUNT(*) FROM data_map_handoff_generation_tasks WHERE state=\'pending\') pending,(SELECT COUNT(*) FROM data_map_handoff_drafts) drafts,(SELECT COUNT(*) FROM data_map_publications) publications');
      assert.equal(counts.pending,1); assert.equal(counts.drafts,0); assert.equal(counts.publications,0);
      assert.equal((await receipt('lead',body.request_id)).state,'committed');
    });
    passed=true; save();
  },{evidenceDir:path.join(output,'fixture'),frontendDist:frontend,testNodePath:arg('--test-node-path'),processDataGovernanceVersionId:901,handoffEnabled:false,randomDatabase:true,beforeStart:seed,
    createDocument:()=>({schema_version:'process-governance-v8',export_meta:{},process:{},behaviors:[],flow_relations:[],data_objects:[],data_relations:[],forms:[]})});
}
main().catch(error=>{save();console.error(error.message);process.exitCode=1;});
