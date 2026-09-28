import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

const ROOT = '/api/process-v7-preview';
const labels = { pending: '待核对', confirmed: '已确认', needs_changes: '需要修改', pending_evidence: '待补证据', disputed: '存在分歧', pending_owner: '待分派归口', under_review: '核对中', needs_revision: '待上传修订', review_complete: '核对完成', closed: '已关闭', new: '新增', reopened: '重新核对', carried_forward: '沿用结论', action: '业务行为', decision: '判断节点', use: '使用', create: '创建', update: '更新', pending_confirmation: '待确认' };
const label = value => labels[value] || value || '待确认';
const errors = { V7_PREVIEW_CONTENT_INVALID: '文件结构或引用不符合当前版本要求，请在3001检查后重新下载。', V7_PREVIEW_PROCESS_REF_MISMATCH: '文件属于另一流程，请返回列表新建案例。', V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD: '文件归口部门尚未明确，请由MDM工作组组长建立案例。', V7_PREVIEW_DISABLED: '流程预览与核对尚未开启。', V7_PREVIEW_CASE_EXISTS: '该流程已有案例，请在案例列表中选择后上传修订。' };
function failureText(error) { return errors[error.code] || error.message; }
function JsonDetails({ title, value }) { return <details><summary>{title}</summary><pre className="analysis-json">{JSON.stringify(value, null, 2)}</pre></details>; }

