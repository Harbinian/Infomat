// Case-scoped coordination appends to the existing preview audit log. It never
// substitutes a coordination/decision record for either department's fact review.
const crypto = require('node:crypto');
const { sessionSubject, identityInteger, sameIdentityInteger: same } = require('./sessionSubject');
const { readPersonAuthority, readPersonQualification } = require('./identityMysqlRepository');
const { assertV7PreviewEnabled } = require('./processV7TrialScope');
const { caseStatusFromItems } = require('./processPreviewReview');
const EVENT = 'process_dispute_action';
const fail = (code, message, statusCode = 409) => Object.assign(new Error(message), { code: 'PROCESS_DISPUTE_' + code, statusCode });
const id = value => { const n = identityInteger(value); if (n === null) throw fail('INPUT_INVALID', '事项或人员标识无效', 422); return String(n); };
const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
async function one(db, sql, params = []) { return (await db.execute(sql, params))[0][0] || null; }
async function currentActor(db, session, write = false) {
  const subject = sessionSubject(session);
  if (subject.kind === 'system_admin') {
    if (write) throw fail('ADMIN_READ_ONLY', '管理员不能办理流程争议', 403);
    const { permSet } = await require('./systemAdminIdentity').permissions(db, subject.principal);
    return { personId: null, departmentId: null, permissions: permSet, roleCodes: new Set(['admin']), readOnly: true };
  }
  const authority = await readPersonAuthority(db, session, subject.personId, { currentRead: write });
  if (!authority.valid) throw fail('IDENTITY_CHANGED', '身份或授权已变化，请重新登录', 401);
  if (write && authority.readOnly) throw fail('ADMIN_READ_ONLY', '管理员不能办理流程争议', 403);
  return { ...session, personId: authority.user.personId, departmentId: authority.user.current_department_id,
    permissions: authority.permissions, roleCodes: authority.roleCodes, readOnly: authority.readOnly };
}
async function context(db, caseId, lock = false) {
  const row = await one(db, `SELECT *, CAST(id AS CHAR) id, CAST(owning_department_id AS CHAR) owning_department_id
    FROM process_v7_preview_cases WHERE id=?${lock ? ' FOR UPDATE' : ''}`, [id(caseId)]);
  if (!row) throw fail('NOT_FOUND', '流程案例不存在或无权查看', 404);
  const [items] = await db.execute(`SELECT *,CAST(id AS CHAR) id,CAST(origin_department_id AS CHAR) origin_department_id,
    CAST(target_department_id AS CHAR) target_department_id FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1 ORDER BY id${lock ? ' FOR UPDATE' : ''}`, [row.id]);
  const event = await one(db, `SELECT e.*,CAST(e.id AS CHAR) id FROM process_v7_preview_events e
    WHERE case_id=? AND event_type=? ORDER BY e.id DESC LIMIT 1${lock ? ' FOR SHARE' : ''}`, [row.id, EVENT]);
  const value = event ? parse(event.payload_json) : null;
  if (value && (value.schema_version !== 'process-dispute-v1' || !Array.isArray(value.item_keys))) throw fail('HISTORY_INVALID', '争议记录结构不完整，须先核对历史');
  return { row, items, event, value, state: disputeState(row, items, value) };
}
function disputeState(row, items, value) {
  if (!value) return items.some(i => i.status === 'disputed') ? 'unassigned' : 'none';
  if (value.stage === 'resolved') return items.some(i => i.status === 'disputed') ? 'unassigned' : 'resolved';
  if (Number(value.source_revision_no) !== Number(row.current_revision_no) || value.source_content_hash !== row.current_content_hash) return 'source_changed';
  if (value.stage === 'awaiting_recheck') {
    const checked = value.item_keys.every(key => items.some(i => i.stable_item_key === key && i.origin_status === 'confirmed' && i.counterparty_status === 'confirmed'));
    if (checked && row.status === 'review_complete') return 'resolved';
    if (items.some(i => i.status === 'disputed')) return 'coordinating';
  }
  return value.stage;
}
function actions(who, c) {
  if (who.readOnly || c.row.status === 'closed') return [];
  const lead = who.roleCodes.has('mdm_lead') && who.permissions.has('governance:assign-work');
  const handler = same(who.personId, c.value?.coordinator_person_id) && who.roleCodes.has('data_conflict_handler') && who.permissions.has('governance:handle-assigned-conflict');
  const result = [];
  if (lead && !['none', 'resolved'].includes(c.state)) result.push('assign');
  if (lead && c.state === 'source_changed') result.push('rebase');
  if (handler && c.state === 'coordinating') result.push('coordinate', 'request_recheck');
  if ((lead || handler) && c.state === 'coordinating' && who.permissions.has('governance:escalate-conflict')) result.push('escalate');
  if (c.state === 'escalated' && who.roleCodes.has('decision_group') && who.permissions.has('governance:decide-escalation')) result.push('decide');
  return result;
}
async function canRead(db, who, c) {
  if (who.permissions.has('governance:read-global')) return true;
  if (who.permissions.has('governance:read-department') && (same(who.departmentId, c.row.owning_department_id) || c.items.some(i => same(who.departmentId, i.target_department_id)))) return true;
  if (who.permissions.has('governance:read-assigned-context') && same(who.personId, c.value?.coordinator_person_id)) return true;
  if (who.permissions.has('governance:read-escalated-context') && currentEscalation(c.value,c.row)) return true;
  const responsibilities = require('./governanceResponsibilities');
  return await responsibilities.hasAssignedResponsibility(db, who, 'case', c.row.id, 'steward') ||
    await responsibilities.hasAssignedResponsibility(db, who, 'case', c.row.id, 'owner');
}
function currentEscalation(value,row) {
  return Boolean(value?.was_escalated && !(value.stage==='resolved' && row.status==='disputed') &&
    Number(value.source_revision_no)===Number(row.current_revision_no) && value.source_content_hash===row.current_content_hash);
}
async function currentDisputeEventId(db,caseId) {
  const event=await one(db,'SELECT CAST(id AS CHAR) AS dispute_event_id FROM process_v7_preview_events WHERE case_id=? AND event_type=? ORDER BY id DESC LIMIT 1',[String(caseId),EVENT]);
  return event?.dispute_event_id || '0';
}
async function assertCaseDisputeResolved(db, caseRow) {
  const event = await one(db, `SELECT payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type=? ORDER BY id DESC LIMIT 1`, [String(caseRow.id), EVENT]);
  if (!event) return;
  const value = parse(event.payload_json);
  if (!value || value.schema_version !== 'process-dispute-v1' || !Array.isArray(value.item_keys)) throw fail('HISTORY_INVALID', '争议记录结构不完整，不能正式流转');
  const [items] = await db.execute('SELECT stable_item_key,status,origin_status,counterparty_status FROM process_v7_preview_review_items WHERE case_id=? AND is_current=1', [String(caseRow.id)]);
  if (disputeState(caseRow, items, value) !== 'resolved') throw fail('UNRESOLVED', '流程争议尚未完成协调及参与部门重新核对，不能正式流转');
}
async function hasDisputeContext(db, caseId, actor) {
  const event=await one(db,`SELECT e.payload_json,c.current_revision_no,c.current_content_hash,c.status FROM process_v7_preview_events e
    JOIN process_v7_preview_cases c ON c.id=e.case_id WHERE e.case_id=? AND e.event_type=? ORDER BY e.id DESC LIMIT 1`,[String(caseId),EVENT]);
  if(!event)return false;
  const value=parse(event.payload_json);
  return Boolean(actor.permissions?.has('governance:read-assigned-context')&&same(actor.personId,value?.coordinator_person_id) ||
    actor.permissions?.has('governance:read-escalated-context')&&currentEscalation(value,event));
}
// Invoked by the department review transaction after both sides have actually
// rechecked. A later revision must not resurrect a previously completed dispute.
async function recordResolvedDispute(db, caseRow, actor) {
  const previous=await one(db,'SELECT payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type=? ORDER BY id DESC LIMIT 1',[String(caseRow.id),EVENT]);
  if(!previous)return;
  const c=await context(db,caseRow.id,true);
  if(c.state!=='resolved'||!c.value||c.value.stage==='resolved')return;
  const value={...c.value,stage:'resolved',action:'department_recheck_completed',request_id:crypto.randomUUID(),
    request_hash:null,previous_event_id:c.event.id};
  await db.execute(`INSERT INTO process_v7_preview_events(case_id,revision_id,event_type,actor_user_id,actor_person_id,actor_department_id,actor_role_code,basis_text,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,[c.row.id,c.row.current_revision_id,EVENT,String(actor.personId),String(actor.personId),actor.departmentId==null?null:String(actor.departmentId),actor.roleCode||null,'相关部门已分别重新核对当前修订，原协调及决定记录保留',JSON.stringify(value)]);
}
function makeProcessCaseDisputes(pool) {
  async function detail(db, session, caseId) {
    assertV7PreviewEnabled();
    const c = await context(db, caseId), who = await currentActor(db, session);
    if (!await canRead(db, who, c)) throw fail('NOT_FOUND', '流程案例不存在或无权查看', 404);
    const allowed_actions = actions(who, c);
    const [history] = await db.execute(`SELECT CAST(id AS CHAR) event_id,event_type,basis_text,decision,payload_json,
      CAST(actor_person_id AS CHAR) actor_person_id,UNIX_TIMESTAMP(created_at) created_epoch
      FROM process_v7_preview_events WHERE case_id=? AND event_type=? ORDER BY id DESC LIMIT 100`, [c.row.id, EVENT]);
    const candidates = [];
    if (allowed_actions.includes('assign')) {
      const [people] = await db.execute(`SELECT DISTINCT CAST(p.person_id AS CHAR) person_id,p.person_name FROM person p
        JOIN person_roles pr ON pr.person_id=p.person_id JOIN roles r ON r.role_id=pr.role_id WHERE r.role_code='data_conflict_handler' ORDER BY person_id`);
      for (const person of people) {
        const qualification = await readPersonQualification(db, person.person_id);
        if (qualification.valid && !qualification.readOnly && qualification.permissions.has('governance:handle-assigned-conflict') && qualification.roleCodes.has('data_conflict_handler')) candidates.push(person);
      }
    }
    return { case_id: c.row.id, source_revision_no: c.row.current_revision_no, source_content_hash: c.row.current_content_hash,
      event_id: c.event?.id || '0', state: c.state, coordinator_person_id: c.value?.coordinator_person_id || null,
      related_departments: [...new Map(c.items.filter(i => c.state !== 'unassigned' && c.value?.item_keys?.includes(i.stable_item_key) || i.status === 'disputed').flatMap(i => [[String(i.origin_department_id),i.origin_department_name],[String(i.target_department_id),i.target_department_name]])).entries()].map(([department_id,department_name])=>({department_id,department_name})),
      history: history.map(e => ({...e, payload: parse(e.payload_json), payload_json: undefined, created_at: new Date(Number(e.created_epoch)*1000).toISOString(),created_epoch:undefined})), allowed_actions, candidates };
  }
  async function act(session, caseId, input) {
    assertV7PreviewEnabled();
    const allowedKeys = new Set(['action','request_id','expected_event_id','expected_revision_no','expected_content_hash','basis','coordinator_person_id','decision','escalation_materials']);
    if (!input || Object.keys(input).some(k => !allowedKeys.has(k)) || typeof input.basis !== 'string' || !input.basis.trim() || input.basis.length > 4000 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.request_id || '')) throw fail('INPUT_INVALID', '请填写办理依据并使用有效请求标识', 422);
    const db = await pool.getConnection();
    let committing = false;
    try {
      await db.beginTransaction();
      const c = await context(db, caseId, true), who = await currentActor(db, session, true);
      if (!await canRead(db, who, c)) throw fail('NOT_FOUND', '流程案例不存在或无权查看', 404);
      const requestHash = crypto.createHash('sha256').update(JSON.stringify({person_id:String(who.personId), input})).digest('hex');
      const previous = await one(db, `SELECT payload_json FROM process_v7_preview_events WHERE case_id=? AND event_type=? AND JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.request_id'))=? LIMIT 1`, [c.row.id, EVENT, input.request_id]);
      if (previous) {
        if (parse(previous.payload_json).request_hash !== requestHash) throw fail('REQUEST_CONFLICT', '请求标识已用于不同内容');
        const result = { idempotent: true, ...(await detail(db, session, caseId)) };
        committing = true; await db.commit(); return result;
      }
      if (!actions(who, c).includes(input.action)) throw fail('ACTION_DENIED', '当前身份或事项状态不允许此操作', 403);
      if (String(input.expected_event_id) !== String(c.event?.id || '0') || input.expected_revision_no !== c.row.current_revision_no || input.expected_content_hash !== c.row.current_content_hash) throw fail('SOURCE_CHANGED', '事项或来源已变化，请核对最新记录；当前输入应保留');
      let coordinator = c.value?.coordinator_person_id || null;
      if (input.action === 'assign') {
        coordinator = id(input.coordinator_person_id);
        const reader = { execute(sql,params) { if (!/^\s*SELECT\b/i.test(sql)) throw new Error('qualification reader is read only'); return db.execute(sql + ' FOR SHARE',params); } };
        const q = await readPersonQualification(reader, coordinator);
        if (!q.valid || q.readOnly || !q.roleCodes.has('data_conflict_handler') || !q.permissions.has('governance:handle-assigned-conflict')) throw fail('ASSIGNEE_INVALID', '接收者须是具有有效权限的数据冲突处理人', 422);
      }
      let stage = c.value?.stage || 'coordinating';
      let itemKeys = c.value?.item_keys || c.items.filter(i => i.status === 'disputed').map(i => i.stable_item_key);
      // New disagreements can arise while prior items are being rechecked.
      // The next explicit action records them in the same coordination round.
      itemKeys = [...new Set([...itemKeys, ...c.items.filter(i=>i.status==='disputed').map(i=>i.stable_item_key)])];
      if (input.action === 'assign' && c.state === 'unassigned') { stage = 'coordinating'; itemKeys=c.items.filter(i=>i.status==='disputed').map(i=>i.stable_item_key); }
      if (input.action === 'rebase') {
        // Changing the source cannot cancel a pending decision-group escalation.
        stage = c.value.stage === 'escalated' ? 'escalated' : 'coordinating';
        itemKeys = c.items.map(i => i.stable_item_key);
      }
      let escalation = c.value?.escalation_materials || null;
      if (input.action === 'escalate') {
        const departments=[...new Set(c.items.filter(i=>itemKeys.includes(i.stable_item_key)).flatMap(i=>[String(i.origin_department_id),String(i.target_department_id)]))];
        escalation = require('./processDisputeMaterials').escalationMaterials(input.escalation_materials,departments);
        stage = 'escalated';
      }
      if (input.action === 'decide') {
        // Legacy escalations retain their record; missing materials must be
        // supplied explicitly before a new decision can rely on that escalation.
        const departments=[...new Set(c.items.filter(i=>itemKeys.includes(i.stable_item_key)).flatMap(i=>[String(i.origin_department_id),String(i.target_department_id)]))];
        escalation = require('./processDisputeMaterials').escalationMaterials(input.escalation_materials || escalation,departments);
        if (!['recheck','return_for_revision'].includes(input.decision)) throw fail('INPUT_INVALID', '请选择重新核对或退回修订', 422);
        stage = input.decision === 'return_for_revision' ? 'awaiting_revision' : 'awaiting_recheck';
      }
      if (input.action === 'request_recheck') stage = 'awaiting_recheck';
      if (['request_recheck','decide'].includes(input.action)) {
        // Capture both former opinions below before reopening their own review tasks.
        for (const item of c.items.filter(i => itemKeys.includes(i.stable_item_key))) {
          await db.execute(`UPDATE process_v7_preview_review_items SET origin_status='pending',counterparty_status='pending',status='pending',
            origin_basis=NULL,counterparty_basis=NULL,origin_decided_by_user_id=NULL,origin_decided_by_person_id=NULL,origin_decided_at=NULL,
            counterparty_decided_by_user_id=NULL,counterparty_decided_by_person_id=NULL,counterparty_decided_at=NULL WHERE id=?`, [item.id]);
        }
        const next = c.items.map(i => itemKeys.includes(i.stable_item_key) ? {...i,origin_status:'pending',counterparty_status:'pending',status:'pending'} : i);
        const status = caseStatusFromItems(next, Boolean(c.row.owning_department_id), parse(c.row.blocking_issues_json), c.row.scope_decision);
        await db.execute('UPDATE process_v7_preview_cases SET status=? WHERE id=?', [status, c.row.id]);
      }
      const value = { schema_version:'process-dispute-v1',request_id:input.request_id,request_hash:requestHash,action:input.action,
        stage,coordinator_person_id:coordinator,item_keys:itemKeys,was_escalated:Boolean(input.action==='assign' && c.state==='unassigned' ? false : c.value?.was_escalated || input.action==='escalate'),
        source_revision_no:c.row.current_revision_no,source_content_hash:c.row.current_content_hash,
        escalation_materials:escalation,
        previous_event_id:c.event?.id || null,department_positions:c.items.filter(i=>itemKeys.includes(i.stable_item_key)).map(i=>({item_id:i.id,stable_item_key:i.stable_item_key,origin_status:i.origin_status,counterparty_status:i.counterparty_status,origin_basis:i.origin_basis,counterparty_basis:i.counterparty_basis})) };
      // Reassignment retains a changed-source block until the lead explicitly reviews its impact.
      if (input.action==='assign' && c.state==='source_changed') { value.source_revision_no=c.value.source_revision_no; value.source_content_hash=c.value.source_content_hash; }
      await db.execute(`INSERT INTO process_v7_preview_events(case_id,revision_id,event_type,actor_user_id,actor_person_id,actor_department_id,actor_role_code,decision,basis_text,payload_json)
        VALUES (?,?,?,?,?,?,?,?,?,?)`, [c.row.id,c.row.current_revision_id,EVENT,String(who.personId),String(who.personId),who.departmentId==null?null:String(who.departmentId),who.roleCodes.has('decision_group')?'decision_group':who.roleCodes.has('mdm_lead')?'mdm_lead':'data_conflict_handler',input.decision||null,input.basis.trim(),JSON.stringify(value)]);
      const result = await detail(db,session,caseId);
      committing = true; await db.commit();
      return result;
    } catch (error) {
      if(committing)throw fail('COMMIT_UNKNOWN','操作结果尚未确认，请保留输入并刷新核对办理记录',503);
      await db.rollback(); throw error;
    } finally { db.release(); }
  }
  async function workbench(session) {
    assertV7PreviewEnabled();
    const who = await currentActor(pool,session);
    const global = who.permissions.has('governance:read-global');
    const [rows] = await pool.execute(`SELECT CAST(c.id AS CHAR) id,c.process_name FROM process_v7_preview_cases c
      WHERE c.status<>'closed' AND (c.status='disputed' OR EXISTS(SELECT 1 FROM process_v7_preview_events e WHERE e.case_id=c.id AND e.event_type=?))
      AND (?=1 OR c.owning_department_id=? OR EXISTS(SELECT 1 FROM process_v7_preview_events e WHERE e.case_id=c.id AND e.event_type=? AND
       (JSON_UNQUOTE(JSON_EXTRACT(e.payload_json,'$.coordinator_person_id'))=? OR ?=1))) ORDER BY c.id DESC LIMIT 201`,
      [EVENT,global?1:0,String(who.departmentId||0),EVENT,String(who.personId||0),who.permissions.has('governance:read-escalated-context')?1:0]);
    const items=[];
    for(const row of rows.slice(0,200)) { const c=await context(pool,row.id); if(await canRead(pool,who,c) && c.state!=='resolved') items.push({case_id:row.id,process_name:row.process_name,state:c.state,allowed_actions:actions(who,c),target:'/app/process-preview?case='+row.id}); }
    return {items,truncated:rows.length>200};
  }
  return {detail:(session,caseId)=>detail(pool,session,caseId),act,workbench};
}
module.exports = { makeProcessCaseDisputes, assertCaseDisputeResolved, recordResolvedDispute, hasDisputeContext, currentDisputeEventId, disputeState, actions };
