const { identityInteger, sameIdentityInteger } = require('./sessionSubject');
const messages = {
  QUALITY_AUDIT_CONFIGURATION_INVALID:'质量审计配置暂不可用，请联系维护人员',
  QUALITY_AUDIT_DISABLED:'质量审计办理尚未开启', QUALITY_AUDIT_FORBIDDEN:'当前人员无权办理此项质量审计',
  QUALITY_AUDIT_NOT_FOUND:'未找到可查看的质量审计发现', QUALITY_AUDIT_INPUT_INVALID:'请完整填写有效的审计内容',
  QUALITY_AUDIT_DESIGN_UNAPPROVED:'请先由部门负责人本人同意当前流程设计，再开展数据质量审计',
  QUALITY_AUDIT_DESIGN_CHANGED:'流程设计已变化，请重新完成部门确认，并由审计人明确更新审计依据',
  QUALITY_AUDIT_DESIGN_CONFIRMATION_STALE:'当前部门负责人确认已失效，请重新完成本人确认',
  QUALITY_AUDIT_REVISION_CONFLICT:'此项发现已被更新，请保留输入并核对最新记录',
  QUALITY_AUDIT_REQUEST_CONFLICT:'本次办理凭据已用于其他内容，请核对原办理结果',
  QUALITY_AUDIT_STATE_CONFLICT:'当前状态不能执行此操作，请核对最新记录',
  QUALITY_AUDIT_HISTORY_INVALID:'审计历史完整性校验未通过，已停止办理',
  QUALITY_AUDIT_SCHEMA_UNAVAILABLE:'质量审计准备未完成，请联系维护人员'
};
function fail(code,statusCode=409){return Object.assign(new Error(messages[code]||'质量审计暂不可用，请保留输入后重试'),{code,statusCode});}
function uuid(value){if(typeof value!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))throw fail('QUALITY_AUDIT_INPUT_INVALID',400);return value.toLowerCase();}
function id(value){const result=identityInteger(value);if(!result)throw fail('QUALITY_AUDIT_INPUT_INVALID',400);return String(result);}
function text(value,max=12000){if(typeof value!=='string'||!value.trim()||value.length>max)throw fail('QUALITY_AUDIT_INPUT_INVALID',400);return value.trim();}
function exact(body,fields){if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(key=>!fields.includes(key)))throw fail('QUALITY_AUDIT_INPUT_INVALID',400);}
function scope(authority){
  if(authority.permissions.has('governance:read-global'))return {};
  if(authority.permissions.has('governance:read-department')&&authority.user.current_department_id)return {departmentId:String(authority.user.current_department_id)};
  throw fail('QUALITY_AUDIT_FORBIDDEN',403);
}
function auditor(a){return !a.readOnly&&a.roleCodes.has('data_quality_auditor')&&a.permissions.has('governance:quality-audit');}
function contact(a,f){return !a.readOnly&&a.roleCodes.has('department_contact')&&a.permissions.has('governance:draft-department')&&a.permissions.has('governance:submit-department')&&sameIdentityInteger(a.user.current_department_id,f.responsible_department_id);}
function actions(a,f,valid){if(f.state==='closed')return [];const result=[];if(auditor(a)){result.push('revise_design_basis');if(valid&&f.state==='awaiting_review')result.push('review');}if(valid&&f.state==='awaiting_rectification'&&contact(a,f))result.push('submit_rectification');return result;}
module.exports={fail,uuid,id,text,exact,scope,auditor,contact,actions};
