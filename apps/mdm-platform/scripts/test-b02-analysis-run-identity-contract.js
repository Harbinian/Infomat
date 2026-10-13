// Pure public construction and compatibility contract under the reviewed guard.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {sessionSubject,identityInteger,sameIdentityInteger}=require('../server/sessionSubject');
const {id,digest}=require('../server/dataMapDefinitionValues');
const {makeDataMapDefinitionRepository}=require('../server/dataMapDefinitionRepository');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),at=process.argv.indexOf('--output');assert(at>0);
const output=path.resolve(process.argv[at+1]);assert(!fs.existsSync(output));fs.mkdirSync(output);
const run=path.dirname(output),manifest=JSON.parse(fs.readFileSync(path.join(run,'source-baseline.json'))),input=manifest.files.find(f=>f.path.endsWith('/analysisRuns.js'));
const baseline=fs.readFileSync(input.snapshot,'utf8'),current=fs.readFileSync(require.resolve('../server/analysisRuns'),'utf8');assert.equal(sha(baseline),input.sha256);
const checks=[],save=(name,v)=>fs.writeFileSync(path.join(output,name),JSON.stringify(v,null,2)+'\n',{flag:'wx'});
const test=(name,f)=>{f();checks.push(name);console.log('PASS '+name);};
try {
  test('real MySQL blocked before public repository construction',()=>assert.throws(()=>require('mysql2/promise').createPool({}),e=>['B02_EXTERNAL_EFFECT_FORBIDDEN','ISOLATED_TEST_REAL_MYSQL_FORBIDDEN'].includes(e.code)||/ISOLATED_TEST_REAL_MYSQL_FORBIDDEN/.test(e.message)));
  test('typed person system-admin account authVersion and null meanings preserved',()=>{
    for(const personId of [7,'7','9007199254740992','9007199254740993']){const s={identityKind:'person',personId,accountId:'9007199254741301',authVersion:'9007199254741401'},v=sessionSubject(s);assert.equal(v.personId,personId);assert.equal(v.accountId,s.accountId);assert.equal(v.authVersion,s.authVersion);assert(Object.isFrozen(v));}
    assert.deepEqual(sessionSubject({identityKind:'system_admin',personId:7,accountId:'9007199254741301',authVersion:1}),{kind:'system_admin',principal:'system-admin:9007199254741301',personId:null,accountId:'9007199254741301',authVersion:1});assert.equal(sessionSubject(null).personId,null);
  });
  test('adjacent BIGINT distinct and rounded numeric identity rejected',()=>{
    assert(!sameIdentityInteger('9007199254740992','9007199254740993'));assert.equal(identityInteger(Number('9007199254740993')),null);assert.throws(()=>id(Number('9007199254740993')),e=>e.code==='DEFINITION_ID_INVALID');assert.equal(id(7),'7');
  });
  test('all six original public run operations construct without IO',()=>{
    const repo=makeDataMapDefinitionRepository({getConnection(){throw Error('unexpected IO');}});for(const name of ['createAnalysisRun','beginAnalysisAttempt','completeAnalysisAttempt','finishAnalysisRun','getAnalysisRun','compareAnalysisRuns'])assert.equal(typeof repo[name],'function');
  });
  test('consumer differs only in SQL numeric identity binding if an actual defect was reproduced',()=>assert.equal(current.replaceAll('CAST(? AS SIGNED)','?'),baseline.replaceAll('CAST(? AS SIGNED)','?')));
  test('shared actor request access worker source digest and all protected inputs byte identical',()=>{
    for(const f of manifest.files.filter(f=>!f.path.endsWith('/analysisRuns.js')))assert.equal(sha(fs.readFileSync(path.resolve(__dirname,'../../..',f.path))),f.sha256,f.path);
  });
  test('canonical historical body null unknown fields and adjacent identity digests stay exact',()=>{
    const v={actor_person_id:'9007199254740993',scope_department_id:'9007199254741101',unknown:{ids:['9007199254740992','9007199254740993'],legacy:null},rerun_of_run_id:null};assert.equal(digest(v),digest(JSON.parse(JSON.stringify(v))));assert.notEqual(digest(v),digest({...v,actor_person_id:'9007199254740992'}));
  });
  save('validation.json',{passed:true,checks,inputSha256:input.sha256,currentSha256:sha(current),mysqlBlocked:true,publicWriteProof:'separate owned MySQL test',businesoRgaeptance:false});
}catch(e){save('failure.json',{passed:false,checks,message:e.message,stack:e.stack});throw e;}
finally{save('loaded-dependencies.json',Object.keys(require.cache).map(file=>({path:file,sha256:sha(fs.readFileSync(file))})));}
