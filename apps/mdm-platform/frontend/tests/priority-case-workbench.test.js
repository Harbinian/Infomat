import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
// Pure repository doubles only: any accidental pool/network creation fails.
process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.PROCESS_GOVERNANCE_READ_MODEL='mysql';
process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.PROCESS_V7_FORMAL_ENABLED='1';
const mysql=require('mysql2/promise'),originalPool=mysql.createPool,originalConnection=mysql.createConnection;
let connectionAttempts=0;
mysql.createPool=mysql.createConnection=()=>{connectionAttempts++;throw new Error('Unexpected database access in pure workbench projection test');};
const router=require('../../server/routes/processPreviewReview.js');
const {digest}=require('../../server/processCaseGovernance.js');
const fixture=require('../../scripts/testHelpers/processCaseGovernanceFixture.js');
after(()=>{router.resetProcessPreviewRepositoryFactory();mysql.createPool=originalPool;mysql.createConnection=originalConnection;assert.equal(connectionAttempts,0);});
const actors={
  lead:{personId:'11',departmentId:'91',roleCodes:new Set(['mdm_lead']),permissions:new Set(['governance:read-global','governance:assign-work']),canReadGlobal:true},
  contact:{personId:'12',departmentId:'91',roleCodes:new Set(['department_contact']),permissions:new Set(['governance:read-department','governance:draft-department','governance:submit-department'])},
  headA:{personId:'13',departmentId:'91',roleCodes:new Set(['department_mdm_reviewer']),permissions:new Set(['governance:read-department','governance:review-department'])},
  headB:{personId:'14',departmentId:'92',roleCodes:new Set(['department_mdm_reviewer']),permissions:new Set(['governance:read-department','governance:review-department'])},
  outsider:{personId:'15',departmentId:'93',roleCodes:new Set(['department_mdm_reviewer']),permissions:new Set(['governance:read-department','governance:review-department'])},
  admin:{personId:'16',departmentId:'91',roleCodes:new Set(['admin','mdm_lead']),permissions:new Set(['governance:read-global','governance:assign-work']),canReadGlobal:true}
};
function state(valid=false){
  const submission=fixture.submission(['91','92']);submission.missing=[];
  return {schema_ready:true,lifecycle:'active',submission,submission_id:'synthetic-submission',deadline:null,blocking_issues:[],changes:[{
    change_id:'synthetic-material',kind:'submission',state:valid?'registered':'pending',current:true,confirmations:[],
    change:{submission_id:'synthetic-submission',submission_digest:digest(submission),required_department_ids:['91','92']},
    confirmation_states:[{department_id:'91',valid},{department_id:'92',valid}]}]};
}
function deadline(g,{allConfirmed=false,validA=false,validB=false,current=true,status='pending'}={}){
  const change={kind:'deadline',due_date:'2026-12-31',required_department_ids:['91','92'],scope_digest:digest(g.submission.participants),reason:'合成日期约定',basis:'合成依据'};
  return {change_id:'synthetic-deadline',kind:'deadline',state:status,current,change,confirmations:[],
    confirmation_states:[{department_id:'91',valid:allConfirmed||validA},{department_id:'92',valid:allConfirmed||validB}]};
}
async function project(who,g,patch={},describe=false){
  const document=fixture.document();document.process.process_name='合成材料与办理时限流程';
  const value={case:{id:'3',case_ref:'CASE_INTERNAL_DO_NOT_DISPLAY',process_ref:document.process.process_ref,process_name:document.process.process_name,owning_department_id:'91',owning_department_name:'Synthetic A',current_revision_id:'31',current_revision_no:3,current_content_hash:'a'.repeat(64),status:'under_review',blocking_issues:[],...patch},
    revision:{id:'31',revision_no:3,content_hash:'a'.repeat(64),document},items:[],governance:g,preview_confirmation:{valid:false}};
  const before=structuredClone(value);
  const repo={departmentAccountability:async(actor,department)=>({department_id:department,eligible:actor.permissions.has('governance:review-department')&&({'91':'13','92':'14','93':'15'})[String(department)]===actor.personId}),
    listCases:async()=>({items:[{id:'3',status:value.case.status}]}),getCaseDetail:async()=>structuredClone(value),
    listDepartments:async()=>[{id:'91',name:'Synthetic A',status:'active'},{id:'92',name:'Synthetic B',status:'active'},{id:'93',name:'Synthetic C',status:'active'}],
    canReadAssigned:async(id,actor)=>(g?.submission?.participants||[]).some(p=>String(p.department_id)===String(actor.departmentId))};
  router.setProcessPreviewRepositoryFactory(async()=>repo);
  const actor=typeof who==='string'?actors[who]:who;
  const rows=describe?await router.describeCaseForActor(repo,actor,structuredClone(value)):await router.listProcessWorkbenchItems(actor);
  assert.deepEqual(value,before,'projection must not mutate case or historical governance records');
  return rows;
}
const types=rows=>rows.map(row=>row.type);