let diagramAssets;
function loadDiagramAssets() {
  if (!diagramAssets) diagramAssets = (async () => {
    for (const [name, globalName] of [['cytoscape.min.js', 'cytoscape'], ['process-diagram.js', 'ProcessDiagram'], ['data-relation-diagram.js', 'DataRelationDiagram']]) {
      if (window[globalName]) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script'); script.src = '/api/process-diagrams/assets/' + name;
        script.onload = resolve; script.onerror = () => { script.remove(); reject(new Error('图形资源加载失败，请重试。')); };
        document.head.appendChild(script);
      });
    }
  })().catch(error => { diagramAssets = null; throw error; });
  return diagramAssets;
}
function Diagram({ documentData, revision }) {
  const [mode, setMode] = useState('process');
  const [dataRef, setDataRef] = useState(documentData.data_objects?.[0]?.data_ref || '');
  const [focus, setFocus] = useState(null);
  const [error, setError] = useState(''); const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const canvas = useRef(null), instance = useRef(null);
  useEffect(() => {
    let active = true, observer; setError(''); setFocus(null);
    loadDiagramAssets().then(() => {
      if (!active || mode === 'data' && !dataRef) return;
      const onFocus = (kind, ref) => {
        if (typeof kind === 'object') { ref = kind.ref; kind = kind.kind; }
        const row = kind === 'behavior' ? documentData.behaviors?.find(v => v.behavior_ref === ref) : kind === 'data' ? documentData.data_objects?.find(v => v.data_ref === ref) : documentData.flow_relations?.find(v => v.relation_ref === ref);
        setFocus(row || { ref });
      };
      const options = { container: canvas.current, documentData, editable: false, onFocus };
      instance.current = mode === 'process' ? window.ProcessDiagram.mount(options) : window.DataRelationDiagram.mount({ ...options, selectedDataRef: dataRef });
      instance.current.fit();
      observer = new ResizeObserver(() => { instance.current?.cy.resize(); instance.current?.fit(); });
      observer.observe(canvas.current);
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; observer?.disconnect(); instance.current?.destroy(); instance.current = null; };
  }, [documentData, mode, dataRef, retry]);
  async function download() {
    if (!instance.current || exporting) return;
    setExporting(true); setError('');
    try {
      const picture = new Image(); picture.src = instance.current.cy.png({ full: true, scale: 1, bg: '#ffffff', maxWidth: 6000, maxHeight: 6000 });
      await picture.decode();
      const output = document.createElement('canvas'); output.width = Math.max(1000, picture.width); output.height = picture.height + 100;
      const ctx = output.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, output.width, output.height);
      ctx.fillStyle = '#172b45'; ctx.font = 'bold 20px "Microsoft YaHei",sans-serif'; ctx.fillText(documentData.process.process_name, 24, 34, output.width - 48);
      ctx.font = '16px "Microsoft YaHei",sans-serif'; ctx.fillText(`${documentData.schema_version} · 预览修订 ${revision} · 非正式发布结论`, 24, 68, output.width - 48); ctx.drawImage(picture, 0, 100);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png')); if (!blob) throw new Error('图片生成失败，请重试。');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `process-preview-${revision}-${mode}.png`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { setError(e.message); } finally { setExporting(false); }
  }
  return <section className="preview-graph"><div className="import-actions">
    <label>图形视图<select aria-label="图形视图" value={mode} onChange={e => setMode(e.target.value)}><option value="process">流程图</option><option value="data">数据关系图</option></select></label>
    {mode === 'data' && <label>图中数据对象<select aria-label="图中数据对象" value={dataRef} onChange={e => setDataRef(e.target.value)}>{(documentData.data_objects || []).map(d => <option key={d.data_ref} value={d.data_ref}>{d.data_name}</option>)}</select></label>}
    <button onClick={() => instance.current?.fit()}>完整视图</button><button onClick={() => instance.current?.reset()}>清晰视图</button><button disabled={exporting || mode === 'data' && !dataRef} onClick={download}>下载图形PNG</button>
  </div>{error && <StatusPanel kind="error" title="图形加载未完成" onRetry={() => setRetry(v => v + 1)}>{error}</StatusPanel>}
    {mode === 'data' && !dataRef && <p>当前修订没有数据对象。</p>}
    <div className="preview-canvas" ref={canvas} aria-label="当前修订图形" />
    <p>点击节点查看原文；拖动空白处平移，滚轮缩放。图形内容的修改仍在3001完成。</p>
    {focus && <JsonDetails title="所选节点原文" value={focus} />}
  </section>;
}

function SourceContent({ source }) {
  return <><h3>节点与数据依据</h3>{(source.behaviors || []).map(b => {
    const objects = (source.data_objects || []).filter(d => d.behavior_links?.some(link => link.behavior_ref === b.behavior_ref));
    return <article className="preview-source" key={b.behavior_ref} id={'source-' + b.behavior_ref}>
      <h4>{b.behavior_name} <span className="badge">{label(b.node_type)}</span></h4>
      <p>执行角色：{b.current_actor_role || '待确认'}；触发：{b.trigger || '待确认'}；完成标准：{b.completion_standard || '待确认'}</p>
      {b.node_type === 'decision' && <p>以下“使用”关系表示判断使用已有数据，不代表创建或更新数据。</p>}
      {objects.length ? objects.map(d => <div key={d.data_ref}><strong>{d.data_name}</strong><p>数据操作：{d.behavior_links.filter(l => l.behavior_ref === b.behavior_ref).map(l => label(l.operation)).join('、')}</p><p>对象字段：{(d.fields || []).map(f => f.field_name).join('、') || '未登记'}（对象字段清单不表示全部参与本节点操作）</p><JsonDetails title="查看对象、字段、关系及生命周期原文" value={d} /></div>) : <p>未登记关联数据对象。</p>}
      <JsonDetails title="节点原文及稳定引用" value={b} />
    </article>;
  })}<JsonDetails title="完整修订原文（含表单、关系、来源与稳定标识）" value={source} /></>;
}

// Draft lives above the authenticated view, in memory only, and is bound to identity/case/revision.
export function ProcessPreview({ api, draft, setDraft }) {
  const [list, setList] = useState(null), [detail, setDetail] = useState(null);
  const [selected, setSelected] = useState(() => draft?.caseId || new URLSearchParams(location.search).get('case') || '');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]), [showDiagram, setShowDiagram] = useState(false);
  const generation = useRef(0), active = useRef(null), draftRef = useRef(draft), busyRef = useRef(false);
  const editor = useRef(null);
  draftRef.current = draft;
  useEffect(() => () => { ++generation.current; active.current?.abort(); }, []);
  useEffect(() => { if (draft?.kind) editor.current?.focus(); }, [draft?.kind, draft?.itemId]);
  async function load(id = selected) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current; setLoading(true); setError('');
    try {
      const rows = await api.request(ROOT + '/cases?limit=200', { signal: controller.signal });
      const data = id ? await api.request(ROOT + '/cases/' + encodeURIComponent(id), { signal: controller.signal }) : null;
      if (token !== generation.current) return;
      setList(rows); setDetail(data);
      if (data?.allowed_actions?.includes('assign_owner')) {
        const deps = await api.request('/api/org/departments', { signal: controller.signal });
        if (token === generation.current) setDepartments(deps);
      }
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') { setError(failureText(e)); setDetail(null); } }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(selected); }, [selected]);
  function discard() { return !draftRef.current || window.confirm('当前有未提交输入，是否明确放弃？'); }
  function selectCase(id) {
    if (busyRef.current || !discard()) return;
    setDraft(null); setDetail(null); setNotice(''); setShowDiagram(false); setSelected(String(id));
    const url = new URL(location.href); id ? url.searchParams.set('case', id) : url.searchParams.delete('case');
    history.replaceState(history.state, '', url);
  }
  function start(kind, item) {
    if (busyRef.current || !discard()) return;
    setError(''); setNotice('');
    setDraft({ kind, dirty: true, caseId: kind === 'create' ? '' : selected, itemId: item?.id, decision: '', basis: '', department_id: '', fileName: '', document: null,
      expected_revision_no: detail?.case.current_revision_no, expected_content_hash: detail?.case.current_content_hash });
  }
  function update(values) { setDraft({ ...draftRef.current, ...values, dirty: true }); }
  async function readFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (draftRef.current?.fileName && !window.confirm('替换当前待上传文件？原文件不会被修改。')) return;
    const current = draftRef.current; const token = generation.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('文件超过2MiB，请缩小内容后重试。');
      const document = JSON.parse(await file.text());
      if (!['process-governance-v7', 'process-governance-v8'].includes(document?.schema_version)) throw new Error('请选择V8或受支持的V7流程文件，不支持其他版本的在线写入。');
      if (token === generation.current && draftRef.current === current) update({ fileName: file.name, document, comparison: null });
    } catch (e) { if (token === generation.current) setError(e instanceof SyntaxError ? '文件不是有效JSON，已保留原待上传内容。' : e.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const stale = draft?.caseId && detail && (String(detail.case.id) !== String(draft.caseId) || detail.case.current_revision_no !== draft.expected_revision_no || detail.case.current_content_hash !== draft.expected_content_hash);
  async function submit(event) {
    event.preventDefault(); const current = draftRef.current;
    if (!current || busyRef.current || stale) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    let path, body = { expected_revision_no: current.expected_revision_no, expected_content_hash: current.expected_content_hash };
    try {
      if (['create', 'revision'].includes(current.kind)) {
        if (!current.document) throw new Error('请先选择流程JSON文件。');
        body = { ...body, source_file_name: current.fileName, document: current.document };
        path = ROOT + '/cases' + (current.kind === 'revision' ? '/' + encodeURIComponent(current.caseId) + '/revisions' : '');
        if (current.kind === 'revision' && !current.comparison) {
          const result = await api.request(path + '/preview', { method: 'POST', body });
          if (token === generation.current) update({ comparison: result });
          return;
        }
      } else if (current.kind === 'owner') {
        if (!current.department_id) throw new Error('请选择当前有效归口部门。');
        path = ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/assign-owner'; body.department_id = Number(current.department_id);
      } else {
        if (!current.decision || !current.basis.trim()) throw new Error('请选择结果并填写核对依据。');
        path = current.kind === 'scope' ? ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/scope-decision' : ROOT + '/items/' + encodeURIComponent(current.itemId) + '/decision';
        body = { ...body, decision: current.decision, basis: current.basis };
      }
      const result = await api.request(path, { method: 'POST', body });
      if (token !== generation.current) return;
      setDraft(null); setNotice('已保存预览核对记录。正式审核与发布需另行办理。');
      const id = String(result.case?.id || current.caseId);
      const url = new URL(location.href); url.searchParams.set('case', id); history.replaceState(history.state, '', url);
      if (id !== selected) setSelected(id); else await load(id);
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const actions = detail?.allowed_actions || [];
  const codes = new Set((detail?.blocking_issues || []).map(i => i.code));
  const blockers = (detail?.blocking_issues || []).filter(issue => {
    if (issue.code === 'ZERO_CROSS_DEPARTMENT_SCOPE_PENDING') return detail.case.scope_decision !== 'confirmed_no_cross_department';
    if (issue.code === 'OWNING_DEPARTMENT_CHANGE_PENDING') return detail.case.scope_decision !== 'keep_current_owner';
    return true;
  });
  const scopeOptions = [...(codes.has('ZERO_CROSS_DEPARTMENT_SCOPE_PENDING') ? [['confirmed_no_cross_department', '确认本修订不涉及跨部门']] : []), ...(codes.has('OWNING_DEPARTMENT_CHANGE_PENDING') ? [['keep_current_owner', '保留当前归口部门'], ['accept_source_owner', '采用修订中的归口部门']] : [])];
  return <div className="process-preview">
    <section className="card"><p>接收3001下载的V8或V7文件，核对本修订事实。预览核对记录不是正式审核或发布结论；需要修改时回3001修订，再向原案例上传。</p>
      <div className="import-actions"><button disabled={busy || loading} onClick={() => load()}>刷新案例与当前修订</button>{list?.allowed_actions?.includes('create_case') && <button disabled={busy || loading} onClick={() => start('create')}>新建流程预览案例</button>}</div>
      <label>选择流程案例<select aria-label="选择流程案例" value={selected} disabled={busy || loading} onChange={e => selectCase(e.target.value)}><option value="">请选择案例</option>{(list?.items || []).map(c => <option key={c.id} value={c.id}>{c.process_name} · 修订{c.current_revision_no} · {label(c.status)}</option>)}</select></label>
      {list && <p>当前返回{list.items?.length || 0}条（最多200条）；待本部门办理{list.my_action_count || 0}项。</p>}
      {list?.items?.length === 0 && <p>当前范围暂无案例。有权限的人员可上传文件建立案例。</p>}
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取案例…">当前输入保留，读取完成后再办理。</StatusPanel>}
    {error && <StatusPanel kind="error" title="操作未完成">{error}</StatusPanel>}
    {notice && <StatusPanel title="保存完成">{notice}</StatusPanel>}
    {draft && <section className="card preview-editor" ref={editor} tabIndex={-1}><h2>{{ create: '新建流程预览案例', revision: '上传新修订', decision: '本部门核对', owner: '分派归口部门', scope: '记录范围决定' }[draft.kind]}</h2>
      <p>输入仅保留在当前页面内存中，提交成功前不会写入核对记录。</p>
      {stale && <StatusPanel kind="error" title="来源已变化，当前输入仍保留">请复制保留意见后明确放弃本次编辑，再按最新修订重新核对。系统不会把旧意见自动应用到新修订。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={busy || loading || Boolean(stale)}>
        {['create', 'revision'].includes(draft.kind) ? <><label>流程JSON文件<input aria-label="流程JSON文件" type="file" accept=".json,application/json" onChange={readFile} /></label><p>{draft.fileName || '尚未选择文件'} {draft.document?.schema_version}</p>{draft.document && <p>流程：{draft.document.process?.process_name}</p>}{draft.comparison && <><h3>新修订影响</h3><p>{Object.entries(draft.comparison.comparison?.counts || {}).map(([k, v]) => `${({ added:'新增', removed:'移除', reopened:'重新核对', carried_forward:'沿用' })[k] || k} ${v}项`).join('；')}</p><p>受影响部门：{draft.comparison.comparison?.affected_departments?.join('、') || '无新增影响部门'}</p><JsonDetails title="完整比较、提示与卡口" value={draft.comparison} /></>}</>
          : draft.kind === 'owner' ? <label>归口部门<select aria-label="归口部门" value={draft.department_id} onChange={e => update({ department_id: e.target.value })} required><option value="">请选择</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            : <><label>核对结果<select aria-label="核对结果" value={draft.decision} required onChange={e => update({ decision: e.target.value })}><option value="">请选择</option>{(draft.kind === 'scope' ? scopeOptions : ['confirmed', 'needs_changes', 'pending_evidence', 'disputed'].map(v => [v, label(v)])).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label><label>核对依据<textarea aria-label="核对依据" rows="4" required maxLength={4000} value={draft.basis} onChange={e => update({ basis: e.target.value })} /></label></>}
        <button type="submit" className="primary">{busy ? '正在处理…' : draft.kind === 'revision' ? draft.comparison ? '确认上传新修订' : '比较新修订影响' : '保存预览核对记录'}</button>
      </fieldset></form><button disabled={busy} onClick={() => { if (discard()) setDraft(null); }}>放弃本次编辑</button>
    </section>}
    {detail && !loading && <section className="card"><h2>{detail.case.process_name}</h2><p>{detail.revision.document.schema_version} · 当前修订 {detail.case.current_revision_no} · {label(detail.case.status)}</p><p>归口部门：{detail.case.owning_department_name || '待分派'}；源文件：{detail.revision.source_file_name}</p><p className="digest">当前内容摘要：{detail.case.current_content_hash}</p>
      <p>目的：{detail.revision.document.process.purpose || '待确认'}</p><p>范围：{detail.revision.document.process.scope || '待确认'}</p>
      <div className="import-actions">{actions.includes('upload_revision') && <button disabled={busy} onClick={() => start('revision')}>上传3001新修订</button>}{actions.includes('assign_owner') && <button disabled={busy} onClick={() => start('owner')}>分派归口部门</button>}{actions.includes('record_scope_decision') && <button disabled={busy} onClick={() => start('scope')}>记录范围决定</button>}<button onClick={() => setShowDiagram(v => !v)}>{showDiagram ? '收起图形' : '查看本修订图形'}</button></div>
      {!!blockers.length && <div className="status-panel"><strong>待处理卡口</strong><ul>{blockers.map((v, i) => <li key={i}>{v.message} <small>{v.code}</small></li>)}</ul><p>执行部门未解决的卡口不能通过人工范围决定解除。</p></div>}
      {detail.case.scope_decision && <p>已记录范围决定：{({ confirmed_no_cross_department: '本修订不涉及跨部门', keep_current_owner: '保留当前归口部门', accept_source_owner: '采用修订中的归口部门' })[detail.case.scope_decision] || detail.case.scope_decision}；依据：{detail.case.scope_decision_basis || '未提供'}</p>}
      {!!detail.warnings?.length && <details><summary>核对提示</summary><ul>{detail.warnings.map((w, i) => <li key={i}>{w.message}</li>)}</ul></details>}
      {showDiagram && <Diagram key={detail.case.current_content_hash} documentData={detail.revision.document} revision={detail.case.current_revision_no} />}
      <h3>跨部门核对项</h3>{!detail.items?.length && <p>当前没有跨部门核对项，请同时检查范围卡口。</p>}
      {(detail.items || []).map(item => <article className="preview-item" key={item.id}><h4>{item.behavior_name}</h4><p>{item.origin_department_name}：{label(item.origin_status)}；{item.target_department_name}：{label(item.counterparty_status)}；{label(item.carry_state)}</p><p>归口部门依据：{item.origin_basis || '尚未记录'}</p><p>承接部门依据：{item.counterparty_basis || '尚未记录'}</p><a href={'#source-' + item.behavior_ref} onClick={e => { e.preventDefault(); document.getElementById('source-' + item.behavior_ref)?.scrollIntoView({ block: 'center' }); }}>定位当前修订节点与数据依据</a><JsonDetails title="核对项绑定的完整事实快照" value={item.item_snapshot} />{item.allowed_actions?.includes('record_department_decision') ? <button disabled={busy} onClick={() => start('decision', item)}>记录本部门核对结果</button> : <p>当前身份只读，不能代替参与部门核对。</p>}</article>)}
      <SourceContent source={detail.revision.document} />
      <details><summary>操作历史</summary>{(detail.events || []).map((e, i) => <p key={e.id || i}>{e.created_at} · {e.actor_name || e.actor_person_id || e.actor_user_id || '记录人员未提供'} · {e.actor_department_name || '部门未提供'} · {e.event_type} · {label(e.decision)} {e.basis_text}</p>)}{!detail.events?.length && <p>暂无操作记录。</p>}</details>
      <p><a href={'/#/processGovernance?workspace=v7Preview&v7Case=' + encodeURIComponent(detail.case.id)} onClick={e => { if (draft && !discard()) e.preventDefault(); }}>进入原案例办理正式流转</a></p>
    </section>}
  </div>;
}
