const http = require('http');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
const previousProcessReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
process.env.PROCESS_GOVERNANCE_READ_MODEL = 'mysql';

const roleWorkbenchRouter = require('../server/routes/roleWorkbench');

function request(server, method, urlPath) {
  const address = server.address();
  const options = {
    hostname: '127.0.0.1',
    port: address.port,
    path: urlPath,
    method,
    headers: { 'Content-Type': 'application/json' }
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, res => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try { parsed = data ? JSON.parse(data) : {}; } catch (error) { /* keep raw */ }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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
  if (typeof roleWorkbenchRouter.setIdentityRepositoryFactory !== 'function') {
    throw new Error('角色工作台应支持注入 MySQL 身份仓储');
  }
  if (typeof roleWorkbenchRouter.setProcessGovernanceRepositoryFactory !== 'function') {
    throw new Error('角色工作台应支持注入流程治理 MySQL 仓储');
  }
  if (typeof roleWorkbenchRouter.setInputBaselineReviewRepositoryFactory !== 'function') {
    throw new Error('角色工作台应支持注入输入基线复核 MySQL 仓储');
  }

  let qualityCalls = 0;
  let mappingCalls = 0;
  let reviewItemCalls = 0;

  roleWorkbenchRouter.setIdentityRepositoryFactory(async () => ({
    async getCurrentUserPayload(session) {
      return {
        id: session.userId,
        name: 'MySQL 工作台用户',
        role: 'owner',
        departmentId: 601,
        departmentName: 'MySQL 经营发展部',
        rbacRoles: [
          { code: 'data_quality', name: '数据质量员' },
          { code: 'business_contact', name: '业务对接人' }
        ],
        roleCodes: ['data_quality', 'business_contact'],
        permissions: ['data:view_all']
      };
    }
  }));

  roleWorkbenchRouter.setProcessGovernanceRepositoryFactory(() => ({
    async getQualityCases(filters = {}) {
      qualityCalls += 1;
      if (filters.canViewAll !== false) {
        throw new Error('非管理层角色工作台应按本部门读取质量问题');
      }
      if (filters.departmentName !== 'MySQL 经营发展部') {
        throw new Error('角色工作台应把 MySQL 身份部门传给质量问题仓储');
      }
      return {
        summary: { total: 1 },
        items: [
          {
            id: 701,
            severity: 'BLOCK',
            area: 'source',
            source_file: 'mysql-quality.md',
            source_line: 17,
            message: 'MySQL 质量问题',
            suggestion: '从 MySQL 流程治理仓储读取',
            dept_name: '质量管理部',
            status: 'open',
            priority: 'high',
            due_date: null,
            owner_dept_name: '质量管理部'
          }
        ]
      };
    },
    async getMappingTodos(filters = {}) {
      mappingCalls += 1;
      if (filters.canViewAll !== false) {
        throw new Error('非管理层角色工作台应按本部门读取映射待办');
      }
      if (filters.departmentName !== 'MySQL 经营发展部') {
        throw new Error('角色工作台应把 MySQL 身份部门传给映射待办仓储');
      }
      return {
        summary: { total: 1 },
        items: [
          {
            id: 801,
            todo_type: 'cross_dept',
            status: 'open',
            priority: 'high',
            due_date: null,
            dept_name: '经营发展部',
            target_dept_name: '财务部',
            source_file: 'mysql-mapping.md',
            source_line: 23,
            message: 'MySQL 映射待办',
            suggestion: '从 MySQL 流程治理仓储读取',
            a1_code: 'A1-MYSQL-001',
            owner_dept_name: '经营发展部'
          }
        ]
      };
    }
  }));

  roleWorkbenchRouter.setInputBaselineReviewRepositoryFactory(() => ({
    async listRuns() {
      return [
        {
          run_id: 'review-run-mysql-001',
          issue_count: 1,
          imported_at: '2026-06-29 00:00:00'
        }
      ];
    },
    async getReviewItems(runId, filters = {}) {
      reviewItemCalls += 1;
      if (runId !== 'review-run-mysql-001') {
        throw new Error('角色工作台应读取最新输入基线复核批次');
      }
      if (filters.dept !== 'MySQL 经营发展部') {
        throw new Error('角色工作台应按当前部门读取输入基线待确认问题');
      }
      return {
        summary: { total: 1 },
        items: [
          {
            id: 'IBR-MYSQL-001',
            stable_key: 'ibr-mysql-001',
            department: 'MySQL 经营发展部',
            document_name: '经营资料.docx',
            source_file: 'docs/norms/MySQL经营发展部业务资料/经营资料.docx',
            source_label: '经营资料.docx 第5.1条',
            issue_type: '待确认A1',
            content: 'MySQL 输入基线待确认问题',
            mapping_location: '当前映射位置待核对',
            suggested_action: '回源核验后记录处理结论',
            definition_status: 'needs_original_review',
            owner: '经营发展部确认人',
            status: '待处理'
          }
        ]
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'owner',
      userName: '本地会话用户',
      departmentId: 601
    };
    next();
  });
  app.use('/api/role-workbench', roleWorkbenchRouter);

  const server = await listen(app);
  try {
    const res = await request(server, 'GET', '/api/role-workbench?mode=todo');
    if (res.status !== 200) {
      throw new Error(`角色工作台 MySQL 流程读模型应返回 200，实际 ${res.status}: ${JSON.stringify(res.body)}`);
    }

    const workItems = Array.isArray(res.body.workItems) ? res.body.workItems : [];
    if (!workItems.some(item => item.type === 'process_quality' && item.title.includes('MySQL 质量问题'))) {
      throw new Error('角色工作台应显示来自 MySQL 流程治理仓储的质量问题');
    }
    if (!workItems.some(item => item.type === 'process_mapping_todo' && item.title.includes('MySQL 映射待办'))) {
      throw new Error('角色工作台应显示来自 MySQL 流程治理仓储的映射待办');
    }
    const inputBaselineItem = workItems.find(item => item.type === 'input_baseline_issue' && item.title.includes('MySQL 输入基线待确认问题'));
    if (!inputBaselineItem) {
      throw new Error('角色工作台应显示来自输入基线复核仓储的待确认问题');
    }
    if (inputBaselineItem.sourceType !== 'input_baseline_issue' || !inputBaselineItem.responsiblePerson || !inputBaselineItem.nextStep) {
      throw new Error('输入基线待确认工作项应包含统一治理字段');
    }
    if (qualityCalls !== 1 || mappingCalls !== 1 || reviewItemCalls !== 1) {
      throw new Error(`角色工作台应各调用一次治理仓储，实际 quality=${qualityCalls}, mapping=${mappingCalls}, review=${reviewItemCalls}`);
    }

    console.log('Role workbench process governance MySQL API test passed');
  } finally {
    await closeServer(server);
    if (roleWorkbenchRouter.resetIdentityRepositoryFactory) roleWorkbenchRouter.resetIdentityRepositoryFactory();
    if (roleWorkbenchRouter.resetProcessGovernanceRepositoryFactory) roleWorkbenchRouter.resetProcessGovernanceRepositoryFactory();
    if (roleWorkbenchRouter.resetInputBaselineReviewRepositoryFactory) roleWorkbenchRouter.resetInputBaselineReviewRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
  if (previousProcessReadModel === undefined) {
    delete process.env.PROCESS_GOVERNANCE_READ_MODEL;
  } else {
    process.env.PROCESS_GOVERNANCE_READ_MODEL = previousProcessReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
