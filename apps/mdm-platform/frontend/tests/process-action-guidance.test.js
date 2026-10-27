import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formalAccountabilityContext,submissionNextStep,processIssuePresentation,processChecksPresentation} from '../src/processActionGuidance.js';
import {submissionReviewModel} from '../src/submissionReviewModel.js';

test('administrator qualification never describes the case department as inactive',()=>{
  const detail={case:{owning_department_id:'7'},department_accountability:{department_id:null,eligible:false,reason:'DEPARTMENT_INACTIVE'}};
  const before=structuredClone(detail);
  const projection=formalAccountabilityContext(detail,{identityKind:'system_admin'});
  assert.equal(projection.title,'当前账号只读');
  assert.match(projection.message,/管理员可查阅/);
  assert.equal(projection.value,undefined);
  assert.deepEqual(detail,before);
  assert.equal(formalAccountabilityContext(detail,{rbacRoles:[{code:'admin'}]}).readOnly,true);
});

test('current actor qualification is kept distinct from the formal case owner check',()=>{
  const actor={department_id:'9',eligible:false,reason:'DEPARTMENT_FINAL_RESPONSIBLE_MISMATCH'};
  const owner={department_id:'7',eligible:true};
  assert.deepEqual(formalAccountabilityContext({department_accountability:actor},{}),{value:actor,title:'当前账号所属部门的负责人资格'});
  assert.deepEqual(formalAccountabilityContext({formal_promotion:{department_accountability:owner},department_accountability:actor},{}),{value:owner,title:'归口部门负责人办理条件'});
  assert.match(formalAccountabilityContext({department_accountability:{reason:'DEPARTMENT_INACTIVE'}},{}).message,/尚未取得本人所属部门/);
});

const pending=()=>({schema_ready:true,submission_id:'current',submission:{participants:[{department_id:'7'}],missing:[]},allowed_actions:['propose_change'],changes:[{kind:'submission',current:true,state:'registered',change_id:'material',change:{submission_id:'current'},confirmation_states:[{department_id:'7',valid:true}]}],blocking_issues:[]});
const next=state=>submissionNextStep(state,submissionReviewModel(state,'7'));

test('missing material takes precedence over a missing deadline and never offers an unauthorized action',()=>{
  const state=pending();state.submission=null;state.allowed_actions=[];
  const before=structuredClone(state),step=next(state);
  assert.equal(step.kind,'materials');assert.equal(step.action,null);assert.match(step.title,/归口主对接人/);
  assert.match(step.message,/阅读本次提交材料/);assert.deepEqual(state,before);
  state.allowed_actions=['save_submission'];assert.equal(next(state).action,'submission');
});

test('missing participants and material gaps are resolved before date guidance',()=>{
  const state=pending();state.submission.participants=[];
  assert.equal(next(state).kind,'participants');
  state.submission.missing=['sources'];assert.equal(next(state).kind,'materials');
  state.schema_ready=false;assert.equal(next(state).kind,'unavailable');
});

test('pending, invalid and functional-test confirmations cannot be called deadline-ready',()=>{
  for(const change of [
    {state:'pending'},
    {confirmation_states:[{department_id:'7',valid:false}]},
    {confirmation_states:[{department_id:'7',valid:false,reason:'functional_test_only'}]},
    {confirmation_states:[]}
  ]){const state=pending();Object.assign(state.changes[0],change);assert.equal(next(state).kind,'confirmation');}
  const state=pending();state.blocking_issues=[{code:'PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED'}];assert.equal(next(state).kind,'confirmation');
});

test('valid current material reaches deadline guidance without changing server actions',()=>{
  const state=pending(),before=structuredClone(state);
  assert.equal(next(state).kind,'deadline');assert.equal(next(state).action,'deadline');assert.deepEqual(state,before);
  state.allowed_actions=[];assert.equal(next(state).action,null);
  state.deadline={due_date:'2026-10-30'};assert.equal(next(state),null);
  state.deadline=null;state.changes.push({kind:'deadline',state:'pending',current:true});assert.equal(next(state),null);
});

const document=()=>({forms:[{form_name:'合成申请单',areas:[{area_title:'申请内容',items:[{item_ref:'kept-only-in-data',item_name:'申请日期',instructions:'填写实际申请日期'},{item_name:'申请人'},{instructions:'原文未命名填写项'}]}]}]});

test('legacy numbered field guidance uses the exact saved form, area and item path',()=>{
  const source=document(),issue={message:'合成申请单的字段2取值方式待确认',path:'/forms/0/areas/0/items/1/value_origin_mode',group:'confirmation',rule_code:'unchanged'},before=structuredClone({source,issue});
  const result=processIssuePresentation(issue,source);
  assert.equal(result.message,'《合成申请单》／申请内容：申请人取值方式待确认');
  assert.equal(result.fieldLocation.item,source.forms[0].areas[0].items[1]);
  assert.equal(result.path,issue.path);assert.equal(result.rule_code,issue.rule_code);
  assert.deepEqual({source,issue},before);
});

test('same-index fields in different areas are not resolved by fuzzy name or position outside the exact path',()=>{
  const source=document();source.forms[0].areas.push({area_title:'复核内容',items:[{item_name:'核对人'}]});
  assert.match(processIssuePresentation({message:'合成申请单的字段1取值方式待确认',path:'forms.0.areas.1.items.0.value_origin_mode'},source).message,/复核内容：核对人/);
  const orphan={message:'原表单的字段1取值方式待确认',path:'/forms/9/areas/0/items/0/value_origin_mode'};
  const orphanResult=processIssuePresentation(orphan,source);
  assert.match(orphanResult.message,/无法准确定位/);assert.doesNotMatch(orphanResult.message,/字段1/);assert.equal(orphanResult.fieldLocation,undefined);assert.equal(orphan.path,'/forms/9/areas/0/items/0/value_origin_mode');
  assert.equal(processIssuePresentation({message:'其他业务核对',path:'/process/purpose'},source).message,'其他业务核对');
});

test('missing names stay explicit and technical names never leak through replacement labels',()=>{
  const source=document();
  const missing=processIssuePresentation({message:'合成申请单的字段3取值方式待确认',path:'/forms/0/areas/0/items/2/value_origin_mode'},source);
  assert.match(missing.message,/填写项名称未记录/);
  source.forms[0].areas[0].items[0].item_name='person_id';
  const technical=processIssuePresentation({message:'合成申请单的字段1取值方式待确认',path:'/forms/0/areas/0/items/0/value_origin_mode'},source);
  assert.equal(technical.message.includes('person_id'),false);assert.match(technical.message,/暂无法直接展示/);
});

test('checks presentation preserves counts, status and the stored issue object',()=>{
  const checks={status:'ready',counts:{confirmation:1},issues:[{group:'confirmation',message:'合成申请单的字段1取值方式待确认',path:'/forms/0/areas/0/items/0/value_origin_mode'}]},before=structuredClone(checks);
  const result=processChecksPresentation(checks,document());
  assert.deepEqual(result.counts,checks.counts);assert.equal(result.status,checks.status);assert.match(result.issues[0].message,/申请日期/);assert.deepEqual(checks,before);
});
