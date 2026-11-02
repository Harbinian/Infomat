import {businessEvidence} from './businessPresentation.js';
import {userMessage} from './businessPresentation.js';
import {BusinessRecordPicker} from "./BusinessDetails.jsx";
import {businessName,businessStatus,businessText} from "./businessPresentation.js";
import {TerminologyReferences} from './TerminologyReferences.jsx';
import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { CaseGovernance, isGovernanceDraft } from './CaseGovernance.jsx';
import { tracksNativeRequest, requestUnresolved, canRetryNativeRequest, nativeWrite, beginNativeRequest, editNativeDraft, observeNativeReceipt, nativeSuccessText } from './nativeGovernanceRequest.js';
import {handoffWorkspaceHref} from './handoffNavigation.js';
import {HandoffPackageProgress} from './HandoffPackageProgress.jsx';
import {businessDateTime} from './businessGuidance.js';
import {governanceDetailName,historicalGovernanceActor} from './handoffGovernancePresentation.js';

const ROOT = '/api/process-data-governance';
const names = { mdm_preparing:'待MDM准备', mdm_governing:'MDM治理中', waiting_business_fact:'等待业务事实', mdm_review:'待MDM审核', completed:'已完成', source_withdrawn:'来源已撤回', pending:'待MDM判断', needs_business_fact:'待补充业务事实', confirmed:'已确认', not_applicable:'不适用', terminated:'已终止', open:'待部门答复', answered:'已答复待MDM核对', closed:'已关闭', cancelled:'已取消', data_object_identity:'对象身份', critical_field:'关键字段', data_flow:'数据流', lifecycle_rule:'生命周期规则', approved:'通过', rejected:'退回' };
const actionNames = { create:'建立工作包', generate:'生成待核对明细', decide:'记录治理结论', ask:'向业务部门提问', answer:'答复业务事实', close:'核对并关闭问题', complete:'完成工作包审核' };
const actions = { create:'reconcile', generate:'generate_candidates', decide:'decide_detail', ask:'request_business_fact', answer:'answer_targeted_business_fact', close:'close_business_fact', complete:'complete_work_package' };
const reasonNames = { source_data_object:'流程已声明数据对象', declared_field:'流程已声明字段', identifier_object:'对象用于标识', used_by_multiple_behaviors:'多个行为使用该对象', has_declared_source_relation:'已声明来源关系', no_declared_field:'尚未声明字段', declared_behavior_link:'已声明数据与行为关系', no_declared_behavior_link:'尚未声明数据与行为关系', source_high_risk_flag:'来源标注高风险', irreversible_action:'包含不可逆动作', all_records_scope:'涉及全部记录', no_declared_lifecycle_event:'尚未声明生命周期事件', no_declared_data_object:'尚未声明数据对象' };
const operationNames = { create:'创建', read:'读取', use:'使用', update:'更新', delete:'删除', archive:'归档', destroy:'销毁', retain:'保留', transfer:'传递' };
const label = v => names[v] || businessStatus(v,'办理状态待核对');
const operation = v => operationNames[v] || businessStatus(v,'使用方式待核对');
const failures = {
  TERM_GOVERNANCE_USAGE_REVIEW_REQUIRED:'本工作包的术语引用核对尚未完成。请先点击“核对本次办理结果”，再明确结束本次办理；随后在“术语引用核对”中点击“记录术语引用判断”并保存核对结果，再重新发起完成工作包审核。',
  PROCESS_DATA_GOVERNANCE_REVIEW_BLOCKED:'仍有待判断明细或未关闭的事实问题，请逐项核对后再完成审核。',
  PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED:'固定来源的内容或摘要已变化，不能继续写入。请联系维护人员核对固定来源，勿将旧输入套用到其他版本。',
  PROCESS_DATA_GOVERNANCE_SOURCE_UNREADABLE:'固定来源内容无法读取，请核对来源后重试。',
  PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED:'来源已撤回或不再是已发布版本，当前不能继续办理。',
  PROCESS_DATA_GOVERNANCE_READ_ONLY:'当前仅供成果查阅，工作包办理已关闭。',
  PROCESS_DATA_GOVERNANCE_FACT_NOT_OPEN:'该事实问题已不处于待答复状态，请刷新核对。',
  PROCESS_DATA_GOVERNANCE_FACT_NOT_ANSWERED:'业务部门尚未答复，不能关闭事实问题。',
  PROCESS_DATA_GOVERNANCE_DETAIL_HAS_OPEN_FACT:'该明细仍有未关闭的事实问题，请先核对并关闭。',
  HANDOFF_COMMIT_UNKNOWN:'提交结果尚未确认，请点击“核对本次办理结果”，查看本次操作是否已完成。',
  HANDOFF_BUSY:'本次办理结果仍需核对，请先核对结果；待页面允许继续后，使用已保留的内容继续办理。',
  HANDOFF_REQUEST_PAYLOAD_CONFLICT:'本次内容与先前提交的内容不一致。原输入仍保留，请联系维护人员核对办理结果。',
  PROCESS_DATA_GOVERNANCE_PACKAGE_MDM_CONTEXT_ONLY:'业务部门只查看发给本部门的具体事实问题，请返回待办选择。'
};
const failureText = e => failures[e.code] || e.message;
const detailName = governanceDetailName;
function sourceText(row = {}) {
  const s = row.source || {};
  if (s.missing_data_scope) return '固定版本没有声明数据对象，需要MDM核对适用范围，必要时向业务部门询问具体事实。';
  if (s.missing_field_scope) return `对象“${s.data_name || '对象名称未记录'}”未声明字段。`;
  if (s.missing_data_flow_scope) return `对象“${s.data_name || '对象名称未记录'}”未声明创建、更新或使用关系。`;
  if (s.missing_lifecycle_scope) return `对象“${s.data_name || '对象名称未记录'}”未声明生命周期事件。`;
  return [s.data_name || '对象名称未记录', s.field_name || '', s.description || (typeof s.definition==='string'?s.definition:s.definition?.business_meaning||s.definition?.name), s.behavior_name || '', s.action && operation(s.action), s.operations?.map(operation).join('、'), s.route_label || '', s.exception_handling].filter(Boolean).join('；') || '已发布的流程材料';
}
function candidateText(row) {
  const c = row.candidate || {};
  return [(c.reason_codes || c.high_risk_reason_codes || []).map(v => reasonNames[v] || '需要人工核对').join('；'), c.action && operation(c.action), c.operation_codes?.map(operation).join('、'), c.match_suggestions?.length ? '待定匹配：' + c.match_suggestions.map(v => `${v.object_name || '对象名称未记录'}`).join('；') : row.detail_type === 'data_object_identity' ? '未发现稳定标识或名称完全一致的匹配建议' : '', '系统未自动确认'].filter(Boolean).join('；');
}
const binding = data => data?.package ? JSON.stringify([data.package.id, data.package.process_version_id, data.package.source_content_hash, data.package.rule_version, data.package.revision_no, data.package.status, data.fact_request?.status]) : '';
function routeSelection() { const q = new URLSearchParams(location.search); return q.get('factRequest') ? { kind:'fact', id:q.get('factRequest') } : q.get('package') ? { kind:'package', id:q.get('package') } : { kind:'', id:'' }; }

