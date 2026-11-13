import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
export const chainSources=['kfu-completion','kfu-completion-control','mes-completion-rules','u8-production-links','u8-product-receipts','u8-allocations'];
export const chainCategories=['backlog','outside_automatic_scope','production_reference_missing','production_reference_conflict','duplicate_part_reference','duplicate_production_reference','completed_without_receipt','completed_with_remaining','pending_with_receipts','receipt_total_difference','receipt_reference_conflict','receipt_audit_pending','quantity_basis_pending','allocation_basis_pending','closed_with_remaining','material_identity_pending'];
const app=fileURLToPath(new URL('.',import.meta.url)),validId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const invalid=()=>{throw new Error('CHAIN_CHECKS_INVALID');};
export function validateChainChecks(report,rows){
 if(report?.version!==1||!validId(report.batchId)||report.status!=='available'||!Array.isArray(report.sourceManifest)||!Array.isArray(report.columns)||!report.columns.length||new Set(report.columns).size!==report.columns.length||report.rows?.file!=='rows.ndjson'||!/^[a-f0-9]{64}$/.test(report.rows.sha256||'')||!Array.isArray(rows)||!Array.isArray(report.controls)||!Array.isArray(report.rules))invalid();
 const ids=new Set(),orders=new Set(),productions=new Set(),interfaces=new Set(),categories={};let confirmed=0,pending=0;
 for(const r of rows){
  if(typeof r.id!=='string'||r.id!==r.category+':'+r.interfaceId||ids.has(r.id)||!/^\d+$/.test(r.interfaceId)||!['confirmed_issue','pending_evidence'].includes(r.classification)||!chainCategories.includes(r.category)||typeof r.categoryLabel!=='string'||typeof r.salesOrder!=='string'||typeof r.productionOrder!=='string'||!Array.isArray(r.productionOrders)||new Set(r.productionOrders).size!==r.productionOrders.length||r.productionOrders.some(v=>typeof v!=='string'||!v)||!r.values||r.values['销售订单']!==r.salesOrder||r.values['生产订单']!==r.productionOrder||r.values['分类']!==({confirmed_issue:'已确认问题',pending_evidence:'依据不足待核查'}[r.classification])||Object.keys(r.values).some(k=>!report.columns.includes(k))||JSON.stringify(r.evidence)!==r.values['完整证据JSON'])invalid();
  ids.add(r.id);interfaces.add(r.interfaceId);categories[r.category]=(categories[r.category]||0)+1;
  if(r.classification==='confirmed_issue')confirmed++;else pending++;
  if(r.salesOrder)orders.add(r.salesOrder);if(r.productionOrder)productions.add(r.productionOrder);
 }
 const s=report.summary;
 if(!s||s.total!==rows.length||s.confirmed!==confirmed||s.pending!==pending||s.interfaceRows!==interfaces.size||report.rows.count!==rows.length||s.salesOrders!==orders.size||s.productionOrders!==productions.size||JSON.stringify(Object.entries(categories).sort())!==JSON.stringify(Object.entries(report.categories||{}).sort()))invalid();
 if(report.sourceManifest.length!==chainSources.length||new Set(report.sourceManifest.map(r=>r.dataset)).size!==chainSources.length)invalid();
 for(const r of report.sourceManifest)if(!chainSources.includes(r.dataset)||r.status!=='succeeded'||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!/^[a-f0-9]{64}$/.test(r.querySha256||''))invalid();
 return report;
}
export async function readChainChecks(folder){
 const report=JSON.parse(await readFile(join(folder,'review.json'),'utf8')),rows=[],hash=createHash('sha256');
 for await(const chunk of createReadStream(join(folder,'rows.ndjson')))hash.update(chunk);
 if(hash.digest('hex')!==report.rows?.sha256)invalid();
 for await(const line of createInterface({input:createReadStream(join(folder,'rows.ndjson')),crlfDelay:Infinity}))if(line)rows.push(JSON.parse(line));
 validateChainChecks(report,rows);return {report,rows};
}
export async function buildChainChecks(stage,batch,options={}){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','chain-checks.py'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('CHAIN_CHECKS_TIMEOUT'));},900000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-4096);});
  child.on('error',()=>finish(new Error('CHAIN_CHECKS_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'chain-checks-error.txt'),diagnostics).catch(()=>{});finish(new Error('CHAIN_CHECKS_FAILED'));});
 });
 if(options.deferRows)return {deferred:true};
 const result=await readChainChecks(join(stage,'chain-checks'));if(result.report.batchId!==batch)invalid();return result;
}
export function chainFilters(params){
 for(const k of params.keys())if(!['batch','classification','category','salesOrder','productionOrder','page','pageSize'].includes(k)||params.getAll(k).length!==1)throw new Error('INVALID_QUERY');
 const batch=params.get('batch');if(!validId(batch))throw new Error('INVALID_QUERY');
 const classification=params.get('classification')||'all',category=params.get('category')||'all';
 if(!['all','confirmed_issue','pending_evidence'].includes(classification)||!['all',...chainCategories].includes(category))throw new Error('INVALID_QUERY');
 const salesOrder=params.get('salesOrder')||'',productionOrder=params.get('productionOrder')||'';
 if([salesOrder,productionOrder].some(v=>v.length>128))throw new Error('INVALID_QUERY');
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||50);if(!Number.isSafeInteger(page)||page<1||page>1000000||![20,50,100].includes(pageSize))throw new Error('INVALID_PAGE');
 return {batch,classification,category,salesOrder,productionOrder,page,pageSize};
}
export class ChainStore{
 constructor(db,getBatch){
  this.db=db;this.getBatch=getBatch;
  db.exec(`CREATE TABLE IF NOT EXISTS chain_reviews(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS chain_checks(batch_id TEXT NOT NULL REFERENCES chain_reviews(batch_id),id TEXT NOT NULL,classification TEXT NOT NULL,category TEXT NOT NULL,sales_order TEXT NOT NULL,production_order TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(batch_id,id));
   CREATE INDEX IF NOT EXISTS chain_checks_filter ON chain_checks(batch_id,classification,category,sales_order);
   CREATE TABLE IF NOT EXISTS chain_production_orders(batch_id TEXT NOT NULL,case_id TEXT NOT NULL,production_order TEXT NOT NULL,PRIMARY KEY(batch_id,case_id,production_order),FOREIGN KEY(batch_id,case_id) REFERENCES chain_checks(batch_id,id));
   CREATE INDEX IF NOT EXISTS chain_production_filter ON chain_production_orders(batch_id,production_order,case_id);`);
 }
 insert(batch,{report,rows},reads){
  validateChainChecks(report,rows);if(report.batchId!==batch)invalid();
  if(this.db.prepare('SELECT 1 FROM chain_reviews WHERE batch_id=?').get(batch))throw new Error('CHAIN_CHECKS_ALREADY_SAVED');
  for(const s of report.sourceManifest){const a=reads.filter(r=>r.dataset===s.dataset);if(a.length!==1||a[0].status!=='succeeded'||a[0].sha256!==s.sha256||a[0].querySha256!==s.querySha256||a[0].count!==s.count)throw new Error('CHAIN_SOURCE_MISMATCH');}
  this.db.prepare('INSERT INTO chain_reviews VALUES(?,?)').run(batch,JSON.stringify(report));
  const insert=this.db.prepare('INSERT INTO chain_checks VALUES(?,?,?,?,?,?,?)'),reference=this.db.prepare('INSERT INTO chain_production_orders VALUES(?,?,?)');
  for(const r of rows){insert.run(batch,r.id,r.classification,r.category,r.salesOrder,r.productionOrder,JSON.stringify(r));for(const p of r.productionOrders)reference.run(batch,r.id,p);}
 }
 review(batch){
  if(this.getBatch(batch)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const r=this.db.prepare('SELECT payload FROM chain_reviews WHERE batch_id=?').get(batch);if(!r)throw new Error('CHAIN_CHECKS_NOT_COLLECTED');
  const report=JSON.parse(r.payload);if(report.batchId!==batch)invalid();return report;
 }
 where(batch,f){
  this.review(batch);const params=[batch],conditions=['c.batch_id=?'];
  for(const field of ['classification','category'])if(f[field]&&f[field]!=='all'){conditions.push(`c.${field}=?`);params.push(f[field]);}
  if(f.salesOrder){conditions.push('instr(c.sales_order,?)>0');params.push(f.salesOrder);}
  if(f.productionOrder){conditions.push('EXISTS (SELECT 1 FROM chain_production_orders p WHERE p.batch_id=c.batch_id AND p.case_id=c.id AND instr(p.production_order,?)>0)');params.push(f.productionOrder);}
  return {sql:' WHERE '+conditions.join(' AND '),params};
 }
 rows(batch,f){const {sql,params}=this.where(batch,f);return {total:this.db.prepare('SELECT count(*) n FROM chain_checks c'+sql).get(...params).n,page:f.page,pageSize:f.pageSize,rows:this.db.prepare('SELECT c.payload FROM chain_checks c'+sql+' ORDER BY c.sales_order,c.production_order,c.id LIMIT ? OFFSET ?').all(...params,f.pageSize,(f.page-1)*f.pageSize).map(r=>{const v=JSON.parse(r.payload);delete v.evidence;delete v.values['完整证据JSON'];return v;})};}
 detail(batch,id){this.review(batch);const r=this.db.prepare('SELECT payload FROM chain_checks WHERE batch_id=? AND id=?').get(batch,id);return r?JSON.parse(r.payload):null;}
 *export(batch,f){const {sql,params}=this.where(batch,f);for(const r of this.db.prepare('SELECT c.payload FROM chain_checks c'+sql+' ORDER BY c.sales_order,c.production_order,c.id').iterate(...params))yield JSON.parse(r.payload);}
}
