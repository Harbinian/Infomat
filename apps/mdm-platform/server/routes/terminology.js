const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission, getDepartmentByIdAsync } = require('../auth');
const { hasGlobalViewAsync, validateAction } = require('../access');
const {
  resetTerminologyRepositoryFactory,
  setTerminologyRepositoryFactory,
  terminologyRepository
} = require('../terminologyMysqlRepository');

function handleDbError(res, error) {
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate entry'))) {
    return res.status(409).json({ error: '术语已存在' });
  }
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  console.error(error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

function normalizeProcessId(value) {
  if (value === undefined || value === null || value === '') return null;
  const processId = Number(value);
  if (!Number.isInteger(processId) || processId <= 0) return NaN;
  return processId;
}

function normalizeTermTypeCode(value) {
  const code = String(value || 'noun').trim();
  return code || 'noun';
}

async function terminologyScope(req, options = {}) {
  const canViewAll = options.canViewAll === undefined ? await hasGlobalViewAsync(req) : options.canViewAll;
  const department = await getDepartmentByIdAsync(req.session.departmentId);
  return {
    canViewAll,
    userId: req.session.userId,
    departmentId: req.session.departmentId || null,
    departmentName: department && department.name || req.session.departmentName || ''
  };
}

async function validateTermTypeCode(repo, res, code) {
  const termType = await repo.getTermType(code);
  if (termType) return true;
  res.status(400).json({ error: '术语类型不存在' });
  return false;
}

async function validateGovernableProcess(req, res, repo, processId) {
  if (Number.isNaN(processId)) {
    res.status(400).json({ error: '业务流程不合法' });
    return false;
  }
  if (!processId) {
    res.status(400).json({ error: '请选择本部门映射关系线上的业务流程' });
    return false;
  }

  const process = await repo.getProcess(processId, await terminologyScope(req, { canViewAll: false }));
  if (process) return true;

  if (!await repo.processExists(processId)) {
    res.status(400).json({ error: '业务流程不存在' });
    return false;
  }

  res.status(403).json({ error: '不能选择其他部门的业务流程' });
  return false;
}

router.get('/processes', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    res.json(await repo.listProcesses(await terminologyScope(req, { canViewAll: await hasGlobalViewAsync(req) })));
  });
});

router.get('/types', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    res.json(await repo.listTermTypes());
  });
});

router.get('/', requireAuth, (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    res.json(await repo.listTerms({
      status: req.query.status || '',
      ...await terminologyScope(req)
    }));
  });
});

router.post('/', requireAuth, requirePermission('governance:draft-department'), (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    const termTypeCode = normalizeTermTypeCode(req.body.term_type_code);
    if (!await validateTermTypeCode(repo, res, termTypeCode)) return;
    const normalizedProcessId = normalizeProcessId(req.body.process_id);
    if (!await validateGovernableProcess(req, res, repo, normalizedProcessId)) return;

    const term = await repo.createTerm({
      term: req.body.term,
      term_type_code: termTypeCode,
      definition: req.body.definition,
      scope: req.body.scope,
      forbidden: req.body.forbidden,
      process_id: normalizedProcessId || null
    }, req.session.userId);
    res.json({ id: term.id });
  });
});

router.put('/:id', requireAuth, requirePermission('governance:draft-department'), (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    const existing = await repo.getTerm(req.params.id);
    if (!existing) return res.status(404).json({ error: '术语不存在' });
    if (Number(existing.process_owner_dept_id || 0) !== Number(req.session.departmentId || 0) || existing.status !== 'pending') {
      return res.status(403).json({ error: '部门主对接人只能修改本部门待审术语' });
    }
    const termTypeCode = normalizeTermTypeCode(req.body.term_type_code);
    if (!await validateTermTypeCode(repo, res, termTypeCode)) return;
    const normalizedProcessId = normalizeProcessId(req.body.process_id);
    if (!await validateGovernableProcess(req, res, repo, normalizedProcessId)) return;

    const updated = await repo.updateTerm(req.params.id, {
      term: req.body.term,
      term_type_code: termTypeCode,
      definition: req.body.definition,
      scope: req.body.scope,
      forbidden: req.body.forbidden,
      process_id: normalizedProcessId || null
    });
    if (!updated) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  });
});

router.post('/:id/review', requireAuth, requirePermission('governance:review-department'), (req, res) => {
  return runAction(res, async () => {
    if (!validateAction(req.body.action)) {
      return res.status(400).json({ error: '不支持的审核操作' });
    }
    const repo = await terminologyRepository();
    const existing = await repo.getTerm(req.params.id);
    if (!existing) return res.status(404).json({ error: '术语不存在' });
    if (Number(existing.process_owner_dept_id || 0) !== Number(req.session.departmentId || 0)) {
      return res.status(403).json({ error: '部门MDM审核员只能审核本部门术语' });
    }
    await repo.reviewTerm(req.params.id, req.body.action, req.session.userId);
    res.json({ success: true });
  });
});

router.delete('/:id', requireAuth, requirePermission('governance:draft-department'), (req, res) => {
  return runAction(res, async () => {
    const repo = await terminologyRepository();
    const existing = await repo.getTerm(req.params.id);
    if (!existing) return res.status(404).json({ error: '术语不存在' });
    if (Number(existing.process_owner_dept_id || 0) !== Number(req.session.departmentId || 0) || existing.status !== 'pending') {
      return res.status(403).json({ error: '部门主对接人只能删除本部门待审术语' });
    }
    const deleted = await repo.deleteTerm(req.params.id);
    if (!deleted) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  });
});

router.setTerminologyRepositoryFactory = setTerminologyRepositoryFactory;
router.resetTerminologyRepositoryFactory = resetTerminologyRepositoryFactory;

module.exports = router;
