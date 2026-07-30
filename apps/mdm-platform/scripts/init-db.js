#!/usr/bin/env node
const { bootstrapAdmin } = require('./bootstrap-admin');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv } = require('../server/mysqlConfig');

async function main() {
  const pool = mysql.createPool(mysqlConfigFromEnv());
  try {
    const result = await bootstrapAdmin(pool);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(`${error.code || 'ADMIN_BOOTSTRAP_FAILED'}: ${error.message}`);
    process.exit(1);
  });
}
