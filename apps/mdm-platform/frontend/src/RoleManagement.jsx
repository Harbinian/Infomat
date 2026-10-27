import {BusinessDetails} from "./BusinessDetails.jsx";
import {businessStatus,businessText,userMessage} from "./businessPresentation.js";
import { qualityEntryNotice, roleCompletionPresentation, roleSubjectName } from './rolePresentation.js';
import { departmentRoleDirectoryGuidance } from './navigationAccess.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './role-management.css';

const selectedId = () => new URLSearchParams(location.search).get('role_id') || '';
const statusName = value => ({ active: '有效', legacy: '历史兼容', retired: '已退役', revoked: '已撤销' }[value] || businessStatus(value,'未提供'));
const effectName = value => ({ allow: '允许', deny: '拒绝' }[value] || businessStatus(value,'未分配'));
const pageAccessName = value => ({read:'可查阅',role_scoped:'按本人职责和范围查阅',read_or_manage:'按权限查阅或管理'}[value] || '访问方式说明未提供');
const pageReason = item => ({orgUnits:'查看当前有效的组织和部门信息',persons:'按已有查阅权限查看当前员工信息',rbac:'由管理员维护账号与授权',roleGuide:'已登录人员可查阅角色职责说明'}[item.code] || businessText(item.reason,'查看本页提供的职责及范围说明'));


function Table({ headers, rows, empty }) {
  return rows.length ? <div className="role-table-scroll" tabIndex={0} aria-label={headers.join('、')}><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((cell, j) => <td key={j}>{typeof cell==='string'?businessText(cell):cell ?? '未提供'}</td>)}</tr>)}</tbody></table></div> : <p>{empty}</p>;
}

