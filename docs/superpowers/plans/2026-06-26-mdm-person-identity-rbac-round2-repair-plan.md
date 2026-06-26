# MDM Person Identity RBAC Round 2 Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repair the remaining person identity, RBAC, guidance delegation, executor workflow, and legacy SQLite/user compatibility gaps found after Round 1.

**Architecture:** Keep MySQL `person` as the business identity and `user_accounts` as login-only credentials. Move remaining target writes from old `users` / `*_user_id` semantics to `*_person_id`, then complete the guidance workspace and produce deletion evidence before removing any SQLite or legacy compatibility path.

**Tech Stack:** Node.js, Express, MySQL via `mysql2`, single-file frontend in `apps/mdm-platform/public/index.html`, script tests under `apps/mdm-platform/scripts/`.

---

## Repair Principles

- Execute from a fresh isolated worktree; do not implement in the dirty main checkout.
- Scope is `apps/mdm-platform/` plus this plan folder.
- Do not modify `docs/norms/`, `pmo/`, `docs/company-sankey-data.json`, PMO generated assets, or process truth-source Markdown.
- Do not make AI decide standards, A1 splitting, L1/L2 classification, or publish outcomes.
- Do not delete SQLite or legacy `users` / `user_roles` compatibility until the MySQL rehearsal proves parity and the user approves the deletion decision.
- Every repair stage must leave a passing focused test command and a scoped commit.

## Priority Order

1. P0: Guard against new legacy identity writes.
2. P0: Move current MySQL business writes to person fields.
3. P1: Complete guidance list/detail/events, delegation UI, and executor assignment.
4. P1: Rehearse migration from old users/user_roles/user fields to person fields.
5. P2: Produce SQLite and legacy deletion decision package.

## Files

- Modify: `apps/mdm-platform/package.json`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/server/processGovernanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/dataMapMysqlRepository.js`
- Modify: `apps/mdm-platform/server/mappingMysqlRepository.js`
- Modify: `apps/mdm-platform/server/conflictMysqlRepository.js`
- Modify: `apps/mdm-platform/server/todoMysqlRepository.js`
- Modify: `apps/mdm-platform/server/terminologyMysqlRepository.js`
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Modify: `apps/mdm-platform/public/index.html`
- Create: `apps/mdm-platform/scripts/test-legacy-identity-inventory.js`
- Create: `apps/mdm-platform/scripts/test-person-business-writes-mysql.js`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-frontend.js`
- Create: `apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js`
- Create: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md`

---

### Task 0: Isolate The Repair Branch

**Files:**
- No code changes.

- [ ] **Step 1: Create the repair worktree**

Run from `E:\CA001\Infomat`:

```powershell
git worktree add C:\Users\charl\.config\superpowers\worktrees\Infomat\codex-mdm-person-rbac-round2-repair -b codex/mdm-person-rbac-round2-repair master
```

Expected: a new worktree exists at `C:\Users\charl\.config\superpowers\worktrees\Infomat\codex-mdm-person-rbac-round2-repair`.

- [ ] **Step 2: Enter the worktree and verify it is clean**

Run:

```powershell
cd C:\Users\charl\.config\superpowers\worktrees\Infomat\codex-mdm-person-rbac-round2-repair
git status --short --branch
```

Expected: branch is `codex/mdm-person-rbac-round2-repair` and there are no local changes.

- [ ] **Step 3: Re-run current baseline**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-rbac-completion
npm run test:mainline
```

Expected: both commands exit 0 before any repair edit.

---

### Task 1: Add Legacy Identity Write Guard

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Create: `apps/mdm-platform/scripts/test-legacy-identity-inventory.js`

- [ ] **Step 1: Add the guard script**

Create `apps/mdm-platform/scripts/test-legacy-identity-inventory.js` with these checks:

- scan `apps/mdm-platform/server/*.js`,
- classify old identity tokens as compatibility, migration, SQLite legacy, or test fixture,
- fail on MySQL repository target writes that use old user fields without a paired person field,
- print each failing file and token so the next repair step has a precise checklist.

The failing tokens are:

```text
users
user_roles
owner_user_id
actor_user_id
assignee_user_id
operator_user_id
steward_user_id
submitted_by
reviewed_by
created_by
updated_by
assigned_by
operated_by
```

The paired target tokens are:

```text
owner_person_id
actor_person_id
assignee_person_id
operator_person_id
steward_person_id
submitted_by_person_id
reviewed_by_person_id
created_by_person_id
updated_by_person_id
assigned_by_person_id
operated_by_person_id
```

- [ ] **Step 2: Wire the command**

In `apps/mdm-platform/package.json`, add:

```json
"test:legacy-identity-inventory": "node scripts/test-legacy-identity-inventory.js"
```

- [ ] **Step 3: Verify the guard fails before migration**

Run:

