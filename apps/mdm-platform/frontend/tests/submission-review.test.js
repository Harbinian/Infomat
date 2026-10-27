import {test} from 'node:test';
import assert from 'node:assert/strict';
import {submissionReviewModel,caseChangeFields,caseChangeTitle} from '../src/submissionReviewModel.js';

test('deadline confirmation shows the exact proposal and required departments without changing it',()=>{
  const change={kind:'deadline',change_id:'internal-only',change:{due_date:'2026-10-23',required_department_ids:['91','92'],reason:'合成日期约定'}};
  const before=structuredClone(change);
  const fields=caseChangeFields(change,[{id:'91',name:'甲部'},{id:'92',name:'乙部'}]);
  assert.ok(fields.some(([title,value])=>title==='本次约定截止日期'&&value==='2026-10-23'));
  assert.ok(fields.some(([title,value])=>title==='需要分别确认的部门'&&value==='甲部、乙部'));
  assert.equal(JSON.stringify(fields).includes('internal-only'),false);
  assert.deepEqual(change,before);
  assert.match(caseChangeTitle(change),/截止日期/);
});
test('unknown changes and missing dates stay explicit and do not expose raw values',()=>{
  assert.match(caseChangeFields({kind:'deadline',change:{}},[])[0][1],/未记录具体日期/);
  assert.equal(caseChangeTitle({kind:'INTERNAL_CHANGE_123'}),'待核对的变更事项');
});

const pending=()=>({submission_id:'current',submission:{participants:[{department_id:'7'}]},allowed_actions:['confirm_submission'],changes:[{kind:'submission',current:true,state:'pending',change_id:'task',change:{submission_id:'current'},confirmation_states:[{department_id:'7',valid:false}]}],blocking_issues:[{code:'PROCESS_CASE_CHANGE_PENDING',message:'Original change message'}]});
test('pending material has one source-bound confirmation task',()=>{const review=submissionReviewModel(pending(),'7');assert.equal(review.material.change_id,'task');assert.equal(review.canConfirm,true);assert.equal(review.otherChanges.length,0);assert.equal(review.issues.length,1);});
test('a historical or different submission never marks current material confirmed',()=>{for(const patch of [{current:false},{change:{submission_id:'old'}}]){const state=pending();Object.assign(state.changes[0],patch,{confirmation_states:[{department_id:'7',valid:true}]});const review=submissionReviewModel(state,'7');assert.equal(review.confirmed,false);assert.equal(review.canConfirm,false);}});
test('registered state and another department confirmation do not replace valid current evidence',()=>{const state=pending();state.changes[0].state='registered';assert.equal(submissionReviewModel(state,'7').confirmed,false);state.changes[0].confirmation_states=[{department_id:'8',valid:true}];assert.equal(submissionReviewModel(state,'7').confirmed,false);});
test('valid current department evidence removes repeat confirmation without changing API actions',()=>{const state=pending();state.changes[0].confirmation_states[0].valid=true;const before=structuredClone(state);const review=submissionReviewModel(state,'7');assert.equal(review.confirmed,true);assert.equal(review.canConfirm,false);assert.deepEqual(state,before);});
test('read-only accounts receive no confirmation action',()=>{const state=pending();state.allowed_actions=[];assert.equal(submissionReviewModel(state,'7').canConfirm,false);});

test('retained functional-test confirmation remains business-pending and allows the existing authorized confirmation',()=>{const state=pending();state.changes[0].state='registered';state.changes[0].confirmation_states=[{department_id:'7',valid:false,reason:'functional_test_only'}];state.blocking_issues=[{code:'PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED',message:'Business gate'}];const before=structuredClone(state),review=submissionReviewModel(state,'7');assert.equal(review.confirmed,false);assert.equal(review.confirmationCompleted,false);assert.equal(review.functionalTestOnly,true);assert.equal(review.canConfirm,true);assert.equal(review.issues[0].code,'PROCESS_CASE_SUBMISSION_RECONFIRMATION_REQUIRED');assert.match(review.issues[0].message,/当前提交材料仍待/);assert.deepEqual(state,before);});

test('a read-only observer sees retained test context without adopting another department confirmation',()=>{const state=pending();state.allowed_actions=[];state.changes[0].confirmation_states=[{department_id:'7',valid:false,reason:'functional_test_only'}];const review=submissionReviewModel(state,undefined);assert.equal(review.confirmationCompleted,false);assert.equal(review.functionalTestOnly,true);assert.equal(review.confirmed,false);assert.equal(review.canConfirm,false);assert.equal(submissionReviewModel(state,'8').confirmationCompleted,false);state.changes[0].confirmation_states=[{department_id:'7',valid:true}];assert.equal(submissionReviewModel(state,undefined).confirmed,false);});
test('real pending scope change remains visible and retains the original blocker meaning',()=>{const state=pending();state.changes.push({kind:'scope',current:true,state:'pending',change_id:'scope',allowed_actions:['confirm']});const review=submissionReviewModel(state,'7');assert.equal(review.otherChanges[0].change_id,'scope');assert.equal(review.issues[0].message,'Original change message');});
test('missing or cancelled material never offers confirmation',()=>{assert.equal(submissionReviewModel(null,'7').canConfirm,false);const state=pending();state.changes[0].state='cancelled';assert.equal(submissionReviewModel(state,'7').canConfirm,false);});
