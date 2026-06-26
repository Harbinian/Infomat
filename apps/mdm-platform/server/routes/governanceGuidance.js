const express = require('express');
const mysql = require('mysql2/promise');
const { requireAuth } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makeIdentityMysqlRepository } = require('../identityMysqlRepository');
const { makeGovernanceGuidanceMysqlRepository } = require('../governanceGuidanceMysqlRepository');

const router = express.Router();

let identityRepoPromise = null;
let identityRepositoryFactory = null;
let guidanceRepoPromise = null;
let guidanceRepositoryFactory = null;

function requestPersonId(req) {
  return req.session && (req.session.personId || req.session.userId) || null;
}

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

async function guidanceRepository() {
  if (guidanceRepositoryFactory) return await guidanceRepositoryFactory();
  if (!guidanceRepoPromise) {
    guidanceRepoPromise = (async () => {
      const pool = mysql.createPool(mysqlConfigFromEnv());
      const repo = makeGovernanceGuidanceMysqlRepository(pool);
      await repo.initSchema();
      return repo;
    })();
  }
  try {
    return await guidanceRepoPromise;
  } catch (error) {
    guidanceRepoPromise = null;
    throw error;
  }
}

function setIdentityRepositoryFactory(factory) {
  identityRepositoryFactory = factory;
  identityRepoPromise = null;
}

function resetIdentityRepositoryFactory() {
  identityRepositoryFactory = null;
  identityRepoPromise = null;
}

function setGuidanceRepositoryFactory(factory) {
  guidanceRepositoryFactory = factory;
  guidanceRepoPromise = null;
}

function resetGuidanceRepositoryFactory() {
  guidanceRepositoryFactory = null;
  guidanceRepoPromise = null;
}

function requireGuidancePermission(permCode) {
  return async (req, res, next) => {
    const personId = requestPersonId(req);
    if (!personId) return res.status(401).json({ error: '未登录' });
    try {
      const repo = await identityRepository();
      const { permSet, fieldConstraints } = await repo.getUserEffectivePermissions(personId);
      if (!permSet.has(permCode) && !permSet.has('*:*')) {
        return res.status(403).json({ error: '权限不足' });
      }
      req.effectivePermissions = permSet;
      req.effectiveFieldConstraints = fieldConstraints;
      return next();
    } catch (error) {
      console.error(error);
      return res.status(503).json({ error: '身份 MySQL 读取模型不可用' });
    }
  };
}

function sendGuidanceActionResult(res, result) {
  if (!result || result.updated === false) {
    if (result && result.reason === 'missing') return res.status(404).json({ error: '指导意见不存在' });
    if (result && result.reason === 'invalid_status') return res.status(409).json({ error: '当前状态不允许该操作' });
    if (result && result.reason === 'not_responsible') return res.status(403).json({ error: '不是当前责任人或授权处理人' });
    if (result && result.reason === 'delegate_out_of_scope') return res.status(403).json({ error: '代理授权范围不包含该事项' });
    if (result && result.reason === 'final_confirm_denied') return res.status(403).json({ error: '重大闭环需要最终响应责任人确认' });
    if (result && result.reason === 'missing_delegate') return res.status(400).json({ error: '缺少代理人' });
    return res.status(400).json({ error: '指导意见操作失败' });
  }
  return res.json({ success: true, status: result.status });
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const personId = requestPersonId(req);
    const identityRepo = await identityRepository();
    const { permSet } = await identityRepo.getUserEffectivePermissions(personId);
    const repo = await guidanceRepository();
    return res.json(await repo.listGuidanceForPerson(personId, permSet));
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见读取模型不可用' });
  }
});

router.post('/', requireAuth, requireGuidancePermission('guidance:create'), async (req, res) => {
  try {
    const {
      related_entity_type,
      related_entity_id,
      related_department_id,
      guidance_type,
      content,
      is_major,
      visibility_scope
    } = req.body || {};

    if (!related_entity_type || !related_entity_id || !content) {
      return res.status(400).json({ error: '缺少业务对象或指导意见内容' });
    }

    const repo = await guidanceRepository();
    const created = await repo.createGuidance({
      related_entity_type,
      related_entity_id,
      related_department_id: related_department_id || null,
      guidance_type: guidance_type || '指导',
      content,
      is_major: Boolean(is_major),
      visibility_scope: visibility_scope || 'department',
      created_by_person_id: requestPersonId(req),
      status: 'pending_response'
    });
    return res.status(201).json(created);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/respond', requireAuth, requireGuidancePermission('guidance:respond'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.respondGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/clarify', requireAuth, requireGuidancePermission('guidance:respond'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.clarifyGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/object', requireAuth, requireGuidancePermission('guidance:respond'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.objectGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/delegate', requireAuth, requireGuidancePermission('guidance:delegate'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.delegateGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.post('/:id/final-confirm', requireAuth, requireGuidancePermission('guidance:final_confirm'), async (req, res) => {
  try {
    const repo = await guidanceRepository();
    const result = await repo.finalConfirmGuidance(Number(req.params.id), requestPersonId(req), req.body || {});
    return sendGuidanceActionResult(res, result);
  } catch (error) {
    console.error(error);
    return res.status(503).json({ error: '指导意见写入模型不可用' });
  }
});

router.setIdentityRepositoryFactory = setIdentityRepositoryFactory;
router.resetIdentityRepositoryFactory = resetIdentityRepositoryFactory;
router.setGuidanceRepositoryFactory = setGuidanceRepositoryFactory;
router.resetGuidanceRepositoryFactory = resetGuidanceRepositoryFactory;

module.exports = router;
