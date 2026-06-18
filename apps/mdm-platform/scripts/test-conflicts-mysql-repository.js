const assert = require('assert');

const { makeConflictMysqlRepository } = require('../server/conflictMysqlRepository');

async function main() {
  const pool = {
    state: {
      statements: [],
      nextId: 1,
      fieldConflicts: [],
      termConflicts: [],
      assignments: [],
      history: [],
      todos: []
    },
    async execute(sql, params = []) {
      this.state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('FROM terminology_terms')) {
        return [[
          { id: 1, term: 'customer', definition: 'sales customer', scope: 'sales', process_owner_dept_id: 9 },
          { id: 2, term: 'customer', definition: 'billing customer', scope: 'finance', process_owner_dept_id: 10 }
        ], undefined];
      }

      if (normalizedSql.includes('FROM data_map_fields a')) {
        return [[
          {
            a_id: 101,
            b_id: 102,
            field_name_cn: 'customer_code',
            field_name_en: 'customer_code',
            value_a: 'CRM',
            value_b: 'ERP',
            submitter_a: 42,
            submitter_b: 43,
            dept_a: 9,
            dept_b: 10,
            conflict_field: 'authoritative_system',
            severity: 'error'
          }
        ], undefined];
      }

      if (normalizedSql.includes('FROM mdm_field_conflicts') && normalizedSql.includes('WHERE field_entry_a_id=?')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('FROM mdm_term_conflicts') && normalizedSql.includes('WHERE term=?')) {
        return [[], undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_field_conflicts')) {
        const id = this.state.nextId++;
        this.state.fieldConflicts.push({
          id,
          field_entry_a_id: params[0],
          field_entry_b_id: params[1],
          conflict_field: params[2],
          submitter_a: params[3],
          value_a: params[4],
          submitter_b: params[5],
          value_b: params[6],
          dept_a: params[7],
          dept_b: params[8],
          severity: params[9],
          status: params[10],
          resolution_type: params[11] || null,
          conflict_type: 'field'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_term_conflicts')) {
        const id = this.state.nextId++;
        this.state.termConflicts.push({
          id,
          term: params[0],
          dept_a: params[1],
          dept_a_meaning: params[2],
          dept_b: params[3],
          dept_b_meaning: params[4],
          severity: params[5],
          status: params[6],
          resolution_type: params[7] || null,
          conflict_type: 'term'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_conflict_assignments')) {
        this.state.assignments.push({
          id: this.state.nextId++,
          conflict_id: Number(params[0]),
          conflict_type: params[1],
          assignee_user_id: Number(params[2]),
          assigned_by: params[3] == null ? null : Number(params[3])
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_conflict_coordination_history')) {
        this.state.history.push({
          id: this.state.nextId++,
          conflict_id: Number(params[0]),
          conflict_type: params[1],
          assignee_user_id: Number(params[2]),
          result: params[3],
          note: params[4]
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_todos')) {
        const id = this.state.nextId++;
        this.state.todos.push({
          id,
          from_dept_id: params[0],
          to_dept_id: params[1],
          type: params[2],
          content: params[5] || params[3],
          urgency: params[7] || params[4] || 'medium'
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_todo_events')) {
        return [{ insertId: this.state.nextId++, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM mdm_conflict_assignments')) {
        return [this.state.assignments.filter(row => Number(row.conflict_id) === Number(params[0]) && row.conflict_type === params[1]), undefined];
      }

      if (normalizedSql.includes('FROM mdm_conflict_coordination_history')) {
        return [this.state.history.filter(row => Number(row.conflict_id) === Number(params[0]) && row.conflict_type === params[1]), undefined];
      }

      if (normalizedSql.includes('FROM mdm_field_conflicts') && normalizedSql.includes('WHERE fc.id=?')) {
        return [[this.state.fieldConflicts.find(row => Number(row.id) === Number(params[0]))].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM mdm_term_conflicts') && normalizedSql.includes('WHERE tc.id=?')) {
        return [[this.state.termConflicts.find(row => Number(row.id) === Number(params[0]))].filter(Boolean), undefined];
      }

      if (normalizedSql.includes('FROM mdm_field_conflicts')) {
        return [this.state.fieldConflicts, undefined];
      }

      if (normalizedSql.includes('FROM mdm_term_conflicts')) {
        return [this.state.termConflicts, undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_field_conflicts')) {
        const id = Number(params[params.length - 1]);
        const conflict = this.state.fieldConflicts.find(row => Number(row.id) === id);
        if (conflict) {
          if (normalizedSql.includes("status='resolved'")) conflict.status = 'resolved';
          if (normalizedSql.includes("status='coordinating'")) conflict.status = 'coordinating';
          if (normalizedSql.includes("status='escalated'")) {
            conflict.status = 'escalated';
            conflict.escalated = 1;
          }
          if (normalizedSql.includes('resolution=?')) conflict.resolution = params[0];
        }
        return [{ affectedRows: conflict ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE data_map_field_identities')) {
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_term_conflicts')) {
        const id = Number(params[params.length - 1]);
        const conflict = this.state.termConflicts.find(row => Number(row.id) === id);
        if (conflict) {
          if (normalizedSql.includes("status='resolved'")) conflict.status = 'resolved';
          if (normalizedSql.includes("status='coordinating'")) conflict.status = 'coordinating';
          if (normalizedSql.includes("status='escalated'")) {
            conflict.status = 'escalated';
            conflict.escalated = 1;
          }
          if (normalizedSql.includes('resolution=?')) conflict.resolution = params[0];
        }
        return [{ affectedRows: conflict ? 1 : 0 }, undefined];
      }

      throw new Error(`Unhandled SQL in fake conflict pool: ${normalizedSql}`);
    }
  };

  const repo = makeConflictMysqlRepository(pool);
  await repo.initSchema();

  const detected = await repo.detectConflicts({ field_name_cn: 'customer_code' }, { actor_user_id: 42, actor_dept_id: 9 });
  assert.strictEqual(detected.detected, 2);

  const fieldConflicts = await repo.listConflicts({ type: 'field' }, { canViewAll: true });
  assert.strictEqual(fieldConflicts.length, 1);
  assert.strictEqual(fieldConflicts[0].conflict_field, 'authoritative_system');
  assert.strictEqual(fieldConflicts[0].value_a, 'CRM');
  assert.strictEqual(fieldConflicts[0].value_b, 'ERP');

  const termConflicts = await repo.listConflicts({ type: 'term' }, { canViewAll: true });
  assert.strictEqual(termConflicts.length, 1);
  assert.strictEqual(termConflicts[0].term, 'customer');

  const assigned = await repo.assignConflict(fieldConflicts[0].id, 'field', {
    assignee_user_id: 77,
    actor_user_id: 42,
    actor_dept_id: 9
  });
  assert.deepStrictEqual(assigned, { ok: true });
  assert.strictEqual(pool.state.assignments.length, 1);

  assert.deepStrictEqual(await repo.submitCoordination(fieldConflicts[0].id, 'field', {
    actor_user_id: 77,
    result: 'A',
    note: 'use side A'
  }), { ok: true });

  assert.deepStrictEqual(await repo.finalDecideConflict(fieldConflicts[0].id, 'field', {
    actor_user_id: 42,
    resolution: 'use MDM',
    adopted_value: 'MDM'
  }), { ok: true });

  assert.strictEqual((await repo.getConflict(fieldConflicts[0].id, 'field', { canViewAll: true })).status, 'resolved');

  const sqlText = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!/\bFROM\s+field_entries\b/i.test(sqlText), 'conflict repository must not query SQLite field_entries');
  assert.ok(!/\bFROM\s+field_identities\b/i.test(sqlText), 'conflict repository must not query SQLite field_identities');
  assert.ok(!/\bFROM\s+terms\b/i.test(sqlText), 'conflict repository must not query SQLite terms');
  assert.ok(!/\bFROM\s+todos\b/i.test(sqlText), 'conflict repository must not query SQLite todos');
  assert.ok(!/\bconflict_assignments\b(?!_)/i.test(sqlText), 'conflict repository must not use SQLite conflict_assignments');
  assert.ok(!/\bconflict_coordination_history\b(?!_)/i.test(sqlText), 'conflict repository must not use SQLite conflict_coordination_history');
  assert.ok(!sqlText.includes('sqlite_master'), 'conflict repository must not use SQLite catalog tables');
  assert.ok(!sqlText.includes('PRAGMA'), 'conflict repository must not use SQLite PRAGMA');
  assert.ok(!sqlText.includes('lastInsertRowid'), 'conflict repository must not use SQLite lastInsertRowid');

  console.log('Conflicts MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
