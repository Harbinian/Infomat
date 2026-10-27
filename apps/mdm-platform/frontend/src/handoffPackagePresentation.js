import {businessDateTime} from './businessGuidance.js';
import {businessStatus,businessText} from './businessPresentation.js';
import {governanceDetailName} from './handoffGovernancePresentation.js';
import {handoffLines} from './dataMapHandoffRequest.js';

const same=(left,right)=>left!=null&&right!=null&&String(left)===String(right);
export function packageCorrectionRevision(trace,row){
  const revision=Number(row?.current_revision);
  if(!Number.isSafeInteger(revision)||revision<1)return null;
  const matches=(trace?.correction_revisions||[]).filter(item=>same(item.correction_id,row?.correction_id)&&Number(item.revision_no)===revision);
  return matches.length===1?matches[0]:null;
}
export function packageParentSnapshot(trace,kind,parentId,revision){
  if(kind==='intake')return (trace?.intakes||[]).find(row=>same(row.intake_id,parentId)&&Number(row.current_revision)===Number(revision))?.snapshot_json||null;
  return packageCorrectionRevision(trace,{correction_id:parentId,current_revision:revision})?.snapshot_json||null;
}
export function packageDetailName(trace,detail={}){
  const source=(trace?.detail_sources||[]).find(row=>same(row.detail_version_id,detail.detail_version_id))?.source;
  // Names captured in this exact detail can label it when the separate source
  // projection is unavailable. Proposed conclusions never become source facts.
  const recordedNames=Object.fromEntries(['data_name','field_name','behavior_name'].filter(key=>detail.candidate?.[key]).map(key=>[key,detail.candidate[key]]));
  return governanceDetailName({...detail,display_source:source||detail.display_source||recordedNames});
}
export function packageFactChoices(snapshot,detailId){
  return (snapshot?.facts||[]).filter(row=>same(row.detail_id,detailId)).map(row=>({
    value:row.fact_id,
    label:[businessText(row.question_text||row.question,'原问题内容未留存'),businessStatus(row.status,'原问题状态待核对'),row.created_at?businessDateTime(row.created_at):null].filter(Boolean).join(' · ')
  }));
}
export function preservePackageChoice(items,value,label='原选择当前无法读取，原值已保留'){
  return value!=null&&value!==''&&!items.some(row=>same(row.value,value))?[...items,{value,label}]:items;
}
export function packageInputDisplay(value){
  const text=value==null?'':String(value),hidden=Boolean(text)&&businessText(text,'')!==text;
  return {text:hidden?'':text,hidden};
}

// Only the presentation is new. These bodies retain the existing legacy writes.
export function legacyPackageWrite(kind,v,resource){
  let body={expected_revision:0},path,method='POST';
  if(kind==='prepare_intake')path=`work-packages/${resource.package_id}/intakes`;
  if(kind==='create_handoff'){path=`from-work-packages/${resource.package_id}`;body.binding_id=v.binding_id;body.scope_mode=v.scope_mode;}
  if(kind==='review_intake'){path=`intakes/${v.parent_id}/reviews`;Object.assign(body,{expected_revision:v.parent_revision,basis:v.basis,detail_evidence:v.details.map(d=>({detail_id:d.detail_id,detail_version_id:d.detail_version_id,basis:d.basis,evidence_refs:handoffLines(d.evidence)}))});}
  if(kind==='create_correction'){path=`work-packages/${resource.package_id}/corrections`;Object.assign(body,{replaces_binding_id:v.replaces_binding_id,reason:v.reason,evidence_refs:handoffLines(v.evidence)});}
  if(kind==='save_correction'){path=`corrections/${v.parent_id}`;method='PATCH';Object.assign(body,{expected_revision:v.parent_revision,reason:v.reason,evidence_refs:handoffLines(v.evidence),details:v.details.filter(d=>d.selected).map(d=>({detail_id:d.detail_id,expected_detail_version_id:d.detail_version_id,status:d.status,governance:d.governance,evidence_refs:handoffLines(d.evidenceText)}))});}
  if(kind==='review_correction'){path=`corrections/${v.parent_id}/reviews`;Object.assign(body,{expected_revision:v.parent_revision,basis:v.basis,evidence_refs:handoffLines(v.evidence)});}
  if(kind==='legacy_fact'){path=`${v.parent_kind==='intake'?'intakes':'corrections'}/${v.parent_id}/facts`;Object.assign(body,{[v.parent_kind+'_id']:v.parent_id,expected_parent_revision:v.parent_revision,detail_id:v.detail_id,target_department_id:v.target_department_id,requested_fact_type:v.fact_type,question_text:v.question,request_reason:v.reason,...(v.resolves_legacy_fact_id?{resolves_legacy_fact_id:v.resolves_legacy_fact_id}:{})});}
  return {path,method,body};
}

