const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const { sessionOf } = require('../legacyGovernanceWrites');
const express = require('express');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const { requireAuth, requirePermission } = require('../auth');
const { terminologyScope } = require('../terminologyAccess');
const { hasGlobalViewAsync, validateAction } = require('../access');
const governanceCompatibility = require('../terminologyGovernanceCompatibility');
const {
  resetTerminologyRepositoryFactory,
  setTerminologyRepositoryFactory,
  terminologyRepository
} = require('../terminologyMysqlRepository');

function handleDbError(res, error) {
  if (error?.statusCode) return res.status(error.statusCode).json({ error:error.message, code:error.code });
  if (sendMysqlUnavailable(res, error)) return;
  if (error && (error.code === 'ER_DUP_ENTRY' || String(error.message).includes('Duplicate entry'))) {
    return res.status(409).json({ error: '术语已存在' });
  }
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束' });
  }
  logRequestFailure(res, error);
  return res.status(500).json({ error: '服务器错误' });
}

function runAction(res, action) {
  return action().catch(error => handleDbError(res, error));
}

// Existing bookmarks remain readable; writes must use the versioned workflow.
router.use(requireAuth, (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && governanceCompatibility.enabled()) {
    return res.status(409).json({ code: 'TERMINOLOGY_LEGACY_WRITE_RETIRED', error: '公司统一术语治理已启用，请在术语治理页面提报、修订和确认；旧记录保留用于追溯。' });
  }
  next();
});

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

// Keeps existing todo bookmarks in the numeric namespace while exposing the
// explicit canonical UUID after cutover. Visibility is rechecked for every read.
router.get('/:id', requireAuth, (req, res) => {
  return runAction(res, async () => {
    if (!/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) return res.status(400).json({code:'TERMINOLOGY_LEGACY_ID_INVALID',error:'历史术语编号无效或超出现有接口范围。'});
    const repo = await terminologyRepository();
    const term = await repo.getTerm(req.params.id, await terminologyScope(req));
    if (!term) return res.status(404).json({error:'术语不存在或不在当前可读范围内'});
    return res.json(term);
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
    }, req.session.userId, sessionOf(req.session));
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
      process_id: normalizedProcessId || null,
      expected_token: req.body.expected_token === undefined ? existing.write_token : req.body.expected_token
    }, sessionOf(req.session));
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
    await repo.reviewTerm(req.params.id, req.body.action, req.session.userId, sessionOf(req.session), req.body.expected_token === undefined ? existing.write_token : req.body.expected_token);
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
    const deleted = await repo.deleteTerm(req.params.id, sessionOf(req.session), req.body?.expected_token === undefined ? existing.write_token : req.body.expected_token);
    if (!deleted) return res.status(404).json({ error: '术语不存在' });
    res.json({ success: true });
  });
});

router.setTerminologyRepositoryFactory = setTerminologyRepositoryFactory;
router.resetTerminologyRepositoryFactory = resetTerminologyRepositoryFactory;

module.exports = router;
