import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {roleCompletionPresentation,roleGuidanceResult} from '../src/rolePresentation.js';
import {submissionSummary} from '../src/submissionSummaryPresentation.js';
const require = createRequire(import.meta.url);
const {getAccessModel} = require('../../server/roleDefinitions.js');

test('all fixed roles receive precise result locations without changing their authority or source model',()=>{
  const model=getAccessModel(),before=structuredClone(model);
  for(const role of model.roles){
    const projected=roleCompletionPresentation({...role,owned:true});
    assert.match(projected.resultGuidance,/“[^”]+”/);
    for(const key of ['code','goal','permissions','firstEntry','visibleTabs','raciResponsibilities','doneCriteria'])assert.deepEqual(projected[key],role[key]);
    assert(!projected.workflow.join(' ').includes('MDM结构卡口'));
  }
  assert.deepEqual(model,before);
  assert.match(roleCompletionPresentation(model.roles.find(r=>r.code==='data_quality_auditor')).resultGuidance,/当前没有审计发现/);
  const unknown={code:'unrecognized',goal:'原说明'};assert.equal(roleCompletionPresentation(unknown),unknown);
});
test('only an owned explicit guide or its unique exact priority projection receives generic role result guidance',()=>{
  const roles=[{code:'mdm_lead',owned:true},{code:'admin',owned:false}];
  const guide={type:'guidance',id:'guide:mdm_lead',roleCode:'mdm_lead',title:'组长办理说明',target:'/app/data-governance'};
  const before=structuredClone({roles,guide});
  assert.match(roleGuidanceResult(guide,roles),/已记录的治理结论/);
  assert.equal(roleGuidanceResult({title:guide.title,target:guide.target},roles,[guide]),roleGuidanceResult(guide,roles));
  assert.equal(roleGuidanceResult({title:guide.title,target:guide.target},roles,[guide,{...guide}]),'');
  assert.equal(roleGuidanceResult({...guide,type:'business',id:'business'},roles), '');
  assert.equal(roleGuidanceResult({...guide,type:'business',id:'business'},roles,[guide]), '');
  assert.equal(roleGuidanceResult({...guide,roleCode:'admin'},roles), '');
  const fallback={type:'guidance',id:'guide:0',roleHint:'mdm_lead',title:guide.title,target:guide.target};
  assert.equal(roleGuidanceResult(fallback,roles),roleGuidanceResult(guide,roles));
  assert.equal(roleGuidanceResult({title:fallback.title,target:fallback.target},roles,[fallback]),roleGuidanceResult(guide,roles));
  assert.deepEqual({roles,guide},before);
});
test('known saved technical summary phrases preserve the business explanation while original values remain exact',()=>{
  const original={revision_reason:'根据用户已确认的Q33、Q34，将原生编制表达升级为V9，明确独立记录集合，保留原修订和历史。',change_summary:'原案例保留，本次不重传或改写JSON正文。'};
  const before=structuredClone(original);
  assert.match(submissionSummary(original.revision_reason),/此项说明的业务说明待补充.*哪份业务记录.*具体改了什么/);
  assert.equal(submissionSummary(original.change_summary),'原案例保留，本次不重传或改写原编制正文。');
  assert.deepEqual(original,before);
});
test('unknown technical summaries remain explicit gaps, while business document numbers and ordinary text remain unchanged',()=>{
  for(const value of ['JSON','V9','Q33、Q34','按Q33和Q34修订办理说明。','GET /api/example','{"schema_version":"v9"}'])assert.match(submissionSummary(value,'修订原因'),/修订原因的原说明含技术标记/);
  for(const value of ['GLTX-JY-27-A','Q235材料核对','采购订单由采购员核对后保存。'])assert.equal(submissionSummary(value),value);
  assert.equal(submissionSummary(null),'未记录');
});
