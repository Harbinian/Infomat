const {timestampColumns,timeRow}=require('./governanceTimeProjection');
const {
  COMPLETE_DETAIL_STATUSES,
  DETAIL_STATUSES,
  RULE_VERSION,
  addBusinessDays,
  buildGovernanceCandidates,
  buildSourceIndex,
  digest,
  riskFromDocument,
  text
} = require('./processDataGovernance');
const { assertProcessDataGovernanceWritable, isProcessDataGovernanceReadOnly } = require('./processDataGovernanceScope');
const { sessionSubject, identityInteger, sameIdentityInteger } = require('./sessionSubject');
const { readPersonAuthority } = require('./identityMysqlRepository');
const { hasAssignedResponsibility, assertAssignedSteward } = require('./governanceResponsibilities');
const nativeHistory = require('./dataMapNativeHistory');
const { SUPPORTED_SCHEMAS } = require('./processNativeFormats');

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (Buffer.isBuffer(value)) value = value.toString('utf8');
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

async function rows(executor, sql, params = []) {
  const [result] = await executor.execute(sql, params);
  return Array.isArray(result)?result.map(timeRow):result;
}

async function one(executor, sql, params = []) {
  const result = await rows(executor, sql, params);
  return result[0] || null;
}

async function withTransaction(executor, action) {
  if (!executor || typeof executor.getConnection !== 'function') return await action(executor);
  const connection = await executor.getConnection();
  let committing = false;
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    committing = true;
    try {
      await connection.commit();
    } catch (error) {
      // Same meaning as the legacy write path's unresolved-commit answer: the write may or may
      // not have landed, so the caller must look the receipt up and must not retry blindly.
      // The code keeps this module's prefix because every code in this repository has it.
      throw repositoryError(503, 'PROCESS_DATA_GOVERNANCE_COMMIT_UNKNOWN',
        '提交回执不明，请保留原请求并核对记录，不能自动重试');
    }
    return result;
  } catch (error) {
    // A commit whose result is unknown is not rolled back: that would be a second guess.
    if (!committing) await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

function repositoryError(statusCode, code, message, extra = {}) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.payload = { error: message, code, ...extra };
  return error;
}

function actorValue(actor = {}) {
  return {
    personId: identityInteger(sessionSubject(actor).personId),
    departmentId: identityInteger(actor.departmentId),
    roleCode: text(actor.roleCode) || null
  };
}

// Called after the operation's original business locks, on its own transaction
// connection. Route sets describe the UI; they are never write authorization.
async function currentWriteActor(connection, actor, mode = 'mdm', packageId = null) {
  const subject = sessionSubject(actor);
  const personId = identityInteger(subject.personId);
  const accountId = identityInteger(subject.accountId);
  if (subject.kind === 'system_admin') {
    throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY', '管理员对治理材料只读，不能执行数据生命周期治理写操作');
  }
  if (!personId || !accountId || !identityInteger(subject.authVersion)) {
    throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_ACCESS_CHANGED', '账号或授权已变化，请重新登录核对');
  }
  await connection.execute('SELECT account_id FROM user_accounts WHERE account_id=CAST(? AS SIGNED) FOR UPDATE', [accountId]);
  await connection.execute('SELECT person_id FROM person WHERE person_id=CAST(? AS SIGNED) FOR UPDATE', [personId]);
  await connection.execute('SELECT person_id FROM person_roles WHERE person_id=CAST(? AS SIGNED) FOR SHARE', [personId]);
  const accessModelVersion = await require('./dataMapHandoffAuthority').inspectHandoffAccessModel(connection, { lock: true });
  const authority = await readPersonAuthority(connection, actor, personId, { currentRead: true, accessModelVersion });
  if (!authority.valid) throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_ACCESS_CHANGED', '账号或授权已变化，请重新登录核对');
  if (authority.readOnly) throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_ADMIN_READ_ONLY', '管理员对治理材料只读，不能执行数据生命周期治理写操作');
  const { permissions, roleCodes } = authority;
  const departmentId = identityInteger(authority.user.current_department_id);
  if (mode === 'fact') {
    const inDepartment = code => authority.roles.some(role => role.code === code &&
      role.scopeType === 'department' && sameIdentityInteger(role.scopeDepartmentId, departmentId));
    if (!departmentId || !((inDepartment('department_contact') && permissions.has('governance:draft-department')) ||
      (inDepartment('department_mdm_reviewer') && permissions.has('governance:review-department')))) {
      throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_FACT_RESPONSE_DENIED', '只有问题指定部门的主对接人或部门MDM审核员可以答复业务事实');
    }
  } else if (!roleCodes.has('mdm_lead') || !permissions.has('governance:assign-work') || !permissions.has('governance:structure-gate')) {
    if (mode !== 'mdm' || !packageId || !roleCodes.has('mdm_steward') || !permissions.has('governance:handle-assigned-work')) {
      throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_MDM_ONLY', '该治理操作需要MDM工作组的有效职责');
    }
    await assertAssignedSteward(connection, actor, 'work_package', packageId);
  }
  if (mode === 'complete' && !permissions.has('governance:publish')) {
    throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_COMPLETE_DENIED', '只有具备发布职责的MDM工作组组长可以完成工作包审核');
  }
  const roleCode = roleCodes.has('mdm_lead') ? 'mdm_lead' : roleCodes.has('mdm_steward') ? 'mdm_steward' : roleCodes.has('data_quality_auditor') ? 'data_quality_auditor'
    : roleCodes.has('department_mdm_reviewer') ? 'department_mdm_reviewer' : roleCodes.has('department_contact') ? 'department_contact' : null;
  return { ...actor, personId, userId: personId, departmentId, roleCodes, permissions, roleCode,
    personName: authority.user.person_name || authority.user.personName || authority.user.name || null };
}

function publicTask(row) {
  if (!row) return null;
  return {
    id: identityInteger(row.id),
    task_ref: row.task_ref,
    process_version_id: identityInteger(row.process_version_id),
    status: row.status,
    attempt_count: Number(row.attempt_count || 0),
    last_error_code: row.last_error_code || null,
    last_error_message: row.last_error_message || null,
    completed_work_package_id: identityInteger(row.completed_work_package_id),
    next_retry_at: row.next_retry_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null
  };
}

// mysql2 may round an uncast BIGINT before JavaScript sees it. Carry creation
// identities as decimal text at every read, matching the existing package path.
const taskProjection = `SELECT t.*,${timestampColumns('t',["created_at","updated_at","completed_at","next_retry_at"])},CAST(t.id AS CHAR) id,CAST(t.process_version_id AS CHAR) process_version_id,
  CAST(t.completed_work_package_id AS CHAR) completed_work_package_id FROM process_data_governance_creation_tasks t`;

function publicPackage(row) {
  if (!row) return null;
  return {
    id: identityInteger(row.id),
    package_ref: row.package_ref,
    process_version_id: identityInteger(row.process_version_id),
    source_document_id: identityInteger(row.source_document_id),
    owning_department_id: identityInteger(row.owning_department_id),
    owning_department_name: row.owning_department_name || null,
    process_name: row.process_name || row.document_title || null,
    document_no: row.document_no || null,
    edition: row.edition || null,
    schema_version: row.schema_version || null,
    source_content_hash: row.source_content_hash,
    rule_version: row.rule_version,
    risk_level: row.risk_level,
    risk_basis: parseJson(row.risk_basis_json, {}),
    status: row.status,
    revision_no: Number(row.revision_no || 0),
    due_at: row.due_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null,
    detail_counts: parseJson(row.detail_counts_json, null),
    fact_request_counts: parseJson(row.fact_request_counts_json, null)
  };
}

