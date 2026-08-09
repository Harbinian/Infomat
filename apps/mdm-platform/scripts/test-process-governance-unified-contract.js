const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { mdmMysqlSchemaSql } = require('../server/mysqlSchema');
const {
  ACCESS_MODEL_VERSION,
  ROLE_GUIDES,
  RACI_ACTIVITIES,
  getAccessModel
} = require('../server/roleDefinitions');
const {
  MIGRATION_KEY,
  HANDOFF_STATUSES,
  DRAFT_COLUMNS,
  VERSION_COLUMNS,
  convertLegacyProcessDesignContent
} = require('../server/processGovernanceUnifiedMigration');
const {
  V2,
  CURRENT_VERSION,
  createEmptyProcessGovernanceDocument,
  normalizeProcessGovernanceDocument
} = require('../server/processGovernanceV2');
const processDesignRouter = require('../server/routes/processDesignMysql');

async function assertCanonicalSaveRollsBackWhenProjectionFails() {
  const originalDocument = createEmptyProcessGovernanceDocument({
    process_ref: 'P-ROLLBACK',
    process_name: '事务回滚原流程',
    owning_department: '测试部门'
  });
  const changedDocument = JSON.parse(JSON.stringify(originalDocument));
  changedDocument.process.process_name = '事务回滚新流程';
  let revision = 1;
  const calls = [];
  const draftRow = () => ({
    id: 99,
    document_id: 9,
    document_no: 'PG-P-ROLLBACK',
    process_name: '事务回滚原流程',
    department_id: 1,
    department_name: '测试部门',
    status: 'draft',
    schema_version: V2,
    process_content_json: JSON.stringify(originalDocument),
    content_hash: 'original-hash',
    revision_no: revision
  });
  const connection = {
    async beginTransaction() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    release() {
      calls.push('release');
    },
    async execute(sql) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push(compact);
      if (compact.includes('FROM process_design_drafts d') && compact.includes('WHERE d.id=?')) {
        return [[draftRow()]];
      }
      if (compact.startsWith('UPDATE process_design_drafts') && compact.includes('revision_no=revision_no+1')) {
        revision += 1;
        return [{ affectedRows: 1 }];
      }
      if (compact.includes('FROM process_design_structured_imports')) return [[]];
      if (compact.includes('FROM departments') && compact.includes("status='active'")) {
        return [[{ id: 1, name: '测试部门', final_responsible_person_id: 7 }]];
      }
      if (compact.startsWith('UPDATE process_design_drafts')) return [{ affectedRows: 1 }];
      if (compact.includes('FROM process_design_processes') && compact.includes('source_process_ref')) {
        throw new Error('projection write failed');
      }
      throw new Error(`unexpected SQL in rollback test: ${compact}`);
    }
  };
  const pool = {
    async getConnection() {
      return connection;
    }
  };
  const repo = processDesignRouter.makeProcessDesignMysqlRepository(pool);
  await assert.rejects(
    () => repo.saveCanonicalContent(
      draftRow(),
      changedDocument,
      1,
      7,
      {
        actor: {
          userId: 7,
          personId: 7,
          departmentId: 1,
          departmentName: '测试部门',
          roleCodes: ['department_contact'],
          roleCode: 'department_contact'
        }
      }
    ),
    /projection write failed/
  );
  assert.ok(calls.includes('begin'), 'canonical save must start a transaction');
  assert.ok(calls.includes('rollback'), 'projection failure must roll back canonical save');
  assert.ok(calls.includes('release'), 'transaction connection must be released');
  assert.ok(!calls.includes('commit'), 'failed projection must not commit canonical content');
}

