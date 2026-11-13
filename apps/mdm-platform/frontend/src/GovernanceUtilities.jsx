import {businessName,businessFieldLabel,businessStatus,businessText,userMessage} from "./businessPresentation.js";
import {businessDateTime,historicalPersonName} from './businessGuidance.js';
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { IdentityField as Field, IdentityTable as Table } from './IdentityShared.jsx';
import './governance-utilities.css';
import { ConflictHistory } from './ConflictHistory.jsx';
import { governanceAdministrator } from './rolePresentation.js';
import {conflictRequestActions,conflictWorkflowWrite,conflictWorkflowState,conflictDepartmentDecision,conflictRecheckReason,conflictWorkflowCounts,currentConflictProposal,conflictRecheckReady,conflictRecheckUnavailable} from './conflictWorkflowPresentation.js';

const labels = { pending:'待处理', approved:'已通过', rejected:'已驳回', coordinating:'协调中', escalated:'已升级', resolved:'已解决', silenced:'已静默', archived:'已归档', blocking:'阻断', error:'严重', high:'高', medium:'中', low:'低', warn:'警告', A:'支持 A 方', B:'支持 B 方', compromise:'折中方案' };
const label = value => labels[value] || businessStatus(value);
const conflictAttributes = { field_type:'字段类型', sync_mode:'同步方式', consume_systems:'消费系统', data_object:'数据对象', field_name_cn:'中文字段名', field_name_en:'英文字段名' };
const subject = row => {
  if (row.conflict_type === 'term' || row.term) return row.term || '术语名称未提供';
  const names = [...new Set([row.field_name_a, row.field_name_b].filter(Boolean))];
  const attribute = conflictAttributes[row.conflict_field] || businessFieldLabel(row.conflict_field) || '冲突属性待补充';
  return `${names.join(' / ') || '字段名称待补充'} · ${attribute}`;
};
const query = () => Object.fromEntries(new URLSearchParams(location.search));

