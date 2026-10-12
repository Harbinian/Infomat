const { supports: supportsNativeProcess } = require('./processNativeFormats');
const {validateLockedDraft} = require('./processDesignValidation');
const {createProcessDesignApplication} = require('./processDesignApplication');
// Owns SQL, lock ordering, transaction reauthorization and atomic formal operations.
const authoring = require('./processV7Authoring');
const {contentHash:v7ContentHash,unresolvedBlockingIssues,validateAndProjectProcess} = require('./processPreviewReview');
const {assertV7FormalEnabled,assertV7TrialProcessRef} = require('./processV7TrialScope');
const {ACCESS_MODEL_VERSION} = require('./roleDefinitions');
const {sessionSubject,identityInteger,sameIdentityInteger} = require('./sessionSubject');
const {assignmentAuthority} = require('./identityMysqlRepository');
const {httpError,assertActiveV7Draft,text,optionalText,v7FormalExpectedBinding,assertV7FormalTransitionEnabled,v7ActualState,v7ReviewContentStale,v7PromotionEvidenceMismatch,v7DraftStateConflict,v7BaseVersionConflict,v7BlockingIssuesError,assertV7ExpectedContent,editionToNumber,numberToEdition,nextEdition,documentVersionNo,markdownFileSafe,parseJsonArray,parseJsonObject,arrayItems,hasNonEmptyWorkRoleBindings,assertWorkRoleBindingsSupported,publicDraft,EDITABLE_DRAFT_STATUSES,DEFAULT_PROCESS_DESIGN_FIELD_TYPES,EVIDENCE_STATUS_MIGRATION_KEY,EDITION_SCHEMA_MIGRATION_KEY,FORM_STRUCTURE_SCHEMA_MIGRATION_KEY,STEP_TRANSITION_SCHEMA_MIGRATION_KEY,STRUCTURED_OUTPUT_SCHEMA_VERSION,FORMAL_V7_TRANSACTION_CONTEXT,FORMAL_V7_ACTOR_CONTEXT} = require('./processDesignPolicy');
async function mysqlQuery(pool, sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function mysqlRun(pool, sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

async function executeIgnoringDuplicateColumn(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (error.code === 'ER_DUP_FIELDNAME' || /Duplicate column name/i.test(String(error.message || '')))) return;
    throw error;
  }
}

