import {userMessage} from './businessPresentation.js';
import {BusinessDetails,BusinessDocumentLink} from "./BusinessDetails.jsx";
import {businessLocation,businessName,businessStatus,businessText} from "./businessPresentation.js";
import { businessDateTime } from './businessGuidance.js';
import { analysisRulePresentation } from './analysisPresentation.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel, useInputProtection } from './components.jsx';
import { statuses, types, stages, labelSource, filterFindings, createPayload, filteredExport } from './analysisView.js';

import { FindingReview } from './FindingReview.jsx';
import { ExcelEvidence } from './ExcelEvidence.jsx';
import { WordEvidence } from './WordEvidence.jsx';
import { PdfEvidence } from './PdfEvidence.jsx';
const root = '/api/analysis';
const readRoute = () => Object.fromEntries(new URLSearchParams(window.location.hash.slice(1)));
const initialRoute = () => ({ run: '', finding: '', evidence: '', compare: '', q: '', type: '', input: '', history: '', ...readRoute() });
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

function FixedEvidence({ value,api }) {
  const s = value.fixed_reference, doc = value.excerpt;
  const endpoint = (e, side) => <div className="definition-group"><h4>{side}</h4>{e ? <><p>{e.process_name || '流程名称未登记'} · 行为 {e.behavior_name || '环节名称未记录'}</p><p>对象 {e.object_name || '对象名称未记录'}</p>
    {e.object_version_id && <BusinessDocumentLink api={api} path={'/api/data-map-definitions/version/' + encodeURIComponent(e.object_version_id)}>查看对象固定版本与字段依据 ↗</BusinessDocumentLink>}</> : <p>此端未登记，不能据此认定业务不存在。</p>}</div>;
  return <section className="card" aria-label="证据内容"><h3>固定来源证据</h3><p>{labelSource(s)}</p><p>定位：{businessLocation(value.locator)}</p><p>{value.note}</p>
    {value.extraction_status === 'declared_anchor_only' ? <StatusPanel title="只有声明的原文位置，尚未提取原文">当前缺少已核对的原文证据；不能据此断言原文未说明。</StatusPanel> : <>
      <p>已解析固定快照位置。快照中的空值或缺项不等于原制度或表单未说明。</p>
      {s.source_kind === 'excel_material' && <p><a href={'/app/analysis#excel='+encodeURIComponent(s.ref_id)}>浏览该 Excel 固定证据的全部单元格</a>{doc?.sheet_name ? ` · 原位置 ${doc.sheet_name}!${doc.cell_address}` : ''}</p>}
      {s.source_kind === 'word_material' && <p><a href={'/app/analysis#word='+encodeURIComponent(s.ref_id)+(doc?.anchor_id?'&wordAnchor='+encodeURIComponent(doc.anchor_id):'')}>浏览该 DOCX 固定证据的正文结构</a>；未渲染，不提供页码。</p>}
      {s.source_kind === 'pdf_material' && <p><a href={'/app/analysis#pdf='+encodeURIComponent(s.ref_id)+(doc?.anchor_id?'&pdfAnchor='+encodeURIComponent(doc.anchor_id):'')}>浏览该 PDF 固定证据的文本位置</a>{doc?.page ? ' · 第 '+doc.page+' 页' : ''}；物理页序号，未执行 OCR。</p>}
      {s.kind === 'handoff' && doc && Object.hasOwn(doc, 'pairs') && <>
        <DirectedGraph name="已登记的交接两端（不代表实际贯通）" nodes={[doc.source ? `${doc.source.process_name} / 对象 ${doc.source.object_name || '对象名称未记录'}` : '来源端未登记', doc.target ? `${doc.target.process_name} / 对象 ${doc.target.object_name || '对象名称未记录'}` : '目标端未登记']} />
        <div className="handoff-endpoints">{endpoint(doc.source, '来源端')}{endpoint(doc.target, '目标端')}</div>
        <h4>固定字段对应</h4>{doc.pairs.length ? doc.pairs.map((p, i) => <p key={i}>{p.source.name} → {p.target.name} · <BusinessDocumentLink api={api} path={'/api/data-map-definitions/version/' + encodeURIComponent(p.source.field_version_id)}>来源字段版本 {businessName(p.source)}</BusinessDocumentLink> · <BusinessDocumentLink api={api} path={'/api/data-map-definitions/version/' + encodeURIComponent(p.target.field_version_id)}>目标字段版本 {businessName(p.target)}</BusinessDocumentLink></p>) : <p>尚未登记字段对应。</p>}
        <p>交付条件：{doc.delivery_condition || '待补'}；接收要求：{doc.reception_requirement || '待补'}</p>
        <h4>两端原文定位（材料声明）</h4>{doc.evidence.map((e, i) => <p key={i}>{e.side === 'source' ? '来源' : '目标'}：{businessText(e.locator,'原文位置暂未提供可读说明')} · {e.note}</p>)}
      </>}
      <details open><summary>定位摘录及对象、字段原值</summary><BusinessDetails value={doc}/></details>
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
      const [runs, inputs] = await Promise.all([pages(root + '/runs', controller.signal), pages(root + '/sources?kind=' + (sourceKind==='ai_offline'?'v7_source':['word','pdf'].includes(sourceKind)?'template':sourceKind), controller.signal)]);
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
      setCap(capability); setSources(['template','word','pdf'].includes(sourceKind)?inputs.filter(s=>s.source_kind===(sourceKind==='pdf'?'pdf_material':sourceKind==='word'?'word_material':'excel_material')):inputs); setRecords(runs); setDetail(d); setFindings(f); setFinding(selected); setEvidence(e); setDiff(comparison);
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
  const adapter = cap?.adapters.find(a => sourceKind==='ai_offline'?a.parser_key==='ai_offline':sourceKind==='pdf'?a.parser_key==='pdf_evidence':sourceKind==='word'?a.parser_key==='word_evidence':a.kind===sourceKind&&!['word_evidence','pdf_evidence'].includes(a.parser_key));
  const fixedSource = sources.find(s => s.ref_id === d.ref);
  const usesNativeProcessRules = adapter?.parser_key === 'v7_deterministic' || adapter?.base_adapter?.parser_key === 'v7_deterministic';
  const formatAllowed = !usesNativeProcessRules || fixedSource?.deterministic_format?.supported === true;
  const formatLabel = value => value?.supported===true?'可用于当前检查':value?.format_state==='parse_failed'?'文件暂无法读取':'当前检查尚未支持此文件';
  const errorMessage = error?.code === 'DEFINITION_ANALYSIS_SOURCE_FORMAT_UNSUPPORTED' ? '所选材料的文件格式暂不能用于本次检查。原材料和已填写的范围说明仍保留，请重新选择标为“可用于当前检查”的材料；这不表示业务内容有误。' : error?.message;
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
    if (!d.ref || !d.description.trim()) { setError(new Error('请选择已保存材料并填写本轮范围说明。')); document.getElementById(!d.ref ? 'analysis-source' : 'analysis-description')?.focus(); return; }
    if (!adapter || !fixedSource || !formatAllowed) { setError(new Error('所选材料暂不能用于本次检查，请保留范围说明并重新核对文件格式和查阅范围。')); return; }
    await submitAnalysis(createPayload(adapter, d.ref, d.description.trim(), d.requestId));
  }
  async function submitAnalysis(body) {
    await act(async signal => {
      let result;
      try { result = await api.request(root + '/runs', { method: 'POST', body, signal }); }
      catch (e) {
        if (!signal.aborted && (['NETWORK_ERROR', 'REQUEST_TIMEOUT', 'INVALID_RESPONSE'].includes(e.code) || e.status >= 500)) setDraft({ ...d, dirty: true, analysisRequest: body });
        throw e;
      }
      if (signal.aborted) return; setDraft(null); changeRoute({ run: result.run_id, finding: '', evidence: '', compare: '', input: '', q: '', type: '' }); setTick(t => t + 1);
    });
  }
  async function exportCurrent() {
    await act(async signal => {
      const fresh = await api.request(root + '/runs/' + route.run + '/export', { signal });
      if (signal.aborted) return;
      const data = filteredExport(fresh, route), blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = '材料检查结果.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice(`已导出当前范围 ${data.findings.length} 条发现及其证据定位，不含原文摘录。`);
    });
  }
  const visible = detail ? filterFindings(findings, detail, route) : [], base = detail ? filterFindings(findings, detail, { history: route.history }) : [];
  const checkName = id => { const rule = cap?.adapters.flatMap(a => a.catalog).find(r => r.rule_id === id); return rule ? analysisRulePresentation(rule).title : '检查项目名称未记录'; };
  const coverageView = rows => <ul>{rows.map((c, i) => <li key={i}>{({check:'材料检查',deterministic:'材料规则检查',offline_opinions:'离线意见核对'})[c.step_key]||'其他检查步骤'}：已检查 {c.checked?.length || 0} / {c.expected?.length || 0} 项{c.missing?.length ? `；未覆盖：${c.missing.map(checkName).join('、')}` : '；本步骤无登记覆盖缺口'}</li>)}</ul>;
  function back() { if ((draft?.review || draft?.task || draft?.closure) && !guard.confirmLeave()) return; if (draft?.review || draft?.task || draft?.closure) setDraft({ ...draft, review: null, task: null, closure: null, dirty: (draft.closure || draft.task || draft.review).baseDirty }); returnFocus.current = route.finding; changeRoute({ finding: '', evidence: '' }); }
  return <div className="analysis-workbench">
    <StatusPanel title="按当前身份的查阅范围检查已保存材料">系统按固定规则检查，结果初始为待核实；有权人员核对后可关联已有问题或创建问题，不自动生成待办。完整检查范围及所需材料尚未确认，不能根据局部检查结果认定完整业务流程已跑通。历史评审意见未导入本检查台。</StatusPanel>
    {error && <StatusPanel kind="error" title="操作未完成，当前输入保留" onRetry={() => setTick(t => t + 1)}>{userMessage(errorMessage)} </StatusPanel>}
    {notice && <StatusPanel title={notice} />}
    <ExcelEvidence api={api} draft={draft} setDraft={setDraft} batchId={route.excel || (sourceKind==='template'?d.ref:'')} canWrite={cap?.can_create && !draft?.analysisRequest} onRegistered={id=>{setSourceKind('template');setDraft({...draft,excel:null,kind:'template',ref:id,description:draft?.description||'',dirty:!!draft?.description,requestId:uuid()});changeRoute({excel:id});setTick(t=>t+1);}} />
    <WordEvidence api={api} draft={draft} setDraft={setDraft} batchId={route.word || (sourceKind==='word'?d.ref:'')} anchorId={route.wordAnchor} canWrite={cap?.can_create && !draft?.analysisRequest} onRegistered={id=>{setSourceKind('word');setDraft({...draft,word:null,kind:'word',ref:id,description:draft?.description||'',dirty:!!draft?.description,requestId:uuid()});changeRoute({word:id,wordAnchor:''});setTick(t=>t+1);}} />
    <PdfEvidence api={api} draft={draft} setDraft={setDraft} batchId={route.pdf || (sourceKind==='pdf'?d.ref:'')} anchorId={route.pdfAnchor} canWrite={cap?.can_create && !draft?.analysisRequest} onRegistered={id=>{setSourceKind('pdf');setDraft({...draft,pdf:null,kind:'pdf',ref:id,description:draft?.description||'',dirty:!!draft?.description,requestId:uuid()});changeRoute({pdf:id,pdfAnchor:''});setTick(t=>t+1);}} />
    <section className="card"><h2>建立检查任务</h2><p>有办理权限的人员选择已保存的流程材料、设计交接记录或已登记的 Excel、DOCX、PDF 材料，填写本轮检查范围后点击“建立检查任务”。任务状态和结果在下方“检查记录”中查看；检查发现仍须人工核实。对象、字段和对应关系仍通过各自台账入口维护。</p>
      <form onSubmit={create}><fieldset disabled={busy || !cap?.can_create || !!draft?.analysisRequest || !!draft?.review || !!draft?.task || !!draft?.closure || !!draft?.excel || !!draft?.word || !!draft?.pdf}>
        <label className="management-input">检查材料类型<select aria-label="检查材料类型" value={sourceKind} onChange={e => { if (!guard.confirmLeave()) return; setDraft(null); setSourceKind(e.target.value); }}><option value="ai_offline">单流程与离线 AI 意见核对（不调用模型）</option><option value="v7_source">已保存的流程材料</option><option value="handoff">已保存的设计交接记录</option><option value="template">Excel 证据读取核对</option><option value="word">DOCX 证据读取核对</option><option value="pdf">PDF 证据读取核对</option></select></label>
        <label className="management-input">已保存材料<select id="analysis-source" aria-label="已保存材料" value={d.ref} onChange={e => edit('ref', e.target.value)}><option value="">请选择材料及版本</option>{sources.map(s => <option value={s.ref_id} key={s.ref_id} disabled={usesNativeProcessRules && !s.deterministic_format?.supported}>{labelSource(s)} · {s.deterministic_format ? formatLabel(s.deterministic_format) + (s.deterministic_format.supported ? '' : '（当前规则尚未支持）') : businessStatus(s.validation_status,'已保存来源材料')}</option>)}{d.ref && !sources.some(s => s.ref_id === d.ref) && <option value={d.ref}>原选择的名称暂未读取，请重新核对</option>}</select></label>
        <label className="management-input">本轮范围说明<textarea id="analysis-description" aria-label="本轮范围说明" maxLength={1000} value={d.description} onChange={e => edit('description', e.target.value)} /></label>
        <button className="primary" type="submit" disabled={!!d.ref && (!fixedSource || !formatAllowed)}>建立检查任务</button>
      </fieldset></form>
      {usesNativeProcessRules && <p role="note">请选择标为“可用于当前检查”的已保存材料。文件无法读取或暂未受支持时，请核对原文件；这不表示业务内容有误。</p>}
      {draft?.analysisRequest && <StatusPanel title="创建结果不明，保留原请求和输入">请先查阅检查记录；继续办理可能完成原来尚未成功的任务创建，本次填写内容仍保留。<button className="secondary" disabled={busy || !cap?.can_create} onClick={() => submitAnalysis(draft.analysisRequest)}>继续建立检查任务并核对结果</button></StatusPanel>}
      {!busy && cap && !cap.can_create && <p>当前身份只供查阅，不能建立或取消检查任务。可在下方“检查记录”选择已有记录查看结果。</p>}
      {!busy && !sources.length && <p>当前没有可选材料。有办理权限的人员可先到“固定来源映射”或“设计交接”登记材料，或在本页登记文件证据；登记后返回本区选择材料。</p>}
      {d.dirty && <p className="input-notice">本轮输入尚未提交；失败、查看详情和导出不会应用或清空输入。</p>}
      {cap && <details><summary>本轮检查规则及未覆盖条件</summary>{cap.adapters.find(a => sourceKind==='pdf'?a.parser_key==='pdf_evidence':sourceKind==='word'?a.parser_key==='word_evidence':a.kind===sourceKind&&!['word_evidence','pdf_evidence'].includes(a.parser_key))?.catalog.map(analysisRulePresentation).map(r => <p key={r.rule_id}>{r.title}：{r.prerequisite.replace(/[。；]$/u,'')}；{r.not_applicable}{r.enabled === false ? '（未启用）' : ''}</p>)}</details>}
    </section>
    <section className="card"><h2>检查记录</h2><div className="import-actions"><label>查看检查记录<select aria-label="查看检查记录" disabled={busy} value={route.run} onChange={e => chooseRun(e.target.value)}><option value="">请选择检查记录</option>{records.map(r => <option key={r.run_id} value={r.run_id}>{businessDateTime(r.created_at)} · {statuses[r.status] || businessStatus(r.status,'检查状态待核对')}</option>)}</select></label><button className="secondary" disabled={busy} onClick={() => setTick(t => t + 1)}>刷新检查记录</button></div>{!busy && !records.length && <p>当前范围没有可见检查记录。</p>}</section>
    {busy && <StatusPanel kind="loading" title="正在读取或提交检查任务…">请稍候，输入仍保留。</StatusPanel>}
    {detail && <>
      <section className="card"><h2>本次检查 · {statuses[detail.status] || businessStatus(detail.status,'检查状态待核对')}</h2><p>当前范围：{businessText(detail.manifest.check_scope.description)}</p><p>创建：{businessDateTime(detail.created_at)} · 开始：{detail.started_at ? businessDateTime(detail.started_at) : '尚未开始'} · 结束：{detail.finished_at ? businessDateTime(detail.finished_at) : '尚未结束'}</p>
        <p>检查方式：材料规则检查 · AI：{detail.manifest.ai_metadata ? '本记录含 AI 配置，须结合步骤覆盖核对' : '未调用'} · 历史评审意见：未导入</p>
        {detail.manifest.ai_metadata?.provider === 'offline' && <p role="note">本轮仅使用离线替身，未调用真实模型。意见均待核实，引用通过不代表判断正确；真实 AI 分析未覆盖。AI 步骤失败时保留确定性检查结果，不能据此关闭问题。</p>}
        {detail.input_formats?.map(i => <p key={i.input_key}>固定格式：{formatLabel(i)} · 按所选来源内容核对。</p>)}
        {detail.history_limitations?.length > 0 && <StatusPanel kind="error" title="旧结果适用范围受限">该记录的材料正文不在当时检查规则的支持范围内。旧发现和人工结论仍保留，不能将旧检查的格式判断用于当前材料，也不能据此认定当前材料已没有问题。</StatusPanel>}
        <ul>{detail.manifest.inputs.map(i => <li key={i.input_key}>{labelSource(i.snapshot)}<details><summary>查看来源内容</summary><BusinessDetails value={i.snapshot.document || i.snapshot}/></details></li>)}</ul>
        <h3>步骤进度与完成覆盖</h3>{detail.manifest.steps.map(step => { const a = detail.attempts.filter(a => a.step_key === step.step_key).sort((a, b) => b.attempt_no - a.attempt_no)[0]; return <p key={({check:'材料检查',deterministic:'材料规则检查',offline_opinions:'离线意见核对'})[step.step_key]||'其他检查步骤'}>{({check:'材料检查',deterministic:'材料规则检查',offline_opinions:'离线意见核对'})[step.step_key]||'其他检查步骤'}：{a ? statuses[a.status] || businessStatus(a.status,'检查状态待核对') : '尚未开始'}{a?.error_code ? ' · 本步骤未完成，请核对记录后联系维护人员' : ''}</p>; })}
        {coverageView(detail.coverage)}<p>完成仅表示本轮已登记检查执行完毕；部分完成、失败或未覆盖不能当作已整改。</p>
        {pending(detail) && <p>每 2.5 秒刷新进度；有未提交输入时暂停自动刷新。排队中的任务尚待系统开始检查，可在“检查记录”查看后续状态。</p>}
        {pending(detail) && cap?.can_create && <button className="secondary" disabled={busy} onClick={() => act(async signal => { if (!cancelRequest.current || cancelRequest.current.run !== detail.run_id || cancelRequest.current.revision !== detail.revision_no) cancelRequest.current = { run: detail.run_id, revision: detail.revision_no, id: uuid() }; await api.request(root + '/runs/' + detail.run_id + '/cancel', { method: 'POST', signal, body: { request_id: cancelRequest.current.id, expected_revision: detail.revision_no } }); if (!signal.aborted) setTick(t => t + 1); })}>取消本次检查</button>}
      </section>
      <section className="card"><h2>发现检查台</h2><div className="analysis-filters"><label>搜索问题说明<input aria-label="搜索发现" value={route.q} onChange={e => changeRoute({ q: e.target.value })} /></label><label>发现类别<select aria-label="发现类别" value={route.type} onChange={e => changeRoute({ type: e.target.value })}><option value="">全部类别</option>{Object.entries(types).map(([k, v]) => <option value={k} key={k}>{v}</option>)}</select></label><label>固定输入<select aria-label="固定输入筛选" value={route.input} onChange={e => changeRoute({ input: e.target.value })}><option value="">全部当前输入</option>{detail.manifest.inputs.map(i => <option value={i.input_key} key={i.input_key}>{labelSource(i.snapshot)}</option>)}</select></label><label>步骤尝试<select aria-label="步骤尝试" value={route.history} onChange={e => changeRoute({ history: e.target.value })}><option value="">各步骤最后一次尝试</option><option value="all">包含历史尝试（非历史评审）</option></select></label></div>
        <p data-testid="analysis-count">匹配 {visible.length} / 当前范围 {base.length} 条发现</p><div className="import-actions"><button className="secondary" onClick={() => changeRoute({ q: '', type: '', input: '' })}>清除筛选</button><button className="secondary" disabled={busy} onClick={exportCurrent}>导出当前筛选范围</button></div>
        {!finding ? <><DirectedGraph name="当前筛选的分析路径（箭头不代表业务流转）" nodes={visible.length ? [`${detail.manifest.inputs.length} 个固定输入`, '材料规则检查', `${visible.length} 条规则发现`] : []} />
          {visible.map(f => <article className="analysis-finding" key={f.finding_id}><strong>{types[f.finding_type] || businessStatus(f.finding_type,'发现类别待核对')} · 规则发现</strong><p>{userMessage(f.message)}</p><p className="muted">{businessLocation(f.semantic_locator)}</p><button className="secondary" data-finding={f.finding_id} disabled={busy} onClick={() => { scroll.current = window.scrollY; changeRoute({ finding: f.finding_id, evidence: '' }); }}>查看这项发现</button></article>)}
          {!visible.length && <p>当前筛选没有发现，不代表业务已通过审核或旧问题已关闭。</p>}</> : <section aria-label="发现详情"><h3 ref={focus} tabIndex={-1}>检查发现详情</h3><button className="secondary" disabled={busy} onClick={back}>返回原筛选位置</button><p>{userMessage(finding.message)}</p><p>对象、字段或关系定位：{businessLocation(finding.semantic_locator)}</p>
          {!finding.evidence_ids.length ? <StatusPanel title="缺少可核对证据">这表示当前发现没有证据引用，不表示原文未说明。</StatusPanel> : <div className="import-actions">{finding.evidence_ids.map((id, i) => <button className="secondary" key={id} disabled={busy} onClick={() => changeRoute({ evidence: id })}>查看证据 {i + 1}</button>)}</div>}
          {evidence && <FixedEvidence value={evidence} api={api} />}
          <FindingReview api={api} run={route.run} finding={finding} draft={draft} setDraft={setDraft} onNavigate={(run, next) => { if (!guard.confirmLeave()) return; setDraft(null); changeRoute({ run, finding: next, evidence: '' }); }} /></section>}
      </section>
      <section className="card"><h2>两次检查的差异</h2><label className="management-input">选择另一份检查记录进行对比<select aria-label="对比检查记录" value={route.compare} disabled={busy} onChange={e => changeRoute({ compare: e.target.value })}><option value="">请选择要对比的检查记录</option>{records.filter(r => r.run_id !== route.run).map(r => <option key={r.run_id} value={r.run_id}>{businessDateTime(r.created_at)} · {statuses[r.status] || businessStatus(r.status,'检查状态待核对')}</option>)}</select></label>
        {diff && <><p>{diff.comparison_complete ? '当前输入与检查范围可比' : '对照不完整，存在不可比较或待人工匹配范围'}；本轮未再检出不等于已整改。</p><BusinessDetails value={{ reasons: diff.comparability_reasons, coverage: diff.coverage, counts: diff.counts }}/>{diff.rows.map((r, i) => <p key={i}><strong>{businessText(r.label)}</strong>：{businessText(r.reason)}</p>)}</>}
      </section>
    </>}
  </div>;
}
