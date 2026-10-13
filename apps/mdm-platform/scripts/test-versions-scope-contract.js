// R01 history-read scope: global / same department / other department / no read right /
// administrator / deleted object. Asserts that a refused caller receives no history value at all
// and cannot tell "not visible" from "does not exist".
// Real HTTP middleware; the audit repository and identity read model are injected; no database.
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

const HOME_DEPARTMENT = 9;
const OTHER_DEPARTMENT = 8;
const MAPPING_ID = 100;
const FIELD_ID = 101;

// personId -> {permissions, departmentId}. The administrator holds governance:read-global, which
// is exactly how the read-only admin role is defined in roleDefinitions.
const callers = {
  global: { personId: 42, accountId: 142, departmentId: HOME_DEPARTMENT, permissions: ['governance:read-global'] },
  sameDepartment: { personId: 43, accountId: 143, departmentId: HOME_DEPARTMENT, permissions: ['governance:read-department'] },
  otherDepartment: { personId: 44, accountId: 144, departmentId: OTHER_DEPARTMENT, permissions: ['governance:read-department'] },
  noReadRight: { personId: 45, accountId: 145, departmentId: HOME_DEPARTMENT, permissions: ['mapping:read'] },
  administrator: { personId: 46, accountId: 146, departmentId: null, permissions: ['governance:read-global', 'identity:read-audit'] }
};
const byAccount = new Map(Object.values(callers).map(caller => [String(caller.accountId), caller]));
let current = callers.global;

auth.setIdentityRepositoryFactory(() => ({
  async getUserEffectivePermissions() {
    return { permSet: new Set(current.permissions), fieldConstraints: {} };
  },
  async validateSession() {
    return { valid: true, user: { personId: current.personId, current_department_id: current.departmentId, person_name: '合成调用者' } };
  }
}));

// The object registry stands in for data_map_contexts / data_map_fields. A null owner means the
// object is gone; the route must then refuse rather than treat the history as open.
const objects = {
  mapping100: { owner: String(HOME_DEPARTMENT), live: true },
  field101: { owner: String(HOME_DEPARTMENT), live: true },
  mappingDeleted: { owner: null, live: false }
};
const calls = [];

function logRow(entityType, entityId, extra = {}) {
  return { id: 20, entity_type: entityType, entity_id: String(entityId), operation: 'update', operator_name: '审核人', ...extra };
}

