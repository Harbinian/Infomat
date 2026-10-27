import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {caseRevisionMaterialLabel,caseHistoryAction} from '../src/caseHistoryPresentation.js';

test('saved material uses its exact business process name without exposing or modifying the original technical filename',()=>{
  const caseRow={id:'987654321',process_name:'流程编制、核对与发布管理制度'};
  const revisions=['case2-v9-candidate.json','process-authoring-review-publication-v8-r3-draft.json','authoring-workspace.json'].map(source_file_name=>({id:98,revision_no:12,source_file_name,created_at:'2026-10-20T07:56:08.000Z'}));
  const original=structuredClone({caseRow,revisions});
  for(const revision of revisions){
    const label=caseRevisionMaterialLabel(revision,caseRow);
    assert.equal(label,'《流程编制、核对与发布管理制度》流程编制材料');
    assert.doesNotMatch(label,/\.json|987654321|case2|v9|r3|12/i);
  }
  assert.deepEqual({caseRow,revisions},original);
  assert.equal(caseRevisionMaterialLabel({document:{process:{process_name:'采购付款流程'}}}), '《采购付款流程》流程编制材料');
  for(const process_name of [null,'case2-v9-candidate.json','GET /api/internal'])assert.equal(caseRevisionMaterialLabel({source_file_name:'kept.json'},{process_name}),'流程编制材料（流程名称未记录）');
});

test('the actual preview event contract produces distinct business actions while retaining all original fields',()=>{
  const rows=[
    {event_type:'preview_case_created',expected:'新建流程案例并保存首次材料'},
    {event_type:'preview_revision_uploaded',expected:'保存新的流程修订'},
    {event_type:'department_review_decision_recorded',decision:'confirmed',expected:'记录部门核对意见'},
    {event_type:'review_result_carried_forward',expected:'保留原部门核对意见'},
    {event_type:'review_item_reopened',expected:'列入部门核对事项'},
    {event_type:'formal_draft_promoted',expected:'生成正式草稿'},
    {event_type:'process_case_governance_action',payload:{operation:'submission'},expected:'补充提交材料'},
    {event_type:'process_case_governance_action',payload:{operation:'submission_confirm'},expected:'本人确认提交材料及本部门范围'},
    {event_type:'process_case_governance_action',payload:{schema_version:'process-case-governance-v1',operation:'propose',result:{change:{kind:'deadline'}}},expected:'提出办理时限约定'},
    {event_type:'process_case_governance_action',payload:{schema_version:'process-case-governance-v1',operation:'propose',result:{changed:false,message:'无范围变化，仅记录比较结论，不创建变化记录'}},expected:'记录比较结果（未建立变化事项）'},
    {event_type:'process_case_governance_action',payload:{operation:'register',result:{kind:'deadline'}},expected:'登记已确认的办理时限约定'},
    {event_type:'process_case_governance_action',payload:{operation:'cancel'},expected:'撤销未登记事项'},
    {event_type:'process_case_confirmation_usage_restricted',expected:'限定原确认记录的使用范围'},
    {event_type:'process_case_business_acceptance',expected:'记录业务验收结论'},
    {event_type:'process_formal_control',payload:{schema_version:'process-formal-controls-v1',action:'record_institution_editions'},expected:'补充来源及拟议制度版次'},
    {event_type:'process_dispute_action',payload:{schema_version:'process-dispute-v1',action:'request_recheck'},expected:'请相关部门重新核对争议事项'}
  ];
  const original=structuredClone(rows);
  for(const row of rows)assert.equal(caseHistoryAction(row),row.expected);
  assert.deepEqual(rows,original);
});

test('missing, unfamiliar and future event details remain explicit gaps without exposing codes or inventing an action',()=>{
  assert.equal(caseHistoryAction({}), '办理记录（原记录未提供操作类型）');
  const rows=[{event_type:'UNRECOGNIZED_EVENT_CODE'},{event_type:'constructor'},{event_type:'process_case_governance_action',payload:{operation:'future_operation'}},{event_type:'process_case_governance_action',payload:{schema_version:'future-v2',operation:'submission'}},{event_type:'process_formal_control',payload:{action:'constructor'}},{event_type:'process_dispute_action',payload:{schema_version:'future-v2',action:'decide'}}];
  for(const row of rows){const label=caseHistoryAction(row);assert.match(label,/待核对/);assert.doesNotMatch(label,/UNRECOGNIZED|constructor|future|submission|decide|_action/);}
});

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
}});
const {ProcessCaseControls}=await import('../src/ProcessCaseControls.jsx');

test('deadline form explains proposal, department confirmation, lead registration and precise result locations before saving',()=>{
  const detail={case:{id:9001,process_name:'合成办理时限核对流程',current_revision_no:2,current_content_hash:'retained-content-hash'},revision:{document:{behaviors:[]}}};
  const draft={kind:'case-control',caseId:'9001',action:'deadline',expected_revision_no:2,expected_content_hash:'retained-content-hash',due_date:'2026-11-05',department_ids:[],reason:'合成原因仍保留',basis:'合成依据仍保留',request_id:'original-request'};
  const original=structuredClone({detail,draft});let calls=0;
  const html=renderToStaticMarkup(React.createElement(ProcessCaseControls,{api:{request(){calls++;throw Error('Unexpected request during read-only render');}},detail,draft,setDraft(){calls++;},disabled:false}));
  for(const expected of ['时限提议先进入待确认状态','本人确认此事项','由MDM组长','登记已确认事项','办理截止日期','提交材料与办理时限历史','Ctrl','Shift'])assert(html.includes(expected),expected);
  assert(html.indexOf('时限提议先进入待确认状态')<html.indexOf('<form'));
  assert.match(html,/type="date" required="" value="2026-11-05"/);
  assert.match(html,/multiple="" required="" aria-label="参与时限约定的部门" aria-describedby="deadline-department-selection-help"/);
  assert.match(html,/type="submit">保存本次办理/);
  assert(html.includes('合成原因仍保留')&&html.includes('合成依据仍保留'));
  assert.equal(calls,0);assert.deepEqual({detail,draft},original);
});
