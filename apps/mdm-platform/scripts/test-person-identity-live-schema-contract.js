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

    for (const [tableName, columnName] of [
      ['departments', 'final_responsible_person_id'],
      ['user_accounts', 'auth_version'],
      ['user_accounts', 'must_change_password'],
      ['roles', 'status'],
      ['roles', 'role_group'],
      ['roles', 'model_version'],
      ['roles', 'is_core'],
      ['person_roles', 'scope_type'],
      ['person_roles', 'scope_department_id'],
      ['person_roles', 'authorization_basis'],
      ['person_roles', 'effective_from'],
      ['person_roles', 'effective_to'],
      ['person_roles', 'assignment_status'],
      ['person_roles', 'revocation_reason']
    ]) {
      assert.ok(
        await first(
          pool,
          'SELECT 1 AS found FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?',
          [tableName, columnName]
        ),
        `${tableName}.${columnName} is missing`
      );
    }

    for (const tableName of [
      'identity_access_events',
      'governance_decision_records',
      'identity_migration_batches',
      'identity_migration_account_backup',
      'identity_migration_role_backup'
    ]) {
      assert.ok(
        await first(pool, 'SELECT 1 AS found FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=?', [tableName]),
        `${tableName} table is missing`
      );
    }

    const coverage = await first(pool, `
      SELECT
        (SELECT COUNT(*) FROM person) AS persons,
        (SELECT COUNT(*) FROM user_accounts) AS accounts,
        (SELECT COUNT(*)
         FROM user_accounts ua
         LEFT JOIN person p ON p.person_id=ua.person_id
         WHERE p.person_id IS NULL) AS orphan_accounts,
        (SELECT COUNT(*)
         FROM person_roles pr
         LEFT JOIN person p ON p.person_id=pr.person_id
         LEFT JOIN roles r ON r.role_id=pr.role_id
         WHERE p.person_id IS NULL OR r.role_id IS NULL) AS orphan_role_assignments
    `);
    assert.ok(Number(coverage.persons) > 0, 'person table is empty');
    assert.ok(Number(coverage.accounts) > 0, 'user_accounts table is empty');
    assert.equal(Number(coverage.orphan_accounts), 0, 'user_accounts contains orphan person references');
    assert.equal(Number(coverage.orphan_role_assignments), 0, 'person_roles contains orphan references');

    console.log(JSON.stringify({
      mysql: redactMysqlConfig(mysqlConfigFromEnv(env)),
      schema: {
        personCurrentDepartment: true,
        personDepartmentIndex: true,
        userAccounts: true,
        personRoles: true,
        fixedRbacRaci: true,
        responsibilityEvidence: true
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
