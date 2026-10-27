// In-memory transactional repository test. Real MySQL factories are blocked.
require('./testHelpers/blockRealMysql');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { makeTerminologyGovernanceRepository,resolveTerm } = require('../server/terminologyGovernanceRepository');
const p = require('../server/terminologyGovernancePolicy');
const { POLICY_VERSION } = require('../server/departmentAccountability');
const request = () => crypto.randomUUID();
class MemoryPool {
  constructor() { this.state={terms:[],versions:[],events:[],requests:[],assignments:[],challenges:[],opinions:[]};this.trace=[];this.tail=Promise.resolve(); }
  async getConnection() {
    const pool=this; let snapshot,unlock;
    return { async beginTransaction(){const prior=pool.tail;pool.tail=new Promise(resolve=>{unlock=resolve;});await prior;snapshot=structuredClone(pool.state);},
      execute:(sql,params)=>pool.execute(sql,params),async commit(){snapshot=null;unlock();},async rollback(){if(snapshot){pool.state=snapshot;snapshot=null;unlock();}},release(){} };
  }
  async execute(sql,params=[]) {
    const q=sql.replace(/\s+/g,' ').trim(),s=this.state;this.trace.push(q);
    if(q.startsWith('SELECT migration_key'))return [[{migration_key:'ready'}]];
    if(q.startsWith('SELECT 1 FROM tg_'))return [[]];
    if(q.startsWith('SELECT *')&&q.includes('FROM tg_terms WHERE'))return [[s.terms.find(r=>r.term_id===params[0])].filter(Boolean).map(r=>structuredClone(r))];
    if(q.startsWith('SELECT * FROM tg_term_versions WHERE version_id='))return [[s.versions.find(r=>r.version_id===params[0])].filter(Boolean).map(r=>structuredClone(r))];
    if(q.startsWith('SELECT * FROM tg_term_versions WHERE term_id='))return [s.versions.filter(r=>r.term_id===params[0]).map(r=>structuredClone(r))];
    if(q.startsWith('SELECT * FROM tg_term_events'))return [s.events.filter(r=>r.term_id===params[0]).map(r=>structuredClone(r))];
    if(q.startsWith('SELECT term_id FROM tg_terms'))return [s.terms.map(r=>({term_id:r.term_id}))];
    if(q.startsWith('SELECT COALESCE(MAX(version_no)'))return [[{version_no:Math.max(0,...s.versions.filter(r=>r.term_id===params[0]).map(r=>r.version_no))}]];
    if(q.startsWith('SELECT request_hash,response_json'))return [[s.requests.find(r=>r.actor_person_id===params[0]&&r.request_id===params[1])].filter(Boolean)];
    if(q.startsWith('INSERT INTO tg_requests')){if(!s.requests.some(r=>r.actor_person_id===params[0]&&r.request_id===params[1]))s.requests.push({actor_person_id:params[0],request_id:params[1],request_hash:params[2],response_json:null});return [{affectedRows:1}];}
    if(q.startsWith('UPDATE tg_requests')){s.requests.find(r=>r.actor_person_id===params[1]&&r.request_id===params[2]).response_json=params[0];return [{affectedRows:1}];}
    if(q.startsWith('INSERT INTO tg_terms')){const [term_id,concept_key,context_hash,concept_hash,department_id,created_by_person_id]=params;if(s.terms.some(r=>r.context_hash===context_hash&&r.concept_hash===concept_hash))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});s.terms.push({term_id,concept_key,context_hash,concept_hash,department_id,created_by_person_id,current_version_id:null,pending_version_id:null,draft_status:'draft',adoption_status:'never_adopted',source_status:'current',revision_no:1,legacy_unverified:0});return [{affectedRows:1}];}
    if(q.startsWith('INSERT INTO tg_term_versions')){const [version_id,term_id,version_no,content_json,content_hash,created_by_person_id]=params;s.versions.push({version_id,term_id,version_no,content_json,content_hash,created_by_person_id});return [{affectedRows:1}];}
    if(q.startsWith('INSERT INTO tg_term_events')){const [event_id,term_id,event_type,version_id,revision_no,actor_person_id,actor_department_id,reason,payload_json]=params;s.events.push({event_id,term_id,event_type,version_id,revision_no,actor_person_id,actor_department_id,reason,payload_json});return [{affectedRows:1}];}
    if(q.startsWith('UPDATE tg_terms SET pending_version_id')){s.terms.find(r=>r.term_id===params[1]).pending_version_id=params[0];return [{affectedRows:1}];}
    if(q.startsWith('UPDATE tg_terms SET current_version_id')){const names=q.slice('UPDATE tg_terms SET '.length).split(',revision_no=')[0].split(',').map(value=>value.split('=')[0]);const row=s.terms.find(r=>r.term_id===params[names.length]);assert.equal(row.revision_no,params[names.length+1]);names.forEach((name,index)=>{row[name]=params[index];});row.revision_no++;return [{affectedRows:1}];}
    if(q.startsWith('INSERT INTO tg_challenges')){const [challenge_id,term_id,version_id,raised_by_person_id,reason]=params;s.challenges.push({challenge_id,term_id,version_id,raised_by_person_id,reason,status:'open',revision_no:1});return [{affectedRows:1}];}
    if(q.startsWith('SELECT * FROM tg_challenges WHERE term_id='))return [s.challenges.filter(r=>r.term_id===params[0])];
    if(q.startsWith('SELECT * FROM tg_challenges WHERE challenge_id='))return [[s.challenges.find(r=>r.challenge_id===params[0]&&r.term_id===params[1])].filter(Boolean)];
    if(q.startsWith('SELECT * FROM tg_challenge_opinions'))return [s.opinions.filter(r=>r.challenge_id===params[0])];
    throw new Error('UNMODELED_SQL: '+q);
  }
}
const people={contact:{personId:'1',departmentId:'10',contact:true},head:{personId:'2',departmentId:'10',finalResponsible:true},lead:{personId:'3',departmentId:'20',lead:true,operator:true},
  employee:{personId:'4',departmentId:'30'},steward:{personId:'5',departmentId:'20',steward:true},admin:{personId:'6',departmentId:'10',contact:true,lead:true,readOnly:true}};
