import {userMessage} from './businessPresentation.js';
import {businessName,businessText} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { explicitOfficeTarget, initialOfficeSelection, officeTargetAvailable, officeTargetChoices, officeWorkbenchSelection } from './officeSelectionModel.js';
import './office-selection.css';

const ROOT = '/api/offices';
const same = (a, b) => String(a ?? '') === String(b ?? '');
const titles = { create:'交办到办公室', receive:'指定承接办公室', assign:'由办公室负责人分配人员', complete:'填写办理结果' };
const stateLabel = task => task.status === 'done' ? '已办结' : task.assignee_person_id ? '待办理' : '待分配';
function completion(task) {
  if (!task.completion_json) return '未记录办理结果';
  try { return businessText((typeof task.completion_json === 'string' ? JSON.parse(task.completion_json) : task.completion_json).note || '未记录办理结果'); }
  catch { return '办理结果暂不可读，请刷新办公室任务后核对。'; }
}
function mayAct(data, task, mode) {
  const office = data?.offices.find(o => same(o.id, task.office_id));
  if (!office || office.status !== 'active' || !office.department_id || task.status !== 'pending') return false;
  return mode === 'assign' ? data.can_assign : data.can_complete && same(task.assignee_person_id, data.actor_person_id);
}

export function OfficeSelectionPanel({data,officeId,loading,saving,checked,onChoose,onCheck,onStart,onReadChoices}) {
  const selected = data?.offices.find(office => same(office.id, officeId));
  const canChoose = Boolean(data?.offices.length);
  const ready = data?.office_selection_ready && officeTargetAvailable(data,officeId);
  return <>
    <div><label htmlFor="office-field-1">办公室</label><select id="office-field-1" value={officeId} disabled={!data || loading || saving} onChange={event=>onChoose(event.target.value)}>
      <option value="">{!data ? loading ? '正在核对办公室' : '办公室清单尚未读取' : canChoose ? '请选择办公室' : '暂无可查看的办公室'}</option>
      {officeId && !selected && <option value={officeId}>{data ? '原办公室当前不可查看，请重新选择' : '原办公室待核对'}</option>}
      {data?.offices.map(office=><option key={office.id} value={office.id}>{businessText(office.department_name || '归口部门待明确')} / {businessText(office.name)}{office.status !== 'active' ? '（未启用）' : ''}</option>)}
    </select></div>
    {selected && <p>归口部门：{businessText(selected.department_name || '待明确')}；办公室负责人：{businessText(selected.manager_name || '尚未指定')}；状态：{selected.status === 'active' ? '启用' : '未启用'}</p>}
    {!officeId && data && <p>请先主动选择要查阅或交办的办公室，再核对归口部门和负责人登记。系统不会按办公室列表顺序替您选择。</p>}
    {officeId && !selected && data && <p role="status">原办公室当前不在可查看清单中，原选择仍保留。请重新选择有权查看的办公室；当前没有切换到其他办公室。</p>}
    {selected && !data?.office_selection_ready && <p role="status">当前只读取了办公室清单。请点击“刷新办公室任务”核对所选办公室后再办理。</p>}
    {selected && !selected.manager_name && <p>此办公室尚未登记负责人，请向行政人事信息维护员核对负责人安排。交办不会自动指定负责人；任务后续须由已明确的负责人分配。</p>}
    {data?.can_route && officeTargetChoices(data).length > 0 && <>
      {ready && <label className="office-selection-check"><input type="checkbox" checked={Boolean(checked)} disabled={loading || saving} onChange={event=>onCheck(event.target.checked)} />我已核对所选办公室、归口部门和负责人登记</label>}
      <p>先完成办公室选择与核对，再点击“交办到办公室”填写工作内容。保存后在所选办公室的任务列表查看，由该办公室负责人继续分配。</p>
      <button className="primary" disabled={loading || saving || !ready || !checked} onClick={onStart}>交办到办公室</button>
    </>}
    {!data && !loading && officeId && <button type="button" className="secondary" disabled={saving} onClick={onReadChoices}>读取可选办公室</button>}
  </>;
}

