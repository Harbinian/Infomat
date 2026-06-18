const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let auditRepoPromise = null;
let auditRepositoryFactory = null;

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function nullableText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text || null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function auditDomainSchemaStatements() {
  const allowed = [
    'schema_migrations',
    'departments',
    'users',
    'process_governance_snapshots',
    'process_governance_quality_cases',
    'process_governance_quality_case_events',
    'process_mapping_records',
    'process_mapping_todos',
    'process_mapping_todo_events',
    'terminology_term_types',
    'terminology_terms',
    'mdm_mapping_records',
    'mdm_mapping_approval_history',
    'data_map_objects',
    'data_map_contexts',
    'data_map_fields',
    'mdm_field_conflicts',
    'mdm_term_conflicts',
    'mdm_todos',
    'mdm_todo_events',
    'mdm_change_sets',
    'mdm_version_log'
  ];
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
    const normalized = statement.replace(/\s+/g, ' ');
    return allowed.some(table => normalized.includes(`CREATE TABLE IF NOT EXISTS ${table} `));
  });
}

function publicVersionRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    entity_id: Number(row.entity_id),
    operated_by: row.operated_by == null ? null : Number(row.operated_by),
    change_set_id: row.change_set_id == null ? null : Number(row.change_set_id)
  };
}

function publicChangeSetRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    entity_id: Number(row.entity_id),
    operated_by: row.operated_by == null ? null : Number(row.operated_by)
  };
}

function publicActivityRow(row) {
  return {
    date: String(row.activity_date || '').slice(0, 10),
    sourceType: row.source_type,
    sourceLabel: row.source_label,
    actorUserId: row.actor_user_id == null ? null : Number(row.actor_user_id),
    actorName: row.actor_name || null,
    employeeNo: row.employee_no || null,
    departmentId: row.department_id == null ? null : Number(row.department_id),
    departmentName: row.department_name || null
  };
}

