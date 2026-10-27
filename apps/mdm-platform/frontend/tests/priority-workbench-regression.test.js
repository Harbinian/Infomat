import test from 'node:test';
import assert from 'node:assert/strict';
import {currentWorkbenchSnapshot,loadWorkbenchReviewPresentation,scopeItemPresentation} from '../src/workbenchReviewPresentation.js';

const scopeItem = () => ({id:'v7_scope:9007199254740993',type:'v7_scope',governanceType:'v7_scope',caseId:'9007199254740993',revisionNo:2,contentHash:'fixed-synthetic-content',title:'核对归口与范围依据：合成范围核对流程',actionLabel:'核对归口与范围依据',nextStep:'核对归口与范围依据',sample:'案例 CASE_SYNTHETIC_INTERNAL_001，当前修订2。原始完整检查记录保持',target:'/app/process-preview?case=9007199254740993',sourceRoles:['mdm_lead'],roleHint:'mdm_lead',requiredPermissions:['governance:assign-work'],canAct:true});
const scopeDetail = () => ({case:{id:'9007199254740993',current_revision_no:2,current_content_hash:'fixed-synthetic-content',owning_department_id:'91',process_name:'合成范围核对流程'},allowed_actions:['record_scope_decision'],blocking_issues:[{code:'ZERO_CROSS_DEPARTMENT_SCOPE_PENDING'}],governance:{submission:{missing:['sources']},blocking_issues:[]}});
const projected = row => ({title:row.title,actionLabel:row.actionLabel,sample:row.sample,target:row.target,roleCode:'mdm_lead',sourceRoles:row.sourceRoles});

test('legacy scope entries point to historical reading without advertising rejected shortcuts or exposing source identifiers',()=>{
  const row=scopeItem(),detail=scopeDetail(),before=structuredClone({row,detail});
  const display=scopeItemPresentation(row,detail);
  assert.equal(display.nextStep,'查看本流程归口与参与范围');
  assert.match(display.handlingGuide.operation,/已经停用/);
  assert.doesNotMatch(display.handlingGuide.operation,/点击“记录范围决定”|点击“分派归口部门”/);
  assert.match(display.handlingGuide.result,/责任与历史/);
  assert.equal(display.handlingGuide.actor,'按当前事项显示的有权人员办理');
  assert.match(display.handlingGuide.handoff,/主对接人补齐/);
  assert(!display.sample.includes('CASE_SYNTHETIC_INTERNAL_001'));
  assert(!display.sample.includes(row.caseId));
  assert.equal(display.target,row.target);
  assert.equal(display.caseId,row.caseId);
  assert.equal(display.contentHash,row.contentHash);
  assert.deepEqual({row,detail},before);
});

test('old owner metadata stays read-only and never invents an action or named person',()=>{
  const detail=scopeDetail(); detail.case.owning_department_id=null;detail.allowed_actions=['assign_owner'];
  const display=scopeItemPresentation(scopeItem(),detail);
  assert.equal(display.nextStep,'查看本流程归口与参与范围');
  assert.doesNotMatch(display.handlingGuide.operation,/点击“分派归口部门”/);
  assert(!JSON.stringify(display.handlingGuide).includes('责任人信息未随事项返回'));
});

test('changed case, revision, content or revoked action yields a read-only guide instead of a stale save instruction',()=>{
  const row=scopeItem();
  for(const update of [detail=>{detail.case.id='2';},detail=>{detail.case.current_revision_no=3;},detail=>{detail.case.current_content_hash='changed';},detail=>{detail.allowed_actions=[];}]){
    const detail=scopeDetail();update(detail);
    const guide=scopeItemPresentation(row,detail);
    assert.equal(guide.nextStep,'查看本流程归口与参与范围');
    assert(!guide.handlingGuide.operation.includes('点击“记录范围决定”'));
    assert(!guide.handlingGuide.operation.includes('填写依据后保存'));
    assert.equal(guide.target,row.target);
  }
  assert.equal(scopeItemPresentation(row,null).nextStep,'查看本流程归口与参与范围');
  const other={type:'unrelated',sample:'保持原说明'};assert.equal(scopeItemPresentation(other,scopeDetail()),other);
});

