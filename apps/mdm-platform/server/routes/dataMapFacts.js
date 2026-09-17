const express=require('express');
const {requireAuth,requirePermission}=require('../auth');
const {dataMapRepository}=require('../dataMapMysqlRepository');
const router=express.Router();
const run=action=>(req,res)=>Promise.resolve().then(async()=>action(req,res,(await dataMapRepository()).definitions())).catch(e=>{
  const known=String(e.code||'').startsWith('DEFINITION_'),status=known?e.statusCode||400:503;
  res.status(status).json({error:status===503?'事实核对依赖暂不可用，请稍后重试。':status===409?'办理修订或来源已变化，请保留输入并重新核对。':'事实核对未完成，请核对权限、目标、证据及状态。',code:known?e.code:'DEFINITION_FACT_SCHEMA_UNAVAILABLE'});
});
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/capabilities',run(async(req,res,repo)=>res.json(await repo.factCapabilities(req.session))));
router.get('/targets',requirePermission('governance:structure-gate'),run(async(req,res,repo)=>res.json(await repo.factTargets(req.session,req.query))));
router.get('/',run(async(req,res,repo)=>res.json(await repo.listFacts(req.session,req.query))));
router.get('/:id',run(async(req,res,repo)=>res.json(await repo.getFact(req.session,req.params.id,req.query))));
router.post('/',requirePermission('governance:structure-gate'),run(async(req,res,repo)=>res.json(await repo.createFact(req.session,req.body))));
router.post('/:id/:action',run(async(req,res,repo)=>res.json(await repo.actOnFact(req.session,req.params.id,req.params.action,req.body))));
module.exports=router;
