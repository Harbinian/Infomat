import test from 'node:test';
import assert from 'node:assert/strict';
import {governanceDetailName,governanceDetailType,handoffRequestNotice,handoffOperationName,historicalGovernanceActor,bindingDetailDisplay,handoffSourceBinding,readableGovernanceValue,canReadDataMap,tracePublications,restorationLinkName} from '../src/handoffGovernancePresentation.js';
import {handoffDraftEntryName} from '../src/handoffPublicationPresentation.js';
import {handoffReviewBindingSelection} from '../src/handoffGovernancePresentation.js';
import {freezeHandoffRequest} from '../src/dataMapHandoffRequest.js';

test('data use labels distinguish object, business action and actual operation without displaying references',()=>{
  const shared={detail_type:'data_flow',source:{data_name:'申请记录',behavior_ref:'INTERNAL_1'}};
  const a=governanceDetailName({...shared,source:{...shared.source,behavior_name:'填写申请',operations:['create']}});
  const b=governanceDetailName({...shared,source:{...shared.source,behavior_name:'核对申请',operations:['use']}});
  assert.equal(a,'申请记录 / 填写申请 / 创建');assert.equal(b,'申请记录 / 核对申请 / 使用');assert.notEqual(a,b);assert(!a.includes('INTERNAL_1'));
});
test('item operations are distinct from publication status and unknown machine values never render',()=>{
  assert.equal(handoffOperationName('context_link'),'登记数据使用范围');assert.equal(handoffOperationName('rule'),'建立生命周期规则');assert.equal(handoffOperationName('authority'),'记录来源权威关系');
  assert(!handoffOperationName('INTERNAL_OP').includes('INTERNAL_OP'));
  const source={operation:'context_link',definition:{operation:'record'},created_at:'2026-10-22T00:00:00Z',actor:{person_id:'123',role_code:'mdm_lead'}};
  const before=structuredClone(source),display=readableGovernanceValue(source);assert.equal(display.operation,'登记数据使用范围');assert.equal(display.definition.operation,'登记记录');assert.match(display.created_at,/08:00:00（北京时间）/);assert.deepEqual(source,before);
});
test('historical names use only captured fields and disclose missing history; current people are never consulted',()=>{
  assert.match(historicalGovernanceActor({person_id:11,role_code:'department_mdm_reviewer'}),/原记录未留存姓名.*部门负责人/);
  assert.equal(historicalGovernanceActor({person_name:'当时姓名',person_id:11}),'当时姓名');assert(!historicalGovernanceActor({person_id:11,role_code:'UNKNOWN'}).includes('UNKNOWN'));
  assert.match(historicalGovernanceActor({person_name:'接入登记人',recorded_as:'capturing_actor_not_original_historical_author'}),/不代表原历史办理人/);
});
test('binding sidecar maps exact detail version without mutating immutable evidence or guessing from list order',()=>{
  const binding={snapshot_json:{detail_versions:[{detail_version_id:'v2',detail_ref:'r',detail_type:'critical_field'}]}},before=structuredClone(binding);
  const list=bindingDetailDisplay({detail_sources:[{detail_version_id:'v1',source:{data_name:'错误对象'}},{detail_version_id:'v2',source:{data_name:'准确对象',field_name:'申请号'}}]},binding);
  assert.equal(governanceDetailName(list[0]),'准确对象 / 申请号');assert.deepEqual(binding,before);
});
test('an unavailable explicit binding never falls back to another review or a guessed latest list item',()=>{
  const old={binding_id:'old'},current={binding_id:'current'},trace={bindings:[old,current]};
  assert.equal(handoffSourceBinding(trace,{revision:{binding_id:'old'},binding_id:'current'}),old);
  assert.equal(handoffSourceBinding(trace,{binding_id:'current'}),current);
  assert.equal(handoffSourceBinding(trace,{revision:{binding_id:'missing'},binding_id:'current'}),null);
  assert.equal(handoffSourceBinding(trace,{}),null);
});
test('original and restoration drafts are resolved by exact publication relation, independent of list order',()=>{
  const trace={publications:[{publication_id:'new',handoff_revision_id:'r-new',manifest_json:{restores_publication_id:'old'}},{publication_id:'old',handoff_revision_id:'r-old',manifest_json:{}}],publication_events:[{publication_id:'old',event_type:'withdrawn'}]};
  const publications=tracePublications(trace),refs=[{handoff_id:'h-old',publication_id:'old'},{handoff_id:'h-new',publication_id:'new'}];
  assert.equal(handoffDraftEntryName({handoff_id:'h-old'},refs,publications),'原草案 · 对应发布已撤回');assert.equal(handoffDraftEntryName({handoff_id:'h-new'},refs,publications),'恢复草案 · 对应发布已发布');
  assert.match(restorationLinkName({process_name:'申请流程',edition:'A',publication_id:'new',current_handoff_state:'published',publication_state:'withdrawn'}),/申请流程 · A版 · 恢复后发布内容 · 已撤回/);
});
test('global map entry follows existing map permissions, without promoting package assignment',()=>{
  assert.equal(canReadDataMap({permissions:['governance:read-assigned-context']}),false);assert.equal(canReadDataMap({permissions:['governance:read-global']}),true);assert.equal(canReadDataMap({departmentId:91,permissions:['governance:read-department']}),true);
});
test('same-name object identity and lifecycle sources have distinct business type labels without changing the stored rows',()=>{
  const object={detail_type:'data_object_identity',detail_ref:'INTERNAL_OBJECT',source:{data_name:'申请记录'}},lifecycle={detail_type:'lifecycle_rule',detail_ref:'INTERNAL_LIFECYCLE',source:{data_name:'申请记录'}};
  const before=structuredClone([object,lifecycle]);
  assert.equal(governanceDetailName(object),'数据对象识别：申请记录');
  assert.equal(governanceDetailName(lifecycle),'数据生命周期规则：申请记录');
  assert.notEqual(governanceDetailName(object),governanceDetailName(lifecycle));
  assert.deepEqual([object,lifecycle],before);
  assert(!governanceDetailName({...object,source:{data_name:'/api/synthetic'}}).includes('/api/'));
  assert(!governanceDetailName({...object,source:{}}).includes('INTERNAL_OBJECT'));
  assert.equal(governanceDetailType('constructor'),'治理明细');
});
test('request contract failures are explained at the display boundary without exposing identifiers or changing error objects',()=>{
  const error={message:'成功回执缺少原请求标识。',request_id:'INTERNAL_REQUEST'},before=structuredClone(error);
  assert.equal(handoffRequestNotice(error),'返回结果尚不能与本次办理对应，请核对办理结果；当前输入保持不变。');
  assert(!handoffRequestNotice({message:'无法生成请求标识，请保留本次输入。'}).includes('标识'));
  assert(!handoffRequestNotice({message:'/api/internal'}).includes('/api/'));
  assert.equal(typeof handoffRequestNotice({message:'constructor'}),'string');
  assert.deepEqual(error,before);
});