// One shared request/draft lifecycle for the two existing governance API families.
// Drafts live in App and remain bound to the current person and department.
export function GovernanceUtilities({ api, user, kind, draft, setDraft, draftBlocked = false, onNavigate, onQueryChange }) {
  const terms = kind === 'terms', title = terms ? '术语' : '冲突';
  const statusLabel = value => terms && value === 'pending' ? '待审' : label(value);
  const [selection, setSelection] = useState(query), [revision, setRevision] = useState(0);
  const [catalog, setCatalog] = useState(null), [error, setError] = useState(null), [detail, setDetail] = useState(null), [detailError, setDetailError] = useState(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [assignees, setAssignees] = useState(null), [pickerError, setPickerError] = useState(null), [pickerRevision, setPickerRevision] = useState(0);
  const alive = useRef(false), lock = useRef(false), formRef = useRef(null);
  const perms = user.permissions || [], readOnly=governanceAdministrator(user)||!terms&&detail?.read_only===true, can = code => !readOnly&&perms.includes('governance:' + code);
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
    if (readOnly || lock.current || draft || draftBlocked) return;
    if(!terms&&conflictRequestActions.has(action)&&!conflictRecheckReady(row)){setError(new Error(conflictRecheckUnavailable));return;}
    if(!terms&&action!=='detect'&&!row?.allowed_actions?.includes(action))return;
    if (['assign','reassign','term-todo'].includes(action)) setAssignees(null);
    setMessage(''); setError(null);
    setDraft({ action, id:row?.id, type:row?.conflict_type, base:row ? JSON.stringify(row) : null, expectedToken:row?.write_token, dirty:true, uncertain:false, stale:false,
      requestId: action === 'term-todo'||!terms&&conflictRequestActions.has(action) ? crypto.randomUUID() : undefined,
      values: action === 'term-todo' ? { to_dept_id:'', content:'' } : terms ? { term:row?.term || '', definition:row?.definition || '', scope:row?.scope || '', forbidden:row?.forbidden || '', process_id:row?.process_id || '', term_type_code:row?.term_type_code || catalog?.types?.[0]?.code || '' } : { assignee_user_id:'', result:'', note:'', resolution:'',decision:'',basis:'' } });
  }
  function patch(key, value) { if(!readOnly&&!draft?.uncertain&&!draft?.stale)setDraft({ ...draft,...(key==='assignee_user_id'?{assigneeName:assignees?.find(row=>String(row.id)===String(value))?.name||null}:{}),values:{ ...draft.values, [key]:value } }); }
  function cancel() { if (!lock.current && window.confirm('放弃当前尚未提交的办理内容？结果不明时请先核对最新记录。')) { setDraft(null); setError(null); } }
  async function submit(event, sameRequest = false) {
    event.preventDefault(); if (readOnly || lock.current || !draft || (!sameRequest && (draft.uncertain || draft.stale))) return;
    const trackedConflict=!terms&&conflictRequestActions.has(draft.action);
    if(trackedConflict&&!conflictRecheckReady(detail)){setError(new Error(conflictRecheckUnavailable));return;}
    if (sameRequest && (draft.action !== 'term-todo'&&!trackedConflict || !draft.uncertain || !draft.submittedBody)) return;
    if(!terms&&!sameRequest&&draft.action!=='detect'&&!detail?.allowed_actions?.includes(draft.action))return;
    if (terms && ['create','edit'].includes(draft.action) && !draft.values.term.trim()) {
      setError(new Error('请填写术语名称，不能只填写空格。'));
      formRef.current?.querySelector('[aria-label="术语名称"]')?.focus(); return;
    }
    if (draft.action === 'term-todo' && !draft.values.content.trim()) { setError(new Error('请填写本次待办的具体办理内容。')); return; }
    lock.current = true; setBusy(true); setError(null); let sent = false, submittedBody = draft.submittedBody,submittedRequest=draft.submittedRequest,savedReceipt=draft.savedReceipt;
    try {
      if (draft.id && (!sameRequest||trackedConflict)) {
        const current = terms ? (await api.request(apiRoot)).find(r => String(r.id) === String(draft.id)) : await api.request(detailPath(draft.id));
        if (!alive.current) return;
        if(trackedConflict&&!conflictRecheckReady(current)){setDetail(current);throw new Error(conflictRecheckUnavailable);}
        if (!current || !sameRequest&&JSON.stringify(current) !== draft.base) { setDraft({ ...draft, stale:true }); throw new Error('原记录已变化。当前输入保留，请刷新核对，取消本次办理后重新选择动作。'); }
      }
      const action = draft.action;
      let url = apiRoot, method = 'POST', body = draft.values;
      if (terms) {
        if (action === 'term-todo') { url = '/api/todos'; body = { ...draft.values, type:'terminology', related_term_id:String(draft.id), request_id:draft.requestId }; }
        if (action === 'edit') { url += '/' + draft.id; method = 'PUT'; }
        if (['approve','reject'].includes(action)) { url += '/' + draft.id + '/review'; body = { action }; }
        if (action === 'delete') { url += '/' + draft.id; method = 'DELETE'; body = {}; }
        if (['create','edit'].includes(action)) body = { ...body, process_id:Number(body.process_id) };
      } else {
        url += action === 'detect' ? '/detect' : `/${draft.id}/${action === 'reassign' ? 'assign' : action}?type=${draft.type}`;
        if (action === 'reassign') method = 'PUT';
        if (['assign','reassign'].includes(action)) body = { assignee_user_id:String(body.assignee_user_id) };
      }
      if (draft.id && action !== 'term-todo') body = { ...body, expected_token:draft.expectedToken };
      if(trackedConflict){
        const request=sameRequest?draft.submittedRequest:conflictWorkflowWrite(draft);
        if(!request?.body||request.body.request_id!==draft.requestId)throw new Error('原请求内容尚不能准确核对，请保留输入并查看原冲突记录。');
        ({url,method,body}=request);submittedBody=body;submittedRequest=request;
        setDraft({...draft,submittedBody,submittedRequest,uncertain:true});
      }
      if (action === 'term-todo') {
        body = sameRequest ? draft.submittedBody : body;
        submittedBody = body;
        // Preserve the exact sent request before identity changes or lost responses.
        setDraft({ ...draft, submittedBody, uncertain:true });
      }
      if (action !== 'term-todo'&&!trackedConflict) setDraft({ ...draft, uncertain:true });
      sent = true; const result = await api.request(url, { method, body });
      if (!alive.current) return;
      if (action === 'term-todo' && (!Number.isSafeInteger(result?.id) || result.id <= 0)) throw new Error('创建回执缺少有效待办编号，请保留输入并核对待办列表。');
      let conflictMessage='';
      if(trackedConflict){
        if(result?.success!==true||result.request_id!==draft.requestId||typeof result.event_id!=='string'||!Number.isSafeInteger(result.workflow_revision))throw new Error('保存回执尚不能与原请求对应，请保留原内容并核对结果。');
        savedReceipt=result;setDraft({...draft,submittedBody,submittedRequest,savedReceipt,uncertain:true});
        const saved=await api.request(detailPath(draft.id));
        if(!alive.current)return;
        if(String(saved.id)!==String(draft.id)||!saved.workflow_history?.some(row=>row.event_id===result.event_id&&row.revision_no===result.workflow_revision))throw new Error('已取得保存回执，尚未读到对应办理历史。原请求保留，请继续核对。');
        setDetail(saved);
        conflictMessage=action==='final-decide'?'处理方案或项目决定已保存，尚待受影响部门负责人分别重新核对；本次操作不表示冲突已关闭。':action==='reopen'?'已重新打开办理轮，原记录继续保留；请按本事项当前允许的动作继续。':saved.workflow_state==='resolved'?'本人重新核对已保存，全部受影响部门已完成有效确认，当前冲突已关闭。':'本人重新核对已保存；请在本事项查看其余部门的办理情况及后续去向，不代替其他部门确认。';
      }
      setDraft(null); setMessage(conflictMessage|| (action === 'term-todo' ? '术语待办已创建，请到收到的待办核对。' : action === 'detect' ? `检测已完成，新建 ${result.detected} 条冲突；请核对记录。` : '操作已完成，请核对最新记录。'));
      if (action === 'delete') {
        const next = { ...selection, id:'' }, params = new URLSearchParams(next); params.delete('id');
        onQueryChange(location.pathname + '?' + params, false); setSelection(next);
      }
      setRevision(n => n + 1);
    } catch (e) {
      if (!alive.current) return;
      // A 401 unmounts this component; the App-held draft is retained for the same identity.
      if(sent&&trackedConflict){
        const uncertain=Boolean(savedReceipt)||sameRequest||!e.status||e.status>=500||e.status===401;
        setDraft({...draft,submittedBody,submittedRequest,savedReceipt,uncertain,stale:!uncertain&&(e.status===409||draft.stale)});
      }else if (sent && draft.action === 'term-todo') {
        const uncertain = sameRequest || !e.status || e.status >= 500 || e.status === 409;
        setDraft({ ...draft, submittedBody, uncertain });
        const explanations = {
          TODO_TERM_UNAVAILABLE:'关联术语不存在或不在当前可读取范围内，已停止定位。当前输入和原提交内容保留。',
          TODO_TERM_REQUEST_CONFLICT:'先前提交与当前内容不一致，请核对原待办及办理记录。当前输入保留，不会另建一条待办。',
          TODO_TERM_REQUEST_DELETED:'原请求创建的待办已删除，历史仍保留，不能用原请求重新创建。',
          TODO_TERM_BUSY:'原请求仍在处理中，请稍后明确按原请求核对结果。',
          TODO_TERM_INVALID:'所选术语、待办内容或接收部门不符合当前要求，请核对后再操作。'
        };
        if (explanations[e.code]) e.message = explanations[e.code];
      } else if (sent) setDraft({ ...draft, uncertain:!e.status || e.status >= 500 || e.status === 401, stale:e.status === 409 || draft.stale });
      setError(e);
    } finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const sameDepartment = detail && String(detail.process_owner_dept_id) === String(user.departmentId);
  const assignee = detail?.currentAssignee;
  const currentProposal=currentConflictProposal(detail?.workflow_history);
  const actionNames = { 'term-todo':'创建术语待办', create:'新增术语', edit:'修改术语', approve:'审核通过', reject:'审核驳回', delete:'删除待审术语', assign:'指定责任人', reassign:'改派责任人', coordination:'提交协调结果', 'final-decide':detail?.status === 'escalated' ? '记录项目决定并交部门核对' : '记录处理方案并交部门核对', 'department-recheck':'本人重新核对本部门',escalate:'升级冲突', reopen:'重新打开', archive:'归档冲突', detect:'检测冲突' };
  const actionButton = action => <button key={action} disabled={Boolean(draft) || busy || draftBlocked} onClick={() => start(action, detail)}>{actionNames[action]}</button>;
  return <div className="identity-module governance-utilities">
    <section className="card"><h2>{terms ? '查阅和维护术语词典' : '协调和处理冲突'}</h2>
      <p>{terms ? '按现有流程归属申报、维护和审核术语。流程选项沿用已有记录，实际归属仍须以业务确认结果为准。' : '先查看双方内容、当前责任人和处理历史，再选择当前身份可办理的动作。处理决定保留在冲突记录中，不自动修改术语或字段定义。'}</p>
      {readOnly&&<p role="note">当前管理员身份只读，兼任业务角色也不能{terms?'维护或审核术语':'检测、分派、协调或决定冲突'}。原办理输入保留供核对，不能在此身份下提交。</p>}
      <div className="identity-actions"><button disabled={busy} onClick={() => setRevision(n => n + 1)}>刷新{title}</button></div>
      {message && <StatusPanel title={message}/>}
      {error && <StatusPanel kind="error" title={`${title}读取或办理未完成`} onRetry={() => setRevision(n => n + 1)}>{userMessage(error)}</StatusPanel>}
      <div className="identity-fields"><Field label={`${title}状态`}><select disabled={busy} value={selection.status || ''} onChange={e => changeQuery({ status:e.target.value })}><option value="">全部可见状态</option>{(terms ? ['pending','approved','rejected'] : ['pending','coordinating','escalated','resolved',...(perms.includes('governance:read-global') ? ['silenced','archived'] : [])]).map(s => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></Field>
      {!terms && <><Field label="冲突类型"><select disabled={busy} value={selection.filterType || ''} onChange={e => changeQuery({ filterType:e.target.value })}><option value="">全部类型</option><option value="field">字段</option><option value="term">术语</option></select></Field><Field label="严重程度"><select disabled={busy} value={selection.severity || ''} onChange={e => changeQuery({ severity:e.target.value })}><option value="">全部级别</option>{['blocking','error','high','medium','low','warn'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field></>}
      </div>
      {terms && can('draft-department') && <button disabled={!catalog || Boolean(draft) || draftBlocked} onClick={() => start('create')}>新增术语</button>}
      {!terms && (can('quality-audit') || can('structure-gate')) && <button disabled={Boolean(draft) || busy || draftBlocked} onClick={() => start('detect')}>检测冲突</button>}
    </section>
    {!catalog && !error && <StatusPanel kind="loading" title={`正在读取${title}…`}/>}
    {catalog && <section className="card" {...{ [terms ? 'data-terms-ready' : 'data-conflicts-ready']:true }}><h3>{title}列表</h3><p>当前条件下可见 {catalog.rows.length} 条记录。{!terms && '归档与静默记录按现有全局读取权限查阅。'}</p>
      {!terms && <section data-conflict-overview aria-label="当前冲突数量概览">
        <h4>当前冲突数量概览</h4>
        <p>仅统计当前筛选条件下本人可查看的记录，不代表全平台总量。待协调、待负责人重核及需要修改方案分别计数；未知状态仅计入当前显示。</p>
        <Table headers={['待协调','待负责人重核','需修改或重新核对方案','已升级','已静默','已归档','当前显示']} rows={[[
          conflictWorkflowCounts(catalog.rows).coordinating,conflictWorkflowCounts(catalog.rows).recheck_pending,conflictWorkflowCounts(catalog.rows).recheck_returned,
          ...['escalated','silenced','archived'].map(status => catalog.rows.filter(r => r.status === status).length),
          catalog.rows.length
        ]]}/>
      </section>}
      <Table headers={terms ? ['类型','术语','定义','流程 / 部门','状态','操作'] : ['冲突对象','A 方 / B 方','严重程度','状态','截止日期','操作']} empty={`暂无符合条件的${title}记录`} rows={catalog.rows.map(r => terms ? [r.term_type_name || '类型名称未记录',r.term,r.definition,`${r.process_name || '未关联流程'} / ${r.process_dept_name || '归属待明确'}`,statusLabel(r.status),<button disabled={busy} onClick={() => changeQuery({ id:String(r.id) }, true)}>查看术语 {businessName(r)}</button>] : [subject(r),`${r.dept_a_name || '部门名称未记录'} / ${r.dept_b_name || '部门名称未记录'}`,label(r.severity),conflictWorkflowState(r),r.deadline || '未设置',<button disabled={busy} onClick={() => changeQuery({ id:String(r.id),type:r.conflict_type }, true)}>查看冲突：{businessText(subject(r),'冲突对象名称未记录')}</button>])}/>
    </section>}
    {selectedId && !detail && !detailError && <StatusPanel kind="loading" title="正在读取所选记录…"/>}
    {detailError && <StatusPanel kind="error" title={`${title}详情暂不可用`} onRetry={() => setRevision(n => n + 1)}>{userMessage(detailError)}</StatusPanel>}
    {detail && <section className="card" {...{ [terms ? 'data-term-detail' : 'data-conflict-detail']:true }}><h3>{terms ? detail.term : subject(detail)} · {terms?statusLabel(detail.status):conflictWorkflowState(detail)}</h3>
      {terms ? <><dl><dt>术语类型</dt><dd>{detail.term_type_name || '分类名称未记录'}</dd><dt>定义</dt><dd>{detail.definition || '未提供'}</dd><dt>适用范围</dt><dd>{detail.scope || '未提供'}</dd><dt>禁用表述</dt><dd>{detail.forbidden || '未提供'}</dd><dt>流程与归口部门</dt><dd>{detail.process_name || '未提供'} / {detail.process_dept_name || '待明确'}</dd><dt>创建与审核</dt><dd>创建人员 {detail.created_by_name || '姓名未记录'} · {detail.created_at || '未提供'}；审核人员 {detail.approved_by_name || '姓名未记录'} · {detail.approved_at || '未提供'}</dd></dl>
        <div className="identity-actions">{sameDepartment && can('draft-department') && detail.status === 'pending' && ['edit','delete'].map(actionButton)}{sameDepartment && can('review-department') && ['approve','reject'].map(actionButton)}{can('assign-work') && !perms.includes('identity:manage-account') && actionButton('term-todo')}<a href="/app/todos?type=terminology" onClick={onNavigate}>查看术语待办</a></div></> : <>
        <p data-conflict-summary>分歧类型：{selectedType === 'term' ? '术语冲突' : '字段冲突'}；严重程度：{label(detail.severity)}</p>
        <div className="conflict-comparison">{['a','b'].map(side => <section key={side}><h4>{side.toUpperCase()} 方 · {detail[`dept_${side}_name`] || '部门名称未记录'}</h4>{selectedType === 'field' && <p>字段名称：{detail[`field_name_${side}`] || '历史记录未提供'}</p>}<p>{selectedType === 'term' ? detail[`dept_${side}_meaning`] || '定义未提供' : detail[`value_${side}`] ?? '值未提供'}</p><p>来源{selectedType === 'term' ? '术语' : '字段'}名称：{detail[selectedType === 'term' ? `term_${side}_name` : `field_entry_${side}_name`] || '名称未记录'}</p></section>)}</div>
        <p>当前责任人：{assignee?.assignee_name || '尚未指定'}；截止日期：{detail.deadline || '未设置'}。{detail.escalated ? '记录标记为已升级；未据此推断升级原因或发生时间。' : ''}</p><p>原冲突记录的处理结果：{detail.resolution || '尚未记录'} · 原记录人员 {detail.resolved_by_name || '姓名未记录'} · {businessDateTime(detail.resolved_at)}。本轮方案及部门本人重新核对以下方记录为准。</p>
        {currentProposal&&<section data-conflict-current-proposal><h4>本轮处理方案或项目决定</h4><p style={{whiteSpace:'pre-wrap'}}>{businessText(currentProposal.basis,'原记录未留存方案或决定正文')}</p><p>记录人员：{businessText(currentProposal.actor_snapshot?.person_name,'当时姓名未记录')} · {businessDateTime(currentProposal.created_at)}</p><p>方案或决定须由各受影响部门负责人分别本人核对，不自动关闭冲突。</p></section>}
        {detail.recheck_notice&&<p role="note">{businessText(detail.recheck_notice,'请核对受影响部门的本人确认情况及当前办理条件。')}</p>}
        {!conflictRecheckReady(detail)&&<StatusPanel title="本次冲突暂不能提交新的重核办理">{conflictRecheckUnavailable}</StatusPanel>}
        <div className="identity-actions">{!readOnly&&['assign','reassign','coordination','final-decide','escalate','reopen','archive','department-recheck'].filter(action=>detail.allowed_actions?.includes(action)&&(!conflictRequestActions.has(action)||conflictRecheckReady(detail))).map(actionButton)}</div>
        {Array.isArray(detail.department_rechecks)&&detail.department_rechecks.length>0&&<section data-conflict-department-rechecks><h4>受影响部门负责人重新核对</h4><p>只按本冲突已保存的受影响部门办理。各部门负责人分别本人核对，处理方案或项目决定不代替部门确认。</p><Table headers={['受影响部门','重新核对结论','本人记录及依据','当前有效性']} rows={detail.department_rechecks.map(row=>[businessText(row.department_name,'原记录未留存部门名称'),conflictDepartmentDecision(row.decision),[businessText(row.person_name,'尚未留存本次确认人姓名'),row.basis?businessText(row.basis):'依据未记录'].join('；'),row.valid?'当前确认有效':conflictRecheckReason(row.reason)])}/></section>}
        {Array.isArray(detail.workflow_history)&&detail.workflow_history.length>0&&<details data-conflict-workflow-history><summary>处理方案与部门重新核对历史</summary>{detail.workflow_history.map(row=><article className="import-record" key={row.event_id}><h4>{({proposal_recorded:'记录处理方案或项目决定',department_rechecked:'部门负责人本人重新核对',reopened:'重新打开办理轮'})[row.action]||'冲突办理记录'}</h4><p>办理人：{businessText(row.actor_snapshot?.person_name,'当时姓名未记录')} · {businessDateTime(row.created_at)}</p>{row.decision&&<p>本人结论：{conflictDepartmentDecision(row.decision)}</p>}<p>依据：{businessText(row.basis,'原记录未留存依据')}</p></article>)}</details>}
        <ConflictHistory detail={detail}/>
        <h4>分派历史</h4><Table headers={['时间','责任人','分派人']} rows={(detail.assignmentHistory || []).map(r => [businessDateTime(r.created_at),r.assignee_name || '姓名未记录',r.assigned_by_name || '姓名未记录'])}/>
        <h4>协调历史</h4><Table headers={['时间','处理人','协调结果','依据']} rows={(detail.coordinationHistory || []).map(r => [businessDateTime(r.created_at),historicalPersonName(r),label(r.result),r.note || '未提供'])}/>
      </>}
      {!draft && <p className="muted">只提供当前权限和状态下的办理入口；最终权限与状态由服务端复核。</p>}
    </section>}
    {draft && <section className="card"><h3>{actionNames[draft.action]}</h3><p>输入仅保留在当前页面内存。刷新列表不提交输入；重新载入网页或离开前请处理未提交内容。</p>
      {draft.uncertain && <StatusPanel kind="error" title="写入结果不明，已阻止重复提交">{!terms&&conflictRequestActions.has(draft.action)?'原请求及原提交内容已保留并暂停修改。请查看同一冲突的办理历史；需要时明确使用原请求核对，若此前已保存将读取原回执，不会另建请求。':draft.action === 'term-todo' ? '原提交内容已保留。请先查看待办；需要时明确按原请求核对结果。本次核对可能完成原先尚未成功的创建操作；已经保存时会显示原记录，已删除时不会重建。继续办理仍核对本人资格、术语查阅范围及接收部门。' : '请刷新核对记录及处理历史。当前输入保留，确认结果后取消本次办理；不要直接重放写入。'}</StatusPanel>}
      {draft.stale && <StatusPanel kind="error" title="原记录已变化，当前输入保留">请刷新核对，取消本次办理后重新选择动作。</StatusPanel>}
      <form ref={formRef} onSubmit={submit}><fieldset disabled={readOnly || busy || draft.uncertain || draft.stale || !terms&&conflictRequestActions.has(draft.action)&&!conflictRecheckReady(detail)}><legend>{actionNames[draft.action]}内容</legend>
        {draft.action === 'term-todo' && <><p>关联术语：{businessName(draft)}：{detail?.term || '当前无法读取'}。保存后保持与该术语的关联；打开时查阅当前可见内容，不代表固定的历史版本。请明确选择接收部门；创建待办不改变术语审核状态，也不授予接收方新的读取权限。</p><div className="identity-fields"><Field label="接收部门"><select required value={draft.values.to_dept_id} onChange={e => patch('to_dept_id', e.target.value)}><option value="">请选择接收部门</option>{(assignees || []).filter(d => d.status === 'active').map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field><Field label="待办办理内容"><textarea required maxLength={4000} value={draft.values.content} onChange={e => patch('content', e.target.value)}/></Field></div>{pickerError && <StatusPanel kind="error" title="接收部门读取失败" onRetry={() => setPickerRevision(n => n + 1)}>{userMessage(pickerError)}</StatusPanel>}{assignees && !assignees.some(d => d.status === 'active') && <p>没有可选择的有效接收部门。</p>}</>}
        {terms && ['create','edit'].includes(draft.action) && <div className="identity-fields"><Field label="术语名称" required maxLength={255} value={draft.values.term} onChange={e => patch('term',e.target.value)}/><Field label="术语类型"><select required value={draft.values.term_type_code} onChange={e => patch('term_type_code',e.target.value)}><option value="">请选择</option>{(catalog?.types || []).map(t => <option key={t.code} value={t.code}>{t.name}</option>)}</select></Field><Field label="所属业务流程"><select required value={draft.values.process_id} onChange={e => patch('process_id',e.target.value)}><option value="">请选择本部门关联流程</option>{(catalog?.processes || []).map(p => <option key={p.id} value={p.id}>{p.name}（{p.dept_name || '归属待明确'}）</option>)}</select></Field><Field label="定义"><textarea value={draft.values.definition} onChange={e => patch('definition',e.target.value)}/></Field><Field label="适用范围" value={draft.values.scope} onChange={e => patch('scope',e.target.value)}/><Field label="禁用表述" value={draft.values.forbidden} onChange={e => patch('forbidden',e.target.value)}/></div>}
        {['assign','reassign'].includes(draft.action) && <><Field label="冲突处理人"><select required value={draft.values.assignee_user_id} onChange={e => patch('assignee_user_id',e.target.value)}><option value="">请选择有效冲突处理人</option>{draft.values.assignee_user_id&&!assignees?.some(row=>String(row.id)===String(draft.values.assignee_user_id))&&<option value={draft.values.assignee_user_id}>{draft.assigneeName?businessText(draft.assigneeName,'原选择人员姓名未记录'):'原选择人员当前不可读取，原选择保留'}</option>}{(assignees || []).map(p => <option key={p.id} value={p.id}>{p.name}（{p.dept_name || '部门未提供'}）</option>)}</select></Field>{pickerError ? <StatusPanel kind="error" title="责任人列表读取失败" onRetry={() => setPickerRevision(n => n + 1)}>{userMessage(pickerError)}</StatusPanel> : assignees && !assignees.length && <p>没有可分派的有效冲突处理人。</p>}</>}
        {draft.action === 'coordination' && <><Field label="协调选择"><select required value={draft.values.result} onChange={e => patch('result',e.target.value)}><option value="">请选择</option>{['A','B','compromise'].map(s => <option key={s} value={s}>{label(s)}</option>)}</select></Field><Field label="协调依据"><textarea required value={draft.values.note} onChange={e => patch('note',e.target.value)}/></Field></>}
        {draft.action === 'final-decide' && <><p>保存处理方案或项目决定后，交受影响部门负责人分别本人重新核对。各部门有效确认前，冲突不会因此关闭；被退回时须修改方案后重新交各部门核对。</p><Field label="处理方案或项目决定与依据"><textarea required value={draft.values.resolution} onChange={e => patch('resolution',e.target.value)}/></Field></>}
        {draft.action === 'department-recheck'&&<><p>本人只核对本部门一侧，不能代替其他部门确认；需要修改时明确退回处理方案并填写依据。</p><Field label="本人重新核对结论"><select required value={draft.values.decision} onChange={e=>patch('decision',e.target.value)}><option value="">请选择本人结论</option><option value="confirmed">本部门确认</option><option value="needs_changes">要求修改处理方案</option></select></Field><Field label="本人重新核对依据"><textarea required value={draft.values.basis} onChange={e=>patch('basis',e.target.value)}/></Field></>}
        {draft.action==='reopen'&&<Field label="重新打开原因"><textarea required value={draft.values.basis} onChange={e=>patch('basis',e.target.value)}/></Field>}
        {['approve','reject','delete','escalate','reopen','archive','detect'].includes(draft.action) && <p>请确认执行“{actionNames[draft.action]}”。{draft.action === 'delete' && '此操作删除本部门待审术语，提交后不能在此页面撤销。'}{draft.action === 'detect' && '服务端会检查现有术语与字段，并按原规则创建冲突和关联待办；只读取页面不会触发检测。'}</p>}
        <button className="primary" type="submit" disabled={(terms && ['create','edit'].includes(draft.action) && !catalog) || (['assign','reassign','term-todo'].includes(draft.action) && !assignees)}>{busy ? '正在提交…' : '确认提交'}</button>
      </fieldset>{(draft.action === 'term-todo'||!terms&&conflictRequestActions.has(draft.action)) && draft.uncertain && draft.submittedBody && <button type="button" disabled={readOnly || busy || !terms&&conflictRequestActions.has(draft.action)&&!conflictRecheckReady(detail)} onClick={event => { if (window.confirm(draft.action==='term-todo'?'按原请求编号和原提交内容调用创建接口核对？若此前未提交成功，本次可能创建待办；已删除的待办不会重建。':'使用原请求及原提交内容核对本次冲突办理结果？若原操作已保存，将读取原回执；不会另建请求。')) submit(event, true); }}>按原请求核对结果</button>}<button type="button" disabled={busy} onClick={cancel}>取消本次办理</button></form>
    </section>}
  </div>;
}
