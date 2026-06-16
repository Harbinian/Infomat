# Full Repo Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the 2026-06-15 full-repo audit findings into staged, testable remediation work without crossing repository ownership boundaries.

**Architecture:** Treat the audit as five independent tracks: MDM security/RBAC, MDM data integrity, repository scripts/runtime isolation, PMO runtime separation, and process-governance source completion. Each track must preserve the current mainline rule: `docs/norms/` and `docs/organization/` remain the process source of truth, PMO pages remain display copies, and `apps/mdm-platform/` consumes snapshots instead of writing back to source documents.

**Tech Stack:** Node.js, Express, express-session, better-sqlite3, single-file MDM frontend HTML, ECharts, Vite PMO React app, repository-level `.mjs` scripts, Markdown source documents.

---

## Scope Check

The audit spans several independent subsystems. Do not implement it as one large change. Execute in this order:

1. P0 safety gates and baselining.
2. P1 MDM security and RBAC.
3. P2 MDM data integrity and workflow correctness.
4. P3 script isolation and repository boundary cleanup.
5. P4 PMO runtime separation and process source completion.

Each phase must be independently reviewable and must leave the repository in a passing state before the next phase starts.

## Repository Rules For This Plan

- Do not move `docs/norms/`, `pmo/procedure-management/dashboard.html`, or `apps/mdm-platform/`.
- Do not treat PMO dashboard embedded data as a source document.
- Do not make evaluative statements about OA, MES, ERP, PLM, or any other application system.
- Do not write shared `apps/mdm-platform/data/platform.db` during tests or sync rehearsals.
- Do not keep uploaded binary originals, rendered screenshots, unpacked directories, or test output in version-controlled business directories.

## File Responsibility Map

### MDM Security And RBAC

- Modify `apps/mdm-platform/server/index.js`: global security headers, CSRF middleware, session options, route registration order.
- Create `apps/mdm-platform/server/security.js`: CSRF token issue/verify, same-origin write guard, login rate limiter, common security headers.
- Modify `apps/mdm-platform/server/routes/org.js`: login session regeneration, password lifecycle routes, admin user create/reset behavior.
- Modify `apps/mdm-platform/server/passwordPolicy.js`: remove fixed initial password generation, add random one-time password generation and strength validation.
- Modify `apps/mdm-platform/server/auth.js`: narrow legacy role fallback and keep permission checks centralized.
- Modify `apps/mdm-platform/server/routes/mappings.js`: remove `users.role='admin'` approval fallback and rely on RBAC permission checks.
- Modify `apps/mdm-platform/public/index.html`: fetch wrapper CSRF handling, remove inline `onclick`, remove initial-password toast, escape ECharts tooltip HTML.
- Modify tests under `apps/mdm-platform/scripts/`: update security, password, frontend, RBAC, and route write audit expectations.

### MDM Data Integrity

- Modify `apps/mdm-platform/server/db.js`: explicit migration columns, missing foreign keys, cycle-prevention triggers where feasible.
- Modify `apps/mdm-platform/server/codeEngine.js`: atomic sequence reservation.
- Modify `apps/mdm-platform/server/routes/orgUnit.js`: reject parent cycles for organization units.
- Modify `apps/mdm-platform/server/routes/classNode.js`: reject parent cycles for classification trees.
- Modify `apps/mdm-platform/server/routes/conflicts.js`: remove write side effects from `GET /conflicts`, align resolve/final-decide behavior, replace hard-coded coordination threshold.
- Modify `apps/mdm-platform/server/routes/roleWorkbench.js`: make `mode=todo` and `mode=all` produce different responsibility scopes.
- Modify `apps/mdm-platform/scripts/test-conflict-routes.js`, `test-role-workbench-api.js`, and `test-mainline-stability.js`: cover the new contracts.

### Script Isolation And Boundary

- Modify `scripts/sync-process-governance-mainline.mjs`: require explicit isolated `MDM_DB_PATH`; refuse default shared DB.
- Modify `apps/mdm-platform/scripts/sync-process-governance-org.js`: default to dry-run, require explicit archive flag before archiving non-canonical active departments.
- Modify `apps/mdm-platform/scripts/import-process-governance.js` and `apps/mdm-platform/scripts/lib/processGovernanceImport.js`: consume `docs/company-sankey-data.json` or an explicit snapshot path; stop scanning `docs/norms/` as an app-local default.
- Modify `scripts/check-dcm-bbm.mjs`: default generated report output to `docs/reports/`, not `docs/norms/`.
- Modify `scripts/parse-sankey-data.mjs`: replace only one exact `#sankey-data` script block and fail loudly if the block is missing or duplicated.
- Modify `scripts/normalize-norms-sankey-h5.mjs`: make dry-run the default and require an explicit write flag.
- Modify `scripts/merge_norms.py`, `scripts/render_gantt_h5_png.mjs`, and `scripts/generate_digital_project_gantt_8k.py`: remove Windows-only hard-coded paths.

### PMO Runtime Separation

