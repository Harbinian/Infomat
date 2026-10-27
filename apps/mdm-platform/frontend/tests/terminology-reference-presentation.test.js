import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {exactFailure,formalHistoricalName,formalReviewName,referenceFailure,referenceItems,referenceLocation,referencePayload,referencePositions,referenceSourceText,referenceSubjectPresentation,retainWriteFailure,terminologyGate} from '../src/terminologyGovernanceModel.js';
import {businessDateTime} from '../src/businessGuidance.js';
const require=createRequire(import.meta.url);
const {positions,businessPositions}=require('../../server/terminologyUsages.js');

test('candidate projection names real objects and excludes machine configuration without changing source or legacy validation',()=>{
  const source={schema_version:'process-governance-v9',process:{process_name:'合成核对流程'},terms:[{term_ref:'term_synthetic_record',term_name:'合成核对记录',definition:'仅用于合成核对'}],data_objects:[{data_id:'9007199254740993',data_name:'合成材料记录',record_model:'single_instance',fields:[{field_id:'23',field_name:'申请事项',field_type:'string',business_meaning:'本次申请的具体事项'}],behavior_links:[{behavior_ref:'7',operations:['create','read'],stage:'current_instance',presence:'required'}]}]};
  const original=JSON.stringify(source),legacy=positions(source),projected=businessPositions(source);
  assert.equal(JSON.stringify(source),original);
  assert.ok(legacy.some(row=>row.location==='/data_objects/0/record_model'&&row.source_text==='single_instance'));
  assert.ok(legacy.some(row=>row.location==='/data_objects/0/behavior_links/0/operations/0'&&row.source_text==='create'));
  assert.ok(!projected.some(row=>/record_model|field_type|operations|stage|presence|_id/.test(row.location)));
  const field=projected.find(row=>row.location==='/data_objects/0/fields/0/field_name');
  assert.equal(field.source_text,'申请事项');
  assert.match(field.label,/数据对象.*合成材料记录.*字段.*申请事项.*字段名称/);
  assert.doesNotMatch(field.label,/data_objects|fields|\/0|\[0\]/);
  assert.equal(referencePositions({source_positions:projected}).find(row=>row.location===field.location).label,field.label);
  const term=projected.find(row=>row.location==='/terms/0/term_name');
  assert.match(term.label,/术语.*合成核对记录.*术语名称/);
  assert.equal(term.source_text,'合成核对记录');
  assert.doesNotMatch(term.label,/terms|term_name|\/0/);
});

test('export metadata is not a term candidate and saved metadata judgments retain their original payload',()=>{
  const source={export_meta:{exported_at:'2026-10-22T02:57:35.271Z',compiler:'合成编制人员',initiating_department:'合成甲部',nested:{definition:'导出附加说明'}},process:{process_name:'合成业务流程',scope:'适用本次合成业务'}};
  const original=JSON.stringify(source),legacy=positions(source),projected=businessPositions(source);
  assert.equal(JSON.stringify(source),original);
  assert.equal(legacy.filter(row=>row.location.startsWith('/export_meta/')).length,4);
  assert.ok(!projected.some(row=>row.location.startsWith('/export_meta/')));
  const item={location:'/export_meta/exported_at',source_text:source.export_meta.exported_at,decision:'not_applicable',reason:'历史原判断保留'};
  assert.equal(referencePositions({source_positions:[item]}).length,0);
  assert.doesNotMatch(referenceSourceText(item),/2026-10-22|02:57:35/);
  const payload=referencePayload({target_type:'process_draft',target_id:'17'},{source_digest:'unchanged',request_id:'original-request',expected_revision:2,items:referenceItems({items:[item]})});
  assert.deepEqual(payload.items,[{...item,term_id:null,version_id:null}]);
});

