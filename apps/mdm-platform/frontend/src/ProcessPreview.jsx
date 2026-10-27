import {businessFileName} from './businessPresentation.js';
import {caseRevisionMaterialLabel,caseHistoryAction} from './caseHistoryPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import {formalHistoricalName} from './terminologyGovernanceModel.js';
import {userMessage} from './businessPresentation.js';
import {BusinessDetails} from "./BusinessDetails.jsx";
import {businessName,businessStatus,businessText} from "./businessPresentation.js";
import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { ProcessChecks } from './ProcessChecks.jsx';
import { CaseGovernance, isGovernanceDraft } from './CaseGovernance.jsx';
import {ProcessCaseControls,ProcessCaseHistory,CaseSubmissionFields,emptyCaseSubmission} from './ProcessCaseControls.jsx';
import { printDiagram } from './presentation/chartTheme.js';
import { DepartmentAccountability, accountabilityFailureText, accountabilitySnapshot } from './DepartmentAccountability.jsx';
import {ProcessReviewContent} from './ProcessReviewContent.jsx';
import './process-review-workspace.css';
import './process-authoring-entry.css';
import { modificationOpinion, reviewCaseLabel, reviewProgress, decisionContext } from './processReviewPresentation.js';
import {processIssuePresentation,processChecksPresentation} from './processActionGuidance.js';

const ROOT = '/api/process-v7-preview';
const labels = { pending: '待核对', confirmed: '已确认', needs_changes: '需要修改', pending_evidence: '待补证据', disputed: '存在分歧', pending_owner: '待分派归口', under_review: '核对中', needs_revision: '存在修改意见，查看当前修订', review_complete: '核对完成', closed: '已关闭', new: '新增', reopened: '重新核对', carried_forward: '沿用结论', action: '业务行为', decision: '判断节点', use: '使用', create: '创建', update: '更新', pending_confirmation: '待确认' };
const label = value => labels[value] || ({ draft: '正式草稿', submitted: '待部门负责人确认', approved: '已通过', rejected: '已拒绝', published: '已发布', waiting_my_action: '待办理', waiting_collaboration: '待协同', waiting_review: '待复核', completed: '已完成', not_in_scope: '不在当前范围' })[value] || businessStatus(value,'待确认');
function departmentStatus(item, party, detail) {
  const status = party === 'origin' ? item.origin_status : item.counterparty_status;
  if (modificationOpinion(detail, item, party) === 'inherited') return '待负责人重新核对（原意见：需要修改）';
  return status === 'confirmed' && item.department_confirmations?.[party]?.valid === false
    ? '历史已确认，须当前部门负责人重新核对' : label(status);
}
const recordLabels = { transfer: '编制转办', message: '协调留言', supplement_request: '补充要求', reminder: '催办', fact_note: '事实补充', problem_reply: '问题答复', governance_suggestion: '治理建议' };
const errors = { V7_PREVIEW_CONTENT_INVALID: '文件结构或引用不符合当前版本要求，请在流程编制器检查后重新保存或下载。', V7_PREVIEW_PROCESS_REF_MISMATCH: '文件属于另一流程，请返回列表新建案例。', V7_PREVIEW_OWNER_PENDING_REQUIRES_LEAD: '文件归口部门尚未明确，请由MDM工作组组长建立案例。', V7_PREVIEW_DISABLED: '流程预览与核对尚未开启。', V7_PREVIEW_CASE_EXISTS: '该流程已有案例，请在案例列表中选择后上传修订。' };
function failureText(error) { return accountabilityFailureText(error) || ({ V7_AUTHORING_ISSUE_MIGRATION_REQUIRED: '关联问题所需的存储结构尚未准备，请联系维护人员。', V7_AUTHORING_ISSUE_SOURCE_UNRESOLVED: '问题包含尚未明确归属本案例的来源，请由MDM工作组核对。', V7_AUTHORING_ISSUE_INTEGRITY_CONFLICT: '问题或固定来源校验失败，已停止本次操作，请联系MDM工作组。', V7_AUTHORING_ISSUE_REVISION_CONFLICT: '问题记录已变化，请核对最新问题后重新办理。当前输入仍保留。', V7_AUTHORING_ISSUE_SOURCE_CHANGED: '流程来源修订已变化，请先重新核对。当前输入仍保留。', V7_AUTHORING_ISSUE_TASK_CHANGED: '任务已变化或办结，请按最新分配办理。当前输入仍保留。', V7_AUTHORING_ISSUE_CLOSED: '案例或问题已关闭，请由有权人员核对后继续。', V7_AUTHORING_ISSUE_NOT_FOUND: '当前案例没有此关联问题，请核对所选案例。', V7_AUTHORING_ISSUE_TASK_LIMIT: '关联任务超过当前查阅上限，请由MDM工作组核对。', V7_AUTHORING_ISSUE_INPUT_INVALID: '答复内容或绑定信息不完整，请核对后重试。', V7_AUTHORING_TRANSFER_CLOSED: '编制已开始，不能再转办。请刷新核对当前归属。', V7_AUTHORING_COMPILER_REQUIRED: '本次操作须由当前编制者办理。草稿保存后，由归口主对接人提交；当前输入仍保留。', V7_AUTHORING_ASSIGNMENT_CHANGED: '编制归属已变化，请刷新核对。当前输入仍保留。', V7_AUTHORING_RECIPIENT_INVALID: '接收者须是本部门有效人员，管理员不能接收编制。', V7_AUTHORING_DISABLED: '编制归属功能尚未开启，已有归属不会因此恢复旧写权限。', V7_AUTHORING_IDEMPOTENCY_CONFLICT: '这次填写内容与上次办理不一致。请先核对已保存记录，再重新办理；当前输入仍保留。' })[error.code] || errors[error.code] || error.serverMessage || error.message; }
function JsonDetails({ title, value }) { return <details><summary>{title}</summary><BusinessDetails value={value}/></details>; }

