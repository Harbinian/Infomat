# MDM Person Identity RBAC Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the second-round cleanup after the person identity and RBAC redesign by moving remaining target writes from legacy `users` / `*_user_id` semantics to `person` / `*_person_id`, completing the guidance delegation and executor workflow, and preparing SQLite legacy deletion evidence.

**Architecture:** MySQL `person` is the business identity. `user_accounts` is login-only. `person_roles` is the RBAC assignment truth. Legacy `users`, `user_roles`, SQLite routes, and old `*_user_id` columns are migration compatibility only until this plan explicitly proves they can be contained or removed.

**Tech Stack:** Node.js, Express, MySQL via `mysql2`, single-file frontend at `apps/mdm-platform/public/index.html`, script tests under `apps/mdm-platform/scripts/`.

---

## Scope And Guardrails

- Implement in a fresh isolated worktree because the main workspace is dirty.
- Primary code scope: `apps/mdm-platform/`.
- Planning docs scope: `docs/superpowers/plans/`.
- Do not modify `docs/norms/`, `pmo/`, `docs/company-sankey-data.json`, PMO generated assets, or process truth-source Markdown.
- Do not change standards, A1 splitting, L1/L2 classification, or publish decisions.
- Do not delete SQLite or legacy tables until Task 5 proves rollback and MySQL parity.
- Keep response aliases only where the current UI or route contract still needs them; target writes must use person fields.

## File Map

- Modify: `apps/mdm-platform/package.json`
  - Add Round 2 focused test scripts.
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
  - Keep compatibility fields; ensure person fields and indexes exist for every migrated write path.
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
  - Add inventory helpers and tighten compatibility fallback boundaries.
- Modify: `apps/mdm-platform/server/processGovernanceMysqlRepository.js`
  - Move quality cases, case events, mapping todos, todo events, issue pool participants/events and term task actors to person writes.
- Modify: `apps/mdm-platform/server/processGovernanceIssuePoolRepository.js`
  - Keep SQLite branch isolated; move MySQL branch target writes to person fields.
- Modify: `apps/mdm-platform/server/dataMapMysqlRepository.js`
  - Move steward, owner, submitter, reviewer, creator and updater writes to person fields.
- Modify: `apps/mdm-platform/server/mappingMysqlRepository.js`
  - Move submitted, assignee and operator writes to person fields while preserving legacy output aliases.
- Modify: `apps/mdm-platform/server/conflictMysqlRepository.js`
  - Move conflict assignment and coordination actor writes to person fields.
- Modify: `apps/mdm-platform/server/todoMysqlRepository.js`
  - Move todo creator/completer/event actor writes to person fields.
- Modify: `apps/mdm-platform/server/terminologyMysqlRepository.js`
  - Move term creator/approver and term task actors to person fields.
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
  - Add executor assignment, guidance detail, event list, and delegation list/revoke support.
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
  - Add guidance detail, events, executor assignment, delegation list/create/revoke endpoints.
- Modify: `apps/mdm-platform/server/routes/org.js`
  - Expose a person picker endpoint backed by MySQL person data; keep old user routes compatible only if still needed.
- Modify: `apps/mdm-platform/public/index.html`
  - Add current-object guidance list/detail, event timeline, person picker, delegation form, executor assignment form, and disabled reason display.
- Create: `apps/mdm-platform/scripts/test-legacy-identity-inventory.js`
  - Fails if new target writes use `users.id`, `user_roles`, or `*_user_id` without a paired person target and explicit compatibility marker.
- Create: `apps/mdm-platform/scripts/test-person-business-writes-mysql.js`
  - Verifies process governance, data map, mapping approval, conflict, todo, terminology and activity writes populate person fields.
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js`
  - Verifies list/detail/events/delegation/executor routes.
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-frontend.js`
  - Verifies person picker, delegation form, executor form, event timeline, disabled reasons and no `window.prompt`.
- Create: `apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js`
  - Builds old `users` / `user_roles` / `*_user_id` fixture, runs migration, verifies person fields and rollback notes.

---

### Task 0: Isolated Worktree And Baseline

- [ ] **Step 1: Create an isolated worktree**

Run from repo root:

```powershell
git worktree add C:\Users\charl\.config\superpowers\worktrees\Infomat\codex-mdm-person-rbac-round2 -b codex/mdm-person-rbac-round2 master
cd C:\Users\charl\.config\superpowers\worktrees\Infomat\codex-mdm-person-rbac-round2
```

Expected: new branch `codex/mdm-person-rbac-round2` exists and main dirty workspace remains untouched.

