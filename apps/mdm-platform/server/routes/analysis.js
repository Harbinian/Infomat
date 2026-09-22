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
  res.status(status).json({ error: e.code === 'DEFINITION_PDF_TYPE' ? '只允许上传有效的 .pdf 文件。' : e.code === 'DEFINITION_WORD_TYPE' ? '只允许上传有效的 .docx 文件，不接受 .doc 或更改扩展名的文件。' : status === 409 ? '来源、修订或请求已变化，请保留输入并重新核对。' : status === 413 ? '材料或请求超出允许大小。' : status === 503 ? '分析依赖暂不可用，请稍后重试。' : '操作未完成，请核对当前身份和输入。',
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
const excelUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,fieldSize:65536,parts:4}}).single('file');
router.post('/materials/excel', requirePermission('governance:structure-gate'), (q,r,n)=>excelUpload(q,r,e=>e?fail(r,e):n()),run((q,r)=>{
  if(!q.file||Object.keys(q.body).some(k=>!['request_id','links'].includes(k)))throw require('../excelEvidenceParser').fail('PROPERTY');
  let links=[];try{links=q.body.links?JSON.parse(q.body.links):[];}catch{throw require('../excelEvidenceParser').fail('MAPPING');}
  const raw=q.file.originalname,decoded=Buffer.from(raw,'latin1').toString('utf8');
  return r.registerExcelEvidence(q.session,{request_id:q.body.request_id,original_name:decoded.includes('\ufffd')?raw:decoded,links},q.file.buffer);
}));
router.get('/materials/excel/:id',run((q,r)=>r.getExcelEvidence(q.session,q.params.id,q.query)));
const wordUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,fieldSize:65536,parts:4}}).single('file');
router.post('/materials/word', requirePermission('governance:structure-gate'), (q,r,n)=>wordUpload(q,r,e=>e?fail(r,e):n()),run((q,r)=>{
  if(!q.file||Object.keys(q.body).some(k=>!['request_id','links'].includes(k)))throw require('../wordEvidenceParser').fail('PROPERTY');
  let links=[];try{links=q.body.links?JSON.parse(q.body.links):[];}catch{throw require('../wordEvidenceParser').fail('MAPPING');}
  const raw=q.file.originalname,decoded=Buffer.from(raw,'latin1').toString('utf8');
  return r.registerWordEvidence(q.session,{request_id:q.body.request_id,original_name:decoded.includes('\ufffd')?raw:decoded,links},q.file.buffer);
}));
router.get('/materials/word/:id',run((q,r)=>r.getWordEvidence(q.session,q.params.id,q.query)));
const pdfUpload = multer({storage:multer.memoryStorage(),limits:{fileSize:5*1024*1024,files:1,fields:2,fieldSize:65536,parts:4}}).single('file');
router.post('/materials/pdf', requirePermission('governance:structure-gate'), (q,r,n)=>pdfUpload(q,r,e=>e?fail(r,e):n()),run((q,r)=>{
  if(!q.file||Object.keys(q.body).some(k=>!['request_id','links'].includes(k)))throw require('../pdfEvidenceParser').fail('PROPERTY');
  let links=[];try{links=q.body.links?JSON.parse(q.body.links):[];}catch{throw require('../pdfEvidenceParser').fail('MAPPING');}
  const raw=q.file.originalname,decoded=Buffer.from(raw,'latin1').toString('utf8');
  return r.registerPdfEvidence(q.session,{request_id:q.body.request_id,original_name:decoded.includes('\ufffd')?raw:decoded,links},q.file.buffer);
}));
router.get('/materials/pdf/:id',run((q,r)=>r.getPdfEvidence(q.session,q.params.id,q.query)));
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
router.get('/issue-targets', run((q, r) => r.analysisIssueTargets(q.session, q.query.after)));
router.get('/issues/:issueId', run((q, r) => r.getAnalysisIssue(q.session, q.params.issueId)));
router.get('/issues/:issueId/tasks', run((q, r) => r.getAnalysisIssueTasks(q.session, q.params.issueId)));
router.post('/issues/:issueId/tasks', requirePermission('governance:assign-work'), run((q, r) => {
  if (Object.hasOwn(q.body, 'issue_id')) throw Object.assign(new Error(), { code: 'DEFINITION_ANALYSIS_PROPERTY_INVALID', statusCode: 400 });
  return r.dispatchAnalysisIssueTask(q.session, { ...q.body, issue_id: q.params.issueId });
}));
router.get('/issues/:issueId/closure', run((q, r) => r.getAnalysisIssueClosure(q.session, q.params.issueId)));
router.post('/issues/:issueId/review', run((q, r) => r.reviewAnalysisIssueTask(q.session, q.params.issueId, q.body)));
router.get('/runs/:id/findings/:findingId/review', run((q, r) => r.getFindingReview(q.session, q.params.id, q.params.findingId)));
router.post('/runs/:id/findings/:findingId/review', requirePermission('governance:structure-gate'), run((q, r) => {
  if (Object.hasOwn(q.body, 'run_id') || Object.hasOwn(q.body, 'finding_id')) throw Object.assign(new Error(), { code: 'DEFINITION_ANALYSIS_PROPERTY_INVALID', statusCode: 400 });
  return r.decideAnalysisFinding(q.session, { ...q.body, run_id: q.params.id, finding_id: q.params.findingId });
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
