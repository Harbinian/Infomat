// Human decisions overlay immutable rule output. Never invoke the legacy generator.
const { failure, id, json, parse, digest, lastId, rows } = require('./dataMapDefinitionValues');
const { MIGRATION_KEY } = require('./analysisIssueSchema');
const fail = (s, status = 400) => failure('DEFINITION_ANALYSIS_ISSUE_' + s, status);
const text = (v, max) => { if (typeof v !== 'string' || !v.trim() || v.length > max) throw fail('TEXT_REQUIRED'); return v.trim(); };
const keys = (v, allowed) => { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !allowed.includes(k))) throw fail('PROPERTY_INVALID'); };
module.exports = function (helpers) {
  const { transaction, actor, scope, request } = helpers;
  const runs = db => require('./analysisRuns')({ ...helpers, transaction: fn => fn(db) });
  const tx = fn => transaction(async db => {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length) throw fail('MIGRATION_REQUIRED', 503);
    return fn(db);
  });
  async function finding(db, session, runId, findingId, writing = false) {
    const run = await runs(db).getAnalysisRun(session, id(runId));
    const attempt = run.attempts.find(a => a.findings.some(f => f.finding_id === id(findingId)));
    if (!attempt) throw fail('FINDING_NOT_FOUND', 404);
    const found = attempt.findings.find(f => f.finding_id === id(findingId));
    if (writing && (!['succeeded','partial'].includes(run.status) || !['succeeded','partial'].includes(attempt.status) || run.steps.find(s => s.step_key === attempt.step_key).attempt_no !== attempt.attempt_no)) throw fail('ATTEMPT_NOT_CURRENT', 409);
    await db.execute('SELECT finding_id FROM data_map_analysis_findings WHERE finding_id=? FOR UPDATE', [found.finding_id]);
    return { run, attempt, found };
  }
  async function history(db, findingId) {
    const [records] = await db.execute(`SELECT *,CAST(review_id AS CHAR) review_id,CAST(issue_id AS CHAR) issue_id,CAST(actor_person_id AS CHAR) actor_person_id,
      DATE_FORMAT(created_at,'%Y-%m-%dT%H:%i:%s.%fZ') created_at FROM data_map_analysis_finding_reviews WHERE finding_id=? ORDER BY revision_no FOR SHARE`, [findingId]);
    return records.map((r, i) => {
      const s = parse(r.snapshot_json);
      if (r.revision_no !== i + 2 || digest(s) !== r.snapshot_digest || s.finding_id !== findingId || s.decision !== r.decision || s.issue_id !== r.issue_id || s.actor_person_id !== r.actor_person_id || s.revision_no !== r.revision_no) throw fail('INTEGRITY_CONFLICT', 409);
      return { review_id: r.review_id, created_at: r.created_at, ...s };
    });
  }
  async function department(db, who, departmentId) {
    if (departmentId == null || departmentId === '') throw fail('OWNER_UNRESOLVED', 409);
    const deptId = id(departmentId); scope(who, deptId);
    const [[dept]] = await db.execute("SELECT CAST(id AS CHAR) id,name FROM departments WHERE id=? AND status='active' FOR SHARE", [deptId]);
    if (!dept) throw fail('OWNER_UNRESOLVED', 409);
    return dept;
  }
  async function currentInputs(db, run) {
    // Fixed snapshots stay readable, but an explicit decision cannot silently use superseded ledger/mapping revisions.
    async function current(kind, ref) {
      let ok;
      if (kind === 'definition') ok = (await db.execute('SELECT entity_id FROM data_map_definition_heads WHERE current_version_id=? FOR SHARE', [ref]))[0].length;
      if (kind === 'mapping') {
        const [[m]] = await db.execute('SELECT CAST(object_version_id AS CHAR) object_version_id,CAST(field_version_id AS CHAR) field_version_id,CAST(mapping_id AS CHAR) mapping_id,revision_no FROM data_map_v7_mapping_versions WHERE mapping_version_id=? FOR SHARE', [ref]);
        const [[latest]] = await db.execute('SELECT revision_no FROM data_map_v7_mappings WHERE mapping_id=? FOR SHARE', [m.mapping_id]);
        ok = latest.revision_no === m.revision_no; await current('definition', m.object_version_id); if (m.field_version_id) await current('definition', m.field_version_id);
      }
      if (kind === 'handoff') {
        const [[h]] = await db.execute('SELECT CAST(handoff_id AS CHAR) handoff_id,revision_no FROM data_map_design_handoff_versions WHERE handoff_version_id=? FOR SHARE', [ref]);
        const [[latest]] = await db.execute('SELECT revision_no FROM data_map_design_handoffs WHERE handoff_id=? FOR SHARE', [h.handoff_id]);
        ok = latest.revision_no === h.revision_no;
        const [refs] = await db.execute('SELECT CAST(mapping_version_id AS CHAR) ref FROM data_map_design_handoff_refs WHERE handoff_version_id=? FOR SHARE', [ref]);
        for (const r of refs) await current('mapping', r.ref);
      }
      if (kind === 'template') {
        const [[s]]=await db.execute('SELECT parser_version FROM data_map_source_files WHERE batch_id=?',[ref]);
        if(s?.parser_version===require('./excelEvidenceParser').VERSION){
          const [[r]]=await db.execute('SELECT snapshot_json FROM data_map_excel_evidence WHERE batch_id=?',[ref]);
          for(const link of parse(r.snapshot_json).document.links)await current(link.kind,link.ref_id);
        }
        if(s?.parser_version===require('./wordEvidenceParser').VERSION){
          const [[r]]=await db.execute('SELECT snapshot_json FROM data_map_word_evidence WHERE batch_id=?',[ref]);
          for(const link of parse(r.snapshot_json).document.links)await current(link.kind,link.ref_id);
        }
        if(s?.parser_version===require('./pdfEvidenceParser').VERSION){
          const [[r]]=await db.execute('SELECT snapshot_json FROM data_map_pdf_evidence WHERE batch_id=?',[ref]);
          for(const link of parse(r.snapshot_json).document.links)await current(link.kind,link.ref_id);
        }
      }
      if (ok === 0 || ok === false) throw fail('SOURCE_SUPERSEDED', 409);
    }
    for (const i of run.manifest.inputs) await current(i.snapshot.kind, i.snapshot.ref_id);
  }
  async function issue(db, who, issueId) {
    const value = (await rows(db, 'process_governance_issues', 'issue_id=?', [id(issueId)], true))[0];
    if (!value) throw fail('NOT_FOUND', 404);
    const [[binding]] = await db.execute('SELECT *,CAST(issue_id AS CHAR) issue_id,CAST(owner_department_id AS CHAR) owner_department_id FROM data_map_analysis_issue_bindings WHERE issue_id=? FOR UPDATE', [value.issue_id]);
    if (binding) {
      scope(who, binding.owner_department_id);
      if (binding.issue_digest !== digest(value)) throw fail('LEGACY_CHANGED', 409);
    } else if (!who.permissions.has('governance:read-global')) {
      const dept = await department(db, who, who.departmentId);
      if (![value.primary_dept_name,value.owner_dept_name].includes(dept.name)) throw fail('NOT_FOUND', 404);
    }
    return { value, binding };
  }
  async function linkedFindings(db, session, issueId) {
    const [links] = await db.execute(`SELECT CAST(r.finding_id AS CHAR) finding_id,CAST(f.run_id AS CHAR) run_id FROM data_map_analysis_finding_reviews r
      JOIN data_map_analysis_findings f ON f.finding_id=r.finding_id WHERE r.issue_id=? ORDER BY f.run_id,r.finding_id`, [issueId]);
    const out = [];
    for (const l of links) {
      const f = await finding(db, session, l.run_id, l.finding_id);
      out.push({ ...l, message: f.found.message, reviews: await history(db, l.finding_id) });
    }
    return out;
  }
  return {
    ...require('./analysisIssueTasks')({ tx, actor, request, issue, linkedFindings, currentInputs, runs }),
    ...require('./analysisIssueClosure')({ tx, actor, request, issue, linkedFindings, helpers }),
    analysisIssueTargets(session, after = null) { return tx(async db => {
      const who = await actor(db, session, 'governance:structure-gate');
      const [items] = await db.execute(`SELECT CAST(id AS CHAR) id,name FROM departments WHERE status='active' ${who.permissions.has('governance:read-global') ? '' : 'AND id=?'} ${after ? 'AND id>?' : ''} ORDER BY id LIMIT 101`, [...(who.permissions.has('governance:read-global') ? [] : [who.departmentId]), ...(after ? [id(after)] : [])]);
      return { items: items.slice(0,100), next: items.length > 100 ? items[99].id : null };
    }); },
    async getFindingReview(session, runId, findingId) { for(let attempt=0;attempt<3;attempt++) { const value=await tx(async db => {
      // A linked finding shares the issue-first lock order used by closure and task decisions.
      const [[linked]]=await db.execute('SELECT CAST(issue_id AS CHAR) issue_id FROM data_map_analysis_finding_reviews WHERE finding_id=? AND issue_id IS NOT NULL ORDER BY revision_no DESC LIMIT 1',[id(findingId)]);
      if(linked)await db.execute('SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE',[linked.issue_id]);
      const who = await actor(db, session), f = await finding(db, session, runId, findingId), events = await history(db, f.found.finding_id);
      const state = events.at(-1) || { decision: 'pending_verification', revision_no: 1, issue_id: null };
      // A concurrent first link may commit while actor() waits. Release this read transaction
      // and restart issue-first; never hold an empty review-index gap while waiting for identity.
      if(state.issue_id && state.issue_id!==linked?.issue_id)return {retry_linked_read:true};
      if (state.issue_id) { await issue(db, who, state.issue_id); await linkedFindings(db, session, state.issue_id); }
      return { finding_id: f.found.finding_id, state, events, can_confirm: !who.readOnly && who.permissions.has('governance:structure-gate'), close_enabled: false };
    }); if(!value.retry_linked_read)return value; } throw fail('REVISION_CONFLICT',409); },
    getAnalysisIssue(session, issueId) { return tx(async db => {
      await db.execute('SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE',[id(issueId)]);
      const who = await actor(db, session), result = await issue(db, who, issueId), links = await linkedFindings(db, session, result.value.issue_id);
      return { issue: result.value, revision_no: result.binding?.revision_no || 1, issue_digest: digest(result.value), links, close_enabled: false };
    }); },
    decideAnalysisFinding(session, payload) { return tx(async db => {
      keys(payload, ['request_id','run_id','finding_id','expected_revision','action','reason','owner_department_id','owner_basis','evidence_ids','issue_id','expected_issue_revision','expected_issue_digest','title']);
      if(payload.action==='link')await db.execute('SELECT issue_id FROM process_governance_issues WHERE issue_id=? FOR UPDATE',[id(payload.issue_id)]);
      const who = await actor(db, session, 'governance:structure-gate');
      const f = await finding(db, session, payload.run_id, payload.finding_id, true);
      const events = await history(db, f.found.finding_id), state = events.at(-1) || { decision: 'pending_verification', revision_no: 1, issue_id: null };
      if (!['confirm','not_an_issue','create','link'].includes(payload.action)) throw fail('ACTION_INVALID');
      const dept = await department(db, who, payload.owner_department_id), reason = text(payload.reason, 4096), ownerBasis = text(payload.owner_basis, 4096);
      if (!Array.isArray(payload.evidence_ids) || !payload.evidence_ids.length || payload.evidence_ids.length > 256) throw fail('EVIDENCE_REQUIRED');
      const ids = payload.evidence_ids.map(id);
      if (new Set(ids).size !== ids.length) throw fail('EVIDENCE_INVALID');
      const evidence = ids.map(eid => f.attempt.evidence.find(e => e.evidence_id === eid && f.found.evidence_keys.includes(e.evidence_key)));
      if (evidence.some(e => !e || e.locator_kind !== 'json_pointer')) throw fail('EVIDENCE_INVALID');
      await currentInputs(db, f.run);
      return request(db, who, 'analysis_finding_decision', payload, async () => {
        if (!Number.isSafeInteger(payload.expected_revision) || state.revision_no !== payload.expected_revision) throw fail('REVISION_CONFLICT', 409);
        if (state.issue_id || state.decision === 'not_an_issue') throw fail('DECISION_FINAL', 409);
        let issueId = null, issueRevision = null;
        if (['create','link'].includes(payload.action)) {
          if (payload.action === 'create') {
            if (payload.issue_id != null || payload.expected_issue_revision != null || payload.expected_issue_digest != null) throw fail('PROPERTY_INVALID');
            const title = text(payload.title, 255);
            await db.execute(`INSERT INTO process_governance_issues(issue_key,primary_dept_name,owner_dept_name,source_layer,source_type,source_ref_table,source_ref_id,title,what_text,why_text,where_text,who_text,when_text,how_text,how_much_text,display_status)
              VALUES (?,?,?,'unknown','analysis_finding','data_map_analysis_findings',?,?,?,?,?,?,?, ?,?,'waiting_my_action')`,
            ['analysis-finding:' + f.found.finding_id, dept.name, dept.name, f.found.finding_id, title, f.found.message, reason,
              `分析运行 ${f.run.run_id}，发现 ${f.found.finding_id}；${f.found.semantic_locator}`, `归口部门：${dept.name}；依据：${ownerBasis}`, '办理期限待明确', '待分派办理；问题关闭需另行有权复核', '影响范围待核实']);
            issueId = await lastId(db);
          } else {
            issueId = id(payload.issue_id);
            if (payload.title != null) throw fail('PROPERTY_INVALID');
          }
          const target = await issue(db, who, issueId);
          await linkedFindings(db, session, issueId);
          if (['completed','closed','not_in_scope'].includes(target.value.display_status)) throw fail('TARGET_CLOSED', 409);
          if (target.value.primary_dept_name !== dept.name || (target.value.owner_dept_name && target.value.owner_dept_name !== dept.name) || (target.binding && target.binding.owner_department_id !== dept.id)) throw fail('OWNER_MISMATCH', 409);
          if (payload.action === 'link' && (payload.expected_issue_revision !== (target.binding?.revision_no || 1) || payload.expected_issue_digest !== digest(target.value))) throw fail('TARGET_CONFLICT', 409);
          if (!target.binding) await db.execute('INSERT INTO data_map_analysis_issue_bindings(issue_id,owner_department_id,revision_no,issue_digest,created_by_person_id,created_at) VALUES (?,?,1,?,?,UTC_TIMESTAMP(3))', [issueId, dept.id, digest(target.value), who.personId]);
          issueRevision = (target.binding?.revision_no || 1) + 1;
          await db.execute('UPDATE data_map_analysis_issue_bindings SET revision_no=? WHERE issue_id=?', [issueRevision, issueId]);
        } else if (payload.issue_id != null || payload.title != null || payload.expected_issue_digest != null || payload.expected_issue_revision != null) throw fail('PROPERTY_INVALID');
        const record = { finding_id: f.found.finding_id, run_id: f.run.run_id, attempt_id: f.attempt.attempt_id, revision_no: state.revision_no + 1,
          decision: issueId ? 'linked' : payload.action === 'confirm' ? 'confirmed' : 'not_an_issue', issue_id: issueId, issue_revision: issueRevision,
          actor_person_id: who.personId, reason, owner_department_id: dept.id, owner_basis: ownerBasis, manifest_digest: f.run.manifest_digest,
          finding_digest: digest(f.found), fixed_inputs: f.run.manifest.inputs, evidence };
        await db.execute('INSERT INTO data_map_analysis_finding_reviews(finding_id,revision_no,decision,issue_id,actor_person_id,snapshot_json,snapshot_digest,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))',
          [record.finding_id, record.revision_no, record.decision, issueId, who.personId, json(record), digest(record)]);
        const reviewId = await lastId(db);
        if (issueId) await db.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,?,?)", [issueId, who.personId, reason, json({ source_type: 'analysis_finding', review_id: reviewId, run_id: f.run.run_id, finding_id: record.finding_id })]);
        return { review_id: reviewId, finding_id: record.finding_id, revision_no: record.revision_no, decision: record.decision, issue_id: issueId, issue_revision: issueRevision };
      });
    }); }
  };
};
