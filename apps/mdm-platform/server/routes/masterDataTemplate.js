const express = require('express');
const multer = require('multer');
const { requireAuth, requirePermission } = require('../auth');
const { dataMapRepository } = require('../dataMapMysqlRepository');
const { prepareImport } = require('../masterDataTemplateImport');
const { LIMITS } = require('../masterDataTemplate');
const { failure } = require('../dataMapDefinitionValues');
const router = express.Router();
// Busboy emits partsLimit on reaching the count; the valid two parts need a
// terminal boundary allowance. files/fields still enforce exactly one of each.
const upload = multer({storage:multer.memoryStorage(),limits:{fileSize:LIMITS.bytes,files:1,fields:1,fieldSize:256*1024,parts:3}}).single('file');
const run = action => (req,res) => Promise.resolve().then(()=>action(req,res)).catch(error => {
  const known = /^(TEMPLATE_|DEFINITION_)/.test(error.code || '');
  const status = known ? error.statusCode || 400 : error.code?.startsWith('LIMIT_') ? 413 : 503;
  res.status(status).json({error:known && error.code.startsWith('TEMPLATE_') && error.message!==error.code ? error.message : status===503?'导入依赖暂不可用，请稍后重试。':'导入未完成，请核对文件、权限或修订号。',
    code:known?error.code:status===413?'TEMPLATE_LIMIT_EXCEEDED':'DEFINITION_SCHEMA_UNAVAILABLE',...(error.field_errors?{field_errors:error.field_errors}:{})});
});
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const repository = async () => (await dataMapRepository()).definitions();
router.get('/source/:id',run(async(req,res)=>res.json(await (await repository()).getSource(req.session,req.params.id))));
router.get('/definition/:type/:id',run(async(req,res)=>res.json(await (await repository()).getCurrent(req.session,req.params.type,req.params.id))));
router.get('/version/:id',run(async(req,res)=>res.json(await (await repository()).getVersion(req.session,req.params.id))));
router.get('/capabilities',run(async(req,res)=>res.json(await (await repository()).templateImportActor(req.session))));
for (const action of ['preview','confirm']) router.post('/'+action,requirePermission('governance:draft-department'),run(async(req,res)=>{
  const repo=await repository(),who=await repo.templateImportActor(req.session);
  await new Promise((resolve,reject)=>upload(req,res,error=>error?reject(error):resolve()));
  if (!req.file || !req.body?.options || Object.keys(req.body).length!==1) throw failure('TEMPLATE_UPLOAD_REQUIRED');
  let options; try { options=JSON.parse(req.body.options); } catch { throw failure('TEMPLATE_OPTIONS_INVALID'); }
  if (!options || Array.isArray(options) || Object.keys(options).some(k=>!['links','preview_digest','request_id','confirm'].includes(k))) throw failure('TEMPLATE_OPTIONS_INVALID');
  const bytes=req.file.buffer;
  // Multipart headers from browsers use UTF-8 while Busboy defaults to Latin-1.
  // Decode only a lossless round trip, preserving genuine legacy filenames.
  const rawName=req.file.originalname,headerBytes=Buffer.from(rawName,'latin1'),decoded=headerBytes.toString('utf8');
  const originalName=/^[\u0000-\u00ff]*$/.test(rawName)&&Buffer.from(decoded,'utf8').equals(headerBytes)?decoded:rawName;
  if (action==='confirm') return res.json(await repo.importTemplate(req.session,{...options,original_name:originalName},bytes));
  const prepared=await prepareImport(bytes,originalName,options.links||[],who);
  for (const link of prepared.links) {
    const current=await repo.getCurrent(req.session,link.record_type,link.entity_id);
    if (String(current.base_snapshot.row.owner_dept_id||'')!==who.departmentId && link.record_type==='object' || current.revision_no!==link.expected_revision) throw failure('DEFINITION_REVISION_CONFLICT',409);
  }
  res.json(prepared);
}));
module.exports=router;
