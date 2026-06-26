const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let mappingRepoPromise = null;
let mappingRepositoryFactory = null;

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

function mappingDomainSchemaStatements() {
  const allowed = [
    'schema_migrations',
    'departments',
    'process_governance_snapshots',
    'process_a1_items',
    'process_mapping_records',
    'mdm_mapping_records',
    'mdm_mapping_system_links',
    'mdm_mapping_related_departments',
    'mdm_mapping_approval_tasks',
    'mdm_mapping_approval_history',
    'mdm_mapping_rejection_reasons'
  ];
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
    const normalized = statement.replace(/\s+/g, ' ');
    return allowed.some(table => normalized.includes(`CREATE TABLE IF NOT EXISTS ${table} `));
  });
}

function mappingStatusAfterStep(step) {
  return {
    2: 'dept_reviewed',
    3: 'cross_confirmed',
    4: 'fields_confirmed',
    5: 'final_reviewed'
  }[Number(step)];
}

function normalizeMappingPayload(payload = {}) {
  return {
    process_id: Number(payload.process_mapping_record_id || payload.process_id || 0),
    description: nullableText(payload.description),
    approval_dept_id: payload.approval_dept_id ? Number(payload.approval_dept_id) : null,
    owner_dept_id: Number(payload.owner_dept_id || 0),
    systems: Array.isArray(payload.systems) ? payload.systems : [],
    related_departments: Array.isArray(payload.related_departments) ? payload.related_departments : []
  };
}

function normalizeSystem(system = {}, index = 0) {
  return {
    system_id: system.system_id ? Number(system.system_id) : null,
    system_name: nullableText(system.system_name || system.name),
    system_role: cleanText(system.system_role || system.relation_type) || 'secondary',
    sort_order: Number(system.sort_order || index + 1)
  };
}

function normalizeRelatedDepartment(department = {}) {
  return {
    department_id: Number(department.department_id || department.id || 0),
    relation: cleanText(department.relation) || 'collaborator'
  };
}

function personIdFromPayload(payload = {}, fallback = null) {
  return payload.actor_person_id || payload.actorPersonId || payload.person_id || payload.personId || fallback || null;
}

