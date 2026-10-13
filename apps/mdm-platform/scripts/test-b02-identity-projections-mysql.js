// B02 read projections. --output requires a new repository artifacts directory;
// --baseline requires this run's before directory. Reuses freshMysql tmpfs/UUID
// resources and real read APIs with injected repository. Synthetic tables/rows
// only; no private config, formal DB, business writes, worker, AI or browser.
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const crypto = require('node:crypto'), Module = require('node:module'), cp = require('node:child_process');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { isolatedEnvironment } = require('./testHelpers/isolatedProcess');
const { makeIdentityMysqlRepository, readPersonAuthority, readPersonQualification } = require('../server/identityMysqlRepository');
const { identityInteger } = require('../server/sessionSubject');
const argument = name => process.argv[process.argv.indexOf(name) + 1];
const output = path.resolve(argument('--output') || ''), baseline = path.resolve(argument('--baseline') || '');
assert(process.argv.includes('--output') && output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
const beforeFile = path.join(baseline, 'apps__mdm-platform__server__identityMysqlRepository.js');
assert(process.argv.includes('--baseline') && fs.existsSync(beforeFile));
fs.mkdirSync(output, { recursive: true });
const save = (name, value) => fs.writeFileSync(path.join(output, name), JSON.stringify(value, null, 2) + '\n');
const originalFilename = path.resolve(__dirname, '../server/identityMysqlRepository.js');
const prior = new Module(originalFilename, module); prior.filename = originalFilename; prior.paths = Module._nodeModulePaths(path.dirname(originalFilename));
prior._compile(fs.readFileSync(beforeFile, 'utf8'), originalFilename);
const checks = [], comparisons = [], bindingShapes = [], httpStops = [];
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const D0 = '9007199254741000', D1 = '9007199254741001', P0 = '9007199254741200', P1 = '9007199254741201';
const A0 = '9007199254741300', A1 = '9007199254741301', V0 = '9007199254741400', V1 = '9007199254741401';
const X0 = '9007199254741500', X1 = '9007199254741501';
let target, server, cleanup;
async function check(name, action) { await action(); checks.push(name); console.log('PASS ' + name); }
function compare(name, actual, previous) {
  assert.deepEqual(actual, previous, name); comparisons.push({ name, equal: true, currentSha256: hash(actual), beforeSha256: hash(previous) });
}
function session(person) { return { personId: person.id, accountId: person.account, authVersion: person.version || 1 }; }

async function main() {
  const previousEnv = { MDM_IDENTITY_READ_MODEL: process.env.MDM_IDENTITY_READ_MODEL, MDM_SYSTEM_ADMIN_ENABLED: process.env.MDM_SYSTEM_ADMIN_ENABLED };
  process.env.MDM_IDENTITY_READ_MODEL = 'mysql'; process.env.MDM_SYSTEM_ADMIN_ENABLED = '1';
  let passed = false, failure;
  try {
    await withFreshMysql(async ({ pool, owner, database, containerId, port }) => {
      target = { owner, database, containerId, port }; save('owned-target.json', target);
      await makeIdentityMysqlRepository(pool).initSchema();
      const setup = await pool.getConnection(); try { await require('../server/systemAdminMigration').applySystemAdmin(setup); } finally { setup.release(); }
      // These extra columns and optional display tables are disposable contract
      // fixtures, not runtime DDL, migrations or a replacement identity schema.
      await pool.execute('ALTER TABLE departments ADD unknown_extra VARCHAR(80), ADD unknown_bigint BIGINT, ADD exact_id VARCHAR(80)');
      await pool.execute(`CREATE TABLE \`position\` (position_id BIGINT PRIMARY KEY,position_code VARCHAR(80),position_name VARCHAR(80),
        department_admin_level INT NULL,department_admin_title VARCHAR(80),responsibility_scope VARCHAR(80))`);
      await pool.execute('CREATE TABLE person_position_assignment (person_id BIGINT,position_id BIGINT,status VARCHAR(20))');
      for (const [id, parent, responsible] of [[91, null, 81], [92, 91, 85], [D0, null, P0], [D1, D0, P1]]) {
        await pool.execute(`INSERT INTO departments(id,code,name,parent_id,final_responsible_person_id,data_owner_person_id,
          manager_user_id,data_owner_user_id,created_by,updated_by,unknown_extra,unknown_bigint,exact_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,'kept',?,'physical-original')`,
        [String(id), 'D' + id, 'Dept' + id, parent == null ? null : String(parent), String(responsible), String(responsible),
          id === D0 ? A0 : id === D1 ? A1 : null, null, '0', String(responsible), X1]);
      }
      const people = [
        { id: 81, account: 181, dept: 91, roles: ['mdm_lead'] }, { id: 82, account: 182, dept: 91, roles: ['admin'] },
        { id: 83, account: 183, dept: 91, roles: ['admin', 'department_contact'] }, { id: 84, account: 184, dept: 91, roles: [] },
        { id: 85, account: 185, dept: 92, roles: ['department_contact'] }, { id: 86, dept: null, roles: [] },
        { id: 87, account: 187, dept: 91, roles: [], status: 'inactive' },
        { id: P0, account: A0, version: V0, dept: D0, roles: ['data_conflict_handler'] },
        { id: P1, account: A1, version: V1, dept: D1, roles: ['data_conflict_handler'] }
      ];
      async function addPerson(person) {
        await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id,status) VALUES (?,?,?,?,?)',
          [String(person.id), 'P' + person.id, 'Person' + person.id, person.dept == null ? null : String(person.dept), person.status || 'active']);
        if (person.account) await pool.execute(`INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password,auth_version)
          VALUES (?,?,?,'synthetic-unused',?,0,?)`, [String(person.account), String(person.id), 'P' + person.id, person.accountStatus || 'active', String(person.version || 1)]);
        for (const role of person.roles) await pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from)
          SELECT ?,role_id,?,?,'B02 synthetic',CURRENT_DATE FROM roles WHERE role_code=?`,
        [String(person.id), ['mdm_lead', 'admin'].includes(role) ? 'global' : 'department', ['mdm_lead', 'admin'].includes(role) ? null : String(person.dept), role]);
      }
      for (const person of people) await addPerson(person);
      for (const [personId, positionId] of [[81, 11], [P0, X0], [P1, X1]]) {
        await pool.execute("INSERT INTO `position`(position_id,position_code,position_name) VALUES (?,?,'Display only')", [String(positionId), 'X' + positionId]);
        await pool.execute("INSERT INTO person_position_assignment(person_id,position_id,status) VALUES (?,?,'active')", [String(personId), String(positionId)]);
      }
      await pool.execute("INSERT INTO system_admin_accounts(account_id,login_name,password_hash,account_status,must_change_password,auth_version,authorization_basis) VALUES (?,'admin','synthetic-unused','active',0,?,'B02 synthetic')", [A1, V1]);
      const connection = await pool.getConnection();
      try {
        const observed = { async execute(sql, params = []) {
          const kind = /FROM person_position_assignment/.test(sql) ? 'position' : /FROM departments WHERE id=/.test(sql) ? 'department-by-id' : null;
          if (kind) bindingShapes.push({ kind, params: params.map(value => ({ value: value === undefined ? '<undefined>' : value, type: typeof value })) });
          return connection.execute(sql, params);
        } };
        const repo = makeIdentityMysqlRepository(observed), before = prior.exports.makeIdentityMysqlRepository(connection);
        const readAll = async reader => ({ departments: await reader.listDepartments(), users: await reader.listUsers(), summaries: await reader.listUserRoleSummaries(),
          assignable: await reader.listAssignableUsers(), roleAssignable: await reader.listAssignableUsers({ roleCode: 'data_conflict_handler' }), payload: await reader.getCurrentUserPayload(session(people[0])) });
        const old = await readAll(before), next = await readAll(repo);
        await check('seven safe read contracts equal baseline including all original keys, null account and optional position types', async () => {
          for (const name of ['departments', 'users', 'summaries', 'assignable', 'roleAssignable']) {
            const small = rows => rows.filter(row => typeof row.id === 'number' && row.id < 1000);
            compare(name + '-safe', small(next[name]), small(old[name]));
          }
          const { positions: oldPositions, positionInfo: oldInfo, ...oldIdentity } = old.payload;
          const { positions: nextPositions, positionInfo: nextInfo, ...nextIdentity } = next.payload;
          compare('payload-safe-identity-and-permissions', nextIdentity, oldIdentity);
          assert.equal(nextPositions[0].positionId, 11); assert.equal(nextInfo.status, 'available');
          save('optional-position-baseline.json', { before: { positions: oldPositions, positionInfo: oldInfo },
            after: { positions: nextPositions, positionInfo: nextInfo },
            reason: 'Existing unquoted POSITION identifier causes MySQL parse fallback; read now quotes the same optional table, with unchanged local error handling and authority.' });
          compare('department-by-id-safe', await repo.getDepartmentById(91), await before.getDepartmentById(91));
          compare('department-by-name-safe', await repo.getDepartmentByName('Dept91'), await before.getDepartmentByName('Dept91'));
          const accountless = next.users.find(row => row.id === 86);
          assert.equal(accountless.accountId, null); assert.equal(accountless.authVersion, 0); assert.equal(accountless.auth_version, null); assert.equal(accountless.department_id, null);
        });
        await check('same-read full department fields and unknown columns retained; exact parent/owner/account IDs remain adjacent', async () => {
          const [physical] = await connection.execute('SELECT * FROM departments ORDER BY code');
          const identityFields = new Set(['id', 'parent_id', 'manager_user_id', 'data_owner_user_id', 'final_responsible_person_id', 'data_owner_person_id', 'created_by', 'updated_by']);
          for (let i = 0; i < physical.length; i++) {
            assert.deepEqual(Object.keys(next.departments[i]), Object.keys(physical[i]));
            for (const field of Object.keys(physical[i])) if (!identityFields.has(field)) assert.deepEqual(next.departments[i][field], physical[i][field]);
          }
          const d0 = next.departments.find(row => row.id === D0), d1 = next.departments.find(row => row.id === D1);
          assert(d0 && d1); assert.equal(d1.parent_id, D0); assert.equal(d0.final_responsible_person_id, P0); assert.equal(d1.final_responsible_person_id, P1);
          assert.equal(d0.manager_user_id, A0); assert.equal(d1.manager_user_id, A1);
          assert.equal(d1.data_owner_person_id, P1); assert.equal(d1.created_by, 0); assert.equal(d1.updated_by, P1);
          compare('physical-department-baseline-raw', physical, old.departments);
          save('department-comparison.json', { raw: physical, before: old.departments, after: next.departments, unknownFieldsUnchanged: true, rawSnapshotHash: hash(physical) });
        });
        await check('real prepared statement reuse stays decimal and never aliases adjacent BIGINT or unsafe input', async () => {
          for (const id of [91, D0, D1, 92, D1, D0, '91', D1]) assert.equal((await repo.getDepartmentById(id)).id, identityInteger(id));
          for (const id of [null, Number(D1), '91oops', {}, '9223372036854775808', -1, 0]) assert.equal(await repo.getDepartmentById(id), null);
          await assert.rejects(repo.getDepartmentById(undefined), /undefined/);
          assert.equal(await repo.getDepartmentByName('no-such-department'), null);
          assert.equal(await repo.getDepartmentByName(null), null);
          await assert.rejects(repo.getDepartmentByName(undefined), /undefined/);
          assert.equal((await repo.getDepartmentByName('Dept' + D0)).id, D0); assert.equal((await repo.getDepartmentByName('Dept' + D1)).id, D1);
        });
        await check('users, summaries and candidate pickers preserve exact adjacent people, accounts, auth generations and department links', async () => {
          for (const [id, account, version, dept] of [[P0, A0, V0, D0], [P1, A1, V1, D1]]) {
            const row = next.users.find(p => p.id === id); assert(row); assert.equal(row.person_id, id); assert.equal(row.personId, id);
            assert.equal(row.account_id, account); assert.equal(row.accountId, account); assert.equal(row.auth_version, version); assert.equal(row.authVersion, version);
            assert.equal(row.department_id, dept); assert.equal(row.current_department_id, dept);
            for (const name of ['summaries', 'assignable', 'roleAssignable']) { const item = next[name].find(p => p.id === id); assert(item); assert.equal(item.personId, id); assert.equal(item.department_id, dept); }
            const payload = await repo.getCurrentUserPayload({ personId: id }); assert.equal(payload.positions[0].positionId, id === P0 ? X0 : X1);
          }
          compare('role-summaries-preserve-ordinary-roles', next.summaries.filter(p => typeof p.id === 'number'), old.summaries.filter(p => p.id < 1000));
          save('read-comparisons.json', { comparisons, users: next.users, summaries: next.summaries, assignable: next.assignable, roleAssignable: next.roleAssignable });
        });
        await check('assignable unchanged account-free branch, filtered role boundaries and summary-only role interpretation', async () => {
          const variants = [
            { id: 201, account: 301, dept: 91, roles: ['data_conflict_handler'], accountStatus: 'disabled' },
            { id: 202, account: 302, dept: 91, roles: ['data_conflict_handler'] }, { id: 203, account: 303, dept: 91, roles: ['data_conflict_handler'] },
            { id: 204, account: 304, dept: 91, roles: ['data_conflict_handler'] }, { id: 205, account: 305, dept: 91, roles: ['data_conflict_handler'] },
            { id: 206, account: 306, dept: 91, roles: ['data_conflict_handler'] }, { id: 207, account: 307, dept: 91, roles: ['data_conflict_handler'], status: 'inactive' }
          ];
          for (const person of variants) await addPerson(person);
          await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=202");
          await pool.execute('UPDATE person_roles SET authorization_basis=NULL WHERE person_id=203');
          await pool.execute('UPDATE person_roles SET effective_from=DATE_ADD(CURRENT_DATE,INTERVAL 1 DAY) WHERE person_id=204');
          await pool.execute('UPDATE person_roles SET effective_to=DATE_SUB(CURRENT_DATE,INTERVAL 1 DAY) WHERE person_id=205');
          await pool.execute('UPDATE user_accounts SET must_change_password=1 WHERE person_id=206');
          const actual = await repo.listAssignableUsers({ roleCode: ' data_conflict_handler ' });
          assert.deepEqual(actual.map(row => String(row.id)).sort(), ['206', P0, P1].sort());
          const plain = await repo.listAssignableUsers(); assert(plain.some(row => row.id === 86)); assert(plain.some(row => row.id === 201)); assert(!plain.some(row => row.id === 207));
          const summaries = await repo.listUserRoleSummaries();
          for (const id of [201, 203, 204, 205, 206, 207]) assert(summaries.find(row => row.id === id).rbac_role_codes.includes('data_conflict_handler'));
          assert.equal(summaries.find(row => row.id === 202).rbac_role_codes, '');
          const compareMembership = async name => compare(name, await repo.listAssignableUsers({ roleCode: 'data_conflict_handler' }), await before.listAssignableUsers({ roleCode: 'data_conflict_handler' }));
          // Only safe rows survive these two variants, so complete rows compare.
          await pool.execute("UPDATE roles SET status='retired' WHERE role_code='data_conflict_handler'"); await compareMembership('retired-role');
          await pool.execute("UPDATE roles SET status='active',model_version='synthetic-other' WHERE role_code='data_conflict_handler'"); await compareMembership('wrong-model');
          await pool.execute('UPDATE roles SET model_version=? WHERE role_code=\'data_conflict_handler\'', [require('../server/roleDefinitions').ACCESS_MODEL_VERSION]);
          const after = await repo.listAssignableUsers({ roleCode: 'data_conflict_handler' }); assert(after.some(row => row.id === P1));
        });
        await check('optional unavailable is local under actual missing-table and table/column grants; core and connection failures propagate', async () => {
          const healthy = await repo.getCurrentUserPayload(session(people[0]));
          await pool.execute('RENAME TABLE `position` TO hidden_position');
          const missing = await repo.getCurrentUserPayload(session(people[0])); assert.equal(missing.positionInfo.status, 'unavailable'); assert.deepEqual(missing.positions, []);
          compare('missing-position-permissions', missing.permissions, healthy.permissions);
          await pool.execute('RENAME TABLE hidden_position TO `position`');
          const deniedReceipts = [];
          const grants = async (name, positionGrant) => {
            await pool.execute(`CREATE USER '${name}'@'%' IDENTIFIED BY 'synthetic-unused'`);
            for (const table of ['person', 'user_accounts', 'departments', 'person_roles', 'roles', 'role_permissions', 'permissions', 'person_position_assignment']) await pool.execute(`GRANT SELECT ON ${database}.${table} TO '${name}'@'%'`);
            if (positionGrant) await pool.execute(`GRANT SELECT (position_id,position_code,position_name) ON ${database}.\`position\` TO '${name}'@'%'`);
            const mysql = require('mysql2/promise');
            const limited = await mysql.createConnection({ host: '127.0.0.1', port, user: name, password: 'synthetic-unused', database });
            try {
              const denied = [];
              const limitedRepo = makeIdentityMysqlRepository({ async execute(sql, params) {
                try { return await limited.execute(sql, params); }
                catch (error) { if (/FROM person_position_assignment/.test(sql)) denied.push(error.code); throw error; }
              } }), payload = await limitedRepo.getCurrentUserPayload(session(people[0]));
              assert.deepEqual(denied, [positionGrant ? 'ER_COLUMNACCESS_DENIED_ERROR' : 'ER_TABLEACCESS_DENIED_ERROR']);
              deniedReceipts.push({ name, expectedCode: denied[0], actualCodes: denied, positionInfo: payload.positionInfo });
              assert.equal(payload.positionInfo.status, 'unavailable'); compare(name + '-permissions', payload.permissions, healthy.permissions);
              await pool.execute(`REVOKE SELECT ON ${database}.person_roles FROM '${name}'@'%'`);
              await assert.rejects(limitedRepo.getCurrentUserPayload(session(people[0])), { code: 'ER_TABLEACCESS_DENIED_ERROR' });
            } finally { await limited.end(); await pool.execute(`DROP USER '${name}'@'%'`); }
          };
          await grants('b02_table_scope', false); await grants('b02_column_scope', true);
          save('optional-denial-codes.json', deniedReceipts);
          const broken = makeIdentityMysqlRepository({ execute(sql, params) { if (/FROM person_position_assignment/.test(sql)) throw Object.assign(Error('lost'), { code: 'PROTOCOL_CONNECTION_LOST' }); return observed.execute(sql, params); } });
          await assert.rejects(broken.getCurrentUserPayload(session(people[0])), { code: 'PROTOCOL_CONNECTION_LOST' });
        });
        await check('shared person/admin/overlay/cross-department and candidate qualification retain original authority; display creates no grant', async () => {
          for (const person of people.filter(p => p.account && p.status !== 'inactive')) assert((await repo.validateSession(session(person))).valid);
          const { readPersonAuthority: authority } = require('../server/identityMysqlRepository');
          for (const person of [people[1], people[2]]) assert((await authority(observed, session(person), person.id)).readOnly);
          const none = await authority(observed, session(people[3]), 84); assert.equal(none.permissions.size, 0);
          const outsider = await repo.getCurrentUserPayload(session(people[4])); assert(outsider.dataScopes.includes('department:92')); assert(!outsider.dataScopes.includes('department:91'));
          const system = { identityKind: 'system_admin', accountId: A1, authVersion: V1 };
          const valid = await repo.validateSession(system); assert(valid.valid); assert.equal(valid.user.personId, null);
          const independent = await repo.getCurrentUserPayload(system); assert.equal(independent.personId, null);
          assert.equal((await readPersonAuthority(observed, system, P1)).valid, false);
          const beforePayload = await before.getCurrentUserPayload(system); compare('independent-admin-null-person', independent, beforePayload);
          assert.equal((await repo.validateSession({ ...session(people[8]), accountId: A0 })).valid, false);
          assert.equal((await repo.validateSession({ ...session(people[8]), authVersion: V0 })).valid, false);
          assert((await readPersonQualification(observed, P1)).valid);
          assert.equal((await readPersonQualification(observed, 86)).valid, false);
          assert.equal((await readPersonQualification(observed, 206)).valid, false); // picker remains display-only
          compare('no-role-display-vs-authority', (await repo.getCurrentUserPayload(session(people[3]))).permissions, []);
        });
        await check('original org read APIs and auth department adapters retain permissions and exact JSON association', async () => {
          const express = require('express'), auth = require('../server/auth'), org = require('../server/routes/org');
          auth.setIdentityRepositoryFactory(() => repo); org.setIdentityRepositoryFactory(() => repo);
          const app = express();
          app.use((req, res, next) => { const id = req.headers['x-b02-person'];
            if (id === 'system') req.session = { identityKind: 'system_admin', accountId: A1, authVersion: V1 };
            else { const person = people.find(p => String(p.id) === id); req.session = person ? session(person) : {}; }
            req.session.destroy = done => done(); next(); });
          app.use('/api/org', org);
          server = await new Promise(resolve => { const owned = app.listen(0, '127.0.0.1', () => resolve(owned)); });
          const httpPort = server.address().port, base = 'http://127.0.0.1:' + httpPort + '/api/org';
          save('owned-http.json', { owner, port: httpPort, address: '127.0.0.1', injectedOwnedRepository: true });
          const get = async (url, actor = 81) => { const response = await fetch(base + url, { headers: { 'x-b02-person': String(actor) } }); return { status: response.status, body: await response.json() }; };
          const api = {};
          for (const [url, expected, actor] of [['/departments', 'listDepartments', 81], ['/users', 'listUsers', 82], ['/users/roles-summary', 'listUserRoleSummaries', 82], ['/persons/assignable', 'listAssignableUsers', 81]]) {
            const response = await get(url, actor); save('api-attempt.json', {url, actor,response}); assert.equal(response.status, 200, url); compare('api-' + url, response.body, JSON.parse(JSON.stringify(await repo[expected]()))); api[url] = response;
          }
          const filtered = await get('/users/assignable'); assert.equal(filtered.status, 200, '/users/assignable'); compare('api-filtered', filtered.body, await repo.listAssignableUsers({ roleCode: 'data_conflict_handler' }));
          assert.equal((await get('/users', 84)).status, 403); assert.equal((await get('/persons/assignable', 84)).status, 403); assert.equal((await get('/departments', 'unknown')).status, 401);
          assert.equal((await get('/users', 'system')).status, 200, 'system/users');
          const me = await get('/me', P1); assert.equal(me.status, 200); assert.equal(me.body.personId, P1); assert.equal(me.body.accountId, A1); assert.equal(me.body.authVersion, V1); assert.equal(me.body.positions[0].positionId, X1);
          assert.equal((await auth.getDepartmentByIdAsync(D1)).id, D1); assert.equal((await auth.getDepartmentByNameAsync('Dept' + D0)).id, D0);
          save('api-comparison.json', { api, filtered, me, authorizationStatusUnchanged: true });
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); server = null;
          httpStops.push({ owner, port: httpPort, stopped: true }); console.log('B02_OWNED_HTTP_STOPPED');
          auth.resetIdentityRepositoryFactory(); org.resetIdentityRepositoryFactory();
        });
        for (const bind of bindingShapes) for (const parameter of bind.params) if (parameter.value !== null && parameter.value !== '<undefined>') assert.equal(parameter.type, 'string');
        save('binding-shapes.json', bindingShapes);
        save('comparisons.json', comparisons);
      } finally { connection.release(); }
    }, { stage: '02', randomDatabase: true });
    passed = true;
  } catch (error) { failure = { code: error.code, message: error.message, stack: error.stack }; throw error;
  } finally {
    if (server) { const port = server.address().port; await new Promise(resolve => server.close(resolve)); httpStops.push({ owner: target?.owner, port, stopped: true }); }
    if (target) {
      const remaining = cp.execFileSync('docker', ['ps', '-aq', '--filter', 'label=infomat.stage02=' + target.owner], { env: isolatedEnvironment(), encoding: 'utf8', windowsHide: true }).trim();
      assert.equal(remaining, ''); cleanup = { owner: target.owner, containerId: target.containerId, remaining: 0, cleaned: true, httpStops };
      save('resource-cleanup.json', cleanup);
    }
    for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    save('results.json', { passed, checks, failure, target, cleanup, comparisons, formalDatabaseAccess: false, workerStarted: false, businessAccepted: false });
  }
}
main().catch(error => { console.error(error.code || error.message); process.exitCode = 1; });
