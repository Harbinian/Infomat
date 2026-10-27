import {businessText} from './businessPresentation.js';

// These descriptions and links only project existing records; request identities stay exact.
export function accountAuditLink(account, returnTo='/app/accounts') {
  const query=new URLSearchParams({personId:String(account.person_id),return_to:returnTo});
  return '/app/access-audit?'+query;
}
export function auditAccountReturn(value) {
  try {const url=new URL(value||'/app/accounts','http://local.invalid');return url.origin==='http://local.invalid'&&url.pathname==='/app/accounts'?url.pathname+url.search:'/app/accounts';}
  catch {return '/app/accounts';}
}
export function authorizationDescription(context={}) {
  return `角色：${businessText(context.roleName||'角色名称未记录')}；范围：${businessText(context.scopeName||'授权范围未记录')}；有效期：${businessText(context.effectiveFrom||'生效日期未记录','生效日期待核对')} 至 ${businessText(context.effectiveTo||'长期','失效日期待核对')}`;
}
export function authorizationContext(assignment) {
  if(!assignment)return null;
  const date=value=>/^\d{4}-\d{2}-\d{2}/.test(String(value||''))?String(value).slice(0,10):'';
  return {roleName:assignment.roleName||'角色名称未记录',scopeName:assignment.scopeType==='global'?'全公司范围':assignment.scopeDepartmentName||'授权部门名称未记录',effectiveFrom:date(assignment.effectiveFrom)||(assignment.effectiveFrom?'生效日期待核对':'生效日期未记录'),effectiveTo:assignment.effectiveTo?(date(assignment.effectiveTo)||'失效日期待核对'):Object.hasOwn(assignment,'effectiveTo')?'':'失效日期未记录'};
}
export function accountAuditQuery(event='', personId='') {
  const query=new URLSearchParams({limit:'200'});
  if(event)query.set('eventType',event);
  if(personId)query.set('personId',personId);
  return '/api/org/accounts/audit-events?'+query;
}