async function assertConflictMutationRollsBackWhenEventWriteFails() {
  const calls = [];
  const conflict = {
    id: 8,
    handoff_id: 108,
    status: 'pending_assignment',
    evidence_json: '[]'
  };
  const connection = {
    async beginTransaction() {
      calls.push('begin');
    },
    async commit() {
      calls.push('commit');
    },
    async rollback() {
      calls.push('rollback');
    },
    release() {
      calls.push('release');
    },
    async execute(sql) {
      const compact = sql.replace(/\s+/g, ' ').trim();
      calls.push(compact);
      if (compact === 'SELECT id FROM process_design_handoff_conflicts WHERE id=? FOR UPDATE') {
        return [[{ id: conflict.id }]];
      }
      if (compact.includes('FROM process_design_handoff_conflicts conflict') && compact.includes('WHERE conflict.id=?')) {
        return [[conflict]];
      }
      if (compact.startsWith('UPDATE process_design_handoff_conflicts')) {
        return [{ affectedRows: 1 }];
      }
      if (compact.startsWith('INSERT INTO process_design_handoff_events')) {
        throw new Error('event write failed');
      }
      throw new Error(`unexpected SQL in conflict rollback test: ${compact}`);
    }
  };
  const pool = {
    async getConnection() {
      return connection;
    }
  };
  const repo = processDesignRouter.makeProcessDesignMysqlRepository(pool);
  await assert.rejects(
    () => repo.assignHandoffConflict(
      conflict,
      13,
      {
        userId: 12,
        personId: 12,
        departmentId: 1,
        departmentName: '测试部门',
        roleCodes: ['mdm_lead'],
        roleCode: 'mdm_lead'
      }
    ),
    /event write failed/
  );
  assert.ok(calls.includes('begin'), 'conflict mutation must start a transaction');
  assert.ok(calls.includes('rollback'), 'event failure must roll back conflict mutation');
  assert.ok(calls.includes('release'), 'conflict transaction connection must be released');
  assert.ok(!calls.includes('commit'), 'failed conflict mutation must not commit status');
}

