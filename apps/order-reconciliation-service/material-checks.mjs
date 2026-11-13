import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {historyDatasets,MATERIAL_DATASETS} from './datasets.mjs';
export const materialSources=['u8-production','u8-sales','u8-parts','u8-bom','u8-bom-components','u8-component-options','u8-allocations','u8-substitutes',...Object.keys(MATERIAL_DATASETS),...historyDatasets];
const app=fileURLToPath(new URL('.',import.meta.url));
const validId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const invalid=()=>{throw new Error('MATERIAL_CHECKS_INVALID');};
export function validateMaterialChecks(report,rows){
 if(report?.version!==1||!validId(report.reviewId)||!validId(report.batchId)||report.status!=='available'||!['full_inventory','preserved_review'].includes(report.provenance?.kind)||!Array.isArray(report.sourceManifest)||!Array.isArray(report.columns)||new Set(report.columns).size!==report.columns.length||report.rows?.file!=='rows.ndjson'||!/^[a-f0-9]{64}$/.test(report.rows.sha256||'')||!Array.isArray(rows))invalid();
 const ids=new Set(),orders=new Set(),productions=new Set(),categories={};
 for(const r of rows){
  if(typeof r.id!=='string'||!r.id||r.id.length>220||ids.has(r.id)||r.classification!=='pending_evidence'||r.factStatus!=='confirmed_record_fact'||typeof r.category!=='string'||!r.category||typeof r.categoryLabel!=='string'||typeof r.salesOrder!=='string'||typeof r.productionOrder!=='string'||typeof r.materialCode!=='string'||!r.values||r.values['销售订单']!==r.salesOrder||r.values['生产订单']!==r.productionOrder||r.values['物料编码']!==r.materialCode||Object.keys(r.values).some(k=>!report.columns.includes(k)))invalid();
  ids.add(r.id);categories[r.category]=(categories[r.category]||0)+1;if(r.salesOrder)orders.add(r.salesOrder);if(r.productionOrder)productions.add(r.productionOrder);
 }
 const s=report.summary;if(!s||s.total!==rows.length||s.pending!==rows.length||report.rows.count!==rows.length||s.salesOrders!==orders.size||s.productionOrders!==productions.size||JSON.stringify(Object.entries(categories).sort())!==JSON.stringify(Object.entries(report.categories||{}).sort()))invalid();
 if(new Set(report.sourceManifest.map(r=>r.dataset)).size!==report.sourceManifest.length)invalid();
 for(const r of report.sourceManifest)if(r.status!=='succeeded'||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!/^[a-f0-9]{64}$/.test(r.querySha256||''))invalid();
 if(report.provenance.kind==='full_inventory'&&(report.reviewId!==report.batchId||materialSources.some(key=>!report.sourceManifest.some(r=>r.dataset===key))))invalid();
 return report;
}
export async function readMaterialChecks(folder){
 const report=JSON.parse(await readFile(join(folder,'review.json'),'utf8')),rows=[],hash=createHash('sha256');
 for await(const chunk of createReadStream(join(folder,'rows.ndjson')))hash.update(chunk);
 if(hash.digest('hex')!==report.rows?.sha256)invalid();
 for await(const line of createInterface({input:createReadStream(join(folder,'rows.ndjson')),crlfDelay:Infinity}))if(line)rows.push(JSON.parse(line));
 validateMaterialChecks(report,rows);return {report,rows};
}
export async function buildMaterialChecks(stage,batch,options={}){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','material-checks.py'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('MATERIAL_CHECKS_TIMEOUT'));},900000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-4096);});
  child.on('error',()=>finish(new Error('MATERIAL_CHECKS_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'material-checks-error.txt'),diagnostics).catch(()=>{});finish(new Error('MATERIAL_CHECKS_FAILED'));});
 });
 if(options.deferRows)return {deferred:true};
 const result=await readMaterialChecks(join(stage,'material-checks'));if(result.report.batchId!==batch)invalid();return result;
}
export function materialFilters(params){
 for(const k of params.keys())if(!['review','category','salesOrder','productionOrder','material','page','pageSize'].includes(k)||params.getAll(k).length!==1)throw new Error('INVALID_QUERY');
 const review=params.get('review');if(!validId(review))throw new Error('INVALID_QUERY');
 const category=params.get('category')||'all';if(!/^[a-z_]{1,80}$/.test(category))throw new Error('INVALID_QUERY');
 const salesOrder=params.get('salesOrder')||'',productionOrder=params.get('productionOrder')||'',material=params.get('material')||'';
 if([salesOrder,productionOrder,material].some(v=>v.length>128))throw new Error('INVALID_QUERY');
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||50);if(!Number.isSafeInteger(page)||page<1||page>1000000||![20,50,100].includes(pageSize))throw new Error('INVALID_PAGE');
 return {review,category,salesOrder,productionOrder,material,page,pageSize};
}
export class MaterialStore{
 constructor(db,getBatch){
  this.db=db;this.getBatch=getBatch;
  db.exec(`CREATE TABLE IF NOT EXISTS material_reviews(id TEXT PRIMARY KEY,batch_id TEXT NOT NULL REFERENCES batches(id),kind TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS material_checks(review_id TEXT NOT NULL REFERENCES material_reviews(id),id TEXT NOT NULL,category TEXT NOT NULL,sales_order TEXT NOT NULL,production_order TEXT NOT NULL,material TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(review_id,id));
   CREATE INDEX IF NOT EXISTS material_checks_filter ON material_checks(review_id,category,sales_order,production_order);
   CREATE INDEX IF NOT EXISTS material_reviews_batch ON material_reviews(batch_id);`);
 }
 insert(batch,{report,rows},reads,preserved=false){
  validateMaterialChecks(report,rows);
  if(report.batchId!==batch||report.provenance.kind!==(preserved?'preserved_review':'full_inventory'))invalid();
  if(this.db.prepare('SELECT 1 FROM material_reviews WHERE id=?').get(report.reviewId))throw new Error('MATERIAL_CHECKS_ALREADY_SAVED');
  if(!preserved)for(const s of report.sourceManifest){const a=reads.filter(r=>r.dataset===s.dataset);if(a.length!==1||a[0].status!=='succeeded'||a[0].sha256!==s.sha256||a[0].querySha256!==s.querySha256||a[0].count!==s.count)throw new Error('MATERIAL_SOURCE_MISMATCH');}
  this.db.prepare('INSERT INTO material_reviews VALUES(?,?,?,?,?)').run(report.reviewId,batch,report.provenance.kind,report.createdAt,JSON.stringify(report));
  const statement=this.db.prepare('INSERT INTO material_checks VALUES(?,?,?,?,?,?,?)');
  for(const r of rows)statement.run(report.reviewId,r.id,r.category,r.salesOrder,r.productionOrder,r.materialCode,JSON.stringify(r));
 }
 preserve(data){
  this.db.exec('BEGIN IMMEDIATE');try{if(this.getBatch(data.report.batchId)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');this.insert(data.report.batchId,data,[],true);this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
 }
 list(){return this.db.prepare("SELECT r.payload FROM material_reviews r JOIN batches b ON b.id=r.batch_id WHERE b.status='succeeded' ORDER BY r.created_at DESC,r.id").all().map(r=>JSON.parse(r.payload));}
 review(id){
  const r=this.db.prepare('SELECT batch_id,payload FROM material_reviews WHERE id=?').get(id);if(!r)throw new Error('MATERIAL_CHECKS_NOT_COLLECTED');
  if(this.getBatch(r.batch_id)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const report=JSON.parse(r.payload);if(report.batchId!==r.batch_id||report.reviewId!==id)invalid();return report;
 }
 where(id,f){
  this.review(id);const params=[id],conditions=['review_id=?'];
  for(const [field,value] of [['category',f.category==='all'?'':f.category],['sales_order',f.salesOrder],['production_order',f.productionOrder],['material',f.material]])if(value){conditions.push(field==='category'?'category=?':`instr(${field},?)>0`);params.push(value);}
  return {sql:' WHERE '+conditions.join(' AND '),params};
 }
 rows(id,f){const {sql,params}=this.where(id,f);return {total:this.db.prepare('SELECT count(*) n FROM material_checks'+sql).get(...params).n,page:f.page,pageSize:f.pageSize,rows:this.db.prepare('SELECT payload FROM material_checks'+sql+' ORDER BY sales_order,production_order,id LIMIT ? OFFSET ?').all(...params,f.pageSize,(f.page-1)*f.pageSize).map(r=>{const v=JSON.parse(r.payload);delete v.evidence;delete v.values['完整证据JSON'];return v;})};}
 detail(id,key){this.review(id);const r=this.db.prepare('SELECT payload FROM material_checks WHERE review_id=? AND id=?').get(id,key);return r?JSON.parse(r.payload):null;}
 *export(id,f){const {sql,params}=this.where(id,f);for(const r of this.db.prepare('SELECT payload FROM material_checks'+sql+' ORDER BY sales_order,production_order,id').iterate(...params))yield JSON.parse(r.payload);}
}
