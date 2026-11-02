// A read-only projection of current resource qualifications. These entries are
// discovered work, never persistent todos and never independent authorization.
function projectHandoffWorkItems({capabilities,packages=[],drafts=[],conflicts=[],facts=[]}) {
  if(!capabilities.enabled||capabilities.read_only||capabilities.cutover_state!=='controlled'||!capabilities.schema_ready||capabilities.role_codes?.includes('admin'))return [];
  const roleCodes=new Set(capabilities.role_codes||[]),items=[];
  const mdmRole=roleCodes.has('mdm_lead')?'mdm_lead':'mdm_steward';
  function add(kind,resourceId,selection,source,title,label,actions,roleHint,status){
    items.push({...source,id:`data-map-handoff:${kind}:${resourceId}`,type:`data_map_handoff_${kind}`,title,
      target:`/app/data-map-handoffs?${selection}=${encodeURIComponent(resourceId)}`,actionLabel:label,nextStep:label,
      currentStatus:status,roleHint,sourceRoles:[roleHint],sourceType:'data_map_handoff',governanceType:'data_map_handoff',
      allowed_actions:actions,canAct:true,urgency:'normal'});
  }
  for(const fact of facts){
    const actions=(fact.allowed_actions||[]).filter(x=>['answer','confirm','close'].includes(x));
    if(!actions.length)continue;
    const action=actions.includes('confirm')?'confirm':actions.includes('answer')?'answer':'close';
    const label={answer:'答复定向业务事实',confirm:'核对并确认本部门答复',close:'核验并关闭业务事实问题'}[action];
    const role=action==='close'?mdmRole:action==='confirm'?'department_mdm_reviewer':roleCodes.has('department_contact')?'department_contact':'department_mdm_reviewer';
    // Department projections carry the exact question context only; no whole
    // package or draft body is copied into the aggregate workbench.
    const source={package_id:fact.package_id,fact_id:fact.fact_id,target_department_id:fact.target_department_id,
      parent_kind:fact.parent_kind,revision:fact.revision,...(fact.conflict_id?{conflict_id:fact.conflict_id}:{}),...(fact.handoff_id?{handoff_id:fact.handoff_id}:{})};
    add('fact',fact.fact_id,'fact',source,`${label}：${fact.question_text||fact.detail_ref||fact.fact_id}`,label,actions,role,fact.status);
  }
  for(const conflict of conflicts){
    const allowed=conflict.allowed_actions||[];
    let actions,label,role;
    if(allowed.includes('decide')){actions=['decide'];label='处理已分派的升级争议';role='decision_group';}
    else if(['open','escalated'].includes(conflict.state)){
      actions=allowed.filter(x=>['resolve','escalate','viewpoint','assign'].includes(x));
      label=allowed.includes('resolve')?'协调并处理承接冲突':allowed.includes('assign')?'分派承接冲突处理人':'补充已分派冲突的协调意见';
      role=roleCodes.has('mdm_lead')?'mdm_lead':roleCodes.has('data_conflict_handler')?'data_conflict_handler':mdmRole;
    }else if(conflict.state==='resolved'&&allowed.includes('verify')){actions=['verify'];label='核验解决结果与当前承接修订';role=mdmRole;}
    else continue;
    if(!actions.length)continue;
    add('conflict',conflict.conflict_id,'conflict',{conflict_id:conflict.conflict_id,handoff_id:conflict.handoff_id,package_id:conflict.package_id,revision:conflict.revision},
      `${label}：${conflict.difference||conflict.conflict_id}`,label,actions,role,conflict.state);
  }
  for(const draft of drafts){
    const allowed=draft.allowed_actions||[],header=draft.header,source={handoff_id:header.handoff_id,package_id:header.package_id,revision:Number(header.current_revision)};
    let actions,label;
    if(header.state==='draft'){actions=allowed.filter(x=>['save','rebase','submit','checks'].includes(x));label='继续编制并核对承接草案';}
    else if(header.state==='submitted'&&allowed.some(x=>['approve','needs_changes'].includes(x))){actions=allowed.filter(x=>['approve','needs_changes','checks'].includes(x));label='审核承接准确修订';}
    else if(header.state==='approved'&&allowed.some(x=>['publish','revoke_approval'].includes(x))){actions=allowed.filter(x=>['publish','revoke_approval','checks'].includes(x));label='核对批准记录并执行发布';}
    else continue;
    if(actions.length)add('draft',header.handoff_id,'handoff',source,`${label}：工作包 ${header.package_id}`,label,actions,mdmRole,header.state);
  }
  for(const pkg of packages){
    const allowed=pkg.allowed_actions||[],prepare=allowed.includes('prepare'),review=allowed.includes('review');
    const intake=pkg.intakes?.find(x=>x.state==='prepared'),correction=pkg.corrections?.find(x=>x.state==='draft');
    let label,action,extra={};
    if(intake&&(review||prepare)){label=review?'逐明细审核旧包接入':'补核旧包接入依据';action=review?'review_intake':'legacy_fact';extra={intake_id:intake.intake_id};}
    else if(correction&&(review||prepare)){label=review?'审核工作包更正准确修订':'继续编制审核后更正';action=review?'review_correction':'save_correction';extra={correction_id:correction.correction_id};}
    else if(prepare&&pkg.status==='completed'&&!pkg.binding_id&&!pkg.intakes?.length){label='准备旧工作包接入核验';action='prepare_intake';}
    else if(prepare&&pkg.binding_id&&!pkg.drafts?.some(x=>x.binding_id===pkg.binding_id)&&!pkg.publications?.some(x=>x.binding_id===pkg.binding_id)){label='承接本次已审核工作包';action='create_handoff';extra={binding_id:pkg.binding_id};}
    else continue;
    add('package',pkg.package_id,'package',{package_id:pkg.package_id,...extra},`${label}：${pkg.package_ref||pkg.package_id}`,label,[action],mdmRole,pkg.status);
  }
  return items.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
}
module.exports={projectHandoffWorkItems};
