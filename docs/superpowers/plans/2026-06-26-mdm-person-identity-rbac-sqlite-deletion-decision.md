# MDM Person Identity/RBAC SQLite Deletion Decision Package

Date: 2026-06-26

## Decision

Do not delete SQLite runtime, legacy `users`, legacy `user_roles`, or legacy department `*_user_id` fields in this repair round.

This package records the deletion evidence and the approval checkpoint. The code now has a migration rehearsal and stronger person-field write behavior, but the app still has active SQLite runtime entry points and several user-named API surfaces that need an explicit replacement plan.

## Current Proof

- `npm run test:person-identity-migration-rehearsal` passes.
- `npm run test:identity-mysql` passes.
- `npm run test:person-identity-rbac-completion` passes.
- The migration rehearsal covers:
  - legacy `users` to `person`;
  - one `user_accounts` record per person;
  - legacy `user_roles` to `person_roles`, including `assigned_by_person_id`;
  - department `manager_user_id` and `data_owner_user_id` copied into person responsibility fields during migration;
  - representative business records copied from `*_user_id`/legacy actor fields into `*_person_id` fields;
  - new department responsibility writes use explicit person fields and no longer copy legacy user IDs into person fields.

## Remaining SQLite Runtime Entry Points

- `apps/mdm-platform/server/db.js` is still the SQLite bootstrap and schema holder.
- Runtime modules still importing SQLite directly include:
  - `server/access.js`
  - `server/auth.js`
  - `server/codeEngine.js`
  - `server/integrationAuth.js`
  - route modules such as `org.js`, `roles.js`, `roleWorkbench.js`, `processGovernance.js`, `processDesign.js`, catalog/product/org-unit/person/position routes, and view routes.
- Operational scripts still importing `server/db` include:
  - local init/seed/setup/import scripts;
  - process governance import/sync scripts;
  - roster and project user setup scripts;
  - legacy smoke and route tests.

## Remaining Legacy Identity Compatibility Reads

- `identityMysqlRepository.js` still keeps compatibility reads for:
  - migration from `users`;
  - migration from `user_roles`;
  - fallback `getUserByEmployeeNo` / `getUserById`;
  - fallback role reads and role counts;
  - legacy user password create/update/reset paths.
- `auth.js` and `access.js` still read `users` / `user_roles` when `MDM_IDENTITY_READ_MODEL` is not `mysql`.
- `org.js`, `roles.js`, `roleWorkbench.js`, `processGovernance.js`, `processDesign.js`, and `importRbac.js` still have SQLite/user-role compatibility branches.

## Routes Still Exposing User Naming

- `/api/org/users`
- `/api/org/users/roles-summary`
- `/api/org/users/assignable`
- `/api/org/users/:id`
- `/api/org/users/:id/password`
- `/api/org/users/:id/roles`
- RBAC import/export language still includes `user_roles`, including the template filename.
- Frontend code still calls `/api/org/users*` for admin user management, role assignment, password reset, and conflict assignment.

## Tests To Rewrite Or Delete Before Deletion

- SQLite route tests using `legacyTestEnv` or `server/db`:
  - `test-org-route.js`
  - `test-security-routes.js`
  - `test-catalog-routes.js`
  - `test-conflict-routes.js`
  - `test-mapping-routes.js`
  - `test-process-design-api.js`
  - `test-role-workbench-api.js`
  - `test-product-routes.js`
  - `test-views-sankey-filters.js`
  - `smoke-rbac.js`
  - `smoke-test.js`
- User import/setup tests to migrate to person/account/person-role semantics:
  - `test-roster-users-import.js`
  - `test-user-password-scripts.js`
  - `test-local-baseline-setup.js`
  - `test-project-role-access.js`
- Guards to revise when deletion starts:
  - `test-no-new-user-identity-fields.js` currently allows legacy identity tables/fields as compatibility.
  - `test-legacy-identity-inventory.js` should become a deletion guard rather than a repair-round compatibility guard.

## Deletion Preconditions

- Replace `/api/org/users*` with person/account/person-role endpoints or formally keep the route names as compatibility wrappers backed only by person tables.
- Move RBAC import/export from `user_roles` to `person_roles`.
- Move roster/project setup scripts from `users` to `person` plus `user_accounts`.
- Remove SQLite fallback from auth, access, org, roles, roleWorkbench, processGovernance, and processDesign paths.
- Replace legacy route tests with MySQL/person fake repository tests.
- Confirm local startup contract always runs with MySQL identity read/write model.
- Capture live row counts before deletion:
  - `users`
  - `user_roles`
  - `person`
  - `user_accounts`
  - `person_roles`
  - every table with both legacy user and person fields.

## Proposed Deletion Sequence

1. Take a database backup and export identity/table counts.
2. Run the person identity migration and compare legacy counts against person/account/role counts.
3. Replace user-named runtime routes or turn them into person-backed compatibility wrappers.
4. Convert import/setup scripts to person/account/person-role writes.
5. Convert SQLite route tests to MySQL/person tests.
6. Run the full MDM verification suite.
7. Remove SQLite fallback imports from runtime modules.
8. Remove or archive `server/db.js` only after no runtime module imports it.
9. Drop legacy `users`, `user_roles`, `departments.manager_user_id`, `departments.data_owner_user_id`, and old business `*_user_id` columns only after a signed approval checkpoint.

## Rollback Sequence

1. Stop MDM service writes.
2. Restore the pre-deletion database backup.
3. Revert the deletion commit or switch back to the last compatibility branch.
4. Re-enable the previous startup environment and identity read model.
5. Run login, role workbench, RBAC, process governance, and mainline smoke tests before reopening the service.

## Approval Checkpoint

Deletion requires explicit user approval after reviewing:

- the migration rehearsal result;
- live row-count comparison;
- replacement route list;
- rewritten test list;
- backup location and rollback owner;
- business acceptance that old `users` / `user_roles` naming can be removed or retained only as wrappers.
