const express = require('express');
const mysql = require('mysql2/promise');
const router = express.Router();
const {
  requireAuth,
  getDepartmentByIdAsync,
  getUserEffectivePermissionsAsync
} = require('../auth');
const {
  mappingRepository,
  resetMappingRepositoryFactory,
  setMappingRepositoryFactory
} = require('../mappingMysqlRepository');
const { makeGovernanceAccessMysqlRepository } = require('../governanceAccessMysqlRepository');
const { mysqlConfigFromEnv } = require('../mysqlConfig');

let governanceRepositoryPromise = null;
let governanceRepositoryFactory = null;

async function governanceRepository() {
  if (governanceRepositoryFactory) return await governanceRepositoryFactory();
  if (!governanceRepositoryPromise) {
    governanceRepositoryPromise = Promise.resolve(
      makeGovernanceAccessMysqlRepository(mysql.createPool(mysqlConfigFromEnv()))
    );
  }
  return await governanceRepositoryPromise;
}

function handleDbError(res, error) {
  const code = String(error && error.code || '');
  const message = String(error && error.message || '');
  if (code.startsWith('ER_DUP_ENTRY') || code.startsWith('ER_NO_REFERENCED_ROW') || message.includes('constraint')) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAsyncAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

function sendRepositoryResult(res, result, successBody = { success: true }) {
  if (result && result.ok === false) {
    return res.status(result.statusCode || 400).json({ error: result.error || '操作失败' });
  }
  return res.json(successBody);
}

async function permissionSet(userId) {
  const { permSet } = await getUserEffectivePermissionsAsync(userId);
  return permSet;
}

async function hasPermission(userId, permissionCode) {
  const perms = await permissionSet(userId);
  return perms.has(permissionCode);
}

async function hasGlobalView(userId) {
  return await hasPermission(userId, 'governance:read-global');
}

async function canCreateMappingDraft(req) {
  if (!req.session || !req.session.userId) return false;
  return await hasPermission(req.session.userId, 'governance:draft-department') &&
    Boolean(req.session.departmentId);
}

function mappingBelongsToDepartment(mapping, departmentId) {
  if (!mapping || !departmentId) return false;
  if (Number(mapping.owner_dept_id || 0) === Number(departmentId)) return true;
  return (mapping.relatedDepts || []).some(item => Number(item.department_id || 0) === Number(departmentId));
}

async function mappingScope(req) {
  const department = await getDepartmentByIdAsync(req.session.departmentId);
  const canViewAll = await hasGlobalView(req.session.userId);
  const canViewDepartment = await hasPermission(req.session.userId, 'governance:read-department');
  return {
    canViewAll,
    userId: canViewAll || canViewDepartment ? req.session.userId : 0,
    departmentId: canViewDepartment ? req.session.departmentId || null : null,
    departmentName: department ? department.name : null
  };
}

router.get('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.listMappings(
      { status: req.query.status || null, dept_id: req.query.dept_id || null },
      await mappingScope(req)
    );
    return res.json(result);
  });
});

router.get('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, await mappingScope(req));
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    return res.json(mapping);
  });
});

router.post('/', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await canCreateMappingDraft(req)) {
      return res.status(403).json({ error: '只有部门主对接人可以创建本部门映射草稿' });
    }
    const repo = await mappingRepository();
    const created = await repo.createMapping({
      ...(req.body || {}),
      owner_dept_id: req.session.departmentId,
      approval_dept_id: req.session.departmentId,
      actor_person_id: req.session.personId || req.session.userId
    }, req.session.userId);
    return res.json({ id: created.id });
  });
});

router.put('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const existing = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!existing) return res.status(404).json({ error: '映射不存在' });
    if (!await canCreateMappingDraft(req) || Number(existing.owner_dept_id || 0) !== Number(req.session.departmentId || 0)) {
      return res.status(403).json({ error: '部门主对接人只能修改本部门草稿' });
    }
    const updated = await repo.updateMapping(req.params.id, {
      ...(req.body || {}),
      owner_dept_id: req.session.departmentId,
      approval_dept_id: req.session.departmentId
    }, req.session.userId);
    return sendRepositoryResult(res, updated);
  });
});

