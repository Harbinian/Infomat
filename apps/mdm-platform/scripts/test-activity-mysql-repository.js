const assert = require('assert');

const { makeAuditMysqlRepository } = require('../server/auditMysqlRepository');

function makeFakePool() {
  const state = { sql: [] };
  return {
    state,
    async execute(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      state.sql.push(normalizedSql);

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('CREATE INDEX')) {
        return [{ affectedRows: 0 }, undefined];
      }

      if (normalizedSql.includes('process_mapping_todo_events') && normalizedSql.includes('mdm_todos')) {
        return [[
          {
            activity_date: '2026-06-18',
            source_type: 'mapping_review',
            source_label: '映射提交/审核',
            actor_user_id: 42,
            actor_name: '审核人',
            employee_no: 'E042',
            department_id: 9,
            department_name: '经营发展部'
          },
          {
            activity_date: '2026-06-18',
            source_type: 'todo_done',
            source_label: '通用待办完成',
            actor_user_id: null,
            actor_name: null,
            employee_no: null,
            department_id: 10,
            department_name: '财务部'
          }
        ], undefined];
      }

      throw new Error(`Unexpected SQL: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeAuditMysqlRepository(pool);
  await repo.initSchema();

  const rows = await repo.listActivityRows({
    startDate: '2026-06-01',
    endDate: '2026-06-30'
  });

  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].sourceType, 'mapping_review');
  assert.strictEqual(rows[0].actorName, '审核人');
  assert.strictEqual(rows[1].sourceType, 'todo_done');
  assert.strictEqual(rows[1].departmentName, '财务部');

  const sqlText = pool.state.sql.join('\n');
  assert.ok(sqlText.includes('mdm_mapping_approval_history'), 'activity repository should read MySQL mapping approval history');
  assert.ok(sqlText.includes('mdm_version_log'), 'activity repository should read MySQL version log');
  assert.ok(sqlText.includes('terminology_terms'), 'activity repository should read MySQL terminology terms');
  assert.ok(sqlText.includes('mdm_term_conflicts'), 'activity repository should read MySQL term conflicts');
  assert.ok(sqlText.includes('mdm_field_conflicts'), 'activity repository should read MySQL field conflicts');
  assert.ok(sqlText.includes('mdm_todos'), 'activity repository should read MySQL todos');
  assert.ok(!/\bFROM\s+approval_history\b/i.test(sqlText), 'activity repository must not read SQLite approval_history');
  assert.ok(!/\bFROM\s+version_log\b/i.test(sqlText), 'activity repository must not read SQLite version_log');
  assert.ok(!/\bFROM\s+terms\b/i.test(sqlText), 'activity repository must not read SQLite terms');
  assert.ok(!/\bFROM\s+term_conflicts\b/i.test(sqlText), 'activity repository must not read SQLite term_conflicts');
  assert.ok(!/\bFROM\s+field_conflicts\b/i.test(sqlText), 'activity repository must not read SQLite field_conflicts');
  assert.ok(!/\bFROM\s+todos\b/i.test(sqlText), 'activity repository must not read SQLite todos');

  console.log('Activity MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