- Modify `pmo/gantt-react/plugins/pmoDeliverablesPlugin.js`: store uploaded originals and runtime history under `artifacts/pmo/deliverables/` or another explicitly ignored runtime path.
- Modify `pmo/scripts/smoke-plugin-endpoints.mjs` and `pmo/scripts/smoke-writeback.mjs`: assert runtime uploads do not land in `pmo/deliverables/_history/`.
- Modify `pmo/gantt-react/src/utils/deliverableFsApi.js` if client endpoint paths or response metadata change.
- Modify `pmo/README.md` if the runtime storage contract is documented there.

### Process Source And Contracts

- Modify `DIRECTORY_OWNERSHIP.md`: add `docs/contracts/` as an execution contract directory.
- Modify `REPOSITORY_BOUNDARY.md` and `MAINLINE_MAP.md` only if the current source/snapshot/display chain needs clearer wording.
- Modify `docs/contracts/README.md`: list all known consumers and exact regression commands.
- Create `docs/norms/工程技术部部门-能力-流程-系统映射关系.md`: close the source gap confirmed by the audit, using process data from approved source materials.
- Modify `docs/reports/2026-06-11-engineering-source-manifest.md` and `docs/reports/2026-06-11-norms-source-manifest.md` only if the new source file changes manifest expectations.
- Run `scripts/parse-sankey-data.mjs` after the engineering source file is added, so `docs/company-sankey-data.json` and the PMO dashboard snapshot stay in sync.

---

## Task 1: Baseline And Execution Gates

**Files:**
- Create: `docs/reports/2026-06-16-audit-remediation-baseline.md`
- Modify: none
- Test: existing root and MDM scripts listed below

- [ ] **Step 1: Record current branch and dirty worktree**

Run:

```powershell
git status --short
git branch --show-current
```

Expected: output is copied into `docs/reports/2026-06-16-audit-remediation-baseline.md`. Existing unrelated changes are marked as pre-existing and are not reverted.

- [ ] **Step 2: Run current read-only process mainline check**

Run:

```powershell
npm run test:process-governance-mainline
```

Expected: either `Process governance mainline checks passed` or a failure is recorded with the exact failing script name. Do not fix failures in this task.

- [ ] **Step 3: Run current MDM safety checks with isolated DB**

Run:

```powershell
cd apps/mdm-platform
npm run test:db-path
npm run test:security
npm run test:role-workbench
npm run test:process-governance
npm run test:mainline
```

Expected: results are recorded in the baseline report. Any failure caused by an already-known audit finding is linked to the corresponding section in `docs/reports/2026-06-15-full-repo-audit-summary.md`.

- [ ] **Step 4: Run current PMO plugin checks**

Run:

```powershell
cd pmo/gantt-react
npm run test:plugin
npm run test:writeback
npm run build
```

Expected: results are recorded in the baseline report. Runtime files created by the checks are listed and then removed if they are test output.

- [ ] **Step 5: Commit only the baseline report if execution work is being committed**

Run:

```powershell
git add docs/reports/2026-06-16-audit-remediation-baseline.md
git commit -m "docs: record audit remediation baseline"
```

Expected: commit contains only the baseline report.

---

## Task 2: MDM HTTP Security Foundation

**Files:**
- Create: `apps/mdm-platform/server/security.js`
- Modify: `apps/mdm-platform/server/index.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Modify: `apps/mdm-platform/public/index.html`
- Modify: `apps/mdm-platform/scripts/test-security-routes.js`
- Modify: `apps/mdm-platform/scripts/test-frontend-assets.js`

- [ ] **Step 1: Add failing tests for session regeneration, CSRF, headers, and login throttling**

Update `apps/mdm-platform/scripts/test-security-routes.js` with assertions that:

- Login changes the session cookie value after authentication.
- Authenticated unsafe requests without `X-CSRF-Token` return `403`.
- `GET /api/csrf-token` returns a token for authenticated users.
- Repeated failed login attempts for the same employee number return `429` after the configured threshold.
- Responses include `X-Content-Type-Options: nosniff`, `Referrer-Policy`, and a basic `Content-Security-Policy`.

Run:

```powershell
cd apps/mdm-platform
npm run test:security
```

Expected: FAIL on the new assertions before implementation.

- [ ] **Step 2: Implement `server/security.js`**

Create middleware with these exported functions:

```javascript
const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const CSRF_EXEMPT_PATHS = new Set(['/api/org/login']);
const failedLogins = new Map();

function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-ancestors 'self'");
  next();
}

function ensureCsrfSecret(req) {
  if (!req.session.csrfSecret) {
    req.session.csrfSecret = crypto.randomBytes(32).toString('hex');
  }
  return req.session.csrfSecret;
}

function issueCsrfToken(req, res) {
  const secret = ensureCsrfSecret(req);
  res.json({ csrfToken: secret });
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (CSRF_EXEMPT_PATHS.has(req.path)) return next();
  if (!req.session || !req.session.userId) return next();
  const expected = ensureCsrfSecret(req);
  const actual = req.get('X-CSRF-Token');
  if (!actual || actual !== expected) {
    return res.status(403).json({ error: 'CSRF token invalid' });
  }
  next();
}

