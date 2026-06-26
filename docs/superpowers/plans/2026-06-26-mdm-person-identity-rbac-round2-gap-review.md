# MDM Person Identity RBAC Round 2 Gap Review Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to run this review task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Review the remaining gaps after the first-round person identity and RBAC redesign, then produce a concrete Round 2 implementation plan.

**Architecture:** Treat MySQL `person` as the target identity model and keep `user_accounts` as login credentials only. Review legacy `users`, SQLite, old `*_user_id` compatibility, delegation UI, executor assignment, and migration evidence without changing `docs/norms/`, PMO truth sources, or process source files.

**Tech Stack:** Node.js, Express, MySQL via `mysql2`, single-file frontend in `apps/mdm-platform/public/index.html`, script tests under `apps/mdm-platform/scripts/`.

---

## Scope And Guardrails

- Review scope is `apps/mdm-platform/` plus this plan folder.
- Do not change `docs/norms/`, `pmo/`, `docs/company-sankey-data.json`, or PMO generated assets.
- Do not delete SQLite code during the review. Decide and document the deletion sequence first.
- Do not introduce new `users.id` target writes. Existing `users` and `user_roles` references are compatibility evidence to classify.
- Keep management guidance and department responsibility human-controlled: AI can structure checks, but cannot define standards, A1 splits, L1/L2 classifications, or publish decisions.

## Review Outputs

- Create a gap ledger at `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-gap-ledger.md`.
- Create a Round 2 implementation plan only after the ledger is complete.
- The ledger must separate:
  - confirmed implementation gaps,
  - compatibility debt intentionally left from Round 1,
  - optional UX improvements,
  - items blocked by missing business decision.

---

### Task 1: Reconfirm Round 1 Baseline

**Files:**
- Read: `docs/superpowers/specs/2026-06-26-mdm-person-identity-rbac-redesign.md`
- Read: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-completion.md`
- Read: `apps/mdm-platform/package.json`
- Create: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-gap-ledger.md`

- [ ] **Step 1: Run fresh baseline verification**

Run from `apps/mdm-platform`:

```powershell
npm run test:person-identity-rbac-completion
npm run test:mainline
```

Expected: both commands exit 0.

- [ ] **Step 2: Start the ledger**

Create the ledger with these sections:

```markdown
# MDM Person Identity RBAC Round 2 Gap Ledger

## Baseline Verification

- `npm run test:person-identity-rbac-completion`: pass or fail with date and reason.
- `npm run test:mainline`: pass or fail with date and reason.

## Confirmed Implementation Gaps

## Compatibility Debt Left From Round 1

## Optional UX Improvements

## Blocked By Business Decision

## Proposed Round 2 Tasks
```

- [ ] **Step 3: Record current branch and dirty workspace**

Run from repo root:

```powershell
git status --short --branch
git worktree list --porcelain
```

Record whether unrelated local changes exist. If the workspace is dirty, the Round 2 implementation plan must require an isolated worktree.

---

### Task 2: Classify Legacy User And SQLite Compatibility Debt

**Files:**
- Review: `apps/mdm-platform/server/identityMysqlRepository.js`
- Review: `apps/mdm-platform/server/mysqlSchema.js`
- Review: `apps/mdm-platform/server/database.js`
- Review: `apps/mdm-platform/server/routes/org.js`
- Review: `apps/mdm-platform/scripts/test-no-new-user-identity-fields.js`

- [ ] **Step 1: Inventory old user references**

Run:

```powershell
rg -n "users|user_roles|user_id|assigned_by_user_id|submitted_by_user_id|reviewed_by_user_id" apps/mdm-platform/server apps/mdm-platform/scripts
```

Classify each hit in the ledger as one of:

- target write that must move to person,
- compatibility read that can stay temporarily,
- SQLite-only legacy path,
- test fixture or guard.

- [ ] **Step 2: Inventory SQLite identity paths**

Run:

```powershell
rg -n "better-sqlite3|sqlite|db.prepare|CREATE TABLE users|user_roles" apps/mdm-platform/server apps/mdm-platform/scripts
```

Record which paths still serve live runtime behavior and which are only old smoke tests.