let currentHead='2';
const auth={
  async currentActor(_db,session,write=false){const who={...people[session.name],readOnly:Boolean(people[session.name].readOnly)};if(write&&who.readOnly)throw p.fail('ADMIN_READ_ONLY','只读',403);return who;},
  async forTerm(_db,who,row){return {...who,operator:who.lead||Boolean(who.steward&&who.assigned),finalResponsible:who.personId===currentHead&&who.departmentId===row.department_id};},
  canReadProcess(who,row){return Boolean(who.readOnly||who.lead||who.assigned||who.departmentId===row.department_id&&(who.contact||who.finalResponsible));},
  assertContact(who,row){if(!who.contact||row&&who.departmentId!==row.department_id)throw p.fail('CONTACT_REQUIRED','对接人',403);},
  async assertFinal(_db,who,departmentId){if(who.personId!==currentHead)throw p.fail('HEAD_REQUIRED','负责人',403);return {eligible:true,policy_version:POLICY_VERSION,actor_person_id:who.personId,final_responsible_person_id:who.personId,department_id:departmentId,role_assignment_id:'99',appointment_event_id:'100'};}
};
async function main(){
  const disabled=makeTerminologyGovernanceRepository({execute(){throw Error('disabled touched database');}},{env:{}});
  assert.equal((await disabled.capabilities({})).enabled,false);
  const pool=new MemoryPool(),repo=makeTerminologyGovernanceRepository(pool,{env:{TERMINOLOGY_GOVERNANCE_ENABLED:'1'},authority:auth,
    inspectCurrentDepartmentDecision:async(_db,_department,evidence)=>({valid:evidence?.confirmed_by_person_id===currentHead})});
  const session=name=>({name});
  const payload={reason:'合成明确修订依据',request_id:request(),term:'设备',definition:'采购设备的概念',context:'设备采购',concept_key:'采购设备',source_kind:'custom'};
  const created=await repo.createTerm(session('contact'),payload),id=created.term_id;
  assert.equal(created.draft_status,'draft');
  assert.equal((await repo.createTerm(session('contact'),payload)).term_id,id);assert.equal(pool.state.terms.length,1);
  await assert.rejects(repo.createTerm(session('contact'),{...payload,definition:'更改重放'}),{code:'TERM_GOVERNANCE_REQUEST_REUSED'});
  await assert.rejects(repo.createTerm(session('employee'),{...payload,request_id:request()}),{code:'TERM_GOVERNANCE_CONTACT_REQUIRED'});
  await assert.rejects(repo.createTerm(session('admin'),{...payload,request_id:request()}),{code:'TERM_GOVERNANCE_ADMIN_READ_ONLY'});
  await assert.rejects(repo.getTerm(session('employee'),id),{code:'TERM_GOVERNANCE_NOT_FOUND'});
  const second=await repo.createTerm(session('contact'),{...payload,request_id:request(),context:'财务核算'});assert.notEqual(second.term_id,id);
  const generated=await repo.createTerm(session('contact'),{...payload,request_id:request(),context:'自动技术标识语境',concept_key:undefined});
  assert.match(generated.concept_key,/^[a-f0-9-]{36}$/);
  const act=async(name,action,extra={})=>{const current=await repo.getTerm(session('contact'),id);return repo.action(session(name),id,{request_id:request(),expected_revision:current.revision_no,action,reason:'明确依据',...extra});};
  await act('contact','submit');await assert.rejects(act('contact','department_confirm'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
  await act('head','department_confirm');
  currentHead='another';await assert.rejects(act('lead','source_check',{verified:true}),{code:'TERM_GOVERNANCE_DEPARTMENT_RECONFIRM_REQUIRED'});currentHead='2';
  await assert.rejects(act('lead','source_check'),{code:'TERM_GOVERNANCE_SOURCE_CHECK_REQUIRED'});
  await act('lead','source_check',{verified:true});
  await assert.rejects(act('steward','adopt'),{code:'TERM_GOVERNANCE_FORBIDDEN'});
  const adopted=await act('lead','adopt');assert.equal(adopted.usable,true);
  assert.equal((await repo.getTerm(session('employee'),id)).pending_version,undefined);
  const fixed=await resolveTerm(pool,id),originalVersion=structuredClone(pool.state.versions.find(v=>v.version_id===fixed.version_id));
  const versionCount=pool.state.versions.length;
  await assert.rejects(repo.updateTerm(session('contact'),id,{...payload,reason:'',request_id:request(),expected_revision:(await repo.getTerm(session('contact'),id)).revision_no}),{code:'TERM_GOVERNANCE_INPUT_INVALID'});
  assert.equal(pool.state.versions.length,versionCount);
  let current=await repo.getTerm(session('contact'),id);
  const revised=await repo.updateTerm(session('contact'),id,{...payload,request_id:request(),expected_revision:current.revision_no,definition:'新的业务定义'});
  assert.equal(revised.version_id,fixed.version_id);assert.equal(revised.usage_token,fixed.usage_token);
  assert.deepEqual(pool.state.versions.find(v=>v.version_id===fixed.version_id),originalVersion);
  const publicDetail=await repo.getTerm(session('employee'),id);assert.equal(publicDetail.definition,'采购设备的概念');assert.equal(publicDetail.versions.length,1);
  await assert.rejects(repo.updateTerm(session('contact'),id,{...payload,request_id:request(),expected_revision:current.revision_no}),{code:'TERM_GOVERNANCE_REVISION_CONFLICT'});
  await act('contact','submit');await act('head','department_confirm');await act('lead','source_check',{verified:true});await act('lead','not_adopt');
  assert.equal((await resolveTerm(pool,id)).version_id,fixed.version_id);assert.equal((await resolveTerm(pool,id)).usable,true);
  const challenge=await repo.createChallenge(session('employee'),id,{request_id:request(),expected_revision:(await repo.getTerm(session('contact'),id)).revision_no,reason:'自定义定义可能不准确'});
  assert.ok(challenge.challenge_id);assert.equal((await resolveTerm(pool,id)).usage_token,fixed.usage_token);
  assert.equal((await repo.listChallenges(session('employee'),id)).items.length,1);
  const beforeRace=await repo.getTerm(session('contact'),id),race={...payload,request_id:request(),expected_revision:beforeRace.revision_no,definition:'竞争修改'};
  const raced=await Promise.allSettled([repo.updateTerm(session('contact'),id,race),repo.updateTerm(session('contact'),id,{...race,request_id:request(),definition:'另一竞争修改'})]);
  assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.find(x=>x.status==='rejected').reason.code,'TERM_GOVERNANCE_REVISION_CONFLICT');
  assert.ok(pool.trace.every(q=>!q.includes('mdm_todos')));
  assert.ok(pool.trace.every(q=>!q.startsWith('UPDATE tg_term_versions')&&!q.startsWith('DELETE')));
  assert.equal(pool.state.terms.length,3);
  const corruptVersion=pool.state.versions.findIndex(item=>item.version_id===fixed.version_id),retainedVersion=pool.state.versions.splice(corruptVersion,1)[0];
  await assert.rejects(resolveTerm(pool,id),{code:'TERM_GOVERNANCE_VERSION_MISSING'});
  pool.state.versions.splice(corruptVersion,0,retainedVersion);
  process.stdout.write('terminology-governance-core: PASS (transactional fake: authorization, idempotency, revisions, draft preservation, public scope, challenge, no implicit tasks)\n');
}
main().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