function loginRateLimit(req, res, next) {
  const employeeNo = String(req.body && req.body.employee_no || 'unknown');
  const key = `${req.ip}:${employeeNo}`;
  const now = Date.now();
  const state = failedLogins.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (state.resetAt <= now) {
    failedLogins.set(key, { count: 0, resetAt: now + 15 * 60 * 1000 });
    return next();
  }
  if (state.count >= 8) {
    return res.status(429).json({ error: '登录失败次数过多，请稍后再试' });
  }
  req.loginRateLimitKey = key;
  next();
}

function recordLoginFailure(req) {
  const key = req.loginRateLimitKey;
  if (!key) return;
  const now = Date.now();
  const state = failedLogins.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
  state.count += 1;
  failedLogins.set(key, state);
}

function clearLoginFailures(req) {
  if (req.loginRateLimitKey) failedLogins.delete(req.loginRateLimitKey);
}

module.exports = {
  securityHeaders,
  csrfProtection,
  issueCsrfToken,
  loginRateLimit,
  recordLoginFailure,
  clearLoginFailures
};
```

- [ ] **Step 3: Wire security middleware in `server/index.js`**

Place `securityHeaders` before static files and JSON parsing, and place `csrfProtection` after `session(...)`:

```javascript
const { securityHeaders, csrfProtection, issueCsrfToken } = require('./security');
const { requireAuth } = require('./auth');

app.use(securityHeaders);
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());
app.use(session({ /* keep existing options */ }));
app.use(csrfProtection);
app.get('/api/csrf-token', requireAuth, issueCsrfToken);
```

- [ ] **Step 4: Regenerate session on successful login**

In `apps/mdm-platform/server/routes/org.js`, wrap successful login with `req.session.regenerate(...)`:

```javascript
router.post('/login', loginRateLimit, (req, res) => {
  const { employee_no, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE employee_no=?').get(employee_no);
  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(req);
    return res.status(401).json({ error: '工号或密码错误' });
  }

  req.session.regenerate(error => {
    if (error) return res.status(500).json({ error: '登录失败' });
    clearLoginFailures(req);
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.userName = user.name;
    req.session.departmentId = user.department_id;
    res.json({ id: user.id, name: user.name, role: user.role });
  });
});
```

- [ ] **Step 5: Add CSRF token handling to frontend API calls**

In `apps/mdm-platform/public/index.html`, centralize fetch calls through an `apiFetch` helper. The helper loads `/api/csrf-token` once after login/session restoration and attaches `X-CSRF-Token` to unsafe methods.

Expected behavior:

- GET requests do not require a token.
- POST, PUT, PATCH, and DELETE requests after login include the token.
- Login itself is not blocked by CSRF.

- [ ] **Step 6: Verify security foundation**

Run:

```powershell
cd apps/mdm-platform
npm run test:security
npm run test:frontend
```

Expected: both commands pass.

- [ ] **Step 7: Commit**

Run:

```powershell
git add apps/mdm-platform/server/security.js apps/mdm-platform/server/index.js apps/mdm-platform/server/routes/org.js apps/mdm-platform/public/index.html apps/mdm-platform/scripts/test-security-routes.js apps/mdm-platform/scripts/test-frontend-assets.js
git commit -m "fix: add mdm http security controls"
```

---

## Task 3: Password Lifecycle And Sensitive UI Output

**Files:**
- Modify: `apps/mdm-platform/server/passwordPolicy.js`
- Modify: `apps/mdm-platform/server/routes/org.js`
- Modify: `apps/mdm-platform/public/index.html`
- Modify: `apps/mdm-platform/scripts/test-security-routes.js`
- Modify: `apps/mdm-platform/scripts/test-user-password-scripts.js`
- Modify: `apps/mdm-platform/scripts/test-password-audit.js`
- Modify: `apps/mdm-platform/scripts/audit-fixed-default-passwords.js`

- [ ] **Step 1: Change tests to reject fixed initial passwords**

Update tests so they assert:

- Creating a user without a password returns a random `initial_password` that is not `000000` and not `init1234`.
- Resetting a user password returns a new random `initial_password`.
- Creating or resetting with a supplied password returns `400`.
- Self-service password change rejects `000000`, `init1234`, the employee number, and passwords shorter than 10 characters.
- No frontend toast includes `initial_password`.

Run:

```powershell
cd apps/mdm-platform
npm run test:security
npm run test:user-password-scripts
npm run test:password-audit
```

Expected: FAIL before implementation.

- [ ] **Step 2: Replace fixed password policy**

Implement `passwordPolicy.js` with these exported concepts:

```javascript
const crypto = require('crypto');

const REJECTED_KNOWN_PASSWORDS = new Set(['000000', 'init1234']);

function generateInitialPassword() {
  return crypto.randomBytes(12).toString('base64url');
}

function isRejectedKnownPassword(password) {
  return REJECTED_KNOWN_PASSWORDS.has(String(password || ''));
}

