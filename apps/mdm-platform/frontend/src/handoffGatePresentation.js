import {businessName,userMessage} from './businessPresentation.js';
import {governanceDetailName} from './handoffGovernancePresentation.js';

const gateNames = Object.freeze({1:'来源流程与审核材料',2:'治理明细与业务事实',3:'数据定义及来源依据',4:'依赖、分歧与术语',5:'本次批准与发布复核'});
const detailKinds = Object.freeze({data_object_identity:'对象',critical_field:'字段',data_flow:'数据使用范围',lifecycle_rule:'生命周期规则'});
export const handoffGateName = gate => Object.hasOwn(gateNames,gate)?gateNames[gate]:'其他发布条件';
export function handoffGateStatus(gate) {
  if(gate?.status==='pass')return '已通过';
  if(gate?.status==='blocked')return '需先处理';
  return gate?.status==='pending'&&Number(gate.gate)===5?'发布时核验':'待核对';
}
function parts(issue) {
  const raw=typeof issue==='string'?issue:typeof issue?.code==='string'?issue.code:'';
  const colon=raw.indexOf(':');
  return {code:colon<0?raw:raw.slice(0,colon),reference:colon<0?'':raw.slice(colon+1)};
}
export const handoffGateIssueCode = issue => parts(issue).code;