test('todo and full workbench projections share one authorized exact lookup and do not mutate records or count guidance',async()=>{
  for(const mode of ['todo','all']){
    const row=scopeItem(),action=projected(row),data={mode,summary:{actionableCount:1,pendingTodos:99},nextActions:[action],workItems:[row,...(mode==='all'?[{id:'guide:mdm_lead',type:'guidance',canAct:true}]:[])],roles:[]};
    const before=structuredClone(data),calls=[];
    const shown=await loadWorkbenchReviewPresentation({request:async(url,options)=>{calls.push({url,options});return url.endsWith('/status')?{enabled:true}:scopeDetail();}},data);
    assert.equal(calls.filter(call=>call.url.includes('/cases/')).length,1);
    assert(calls.every(call=>!call.options.method||call.options.method==='GET'));
    assert.equal(shown.nextActions[0].handlingGuide.operation,shown.workItems[0].handlingGuide.operation);
    assert.equal(shown.nextActions[0].caseId,undefined);
    assert.equal(currentWorkbenchSnapshot(shown).count,1);
    assert.deepEqual(data,before);
  }
});

test('ambiguous or denied scope details cannot supply a write instruction or guessed binding to priority cards',async()=>{
  const row=scopeItem(),other={...row,id:'another',revisionNo:3,contentHash:'other-content'};
  const data={nextActions:[projected(row)],workItems:[row,other]};
  const shown=await loadWorkbenchReviewPresentation({request:async url=>url.endsWith('/status')?{enabled:true}:scopeDetail()},data);
  assert.equal(shown.workItems[0].nextStep,'查看本流程归口与参与范围');
  assert.equal(shown.nextActions[0].nextStep,'查看本流程归口与参与范围');
  assert(!shown.nextActions[0].sample.includes('CASE_SYNTHETIC_INTERNAL_001'));
  const denied=await loadWorkbenchReviewPresentation({request:async url=>{if(url.endsWith('/status'))return {enabled:true};throw Object.assign(new Error('denied'),{status:403});}},{workItems:[row],nextActions:[projected(row)]});
  assert.equal(denied.workItems[0].nextStep,'查看本流程归口与参与范围');
});

test('prepared governance redirects a retained legacy scope card to current materials, personal confirmation and time records',()=>{
  const row=scopeItem(),detail=scopeDetail();detail.governance.schema_ready=true;
  const before=structuredClone({row,detail}),shown=scopeItemPresentation(row,detail);
  assert.equal(shown.nextStep,'查看材料、部门确认与办理时限');
  assert.match(shown.handlingGuide.operation,/本次核对/);
  assert.match(shown.handlingGuide.result,/确认结果.*办理截止日期.*历史记录/);
  assert.doesNotMatch(shown.handlingGuide.operation,/点击“记录范围决定”|点击“分派归口部门”/);
  assert.deepEqual({row,detail},before);
});

test('one aggregate pending count stays independent of older todos and handoff discovery; each source remains separate',()=>{
  const scope=scopeItem(),handoff={id:'data-map-handoff:fact:synthetic',type:'data_map_handoff_fact',sourceType:'data_map_handoff',canAct:true};
  const office={id:'office-task:5',type:'office_work',canAct:true};
  const data={summary:{actionableCount:3,pendingTodos:70},handoff:{actionableCount:80},workItems:[scope,handoff,office,{id:'guide:x',type:'guidance'}, {id:'not-mine',type:'waiting',canAct:false}]};
  const before=structuredClone(data),result=currentWorkbenchSnapshot(data);
  assert.equal(result.count,3);assert.equal(result.handoffCount,1);
  assert.deepEqual(result.otherItems,[scope,office]);
  assert.deepEqual(data,before);
  assert.deepEqual(currentWorkbenchSnapshot({summary:{actionableCount:0},workItems:[{type:'guidance'}]}),{count:0,items:[],otherItems:[],handoffCount:0});
});

test('incomplete, duplicate or contradictory current count cannot be rendered as an empty successful list',()=>{
  for(const data of [null,{}, {summary:{actionableCount:-1},workItems:[]},{summary:{actionableCount:0}},{summary:{actionableCount:0},workItems:[scopeItem()]},{summary:{actionableCount:2},workItems:[scopeItem(),scopeItem()]}])assert.throws(()=>currentWorkbenchSnapshot(data));
});
