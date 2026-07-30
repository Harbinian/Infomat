const express = require('express');
const mysql = require('mysql2/promise');
const { requireAuth, requirePermission } = require('../auth');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { mysqlConfigFromEnv } = require('../mysqlConfig');

const router = express.Router();
let identityRepoPromise = null;
let identityRepositoryFactory = null;

async function identityRepository() {
  if (identityRepositoryFactory) return await identityRepositoryFactory();
  if (!identityRepoPromise) {
    identityRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeIdentityMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await identityRepoPromise;
  } catch (error) {
    identityRepoPromise = null;
    throw error;
  }
}

function handleError(res, error) {
  console.error(error);
  return res.status(503).json({
    error: '角色模型暂不可用',
    code: 'IDENTITY_ACCESS_SERVICE_UNAVAILABLE'
  });
}

function run(res, action) {
  return Promise.resolve().then(action).catch(error => handleError(res, error));
}

const canRead = [requireAuth, requirePermission('identity:read')];

router.get('/', ...canRead, (req, res) => run(res, async () => {
  const repo = await identityRepository();
  res.json(await repo.listRoles());
}));

router.get('/:id', ...canRead, (req, res) => run(res, async () => {
  const repo = await identityRepository();
  const role = await repo.getRoleDetail(Number(req.params.id));
  if (!role) return res.status(404).json({ error: '角色不存在', code: 'ROLE_NOT_FOUND' });
  res.json(role);
}));

router.get('/:id/permissions', ...canRead, (req, res) => run(res, async () => {
  const repo = await identityRepository();
  const payload = await repo.getRolePermissionMatrix(Number(req.params.id));
  if (!payload) return res.status(404).json({ error: '角色不存在', code: 'ROLE_NOT_FOUND' });
  res.json(payload);
}));

function readonlyModel(req, res) {
  return res.status(405).json({
    error: '核心角色和权限由固定治理模型维护，页面只提供查看',
    code: 'CORE_GOVERNANCE_MODEL_READ_ONLY'
  });
}

router.post('/', ...canRead, readonlyModel);
router.put('/:id', ...canRead, readonlyModel);
router.delete('/:id', ...canRead, readonlyModel);
router.put('/:id/permissions', ...canRead, readonlyModel);

router.setIdentityRepositoryFactory = factory => {
  identityRepositoryFactory = factory;
  identityRepoPromise = null;
};
router.resetIdentityRepositoryFactory = () => {
  identityRepositoryFactory = null;
  identityRepoPromise = null;
};

module.exports = router;
