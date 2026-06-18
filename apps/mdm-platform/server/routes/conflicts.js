const express = require('express');
const router = express.Router();
const {
  requireAuth,
  getUserByIdAsync,
  getUserEffectivePermissionsAsync
} = require('../auth');
const {
  conflictRepository,
  resetConflictRepositoryFactory,
  setConflictRepositoryFactory
} = require('../conflictMysqlRepository');

function handleDbError(res, error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

function sendRepositoryResult(res, result, successBody = { success: true }) {
  if (result && result.ok === false) {
    return res.status(result.statusCode || 400).json({ error: result.error || '操作失败' });
  }
  return res.json(successBody);
}

async function permissionSet(req) {
  if (!req.session || !req.session.userId) return new Set();
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet;
}

async function requestHasAnyPermission(req, permissionCodes) {
  const perms = await permissionSet(req);
  return perms.has('*:*') || permissionCodes.some(code => perms.has(code));
}

async function canViewAllConflicts(req) {
  return await requestHasAnyPermission(req, ['data:view_all', 'admin:access']);
}

async function canManageGeneralConflict(req) {
  return await requestHasAnyPermission(req, ['conflict:manage', 'review:approve', 'admin:access']);
}

async function canEscalateConflict(req) {
  return await requestHasAnyPermission(req, ['conflict:escalate', 'conflict:manage', 'review:approve', 'admin:access']);
}

async function canDecideEscalatedConflict(req) {
  return await requestHasAnyPermission(req, ['conflict:final_decide_escalated', 'review:approve', 'admin:access']);
}

async function conflictScope(req) {
  return {
    canViewAll: await canViewAllConflicts(req),
    userId: req.session.userId,
    departmentId: req.session.departmentId || null
  };
}

async function conflictActor(req, extra = {}) {
  return {
    actor_user_id: req.session.userId,
    actor_dept_id: req.session.departmentId || null,
    canManageAll: await requestHasAnyPermission(req, ['admin:access']),
    ...extra
  };
}

function conflictTypeFromQuery(req) {
  return req.query.type === 'term' ? 'term' : 'field';
}

router.get('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const result = await repo.listConflicts({
      type: req.query.type || null,
      severity: req.query.severity || null,
      status: req.query.status || null
    }, await conflictScope(req));
    return res.json(result);
  });
});

router.get('/stats', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    return res.json(await repo.conflictStats(await conflictScope(req)));
  });
});

router.post('/detect', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canManageGeneralConflict(req)) return res.status(403).json({ error: '权限不足' });
    const repo = await conflictRepository();
    return res.json(await repo.detectConflicts({
      field_name_cn: req.query.field_name_cn || null
    }, await conflictActor(req)));
  });
});

router.get('/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const conflict = await repo.getConflict(req.params.id, conflictTypeFromQuery(req), await conflictScope(req));
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    return res.json(conflict);
  });
});

router.post('/:id/assign', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canManageGeneralConflict(req)) return res.status(403).json({ error: '无冲突处理权限' });
    const repo = await conflictRepository();
    const assignee = await getUserByIdAsync(req.body && req.body.assignee_user_id);
    const result = await repo.assignConflict(req.params.id, conflictTypeFromQuery(req), await conflictActor(req, {
      assignee_user_id: req.body && req.body.assignee_user_id,
      assignee_dept_id: assignee ? assignee.department_id : null
    }));
    return sendRepositoryResult(res, result);
  });
});

router.put('/:id/assign', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canManageGeneralConflict(req)) return res.status(403).json({ error: '无冲突处理权限' });
    const repo = await conflictRepository();
    const assignee = await getUserByIdAsync(req.body && req.body.assignee_user_id);
    const result = await repo.reassignConflict(req.params.id, conflictTypeFromQuery(req), await conflictActor(req, {
      assignee_user_id: req.body && req.body.assignee_user_id,
      assignee_dept_id: assignee ? assignee.department_id : null
    }));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/coordination', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const result = await repo.submitCoordination(req.params.id, conflictTypeFromQuery(req), await conflictActor(req, {
      result: req.body && req.body.result,
      note: req.body && req.body.note
    }));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/final-decide', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const type = conflictTypeFromQuery(req);
    const conflict = await repo.getConflict(req.params.id, type, { canViewAll: true });
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status === 'escalated') {
      if (!await canDecideEscalatedConflict(req)) return res.status(403).json({ error: '无升级冲突处理权限' });
    } else if (!await canManageGeneralConflict(req)) {
      return res.status(403).json({ error: '无一般冲突处理权限' });
    }
    const result = await repo.finalDecideConflict(req.params.id, type, await conflictActor(req, {
      resolution: req.body && req.body.resolution,
      adopted_value: req.body && req.body.adopted_value
    }));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/escalate', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canEscalateConflict(req)) return res.status(403).json({ error: '无冲突升级权限' });
    const repo = await conflictRepository();
    const result = await repo.escalateConflict(req.params.id, conflictTypeFromQuery(req), await conflictActor(req));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/reopen', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canManageGeneralConflict(req) && !await canDecideEscalatedConflict(req)) {
      return res.status(403).json({ error: '无冲突重开权限' });
    }
    const repo = await conflictRepository();
    const result = await repo.reopenConflict(req.params.id, conflictTypeFromQuery(req), await conflictActor(req));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/archive', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await requestHasAnyPermission(req, ['admin:access'])) return res.status(403).json({ error: '仅管理员可归档' });
    const repo = await conflictRepository();
    const result = await repo.archiveConflict(req.params.id, conflictTypeFromQuery(req), await conflictActor(req));
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/resolve', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const conflict = await repo.getConflict(req.params.id, 'field', { canViewAll: true });
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status === 'escalated') {
      if (!await canDecideEscalatedConflict(req)) return res.status(403).json({ error: '无升级冲突处理权限' });
    } else if (!await canManageGeneralConflict(req)) {
      return res.status(403).json({ error: '无一般冲突处理权限' });
    }
    const result = await repo.resolveFieldConflict(req.params.id, await conflictActor(req, {
      resolution: req.body && req.body.resolution,
      adopted_value: req.body && req.body.adopted_value
    }));
    return sendRepositoryResult(res, result);
  });
});

router.post('/term/:id/resolve', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await conflictRepository();
    const conflict = await repo.getConflict(req.params.id, 'term', { canViewAll: true });
    if (!conflict) return res.status(404).json({ error: '冲突不存在' });
    if (conflict.status === 'escalated') {
      if (!await canDecideEscalatedConflict(req)) return res.status(403).json({ error: '无升级冲突处理权限' });
    } else if (!await canManageGeneralConflict(req)) {
      return res.status(403).json({ error: '无一般冲突处理权限' });
    }
    const result = await repo.resolveTermConflict(req.params.id, await conflictActor(req, {
      resolution: req.body && req.body.resolution
    }));
    return sendRepositoryResult(res, result);
  });
});

router.setConflictRepositoryFactory = setConflictRepositoryFactory;
router.resetConflictRepositoryFactory = resetConflictRepositoryFactory;

module.exports = router;
