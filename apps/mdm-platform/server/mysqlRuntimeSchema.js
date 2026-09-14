const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

// These are runtime dependency groups, not a second schema. Column names come from
// the existing schema source; version migrations remain the migration scripts' job.
const DOMAIN_TABLES = {
  identity: ['departments', 'person', 'user_accounts', 'person_roles', 'roles', 'permissions', 'role_permissions'],
  processGovernance: ['process_governance_snapshots', 'process_a1_items', 'process_governance_nodes', 'process_governance_edges', 'process_governance_quality_findings', 'process_mapping_todos'],
  inputBaseline: ['process_input_baseline_review_runs', 'process_input_baseline_review_items', 'process_input_baseline_review_excerpts', 'process_input_baseline_review_decisions'],
  issuePool: ['process_governance_issues', 'process_governance_issue_points', 'process_governance_issue_events'],
  guidance: ['process_governance_guidance', 'process_governance_guidance_events'],
  dataMap: ['data_map_objects', 'data_map_contexts', 'data_map_fields', 'data_map_field_identities'],
  mapping: ['mdm_mapping_records', 'mdm_mapping_approval_tasks', 'mdm_mapping_approval_history'],
  conflict: ['mdm_field_conflicts', 'mdm_term_conflicts', 'mdm_conflict_assignments'],
  todo: ['mdm_todos', 'mdm_todo_events'],
  terminology: ['data_map_terms', 'data_map_term_types'],
  audit: ['mdm_version_log', 'mdm_change_sets'],
  processDesign: ['process_design_documents', 'process_design_drafts', 'process_design_versions', 'process_design_cross_dept_handoffs']
};

function runtimeSchemaProbes(domain) {
  const tables = DOMAIN_TABLES[domain];
  if (!tables) throw new Error(`Unknown runtime schema domain: ${domain}`);
  const statements = splitSqlStatements(mdmMysqlSchemaSql());
  return tables.map(table => {
    const statement = statements.find(sql => new RegExp(`^CREATE TABLE IF NOT EXISTS ${table}\\s*\\(`, 'i').test(sql.trim()));
    if (!statement) throw new Error(`Runtime dependency is absent from schema source: ${table}`);
    const columns = [...statement.matchAll(/^\s{2}([a-z_][a-z0-9_]*)\s+(?:BIGINT|INT|VARCHAR|TEXT|LONGTEXT|JSON|TIMESTAMP|DATETIME|DATE|ENUM|BOOLEAN|TINYINT|DECIMAL|CHAR|DOUBLE|FLOAT|MEDIUMTEXT)\b/gim)].map(match => match[1]);
    if (!columns.length) throw new Error(`Runtime dependency has no columns: ${table}`);
    return `SELECT ${columns.map(column => `\`${column}\``).join(', ')} FROM \`${table}\` LIMIT 0`;
  });
}

async function checkRuntimeSchema(pool, domain) {
  try {
    for (const sql of runtimeSchemaProbes(domain)) await pool.execute(sql);
  } catch (cause) {
    // A failed factory must not leak pools on the next request. Never log raw SQL,
    // credentials or database response bodies through this preflight failure.
    try { await pool.end(); } catch (_) { /* Preserve the preflight failure. */ }
    const error = new Error('数据服务或所需结构不可用，请运维人员核对连接并按迁移手册检查结构；应用不会自动修复。');
    error.code = 'MYSQL_RUNTIME_SCHEMA_UNAVAILABLE';
    error.statusCode = 503;
    error.domain = domain;
    error.reason = String(cause && cause.code || 'SCHEMA_PROBE_FAILED');
    throw error;
  }
}

function sendMysqlUnavailable(res, error) {
  const unavailableCodes = new Set(['MYSQL_RUNTIME_SCHEMA_UNAVAILABLE', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR',
    'ER_TABLEACCESS_DENIED_ERROR', 'ER_COLUMNACCESS_DENIED_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR',
    'ER_BAD_DB_ERROR', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'PROTOCOL_CONNECTION_LOST']);
  if (!error || !unavailableCodes.has(error.code)) return false;
  res.status(503).json({ code: 'MYSQL_RUNTIME_UNAVAILABLE',
    error: '数据服务或所需结构不可用，请运维人员核对连接并按迁移手册检查结构；应用不会自动修复。' });
  return true;
}

module.exports = { checkRuntimeSchema, runtimeSchemaProbes, DOMAIN_TABLES, sendMysqlUnavailable };