async function executeIgnoringDuplicateKey(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_DUP_KEYNAME'
      || error.code === 'ER_DUP_INDEX'
      || /Duplicate key name/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function executeIgnoringDuplicateCheck(pool, sql) {
  try {
    await pool.execute(sql);
  } catch (error) {
    if (error && (
      error.code === 'ER_FK_DUP_NAME'
      || error.code === 'ER_DUP_KEYNAME'
      || /Duplicate check constraint name/i.test(String(error.message || ''))
      || /already exists/i.test(String(error.message || ''))
    )) return;
    throw error;
  }
}

async function dropProcessDesignVersionStatusChecks(pool) {
  const checks = await mysqlQuery(pool, `
    SELECT tc.CONSTRAINT_NAME
    FROM information_schema.TABLE_CONSTRAINTS tc
    JOIN information_schema.CHECK_CONSTRAINTS cc
      ON cc.CONSTRAINT_SCHEMA=tc.CONSTRAINT_SCHEMA
     AND cc.CONSTRAINT_NAME=tc.CONSTRAINT_NAME
    WHERE tc.CONSTRAINT_SCHEMA=DATABASE()
      AND tc.TABLE_NAME='process_design_versions'
      AND tc.CONSTRAINT_TYPE='CHECK'
      AND cc.CHECK_CLAUSE LIKE '%retired%'
      AND cc.CHECK_CLAUSE NOT LIKE '%superseded%'
  `);
  for (const row of checks) {
    await pool.execute(`ALTER TABLE process_design_versions DROP CHECK \`${row.CONSTRAINT_NAME}\``);
  }
}

async function ensureProcessDesignEditionSchema(pool) {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      document_no VARCHAR(128) NOT NULL,
      document_title VARCHAR(255) NOT NULL,
      owning_department_id BIGINT NOT NULL,
      current_edition VARCHAR(16) NULL,
      current_version_id BIGINT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'active',
      created_by BIGINT NULL,
      updated_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_documents_no (document_no),
      INDEX idx_process_design_documents_dept (owning_department_id, status),
      INDEX idx_process_design_documents_current_version (current_version_id),
      CHECK (status IN ('active','retired'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN planned_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN base_version_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_drafts ADD COLUMN active_document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD UNIQUE KEY uq_process_design_drafts_active_document_no (active_document_no)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_drafts ADD INDEX idx_process_design_drafts_document (document_id, status)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN effective_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_versions ADD COLUMN supersedes_version_id BIGINT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD UNIQUE KEY uq_process_design_versions_document_edition (document_no, edition)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_versions ADD INDEX idx_process_design_versions_document (document_id, status)');
  await dropProcessDesignVersionStatusChecks(pool);
  await executeIgnoringDuplicateCheck(pool, "ALTER TABLE process_design_versions ADD CONSTRAINT chk_process_design_versions_status CHECK (status IN ('published','superseded','retired'))");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_mapping_records ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_mapping_records ADD INDEX idx_process_mapping_records_document (document_no, document_edition)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_no VARCHAR(128) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_title VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_a1_items ADD COLUMN document_edition VARCHAR(16) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_a1_items ADD INDEX idx_process_a1_items_document (document_no, document_edition)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EDITION_SCHEMA_MIGRATION_KEY]);
}

async function ensureProcessDesignEvidenceStatusSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, `ALTER TABLE process_design_evidence ADD COLUMN status ENUM('verified','pending_review','source_missing','ocr_extracted_not_confirmed','review_only') NOT NULL DEFAULT 'pending_review'`);
  const [migration] = await mysqlQuery(pool, 'SELECT migration_key FROM schema_migrations WHERE migration_key=?', [EVIDENCE_STATUS_MIGRATION_KEY]);
  if (migration) return;
  await mysqlRun(pool, "UPDATE process_design_evidence SET status='verified' WHERE status='pending_review' AND maturity='可支撑发布'");
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [EVIDENCE_STATUS_MIGRATION_KEY]);
}

async function ensureProcessDesignFormStructureSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN form_code VARCHAR(160) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN main_table_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN archive_location ENUM('部门自行保存','资料室') NULL");
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_forms ADD COLUMN retention_period ENUM('1年','3年','10年','永久') NULL");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_id BIGINT NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_department_name VARCHAR(255) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_forms ADD COLUMN responsible_role VARCHAR(255) NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_forms ADD INDEX idx_process_design_forms_code (draft_id, form_code)');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_tables ADD COLUMN table_code VARCHAR(180) NULL');
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_form_table_fields ADD COLUMN structure_kind ENUM('main','detail') NOT NULL DEFAULT 'detail'");
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN field_code VARCHAR(220) NULL');
  await executeIgnoringDuplicateColumn(pool, 'ALTER TABLE process_design_form_table_fields ADD COLUMN enum_options TEXT NULL');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_form_table_fields ADD INDEX idx_process_design_table_fields_kind (form_table_id, structure_kind, sort_order)');
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_field_types (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL,
      name VARCHAR(128) NOT NULL,
      sort_order INT NOT NULL DEFAULT 1,
      is_active TINYINT NOT NULL DEFAULT 1,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_process_design_field_types_code (code),
      UNIQUE KEY uq_process_design_field_types_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  for (let index = 0; index < DEFAULT_PROCESS_DESIGN_FIELD_TYPES.length; index += 1) {
    const [code, name] = DEFAULT_PROCESS_DESIGN_FIELD_TYPES[index];
    await mysqlRun(pool, `
      INSERT INTO process_design_field_types (code, name, sort_order)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE name=VALUES(name), sort_order=VALUES(sort_order), is_active=1
    `, [code, name, index + 1]);
  }
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [FORM_STRUCTURE_SCHEMA_MIGRATION_KEY]);
}

