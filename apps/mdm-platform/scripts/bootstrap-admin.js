#!/usr/bin/env node
const mysql = require('mysql2/promise');
const { hashPassword } = require('../server/auth');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { mysqlConfigFromEnv, redactMysqlConfig } = require('../server/mysqlConfig');
const {
  ACCESS_MODEL_VERSION,
  assertActiveAdmin,
  seedFixedAccessModel
} = require('../server/rbacRaciMysqlMigration');

function requiredEnvironment(env = process.env) {
  const values = {
    employeeNo: String(env.MDM_ADMIN_EMPLOYEE_NO || '').trim(),
    loginName: String(env.MDM_ADMIN_LOGIN_NAME || env.MDM_ADMIN_EMPLOYEE_NO || '').trim(),
    personName: String(env.MDM_ADMIN_NAME || '').trim(),
    password: String(env.MDM_ADMIN_PASSWORD || ''),
    departmentCode: String(env.MDM_ADMIN_DEPARTMENT_CODE || '').trim()
  };
  const missing = Object.entries({
    MDM_ADMIN_EMPLOYEE_NO: values.employeeNo,
    MDM_ADMIN_NAME: values.personName,
    MDM_ADMIN_PASSWORD: values.password,
    MDM_ADMIN_DEPARTMENT_CODE: values.departmentCode
  }).filter(([, value]) => !value).map(([key]) => key);
  if (missing.length) throw new Error(`缺少受控管理员初始化参数：${missing.join(', ')}`);
  if (values.password.length < 12) throw new Error('MDM_ADMIN_PASSWORD至少需要12个字符');
  return values;
}

async function first(executor, sql, params = []) {
  const [rows] = await executor.execute(sql, params);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function bootstrapAdmin(pool, env = process.env) {
  const values = requiredEnvironment(env);
  for (const statement of splitSqlStatements(mdmMysqlSchemaSql())) {
    await pool.execute(statement);
  }
  await seedFixedAccessModel(pool);

  const existingAdmin = await first(pool, `
    SELECT p.person_id
    FROM person p
    JOIN user_accounts ua ON ua.person_id=p.person_id
    JOIN person_roles pr ON pr.person_id=p.person_id
    JOIN roles r ON r.role_id=pr.role_id
    WHERE p.status='active' AND ua.account_status='active'
      AND r.role_code='admin' AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
    LIMIT 1
  `, [ACCESS_MODEL_VERSION]);
  if (existingAdmin) {
    const error = new Error('已存在有效管理员，受控初始化已关闭');
    error.code = 'BOOTSTRAP_ALREADY_COMPLETED';
    throw error;
  }

  const counts = await first(pool, `
    SELECT
      (SELECT COUNT(*) FROM person) AS person_count,
      (SELECT COUNT(*) FROM user_accounts) AS account_count,
      (SELECT COUNT(*) FROM person_roles) AS assignment_count
  `);
  if (
    Number(counts && counts.person_count || 0) > 0 ||
    Number(counts && counts.account_count || 0) > 0 ||
    Number(counts && counts.assignment_count || 0) > 0
  ) {
    const error = new Error('身份库非空，不能执行管理员初始化；请使用迁移或恢复流程');
    error.code = 'BOOTSTRAP_REQUIRES_EMPTY_IDENTITY_DATABASE';
    throw error;
  }

  const department = await first(pool, `
    SELECT id, name
    FROM departments
    WHERE code=? AND status='active'
  `, [values.departmentCode]);
  if (!department) {
    const error = new Error('管理员所属部门不存在或未启用');
    error.code = 'ADMIN_DEPARTMENT_NOT_FOUND';
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [personResult] = await connection.execute(`
      INSERT INTO person (
        employee_no, person_name, current_department_id,
        employment_status, status
      )
      VALUES (?, ?, ?, 'active', 'active')
    `, [values.employeeNo, values.personName, department.id]);
    const personId = Number(personResult.insertId);
    const [accountResult] = await connection.execute(`
      INSERT INTO user_accounts (
        person_id, login_name, password_hash, must_change_password,
        account_status, auth_version
      )
      VALUES (?, ?, ?, 1, 'active', 1)
    `, [personId, values.loginName, hashPassword(values.password)]);
    const accountId = Number(accountResult.insertId);
    const role = await first(connection, `
      SELECT role_id FROM roles
      WHERE role_code='admin' AND status='active' AND model_version=?
    `, [ACCESS_MODEL_VERSION]);
    await connection.execute(`
      INSERT INTO person_roles (
        person_id, role_id, scope_type, authorization_basis,
        effective_from, assignment_status, assigned_by_person_id
      )
      VALUES (?, ?, 'global', ?, CURRENT_DATE, 'active', ?)
    `, [personId, role.role_id, '空身份库受控管理员初始化', personId]);
    await connection.execute(`
      INSERT INTO identity_access_events (
        event_type, actor_person_id, target_person_id, account_id, reason,
        payload_json
      )
      VALUES ('account_activated', ?, ?, ?, ?, ?)
    `, [
      personId,
      personId,
      accountId,
      '空身份库受控管理员初始化',
      JSON.stringify({ modelVersion: ACCESS_MODEL_VERSION, departmentId: Number(department.id) })
    ]);
    await connection.commit();
    await assertActiveAdmin(pool);
    return {
      personId,
      accountId,
      employeeNo: values.employeeNo,
      loginName: values.loginName,
      departmentId: Number(department.id),
      departmentName: department.name,
      modelVersion: ACCESS_MODEL_VERSION,
      mustChangePassword: true
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const config = mysqlConfigFromEnv();
  const pool = mysql.createPool(config);
  try {
    const result = await bootstrapAdmin(pool);
    console.log(JSON.stringify({
      database: redactMysqlConfig(config),
      result
    }, null, 2));
  } finally {
    await pool.end();
  }
}

module.exports = { bootstrapAdmin, requiredEnvironment };

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      error: error.message,
      code: error.code || 'ADMIN_BOOTSTRAP_FAILED'
    }, null, 2));
    process.exit(1);
  });
}
