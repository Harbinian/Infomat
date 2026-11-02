import {userMessage} from './businessPresentation.js';
import {withdrawalGuidance} from './businessPresentation.js';
import {BusinessSelect} from "./BusinessDetails.jsx";
import HandoffPackagePicker from './HandoffPackagePicker.jsx';
import {GovernanceDetails as BusinessDetails} from "./GovernanceDetails.jsx";
import {businessDateTime} from "./businessGuidance.js";
import {handoffOperationName,bindingDetailDisplay,historicalGovernanceActor,fixedSourceName,restorationLinkName,handoffReviewBindingSelection} from "./handoffGovernancePresentation.js";
import {businessName,businessStatus,businessText} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { HandoffDraftFields } from './HandoffDraftEditor.jsx';
import { bindingDetails, restorationCandidate, restorationRequestBody, withdrawalState } from './handoffUpgradePublicationModel.js';
import { handoffRequestUnresolved } from './dataMapHandoffRequest.js';
import './handoff-upgrade-publication.css';

const base = '/api/data-map-handoffs';
const kindLabels = { object: '对象', field: '字段', data_element: '数据项定义', context: '数据使用范围', rule: '生命周期规则', authority: '数据来源认定' };
const scopeLabel = value => value === 'current' ? '现行范围' : value === 'historical' ? '历史范围' : '适用范围尚未明确';
function Report({report,publication}) {
  if(!report)return null;
  const itemName=head=>businessName(publication?.manifest?.items?.find(item=>item.target_kind===head.subject_kind&&String(item.target_id)===String(head.subject_id))?.payload?.definition,'对象或字段名称未记录');
  return <div className="handoff-withdrawal-report"><h4>本次撤回影响检查</h4><p>{scopeLabel(report.scope_mode)} · 撤回原因：{businessText(report.reason,'撤回原因含技术内容，请核对原材料')}</p><p>本次新建或修改 {report.produced_items.length} 项；沿用已有内容 {report.reused_items.length} 项；需要核对的已有引用 {report.impact_manifest.length} 项。</p><details open><summary>撤回后停止新引用的内容与保留的已有引用</summary><ul>{report.heads.map((head,index)=><li key={index}>{itemName(head)}：{head.will_clear?'撤回后不再允许新的引用':'保留后续发布或其他发布的当前可用版本'}</li>)}</ul>{report.impact_manifest.map((item,index)=><div className="handoff-row-card" key={index}><p>{businessName(item,'引用材料名称未记录')}</p><p>{item.reference_kind==='schema_not_installed'?'部分引用检查所需的功能尚未准备，不能据此判断没有影响。':'已有引用保留，仍须核对影响并明确处理。'}</p></div>)}{!report.impact_manifest.length&&<p>在本次能够检查的范围内，未发现已有引用受影响。</p>}</details></div>;
}