- [ ] **Step 3: Define deletion prerequisites**

Add a checklist to the ledger with these prerequisites:

- MySQL startup path verified without SQLite identity reads.
- `/api/org/me` and `/api/role-workbench` verified from MySQL.
- data map, terminology, mappings, conflicts, todos, versions, and activity tests verified with person identity.
- rollback path documented before removing SQLite tables or route fallbacks.

---

### Task 3: Review Delegation, Executor, And Guidance UX Gaps

**Files:**
- Review: `apps/mdm-platform/server/governanceGuidanceMysqlRepository.js`
- Review: `apps/mdm-platform/server/routes/governanceGuidance.js`
- Review: `apps/mdm-platform/public/index.html`
- Review: `apps/mdm-platform/scripts/test-guidance-workflow-mysql-api.js`
- Review: `apps/mdm-platform/scripts/test-guidance-affordances-mysql-repository.js`
- Review: `apps/mdm-platform/scripts/test-person-operation-controls-frontend.js`

- [ ] **Step 1: Verify current guidance action model**

Run:

```powershell
npm run test:guidance-workflow
npm run test:person-operation-controls
```

Expected: both commands exit 0.

- [ ] **Step 2: Record UX gaps**

Record these known gaps in the ledger and verify whether code confirms them:

- backend supports delegation, but frontend lacks a person selector and delegation management view,
- frontend displays `delegatePerson` and `executorPerson`, but executor assignment is not yet a complete workflow,
- action controls are tied to current guidance context, but there is no full guidance list/detail workspace,
- final confirmation rules exist, but business wording for major versus non-major closeout needs review.

- [ ] **Step 3: Identify minimum Round 2 UX slice**

Choose the smallest implementable UX slice for Round 2:

- guidance list for current object,
- delegation form with person picker,
- executor assignment form,
- guidance event timeline,
- disabled reason display for unavailable actions.

The ledger must state which slice is first and why.

---

### Task 4: Review RBAC And Data Scope Completeness

**Files:**
- Review: `apps/mdm-platform/server/roleDefinitions.js`
- Review: `apps/mdm-platform/server/identityMysqlRepository.js`
- Review: `apps/mdm-platform/scripts/test-person-rbac-matrix-mysql.js`
- Review: `apps/mdm-platform/scripts/test-person-identity-payload-mysql.js`

- [ ] **Step 1: Re-run focused RBAC tests**

Run:

```powershell
npm run test:person-rbac-matrix
npm run test:person-identity-payload
npm run test:identity-mysql
npm run test:role-workbench-mysql
```

Expected: all commands exit 0.

- [ ] **Step 2: Review role and permission semantics**

Record any missing or unclear rules for:

- protected core roles,
- dangerous permissions,
- data scope derivation,
- role inheritance,
- department-scoped versus global process governance reads,
- decision group guidance creation without department response authority.

- [ ] **Step 3: Decide whether tests need live MySQL fixtures**

If fake-pool tests are not enough for any rule, mark it as a Round 2 live-fixture requirement and specify the acceptance command.

---

### Task 5: Draft Round 2 Implementation Plan

**Files:**
- Read: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-gap-ledger.md`
- Create: `docs/superpowers/plans/2026-06-26-mdm-person-identity-rbac-round2-implementation.md`

- [ ] **Step 1: Select only confirmed gaps**

Use only items from these ledger sections:

- Confirmed Implementation Gaps
- Compatibility Debt Left From Round 1

Do not include optional UX improvements unless the user explicitly chooses them.

- [ ] **Step 2: Write the Round 2 implementation plan**

The plan must include:

- file map,
- TDD steps,
- exact commands,
- rollback boundaries,
- no changes to `docs/norms/` or PMO truth sources,
- a final verification stack.

- [ ] **Step 3: Stop for user review**

Do not execute Round 2 implementation until the user approves the plan.

---

## Self-Review

- This plan prepares a review and does not implement Round 2.
- The review starts from fresh verification, not assumptions from prior runs.
- The ledger keeps confirmed gaps separate from optional UX ideas.
- The plan keeps `docs/norms/` and PMO truth sources out of scope.
- Dirty workspace handling remains explicit before any next implementation.
