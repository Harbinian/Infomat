# Infomat MySQL Permanent Repair Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:systematic-debugging` before changing behavior, then use `superpowers:executing-plans` or `superpowers:subagent-driven-development` to implement this plan task by task. Track progress with the checkbox items below.

**Goal:** Make the Infomat local MySQL startup and MDM identity/RBAC path recoverable, verifiable, and stable under the fixed service contract.

**Current Finding:** The failure is not caused by a bad password or broken data file. It is a contract drift plus incomplete MySQL identity migration:

- The fixed service contract expects MySQL on `localhost:3307` and container `infomat-input-baseline-review-mysql`.
- The configured container does not exist in the local Docker runtime, while a historical MySQL container using the same host port exists but is stopped.
- Starting that historical container restores `3307`; the database, password, table count, and migration table are readable.
- After MySQL is reachable, the smoke test progresses past login but fails on `/api/org/users` with `403`.
- The live `person` table is an older shape and lacks `current_department_id`, so the person-identity migration silently falls back instead of completing.
- `ADMIN001` exists in old `users` / `user_roles` as `admin`, but has no matching `person` / `user_accounts` row. At the same numeric ID, `person_roles` contains project roles without `admin:access`, so permission checks read the wrong identity chain.

**Architecture:** Keep the fixed root startup contract. Repair the local Docker runtime to match the contract, then make MySQL schema initialization idempotently upgrade existing tables instead of only creating missing tables. Treat `person` as the business identity and `user_accounts` as credentials. Keep old `users` compatibility only as a controlled migration input, never as a parallel authority for live permission checks.

**Scope:**

- Modify: `scripts/start-infomat-services.ps1`
- Modify: `scripts/test-infomat-services-config.mjs`
- Modify: `scripts/smoke-infomat-services.mjs`
- Modify: `package.json`
- Modify: `scripts/README.md`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/scripts/init-mysql-schema.js`
- Modify: `apps/mdm-platform/package.json`
- Create: `scripts/repair-infomat-mysql-container.ps1`
- Create: `apps/mdm-platform/scripts/repair-person-identity-mysql.js`
- Create: `apps/mdm-platform/scripts/test-person-identity-live-schema-contract.js`
- Create: `apps/mdm-platform/scripts/test-admin-permission-mysql-contract.js`

**Out of Scope:**

- Do not modify `docs/norms/`, PMO generated pages, or process input baseline files.
- Do not move repository directories.
- Do not delete old SQLite or old `users` tables in this repair.
- Do not change governance business rules or responsibility assignments.

---

## Task 0: Preserve Evidence And Baseline

**Files:**
- No code changes.

- [x] Capture current Git state.

Run:

```powershell
git status --short
```

Expected: only intentional files are changed before implementation starts.

- [x] Capture Docker and MySQL evidence without printing secrets.

Run a read-only diagnostic that reports:

- whether `3307` is listening,
- whether `infomat-input-baseline-review-mysql` exists,
- whether exactly one historical MySQL container is bound to host port `3307`,
- MySQL version, database name, table count, and migration count.

Expected: diagnostic confirms the historical container can be the migration source, or fails with a clear manual decision point.

---

## Task 1: Repair The Docker Startup Contract

**Files:**
- Create: `scripts/repair-infomat-mysql-container.ps1`
- Modify: `scripts/start-infomat-services.ps1`
- Modify: `scripts/test-infomat-services-config.mjs`
- Modify: `package.json`
- Modify: `scripts/README.md`

- [x] Add a one-time container repair script.

Create `scripts/repair-infomat-mysql-container.ps1` that:

- reads `scripts/infomat-services.config.json`,
- reads required private values from `scripts/infomat-services.local.env`,
- refuses to print passwords,
- checks whether the configured container already exists,
- discovers a single stopped or running MySQL container whose host port binding matches the fixed MySQL port,
- confirms the source container can connect to the configured database,
- renames or recreates the container so the runtime name matches `infomat-input-baseline-review-mysql`,
- preserves the existing Docker volume and database files,
- fails without changing anything if more than one possible source exists.

Expected: after the script runs, `docker inspect infomat-input-baseline-review-mysql` succeeds and `localhost:3307` can be started by name.

- [x] Make the fixed starter produce an actionable recovery path.

Update `scripts/start-infomat-services.ps1` so that when `3307` is down and the configured container is missing, it reports:

```text
Run scripts\repair-infomat-mysql-container.ps1 to align the local Docker container with scripts\infomat-services.config.json.
```

Expected: the starter no longer fails with a raw Docker object error.

- [x] Add root script entry.

Add:

```json
"repair:infomat-mysql": "powershell -ExecutionPolicy Bypass -File scripts/repair-infomat-mysql-container.ps1"
```

Expected: the user can run the repair through the same root-level workflow style as start and smoke.

- [x] Extend configuration tests.

Update `scripts/test-infomat-services-config.mjs` to assert:

- the repair script exists,
- the starter references it in the missing-container diagnostic,
- the configured container name is still `infomat-input-baseline-review-mysql`,
- service startup still uses the fixed config and private env file.

Run:

```powershell
npm run test:infomat-services-config
```

Expected: exit 0.

---

## Task 2: Make Person Identity Schema Migration Explicit

**Files:**
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/scripts/init-mysql-schema.js`
- Modify: `apps/mdm-platform/package.json`
- Create: `apps/mdm-platform/scripts/test-person-identity-live-schema-contract.js`

- [x] Add required person schema upgrade logic.

Add an idempotent function such as `ensureMysqlPersonIdentityColumns(pool)` that verifies and adds:

