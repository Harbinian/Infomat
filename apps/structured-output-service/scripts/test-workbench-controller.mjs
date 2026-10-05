import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { createWorkbenchController } from '../frontend/controller.mjs';
import { catalog, resolve, fields, clone, newEntity, pendingLifecycle, dynamicDepartmentOptions } from '../frontend/model.mjs';
import { DOMAIN_MODULE_FILES } from '../frontend/bridge.mjs';
const require=createRequire(import.meta.url),modules=Object.fromEntries(DOMAIN_MODULE_FILES.map(({name,file})=>[name,require(`../public/${file}`)]));
const server=require('../server.js');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const schema=require('../../../docs/contracts/process-governance-v8.schema.json');
function fixture() {
  const document=server.createEmptyProcessGovernanceDocument();
  document.process.process_name='付款申请';document.process.owning_department='财务部';
  document.behaviors=[{...newEntity('behavior','b_start'),behavior_name:'提交申请'},{...newEntity('behavior','b_review'),behavior_name:'复核申请'}];
  document.flow_relations=[{relation_ref:'rel_main',relation_type:'sequence',from_behavior_ref:'b_start',to_behavior_ref:'b_review',condition:''}];
  document.data_objects=[{...newEntity('data','data_request'),data_name:'申请信息',fields:[{field_ref:'field_amount',field_name:'编码',field_type:'金额',definition:'申请金额'}],behavior_links:[{link_ref:'dl_create',behavior_ref:'b_start',operation:'create',updated_field_refs:[]}]},{...newEntity('data','data_other'),data_name:'其他信息',fields:[{field_ref:'field_other',field_name:'编码',field_type:'文本',definition:'其他编码'}]}];
  document.forms=[{...newEntity('form','form_request'),form_name:'付款单',areas:[{...newEntity('form-area','area_main'),area_type:'基本信息',area_title:'基本信息',items:[{...newEntity('form-item','item_amount'),item_name:'付款金额',business_data_ref:'data_request',data_field_ref:'field_amount',item_type:'金额'}]}]}];
  document.terms=[{term_ref:'term_example',term_name:'测试术语',definition:'原定义'}];return document;
}
async function make(extra={}) {
  const downloads=[];const controller=createWorkbenchController({modules,template:fixture(),schema,initialDirty:false,enums:{fieldType:['文本','金额','部门','人员']},validate:(document)=>Promise.resolve({...server.processGovernanceValidationResult(document),data:clone(document)}),digest,downloadFile:async result=>downloads.push(result),...extra});
  assert.equal((await controller.dispatch({type:'init'})).ok,true);return {controller,downloads};
}
const objectTarget={kind:'behavior',ref:'b_start',parentRef:''};
let count=0;
async function test(name,run) {await run();count+=1;process.stdout.write(`PASS ${name}\n`);}
await test('stable immutable snapshot, unsubscribe and destroyed controller',async()=>{
  const {controller:c}=await make(),first=c.getSnapshot();assert.strictEqual(c.getSnapshot(),first);assert(Object.isFrozen(first.document));let calls=0;const unsubscribe=c.subscribe(()=>calls++);
  await c.dispatch({type:'select',target:objectTarget});assert.equal(calls,1);unsubscribe();await c.dispatch({type:'close-detail'});assert.equal(calls,1);c.destroy();assert.equal((await c.dispatch('check')).destroyed,true);
});
await test('snapshot document identity is stable across input, viewport and view changes',async()=>{
  const {controller:c}=await make();const document=c.getSnapshot().document;await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'当天'});await c.dispatch({type:'viewport',view:'flow',viewport:{zoom:1,pan:{x:3,y:4}}});assert.strictEqual(c.getSnapshot().document,document);await c.dispatch('apply');assert.notStrictEqual(c.getSnapshot().document,document);assert.equal(c.getSnapshot().checks.stale,true);c.destroy();
});
await test('object field patch and explicit editing persists across applied selections',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'behavior_name',value:'录入并提交申请'});
  assert.equal(c.getSnapshot().document.behaviors[0].behavior_name,'提交申请');assert.equal(c.getSnapshot().pending,true);assert.equal((await c.dispatch('apply')).ok,true);
  assert.equal(c.getSnapshot().document.behaviors[0].behavior_name,'录入并提交申请');assert.equal(c.getSnapshot().dirty,true);assert.equal(c.getSnapshot().pending,false);
  await c.dispatch({type:'select',target:{kind:'term',ref:'term_example',parentRef:''}});assert.equal(c.getSnapshot().session.kind,'object');assert.equal(c.getSnapshot().editing,true);c.destroy();
});
await test('navigation cancellation keeps selection, viewport and input',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'viewport',view:'flow',viewport:{zoom:1.4,pan:{x:20,y:30}}});await c.dispatch({type:'update',field:'timing',value:'当天'});
  await c.dispatch({type:'select',target:{kind:'behavior',ref:'b_review'}});assert.equal(c.getSnapshot().guard.reason,'pending');assert.equal(c.getSnapshot().selection.ref,'b_start');await c.dispatch({type:'resolve-guard',choice:'continue'});
  assert.equal(c.getSnapshot().selection.ref,'b_start');assert.equal(c.getSnapshot().session.values.timing,'当天');assert.equal(c.getSnapshot().viewport.flow.zoom,1.4);c.destroy();
});
await test('guard apply and continue is atomic; failed validation keeps guard and inputs',async()=>{
  const {controller:c}=await make({validate:document=>Promise.resolve(document.behaviors[0].behavior_name==='禁止值'?{valid:false,errors:[{path:'/behaviors/0/behavior_name',code:'TEST_INVALID',message:'禁止值'}]}:{valid:true,errors:[]})});
  await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'behavior_name',value:'禁止值'});await c.dispatch({type:'view',view:'list'});
  assert.equal((await c.dispatch({type:'resolve-guard',choice:'apply'})).ok,false);assert.equal(c.getSnapshot().view,'flow');assert.equal(c.getSnapshot().pending,true);assert.equal(c.getSnapshot().guard.reason,'pending');
  await c.dispatch({type:'update',field:'behavior_name',value:'可用值'});await c.dispatch({type:'resolve-guard',choice:'apply'});assert.equal(c.getSnapshot().view,'list');assert.equal(c.getSnapshot().pending,false);c.destroy();
});
await test('old async response and timeout cannot write document or history',async()=>{
  let release;const {controller:c}=await make({validate:()=>new Promise(resolve=>release=resolve),timeoutMs:50});await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'behavior_name',value:'较旧输入'});
  const apply=c.dispatch('apply');await new Promise(resolve=>setTimeout(resolve,5));await c.dispatch({type:'update',field:'behavior_name',value:'最新输入'});release({valid:true,errors:[]});
  const result=await apply;assert.equal(result.ok,false);assert.equal(c.getSnapshot().document.behaviors[0].behavior_name,'提交申请');assert.equal(c.getSnapshot().session.values.behavior_name,'最新输入');assert.equal(c.getSnapshot().history.canUndo,false);c.destroy();
});
await test('real timeout preserves pending input',async()=>{
  const {controller:c}=await make({validate:()=>new Promise(()=>{}),timeoutMs:10});await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'behavior_name',value:'保留输入'});assert.equal((await c.dispatch('apply')).ok,false);assert.equal(c.getSnapshot().pending,true);assert.match(c.getSnapshot().error,/超时/);c.destroy();
});
await test('grid nine tables and detail edits share entire draft across table and parent changes',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});assert.equal(c.getSnapshot().session.definitions.length,9);
  await c.dispatch({type:'grid-update',tableId:'data_objects',rowId:'data_request',column:'description',value:'表格输入'});await c.dispatch({type:'grid-table',tableId:'form_items',parentRef:'area_main'});await c.dispatch({type:'grid-select',tableId:'form_items',rowId:'item_amount'});await c.dispatch({type:'update',field:'instructions',value:'详情输入'});await c.dispatch('close-detail');await c.dispatch({type:'grid-table',tableId:'data_fields',parentRef:'data_other'});
  assert.equal(c.getSnapshot().session.tables.data_objects[0].description,'表格输入');assert.equal(c.getSnapshot().session.tables.form_items[0].instructions,'详情输入');assert.equal(c.getSnapshot().document.data_objects[0].description,'');
  assert.equal((await c.dispatch('grid-apply')).ok,true);assert.equal(c.getSnapshot().document.data_objects[0].description,'表格输入');assert.equal(c.getSnapshot().document.forms[0].areas[0].items[0].instructions,'详情输入');assert.equal(c.getSnapshot().history.undoCount,1);c.destroy();
});
await test('grid parent empty and invalid owner refuse additions',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});const count=c.getSnapshot().session.tables.data_fields.length;
  assert.equal((await c.dispatch({type:'grid-add',tableId:'data_fields',parentRef:''})).ok,false);assert.equal((await c.dispatch({type:'grid-add',tableId:'data_fields',parentRef:'absent'})).ok,false);assert.equal(c.getSnapshot().session.tables.data_fields.length,count);c.destroy();
});
await test('field reuse changes reference/type/owner together and retains display instructions',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-update',tableId:'form_items',rowId:'item_amount',column:'data_field_ref',value:'field_other'});
  const row=c.getSnapshot().session.tables.form_items[0];assert.equal(row.business_data_ref,'data_other');assert.equal(row.item_type,'文本');assert.equal(row.item_name,'付款金额');assert.equal((await c.dispatch('grid-apply')).ok,true);c.destroy();
});
await test('atomic paste rolls back all cells on ambiguous or bad option',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});const before=JSON.stringify(c.getSnapshot().session.tables);
  assert.equal((await c.dispatch({type:'grid-paste',tableId:'data_objects',rowId:'data_request',column:'data_name',matrix:[['新名称','不存在类型']]})).ok,false);assert.equal(JSON.stringify(c.getSnapshot().session.tables),before);
  assert.equal((await c.dispatch({type:'grid-paste',tableId:'data_objects',rowId:'data_request',column:'data_name',matrix:[['新名称','业务信息']]})).ok,true);assert.equal(c.getSnapshot().session.tables.data_objects[0].data_name,'新名称');c.destroy();
});
await test('referenced deletion and ownership are blocked without cascade',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:{kind:'data-field',ref:'field_amount',parentRef:'data_request'}});assert.equal((await c.dispatch('delete')).ok,false);assert.equal(c.getSnapshot().document.data_objects[0].fields.length,1);
  await c.dispatch({type:'select',target:{kind:'form-area',ref:'area_main',parentRef:'form_request'}});assert.equal((await c.dispatch('delete')).ok,false);assert.equal(c.getSnapshot().document.forms[0].areas.length,1);c.destroy();
});
await test('deletion requires confirm and creates one reversible transaction',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:{kind:'term',ref:'term_example'}});await c.dispatch('delete');assert.equal(c.getSnapshot().guard.reason,'delete');assert.equal(c.getSnapshot().document.terms.length,1);
  await c.dispatch({type:'resolve-guard',choice:'discard'});assert.equal(c.getSnapshot().document.terms.length,0);assert.equal(c.getSnapshot().history.undoCount,1);await c.dispatch('undo');assert.equal(c.getSnapshot().document.terms.length,1);await c.dispatch('redo');assert.equal(c.getSnapshot().document.terms.length,0);c.destroy();
});
await test('download actual bytes digest and new input remain pending after save',async()=>{
  let proceed;const saved=[],{controller:c}=await make({downloadFile:result=>{saved.push(result);return new Promise(resolve=>proceed=resolve);}});await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');
  const downloading=c.dispatch('download');await new Promise(resolve=>setTimeout(resolve,0));await c.dispatch({type:'update',field:'timing',value:'下载过程中输入'});proceed();assert.equal((await downloading).ok,true);assert.equal(c.getSnapshot().pending,true);
  assert.equal(c.getSnapshot().download.digest,digest(saved[0].bytes));assert.equal(c.getSnapshot().download.byteLength,saved[0].bytes.byteLength);assert.equal(JSON.parse(new TextDecoder().decode(saved[0].bytes)).behaviors[0].timing,null);assert.equal(c.getSnapshot().session.values.timing,'下载过程中输入');c.destroy();
});
await test('draft download remains independent of structure validation',async()=>{
  const {controller:c,downloads}=await make({validate:()=>Promise.resolve({valid:false,errors:[{path:'/process/process_name',message:'结构问题'}]})});await c.dispatch('check');assert.equal(c.getSnapshot().checks.valid,false);assert.equal((await c.dispatch('download')).ok,true);assert.equal(downloads.length,1);c.destroy();
});
await test('failed import preserves current candidate, history, selection and input',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'保留'});const before=c.getSnapshot();await c.dispatch({type:'import',text:'invalid',fileName:'bad.json'});await c.dispatch({type:'resolve-guard',choice:'continue'});
  assert.equal(c.getSnapshot().candidateKey,before.candidateKey);assert.equal(c.getSnapshot().selection.ref,before.selection.ref);assert.equal(c.getSnapshot().session.values.timing,'保留');await c.dispatch('cancel');const key=c.getSnapshot().candidateKey;assert.equal((await c.dispatch({type:'import',text:'invalid'})).ok,false);assert.equal(c.getSnapshot().candidateKey,key);c.destroy();
});
await test('discard then failed import leaves original visible session intact',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'原输入'});await c.dispatch({type:'viewport',view:'flow',viewport:{zoom:2,pan:{x:40,y:50}}});const before=c.getSnapshot();await c.dispatch({type:'import',text:'invalid'});assert.equal((await c.dispatch({type:'resolve-guard',choice:'discard'})).ok,false);
  assert.equal(c.getSnapshot().pending,true);assert.equal(c.getSnapshot().selection.ref,before.selection.ref);assert.equal(c.getSnapshot().session.values.timing,'原输入');assert.deepEqual(c.getSnapshot().viewport,before.viewport);c.destroy();
});
await test('passive viewport feedback preserves failed import diagnostics and pending inputs',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'保留输入'});
  await c.dispatch({type:'import',text:'invalid'});assert.equal((await c.dispatch({type:'resolve-guard',choice:'discard'})).ok,false);
  const failed=c.getSnapshot();assert.match(failed.error,/文件不是有效 JSON/);
  for(const view of ['flow','relations']) {
    await c.dispatch({type:'viewport',view,viewport:{zoom:0.4,pan:{x:24,y:36},width:1200,height:500}});
    const after=c.getSnapshot();assert.equal(after.error,failed.error);assert.equal(after.pending,true);assert.strictEqual(after.document,failed.document);assert.equal(after.candidateKey,failed.candidateKey);assert.deepEqual(after.selection,failed.selection);assert.equal(after.session.values.timing,'保留输入');assert.deepEqual(after.history,failed.history);
  }
  c.destroy();
});
await test('discard then cancel second dirty guard restores all original inputs',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'已应用'});await c.dispatch('apply');await c.dispatch({type:'update',field:'timing',value:'未应用'});await c.dispatch({type:'new'});await c.dispatch({type:'resolve-guard',choice:'discard'});assert.equal(c.getSnapshot().guard.reason,'dirty');await c.dispatch({type:'resolve-guard',choice:'continue'});assert.equal(c.getSnapshot().session.values.timing,'未应用');assert.equal(c.getSnapshot().document.behaviors[0].timing,'已应用');assert.equal(c.getSnapshot().pending,true);c.destroy();
});
await test('download and continue catches new input before destructive continuation',async()=>{
  let proceed;const {controller:c}=await make({downloadFile:()=>new Promise(resolve=>proceed=resolve)});await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'已应用'});await c.dispatch('apply');await c.dispatch({type:'new'});assert.equal(c.getSnapshot().guard.reason,'dirty');const saving=c.dispatch({type:'resolve-guard',choice:'apply'});await new Promise(resolve=>setTimeout(resolve,0));await c.dispatch({type:'update',field:'timing',value:'保存期间的新输入'});proceed();await saving;assert.equal(c.getSnapshot().guard.reason,'pending');assert.equal(c.getSnapshot().session.values.timing,'保存期间的新输入');assert.equal(c.getSnapshot().document.process.process_name,'付款申请');c.destroy();
});
await test('late validation after timeout cannot commit even if transport ignores abort',async()=>{
  let release;const {controller:c}=await make({validate:()=>new Promise(resolve=>release=resolve),timeoutMs:10});await c.dispatch({type:'select',target:objectTarget});await c.dispatch('edit');await c.dispatch({type:'update',field:'timing',value:'迟到验证'});await c.dispatch('apply');release({valid:true,errors:[]});await new Promise(resolve=>setTimeout(resolve,0));release({valid:true,errors:[]});await new Promise(resolve=>setTimeout(resolve,0));assert.equal(c.getSnapshot().document.behaviors[0].timing,null);assert.equal(c.getSnapshot().history.canUndo,false);assert.equal(c.getSnapshot().pending,true);c.destroy();
});
await test('grid form detail and unmapped selection preserve stable row identity',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-select',tableId:'forms',rowId:'form_request'});assert.equal(c.getSnapshot().selection.ref,'form_request');await c.dispatch({type:'select',target:{kind:'process',ref:c.getSnapshot().document.process.process_ref}});assert.equal(c.getSnapshot().session.rowId,'');c.destroy();
});
await test('field ownership options use latest patch; derived display type follows definition',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:{kind:'form-item',ref:'item_amount',parentRef:'form_request'}});await c.dispatch('edit');await c.dispatch({type:'update',field:'business_data_ref',value:'data_other'});const options=c.getSnapshot().session.fields.find(item=>item.key==='data_field_ref').options;assert(options.some(option=>option.value==='field_other'));assert(options.some(option=>option.value==='field_amount'&&option.disabled));assert.equal((await c.dispatch({type:'update',field:'item_type',value:'文本'})).ok,false);await c.dispatch('cancel');await c.dispatch({type:'select',target:{kind:'data-field',ref:'field_amount',parentRef:'data_request'}});await c.dispatch({type:'update',field:'field_type',value:'文本'});assert.equal((await c.dispatch('apply')).ok,true);assert.equal(c.getSnapshot().document.forms[0].areas[0].items[0].item_type,'文本');c.destroy();
});
await test('grid unrelated edit preserves pre-existing invalid raw reference',async()=>{
  const document=fixture();document.forms[0].areas[0].items[0].data_field_ref=' missing_field ';const {controller:c}=await make({template:document});await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-update',tableId:'data_objects',rowId:'data_other',column:'description',value:'独立说明'});assert.equal((await c.dispatch('grid-apply')).ok,true);assert.equal(c.getSnapshot().document.forms[0].areas[0].items[0].data_field_ref,' missing_field ');assert.equal(c.getSnapshot().document.data_objects[1].description,'独立说明');c.destroy();
});
await test('supported V7 migration is in memory, repeat import does not duplicate',async()=>{
  const {controller:c}=await make();const old=fixture();old.schema_version='process-governance-v7';old.migration.source_schema_version='process-governance-v7';const bytes=JSON.stringify(old);
  assert.equal((await c.dispatch({type:'import',text:bytes,fileName:'old.json'})).ok,true);assert.equal(c.getSnapshot().document.schema_version,'process-governance-v8');assert.equal(old.schema_version,'process-governance-v7');const exportText=JSON.stringify(c.getSnapshot().document);await c.dispatch('download');assert.equal((await c.dispatch({type:'import',text:exportText})).ok,true);assert.equal(c.getSnapshot().document.data_objects.length,2);c.destroy();
});
await test('all supported V1 through V6 import through controller and preserve source bytes',async()=>{
  const {createProcessVersionFixture}=require('./process-version-fixtures.js');
  for(const version of ['process-governance-v1','process-governance-v2','process-governance-v3','process-governance-v4','process-governance-v5','process-governance-v6']) {
    const {controller:c}=await make(),source=createProcessVersionFixture(version),bytes=JSON.stringify(source);assert.equal((await c.dispatch({type:'import',text:bytes,fileName:`${version}.json`})).ok,true,version);assert.equal(c.getSnapshot().document.schema_version,'process-governance-v8');assert.equal(JSON.stringify(source),bytes);c.destroy();
  }
});
await test('object identity and fields preserve exact raw reference and ambiguity',async()=>{
  const document=fixture();assert.equal(resolve(document,{kind:'data-field',ref:'field_amount'}).status,'missing-parent');assert.equal(resolve(document,{kind:'data-field',ref:'field_amount',parentRef:'data_other'}).status,'wrong-parent');
  document.export_meta.package_ref='field_amount';assert.equal(resolve(document,{kind:'data-field',ref:'field_amount',parentRef:'data_request'}).status,'ambiguous');
  document.export_meta.package_ref='pkg_unique';document.behaviors[1].actor_department_data_ref=' data_request ';const options=fields(document,{kind:'behavior',ref:'b_review'},{fieldType:['部门','人员']},modules).find(item=>item.key==='actor_department_data_ref').options;
  assert(options.some(option=>option.value===' data_request '&&option.disabled));assert(options.some(option=>option.value==='data_request'&&!option.disabled));assert(fields(document,{kind:'data-field',ref:'field_amount',parentRef:'data_request'},{fieldType:['部门','人员']},modules).find(item=>item.key==='field_type').options.some(option=>option.value==='人员'));
});
await test('dynamic departments reuse source availability and reject later/cyclic data',async()=>{
  const document=fixture();document.data_objects[1].source_relations=[{source_ref:'source_external',source_department:'采购',source_process_name:'前置流程',source_behavior_name:'登记',source_data_name:'已有数据',availability_mode:'process_start',available_from_behavior_ref:null}];
  assert(dynamicDepartmentOptions(document,'b_start',modules).some(option=>option.value==='data_other'));assert(!dynamicDepartmentOptions(document,'b_start',modules).some(option=>option.value==='data_request'));
});
await test('new child object draft owns explicit parent, invalid additions preserve old content',async()=>{
  const {controller:c}=await make();const before=c.getSnapshot().document;assert.equal((await c.dispatch({type:'add',kind:'data-field',parentRef:''})).ok,false);assert.equal(c.getSnapshot().document.data_objects[0].fields.length,1);
  assert.equal((await c.dispatch({type:'add',kind:'data-field',parentRef:'data_request'})).ok,true);assert.equal(c.getSnapshot().pending,true);await c.dispatch({type:'update',field:'field_name',value:'申请部门'});await c.dispatch({type:'update',field:'field_type',value:'部门'});assert.equal((await c.dispatch('apply')).ok,true);assert.equal(c.getSnapshot().document.data_objects[0].fields.length,2);assert.equal(c.getSnapshot().document.data_objects[1].fields.length,before.data_objects[1].fields.length);c.destroy();
});
await test('nested additions use explicit area, item and lifecycle owners',async()=>{
  const {controller:c}=await make();assert.equal((await c.dispatch({type:'add',kind:'form-item',parentRef:'area_main'})).ok,true);const itemRef=c.getSnapshot().selection.ref;assert.equal(c.getSnapshot().selection.parentRef,'form_request');assert.equal(c.getSnapshot().selection.areaRef,'area_main');assert.equal((await c.dispatch('apply')).ok,true);assert.equal(c.getSnapshot().document.forms[0].areas[0].items.length,2);
  assert.equal((await c.dispatch({type:'add',kind:'field-source',parentRef:itemRef})).ok,true);await c.dispatch('cancel');assert.equal((await c.dispatch({type:'add',kind:'lifecycle-route',parentRef:'data_request'})).ok,true);const routeRef=c.getSnapshot().selection.ref;assert.equal((await c.dispatch('apply')).ok,true);assert.equal((await c.dispatch({type:'add',kind:'lifecycle-event',parentRef:routeRef})).ok,true);assert.equal(c.getSnapshot().selection.parentRef,routeRef);assert.equal((await c.dispatch('apply')).ok,true);assert.equal(c.getSnapshot().document.data_objects[0].lifecycle.routes[0].events.length,1);c.destroy();
});
await test('batch form references operate on grid draft and require each required flag',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-update',tableId:'data_fields',rowId:'field_other',column:'definition',value:'表格内定义'});
  const action={type:'reuse-fields',formRef:'form_request',areaRef:'area_main',fieldRefs:['field_other']};assert.equal((await c.dispatch(action)).ok,false);assert.equal((await c.dispatch({...action,requiredByFieldRef:{field_other:false}})).ok,true);assert.equal(c.getSnapshot().session.tables.form_items.length,2);assert.equal(c.getSnapshot().session.tables.data_fields.find(row=>row._row_id==='field_other').definition,'表格内定义');assert.equal(c.getSnapshot().document.forms[0].areas[0].items.length,1);assert.equal((await c.dispatch('grid-apply')).ok,true);c.destroy();
});
await test('reuse picker owns visible choices and guards prior object session',async()=>{
  const {controller:c}=await make();const target={kind:'form-area',ref:'area_main',parentRef:'form_request'};await c.dispatch({type:'select',target});await c.dispatch('edit');await c.dispatch({type:'update',field:'area_title',value:'区域待应用'});await c.dispatch({type:'reuse-picker-open',target});assert.equal(c.getSnapshot().reusePicker,null);assert.equal(c.getSnapshot().guard.reason,'pending');await c.dispatch({type:'resolve-guard',choice:'continue'});assert.equal(c.getSnapshot().session.values.area_title,'区域待应用');await c.dispatch({type:'reuse-picker-open',target});await c.dispatch({type:'resolve-guard',choice:'discard'});assert.deepEqual(c.getSnapshot().reusePicker.requiredByFieldRef,{});assert.equal(c.getSnapshot().pending,false);
  await c.dispatch({type:'reuse-picker-update',fieldRefs:['field_other']});assert.equal(c.getSnapshot().pending,true);assert.equal((await c.dispatch('reuse-picker-apply')).ok,false);assert.deepEqual(c.getSnapshot().reusePicker.fieldRefs,['field_other']);assert.deepEqual(c.getSnapshot().reusePicker.requiredByFieldRef,{});assert.equal(c.getSnapshot().document.forms[0].areas[0].items.length,1);
  await c.dispatch({type:'reuse-picker-update',requiredByFieldRef:{field_other:false}});assert.equal((await c.dispatch('reuse-picker-apply')).ok,true);assert.equal(c.getSnapshot().reusePicker,null);assert.equal(c.getSnapshot().pending,false);assert.equal(c.getSnapshot().document.forms[0].areas[0].items.length,2);c.destroy();
});
await test('reuse picker cancel and failed application preserve shared grid draft',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-update',tableId:'data_objects',rowId:'data_other',column:'description',value:'保留表格副本'});const target={kind:'form-area',ref:'area_main',parentRef:'form_request'};await c.dispatch({type:'reuse-picker-open',target});assert(c.getSnapshot().reusePicker);await c.dispatch({type:'reuse-picker-update',fieldRefs:['field_other']});assert.equal((await c.dispatch('reuse-picker-apply')).ok,false);assert.equal(c.getSnapshot().session.tables.form_items.length,1);await c.dispatch('reuse-picker-cancel');assert.equal(c.getSnapshot().reusePicker,null);assert.equal(c.getSnapshot().session.tables.data_objects.find(row=>row._row_id==='data_other').description,'保留表格副本');assert.equal(c.getSnapshot().pending,true);
  await c.dispatch({type:'reuse-picker-open',target});await c.dispatch({type:'reuse-picker-update',fieldRefs:['field_other'],requiredByFieldRef:{field_other:true}});assert.equal((await c.dispatch('reuse-picker-apply')).ok,true);assert.equal(c.getSnapshot().reusePicker,null);assert.equal(c.getSnapshot().session.tables.form_items.length,2);assert.equal(c.getSnapshot().document.forms[0].areas[0].items.length,1);c.destroy();
});
await test('reuse picker validation failure and canceled navigation preserve choices',async()=>{
  const {controller:c}=await make({validate:document=>Promise.resolve(document.forms[0].areas[0].items.length>1?{valid:false,errors:[{path:'/forms/0/areas/0/items/1/item_name',code:'PICKER_TEST',message:'引用申请未通过'}]}:{valid:true,errors:[]})});await c.dispatch({type:'reuse-picker-open',target:{kind:'form-area',ref:'area_main',parentRef:'form_request'}});await c.dispatch({type:'reuse-picker-update',fieldRefs:['field_other'],requiredByFieldRef:{field_other:false}});assert.equal((await c.dispatch('reuse-picker-apply')).ok,false);assert.deepEqual(c.getSnapshot().reusePicker.fieldRefs,['field_other']);assert.equal(c.getSnapshot().pending,true);
  await c.dispatch({type:'new'});assert.equal(c.getSnapshot().guard.reason,'pending');await c.dispatch({type:'resolve-guard',choice:'continue'});assert.equal(c.getSnapshot().pending,true);assert.deepEqual(c.getSnapshot().reusePicker.requiredByFieldRef,{field_other:false});await c.dispatch({type:'import',text:'invalid'});await c.dispatch({type:'resolve-guard',choice:'discard'});assert.equal(c.getSnapshot().pending,true);assert.deepEqual(c.getSnapshot().reusePicker.fieldRefs,['field_other']);c.destroy();assert.equal(c.getSnapshot().reusePicker,null);
});
await test('reference navigation rechecks source after guard application',async()=>{
  const {controller:c}=await make();const target={kind:'form-item',ref:'item_amount',parentRef:'form_request'};await c.dispatch({type:'select',target});await c.dispatch('edit');await c.dispatch({type:'viewport',view:'flow',viewport:{zoom:1.7,pan:{x:22,y:44}}});const entry=modules.ElementReferences.buildCatalog(c.getSnapshot().document).references.find(item=>item.path.endsWith('/data_field_ref'));await c.dispatch({type:'update',field:'data_field_ref',value:'field_other'});await c.dispatch({type:'select-reference',reference:clone(entry),direction:'outgoing',target:entry.elementTarget||entry.target});assert.equal(c.getSnapshot().guard.reason,'pending');assert.equal((await c.dispatch({type:'resolve-guard',choice:'apply'})).ok,false);assert.equal(c.getSnapshot().selection.ref,'item_amount');assert.equal(c.getSnapshot().view,'flow');assert.equal(c.getSnapshot().viewport.flow.zoom,1.7);assert.equal(c.getSnapshot().document.forms[0].areas[0].items[0].data_field_ref,'field_other');assert.match(c.getSnapshot().error,/引用.*变化/);c.destroy();
});
await test('reference navigation discard can navigate unchanged reference with ownership intact',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:{kind:'form-item',ref:'item_amount',parentRef:'form_request'}});await c.dispatch('edit');const entry=modules.ElementReferences.buildCatalog(c.getSnapshot().document).references.find(item=>item.path.endsWith('/data_field_ref'));await c.dispatch({type:'update',field:'instructions',value:'丢弃本次修改'});await c.dispatch({type:'select-reference',reference:clone(entry),direction:'outgoing',target:entry.elementTarget||entry.target});assert.equal((await c.dispatch({type:'resolve-guard',choice:'discard'})).ok,true);assert.equal(c.getSnapshot().selection.ref,'field_amount');assert.equal(c.getSnapshot().selection.parentRef,'data_request');assert.equal(c.getSnapshot().document.forms[0].areas[0].items[0].instructions,'');c.destroy();
});
await test('issue focus and new grid row enter the actual owning editor',async()=>{
  const {controller:c}=await make({validate:()=>Promise.resolve({valid:false,errors:[{path:'/behaviors/0/timing',code:'FOCUS_TEST',message:'补充时限'}]})});await c.dispatch('check');const issue=c.getSnapshot().checks.issues[0];assert.equal(issue.target.ref,'b_start');await c.dispatch({type:'focus-issue',issue});assert.equal(c.getSnapshot().editing,true);assert.equal(c.getSnapshot().session.kind,'object');assert.equal(c.getSnapshot().focus.field,'timing');assert.equal(c.getSnapshot().focus.target.ref,'b_start');await c.dispatch({type:'view',view:'grid'});await c.dispatch({type:'grid-add',tableId:'data_fields',parentRef:'data_request'});assert.equal(c.getSnapshot().focus.tableId,'data_fields');assert.equal(c.getSnapshot().focus.field,'field_name');assert.equal(c.getSnapshot().focus.rowId,c.getSnapshot().session.rowId);c.destroy();
});
await test('return from relationships handles an explicitly deleted original object',async()=>{
  const {controller:c}=await make();await c.dispatch({type:'select',target:{kind:'term',ref:'term_example'}});await c.dispatch('edit');await c.dispatch({type:'viewport',view:'flow',viewport:{zoom:1.3,pan:{x:16,y:24}}});await c.dispatch({type:'relations'});await c.dispatch({type:'delete'});await c.dispatch({type:'resolve-guard',choice:'discard'});assert.equal(c.getSnapshot().document.terms.length,0);assert.equal((await c.dispatch('return-flow')).ok,true);assert.equal(c.getSnapshot().selection,null);assert.equal(c.getSnapshot().view,'flow');assert.equal(c.getSnapshot().detailOpen,false);assert.equal(c.getSnapshot().viewport.flow.zoom,1.3);c.destroy();
});
process.stdout.write(`Workbench controller: ${count} behavior groups passed.\n`);