function makeAuditMysqlRepository(pool) {
  async function listVersionLogs(entityType, entityId) {
    const result = await rows(
      pool,
      `SELECT vl.*, u.name AS operator_name
       FROM mdm_version_log vl
       LEFT JOIN users u ON vl.operated_by = u.id
       WHERE vl.entity_type=? AND vl.entity_id=?
       ORDER BY vl.operated_at DESC, vl.id DESC`,
      [entityType, Number(entityId)]
    );
    return result.map(publicVersionRow);
  }

  return {
    async initSchema() {
      for (const statement of auditDomainSchemaStatements()) {
        await pool.execute(statement);
      }
    },

    async createChangeSet(payload = {}) {
      const result = await pool.execute(
        `INSERT INTO mdm_change_sets
          (entity_type, entity_id, operated_by, description, operated_at)
         VALUES (?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [
          nullableText(payload.entity_type),
          Number(payload.entity_id || 0),
          numberOrNull(payload.operated_by),
          nullableText(payload.description),
          payload.operated_at || null
        ]
      );
      return insertId(result);
    },

    async recordVersionLog(payload = {}) {
      const result = await pool.execute(
        `INSERT INTO mdm_version_log
          (entity_type, entity_id, field_name, old_value, new_value, operation, operated_by, change_set_id, operated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP))`,
        [
          nullableText(payload.entity_type),
          Number(payload.entity_id || 0),
          nullableText(payload.field_name),
          payload.old_value == null ? null : String(payload.old_value),
          payload.new_value == null ? null : String(payload.new_value),
          nullableText(payload.operation) || 'update',
          numberOrNull(payload.operated_by),
          numberOrNull(payload.change_set_id),
          payload.operated_at || null
        ]
      );
      return insertId(result);
    },

    async listEntityVersions(entityType, entityId) {
      const changeSets = await rows(
        pool,
        `SELECT cs.*, u.name AS operator_name
         FROM mdm_change_sets cs
         LEFT JOIN users u ON cs.operated_by = u.id
         WHERE cs.entity_type=? AND cs.entity_id=?
         ORDER BY cs.operated_at DESC, cs.id DESC`,
        [entityType, Number(entityId)]
      );
      const logs = await listVersionLogs(entityType, entityId);
      return {
        changeSets: changeSets.map(publicChangeSetRow),
        logs
      };
    },

    async listMappingVersions(mappingId) {
      return await listVersionLogs('mapping', mappingId);
    },

    async listFieldVersions(fieldId) {
      return await listVersionLogs('field_entry', fieldId);
    },

    async listActivityRows({ startDate, endDate } = {}) {
      const result = await rows(
        pool,
        `SELECT DATE(e.occurred_at) AS activity_date,
                e.source_type,
                e.source_label,
                e.actor_user_id,
                u.name AS actor_name,
                u.employee_no,
                COALESCE(u.department_id, e.department_id) AS department_id,
                d.name AS department_name
         FROM (
           SELECT created_at AS occurred_at, actor_user_id, 'process_mapping_todo' AS source_type, '流程映射待办' AS source_label, NULL AS department_id
           FROM process_mapping_todo_events
           WHERE actor_user_id IS NOT NULL

           UNION ALL
           SELECT created_at, actor_user_id, 'process_quality', '流程治理质量问题', NULL
           FROM process_governance_quality_case_events
           WHERE actor_user_id IS NOT NULL

           UNION ALL
           SELECT operated_at, operator_user_id, 'mapping_review', '映射提交/审核', NULL
           FROM mdm_mapping_approval_history
           WHERE operator_user_id IS NOT NULL

           UNION ALL
           SELECT operated_at, operated_by, 'mapping_version', '映射版本记录', NULL
           FROM mdm_version_log
           WHERE operated_by IS NOT NULL

           UNION ALL
           SELECT created_at, created_by, 'terminology', '术语创建/审核', NULL
           FROM terminology_terms
           WHERE created_by IS NOT NULL

           UNION ALL
           SELECT approved_at, approved_by, 'terminology', '术语创建/审核', NULL
           FROM terminology_terms
           WHERE approved_by IS NOT NULL AND approved_at IS NOT NULL

           UNION ALL
           SELECT resolved_at, resolved_by, 'conflict', '冲突处理', NULL
           FROM mdm_term_conflicts
           WHERE resolved_by IS NOT NULL AND resolved_at IS NOT NULL

           UNION ALL
           SELECT resolved_at, resolved_by, 'conflict', '冲突处理', NULL
           FROM mdm_field_conflicts
           WHERE resolved_by IS NOT NULL AND resolved_at IS NOT NULL

           UNION ALL
           SELECT done_at, completed_by, 'todo_done', '通用待办完成', to_dept_id
           FROM mdm_todos
           WHERE done_at IS NOT NULL
         ) e
         LEFT JOIN users u ON u.id = e.actor_user_id
         LEFT JOIN departments d ON d.id = COALESCE(u.department_id, e.department_id)
         WHERE e.occurred_at IS NOT NULL
           AND DATE(e.occurred_at) BETWEEN ? AND ?
         ORDER BY activity_date ASC, source_type ASC`,
        [startDate, endDate]
      );
      return result.map(publicActivityRow);
    }
  };
}

async function auditRepository() {
  if (auditRepositoryFactory) return await auditRepositoryFactory();
  if (!auditRepoPromise) {
    auditRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeAuditMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await auditRepoPromise;
  } catch (error) {
    auditRepoPromise = null;
    throw error;
  }
}

function setAuditRepositoryFactory(factory) {
  auditRepositoryFactory = factory;
  auditRepoPromise = null;
}

function resetAuditRepositoryFactory() {
  auditRepositoryFactory = null;
  auditRepoPromise = null;
}

module.exports = {
  auditRepository,
  makeAuditMysqlRepository,
  resetAuditRepositoryFactory,
  setAuditRepositoryFactory
};
