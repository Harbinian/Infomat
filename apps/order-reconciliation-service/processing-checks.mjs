// Read-only views over immutable, same-batch processing evidence. Source writes
// and historical recalculation are deliberately absent from this module.
import {spawn} from 'node:child_process';
import {readFile,writeFile} from 'node:fs/promises';
import {openSync,readSync,closeSync} from 'node:fs';
import {StringDecoder} from 'node:string_decoder';
import {deflateSync,inflateSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

export const processingSources=['u8-production','u8-production-links','u8-allocations','u8-product-receipts','u8-material-issues','u8-parts','u8-quantity-enums','mes-operation-events','mes-inspection-events'];
const app=fileURLToPath(new URL('.',import.meta.url));
const validId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const invalid=()=>{throw new Error('PROCESSING_CHECKS_INVALID');};
const sorted=v=>JSON.stringify(Object.entries(v).sort());
const decode=(payload,trace=false)=>{const row=JSON.parse(typeof payload==='string'?payload:inflateSync(payload).toString('utf8'));if(trace&&!Object.hasOwn(row.values,'完整证据JSON'))row.values['完整证据JSON']=JSON.stringify(row.evidence);return row;};
// Re-iterable frozen NDJSON avoids retaining a multi-gigabyte result array.
// Every full pass verifies the original bytes, including UTF-8 boundaries.
class ProcessingRowsFile{
 constructor(path,report){this.path=path;this.report=report;this.expectedHash=report.rows.sha256;this.validated=false;}
 *[Symbol.iterator](){
  const fd=openSync(this.path,'r'),buffer=Buffer.alloc(1024*1024),decoder=new StringDecoder('utf8'),hash=createHash('sha256');let rest='';
  try{
   let size;while((size=readSync(fd,buffer,0,buffer.length,null))){hash.update(buffer.subarray(0,size));rest+=decoder.write(buffer.subarray(0,size));let offset;
    while((offset=rest.indexOf('\n'))!==-1){const line=rest.slice(0,offset);rest=rest.slice(offset+1);if(line.trim())yield JSON.parse(line);}
   }
   rest+=decoder.end();if(rest.trim())yield JSON.parse(rest);
   if(hash.digest('hex')!==this.expectedHash)invalid();
  }finally{closeSync(fd);}
 }
}
export function validateProcessingChecks(report,rows){
 if(report?.version!==1||!validId(report.batchId)||report.status!=='available'||!rows||typeof rows[Symbol.iterator]!=='function'||!Array.isArray(report.columns)||!report.columns.length||new Set(report.columns).size!==report.columns.length||report.rows?.file!=='rows.ndjson'||!/^[a-f0-9]{64}$/.test(report.rows.sha256||'')||!report.categoryLabels||typeof report.categoryLabels!=='object')invalid();
 const seen=new Set(),orders=new Set(),sales=new Set(),categories={};let confirmed=0,pending=0,components=0,count=0;
 for(const r of rows){
  count++;
  if(typeof r.id!=='string'||!r.id||r.id.length>400||seen.has(r.id)||!['confirmed_issue','pending_evidence'].includes(r.classification)||!/^\d+$/.test(r.productionDetailId||'')||typeof r.productionOrder!=='string'||typeof r.salesOrder!=='string'||!Array.isArray(r.productionOrders)||new Set(r.productionOrders).size!==r.productionOrders.length||r.productionOrders.some(v=>typeof v!=='string'||!v)||typeof r.component!=='boolean'||!['self','upstream'].includes(r.chain)||!/^[-a-z_]{1,100}$/.test(r.category||'')||report.categoryLabels[r.category]!==r.categoryLabel||!r.values||!r.evidence||Object.keys(r.values).some(k=>!report.columns.includes(k)))invalid();
  seen.add(r.id);categories[r.category]=(categories[r.category]||0)+1;
  if(r.classification==='confirmed_issue')confirmed++;else pending++;
  if(r.component)components++;for(const o of r.productionOrders)orders.add(o);if(r.salesOrder)sales.add(r.salesOrder);
 }
 const s=report.summary;
 if(!s||s.total!==count||s.confirmed!==confirmed||s.pending!==pending||s.componentItems!==components||s.productionOrders!==orders.size||s.salesOrders!==sales.size||report.rows.count!==count||sorted(categories)!==sorted(report.categories||{}))invalid();
 if(!Array.isArray(report.sourceManifest)||report.sourceManifest.length!==processingSources.length||new Set(report.sourceManifest.map(r=>r.dataset)).size!==processingSources.length)invalid();
 for(const r of report.sourceManifest)if(!processingSources.includes(r.dataset)||r.status!=='succeeded'||!Number.isSafeInteger(r.count)||r.count<0||!/^[a-f0-9]{64}$/.test(r.sha256||'')||!/^[a-f0-9]{64}$/.test(r.querySha256||''))invalid();
 return report;
}
export async function readProcessingChecks(folder){
 const report=JSON.parse(await readFile(join(folder,'review.json'),'utf8')),rows=new ProcessingRowsFile(join(folder,'rows.ndjson'),report);
 validateProcessingChecks(report,rows);rows.validated=true;return {report,rows};
}
export async function buildProcessingChecks(stage,batch,{deferRows=false}={}){
 await new Promise((resolve,reject)=>{
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','processing-checks.py'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  let diagnostics='',settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('PROCESSING_CHECKS_TIMEOUT'));},900000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-6000);});
  child.on('error',()=>finish(new Error('PROCESSING_CHECKS_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'processing-checks-error.txt'),diagnostics).catch(()=>{});finish(new Error('PROCESSING_CHECKS_FAILED'));});
 });
 if(deferRows)return {deferred:true};
 const result=await readProcessingChecks(join(stage,'processing-checks'));if(result.report.batchId!==batch)invalid();return result;
}
export function processingFilters(params){
 for(const k of params.keys())if(!['batch','classification','category','salesOrder','productionOrder','component','page','pageSize'].includes(k)||params.getAll(k).length!==1)throw new Error('INVALID_QUERY');
 const batch=params.get('batch');if(!validId(batch))throw new Error('INVALID_QUERY');
 const classification=params.get('classification')||'all',category=params.get('category')||'all',component=params.get('component')||'all';
 if(!['all','confirmed_issue','pending_evidence'].includes(classification)||!/^[-a-z_]{1,100}$/.test(category)||!['all','only'].includes(component))throw new Error('INVALID_QUERY');
 const salesOrder=params.get('salesOrder')||'',productionOrder=params.get('productionOrder')||'';
 if([salesOrder,productionOrder].some(v=>v.length>128))throw new Error('INVALID_QUERY');
 const page=Number(params.get('page')||1),pageSize=Number(params.get('pageSize')||50);
 if(!Number.isSafeInteger(page)||page<1||page>1000000||![20,50,100].includes(pageSize))throw new Error('INVALID_PAGE');
 return {batch,classification,category,component,salesOrder,productionOrder,page,pageSize};
}
export class ProcessingStore{
 constructor(db,getBatch){
  this.db=db;this.getBatch=getBatch;
  db.exec(`CREATE TABLE IF NOT EXISTS processing_reviews(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS processing_checks(batch_id TEXT NOT NULL REFERENCES processing_reviews(batch_id),id TEXT NOT NULL,classification TEXT NOT NULL,category TEXT NOT NULL,sales_order TEXT NOT NULL,production_order TEXT NOT NULL,is_component INTEGER NOT NULL,payload BLOB NOT NULL,PRIMARY KEY(batch_id,id));
   CREATE INDEX IF NOT EXISTS processing_checks_filter ON processing_checks(batch_id,is_component,classification,category,sales_order);
   CREATE INDEX IF NOT EXISTS processing_checks_order ON processing_checks(batch_id,sales_order,production_order,id);
   CREATE INDEX IF NOT EXISTS processing_checks_component_order ON processing_checks(batch_id,is_component,sales_order,production_order,id);
   CREATE TABLE IF NOT EXISTS processing_production_orders(batch_id TEXT NOT NULL,case_id TEXT NOT NULL,production_order TEXT NOT NULL,PRIMARY KEY(batch_id,case_id,production_order),FOREIGN KEY(batch_id,case_id) REFERENCES processing_checks(batch_id,id));
   CREATE INDEX IF NOT EXISTS processing_production_filter ON processing_production_orders(batch_id,production_order,case_id);`);
 }
 insert(batch,{report,rows},reads){
  if(rows instanceof ProcessingRowsFile){if(!rows.validated||rows.report!==report)invalid();}else validateProcessingChecks(report,rows);
  if(report.batchId!==batch)invalid();
  if(this.db.prepare('SELECT 1 FROM processing_reviews WHERE batch_id=?').get(batch))throw new Error('PROCESSING_CHECKS_ALREADY_SAVED');
  for(const s of report.sourceManifest){const a=reads.filter(r=>r.dataset===s.dataset);if(a.length!==1||a[0].status!=='succeeded'||a[0].sha256!==s.sha256||a[0].querySha256!==s.querySha256||a[0].count!==s.count)throw new Error('PROCESSING_SOURCE_MISMATCH');}
  this.db.prepare('INSERT INTO processing_reviews VALUES(?,?)').run(batch,JSON.stringify(report));
  const insert=this.db.prepare('INSERT INTO processing_checks VALUES(?,?,?,?,?,?,?,?)'),ref=this.db.prepare('INSERT INTO processing_production_orders VALUES(?,?,?)');
  for(const r of rows){insert.run(batch,r.id,r.classification,r.category,r.salesOrder,r.productionOrder,Number(r.component),deflateSync(Buffer.from(JSON.stringify(r)),{level:6}));for(const o of r.productionOrders)ref.run(batch,r.id,o);}
 }
 review(batch){
  if(this.getBatch(batch)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const r=this.db.prepare('SELECT payload FROM processing_reviews WHERE batch_id=?').get(batch);
  if(!r)return {version:1,batchId:batch,status:'not-collected',message:'该历史盘点未采集加工流转核查，未使用当前数据补算；不能解释为没有缺口。'};
  const report=JSON.parse(r.payload);if(report.batchId!==batch)invalid();return report;
 }
 where(batch,f){
  const report=this.review(batch);if(report.status!=='available')throw new Error('PROCESSING_CHECKS_NOT_COLLECTED');
  if(f.category&&f.category!=='all'&&!Object.hasOwn(report.categoryLabels,f.category))throw new Error('INVALID_QUERY');
  const params=[batch],conditions=['c.batch_id=?'];
  for(const key of ['classification','category'])if(f[key]&&f[key]!=='all'){conditions.push(`c.${key}=?`);params.push(f[key]);}
  if(f.component==='only')conditions.push('c.is_component=1');
  if(f.salesOrder){conditions.push('instr(c.sales_order,?)>0');params.push(f.salesOrder);}
  if(f.productionOrder){conditions.push('EXISTS (SELECT 1 FROM processing_production_orders p WHERE p.batch_id=c.batch_id AND p.case_id=c.id AND instr(p.production_order,?)>0)');params.push(f.productionOrder);}
  return {sql:' WHERE '+conditions.join(' AND '),params};
 }
 rows(batch,f){const {sql,params}=this.where(batch,f);return {batchId:batch,total:this.db.prepare('SELECT count(*) n FROM processing_checks c'+sql).get(...params).n,page:f.page,pageSize:f.pageSize,rows:this.db.prepare('SELECT c.payload FROM processing_checks c'+sql+' ORDER BY c.sales_order,c.production_order,c.id LIMIT ? OFFSET ?').all(...params,f.pageSize,(f.page-1)*f.pageSize).map(r=>{const v=decode(r.payload);delete v.evidence;delete v.values['完整证据JSON'];return v;})};}
 detail(batch,id){this.where(batch,{category:'all'});const r=this.db.prepare('SELECT payload FROM processing_checks WHERE batch_id=? AND id=?').get(batch,id);return r?decode(r.payload,true):null;}
 *export(batch,f){const {sql,params}=this.where(batch,f);for(const r of this.db.prepare('SELECT c.payload FROM processing_checks c'+sql+' ORDER BY c.sales_order,c.production_order,c.id').iterate(...params))yield decode(r.payload,true);}
}
