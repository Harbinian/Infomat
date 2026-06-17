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

  let qualityCalls = 0;
  let mappingCalls = 0;

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
      if (filters.canViewAll !== true) {
        throw new Error('角色工作台应把 MySQL 身份权限传给质量问题仓储');
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
      if (filters.canViewAll !== true) {
        throw new Error('角色工作台应把 MySQL 身份权限传给映射待办仓储');
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
    if (qualityCalls !== 1 || mappingCalls !== 1) {
      throw new Error(`角色工作台应各调用一次流程治理 MySQL 仓储，实际 quality=${qualityCalls}, mapping=${mappingCalls}`);
    }

    console.log('Role workbench process governance MySQL API test passed');
  } finally {
    await closeServer(server);
    if (roleWorkbenchRouter.resetIdentityRepositoryFactory) roleWorkbenchRouter.resetIdentityRepositoryFactory();
    if (roleWorkbenchRouter.resetProcessGovernanceRepositoryFactory) roleWorkbenchRouter.resetProcessGovernanceRepositoryFactory();
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
