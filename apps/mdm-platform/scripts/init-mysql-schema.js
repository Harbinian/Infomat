#!/usr/bin/env node
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { seedDefaultTerminologyTermTypes } = require('../server/terminologyMysqlRepository');
const { migrateLegacyIdentityToPersonIdentity } = require('../server/identityMysqlRepository');

async function main() {
  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
      await pool.execute(statement);
    }
    await migrateLegacyIdentityToPersonIdentity(pool);
    await seedDefaultTerminologyTermTypes(pool);
    for (const migrationKey of [
      '2026-06-16-process-candidate-review',
      '2026-06-16-process-governance-read-model',
      '2026-06-17-identity-rbac-read-model',
      '2026-06-18-data-map-field-domain',
      '2026-06-18-terminology-domain',
      '2026-06-18-mapping-approval-domain',
      '2026-06-18-conflict-todo-domain',
      '2026-06-18-version-activity-domain'
    ]) {
      await pool.execute(
        `INSERT INTO schema_migrations (migration_key)
         VALUES (?)
         ON DUPLICATE KEY UPDATE applied_at=CURRENT_TIMESTAMP`,
        [migrationKey],
      );
    }
    console.log(`mysql_schema_initialized=${JSON.stringify(redactMysqlConfig(config))}`);
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
