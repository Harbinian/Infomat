const { id, json, digest, parse, lastId, failure } = require('./dataMapDefinitionValues');
const { MIGRATION_KEY } = require('./analysisTaskSchema');
const PURPOSES = { verify: '核实', correct: '整改', coordinate: '协调', review: '复核' };
const fail = (code, status = 400) => failure('DEFINITION_ANALYSIS_TASK_' + code, status);
module.exports = ({ tx, actor, request, issue, linkedFindings, currentInputs, runs }) => {
  async function ready(db) {
    if (!(await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?', [MIGRATION_KEY]))[0].length) throw fail('MIGRATION_REQUIRED',503);
  }
  async function target(db, officeId) {
    const [[office]] = await db.execute(`SELECT CAST(o.org_unit_id AS CHAR) office_id,CAST(o.department_id AS CHAR) department_id,o.org_unit_name
      FROM org_unit o JOIN departments d ON d.id=o.department_id WHERE o.org_unit_id=? AND o.org_type='office' AND o.status='active' AND d.status='active' FOR UPDATE`, [id(officeId)]);
    if (!office) throw fail('OFFICE_UNAVAILABLE',404); return office;
  }
  async function source(db, session, issueId) {
    const who = await actor(db,session), result = await issue(db,who,issueId);
    if (!result.binding) throw fail('ISSUE_UNLINKED',409);
    const links = await linkedFindings(db,session,id(issueId));
    return { who, result, links };
  }
  return {
    getAnalysisIssueTasks(session, issueId) { return tx(async db => {
      await ready(db); const { who, result } = await source(db,session,issueId);
      const [tasks] = await db.execute(`SELECT CAST(l.todo_id AS CHAR) todo_id,l.purpose,l.round_no,l.snapshot_json,l.snapshot_digest,
        t.content,t.status,CAST(a.office_id AS CHAR) office_id,CAST(a.assignee_person_id AS CHAR) assignee_person_id,a.revision_no,o.org_unit_name office_name,
        (SELECT e.note FROM mdm_todo_events e WHERE e.todo_id=l.todo_id AND e.event_type='office_task_completed' ORDER BY e.id DESC LIMIT 1) completion
        FROM data_map_analysis_issue_tasks l JOIN mdm_todos t ON t.id=l.todo_id JOIN mdm_todo_office_assignments a ON a.todo_id=l.todo_id
        JOIN org_unit o ON o.org_unit_id=a.office_id WHERE l.issue_id=? ORDER BY l.round_no,l.todo_id`, [id(issueId)]);
      const items = tasks.map(({ snapshot_json, snapshot_digest, ...t }) => {
        const snapshot = parse(snapshot_json); if (digest(snapshot) !== snapshot_digest) throw fail('INTEGRITY_CONFLICT',409);
        return { ...t, snapshot, completion: t.completion ? parse(t.completion) : null };
      });
      const canDispatch = !who.readOnly && who.permissions.has('governance:assign-work');
      const [offices] = canDispatch ? await db.execute(`SELECT CAST(o.org_unit_id AS CHAR) id,o.org_unit_name name FROM org_unit o JOIN departments d ON d.id=o.department_id
        WHERE o.org_type='office' AND o.status='active' AND d.status='active' AND o.department_id=? ORDER BY o.org_unit_id`, [result.binding.owner_department_id]) : [[]];
      return { items, offices, can_dispatch: canDispatch, revision_no: result.binding.revision_no, issue_digest: result.binding.issue_digest, close_enabled: false, auto_dispatch_enabled: false };
    }); },
    dispatchAnalysisIssueTask(session, payload) { return tx(async db => {
      await ready(db);
      const allowed = ['request_id','issue_id','expected_revision','expected_issue_digest','office_id','purpose','round_no','instruction'];
      if (!payload || Object.keys(payload).some(k => !allowed.includes(k))) throw fail('PROPERTY_INVALID');
      const who = await actor(db,session,'governance:assign-work');
      const { result, links } = await source(db,session,payload.issue_id);
      const office = await target(db,payload.office_id);
      if (office.department_id !== result.binding.owner_department_id) throw fail('OFFICE_SCOPE_MISMATCH',403);
      if (!Object.hasOwn(PURPOSES,payload.purpose) || !Number.isSafeInteger(payload.round_no) || payload.round_no < 1 || payload.round_no > 10000) throw fail('ACTION_INVALID');
      if (typeof payload.instruction !== 'string' || !payload.instruction.trim() || payload.instruction.length > 4000) throw fail('INSTRUCTION_REQUIRED');
      if (['completed','closed','not_in_scope'].includes(result.value.display_status)) throw fail('ISSUE_CLOSED',409);
      // Revalidate fixed inputs and current ledger heads before sharing any new assignment.
      for (const link of links) await currentInputs(db,await runs(db).getAnalysisRun(session,link.run_id));
      return request(db,who,'analysis_issue_dispatch',payload,async () => {
        if (payload.expected_revision !== result.binding.revision_no || payload.expected_issue_digest !== result.binding.issue_digest) throw fail('REVISION_CONFLICT',409);
        const [previous] = await db.execute('SELECT todo_id,round_no FROM data_map_analysis_issue_tasks WHERE issue_id=? AND purpose=? ORDER BY round_no FOR UPDATE', [id(payload.issue_id),payload.purpose]);
        if (previous.some(t => t.round_no === payload.round_no)) throw fail('ACTION_ALREADY_DISPATCHED',409);
        if (payload.round_no !== (previous.at(-1)?.round_no || 0) + 1) throw fail('ROUND_CONFLICT',409);
        if (previous.length) {
          const [[last]] = await db.execute('SELECT status FROM mdm_todos WHERE id=? FOR UPDATE',[previous.at(-1).todo_id]);
          if (last.status !== 'done') throw fail('PREVIOUS_ACTION_PENDING',409);
        }
        const instruction = payload.instruction.trim();
        // Only the dispatcher's explicit minimal work instruction enters existing todo projections.
        await db.execute("INSERT INTO mdm_todos(to_dept_id,type,content,urgency,created_by,created_by_person_id) VALUES (?,'office_work',?,'medium',?,?)", [office.department_id,`问题 ${payload.issue_id} · ${PURPOSES[payload.purpose]} · 第 ${payload.round_no} 轮`,who.personId,who.personId]);
        const todoId = await lastId(db);
        await db.execute('INSERT INTO mdm_todo_office_assignments(todo_id,office_id,assigned_by_person_id,request_id) VALUES (?,?,?,?)',[todoId,office.office_id,who.personId,payload.request_id]);
        const snapshot = { issue_id:id(payload.issue_id), issue_revision:result.binding.revision_no, issue_digest:result.binding.issue_digest,
          office_id:office.office_id, purpose:payload.purpose, round_no:payload.round_no, instruction, actor_person_id:who.personId,
          sources:links.map(l => ({ run_id:l.run_id,finding_id:l.finding_id,review:l.reviews.at(-1) })) };
        await db.execute('INSERT INTO data_map_analysis_issue_tasks(todo_id,issue_id,purpose,round_no,snapshot_json,snapshot_digest,created_by_person_id,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP(3))', [todoId,id(payload.issue_id),payload.purpose,payload.round_no,json(snapshot),digest(snapshot),who.personId]);
        await db.execute("INSERT INTO mdm_todo_events(todo_id,event_type,actor_user_id,actor_person_id,note) VALUES (?,'office_received',?,?,?)",[todoId,who.personId,who.personId,json({ office_id:office.office_id,issue_id:id(payload.issue_id),purpose:payload.purpose,round_no:payload.round_no })]);
        await db.execute("INSERT INTO process_governance_issue_events(issue_id,event_type,actor_person_id,note,payload_json) VALUES (?,'commented',?,'明确交办到办公室',?)",[id(payload.issue_id),who.personId,json({ todo_id:todoId,purpose:payload.purpose,round_no:payload.round_no })]);
        await db.execute('UPDATE data_map_analysis_issue_bindings SET revision_no=revision_no+1 WHERE issue_id=?',[id(payload.issue_id)]);
        return { todo_id:todoId, issue_id:id(payload.issue_id), revision_no:result.binding.revision_no+1, status:'pending' };
      });
    }); },
    reviewAnalysisIssueTask(session, issueId) { return tx(async db => {
      await ready(db); await source(db,session,issueId);
      // Business authority and its approval basis remain unresolved in the fixed contract.
      throw fail('REVIEW_AUTHORITY_UNCONFIRMED',403);
    }); }
  };
};
