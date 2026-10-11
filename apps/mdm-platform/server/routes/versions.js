const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const {
  canReadEntityHistory, resolveEntityScope, policyFor, DENIED_BODY, GLOBAL_READ, DEPARTMENT_READ
} = require('../versionAuditScope');
const { sameIdentityInteger } = require('../sessionSubject');
const { logRequestFailure, securityLog } = require('../securityLog');
const {
  auditRepository,
  resetAuditRepositoryFactory,
  setAuditRepositoryFactory
} = require('../auditMysqlRepository');

function handleDbError(res, error) {
  if (sendMysqlUnavailable(res, error)) return;
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  logRequestFailure(res, error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

// R01: one authorization path for all three history entries. Every entry resolves the entity's
// scope, decides with the same rule, and answers every refusal with the same status and body so
// a caller cannot tell "not visible" from "does not exist". An entity type with no policy never
// returns history at all.
async function authorizeEntityHistory(req, repo, entityType, entityId) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  const policy = policyFor(entityType);
  // The decision comes before the lookup wherever it can. A caller who can never be allowed must
  // not reach the database at all: a failed lookup would answer 503 where the policy says 404,
  // and that difference would tell the caller whether the object exists.
  if (policy.kind === 'global') return { allowed: getEffectiveGlobal(permSet), scope: { kind: 'global' } };
  if (policy.kind === 'todo-metadata') return { allowed: true, scope: { kind: 'todo-metadata' } };
  if (getEffectiveGlobal(permSet)) return { allowed: true, scope: { kind: policy.kind } };
  if (!permSet.has(DEPARTMENT_READ)) return { allowed: false, scope: null };
  const scope = await resolveEntityScope(repo, entityType, entityId);
  return {
    scope,
    allowed: canReadEntityHistory({ permSet, sessionDepartmentId: req.session.departmentId, scope })
  };
}

// Naming the global-read test keeps the "decide before you look" rule readable above.
function getEffectiveGlobal(permSet) {
  return Boolean(permSet) && typeof permSet.has === 'function' && permSet.has(GLOBAL_READ);
}

// Every refusal is recorded with the request's correlation id, and every refusal looks the same.
function denyEntityHistory(req, res) {
  securityLog(req).write({ event: 'access_denied', code: 'VERSION_HISTORY_DENIED', status: 404 });
  return res.status(404).json({ ...DENIED_BODY });
}

function visibleTodoRows(versions, permSet, departmentId) {
  const global = permSet.has(GLOBAL_READ);
  const department = permSet.has(DEPARTMENT_READ) && departmentId;
  const visible = version => {
    if (version.entity_type !== 'todo') return true;
    if (global) return true;
    if (!department) return false;
    try {
      const metadata = typeof version.metadata_json === 'string' ? JSON.parse(version.metadata_json) : version.metadata_json;
      return metadata?.schema_version === 'todo-deletion-v1' && sameIdentityInteger(metadata.todo?.to_dept_id, department);
    } catch { return false; }
  };
  return { ...versions, logs: versions.logs.filter(visible), changeSets: versions.changeSets.filter(visible) };
}

router.get('/entity/:type/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    const entityType = req.params.type;
    // An unlisted type has no scope policy, so the answer is the empty shape rather than a leak.
    if (!policyFor(entityType)) {
      return res.json({ changeSets: [], logs: [] });
    }
    const { allowed, scope } = await authorizeEntityHistory(req, repo, entityType, req.params.id);
    if (!allowed) return denyEntityHistory(req, res);
    const versions = await repo.listEntityVersions(entityType, req.params.id);
    if (scope.kind === 'todo-metadata' && [...versions.logs, ...versions.changeSets].some(version => version.entity_type === 'todo')) {
      const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
      return res.json(visibleTodoRows(versions, permSet, req.session.departmentId));
    }
    return res.json(versions);
  });
});

router.get('/mapping/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    const { allowed } = await authorizeEntityHistory(req, repo, 'mapping', req.params.id);
    if (!allowed) return denyEntityHistory(req, res);
    return res.json(await repo.listMappingVersions(req.params.id));
  });
});

router.get('/field/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    const { allowed } = await authorizeEntityHistory(req, repo, 'field_entry', req.params.id);
    if (!allowed) return denyEntityHistory(req, res);
    return res.json(await repo.listFieldVersions(req.params.id));
  });
});

router.setAuditRepositoryFactory = setAuditRepositoryFactory;
router.resetAuditRepositoryFactory = resetAuditRepositoryFactory;

module.exports = router;
