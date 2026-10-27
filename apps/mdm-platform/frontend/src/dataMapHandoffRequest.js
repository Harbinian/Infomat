import {businessStatus} from './businessPresentation.js';
// One in-memory edit session owns one immutable request until its receipt is known.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const handoffRoot = '/api/data-map-handoffs';
export const cloneHandoffValue = value => structuredClone(value);
export const handoffLines = value => String(value || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
export const handoffEditLines = value => String(value ?? '').split(/\r?\n/);
export function normalizeHandoffSnapshot(value) {
  const body=cloneHandoffValue(value),clean=list=>(list||[]).map(x=>typeof x==='string'?x.trim():x).filter(x=>x!=='');
  for(const item of body.items||[]){
    item.source_detail_refs=clean(item.source_detail_refs);item.evidence_refs=clean(item.evidence_refs);
    for(const a of item.authority||[])a.evidence_refs=clean(a.evidence_refs);
    if(Array.isArray(item.definition?.operations))item.definition.operations=clean(item.definition.operations);
    for(const group of item.definition?.unique_identifiers||[])if(group&&typeof group==='object')for(const key of ['field_item_refs','field_version_ids'])if(Array.isArray(group[key]))group[key]=clean(group[key]);
  }
  for(const row of body.impact_dispositions||[])row.evidence_refs=clean(row.evidence_refs);
  for(const row of body.restoration_adjustments||[])row.evidence_refs=clean(row.evidence_refs);
  return body;
}
export function handoffResultMatchesResource(selection,resource,result,trace){
  if(!resource||!result)return false;
  const same=(a,b)=>a!=null&&b!=null&&String(a)===String(b);
  if(selection?.kind==='handoff')return same(resource.header?.handoff_id,result.handoff_id)&&same(resource.header?.current_revision,result.revision)&&(!result.content_digest||same(resource.revision?.content_digest,result.content_digest))&&(!result.binding_id||same(resource.revision?.binding_id,result.binding_id));
  if(selection?.kind==='conflict')return same(resource.conflict_id,result.conflict_id)&&same(resource.revision,result.revision)&&same(resource.current_handoff_revision,result.handoff_revision);
  if(selection?.kind==='fact')return same(resource.fact_id,result.fact_id)&&same(resource.revision,result.revision)&&(resource.parent_kind==='handoff_conflict'?same(resource.expected_conflict_revision,result.conflict_revision)&&same(resource.expected_handoff_revision,result.handoff_revision):same(resource.expected_parent_revision,result.parent_revision));
  if(selection?.kind==='publication')return same(resource.publication_id,result.publication_id)&&same(resource.event_revision,result.event_revision)||same(resource.publication_id,result.restores_publication_id);
  if(selection?.kind==='package'){
    if(result.intake_id)return trace?.intakes?.some(x=>same(x.intake_id,result.intake_id)&&same(x.current_revision,result.revision))||false;
    if(result.correction_id)return trace?.corrections?.some(x=>same(x.correction_id,result.correction_id)&&same(x.current_revision,result.revision))||false;
    if(result.handoff_id)return trace?.drafts?.some(x=>same(x.handoff_id,result.handoff_id)&&same(x.current_revision,result.revision))||false;
  }
  return false;
}
export const handoffOwner = user => JSON.stringify([user?.personId, user?.accountId, user?.authVersion, user?.departmentId].map(x => x == null ? null : String(x)));
export const handoffRequestUnresolved = draft => Boolean(draft?.request && draft.request.phase !== 'rejected');
export const handoffDraftForOwner = (draft, owner) => draft?.owner === owner ? draft : null;
export const handoffDraftBlocked = (draft, owner) => Boolean(draft && draft.owner !== owner);
export const handoffCanRetry = draft => ['retryable', 'not_observed'].includes(draft?.request?.phase);
export const handoffEditable = draft => Boolean(draft && !handoffRequestUnresolved(draft));
// Hints are exact resource actions from the latest authorized read, never role guesses.
export function handoffActionAllowed({kind,selection,resource,capabilities,packageActions=[],write=null}) {
  if(capabilities?.enabled!==true||capabilities?.read_only!==false||capabilities?.schema_ready!==true||capabilities?.cutover_state!=='controlled'||!resource)return false;
  const has=action=>Array.isArray(resource.allowed_actions)&&resource.allowed_actions.includes(action);
  if(['prepare_intake','create_correction','save_correction','legacy_fact','create_handoff'].includes(kind))return selection?.kind==='package'&&packageActions.includes('prepare');
  if(['review_intake','review_correction'].includes(kind))return selection?.kind==='package'&&packageActions.includes('review');
  if(kind==='conflict_open')return selection?.kind==='handoff'&&has('create_conflict');
  if(kind?.startsWith('conflict_'))return selection?.kind==='conflict'&&has(kind.slice('conflict_'.length));
  if(kind?.startsWith('fact_'))return selection?.kind==='fact'&&has(kind.slice('fact_'.length));
  if(kind==='upgrade_assessment')return selection?.kind==='handoff'&&has('source_upgrade_assessment');
  if(kind==='publication_restore')return selection?.kind==='publication'&&has('prepare_restoration');
  if(kind==='publication_withdraw'){
    if(selection?.kind!=='publication')return false;
    const exact=write?.url?.split('/').at(-1),action={'withdrawal-checks':'withdrawal_checks','withdrawal-approvals':'withdrawal_approval',withdraw:'withdraw_publication'}[exact];
    return action?has(action):!write&&['withdrawal_checks','withdrawal_approval','withdraw_publication'].some(has);
  }
  return selection?.kind==='handoff'&&has(kind==='edit'?'save':kind);
}
export function editHandoffDraft(draft, key, value) {
  if (!handoffEditable(draft)) return draft;
  return {...draft, values: {...draft.values, [key]: value}, dirty: true, request: null};
}
export function freezeHandoffRequest(draft, write, newId = () => globalThis.crypto.randomUUID()) {
  if (!draft) throw new Error('请先明确本次办理内容。');
  if (handoffRequestUnresolved(draft)) {
    if (!handoffCanRetry(draft)) throw new Error('原请求尚待核定，请先查询原请求回执。');
    return {...draft, request: {...draft.request, phase: 'awaiting_receipt'}};
  }
  const requestId = newId();
  if (!uuid.test(requestId)) throw new Error('无法生成请求标识，请保留本次输入。');
  if (!write?.url?.startsWith(handoffRoot + '/') || !['POST', 'PATCH'].includes(write.method || 'POST')) throw new Error('当前办理入口无效。');
  if (!Number.isSafeInteger(write.body?.expected_revision) || write.body.expected_revision < 0) throw new Error('本次办理缺少准确修订号。');
  const body=cloneHandoffValue({...write.body,request_id:requestId});if(body.draft)body.draft=normalizeHandoffSnapshot(body.draft);
  return {...draft, dirty: true, request: {url: write.url, method: write.method || 'POST', body, request_id: requestId, phase: 'awaiting_receipt'}};
}
export function observeHandoffReceipt(draft, receipt) {
  if (!draft?.request || receipt?.request_id !== draft.request.request_id) throw new Error('回执标识不一致，请保留原请求。');
  let phase = receipt.state;
  if (phase === 'prepared') phase = receipt.observation === 'retryable' ? 'retryable' : 'in_progress';
  if (!['committed', 'rejected', 'retryable', 'not_observed', 'in_progress'].includes(phase)) throw new Error('回执状态无法核定，请保留原请求。');
  if (phase === 'committed' && receipt.result?.request_id !== draft.request.request_id) throw new Error('成功回执缺少原请求标识。');
  return {...draft, request: {...draft.request, phase, result: cloneHandoffValue(receipt.result || null)}, dirty: true};
}
export const sourceKeyForHandoff = (selection, resource) => JSON.stringify([selection?.kind, selection?.id,
  resource?.header?.current_revision ?? resource?.revision ?? resource?.event_revision ?? null,
  resource?.revision?.binding_id ?? resource?.binding_id ?? null,
  resource?.revision?.content_digest ?? resource?.snapshot_digest ?? resource?.manifest_digest ?? null,
  resource?.expected_conflict_revision ?? null, resource?.expected_handoff_revision ?? resource?.current_handoff_revision ?? null]);
export const handoffStateName = value => ({draft:'未提交草案',submitted:'待批准',approved:'已批准未发布',published:'已发布',withdrawn:'已撤回',open:'待办理',escalated:'已升级',resolved:'已形成处理结果',verified:'已验证',answered:'已答复待负责人确认',confirmed:'负责人已确认',closed:'已核对关闭',prepared:'待本次核验',reviewed:'本次核验已完成',current:'现行范围',historical:'历史范围'})[value] || businessStatus(value);