test('review selection keeps the exact stored choice and frozen request while labels use only the authorized source and review time',()=>{
  const older='ba32015d-a590-4b39-af70-8c89226fa391',newer='64db4cba-d1b1-438b-b197-37a02b00fdc2',unavailable='c2c341ce-1547-468e-85d0-bd852a1988aa';
  const trace={source:{process_name:'合成入库流程',edition:'A'},bindings:[{binding_id:newer,created_at:'2026-10-22T03:00:00Z'},{binding_id:older,created_at:'2026-10-21T02:00:00Z'}]};
  const draft={kind:'rebase',values:{binding_id:older,basis:'沿用已核对的材料'}};
  const frozen=freezeHandoffRequest(draft,{url:'/api/data-map-handoffs/draft/rebase',body:{expected_revision:2,binding_id:older,basis:draft.values.basis,draft:{items:[]}}},()=> '07ba01d0-e33f-4adc-a296-8bd2e6880c32');
  const before=structuredClone({trace,draft,frozen});
  const known=handoffReviewBindingSelection(trace,frozen.values.binding_id);
  assert.equal(known.value,older);assert.equal(known.unavailable,false);
  assert.equal(known.items[1].binding_id,older);assert.equal(known.items[0].binding_id,newer);
  assert.equal(known.items[1].label,'合成入库流程 · A版 · 2026-10-21 10:00:00（北京时间）');
  const missing=handoffReviewBindingSelection(trace,unavailable);
  assert.equal(missing.value,unavailable);assert.equal(missing.unavailable,true);
  assert.equal(handoffReviewBindingSelection(trace,'').value,'');
  assert.equal(handoffReviewBindingSelection(trace,'').unavailable,false);
  assert.deepEqual(handoffReviewBindingSelection(null,older),{value:older,items:[],unavailable:true});
  for(const row of known.items)assert(!/[0-9a-f]{8}-[0-9a-f-]{27}/i.test(row.label));
  assert.deepEqual({trace,draft,frozen},before);assert.equal(frozen.request.body.binding_id,older);
});
