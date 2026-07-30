const crypto = require('crypto');
const {
  ACCESS_MODEL_VERSION,
  ROLE_GUIDES
} = require('./roleDefinitions');

const MIGRATION_ADMIN_BASIS = 'RBAC/RACI v2迁移：保留唯一管理入口';
const LEGACY_REVOCATION_REASON = 'RBAC/RACI v2迁移：旧角色仅保留历史，不再产生有效权限';

async function rows(executor, sql, params = []) {
  const [result] = await executor.execute(sql, params);
  return Array.isArray(result) ? result : [];
}

async function first(executor, sql, params = []) {
  return (await rows(executor, sql, params))[0] || null;
}

async function columnExists(executor, tableName, columnName) {
  const row = await first(executor, `
    SELECT 1 AS found
    FROM information_schema.columns
    WHERE table_schema=DATABASE() AND table_name=? AND column_name=?
    LIMIT 1
  `, [tableName, columnName]);
  return Boolean(row && row.found);
}

async function indexExists(executor, tableName, indexName) {
  const row = await first(executor, `
    SELECT 1 AS found
    FROM information_schema.statistics
    WHERE table_schema=DATABASE() AND table_name=? AND index_name=?
    LIMIT 1
  `, [tableName, indexName]);
  return Boolean(row && row.found);
}

async function constraintExists(executor, tableName, constraintName) {
  const row = await first(executor, `
    SELECT 1 AS found
    FROM information_schema.table_constraints
    WHERE table_schema=DATABASE() AND table_name=? AND constraint_name=?
    LIMIT 1
  `, [tableName, constraintName]);
  return Boolean(row && row.found);
}

async function dropCheckConstraints(executor, tableName) {
  const constraints = await rows(executor, `
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema=DATABASE() AND table_name=? AND constraint_type='CHECK'
  `, [tableName]);
  for (const constraint of constraints) {
    const name = String(constraint.constraint_name || constraint.CONSTRAINT_NAME || '');
    if (!/^[A-Za-z0-9_$]+$/.test(name)) {
      throw new Error(`Unsafe check constraint name: ${name}`);
    }
    await executor.execute(`ALTER TABLE ${tableName} DROP CHECK ${name}`);
  }
}

