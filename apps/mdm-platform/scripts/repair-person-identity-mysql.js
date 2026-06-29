#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');

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
    MYSQL_CONNECTION_LIMIT: String(config.mysql.connectionLimit),
    MDM_ADMIN_EMPLOYEE_NO: config.admin.employeeNo
  };
}

async function single(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}

async function main() {
  const env = fixedMysqlEnv();
  const pool = mysql.createPool(mysqlConfigFromEnv(env));
  try {
    const repo = makeIdentityMysqlRepository(pool);
    await repo.initSchema();

    const coverage = await single(pool, `
      SELECT
        (SELECT COUNT(*) FROM users) AS legacy_users,
        (SELECT COUNT(*)
         FROM users u
         JOIN person p ON p.employee_no=u.employee_no) AS migrated_persons,
        (SELECT COUNT(*)
         FROM users u
         JOIN person p ON p.employee_no=u.employee_no
         JOIN user_accounts ua ON ua.person_id=p.person_id AND ua.login_name=u.employee_no) AS migrated_accounts,
        (SELECT COUNT(*)
         FROM user_roles ur
         JOIN users u ON u.id=ur.user_id
         JOIN person p ON p.employee_no=u.employee_no
         JOIN person_roles pr ON pr.person_id=p.person_id AND pr.role_id=ur.role_id) AS migrated_role_links,
        (SELECT COUNT(*) FROM user_roles) AS legacy_role_links
    `);

    assert.equal(Number(coverage.migrated_persons), Number(coverage.legacy_users), 'Not every legacy user has a person identity');
    assert.equal(Number(coverage.migrated_accounts), Number(coverage.legacy_users), 'Not every legacy user has a login account');
    assert.equal(Number(coverage.migrated_role_links), Number(coverage.legacy_role_links), 'Not every legacy role assignment is mirrored to person_roles');

    const adminEmployeeNo = env.MDM_ADMIN_EMPLOYEE_NO || 'ADMIN001';
    const admin = await repo.getUserByEmployeeNo(adminEmployeeNo);
    assert.ok(admin && admin.personId, `${adminEmployeeNo} was not migrated to person identity`);
    const adminRoles = await repo.getUserRoleCodes(admin.personId, admin.role);
    assert.ok(adminRoles.some(role => role.code === 'admin'), `${adminEmployeeNo} does not have admin in person_roles`);
    const { permSet } = await repo.getUserEffectivePermissions(admin.personId);
    assert.ok(permSet.has('admin:access'), `${adminEmployeeNo} lacks admin:access`);
    assert.ok(permSet.has('*:*'), `${adminEmployeeNo} lacks *:*`);

    console.log(JSON.stringify({
      mysql: redactMysqlConfig(mysqlConfigFromEnv(env)),
      coverage,
      admin: {
        employeeNo: adminEmployeeNo,
        personId: admin.personId,
        roles: adminRoles.map(role => role.code).sort(),
        hasAdminAccess: true,
        hasWildcard: true
      }
    }, null, 2));
    console.log('Person identity MySQL repair passed');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