test('known business fields have specific labels while business numbers remain available and internal type and data references do not',()=>{
  const source={process:{process_name:'合成业务流程',scope:'本部门合成办理',owning_department:'合成甲部'},behaviors:[{behavior_name:'核对资料',current_actor_role:'业务经办人',actor_position_rule:'由当班人员办理'}],forms:[{form_name:'合成记录表',form_no:'SYN-FORM'}],document_no:'GLTX-JY-27-A',owner:'合成甲部',actor:{name:'合成经办人'},definition:{name:'合成字段',business_meaning:'业务含义说明',data_format:'年月日',formation:'由业务记录形成',maintenance:'由责任部门维护'},type:'object',data_ref:'data_synthetic'};
  const projected=businessPositions(source);
  for(const [location,label] of [['/process/scope','适用范围'],['/process/owning_department','归口部门'],['/behaviors/0/current_actor_role','执行角色'],['/behaviors/0/actor_position_rule','岗位确定条件'],['/forms/0/form_no','表单编号'],['/document_no','制度编号'],['/owner','责任归属'],['/actor/name','办理信息'],['/definition/data_format','数据格式'],['/definition/formation','如何形成'],['/definition/maintenance','如何维护']]){
    const row=projected.find(position=>position.location===location);
    assert.ok(row,location);
    assert.ok(row.label.includes(label),row.label);
    assert.doesNotMatch(row.label,/相关业务内容/);
  }
  assert.equal(projected.find(row=>row.location==='/forms/0/form_no').source_text,'SYN-FORM');
  assert.equal(projected.find(row=>row.location==='/document_no').source_text,'GLTX-JY-27-A');
  assert.ok(!projected.some(row=>['/type','/data_ref'].includes(row.location)));
});

test('old technical judgments are retained exactly in payloads while their technical path and value are not displayed',()=>{
  const item={location:'/data_objects/0/record_model',source_text:'single_instance',decision:'not_applicable',reason:'此处属于系统配置，历史原判断保留'};
  const items=referenceItems({items:[item]});
  assert.equal(items.length,1);
  assert.equal(items[0].source_text,'single_instance');
  assert.equal(referencePositions({source_positions:[item]}).length,0);
  assert.doesNotMatch(referenceLocation({},item),/data_objects|record_model|\/0/);
  assert.doesNotMatch(referenceSourceText(item),/single_instance/);
  const payload=referencePayload({target_type:'process_draft',target_id:'17'},{source_digest:'unchanged',request_id:'original-request',expected_revision:2,items});
  assert.equal(payload.items[0].location,item.location);
  assert.equal(payload.items[0].source_text,item.source_text);
  assert.equal(payload.items[0].reason,item.reason);
});

test('unrecognized technical labels and code-like original text never become display fallbacks',()=>{
  const item={location:'/data_objects/0/data_name',source_text:'GET /api/private',label:'/data_objects/0/data_name'};
  assert.doesNotMatch(referenceLocation(null,item),/data_objects|data_name|\/0/);
  assert.doesNotMatch(referenceSourceText(item),/GET|api/);
  for(const source_text of ['single_instance','/data_objects/0/data_name','data_objects[0].data_name','authoring-workspace.json'])assert.doesNotMatch(referenceSourceText({location:'/data_objects/0/data_name',source_text}),/single_instance|data_objects|authoring-workspace/);
  assert.equal(exactFailure({code:'TERM_CONTEXT_EXISTS',serverMessage:'此语境已有同义条目'}),'此语境已有同义条目');
  assert.doesNotMatch(exactFailure({code:'MACHINE_ERROR',message:'MACHINE_ERROR'}),/MACHINE_ERROR/);
});

test('forbidden reads are distinct from incomplete review and do not infer permission or absence',()=>{
  const forbidden=referenceFailure({status:403},{reading:true});
  assert.match(forbidden.title,/不能查阅/);
  assert.match(forbidden.message,/不能据此判断/);
  assert.doesNotMatch(forbidden.title,/未完成/);
  assert.match(referenceFailure({status:503},{reading:true}).title,/暂未读到/);
  assert.match(referenceFailure({status:403},{reading:false}).message,/(?:输入|内容)仍保留/);
});

