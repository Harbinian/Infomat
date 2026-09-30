import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './role-management.css';

const selectedRole = () => new URLSearchParams(location.search).get('role') || '';
const guideActions = [
  ['governance:draft-department', '起草或修改部门材料'],
  ['governance:submit-department', '提交部门材料'],
  ['governance:review-department', '审核或退回部门材料'],
  ['governance:record-department-decision', '记录部门负责人决定'],
  ['governance:handle-assigned-conflict', '处理已分派冲突'],
  ['governance:decide-escalation', '决定已升级争议'],
  ['governance:publish', '发布治理版本'],
  ['identity:manage-account', '办理账号与授权']
];
const list = values => Array.isArray(values) && values.length ? values.join('、') : '未指定';

export function RoleGuide({ api, user, onLegacy, onQueryChange }) {
  const [code, setCode] = useState(selectedRole);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ loading: true });
  const [todoState, setTodoState] = useState({ loading: true });
  useEffect(() => {
    const pop = () => setCode(selectedRole());
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    api.request('/api/rbac/model', { signal: controller.signal }).then(model => {
      if (!Array.isArray(model.roles) || !Array.isArray(model.activities) || !Array.isArray(model.permissions)) throw new Error('固定角色模型返回格式不完整，请刷新核对。');
      if (!controller.signal.aborted) setState({ model });
    }).catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setTodoState({ loading: true });
    api.request('/api/role-workbench?mode=todo', { signal: controller.signal }).then(result => {
      if (!Array.isArray(result.workItems)) throw new Error('工作台待办格式不完整');
      if (!controller.signal.aborted) setTodoState({ items: result.workItems.filter(item => item.type !== 'guidance') });
    }).catch(() => { if (!controller.signal.aborted) setTodoState({ error: true }); });
    return () => controller.abort();
  }, [api, revision]);
  function choose(value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set('role', value); else url.searchParams.delete('role');
    onQueryChange(url, true);
    setCode(value);
  }
  const model = state.model;
  const owned = new Set([...(user.rbacRoles || []).map(role => role.code), ...(user.roleCodes || [])]);
  const currentCode = code || model?.roles.find(role => owned.has(role.code))?.code || model?.roles[0]?.code || '';
  const role = model?.roles.find(item => item.code === currentCode);
  const permissionSet = new Set(user.permissions || []);
  const permissionDescriptions = new Map((model?.permissions || []).map(item => [item.code, item.description]));
  const missing = guideActions.filter(([permission]) => permissionDescriptions.has(permission) && !permissionSet.has(permission));
  const roleNames = new Map((model?.roles || []).map(item => [item.code, item.name]));
  const names = codes => list((codes || []).map(item => roleNames.get(item) || item));
  const roleTodos = role ? (todoState.items || []).filter(item => item.roleCode === role.code || item.role_code === role.code || (item.sourceRoles || []).includes(role.code)) : [];
  const responsibilities = role?.raciResponsibilities || [];
  const roleRaci = responsibilities.map(item => {
    const marks = [['responsible', 'R'], ['accountable', 'A'], ['consulted', 'C'], ['informed', 'I']]
      .filter(([key]) => item.raci?.[key]).map(([, mark]) => mark);
    return `${item.name}（${marks.join('/')}）`;
  });
  const firstEntry = role?.firstEntry?.target;
  const firstEntryHref = typeof firstEntry === 'string' && /^#\/[A-Za-z][A-Za-z0-9/?=&_-]*$/.test(firstEntry) ? `/${firstEntry}` : '';
  return <div className="role-management" data-role-guide-state={state.loading ? 'loading' : state.error ? 'error' : 'ready'}>
    <section className="card"><h2>角色与责任</h2>
      <p>查看固定角色的目标、使用说明和责任矩阵。当前账号的有效角色与权限来自登录身份；此页只读，不能授予角色或代替具体事项的服务端核验。</p>
      <div className="role-management-actions"><button type="button" onClick={() => setRevision(value => value + 1)}>刷新角色说明</button><a href="/#/roleGuide" onClick={onLegacy}>查看原角色与责任入口</a></div>
    </section>
    {state.loading ? <StatusPanel kind="loading" title="正在读取固定角色模型…" /> : state.error ? <StatusPanel kind="error" title="角色说明暂不可用" onRetry={() => setRevision(value => value + 1)}>{state.error.message} 读取失败不代表角色或权限已变更。</StatusPanel> : <>
      <section className="card"><p>固定治理模型：{model.modelVersion || '版本未提供'}</p><p>当前账号角色：{names([...owned])}。</p>
        {model.roles.length ? <label>查看角色<select aria-label="查看角色" value={currentCode} onChange={event => choose(event.target.value)}>{code && !role && <option value={code}>所选角色已不可用</option>}{model.roles.map(item => <option key={item.code} value={item.code}>{item.name}{owned.has(item.code) ? ' · 我的角色' : ' · 角色说明'}</option>)}</select></label> : <p>固定模型暂无角色。</p>}
        {code && !role && <p role="alert">所选角色不在当前固定模型中，请重新选择。</p>}
      </section>
      {role && <section className="card" data-role-guide-code={role.code}><h3>{role.name}</h3><p>{role.description || '未提供说明'}</p>
        <dl className="identity-grid"><div><dt>角色目标</dt><dd>{role.goal || '未提供'}</dd></div><div><dt>第一步入口</dt><dd>{firstEntryHref ? <a href={firstEntryHref} onClick={onLegacy}>{role.firstEntry.label}</a> : role.firstEntry?.label || '未提供'}</dd></div><div><dt>可见功能标签</dt><dd>{list((role.visibleTabs || []).map(tab => tab.name))}</dd></div><div><dt>当前待办</dt><dd>{todoState.loading ? '正在读取…' : todoState.error ? '暂不可用，请到我的工作台核对' : `${roleTodos.length} 项`}；<a href="/app/workbench" onClick={onLegacy}>进入我的工作台</a></dd></div><div><dt>允许动作</dt><dd>{list((role.permissions || []).map(permission => permissionDescriptions.get(permission) || permission))}</dd></div><div><dt>角色 RACI 责任</dt><dd>{list(roleRaci)}</dd></div><div><dt>典型样例</dt><dd>{role.sample || '未提供'}</dd></div><div><dt>常见误区</dt><dd>{role.pitfall || '未提供'}</dd></div><div><dt>完成标准</dt><dd>{role.doneCriteria || '未提供'}</dd></div></dl>
        <p>处理顺序：{list(role.workflow)}</p>
      </section>}
      <section className="card"><h3>当前不可直接执行的常见动作</h3>
        <p>下列动作缺少对应有效权限。具备权限仍须满足部门范围、对象状态、分派关系及责任依据，最终结果以服务端返回为准。</p>
        {missing.length ? <ul>{missing.map(([permission, action]) => <li key={permission}><strong>{action}</strong>：当前身份未获 {permission}。{permissionDescriptions.get(permission)}</li>)}</ul> : <p>下列常见动作未发现缺失权限；具体事项仍需逐项核对。</p>}
      </section>
      <section className="card"><h3>RACI 责任矩阵</h3><p>R 表示执行，A 表示最终负责，C 表示参与，I 表示知悉。矩阵为固定模型的角色责任说明，不是个人办理授权。</p>
        {model.activities.length ? <div className="role-table-scroll" tabIndex={0} aria-label="RACI 责任矩阵"><table><thead><tr>{['治理活动', 'R：执行', 'A：最终负责', 'C：参与', 'I：知悉'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead><tbody>{model.activities.map((activity, index) => <tr key={activity.activityCode || index}><td>{activity.name}</td><td>{names(activity.responsible)}</td><td>{names(activity.accountable)}</td><td>{names(activity.consulted)}</td><td>{names(activity.informed)}</td></tr>)}</tbody></table></div> : <p>当前模型暂无责任矩阵。</p>}
      </section>
    </>}
  </div>;
}
