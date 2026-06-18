const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { getEffectiveRoleCodesAsync } = require('../access');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message });
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

async function canMaintainIdentity(req, field, identity, context) {
  if (await isAdmin(req)) return true;
  if (identity && Number(identity.owner_user_id || 0) === Number(req.session.userId || 0)) return true;
  const roleCodes = await getEffectiveRoleCodesAsync(req);
  return roleCodes.has('owner') && Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function fieldScope(repo, fieldId) {
  const field = await repo.getField(fieldId);
  if (!field) return { field: null, context: null };
  return { field, context: await repo.getContext(field.context_id) };
}

router.get('/field/:fieldEntryId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const identity = await repo.getFieldIdentity(req.params.fieldEntryId);
    res.json(identity || {});
  });
});

router.put('/:fieldEntryId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const existing = await repo.getFieldIdentity(req.params.fieldEntryId);
    if (!await canMaintainIdentity(req, field, existing, context)) {
      return res.status(403).json({ error: '仅字段 owner、本部门 owner 或管理员可维护黄金源信息' });
    }
    res.json(await repo.upsertFieldIdentity(req.params.fieldEntryId, req.body));
  });
});

router.post('/:fieldEntryId/confirm', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const existing = await repo.getFieldIdentity(req.params.fieldEntryId);
    if (!existing) return res.status(404).json({ error: '字段身份不存在' });
    if (!await canMaintainIdentity(req, field, existing, context)) {
      return res.status(403).json({ error: '仅字段 owner、本部门 owner 或管理员可确认权威系统' });
    }
    const identity = await repo.confirmFieldIdentity(req.params.fieldEntryId, req.body, req.session.userId);
    if (!identity) return res.status(404).json({ error: '字段身份不存在' });
    res.json({ success: true, identity });
  });
});

module.exports = router;