function validatePasswordStrength(password, user = {}) {
  const value = String(password || '');
  if (value.length < 10) return '新密码至少 10 位';
  if (isRejectedKnownPassword(value)) return '不能使用固定默认口令';
  if (user.employee_no && value.toLowerCase().includes(String(user.employee_no).toLowerCase())) {
    return '新密码不能包含工号';
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return '新密码必须同时包含字母和数字';
  }
  return null;
}

function resolveInitialPassword(password) {
  if (password) return { error: '初始密码由系统随机生成' };
  const initialPassword = generateInitialPassword();
  return { password: initialPassword, initialPassword, mustChangePassword: 1 };
}

module.exports = {
  generateInitialPassword,
  isRejectedKnownPassword,
  validatePasswordStrength,
  resolveInitialPassword
};
```

- [ ] **Step 3: Update org routes to use the new policy**

In `routes/org.js`:

- Use `resolveInitialPassword(password)` for admin create/reset.
- Use `validatePasswordStrength(new_password, user)` for `/me/password`.
- Keep `must_change_password=1` after admin create/reset.
- Use only `must_change_password` to determine password status.

- [ ] **Step 4: Remove plaintext password Toast behavior**

In `public/index.html`, replace `showToast(... initial_password ...)` with:

- A neutral success toast without the password.
- A focused one-time password panel or modal that is rendered only from the create/reset response.
- No storage of the password in global `state`, localStorage, URL, or logs.

- [ ] **Step 5: Verify password lifecycle**

Run:

```powershell
cd apps/mdm-platform
npm run test:security
npm run test:user-password-scripts
npm run test:password-audit
npm run test:frontend
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/mdm-platform/server/passwordPolicy.js apps/mdm-platform/server/routes/org.js apps/mdm-platform/public/index.html apps/mdm-platform/scripts/test-security-routes.js apps/mdm-platform/scripts/test-user-password-scripts.js apps/mdm-platform/scripts/test-password-audit.js apps/mdm-platform/scripts/audit-fixed-default-passwords.js
git commit -m "fix: replace fixed initial passwords"
```

---

## Task 4: RBAC-Only Write Boundaries

**Files:**
- Modify: `apps/mdm-platform/server/auth.js`
- Modify: `apps/mdm-platform/server/routes/mappings.js`
- Modify: `apps/mdm-platform/server/routes/person.js`
- Modify: `apps/mdm-platform/server/routes/product.js`
- Modify: `apps/mdm-platform/server/routes/productFamily.js`
- Modify: `apps/mdm-platform/server/routes/orgUnit.js`
- Modify: `apps/mdm-platform/server/routes/position.js`
- Modify: `apps/mdm-platform/server/routes/classNode.js`
- Modify: `apps/mdm-platform/server/routes/attribute.js`
- Modify: `apps/mdm-platform/scripts/audit-route-write-permissions.js`
- Modify: `apps/mdm-platform/scripts/test-route-write-audit.js`
- Modify: `apps/mdm-platform/scripts/test-security-routes.js`

- [ ] **Step 1: Expand route write audit expectations**

Update `audit-route-write-permissions.js` so every write route is either:

- `permissionGuarded` with a concrete permission code.
- `businessGuarded` with a route-specific reason.
- `integrationGuarded` for API-key flows.
- `publicOrSelfService` only for login/logout/self-password.

Run:

```powershell
cd apps/mdm-platform
npm run test:route-write-audit
```

Expected: FAIL if any master-data write route is still only `requireAuth`.

- [ ] **Step 2: Remove mapping admin fallback by legacy role**

In `routes/mappings.js`, replace any query equivalent to:

```sql
SELECT ... FROM users WHERE role='admin'
```

with an RBAC permission lookup through `getUserEffectivePermissions(userId)` or an existing helper that checks `admin:access`.

Expected behavior:

- Users with RBAC `admin` role can publish/reject/administer mappings.
- Users with only legacy `users.role='admin'` and no RBAC role do not receive hidden administrative privileges.

- [ ] **Step 3: Require permissions on master data writes**

Use `requirePermission(...)` on master-data write routes:

- `person:create`, `person:update`, `person:assign_position`
- `product:create`, `product:update`
- `product_family:create`, `product_family:update`
- `org_unit:create`, `org_unit:update`
- `position:create`, `position:update`
- `class_node:create`, `class_node:update`, `class_node:assign_member`
- `attribute:create`, `attribute:update`, `attribute_value:update`

Expected behavior: a logged-in `submitter` without the specific permission receives `403`.

- [ ] **Step 4: Keep legacy role only as login compatibility**

In `auth.js`, keep the current legacy fallback only for users with no explicit `user_roles`, and add comments/tests making clear it is compatibility during migration, not a separate authorization path for governance actions.

- [ ] **Step 5: Verify RBAC boundary**

Run:

```powershell
cd apps/mdm-platform
npm run test:route-write-audit
npm run test:security
npm run test:project-roles
npm run test:rbac
npm run test:mainline
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/mdm-platform/server/auth.js apps/mdm-platform/server/routes apps/mdm-platform/scripts/audit-route-write-permissions.js apps/mdm-platform/scripts/test-route-write-audit.js apps/mdm-platform/scripts/test-security-routes.js
git commit -m "fix: enforce rbac write boundaries"
```

---

## Task 5: Frontend XSS And Role Workbench Contract

**Files:**
- Modify: `apps/mdm-platform/public/index.html`
- Modify: `apps/mdm-platform/server/routes/roleWorkbench.js`
- Modify: `apps/mdm-platform/scripts/test-frontend-assets.js`
- Modify: `apps/mdm-platform/scripts/test-role-workbench-api.js`

- [ ] **Step 1: Add frontend asset tests for unsafe patterns**

Update `test-frontend-assets.js` to fail when:

- `onclick="selectUserForRoles(` appears in `index.html`.
- user-controlled values are interpolated directly inside an inline event handler.
- ECharts tooltip formatters return unescaped server text.