function publicDetail(row) {
  if (!row) return null;
  return {
    id: identityInteger(row.id),
    work_package_id: identityInteger(row.work_package_id),
    detail_ref: row.detail_ref,
    detail_type: row.detail_type,
    source_ref: row.source_ref,
    parent_source_ref: row.parent_source_ref || null,
    responsible_department_id: identityInteger(row.responsible_department_id),
    responsible_department_name: row.responsible_department_name || null,
    source_snapshot_digest: row.source_snapshot_digest,
    candidate_rule_code: row.candidate_rule_code,
    candidate: parseJson(row.candidate_json, {}),
    governance: parseJson(row.governance_json, null),
    status: row.status,
    high_risk: Boolean(row.high_risk),
    revision_no: Number(row.revision_no || 0),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function publicFactRequest(row) {
  if (!row) return null;
  return {
    id: identityInteger(row.id),
    request_ref: row.request_ref,
    work_package_id: identityInteger(row.work_package_id),
    detail_id: identityInteger(row.detail_id),
    detail_ref: row.detail_ref || null,
    target_department_id: identityInteger(row.target_department_id),
    target_department_name: row.target_department_name || null,
    requested_fact_type: row.requested_fact_type,
    question_text: row.question_text,
    request_reason: row.request_reason,
    status: row.status,
    answer_text: row.answer_text || null,
    evidence_ref: row.evidence_ref || null,
    requested_by_person_id: identityInteger(row.requested_by_person_id),
    answered_by_person_id: identityInteger(row.answered_by_person_id),
    created_at: row.created_at,
    answered_at: row.answered_at || null,
    closed_at: row.closed_at || null,
    updated_at: row.updated_at
  };
}

function publicReview(row) {
  return {
    id: identityInteger(row.id),
    work_package_id: identityInteger(row.work_package_id),
    review_type: row.review_type,
    scope_department_id: identityInteger(row.scope_department_id),
    decision: row.decision,
    basis_text: row.basis_text,
    package_revision_no: Number(row.package_revision_no),
    actor_person_id: identityInteger(row.actor_person_id),
    actor_role_code: row.actor_role_code,
    replaces_review_id: identityInteger(row.replaces_review_id),
    created_at: row.created_at
  };
}

function versionDocument(row) {
  const document = parseJson(row && row.process_content_json, null) || parseJson(row && row.content_json, null);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_UNREADABLE', '固定流程版本缺少可读取的结构化内容');
  }
  if (!require('./processNativeFormats').supports(text(row.schema_version)) || text(document.schema_version) !== text(row.schema_version)) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_VERSION_UNSUPPORTED', '数据治理支持已发布的原生V8及受支持V7流程版本，正文格式须与版本一致');
  }
  if (!text(row.content_hash) || digest(document) !== text(row.content_hash)) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED', '正式流程版本的内容摘要校验失败，请先核查来源完整性');
  return document;
}

function assertSourceBinding(packageRow, versionRow) {
  const document = versionDocument(versionRow);
  const currentHash = text(versionRow && versionRow.content_hash) || digest(document);
  if (currentHash !== text(packageRow && packageRow.source_content_hash)) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_CHANGED', '固定流程版本的内容摘要已经变化，工作包已停止写入，请先核查版本完整性', {
      expected_source_content_hash: text(packageRow && packageRow.source_content_hash),
      actual_source_content_hash: currentHash
    });
  }
  return document;
}

async function getVersion(executor, processVersionId, lock = false) {
  return await one(executor, `
    SELECT v.*, CAST(v.id AS CHAR) id,CAST(v.document_id AS CHAR) document_id,
      CAST(v.department_id AS CHAR) AS department_id, d.process_ref, d.document_title AS master_document_title
    FROM process_design_versions v
    LEFT JOIN process_design_documents d ON d.id=v.document_id
    WHERE v.id=CAST(? AS SIGNED)
    ${lock ? 'FOR UPDATE' : ''}
  `, [processVersionId]);
}

