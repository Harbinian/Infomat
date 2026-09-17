// Optional P17 overlay; no startup DDL and no broader access to analysis materials.
const { parse, digest, failure } = require('./dataMapDefinitionValues');
async function decorate(db, actor, tasks, managerId) {
  const [present] = await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_analysis_issue_tasks'");
  if (!present.length || !tasks.length) return tasks;
  const [links] = await db.execute(`SELECT CAST(todo_id AS CHAR) todo_id,CAST(issue_id AS CHAR) issue_id,purpose,round_no,snapshot_json,snapshot_digest
    FROM data_map_analysis_issue_tasks WHERE todo_id IN (${tasks.map(() => '?').join(',')})`, tasks.map(t => t.id));
  const byId = new Map(links.map(l => [String(l.todo_id),l]));
  const out = [];
  for (const task of tasks) {
    const link = byId.get(String(task.id));
    if (!link) { out.push(task); continue; }
    if (!actor.canReadAll && Number(managerId) !== actor.personId && Number(task.assignee_person_id) !== actor.personId) continue;
    const snapshot = parse(link.snapshot_json);
    if (digest(snapshot) !== link.snapshot_digest || snapshot.issue_id !== link.issue_id || snapshot.purpose !== link.purpose || snapshot.round_no !== link.round_no || String(task.office_id) !== snapshot.office_id) throw failure('DEFINITION_ANALYSIS_TASK_INTEGRITY_CONFLICT',409);
    out.push({ ...task, analysis_task: { issue_id:link.issue_id,purpose:link.purpose,round_no:link.round_no,instruction:snapshot.instruction,
      source_revision:snapshot.issue_revision,source_digest:snapshot.issue_digest,close_enabled:false } });
  }
  return out;
}
module.exports = { decorate };
