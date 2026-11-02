const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) {
    return res.status(error.statusCode).json({ error: error.message,code:error.code });
  }
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate entry'))) {
    return res.status(409).json({ error: '数据地图上下文已存在' });
  }
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  if (sendMysqlUnavailable(res, error)) return;
  logRequestFailure(res, error);
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
    const global=await canViewAllDataMap(req),own=await canViewOwnDepartmentDataMap(req);
    if(!global&&!own)return res.status(403).json({error:'无权查看数据地图'});
    const repo=await dataMapRepository(),contexts=await repo.listContexts(req.query);
    res.json(global?contexts:contexts.filter(context=>String(context.dept_id||'')===String(req.session.departmentId||'')));
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
    const repo=await dataMapRepository(),scope=await repo.getContextScope(req.params.id);
    if(!scope)return res.status(404).json({error:'数据地图上下文不存在'});
    if(!await canViewAllDataMap(req)&&(!await canViewOwnDepartmentDataMap(req)||String(scope.dept_id)!==String(req.session.departmentId)))return res.status(403).json({error:'无权查看该数据地图上下文'});
    const context=await repo.getContext(req.params.id,req.query);
    if(!context)return res.status(404).json({error:'数据地图上下文不可用',code:'HANDOFF_REFERENCE_UNAVAILABLE'});
    res.json(context);
  });
});

router.put('/contexts/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const existing = await repo.getContextScope(req.params.id);
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