function scopeClause(alias, scope = {}) {
  if (scope.canViewAll) return { sql: '', params: [] };
  const table = alias || 'm';
  const scopedPersonId = scope.personId || scope.userId || 0;
  const params = [scopedPersonId];
  const clauses = [`COALESCE(${table}.submitted_by_person_id, ${table}.submitted_by)=?`];
  if (scope.departmentId) {
    clauses.push(`${table}.owner_dept_id=?`);
    params.push(scope.departmentId);
    clauses.push(`${table}.approval_dept_id=?`);
    params.push(scope.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM mdm_mapping_related_departments mrd
      WHERE mrd.mapping_id=${table}.id AND mrd.department_id=?
    )`);
    params.push(scope.departmentId);
    clauses.push(`EXISTS (
      SELECT 1 FROM mdm_mapping_approval_tasks at
      WHERE at.mapping_id=${table}.id AND (COALESCE(at.assignee_person_id, at.assignee_user_id)=? OR at.assigned_dept_id=?)
    )`);
    params.push(scopedPersonId, scope.departmentId);
  } else {
    clauses.push(`EXISTS (
      SELECT 1 FROM mdm_mapping_approval_tasks at
      WHERE at.mapping_id=${table}.id AND COALESCE(at.assignee_person_id, at.assignee_user_id)=?
    )`);
    params.push(scopedPersonId);
  }
  return { sql: ` AND (${clauses.join(' OR ')})`, params };
}

const MAPPING_SELECT = `
  SELECT m.*,
         m.process_mapping_record_id AS process_id,
         r.l3_name AS process_name,
         '流程治理读模型' AS cap_name,
         d.name AS owner_dept_name,
         COALESCE((
           SELECT GROUP_CONCAT(ms.system_name ORDER BY ms.sort_order SEPARATOR ', ')
           FROM mdm_mapping_system_links ms
           WHERE ms.mapping_id = m.id
         ), '') AS systems
  FROM mdm_mapping_records m
  LEFT JOIN process_mapping_records r ON r.id = m.process_mapping_record_id
  LEFT JOIN departments d ON d.id = m.owner_dept_id
`;

function publicMapping(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    process_id: Number(row.process_id || row.process_mapping_record_id || 0),
    process_mapping_record_id: Number(row.process_mapping_record_id || row.process_id || 0),
    owner_dept_id: row.owner_dept_id ? Number(row.owner_dept_id) : null,
    approval_dept_id: row.approval_dept_id ? Number(row.approval_dept_id) : null,
    submitted_by: row.submitted_by ? Number(row.submitted_by) : null,
    submitted_by_person_id: row.submitted_by_person_id ? Number(row.submitted_by_person_id) : null,
    current_step: Number(row.current_step || 1)
  };
}

function resultError(statusCode, error) {
  return { ok: false, statusCode, error };
}

function canUseTask(task, payload = {}) {
  if (!task) return false;
  if (payload.canManageAll) return true;
  const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
  const assigneePersonId = task.assignee_person_id || task.assignee_user_id;
  if (assigneePersonId && Number(assigneePersonId) === Number(actorPersonId)) return true;
  if (task.assigned_dept_id && Number(task.assigned_dept_id) === Number(payload.actor_dept_id)) return true;
  return false;
}

function makeMappingMysqlRepository(pool) {
  async function replaceMappingRelations(mappingId, systems = [], relatedDepartments = []) {
    await pool.execute('DELETE FROM mdm_mapping_system_links WHERE mapping_id=?', [mappingId]);
    await pool.execute('DELETE FROM mdm_mapping_related_departments WHERE mapping_id=?', [mappingId]);

    for (const [index, rawSystem] of systems.entries()) {
      const system = normalizeSystem(rawSystem, index);
      await pool.execute(
        `INSERT INTO mdm_mapping_system_links
          (mapping_id, system_id, system_name, system_role, sort_order)
         VALUES (?, ?, ?, ?, ?)`,
        [mappingId, system.system_id, system.system_name, system.system_role, system.sort_order]
      );
    }

    for (const rawDepartment of relatedDepartments) {
      const department = normalizeRelatedDepartment(rawDepartment);
      if (!department.department_id) continue;
      await pool.execute(
        `INSERT INTO mdm_mapping_related_departments (mapping_id, department_id, relation)
         VALUES (?, ?, ?)`,
        [mappingId, department.department_id, department.relation]
      );
    }
  }

  async function insertHistory(mappingId, step, actorUserId, action, opinion = null, actorPersonId = actorUserId) {
    await pool.execute(
      `INSERT INTO mdm_mapping_approval_history
        (mapping_id, step, operator_user_id, operator_person_id, action, opinion)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [mappingId, Number(step), actorUserId || null, actorPersonId || null, action, opinion || null]
    );
  }

  async function getVisibleMapping(mappingId, scope = {}) {
    const scoped = scopeClause('m', scope);
    return publicMapping(await first(
      pool,
      `${MAPPING_SELECT}
       WHERE m.id=?${scoped.sql}
       LIMIT 1`,
      [mappingId, ...scoped.params]
    ));
  }

  async function getBaseMapping(mappingId) {
    return publicMapping(await first(
      pool,
      `${MAPPING_SELECT}
       WHERE m.id=?
       LIMIT 1`,
      [mappingId]
    ));
  }

  async function insertApprovalTask(mappingId, step, stepName, assigneeUserId, assignedDeptId, status, assigneePersonId = assigneeUserId) {
    await pool.execute(
      `INSERT INTO mdm_mapping_approval_tasks
        (mapping_id, step, step_name, assignee_user_id, assignee_person_id, assigned_dept_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [mappingId, Number(step), stepName, assigneeUserId || null, assigneePersonId || null, assignedDeptId || null, status]
    );
  }

  return {
    async initSchema() {
      for (const statement of mappingDomainSchemaStatements()) {
        await pool.execute(statement);
      }
    },

    async listMappings(filters = {}, scope = {}) {
      const params = [];
      const conditions = ['1=1'];
      const scoped = scopeClause('m', scope);
      if (scoped.sql) {
        conditions.push(scoped.sql.replace(/^ AND /, ''));
        params.push(...scoped.params);
      }
      if (filters.status) {
        conditions.push('m.status=?');
        params.push(filters.status);
      }
      if (filters.dept_id) {
        conditions.push('m.owner_dept_id=?');
        params.push(Number(filters.dept_id));
      }
      const result = await rows(
        pool,
        `${MAPPING_SELECT}
         WHERE ${conditions.join(' AND ')}
         ORDER BY m.created_at DESC, m.id DESC`,
        params
      );
      return result.map(publicMapping);
    },

    async getMapping(mappingId, scope = {}) {
      const mapping = await getVisibleMapping(mappingId, scope);
      if (!mapping) return null;
      const systems = await rows(
        pool,
        `SELECT *
         FROM mdm_mapping_system_links
         WHERE mapping_id=?
         ORDER BY sort_order, id`,
        [mappingId]
      );
      const relatedDepts = await rows(
        pool,
        `SELECT *
         FROM mdm_mapping_related_departments
         WHERE mapping_id=?
         ORDER BY id`,
        [mappingId]
      );
      const approvalTasks = await rows(
        pool,
        `SELECT *
         FROM mdm_mapping_approval_tasks
         WHERE mapping_id=?
         ORDER BY step, id`,
        [mappingId]
      );
      return { ...mapping, systems, fields: [], relatedDepts, approvalTasks };
    },

    async createMapping(payload = {}, actorUserId = null) {
      const normalized = normalizeMappingPayload(payload);
      const actorPersonId = personIdFromPayload(payload, actorUserId);
      const result = await pool.execute(
        `INSERT INTO mdm_mapping_records
          (process_mapping_record_id, description, approval_dept_id, owner_dept_id, status, submitted_by, submitted_by_person_id, current_step)
         VALUES (?, ?, ?, ?, 'draft', ?, ?, 1)`,
        [
          normalized.process_id,
          normalized.description,
          normalized.approval_dept_id,
          normalized.owner_dept_id,
          actorUserId || null,
          actorPersonId
        ]
      );
      const mappingId = insertId(result);
      await replaceMappingRelations(mappingId, normalized.systems, normalized.related_departments);
      await insertHistory(mappingId, 1, actorUserId, 'create', null, actorPersonId);
      return await this.getMapping(mappingId, { canViewAll: true });
    },

    async updateMapping(mappingId, payload = {}, actorUserId = null) {
      const existing = await getBaseMapping(mappingId);
      if (!existing) return null;
      if (existing.status !== 'draft') return resultError(400, '只能修改草稿状态');
      const normalized = normalizeMappingPayload(payload);
      const result = await pool.execute(
        `UPDATE mdm_mapping_records
         SET process_mapping_record_id=?,
             description=?,
             approval_dept_id=?,
             owner_dept_id=?,
             updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [
          normalized.process_id,
          normalized.description,
          normalized.approval_dept_id,
          normalized.owner_dept_id,
          mappingId
        ]
      );
      if (affectedRows(result) === 0) return null;
      await replaceMappingRelations(mappingId, normalized.systems, normalized.related_departments);
      await insertHistory(mappingId, 1, actorUserId, 'update');
      return await this.getMapping(mappingId, { canViewAll: true });
    },

    async deleteMapping(mappingId, actorUserId = null) {
      const existing = await getBaseMapping(mappingId);
      if (!existing) return { deleted: false, reason: 'missing' };
      if (existing.status !== 'draft') return { deleted: false, reason: 'status' };
      await insertHistory(mappingId, 1, actorUserId, 'delete');
      const result = await pool.execute('DELETE FROM mdm_mapping_records WHERE id=?', [mappingId]);
      return { deleted: affectedRows(result) > 0 };
    },

    async submitMapping(mappingId, actorUserId = null) {
      const mapping = await getBaseMapping(mappingId);
      const actorPersonId = actorUserId;
      if (!mapping || Number(mapping.submitted_by_person_id || mapping.submitted_by) !== Number(actorPersonId)) {
        return resultError(403, '无权限或映射不存在');
      }
      if (mapping.status !== 'draft') return resultError(400, '只能提交草稿状态');

      await pool.execute('DELETE FROM mdm_mapping_approval_tasks WHERE mapping_id=?', [mappingId]);
      await pool.execute(
        "UPDATE mdm_mapping_records SET status='submitted', submitted_at=CURRENT_TIMESTAMP, current_step=2, updated_at=CURRENT_TIMESTAMP WHERE id=?",
        [mappingId]
      );
      await insertHistory(mappingId, 1, actorUserId, 'submit', null, actorPersonId);
      await insertApprovalTask(mappingId, 2, '部门内审', null, mapping.owner_dept_id, 'in_progress');

      const relatedDepts = await rows(
        pool,
        `SELECT *
         FROM mdm_mapping_related_departments
         WHERE mapping_id=?
         ORDER BY id`,
        [mappingId]
      );
      if (relatedDepts.length === 0) {
        await insertApprovalTask(mappingId, 3, '跨部门确认', null, null, 'approved');
      } else {
        for (const department of relatedDepts) {
          await insertApprovalTask(mappingId, 3, '跨部门确认', null, department.department_id, 'pending');
        }
      }
      await insertApprovalTask(mappingId, 4, '字段台账确认', null, null, 'approved');
      await insertApprovalTask(mappingId, 5, '信息化项目组终审', null, null, 'pending');
      return { ok: true };
    },

    async reviewMapping(mappingId, payload = {}) {
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      const action = cleanText(payload.action);
      if (!['approve', 'reject'].includes(action)) return resultError(400, '不支持的审核操作');
      const step = Number(payload.step || 0);
      const tasks = await rows(
        pool,
        `SELECT *
         FROM mdm_mapping_approval_tasks
         WHERE mapping_id=? AND step=?
         ORDER BY id`,
        [mappingId, step]
      );
      const task = tasks.find(item => !['approved', 'rejected'].includes(item.status) && canUseTask(item, payload));
      if (!task) return resultError(400, '当前节点状态不允许审核，或您不是该节点审核人');

      const taskStatus = action === 'approve' ? 'approved' : 'rejected';
      await pool.execute(
        `UPDATE mdm_mapping_approval_tasks
         SET status=?,
             opinion=?,
             operated_by=?,
             operated_by_person_id=?,
             operated_at=CURRENT_TIMESTAMP
          WHERE id=?`,
        [taskStatus, nullableText(payload.opinion), payload.actor_user_id || null, actorPersonId, task.id]
      );
      await insertHistory(mappingId, step, payload.actor_user_id, action, payload.opinion, actorPersonId);

      if (action === 'reject') {
        await pool.execute(
          "UPDATE mdm_mapping_approval_tasks SET status='rejected' WHERE mapping_id=? AND status IN ('pending','in_progress','blocked')",
          [mappingId]
        );
        await pool.execute(
          'UPDATE mdm_mapping_records SET status=?, current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
          ['draft', 1, mappingId]
        );
        return { ok: true };
      }

      const remaining = tasks.filter(item => Number(item.id) !== Number(task.id) && item.status !== 'approved' && item.status !== 'rejected');
      if (remaining.length > 0) {
        return { ok: true, waiting: true };
      }

      if (step === 5) {
        await pool.execute(
          'UPDATE mdm_mapping_records SET status=?, current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
          ['published', 5, mappingId]
        );
        return { ok: true };
      }

      const status = mappingStatusAfterStep(step);
      await pool.execute(
        'UPDATE mdm_mapping_records SET status=?, current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        [status, step + 1, mappingId]
      );
      await pool.execute(
        "UPDATE mdm_mapping_approval_tasks SET status='in_progress' WHERE mapping_id=? AND step=? AND status='pending'",
        [mappingId, step + 1]
      );
      return { ok: true };
    },

    async publishMapping(mappingId, actorUserId = null) {
      const mapping = await getBaseMapping(mappingId);
      if (!mapping) return resultError(404, '映射不存在');
      if (mapping.status !== 'final_reviewed' && mapping.status !== 'published') {
        return resultError(409, '仅终审完成后可发布');
      }
      await pool.execute(
        'UPDATE mdm_mapping_records SET status=?, current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        ['published', 5, mappingId]
      );
      await insertHistory(mappingId, 5, actorUserId, 'publish', null, actorUserId);
      return { ok: true };
    },

    async rejectMapping(mappingId, payload = {}, actorUserId = null) {
      const actorPersonId = personIdFromPayload(payload, actorUserId);
      const mapping = await getBaseMapping(mappingId);
      if (!mapping) return resultError(404, '映射不存在');
      const rejections = Array.isArray(payload.rejections) ? payload.rejections : [];
      if (rejections.length === 0) {
        return resultError(422, '请至少标记一个字段的驳回原因');
      }
      for (const rejection of rejections) {
        const reason = cleanText(rejection.reason);
        if (!reason) return resultError(422, '请填写每个被标记驳回字段的原因');
        await pool.execute(
          `INSERT INTO mdm_mapping_rejection_reasons
            (mapping_id, field_entry_id, rejection_reason, rejected_by, rejected_by_person_id)
           VALUES (?, ?, ?, ?, ?)`,
          [mappingId, rejection.field_entry_id || null, reason, actorUserId || null, actorPersonId]
        );
      }
      await pool.execute(
        "UPDATE mdm_mapping_approval_tasks SET status='rejected', opinion=?, operated_by=?, operated_by_person_id=?, operated_at=CURRENT_TIMESTAMP WHERE mapping_id=? AND status IN ('pending','in_progress','blocked')",
        [nullableText(payload.opinion), actorUserId || null, actorPersonId, mappingId]
      );
      await insertHistory(mappingId, mapping.current_step || 1, actorUserId, 'reject', payload.opinion, actorPersonId);
      await pool.execute(
        'UPDATE mdm_mapping_records SET status=?, current_step=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
        ['draft', 1, mappingId]
      );
      return { ok: true };
    },

    async getRejectionDetails(mappingId, scope = {}) {
      const mapping = await getVisibleMapping(mappingId, scope);
      if (!mapping) return [];
      return await rows(
        pool,
        `SELECT rr.*,
                rr.rejection_reason AS reason,
                NULL AS field_name_cn,
                u.name AS rejected_by_name
         FROM mdm_mapping_rejection_reasons rr
         LEFT JOIN users u ON u.id = rr.rejected_by
         WHERE rr.mapping_id=?
         ORDER BY rr.created_at DESC, rr.id DESC`,
        [mappingId]
      );
    }
  };
}

async function mappingRepository() {
  if (mappingRepositoryFactory) return await mappingRepositoryFactory();
  if (!mappingRepoPromise) {
    mappingRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeMappingMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await mappingRepoPromise;
  } catch (error) {
    mappingRepoPromise = null;
    throw error;
  }
}

function setMappingRepositoryFactory(factory) {
  mappingRepositoryFactory = factory;
  mappingRepoPromise = null;
}

function resetMappingRepositoryFactory() {
  mappingRepositoryFactory = null;
  mappingRepoPromise = null;
}

module.exports = {
  makeMappingMysqlRepository,
  mappingRepository,
  resetMappingRepositoryFactory,
  setMappingRepositoryFactory
};
