const express=require('express');
const {requireAuth,requirePermission}=require('../auth');
const {dataMapRepository}=require('../dataMapMysqlRepository');
const router=express.Router();
const run=fn=>(req,res)=>Promise.resolve().then(async()=>res.json(await fn(req,(await dataMapRepository()).definitions()))).catch(e=>{
  const known=String(e.code||'').startsWith('DEFINITION_'),status=known?e.statusCode||400:503;
  res.status(status).json({error:status===503?'设计交接依赖暂不可用，请保留输入并重试。':status===409?'固定版本、修订或待核实项尚未满足条件，请保留输入并核对。':'操作未完成，请核对权限、两端映射和输入。',code:known?e.code:'DEFINITION_HANDOFF_UNAVAILABLE',...(e.code==='DEFINITION_HANDOFF_UNVERIFIED'?{issues:e.issues,field_errors:{design_checks:e.issues.map(i=>i.message+'（'+i.location+'）')}}:{})});
});
router.use(requireAuth,(q,r,n)=>{r.set('Cache-Control','no-store');n();});
router.get('/capabilities',run((q,r)=>r.handoffCapabilities(q.session)));
router.get('/sources/:id',run((q,r)=>r.handoffSourceContext(q.session,q.params.id)));
router.get('/',run((q,r)=>r.listDesignHandoffs(q.session,q.query)));
router.post('/',requirePermission('governance:structure-gate'),run((q,r)=>r.saveDesignHandoff(q.session,q.body)));
router.get('/:id/history',run((q,r)=>r.designHandoffHistory(q.session,q.params.id,q.query)));
router.get('/:id',run((q,r)=>r.getDesignHandoff(q.session,q.params.id,q.query)));
module.exports=router;
