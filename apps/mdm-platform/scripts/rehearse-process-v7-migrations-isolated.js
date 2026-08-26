#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const express = require('express');
const mysql = require('mysql2/promise');
const {
  PROCESS_V7_PREVIEW_SCHEMA_SQL,
  TABLES,
  applyProcessV7PreviewReview,
  inspectProcessV7PreviewReview,
  rollbackProcessV7PreviewReview
} = require('../server/processV7PreviewReviewMigration');
const {
  applyProcessV7FormalFoundation,
  inspectLegacyFormalRows,
  inspectProcessV7FormalFoundation,
  rollbackProcessV7FormalFoundation
} = require('../server/processV7FormalMigration');
const structuredOutputService = require('../../structured-output-service/server');
const { validateAndProjectV7 } = require('../server/processV7PreviewReview');
const { makeProcessV7PreviewReviewRepository } = require('../server/processV7PreviewReviewRepository');
const { makeIdentityMysqlRepository } = require('../server/identityMysqlRepository');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const auth = require('../server/auth');
const processDesignRouter = require('../server/routes/processDesignMysql');

function timestamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function option(args, name) {
  const value = args.find(argument => argument.startsWith(`${name}=`));
  return value ? value.slice(name.length + 1) : null;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: options.encoding === null ? null : 'utf8',
    input: options.input,
    maxBuffer: 1024 * 1024 * 1024,
    windowsHide: true
  });
  if (result.status !== 0) {
    const error = new Error(options.errorMessage || `Docker命令失败：${args[0] || 'unknown'}`);
    error.code = options.code || 'V7_ISOLATED_DOCKER_FAILED';
    error.detail = String(result.stderr || '').trim().slice(0, 2000);
    throw error;
  }
  return result.stdout;
}

async function waitForMysql(port, password) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    let connection;
    try {
      connection = await mysql.createConnection({ host: '127.0.0.1', port, user: 'root', password, connectTimeout: 1000 });
      await connection.execute('SELECT 1');
      await connection.end();
      return;
    } catch (_error) {
      if (connection) await connection.end().catch(() => {});
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw Object.assign(new Error('隔离MySQL容器在60秒内没有就绪'), { code: 'V7_ISOLATED_MYSQL_NOT_READY' });
}

function firstCreateStatement(sql) {
  return String(sql).split(/;\s*(?:\r?\n|$)/).map(value => value.trim()).find(Boolean);
}

