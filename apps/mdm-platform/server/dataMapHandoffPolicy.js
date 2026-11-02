const crypto = require('node:crypto');
const {digest,json,parse,id} = require('./dataMapDefinitionValues');
function failure(code,statusCode=409,details={}) {
  return Object.assign(new Error(code),{code,statusCode,payload:{code,error:messages[code]||'承接未完成，请核对问题及当前修订。',...details}});
}
const messages={HANDOFF_DISABLED:'数据地图承接入口尚未开启。',HANDOFF_REQUIRED:'请在工作包承接草案中办理。',HANDOFF_READ_ONLY:'当前仅供查阅。',HANDOFF_GATE_BLOCKED:'本次必需门槛尚未满足。',HANDOFF_COMMIT_UNKNOWN:'提交结果待核对，请保留原请求标识。'};
function uuid(value) { if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||''))throw failure('HANDOFF_REQUEST_ID_INVALID',400);return value.toLowerCase(); }
function revision(value,zero=false) {if(!Number.isSafeInteger(value)||value<(zero?0:1))throw failure('HANDOFF_REVISION_REQUIRED',400);return value;}
function writable(env=process.env) {
  if(!['0','1'].includes(String(env.DATA_MAP_HANDOFF_ENABLED||'0')) || !['0','1'].includes(String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')))throw failure('HANDOFF_CONFIGURATION_INVALID',503);
  if(String(env.DATA_MAP_HANDOFF_ENABLED||'0')!=='1')throw failure('HANDOFF_DISABLED',503);
  if(String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')==='1')throw failure('HANDOFF_READ_ONLY');
}
function verify(value,hash) {if(digest(value)!==hash)throw failure('HANDOFF_CONTENT_INTEGRITY_CONFLICT');return value;}
function snapshot(body) {
  if(!body||Array.isArray(body)||!['current','historical'].includes(body.scope_mode)||!Array.isArray(body.items)||!Array.isArray(body.dispositions))throw failure('HANDOFF_DRAFT_INVALID',422);
  const allowed=new Set(['schema_version','scope_mode','items','dispositions','impact_dispositions','restores_publication_id','restoration','restoration_adjustments','basis']);
  if(Object.keys(body).some(k=>!allowed.has(k)))throw failure('HANDOFF_DRAFT_FIELD_INVALID',422);
  if(body.restores_publication_id)uuid(body.restores_publication_id);
  if(Boolean(body.restores_publication_id)!==Boolean(body.restoration)||body.restoration&&(typeof body.restoration!=='object'||Array.isArray(body.restoration)))throw failure('HANDOFF_RESTORATION_INVALID',422);
  if(body.restoration_adjustments!==undefined&&(!body.restoration||!Array.isArray(body.restoration_adjustments)))throw failure('HANDOFF_RESTORATION_INVALID',422);
  const refs=new Set();
  const targetRefs=new Set();
  for(const item of body.items) {
    if(!item||typeof item.item_ref!=='string'||!/^[-a-zA-Z0-9_:.]{1,160}$/.test(item.item_ref)||refs.has(item.item_ref))throw failure('HANDOFF_ITEM_REF_INVALID',422);
    refs.add(item.item_ref);
    const allowedItem=new Set(['item_ref','target_kind','target_id','target_version_ref','base_version_ref','operation','definition','object_ref','context_ref','data_element_ref','source_detail_refs','basis','evidence_refs','authority']);
    if(Object.keys(item).some(k=>!allowedItem.has(k))||!['object','field','data_element','context','rule','authority'].includes(item.target_kind)||!['create','modify','reuse','context_link','rule','authority'].includes(item.operation)||!item.definition||typeof item.definition!=='object'||!Array.isArray(item.source_detail_refs)||!Array.isArray(item.evidence_refs))throw failure('HANDOFF_ITEM_INVALID',422,{item_ref:item.item_ref});
    const operations={object:['create','modify','reuse'],field:['create','modify','reuse'],data_element:['create','modify','reuse'],context:['context_link'],rule:['rule'],authority:['authority']};
    if(!operations[item.target_kind].includes(item.operation)||Array.isArray(item.definition))throw failure('HANDOFF_ITEM_OPERATION_INVALID',422,{item_ref:item.item_ref});
    if(item.operation==='create'&&(item.target_id||item.base_version_ref||item.target_version_ref))throw failure('HANDOFF_CREATE_TARGET_INVALID',422,{item_ref:item.item_ref});
    if(item.operation==='modify'&&(!item.target_id||!item.base_version_ref||item.target_version_ref))throw failure('HANDOFF_MODIFY_BASE_REQUIRED',422,{item_ref:item.item_ref});
    if(['context','rule','authority'].includes(item.target_kind)&&(item.base_version_ref||item.target_version_ref))throw failure('HANDOFF_RELATION_VERSION_INVALID',422,{item_ref:item.item_ref});
    if(item.authority!==undefined&&(!Array.isArray(item.authority)||item.authority.some(a=>!a||typeof a!=='object'||Array.isArray(a)||Object.keys(a).some(k=>!['attribute_ref','basis','evidence_refs','not_applicable','sor_system_ref','manager_department_id'].includes(k))||(a.not_applicable!==undefined&&typeof a.not_applicable!=='boolean'))))throw failure('HANDOFF_AUTHORITY_INVALID',422,{item_ref:item.item_ref});
    if(item.operation==='reuse' && (!item.target_id||!item.target_version_ref))throw failure('HANDOFF_REUSE_REFERENCE_REQUIRED',422);
    if(item.target_id && ['object','field','context'].includes(item.target_kind))id(item.target_id);
    if(item.target_id){const key=item.target_kind+':'+item.target_id;if(targetRefs.has(key))throw failure('HANDOFF_DUPLICATE_TARGET',422);targetRefs.add(key);}
  }
  for(const item of body.items)for(const [key,kind] of [['object_ref','object'],['context_ref','context'],['data_element_ref','data_element']])if(item[key] && !body.items.some(x=>x.item_ref===item[key]&&x.target_kind===kind))throw failure('HANDOFF_ITEM_REFERENCE_INVALID',422,{item_ref:item.item_ref,field:key});
  return JSON.parse(json({...body,schema_version:'handoff-draft-v1'}));
}
const newId=()=>crypto.randomUUID();
module.exports={failure,uuid,revision,writable,verify,snapshot,newId,digest,json,parse,id};
