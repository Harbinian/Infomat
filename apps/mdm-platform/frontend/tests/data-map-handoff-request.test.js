import test from 'node:test';
import assert from 'node:assert/strict';
import {editHandoffDraft,freezeHandoffRequest,handoffActionAllowed,handoffCanRetry,handoffDraftBlocked,handoffDraftForOwner,handoffEditLines,handoffOwner,handoffRequestUnresolved,handoffResultMatchesResource,normalizeHandoffSnapshot,observeHandoffReceipt,sourceKeyForHandoff} from '../src/dataMapHandoffRequest.js';
const id='f8784870-4f68-48de-aaf7-32998cf285a5';
const owner=handoffOwner({personId:'1',accountId:'2',authVersion:'3',departmentId:'4'});
const draft=()=>({owner,kind:'edit',sourceKey:'fixed',values:{basis:'原输入'},dirty:true,request:null});
const write={url:'/api/data-map-handoffs/abc/draft',method:'PATCH',body:{expected_revision:2,draft:{scope_mode:'current',items:[],dispositions:[],impact_dispositions:[],basis:'依据'}}};
test('identity isolates person, account, auth version and department without exposing another draft',()=>{
  const d=draft();assert.equal(handoffDraftForOwner(d,owner),d);assert.equal(handoffDraftForOwner(d,'other'),null);assert.equal(handoffDraftBlocked(d,'other'),true);
  for(const key of ['personId','accountId','authVersion','departmentId'])assert.notEqual(handoffOwner({...{personId:'1',accountId:'2',authVersion:'3',departmentId:'4'},[key]:'99'}),owner);
});
test('freeze captures exact UUID and payload once; edit and blind retry are blocked',()=>{
  const d=freezeHandoffRequest(draft(),write,()=>id);assert.equal(d.request.request_id,id);assert.equal(d.request.body.expected_revision,2);assert.equal(handoffRequestUnresolved(d),true);
  assert.equal(editHandoffDraft(d,'basis','replacement'),d);assert.throws(()=>freezeHandoffRequest(d,write),/回执/);
  write.body.draft.basis='later';assert.equal(d.request.body.draft.basis,'依据');write.body.draft.basis='依据';
});
test('unknown/not observed and retryable preserve original request despite newer input or source',()=>{
  const d=freezeHandoffRequest(draft(),write,()=>id),pending=observeHandoffReceipt(d,{request_id:id,state:'not_observed'});assert.equal(handoffCanRetry(pending),true);
  const retry=freezeHandoffRequest(pending,{url:'wrong',body:{expected_revision:999}},()=>{throw Error('must not allocate');});assert.deepEqual(retry.request.body,d.request.body);assert.equal(retry.request.url,d.request.url);
  assert.equal(observeHandoffReceipt(d,{request_id:id,state:'prepared',observation:'retryable'}).request.phase,'retryable');
  assert.equal(observeHandoffReceipt(d,{request_id:id,state:'prepared'}).request.phase,'in_progress');
});
test('receipt rejects mismatched identifiers and unproven committed result',()=>{
  const d=freezeHandoffRequest(draft(),write,()=>id);assert.throws(()=>observeHandoffReceipt(d,{request_id:'wrong',state:'committed'}));assert.throws(()=>observeHandoffReceipt(d,{request_id:id,state:'committed',result:{}}));
  const committed=observeHandoffReceipt(d,{request_id:id,state:'committed',result:{request_id:id,business_outcome:'draft_saved'}});assert.equal(handoffRequestUnresolved(committed),true);assert.deepEqual(committed.values,d.values);
});
test('rejected requests unlock editing, with new submission and original input retained',()=>{
  const d=observeHandoffReceipt(freezeHandoffRequest(draft(),write,()=>id),{request_id:id,state:'rejected',result:{code:'HANDOFF_REVISION_CONFLICT'}});assert.equal(handoffRequestUnresolved(d),false);
  const revised=editHandoffDraft(d,'basis','新依据');assert.equal(revised.values.basis,'新依据');assert.equal(revised.request,null);
});
test('source stamp tracks independent conflict/fact revisions and accurate answer/binding',()=>{
  const s={kind:'fact',id:'a'},r={revision:2,snapshot_digest:'answer',expected_conflict_revision:3,expected_handoff_revision:4,binding_id:'binding'};
  for(const key of ['revision','snapshot_digest','expected_conflict_revision','expected_handoff_revision','binding_id'])assert.notEqual(sourceKeyForHandoff(s,r),sourceKeyForHandoff(s,{...r,[key]:'changed'}));
});
test('line entry retains unfinished new line and normalization preserves typed definitions and composite groups',()=>{
  assert.deepEqual(handoffEditLines('first\n'),['first','']);
  const body={items:[{source_detail_refs:[' detail ',''],evidence_refs:['evidence',''],authority:[{evidence_refs:[' a ','']}],definition:{enum_values:[false,0,''],operations:[' read ',''],unique_identifiers:[{kind:'composite',field_item_refs:['f1','f2'],basis:'proof',extension:{unknown:true}}]}}],impact_dispositions:[{evidence_refs:[' trace ','']}]};
  const next=normalizeHandoffSnapshot(body);assert.deepEqual(next.items[0].source_detail_refs,['detail']);assert.deepEqual(next.items[0].definition.enum_values,[false,0,'']);assert.deepEqual(next.items[0].definition.unique_identifiers,body.items[0].definition.unique_identifiers);assert.equal(body.items[0].source_detail_refs[0],' detail ');
});
test('acknowledging own committed request never absorbs a later external revision or confirmation',()=>{
  const selection={kind:'handoff',id:'h'},resource={header:{handoff_id:'h',current_revision:3},revision:{content_digest:'mine',binding_id:'b'}},result={handoff_id:'h',revision:3,content_digest:'mine',binding_id:'b'};
  assert.equal(handoffResultMatchesResource(selection,resource,result),true);assert.equal(handoffResultMatchesResource(selection,{...resource,header:{...resource.header,current_revision:4}},result),false);
  assert.equal(handoffResultMatchesResource(selection,{...resource,revision:{...resource.revision,content_digest:'other'}},result),false);
  const fact={fact_id:'f',revision:2,parent_kind:'handoff_conflict',expected_conflict_revision:4,expected_handoff_revision:6},saved={fact_id:'f',revision:2,conflict_revision:4,handoff_revision:6};
  assert.equal(handoffResultMatchesResource({kind:'fact'},fact,saved),true);assert.equal(handoffResultMatchesResource({kind:'fact'},{...fact,expected_conflict_revision:5},saved),false);
});
test('existing input uses latest exact package/resource actions, including global readonly revocation',()=>{
  const capabilities={enabled:true,read_only:false,schema_ready:true,cutover_state:'controlled'},policy={capabilities,selection:{kind:'handoff'},resource:{allowed_actions:['read','save','create_conflict','source_upgrade_assessment']},packageActions:['prepare']};
  for(const kind of ['edit','conflict_open','upgrade_assessment'])assert.equal(handoffActionAllowed({...policy,kind}),true);
  assert.equal(handoffActionAllowed({...policy,kind:'edit',resource:{allowed_actions:['read']}}),false);
  for(const change of [{enabled:false},{read_only:true},{schema_ready:false},{cutover_state:'uncontrolled'}])assert.equal(handoffActionAllowed({...policy,kind:'edit',capabilities:{...capabilities,...change}}),false);
  const pkg={...policy,selection:{kind:'package'},resource:{allowed_actions:['read']}};
  assert.equal(handoffActionAllowed({...pkg,kind:'create_handoff'}),true);assert.equal(handoffActionAllowed({...pkg,kind:'review_intake'}),false);
  assert.equal(handoffActionAllowed({...pkg,kind:'review_intake',packageActions:['review']}),true);assert.equal(handoffActionAllowed({...pkg,kind:'create_handoff',packageActions:[]}),false);
});
test('conflict/fact/publication action changes deny only exact writes while readonly receipts stay independent',()=>{
  const capabilities={enabled:true,read_only:false,schema_ready:true,cutover_state:'controlled'},base={capabilities};
  assert.equal(handoffActionAllowed({...base,kind:'conflict_verify',selection:{kind:'conflict'},resource:{allowed_actions:['read','verify']}}),true);
  assert.equal(handoffActionAllowed({...base,kind:'conflict_verify',selection:{kind:'conflict'},resource:{allowed_actions:['read','open_fact']}}),false);
  assert.equal(handoffActionAllowed({...base,kind:'fact_confirm',selection:{kind:'fact'},resource:{allowed_actions:['read','answer']}}),false);
  const pub={...base,kind:'publication_withdraw',selection:{kind:'publication'},resource:{allowed_actions:['read','withdrawal_checks']}};
  assert.equal(handoffActionAllowed(pub),true);assert.equal(handoffActionAllowed({...pub,write:{url:'/api/data-map-handoffs/publications/p/withdrawal-checks'}}),true);
  assert.equal(handoffActionAllowed({...pub,write:{url:'/api/data-map-handoffs/publications/p/withdrawal-approvals'}}),false);
  assert.equal(handoffActionAllowed({...pub,write:{url:'/api/data-map-handoffs/publications/p/withdraw'}}),false);
  assert.equal(handoffActionAllowed({...pub,kind:'publication_restore'}),false);
  const frozen=freezeHandoffRequest(draft(),write,()=>id);assert.equal(observeHandoffReceipt(frozen,{request_id:id,state:'committed',result:{request_id:id}}).request.phase,'committed');
});
