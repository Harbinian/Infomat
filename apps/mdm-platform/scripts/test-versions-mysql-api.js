const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';

const versionsRouter = require('../server/routes/versions');

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
      state.calls.push(['listEntityVersions', entityType, Number(entityId)]);
      return {
        changeSets: [
          { id: 10, entity_type: entityType, entity_id: Number(entityId), description: '实体变更集' }
        ],
        logs: [
          { id: 20, entity_type: entityType, entity_id: Number(entityId), operation: 'update', operator_name: '审核人' }
        ]
      };
    },
    async listMappingVersions(mappingId) {
      state.calls.push(['listMappingVersions', Number(mappingId)]);
      return [
        { id: 21, entity_type: 'mapping', entity_id: Number(mappingId), operation: 'submit', operator_name: '审核人' }
      ];
    },
    async listFieldVersions(fieldId) {
      state.calls.push(['listFieldVersions', Number(fieldId)]);
      return [
        { id: 22, entity_type: 'field_entry', entity_id: Number(fieldId), operation: 'update', operator_name: '字段负责人' }
      ];
    }
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
    req.session = { userId: 42, userRole: 'admin', userName: '管理员', departmentId: 9 };
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

    console.log('Versions MySQL API test passed');
  } finally {
    await closeServer(server);
    versionsRouter.resetAuditRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
