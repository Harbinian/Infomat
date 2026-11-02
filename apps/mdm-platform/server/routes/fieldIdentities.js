const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');

function handleError(res, error) {
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message,code:error.code });
  if (sendMysqlUnavailable(res, error)) return;
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  logRequestFailure(res, error);
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
  return !permissions.has('identity:manage-account') && permissions.has('governance:draft-department') &&
    Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function canConfirmIdentity(req, context) {
  const permissions = await permissionSet(req);
  return !permissions.has('identity:manage-account') && permissions.has('governance:review-department') &&
    Number(context && context.dept_id || 0) === Number(req.session.departmentId || 0);
}

async function fieldScope(repo, fieldId) {
  const field = await repo.getFieldScope(fieldId);
  if (!field) return { field: null, context: null };
  return { field, context: await repo.getContextScope(field.context_id) };
}

router.get('/field/:fieldEntryId', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    if (!await canViewIdentity(req, context)) return res.status(403).json({ error: '无权查看该字段身份' });
    const identity = await repo.getFieldIdentity(req.params.fieldEntryId,req.query);
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
    if (!await canMaintainIdentity(req, context)) {
      return res.status(403).json({ error: '只能由部门主对接人维护本部门黄金源信息' });
    }
    res.json(await repo.identityGovernance().mutate(req.params.fieldEntryId, req.body, { personId: req.session.userId, departmentId: req.session.departmentId, contextId: context.id }, 'maintain'));
  });
});

router.post('/:fieldEntryId/confirm', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await dataMapRepository();
    const { field, context } = await fieldScope(repo, req.params.fieldEntryId);
    if (!field) return res.status(404).json({ error: '字段不存在' });
    if (!await canConfirmIdentity(req, context)) {
      return res.status(403).json({ error: '只能由部门MDM审核员确认本部门权威系统' });
    }
    const identity = await repo.identityGovernance().mutate(req.params.fieldEntryId, req.body, { personId: req.session.userId, departmentId: req.session.departmentId, contextId: context.id }, 'confirm');
    if (!identity) return res.status(404).json({ error: '字段身份不存在' });
    res.json({ success: true, identity });
  });
});

module.exports = router;
