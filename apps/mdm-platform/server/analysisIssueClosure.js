// P17 contract §27: per-issue authority, immutable decisions, no automatic dispatch.
const { id, digest, json, parse, failure, rows, lastId } = require('./dataMapDefinitionValues');
const { makeIdentityMysqlRepository } = require('./identityMysqlRepository');
const { MIGRATION_KEY } = require('./analysisClosureSchema');
const fail = (code, status = 409) => failure('DEFINITION_ANALYSIS_CLOSURE_' + code, status);
const text = (v, max = 4000) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw fail('TEXT_REQUIRED',400); return v.trim(); };
module.exports = h => {
  const { tx, actor, request, issue, linkedFindings } = h;
  const resolve=require('./analysisInputReferences')(h.helpers);
  async function sourceHeads(db,who,links) {
    const collected=new Map();
    async function visit(kind,ref) {
      const key=kind+':'+ref;if(collected.has(key))return;
      let current=String(ref),headRevision=null;
      if(kind==='definition') {
        const [[v]]=await db.execute('SELECT CAST(h.current_version_id AS CHAR) ref,h.revision_no FROM data_map_definition_versions v JOIN data_map_definition_heads h ON h.entity_type=v.entity_type AND h.entity_id=v.entity_id WHERE v.version_id=? FOR SHARE',[ref]);
        if(!v)throw fail('SOURCE_CHANGED');current=v.ref;headRevision=v.revision_no;
      } else if(kind==='mapping'||kind==='handoff') {
        const prefix=kind==='mapping'?'data_map_v7_mapping':'data_map_design_handoff';
        const [[v]]=await db.execute(`SELECT CAST(n.${kind}_version_id AS CHAR) ref,h.revision_no FROM ${prefix}_versions v JOIN ${prefix}s h ON h.${kind}_id=v.${kind}_id LEFT JOIN ${prefix}_versions n ON n.${kind}_id=h.${kind}_id AND n.revision_no=h.revision_no WHERE v.${kind}_version_id=? FOR SHARE`,[ref]);
        if(!v?.ref)throw fail('SOURCE_CHANGED');current=v.ref;headRevision=v.revision_no;
      }
      const value=await resolve(db,who,kind,current);
      collected.set(key,{kind,original_ref:String(ref),current_ref:current,head_revision:headRevision,snapshot:value.snapshot,...(current!==String(ref)?{changed_document:value.document}:{})});
      if(kind==='mapping'){await visit('definition',value.snapshot.object_version_id);if(value.snapshot.field_version_id)await visit('definition',value.snapshot.field_version_id);}
      if(kind==='handoff')for(const r of value.snapshot.mapping_refs)await visit('mapping',r.mapping_version_id);
      if(['excel_material','word_material','pdf_material'].includes(value.snapshot.source_kind))for(const r of value.document.links)await visit(r.kind,r.ref_id);
    }
    for(const l of links)for(const input of l.reviews.at(-1).fixed_inputs)await visit(input.snapshot.kind,input.snapshot.ref_id);
    return [...collected.values()].sort((a,b)=>(a.kind+':'+a.original_ref).localeCompare(b.kind+':'+b.original_ref));
  }
  async function ready(db) {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[MIGRATION_KEY]))[0].length) throw fail('MIGRATION_REQUIRED',503);
  }
  async function history(db, issueId) {
    const [events] = await db.execute(`SELECT CAST(event_id AS CHAR) event_id,revision_no,action,snapshot_json,snapshot_digest,
      DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_analysis_issue_closure_events WHERE issue_id=? ORDER BY revision_no FOR UPDATE`,[issueId]);
    let previous=null;
    const out=events.map(e => { const s=parse(e.snapshot_json); if(digest(s)!==e.snapshot_digest || s.previous_event_digest!==previous || s.revision_no!==e.revision_no || s.action!==e.action || s.issue_id!==issueId) throw fail('INTEGRITY_CONFLICT'); previous=e.snapshot_digest;return {...s,event_id:e.event_id,event_digest:e.snapshot_digest,created_at:e.created_at}; });
    const [[head]]=await db.execute('SELECT CAST(event_id AS CHAR) event_id,event_digest FROM data_map_analysis_issue_closure_heads WHERE issue_id=? FOR UPDATE',[issueId]);
    if(head?head.event_id!==out.at(-1)?.event_id||head.event_digest!==previous:out.length>0)throw fail('INTEGRITY_CONFLICT');
    return out;
  }
  async function tasks(db, issueId) {
    const [items] = await db.execute(`SELECT CAST(l.todo_id AS CHAR) todo_id,l.purpose,t.status,CAST(a.assignee_person_id AS CHAR) assignee_person_id,a.revision_no
      FROM data_map_analysis_issue_tasks l JOIN mdm_todos t ON t.id=l.todo_id JOIN mdm_todo_office_assignments a ON a.todo_id=l.todo_id WHERE l.issue_id=? ORDER BY l.todo_id FOR UPDATE`,[issueId]);
    for (const t of items) {
      const [events]=await db.execute(`SELECT CAST(id AS CHAR) event_id,event_type,CAST(actor_person_id AS CHAR) actor_person_id,note,
        DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM mdm_todo_events WHERE todo_id=? ORDER BY id FOR SHARE`,[t.todo_id]);
      t.events=events.map(e=>({...e,note:e.note?parse(e.note):null}));
      t.completion=t.events.filter(e=>e.event_type==='office_task_completed').at(-1)||null;
    }
    return items;
  }
  function participated(items, personId) {
    return items.some(t=>t.purpose!=='review' && (t.assignee_person_id===personId || t.events.some(e=>
      (e.event_type==='office_task_completed' && e.actor_person_id===personId) ||
      (e.event_type==='office_person_assigned' && [e.note?.from_person_id,e.note?.to_person_id].some(v=>v!=null&&String(v)===personId)))));
  }
  async function candidate(db, personId, issueId, items, links) {
    const [[a]]=await db.execute(`SELECT CAST(account_id AS CHAR) account_id,CAST(auth_version AS CHAR) auth_version FROM user_accounts WHERE person_id=?`,[personId]);
    if(!a) return null;
    const session={personId,accountId:a.account_id,authVersion:a.auth_version};
    try {
      // A candidate is not the acting session. Do not acquire another person's write locks:
      // the actual reviewer is locked/revalidated by actor() before every decision.
      const identity=makeIdentityMysqlRepository(db),validation=await identity.validateSession(session);
      if(!validation.valid||validation.user.must_change_password)return null;
      const roles=await identity.getUserRoleCodes(personId),{permSet}=await identity.getUserEffectivePermissions(personId);
      const [[person]]=await db.execute('SELECT CAST(current_department_id AS CHAR) department_id FROM person WHERE person_id=?',[personId]);
      const who={personId,departmentId:person.department_id,permissions:permSet,readOnly:roles.some(r=>r.code==='admin')};
      if(who.readOnly || !roles.some(r=>['mdm_lead','data_quality_auditor'].includes(r.code)) || participated(items,personId)) return null;
      const [[binding]]=await db.execute('SELECT CAST(owner_department_id AS CHAR) department_id FROM data_map_analysis_issue_bindings WHERE issue_id=?',[issueId]);
      h.helpers.scope(who,binding.department_id);
      for(const l of links){
        const [[run]]=await db.execute('SELECT CAST(scope_department_id AS CHAR) department_id FROM data_map_analysis_runs WHERE run_id=?',[l.run_id]);h.helpers.scope(who,run.department_id);
        for(const input of l.reviews.at(-1).fixed_inputs)await resolve(db,who,input.snapshot.kind,input.snapshot.ref_id);
      }
      await sourceHeads(db,who,links);
      // Account generation changes on supported revoke/restore paths. Never reuse an old appointment after restoration.
      const [grants]=await db.execute('SELECT CAST(person_role_id AS CHAR) person_role_id,CAST(role_id AS CHAR) role_id,scope_type,CAST(scope_department_id AS CHAR) scope_department_id,assignment_status,CAST(effective_from AS CHAR) effective_from,CAST(effective_to AS CHAR) effective_to,CAST(revoked_at AS CHAR) revoked_at FROM person_roles WHERE person_id=? ORDER BY person_role_id',[personId]);
      return {person_id:personId,authorization_digest:digest({account:a,department:who.departmentId,grants,permissions:[...who.permissions].sort()})};
    } catch(e) { if([401,403,404].includes(e.statusCode)) return null; throw e; }
  }
  async function append(db,c,who,action,value) {
    const revision=c.result.binding.revision_no+1;
    const snapshot={issue_id:c.issueId,revision_no:revision,action,actor_person_id:who.personId,previous_event_digest:c.events.at(-1)?.event_digest||null,...value};
    await db.execute('INSERT INTO data_map_analysis_issue_closure_events(issue_id,revision_no,action,actor_person_id,snapshot_json,snapshot_digest,created_at) VALUES (?,?,?,?,?,?,UTC_TIMESTAMP(3))',[c.issueId,revision,action,who.personId,json(snapshot),digest(snapshot)]);
    const eventId=await lastId(db);
    await db.execute('INSERT INTO data_map_analysis_issue_closure_heads(issue_id,event_id,event_digest) VALUES (?,?,?) ON DUPLICATE KEY UPDATE event_id=VALUES(event_id),event_digest=VALUES(event_digest)',[c.issueId,eventId,digest(snapshot)]);
    const current=(await rows(db,'process_governance_issues','issue_id=?',[c.issueId],true))[0];
    const hash=digest(current);
    await db.execute('UPDATE data_map_analysis_issue_bindings SET revision_no=?,issue_digest=? WHERE issue_id=?',[revision,hash,c.issueId]);
    await db.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,?,?)",[c.issueId,who.personId,{designate:'负责人确认复核人员和关闭条件',reject:'复核不通过，继续处理',close:'逐项复核通过并关闭',reopen:'负责人依据新证据重新打开',suspend:'复核资格失效，须重新指定'}[action],json(snapshot)]);
    c.result.binding.revision_no=revision;c.result.binding.issue_digest=hash;
    return {issue_id:c.issueId,revision_no:revision,issue_digest:hash,action};
  }
  async function context(db,session,issueId) {
    await ready(db);
    await db.execute('SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE',[id(issueId)]);
    const who=await actor(db,session), result=await issue(db,who,id(issueId));
    if(!result.binding) throw fail('ISSUE_UNLINKED');
    const links=await linkedFindings(db,session,id(issueId)), items=await tasks(db,id(issueId)), events=await history(db,id(issueId));
    const source_heads=await sourceHeads(db,who,links);
    const [[dept]]=await db.execute("SELECT CAST(final_responsible_person_id AS CHAR) owner FROM departments WHERE id=? AND status='active' FOR SHARE",[result.binding.owner_department_id]);
    const assignment=events.filter(e=>['designate','reopen'].includes(e.action)).at(-1)||null;
    let suspended=!!assignment && events.some(e=>e.action==='suspend'&&e.revision_no>assignment.revision_no);
    const c={who,result,issueId:id(issueId),links,items,events,assignment,suspended,source_heads,isOwner:!who.readOnly&&dept?.owner===who.personId};
    if(assignment&&!suspended) {
      const valid=await candidate(db,assignment.reviewer.person_id,c.issueId,items,links);
      if(!valid||valid.authorization_digest!==assignment.reviewer.authorization_digest) {
        await append(db,c,who,'suspend',{assignment_revision:assignment.revision_no,reason:'身份、候选资格、办理参与或来源权限变化，原指定不自动恢复'});
        c.events=await history(db,c.issueId);c.suspended=true;
      }
    }
    return c;
  }
  const fixed = c => ({issue_digest:c.result.binding.issue_digest,issue_revision:c.result.binding.revision_no,
    sources:c.links.map(l=>({run_id:l.run_id,finding_id:l.finding_id,review:l.reviews.at(-1)})),tasks:c.items,
    source_heads:c.source_heads,assignment_revision:c.assignment?.revision_no||null,conditions:c.assignment?.conditions||[]});
  async function execute(session, issueId, payload) {
    const result=await tx(async db=>{
      const c=await context(db,session,issueId), {who}=c;
      // Return denial after committing a detected suspension, instead of rolling it back with the rejected action.
      if(who.readOnly || !payload || (!c.isOwner && (c.suspended || c.assignment?.reviewer.person_id!==who.personId))) return {denied:true};
      const allowed=['request_id','action','expected_revision','expected_issue_digest','expected_context_digest','reviewer_person_id','conditions','reason','checks','reopen_evidence'];
      if(typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!allowed.includes(k))) throw fail('PROPERTY_INVALID',400);
      if(!['designate','review','reopen'].includes(payload.action)) throw fail('ACTION_INVALID',400);
      if(payload.action!=='review'&&!c.isOwner) return {denied:true};
      if(payload.action==='review'&&(c.suspended||!c.assignment||c.assignment.reviewer.person_id!==who.personId)) return {denied:true};
      return request(db,who,'analysis_issue_closure',{...payload,issue_id:c.issueId},async()=>{
        if(payload.expected_revision!==c.result.binding.revision_no || payload.expected_issue_digest!==c.result.binding.issue_digest || payload.expected_context_digest!==digest(fixed(c))) throw fail('REVISION_CONFLICT');
        const closed=['closed','completed','not_in_scope'].includes(c.result.value.display_status);
        const reason=text(payload.reason);
        if(payload.action==='reopen'?!closed:closed) throw fail('STATE_CONFLICT');
        if(payload.action==='designate'||payload.action==='reopen') {
          const reviewer=await candidate(db,id(payload.reviewer_person_id),c.issueId,c.items,c.links);
          if(!reviewer) throw fail('REVIEWER_INELIGIBLE',403);
          if(!Array.isArray(payload.conditions)||!payload.conditions.length||payload.conditions.length>32) throw fail('CONDITIONS_REQUIRED',400);
          const conditions=payload.conditions.map((s,i)=>({condition_id:'condition-'+(i+1),text:text(s,1000)}));
          if(new Set(conditions.map(c=>c.text)).size!==conditions.length) throw fail('CONDITIONS_DUPLICATED',400);
          const reopenEvidence=payload.action==='reopen'?text(payload.reopen_evidence):null;
          if(payload.action==='reopen') await db.execute("UPDATE process_governance_issues SET display_status='waiting_my_action',closed_at=NULL WHERE issue_id=?",[c.issueId]);
          return append(db,c,who,payload.action,{reviewer,conditions,reason,reopen_evidence:reopenEvidence,context:fixed(c)});
        }
        if(!Array.isArray(payload.checks)||payload.checks.length!==c.assignment.conditions.length) throw fail('CHECKS_REQUIRED',400);
        const checks=c.assignment.conditions.map(condition=>{
          const match=payload.checks.filter(x=>x&&x.condition_id===condition.condition_id);
          if(match.length!==1||typeof match[0].satisfied!=='boolean') throw fail('CHECKS_INVALID',400);
          const x=match[0]; if(Object.keys(x).some(k=>!['condition_id','satisfied','basis','todo_id','task_revision','excerpt'].includes(k))) throw fail('CHECKS_INVALID',400);
          const basis=text(x.basis);
          if(!x.satisfied) return {condition_id:condition.condition_id,satisfied:false,basis};
          const task=c.items.find(t=>t.todo_id===id(x.todo_id));
          const excerpt=text(x.excerpt);
          if(!task||task.status!=='done'||task.revision_no!==x.task_revision||!task.completion?.note?.note?.includes(excerpt)) throw fail('EVIDENCE_CHANGED');
          return {condition_id:condition.condition_id,satisfied:true,basis,todo_id:task.todo_id,task_revision:task.revision_no,completion_event_id:task.completion.event_id,excerpt};
        });
        const pass=checks.every(x=>x.satisfied);
        if(pass&&c.items.some(t=>t.purpose!=='review'&&t.status!=='done')) throw fail('ACTIONS_PENDING');
        if(pass) await db.execute("UPDATE process_governance_issues SET display_status='closed',closed_at=UTC_TIMESTAMP() WHERE issue_id=?",[c.issueId]);
        return append(db,c,who,pass?'close':'reject',{assignment_revision:c.assignment.revision_no,reason,checks,context:fixed(c)});
      });
    });
    if(result.denied) throw fail('ACCESS_DENIED',403);return result;
  }
  return {
    reviewAnalysisIssueTask:execute,
    getAnalysisIssueClosure(session,issueId) { return tx(async db=>{
      const c=await context(db,session,issueId), candidates=[];
      if(c.isOwner) {
        const [people]=await db.execute(`SELECT DISTINCT CAST(pr.person_id AS CHAR) person_id,p.person_name FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id JOIN person p ON p.person_id=pr.person_id
          WHERE r.role_code IN ('mdm_lead','data_quality_auditor') ORDER BY person_id`);
        for(const p of people) {const value=await candidate(db,p.person_id,c.issueId,c.items,c.links);if(value)candidates.push({person_id:p.person_id,person_name:p.person_name});}
      }
      const closed=['closed','completed','not_in_scope'].includes(c.result.value.display_status);
      return {issue_id:c.issueId,status:c.result.value.display_status,revision_no:c.result.binding.revision_no,issue_digest:c.result.binding.issue_digest,
        context_digest:digest(fixed(c)),source_heads:c.source_heads,assignment:c.assignment,suspended:c.suspended,events:c.events,tasks:c.items,candidates,
        can_designate:c.isOwner&&!closed,can_reopen:c.isOwner&&closed,can_review:!c.who.readOnly&&!closed&&!c.suspended&&c.assignment?.reviewer.person_id===c.who.personId};
    }); }
  };
};
