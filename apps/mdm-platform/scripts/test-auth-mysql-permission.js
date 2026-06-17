const assert = require('assert');
const express = require('express');
const { cleanupDb } = require('./testHelpers/isolatedDb');

process.env.MDM_DB_QUIET = '1';
const previousReadModel = process.env.MDM_IDENTITY_READ_MODEL;
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
  assert.strictEqual(
    typeof auth.setIdentityRepositoryFactory,
    'function',
    'auth should allow MySQL identity repository injection'
  );

  let mode = 'allow';
  let permissionChecks = 0;
  auth.setIdentityRepositoryFactory(async () => ({
    async getUserEffectivePermissions(userId) {
      assert.strictEqual(userId, 42);
      permissionChecks += 1;
      if (mode === 'deny') return { permSet: new Set(['mapping:read']), fieldConstraints: {} };
      return {
        permSet: new Set(['attribute:update']),
        fieldConstraints: {
          'attribute:update': { readonly: ['source_file'] }
        }
      };
    }
  }));

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    if (req.headers['x-no-session']) return next();
    req.session = {
      userId: 42,
      userName: '管理员',
      userRole: 'admin',
      departmentId: 9
    };
    next();
  });
  app.post('/allowed', auth.requirePermission('attribute:update'), (req, res) => {
    res.json({
      success: true,
      permissions: Array.from(req.effectivePermissions),
      fieldConstraints: req.effectiveFieldConstraints
    });
  });

  const server = await listen(app);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const allowedRes = await fetch(`${baseUrl}/allowed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '可写字段' })
    });
    const allowedBody = await allowedRes.json();
    assert.strictEqual(allowedRes.status, 200, JSON.stringify(allowedBody));
    assert.strictEqual(allowedBody.success, true);
    assert.deepStrictEqual(allowedBody.permissions, ['attribute:update']);
    assert.deepStrictEqual(allowedBody.fieldConstraints['attribute:update'].readonly, ['source_file']);

    const readonlyRes = await fetch(`${baseUrl}/allowed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source_file: '不允许写' })
    });
    const readonlyBody = await readonlyRes.json();
    assert.strictEqual(readonlyRes.status, 403, JSON.stringify(readonlyBody));
    assert.strictEqual(readonlyBody.error, '字段只读，不允许写入');
    assert.deepStrictEqual(readonlyBody.readonly_fields, ['source_file']);

    mode = 'deny';
    const deniedRes = await fetch(`${baseUrl}/allowed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '无权限' })
    });
    const deniedBody = await deniedRes.json();
    assert.strictEqual(deniedRes.status, 403, JSON.stringify(deniedBody));
    assert.strictEqual(deniedBody.error, '权限不足');

    const noSessionRes = await fetch(`${baseUrl}/allowed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-no-session': '1' },
      body: JSON.stringify({ name: '未登录' })
    });
    const noSessionBody = await noSessionRes.json();
    assert.strictEqual(noSessionRes.status, 401, JSON.stringify(noSessionBody));
    assert.strictEqual(noSessionBody.error, '未登录');

    assert.strictEqual(permissionChecks, 3);
    console.log('Auth MySQL permission middleware test passed');
  } finally {
    await closeServer(server);
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (previousReadModel === undefined) {
    delete process.env.MDM_IDENTITY_READ_MODEL;
  } else {
    process.env.MDM_IDENTITY_READ_MODEL = previousReadModel;
  }
  cleanupDb({ ignoreErrors: true });
});
