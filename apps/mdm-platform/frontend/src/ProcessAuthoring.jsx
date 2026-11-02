import {userMessage} from './businessPresentation.js';
import {businessDateTime} from './businessGuidance.js';
import { useEffect, useRef, useState } from 'react';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import Workbench from '../../../structured-output-service/frontend/Workbench.jsx';
import { createWorkbenchController } from '../../../structured-output-service/frontend/controller.mjs';
import editorCss from '../../../structured-output-service/frontend/workbench.css?raw';
import { StatusPanel } from './components.jsx';
import { CaseSubmissionFields, emptyCaseSubmission } from './ProcessCaseControls.jsx';
import { loadAuthoringModules, scopedEditorCss } from './processAuthoringBridge.js';
import { acceptReceipt, authoringContentDirty, authoringDirty, authoringEntryPresentation, authoringMaterialsDirty, authoringError, createAuthoringClient, createAuthoringViewGuard, createEditorFetch, definiteRejection, fingerprint, prepareAttempt } from './processAuthoringModel.js';
import './process-authoring.css';
import { reviewProgress } from './processReviewPresentation.js';

const sharedCss = scopedEditorCss(editorCss);
const theme = { token: { colorPrimary: '#a44e3c', colorBgBase: '#f4edde', colorBgContainer: '#fcf6e9', colorText: '#40362f', colorTextSecondary: '#76695c', fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 14, borderRadius: 8 } };

