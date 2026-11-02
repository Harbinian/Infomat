const express=require('express');
const {requireAuth}=require('../auth');
const {createRegisteredPool}=require('../mysqlPoolRegistry');
const {makeProcessCaseDisputes}=require('../processCaseDisputes');
const {logRequestFailure}=require('../securityLog');
const router=express.Router();
let instance,factory=null;
const repository=()=>factory?factory():instance||(instance=makeProcessCaseDisputes(createRegisteredPool(process.env,'processCaseDisputes')));
const run=fn=>(req,res)=>Promise.resolve().then(()=>fn(req,repository())).then(value=>res.json(value)).catch(error=>{
  if(error.statusCode)return res.status(error.statusCode).json({error:error.message,code:error.code});
  logRequestFailure(res,error);res.status(503).json({error:'流程争议办理暂不可用，请保留输入后重试',code:'PROCESS_DISPUTE_UNAVAILABLE'});
});
router.use(requireAuth,(req,res,next)=>{res.set('Cache-Control','no-store');next();});
router.get('/workbench',run((q,r)=>r.workbench(q.session)));
router.get('/cases/:id',run((q,r)=>r.detail(q.session,q.params.id)));
router.post('/cases/:id/actions',run((q,r)=>r.act(q.session,q.params.id,q.body)));
router.setRepositoryFactory=value=>{factory=value;};
router.resetRepositoryFactory=()=>{factory=null;};
module.exports=router;
