import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALL_DATASETS,quantityAliases,historyDatasets} from './datasets.mjs';
import {validateQuantityReport} from './quantity-review.mjs';
const app=fileURLToPath(new URL('.',import.meta.url));
export async function buildQuantityReview(stage,batchId,frozen){
 await writeFile(join(stage,'quantity-inputs.json'),JSON.stringify({batchId,ruleVersion:frozen.version,aliases:quantityAliases,historyDatasets,queryHashes:frozen.queryHashes,objects:Object.fromEntries(Object.entries(ALL_DATASETS).map(([key,meta])=>[key,meta.object]))}),{flag:'wx'});
 await new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','audit-quantity.py'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;
  const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('QUANTITY_ANALYSIS_TIMEOUT'));},600000);
  child.stderr.on('data',chunk=>{diagnostics=(diagnostics+chunk.toString('utf8')).slice(-4096);});
  child.on('error',()=>finish(new Error('QUANTITY_ANALYSIS_START_FAILED')));
  child.on('exit',async code=>{if(code===0){finish();return;}await writeFile(join(stage,'quantity-analysis-error.txt'),diagnostics).catch(()=>{});finish(new Error('QUANTITY_ANALYSIS_FAILED'));});
 });
 const report=validateQuantityReport(JSON.parse(await readFile(join(stage,'quantity','review.json'),'utf8')),batchId);
 for(const file of Object.values(report.files)){const hash=createHash('sha256');for await(const chunk of createReadStream(join(stage,'quantity',file.file)))hash.update(chunk);if(hash.digest('hex')!==file.sha256)throw new Error('QUANTITY_REVIEW_INVALID');}
 return report;
}
