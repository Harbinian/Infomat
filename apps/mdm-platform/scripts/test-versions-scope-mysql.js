// R01 history scope against a real, owned, isolated MySQL: the object's owning department is
// resolved from the live data-map tables, an object that is gone is refused rather than treated
// as open, exact BIGINT entity ids survive the round trip, and no historical row is ever deleted
// to close a gap.
// Usage: node scripts/test-versions-scope-mysql.js --output <new directory under artifacts/>
const assert = require('assert');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { makeAuditMysqlRepository } = require('../server/auditMysqlRepository');

process.env = isolatedEnvironment({
  NODE_ENV: 'test', MDM_IDENTITY_READ_MODEL: 'mysql', MDM_SESSION_STORE: 'memory',
  MYSQL_HOST: '127.0.0.1', MYSQL_PORT: '1', MYSQL_USER: 'synthetic', MYSQL_PASSWORD: 'synthetic-only',
  MYSQL_DATABASE: 'unreachable_test'
});
const auth = require('../server/auth');
const versionsRouter = require('../server/routes/versions');

const at = process.argv.indexOf('--output');
assert(at > 0 && process.argv[at + 1], '--output is required');
const output = path.resolve(process.argv[at + 1]);
const artifacts = path.resolve(__dirname, '../../../artifacts');
assert(output.startsWith(artifacts + path.sep), 'evidence must be inside repository artifacts');
assert(!fs.existsSync(output), 'use a new evidence directory');
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });

const HOME = '91', OTHER = '92';
const BIG = '9007199254741001';
// data_map_objects is created because data_map_fields carries a foreign key to it; the scope
// decision itself only ever reads data_map_contexts.dept_id.
const TABLES = ['departments', 'users', 'person', 'data_map_objects', 'data_map_contexts', 'data_map_fields', 'mdm_change_sets', 'mdm_version_log'];

// Callers are addressed by account id so the same middleware stub can switch between them.
const callers = {
  global: { accountId: '141', departmentId: HOME, permissions: ['governance:read-global'] },
  sameDepartment: { accountId: '142', departmentId: HOME, permissions: ['governance:read-department'] },
  otherDepartment: { accountId: '143', departmentId: OTHER, permissions: ['governance:read-department'] },
  noReadRight: { accountId: '144', departmentId: HOME, permissions: ['mapping:read'] }
};
let current = callers.global;
auth.setIdentityRepositoryFactory(() => ({
  async getUserEffectivePermissions() { return { permSet: new Set(current.permissions), fieldConstraints: {} }; },
  async validateSession() {
    return { valid: true, user: { personId: Number(current.accountId) + 1000, current_department_id: current.departmentId, person_name: '合成调用者' } };
  }
}));

