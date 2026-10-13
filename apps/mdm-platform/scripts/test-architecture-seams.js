// Behavior boundaries only. Preload blockRealMysql; no application, DB or env file.
const test=require('node:test'),assert=require('node:assert/strict');
const {createRepositoryResource}=require('../server/repositoryResource');
const protocol=require('../shared/browserProtocol');
const {sessionSubject}=require('../server/sessionSubject');
const {identityInteger,sameIdentityInteger}=require('../server/sessionSubject');
const events=require('../server/authoringReplyEvent');
const values=require('../server/dataMapDefinitionValues');
test('mutating legacy rule snapshots cannot change internal high-risk or complete decisions',()=>{
  const rules=require('../server/processDataGovernance');
  rules.HIGH_RISK_ACTIONS.clear();rules.HIGH_RISK_ACTIONS.add('read');rules.COMPLETE_DETAIL_STATUSES.clear();
  assert.equal(rules.isHighRiskAction('destroy'),true);assert.equal(rules.isHighRiskAction('read'),false);
  assert.equal(rules.isCompleteDetailStatus('confirmed'),true);assert.equal(rules.COMPLETE_DETAIL_STATUSES.has('confirmed'),true);
  const columns=require('../server/analysisInputReferences').columns;
  assert.equal(Reflect.set(columns,'definition','source_id'),false);assert.equal(columns.definition,'definition_version_id');
});
test('typed system identity is never interpreted as a person; large person IDs remain exact',()=>{
  const person=sessionSubject({personId:'9007199254740993',accountId:'9007199254740994',authVersion:'2'});
  assert.equal(person.personId,'9007199254740993');assert.equal(person.principal,person.personId);
  const admin=sessionSubject({userId:'system-admin:1',accountId:1,authVersion:2});
  assert.equal(admin.personId,null);assert.equal(admin.kind,'system_admin');assert.equal(admin.principal,'system-admin:1');
});
test('adjacent BIGINT identities stay distinct and absent identities are never coerced to zero',()=>{
  assert.equal(identityInteger('9007199254740993'),'9007199254740993');
  assert.equal(identityInteger(9007199254740993),null,'a number that already lost precision is not an identity');
  assert.equal(sameIdentityInteger('9007199254740993','9007199254740992'),false);
  assert.equal(sameIdentityInteger('9007199254740993',9007199254740993),false);
  assert.equal(sameIdentityInteger('9007199254740995','9007199254740995'),true);
  // Absent and unrepresentable both stay null; neither becomes 0 and neither matches anything.
  for(const value of [null,undefined,'',0,'0',-1,'-1',{},[],1.5,'1e3',' 42 ']) {
    assert.equal(identityInteger(value),null);
    assert.equal(sameIdentityInteger(value,0),false);
    assert.equal(sameIdentityInteger(value,null),false);
  }
  assert.equal(identityInteger('9223372036854775807'),'9223372036854775807');
  assert.equal(identityInteger('9223372036854775808'),null,'above BIGINT range is not an identity');
});
test('composition builds independent repositories with the same 72 operation interface and no IO',()=>{
  const make=require('../server/dataMapDefinitionRepository').makeDataMapDefinitionRepository;
  const pool={getConnection(){throw Error('NO_IO');}};
  const a=make(pool),b=make(pool);
  assert.equal(Object.keys(a).length,72);assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());assert.notEqual(a.listV7Sources,b.listV7Sources);
  const {createDefinitionConsumers}=require('../server/definitionConsumers');
  assert.throws(()=>createDefinitionConsumers({},[()=>({duplicate(){}}),()=>({duplicate(){}})]),/Duplicate definition operation/);
});
test('repository owner deduplicates initialization, releases failed pools, retries and closes instances',async()=>{
  let created=0,closed=0,valid=false;
  const owner=createRepositoryResource({create:()=>({id:++created}),verify:async()=>{if(!valid)throw Error('SCHEMA');},build:pool=>({pool}),dispose:async()=>closed++});
  assert.equal(created,0);const p=owner.get();assert.equal(p,owner.get());await assert.rejects(p,/SCHEMA/);assert.equal(closed,1);
  valid=true;const repo=await owner.get();assert.equal(repo.pool.id,2);await owner.reset();assert.equal(closed,2);await owner.reset();assert.equal(closed,2);
  const second=createRepositoryResource({create:()=>({id:'second'}),verify:async()=>{},build:pool=>pool,dispose:async()=>{}});
  assert.equal((await second.get()).id,'second');await second.reset();
});
test('reset during initialization cannot publish a replaced pool',async()=>{
  let release;let closed=0;
  const owner=createRepositoryResource({create:()=>({}),verify:()=>new Promise(r=>release=r),build:()=>({}),dispose:async()=>closed++});
  const old=owner.get();await new Promise(r=>setImmediate(r));const reset=owner.reset();release();await assert.rejects(old,/REPLACED/);await reset;assert.equal(closed,1);
});
test('shared CSRF ownership rejects late login generations and does not coalesce two users',async()=>{
  const a=protocol.createRequestSession(),b=protocol.createRequestSession();let release,calls=0;
  const delayed=()=>{calls++;return new Promise(r=>release=r);};
  const one=a.csrf(delayed),two=a.csrf(delayed);await new Promise(r=>setImmediate(r));assert.equal(calls,1);
  a.reset();release('old');await assert.rejects(one,{name:'AbortError'});await assert.rejects(two,{name:'AbortError'});
  assert.equal(await a.csrf(async()=>'new'),'new');assert.equal(await b.csrf(async()=>'other'),'other');
  a.invalidateToken();assert.equal(await a.csrf(async()=>'next'),'next');
});
test('page registry preserves exact server paths and complete supported navigation parameters',()=>{
  assert.equal(protocol.pages.length,27);assert.equal(new Set(protocol.pages.map(p=>p.href)).size,27);
  assert(protocol.pages.some(p=>p.serverPath==='/process-formal'));assert.equal(protocol.pages.filter(p=>p.navigation!==null).length,25);
  const target = new URL(protocol.targetHref('#/processGovernance?workspace=v7Preview&v7Case=1&item=2'), 'http://mdm.invalid');
  assert.equal(target.pathname, '/app/process-preview');
  assert.deepEqual(Object.fromEntries(target.searchParams), { item: '2', case: '1' });
  assert.equal(protocol.targetHref('/app/analysis#run=1&finding=2'),'/app/analysis#run=1&finding=2');
  assert.equal(protocol.targetHref('https://external.example'),null);
});
test('sidebar groups cover every module once, in business-flow order, without changing routes',()=>{
  const groups=protocol.navigationGroups;
  assert.deepEqual(groups.map(group=>group.title),['我的工作','流程治理','数据治理','成果查阅','管理与辅助']);
  assert.equal(new Set(groups.map(group=>group.code)).size,groups.length);
  const nav=protocol.pages.filter(page=>page.navigation!==null).sort((a,b)=>a.navigation-b.navigation);
  // Grouping is presentation only: routing metadata and the 25-entry sequence stay intact.
  assert.equal(nav.length,25);
  assert.deepEqual([...new Set(nav.map(page=>page.navigation))],Array.from({length:25},(_,index)=>index));
  const declared=new Set(groups.map(group=>group.code));
  assert.equal(nav.filter(page=>!declared.has(page.group)).length,0,'every module declares a known parent');
  assert.deepEqual([...new Set(nav.map(page=>page.group))],groups.map(group=>group.code),'groups and modules share one business-flow order');
  for(const group of groups){
    const indexes=nav.flatMap((page,index)=>page.group===group.code?[index]:[]);
    assert.ok(indexes.length>=1,`group ${group.code} must list at least one module`);
    assert.deepEqual(indexes,[...indexes].sort((a,b)=>a-b));
    assert.equal(indexes[indexes.length-1]-indexes[0],indexes.length-1,`group ${group.code} modules stay contiguous`);
  }
});
test('invalidated CSRF reads cannot overwrite newer tokens; one cancelled caller does not cancel another',async()=>{
  const session=protocol.createRequestSession();let release;
  const old=session.csrf(()=>new Promise(r=>release=r));await new Promise(r=>setImmediate(r));
  session.invalidateToken();assert.equal(await session.csrf(async()=>'fresh'),'fresh');release('invalid');
  await assert.rejects(old,{name:'AbortError'});assert.equal(await session.csrf(()=>assert.fail('cached')),'fresh');
  session.reset();const failed=session.csrf(async()=>{throw new DOMException('Cancelled','AbortError');},{share:false});
  const success=session.csrf(async()=>'independent',{share:false});await assert.rejects(failed,{name:'AbortError'});assert.equal(await success,'independent');
});
test('reply event byte contract and existing office consistency rules retain historical records',()=>{
  const args={recordId:'9007199254740993',caseId:'12',requestKey:'key',reference:{issue_id:'4',todo_id:'5',expected_task_revision:1},revisionNo:3,contentHash:'h',actorPersonId:'9007199254740994',fixedSources:[{id:'9'}]};
  const before=structuredClone(args),payload=events.issuePayload(args),note=events.officeNote(payload,'answer');
  const expected={source_type:'v7_authoring_reply',record_id:args.recordId,case_id:args.caseId,request_key:args.requestKey,...args.reference,revision_no:3,content_hash:'h',actor_person_id:args.actorPersonId,fixed_sources:args.fixedSources};
  assert.equal(values.json(payload),values.json(expected));assert.deepEqual(args,before);
  const event={id:'10',note:values.json({...note,unknown_historical_field:'kept'}),content_text:'answer',actor_person_id:args.actorPersonId,actor_name:'Synthetic',created_epoch:'1'};
  assert.equal(events.officeReply(event,{issueId:'4',todoId:5}).content,'answer');
  for(const field of ['source_type','issue_id','todo_id','actor_person_id','content'])assert.throws(()=>events.officeReply({...event,note:values.json({...note,[field]:'changed'})},{issueId:'4',todoId:5}),{code:'DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT'});
});
test('complete physical snapshot and canonical digest remain sensitive to historical unknown columns',async()=>{
  const row={id:'9007199254740993',owner_dept_id:'9',object_name_cn:'Synthetic',historical_column:'keep',created_at:'2026-10-08 00:00:00'};
  const db={execute:async sql=>{assert.match(sql,/^SELECT \*/);return [[structuredClone(row)]];}};
  const source=await values.snapshot(db,'object',row.id);assert.deepEqual(source,{row});
  assert.notEqual(values.digest(source),values.digest({row:{...row,historical_column:'changed'}}));
  assert.equal(values.digest(source),values.digest({row:Object.fromEntries(Object.entries(row).reverse())}));
});
