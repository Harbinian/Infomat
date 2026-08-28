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
  return result;
}

async function one(executor, sql, params = []) {
  const result = await rows(executor, sql, params);
  return result[0] || null;
}

async function withTransaction(executor, action) {
  if (!executor || typeof executor.getConnection !== 'function') return await action(executor);
  const connection = await executor.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback().catch(() => {});
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
    personId: Number(actor.personId || actor.userId || 0) || null,
    departmentId: Number(actor.departmentId || 0) || null,
    roleCode: text(actor.roleCode) || null
  };
}

function publicTask(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    task_ref: row.task_ref,
    process_version_id: Number(row.process_version_id),
    status: row.status,
    attempt_count: Number(row.attempt_count || 0),
    last_error_code: row.last_error_code || null,
    last_error_message: row.last_error_message || null,
    completed_work_package_id: row.completed_work_package_id == null ? null : Number(row.completed_work_package_id),
    next_retry_at: row.next_retry_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at || null
  };
}

function publicPackage(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    package_ref: row.package_ref,
    process_version_id: Number(row.process_version_id),
    source_document_id: row.source_document_id == null ? null : Number(row.source_document_id),
    owning_department_id: row.owning_department_id == null ? null : Number(row.owning_department_id),
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
    id: Number(row.id),
    work_package_id: Number(row.work_package_id),
    detail_ref: row.detail_ref,
    detail_type: row.detail_type,
    source_ref: row.source_ref,
    parent_source_ref: row.parent_source_ref || null,
    responsible_department_id: row.responsible_department_id == null ? null : Number(row.responsible_department_id),
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
    id: Number(row.id),
    request_ref: row.request_ref,
    work_package_id: Number(row.work_package_id),
    detail_id: Number(row.detail_id),
    detail_ref: row.detail_ref || null,
    target_department_id: Number(row.target_department_id),
    target_department_name: row.target_department_name || null,
    requested_fact_type: row.requested_fact_type,
    question_text: row.question_text,
    request_reason: row.request_reason,
    status: row.status,
    answer_text: row.answer_text || null,
    evidence_ref: row.evidence_ref || null,
    requested_by_person_id: row.requested_by_person_id == null ? null : Number(row.requested_by_person_id),
    answered_by_person_id: row.answered_by_person_id == null ? null : Number(row.answered_by_person_id),
    created_at: row.created_at,
    answered_at: row.answered_at || null,
    closed_at: row.closed_at || null,
    updated_at: row.updated_at
  };
}

function publicReview(row) {
  return {
    id: Number(row.id),
    work_package_id: Number(row.work_package_id),
    review_type: row.review_type,
    scope_department_id: row.scope_department_id == null ? null : Number(row.scope_department_id),
    decision: row.decision,
    basis_text: row.basis_text,
    package_revision_no: Number(row.package_revision_no),
    actor_person_id: row.actor_person_id == null ? null : Number(row.actor_person_id),
    actor_role_code: row.actor_role_code,
    replaces_review_id: row.replaces_review_id == null ? null : Number(row.replaces_review_id),
    created_at: row.created_at
  };
}

function versionDocument(row) {
  const document = parseJson(row && row.process_content_json, null) || parseJson(row && row.content_json, null);
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_UNREADABLE', '固定流程版本缺少可读取的结构化内容');
  }
  if (text(row.schema_version) !== 'process-governance-v7' && text(document.schema_version) !== 'process-governance-v7') {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_VERSION_UNSUPPORTED', '当前候选实现只承接process-governance-v7固定版本');
  }
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
    SELECT v.*, d.process_ref, d.document_title AS master_document_title
    FROM process_design_versions v
    LEFT JOIN process_design_documents d ON d.id=v.document_id
    WHERE v.id=?
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
    options.payload ? JSON.stringify(options.payload) : null
  ]);
}

async function queueProcessDataGovernanceCreationTask(executor, processVersionId, actor = {}) {
  const versionId = Number(processVersionId);
  if (!Number.isInteger(versionId) || versionId < 1) {
    throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_VERSION_REQUIRED', '流程版本标识必须是正整数');
  }
  const version = await getVersion(executor, versionId, false);
  if (!version || !['published', 'superseded'].includes(text(version.status))) {
    throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED', '只能为不可变的已发布流程版本建立治理工作包');
  }
  const safeActor = actorValue(actor);
  await executor.execute(`
    INSERT INTO process_data_governance_creation_tasks
      (task_ref, process_version_id, status, requested_by_person_id)
    VALUES (?, ?, 'queued', ?)
    ON DUPLICATE KEY UPDATE updated_at=updated_at
  `, [`pdg-task-v${versionId}`, versionId, safeActor.personId]);
  return publicTask(await one(executor, 'SELECT * FROM process_data_governance_creation_tasks WHERE process_version_id=?', [versionId]));
}

