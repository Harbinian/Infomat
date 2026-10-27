import test from 'node:test';
import assert from 'node:assert/strict';
import {dataMapSelection,dataMapPageHref,dataMapReadPaths,dataMapStatus,dataMapHandoffLinks} from '../src/dataMapReadModel.js';
const publication='d9b24416-b751-46f9-8199-74e02b5ac744',handoff='f8784870-4f68-48de-aaf7-32998cf285a5';
test('台账缺省明确读current；history和legacy必须准确context及版本，不静默回退',()=>{
  assert.deepEqual(dataMapSelection(''),{view:'current',context:'',version:'',identityField:'',error:null});
  for(const search of ['?view=history&context=1','?view=legacy_in_use&version=capture:hash','?view=unknown','?context=1&context=2','?view=current&context=1&version=x'])assert(dataMapSelection(search).error);
  const fixed=dataMapSelection('?view=history&context=9007199254741001&version='+handoff+'&identityField=9007199254741002');assert.equal(fixed.error,null);assert.equal(fixed.context,'9007199254741001');assert(dataMapReadPaths(fixed).fields.endsWith('view=history&version='+handoff));
});
test('旧快照无可还原字段集合时不发current映射读；准确回返保留上下文、视图、版本与字段',()=>{
  const old=dataMapSelection('?context=9&view=legacy_in_use&version=capture:012345&identityField=10'),paths=dataMapReadPaths(old);assert.equal(paths.contexts,null);assert.equal(paths.fields,null);assert(paths.context.includes('view=legacy_in_use&version=capture%3A012345'));
  const href=dataMapPageHref(old),back=dataMapSelection(href.slice(href.indexOf('?')));assert.deepEqual(back,old);
});
test('来源升级、撤回及历史引用资格分别表达，不以旧正文或读取成功提升现行状态',()=>{
  assert.deepEqual(dataMapStatus({availability:'source_upgrade_pending',current:null,referenceable:false}).definitionAvailable,false);
  assert.equal(dataMapStatus({availability:'withdrawn',current:null}).code,'withdrawn');
  assert.equal(dataMapStatus({view:'history',referenceable:true,new_reference_allowed:true}).newReferenceAllowed,false);
  assert.equal(dataMapStatus({view:'history',availability:'unavailable',requires_attention:true}).definitionAvailable,true);
  assert.equal(dataMapStatus({view:'legacy_in_use',original_status:'confirmed'}).code,'legacy_unapproved');
  assert.equal(dataMapStatus({referenceable:true,new_reference_allowed:true}).code,'governed');
  assert.equal(dataMapStatus({requires_attention:true,referenceable:false}).code,'requires_attention');
});
test('只以准确publication身份匹配可见包和草案，不从名称、来源或草案顺序猜归属',()=>{
  const workbench={packages:[{package_id:'2',drafts:[{handoff_id:'unrelated'}],publications:[{publication_id:publication,handoff_id:handoff,revision:3}]}]},returnTo='/app/data-map?context=9&view=current';
  const links=dataMapHandoffLinks({publication_id:publication},workbench,returnTo);assert.deepEqual(links.map(x=>x.kind),['publication','package','handoff']);assert(links.every(x=>new URL(x.href,'https://local.invalid').searchParams.get('return_to')===returnTo));assert(!links.some(x=>x.href.includes('unrelated')));
  assert.deepEqual(dataMapHandoffLinks({package_id:'2',title:'matching name'},workbench,returnTo),[]);assert.deepEqual(dataMapHandoffLinks({publication_id:publication},{packages:[...workbench.packages,...workbench.packages]},returnTo),[]);
  assert.equal(new URL(links[2].href,'https://local.invalid').searchParams.get('revision'),'3');
  assert.deepEqual(dataMapHandoffLinks({publication_id:publication},{packages:[]},returnTo),[]);
});
