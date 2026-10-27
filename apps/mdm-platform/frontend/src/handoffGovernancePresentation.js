import {businessName,businessStatus,businessText,userMessage} from './businessPresentation.js';
import {businessDateTime} from './businessGuidance.js';

const operationLabels={create:'创建',modify:'修订',reuse:'沿用已有版本',context_link:'登记数据使用范围',rule:'建立生命周期规则',authority:'记录来源权威关系',read:'读取',use:'使用',update:'更新',delete:'删除',archive:'归档',destroy:'销毁',retain:'保留',transfer:'传递',record:'登记记录',not_applicable:'不适用',terminated:'终止'};
const roleLabels={mdm_lead:'MDM工作组组长',mdm_steward:'MDM治理经办人',department_contact:'部门主对接人',department_mdm_reviewer:'部门负责人',data_conflict_handler:'数据冲突处理人',decision_group:'项目决策组',data_quality_auditor:'数据质量审计人',admin:'系统管理员'};
export const handoffOperationName=value=>operationLabels[value]||'原记录未提供可读的操作说明';
const detailTypeLabels={data_object_identity:'数据对象识别',critical_field:'关键字段',data_flow:'数据使用环节',lifecycle_rule:'数据生命周期规则'};
export const governanceDetailType=value=>Object.hasOwn(detailTypeLabels,value)?detailTypeLabels[value]:'治理明细';
export function handoffRequestNotice(error){
  const message=error?.message||error;
  const messages={
    '原请求尚待核定，请先查询原请求回执。':'本次办理结果尚未确认，请先点击“核对本次办理结果”。',
    '无法生成请求标识，请保留本次输入。':'本次提交尚未准备完成，请保留输入后重试。',
    '成功回执缺少原请求标识。':'返回结果尚不能与本次办理对应，请核对办理结果；当前输入保持不变。',
    '回执标识不一致，请保留原请求。':'返回结果与本次办理不对应，请保留输入并核对本次办理结果。'
  };
  return Object.hasOwn(messages,message)?messages[message]:userMessage(error);
}
export function historicalGovernanceActor(actor={}){
  actor=actor||{};
  const raw=actor.person_name||actor.actor_name||actor.answered_by_name;
  const name=raw?businessText(raw,'原记录未留存姓名'):'原记录未留存姓名';
  const roles=[actor.role_code,actor.roleCode,...(actor.role_codes||[]),...(actor.grants||[]).map(row=>row.role_code)].filter(Boolean);
  const labels=[...new Set(roles.map(role=>roleLabels[role]).filter(Boolean))];
  const qualifier=actor.recorded_as==='capturing_actor_not_original_historical_author'?'；此人为本次资料登记人，不代表原历史办理人':'';
  return name+(labels.length?'（已记录角色：'+labels.join('、')+'）':'')+qualifier;
}
export function governanceDetailName(row={}){
  const source=row.source||row.display_source||{};
  const names=[source.data_name,source.field_name].filter(Boolean).map(value=>businessText(value,'名称未记录'));
  if(row.detail_type==='data_flow'){
    if(source.behavior_name)names.push(businessText(source.behavior_name,'环节名称未记录'));
    if(source.operations?.length)names.push(source.operations.map(handoffOperationName).join('、'));
    if(source.missing_data_flow_scope)names.push('尚未说明使用环节');
  }
  const name=names.join(' / ')||businessName(row,'原固定来源未提供可读名称');
  return ['data_object_identity','lifecycle_rule'].includes(row.detail_type)?governanceDetailType(row.detail_type)+'：'+name:name;
}
export function fixedSourceName(source={}){
  source=source||{};
  return [businessName(source,'原固定流程名称未记录'),source.edition?businessText(source.edition,'版次未记录')+'版':null].filter(Boolean).join(' · ');
}
export function handoffReviewBindingSelection(trace,selected){
  const items=(trace?.bindings||[]).map(row=>({binding_id:row.binding_id,label:fixedSourceName(trace?.source)+' · '+businessDateTime(row.created_at)}));
  return {value:selected,items,unavailable:selected!=null&&selected!==''&&!items.some(row=>String(row.binding_id)===String(selected))};
}
export function bindingDetailDisplay(trace,binding){
  return (binding?.snapshot_json?.detail_versions||[]).map(row=>({...row,display_source:trace?.detail_sources?.find(item=>item.detail_version_id===row.detail_version_id)?.source||null}));
}
export function handoffSourceBinding(trace,resource){
  const bindingId=resource?.revision?.binding_id||resource?.binding_id;
  return bindingId?(trace?.bindings||[]).find(row=>row.binding_id===bindingId)||null:null;
}
export const canReadDataMap=user=>Boolean(user?.permissions?.includes('governance:read-global')||user?.departmentId&&user?.permissions?.includes('governance:read-department'));
// This copy is used only for rendering. Immutable evidence and request bodies
// keep their original keys, values and hashes.
export function readableGovernanceValue(value,key=''){
  if(value==null)return value;
  if(['actor','approval_actor','actor_snapshot','requested_by','answered_by','closed_by'].includes(key)&&typeof value==='object')return {actor_name:historicalGovernanceActor(value)};
  if(['created_at','updated_at','published_at','answered_at','reviewed_at','closed_at','completed_at','due_at'].includes(key))return businessDateTime(value);
  if(['operation','operations','action'].includes(key))return Array.isArray(value)?value.map(handoffOperationName):handoffOperationName(value);
  if(Array.isArray(value))return value.map(item=>readableGovernanceValue(item));
  if(typeof value==='object')return Object.fromEntries(Object.entries(value).map(([field,item])=>[field,readableGovernanceValue(item,field)]));
  return value;
}
export function tracePublications(trace={}){
  return (trace.publications||[]).map(row=>({...row,manifest:row.manifest_json||row.manifest,state:(trace.publication_events||[]).some(event=>event.publication_id===row.publication_id&&['withdrawn','publication_withdrawn','withdraw_publication'].includes(event.event_type))?'withdrawn':'published'}));
}
export function restorationLinkName(link={}){
  const state=link.publication_id?(link.publication_state?businessStatus(link.publication_state):'发布状态待核对'):'草案当前'+businessStatus(link.current_handoff_state);
  return fixedSourceName(link)+' · '+(link.publication_id?'恢复后发布内容': '恢复草案保存记录')+' · '+state+(link.created_at?' · '+businessDateTime(link.created_at):'');
}
