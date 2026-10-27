import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};return next(url,context);}});
const {BusinessDetails}=await import('../src/BusinessDetails.jsx');
const {SubmissionReview,CaseGovernanceHistory}=await import('../src/SubmissionReview.jsx');
const {ProcessCaseControls}=await import('../src/ProcessCaseControls.jsx');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const departments=[{id:'91',name:'合成甲部'}];

test('folded details format known instants and keep uncertain time zones explicit without changing source',()=>{
 const value={created_at:'2026-10-22T03:14:15.123Z',registered_at:'2026-10-22T03:15:16.234Z',updated_at:'2026-10-22 11:14:15',due_date:'2026-10-30',document_no:'GLTX-JY-27-A',request_id:'internal-only'};const before=structuredClone(value),html=render(BusinessDetails,{value});
 assert.match(html,/2026-10-22 11:14:15（北京时间）/);assert.match(html,/2026-10-22 11:15:16（北京时间）/);assert.match(html,/2026-10-22 11:14:15（时区未记录）/);assert.match(html,/2026-10-30/);assert.match(html,/GLTX-JY-27-A/);assert.doesNotMatch(html,/2026-10-22T|internal-only|request_id/);assert.deepEqual(value,before);
});

test('material and deadline history expose exact read times and distinct confirmations without guessing names',()=>{
 const state={changes:[{change_id:'hidden-change',kind:'deadline',state:'pending',change:{due_date:'2026-10-30',required_department_ids:['91'],reason:'合成时限依据'},created_at:'2026-10-22T03:14:15.123Z',registered_at:null,confirmations:[{confirmation_id:'hidden-confirmation',department_id:'91',confirmed_by_person_id:'9007199254740993',created_at:'2026-10-22T03:15:16.234Z',basis_text:'合成甲部已核对日期'}]}]};const before=structuredClone(state),html=render(CaseGovernanceHistory,{state,departments});
 assert.match(html,/办理截止日期约定/);assert.match(html,/2026-10-30/);assert.match(html,/11:14:15（北京时间）/);assert.match(html,/11:15:16（北京时间）/);assert.match(html,/登记时间：时间未记录/);assert.match(html,/确认部门：合成甲部/);assert.match(html,/未提供当时人员姓名/);assert.doesNotMatch(html,/hidden-change|hidden-confirmation|9007199254740993|T03:14/);assert.deepEqual(state,before);
});

test('saved acceptance results distinguish current and older content without creating a decision',()=>{
 const state={acceptance_history:[{event_id:'hidden-a',current:true,result:{conclusion:'accepted',basis:'合成当前验收依据',evidence_refs:['合成验收表第一节']}},{event_id:'hidden-b',current:false,result:{conclusion:'not_accepted',basis:'合成旧验收依据',evidence_refs:['/api/internal-evidence']}}]};const before=structuredClone(state),html=render(CaseGovernanceHistory,{state,departments});
 assert.match(html,/验收通过/);assert.match(html,/验收未通过/);assert.match(html,/对应当前流程内容/);assert.match(html,/不能代替当前验收/);assert.match(html,/合成验收表第一节/);assert.doesNotMatch(html,/hidden-a|hidden-b|\/api\//);assert.doesNotMatch(html,/<button/);assert.deepEqual(state,before);
});

test('source descriptions and legacy missing-field messages show business text while retaining original inputs',()=>{
 const state={submission:{purpose:'合成目的',revision_reason:'合成新编',change_summary:'合成变化',sources:[{title:'来源 GET /api/synthetic',reference:'/behaviors/0/behavior_name',basis:'POST /api/synthetic'}],participants:[{department_id:'91',responsibilities:'SELECT value FROM private_table',basis:'/api/hidden'}]},changes:[],allowed_actions:[],blocking_issues:[{message:'最低提交材料待补正：sources、participants、unknown_field'}],deadline:{due_date:'2026-10-30'},lifecycle:'active'};const before=structuredClone(state);
 const html=render(SubmissionReview,{state,detail:{department_accountability:{department_id:'91'},revision:{document:{behaviors:[]}}},departments,onStart(){}});
 assert.doesNotMatch(html,/\/api\/|\/behaviors\/|sources、participants|unknown_field|SELECT value/);assert.match(html,/来源材料、参与部门及责任范围、其他必要材料/);assert.match(html,/合成目的/);assert.deepEqual(state,before);
});

test('uncertain-result recovery states that continuing may complete the original operation',()=>{
 const draft={kind:'case-control',caseId:'1',action:'confirm_submission',request_id:'hidden-request',resultUnknown:true,canRetryOriginal:true,basis:'未提交合成依据'};
 const props={api:{},detail:{case:{id:1,process_name:'合成恢复检查',current_revision_no:1,current_content_hash:'h'},revision:{document:{behaviors:[]}}},draft,setDraft(){},onBusyChange(){}};
 const html=render(ProcessCaseControls,props);assert.match(html,/本次办理结果尚未确定/);assert.match(html,/继续办理可能完成原操作/);assert.match(html,/继续办理并核对结果/);assert.doesNotMatch(html,/hidden-request|载荷|终态|请求标识/);
 const committed=render(ProcessCaseControls,{...props,draft:{...draft,receiptConfirmed:true}});assert.match(committed,/本次办理已保存，无需再次提交/);assert.doesNotMatch(committed,/继续办理并核对结果/);
});