Run:

```powershell
cd apps/mdm-platform
npm run test:frontend
```

Expected: FAIL before implementation.

- [ ] **Step 2: Replace inline user picker handlers**

In `index.html`, render user search results with `data-user-id` and escaped text:

```javascript
function renderUserRoleSearchResult(user) {
  return `
    <button class="user-role-result" type="button" data-user-id="${escapeAttr(user.id)}">
      <span>${escapeHtml(user.name)}</span>
      <small>${escapeHtml(user.employee_no || '')}</small>
    </button>
  `;
}

document.addEventListener('click', event => {
  const button = event.target.closest('.user-role-result');
  if (!button) return;
  selectUserForRoles(Number(button.dataset.userId));
});
```

- [ ] **Step 3: Escape ECharts tooltip HTML**

Ensure every tooltip formatter that returns HTML wraps node labels and server-origin text with `escapeHtml` or the existing `safeText` helper.

Expected behavior: tooltip values render text, not executable HTML.

- [ ] **Step 4: Make role workbench modes distinct**

In `roleWorkbench.js`:

- `mode=todo` returns current user roles, current pending items, and at most the responsibility chains linked to pending work.
- `mode=all` returns all responsibility chains for the user's roles and includes non-pending role guide entries.

Test expectations:

- `GET /api/role-workbench?mode=todo` has fewer or equal responsibility nodes than `mode=all` when no all-mode filter is applied.
- `mode=todo` prioritizes pending items.
- `mode=all` includes role guide responsibilities even when no pending todos exist.

- [ ] **Step 5: Verify frontend and workbench**

Run:

```powershell
cd apps/mdm-platform
npm run test:frontend
npm run test:role-workbench
npm run test:project-roles
```

Expected: all commands pass.

- [ ] **Step 6: Commit**

Run:

```powershell
git add apps/mdm-platform/public/index.html apps/mdm-platform/server/routes/roleWorkbench.js apps/mdm-platform/scripts/test-frontend-assets.js apps/mdm-platform/scripts/test-role-workbench-api.js
git commit -m "fix: harden mdm frontend rendering"
```

---

## Task 6: Database Integrity And Conflict Workflow

**Files:**
- Modify: `apps/mdm-platform/server/db.js`
- Modify: `apps/mdm-platform/server/codeEngine.js`
- Modify: `apps/mdm-platform/server/routes/orgUnit.js`
- Modify: `apps/mdm-platform/server/routes/classNode.js`
- Modify: `apps/mdm-platform/server/routes/conflicts.js`
- Modify: `apps/mdm-platform/scripts/test-conflict-routes.js`
- Modify: `apps/mdm-platform/scripts/test-catalog-routes.js`
- Modify: `apps/mdm-platform/scripts/test-mainline-stability.js`

- [ ] **Step 1: Add failing integrity tests**

Add tests that assert:

- Moving an org unit under its own descendant returns `409`.
- Moving a class node under its own descendant returns `409`.
- A failed create after code generation does not duplicate the next successful code.
- `GET /api/conflicts` does not change escalation status or insert history records.
- `final-decide` and `resolve` both persist adopted conflict values consistently.
- Coordination completion is based on assigned participant count, not a hard-coded `2`.

Run:

```powershell
cd apps/mdm-platform
npm run test:catalog
npm run test:conflicts
npm run test:mainline
```

Expected: FAIL before implementation where audit findings still exist.

- [ ] **Step 2: Make code sequence reservation atomic**

In `codeEngine.js`, wrap sequence read/update in a `db.transaction(...)` and use one writer path for each code reservation.

Expected behavior: the sequence table cannot return the same number twice in concurrent calls from the same process.

- [ ] **Step 3: Add tree cycle guards**

In `orgUnit.js` and `classNode.js`, add a helper that walks ancestors before update:

```javascript
function wouldCreateCycle(table, idColumn, parentColumn, currentId, nextParentId) {
  let cursor = nextParentId;
  const seen = new Set([Number(currentId)]);
  while (cursor) {
    if (seen.has(Number(cursor))) return true;
    seen.add(Number(cursor));
    const row = db.prepare(`SELECT ${parentColumn} AS parent_id FROM ${table} WHERE ${idColumn}=?`).get(cursor);
    cursor = row && row.parent_id;
  }
  return false;
}
```

