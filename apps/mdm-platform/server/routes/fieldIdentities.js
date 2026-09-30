const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message });
  if (sendMysqlUnavailable(res, error)) return;
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

for (const view of ['history', 'responsibility-options']) {
  router.get('/field/:fieldEntryId/' + view, requireAuth, (req, res) => runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    if (!await (view === 'history' ? canViewIdentity(req, context) : canMaintainIdentity(req, context))) return res.status(403).json({ error: '无权读取该字段信息' });
    res.json(view === 'history' ? await repo.identityGovernance().history(field.id, req.query.before) : await repo.identityGovernance().options(context));
  }));
}

router.put('/:fieldEntryId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    const existing = await repo.getFieldIdentity(req.params.fieldEntryId);
    if (!await canMaintainIdentity(req, context)) {
      return res.status(403).json({ error: '只能由部门主对接人维护本部门黄金源信息' });
    }
    // Maintenance cannot assert a reviewer decision through the upsert payload.
    // Existing confirmed records remain readable; confirmation has its own route.
    if (req.body.confirmed || String(req.body.status || '').trim() === 'confirmed') {
      return res.status(403).json({ error: '维护信息不能同时确认黄金源，请使用部门确认入口' });
    }
    if (existing && existing.owner_user_id && !existing.owner_person_id) {
      return res.status(409).json({ error: '历史负责人尚未关联人员，请先明确人员映射后再维护' });
    }
    res.json(await repo.identityGovernance().mutate(req.params.fieldEntryId, req.body, { personId: req.session.userId, departmentId: req.session.departmentId, contextId: context.id }, 'maintain'));
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
    const identity = await repo.identityGovernance().mutate(req.params.fieldEntryId, req.body, { personId: req.session.userId, departmentId: req.session.departmentId, contextId: context.id }, 'confirm');
    if (!identity) return res.status(404).json({ error: '字段身份不存在' });
    res.json({ success: true, identity });
  });
});

module.exports = router;
