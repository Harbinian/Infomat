const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('./mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('./mysqlSchema');

let conflictRepoPromise = null;
let conflictRepositoryFactory = null;

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

function conflictDomainSchemaStatements() {
  const allowed = [
    'schema_migrations',
    'departments',
    'users',
    'process_governance_snapshots',
    'process_mapping_records',
    'terminology_term_types',
    'terminology_terms',
    'data_map_objects',
    'data_map_contexts',
    'data_map_fields',
    'data_map_field_system_links',
    'data_map_field_identities',
    'mdm_field_conflicts',
    'mdm_term_conflicts',
    'mdm_conflict_assignments',
    'mdm_conflict_coordination_history',
    'mdm_todos',
    'mdm_todo_events'
  ];
  return splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
    const normalized = statement.replace(/\s+/g, ' ');
    return allowed.some(table => normalized.includes(`CREATE TABLE IF NOT EXISTS ${table} `));
  });
}

function addWorkingDays(startDate, days) {
  const d = new Date(startDate);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added += 1;
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function publicFieldConflict(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    conflict_type: 'field',
    field_entry_a_id: row.field_entry_a_id == null ? Number(row.field_id_a || 0) : Number(row.field_entry_a_id),
    field_entry_b_id: row.field_entry_b_id == null ? Number(row.field_id_b || 0) : Number(row.field_entry_b_id),
    field_id_a: row.field_id_a == null ? Number(row.field_entry_a_id || 0) : Number(row.field_id_a),
    field_id_b: row.field_id_b == null ? Number(row.field_entry_b_id || 0) : Number(row.field_id_b),
    dept_a: row.dept_a == null ? null : Number(row.dept_a),
    dept_b: row.dept_b == null ? null : Number(row.dept_b),
    escalated: row.escalated ? 1 : 0
  };
}

function publicTermConflict(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    conflict_type: 'term',
    dept_a: row.dept_a == null ? null : Number(row.dept_a),
    dept_b: row.dept_b == null ? null : Number(row.dept_b),
    escalated: row.escalated ? 1 : 0
  };
}

function resultError(statusCode, error) {
  return { ok: false, statusCode, error };
}

function filterClause(alias, filters = {}, scope = {}) {
  const params = [];
  const table = alias || 'c';
  const conditions = ['1=1'];
  if (filters.severity) {
    conditions.push(`${table}.severity=?`);
    params.push(filters.severity);
  }
  if (filters.status) {
    conditions.push(`${table}.status=?`);
    params.push(filters.status);
  } else if (!scope.canViewAll) {
    conditions.push(`${table}.status NOT IN ('archived','silenced')`);
  }
  return { sql: conditions.join(' AND '), params };
}

function conflictValueFromPair(pair = {}) {
  if (pair.conflict_field) {
    return {
      conflictField: pair.conflict_field,
      valueA: pair.value_a,
      valueB: pair.value_b,
      severity: pair.severity || 'warn'
    };
  }
  if (pair.authoritative_a && pair.authoritative_b && pair.authoritative_a !== pair.authoritative_b) {
    return {
      conflictField: 'authoritative_system',
      valueA: pair.authoritative_a,
      valueB: pair.authoritative_b,
      severity: 'error'
    };
  }
  if ((pair.definition_a || '') !== (pair.definition_b || '')) {
    return {
      conflictField: 'business_definition',
      valueA: pair.definition_a || '',
      valueB: pair.definition_b || '',
      severity: 'warn'
    };
  }
  if ((pair.data_type_a || '') !== (pair.data_type_b || '')) {
    return {
      conflictField: 'data_type',
      valueA: pair.data_type_a || '',
      valueB: pair.data_type_b || '',
      severity: 'warn'
    };
  }
  return null;
}

function personIdFromPayload(payload = {}, fallback = null) {
  return payload.actor_person_id || payload.actorPersonId || payload.person_id || payload.personId || fallback || null;
}

function assigneePersonIdFromPayload(payload = {}) {
  return payload.assignee_person_id || payload.assigneePersonId || payload.assignee_user_id || payload.assigneeUserId || null;
}

