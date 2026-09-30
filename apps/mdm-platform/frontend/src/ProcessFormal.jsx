import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

const ROOT = '/api/process-v7-preview/cases';
const statusNames = { draft: '正式草稿', submitted: '待正式审核', under_review: '正式审核中', needs_changes: '需要修改', rejected: '审核拒绝', approved: '审核通过', published: '已发布', superseded: '历史已发布版本', pending: '待审核', review_complete: '预览核对完成', under_review_preview: '预览核对中' };
const decisions = { approve: '审核通过', needs_changes: '需要修改', reject: '审核拒绝' };
const operations = { promote: '提升当前修订', submit: '提交正式审核', review: '办理正式审核', publish: '发布正式版本' };
const codes = { ACTOR_DEPARTMENT_UNRESOLVED: '执行部门尚未明确，不能通过人工范围确认绕过。请回到同一案例核对来源；审核仍可选择需要修改或拒绝。', V7_FORMAL_DISABLED: '正式流转尚未开启，请联系维护人员核对。', V7_PREVIEW_DISABLED: '流程核对入口尚未开启，请联系维护人员核对。' };
const failureText = e => codes[e.code] || e.message;
const label = value => statusNames[value] || value || '尚未形成';
function snapshot(detail) {
  const formal = detail?.formal_promotion;
  return JSON.stringify([detail?.case.id, detail?.case.current_revision_no, detail?.case.current_content_hash,
    formal?.draft?.id, formal?.draft?.revision_no, formal?.draft?.content_hash, formal?.draft?.status,
    formal?.review_task?.id, formal?.review_task?.status, formal?.review_task?.draft_revision_no, formal?.review_task?.content_hash,
    detail?.allowed_actions, detail?.formal_allowed_actions, detail?.formal_allowed_decisions]);
}
function JsonDetails({ title, value }) { return <details><summary>{title}</summary><pre className="analysis-json">{JSON.stringify(value, null, 2)}</pre></details>; }

function FormalContent({ api, draft }) {
  const [state, setState] = useState({});
  const active = useRef(null), sequence = useRef(0);
  useEffect(() => () => { ++sequence.current; active.current?.abort(); }, []);
  async function read(download = false) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++sequence.current; setState({ loading: true });
    try {
      const root = '/api/process-design/drafts/' + encodeURIComponent(draft.id);
      const content = await api.request(root + '/content', { signal: controller.signal });
      if (token !== sequence.current) return;
      if (content.source !== 'draft_canonical_json' || content.content_hash !== draft.content_hash
        || Number(content.revision) !== Number(draft.revision_no)
        || !['process-governance-v7', 'process-governance-v8'].includes(content.schema_version)
        || content.schema_version !== draft.schema_version || content.document?.schema_version !== content.schema_version) {
        throw new Error('正文与当前草稿的修订、摘要或格式不一致，请刷新正式办理状态后重新核对。');
      }
      if (download) {
        const nativeDocument = await api.request(root + '/export', { signal: controller.signal });
        if (token !== sequence.current) return;
        if (JSON.stringify(nativeDocument) !== JSON.stringify(content.document)) throw new Error('导出期间正文发生变化，已停止下载。请刷新正式办理状态后重新核对。');
        const url = URL.createObjectURL(new Blob([JSON.stringify(nativeDocument, null, 2)], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url;
        link.download = `formal-draft-${draft.id}-r${content.revision}-${content.schema_version}.json`;
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setState({ content, downloaded: download });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error }); }
  }
  return <section data-formal-content aria-labelledby="formal-content-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="formal-content-heading">正式草稿正文与原生 JSON</h3>
    <p>读取草稿 #{draft.id} · 修订 {draft.revision_no} · {label(draft.status)}。草稿导出不代表审核通过或正式发布；已发布固定版本仍从下方独立查阅。</p>
    <div className="import-actions"><button disabled={state.loading} onClick={() => read()}>核对正式草稿正文</button><button disabled={state.loading} onClick={() => read(true)}>下载正式草稿 JSON</button></div>
    {state.loading && <StatusPanel kind="loading" title="正在核对正式草稿正文…" />}
    {state.error && <StatusPanel kind="error" title="正式草稿正文暂不可用">{state.error.message} 未提交意见仍保留；不会自动重试下载。</StatusPanel>}
    {state.content && <div data-formal-content-result>
      <p role="status">已核对当前草稿修订与服务端校验摘要。{state.downloaded ? '已发起原生 JSON 下载。' : ''}</p>
      <p>格式：{state.content.schema_version} · 草稿修订：{state.content.revision}</p>
      <p className="formal-digest">正文摘要：{state.content.content_hash}</p>
      <JsonDetails title="正式草稿原生正文" value={state.content.document} />
    </div>}
    <p className="muted">下载保留原生正文及稳定标识，文件由当前 JSON 重新序列化，不是原始上传字节。不写回3001，也不应用页面上未提交的意见。</p>
  </section>;
}

