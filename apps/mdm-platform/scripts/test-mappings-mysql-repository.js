const assert = require('assert');

const { makeMappingMysqlRepository } = require('../server/mappingMysqlRepository');

function makeFakePool() {
  const state = {
    statements: [],
    departments: [
      { id: 9, name: '经营发展部' },
      { id: 10, name: '财务部' }
    ],
    processRecords: [
      { id: 31, l3_name: '客户主数据维护', dept_name: '经营发展部', status: 'active', record_type: 'l3' }
    ],
    mappings: [],
    systems: [],
    relatedDepts: [],
    tasks: [],
    history: [],
    rejections: [],
    nextId: 1
  };

  function insertId() {
    const id = state.nextId;
    state.nextId += 1;
    return id;
  }

  function mappingRow(mapping) {
    const process = state.processRecords.find(item => item.id === mapping.process_mapping_record_id) || {};
    const dept = state.departments.find(item => item.id === mapping.owner_dept_id) || {};
    return {
      ...mapping,
      process_id: mapping.process_mapping_record_id,
      process_name: process.l3_name || null,
      cap_name: '流程治理读模型',
      owner_dept_name: dept.name || null,
      systems: state.systems
        .filter(system => system.mapping_id === mapping.id)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map(system => system.system_name)
        .filter(Boolean)
        .join(', ')
    };
  }

  return {
    state,
    async execute(sql, params = []) {
      state.statements.push({ sql, params });
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();

      if (normalizedSql.startsWith('CREATE TABLE')) return [[], undefined];

      if (normalizedSql.includes('INSERT INTO mdm_mapping_records')) {
        const id = insertId();
        state.mappings.push({
          id,
          process_mapping_record_id: Number(params[0]),
          description: params[1],
          approval_dept_id: params[2],
          owner_dept_id: Number(params[3]),
          status: 'draft',
          submitted_by: Number(params[4]),
          submitted_by_person_id: Number(params[5]),
          current_step: 1
        });
        return [{ insertId: id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM mdm_mapping_system_links')) {
        state.systems = state.systems.filter(item => item.mapping_id !== Number(params[0]));
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM mdm_mapping_related_departments')) {
        state.relatedDepts = state.relatedDepts.filter(item => item.mapping_id !== Number(params[0]));
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_mapping_system_links')) {
        state.systems.push({
          id: insertId(),
          mapping_id: Number(params[0]),
          system_id: params[1],
          system_name: params[2],
          system_role: params[3],
          sort_order: Number(params[4])
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_mapping_related_departments')) {
        state.relatedDepts.push({
          id: insertId(),
          mapping_id: Number(params[0]),
          department_id: Number(params[1]),
          relation: params[2]
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_mapping_approval_history')) {
        state.history.push({
          id: insertId(),
          mapping_id: Number(params[0]),
          step: Number(params[1]),
          operator_user_id: Number(params[2]),
          operator_person_id: Number(params[3]),
          action: params[4],
          opinion: params[5]
        });
        return [{ insertId: state.history[state.history.length - 1].id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_records m') && normalizedSql.includes('WHERE m.id=?')) {
        const mapping = state.mappings.find(item => item.id === Number(params[0]));
        return [[mapping].filter(Boolean).map(mappingRow), undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_records m')) {
        let mappings = state.mappings.slice();
        if (normalizedSql.includes('m.status=?')) {
          const status = params.find(value => ['draft', 'submitted', 'dept_reviewed', 'cross_confirmed', 'fields_confirmed', 'final_reviewed', 'published'].includes(String(value)));
          mappings = mappings.filter(mapping => mapping.status === status);
        }
        return [mappings.map(mappingRow), undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_system_links')) {
        return [state.systems.filter(item => item.mapping_id === Number(params[0])).sort((a, b) => a.sort_order - b.sort_order), undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_related_departments')) {
        return [state.relatedDepts.filter(item => item.mapping_id === Number(params[0])), undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_approval_tasks')) {
        let tasks = state.tasks.filter(item => item.mapping_id === Number(params[0]));
        if (normalizedSql.includes('step=?')) tasks = tasks.filter(item => item.step === Number(params[1]));
        if (normalizedSql.includes('assignee_user_id=?')) tasks = tasks.filter(item => item.assignee_user_id === Number(params[2]));
        return [tasks.sort((a, b) => a.step - b.step || a.id - b.id), undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_mapping_records SET process_mapping_record_id=')) {
        const id = Number(params[params.length - 1]);
        const mapping = state.mappings.find(item => item.id === id);
        if (mapping) {
          mapping.process_mapping_record_id = Number(params[0]);
          mapping.description = params[1];
          mapping.approval_dept_id = params[2];
          mapping.owner_dept_id = Number(params[3]);
        }
        return [{ affectedRows: mapping ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM mdm_mapping_records')) {
        const before = state.mappings.length;
        state.mappings = state.mappings.filter(item => item.id !== Number(params[0]));
        return [{ affectedRows: before - state.mappings.length }, undefined];
      }

      if (normalizedSql.startsWith('DELETE FROM mdm_mapping_approval_tasks')) {
        state.tasks = state.tasks.filter(item => item.mapping_id !== Number(params[0]));
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_mapping_approval_tasks')) {
        state.tasks.push({
          id: insertId(),
          mapping_id: Number(params[0]),
          step: Number(params[1]),
          step_name: params[2],
          assignee_user_id: params[3] == null ? null : Number(params[3]),
          assignee_person_id: params[4] == null ? null : Number(params[4]),
          assigned_dept_id: params[5] == null ? null : Number(params[5]),
          status: params[6]
        });
        return [{ insertId: state.tasks[state.tasks.length - 1].id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith("UPDATE mdm_mapping_records SET status='submitted'")) {
        const mapping = state.mappings.find(item => item.id === Number(params[0]));
        if (mapping) {
          mapping.status = 'submitted';
          mapping.current_step = 2;
        }
        return [{ affectedRows: mapping ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_mapping_approval_tasks SET status=')) {
        if (normalizedSql.includes('WHERE mapping_id=?')) {
          const mappingId = Number(params[params.length - 1]);
          state.tasks
            .filter(item => item.mapping_id === mappingId && ['pending', 'in_progress', 'blocked'].includes(item.status))
            .forEach(task => {
              task.status = 'rejected';
              task.opinion = params[0];
              task.operated_by = params[1];
              task.operated_by_person_id = params[2];
            });
          return [{ affectedRows: 1 }, undefined];
        }
        const task = state.tasks.find(item => item.id === Number(params[4]));
        if (task) {
          task.status = params[0];
          task.opinion = params[1];
          task.operated_by = params[2];
          task.operated_by_person_id = params[3];
        }
        return [{ affectedRows: task ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_mapping_records SET status=?')) {
        const mapping = state.mappings.find(item => item.id === Number(params[2]));
        if (mapping) {
          mapping.status = params[0];
          mapping.current_step = Number(params[1]);
        }
        return [{ affectedRows: mapping ? 1 : 0 }, undefined];
      }

      if (normalizedSql.startsWith('UPDATE mdm_mapping_approval_tasks SET status=')) {
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_mapping_rejection_reasons')) {
        state.rejections.push({
          id: insertId(),
          mapping_id: Number(params[0]),
          field_entry_id: Number(params[1]),
          rejection_reason: params[2],
          rejected_by: Number(params[3]),
          rejected_by_person_id: Number(params[4])
        });
        return [{ affectedRows: 1 }, undefined];
      }

      if (normalizedSql.startsWith('SELECT') && normalizedSql.includes('FROM mdm_mapping_rejection_reasons')) {
        return [state.rejections.filter(item => item.mapping_id === Number(params[0])).map(item => ({
          ...item,
          reason: item.rejection_reason,
          field_name_cn: null,
          rejected_by_name: '映射管理员'
        })), undefined];
      }

      throw new Error(`Unhandled SQL in fake mapping pool: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeMappingMysqlRepository(pool);
  await repo.initSchema();

  const created = await repo.createMapping({
    process_id: 31,
    description: '客户主数据映射',
    approval_dept_id: 9,
    owner_dept_id: 9,
    systems: [{ system_name: 'MDM平台', system_role: 'primary' }],
    related_departments: [{ department_id: 10, relation: 'consumer' }]
  }, 42);
  assert.ok(created.id);
  assert.strictEqual(created.status, 'draft');

  const list = await repo.listMappings({ status: 'draft' }, { canViewAll: true });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].process_name, '客户主数据维护');

  const detail = await repo.getMapping(created.id, { canViewAll: true });
  assert.strictEqual(detail.systems[0].system_name, 'MDM平台');
  assert.strictEqual(detail.relatedDepts[0].department_id, 10);
  assert.deepStrictEqual(detail.fields, []);

  const updated = await repo.updateMapping(created.id, {
    process_id: 31,
    description: '客户主数据映射更新',
    approval_dept_id: 9,
    owner_dept_id: 9,
    systems: [{ system_name: 'ERP', system_role: 'secondary' }],
    related_departments: []
  }, 42);
  assert.strictEqual(updated.description, '客户主数据映射更新');
  assert.strictEqual((await repo.getMapping(created.id, { canViewAll: true })).systems[0].system_name, 'ERP');

  const submitted = await repo.submitMapping(created.id, 42);
  assert.deepStrictEqual(submitted, { ok: true });
  let submittedDetail = await repo.getMapping(created.id, { canViewAll: true });
  assert.strictEqual(submittedDetail.status, 'submitted');
  assert.ok(submittedDetail.approvalTasks.some(task => task.step === 2 && task.status === 'in_progress'));

  const reviewed = await repo.reviewMapping(created.id, { step: 2, action: 'approve', opinion: '通过', actor_user_id: 42, canManageAll: true });
  assert.deepStrictEqual(reviewed, { ok: true });

  await repo.reviewMapping(created.id, { step: 5, action: 'approve', opinion: '终审通过', actor_user_id: 42, canManageAll: true });
  assert.strictEqual((await repo.getMapping(created.id, { canViewAll: true })).status, 'final_reviewed');
  assert.deepStrictEqual(await repo.publishMapping(created.id, 42), { ok: true });
  assert.strictEqual((await repo.getMapping(created.id, { canViewAll: true })).status, 'published');

  const draft = await repo.createMapping({
    process_id: 31,
    description: '待删除映射',
    owner_dept_id: 9,
    systems: [],
    related_departments: []
  }, 42);
  const rejected = await repo.rejectMapping(draft.id, {
    opinion: '补充字段',
    rejections: [{ field_entry_id: 7, reason: '字段说明不足' }]
  }, 42);
  assert.deepStrictEqual(rejected, { ok: true });
  const rejectionDetails = await repo.getRejectionDetails(draft.id, { canViewAll: true });
  assert.strictEqual(rejectionDetails[0].reason, '字段说明不足');

  assert.deepStrictEqual(await repo.deleteMapping(draft.id, 42), { deleted: true });

  const sqlText = pool.state.statements.map(entry => entry.sql).join('\n');
  assert.ok(!/\bFROM\s+mappings\b/i.test(sqlText), 'mapping repository must not query SQLite mappings');
  assert.ok(!/\bINTO\s+mappings\b/i.test(sqlText), 'mapping repository must not insert SQLite mappings');
  assert.ok(!/\bFROM\s+field_entries\b/i.test(sqlText), 'mapping repository must not query SQLite field_entries');
  assert.ok(!/\bFROM\s+field_identities\b/i.test(sqlText), 'mapping repository must not query SQLite field_identities');
  assert.ok(!/\bFROM\s+terms\b/i.test(sqlText), 'mapping repository must not query SQLite terms');
  assert.ok(!/\bchange_set\b/i.test(sqlText), 'mapping repository must not use SQLite change_set');
  assert.ok(!/\bversion_log\b/i.test(sqlText), 'mapping repository must not use SQLite version_log');
  assert.ok(!sqlText.includes('sqlite_master'), 'mapping repository must not use SQLite catalog tables');
  assert.ok(!sqlText.includes('PRAGMA'), 'mapping repository must not use SQLite PRAGMA');
  assert.ok(!sqlText.includes('lastInsertRowid'), 'mapping repository must not use SQLite lastInsertRowid');

  console.log('Mappings MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
