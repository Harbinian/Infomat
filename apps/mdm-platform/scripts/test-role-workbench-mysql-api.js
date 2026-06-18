const http = require('http');

const { cleanupDb } = require('./testHelpers/isolatedDb');

const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
const previousProcessReadModel = process.env.PROCESS_GOVERNANCE_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';
delete process.env.PROCESS_GOVERNANCE_READ_MODEL;

const express = require('express');
const db = require('../server/db');
const roleWorkbenchRouter = require('../server/routes/roleWorkbench');

const PORT = 3127;
const BASE = `http://localhost:${PORT}`;

function request(method, urlPath) {
  const url = new URL(urlPath, BASE);
  const options = {
    hostname: url.hostname,
    port: url.port,
    path: url.pathname + url.search,
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

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function seedCrossDepartmentQualityCase() {
  const snapshotId = db.prepare(`
    INSERT INTO process_governance_snapshots (source_json_path, source_hash, generated_at, stats_json, status, note)
    VALUES ('test-role-workbench-mysql.json', 'test-role-workbench-mysql-hash', '2026-06-17', '{}', 'active', 'MySQL 身份读模型测试')
  `).run().lastInsertRowid;

  db.prepare(`
    INSERT INTO process_governance_quality_cases
      (finding_key, first_snapshot_id, latest_snapshot_id, severity, area, source_file,
       source_line, message, suggestion, dept_name, status, priority)
    VALUES ('test-role-workbench-mysql-quality', ?, ?, 'BLOCK', 'BBM', 'test.md',
       12, '跨部门流程治理问题', '应由有全量权限的角色看到', '其他部门', 'open', 'high')
  `).run(snapshotId, snapshotId);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'owner',
      userName: '本地会话姓名',
      departmentId: 900
    };
    next();
  });
  app.use('/api/role-workbench', roleWorkbenchRouter);
  return app;
}

async function main() {
  let server;
  let currentPayloadCalls = 0;

  try {
    assert(
      typeof roleWorkbenchRouter.setIdentityRepositoryFactory === 'function',
      '角色工作台应支持注入 MySQL 身份仓储'
    );

    roleWorkbenchRouter.setIdentityRepositoryFactory(async () => ({
      async getCurrentUserPayload(session) {
        currentPayloadCalls += 1;
        assert(session.userId === 42, 'MySQL 身份仓储应接收当前会话用户');
        return {
          id: 42,
          name: 'MySQL 身份用户',
          role: 'owner',
          departmentId: 900,
          departmentName: 'MySQL 经营发展部',
          rbacRoles: [
            { code: 'business_contact', name: '业务对接人' },
            { code: 'data_quality', name: '数据质量员' }
          ],
          roleCodes: ['business_contact', 'data_quality'],
          permissions: ['data:view_all']
        };
      }
    }));

    seedCrossDepartmentQualityCase();
    server = makeApp().listen(PORT);

    const res = await request('GET', '/api/role-workbench?mode=todo');
    assert(res.status === 200, `MySQL 身份读模型下角色工作台应返回 200，实际 ${res.status}`);
    assert(currentPayloadCalls > 0, '角色工作台应调用 MySQL 身份仓储');
    assert(res.body.user.name === 'MySQL 身份用户', '用户姓名应来自 MySQL 身份读模型');
    assert(res.body.user.departmentName === 'MySQL 经营发展部', '部门名称应来自 MySQL 身份读模型');
    assert(res.body.user.roleCodes.includes('business_contact'), '应返回 MySQL 身份读模型的业务对接人角色');
    assert(res.body.user.roleCodes.includes('data_quality'), '应返回 MySQL 身份读模型的数据质量员角色');
    assert(res.body.roles.some(role => role.code === 'business_contact' && role.owned), '业务对接人应标记为当前拥有角色');
    assert(res.body.roles.some(role => role.code === 'data_quality' && role.owned), '数据质量员应标记为当前拥有角色');
    assert(
      res.body.workItems.some(item => item.type === 'process_quality' && item.title.includes('跨部门流程治理问题')),
      'data:view_all 权限应让角色工作台看到跨部门流程治理问题'
    );

    console.log('Role workbench MySQL identity API test passed');
  } finally {
    if (roleWorkbenchRouter.resetIdentityRepositoryFactory) roleWorkbenchRouter.resetIdentityRepositoryFactory();
    if (server) await new Promise(resolve => server.close(resolve));
    try {
      db.close();
    } finally {
      cleanupDb();
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
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
});