const messages = Object.freeze({
  REVIEW_BINDING_STALE:'原工作包审核尚未完成，或本草案采用的审核材料已不是当前记录。请先在原工作包完成审核，再回本草案点击“采用当前审核记录”并重新检查。',
  SOURCE_SCOPE_STALE:'所选流程已不能作为当前现行来源。请核对原工作包绑定的流程版本及发布状态，再按已确认的现行或历史范围办理，不直接沿用旧范围发布。',
  DETAILS_REQUIRED:'采用的审核材料没有治理明细。请回原工作包核对并完成治理审核，再由本草案采用当前审核记录。',
  FACT_NOT_CLOSED:'所采用审核材料中的业务事实问题尚未关闭。请在原工作包完成事实答复、所需确认及关闭，再重新审核并核对本草案采用的材料。',
  CURRENT_FACT_NOT_CLOSED:'当前仍有未关闭的业务事实问题。请在原问题完成答复、所需确认及关闭，再回本草案重新检查。',
  CURRENT_CORRECTION_NOT_REVIEWED:'当前更正材料尚未完成审核。请先在原工作包审核该项更正，再核对本草案采用的审核材料。',
  DEFINITION_INCOMPLETE:'请在“编辑完整草案”补齐该条目的名称、编制依据及可定位的证据。',
  AUTHORITY_INCOMPLETE:'请在“编辑完整草案”补齐该条目的业务含义，以及各属性的来源认定、管理部门、依据和证据；确实不适用的来源要求须明确记录。',
  TARGET_REQUIRED:'本条目选择了修订或沿用已有内容，但尚未明确要办理的已有对象。请在“编辑完整草案”选择准确目标。',
  BASE_REQUIRED:'本条目缺少修改前的准确版本。请在“编辑完整草案”明确选择修改前已保存的版本。',
  OWNER_REQUIRED:'本对象尚未明确归口部门。请在“编辑完整草案”核对并选择归口部门。',
  FIELD_CONTEXT_REQUIRED:'请在“编辑完整草案”为本字段选择所属对象、数据使用范围及数据项定义，并明确字段类型和是否必填。',
  CONTEXT_INCOMPLETE:'请在“编辑完整草案”补齐本数据使用范围的部门、用途及允许操作。',
  LIFECYCLE_INCOMPLETE:'请在“编辑完整草案”补齐本生命周期规则适用的数据使用范围、阶段、操作、触发条件及责任部门。',
  CONTEXT_REQUIRES_NEW_RELATION:'数据使用范围、生命周期规则及数据来源认定须建立本次关系，不能直接沿用旧关系。请在“编辑完整草案”按相应条目类型核对办理方式。',
  DEPARTMENT_UNAVAILABLE:'本条目引用的部门当前不可用。请核对部门状态和本条目责任，确认后在“编辑完整草案”选择当前适用的部门。',
  BASE_HEAD_CHANGED:'本条目修改前采用的版本已不是当前有效版本。请核对已有内容的最新状态，再调整草案采用的版本及依据。',
  DEPENDENCIES_CHANGED:'本草案所依据的事实、分歧、来源或已有版本已变化。请先“查看最新记录”，核对受影响内容后保存草案并重新检查。',
  CONFLICT_OPEN:'本工作包仍有未完成核验的分歧。请在原分歧完成协调或决定、所需部门分别重核及处理结果核验，再回本草案重新检查。',
  HISTORICAL_CONFLICT_RECHECK_REQUIRED:'历史承接分歧的办理记录不完整，或尚未完成核验。请回原分歧核对历史及处理结果，不能以新草案绕过原问题。',
  IMPACT_UNRESOLVED:'已有内容的使用影响尚未明确处置。请在“编辑完整草案”的影响处置中选择相应影响，记录决定、依据和证据。',
  APPROVAL_REQUIRED:'本次发布尚未取得所需的当前草案批准。请由有权人员核对检查结果并批准本次草案，再执行整单发布。',
  HANDOFF_REFERENCE_UNAVAILABLE:'准备沿用的已有内容当前不可引用。请核对其发布、撤回和适用范围，选择有权读取且可引用的准确版本。',
  HANDOFF_REFERENCE_MISMATCH:'准备沿用的内容与所选对象或版本不一致。请重新核对准确目标和已有版本，原引用不得按名称猜测替换。',
  HANDOFF_REUSE_CONTENT_CHANGED:'沿用条目的定义与已有固定版本不一致。请核对原定义；需要变更时按修订方式办理，不能以沿用方式改变定义。',
  HANDOFF_VERSION_NOT_FOUND:'准备沿用的固定版本未能读取。请核对已有内容和所选版本；仍无法读取时，由维护人员核对原记录，勿用其他版本代替。',
  HANDOFF_LEGACY_UNAPPROVED:'所选历史内容尚未取得受控引用条件。请核对旧资料接入和审核结果，不能直接作为已批准定义沿用。',
  SOURCE_UPGRADE_ASSESSMENT_REQUIRED:'流程来源已有前版治理结果。请先在本草案的来源升级评估中核对新旧来源、沿用内容及差异，保存评估后重新检查。',
  SOURCE_UPGRADE_REASSESSMENT_REQUIRED:'草案或采用的审核材料已变化，原来源升级评估不能用于本次发布。请重新核对并保存本草案的升级评估。',
  SOURCE_UPGRADE_CURRENT_VERSION_CHANGED:'评估期间现行流程版本已变化。请先核对最新来源，再重新办理本草案的来源升级评估。',
  SOURCE_UPGRADE_SOURCE_INTEGRITY_BLOCKED:'来源升级所依赖的材料未通过完整性核对。请暂停沿用，由维护人员核对原来源记录后再办理。',
  SOURCE_UPGRADE_COMPARISON_CHANGED:'新旧来源的对照结果已变化。请在来源升级评估中重新阅读差异、核对沿用决定并保存。',
  SOURCE_UPGRADE_REVIEW_CHANGED:'来源升级所采用的审核或事实材料已变化。请重新核对新旧审核材料及事实答复，再保存升级评估。',
  CONFLICT_LEGACY_HISTORY_INCOMPLETE:'分歧的历史办理记录尚不完整。请在原分歧核对历史缺口，不能以当前状态代替完整办理依据。',
  CONFLICT_NOT_VERIFIED:'分歧尚未形成有效的处理结果核验。请回原分歧完成所需协调、部门重核及结果核验。',
  CONFLICT_VERIFICATION_STALE:'分歧处理内容已变化，原核验不再对应当前结果。请在原分歧重新核对并核验。',
  CONFLICT_FACT_VERIFICATION_STALE:'分歧所用的事实答复已变化。请在原分歧重新核对当前答复并核验处理结果。',
  FACT_RECHECK_NOT_APPLICABLE_INVALID:'不适用部门事实重核的说明尚不满足本分歧条件。请在原分歧核对争议类别、实际涉及部门及不适用依据。',
  FACT_DEPARTMENT_RECHECK_MISSING:'仍有相关部门未完成本轮独立事实重核。请在原分歧向该部门明确提出问题，并按实际办理完成答复、本人确认及关闭。',
  FACT_RECHECK_NOT_CLOSED:'本轮事实重核问题尚未有效关闭。请在原问题核对当前答复、所需负责人确认及关闭结果。',
  FACT_FINAL_CONFIRMATION_MISSING:'事实重核缺少部门最终负责人的有效本人确认。请在原问题由当前有资格的负责人核对后确认。',
  FACT_DEPARTMENT_CONFIRMATION_CHANGED:'事实确认所依据的部门或最终负责人登记已变化。请在原问题由当前有资格的负责人重新核对。',
  FACT_CONFIRMATION_AUTHORITY_CHANGED:'事实确认人的当前资格已变化，原确认不能代替本轮核对。请在原问题按当前资格重新确认。',
  TERMINOLOGY_REVIEW_REQUIRED:'本草案尚未保存人工术语核对结果。请核对关键概念及采用依据；没有适用词条时，也须说明已核对的范围和依据。',
  TERMINOLOGY_SOURCE_CHANGED:'本草案内容已变化，请重新核对受影响的用词位置并保存本次判断。',
  TERMINOLOGY_TERM_CHANGED:'采用的词条内容或可用状态已变化，请重新核对该处引用。',
  TERMINOLOGY_SUBSTANTIVE_CONFLICT:'已人工确认存在同一语境下的含义冲突，请先处理该处业务含义，再重新核对术语引用。',
  TERMINOLOGY_CANONICAL_NAME_REQUIRED:'已确认属于同义用词，请回到草案编辑核对规范名称，再重新核对引用。',
  TERMINOLOGY_DEPARTMENT_CONFIRMATION_REQUIRED:'本次术语核对仍需相应部门当前负责人本人确认，请按术语核对页面的可办操作继续。',
  TERMINOLOGY_DEPARTMENT_CONFIRMATION_STALE:'原部门负责人确认已不能代表当前办理资格，请按术语核对页面的当前资格重新确认。'
});