async function addColumnIfMissing(executor, tableName, columnName, definition) {
  if (!await columnExists(executor, tableName, columnName)) {
    await executor.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

async function ensureRbacRaciV2Schema(executor) {
  await addColumnIfMissing(
    executor,
    'departments',
    'final_responsible_person_id',
    'BIGINT NULL AFTER data_owner_user_id'
  );
  if (!await indexExists(executor, 'departments', 'idx_departments_final_responsible_person')) {
    await executor.execute(
      'ALTER TABLE departments ADD INDEX idx_departments_final_responsible_person (final_responsible_person_id)'
    );
  }

  await addColumnIfMissing(executor, 'roles', 'status', "VARCHAR(32) NOT NULL DEFAULT 'active' AFTER role_group");
  await addColumnIfMissing(executor, 'roles', 'model_version', 'VARCHAR(64) NULL AFTER status');
  await addColumnIfMissing(executor, 'roles', 'is_core', 'TINYINT NOT NULL DEFAULT 0 AFTER model_version');
  await addColumnIfMissing(executor, 'roles', 'protected_core', 'TINYINT NOT NULL DEFAULT 0');
  await addColumnIfMissing(
    executor,
    'identity_migration_role_model_backup',
    'is_core',
    'TINYINT NOT NULL DEFAULT 0 AFTER model_version'
  );
  await dropCheckConstraints(executor, 'roles');
  await executor.execute("ALTER TABLE roles MODIFY role_group VARCHAR(32) NOT NULL DEFAULT 'mdm'");
  await executor.execute("UPDATE roles SET role_group='legacy' WHERE role_group NOT IN ('system','mdm','legacy')");
  if (!await indexExists(executor, 'roles', 'idx_roles_status')) {
    await executor.execute('ALTER TABLE roles ADD INDEX idx_roles_status (status)');
  }
  if (!await constraintExists(executor, 'roles', 'chk_roles_group_v2')) {
    await executor.execute("ALTER TABLE roles ADD CONSTRAINT chk_roles_group_v2 CHECK (role_group IN ('system','mdm','legacy'))");
  }
  if (!await constraintExists(executor, 'roles', 'chk_roles_status_v2')) {
    await executor.execute("ALTER TABLE roles ADD CONSTRAINT chk_roles_status_v2 CHECK (status IN ('active','legacy','retired'))");
  }

  await addColumnIfMissing(executor, 'user_accounts', 'auth_version', 'BIGINT NOT NULL DEFAULT 1 AFTER account_status');
  await dropCheckConstraints(executor, 'user_accounts');
  await executor.execute("ALTER TABLE user_accounts MODIFY account_status VARCHAR(32) NOT NULL DEFAULT 'pending_activation'");
  if (!await constraintExists(executor, 'user_accounts', 'chk_user_accounts_status_v2')) {
    await executor.execute(
      "ALTER TABLE user_accounts ADD CONSTRAINT chk_user_accounts_status_v2 CHECK (account_status IN ('pending_activation','active','locked','disabled'))"
    );
  }

  await addColumnIfMissing(executor, 'person_roles', 'scope_type', "VARCHAR(32) NOT NULL DEFAULT 'global' AFTER role_id");
  await addColumnIfMissing(executor, 'person_roles', 'scope_department_id', 'BIGINT NULL AFTER scope_type');
  await addColumnIfMissing(executor, 'person_roles', 'authorization_basis', 'TEXT NULL AFTER scope_department_id');
  await addColumnIfMissing(executor, 'person_roles', 'effective_from', 'DATE NULL AFTER authorization_basis');
  await addColumnIfMissing(executor, 'person_roles', 'effective_to', 'DATE NULL AFTER effective_from');
  await addColumnIfMissing(executor, 'person_roles', 'assignment_status', "VARCHAR(32) NOT NULL DEFAULT 'active' AFTER effective_to");
  await addColumnIfMissing(executor, 'person_roles', 'revoked_by_person_id', 'BIGINT NULL AFTER assigned_by_person_id');
  await addColumnIfMissing(executor, 'person_roles', 'revoked_at', 'TIMESTAMP NULL AFTER revoked_by_person_id');
  await addColumnIfMissing(executor, 'person_roles', 'revocation_reason', 'TEXT NULL AFTER revoked_at');
  if (!await indexExists(executor, 'person_roles', 'idx_person_roles_scope')) {
    await executor.execute('ALTER TABLE person_roles ADD INDEX idx_person_roles_scope (scope_type, scope_department_id)');
  }
  if (!await indexExists(executor, 'person_roles', 'idx_person_roles_effective')) {
    await executor.execute(
      'ALTER TABLE person_roles ADD INDEX idx_person_roles_effective (assignment_status, effective_from, effective_to)'
    );
  }
  if (!await constraintExists(executor, 'person_roles', 'chk_person_roles_scope_v2')) {
    await executor.execute(
      "ALTER TABLE person_roles ADD CONSTRAINT chk_person_roles_scope_v2 CHECK (scope_type IN ('global','department'))"
    );
  }
  if (!await constraintExists(executor, 'person_roles', 'chk_person_roles_status_v2')) {
    await executor.execute(
      "ALTER TABLE person_roles ADD CONSTRAINT chk_person_roles_status_v2 CHECK (assignment_status IN ('active','revoked','expired'))"
    );
  }
}

function normalizePermission(permission) {
  return {
    code: permission.code || permission[0],
    resource: permission.resource || permission[1],
    action: permission.action || permission[2],
    description: permission.description || permission[3] || null,
    isDangerous: permission.isDangerous ? 1 : 0,
    defaultScope: permission.defaultScope || 'department',
    protectedCore: permission.protectedCore === false ? 0 : 1
  };
}

async function seedFixedAccessModel(executor, options = {}) {
  if (!options.skipEnsure) await ensureRbacRaciV2Schema(executor);

  for (const role of ROLE_GUIDES) {
    await executor.execute(`
      INSERT INTO roles (
        role_code, role_name, description, parent_role_id, is_system,
        role_group, status, model_version, is_core, protected_core
      )
      VALUES (?, ?, ?, NULL, 1, ?, 'active', ?, 1, 1)
      ON DUPLICATE KEY UPDATE
        role_name=VALUES(role_name),
        description=VALUES(description),
        parent_role_id=NULL,
        is_system=1,
        role_group=VALUES(role_group),
        status='active',
        model_version=VALUES(model_version),
        is_core=1,
        protected_core=1,
        updated_at=CURRENT_TIMESTAMP
    `, [role.code, role.name, role.description || null, role.group, ACCESS_MODEL_VERSION]);

    for (const permission of role.permissions || []) {
      const normalized = normalizePermission(permission);
      await executor.execute(`
        INSERT INTO permissions (
          perm_code, resource, action, description,
          is_dangerous, default_scope, protected_core
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          resource=VALUES(resource),
          action=VALUES(action),
          description=VALUES(description),
          is_dangerous=VALUES(is_dangerous),
          default_scope=VALUES(default_scope),
          protected_core=VALUES(protected_core)
      `, [
        normalized.code,
        normalized.resource,
        normalized.action,
        normalized.description,
        normalized.isDangerous,
        normalized.defaultScope,
        normalized.protectedCore
      ]);
    }

    await executor.execute(`
      DELETE rp
      FROM role_permissions rp
      JOIN roles r ON r.role_id=rp.role_id
      WHERE r.role_code=?
    `, [role.code]);
    for (const permission of role.permissions || []) {
      const normalized = normalizePermission(permission);
      await executor.execute(`
        INSERT INTO role_permissions (role_id, perm_id, effect)
        SELECT r.role_id, p.perm_id, 'allow'
        FROM roles r
        JOIN permissions p ON p.perm_code=?
        WHERE r.role_code=?
        ON DUPLICATE KEY UPDATE effect='allow'
      `, [normalized.code, role.code]);
    }
  }

  const fixedRoleCodes = ROLE_GUIDES.map(role => role.code);
  const placeholders = fixedRoleCodes.map(() => '?').join(',');
  await executor.execute(`
    DELETE rp
    FROM role_permissions rp
    JOIN roles r ON r.role_id=rp.role_id
    WHERE r.role_code NOT IN (${placeholders})
  `, fixedRoleCodes);
  await executor.execute(`
    UPDATE roles
    SET role_group='legacy',
        status='retired',
        model_version=?,
        is_core=0,
        protected_core=1,
        updated_at=CURRENT_TIMESTAMP
    WHERE role_code NOT IN (${placeholders})
  `, [ACCESS_MODEL_VERSION, ...fixedRoleCodes]);
}

async function collectRbacRaciPreflight(executor, options = {}) {
  const adminEmployeeNo = String(options.adminEmployeeNo || process.env.MDM_ADMIN_EMPLOYEE_NO || 'ADMIN001').trim();
  const finalResponsibleColumnExists = await columnExists(
    executor,
    'departments',
    'final_responsible_person_id'
  );
  const [
    personCount,
    accountCount,
    activeAccountCount,
    roleCount,
    assignmentCount,
    missingDepartmentCount,
    missingResponsibleCount,
    duplicateEmployeeNos,
    duplicateLoginNames,
    orphanAssignments,
    admin
  ] = await Promise.all([
    first(executor, 'SELECT COUNT(*) AS count FROM person'),
    first(executor, 'SELECT COUNT(*) AS count FROM user_accounts'),
    first(executor, "SELECT COUNT(*) AS count FROM user_accounts WHERE account_status='active'"),
    first(executor, 'SELECT COUNT(*) AS count FROM roles'),
    first(executor, 'SELECT COUNT(*) AS count FROM person_roles'),
    first(executor, `
      SELECT COUNT(*) AS count
      FROM person p
      LEFT JOIN departments d ON d.id=p.current_department_id
      WHERE p.current_department_id IS NULL OR d.id IS NULL OR d.status<>'active'
    `),
    finalResponsibleColumnExists
      ? first(executor, `
          SELECT COUNT(*) AS count
          FROM departments
          WHERE status='active' AND final_responsible_person_id IS NULL
        `)
      : first(executor, `
          SELECT COUNT(*) AS count
          FROM departments
          WHERE status='active'
        `),
    rows(executor, `
      SELECT employee_no, COUNT(*) AS count
      FROM person
      GROUP BY employee_no
      HAVING COUNT(*)>1
    `),
    rows(executor, `
      SELECT login_name, COUNT(*) AS count
      FROM user_accounts
      GROUP BY login_name
      HAVING COUNT(*)>1
    `),
    first(executor, `
      SELECT COUNT(*) AS count
      FROM person_roles pr
      LEFT JOIN person p ON p.person_id=pr.person_id
      LEFT JOIN roles r ON r.role_id=pr.role_id
      WHERE p.person_id IS NULL OR r.role_id IS NULL
    `),
    first(executor, `
      SELECT p.person_id, ua.account_id, ua.account_status
      FROM person p
      JOIN user_accounts ua ON ua.person_id=p.person_id
      WHERE p.employee_no=?
      LIMIT 1
    `, [adminEmployeeNo])
  ]);

  return {
    modelVersion: ACCESS_MODEL_VERSION,
    adminEmployeeNo,
    counts: {
      persons: Number(personCount && personCount.count || 0),
      accounts: Number(accountCount && accountCount.count || 0),
      activeAccounts: Number(activeAccountCount && activeAccountCount.count || 0),
      roles: Number(roleCount && roleCount.count || 0),
      roleAssignments: Number(assignmentCount && assignmentCount.count || 0),
      personsWithMissingDepartment: Number(missingDepartmentCount && missingDepartmentCount.count || 0),
      activeDepartmentsWithoutFinalResponsiblePerson: Number(missingResponsibleCount && missingResponsibleCount.count || 0),
      orphanRoleAssignments: Number(orphanAssignments && orphanAssignments.count || 0)
    },
    duplicateEmployeeNos,
    duplicateLoginNames,
    admin: admin || null,
    schemaChangesRequired: finalResponsibleColumnExists
      ? []
      : ['ADD departments.final_responsible_person_id'],
    blockers: [
      ...(duplicateEmployeeNos.length ? ['DUPLICATE_EMPLOYEE_NO'] : []),
      ...(duplicateLoginNames.length ? ['DUPLICATE_LOGIN_NAME'] : []),
      ...(Number(orphanAssignments && orphanAssignments.count || 0) > 0 ? ['ORPHAN_ROLE_ASSIGNMENT'] : []),
      ...(!admin ? ['ADMIN_ACCOUNT_NOT_FOUND'] : [])
    ]
  };
}

async function assertActiveAdmin(executor) {
  const row = await first(executor, `
    SELECT COUNT(DISTINCT p.person_id) AS count
    FROM person p
    JOIN user_accounts ua ON ua.person_id=p.person_id
    JOIN person_roles pr ON pr.person_id=p.person_id
    JOIN roles r ON r.role_id=pr.role_id
    WHERE ua.account_status='active'
      AND p.status='active'
      AND r.role_code='admin'
      AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
      AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL
      AND (pr.effective_from IS NULL OR pr.effective_from<=CURRENT_DATE)
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
  `, [ACCESS_MODEL_VERSION]);
  if (Number(row && row.count || 0) < 1) {
    const error = new Error('迁移后没有有效的MDM系统管理员');
    error.code = 'ACTIVE_ADMIN_REQUIRED';
    error.statusCode = 409;
    throw error;
  }
}

async function applyRbacRaciV2Migration(pool, options = {}) {
  await ensureRbacRaciV2Schema(pool);
  const preflight = await collectRbacRaciPreflight(pool, options);
  if (preflight.blockers.length > 0) {
    const error = new Error(`迁移前检查未通过：${preflight.blockers.join(', ')}`);
    error.code = 'RBAC_RACI_PREFLIGHT_BLOCKED';
    error.statusCode = 409;
    error.preflight = preflight;
    throw error;
  }

  const batchId = String(options.batchId || `rbac-raci-v2-${crypto.randomUUID()}`);
  const existing = await first(pool, `
    SELECT batch_id, status, result_json
    FROM identity_migration_batches
    WHERE batch_id=?
  `, [batchId]);
  if (existing && existing.status === 'completed') {
    return {
      batchId,
      idempotent: true,
      preflight,
      result: existing.result_json || null
    };
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(`
      INSERT INTO identity_migration_batches (
        batch_id, model_version, mode, status, preflight_json, started_by_person_id
      )
      VALUES (?, ?, 'apply', 'running', ?, ?)
      ON DUPLICATE KEY UPDATE
        model_version=VALUES(model_version),
        mode='apply',
        status='running',
        preflight_json=VALUES(preflight_json),
        started_by_person_id=VALUES(started_by_person_id),
        completed_at=NULL
    `, [
      batchId,
      ACCESS_MODEL_VERSION,
      JSON.stringify(preflight),
      options.actorPersonId || preflight.admin.person_id
    ]);

    await connection.execute(`
      INSERT IGNORE INTO identity_migration_role_model_backup (
        batch_id, role_id, role_code, role_name, description, parent_role_id,
        is_system, role_group, status, model_version, is_core, protected_core
      )
      SELECT ?, role_id, role_code, role_name, description, parent_role_id,
             is_system, role_group, status, model_version, is_core, protected_core
      FROM roles
    `, [batchId]);
    await connection.execute(`
      INSERT IGNORE INTO identity_migration_permission_backup (
        batch_id, perm_id, perm_code, resource, action, description,
        is_dangerous, default_scope, protected_core, field_constraints
      )
      SELECT ?, perm_id, perm_code, resource, action, description,
             is_dangerous, default_scope, protected_core, field_constraints
      FROM permissions
    `, [batchId]);
    await connection.execute(`
      INSERT IGNORE INTO identity_migration_role_permission_backup (
        batch_id, role_id, perm_id, effect
      )
      SELECT ?, role_id, perm_id, effect
      FROM role_permissions
    `, [batchId]);

    await seedFixedAccessModel(connection, { skipEnsure: true });

    await connection.execute(`
      INSERT IGNORE INTO identity_migration_account_backup (
        batch_id, account_id, person_id, account_status, auth_version, must_change_password
      )
      SELECT ?, account_id, person_id, account_status, auth_version, must_change_password
      FROM user_accounts
    `, [batchId]);
    await connection.execute(`
      INSERT IGNORE INTO identity_migration_role_backup (
        batch_id, person_role_id, person_id, role_id, scope_type, scope_department_id,
        authorization_basis, effective_from, effective_to, assignment_status,
        revoked_by_person_id, revoked_at, revocation_reason
      )
      SELECT ?, person_role_id, person_id, role_id, scope_type, scope_department_id,
             authorization_basis, effective_from, effective_to, assignment_status,
             revoked_by_person_id, revoked_at, revocation_reason
      FROM person_roles
    `, [batchId]);

    await connection.execute(`
      UPDATE person_roles pr
      JOIN roles r ON r.role_id=pr.role_id
      SET pr.assignment_status='revoked',
          pr.revoked_by_person_id=?,
          pr.revoked_at=CURRENT_TIMESTAMP,
          pr.revocation_reason=?
      WHERE pr.assignment_status='active'
        AND NOT (pr.person_id=? AND r.role_code='admin')
    `, [
      options.actorPersonId || preflight.admin.person_id,
      LEGACY_REVOCATION_REASON,
      preflight.admin.person_id
    ]);

    await connection.execute(`
      INSERT INTO person_roles (
        person_id, role_id, scope_type, scope_department_id, authorization_basis,
        effective_from, effective_to, assignment_status, assigned_by_person_id
      )
      SELECT ?, r.role_id, 'global', NULL, ?, CURRENT_DATE, NULL, 'active', ?
      FROM roles r
      WHERE r.role_code='admin' AND r.status='active'
      ON DUPLICATE KEY UPDATE
        scope_type='global',
        scope_department_id=NULL,
        authorization_basis=VALUES(authorization_basis),
        effective_from=COALESCE(person_roles.effective_from, CURRENT_DATE),
        effective_to=NULL,
        assignment_status='active',
        assigned_by_person_id=VALUES(assigned_by_person_id),
        revoked_by_person_id=NULL,
        revoked_at=NULL,
        revocation_reason=NULL
    `, [
      preflight.admin.person_id,
      MIGRATION_ADMIN_BASIS,
      options.actorPersonId || preflight.admin.person_id
    ]);

    await connection.execute(`
      UPDATE user_accounts
      SET account_status=CASE WHEN person_id=? THEN 'active' ELSE 'disabled' END,
          auth_version=auth_version+1,
          updated_at=CURRENT_TIMESTAMP
    `, [preflight.admin.person_id]);

    await connection.execute(`
      INSERT INTO identity_access_events (
        event_type, actor_person_id, target_person_id, account_id, reason,
        payload_json, migration_batch_id
      )
      SELECT
        CASE WHEN person_id=? THEN 'account_activated' ELSE 'account_disabled' END,
        ?,
        person_id,
        account_id,
        CASE WHEN person_id=? THEN ? ELSE ? END,
        JSON_OBJECT('modelVersion', ?),
        ?
      FROM user_accounts
    `, [
      preflight.admin.person_id,
      options.actorPersonId || preflight.admin.person_id,
      preflight.admin.person_id,
      MIGRATION_ADMIN_BASIS,
      LEGACY_REVOCATION_REASON,
      ACCESS_MODEL_VERSION,
      batchId
    ]);
    await connection.execute(`
      INSERT INTO identity_access_events (
        event_type, actor_person_id, reason, payload_json, migration_batch_id
      )
      VALUES ('migration_applied', ?, ?, ?, ?)
    `, [
      options.actorPersonId || preflight.admin.person_id,
      '应用RBAC/RACI v2身份与授权模型',
      JSON.stringify({ modelVersion: ACCESS_MODEL_VERSION }),
      batchId
    ]);

    const result = {
      activeAdminPersonId: Number(preflight.admin.person_id),
      disabledAccounts: Math.max(0, preflight.counts.accounts - 1),
      preservedLegacyAssignments: preflight.counts.roleAssignments,
      modelVersion: ACCESS_MODEL_VERSION
    };
    await connection.execute(`
      UPDATE identity_migration_batches
      SET status='completed', result_json=?, completed_at=CURRENT_TIMESTAMP
      WHERE batch_id=?
    `, [JSON.stringify(result), batchId]);
    await connection.commit();
    await assertActiveAdmin(pool);
    return { batchId, idempotent: false, preflight, result };
  } catch (error) {
    await connection.rollback();
    try {
      await pool.execute(`
        INSERT INTO identity_migration_batches (
          batch_id, model_version, mode, status, preflight_json, result_json, started_by_person_id, completed_at
        )
        VALUES (?, ?, 'apply', 'failed', ?, ?, ?, CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          status='failed',
          result_json=VALUES(result_json),
          completed_at=CURRENT_TIMESTAMP
      `, [
        batchId,
        ACCESS_MODEL_VERSION,
        JSON.stringify(preflight),
        JSON.stringify({ error: error.code || error.message }),
        options.actorPersonId || preflight.admin.person_id
      ]);
    } catch {
      // Keep the original migration error.
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function rollbackRbacRaciV2Migration(pool, batchId, options = {}) {
  const batch = await first(pool, `
    SELECT *
    FROM identity_migration_batches
    WHERE batch_id=?
  `, [batchId]);
  if (!batch) {
    const error = new Error('迁移批次不存在');
    error.code = 'MIGRATION_BATCH_NOT_FOUND';
    error.statusCode = 404;
    throw error;
  }
  if (batch.status === 'rolled_back') return { batchId, idempotent: true };
  if (batch.status !== 'completed') {
    const error = new Error('只有已完成的迁移批次可以回滚');
    error.code = 'MIGRATION_BATCH_NOT_COMPLETED';
    error.statusCode = 409;
    throw error;
  }

  const laterEvent = await first(pool, `
    SELECT event_id
    FROM identity_access_events
    WHERE created_at>?
      AND (migration_batch_id IS NULL OR migration_batch_id<>?)
    LIMIT 1
  `, [batch.completed_at, batchId]);
  if (laterEvent && !options.allowCompensation) {
    const error = new Error('迁移后已经发生新的账号或授权操作，请改用补偿回滚');
    error.code = 'MIGRATION_ROLLBACK_REQUIRES_COMPENSATION';
    error.statusCode = 409;
    throw error;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const compensating = Boolean(laterEvent && options.allowCompensation);
    if (compensating) {
      await connection.execute(`
        UPDATE user_accounts ua
        JOIN identity_migration_account_backup b
          ON b.account_id=ua.account_id AND b.batch_id=?
        SET ua.account_status=b.account_status,
            ua.auth_version=ua.auth_version+1,
            ua.must_change_password=b.must_change_password,
            ua.updated_at=CURRENT_TIMESTAMP
        WHERE ua.auth_version=b.auth_version+1
      `, [batchId]);
      await connection.execute(`
        UPDATE person_roles pr
        JOIN identity_migration_role_backup b
          ON b.person_role_id=pr.person_role_id AND b.batch_id=?
        SET pr.scope_type=b.scope_type,
            pr.scope_department_id=b.scope_department_id,
            pr.authorization_basis=b.authorization_basis,
            pr.effective_from=b.effective_from,
            pr.effective_to=b.effective_to,
            pr.assignment_status=b.assignment_status,
            pr.revoked_by_person_id=b.revoked_by_person_id,
            pr.revoked_at=b.revoked_at,
            pr.revocation_reason=b.revocation_reason
        WHERE pr.assignment_status='revoked' AND pr.revocation_reason=?
      `, [batchId, LEGACY_REVOCATION_REASON]);
    } else {
      await connection.execute(`
        UPDATE user_accounts ua
        JOIN identity_migration_account_backup b
          ON b.account_id=ua.account_id AND b.batch_id=?
        SET ua.account_status=b.account_status,
            ua.auth_version=GREATEST(ua.auth_version, b.auth_version)+1,
            ua.must_change_password=b.must_change_password,
            ua.updated_at=CURRENT_TIMESTAMP
      `, [batchId]);
      await connection.execute(`
        UPDATE person_roles pr
        JOIN identity_migration_role_backup b
          ON b.person_role_id=pr.person_role_id AND b.batch_id=?
        SET pr.scope_type=b.scope_type,
            pr.scope_department_id=b.scope_department_id,
            pr.authorization_basis=b.authorization_basis,
            pr.effective_from=b.effective_from,
            pr.effective_to=b.effective_to,
            pr.assignment_status=b.assignment_status,
            pr.revoked_by_person_id=b.revoked_by_person_id,
            pr.revoked_at=b.revoked_at,
            pr.revocation_reason=b.revocation_reason
      `, [batchId]);
    }
    await connection.execute(`
      DELETE pr
      FROM person_roles pr
      LEFT JOIN identity_migration_role_backup b
        ON b.person_role_id=pr.person_role_id AND b.batch_id=?
      WHERE b.person_role_id IS NULL
        AND pr.authorization_basis=?
    `, [batchId, MIGRATION_ADMIN_BASIS]);
    if (!compensating) {
      await connection.execute('DELETE FROM role_permissions');
      await connection.execute(`
        UPDATE permissions p
        JOIN identity_migration_permission_backup b
          ON b.perm_id=p.perm_id AND b.batch_id=?
        SET p.perm_code=b.perm_code,
            p.resource=b.resource,
            p.action=b.action,
            p.description=b.description,
            p.is_dangerous=b.is_dangerous,
            p.default_scope=b.default_scope,
            p.protected_core=b.protected_core,
            p.field_constraints=b.field_constraints
      `, [batchId]);
      await connection.execute(`
        DELETE p
        FROM permissions p
        LEFT JOIN identity_migration_permission_backup b
          ON b.perm_id=p.perm_id AND b.batch_id=?
        WHERE b.perm_id IS NULL
      `, [batchId]);
      await connection.execute(`
        UPDATE roles r
        JOIN identity_migration_role_model_backup b
          ON b.role_id=r.role_id AND b.batch_id=?
        SET r.role_code=b.role_code,
            r.role_name=b.role_name,
            r.description=b.description,
            r.parent_role_id=b.parent_role_id,
            r.is_system=b.is_system,
            r.role_group=b.role_group,
            r.status=b.status,
            r.model_version=b.model_version,
            r.is_core=b.is_core,
            r.protected_core=b.protected_core
      `, [batchId]);
      await connection.execute(`
        DELETE r
        FROM roles r
        LEFT JOIN identity_migration_role_model_backup b
          ON b.role_id=r.role_id AND b.batch_id=?
        WHERE b.role_id IS NULL
      `, [batchId]);
      await connection.execute(`
        INSERT INTO role_permissions (role_id, perm_id, effect)
        SELECT role_id, perm_id, effect
        FROM identity_migration_role_permission_backup
        WHERE batch_id=?
      `, [batchId]);
    }
    await connection.execute(`
      INSERT INTO identity_access_events (
        event_type, actor_person_id, reason, payload_json, migration_batch_id
      )
      VALUES ('migration_compensated', ?, ?, ?, ?)
    `, [
      options.actorPersonId || null,
      compensating ? '补偿撤销RBAC/RACI v2迁移' : '回滚RBAC/RACI v2迁移',
      JSON.stringify({ modelVersion: ACCESS_MODEL_VERSION }),
      batchId
    ]);
    await connection.execute(`
      UPDATE identity_migration_batches
      SET status='rolled_back', mode='rollback', completed_at=CURRENT_TIMESTAMP,
          result_json=?
      WHERE batch_id=?
    `, [JSON.stringify({ compensated: compensating }), batchId]);
    await connection.commit();
    return { batchId, idempotent: false, compensated: compensating };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  ACCESS_MODEL_VERSION,
  LEGACY_REVOCATION_REASON,
  MIGRATION_ADMIN_BASIS,
  applyRbacRaciV2Migration,
  assertActiveAdmin,
  collectRbacRaciPreflight,
  ensureRbacRaciV2Schema,
  rollbackRbacRaciV2Migration,
  seedFixedAccessModel
};
