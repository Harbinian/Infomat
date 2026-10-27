import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {submissionReviewModel} from '../src/submissionReviewModel.js';
import {submissionNextStep} from '../src/processActionGuidance.js';

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
}});
const {SubmissionReview,CaseGovernanceHistory}=await import('../src/SubmissionReview.jsx');
const departments=[{id:'7',name:'合成甲部门'},{id:'8',name:'合成乙部门'}];
const testState=()=>({
  submission_id:'private-submission',schema_ready:true,lifecycle:'active',deadline:null,
  submission:{purpose:'合成核对目的',revision_reason:'合成修订原因',change_summary:'合成变化',sources:[],participants:[{department_id:'7',department_name:'合成甲部门',responsibilities:'核对本部门实际责任',basis:'合成制度第一条'}]},
  allowed_actions:['confirm_submission'],
  changes:[{change_id:'private-change',kind:'submission',current:true,state:'registered',change:{submission_id:'private-submission'},confirmation_states:[{department_id:'7',valid:false,reason:'functional_test_only'}],confirmations:[{confirmation_id:'private-test-confirmation',department_id:'7',basis_text:'合成功能测试依据',created_at:'2026-10-25T00:00:00.000Z',usage:{purpose:'functional_test',counts_as_department_confirmation:false}}]}],
  blocking_issues:[{code:'PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED',message:'合成部门确认待办理'}]
});
const detail=(departmentId='7',eligible=true)=>({department_accountability:{department_id:departmentId,eligible},revision:{document:{behaviors:[]}}});
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const confirmationButtons=node=>{
  if(!React.isValidElement(node))return [];
  const mine=node.type==='button'&&node.props.children==='本人确认提交材料及本部门范围'?[node]:[];
  return mine.concat(React.Children.toArray(node.props.children).flatMap(confirmationButtons));
};

test('an eligible current department can open the existing confirmation after a retained test record',()=>{
  const state=testState(),before=structuredClone(state),calls=[];
  const tree=SubmissionReview({state,detail:detail(),departments,onStart:(...args)=>calls.push(args)});
  const button=confirmationButtons(tree);
  assert.equal(button.length,1);
  assert.equal(Boolean(button[0].props.disabled),false);
  assert.deepEqual(calls,[]);
  button[0].props.onClick();
  assert.equal(calls.length,1);
  assert.equal(calls[0][0],'confirm_submission');
  assert.equal(calls[0][1],state.changes[0]);
  assert.deepEqual(state,before);
  const html=render(SubmissionReview,{state,detail:detail(),departments,onStart(){}});
  assert.match(html,/测试记录已留存，业务确认待办理/);
  assert.match(html,/保存本次办理/);
  assert.match(html,/在“确认结果”核对本部门状态/);
  assert.match(html,/查看确认时间和依据/);
  assert.doesNotMatch(html,/无需重复操作|private-submission|private-change|private-test-confirmation|functional_test_only/);
});

test('read-only and ineligible roles do not receive a confirmation button or an instruction to fill a missing form',()=>{
  for(const authority of [detail('7',false),detail('8',true),detail(null,false)]){
    const state=testState();state.allowed_actions=[];
    const before=structuredClone(state);
    const html=render(SubmissionReview,{state,detail:authority,departments,onStart(){throw Error('READ_ONLY_ACTION');}});
    assert.doesNotMatch(html,/<button[^>]*>本人确认提交材料及本部门范围<\/button>/);
    assert.match(html,/当前账号没有本次本人确认入口/);
    assert.doesNotMatch(html,/再在上方填写本人依据并确认|无需重复操作/);
    assert.match(html,/相关部门当前已登记且具有有效授权的负责人/);
    assert.match(html,/刷新材料与案例状态/);
    assert.deepEqual(state,before);
  }
  const state=testState();
  assert.equal(confirmationButtons(SubmissionReview({state,detail:detail('7',false),departments,onStart(){}})).length,0);
});

test('another department valid evidence does not become the observer own confirmation',()=>{
  const state=testState();state.allowed_actions=[];state.changes[0].confirmation_states=[{department_id:'7',valid:true}];
  assert.equal(submissionReviewModel(state,undefined).confirmed,false);
  assert.equal(submissionReviewModel(state,'8').confirmed,false);
  const html=render(SubmissionReview,{state,detail:detail(null,false),departments,onStart(){}});
  assert.doesNotMatch(html,/>本部门已确认<|当前有效的负责人确认已保存/);
});

test('a later valid business confirmation hides repeat entry while preserving the earlier test record',()=>{
  const state=testState();
  state.changes[0].confirmation_states=[{department_id:'7',valid:true}];
  state.changes[0].confirmations.push({confirmation_id:'private-real-confirmation',department_id:'7',basis_text:'合成部门负责人实际业务核对依据',created_at:'2026-10-26T00:00:00.000Z'});
  state.blocking_issues=[];
  const before=structuredClone(state),review=submissionReviewModel(state,'7');
  assert.equal(review.confirmed,true);assert.equal(review.confirmationCompleted,true);assert.equal(review.functionalTestOnly,false);assert.equal(review.canConfirm,false);
  const html=render(SubmissionReview,{state,detail:detail(),departments,onStart(){}});
  assert.match(html,/本部门已确认/);
  assert.equal(confirmationButtons(SubmissionReview({state,detail:detail(),departments,onStart(){}})).length,0);
  const history=render(CaseGovernanceHistory,{state,departments});
  assert.match(history,/合成功能测试依据/);assert.match(history,/合成部门负责人实际业务核对依据/);
  assert.doesNotMatch(history,/private-test-confirmation|private-real-confirmation/);
  assert.deepEqual(state,before);
});

test('confirmation next steps distinguish the actor action from waiting for another responsible department',()=>{
  const state=testState(),review=submissionReviewModel(state,'7');
  const own=submissionNextStep(state,review);
  assert.match(own.title,/本人核对并确认/);assert.match(own.message,/点击上方“本人确认提交材料及本部门范围”/);assert.match(own.message,/原功能测试确认仅留作测试记录/);
  state.allowed_actions=[];
  const waiting=submissionNextStep(state,submissionReviewModel(state,'7'));
  assert.match(waiting.title,/等待相关部门负责人/);assert.match(waiting.message,/当前账号没有本次本人确认入口/);assert.doesNotMatch(waiting.message,/点击上方|再在上方填写/);
  state.changes[0].confirmation_states=[{department_id:'7',valid:true},{department_id:'8',valid:false}];
  const others=submissionNextStep(state,submissionReviewModel(state,'7'));
  assert.match(others.title,/等待其他参与部门负责人/);assert.match(others.message,/本部门确认已保存/);
});

test('editing and disabled state preserve the current input instead of enabling another confirmation action',()=>{
  for(const flags of [{editing:true},{disabled:true}]){
    const buttons=confirmationButtons(SubmissionReview({state:testState(),detail:detail(),departments,onStart(){},...flags}));
    assert.equal(buttons.length,1);assert.equal(buttons[0].props.disabled,true);
  }
});