export function ProcessAuthoring({ api, user, draft, setDraft, onNavigate }) {
  const retained = draft;
  draft = retained?.workspace || null;
  const [feature, setFeature] = useState(null), [list, setList] = useState(null), [departments, setDepartments] = useState([]);
  const [listState, setListState] = useState('loading');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [materialOpen, setMaterialOpen] = useState(false), [, refresh] = useState(0);
  const [caseSource, setCaseSource] = useState(retained?.continuation?.source || null);
  const draftRef = useRef(draft); draftRef.current = draft;
  const active = useRef(null), portal = useRef(null);
  const identity = useRef(''); identity.current = `${user.personId}:${user.departmentId}`;
  const viewGuard = useRef(null);
  if (!viewGuard.current) viewGuard.current = createAuthoringViewGuard({ getOwner: () => identity.current, getView: () => location.pathname + location.search });
  const caseRequest = useRef(retained?.continuation || null);
  const client = createAuthoringClient(api);
  const snapshot = draft?.controller?.getSnapshot(), record = draft?.record;
  const canEdit = !record || draft?.allowedActions?.includes('save');
  const caseSuffix = record?.case_id ? '?case=' + encodeURIComponent(record.case_id) : '';
  const previewTarget = '/app/process-preview' + caseSuffix, formalTarget = '/app/process-formal' + caseSuffix;
  const ownerName = departments.find(department => String(department.id) === String(record?.owning_department_id))?.name || '草稿归口部门';
  const dirty = authoringDirty(draft, snapshot);
  const contentDirty = authoringContentDirty(draft, snapshot), materialsDirty = authoringMaterialsDirty(draft);
  const caseId = new URLSearchParams(location.search).get('case');
  const notify = (workspace, { replace = false, stamp } = {}) => {
    workspace.dirty = authoringDirty(workspace);
    if (viewGuard.current.alive) draftRef.current = workspace;
    const continuation = caseRequest.current;
    setDraft(previous => (replace && viewGuard.current.current(stamp)) || previous?.workspace === workspace ? { workspace, continuation, owner: workspace.owner, dirty: workspace.dirty || Boolean(continuation) } : previous);
    if (viewGuard.current.alive) refresh(value => value + 1);
  };
  const retainContinuation = (stamp, request) => {
    const workspace = draftRef.current;
    setDraft(previous => viewGuard.current.current(stamp) || request?.id && previous?.continuation?.id === request.id
      ? { workspace: previous?.workspace || workspace, continuation: caseRequest.current, owner: stamp.owner, dirty: authoringDirty(previous?.workspace || workspace) || Boolean(caseRequest.current) } : previous);
    if (viewGuard.current.alive) refresh(value => value + 1);
  };
  useEffect(() => {
    const workspace = draftRef.current;
    if (!workspace?.controller) return;
    return workspace.controller.subscribe(() => notify(workspace));
  }, [draft?.controller]);
  useEffect(() => () => { viewGuard.current.invalidate(); active.current?.abort(); }, []);
  function beginViewOperation(lock = false) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    return { ...viewGuard.current.begin({ lock }), signal: controller.signal };
  }
  function finishViewOperation(stamp) {
    if(viewGuard.current.finish(stamp) && viewGuard.current.alive)setBusy(false);
  }
  async function refreshList(stamp) {
    try {
      const result = await client.list(stamp?.signal);
      if (!Array.isArray(result?.items)) throw new Error('草稿列表尚未读取完整，请刷新核对。');
      if (!stamp || viewGuard.current.current(stamp)) { setList(result); setListState('ready'); }
      return result;
    } catch (failure) {
      if (!stamp || viewGuard.current.current(stamp)) setListState('error');
      throw failure;
    }
  }
  async function load() {
    const stamp = beginViewOperation(); setError(''); setBusy(true); setListState('loading');
    let listRead = false;
    try {
      const status = await client.status(stamp.signal);
      if (!viewGuard.current.current(stamp)) return;
      setFeature(status);
      if (!status.enabled || !status.schema_ready) { setList(null); setListState('unavailable'); return; }
      const [rows, deps] = await Promise.all([client.list(stamp.signal), api.request('/api/org/departments', { signal: stamp.signal })]);
      if (!viewGuard.current.current(stamp)) return;
      if (!Array.isArray(rows?.items)) throw new Error('草稿列表尚未读取完整，请刷新核对。');
      setList(rows); setDepartments(deps); setListState('ready'); listRead = true;
      const query = new URLSearchParams(location.search), sourceId = query.get('case');
      if (sourceId) {
        if (query.has('case_revision') && query.has('case_hash')) setCaseSource({ revision_no: Number(query.get('case_revision')), content_hash: query.get('case_hash') });
        else {
          const detail = await api.request('/api/process-v7-preview/cases/' + encodeURIComponent(sourceId), { signal: stamp.signal });
          if (!viewGuard.current.current(stamp)) return;
          setCaseSource({ revision_no: detail.case.current_revision_no, content_hash: detail.case.current_content_hash });
        }
      }
      const id = new URLSearchParams(location.search).get('draft');
      if (id && !draftRef.current) {
        const result = await client.read(id, stamp.signal);
        if (viewGuard.current.current(stamp)) await mountWorkspace(result, stamp);
      }
    } catch (failure) { if (viewGuard.current.current(stamp) && failure.name !== 'AbortError') { if (!listRead) setListState('error'); setError(authoringError(failure)); } }
    finally { finishViewOperation(stamp); }
  }
  useEffect(() => { load(); }, []);
  function updateLocation(workspace, stamp) {
    if (!viewGuard.current.current(stamp)) return;
    const query = workspace.record?.id ? '?draft=' + encodeURIComponent(workspace.record.id) : '';
    history.replaceState(history.state, '', '/app/process-authoring' + query);
    stamp.view = location.pathname + location.search;
  }
  async function mountWorkspace(result = null, stamp) {
    if (!viewGuard.current.current(stamp)) return false;
    const old = draftRef.current, oldVersion = old?.controller?.getSnapshot().version;
    const oldSubmission = fingerprint(old?.submission);
    const modules = await loadAuthoringModules(), fetcher = createEditorFetch(api);
    if (!viewGuard.current.current(stamp)) return false;
    const [enums, schema, template] = await Promise.all([
      api.request('/api/process-authoring/editor/enums', { signal: stamp.signal }), api.request('/api/process-authoring/editor/schema', { signal: stamp.signal }),
      result?.draft ? Promise.resolve({ data: result.draft.document }) : api.request('/api/process-authoring/editor/template', { signal: stamp.signal })
    ]);
    if (!viewGuard.current.current(stamp)) return false;
    let workspace;
    const controller = createWorkbenchController({ modules, fetch: fetcher, template: template.data, enums, schema, initialDirty: !result?.draft,
      assertImportDocument: incoming => {
        const expected = workspace?.record?.document?.process?.process_ref;
        if (expected && incoming.process?.process_ref !== expected) throw new Error('此编制文件属于另一流程，不能替换原案例正文。请新建草稿导入，当前内容仍保留。');
      }
    });
    const initialized = await controller.dispatch({ type: 'init' });
    if (!viewGuard.current.current(stamp)) { controller.destroy(); return false; }
    if (!initialized.ok) { controller.destroy(); throw new Error(initialized.error || '编制器未能初始化，原输入仍保留。'); }
    if (draftRef.current !== old || old?.controller?.getSnapshot().version !== oldVersion || fingerprint(old?.submission) !== oldSubmission) {
      controller.destroy(); throw new Error('读取期间当前编制内容发生变化，已取消替换。原输入仍保留。');
    }
    workspace = { owner: `${user.personId}:${user.departmentId}`, controller, editorKey: crypto.randomUUID(), record: result?.draft || null,
      allowedActions: result?.allowed_actions || [], submission: structuredClone(result?.draft?.submission || emptyCaseSubmission()),
      savedDocument: result?.draft ? fingerprint(result.draft.document) : null,
      savedSubmission: fingerprint(result?.draft?.submission || emptyCaseSubmission()), attempt: null };
    const originalDispatch = controller.dispatch;
    workspace.editor = Object.freeze({ ...controller, dispatch: async action => {
      if (workspace.attempt && ['new', 'import', 'choose-import'].includes(action.type)) {
        setError('上次办理结果尚待核对，请先使用页面上的继续办理按钮核对结果；当前内容仍保留。'); return { ok: false };
      }
      if (action.type === 'import') {
        if (workspace.record) {
          let incoming; try { incoming = JSON.parse(action.text); } catch { /* The editor presents the original parse error. */ }
          if (incoming?.process?.process_ref && incoming.process.process_ref !== workspace.record.document.process.process_ref) {
            setError('此编制文件属于另一流程。请先保存当前工作，再新建草稿导入；原案例保持原流程标识。'); return { ok: false };
          }
        }
        if (authoringDirty(workspace) && !window.confirm('上传编制文件将替换当前编辑正文。尚未保存的正文和材料请先保存或下载留存；是否明确放弃未保存正文并继续导入？')) return { ok: false };
        action = { ...action, confirmedDiscard: true };
      }
      return originalDispatch(action);
    } });
    notify(workspace, { replace: true, stamp }); updateLocation(workspace, stamp); old?.controller?.destroy();
    return true;
  }
  function allowReplace() {
    const workspace = draftRef.current;
    if (workspace?.attempt || caseRequest.current) { setError('原请求结果尚待核对，不能替换当前草稿。请先使用页面上的继续办理按钮核对结果。'); return false; }
    return !authoringDirty(workspace) || window.confirm('当前草稿有未保存正文、未应用输入或提交材料。请先保存或下载留存；是否明确放弃这些输入并打开所选草稿？');
  }
  async function openWorkspace(id) {
    if (viewGuard.current.locked || !allowReplace()) return;
    const stamp = beginViewOperation(true);
    setBusy(true); setError(''); setNotice('');
    try { await mountWorkspace(id ? await client.read(id, stamp.signal) : null, stamp); }
    catch (failure) { if(viewGuard.current.current(stamp))setError(authoringError(failure)); }
    finally { finishViewOperation(stamp); }
  }
  async function continueCase() {
    if (viewGuard.current.locked || !caseId || !caseSource || !caseRequest.current && !allowReplace()) return;
    if (caseRequest.current && caseRequest.current.caseId !== caseId) { setError('原案例续修请求尚待核对，请先返回原案例入口按原请求重试。'); return; }
    const stamp = beginViewOperation(true);
    setBusy(true); setError('');
    try {
      if (!caseRequest.current || caseRequest.current.caseId !== caseId) caseRequest.current = { caseId, id: crypto.randomUUID(), source: { ...caseSource } };
      retainContinuation(stamp, caseRequest.current);
      const result = caseRequest.current.receipt || await client.fromCase(caseId, caseRequest.current.id, caseRequest.current.source);
      caseRequest.current.receipt = result; retainContinuation(stamp, caseRequest.current);
      if (!viewGuard.current.current(stamp) || !await mountWorkspace(result, stamp)) return;
      caseRequest.current = null;
      notify(draftRef.current);
      await refreshList(stamp).catch(() => {});
      if(viewGuard.current.current(stamp))setNotice('已从原案例读取编制草稿。提交仍绑定原案例及来源修订，现有审核记录保留。');
    } catch (failure) { const request=caseRequest.current; if (definiteRejection(failure)) caseRequest.current = null; retainContinuation(stamp, request); if(viewGuard.current.current(stamp))setError(authoringError(failure)); }
    finally { finishViewOperation(stamp); }
  }
  async function execute(attempt) {
    const workspace = draftRef.current;
    if (viewGuard.current.locked || !workspace) return;
    const stamp = beginViewOperation(true);
    setBusy(true); setError(''); setNotice('');
    workspace.attempt = attempt; notify(workspace);
    try {
      const receipt = await client.execute(attempt);
      acceptReceipt(workspace, attempt, receipt); notify(workspace);
      if (!viewGuard.current.current(stamp)) return;
      updateLocation(workspace, stamp);
      setNotice(attempt.kind === 'submit' ? reviewProgress(receipt.case_detail)?.awaitingRecheck ? '已提交，待负责人重新核对。原核对意见和历史记录保留，请进入原案例查看本次修订。' : '本次提交已接收，请进入原案例查看当前修订的核对与正式流转状态。' : authoringDirty(workspace) ? '请求中的草稿已保存。请求期间新增的输入仍保留，请继续应用并保存。' : '草稿已保存到3000，可以退出后重新打开继续编制。保存不代表提交或审核通过。');
      await refreshList(stamp).catch(() => { if(viewGuard.current.current(stamp))setNotice('本次操作已保存；列表暂未刷新，可稍后重试刷新列表。当前编制内容仍保留。'); });
    } catch (failure) {
      if (definiteRejection(failure)) workspace.attempt = null;
      else workspace.attempt = { ...attempt, uncertain: true };
      notify(workspace); if(viewGuard.current.current(stamp))setError(authoringError(failure));
    } finally { finishViewOperation(stamp); }
  }
  function saveOrSubmit(kind) {
    try { execute(prepareAttempt(draftRef.current, kind)); }
    catch (failure) { setError(authoringError(failure)); }
  }
  const enabled = feature?.enabled && feature.schema_ready;
  const entry = authoringEntryPresentation({ feature, list, listState, workspace: draft });
  return <div className="process-authoring" data-process-authoring data-authoring-list-state={listState} data-authoring-entry-state={entry.kind}>
    <style>{sharedCss}</style>
    <section className="card authoring-entry">
      <div className="import-actions"><button disabled={busy} onClick={load}>刷新草稿列表</button>{entry.canCreate && <button className="primary" disabled={busy} onClick={() => openWorkspace()}>新建编制草稿</button>}
        <a href={previewTarget} onClick={event => onNavigate(event, previewTarget)}>{record?.case_id?'查看本流程核对结果':'查看流程核对事项'}</a>
        <a href={formalTarget} onClick={event => onNavigate(event, formalTarget)}>{record?.case_id?'查看本流程正式办理结果':'查看正式确认与发布'}</a></div>
      {feature?.enabled === false && <StatusPanel title="流程编制尚未开启">此能力已准备为独立开关，当前环境未启用。请联系维护人员核对启用情况。</StatusPanel>}
      {feature?.enabled && !feature.schema_ready && <StatusPanel title="流程编制存储尚未准备">请由维护人员在获授权的环境准备存储；此页面不能直接启用编制。</StatusPanel>}
      {!feature && !error && <StatusPanel kind="loading" title="正在读取流程编制状态…" />}
      {enabled && <>{entry.title && <StatusPanel kind={entry.kind === 'loading' ? 'loading' : entry.kind === 'error' ? 'error' : undefined} title={entry.title}>{entry.description}</StatusPanel>}
        {entry.showSelector && <label>选择已保存编制草稿<select aria-label="选择已保存编制草稿" disabled={busy} value={record?.id || ''} onChange={event => event.target.value && openWorkspace(event.target.value)}><option value="">请选择已保存草稿</option>{list.items.map(item => <option key={item.id} value={item.id}>{item.process_name || item.document?.process?.process_name || '未命名流程'} · {businessDateTime(item.updated_at)}</option>)}</select></label>}
        {caseId && <div><p>当前是所选原流程的续修入口。由该流程当前有资格的主对接人或已明确的编制人员点击下方按钮；具体资格仍会再次核对。若已提交内容在读取后发生变化，本次续修会停止，并保留填写内容。保存后仍在本页继续编制，提交后到本流程核对结果查看。</p><button disabled={busy || !caseSource} onClick={continueCase}>从原案例继续编制</button></div>}
        {caseRequest.current && <StatusPanel title="原案例续修请求尚待核对">上次选定的流程内容及填写的材料已保留。请再次点击“从原案例继续编制”核对原请求；不会重新选择最新修订。</StatusPanel>}
        {entry.canUpload && <p className="muted">如需导回在流程知识库AI对话中修改的编制文件，请在下方编制器点击“文件”，选择上传草稿，核对替换内容后点击“保存草稿”。由当前有资格的主对接人提交，随后在“本流程核对结果”查看。平台不会自动连接AI，文件中的审核信息不构成3000的审核凭证。</p>}
        {draft && !canEdit && <p className="muted">当前草稿正文只读，不能上传文件替换。可点击“下载编制文件”主动留存；需要修改时，请由本流程已明确的编制人员打开同一草稿续修。</p>}</>}
    </section>
    {error && <StatusPanel kind="error" title="编制操作未完成">{userMessage(error)}</StatusPanel>}
    {notice && <StatusPanel title="操作结果">{notice}</StatusPanel>}
    {draft && <>
      <section className="card authoring-savebar">
        <div><strong>{record ? `已保存的编制草稿` : '新草稿尚未保存'}</strong><span aria-live="polite">{snapshot?.pending ? ' · 有未应用输入' : contentDirty ? ' · 正文有未保存修改' : materialsDirty ? ' · 正文已保存，本次材料待保存或提交' : ' · 当前内容已保存'}{record?.updated_at ? ` · 保存时间 ${businessDateTime(record.updated_at)}` : ''}</span></div>
        {record?.case_id && <p>已关联原流程；<a href={'/app/process-preview?case=' + encodeURIComponent(record.case_id)} onClick={event => onNavigate(event, event.currentTarget.href)}>查看核对、退回原因及历史记录</a></p>}
        <div className="import-actions"><button className="primary" disabled={busy || !enabled || !canEdit || Boolean(draft.attempt)} onClick={() => saveOrSubmit('save')}>保存草稿</button>
          <button disabled={busy || !enabled || !record || contentDirty || Boolean(draft.attempt) || !draft.allowedActions?.includes('submit')} onClick={() => saveOrSubmit('submit')}>提交当前草稿及本次材料</button>
          <button disabled={busy || !snapshot?.document} onClick={() => draft.editor.dispatch({ type: 'download' })}>下载编制文件</button>
          <button disabled={busy} onClick={() => setMaterialOpen(value => !value)}>{materialOpen ? '收起提交材料' : '编辑提交材料'}</button>
          {record && <button disabled={busy || Boolean(draft.attempt)} onClick={() => openWorkspace(record.id)}>重新打开已保存草稿</button>}</div>
        {draft.attempt && <StatusPanel title="原请求结果尚待核对">填写的内容已保留。再次办理会核对原结果；此前尚未成功时，本次可能完成保存或提交。<button disabled={busy} onClick={() => execute(draft.attempt)}>{draft.attempt.kind==='save'?'继续保存并核对结果':'继续提交并核对结果'}</button></StatusPanel>}
        {record&&canEdit&&!draft.allowedActions?.includes('submit')&&<p role="status">你负责本份草稿《{snapshot?.document?.process?.process_name||'未命名流程'}》的编制和保存，没有本次提交资格。保存后，请将流程名称及草稿保存时间交给{ownerName}当前有效的主对接人，由其在“流程编制与草稿”打开这份草稿、核对材料并提交；提交后在“本流程核对结果”查看后续办理。</p>}
        {!canEdit && <p>正文由已明确的编制人员修改；当前身份能否补充材料或提交，以本页提供的操作为准。</p>}
        {materialOpen && <div className="authoring-materials"><fieldset disabled={!enabled || !canEdit && !draft.allowedActions?.includes('submit') || Boolean(draft.attempt?.uncertain)}><CaseSubmissionFields value={draft.submission} departments={departments} behaviors={snapshot?.document?.behaviors || []} onChange={submission => { const workspace = draftRef.current; workspace.submission = submission; notify(workspace); }} /></fieldset></div>}
      </section>
      <p className="muted">流程图中的“创”“更”“用”分别统计该环节创建、更新、使用数据的关联条数，“?”表示待确认条数。选择环节，在详情中的数据对象及关联中核对对应内容。</p>
      <div className="process-authoring-editor" ref={portal}>
        <ConfigProvider locale={zhCN} theme={theme} getPopupContainer={() => portal.current || document.body} getTargetContainer={() => portal.current || document.body}>
          <div inert={!canEdit || !enabled || Boolean(draft.attempt?.uncertain)}><Workbench key={draft.editorKey} controller={draft.editor} integration={{ serverPersistence: true, dirty, status: snapshot?.pending ? '有未应用输入' : dirty ? '有未保存修改' : '当前内容已保存', popupContainer: () => portal.current }} /></div>
        </ConfigProvider>
      </div>
    </>}
  </div>;
}
