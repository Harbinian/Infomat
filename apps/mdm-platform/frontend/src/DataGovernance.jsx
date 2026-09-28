import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';

const ROOT = '/api/process-data-governance';
const names = { mdm_preparing:'待MDM准备', mdm_governing:'MDM治理中', waiting_business_fact:'等待业务事实', mdm_review:'待MDM审核', completed:'已完成', source_withdrawn:'来源已撤回', pending:'待MDM判断', needs_business_fact:'待补充业务事实', confirmed:'已确认', not_applicable:'不适用', terminated:'已终止', open:'待部门答复', answered:'已答复待MDM核对', closed:'已关闭', cancelled:'已取消', data_object_identity:'对象身份', critical_field:'关键字段', data_flow:'数据流', lifecycle_rule:'生命周期规则', approved:'通过', rejected:'退回' };
const actionNames = { create:'建立工作包', generate:'生成待核对明细', decide:'记录治理结论', ask:'向业务部门提问', answer:'答复业务事实', close:'核对并关闭问题', complete:'完成工作包审核' };
const actions = { create:'reconcile', generate:'generate_candidates', decide:'decide_detail', ask:'request_business_fact', answer:'answer_targeted_business_fact', close:'close_business_fact', complete:'complete_work_package' };
const reasonNames = { source_data_object:'流程已声明数据对象', declared_field:'流程已声明字段', identifier_object:'对象用于标识', used_by_multiple_behaviors:'多个行为使用该对象', has_declared_source_relation:'已声明来源关系', no_declared_field:'尚未声明字段', declared_behavior_link:'已声明数据与行为关系', no_declared_behavior_link:'尚未声明数据与行为关系', source_high_risk_flag:'来源标注高风险', irreversible_action:'包含不可逆动作', all_records_scope:'涉及全部记录', no_declared_lifecycle_event:'尚未声明生命周期事件', no_declared_data_object:'尚未声明数据对象' };
const operationNames = { create:'创建', read:'读取', use:'使用', update:'更新', delete:'删除', archive:'归档', destroy:'销毁', retain:'保留', transfer:'传递' };
const label = v => names[v] || v || '未记录';
const operation = v => operationNames[v] || v;
const failures = {
  PROCESS_DATA_GOVERNANCE_REVIEW_BLOCKED:'仍有待判断明细或未关闭的事实问题，请逐项核对后再完成审核。',
  PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED:'固定来源的内容或摘要已变化，不能继续写入。请联系维护人员核对固定来源，勿将旧输入套用到其他版本。',
  PROCESS_DATA_GOVERNANCE_SOURCE_UNREADABLE:'固定来源内容无法读取，请核对来源后重试。',
  PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED:'来源已撤回或不再是已发布版本，当前不能继续办理。',
  PROCESS_DATA_GOVERNANCE_READ_ONLY:'当前仅供成果查阅，工作包办理已关闭。',
  PROCESS_DATA_GOVERNANCE_FACT_NOT_OPEN:'该事实问题已不处于待答复状态，请刷新核对。',
  PROCESS_DATA_GOVERNANCE_FACT_NOT_ANSWERED:'业务部门尚未答复，不能关闭事实问题。',
  PROCESS_DATA_GOVERNANCE_DETAIL_HAS_OPEN_FACT:'该明细仍有未关闭的事实问题，请先核对并关闭。',
  PROCESS_DATA_GOVERNANCE_PACKAGE_MDM_CONTEXT_ONLY:'业务部门只查看发给本部门的具体事实问题，请返回待办选择。'
};
const failureText = e => failures[e.code] || e.message;
function sourceText(row = {}) {
  const s = row.source || {};
  if (s.missing_data_scope) return '固定版本没有声明数据对象，需要MDM核对适用范围，必要时向业务部门询问具体事实。';
  if (s.missing_field_scope) return `对象“${s.data_name || s.data_ref || row.parent_source_ref}”未声明字段。`;
  if (s.missing_data_flow_scope) return `对象“${s.data_name || s.data_ref || row.parent_source_ref}”未声明创建、更新或使用关系。`;
  if (s.missing_lifecycle_scope) return `对象“${s.data_name || s.data_ref || row.parent_source_ref}”未声明生命周期事件。`;
  return [s.data_name || s.data_ref, s.field_name || s.field_ref, s.description || s.definition, s.behavior_name || s.behavior_ref, s.action && operation(s.action), s.operations?.map(operation).join('、'), s.route_label || s.route_ref, s.exception_handling].filter(Boolean).join('；') || row.source_ref || '固定流程版本来源';
}
function candidateText(row) {
  const c = row.candidate || {};
  return [(c.reason_codes || c.high_risk_reason_codes || []).map(v => reasonNames[v] || v).join('；'), c.action && operation(c.action), c.operation_codes?.map(operation).join('、'), c.match_suggestions?.length ? '待定匹配：' + c.match_suggestions.map(v => `${v.object_name || v.object_key}（${v.match_type}）`).join('；') : row.detail_type === 'data_object_identity' ? '未发现稳定标识或名称完全一致的匹配建议' : '', '系统未自动确认'].filter(Boolean).join('；');
}
const binding = data => data?.package ? JSON.stringify([data.package.id, data.package.process_version_id, data.package.source_content_hash, data.package.rule_version, data.package.revision_no, data.package.status, data.fact_request?.status]) : '';
function routeSelection() { const q = new URLSearchParams(location.search); return q.get('factRequest') ? { kind:'fact', id:q.get('factRequest') } : q.get('package') ? { kind:'package', id:q.get('package') } : { kind:'', id:'' }; }

