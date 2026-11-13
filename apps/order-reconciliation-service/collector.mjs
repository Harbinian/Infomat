import {spawn} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DATASETS,reconcile} from './reconcile.mjs';
import {ALL_DATASETS} from './datasets.mjs';
import {buildQuantityReview} from './quantity-runner.mjs';
import {buildOrderChecks,readOrderChecks} from './order-checks.mjs';
import {buildMaterialChecks,readMaterialChecks} from './material-checks.mjs';
import {buildChainChecks,readChainChecks} from './chain-checks.mjs';
import {buildProcessingChecks,readProcessingChecks} from './processing-checks.mjs';
import {buildUnifiedStatistics} from './unified-statistics.mjs';
const app=fileURLToPath(new URL('.',import.meta.url));
const digest = text=>createHash('sha256').update(text).digest('hex');
const implementationFiles=['reconcile.mjs','bridge.ps1','store.mjs','source-node.mjs','datasets.mjs','collector.mjs','publication-worker.mjs','quantity-runner.mjs','quantity-review.mjs','scripts/audit-quantity.py','order-checks.mjs','scripts/order-checks.py','material-checks.mjs','scripts/material-checks.py','chain-checks.mjs','scripts/chain-checks.py','processing-checks.mjs','scripts/processing-checks.py','unified-statistics.mjs','statistics-inputs.mjs','scripts/unified-statistics.py','scripts/risk-context.py','risk-policy.json','scripts/check-persistence.py'];
const implementationHashes=Object.fromEntries(await Promise.all(implementationFiles.map(async name=>[name,digest(await readFile(join(app,name),'utf8'))])));
export function validateRules(rules){
 if(!/^[a-zA-Z0-9-]{1,80}$/.test(rules.version||'') || rules.scope?.account!=='333' || rules.scope?.u8Database!=='UFDATA_333_2025' || JSON.stringify(rules.scope?.productionStatuses)!=='[3,4]' || rules.productionNumber?.type!=='string' || rules.productionNumber?.length!==18 || rules.productionNumber?.comparison!=='raw-exact' || rules.qualityNumber?.normalization!=='none' || rules.qualityNumber?.nullFallback!==false || rules.execution?.anyRequiredReadFailure!=='fail-entire-batch')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.quantityReview?.enabled!==true||rules.quantityReview.version!==2||rules.quantityReview.historyPolicy!=='order-adopted-bom-and-explicit-change-scope')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.orderChecks?.enabled!==true||rules.orderChecks.version!==1)throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.materialChecks?.enabled!==true||rules.materialChecks.version!==1||rules.materialChecks.historyPolicy!=='order-adopted-bom-and-explicit-change-scope')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.unifiedStatistics?.enabled!==true||rules.unifiedStatistics.version!==1||rules.unifiedStatistics.policy!=='review-priority-v1')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.unifiedStatistics.persistence?.enabled!==true||rules.unifiedStatistics.persistence.version!==1||rules.unifiedStatistics.persistence.failedBatch!=='break-observation')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.chainChecks?.enabled!==true||rules.chainChecks.version!==1||rules.chainChecks.history!=='append-only-no-recalculation'||rules.chainChecks.actions!=='read-only-no-unlock-no-voucher')throw new Error('UNSUPPORTED_RULE_CONFIG');
 if(rules.processingChecks?.enabled!==true||rules.processingChecks.version!==1||rules.processingChecks.history!=='append-only-no-recalculation'||rules.processingChecks.quantity!=='actual-progress-audited-signed-net')throw new Error('UNSUPPORTED_RULE_CONFIG');
}
export async function freezeRules(){
 const content=await readFile(join(app,'rules.json'),'utf8');const rules=JSON.parse(content);
 validateRules(rules);
 for(const name of implementationFiles)if(digest(await readFile(join(app,name),'utf8'))!==implementationHashes[name])throw new Error('IMPLEMENTATION_RESTART_REQUIRED');
 const queries={};for(const key of Object.keys(rules.quantityReview?.enabled?ALL_DATASETS:DATASETS))queries[key]=digest(await readFile(join(app,'sql',key+'.sql'),'utf8'));
 return {...rules,rulesSha256:digest(content),queryHashes:queries,implementationHashes};
}
export async function readDataset(key,stage,frozen){
 const output=join(stage,key+'.ndjson');
 const meta=ALL_DATASETS[key],retainRows=Boolean(DATASETS[key])&&!frozen.unifiedStatistics?.enabled;
 if(process.env.ORDER_DB_DRIVER==='node'){
  const {readNodeDataset}=await import('./source-node.mjs');
  const result=await readNodeDataset({key,source:meta.source,queryFile:join(app,'sql',key+'.sql'),outputFile:output,expectedHash:frozen.queryHashes[key],retainRows});
  return {rows:result.rows,audit:{...result.audit,dataset:key,object:meta.object}};
 }
 const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',join(app,'bridge.ps1'),'-Source',meta.source,'-QueryFile',join(app,'sql',key+'.sql'),'-OutputFile',output,'-ExpectedHash',frozen.queryHashes[key]];
 await new Promise((resolve,reject)=>{
  // A Node process launched by PowerShell 7 can inherit its module path. The
  // Windows PowerShell bridge needs the OS modules, not incompatible PS7 ones.
  const child=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','ignore','pipe'],env:{...process.env,PSModulePath:join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','Modules')}});
  let diagnostics='';child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString()).slice(-2048);});
  const timer=setTimeout(()=>{child.kill();reject(new Error(`SOURCE_TIMEOUT:${key}`));},120000);
  child.on('error',()=>{clearTimeout(timer);reject(new Error(`SOURCE_START_FAILED:${key}`));});
  child.on('exit',code=>{clearTimeout(timer);if(code===0)resolve();else reject(new Error(`SOURCE_READ_FAILED:${key}`));});
 });
 const audit=JSON.parse((await readFile(output+'.audit.json','utf8')).replace(/^\uFEFF/,''));
 if(audit.status!=='succeeded'||audit.querySha256!==frozen.queryHashes[key])throw new Error(`SOURCE_AUDIT_MISMATCH:${key}`);
 const rows=[];let count=0;for await(const line of createInterface({input:createReadStream(output),crlfDelay:Infinity}))if(line){const row=JSON.parse(line);count++;if(BigInt(row._expectedCount)!==BigInt(audit.count))throw new Error(`SOURCE_COMPLETENESS_MISMATCH:${key}`);if(retainRows)rows.push(row);}
 if(audit.count!==count)throw new Error(`SOURCE_COMPLETENESS_MISMATCH:${key}`);
 return {rows,audit:{...audit,dataset:key,object:meta.object}};
}
async function publishInWorker(stage,id,root,frozen,reads,statistics,store){
 await writeFile(join(stage,'publication-inputs.json'),JSON.stringify({batchId:id,rulesSha256:frozen.rulesSha256,reads,statisticsSha256:statistics.database.sha256}),{flag:'wx'});
 let diagnosticFailure=null;
 try{await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--max-old-space-size=2048',join(app,'publication-worker.mjs'),root,id],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('PUBLICATION_TIMEOUT'));},1800000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-6000);});
  child.on('error',()=>finish(new Error('PUBLICATION_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'publication-error.txt'),diagnostics).catch(()=>{});finish(new Error('PUBLICATION_FAILED'));});
 });}catch(error){if(store.get(id)?.status!=='succeeded')throw error;diagnosticFailure=error.message;}
 if(store.get(id)?.status!=='succeeded')throw new Error('PUBLICATION_RESULT_INVALID');
 if(!diagnosticFailure){try{const result=JSON.parse(await readFile(join(stage,'publication-result.json'),'utf8'));if(result.batchId===id&&result.published===true)return result;diagnosticFailure='PUBLICATION_DIAGNOSTIC_INVALID';}catch{diagnosticFailure='PUBLICATION_DIAGNOSTIC_UNAVAILABLE';}}
 // The committed transaction is authoritative. A later diagnostic-file error
 // must not turn an already published batch into a contradictory failure.
 const quantity=store.quantityReview(id),result={batchId:id,published:true,diagnosticFailure,snapshotRecords:reads.filter(r=>DATASETS[r.dataset]).reduce((n,r)=>n+r.count,0),sourceRecords:reads.reduce((n,r)=>n+r.count,0),quantityReview:{batchId:id,version:quantity.version,files:quantity.files},processing:store.processing.review(id).summary};
 await writeFile(join(stage,'publication-recovery.json'),JSON.stringify(result),{flag:'wx'}).catch(()=>{});return result;
}
export class Runner {
 constructor(store,root,{read=readDataset,freeze=freezeRules,quantity=buildQuantityReview,checks=buildOrderChecks,materials=buildMaterialChecks,chains=buildChainChecks,processing=buildProcessingChecks,statistics=buildUnifiedStatistics}={}){this.store=store;this.root=root;this.active=null;this.read=read;this.freeze=freeze;this.quantity=quantity;this.checks=checks;this.materials=materials;this.chains=chains;this.processing=processing;this.statistics=statistics;}
 async start(){
  if(this.active)throw new Error('BATCH_ALREADY_RUNNING');
  const id=new Date().toISOString().replace(/[-:.]/g,'').replace('Z','')+'-'+randomUUID().slice(0,8);
  // Claim before asynchronous reads so two simultaneous POSTs cannot both start.
  this.active=id;
  try{const frozen=await this.freeze();this.store.begin(id,frozen);this.task=this.run(id,frozen);return id;}
  catch(error){this.active=null;throw error;}
 }
 async run(id,frozen){
  const reads=[];const datasets={};
  try{
   const stage=join(this.root,'batches',id);await mkdir(stage,{recursive:true});await writeFile(join(stage,'rules-frozen.json'),JSON.stringify(frozen,null,2));
   // Sources read concurrently; tables within each source are read sequentially
   // to limit load. Nothing is published until all three source chains finish.
   const outcomes=await Promise.allSettled(['u8','kfu','mes'].map(async source=>{
    for(const [key,meta] of Object.entries(frozen.quantityReview?.enabled?ALL_DATASETS:DATASETS))if(meta.source===source){
     const {rows,audit}=await this.read(key,stage,frozen);if(DATASETS[key])datasets[key]=rows;reads.push(audit);this.store.progress(id,reads);
    }
   }));
   const failure=outcomes.find(r=>r.status==='rejected');if(failure)throw failure.reason;
   const quantity=frozen.quantityReview?.enabled?await this.quantity(stage,id,frozen):null;
   let checks=frozen.orderChecks?.enabled?await this.checks(stage,id,{deferRows:Boolean(frozen.unifiedStatistics?.enabled)}):null;
   let materials=frozen.materialChecks?.enabled?await this.materials(stage,id,{deferRows:Boolean(frozen.unifiedStatistics?.enabled)}):null;
   let chains=frozen.chainChecks?.enabled?await this.chains(stage,id,{deferRows:Boolean(frozen.unifiedStatistics?.enabled)}):null;
   let processing=frozen.processingChecks?.enabled?await this.processing(stage,id,{deferRows:Boolean(frozen.unifiedStatistics?.enabled)}):null;
   const persistence=frozen.unifiedStatistics?.enabled&&frozen.unifiedStatistics.persistence?.enabled?this.store.unified.persistenceContext(id,frozen):null;
   const statistics=frozen.unifiedStatistics?.enabled?await this.statistics(stage,id,frozen,null,persistence):null;
   if(frozen.processingChecks?.enabled&&frozen.unifiedStatistics?.enabled&&this.store.databasePath&&this.store.databasePath!==':memory:'){
    const current=await this.freeze();if(current.rulesSha256!==frozen.rulesSha256||JSON.stringify(current.queryHashes)!==JSON.stringify(frozen.queryHashes))throw new Error('RULE_VERSION_CHANGED');
    const publication=await publishInWorker(stage,id,this.root,frozen,reads,statistics,this.store);
    await writeFile(join(stage,'completion.json'),JSON.stringify({batch:this.store.get(id),storage:'sqlite-and-hashed-batch-files',publicationProcess:'isolated-worker',...publication},null,2));
    return;
   }
   if(frozen.unifiedStatistics?.enabled){
    for(const key of Object.keys(DATASETS)){
     const rows=[],digestFile=createHash('sha256');for await(const chunk of createReadStream(join(stage,key+'.ndjson')))digestFile.update(chunk);
     const audit=reads.find(r=>r.dataset===key);if(digestFile.digest('hex')!==audit?.sha256)throw new Error('SOURCE_COMPLETENESS_MISMATCH');
     for await(const line of createInterface({input:createReadStream(join(stage,key+'.ndjson')),crlfDelay:Infinity}))if(line){const row=JSON.parse(line);if(row._expectedCount!==String(audit.count))throw new Error('SOURCE_COMPLETENESS_MISMATCH');rows.push(row);}
     if(rows.length!==audit.count)throw new Error('SOURCE_COMPLETENESS_MISMATCH');datasets[key]=rows;
    }
    if(checks?.deferred)checks=await readOrderChecks(join(stage,'order-checks'),id);
    if(materials?.deferred)materials=await readMaterialChecks(join(stage,'material-checks'));
    if(chains?.deferred)chains=await readChainChecks(join(stage,'chain-checks'));
    if(processing?.deferred)processing=await readProcessingChecks(join(stage,'processing-checks'));
   }
   const result=reconcile(datasets,reads);
   const current=await this.freeze();if(current.rulesSha256!==frozen.rulesSha256 || JSON.stringify(current.queryHashes)!==JSON.stringify(frozen.queryHashes))throw new Error('RULE_VERSION_CHANGED');
   this.store.publish(id,datasets,reads,result,quantity,checks,materials,chains,statistics,processing);
   await writeFile(join(stage,'completion.json'),JSON.stringify({batch:this.store.get(id),storage:'sqlite-and-hashed-batch-files',snapshotRecords:Object.values(datasets).reduce((n,v)=>n+v.length,0),sourceRecords:reads.reduce((n,r)=>n+r.count,0),quantityReview:quantity?{batchId:id,version:quantity.version,files:quantity.files}:null},null,2));
  }catch(error){
   const code=/^[A-Z_]+(?::[a-z0-9-]+)?$/.test(error.message)?error.message:'BATCH_EXECUTION_FAILED';
   if(this.store.get(id)?.status==='succeeded')await writeFile(join(this.root,'batches',id,'post-publication-diagnostic.txt'),code,{flag:'wx'}).catch(()=>{});
   else this.store.fail(id,`整批失败，未发布有效业务结果（${code}）。源系统业务数据没有修改。`,reads);
  }finally{this.active=null;}
 }
}