function PublishedHistory({ api, draftId, documentId }) {
  const [state, setState] = useState({}), [selected, setSelected] = useState('');
  const active = useRef(null), sequence = useRef(0);
  useEffect(() => () => { ++sequence.current; active.current?.abort(); }, []);
  function begin() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    return { controller, token: ++sequence.current };
  }
  async function list() {
    const { controller, token } = begin(); setSelected(''); setState({ loading: true });
    try {
      const data = await api.request('/api/process-design/drafts/' + encodeURIComponent(draftId), { signal: controller.signal });
      if (token !== sequence.current) return;
      if (String(data.draft?.id) !== String(draftId) || String(data.document?.id) !== String(documentId)
        || !Array.isArray(data.versions) || data.versions.some(row => String(row.document_id) !== String(documentId))) throw new Error('版本列表与当前主档不一致，请刷新核对。');
      setState({ rows: data.versions.filter(row => ['published', 'superseded'].includes(row.status) && ['process-governance-v7', 'process-governance-v8'].includes(row.schema_version)) });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error }); }
  }
  async function read(download = false) {
    const row = state.rows?.find(item => String(item.id) === selected); if (!row) return;
    const { controller, token } = begin(); setState({ rows: state.rows, loading: true });
    try {
      const root = '/api/process-design/versions/' + encodeURIComponent(row.id);
      const content = await api.request(root + '/content', { signal: controller.signal });
      if (token !== sequence.current) return;
      if (String(content.process_version_id) !== String(row.id) || String(content.document_id) !== String(documentId)
        || content.content_hash !== row.content_hash || content.content_hash_verified !== true
        || content.schema_version !== row.schema_version || content.document?.schema_version !== row.schema_version
        || !['published', 'superseded'].includes(content.status)) throw new Error('正文与所选固定版本不一致，请刷新版本列表后核对。');
      if (download) {
        const result = await api.request(root + '/procedure-markdown', { signal: controller.signal });
        if (token !== sequence.current) return;
        if (String(result.process_version_id) !== selected || result.content_hash !== content.content_hash || typeof result.markdown !== 'string') throw new Error('程序文件与所选版本不一致，已停止下载。');
        const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = `procedure-version-${row.id}.md`; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setState({ rows: state.rows, content, downloaded: download });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ rows: state.rows, error }); }
  }
  return <section data-published-history aria-labelledby="published-history-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="published-history-heading">主档已发布版本查阅</h3>
    <p>列出本主档受支持的原生 V7/V8 已发布版本，包括已被后续版本替代的记录。请明确选择固定版本；历史版本不代表当前有效制度，也不替换正在办理的草稿。</p>
    <button onClick={list} disabled={state.loading}>读取或刷新已发布版本列表</button>
    {state.loading && <StatusPanel kind="loading" title="正在读取已发布版本…" />}
    {state.error && <StatusPanel kind="error" title="已发布版本暂不可用">{state.error.message} 请重试；失败不表示没有历史版本。</StatusPanel>}
    {state.rows && <>
      {!state.rows.length ? <p>该主档尚无可查阅的原生 V7/V8 已发布版本。</p> : <>
        <label className="identity-field">已发布历史版本<select aria-label="已发布历史版本" value={selected} onChange={event => { begin(); setSelected(event.target.value); setState({ rows: state.rows }); }}>
          <option value="">请选择固定版本</option>{state.rows.map(row => <option key={row.id} value={row.id}>版本 #{row.id} · {row.edition || row.version_no} · {label(row.status)}</option>)}
        </select></label>
        <div className="import-actions"><button disabled={!selected || state.loading} onClick={() => read()}>核对所选历史正文</button><button disabled={!selected || state.loading} onClick={() => read(true)}>下载所选历史程序文件</button></div>
        {selected && state.rows.some(row => String(row.id) === selected) && <p>
          {['process', 'data'].map(mode => <ReactDiagramLink key={mode} versionId={selected} mode={mode} />)}
          <span className="muted">在新标签页读取所选固定版本，当前未提交意见保留。</span>
        </p>}
      </>}
    </>}
    {state.content && <div data-published-history-result>
      <p role="status">固定版本 #{state.content.process_version_id} · {label(state.content.status)} · {state.content.schema_version} · 来源修订 {state.content.source_revision_no}。摘要校验通过。{state.downloaded ? '已发起程序文件下载。' : ''}</p>
      <p className="formal-digest">正文摘要：{state.content.content_hash}</p>
      <JsonDetails title="所选历史版本原生正文" value={state.content.document} />
    </div>}
    <p className="muted">查阅和下载只读取所选固定版本，不提交或清除未提交意见。这里不是跨草稿的完整审核历史；程序文件由该版本正文生成，并非原始上传文件。</p>
  </section>;
}

function ReactDiagramLink({ versionId, mode }) {
  return <a style={{ marginRight: 16 }} href={'/app/data-map?diagramVersion=' + encodeURIComponent(versionId) + '&diagramMode=' + mode} target="_blank" rel="noopener noreferrer">{mode === 'data' ? '查阅所选版本数据关系图' : '查阅所选版本流程图'}</a>;
}

function DocumentDraftHistory({ api, draftId, documentId }) {
  const [state, setState] = useState({}), [selected, setSelected] = useState('');
  const active = useRef(null), sequence = useRef(0);
  useEffect(() => () => { ++sequence.current; active.current?.abort(); }, []);
  async function load(cursor = null) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++sequence.current; setSelected(''); setState({ loading: true, cursor });
    try {
      const result = await api.request('/api/process-design/drafts/' + encodeURIComponent(draftId) + '/document-drafts'
        + (cursor ? '?before_id=' + encodeURIComponent(cursor) : ''), { signal: controller.signal });
      if (token !== sequence.current) return;
      if (String(result.anchor_draft_id) !== String(draftId) || String(result.document_id) !== String(documentId)
        || result.coverage !== 'visible_native_drafts' || !Array.isArray(result.items)
        || result.items.some(row => String(row.document_id) !== String(documentId)
          || !/^[1-9]\d*$/.test(row.id) || !['process-governance-v7', 'process-governance-v8'].includes(row.schema_version))) {
        throw new Error('历史草稿列表与当前主档不一致，请重新读取。');
      }
      setState({ data: result, cursor });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error, cursor }); }
  }
  return <section data-document-history aria-labelledby="document-history-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="document-history-heading">同一主档的历次草稿</h3>
    <p>按草稿标识从新到旧，每页20条，仅列出当前身份有权查阅的原生 V7/V8 草稿，包括未发布、需要修改和审核拒绝记录。历史只反映系统实际保存的内容，不补造缺失记录。</p>
    <button type="button" disabled={state.loading} onClick={() => load()}>读取或刷新主档草稿列表</button>
    {state.loading && <StatusPanel kind="loading" title="正在读取主档草稿…" />}
    {state.error && <StatusPanel kind="error" title="主档草稿历史暂不可用">{state.error.message} 读取失败不表示没有历史。<button onClick={() => load(state.cursor)}>重试本页草稿</button></StatusPanel>}
    {state.data && <>
      {!state.data.items.length && <p>本页没有可查阅的原生草稿。</p>}
      {state.data.items.length > 0 && <><label htmlFor="document-history-draft">选择历史草稿</label><select id="document-history-draft" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">请选择草稿后读取其审核和操作记录</option>
        {state.data.items.map(row => <option key={row.id} value={row.id}>草稿 #{row.id} · {label(row.status)} · 修订 {row.revision_no ?? '未记录'} · {row.schema_version}</option>)}
      </select></>}
      <p role="status">本页 {state.data.items.length} 条。{state.data.next_cursor ? '仍有更早草稿。' : '已到当前可见范围的末页。'}新草稿需刷新首页后查看。</p>
      {state.cursor && <button onClick={() => load()}>返回最新草稿</button>}
      {state.data.next_cursor && <button onClick={() => load(state.data.next_cursor)}>读取更早草稿</button>}
      {selected && <FormalHistory key={selected} api={api} draftId={selected} documentId={documentId} />}
    </>}
    <p className="muted">查阅不会保存、清除或应用当前办理意见。旧版退役数据不在本入口恢复；草稿正文及历史事件不代表完整的逐修订正文快照。</p>
  </section>;
}

function FormalHistory({ api, draftId, documentId }) {
  const [state, setState] = useState({});
  const active = useRef(null), sequence = useRef(0);
  useEffect(() => () => { ++sequence.current; active.current?.abort(); }, []);
  async function read() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++sequence.current; setState({ loading: true });
    try {
      const result = await api.request('/api/process-design/drafts/' + encodeURIComponent(draftId), { signal: controller.signal });
      if (token !== sequence.current) return;
      if (String(result.draft?.id) !== String(draftId) || String(result.draft?.document_id) !== String(documentId)
        || !Array.isArray(result.reviewTasks) || !Array.isArray(result.events)
        || [...result.reviewTasks, ...result.events].some(row => String(row.draft_id) !== String(draftId))) {
        throw new Error('历史记录与当前正式草稿不一致，请重试核对。');
      }
      setState({ data: { reviews: result.reviewTasks, events: result.events } });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error }); }
  }
  const show = value => value === undefined || value === null || value === '' ? '未记录' : String(value);
  const eventNames = { submitted: '提交正式审核', review_approve: '审核通过', review_needs_changes: '要求修改', review_reject: '审核拒绝', publish: '发布正式版本' };
  return <section aria-label={'草稿 #' + draftId + ' 的审核和操作记录'} data-formal-history style={{ overflowWrap: 'anywhere' }}>
    <h3>历次正式审核与操作记录</h3>
    <p>读取正式草稿 #{draftId} 的历次记录，与上方预览案例历史分别展示。历史意见只适用于各自绑定的修订和摘要，不代表当前修订已通过。</p>
    <button type="button" disabled={state.loading} onClick={read}>{state.loading ? '正在读取正式历史…' : '读取或刷新正式历史'}</button>
    {state.error && <StatusPanel kind="error" title="正式历史暂不可用">{state.error.message} 请重试；读取失败不表示没有历史。</StatusPanel>}
    {state.data && <>
      <h4>历次审核任务（{state.data.reviews.length}条）</h4>
      {!state.data.reviews.length && <p>该正式草稿尚无审核任务记录。</p>}
      {state.data.reviews.map(row => <article key={row.id} data-formal-review={row.id}>
        <p><strong>审核任务 #{row.id} · {label(row.status)}</strong> · 绑定修订 {show(row.draft_revision_no)}</p>
        <p className="formal-digest">绑定摘要：{show(row.content_hash)}</p>
        <p>审核人员标识：{show(row.decided_by)} · 决定时间：{show(row.decided_at)} · 创建时间：{show(row.created_at)}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{show(row.decision_note)}</p>
      </article>)}
      <h4>正式操作事件（{state.data.events.length}条）</h4>
      {!state.data.events.length && <p>该正式草稿尚无操作事件记录。</p>}
      {state.data.events.map(row => <article key={row.id} data-formal-event={row.id}>
        <p><strong>事件 #{row.id} · {eventNames[row.event_type] || show(row.event_type)}</strong> · 操作人员标识：{show(row.actor_user_id)} · 时间：{show(row.created_at)}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{show(row.note)}</p>
        <JsonDetails title="事件原始依据与版本绑定" value={row.payload} />
      </article>)}
      <p className="muted">人员标识沿用接口原记录，不根据历史用户名称推断人员身份。刷新历史不会保存或清除上方未提交意见。</p>
    </>}
  </section>;
}