export function DataGovernance({ api, draft, setDraft, onLegacy }) {
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
  function abandon() { return !draftRef.current || window.confirm('当前有未提交输入，是否明确放弃？'); }
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
  function update(key, value) { setDraft({ ...draftRef.current, [key]:value, dirty:true }); }
  async function submit(event) {
    event.preventDefault(); const input = draftRef.current;
    if (!input || busyRef.current || loading || stale || unavailable) return;
    let url, method = 'POST', body = { expected_revision:input.expected_revision };
    if (input.kind === 'create') { url = '/creation-tasks/reconcile'; body = { process_version_id:Number(input.versionId) }; }
    if (input.kind === 'generate') url = '/work-packages/' + input.packageId + '/generate-candidates';
    if (input.kind === 'decide') { url = '/work-packages/' + input.packageId + '/details/' + input.detailId; method = 'PATCH'; body = { ...body, status:input.status, responsible_department_id:Number(input.department) || null, governance:{ conclusion:input.conclusion.trim(), unified_object_id:input.unified.trim() || null, basis:input.basis.trim() } }; }
    if (input.kind === 'ask') { url = '/work-packages/' + input.packageId + '/fact-requests'; body = { ...body, detail_id:input.detailId, target_department_id:Number(input.target), requested_fact_type:input.factType, question_text:input.question.trim(), request_reason:input.reason.trim() }; }
    if (input.kind === 'answer') { url = '/fact-requests/' + input.factId + '/respond'; body = { ...body, answer_text:input.answer.trim(), evidence_ref:input.evidence.trim() }; }
    if (input.kind === 'close') { url = '/fact-requests/' + input.factId + '/close'; body.basis = input.basis.trim(); }
    if (input.kind === 'complete') { url = '/work-packages/' + input.packageId + '/complete'; body.basis = input.basis.trim(); }
    busyRef.current = true; setBusy(true); setError(''); setNotice(''); const token = generation.current;
    try {
      const result = await api.request(ROOT + url, { method, body });
      if (token !== generation.current) return;
      setDraft(null); setNotice(result.idempotent ? '本次操作已完成，已返回原记录，没有重复创建。' : '本次操作已完成。');
      if (input.kind === 'create') {
        const next = { kind:'package', id:String(result.package.id) }; setSelection(next);
        const url = new URL(location.href); url.searchParams.delete('factRequest'); url.searchParams.set('package', next.id); history.replaceState(history.state, '', url);
      } else await load(selection);
    } catch (e) { if (token === generation.current && e.name !== 'AbortError') setError(failureText(e)); }
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
      <p>当前工作包支持已发布的原生V7，包括历史已发布版本。每个工作包固定绑定来源版本与摘要，不随最新流程变化。</p>
      <div className="import-actions"><button className="secondary" disabled={loading || busy} onClick={() => load()}>刷新工作包状态</button><button className="secondary" disabled={busy} onClick={() => choose('')}>返回工作包待办</button><a href={'/#/processGovernance?workspace=dataGovernance' + (selection.id ? '&' + (selection.kind === 'fact' ? 'factRequest' : 'package') + '=' + encodeURIComponent(selection.id) : '')} onClick={onLegacy}>打开原数据治理入口</a></div>
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取工作包状态" />}
    {error && <StatusPanel kind="error" title="操作未完成" onRetry={busy ? undefined : () => load()}>{error} 可见输入仍保留；请核对状态后明确重试。</StatusPanel>}
    {notice && <StatusPanel title="本次操作已完成">{notice}</StatusPanel>}
    {feature && !feature.enabled && <StatusPanel title="数据治理尚未开启">当前没有开启工作包办理，请使用已获准的业务入口。</StatusPanel>}
    {feature?.read_only && <StatusPanel title="成果查阅模式">仅按原权限查阅已完成工作包和定向事实记录，全部工作包写操作已关闭。</StatusPanel>}
    {!selection.id && feature?.enabled && !loading && <>
      <section className="card"><h2>我现在该做什么</h2>{workbench.work_items?.length ? workbench.work_items.slice(0, 3).map(item => <article className="preview-item" key={item.id}><h3>{item.title}</h3><p>{item.sample}</p><p>{item.nextStep}</p><button disabled={busy} onClick={() => nextItem(item)}>{item.actionLabel || '打开事项'}</button></article>) : <p>当前没有待办事项。</p>}
        {can('create') && <button className="primary" disabled={busy || !workbench.published_versions?.length} onClick={() => start('create')}>建立工作包</button>}
        {can('create') && !workbench.published_versions?.length && <p>当前没有可选的已发布V7版本。</p>}
      </section>
      <section className="card"><h2>工作包</h2>{workbench.work_packages?.length ? workbench.work_packages.map(p => <article className="preview-item" key={p.id}><h3>{p.process_name || p.document_no || p.package_ref}</h3><p>正式版本 {p.process_version_id} · 修订 {p.revision_no} · {label(p.status)} · {p.risk_level === 'high' ? '高风险' : '普通风险'}</p><p>待答复 {p.fact_request_counts?.open || 0} 项；待MDM核对答复 {p.fact_request_counts?.answered || 0} 项</p><button disabled={busy} onClick={() => choose('package', p.id)}>查看工作包 {p.id}</button></article>) : <p>当前范围没有工作包。</p>}</section>
      <section className="card"><h2>本部门事实问题</h2><label>事实记录范围<select aria-label="事实记录范围" value={mode} disabled={busy} onChange={e => { if (abandon()) { setDraft(null); setMode(e.target.value); } }}><option value="todo">待答复</option><option value="all">全部记录</option></select></label>{workbench.fact_requests?.length ? workbench.fact_requests.map(f => <article className="preview-item" key={f.id}><h3>{f.question_text}</h3><p>{f.process_name} · {label(f.status)}</p><p>{f.request_reason}</p><button disabled={busy} onClick={() => choose('fact', f.id)}>查看事实问题 {f.id}</button></article>) : <p>当前范围没有事实问题。</p>}</section>
    </>}
    {detail && !loading && <>
      <section className="card"><h2>{detail.package.process_name || detail.package.package_ref}</h2><p>正式版本 {detail.package.process_version_id} · 工作包修订 {detail.package.revision_no} · {label(detail.package.status)}</p><p>归口：{detail.package.owning_department_name || '待明确'} · {detail.package.risk_level === 'high' ? '高风险' : '普通风险'} · 完成时限：{detail.package.due_at || '未记录'}</p><details><summary>固定来源与规则版本</summary><p>{detail.source_version.document_no} · {detail.source_version.document_title} · {detail.source_version.schema_version}</p><p>来源摘要：{detail.package.source_content_hash}</p><p>规则版本：{detail.package.rule_version}</p></details>
        <div className="import-actions">{can('generate') && <button disabled={busy} onClick={() => start('generate')}>生成待核对明细</button>}{can('complete') && <button disabled={busy} onClick={() => start('complete')}>完成工作包审核</button>}</div>
      </section>
      {selection.kind === 'package' && <section className="card"><h2>逐项核对治理明细</h2><p>待判断 {detail.details.filter(v => ['pending','needs_business_fact'].includes(v.status)).length} / 共 {detail.details.length} 项。保存单项结论与完成工作包审核是两个独立动作。</p>
        {detail.details.length ? <label>治理明细<select aria-label="治理明细" value={selectedId} disabled={busy} onChange={e => { if (abandon()) { setDraft(null); setSelectedId(e.target.value); } }}>{detail.details.map(v => <option key={v.id} value={v.id}>{label(v.detail_type)} · {v.source_ref} · {label(v.status)}</option>)}</select></label> : <p>尚未生成明细，可由MDM工作组使用固定规则生成。</p>}
        {row && <><h3>{label(row.detail_type)} · {label(row.status)}{row.high_risk ? ' · 高风险' : ''}</h3><h4>固定流程版本中的业务事实</h4><p>{sourceText(row)}</p><h4>固定规则生成的待核对内容</h4><p>{candidateText(row)}</p><h4>已记录的治理结论</h4><p>{row.governance?.conclusion || '尚未形成结论'}</p><p>判断依据：{row.governance?.basis || '未记录'}</p><p>统一对象标识：{row.governance?.unified_object_id || '未记录'} · 责任部门：{row.responsible_department_name || row.responsible_department_id || '待明确'}</p><div className="import-actions">{can('decide') && <button disabled={busy} onClick={() => start('decide')}>记录治理结论</button>}{can('ask') && <button disabled={busy} onClick={() => start('ask')}>向业务部门提问</button>}</div></>}
        <h3>本明细的事实问题</h3>{detail.fact_requests.filter(f => String(f.detail_id) === String(selectedId)).map(f => <article className="preview-item" key={f.id}><h4>{f.question_text}</h4><p>{f.target_department_name || f.target_department_id} · {label(f.status)} · 提出原因：{f.request_reason}</p><p>{f.answer_text || '尚未答复'}</p><p>来源依据：{f.evidence_ref || '未记录'} · 答复人员标识：{f.answered_by_person_id || '未记录'} · {f.answered_at || ''}</p>{f.status === 'answered' && can('close') && <button disabled={busy} onClick={() => start('close', f.id)}>核对并关闭问题 {f.id}</button>}</article>)}
      </section>}
      {selection.kind === 'fact' && <section className="card"><h2>{detail.fact_request.question_text}</h2><p>只回答已经核对的业务事实，并提供制度、表单或台账依据；不确定时请明确说明。</p><p>{label(detail.fact_request.status)} · 提出原因：{detail.fact_request.request_reason}</p><h3>问题所指的流程事实</h3><p>{sourceText(detail.source_context)}</p><h3>已提交答复</h3><p>{detail.fact_request.answer_text || '尚未答复'}</p><p>来源依据：{detail.fact_request.evidence_ref || '未记录'}</p><p>答复人员标识：{detail.fact_request.answered_by_person_id || '未记录'} · {detail.fact_request.answered_at || ''}</p>{can('answer') && detail.fact_request.status === 'open' && <button disabled={busy} onClick={() => start('answer')}>答复业务事实</button>}</section>}
    </>}
    {draft && <section ref={editor} tabIndex={-1} className="card preview-editor"><h2>{actionNames[draft.kind]}</h2><p>输入仅保留在当前页面。提交失败时不会清空；放弃输入需要明确确认。</p>
      {stale && <StatusPanel kind="error" title="来源或修订已变化">本次输入仍绑定原修订，不能直接提交。请核对最新状态后明确放弃旧输入，再重新办理。</StatusPanel>}
      {!loading && unavailable && <StatusPanel title="当前操作不可提交">当前权限、来源或运行模式不可用；输入保留供核对。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={busy}>
        {draft.kind === 'create' && <label>已发布流程版本<select aria-label="已发布流程版本" value={draft.versionId} onChange={e => update('versionId', e.target.value)} required><option value="">请选择固定来源版本</option>{workbench?.published_versions?.map(v => <option key={v.process_version_id} value={v.process_version_id}>{v.department_name} · {v.document_title || v.document_no} · {v.edition} · 正式版本 {v.process_version_id} · {v.status === 'superseded' ? '历史已发布' : '当前已发布'}{v.work_package_id ? ' · 已有工作包' : ''}</option>)}</select></label>}
        {draft.kind === 'generate' && <p>按工作包固定版本和规则生成待核对明细；已有明细不会重复创建，结果仍需人工判断。</p>}
        {draft.kind === 'decide' && <><label>处理状态<select aria-label="处理状态" value={draft.status} onChange={e => update('status', e.target.value)}>{['pending','confirmed','not_applicable','terminated'].map(v => <option key={v} value={v}>{label(v)}</option>)}</select></label>{input('治理结论','conclusion')}{input('统一对象标识（如适用）','unified')}<label>责任部门<select aria-label="责任部门" value={draft.department} onChange={e => update('department', e.target.value)}><option value="">沿用归口部门</option>{departmentOptions}</select></label>{input('判断依据','basis', draft.status !== 'pending', true)}</>}
        {draft.kind === 'ask' && <><label>目标部门<select aria-label="目标部门" value={draft.target} onChange={e => update('target', e.target.value)} required><option value="">请选择</option>{departmentOptions}</select></label><label>需要的事实<select aria-label="需要的事实" value={draft.factType} onChange={e => update('factType', e.target.value)} required><option value="">请选择</option>{Object.entries({ business_definition:'业务定义', trigger_condition:'触发条件', responsibility:'实际责任', source_evidence:'来源依据', exception_handling:'例外处理' }).map(([v,n]) => <option key={v} value={v}>{n}</option>)}</select></label>{input('具体问题','question',true,true)}{input('提出原因','reason',true,true)}</>}
        {draft.kind === 'answer' && <>{input('事实答复','answer',true,true)}{input('来源依据','evidence',false,true)}</>}
        {draft.kind === 'close' && input('采用情况和关闭依据','basis',true,true)}
        {draft.kind === 'complete' && <><p>仅在所有明细形成结论、事实问题均已核对关闭后完成审核；完成后本工作包只读。</p>{input('完成审核依据','basis',true,true)}</>}
        <button className="primary" type="submit" disabled={loading || stale || unavailable}>确认提交本次操作</button><button type="button" className="secondary" onClick={() => { if (abandon()) { setDraft(null); setError(''); } }}>放弃本次输入</button>
      </fieldset></form>
    </section>}
    {detail?.reviews && !loading && <section className="card"><h2>审核及办理记录</h2>{!detail.reviews.length && <p>尚未形成完成审核记录。</p>}{detail.reviews.map(r => <article key={r.id} className="preview-item"><h3>MDM工作组审核 · {label(r.decision)}</h3><p>{r.basis_text}</p><p>修订 {r.package_revision_no} · 人员标识 {r.actor_person_id || '未记录'} · {r.created_at}</p></article>)}<details><summary>查看本工作包操作历史</summary>{detail.events.map(e => <article className="preview-item" key={e.id}><p>{({work_package_created:'建立工作包',deterministic_candidates_generated:'生成待核对明细',governance_detail_decided:'更新治理结论',business_fact_requested:'提出事实问题',business_fact_answered:'答复事实问题',business_fact_closed:'核对关闭事实问题',mdm_workgroup_review_approved:'完成工作包审核'})[e.event_type] || e.event_type}</p><p>{e.basis_text}</p><p>人员标识 {e.actor_person_id || '未记录'} · {e.created_at}</p></article>)}</details></section>}
  </div>;
}