versionsRouter.setAuditRepositoryFactory(async () => ({
  async listEntityVersions(entityType, entityId) {
    calls.push(['listEntityVersions', entityType, String(entityId)]);
    return { changeSets: [], logs: [logRow(entityType, entityId)] };
  },
  async listMappingVersions(mappingId) {
    calls.push(['listMappingVersions', String(mappingId)]);
    return [logRow('mapping', mappingId)];
  },
  async listFieldVersions(fieldId) {
    calls.push(['listFieldVersions', String(fieldId)]);
    return [logRow('field_entry', fieldId)];
  },
  async readContextDepartment(contextId) {
    const entry = objects[`mapping${contextId}`];
    return entry && entry.live ? { departmentId: entry.owner } : null;
  },
  async readFieldDepartment(fieldId) {
    const entry = objects[`field${fieldId}`];
    return entry && entry.live ? { departmentId: entry.owner } : null;
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

async function main() {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = {
      personId: current.personId, userId: current.personId, accountId: current.accountId,
      authVersion: 1, userName: '合成调用者'
    };
    next();
  });
  app.use('/api/versions', versionsRouter);

  const server = await listen(app);
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async url => {
    const res = await fetch(base + url);
    const text = await res.text();
    return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
  };
  const as = caller => { current = callers[caller]; };

  try {
    // 1. Global reader and administrator reach every entry.
    for (const caller of ['global', 'administrator']) {
      as(caller);
      for (const url of [`/api/versions/entity/mapping/${MAPPING_ID}`, `/api/versions/mapping/${MAPPING_ID}`, `/api/versions/field/${FIELD_ID}`]) {
        const result = await get(url);
        assert.strictEqual(result.status, 200, `${caller} ${url}: ${result.text}`);
      }
    }

    // 2. A department reader sees the history of an object owned by that department.
    as('sameDepartment');
    for (const url of [`/api/versions/entity/mapping/${MAPPING_ID}`, `/api/versions/mapping/${MAPPING_ID}`, `/api/versions/field/${FIELD_ID}`]) {
      const result = await get(url);
      assert.strictEqual(result.status, 200, `same department ${url}: ${result.text}`);
    }

    // 3. A department reader must not see another department's object, and must not see history
    //    hidden behind the generic entry either.
    as('otherDepartment');
    const refused = [];
    for (const url of [`/api/versions/entity/mapping/${MAPPING_ID}`, `/api/versions/mapping/${MAPPING_ID}`, `/api/versions/field/${FIELD_ID}`]) {
      const result = await get(url);
      assert.strictEqual(result.status, 404, `other department ${url}: ${result.text}`);
      assert.ok(!/审核人|entity_id|changeSets|logs/.test(result.text), `no history value may leak: ${result.text}`);
      refused.push(result.text);
    }
    assert.strictEqual(new Set(refused).size, 1, 'every refusal uses the same body');

    // 4. No governance read right at all is refused identically.
    as('noReadRight');
    for (const url of [`/api/versions/entity/mapping/${MAPPING_ID}`, `/api/versions/mapping/${MAPPING_ID}`, `/api/versions/field/${FIELD_ID}`]) {
      const result = await get(url);
      assert.strictEqual(result.status, 404, `no read right ${url}: ${result.text}`);
      assert.strictEqual(result.text, refused[0]);
    }

    // 5. A deleted object has no verifiable retained attribution, so it is refused even for a
    //    caller who would own it -- and the answer is byte-identical to a non-existent object.
    as('sameDepartment');
    const deleted = await get(`/api/versions/mapping/${MAPPING_ID + 900}`);
    const missing = await get(`/api/versions/mapping/${MAPPING_ID + 901}`);
    assert.strictEqual(deleted.status, 404, deleted.text);
    assert.strictEqual(deleted.text, missing.text, '"deleted" and "never existed" are indistinguishable');
    assert.strictEqual(deleted.text, refused[0], 'and identical to a scope refusal');

    // 6. An entity type with no policy never returns rows, whether or not it has a caller that
    //    holds global read, and it never reaches the repository.
    for (const caller of ['global', 'otherDepartment', 'noReadRight']) {
      as(caller);
      for (const url of [`/api/versions/entity/unlisted_type/${MAPPING_ID}`, `/api/versions/entity/TODO/${MAPPING_ID}`, `/api/versions/entity/t%C3%B3do/${MAPPING_ID}`]) {
        const before = calls.length;
        const result = await get(url);
        assert.strictEqual(result.status, 200, `${caller} ${url}: ${result.text}`);
        assert.deepStrictEqual(result.body, { changeSets: [], logs: [] }, `${caller} ${url} returns the empty shape only`);
        assert.strictEqual(calls.length, before, `${caller} ${url} must not query history at all`);
      }
    }

    // 7. Governance-wide types keep the historical rule: only global read is accepted.
    as('sameDepartment');
    assert.strictEqual((await get('/api/versions/entity/terminology_term/7')).status, 404);
    assert.strictEqual((await get('/api/versions/entity/legacy_field_import/7')).status, 404);
    as('global');
    assert.strictEqual((await get('/api/versions/entity/terminology_term/7')).status, 200);

    // MySQL's case/accent-insensitive collation may return legacy variants of "todo".
    // Every returned row in that scope must use the retained metadata filter.
    versionsRouter.setAuditRepositoryFactory(async () => ({ async listEntityVersions() {
      const retained = dept => JSON.stringify({ schema_version: 'todo-deletion-v1', todo: { to_dept_id: dept } });
      return { logs: [logRow('TODO', 1, { metadata_json: retained(HOME_DEPARTMENT) }), logRow('tódo', 2, { metadata_json: retained(OTHER_DEPARTMENT) })],
        changeSets: [logRow('TODO', 3, { metadata_json: retained(OTHER_DEPARTMENT) })] };
    } }));
    as('sameDepartment');
    const todo = await get('/api/versions/entity/todo/1');
    assert.equal(todo.body.logs.length, 1);
    assert.equal(todo.body.logs[0].entity_id, '1');
    assert.equal(todo.body.changeSets.length, 0);

    // Factory failures cannot turn a policy refusal or an unlisted type into a dependency error.
    versionsRouter.setAuditRepositoryFactory(async () => { throw new Error('FORBIDDEN_REPOSITORY_LOOKUP'); });
    as('noReadRight');
    for (const url of ['/api/versions/mapping/100', '/api/versions/field/101', '/api/versions/entity/publication/7']) {
      const result = await get(url);
      assert.equal(result.status, 404);
      assert.equal(result.text, refused[0]);
    }
    assert.deepEqual((await get('/api/versions/entity/unlisted_type/100')).body, { changeSets: [], logs: [] });
    assert.deepEqual((await get('/api/versions/entity/todo/100')).body, { changeSets: [], logs: [] });
    as('global');
    for (const id of ['100junk', '-1', '9223372036854775808']) assert.equal((await get('/api/versions/mapping/' + id)).status, 404);

    console.log('R01 version history scope contract passed: six caller/object combinations, no existence leak');
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
