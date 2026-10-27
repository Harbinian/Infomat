import {businessFileName} from './businessPresentation.js';
import {BusinessDetails} from "./BusinessDetails.jsx";
import {businessName,businessStatus,businessText,userMessage} from "./businessPresentation.js";
import {TerminologyReferences} from './TerminologyReferences.jsx';
import {businessDateTime} from './businessGuidance.js';
import {formalHistoricalName,formalReviewName,terminologyGate} from './terminologyGovernanceModel.js';
import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { ProcessChecks } from './ProcessChecks.jsx';
import { DepartmentAccountability, accountabilityFailureText, accountabilitySnapshot } from './DepartmentAccountability.jsx';
import {formalAccountabilityContext} from './processActionGuidance.js';
import {formalPrerequisites,formalReadOnlyChecks,formalIssueLocation,formalIssueLabel,formalIssueBusinessPath} from './formalReadability.js';
import {formalSourcePresentation} from './formalSourcePresentation.js';
import {caseHistoryAction} from './caseHistoryPresentation.js';

const ROOT = '/api/process-v7-preview/cases';
const statusNames = { draft: '正式草稿', submitted: '待部门负责人确认', under_review: '部门负责人确认中', needs_changes: '需要修改', rejected: '已拒绝', approved: '已通过', published: '已发布', superseded: '历史已发布版本', pending: '待确认', review_complete: '预览核对完成', under_review_preview: '预览核对中' };
const decisions = { approve: '确认通过', needs_changes: '需要修改', reject: '拒绝' };
const operations = { promote: '生成正式草稿', submit: '提交负责人确认', review: '部门负责人最终确认', publish: '发布正式版本', withdraw: '撤回负责人确认', 'return-for-changes': '退回修改' };
const codes = { ACTOR_DEPARTMENT_UNRESOLVED: '执行部门尚未明确，不能通过人工范围确认绕过。请回到同一案例核对来源；部门负责人仍可要求修改或拒绝。', V7_FORMAL_DISABLED: '正式流转尚未开启，请联系维护人员核对。', V7_PREVIEW_DISABLED: '流程核对入口尚未开启，请联系维护人员核对。' };
const failureText = e => ({message:accountabilityFailureText(e)||codes[e.code]||e.serverMessage||e.message,code:e.code,status:e.status,findings:e.findings});
const readFailureTitle = (error,fallback) => error?.status===403?'当前身份不能查阅这份记录':fallback;
const label = value => statusNames[value] || businessStatus(value,'尚未形成');
function snapshot(detail) {
  const formal = detail?.formal_promotion;
  return JSON.stringify([detail?.case.id, detail?.case.current_revision_no, detail?.case.current_content_hash,
    formal?.draft?.id, formal?.draft?.revision_no, formal?.draft?.content_hash, formal?.draft?.status,
    formal?.review_task?.id, formal?.review_task?.status, formal?.review_task?.draft_revision_no, formal?.review_task?.content_hash,
    detail?.allowed_actions, detail?.formal_allowed_actions, detail?.formal_allowed_decisions,
    accountabilitySnapshot(formal?.department_accountability || detail?.department_accountability), formal?.department_confirmation]);
}
function JsonDetails({ title, value }) {
  const readable = { '任务原始记录（含修订与摘要）': '查阅本次负责人确认记录', '正式提升依据与修订绑定': '查阅正式草稿的来源与生成依据', '当前预览修订原文（不代表正式发布）': '查阅本次提交的流程内容' };
  return <details><summary>{readable[title] || title}</summary><BusinessDetails value={formalSourcePresentation(value)}/></details>;
}

