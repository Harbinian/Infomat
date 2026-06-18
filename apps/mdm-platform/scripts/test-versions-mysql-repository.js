const assert = require('assert');

const { makeAuditMysqlRepository } = require('../server/auditMysqlRepository');

function makeFakePool() {
  const state = {
    sql: [],
    nextChangeSetId: 10,
    nextVersionId: 30,
    changeSets: [],
    logs: [],
    users: [
      { id: 42, name: '审核人' },
      { id: 43, name: '字段负责人' }
    ]
  };

  function operatorName(userId) {
    const user = state.users.find(row => Number(row.id) === Number(userId));
    return user ? user.name : null;
  }

  function entityRows(collection, entityType, entityId) {
    return collection
      .filter(row => row.entity_type === entityType && Number(row.entity_id) === Number(entityId))
      .sort((a, b) => String(b.operated_at).localeCompare(String(a.operated_at)) || Number(b.id) - Number(a.id))
      .map(row => ({ ...row, operator_name: operatorName(row.operated_by) }));
  }

  return {
    state,
    async execute(sql, params = []) {
      const normalizedSql = sql.replace(/\s+/g, ' ').trim();
      state.sql.push(normalizedSql);

      if (normalizedSql.startsWith('CREATE TABLE') || normalizedSql.startsWith('CREATE INDEX')) {
        return [{ affectedRows: 0 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_change_sets')) {
        const row = {
          id: state.nextChangeSetId++,
          entity_type: params[0],
          entity_id: Number(params[1]),
          operated_by: params[2] == null ? null : Number(params[2]),
          description: params[3] || null,
          operated_at: params[4] || '2026-06-18 10:00:00'
        };
        state.changeSets.push(row);
        return [{ insertId: row.id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('INSERT INTO mdm_version_log')) {
        const row = {
          id: state.nextVersionId++,
          entity_type: params[0],
          entity_id: Number(params[1]),
          field_name: params[2] || null,
          old_value: params[3] || null,
          new_value: params[4] || null,
          operation: params[5],
          operated_by: params[6] == null ? null : Number(params[6]),
          change_set_id: params[7] == null ? null : Number(params[7]),
          operated_at: params[8] || '2026-06-18 10:01:00'
        };
        state.logs.push(row);
        return [{ insertId: row.id, affectedRows: 1 }, undefined];
      }

      if (normalizedSql.includes('FROM mdm_change_sets')) {
        return [entityRows(state.changeSets, params[0], params[1]), undefined];
      }

      if (normalizedSql.includes('FROM mdm_version_log')) {
        return [entityRows(state.logs, params[0], params[1]), undefined];
      }

      throw new Error(`Unexpected SQL: ${normalizedSql}`);
    }
  };
}

async function main() {
  const pool = makeFakePool();
  const repo = makeAuditMysqlRepository(pool);
  await repo.initSchema();

  const changeSetId = await repo.createChangeSet({
    entity_type: 'mapping',
    entity_id: 100,
    operated_by: 42,
    description: '提交映射审批',
    operated_at: '2026-06-18 09:00:00'
  });
  assert.strictEqual(changeSetId, 10);

  const versionId = await repo.recordVersionLog({
    entity_type: 'mapping',
    entity_id: 100,
    field_name: 'status',
    old_value: 'draft',
    new_value: 'submitted',
    operation: 'update',
    operated_by: 42,
    change_set_id: changeSetId,
    operated_at: '2026-06-18 09:01:00'
  });
  assert.strictEqual(versionId, 30);

  await repo.recordVersionLog({
    entity_type: 'field_entry',
    entity_id: 101,
    field_name: 'business_definition',
    old_value: '旧定义',
    new_value: '新定义',
    operation: 'update',
    operated_by: 43,
    operated_at: '2026-06-18 09:02:00'
  });

  const entity = await repo.listEntityVersions('mapping', 100);
  assert.strictEqual(entity.changeSets.length, 1);
  assert.strictEqual(entity.changeSets[0].description, '提交映射审批');
  assert.strictEqual(entity.logs.length, 1);
  assert.strictEqual(entity.logs[0].operator_name, '审核人');

  const mappingLogs = await repo.listMappingVersions(100);
  assert.strictEqual(mappingLogs.length, 1);
  assert.strictEqual(mappingLogs[0].operation, 'update');

  const fieldLogs = await repo.listFieldVersions(101);
  assert.strictEqual(fieldLogs.length, 1);
  assert.strictEqual(fieldLogs[0].operator_name, '字段负责人');

  const sqlText = pool.state.sql.join('\n');
  assert.ok(!/\bFROM\s+change_set\b/i.test(sqlText), 'audit repository must not read SQLite change_set');
  assert.ok(!/\bINTO\s+change_set\b/i.test(sqlText), 'audit repository must not write SQLite change_set');
  assert.ok(!/\bFROM\s+version_log\b/i.test(sqlText), 'audit repository must not read SQLite version_log');
  assert.ok(!/\bINTO\s+version_log\b/i.test(sqlText), 'audit repository must not write SQLite version_log');

  console.log('Versions MySQL repository test passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
