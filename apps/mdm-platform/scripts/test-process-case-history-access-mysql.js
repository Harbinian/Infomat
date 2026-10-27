// Real owned MySQL + HTTP read-scope regression. Session establishment is a
// synthetic fixture; requireAuth, current role reads, routes and repositories run.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const rolesPath=require.resolve('../server/roleDefinitions'),current=require(rolesPath),baseline=require('../server/accessModelV4Baseline');
const byCode=new Map(baseline.ROLE_GUIDES.map(r=>[r.code,r]));
require.cache[rolesPath]={id:rolesPath,filename:rolesPath,loaded:true,exports:{...current,ACCESS_MODEL_VERSION:baseline.ACCESS_MODEL_VERSION,
  ROLE_GUIDES:current.ROLE_GUIDES.filter(r=>byCode.has(r.code)).map(r=>({...r,permissions:byCode.get(r.code).permissions}))}};
process.env.PROCESS_V7_PREVIEW_ENABLED='1';process.env.PROCESS_V7_FORMAL_ENABLED='0';process.env.PROCESS_V7_AUTHORING_ENABLED='0';process.env.MDM_IDENTITY_READ_MODEL='mysql';process.env.MDM_DB_QUIET='1';
const {withFreshMysql}=require('./testHelpers/freshMysql'),fixture=require('./testHelpers/processCaseGovernanceFixture');
const {makeProcessPreviewReviewRepository}=require('../server/processPreviewReviewRepository'),gov=require('../server/processCaseGovernance');
const {validateAndProjectProcess}=require('../server/processPreviewReview');
const ownFiles=['server/processCaseGovernance.js','server/processPreviewReviewRepository.js','server/routes/processPreviewReview.js'].map(p=>'apps/mdm-platform/'+p);
const hashes=()=>Object.fromEntries(ownFiles.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const sourceHashes=hashes(),checks=[];
async function main(){await withFreshMysql(async({pool,database,owner})=>{
  const actors=await fixture.seed(pool),repo=makeProcessPreviewReviewRepository(pool),departments=await repo.listDepartments();
  const original=fixture.document(),preview=validateAndProjectProcess(original,departments);
  const created=await repo.createCase(preview,{sourceFileName:'synthetic-history.json',submission:fixture.submission(['91','92'])},actors.contactA),caseId=created.case.id;
  await fixture.completeSidecar(repo,caseId,actors,['91','92']);
  const shrink=await fixture.act(repo,caseId,'propose',actors.contactA,{kind:'scope',reason:'Synthetic explicit exit',participants:fixture.participants(['91'])});
  await fixture.act(repo,caseId,'confirm',actors.headA,{},shrink.result.change_id);await fixture.act(repo,caseId,'confirm',actors.headB,{},shrink.result.change_id);await fixture.act(repo,caseId,'register',actors.lead,{},shrink.result.change_id);
  const future=structuredClone(original);future.process.purpose='Synthetic future facts outside exited scope';future.process.process_name='Synthetic future private title';
  let detail=await repo.getCaseDetail(caseId);
  await repo.addRevision(detail.case,validateAndProjectProcess(future,departments),{sourceFileName:'synthetic-future.json',expectedRevisionNo:1,expectedContentHash:preview.contentHash,submission:fixture.submission()},actors.contactA);
  detail=await repo.getCaseDetail(caseId);
  const departed={...actors.headB,departmentId:'92',permissions:new Set(['governance:read-department']),roleCodes:new Set(['department_mdm_reviewer'])};
  assert.deepEqual(await gov.readAccess(pool,detail.case,departed),{current:false,max_revision_no:1});
  assert.deepEqual((await repo.historicalRevision(caseId,created.revision.id,departed)).revision.document,original);
  await assert.rejects(()=>repo.historicalRevision(caseId,detail.revision.id,departed),e=>e.statusCode===403);
  await assert.rejects(()=>repo.formalControls(caseId,departed),e=>e.statusCode===403);
  checks.push('exited department reads bound history but cannot read new revision or controls');
  const express=require('express'),auth=require('../server/auth'),router=require('../server/routes/processPreviewReview');
  auth.setIdentityRepositoryFactory(()=>require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool));router.setProcessPreviewRepositoryFactory(()=>repo);
  const app=express();app.use(express.json());app.use((req,res,next)=>{const who=req.headers['x-synthetic-person']==='18'?actors.headA:actors.headB;req.session={...who,departmentId:who===actors.headA?'91':'92'};next();});app.use('/api/process-v7-preview',router);
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  try{
    const base='http://127.0.0.1:'+server.address().port+'/api/process-v7-preview';assert.ok(![3000,3001].includes(server.address().port));
    async function get(route,person='20'){const response=await fetch(base+route,{headers:{'x-synthetic-person':person}});return {status:response.status,body:await response.json()};}
    for(const suffix of ['', '/governance','/formal-controls','/revisions/'+detail.revision.id+'/document'])assert.equal((await get('/cases/'+caseId+suffix)).status,403,suffix);
    const history=await get('/cases/'+caseId+'/history?limit=1');assert.equal(history.status,200);assert.equal(history.body.history_revision_limit,1);assert.equal(history.body.historical_only,true);assert.ok(history.body.revisions.every(r=>r.revision_no<=1));
    const download=await get('/cases/'+caseId+'/revisions/'+created.revision.id+'/document');assert.equal(download.status,200);assert.deepEqual(download.body,original);
    const currentHead=await get('/cases/'+caseId,'18');assert.equal(currentHead.status,200);assert.equal(currentHead.body.revision.revision_no,2);
    const listing=await get('/cases');assert.equal(listing.status,200);const row=listing.body.items.find(x=>x.id===caseId);assert.equal(row.historical_only,true);assert.equal(row.history_revision_limit,1);assert.equal(row.process_name,original.process.process_name);assert.equal(row.current_content_hash,undefined);
    checks.push('real HTTP case, governance, controls and document routes enforce exit cap; history and old download remain available; list redacts future metadata');
  }finally{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));auth.resetIdentityRepositoryFactory();router.resetProcessPreviewRepositoryFactory();}
  const transferSource=fixture.document(),transferPreview=validateAndProjectProcess(transferSource,departments);
  const transferCase=await repo.createCase(transferPreview,{sourceFileName:'synthetic-owner-history.json',submission:fixture.submission()},actors.contactA);await fixture.completeSidecar(repo,transferCase.case.id,actors);
  const transfer=await fixture.act(repo,transferCase.case.id,'propose',actors.contactA,{kind:'owner',reason:'Synthetic true responsibility transfer',target_department_id:'92',duty_impact:'Synthetic transferred duties',pending_work:'Synthetic current work'});
  for(const who of [actors.headA,actors.headB])await fixture.act(repo,transferCase.case.id,'confirm',who,{},transfer.result.change_id);await fixture.act(repo,transferCase.case.id,'register',actors.lead,{},transfer.result.change_id);
  const scope=await fixture.act(repo,transferCase.case.id,'propose',actors.contactB,{kind:'scope',reason:'Synthetic separately confirmed transferred scope',participants:fixture.participants(['92'])});
  for(const who of [actors.headA,actors.headB])await fixture.act(repo,transferCase.case.id,'confirm',who,{},scope.result.change_id);await fixture.act(repo,transferCase.case.id,'register',actors.lead,{},scope.result.change_id);
  const receiver=structuredClone(transferSource);receiver.process.owning_department='Synthetic B';receiver.behaviors[0].current_actor_role='Synthetic B核对人';receiver.process.purpose='Synthetic receiver revision';
  let transferred=await repo.getCaseDetail(transferCase.case.id);
  await repo.addRevision(transferred.case,validateAndProjectProcess(receiver,departments),{sourceFileName:'synthetic-receiver.json',expectedRevisionNo:1,expectedContentHash:transferPreview.contentHash,submission:fixture.submission(['92'])},actors.contactB);
  transferred=await repo.getCaseDetail(transferCase.case.id);
  const oldOwner={...actors.headA,departmentId:'91',permissions:new Set(['governance:read-department']),roleCodes:new Set(['department_mdm_reviewer'])};
  assert.deepEqual(await gov.readAccess(pool,transferred.case,oldOwner),{current:false,max_revision_no:1});
  assert.deepEqual((await repo.historicalRevision(transferCase.case.id,transferCase.revision.id,oldOwner)).revision.document,transferSource);
  await assert.rejects(()=>repo.historicalRevision(transferCase.case.id,transferred.revision.id,oldOwner),e=>e.statusCode===403);
  const events=await repo.history(transferCase.case.id,oldOwner,{limit:100});assert.equal(events.history_revision_limit,1);assert.ok(events.revisions.every(r=>r.revision_no<=1));
  checks.push('former owner retains fixed transfer history and cannot read receiver future revision');
  assert.deepEqual(hashes(),sourceHashes);
  const out=path.resolve(__dirname,'../../../artifacts/3000-joint-governance-deploy-20261020-01/process-case-history-access.json');fs.writeFileSync(out,JSON.stringify({status:'passed',database,owner,checks,source_sha256:sourceHashes,source_unchanged:true,session_establishment:'synthetic fixture',authorization:'real requireAuth and current MySQL identity',business_accepted:false,formal_database_connected:false},null,2)+'\n');console.log(JSON.stringify({status:'passed',checks:checks.length,output:out}));
},{stage:'84',randomDatabase:true});}
main().catch(error=>{console.error(JSON.stringify({code:error.code,message:error.message,stack:error.stack}));process.exitCode=1;});