export function FormalCheckLocations({checks,document,caseId,authoringEnabled,onLeave}) {
  const [selected,setSelected]=useState(''),[current,setCurrent]=useState(null);
  const heading=useRef(null);
  const issue=current===null?null:checks?.issues?.[current];
  const location=issue?formalIssueLocation(issue,document):null;
  useEffect(()=>{if(current!==null){heading.current?.scrollIntoView({block:'start'});heading.current?.focus({preventScroll:true});}},[current]);
  if(!checks?.issues?.length)return null;
  return <section data-formal-check-locations aria-labelledby="formal-check-locations-heading">
    <h3 id="formal-check-locations-heading">检查问题原文查阅</h3>
    <p>先选择需要核对的问题，再点击“查阅所选问题原文”。下方显示本次提交材料中对应的原文，不修改正文或办理意见。</p>
    <label>需要查阅的问题<select aria-label="需要查阅的问题" style={{maxWidth:'100%'}} value={selected} onChange={event=>setSelected(event.target.value)}>
      <option value="">请选择检查问题</option>{checks.issues.map((value,index)=><option key={index} value={index}>{formalIssueLabel(value)}</option>)}
    </select></label>
    <button type="button" disabled={selected===''} onClick={()=>{const index=Number(selected);if(current===index){heading.current?.scrollIntoView({block:'start'});heading.current?.focus({preventScroll:true});}else setCurrent(index);}}>查阅所选问题原文</button>
    {issue&&<article data-formal-check-location-result>
      <h4 ref={heading} tabIndex={-1}>{location?location.label:'当前材料无法准确定位本项'}</h4>
      <p>{formalIssueLabel(issue)}</p>
      {location?<BusinessDetails value={formalSourcePresentation(location.value)}/>:<p>原检查未提供可准确定位的对应内容，不能根据填写项序号猜测。请返回原案例，结合“流程内容”中的“{formalIssueBusinessPath(issue)}”核对原材料后重新检查。</p>}
    </article>}
    <p>正文由本流程已明确的编制人员修改；主对接人核对材料并提交。{authoringEnabled?'需要修改时，请返回原案例，点击“在3000继续编制本案例”，保存草稿并提交新修订。':'需要修改时，请在原编制文件中修订，再由有权人员向原案例上传修改后的编制文件。'}提交后，在同一案例的“流程预览与核对”查看重新检查和部门核对结果，再回到“流程正式流转”查看可办动作。</p>
    <a href={'/app/process-preview?case='+encodeURIComponent(caseId)} onClick={onLeave}>打开本案例核对材料与修订入口</a>
  </section>;
}

