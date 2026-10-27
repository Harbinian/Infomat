import test from 'node:test';
import assert from 'node:assert/strict';
import {conflictDisplay,conflictSourceChoices,currentAssignedPerson,factSourceName,factSourceAttribution,conflictActionGuidance,factActionGuidance} from '../src/handoffConflictPresentation.js';
import {factDepartmentName,factTypeChoices,editableCustomFactType} from '../src/handoffFactPresentation.js';

const detail={detail_version_id:'version-accurate',detail_ref:'detail-accurate',detail_type:'critical_field'};
const binding={binding_id:'binding-accurate',snapshot_json:{detail_versions:[detail]}};
const trace={bindings:[{binding_id:'binding-unrelated',snapshot_json:{detail_versions:[{...detail,detail_version_id:'version-unrelated'}]}},binding],detail_sources:[{detail_version_id:'version-unrelated',source:{data_name:'无关材料'}},{detail_version_id:'version-accurate',source:{data_name:'申请记录',field_name:'申请编号'}}],revisions:[{handoff_id:'draft-accurate',revision_no:4,content_digest:'accurate-digest',binding_id:'binding-accurate'}]};
const conflict={handoff_id:'draft-accurate',current_handoff_revision:4,content_digest:'accurate-digest'};
const subjects=[{item_ref:'field:1',definition:{name:'申请编号'},source_detail_refs:['detail-accurate']}];

test('source choices use exact draft revision, digest, binding and detail instead of list position',()=>{
  const before=structuredClone({trace,conflict,subjects});
  assert.deepEqual(conflictSourceChoices(conflict,trace,subjects),[{value:'detail-accurate',label:'申请编号 · 申请记录 / 申请编号'}]);
  assert.deepEqual(conflictSourceChoices(conflict,{...trace,bindings:[...trace.bindings].reverse(),detail_sources:[...trace.detail_sources].reverse()},subjects),conflictSourceChoices(conflict,trace,subjects));
  assert.match(conflictSourceChoices({...conflict,content_digest:'different'},trace,subjects)[0].label,/具体来源名称未记录/);
  assert.doesNotMatch(conflictSourceChoices({...conflict,content_digest:'different'},trace,subjects)[0].label,/无关材料|detail-accurate/);
  assert.deepEqual({trace,conflict,subjects},before);
});

test('missing explicit bindings and ambiguous revisions never borrow another available source',()=>{
  const explicit={revision:{binding_id:'missing'}};
  assert.match(conflictSourceChoices(explicit,trace,subjects)[0].label,/具体来源名称未记录/);
  const ambiguous={...trace,revisions:[...trace.revisions,{...trace.revisions[0],binding_id:'binding-unrelated'}]};
  assert.match(conflictSourceChoices(conflict,ambiguous,subjects)[0].label,/具体来源名称未记录/);
  assert.equal(factSourceName({binding_id:'binding-accurate',detail_ref:'detail-accurate'},trace),'申请记录 / 申请编号');
  assert.match(factSourceName({binding_id:'missing',detail_ref:'detail-accurate'},trace),/来源名称未记录/);
});

test('an explicit missing or unsafe fact name never borrows another name or changes the authorized response',()=>{
  for(const detail_name of [null,'','   ',{name:'不是名称字段'},'POST /api/synthetic','450b553c-541c-4727-906c-6ce9b234ed0b']){
    const fact={detail_name,binding_id:'binding-accurate',detail_ref:'detail-accurate'},before=structuredClone(fact);
    assert.equal(factSourceName(fact,trace),'来源名称未记录');assert.deepEqual(fact,before);
  }
  assert.equal(factSourceName({detail_name:'原材料中留存的对象名',binding_id:'missing'},trace),'原材料中留存的对象名');
});

