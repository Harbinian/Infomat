// Pure import concurrency and compatibility contracts. All database methods and
// authority reads are explicit doubles; blockRealMysql rejects any missed socket.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const {normalizePublication} = require('../server/publicationSpreadsheet');
const {directorySourceHash,DIRECTORY_SOURCE_HASH_VERSION,makePublicationRepository,directoryPlan} = require('../server/publicationRepository');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const P0 = '9007199254741000', P1 = '9007199254741001';
const actor = {personId:81,accountId:181,authVersion:1};
const document = kind => normalizePublication(kind === 'master_data'
  ? {kind,title:'合成主数据',sourceFileName:'synthetic.csv',headers:['编号','名称'],rows:[['A','合成记录']],keyHeader:'编号'}
  : {kind,title:'合成目录',sourceFileName:'synthetic.csv',headers:['组织编码','组织名称'],rows:[['D','合成部门']],mapping:{code:'组织编码',name:'组织名称'}});

function isolatedRepository({saved = false, valid = true, reason = '合成维护原因', doc = document('organization')} = {}) {
  const calls = [], state = {saved,valid,reason};
  const file = path.resolve(__dirname,'../server/publicationRepository.js'), local = new Module(file,module);
  local.filename = file; local.paths = Module._nodeModulePaths(path.dirname(file));
  const original = local.require.bind(local);
  local.require = name => name === './identityMysqlRepository' ? {readPersonAuthority:async () => ({valid:state.valid,readOnly:false,permissions:new Set(['directory:maintain','governance:publish'])})} : original(name);
  local._compile(fs.readFileSync(file,'utf8'),file);
  const row = {id:'7',publication_ref:'synthetic-original',kind:doc.content.kind,dataset_key:doc.content.kind,title:doc.content.title,version_no:1,previous_publication_id:null,source_file_name:doc.content.sourceFileName,content_hash:doc.contentHash,payload_json:JSON.stringify(doc.content),row_count:1,published_by_person_id:'81',published_epoch:1};
  const db = {
    async beginTransaction(){calls.push('BEGIN');},async commit(){calls.push('COMMIT');},async rollback(){calls.push('ROLLBACK');},release(){calls.push('RELEASE');},
    async execute(sql) {
      calls.push(sql);
      if(sql.includes('FROM mdm_publications WHERE request_id='))return [state.saved ? [row] : []];
      if(sql.includes('FROM mdm_version_log'))return [[{metadata_json:JSON.stringify({reason:state.reason}),actor_person_id:'81',operated_epoch:1}]];
      if(sql.includes('FROM mdm_publications WHERE id='))return [[row]];
      if(sql.includes('FROM mdm_publications WHERE kind='))return [[]];
      if(/FOR UPDATE$/.test(sql))return [[]];
      throw new Error('Unexpected synthetic query: '+sql);
    },
    async query(sql){calls.push(sql);throw new Error('No directory planning is allowed in this synthetic case');}
  };
  const pool = {...db,async getConnection(){return db;}};
  return {repo:local.exports.makePublicationRepository(pool),calls,state,row,doc};
}
const inputFor = fixture => ({content:fixture.doc.content,contentHash:fixture.doc.contentHash,datasetKey:fixture.doc.content.kind,requestId:crypto.randomUUID(),reason:fixture.state.reason,expectedLatestId:0,baseHash:hash(null)});
const assertNoWrites = calls => assert(!calls.some(sql => /^(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b/.test(sql)));

test('every directory identity position distinguishes adjacent unsafe integers without changing the source object',()=>{
  const positions = [
    ['departments','id'],['departments','parent_id'],['persons','person_id'],['persons','current_department_id'],
    ['accounts','person_id'],['assignments','person_id'],['assignments','scope_department_id'],['admins','person_id'],
    ['offices','org_unit_id'],['offices','department_id'],['offices','manager_person_id'],
    ['memberships','office_id'],['memberships','person_id'],['pending','todo_id'],['pending','office_id'],['pending','assignee_person_id']
  ];
  assert.equal(Number(P0),Number(P1));
  for(const [collection,field] of positions) {
    const before = {[collection]:[{[field]:P0,name:'合成记录'}]}, after = {[collection]:[{[field]:P1,name:'合成记录'}]};
    const original = structuredClone(before);
    assert.notEqual(directorySourceHash('organization',before),directorySourceHash('organization',after),collection+'.'+field);
    assert.deepEqual(before,original);
  }
  assert.equal(directorySourceHash('roster',{persons:[{person_id:81,current_department_id:null}]}),directorySourceHash('roster',{persons:[{person_id:'81',current_department_id:null}]}));
  assert.throws(()=>directorySourceHash('roster',{persons:[{person_id:Number(P1)}]}),/Invalid internal directory identity/);
});

test('current preview uses exact aliases while the retained legacy projection reproduces its original collision',async()=>{
  const doc = document('organization');
  let manager = P0;
  const pool = {
    async execute(sql){assert(sql.includes('FROM mdm_publications WHERE kind='));return [[]];},
    async query(sql){
      if(sql.includes('FROM departments'))return [[{id:91,code:'D',name:'合成部门',parent_id:null,department_type:null,status:'active',directory_final_responsible_person_id:null,directory_data_owner_person_id:null,exact_id:'91',exact_parent_id:null}]];
      if(sql.includes('FROM person ORDER'))return [[]];
      if(sql.includes('FROM org_unit'))return [[{org_unit_id:31,org_unit_code:'O',org_unit_name:'合成办公室',org_type:'office',department_id:91,manager_person_id:Number(manager),status:'active',exact_org_unit_id:'31',exact_department_id:'91',exact_manager_person_id:manager}]];
      if(sql.includes('FROM office_membership')||sql.includes('FROM mdm_todo_office_assignments'))return [[]];
      throw new Error('Unexpected preview query: '+sql);
    }
  };
  const repo = makePublicationRepository(pool), first = await repo.preview(doc), oldFirst = (await directoryPlan(pool,doc)).baseHash;
  manager = P1;
  const second = await repo.preview(doc), oldSecond = (await directoryPlan(pool,doc)).baseHash;
  assert.equal(oldFirst,oldSecond);
  assert.equal(first.sourceHashVersion,DIRECTORY_SOURCE_HASH_VERSION);assert.equal(second.sourceHashVersion,DIRECTORY_SOURCE_HASH_VERSION);
  assert.notEqual(first.baseHash,second.baseHash);assert.equal(first.contentHash,doc.contentHash);assert.equal(second.contentHash,doc.contentHash);
  assert.equal(JSON.stringify(doc.content).includes('sourceHashVersion'),false);
});

for(const version of [undefined,'directory-publication-source-v1','directory-publication-source-unknown']) {
  test('uncommitted '+String(version)+' check is explicitly refused before directory planning or writes',async()=>{
    const fixture = isolatedRepository();
    await assert.rejects(fixture.repo.publish({...inputFor(fixture),sourceHashVersion:version},actor),error => error.statusCode === 409 && error.code === 'PUBLICATION_SOURCE_CHECK_EXPIRED');
    assertNoWrites(fixture.calls);assert(!fixture.calls.includes('COMMIT'));assert(fixture.calls.includes('ROLLBACK'));
  });
}

test('successful unversioned legacy request recovers its original receipt without a write or history rewrite',async()=>{
  const fixture = isolatedRepository({saved:true}), stored = structuredClone(fixture.row);
  const receipt = await fixture.repo.publish(inputFor(fixture),actor);
  assert.equal(receipt.idempotent,true);assert.equal(String(receipt.id),'7');assertNoWrites(fixture.calls);assert.deepEqual(fixture.row,stored);
  const history = await fixture.repo.get('7');assert.deepEqual(history.content,fixture.doc.content);assert.equal(history.content_hash,fixture.doc.contentHash);
});

test('legacy receipt recovery still checks current authority and original reason, author and content',async()=>{
  const expired = isolatedRepository({saved:true,valid:false});
  await assert.rejects(expired.repo.publish(inputFor(expired),actor),{code:'PUBLICATION_ACCESS_CHANGED'});assertNoWrites(expired.calls);
  for(const changed of ['reason','author','content']) {
    const fixture = isolatedRepository({saved:true}), input = inputFor(fixture);
    if(changed === 'reason')input.reason = '其他原因';
    if(changed === 'author')fixture.row.published_by_person_id = '82';
    if(changed === 'content')fixture.row.content_hash = 'different-saved-content';
    await assert.rejects(fixture.repo.publish(input,actor),{code:'PUBLICATION_SOURCE_CHANGED'});assertNoWrites(fixture.calls);
  }
});

test('master data preview and old receipt continue their original unversioned contract',async()=>{
  const fixture = isolatedRepository({doc:document('master_data')});
  const preview = await fixture.repo.preview(fixture.doc,'SYNTHETIC_MASTER');
  assert.equal(preview.baseHash,hash(null));assert.equal(preview.contentHash,fixture.doc.contentHash);assert.equal(Object.hasOwn(preview,'sourceHashVersion'),false);
  fixture.state.saved = true;fixture.row.dataset_key = 'SYNTHETIC_MASTER';
  const receipt = await fixture.repo.publish({...inputFor(fixture),datasetKey:'SYNTHETIC_MASTER'},actor);
  assert.equal(receipt.idempotent,true);assertNoWrites(fixture.calls);
});
