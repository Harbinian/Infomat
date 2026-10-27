import {userMessage} from "./businessPresentation.js";
import {businessText} from './businessPresentation.js';
import {governanceCount,governanceLabel} from './governancePresentation.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { loadChart } from './RoleWorkbench.jsx';
import './dashboard.css';
import { chartTheme } from './presentation/chartTheme.js';
import {currentWorkbenchSnapshot} from './workbenchReviewPresentation.js';

const statusNames = { draft: '草稿', submitted: '已提交', dept_reviewed: '部门已审核', cross_confirmed: '跨部门已确认', fields_confirmed: '字段已确认', final_reviewed: '最终已审核', published: '已发布' };
const countOf = rows => {if(!Array.isArray(rows))throw new Error('字段清单未能完整读取，未将其统计为零。');return rows.length;};
function useRead(api, url, revision, transform = x => x) {
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    const controller = new AbortController(); setState({ busy: true });
    api.request(url, { signal: controller.signal }).then(async value => {
      const data = await transform(value, controller.signal);
      if (!controller.signal.aborted) setState({ data, url, revision });
    }).catch(error => { if (!controller.signal.aborted) setState({ error, url, revision }); });
    return () => controller.abort();
  }, [api, url, revision]);
  return state.url === url && state.revision === revision ? state : { busy: true };
}
function Metric({ name, code, state, value }) {
  return <article className="import-record"><h3>{name}</h3><strong className="dashboard-number" data-metric={code}>{governanceCount(state,value)}</strong>{state.error && <p role="alert">{userMessage(state.error)}</p>}</article>;
}
function Distribution({ rows }) {
  const bar = useRef(null), pie = useRef(null);
  const [error, setError] = useState(null), [retry, setRetry] = useState(0);
  const departments = {}, statuses = {};
  for (const row of rows) {
    const department = businessText(row.owner_dept_name || '未归属','部门名称待核对');
    const status = governanceLabel(row.status,statusNames);
    departments[department] = (departments[department] || 0) + 1;
    statuses[status] = (statuses[status] || 0) + 1;
  }
  useEffect(() => {
    if (!rows.length) return;
    let active = true, charts = [], observer;
    setError(null);
    loadChart().then(echarts => {
      if (!active) return;
      charts = [echarts.init(bar.current, chartTheme), echarts.init(pie.current, chartTheme)];
      charts[0].setOption({ tooltip: { trigger: 'axis', renderMode: 'richText' }, grid: { left: 45, right: 18, bottom: 85, top: 20 }, xAxis: { type: 'category', data: Object.keys(departments), axisLabel: { interval: 0, width: 80, overflow: 'truncate', rotate: 20 } }, yAxis: { type: 'value', minInterval: 1 }, series: [{ type: 'bar', data: Object.values(departments), itemStyle: { color: chartTheme.color[0] } }] });
      charts[1].setOption({ tooltip: { trigger: 'item', renderMode: 'richText' }, legend: { bottom: 0, type: 'scroll' }, series: [{ type: 'pie', radius: ['35%', '60%'], center: ['50%', '43%'], label: { show: false }, data: Object.entries(statuses).map(([name, value]) => ({ name, value })) }] });
      observer = new ResizeObserver(() => charts.forEach(chart => chart.resize()));
      observer.observe(bar.current); observer.observe(pie.current);
    }).catch(failure => { if (active) setError(failure); });
    return () => { active = false; observer?.disconnect(); charts.forEach(chart => chart.dispose()); };
  }, [rows, retry]);
  if (!rows.length) return <section className="card"><h2>流程映射分布</h2><p>暂无流程映射记录。</p></section>;
  return <section className="card"><h2>流程映射分布</h2><p className="muted">沿用原统计看板的流程映射记录，不代表全部正式流程版本。</p>
    {error && <><StatusPanel kind="error" title="图形暂不可用">下方完整明细仍可查阅。</StatusPanel><button className="secondary" onClick={() => setRetry(x => x + 1)}>重试图形</button></>}
    <div className="dashboard-columns">{[[departments, bar, '各部门流程数'], [statuses, pie, '审批状态分布']].map(([values, ref, title]) => <section key={title}><h3>{title}</h3><div className="dashboard-chart" data-dashboard-chart ref={ref} role="img" aria-label={title} /><ul className="dashboard-summary">{Object.entries(values).map(([name, count]) => <li key={name}><span>{name}</span><strong>{count} 条</strong></li>)}</ul></section>)}</div>
  </section>;
}
function Activity({ api, user }) {
  const managed = (user.permissions || []).some(p => ['governance:read-global', 'identity:read-audit'].includes(p));
  const initial = () => {
    const q = new URLSearchParams(window.location.search);
    return { scope: managed && ['all', 'team', 'me'].includes(q.get('scope')) ? q.get('scope') : managed ? 'all' : 'me', department: managed && /^\d+$/.test(q.get('department_id')) ? q.get('department_id') : '', person: managed && /^\d+$/.test(q.get('user_id')) ? q.get('user_id') : '' };
  };
  const [filters, setFilters] = useState(initial), [revision, setRevision] = useState(0), [selected, setSelected] = useState(null);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const catalog = useRead(api, '/api/activity/heatmap?scope=' + (managed ? 'all' : 'me') + '&days=180', catalogRevision);
  const params = new URLSearchParams({ scope: filters.scope, days: '180' });
  if (filters.department) params.set('department_id', filters.department);
  if (filters.person) params.set('user_id', filters.person);
  const state = useRead(api, '/api/activity/heatmap?' + params, revision);
  useEffect(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('scope', filters.scope);
    for (const [key, value] of [['department_id', filters.department], ['user_id', filters.person]]) {
      if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
    }
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
    setSelected(null);
  }, [filters]);
  function update(key, value) { setFilters(old => ({ ...old, [key]: value })); }
  const day = state.data?.dates?.find(item => item.date === selected);
  return <section className="card" data-dashboard-activity={state.busy ? 'loading' : state.error ? 'error' : 'ready'}><h2>人员参与热力</h2><p>近 180 天有效治理动作。筛选变更立即读取，仅影响本区域；数量统计仍按当前身份的数据范围展示。</p>
    <div className="dashboard-filters">
      <label>治理活跃范围<select aria-label="治理活跃范围" value={filters.scope} disabled={!managed} onChange={e => update('scope', e.target.value)}>{managed && <><option value="all">全部人员</option><option value="team">本部门</option></>}<option value="me">仅本人</option></select></label>
      {managed && [['department', '治理活跃部门', 'departments', 'departmentId'], ['person', '治理活跃人员', 'users', 'userId']].map(([key, label, collection, id]) => <label key={key}>{label}<select aria-label={label} value={filters[key]} onChange={e => update(key, e.target.value)}><option value="">全部{key === 'department' ? '部门' : '人员'}</option>{filters[key] && !(catalog.data?.[collection] || []).some(row => String(row[id]) === filters[key]) && <option value={filters[key]}>{key === 'department' ? '原部门' : '原人员'}当前没有可显示的活动记录，请重新核对</option>}{(catalog.data?.[collection] || []).map(row => <option key={row[id]} value={String(row[id])}>{row.name}</option>)}</select></label>)}
      <button className="secondary" onClick={() => { setRevision(x => x + 1); setCatalogRevision(x => x + 1); }}>刷新治理活动</button>
    </div>
    {managed && <p className="muted">部门和人员选项来自有权查阅的近 180 天活动记录；没有记录不代表不存在该部门或人员。</p>}
    {catalog.error && <StatusPanel kind="error" title="筛选选项暂不可用">当前选择保持不变。刷新治理活动可重试。</StatusPanel>}
    {state.busy ? <StatusPanel kind="loading" title="正在读取治理活动…" /> : state.error ? <StatusPanel kind="error" title="治理活动暂不可用">{userMessage(state.error)} 当前不能据此判断没有活动。</StatusPanel> : <>
      <p data-activity-total>{state.data.summary.totalActions} 次有效治理动作，{state.data.summary.activeDays} 个活跃日</p>
      {state.data.summary.totalActions === 0 && <p>当前筛选范围内暂无有效治理动作。</p>}
      <div className="wb-activity-days">{state.data.dates.map(item => <button type="button" data-dashboard-day key={item.date} className={`wb-day wb-level-${item.level}`} aria-label={`${item.date}，${item.count} 次有效治理动作`} title={`${item.date} · ${item.count} 次`} aria-pressed={item.date === selected} onClick={() => setSelected(item.date)} />)}</div>
      <p data-day-detail aria-live="polite">{day ? `${day.date}：${day.count} 次有效治理动作；${Object.entries(day.sources || {}).filter(([, count]) => count > 0).map(([key, count]) => `${businessText(day.sourceLabels?.[key] || '其他治理动作','治理动作名称待核对')} ${count}`).join('；') || '无有效治理动作'}` : '点击日期查看当天动作摘要。'}</p>
      <div className="dashboard-columns">{[['departments', '部门参与连续性'], ['users', '人员参与概览']].map(([key, label]) => <section key={key}><h3>{label}</h3>{!state.data[key].length && <p>暂无参与记录</p>}<ul className="dashboard-summary">{state.data[key].map(row => <li key={row.departmentId + ':' + (row.userId || '')}><span>{row.name}<small>{row.departmentName || ''} · {row.activeDays} 个活跃日</small></span><strong>{row.count} 次</strong></li>)}</ul></section>)}</div>
    </>}
  </section>;
}
export function Dashboard({ api, user, onNavigate }) {
  const [revision, setRevision] = useState(0);
  const mappings = useRead(api, '/api/mappings', revision);
  const todos = useRead(api, '/api/todos', revision);
  const currentWork = useRead(api, '/api/role-workbench?mode=todo', revision, currentWorkbenchSnapshot);
  const conflicts = useRead(api, '/api/conflicts', revision);
  const stats = useRead(api, '/api/conflicts/stats', revision);
  const fields = useRead(api, '/api/data-map/contexts?view=current', revision, async (contexts, signal) => {
    if(!Array.isArray(contexts))throw new Error('数据使用范围未能完整读取，未将字段统计为零。');
    const results = await Promise.allSettled(contexts.map(row => api.request('/api/field-entries/mapping/' + encodeURIComponent(row.id) + '?view=current', { signal })));
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length) throw failed[0].reason;
    return results.reduce((sum, result) => sum + countOf(result.value), 0);
  });
  const all = [mappings, todos, conflicts, stats, fields, currentWork];
  return <div className="dashboard" data-dashboard-ready={!all.some(state => state.busy)}>
    <section className="card"><h2>治理活跃与统计</h2><p>查看当前身份可访问的记录数量、冲突情况和人员参与情况。统计结果不代表审核通过或业务验收。</p><p><strong data-current-work-count>本人当前办理事项：{governanceCount(currentWork,currentWork.data?.count)}{currentWork.data?'项':''}</strong>。与“我的工作台”和“收到的待办”中的当前事项使用同一口径，包含本人当前有权办理的流程、治理、办公室及数据地图承接事项。</p>{currentWork.error&&<p role="alert">{userMessage(currentWork.error)} 当前不能据此判断没有事项。</p>}<p className="muted">下方“原部门待办”沿用原待办记录，可能同时含有办公室承接任务，不能与本人当前办理事项相加。</p><div className="import-actions"><button className="secondary" onClick={() => setRevision(x => x + 1)}>刷新统计</button><a href="/app/workbench" onClick={onNavigate}>前往我的工作台</a><a href="/app/todos" onClick={onNavigate}>查看本人当前办理事项</a></div></section>
    <div className="dashboard-metrics">
      <Metric code="mappings" name="流程映射" state={mappings} value={mappings.data?.length} />
      <Metric code="fields" name="字段台账" state={fields} value={fields.data} />
      <Metric code="todos" name="原部门待办（待处理）" state={todos} value={todos.data?.filter(row => row.status === 'pending').length} />
      <Metric code="conflicts" name="未解决冲突" state={conflicts} value={conflicts.data?.filter(row => ['pending', 'coordinating'].includes(row.status)).length} />
    </div>
    {all.some(state => state.error) && <StatusPanel title="当前仅展示已成功读取的统计">“暂不可用”不表示数量为零。请刷新统计重试；是否可查阅仍按当前身份核对。</StatusPanel>}
    <section className="card"><h2>冲突概览</h2>{stats.busy ? <StatusPanel kind="loading" title="正在读取冲突概览…" /> : stats.error ? <StatusPanel kind="error" title="冲突概览暂不可用">{userMessage(stats.error)}</StatusPanel> : <ul className="dashboard-summary">{[['coordinating', '待协调'], ['escalated', '已升级'], ['silenced', '静默'], ['resolvedThisMonth', '本月已解决']].map(([key, label]) => <li key={key}><span>{label}</span><strong>{stats.data[key] ?? 0} 条</strong></li>)}</ul>}<a href="/app/conflicts" onClick={onNavigate}>查看冲突</a> · <a href="/app/todos" onClick={onNavigate}>查看待办</a></section>
    <Activity api={api} user={user} />
    {mappings.data && <Distribution rows={mappings.data} />}
  </div>;
}