function restoreEnvironmentVariable(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function stableError(message, code, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}

async function loadFormalActorAccess(pool, personId) {
  const [rows] = await pool.execute(`
    SELECT pr.scope_type, pr.scope_department_id, r.role_code,
           permission.perm_code, rp.effect
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    LEFT JOIN role_permissions rp ON rp.role_id=r.role_id
    LEFT JOIN permissions permission ON permission.perm_id=rp.perm_id
    WHERE pr.person_id=?
      AND pr.assignment_status='active'
      AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      AND r.status='active'
      AND r.model_version=?
    ORDER BY pr.person_role_id, permission.perm_code
  `, [personId, ACCESS_MODEL_VERSION]);
  const permissionEffects = new Map();
  rows.forEach(row => {
    const permissionCode = String(row.perm_code || '').trim();
    if (!permissionCode) return;
    if (String(row.effect || '').trim() === 'deny') permissionEffects.set(permissionCode, 'deny');
    else if (!permissionEffects.has(permissionCode)) permissionEffects.set(permissionCode, 'allow');
  });
  return { rows, permissionEffects };
}

async function selectFormalActor(pool, specification, excludedPersonIds) {
  const [candidates] = await pool.execute(`
    SELECT DISTINCT p.person_id, p.current_department_id,
           ua.account_id, ua.auth_version,
           pr.scope_type, pr.scope_department_id
    FROM person_roles pr
    JOIN roles r ON r.role_id=pr.role_id
    JOIN person p ON p.person_id=pr.person_id
    JOIN user_accounts ua ON ua.person_id=p.person_id
    WHERE r.role_code=?
      AND r.status='active'
      AND r.model_version=?
      AND pr.assignment_status='active'
      AND pr.authorization_basis IS NOT NULL
      AND pr.effective_from IS NOT NULL
      AND pr.effective_from<=CURRENT_DATE
      AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
      AND pr.scope_type=?
      AND (? IS NULL OR pr.scope_department_id=?)
      AND p.status='active'
      AND p.employment_status='active'
      AND ua.account_status='active'
      AND ua.must_change_password=0
      AND ua.auth_version>=1
    ORDER BY p.person_id, ua.account_id
  `, [
    specification.roleCode,
    ACCESS_MODEL_VERSION,
    specification.scopeType,
    specification.departmentId == null ? null : Number(specification.departmentId),
    specification.departmentId == null ? null : Number(specification.departmentId)
  ]);

  for (const candidate of candidates) {
    const personId = Number(candidate.person_id || 0);
    if (!personId || excludedPersonIds.has(personId)) continue;
    const currentDepartmentId = Number(candidate.current_department_id || 0) || null;
    if (specification.departmentId != null && currentDepartmentId !== Number(specification.departmentId)) continue;
    const access = await loadFormalActorAccess(pool, personId);
    const roleCodes = new Set(access.rows.map(row => String(row.role_code || '').trim()).filter(Boolean));
    if (roleCodes.has('admin') || !roleCodes.has(specification.roleCode)) continue;
    const matchingAssignment = access.rows.some(row =>
      String(row.role_code || '').trim() === specification.roleCode &&
      String(row.scope_type || '').trim() === specification.scopeType &&
      (specification.departmentId == null || Number(row.scope_department_id || 0) === Number(specification.departmentId))
    );
    if (!matchingAssignment) continue;
    if (!specification.permissions.every(code => access.permissionEffects.get(code) === 'allow')) continue;
    return Object.freeze({
      personId,
      accountId: Number(candidate.account_id),
      authVersion: Number(candidate.auth_version),
      departmentId: currentDepartmentId
    });
  }
  return null;
}

async function selectFormalV7Actors(pool, originDepartmentId) {
  const excludedPersonIds = new Set();
  const specifications = [
    {
      key: 'submitter',
      roleCode: 'department_contact',
      scopeType: 'department',
      departmentId: Number(originDepartmentId),
      permissions: ['governance:read-department', 'governance:draft-department', 'governance:submit-department']
    },
    {
      key: 'reviewer',
      roleCode: 'department_mdm_reviewer',
      scopeType: 'department',
      departmentId: Number(originDepartmentId),
      permissions: ['governance:read-department', 'governance:review-department']
    },
    {
      key: 'publisher',
      roleCode: 'mdm_lead',
      scopeType: 'global',
      departmentId: null,
      permissions: ['governance:read-global', 'governance:publish']
    }
  ];
  const actors = {};
  const missingRoleCodes = [];
  for (const specification of specifications) {
    const actor = await selectFormalActor(pool, specification, excludedPersonIds);
    if (!actor) {
      missingRoleCodes.push(specification.roleCode);
      continue;
    }
    actors[specification.key] = actor;
    excludedPersonIds.add(actor.personId);
  }
  if (missingRoleCodes.length) {
    throw stableError(
      '隔离恢复库缺少可执行正式V7演练的有效且相互分离账号',
      'V7_ISOLATED_FORMAL_ACTORS_REQUIRED',
      { manual_objects: missingRoleCodes.map(roleCode => ({ missing_role_code: roleCode })) }
    );
  }
  return Object.freeze(actors);
}

async function selectFormalV7TrialContext(pool, departments) {
  let lastMissing = [];
  for (const originDepartment of departments) {
    const targetDepartment = departments.find(item => Number(item.id) !== Number(originDepartment.id));
    if (!targetDepartment) continue;
    try {
      const actors = await selectFormalV7Actors(pool, originDepartment.id);
      return Object.freeze({ originDepartment, targetDepartment, actors });
    } catch (error) {
      if (!error || error.code !== 'V7_ISOLATED_FORMAL_ACTORS_REQUIRED') throw error;
      lastMissing = Array.isArray(error.manual_objects) ? error.manual_objects : [];
    }
  }
  throw stableError(
    '隔离恢复库没有可同时满足正式V7职责分离和归口部门范围的账号组合',
    'V7_ISOLATED_FORMAL_ACTORS_REQUIRED',
    { manual_objects: lastMissing.length ? lastMissing : [{ missing_role_code: 'formal_v7_separated_actor_set' }] }
  );
}

async function startFormalV7HttpHarness(pool, actors) {
  const identityRepository = makeIdentityMysqlRepository(pool);
  const processDesignRepository = processDesignRouter.makeProcessDesignMysqlRepository(pool);
  const sessions = new Map();
  const actorTokens = new Map();
  Object.entries(actors).forEach(([key, actor]) => {
    const token = crypto.randomBytes(32).toString('hex');
    actorTokens.set(key, token);
    sessions.set(token, {
      personId: actor.personId,
      userId: actor.personId,
      accountId: actor.accountId,
      authVersion: actor.authVersion,
      departmentId: actor.departmentId,
      destroy(callback) { callback(); }
    });
  });
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
  auth.setIdentityRepositoryFactory(async () => identityRepository);
  processDesignRouter.setProcessDesignRepositoryFactory(() => processDesignRepository);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));
  app.use((req, _res, next) => {
    const source = sessions.get(String(req.get('x-v7-rehearsal-session') || ''));
    if (source) req.session = { ...source, destroy: source.destroy };
    next();
  });
  app.use('/api/process-design', processDesignRouter);

  const server = await new Promise((resolve, reject) => {
    const candidate = app.listen(0, '127.0.0.1', () => resolve(candidate));
    candidate.once('error', reject);
  }).catch(error => {
    processDesignRouter.resetProcessDesignRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
    throw error;
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}/api/process-design`;

  async function request(actorKey, routePath, body) {
    const actorToken = actorTokens.get(actorKey);
    if (!actorToken) {
      throw stableError('本机正式V7演练请求缺少已选择的操作人', 'V7_ISOLATED_FORMAL_ACTOR_NOT_SELECTED');
    }
    const response = await fetch(`${baseUrl}${routePath}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-v7-rehearsal-session': actorToken
      },
      body: JSON.stringify(body || {})
    });
    const rawBody = await response.text();
    let payload = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : {};
    } catch (_error) {
      payload = { error: '本机正式V7演练接口返回了无法解析的响应' };
    }
    if (!response.ok) {
      throw stableError(
        payload && payload.error || '本机正式V7演练接口调用失败',
        payload && payload.code || 'V7_ISOLATED_FORMAL_HTTP_FAILED',
        { statusCode: response.status, payload }
      );
    }
    return payload;
  }

  return {
    request,
    processDesignRepository,
    async close() {
      await new Promise(resolve => server.close(resolve));
      processDesignRouter.resetProcessDesignRepositoryFactory();
      auth.resetIdentityRepositoryFactory();
    }
  };
}