Use only hard-coded table and column names in each route, never user-supplied identifiers.

- [ ] **Step 4: Replace `SELECT *` table rebuild migrations**

In `db.js`, change migration rebuilds from `INSERT INTO new SELECT * FROM old` to explicit column lists:

```sql
INSERT INTO field_conflicts_new (
  id, field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a,
  submitter_b, value_b, dept_a, dept_b, severity, status, resolution,
  resolved_by, resolved_at, created_at
)
SELECT
  id, field_entry_a_id, field_entry_b_id, conflict_field, submitter_a, value_a,
  submitter_b, value_b, dept_a, dept_b, severity, status, resolution,
  resolved_by, resolved_at, created_at
FROM field_conflicts;
```

Use the actual current column list for each table in `db.js`.

- [ ] **Step 5: Add missing conflict foreign keys**

In `db.js`, add `REFERENCES field_conflicts(id)` or the correct conflict table reference for:

- `conflict_assignments.conflict_id`
- `conflict_coordination_history.conflict_id`

If existing SQLite migration constraints make direct alteration unsafe, rebuild the affected table with explicit columns and verify row counts before and after.

- [ ] **Step 6: Remove GET write side effects**

In `conflicts.js`, move automatic escalation writes out of list/read handlers. Expose an explicit POST endpoint or reuse the existing escalation endpoint for writes.

Expected behavior: GET requests are read-only.

- [ ] **Step 7: Verify DB and workflow integrity**

Run:

```powershell
cd apps/mdm-platform
npm run test:catalog
npm run test:conflicts
npm run test:mainline
```

Expected: all commands pass.

- [ ] **Step 8: Commit**

Run:

```powershell
git add apps/mdm-platform/server/db.js apps/mdm-platform/server/codeEngine.js apps/mdm-platform/server/routes/orgUnit.js apps/mdm-platform/server/routes/classNode.js apps/mdm-platform/server/routes/conflicts.js apps/mdm-platform/scripts/test-conflict-routes.js apps/mdm-platform/scripts/test-catalog-routes.js apps/mdm-platform/scripts/test-mainline-stability.js
git commit -m "fix: strengthen mdm data integrity"
```

---

## Task 7: Script Isolation And Boundary Cleanup

**Files:**
- Modify: `scripts/sync-process-governance-mainline.mjs`
- Modify: `apps/mdm-platform/scripts/sync-process-governance-org.js`
- Modify: `apps/mdm-platform/scripts/import-process-governance.js`
- Modify: `apps/mdm-platform/scripts/lib/processGovernanceImport.js`
- Modify: `scripts/check-dcm-bbm.mjs`
- Modify: `scripts/parse-sankey-data.mjs`
- Modify: `scripts/normalize-norms-sankey-h5.mjs`
- Modify: `scripts/merge_norms.py`
- Modify: `scripts/render_gantt_h5_png.mjs`
- Modify: `scripts/generate_digital_project_gantt_8k.py`
- Modify: `scripts/README.md`
- Modify: `apps/mdm-platform/scripts/test-process-governance-org-sync.js`
- Modify: `apps/mdm-platform/scripts/test-process-governance-import.js`
- Modify: `scripts/test-process-governance-mainline.mjs`

- [ ] **Step 1: Add failing tests for DB isolation and dry-run defaults**

Test expectations:

- `node scripts/sync-process-governance-mainline.mjs` fails when `MDM_DB_PATH` is missing.
- The same script succeeds when `MDM_DB_PATH` points to a temporary database.
- `sync-process-governance-org.js` prints planned archive changes by default and does not write archive updates unless `--archive-non-canonical` is passed.
- `normalize-norms-sankey-h5.mjs` does not write files unless `--write` is passed.
- `check-dcm-bbm.mjs` writes generated reports under `docs/reports/` by default.

Run:

```powershell
npm run test:process-governance-mainline
cd apps/mdm-platform
npm run test:process-governance
```

Expected: FAIL before implementation for the isolation assertions.

- [ ] **Step 2: Require explicit `MDM_DB_PATH` for root sync**

In `scripts/sync-process-governance-mainline.mjs`, add:

```javascript
const mdmDbPath = process.env.MDM_DB_PATH;
if (!mdmDbPath) {
  console.error('MDM_DB_PATH is required for process-governance sync; refusing to write the shared default database.');
  process.exit(1);
}
```

Pass `env: { ...process.env, MDM_DB_PATH: mdmDbPath }` to app-level npm steps.

- [ ] **Step 3: Make organization sync non-destructive by default**

In `sync-process-governance-org.js`, add options:

- `dryRun: true` by default when called from CLI.
- `archiveNonCanonical: false` by default.
- Archive writes run only when `--archive-non-canonical` is passed.

Expected behavior: the default CLI invocation reports what would change but does not archive departments.