function makeProcessDataGovernanceRepository(pool) {
  async function packageRow(executor, packageId, lock = false) {
    return await one(executor, `
      SELECT p.*, d.department_name AS owning_department_name,
             v.document_no, v.document_title, v.edition, v.schema_version,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.process_content_json, '$.process.process_name')), v.document_title) AS process_name
      FROM process_data_governance_work_packages p
      JOIN process_design_versions v ON v.id=p.process_version_id
      LEFT JOIN departments d ON d.id=p.owning_department_id
      WHERE p.id=?
      ${lock ? 'FOR UPDATE' : ''}
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
    const version = await getVersion(executor, Number(packageDataRow.process_version_id), false);
    if (!version) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_SOURCE_MISSING', '工作包绑定的固定流程版本不存在');
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
    const versionId = Number(processVersionId);
    try {
      return await withTransaction(pool, async connection => {
        const task = await one(connection, 'SELECT * FROM process_data_governance_creation_tasks WHERE process_version_id=? FOR UPDATE', [versionId]);
        if (!task) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_TASK_NOT_FOUND', '工作包创建任务不存在');
        const existing = await one(connection, 'SELECT * FROM process_data_governance_work_packages WHERE process_version_id=?', [versionId]);
        if (existing) {
          await connection.execute(`
            UPDATE process_data_governance_creation_tasks
            SET status='completed', completed_work_package_id=?, completed_at=COALESCE(completed_at, CURRENT_TIMESTAMP),
                last_error_code=NULL, last_error_message=NULL
            WHERE id=?
          `, [existing.id, task.id]);
          return { task: publicTask(await one(connection, 'SELECT * FROM process_data_governance_creation_tasks WHERE id=?', [task.id])), package: publicPackage(existing), idempotent: true };
        }
        await connection.execute(`
          UPDATE process_data_governance_creation_tasks
          SET status='creating', attempt_count=attempt_count+1, last_error_code=NULL, last_error_message=NULL
          WHERE id=?
        `, [task.id]);
        const version = await getVersion(connection, versionId, true);
        if (!version || !['published', 'superseded'].includes(text(version.status))) {
          throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_VERSION_NOT_FIXED', '来源流程版本不是不可变的已发布版本');
        }
        const document = versionDocument(version);
        const risk = riskFromDocument(document);
        const safeActor = actorValue(actor);
        const sourceHash = text(version.content_hash) || digest(document);
        const dueAt = addBusinessDays(new Date(), risk.risk_level === 'high' ? 10 : 20);
        const insertResult = await rows(connection, `
          INSERT INTO process_data_governance_work_packages
            (package_ref, process_version_id, source_document_id, owning_department_id,
             source_content_hash, rule_version, risk_level, risk_basis_json, status,
             due_at, created_by_person_id, updated_by_person_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'mdm_preparing', ?, ?, ?)
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
        const packageId = Number(insertResult.insertId);
        await connection.execute(`
          UPDATE process_data_governance_creation_tasks
          SET status='completed', completed_work_package_id=?, completed_at=CURRENT_TIMESTAMP,
              last_error_code=NULL, last_error_message=NULL
          WHERE id=?
        `, [packageId, task.id]);
        await insertEvent(connection, packageId, 'work_package_created', actor, {
          payload: { process_version_id: versionId, source_content_hash: sourceHash, rule_version: RULE_VERSION }
        });
        return {
          task: publicTask(await one(connection, 'SELECT * FROM process_data_governance_creation_tasks WHERE id=?', [task.id])),
          package: publicPackage(await packageRow(connection, packageId)),
          idempotent: false
        };
      });
    } catch (error) {
      await pool.execute(`
        UPDATE process_data_governance_creation_tasks
        SET status='failed', last_error_code=?, last_error_message=?, next_retry_at=DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 15 MINUTE)
        WHERE process_version_id=? AND status<>'completed'
      `, [text(error.code) || 'MATERIALIZE_FAILED', text(error.message).slice(0, 1000), versionId]).catch(() => {});
      throw error;
    }
  }

  async function queueAndMaterialize(processVersionId, actor = {}) {
    await withTransaction(pool, connection => queueProcessDataGovernanceCreationTask(connection, processVersionId, actor));
    return await materializeCreationTask(processVersionId, actor);
  }

  async function listWorkPackages(processVersionId) {
    const result = await rows(pool, `
      SELECT p.*, d.department_name AS owning_department_name,
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
      WHERE p.process_version_id=?
      ORDER BY p.updated_at DESC, p.id DESC
    `, [processVersionId]);
    return result.map(publicPackage);
  }

  async function listBusinessFactRequests(departmentId, processVersionId, options = {}) {
    if (!departmentId) return [];
    const statuses = options.all ? ['open', 'answered', 'closed', 'cancelled'] : ['open'];
    const placeholders = statuses.map(() => '?').join(',');
    const result = await rows(pool, `
      SELECT fr.*, gd.detail_ref, d.department_name AS target_department_name,
             p.process_version_id, p.package_ref, p.revision_no AS package_revision_no,
             v.document_no, v.document_title,
             COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.process_content_json, '$.process.process_name')), v.document_title) AS process_name
      FROM process_data_governance_fact_requests fr
      JOIN process_data_governance_details gd ON gd.id=fr.detail_id
      JOIN process_data_governance_work_packages p ON p.id=fr.work_package_id
      JOIN process_design_versions v ON v.id=p.process_version_id
      LEFT JOIN departments d ON d.id=fr.target_department_id
      WHERE fr.target_department_id=? AND p.process_version_id=? AND fr.status IN (${placeholders})
      ORDER BY fr.updated_at DESC, fr.id DESC
    `, [departmentId, processVersionId, ...statuses]);
    return result.map(row => ({ ...publicFactRequest(row), process_version_id: Number(row.process_version_id), package_ref: row.package_ref, package_revision_no: Number(row.package_revision_no), process_name: row.process_name, document_no: row.document_no }));
  }

  async function getWorkPackageDetail(packageId) {
    const packageDataRow = await packageRow(pool, packageId);
    if (!packageDataRow) return null;
    const version = await getVersion(pool, Number(packageDataRow.process_version_id));
    const document = assertSourceBinding(packageDataRow, version);
    const sourceIndex = buildSourceIndex(document);
    const [detailRows, factRows, reviewRows, eventRows] = await Promise.all([
      rows(pool, `
        SELECT gd.*, d.department_name AS responsible_department_name
        FROM process_data_governance_details gd
        LEFT JOIN departments d ON d.id=gd.responsible_department_id
        WHERE gd.work_package_id=? ORDER BY gd.detail_type, gd.detail_ref
      `, [packageId]),
      rows(pool, `
        SELECT fr.*, gd.detail_ref, d.department_name AS target_department_name
        FROM process_data_governance_fact_requests fr
        JOIN process_data_governance_details gd ON gd.id=fr.detail_id
        LEFT JOIN departments d ON d.id=fr.target_department_id
        WHERE fr.work_package_id=? ORDER BY fr.id DESC
      `, [packageId]),
      rows(pool, 'SELECT * FROM process_data_governance_reviews WHERE work_package_id=? ORDER BY id DESC', [packageId]),
      rows(pool, 'SELECT * FROM process_data_governance_events WHERE work_package_id=? ORDER BY id DESC LIMIT 200', [packageId])
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
        process_version_id: Number(version.id),
        document_no: version.document_no || null,
        document_title: version.document_title || version.master_document_title || null,
        edition: version.edition || null,
        schema_version: version.schema_version,
        content_hash: version.content_hash || digest(document),
        process: document.process || {},
        immutable: true
      },
      details,
      fact_requests: factRows.map(publicFactRequest),
      reviews: reviewRows.map(publicReview),
      events: eventRows.map(row => ({
        id: Number(row.id), event_type: row.event_type, detail_id: row.detail_id == null ? null : Number(row.detail_id),
        fact_request_id: row.fact_request_id == null ? null : Number(row.fact_request_id), actor_person_id: row.actor_person_id == null ? null : Number(row.actor_person_id),
        actor_department_id: row.actor_department_id == null ? null : Number(row.actor_department_id), actor_role_code: row.actor_role_code || null,
        basis_text: row.basis_text || null, payload: parseJson(row.payload_json, null), created_at: row.created_at
      }))
    };
  }

  async function generateCandidates(packageId, expectedRevision, actor = {}) {
    return await withTransaction(pool, async connection => {
      const packageDataRow = await assertPackageRevision(connection, packageId, expectedRevision);
      const { document } = await assertPackageSourceBinding(connection, packageDataRow);
      if (text(packageDataRow.rule_version) !== RULE_VERSION) {
        throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_RULE_VERSION_UNSUPPORTED', '工作包使用的候选规则版本与当前程序不一致，不能重新生成候选');
      }
      const candidates = buildGovernanceCandidates(document);
      const objectRows = await rows(connection, `
        SELECT id, object_key, object_name_cn, object_type, owner_dept_id
        FROM data_map_objects
        WHERE status IN ('draft','active')
      `);
      const sourceIndex = buildSourceIndex(document);
      const existingDetails = await rows(connection, 'SELECT detail_ref FROM process_data_governance_details WHERE work_package_id=?', [packageId]);
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
            object_id: Number(row.id),
            match_type: text(row.object_key) === text(candidate.source_ref) ? 'exact_stable_key' : 'exact_name',
            object_key: row.object_key,
            object_name: row.object_name_cn,
            object_type: row.object_type,
            owner_department_id: row.owner_dept_id == null ? null : Number(row.owner_dept_id)
          }));
        }
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

  async function updateDetail(packageId, detailId, expectedRevision, payload, actor = {}) {
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
    return await withTransaction(pool, async connection => {
      const packageDataRow = await assertPackageRevision(connection, packageId, expectedRevision);
      await assertPackageSourceBinding(connection, packageDataRow);
      const detail = await one(connection, 'SELECT * FROM process_data_governance_details WHERE id=? AND work_package_id=? FOR UPDATE', [detailId, packageId]);
      if (!detail) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_DETAIL_NOT_FOUND', '治理明细不存在');
      const unresolvedRequest = await one(connection, `
        SELECT id, status FROM process_data_governance_fact_requests
        WHERE detail_id=? AND status IN ('open','answered') LIMIT 1 FOR UPDATE
      `, [detailId]);
      if (unresolvedRequest && status !== 'needs_business_fact') {
        throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_UNRESOLVED', '该明细仍有未关闭的业务事实问题，不能先行形成治理结论');
      }
      const responsibleDepartmentId = Number(payload.responsible_department_id || 0) || packageDataRow.owning_department_id || null;
      await connection.execute(`
        UPDATE process_data_governance_details
        SET governance_json=?, status=?, responsible_department_id=?, revision_no=revision_no+1,
            updated_by_person_id=?, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [JSON.stringify(governance), status, responsibleDepartmentId, actorValue(actor).personId, detailId]);
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
        detail: publicDetail(await one(connection, 'SELECT * FROM process_data_governance_details WHERE id=?', [detailId]))
      };
    });
  }

  async function createFactRequest(packageId, expectedRevision, payload, actor = {}) {
    const detailId = Number(payload && payload.detail_id);
    const targetDepartmentId = Number(payload && payload.target_department_id);
    const factType = text(payload && payload.requested_fact_type);
    const question = text(payload && payload.question_text);
    const reason = text(payload && payload.request_reason);
    if (!Number.isInteger(detailId) || detailId < 1 || !Number.isInteger(targetDepartmentId) || targetDepartmentId < 1) {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_TARGET_REQUIRED', '必须选择具体治理明细和目标部门');
    }
    if (!factType || !question || !reason) {
      throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_INCOMPLETE', '事实类型、问题和提出原因均不能为空');
    }
    return await withTransaction(pool, async connection => {
      const packageDataRow = await assertPackageRevision(connection, packageId, expectedRevision);
      await assertPackageSourceBinding(connection, packageDataRow);
      const detail = await one(connection, 'SELECT * FROM process_data_governance_details WHERE id=? AND work_package_id=? FOR UPDATE', [detailId, packageId]);
      if (!detail) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_DETAIL_NOT_FOUND', '治理明细不存在');
      const targetDepartment = await one(connection, "SELECT id FROM departments WHERE id=? AND status='active'", [targetDepartmentId]);
      if (!targetDepartment) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_TARGET_INVALID', '目标部门不存在或当前不可用');
      const existing = await one(connection, `
        SELECT id FROM process_data_governance_fact_requests
        WHERE detail_id=? AND status IN ('open','answered') LIMIT 1 FOR UPDATE
      `, [detailId]);
      if (existing) throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_REQUEST_EXISTS', '该明细已有未关闭的业务事实问题');
      const nextRevision = Number(expectedRevision) + 1;
      const result = await rows(connection, `
        INSERT INTO process_data_governance_fact_requests
          (request_ref, work_package_id, detail_id, target_department_id,
           requested_fact_type, question_text, request_reason, requested_by_person_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [`pdg-fact-p${packageId}-d${detailId}-r${nextRevision}`, packageId, detailId, targetDepartmentId, factType, question, reason, actorValue(actor).personId]);
      const requestId = Number(result.insertId);
      await connection.execute(`
        UPDATE process_data_governance_details
        SET status='needs_business_fact', revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [actorValue(actor).personId, detailId]);
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
        fact_request: publicFactRequest(await one(connection, 'SELECT * FROM process_data_governance_fact_requests WHERE id=?', [requestId]))
      };
    });
  }

  async function getFactRequest(requestId, lock = false, executor = pool) {
    return await one(executor, `
      SELECT fr.*, gd.detail_ref, gd.detail_type, gd.source_ref, p.process_version_id, p.revision_no AS package_revision_no,
             d.department_name AS target_department_name
      FROM process_data_governance_fact_requests fr
      JOIN process_data_governance_details gd ON gd.id=fr.detail_id
      JOIN process_data_governance_work_packages p ON p.id=fr.work_package_id
      LEFT JOIN departments d ON d.id=fr.target_department_id
      WHERE fr.id=?
      ${lock ? 'FOR UPDATE' : ''}
    `, [requestId]);
  }

  async function getFactRequestContext(requestId) {
    const factRow = await getFactRequest(requestId);
    if (!factRow) return null;
    const packageDataRow = await packageRow(pool, Number(factRow.work_package_id));
    if (!packageDataRow) return null;
    const version = await getVersion(pool, Number(packageDataRow.process_version_id));
    const document = assertSourceBinding(packageDataRow, version);
    const source = buildSourceIndex(document).get(text(factRow.detail_ref)) || { source_ref: factRow.source_ref };
    return {
      package: publicPackage(packageDataRow),
      source_version: {
        process_version_id: Number(version.id),
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
        process_version_id: Number(factRow.process_version_id),
        package_revision_no: Number(factRow.package_revision_no)
      },
      source_context: {
        detail_id: Number(factRow.detail_id),
        detail_ref: factRow.detail_ref,
        detail_type: factRow.detail_type,
        source
      }
    };
  }

  async function respondFactRequest(requestId, expectedRevision, payload, actor = {}) {
    const answer = text(payload && payload.answer_text);
    const evidence = text(payload && payload.evidence_ref);
    if (!answer) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_ANSWER_REQUIRED', '业务事实答复不能为空');
    return await withTransaction(pool, async connection => {
      const fact = await getFactRequest(requestId, true, connection);
      if (!fact) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND', '业务事实问题不存在');
      const packageDataRow = await assertPackageRevision(connection, Number(fact.work_package_id), expectedRevision);
      await assertPackageSourceBinding(connection, packageDataRow);
      if (text(fact.status) !== 'open') throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_OPEN', '该业务事实问题当前不能答复');
      if (Number(actor.departmentId) !== Number(fact.target_department_id)) {
        throw repositoryError(403, 'PROCESS_DATA_GOVERNANCE_FACT_DEPARTMENT_DENIED', '只能答复发给本人所属部门的事实问题');
      }
      await connection.execute(`
        UPDATE process_data_governance_fact_requests
        SET status='answered', answer_text=?, evidence_ref=?, answered_by_person_id=?, answered_at=CURRENT_TIMESTAMP
        WHERE id=?
      `, [answer, evidence || null, actorValue(actor).personId, requestId]);
      const nextPackageStatus = await activePackageStatus(connection, fact.work_package_id);
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status=?, revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [nextPackageStatus, actorValue(actor).personId, fact.work_package_id]);
      await insertEvent(connection, fact.work_package_id, 'business_fact_answered', actor, {
        detailId: fact.detail_id, factRequestId: requestId, basis: evidence || null,
        payload: { target_department_id: Number(fact.target_department_id) }
      });
      return {
        package: publicPackage(await packageRow(connection, fact.work_package_id)),
        fact_request: publicFactRequest(await getFactRequest(requestId, false, connection))
      };
    });
  }

  async function closeFactRequest(requestId, expectedRevision, payload, actor = {}) {
    const basis = text(payload && payload.basis);
    if (!basis) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_FACT_CLOSE_BASIS_REQUIRED', '关闭业务事实问题时必须填写采用情况和依据');
    return await withTransaction(pool, async connection => {
      const fact = await getFactRequest(requestId, true, connection);
      if (!fact) throw repositoryError(404, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_FOUND', '业务事实问题不存在');
      const packageDataRow = await assertPackageRevision(connection, Number(fact.work_package_id), expectedRevision);
      await assertPackageSourceBinding(connection, packageDataRow);
      if (text(fact.status) !== 'answered') throw repositoryError(409, 'PROCESS_DATA_GOVERNANCE_FACT_NOT_ANSWERED', '业务部门尚未答复，不能关闭事实问题');
      await connection.execute(`
        UPDATE process_data_governance_fact_requests
        SET status='closed', closed_by_person_id=?, closed_at=CURRENT_TIMESTAMP WHERE id=?
      `, [actorValue(actor).personId, requestId]);
      await connection.execute(`
        UPDATE process_data_governance_details
        SET status='pending', revision_no=revision_no+1, updated_by_person_id=? WHERE id=?
      `, [actorValue(actor).personId, fact.detail_id]);
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
        fact_request: publicFactRequest(await getFactRequest(requestId, false, connection))
      };
    });
  }

  async function completeWorkPackage(packageId, expectedRevision, basis, actor = {}) {
    const reviewBasis = text(basis);
    if (!reviewBasis) throw repositoryError(422, 'PROCESS_DATA_GOVERNANCE_REVIEW_BASIS_REQUIRED', 'MDM工作组审核依据不能为空');
    return await withTransaction(pool, async connection => {
      const packageDataRow = await assertPackageRevision(connection, packageId, expectedRevision);
      await assertPackageSourceBinding(connection, packageDataRow);
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
      const safeActor = actorValue(actor);
      const reviewResult = await rows(connection, `
        INSERT INTO process_data_governance_reviews
          (work_package_id, review_type, decision, basis_text, package_revision_no, actor_person_id, actor_role_code)
        VALUES (?, 'mdm_workgroup', 'approved', ?, ?, ?, ?)
      `, [packageId, reviewBasis, nextRevision, safeActor.personId, safeActor.roleCode || 'mdm_lead']);
      await connection.execute(`
        UPDATE process_data_governance_work_packages
        SET status='completed', revision_no=?, completed_at=CURRENT_TIMESTAMP, updated_by_person_id=? WHERE id=?
      `, [nextRevision, safeActor.personId, packageId]);
      await insertEvent(connection, packageId, 'mdm_workgroup_review_approved', actor, {
        basis: reviewBasis,
        payload: { review_id: Number(reviewResult.insertId), package_revision_no: nextRevision }
      });
      return {
        package: publicPackage(await packageRow(connection, packageId)),
        review: publicReview(await one(connection, 'SELECT * FROM process_data_governance_reviews WHERE id=?', [reviewResult.insertId]))
      };
    });
  }

  async function listWorkbenchItems(actor = {}, processVersionId) {
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
    if (roleCodes.has('mdm_lead')) {
      const packages = await listWorkPackages(processVersionId);
      for (const item of packages.filter(row => !['completed', 'source_withdrawn'].includes(row.status))) {
        const openFacts = Number(item.fact_request_counts && (item.fact_request_counts.open || 0) || 0);
        const answeredFacts = Number(item.fact_request_counts && (item.fact_request_counts.answered || 0) || 0);
        items.push({
          id: `process-data-package:${item.id}`,
          type: 'process_data_governance_package',
          governanceType: 'process_data_governance',
          title: `数据生命周期治理：${item.process_name || item.document_no || item.package_ref}`,
          roleHint: 'mdm_lead',
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
          sourceRoles: ['mdm_lead']
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
    listWorkbenchItems,
    listWorkPackages,
    materializeCreationTask,
    queueAndMaterialize,
    respondFactRequest,
    updateDetail
  };
}

module.exports = {
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
