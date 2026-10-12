const { checkRuntimeSchema } = require('./mysqlRuntimeSchema');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { identityInteger } = require('./sessionSubject');
const { createRegisteredPool } = require('./mysqlPoolRegistry');

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

// R08/R01: identity columns are returned through identityInteger so an entity id beyond the
// safe-integer range stays exact instead of being rounded to a neighbouring object. An absent
// operator stays null and is never turned into 0.
function publicVersionRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: identityInteger(row.id),
    entity_id: identityInteger(row.entity_id),
    operated_by: row.operated_by == null ? null : identityInteger(row.operated_by),
    operated_by_person_id: row.operated_by_person_id == null ? null : identityInteger(row.operated_by_person_id),
    change_set_id: row.change_set_id == null ? null : identityInteger(row.change_set_id)
  };
}

function publicChangeSetRow(row) {
  if (!row) return null;
  return {
    ...row,
    id: identityInteger(row.id),
    entity_id: identityInteger(row.entity_id),
    operated_by: row.operated_by == null ? null : identityInteger(row.operated_by),
    operated_by_person_id: row.operated_by_person_id == null ? null : identityInteger(row.operated_by_person_id)
  };
}

function publicActivityRow(row) {
  const value = row.activity_date;
  // SQL DATE is a calendar day; mysql2 constructs it in the connection's local timezone.
  const date = value instanceof Date
    ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
    : String(value || '').slice(0, 10);
  return {
    date,
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
      // R08: identity columns are projected as characters. The driver turns a BIGINT into a
      // JavaScript number, and a value beyond the safe range is already rounded by then -- the
      // rounding cannot be undone afterwards, so the exact form has to come out of the query.
      `SELECT CAST(vl.id AS CHAR) AS id, vl.entity_type, CAST(vl.entity_id AS CHAR) AS entity_id,
              vl.field_name, vl.old_value, vl.new_value, vl.operation,
              CAST(vl.operated_by AS CHAR) AS operated_by,
              CAST(vl.operated_by_person_id AS CHAR) AS operated_by_person_id,
              CAST(vl.change_set_id AS CHAR) AS change_set_id,
              vl.operated_at, vl.metadata_json,
              CASE WHEN vl.entity_type IN ('legacy_field_import','terminology_term','conflict_field','conflict_term')
                   THEN p.person_name ELSE u.name END AS operator_name
       FROM mdm_version_log vl
       LEFT JOIN users u ON vl.operated_by = u.id
       LEFT JOIN person p ON vl.operated_by_person_id = p.person_id
       WHERE vl.entity_type=? AND vl.entity_id=CAST(? AS SIGNED)
       ORDER BY vl.operated_at DESC, vl.id DESC`,
      [entityType, String(entityId)]
    );
    return result.map(publicVersionRow);
  }

  // Scope lookups for versionAuditScope. The repository only reads; authorization is decided by
  // the caller. Absent rows mean the object is gone or never existed -- not that it is open.
  async function readContextDepartment(contextId) {
    const result = await rows(
      pool,
      `SELECT CAST(dept_id AS CHAR) AS department_id FROM data_map_contexts WHERE id=CAST(? AS SIGNED) LIMIT 1`,
      [String(contextId)]
    );
    return result[0] ? { departmentId: result[0].department_id } : null;
  }

  async function readFieldDepartment(fieldId) {
    const result = await rows(
      pool,
      `SELECT CAST(c.dept_id AS CHAR) AS department_id
       FROM data_map_fields f
       JOIN data_map_contexts c ON c.id = f.context_id
       WHERE f.id=CAST(? AS SIGNED) LIMIT 1`,
      [String(fieldId)]
    );
    return result[0] ? { departmentId: result[0].department_id } : null;
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
        `SELECT CAST(cs.id AS CHAR) AS id, cs.entity_type, CAST(cs.entity_id AS CHAR) AS entity_id,
                CAST(cs.operated_by AS CHAR) AS operated_by,
                CAST(cs.operated_by_person_id AS CHAR) AS operated_by_person_id,
                cs.operated_at, cs.description, cs.metadata_json, u.name AS operator_name
         FROM mdm_change_sets cs
         LEFT JOIN users u ON cs.operated_by = u.id
         WHERE cs.entity_type=? AND cs.entity_id=CAST(? AS SIGNED)
         ORDER BY cs.operated_at DESC, cs.id DESC`,
        [entityType, String(entityId)]
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

    readContextDepartment,
    readFieldDepartment,

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
      const pool = createRegisteredPool(process.env, 'audit');
      const repo = makeAuditMysqlRepository(pool);
      await checkRuntimeSchema(pool, 'audit');
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
