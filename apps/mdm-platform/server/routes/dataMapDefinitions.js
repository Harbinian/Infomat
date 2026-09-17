const express = require('express');
const {requireAuth,requirePermission} = require('../auth');
const {dataMapRepository} = require('../dataMapMysqlRepository');
const router=express.Router();
const run=action=>(req,res)=>Promise.resolve().then(async()=>action(req,res,(await dataMapRepository()).definitions())).catch(error=>{
  const known=String(error.code||'').startsWith('DEFINITION_'),status=known?error.statusCode||400:503;
  res.status(status).json({error:status===503?'台账依赖暂不可用，请稍后重试。':'操作未完成，请核对填写内容、权限、状态和修订号。',code:known?error.code:'DEFINITION_SCHEMA_UNAVAILABLE'});
});
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/capabilities',run(async(req,res,repo)=>res.json(await repo.managementCapabilities(req.session))));
router.get('/objects',run(async(req,res,repo)=>res.json(await repo.listManagedObjects(req.session,req.query))));
router.get('/detail/:type/:id',run(async(req,res,repo)=>res.json(await repo.managedDetail(req.session,req.params.type,req.params.id,req.query))));
router.get('/history/:type/:id',run(async(req,res,repo)=>res.json(await repo.managedHistory(req.session,req.params.type,req.params.id,req.query))));
router.get('/version/:id',run(async(req,res,repo)=>res.json(await repo.getVersion(req.session,req.params.id))));
router.get('/source/:id',run(async(req,res,repo)=>res.json(await repo.getSource(req.session,req.params.id))));
router.get('/impact/:type/:id',run(async(req,res,repo)=>res.json(await repo.retirementImpact(req.session,req.params.type,req.params.id))));
router.post('/save',requirePermission('governance:draft-department'),run(async(req,res,repo)=>res.json(await repo.saveManaged(req.session,req.body))));
router.post('/retire/:type/:id',requirePermission('governance:draft-department'),run(async(req,res,repo)=>res.json(await repo.retireManaged(req.session,req.params.type,req.params.id,req.body))));
module.exports=router;
