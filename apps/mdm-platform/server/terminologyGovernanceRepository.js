// Company dictionary state is separate from immutable definition content and events.
// All mutation entry points own one transaction and re-read current authority.
const crypto = require('node:crypto');
const p = require('./terminologyGovernancePolicy');
const authority = require('./terminologyGovernanceAuthority');
const { MIGRATION_KEY, TABLES } = require('./terminologyGovernanceSchema');
const { sameIdentityInteger: same, identityInteger } = require('./sessionSubject');
const { decisionEvidence, inspectCurrentDepartmentDecision } = require('./departmentAccountability');
const uuid = () => crypto.randomUUID();
const parse = (value, fallback = null) => value == null ? fallback : typeof value === 'string' ? JSON.parse(value) : value;
const one = async (db,sql,params = []) => (await db.execute(sql,params))[0][0] || null;
const asId = value => { const result = p.text(value); if (!/^[a-zA-Z0-9_-]{1,80}$/.test(result)) throw p.fail('ID_INVALID','术语或事项标识无效',422); return result; };
const personId = value => { const id = identityInteger(value); if (!id || String(id) === '0') throw p.fail('PERSON_INVALID','人员或部门标识无效',422); return String(id); };
function publicVersion(row) { return row ? {...row,version_no:Number(row.version_no),content:parse(row.content_json,{})} : null; }
function hydrate(row) {
  if (!row) return null;
  return {...row,revision_no:Number(row.revision_no),department_confirmation_json:parse(row.department_confirmation_json),
    source_check_json:parse(row.source_check_json),suspension_json:parse(row.suspension_json)};
}
async function readTerm(db,id,lock = false) {
  return hydrate(await one(db,`SELECT *,CAST(department_id AS CHAR) department_id,CAST(created_by_person_id AS CHAR) created_by_person_id FROM tg_terms WHERE term_id=?${lock ? ' FOR UPDATE' : ''}`,[asId(id)]));
}
async function readVersion(db,id,lock = false) {
  if (!id) return null;
  const version = publicVersion(await one(db,`SELECT * FROM tg_term_versions WHERE version_id=?${lock ? ' FOR SHARE' : ''}`,[asId(id)]));
  if (!version) throw p.fail('VERSION_MISSING','词条引用的定义版本缺失，请先核对存储完整性',503);
  return version;
}
async function assertReady(db,env = process.env,lock = false) {
  if (!p.enabled(env)) throw p.fail('DISABLED','术语治理入口尚未开启',503);
  try {
    const marker = await one(db,`SELECT migration_key FROM schema_migrations WHERE migration_key=?${lock ? ' FOR SHARE' : ''}`,[MIGRATION_KEY]);
    if (!marker) throw p.fail('MIGRATION_REQUIRED','术语治理显式迁移尚未准备',503);
    // A copied marker is not proof that every part of the schema exists.
    for (const table of TABLES) await db.execute(`SELECT 1 FROM ${table} LIMIT 0`);
  } catch (error) {
    if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code)) throw p.fail('MIGRATION_REQUIRED','术语治理显式迁移尚未准备',503);
    throw error;
  }
}
async function resolveTerm(db,termId,options = {}) {
  const row = options.row || await readTerm(db,termId,Boolean(options.lock));
  if (!row) return null;
  const version = await readVersion(db,options.versionId || options.version_id || row.current_version_id,Boolean(options.lock));
  if (version && version.term_id !== row.term_id) throw p.fail('VERSION_MISMATCH','术语及定义版本不一致',422);
  return p.projection(row,version,{today:options.today});
}
function assertRevision(row,payload) {
  if (!Number.isSafeInteger(payload.expected_revision) || payload.expected_revision !== row.revision_no) throw p.fail('REVISION_CONFLICT','术语已变化，当前输入保留，请刷新后核对');
}
async function saveState(db,row) {
  const fields = ['current_version_id','pending_version_id','draft_status','adoption_status','source_status','department_confirmation_json','source_check_json','suspension_json','merged_into_id','legacy_unverified'];
  await db.execute(`UPDATE tg_terms SET ${fields.map(key => key + '=?').join(',')},revision_no=revision_no+1 WHERE term_id=? AND revision_no=?`,
    [...fields.map(key => key.endsWith('_json') ? row[key] == null ? null : JSON.stringify(row[key]) : row[key] ?? null),row.term_id,row.revision_no]);
  return {...row,revision_no:row.revision_no+1};
}
async function event(db,row,who,type,reason,payload = {},versionId = null) {
  await db.execute(`INSERT INTO tg_term_events(event_id,term_id,event_type,version_id,revision_no,actor_person_id,actor_department_id,reason,payload_json)
    VALUES (?,?,?,?,?,?,?,?,?)`,[uuid(),row.term_id,type,versionId,row.revision_no,who.personId == null ? null : String(who.personId),who.departmentId == null ? null : String(who.departmentId),reason || null,JSON.stringify(payload)]);
}
async function addVersion(db,row,content,who) {
  const latest = await one(db,'SELECT COALESCE(MAX(version_no),0) version_no FROM tg_term_versions WHERE term_id=?',[row.term_id]);
  const version = {version_id:uuid(),term_id:row.term_id,version_no:Number(latest?.version_no || 0)+1,content,content_hash:p.hash(content)};
  await db.execute(`INSERT INTO tg_term_versions(version_id,term_id,version_no,content_json,content_hash,created_by_person_id) VALUES (?,?,?,?,?,?)`,
    [version.version_id,row.term_id,version.version_no,JSON.stringify(content),version.content_hash,String(who.personId)]);
  return version;
}
async function assertConfirmation(db,row,pending,inspect = inspectCurrentDepartmentDecision) {
  const check = await inspect(db,row.department_id,row.department_confirmation_json,
    {sourceRevision:pending.version_no,sourceHash:pending.content_hash,lock:true});
  if (!check.valid) throw p.fail('DEPARTMENT_RECONFIRM_REQUIRED','部门负责人或授权已变化，须退回并重新确认当前草案');
}
function makeTerminologyGovernanceRepository(pool,options = {}) {
  const env = options.env || process.env;
  const auth = options.authority || authority;
  async function detailFrom(db,session,id,providedWho = null) {
    const row = await readTerm(db,id);
    if (!row) throw p.fail('NOT_FOUND','术语不存在或不在当前可读范围',404);
    const who = await auth.forTerm(db,providedWho || await auth.currentActor(db,session),row);
    const internal = auth.canReadProcess(who,row);
    const pending = await readVersion(db,row.pending_version_id);
    const current = await readVersion(db,row.current_version_id);
    const [rawEvents] = await db.execute('SELECT * FROM tg_term_events WHERE term_id=? ORDER BY revision_no,event_id',[row.term_id]);
    const history = rawEvents.map(e => ({...e,payload:parse(e.payload_json,{})}));
    const published = new Set([row.current_version_id,...history.filter(e => e.payload.public_definition === true).map(e => e.version_id)].filter(Boolean));
    if(!row.current_version_id&&!internal&&!published.size)throw p.fail('NOT_FOUND','术语不存在或不在当前可读范围',404);
    const [rawVersions] = await db.execute('SELECT * FROM tg_term_versions WHERE term_id=? ORDER BY version_no',[row.term_id]);
    const versions = rawVersions.filter(v => internal || published.has(v.version_id)).map(publicVersion);
    const visibleEvents = internal ? history : history.filter(e => e.payload.public_definition || e.payload.public_conclusion).map(e =>
      ({event_id:e.event_id,event_type:e.event_type,version_id:e.version_id,created_at:e.created_at,reason:e.reason,conclusion:e.payload.public_conclusion || null}));
    const base = p.projection(row,current || (internal ? pending : null) || versions.at(-1));
    const allowed = p.actions(who,row,pending?.content,current?.content);
    if (!who.readOnly && who.personId && row.current_version_id && current?.content.source_kind === 'custom' && row.adoption_status === 'adopted') allowed.push('create_challenge');
    return {...base,department_id:row.department_id,concept_key:internal ? row.concept_key : undefined,
      draft_status:internal ? row.draft_status : undefined,pending_version:internal ? pending : undefined,versions,events:visibleEvents,
      allowed_actions:allowed,can_read_process:internal,assigned_to_me:Boolean(who.steward && who.assigned)};
  }
  async function perform(session,kind,termId,payload,worker) {
    if (!p.enabled(env)) throw p.fail('DISABLED','术语治理入口尚未开启',503);
    const requestId = p.required(payload.request_id,'请求标识',80);
    if (!/^[a-zA-Z0-9_-]{16,80}$/.test(requestId)) throw p.fail('REQUEST_INVALID','请求标识无效',422);
    const db = await pool.getConnection();
    let committing = false;
    try {
      await db.beginTransaction();
      await assertReady(db,env,true);
      const targets = [...new Set([termId,kind === 'action' && payload.action === 'merge' ? payload.target_term_id : null].filter(Boolean))].sort();
      const locked = new Map();
      for (const target of targets) {
        const row = await readTerm(db,target,true);
        if (!row) throw p.fail('NOT_FOUND','术语不存在或不在当前可读范围',404);
        locked.set(target,row);
      }
      const who = await auth.currentActor(db,session,true);
      const requestHash = p.hash({kind,term_id:termId || null,payload});
      await db.execute(`INSERT INTO tg_requests(actor_person_id,request_id,request_hash) VALUES (?,?,?) ON DUPLICATE KEY UPDATE request_id=request_id`,[String(who.personId),requestId,requestHash]);
      const prior = await one(db,'SELECT request_hash,response_json FROM tg_requests WHERE actor_person_id=? AND request_id=? FOR UPDATE',[String(who.personId),requestId]);
      if (prior.request_hash !== requestHash) throw p.fail('REQUEST_REUSED','同一请求标识不能用于不同内容');
      if (prior.response_json) { await db.commit(); return {...parse(prior.response_json),idempotent:true}; }
      const row = termId ? locked.get(termId) : null;
      if (row) assertRevision(row,payload);
      const result = await worker(db,who,row,locked);
      await db.execute('UPDATE tg_requests SET response_json=? WHERE actor_person_id=? AND request_id=?',[JSON.stringify(result),String(who.personId),requestId]);
      committing = true;
      await db.commit();
      return result;
    } catch (error) {
      await db.rollback().catch(() => {});
      if (['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT'].includes(error.code)) throw p.fail('BUSY','记录正在并发办理，本次未完成，请保留输入后核对');
      if (error.code === 'ER_DUP_ENTRY') throw p.fail('CONCEPT_EXISTS','该语境已有相同概念标识；请核对已有词条，不自动按名称合并');
      if (committing) throw p.fail('WRITE_UNKNOWN','提交回执不明，请保留请求标识并核对，不能另建请求重试',503);
      if (['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code)) throw p.fail('MIGRATION_REQUIRED','术语治理存储尚未准备',503);
      throw error;
    } finally { db.release(); }
  }
  const repo = {
    async capabilities(session) {
      if (!p.enabled(env)) return {enabled:false,ready:false,allowed_actions:[],migration_key:MIGRATION_KEY};
      await assertReady(pool,env);
      const who = await auth.currentActor(pool,session);
      const count = who.steward && who.personId ? await one(pool,'SELECT COUNT(DISTINCT term_id) assigned_count FROM tg_assignments WHERE assignee_person_id=? AND active=1',[String(who.personId)]) : null;
      return {enabled:true,ready:true,migration_key:MIGRATION_KEY,assigned_terms_count:Number(count?.assigned_count || 0),allowed_actions:who.readOnly ? [] : who.contact ? ['create_term'] : []};
    },
    async listTerms(session,filters = {}) {
      await assertReady(pool,env);
      const who = await auth.currentActor(pool,session);
      const [rows] = await pool.execute('SELECT term_id FROM tg_terms ORDER BY created_at,term_id');
      const items = [];
      for (const row of rows) {
        try {
          const detail = await detailFrom(pool,session,row.term_id,who);
          if ((filters.assigned === true || filters.assigned === 'true') && !detail.assigned_to_me) continue;
          if ((!filters.q || (detail.term + ' ' + (detail.context || '')).includes(p.text(filters.q))) && (!filters.usable || detail.usable)) items.push(detail);
        } catch (error) { if (error.code !== 'TERM_GOVERNANCE_NOT_FOUND') throw error; }
      }
      return {items};
    },
    async getTerm(session,id) { await assertReady(pool,env); return detailFrom(pool,session,id); },
    async suggestions(session,filters = {}) {
      const result = await repo.listTerms(session,{q:filters.q,usable:true});
      return {items:result.items.map(({term_id,version_id,term,definition,context,usage_token,legacy_unverified}) =>
        ({term_id,version_id,term,definition,context,usage_token,legacy_unverified})),automatic_confirmation:false};
    },
    async createTerm(session,payload) {
      return perform(session,'create',null,payload,async (db,who) => {
        auth.assertContact(who);
        const content = p.normalizeContent(payload), concept = p.text(payload.concept_key) ? p.required(payload.concept_key,'概念技术标识',255) : uuid();
        if (payload.department_id != null && !same(payload.department_id,who.departmentId)) throw p.fail('CONTACT_REQUIRED','只能提报本部门术语',403);
        const row = {term_id:uuid(),concept_key:concept,context_hash:p.hash(content.context),concept_hash:p.hash(concept),
          department_id:String(who.departmentId),created_by_person_id:String(who.personId),current_version_id:null,pending_version_id:null,
          draft_status:'draft',adoption_status:'never_adopted',source_status:'current',revision_no:1,legacy_unverified:0};
        await db.execute(`INSERT INTO tg_terms(term_id,concept_key,context_hash,concept_hash,department_id,created_by_person_id) VALUES (?,?,?,?,?,?)`,
          [row.term_id,concept,row.context_hash,row.concept_hash,row.department_id,row.created_by_person_id]);
        const version = await addVersion(db,row,content,who);
        await db.execute('UPDATE tg_terms SET pending_version_id=? WHERE term_id=?',[version.version_id,row.term_id]);
        row.pending_version_id = version.version_id;
        await event(db,row,who,'draft_created',payload.reason,{content_hash:version.content_hash},version.version_id);
        return detailFrom(db,session,row.term_id,who);
      });
    },
    async updateTerm(session,id,payload) {
      return perform(session,'update',asId(id),payload,async (db,who,row) => {
        auth.assertContact(who,row);
        if (!['none','draft','returned','not_adopted'].includes(row.draft_status) || row.merged_into_id) throw p.fail('STATE_CONFLICT','须先退回当前提报后再修订');
        const reason=p.required(payload.reason,'修订原因',4000);
        const content = p.normalizeContent(payload);
        if (p.hash(content.context) !== row.context_hash || (payload.concept_key && payload.concept_key !== row.concept_key)) throw p.fail('CONTEXT_CHANGED','修订不能把原概念改到其他语境；请另行提报明确的新概念',422);
        const version = await addVersion(db,row,content,who);
        const next = await saveState(db,{...row,pending_version_id:version.version_id,draft_status:'draft',department_confirmation_json:null,source_check_json:null});
        await event(db,next,who,'draft_revised',reason,{previous_pending_version_id:row.pending_version_id,current_version_unchanged:row.current_version_id},version.version_id);
        return detailFrom(db,session,id,who);
      });
    },
    async action(session,id,payload) {
      return perform(session,'action',asId(id),payload,async (db,base,row,locked) => {
        const who = await auth.forTerm(db,base,row,true), pending = await readVersion(db,row.pending_version_id,true);
        const currentContent = (await readVersion(db,row.current_version_id,true))?.content;
        const action = p.text(payload.action), reason = p.required(payload.reason,'办理原因');
        if (!p.actions(who,row,pending?.content,currentContent).includes(action)) throw p.fail('FORBIDDEN','当前身份、范围或状态不允许该术语操作',403);
        if (action === 'submit') auth.assertContact(who,row);
        if (['source_check','adopt','not_adopt'].includes(action)) {
          if (!pending) throw p.fail('STATE_CONFLICT','待审定义版本不存在');
          await assertConfirmation(db,row,pending,options.inspectCurrentDepartmentDecision);
        }
        if (action === 'source_check' && payload.verified !== true) throw p.fail('SOURCE_CHECK_REQUIRED','须明确确认已核对定义原文及来源依据',422);
        let next = p.transition(row,pending?.content,action,payload), extra = {};
        if (action === 'department_confirm') {
          const appointment = await auth.assertFinal(db,who,row.department_id);
          next.department_confirmation_json = decisionEvidence(appointment,{sourceRevision:pending.version_no,sourceHash:pending.content_hash});
        }
        if (action === 'department_return') { await auth.assertFinal(db,who,row.department_id); next.department_confirmation_json = null; next.source_check_json = null; }
        if (action === 'source_check') next.source_check_json = {version_id:pending.version_id,checked_by_person_id:String(who.personId),content_hash:pending.content_hash,reason};
        if (action === 'source_withdrawn'||action==='source_superseded') {
          const current = await readVersion(db,row.current_version_id,true);
          if (!['gb','gbt'].includes(current?.content.source_kind)) throw p.fail('SOURCE_KIND_INVALID','只有GB或GB/T来源可以登记标准废止',422);
          if (p.date(payload.effective_from,'来源废止') > p.businessDate()) throw p.fail('SOURCE_DATE_INVALID','来源废止日期尚未到达，请按实际废止日期登记',422);
        }
        if (action === 'assign') {
          const assignee = personId(payload.assignee_person_id);
          const account = await one(db,'SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=? FOR SHARE',[assignee]);
          if (!account) throw p.fail('ASSIGNEE_INVALID','分派对象须为有效MDM经办人',422);
          const assigned = await auth.currentActor(db,{personId:assignee,accountId:account.account_id,authVersion:account.auth_version,identityKind:'person'},true);
          if (!assigned.steward) throw p.fail('ASSIGNEE_INVALID','仅可分派给具有有效明确事项办理权限的MDM经办人',422);
          await db.execute('UPDATE tg_assignments SET active=0 WHERE term_id=? AND active=1',[row.term_id]);
          await db.execute('INSERT INTO tg_assignments(assignment_id,term_id,assignee_person_id,assigned_by_person_id,reason) VALUES (?,?,?,?,?)',[uuid(),row.term_id,assignee,String(who.personId),reason]);
          extra = {assignee_person_id:assignee};
        }
        if (action === 'merge') {
          const target = locked.get(payload.target_term_id);
          if (!target || target.term_id === row.term_id || target.merged_into_id) throw p.fail('MERGE_INVALID','请选择另一未合并的有效目标词条',422);
          const sourceProjection = await resolveTerm(db,row.term_id,{row,lock:true}), targetProjection = await resolveTerm(db,target.term_id,{row:target,lock:true});
          const verifiedLegacyContext=sourceProjection.legacy_unverified&&!sourceProjection.context&&payload.confirm_legacy_context===true&&!targetProjection.legacy_unverified&&Boolean(targetProjection.context);
          if (!sourceProjection.usable || !targetProjection.usable || (!verifiedLegacyContext&&(!sourceProjection.context || sourceProjection.context !== targetProjection.context))) throw p.fail('MERGE_CONTEXT_INVALID','须核实为同一语境；历史条目缺少语境时须明确确认核实依据，不能按同名推断',422);
          if (payload.confirm_same_concept !== true) throw p.fail('MERGE_CONFIRM_REQUIRED','须明确确认同义及同一概念，不能按名称自动合并',422);
          const priority={gb:3,gbt:2,custom:1,legacy:0};
          if((priority[sourceProjection.source_kind]||0)>(priority[targetProjection.source_kind]||0))throw p.fail('MERGE_STANDARD_PRIORITY','同一语境规范表述须优先适用GB，其次已采纳GB/T，再到自定义；请选择符合顺序的保留词条',422);
          next.merged_into_id = target.term_id;
          next.adoption_status = 'merged';
          extra = {target_term_id:target.term_id,target_version_id:target.current_version_id,...(verifiedLegacyContext?{verified_legacy_context:targetProjection.context}: {})};
        }
        next = await saveState(db,next);
        const activated = next.current_version_id && next.current_version_id !== row.current_version_id;
        const publicConclusion = ['adopt','not_adopt','suspend','restore','stop_adoption','continue_adoption','source_withdrawn','source_superseded','merge'].includes(action);
        await event(db,next,who,action,reason,{...extra,previous_current_version_id:row.current_version_id,current_version_id:next.current_version_id,
          public_definition:Boolean(activated||action==='not_adopt'),public_conclusion:publicConclusion ? reason : null,
          ...(action === 'suspend' || action === 'restore' ? {suspension:next.suspension_json} : {}),...(payload.effective_from ? {effective_from:payload.effective_from} : {})},activated ? next.current_version_id : row.pending_version_id || row.current_version_id);
        return detailFrom(db,session,id,who);
      });
    },
    async listChallenges(session,id) {
      await assertReady(pool,env);
      const row = await readTerm(pool,id);
      if (!row) throw p.fail('NOT_FOUND','术语不存在或不在当前可读范围',404);
      const who = await auth.forTerm(pool,await auth.currentActor(pool,session),row);
      return challengeList(pool,who,row);
    },
    async createChallenge(session,id,payload) {
      return perform(session,'challenge_create',asId(id),payload,async (db,who,row) => {
        if (!who.personId || who.readOnly) throw p.fail('FORBIDDEN','须由有效人员本人提出质疑',403);
        const current = await readVersion(db,row.current_version_id,true);
        if (!current || current.content.source_kind !== 'custom' || row.adoption_status !== 'adopted') throw p.fail('CHALLENGE_KIND_INVALID','此入口用于对公司已采用的自定义术语提出质疑',422);
        const challengeId = uuid(), reason = p.required(payload.reason,'质疑依据');
        await db.execute('INSERT INTO tg_challenges(challenge_id,term_id,version_id,raised_by_person_id,reason) VALUES (?,?,?,?,?)',[challengeId,row.term_id,current.version_id,String(who.personId),reason]);
        const next = await saveState(db,row);
        await event(db,next,who,'challenge_raised',reason,{challenge_id:challengeId},current.version_id);
        return {term_id:row.term_id,revision_no:next.revision_no,challenge_id:challengeId,revision:1};
      });
    },
    async challengeAction(session,id,challengeId,payload) {
      return perform(session,'challenge_action',asId(id),{...payload,challenge_id:asId(challengeId)},async (db,base,row) => {
        const who = await auth.forTerm(db,base,row,true);
        const challenge = parseChallenge(await one(db,'SELECT * FROM tg_challenges WHERE challenge_id=? AND term_id=? FOR UPDATE',[challengeId,row.term_id]));
        if (!challenge || !canReadChallenge(who,row,challenge)) throw p.fail('NOT_FOUND','质疑事项不存在或不在当前范围',404);
        if (payload.expected_challenge_revision !== challenge.revision_no) throw p.fail('CHALLENGE_REVISION_CONFLICT','质疑事项已变化，请保留输入后核对');
        const action = p.text(payload.action), reason = p.required(payload.reason,'办理依据');
        const available = await challengeActions(db,who,challenge);
        if (!available.includes(action)) throw p.fail('FORBIDDEN','当前身份、部门或质疑状态不允许该操作',403);
        let next = {...challenge};
        if (action === 'coordinate') {
          if (payload.finalize === true) {
            if(!who.lead)throw p.fail('FORBIDDEN','一致意见须由MDM组长按部门已确认结论作最终确认；经办人负责协调与记录',403);
            const opinions = await latestOpinions(db,challenge);
            if (!challenge.affected_department_ids.length || !challenge.affected_department_ids.every(department => opinions.some(op => same(op.department_id,department))) || new Set(opinions.map(op => op.conclusion_key)).size !== 1) throw p.fail('OPINIONS_NOT_AGREED','须取得全部受影响部门负责人一致结论；不一致时由受影响部门负责人升级');
            for (const op of opinions) {
              const evidence = parse(op.authority_json);
              const checked = await (options.inspectCurrentDepartmentDecision || inspectCurrentDepartmentDecision)(db,op.department_id,evidence,{sourceRevision:1,sourceHash:challengeBinding(challenge),lock:true});
              if (!checked.valid) throw p.fail('DEPARTMENT_RECONFIRM_REQUIRED','受影响部门负责人登记或授权已变化，请重新取得意见');
            }
            next.status = 'decided'; next.conclusion = {conclusion_key:opinions[0].conclusion_key,reason,mode:'department_agreement'};
          } else {
            const departments = [...new Set((payload.affected_department_ids || []).map(personId))].sort();
            if (!departments.length) throw p.fail('DEPARTMENTS_REQUIRED','请明确受影响部门，不自动从词语推断',422);
            for (const department of departments) {
              const found = await one(db,'SELECT id FROM departments WHERE id=? AND status=\'active\' FOR SHARE',[department]);
              if (!found) throw p.fail('DEPARTMENT_INVALID','受影响部门不存在或已停用',422);
            }
            next.status = 'coordinating';next.affected_department_ids = departments;next.coordination = {reason,by_person_id:String(who.personId),round_id:uuid()};
          }
        }
        if (action === 'department_opinion') {
          const appointment = await auth.assertFinal(db,who,who.departmentId);
          const conclusion = p.required(payload.conclusion_key,'部门意见结论',255);
          const evidence = decisionEvidence(appointment,{sourceRevision:1,sourceHash:challengeBinding(challenge)});
          await db.execute(`INSERT INTO tg_challenge_opinions(opinion_id,challenge_id,department_id,actor_person_id,opinion_revision,conclusion_key,reason,authority_json) VALUES (?,?,?,?,?,?,?,?)`,
            [uuid(),challengeId,String(who.departmentId),String(who.personId),challenge.revision_no+1,conclusion,reason,JSON.stringify(evidence)]);
        }
        if (action === 'escalate') { await auth.assertFinal(db,who,who.departmentId); next.status = 'escalated'; }
        if (action === 'decide') { next.status = 'decided'; next.conclusion = {conclusion_key:p.required(payload.conclusion_key,'项目决策结论',255),reason,mode:'decision_group',by_person_id:String(who.personId)}; }
        if (action === 'feedback') { next.status = 'feedback_sent';next.feedback = {reason,to_person_id:String(challenge.raised_by_person_id),by_person_id:String(who.personId)}; }
        if (action === 'close') next.status = 'closed';
        if (action === 'reopen') { next.status = 'open';next.conclusion = null;next.feedback = null;next.coordination = null;next.affected_department_ids = []; }
        await db.execute(`UPDATE tg_challenges SET status=?,affected_departments_json=?,coordination_json=?,conclusion_json=?,feedback_json=?,revision_no=revision_no+1 WHERE challenge_id=?`,
          [next.status,JSON.stringify(next.affected_department_ids),JSON.stringify(next.coordination),JSON.stringify(next.conclusion),JSON.stringify(next.feedback),challengeId]);
        const updatedTerm = await saveState(db,row);
        await event(db,updatedTerm,who,'challenge_' + action,reason,{challenge_id:challengeId,status:next.status,conclusion:next.conclusion,feedback:next.feedback,
          ...(action==='close'?{public_conclusion:{challenge_id:challengeId,...next.conclusion,closure_reason:reason}}:{})},challenge.version_id);
        return {term_id:row.term_id,revision_no:updatedTerm.revision_no,challenge_id:challengeId,challenge_revision:challenge.revision_no+1,status:next.status};
      });
    }
  };
  function parseChallenge(row) {
    if (!row) return null;
    return {...row,revision_no:Number(row.revision_no),affected_department_ids:parse(row.affected_departments_json,[]),coordination:parse(row.coordination_json),conclusion:parse(row.conclusion_json),feedback:parse(row.feedback_json)};
  }
  function canReadChallenge(who,row,c) {
    return auth.canReadProcess(who,row) || same(who.personId,c.raised_by_person_id) || c.affected_department_ids.some(department => same(who.departmentId,department)) ||
      (who.decider && (c.status === 'escalated' || c.conclusion?.mode === 'decision_group'));
  }
  async function challengeActions(db,who,c) {
    if (who.readOnly) return [];
    const result = [];
    if (who.operator && ['open','coordinating'].includes(c.status)) result.push('coordinate');
    if (c.affected_department_ids.some(department => same(who.departmentId,department)) && c.status === 'coordinating') {
      const final = options.inspectDepartmentAccountability ? await options.inspectDepartmentAccountability(db,who,who.departmentId) : await require('./departmentAccountability').inspectDepartmentAccountability(db,who,who.departmentId);
      if (final.eligible) result.push('department_opinion','escalate');
    }
    if (who.decider && c.status === 'escalated') result.push('decide');
    if (who.operator && c.status === 'decided') result.push('feedback');
    if ((who.operator||same(who.personId,c.raised_by_person_id)) && c.status === 'feedback_sent') result.push('close');
    if (same(who.personId,c.raised_by_person_id) && ['closed','feedback_sent'].includes(c.status)) result.push('reopen');
    return result;
  }
  async function latestOpinions(db,c) {
    const [opinions] = await db.execute('SELECT * FROM tg_challenge_opinions WHERE challenge_id=? ORDER BY opinion_revision',[c.challenge_id]);
    const result = new Map();
    for (const op of opinions) if (c.affected_department_ids.some(department => same(department,op.department_id)) && parse(op.authority_json)?.source_hash === challengeBinding(c)) result.set(String(op.department_id),op);
    return [...result.values()];
  }
  function challengeBinding(c) { return p.hash({challenge_id:c.challenge_id,departments:c.affected_department_ids,round_id:c.coordination?.round_id || null}); }
  async function challengeList(db,who,row) {
    const [rows] = await db.execute('SELECT * FROM tg_challenges WHERE term_id=? ORDER BY created_at,challenge_id',[row.term_id]);
    const items = [];
    for (const raw of rows) {
      const c = parseChallenge(raw);
      if (!canReadChallenge(who,row,c)) continue;
      items.push({...c,opinions:await latestOpinions(db,c),can_finalize_coordination:Boolean(who.lead),allowed_actions:await challengeActions(db,who,c)});
    }
    return {items,term_id:row.term_id,revision_no:row.revision_no};
  }
  return repo;
}
let factory = null, cached = null;
async function getTerminologyGovernanceRepository() {
  if (factory) return factory();
  if (!p.enabled()) return makeTerminologyGovernanceRepository(null);
  if (!cached) cached = makeTerminologyGovernanceRepository(require('./mysqlPoolRegistry').createRegisteredPool(process.env,'terminologyGovernance'));
  return cached;
}
function setTerminologyGovernanceRepositoryFactory(value) { factory = value;cached = null; }
function resetTerminologyGovernanceRepositoryFactory() {factory = null;cached = null;}
module.exports = { makeTerminologyGovernanceRepository,getTerminologyGovernanceRepository,setTerminologyGovernanceRepositoryFactory,resetTerminologyGovernanceRepositoryFactory,resolveTerm,assertReady,readTerm,readVersion };