- [ ] **Step 2: Reconfirm baseline in the isolated worktree**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-rbac-completion
npm run test:mainline
```

Expected: both commands exit 0.

- [ ] **Step 3: Confirm no forbidden paths changed**

Run from isolated repo root:

```powershell
git status --short
```

Expected: no changes before implementation.

---

### Task 1: Legacy Identity Inventory Guard

**Files:**
- Modify: `apps/mdm-platform/package.json`
- Create: `apps/mdm-platform/scripts/test-legacy-identity-inventory.js`

- [ ] **Step 1: Write the guard first**

Create a script that scans `apps/mdm-platform/server/**/*.js` and classifies hits for:

- `users`
- `user_roles`
- `owner_user_id`
- `actor_user_id`
- `assignee_user_id`
- `operator_user_id`
- `steward_user_id`
- `submitted_by`
- `reviewed_by`
- `created_by`
- `updated_by`
- `assigned_by`
- `operated_by`

Allowed classes:

- `compatibility-read`
- `compatibility-response-alias`
- `migration-input`
- `sqlite-legacy`
- `test-fixture`

Fail when a non-test MySQL repository writes an old user field without writing the paired person field in the same operation.

- [ ] **Step 2: Add script command**

In `apps/mdm-platform/package.json` add:

```json
"test:legacy-identity-inventory": "node scripts/test-legacy-identity-inventory.js"
```

- [ ] **Step 3: Run red**

Run:

```powershell
cd apps/mdm-platform
npm run test:legacy-identity-inventory
```

Expected before migration: fail with current target-write hits in process governance, data map, mapping, conflicts, todos and terminology repositories.

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

- [ ] **Step 1: Write failing person-write coverage**

Create `test-person-business-writes-mysql.js` with fake-pool cases for each repository operation that currently writes old actor fields. Assert the executed SQL or params include the paired person field:

- `owner_person_id`
- `actor_person_id`
- `assignee_person_id`
- `assigned_by_person_id`
- `operator_person_id`
- `steward_person_id`
- `submitted_by_person_id`
- `reviewed_by_person_id`
- `created_by_person_id`
- `updated_by_person_id`
- `operated_by_person_id`

- [ ] **Step 2: Add script command and run red**

In `apps/mdm-platform/package.json` add:

```json
"test:person-business-writes": "node scripts/test-person-business-writes-mysql.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:person-business-writes
```

Expected before implementation: fail on repositories still writing only old fields.

- [ ] **Step 3: Migrate writes by repository**

For each touched repository:

- Accept `actor_person_id`, `owner_person_id`, `assignee_person_id`, `submitted_by_person_id`, or equivalent camelCase person payload first.
- If only a legacy user field arrives, resolve it through `identityMysqlRepository` compatibility helpers or copy it into the paired person field during migration.
- Write person fields as the target fields.
- Keep old fields as response aliases only when current UI/tests still expect them.
- Add paired indexes in `mysqlSchema.js` only if missing.

- [ ] **Step 4: Run focused verification**

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

---

### Task 3: Guidance Workspace, Delegation, And Executor Workflow

**Files:**
- Modify: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Modify: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Modify: `apps/mdm-platform/public/index.html`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js`
- Create: `apps/mdm-platform/scripts/test-guidance-workspace-frontend.js`

- [ ] **Step 1: Write API coverage**

Create `test-guidance-workspace-mysql-api.js` covering:

- `GET /api/process-governance/guidance?related_entity_type=&related_entity_id=` returns all matching guidance for the current object.
- `GET /api/process-governance/guidance/:id` returns detail and current action affordances.
- `GET /api/process-governance/guidance/:id/events` returns ordered guidance events.
- `POST /api/process-governance/guidance/:id/delegate` validates final responsible person and writes person-based delegation.
- `DELETE /api/process-governance/guidance/:id/delegations/:delegationId` revokes only in-scope delegation.
- `POST /api/process-governance/guidance/:id/assign-executor` writes executor person, event and current handler according to the business rule.
- `GET /api/org/persons/assignable?department_id=` returns active MySQL person rows for picker usage.

- [ ] **Step 2: Write frontend coverage**

Create `test-guidance-workspace-frontend.js` asserting `index.html` contains:

- current-object guidance list container,
- guidance detail panel,
- guidance event timeline,
- person picker for delegate and executor,
- delegation form fields for scope, reason, start/end, can final confirm,
- executor assignment form,
- disabled reason rendering from `guidanceActions.disabledReasons`,
- no `window.prompt(`.

- [ ] **Step 3: Add script commands and run red**

In `apps/mdm-platform/package.json` add:

