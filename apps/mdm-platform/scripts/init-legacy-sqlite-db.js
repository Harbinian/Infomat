#!/usr/bin/env node
const path = require('path');

if (process.env.MDM_ALLOW_LEGACY_TEST_MODE !== '1') {
  console.error('LEGACY_ACCOUNT_SCRIPT_RETIRED：SQLite初始化仅允许在隔离测试模式使用。');
  process.exit(1);
}

const configuredDbPath = String(process.env.MDM_DB_PATH || '').trim();
const sharedDbPath = path.resolve(__dirname, '..', 'data', 'platform.db');
if (!configuredDbPath) {
  console.error('LEGACY_SQLITE_DB_PATH_REQUIRED：必须通过MDM_DB_PATH指定隔离SQLite数据库。');
  process.exit(1);
}
if (path.resolve(configuredDbPath) === sharedDbPath) {
  console.error('LEGACY_SQLITE_SHARED_DB_FORBIDDEN：不得写入共享data/platform.db。');
  process.exit(1);
}

const db = require('../server/db');
const { hashPassword } = require('../server/auth');

const adminEmployeeNo = String(process.env.MDM_ADMIN_EMPLOYEE_NO || '').trim();
const adminPassword = String(process.env.MDM_ADMIN_PASSWORD || '');
const adminName = String(process.env.MDM_ADMIN_NAME || '本地基线管理员').trim();

if (!adminEmployeeNo || !adminPassword) {
  console.error('LEGACY_SQLITE_ADMIN_ENV_REQUIRED：缺少MDM_ADMIN_EMPLOYEE_NO或MDM_ADMIN_PASSWORD。');
  process.exit(1);
}
if (adminPassword.length < 12) {
  console.error('MDM_ADMIN_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const existingAdmin = db.prepare('SELECT id FROM users WHERE employee_no=?').get(adminEmployeeNo);
if (!existingAdmin) {
  db.prepare(`
    INSERT INTO users (name, employee_no, department_id, post, role, password_hash)
    VALUES (?, ?, NULL, ?, ?, ?)
  `).run(adminName, adminEmployeeNo, '系统管理员', 'admin', hashPassword(adminPassword));
  console.log(`Legacy SQLite test admin created: ${adminEmployeeNo}`);
} else {
  console.log('Legacy SQLite test admin already exists');
}
