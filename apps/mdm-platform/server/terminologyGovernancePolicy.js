const crypto = require('node:crypto');
const enabled = (env = process.env) => env.TERMINOLOGY_GOVERNANCE_ENABLED === '1';
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code: 'TERM_GOVERNANCE_' + code, statusCode });
const text = value => String(value == null ? '' : value).trim();
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key,stable(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
function businessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
function required(value, label, max = 10000) {
  const result = text(value);
  if (!result || result.length > max) throw fail('INPUT_INVALID', label + '不能为空或超过允许长度', 422);
  return result;
}
function date(value, label) {
  const result = text(value);
  const parsed = new Date(result + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== result) throw fail('INPUT_INVALID', label + '日期无效', 422);
  return result;
}
function normalizeContent(payload) {
  if(['alias','aliases','preferred_term','forbidden_term'].some(key=>Object.hasOwn(payload,key)))throw fail('ALIAS_NOT_SUPPORTED','统一词典不设别名或并行推荐名称；同义概念须按人工确认结果合并',422);
  const source_kind = text(payload.source_kind).toLowerCase();
  if (!['gb','gbt','gbz','custom'].includes(source_kind)) throw fail('SOURCE_KIND_INVALID', '请选择GB、GB/T、GB/Z或自定义来源', 422);
  required(payload.definition,'定义');
  const result = { term: required(payload.term, '术语', 255), definition: String(payload.definition),
    context: required(payload.context, '语境及适用条件', 4000), source_kind,
    standard_number: text(payload.standard_number), standard_version: text(payload.standard_version),
    standard_clause: text(payload.standard_clause), original_definition: String(payload.original_definition ?? ''),
    company_application: text(payload.company_application) };
  if (source_kind !== 'custom') {
    for (const key of ['standard_number','standard_version','standard_clause','original_definition']) required(result[key], '标准来源信息');
    const prefix = result.standard_number.replace(/\s+/g,'').toUpperCase();
    const expected = source_kind === 'gbt' ? /^GB\/T\d/ : source_kind === 'gbz' ? /^GB\/Z\d/ : /^GB\d/;
    if (!expected.test(prefix)) throw fail('SOURCE_CLASSIFICATION_INVALID', '标准号与GB、GB/T、GB/Z分类不一致', 422);
    if (result.definition !== result.original_definition) throw fail('STANDARD_DEFINITION_CHANGED', '标准原定义须原样保存，公司说明请填入公司适用说明', 422);
  }
  return result;
}
function effectiveSuspension(suspension, today = businessDate()) {
  return Boolean(suspension && (suspension.active || (suspension.restored_on && today < suspension.restored_on)) &&
    suspension.effective_from <= today && (!suspension.effective_to || suspension.effective_to >= today) &&
    (!suspension.restored_on || today < suspension.restored_on));
}
function projection(row, version, options = {}) {
  const content = version?.content || version?.content_json || {};
  const c = typeof content === 'string' ? JSON.parse(content) : content;
  const suspension = typeof row.suspension_json === 'string' ? JSON.parse(row.suspension_json) : row.suspension_json;
  const source_kind = c.source_kind || (row.legacy_unverified ? 'legacy' : null);
  const suspended = effectiveSuspension(suspension, options.today);
  const legacy = Boolean(Number(row.legacy_unverified));
  const legacyUsable = row.legacy_usable == null ? false : Boolean(Number(row.legacy_usable));
  const adopted = row.adoption_status === 'adopted' || (legacy && row.adoption_status === 'legacy_preserved' && legacyUsable);
  const usable = Boolean(version && version.version_id === row.current_version_id && adopted && !suspended && !row.merged_into_id && !(source_kind === 'gb' && row.source_status === 'withdrawn'));
  const result = { term_id: row.term_id, version_id: version?.version_id || null, term: c.term || c.term_name || '', definition: c.definition ?? '', context: c.context ?? null,
    source_kind, source_status: row.source_status, adoption_status: row.adoption_status, suspended, suspension: suspension || null,
    merged_into_id: row.merged_into_id || null, revision_no: Number(row.revision_no), usable, legacy_unverified: legacy,
    legacy_status: row.legacy_status || null, legacy_usable: row.legacy_usable == null ? null : legacyUsable,
    source: { standard_number: c.standard_number || null, standard_version: c.standard_version || null, standard_clause: c.standard_clause || null,
      original_definition: c.original_definition || null, company_application: c.company_application || null } };
  // Draft edits, unrelated events and request retries do not invalidate fixed usage.
  result.usage_token = hash({ term_id: result.term_id, version_id: result.version_id, content_hash: version?.content_hash,
    current_version_id:row.current_version_id,adoption_status: result.adoption_status, source_status: result.source_status, suspended, merged_into_id: result.merged_into_id,
    legacy_unverified: legacy, legacy_usable: result.legacy_usable });
  return result;
}
function actions(who, row, pending, current = null) {
  if (who.readOnly) return [];
  const result = [], draft = row.draft_status;
  const contact = who.contact && String(who.departmentId) === String(row.department_id);
  if (contact && !row.merged_into_id && ['draft','returned','not_adopted','none'].includes(draft)) {
    result.push('edit');
    if (row.pending_version_id && ['draft','returned'].includes(draft)) result.push('submit');
  }
  if (who.finalResponsible && String(who.departmentId) === String(row.department_id)) {
    if (draft === 'submitted') result.push('department_confirm');
    if (['submitted','department_confirmed','source_checked'].includes(draft)) result.push('department_return');
  }
  if (who.operator && draft === 'department_confirmed') result.push('source_check');
  if (who.lead && draft === 'source_checked' && pending?.source_kind !== 'gb') result.push('adopt','not_adopt');
  if (who.operator && row.current_version_id && !row.merged_into_id) {
    result.push('suspend');
    if (row.suspension_json?.active && !row.suspension_json.restored_on) result.push('restore');
    if (['gb','gbt'].includes(current?.source_kind) && row.source_status !== 'withdrawn') result.push('source_withdrawn');
    if(current?.source_kind==='gbt'&&row.source_status==='current')result.push('source_superseded');
  }
  if (who.lead) {
    result.push('assign');
    if (row.current_version_id && !row.merged_into_id) {
      result.push('merge');
      if(['gbt','custom'].includes(current?.source_kind))result.push('stop_adoption');
      if(current?.source_kind==='gbt'&&row.adoption_status==='adopted'&&['withdrawn','superseded'].includes(row.source_status))result.push('continue_adoption');
    }
  }
  return result;
}
function transition(row, pending, action, payload) {
  const next = { ...row };
  if (action === 'submit') {
    if (!row.pending_version_id || !['draft','returned'].includes(row.draft_status)) throw fail('STATE_CONFLICT','当前草案不能提交；不采纳结案后须明确修订为新草案');
    next.draft_status = 'submitted';
  } else if (action === 'department_confirm' || action === 'department_return') {
    if (!(action === 'department_return' ? ['submitted','department_confirmed','source_checked'] : ['submitted']).includes(row.draft_status)) throw fail('STATE_CONFLICT','只可核对当前已提交草案');
    next.draft_status = action === 'department_confirm' ? 'department_confirmed' : 'returned';
  } else if (action === 'source_check') {
    if (row.draft_status !== 'department_confirmed') throw fail('STATE_CONFLICT','须先取得部门负责人确认');
    if (pending.source_kind === 'gbz') throw fail('GBZ_NOT_ADOPTABLE','GB/Z不能按国标采用；如需该术语，请明确按自定义重新提报',422);
    next.draft_status = pending.source_kind === 'gb' ? 'none' : 'source_checked';
    if (pending.source_kind === 'gb') Object.assign(next,{ current_version_id: row.pending_version_id, pending_version_id: null, adoption_status:'adopted', source_status:'current', legacy_unverified:0 });
  } else if (action === 'adopt' || action === 'not_adopt') {
    if (row.draft_status !== 'source_checked' || !['gbt','custom'].includes(pending.source_kind)) throw fail('STATE_CONFLICT','当前草案尚未具备公司采纳条件');
    next.draft_status = action === 'adopt' ? 'none' : 'not_adopted';
    if (action === 'adopt') Object.assign(next,{current_version_id:row.pending_version_id,pending_version_id:null,adoption_status:'adopted',source_status:'current',legacy_unverified:0});
    else if (!row.current_version_id) next.adoption_status = 'not_adopted';
  } else if (action === 'stop_adoption') {
    if (!row.current_version_id || row.merged_into_id) throw fail('STATE_CONFLICT','当前词条无可停止的公司采用版本');
    next.adoption_status = 'stopped';
  } else if (action === 'source_withdrawn') {
    if (!row.current_version_id) throw fail('STATE_CONFLICT','当前词条没有生效版本');
    next.source_status = 'withdrawn';
  } else if(action==='source_superseded'){
    if(!row.current_version_id)throw fail('STATE_CONFLICT','当前词条没有采用版本');
    next.source_status='superseded';
  } else if(action==='continue_adoption'){
    if(row.adoption_status!=='adopted'||!['withdrawn','superseded'].includes(row.source_status))throw fail('STATE_CONFLICT','继续采用不能恢复已停止采用或未采纳的词条');
  } else if (action === 'suspend') {
    if (!row.current_version_id || row.merged_into_id) throw fail('STATE_CONFLICT','当前词条不能暂停');
    const from = date(payload.effective_from,'开始'), to = payload.effective_to ? date(payload.effective_to,'结束') : null;
    if (to && to < from) throw fail('INPUT_INVALID','结束日期不能早于开始日期',422);
    next.suspension_json = {active:true,effective_from:from,effective_to:to,scope:required(payload.scope,'暂停范围',4000),reason:required(payload.reason,'原因')};
  } else if (action === 'restore') {
    if (!row.suspension_json?.active || row.suspension_json.restored_on) throw fail('STATE_CONFLICT','当前词条没有待恢复的暂停');
    // Only ends the pause. Rejection, adoption and withdrawn GB source stay unchanged.
    const restored = date(payload.effective_from,'恢复');
    if (restored < row.suspension_json.effective_from) throw fail('INPUT_INVALID','恢复日期不能早于本次暂停开始日期',422);
    next.suspension_json = {...row.suspension_json,active:false,restored_on:restored,restore_reason:required(payload.reason,'恢复原因')};
  } else if (!['assign','merge'].includes(action)) throw fail('ACTION_INVALID','不支持的术语动作',422);
  return next;
}
module.exports = { enabled, fail, text, hash, businessDate, required, date, normalizeContent, effectiveSuspension, projection, actions, transition };