```json
"test:guidance-workspace": "node scripts/test-guidance-workspace-mysql-api.js && node scripts/test-guidance-workspace-frontend.js"
```

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workspace
```

Expected before implementation: fail on missing detail/events/executor/person-picker contracts.

- [ ] **Step 4: Implement backend first**

Implement repository and route methods:

- `getGuidanceByIdForPerson(guidanceId, personId, permissions)`
- `listGuidanceEvents(guidanceId)`
- `listGuidanceDelegations(guidanceId, personId)`
- `revokeGuidanceDelegation(guidanceId, delegationId, personId)`
- `assignExecutor(guidanceId, actorPersonId, executorPersonId, payload)`
- `listAssignablePersons(filters)`

Executor assignment rules:

- Final responsible person can assign executor.
- Valid delegate can assign executor only if delegation scope allows response handling.
- Assignment records `executor_assigned` event.
- Assignment does not change `final_responsible_person_id`.
- Major final confirmation remains controlled by final responsible person or delegate with `can_final_confirm=1`.

- [ ] **Step 5: Implement frontend workspace**

In `index.html` add:

- guidance list for selected process governance object,
- detail panel with final responsible, current handler, delegate and executor,
- event timeline,
- delegate and executor person picker backed by `/api/org/persons/assignable`,
- disabled reason text near unavailable action buttons.

Keep the first screen task-oriented; do not add module-first navigation.

- [ ] **Step 6: Run focused verification**

Run:

```powershell
cd apps/mdm-platform
npm run test:guidance-workspace
npm run test:guidance-workflow
npm run test:person-operation-controls
npm run test:frontend
```

Expected: all commands exit 0.

---

### Task 4: MySQL Migration Rehearsal And Compatibility Boundaries

**Files:**
- Modify: `apps/mdm-platform/server/identityMysqlRepository.js`
- Modify: `apps/mdm-platform/server/mysqlSchema.js`
- Create: `apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js`

- [ ] **Step 1: Write migration rehearsal**

Create a fixture that starts with old data:

- `users`
- `user_roles`
- department `manager_user_id` and `data_owner_user_id`
- representative `*_user_id` business records from process governance, data map, mappings, conflicts, todos and terminology.

Run the existing schema/migration helpers and assert:

- every user has a person,
- every person has one account,
- every legacy role assignment has a person role,
- department final responsible/data owner person fields are populated,
- representative business records have person fields populated,
- new writes after migration use person fields.

- [ ] **Step 2: Add script command**

In `apps/mdm-platform/package.json` add:

```json
"test:person-identity-migration-rehearsal": "node scripts/test-person-identity-migration-rehearsal-mysql.js"
```

- [ ] **Step 3: Run focused verification**

Run:

```powershell
cd apps/mdm-platform
npm run test:person-identity-migration-rehearsal
npm run test:identity-mysql
npm run test:person-identity-rbac-completion
```

Expected: all commands exit 0.

- [ ] **Step 4: Document compatibility boundary in code comments**

Add short comments only above compatibility branches that still read old `users` or `user_roles`, for example:

```js
// Compatibility bridge for pre-person data; target writes must use person_* fields.
```

Do not add broad narration comments.

---

### Task 5: SQLite And Legacy Deletion Decision Package

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-gap-ledger.md`
- Create or update: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md`

- [ ] **Step 1: Produce deletion decision package**

Write a short decision document with:

- remaining SQLite runtime entry points,
- remaining legacy `users` / `user_roles` compatibility reads,
- route/API contracts still exposing `user` naming,
- tests that will be deleted or rewritten,
- rollback command sequence,
- explicit user approval point before actual deletion.

- [ ] **Step 2: Do not delete yet**

Stop before deleting SQLite files, legacy routes, or compatibility tables unless the user explicitly approves the deletion package.

Expected: this task produces a decision artifact, not code removal.

---

### Task 6: Consolidated Verification And Commit

- [ ] **Step 1: Run full verification stack**

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

- [ ] **Step 2: Run repo-level checks**

Run from repo root:

```powershell
npm run test:infomat-services-config
git diff --check
git status --short --branch
```

Expected:

- service config guard exits 0,
- no whitespace errors,
- only intended Round 2 files are modified.

- [ ] **Step 3: Commit from isolated worktree**

Stage only intended files:

```powershell
git add apps/mdm-platform/package.json apps/mdm-platform/server/mysqlSchema.js apps/mdm-platform/server/identityMysqlRepository.js apps/mdm-platform/server/processGovernanceMysqlRepository.js apps/mdm-platform/server/processGovernanceIssuePoolRepository.js apps/mdm-platform/server/dataMapMysqlRepository.js apps/mdm-platform/server/mappingMysqlRepository.js apps/mdm-platform/server/conflictMysqlRepository.js apps/mdm-platform/server/todoMysqlRepository.js apps/mdm-platform/server/terminologyMysqlRepository.js apps/mdm-platform/server/governanceGuidanceMysqlRepository.js apps/mdm-platform/server/routes/governanceGuidance.js apps/mdm-platform/server/routes/org.js apps/mdm-platform/public/index.html apps/mdm-platform/scripts/test-legacy-identity-inventory.js apps/mdm-platform/scripts/test-person-business-writes-mysql.js apps/mdm-platform/scripts/test-guidance-workspace-mysql-api.js apps/mdm-platform/scripts/test-guidance-workspace-frontend.js apps/mdm-platform/scripts/test-person-identity-migration-rehearsal-mysql.js docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-gap-ledger.md docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-sqlite-deletion-decision.md
git commit -m "feat(mdm): complete person identity rbac round2 cleanup"
```

Expected: a single scoped commit on `codex/mdm-person-rbac-round2`.

---

## Self-Review

- This plan uses only confirmed gaps and compatibility debt from the Round 2 ledger.
- Optional UX improvements are excluded unless they are needed to make delegation, executor assignment, detail, events or disabled reasons usable.
- `docs/norms/` and PMO assets remain out of scope.
- SQLite deletion is gated behind migration rehearsal and explicit user approval.
- Dirty main workspace is protected by the isolated worktree requirement.
