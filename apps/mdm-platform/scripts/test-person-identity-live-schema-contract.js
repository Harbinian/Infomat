#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');

const repoRoot = path.resolve(__dirname, '..', '..', '..');

function parseLocalEnv(text) {
  const parsed = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const splitAt = trimmed.indexOf('=');
    if (splitAt <= 0) continue;
    parsed[trimmed.slice(0, splitAt).trim()] = trimmed.slice(splitAt + 1).trim();
  }
  return parsed;
}

function fixedMysqlEnv() {
  const config = JSON.parse(fs.readFileSync(path.join(repoRoot, 'scripts', 'infomat-services.config.json'), 'utf8'));
  const localEnvPath = path.join(repoRoot, 'scripts', 'infomat-services.local.env');
  const localEnv = fs.existsSync(localEnvPath) ? parseLocalEnv(fs.readFileSync(localEnvPath, 'utf8')) : {};
  const env = { ...process.env, ...localEnv };
  assert.ok(env.MYSQL_PASSWORD, 'Missing MYSQL_PASSWORD in scripts/infomat-services.local.env or current shell');
  return {
    MYSQL_HOST: config.mysql.host,
    MYSQL_PORT: String(config.mysql.port),
    MYSQL_USER: config.mysql.user,
    MYSQL_PASSWORD: env.MYSQL_PASSWORD,
    MYSQL_DATABASE: config.mysql.database,
    MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit)
  };
}

async function rows(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function first(pool, sql, params = []) {
  return (await rows(pool, sql, params))[0] || null;
}

async function main() {
  const env = fixedMysqlEnv();
  const pool = mysql.createPool(mysqlConfigFromEnv(env));
  try {
    const currentDepartmentColumn = await first(pool, "SHOW COLUMNS FROM person LIKE 'current_department_id'");
    assert.ok(currentDepartmentColumn, 'person.current_department_id is missing');

    const departmentIndex = await first(pool, "SHOW INDEX FROM person WHERE Key_name='idx_person_department'");
    assert.ok(departmentIndex, 'person idx_person_department is missing');

    const accountsTable = await first(pool, "SHOW TABLES LIKE 'user_accounts'");
    assert.ok(accountsTable, 'user_accounts table is missing');

    const accountLoginIndex = await first(pool, "SHOW INDEX FROM user_accounts WHERE Key_name='uq_user_accounts_login'");
    assert.ok(accountLoginIndex, 'user_accounts unique login index is missing');

    const personRolesTable = await first(pool, "SHOW TABLES LIKE 'person_roles'");
    assert.ok(personRolesTable, 'person_roles table is missing');

    const coverage = await first(pool, `
      SELECT
        (SELECT COUNT(*) FROM users) AS legacy_users,
        (SELECT COUNT(*)
         FROM users u
         JOIN person p ON p.employee_no=u.employee_no) AS migrated_persons,
        (SELECT COUNT(*)
         FROM users u
         JOIN person p ON p.employee_no=u.employee_no
         JOIN user_accounts ua ON ua.person_id=p.person_id AND ua.login_name=u.employee_no) AS migrated_accounts
    `);
    assert.equal(Number(coverage.migrated_persons), Number(coverage.legacy_users), 'legacy users are not fully covered by person');
    assert.equal(Number(coverage.migrated_accounts), Number(coverage.legacy_users), 'legacy users are not fully covered by user_accounts');

    console.log(JSON.stringify({
      mysql: redactMysqlConfig(mysqlConfigFromEnv(env)),
      schema: {
        personCurrentDepartment: true,
        personDepartmentIndex: true,
        userAccounts: true,
        personRoles: true
      },
      coverage
    }, null, 2));
    console.log('Person identity live schema contract passed');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
