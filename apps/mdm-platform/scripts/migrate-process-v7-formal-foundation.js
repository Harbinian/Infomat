#!/usr/bin/env node
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { loadFixedMysqlEnvironment } = require('./lib/fixed-mysql-environment');
const {
  applyProcessV7FormalFoundation,
  inspectProcessV7FormalFoundation,
  rollbackProcessV7FormalFoundation
} = require('../server/processV7FormalMigration');

async function main() {
  const args = new Set(process.argv.slice(2));
  const config = mysqlConfigFromEnv(loadFixedMysqlEnvironment());
  const pool = mysql.createPool(config);
  try {
    if (args.has('--dry-run')) {
      console.log(JSON.stringify({
        mode: 'dry-run',
        database: redactMysqlConfig(config),
        ...(await inspectProcessV7FormalFoundation(pool))
      }, null, 2));
      return;
    }
    if (args.has('--apply')) {
      console.log(JSON.stringify({
        mode: 'apply',
        database: redactMysqlConfig(config),
        ...(await applyProcessV7FormalFoundation(pool))
      }, null, 2));
      return;
    }
    if (args.has('--rollback')) {
      console.log(JSON.stringify({
        mode: 'rollback',
        database: redactMysqlConfig(config),
        ...(await rollbackProcessV7FormalFoundation(pool))
      }, null, 2));
      return;
    }
    throw new Error('必须明确指定 --dry-run、--apply 或 --rollback');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    error: error.message || String(error),
    code: error.code || 'V7_FORMAL_MIGRATION_FAILED',
    manual_objects: error.manual_objects || undefined
  }, null, 2));
  process.exitCode = 1;
});