export function RoleManagement({ api, onNavigate, user }) {
  const [selection, setSelection] = useState(selectedId);
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [requirements, setRequirements] = useState(null);
  const [requirementsError, setRequirementsError] = useState(null);
  const sequence = useRef(0);
  useEffect(() => {
    const back = () => setSelection(selectedId());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setRequirements(null); setRequirementsError(null);
    api.request('/api/rbac/department-role-requirements', { signal: controller.signal })
      .then(value => { if (!controller.signal.aborted) setRequirements(value); })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setRequirementsError(error); });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setCatalog(null); setCatalogError(null); setDetail(null); setDetailError(null);
    Promise.all([api.request('/api/roles', { signal: controller.signal }), api.request('/api/rbac/model', { signal: controller.signal })])
      .then(([roles, model]) => { if (!controller.signal.aborted) setCatalog({ roles, model }); })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setCatalogError(error); });
    return () => controller.abort();
  }, [api, revision]);
  const roleId = selection || String(catalog?.roles[0]?.role_id || '');
  useEffect(() => {
    const controller = new AbortController(), requestId = ++sequence.current;
    setDetail(null); setDetailError(null); setDetailBusy(false);
    if (!catalog || !roleId) return () => controller.abort();
    if (!catalog.roles.some(role => String(role.role_id) === roleId)) {
      setDetailError({ message: '所选角色不在当前可读取列表中，请重新选择。' });
      return () => controller.abort();
    }
    setDetailBusy(true);
    Promise.all([api.request(`/api/roles/${encodeURIComponent(roleId)}`, { signal: controller.signal }), api.request(`/api/roles/${encodeURIComponent(roleId)}/permissions`, { signal: controller.signal })])
      .then(([role, permissions]) => { if (!controller.signal.aborted && requestId === sequence.current) setDetail({ role, matrix: permissions.matrix }); })
      .catch(error => { if (!controller.signal.aborted && error.name !== 'AbortError') setDetailError(error); })
      .finally(() => { if (!controller.signal.aborted) setDetailBusy(false); });
    return () => controller.abort();
  }, [api, catalog, roleId]);
  function select(value) {
    const url = new URL(location.href); url.searchParams.set('role_id', value);
    history.pushState(history.state, '', url.pathname + url.search);
    setDetail(null); setDetailError(null); setSelection(value);
  }
  const role = detail?.role;
  const guide = roleCompletionPresentation(catalog?.model.roles.find(item => item.code === role?.role_code));
  const label = code => roleSubjectName(code, catalog?.model.roles);
  return <div className="role-management">
    <section className="card" data-department-role-requirements><h2>部门必要角色配置</h2>
      <p>部门主对接人提交流程材料，部门负责人核对并最终确认。角色配置不绑定具体人员；负责人须另有明确的本部门最终负责人记录及有效角色授权，缺少任一条件均不能代办确认。</p>
      {requirementsError ? <StatusPanel kind="error" title="部门角色配置暂不可用" onRetry={() => setRevision(value => value + 1)}>{userMessage(requirementsError.message)}</StatusPanel> : !requirements ? <StatusPanel kind="loading" title="正在读取部门角色配置…" /> : <>
        <p>已配置{requirements.departments.length}个部门，每个部门设置部门主对接人、部门负责人。下表列出当前保存的部门职责要求。</p>
        <Table headers={['部门', '部门主对接人', '部门负责人', '数据范围', '人员绑定']} empty="尚未配置部门角色。" rows={requirements.departments.map(department => [department.name, '已设置', '已设置', '人员所属的本部门', '本配置不绑定人员'])} />
        <details><summary>两类部门角色的权限与职责</summary>{requirements.department_roles.map(item => <div key={item.code}><h3>{item.name}</h3><p>{item.description}</p><ul>{item.permissions.map(permission => <li key={permission.code}>{permission.description}</li>)}</ul></div>)}</details>
        <p>其他角色保留既定权限和事项范围。办公室归属、部门角色配置及岗位名称不产生人员授权，也不指定部门负责人。{departmentRoleDirectoryGuidance(user)}</p>
      </>}
    </section>
    <section className="card"><h2>查看角色及权限边界</h2><p>选择角色，核对角色状态、权限、人员授权记录与固定责任。角色定义、权限范围和可查看页面仅供查阅；人员记录中的状态不等于当前有效授权判定。</p>
      <div className="role-management-actions"><button onClick={() => setRevision(value => value + 1)}>刷新角色资料</button></div>
    </section>
    {catalogError ? <StatusPanel kind="error" title="角色资料暂不可用" onRetry={() => setRevision(value => value + 1)}>{userMessage(catalogError.message)}</StatusPanel> : !catalog ? <StatusPanel kind="loading" title="正在读取角色资料…" /> : <>
      <section className="card">
        {catalog.roles.length ? <label>选择角色<select value={roleId} onChange={event => select(event.target.value)}>{selection && !catalog.roles.some(item => String(item.role_id) === selection) && <option value={selection}>所选角色不可用</option>}{catalog.roles.map(item => <option key={item.role_id} value={String(item.role_id)}>{catalog.model.roles.find(current => current.code === item.role_code)?.name || item.role_name} · {statusName(item.status)}</option>)}</select></label> : <StatusPanel title="暂无可读取角色">请联系账号管理人员核对角色资料。</StatusPanel>}
      </section>
      {detailBusy && <StatusPanel kind="loading" title="正在读取角色详情…" />}
      {detailError && <StatusPanel kind="error" title="角色详情暂不可用" onRetry={() => setRevision(value => value + 1)}>{userMessage(detailError)}</StatusPanel>}
      {role && <div data-role-ready="true" data-role-id={role.role_id}>
        <section className="card"><h2>{guide?.name || role.role_name}</h2><p>{guide?.description || role.description || '未提供角色描述'}</p><dl className="identity-grid"><div><dt>状态</dt><dd>{statusName(role.status)}</dd></div></dl>
          {guide?.code === 'data_quality_auditor' && <p role="note">{qualityEntryNotice}</p>}
          {guide ? <><h3>工作目标</h3><p>{guide.goal}</p><h3>第一步</h3><p>{guide.firstEntry?.label || '未提供'}</p><ol>{(guide.workflow || []).map((step, index) => <li key={index}>{step}</li>)}</ol><h3>典型样例</h3><p>{guide.sample}</p><h3>常见误区与禁止事项</h3><p>{guide.pitfall}</p><h3>完成标准</h3><p>{guide.doneCriteria}</p>{guide.resultGuidance && <><h3>完成后去哪查看</h3><p>{guide.resultGuidance}</p></>}</> : <p>该记录未匹配当前固定模型，保留原始状态和权限供兼容查阅，不赋予新的权限。</p>}
        </section>
        <section className="card"><h2>角色权限详情</h2><Table headers={['允许办理的事项', '效果', '来源', '字段限制']} empty="该角色没有权限记录。" rows={(role.permissions || []).map(item => [item.description, effectName(item.effect), item.inherited ? '历史继承记录' : '直接记录', item.field_constraints == null ? '未提供' : typeof item.field_constraints === 'object' ? <BusinessDetails value={item.field_constraints}/> : item.field_constraints || '未提供'])} /></section>
        <section className="card"><h2>权限矩阵（只读）</h2><Table headers={['允许办理的事项', '直接分配', '效果']} empty="暂无权限矩阵。" rows={(detail.matrix || []).map(item => [item.description||'事项名称未记录', item.assigned ? '是' : '否', effectName(item.effect)])} /></section>
        <section className="card"><h2>人员授权记录</h2><p>展示当前可查阅的授权记录及适用范围；撤销记录不隐藏，也不标为有效成员。</p><Table headers={['人员 / 工号', '当前部门', '授权状态', '授权范围', '适用部门']} empty="暂无人员授权记录。" rows={(role.users || []).map(item => [`${item.name} / ${item.employee_no}`, item.dept_name, statusName(item.assignment_status), item.scope_type === 'global' ? '全局' : item.scope_type === 'department' ? '部门' : businessStatus(item.scope_type), item.scope_department_name || (item.scope_type==='global'?'全公司范围':'部门名称未记录')])} /></section>
        <section className="card"><h2>该角色可查看的页面</h2><p>可见页面不代表具有办理权限，具体操作仍须符合部门范围和事项状态要求。</p><Table headers={['页面', '访问方式', '依据']} empty="尚未提供该角色可查看的页面说明。" rows={(guide?.visibleTabs || []).map(item => [item.name, pageAccessName(item.access), pageReason(item)])} /></section>
      </div>}
      <section className="card"><h2>固定责任矩阵</h2><Table headers={['治理活动', 'R：执行', 'A：最终负责', 'C：参与', 'I：知悉']} empty="暂无固定责任矩阵。" rows={(catalog.model.activities || []).map(item => [item.name, ...['responsible', 'accountable', 'consulted', 'informed'].map(key => (item[key] || []).map(label).join('、') || '未指定')])} /></section>
    </>}
  </div>;
}