```powershell
cd apps/mdm-platform
npm run test:legacy-identity-inventory
```

Expected: fails and lists remaining target writes in process governance, data map, mapping, conflict, todo, and terminology repositories.

- [ ] **Step 4: Commit the guard**

Run from repo root:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/scripts/test-legacy-identity-inventory.js
git commit -m "test(mdm): guard legacy identity target writes"
```

Expected: one commit containing only the guard script and package script.

---

### Task 2: Move Business Writes To Person Fields

**Files:**
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Modify: `apps/mdm-platform/server/processGovernanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
- Modify: `apps/mdm-platform/server/dataMapMysqlRepository.js`
- Modify: `apps/mdm-platform/server/mappingMysqlRepository.js`
- Modify: `apps/mdm-platform/server/conflictMysqlRepository.js`
- Modify: `apps/mdm-platform/server/todoMysqlRepository.js`
- Modify: `apps/mdm-platform/server/terminologyMysqlRepository.js`
- Create: `apps/mdm-platform/scripts/test-person-business-writes-mysql.js`

- [ ] **Step 1: Add person-write contract coverage**

Create `apps/mdm-platform/scripts/test-person-business-writes-mysql.js` so it verifies these write paths use person fields:

- process governance quality cases and events,
- process mapping todos and events,
- issue pool participants, events, and term tasks,
- data map objects, contexts, fields, field identities, quality issues, and change logs,
- mapping records, approval tasks, approval history, and rejection reasons,
- conflict assignments and coordination history,
- todos and todo events,
- terminology terms and term tasks.

- [ ] **Step 2: Wire the command**

In `apps/mdm-platform/package.json`, add:

```json
"test:person-business-writes": "node scripts/test-person-business-writes-mysql.js"
```

- [ ] **Step 3: Run the test before migration**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-business-writes
```

Expected: fails on repositories that still write old user fields.

- [ ] **Step 4: Migrate repository writes**

For every touched write operation:

- prefer `actor_person_id`, `owner_person_id`, `assignee_person_id`, `submitted_by_person_id`, and equivalent camelCase person payloads,
- when only a legacy user id is available, resolve or mirror it into the paired person field through the existing migration bridge,
- keep old user fields as compatibility output aliases only when the route or UI still expects them,
- add missing person-field indexes in `mysqlSchema.js`.

- [ ] **Step 5: Verify the write repair**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-business-writes
npm run test:legacy-identity-inventory
npm run test:process-governance
npm run test:data-map-mysql
npm run test:mappings-mysql
npm run test:conflicts-mysql
npm run test:todos-mysql
npm run test:terminology-mysql
npm run test:activity-mysql
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit business write repair**

Run from repo root:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/mysqlSchema.js apps/mdm-platform/server/processGovernanceMysqlRepository.js apps/mdm-platform/server/processGovernanceIssuePoolRepository.js apps/mdm-platform/server/dataMapMysqlRepository.js apps/mdm-platform/server/mappingMysqlRepository.js apps/mdm-platform/server/conflictMysqlRepository.js apps/mdm-platform/server/todoMysqlRepository.js apps/mdm-platform/server/terminologyMysqlRepository.js apps/mdm-platform/scripts/test-person-business-writes-mysql.js
git commit -m "feat(mdm): migrate business writes to person identity"
```

Expected: one scoped commit for person-field business writes.

---

### Task 3: Complete Guidance Workspace And Executor Flow

