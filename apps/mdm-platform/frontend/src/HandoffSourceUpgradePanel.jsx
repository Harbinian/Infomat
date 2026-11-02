import {userMessage} from './businessPresentation.js';
import {BusinessSelect} from "./BusinessDetails.jsx";
import HandoffPackagePicker from './HandoffPackagePicker.jsx';
import {GovernanceDetails as BusinessDetails} from "./GovernanceDetails.jsx";
import {businessDateTime} from "./businessGuidance.js";
import {fixedSourceName,bindingDetailDisplay,governanceDetailName,handoffReviewBindingSelection} from "./handoffGovernancePresentation.js";
import {businessLocation,businessName,businessStatus,businessText} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';
import { bindingDetails, createUpgradeDecisions, governancePointers, upgradeAssessmentBody, upgradeChangeLabels, upgradeRecheckLabels } from './handoffUpgradePublicationModel.js';
import { handoffRequestUnresolved } from './dataMapHandoffRequest.js';
import './handoff-upgrade-publication.css';

const base = '/api/data-map-handoffs';
const labelStatus = value => ({ governed: '当前版本已承接', source_upgrade_pending: '治理承接待完成', requires_attention: '既有承接需处理', blocked: '来源完整性阻断' }[value] || businessStatus(value));
function ProofFields({ label, value, onChange, disabled }) {
  return <div className="handoff-proof-pair"><label>{label}依据<textarea value={value.basis || ''} onChange={e => onChange({ ...value, basis: e.target.value })} disabled={disabled} /></label><label>{label}证据<textarea value={Array.isArray(value.evidence_refs) ? value.evidence_refs.join('\n') : value.evidence_refs || ''} onChange={e => onChange({ ...value, evidence_refs: e.target.value })} placeholder="每行一条可定位证据" disabled={disabled} /></label></div>;
}