async function ensureProcessDesignStepTransitionSchema(pool) {
  await executeIgnoringDuplicateColumn(pool, "ALTER TABLE process_design_steps ADD COLUMN step_type VARCHAR(32) NOT NULL DEFAULT 'action' AFTER process_id");
  await pool.execute("UPDATE process_design_steps SET step_type='action' WHERE step_type IS NULL OR step_type=''");
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS process_design_step_transitions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      draft_id BIGINT NOT NULL,
      process_id BIGINT NOT NULL,
      from_step_id BIGINT NOT NULL,
      condition_text VARCHAR(255) NOT NULL,
      to_step_id BIGINT NULL,
      evidence_refs_json JSON NULL,
      sort_order INT NOT NULL DEFAULT 1,
      created_by BIGINT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_process_design_step_transitions_draft (draft_id, sort_order),
      INDEX idx_process_design_step_transitions_process (process_id, from_step_id),
      CONSTRAINT fk_process_design_step_transitions_draft FOREIGN KEY (draft_id)
        REFERENCES process_design_drafts(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_process FOREIGN KEY (process_id)
        REFERENCES process_design_processes(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_from_step FOREIGN KEY (from_step_id)
        REFERENCES process_design_steps(id) ON DELETE CASCADE,
      CONSTRAINT fk_process_design_step_transitions_to_step FOREIGN KEY (to_step_id)
        REFERENCES process_design_steps(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_draft (draft_id, sort_order)');
  await executeIgnoringDuplicateKey(pool, 'ALTER TABLE process_design_step_transitions ADD INDEX idx_process_design_step_transitions_process (process_id, from_step_id)');
  await mysqlRun(pool, `
    INSERT INTO schema_migrations (migration_key)
    VALUES (?)
    ON DUPLICATE KEY UPDATE applied_at=applied_at
  `, [STEP_TRANSITION_SCHEMA_MIGRATION_KEY]);
}

function makeProcessDesignMysqlStore(pool, options = {}) {
  const assertEnabled = draft => assertV7FormalTransitionEnabled(draft, options);
  async function getById(table, id) {
    const [row] = await mysqlQuery(pool, `SELECT * FROM ${table} WHERE id=?`, [id]);
    return row || null;
  }

  async function getDocumentById(documentId) {
    const [row] = await mysqlQuery(pool, 'SELECT * FROM process_design_documents WHERE id=?', [documentId]);
    return row || null;
  }

  async function addEvent(draftId, eventType, actorUserId, note, payload) {
    await mysqlRun(pool, `
      INSERT INTO process_design_events (draft_id, event_type, actor_user_id, note, payload_json)
      VALUES (?, ?, ?, ?, ?)
    `, [draftId, eventType, actorUserId || null, optionalText(note), payload ? JSON.stringify(payload) : null]);
  }

  async function locateFormalV7Transition(draftId, taskId = null) {
    let locatedDraftId = Number(draftId);
    if (taskId != null) {
      const [task] = await mysqlQuery(pool, `
        SELECT id, draft_id
        FROM process_design_review_tasks
        WHERE id=?
      `, [Number(taskId)]);
      if (!task) throw httpError(404, '审核任务不存在');
      locatedDraftId = Number(task.draft_id);
    }
    const [promotion] = await mysqlQuery(pool, `
      SELECT id, preview_case_id, preview_revision_id, document_id, draft_id
      FROM process_v7_promotions
      WHERE draft_id=?
      ORDER BY id DESC
      LIMIT 1
    `, [locatedDraftId]);
    if (!promotion) {
      throw v7PromotionEvidenceMismatch({ id: locatedDraftId }, '正式流程草稿缺少当前提升依据，请重新完成受控提升');
    }
    return {
      caseId: Number(promotion.preview_case_id),
      draftId: locatedDraftId,
      taskId: taskId == null ? null : Number(taskId)
    };
  }

  async function lockFormalV7Context(locator) {
    const [previewCase] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_preview_cases
      WHERE id=?
      FOR UPDATE
    `, [locator.caseId]);
    if (!previewCase) throw v7PromotionEvidenceMismatch(null, '正式流程草稿关联的预览案例不存在');

    const [revision] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_preview_revisions
      WHERE id=? AND case_id=?
      FOR SHARE
    `, [previewCase.current_revision_id, previewCase.id]);
    if (!revision) throw v7PromotionEvidenceMismatch(null, '正式流程草稿关联的当前预览修订不存在');

    const [promotion] = await mysqlQuery(pool, `
      SELECT *
      FROM process_v7_promotions
      WHERE preview_case_id=? AND draft_id=?
      ORDER BY id DESC
      LIMIT 1
      FOR SHARE
    `, [previewCase.id, locator.draftId]);
    if (!promotion) throw v7PromotionEvidenceMismatch(null, '正式流程草稿缺少当前提升依据，请重新完成受控提升');

    const [document] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_documents
      WHERE id=?
      FOR UPDATE
    `, [promotion.document_id]);
    if (!document || text(document.status) !== 'active') {
      throw httpError(409, '正式流程主档不存在或已停用，不能继续处理流程正文', {
        error: '正式流程主档不存在或已停用，不能继续处理流程正文',
        code: 'V7_FORMAL_DOCUMENT_NOT_FOUND'
      });
    }

    let currentVersion = null;
    if (document.current_version_id) {
      [currentVersion] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_versions
        WHERE id=?
        FOR UPDATE
      `, [document.current_version_id]);
      if (!currentVersion || Number(currentVersion.document_id) !== Number(document.id)) {
        throw v7BaseVersionConflict(null, '正式流程主档的当前版本指针无效，不能继续处理流程正文');
      }
    } else {
      const [unexpectedVersion] = await mysqlQuery(pool, `
        SELECT *
        FROM process_design_versions
        WHERE document_id=? AND status='published'
        ORDER BY effective_at DESC, id DESC
        LIMIT 1
        FOR UPDATE
      `, [document.id]);
      if (unexpectedVersion) {
        throw v7BaseVersionConflict(null, '正式流程主档存在有效版本但缺少当前版本指针，不能继续处理流程正文');
      }
    }

    const [draftRow] = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_drafts
      WHERE id=?
      FOR UPDATE
    `, [promotion.draft_id]);
    const draft = publicDraft(draftRow);
    if (!draft || Number(draft.id) !== Number(locator.draftId)) {
      throw v7PromotionEvidenceMismatch(draft, '正式流程草稿与当前提升依据不一致');
    }
    const reviewTasks = await mysqlQuery(pool, `
      SELECT *
      FROM process_design_review_tasks
      WHERE draft_id=?
      ORDER BY id ASC
      FOR UPDATE
    `, [draft.id]);
    assertEnabled(draft);
    return { previewCase, revision, promotion, document, currentVersion, draft, reviewTasks };
  }

  async function authorizeFormalV7Actor(options, operation, context, actorUserId) {
    const actor = options && options[FORMAL_V7_ACTOR_CONTEXT];
    const subject = sessionSubject(actor);
    const personId = identityInteger(subject.personId);
    const accountId = identityInteger(subject.accountId);
    const authVersion = identityInteger(subject.authVersion);
    if (subject.kind !== 'person' || !personId || !accountId || !authVersion || (actorUserId && !sameIdentityInteger(actorUserId, personId))) {
      throw httpError(401, '正式流程状态变更缺少受控的当前操作人上下文', {
        error: '正式流程状态变更缺少受控的当前操作人上下文',
        code: 'V7_FORMAL_ACTOR_CONTEXT_REQUIRED'
      });
    }

    const [account] = await mysqlQuery(pool, `
      SELECT CAST(ua.account_id AS CHAR) AS account_id, CAST(ua.person_id AS CHAR) AS person_id, ua.account_status, CAST(ua.auth_version AS CHAR) AS auth_version,
             CAST(p.current_department_id AS CHAR) AS current_department_id, p.employment_status, p.status AS person_status
      FROM user_accounts ua
      JOIN person p ON p.person_id=ua.person_id
      WHERE ua.account_id=CAST(? AS SIGNED) AND ua.person_id=CAST(? AS SIGNED)
      FOR SHARE
    `, [accountId, personId]);
    if (
      !account ||
      text(account.account_status) !== 'active' ||
      text(account.person_status) !== 'active' ||
      text(account.employment_status) !== 'active' ||
      !sameIdentityInteger(account.auth_version, authVersion)
    ) {
      throw httpError(401, '账号状态或授权已经变化，请重新登录', {
        error: '账号状态或授权已经变化，请重新登录',
        code: 'SESSION_AUTHORIZATION_CHANGED'
      });
    }

    const assignments = await mysqlQuery(pool, `
      SELECT pr.person_role_id, pr.scope_type, CAST(pr.scope_department_id AS CHAR) AS scope_department_id,
             r.role_code, permission.perm_code, rp.effect
      FROM person_roles pr
      JOIN roles r ON r.role_id=pr.role_id
      LEFT JOIN role_permissions rp ON rp.role_id=r.role_id
      LEFT JOIN permissions permission ON permission.perm_id=rp.perm_id
      WHERE pr.person_id=CAST(? AS SIGNED)
        AND pr.assignment_status='active'
        AND pr.authorization_basis IS NOT NULL
        AND pr.effective_from IS NOT NULL
        AND pr.effective_from<=CURRENT_DATE
        AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
        AND r.status='active'
        AND r.model_version=?
      ORDER BY pr.person_role_id, permission.perm_code
      FOR SHARE
    `, [personId, ACCESS_MODEL_VERSION]);
    const authority = assignmentAuthority(assignments);
    if (authority.readOnly) {
      throw httpError(403, '管理员对治理材料只读，不能执行正式流程业务写入', {
        error: '管理员对治理材料只读，不能执行正式流程业务写入',
        code: 'V7_FORMAL_ADMIN_READ_ONLY'
      });
    }

    if (operation === 'submit' && await authoring.assertCompiler(pool, context.previewCase, { personId, accountId, authVersion }, { start: true })) {
      if (assignments.some(g => g.perm_code === 'governance:submit-department' && g.effect === 'deny')) throw httpError(403, '当前身份禁止提交治理材料', { code: 'V7_FORMAL_ACTOR_SCOPE_DENIED' });
      return { personId, accountId, authVersion, departmentId: identityInteger(account.current_department_id) };
    }

    const requirements = {
      submit: { role: 'department_contact', permissions: ['governance:draft-department', 'governance:submit-department'], departmentScoped: true },
      review: { role: 'department_mdm_reviewer', permissions: ['governance:review-department'], departmentScoped: true },
      publish: { role: 'mdm_lead', permissions: ['governance:publish'], departmentScoped: false }
    }[operation];
    const permissionEffects = authority.effects;
    const formalDepartmentId = identityInteger(context && context.draft && context.draft.department_id);
    const currentDepartmentId = identityInteger(account.current_department_id);
    const expectedRoleAssignments = assignments.filter(item => text(item.role_code) === requirements.role);
    const roleScopeAllowed = requirements.departmentScoped
      ? sameIdentityInteger(currentDepartmentId, formalDepartmentId) && expectedRoleAssignments.some(item =>
          text(item.scope_type) === 'department' &&
          sameIdentityInteger(item.scope_department_id, formalDepartmentId)
        )
      : expectedRoleAssignments.some(item => text(item.scope_type) === 'global');
    const permissionsAllowed = requirements.permissions.every(code => permissionEffects.get(code) === 'allow');
    if (!roleScopeAllowed || !permissionsAllowed) {
      throw httpError(403, '当前操作人的有效角色、部门范围或权限不允许执行该正式流程操作', {
        error: '当前操作人的有效角色、部门范围或权限不允许执行该正式流程操作',
        code: 'V7_FORMAL_ACTOR_SCOPE_DENIED'
      });
    }
    return { personId, accountId, authVersion, departmentId: currentDepartmentId };
  }

  async function runFormalV7Transaction(draftId, taskId, operation) {
    const locator = await locateFormalV7Transition(draftId, taskId);
    if (!pool || typeof pool.getConnection !== 'function') {
      return await operation({ locator, application: null, transaction: false });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const transactionApplication = createProcessDesignApplication(makeProcessDesignMysqlStore(connection, options));
      const result = await operation({ locator, application: transactionApplication, transaction: true });
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  }

  async function loadEvents(draftId) {
    const rows = await mysqlQuery(pool, `
      SELECT e.*, u.name AS actor_user_name
      FROM process_design_events e
      LEFT JOIN users u ON u.id=e.actor_user_id
      WHERE e.draft_id=?
      ORDER BY e.id
    `, [draftId]);
    return rows.map(row => ({
      ...row,
      payload: parseJsonObject(row.payload_json)
    }));
  }

  async function loadReviewTasks(draftId) {
    return await mysqlQuery(pool, 'SELECT * FROM process_design_review_tasks WHERE draft_id=? ORDER BY id', [draftId]);
  }

  async function validateFormalV7Draft(draft, context, options = {}) {
    const departments = await mysqlQuery(pool, `
      SELECT id, name, code
      FROM departments
      WHERE status='active'
      ORDER BY sort_order, id
    `);
    const result=validateLockedDraft(draft,context,departments,{project:validateAndProjectProcess,hash:v7ContentHash,unresolved:unresolvedBlockingIssues},options);
    assertEnabled(draft);
    return result;
  }

  async function getDraft(id) {
    const [row] = await mysqlQuery(pool, `
      SELECT d.*, dept.name AS department_name, proxyDept.name AS proxy_department_name, creator.name AS created_by_name
      FROM process_design_drafts d
      LEFT JOIN departments dept ON dept.id=d.department_id
      LEFT JOIN departments proxyDept ON proxyDept.id=d.proxy_department_id
      LEFT JOIN users creator ON creator.id=d.created_by
      WHERE d.id=?
    `, [id]);
    return publicDraft(row);
  }

  async function detailForDraft(draftId) {
    const draft = await getDraft(draftId);
    if (!draft) return null;
    const document = draft.document_id ? await getDocumentById(draft.document_id) : null;
    const versions = document ? await mysqlQuery(pool, `
      SELECT *
      FROM process_design_versions
      WHERE document_id=?
      ORDER BY effective_at DESC, id DESC
    `, [document.id]) : [];
    const reviewTasks = await loadReviewTasks(draftId);
    const events = await loadEvents(draftId);
    if (supportsNativeProcess(text(draft.schema_version))) {
      const content = parseJsonObject(draft.process_content_json);
      const contentHashVerified = Boolean(
        content &&
        text(draft.content_hash) &&
        v7ContentHash(content) === text(draft.content_hash)
      );
      const approvedCurrentReview = reviewTasks.some(task =>
        text(task.status) === 'approved' &&
        Number(task.draft_revision_no) === Number(draft.revision_no) &&
        text(task.content_hash) === text(draft.content_hash)
      );
      return {
        draft,
        document,
        versions,
        reviewTasks,
        events,
        v7_native: true,
        content,
        content_hash_verified: contentHashVerified,
        outcome: {
          formed: draft.status === 'published' ? '已形成不可变的原生流程正式版本' : '已形成原生流程正式草稿',
          current: `当前状态为${draft.status}`,
          missing: contentHashVerified ? [] : ['流程正文与内容摘要不一致'],
          next: draft.status === 'published' ? '后续治理对象绑定process_version_id' : '按当前状态完成正式审核或发布'
        },
        publishable: draft.status === 'approved' && approvedCurrentReview && contentHashVerified
      };
    }
    throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
  }

  const queries = {
    async authoringAccess(draftId, actor) {
      const [caseRow] = await mysqlQuery(pool, `SELECT c.* FROM process_v7_promotions p
        JOIN process_v7_preview_cases c ON c.id=p.preview_case_id WHERE p.draft_id=? ORDER BY p.id DESC LIMIT 1`, [draftId]);
      if (!caseRow) return null;
      const binding = await authoring.state(pool, caseRow.id);
      if (!binding) return null;
      const current = await authoring.activeActor(pool, actor);
      return { managed: true, compiler: authoring.isCompiler(current, caseRow, binding) };
    },
getDraft,
getDocumentById,
async searchVersions({ query, beforeId, globalRead, departmentId }) {
      // Literal substring search; scope is applied before the keyset page limit.
      return mysqlQuery(pool, `SELECT CAST(id AS CHAR) AS id,
        CAST(document_id AS CHAR) AS document_id, CAST(department_id AS CHAR) AS department_id,
        document_no, document_title, edition, schema_version, status, content_hash
        FROM process_design_versions
        WHERE schema_version IN ('process-governance-v7','process-governance-v8')
          AND status IN ('published','superseded','retired')
          AND (?=1 OR department_id=?)
          AND (?='' OR LOCATE(?,document_no)>0 OR LOCATE(?,document_title)>0)
          AND (? IS NULL OR id<CAST(? AS SIGNED))
        ORDER BY process_design_versions.id DESC LIMIT 21`,
      [globalRead ? 1 : 0, departmentId, query, query, query, beforeId, beforeId]);
    },
async getHistoryAnchor(id) {
      const [row] = await mysqlQuery(pool, `SELECT CAST(id AS CHAR) AS id,
        CAST(document_id AS CHAR) AS document_id, department_id, schema_version
        FROM process_design_drafts WHERE id=CAST(? AS SIGNED)`, [id]);
      return row || null;
    },
async listDocumentDrafts(documentId, { beforeId, departmentId, globalRead }) {
      // Filter before pagination; unauthorized draft identifiers never enter the response.
      return mysqlQuery(pool, `
        SELECT CAST(id AS CHAR) AS id, CAST(document_id AS CHAR) AS document_id,
               CAST(department_id AS CHAR) AS department_id, schema_version, status,
               revision_no, content_hash, document_no, document_title
        FROM process_design_drafts
        WHERE document_id=CAST(? AS SIGNED) AND schema_version IN ('process-governance-v7','process-governance-v8')
          AND (?=1 OR department_id=?) AND (? IS NULL OR id<CAST(? AS SIGNED))
        ORDER BY process_design_drafts.id DESC LIMIT 21
      `, [documentId, globalRead ? 1 : 0, departmentId, beforeId, beforeId]);
    },
async getVersionContent(versionId) {
      const [version] = await mysqlQuery(pool, `
        SELECT id, draft_id, document_id, document_no, document_title, edition, version_no,
               department_id, schema_version, process_content_json, content_json, content_hash,
               source_revision_no, status, UNIX_TIMESTAMP(published_at) AS published_at_epoch,
               effective_at, supersedes_version_id
        FROM process_design_versions
        WHERE id=?
        LIMIT 1
      `, [versionId]);
      if (!version) return null;
      const rawContent = version.process_content_json || version.content_json;
      return {
        process_version_id: Number(version.id),
        draft_id: Number(version.draft_id),
        document_id: Number(version.document_id),
        document_no: version.document_no,
        document_title: version.document_title,
        edition: version.edition,
        version_no: version.version_no,
        department_id: Number(version.department_id),
        schema_version: text(version.schema_version),
        content_hash: text(version.content_hash) || null,
        source_revision_no: version.source_revision_no == null ? null : Number(version.source_revision_no),
        status: version.status,
        // MySQL resolves TIMESTAMP in the session timezone. Reading its epoch
        // avoids interpreting the server wall time in the Node host timezone.
        published_at: version.published_at_epoch == null ? null : new Date(Number(version.published_at_epoch) * 1000).toISOString(),
        effective_at: version.effective_at,
        supersedes_version_id: version.supersedes_version_id == null ? null : Number(version.supersedes_version_id),
        document: rawContent ? parseJsonObject(rawContent) : null
      };
    },
detail: detailForDraft,
async canonicalContent(draft) {
      if (supportsNativeProcess(text(draft.schema_version))) {
        const document = parseJsonObject(draft.process_content_json);
        const calculatedHash = v7ContentHash(document);
        if (!document || calculatedHash !== text(draft.content_hash)) {
          throw httpError(409, '正式流程草稿正文摘要校验失败', {
            error: '正式流程草稿正文摘要校验失败',
            code: 'V7_FORMAL_CONTENT_HASH_MISMATCH'
          });
        }
        return {
          source: 'draft_canonical_json',
          schema_version: draft.schema_version,
          content_hash: calculatedHash,
          revision: Number(draft.revision_no || 0),
          document
        };
      }
      throw httpError(410, '旧版流程办理已停用', { code: 'LEGACY_PROCESS_RETIRED' });
    },
async getReviewTask(taskId) { return await getById("process_design_review_tasks",taskId); }
  };
  return Object.freeze({assertEnabled,queries:Object.freeze(queries),readDraft:getDraft,readReviewTask:queries.getReviewTask,readVersion:id=>getById("process_design_versions",id),
    withTransaction:runFormalV7Transaction,lockContext:lockFormalV7Context,authorizeActor:authorizeFormalV7Actor,validateDraft:validateFormalV7Draft,recordEvent:addEvent,
async markSubmitted({authorizedActor,lockedDraft,binding}) {
      const updateResult = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='submitted', submitted_by=?, submitted_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('draft','needs_changes') AND revision_no=? AND content_hash=?
        `, [authorizedActor.personId, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
      return updateResult;
    },
async createDepartmentReview({authorizedActor,lockedDraft,binding}) {
      const taskResult = await mysqlRun(pool, `
          INSERT INTO process_design_review_tasks
            (draft_id, draft_revision_no, content_hash, task_type, assignee_role, created_by)
          VALUES (?, ?, ?, 'department_review', 'department_mdm_reviewer', ?)
        `, [lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash, authorizedActor.personId]);
      return taskResult;
    },
async recordReviewDecision({nextStatus,note,authorizedActor,lockedTask,binding}) {
      const taskUpdate = await mysqlRun(pool, `
          UPDATE process_design_review_tasks
          SET status=?, decision_note=?, decided_by=?, decided_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='pending' AND draft_revision_no=? AND content_hash=?
        `, [nextStatus, optionalText(note), authorizedActor.personId, lockedTask.id, binding.expectedRevisionNo, binding.expectedContentHash]);
      return taskUpdate;
    },
async setReviewedDraftStatus({nextStatus,lockedDraft,binding}) {
      const draftUpdate = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status=?, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status IN ('submitted','under_review') AND revision_no=? AND content_hash=?
        `, [nextStatus, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
      return draftUpdate;
    },
async createPublishedVersion({lockedDraft,document,plannedEdition,versionNo,authorizedActor,currentVersion}) {
      const result = await mysqlRun(pool, `
          INSERT INTO process_design_versions
            (draft_id, document_id, document_no, document_title, edition, version_no,
             department_id, l1_name, l2_name, l3_name, content_json,
             schema_version, process_content_json, content_hash, source_revision_no,
             published_by, effective_at, supersedes_version_id, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL,
                  ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 'published')
        `, [
          lockedDraft.id,
          document.id,
          document.document_no,
          document.document_title,
          plannedEdition,
          versionNo,
          lockedDraft.department_id,
          lockedDraft.schema_version,
          lockedDraft.process_content_json,
          lockedDraft.content_hash,
          Number(lockedDraft.revision_no),
          authorizedActor.personId,
          currentVersion && currentVersion.id || null
        ]);
      return result;
    },
async supersedePublishedVersion({currentVersion,document}) {
      const supersedeResult = await mysqlRun(pool, `
            UPDATE process_design_versions
            SET status='superseded'
            WHERE id=? AND document_id=? AND status='published'
          `, [currentVersion.id, document.id]);
      return supersedeResult;
    },
async markPublished({authorizedActor,lockedDraft,binding}) {
      const draftUpdate = await mysqlRun(pool, `
          UPDATE process_design_drafts
          SET status='published', active_document_no=NULL, published_by=?,
              published_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
          WHERE id=? AND status='approved' AND revision_no=? AND content_hash=?
        `, [authorizedActor.personId, lockedDraft.id, binding.expectedRevisionNo, binding.expectedContentHash]);
      return draftUpdate;
    },
async advanceDocumentVersion({document,plannedEdition,result,authorizedActor,currentVersion}) {
      const documentUpdate = currentVersion
          ? await mysqlRun(pool, `
              UPDATE process_design_documents
              SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND current_version_id=?
            `, [document.document_title, plannedEdition, result.insertId, authorizedActor.personId, document.id, currentVersion.id])
          : await mysqlRun(pool, `
              UPDATE process_design_documents
              SET document_title=?, current_edition=?, current_version_id=?, updated_by=?, updated_at=CURRENT_TIMESTAMP
              WHERE id=? AND current_version_id IS NULL
            `, [document.document_title, plannedEdition, result.insertId, authorizedActor.personId, document.id]);
      return documentUpdate;
    }
  });
}

function makeProcessDesignMysqlRepository(pool, options = {}) {
  const store=makeProcessDesignMysqlStore(pool, options);
  return {...store.queries,...createProcessDesignApplication(store)};
}

module.exports = {makeProcessDesignMysqlRepository,ensureProcessDesignEditionSchema,ensureProcessDesignEvidenceStatusSchema,ensureProcessDesignFormStructureSchema,ensureProcessDesignStepTransitionSchema};
