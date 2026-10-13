// Behavior tests with injected storage only. No database, HTTP, configuration or files.
const test=require('node:test'),assert=require('node:assert/strict');
const {createProcessDesignApplication}=require('../server/processDesignApplication');
const {validateLockedDraft}=require('../server/processDesignValidation');
const {createRepositoryResource}=require('../server/repositoryResource');
const {FORMAL_V7_TRANSACTION_CONTEXT,isEditableDraftStatus,EDITABLE_DRAFT_STATUSES,assertV7FormalTransitionEnabled}=require('../server/processDesignPolicy');
const binding={expected_revision_no:3,expected_content_hash:'a'.repeat(64)};
function fixture(schema='process-governance-v8') {
  let state={draft:{id:1,schema_version:schema,process_content_json:'{"process":{"process_ref":"process_synthetic"}}',status:'draft',revision_no:3,content_hash:binding.expected_content_hash,document_id:4,base_version_id:null,department_id:91},
    tasks:[],document:{id:4,document_no:'SYNTHETIC',document_title:'合成流程'},currentVersion:null,version:null};
  const calls=[];
  const record=(name,fn)=>(...args)=>{calls.push(name);return fn(...args);};
  const store={
    assertEnabled:draft=>assertV7FormalTransitionEnabled(draft,{env:{PROCESS_V7_FORMAL_ENABLED:'1'}}),
    readDraft:record('read',async()=>structuredClone(state.draft)),
    readReviewTask:async id=>structuredClone(state.tasks.find(t=>t.id===id)),
    readVersion:async()=>structuredClone(state.version),
    lockContext:record('lock',async()=>({draft:structuredClone(state.draft),reviewTasks:structuredClone(state.tasks),document:state.document,currentVersion:state.currentVersion})),
    authorizeActor:record('authorize',async(options)=>{if(options.denied)throw Object.assign(Error('DENIED'),{code:'V7_FORMAL_ADMIN_READ_ONLY'});return {personId:83};}),
    validateDraft:record('validate',async()=>{}),
    markSubmitted:record('markSubmitted',async()=>{state.draft.status='submitted';return {affectedRows:1};}),
    createDepartmentReview:record('createReview',async()=>{state.tasks.push({id:2,status:'pending',draft_revision_no:3,content_hash:binding.expected_content_hash});return {insertId:2};}),
    recordReviewDecision:record('decideTask',async({nextStatus})=>{state.tasks[0].status=nextStatus;return {affectedRows:1};}),
    setReviewedDraftStatus:record('decideDraft',async({nextStatus})=>{state.draft.status=nextStatus;return {affectedRows:1};}),
    createPublishedVersion:record('createVersion',async({plannedEdition})=>{state.version={id:9,edition:plannedEdition};return {insertId:9};}),
    supersedePublishedVersion:record('supersede',async()=>({affectedRows:1})),
    markPublished:record('publishDraft',async()=>{state.draft.status='published';return {affectedRows:1};}),
    advanceDocumentVersion:record('advanceDocument',async()=>({affectedRows:1})),
    recordEvent:record('event',async()=>{})
  };
  store.withTransaction=async(draftId,taskId,operation)=>{
    const before=structuredClone(state);
    calls.push('begin');
    try {const result=await operation({locator:{draftId,taskId,caseId:7},application:createProcessDesignApplication(store)});calls.push('commit');return result;}
    catch(error){state=before;calls.push('rollback');throw error;}
  };
  return {store,calls,app:createProcessDesignApplication(store),state:()=>state};
}
for(const schema of ['process-governance-v8','process-governance-v7']) {
  test(schema+' submit/review/publish use the same transaction capabilities and authorize before writing',async()=>{
    const f=fixture(schema);
    const submitted=await f.app.submitDraft({id:1},'合成提交',83,binding);
    assert.equal(submitted.reviewTask.id,2);
    assert.deepEqual(f.calls,['read','begin','lock','authorize','validate','markSubmitted','createReview','event','read','commit']);
    f.calls.length=0;
    await f.app.decideReviewTask({id:2},'approve','合成审核',83,binding);
    assert.deepEqual(f.calls,['read','begin','lock','authorize','validate','decideTask','decideDraft','event','read','commit']);
    f.calls.length=0;
    const result=await f.app.publishDraft({id:1},'合成发布',83,binding);
    assert.equal(result.process_version_id,9);assert.equal(f.state().draft.status,'published');
    assert.deepEqual(f.calls,['read','begin','lock','authorize','validate','createVersion','publishDraft','advanceDocument','event','read','commit']);
  });
}
test('denied and stale operations cannot invoke any storage writes',async()=>{
  for(const extra of [{denied:true},{expected_content_hash:'b'.repeat(64)}]) {
    const f=fixture();
    await assert.rejects(f.app.submitDraft({id:1},'',83,{...binding,...extra}));
    assert.deepEqual(f.calls,['read','begin','lock','authorize','rollback']);
    assert.equal(f.state().draft.status,'draft');
  }
});
test('audit failure rolls back the complete operation and independent instances remain isolated',async()=>{
  const a=fixture(),b=fixture();
  a.store.recordEvent=async()=>{throw Error('AUDIT_FAILURE');};
  await assert.rejects(a.app.submitDraft({id:1},'',83,binding),/AUDIT_FAILURE/);
  assert.equal(a.state().draft.status,'draft');assert.deepEqual(a.state().tasks,[]);
  await b.app.submitDraft({id:1},'',83,binding);
  assert.equal(b.state().draft.status,'submitted');assert.equal(a.state().draft.status,'draft');
});
test('already decided reviews and invalid transaction capabilities are refused',async()=>{
  const f=fixture();await f.app.submitDraft({id:1},'',83,binding);
  await f.app.decideReviewTask({id:2},'reject','合成拒绝',83,binding);
  f.calls.length=0;
  await assert.rejects(f.app.decideReviewTask({id:2},'approve','',83,binding),{code:'REVIEW_TASK_ALREADY_DECIDED'});
  assert.deepEqual(f.calls,['read','begin','lock','authorize','rollback']);
  await assert.rejects(f.app.publishDraft({id:1},'',83,{...binding,[FORMAL_V7_TRANSACTION_CONTEXT]:{operation:'submit',locator:{draftId:1}}}),{code:'V7_FORMAL_TRANSACTION_REQUIRED'});
});
test('retired drafts and missing transactional storage do not regain write capability',async()=>{
  const old=fixture('process-governance-v3');
  await assert.rejects(old.app.submitDraft({id:1},'',83,binding),{code:'LEGACY_PROCESS_RETIRED'});assert.deepEqual(old.calls,['read']);
  const f=fixture();f.store.withTransaction=async(id,task,operation)=>operation({locator:{draftId:id},application:null});
  await assert.rejects(f.app.submitDraft({id:1},'',83,binding),{code:'V7_FORMAL_TRANSACTION_REQUIRED'});
});
test('every conditional write refuses zero affected rows and rolls back prior changes',async()=>{
  for(const operation of ['markSubmitted','recordReviewDecision','setReviewedDraftStatus','supersedePublishedVersion','markPublished','advanceDocumentVersion']) {
    const f=fixture();
    if(operation!=='markSubmitted')await f.app.submitDraft({id:1},'',83,binding);
    const reviewing=['recordReviewDecision','setReviewedDraftStatus'].includes(operation);
    if(operation!=='markSubmitted'&&!reviewing)await f.app.decideReviewTask({id:2},'approve','',83,binding);
    if(operation==='supersedePublishedVersion'){f.state().currentVersion={id:8,edition:'A'};f.state().draft.base_version_id=8;}
    const before=structuredClone(f.state());f.calls.length=0;
    f.store[operation]=async()=>({affectedRows:0});
    const run=()=>operation==='markSubmitted'?f.app.submitDraft({id:1},'',83,binding):
      reviewing?f.app.decideReviewTask({id:2},'approve','',83,binding):f.app.publishDraft({id:1},'',83,binding);
    await assert.rejects(run(),error=>error.statusCode===409);
    assert.equal(f.calls.at(-1),'rollback',operation);
    assert.equal(f.calls.includes('event'),false,operation);
    assert.deepEqual(f.state(),before,operation);
  }
});
test('publication replaces an existing version in order and advances its expected edition',async()=>{
  const f=fixture();await f.app.submitDraft({id:1},'',83,binding);
  await f.app.decideReviewTask({id:2},'approve','',83,binding);
  f.state().currentVersion={id:8,edition:'A'};f.state().draft.base_version_id=8;
  let planned,anchor;
  const create=f.store.createPublishedVersion,advance=f.store.advanceDocumentVersion;
  f.store.createPublishedVersion=args=>{planned=args.plannedEdition;return create(args);};
  f.store.advanceDocumentVersion=args=>{anchor=args.currentVersion.id;return advance(args);};
  f.calls.length=0;
  await f.app.publishDraft({id:1},'',83,binding);
  assert.equal(planned,'B');assert.equal(anchor,8);
  assert.deepEqual(f.calls,['read','begin','lock','authorize','validate','createVersion','supersede','publishDraft','advanceDocument','event','read','commit']);
});
test('needs-changes and rejection permit blocking issues while approval still requires their resolution',async()=>{
  for(const decision of ['needs_changes','reject','approve']) {
    const f=fixture();await f.app.submitDraft({id:1},'',83,binding);
    let allowance;
    f.store.validateDraft=async(draft,context,options)=>{allowance=options.allowBlockingIssues;if(!allowance)throw Error('BLOCKING_ISSUES');};
    if(decision==='approve')await assert.rejects(f.app.decideReviewTask({id:2},decision,'',83,binding),/BLOCKING_ISSUES/);
    else await f.app.decideReviewTask({id:2},decision,'',83,binding);
    assert.equal(allowance,decision!=='approve');
    assert.equal(f.state().draft.status,decision==='needs_changes'?'needs_changes':decision==='reject'?'rejected':'submitted');
  }
});
function validationFixture() {
  const draft={id:1,schema_version:'process-governance-v8',revision_no:3,content_hash:'hash',department_id:91,document_id:4,process_content_json:'{"process":{"process_ref":"process_1"}}'};
  const context={promotion:{content_hash:'hash',preview_revision_no:3,preview_revision_id:8,preview_case_id:7,document_id:4,draft_id:1},
    previewCase:{id:7,status:'review_complete',current_revision_id:8,current_revision_no:3,current_content_hash:'hash',owning_department_id:91,process_ref:'process_1'},
    revision:{id:8,revision_no:3,content_hash:'hash'},document:{id:4,owning_department_id:91,process_ref:'process_1'}};
  const departments=[{id:91,name:'合成甲部'}];
  const dependencies={project:()=>({errors:[],blockingIssues:[],processRef:'process_1'}),hash:()=>'hash',unresolved:items=>items};
  return {draft,context,departments,dependencies};
}
test('locked-source computation is repeatable and preserves frozen inputs without DB or global configuration',()=>{
  const f=validationFixture(),before=structuredClone({draft:f.draft,context:f.context,departments:f.departments});
  function freeze(value){if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;}
  freeze(f.draft);freeze(f.context);freeze(f.departments);
  const run=()=>validateLockedDraft(f.draft,f.context,f.departments,f.dependencies);
  assert.deepEqual(run(),run());assert.deepEqual(f.draft,before.draft);assert.deepEqual(f.context,before.context);assert.deepEqual(f.departments,before.departments);
});
test('locked-source policy rejects mismatched promotion, content, scope and blocking items',()=>{
  for(const alter of [f=>{f.context.promotion.preview_revision_id=99;},f=>{f.dependencies.hash=()=>'changed';},f=>{f.context.document.owning_department_id=92;}]) {
    const f=validationFixture();alter(f);
    assert.throws(()=>validateLockedDraft(f.draft,f.context,f.departments,f.dependencies),{code:'V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH'});
  }
  const f=validationFixture();f.dependencies.project=()=>({errors:[],blockingIssues:[{code:'BLOCKED'}],processRef:'process_1'});
  assert.throws(()=>validateLockedDraft(f.draft,f.context,f.departments,f.dependencies));
  assert.doesNotThrow(()=>validateLockedDraft(f.draft,f.context,f.departments,f.dependencies,{allowBlockingIssues:true}));
  f.dependencies.project=()=>({errors:[{message:'invalid'}],blockingIssues:[]});
  assert.throws(()=>validateLockedDraft(f.draft,f.context,f.departments,f.dependencies),{code:'V7_FORMAL_CONTENT_INVALID'});
});
test('external editable-status mutation cannot modify the internal pure rule',()=>{
  EDITABLE_DRAFT_STATUSES.clear();EDITABLE_DRAFT_STATUSES.add('published');
  assert.equal(isEditableDraftStatus('draft'),true);assert.equal(isEditableDraftStatus('published'),false);
});
test('reset during asynchronous repository construction refuses the replaced instance and closes its pool once',async()=>{
  let finish,closed=0;
  const resource=createRepositoryResource({create:()=>({}),verify:async()=>{},build:()=>new Promise(resolve=>{finish=resolve;}),dispose:async()=>closed++});
  const first=resource.get();await new Promise(resolve=>setImmediate(resolve));
  const reset=resource.reset();finish({obsolete:true});
  await assert.rejects(first,/REPOSITORY_RESOURCE_REPLACED/);await reset;assert.equal(closed,1);
});