async function main() {
  const schema = mdmMysqlSchemaSql();
  const routeSource = fs.readFileSync(path.join(__dirname, '../server/routes/processDesignMysql.js'), 'utf8');
  const migrationCli = fs.readFileSync(path.join(__dirname, 'migrate-process-governance-unified.js'), 'utf8');
  const frontend = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const model = getAccessModel();

  assert.strictEqual(ACCESS_MODEL_VERSION, 'rbac-raci-v3-2026-07-31');
  assert.strictEqual(MIGRATION_KEY, '2026-07-31-process-governance-unified-entry');
  assert.strictEqual(model.roles.length, 7);
  ROLE_GUIDES.forEach(role => {
    assert.ok(Array.isArray(role.visibleTabs) && role.visibleTabs.length > 0, `${role.code} missing visible tabs`);
    const apiRole = model.roles.find(item => item.code === role.code);
    assert.deepStrictEqual(apiRole.visibleTabs, role.visibleTabs);
  });
  assert.ok(RACI_ACTIVITIES.some(item => item.activityCode === 'process.handoff.acceptance'));
  assert.ok(RACI_ACTIVITIES.some(item => item.activityCode === 'process.handoff-conflict.coordinate'));
  assert.ok(RACI_ACTIVITIES.some(item => item.activityCode === 'process.handoff-conflict.decision'));

  const empty = createEmptyProcessGovernanceDocument({
    process_name: '测试流程',
    owning_department: '测试部门'
  });
  assert.strictEqual(empty.schema_version, CURRENT_VERSION);
  assert.deepStrictEqual(normalizeProcessGovernanceDocument(empty).errors, []);

  const migrated = convertLegacyProcessDesignContent({
    draft: {
      id: 7,
      document_no: 'GLTX-CS-01',
      planned_edition: 'A',
      process_name: '测试迁移流程',
      department_name: '测试部门',
      l1_name: '测试能力域',
      l2_name: '测试业务能力',
      l2_status: 'confirmed',
      created_at: '2026-07-01T00:00:00.000Z',
      updated_at: '2026-07-02T00:00:00.000Z'
    },
    documentProfile: { purpose: '验证迁移', scope: '测试范围' },
    processes: [{ id: 71, source_process_ref: 'process_71' }],
    steps: [{
      id: 72,
      process_id: 71,
      source_behavior_ref: 'behavior_72',
      step_type: 'action',
      step_name: '提交申请',
      status: 'active',
      sort_order: 1,
      behaviorDetail: {},
      handoffs: []
    }],
    stepTransitions: [],
    forms: [],
    terms: [],
    evidence: [{ id: 73, description: '历史证据必须保留' }]
  });
  assert.deepStrictEqual(migrated.errors, []);
  assert.strictEqual(migrated.document.process.process_ref, 'process_71');
  assert.ok(
    migrated.document.reference_materials[0].readable_text.includes('历史证据必须保留'),
    'legacy snapshot should remain losslessly available in the v2 migration material'
  );

  DRAFT_COLUMNS.forEach(([column]) => assert.ok(schema.includes(`${column} `), `missing draft column ${column}`));
  VERSION_COLUMNS.forEach(([column]) => assert.ok(schema.includes(`${column} `), `missing version column ${column}`));
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS process_design_handoff_conflicts'));
  assert.ok(schema.includes('CREATE TABLE IF NOT EXISTS process_design_handoff_events'));
  assert.ok(schema.includes('open_conflict_marker TINYINT GENERATED ALWAYS AS'));
  assert.ok(schema.includes('uq_process_design_handoff_open_conflict_v2 (handoff_id, open_conflict_marker)'));
  assert.ok(HANDOFF_STATUSES.includes('conflict_open'));

  [
    "router.get('/drafts'",
    "router.get('/drafts/:id/content'",
    "router.put('/drafts/:id/content'",
    "code: 'DRAFT_REVISION_CONFLICT'",
    "actual_revision: Number(latest && latest.revision_no || 0)",
    "code: 'HANDOFF_VOID_REASON_REQUIRED'",
    "governance_projection: 'synced'",
    'candidate.candidate_version',
    'skipCanonicalUpdate: true',
    'skipImportAudit: true',
    'runLockedHandoffMutation',
    'runLockedConflictMutation',
    'actorCanActOnConflict',
    "handoff.status === 'conflict_open' ? 'branched' : 'current'",
    'getLatestHandoffConflict',
    "router.get('/cross-dept-handoffs/:id/story'",
    "router.get('/handoff-conflicts'",
    "router.post('/handoff-conflicts/:id/decision'"
  ].forEach(fragment => assert.ok(routeSource.includes(fragment), `missing route contract ${fragment}`));
  assert.ok(
    !routeSource.includes('LIMIT ?'),
    'MySQL prepared LIMIT placeholders are not supported by the fixed local database runtime'
  );
  ['--dry-run', '--apply', '--rollback', '--compensate']
    .forEach(mode => assert.ok(migrationCli.includes(`'${mode}'`), `migration CLI missing ${mode}`));
  assert.ok(migrationCli.includes('manual_objects'), 'migration CLI must report objects that need manual conversion');

  [
    '流程编制',
    '跨部门承接待办',
    '承接冲突待办',
    '角色可见标签',
    'pgHandoffVoidReasonPanel',
    'voided_handoffs: handoffVoidReasonsPayload()'
  ]
    .forEach(label => assert.ok(frontend.includes(label), `frontend missing ${label}`));
  [
    '文档结构化输出',
    '待确认问题',
    '流程图谱',
    '证据来源',
    '映射工作',
    '治理闭环'
  ].forEach(label => assert.ok(!frontend.includes(`label: '${label}'`), `retired process governance label remains: ${label}`));

  await assertCanonicalSaveRollsBackWhenProjectionFails();
  await assertConflictMutationRollsBackWhenEventWriteFails();
  console.log('Unified process governance contract tests passed');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
