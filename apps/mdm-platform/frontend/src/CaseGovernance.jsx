import {businessStatus} from './businessPresentation.js';
import {userMessage} from './businessPresentation.js';
import {businessName} from "./businessPresentation.js";
import {responsibilityGuidance,governanceActionInstruction} from './businessGuidance.js';
import { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { DepartmentAccountability, accountabilityFailureText, accountabilitySnapshot } from './DepartmentAccountability.jsx';

const RESPONSIBILITIES = '/api/governance-responsibilities';
const DISPUTES = '/api/process-case-disputes';
const actionNames = { assign_steward: '分派治理经办人', assign_owner: '指定流程业务负责人', record_work: '记录治理经办情况', assign: '分派争议协调人', coordinate: '记录争议协调', escalate: '提交项目决策组', decide: '记录项目决策', request_recheck: '交回参与部门重新核对', rebase: '核对修订影响并恢复办理' };
const stateNames = { none: '暂无待协调争议', unassigned: '待分派协调人', coordinating: '协调中', escalated: '待项目决策组决定', awaiting_revision: '待业务方修订', awaiting_recheck: '待参与部门重新核对', source_changed: '来源修订已变化', resolved: '参与部门已完成重新核对' };
export const isGovernanceDraft = draft => Boolean(draft?.kind?.startsWith('governance:'));
const personText = row => row?.person_name || (row?.person_id ? '人员姓名未记录' : '尚未指定');
const failureText = error => accountabilityFailureText(error) || (/MIGRATION_REQUIRED|STORAGE_NOT_READY/.test(error.code || '')
  ? '责任与争议办理所需的存储结构尚未准备；原有流程核对仍可使用。请联系维护人员核对准备状态。'
  : error.status === 404 ? '当前入口或对象不可读取，请核对当前身份与服务版本。' : error.message);
const blankState = () => ({ loading: true, data: null, error: null });
const revisionInstruction = authoringEnabled => authoringEnabled ? '在3000从原案例续修，保存并提交新修订后重新核对' : '完成修订后上传原案例';

function History({ title, items, authoringEnabled = false }) {
  return <details><summary>{title}</summary>{items?.length ? items.map((item, i) => <article className="preview-item" key={item.event_id || item.id || i}>
    <p>{actionNames[item.action || item.payload?.action || item.event_type] || ({ steward: '治理经办任命', owner: '业务负责人任命', work_record: '治理经办记录' })[item.assignment_kind || item.record_type] || '治理记录'} · {item.actor_name || item.actor_person_name || '办理人姓名未记录'} · {item.created_at || ''}</p>
    {(item.person_name || '姓名未记录') && <p>责任人员：{item.person_name || '姓名未记录'}</p>}
    {(item.content || item.content_text) && <p>{item.content || item.content_text}</p>}<p>{item.basis || item.basis_text || '依据见原办理记录'}</p>
    {(item.decision || item.payload?.decision) && <p>决定：{({ recheck: '交回参与部门重新核对', return_for_revision: revisionInstruction(authoringEnabled) })[item.decision || item.payload?.decision] || businessStatus(item.decision || item.payload?.decision,'处理决定说明未记录')}</p>}
    {item.payload?.escalation_materials && <div><p>争议事项：{item.payload.escalation_materials.issue_summary}</p><p>影响范围：{item.payload.escalation_materials.impact_scope}</p><p>已协调情况：{item.payload.escalation_materials.coordination_history}</p>{item.payload.escalation_materials.positions?.map(p=><p key={p.department_id}>部门标识 {businessName(p)}：{p.position}；依据：{p.basis}</p>)}</div>}
  </article>) : <p>暂无办理记录。</p>}</details>;
}

// A single parent-owned draft prevents neighboring editors from replacing unsaved input.
export function CaseGovernance({ api, targetType = 'case', targetId, sourceRevision, sourceHash, refreshKey, draft, setDraft, disabled, onBusyChange, onSaved, authoringEnabled = false }) {
  const [responsibility, setResponsibility] = useState(blankState), [dispute, setDispute] = useState(blankState);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const active = useRef(null), generation = useRef(0), draftRef = useRef(draft), busyRef = useRef(false), editor = useRef(null);
  draftRef.current = draft;
  const route = (targetType === 'case' ? '/cases/' : '/work-packages/') + encodeURIComponent(targetId);
  const ownDraft = isGovernanceDraft(draft) && draft.targetType === targetType && String(draft.targetId) === String(targetId) ? draft : null;
  async function load() {
    active.current?.abort(); const controller = new AbortController(); active.current = controller;
    const token = ++generation.current; setResponsibility(blankState()); setDispute(blankState());
    const requests = [[RESPONSIBILITIES + route, setResponsibility]];
    if (targetType === 'case') requests.push([DISPUTES + route, setDispute]);
    await Promise.allSettled(requests.map(async ([url, apply]) => {
      try {
        const data = await api.request(url, { signal: controller.signal });
        const returnedId = url.startsWith(DISPUTES) ? data.case_id : data.target_id;
        if (String(returnedId) !== String(targetId) || url.startsWith(RESPONSIBILITIES) && data.target_type !== targetType) throw new Error('返回的治理记录与当前对象不一致，请刷新核对。');
        if (token === generation.current) apply({ data, loading: false, error: null });
      } catch (e) { if (token === generation.current && e.name !== 'AbortError') apply({ data: null, loading: false, error: e }); }
    }));
  }
  useEffect(() => { if (targetId) load(); return () => { ++generation.current; active.current?.abort(); }; }, [targetType, targetId, sourceRevision, sourceHash, refreshKey]);
  useEffect(() => { if (ownDraft) editor.current?.focus(); }, [ownDraft?.kind, ownDraft?.request_id]);
  const permissions = ownDraft?.domain === 'dispute' ? dispute.data?.allowed_actions : responsibility.data?.allowed_actions;
  const assignmentRole = ownDraft?.action === 'assign_owner' ? 'owner' : 'steward';
  const currentAssignment = responsibility.data?.assignments?.[assignmentRole];
  const stale = Boolean(ownDraft && (
    (sourceRevision != null && ownDraft.expected_source_revision !== sourceRevision) ||
    (sourceHash != null && ownDraft.expected_source_hash !== sourceHash) ||
    (ownDraft.domain === 'responsibility' && responsibility.data && (ownDraft.expected_source_revision !== responsibility.data.source_revision || ownDraft.expected_source_hash !== responsibility.data.source_hash)) ||
    (ownDraft.domain === 'dispute' && dispute.data && (ownDraft.expected_source_revision !== dispute.data.source_revision_no || ownDraft.expected_source_hash !== dispute.data.source_content_hash)) ||
    (ownDraft.domain === 'dispute' && dispute.data && String(ownDraft.expected_event_id) !== String(dispute.data.event_id)) ||
    (ownDraft.domain === 'responsibility' && responsibility.data && ownDraft.expected_revision !== (currentAssignment?.revision_no || 0)) ||
    (ownDraft.action === 'assign_owner' && responsibility.data && ownDraft.accountability_snapshot !== accountabilitySnapshot(responsibility.data.department_accountability))
  ));
  const loading = responsibility.loading || targetType === 'case' && dispute.loading;
  function start(domain, action) {
    const data = domain === 'dispute' ? dispute.data : responsibility.data;
    if (disabled || busyRef.current || loading || !data?.allowed_actions?.includes(action)) return;
    if (action === 'assign_owner' && data.department_accountability?.eligible !== true) return;
    if (draftRef.current && !window.confirm('当前有未提交输入，是否明确放弃后开始本次办理？')) return;
    const role = action === 'assign_owner' ? 'owner' : 'steward';
    setError(''); setNotice('');
    setDraft({ kind: 'governance:' + action, domain, action, targetType, targetId: String(targetId), caseId: targetType === 'case' ? String(targetId) : undefined, selection: targetType === 'case' ? undefined : { kind: 'package', id: String(targetId) }, dirty: true,
      expected_source_revision: sourceRevision, expected_source_hash: sourceHash, expected_revision: responsibility.data?.assignments?.[role]?.revision_no || 0,
      expected_event_id: dispute.data?.event_id, accountability_snapshot: accountabilitySnapshot(responsibility.data?.department_accountability), request_id: crypto.randomUUID(), basis: '', content: '', person_id: '', decision: '', resultUnknown: false,
      escalation_materials: action==='decide' && dispute.data?.history?.find(h=>h.payload?.escalation_materials)?.payload?.escalation_materials || {issue_summary:'',impact_scope:'',coordination_history:'',positions:(dispute.data?.related_departments || []).map(p=>({department_id:p.department_id,position:'',basis:''}))} });
  }
  function update(values) { setDraft({ ...draftRef.current, ...values, dirty: true }); }
  async function submit(event) {
    event.preventDefault(); const current = draftRef.current;
    if (current !== ownDraft || busyRef.current || disabled || loading || stale || current.resultUnknown || !permissions?.includes(current.action)) return;
    if (current.action === 'assign_owner' && responsibility.data?.department_accountability?.eligible !== true) return;
    if (!current.basis.trim() || current.action === 'record_work' && !current.content.trim() || ['assign', 'assign_steward', 'assign_owner'].includes(current.action) && !current.person_id || current.action === 'decide' && !current.decision) { setError('请明确选择办理内容并填写依据。'); return; }
    if (['escalate','decide'].includes(current.action)) {
      const m=current.escalation_materials;
      if(!m?.issue_summary?.trim() || !m.impact_scope?.trim() || !m.coordination_history?.trim() || !m.positions?.length || m.positions.some(p=>!p.position?.trim() || !p.basis?.trim())) {setError('请完整填写争议事项、各方观点及依据、影响范围和已协调情况。');return;}
    }
    const token = generation.current; busyRef.current = true; setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    let url, method = 'POST', body;
    if (current.domain === 'dispute') {
      url = DISPUTES + route + '/actions'; body = { action: current.action, request_id: current.request_id, expected_event_id: current.expected_event_id, expected_revision_no: current.expected_source_revision, expected_content_hash: current.expected_source_hash, basis: current.basis.trim(),
        ...(current.action === 'assign' ? { coordinator_person_id: current.person_id } : {}), ...(current.action === 'decide' ? { decision: current.decision } : {}), ...(['escalate','decide'].includes(current.action) ? {escalation_materials:current.escalation_materials} : {}) };
    } else if (current.action === 'record_work') {
      url = RESPONSIBILITIES + route + '/work-records'; body = { request_key: current.request_id, content: current.content.trim(), basis: current.basis.trim(), expected_revision: current.expected_revision, expected_source_revision: current.expected_source_revision, expected_source_hash: current.expected_source_hash };
    } else {
      method = 'PUT'; url = RESPONSIBILITIES + route + (current.action === 'assign_owner' ? '/owner' : '/steward');
      body = { person_id: current.person_id === '__clear__' ? null : current.person_id, basis: current.basis.trim(), expected_revision: current.expected_revision };
    }
    // Mark the attempt before dispatch so reauthentication cannot turn an uncertain write into a duplicate.
    update({ resultUnknown: true });
    try {
      await api.request(url, { method, body });
      if (token !== generation.current || draftRef.current?.request_id !== current.request_id) return;
      setDraft(null); setNotice('办理记录已保存。责任任命、协调或决定不会自动确认流程事实。');
      await load(); await onSaved?.();
    } catch (e) {
      if (token === generation.current) {
        if (e.status >= 400 && e.status < 500) setDraft({ ...current, resultUnknown: false });
        setError(failureText(e));
      }
    } finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  }
  const assignmentCandidates = responsibility.data?.candidates?.[ownDraft?.action === 'assign_owner' ? 'owners' : 'stewards']?.items || [];
  return <section className="card" data-case-governance data-governance-ready={!loading && !disabled}><h2>{targetType === 'case' ? '流程责任与争议办理' : '工作包治理经办责任'}</h2>
    <p>MDM组长分派治理经办人；部门负责人指定本部门流程业务负责人。流程业务负责人任命不产生最终确认权；流程事实由参与部门负责人核对，正式材料由归口部门负责人最终确认。</p>
    <button disabled={busy || disabled} onClick={load}>刷新责任与争议记录</button>
    {responsibility.loading ? <StatusPanel kind="loading" title="正在读取治理责任…" /> : responsibility.error ? <StatusPanel kind={[403, 503].includes(responsibility.error.status) ? undefined : 'error'} title={responsibility.error.status === 403 ? '当前身份无权查阅责任记录' : '治理责任暂不可办理'}>{userMessage(responsibility.error.status === 403 ? '可按下方争议事项显示的权限继续办理。' : failureText(responsibility.error))}</StatusPanel> : <>
      <p>治理经办人：{personText(responsibility.data?.assignments?.steward)}{responsibility.data?.assignments?.steward?.active === false && '（任命已失效，待重新分派）'}{targetType === 'case' && <>；流程业务负责人：{personText(responsibility.data?.assignments?.owner)}{responsibility.data?.assignments?.owner?.active === false && '（任命已失效，待重新指定）'}</>}</p>
      {targetType === 'case' && <DepartmentAccountability value={responsibility.data?.department_accountability} />}
      <div className="import-actions">{['assign_steward', ...(targetType === 'case' ? ['assign_owner', 'record_work'] : [])].filter(action => responsibility.data?.allowed_actions?.includes(action)).map(action => <button key={action} disabled={disabled || busy || loading || action === 'assign_owner' && responsibility.data?.department_accountability?.eligible !== true} onClick={() => start('responsibility', action)}>{actionNames[action]}</button>)}</div>
      <History title="责任任命记录" items={responsibility.data?.history} authoringEnabled={authoringEnabled} /><History title="治理经办记录" items={responsibility.data?.work_records} authoringEnabled={authoringEnabled} />
    </>}
    {targetType === 'case' && <><h3>跨部门争议</h3>{dispute.loading ? <StatusPanel kind="loading" title="正在读取争议办理状态…" /> : dispute.error ? <StatusPanel kind={dispute.error.status === 503 ? undefined : 'error'} title="争议办理暂不可用">{userMessage(failureText(dispute.error))}</StatusPanel> : <>
      <p>当前状态：{stateNames[dispute.data?.state] || '待核对'}；协调人：{dispute.data?.coordinator_person_name || '处理人姓名未记录'}</p>
      <p>项目决策组记录决定后，参与部门负责人仍须重新核对；要求修改时，{revisionInstruction(authoringEnabled)}。</p>
      <div className="import-actions">{['assign', 'coordinate', 'escalate', 'decide', 'request_recheck', 'rebase'].filter(action => dispute.data?.allowed_actions?.includes(action)).map(action => <button key={action} disabled={disabled || busy || loading} onClick={() => start('dispute', action)}>{actionNames[action]}</button>)}</div>
      <History title="争议协调与决定历史" items={dispute.data?.history} authoringEnabled={authoringEnabled} />
    </>}</>}
    {error && <StatusPanel kind="error" title="本次治理办理未完成">{userMessage(error)}</StatusPanel>}{notice && <StatusPanel title="治理办理已保存">{notice}</StatusPanel>}
    {ownDraft && <section className="preview-editor" ref={editor} tabIndex={-1}><h3>{actionNames[ownDraft.action]}</h3><p>办理对象：《{businessName(responsibility.data,targetType === 'case' ? '所选流程' : '所选工作包')}》。</p><p>{governanceActionInstruction(ownDraft.action)}</p><p>填写内容尚未提交，仅保留在当前页面。若流程内容、责任人或争议状态变化，请先核对最新记录，再按页面提示继续。</p>
      {stale && <StatusPanel kind="error" title="责任、来源或争议记录已变化">输入仍保留，不能套用到新状态。请核对最新记录，保留需要的文字后明确放弃旧输入，再重新办理。</StatusPanel>}
      {!loading && !permissions?.includes(ownDraft.action) && <StatusPanel title="当前身份或状态已不能办理此动作">当前输入保留供核对。</StatusPanel>}
      {ownDraft.resultUnknown && <StatusPanel title="提交结果需核对">请求结果尚未确认，已保留输入并暂停重复提交。请刷新责任与争议记录，对照历史核对结果；确认后明确放弃本次输入，再按最新状态继续。</StatusPanel>}
      <form onSubmit={submit}><fieldset disabled={busy || disabled || ownDraft.resultUnknown}>
        {['assign_steward', 'assign_owner', 'assign'].includes(ownDraft.action) && <label>{ownDraft.action === 'assign' ? '争议协调人' : ownDraft.action === 'assign_owner' ? '流程业务负责人' : '治理经办人'}<select aria-label={ownDraft.action === 'assign' ? '争议协调人' : ownDraft.action === 'assign_owner' ? '流程业务负责人' : '治理经办人'} value={ownDraft.person_id} required onChange={e => update({ person_id: e.target.value })}><option value="">请选择本次任命</option>{ownDraft.action !== 'assign' && <option value="__clear__">解除当前任命（需填写依据）</option>}{(ownDraft.action === 'assign' ? dispute.data?.candidates || [] : assignmentCandidates).map(p => <option key={p.person_id} value={p.person_id}>{p.person_name || '姓名未记录'}</option>)}</select></label>}
        {ownDraft.action === 'record_work' && <label>治理经办内容<textarea aria-label="治理经办内容" rows={4} maxLength={4000} required value={ownDraft.content} onChange={e => update({ content: e.target.value })} /></label>}
        {ownDraft.action === 'decide' && <label>项目决策结果<select aria-label="项目决策结果" required value={ownDraft.decision} onChange={e => update({ decision: e.target.value })}><option value="">请选择决定</option><option value="recheck">交回参与部门重新核对</option><option value="return_for_revision">{revisionInstruction(authoringEnabled)}</option></select></label>}
        {['escalate','decide'].includes(ownDraft.action) && <><p>升级材料完整后才能提交项目决策组；项目决定仍须由相关部门重新核对。</p>{[['issue_summary','争议事项'],['impact_scope','影响范围'],['coordination_history','已协调情况']].map(([key,label])=><label key={key}>{label}<textarea aria-label={label} required maxLength={4000} rows={3} value={ownDraft.escalation_materials?.[key] || ''} onChange={e=>update({escalation_materials:{...ownDraft.escalation_materials,[key]:e.target.value}})}/></label>)}{(ownDraft.escalation_materials?.positions || []).map((p,index)=><div key={p.department_id}><h4>{dispute.data?.related_departments?.find(d=>String(d.department_id)===String(p.department_id))?.department_name || '部门名称未记录'}</h4>{[['position','观点'],['basis','依据']].map(([key,label])=><label key={key}>本方{label}<textarea aria-label={(p.department_name||'部门名称未记录')+label} required rows={3} maxLength={4000} value={p[key]} onChange={e=>update({escalation_materials:{...ownDraft.escalation_materials,positions:ownDraft.escalation_materials.positions.map((item,i)=>i===index?{...item,[key]:e.target.value}:item)}})}/></label>)}</div>)}</>}
        <label>本次办理依据<textarea aria-label="本次办理依据" rows={4} maxLength={4000} required value={ownDraft.basis} onChange={e => update({ basis: e.target.value })} /></label>
        <button className="primary" type="submit" disabled={loading || stale || !permissions?.includes(ownDraft.action) || ownDraft.action === 'assign_owner' && responsibility.data?.department_accountability?.eligible !== true}>保存本次治理办理</button>
      </fieldset></form><button disabled={busy || disabled} onClick={() => { if (window.confirm('是否明确放弃本次未提交输入？')) { setDraft(null); setError(''); } }}>放弃本次治理输入</button>
    </section>}
  </section>;
}

export function GovernanceAssignmentsWorkbench({ api, onNavigate, refreshKey }) {
  const [state, setState] = useState({ responsibility: blankState(), dispute: blankState() });
  useEffect(() => {
    const controller = new AbortController(); setState({ responsibility: blankState(), dispute: blankState() });
    for (const [key, url] of [['responsibility', RESPONSIBILITIES], ['dispute', DISPUTES]]) api.request(url + '/workbench', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState(previous => ({ ...previous, [key]: { data, loading: false } }));
    }).catch(error => { if (!controller.signal.aborted) setState(previous => ({ ...previous, [key]: { error, loading: false } })); });
    return () => controller.abort();
  }, [api, refreshKey]);
  return <section className="card"><h2>责任与争议事项</h2><p>按当前身份列出可查阅或办理的责任事项；具体权限与最新状态以进入后的页面为准。</p>
    {['responsibility', 'dispute'].map(key => <section key={key}><h3>{key === 'responsibility' ? '治理责任事项' : '流程争议事项'}</h3>{state[key].loading ? <StatusPanel kind="loading" title="正在读取事项…" /> : state[key].error ? <StatusPanel title="事项暂不可用">{userMessage(failureText(state[key].error))} 当前不能据此判断没有事项。</StatusPanel> : <>
      {!(state[key].data?.items || []).length && <p>当前范围暂无此类事项。</p>}
      {(state[key].data?.items || []).map((row, i) => {const guide=responsibilityGuidance(row,key === 'dispute');return <article className="preview-item" key={`${row.target_type || 'case'}:${row.target_id || row.case_id}:${i}`}><h4>{guide.name}</h4><p>本次职责：{guide.role}</p>{key === 'dispute' && <p>争议状态：{stateNames[row.state] || '待核对'}</p>}<p>{guide.instruction}</p><a href={key === 'dispute' || row.target_type !== 'work_package' ? '/app/process-preview?case=' + encodeURIComponent(row.target_id || row.case_id) : '/app/data-governance?package=' + encodeURIComponent(row.target_id)} onClick={onNavigate}>{guide.action}</a></article>;})}
      {state[key].data?.truncated && <p>当前结果达到查阅上限，请进入对应列表核对其余事项。</p>}
    </>}</section>)}
  </section>;
}
