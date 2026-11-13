import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
export const checkClasses=['confirmed_numeric_difference','pending_evidence'];
export const checkSources=['u8-sales','u8-production','u8-parts','u8-bom','u8-bom-components','mes-intermediate','kfu-production','mes-tasks','mes-outline-changes','mes-travelers','u8-quantity-enums','u8-allocations'];
const app=fileURLToPath(new URL('.',import.meta.url));
const invalid=()=>{throw new Error('ORDER_CHECKS_INVALID');};
export function validateOrderChecks(report,rows,batch){
 if(report?.version!==1||report.batchId!==batch||report.status!=='available'||!['full_inventory','preserved_review'].includes(report.provenance?.kind)||!Array.isArray(report.sourceManifest)||!Array.isArray(report.columns)||new Set(report.columns).size!==report.columns.length||report.rows?.file!=='rows.ndjson'||!/^\w{64}$/.test(report.rows?.sha256||'')||!Array.isArray(rows))invalid();
 const ids=new Set(),orders=new Set(),details=new Set(),categories={},counts={confirmed_numeric_difference:0,pending_evidence:0};
 for(const row of rows){
  const v=row.values;if(typeof row.id!=='string'||!row.id||row.id.length>220||ids.has(row.id)||!checkClasses.includes(row.classification)||typeof row.category!=='string'||!row.category||typeof row.salesOrder!=='string'||typeof row.salesDetailId!=='string'||!Array.isArray(row.productionOrders)||!row.productionOrders.every(s=>typeof s==='string'&&s&&s.length<=128)||new Set(row.productionOrders).size!==row.productionOrders.length||!v||v['盘点编号']!==batch||v['核查项编号']!==row.id||v['核查项目']!==row.category||v['销售订单']!==row.salesOrder||v['销售明细编号']!==row.salesDetailId||v['分类']!==({confirmed_numeric_difference:'已确认数值差异',pending_evidence:'依据不足待核查'}[row.classification]))invalid();
  if(JSON.stringify(row.productionOrders)!==JSON.stringify([...new Set(v['生产订单'].split(/[；、]/).filter(Boolean))])||Object.keys(v).some(k=>!report.columns.includes(k)))invalid();
  ids.add(row.id);counts[row.classification]++;categories[row.category]=(categories[row.category]||0)+1;if(row.salesOrder)orders.add(row.salesOrder);if(row.salesDetailId)details.add(row.salesDetailId);
 }
 const s=report.summary;if(!s||s.total!==rows.length||report.rows.count!==rows.length||s.confirmed!==counts.confirmed_numeric_difference||s.pending!==counts.pending_evidence||s.salesOrders!==orders.size||s.salesDetails!==details.size||Object.keys(categories).length!==Object.keys(report.categories||{}).length||Object.entries(categories).some(([k,n])=>report.categories[k]!==n))invalid();
 return report;
}
export async function readOrderChecks(folder,batch){
 const report=JSON.parse(await readFile(join(folder,'review.json'),'utf8')),rows=[],hash=createHash('sha256');
 for await(const chunk of createReadStream(join(folder,'rows.ndjson')))hash.update(chunk);
 if(hash.digest('hex')!==report.rows?.sha256)invalid();
 for await(const line of createInterface({input:createReadStream(join(folder,'rows.ndjson')),crlfDelay:Infinity}))if(line)rows.push(JSON.parse(line));
 validateOrderChecks(report,rows,batch);return {report,rows};
}
export async function buildOrderChecks(stage,batch,options={}){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','order-checks.py'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('ORDER_CHECKS_TIMEOUT'));},600000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-4096);});
  child.on('error',()=>finish(new Error('ORDER_CHECKS_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'order-checks-error.txt'),diagnostics).catch(()=>{});finish(new Error('ORDER_CHECKS_FAILED'));});
 });
 if(options.deferRows)return {deferred:true};
 const result=await readOrderChecks(join(stage,'order-checks'),batch);
 if(result.report.quantityReportSha256!==createHash('sha256').update(await readFile(join(stage,'quantity','review.json'))).digest('hex'))invalid();
 return result;
}
export function checkFilters(params){
 const allowed=['batch','classification','salesOrder','productionOrder','page','pageSize'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new Error('INVALID_QUERY');
 const batch=params.get('batch');if(!/^[\w-]{1,80}$/.test(batch||''))throw new Error('INVALID_BATCH');
 const classification=params.get('classification')||'all';if(classification!=='all'&&!checkClasses.includes(classification))throw new Error('INVALID_QUERY');
 const salesOrder=params.get('salesOrder')||'',productionOrder=params.get('productionOrder')||'';if(salesOrder.length>128||productionOrder.length>128)throw new Error('INVALID_QUERY');
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||50);if(!Number.isSafeInteger(page)||page<1||page>1000000||![20,50,100].includes(pageSize))throw new Error('INVALID_PAGE');
 return {batch,classification,salesOrder,productionOrder,page,pageSize};
}