- [ ] **Step 4: Decouple app import from source directory scanning**

Change app import to accept:

```powershell
node scripts/import-process-governance.js --snapshot ..\..\docs\company-sankey-data.json
```

Default behavior inside `apps/mdm-platform` should read a snapshot path, not scan `docs/norms/` or call root quality scripts.

- [ ] **Step 5: Move generated quality report default out of `docs/norms`**

In `scripts/check-dcm-bbm.mjs`, set default report output to:

```text
docs/reports/dcm-bbm-quality-report.md
```

Keep an explicit `--output docs/norms/_quality-report.md` override only for deliberate compatibility runs.

- [ ] **Step 6: Harden HTML replacement scripts**

In `parse-sankey-data.mjs`, fail unless exactly one `<script id="sankey-data" type="application/json">...</script>` block exists. In `normalize-norms-sankey-h5.mjs`, print changed paths by default and write only with `--write`.

- [ ] **Step 7: Remove hard-coded local paths**

Replace absolute Windows paths with:

- CLI arguments.
- `process.cwd()` or `import.meta.dirname` for Node scripts.
- `Path(__file__).resolve()` plus CLI arguments for Python scripts.
- Environment variables only when the variable is documented in `scripts/README.md`.

- [ ] **Step 8: Verify scripts**

Run:

```powershell
npm run test:process-governance-mainline
cd apps/mdm-platform
npm run test:process-governance
npm run test:db-path
```

Expected: all commands pass and no command writes `apps/mdm-platform/data/platform.db`.

- [ ] **Step 9: Commit**

Run:

```powershell
git add scripts apps/mdm-platform/scripts scripts/README.md
git commit -m "fix: isolate process governance scripts"
```

---

## Task 8: PMO Runtime Asset Separation

**Files:**
- Modify: `pmo/gantt-react/plugins/pmoDeliverablesPlugin.js`
- Modify: `pmo/scripts/smoke-plugin-endpoints.mjs`
- Modify: `pmo/scripts/smoke-writeback.mjs`
- Modify: `pmo/gantt-react/src/utils/deliverableFsApi.js` if response fields change
- Modify: `pmo/README.md` if runtime storage is documented
- Modify: `.gitignore` if `artifacts/` is not already ignored

- [ ] **Step 1: Add failing smoke assertions**

Update PMO smoke tests so uploads and runtime history are expected under:

```text
artifacts/pmo/deliverables/
```

and not under:

```text
pmo/deliverables/_history/
```

Run:

```powershell
cd pmo/gantt-react
npm run test:plugin
npm run test:writeback
```

Expected: FAIL before implementation if plugin still writes runtime history into versioned deliverables.

- [ ] **Step 2: Move runtime storage path**

In `pmoDeliverablesPlugin.js`, compute runtime root from an environment variable with a safe default:

```javascript
const runtimeRoot = process.env.PMO_DELIVERABLE_RUNTIME_DIR
  ? path.resolve(process.env.PMO_DELIVERABLE_RUNTIME_DIR)
  : path.resolve(process.cwd(), '..', '..', 'artifacts', 'pmo', 'deliverables');
```

Keep Markdown正本 updates in `pmo/deliverables/` only when the workflow intentionally edits the deliverable record. Uploaded originals and generated history files go to runtime storage.

- [ ] **Step 3: Document runtime contract**

Document:

- Runtime uploads are not source assets.
- `pmo/deliverables/` keeps controlled deliverable Markdown.
- `artifacts/pmo/deliverables/` can be cleaned after smoke tests.

- [ ] **Step 4: Verify PMO path separation**

Run:

```powershell
cd pmo/gantt-react
npm run test:plugin
npm run test:writeback
npm run build
```

Expected: all commands pass and `git status --short pmo/deliverables` does not show uploaded binary originals or runtime history.

- [ ] **Step 5: Commit**

Run:

```powershell
git add pmo/gantt-react/plugins/pmoDeliverablesPlugin.js pmo/scripts/smoke-plugin-endpoints.mjs pmo/scripts/smoke-writeback.mjs pmo/gantt-react/src/utils/deliverableFsApi.js pmo/README.md .gitignore
git commit -m "fix: separate pmo runtime deliverable assets"
```

---

## Task 9: Contracts Ownership And Engineering Source Gap

**Files:**
- Modify: `DIRECTORY_OWNERSHIP.md`
- Modify: `REPOSITORY_BOUNDARY.md` if source/snapshot/display wording needs clarification
- Modify: `MAINLINE_MAP.md` if process-governance chain needs clarification
- Modify: `docs/contracts/README.md`
- Create: `docs/norms/工程技术部部门-能力-流程-系统映射关系.md`
- Modify: `docs/reports/2026-06-11-engineering-source-manifest.md`
- Modify: `docs/reports/2026-06-11-norms-source-manifest.md`
- Modify generated snapshot files from `scripts/parse-sankey-data.mjs`

- [ ] **Step 1: Add docs/contracts ownership**

Update `DIRECTORY_OWNERSHIP.md` with:

