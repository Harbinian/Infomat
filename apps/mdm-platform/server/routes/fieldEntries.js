const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { getEffectiveRoleCodesAsync } = require('../access');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate entry'))) {
    return res.status(409).json({ error: '字段已存在' });
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

async function isAdmin(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet.has('admin:access') || permSet.has('*:*');
}

async function canUseContext(req, context) {
  if (!context) return false;
  if (await isAdmin(req)) return true;
  const roleCodes = await getEffectiveRoleCodesAsync(req);
  const sameDepartment = Number(context.dept_id || 0) === Number(req.session.departmentId || 0);
  const ownsContext = Number(context.owner_user_id || 0) === Number(req.session.userId || 0);
  const createdContext = Number(context.created_by || 0) === Number(req.session.userId || 0);
  return createdContext || ownsContext || (sameDepartment && (roleCodes.has('owner') || roleCodes.has('submitter')));
}

async function canEditField(req, field, context) {
  if (await isAdmin(req)) return true;
  const roleCodes = await getEffectiveRoleCodesAsync(req);
  const sameDepartment = Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
  if (roleCodes.has('owner') && sameDepartment) return true;
  return roleCodes.has('submitter') && Number(field.submitted_by || 0) === Number(req.session.userId || 0);
}

function contextIdFromPayload(payload = {}) {
  return Number(payload.context_id || payload.mapping_id || 0);
}

router.get('/mapping/:contextId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const context = await repo.getContext(req.params.contextId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canUseContext(req, context)) return res.status(403).json({ error: '无权查看该字段台账' });
    res.json(await repo.getFieldsByContext(context.id));
  });
});

router.post('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const contextId = contextIdFromPayload(req.body);
    if (!contextId) return res.status(400).json({ error: '缺少 context_id' });
    const repo = await dataMapRepository();
    const context = await repo.getContext(contextId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canUseContext(req, context)) return res.status(403).json({ error: '无权维护该字段台账' });
    const field = await repo.createField({ ...req.body, context_id: contextId }, req.session.userId);
    res.json(field);
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const field = await repo.getField(req.params.id);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const context = await repo.getContext(field.context_id);
    if (!await canEditField(req, field, context)) {
      return res.status(403).json({ error: '仅字段报送人、本部门 owner 或管理员可修改字段' });
    }
    const updated = await repo.updateField(req.params.id, req.body, req.session.userId);
    if (!updated) return res.status(404).json({ error: '字段不存在' });
    res.json({ success: true, field: updated });
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const field = await repo.getField(req.params.id);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const context = await repo.getContext(field.context_id);
    if (!await canEditField(req, field, context)) {
      return res.status(403).json({ error: '仅字段报送人、本部门 owner 或管理员可删除字段' });
    }
    const deleted = await repo.deleteField(req.params.id, req.session.userId);
    if (!deleted) return res.status(404).json({ error: '字段不存在' });
    res.json({ success: true });
  });
});

module.exports = router;
