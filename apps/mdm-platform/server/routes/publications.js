const { sessionSubject, identityInteger } = require('../sessionSubject');
const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise');
const crypto = require('node:crypto');
const { requireAuth, getUserEffectivePermissionsAsync, getUserRoleCodesAsync } = require('../auth');
const { mysqlConfigFromEnv } = require('../mysqlConfig');
const { makePublicationRepository } = require('../publicationRepository');
const { FIELDS, MAX_ROWS, MAX_COLUMNS, failure, parseSpreadsheet, suggestedMapping, normalizePublication, exportSpreadsheet } = require('../publicationSpreadsheet');
const { createRegisteredPool } = require('../mysqlPoolRegistry');
const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 12, fieldSize: 32768 } });
let repository;
let repositoryFactory;
let actorFactory;

function repo() {
  if (repositoryFactory) return repositoryFactory();
  if (!repository) repository = makePublicationRepository(createRegisteredPool(process.env, 'publications'));
  return repository;
}

async function currentPublicationActor(req) {
  if (actorFactory) return actorFactory(req);
  const subject=sessionSubject(req.session,req.identity);
  const systemIdentity = subject.kind === 'system_admin';
  const personId = systemIdentity ? null : identityInteger(subject.personId);
  const principal = subject.principal;
  const [{ permSet }, roles] = await Promise.all([getUserEffectivePermissionsAsync(principal), getUserRoleCodesAsync(principal)]);
  const admin = systemIdentity || roles.some(role => (role.code || role.role_code) === 'admin');
  const canMaintainDirectory = !admin && permSet.has('directory:maintain');
  const canPublishMasterData = !admin && permSet.has('governance:publish');
  const canPrepareMasterData = permSet.has('identity:manage-account') || canPublishMasterData;
  return { identityKind: subject.kind, personId, accountId:identityInteger(subject.accountId), authVersion:identityInteger(subject.authVersion), canRead: permSet.has('identity:read') || permSet.has('directory:read') || permSet.has('governance:read-global'), canPrepare: canPrepareMasterData || canMaintainDirectory, canPublish: canPublishMasterData || canMaintainDirectory, canMaintainDirectory, canPublishMasterData, canPrepareMasterData };
}

function run(res, action) {
  Promise.resolve().then(action).catch(error => {
    const status = error.statusCode || (error.code === 'ER_NO_SUCH_TABLE' ? 503 : 500);
    res.status(status).json({ code: error.code === 'ER_NO_SUCH_TABLE' ? 'PUBLICATION_SCHEMA_PENDING' : error.statusCode ? error.code : 'PUBLICATION_REQUEST_FAILED', error: error.statusCode ? error.message : status === 503 ? '发布记录表尚未准备' : '发布操作暂时无法完成', ...(error.details || {}) });
  });
}

function requirePublicationAccess(capability) {
  return (req, res, next) => run(res, async () => {
    req.publicationActor = await currentPublicationActor(req);
    if (!req.publicationActor[capability]) return res.status(403).json({ code: 'PUBLICATION_ACCESS_DENIED', error: capability === 'canPublish' ? '当前账号可以核对和查看，发布由具备发布权限的业务账号办理' : '当前账号无权访问此发布功能' });
    next();
  });
}

function file(req, res, next) {
  upload.single('file')(req, res, error => {
    if (error) return res.status(422).json({ code: 'PUBLICATION_FILE_INVALID', error: '请上传一份不超过5MB的.xlsx或.csv文件' });
    if (!req.file) return res.status(422).json({ code: 'PUBLICATION_FILE_REQUIRED', error: '请选择要导入的文件' });
    next();
  });
}

function kind(value) {
  if (!Object.prototype.hasOwnProperty.call(FIELDS, value)) throw failure('发布类型无效');
  return value;
}

function assertKindWriteAccess(actor, selectedKind, publish = false) {
  const allowed = selectedKind === 'master_data'
    ? actor[publish ? 'canPublishMasterData' : 'canPrepareMasterData']
    : actor.canMaintainDirectory;
  if (!allowed) {
    const error = failure(selectedKind === 'master_data' ? '当前账号无权办理此主数据发布' : '组织与人员目录由具备目录维护权限的行政人事人员维护', 'PUBLICATION_ACCESS_DENIED');
    error.statusCode = 403;
    throw error;
  }
}

function assertDirectoryHistoryAccess(actor, publication) {
  if (publication.kind !== 'master_data' && !actor.canMaintainDirectory) {
    const error = failure('组织与人员历史包含维护资料，仅目录维护人员可查看完整内容', 'DIRECTORY_HISTORY_ACCESS_DENIED');
    error.statusCode = 403;
    throw error;
  }
}

function jsonField(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch (_) { throw failure('导入核对信息无法读取，请重新选择文件'); }
}

function originalFileName(file) {
  const name=file.originalname;
  if ([...name].every(character=>character.charCodeAt(0)<=255)) {
    try { return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(name,'latin1')); } catch (_) { /* Already decoded legacy filename. */ }
  }
  return name;
}

