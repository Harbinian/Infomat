const express=require('express');
const {requireAuth}=require('../auth');
const {sessionOf}=require('../legacyGovernanceWrites');
const {enabled}=require('../terminologyGovernancePolicy');
const {createRegisteredPool}=require('../mysqlPoolRegistry');
const {createRepositoryResource}=require('../repositoryResource');
const {makeTerminologyUsages,ready}=require('../terminologyUsages');
const resource=createRepositoryResource({create:()=>createRegisteredPool(process.env,'terminology'),verify:ready,build:makeTerminologyUsages});
let factory=null;
const router=express.Router();
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
const run=action=>(req,res)=>Promise.resolve().then(async()=>{
  if(!enabled())return req.method==='GET'?res.json({enabled:false,items:[],allowed_actions:[]}):res.status(503).json({code:'TERM_GOVERNANCE_DISABLED',error:'统一术语治理尚未开启'});
  return action(req,res,await(factory?factory():resource.get()));
}).catch(error=>{
  const status=error.statusCode||503;
  res.status(status).json({error:status===503?'术语引用依赖尚未准备或提交回执不明，请核对后处理。':error.message,code:error.code||'TERM_GOVERNANCE_USAGE_UNAVAILABLE',...(error.findings?{findings:error.findings}:{})});
});
router.get('/usages',run(async(req,res,repo)=>res.json(await repo.read(sessionOf(req.session),req.query))));
router.post('/usages',run(async(req,res,repo)=>res.json(await repo.save(sessionOf(req.session),req.body))));
router.post('/usages/actions',run(async(req,res,repo)=>res.json(await repo.action(sessionOf(req.session),req.body))));
router.post('/usages/impacts',run(async(req,res,repo)=>res.json(await repo.impact(sessionOf(req.session),req.body))));
router.get('/terms/:id/usages',run(async(req,res,repo)=>res.json(await repo.reverse(sessionOf(req.session),req.params.id))));
router.setRepositoryFactory=value=>{factory=value;resource.reset().catch(()=>{});};
module.exports=router;
