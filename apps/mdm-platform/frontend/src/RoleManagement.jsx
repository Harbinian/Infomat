import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './role-management.css';

const selectedId = () => new URLSearchParams(location.search).get('role_id') || '';
const statusName = value => ({ active: '有效', legacy: '历史兼容', retired: '已退役', revoked: '已撤销' }[value] || value || '未提供');
const effectName = value => ({ allow: '允许', deny: '拒绝' }[value] || value || '未分配');

function Table({ headers, rows, empty }) {
  return rows.length ? <div className="role-table-scroll" tabIndex={0} aria-label={headers.join('、')}><table><thead><tr>{headers.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((cells, i) => <tr key={i}>{cells.map((cell, j) => <td key={j}>{cell ?? '未提供'}</td>)}</tr>)}</tbody></table></div> : <p>{empty}</p>;
}

export function RoleManagement({ api, onLegacy }) {
  const [selection, setSelection] = useState(selectedId);
  const [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [catalogError, setCatalogError] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const back = () => setSelection(selectedId());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
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
  const guide = catalog?.model.roles.find(item => item.code === role?.role_code);
  const label = code => catalog?.model.roles.find(item => item.code === code)?.name || code;
  return <div className="role-management">
    <section className="card"><h2>查看角色及权限边界</h2><p>选择角色，核对角色状态、权限、人员授权记录与固定责任。角色定义、权限矩阵和可见标签均为只读；人员记录中的状态不等于当前有效授权判定。</p>
      <div className="role-management-actions"><button onClick={() => setRevision(value => value + 1)}>刷新角色资料</button><a href="/#/rbac" onClick={onLegacy}>原账号管理与访问审计</a></div>
    </section>
    {catalogError ? <StatusPanel kind="error" title="角色资料暂不可用" onRetry={() => setRevision(value => value + 1)}>{catalogError.message}</StatusPanel> : !catalog ? <StatusPanel kind="loading" title="正在读取角色资料…" /> : <>
      <section className="card"><p>固定模型版本：{catalog.model.modelVersion}</p>
        {catalog.roles.length ? <label>选择角色<select value={roleId} onChange={event => select(event.target.value)}>{selection && !catalog.roles.some(item => String(item.role_id) === selection) && <option value={selection}>所选角色不可用</option>}{catalog.roles.map(item => <option key={item.role_id} value={String(item.role_id)}>{item.role_name} · {item.role_code} · {statusName(item.status)}</option>)}</select></label> : <StatusPanel title="暂无可读取角色">请联系账号管理人员核对角色资料。</StatusPanel>}
      </section>
      {detailBusy && <StatusPanel kind="loading" title="正在读取角色详情…" />}
      {detailError && <StatusPanel kind="error" title="角色详情暂不可用" onRetry={() => setRevision(value => value + 1)}>{detailError.message}</StatusPanel>}
      {role && <div data-role-ready="true" data-role-id={role.role_id}>
        <section className="card"><h2>{role.role_name}</h2><p>{role.description || '未提供角色描述'}</p><dl className="identity-grid"><div><dt>角色编码</dt><dd>{role.role_code}</dd></div><div><dt>状态</dt><dd>{statusName(role.status)}</dd></div><div><dt>历史父角色标识</dt><dd>{role.parent_role_id ?? '无'}</dd></div></dl>
          {guide ? <><h3>工作目标</h3><p>{guide.goal}</p><h3>第一步</h3><p>{guide.firstEntry?.label || '未提供'}</p><ol>{(guide.workflow || []).map((step, index) => <li key={index}>{step}</li>)}</ol><h3>典型样例</h3><p>{guide.sample}</p><h3>常见误区与禁止事项</h3><p>{guide.pitfall}</p><h3>完成标准</h3><p>{guide.doneCriteria}</p></> : <p>该记录未匹配当前固定模型，保留原始状态和权限供兼容查阅，不赋予新的权限。</p>}
        </section>
        <section className="card"><h2>角色权限详情</h2><Table headers={['权限', '说明', '效果', '来源', '字段限制']} empty="该角色没有权限记录。" rows={(role.permissions || []).map(item => [item.perm_code, item.description, effectName(item.effect), item.inherited ? '历史继承记录' : '直接记录', item.field_constraints == null ? '未提供' : typeof item.field_constraints === 'object' ? JSON.stringify(item.field_constraints) : item.field_constraints || '未提供'])} /></section>
        <section className="card"><h2>权限矩阵（只读）</h2><Table headers={['权限', '说明', '直接分配', '效果']} empty="暂无权限矩阵。" rows={(detail.matrix || []).map(item => [item.perm_code, item.description, item.assigned ? '是' : '否', effectName(item.effect)])} /></section>
        <section className="card"><h2>人员授权记录</h2><p>按原接口保留全部授权记录及范围；撤销记录不隐藏，也不标为有效成员。</p><Table headers={['人员 / 工号', '当前部门', '授权状态', '授权范围', '范围部门标识']} empty="暂无人员授权记录。" rows={(role.users || []).map(item => [`${item.name} / ${item.employee_no}`, item.dept_name, statusName(item.assignment_status), item.scope_type === 'global' ? '全局' : item.scope_type === 'department' ? '部门' : item.scope_type, item.scope_department_id ?? '不适用'])} /></section>
        <section className="card"><h2>角色可见标签</h2><p>标签可见性不替代服务端权限、部门及对象状态校验。</p><Table headers={['功能标签', '访问方式', '依据']} empty="当前固定模型未提供该角色的可见标签。" rows={(guide?.visibleTabs || []).map(item => [`${item.name} · ${item.code}`, item.access, item.reason])} /></section>
      </div>}
      <section className="card"><h2>固定责任矩阵</h2><Table headers={['治理活动', 'R：执行', 'A：最终负责', 'C：参与', 'I：知悉']} empty="暂无固定责任矩阵。" rows={(catalog.model.activities || []).map(item => [item.name, ...['responsible', 'accountable', 'consulted', 'informed'].map(key => (item[key] || []).map(label).join('、') || '未指定')])} /></section>
    </>}
  </div>;
}
