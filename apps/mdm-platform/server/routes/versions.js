const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const {
  auditRepository,
  resetAuditRepositoryFactory,
  setAuditRepositoryFactory
} = require('../auditMysqlRepository');

function handleDbError(res, error) {
  if (sendMysqlUnavailable(res, error)) return;
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

router.get('/entity/:type/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    const versions = await repo.listEntityVersions(req.params.type, req.params.id);
    if ([...versions.logs, ...versions.changeSets].some(version => version.entity_type === 'todo')) {
      const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
      const global = permSet.has('governance:read-global');
      const department = permSet.has('governance:read-department') && req.session.departmentId;
      const visible = version => {
        if (version.entity_type !== 'todo') return true;
        if (global) return true;
        if (!department) return false;
        try {
          const metadata = typeof version.metadata_json === 'string' ? JSON.parse(version.metadata_json) : version.metadata_json;
          return metadata?.schema_version === 'todo-deletion-v1' && Number(metadata.todo?.to_dept_id) === Number(department);
        } catch { return false; }
      };
      return res.json({ ...versions, logs: versions.logs.filter(visible), changeSets: versions.changeSets.filter(visible) });
    }
    return res.json(versions);
  });
});

router.get('/mapping/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    return res.json(await repo.listMappingVersions(req.params.id));
  });
});

router.get('/field/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await auditRepository();
    return res.json(await repo.listFieldVersions(req.params.id));
  });
});

router.setAuditRepositoryFactory = setAuditRepositoryFactory;
router.resetAuditRepositoryFactory = resetAuditRepositoryFactory;

module.exports = router;
