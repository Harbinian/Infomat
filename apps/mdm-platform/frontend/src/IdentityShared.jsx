import {businessStatus,businessText,userMessage} from './businessPresentation.js';
import React from 'react';
import './identity-directory.css';

export const labelStatus = value => ({ active:'有效', pending_activation:'待启用', disabled:'已停用', locked:'已锁定', inactive:'停用', archived:'归档', leave:'离职', suspended:'停职', revoked:'已撤销' }[value] || businessStatus(value));
export const dateValue = value => value ? String(value).slice(0,10) : '';
export const effective = value => value.status === 'active' && value.roleStatus === 'active' && dateValue(value.effectiveFrom) <= new Date().toISOString().slice(0,10) && (!value.effectiveTo || dateValue(value.effectiveTo) >= new Date().toISOString().slice(0,10));
export function IdentityTable({ headers, rows, empty = '暂无记录' }) {
  // Technical columns stay out of the rendered table; stored rows remain unchanged.
  const columns=headers.map((name,index)=>({name,index})).filter(({name})=>!(/^(编号(?:\s*\/.*)?|.*标识|.*摘要|迁移批次|固定版本|角色编码|权限代码)$/.test(name)));
  return rows.length ? <div className="identity-table" tabIndex={0} aria-label={columns.map(c=>c.name).join('、')}><table><thead><tr>{columns.map(({name,index})=><th key={index}>{name}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{columns.map(({index})=><td key={index}>{typeof row[index]==='string'?businessText(row[index],'名称或说明未记录'):row[index]??'未提供'}</td>)}</tr>)}</tbody></table></div> : <p>{empty}</p>;
}
export function IdentityField({ label, children, ...props }) { return <label className="identity-field">{label}{children ? React.cloneElement(children, { 'aria-label': label }) : <input aria-label={label} {...props}/>}</label>; }
export function identityFailure(error, action) {
  if (error.directoryMessage) return userMessage(error.directoryMessage);
  if (['activate', 'enable'].includes(action)) {
    if (error.code === 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED') return '账号至少需要一个已生效的系统角色。请先在该人员行办理“新增角色授权”；已有授权时，请核对授权状态、生效日期和失效日期，再启用账号。授权依据为选填。';
    if (error.code === 'PERSON_INACTIVE') return '人员当前不是在职状态，不能启用账号。请先核对花名册中的人员状态。';
    if (error.code === 'ACTIVE_DEPARTMENT_REQUIRED') return '人员尚未绑定有效部门，不能启用账号。请先核对人员所属部门及该部门状态。';
  }
  const messages = { LAST_ACTIVE_ADMIN:'不能停用或撤销最后一个有效管理员。', LAST_ACTIVE_ROLE:'必须保留有效角色，或明确同时停用账号。', ACCOUNT_EXISTS:'该人员已有账号，请刷新列表核对，不要重复创建。', LOGIN_NAME_EXISTS:'登录名已存在，请核对。', ROLE_SCOPE_DEPARTMENT_MISMATCH:'部门角色只能授权到人员所属部门。', INVALID_EFFECTIVE_PERIOD:'失效日期不能早于生效日期。', ROLE_ASSIGNMENT_EVIDENCE_REQUIRED:'请选择角色并填写生效日期；授权依据为选填。', PUBLICATION_SCHEMA_PENDING:'发布记录表尚未准备。', PUBLICATION_FILE_INVALID:'请选择符合要求的 Excel 或 UTF-8 CSV 文件。' };
  if (error.code === 'LOGIN_NAME_MUST_MATCH_EMPLOYEE_NO') return '新账号登录名必须与工号一致，请核对工号后重新办理。';
  if (error.code === 'PERSON_IDENTITY_CHANGED') return '人员工号、姓名或部门已变化，原输入已保留。请刷新资料并按最新人员记录重新办理。';
  return messages[error.code] || (error.status === 422 ? '内容未通过校验，请核对必填项、日期、人员状态及授权范围。' : userMessage(error));
}