function listen(app) {
  return new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
}
function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function main() {
  let target, server;
  const checks = [];
  const check = async (name, fn) => { await fn(); checks.push(name); console.log('PASS ' + name); };
  try {
    await withFreshMysql(async ctx => {
      const { pool, owner, database, containerId, port } = ctx;
      target = { owner, database, containerId, port, image: 'mysql:8.4', pull: 'never', tmpfs: true };
      save('owned-target.json', target);

      const wanted = new Set(TABLES.map(table => `CREATE TABLE IF NOT EXISTS ${table} `));
      const ddl = splitSqlStatements(mdmMysqlSchemaSql()).filter(statement => {
        const normalized = statement.replace(/\s+/g, ' ');
        return [...wanted].some(prefix => normalized.includes(prefix));
      });
      assert.equal(ddl.length, TABLES.length, 'every required table has exactly one statement');
      for (const statement of ddl) await pool.execute(statement);
      for (const id of [Number(HOME), Number(OTHER)]) {
        await pool.execute('INSERT INTO departments(id,code,name) VALUES (?,?,?)', [id, 'RS_' + id, '合成部门' + id]);
      }
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,context_type,title,dept_id,status) VALUES (701,'rs-same','process','合成上下文甲',?,'active')", [Number(HOME)]);
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,context_type,title,dept_id,status) VALUES (702,'rs-other','process','合成上下文乙',?,'active')", [Number(OTHER)]);
      await pool.execute("INSERT INTO data_map_contexts(id,context_key,context_type,title,dept_id,status) VALUES (CAST(? AS SIGNED),'rs-wide','process','合成上下文丙',?,'active')", [BIG, Number(HOME)]);
      await pool.execute('INSERT INTO data_map_fields(id,context_id,field_key) VALUES (801,701,\'rs_field_a\')');
      await pool.execute('INSERT INTO data_map_fields(id,context_id,field_key) VALUES (802,702,\'rs_field_b\')');
      await pool.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES ('mapping',701,'update',1)`);
      await pool.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES ('mapping',702,'update',1)`);
      await pool.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES ('field_entry',801,'update',1)`);
      await pool.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES ('field_entry',802,'update',1)`);
      await pool.execute(`INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by) VALUES ('mapping',CAST(? AS SIGNED),'update',1)`, [BIG]);
      await pool.execute(`INSERT INTO mdm_change_sets(entity_type,entity_id,operated_by,description) VALUES ('mapping',701,1,'合成变更集')`);

      const historyRows = async () => Number((await pool.query('SELECT COUNT(*) AS n FROM mdm_version_log'))[0][0].n);
      const baselineRows = await historyRows();
      assert.equal(baselineRows, 5);

      versionsRouter.setAuditRepositoryFactory(async () => makeAuditMysqlRepository(pool));
      const app = express();
      app.use(express.json());
      app.use((req, res, next) => {
        req.session = { personId: 42, userId: 42, accountId: current.accountId, authVersion: 1, userName: '合成调用者' };
        next();
      });
      app.use('/api/versions', versionsRouter);
      server = await listen(app);
      const base = `http://127.0.0.1:${server.address().port}`;
      const get = async url => {
        const res = await fetch(base + url);
        const text = await res.text();
        return { status: res.status, text, body: (() => { try { return JSON.parse(text); } catch { return null; } })() };
      };
      const as = caller => { current = callers[caller]; };

      await check('owning department is resolved from the live data-map object', async () => {
        as('sameDepartment');
        assert.equal((await get('/api/versions/mapping/701')).status, 200);
        assert.equal((await get('/api/versions/field/801')).status, 200);
        assert.equal((await get('/api/versions/entity/mapping/701')).status, 200);
      });

      await check('another department is refused and receives no history value', async () => {
        as('otherDepartment');
        for (const url of ['/api/versions/mapping/701', '/api/versions/field/801', '/api/versions/entity/mapping/701']) {
          const refused = await get(url);
          assert.equal(refused.status, 404, `${url}: ${refused.text}`);
          assert.ok(!/合成变更集|update|701|801/.test(refused.text), refused.text);
        }
      });

      await check('a caller with no governance read right is refused identically', async () => {
        as('noReadRight');
        assert.equal((await get('/api/versions/mapping/701')).status, 404);
        assert.equal((await get('/api/versions/field/801')).status, 404);
      });

      await check('a deleted object has no verifiable attribution and is refused, exactly like a missing one', async () => {
        await pool.execute('DELETE FROM data_map_fields WHERE id=802');
        as('otherDepartment');
        const deleted = await get('/api/versions/field/802');
        const missing = await get('/api/versions/field/803');
        assert.equal(deleted.status, 404, deleted.text);
        assert.equal(deleted.text, missing.text);
      });

      await check('global read reaches every scope while an unlisted type never returns rows', async () => {
        as('global');
        assert.equal((await get('/api/versions/mapping/702')).status, 200);
        assert.equal((await get('/api/versions/field/801')).status, 200);
        const unlisted = await get('/api/versions/entity/rs_unlisted_type/701');
        assert.equal(unlisted.status, 200, unlisted.text);
        assert.deepEqual(unlisted.body, { changeSets: [], logs: [] });
      });

      await check('an entity id beyond the safe-integer range is matched and returned exactly', async () => {
        as('global');
        const result = await get(`/api/versions/mapping/${BIG}`);
        assert.equal(result.status, 200, result.text);
        assert.equal(result.body.length, 1, 'the exact BIGINT row is found, not a rounded neighbour');
        assert.strictEqual(result.body[0].entity_id, BIG);
        assert.strictEqual(result.body[0].operated_by, 1);
        // The neighbouring value that a rounded Number would have collapsed to must not resolve
        // to the same history. A caller who may read everything is not refused for a missing
        // object, so the check is on the content: the exact row is not there.
        const neighbour = await get('/api/versions/mapping/9007199254741000');
        assert.ok(neighbour.status === 404 || (neighbour.status === 200 && neighbour.body.length === 0),
          `the rounded neighbour must not carry the exact row: ${neighbour.status} ${neighbour.text.slice(0, 120)}`);
        assert.notEqual(neighbour.text, result.text);
      });

      await check('no historical row was deleted or rewritten while closing the gap', async () => {
        assert.equal(await historyRows(), baselineRows);
        const [rows] = await pool.query("SELECT entity_type, CAST(entity_id AS CHAR) AS entity_id FROM mdm_version_log ORDER BY entity_type, entity_id");
        save('retained-history.json', rows);
        assert.equal(rows.length, baselineRows);
      });

      save('scope-results.json', { checks, baselineRows, database: owner });
    }, { stage: '02', randomDatabase: true });

    save('validation.json', {
      passed: true, checks, httpStarted: true, productWorkerStarted: false, realWorker: false,
      ownedIsolatedMysql: true, deploymentVerified: false, businessAcceptance: false
    });
    console.log('R01_VERSIONS_SCOPE_MYSQL_PASSED');
  } catch (error) {
    save('failure.json', { message: error.message, stack: error.stack, checks, target });
    throw error;
  } finally {
    if (server) await closeServer(server);
    versionsRouter.resetAuditRepositoryFactory();
    auth.resetIdentityRepositoryFactory();
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
