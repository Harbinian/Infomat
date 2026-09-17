// Old mutation paths lack new-source authorization/review contracts. Deny only
// affected issues, under the same issue row lock used by the new linking path.
const { failure } = require('./dataMapDefinitionValues');
async function installed(db) {
  return (await db.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='data_map_analysis_issue_bindings'"))[0].length > 0;
}
async function guard(db, issueId) {
  const [[issue]] = await db.execute('SELECT source_type FROM process_governance_issues WHERE issue_id=? FOR UPDATE', [issueId]);
  if (issue?.source_type === 'analysis_finding' || (await installed(db) && (await db.execute('SELECT issue_id FROM data_map_analysis_issue_bindings WHERE issue_id=? FOR UPDATE', [issueId]))[0].length)) {
    throw failure('DEFINITION_ANALYSIS_ISSUE_LEGACY_ACTION_BLOCKED', 409);
  }
}
function wrap(pool, factory) {
  const original = factory(pool), result = { ...original };
  const issueMethods = new Set(['getIssueDetail','addIssueComment','closeIssue','reopenIssue']);
  const pointMethods = new Set(['getIssueDetailByPoint','applyPointAction']);
  const termMethods = new Set(['getTermTask','answerTermTask','decideTermTask']);
  for (const method of [...issueMethods,...pointMethods,...termMethods,'createTermTask','generateIssuePool','listQueues','listIssues']) {
    result[method] = async (...args) => {
      const db = await pool.getConnection();
      try {
        await db.beginTransaction();
        let issueId = issueMethods.has(method) ? args[0] : method === 'createTermTask' ? args[0].issueId || args[0].issue_id : null;
        if (pointMethods.has(method) || termMethods.has(method)) {
          const table = pointMethods.has(method) ? 'process_governance_issue_points' : 'process_governance_term_tasks';
          const column = pointMethods.has(method) ? 'point_id' : 'term_task_id';
          const [[ref]] = await db.execute(`SELECT CAST(issue_id AS CHAR) issue_id FROM ${table} WHERE ${column}=?`, [args[0]]);
          issueId = ref?.issue_id;
        }
        if (issueId) await guard(db, issueId);
        let executor = db;
        if (['listQueues','listIssues'].includes(method)) {
          const active = await installed(db);
          // Hide new-source details from old name-only visibility checks. New API
          // validates every linked finding's fixed input scope before disclosure.
          executor = { execute: (sql, params) => db.execute(sql.replace(/process_governance_issues(?= i\b| i2\b)/g,
            `(SELECT legacy_issue.* FROM process_governance_issues legacy_issue WHERE legacy_issue.source_type<>'analysis_finding'${active ? ' AND NOT EXISTS (SELECT 1 FROM data_map_analysis_issue_bindings binding WHERE binding.issue_id=legacy_issue.issue_id)' : ''})`), params) };
        }
        const core = factory(executor), value = await core[method](...args);
        await db.commit(); return value;
      } catch (e) { await db.rollback(); throw e; } finally { db.release(); }
    };
  }
  return result;
}
module.exports = { installed, guard, wrap };
