// Serialize office mutations with per-issue closure. No new privilege or startup DDL.
async function lockIssueForTask(db, todoId, checkState=true) {
  const [tables]=await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_analysis_issue_tasks'");
  if(!tables.length)return;
  const [[link]]=await db.execute('SELECT issue_id FROM data_map_analysis_issue_tasks WHERE todo_id=?',[todoId]);
  if(link) {
    const [[issue]]=await db.execute('SELECT display_status FROM process_governance_issues WHERE issue_id=? FOR UPDATE',[link.issue_id]);
    if(checkState&&['closed','completed','not_in_scope'].includes(issue?.display_status)) throw Object.assign(new Error('问题已关闭，须由归口部门最终负责人重新打开后继续办理。'),{statusCode:409,code:'DEFINITION_ANALYSIS_CLOSURE_STATE_CONFLICT'});
    await db.execute('SELECT issue_id FROM data_map_analysis_issue_bindings WHERE issue_id=? FOR UPDATE',[link.issue_id]);
  }
}
module.exports={lockIssueForTask};
