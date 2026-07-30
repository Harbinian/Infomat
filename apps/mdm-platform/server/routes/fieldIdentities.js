const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
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

async function permissionSet(req) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  return permSet;
}

async function canViewIdentity(req, context) {
  const permissions = await permissionSet(req);
  if (permissions.has('governance:read-global')) return true;
  return permissions.has('governance:read-department') &&
    Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function canMaintainIdentity(req, context) {
  const permissions = await permissionSet(req);
  return permissions.has('governance:draft-department') &&
    Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function canConfirmIdentity(req, context) {
  const permissions = await permissionSet(req);
  return permissions.has('governance:review-department') &&
    Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function fieldScope(repo, fieldId) {
  const field = await repo.getField(fieldId);
  if (!field) return { field: null, context: null };
  return { field, context: await repo.getContext(field.context_id) };
}

router.get('/field/:fieldEntryId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    if (!await canViewIdentity(req, context)) return res.status(403).json({ error: '无权查看该字段身份' });
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
    if (!await canMaintainIdentity(req, context)) {
      return res.status(403).json({ error: '只能由部门主对接人维护本部门黄金源信息' });
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
    if (!await canConfirmIdentity(req, context)) {
      return res.status(403).json({ error: '只能由部门MDM审核员确认本部门权威系统' });
    }
    const identity = await repo.confirmFieldIdentity(req.params.fieldEntryId, req.body, req.session.userId);
    if (!identity) return res.status(404).json({ error: '字段身份不存在' });
    res.json({ success: true, identity });
  });
});

module.exports = router;