// The parent keeps this editor in memory across session expiry, bound to person and department.
export function ProcessFormal({ api, draft, setDraft }) {
  const [selected, setSelected] = useState(() => draft?.caseId || new URLSearchParams(location.search).get('case') || '');
  const [list, setList] = useState(null), [detail, setDetail] = useState(null), [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(null), generation = useRef(0), busyRef = useRef(false), currentDraft = useRef(draft), editor = useRef(null);
  currentDraft.current = draft;
  useEffect(() => () => { ++generation.current; active.current?.abort(); }, []);
  useEffect(() => { if (draft?.kind) editor.current?.focus(); }, [draft?.kind]);
  async function load(id = selected) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current; setLoading(true); setError('');
    try {
      const rows = await api.request(ROOT + '?limit=200', { signal: controller.signal });
      if (token !== generation.current) return;
      setList(rows);
      const data = id ? await api.request(ROOT + '/' + encodeURIComponent(id), { signal: controller.signal }) : null;
      if (token === generation.current) { setDetail(data); setVersion(null); }
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') { setError(failureText(e)); setDetail(null); } }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(selected); }, [selected]);
  const formal = detail?.formal_promotion, formalDraft = formal?.draft, task = formal?.review_task;
  const actions = detail?.formal_allowed_actions || [];
  const stale = Boolean(draft && detail && draft.snapshot !== snapshot(detail));
  function abandon() { return !currentDraft.current || window.confirm('当前有未提交输入，是否明确放弃？'); }
  function select(id) {
    if (String(id) === selected) return;
    if (busyRef.current || !abandon()) return;
    setDraft(null); setDetail(null); setVersion(null); setNotice(''); setSelected(String(id));
    const url = new URL(location.href); id ? url.searchParams.set('case', id) : url.searchParams.delete('case'); history.replaceState(history.state, '', url);
  }
  function start(kind) {
    if (busyRef.current || !detail || !abandon()) return;
    const source = kind === 'promote' ? { revision: detail.case.current_revision_no, hash: detail.case.current_content_hash }
      : kind === 'review' ? { revision: task.draft_revision_no, hash: task.content_hash } : { revision: formalDraft.revision_no, hash: formalDraft.content_hash };
    setError(''); setNotice('');
    setDraft({ kind, caseId: String(detail.case.id), snapshot: snapshot(detail), dirty: true,
      expected_revision_no: source.revision, expected_content_hash: source.hash, draftId: formalDraft?.id, taskId: task?.id,
      mode: '', documentNo: '', documentTitle: '', existingNo: '', target: null, decision: '', note: '' });
  }
  function update(values) { setDraft({ ...currentDraft.current, ...values, dirty: true }); }
  async function lookup() {
    const input = currentDraft.current; if (!input || busyRef.current) return;
    if (!input.existingNo.trim()) { setError('请输入已有主档的完整制度编号。'); return; }
    const token = generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.request(ROOT + '/' + encodeURIComponent(input.caseId) + '/formal-targets?document_no=' + encodeURIComponent(input.existingNo.trim()));
      if (token !== generation.current || input !== currentDraft.current) return;
      if (!result.exists || !result.accessible || !result.document) throw new Error('未找到可承接的主档，请核对完整编号、归口及权限。');
      update({ target: result.document });
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function execute(event) {
    event.preventDefault(); const input = currentDraft.current;
    if (!input || !detail || busyRef.current || loading || stale) return;
    let url, body = { expected_revision_no: input.expected_revision_no, expected_content_hash: input.expected_content_hash };
    const token = generation.current; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (input.kind === 'promote') {
        if (input.mode === 'create') {
          if (!input.documentNo.trim() || !input.documentTitle.trim()) throw new Error('请填写新主档制度编号和名称。');
          body.target = { mode: 'create', document_no: input.documentNo.trim(), document_title: input.documentTitle.trim() };
        } else if (input.mode === 'existing' && input.target) body.target = { mode: 'existing', document_id: input.target.id };
        else throw new Error('请明确选择承接方式；已有主档须先精确查找并核对。');
        url = ROOT + '/' + encodeURIComponent(input.caseId) + '/promote';
      } else if (input.kind === 'review') {
        if (!input.decision || !input.note.trim()) throw new Error('请选择正式审核结论并填写意见。');
        if (!detail.formal_allowed_decisions?.includes(input.decision)) throw new Error('当前结论已不可执行，请刷新状态并核对。');
        url = '/api/process-design/review-tasks/' + encodeURIComponent(input.taskId) + '/decision';
        body = { ...body, decision: input.decision, note: input.note.trim() };
      } else url = '/api/process-design/drafts/' + encodeURIComponent(input.draftId) + '/' + input.kind;
      const result = await api.request(url, { method: 'POST', body });
      if (token !== generation.current) return;
      setDraft(null); setNotice(input.kind === 'publish' ? '已发布固定正式版本，版本标识为 ' + result.process_version_id + '。' : operations[input.kind] + '已完成，请查看当前办理状态。');
      await load(input.caseId);
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function readVersion(download = false) {
    const id = formal?.current_version?.id; if (!id || busyRef.current) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.request('/api/process-design/versions/' + encodeURIComponent(id) + (download ? '/procedure-markdown' : '/content'));
      if (token !== generation.current) return;
      if (download) {
        const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = result.filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setVersion(result);
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const legacy = '/#/processGovernance?workspace=v7Preview&v7Case=' + encodeURIComponent(selected);
  const protectLink = e => { if (busyRef.current || !abandon()) e.preventDefault(); };
  return <div className="process-preview process-formal">
    <section className="card"><h2>按当前修订办理正式流转</h2><p>先完成案例核对，再由有权人员提升、提交、审核和发布。正式正文沿用上传修订；需要修改时，返回同一案例上传3001修订。</p>
      <label>选择流程案例<select aria-label="选择流程案例" disabled={busy || loading} value={selected} onChange={e => select(e.target.value)}><option value="">请选择案例</option>{(list?.items || []).map(c => <option key={c.id} value={c.id}>{c.process_name} · 修订{c.current_revision_no}</option>)}</select></label>
      <div className="import-actions"><button disabled={busy || loading} onClick={() => load()}>刷新正式办理状态</button><a href={legacy} onClick={protectLink}>进入原案例完整入口</a></div>
      {list && <p className="muted">当前返回{list.items?.length || 0}个可访问案例，最多显示200个。</p>}
      {list && !list.items?.length && <p>当前范围暂无案例。</p>}
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取正式办理状态…">未提交输入仍保留，等待状态核对后再操作。</StatusPanel>}
    {error && <StatusPanel kind="error" title="操作未完成" onRetry={busy ? undefined : () => load()}>{error}</StatusPanel>}
    {notice && <StatusPanel title="操作已完成">{notice}</StatusPanel>}
    {draft && <section className="card preview-editor"><h2 ref={editor} tabIndex={-1}>{operations[draft.kind]}</h2>
      <p>本次操作绑定修订 {draft.expected_revision_no}，输入仅保留在当前页面。点击确认才会提交；刷新不会自动应用输入。</p>
      <p className="formal-digest">绑定摘要：{draft.expected_content_hash}</p>
      {stale && <StatusPanel kind="error" title="办理来源或状态已变化">输入保留，不能自动套用到新修订或审核任务。请复制所需内容，明确放弃后重新开始。</StatusPanel>}
      {!detail && !loading && <StatusPanel title="当前办理状态尚未核对">输入保留，读取成功前不能提交。</StatusPanel>}
      <form onSubmit={execute}><fieldset disabled={busy || loading}>
        {draft.kind === 'promote' && <>
          <label>正式承接方式<select aria-label="正式承接方式" value={draft.mode} onChange={e => update({ mode: e.target.value, target: null })}><option value="">请选择</option><option value="create">新建流程主档</option><option value="existing">选择已有流程主档</option></select></label>
          {draft.mode === 'create' && <><label>新主档制度编号<input maxLength={128} value={draft.documentNo} onChange={e => update({ documentNo: e.target.value })} /></label><label>新主档制度名称<input maxLength={255} value={draft.documentTitle} onChange={e => update({ documentTitle: e.target.value })} /></label></>}
          {draft.mode === 'existing' && <><label>已有主档完整制度编号<input maxLength={128} value={draft.existingNo} onChange={e => update({ existingNo: e.target.value, target: null })} /></label><button type="button" disabled={stale} onClick={lookup}>精确查找已有主档</button>{draft.target && <StatusPanel title="已找到可承接主档">{draft.target.document_no} · {draft.target.document_title} · 主档标识 {draft.target.id}。请核对后确认承接。</StatusPanel>}</>}
          <p>同名不会自动合并。提升保存正式草稿，不表示已经审核或发布。</p>
        </>}
        {draft.kind === 'review' && <><label>正式审核结论<select aria-label="正式审核结论" value={draft.decision} onChange={e => update({ decision: e.target.value })}><option value="">请选择</option>{[...new Set([...(detail?.formal_allowed_decisions || []), ...(draft.decision ? [draft.decision] : [])])].filter(v => decisions[v]).map(v => <option key={v} value={v} disabled={!detail?.formal_allowed_decisions?.includes(v)}>{decisions[v]}</option>)}</select></label><label>正式审核意见<textarea aria-label="正式审核意见" rows={4} maxLength={1000} value={draft.note} onChange={e => update({ note: e.target.value })} /></label></>}
        {draft.kind === 'submit' && <p>确认提交当前正式草稿，由归口部门审核员办理。此操作不会改变正文。</p>}
        {draft.kind === 'publish' && <p>确认发布当前已审核通过的修订。发布将生成固定正式版本；下游继续引用各自绑定的版本，不自动创建工作包。</p>}
        <button className="primary" type="submit" disabled={stale || !detail}>确认执行本次操作</button>
        <button type="button" onClick={() => { if (abandon()) { setDraft(null); setError(''); } }}>放弃本次输入</button>
      </fieldset></form>
    </section>}
    {detail && <section className="card"><div className="section-heading"><h2>{detail.case.process_name}</h2><span className="badge">{detail.revision.document.schema_version}</span></div>
      <p>归口部门：{detail.case.owning_department_name || '待明确'} · 当前预览修订 {detail.case.current_revision_no}</p>
      <p className="formal-digest">当前来源摘要：{detail.case.current_content_hash}</p>
      <h3>当前任务与待处理事项</h3>
      {!!detail.handling_summary?.prerequisites?.length && <ul>{detail.handling_summary.prerequisites.map((v, i) => <li key={i}>{v}</li>)}</ul>}
      {(detail.handling_summary?.return_reasons || []).map((r, i) => <StatusPanel key={i} title={'退回依据 · ' + (r.department || '归口部门')}>{r.reason}</StatusPanel>)}
      <div className="import-actions">
        {detail.allowed_actions?.includes('promote_to_formal_draft') && <button disabled={busy || loading} onClick={() => start('promote')}>提升当前修订</button>}
        {actions.includes('submit_formal_draft') && <button disabled={busy || loading} onClick={() => start('submit')}>提交正式审核</button>}
        {actions.includes('review_formal_draft') && <button disabled={busy || loading} onClick={() => start('review')}>办理正式审核</button>}
        {actions.includes('publish_formal_draft') && <button disabled={busy || loading} onClick={() => start('publish')}>发布正式版本</button>}
      </div>
      {!detail.allowed_actions?.includes('promote_to_formal_draft') && !actions.some(v => ['submit_formal_draft', 'review_formal_draft', 'publish_formal_draft'].includes(v)) && <p>{formalDraft?.status === 'published' && detail.handling_summary?.current_promotion ? '当前修订已发布，可在下方核对固定版本正文和下载程序文件。' : '当前身份或状态没有可执行的正式写入动作。请按上方事项完成核对或等待有权人员办理。'}</p>}
      <p><a href={'/app/process-preview?case=' + encodeURIComponent(detail.case.id)} onClick={protectLink}>返回本案例预览与修订</a></p>
      {formalDraft ? <><h3>正式草稿与审核记录</h3><dl className="identity-grid">
        <div><dt>主档</dt><dd>{formal.document.document_no} · {formal.document.document_title}</dd></div>
        <div><dt>草稿状态</dt><dd>{label(formalDraft.status)}</dd></div><div><dt>草稿标识 / 修订</dt><dd>{formalDraft.id} / {formalDraft.revision_no}</dd></div>
        <div><dt>审核任务</dt><dd>{task ? `${task.id} · ${label(task.status)}` : '尚未提交审核'}</dd></div>
      </dl><p className="formal-digest">草稿摘要：{formalDraft.content_hash}</p>
        {task && <><p>审核结论：{decisions[task.decision] || label(task.status)}；审核人员标识：{task.reviewed_by || task.decided_by || '尚未记录'}；时间：{task.decided_at || task.reviewed_at || '尚未记录'}</p><p>{task.decision_note || '尚无正式审核意见'}</p><JsonDetails title="审核任务原始记录（含修订与摘要）" value={task} /></>}
        <JsonDetails title="正式提升依据与修订绑定" value={formal.promotion} />
        <FormalContent key={'content-' + snapshot(detail)} api={api} draft={formalDraft} />
        <FormalHistory key={snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
        <DocumentDraftHistory key={'document-' + snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
        <PublishedHistory key={'published-' + snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
      </> : <StatusPanel title="尚未提升为正式草稿">部门核对与范围条件满足后，由有权人员明确选择主档并提升。</StatusPanel>}
      {formal?.current_version && <><h3>已发布固定版本</h3><p>版本标识：{formal.current_version.id} · 版本号：{formal.current_version.version_no} · {label(formal.current_version.status)}</p><p>此处为该主档当前正式版本，可能早于正在办理的预览修订；不能用新修订替换已发布正文。</p>
        {actions.includes('read_formal_version') && <div className="import-actions"><button disabled={busy || loading} onClick={() => readVersion()}>核对已发布正文</button><button disabled={busy || loading} onClick={() => readVersion(true)}>下载程序文件（Markdown）</button></div>}
      </>}
      {version && <><StatusPanel kind={version.content_hash_verified ? 'empty' : 'error'} title={version.content_hash_verified ? '正式版本摘要校验通过' : '正式版本摘要未核实'}>固定版本 {version.process_version_id} · {version.schema_version} · 来源修订 {version.source_revision_no}</StatusPanel><JsonDetails title="已发布版本原生正文" value={version.document} /></>}
      <JsonDetails title="当前预览修订原文（不代表正式发布）" value={detail.revision.document} />
      <details><summary>案例操作历史（最多200条）</summary>{(detail.events || []).map((e, i) => <p key={e.id || i}>{e.created_at} · 人员标识 {e.actor_person_id || e.actor_user_id || '未提供'} · {e.actor_department_name || '未提供部门'} · {e.event_type} · {e.basis_text || ''}</p>)}</details>
      <p>正式图形和未在本页覆盖的历史内容仍通过原案例完整入口核对。</p>
    </section>}
  </div>;
}