function makeConflictMysqlRepository(pool) {
  async function insertTodo(payload = {}, actorUserId = null) {
    const actorPersonId = personIdFromPayload(payload, actorUserId);
    const result = await pool.execute(
      `INSERT INTO mdm_todos
        (from_dept_id, to_dept_id, type, related_mapping_id, related_field_id, content, due_date, urgency, created_by, created_by_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        payload.from_dept_id || null,
        payload.to_dept_id || null,
        payload.type || 'conflict_resolution',
        payload.related_mapping_id || null,
        payload.related_field_id || null,
        payload.content || null,
        payload.due_date || null,
        payload.urgency || 'high',
        actorUserId || null,
        actorPersonId
      ]
    );
    const todoId = insertId(result);
    await pool.execute(
      `INSERT INTO mdm_todo_events (todo_id, event_type, actor_user_id, actor_person_id, note)
       VALUES (?, 'created', ?, ?, ?)`,
      [todoId, actorUserId || null, actorPersonId, payload.content || null]
    );
    return todoId;
  }

  async function getBaseConflict(conflictId, conflictType) {
    if (conflictType === 'term') {
      return publicTermConflict(await first(
        pool,
        `SELECT tc.*, 'term' AS conflict_type
         FROM mdm_term_conflicts tc
         WHERE tc.id=?
         LIMIT 1`,
        [conflictId]
      ));
    }
    return publicFieldConflict(await first(
      pool,
      `SELECT fc.*, fc.field_id_a AS field_entry_a_id, fc.field_id_b AS field_entry_b_id,
              'field' AS conflict_type,
              fa.field_name_cn AS field_name_a,
              fb.field_name_cn AS field_name_b,
              da.name AS dept_a_name,
              db.name AS dept_b_name
       FROM mdm_field_conflicts fc
       LEFT JOIN data_map_fields fa ON fc.field_id_a = fa.id
       LEFT JOIN data_map_fields fb ON fc.field_id_b = fb.id
       LEFT JOIN departments da ON fc.dept_a = da.id
       LEFT JOIN departments db ON fc.dept_b = db.id
       WHERE fc.id=?
       LIMIT 1`,
      [conflictId]
    ));
  }

  async function conflictAssignments(conflictId, conflictType) {
    return await rows(
      pool,
      `SELECT ca.*, COALESCE(p.person_name, u.name) AS assignee_name, COALESCE(ap.person_name, au.name) AS assigned_by_name
       FROM mdm_conflict_assignments ca
       LEFT JOIN person p ON p.person_id = COALESCE(ca.assignee_person_id, ca.assignee_user_id)
       LEFT JOIN users u ON u.id = ca.assignee_user_id
       LEFT JOIN person ap ON ap.person_id = COALESCE(ca.assigned_by_person_id, ca.assigned_by)
       LEFT JOIN users au ON au.id = ca.assigned_by
       WHERE ca.conflict_id=? AND ca.conflict_type=?
       ORDER BY ca.created_at DESC, ca.id DESC`,
      [conflictId, conflictType]
    );
  }

  async function coordinationHistory(conflictId, conflictType) {
    return await rows(
      pool,
      `SELECT cch.*, COALESCE(p.person_name, u.name) AS assignee_name
       FROM mdm_conflict_coordination_history cch
       LEFT JOIN person p ON p.person_id = COALESCE(cch.assignee_person_id, cch.assignee_user_id)
       LEFT JOIN users u ON u.id = cch.assignee_user_id
       WHERE cch.conflict_id=? AND cch.conflict_type=?
       ORDER BY cch.created_at DESC, cch.id DESC`,
      [conflictId, conflictType]
    );
  }

  async function createConflictTodoForDepartments(conflict, conflictType, actorUserId = null) {
    const deadline = conflict.deadline || addWorkingDays(new Date().toISOString().slice(0, 10), 3);
    const title = conflictType === 'term'
      ? `Term conflict: ${conflict.term || conflict.id}`
      : `Field conflict #${conflict.id}`;
    for (const deptId of [conflict.dept_a, conflict.dept_b].filter(Boolean)) {
      await insertTodo({
        from_dept_id: null,
        to_dept_id: deptId,
        type: 'conflict_resolution',
        content: `${title} coordination due ${deadline}`,
        due_date: deadline,
        urgency: 'high'
      }, actorUserId);
    }
  }

  async function conflictExists(pair, conflictField) {
    return Boolean(await first(
      pool,
      `SELECT id
       FROM mdm_field_conflicts
       WHERE field_id_a=? AND field_id_b=? AND conflict_field=? AND status IN ('pending','coordinating','silenced')
       LIMIT 1`,
      [pair.a_id, pair.b_id, conflictField]
    ));
  }

  async function termConflictExists(term, meaningA, meaningB) {
    return Boolean(await first(
      pool,
      `SELECT id
       FROM mdm_term_conflicts
       WHERE term=? AND dept_a_meaning=? AND dept_b_meaning=? AND status IN ('pending','coordinating','silenced')
       LIMIT 1`,
      [term, meaningA || null, meaningB || null]
    ));
  }

  return {
    async initSchema() {
      for (const statement of conflictDomainSchemaStatements()) {
        await pool.execute(statement);
      }
    },

    async listConflicts(filters = {}, scope = {}) {
      const type = filters.type || '';
      if (type === 'field') {
        const fieldFilter = filterClause('fc', filters, scope);
        return (await rows(
          pool,
          `SELECT fc.*, fc.field_id_a AS field_entry_a_id, fc.field_id_b AS field_entry_b_id,
                  'field' AS conflict_type,
                  fa.field_name_cn AS field_name_a,
                  fb.field_name_cn AS field_name_b
           FROM mdm_field_conflicts fc
           LEFT JOIN data_map_fields fa ON fc.field_id_a = fa.id
           LEFT JOIN data_map_fields fb ON fc.field_id_b = fb.id
           WHERE ${fieldFilter.sql}
           ORDER BY CASE fc.severity WHEN 'blocking' THEN 0 WHEN 'error' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'warn' THEN 4 ELSE 5 END,
                    fc.created_at DESC, fc.id DESC`,
          fieldFilter.params
        )).map(publicFieldConflict);
      }
      if (type === 'term') {
        const termFilter = filterClause('tc', filters, scope);
        return (await rows(
          pool,
          `SELECT tc.*, 'term' AS conflict_type
           FROM mdm_term_conflicts tc
           WHERE ${termFilter.sql}
           ORDER BY CASE tc.severity WHEN 'blocking' THEN 0 WHEN 'error' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 WHEN 'warn' THEN 4 ELSE 5 END,
                    tc.created_at DESC, tc.id DESC`,
          termFilter.params
        )).map(publicTermConflict);
      }
      const fieldRows = await this.listConflicts({ ...filters, type: 'field' }, scope);
      const termRows = await this.listConflicts({ ...filters, type: 'term' }, scope);
      return [...fieldRows, ...termRows].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    },

    async conflictStats(scope = {}) {
      const conflicts = await this.listConflicts({}, { ...scope, canViewAll: true });
      const byStatus = {};
      for (const conflict of conflicts) {
        byStatus[conflict.status] = (byStatus[conflict.status] || 0) + 1;
      }
      const thisMonth = new Date().toISOString().slice(0, 7);
      const resolvedThisMonth = conflicts.filter(row => row.status === 'resolved' && String(row.resolved_at || '').startsWith(thisMonth)).length;
      return {
        coordinating: byStatus.coordinating || 0,
        escalated: byStatus.escalated || 0,
        silenced: byStatus.silenced || 0,
        resolved: byStatus.resolved || 0,
        resolvedThisMonth,
        byStatus
      };
    },

    async getConflict(conflictId, conflictType = 'field', scope = {}) {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return null;
      if (!scope.canViewAll && !scope.status && ['archived', 'silenced'].includes(conflict.status)) return null;
      const assignments = await conflictAssignments(conflictId, conflictType);
      const history = await coordinationHistory(conflictId, conflictType);
      const submitted = new Set(history.map(row => Number(row.assignee_person_id || row.assignee_user_id)).filter(Boolean));
      const assigned = new Set(assignments.map(row => Number(row.assignee_person_id || row.assignee_user_id)).filter(Boolean));
      return {
        ...conflict,
        currentAssignee: assignments[0] || null,
        coordinationHistory: history,
        assignmentHistory: assignments,
        sideA: null,
        sideB: null,
        bothSubmitted: assigned.size > 0 && Array.from(assigned).every(id => submitted.has(id)),
        deadline: conflict.deadline || null,
        resolution_type: conflict.resolution_type || null
      };
    },

    async detectConflicts(filters = {}, actor = {}) {
      let detected = 0;
      const termRows = await rows(
        pool,
        `SELECT t.id, t.term, t.definition, t.scope, t.process_mapping_record_id,
                d.id AS process_owner_dept_id
         FROM terminology_terms t
         LEFT JOIN process_mapping_records r ON r.id = t.process_mapping_record_id
         LEFT JOIN departments d ON d.name = r.dept_name
         WHERE t.status='approved'`
      );
      for (let i = 0; i < termRows.length; i += 1) {
        for (let j = i + 1; j < termRows.length; j += 1) {
          const a = termRows[i];
          const b = termRows[j];
          const sameOrSimilar = a.term === b.term || (String(a.term || '').includes(String(b.term || '')) && String(a.term || '').length - String(b.term || '').length < 3);
          if (!sameOrSimilar) continue;
          if ((a.definition || '') === (b.definition || '') && (a.scope || '') === (b.scope || '')) continue;
          if (await termConflictExists(a.term, a.definition || null, b.definition || null)) continue;
          const severity = a.term === b.term && (a.definition || '') !== (b.definition || '') ? 'error' : 'warn';
          const status = severity === 'warn' ? 'silenced' : 'coordinating';
          const result = await pool.execute(
            `INSERT INTO mdm_term_conflicts
              (term, dept_a, dept_a_meaning, dept_b, dept_b_meaning, severity, status, resolution_type, term_a_id, term_b_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              a.term,
              a.process_owner_dept_id || null,
              a.definition || null,
              b.process_owner_dept_id || null,
              b.definition || null,
              severity,
              status,
              severity === 'warn' ? 'auto_silenced' : null,
              a.id,
              b.id
            ]
          );
          detected += 1;
          if (severity === 'error') {
            await createConflictTodoForDepartments({
              id: insertId(result),
              term: a.term,
              dept_a: a.process_owner_dept_id || null,
              dept_b: b.process_owner_dept_id || null
            }, 'term', actor.actor_user_id || null);
          }
        }
      }

      const fieldName = nullableText(filters.field_name_cn);
      const params = [];
      const where = [];
      if (fieldName) {
        where.push('a.field_name_cn=?');
        params.push(fieldName);
      }
      const fieldPairs = await rows(
        pool,
        `SELECT a.id AS a_id,
                b.id AS b_id,
                a.field_name_cn,
                a.field_name_en,
                a.business_definition AS definition_a,
                b.business_definition AS definition_b,
                a.data_type AS data_type_a,
                b.data_type AS data_type_b,
                ia.authoritative_system_name AS authoritative_a,
                ib.authoritative_system_name AS authoritative_b,
                a.submitted_by AS submitter_a,
                b.submitted_by AS submitter_b,
                ca.dept_id AS dept_a,
                cb.dept_id AS dept_b
         FROM data_map_fields a
         JOIN data_map_fields b
           ON a.id < b.id
          AND COALESCE(a.field_name_cn, '') = COALESCE(b.field_name_cn, '')
          AND COALESCE(a.field_name_en, '') = COALESCE(b.field_name_en, '')
         JOIN data_map_contexts ca ON ca.id = a.context_id
         JOIN data_map_contexts cb ON cb.id = b.context_id
         LEFT JOIN data_map_field_identities ia ON ia.field_id = a.id
         LEFT JOIN data_map_field_identities ib ON ib.field_id = b.id
         WHERE ca.id <> cb.id
           AND COALESCE(ca.dept_id, 0) <> COALESCE(cb.dept_id, 0)
           ${where.length ? `AND ${where.join(' AND ')}` : ''}`,
        params
      );
      for (const pair of fieldPairs) {
        const conflictValue = conflictValueFromPair(pair);
        if (!conflictValue || conflictValue.valueA === conflictValue.valueB) continue;
        if (await conflictExists(pair, conflictValue.conflictField)) continue;
        const status = conflictValue.severity === 'warn' ? 'silenced' : 'coordinating';
        const result = await pool.execute(
          `INSERT INTO mdm_field_conflicts
            (field_id_a, field_id_b, conflict_field, submitter_a, value_a, submitter_b, value_b,
             dept_a, dept_b, severity, status, resolution_type)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            pair.a_id,
            pair.b_id,
            conflictValue.conflictField,
            pair.submitter_a || null,
            conflictValue.valueA || null,
            pair.submitter_b || null,
            conflictValue.valueB || null,
            pair.dept_a || null,
            pair.dept_b || null,
            conflictValue.severity,
            status,
            conflictValue.severity === 'warn' ? 'auto_silenced' : null
          ]
        );
        detected += 1;
        if (conflictValue.severity === 'error') {
          await createConflictTodoForDepartments({
            id: insertId(result),
            dept_a: pair.dept_a || null,
            dept_b: pair.dept_b || null
          }, 'field', actor.actor_user_id || null);
        }
      }
      return { detected };
    },

    async assignConflict(conflictId, conflictType = 'field', payload = {}) {
      const assigneePersonId = assigneePersonIdFromPayload(payload);
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (!['pending', 'coordinating'].includes(conflict.status)) {
        return resultError(409, '仅待处理或协调中状态可指定责任人');
      }
      await pool.execute(
        `INSERT INTO mdm_conflict_assignments (conflict_id, conflict_type, assignee_user_id, assignee_person_id, assigned_by, assigned_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conflictId, conflictType, payload.assignee_user_id, assigneePersonId, payload.actor_user_id || null, actorPersonId]
      );
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='coordinating', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      await insertTodo({
        from_dept_id: payload.actor_dept_id || null,
        to_dept_id: payload.assignee_dept_id || null,
        type: 'conflict_resolution',
        related_field_id: conflictType === 'field' ? conflict.field_entry_a_id : null,
        content: conflictType === 'term' ? `Term conflict: ${conflict.term}` : `Field conflict #${conflict.id}`,
        urgency: 'high'
      }, payload.actor_user_id || null);
      return { ok: true };
    },

    async reassignConflict(conflictId, conflictType = 'field', payload = {}) {
      const assigneePersonId = assigneePersonIdFromPayload(payload);
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'coordinating') return resultError(409, '仅协调中状态可改派');
      await pool.execute(
        `INSERT INTO mdm_conflict_assignments (conflict_id, conflict_type, assignee_user_id, assignee_person_id, assigned_by, assigned_by_person_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conflictId, conflictType, payload.assignee_user_id, assigneePersonId, payload.actor_user_id || null, actorPersonId]
      );
      return { ok: true };
    },

    async submitCoordination(conflictId, conflictType = 'field', payload = {}) {
      const actorPersonId = personIdFromPayload(payload, payload.actor_user_id);
      if (!['A', 'B', 'compromise'].includes(payload.result)) return resultError(422, 'result 必须为 A, B, 或 compromise');
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'coordinating') return resultError(409, '仅协调中状态可提交协调结果');
      const assignments = await conflictAssignments(conflictId, conflictType);
      if (assignments.length > 0 && !payload.canManageAll && !assignments.some(row => Number(row.assignee_person_id || row.assignee_user_id) === Number(actorPersonId))) {
        return resultError(403, '仅已指派协调人可提交协调结果');
      }
      await pool.execute(
        `INSERT INTO mdm_conflict_coordination_history (conflict_id, conflict_type, assignee_user_id, assignee_person_id, result, note)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [conflictId, conflictType, payload.actor_user_id || null, actorPersonId, payload.result, payload.note || null]
      );
      return { ok: true };
    },

    async finalDecideConflict(conflictId, conflictType = 'field', payload = {}) {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (!['coordinating', 'escalated', 'resolved'].includes(conflict.status)) {
        return resultError(409, '仅协调中或已升级状态可终裁');
      }
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      const result = await pool.execute(
        `UPDATE ${table}
         SET status='resolved', resolution=?, resolved_by=?, resolved_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [nullableText(payload.resolution), payload.actor_user_id || null, conflictId]
      );
      if (affectedRows(result) === 0) return resultError(404, '冲突不存在');
      if (conflictType === 'field' && payload.adopted_value && conflict.conflict_field === 'authoritative_system') {
        for (const fieldId of [conflict.field_entry_a_id, conflict.field_entry_b_id].filter(Boolean)) {
          await pool.execute(
            `UPDATE data_map_field_identities
             SET authoritative_system_name=?, confirmed=1, confirmed_by=?, confirmed_at=CURRENT_TIMESTAMP, status='confirmed', updated_at=CURRENT_TIMESTAMP
             WHERE field_id=?`,
            [payload.adopted_value, payload.actor_user_id || null, fieldId]
          );
        }
      }
      return { ok: true };
    },

    async escalateConflict(conflictId, conflictType = 'field', payload = {}) {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'coordinating') return resultError(409, '仅协调中的冲突可升级');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='escalated', escalated=1, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      await insertTodo({
        from_dept_id: payload.actor_dept_id || null,
        to_dept_id: null,
        type: 'conflict_resolution',
        content: `Conflict #${conflictId} escalated for final decision`,
        urgency: 'high'
      }, payload.actor_user_id || null);
      return { ok: true };
    },

    async reopenConflict(conflictId, conflictType = 'field', payload = {}) {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'resolved') return resultError(409, '仅已解决状态可重开');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(
        `UPDATE ${table}
         SET status='pending', resolution=NULL, resolved_by=NULL, resolved_at=NULL, escalated=0, updated_at=CURRENT_TIMESTAMP
         WHERE id=?`,
        [conflictId]
      );
      return { ok: true };
    },

    async archiveConflict(conflictId, conflictType = 'field') {
      const conflict = await getBaseConflict(conflictId, conflictType);
      if (!conflict) return resultError(404, '冲突不存在');
      if (conflict.status !== 'resolved') return resultError(409, '仅已解决状态可归档');
      const table = conflictType === 'term' ? 'mdm_term_conflicts' : 'mdm_field_conflicts';
      await pool.execute(`UPDATE ${table} SET status='archived', updated_at=CURRENT_TIMESTAMP WHERE id=?`, [conflictId]);
      return { ok: true };
    },

    async resolveFieldConflict(conflictId, payload = {}) {
      return await this.finalDecideConflict(conflictId, 'field', payload);
    },

    async resolveTermConflict(conflictId, payload = {}) {
      return await this.finalDecideConflict(conflictId, 'term', payload);
    }
  };
}

async function conflictRepository() {
  if (conflictRepositoryFactory) return await conflictRepositoryFactory();
  if (!conflictRepoPromise) {
    conflictRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeConflictMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await conflictRepoPromise;
  } catch (error) {
    conflictRepoPromise = null;
    throw error;
  }
}

function setConflictRepositoryFactory(factory) {
  conflictRepositoryFactory = factory;
  conflictRepoPromise = null;
}

function resetConflictRepositoryFactory() {
  conflictRepositoryFactory = null;
  conflictRepoPromise = null;
}

module.exports = {
  makeConflictMysqlRepository,
  conflictRepository,
  setConflictRepositoryFactory,
  resetConflictRepositoryFactory
};
