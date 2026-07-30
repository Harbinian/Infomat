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

async function canViewAllDataMap(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('governance:read-global');
}

async function canViewOwnDepartmentDataMap(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('governance:read-department') && Boolean(req.session.departmentId);
}

async function canDraftOwnDepartmentContext(req, payload = {}) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  if (!permSet.has('governance:draft-department')) return false;
  const sessionDeptId = Number(req.session.departmentId || 0);
  const requestedDeptId = Number(payload.dept_id || sessionDeptId || 0);
  return !!sessionDeptId && requestedDeptId === sessionDeptId;
}

router.get('/contexts', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const contexts = await repo.listContexts();
    if (await canViewAllDataMap(req)) return res.json(contexts);
    if (!await canViewOwnDepartmentDataMap(req)) return res.status(403).json({ error: '无权查看数据地图' });
    const departmentId = Number(req.session.departmentId || 0);
    res.json(contexts.filter(context => Number(context.dept_id || 0) === departmentId));
  });
});

router.post('/contexts', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!await canDraftOwnDepartmentContext(req, req.body)) {
      return res.status(403).json({ error: '无权创建数据地图上下文' });
    }
    req.body = { ...req.body, dept_id: req.session.departmentId };
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
    if (!await canViewAllDataMap(req)) {
      const departmentId = Number(req.session.departmentId || 0);
      const canView = await canViewOwnDepartmentDataMap(req) &&
        Number(context.dept_id || 0) === departmentId;
      if (!canView) return res.status(403).json({ error: '无权查看该数据地图上下文' });
    }
    res.json(context);
  });
});

router.put('/contexts/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const existing = await repo.getContext(req.params.id);
    if (!existing) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canDraftOwnDepartmentContext(req, { dept_id: existing.dept_id })) {
      return res.status(403).json({ error: '只能维护本人部门的数据地图上下文' });
    }
    const context = await repo.updateContext(req.params.id, req.body, req.session.userId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    res.json(context);
  });
});

module.exports = router;
