import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeWrite, tracksNativeRequest, beginNativeRequest, requestUnresolved, canRetryNativeRequest, editNativeDraft, observeNativeReceipt, nativeSuccessText, nativeDraftForOwner, nativeDraftBlocked} from '../src/nativeGovernanceRequest.js';

const uuid = '11111111-1111-4111-8111-111111111111', nextUuid = '22222222-2222-4222-8222-222222222222';
const draft = (kind = 'complete') => ({kind, packageId:'9007199254741003', detailId:'9007199254741005', factId:'9007199254741007', expected_revision:3,
  versionId:'9007199254741009', department:'9007199254741011', target:'9007199254741013', status:'confirmed', conclusion:' 原结论 ', unified:'OBJECT_A', basis:' 原审核依据 ', question:' 问题 ', reason:' 原因 ', answer:' 答复 ', evidence:' 表单第1页 ', factType:'source_evidence'});

test('all six native writes use exact resource IDs, their own UUID and original revision', () => {
  for (const kind of ['generate','decide','ask','answer','close','complete']) {
    assert(tracksNativeRequest(kind)); const write = nativeWrite(draft(kind), uuid);
    assert.equal(write.body.request_id, uuid); assert.equal(write.body.expected_revision,3);
    assert(!JSON.stringify(write).includes('9007199254741004'));
  }
  const decision=nativeWrite(draft('decide'),uuid), question=nativeWrite(draft('ask'),uuid);
  assert.equal(decision.method,'PATCH'); assert.equal(decision.body.responsible_department_id,'9007199254741011');
  assert.equal(question.body.detail_id,'9007199254741005'); assert.equal(question.body.target_department_id,'9007199254741013');
  assert.equal(nativeWrite(draft('complete'),uuid).body.basis,'原审核依据');
  assert.equal(nativeWrite(draft('create')).body.process_version_id,'9007199254741009');
  assert(!tracksNativeRequest('create'));
});

test('first attempt freezes its payload before transport and rejects editing while outcome is unknown', () => {
  const original=draft(), attempt=beginNativeRequest(original,()=>uuid);
  assert.equal(original.request,undefined); assert.equal(attempt.request.body.basis,'原审核依据');
  assert(requestUnresolved(attempt)); assert(!canRetryNativeRequest(attempt));
  assert.equal(editNativeDraft(attempt,'basis','changed'),attempt);
  assert.throws(()=>beginNativeRequest(attempt,()=>nextUuid),/回执/);
});

test('in-progress receipt cannot enable a write, and observation itself never creates a new UUID', () => {
  const pending=beginNativeRequest(draft(),()=>uuid);
  const observed=observeNativeReceipt(pending,{request_id:uuid,state:'in_progress'});
  assert(!canRetryNativeRequest(observed)); assert.equal(observed.request.request_id,uuid);
  assert.throws(()=>beginNativeRequest(observed,()=>nextUuid),/回执/);
});

test('prepared and not-observed receipts retry the exact original payload and UUID', () => {
  const attempt=beginNativeRequest(draft(),()=>uuid);
  for (const receipt of [{state:'prepared',observation:'retryable'},{state:'not_observed'}]) {
    const observed=observeNativeReceipt(attempt,{request_id:uuid,...receipt}); assert(canRetryNativeRequest(observed));
    const retry=beginNativeRequest({...observed,basis:'must never replace the frozen payload'},()=>{throw Error('new UUID must not be used');});
    assert.deepEqual(retry.request.body,attempt.request.body); assert.equal(retry.request.request_id,uuid);
    assert.equal(retry.request.phase,'awaiting_receipt');
  }
});

test('terminal rejection preserves visible input and permits a deliberate new request', () => {
  const attempt=beginNativeRequest(draft(),()=>uuid);
  const rejected=observeNativeReceipt(attempt,{request_id:uuid,state:'rejected',result:{code:'REVISION_CHANGED'}});
  assert.equal(rejected.basis,attempt.basis); assert(!requestUnresolved(rejected));
  const edited=editNativeDraft(rejected,'basis','明确的新依据'); assert.equal(edited.request,null);
  const next=beginNativeRequest(edited,()=>nextUuid); assert.equal(next.request.request_id,nextUuid); assert.equal(next.request.body.basis,'明确的新依据');
});

test('committed receipt retains input until explicit acknowledgement; it does not permit resubmission', () => {
  const attempt=beginNativeRequest(draft(),()=>uuid), result={request_id:uuid,business_outcome:'native_review_bound_pending_generation'};
  const observed=observeNativeReceipt(attempt,{request_id:uuid,state:'committed',result});
  assert.equal(observed.basis,attempt.basis); assert.equal(observed.request.phase,'committed'); assert.equal(observed.request.result,result);
  assert(requestUnresolved(observed)); assert(!canRetryNativeRequest(observed)); assert.match(nativeSuccessText(result),/地图尚未发布/);
});

test('mismatched, incomplete and unknown receipts fail closed without changing the original draft', () => {
  const attempt=beginNativeRequest(draft(),()=>uuid);
  for (const receipt of [{request_id:nextUuid,state:'committed',result:{request_id:nextUuid}},
    {request_id:uuid,state:'committed',result:{}},{request_id:uuid,state:'prepared'},
    {request_id:uuid,state:'unexpected'},{request_id:uuid,state:'committed',result:{request_id:nextUuid}}]) {
    assert.throws(()=>observeNativeReceipt(attempt,receipt)); assert.equal(attempt.request.phase,'awaiting_receipt');
  }
});

test('invalid request identity prevents transport preparation and leaves input untouched', () => {
  const input=draft(); assert.throws(()=>beginNativeRequest(input,()=>'')); assert.equal(input.request,undefined);
});

test('another login or changed department cannot discard, expose or replace an unresolved request', () => {
  for (const phase of ['awaiting_receipt','retryable','in_progress','not_observed','committed']) {
    const pending={...beginNativeRequest(draft(),()=>uuid),owner:'11:91'}; pending.request.phase=phase;
    assert.equal(nativeDraftForOwner(pending,'11:91'),pending); assert(!nativeDraftBlocked(pending,'11:91'));
    for (const owner of ['11:92','12:91']) {
      assert.equal(nativeDraftForOwner(pending,owner),pending); assert(nativeDraftBlocked(pending,owner));
    }
  }
  assert.equal(nativeDraftForOwner({...draft(),owner:'11:91'},'12:91'),null);
  assert(!nativeDraftBlocked(null,'12:91'));
});