// Resolve only exact references already present in this authorized page. Never
// derive a business name or target kind from an internal reference's spelling.
export function handoffGateIssueMessage(issue,{sourceDetails=[],items=[]}={}) {
  const {code,reference}=parts(issue);
  const matches=reference?sourceDetails.filter(row=>row.detail_ref===reference||row.detail_version_id===reference):[];
  const detail=matches.length===1?matches[0]:null;
  const detailName=detail?governanceDetailName(detail):'相关治理明细（名称尚未读取，请查看原工作包）';
  const itemMatches=reference?items.filter(row=>row.item_ref===reference):[];
  const itemName=itemMatches.length===1?businessName(itemMatches[0],'本草案条目名称未记录'):'';
  if(code==='DETAIL_UNMAPPED')return `“${detailName}”尚未有对应草案条目，或原治理依据未齐备。请点击“编辑完整草案”建立对应条目并选择本项作为来源；原治理依据缺失时，先回原工作包补齐并重新审核。`;
  if(code==='DETAIL_TARGET_KIND_INVALID')return `“${detailName}”缺少对应的${Object.hasOwn(detailKinds,detail?.detail_type)?detailKinds[detail.detail_type]:'业务类型'}条目。请点击“编辑完整草案”，选择相应“新增条目类型”，补齐条目并选取本项作为来源。`;
  if(code==='DISPOSITION_INVALID')return `“${detailName}”的不适用或终止处理未与审核结果一致，或依据未齐备。请在“编辑完整草案”核对逐项处理及依据；此类明细不能同时建立承接条目。`;
  if(code==='DETAIL_UNCONFIRMED')return `“${detailName}”尚未完成治理确认。请先回原工作包完成本项治理及审核，再由草案采用当前审核记录。`;
  if(code==='SOURCE_DETAIL_INVALID')return `${itemName?'“'+itemName+'”':'相关草案条目'}未明确对应已确认的治理明细。请在“编辑完整草案”选取本次审核中准确的已确认来源，不能引用未确认或其他材料中的明细。`;
  if(Object.hasOwn(messages,code))return (itemName?'“'+itemName+'”：':'')+messages[code];
  if(code.startsWith('TERMINOLOGY_'))return '本草案术语引用仍有需核对项，请打开术语核对查看具体业务原因。';
  return userMessage(issue,'本项发布条件尚未明确。请先“查看最新记录”并重新检查；仍无法说明原因时，请由维护人员核对本次检查记录。');
}
