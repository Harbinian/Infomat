import {splitActorRole,actorRoleValue} from './actor-selection.js';

// This is a source-reading aid, not an assignment or organization master.
export function describeActor(node,departments=[],roles={}){
  const role=String(node?.current_actor_role||'').trim();
  const selected=splitActorRole(role,roles);
  const catalogPair=roles[selected.department]?.includes(selected.position)&&role===actorRoleValue(selected.department,selected.position);
  const known=catalogPair?[...new Set([...departments,selected.department])]:departments;
  const mentioned=[...known].sort((a,b)=>b.length-a.length).filter(name=>role.includes(name));
  const prefix=mentioned.find(name=>role.startsWith(name)&&role[name.length]!=='门');
  const position=prefix?role.slice(prefix.length).replace(/^[\s/／:：·-]+/,''):role;
  const mixed=/[、；;/／]|或|以及/.test(position)||mentioned.length>1;
  const rule=String(node?.actor_position_rule||'');
  const unresolvedRule=/部门.{0,16}(待.{0,8}(确认|核对)|另行确定|按.{0,8}(确定|确认))|责任主体待确认|按.{0,8}(项目|申请|单据|数据).{0,8}确定.{0,8}部门/.test(rule);
  const participants=Array.isArray(node?.countersign_target_departments)?node.countersign_target_departments:[];
  const mixedCountersign=participants.some(name=>name!==prefix);
  const fixed=node?.actor_assignment_mode==='fixed_department';
  const explicit=Boolean(fixed&&prefix&&!mixed&&!unresolvedRule&&!mixedCountersign);
  const reason=!role?'材料未填写办理角色':!fixed?'部门按材料规则动态确定':mixed?'材料列有多个或条件性办理主体':unresolvedRule?'分配规则仍要求核对实际部门':mixedCountersign?'会签涉及其他部门，实际交接主体需核对':!prefix?'角色尚未明确到本轮部门名称':'角色明示固定部门';
  return {role,department:explicit?prefix:'',mentioned:prefix||'',status:explicit?'explicit':'pending',reason};
}
export function classifyHandoffs(document,departments=[],roles={}){
  const nodes=Array.isArray(document?.behaviors)?document.behaviors:[];
  const references=new Map();
  nodes.forEach((node,index)=>{const list=references.get(node.behavior_ref)||[];list.push({node,index,actor:describeActor(node,departments,roles)});references.set(node.behavior_ref,list);});
  return (Array.isArray(document?.flow_relations)?document.flow_relations:[]).map((relation,index)=>{
    const sources=references.get(relation.from_behavior_ref)||[],targets=references.get(relation.to_behavior_ref)||[];
    const source=sources.length===1?sources[0]:null,target=targets.length===1?targets[0]:null;
    const known=source?.actor.status==='explicit'&&target?.actor.status==='explicit';
    const kind=known?(source.actor.department===target.actor.department?'internal':'cross'):'pending';
    return {index,relation,source,target,kind,label:kind==='cross'?`${source.actor.department} → ${target.actor.department}`:kind==='internal'?`${source.actor.department}内部流转`:'交接部门待核对'};
  });
}
