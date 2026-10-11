// R01 entity-history scope policy.
//
// The history entries in routes/versions.js used to authorize by entity type ad hoc: four types
// required `governance:read-global`, `todo` was filtered after the query, and every other type --
// including `publication`, `mapping` and `field_entry` -- was returned in full to any
// authenticated caller. This module makes the policy explicit and closed.
//
// Policy outcomes:
//   global          the entity type is company-wide governance material; requires governance:read-global
//   todo-metadata   retained deletion records keep their per-row department filter
//   context/field   the owning department is resolved from the live data-map object
//   (unlisted)      no policy exists, so no history is ever returned for that type
//
// "Not visible" and "does not exist" must be indistinguishable to the caller: the route answers
// both with the same status and the same body. Old history rows are never deleted to close a gap.
const { identityInteger, sameIdentityInteger } = require('./sessionSubject');

const GLOBAL_READ = 'governance:read-global';
const DEPARTMENT_READ = 'governance:read-department';

const ENTITY_SCOPE_POLICIES = Object.freeze({
  // Company-wide governance material. These four already required global read.
  legacy_field_import: { kind: 'global' },
  terminology_term: { kind: 'global' },
  conflict_field: { kind: 'global' },
  conflict_term: { kind: 'global' },
  // Publication references are governance output and previously fell through to "allow all".
  publication: { kind: 'global' },
  // Retained deletion records keep the historical department filter.
  todo: { kind: 'todo-metadata' },
  // Data-map objects resolve their owning department from the live object.
  mapping: { kind: 'context' },
  field_entry: { kind: 'field' }
});

function policyFor(entityType) {
  const key = String(entityType || '');
  return Object.prototype.hasOwnProperty.call(ENTITY_SCOPE_POLICIES, key) ? ENTITY_SCOPE_POLICIES[key] : null;
}

// Resolve where an entity's history belongs. `executor` is the audit repository: the repository
// performs the lookup, this module decides what the result means.
async function resolveEntityScope(executor, entityType, entityId) {
  const policy = policyFor(entityType);
  if (!policy) return { kind: 'unlisted', departmentId: null, resolved: false };
  if (policy.kind === 'global') return { kind: 'global', departmentId: null, resolved: true };
  if (policy.kind === 'todo-metadata') return { kind: 'todo-metadata', departmentId: null, resolved: true };

  const read = policy.kind === 'field'
    ? executor.readFieldDepartment
    : executor.readContextDepartment;
  if (typeof read !== 'function') throw new Error('VERSION_SCOPE_RESOLVER_REQUIRED');
  const found = await read.call(executor, entityId);
  // A deleted or unreachable object has no verifiable retained attribution, so it is refused
  // instead of being treated as open. Guessing an owner from a name, a role or a default is
  // never allowed here.
  if (!found) return { kind: policy.kind, departmentId: null, resolved: false };
  return { kind: policy.kind, departmentId: identityInteger(found.departmentId), resolved: true };
}

function hasGlobalRead(permSet) {
  return Boolean(permSet) && typeof permSet.has === 'function' && permSet.has(GLOBAL_READ);
}

// Pure authorization decision. `scope` comes from resolveEntityScope.
function canReadEntityHistory({ permSet, sessionDepartmentId, scope }) {
  if (!scope) return false;
  if (scope.kind === 'global') return hasGlobalRead(permSet);
  // Retained todo records are authorized row by row: the caller always receives the entry, and
  // the per-row filter removes everything outside their scope. Refusing here instead would have
  // told a caller which ids exist, which is exactly what the filter is there to prevent.
  if (scope.kind === 'todo-metadata') return true;
  if (!scope.resolved) return false;
  if (hasGlobalRead(permSet)) return true;
  if (!permSet || typeof permSet.has !== 'function' || !permSet.has(DEPARTMENT_READ)) return false;
  return sameIdentityInteger(scope.departmentId, sessionDepartmentId);
}

// Shared response for every refusal so callers cannot separate "not visible" from "not found".
const DENIED_BODY = Object.freeze({ error: '审计记录不存在或不在当前可读取范围内' });

module.exports = {
  ENTITY_SCOPE_POLICIES,
  GLOBAL_READ,
  DEPARTMENT_READ,
  DENIED_BODY,
  policyFor,
  resolveEntityScope,
  canReadEntityHistory,
  hasGlobalRead
};