**Files:**
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Modify: `apps/mdm-platform/public/index.html`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-frontend.js`

- [ ] **Step 1: Add backend workspace contract**

Create `apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js` covering:

- current-object guidance list,
- guidance detail with action affordances,
- guidance event timeline,
- delegation create and revoke,
- executor assignment,
- assignable person picker from MySQL person data.

- [ ] **Step 2: Add frontend workspace contract**

Create `apps/mdm-platform/scripts/test-guidance-workspace-frontend.js` asserting `index.html` contains:

- current-object guidance list,
- detail panel,
- event timeline,
- person picker,
- delegation form,
- executor assignment form,
- disabled reason display from backend affordances,
- no `window.prompt(`.

- [ ] **Step 3: Wire the command**

In `apps/mdm-platform/package.json`, add:

```json
"test:guidance-workspace": "node scripts/test-guidance-workspace-mysql-api.js && node scripts/test-guidance-workspace-frontend.js"
```

- [ ] **Step 4: Run red**

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workspace
```

Expected: fails on missing workspace, detail, events, executor, or person-picker behavior.

- [ ] **Step 5: Implement backend behavior**

Add or complete repository and route methods for:

```text
GET /api/process-governance/guidance
GET /api/process-governance/guidance/:id
GET /api/process-governance/guidance/:id/events
POST /api/process-governance/guidance/:id/delegate
DELETE /api/process-governance/guidance/:id/delegations/:delegationId
POST /api/process-governance/guidance/:id/assign-executor
GET /api/org/persons/assignable
```

Executor rules:

- final responsible person can assign executor,
- valid delegate can assign executor only inside authorized scope,
- assignment records `executor_assigned`,
- assignment never changes `final_responsible_person_id`,
- major final confirmation still requires final responsible person or delegate with `can_final_confirm=1`.

- [ ] **Step 6: Implement frontend behavior**

In `apps/mdm-platform/public/index.html`, add:

- guidance list for the selected process governance object,
- detail panel showing final responsible, current handler, delegate and executor,
- event timeline,
- delegate and executor person picker backed by `/api/org/persons/assignable`,
- disabled reason text for visible but unavailable actions.

Keep the surface task-first and avoid adding a module-first navigation layer.

- [ ] **Step 7: Verify the guidance repair**

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workspace
npm run test:guidance-workflow
npm run test:person-operation-controls
npm run test:frontend
```

Expected: all commands exit 0.

- [ ] **Step 8: Commit guidance repair**

Run from repo root:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/governanceGuidanceMysqlRepository.js apps/mdm-platform/server/routes/governanceGuidance.js apps/mdm-platform/server/routes/org.js apps/mdm-platform/public/index.html apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js apps/mdm-platform/scripts/test-guidance-workspace-frontend.js
git commit -m "feat(mdm): complete guidance workspace and executor flow"
```

Expected: one scoped commit for guidance workspace and executor flow.

---

### Task 4: Prove Migration And Prepare Deletion Decision

**Files:**
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Create: `apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js`
- Create: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md`

- [ ] **Step 1: Add migration rehearsal**

Create `apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js` with a fixture that starts from:

- `users`,
- `user_roles`,
- department `manager_user_id` and `data_owner_user_id`,
- representative business records with `*_user_id` values.

Assert after migration:

- every legacy user has a person,
- every person has one account,
- every legacy role assignment has a person role,
- department responsibility fields have person values,
- representative business records have person values,
- new writes after migration use person fields.

- [ ] **Step 2: Wire the command**

In `apps/mdm-platform/package.json`, add:

```json
"test:person-identity-migration-rehearsal": "node scripts/test-person-identity-migration-rehearsal-mysql.js"
```

- [ ] **Step 3: Verify migration rehearsal**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-migration-rehearsal
npm run test:identity-mysql
npm run test:person-identity-rbac-completion
```

Expected: all commands exit 0.

- [ ] **Step 4: Write deletion decision package**

Create `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md` containing:

- remaining SQLite runtime entry points,
- remaining legacy `users` and `user_roles` compatibility reads,
- routes still exposing `user` naming,
- tests to rewrite or delete,
- rollback sequence,
- user approval checkpoint before deletion.

- [ ] **Step 5: Commit migration rehearsal and decision package**

Run from repo root:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/identityMysqlRepository.js apps/mdm-platform/server/mysqlSchema.js apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md
git commit -m "test(mdm): prove person identity migration rehearsal"
```

Expected: one scoped commit for rehearsal and deletion decision evidence.

---

### Task 5: Final Verification And Merge Readiness

**Files:**
- No new files expected.

- [ ] **Step 1: Run full MDM verification**

Run from `apps/mdm-platform`:

```powershell
npm run test:legacy-identity-inventory
npm run test:person-business-writes
npm run test:guidance-workspace
npm run test:person-identity-migration-rehearsal
npm run test:person-identity-rbac-completion
npm run test:identity-mysql
npm run test:role-workbench-mysql
npm run test:project-roles
npm run test:frontend
npm run test:process-governance
npm run test:mainline
```

Expected: all commands exit 0.

- [ ] **Step 2: Run repository checks**

Run from repo root:

```powershell
npm run test:infomat-services-config
git diff --check
git status --short --branch
```

Expected:

- service config guard exits 0,
- no whitespace errors,
- status shows only intended Round 2 repair files before final commit.

- [ ] **Step 3: Confirm no forbidden paths changed**

Run:

```powershell
git diff --name-only master...HEAD
```

Expected: output contains only `apps/mdm-platform/` files and `docs/superpowers/plans/` repair/deletion decision documents.

- [ ] **Step 4: Stop for merge review**

Do not merge into `master` until the user reviews:

- test results,
- changed file list,
- SQLite deletion decision package,
- any remaining business confirmation points.

Expected: branch is ready for review, not automatically merged.

---

## Self-Review

- P0 legacy identity guard is first, so new old-style writes are blocked before migration starts.
- Business writes move before UI expansion, so the UX does not cover over identity debt.
- Guidance workspace is limited to list, detail, events, delegation, executor assignment and disabled reasons.
- SQLite deletion is not performed in this repair plan.
- Dirty main workspace is protected by isolated worktree execution.