async function insertEvent(executor, packageId, eventType, actor, options = {}) {
  const safeActor = actorValue(actor);
  await executor.execute(`
    INSERT INTO process_data_governance_events
      (work_package_id, detail_id, fact_request_id, event_type,
       actor_person_id, actor_department_id, actor_role_code, basis_text, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    packageId,
    options.detailId || null,
    options.factRequestId || null,
    eventType,
    safeActor.personId,
    safeActor.departmentId,
    safeActor.roleCode,
    options.basis || null,
    JSON.stringify({...options.payload,actor_snapshot:{person_id:safeActor.personId,person_name:actor.personName||null,role_code:safeActor.roleCode}})
  ]);
}

async function queueProcessDataGovernanceCreationTask(executor, processVersionId, actor = {}) {
  assertProcessDataGovernanceWritable();
  // The existing caller supplies the queue transaction. A pool/autocommit caller
  // has no retained qualification locks; keep that unowned branch suspended.
  if (!executor || typeof executor.getConnection === 'function') {
    throw repositoryError(503, 'PROCESS_DATA_GOVERNANCE_TRANSACTION_REQUIRED', '创建任务需要调用方提供原事务连接');
  }
  const versionId = identityInteger(processVersionId);
  if (versionId === null) {
    throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_VERSION_REQUIRED', '流程版本标识必须是正整数');
  }
  const version = await getVersion(executor, versionId, false);
  if (!version || !['published', 'superseded'].includes(text(version.status))) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED', '只能为不可变的已发布流程版本建立治理工作包');
  }
  versionDocument(version);
  actor = await currentWriteActor(executor, actor);
  const safeActor = actorValue(actor);
  await executor.execute(`
    INSERT INTO process_data_governance_creation_tasks
      (task_ref, process_version_id, status, requested_by_person_id)
    VALUES (?, CAST(? AS SIGNED), 'queued', CAST(? AS SIGNED))
    ON DUPLICATE KEY UPDATE updated_at=updated_at
  `, [`pdg-task-v${versionId}`, versionId, safeActor.personId]);
  return publicTask(await one(executor, taskProjection+' WHERE process_version_id=CAST(? AS SIGNED)', [versionId]));
}

function makeProcessDataGovernanceRepository(pool) {
  async function packageRow(executor, packageId, lock = false) {
    return await one(executor, `
      SELECT p.*,${timestampColumns('p',["due_at","created_at","updated_at","completed_at"])}, CAST(p.id AS CHAR) id,CAST(p.process_version_id AS CHAR) process_version_id,
             CAST(p.source_document_id AS CHAR) source_document_id,CAST(p.owning_department_id AS CHAR) owning_department_id,
             d.name AS owning_department_name,
             v.document_no, v.document_title, v.edition, v.schema_version,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.process_content_json, '$.process.process_name')), v.document_title) AS process_name
      FROM process_data_governance_work_packages p
      JOIN process_design_versions v ON v.id=p.process_version_id
      LEFT JOIN departments d ON d.id=p.owning_department_id
      WHERE p.id=CAST(? AS SIGNED)
      ${lock ? 'FOR UPDATE OF p, v FOR SHARE OF d' : ''}
    `, [packageId]);
  }

  async function assertPackageRevision(executor, packageId, expectedRevision, lock = true) {
    const row = await packageRow(executor, packageId, lock);
    if (!row) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_PACKAGE_NOT_FOUND', '数据生命周期治理工作包不存在');
    if (Number(expectedRevision) !== Number(row.revision_no)) {
      throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_REVISION_CONFLICT', '工作包已经被其他人员更新，请重新载入后再处理', {
        actual_revision_no: Number(row.revision_no)
      });
    }
    if (['completed', 'source_withdrawn'].includes(text(row.status))) {
      throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_PACKAGE_READ_ONLY', '当前工作包已经完成或停止，只能查看');
    }
    return row;
  }

  async function assertPackageSourceBinding(executor, packageDataRow) {
    const version = await getVersion(executor, packageDataRow.process_version_id, false);
    if (!version) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_MISSING', '工作包绑定的固定流程版本不存在');
    if (!['published','superseded'].includes(text(version.status))) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED', '工作包的来源版本已撤回或不再是已发布版本，不能继续办理');
    return { version, document: assertSourceBinding(packageDataRow, version) };
  }

  async function activePackageStatus(executor, packageId) {
    const counts = await one(executor, `
      SELECT
        SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status='answered' THEN 1 ELSE 0 END) AS answered_count
      FROM process_data_governance_fact_requests
      WHERE work_package_id=?
    `, [packageId]);
    return Number(counts && counts.open_count || 0) > 0 ? 'waiting_business_fact' : 'mdm_governing';
  }

  async function materializeCreationTask(processVersionId, actor = {}) {
    assertProcessDataGovernanceWritable();
    const versionId = identityInteger(processVersionId);
    if (versionId === null) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_VERSION_REQUIRED', '流程版本标识必须是正整数');
    let qualifiedAttempt = false;
    try {
      return await withTransaction(pool, async connection => {
        const task = await one(connection, taskProjection+' WHERE process_version_id=CAST(? AS SIGNED) FOR UPDATE', [versionId]);
        if (!task) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_TASK_NOT_FOUND', '工作包创建任务不存在');
        const version = await getVersion(connection, versionId, true);
        actor = await currentWriteActor(connection, actor);
        qualifiedAttempt = true;
        if (!version || !['published', 'superseded'].includes(text(version.status))) {
          throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED', '来源流程版本不是不可变的已发布版本');
        }
        const document = versionDocument(version);
        const existing = await one(connection, `SELECT p.*,${timestampColumns('p',["due_at","created_at","updated_at","completed_at"])},CAST(p.id AS CHAR) id,CAST(p.process_version_id AS CHAR) process_version_id,
          CAST(p.source_document_id AS CHAR) source_document_id,CAST(p.owning_department_id AS CHAR) owning_department_id
          FROM process_data_governance_work_packages p WHERE process_version_id=CAST(? AS SIGNED)`, [versionId]);
        if (existing) {
          assertSourceBinding(existing, version);
          await connection.execute(`
            UPDATE process_data_governance_creation_tasks
            SET status='completed', completed_work_package_id=CAST(? AS SIGNED), completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP),
                last_error_code=NULL, last_error_message=NULL
            WHERE id=CAST(? AS SIGNED)
          `, [existing.id, task.id]);
          return { task: publicTask(await one(connection, taskProjection+' WHERE id=CAST(? AS SIGNED)', [task.id])), package: publicPackage(existing), idempotent: true };
        }
        await connection.execute(`
          UPDATE process_data_governance_creation_tasks
          SET status='creating', attempt_count=attempt_count+1, last_error_code=NULL, last_error_message=NULL
          WHERE id=CAST(? AS SIGNED)
        `, [task.id]);
        const risk = riskFromDocument(document);
        const safeActor = actorValue(actor);
        const sourceHash = text(version.content_hash) || digest(document);
        const dueAt = addBusinessDays(new Date(), risk.risk_level === 'high' ? 10 : 20);
        await rows(connection, `
          INSERT INTO process_data_governance_work_packages
            (package_ref, process_version_id, source_document_id, owning_department_id,
             source_content_hash, rule_version, risk_level, risk_basis_json, status,
             due_at, created_by_person_id, updated_by_person_id)
          VALUES (?, CAST(? AS SIGNED), CAST(? AS SIGNED), CAST(? AS SIGNED), ?, ?, ?, ?, 'mdm_preparing', ?, CAST(? AS SIGNED), CAST(? AS SIGNED))
        `, [
          `pdg-package-v${versionId}`,
          versionId,
          version.document_id || null,
          version.department_id || null,
          sourceHash,
          RULE_VERSION,
          risk.risk_level,
          JSON.stringify(risk),
          dueAt,
          safeActor.personId,
          safeActor.personId
        ]);
        const packageId = identityInteger((await one(connection,'SELECT CAST(LAST_INSERT_ID() AS CHAR) id')).id);
        await connection.execute(`
          UPDATE process_data_governance_creation_tasks
          SET status='completed', completed_work_package_id=CAST(? AS SIGNED), completed_at=CURRENT_TIMESTAMP,
              last_error_code=NULL, last_error_message=NULL
          WHERE id=CAST(? AS SIGNED)
        `, [packageId, task.id]);
        await insertEvent(connection, packageId, 'work_package_created', actor, {
          payload: { process_version_id: versionId, source_content_hash: sourceHash, rule_version: RULE_VERSION }
        });
        return {
          task: publicTask(await one(connection, taskProjection+' WHERE id=CAST(? AS SIGNED)', [task.id])),
          package: publicPackage(await packageRow(connection, packageId)),
          idempotent: false
        };
      });
    } catch (error) {
      // Preserve the original operational failure receipt after rollback. A
      // rejected principal never creates diagnostics or changes task state.
      // This bookkeeping retains the original autocommit ownership; it is not
      // a new business transaction or permission grant.
      if (qualifiedAttempt) {
        await pool.execute(`
          UPDATE process_data_governance_creation_tasks
          SET status='failed', last_error_code=?, last_error_message=?, next_retry_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)
          WHERE process_version_id=CAST(? AS SIGNED) AND status<>'completed'
        `, [text(error.code) || 'MATERIALIZE_FAILED', text(error.message).slice(0, 1000), versionId]).catch(() => {});
      }
      throw error;
    }
  }

  async function queueAndMaterialize(processVersionId, actor = {}) {
    assertProcessDataGovernanceWritable();
    await withTransaction(pool, connection => queueProcessDataGovernanceCreationTask(connection, processVersionId, actor));
    return await materializeCreationTask(processVersionId, actor);
  }

  async function listPublishedVersions() {
    const result = await rows(pool, `
      SELECT CAST(v.id AS CHAR) id, v.document_no, v.document_title, v.edition, v.status,
             CAST(v.department_id AS CHAR) department_id, d.name AS department_name, v.published_at,
             CAST(p.id AS CHAR) work_package_id
      FROM process_design_versions v
      LEFT JOIN departments d ON d.id=v.department_id
      LEFT JOIN process_data_governance_work_packages p ON p.process_version_id=v.id
      WHERE v.status IN ('published', 'superseded') AND v.schema_version IN (${SUPPORTED_SCHEMAS.map(() => '?').join(',')})
        AND JSON_UNQUOTE(JSON_EXTRACT(IF(JSON_VALID(v.process_content_json), v.process_content_json, 'null'), '$.schema_version'))=v.schema_version
      ORDER BY v.published_at DESC, v.id DESC
    `, SUPPORTED_SCHEMAS);
    return result.map(row => ({
      process_version_id: identityInteger(row.id), document_no: row.document_no,
      document_title: row.document_title, edition: row.edition, status: row.status,
      department_id: identityInteger(row.department_id),
      department_name: row.department_name || null, published_at: row.published_at,
      work_package_id: identityInteger(row.work_package_id)
    }));
  }

  async function listWorkPackages(processVersionId, actor = null) {
    const result = await rows(pool, `
      SELECT p.*,${timestampColumns('p',["due_at","created_at","updated_at","completed_at"])},CAST(p.id AS CHAR) id,CAST(p.process_version_id AS CHAR) process_version_id,
             CAST(p.source_document_id AS CHAR) source_document_id,CAST(p.owning_department_id AS CHAR) owning_department_id,
             d.name AS owning_department_name,
             v.document_no, v.document_title, v.edition, v.schema_version,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.process_content_json, '$.process.process_name')), v.document_title) AS process_name,
             (SELECT JSON_OBJECT(
                'total', COUNT(*),
                'pending', SUM(CASE WHEN gd.status='pending' THEN 1 ELSE 0 END),
                'needs_business_fact', SUM(CASE WHEN gd.status='needs_business_fact' THEN 1 ELSE 0 END),
                'confirmed', SUM(CASE WHEN gd.status='confirmed' THEN 1 ELSE 0 END)
              ) FROM process_data_governance_details gd WHERE gd.work_package_id=p.id) AS detail_counts_json,
             (SELECT JSON_OBJECT(
                'open', SUM(CASE WHEN fr.status='open' THEN 1 ELSE 0 END),
                'answered', SUM(CASE WHEN fr.status='answered' THEN 1 ELSE 0 END)
              ) FROM process_data_governance_fact_requests fr WHERE fr.work_package_id=p.id) AS fact_request_counts_json
      FROM process_data_governance_work_packages p
      JOIN process_design_versions v ON v.id=p.process_version_id
      LEFT JOIN departments d ON d.id=p.owning_department_id
      ${processVersionId ? 'WHERE p.process_version_id=?' : ''}
      ORDER BY p.updated_at DESC, p.id DESC
    `, processVersionId ? [processVersionId] : []);
    if (!actor) return result.map(publicPackage);
    const assigned = [];
    for (const item of result) if (await hasAssignedResponsibility(pool, actor, 'work_package', item.id, 'steward')) assigned.push(publicPackage(item));
    return assigned;
  }

  async function listBusinessFactRequests(departmentId, processVersionId, options = {}) {
    if (!departmentId) return [];
    const statuses = options.all ? ['open', 'answered', 'closed', 'cancelled'] : ['open'];
    const placeholders = statuses.map(() => '?').join(',');
    const result = await rows(pool, `
      SELECT fr.*,${timestampColumns('fr',["created_at","updated_at","answered_at","closed_at"])},CAST(fr.id AS CHAR) id,CAST(fr.work_package_id AS CHAR) work_package_id,
             CAST(fr.detail_id AS CHAR) detail_id,CAST(fr.target_department_id AS CHAR) target_department_id,
             CAST(fr.requested_by_person_id AS CHAR) AS requested_by_person_id, CAST(fr.answered_by_person_id AS CHAR) AS answered_by_person_id, gd.detail_ref, d.name AS target_department_name,
             CAST(p.process_version_id AS CHAR) process_version_id, p.package_ref, p.revision_no AS package_revision_no,
             v.document_no, v.document_title,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.process_content_json, '$.process.process_name')), v.document_title) AS process_name
      FROM process_data_governance_fact_requests fr
      JOIN process_data_governance_details gd ON gd.id=fr.detail_id
      JOIN process_data_governance_work_packages p ON p.id=fr.work_package_id
      JOIN process_design_versions v ON v.id=p.process_version_id
      LEFT JOIN departments d ON d.id=fr.target_department_id
      WHERE fr.target_department_id=? ${processVersionId ? 'AND p.process_version_id=?' : ''} AND fr.status IN (${placeholders})
      ORDER BY fr.updated_at DESC, fr.id DESC
    `, [departmentId, ...(processVersionId ? [processVersionId] : []), ...statuses]);
    return result.map(row => ({ ...publicFactRequest(row), process_version_id: identityInteger(row.process_version_id), package_ref: row.package_ref, package_revision_no: Number(row.package_revision_no), process_name: row.process_name, document_no: row.document_no }));
  }

  async function getWorkPackageDetail(packageId) {
    const packageDataRow = await packageRow(pool, packageId);
    if (!packageDataRow) return null;
    const version = await getVersion(pool, packageDataRow.process_version_id);
    const document = assertSourceBinding(packageDataRow, version);
    const sourceIndex = buildSourceIndex(document);
    const [detailRows, factRows, reviewRows, eventRows] = await Promise.all([
      rows(pool, `
        SELECT gd.*,${timestampColumns('gd',["created_at","updated_at"])},CAST(gd.id AS CHAR) id,CAST(gd.work_package_id AS CHAR) work_package_id,
          CAST(gd.responsible_department_id AS CHAR) responsible_department_id,d.name AS responsible_department_name
        FROM process_data_governance_details gd
        LEFT JOIN departments d ON d.id=gd.responsible_department_id
        WHERE gd.work_package_id=? ORDER BY gd.detail_type, gd.detail_ref
      `, [packageId]),
      rows(pool, `
        SELECT fr.*,${timestampColumns('fr',["created_at","updated_at","answered_at","closed_at"])},CAST(fr.id AS CHAR) id,CAST(fr.work_package_id AS CHAR) work_package_id,
          CAST(fr.detail_id AS CHAR) detail_id,CAST(fr.target_department_id AS CHAR) target_department_id,
          CAST(fr.requested_by_person_id AS CHAR) AS requested_by_person_id, CAST(fr.answered_by_person_id AS CHAR) AS answered_by_person_id, gd.detail_ref, d.name AS target_department_name
        FROM process_data_governance_fact_requests fr
        JOIN process_data_governance_details gd ON gd.id=fr.detail_id
        LEFT JOIN departments d ON d.id=fr.target_department_id
        WHERE fr.work_package_id=? ORDER BY fr.id DESC
      `, [packageId]),
      rows(pool, `SELECT r.*,${timestampColumns('r',["created_at"])},CAST(r.id AS CHAR) id,CAST(r.work_package_id AS CHAR) work_package_id,
        CAST(r.scope_department_id AS CHAR) scope_department_id,CAST(r.replaces_review_id AS CHAR) replaces_review_id,
        CAST(r.actor_person_id AS CHAR) AS actor_person_id FROM process_data_governance_reviews r WHERE work_package_id=? ORDER BY r.id DESC`, [packageId]),
      rows(pool, `SELECT e.*,${timestampColumns('e',["created_at"])},CAST(e.id AS CHAR) id,CAST(e.detail_id AS CHAR) detail_id,CAST(e.fact_request_id AS CHAR) fact_request_id,
        CAST(e.actor_department_id AS CHAR) actor_department_id,CAST(e.actor_person_id AS CHAR) AS actor_person_id
        FROM process_data_governance_events e WHERE work_package_id=? ORDER BY e.id DESC LIMIT 200`, [packageId])
    ]);
    const details = detailRows.map(row => {
      const item = publicDetail(row);
      return { ...item, source: sourceIndex.get(item.detail_ref) || { source_ref: item.source_ref } };
    });
    const packageView = publicPackage(packageDataRow);
    return {
      package: {
        id: packageView.id,
        package_ref: packageView.package_ref,
        process_version_id: packageView.process_version_id,
        process_name: packageView.process_name,
        document_no: packageView.document_no,
        edition: packageView.edition,
        owning_department_id: packageView.owning_department_id,
        owning_department_name: packageView.owning_department_name,
        source_content_hash: packageView.source_content_hash,
        rule_version: packageView.rule_version,
        risk_level: packageView.risk_level,
        risk_basis: packageView.risk_basis,
        status: packageView.status,
        revision_no: packageView.revision_no,
        due_at: packageView.due_at,
        completed_at: packageView.completed_at
      },
      source_version: {
        process_version_id: identityInteger(version.id),
        document_no: version.document_no || null,
        document_title: version.document_title || version.master_document_title || null,
        edition: version.edition || null,
        schema_version: version.schema_version,
        content_hash: version.content_hash || digest(document),
        process: document.process || {},
        immutable: true
      },
      details,
      fact_requests: factRows.map(row=>{
        const event=eventRows.find(entry=>entry.event_type==='business_fact_answered'&&String(entry.fact_request_id)===String(row.id)&&String(entry.actor_person_id)===String(row.answered_by_person_id));
        return {...publicFactRequest(row),answered_actor_snapshot:event?parseJson(event.payload_json)?.actor_snapshot||null:null};
      }),
      reviews: reviewRows.map(row=>{
        const event=eventRows.find(entry=>entry.event_type==='mdm_workgroup_review_approved'&&String(parseJson(entry.payload_json)?.review_id)===String(row.id));
        return {...publicReview(row),actor_snapshot:event?parseJson(event.payload_json)?.actor_snapshot||null:null};
      }),
      events: eventRows.map(row => ({
        id: identityInteger(row.id), event_type: row.event_type, detail_id: identityInteger(row.detail_id),
        fact_request_id: identityInteger(row.fact_request_id), actor_person_id: identityInteger(row.actor_person_id),
        actor_department_id: identityInteger(row.actor_department_id), actor_role_code: row.actor_role_code || null,
        basis_text: row.basis_text || null, payload: parseJson(row.payload_json, null), created_at: row.created_at
      }))
    };
  }

  async function executeNative(operation,packageId,expectedRevision,payload,actor,options,work,{factId=null,departmentId=null}={}) {
    assertProcessDataGovernanceWritable();
    const policy=require('./dataMapHandoffPolicy');
    if(!options?.request_id) throw repositoryError(422,'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED','本次办理缺少请求标识，请保留当前输入并更新客户端后重试');
    const requestId=policy.uuid(options.request_id);packageId=policy.id(packageId);policy.revision(expectedRevision);
    const action=operation==='native_fact_answer'?'fact_answer':operation==='native_fact_close'?'fact_close':'prepare';
    const body={request_id:requestId,expected_revision:expectedRevision,...payload};
    const changed={
      native_generate:{details:{candidate:{},candidate_json:{},status:null,revision_no:null},candidate_rule_code:null,source_snapshot_digest:null},
      native_detail:{details:{governance:payload.governance,governance_json:payload.governance,status:payload.status,responsible_department_id:payload.responsible_department_id,revision_no:null}},
      native_fact_create:{fact_requests:payload,details:{status:null,revision_no:null},requested_by_person_id:null},
      native_fact_answer:{fact_requests:payload,status:null,answered_by_person_id:null,answered_at:null},
      native_fact_close:{fact_requests:payload,status:null,closed_by_person_id:null,closed_at:null,details:{status:null,revision_no:null}}
    }[operation];
    const writeFields=[...nativeHistory.fields({ ...body,...changed,package:{status:null,revision_no:null,updated_by_person_id:null},events:{},detail_versions:{},fact_versions:{} })].sort();
    // Only department answer receipts use fact_read. MDM close receipts keep the
    // package read scope, so the original closer can inspect a terminal result.
    const scope={kind:'work_package',id:packageId,packageId,operation,writeFields,
      ...(factId?{nativeFactId:String(factId)}:{}),...(departmentId?{departmentId:String(departmentId)}:{}),
      ...(action==='fact_answer'?{factRequestId:String(factId),factKind:'work_package'}:{})};
    const requests=require('./dataMapHandoffRequests').createHandoffRequestStore(pool,{
      assertWritable:assertProcessDataGovernanceWritable,
      assertReady:async db=>{if(!(await require('./dataMapHandoffSchema').inspectHandoffSchema(db,{pinMetadata:true})).ready) throw repositoryError(503,'HANDOFF_SCHEMA_UNAVAILABLE','不可变历史与请求回执结构尚未准备，本次办理未提交');},
      assertNoCommittedEffects:async(db,uuid)=>{
        for(const table of ['process_data_governance_detail_versions','process_data_governance_fact_versions'])
          if(await one(db,`SELECT request_id FROM ${table} WHERE request_id=? LIMIT 1 FOR SHARE`,[uuid])) throw repositoryError(503,'HANDOFF_RECEIPT_INCONSISTENT','历史办理与请求回执不一致，请保留原请求标识核对');
      },
      authorize:async(db,currentActor,currentAction,currentScope,authorization={})=>{
        if(currentScope.operation!==operation||currentScope.packageId!==packageId) throw repositoryError(503,'HANDOFF_AUTHORITY_CONTEXT_MISMATCH','原生办理请求范围不一致');
        const reading=['read','fact_read'].includes(currentAction);
        if(!reading) await require('./dataMapHandoffGates').packageSource(db,packageId);
        return require('./dataMapHandoffAuthority').handoffActor(db,currentActor,currentAction,{
          packageId,departmentId,factRequestId:factId,factKind:'work_package',writeFields,
          lock:authorization.lock!==false
        });
      }
    });
    return requests.execute(action,scope,body,actor,async(db,control,reauthorize,context)=>{
      const pkg=await assertPackageRevision(db,packageId,expectedRevision);
      await require('./dataMapHandoffGates').packageSource(db,packageId);
      // The receipt is canonical JSON. Normalize MySQL Date values first so
      // initial HTTP response and replay contain identical timestamp strings.
      return JSON.parse(JSON.stringify(await work(db,pkg,reauthorize,context)));
    });
  }

  async function generateCandidates(packageId, expectedRevision, actor = {}, options = {}) {
    assertProcessDataGovernanceWritable();
    packageId=require('./dataMapHandoffPolicy').id(packageId);
    return await executeNative('native_generate',packageId,expectedRevision,{},actor,options,async (connection,packageDataRow,reauthorize,context) => {
      const { document } = await assertPackageSourceBinding(connection, packageDataRow);
      if (text(packageDataRow.rule_version) !== RULE_VERSION) {
        throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_RULE_VERSION_UNSUPPORTED', '工作包使用的候选规则版本与当前程序不一致，不能重新生成候选');
      }
      const candidates = buildGovernanceCandidates(document);
      const objectRows = await rows(connection, `
        SELECT CAST(id AS CHAR) id, object_key, object_name_cn, object_type,CAST(owner_dept_id AS CHAR) owner_dept_id
        FROM data_map_objects
        WHERE status IN ('draft','active')
      `);
      const sourceIndex = buildSourceIndex(document);
      const existingDetails = await rows(connection, 'SELECT detail_ref FROM process_data_governance_details WHERE work_package_id=?', [packageId]);
      actor = await reauthorize();
      const existingDetailRefs = new Set(existingDetails.map(item => text(item.detail_ref)));
      let created = 0;
      for (const candidate of candidates) {
        if (existingDetailRefs.has(candidate.detail_ref)) continue;
        const proposal = { ...candidate.candidate };
        if (candidate.detail_type === 'data_object_identity') {
          const source = sourceIndex.get(candidate.detail_ref) || {};
          const sourceName = text(source.data_name);
          proposal.match_suggestions = objectRows.filter(row =>
            text(row.object_key) === text(candidate.source_ref) || (sourceName && text(row.object_name_cn) === sourceName)
          ).map(row => ({
            object_id: identityInteger(row.id),
            match_type: text(row.object_key) === text(candidate.source_ref) ? 'exact_stable_key' : 'exact_name',
            object_key: row.object_key,
            object_name: row.object_name_cn,
            object_type: row.object_type,
            owner_department_id: identityInteger(row.owner_dept_id)
          }));
        }
        // Candidate content is computed from the locked fixed source. Check
        // its actual nested fields too; generic candidate permission cannot
        // hide a readonly constraint on one generated attribute.
        await require('./dataMapHandoffAuthority').handoffActor(connection,actor,'prepare',{
          packageId,writeFields:[...nativeHistory.fields({details:{candidate:proposal,candidate_json:proposal,
            detail_ref:candidate.detail_ref,detail_type:candidate.detail_type,source_ref:candidate.source_ref,
            parent_source_ref:candidate.parent_source_ref,source_snapshot_digest:candidate.source_digest,
            candidate_rule_code:candidate.rule_code,high_risk:candidate.high_risk,status:'pending',
            responsible_department_id:packageDataRow.owning_department_id,created_by_person_id:actorValue(actor).personId,
            updated_by_person_id:actorValue(actor).personId}})]
        });
        await rows(connection, `
          INSERT INTO process_data_governance_details
            (work_package_id, detail_ref, detail_type, source_ref, parent_source_ref,
             responsible_department_id, source_snapshot_digest, candidate_rule_code,
             candidate_json, status, high_risk, created_by_person_id, updated_by_person_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        `, [
          packageId, candidate.detail_ref, candidate.detail_type, candidate.source_ref,
          candidate.parent_source_ref, packageDataRow.owning_department_id || null,
          candidate.source_digest, candidate.rule_code, JSON.stringify(proposal), candidate.high_risk ? 1 : 0,
          actorValue(actor).personId, actorValue(actor).personId
        ]);
        const inserted=await one(connection,'SELECT CAST(LAST_INSERT_ID() AS CHAR) id');
        await nativeHistory.captureDetail(connection,await nativeHistory.detail(connection,inserted.id,packageId),actor,context.request_id,'native_created_append_only');
        existingDetailRefs.add(candidate.detail_ref);
        created += 1;
      }
      if (created > 0) {
        await connection.execute(`
          UPDATE process_data_governance_work_packages
          SET status='mdm_governing', revision_no=revision_no+1, updated_by_person_id=?
          WHERE id=?
        `, [actorValue(actor).personId, packageId]);
        await insertEvent(connection, packageId, 'deterministic_candidates_generated', actor, {
          payload: { created, total_candidates: candidates.length, rule_version: RULE_VERSION, automatic_confirmation: false }
        });
      }
      return {
        created,
        total_candidates: candidates.length,
        idempotent: created === 0,
        automatic_confirmation: false,
        package: publicPackage(await packageRow(connection, packageId))
      };
    });
  }

  async function updateDetail(packageId, detailId, expectedRevision, payload, actor = {}, options = {}) {
    assertProcessDataGovernanceWritable();
    const status = text(payload && payload.status);
    if (!DETAIL_STATUSES.includes(status)) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_DETAIL_STATUS_INVALID', '明细处理状态无效');
    if (status === 'needs_business_fact') {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_REQUIRED', '需要业务事实时必须填写具体问题并定向发给一个部门');
    }
    const governance = payload && payload.governance;
    if (!governance || typeof governance !== 'object' || Array.isArray(governance)) {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_DECISION_REQUIRED', 'MDM治理结论不能为空');
    }
    if (['confirmed', 'not_applicable', 'terminated'].includes(status) && !text(governance.basis)) {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_BASIS_REQUIRED', '确认、不适用或终止时必须填写依据');
    }
    const policy=require('./dataMapHandoffPolicy');packageId=policy.id(packageId);detailId=policy.id(detailId);
    const responsible=payload.responsible_department_id==null||payload.responsible_department_id===''?null:policy.id(payload.responsible_department_id);
    return await executeNative('native_detail',packageId,expectedRevision,{detail_id:detailId,status,governance,responsible_department_id:responsible},actor,options,async (connection,packageDataRow,reauthorize,context) => {
      const detail = await nativeHistory.detail(connection,detailId,packageId);
      if (!detail) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_DETAIL_NOT_FOUND', '治理明细不存在');
      const unresolvedRequest = await one(connection, `
        SELECT id, status FROM process_data_governance_fact_requests
        WHERE detail_id=? AND status IN ('open','answered') LIMIT 1 FOR UPDATE
      `, [detailId]);
      if (unresolvedRequest && status !== 'needs_business_fact') {
        throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_UNRESOLVED', '该明细仍有未关闭的业务事实问题，不能先行形成治理结论');
      }
      const responsibleDepartmentId = responsible || packageDataRow.owning_department_id || null;
      actor = await reauthorize();
      await nativeHistory.captureDetail(connection,detail,actor,context.request_id,'captured_current_only');
      await connection.execute(`
        UPDATE process_data_governance_details
        SET governance_json=?, status=?, responsible_department_id=?, revision_no=revision_no+1,
            updated_by_person_id=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [JSON.stringify(governance), status, responsibleDepartmentId, actorValue(actor).personId, detailId]);
      await nativeHistory.captureDetail(connection,await nativeHistory.detail(connection,detailId,packageId),actor,context.request_id,'append_only_since_native_write',detail);
      const nextPackageStatus = await activePackageStatus(connection, packageId);
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status=?, revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [nextPackageStatus, actorValue(actor).personId, packageId]);
      await insertEvent(connection, packageId, 'governance_detail_decided', actor, {
        detailId,
        basis: text(governance.basis),
        payload: { status, responsible_department_id: responsibleDepartmentId }
      });
      return {
        package: publicPackage(await packageRow(connection, packageId)),
        detail: publicDetail(await nativeHistory.detail(connection,detailId,packageId))
      };
    });
  }

  async function createFactRequest(packageId, expectedRevision, payload, actor = {}, options = {}) {
    assertProcessDataGovernanceWritable();
    const policy=require('./dataMapHandoffPolicy');packageId=policy.id(packageId);
    const detailId = policy.id(payload && payload.detail_id);
    const targetDepartmentId = policy.id(payload && payload.target_department_id);
    const factType = text(payload && payload.requested_fact_type);
    const question = text(payload && payload.question_text);
    const reason = text(payload && payload.request_reason);
    if (!factType || !question || !reason) {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_INCOMPLETE', '事实类型、问题和提出原因均不能为空');
    }
    return await executeNative('native_fact_create',packageId,expectedRevision,{detail_id:detailId,target_department_id:targetDepartmentId,requested_fact_type:factType,question_text:question,request_reason:reason},actor,options,async (connection,packageDataRow,reauthorize,context) => {
      const detail = await nativeHistory.detail(connection,detailId,packageId);
      if (!detail) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_DETAIL_NOT_FOUND', '治理明细不存在');
      const targetDepartment = await one(connection, "SELECT id FROM departments WHERE id=? AND status='active' FOR SHARE", [targetDepartmentId]);
      if (!targetDepartment) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_TARGET_INVALID', '目标部门不存在或当前不可用');
      const existing = await one(connection, `
        SELECT id FROM process_data_governance_fact_requests
        WHERE detail_id=? AND status IN ('open','answered') LIMIT 1 FOR UPDATE
      `, [detailId]);
      if (existing) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_EXISTS', '该明细已有未关闭的业务事实问题');
      const nextRevision = Number(expectedRevision) + 1;
      actor = await reauthorize();
      await nativeHistory.captureDetail(connection,detail,actor,context.request_id,'captured_current_only');
      const result = await rows(connection, `
        INSERT INTO process_data_governance_fact_requests
          (request_ref, work_package_id, detail_id, target_department_id,
           requested_fact_type, question_text, request_reason, requested_by_person_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [`pdg-fact-p${packageId}-d${detailId}-r${nextRevision}`, packageId, detailId, targetDepartmentId, factType, question, reason, actorValue(actor).personId]);
      const requestId = (await one(connection,'SELECT CAST(LAST_INSERT_ID() AS CHAR) id')).id;
      await connection.execute(`
        UPDATE process_data_governance_details
        SET status='needs_business_fact', revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [actorValue(actor).personId, detailId]);
      await nativeHistory.captureDetail(connection,await nativeHistory.detail(connection,detailId,packageId),actor,context.request_id,'append_only_since_native_write',detail);
      await nativeHistory.captureFact(connection,await nativeHistory.fact(connection,requestId),actor,context.request_id,'native_created_append_only');
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status='waiting_business_fact', revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [actorValue(actor).personId, packageId]);
      await insertEvent(connection, packageId, 'business_fact_requested', actor, {
        detailId, factRequestId: requestId, basis: reason,
        payload: { target_department_id: targetDepartmentId, requested_fact_type: factType, question_text: question }
      });
      return {
        package: publicPackage(await packageRow(connection, packageId)),
        fact_request: publicFactRequest(await nativeHistory.fact(connection,requestId))
      };
    });
  }

  async function getFactRequest(requestId, lock = false, executor = pool) {
    return await one(executor, `
      SELECT fr.*,${timestampColumns('fr',["created_at","updated_at","answered_at","closed_at"])},CAST(fr.id AS CHAR) id,CAST(fr.work_package_id AS CHAR) work_package_id,
        CAST(fr.detail_id AS CHAR) detail_id,CAST(fr.target_department_id AS CHAR) target_department_id,
        CAST(fr.requested_by_person_id AS CHAR) AS requested_by_person_id, CAST(fr.answered_by_person_id AS CHAR) AS answered_by_person_id,
        gd.detail_ref, gd.detail_type, gd.source_ref,CAST(p.process_version_id AS CHAR) process_version_id,p.revision_no AS package_revision_no,
             d.name AS target_department_name
      FROM process_data_governance_fact_requests fr
      JOIN process_data_governance_details gd ON gd.id=fr.detail_id
      JOIN process_data_governance_work_packages p ON p.id=fr.work_package_id
      LEFT JOIN departments d ON d.id=fr.target_department_id
      WHERE fr.id=?
      ${lock ? 'FOR UPDATE OF fr, gd, p FOR SHARE OF d' : ''}
    `, [requestId]);
  }

  async function getFactRequestContext(requestId) {
    const factRow = await getFactRequest(requestId);
    if (!factRow) return null;
    const packageDataRow = await packageRow(pool, factRow.work_package_id);
    if (!packageDataRow) return null;
    const version = await getVersion(pool, packageDataRow.process_version_id);
    const document = assertSourceBinding(packageDataRow, version);
    const source = buildSourceIndex(document).get(text(factRow.detail_ref)) || { source_ref: factRow.source_ref };
    const answerEvent=factRow.answered_by_person_id?await one(pool,`SELECT payload_json FROM process_data_governance_events
      WHERE fact_request_id=? AND actor_person_id=? AND event_type='business_fact_answered' ORDER BY id DESC LIMIT 1`,[requestId,factRow.answered_by_person_id]):null;
    return {
      package: publicPackage(packageDataRow),
      source_version: {
        process_version_id: identityInteger(version.id),
        document_no: version.document_no || null,
        document_title: version.document_title || version.master_document_title || null,
        edition: version.edition || null,
        schema_version: version.schema_version,
        content_hash: version.content_hash || digest(document),
        process: document.process || {},
        immutable: true
      },
      fact_request: {
        ...publicFactRequest(factRow),
        answered_actor_snapshot:answerEvent?parseJson(answerEvent.payload_json)?.actor_snapshot||null:null,
        process_version_id: identityInteger(factRow.process_version_id),
        package_revision_no: Number(factRow.package_revision_no)
      },
      source_context: {
        detail_id: identityInteger(factRow.detail_id),
        detail_ref: factRow.detail_ref,
        detail_type: factRow.detail_type,
        source
      }
    };
  }

  async function respondFactRequest(requestId, expectedRevision, payload, actor = {}, options = {}) {
    assertProcessDataGovernanceWritable();
    const answer = text(payload && payload.answer_text);
    const evidence = text(payload && payload.evidence_ref);
    if (!answer) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_ANSWER_REQUIRED', '业务事实答复不能为空');
    requestId=require('./dataMapHandoffPolicy').id(requestId);
    const selected=await nativeHistory.fact(pool,requestId,false);
    if(!selected) throw repositoryError(404,'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND','业务事实问题不存在');
    return await executeNative('native_fact_answer',selected.work_package_id,expectedRevision,{fact_request_id:requestId,answer_text:answer,evidence_ref:evidence||null},actor,options,async (connection,packageDataRow,reauthorize,context) => {
      const fact = await nativeHistory.fact(connection,requestId);
      if(!fact||fact.work_package_id!==String(packageDataRow.id)) throw repositoryError(409,'HANDOFF_SCOPE_CONFLICT','事实问题所属工作包发生变化');
      if (text(fact.status) !== 'open') throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_OPEN', '该业务事实问题当前不能答复');
      actor = await reauthorize();
      if (!sameIdentityInteger(actor.departmentId, fact.target_department_id)) {
        throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED', '只能答复发给本人所属部门的事实问题');
      }
      await nativeHistory.captureFact(connection,fact,actor,context.request_id,'captured_current_only');
      await connection.execute(`
        UPDATE process_data_governance_fact_requests
        SET status='answered', answer_text=?, evidence_ref=?, answered_by_person_id=?, answered_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [answer, evidence || null, actorValue(actor).personId, requestId]);
      await nativeHistory.captureFact(connection,await nativeHistory.fact(connection,requestId),actor,context.request_id,'append_only_since_native_write');
      const nextPackageStatus = await activePackageStatus(connection, fact.work_package_id);
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status=?, revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [nextPackageStatus, actorValue(actor).personId, fact.work_package_id]);
      await insertEvent(connection, fact.work_package_id, 'business_fact_answered', actor, {
        detailId: fact.detail_id, factRequestId: requestId, basis: evidence || null,
        payload: { target_department_id: fact.target_department_id }
      });
      return {
        package: publicPackage(await packageRow(connection, fact.work_package_id)),
        fact_request: publicFactRequest(await nativeHistory.fact(connection,requestId))
      };
    },{factId:requestId,departmentId:selected.target_department_id});
  }

  async function closeFactRequest(requestId, expectedRevision, payload, actor = {}, options = {}) {
    assertProcessDataGovernanceWritable();
    const basis = text(payload && payload.basis);
    if (!basis) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_CLOSE_BASIS_REQUIRED', '关闭业务事实问题时必须填写采用情况和依据');
    requestId=require('./dataMapHandoffPolicy').id(requestId);
    const selected=await nativeHistory.fact(pool,requestId,false);
    if(!selected) throw repositoryError(404,'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND','业务事实问题不存在');
    return await executeNative('native_fact_close',selected.work_package_id,expectedRevision,{fact_request_id:requestId,basis},actor,options,async (connection,packageDataRow,reauthorize,context) => {
      const fact = await nativeHistory.fact(connection,requestId);
      if(!fact||fact.work_package_id!==String(packageDataRow.id)) throw repositoryError(409,'HANDOFF_SCOPE_CONFLICT','事实问题所属工作包发生变化');
      if (text(fact.status) !== 'answered') throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_ANSWERED', '业务部门尚未答复，不能关闭事实问题');
      const detail=await nativeHistory.detail(connection,fact.detail_id,fact.work_package_id);
      actor = await reauthorize();
      await nativeHistory.captureFact(connection,fact,actor,context.request_id,'captured_current_only');
      await nativeHistory.captureDetail(connection,detail,actor,context.request_id,'captured_current_only');
      await connection.execute(`
        UPDATE process_data_governance_fact_requests
        SET status='closed', closed_by_person_id=?, closed_at=CURRENT_TIMESTAMP WHERE id=?
      `, [actorValue(actor).personId, requestId]);
      await connection.execute(`
        UPDATE process_data_governance_details
        SET status='pending', revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [actorValue(actor).personId, fact.detail_id]);
      await nativeHistory.captureFact(connection,await nativeHistory.fact(connection,requestId),actor,context.request_id,'append_only_since_native_write',{close_basis:basis});
      await nativeHistory.captureDetail(connection,await nativeHistory.detail(connection,fact.detail_id,fact.work_package_id),actor,context.request_id,'append_only_since_native_write',detail);
      const nextPackageStatus = await activePackageStatus(connection, fact.work_package_id);
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status=?, revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [nextPackageStatus, actorValue(actor).personId, fact.work_package_id]);
      await insertEvent(connection, fact.work_package_id, 'business_fact_closed', actor, {
        detailId: fact.detail_id, factRequestId: requestId, basis
      });
      return {
        package: publicPackage(await packageRow(connection, fact.work_package_id)),
        fact_request: publicFactRequest(await nativeHistory.fact(connection,requestId))
      };
    },{factId:requestId});
  }

  async function completeWorkPackage(packageId, expectedRevision, basis, actor = {}, { request_id: requestId } = {}) {
    assertProcessDataGovernanceWritable();
    if (!requestId) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED', '本次审核缺少请求标识，请保留当前输入并更新客户端后重试');
    const policy = require('./dataMapHandoffPolicy');
    requestId = policy.uuid(requestId);
    packageId = policy.id(packageId);
    policy.revision(expectedRevision);
    const reviewBasis = text(basis);
    if (!reviewBasis) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_REVIEW_BASIS_REQUIRED', 'MDM工作组审核依据不能为空');
    const authority = require('./dataMapHandoffAuthority');
    const scope = { kind: 'work_package', id: packageId, packageId, operation: 'native_review' };
    const body = { request_id: requestId, expected_revision: Number(expectedRevision), basis: reviewBasis };
    const requests = require('./dataMapHandoffRequests').createHandoffRequestStore(pool, {
      assertWritable: assertProcessDataGovernanceWritable,
      assertReady: async connection => {
        if (!(await require('./dataMapHandoffSchema').inspectHandoffSchema(connection,{pinMetadata:true})).ready) throw repositoryError(503, 'HANDOFF_SCHEMA_UNAVAILABLE', '承接结构或约束尚未准备，原生审核尚未提交');
      },
      authorize: async (connection, currentActor, action, currentScope, options = {}) => {
        if (currentScope.operation !== 'native_review' || currentScope.packageId !== packageId) throw repositoryError(503, 'HANDOFF_AUTHORITY_CONTEXT_MISMATCH', '审核请求范围不一致');
        if (action === 'read' && options.lock === false) return authority.handoffActor(connection, currentActor, 'read', { packageId, lock: false });
        if (action !== 'approve') throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_COMPLETE_DENIED', '原生审核只允许当前工作组审核资格办理');
        // Use the shared assignment -> identity order before re-entering the
        // original completion rule; both qualifications must hold to commit.
        const qualified = await authority.handoffActor(connection, currentActor, 'approve', { packageId, writeFields: ['request_id', 'expected_revision', 'review', 'decision', 'basis', 'basis_text', 'binding', 'generation_task'] });
        await currentWriteActor(connection, qualified, 'complete', packageId);
        return qualified;
      },
      assertNoCommittedEffects: async (connection, currentRequestId) => {
        const found = await rows(connection, 'SELECT binding_id FROM process_data_governance_review_bindings WHERE request_id=? FOR SHARE', [currentRequestId]);
        if (found.length) throw repositoryError(503, 'HANDOFF_RECEIPT_INCONSISTENT', '审核办理与请求回执不一致，请保留原请求标识核对');
      }
    });
    return requests.execute('approve', scope, body, actor, async (connection, control, reauthorize, context) => {
      // The global request store owns prepared registration, the graph anchor,
      // business locks and the final atomic business+receipt commit.
      await assertPackageRevision(connection, packageId, expectedRevision);
      // New binding/receipt identities must remain exact even if the legacy
      // package reader returns numeric BIGINTs through mysql2 defaults.
      const {pkg:packageDataRow}=await require('./dataMapHandoffGates').packageSource(connection,packageId);
      const detailRows = await rows(connection, 'SELECT id, detail_ref, status FROM process_data_governance_details WHERE work_package_id=? FOR UPDATE', [packageId]);
      if (!detailRows.length) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_DETAILS_REQUIRED', '尚未生成治理明细，不能完成工作包');
      const incomplete = detailRows.filter(item => !COMPLETE_DETAIL_STATUSES.has(text(item.status)));
      const unresolvedFacts = await rows(connection, `
        SELECT id, request_ref, status FROM process_data_governance_fact_requests
        WHERE work_package_id=? AND status IN ('open','answered') FOR UPDATE
      `, [packageId]);
      if (incomplete.length || unresolvedFacts.length) {
        throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_REVIEW_BLOCKED', '仍有待定明细或未关闭的业务事实问题，不能完成MDM工作组审核', {
          incomplete_detail_refs: incomplete.map(item => item.detail_ref),
          unresolved_fact_request_refs: unresolvedFacts.map(item => item.request_ref)
        });
      }
      const nextRevision = Number(packageDataRow.revision_no) + 1;
      if(require('./terminologyGovernancePolicy').enabled()){
        const usages=require('./terminologyUsages');
        await usages.gate(connection,await usages.loadTarget(connection,{target_type:'work_package',target_id:packageId},true));
      }
      actor = await reauthorize();
      const safeActor = actorValue(actor);
      if(require('./terminologyGovernancePolicy').enabled()){
        const usages=require('./terminologyUsages');
        await usages.freeze(connection,await usages.loadTarget(connection,{target_type:'work_package',target_id:packageId},true),safeActor.personId);
      }
      await rows(connection, `
        INSERT INTO process_data_governance_reviews
          (work_package_id, review_type, decision, basis_text, package_revision_no, actor_person_id, actor_role_code)
        VALUES (?, 'mdm_workgroup', 'approved', ?, ?, ?, ?)
      `, [packageId, reviewBasis, nextRevision, safeActor.personId, safeActor.roleCode || 'mdm_lead']);
      const exactReview = await one(connection, 'SELECT CAST(LAST_INSERT_ID() AS CHAR) id');
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status='completed', revision_no=?, completed_at=CURRENT_TIMESTAMP, updated_by_person_id=? WHERE id=?
      `, [nextRevision, safeActor.personId, packageId]);
      await insertEvent(connection, packageId, 'mdm_workgroup_review_approved', actor, {
        basis: reviewBasis,
        payload: { review_id: exactReview.id, package_revision_no: nextRevision, request_id: context.request_id }
      });
      const handoff = await require('./dataMapHandoffBindings').createLegacyAdapter({writeFields:['review','basis','binding','generation_task']})
        .captureNativeReview(connection,{package_id:String(packageId),native_review_id:exactReview.id},actor,
          {request_id:context.request_id,package_id:String(packageId),native_completion:true,native_review_id:exactReview.id});
      return JSON.parse(JSON.stringify({
        package: {...publicPackage(await packageRow(connection, packageId)),id:packageId,process_version_id:packageDataRow.process_version_id,source_document_id:packageDataRow.source_document_id,
          owning_department_id:packageDataRow.owning_department_id,created_by_person_id:packageDataRow.created_by_person_id,updated_by_person_id:String(safeActor.personId)},
        review: {...publicReview(await one(connection, `SELECT r.*,${timestampColumns('r',["created_at"])}, CAST(r.actor_person_id AS CHAR) AS actor_person_id FROM process_data_governance_reviews r WHERE id=?`, [exactReview.id])), id:exactReview.id,work_package_id:packageId,actor_person_id:String(safeActor.personId)},
        handoff: {...handoff, generation_state:'pending', automatically_published:false},
        business_outcome:'native_review_bound_pending_generation'
      }));
    });
  }

  async function listWorkbenchItems(actor = {}, processVersionId) {
    if (isProcessDataGovernanceReadOnly()) return [];
    const roleCodes = actor.roleCodes instanceof Set ? actor.roleCodes : new Set(actor.roleCodes || []);
    if (roleCodes.has('admin')) return [];
    const items = [];
    if (roleCodes.has('department_contact') || roleCodes.has('department_mdm_reviewer')) {
      const facts = await listBusinessFactRequests(actor.departmentId, processVersionId);
      for (const fact of facts) {
        items.push({
          id: `process-data-fact:${fact.id}`,
          type: 'process_data_business_fact',
          governanceType: 'process_data_governance',
          title: `补充业务事实：${fact.process_name || fact.document_no || fact.package_ref}`,
          roleHint: roleCodes.has('department_contact') ? 'department_contact' : 'department_mdm_reviewer',
          urgency: 'medium',
          target: `#/processGovernance?workspace=dataGovernance&factRequest=${fact.id}`,
          actionLabel: '答复事实问题',
          sample: fact.question_text,
          source: fact.detail_ref,
          department: fact.target_department_name,
          currentStatus: fact.status,
          nextStep: '只回答问题和提供依据，不做主数据或生命周期治理判断',
          canAct: true,
          sourceRoles: ['department_contact', 'department_mdm_reviewer']
        });
      }
    }
    if (roleCodes.has('mdm_lead') || roleCodes.has('mdm_steward')) {
      const packages = await listWorkPackages(processVersionId, roleCodes.has('mdm_lead') ? null : actor);
      for (const item of packages.filter(row => !['completed', 'source_withdrawn'].includes(row.status))) {
        const openFacts = Number(item.fact_request_counts && (item.fact_request_counts.open || 0) || 0);
        const answeredFacts = Number(item.fact_request_counts && (item.fact_request_counts.answered || 0) || 0);
        items.push({
          id: `process-data-package:${item.id}`,
          type: 'process_data_governance_package',
          governanceType: 'process_data_governance',
          title: `数据生命周期治理：${item.process_name || item.document_no || item.package_ref}`,
          roleHint: roleCodes.has('mdm_lead') ? 'mdm_lead' : 'mdm_steward',
          urgency: item.risk_level === 'high' ? 'high' : 'medium',
          target: `#/processGovernance?workspace=dataGovernance&package=${item.id}`,
          actionLabel: answeredFacts ? '核对业务答复' : openFacts ? '查看等待事项' : '继续治理',
          sample: answeredFacts
            ? `有${answeredFacts}个业务事实答复等待MDM工作组核对。`
            : openFacts
              ? `有${openFacts}个业务事实问题等待部门答复。`
              : '核对待定对象、匹配建议、关键字段和生命周期规则。',
          source: `process_version_id:${item.process_version_id}`,
          department: item.owning_department_name,
          currentStatus: item.status,
          nextStep: answeredFacts ? '核对定向业务答复并形成MDM治理判断' : openFacts ? '等待定向业务答复' : '完成MDM治理判断并记录依据',
          canAct: true,
          sourceRoles: [roleCodes.has('mdm_lead') ? 'mdm_lead' : 'mdm_steward']
        });
      }
    }
    return items;
  }

  return {
    closeFactRequest,
    completeWorkPackage,
    createFactRequest,
    generateCandidates,
    getFactRequest,
    getFactRequestContext,
    getWorkPackageDetail,
    listBusinessFactRequests,
    listPublishedVersions,
    listWorkbenchItems,
    listWorkPackages,
    materializeCreationTask,
    queueAndMaterialize,
    respondFactRequest,
    updateDetail,
    canReadAssignedPackage: (packageId, actor) => hasAssignedResponsibility(pool, actor, 'work_package', packageId, 'steward')
  };
}

module.exports = {
  readFixedPublishedVersion: getVersion,
  makeProcessDataGovernanceRepository,
  parseJson,
  publicDetail,
  publicFactRequest,
  publicPackage,
  publicTask,
  queueProcessDataGovernanceCreationTask,
  repositoryError,
  versionDocument,
  withTransaction
};