export default function HandoffPublicationPanel({ api, selection, select, resource, trace, capabilities, draft, begin, edit, execute, busy, disabled, packageChoices }) {
  const [error, setError] = useState(''), [reading, setReading] = useState(false);
  const readScope = JSON.stringify([draft?.sessionId, draft?.kind, draft?.sourceKey, draft?.owner, selection?.id, draft?.values?.targetPackageId]);
  const currentReadScope = useRef(readScope), readController = useRef(null);
  currentReadScope.current = readScope;
  useEffect(() => { setReading(false); return () => readController.current?.abort(); }, [readScope]);
  if (selection?.kind !== 'publication' || !resource?.manifest) return null;
  const publication = resource, publicationId = publication.publication_id;
  const active = ['publication_withdraw', 'publication_restore'].includes(draft?.kind) && draft.values?.publicationId === publicationId;
  const values = active ? draft.values : {};
  const frozen = busy || reading || disabled || handoffRequestUnresolved(draft), allowed = publication.allowed_actions || [];
  const result = draft?.request?.phase === 'committed' ? draft.request.result : draft?.lastResult;
  const { report: checkReport, approval, checkMatches, approvalMatches } = withdrawalState(publicationId, values, result);
  const stale = active && Number(values.expectedRevision) !== Number(publication.event_revision);
  const targetBinding = values.targetTrace?.bindings?.find(x => x.binding_id === values.targetBindingId);
  const targetDetails = bindingDetailDisplay(values.targetTrace,targetBinding);
  const targetReview = handoffReviewBindingSelection(values.targetTrace,values.targetBindingId);
  const itemName = ref => businessName(publication.manifest.items.find(item=>item.item_ref===ref)?.payload?.definition,'原发布条目名称未记录');
  const targetMatches = values.targetTrace?.package_id === values.targetPackageId;
  const candidateMatches = values.restorationDraft && values.candidateTargetPackageId === values.targetPackageId && values.candidateBindingId === values.targetBindingId;
  const noRequestError = fn => async () => { setError(''); try { await fn(); } catch (x) { setError(x.message); } };
  const startWithdraw = () => begin('publication_withdraw', { publicationId, expectedRevision: Number(publication.event_revision), reason: '', basis: '' }, `${publicationId}:${publication.event_revision}`);
  const startRestore = () => begin('publication_restore', { publicationId, expectedRevision: Number(publication.event_revision), targetPackageId: '', targetBindingId: '', targetMode: 'new', targetHandoffId: '', scopeMode: 'current', basis: '', evidence_refs: '', itemMappings: [] }, `${publicationId}:${publication.event_revision}`);
  async function readTarget() {
    setReading(true); setError('');
    const scope = readScope, controller = new AbortController();
    readController.current?.abort(); readController.current = controller;
    try {
      if (!/^[1-9]\d*$/u.test(values.targetPackageId || '')) throw new Error('请选择恢复目标工作包。');
      const targetTrace = await api(`${base}/work-packages/${encodeURIComponent(values.targetPackageId)}/trace`, { signal: controller.signal });
      if (controller.signal.aborted || currentReadScope.current !== scope) return;
      edit('targetTrace', targetTrace);
    }
    catch (x) { if (!controller.signal.aborted && currentReadScope.current === scope) setError(x.message); } finally { if (!controller.signal.aborted && currentReadScope.current === scope) setReading(false); }
  }
  function prepareCandidate() {
    setError('');
    try {
      if (!targetMatches || !targetBinding) throw new Error('请先读取恢复目标工作包，再选择本次采用的已审核材料。');
      const next = restorationCandidate(publication, trace, values.scopeMode);
      edit('restorationDraft', next); edit('candidateTargetPackageId', values.targetPackageId); edit('candidateBindingId', values.targetBindingId);
      edit('itemMappings', publication.manifest.items.map(item => ({ source_item_ref: item.item_ref, target_item_ref: item.item_ref, content_decision: '', basis: '', evidence_refs: '' })));
    } catch (x) { setError(x.message); }
  }
  function mapItem(index, patch) { edit('itemMappings', values.itemMappings.map((x, i) => i === index ? { ...x, ...patch } : x)); }
  async function checkWithdrawal() {
    if (!values.reason?.trim()) throw new Error('请填写撤回原因。');
    await execute({ url: `${base}/publications/${publicationId}/withdrawal-checks`, method: 'POST', body: { expected_revision: values.expectedRevision, reason: values.reason } });
  }
  async function approveWithdrawal() {
    if (!checkMatches || !values.basis?.trim()) throw new Error('请核对准确检查结果并填写批准依据及影响核对说明。');
    edit('withdrawalReport', checkReport); edit('withdrawalApproval', null);
    await execute({ url: `${base}/publications/${publicationId}/withdrawal-approvals`, method: 'POST', body: { expected_revision: values.expectedRevision, reason: values.reason, basis: values.basis, binding_digest: checkReport.binding_digest } });
  }
  async function withdraw() {
    if (!approvalMatches) throw new Error(withdrawalGuidance({stale,report:checkReport,checkMatches,approvalMatches}));
    edit('withdrawalApproval', approval);
    await execute({ url: `${base}/publications/${publicationId}/withdraw`, method: 'POST', body: { expected_revision: values.expectedRevision, reason: values.reason, withdrawal_approval_id: approval.withdrawal_approval_id } });
  }
  async function restore() {
    if (!candidateMatches) throw new Error('恢复目标工作包或审核材料已变化，已填写内容保留；请重新核对后办理。');
    const body = restorationRequestBody(values,itemName);
    await execute({ url: `${base}/publications/${publicationId}/restorations`, method: 'POST', body });
  }
  const sourceRevision = trace?.revisions?.find(x => x.revision_id === publication.manifest.handoff_revision_id);
  return <section className="handoff-publication-panel" aria-label="整单发布撤回与恢复">
    <h3>整单发布、撤回与恢复</h3><p>{publication.state === 'withdrawn' ? '已整单撤回，停止新引用' : publication.state === 'published' ? '已发布' : '发布状态待核对'} · {scopeLabel(publication.manifest.scope_mode)}</p>
    <p><button type="button" onClick={() => select({kind:'package',id:publication.package_id})}>查看来源工作包及审核材料</button></p>
    <p>办理前会核对当前资格，原批准和执行记录保留。撤回后保留原发布内容和已有引用，后续发布的可用内容不受本次撤回替换，也不会自动恢复上一版。</p>
    <p>具备本工作包撤回办理资格的MDM工作组组长，先检查撤回影响，再填写批准依据并批准，最后执行整单撤回。撤回后可由组长或本包经办人准备恢复草案；恢复内容仍须另行批准、发布。</p>
    {error && <p role="alert" className="error">{userMessage(error)}</p>}
    <details open><summary>本次发布内容（{publication.manifest.items.length}项）</summary>{publication.manifest.items.map(item=><section className="handoff-row-card" key={item.item_ref}><h4>{businessName(item.payload?.definition)}</h4><p>{businessStatus(item.target_kind)} · 条目操作：{handoffOperationName(item.operation)} · {item.produces_version?'本次新建或修改':'沿用已有内容'}</p><BusinessDetails value={item.payload}/></section>)}</details>
    <details><summary>发布状态事件与办理资格</summary>{publication.events.map(event => <div className="handoff-fixed-card" key={event.event_no}><p>{event.event_type==='withdrawn'?'整单撤回':'整体发布'} · {businessDateTime(event.created_at)}</p><p>{businessText(event.payload.reason || '按本次批准整体生效','办理原因含技术内容，请查阅原材料')}</p><details><summary>当时办理人与资格</summary><p>执行人：{historicalGovernanceActor(event.payload.actor_snapshot||event.payload.actor)}</p>{event.payload.approval_actor&&<p>批准人：{historicalGovernanceActor(trace?.approvals?.find(row=>row.approval_id===event.payload.approval_id)?.actor_snapshot||event.payload.approval_actor)}</p>}</details>{event.payload.withdrawal_report && <Report report={event.payload.withdrawal_report} publication={publication}/>}</div>)}</details>
    {trace?.restoration_links?.some(x => x.restores_publication_id === publicationId) && <details><summary>受控恢复及替代关系</summary>{trace.restoration_links.filter(x => x.restores_publication_id === publicationId).map(link => <p key={link.revision_id}>{link.publication_id ? <button type="button" onClick={() => select({ kind: 'publication', id: link.publication_id })}>查看{restorationLinkName(link)}</button> : <button type="button" onClick={() => select({ kind: 'handoff', id: link.handoff_id, revision:Number(link.revision_no) })}>查看{restorationLinkName(link)}</button>}</p>)}</details>}
    {!active && <div className="handoff-action-buttons">{allowed.includes('withdrawal_checks') && <button type="button" disabled={busy} onClick={startWithdraw}>办理整单撤回</button>}{allowed.includes('prepare_restoration') && <button type="button" disabled={busy} onClick={startRestore}>准备恢复草稿</button>}</div>}
    {active && stale && <p role="alert">这条发布记录的状态已变化，本次{draft.kind === 'publication_restore' ? '恢复' : '撤回'}暂不能继续。请点击“查看最新记录”核对当前状态，填写的内容仍保留。</p>}
    {active && draft.kind === 'publication_withdraw' && <div className="handoff-action-form"><fieldset disabled={frozen || stale || !allowed.includes('withdrawal_checks')}><legend>原因与影响核对</legend><label>撤回原因<textarea aria-label="撤回原因" value={values.reason || ''} onChange={e => edit('reason', e.target.value)} /></label><button type="button" onClick={noRequestError(checkWithdrawal)}>检查撤回影响</button></fieldset><Report report={checkReport} publication={publication}/>{checkReport && !checkMatches && <p role="alert">撤回原因已修改，请重新检查撤回影响，核对结果后再批准本次整单撤回。</p>}<fieldset disabled={frozen || stale || !checkMatches || !allowed.includes('withdrawal_approval')}><legend>批准本次撤回</legend><label>批准依据及影响核对说明<textarea aria-label="批准依据及影响核对说明" value={values.basis || ''} onChange={e => edit('basis', e.target.value)} /></label><button type="button" onClick={noRequestError(approveWithdrawal)}>批准本次整单撤回</button></fieldset><p role="status">{withdrawalGuidance({stale,report:checkReport,checkMatches,approvalMatches})}</p><button type="button" disabled={frozen || stale || !approvalMatches || !allowed.includes('withdraw_publication')} onClick={noRequestError(withdraw)}>执行本次整单撤回</button></div>}
    {active && draft.kind === 'publication_restore' && <div className="handoff-action-form"><fieldset disabled={frozen || stale || !allowed.includes('prepare_restoration')}><legend>选择恢复目标与审核材料</legend><HandoffPackagePicker api={api} packages={packageChoices} label="恢复目标工作包" value={values.targetPackageId} onChange={value=>edit('targetPackageId',value)}/><button type="button" onClick={readTarget}>读取恢复目标</button>
      {values.targetTrace && <><p>恢复目标：{fixedSourceName(values.targetTrace.source)} · 工作包{businessStatus(values.targetTrace.work_package.status)} · {values.targetTrace.source.status === 'superseded' ? '历史来源' : '来源状态：' + businessStatus(values.targetTrace.source.status)}</p><BusinessSelect label="恢复目标的已审核材料" value={values.targetBindingId} onChange={value=>edit('targetBindingId',value)} items={targetReview.items} valueKey="binding_id" empty="请选择本次恢复采用的审核材料"/>{targetReview.unavailable&&<p role="alert">原选择的审核材料当前没有可读说明，原值保留。请重新读取恢复目标并核对，不会自动选择另一份材料。</p>}<label>恢复适用范围<select aria-label="恢复适用范围" value={values.scopeMode} onChange={e => { edit('scopeMode', e.target.value); if (values.restorationDraft) edit('restorationDraft', { ...values.restorationDraft, scope_mode: e.target.value }); }}><option value="current">现行范围，须实际现行来源</option><option value="historical">历史范围，不推进现行地图</option></select></label><label>恢复草案位置<select aria-label="恢复草案位置" value={values.targetMode} onChange={e => edit('targetMode', e.target.value)}><option value="new">新建恢复草案</option><option value="append">追加目标现有草案</option></select></label>{values.targetMode === 'append' && <label>目标现有未提交草案<select aria-label="目标现有未提交草案" value={values.targetHandoffId || ''} onChange={e => { edit('targetHandoffId', e.target.value); edit('expectedTargetRevision', Number(values.targetTrace.drafts.find(item => item.handoff_id === e.target.value)?.current_revision || 0)); }}><option value="">请选择准确草案</option>{values.targetTrace.drafts.filter(x => x.state === 'draft' && Number(x.active_slot) === 1).map(item => <option key={item.handoff_id} value={item.handoff_id}>{fixedSourceName(values.targetTrace.source)} · 未提交承接草案 · {businessDateTime(item.created_at)}</option>)}</select></label>}<p>新建不会覆盖现有草案；追加时先选择要继续编辑的未提交草案。若该草案已被他人保存，请重新读取并核对后再办。将旧内容用于新版工作包时，仍须核对新旧内容的差异。</p><button type="button" disabled={!targetMatches || !values.targetBindingId || Boolean(values.restorationDraft) || !sourceRevision} onClick={prepareCandidate}>按原发布内容准备恢复草案</button></>}
    </fieldset>{values.restorationDraft && <><p>恢复内容取自原发布时保存的草案。本次新建或修改的对象和字段仍对应原业务对象，保存恢复草案不会替换原发布记录。请逐项核对目标来源、定义、来源系统、关联及影响。</p>{!candidateMatches && <p role="alert">恢复目标工作包或审核材料已变化，已填写内容保留，当前不能提交。</p>}<HandoffDraftFields value={values.restorationDraft} onChange={value => edit('restorationDraft', value)} disabled={frozen || stale || !candidateMatches} sourceDetails={targetDetails} />
      <fieldset disabled={frozen || stale || !candidateMatches}><legend>原发布项到本次草案的逐项采用</legend>{values.itemMappings.map((item, index) => { const source = publication.manifest.items.find(x => x.item_ref === item.source_item_ref); return <div className="handoff-restore-mapping" key={item.source_item_ref}><h4>{kindLabels[source.target_kind]} · {businessName(source.payload?.definition)}</h4><label>目标草稿条目<select aria-label="目标草稿条目" value={item.target_item_ref} onChange={e => mapItem(index, { target_item_ref: e.target.value })}><option value="">请选择本次准确条目</option>{values.restorationDraft.items.filter(x => x.target_kind === source.target_kind).map(x => <option key={x.item_ref} value={x.item_ref}>{businessName(x)}</option>)}</select></label><label>采用方式：{businessName(source.payload?.definition,'原发布条目名称未记录')}<select aria-label={'采用方式：'+businessName(source.payload?.definition,'原发布条目名称未记录')} value={item.content_decision} onChange={e => mapItem(index, { content_decision: e.target.value })}><option value="">请明确逐项决定</option><option value="adopt">采用原定义及内部关系</option><option value="adapt">按本次依据调整采用</option></select></label><div className="handoff-proof-pair"><label>采用依据：{businessName(source.payload?.definition,'原发布条目名称未记录')}<textarea aria-label={'采用依据：'+businessName(source.payload?.definition,'原发布条目名称未记录')} value={item.basis} onChange={e => mapItem(index, { basis: e.target.value })} /></label><label>采用证据：{businessName(source.payload?.definition,'原发布条目名称未记录')}<textarea aria-label={'采用证据：'+businessName(source.payload?.definition,'原发布条目名称未记录')} value={item.evidence_refs} onChange={e => mapItem(index, { evidence_refs: e.target.value })} placeholder="每行一条可定位证据" /></label></div></div>; })}</fieldset>
      <fieldset disabled={frozen || stale || !candidateMatches}><legend>本次恢复依据</legend><div className="handoff-proof-pair"><label>恢复依据<textarea aria-label="恢复依据" value={values.basis || ''} onChange={e => edit('basis', e.target.value)} /></label><label>恢复证据<textarea aria-label="恢复证据" value={values.evidence_refs || ''} onChange={e => edit('evidence_refs', e.target.value)} placeholder="每行一条" /></label></div><button type="button" onClick={noRequestError(restore)}>保存恢复草案</button></fieldset></>}
    <p>保存恢复草案后，先点击“确认本次办理结果”，再点击“结束本次办理并查看对应草案”。经办人核对恢复内容及已有引用的影响后提交，组长重新检查、批准和发布；原发布的撤回状态及已有引用继续保留。</p></div>}
  </section>;
}