test('formal terminology gates explain current responsible actions rather than generic retry or error codes',()=>{
  const gate=terminologyGate({code:'TERM_GOVERNANCE_USAGE_REVIEW_REQUIRED',findings:[{code:'REVIEW_REQUIRED'},{code:'DEPARTMENT_CONFIRMATION_REQUIRED'},{code:'TERM_CHANGED'}]});
  assert.match(gate.title,/正式草稿/);
  assert.match(gate.message,/(?:输入|内容)仍保留/);
  assert.match(gate.steps.join(' '),/主对接人/);
  assert.match(gate.steps.join(' '),/当前负责人本人/);
  assert.doesNotMatch(JSON.stringify(gate),/TERM_|REVIEW_REQUIRED|冲突，请.*重试/);
  assert.equal(terminologyGate({code:'ANOTHER_CONFLICT'}),null);
  const request={url:'/kept-original',method:'POST',body:{request_id:'original',reason:'原输入'}};
  assert.equal(retainWriteFailure({items:[{reason:'原输入'}]},{status:503},request).submitted,request);
});

test('draft and published panels identify independent subjects without visible identities',()=>{
  const draft=referenceSubjectPresentation({target_type:'process_draft',target_id:'17'},'合成材料办理');
  const published=referenceSubjectPresentation({target_type:'process_version',target_id:'18'},'合成材料办理');
  assert.match(draft.title,/正式草稿/);
  assert.match(published.title,/已发布流程/);
  assert.notEqual(draft.refresh,published.refresh);
  assert.match(published.description,/当时固定/);
  assert.doesNotMatch(JSON.stringify([draft,published]),/process_draft|process_version|17|18/);
});

test('historical names only come from saved actor snapshots, never current joins or directory names',()=>{
  assert.equal(formalHistoricalName({actor_user_name:'当前用户新姓名',actor_name:'当前人员姓名',person_name:'当前目录姓名',decided_by_name:'当前回填姓名'}),'历史姓名未记录');
  assert.equal(formalHistoricalName({payload:{actor_snapshot:{person_name:'当时合成人员姓名'}},actor_user_name:'后来的姓名'}),'当时合成人员姓名');
  assert.equal(formalHistoricalName({actor_snapshot:{person_name:'POST /api/private'}}),'历史姓名未记录');
});

test('readable historical times do not assign an unstored timezone',()=>{
  assert.equal(businessDateTime('2026-10-22T01:23:45.123Z'),'2026-10-22 09:23:45（北京时间）');
  assert.equal(businessDateTime('2026-10-22 09:23:45'),'2026-10-22 09:23:45（时区未记录）');
  assert.equal(businessDateTime(null),'时间未记录');
});

test('review names require one exact saved task, draft, revision, content and decision event',()=>{
  const review={id:'42',draft_id:'7',draft_revision_no:3,content_hash:'fixed-content',status:'approved'};
  const event={draft_id:7,event_type:'review_approve',payload:{review_task_id:42,draft_revision_no:3,content_hash:'fixed-content',actor_snapshot:{person_name:'当时合成负责人'}}};
  assert.equal(formalReviewName(review,[event]),'当时合成负责人');
  for(const key of ['review_task_id','draft_revision_no','content_hash'])assert.equal(formalReviewName(review,[{...event,payload:{...event.payload,[key]:'different'}}]),'历史姓名未记录');
  assert.equal(formalReviewName(review,[{...event,draft_id:'8'}]),'历史姓名未记录');
  assert.equal(formalReviewName(review,[{...event,event_type:'review_reject'}]),'历史姓名未记录');
  assert.equal(formalReviewName(review,[event,event]),'历史姓名未记录');
  assert.equal(formalReviewName({...review,id:9007199254740992},[event]),'历史姓名未记录');
  assert.equal(formalReviewName(review,[{...event,payload:{...event.payload,actor_snapshot:undefined},actor_user_name:'当前新姓名'}]),'历史姓名未记录');
});
