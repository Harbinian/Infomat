// Published batch reports and the retained standalone report have distinct paths.
import {readFile,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
export const quantityKinds=['sales','mes','bom','allocation','demand','changes'];
export const batchQuantityKinds=[...quantityKinds,'history','scope'];
export function validateQuantityReport(report,batchId=null){
 if(!report||![1,2].includes(report.version)||report.status!=='待核查'||!Array.isArray(report.reads)||!report.reads.length||!report.summary||!report.counts||!report.examples||!Array.isArray(report.limitations))throw new Error('QUANTITY_REVIEW_INVALID');
 if(batchId&&(report.version!==2||report.batchId!==batchId||report.reviewId!==batchId||!Array.isArray(report.sourceManifest)||!report.sourceManifest.length))throw new Error('QUANTITY_REVIEW_INVALID');
 for(const key of report.version===2?batchQuantityKinds:quantityKinds){
  if(key==='scope'&&!report.files?.scope)continue; // Frozen reports before scope detail collection remain valid.
  const file=report.files?.[key],counts=Object.values(report.counts[key]||{});
  if(!file||file.file!==key+'.csv'||!Number.isSafeInteger(file.rows)||file.rows<0||!/^[a-f0-9]{64}$/.test(file.sha256)||counts.some(n=>!Number.isSafeInteger(n)||n<0)||counts.reduce((a,b)=>a+b,0)!==file.rows)throw new Error('QUANTITY_REVIEW_INVALID');
 }
 if(report.files.sales.rows!==report.summary.sales||report.files.bom.rows!==report.summary.production||report.files.allocation.rows!==report.summary.orderAllocations)throw new Error('QUANTITY_REVIEW_INVALID');
 if(batchId){const names=new Set();for(const source of report.sourceManifest){if(names.has(source.dataset)||source.status!=='succeeded'||!Number.isSafeInteger(source.count)||source.count<0||!/^[a-f0-9]{64}$/.test(source.sha256)||!/^[a-f0-9]{64}$/.test(source.querySha256)||source.file!==source.dataset+'.ndjson')throw new Error('QUANTITY_REVIEW_INVALID');names.add(source.dataset);}}
 return report;
}
export async function readQuantityReview(root){
 let report;try{report=JSON.parse(await readFile(join(root,'quantity-review','review.json'),'utf8'));}catch{throw new Error('QUANTITY_REVIEW_UNAVAILABLE');}
 return validateQuantityReport(report);
}
const verified=new Map();
export async function quantityExport(root,key,batchReport=null){
 if(!(batchReport?batchQuantityKinds:quantityKinds).includes(key))throw new Error('INVALID_QUERY');
 const report=batchReport?validateQuantityReport(batchReport,batchReport.batchId):await readQuantityReview(root),file=report.files[key];
 if(batchReport&&!/^[\w-]{1,80}$/.test(report.batchId))throw new Error('INVALID_BATCH');
 if(!file)throw new Error('QUANTITY_REVIEW_NOT_COLLECTED');
 const path=batchReport?join(root,'batches',report.batchId,'quantity',file.file):join(root,'quantity-review',file.file);
 let info;try{info=await stat(path);}catch{throw new Error('QUANTITY_REVIEW_UNAVAILABLE');}
 const signature=[file.sha256,info.size,info.mtimeMs].join(':');
 if(verified.get(path)!==signature){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);if(hash.digest('hex')!==file.sha256)throw new Error('QUANTITY_REVIEW_INVALID');verified.set(path,signature);}
 return {path,name:`quantity-review-${batchReport?report.batchId+'-':''}${key}.csv`,size:info.size};
}
