#!/usr/bin/env node
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const {
  ACCESS_MODEL_VERSION,
  applyRbacRaciV2Migration,
  collectRbacRaciPreflight,
  ensureRbacRaciV2Schema,
  rollbackRbacRaciV2Migration
} = require('../server/rbacRaciMysqlMigration');

function argumentValue(prefix) {
  const argument = process.argv.slice(2).find(item => item.startsWith(`${prefix}=`));
  return argument ? argument.slice(prefix.length + 1).trim() : '';
}

function migrationMode() {
  if (process.argv.includes('--apply')) return 'apply';
  if (process.argv.includes('--rollback') || argumentValue('--rollback')) return 'rollback';
  if (process.argv.includes('--compensate') || argumentValue('--compensate')) return 'compensate';
  return 'dry-run';
}

async function ensureMigrationTables(pool) {
  for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
    await pool.execute(statement);
  }
  await ensureRbacRaciV2Schema(pool);
}

async function main() {
  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  const mode = migrationMode();
  try {
    if (mode !== 'dry-run') {
      await ensureMigrationTables(pool);
    }
    let result;
    if (mode === 'apply') {
      result = await applyRbacRaciV2Migration(pool, {
        batchId: argumentValue('--batch-id') || undefined
      });
    } else if (mode === 'rollback' || mode === 'compensate') {
      const batchId = argumentValue(mode === 'rollback' ? '--rollback' : '--compensate') ||
        argumentValue('--batch-id');
      if (!batchId) {
        const error = new Error('回滚或补偿必须提供 --batch-id=<迁移批次>');
        error.code = 'MIGRATION_BATCH_ID_REQUIRED';
        throw error;
      }
      result = await rollbackRbacRaciV2Migration(pool, batchId, {
        allowCompensation: mode === 'compensate'
      });
    } else {
      result = await collectRbacRaciPreflight(pool);
    }
    console.log(JSON.stringify({
      mode,
      modelVersion: ACCESS_MODEL_VERSION,
      database: redactMysqlConfig(config),
      result
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message,
    code: error.code || 'RBAC_RACI_MIGRATION_FAILED',
    preflight: error.preflight || undefined
  }, null, 2));
  process.exit(1);
});