- `person.current_department_id BIGINT NULL`,
- `person.updated_at TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP` when missing,
- `idx_person_department` when missing.

Expected: existing older `person` tables are upgraded; fresh databases still work from `mysqlSchema.js`.

- [x] Stop swallowing required identity migration failures.

Refactor `migrateLegacyIdentityToPersonIdentity(pool)` so the structural prerequisites for `person`, `user_accounts`, and `person_roles` are required. Compatibility fallback may remain for optional business tables, but core identity migration must fail loudly if it cannot write the target identity model.

Expected: a partially migrated identity schema cannot look healthy.

- [x] Record the schema repair in migrations.

Add a migration key for the person-identity schema contract in `init-mysql-schema.js` after the upgrade completes.

Expected: `schema_migrations` records that this database has passed the current identity schema gate.

- [x] Add a live schema contract test.

Create `apps/mdm-platform/scripts/test-person-identity-live-schema-contract.js` that:

- connects using the fixed env/config path,
- asserts `person.current_department_id` exists,
- asserts `user_accounts` exists and has a unique login,
- asserts `person_roles` exists,
- asserts `users` count is not greater than migrated `person` and `user_accounts` coverage after repair.

Add a package script:

```json
"test:person-identity-live-schema": "node scripts/test-person-identity-live-schema-contract.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-live-schema
```

Expected: exit 0 after repair, and a clear failure before repair.

---

## Task 3: Converge ADMIN001 And Legacy Users Into Person Identity

**Files:**
- Create: `apps/mdm-platform/scripts/repair-person-identity-mysql.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/package.json`
- Create: `apps/mdm-platform/scripts/test-admin-permission-mysql-contract.js`

- [x] Add an idempotent identity repair script.

Create `apps/mdm-platform/scripts/repair-person-identity-mysql.js` that:

- runs the person identity schema upgrade,
- inserts missing `person` rows from `users`,
- inserts missing `user_accounts` rows from `users`,
- copies `user_roles` into `person_roles` by employee number,
- adds the old base role from `users.role` into `person_roles`,
- verifies every old user has a matching person and account,
- verifies `ADMIN001` has `admin` in `person_roles`,
- verifies `ADMIN001` effective permissions include `admin:access` and `*:*`.

Expected: rerunning the script is safe and produces the same final counts.

- [x] Prevent numeric ID collision from producing false permissions.

Update `getDirectRoleIds` / permission resolution so it does not treat an old `users.id` as a `person.person_id` unless the session or lookup has resolved a real person identity. If the user is still on the old compatibility path, permission lookup must use `user_roles` and `users.role`, or the request must fail with a migration-required error.

Expected: a legacy user ID can no longer accidentally inherit unrelated `person_roles`.

- [x] Add an admin permission contract test.

Create `apps/mdm-platform/scripts/test-admin-permission-mysql-contract.js` that:

- connects to MySQL through the fixed config,
- initializes the repository,
- loads `ADMIN001`,
- asserts `personId` is present,
- asserts `getUserEffectivePermissions(personId)` includes `admin:access` and `*:*`,
- optionally calls `/api/org/users` against the running MDM service when `INFOMAT_MDM_URL` is set.

Add a package script:

```json
"test:admin-permission-mysql": "node scripts/test-admin-permission-mysql-contract.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:admin-permission-mysql
```

Expected: exit 0.

---

## Task 4: Add Startup Readiness Gates

**Files:**
- Modify: `scripts/start-infomat-services.ps1`
- Modify: `scripts/smoke-infomat-services.mjs`
- Modify: `scripts/test-infomat-services-config.mjs`
- Modify: `scripts/README.md`

- [x] Run MySQL identity readiness before starting MDM.

After MySQL is listening and before starting MDM, `scripts/start-infomat-services.ps1` should run:

```powershell
npm --prefix apps/mdm-platform run init:mysql
npm --prefix apps/mdm-platform run test:person-identity-live-schema
npm --prefix apps/mdm-platform run test:admin-permission-mysql
```

Expected: MDM does not start on a database that will fail login or admin permission checks.

- [x] Upgrade smoke test from login-only to permission-ready.

Update `scripts/smoke-infomat-services.mjs` to explicitly assert:

- login response has a person identity,
- `/api/org/me` permissions include `admin:access` and `*:*`,
- `/api/org/users` returns HTTP 200 and a non-empty array.

Expected: smoke test catches both MySQL connectivity failure and RBAC drift.

- [x] Document the repair and daily operation path.

Update `scripts/README.md`:

- normal path: `npm run start:infomat-services`, then `npm run smoke:infomat-services`,
- recovery path: `npm run repair:infomat-mysql`, then start and smoke,
- MySQL data is runtime state, not repository truth source.

Expected: a future agent or user does not need to rediscover the recovery sequence.

---

## Task 5: Verification

Run from repository root unless specified:

```powershell
npm run test:infomat-services-config
cd apps/mdm-platform
npm run test:mysql-config
npm run test:person-identity-live-schema
npm run test:admin-permission-mysql
cd ..\..
npm run repair:infomat-mysql
npm run start:infomat-services
npm run smoke:infomat-services
```

Expected:

- fixed MySQL container exists under the configured name,
- `localhost:3307` starts without manual Docker action,
- MDM and PMO start on fixed ports,
- admin login succeeds,
- `/api/org/me` shows admin permissions,
- `/api/org/users` returns 200,
- no private password appears in logs or terminal output.

If the user asks for browser-level verification after implementation, run a Playwright check that logs in as `ADMIN001`, verifies the role workbench first screen loads, and verifies the organization user management entry can fetch users without `403`.
