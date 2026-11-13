// Append an already reviewed, hashed local package to its original successful
// batch. Inputs: data root, package folder. No source-system connection or overwrite.
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../store.mjs';
import {readOrderChecks} from '../order-checks.mjs';
import {readFile} from 'node:fs/promises';
const [root,folder]=process.argv.slice(2);
if(!root||!folder)throw new Error('DATA_ROOT_AND_PACKAGE_REQUIRED');
const meta=JSON.parse(await readFile(join(folder,'review.json'),'utf8'));
const data=await readOrderChecks(folder,meta.batchId),store=new Store(join(root,'results.sqlite'));
try{
 const original=store.quantityReview(meta.batchId);
 if(createHash('sha256').update(JSON.stringify(original)).digest('hex')!==meta.quantityReportSha256)throw new Error('ORIGINAL_QUANTITY_REPORT_MISMATCH');
 store.preserveOrderChecks(meta.batchId,data);
 console.log(JSON.stringify({batchId:meta.batchId,status:'appended',summary:meta.summary,originalBatchUnchanged:true}));
}finally{store.close();}
