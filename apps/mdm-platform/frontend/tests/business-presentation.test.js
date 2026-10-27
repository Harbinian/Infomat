import test from 'node:test';
import assert from 'node:assert/strict';
import {businessText,businessName,businessStatus,businessFieldLabel,internalField,businessLocation,publicationChoices,withdrawalGuidance,businessMaterialSource} from '../src/businessPresentation.js';
import {createApiClient} from '../src/api.js';

test('presentation rejects executable content and transport metadata while retaining business wording and numbers',()=>{
  for(const value of ['/api/process-design/versions','PROCESS_DRAFT_CONFLICT','12345678-abcd-4321-9876-123456789abc','a'.repeat(64),'{"schema_version":"v1"}','GET /anything','<script>alert(1)</script>'])assert.equal(businessText(value,'需核对'), '需核对');
  for(const value of ['请先核对采购订单，再保存本次意见。','GLTX-JY-27-A',0,'100001'])assert.equal(businessText(value),String(value));
  assert.equal(businessText(false),'否');assert.equal(businessStatus('unknown_state'),'状态待核对');
  assert.equal(businessFieldLabel('internalMachineKey'),'');assert.equal(businessFieldLabel('business_meaning'),'业务含义');
});
test('missing names never derive from identifiers; sensitive keys are hidden and business numbers remain',()=>{
  assert.equal(businessName({id:'900123',person_id:'900123',code:'unknown_code'}),'名称未记录');
  for(const key of ['person_id','content_hash','draft_revision_no','permission_code','source_ref','request_id'])assert.equal(internalField(key),true,key);
  for(const key of ['document_no','form_no','employee_no','definition'])assert.equal(internalField(key),false,key);
  assert.equal(businessLocation('behaviors[2].completion_standard'),'流程环节 → 完成标准');
});

test('workspace sources and internal positions have readable display while source records stay exact',()=>{
  const original={process:{process_name:'合成业务流程'},source_file_name:'authoring-workspace.json',position:'/data_objects/0/data_name'};
  const before=structuredClone(original);
  assert.equal(businessName(original),'合成业务流程');
  assert.equal(businessMaterialSource(original.source_file_name),'在3000编制并提交的流程材料');
  assert.equal(businessText(original.position,'请查看业务位置'),'请查看业务位置');
  assert.equal(businessText(original.source_file_name,'请查看材料来源'),'请查看材料来源');
  assert.deepEqual(original,before);
});
test('publication choices preserve exact large references, names and original historical records',()=>{
  const input=[{manifest:{items:[{target_kind:'field',target_id:'9007199254740999',target_version_ref:'version-exact',payload:{definition:{name:'资产原值',required:false}}}]}}];
  const before=structuredClone(input),choices=publicationChoices(input);
  assert.equal(choices.fields[0].value,'9007199254740999');assert.equal(choices.fieldVersions[0].value,'version-exact');assert.equal(choices.fields[0].name,'资产原值');assert.deepEqual(input,before);
});
test('withdrawal guidance names the reason, impact check, approval basis and separate execution step',()=>{
  assert.match(withdrawalGuidance({}),/填写撤回原因.*检查撤回影响/);
  assert.match(withdrawalGuidance({report:{},checkMatches:false}),/撤回原因已修改.*重新/);
  assert.match(withdrawalGuidance({report:{},checkMatches:true}),/批准依据及影响核对说明.*批准本次整单撤回/);
  assert.match(withdrawalGuidance({report:{},checkMatches:true,approvalMatches:true}),/可以执行撤回.*须重新检查并批准/);
  assert.match(withdrawalGuidance({stale:true}),/状态已变化.*填写的内容仍保留/);
});
test('lost write receipts remain uncertain without retrying or discarding the error identity',async()=>{
  let writes=0;
  const api=createApiClient({fetchImpl:async url=>url.includes('csrf')?new Response(JSON.stringify({csrfToken:'synthetic'}),{headers:{'Content-Type':'application/json'}}):(writes++,new Response(JSON.stringify({error:'SQL_ERROR /api/private',code:'SYNTHETIC_WRITE_UNKNOWN'}),{status:503,headers:{'Content-Type':'application/json'}}))});
  await assert.rejects(api.request('/api/synthetic/save',{method:'POST',body:{name:'原内容'}}),error=>error.resultUnknown===true&&error.code==='SYNTHETIC_WRITE_UNKNOWN'&&error.message.includes('结果尚未确认')&&!error.message.includes('/api'));
  assert.equal(writes,1);
});

test('typed internal object references are display gaps while Chinese business names remain intact',()=>{
 for(const value of ['合成适用范围：object:stable','field:stable:record_id','context:stable','lifecycle:record:event'])assert.equal(businessText(value,'请核对业务名称'),'请核对业务名称');
 assert.equal(businessText('对象：采购记录；字段：记录号'),'对象：采购记录；字段：记录号');
});