export default function HandoffUpgradePanel({ api, selection, select, resource, trace, capabilities, draft, begin, edit, execute, busy, disabled, onNavigate, refreshToken, packageChoices }) {
  const [prompts, setPrompts] = useState(null), [history, setHistory] = useState(null), [error, setError] = useState(''), [reading, setReading] = useState(false);
  const promptReadEpoch = useRef(0), historyReadEpoch = useRef(0);
  const handoff = selection?.kind === 'handoff' && resource?.header ? resource : null;
  const handoffId = handoff?.header.handoff_id;
  useEffect(() => {
    const controller = new AbortController(), epoch = ++promptReadEpoch.current;
    const valid = () => !controller.signal.aborted && promptReadEpoch.current === epoch;
    setPrompts(null);
    if (capabilities?.global_source_read === true) api(`${base}/source-upgrades`, { signal: controller.signal }).then(x => { if (valid()) setPrompts(x); }).catch(x => { if (valid() && x.name !== 'AbortError' && x.status !== 403) setError(x.message); });
    return () => { if (promptReadEpoch.current === epoch) promptReadEpoch.current++; controller.abort(); };
  }, [api, capabilities?.global_source_read, refreshToken]);
  useEffect(() => {
    const controller = new AbortController(), epoch = ++historyReadEpoch.current;
    const valid = () => !controller.signal.aborted && historyReadEpoch.current === epoch;
    setHistory(null);
    if (handoffId) api(`${base}/${handoffId}/source-upgrade-assessments`, { signal: controller.signal }).then(x => { if (valid()) setHistory(x); }).catch(x => { if (valid() && x.name !== 'AbortError') setError(x.message); });
    return () => { if (historyReadEpoch.current === epoch) historyReadEpoch.current++; controller.abort(); };
  }, [api, handoffId, handoff?.header.current_revision]);
  const active = draft?.kind === 'upgrade_assessment' && draft.values?.handoffId === handoffId;
  const values = active ? draft.values : {};
  const readScope = JSON.stringify([draft?.sessionId, draft?.kind, draft?.sourceKey, draft?.owner, handoffId, values.sourcePackageId]);
  const currentReadScope = useRef(readScope), readController = useRef(null);
  currentReadScope.current = readScope;
  useEffect(() => { setReading(false); return () => readController.current?.abort(); }, [readScope]);
  const targetBinding = trace?.bindings?.find(x => x.binding_id === handoff?.revision.binding_id);
  const sourceBindings = values.sourceTrace?.bindings || [];
  const sourceBinding = sourceBindings.find(x => x.binding_id === values.sourceBindingId);
  const sourceDetails = bindingDetails(sourceBinding);
  const sourceReview = handoffReviewBindingSelection(values.sourceTrace,values.sourceBindingId);
  const detailName = ref => governanceDetailName([...bindingDetailDisplay(trace,targetBinding),...bindingDetailDisplay(values.sourceTrace,sourceBinding)].find(row=>row.detail_ref===ref)||{});
  const writable = handoff?.allowed_actions?.includes('source_upgrade_assessment');
  const stale = active && Number(values.expectedRevision) !== Number(handoff?.header.current_revision);
  const sourceStale = active && (values.comparison?.source_package_id !== values.sourcePackageId || values.decisionsSourceBindingId !== values.sourceBindingId);
  const frozen = busy || reading || disabled || handoffRequestUnresolved(draft);
  const start = sourcePackageId => begin('upgrade_assessment', { handoffId, expectedRevision: Number(handoff.header.current_revision), sourcePackageId: String(sourcePackageId || ''), sourceBindingId: '', basis: '', evidence_refs: '', decisions: [] }, `${handoffId}:${handoff.header.current_revision}`);
  const updateDecision = (index, next) => edit('decisions', values.decisions.map((item, i) => i === index ? next : item));
  async function readComparison() {
    setError(''); setReading(true);
    const scope = readScope, controller = new AbortController();
    readController.current?.abort(); readController.current = controller;
    try {
      if (!/^[1-9]\d*$/u.test(values.sourcePackageId || '')) throw new Error('请选择原工作包。');
      const [comparison, sourceTrace] = await Promise.all([
        api(`${base}/source-upgrades?package_id=${encodeURIComponent(values.sourcePackageId)}&target_process_version_id=${encodeURIComponent(trace.source.process_version_id)}`, { signal: controller.signal }),
        api(`${base}/work-packages/${encodeURIComponent(values.sourcePackageId)}/trace`, { signal: controller.signal })
      ]);
      if (controller.signal.aborted || currentReadScope.current !== scope) return;
      edit('comparison', comparison); edit('sourceTrace', sourceTrace); edit('sourceBindingsExist', sourceTrace.bindings.length > 0);
    } catch (x) { if (!controller.signal.aborted && currentReadScope.current === scope) setError(x.message); } finally { if (!controller.signal.aborted && currentReadScope.current === scope) setReading(false); }
  }
  function expandDecisions() {
    setError('');
    if (values.comparison?.source_package_id !== values.sourcePackageId) return setError('请先读取所选原包的比较。');
    if (sourceBindings.length && !sourceBinding) return setError('请选择准确旧审核依据。');
    if (!targetBinding) return setError('当前草案准确审核依据不可读，请刷新办理资料。');
    edit('decisions', createUpgradeDecisions(values.comparison, sourceBinding, targetBinding)); edit('decisionsSourceBindingId', values.sourceBindingId);
  }
  async function submit() {
    setError('');
    try { if (sourceStale || stale) throw new Error('比较、审核依据或草案修订已变化，输入已保留。请重新核对后另行办理。'); await execute({ url: `${base}/${handoffId}/source-upgrade-assessments`, method: 'POST', body: upgradeAssessmentBody(values,detailName) }); }
    catch (x) { setError(x.message); }
  }
  return <section className="handoff-upgrade-panel" aria-label="来源版本升级与差异沿用">
    <h3>来源版本升级与差异沿用</h3>
    <p>流程发布与地图承接分别办理。新版由 MDM 主动选择建包；旧包固定保留原来源和审核，沿用只作为本次复核依据。</p>
    {error && <p role="alert" className="error">{userMessage(error)}</p>}
    {prompts && <details className="handoff-fixed-details"><summary>实际现行来源与承接提示（{prompts.processes?.length || 0}）</summary><div className="handoff-table-wrap"><table><thead><tr><th>流程</th><th>实际现行版本</th><th>承接状态</th><th>工作包</th><th>历史范围</th></tr></thead><tbody>{prompts.processes?.map(process => <tr key={process.document_id}><td>{businessName(process)}</td><td>{fixedSourceName(process)}</td><td>{labelStatus(process.governance_status)}{process.handoff_completed && '；既有发布事实保留'}</td><td>{process.work_package_id ? <button type="button" onClick={() => select({ kind: 'package', id: process.work_package_id })}>{businessName(process)} · {businessStatus(process.work_package_status)}</button> : <><span>尚未主动建包</span>{onNavigate && <button type="button" onClick={event => onNavigate(event, '/app/data-governance')}>前往选择新版建包</button>}</>}</td><td>{process.historical_packages?.map(old => <button key={old.package_id} type="button" onClick={() => select({ kind: 'package', id: old.package_id })}>原工作包：{fixedSourceName(old)}</button>)}</td></tr>)}</tbody></table></div></details>}
    {history?.current && <p className="handoff-status-note">当前升级门槛：{history.current.issues?.map(issue=>userMessage(issue,'来源升级条件尚未满足，请核对比较结果和审核依据。')).join('、') || (history.current.status === 'missing' ? '待完成差异评估' : '已记录准确评估，仍须检查批准')}。</p>}
    {history?.assessments?.length > 0 && <details><summary>固定升级评估历史（{history.assessments.length}）</summary>{history.assessments.map(entry => <div className="handoff-fixed-card" key={entry.event_id}><p>本次来源变化评估</p><p>本次比较仍以所选材料及其审核记录为依据。</p><p>{businessText(entry.snapshot.basis,'评估依据含技术内容，请查阅原材料')}</p>{entry.snapshot.decisions.map(item => <p key={item.detail_ref}>{upgradeChangeLabels[item.change_kind]} · {item.decision === 'reference_and_recheck' ? '引用并重核' : item.decision === 'remove' ? '移除并重核' : '不沿用，完整重核'} · 沿用范围 {item.reuse_scope.map(businessLocation).join('、') || '无'}</p>)}</div>)}</details>}
    {writable && !active && <button type="button" disabled={busy} onClick={() => start('')}>编制来源升级评估</button>}
    {active && <div className="handoff-action-form"><p>本次评估针对所选工作包的当前草稿与审核记录。请核对原流程和新版流程的差异，再逐项填写处理决定。</p>
      {stale && <p role="alert">草案已被更新，原输入保留。请核对最新内容，再结束本次输入并重新编制评估。</p>}
      <fieldset disabled={frozen || !writable || stale}><legend>选择原版本和准确审核</legend><HandoffPackagePicker api={api} packages={packageChoices} label="用于比较的原工作包" value={values.sourcePackageId} onChange={value=>edit('sourcePackageId',value)}/><button type="button" onClick={readComparison}>读取固定版本比较</button>
        {values.comparison && <><p>原版本 {fixedSourceName(values.sourceTrace?.source)} → 目标版本 {fixedSourceName(trace?.source)}；已取得新旧内容比较结果</p><div className="handoff-change-counts">{Object.entries(upgradeChangeLabels).map(([kind, label]) => <span key={kind}>{label} {values.comparison.counts[kind]}</span>)}</div><BusinessSelect label="原工作包的已审核材料" value={values.sourceBindingId} onChange={value=>edit('sourceBindingId',value)} items={sourceReview.items} valueKey="binding_id" empty={sourceBindings.length?'请选择本次比较采用的审核材料':'无可沿用审核，完整重核'}/>{sourceReview.unavailable&&<p role="alert">原选择的审核材料当前没有可读说明，原值保留。请重新读取原工作包并核对，不会自动选择另一份材料。</p>}{!sourceBindings.length && <p>保留旧包状态及缺口，不补造旧审核；本次仍须完成完整重核。</p>}<button type="button" disabled={Boolean(values.decisions?.length)} onClick={expandDecisions}>展开逐项重核</button>{values.decisions?.length > 0 && sourceStale && <p role="alert">原包或审核选择已变化。已编制内容保留，请结束本次输入后按准确依据重新编制。</p>}</>}
      </fieldset>
      {values.decisions?.map((item, index) => <details className="handoff-upgrade-item" key={item.detail_ref} open={index === 0 || undefined}><summary>{upgradeChangeLabels[item.change_kind]} · {governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})} · {item.decision ? '已选择处理方式' : '待明确沿用'}</summary><fieldset disabled={frozen || !writable || stale || sourceStale}><legend>本项重核</legend><p>请核对本条新旧内容、原审核依据及本次处理决定。</p><label>沿用决定：{governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})}<select value={item.decision} onChange={e => updateDecision(index, { ...item, decision: e.target.value, reuse_scope: e.target.value === 'reference_and_recheck' ? item.reuse_scope : [] })}>{item.change_kind === 'unchanged' ? <><option value="">请明确选择</option><option value="recheck">不沿用，完整重核</option>{item.source_detail_version_id && <option value="reference_and_recheck">引用旧字段作为依据并重新核对</option>}</> : <option value={item.change_kind === 'deleted' ? 'remove' : 'recheck'}>{item.change_kind === 'deleted' ? '移除并重核' : '完整重核'}</option>}</select></label>
        {item.decision === 'reference_and_recheck' && <fieldset><legend>明确沿用范围（显示原固定值）</legend>{governancePointers(sourceDetails.find(x => x.detail_ref === item.detail_ref)?.governance).map(({ pointer, value }) => <label key={pointer} className="handoff-pointer-choice"><input type="checkbox" aria-label={'沿用内容：'+businessLocation(pointer)} checked={item.reuse_scope.includes(pointer)} onChange={e => updateDecision(index, { ...item, reuse_scope: e.target.checked ? [...item.reuse_scope, pointer] : item.reuse_scope.filter(x => x !== pointer) })} /><span>{businessLocation(pointer)}<BusinessDetails value={value}/></span></label>)}</fieldset>}
        <div className="handoff-proof-pair"><label>本项依据：{governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})}<textarea value={item.basis} onChange={e => updateDecision(index, { ...item, basis: e.target.value })} /></label><label>本项证据：{governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})}<textarea value={item.evidence_refs} onChange={e => updateDecision(index, { ...item, evidence_refs: e.target.value })} placeholder="每行一条" /></label></div>
        {Object.entries(upgradeRecheckLabels).map(([key, label]) => <div className="handoff-proof-pair" key={key}><label>{label}重核依据：{governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})}<textarea value={item.rechecks[key].basis} onChange={e => updateDecision(index, { ...item, rechecks: { ...item.rechecks, [key]: { ...item.rechecks[key], basis: e.target.value } } })} /></label><label>{label}重核证据：{governanceDetailName(bindingDetailDisplay(trace,targetBinding).find(row=>row.detail_ref===item.detail_ref)||bindingDetailDisplay(values.sourceTrace,sourceBinding).find(row=>row.detail_ref===item.detail_ref)||{})}<textarea value={item.rechecks[key].evidence_refs} onChange={e => updateDecision(index, { ...item, rechecks: { ...item.rechecks, [key]: { ...item.rechecks[key], evidence_refs: e.target.value } } })} placeholder="每行一条" /></label></div>)}
      </fieldset></details>)}
      <fieldset disabled={frozen || !writable || stale || sourceStale}><legend>本次评估</legend><ProofFields label="升级评估" value={values} onChange={next => { edit('basis', next.basis); edit('evidence_refs', next.evidence_refs); }} /><button type="button" onClick={submit}>保存来源升级评估</button></fieldset><p>保存后，在本页“固定升级评估历史”查看本次决定，再结束本次输入。保存不会改动草案正文；经办人仍须核对条目、执行本次检查，再由组长批准和发布。</p>
    </div>}
  </section>;
}

