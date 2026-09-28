import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './role-workbench.css';

// Keep complete legacy targets, including item/version identifiers. No inferred routing.
function targetHref(target) {
  if (typeof target !== 'string' || /[\\\s]/.test(target)) return null;
  if (/^#\/[A-Za-z][A-Za-z0-9]*(?:\?[^#]*)?$/.test(target)) return '/' + target;
  if (/^\/app\/analysis#run=[1-9][0-9]*&finding=[1-9][0-9]*$/.test(target)) return target;
  if (/^[A-Za-z][A-Za-z0-9]*$/.test(target)) return '/#/' + target;
  return null;
}
function Entry({ target, children, onNavigate }) {
  const href = targetHref(target);
  return href ? <a href={href} onClick={onNavigate}>{children || '进入办理'}</a> : <span className="muted">暂无可用办理入口</span>;
}
function sourceRoles(item, roles) {
  const codes = item.sourceRoles?.length ? item.sourceRoles : [item.roleCode || item.roleHint].filter(Boolean);
  return codes.map(code => roles.find(role => role.code === code)?.name || code).join('、') || '按当前授权范围查看';
}
let chartAsset;
export function loadChart() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (!chartAsset) chartAsset = new Promise((resolve, reject) => {
    const script = document.createElement('script'); script.src = '/echarts.min.js';
    script.onload = () => window.echarts ? resolve(window.echarts) : reject(new Error('图形资源不可用。'));
    script.onerror = () => { script.remove(); reject(new Error('图形资源加载失败。')); };
    document.head.appendChild(script);
  }).catch(error => { chartAsset = null; throw error; });
  return chartAsset;
}
function ResponsibilityGraph({ data, onNavigate }) {
  const canvas = useRef(null), detail = useRef(null);
  const [selected, setSelected] = useState(null), [error, setError] = useState(null), [retry, setRetry] = useState(0);
  const nodes = data.sankey?.nodes || [], links = data.sankey?.links || [];
  const populated = nodes.length > 0 && links.length > 0;
  function select(node) { setSelected(node); requestAnimationFrame(() => detail.current?.focus()); }
  useEffect(() => {
    let active = true, chart, observer; setSelected(null); setError(null);
    if (populated) loadChart().then(echarts => {
      if (!active) return;
      chart = echarts.init(canvas.current);
      const byId = new Map(nodes.map(node => [node.id || node.name, node]));
      chart.setOption({ animation: false, tooltip: { renderMode: 'richText', formatter: p => p.dataType === 'edge' ? `${byId.get(p.data.source)?.label || ''} → ${byId.get(p.data.target)?.label || ''}` : byId.get(p.name)?.label || p.name }, series: [{
        type: 'sankey', left: 20, right: 140, nodeWidth: 14, nodeGap: 18, draggable: false,
        data: nodes.map(node => ({ name: node.id || node.name })), links,
        label: { width: 120, overflow: 'truncate', formatter: p => byId.get(p.name)?.label || p.name },
        lineStyle: { color: 'gradient', opacity: 0.4 }, emphasis: { focus: 'adjacency' }
      }] });
      chart.on('click', p => { if (p.dataType === 'node') select(byId.get(p.name)); });
      observer = new ResizeObserver(() => chart.resize()); observer.observe(canvas.current);
    }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; observer?.disconnect(); chart?.dispose(); };
  }, [data, retry]);
  return <section className="card"><h2>职责链路</h2><p className="muted">角色 → 业务能力 → L3流程 → A1业务行为 → 处理入口</p>
    {!populated ? <StatusPanel title="暂无职责链路数据。">当前接口未提供完整关系。可从待办或角色说明进入办理。</StatusPanel> : <>
      <div className="wb-chart-scroll"><div className="wb-chart" ref={canvas} role="img" aria-label="职责链路图；可用下方节点按钮查看详情" /></div>
      {error && <StatusPanel kind="error" title="职责图暂不可用" onRetry={() => setRetry(v => v + 1)}>{error.message}</StatusPanel>}
      <div className="import-actions" aria-label="职责节点">{nodes.map(node => <button className="secondary" key={node.id || node.name} onClick={() => select(node)}>{node.label}</button>)}</div>
      <div ref={detail} tabIndex={-1} className="wb-node-detail">{selected ? <><h3>{selected.label}</h3><p>{selected.sample || '此节点未提供典型样例。'}</p><Entry target={selected.target} onNavigate={onNavigate}>进入处理入口</Entry><ul>{(data.workItems || []).filter(item => selected.target && item.target === selected.target).map((item, index) => <li key={index}>{item.title}</li>)}</ul></> : <p>请选择节点查看关联事项、样例和办理入口。</p>}</div>
    </>}
  </section>;
}
function Activity({ api, refreshKey }) {
  const [state, setState] = useState({ busy: true }), [retry, setRetry] = useState(0), [selected, setSelected] = useState(null);
  useEffect(() => {
    const controller = new AbortController(); setState({ busy: true }); setSelected(null);
    api.request('/api/activity/heatmap?scope=me&days=90', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ data });
    }).catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, refreshKey, retry]);
  return <section className="card" data-activity-ready={Boolean(state.data)}><h2>我的治理活动</h2>
    {state.busy ? <StatusPanel kind="loading" title="正在读取治理活动…" /> : state.error ? <><StatusPanel kind="error" title="治理活动暂不可用">{state.error.message}</StatusPanel><button className="secondary" onClick={() => setRetry(v => v + 1)}>重试读取治理活动</button></> : <>
      <p>近 90 天 {state.data?.summary?.totalActions ?? '待核对'} 次有效治理动作</p>
      <div className="wb-activity-days">{(state.data?.dates || []).map(day => <button type="button" key={day.date} className={`wb-day wb-level-${day.count >= 6 ? 3 : day.count >= 3 ? 2 : day.count > 0 ? 1 : 0}`} aria-label={`${day.date}，${day.count} 次有效治理动作`} aria-pressed={selected?.date === day.date} title={`${day.date} · ${day.count} 次`} onClick={() => setSelected(day)} />)}</div>
      <p aria-live="polite">{selected ? `${selected.date}：${selected.count} 次有效治理动作；${Object.entries(selected.sources || {}).filter(([, count]) => count > 0).map(([key, count]) => `${selected.sourceLabels?.[key] || key} ${count}`).join('；') || '无有效治理动作'}` : '点击日期查看当天动作摘要。'}</p>
    </>}
  </section>;
}
export function RoleWorkbench({ api, onNavigate }) {
  const [mode, setMode] = useState('todo'), [refreshKey, setRefreshKey] = useState(0), [state, setState] = useState({ busy: true });
  function refresh() { setState({ busy: true }); setRefreshKey(v => v + 1); }
  useEffect(() => {
    const controller = new AbortController(); setState({ busy: true });
    api.request('/api/role-workbench?mode=' + mode, { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ data, mode });
    }).catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, mode, refreshKey]);
  // Never expose data from the previous mode while a replacement request starts.
  const data = state.mode === mode ? state.data : null, roles = data?.roles || [];
  const count = Number.isSafeInteger(data?.summary?.actionableCount) ? data.summary.actionableCount : null;
  return <div className="role-workbench" data-ready={Boolean(data)}>
    <section className="card welcome"><h2>我现在该做什么</h2>
      <p>先处理当前待办，再按需要查看完整职责。办理结果以对应业务页面为准。</p>
      <div className="wb-summary"><span>当前身份：{data ? roles.filter(role => role.owned).map(role => role.name).join(' / ') || '暂无有效工作角色' : '正在核对'}</span><span>当前部门：{data?.user?.departmentName || '待核对'}</span><strong data-workbench-count>我的待处理：{count === null ? '暂不可用' : `${count} 项`}</strong></div>
      <div className="import-actions wb-toolbar" aria-label="工作台视角"><button className="secondary" aria-pressed={mode === 'todo'} onClick={() => setMode('todo')}>待办优先</button><button className="secondary" aria-pressed={mode === 'all'} onClick={() => setMode('all')}>全量职责</button><button className="secondary" onClick={refresh}>刷新工作台</button><Entry target="#/roleWorkbench" onNavigate={onNavigate}>查看原工作台</Entry></div>
      {state.busy || !data && !state.error ? <StatusPanel kind="loading" title="正在读取工作台…" /> : state.error ? <><StatusPanel kind="error" title="工作台待办暂不可用">{state.error.message} 当前不能据此判断没有待办。</StatusPanel><button className="secondary" onClick={refresh}>重试读取待办</button></> : <>
        {count === 0 && <p>当前没有待处理事项。以下为角色办理指引，不计入待办数量。</p>}
        <div data-next-actions className="wb-actions">{(data.nextActions || []).slice(0, 3).map((action, index) => <article className="import-record" data-next-action key={index}><h3>{index + 1}. {action.title}</h3><p className="muted">来源角色：{sourceRoles(action, roles)}</p>{action.sample && <p>样例：{action.sample}</p>}<Entry target={action.target} onNavigate={onNavigate}>{action.actionLabel}</Entry></article>)}</div>
        {!data.nextActions?.length && <StatusPanel title="暂无下一步动作">请查看角色说明，或联系账号管理人员核对授权。</StatusPanel>}
      </>}
    </section>
    <Activity api={api} refreshKey={refreshKey} />
    {data && mode === 'all' && <>
      <section className="card"><h2>当前事项与办理指引</h2>{(data.workItems || []).map((item, index) => <article className="import-record" key={`${item.type}:${item.id}:${index}`}><h3>{item.title}</h3><p>来源角色：{sourceRoles(item, roles)}</p><p>责任部门：{item.department || '待明确'}；办理人：{item.responsiblePerson || '待明确'}</p><p>下一步：{item.nextStep || item.actionLabel || '请核对事项'}</p>{item.sample && <p>样例：{item.sample}</p>}<Entry target={item.target} onNavigate={onNavigate}>{item.actionLabel}</Entry></article>)}{!data.workItems?.length && <StatusPanel title="暂无事项或指引" />}</section>
      <ResponsibilityGraph data={data} onNavigate={onNavigate} />
      <section className="card"><h2>角色使用说明</h2>{roles.map(role => <details key={role.code} data-role-guide open={role.owned}><summary>{role.name} · {role.owned ? '我的角色' : '角色说明，未授权'}</summary><dl className="source-values"><div><dt>角色目标</dt><dd>{role.goal}</dd></div><div><dt>第一步入口</dt><dd>{role.owned ? <Entry target={role.firstEntry?.target} onNavigate={onNavigate}>{role.firstEntry?.label}</Entry> : role.firstEntry?.label}</dd></div><div><dt>典型样例</dt><dd>{role.sample}</dd></div><div><dt>常见误区</dt><dd>{role.pitfall}</dd></div><div><dt>完成标准</dt><dd>{role.doneCriteria}</dd></div></dl><p>处理顺序：{(role.workflow || []).join(' → ')}</p></details>)}</section>
    </>}
  </div>;
}