```markdown
| `docs/contracts/` | 自动化校验合同 | 合同 README、JSON 合同 | 可修改校验规则和执行契约 | 不写业务流程正文，不替代 docs/norms 或 docs/organization |
```

Update `docs/contracts/README.md` so each contract lists:

- Consumer scripts.
- Inputs.
- Outputs.
- Required regression command.

- [ ] **Step 2: Prepare engineering source mapping file**

Create `docs/norms/工程技术部部门-能力-流程-系统映射关系.md` using approved engineering source material. The file must follow the same table and heading contract as other department mapping files.

Required source stance:

- Use process names and A1 behavior evidence from approved source materials.
- Leave unknown application landing as an explicit unknown field, not an evaluative system recommendation.
- Keep department-domain wording aligned to `docs/organization/组织架构和部门职责.md`.

- [ ] **Step 3: Regenerate process snapshot**

Run:

```powershell
node scripts/parse-sankey-data.mjs
```

Expected:

- `docs/company-sankey-data.json` includes 工程技术部 source records.
- `pmo/procedure-management/dashboard.html` embedded `#sankey-data` is updated by the parser.
- No hand-edited dashboard data is introduced.

- [ ] **Step 4: Run process governance checks**

Run:

```powershell
npm run test:dept-domain-mapping
npm run test:engineering-source-manifest
npm run test:norms-source-manifest
npm run test:process-governance-mainline
```

Expected: all commands pass. The cross-department completeness report no longer lists 工程技术部 as missing solely because the source file is absent.

- [ ] **Step 5: Commit**

Run:

```powershell
git add DIRECTORY_OWNERSHIP.md REPOSITORY_BOUNDARY.md MAINLINE_MAP.md docs/contracts/README.md docs/norms/工程技术部部门-能力-流程-系统映射关系.md docs/company-sankey-data.json pmo/procedure-management/dashboard.html docs/reports/2026-06-11-engineering-source-manifest.md docs/reports/2026-06-11-norms-source-manifest.md
git commit -m "docs: close engineering process source gap"
```

---

## Task 10: Final Regression And Audit Closure

**Files:**
- Create: `docs/reports/2026-06-16-audit-remediation-closure.md`
- Modify: none unless final documentation needs a precise command list

- [ ] **Step 1: Run full MDM regression**

Run:

```powershell
cd apps/mdm-platform
npm run test:frontend
npm run test:project-roles
npm run test:role-workbench
npm run test:process-governance
npm run test:mainline
npm run test:security
```

Expected: all commands pass.

- [ ] **Step 2: Run root process-governance regression**

Run:

```powershell
npm run test:process-governance-mainline
npm run test:dept-domain-mapping
npm run test:source-manifest-hashes
```

Expected: all commands pass.

- [ ] **Step 3: Run PMO regression**

Run:

```powershell
cd pmo/gantt-react
npm run test:plugin
npm run test:writeback
npm run test:frontmatter
npm run build
```

Expected: all commands pass.

- [ ] **Step 4: Record closure report**

Create `docs/reports/2026-06-16-audit-remediation-closure.md` with:

- Each audit critical/high item and its closing commit.
- Each medium/architecture item deferred beyond this plan, with reason and owner track.
- Exact verification commands and pass/fail result.
- Any residual risk that remains by design.

- [ ] **Step 5: Commit closure report**

Run:

```powershell
git add docs/reports/2026-06-16-audit-remediation-closure.md
git commit -m "docs: close audit remediation report"
```

---

## Acceptance Criteria

- All CRITICAL items in the audit are either fixed or explicitly downgraded with evidence in the closure report.
- All TOP 12 remediation directions are represented by a completed task in this plan.
- MDM security regression passes with isolated database usage.
- `roleWorkbench` `todo` and `all` modes are observably different and covered by tests.
- Root process-governance sync refuses to write without `MDM_DB_PATH`.
- Organization sync no longer archives non-canonical departments by default.
- MDM import consumes a snapshot/contract instead of app-locally scanning `docs/norms/`.
- PMO uploaded originals and runtime history do not land in versioned deliverable directories.
- `docs/contracts/` has explicit directory ownership.
- 工程技术部 process mapping source exists as a Markdown source file, and parser-generated dashboard data is refreshed from it.
- No generated quality report is written to `docs/norms/` by default.

## Deferred Architecture Cleanup

These items are real but should not block the P0-P4 remediation sequence:

- Split the 5300-line `apps/mdm-platform/public/index.html` into modules after security-sensitive rendering is fixed and covered by tests.
- Introduce explicit SQLite schema versioning after the immediate migration and foreign-key fixes are complete.
- Consolidate repeated `handleDbError` and `runDbAction` helpers after the route security work stabilizes.
- Rationalize root/app package scripts after script isolation prevents accidental shared DB writes.
- Add Python dependency locking after the path portability fixes identify the current script dependency set.

## Execution Recommendation

Use subagent-driven execution for Tasks 2 through 9, one task per subagent, with review after each task. Task 1 and Task 10 should run inline in the main session because they establish and close the shared verification record.
