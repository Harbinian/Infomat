// Publish a fully calculated batch in a separate process so large immutable
// evidence validation and compression do not block the HTTP event loop.
// Only the application's local result database is writable; no source reader
// or source database connection is used here.
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {Store} from './store.mjs';
import {DATASETS,reconcile} from './reconcile.mjs';
import {freezeRules} from './collector.mjs';
import {validateQuantityReport} from './quantity-review.mjs';
import {readOrderChecks} from './order-checks.mjs';
import {readMaterialChecks} from './material-checks.mjs';
import {readChainChecks} from './chain-checks.mjs';
import {readProcessingChecks} from './processing-checks.mjs';

const root=process.argv[2],id=process.argv[3];
if(!root||!/^[-\w]{1,100}$/.test(id||''))throw new Error('PUBLICATION_ARGUMENTS_INVALID');
const stage=join(root,'batches',id),input=JSON.parse(await readFile(join(stage,'publication-inputs.json'),'utf8'));
const frozen=JSON.parse(await readFile(join(stage,'rules-frozen.json'),'utf8')),current=await freezeRules();
if(input.batchId!==id||input.rulesSha256!==frozen.rulesSha256||current.rulesSha256!==frozen.rulesSha256||JSON.stringify(current.queryHashes)!==JSON.stringify(frozen.queryHashes)||JSON.stringify(current.implementationHashes)!==JSON.stringify(frozen.implementationHashes))throw new Error('PUBLICATION_CONTRACT_CHANGED');
const digestFile=async path=>{const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');};
if(input.reads.length!==Object.keys(frozen.queryHashes).length||new Set(input.reads.map(r=>r.dataset)).size!==input.reads.length)throw new Error('PUBLICATION_SOURCE_MISMATCH');
for(const read of input.reads){
 const path=join(stage,read.dataset+'.ndjson'),audit=JSON.parse(await readFile(path+'.audit.json','utf8'));
 if(read.status!=='succeeded'||audit.status!=='succeeded'||read.count!==audit.count||read.sha256!==audit.sha256||read.querySha256!==frozen.queryHashes[read.dataset]||audit.querySha256!==read.querySha256||await digestFile(path)!==read.sha256)throw new Error('PUBLICATION_SOURCE_MISMATCH');
}
const quantity=validateQuantityReport(JSON.parse(await readFile(join(stage,'quantity','review.json'),'utf8')),id);
for(const file of Object.values(quantity.files))if(await digestFile(join(stage,'quantity',file.file))!==file.sha256)throw new Error('PUBLICATION_QUANTITY_MISMATCH');
// Validate the large row file before loading the original ledger arrays.
const processing=await readProcessingChecks(join(stage,'processing-checks'));
const checks=await readOrderChecks(join(stage,'order-checks'),id),materials=await readMaterialChecks(join(stage,'material-checks')),chains=await readChainChecks(join(stage,'chain-checks'));
const statistics=JSON.parse(await readFile(join(stage,'unified-statistics','review.json'),'utf8'));
if(statistics.database?.sha256!==input.statisticsSha256)throw new Error('PUBLICATION_STATISTICS_MISMATCH');
const datasets={};
for(const key of Object.keys(DATASETS)){
 const audit=input.reads.find(r=>r.dataset===key),rows=[],stream=createReadStream(join(stage,key+'.ndjson')),hash=createHash('sha256');
 stream.on('data',chunk=>hash.update(chunk));
 for await(const line of createInterface({input:stream,crlfDelay:Infinity}))if(line){const row=JSON.parse(line);if(row._expectedCount!==String(audit.count))throw new Error('SOURCE_COMPLETENESS_MISMATCH');rows.push(row);}
 if(rows.length!==audit.count||hash.digest('hex')!==audit.sha256)throw new Error('SOURCE_COMPLETENESS_MISMATCH');datasets[key]=rows;
}
const result=reconcile(datasets,input.reads),store=new Store(join(root,'results.sqlite'));
try{
 store.publish(id,datasets,input.reads,result,quantity,checks,materials,chains,statistics,processing);
 await writeFile(join(stage,'publication-result.json'),JSON.stringify({batchId:id,published:true,snapshotRecords:Object.values(datasets).reduce((n,v)=>n+v.length,0),sourceRecords:input.reads.reduce((n,r)=>n+r.count,0),quantityReview:{batchId:id,version:quantity.version,files:quantity.files},processing:processing.report.summary}),{flag:'wx'});
 console.log(JSON.stringify({batchId:id,published:true,processing:processing.report.summary}));
}finally{store.close();}
