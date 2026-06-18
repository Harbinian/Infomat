const express = require('express');
const router = express.Router();
const {
  requireAuth,
  getDepartmentByIdAsync,
  getUserEffectivePermissionsAsync,
  getUserRoleCodesAsync
} = require('../auth');
const {
  mappingRepository,
  resetMappingRepositoryFactory,
  setMappingRepositoryFactory
} = require('../mappingMysqlRepository');

function handleDbError(res, error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_DUP_ENTRY') || code.startsWith('ER_NO_REFERENCED_ROW') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAsyncAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

function sendRepositoryResult(res, result, successBody = { success: true }) {
  if (result && result.ok === false) {
    return res.status(result.statusCode || 400).json({ error: result.error || '操作失败' });
  }
  return res.json(successBody);
}

async function permissionSet(userId) {
  const { permSet } = await getUserEffectivePermissionsAsync(userId);
  return permSet;
}

async function hasAdminAccess(userId) {
  const perms = await permissionSet(userId);
  return perms.has('admin:access') || perms.has('*:*');
}

async function hasGlobalView(userId) {
  const perms = await permissionSet(userId);
  return perms.has('data:view_all') || perms.has('admin:access') || perms.has('*:*');
}

async function canCreateMappingDraft(req) {
  if (!req.session || !req.session.userId) return false;
  if (await hasAdminAccess(req.session.userId)) return true;
  if (req.session.userRole === 'submitter') return true;
  const roles = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  return roles.some(role => (role.code || role.role_code) === 'submitter');
}

async function mappingScope(req) {
  const department = await getDepartmentByIdAsync(req.session.departmentId);
  return {
    canViewAll: await hasGlobalView(req.session.userId),
    userId: req.session.userId,
    departmentId: req.session.departmentId || null,
    departmentName: department ? department.name : null
  };
}

router.get('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.listMappings(
      { status: req.query.status || null, dept_id: req.query.dept_id || null },
      await mappingScope(req)
    );
    return res.json(result);
  });
});

router.get('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, await mappingScope(req));
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    return res.json(mapping);
  });
});

router.post('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await canCreateMappingDraft(req)) {
      return res.status(403).json({ error: '仅报送人或管理员可创建映射草稿' });
    }
    const repo = await mappingRepository();
    const created = await repo.createMapping(req.body || {}, req.session.userId);
    return res.json({ id: created.id });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const existing = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!existing) return res.status(404).json({ error: '映射不存在' });
    if (existing.submitted_by !== req.session.userId && !await hasAdminAccess(req.session.userId)) {
      return res.status(403).json({ error: '仅创建人或管理员可修改草稿' });
    }
    const updated = await repo.updateMapping(req.params.id, req.body || {}, req.session.userId);
    return sendRepositoryResult(res, updated);
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const existing = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!existing) return res.status(404).json({ error: '映射不存在' });
    if (existing.submitted_by !== req.session.userId && !await hasAdminAccess(req.session.userId)) {
      return res.status(403).json({ error: '仅创建人或管理员可删除草稿' });
    }
    const result = await repo.deleteMapping(req.params.id, req.session.userId);
    if (!result.deleted && result.reason === 'status') {
      return res.status(400).json({ error: '只能删除草稿状态' });
    }
    if (!result.deleted) return res.status(404).json({ error: '映射不存在' });
    return res.json({ success: true });
  });
});

router.post('/:id/submit', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.submitMapping(req.params.id, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/review', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const { step, action, opinion } = req.body || {};
    const repo = await mappingRepository();
    const result = await repo.reviewMapping(req.params.id, {
      step,
      action,
      opinion,
      actor_user_id: req.session.userId,
      actor_dept_id: req.session.departmentId || null,
      canManageAll: await hasAdminAccess(req.session.userId)
    });
    if (result && result.ok === false) {
      return res.status(result.statusCode || 400).json({ error: result.error || '操作失败' });
    }
    if (result && result.blocked) {
      return res.json({ success: true, blocked: true, reason: result.reason || '存在未解决的 error 冲突，需先解决冲突' });
    }
    if (result && result.waiting) {
      return res.json({ success: true, waiting: true, reason: '当前节点仍有其他并行审核任务未完成' });
    }
    return res.json({ success: true });
  });
});

router.post('/:id/publish', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await hasAdminAccess(req.session.userId)) return res.status(403).json({ error: '仅信息化项目组可发布' });
    const repo = await mappingRepository();
    const result = await repo.publishMapping(req.params.id, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/reject', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.rejectMapping(req.params.id, req.body || {}, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.get('/:id/rejection-details', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.getRejectionDetails(req.params.id, await mappingScope(req));
    return res.json(result);
  });
});

router.setMappingRepositoryFactory = setMappingRepositoryFactory;
router.resetMappingRepositoryFactory = resetMappingRepositoryFactory;

module.exports = router;
