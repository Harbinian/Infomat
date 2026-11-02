import {businessText,userMessage} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './identity-directory.css';
import {handoffTargetWithReturn} from './handoffNavigation.js';
import {handoffStateName} from './dataMapHandoffRequest.js';
import {protocol} from './protocol.js';
import {currentWorkbenchSnapshot,loadWorkbenchReviewPresentation,handoffWorkItemPresentation} from './workbenchReviewPresentation.js';

const types = { field_confirm: '字段确认', gold_source: '黄金源确认', conflict_resolution: '冲突协调', terminology: '术语申报', general: '通用' };
const statuses = { pending: '待处理', done: '已完成' };
// A todo type identifies a work area, not a stable record identity. In particular,
// related_mapping_id cannot distinguish field conflicts from term conflicts.
function relatedWork(row) {
  if (row.type === 'conflict_resolution') return { path: '/app/conflicts', label: '到冲突列表核对', note: '待办未提供可直接定位的冲突类型和编号，请在当前可见列表核对具体事项。' };
  if (row.type === 'terminology' && row.related_term_id != null) {
    const id = String(row.related_term_id);
    if (/^[1-9]\d*$/.test(id) && Number.isSafeInteger(Number(id))) return { path: `/app/terms?id=${encodeURIComponent(id)}`, label: '查看关联术语', note: `请核对所关联的术语。打开时按当前身份读取当前内容，不代表固定历史术语版本；待办可见不表示有权查看该术语。` };
    return { path: '/app/terms', label: '到术语列表核对', note: '术语来源编号无法精确读取，请核对原记录，本页不会猜测关联。' };
  }
  if (row.type === 'terminology') return { path: '/app/terms', label: '到术语列表核对', note: '待办未提供可直接定位的术语编号，请在当前可见列表核对具体事项。' };
  return null;
}
function dueDate(value) {
  if (!value) return '未设置';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
function selection() {
  const query = new URLSearchParams(location.search);
  return { status: query.get('status') || '', type: query.get('type') || '' };
}

export function TodoInbox({ api, user, onNavigate, onQueryChange }) {
  const [filter, setFilter] = useState(selection);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ busy: true });
  const [handoffState, setHandoffState] = useState({busy:true});
  const [currentState, setCurrentState] = useState({busy:true});
  const [action, setAction] = useState(null);
  const attempt = useRef(null);
  const actionPanel = useRef(null);
  useEffect(() => { if (action?.phase) actionPanel.current?.focus(); }, [action?.phase]);
  const canDelete = (user.permissions || []).includes('governance:structure-gate') && !(user.permissions || []).includes('identity:manage-account');
  const canComplete = row => row.status === 'pending' && !row.related_mapping_id &&
    !(user.permissions || []).includes('identity:manage-account') &&
    Boolean(user.departmentId) && Number(row.to_dept_id) === Number(user.departmentId) &&
    ['governance:draft-department', 'governance:submit-department', 'governance:review-department'].some(code => (user.permissions || []).includes(code));
  const actionLabel = action?.kind === 'complete' ? '完成' : '删除';
  function cancelAction() { attempt.current?.abort(); attempt.current = null; setAction(null); }
  useEffect(() => () => { attempt.current?.abort(); }, []);
  useEffect(() => {
    const restore = () => { cancelAction(); setState({ busy: true }); setFilter(selection()); };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  const valid = (!filter.status || Object.hasOwn(statuses, filter.status)) && (!filter.type || Object.hasOwn(types, filter.type));
  useEffect(() => {
    if (!valid) { setState({ error: new Error('筛选参数不受支持，请重新选择状态和类型。') }); return; }
    const controller = new AbortController();
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filter)) if (value) query.set(key, value);
    setState({ busy: true });
    api.request('/api/todos?' + query, { signal: controller.signal })
      .then(rows => {
        if (!Array.isArray(rows)) throw new Error('待办返回格式异常，请刷新重试。');
        if (!controller.signal.aborted) setState({ rows });
      })
      .catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, filter, revision, valid]);
  useEffect(() => {
    const controller=new AbortController();setHandoffState({busy:true});
    api.request('/api/data-map-handoffs/workbench',{signal:controller.signal}).then(data=>{
      if(!Array.isArray(data.work_items)||!data.availability)throw new Error('承接事项返回格式异常，不能据此判断没有事项。');
      if(!controller.signal.aborted)setHandoffState({data:{...data,work_items:data.work_items.map(row=>handoffWorkItemPresentation(row,data))}});
    }).catch(error=>{if(!controller.signal.aborted)setHandoffState({error});});
    return()=>controller.abort();
  },[api,revision]);
  useEffect(() => {
    const controller = new AbortController(); setCurrentState({busy:true});
    api.request('/api/role-workbench?mode=todo', {signal:controller.signal})
      .then(data => loadWorkbenchReviewPresentation(api, data, {signal:controller.signal}))
      .then(data => { const snapshot = currentWorkbenchSnapshot(data); if(!controller.signal.aborted)setCurrentState({data:snapshot}); })
      .catch(error => { if(!controller.signal.aborted)setCurrentState({error}); });
    return () => controller.abort();
  }, [api,revision]);
  function change(key, value) {
    cancelAction();
    const next = { ...filter, [key]: value };
    const url = new URL(location.href);
    for (const [name, selected] of Object.entries(next)) selected ? url.searchParams.set(name, selected) : url.searchParams.delete(name);
    onQueryChange(url.pathname + url.search, true);
    setState({ busy: true }); setFilter(next);
  }
  async function submitAction() {
    if (!action?.row || action.phase !== 'confirm' || attempt.current) return;
    const row = action.row;
    const kind = action.kind;
    const controller = new AbortController();
    attempt.current = controller;
    setAction({ row, kind, phase: 'pending' });
    let sent = false;
    try {
      const rows = await api.request('/api/todos', { signal: controller.signal });
      if (!Array.isArray(rows)) throw new Error('待办返回格式异常，请刷新后重新核对。');
      const current = rows.find(item => String(item.id) === String(row.id));
      if (!current || JSON.stringify(current) !== JSON.stringify(row)) throw new Error('待办已变化、已删除或不再可见，请刷新后重新核对。');
      if (controller.signal.aborted) return;
      sent = true;
      const result = await api.request(`/api/todos/${encodeURIComponent(row.id)}${kind === 'complete' ? '/done' : ''}`, { method: kind === 'complete' ? 'POST' : 'DELETE', signal: controller.signal });
      if (result?.success !== true) throw new Error(`${actionLabel}回执异常。`);
      if (controller.signal.aborted) return;
      setAction({ kind, phase: 'success', message: `所选待办已${actionLabel}。` });
      setState({ busy: true }); setRevision(value => value + 1);
    } catch (error) {
      if (controller.signal.aborted) return;
      const message = error.code === 'OFFICE_TASK_REQUIRES_WORKBENCH'
        ? '该任务已由办公室承接，请到办公室工作台办理。'
        : `${userMessage(error)}${sent ? ` ${actionLabel}请求已发出，请刷新核对记录；不要直接重复${actionLabel}。` : ''}`;
      setAction({ row, kind, phase: 'error', message });
    } finally { if (attempt.current === controller) attempt.current = null; }
  }
  return <div className="identity-module" data-todo-state={state.busy ? 'loading' : state.error ? 'error' : 'ready'} data-current-items-state={currentState.busy?'loading':currentState.error?'error':'ready'}>
    <section className="card">
      <div className="section-heading"><h1>收到的待办</h1><button className="secondary" disabled={action?.phase === 'pending'} onClick={() => { cancelAction(); setState({ busy: true }); setRevision(value => value + 1); }}>刷新待办</button></div>
      <p>“本人当前办理事项”与“我的工作台”使用同一口径，列出本人当前有权办理的流程、治理、办公室和数据地图承接事项。原部门待办另行列出，以下状态及类型筛选只影响原部门待办，不影响当前办理事项或承接事项。</p>
      <p>原部门待办依次按紧急程度、截止日期和创建时间排序；不能将其数量与当前办理事项相加，同一办公室任务可能同时出现在两处。</p>
      <p className="muted">本部门有办理权限的人员可确认完成未关联原映射记录的待办；具备结构核对权限的人员可删除待办。有明确来源的术语待办可查看关联术语；其余术语及冲突事项进入相应列表核对，办公室任务请到办公室工作台办理。待办已完成或删除不表示问题关闭或正式审核通过。</p>
      <div className="identity-actions"><a href="/app/offices" onClick={event => onNavigate(event, '/app/offices')}>进入办公室工作台</a></div>
      <div className="identity-fields">
        <label className="identity-field">待办状态<select aria-label="待办状态" disabled={action?.phase === 'pending'} value={filter.status} onChange={event => change('status', event.target.value)}>
          <option value="">全部状态</option>{filter.status && !Object.hasOwn(statuses, filter.status) && <option value={filter.status}>不支持的状态</option>}{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="identity-field">待办类型<select aria-label="待办类型" disabled={action?.phase === 'pending'} value={filter.type} onChange={event => change('type', event.target.value)}>
          <option value="">全部类型</option>{filter.type && !Object.hasOwn(types, filter.type) && <option value={filter.type}>不支持的类型</option>}{Object.entries(types).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
      </div>
    </section>
    <section className="card" aria-label="本人当前办理事项" data-current-work-items>
      <h2>本人当前办理事项{currentState.data&&<>（{currentState.data.count}项）</>}</h2>
      {currentState.busy?<StatusPanel kind="loading" title="正在读取本人当前办理事项…"/>:currentState.error?<StatusPanel kind="error" title="本人当前办理事项暂不可用">{userMessage(currentState.error)} 不能根据原部门待办为零判断没有当前事项，请刷新待办重试。</StatusPanel>:<>
        <p data-current-work-count>本人当前办理事项：{currentState.data.count}项；与“我的工作台”相同。数据地图承接事项在下方独立区域办理，已包含在此总数内，不重复相加。</p>
        {currentState.data.otherItems.map((row,index)=>{
          const original=protocol.targetHref(row.target),href=handoffTargetWithReturn(original,location.pathname+location.search)||original;
          return <article className="import-record" key={String(row.type)+':'+String(row.id??index)}><h3>{businessText(row.title,'事项名称未记录')}</h3>
            {row.handlingGuide?<><p>办理角色：{row.handlingGuide.actor}</p><p>怎么操作：{row.handlingGuide.operation}</p><p>完成后查看：{row.handlingGuide.result}</p>{row.handlingGuide.handoff&&<p>{row.handlingGuide.handoff}</p>}</>:<><p>{businessText(row.nextStep||row.actionLabel,'请进入原事项核对当前可办动作')}</p>{row.sample&&<p>{businessText(row.sample,'办理说明暂无法直接展示，请进入原事项核对。')}</p>}<p>请在原事项办理并查看保存结果；返回本页后点击“刷新待办”核对当前状态。</p></>}
            {href?<a href={href} onClick={event=>onNavigate(event,href)}>{businessText(row.actionLabel,'进入原事项')}</a>:<p>原事项入口暂不可用，请返回“我的工作台”核对。</p>}
          </article>;
        })}
        {!currentState.data.count&&<p>当前已读取的业务范围内没有本人当前可办理事项；原部门待办另在下方查阅。</p>}
      </>}
    </section>
    {action && <section ref={actionPanel} tabIndex={-1} className="card" aria-label={`待办${actionLabel}核对`} aria-live="polite">
      {action.row && <><h2>{actionLabel}所选待办</h2><p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{action.row.content || '未记录内容'}</p><p>接收部门：{action.row.to_dept_name || '未记录'}。{action.kind === 'complete' ? '请确认本次待办已办理；完成后记录办理人员和时间，本页不提供撤销。问题关闭和正式审核须另行办理。' : '删除后将从待办列表移除，不能在本页撤销；关联事项不会因此办结。'}</p></>}
      {action.phase === 'confirm' ? <div className="identity-actions"><button onClick={submitAction}>确认{actionLabel}此待办</button><button className="secondary" onClick={cancelAction}>取消{actionLabel}</button></div>
        : <p role={action.phase === 'error' ? 'alert' : 'status'}>{userMessage(action.phase === 'pending' ? `正在核对并${actionLabel}，请等待结果…` : action.message)}</p>}
    </section>}
    <section className="card" aria-label="数据地图承接事项" data-testid="data-map-handoff-work-items">
      <h2>数据地图承接事项</h2><p>按当前资格读取具体承接、冲突和定向事实。请进入原事项办理，返回后重新读取状态；此处不建立通用待办，也不通过“完成待办”代替审核、确认或发布。下方旧待办筛选只影响原待办清单。</p>
      {handoffState.busy?<StatusPanel kind="loading" title="正在读取承接事项…"/>:handoffState.error?<StatusPanel kind="error" title="承接事项暂不可用">{userMessage(handoffState.error)} 读取失败不表示没有事项。</StatusPanel>:handoffState.data.availability.state!=='available'?<p role="status">{{disabled:'承接功能尚未开启。',read_only:'当前承接仅供只读查阅。',not_prepared:'承接结构尚未准备。'}[handoffState.data.availability.state]||'承接事项当前不可办理。'}本页不据此判断全部承接已完成。</p>:handoffState.data.work_items.length?handoffState.data.work_items.map(row=>{
        const href=handoffTargetWithReturn(row.target,location.pathname+location.search);
        return <article className="import-record" key={row.id} data-handoff-work-item={row.id}><h3>{row.title}</h3><p>{row.nextStep||row.actionLabel}</p>{row.currentStatus&&<p>当前状态：{handoffStateName(row.currentStatus)}</p>}{href?<a href={href} onClick={onNavigate}>{row.actionLabel||'进入准确事项办理'}</a>:<p role="status">未提供可准确定位的入口，请刷新核对。</p>}</article>;
      }):<p role="status">当前身份没有可办理的承接事项。</p>}
    </section>
    {state.busy ? <StatusPanel kind="loading" title="正在读取待办…" /> : state.error ? <StatusPanel kind="error" title={state.error.status === 403 ? '无权查看待办' : '待办暂不可用'}>{userMessage(state.error)} 读取失败不表示没有待办。</StatusPanel> : <section className="card">
      <h2>原部门待办清单（{state.rows.length}）</h2>
      {!state.rows.length ? <p role="status">当前可见范围和筛选条件下暂无待办。</p> : <div className="identity-table" tabIndex={0} aria-label="待办清单"><table style={{ tableLayout: 'fixed' }}>
        <thead><tr><th>来源部门</th><th>接收部门</th><th>类型与紧急程度</th><th style={{ width: '32%' }}>内容与关联编号</th><th>截止日期</th><th>状态</th></tr></thead>
        <tbody>{state.rows.map(row => <tr key={row.id} data-todo-id={row.id}>
          <td>{row.from_dept_name || '未记录'}</td><td>{row.to_dept_name || '未记录'}</td>
          <td>{types[row.type] || row.type || '未记录'}<br/>{({ high: '高', medium: '中', low: '低' })[row.urgency] || row.urgency || '未记录'}</td>
          <td style={{ overflowWrap: 'anywhere' }}><div style={{ whiteSpace: 'pre-wrap' }}>{row.content || '未记录内容'}</div><small>待办内容：{row.title||row.content||'原记录未提供内容'}</small>
            {relatedWork(row) ? <div><a href={relatedWork(row).path} aria-label={relatedWork(row).label} onClick={event => onNavigate(event, relatedWork(row).path)}>{relatedWork(row).label}</a><p className="muted">{relatedWork(row).note}</p></div>
              : row.related_mapping_id ? <p className="muted">原映射办理入口已退役。保留关联编号供核对，本页不提供原映射办理，也不以直接完成待办替代。</p> : null}
          </td>
          <td>{dueDate(row.due_date)}</td><td>{statuses[row.status] || row.status || '未记录'}{canComplete(row) && <div><button className="secondary" disabled={Boolean(action) && action.phase !== 'success'} aria-label={'完成待办：'+businessText(row.title||row.description||'所选事项')} onClick={() => setAction({ row, kind: 'complete', phase: 'confirm' })}>完成</button></div>}{canDelete && <div><button className="secondary" disabled={Boolean(action) && action.phase !== 'success'} aria-label={'删除待办：'+businessText(row.title||row.description||'所选事项')} onClick={() => setAction({ row, kind: 'delete', phase: 'confirm' })}>删除</button></div>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>}
  </div>;
}
