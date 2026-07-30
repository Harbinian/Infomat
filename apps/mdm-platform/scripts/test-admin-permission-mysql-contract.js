#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const mysql = require('mysql2/promise');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');

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

async function main() {
  const env = fixedMysqlEnv();
  const pool = mysql.createPool(mysqlConfigFromEnv(env));
  try {
    const repo = makeIdentityMysqlRepository(pool);
    await repo.initSchema();

    const adminEmployeeNo = env.MDM_ADMIN_EMPLOYEE_NO || 'ADMIN001';
    const admin = await repo.getUserByEmployeeNo(adminEmployeeNo);
    assert.ok(admin, `${adminEmployeeNo} was not found`);
    assert.ok(admin.personId, `${adminEmployeeNo} did not resolve to person identity`);

    const roles = await repo.getUserRoleCodes(admin.personId, admin.role);
    const roleCodes = roles.map(role => role.code).sort();
    assert.ok(roleCodes.includes('admin'), `${adminEmployeeNo} lacks admin role`);

    const { permSet } = await repo.getUserEffectivePermissions(admin.personId);
    for (const permission of [
      'identity:read',
      'identity:manage-account',
      'identity:assign-role',
      'identity:read-audit',
      'governance:read-global'
    ]) {
      assert.ok(permSet.has(permission), `${adminEmployeeNo} lacks ${permission}`);
    }
    for (const forbidden of [
      '*:*',
      'admin:access',
      'governance:draft-department',
      'governance:review-department',
      'governance:record-department-decision',
      'governance:publish'
    ]) {
      assert.equal(permSet.has(forbidden), false, `${adminEmployeeNo} must not have ${forbidden}`);
    }
    assert.equal(admin.accountStatus, 'active', `${adminEmployeeNo} account is not active`);

    console.log(JSON.stringify({
      mysql: redactMysqlConfig(mysqlConfigFromEnv(env)),
      governanceModelVersion: ACCESS_MODEL_VERSION,
      admin: {
        employeeNo: adminEmployeeNo,
        personId: admin.personId,
        roleCodes,
        permissions: Array.from(permSet).sort()
      }
    }, null, 2));
    console.log('Fixed administrator permission MySQL contract passed');
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error.message || error);
  process.exit(1);
});
