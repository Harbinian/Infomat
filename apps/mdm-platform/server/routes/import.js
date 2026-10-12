const { sendMysqlUnavailable } = require('../mysqlRuntimeSchema');
const express = require('express');
const multer = require('multer');
const { logRequestFailure } = require('../securityLog');
const router = express.Router();
const { requireAuth, getUserEffectivePermissionsAsync } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');
const { sessionOf } = require('../legacyGovernanceWrites');
const { sameIdentityInteger } = require('../sessionSubject');
const { parseLegacyFields } = require('../legacyImportParser');

// R05: the file-size bound is joined by part and field bounds, so a multipart body cannot
// cost more than the single workbook it is allowed to carry.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 8, parts: 12, headerPairs: 64 }
});

function handleUpload(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ code: 'LEGACY_IMPORT_LIMIT', error: 'Excel 文件不能超过 5MB' });
    return res.status(400).json({ error: 'Excel 文件上传失败' });
  });
}

function handleError(res, error) {
  const meta = { code: error?.code, import_status: error?.import_status };
  if (error && error.statusCode) return res.status(error.statusCode).json({ error: error.message, ...meta });
  if (sendMysqlUnavailable(res, error)) return;
  if (error && (String(error.code || '').startsWith('ER_') || String(error.message).includes('constraint'))) {
    return res.status(400).json({ error: '数据不符合约束', ...meta });
  }
  logRequestFailure(res, error);
  return res.status(400).json({ error: 'Excel 解析或导入失败', ...meta });
}

async function canImportForContext(req, context) {
  const { permSet } = await getUserEffectivePermissionsAsync(req.session.userId);
  const sameDepartment = sameIdentityInteger(context.dept_id, req.session.departmentId);
  return sameDepartment && !permSet.has('identity:manage-account') && permSet.has('governance:draft-department');
}

router.post('/field-entries', requireAuth, handleUpload, async (req, res) => {
  try {
    const contextId = Number(req.body.context_id || req.body.mapping_id);
    if (!Number.isSafeInteger(contextId) || contextId < 1) return res.status(400).json({ error: '缺少或无效的 context_id' });
    if (!req.file) return res.status(400).json({ error: '缺少 Excel 文件' });

    const repo = await dataMapRepository();
    const context = await repo.getContext(contextId);
    if (!context) return res.status(404).json({ error: '数据地图上下文不存在' });
    if (!await canImportForContext(req, context)) {
      return res.status(403).json({ error: '无权导入该数据地图上下文字段台账' });
    }

    // R05: the parse is bounded and runs off the request thread. Authorisation above is
    // unchanged and still happens before the workbook is read; the import itself keeps its
    // UUID idempotency, named lock, context hash and atomic batch semantics untouched.
    const abort = new AbortController();
    const onClose = () => { if (!res.writableEnded) abort.abort(); };
    res.on('close', onClose);
    if (req.aborted || res.destroyed) abort.abort();
    let rows;
    try { rows = await parseLegacyFields({
      bytes: req.file.buffer,
      originalName: req.file.originalname,
      contextId,
      submittedBy: req.session.userId,
      signal: abort.signal
    }); } finally { res.off('close', onClose); }
    // The parser can finish just as the client departs. Do not start a new write after cancellation.
    if (abort.signal.aborted || req.aborted || res.destroyed) return;

    res.json(await repo.importFieldsBatch({ contextId, rows, fileName: req.file.originalname,
      buffer: req.file.buffer, requestId: req.body.request_id }, sessionOf(req.session)));
  } catch (error) {
    return handleError(res, error);
  }
});

module.exports = router;
