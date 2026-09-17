const express=require('express'),multer=require('multer');
const {requireAuth,requirePermission}=require('../auth');
const {dataMapRepository}=require('../dataMapMysqlRepository');
const {MAX_BYTES}=require('../v7FixedSource');
const router=express.Router();
function fail(res,e){
  const known=String(e.code||'').startsWith('DEFINITION_'),status=e.code==='LIMIT_FILE_SIZE'?413:known?e.statusCode||400:503;
  res.status(status).json({error:status===503?'V7 来源或映射依赖暂不可用，请稍后重试。':status===409?'固定来源、映射修订或对应关系已变化，请保留输入并重新核对。':'操作未完成，请核对来源、权限、固定版本及依据。',code:known?e.code:status===413?'DEFINITION_V7_UPLOAD_LIMIT':'DEFINITION_V7_UNAVAILABLE'});
}
const run=fn=>(req,res)=>Promise.resolve().then(async()=>res.json(await fn(req,(await dataMapRepository()).definitions()))).catch(e=>fail(res,e));
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/capabilities',run((q,r)=>r.v7MappingCapabilities(q.session)));
router.get('/sources',run((q,r)=>r.listV7Sources(q.session,q.query)));
router.post('/sources',requirePermission('governance:structure-gate'),run((q,r)=>r.registerV7Source(q.session,q.body)));
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:MAX_BYTES,files:1,fields:1,fieldSize:128}}).single('file');
router.post('/uploads',requirePermission('governance:structure-gate'),(req,res,next)=>upload(req,res,e=>e?fail(res,e):next()),run((q,r)=>{
  if(!q.file)throw Object.assign(new Error(),{code:'DEFINITION_V7_UPLOAD_REQUIRED',statusCode:400});
  const original=q.file.originalname;const decoded=Buffer.from(original,'latin1').toString('utf8');
  return r.registerV7Source(q.session,{request_id:q.body.request_id,source_kind:'uploaded_material',original_name:decoded.includes('\ufffd')?original:decoded},q.file.buffer);
}));
router.get('/sources/:id',run((q,r)=>r.getV7Source(q.session,q.params.id)));
router.get('/sources/:id/evidence',run((q,r)=>r.getV7Evidence(q.session,q.params.id,q.query)));
router.get('/sources/:id/mappings/:mappingId/history',run((q,r)=>r.getV7MappingHistory(q.session,q.params.id,q.params.mappingId,q.query)));
router.post('/sources/:id/mappings',requirePermission('governance:structure-gate'),run((q,r)=>r.saveV7Mapping(q.session,q.params.id,q.body)));
module.exports=router;