export function FormalCurrentChecks({checks,document,caseId,authoringEnabled,onLeave}) {
  return <ProcessChecks authoringEnabled={authoringEnabled} checks={checks} allowLocate={false}
    sourceLookup={checks?.issues?.length ? <FormalCheckLocations checks={checks} document={document} caseId={caseId} authoringEnabled={authoringEnabled} onLeave={onLeave}/> : null}/>;
}

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
        || !['process-governance-v9', 'process-governance-v8', 'process-governance-v7'].includes(content.schema_version)
        || content.schema_version !== draft.schema_version || content.document?.schema_version !== content.schema_version) {
        throw new Error('读取的流程正文与当前草稿不一致，请刷新正式办理状态后重新核对。');
      }
      if (download) {
        const nativeDocument = await api.request(root + '/export', { signal: controller.signal });
        if (token !== sequence.current) return;
        if (JSON.stringify(nativeDocument) !== JSON.stringify(content.document)) throw new Error('导出期间正文发生变化，已停止下载。请刷新正式办理状态后重新核对。');
        const url = URL.createObjectURL(new Blob([JSON.stringify(nativeDocument, null, 2)], { type: 'application/json;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url;
        link.download = businessFileName(content.document?.process?.process_name,'正式流程草稿','json');
        link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setState({ content, downloaded: download });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error }); }
  }
  return <section data-formal-content aria-labelledby="formal-content-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="formal-content-heading">正式草稿内容</h3>
    <p>{label(draft.status)}。下载草稿不代表部门负责人已确认或正式发布；已发布内容请在下方单独查阅。</p>
    <div className="import-actions"><button disabled={state.loading} onClick={() => read()}>核对正式草稿正文</button><button disabled={state.loading} onClick={() => read(true)}>下载正式草稿文件</button></div>
    {state.loading && <StatusPanel kind="loading" title="正在核对正式草稿正文…" />}
    {state.error && <StatusPanel kind="error" title="正式草稿正文暂不可用">{userMessage(state.error)} 未提交意见仍保留；不会自动重试下载。</StatusPanel>}
    {state.content && <div data-formal-content-result>
      <p role="status">已核对当前草稿内容。{state.downloaded ? '已将编制文件交给浏览器下载。' : ''}</p>


      <JsonDetails title="查看正式草稿内容" value={state.content.document} />
    </div>}
    <p className="muted">下载文件保留该草稿的完整内容，未提交的页面意见不会写入文件。下载文件由系统生成，与最初上传文件的字节内容可能不同。</p>
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
        || !Array.isArray(data.versions) || data.versions.some(row => String(row.document_id) !== String(documentId))) throw new Error('版本列表与当前制度档案不一致，请刷新核对。');
      setState({ rows: data.versions.filter(row => ['published', 'superseded'].includes(row.status) && ['process-governance-v9', 'process-governance-v8', 'process-governance-v7'].includes(row.schema_version)) });
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
        const link = document.createElement('a'); link.href = url; link.download = businessFileName(row.document_title||row.title,'所选流程正文','md'); link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setState({ rows: state.rows, content, downloaded: download });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ rows: state.rows, error }); }
  }
  return <section data-published-history aria-labelledby="published-history-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="published-history-heading">主档已发布版本查阅</h3>
    <p>列出这份制度已保存的流程发布版本，包括已被新版替代的记录。请按流程名称、制度版次和发布状态选择要查阅的版本；历史版本不代表当前有效制度，也不替换正在办理的草稿。</p>
    <button onClick={list} disabled={state.loading}>读取或刷新已发布版本列表</button>
    {state.loading && <StatusPanel kind="loading" title="正在读取已发布版本…" />}
    {state.error && <StatusPanel kind="error" title={readFailureTitle(state.error,'已发布版本暂不可用')}>{userMessage(state.error)} 读取未成功，不能据此判断是否有历史版本。</StatusPanel>}
    {state.rows && <>
      {!state.rows.length ? <p>这份制度尚无可查阅的流程发布版本。</p> : <>
        <label className="identity-field">已发布历史版本<select aria-label="已发布历史版本" value={selected} onChange={event => { begin(); setSelected(event.target.value); setState({ rows: state.rows }); }}>
          <option value="">请选择固定版本</option>{state.rows.map(row => <option key={row.id} value={row.id}>{row.document_title||row.title||'流程名称未记录'} · {row.edition||'制度版次未记录'} · {label(row.status)}</option>)}
        </select></label>
        <div className="import-actions"><button disabled={!selected || state.loading} onClick={() => read()}>核对所选历史正文</button><button disabled={!selected || state.loading} onClick={() => read(true)}>下载所选历史程序文件</button></div>
        {selected && state.rows.some(row => String(row.id) === selected) && <p>
          {['process', 'data'].map(mode => <ReactDiagramLink key={mode} versionId={selected} mode={mode} />)}
          <span className="muted">在新标签页读取所选固定版本，当前未提交意见保留。</span>
        </p>}
      </>}
    </>}
    {state.content && <div data-published-history-result>
      <p role="status">所选流程 · {label(state.content.status)} · 已核对内容一致性。{state.downloaded ? '已发起流程文件下载。' : ''}</p>

      <JsonDetails title="查看所选历史流程内容" value={state.content.document} />
    </div>}
    <p className="muted">查阅或下载不会提交、清除当前未提交的意见。本处只显示所选发布版本；如需核对其他草稿的办理过程，请查看上方历史记录。下载文件根据所选版本的正文生成，可能与最初上传的文件不同。</p>
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
          || !/^[1-9]\d*$/.test(row.id) || !['process-governance-v9', 'process-governance-v8', 'process-governance-v7'].includes(row.schema_version))) {
        throw new Error('历史草稿列表与当前主档不一致，请重新读取。');
      }
      setState({ data: result, cursor });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error, cursor }); }
  }
  return <section data-document-history aria-labelledby="document-history-heading" style={{ overflowWrap: 'anywhere' }}>
    <h3 id="document-history-heading">同一主档的历次草稿</h3>
    <p>每页最多显示20份当前身份有权查阅的流程草稿，包括未发布、需要修改和审核拒绝的记录。历史中未保存的内容无法在此查阅。</p>
    <button type="button" disabled={state.loading} onClick={() => load()}>读取或刷新制度草稿列表</button>
    {state.loading && <StatusPanel kind="loading" title="正在读取主档草稿…" />}
    {state.error && <StatusPanel kind="error" title={readFailureTitle(state.error,'主档草稿历史暂不可用')}>{userMessage(state.error)} 读取未成功，不能据此判断是否有历史。{state.error.status!==403&&<button onClick={() => load(state.cursor)}>重试本页草稿</button>}</StatusPanel>}
    {state.data && <>
      {!state.data.items.length && <p>本页没有可查阅的原生草稿。</p>}
      {state.data.items.length > 0 && <><label htmlFor="document-history-draft">选择历史草稿</label><select id="document-history-draft" value={selected} onChange={e => setSelected(e.target.value)}>
        <option value="">请选择草稿后读取其审核和操作记录</option>
        {state.data.items.map(row => <option key={row.id} value={row.id}>{businessName(row,'草稿名称未记录')} · {label(row.status)} · {businessDateTime(row.created_at)}</option>)}
      </select></>}
      <p role="status">本页 {state.data.items.length} 条。{state.data.next_cursor ? '仍有更早草稿。' : '已到当前可见范围的末页。'}新草稿需刷新首页后查看。</p>
      {state.cursor && <button onClick={() => load()}>返回最新草稿</button>}
      {state.data.next_cursor && <button onClick={() => load(state.data.next_cursor)}>读取更早草稿</button>}
      {selected && <FormalHistory key={selected} api={api} draftId={selected} documentId={documentId} />}
    </>}
    <p className="muted">查阅不会保存、清除或应用当前办理意见。此处无法恢复旧入口中的资料；每次办理也不一定保存当时的完整正文。</p>
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
  const show = value => value === undefined || value === null || value === '' ? '未记录' : businessText(value,'该条记录暂无法直接展示，请核对原材料。');
  const eventNames = { submitted: '提交正式材料', review_approve: '通过决定', review_needs_changes: '要求修改', review_reject: '拒绝决定', publish: '发布正式版本', formal_withdraw: '原提交人撤回', formal_return_for_changes: '退回修改' };
  return <section aria-label="所选草稿的审核和操作记录" data-formal-history style={{ overflowWrap: 'anywhere' }}>
    <h3>历次正式办理与操作记录</h3>
    <p>历史审核记录按原样保留，原办理人不因此被认定为当前部门负责人；是否需要负责人重新确认，以当前责任核验结果为准。</p>
    <p>下方展示这份正式草稿的历次办理记录。历史意见适用于当时提交的内容，请结合当前内容重新核对。</p>
    <button type="button" disabled={state.loading} onClick={read}>{state.loading ? '正在读取正式历史…' : '读取或刷新正式历史'}</button>
    {state.error && <StatusPanel kind="error" title={readFailureTitle(state.error,'正式历史暂不可用')}>{userMessage(state.error)} 读取未成功，不能据此判断是否有历史。</StatusPanel>}
    {state.data && <>
      <h4>历次审核任务（{state.data.reviews.length}条）</h4>
      {!state.data.reviews.length && <p>该正式草稿尚无审核任务记录。</p>}
      {state.data.reviews.map(row => <article key={row.id} data-formal-review={row.id}>
        <p><strong>审核 · {label(row.status)}</strong></p>

        <p>办理人员：{formalReviewName(row,state.data.events)} · 办理时间：{businessDateTime(row.decided_at)} · 创建时间：{businessDateTime(row.created_at)}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{show(row.decision_note)}</p>
      </article>)}
      <h4>正式操作事件（{state.data.events.length}条）</h4>
      {!state.data.events.length && <p>该正式草稿尚无操作事件记录。</p>}
      {state.data.events.map(row => <article key={row.id} data-formal-event={row.id}>
        <p><strong>{eventNames[row.event_type] || '历史操作'}</strong> · 办理人员：{formalHistoricalName(row)} · 时间：{businessDateTime(row.created_at)}</p>
        <p style={{ whiteSpace: 'pre-wrap' }}>{show(row.note)}</p>
        <JsonDetails title="查看本次操作依据" value={row.payload} />
      </article>)}
      <p className="muted">历史记录缺少人员姓名时标为“姓名未记录”。刷新历史后，上方未提交意见仍保留。</p>
    </>}
  </section>;
}