test('incomplete current materials go to the actual submitter, never to a false lead scope task',async()=>{
  const g=state();g.submission.missing=['sources'];g.changes=[];
  assert.deepEqual(await project('lead',g),[]);
  const rows=await project('contact',g);assert.deepEqual(types(rows),['v7_submission_materials']);
  assert.match(rows[0].handlingGuide.operation,/补充本次提交材料.*保存本次办理/);
  assert.match(rows[0].handlingGuide.result,/阅读本次提交材料.*核对本部门责任范围/);
  assert.deepEqual(await project('headA',g),[]);
});

test('material confirmation tasks use current personal validity and disappear for each already confirmed department',async()=>{
  const g=state();
  assert.deepEqual(types(await project('headA',g)),['v7_submission_confirmation']);
  assert.deepEqual(types(await project('headB',g)),['v7_submission_confirmation']);
  assert.deepEqual(await project('lead',g),[]);
  g.changes[0].confirmation_states[0].valid=true;
  assert.deepEqual(await project('headA',g),[]);
  assert.deepEqual(types(await project('headB',g)),['v7_submission_confirmation']);
});

test('functional-test confirmation remains a real personal confirmation task with its original history retained',async()=>{
  const g=state(true);g.changes[0].confirmation_states[0]={department_id:'91',valid:false,reason:'functional_test_only'};
  const rows=await project('headA',g);assert.deepEqual(types(rows),['v7_submission_confirmation']);
  assert.match(rows[0].handlingGuide.operation,/功能测试记录不能代替本次业务确认/);
  assert.deepEqual(await project('lead',g),[]);
});

test('after all current material confirmations, only qualified lead receives the date proposal task and exact source binding',async()=>{
  const g=state(true),rows=await project('lead',g);assert.deepEqual(types(rows),['v7_deadline_proposal']);
  assert.equal(rows[0].caseId,'3');assert.equal(rows[0].revisionNo,3);assert.equal(rows[0].contentHash,'a'.repeat(64));
  assert.equal(rows[0].target,'/app/process-preview?case=3');
  assert.match(rows[0].handlingGuide.operation,/约定本次办理时限.*约定完成日期.*保存本次办理/);
  assert.match(rows[0].handlingGuide.result,/需要确认或登记的具体事项/);
  assert(!rows[0].sample.includes('CASE_INTERNAL_DO_NOT_DISPLAY'));
  assert.deepEqual(await project('headA',g),[]);
  assert.deepEqual(await project('contact',g),[]);
});

test('a pending date is confirmed only by each still-unconfirmed required current department head',async()=>{
  const g=state(true);g.changes.push(deadline(g,{validA:true}));
  assert.deepEqual(await project('headA',g),[]);
  const rows=await project('headB',g);assert.deepEqual(types(rows),['v7_deadline_confirmation']);
  assert.equal(rows[0].governanceChangeId,'synthetic-deadline');
  assert.match(rows[0].handlingGuide.operation,/2026-12-31.*本人确认此事项/);
  assert.deepEqual(await project('lead',g),[]);
});