async function main() {
  const args = process.argv.slice(2);
  const runStamp = timestamp();
  const evidenceInput = path.resolve(process.cwd(), option(args, '--backup-evidence') || 'output/process-v7-m0/2026-08-25-backup-restore.json');
  const outputPath = path.resolve(process.cwd(), option(args, '--output') || `output/process-v7-m0/migration-rehearsal-${runStamp}.json`);
  const backupEvidence = JSON.parse(fs.readFileSync(evidenceInput, 'utf8'));
  if (backupEvidence.status !== 'verified' || !backupEvidence.backup || !backupEvidence.backup.path) {
    throw Object.assign(new Error('缺少已验证的M0备份恢复证据'), { code: 'V7_ISOLATED_BACKUP_EVIDENCE_INVALID' });
  }
  const backup = fs.readFileSync(backupEvidence.backup.path);
  if (sha256(backup) !== backupEvidence.backup.sha256) {
    throw Object.assign(new Error('M0备份文件摘要与恢复证据不一致'), { code: 'V7_ISOLATED_BACKUP_DIGEST_MISMATCH' });
  }

  const containerName = `infomat-v7-migration-rehearsal-${runStamp}`;
  if (!/^infomat-v7-migration-rehearsal-\d{14}$/.test(containerName)) {
    throw Object.assign(new Error('隔离迁移容器名称不符合安全规则'), { code: 'V7_ISOLATED_TARGET_INVALID' });
  }
  const password = crypto.randomBytes(32).toString('hex');
  const databaseName = 'infomat_mdm';
  let pool = null;
  let formalHarness = null;
  let created = false;
  let stage = 'preflight';
  const originalV7Environment = {
    previewEnabled: process.env.PROCESS_V7_PREVIEW_ENABLED,
    formalEnabled: process.env.PROCESS_V7_FORMAL_ENABLED,
    trialProcessRef: process.env.PROCESS_V7_TRIAL_PROCESS_REF,
    identityReadModel: process.env.MDM_IDENTITY_READ_MODEL
  };
  try {
    const existing = String(docker(['ps', '-a', '--filter', `name=^/${containerName}$`, '--format', '{{.Names}}'])).trim();
    if (existing) throw Object.assign(new Error('隔离迁移容器名称已经存在，拒绝覆盖'), { code: 'V7_ISOLATED_CONTAINER_EXISTS' });
    stage = 'create_container';
    docker(['run', '-d', '--name', containerName, '-e', `MYSQL_ROOT_PASSWORD=${password}`, '-p', '127.0.0.1::3306', 'mysql:8.4']);
    created = true;
    const portOutput = String(docker(['port', containerName, '3306/tcp'])).trim();
    const portMatch = portOutput.match(/127\.0\.0\.1:(\d+)/);
    if (!portMatch) throw Object.assign(new Error('无法取得隔离MySQL端口'), { code: 'V7_ISOLATED_PORT_NOT_FOUND' });
    const port = Number(portMatch[1]);
    stage = 'wait_container';
    await waitForMysql(port, password);
    pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: 'mysql', connectionLimit: 2, charset: 'utf8mb4' });
    await pool.execute(`CREATE DATABASE \`${databaseName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    stage = 'restore_backup';
    docker(['exec', '-i', '-e', `MYSQL_PWD=${password}`, containerName, 'mysql', '-uroot', databaseName], {
      input: backup,
      encoding: null,
      errorMessage: '隔离迁移数据库恢复失败',
      code: 'V7_ISOLATED_RESTORE_FAILED'
    });
    await pool.end();
    pool = mysql.createPool({ host: '127.0.0.1', port, user: 'root', password, database: databaseName, connectionLimit: 2, charset: 'utf8mb4' });
    const originalBaseline = await inspectLegacyFormalRows(pool);
    const evidence = {
      status: 'verified',
      verified_at: new Date().toISOString(),
      source_backup_sha256: backupEvidence.backup.sha256,
      isolated_container: containerName,
      isolated_database: databaseName,
      original_legacy_formal_digest: originalBaseline.digest,
      steps: []
    };

    stage = 'm1_partial_recovery';
    await pool.execute(firstCreateStatement(PROCESS_V7_PREVIEW_SCHEMA_SQL));
    let partialStructureRejected = false;
    let partialStructureStatus = null;
    try {
      await applyProcessV7PreviewReview(pool);
    } catch (error) {
      partialStructureRejected = error && error.code === 'V7_PREVIEW_MIGRATION_INCONSISTENT';
      partialStructureStatus = error && error.consistency_status || null;
    }
    evidence.steps.push({
      step: 'M1_PARTIAL_STRUCTURE_STOPS_APPLY',
      passed: partialStructureRejected && partialStructureStatus === 'partial_structure',
      consistency_status: partialStructureStatus
    });
    await rollbackProcessV7PreviewReview(pool);
    const m1Applied = await applyProcessV7PreviewReview(pool);
    evidence.steps.push({
      step: 'M1_CLEAN_APPLY',
      passed: m1Applied.applied && m1Applied.consistency_status === 'applied' &&
        m1Applied.tables.every(item => item.schema_status === 'matching' && item.rows === 0),
      table_count: m1Applied.tables.length,
      formal_digest: m1Applied.formal_process_baseline.digest
    });
    const m1Repeated = await applyProcessV7PreviewReview(pool);
    evidence.steps.push({
      step: 'M1_REPEAT_APPLY',
      passed: m1Repeated.applied && m1Repeated.tables.every(item => item.schema_status === 'matching' && item.rows === 0)
    });
    if ((await inspectLegacyFormalRows(pool)).digest !== originalBaseline.digest) {
      throw Object.assign(new Error('M1演练改变了历史正式流程字段'), { code: 'V7_ISOLATED_M1_LEGACY_CHANGED' });
    }
    await rollbackProcessV7PreviewReview(pool);
    const m1RolledBack = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
    evidence.steps.push({ step: 'M1_EMPTY_ROLLBACK', passed: m1RolledBack.tables.every(item => !item.exists) && !m1RolledBack.applied });

    stage = 'm1_reapply_for_m2';
    await applyProcessV7PreviewReview(pool);
    stage = 'm2_partial_recovery';
    await pool.execute('ALTER TABLE process_design_documents ADD COLUMN process_ref VARCHAR(160) NULL AFTER document_no');
    const m2Recovered = await applyProcessV7FormalFoundation(pool);
    evidence.steps.push({
      step: 'M2_PARTIAL_DDL_RECOVERY',
      passed: m2Recovered.applied && m2Recovered.promotion_table.schema_status === 'matching' &&
        m2Recovered.promotion_table.rows === 0 && m2Recovered.legacy_formal_comparison.unchanged,
      legacy_formal_digest: m2Recovered.legacy_formal_baseline.digest
    });
    const m2Repeated = await applyProcessV7FormalFoundation(pool);
    evidence.steps.push({
      step: 'M2_REPEAT_APPLY',
      passed: m2Repeated.applied && m2Repeated.promotion_table.rows === 0 && m2Repeated.legacy_formal_comparison.unchanged
    });

    stage = 'formal_promotion_workflow';
    const [departmentRows] = await pool.execute(`
      SELECT id, name, code
      FROM departments
      WHERE status='active'
      ORDER BY id
    `);
    if (departmentRows.length < 2) {
      throw Object.assign(new Error('隔离数据库缺少两个有效部门，不能演练V7正式提升'), { code: 'V7_ISOLATED_DEPARTMENTS_REQUIRED' });
    }
    stage = 'formal_actor_preflight';
    const formalTrialContext = await selectFormalV7TrialContext(pool, departmentRows);
    const { originDepartment, targetDepartment, actors: formalActors } = formalTrialContext;
    evidence.steps.push({
      step: 'M2_FORMAL_ACTOR_PREFLIGHT',
      passed: true,
      selected_role_codes: ['department_contact', 'department_mdm_reviewer', 'mdm_lead'],
      separated_accounts: true
    });
    const document = structuredOutputService.createEmptyProcessGovernanceV7Document();
    document.export_meta.package_ref = `package_v7_rehearsal_${runStamp}`;
    document.process.process_ref = `process_v7_rehearsal_${runStamp}`;
    process.env.PROCESS_V7_PREVIEW_ENABLED = '1';
    process.env.PROCESS_V7_FORMAL_ENABLED = '1';
    process.env.PROCESS_V7_TRIAL_PROCESS_REF = document.process.process_ref;
    document.process.process_name = 'V7正式提升隔离演练流程';
    document.process.owning_department = originDepartment.name;
    document.behaviors = [{
      behavior_ref: 'behavior_prepare',
      node_type: 'action',
      behavior_name: '归口部门准备演练材料',
      behavior_description: '',
      current_actor_role: `${originDepartment.name}经办人`,
      actor_assignment_mode: 'fixed_department',
      actor_department_data_ref: null,
      actor_position_rule: '',
      trigger: '',
      precondition: '',
      input_description: '',
      timing: null,
      completion_standard: '演练材料已经准备。',
      output_description: '',
      countersign_all_required: false,
      countersign_target_departments: []
    }, {
      behavior_ref: 'behavior_review',
      node_type: 'action',
      behavior_name: '承接部门核对演练材料',
      behavior_description: '',
      current_actor_role: `${targetDepartment.name}经办人`,
      actor_assignment_mode: 'fixed_department',
      actor_department_data_ref: null,
      actor_position_rule: '',
      trigger: '',
      precondition: '',
      input_description: '',
      timing: null,
      completion_standard: '演练材料已经核对。',
      output_description: '',
      countersign_all_required: false,
      countersign_target_departments: []
    }];
    document.flow_relations = [{
      relation_ref: 'relation_prepare_review',
      relation_type: 'sequence',
      from_behavior_ref: 'behavior_prepare',
      to_behavior_ref: 'behavior_review',
      condition: ''
    }];
    const preview = validateAndProjectV7(document, departmentRows);
    if (preview.errors.length || preview.blockingIssues.length || preview.items.length !== 1) {
      throw Object.assign(new Error('隔离V7演练文件没有通过共享校验'), {
        code: 'V7_ISOLATED_FIXTURE_INVALID',
        manual_objects: [...preview.errors, ...preview.blockingIssues]
      });
    }
    const previewRepository = makeProcessV7PreviewReviewRepository(pool);
    const leadActor = {
      userId: null,
      personId: null,
      departmentId: Number(originDepartment.id),
      departmentName: originDepartment.name,
      roleCode: 'mdm_lead'
    };
    const createdCase = await previewRepository.createCase(preview, { sourceFileName: 'V7正式提升隔离演练.json' }, leadActor);
    const reviewItem = createdCase.items[0];
    await previewRepository.decideItem(
      reviewItem,
      'origin',
      'confirmed',
      '隔离演练：归口部门已核对。',
      1,
      preview.contentHash,
      leadActor
    );
    await previewRepository.decideItem(
      reviewItem,
      'counterparty',
      'confirmed',
      '隔离演练：承接部门已核对。',
      1,
      preview.contentHash,
      { ...leadActor, departmentId: Number(targetDepartment.id), departmentName: targetDepartment.name, roleCode: 'department_mdm_reviewer' }
    );
    const reviewCompleteDetail = await previewRepository.getCaseDetail(createdCase.case.id);
    const promotionTarget = {
      mode: 'create',
      document_no: `V7-REHEARSAL-${runStamp}`,
      document_title: 'V7正式提升隔离演练流程'
    };
    const promotionMeta = { expectedRevisionNo: 1, expectedContentHash: preview.contentHash };
    const promoted = await previewRepository.promoteCase(reviewCompleteDetail, preview, promotionTarget, promotionMeta, leadActor);
    const repeatedPromotion = await previewRepository.promoteCase(reviewCompleteDetail, preview, promotionTarget, promotionMeta, leadActor);
    evidence.steps.push({
      step: 'M2_FORMAL_PROMOTION_IDEMPOTENCY',
      passed: !promoted.idempotent && repeatedPromotion.idempotent &&
        Number(promoted.document.id) === Number(repeatedPromotion.document.id) &&
        Number(promoted.draft.id) === Number(repeatedPromotion.draft.id) &&
        promoted.draft.schema_version === 'process-governance-v7' &&
        promoted.draft.content_hash === preview.contentHash
    });
    formalHarness = await startFormalV7HttpHarness(pool, formalActors);
    const processDesignRepository = formalHarness.processDesignRepository;
    const promotedFormalDraft = await processDesignRepository.getDraft(promoted.draft.id);
    stage = 'formal_submit';
    const submitted = await formalHarness.request('submitter', `/drafts/${promotedFormalDraft.id}/submit`, {
      note: '隔离演练：提交V7正式草稿审核。',
      expected_revision_no: Number(promotedFormalDraft.revision_no),
      expected_content_hash: promotedFormalDraft.content_hash
    });
    if (
      Number(submitted.reviewTask.draft_revision_no) !== Number(promoted.draft.revision_no) ||
      submitted.reviewTask.content_hash !== promoted.draft.content_hash
    ) {
      throw Object.assign(new Error('V7审核任务没有绑定草稿修订号和内容摘要'), { code: 'V7_ISOLATED_REVIEW_BINDING_MISSING' });
    }
    stage = 'formal_needs_changes';
    const needsChanges = await formalHarness.request('reviewer', `/review-tasks/${submitted.reviewTask.id}/decision`, {
      decision: 'needs_changes',
      note: '隔离演练：修改完成标准后重新核对。',
      expected_revision_no: Number(submitted.reviewTask.draft_revision_no),
      expected_content_hash: submitted.reviewTask.content_hash
    });
    const changedDocument = JSON.parse(JSON.stringify(document));
    changedDocument.behaviors[1].completion_standard = '演练材料已经核对，并记录核对日期。';
    const changedPreview = validateAndProjectV7(changedDocument, departmentRows, {
      owningDepartmentName: originDepartment.name
    });
    if (changedPreview.errors.length || changedPreview.blockingIssues.length || changedPreview.items.length !== 1) {
      throw Object.assign(new Error('隔离V7变更修订没有通过共享校验'), {
        code: 'V7_ISOLATED_CHANGED_FIXTURE_INVALID',
        manual_objects: [...changedPreview.errors, ...changedPreview.blockingIssues]
      });
    }
    const addedRevision = await previewRepository.addRevision(
      reviewCompleteDetail.case,
      changedPreview,
      {
        sourceFileName: 'V7正式提升隔离演练-修订2.json',
        expectedRevisionNo: 1,
        expectedContentHash: preview.contentHash
      },
      leadActor
    );
    let stalePromotionRejected = false;
    let stalePromotionCode = null;
    try {
      await previewRepository.promoteCase(
        reviewCompleteDetail,
        preview,
        { mode: 'existing', document_id: promoted.document.id },
        promotionMeta,
        leadActor
      );
    } catch (error) {
      stalePromotionRejected = Number(error && error.statusCode) === 409;
      stalePromotionCode = error && error.code || null;
    }
    const reopenedItem = addedRevision.items[0];
    await previewRepository.decideItem(
      reopenedItem,
      'origin',
      'confirmed',
      '隔离演练：归口部门已核对修订2。',
      2,
      changedPreview.contentHash,
      leadActor
    );
    await previewRepository.decideItem(
      reopenedItem,
      'counterparty',
      'confirmed',
      '隔离演练：承接部门已核对修订2。',
      2,
      changedPreview.contentHash,
      { ...leadActor, departmentId: Number(targetDepartment.id), departmentName: targetDepartment.name, roleCode: 'department_mdm_reviewer' }
    );
    const changedReviewCompleteDetail = await previewRepository.getCaseDetail(createdCase.case.id);
    const rePromoted = await previewRepository.promoteCase(
      changedReviewCompleteDetail,
      changedPreview,
      { mode: 'existing', document_id: promoted.document.id },
      { expectedRevisionNo: 2, expectedContentHash: changedPreview.contentHash },
      leadActor
    );
    evidence.steps.push({
      step: 'M2_V7_CHANGED_REVISION_REPROMOTION',
      passed: needsChanges.draft.status === 'needs_changes' &&
        reopenedItem.carry_state === 'reopened' &&
        stalePromotionRejected &&
        Number(rePromoted.draft.id) === Number(promoted.draft.id) &&
        rePromoted.draft.status === 'draft' &&
        Number(rePromoted.draft.revision_no) === 2 &&
        rePromoted.draft.content_hash === changedPreview.contentHash,
      observed: {
        needs_changes_status: needsChanges.draft.status,
        carry_state: reopenedItem.carry_state,
        stale_promotion_rejected: stalePromotionRejected,
        stale_promotion_code: stalePromotionCode,
        reused_draft: Number(rePromoted.draft.id) === Number(promoted.draft.id),
        repromoted_status: rePromoted.draft.status,
        repromoted_revision_no: Number(rePromoted.draft.revision_no),
        content_hash_matches: rePromoted.draft.content_hash === changedPreview.contentHash
      }
    });
    stage = 'formal_resubmit';
    const rePromotedFormalDraft = await processDesignRepository.getDraft(rePromoted.draft.id);
    const resubmitted = await formalHarness.request('submitter', `/drafts/${rePromotedFormalDraft.id}/submit`, {
      note: '隔离演练：提交V7修订2正式草稿审核。',
      expected_revision_no: Number(rePromotedFormalDraft.revision_no),
      expected_content_hash: rePromotedFormalDraft.content_hash
    });
    let staleReviewRejected = false;
    try {
      await formalHarness.request('reviewer', `/review-tasks/${resubmitted.reviewTask.id}/decision`, {
        decision: 'approve',
        note: '隔离演练：使用过期摘要审核。',
        expected_revision_no: Number(resubmitted.reviewTask.draft_revision_no),
        expected_content_hash: '0'.repeat(64)
      });
    } catch (error) {
      staleReviewRejected = error && error.code === 'V7_REVIEW_CONTENT_STALE';
    }
    if (!staleReviewRejected) {
      throw Object.assign(new Error('过期V7审核摘要没有被拒绝'), { code: 'V7_ISOLATED_STALE_REVIEW_ACCEPTED' });
    }
    stage = 'formal_review';
    const approved = await formalHarness.request('reviewer', `/review-tasks/${resubmitted.reviewTask.id}/decision`, {
      decision: 'approve',
      note: '隔离演练：部门审核通过。',
      expected_revision_no: Number(resubmitted.reviewTask.draft_revision_no),
      expected_content_hash: resubmitted.reviewTask.content_hash
    });
    stage = 'formal_publish';
    const concurrentPublishResults = await Promise.allSettled([
      formalHarness.request('publisher', `/drafts/${approved.draft.id}/publish`, {
        note: '隔离演练：并发请求一发布原生V7版本。',
        expected_revision_no: Number(approved.draft.revision_no),
        expected_content_hash: approved.draft.content_hash
      }),
      formalHarness.request('publisher', `/drafts/${approved.draft.id}/publish`, {
        note: '隔离演练：并发请求二发布原生V7版本。',
        expected_revision_no: Number(approved.draft.revision_no),
        expected_content_hash: approved.draft.content_hash
      })
    ]);
    const publishedResults = concurrentPublishResults.filter(result => result.status === 'fulfilled');
    const rejectedPublishResults = concurrentPublishResults.filter(result => result.status === 'rejected');
    if (publishedResults.length !== 1 || rejectedPublishResults.length !== 1) {
      throw Object.assign(new Error('并发发布没有形成一成功一拒绝的结果'), { code: 'V7_ISOLATED_CONCURRENT_PUBLISH_INVALID' });
    }
    const published = publishedResults[0].value;
    stage = 'formal_readback';
    const versionContent = await processDesignRepository.getVersionContent(published.process_version_id);
    const formalDetail = await processDesignRepository.detail(promoted.draft.id);
    const previewDetailAfterPublish = await previewRepository.getCaseDetail(createdCase.case.id);
    evidence.steps.push({
      step: 'M2_V7_REVIEW_PUBLISH_READBACK',
      passed: staleReviewRejected &&
        resubmitted.reviewTask.status === 'pending' &&
        approved.reviewTask.status === 'approved' &&
        published.version.schema_version === 'process-governance-v7' &&
        published.version.content_json == null &&
        published.version.process_content_json != null &&
        Number(published.process_version_id) === Number(published.version.id) &&
        versionContent.content_hash === changedPreview.contentHash &&
        versionContent.document.process.process_ref === changedPreview.processRef &&
        formalDetail.v7_native === true &&
        formalDetail.content_hash_verified === true &&
        !Object.prototype.hasOwnProperty.call(previewDetailAfterPublish.formal_promotion.draft, 'process_content_json') &&
        !Object.prototype.hasOwnProperty.call(previewDetailAfterPublish.formal_promotion.current_version, 'process_content_json') &&
        !Object.prototype.hasOwnProperty.call(previewDetailAfterPublish.formal_promotion.current_version, 'content_json')
    });
    evidence.steps.push({
      step: 'M2_V7_CONCURRENT_PUBLISH',
      passed: publishedResults.length === 1 && rejectedPublishResults.length === 1,
      rejected_code: rejectedPublishResults[0].reason && rejectedPublishResults[0].reason.code || null
    });
    await pool.execute('UPDATE process_design_documents SET current_version_id=NULL, current_edition=NULL WHERE id=?', [promoted.document.id]);
    await pool.execute('DELETE FROM process_design_versions WHERE document_id=?', [promoted.document.id]);
    await pool.execute('DELETE FROM process_design_review_tasks WHERE draft_id=?', [promoted.draft.id]);
    await pool.execute('DELETE FROM process_design_events WHERE draft_id=?', [promoted.draft.id]);
    await pool.execute('DELETE FROM process_v7_promotions WHERE draft_id=?', [promoted.draft.id]);
    await pool.execute('DELETE FROM process_design_drafts WHERE id=?', [promoted.draft.id]);
    await pool.execute('DELETE FROM process_design_documents WHERE id=?', [promoted.document.id]);
    await pool.execute('DELETE FROM process_v7_preview_events WHERE case_id=?', [createdCase.case.id]);
    await pool.execute('DELETE FROM process_v7_preview_review_items WHERE case_id=?', [createdCase.case.id]);
    await pool.execute('DELETE FROM process_v7_preview_revisions WHERE case_id=?', [createdCase.case.id]);
    await pool.execute('DELETE FROM process_v7_preview_cases WHERE id=?', [createdCase.case.id]);

    const formalAfterM2 = await inspectLegacyFormalRows(pool);
    if (formalAfterM2.digest !== originalBaseline.digest) {
      throw Object.assign(new Error('M2演练改变了历史正式流程字段'), { code: 'V7_ISOLATED_M2_LEGACY_CHANGED' });
    }
    await rollbackProcessV7FormalFoundation(pool);
    const m2RolledBack = await inspectProcessV7FormalFoundation(pool, { includeLegacyBaseline: false });
    evidence.steps.push({
      step: 'M2_EMPTY_ROLLBACK',
      passed: !m2RolledBack.applied && !m2RolledBack.promotion_table.exists &&
        !m2RolledBack.columns.document_process_ref.exists && !m2RolledBack.columns.review_content_hash.exists
    });
    await rollbackProcessV7PreviewReview(pool);
    const finalM1 = await inspectProcessV7PreviewReview(pool, { includeFormalBaseline: false });
    const finalBaseline = await inspectLegacyFormalRows(pool);
    evidence.steps.push({
      step: 'FINAL_BASELINE_AND_M1_ROLLBACK',
      passed: finalM1.tables.every(item => !item.exists) && finalBaseline.digest === originalBaseline.digest,
      final_legacy_formal_digest: finalBaseline.digest
    });
    evidence.passed = evidence.steps.every(item => item.passed);
    evidence.isolated_container_removed_after_verification = true;
    if (!evidence.passed) {
      throw Object.assign(new Error('隔离迁移演练存在未通过步骤'), { code: 'V7_ISOLATED_REHEARSAL_STEP_FAILED', manual_objects: evidence.steps });
    }
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      passed: evidence.passed,
      evidence_path: outputPath,
      steps: evidence.steps.map(item => ({ step: item.step, passed: item.passed })),
      original_legacy_formal_digest: evidence.original_legacy_formal_digest,
      isolated_container_removed: true
    }, null, 2)}\n`);
  } catch (error) {
    error.stage = stage;
    throw error;
  } finally {
    restoreEnvironmentVariable('PROCESS_V7_PREVIEW_ENABLED', originalV7Environment.previewEnabled);
    restoreEnvironmentVariable('PROCESS_V7_FORMAL_ENABLED', originalV7Environment.formalEnabled);
    restoreEnvironmentVariable('PROCESS_V7_TRIAL_PROCESS_REF', originalV7Environment.trialProcessRef);
    restoreEnvironmentVariable('MDM_IDENTITY_READ_MODEL', originalV7Environment.identityReadModel);
    if (formalHarness) await formalHarness.close().catch(() => {});
    if (pool) await pool.end().catch(() => {});
    if (created) {
      if (!/^infomat-v7-migration-rehearsal-\d{14}$/.test(containerName)) {
        throw Object.assign(new Error('隔离迁移容器清理目标校验失败'), { code: 'V7_ISOLATED_CLEANUP_TARGET_INVALID' });
      }
      docker(['rm', '-f', containerName], { errorMessage: '隔离迁移容器清理失败', code: 'V7_ISOLATED_CLEANUP_FAILED' });
    }
  }
}

main().catch(error => {
  process.stderr.write(`${JSON.stringify({
    error: error.message || String(error),
    code: error.code || 'V7_ISOLATED_REHEARSAL_FAILED',
    stage: error.stage || undefined,
    detail: error.detail || undefined,
    manual_objects: error.manual_objects || undefined
  }, null, 2)}\n`);
  process.exitCode = 1;
});
