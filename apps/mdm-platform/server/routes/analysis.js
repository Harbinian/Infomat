const express = require('express'), multer = require('multer');
const { requireAuth, requirePermission } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');
const { MAX_BYTES } = require('../v7FixedSource');
const router = express.Router();
function fail(res, e) {
  const known = /^DEFINITION_[A-Z0-9_]+$/.test(e.code || '');
  const uploadError = String(e.code || '').startsWith('LIMIT_');
  let status = uploadError ? 413 : known ? e.statusCode || 400 : 503;
  // Object existence is not disclosed to an identity outside its source scope.
  if (status === 403 || status === 404) return res.status(404).json({ error: '资源不存在或当前身份无权访问。', code: 'DEFINITION_ANALYSIS_RESOURCE_UNAVAILABLE' });
  res.status(status).json({ error: status === 409 ? '来源、修订或请求已变化，请保留输入并重新核对。' : status === 413 ? '材料或请求超出允许大小。' : status === 503 ? '分析依赖暂不可用，请稍后重试。' : '操作未完成，请核对当前身份和输入。',
    code: known ? e.code : uploadError ? 'DEFINITION_ANALYSIS_UPLOAD_LIMIT' : 'DEFINITION_ANALYSIS_UNAVAILABLE' });
}
router.use((q, r, n) => { r.set('Cache-Control', 'no-store'); n(); }, requireAuth);
const run = fn => (q, r) => Promise.resolve().then(async () => {
  const value = await fn(q, (await dataMapRepository()).definitions());
  if (q.path.endsWith('/export')) r.set('Content-Disposition', 'attachment; filename="analysis.json"');
  r.json(value);
}).catch(e => fail(r, e));
router.get('/capabilities', run((q, r) => r.analysisCapabilities(q.session)));
router.get('/sources', run((q, r) => r.listAnalysisSources(q.session, q.query)));
router.get('/sources/:kind/:id', run((q, r) => r.getAnalysisSource(q.session, q.params.kind, q.params.id)));
router.post('/materials/references', requirePermission('governance:structure-gate'), run((q, r) => r.registerV7Source(q.session, q.body)));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_BYTES, files: 1, fields: 1, fieldSize: 128, parts: 3 } }).single('file');
router.post('/materials/uploads', requirePermission('governance:structure-gate'), (q, r, n) => upload(q, r, e => e ? fail(r, e) : n()), run((q, r) => {
  if (!q.file || Object.keys(q.body).some(k => k !== 'request_id')) throw Object.assign(new Error(), { code: 'DEFINITION_ANALYSIS_UPLOAD_INVALID', statusCode: 400 });
  const original = q.file.originalname, decoded = Buffer.from(original, 'latin1').toString('utf8');
  return r.registerV7Source(q.session, { request_id: q.body.request_id, source_kind: 'uploaded_material', original_name: decoded.includes('\ufffd') ? original : decoded }, q.file.buffer);
}));
router.get('/runs', run((q, r) => r.listAnalysisRuns(q.session, q.query)));
router.post('/runs', requirePermission('governance:structure-gate'), run((q, r) => r.createQueuedAnalysis(q.session, q.body)));
router.post('/runs/:id/cancel', requirePermission('governance:structure-gate'), run((q, r) => {
  if (Object.hasOwn(q.body, 'run_id')) throw Object.assign(new Error(), { code: 'DEFINITION_ANALYSIS_PROPERTY_INVALID', statusCode: 400 });
  return r.cancelAnalysis(q.session, { ...q.body, run_id: q.params.id });
}));
router.get('/runs/:id/diff/:otherId', run((q, r) => r.compareAnalysisRuns(q.session, q.params.id, q.params.otherId)));
router.get('/runs/:id/summary', run((q, r) => r.readAnalysis(q.session, q.params.id, 'summary')));
router.get('/runs/:id/findings', run((q, r) => r.readAnalysis(q.session, q.params.id, 'findings', q.query)));
router.get('/runs/:id/findings/:findingId', run((q, r) => r.readAnalysis(q.session, q.params.id, 'finding', { id: q.params.findingId })));
router.get('/runs/:id/evidence/:evidenceId', run((q, r) => r.readAnalysis(q.session, q.params.id, 'evidence', { id: q.params.evidenceId })));
router.get('/runs/:id/export', run((q, r) => {
  if (Object.keys(q.query).length) throw Object.assign(new Error(), { code: 'DEFINITION_ANALYSIS_QUERY_INVALID', statusCode: 400 });
  return r.readAnalysis(q.session, q.params.id, 'export');
}));
router.get('/runs/:id', run((q, r) => r.readAnalysis(q.session, q.params.id)));
module.exports = router;