export function handoffReceiptGuide(phase){
  const copy={
    awaiting_receipt:'本次办理结果尚未确认。请先核对本次办理结果；原输入保留，暂不重复发起。',
    in_progress:'本次办理仍在进行。请稍后核对结果，原输入继续保留。',
    not_observed:'目前尚未查到本次办理结果，不能据此确认未保存。继续办理可能完成原操作；仍使用原内容办理。',
    retryable:'当前可以继续办理并核对结果。继续办理可能完成原操作；仍使用原内容办理。',
    rejected:'本次办理未通过，原输入保留。请先核对原因及当前可办操作，再按页面提示处理。',
    committed:'本次办理已有完成记录。请核对下方结果，再点击“确认本次办理结果”；输入仍保留。'
  };
  return Object.hasOwn(copy,phase)?copy[phase]:'本次办理状态尚未核实。请先核对结果，保留原输入。';
}
export function handoffResultGuide(kind,result){
  if(!result)return null;
  const copy={
    intake_prepared:{summary:'旧工作包接入核验已准备。',next:'确认结果并结束本次办理后，在下方“旧工作包接入记录”查看。MDM工作组组长逐条核验明细；缺少业务事实时可先提出定向补核。'},
    correction_saved:{summary:'本次审核后更正已保存，尚未完成更正审核。',next:'确认结果并结束本次办理后，在下方“审核后更正记录”查看。需要调整内容时继续编辑更正明细，准备完成后由MDM工作组组长审核。'},
    review_bound_pending_draft:{summary:'本次核验已完成，已形成可用于承接的审核材料。',next:'确认结果并结束本次办理后，查看本工作包的审核来源及草案记录；需要建立草案时点击“承接本次已审核工作包”。尚未形成数据地图发布。'},
    fact_saved:{summary:kind==='legacy_fact'?'定向补核问题已保存。':'本次事实办理结果已保存。',next:'在“定向事实”查看本问题。目标部门答复后，由MDM人员核对答复并记录采用依据，再继续接入核验或更正审核；答复不会自动完成审核。'},
    draft_saved:{summary:'数据地图草案已保存。',next:'查看本次草案，核对内容后按当前页面提供的动作继续检查和提交；保存草案不会自动发布。'},
    existing_draft:{summary:'本次审核材料已有对应的数据地图草案。',next:'查看对应草案后继续办理，未重复建立草案。'},
    unapproved_draft_generated:{summary:'数据地图草案已建立，尚未批准发布。',next:'查看本次草案，逐项核对内容后继续办理。'},
    draft_submitted:{summary:'本次草案已提交。',next:'在本草案查看当前办理状态，由具备本包审核资格的人员继续核对。'},
    draft_returned:{summary:'本次草案已退回修改。',next:'查看草案及退回依据，修改后重新检查和提交。'},
    draft_approved:{summary:'本次草案已批准，尚未发布。',next:'查看本草案的批准结果，再按当前页面提供的发布动作继续办理。'},
    gates_checked:{summary:'本次草案的发布条件检查已完成。',next:'查看下方“本次发布条件检查”，按检查结果处理；检查完成不表示已发布。'},
    existing_publication:{summary:'本次审核材料已有对应发布内容。',next:'查看对应发布内容及当前状态，未重复建立发布记录。'},
    published_current:{summary:'本次草案已发布到现行范围。',next:'查看对应发布内容；是否可在全局台账查阅，仍按当前身份的读取范围核对。'},
    published_historical:{summary:'本次草案已发布到历史范围。',next:'查看对应历史发布内容。本次发布不会将历史内容改为现行内容。'},
    withdraw_submission:{summary:'本人待审核的提交已撤回。',next:'草案内容仍保留；查看草案后可按当前允许的动作继续修改。'},
    revoke_approval:{summary:'尚未发布的批准已撤销。',next:'草案内容仍保留；需要发布时，须按当前条件重新检查和批准。'},
    withdrawal_checked:{summary:'本次发布撤回检查已完成，尚未执行撤回。',next:'查看本次撤回检查结果，解决阻碍后再按当前页面提供的批准及撤回动作办理。'},
    withdrawal_approved:{summary:'本次发布撤回已获批准，尚未执行撤回。',next:'查看本次撤回批准及检查结果，再按当前页面提供的动作执行撤回。'},
    restoration_draft_saved:{summary:'恢复草案已保存，尚未重新发布。',next:'查看对应恢复草案，处理需要调整的内容后，重新检查、批准和发布。'},
    source_upgrade_assessed:{summary:'本次新旧流程来源对照已保存。',next:'查看当前草案的来源对照和处理建议，按实际结果决定下一步；对照保存不会自动发布。'},
    conflict_saved:{summary:'本次冲突办理记录已保存。',next:'查看对应冲突的最新状态及处理内容，按当前允许的动作继续办理；保存记录不会自动完成数据地图发布。'},
    conflict_fact_saved:{summary:'本次冲突事实办理记录已保存。',next:'查看对应问题的最新状态，目标部门答复后仍须按当前办理条件核对。'}
  };
  const display=Object.hasOwn(copy,result.business_outcome)?copy[result.business_outcome]:{summary:'已收到本次办理结果。',next:'请核对当前事项的最新记录及可用动作，再继续办理。'};
  const target=result.fact_id?{kind:'fact',id:result.fact_id}:result.conflict_id?{kind:'conflict',id:result.conflict_id}:result.publication_id?{kind:'publication',id:result.publication_id}:result.handoff_id?{kind:'handoff',id:result.handoff_id}:null;
  return {...display,target,targetLabel:target?{fact:'结束本次办理并查看本问题',conflict:'结束本次办理并查看对应冲突',handoff:'结束本次办理并查看对应草案',publication:'结束本次办理并查看发布内容'}[target.kind]:null};
}
