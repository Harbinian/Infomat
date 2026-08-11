'use strict';

const mysql = require('mysql2/promise');
const { configFromEnv } = require('../server/config');
const { checkSchema } = require('../server/schema');

async function main() {
  const employeeNo = String(process.env.COLLECTION_BOOTSTRAP_ADMIN_EMPLOYEE_NO || '').trim();
  if (!employeeNo) throw new Error('COLLECTION_BOOTSTRAP_ADMIN_EMPLOYEE_NO is required');
  const config = configFromEnv();
  const pool = mysql.createPool(config.mysql);
  try {
    const schema = await checkSchema(pool);
    if (!schema.migrationApplied || schema.missingTables.length) throw new Error('Run migrate:apply before bootstrap:admin');
    const [[person]] = await pool.execute(
      `SELECT p.person_id, p.employee_no, p.person_name
         FROM person p JOIN user_accounts a ON a.person_id=p.person_id
        WHERE p.employee_no=? AND p.status='active' AND p.employment_status='active' AND a.account_status='active'`,
      [employeeNo]
    );
    if (!person) throw new Error('The configured employee does not exist or does not have an active account');
    await pool.execute(
      `INSERT INTO collection_app_grants
        (person_id, role_code, scope_type, scope_department_id, scope_key, status, granted_by_person_id)
       VALUES (?, 'collection_admin', 'global', NULL, 'global', 'active', ?)
       ON DUPLICATE KEY UPDATE status='active', revoked_by_person_id=NULL, revoked_at=NULL`,
      [person.person_id, person.person_id]
    );
    console.log(JSON.stringify({ status: 'ok', employeeNo: person.employee_no, personName: person.person_name, roleCode: 'collection_admin' }));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`[information-collection] bootstrap failed: ${error.message}`);
  process.exit(1);
});
