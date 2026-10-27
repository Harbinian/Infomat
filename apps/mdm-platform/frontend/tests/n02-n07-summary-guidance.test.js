import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {submissionSummary} from '../src/submissionSummaryPresentation.js';
import {isOwnedRoleGuidance,roleGuidanceResult} from '../src/rolePresentation.js';

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
const {WorkItemResponsibility}=await import('../src/RoleWorkbench.jsx');
const {SubmissionReview}=await import('../src/SubmissionReview.jsx');
const model=require('../server/roleDefinitions.js').getAccessModel();

const leadGuide={type:'guidance',id:'guide:0',roleHint:'mdm_lead',title:'合成组长角色说明',target:'/app/data-governance',department:null,responsiblePerson:'当前用户'};
const roles=[{code:'mdm_lead',owned:true},{code:'department_contact',owned:true},{code:'admin',owned:false}];
const renderResponsibility=(item,inputRoles=roles,sourceItems=[leadGuide])=>renderToStaticMarkup(React.createElement(WorkItemResponsibility,{item,roles:inputRoles,sourceItems}));

test('model wording becomes a field-specific business explanation gap without inferring an affected record',()=>{
  for(const term of ['独立记录集合','追加新实例','记录模型中的存在条件','编制模型中的存在时才读取']){
    for(const label of ['编制目的','修订原因','本次变化']){
      const value=submissionSummary(`本轮说明${term}，保留原材料。`,label);
      assert.match(value,new RegExp(`${label}的业务说明待补充`));
      assert.match(value,/已明确的编制人员.*原案例.*哪份业务记录.*具体改了什么.*什么情况下需要填写或查阅/);
      assert.match(value,/原材料和历史记录保留/);
      assert(!value.includes(term));
      assert.doesNotMatch(value,/由系统认定|采购订单|姓名|确认通过/);
    }
  }
});

test('business numbers, normal conditions and explicit ordinary changes remain exact',()=>{
  for(const text of ['GLTX-JY-27-A','Q235材料核对','申请人收到退回意见后补充申请原因。','范围变化记录仅在实际提出或发生变化时形成。','本次只调整合同生效说明，仍存在条件限制。','合同存在条件变化时由经办人核对。','报价单存在时才读取合同约定的金额。','双方约定的存在条件按已确认条款执行。'])assert.equal(submissionSummary(text,'本次变化'),text);
  assert.equal(submissionSummary(''),'未记录');
  assert.equal(submissionSummary(null),'未记录');
});

test('the actual submission review renders clear gaps and retains all original saved summary fields',()=>{
  const state={submission:{purpose:'合成申请人核对申请材料。',revision_reason:'根据用户已确认的Q33、Q34，将原生编制表达升级为V9，明确独立记录集合、追加新实例及存在条件。',change_summary:'当前修订已明确独立记录集合及存在时才读取。',participants:[],sources:[]},changes:[],allowed_actions:[],blocking_issues:[]};
  const detail={department_accountability:{department_id:'81',eligible:false},revision:{document:{behaviors:[]}}};
  const before=structuredClone({state,detail});
  const html=renderToStaticMarkup(React.createElement(SubmissionReview,{state,detail,departments:[],disabled:false,editing:false,onStart(){}}));
  assert.match(html,/合成申请人核对申请材料/);
  assert.match(html,/修订原因的业务说明待补充/);
  assert.match(html,/本次变化的业务说明待补充/);
  assert.doesNotMatch(html,/Q33|Q34|V9|独立记录集合|追加新实例|存在条件|存在时才读取/);
  assert.deepEqual({state,detail},before);
});

test('all fixed owned role guides, including the MySQL guide index plus role hint, are recognized without changing roles',()=>{
  const sourceRoles=model.roles.map(role=>({...role,owned:true}));
  const before=structuredClone(sourceRoles);
  for(const role of sourceRoles){
    const guide={type:'guidance',id:'guide:0',roleHint:role.code,title:`${role.name}：合成角色说明`,target:role.firstEntry.target};
    assert(isOwnedRoleGuidance(guide,sourceRoles));
    assert(isOwnedRoleGuidance({title:guide.title,target:guide.target},sourceRoles,[guide]));
    assert(roleGuidanceResult(guide,sourceRoles));
  }
  assert.deepEqual(sourceRoles,before);
});

test('a true owned guide renders a role context rather than an unassigned department or person',()=>{
  const before=structuredClone({leadGuide,roles});
  const html=renderResponsibility(leadGuide);
  assert.match(html,/本项是角色办理指引/);
  assert.match(html,/具体责任部门、办理人员及操作资格.*原事项核对/);
  assert.doesNotMatch(html,/责任部门：|待明确|当前用户|guide:0|mdm_lead/);
  assert.deepEqual({leadGuide,roles},before);
});

test('business tasks keep their recorded department and person even when their title or target matches a guide',()=>{
  const item={...leadGuide,type:'office',id:'business:81',department:'合成甲部',responsiblePerson:'合成办理人'};
  const before=structuredClone(item);
  assert(!isOwnedRoleGuidance(item,roles,[leadGuide]));
  const html=renderResponsibility(item);
  assert.match(html,/责任部门：合成甲部/);
  assert.match(html,/办理人：合成办理人/);
  assert.doesNotMatch(html,/本项是角色办理指引|business:81/);
  assert.deepEqual(item,before);
});

test('a business or duplicate source match makes a metadata-free projection ambiguous',()=>{
  const projection={title:leadGuide.title,target:leadGuide.target};
  const business={...leadGuide,type:'office',id:'business:81'};
  for(const sources of [[leadGuide,{...leadGuide}],[leadGuide,business],[business]]){
    assert(!isOwnedRoleGuidance(projection,roles,sources));
    assert.equal(roleGuidanceResult(projection,roles,sources),'');
  }
  assert(!isOwnedRoleGuidance({...leadGuide,roleHint:'admin'},roles));
  assert(!isOwnedRoleGuidance({...leadGuide,roleHint:undefined},roles));
  assert(!isOwnedRoleGuidance(null,roles,[leadGuide]));
  assert(!isOwnedRoleGuidance({},roles,[{type:'guidance',roleHint:'mdm_lead'}]));
});

test('actual task handling guides still supply their own named actor without replacing absent business responsibility',()=>{
  const item={type:'process_case',department:'合成业务部门',responsiblePerson:'合成登记人员',handlingGuide:{actor:'合成当前办理角色'}};
  const html=renderResponsibility(item);
  assert.match(html,/责任部门：合成业务部门/);
  assert.doesNotMatch(html,/办理人：|本项是角色办理指引/);
  const missing={type:'office',department:null,responsiblePerson:null};
  const missingHtml=renderResponsibility(missing);
  assert.match(missingHtml,/责任部门：待明确.*办理人：待明确/);
});
