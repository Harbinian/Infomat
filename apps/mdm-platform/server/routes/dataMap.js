const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message });
  }
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate entry'))) {
    return res.status(409).json({ error: '数据地图上下文已存在' });
  }
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleError(res, error));
}

async function canManageDataMap(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('admin:access') || permSet.has('*:*') || permSet.has('data:view_all');
}

async function canCreateOwnDepartmentContext(req, payload = {}) {
  if (await canManageDataMap(req)) return true;
  const { getUserRoleCodesAsync } = require('../auth');
  const roles = await getUserRoleCodesAsync(req.session.userId, req.session.userRole);
  const roleCodes = new Set((roles || []).map(role => role.code || role.role_code).filter(Boolean));
  if (req.session.userRole) roleCodes.add(req.session.userRole);
  const canCreate = roleCodes.has('submitter') || roleCodes.has('business_contact');
  if (!canCreate) return false;
  const sessionDeptId = Number(req.session.departmentId || 0);
  const requestedDeptId = Number(payload.dept_id || sessionDeptId || 0);
  return !!sessionDeptId && requestedDeptId === sessionDeptId;
}

router.get('/contexts', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const contexts = await repo.listContexts();
    if (await canManageDataMap(req)) return res.json(contexts);
    const departmentId = Number(req.session.departmentId || 0);
    const userId = Number(req.session.userId || 0);
    res.json(contexts.filter(context =>
      Number(context.dept_id || 0) === departmentId ||
      Number(context.owner_user_id || 0) === userId ||
      Number(context.created_by || 0) === userId
    ));
  });
});

router.post('/contexts', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canCreateOwnDepartmentContext(req, req.body)) {
      return res.status(403).json({ error: '无权创建数据地图上下文' });
    }
    if (!await canManageDataMap(req)) {
      req.body = { ...req.body, dept_id: req.session.departmentId };
    }
    const repo = await dataMapRepository();
    const context = await repo.createContext(req.body, req.session.userId);
    res.status(201).json(context);
  });
});

router.get('/contexts/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const context = await repo.getContext(req.params.id);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canManageDataMap(req)) {
      const departmentId = Number(req.session.departmentId || 0);
      const userId = Number(req.session.userId || 0);
      const canView = Number(context.dept_id || 0) === departmentId ||
        Number(context.owner_user_id || 0) === userId ||
        Number(context.created_by || 0) === userId;
      if (!canView) return res.status(403).json({ error: '无权查看该数据地图上下文' });
    }
    res.json(context);
  });
});

router.put('/contexts/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canManageDataMap(req)) {
      return res.status(403).json({ error: '无权维护数据地图上下文' });
    }
    const repo = await dataMapRepository();
    const context = await repo.updateContext(req.params.id, req.body, req.session.userId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    res.json(context);
  });
});

module.exports = router;
