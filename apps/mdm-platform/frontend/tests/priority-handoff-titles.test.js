import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handoffWorkItemPresentation,loadWorkbenchReviewPresentation,currentWorkbenchSnapshot} from '../src/workbenchReviewPresentation.js';

const item=()=>({id:'synthetic-only',type:'data_map_handoff_draft',sourceType:'data_map_handoff',package_id:'9007199254740993',target:'/app/data-map-handoffs?handoff=synthetic',title:'继续编制并核对承接草案：工作包 9007199254740993',actionLabel:'继续编制并核对承接草案',canAct:true});
test('authorized exact package title replaces internal ordinal without changing the target or source',()=>{
  const row=item(),context={packages:[{package_id:'9007199254740992',document_title:'另一来源'},{package_id:row.package_id,document_title:'合成申请核对流程'}]},before=structuredClone({row,context});
  const shown=handoffWorkItemPresentation(row,context);
  assert.equal(shown.title,'继续编制并核对承接草案：合成申请核对流程');
  assert.equal(shown.target,row.target);assert.equal(shown.package_id,row.package_id);assert.deepEqual({row,context},before);
});
test('missing or ambiguous authorized titles retain a visible gap and never guess by order',()=>{
  for(const context of [null,{packages:[{package_id:'other',document_title:'不得借用'}]},{packages:[{package_id:item().package_id,document_title:'甲'},{package_id:item().package_id,document_title:'乙'}]}]){
    const result=handoffWorkItemPresentation(item(),context);
    assert.match(result.title,/来源名称尚未读取/);assert.doesNotMatch(result.title,/9007199254740993|不得借用|：甲|：乙/);
  }
  const plain={type:'v7_review',title:'原业务事项'};assert.equal(handoffWorkItemPresentation(plain,{}),plain);
});
test('the same read projection names priority and full entries without changing the aggregate count',async()=>{
  const row=item(),data={summary:{actionableCount:1},workItems:[row],nextActions:[{title:row.title,target:row.target,actionLabel:row.actionLabel}],roles:[]},before=structuredClone(data),calls=[];
  const api={request:async url=>{calls.push(url);if(url==='/api/data-map-handoffs/workbench')return {packages:[{package_id:row.package_id,document_title:'合成固定来源流程'}]};return {enabled:true};}};
  const shown=await loadWorkbenchReviewPresentation(api,data);
  assert.equal(shown.nextActions[0].title,shown.workItems[0].title);assert.match(shown.workItems[0].title,/合成固定来源流程/);
  assert.equal(currentWorkbenchSnapshot(shown).count,1);assert.deepEqual(data,before);assert.equal(calls.filter(url=>url==='/api/data-map-handoffs/workbench').length,1);
});