export function DataGovernance({ api, draft, setDraft, onNavigate, user, terminologyDraft, setTerminologyDraft }) {
  const [selection, setSelection] = useState(() => draft?.selection || routeSelection());
  const [workbench, setWorkbench] = useState(null), [detail, setDetail] = useState(null), [departments, setDepartments] = useState([]);
  const [selectedId, setSelectedId] = useState(draft?.detailId || ''), [mode, setMode] = useState('todo');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(null), generation = useRef(0), busyRef = useRef(false), draftRef = useRef(draft), editor = useRef(null);
  draftRef.current = draft;
  useEffect(() => () => { ++generation.current; active.current?.abort(); }, []);
  useEffect(() => { if (draft?.kind) editor.current?.focus(); }, [draft?.kind]);
  async function load(target = selection, nextMode = mode) {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current; setLoading(true); setError(''); setDetail(null); setWorkbench(null); setDepartments([]);
    try {
      const feature = await api.request(ROOT + '/status', { signal:controller.signal });
      if (token !== generation.current) return;
      if (!feature.enabled) { setWorkbench({ feature }); return; }
      const bench = await api.request(ROOT + '/workbench?mode=' + nextMode, { signal:controller.signal });
      if (token !== generation.current) return;
      setWorkbench({ ...bench, feature });
      if (target.id) {
        const data = await api.request(ROOT + (target.kind === 'fact' ? '/fact-requests/' : '/work-packages/') + encodeURIComponent(target.id), { signal:controller.signal });
        if (token !== generation.current) return;
        setDetail(data);
        setSelectedId(previous => (data.details || []).some(row => String(row.id) === String(previous)) ? previous : String(data.details?.[0]?.id || ''));
      }
      if (bench.allowed_actions?.includes('reconcile') && !feature.read_only) {
        const rows = await api.request('/api/org/departments', { signal:controller.signal });
        if (token === generation.current) setDepartments(Array.isArray(rows) ? rows : rows.departments || []);
      }
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(selection, mode); }, [selection.kind, selection.id, mode]);
  const feature = workbench?.feature;
  const row = detail?.details?.find(v => String(v.id) === String(selectedId));
  const can = kind => Boolean(feature?.enabled && !feature.read_only && (kind === 'create' ? workbench : detail)?.allowed_actions?.includes(actions[kind]) && (kind === 'create' || detail?.package?.status !== 'completed'));
  const stale = Boolean(draft && draft.kind !== 'create' && detail && draft.binding !== binding(detail));
  const unavailable = !workbench || !feature?.enabled || feature?.read_only || (draft && !can(draft.kind));
  function abandon() { const current = draftRef.current; return !current || window.confirm(requestUnresolved(current) ? '本次提交结果尚待核对。放弃填写内容不会撤销已提交的操作，请先核对办理记录。仍要放弃当前输入？' : '当前有未提交输入，是否明确放弃？'); }
  function choose(kind, id = '') {
    if (busyRef.current || !abandon()) return;
    setDraft(null); setDetail(null); setNotice(''); setSelectedId(''); setSelection({ kind, id:String(id) });
    const url = new URL(location.href); url.searchParams.delete('package'); url.searchParams.delete('factRequest');
    if (id) url.searchParams.set(kind === 'fact' ? 'factRequest' : 'package', id);
    history.replaceState(history.state, '', url);
  }
  function start(kind, factId) {
    if (busyRef.current || loading || !can(kind) || !abandon()) return;
    setError(''); setNotice('');
    const g = row?.governance || {};
    setDraft({ kind, selection, binding:binding(detail), expected_revision:detail?.package.revision_no, packageId:detail?.package.id, detailId:row?.id, factId:factId || detail?.fact_request?.id, dirty:true,
      versionId:'', status:row?.status === 'needs_business_fact' ? 'pending' : row?.status || 'pending', conclusion:g.conclusion || '', unified:g.unified_object_id || '', department:row?.responsible_department_id || '', basis:kind === 'decide' ? g.basis || '' : '', target:'', factType:'', question:'', reason:'', answer:'', evidence:'' });
  }
  function retain(value) { draftRef.current = value; setDraft(value); }
  function update(key, value) { retain(editNativeDraft(draftRef.current, key, value)); }
  async function saved(input, result) {
    retain(null); setNotice(tracksNativeRequest(input.kind) ? nativeSuccessText(result) : result.idempotent ? '本次操作已完成，已返回原记录，没有重复创建。' : '本次操作已完成。');
    if (input.kind === 'create') {
      const next = { kind:'package', id:String(result.package.id) }; setSelection(next);
      const url = new URL(location.href); url.searchParams.delete('factRequest'); url.searchParams.set('package', next.id); history.replaceState(history.state, '', url);
    } else await load(selection);
  }
  async function queryReceipt() {
    const current = draftRef.current;
    if (!current?.request || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); const token = generation.current;
    try {
      const receipt = await api.request('/api/data-map-handoffs/requests/' + encodeURIComponent(current.request.request_id));
      if (token !== generation.current) return;
      retain(observeNativeReceipt(current, receipt));
    } catch (e) { if (token === generation.current) setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function acknowledgeReceipt() {
    const current = draftRef.current;
    if (current?.request?.phase !== 'committed' || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await saved(current, current.request.result); }
    finally { busyRef.current = false; setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); const input = draftRef.current;
    const retry = canRetryNativeRequest(input);
    if (!input || busyRef.current || (!retry && (loading || stale || unavailable)) || (requestUnresolved(input) && !retry)) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); const token = generation.current;
    try {
      const attempt = tracksNativeRequest(input.kind) ? beginNativeRequest(input) : input;
      if (attempt.request) retain(attempt);
      const {url, method, body} = attempt.request || nativeWrite(attempt);
      const result = await api.request(url, { method, body });
      if (token !== generation.current) return;
      if (attempt.request && result.request_id !== attempt.request.request_id) throw new Error('返回结果尚不能与本次办理对应，请点击“核对本次办理结果”；原输入保持不变。');
      await saved(input, result);
    } catch (e) { if (token === generation.current) setError(failureText(e)); }
    finally { busyRef.current = false; setBusy(false); }
  }
  const input = (title, key, required = false, multiline = false) => <label>{title}{multiline ? <textarea aria-label={title} rows={4} value={draft[key]} onChange={e => update(key, e.target.value)} required={required} /> : <input aria-label={title} value={draft[key]} onChange={e => update(key, e.target.value)} required={required} />}</label>;
  const departmentOptions = departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>);
  function nextItem(item) {
    const query = new URLSearchParams(String(item.target).split('?')[1] || '');
    if (query.get('factRequest')) choose('fact', query.get('factRequest')); else if (query.get('package')) choose('package', query.get('package'));
  }
  return <div className="process-preview data-governance">
    <section className="card"><h2>按固定流程版本办理数据治理</h2><p>MDM工作组核对对象、字段和生命周期，并记录判断依据；业务部门只答复定向的事实问题。系统按固定规则生成待核对内容，不调用AI，也不自动确认。</p>
      <p>请选择已发布的流程版本建立工作包，也可选择历史已发布版本。每个工作包保留所选流程版本的内容，不随最新流程变化。</p>
      <p><a href={selection.kind==='package'&&selection.id?handoffWorkspaceHref({kind:'package',id:String(selection.id)},'/app/data-governance?package='+encodeURIComponent(selection.id)):'/app/data-map-handoffs?return_to=%2Fapp%2Fdata-governance'} onClick={onNavigate}>进入数据地图承接工作区</a>，查看本包承接、冲突、来源升级及撤回恢复，办完可返回原工作包核对状态。</p>
      <div className="import-actions"><button className="secondary" disabled={loading || busy} onClick={() => load()}>刷新工作包状态</button><button className="secondary" disabled={busy} onClick={() => choose('')}>返回工作包待办</button></div>
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取工作包状态" />}
    {error && <StatusPanel kind="error" title="操作未完成" onRetry={busy ? undefined : () => load()}>{userMessage(error)} 可见输入仍保留；请核对状态后明确重试。</StatusPanel>}
    {notice && <StatusPanel title="本次操作已完成">{notice}</StatusPanel>}
    {feature && !feature.enabled && <StatusPanel title="数据治理尚未开启">当前没有开启工作包办理，请使用已获准的业务入口。</StatusPanel>}
    {feature?.read_only && <StatusPanel title="成果查阅模式">仅按原权限查阅已完成工作包和定向事实记录，全部工作包写操作已关闭。</StatusPanel>}
    {!selection.id && feature?.enabled && !loading && <>
      <section className="card"><h2>我现在该做什么</h2>{workbench.work_items?.length ? workbench.work_items.slice(0, 3).map(item => <article className="preview-item" key={item.id}><h3>{item.title}</h3><p>{item.sample}</p><p>{item.nextStep}</p><button disabled={busy} onClick={() => nextItem(item)}>{item.actionLabel || '打开事项'}</button></article>) : <p>当前没有待办事项。</p>}
        {can('create') && <button className="primary" disabled={busy || !workbench.published_versions?.length} onClick={() => start('create')}>建立工作包</button>}
        {can('create') && !workbench.published_versions?.length && <p>当前没有可选的已发布流程内容。</p>}
      </section>
      <section className="card"><h2>工作包</h2>{workbench.work_packages?.length ? workbench.work_packages.map(p => <article className="preview-item" key={p.id}><h3>{p.process_name || p.document_no || '流程名称未记录'}</h3><p>{label(p.status)} · {p.risk_level === 'high' ? '高风险' : '普通风险'}</p><p>待答复 {p.fact_request_counts?.open || 0} 项；待MDM核对答复 {p.fact_request_counts?.answered || 0} 项</p><button disabled={busy} onClick={() => choose('package', p.id)}>查看工作包 {businessName(p)}</button></article>) : <p>当前范围没有工作包。</p>}</section>
      <section className="card"><h2>本部门事实问题</h2><label>事实记录范围<select aria-label="事实记录范围" value={mode} disabled={busy} onChange={e => { if (abandon()) { setDraft(null); setMode(e.target.value); } }}><option value="todo">待答复</option><option value="all">全部记录</option></select></label>{workbench.fact_requests?.length ? workbench.fact_requests.map(f => <article className="preview-item" key={f.id}><h3>{f.question_text}</h3><p>{f.process_name} · {label(f.status)}</p><p>{f.request_reason}</p><button disabled={busy} onClick={() => choose('fact', f.id)}>查看事实问题 {businessName(f)}</button></article>) : <p>当前范围没有事实问题。</p>}</section>
    </>}
    {selection.kind === 'package' && selection.id && <CaseGovernance api={api} targetType="work_package" targetId={selection.id} sourceRevision={detail?.package.revision_no} sourceHash={detail?.package.source_content_hash} refreshKey={detail} draft={draft} setDraft={setDraft} disabled={busy || loading || !detail || feature?.read_only || !feature?.enabled} onBusyChange={value => { busyRef.current = value; setBusy(value); }} onSaved={() => load()} />}
    {detail && !loading && <>
      {selection.kind==='package'&&<HandoffPackageProgress api={api} packageId={String(detail.package.id)} refreshKey={detail} onNavigate={onNavigate}/>}
      <TerminologyReferences api={api} user={user} subject={{target_type:'work_package',target_id:String(detail.package.id),source_digest:binding(detail)}} draft={terminologyDraft} setDraft={setTerminologyDraft}/>
      <section className="card"><h2>{detail.package.process_name || '流程名称未记录'}</h2><p>{label(detail.package.status)}</p><p>归口：{detail.package.owning_department_name || '待明确'} · {detail.package.risk_level === 'high' ? '高风险' : '普通风险'} · 完成时限：{detail.package.due_at ? businessDateTime(detail.package.due_at) : '待约定'}</p><details><summary>查看流程来源</summary><p>{detail.source_version.document_no} · {detail.source_version.document_title} · {businessName(detail.source_version)}</p></details>
        <div className="import-actions">{can('generate') && <button disabled={busy} onClick={() => start('generate')}>生成待核对明细</button>}{can('complete') && <button disabled={busy} onClick={() => start('complete')}>完成工作包审核</button>}</div>
      </section>
      {selection.kind === 'package' && <section className="card"><h2>逐项核对治理明细</h2><p>待判断 {detail.details.filter(v => ['pending','needs_business_fact'].includes(v.status)).length} / 共 {detail.details.length} 项。保存单项结论与完成工作包审核是两个独立动作。</p>
        {detail.details.length ? <label>治理明细<select aria-label="治理明细" value={selectedId} disabled={busy} onChange={e => { if (abandon()) { setDraft(null); setSelectedId(e.target.value); } }}>{detail.details.map(v => <option key={v.id} value={v.id}>{label(v.detail_type)} · {detailName(v)} · {label(v.status)}</option>)}</select></label> : <p>尚未生成明细，可由MDM工作组使用固定规则生成。</p>}
        {row && <><h3>{label(row.detail_type)} · {label(row.status)}{row.high_risk ? ' · 高风险' : ''}</h3><h4>固定流程版本中的业务事实</h4><p>{businessText(sourceText(row))}</p><h4>固定规则生成的待核对内容</h4><p>{businessText(candidateText(row))}</p><h4>已记录的治理结论</h4><p>{row.governance?.conclusion || '尚未形成结论'}</p><p>判断依据：{row.governance?.basis || '未记录'}</p><p>统一对象：{row.governance?.unified_object_name || '名称未记录'} · 责任部门：{row.responsible_department_name || '部门名称未记录' || '待明确'}</p><div className="import-actions">{can('decide') && <button disabled={busy} onClick={() => start('decide')}>记录治理结论</button>}{can('ask') && <button disabled={busy} onClick={() => start('ask')}>向业务部门提问</button>}</div></>}
        <h3>本明细的事实问题</h3>{detail.fact_requests.filter(f => String(f.detail_id) === String(selectedId)).map(f => <article className="preview-item" key={f.id}><h4>{f.question_text}</h4><p>{f.target_department_name || '部门名称未记录'} · {label(f.status)} · 提出原因：{f.request_reason}</p><p>{f.answer_text || '尚未答复'}</p><p>来源依据：{businessEvidence(f.evidence_ref)} · 答复人员：{historicalGovernanceActor(f.answered_actor_snapshot||{answered_by_name:f.answered_by_name})} · {f.answered_at ? businessDateTime(f.answered_at) : ''}</p>{f.status === 'answered' && can('close') && <button disabled={busy} onClick={() => start('close', f.id)}>核对并关闭问题 {businessName(f)}</button>}</article>)}
      </section>}
      {selection.kind === 'fact' && <section className="card"><h2>{detail.fact_request.question_text}</h2><p>只回答已经核对的业务事实，并提供制度、表单或台账依据；不确定时请明确说明。</p><p>{label(detail.fact_request.status)} · 提出原因：{detail.fact_request.request_reason}</p><h3>问题所指的流程事实</h3><p>{sourceText(detail.source_context)}</p><h3>已提交答复</h3><p>{detail.fact_request.answer_text || '尚未答复'}</p><p>来源依据：{businessEvidence(detail.fact_request.evidence_ref)}</p><p>答复人员：{detail.fact_request.answered_at?historicalGovernanceActor(detail.fact_request.answered_actor_snapshot||{answered_by_name:detail.fact_request.answered_by_name}):'尚未答复'} · {detail.fact_request.answered_at ? businessDateTime(detail.fact_request.answered_at) : ''}</p>{can('answer') && detail.fact_request.status === 'open' && <button disabled={busy} onClick={() => start('answer')}>答复业务事实</button>}</section>}
    </>}
    {draft && !isGovernanceDraft(draft) && <section ref={editor} tabIndex={-1} className="card preview-editor"><h2>{actionNames[draft.kind]}</h2><p>输入仅保留在当前页面。提交失败时不会清空；放弃输入需要明确确认。</p>
      {draft.request && <div className="preview-item" role="status"><p>本次提交的内容已保留，请核对办理结果。</p>
        <p>{({awaiting_receipt:'尚未确认本次办理结果。请先点击“核对本次办理结果”；本次提交的内容已完整保留。',in_progress:'本次操作仍在办理。请稍后核对结果，暂不重复提交。',retryable:'已确认本次操作尚未提交。可使用已保留的内容继续办理，并核对结果；继续办理可能完成原操作。',not_observed:'暂未查到本次办理记录，不能据此认定失败。可继续核对结果，或使用已保留的内容继续办理；继续办理可能完成原操作。',committed:'已查到本次操作的成功回执。请核对后确认结束本次输入。',rejected:'已确认本次操作被拒绝，没有提交本次业务变更。可修改输入后另行提交。'})[draft.request.phase]}</p>
        {draft.request.phase === 'rejected' && <p>{failures[draft.request.result?.code] || '请核对权限、来源修订和输入；需要修改时保留当前内容后重新办理。'}</p>}
        <button type="button" className="secondary" disabled={busy} onClick={queryReceipt}>核对本次办理结果</button>
        {canRetryNativeRequest(draft) && <button type="button" className="primary" disabled={busy} onClick={submit}>继续办理并核对结果</button>}
        {draft.request.phase === 'committed' && <button type="button" className="primary" disabled={busy} onClick={acknowledgeReceipt}>确认结果并结束本次输入</button>}
        {requestUnresolved(draft) && <button type="button" className="secondary" disabled={busy} onClick={() => { if (abandon()) { retain(null); setError(''); } }}>放弃本次输入</button>}
      </div>}
      {stale && <StatusPanel kind="error" title="来源或修订已变化">本次输入仍绑定原修订，不能直接提交。请核对最新状态后明确放弃旧输入，再重新办理。</StatusPanel>}
      {!loading && unavailable && <StatusPanel title="当前操作不可提交">当前权限、来源或运行模式不可用；输入保留供核对。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={busy || requestUnresolved(draft)}>
        {draft.kind === 'create' && <label>已发布流程版本<select aria-label="已发布流程版本" value={draft.versionId} onChange={e => update('versionId', e.target.value)} required><option value="">请选择固定来源版本</option>{workbench?.published_versions?.map(v => <option key={v.process_version_id} value={v.process_version_id}>{v.department_name} · {v.document_title || v.document_no} · {v.edition} · {v.status === 'superseded' ? '历史已发布' : '当前已发布'}{v.work_package_id ? ' · 已有工作包' : ''}</option>)}</select></label>}
        {draft.kind === 'generate' && <p>按工作包固定版本和规则生成待核对明细；已有明细不会重复创建，结果仍需人工判断。</p>}
        {draft.kind === 'decide' && <><label>处理状态<select aria-label="处理状态" value={draft.status} onChange={e => update('status', e.target.value)}>{['pending','confirmed','not_applicable','terminated'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>{input('治理结论','conclusion')}<BusinessRecordPicker api={api} label="统一关联的数据对象（如适用）" kind="object" value={draft.unified} onChange={value=>update('unified',value)}/><label>责任部门<select aria-label="责任部门" value={draft.department} onChange={e => update('department', e.target.value)}><option value="">沿用归口部门</option>{departmentOptions}</select></label>{input('判断依据','basis', draft.status !== 'pending', true)}</>}
        {draft.kind === 'ask' && <><label>目标部门<select aria-label="目标部门" value={draft.target} onChange={e => update('target', e.target.value)} required><option value="">请选择</option>{departmentOptions}</select></label><label>需要的事实<select aria-label="需要的事实" value={draft.factType} onChange={e => update('factType', e.target.value)} required><option value="">请选择</option>{Object.entries({ business_definition:'业务定义', trigger_condition:'触发条件', responsibility:'实际责任', source_evidence:'来源依据', exception_handling:'例外处理' }).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label>{input('具体问题','question',true,true)}{input('提出原因','reason',true,true)}</>}
        {draft.kind === 'answer' && <>{input('事实答复','answer',true,true)}{input('来源依据','evidence',false,true)}</>}
        {draft.kind === 'close' && input('采用情况和关闭依据','basis',true,true)}
        {draft.kind === 'complete' && <><p>仅在所有明细形成结论、事实问题均已核对关闭后完成审核；完成后本工作包只读。</p>{input('完成审核依据','basis',true,true)}</>}
        <button className="primary" type="submit" disabled={loading || stale || unavailable}>确认提交本次操作</button>{!requestUnresolved(draft) && <button type="button" className="secondary" onClick={() => { if (abandon()) { retain(null); setError(''); } }}>放弃本次输入</button>}
      </fieldset></form>
    </section>}
    {detail?.reviews && !loading && <section className="card"><h2>审核及办理记录</h2>{!detail.reviews.length && <p>尚未形成完成审核记录。</p>}{detail.reviews.map(r => <article key={r.id} className="preview-item"><h3>MDM工作组审核 · {label(r.decision)}</h3><p>{r.basis_text}</p><p>办理人：{historicalGovernanceActor(r.actor_snapshot||{role_code:r.actor_role_code})} · {businessDateTime(r.created_at)}</p></article>)}<details><summary>查看本工作包操作历史</summary>{detail.events.map(e => <article className="preview-item" key={e.id}><p>{({work_package_created:'建立工作包',deterministic_candidates_generated:'生成待核对明细',governance_detail_decided:'更新治理结论',business_fact_requested:'提出事实问题',business_fact_answered:'答复事实问题',business_fact_closed:'核对关闭事实问题',mdm_workgroup_review_approved:'完成工作包审核'})[e.event_type] || businessStatus(e.event_type,'办理记录类型待核对')}</p><p>{e.basis_text}</p><p>办理人：{historicalGovernanceActor(e.payload?.actor_snapshot||{actor_name:e.actor_name,role_code:e.actor_role_code})} · {businessDateTime(e.created_at)}</p></article>)}</details></section>}
  </div>;
}
