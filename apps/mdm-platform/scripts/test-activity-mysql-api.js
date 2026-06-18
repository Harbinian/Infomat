const assert = require('assert');
const express = require('express');

process.env.MDM_DB_QUIET = '1';
const previousIdentityReadModel = process.env.MDM_IDENTITY_READ_MODEL;
process.env.MDM_IDENTITY_READ_MODEL = 'mysql';

const auth = require('../server/auth');
const activityRouter = require('../server/routes/activity');

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
    async listActivityRows(range) {
      state.calls.push(['listActivityRows', range]);
      return [
        {
          date: range.endDate,
          sourceType: 'mapping_review',
          sourceLabel: '映射提交/审核',
          actorUserId: 42,
          actorName: '审核人',
          employeeNo: 'E042',
          departmentId: 9,
          departmentName: '经营发展部'
        },
        {
          date: range.endDate,
          sourceType: 'todo_done',
          sourceLabel: '通用待办完成',
          actorUserId: null,
          actorName: null,
          employeeNo: null,
          departmentId: 9,
          departmentName: '经营发展部'
        }
      ];
    }
  };
}

async function main() {
  assert.strictEqual(
    typeof activityRouter.setAuditRepositoryFactory,
    'function',
    'activity route should allow MySQL audit repository injection'
  );

  const repo = makeFakeAuditRepository();
  activityRouter.setAuditRepositoryFactory(async () => repo);
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      return { permSet: new Set(['data:view_all']), fieldConstraints: {} };
    },
    async getUserRoleCodes(userId, legacyRole) {
      return [{ code: legacyRole || 'data_quality', name: '数据质量' }];
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      userId: 42,
      userRole: 'data_quality',
      userName: '审核人',
      departmentId: 9
    };
    next();
  });
  app.use('/api/activity', activityRouter);

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const res = await fetch(`${baseUrl}/api/activity/heatmap?scope=team&days=90&department_id=9`);
    const body = await res.json();
    assert.strictEqual(res.status, 200, JSON.stringify(body));
    assert.strictEqual(body.scope, 'team');
    assert.strictEqual(body.summary.totalActions, 2);
    assert.strictEqual(body.departments[0].name, '经营发展部');
    assert.strictEqual(body.users[0].name, '审核人');
    assert.ok(body.dates.some(day => day.sources.mapping_review === 1), 'heatmap should include mapping review source');
    assert.ok(body.dates.some(day => day.sources.todo_done === 1), 'heatmap should include todo done source');

    assert.deepStrictEqual(repo.state.calls.map(call => call[0]), ['listActivityRows']);

    console.log('Activity MySQL API test passed');
  } finally {
    await closeServer(server);
    activityRouter.resetAuditRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousIdentityReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousIdentityReadModel;
  }
});