test('only all valid pending date confirmations yield lead registration; a registered date yields no repeated task',async()=>{
  const g=state(true),change=deadline(g,{allConfirmed:true});g.changes.push(change);
  const rows=await project('lead',g);assert.deepEqual(types(rows),['v7_deadline_registration']);
  assert.match(rows[0].handlingGuide.operation,/登记已确认事项.*保存本次办理/);
  assert.match(rows[0].handlingGuide.result,/办理截止日期.*历史记录/);
  change.state='registered';g.deadline=change.change;
  assert.deepEqual(await project('lead',g),[]);assert.deepEqual(await project('headA',g),[]);
});

test('invalid registered date authority causes re-agreement, not confirmation of the already registered record',async()=>{
  const g=state(true),old=deadline(g,{status:'registered',validB:true});g.changes.push(old);g.deadline=old.change;
  g.blocking_issues=[{code:'PROCESS_CASE_DEADLINE_RECONFIRMATION_REQUIRED',message:'合成时限负责人确认失效'}];
  const rows=await project('lead',g);assert.deepEqual(types(rows),['v7_deadline_proposal']);assert.match(rows[0].title,/重新约定/);
  assert.deepEqual(await project('headA',g),[]);
  g.changes.push({...deadline(g),change_id:'synthetic-new-date'});
  assert.deepEqual(await project('lead',g),[]);
  assert.deepEqual(types(await project('headA',g)),['v7_deadline_confirmation']);
});

test('an uncancelled old-revision pending change blocks a new date card instead of bypassing original proposal rules',async()=>{
  const g=state(true),old=deadline(g,{current:false});g.changes.push(old);
  assert.deepEqual(await project('lead',g),[]);
  old.state='cancelled';assert.deepEqual(types(await project('lead',g)),['v7_deadline_proposal']);
});

test('roles without current qualification, admin and unrelated departments gain no new governed task',async()=>{
  assert.deepEqual(await project('admin',state()),[]);
  const noPermission={...actors.lead,permissions:new Set(['governance:read-global'])};
  assert.deepEqual(await project(noPermission,state(true)),[]);
  const noHeadPermission={...actors.headA,permissions:new Set(['governance:read-department'])};
  assert.deepEqual(await project(noHeadPermission,state()),[]);
  await assert.rejects(project('outsider',state()),error=>error.statusCode===403);
});

test('unprepared or absent governance never revives retired owner/scope tasks, and closed cases remain excluded',async()=>{
  assert.deepEqual(await project('lead',{schema_ready:false,lifecycle:'unknown',submission:null,changes:[],blocking_issues:[]},{owning_department_id:null}),[]);
  assert.deepEqual(await project('lead',undefined,{owning_department_id:null}),[]);
  assert.deepEqual(await project('lead',state(true),{status:'closed'}),[]);
});

test('actual case detail removes rejected shortcut actions even with legacy owner or scope blockers',async()=>{
  for(const g of [undefined,{schema_ready:false,lifecycle:'unknown',submission:null,changes:[],blocking_issues:[]},state()]){
    const shown=await project('lead',g,{owning_department_id:null},true);
    assert(!shown.allowed_actions.includes('assign_owner'));
    assert(!shown.allowed_actions.includes('record_scope_decision'));
    if(g?.schema_ready===false)assert.deepEqual(shown.governance.allowed_actions,[]);
  }
});

test('lifecycle state does not invent an extra date gate: existing proposal qualification remains authoritative',async()=>{
  const g=state(true);g.lifecycle='paused';
  assert.deepEqual(types(await project('lead',g)),['v7_deadline_proposal']);
  g.submission.missing=['sources'];g.changes=[];
  assert.deepEqual(await project('contact',g),[],'save_submission already requires active state');
});
