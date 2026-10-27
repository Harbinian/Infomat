// Owned disposable MySQL only. No private configuration, formal target or HTTP
// service is opened. --output must name a new folder below repository artifacts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { withFreshMysql } = require('./testHelpers/freshMysql');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { ensureMysqlBuiltInRolesAndPermissions, makeIdentityMysqlRepository, readPersonAuthority, assignmentAuthority } = require('../server/identityMysqlRepository');
const { makeGovernanceAccessMysqlRepository, validateRoleAssignmentInput } = require('../server/governanceAccessMysqlRepository');
const { ACCESS_MODEL_VERSION } = require('../server/roleDefinitions');
const authoring = require('../server/processV7Authoring');

const outputIndex = process.argv.indexOf('--output');
assert(outputIndex !== -1 && process.argv[outputIndex + 1], '--output is required');
const output = path.resolve(process.argv[outputIndex + 1]);
assert(output.startsWith(path.resolve(__dirname, '../../../artifacts') + path.sep) && !fs.existsSync(output));
fs.mkdirSync(output, { recursive: true });
const checks = [];
const check = async (name, work) => { await work(); checks.push(name); console.log('PASS ' + name); };
const save = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const roleInput = (roleCode = 'department_contact', extra = {}) => ({ roleCode, scopeDepartmentId: 91, effectiveFrom: '2000-01-01', ...extra });
const emptyValues = [undefined, null, '', ' \t '];
let target;

