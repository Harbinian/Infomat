import test from 'node:test';
import {termStateLabel,termDefinitionHeading} from '../src/terminologyGovernanceModel.js';
import assert from 'node:assert/strict';
test('availability status takes precedence over draft-workflow status and labels unapplied definitions explicitly',()=>{
  assert.equal(termStateLabel({adoption_status:'adopted',draft_status:'none',suspended:true}),'暂停使用，暂不可引用');
  assert.equal(termStateLabel({adoption_status:'adopted',source_kind:'gb',source_status:'withdrawn'}),'GB来源已废止，不供新材料引用');
  assert.equal(termStateLabel({adoption_status:'adopted',source_kind:'gbt',source_status:'superseded',usable:true}),'当前可引用');
  assert.equal(termStateLabel({adoption_status:'not_adopted',draft_status:'not_adopted'}),'不予采纳，未生效');
  assert.equal(termDefinitionHeading({adoption_status:'never_adopted'}),'未生效提报定义');
  assert.equal(termDefinitionHeading({adoption_status:'stopped'}),'历史采用定义');
  assert.equal(termDefinitionHeading({legacy_unverified:true}),'历史沿用定义（依据待核）');
});
import {actionsOf,canEditReferences,exactFailure,referenceItems,referencePayload,referencePositions,retainWriteFailure,termValues,updateEditableDraft} from '../src/terminologyGovernanceModel.js';

test('initial loading and fixed source snapshots do not fabricate input or discard the historical definition',()=>{
  assert.deepEqual(referencePositions(null),[]);assert.deepEqual(referenceItems(null),[]);
  const snapshot={term:'原固定名称',definition:'原固定定义'};
  assert.equal(referenceItems({items:[{location:'/name',term_snapshot:snapshot}]})[0].term_snapshot,snapshot);
});

test('standard source is read from the actual nested API projection and a pending revision stays distinct',()=>{
  const detail={term:'当前用词',definition:'当前定义',context:'保留语境',concept_key:'stable-concept',source_kind:'gbt',source:{standard_number:'GB/T 123',original_definition:'当前原文',company_application:'公司说明'},pending_version:{content:{term:'修订用词',definition:'修订定义',context:'保留语境',source_kind:'custom',standard_number:'',original_definition:''}}};
  const input=termValues(detail);
  assert.equal(input.term,'修订用词');assert.equal(input.concept_key,'stable-concept');assert.equal(input.standard_number,'');assert.equal(detail.definition,'当前定义');
  assert.equal(termValues({...detail,pending_version:null}).standard_number,'GB/T 123');
});

test('a duplicate or revision 409 preserves editable input while unknown outcomes preserve exact frozen request', () => {
  const original={values:{term:'同名术语'},request_id:'old',dirty:true};
  const conflict=retainWriteFailure(original,{status:409,code:'TERM_DUPLICATE'},{body:{term:'同名术语'}});
  assert.equal(conflict.uncertain,false);
  assert.equal(conflict.values.term,'同名术语');
  const edited=updateEditableDraft(conflict,{values:{term:'另一个语境'}},'new');
  assert.equal(edited.request_id,'new');
  assert.equal(original.values.term,'同名术语');
  const submitted={url:'/terms',method:'POST',body:{request_id:'old',term:'同名术语'}};
  const unknown=retainWriteFailure(original,{status:503},submitted);
  assert.equal(unknown.submitted,submitted);
  assert.equal(updateEditableDraft(unknown,{values:{term:'不得重放新内容'}},'new'),unknown);
});

test('source positions retain exact original wording and each manually confirmed meaning needs evidence', () => {
  const source='原始字段：<材料>；不得自动改名';
  const positions=referencePositions({source_positions:[{location:'data_objects[0].data_name',source_text:source}]});
  assert.equal(positions[0].source_text,source);
  const subject={target_type:'data_definition',target_id:'12'};
  const draft={source_digest:'fixed-digest',expected_revision:3,request_id:'same-request',items:[{location:positions[0].location,source_text:source,decision:'synonym',term_id:'7',version_id:'9',reason:'同一业务含义，待统一当前用词'}]};
  const before=JSON.stringify(draft);
  assert.equal(referencePayload(subject,draft).items[0].source_text,source);
  assert.equal(JSON.stringify(draft),before);
  assert.throws(()=>referencePayload(subject,{...draft,items:[{...draft.items[0],version_id:''}]}),/固定定义版本/);
  assert.throws(()=>referencePayload(subject,{...draft,items:[{...draft.items[0],reason:''}]}),/依据/);
});

test('unlisted can continue with explicit meaning confirmation without fabricating a term binding', () => {
  const payload=referencePayload({target_type:'process_draft',target_id:'2'},{source_digest:'digest',expected_revision:0,request_id:'id',items:[{location:'process.name',source_text:'业务现用词',decision:'unlisted',reason:'业务负责人确认含义，无适用生效词条',term_id:'old',version_id:'old'}]});
  assert.equal(payload.items[0].term_id,null);
  assert.equal(payload.items[0].version_id,null);
  assert.throws(()=>referencePayload({target_type:'process_draft',target_id:'2'},{...payload,items:[payload.items[0],payload.items[0]]}),/同一位置/);
});

test('fixed formal references stay read only and frontend consumes server actions without inferring roles', () => {
  assert.deepEqual(actionsOf({allowed_actions:['save_usages',{action:'challenge'}]}),['save_usages','challenge']);
  assert.equal(canEditReferences({allowed_actions:['save_usages'],fixed:true}),false);
  assert.equal(canEditReferences({allowed_actions:[],user:{role:'mdm_lead'}}),false);
  assert.equal(canEditReferences({allowed_actions:['save_usages']}),true);
  assert.equal(exactFailure({status:409,code:'TERM_CONTEXT_EXISTS',serverMessage:'此语境已有同义条目'}),'此语境已有同义条目');
});
