const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const {
  PROCESS_V7_FORMAL_SCHEMA_SQL,
  PROMOTION_TABLE,
  assertProcessV7PreviewFoundationApplied,
  schemaDrift,
  summarizeProcessV7PreviewFoundation
} = require('../server/processV7FormalMigration');
const processDesignRouter = require('../server/routes/processDesignMysql');

async function assertForgedFormalTransactionOptionsRejected() {
  const originalFormalEnabled = process.env.PROCESS_V7_FORMAL_ENABLED;
  const originalTrialProcessRef = process.env.PROCESS_V7_TRIAL_PROCESS_REF;
  process.env.PROCESS_V7_FORMAL_ENABLED = '1';
  process.env.PROCESS_V7_TRIAL_PROCESS_REF = 'process_v7_forged_transaction';
  const document = {
    schema_version: 'process-governance-v7',
    process: { process_ref: 'process_v7_forged_transaction', process_name: '伪造事务能力回归' }
  };
  const draft = {
    id: 900,
    schema_version: 'process-governance-v7',
    process_content_json: JSON.stringify(document),
    revision_no: 1,
    content_hash: 'a'.repeat(64),
    status: 'draft'
  };
  let lockedQueryObserved = false;
  let writeQueryObserved = false;
  const executor = {
    async execute(sql, params = []) {
      if (/FOR UPDATE/i.test(sql)) {
        lockedQueryObserved = true;
        throw Object.assign(new Error('伪造的公开options进入了内部锁定分支'), { code: 'FORGED_TRANSACTION_REACHED_LOCKS' });
      }
      if (/^(UPDATE|INSERT|DELETE)/i.test(String(sql).trim())) {
        writeQueryObserved = true;
        throw Object.assign(new Error('伪造对象进入了旧版写入分支'), { code: 'FORGED_OBJECT_REACHED_LEGACY_WRITE' });
      }
      if (/FROM process_design_review_tasks[\s\S]*WHERE id=\?/i.test(sql)) {
        return [[{ id: 601, draft_id: 900, status: 'pending' }], []];
      }
      if (/FROM process_v7_promotions/i.test(sql)) {
        return [[{ id: 701, preview_case_id: 801, preview_revision_id: 901, document_id: 1001, draft_id: 900 }], []];
      }
      if (/FROM process_design_drafts d/i.test(sql)) {
        return Number(params[0]) === 900
          ? [[draft], []]
          : [[{ id: Number(params[0]), schema_version: 'document-structured-output-v2', status: 'draft' }], []];
      }
      return [[], []];
    }
  };
  const repository = processDesignRouter.makeProcessDesignMysqlRepository(executor);
  const forgedOptions = {
    expectedRevisionNo: 1,
    expectedContentHash: draft.content_hash,
    __tx: true,
    __locator: { caseId: 801, draftId: 900, taskId: 601 }
  };
  try {
    for (const operation of [
      () => repository.submitDraft({ id: 900, schema_version: 'document-structured-output-v2' }, '', 10, forgedOptions),
      () => repository.decideReviewTask({ id: 601, draft_id: 123, status: 'pending' }, 'approve', '', 20, forgedOptions),
      () => repository.publishDraft({ id: 900, schema_version: 'document-structured-output-v2', status: 'approved' }, '', 99, forgedOptions)
    ]) {
      await assert.rejects(
        operation,
        error => error && error.code === 'V7_FORMAL_TRANSACTION_REQUIRED',
        '仓储公开options中的__tx/__locator不得作为内部事务能力'
      );
    }
    assert.strictEqual(lockedQueryObserved, false, '伪造options不得进入仅限内部能力调用的锁定分支');
    assert.strictEqual(writeQueryObserved, false, '仓储必须按标识重读真实V7草稿或任务，伪造schema和draft_id不得降级到旧版写入分支');
  } finally {
    if (originalFormalEnabled === undefined) delete process.env.PROCESS_V7_FORMAL_ENABLED;
    else process.env.PROCESS_V7_FORMAL_ENABLED = originalFormalEnabled;
    if (originalTrialProcessRef === undefined) delete process.env.PROCESS_V7_TRIAL_PROCESS_REF;
    else process.env.PROCESS_V7_TRIAL_PROCESS_REF = originalTrialProcessRef;
  }
}