async function main() {
  await check('missing, null and blank authorization basis accepted while role, date, scope and period stay required', async () => {
    for (const value of emptyValues) {
      const input = roleInput();
      if (value !== undefined) input.authorizationBasis = value;
      assert.equal(String(validateRoleAssignmentInput(input, 91, true).authorizationBasis ?? '').trim(), '');
    }
    assert.equal(validateRoleAssignmentInput(roleInput('department_contact', { authorizationBasis: ' existing text ' }), 91, true).authorizationBasis, 'existing text');
    for (const effectiveFrom of [undefined, null, '']) assert.throws(() => validateRoleAssignmentInput(roleInput('department_contact', { effectiveFrom }), 91, true), { code: 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED' });
    assert.throws(() => validateRoleAssignmentInput(roleInput('department_contact', { effectiveFrom: 'invalid' }), 91, true), { code: 'INVALID_EFFECTIVE_DATE' });
    assert.throws(() => validateRoleAssignmentInput(roleInput('department_contact', { effectiveTo: '1999-12-31' }), 91, true), { code: 'INVALID_EFFECTIVE_PERIOD' });
    assert.throws(() => validateRoleAssignmentInput(roleInput('department_contact', { scopeDepartmentId: 92 }), 91, true), { code: 'ROLE_SCOPE_DEPARTMENT_MISMATCH' });
    assert.throws(() => validateRoleAssignmentInput(roleInput('invented'), 91, true), { code: 'INVALID_MDM_ROLE' });
  });

  await withFreshMysql(async ({ pool, owner, database, containerId, port }) => {
    target = { owner, database, containerId, mysqlPort: port, disposable: true };
    save('owned-target.json', target);
    for (const sql of splitSqlStatements(mdmMysqlSchemaSql())) await pool.execute(sql);
    await ensureMysqlBuiltInRolesAndPermissions(pool);
    await pool.execute("INSERT INTO departments(id,name,code) VALUES(91,'Synthetic A','SYN_A'),(92,'Synthetic B','SYN_B')");
    const repo = makeGovernanceAccessMysqlRepository(pool), identity = makeIdentityMysqlRepository(pool);
    const password = crypto.randomBytes(24).toString('hex'), passwordHash = bcrypt.hashSync(password, 4);
    const scalar = async (sql, params = []) => (await pool.execute(sql, params))[0][0];
    const addPerson = async (id, status = 'active') => {
      await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,91)', [id, 'SYN_' + id, 'Synthetic ' + id]);
      await pool.execute('INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,?,?)', [id + 1000, id, 'SYN_' + id, passwordHash, status]);
    };
    const session = async id => {
      const row = await scalar('SELECT account_id,auth_version FROM user_accounts WHERE person_id=?', [id]);
      return { personId: id, accountId: row.account_id, authVersion: row.auth_version };
    };
    const rawGrant = async (id, role, basis = null) => pool.execute(`INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from)
      SELECT ?,role_id,?,?,?,'2000-01-01' FROM roles WHERE role_code=?`, [id, role.startsWith('department_') ? 'department' : 'global', role.startsWith('department_') ? 91 : null, basis, role]);

    await check('new grants and account creation accept omitted/null/empty/whitespace basis with no invented evidence', async () => {
      for (const [index, value] of emptyValues.entries()) {
        const id = 101 + index;
        await addPerson(id, 'pending_activation');
        const input = roleInput();
        if (value !== undefined) input.authorizationBasis = value;
        const grant = await repo.grantRole(id, input);
        assert.equal(String(grant.authorizationBasis ?? '').trim(), '');
        const row = await scalar('SELECT authorization_basis FROM person_roles WHERE person_id=?', [id]);
        assert.equal(String(row.authorization_basis ?? '').trim(), '');
      }
      await pool.execute("INSERT INTO person(employee_no,person_name,current_department_id) VALUES('SYN_CREATED','Synthetic created',91)");
      const account = await repo.createAccount({ employeeNo: 'SYN_CREATED', loginName: 'SYN_CREATED', name: 'Synthetic created', departmentId: 91, pendingPasswordHash: passwordHash, roleAssignments: [roleInput()] });
      assert.equal(account.account_status, 'pending_activation');
      assert.equal(String(account.roleAssignments[0].authorizationBasis ?? '').trim(), '');
    });

    await check('historical null/blank grants activate and enable accounts; identity, permissions and assignable people agree', async () => {
      for (const [index, basis] of [null, '', ' \t '].entries()) {
        const id = 201 + index;
        await addPerson(id, 'pending_activation'); await rawGrant(id, 'department_contact', basis);
        assert.equal((await repo.activateAccount(id, { passwordHash })).account_status, 'active');
        assert.equal((await scalar('SELECT authorization_basis FROM person_roles WHERE person_id=?', [id])).authorization_basis, basis);
        const user = await identity.getUserByEmployeeNo('SYN_' + id);
        assert(bcrypt.compareSync(password, user.password_hash));
        assert.equal((await identity.validateSession(await session(id))).valid, true);
        assert((await identity.getUserRoleCodes(id)).some(r => r.code === 'department_contact'));
        assert((await identity.getUserEffectivePermissions(id)).permSet.has('governance:draft-department'));
        assert((await identity.listAssignableUsers({ roleCode: 'department_contact' })).some(p => String(p.personId) === String(id)));
        await pool.execute("UPDATE user_accounts SET account_status='disabled' WHERE person_id=?", [id]);
        assert.equal((await repo.enableAccount(id)).account_status, 'active');
      }
    });

    await check('missing/future/expired dates, revoked assignment and inactive/wrong-model roles still deny activation and permissions', async () => {
      await addPerson(301, 'pending_activation'); await rawGrant(301, 'department_contact');
      const invalid = [
        "pr.effective_from=NULL", "pr.effective_from=DATE_ADD(CURRENT_DATE,INTERVAL 1 DAY)",
        "pr.effective_to=DATE_SUB(CURRENT_DATE,INTERVAL 1 DAY)", "pr.assignment_status='revoked'",
        "pr.assignment_status='expired'", "r.status='retired'", "r.model_version='historical'"
      ];
      for (const condition of invalid) {
        const connection = await pool.getConnection();
        try {
          await connection.beginTransaction();
          await connection.execute('UPDATE person_roles pr JOIN roles r ON r.role_id=pr.role_id SET ' + condition + ' WHERE pr.person_id=301');
          const localIdentity = makeIdentityMysqlRepository(connection);
          assert.deepEqual(await localIdentity.getUserRoleCodes(301), []);
          assert.equal((await localIdentity.getUserEffectivePermissions(301)).permSet.size, 0);
          // The repository retains its own transaction contract on this one
          // owned connection; its rollback restores the synthetic mutation.
          const localRepo = makeGovernanceAccessMysqlRepository({ getConnection: async () => ({ execute: connection.execute.bind(connection), beginTransaction: async () => {}, commit: async () => {}, rollback: connection.rollback.bind(connection), release() {} }) });
          await assert.rejects(localRepo.activateAccount(301, { passwordHash }), { code: 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED' });
        } finally { await connection.rollback(); connection.release(); }
      }
      await pool.execute('UPDATE person_roles SET effective_from=CURRENT_DATE,effective_to=CURRENT_DATE WHERE person_id=301');
      assert.equal((await repo.activateAccount(301, { passwordHash })).account_status, 'active');
      await addPerson(302, 'pending_activation');
      await assert.rejects(repo.activateAccount(302, { passwordHash }), { code: 'ROLE_ASSIGNMENT_EVIDENCE_REQUIRED' });
    });

    await check('inactive person and department remain activation blockers; account APIs reject directory changes', async () => {
      await addPerson(303, 'pending_activation'); await rawGrant(303, 'department_contact');
      await pool.execute("UPDATE person SET status='inactive' WHERE person_id=303");
      await assert.rejects(repo.activateAccount(303, { passwordHash }), { code: 'PERSON_INACTIVE' });
      await pool.execute("UPDATE person SET status='active',current_department_id=92 WHERE person_id=303");
      await pool.execute("UPDATE departments SET status='inactive' WHERE id=92");
      await assert.rejects(repo.activateAccount(303, { passwordHash }), { code: 'ACTIVE_DEPARTMENT_REQUIRED' });
      await pool.execute("UPDATE departments SET status='active' WHERE id=92");
      await assert.rejects(repo.updateAccount(303, { departmentId: 91, roleAssignments: [roleInput()] }), { statusCode: 409, code: 'PERSON_DIRECTORY_MAINTENANCE_REQUIRED' });
      assert.equal((await scalar('SELECT current_department_id FROM person WHERE person_id=303')).current_department_id, 92);
    });

    await check('null-basis administrator is recognized as read-only and protected as the last active administrator', async () => {
      await addPerson(401); await rawGrant(401, 'admin'); await rawGrant(401, 'department_contact');
      const actor = await session(401);
      const authority = await readPersonAuthority(pool, actor, 401);
      assert.equal(authority.readOnly, true);
      assert(authority.permissions.has('identity:manage-account'));
      const active = await authoring.activeActor(pool, actor, false);
      assert.equal(active.admin, true);
      assert.equal(authoring.isContact(active, { owning_department_id: 91 }), false);
      assert.equal(authoring.isCompiler(active, { owning_department_id: 91 }, { compiler_person_id: 401 }), false);
      const grant = (await repo.getAccount(401)).roleAssignments.find(r => r.roleCode === 'admin');
      await assert.rejects(repo.disableAccount(401, { reason: 'Synthetic last administrator check' }), { code: 'LAST_ACTIVE_ADMIN' });
      await assert.rejects(repo.revokeRole(401, grant.assignmentId, { reason: 'Synthetic last administrator check' }), { code: 'LAST_ACTIVE_ADMIN' });
      await addPerson(402); await rawGrant(402, 'admin');
      assert.equal((await repo.disableAccount(401, { reason: 'Synthetic second administrator check' })).account_status, 'disabled');
    });

    await check('a null-basis remaining role prevents false last-role rejection; the actual last role stays protected', async () => {
      await addPerson(403); await rawGrant(403, 'mdm_lead'); await rawGrant(403, 'data_quality_auditor');
      const grants = (await repo.getAccount(403)).roleAssignments;
      await repo.revokeRole(403, grants.find(r => r.roleCode === 'mdm_lead').assignmentId, { reason: 'Synthetic remaining role check' });
      await assert.rejects(repo.revokeRole(403, grants.find(r => r.roleCode === 'data_quality_auditor').assignmentId, { reason: 'Synthetic last role check' }), { code: 'LAST_ACTIVE_ROLE_REQUIRES_DISABLE' });
    });

    await check('person maintenance authority accepts a null-basis administrator without skipping permission checks', async () => {
      const actor = await session(402), context = { kind: 'person', ...actor, method: 'POST', body: { roleCode: true, effectiveFrom: true } };
      await repo.forPersonMaintenance(context).grantRole(403, { roleCode: 'mdm_lead', effectiveFrom: '2000-01-01', actorPersonId: 402 });
      const unprivileged = await session(203);
      await pool.execute('UPDATE user_accounts SET must_change_password=0 WHERE person_id=203');
      await assert.rejects(repo.forPersonMaintenance({ kind: 'person', ...unprivileged, method: 'POST', body: {} }).grantRole(403, { roleCode: 'mdm_lead', effectiveFrom: '2000-01-01', actorPersonId: 203 }), e => e.statusCode === 403);
    });

    await check('formal workflow and department-reviewer SQL consume blank-basis assignments; admin overlay remains read-only', async () => {
      const formalSource = fs.readFileSync(path.join(__dirname, '../server/processDesignMysqlRepository.js'), 'utf8');
      const formalSql = formalSource.match(/const assignments = await mysqlQuery\(pool, `([\s\S]*?)`, \[personId, ACCESS_MODEL_VERSION\]\)/)?.[1];
      assert(formalSql, 'formal assignment SQL located');
      const [adminRows] = await pool.execute(formalSql, [402, ACCESS_MODEL_VERSION]);
      assert.equal(assignmentAuthority(adminRows).readOnly, true);
      const [contactRows] = await pool.execute(formalSql, [203, ACCESS_MODEL_VERSION]);
      assert.equal(assignmentAuthority(contactRows).effects.get('governance:draft-department'), 'allow');
      const authoringSource = fs.readFileSync(path.join(__dirname, '../server/processV7Authoring.js'), 'utf8');
      const candidatesSql = authoringSource.match(/const \[items\] = await db.execute\(`([\s\S]*?)`, \[caseRow.owning_department_id\]\)/)?.[1];
      const transferSql = authoringSource.match(/const \[admins\] = await db.execute\(`([\s\S]*?)`, \[id\]\)/)?.[1];
      assert(candidatesSql && transferSql, 'authoring recipient SQL located');
      const [candidates] = await pool.execute(candidatesSql, [91]);
      assert(candidates.some(p => Number(p.person_id) === 203));
      assert(!candidates.some(p => Number(p.person_id) === 402));
      assert.equal((await pool.execute(transferSql, [402]))[0].length, 1);
      const contactActor = await authoring.activeActor(pool, await session(203), false);
      assert.equal(authoring.isContact(contactActor, { owning_department_id: 91 }), true);
      assert.equal(authoring.isContact(contactActor, { owning_department_id: 92 }), false);
      await addPerson(404); await rawGrant(404, 'department_mdm_reviewer');
      const governanceSource = fs.readFileSync(path.join(__dirname, '../server/governanceAccessMysqlRepository.js'), 'utf8');
      const reviewerSql = governanceSource.match(/const reviewerRole = await first\(executor, `([\s\S]*?)`, \[recorderPersonId, ACCESS_MODEL_VERSION, departmentId\]\)/)?.[1];
      assert(reviewerSql, 'department reviewer SQL located');
      assert.equal((await pool.execute(reviewerSql, [404, ACCESS_MODEL_VERSION, 91]))[0].length, 1);
      assert.equal((await pool.execute(reviewerSql, [404, ACCESS_MODEL_VERSION, 92]))[0].length, 0);
    });

    await check('historical nonblank authorization text remains byte-for-byte intact through reads and activation', async () => {
      await addPerson(501, 'pending_activation');
      const historical = '  Historical authorization — retained exactly\nSecond line  ';
      await rawGrant(501, 'department_contact', historical);
      await identity.getUserRoleCodes(501); await identity.getUserEffectivePermissions(501); await repo.activateAccount(501, { passwordHash });
      assert.equal((await scalar('SELECT authorization_basis FROM person_roles WHERE person_id=501')).authorization_basis, historical);
    });

    await check('repeated grants preserve existing evidence for omitted/null/empty/whitespace input and accept explicit replacement text', async () => {
      const prior = await scalar('SELECT person_role_id,authorization_basis FROM person_roles WHERE person_id=501');
      for (const value of emptyValues) {
        const input = roleInput();
        if (value !== undefined) input.authorizationBasis = value;
        const granted = await repo.grantRole(501, input);
        assert.equal(granted.authorizationBasis, prior.authorization_basis);
        const row = await scalar('SELECT person_role_id,authorization_basis FROM person_roles WHERE person_id=501');
        assert.equal(String(row.person_role_id), String(prior.person_role_id));
        assert.equal(row.authorization_basis, prior.authorization_basis);
      }
      const replacement = '  Explicit replacement authorization\nSecond replacement line  ';
      const granted = await repo.grantRole(501, roleInput('department_contact', { authorizationBasis: replacement }));
      assert.equal(granted.authorizationBasis, replacement.trim());
      const row = await scalar('SELECT person_role_id,authorization_basis FROM person_roles WHERE person_id=501');
      assert.equal(String(row.person_role_id), String(prior.person_role_id));
      assert.equal(row.authorization_basis, replacement.trim());
      assert.equal(Number((await scalar('SELECT COUNT(*) AS count FROM person_roles WHERE person_id=501')).count), 1);
    });
  }, { stage: '04', randomDatabase: true });
  save('verification.json', { passed: true, checks, ownedMysqlRemoved: true, target, limitations: ['No formal database or real account was read or changed.', 'Repository/login-identity reads only; no HTTP password login or browser flow in this script.', 'Formal workflow and department-reviewer checks execute their current SQL; full publication/decision operations are outside this narrow regression.'] });
  console.log('OPTIONAL_ROLE_BASIS_PASS ' + checks.length);
}
main().catch(error => { save('verification.json', { passed: false, checks, target, error: { code: error.code || null, message: error.message } }); console.error(error.stack); process.exitCode = 1; });