async function contentFromFile(req) {
  const parsed = await parseSpreadsheet(req.file.buffer, req.file.originalname, req.body.sheetName);
  return normalizePublication({ ...parsed, kind: kind(req.body.kind), title: req.body.title, sourceFileName: originalFileName(req.file), mapping: jsonField(req.body.mapping, {}), keyHeader: req.body.keyHeader });
}

router.get('/status', requireAuth, requirePublicationAccess('canRead'), (req, res) => run(res, async () => {
  const selectedKind = kind(req.query.kind || 'master_data'), actor = req.publicationActor;
  res.json({ ...await repo().status(), canPrepare:selectedKind === 'master_data' ? actor.canPrepareMasterData : actor.canMaintainDirectory, canPublish:selectedKind === 'master_data' ? actor.canPublishMasterData : actor.canMaintainDirectory, canMaintainDirectory:actor.canMaintainDirectory, canReadDirectoryHistory:actor.canMaintainDirectory, canPublishMasterData:actor.canPublishMasterData, canPrepareMasterData:actor.canPrepareMasterData, maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS });
}));

router.get('/', requireAuth, requirePublicationAccess('canRead'), (req, res) => run(res, async () => {
  res.json({ rows: await repo().list(kind(req.query.kind || 'master_data'), { includeDirectoryHistory: req.publicationActor.canMaintainDirectory === true }) });
}));

router.get('/template', requireAuth, requirePublicationAccess('canRead'), (req, res) => run(res, async () => {
  const selectedKind=kind(req.query.kind);
  const headers=selectedKind==='master_data'?['唯一标识','名称']:FIELDS[selectedKind].map(field=>field.label);
  res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition',`attachment; filename="${selectedKind}-template.xlsx"`);
  res.send(Buffer.from(await exportSpreadsheet({headers,rows:[]})));
}));

router.post('/parse', requireAuth, requirePublicationAccess('canPrepare'), file, (req, res) => run(res, async () => {
  const selectedKind = kind(req.body.kind);
  assertKindWriteAccess(req.publicationActor, selectedKind);
  const parsed = await parseSpreadsheet(req.file.buffer, req.file.originalname, req.body.sheetName);
  res.json({ ...parsed, suggestedMapping: suggestedMapping(selectedKind, parsed.headers), fields: FIELDS[selectedKind], datasetKey: selectedKind === 'master_data' ? 'master_' + crypto.randomUUID() : selectedKind });
}));

router.post('/preview', requireAuth, requirePublicationAccess('canPrepare'), file, (req, res) => run(res, async () => {
  const normalized = await contentFromFile(req);
  assertKindWriteAccess(req.publicationActor, normalized.content.kind);
  res.json({ ...await repo().preview(normalized, req.body.datasetKey), rowCount: normalized.content.rows.length });
}));

router.post('/publish', requireAuth, requirePublicationAccess('canPublish'), file, (req, res) => run(res, async () => {
  const normalized = await contentFromFile(req);
  assertKindWriteAccess(req.publicationActor, normalized.content.kind, true);
  const checked = jsonField(req.body.checked, {});
  if (req.body.confirmed !== 'true') throw failure('请明确确认核对结果后再发布');
  const published = await repo().publish({ ...checked, content: normalized.content, datasetKey: req.body.datasetKey, requestId: req.body.requestId, reason:req.body.reason }, req.publicationActor);
  res.status(published.idempotent ? 200 : 201).json(published);
}));

router.get('/:id/download', requireAuth, requirePublicationAccess('canRead'), (req, res) => run(res, async () => {
  if (!/^\d+$/.test(req.params.id)) throw failure('发布版本标识无效');
  const publication = await repo().get(req.params.id);
  if (!publication) return res.status(404).json({ error: '发布版本不存在' });
  assertDirectoryHistoryAccess(req.publicationActor,publication);
  const asJson = req.query.format === 'json';
  const filename = `${publication.title}-v${publication.version_no}.${asJson ? 'json' : 'xlsx'}`;
  res.setHeader('Content-Disposition', `attachment; filename="publication.${asJson ? 'json' : 'xlsx'}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.type(asJson ? 'application/json' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.send(asJson ? JSON.stringify(publication, null, 2) : Buffer.from(await exportSpreadsheet(publication.content)));
}));

router.get('/:id', requireAuth, requirePublicationAccess('canRead'), (req, res) => run(res, async () => {
  if (!/^\d+$/.test(req.params.id)) throw failure('发布版本标识无效');
  const result = await repo().get(req.params.id);
  if (!result) return res.status(404).json({ error: '发布版本不存在' });
  assertDirectoryHistoryAccess(req.publicationActor,result);
  res.json(result);
}));

router.setRepositoryFactory = value => { repositoryFactory = value; repository = null; };
router.setActorFactory = value => { actorFactory = value; };
module.exports = router;