test('fact name provenance follows the optional DTO rather than guessing from the parent or exposing an unknown code',()=>{
  const cases=[
    [{detail_name_source:'fixed_source'},'固定流程版本中留存的名称'],
    [{detail_name_source:'review_snapshot'},'原审核记录中留存的名称'],
    [{detail_name_source:'parent_snapshot',parent_kind:'intake'},'本问题提出时的接入核验记录中留存的名称'],
    [{detail_name_source:'parent_snapshot',parent_kind:'correction'},'本问题提出时的更正记录中留存的名称'],
    [{detail_name_source:'parent_snapshot',parent_kind:'unknown_parent'},'本问题提出时的接入或更正记录中留存的名称'],
    [{parent_kind:'intake'},'名称出处未注明'],
    [{detail_name_source:null,parent_kind:'correction'},'名称出处未注明'],
    [{detail_name_source:'constructor'},'名称出处未注明'],
    [{detail_name_source:['fixed_source']},'名称出处未注明'],
    [{detail_name_source:'INTERNAL_UNKNOWN_SOURCE'},'名称出处未注明']
  ];
  for(const [fact,expected] of cases){const before=structuredClone(fact);assert.equal(factSourceAttribution(fact),expected);assert.deepEqual(fact,before);}
});

test('structured descriptions label only known or readable business fields and retain the untouched source',()=>{
  const value={outcome:'合成处理结果',basis:'按合成材料核对',补充说明:'合成说明',request_id:'internal-request',unknown_internal_key:'internal-value',description:'POST /api/synthetic'};
  const before=structuredClone(value),text=conflictDisplay(value);
  assert.match(text,/处理结果：合成处理结果/);assert.match(text,/依据：按合成材料核对/);assert.match(text,/补充说明：合成说明/);
  assert.doesNotMatch(text,/request_id|internal-request|unknown_internal_key|internal-value|POST|\/api\//);
  assert.deepEqual(value,before);assert.match(conflictDisplay({unknown_internal_key:'value'}),/原内容保持/);
});

test('current assignee names are explicitly current and never expose an unavailable person identifier',()=>{
  const people=[{person_id:'9007199254740992',person_name:'相邻人员'},{person_id:'9007199254740993',person_name:'当前合成人员'}];
  assert.equal(currentAssignedPerson('9007199254740993',people,'处理人'),'当前目录：当前合成人员');
  assert.match(currentAssignedPerson('9007199254740994',people,'处理人'),/原分派保留/);
  assert.doesNotMatch(currentAssignedPerson('9007199254740994',people,'处理人'),/900719/);
  assert.equal(currentAssignedPerson('',people,'决策人'),'尚未指定决策人');
  assert.match(currentAssignedPerson(Number('9007199254740993'),people,'处理人'),/原分派保留/);
});

test('department names cannot be inferred from question text or an imprecise numeric identity',()=>{
  const departments=[{id:'9007199254740992',name:'相邻部门'},{id:'9007199254740993',name:'准确部门'}];
  assert.equal(factDepartmentName({target_department_id:'9007199254740993',question_text:'不同部门问题'},{departments}),'准确部门');
  assert.equal(factDepartmentName({target_department_id:Number('9007199254740993')},{departments}),'部门名称未记录');
  assert.equal(factDepartmentName({question_text:'不能当作部门名称'}),'部门名称未记录');
});

test('fact type choices preserve open-string history, have no default and permit explicit business custom values',()=>{
  const unknown='unknown_legacy_code';
  assert.deepEqual(factTypeChoices('').map(row=>row.value),['business_meaning','source_evidence']);
  assert.deepEqual(factTypeChoices(unknown).at(-1),{value:unknown,label:'原事实类型（原值保留）'});
  assert.equal(editableCustomFactType('合成办理条件'),true);
  assert.equal(editableCustomFactType('说明 /api/synthetic'),false);
  assert.equal(editableCustomFactType(unknown),false);
});

test('guidance identifies saved result destinations and distinct follow-up responsibilities',()=>{
  assert.match(conflictActionGuidance.open_fact,/定向事实与分别重核.*目标部门答复/);
  assert.match(conflictActionGuidance.resolve,/当前处理结果.*各?部门分别提出事实重核/);
  assert.match(factActionGuidance('answer','handoff_conflict'),/负责人本人确认.*MDM核对关闭/);
  assert.match(factActionGuidance('answer','intake'),/当前事实答复.*MDM/);
  assert.doesNotMatch(factActionGuidance('answer','intake'),/负责人.*确认/);
});
