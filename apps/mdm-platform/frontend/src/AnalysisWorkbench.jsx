import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel, useInputProtection } from './components.jsx';
import { statuses, types, stages, labelSource, filterFindings, createPayload, filteredExport } from './analysisView.js';

import { FindingReview } from './FindingReview.jsx';
const root = '/api/analysis';
const readRoute = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const initialRoute = () => ({ run: '', finding: '', evidence: '', compare: '', q: '', type: '', input: '', history: '', ...readRoute() });
const text = v => typeof v === 'string' ? v : JSON.stringify(v, null, 2);
const pending = r => ['queued', 'running'].includes(r?.status);
const uuid = () => crypto.randomUUID();

// A small explicit directed layout. No inferred business edges or external assets.
function DirectedGraph({ nodes, name }) {
  const [zoom, setZoom] = useState(1);
  const marker = React.useId().replace(/:/g, '');
  if (!nodes.length) return <p>当前范围没有可绘制的连接。</p>;
  const height = nodes.length * 130;
  return <section className="analysis-graph" aria-label={name}>
    <div className="import-actions"><strong>{name}</strong><button className="secondary" onClick={() => setZoom(z => Math.max(.75, z - .25))} aria-label="缩小图形">−</button><output>{Math.round(zoom * 100)}%</output><button className="secondary" onClick={() => setZoom(z => Math.min(2, z + .25))} aria-label="放大图形">＋</button><button className="secondary" onClick={() => setZoom(1)}>重置缩放</button></div>
    <div className="analysis-graph-scroll"><svg role="img" aria-label={name} viewBox={`0 0 360 ${height}`} style={{ width: `${zoom * 100}%`, maxWidth: 360 * zoom, height: 'auto' }}>
      <defs><marker id={marker} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#416b87" /></marker></defs>
      {nodes.map((n, i) => <g key={i}><title>{n}</title>{i > 0 && <path data-graph-edge="true" d={`M 180 ${i * 130 - 35} L 180 ${i * 130 + 6}`} stroke="#416b87" strokeWidth="2" markerEnd={`url(#${marker})`} />}
        <rect data-graph-node="true" x="20" y={i * 130 + 10} width="320" height="85" rx="10" fill="#edf4f8" stroke="#416b87" />
        {[...n].reduce((lines, c, j) => { if (j < 44) { if (j % 22 === 0) lines.push(''); lines[lines.length - 1] += c; } return lines; }, []).map((line, j) => <text key={j} x="180" y={i * 130 + 43 + j * 23} textAnchor="middle" fontSize="14">{line}{j === 1 && [...n].length > 44 ? '…' : ''}</text>)}</g>)}
    </svg></div><ol className="muted">{nodes.map((n, i) => <li key={i}>{n}</li>)}</ol>
  </section>;
}

function FixedEvidence({ value }) {
  const s = value.fixed_reference, doc = value.excerpt;
  const endpoint = (e, side) => <div className="definition-group"><h4>{side}</h4>{e ? <><p>{e.process_name || '流程名称未登记'} · 行为 {e.behavior_ref || '未登记'}</p><p>对象 {e.object_name || e.object_id} · 固定版本 {e.object_version_id}</p>
    {e.object_version_id && <a href={'/api/data-map-definitions/version/' + encodeURIComponent(e.object_version_id)} target="_blank" rel="noreferrer">查看对象固定版本与字段依据 ↗</a>}</> : <p>此端未登记，不能据此认定业务不存在。</p>}</div>;
  return <section className="card" aria-label="证据内容"><h3>固定来源证据</h3><p>{labelSource(s)} · 摘要 {s.content_digest}</p><p>定位：{value.locator_kind} · {value.locator || '文档根'}</p><p>{value.note}</p>
    {value.extraction_status === 'declared_anchor_only' ? <StatusPanel title="只有声明的原文位置，尚未提取原文">当前缺少已核对的原文证据；不能据此断言原文未说明。</StatusPanel> : <>
      <p>已解析固定快照位置。快照中的空值或缺项不等于原制度或表单未说明。</p>
      {s.kind === 'handoff' && doc && Object.hasOwn(doc, 'pairs') && <>
        <DirectedGraph name="已登记的交接两端（不代表实际贯通）" nodes={[doc.source ? `${doc.source.process_name} / 对象 ${doc.source.object_name || doc.source.object_id}` : '来源端未登记', doc.target ? `${doc.target.process_name} / 对象 ${doc.target.object_name || doc.target.object_id}` : '目标端未登记']} />
        <div className="handoff-endpoints">{endpoint(doc.source, '来源端')}{endpoint(doc.target, '目标端')}</div>
        <h4>固定字段对应</h4>{doc.pairs.length ? doc.pairs.map((p, i) => <p key={i}>{p.source.name} → {p.target.name} · <a href={'/api/data-map-definitions/version/' + encodeURIComponent(p.source.field_version_id)} target="_blank" rel="noreferrer">来源字段版本 {p.source.field_version_id}</a> · <a href={'/api/data-map-definitions/version/' + encodeURIComponent(p.target.field_version_id)} target="_blank" rel="noreferrer">目标字段版本 {p.target.field_version_id}</a></p>) : <p>尚未登记字段对应。</p>}
        <p>交付条件：{doc.delivery_condition || '待补'}；接收要求：{doc.reception_requirement || '待补'}</p>
        <h4>两端原文定位（材料声明）</h4>{doc.evidence.map((e, i) => <p key={i}>{e.side === 'source' ? '来源' : '目标'}：{e.locator} · {e.note}</p>)}
      </>}
      <details open><summary>定位摘录及对象、字段原值</summary><pre className="analysis-json">{text(doc)}</pre></details>
    </>}
  </section>;
}

