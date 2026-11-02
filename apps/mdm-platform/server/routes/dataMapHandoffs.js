const express=require('express');
const {requireAuth}=require('../auth');
const {logRequestFailure}=require('../securityLog');
const {createDataMapHandoffRepository}=require('../dataMapHandoffRepository');

// Registration belongs to server/index.js. No pool, migration or feature flag
// is inferred here; tests and the application pass their exact owned pool.
function createRouter({pool,env=process.env}={}) {
  const router=express.Router(),repository=createDataMapHandoffRepository(pool,{env});
  const workbench=require('../dataMapHandoffWorkbench').createHandoffWorkbench(pool,repository,{env});
  router.workbench=workbench;
  router.use(requireAuth);
  const action=work=>async(req,res)=>{
    try{return res.json(await work(req));}
    catch(error){
      if(error.statusCode)return res.status(error.statusCode).json(error.payload||{code:error.code,error:error.message});
      if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR','ER_PARSE_ERROR'].includes(error.code))return res.status(503).json({code:'HANDOFF_SCHEMA_UNAVAILABLE',error:'数据地图承接结构尚未准备，当前操作未完成。'});
      logRequestFailure(res,error);return res.status(500).json({code:'HANDOFF_INTERNAL_ERROR',error:'数据地图承接操作未完成，请保留输入和原请求标识。'});
    }
  };
  const write=(method,path,handler)=>router[method](path,action(req=>handler(req,req.body,req.session)));
  // Exact static prefixes precede the resource wildcard.
  router.get('/workbench',action(req=>workbench.read(req.session)));
  router.get('/capabilities',action(req=>repository.capabilities(req.session,{packageId:req.query.package_id||null})));
  router.get('/source-upgrades',action(req=>repository.sourceUpgradeStatus(req.session,{packageId:req.query.package_id||null,targetVersionId:req.query.target_process_version_id||null})));
  router.get('/requests/:requestId',action(req=>repository.receipt(req.params.requestId,req.session)));
  router.get('/work-packages/:packageId/trace',action(req=>repository.tracePackage(req.params.packageId,req.session)));
  router.get('/publications/:publicationId/trace',action(req=>repository.tracePublication(req.params.publicationId,req.session)));
  router.get('/publications/:publicationId',action(req=>repository.getPublication(req.params.publicationId,req.session)));
  write('post','/publications/:publicationId/withdrawal-checks',(req,body,session)=>repository.withdrawalChecks(req.params.publicationId,body,session));
  write('post','/publications/:publicationId/withdrawal-approvals',(req,body,session)=>repository.approveWithdrawal(req.params.publicationId,body,session));
  write('post','/publications/:publicationId/withdraw',(req,body,session)=>repository.withdrawPublication(req.params.publicationId,body,session));
  write('post','/publications/:publicationId/restorations',(req,body,session)=>repository.restorePublication(req.params.publicationId,body,session));
  router.get('/facts/:factId/current',action(req=>repository.getFact(req.params.factId,req.session)));
  router.get('/conflicts/:conflictId',action(req=>repository.getConflict(req.params.conflictId,req.session)));
  write('post','/conflicts/:conflictId/actions',(req,body,session)=>repository.actConflict(req.params.conflictId,body,session));
  write('post','/conflicts/:conflictId/facts',(req,body,session)=>repository.createConflictFact(req.params.conflictId,body,session));
  write('post','/from-work-packages/:packageId',(req,body,session)=>repository.fromWorkPackage(req.params.packageId,body,session));
  write('post','/work-packages/:packageId/intakes',(req,body,session)=>repository.prepareIntake(req.params.packageId,body,session));
  write('post','/intakes/:intakeId/reviews',(req,body,session)=>repository.reviewIntake(req.params.intakeId,body,session));
  write('post','/intakes/:intakeId/facts',(req,body,session)=>repository.createFact(req.params.intakeId,body,session,{kind:'intake'}));
  write('post','/work-packages/:packageId/corrections',(req,body,session)=>repository.createCorrection(req.params.packageId,body,session));
  write('patch','/corrections/:correctionId',(req,body,session)=>repository.saveCorrection(req.params.correctionId,body,session));
  write('post','/corrections/:correctionId/reviews',(req,body,session)=>repository.reviewCorrection(req.params.correctionId,body,session));
  write('post','/corrections/:correctionId/facts',(req,body,session)=>repository.createFact(req.params.correctionId,body,session));
  write('post','/facts/:factId/answers',(req,body,session)=>repository.answerFact(req.params.factId,body,session));
  write('post','/facts/:factId/closures',(req,body,session)=>repository.closeFact(req.params.factId,body,session));
  write('post','/facts/:factId/confirmations',(req,body,session)=>repository.confirmFact(req.params.factId,body,session));
  router.get('/:handoffId/conflicts',action(req=>repository.listConflicts(req.params.handoffId,req.session)));
  router.get('/:handoffId/source-upgrade-assessments',action(req=>repository.getSourceUpgradeAssessments(req.params.handoffId,req.session)));
  write('post','/:handoffId/source-upgrade-assessments',(req,body,session)=>repository.assessSourceUpgrade(req.params.handoffId,body,session));
  write('post','/:handoffId/conflicts',(req,body,session)=>repository.createConflict(req.params.handoffId,body,session));
  router.get('/:handoffId/revisions/:revision',action(req=>repository.get(req.params.handoffId,req.session,{revisionNo:req.params.revision})));
  router.get('/:handoffId',action(req=>repository.get(req.params.handoffId,req.session)));
  write('patch','/:handoffId/draft',(req,body,session)=>repository.saveDraft(req.params.handoffId,body,session));
  write('post','/:handoffId/rebase',(req,body,session)=>repository.rebase(req.params.handoffId,body,session));
  write('post','/:handoffId/submit',(req,body,session)=>repository.submit(req.params.handoffId,body,session));
  write('post','/:handoffId/checks',(req,body,session)=>repository.checks(req.params.handoffId,body,session));
  write('post','/:handoffId/approvals',(req,body,session)=>repository.approve(req.params.handoffId,body,session));
  write('post','/:handoffId/publish',(req,body,session)=>repository.publish(req.params.handoffId,body,session));
  write('post','/:handoffId/withdraw',(req,body,session)=>repository.withdraw(req.params.handoffId,body,session));
  return router;
}
module.exports={createRouter};