router.delete('/:id', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const existing = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!existing) return res.status(404).json({ error: '映射不存在' });
    if (!await canCreateMappingDraft(req) || Number(existing.owner_dept_id || 0) !== Number(req.session.departmentId || 0)) {
      return res.status(403).json({ error: '部门主对接人只能删除本部门草稿' });
    }
    const result = await repo.deleteMapping(req.params.id, req.session.userId);
    if (!result.deleted && result.reason === 'status') {
      return res.status(400).json({ error: '只能删除草稿状态' });
    }
    if (!result.deleted) return res.status(404).json({ error: '映射不存在' });
    return res.json({ success: true });
  });
});

router.post('/:id/submit', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await hasPermission(req.session.userId, 'governance:submit-department')) {
      return res.status(403).json({ error: '无部门材料提交权限' });
    }
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!mapping || Number(mapping.owner_dept_id || 0) !== Number(req.session.departmentId || 0)) {
      return res.status(403).json({ error: '只能提交本部门映射草稿' });
    }
    const result = await repo.submitMapping(req.params.id, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/review', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const { step, action, opinion } = req.body || {};
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    const structureGate = Number(step) === 5 && await hasPermission(req.session.userId, 'governance:structure-gate');
    const departmentReview = Number(step) !== 5 &&
      await hasPermission(req.session.userId, 'governance:review-department') &&
      mappingBelongsToDepartment(mapping, req.session.departmentId);
    if (!structureGate && !departmentReview) {
      return res.status(403).json({ error: '无权处理当前审核节点' });
    }
    const result = await repo.reviewMapping(req.params.id, {
      step,
      action,
      opinion,
      actor_user_id: req.session.userId,
      actor_dept_id: req.session.departmentId || null,
      actor_person_id: req.session.personId || req.session.userId,
      canManageAll: structureGate
    });
    if (result && result.ok === false) {
      return res.status(result.statusCode || 400).json({ error: result.error || '操作失败' });
    }
    if (result && result.blocked) {
      return res.json({ success: true, blocked: true, reason: result.reason || '存在未解决的 error 冲突，需先解决冲突' });
    }
    if (result && result.waiting) {
      return res.json({ success: true, waiting: true, reason: '当前节点仍有其他并行审核任务未完成' });
    }
    return res.json({ success: true });
  });
});

router.post('/:id/publish', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    if (!await hasPermission(req.session.userId, 'governance:publish')) {
      return res.status(403).json({ error: '只有MDM工作组组长可以发布治理版本' });
    }
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, { canViewAll: true });
    if (!mapping) return res.status(404).json({ error: '映射不存在' });
    const departmentIds = [
      mapping.owner_dept_id,
      ...(mapping.relatedDepts || []).map(item => item.department_id)
    ];
    const responsibility = await (await governanceRepository()).getPublicationResponsibilityReadiness({
      subjectDomain: 'data',
      subjectType: 'mapping',
      subjectId: String(mapping.id),
      subjectVersion: 'current',
      departmentIds
    });
    if (!responsibility.ready) {
      return res.status(409).json({
        error: '责任链不完整，不能发布',
        code: 'RESPONSIBILITY_CHAIN_INCOMPLETE',
        responsibility
      });
    }
    const result = await repo.publishMapping(req.params.id, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.post('/:id/reject', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const mapping = await repo.getMapping(req.params.id, { canViewAll: true });
    if (
      !mapping ||
      !await hasPermission(req.session.userId, 'governance:review-department') ||
      !mappingBelongsToDepartment(mapping, req.session.departmentId)
    ) {
      return res.status(403).json({ error: '部门MDM审核员只能退回本部门相关映射' });
    }
    const result = await repo.rejectMapping(req.params.id, req.body || {}, req.session.userId);
    return sendRepositoryResult(res, result);
  });
});

router.get('/:id/rejection-details', requireAuth, (req, res) => {
  return runAsyncAction(res, async () => {
    const repo = await mappingRepository();
    const result = await repo.getRejectionDetails(req.params.id, await mappingScope(req));
    return res.json(result);
  });
});

router.setMappingRepositoryFactory = setMappingRepositoryFactory;
router.resetMappingRepositoryFactory = resetMappingRepositoryFactory;
router.setGovernanceRepositoryFactory = factory => {
  governanceRepositoryFactory = factory;
  governanceRepositoryPromise = null;
};
router.resetGovernanceRepositoryFactory = () => {
  governanceRepositoryFactory = null;
  governanceRepositoryPromise = null;
};

module.exports = router;