// The parent keeps this editor in memory across session expiry, bound to person and department.
export function ProcessFormal({ api, draft, setDraft, user, terminologyDraft, setTerminologyDraft, onNavigate }) {
  const [selected, setSelected] = useState(() => draft?.caseId || new URLSearchParams(location.search).get('case') || '');
  const [list, setList] = useState(null), [detail, setDetail] = useState(null), [version, setVersion] = useState(null);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [authoringEnabled, setAuthoringEnabled] = useState(false),[referenceRefresh,setReferenceRefresh]=useState(0);
  useEffect(() => { let current = true; api.request('/api/process-authoring/status').then(value => { if(current)setAuthoringEnabled(value.enabled === true); }).catch(() => {}); return () => { current = false; }; }, [api]);
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
      if (token === generation.current) { setDetail(data); setVersion(null);setReferenceRefresh(value=>value+1); }
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') { setError(failureText(e)); setDetail(null); } }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(selected); }, [selected]);
  const formal = detail?.formal_promotion, formalDraft = formal?.draft, task = formal?.review_task;
  const departmentAccountability = formal?.department_accountability || detail?.department_accountability;
  const accountabilityContext = formalAccountabilityContext(detail, user);
  const actions = detail?.formal_allowed_actions || [];
  const stale = Boolean(draft && detail && draft.snapshot !== snapshot(detail));
  const termGate=terminologyGate(error);
  const visibleChecks=formalReadOnlyChecks(detail?.content_checks,detail?.revision?.document);
  const prerequisites=formalPrerequisites(detail);
  function locateTermReview(){const heading=document.querySelector('[data-formal-draft-terminology] .terminology-references h3');heading?.scrollIntoView({block:'start'});heading?.focus({preventScroll:true});}
  function abandon() { return !currentDraft.current || window.confirm('当前有未提交输入，是否明确放弃？'); }
  function select(id) {
    if (String(id) === selected) return;
    if (busyRef.current || !abandon()) return;
    setDraft(null); setDetail(null); setVersion(null); setNotice(''); setSelected(String(id));
    const url = new URL(location.href); id ? url.searchParams.set('case', id) : url.searchParams.delete('case'); history.replaceState(history.state, '', url);
  }
  function start(kind) {
    if (busyRef.current || !detail || !abandon()) return;
    if (['review', 'return-for-changes'].includes(kind) && departmentAccountability?.eligible !== true) return;
    if (kind === 'publish' && formal?.department_confirmation?.valid !== true) return;
    const source = kind === 'promote' ? { revision: detail.case.current_revision_no, hash: detail.case.current_content_hash }
      : kind === 'review' ? { revision: task.draft_revision_no, hash: task.content_hash } : { revision: formalDraft.revision_no, hash: formalDraft.content_hash };
    setError(''); setNotice('');
    setDraft({ kind, caseId: String(detail.case.id), snapshot: snapshot(detail), dirty: true,
      expected_revision_no: source.revision, expected_content_hash: source.hash, draftId: formalDraft?.id, taskId: task?.id,
      mode: '', documentNo: '', documentTitle: '', existingNo: '', target: null, decision: '', note: '', problem:'',basis:'',revisionRequest:'' });
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
    if (['review', 'return-for-changes'].includes(input.kind) && departmentAccountability?.eligible !== true) return;
    if (input.kind === 'publish' && formal?.department_confirmation?.valid !== true) return;
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
        if (!input.decision || input.decision === 'approve' && !input.note.trim()) throw new Error('请选择部门负责人确认结论并填写依据。');
        if (input.decision !== 'approve' && (!input.problem.trim() || !input.basis.trim() || !input.revisionRequest.trim())) throw new Error('拒绝或需要修改须分别填写具体问题、判断依据及修改要求。');
        if (!detail.formal_allowed_decisions?.includes(input.decision)) throw new Error('当前结论已不可执行，请刷新状态并核对。');
        url = '/api/process-design/review-tasks/' + encodeURIComponent(input.taskId) + '/decision';
        body = { ...body, decision: input.decision, note: input.note.trim(), ...(input.decision !== 'approve' ? {review_evidence:{problem:input.problem.trim(),basis:input.basis.trim(),revision_request:input.revisionRequest.trim()}} : {}) };
      } else {
        url = '/api/process-design/drafts/' + encodeURIComponent(input.draftId) + '/' + input.kind;
        if (['withdraw', 'return-for-changes'].includes(input.kind)) {
          if (!input.note.trim()) throw new Error('请填写本次撤回或退回的原因。');
          const action = input.kind === 'withdraw' ? 'withdraw_formal_draft' : 'return_formal_draft';
          if (!detail.formal_allowed_actions?.includes(action)) throw new Error('当前恢复操作已不可执行，请刷新状态并核对。');
          body = { ...body, expected_review_task_id: input.taskId, note: input.note.trim() };
        }
      }
      const result = await api.request(url, { method: 'POST', body });
      if (token !== generation.current) return;
      setDraft(null); setNotice(input.kind === 'publish' ? '已发布正式流程，请查看已发布内容。' : operations[input.kind] + '已完成，请查看当前办理状态。');
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
        const link = document.createElement('a'); link.href = url; link.download = businessFileName(detail?.revision?.document?.process?.process_name,'流程正文','md'); link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else setVersion(result);
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const protectLink = e => { if (busyRef.current || !abandon()) e.preventDefault(); };
  return <div className="process-preview process-formal">
    <section className="card"><h2>按当前修订办理正式流转</h2>{authoringEnabled && onNavigate && selected && detail && <p><a href={'/app/process-authoring?case='+encodeURIComponent(selected)+'&case_revision='+encodeURIComponent(detail.case.current_revision_no)+'&case_hash='+encodeURIComponent(detail.case.current_content_hash)} onClick={event=>onNavigate(event,event.currentTarget.href)}>在3000从原案例继续编制</a></p>}<p>主对接人提交材料，参与部门负责人核对；形成正式草稿后，由归口部门负责人最终确认，再由有发布权限的人员发布。{authoringEnabled?'正式正文沿用已提交的固定修订；需要修改时，返回同一案例继续编制、保存并提交新修订，也可上传修改后的编制文件。':'正式正文沿用上传修订；需要修改时，返回同一案例上传3001修订。'}</p>
      <label>选择流程案例<select aria-label="选择流程案例" disabled={busy || loading} value={selected} onChange={e => select(e.target.value)}><option value="">请选择案例</option>{(list?.items || []).map(c => <option key={c.id} value={c.id}>{c.process_name}</option>)}</select></label>
      <div className="import-actions"><button disabled={busy || loading} onClick={() => load()}>刷新正式办理状态</button></div>
      {list && <p className="muted">当前返回{list.items?.length || 0}个可访问案例，最多显示200个。</p>}
      {list && !list.items?.length && <p>当前范围暂无案例。</p>}
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取正式办理状态…">未提交输入仍保留，等待状态核对后再操作。</StatusPanel>}
    {error && <StatusPanel kind="error" title={termGate?.title||(error.status===403?'当前身份不能办理或查阅本项内容':'操作未完成')} onRetry={busy||termGate||error.status===403 ? undefined : () => load()}>{termGate?<><p>{termGate.message}</p>{termGate.steps.length>0&&<ul>{termGate.steps.map(step=><li key={step}>{step}</li>)}</ul>}<button type="button" onClick={locateTermReview}>查看本草稿的术语核对</button></>:userMessage(error)}</StatusPanel>}
    {notice && <StatusPanel title="操作已完成">{notice}</StatusPanel>}
    {draft && <section className="card preview-editor"><h2 ref={editor} tabIndex={-1}>{operations[draft.kind]}</h2>
      <p>本次操作针对当前选定的流程内容，输入仅保留在当前页面。点击确认才会提交；刷新不会自动应用输入。</p>

      {stale && <StatusPanel kind="error" title="办理来源或状态已变化">输入保留，不能自动套用到新修订、负责人或确认任务。请复制所需内容，明确放弃后重新开始。</StatusPanel>}
      {!detail && !loading && <StatusPanel title="当前办理状态尚未核对">输入保留，读取成功前不能提交。</StatusPanel>}
      <form onSubmit={execute}><fieldset disabled={busy || loading}>
        {draft.kind === 'promote' && <>
          <label>正式草稿归属<select aria-label="正式承接方式" value={draft.mode} onChange={e => update({ mode: e.target.value, target: null })}><option value="">请选择</option><option value="create">新建流程档案</option><option value="existing">选择已有流程档案</option></select></label>
          {draft.mode === 'create' && <><label>新主档制度编号<input maxLength={128} value={draft.documentNo} onChange={e => update({ documentNo: e.target.value })} /></label><label>新主档制度名称<input maxLength={255} value={draft.documentTitle} onChange={e => update({ documentTitle: e.target.value })} /></label></>}
          {draft.mode === 'existing' && <><label>已有主档完整制度编号<input maxLength={128} value={draft.existingNo} onChange={e => update({ existingNo: e.target.value, target: null })} /></label><button type="button" disabled={stale} onClick={lookup}>精确查找已有主档</button>{draft.target && <StatusPanel title="已找到可承接主档">{draft.target.document_no} · {draft.target.document_title} · 请核对后确认承接。</StatusPanel>}</>}
          <p>同名不会自动合并。生成正式草稿，不表示部门负责人已经确认或发布。</p>
        </>}
        {draft.kind === 'review' && <><p>由归口部门负责人本人作出最终确认，系统记录办理身份及时间，不代录他人决定。</p><label>部门负责人确认结论<select aria-label="部门负责人确认结论" value={draft.decision} onChange={e => update({ decision: e.target.value })}><option value="">请选择</option>{[...new Set([...(detail?.formal_allowed_decisions || []), ...(draft.decision ? [draft.decision] : [])])].filter(v => decisions[v]).map(v => <option key={v} value={v} disabled={!detail?.formal_allowed_decisions?.includes(v)}>{decisions[v]}</option>)}</select></label>{draft.decision === 'approve' && <label>部门负责人确认依据<textarea aria-label="部门负责人确认依据" rows={4} maxLength={1000} value={draft.note} onChange={e => update({ note: e.target.value })} /></label>}</>}
        {draft.kind === 'submit' && <p>提交当前正式草稿，由归口部门负责人本人最终确认。此操作不会改变正文。</p>}
        {['withdraw', 'return-for-changes'].includes(draft.kind) && <>
          <p>{draft.kind === 'withdraw' ? '由原提交人撤回尚未办结的确认任务，正式草稿回到需要修改。' : '由归口部门负责人将已拒绝或已通过但未发布的正式草稿退回修改，保留原决定及依据。'} 后续必须重新提交负责人确认；{authoringEnabled?'需要修改正文时，在3000从原案例续修，保存并提交新修订后，再完成核对和提升。':'需要修改正文时，回3001修订后上传原案例，再完成核对和提升。'}</p>
          <label>撤回或退回原因<textarea aria-label="撤回或退回原因" rows={4} maxLength={1000} value={draft.note} onChange={e => update({ note: e.target.value })} /></label>
        </>}
        {draft.kind === 'review' && ['reject','needs_changes'].includes(draft.decision) && <><label>具体问题<textarea aria-label="具体问题" rows={3} maxLength={4000} value={draft.problem} onChange={e=>update({problem:e.target.value})}/></label><label>判断依据<textarea aria-label="判断依据" rows={3} maxLength={4000} value={draft.basis} onChange={e=>update({basis:e.target.value})}/></label><label>修改要求<textarea aria-label="修改要求" rows={3} maxLength={4000} value={draft.revisionRequest} onChange={e=>update({revisionRequest:e.target.value})}/></label></>}
        {draft.kind === 'publish' && <p>发布前须核验当前归口部门负责人对本修订的最终确认。发布生成固定平台流程版本；制度来源版次、拟议修订版次及企业批准生效分别记录，平台发布不自动推进制度版次，不代表企业制度已批准生效。下游继续引用各自绑定的版本，不自动创建工作包。</p>}
        <button className="primary" type="submit" disabled={stale || !detail || ['review', 'return-for-changes'].includes(draft.kind) && departmentAccountability?.eligible !== true || draft.kind === 'publish' && formal?.department_confirmation?.valid !== true}>{operations[draft.kind]}</button>
        <button type="button" onClick={() => { if (abandon()) { setDraft(null); setError(''); } }}>放弃本次输入</button>
      </fieldset></form>
    </section>}
    {detail && <section className="card"><div className="section-heading"><h2>{detail.case.process_name}</h2></div>
      <FormalCurrentChecks key={'check-locations-'+snapshot(detail)} checks={visibleChecks} document={detail.revision?.document} caseId={detail.case.id} authoringEnabled={authoringEnabled} onLeave={protectLink}/>
      <p>归口部门：{detail.case.owning_department_name || '待明确'} · 当前预览</p>

      <h3>当前任务与待处理事项</h3>
      {accountabilityContext.message ? <StatusPanel title={accountabilityContext.title}>{accountabilityContext.message}</StatusPanel> : <DepartmentAccountability value={accountabilityContext.value} title={accountabilityContext.title} />}
      {formalDraft?.status === 'approved' && formal?.department_confirmation?.valid !== true && <StatusPanel title="须由当前部门负责人重新确认">原通过记录仍保留，当前不能据此发布。请由当前部门负责人填写原因退回修改，主对接人重新提交后，再由负责人本人最终确认。</StatusPanel>}
      {!!prerequisites.length && <ul>{prerequisites.map((value,index)=><li key={index}>{value}</li>)}</ul>}
      {(detail.handling_summary?.return_reasons || []).map((r, i) => <StatusPanel key={i} title={'退回依据 · ' + businessText(r.department || '归口部门')}>{userMessage(r.reason,'退回依据暂无法直接展示，请核对原材料。')}</StatusPanel>)}
      <div className="import-actions">
        {detail.allowed_actions?.includes('promote_to_formal_draft') && <button disabled={busy || loading} onClick={() => start('promote')}>生成正式草稿</button>}
        {actions.includes('submit_formal_draft') && <button disabled={busy || loading} onClick={() => start('submit')}>提交负责人确认</button>}
        {actions.includes('review_formal_draft') && <button disabled={busy || loading || departmentAccountability?.eligible !== true} onClick={() => start('review')}>部门负责人最终确认</button>}
        {actions.includes('publish_formal_draft') && <button disabled={busy || loading || formal?.department_confirmation?.valid !== true} onClick={() => start('publish')}>发布正式版本</button>}
        {actions.includes('withdraw_formal_draft') && <button disabled={busy || loading} onClick={() => start('withdraw')}>撤回负责人确认</button>}
        {actions.includes('return_formal_draft') && <button disabled={busy || loading || departmentAccountability?.eligible !== true} onClick={() => start('return-for-changes')}>退回修改</button>}
      </div>
      {!detail.allowed_actions?.includes('promote_to_formal_draft') && !actions.some(v => ['submit_formal_draft', 'review_formal_draft', 'publish_formal_draft', 'withdraw_formal_draft', 'return_formal_draft'].includes(v)) && <p>{formalDraft?.status === 'published' && detail.handling_summary?.current_promotion ? '当前修订已发布，可在下方核对固定版本正文和下载程序文件。' : '当前身份或状态没有可执行的正式写入动作。请按上方事项完成核对或等待有权人员办理。'}</p>}
      <p><a href={'/app/process-preview?case=' + encodeURIComponent(detail.case.id)} onClick={protectLink}>返回本案例预览与修订</a></p>
      {formalDraft ? <><h3>正式草稿与确认记录</h3><dl className="identity-grid">
        <div><dt>主档</dt><dd>{formal.document.document_no} · {formal.document.document_title}</dd></div>
        <div><dt>草稿状态</dt><dd>{label(formalDraft.status)}</dd></div>
        <div><dt>确认任务</dt><dd>{task ? label(task.status) : '尚未提交负责人确认'}</dd></div>
      </dl>
        {task && <><p>任务原记录结果：{decisions[task.decision] || label(task.status)}；办理人员：{formalHistoricalName(task)==='历史姓名未记录'?'本处未提供当时姓名，请查看下方正式操作历史':formalHistoricalName(task)}；时间：{businessDateTime(task.decided_at || task.reviewed_at)}</p><p>{userMessage(task.decision_note,'尚无可展示的确认依据')}</p><p>历史任务结果与当前草稿状态分别保留；退回修改后须重新提交部门负责人确认。</p><JsonDetails title="任务原始记录（含修订与摘要）" value={task} /></>}
        <JsonDetails title="正式提升依据与修订绑定" value={formal.promotion} />
        <div data-formal-draft-terminology><TerminologyReferences api={api} user={user} subjectName={businessName(formalDraft,'草稿名称未记录')} refreshKey={referenceRefresh} subject={{target_type:'process_draft',target_id:String(formalDraft.id),source_digest:formalDraft.content_hash}} draft={terminologyDraft} setDraft={setTerminologyDraft}/></div>
        <FormalContent key={'content-' + snapshot(detail)} api={api} draft={formalDraft} />
        <FormalHistory key={snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
        <DocumentDraftHistory key={'document-' + snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
        <PublishedHistory key={'published-' + snapshot(detail)} api={api} draftId={formalDraft.id} documentId={formal.document.id} />
      </> : <StatusPanel title="尚未生成正式草稿">部门核对与范围条件满足后，由有权人员明确选择制度档案并生成正式草稿。</StatusPanel>}
      {formal?.current_version && <><TerminologyReferences api={api} user={user} subjectName={businessName(formal.current_version,'发布名称未记录')} refreshKey={referenceRefresh} subject={{target_type:'process_version',target_id:String(formal.current_version.id),source_digest:formal.current_version.content_hash}} draft={terminologyDraft} setDraft={setTerminologyDraft}/><h3>已发布固定版本</h3><p>{label(formal.current_version.status)}</p><p>这里显示已发布的流程正文；当前尚在核对的修改不会改变这份正文。</p>
        {actions.includes('read_formal_version') && <div className="import-actions"><button disabled={busy || loading} onClick={() => readVersion()}>核对已发布正文</button><button disabled={busy || loading} onClick={() => readVersion(true)}>下载程序文件（Markdown）</button></div>}
      </>}
      {version && <><StatusPanel kind={version.content_hash_verified ? 'empty' : 'error'} title={version.content_hash_verified ? '已核对已发布内容' : '已发布内容尚未核对通过'}>{version.content_hash_verified ? '已读取所选发布版本，并核对内容与保存记录一致；本次查阅不会修改正文或办理意见。' : '当前内容与保存记录尚未核对一致，请重试读取；确认前不要据此办理后续事项。'}</StatusPanel><JsonDetails title="查看已发布流程内容" value={version.document} /></>}
      <JsonDetails title="当前预览修订原文（不代表正式发布）" value={detail.revision.document} />
      <details><summary>案例操作历史（最多200条）</summary>{(detail.events || []).map((e, i) => <p key={e.id || i}>{businessDateTime(e.created_at)} · 办理人员：{formalHistoricalName(e)} · {userMessage(e.actor_department_name,'原部门名称未记录')} · {caseHistoryAction(e)} · {e.basis_text?userMessage(e.basis_text,'该条依据暂无法直接展示，请核对原材料。'):''}</p>)}</details>
    </section>}
  </div>;
}
