'use strict';

const mysql = require('mysql2/promise');
const { configFromEnv, publicConfig } = require('../server/config');
const { CREATE_STATEMENTS, MIGRATION_KEY, applySchema, checkSchema, inspectCollectionBoundary, inspectIdentitySchema } = require('../server/schema');

async function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : process.argv.includes('--check') ? 'check' : 'dry-run';
  const config = configFromEnv();
  const pool = mysql.createPool(config.mysql);
  try {
    const identity = await inspectIdentitySchema(pool);
    const boundary = await inspectCollectionBoundary(pool);
    if (!identity.ok) throw new Error(`Identity schema is incompatible: ${identity.missing.join(', ')}`);
    if (mode === 'dry-run') {
      console.log(JSON.stringify({
        mode, target: publicConfig(config).mysql, identity, migrationKey: MIGRATION_KEY,
        existingTables: boundary.tables, unexpectedTables: boundary.unexpectedTables, safeToApply: boundary.safeToApply,
        plannedTables: CREATE_STATEMENTS.map(statement => statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)[1]),
        writesPerformed: false
      }, null, 2));
      if (!boundary.safeToApply) process.exitCode = 1;
      return;
    }
    if (mode === 'apply') await applySchema(pool);
    const status = await checkSchema(pool);
    console.log(JSON.stringify({ mode, target: publicConfig(config).mysql, ...status, writesPerformed: mode === 'apply' }, null, 2));
    if (!status.identity.ok || status.missingTables.length || status.unexpectedTables.length || !status.migrationApplied) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`[information-collection] migration failed: ${error.message}`);
  process.exit(1);
});
