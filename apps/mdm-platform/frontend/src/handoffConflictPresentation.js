import {businessName,businessText} from './businessPresentation.js';
import {bindingDetailDisplay,governanceDetailName} from './handoffGovernancePresentation.js';

const key=value=>typeof value==='number'&&!Number.isSafeInteger(value)?null:value==null?null:String(value);
const same=(a,b)=>key(a)!=null&&key(a)===key(b);
export const conflictText=(value,fallback='原记录未提供可展示的业务说明')=>value==null||value===''?fallback:businessText(value,fallback);
const readableFields={outcome:'处理结果',summary:'结果概况',description:'说明',difference:'差异',impact:'影响',basis:'依据',reason:'原因'};
export function conflictDisplay(value) {
  if(typeof value==='string')return conflictText(value);
  if(Array.isArray(value))return value.map(conflictDisplay).join('；');
  if(!value||typeof value!=='object')return '原记录未提供可展示的业务说明';
  const rows=Object.entries(value).filter(([field,item])=>typeof item==='string'&&item&&(Object.hasOwn(readableFields,field)||/^[\p{Script=Han}\s，、（）]+$/u.test(field))).map(([field,item])=>(readableFields[field]||field)+'：'+conflictText(item));
  return rows.join('；')||'原记录未提供可展示的业务说明，原内容保持';
}
export function currentAssignedPerson(id,people,role) {
  if(id==null||id==='')return role==='决策人'?'尚未指定决策人':'尚未分派处理人';
  const match=(people||[]).find(row=>same(row.person_id,id));
  return match?.person_name?'当前目录：'+conflictText(match.person_name,'当前姓名暂无法展示'):'当前可选人员未提供姓名，原分派保留';
}
function exactBinding(resource,trace) {
  let id=resource?.revision?.binding_id||resource?.binding_id;
  if(!id&&resource?.handoff_id&&resource.current_handoff_revision!=null&&resource.content_digest){
    const matches=(trace?.revisions||[]).filter(row=>same(row.handoff_id,resource.handoff_id)&&same(row.revision_no,resource.current_handoff_revision)&&row.content_digest===resource.content_digest);
    if(matches.length===1)id=matches[0].binding_id;
  }
  return id?(trace?.bindings||[]).find(row=>same(row.binding_id,id))||null:null;
}
// A missing exact source never borrows another binding or the first list row.
export function conflictSourceChoices(resource,trace,subjectItems=[]) {
  const details=bindingDetailDisplay(trace,exactBinding(resource,trace));
  const refs=[...new Set(subjectItems.flatMap(item=>item.source_detail_refs||[]))];
  return refs.map(value=>{
    const matches=details.filter(row=>same(row.detail_ref,value)||same(row.detail_version_id,value));
    const names=[...new Set(matches.map(governanceDetailName))];
    const subjects=[...new Set(subjectItems.filter(item=>(item.source_detail_refs||[]).some(ref=>same(ref,value))).map(item=>businessName(item.definition,'条目名称未记录')))];
    const source=names.length===1?names[0]:names.length>1?'来源名称不一致，请核对固定材料':'具体来源名称未记录';
    return {value,label:(subjects.length?subjects.join('、')+' · ':'')+source};
  });
}
export function factSourceName(fact,trace) {
  if(fact&&Object.hasOwn(fact,'detail_name'))return typeof fact.detail_name==='string'&&fact.detail_name.trim()?conflictText(fact.detail_name,'来源名称未记录'):'来源名称未记录';
  const details=bindingDetailDisplay(trace,exactBinding(fact,trace));
  const matches=details.filter(row=>same(row.detail_ref,fact?.detail_ref)||same(row.detail_version_id,fact?.detail_ref));
  const names=[...new Set(matches.map(governanceDetailName))];
  return names.length===1?names[0]:'来源名称未记录，请核对有权查阅的来源材料';
}
export function factSourceAttribution(fact={}) {
  const sources={
    fixed_source:'固定流程版本中留存的名称',
    review_snapshot:'原审核记录中留存的名称',
    parent_snapshot:fact?.parent_kind==='intake'?'本问题提出时的接入核验记录中留存的名称':fact?.parent_kind==='correction'?'本问题提出时的更正记录中留存的名称':'本问题提出时的接入或更正记录中留存的名称'
  };
  const source=fact?.detail_name_source;
  return typeof source==='string'&&Object.hasOwn(sources,source)?sources[source]:'名称出处未注明';
}
export const conflictActionLabels={open:'登记本草案冲突',viewpoint:'保存本次观点',assign:'保存冲突处理人分派',resolve:'保存普通协调结果',escalate:'提交重大争议',decide:'保存项目决定',verify:'验证本次分别重核结果',reopen:'重新打开本冲突',open_fact:'提出定向事实核对问题'};
export const conflictActionGuidance={
  open:'保存后在“本草案冲突”列表打开本事项，核对差异、方案及影响，再按当前分派办理。',
  viewpoint:'保存后在“分别观点与依据”查看本次记录，交冲突处理人继续协调；补充观点不代表处理结果已形成。',
  assign:'保存后在“当前分派”及“分歧办理历史”核对人选，交该冲突处理人继续办理。',
  resolve:'保存后在“当前处理结果”核对结果和依据，再对涉及部门分别提出事实重核；协调结果不等于冲突已验证或草案已发布。',
  escalate:'保存后在“当前分派”及“分歧办理历史”核对项目决策人，由该人员记录项目决定；决定后相关部门仍须分别重核。',
  decide:'保存后在“当前处理结果”核对项目决定及依据，再由相关部门分别重核；决定不会自动确认事实或发布草案。',
  verify:'保存后核对上方冲突状态及“分歧办理历史”。草案后续检查、批准和发布仍分别办理。',
  reopen:'保存后核对上方冲突状态，再按当前分派重新协调；原办理历史保留。',
  open_fact:'保存后在“定向事实与分别重核”打开新问题，交所选目标部门答复；负责人确认和MDM核对关闭按该事实页面的可办操作分别办理。'
};
export function factActionGuidance(action,parentKind) {
  if(action==='answer')return parentKind==='handoff_conflict'?'保存后在“当前事实答复”核对答复和证据；再交目标部门当前负责人本人确认，随后由MDM核对关闭。':'保存后在“当前事实答复”核对答复和证据，再交MDM在本事实记录核对关闭。';
  if(action==='confirm')return '确认只针对本页面的答复及证据，不能代表其他部门或整个冲突。保存后在“负责人确认依据”核对，再由MDM核对关闭。';
  return '保存后核对上方事实状态及“MDM核对关闭依据”。关闭这项事实不等于整个冲突已验证或草案已发布。';
}
