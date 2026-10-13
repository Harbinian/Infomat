const replyEvent = require('./authoringReplyEvent');
const { sameIdentityInteger } = require('./sessionSubject');
// Decimal bindings and SQL integer casts preserve exact todo IDs when display
// statements are reused after a small-number request.
const { identityParam } = require('./officePublication');
// Optional P17 overlay; no startup DDL and no broader access to analysis materials.
const { parse, digest, failure } = require('./dataMapDefinitionValues');
async function decorate(db, actor, tasks, managerId) {
  const [present] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_analysis_issue_tasks'");
  if (!present.length || !tasks.length) return tasks;
  const [links] = await db.execute(`SELECT CAST(todo_id AS CHAR) todo_id,CAST(issue_id AS CHAR) issue_id,purpose,round_no,snapshot_json,snapshot_digest
    FROM data_map_analysis_issue_tasks WHERE todo_id IN (${tasks.map(() => 'CAST(? AS SIGNED)').join(',')})`, tasks.map(t => identityParam(t.id)));
  const byId = new Map(links.map(l => [String(l.todo_id),l]));
  const [authoringTables] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='process_v7_authoring_records'");
  const out = [];
  for (const task of tasks) {
    const link = byId.get(String(task.id));
    if (!link) { out.push(task); continue; }
    if (!actor.canReadAll && !sameIdentityInteger(managerId,actor.personId) && !sameIdentityInteger(task.assignee_person_id,actor.personId)) continue;
    const snapshot = parse(link.snapshot_json);
    if (digest(snapshot) !== link.snapshot_digest || snapshot.issue_id !== link.issue_id || snapshot.purpose !== link.purpose || snapshot.round_no !== link.round_no || String(task.office_id) !== snapshot.office_id) throw failure('DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT',409);
    let replies = [];
    if (authoringTables.length) {
      const [events] = await db.execute(`SELECT CAST(e.id AS CHAR) id,e.note,UNIX_TIMESTAMP(e.created_at) created_epoch,
        r.content_text,CAST(r.actor_person_id AS CHAR) actor_person_id,p.person_name AS actor_name
        FROM mdm_todo_events e JOIN process_v7_authoring_records r ON CAST(r.id AS CHAR)=JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(e.note),e.note,NULL),'$.record_id'))
        JOIN person p ON p.person_id=r.actor_person_id
        WHERE e.todo_id=CAST(? AS SIGNED) AND e.event_type='compiler_replied' ORDER BY e.id DESC LIMIT 50`, [identityParam(task.id)]);
      replies = events.map(e => replyEvent.officeReply(e,{issueId:link.issue_id,todoId:task.id}));
    }
    out.push({ ...task, analysis_task: { issue_id:link.issue_id,purpose:link.purpose,round_no:link.round_no,instruction:snapshot.instruction,
      source_revision:snapshot.issue_revision,source_digest:snapshot.issue_digest,close_enabled:false,compiler_replies:replies } });
  }
  return out;
}
module.exports = { decorate };
