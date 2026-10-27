import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffOwner} from '../src/dataMapHandoffRequest.js';
import {sameHandoffPersonAccountDepartment,verifyHandoffDraftRecovery} from '../src/handoffDraftRecovery.js';
const user={personId:'83',accountId:'183',departmentId:'91',authVersion:'1'};
const draft={owner:handoffOwner(user),selection:{kind:'fact',id:'original-fact'},values:{answer:'原输入'},sourceKey:'original-source',request:{request_id:'original-request',phase:'awaiting_receipt',body:{request_id:'original-request',expected_revision:1}}};
const next=handoffOwner({...user,authVersion:'3'});

test('authorization renewal requires the same exact person, account and department; malformed and different owners stay isolated',()=>{
  assert(sameHandoffPersonAccountDepartment(draft,next));
  for(const key of ['personId','accountId','departmentId'])assert.equal(sameHandoffPersonAccountDepartment(draft,handoffOwner({...user,[key]:'other'})),false);
  assert.equal(sameHandoffPersonAccountDepartment({owner:'invalid'},next),false);
});
test('explicit recovery only reads current exact scope and retains original request, input and source without replay',async()=>{
  const calls=[],before=structuredClone(draft),api={request:async(...args)=>{calls.push(args);return args[0]==='/api/org/me'?{...user,authVersion:'3'}:args[0].includes('/requests/')?{request_id:'original-request',state:'not_observed'}:{};}};
  const recovered=await verifyHandoffDraftRecovery(api,draft,next);
  assert.equal(recovered.owner,next);assert.deepEqual(recovered.values,draft.values);assert.deepEqual(recovered.request.body,draft.request.body);assert.equal(recovered.request.phase,'not_observed');assert.equal(recovered.sourceKey,draft.sourceKey);
  assert.deepEqual(calls.map(([url,options])=>({url,method:options.method||'GET'})),[{url:'/api/org/me',method:'GET'},{url:'/api/data-map-handoffs/workbench',method:'GET'},{url:'/api/data-map-handoffs/facts/original-fact/current',method:'GET'},{url:'/api/data-map-handoffs/requests/original-request',method:'GET'}]);assert.deepEqual(draft,before);
});
test('denied scoped read, changed identity or aborted verification cannot recover or mutate retained input',async()=>{
  const before=structuredClone(draft),api={request:async url=>{if(url.includes('/facts/'))throw Object.assign(new Error('拒绝'),{status:403});return url==='/api/org/me'?{...user,authVersion:'3'}:{};}};
  await assert.rejects(verifyHandoffDraftRecovery(api,draft,next),/拒绝/);
  await assert.rejects(verifyHandoffDraftRecovery(api,draft,handoffOwner({...user,personId:'other'})),/原人员/);
  const controller=new AbortController();controller.abort();await assert.rejects(verifyHandoffDraftRecovery(api,draft,next,{signal:controller.signal}));assert.deepEqual(draft,before);
});
test('a previously retryable request needs a new receipt; a committed receipt blocks replay after recovery',async()=>{
  const retained={...draft,request:{...draft.request,phase:'retryable'}},api={request:async url=>url==='/api/org/me'?{...user,authVersion:'3'}:url.includes('/requests/')?{request_id:'original-request',state:'committed',result:{request_id:'original-request',business_outcome:'fact_answered'}}:{}};
  const recovered=await verifyHandoffDraftRecovery(api,retained,next);assert.equal(recovered.request.phase,'committed');assert.equal(retained.request.phase,'retryable');assert.deepEqual(recovered.request.body,retained.request.body);
  await assert.rejects(verifyHandoffDraftRecovery({request:async()=>({...user,authVersion:'4'})},draft,next),/身份已变化/);
});