let diagramAssets;
function loadDiagramAssets() {
  if (!diagramAssets) diagramAssets = (async () => {
    for (const [name, globalName] of [['cytoscape.min.js', 'cytoscape'], ['process-data-availability.js', 'ProcessDataAvailability'], ['process-diagram.js', 'ProcessDiagram'], ['data-relation-diagram.js', 'DataRelationDiagram']]) {
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
function Diagram({ documentData, revision, authoringEnabled }) {
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
      const picture = new Image(); picture.src = printDiagram(instance.current.cy, () => instance.current.cy.png({ full: true, scale: 1, bg: '#ffffff', maxWidth: 6000, maxHeight: 6000 }));
      await picture.decode();
      const output = document.createElement('canvas'); output.width = Math.max(1000, picture.width); output.height = picture.height + 100;
      const ctx = output.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, output.width, output.height);
      ctx.fillStyle = '#172b45'; ctx.font = 'bold 20px "Microsoft YaHei",sans-serif'; ctx.fillText(documentData.process.process_name, 24, 34, output.width - 48);
      ctx.font = '16px "Microsoft YaHei",sans-serif'; ctx.fillText('流程核对图 · 尚不代表正式发布', 24, 68, output.width - 48); ctx.drawImage(picture, 0, 100);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png')); if (!blob) throw new Error('图片生成失败，请重试。');
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = businessFileName(documentData.process?.process_name,'流程核对图','png'); a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } catch (e) { setError(e.message); } finally { setExporting(false); }
  }
  return <section className="preview-graph"><div className="import-actions">
    <label>图形视图<select aria-label="图形视图" value={mode} onChange={e => setMode(e.target.value)}><option value="process">流程图</option><option value="data">数据关系图</option></select></label>
    {mode === 'data' && <label>图中数据对象<select aria-label="图中数据对象" value={dataRef} onChange={e => setDataRef(e.target.value)}>{(documentData.data_objects || []).map(d => <option key={d.data_ref} value={d.data_ref}>{d.data_name}</option>)}</select></label>}
    <button onClick={() => instance.current?.fit()}>完整视图</button><button onClick={() => instance.current?.reset()}>清晰视图</button><button disabled={exporting || mode === 'data' && !dataRef} onClick={download}>下载图形PNG</button>
  </div>{error && <StatusPanel kind="error" title="图形加载未完成" onRetry={() => setRetry(v => v + 1)}>{userMessage(error)}</StatusPanel>}
    {mode === 'data' && !dataRef && <p>当前修订没有数据对象。</p>}
    <div className="preview-canvas" ref={canvas} aria-label="当前修订图形" />
    <p>点击节点查看原文；拖动空白处平移，滚轮缩放。{authoringEnabled?'需要修改内容时，进入本案例的编制草稿，保存并提交新修订。':'图形内容的修改仍在3001完成。'}</p>
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
      <JsonDetails title="查看环节内容" value={b} />
    </article>;
  })}<JsonDetails title="查看完整流程、表单与来源说明" value={source} /></>;
}

