import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table } from './IdentityShared.jsx';
import './governance-utilities.css';
import { ConflictHistory } from './ConflictHistory.jsx';

const labels = { pending:'待处理', approved:'已通过', rejected:'已驳回', coordinating:'协调中', escalated:'已升级', resolved:'已解决', silenced:'已静默', archived:'已归档', blocking:'阻断', error:'严重', high:'高', medium:'中', low:'低', warn:'警告', A:'支持 A 方', B:'支持 B 方', compromise:'折中方案' };
const label = value => labels[value] || value || '未提供';
const conflictAttributes = { field_type:'字段类型', sync_mode:'同步方式', consume_systems:'消费系统', data_object:'数据对象', field_name_cn:'中文字段名', field_name_en:'英文字段名' };
const subject = row => {
  if (row.conflict_type === 'term' || row.term) return row.term || '术语名称未提供';
  const names = [...new Set([row.field_name_a, row.field_name_b].filter(Boolean))];
  const attribute = conflictAttributes[row.conflict_field] || (row.conflict_field ? `属性：${row.conflict_field}` : '冲突属性待补充');
  return `${names.join(' / ') || '字段名称待补充'} · ${attribute}`;
};
const query = () => Object.fromEntries(new URLSearchParams(location.search));
const recordKey = (row, terms) => terms ? String(row.id) : `${row.conflict_type}-${row.id}`;

