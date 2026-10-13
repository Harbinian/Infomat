// Pure construction/identity/compatibility contract. Requires --output in this
// dispatched run; writes evidence only, blocks MySQL and every external effect
// through the unchanged reviewed execution guard. Public writes run separately
// in the owned MySQL entry, never with fabricated storage or helper behavior.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sessionSubject,identityInteger,sameIdentityInteger}=require('../server/sessionSubject');
const {id,digest}=require('../server/dataMapDefinitionValues');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),at=process.argv.indexOf('--output');assert(at>0);
const output=path.resolve(process.argv[at+1]);assert(!fs.existsSync(output));fs.mkdirSync(output);
const run=path.dirname(output),manifest=JSON.parse(fs.readFileSync(path.join(run,'source-baseline.json'))),input=manifest.files.find(f=>f.path.endsWith('/analysisIssueTasks.js'));
const baseline=fs.readFileSync(input.snapshot,'utf8'),current=fs.readFileSync(require.resolve('../server/analysisIssueTasks'),'utf8');assert.equal(sha(baseline),input.sha256);
const checks=[],save=(name,v)=>fs.writeFileSync(path.join(output,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const test=(name,f)=>{f();checks.push(name);console.log('PASS '+name);};
try {
  test('real MySQL blocked before public repository construction',()=>assert.throws(()=>require('mysql2/promise').createPool({}),e=>e.code==='B02_EXTERNAL_EFFECT_FORBIDDEN'));
  test('typed person system-admin null account generation and immutable subject meanings retained',()=>{
    for(const personId of [7,'7','9007199254740992','9007199254740993']){const s={identityKind:'person',personId,accountId:'9007199254741301',authVersion:'9007199254741401'},v=sessionSubject(s);assert.equal(v.personId,personId);assert.equal(v.accountId,s.accountId);assert.equal(v.authVersion,s.authVersion);assert(Object.isFrozen(v));}
    assert.deepEqual(sessionSubject({identityKind:'system_admin',personId:7,accountId:'9007199254741301',authVersion:1}),{kind:'system_admin',principal:'system-admin:9007199254741301',personId:null,accountId:'9007199254741301',authVersion:1});assert.equal(sessionSubject(null).personId,null);
  });
  test('adjacent BIGINT distinct and unsafe rounded identity rejected',()=>{assert(!sameIdentityInteger('9007199254740992','9007199254740993'));assert.equal(identityInteger(Number('9007199254740993')),null);assert.throws(()=>id(Number('9007199254740993')),e=>e.code==='DEFINITION_ID_INVALID');assert.equal(id(7),'7');});
  test('both task public entries construct without invoking storage',()=>{const repo=makeDataMapDefinitionRepository({getConnection(){throw Error('unexpected IO');}});for(const name of ['dispatchAnalysisIssueTask','getAnalysisIssueTasks'])assert.equal(typeof repo[name],'function');});
  test('only demonstrated prior todo projection changes all original SQL control flow and lock order otherwise byte identical',()=>{
    const original='SELECT todo_id,round_no FROM data_map_analysis_issue_tasks WHERE issue_id=? AND purpose=? ORDER BY round_no FOR UPDATE';
    const exact='SELECT CAST(todo_id AS CHAR) todo_id,round_no FROM data_map_analysis_issue_tasks WHERE issue_id=? AND purpose=? ORDER BY round_no FOR UPDATE';
    assert.equal(baseline.split(original).length,2);assert.equal(current,baseline.replace(original,exact).replace('SELECT status FROM mdm_todos WHERE id=? FOR UPDATE','SELECT status FROM mdm_todos WHERE id=CAST(? AS SIGNED) FOR UPDATE'));
  });
  test('all protected input dependency consumer and old tests keep original SHA',()=>{for(const f of manifest.files.filter(f=>!f.path.endsWith('/analysisIssueTasks.js')))assert.equal(sha(fs.readFileSync(path.resolve(__dirname,'../../..',f.path))),f.sha256,f.path);});
  test('historical unknown fields null and full row task digest remain exact and identity sensitive',()=>{const v={issue_id:'9007199254741801',office_id:'9007199254741501',actor_person_id:'9007199254740993',sources:[{run_id:'9007199254741801',finding_id:'9007199254741801',review:{unknown:null,old:[7,'7']}}]};assert.equal(digest(v),digest(JSON.parse(JSON.stringify(v))));assert.notEqual(digest(v),digest({...v,issue_id:'9007199254741800'}));assert.notEqual(digest(v),digest({...v,actor_person_id:'9007199254740992'}));});
  save('validation.json',{passed:true,checks,inputSha256:input.sha256,currentSha256:sha(current),mysqlBlocked:true,businessAcceptance:false});
}catch(e){save('failure.json',{passed:false,checks,message:e.message,stack:e.stack});throw e;}
finally{save('loaded-dependencies.json',Object.keys(require.cache).map(file=>({path:file,sha256:sha(fs.readFileSync(file))})));}
