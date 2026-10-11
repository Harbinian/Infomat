// Version history route: repository wiring and the global-reader path.
// The R01 scope matrix lives in test-versions-scope-contract.js; this file keeps the original
// "the three entries reach the repository and return its rows" contract under a permitted caller.
// No database connections: the audit repository and the identity read model are both injected.
const assert = require('assert');
const express = require('express');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
process.env = isolatedEnvironment({
  NODE_ENV: 'test', MDM_IDENTITY_READ_MODEL: 'mysql', MDM_SESSION_STORE: 'memory',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test'
});
require('./testHelpers/blockRealMysql');

const auth = require('../server/auth');
const versionsRouter = require('../server/routes/versions');

const DEPARTMENT = 9;
const permissions = new Set(['governance:read-global', 'governance:read-department']);

auth.setIdentityRepositoryFactory(() => ({
  async getUserEffectivePermissions() { return { permSet: permissions, fieldConstraints: {} }; },
  async validateSession() {
    return { valid: true, user: { personId: 42, current_department_id: DEPARTMENT, person_name: '管理员' } };
  }
}));

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

function makeFakeAuditRepository() {
  const state = { calls: [] };
  return {
    state,
    async listEntityVersions(entityType, entityId) {
      state.calls.push(['listEntityVersions', entityType, String(entityId)]);
      return {
        changeSets: [
          { id: 10, entity_type: entityType, entity_id: String(entityId), description: '实体变更集' }
        ],
        logs: [
          { id: 20, entity_type: entityType, entity_id: String(entityId), operation: 'update', operator_name: '审核人' }
        ]
      };
    },
    async listMappingVersions(mappingId) {
      state.calls.push(['listMappingVersions', String(mappingId)]);
      return [
        { id: 21, entity_type: 'mapping', entity_id: String(mappingId), operation: 'submit', operator_name: '审核人' }
      ];
    },
    async listFieldVersions(fieldId) {
      state.calls.push(['listFieldVersions', String(fieldId)]);
      return [
        { id: 22, entity_type: 'field_entry', entity_id: String(fieldId), operation: 'update', operator_name: '字段负责人' }
      ];
    },
    async readContextDepartment() { return { departmentId: String(DEPARTMENT) }; },
    async readFieldDepartment() { return { departmentId: String(DEPARTMENT) }; }
  };
}

async function main() {
  assert.strictEqual(
    typeof versionsRouter.setAuditRepositoryFactory,
    'function',
    'versions route should allow MySQL audit repository injection'
  );

  const repo = makeFakeAuditRepository();
  versionsRouter.setAuditRepositoryFactory(async () => repo);

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: 42, userId: 42, accountId: 142, authVersion: 1,
      userRole: 'admin', userName: '管理员', departmentId: DEPARTMENT
    };
    next();
  });
  app.use('/api/versions', versionsRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    let res = await fetch(`${baseUrl}/api/versions/entity/mapping/100`);
    let body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.changeSets.length, 1);
    assert.strictEqual(body.logs[0].operator_name, '审核人');

    res = await fetch(`${baseUrl}/api/versions/mapping/100`);
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body[0].operation, 'submit');

    res = await fetch(`${baseUrl}/api/versions/field/101`);
    body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body[0].operator_name, '字段负责人');

    const callNames = repo.state.calls.map(call => call[0]);
    for (const expected of ['listEntityVersions', 'listMappingVersions', 'listFieldVersions']) {
      assert.ok(callNames.includes(expected), `versions route should call repository method ${expected}`);
    }

    console.log('Versions MySQL API test passed: permitted caller reaches all three history entries');
  } finally {
    await closeServer(server);
    versionsRouter.resetAuditRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
