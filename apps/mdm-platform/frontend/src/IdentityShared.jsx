import React from 'react';
import './identity-directory.css';

export const labelStatus = value => ({ active:'有效', pending_activation:'待启用', disabled:'已停用', locked:'已锁定', inactive:'停用', archived:'归档', leave:'离职', suspended:'停职', revoked:'已撤销' }[value] || value || '未提供');
export const dateValue = value => value ? String(value).slice(0,10) : '';
export const effective = value => value.status === 'active' && value.roleStatus === 'active' && dateValue(value.effectiveFrom) <= new Date().toISOString().slice(0,10) && (!value.effectiveTo || dateValue(value.effectiveTo) >= new Date().toISOString().slice(0,10));
export function IdentityTable({ headers, rows, empty = '暂无记录' }) {
  return rows.length ? <div className="identity-table" tabIndex={0} aria-label={headers.join('、')}><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j}>{cell ?? '未提供'}</td>)}</tr>)}</tbody></table></div> : <p>{empty}</p>;
}
export function IdentityField({ label, children, ...props }) { return <label className="identity-field">{label}{children ? React.cloneElement(children, { 'aria-label': label }) : <input aria-label={label} {...props}/>}</label>; }
export function identityFailure(error) {
  const messages = { LAST_ACTIVE_ADMIN:'不能停用或撤销最后一个有效管理员。', LAST_ACTIVE_ROLE:'必须保留有效角色，或明确同时停用账号。', ACCOUNT_EXISTS:'该人员已有账号，请刷新列表核对，不要重复创建。', LOGIN_NAME_EXISTS:'登录名已存在，请核对。', ROLE_SCOPE_DEPARTMENT_MISMATCH:'部门角色只能授权到人员所属部门。', INVALID_EFFECTIVE_PERIOD:'失效日期不能早于生效日期。', ROLE_ASSIGNMENT_EVIDENCE_REQUIRED:'请填写授权依据、生效日期并选择角色。', PUBLICATION_SCHEMA_PENDING:'发布记录表尚未准备。', PUBLICATION_FILE_INVALID:'请选择符合要求的 Excel 或 UTF-8 CSV 文件。' };
  return messages[error.code] || (error.status === 422 ? '内容未通过校验，请核对必填项、日期、人员状态及授权范围。' : error.message);
}
