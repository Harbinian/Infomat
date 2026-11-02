const { checkRuntimeSchema } = require('./mysqlRuntimeSchema');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');
const { createRegisteredPool } = require('./mysqlPoolRegistry');
const governanceCompatibility = require('./terminologyGovernanceCompatibility');

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
      COALESCE(t.created_by_person_id, t.created_by)=?
      OR d.id=?
      OR r.dept_name=?
      OR r.input_source_dept=?
      OR r.output_target_dept=?
    )`,
    params: [
      scope.personId || scope.userId || 0,
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
         t.created_by_person_id,
         t.created_at,
         t.approved_by,
         t.approved_by_person_id,
         t.approved_at,
         t.updated_at,
         (SELECT CAST(COALESCE(MAX(v.id),0) AS CHAR) FROM mdm_version_log v WHERE v.entity_type='terminology_term' AND v.entity_id=t.id) AS write_revision
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
  governanceCompatibility.assertLegacyWriteAllowed();
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
  const writes = require('./legacyGovernanceWrites');
  async function mutate(action, termId, payload, session) {
    return await writes.transaction(pool, async db => {
      let before = null;
      if (termId) {
        const [[locked]] = await db.execute('SELECT id,process_mapping_record_id FROM terminology_terms WHERE id=? FOR UPDATE', [termId]);
        if (!locked) throw writes.fail(404, 'LEGACY_TERM_MISSING', '术语不存在');
        before = locked;
      }
      const processIds = [...new Set([before?.process_mapping_record_id, ...(action === 'create' || action === 'update' ? [payload.process_id] : [])].filter(Boolean))].sort((a,b)=>Number(a)-Number(b));
      for (const processId of processIds) {
        const [[process]] = await db.execute('SELECT id,dept_name FROM process_mapping_records WHERE id=? FOR SHARE', [processId]);
        if (process) await db.execute('SELECT id FROM departments WHERE name=? FOR SHARE', [process.dept_name]);
      }
      const current = await writes.actor(db, session, action === 'review' ? 'governance:review-department' : 'governance:draft-department');
      const repo = makeTerminologyMysqlRepository(db);
      before = termId ? await repo.getTerm(termId) : null;
      if (before) {
        writes.compareToken(payload.expected_token, before.write_token);
        if (Number(before.process_owner_dept_id || 0) !== Number(current.current_department_id) || (action !== 'review' && before.status !== 'pending')) throw writes.fail(403,'LEGACY_WRITE_FORBIDDEN','只能办理本部门当前许可状态的术语');
      }
      if (['create','update'].includes(action)) {
        if (!await repo.getTermType(normalizeTermPayload(payload).term_type_code)) throw writes.fail(400,'LEGACY_TERM_INVALID','术语类型不存在');
        const process = await repo.getProcess(payload.process_id, {departmentId:current.current_department_id,departmentName:(await first(db,'SELECT name FROM departments WHERE id=?',[current.current_department_id]))?.name});
        if (!process) throw writes.fail(403,'LEGACY_WRITE_FORBIDDEN','不能选择其他部门或当前无效的业务流程');
      }
      let result;
      if (action === 'create') result = await repo.createTerm(payload, session.userId);
      if (action === 'update') result = await repo.updateTerm(termId, payload);
      if (action === 'review') {
        if (!['approve','reject'].includes(payload.action)) throw writes.fail(400,'LEGACY_TERM_INVALID','不支持的审核操作');
        result = await repo.reviewTerm(termId, payload.action, session.userId);
      }
      if (action === 'delete') result = await repo.deleteTerm(termId);
      await writes.audit(db,'terminology_term',termId||result.id,action,session,before,action === 'delete' ? null : result);
      return result;
    });
  }
  return {
    async initSchema() {
      governanceCompatibility.assertLegacyWriteAllowed();
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
      if (governanceCompatibility.enabled()) return governanceCompatibility.listLegacyTerms(pool, filters);
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
      const result = await rows(
        pool,
        `${TERM_SELECT}
         WHERE ${conditions.join(' AND ')}
         ORDER BY t.term`,
        params
      );
      return result.map(row=>{const {write_revision,...visible}=row;return {...visible,write_token:writes.termToken(row)};});
    },

    async getTerm(termId, scope = null, forShare = false) {
      if (governanceCompatibility.enabled()) return governanceCompatibility.getLegacyTerm(pool, termId, scope, { forShare });
      const scoped = scope ? scopedTermSql(scope) : { sql: '', params: [] };
      const row = await first(
        pool,
        `${TERM_SELECT}
         WHERE t.id=?${scoped.sql}
         LIMIT 1${forShare ? ' FOR SHARE' : ''}`,
        [termId, ...scoped.params]
      );
      if (!row) return null;
      const {write_revision,...visible}=row;
      return {...visible,write_token:writes.termToken(row)};
    },

    async createTerm(payload = {}, actorUserId = null, session = null) {
      governanceCompatibility.assertLegacyWriteAllowed();
      if (session) return await mutate('create', null, payload, session);
      const normalized = normalizeTermPayload(payload);
      const actorPersonId = payload.actor_person_id || payload.actorPersonId || actorUserId || null;
      const result = await pool.execute(
        `INSERT INTO terminology_terms
          (term, term_type_code, definition, scope, forbidden, process_mapping_record_id, created_by, created_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalized.term,
          normalized.term_type_code,
          normalized.definition,
          normalized.scope,
          normalized.forbidden,
          normalized.process_id,
          actorUserId || null,
          actorPersonId
        ]
      );
      return await this.getTerm(insertId(result));
    },

    async updateTerm(termId, payload = {}, session = null) {
      governanceCompatibility.assertLegacyWriteAllowed();
      if (session) return await mutate('update', termId, payload, session);
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

    async reviewTerm(termId, action, reviewerId, session = null, expectedToken = undefined) {
      governanceCompatibility.assertLegacyWriteAllowed();
      if (session) return await mutate('review', termId, {action,expected_token:expectedToken}, session);
      const reviewerPersonId = reviewerId;
      const newStatus = action === 'approve' ? 'approved' : 'rejected';
      const result = await pool.execute(
        `UPDATE terminology_terms
         SET status=?,
             approved_by=?,
             approved_by_person_id=?,
             approved_at=CURRENT_TIMESTAMP
          WHERE id=?`,
        [newStatus, reviewerId || null, reviewerPersonId || null, termId]
      );
      return affectedRows(result) > 0 ? await this.getTerm(termId) : null;
    },

    async deleteTerm(termId, session = null, expectedToken = undefined) {
      governanceCompatibility.assertLegacyWriteAllowed();
      if (session) return await mutate('delete', termId, {expected_token:expectedToken}, session);
      const result = await pool.execute('DELETE FROM terminology_terms WHERE id=?', [termId]);
      return affectedRows(result) > 0;
    }
  };
}

async function terminologyRepository() {
  if (terminologyRepositoryFactory) return await terminologyRepositoryFactory();
  if (!terminologyRepoPromise) {
    terminologyRepoPromise = (async () => {
      const pool = createRegisteredPool(process.env, 'terminology');
      const repo = makeTerminologyMysqlRepository(pool);
      await checkRuntimeSchema(pool, 'terminology');
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
