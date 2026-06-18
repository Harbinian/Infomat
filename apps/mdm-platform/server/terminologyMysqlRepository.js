const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let terminologyRepoPromise = null;
let terminologyRepositoryFactory = null;

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(pool, sql, params = []) {
  const result = await rows(pool, sql, params);
  return result[0] || null;
}

function insertId(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.insertId || 0);
}

function affectedRows(result) {
  const meta = Array.isArray(result) ? result[0] : result;
  return Number(meta && meta.affectedRows || 0);
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function nullableText(value) {
  const text = cleanText(value);
  return text || null;
}

function scopedProcessSql(scope = {}) {
  if (scope.canViewAll) return { sql: '', params: [] };
  return {
    sql: ' AND (d.id=? OR r.dept_name=? OR r.input_source_dept=? OR r.output_target_dept=?)',
    params: [
      scope.departmentId || -1,
      scope.departmentName || '__none__',
      scope.departmentName || '__none__',
      scope.departmentName || '__none__'
    ]
  };
}

function scopedTermSql(scope = {}) {
  if (scope.canViewAll) return { sql: '', params: [] };
  return {
    sql: ` AND (
      t.created_by=?
      OR d.id=?
      OR r.dept_name=?
      OR r.input_source_dept=?
      OR r.output_target_dept=?
    )`,
    params: [
      scope.userId || 0,
      scope.departmentId || -1,
      scope.departmentName || '__none__',
      scope.departmentName || '__none__',
      scope.departmentName || '__none__'
    ]
  };
}

const PROCESS_SELECT = `
  SELECT r.id,
         r.l3_name AS name,
         '流程治理读模型' AS cap_name,
         d.id AS owner_dept_id,
         r.dept_name AS dept_name
  FROM process_mapping_records r
  LEFT JOIN departments d ON d.name = r.dept_name
  WHERE r.record_type='l3'
    AND r.status IN ('active','published')
`;

const TERM_SELECT = `
  SELECT t.id,
         t.term,
         t.term_type_code,
         tt.name AS term_type_name,
         tt.description AS term_type_description,
         t.definition,
         t.scope,
         t.forbidden,
         t.status,
         t.process_mapping_record_id AS process_id,
         r.l3_name AS process_name,
         d.id AS process_owner_dept_id,
         r.dept_name AS process_dept_name,
         t.created_by,
         t.created_at,
         t.approved_by,
         t.approved_at,
         t.updated_at
  FROM terminology_terms t
  LEFT JOIN terminology_term_types tt ON t.term_type_code = tt.code
  LEFT JOIN process_mapping_records r ON t.process_mapping_record_id = r.id
  LEFT JOIN departments d ON d.name = r.dept_name
`;

function normalizeTermPayload(payload = {}) {
  return {
    term: cleanText(payload.term),
    term_type_code: cleanText(payload.term_type_code) || 'noun',
    definition: nullableText(payload.definition),
    scope: nullableText(payload.scope),
    forbidden: nullableText(payload.forbidden),
    process_id: payload.process_id ? Number(payload.process_id) : null
  };
}

const DEFAULT_TERM_TYPES = [
  ['noun', '名词', '业务对象、数据对象、字段、表单、交付物等名词性术语', 10, 1],
  ['verb', '动词', '流程行为、操作动作、状态转换等动词性术语', 20, 1],
  ['role', '角色词', '流程执行角色、审批角色、责任角色等称谓', 30, 1],
  ['position', '岗位词', '组织岗位、职位、专业岗位等称谓', 40, 1],
  ['input', '输入词', '输入资料、触发条件、来源信息等术语', 50, 1],
  ['output', '输出词', '输出资料、成果物、记录、交付物等术语', 60, 1],
  ['time_limit', '时效词', '周期、时限、频次、提前量等时间约束术语', 70, 1]
];

async function seedDefaultTerminologyTermTypes(pool) {
  for (const termType of DEFAULT_TERM_TYPES) {
    await pool.execute(
      `INSERT INTO terminology_term_types (code, name, description, sort_order, active)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
        name=VALUES(name),
        description=VALUES(description),
        sort_order=VALUES(sort_order),
        active=VALUES(active)`,
      termType
    );
  }
}

function makeTerminologyMysqlRepository(pool) {
  return {
    async initSchema() {
      for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
        await pool.execute(statement);
      }
      await seedDefaultTerminologyTermTypes(pool);
    },

    async listTermTypes() {
      return await rows(
        pool,
        `SELECT code, name, description, sort_order
         FROM terminology_term_types
         WHERE active=1
         ORDER BY sort_order, code`
      );
    },

    async getTermType(code) {
      return await first(
        pool,
        `SELECT code, name, description, sort_order
         FROM terminology_term_types
         WHERE code=? AND active=1
         LIMIT 1`,
        [code]
      );
    },

    async listProcesses(scope = {}) {
      const processScope = scopedProcessSql(scope);
      return await rows(
        pool,
        `${PROCESS_SELECT}${processScope.sql}
         ORDER BY r.dept_name, r.l3_name, r.id`,
        processScope.params
      );
    },

    async getProcess(processId, scope = {}) {
      const processScope = scopedProcessSql(scope);
      return await first(
        pool,
        `${PROCESS_SELECT}
         AND r.id=?${processScope.sql}
         LIMIT 1`,
        [processId, ...processScope.params]
      );
    },

    async processExists(processId) {
      const process = await first(
        pool,
        `SELECT r.id
         FROM process_mapping_records r
         WHERE r.id=? AND r.record_type='l3'
         LIMIT 1`,
        [processId]
      );
      return Boolean(process);
    },

    async listTerms(filters = {}) {
      const params = [];
      const conditions = ['1=1'];
      if (filters.status) {
        conditions.push('t.status=?');
        params.push(filters.status);
      }
      const scope = scopedTermSql(filters);
      const scopeSql = scope.sql ? scope.sql.replace(/^ AND /, '') : '';
      if (scopeSql) {
        conditions.push(scopeSql);
        params.push(...scope.params);
      }
      return await rows(
        pool,
        `${TERM_SELECT}
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.term`,
        params
      );
    },

    async getTerm(termId) {
      return await first(
        pool,
        `${TERM_SELECT}
         WHERE t.id=?
         LIMIT 1`,
        [termId]
      );
    },

    async createTerm(payload = {}, actorUserId = null) {
      const normalized = normalizeTermPayload(payload);
      const result = await pool.execute(
        `INSERT INTO terminology_terms
          (term, term_type_code, definition, scope, forbidden, process_mapping_record_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.term,
          normalized.term_type_code,
          normalized.definition,
          normalized.scope,
          normalized.forbidden,
          normalized.process_id,
          actorUserId || null
        ]
      );
      return await this.getTerm(insertId(result));
    },

    async updateTerm(termId, payload = {}) {
      const normalized = normalizeTermPayload(payload);
      const result = await pool.execute(
        `UPDATE terminology_terms
         SET term=?,
             term_type_code=?,
             definition=?,
             scope=?,
             forbidden=?,
             process_mapping_record_id=?
         WHERE id=?`,
        [
          normalized.term,
          normalized.term_type_code,
          normalized.definition,
          normalized.scope,
          normalized.forbidden,
          normalized.process_id,
          termId
        ]
      );
      return affectedRows(result) > 0 ? await this.getTerm(termId) : null;
    },

    async reviewTerm(termId, action, reviewerId) {
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const result = await pool.execute(
        `UPDATE terminology_terms
         SET status=?,
             approved_by=?,
             approved_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [newStatus, reviewerId || null, termId]
      );
      return affectedRows(result) > 0 ? await this.getTerm(termId) : null;
    },

    async deleteTerm(termId) {
      const result = await pool.execute('DELETE FROM terminology_terms WHERE id=?', [termId]);
      return affectedRows(result) > 0;
    }
  };
}

async function terminologyRepository() {
  if (terminologyRepositoryFactory) return await terminologyRepositoryFactory();
  if (!terminologyRepoPromise) {
    terminologyRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeTerminologyMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await terminologyRepoPromise;
  } catch (error) {
    terminologyRepoPromise = null;
    throw error;
  }
}

function setTerminologyRepositoryFactory(factory) {
  terminologyRepositoryFactory = factory;
  terminologyRepoPromise = null;
}

function resetTerminologyRepositoryFactory() {
  terminologyRepositoryFactory = null;
  terminologyRepoPromise = null;
}

module.exports = {
  makeTerminologyMysqlRepository,
  seedDefaultTerminologyTermTypes,
  terminologyRepository,
  setTerminologyRepositoryFactory,
  resetTerminologyRepositoryFactory
};
