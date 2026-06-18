const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function main() {
  const auth = require('../server/auth');
  const processGovernanceRouter = require('../server/routes/processGovernance');
  assert.strictEqual(
    typeof processGovernanceRouter.setProcessGovernanceRepositoryFactory,
    'function',
    'process governance route should allow MySQL read-model repository injection'
  );

  let called = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 1);
      return {
        permSet: new Set([
          'admin:access',
          'data:view_all',
          'process_quality:manage',
          'process_quality:close',
          'process_mapping:manage',
          'process_mapping:close'
        ]),
        fieldConstraints: {}
      };
    },
    async getUserRoleCodes(userId, legacyRole) {
      assert.strictEqual(userId, 1);
      return [{ code: legacyRole || 'admin', name: '管理员' }, { code: 'admin', name: '管理员' }];
    },
    async getDepartmentById(id) {
      return { id, name: '经营发展部' };
    },
    async getUserById(id) {
      return { id, name: '系统管理员', department_id: 8 };
    }
  }));
  processGovernanceRouter.setProcessGovernanceRepositoryFactory(() => ({
    async listSnapshots() {
      return [
        {
          id: 7,
          source_json_path: 'docs/company-sankey-data.json',
          source_hash: 'hash-mysql-001',
          generated_at: '2026-06-16T00:00:00.000Z',
          imported_at: '2026-06-16 00:00:00',
          status: 'active',
          note: 'mysql fake snapshot'
        }
      ];
    },
    async getCurrentSnapshot() {
      return {
        id: 7,
        source_json_path: 'docs/company-sankey-data.json',
        source_hash: 'hash-mysql-001',
        generated_at: '2026-06-16T00:00:00.000Z',
        imported_at: '2026-06-16 00:00:00',
        status: 'active',
        note: 'mysql fake snapshot',
        stats: { mappings: 1, a1: 0, departmentsWithData: 1, departmentsEmpty: 0 },
        qualitySummary: { BLOCK: 0, WARN: 1, INFO: 0 }
      };
    },
    async getA1Items(filters = {}) {
      assert.ok(filters.dept || filters.system, 'A1 route should pass query filters to repository');
      if (filters.system === 'MES') return [];
      return [
        {
          id: 3,
          snapshot_id: 7,
          a1_code: 'JY-L3-01-A1-001',
          dept_name: '经营发展部',
          l3_name: '销售订单评审和执行管理',
          behavior: '接收订单并组织评审',
          execution_role: '合同管理员',
          approval_type: '审批',
          input_source_dept: '项目管理部',
          output_target_dept: '工程技术部',
          suggested_systems: ['OA', 'ERP'],
          verification_note: '核对技术条款输入',
          source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md'
        }
      ];
    },
    async getSourceFiles(filters = {}) {
      assert.strictEqual(filters.dept, '经营发展部');
      assert.strictEqual(filters.status, '纳入');
      return {
        summary: {
          total: 1,
          byStatus: { '纳入': 1, '排除': 0, '待复核': 0 },
          byAssetType: { procedure: 1 },
          returned: 1,
          limit: 20
        },
        items: [
          {
            file_path: 'docs/norms/经营发展部业务资料/GLTX-JY-23-A销售订单评审和执行管理程序.docx',
            dept_name: '经营发展部',
            asset_type: 'procedure',
            file_no: 'GLTX-JY-23',
            revision: 'A',
            size_bytes: 12345,
            mtime: '2026-06-01T00:00:00.000Z',
            sha256: 'source-file-hash-1',
            process_status: '纳入',
            process_reason: '已作为销售订单评审流程依据'
          }
        ]
      };
    },
    async getMdmRequirements(filters = {}) {
      assert.strictEqual(filters.object, '客户订单');
      return {
        summary: { total: 1, byDept: { '经营发展部': 1 }, returned: 1, limit: 500 },
        items: [
          {
            dept_name: '经营发展部',
            master_data_object: '客户订单',
            source_l2: '合同管理',
            key_fields: '订单号、客户名称、合同编号、状态',
            responsible_dept: '经营发展部',
            system_boundary: 'MDM治理对象；OA/ERP按流程消费或回写',
            governance_requirement: '统一订单编码、状态和跨系统引用口径。',
            source_file: 'docs/norms/经营发展部能力层与MDM建设要求.md'
          }
        ]
      };
    },
    async getEvidenceRefs(filters = {}) {
      assert.strictEqual(filters.l3, '销售订单评审和执行管理');
      assert.strictEqual(filters.a1, 'JY-L3-01-A1-001');
      return {
        summary: { total: 2, byType: { L3: 1, A1: 1, MDM: 0 }, returned: 2, limit: 500 },
        items: [
          {
            ref_type: 'L3',
            dept_name: '经营发展部',
            l3_name: '销售订单评审和执行管理',
            a1_code: '',
            master_data_object: '',
            evidence_type: '制度依据',
            source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
            citation: 'GLTX-JY-23-A §5.1',
            note: 'DCM 映射总表制度依据'
          },
          {
            ref_type: 'A1',
            dept_name: '经营发展部',
            l3_name: '销售订单评审和执行管理',
            a1_code: 'JY-L3-01-A1-001',
            master_data_object: '',
            evidence_type: '原文明确-正文',
            source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md',
            citation: 'GLTX-JY-23-A §5.1.1',
            note: 'A1 制度依据'
          }
        ]
      };
    },
    async getInteractionChains() {
      return [
        {
          id: 4,
          snapshot_id: 7,
          name: '订单到回款',
          status: 'partial',
          breaks_json: '["财务确认节点缺证据"]',
          breaks: ['财务确认节点缺证据'],
          source_report: 'docs/reports/cross-dept.md'
        }
      ];
    },
    async getCrossDeptInteractions(filters = {}) {
      assert.strictEqual(filters.risk, 'high');
      return [
        {
          id: 9,
          snapshot_id: 7,
          source_dept: '经营发展部',
          target_dept: '财务部',
          a1_code: 'A1-001',
          refs: 1,
          risk_level: 'high',
          confirm_status: 'pending',
          description: '跨部门交付物待确认',
          source_report: 'docs/reports/cross-dept.md'
        }
      ];
    },
    async getQualityFindings(filters = {}) {
      assert.strictEqual(filters.severity, 'WARN');
      return {
        summary: { BLOCK: 0, WARN: 1, INFO: 0 },
        items: [
          {
            id: 11,
            severity: 'WARN',
            area: 'source',
            source_file: 'docs/norms/经营发展部.md',
            source_line: 32,
            message: '来源文件待复核',
            suggestion: '补充原文位置',
            dept_name: '经营发展部',
            imported_at: '2026-06-16 00:00:00'
          }
        ]
      };
    },
    async getQualityCases(filters = {}) {
      assert.strictEqual(filters.status, 'open');
      return {
        summary: {
          total: 1,
          bySeverity: { BLOCK: 0, WARN: 1 },
          byStatus: { open: 1, assigned: 0, rectifying: 0, submitted: 0, source_resolved: 0, closed: 0, reopened: 0 }
        },
        items: [
          {
            id: 11,
            severity: 'WARN',
            area: 'source',
            source_file: 'docs/norms/经营发展部.md',
            source_line: 32,
            message: '来源文件待复核',
            suggestion: '补充原文位置',
            dept_name: '经营发展部',
            status: 'open',
            priority: 'medium',
            owner_user_id: null,
            owner_dept_id: null
          }
        ]
      };
    },
    async getQualityCase(caseId) {
      assert.strictEqual(caseId, 11);
      return {
        id: 11,
        severity: 'WARN',
        area: 'source',
        source_file: 'docs/norms/经营发展部.md',
        source_line: 32,
        message: '来源文件待复核',
        suggestion: '补充原文位置',
        dept_name: '经营发展部',
        status: 'open',
        priority: 'medium',
        owner_user_id: null,
        owner_dept_id: null
      };
    },
    async getQualityCaseEvents(caseId) {
      assert.strictEqual(caseId, 11);
      return [];
    },
    async assignQualityCase(caseId, payload = {}) {
      assert.strictEqual(caseId, 11);
      assert.strictEqual(payload.priority, 'high');
      return { case: { id: 11, status: 'assigned', priority: 'high' }, events: [{ event_type: 'assigned', note: payload.note }] };
    },
    async updateQualityCaseStatus(caseId, payload = {}) {
      assert.strictEqual(caseId, 11);
      assert.strictEqual(payload.status, 'rectifying');
      return { case: { id: 11, status: 'rectifying' }, events: [{ event_type: 'status_changed', note: payload.note }] };
    },
    async getMappingWorkspace(filters = {}) {
      assert.strictEqual(filters.type, 'a1');
      return {
        summary: { total: 1, byType: { l3: 0, a1: 1 }, byStatus: { active: 1, source_missing: 0, published: 0, archived: 0 }, returned: 1, limit: 500 },
        items: [
          {
            id: 31,
            record_type: 'a1',
            status: 'active',
            dept_name: '经营发展部',
            l3_name: '销售订单评审和执行管理',
            a1_code: 'JY-L3-01-A1-001',
            behavior: '接收订单并组织评审',
            suggested_systems: ['OA', 'ERP']
          }
        ]
      };
    },
    async getMappingTodos(filters = {}) {
      assert.strictEqual(filters.type, 'cross_dept');
      return {
        summary: {
          total: 1,
          byType: { dept_confirm: 0, verification: 0, adjustment: 0, cross_dept: 1, evidence: 0 },
          byStatus: { open: 1, assigned: 0, rectifying: 0, submitted: 0, source_resolved: 0, closed: 0, reopened: 0, accepted: 0 },
          returned: 1,
          limit: 500
        },
        items: [
          {
            id: 21,
            todo_type: 'cross_dept',
            status: 'open',
            priority: 'high',
            dept_name: '经营发展部',
            target_dept_name: '财务部',
            message: '跨部门交付物待确认',
            suggestion: '补充确认对象'
          }
        ]
      };
    },
    async getMappingTodo(todoId) {
      assert.strictEqual(todoId, 21);
      return {
        id: 21,
        todo_type: 'cross_dept',
        status: 'open',
        priority: 'high',
        dept_name: '经营发展部',
        target_dept_name: '财务部',
        message: '跨部门交付物待确认',
        suggestion: '补充确认对象'
      };
    },
    async getMappingTodoEvents(todoId) {
      assert.strictEqual(todoId, 21);
      return [];
    },
    async submitMappingTodo(todoId, payload = {}) {
      assert.strictEqual(todoId, 21);
      return { todo: { id: 21, status: 'submitted' }, events: [{ event_type: 'submitted', note: payload.note }] };
    },
    async getActiveSankey() {
      called += 1;
      return {
        nodes: [
          {
            name: '经营发展部',
            label: '经营发展部',
            node_type: 'department',
            domain_name: '经营副总',
            dept_name: '经营发展部',
            parent_key: null,
            source_file: 'docs/norms/经营发展部部门-能力-流程-系统映射关系.md'
          },
          {
            name: 'ERP',
            label: 'ERP',
            node_type: 'system',
            domain_name: null,
            dept_name: null,
            parent_key: null,
            source_file: null
          }
        ],
        links: [{ source: '经营发展部', target: 'ERP', value: 1 }],
        systems: ['ERP'],
        stats: { mappings: 1, a1: 0, departmentsWithData: 1, departmentsEmpty: 0 },
        crossDept: {
          stats: { highRisk: 1 },
          risks: [{ source: '经营发展部', target: '财务部', a1: 'A1-001', refs: 1, risk: 'high', status: 'pending', desc: '待确认' }],
          interactionChains: [],
          source: 'docs/reports/cross-dept.md'
        }
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { userId: 1, userName: '系统管理员', userRole: 'admin', departmentId: 8 };
    next();
  });
  app.use('/api/process-governance', processGovernanceRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const snapshotsRes = await fetch(`${baseUrl}/api/process-governance/snapshots`);
    const snapshotsBody = await snapshotsRes.json();
    assert.strictEqual(snapshotsRes.status, 200, JSON.stringify(snapshotsBody));
    assert.strictEqual(snapshotsBody.length, 1);
    assert.strictEqual(snapshotsBody[0].source_hash, 'hash-mysql-001');

    const currentRes = await fetch(`${baseUrl}/api/process-governance/current`);
    const currentBody = await currentRes.json();
    assert.strictEqual(currentRes.status, 200, JSON.stringify(currentBody));
    assert.strictEqual(currentBody.source_hash, 'hash-mysql-001');
    assert.strictEqual(currentBody.stats.mappings, 1);
    assert.deepStrictEqual(currentBody.qualitySummary, { BLOCK: 0, WARN: 1, INFO: 0 });

    const a1Res = await fetch(`${baseUrl}/api/process-governance/a1?dept=${encodeURIComponent('经营发展部')}`);
    const a1Body = await a1Res.json();
    assert.strictEqual(a1Res.status, 200, JSON.stringify(a1Body));
    assert.strictEqual(a1Body.items.length, 1);
    assert.strictEqual(a1Body.items[0].a1_code, 'JY-L3-01-A1-001');
    assert.deepStrictEqual(a1Body.items[0].suggested_systems, ['OA', 'ERP']);

    const a1SystemRes = await fetch(`${baseUrl}/api/process-governance/a1?system=MES`);
    const a1SystemBody = await a1SystemRes.json();
    assert.strictEqual(a1SystemRes.status, 200, JSON.stringify(a1SystemBody));
    assert.deepStrictEqual(a1SystemBody.items, []);

    const sourceFilesRes = await fetch(`${baseUrl}/api/process-governance/source-files?dept=${encodeURIComponent('经营发展部')}&status=${encodeURIComponent('纳入')}`);
    const sourceFilesBody = await sourceFilesRes.json();
    assert.strictEqual(sourceFilesRes.status, 200, JSON.stringify(sourceFilesBody));
    assert.strictEqual(sourceFilesBody.summary.total, 1);
    assert.strictEqual(sourceFilesBody.items[0].file_no, 'GLTX-JY-23');

    const requirementsRes = await fetch(`${baseUrl}/api/process-governance/mdm-requirements?object=${encodeURIComponent('客户订单')}`);
    const requirementsBody = await requirementsRes.json();
    assert.strictEqual(requirementsRes.status, 200, JSON.stringify(requirementsBody));
    assert.strictEqual(requirementsBody.summary.byDept['经营发展部'], 1);
    assert.strictEqual(requirementsBody.items[0].master_data_object, '客户订单');

    const evidenceRes = await fetch(`${baseUrl}/api/process-governance/evidence?l3=${encodeURIComponent('销售订单评审和执行管理')}&a1=${encodeURIComponent('JY-L3-01-A1-001')}`);
    const evidenceBody = await evidenceRes.json();
    assert.strictEqual(evidenceRes.status, 200, JSON.stringify(evidenceBody));
    assert.strictEqual(evidenceBody.summary.byType.L3, 1);
    assert.strictEqual(evidenceBody.summary.byType.A1, 1);
    assert.deepStrictEqual(evidenceBody.items.map(item => item.ref_type), ['L3', 'A1']);

    const chainsRes = await fetch(`${baseUrl}/api/process-governance/chains`);
    const chainsBody = await chainsRes.json();
    assert.strictEqual(chainsRes.status, 200, JSON.stringify(chainsBody));
    assert.strictEqual(chainsBody.items.length, 1);
    assert.strictEqual(chainsBody.items[0].name, '订单到回款');
    assert.deepStrictEqual(chainsBody.items[0].breaks, ['财务确认节点缺证据']);

    const crossDeptRes = await fetch(`${baseUrl}/api/process-governance/cross-dept?risk=high`);
    const crossDeptBody = await crossDeptRes.json();
    assert.strictEqual(crossDeptRes.status, 200, JSON.stringify(crossDeptBody));
    assert.strictEqual(crossDeptBody.items.length, 1);
    assert.strictEqual(crossDeptBody.items[0].risk_level, 'high');

    const qualityRes = await fetch(`${baseUrl}/api/process-governance/quality?severity=WARN`);
    const qualityBody = await qualityRes.json();
    assert.strictEqual(qualityRes.status, 200, JSON.stringify(qualityBody));
    assert.strictEqual(qualityBody.summary.WARN, 1);
    assert.strictEqual(qualityBody.items[0].message, '来源文件待复核');

    const casesRes = await fetch(`${baseUrl}/api/process-governance/quality-cases?status=open`);
    const casesBody = await casesRes.json();
    assert.strictEqual(casesRes.status, 200, JSON.stringify(casesBody));
    assert.strictEqual(casesBody.summary.total, 1);
    assert.strictEqual(casesBody.items[0].status, 'open');

    const caseDetailRes = await fetch(`${baseUrl}/api/process-governance/quality-cases/11`);
    const caseDetailBody = await caseDetailRes.json();
    assert.strictEqual(caseDetailRes.status, 200, JSON.stringify(caseDetailBody));
    assert.strictEqual(caseDetailBody.case.id, 11);

    const assignCaseRes = await fetch(`${baseUrl}/api/process-governance/quality-cases/11/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priority: 'high', note: '转给责任部门处理' })
    });
    const assignCaseBody = await assignCaseRes.json();
    assert.strictEqual(assignCaseRes.status, 200, JSON.stringify(assignCaseBody));
    assert.strictEqual(assignCaseBody.case.status, 'assigned');

    const updateCaseRes = await fetch(`${baseUrl}/api/process-governance/quality-cases/11/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'rectifying', note: '开始整改' })
    });
    const updateCaseBody = await updateCaseRes.json();
    assert.strictEqual(updateCaseRes.status, 200, JSON.stringify(updateCaseBody));
    assert.strictEqual(updateCaseBody.case.status, 'rectifying');

    const workspaceRes = await fetch(`${baseUrl}/api/process-governance/mapping-workspace?type=a1`);
    const workspaceBody = await workspaceRes.json();
    assert.strictEqual(workspaceRes.status, 200, JSON.stringify(workspaceBody));
    assert.strictEqual(workspaceBody.summary.byType.a1, 1);

    const todosRes = await fetch(`${baseUrl}/api/process-governance/mapping-todos?type=cross_dept`);
    const todosBody = await todosRes.json();
    assert.strictEqual(todosRes.status, 200, JSON.stringify(todosBody));
    assert.strictEqual(todosBody.summary.byType.cross_dept, 1);

    const todoDetailRes = await fetch(`${baseUrl}/api/process-governance/mapping-todos/21`);
    const todoDetailBody = await todoDetailRes.json();
    assert.strictEqual(todoDetailRes.status, 200, JSON.stringify(todoDetailBody));
    assert.strictEqual(todoDetailBody.todo.id, 21);

    const submitTodoRes = await fetch(`${baseUrl}/api/process-governance/mapping-todos/21/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: '已补充确认说明' })
    });
    const submitTodoBody = await submitTodoRes.json();
    assert.strictEqual(submitTodoRes.status, 200, JSON.stringify(submitTodoBody));
    assert.strictEqual(submitTodoBody.todo.status, 'submitted');

    const res = await fetch(`${baseUrl}/api/process-governance/sankey`);
    const body = await res.json();

    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(called, 1);
    assert.strictEqual(body.stats.mappings, 1);
    assert.strictEqual(body.systems.join(','), 'ERP');
    assert.strictEqual(body.crossDept.stats.highRisk, 1);
    assert.strictEqual(body.nodes[0].name, '经营发展部');
    assert.strictEqual(body.links[0].source, '经营发展部');

    console.log('Process governance Sankey MySQL API route test passed');
  } finally {
    await closeServer(server);
    processGovernanceRouter.resetProcessGovernanceRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.PROCESS_GOVERNANCE_READ_MODEL;
  } else {
    process.env.PROCESS_GOVERNANCE_READ_MODEL = previousReadModel;
  }
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