export function OfficeWorkbench({ api, draft, setDraft, onNavigate }) {
  const [officeId, setOfficeId] = useState(() => initialOfficeSelection(draft,location.search));
  const [officeChecked, setOfficeChecked] = useState(false);
  const [data, setData] = useState(null);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const generation = useRef(0), active = useRef(null), posting = useRef(false), editor = useRef(null);
  useEffect(() => () => { ++generation.current; active.current?.abort(); }, []);
  useEffect(() => { if (draft) (editor.current?.querySelector('textarea') || editor.current?.querySelector('select, input'))?.focus(); }, [draft?.request_id]);
  function remember(id) {
    const url = new URL(location.href);
    id ? url.searchParams.set('office_id', id) : url.searchParams.delete('office_id');
    history.replaceState(history.state, '', url);
  }
  async function load(id = officeId, {keepSelection = false} = {}) {
    if (posting.current) return;
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current, requestedId = String(id || ''), retainedId = keepSelection ? officeId : requestedId;
    setLoading(true); setData(null); setError(''); setOfficeChecked(false);
    try {
      const result = await api.request(ROOT + '/workbench' + (id ? '?office_id=' + encodeURIComponent(id) : ''), { signal:controller.signal });
      if (token !== generation.current) return;
      setData(officeWorkbenchSelection(result,requestedId)); setOfficeId(retainedId); remember(retainedId);
    } catch (failure) { if (token === generation.current && failure.name !== 'AbortError') setError(failure.message); }
    finally { if (token === generation.current) setLoading(false); }
  }
  useEffect(() => { load(); }, []);
  function discard() {
    if (saving || (draft && !window.confirm('本次输入尚未提交，是否放弃？'))) return false;
    setDraft(null); setError(''); return true;
  }
  function switchOffice(id) {
    if (draft && !discard()) return;
    setSaved(false); setOfficeId(id); load(id);
  }
  function start(mode, task = null) {
    if (!data || saving || (draft && !discard())) return;
    if (mode === 'create' && (!data.office_selection_ready || !officeChecked || !officeTargetAvailable(data,officeId))) {
      setError('请先选择承接办公室，并核对归口部门和负责人登记。'); return;
    }
    const targetId = explicitOfficeTarget(data,officeId,task);
    setError(''); setSaved(false);
    setDraft({ mode, task, officeId, dirty:true, request_id:crypto.randomUUID(),
      office_id:targetId, office_checked:Boolean(targetId && officeChecked),
      content:'', due_date:'', urgency:'medium', process_version_id:'', behavior_ref:'', assignee_person_id:'', note:'' });
  }
  function update(key, value) { setDraft({ ...draft, [key]:value, ...(key === 'office_id' ? {office_checked:false} : {}), dirty:true }); setSaved(false); }
  const current = draft?.task && (draft.mode === 'receive' ? data?.unallocated : data?.tasks)?.find(t => same(t.id, draft.task.id));
  const stale = Boolean(draft && data && (
    !same(draft.officeId, officeId) ||
    (['assign','complete'].includes(draft.mode) && (!current || !same(current.revision_no, draft.task.revision_no) || !mayAct(data, current, draft.mode))) ||
    (['create','receive'].includes(draft.mode) && (!data.can_route || (draft.mode === 'receive' && !current)))
  ));
  async function submit(event) {
    event.preventDefault(); if (!draft || !data || loading || posting.current || stale) return;
    const { mode } = draft;
    if (['create','receive'].includes(mode) && (!officeTargetAvailable(data,draft.office_id,draft.task) || !draft.office_checked)) {
      setError('请明确选择当前可承接的办公室，并核对其归口部门和负责人登记后再提交。原输入仍保留。'); return;
    }
    if ((mode === 'create' && !draft.content.trim()) || (mode === 'complete' && !draft.note.trim()) || (mode === 'assign' && !draft.assignee_person_id)) {
      setError('请填写本次操作所需的内容或选择办理对象。'); return;
    }
    const payload = mode === 'create' ? {request_id:draft.request_id,office_id:draft.office_id,content:draft.content,due_date:draft.due_date,urgency:draft.urgency,process_version_id:draft.process_version_id,behavior_ref:draft.behavior_ref}
      : mode === 'receive' ? {office_id:draft.office_id} : mode === 'assign' ? {assignee_person_id:draft.assignee_person_id,expected_revision:draft.task.revision_no} : {note:draft.note,expected_revision:draft.task.revision_no};
    const token = generation.current; const controller = new AbortController(); active.current = controller;
    posting.current = true; setSaving(true); setError(''); setSaved(false);
    try {
      await api.request(ROOT + '/tasks' + (mode === 'create' ? '' : '/' + encodeURIComponent(draft.task.id) + '/' + mode), {method:'POST',body:payload,signal:controller.signal});
      if (token !== generation.current) return;
      setDraft(null); setSaved(true); posting.current = false; setSaving(false);
      await load(['create','receive'].includes(mode) ? draft.office_id : officeId);
    } catch (failure) {
      if (token === generation.current && failure.name !== 'AbortError') setError(failure.code === 'OFFICE_TASK_ALREADY_CREATED' ? '此交办请求已保存。请刷新列表核对；当前输入保留，不会重复创建任务。' : failure.message);
    } finally { posting.current = false; if (token === generation.current || !controller.signal.aborted) setSaving(false); }
  }
  const selected = data?.offices.find(o => same(o.id, officeId));
  const tasks = data?.tasks || [];
  const actionable = tasks.filter(t => mayAct(data,t,'assign') || mayAct(data,t,'complete')).slice(0,3);
  const options = officeTargetChoices(data,draft?.task);
  const draftOffice = options.find(office=>same(office.id,draft?.office_id));
  const version = data?.versions.find(v => same(v.id, draft?.process_version_id));
  return <div className="process-preview office-workbench" data-office-workbench-state={loading ? 'loading' : data ? 'ready' : 'error'} data-office-selection-state={data?.office_selection_ready ? 'selected' : 'unselected'}>
    <section className="card">
      <h2>办公室任务办理</h2><p>任务交到办公室后，由明确的负责人分配给成员。成员填写结果并办结；任务办结不等于问题关闭或正式审核通过。</p>
      <div className="import-actions"><button className="secondary" onClick={() => load()} disabled={loading || saving}>刷新办公室任务</button></div>
      <OfficeSelectionPanel data={data} officeId={officeId} loading={loading} saving={saving} checked={officeChecked} onChoose={switchOffice} onCheck={setOfficeChecked} onStart={()=>start('create')} onReadChoices={()=>load('',{keepSelection:true})} />
    </section>
    {loading && <StatusPanel kind="loading" title="正在读取办公室任务…" />}
    {error && <StatusPanel kind="error" title="本次操作未完成" onRetry={!data && !loading ? () => load() : undefined}>{userMessage(error)}</StatusPanel>}
    {saved && <StatusPanel title="本次操作已保存">请核对任务列表中的状态和办理结果。</StatusPanel>}
    {draft && <section className="card preview-editor" ref={editor} aria-label="办公室任务编辑">
      <h2>{titles[draft.mode]}</h2><p>输入仅保留在当前页面；确认提交后才写入。刷新列表不会替换本次输入。</p>
      {draft.task && <p>{businessText(draft.task.content)}</p>}
      {draft.task?.analysis_task && <section aria-label="问题办理上下文"><details><summary>查看本次办理说明</summary><p>{businessText(draft.task.analysis_task.instruction)}</p></details><p>绑定问题所选流程内容。仅提供本次办理说明；办结不会关闭问题，问题复核继续走原有权限流程。</p></section>}
      {stale && <StatusPanel kind="error" title="任务或办理权限已变化">原输入保留，不能按新修订自动提交。请核对当前任务，明确放弃后重新办理。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={saving}>
        {['create','receive'].includes(draft.mode) && <div><label htmlFor="office-field-2">承接办公室</label><select id="office-field-2" value={draft.office_id} onChange={e => update('office_id',e.target.value)}><option value="">请选择办公室</option>{!options.some(o => same(o.id,draft.office_id)) && draft.office_id && <option value={draft.office_id}>原承接办公室当前不可用，请重新核对</option>}{options.map(o => <option key={o.id} value={o.id}>{o.department_name} / {o.name}</option>)}</select></div>}
        {['create','receive'].includes(draft.mode) && <>
          {draftOffice ? <><p>本次承接：{businessText(draftOffice.department_name)} / {businessText(draftOffice.name)}；办公室负责人：{businessText(draftOffice.manager_name || '尚未指定')}。{!draftOffice.manager_name && '请向行政人事信息维护员核对负责人安排；保存不会自动指定负责人。'}</p><label className="office-selection-check"><input type="checkbox" checked={Boolean(draft.office_checked)} onChange={event=>update('office_checked',event.target.checked)} />我已核对本次承接办公室、归口部门和负责人登记</label></> : <p role="status">请明确选择当前可承接的办公室；原选择和填写内容仍保留，不会自动改为其他办公室。</p>}
        </>}
        {draft.mode === 'create' && <>
          <div><label htmlFor="office-field-3">工作内容</label><textarea id="office-field-3" rows={5} maxLength={16000} value={draft.content} onChange={e => update('content',e.target.value)} /></div>
          <div><label htmlFor="office-field-4">截止日期</label><input id="office-field-4" type="date" value={draft.due_date} onChange={e => update('due_date',e.target.value)} /></div>
          <div><label htmlFor="office-field-5">紧急程度</label><select id="office-field-5" value={draft.urgency} onChange={e => update('urgency',e.target.value)}><option value="medium">普通</option><option value="high">紧急</option><option value="low">较低</option></select></div>
          <div><label htmlFor="office-field-6">关联正式流程（可选）</label><select id="office-field-6" value={draft.process_version_id} onChange={e => { if (draft.behavior_ref && !window.confirm('切换流程会清除已选业务行为，是否继续？')) return; setDraft({...draft,process_version_id:e.target.value,behavior_ref:'',dirty:true}); }}><option value="">不关联流程</option>{draft.process_version_id && !version && <option value={draft.process_version_id}>原流程版本当前不可选，请重新核对</option>}{data?.versions.map(v => <option key={v.id} value={v.id}>{v.title} · {v.edition}版</option>)}</select></div>
          <div><label htmlFor="office-field-7">业务行为（可选）</label><select id="office-field-7" value={draft.behavior_ref} onChange={e => update('behavior_ref',e.target.value)}><option value="">整个流程</option>{draft.behavior_ref && !version?.behaviors.some(b => b.ref === draft.behavior_ref) && <option value={draft.behavior_ref}>原流程环节待核对</option>}{version?.behaviors.map(b => <option key={b.ref} value={b.ref}>{b.name}</option>)}</select></div>
        </>}
        {draft.mode === 'assign' && <div><label htmlFor="office-field-8">办理人</label><select id="office-field-8" value={draft.assignee_person_id} onChange={e => update('assignee_person_id',e.target.value)}><option value="">请选择办公室成员</option>{draft.assignee_person_id && !data?.members.some(p => same(p.person_id,draft.assignee_person_id) && p.status === 'active' && p.employment_status === 'active') && <option value={draft.assignee_person_id}>原办理人当前不可用，请重新核对</option>}{data?.members.filter(p => p.status === 'active' && p.employment_status === 'active').map(p => <option key={p.person_id} value={p.person_id}>{p.person_name}（{p.employee_no}）</option>)}</select></div>}
        {draft.mode === 'complete' && <div><label htmlFor="office-field-9">办理结果</label><textarea id="office-field-9" rows={6} maxLength={4000} value={draft.note} onChange={e => update('note',e.target.value)} /></div>}
        <button className="primary" type="submit" disabled={loading || !data || stale}>确认提交本次操作</button><button type="button" className="secondary" onClick={discard}>放弃本次输入</button>
      </fieldset></form>
    </section>}
    {data && <>
      {!data.office_selection_ready || !selected ? <StatusPanel title={data.offices.length ? '尚未读取所选办公室的任务' : '当前没有可查看的办公室。'}>{data.offices.length ? '请在上方选择办公室；准确链接和原输入中的办公室仍保留，未自动采用列表首项。' : '办公室负责人及成员关系由行政人事维护，请联系行政人事信息维护员核对。'}</StatusPanel> : <section className="card">
        <h2>我现在该做什么</h2>{actionable.length ? <ul>{actionable.map(t => <li key={t.id}><a href={'#office-task-' + t.id} onClick={event => { event.preventDefault(); const target = document.getElementById('office-task-' + t.id); target?.scrollIntoView({block:'center'}); target?.focus(); }}>{mayAct(data,t,'complete') ? '填写办理结果' : '分配办公室成员'}：{businessText(t.content)}</a></li>)}</ul> : <p>当前办公室没有需要您办理的任务。</p>}
        <p>待分配 {tasks.filter(t => t.status === 'pending' && !t.assignee_person_id).length}　待办理 {tasks.filter(t => t.status === 'pending' && t.assignee_person_id).length}　已办结 {tasks.filter(t => t.status === 'done').length}</p>
        <details><summary>办公室成员（{data.members.length}人，可同时属于其他办公室）</summary>{data.members.length ? data.members.map(p => <p key={p.person_id}>{p.person_name}（{p.employee_no}） · {p.department_name || '部门待明确'} · {p.status === 'active' && p.employment_status === 'active' ? '在职' : '当前不可分配'}</p>) : <p>暂无明确导入的成员。</p>}</details>
        <div><label htmlFor="office-field-10">办理状态</label><select id="office-field-10" value={filter} onChange={e => setFilter(e.target.value)}><option value="">全部</option><option value="unassigned">待分配</option><option value="assigned">待办理</option><option value="done">已办结</option></select></div>
        {!tasks.some(t => !filter || (filter === 'done' ? t.status === 'done' : t.status === 'pending' && (filter === 'assigned' ? Boolean(t.assignee_person_id) : !t.assignee_person_id))) && <p>当前没有此类办公室任务。</p>}
        {tasks.filter(t => !filter || (filter === 'done' ? t.status === 'done' : t.status === 'pending' && (filter === 'assigned' ? Boolean(t.assignee_person_id) : !t.assignee_person_id))).map(t => <article key={t.id} id={'office-task-' + t.id} tabIndex={-1} className="preview-item">
          <h3>办公室任务 · {stateLabel(t)}</h3><p>{businessText(t.content)}</p><p>办理人：{t.assignee_name || '等待负责人分配'}；截止日期：{t.due_date || '未设定'}；紧急程度：{{high:'紧急',medium:'普通',low:'较低'}[t.urgency] || '待核对'}</p>
          {t.process_version_id && <p>{t.process_name} · 正式版 {t.process_edition}<br />流程归口：{t.owning_department_name || '待明确'}；业务行为：{t.behavior_name || '整个流程'}</p>}
          {t.analysis_task && <details><summary>问题办理说明</summary><p>{businessText(t.analysis_task.instruction)}</p><p>问题 {businessName(t.analysis_task)}；任务办结不会关闭问题。</p></details>}
          {t.analysis_task?.compiler_replies?.length > 0 && <details open><summary>流程编制者答复</summary><p>最多展示最近50条答复，历史保留。</p>{t.analysis_task.compiler_replies.map(r => <p key={r.id}>{new Date(r.created_at).toLocaleString()} · {businessText(r.actor_name||'历史办理人姓名未记录')}：{businessText(r.content)}</p>)}<p>编制者答复是办理依据，请按任务分配填写办理结果；问题仍须独立复核。</p></details>}
          <div className="import-actions">{mayAct(data,t,'assign') && <button className="secondary" disabled={saving} onClick={() => start('assign',t)}>{t.assignee_person_id ? '重新分配' : '分配人员'}</button>}{mayAct(data,t,'complete') && <button className="primary" disabled={saving} onClick={() => start('complete',t)}>填写结果并办结此任务</button>}</div>
          {t.status === 'done' && <><p>{completion(t)}</p><p>办结时间：{t.done_epoch ? new Date(Number(t.done_epoch)*1000).toLocaleString() : '未记录'}</p></>}
        </article>)}
      </section>}
      {data.can_route && <section className="card"><h2>原部门待办：尚未指定办公室</h2><p>保留原接收部门，选择该部门下的办公室承接。</p>{data.unallocated.length ? data.unallocated.map(t => <article className="preview-item" key={t.id}><p>{businessText(t.content)}</p><p>接收部门：{t.department_name || '未设置'}</p><button className="secondary" disabled={saving} onClick={() => start('receive',t)}>指定承接办公室</button></article>) : <p>没有尚未指定办公室的待办。</p>}</section>}
    </>}
  </div>;
}