async function main() {
  assert.strictEqual(PROMOTION_TABLE, 'process_v7_promotions');
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /UNIQUE KEY uq_process_v7_promotion_source \(preview_case_id, preview_revision_id, preview_revision_no, content_hash\)/);
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /FOREIGN KEY \(preview_revision_id\)[\s\S]*process_v7_preview_revisions/i);
  assert.match(PROCESS_V7_FORMAL_SCHEMA_SQL, /FOREIGN KEY \(document_id\)[\s\S]*process_design_documents/i);

  const targetSchema = mdmMysqlSchemaSql();
  assert.match(targetSchema, /process_ref VARCHAR\(160\) NULL/);
  assert.match(targetSchema, /UNIQUE KEY uq_process_design_documents_process_ref \(process_ref\)/);
  assert.match(targetSchema, /draft_revision_no INT NULL[\s\S]*content_hash CHAR\(64\) NULL/);
  assert.match(targetSchema, /content_json JSON NULL/);
  assert.doesNotMatch(targetSchema, /CREATE TABLE IF NOT EXISTS process_v7_promotions/i, 'ordinary schema initialization must not create the M2 audit table');
  assert.doesNotMatch(targetSchema, /CREATE TABLE IF NOT EXISTS process_v7_preview_/i, 'ordinary schema initialization must not create M1 preview tables');

  const compatible = {
    columns: {
      document_process_ref: { exists: true, column_type: 'varchar(160)', nullable: true },
      review_draft_revision_no: { exists: true, column_type: 'int', nullable: true },
      review_content_hash: { exists: true, column_type: 'char(64)', nullable: true },
      version_l1_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_l2_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_l3_name: { exists: true, column_type: 'varchar(255)', nullable: true },
      version_content_json: { exists: true, column_type: 'json', nullable: true }
    },
    indexes: {
      document_process_ref: { exists: true, unique: true, columns: ['process_ref'] },
      review_content_binding: { exists: true, unique: false, columns: ['draft_id', 'draft_revision_no', 'content_hash', 'status'] }
    },
    promotion_table: { exists: true, schema_status: 'matching' }
  };
  assert.deepStrictEqual(schemaDrift(compatible), []);
  assert.ok(schemaDrift({
    ...compatible,
    columns: { ...compatible.columns, document_process_ref: { exists: true, column_type: 'varchar(128)', nullable: true } }
  }).includes('process_design_documents.process_ref'));
  assert.doesNotThrow(() => assertProcessV7PreviewFoundationApplied({ consistency_status: 'applied' }));
  [
    'not_applied',
    'partial_structure',
    'record_without_structure',
    'structure_without_record',
    'schema_drift'
  ].forEach(consistencyStatus => {
    assert.throws(
      () => assertProcessV7PreviewFoundationApplied({ consistency_status: consistencyStatus }),
      error => error && error.code === 'V7_FORMAL_M1_NOT_APPLIED' && error.consistency_status === consistencyStatus,
      `M2 apply must stop before DDL when M1 is ${consistencyStatus}`
    );
  });
  [
    ['applied', true, true, true],
    ['not_applied', false, false, false],
    ['record_without_structure', true, false, false],
    ['structure_without_record', false, false, false],
    ['schema_drift', true, false, false],
    ['partial_structure', false, false, false]
  ].forEach(([consistencyStatus, migrationRecorded, applied, readyForM2]) => {
    assert.deepStrictEqual(
      summarizeProcessV7PreviewFoundation({
        migration_key: '2026-08-25-process-v7-preview-review',
        migration_recorded: migrationRecorded,
        applied,
        consistency_status: consistencyStatus
      }),
      {
        migration_key: '2026-08-25-process-v7-preview-review',
        migration_recorded: migrationRecorded,
        applied,
        consistency_status: consistencyStatus,
        ready_for_m2: readyForM2
      },
      `M2 dry-run must preserve and judge M1 consistency status ${consistencyStatus}`
    );
  });

  const cliSource = fs.readFileSync(path.join(__dirname, 'migrate-process-v7-formal-foundation.js'), 'utf8');
  assert.ok(cliSource.includes('loadFixedMysqlEnvironment'));
  assert.ok(cliSource.includes('redactMysqlConfig'));
  assert.ok(cliSource.includes("args.has('--dry-run')"));
  assert.ok(cliSource.includes("args.has('--apply')"));
  assert.ok(cliSource.includes("args.has('--rollback')"));

  const formalRouteSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'routes', 'processDesignMysql.js'), 'utf8');
  const formalMigrationSource = fs.readFileSync(path.join(__dirname, '..', 'server', 'processV7FormalMigration.js'), 'utf8');
  const m1InspectionIndex = formalMigrationSource.indexOf('inspectProcessV7PreviewReview(pool');
  const firstM2DdlIndex = formalMigrationSource.indexOf("await pool.execute('ALTER TABLE process_design_documents");
  assert.ok(m1InspectionIndex >= 0 && m1InspectionIndex < firstM2DdlIndex, 'M2 must inspect and accept M1 before its first DDL');
  assert.match(formalMigrationSource, /m1_preview_foundation\s*=\s*summarizeProcessV7PreviewFoundation/);
  assert.match(formalMigrationSource, /ready_for_apply\s*=\s*result\.m1_preview_foundation\.ready_for_m2/);
  const lockStart = formalRouteSource.indexOf('async function lockFormalV7Context');
  const lockEnd = formalRouteSource.indexOf('async function runFormalV7Transaction', lockStart);
  const lockSource = formalRouteSource.slice(lockStart, lockEnd);
  const lockTargets = [
    'FROM process_v7_preview_cases',
    'FROM process_v7_preview_revisions',
    'FROM process_v7_promotions',
    'FROM process_design_documents',
    'FROM process_design_versions',
    'FROM process_design_drafts',
    'FROM process_design_review_tasks'
  ];
  let previousLock = -1;
  lockTargets.forEach(target => {
    const currentLock = lockSource.indexOf(target);
    assert.ok(currentLock > previousLock, `V7 formal lock order is missing or out of order at ${target}`);
    previousLock = currentLock;
  });
  assert.match(lockSource, /FROM process_design_review_tasks[\s\S]*ORDER BY id ASC[\s\S]*FOR UPDATE/);
  assert.match(formalRouteSource, /WHERE id=\? AND status IN \('draft','needs_changes'\) AND revision_no=\? AND content_hash=\?/);
  assert.match(formalRouteSource, /WHERE id=\? AND status='pending' AND draft_revision_no=\? AND content_hash=\?/);
  assert.match(formalRouteSource, /WHERE id=\? AND status='approved' AND revision_no=\? AND content_hash=\?/);
  assert.match(formalRouteSource, /WHERE id=\? AND current_version_id=\?/);
  assert.match(formalRouteSource, /WHERE id=\? AND current_version_id IS NULL/);
  assert.ok(formalRouteSource.includes('V7_FORMAL_EXPECTED_REVISION_REQUIRED'));
  assert.ok(formalRouteSource.includes('V7_FORMAL_EXPECTED_CONTENT_HASH_REQUIRED'));
  assert.ok(formalRouteSource.includes('V7_REVIEW_CONTENT_STALE'));
  assert.ok(formalRouteSource.includes('V7_FORMAL_DRAFT_STATE_CONFLICT'));
  assert.ok(formalRouteSource.includes('V7_FORMAL_BASE_VERSION_CONFLICT'));
  assert.ok(formalRouteSource.includes('V7_FORMAL_PROMOTION_EVIDENCE_MISMATCH'));
  assert.ok(formalRouteSource.includes('V7_FORMAL_BLOCKING_ISSUES'));
  assert.match(formalRouteSource, /unresolvedBlockingIssues\(preview\.blockingIssues, scopeDecision\)/);
  assert.ok(formalRouteSource.includes('assertV7FormalEnabled'));
  assert.ok(formalRouteSource.includes('assertV7TrialProcessRef'));
  assert.ok(formalRouteSource.includes('FORMAL_V7_TRANSACTION_CONTEXT'));
  assert.ok(formalRouteSource.includes('FORMAL_V7_ACTOR_CONTEXT'));
  assert.ok(formalRouteSource.includes('SESSION_AUTHORIZATION_CHANGED'));
  assert.match(formalRouteSource, /FROM user_accounts ua[\s\S]*JOIN person p[\s\S]*FOR SHARE/);
  assert.match(formalRouteSource, /FROM person_roles pr[\s\S]*JOIN roles r[\s\S]*LEFT JOIN role_permissions rp[\s\S]*LEFT JOIN permissions permission[\s\S]*FOR SHARE/);
  await assertForgedFormalTransactionOptionsRejected();

  const isolatedRehearsalSource = fs.readFileSync(path.join(__dirname, 'rehearse-process-v7-migrations-isolated.js'), 'utf8');
  assert.match(isolatedRehearsalSource, /Promise\.allSettled\(\[[\s\S]*formalHarness\.request\('publisher',[\s\S]*\/publish[\s\S]*formalHarness\.request\('publisher',[\s\S]*\/publish/);
  assert.match(isolatedRehearsalSource, /expected_revision_no:[\s\S]*expected_content_hash:/);
  assert.doesNotMatch(isolatedRehearsalSource, /processDesignRepository\.(?:submitDraft|decideReviewTask|publishDraft)\s*\(/);
  assert.doesNotMatch(isolatedRehearsalSource, /FORMAL_V7_(?:TRANSACTION|ACTOR)_CONTEXT|Symbol\s*\(/);
  assert.ok(isolatedRehearsalSource.includes('M1_PARTIAL_STRUCTURE_STOPS_APPLY'));
  console.log('Process V7 formal migration contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
