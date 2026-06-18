const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth');
const {
  auditRepository,
  resetAuditRepositoryFactory,
  setAuditRepositoryFactory
} = require('../auditMysqlRepository');

function handleDbError(res, error) {
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
    return res.json(await repo.listEntityVersions(req.params.type, req.params.id));
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