export function AnalysisWorkbench({ api, draft, setDraft }) {
  const guard = useInputProtection();
  const [route, setRoute] = useState(initialRoute), [cap, setCap] = useState(null), [sources, setSources] = useState([]), [sourceKind, setSourceKind] = useState(draft?.kind || 'v7_source');
  const [records, setRecords] = useState([]), [detail, setDetail] = useState(null), [findings, setFindings] = useState([]), [finding, setFinding] = useState(null), [evidence, setEvidence] = useState(null), [diff, setDiff] = useState(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(null), [notice, setNotice] = useState(''), [tick, setTick] = useState(0);
  const active = useRef(null), sequence = useRef(0), scroll = useRef(0), focus = useRef(null), operation = useRef(false), cancelRequest = useRef(null), returnFocus = useRef(null);
  useEffect(() => () => { active.current?.abort(); sequence.current++; }, []);
  function changeRoute(patch) {
    const next = { ...route, ...patch }; const params = new URLSearchParams(Object.entries(next).filter(([, v]) => v));
    window.history.replaceState(window.history.state, '', window.location.pathname + (params.size ? '#' + params : '')); setRoute(next);
  }
  useEffect(() => { const handler = () => setRoute(initialRoute()); window.addEventListener('hashchange', handler); return () => window.removeEventListener('hashchange', handler); }, []);
  async function pages(url, signal) {
    const items = []; let offset = 0;
    do { const result = await api.request(url + (url.includes('?') ? '&' : '?') + 'limit=100&offset=' + offset, { signal }); items.push(...result.items); offset = result.next_offset; } while (offset !== null);
    return items;
  }
  useEffect(() => {
    const controller = new AbortController(), id = ++sequence.current; active.current?.abort(); active.current = controller;
    setBusy(true); setError(null); setDetail(null); setFindings([]); setFinding(null); setEvidence(null); setDiff(null); setSources([]); setRecords([]); setCap(null);
    (async () => {
      const capability = await api.request(root + '/capabilities', { signal: controller.signal });
      const [runs, inputs] = await Promise.all([pages(root + '/runs', controller.signal), pages(root + '/sources?kind=' + sourceKind, controller.signal)]);
      let d = null, f = [], selected = null, e = null, comparison = null;
      if (route.run) {
        d = await api.request(root + '/runs/' + encodeURIComponent(route.run), { signal: controller.signal });
        f = await pages(root + '/runs/' + encodeURIComponent(route.run) + '/findings', controller.signal);
        if (route.finding) selected = await api.request(root + '/runs/' + encodeURIComponent(route.run) + '/findings/' + encodeURIComponent(route.finding), { signal: controller.signal });
        if (route.evidence) {
          if (!selected?.evidence_ids.includes(route.evidence)) throw new Error('证据不属于当前发现，请返回发现列表。');
          e = await api.request(root + '/runs/' + encodeURIComponent(route.run) + '/evidence/' + encodeURIComponent(route.evidence), { signal: controller.signal });
        }
        if (route.compare) comparison = await api.request(root + '/runs/' + encodeURIComponent(route.compare) + '/diff/' + encodeURIComponent(route.run), { signal: controller.signal });
      }
      if (id !== sequence.current || controller.signal.aborted) return;
      setCap(capability); setSources(inputs); setRecords(runs); setDetail(d); setFindings(f); setFinding(selected); setEvidence(e); setDiff(comparison);
    })().catch(e => { if (!controller.signal.aborted && id === sequence.current) setError(e); }).finally(() => { if (!controller.signal.aborted && id === sequence.current) setBusy(false); });
    return () => controller.abort();
  }, [api, sourceKind, route.run, route.finding, route.evidence, route.compare, tick]);
  useEffect(() => { if (!pending(detail) || busy || draft?.dirty) return; const timer = setTimeout(() => setTick(t => t + 1), 2500); return () => clearTimeout(timer); }, [detail, busy, draft?.dirty]);
  useEffect(() => { if (!busy && route.finding) focus.current?.focus(); }, [busy, route.finding, route.evidence]);
  useEffect(() => {
    if (!busy && !route.finding && !finding && detail && returnFocus.current) {
      window.scrollTo(0, scroll.current);
      document.querySelector(`[data-finding="${returnFocus.current}"]`)?.focus({ preventScroll: true });
      returnFocus.current = null;
    }
  }, [busy, route.finding, finding, detail]);
  const d = draft || { kind: sourceKind, ref: '', description: '', dirty: false, requestId: uuid() };
  function edit(key, value) { setDraft({ ...d, [key]: value, dirty: true, requestId: uuid() }); }
  async function act(fn) {
    if (operation.current || busy) return; operation.current = true; setBusy(true); setError(null); setNotice('');
    const controller = new AbortController(); active.current?.abort(); active.current = controller;
    try { await fn(controller.signal); } catch (e) { if (!controller.signal.aborted) setError(e); }
    finally { operation.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  function chooseRun(run) {
    if (!guard.confirmLeave()) return;
    setDraft(null); cancelRequest.current = null; changeRoute({ run, finding: '', evidence: '', compare: '', input: '' });
  }
  async function create(event) {
    event.preventDefault();
    if (!d.ref || !d.description.trim()) { setError(new Error('请选择固定来源并填写本轮范围说明。')); document.getElementById(!d.ref ? 'analysis-source' : 'analysis-description')?.focus(); return; }
    const adapter = cap.adapters.find(a => a.kind === sourceKind);
    await act(async signal => {
      const result = await api.request(root + '/runs', { method: 'POST', body: createPayload(adapter, d.ref, d.description.trim(), d.requestId), signal });
      if (signal.aborted) return; setDraft(null); changeRoute({ run: result.run_id, finding: '', evidence: '', compare: '', input: '', q: '', type: '' }); setTick(t => t + 1);
    });
  }
  async function exportCurrent() {
    await act(async signal => {
      const fresh = await api.request(root + '/runs/' + route.run + '/export', { signal });
      if (signal.aborted) return;
      const data = filteredExport(fresh, route), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `analysis-${route.run}-view.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出当前范围 ${data.findings.length} 条发现及其证据定位，不含原文摘录。`);
    });
  }
  const visible = detail ? filterFindings(findings, detail, route) : [], base = detail ? filterFindings(findings, detail, { history: route.history }) : [];
  const checkName = id => cap?.adapters.flatMap(a => a.catalog).find(r => r.rule_id === id)?.title || id;
  const coverageView = rows => <ul>{rows.map((c, i) => <li key={i}>{c.step_key}：已检查 {c.checked?.length || 0} / {c.expected?.length || 0} 项{c.missing?.length ? `；未覆盖：${c.missing.map(checkName).join('、')}` : '；本步骤无登记覆盖缺口'}</li>)}</ul>;
  function back() { if ((draft?.review || draft?.task) && !guard.confirmLeave()) return; if (draft?.review || draft?.task) setDraft({ ...draft, review: null, task: null, dirty: (draft.task || draft.review).baseDirty }); returnFocus.current = route.finding; changeRoute({ finding: '', evidence: '' }); }
  return <div className="analysis-workbench">
    <StatusPanel title="按当前身份获准范围检查固定材料">确定性分析结果初始为待核实；有权人员核对后可明确关联现有问题或创建问题，不自动生成待办。主链框架和完整输入尚未确认，不能据局部结果宣称主链贯通。历史评审意见未导入本检查台。</StatusPanel>
    {error && <StatusPanel kind="error" title="操作未完成，当前输入保留" onRetry={() => setTick(t => t + 1)}>{error.message} {error.code}</StatusPanel>}
    {notice && <StatusPanel title={notice} />}
    <section className="card"><h2>创建分析</h2><p>选择一个固定 V7 来源或设计交接版本。对象、字段和映射仍通过现有台账入口维护。</p>
      <form onSubmit={create}><fieldset disabled={busy || !cap?.can_create || !!draft?.review || !!draft?.task}>
        <label className="management-input">分析对象<select aria-label="分析对象" value={sourceKind} onChange={e => { if (!guard.confirmLeave()) return; setDraft(null); setSourceKind(e.target.value); }}><option value="v7_source">V7 固定材料</option><option value="handoff">固定设计交接</option></select></label>
        <label className="management-input">固定来源<select id="analysis-source" aria-label="固定来源" value={d.ref} onChange={e => edit('ref', e.target.value)}><option value="">请选择来源及版本</option>{sources.map(s => <option value={s.ref_id} key={s.ref_id}>{labelSource(s)} · {s.validation_status || '版本 ' + (s.revision_no || s.version_no || s.ref_id)}</option>)}{d.ref && !sources.some(s => s.ref_id === d.ref) && <option value={d.ref}>原选择 {d.ref}（待重新核对）</option>}</select></label>
        <label className="management-input">本轮范围说明<textarea id="analysis-description" aria-label="本轮范围说明" maxLength={1000} value={d.description} onChange={e => edit('description', e.target.value)} /></label>
        <button className="primary" type="submit">创建并排队分析</button>
      </fieldset></form>
      {!busy && cap && !cap.can_create && <p>当前身份只读，不能创建或取消分析。</p>}
      {!busy && !sources.length && <p>当前没有可选固定来源。请先在 V7 来源映射或设计交接入口登记有权访问的材料。</p>}
      {d.dirty && <p className="input-notice">本轮输入尚未提交；失败、查看详情和导出不会应用或清空输入。</p>}
      {cap && <details><summary>本轮确定性规则及未覆盖条件</summary>{cap.adapters.find(a => a.kind === sourceKind)?.catalog.map(r => <p key={r.rule_id}>{r.title}：{r.prerequisite}；{r.not_applicable}{r.enabled === false ? '（未启用）' : ''}</p>)}</details>}
    </section>
    <section className="card"><h2>分析记录</h2><div className="import-actions"><label>当前运行<select aria-label="当前运行" disabled={busy} value={route.run} onChange={e => chooseRun(e.target.value)}><option value="">请选择运行</option>{records.map(r => <option key={r.run_id} value={r.run_id}>运行 {r.run_id} · {statuses[r.status] || r.status} · {r.created_at}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => setTick(t => t + 1)}>刷新分析记录</button></div>{!busy && !records.length && <p>当前范围没有可见分析记录。</p>}</section>
    {busy && <StatusPanel kind="loading" title="正在读取或提交分析…">请稍候，输入仍保留。</StatusPanel>}
    {detail && <>
      <section className="card"><h2>运行 {detail.run_id} · {statuses[detail.status] || detail.status}</h2><p>当前范围：{detail.manifest.check_scope.description}</p><p>创建：{detail.created_at} · 开始：{detail.started_at || '尚未开始'} · 结束：{detail.finished_at || '尚未结束'}</p>
        <p>规则来源：{detail.manifest.rule_version} · AI：{detail.manifest.ai_metadata ? '本记录含 AI 配置，须结合步骤覆盖核对' : '未调用'} · 历史评审意见：未导入</p>
        <ul>{detail.manifest.inputs.map(i => <li key={i.input_key}>{i.input_key} · {labelSource(i.snapshot)}<details><summary>查看固定版本与摘要</summary><p>内容摘要：{i.snapshot.content_digest || '不可用（未解析）'}；原始字节摘要：{i.snapshot.raw_sha256 || '未提供'}</p><p>{text(i.snapshot.source_ref || { ref_id: i.snapshot.ref_id })}</p></details></li>)}</ul>
        <h3>步骤进度与完成覆盖</h3>{detail.manifest.steps.map(step => { const a = detail.attempts.filter(a => a.step_key === step.step_key).sort((a, b) => b.attempt_no - a.attempt_no)[0]; return <p key={step.step_key}>{step.step_key}：{a ? statuses[a.status] || a.status : '尚未开始'}{a?.error_code ? ' · 原因 ' + a.error_code : ''}</p>; })}
        {coverageView(detail.coverage)}<p>完成仅表示本轮已登记检查执行完毕；部分完成、失败或未覆盖不能当作已整改。</p>
        {pending(detail) && <p>每 2.5 秒刷新进度；有未提交输入时暂停自动刷新。排队中须等待独立分析工作进程。</p>}
        {pending(detail) && cap?.can_create && <button className="secondary" disabled={busy} onClick={() => act(async signal => { if (!cancelRequest.current || cancelRequest.current.run !== detail.run_id || cancelRequest.current.revision !== detail.revision_no) cancelRequest.current = { run: detail.run_id, revision: detail.revision_no, id: uuid() }; await api.request(root + '/runs/' + detail.run_id + '/cancel', { method: 'POST', signal, body: { request_id: cancelRequest.current.id, expected_revision: detail.revision_no } }); if (!signal.aborted) setTick(t => t + 1); })}>取消本次运行</button>}
      </section>
      <section className="card"><h2>发现检查台</h2><div className="analysis-filters"><label>搜索内容或对象字段标识<input aria-label="搜索发现" value={route.q} onChange={e => changeRoute({ q: e.target.value })} /></label><label>发现类别<select aria-label="发现类别" value={route.type} onChange={e => changeRoute({ type: e.target.value })}><option value="">全部类别</option>{Object.entries(types).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label><label>固定输入<select aria-label="固定输入筛选" value={route.input} onChange={e => changeRoute({ input: e.target.value })}><option value="">全部当前输入</option>{detail.manifest.inputs.map(i => <option value={i.input_key} key={i.input_key}>{i.input_key} · {stages[i.snapshot.kind] || stages[i.snapshot.source_kind]}</option>)}</select></label><label>步骤尝试<select aria-label="步骤尝试" value={route.history} onChange={e => changeRoute({ history: e.target.value })}><option value="">各步骤最后一次尝试</option><option value="all">包含历史尝试（非历史评审）</option></select></label></div>
        <p data-testid="analysis-count">匹配 {visible.length} / 当前范围 {base.length} 条发现</p><div className="import-actions"><button className="secondary" onClick={() => changeRoute({ q: '', type: '', input: '' })}>清除筛选</button><button className="secondary" disabled={busy} onClick={exportCurrent}>导出当前筛选范围</button></div>
        {!finding ? <><DirectedGraph name="当前筛选的分析路径（箭头不代表业务流转）" nodes={visible.length ? [`${detail.manifest.inputs.length} 个固定输入`, `规则 ${detail.manifest.rule_version}`, `${visible.length} 条规则发现`] : []} />
          {visible.map(f => <article className="analysis-finding" key={f.finding_id}><strong>{types[f.finding_type] || f.finding_type} · 规则发现</strong><p>{f.message}</p><p className="muted">{f.rule_id} · {f.semantic_locator} · 尝试 {f.attempt_id}</p><button className="secondary" data-finding={f.finding_id} disabled={busy} onClick={() => { scroll.current = window.scrollY; changeRoute({ finding: f.finding_id, evidence: '' }); }}>查看发现 {f.finding_id}</button></article>)}
          {!visible.length && <p>当前筛选没有发现，不代表业务已通过审核或旧问题已关闭。</p>}</> : <section aria-label="发现详情"><h3 ref={focus} tabIndex={-1}>发现 {finding.finding_id} · 原始规则发现</h3><button className="secondary" disabled={busy} onClick={back}>返回原筛选位置</button><p>{finding.message}</p><p>来源规则：{finding.rule_id} / {finding.rule_version} · {finding.step_key} / 尝试 {finding.attempt_id}</p><p>对象、字段或关系定位：{finding.semantic_locator}</p>
          {!finding.evidence_ids.length ? <StatusPanel title="缺少可核对证据">这表示当前发现没有证据引用，不表示原文未说明。</StatusPanel> : <div className="import-actions">{finding.evidence_ids.map((id, i) => <button className="secondary" key={id} disabled={busy} onClick={() => changeRoute({ evidence: id })}>查看证据 {i + 1}</button>)}</div>}
          {evidence && <FixedEvidence value={evidence} />}
          <FindingReview api={api} run={route.run} finding={finding} draft={draft} setDraft={setDraft} onNavigate={(run, next) => { if (!guard.confirmLeave()) return; setDraft(null); changeRoute({ run, finding: next, evidence: '' }); }} /></section>}
      </section>
      <section className="card"><h2>运行差异</h2><label className="management-input">以前次运行对比当前运行<select aria-label="对比运行" value={route.compare} disabled={busy} onChange={e => changeRoute({ compare: e.target.value })}><option value="">请选择对比运行</option>{records.filter(r => r.run_id !== route.run).map(r => <option key={r.run_id} value={r.run_id}>运行 {r.run_id} · {statuses[r.status]}</option>)}</select></label>
        {diff && <><p>{diff.comparison_complete ? '当前输入与检查范围可比' : '对照不完整，存在不可比较或待人工匹配范围'}；本轮未再检出不等于已整改。</p><pre className="analysis-json">{text({ reasons: diff.comparability_reasons, coverage: diff.coverage, counts: diff.counts })}</pre>{diff.rows.map((r, i) => <p key={i}><strong>{r.label}</strong>：{r.reason} · {r.match_key}</p>)}</>}
      </section>
    </>}
  </div>;
}