function downloadDraft(documentValue, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(documentValue, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a'); link.href = url; link.download = name;
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Draft lives above the authenticated view, in memory only, and is bound to identity/case/revision.
export function ProcessPreview({ api, draft, setDraft, onNavigate }) {
  const [list, setList] = useState(null), [detail, setDetail] = useState(null);
  const [historicalCase,setHistoricalCase]=useState(null);
  const [overview, setOverview] = useState(null), [overviewCursor, setOverviewCursor] = useState(''), [overviewTrail, setOverviewTrail] = useState([]);
  const [work, setWork] = useState(null), [workCursor, setWorkCursor] = useState(''), [workTrail, setWorkTrail] = useState([]);
  const [selected, setSelected] = useState(() => draft?.caseId || new URLSearchParams(location.search).get('case') || '');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [feature, setFeature] = useState(null);
  const [authoringFeature, setAuthoringFeature] = useState(null);
  useEffect(() => { let active = true; api.request('/api/process-authoring/status').then(value => { if(active)setAuthoringFeature(value); }).catch(() => {}); return () => { active = false; }; }, [api]);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [departments, setDepartments] = useState([]), [people, setPeople] = useState(null), [showDiagram, setShowDiagram] = useState(false);
  const [view,setView]=useState('review'),[selectedBehavior,setSelectedBehavior]=useState(''),[showSourceArchive,setShowSourceArchive]=useState(false);
  const generation = useRef(0), active = useRef(null), draftRef = useRef(draft), busyRef = useRef(false);
  const editor = useRef(null);
  draftRef.current = draft;
  useEffect(() => () => { ++generation.current; active.current?.abort(); }, []);
  useEffect(() => { if (draft?.kind) editor.current?.focus(); }, [draft?.kind, draft?.itemId]);
  async function load(id = selected) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current; setLoading(true); setError('');
    try {
      const status = await api.request(ROOT + '/status', { signal: controller.signal });
      if (token !== generation.current) return;
      setFeature(status);
      if (!status.enabled) { setList(null); setDetail(null); setHistoricalCase(null); setOverview(null); setWork(null); return; }
      const rows = await api.request(ROOT + '/cases?limit=200', { signal: controller.signal });
      const historical=(rows.items||[]).find(row=>String(row.id)===String(id)&&row.historical_only);
      const data = id&&!historical ? await api.request(ROOT + '/cases/' + encodeURIComponent(id), { signal: controller.signal }) : null;
      if (token !== generation.current) return;
      setList(rows); setDetail(data); setHistoricalCase(historical||null); setWork(null); setWorkCursor(''); setWorkTrail([]);
      setPeople(null);
      if (data?.authoring?.transfer_available) {
        const candidates = await api.request(ROOT + '/cases/' + encodeURIComponent(id) + '/authoring-candidates', { signal: controller.signal });
        if (token === generation.current) setPeople(candidates);
      }
      if (status.enabled) {
        const deps = await api.request('/api/org/departments', { signal: controller.signal });
        if (token === generation.current) setDepartments(deps);
      }
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') { setError(failureText(e)); setDetail(null); setHistoricalCase(null); } }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(selected); }, [selected]);
  async function loadOverview(cursor = '', trail = []) {
    if (busyRef.current) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const data = await api.request(ROOT + '/department-overview' + (cursor ? '?before=' + encodeURIComponent(cursor) : ''));
      if (token === generation.current) { setOverview(data); setOverviewCursor(cursor); setOverviewTrail(trail); }
    } catch (e) { if (token === generation.current) { setOverview(null); setError(failureText(e)); } }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function loadWork(cursor = '', trail = []) {
    if (busyRef.current || !selected) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const data = await api.request(ROOT + '/cases/' + encodeURIComponent(selected) + '/authoring-issues' + (cursor ? '?after=' + encodeURIComponent(cursor) : ''));
      if (token === generation.current) { setWork(data); setWorkCursor(cursor); setWorkTrail(trail); }
    } catch (e) { if (token === generation.current) { setWork(null); setError(failureText(e)); } }
    finally { busyRef.current = false; setBusy(false); }
  }
  function discard() { return !draftRef.current || window.confirm('当前有未提交输入，是否明确放弃？'); }
  function selectCase(id) {
    if (busyRef.current || !discard()) return;
    setDraft(null); setDetail(null); setHistoricalCase(null); setWork(null); setNotice(''); setShowDiagram(false); setSelected(String(id));
    const url = new URL(location.href); id ? url.searchParams.set('case', id) : url.searchParams.delete('case');
    history.replaceState(history.state, '', url);
  }
  function start(kind, item) {
    if (busyRef.current || !discard()) return;
    if (kind === 'decision' && (detail?.department_accountability?.eligible !== true || !item?.allowed_actions?.includes('record_department_decision'))) return;
    setError(''); setNotice('');
    if (kind === 'transfer' && draftRef.current) return; // visible edits must be explicitly discarded first
    setDraft({ kind, dirty: true, caseId: kind === 'create' ? '' : selected, itemId: item?.id, decision: '', basis: '', content: '', recipient_person_id: '', record_kind: kind === 'transfer' ? 'transfer' : kind === 'coordinate' ? 'message' : 'fact_note', request_key: crypto.randomUUID(), expected_assignment_version: detail?.authoring?.assignment_version, department_id: '', fileName: '', document: null, submission:emptyCaseSubmission(),
      expected_revision_no: detail?.case.current_revision_no, expected_content_hash: detail?.case.current_content_hash,
      ...(kind === 'decision' ? { expected_dispute_event_id: detail?.review_dispute_event_id || '0', accountability_snapshot: accountabilitySnapshot(detail?.department_accountability) } : {}),
      ...(kind === 'issueReply' ? { issue_id: item.issue_id, issue_title: item.title, expected_issue_revision: item.revision_no, expected_issue_digest: item.issue_digest,
        todo_id: item.task?.todo_id || null, expected_task_revision: item.task?.revision_no ?? null, work_cursor: workCursor } : {}) });
  }
  function update(values) { setDraft({ ...draftRef.current, ...values, dirty: true }); }
  async function checkDraft() {
    const current = draftRef.current;
    if (!current?.document || busyRef.current) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError('');
    try {
      const result = await api.request(ROOT + '/checks', { method: 'POST', body: { document: current.document } });
      if (token === generation.current && draftRef.current === current) update({ checks: result.content_checks });
    } catch (e) { if (token === generation.current) setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function readFile(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    if (draftRef.current?.fileName && !window.confirm('替换当前待上传文件？原文件不会被修改。')) return;
    const current = draftRef.current; const token = generation.current;
    busyRef.current = true; setBusy(true); setError('');
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('文件超过2MiB，请缩小内容后重试。');
      const document = JSON.parse(await file.text());
      if (!['process-governance-v9', 'process-governance-v8', 'process-governance-v7'].includes(document?.schema_version)) throw new Error('请选择V9或受支持的V8/V7流程文件，不支持其他版本的在线写入。');
      if (token === generation.current && draftRef.current === current) update({ fileName: file.name, document, comparison: null, checks: null, submission: {...(current.submission||emptyCaseSubmission()),purpose:current.submission?.purpose||document.process?.purpose||''} });
    } catch (e) { if (token === generation.current) setError(e instanceof SyntaxError ? '文件不是有效JSON，已保留原待上传内容。' : e.message); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const stale = draft?.caseId && detail && (String(detail.case.id) !== String(draft.caseId) || detail.case.current_revision_no !== draft.expected_revision_no || detail.case.current_content_hash !== draft.expected_content_hash || draft.expected_assignment_version != null && detail.authoring?.assignment_version !== draft.expected_assignment_version || draft.kind === 'decision' && (String(draft.expected_dispute_event_id || '0') !== String(detail.review_dispute_event_id || '0') || draft.accountability_snapshot !== accountabilitySnapshot(detail.department_accountability)));
  async function reconcile() {
    const current = draftRef.current; if (!current || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    const token = generation.current;
    try {
      const data = await api.request(ROOT + '/cases/' + encodeURIComponent(current.caseId));
      if (token !== generation.current || draftRef.current !== current) return;
      setDetail(data);
      let found = data.authoring?.records?.some(r => r.request_key === current.request_key);
      if (current.kind === 'issueReply') {
        const latest = await api.request(ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/authoring-issues' + (current.work_cursor ? '?after=' + encodeURIComponent(current.work_cursor) : ''));
        if (token !== generation.current || draftRef.current !== current) return;
        setWork(latest);
        found = latest.items.find(i => i.issue_id === current.issue_id)?.replies.some(r => r.reference.request_key === current.request_key && r.reference.todo_id === current.todo_id);
      }
      if (found) { setDraft(null); setNotice('已核对本次记录保存成功，请按当前编制归属继续。'); }
      else { update({ resultUnknown: false }); setNotice('最近的记录中尚未确认本次操作结果，填写内容仍保留。继续办理会核对原结果，可能完成原来尚未成功的操作；流程内容或归属变化时须重新核对。'); }
    } catch (e) { if (token === generation.current) setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); const current = draftRef.current;
    if (!current || busyRef.current || stale || current.resultUnknown) return;
    if (current.kind === 'decision' && (detail?.department_accountability?.eligible !== true || !detail.items?.find(item => String(item.id) === String(current.itemId))?.allowed_actions?.includes('record_department_decision'))) return;
    const token = generation.current; busyRef.current = true; setBusy(true); setError(''); setNotice('');
    let path, body = { expected_revision_no: current.expected_revision_no, expected_content_hash: current.expected_content_hash };
    try {
      if (['create', 'revision'].includes(current.kind)) {
        if (!current.document) throw new Error('请先选择流程编制文件。');
        body = { ...body, source_file_name: current.fileName, document: current.document, submission:current.submission,request_id:current.request_key };
        path = ROOT + '/cases' + (current.kind === 'revision' ? '/' + encodeURIComponent(current.caseId) + '/revisions' : '');
        if (current.kind === 'revision' && !current.comparison) {
          const result = await api.request(path + '/preview', { method: 'POST', body });
          if (token === generation.current) update({ comparison: result });
          return;
        }
      } else if (current.kind === 'issueReply') {
        if (!current.content.trim()) throw new Error('请填写问题答复。');
        body = { ...body, request_key: current.request_key, content: current.content, expected_assignment_version: current.expected_assignment_version,
          expected_issue_revision: current.expected_issue_revision, expected_issue_digest: current.expected_issue_digest,
          ...(current.todo_id ? { todo_id: current.todo_id, expected_task_revision: current.expected_task_revision } : {}) };
        path = ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/authoring-issues/' + encodeURIComponent(current.issue_id) + '/reply';
        update({ resultUnknown: true });
      } else if (['transfer', 'coordinate', 'author'].includes(current.kind)) {
        if (!current.content.trim() || current.kind === 'transfer' && !current.recipient_person_id) throw new Error('请填写内容，并在转办时明确选择接收编制者。');
        body = { ...body, expected_assignment_version: current.expected_assignment_version, request_key: current.request_key, record_kind: current.record_kind, content: current.content, ...(current.kind === 'transfer' ? { recipient_person_id: current.recipient_person_id } : {}) };
        path = ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/authoring-records';
        update({ resultUnknown: true });
      } else if (current.kind === 'owner') {
        if (!current.department_id) throw new Error('请选择当前有效归口部门。');
        path = ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/assign-owner'; body.department_id = Number(current.department_id);
      } else {
        if (!current.decision || !current.basis.trim()) throw new Error('请选择结果并填写核对依据。');
        path = current.kind === 'scope' ? ROOT + '/cases/' + encodeURIComponent(current.caseId) + '/scope-decision' : ROOT + '/items/' + encodeURIComponent(current.itemId) + '/decision';
        body = { ...body, decision: current.decision, basis: current.basis, ...(current.kind === 'decision' ? { expected_dispute_event_id: current.expected_dispute_event_id || '0' } : {}) };
      }
      const result = await api.request(path, { method: 'POST', body });
      if (token !== generation.current) return;
      setDraft(null); setNotice(current.kind === 'issueReply' ? (current.todo_id ? '答复已保存到原问题历史及关联任务记录。任务办结与问题复核需分别办理。' : '答复已保存到原问题历史。本次没有关联办公室任务，问题仍须有权人员复核。') : '已保存预览核对记录。正式材料仍须由归口部门负责人最终确认后发布。');
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
  }).map(issue=>processIssuePresentation(issue,detail?.revision?.document));
  const scopeOptions = [...(codes.has('ZERO_CROSS_DEPARTMENT_SCOPE_PENDING') ? [['confirmed_no_cross_department', '确认本修订不涉及跨部门']] : []), ...(codes.has('OWNING_DEPARTMENT_CHANGE_PENDING') ? [['keep_current_owner', '保留当前归口部门']] : [])];
  const listedCases = list?.items || [];
  const openedFromAssignment = Boolean(detail && String(detail.case.id) === String(selected) && !listedCases.some(row => String(row.id) === String(selected)));
  const visibleCases = openedFromAssignment ? [detail.case, ...listedCases] : listedCases;
  const progress = reviewProgress(detail);
  const selectedDecision = decisionContext(detail,draft?.itemId);
  return <div className="process-preview">
    <section className="card review-case-picker">
      <div className="import-actions"><button disabled={busy || loading} onClick={() => load()}>刷新案例与当前修订</button>{list?.allowed_actions?.includes('create_case') && <button disabled={busy || loading} onClick={() => start('create')}>新建流程预览案例</button>}</div>
      {feature?.enabled === false && <StatusPanel title="流程预览与核对尚未开启">请联系维护人员核对启用范围。{draft && '当前输入仍保留在页面中。'}</StatusPanel>}
      {feature?.enabled && <label>选择流程案例<select aria-label="选择流程案例" value={selected} disabled={busy || loading} onChange={e => selectCase(e.target.value)}><option value="">请选择案例</option>{visibleCases.map(c => <option key={c.id} value={c.id}>{c.process_name} · {c.historical_only?'历史记录，仅供查阅':reviewCaseLabel(c, detail, label)}</option>)}</select></label>}
      {list && !selected && <p>当前返回{list.items?.length || 0}条（最多200条）；待本部门办理{list.my_action_count || 0}项。</p>}
      {authoringFeature?.enabled && onNavigate && <div className="authoring-case-actions"><a href="/app/process-authoring" onClick={event=>onNavigate(event,'/app/process-authoring')}>打开流程编制与草稿</a>{selected&&detail&&<a href={'/app/process-authoring?case='+encodeURIComponent(selected)+'&case_revision='+encodeURIComponent(detail.case.current_revision_no)+'&case_hash='+encodeURIComponent(detail.case.current_content_hash)} onClick={event=>onNavigate(event,event.currentTarget.href)}>在3000继续编制本案例</a>}</div>}
      <details><summary>办理说明</summary><p>{authoringFeature?.enabled?'接收从编制草稿提交的流程材料，由有权主对接人提交、参与部门负责人核对本修订事实，再由归口部门负责人对正式材料最终确认。需要修改时可在3000打开原案例续修，也可下载编制文件，经AI对话编辑后重新上传核对。保存草稿、预览核对均不表示正式发布。':'接收主对接人上传的流程编制文件，由参与部门负责人核对本修订事实，再由归口部门负责人对正式材料最终确认。需要修改时回3001修订，再向原案例上传；预览核对不表示已正式发布。'}</p></details>
      {openedFromAssignment && <p>当前案例由责任或争议事项入口打开，已按当前身份核对查阅权限。</p>}
      {list?.items?.length === 0 && !detail && <p>当前范围暂无案例。有权限的人员可上传文件建立案例。</p>}
      {list?.allowed_actions?.includes('department_overview') && <button disabled={busy || loading} onClick={() => loadOverview()}>查看本部门流程全貌</button>}
    </section>
    {overview && <section className="card"><h2>本部门流程全貌</h2><p>按案例编号逐页查阅当前归口本部门的全部案例，包括他人上传的案例；每页20条，跨页不是同一数据库快照。选择案例后核对完整材料、待处理核对项、退回依据与交接记录。</p>
      <div className="analysis-table-wrap"><table><thead><tr><th>流程</th><th>编制者</th><th>进度</th><th>待核对项</th><th>退回依据</th><th>查阅</th></tr></thead><tbody>{overview.items.map(c => <tr key={c.id}><td>{c.process_name}</td><td>{c.compiler_name || '编制归属未确立'}</td><td> · 预览{reviewCaseLabel(c, detail, label)}；正式{c.formal_status ? label(c.formal_status) : '尚未提升'}</td><td>{c.pending_item_count}</td><td>{c.return_reason || '暂无正式退回记录'}</td><td><button disabled={busy || loading} onClick={() => selectCase(c.id)}>查看案例{businessName(c)}</button></td></tr>)}</tbody></table></div>
      {!overview.items.length && <p>本页暂无案例。</p>}<div className="import-actions"><button disabled={busy || !overviewTrail.length} onClick={() => loadOverview(overviewTrail.at(-1), overviewTrail.slice(0,-1))}>上一页部门流程</button><button disabled={busy || !overview.next_cursor} onClick={() => loadOverview(overview.next_cursor, [...overviewTrail, overviewCursor])}>下一页部门流程</button></div>
    </section>}
    {loading && <StatusPanel kind="loading" title="正在读取案例…">当前输入保留，读取完成后再办理。</StatusPanel>}
    {error && <StatusPanel kind="error" title="操作未完成">{userMessage(error)}</StatusPanel>}
    {notice && <StatusPanel title="保存完成">{notice}</StatusPanel>}
    {detail && !loading && progress?.awaitingRecheck && <StatusPanel title={progress.label}>案例 {businessName(detail.case)} 的 已提交。原核对意见和历史记录仍保留，请相应部门负责人核对本次修改后记录新的意见；重新提交不表示原意见已解决或审核通过。</StatusPanel>}
    {historicalCase&&!loading&&<ProcessCaseHistory key={historicalCase.id} api={api} caseRow={historicalCase}/>}
    {detail&&<><nav className="review-view-nav" aria-label="案例查阅视图">{[['review','本次核对'],['diagram','流程图'],['content','流程内容'],['records','责任与历史']].map(([key,title])=><button key={key} aria-pressed={view===key} disabled={Boolean(draft)||busy||loading} onClick={()=>setView(key)}>{title}</button>)}<span>案例{businessName(detail.case)} · {detail.case.owning_department_name||'归口待分派'}</span></nav>{draft&&<p className="review-edit-notice" role="status">当前有未结束的输入，请完成或明确放弃后切换视图。</p>}</>}
    {draft && !isGovernanceDraft(draft) && draft.kind !== 'case-control' && <section className="card preview-editor" ref={editor} tabIndex={-1}><h2>{{ create: '新建流程预览案例', revision: '上传新修订', decision: '本部门核对', owner: '分派归口部门', scope: '记录范围决定', transfer: '编制前转办', coordinate: '记录协调事项', author: '记录编制说明', issueReply: '答复关联治理问题' }[draft.kind]}</h2>
      <p>输入仅保留在当前页面内存中，提交成功前不会写入核对记录。</p>
      {draft.kind==='decision'&&<div className="review-confirm-context"><p>本次核对流程：《{detail?.case.process_name||'流程名称未记录'}》。</p><h3>{selectedDecision.title}</h3><p>归口部门：{selectedDecision.origin}；参与部门：{selectedDecision.target}。</p><p>所选事项的角色或责任说明：{selectedDecision.responsibility}</p><p>请就以上事项填写本部门结论和依据。保存后，在本页对应核对项查看本部门结果；另一部门仍须由其负责人本人核对。</p></div>}
      {stale && <StatusPanel kind="error" title="来源已变化，当前输入仍保留">请复制保留意见后明确放弃本次编辑，再按最新修订重新核对。系统不会把旧意见自动应用到新修订。</StatusPanel>}
      {draft.resultUnknown && <StatusPanel title="本次提交结果需核对">输入已保留。先读取当前记录核对结果，再决定是否重试。<button disabled={busy || loading} onClick={reconcile}>核对本次提交结果</button></StatusPanel>}
      {draft.kind === 'decision' && <DepartmentAccountability value={detail?.department_accountability} />}
      <form onSubmit={submit}><fieldset disabled={busy || loading || feature?.enabled !== true || Boolean(stale) || draft.resultUnknown || draft.kind === 'decision' && detail?.department_accountability?.eligible !== true}>
        {['create', 'revision'].includes(draft.kind) ? <><label>流程编制文件<input aria-label="流程编制文件" type="file" accept=".json,application/json" onChange={readFile} /></label><p>{draft.fileName || '尚未选择文件'} {businessName(draft.document)}</p>{draft.document && <><p>流程：{draft.document.process?.process_name}</p><CaseSubmissionFields value={draft.submission} onChange={submission=>update({submission})} departments={departments} behaviors={draft.document.behaviors||[]}/></>}{draft.document && <><div className="import-actions"><button type="button" onClick={checkDraft}>检查待上传草稿</button><button type="button" onClick={() => downloadDraft(draft.document, '待上传流程编制文件.json')}>下载待上传编制文件</button></div>{draft.checks && <ProcessChecks authoringEnabled={authoringFeature?.enabled} checks={draft.checks} allowLocate={false} />}</>}{draft.comparison && <><h3>新修订影响</h3><p>{Object.entries(draft.comparison.comparison?.counts || {}).map(([k, v]) => `${({ added:'新增', removed:'移除', reopened:'重新核对', carried_forward:'沿用' })[k] || k} ${v}项`).join('；')}</p><p>受影响部门：{draft.comparison.comparison?.affected_departments?.join('、') || '无新增影响部门'}</p><JsonDetails title="完整比较、提示与卡口" value={draft.comparison} /></>}</>
          : draft.kind === 'issueReply' ? <><p>问题{businessName(draft)}：{draft.issue_title}</p><label>问题答复<textarea aria-label="问题答复" required rows={4} maxLength={4000} value={draft.content} onChange={e => update({ content: e.target.value })} /></label><p>答复进入原问题历史，关联任务保留同一答复依据。保存答复不表示任务办结或问题关闭。</p></>
          : ['transfer', 'coordinate', 'author'].includes(draft.kind) ? <>
            {draft.kind === 'transfer' ? <><p>仅在首次成功编制保存或提交前转办。接收者只获得此流程的编制范围；未开通账号的人员不会自动开户。</p><label>接收编制者<select aria-label="接收编制者" required value={draft.recipient_person_id} onChange={e => update({ recipient_person_id: e.target.value })}><option value="">请选择本部门有效人员</option>{(people?.items || []).map(p => <option key={p.person_id} value={p.person_id}>{p.person_name} · {p.employee_no}{p.login_available ? '' : ' · 尚无有效登录账号'}</option>)}</select></label>{people?.truncated && <p>候选超过200人，本次仅返回前200人。</p>}</> : <label>记录类别<select aria-label="记录类别" value={draft.record_kind} onChange={e => update({ record_kind: e.target.value })}>{(draft.kind === 'coordinate' ? ['message', 'supplement_request', 'reminder'] : ['fact_note', 'problem_reply', 'governance_suggestion']).map(k => <option key={k} value={k}>{recordLabels[k]}</option>)}</select></label>}
            <label>{draft.kind === 'transfer' ? '交接依据' : '记录内容'}<textarea aria-label={draft.kind === 'transfer' ? '交接依据' : '记录内容'} required rows={4} maxLength={4000} value={draft.content} onChange={e => update({ content: e.target.value })} /></label>
            <p>独立记录保留当前修订与来源摘要。协调记录不改流程事实；编制说明不自动关闭正式问题或形成数据治理结论。</p>
          </> : draft.kind === 'owner' ? <label>归口部门<select aria-label="归口部门" value={draft.department_id} onChange={e => update({ department_id: e.target.value })} required><option value="">请选择</option>{departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
            : <><label>核对结果<select aria-label="核对结果" value={draft.decision} required onChange={e => update({ decision: e.target.value })}><option value="">请选择</option>{(draft.kind === 'scope' ? scopeOptions : ['confirmed', 'needs_changes', 'pending_evidence', 'disputed'].map(v => [v, label(v)])).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label><label>核对依据<textarea aria-label="核对依据" rows="4" required maxLength={4000} value={draft.basis} onChange={e => update({ basis: e.target.value })} /></label></>}
        <button type="submit" className="primary">{busy ? '正在处理…' : draft.kind === 'issueReply' ? '保存问题答复' : draft.kind === 'revision' ? draft.comparison ? '确认上传新修订' : '比较新修订影响' : '保存预览核对记录'}</button>
      </fieldset></form><button disabled={busy} onClick={() => { if (discard()) setDraft(null); }}>放弃本次编辑</button>
    </section>}
    {detail && selected && <div hidden={view!=='review'}><ProcessCaseControls key={`${detail.case.id}:${detail.case.current_revision_no}:${detail.case.current_content_hash}`} api={api} detail={detail} refreshKey={detail} draft={draft} setDraft={setDraft} disabled={busy||loading||!feature?.enabled} onBusyChange={value=>{busyRef.current=value;setBusy(value);}} onSaved={()=>load()}/></div> }
    {detail&&view==='review'&&detail.items?.length>0&&<section className="card">      <h3>跨部门核对项</h3><DepartmentAccountability value={detail.department_accountability} />{!detail.items?.length && <p>当前没有跨部门核对项，请同时检查范围卡口。</p>}
      {(detail.items || []).map(item => <article className="preview-item" key={item.id}><h4>{item.behavior_name}</h4><p>{item.origin_department_name}：{departmentStatus(item, 'origin', detail)}；{item.target_department_name}：{departmentStatus(item, 'counterparty', detail)}；{label(item.carry_state)}</p><p>归口部门依据：{item.origin_basis || '尚未记录'}</p><p>承接部门依据：{item.counterparty_basis || '尚未记录'}</p>{detail.revision.document.behaviors?.some(behavior=>behavior.behavior_ref===item.behavior_ref)?<a href={'#source-' + item.behavior_ref} onClick={e => { e.preventDefault(); if(draft)return;setSelectedBehavior(item.behavior_ref);setView('content'); }}>查看问题所在环节与数据依据</a>:<details><summary>查看此项参与部门责任及范围依据</summary><p>本项针对{businessText(item.target_department_name,'参与部门名称未记录')}提交的责任范围，不对应单一流程环节。</p><p>责任说明：{businessText(item.item_snapshot?.participant?.responsibilities,'原事项未记录责任说明')}</p><p>参与依据：{businessText(item.item_snapshot?.participant?.basis,'原事项未记录参与依据')}</p><p>涉及环节：{item.item_snapshot?.participant?.behavior_refs?.length?item.item_snapshot.participant.behavior_refs.map(ref=>detail.revision.document.behaviors?.find(behavior=>behavior.behavior_ref===ref)?.behavior_name||'原环节名称未记录').join('、'):'完整当前流程'}</p></details>}<JsonDetails title="核对项绑定的完整事实快照" value={item.item_snapshot} />{item.allowed_actions?.includes('record_department_decision') ? <button disabled={busy || detail.department_accountability?.eligible !== true} onClick={() => start('decision', item)}>记录本部门核对结果</button> : <p>当前身份只读，须由该参与部门负责人本人核对。</p>}</article>)}
</section>}
    {detail&&view==='review'&&blockers.some(issue=>!issue.code.startsWith('PROCESS_CASE_'))&&<section className="card"><h3>本修订还需处理的核对条件</h3><ul>{blockers.filter(issue=>!issue.code.startsWith('PROCESS_CASE_')).map((issue,index)=><li key={index}>{userMessage(issue.message)}{issue.fieldLocation&&<details><summary>查看问题所在填写项</summary><p>表单：{issue.fieldLocation.formName}；区域：{issue.fieldLocation.areaName}；填写项：{issue.fieldLocation.itemName}。</p><BusinessDetails value={issue.fieldLocation.item}/></details>}</li>)}</ul><ProcessChecks authoringEnabled={authoringFeature?.enabled} onLocate={ref=>{if(!draft){setSelectedBehavior(ref);setView('content');}}} checks={processChecksPresentation(detail.content_checks,detail.revision?.document)}/></section>}
    {detail&&view==='diagram'&&<section className="card"><h2>{detail.case.process_name}</h2><p className="muted">当前 · 原文只读</p><Diagram authoringEnabled={authoringFeature?.enabled} key={detail.case.current_content_hash} documentData={detail.revision.document} revision={detail.case.current_revision_no}/></section>}
    {detail&&view==='content'&&<ProcessReviewContent key={detail.case.current_content_hash} source={detail.revision.document} selectedBehavior={selectedBehavior} onBehaviorChange={setSelectedBehavior}/>}
    {selected&&detail&&(view==='records'||isGovernanceDraft(draft)) && <details className="review-responsibilities" open><summary>流程责任与争议办理</summary><CaseGovernance authoringEnabled={authoringFeature?.enabled} api={api} targetId={selected} sourceRevision={detail?.case.current_revision_no} sourceHash={detail?.case.current_content_hash} refreshKey={detail} draft={draft} setDraft={setDraft} disabled={busy || loading || !detail || !feature?.enabled} onBusyChange={value => { busyRef.current = value; setBusy(value); }} onSaved={() => load()} /></details>}
    {detail && !loading && view==='records' && <details className="card review-records" open><summary>修订检查、核对项与完整记录</summary><h2>{detail.case.process_name}</h2><p>{businessName(detail.revision.document)} · 当前 · {progress?.label || label(detail.case.status)}</p><p>归口部门：{detail.case.owning_department_name || '待分派'}；材料来源：{caseRevisionMaterialLabel(detail.revision,detail.case)}</p>
      <p>目的：{detail.revision.document.process.purpose || '待确认'}</p><p>范围：{detail.revision.document.process.scope || '待确认'}</p>
      {detail.authoring && <section><h3>编制归属与协调</h3>{detail.authoring.managed ? <>
        <p>当前编制者：{detail.authoring.compiler_name || '待主对接人指定'}；{detail.authoring.started_at ? '编制已开始，转办窗口已关闭' : '尚未成功保存编制内容'}。</p>
        <div className="import-actions">{actions.includes('transfer_authoring') && <button disabled={busy || Boolean(draft)} onClick={() => start('transfer')}>编制前转办</button>}{actions.includes('coordinate_authoring') && <button disabled={busy} onClick={() => start('coordinate')}>记录协调事项</button>}{actions.includes('record_authoring') && <button disabled={busy} onClick={() => start('author')}>记录编制说明</button>}</div>
        <p>关联问题的答复针对当时保存的问题及流程材料，只适用于当前所选流程内容和问题记录；答复不自动关闭问题。</p>
        <button disabled={busy || loading} onClick={() => loadWork()}>查看关联治理问题与任务</button>
        {work && <section><h3>关联治理问题与任务</h3><p>每页检查20条关联候选，仅显示固定流程证据全部属于本案例的问题。独立材料或跨流程来源须按原治理入口核对；本页已排除{work.excluded}条范围不明确的候选。跨页不是同一快照；每个问题最多展示200个任务和最近50条答复，历史保留。</p>
          {!work.items.length && <p>本页暂无可核对到本案例的问题。</p>}
          {work.items.map(i => <article className="preview-source" key={i.issue_id}><h4>问题{businessName(i)}：{i.title}</h4><p>状态：{label(i.status)}；问题。{!i.source_current && '来源修订已变化，请先由MDM工作组重新核对。'}</p>
            <details className="authoring-fixed-sources" open><summary>本问题的固定来源</summary>{(i.fixed_sources || []).map(s => <div key={s.source_id}><p>来源{businessName(s)} · {businessName(s)} · {s.source_kind === 'preview_revision' ? '当时提交的流程内容' : '已发布流程内容'}</p></div>)}{!i.fixed_sources?.length && <p>来源材料明细暂时无法读取，请刷新记录；仍无法读取时请联系维护人员。</p>}</details>
            {i.can_reply && <button disabled={busy} onClick={() => start('issueReply', i)}>答复问题{businessName(i)}</button>}
            {i.tasks.map(t => <div key={t.todo_id}><p>任务{businessName(t)} · 第{t.round_no}轮 · {t.status === 'done' ? '已办结' : '待办理'}：{t.instruction}</p>
              {i.can_reply && t.status === 'pending' && <button disabled={busy} onClick={() => start('issueReply', { ...i, task: t })}>答复任务{businessName(t)}</button>}
              <a href={'/app/offices?office_id=' + encodeURIComponent(t.office_id)} onClick={event => { if (busyRef.current || !discard()) event.preventDefault(); else setDraft(null); }}>前往办公室按分配办理任务{businessName(t)}</a></div>)}
            <details><summary>编制者答复历史</summary>{i.replies.map(r => <p key={r.event_id}>{businessDateTime(r.created_at)} · 此处未提供当时姓名 · {businessText(r.note,'答复说明暂无法直接展示，请查阅原材料')}</p>)}{!i.replies.length && <p>暂无编制者答复。</p>}</details>
          </article>)}
          <div className="import-actions"><button disabled={busy || !workTrail.length} onClick={() => loadWork(workTrail.at(-1), workTrail.slice(0, -1))}>上一页关联问题</button><button disabled={busy || !work.next_cursor} onClick={() => loadWork(work.next_cursor, [...workTrail, workCursor])}>下一页关联问题</button></div>
        </section>}
        {draft && actions.includes('transfer_authoring') && <p>当前有未提交输入，请先明确放弃本次编辑，再转办。</p>}
        <details><summary>交接、编制与协调记录</summary><p>最多显示最近{detail.authoring.record_limit}条；历史不删除。</p>{detail.authoring.records.map(r => <p key={r.id}>{businessDateTime(r.created_at)} · 此处未提供当时姓名 · {recordLabels[r.record_kind]||'编制办理记录'} · {businessText(r.content_text,'办理说明含技术内容，请查阅原材料')}</p>)}{!detail.authoring.records.length && <p>暂无记录。</p>}</details>
      </> : <p>此案例缺少已确立的编制归属历史，不能默认开放转办；原有记录与办理规则保留。</p>}</section>}
      <div className="import-actions">{actions.includes('upload_revision') && <button disabled={busy} onClick={() => start('revision')}>{authoringFeature?.enabled?'上传修改后的编制文件':'上传修改后的编制文件'}</button>}{actions.includes('assign_owner') && <button disabled={busy} onClick={() => start('owner')}>分派归口部门</button>}{actions.includes('record_scope_decision') && <button disabled={busy} onClick={() => start('scope')}>记录范围决定</button>}<button onClick={() => setShowDiagram(v => !v)}>{showDiagram ? '收起图形' : '查看本修订图形'}</button></div>
      <ProcessChecks authoringEnabled={authoringFeature?.enabled} onLocate={ref=>{if(!draft){setSelectedBehavior(ref);setView('content');}}} checks={processChecksPresentation(detail.content_checks,detail.revision?.document)} />
      <button onClick={() => downloadDraft(detail.revision.document, businessFileName(detail.revision.document.process?.process_name,'流程编制文件','json'))}>下载当前编制文件</button>
      <p>下载当前已保存修订，保留全部流程内容及已有数据关联；未提交意见仍保留在页面中。下载不代表部门负责人已完成核对或最终确认。</p>
      {!!blockers.length && <div className="status-panel"><strong>继续办理前需要解决的问题：{blockers.length}项</strong><p>编制缺项和执行部门卡口不能通过人工范围决定解除。请按上方检查修订；核对提示另见下方。</p><details><summary>查看全部问题</summary><ul>{blockers.map((v, i) => <li key={i}>{userMessage(v.message)} <small>{businessStatus(v.severity,'需要处理')}</small></li>)}</ul></details></div>}
      {detail.case.scope_decision && <p>已记录范围决定：{({ confirmed_no_cross_department: '本修订不涉及跨部门', keep_current_owner: '保留当前归口部门', accept_source_owner: '采用修订中的归口部门' })[detail.case.scope_decision] || '原范围决定说明未提供'}；依据：{businessText(detail.case.scope_decision_basis||'未提供','范围决定依据含技术内容，请查阅原材料')}</p>}
      {!!detail.warnings?.length && <details><summary>核对提示</summary><ul>{detail.warnings.map((w, i) => <li key={i}>{userMessage(w.message)}</li>)}</ul></details>}
      {showDiagram && <Diagram authoringEnabled={authoringFeature?.enabled} key={detail.case.current_content_hash} documentData={detail.revision.document} revision={detail.case.current_revision_no} />}
      <details onToggle={event=>setShowSourceArchive(event.currentTarget.open)}><summary>全部节点与数据依据</summary>{showSourceArchive&&<SourceContent source={detail.revision.document} />}</details>
      <details><summary>操作历史</summary>{(detail.events || []).map((e, i) => <p key={e.id || i}>{businessDateTime(e.created_at)} · {formalHistoricalName(e)} · {businessText(e.actor_department_name||'部门未提供','部门名称暂无法直接展示')} · {caseHistoryAction(e)} · {label(e.decision)} {businessText(e.basis_text,'办理依据含技术内容，请查阅原材料')}</p>)}{!detail.events?.length && <p>暂无操作记录。</p>}</details>
      <p><a href={'/app/process-formal?case=' + encodeURIComponent(detail.case.id)} onClick={e => { if (draft && !discard()) e.preventDefault(); }}>进入案例正式流转</a></p>
    </details>}
  </div>;
}