// One shared request/draft lifecycle for the two existing governance API families.
// Drafts live in App and remain bound to the current person and department.
export function GovernanceUtilities({ api, user, kind, draft, setDraft, onLegacy, onQueryChange }) {
  const terms = kind === 'terms', title = terms ? '术语' : '冲突';
  const statusLabel = value => terms && value === 'pending' ? '待审' : label(value);
  const [selection, setSelection] = useState(query), [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(null), [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [assignees, setAssignees] = useState(null), [pickerError, setPickerError] = useState(null), [pickerRevision, setPickerRevision] = useState(0);
  const alive = useRef(false), lock = useRef(false), formRef = useRef(null);
  const perms = user.permissions || [], can = code => perms.includes('governance:' + code);
  const apiRoot = terms ? '/api/terminology' : '/api/conflicts';
  const selectedId = draft?.id || selection.id;
  const selectedType = draft?.type || (selection.type === 'term' ? 'term' : 'field');
  const detailPath = id => `${apiRoot}/${encodeURIComponent(id)}?type=${selectedType}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const pop = () => setSelection(query()); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  useEffect(() => {
    const controller = new AbortController(), signal = controller.signal;
    setCatalog(null); setError(null);
    const params = new URLSearchParams();
    if (selection.status) params.set('status', selection.status);
    if (!terms && selection.filterType) params.set('type', selection.filterType);
    if (!terms && selection.severity) params.set('severity', selection.severity);
    Promise.all([api.request(apiRoot + '?' + params, { signal }), ...(terms ? [api.request(apiRoot + '/types', { signal }), api.request(apiRoot + '/processes', { signal })] : [])])
      .then(([rows, types, processes]) => { if (!signal.aborted) setCatalog({ rows, types, processes }); })
      .catch(e => { if (!signal.aborted) setError(e); });
    return () => controller.abort();
  }, [api, kind, selection.status, selection.filterType, selection.severity, revision]);
  useEffect(() => {
    const controller = new AbortController(); setDetail(null); setDetailError(null);
    if (!selectedId) return () => controller.abort();
    const read = terms ? api.request(apiRoot, { signal: controller.signal }).then(rows => {
      const row = rows.find(r => String(r.id) === String(selectedId));
      if (!row) throw new Error('所选术语不存在或不在当前可读取范围内。');
      return row;
    }) : api.request(detailPath(selectedId), { signal: controller.signal });
    read.then(row => { if (!controller.signal.aborted) setDetail(row); }).catch(e => { if (!controller.signal.aborted) setDetailError(e); });
    return () => controller.abort();
  }, [api, kind, selectedId, selectedType, revision]);
  useEffect(() => {
    if (!['assign','reassign','term-todo'].includes(draft?.action)) return;
    const controller = new AbortController(); setAssignees(null); setPickerError(null);
    api.request(draft.action === 'term-todo' ? '/api/org/departments' : '/api/org/users/assignable', { signal: controller.signal }).then(rows => { if (!controller.signal.aborted) setAssignees(rows); }).catch(e => { if (!controller.signal.aborted) setPickerError(e); });
    return () => controller.abort();
  }, [api, draft?.action, pickerRevision]);
  useEffect(() => { if (draft) formRef.current?.querySelector('input,select,textarea,button')?.focus(); }, [draft?.action, draft?.id]);
  function changeQuery(values, push = false) {
    if (draft && !window.confirm('放弃当前尚未提交的办理内容？')) return;
    setDraft(null); setMessage('');
    const next = { ...selection, ...values }, params = new URLSearchParams();
    Object.entries(next).forEach(([k,v]) => { if (v) params.set(k,v); });
    onQueryChange(location.pathname + '?' + params, push); setSelection(next);
  }
  function start(action, row = null) {
    if (lock.current || draft) return;
    if (['assign','reassign','term-todo'].includes(action)) setAssignees(null);
    setMessage(''); setError(null);
    setDraft({ action, id:row?.id, type:row?.conflict_type, base:row ? JSON.stringify(row) : null, dirty:true, uncertain:false, stale:false,
      requestId: action === 'term-todo' ? crypto.randomUUID() : undefined,
      values: action === 'term-todo' ? { to_dept_id:'', content:'' } : terms ? { term:row?.term || '', definition:row?.definition || '', scope:row?.scope || '', forbidden:row?.forbidden || '', process_id:row?.process_id || '', term_type_code:row?.term_type_code || catalog?.types?.[0]?.code || '' } : { assignee_user_id:'', result:'', note:'', resolution:'' } });
  }
  function patch(key, value) { setDraft({ ...draft, values:{ ...draft.values, [key]:value } }); }
  function cancel() { if (!lock.current && window.confirm('放弃当前尚未提交的办理内容？结果不明时请先核对最新记录。')) { setDraft(null); setError(null); } }
  async function submit(event) {
    event.preventDefault(); if (lock.current || !draft || draft.uncertain || draft.stale) return;
    if (terms && ['create','edit'].includes(draft.action) && !draft.values.term.trim()) {
      setError(new Error('请填写术语名称，不能只填写空格。'));
      formRef.current?.querySelector('[aria-label="术语名称"]')?.focus(); return;
    }
    if (draft.action === 'term-todo' && !draft.values.content.trim()) { setError(new Error('请填写本次待办的具体办理内容。')); return; }
    lock.current = true; setBusy(true); setError(null); let sent = false;
    try {
      if (draft.id) {
        const current = terms ? (await api.request(apiRoot)).find(r => String(r.id) === String(draft.id)) : await api.request(detailPath(draft.id));
        if (!alive.current) return;
        if (!current || JSON.stringify(current) !== draft.base) { setDraft({ ...draft, stale:true }); throw new Error('原记录已变化。当前输入保留，请刷新核对，取消本次办理后重新选择动作。'); }
      }
      const action = draft.action;
      let url = apiRoot, method = 'POST', body = draft.values;
      if (terms) {
        if (action === 'term-todo') { url = '/api/todos'; body = { ...draft.values, type:'terminology', related_term_id:String(draft.id), request_id:draft.requestId }; }
        if (action === 'edit') { url += '/' + draft.id; method = 'PUT'; }
        if (['approve','reject'].includes(action)) { url += '/' + draft.id + '/review'; body = { action }; }
        if (action === 'delete') { url += '/' + draft.id; method = 'DELETE'; body = undefined; }
        if (['create','edit'].includes(action)) body = { ...body, process_id:Number(body.process_id) };
      } else {
        url += action === 'detect' ? '/detect' : `/${draft.id}/${action === 'reassign' ? 'assign' : action}?type=${draft.type}`;
        if (action === 'reassign') method = 'PUT';
        if (['assign','reassign'].includes(action)) body = { assignee_user_id:Number(body.assignee_user_id) };
      }
      sent = true; const result = await api.request(url, { method, body });
      if (!alive.current) return;
      if (action === 'term-todo' && (!Number.isSafeInteger(result?.id) || result.id <= 0)) throw new Error('创建回执缺少有效待办编号，请保留输入并核对待办列表。');
      setDraft(null); setMessage(action === 'term-todo' ? `术语待办 #${result.id} 已创建，请到待办收到核对。` : action === 'detect' ? `检测已完成，新建 ${result.detected} 条冲突；请核对记录。` : '操作已完成，请核对最新记录。');
      if (action === 'delete') {
        const next = { ...selection, id:'' }, params = new URLSearchParams(next); params.delete('id');
        onQueryChange(location.pathname + '?' + params, false); setSelection(next);
      }
      setRevision(n => n + 1);
    } catch (e) {
      if (!alive.current) return;
      // A 401 unmounts this component; the App-held draft is retained for the same identity.
      if (sent && (!e.status || e.status >= 500) && e.name !== 'AbortError') setDraft({ ...draft, uncertain:true });
      setError(e);
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const sameDepartment = detail && String(detail.process_owner_dept_id) === String(user.departmentId);
  const assignee = detail?.currentAssignee;
  const assignedToMe = assignee && String(assignee.assignee_person_id || assignee.assignee_user_id) === String(user.personId);
  const submittedByMe = detail?.coordinationHistory?.some(r => String(r.assignee_person_id || r.assignee_user_id) === String(user.personId));
  const actionNames = { 'term-todo':'创建术语待办', create:'新增术语', edit:'修改术语', approve:'审核通过', reject:'审核驳回', delete:'删除待审术语', assign:'指定责任人', reassign:'改派责任人', coordination:'提交协调结果', 'final-decide':detail?.status === 'escalated' ? '决定升级事项' : '形成处理决定', escalate:'升级冲突', reopen:'重新打开', archive:'归档冲突', detect:'检测冲突' };
  const actionButton = action => <button key={action} disabled={Boolean(draft) || busy} onClick={() => start(action, detail)}>{actionNames[action]}</button>;
  return <div className="identity-module governance-utilities">
    <section className="card"><h2>{terms ? '查阅和维护术语词典' : '协调和处理冲突'}</h2>
      <p>{terms ? '按现有流程归属申报、维护和审核术语。流程选项沿用已有记录，实际归属仍须以业务确认结果为准。' : '先查看双方内容、当前责任人和处理历史，再选择当前身份可办理的动作。处理决定保留在冲突记录中，不自动修改术语或字段定义。'}</p>
      <div className="identity-actions"><button disabled={busy} onClick={() => setRevision(n => n + 1)}>刷新{title}</button><a href={terms ? '/#/terms' : '/#/conflicts'} onClick={onLegacy}>原{terms ? '术语词典' : '冲突管理'}入口</a></div>
      {message && <StatusPanel title={message}/>}
      {error && <StatusPanel kind="error" title={`${title}读取或办理未完成`} onRetry={() => setRevision(n => n + 1)}>{error.message}</StatusPanel>}
      <div className="identity-fields"><Field label={`${title}状态`}><select disabled={busy} value={selection.status || ''} onChange={e => changeQuery({ status:e.target.value })}><option value="">全部可见状态</option>{(terms ? ['pending','approved','rejected'] : ['pending','coordinating','escalated','resolved',...(can('read-global') ? ['silenced','archived'] : [])]).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></Field>
      {!terms && <><Field label="冲突类型"><select disabled={busy} value={selection.filterType || ''} onChange={e => changeQuery({ filterType:e.target.value })}><option value="">全部类型</option><option value="field">字段</option><option value="term">术语</option></select></Field><Field label="严重程度"><select disabled={busy} value={selection.severity || ''} onChange={e => changeQuery({ severity:e.target.value })}><option value="">全部级别</option>{['blocking','error','high','medium','low','warn'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field></>}
      </div>
      {terms && can('draft-department') && <button disabled={!catalog || Boolean(draft)} onClick={() => start('create')}>新增术语</button>}
      {!terms && (can('quality-audit') || can('structure-gate')) && <button disabled={Boolean(draft) || busy} onClick={() => start('detect')}>检测冲突</button>}
    </section>
    {!catalog && !error && <StatusPanel kind="loading" title={`正在读取${title}…`}/>}
    {catalog && <section className="card" {...{ [terms ? 'data-terms-ready' : 'data-conflicts-ready']:true }}><h3>{title}列表</h3><p>当前条件下可见 {catalog.rows.length} 条记录。{!terms && '归档与静默记录按现有全局读取权限查阅。'}</p>
      {!terms && <section data-conflict-overview aria-label="当前冲突数量概览">
        <h4>当前冲突数量概览</h4>
        <p>仅统计当前筛选条件下接口返回的可见记录，不代表全平台总量。待协调包括待处理和协调中；静默与归档分别计数，未知状态仅计入当前显示。</p>
        <Table headers={['待协调','已升级','已静默','已归档','当前显示']} rows={[[
          catalog.rows.filter(r => ['pending','coordinating'].includes(r.status)).length,
          ...['escalated','silenced','archived'].map(status => catalog.rows.filter(r => r.status === status).length),
          catalog.rows.length
        ]]}/>
      </section>}
      <Table headers={terms ? ['编号','类型','术语','定义','流程 / 部门','状态','操作'] : ['编号 / 类型','冲突对象','A 方 / B 方','严重程度','状态','截止日期','操作']} empty={`暂无符合条件的${title}记录`} rows={catalog.rows.map(r => terms ? [r.id,r.term_type_name || r.term_type_code,r.term,r.definition,`${r.process_name || '未关联流程'} / ${r.process_dept_name || '归属待明确'}`,statusLabel(r.status),<button disabled={busy} onClick={() => changeQuery({ id:String(r.id) }, true)}>查看术语 {r.id}</button>] : [recordKey(r,false),subject(r),`${r.dept_a_name || r.dept_a || '未提供'} / ${r.dept_b_name || r.dept_b || '未提供'}`,label(r.severity),label(r.status),r.deadline || '未设置',<button disabled={busy} onClick={() => changeQuery({ id:String(r.id),type:r.conflict_type }, true)}>查看冲突 {recordKey(r,false)}</button>])}/>
    </section>}
    {selectedId && !detail && !detailError && <StatusPanel kind="loading" title="正在读取所选记录…"/>}
    {detailError && <StatusPanel kind="error" title={`${title}详情暂不可用`} onRetry={() => setRevision(n => n + 1)}>{detailError.message}</StatusPanel>}
    {detail && <section className="card" {...{ [terms ? 'data-term-detail' : 'data-conflict-detail']:true }}><h3>{terms ? detail.term : subject(detail)} · {statusLabel(detail.status)}</h3>
      {terms ? <><dl><dt>术语类型</dt><dd>{detail.term_type_name || detail.term_type_code}</dd><dt>定义</dt><dd>{detail.definition || '未提供'}</dd><dt>适用范围</dt><dd>{detail.scope || '未提供'}</dd><dt>禁用表述</dt><dd>{detail.forbidden || '未提供'}</dd><dt>流程与归口部门</dt><dd>{detail.process_name || '未提供'} / {detail.process_dept_name || '待明确'}</dd><dt>创建与审核</dt><dd>创建人员 {detail.created_by_person_id || detail.created_by || '未提供'} · {detail.created_at || '未提供'}；审核人员 {detail.approved_by_person_id || detail.approved_by || '未提供'} · {detail.approved_at || '未提供'}</dd></dl>
        <div className="identity-actions">{sameDepartment && can('draft-department') && detail.status === 'pending' && ['edit','delete'].map(actionButton)}{sameDepartment && can('review-department') && ['approve','reject'].map(actionButton)}{can('assign-work') && !perms.includes('identity:manage-account') && actionButton('term-todo')}<a href="/app/todos?type=terminology" onClick={onLegacy}>查看术语待办</a></div></> : <>
        <p data-conflict-summary>冲突编号：{selectedType}-{detail.id}；类型：{selectedType === 'term' ? '术语冲突' : '字段冲突'}；严重程度：{label(detail.severity)}</p>
        <div className="conflict-comparison">{['a','b'].map(side => <section key={side}><h4>{side.toUpperCase()} 方 · {detail[`dept_${side}_name`] || detail[`dept_${side}`] || '部门待明确'}</h4>{selectedType === 'field' && <p>字段名称：{detail[`field_name_${side}`] || '历史记录未提供'}</p>}<p>{selectedType === 'term' ? detail[`dept_${side}_meaning`] || '定义未提供' : detail[`value_${side}`] ?? '值未提供'}</p><p>来源{selectedType === 'term' ? '术语' : '字段'}标识：{detail[selectedType === 'term' ? `term_${side}_id` : `field_entry_${side}_id`] || '历史记录未提供'}</p></section>)}</div>
        <p>当前责任人：{assignee?.assignee_name || '尚未指定'}；截止日期：{detail.deadline || '未设置'}。{detail.escalated ? '记录标记为已升级；未据此推断升级原因或发生时间。' : ''}</p><p>处理决定：{detail.resolution || '尚未记录'} · 处理人员 {detail.resolved_by || '未提供'} · {detail.resolved_at || '未提供'}</p>
        <div className="identity-actions">{can('assign-work') && ['pending','coordinating'].includes(detail.status) && actionButton(detail.currentAssignee && detail.status === 'coordinating' ? 'reassign' : 'assign')}{can('handle-assigned-conflict') && assignedToMe && detail.status === 'coordinating' && !submittedByMe && actionButton('coordination')}{can('handle-assigned-conflict') && assignedToMe && detail.status === 'coordinating' && detail.bothSubmitted && actionButton('final-decide')}{can('decide-escalation') && detail.status === 'escalated' && actionButton('final-decide')}{can('escalate-conflict') && (assignedToMe || can('assign-work')) && detail.status === 'coordinating' && actionButton('escalate')}{can('assign-work') && detail.status === 'resolved' && actionButton('reopen')}{can('structure-gate') && detail.status === 'resolved' && actionButton('archive')}</div>
        <ConflictHistory detail={detail}/>
        <h4>分派历史</h4><Table headers={['时间','责任人','分派人']} rows={(detail.assignmentHistory || []).map(r => [r.created_at,r.assignee_name || r.assignee_person_id || r.assignee_user_id,r.assigned_by_name || r.assigned_by_person_id || r.assigned_by])}/>
        <h4>协调历史</h4><Table headers={['时间','处理人','协调结果','依据']} rows={(detail.coordinationHistory || []).map(r => [r.created_at,r.assignee_name || r.assignee_person_id || r.assignee_user_id,label(r.result),r.note || '未提供'])}/>
      </>}
      {!draft && <p className="muted">只提供当前权限和状态下的办理入口；最终权限与状态由服务端复核。</p>}
    </section>}
    {draft && <section className="card"><h3>{actionNames[draft.action]}</h3><p>输入仅保留在当前页面内存。刷新列表不提交输入；重新载入网页或离开前请处理未提交内容。</p>
      {draft.uncertain && <StatusPanel kind="error" title="写入结果不明，已阻止重复提交">请刷新核对记录及处理历史。当前输入保留，确认结果后取消本次办理；不要直接重放写入。</StatusPanel>}
      {draft.stale && <StatusPanel kind="error" title="原记录已变化，当前输入保留">请刷新核对，取消本次办理后重新选择动作。</StatusPanel>}
      <form ref={formRef} onSubmit={submit}><fieldset disabled={busy || draft.uncertain || draft.stale}><legend>{actionNames[draft.action]}内容</legend>
        {draft.action === 'term-todo' && <><p>关联术语 #{draft.id}：{detail?.term || '正在重新核对'}。请明确选择接收部门；创建待办不改变术语审核状态，也不授予接收方新的读取权限。</p><div className="identity-fields"><Field label="接收部门"><select required value={draft.values.to_dept_id} onChange={e => patch('to_dept_id', e.target.value)}><option value="">请选择接收部门</option>{(assignees || []).filter(d => d.status === 'active').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="待办办理内容"><textarea required maxLength={4000} value={draft.values.content} onChange={e => patch('content', e.target.value)}/></Field></div>{pickerError && <StatusPanel kind="error" title="接收部门读取失败" onRetry={() => setPickerRevision(n => n + 1)}>{pickerError.message}</StatusPanel>}{assignees && !assignees.some(d => d.status === 'active') && <p>没有可选择的有效接收部门。</p>}</>}
        {terms && ['create','edit'].includes(draft.action) && <div className="identity-fields"><Field label="术语名称" required maxLength={255} value={draft.values.term} onChange={e => patch('term',e.target.value)}/><Field label="术语类型"><select required value={draft.values.term_type_code} onChange={e => patch('term_type_code',e.target.value)}><option value="">请选择</option>{(catalog?.types || []).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field><Field label="所属业务流程"><select required value={draft.values.process_id} onChange={e => patch('process_id',e.target.value)}><option value="">请选择本部门关联流程</option>{(catalog?.processes || []).map(p => <option key={p.id} value={p.id}>{p.name}（{p.dept_name || '归属待明确'}）</option>)}</select></Field><Field label="定义"><textarea value={draft.values.definition} onChange={e => patch('definition',e.target.value)}/></Field><Field label="适用范围" value={draft.values.scope} onChange={e => patch('scope',e.target.value)}/><Field label="禁用表述" value={draft.values.forbidden} onChange={e => patch('forbidden',e.target.value)}/></div>}
        {['assign','reassign'].includes(draft.action) && <><Field label="冲突处理人"><select required value={draft.values.assignee_user_id} onChange={e => patch('assignee_user_id',e.target.value)}><option value="">请选择有效冲突处理人</option>{(assignees || []).map(p => <option key={p.id} value={p.id}>{p.name}（{p.dept_name || '部门未提供'}）</option>)}</select></Field>{pickerError ? <StatusPanel kind="error" title="责任人列表读取失败" onRetry={() => setPickerRevision(n => n + 1)}>{pickerError.message}</StatusPanel> : assignees && !assignees.length && <p>没有可分派的有效冲突处理人。</p>}</>}
        {draft.action === 'coordination' && <><Field label="协调选择"><select required value={draft.values.result} onChange={e => patch('result',e.target.value)}><option value="">请选择</option>{['A','B','compromise'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field><Field label="协调依据"><textarea required value={draft.values.note} onChange={e => patch('note',e.target.value)}/></Field></>}
        {draft.action === 'final-decide' && <Field label="处理决定与依据"><textarea required value={draft.values.resolution} onChange={e => patch('resolution',e.target.value)}/></Field>}
        {['approve','reject','delete','escalate','reopen','archive','detect'].includes(draft.action) && <p>请确认执行“{actionNames[draft.action]}”{draft.id ? `，对象编号 ${draft.id}` : ''}。{draft.action === 'delete' && '此操作删除本部门待审术语，提交后不能在此页面撤销。'}{draft.action === 'detect' && '服务端会检查现有术语与字段，并按原规则创建冲突和关联待办；只读取页面不会触发检测。'}</p>}
        <button className="primary" type="submit" disabled={(terms && ['create','edit'].includes(draft.action) && !catalog) || (['assign','reassign','term-todo'].includes(draft.action) && !assignees)}>{busy ? '正在提交…' : '确认提交'}</button>
      </fieldset><button type="button" disabled={busy} onClick={cancel}>取消本次办理</button></form>
    </section>}
  </div>;
}
