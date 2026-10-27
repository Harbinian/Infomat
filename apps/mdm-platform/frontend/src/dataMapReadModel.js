import {handoffWorkspaceHref,safeHandoffReturn} from './handoffNavigation.js';

const views=['current','history','legacy_in_use'];
const positive=value=>typeof value==='string'&&/^[1-9]\d*$/.test(value);
const fixedRef=value=>typeof value==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value);
export const dataMapViewNames={current:'现行受控台账',history:'固定历史版本',legacy_in_use:'旧在用快照（未经地图批准）'};
export function dataMapSelection(search=''){
  const query=new URLSearchParams(search),view=query.get('view')||'current',context=query.get('context')||'',version=query.get('version')||'',identityField=query.get('identityField')||'';
  let error=null;
  if(['context','view','version','identityField'].some(key=>query.getAll(key).length>1)||!views.includes(view)||context&&!positive(context)||identityField&&!positive(identityField)||version&&!fixedRef(version))error='台账定位参数无效，请使用准确上下文及固定版本入口。';
  else if(view!=='current'&&(!context||!version))error='历史或旧快照读取须同时明确上下文和准确固定版本。';
  else if(view==='current'&&version)error='现行读取不接受固定历史版本参数，请明确选择历史视图。';
  return {view,context,version,identityField,error};
}
export function dataMapPageHref(value){
  const query=new URLSearchParams();if(value.context)query.set('context',String(value.context));query.set('view',value.view||'current');if(value.version)query.set('version',value.version);if(value.identityField)query.set('identityField',String(value.identityField));return safeHandoffReturn('/app/data-map?'+query)||null;
}
export function dataMapReadPaths(value){
  if(value.error||!views.includes(value.view))throw new Error(value.error||'台账视图无效。');
  const query=new URLSearchParams({view:value.view});if(value.version)query.set('version',value.version);
  return {contexts:value.view==='current'?'/api/data-map/contexts?view=current':null,context:value.context?`/api/data-map/contexts/${encodeURIComponent(value.context)}?${query}`:null,fields:value.context&&value.view!=='legacy_in_use'?`/api/field-entries/mapping/${encodeURIComponent(value.context)}?${query}`:null};
}
export function dataMapStatus(value={},view=value.view||'current'){
  if(view==='legacy_in_use'||value.governance_status==='legacy_unapproved')return {code:'legacy_unapproved',label:'旧在用快照，未经地图批准',tone:'warning',definitionAvailable:true,newReferenceAllowed:false};
  if(view==='history'){const attention=value.requires_attention===true||['withdrawn','unavailable','requires_attention'].includes(value.availability);return {code:'history',label:attention?'固定历史只读，当前引用状态需处理':'固定历史只读',tone:attention?'warning':'neutral',definitionAvailable:true,newReferenceAllowed:false};}
  if(value.availability==='source_upgrade_pending')return {code:'source_upgrade_pending',label:'来源已升级，治理承接待完成',tone:'warning',definitionAvailable:false,newReferenceAllowed:false};
  if(value.availability==='withdrawn'||value.producer_status==='withdrawn')return {code:'withdrawn',label:'原发布已撤回，需处理',tone:'warning',definitionAvailable:false,newReferenceAllowed:false};
  if(value.current===null||['unavailable','maintenance'].includes(value.availability))return {code:value.availability||'unavailable',label:value.availability==='maintenance'?'当前为维护状态':'无可用现行版本',tone:'warning',definitionAvailable:false,newReferenceAllowed:false};
  if(value.requires_attention===true||value.new_reference_allowed===false&&['needs_reference_review','requires_attention'].includes(value.governance_status))return {code:'requires_attention',label:'固定内容保留，依赖需处理',tone:'warning',definitionAvailable:true,newReferenceAllowed:false};
  if(value.referenceable===true&&value.new_reference_allowed===true)return {code:'governed',label:'现行受控版本',tone:'success',definitionAvailable:true,newReferenceAllowed:true};
  return {code:'unconfirmed',label:'当前引用资格待核对',tone:'warning',definitionAvailable:true,newReferenceAllowed:false};
}
export function dataMapHandoffLinks(context,workbench,returnTo){
  const publicationId=context?.publication_id;
  if(!uuid(publicationId)||!Array.isArray(workbench?.packages))return [];
  const matches=workbench.packages.flatMap(pkg=>(pkg.publications||[]).filter(pub=>pub.publication_id===publicationId).map(pub=>({pkg,pub})));
  if(matches.length!==1)return [];
  const {pkg,pub}=matches[0];if(!positive(String(pkg.package_id)))return [];
  const revision=Number(pub.revision),targets=[{label:'查看本次承接发布',kind:'publication',id:publicationId},{label:'查看来源工作包',kind:'package',id:String(pkg.package_id)},...(uuid(pub.handoff_id)&&Number.isSafeInteger(revision)&&revision>0?[{label:'查看准确承接草案',kind:'handoff',id:pub.handoff_id,revision}]:[])];
  return targets.map(target=>({...target,href:handoffWorkspaceHref({kind:target.kind,id:target.id,...(target.revision?{revision:target.revision}:{})},returnTo)})).filter(target=>target.href);
}
