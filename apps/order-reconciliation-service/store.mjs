import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {DATASETS} from './reconcile.mjs';
import {ALL_DATASETS,quantityAliases,historyDatasets} from './datasets.mjs';
import {validateQuantityReport} from './quantity-review.mjs';
import {validateOrderChecks,checkSources} from './order-checks.mjs';
import {MaterialStore} from './material-checks.mjs';
import {ChainStore} from './chain-checks.mjs';
import {ProcessingStore} from './processing-checks.mjs';
import {UnifiedStore} from './unified-statistics.mjs';
const hash = v => createHash('sha256').update(v).digest('hex');
// Source dates are SQL business calendar dates; do not shift them through UTC.
function calendarMonth(value){
 if(typeof value!=='string')return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,7})?)?$/.exec(value);
 if(!match)return null;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 if(year<1||month<1||month>12||day<1)return null;
 const leap=year%4===0&&(year%100!==0||year%400===0);
 if(day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1])return null;
 if(value.length>10&&(Number(value.slice(11,13))>23||Number(value.slice(14,16))>59||Number(value.slice(17,19))>59))return null;
 return value.slice(0,7);
}
function orderMonth(row){
 const production=row.productionDetailId!==null&&row.productionDetailId!==undefined;
 const object=production?'dbo.mom_orderdetail':'dbo.SO_SODetails',field=production?'CreateDate':'dDate';
 const anchors=(row.evidence||[]).filter(item=>item.source==='u8'&&item.object===object);
 // A missing or ambiguous production date stays unknown, even when sales has a date.
 return anchors.length===1?calendarMonth(anchors[0].values?.[field]):null;
}
function anomalyStatistics(batchId,rows,summary){
 const types=new Map(),months=new Map();let totalIssueCount=0,affectedRecordCount=0,unmatchedRecordCount=0,ledgerRows=0;
 for(const row of rows){
  ledgerRows++;if(row.status==='unmatched')unmatchedRecordCount++;
  if(!Array.isArray(row.issues))throw new Error('ANOMALY_STATISTICS_MISMATCH');
  if(row.issues.length)affectedRecordCount++;
  const month=orderMonth(row),monthKey=month??'unknown';
  if(!months.has(monthKey))months.set(monthKey,{month,issueCount:0,recordCount:0,ledgerRows:0,unmatchedRecordCount:0,types:new Map()});
  const period=months.get(monthKey);period.ledgerRows++;if(row.issues.length)period.recordCount++;if(row.status==='unmatched')period.unmatchedRecordCount++;
  const seen=new Set();
  for(const issue of row.issues){
   if(typeof issue.code!=='string'||typeof issue.label!=='string'||!issue.label)throw new Error('ANOMALY_STATISTICS_MISMATCH');
   const identity=JSON.stringify([issue.code,issue.label]);
   if(!types.has(identity))types.set(identity,{key:hash(identity),code:issue.code,label:issue.label,issueCount:0,recordCount:0});
   const type=types.get(identity);type.issueCount++;totalIssueCount++;
   if(!period.types.has(identity))period.types.set(identity,{key:type.key,issueCount:0,recordCount:0});
   const monthlyType=period.types.get(identity);monthlyType.issueCount++;period.issueCount++;
   if(!seen.has(identity)){type.recordCount++;monthlyType.recordCount++;seen.add(identity);}
  }
 }
 if(totalIssueCount!==summary.findings||affectedRecordCount!==summary.findingRecords||unmatchedRecordCount!==summary.unmatched||ledgerRows!==summary.ledgerRows)throw new Error('ANOMALY_STATISTICS_MISMATCH');
 return {batchId,statisticsVersion:2,basis:'issue-count',monthlyBasis:'u8-order-month',totalIssueCount,affectedRecordCount,unmatchedRecordCount,types:[...types.values()].sort((a,b)=>b.issueCount-a.issueCount||a.key.localeCompare(b.key)),months:[...months.values()].sort((a,b)=>(a.month??'9999-99').localeCompare(b.month??'9999-99')).map(period=>({...period,types:[...period.types.values()]}))};
}
export class Store {
 constructor(path){
  this.databasePath=path;
  mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path,{timeout:5000,defensive:true});
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS batches(id TEXT PRIMARY KEY,status TEXT NOT NULL,started_at TEXT NOT NULL,finished_at TEXT,rule_version TEXT NOT NULL,rules_json TEXT NOT NULL,summary_json TEXT NOT NULL DEFAULT '{}',reads_json TEXT NOT NULL DEFAULT '[]',coverage_json TEXT NOT NULL DEFAULT '[]',error TEXT);
   CREATE TABLE IF NOT EXISTS snapshots(batch_id TEXT NOT NULL REFERENCES batches(id),dataset TEXT NOT NULL,ordinal INTEGER NOT NULL,source_key TEXT,payload TEXT NOT NULL,sha256 TEXT NOT NULL,read_at TEXT,PRIMARY KEY(batch_id,dataset,ordinal));
   CREATE TABLE IF NOT EXISTS ledger(batch_id TEXT NOT NULL REFERENCES batches(id),id TEXT NOT NULL,status TEXT NOT NULL,issue_count INTEGER NOT NULL,search_text TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(batch_id,id));
   CREATE INDEX IF NOT EXISTS ledger_filter ON ledger(batch_id,status,issue_count);
   CREATE INDEX IF NOT EXISTS ledger_order ON ledger(batch_id,issue_count DESC,id);
   CREATE TABLE IF NOT EXISTS anomaly_statistics(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS anomaly_statistics_versions(batch_id TEXT NOT NULL REFERENCES batches(id),version INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(batch_id,version));
   CREATE TABLE IF NOT EXISTS quantity_reviews(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS order_check_reviews(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS order_checks(batch_id TEXT NOT NULL REFERENCES order_check_reviews(batch_id),id TEXT NOT NULL,classification TEXT NOT NULL,category TEXT NOT NULL,sales_order TEXT NOT NULL,sales_detail_id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(batch_id,id));
   CREATE INDEX IF NOT EXISTS order_checks_filter ON order_checks(batch_id,classification,sales_order);
   CREATE TABLE IF NOT EXISTS order_check_production_orders(batch_id TEXT NOT NULL,case_id TEXT NOT NULL,production_order TEXT NOT NULL,PRIMARY KEY(batch_id,case_id,production_order),FOREIGN KEY(batch_id,case_id) REFERENCES order_checks(batch_id,id));
   CREATE INDEX IF NOT EXISTS order_check_production_filter ON order_check_production_orders(batch_id,production_order,case_id);
   PRAGMA user_version=9;`);
  this.material=new MaterialStore(this.db,id=>this.get(id));
  this.chain=new ChainStore(this.db,id=>this.get(id));
  this.processing=new ProcessingStore(this.db,id=>this.get(id));
  this.unified=new UnifiedStore(this.db,id=>this.get(id),dirname(path));
 }
 recoverInterrupted(){this.db.prepare("UPDATE batches SET status='failed',finished_at=?,error='上次执行被中断，没有发布有效业务结果' WHERE status='running'").run(new Date().toISOString());}
 map(row){if(!row)return null;return {id:row.id,status:row.status,startedAt:row.started_at,finishedAt:row.finished_at,ruleVersion:row.rule_version,summary:JSON.parse(row.summary_json),sourceReads:JSON.parse(row.reads_json),coverage:JSON.parse(row.coverage_json),error:row.error,orderCheckStatus:this.db.prepare('SELECT 1 FROM order_check_reviews WHERE batch_id=?').get(row.id)?'available':JSON.parse(row.rules_json).orderChecks?.enabled?'pending':'not-collected',quantityStatus:this.db.prepare('SELECT 1 FROM quantity_reviews WHERE batch_id=?').get(row.id)?'available':JSON.parse(row.rules_json).quantityReview?.enabled?'pending':'not-collected'};}
 list(){return this.db.prepare('SELECT * FROM batches ORDER BY started_at DESC').all().map(x=>this.map(x));}
 get(id){return this.map(this.db.prepare('SELECT * FROM batches WHERE id=?').get(id));}
 begin(id,rules){this.db.prepare('INSERT INTO batches(id,status,started_at,rule_version,rules_json) VALUES (?,?,?,?,?)').run(id,'running',new Date().toISOString(),rules.version,JSON.stringify(rules));}
 progress(id,reads){this.db.prepare('UPDATE batches SET reads_json=? WHERE id=? AND status=?').run(JSON.stringify(reads),id,'running');}
 fail(id,reason,reads=[]){this.db.prepare("UPDATE batches SET status='failed',finished_at=?,error=?,reads_json=? WHERE id=? AND status='running'").run(new Date().toISOString(),reason,JSON.stringify(reads),id);}
 publish(id,datasets,reads,result,quantity=null,checks=null,materials=null,chains=null,statistics=null,processing=null){
  this.db.exec('BEGIN IMMEDIATE');
  try{
   if(this.get(id)?.status!=='running')throw new Error('BATCH_NOT_RUNNING');
   const rules=JSON.parse(this.db.prepare('SELECT rules_json FROM batches WHERE id=?').get(id).rules_json);
   if(rules.quantityReview?.enabled&&!quantity)throw new Error('QUANTITY_REVIEW_REQUIRED');
   if(rules.orderChecks?.enabled&&!checks)throw new Error('ORDER_CHECKS_REQUIRED');
   if(rules.materialChecks?.enabled&&!materials)throw new Error('MATERIAL_CHECKS_REQUIRED');
   if(rules.unifiedStatistics?.enabled&&!statistics)throw new Error('UNIFIED_STATISTICS_REQUIRED');
   if(rules.unifiedStatistics?.enabled&&rules.unifiedStatistics.persistence?.enabled&&!statistics?.persistence)throw new Error('PERSISTENCE_REQUIRED');
   if(rules.chainChecks?.enabled&&!chains)throw new Error('CHAIN_CHECKS_REQUIRED');
   if(rules.processingChecks?.enabled&&!processing)throw new Error('PROCESSING_CHECKS_REQUIRED');
   if(quantity){
    validateQuantityReport(quantity,id);
    for(const key of new Set([...Object.values(quantityAliases),...historyDatasets]))if(!quantity.sourceManifest.some(source=>source.dataset===key))throw new Error('SOURCE_COMPLETENESS_MISMATCH');
    for(const key of Object.keys(rules.queryHashes)){const read=reads.filter(r=>r.dataset===key);if(read.length!==1||read[0].status!=='succeeded'||read[0].querySha256!==rules.queryHashes[key])throw new Error('SOURCE_COMPLETENESS_MISMATCH');}
    for(const source of quantity.sourceManifest){const read=reads.find(r=>r.dataset===source.dataset);if(!read||read.sha256!==source.sha256||read.count!==source.count||read.querySha256!==source.querySha256)throw new Error('SOURCE_COMPLETENESS_MISMATCH');}
    this.db.prepare('INSERT INTO quantity_reviews(batch_id,payload) VALUES (?,?)').run(id,JSON.stringify(quantity));
   }
   if(checks)this.insertOrderChecks(id,checks,reads,false);
   if(materials)this.material.insert(id,materials,reads);
   if(chains)this.chain.insert(id,chains,reads);
   if(processing)this.processing.insert(id,processing,reads);
   if(statistics){
    if(statistics.domains?.ledger?.units!==result.summary.ledgerRows||statistics.domains.ledger.items!==result.summary.findings+result.summary.unmatched||statistics.domains?.material?.items!==materials?.report.summary.total||statistics.domains?.chain?.items!==chains?.report.summary.total)throw new Error('UNIFIED_STATISTICS_RESULT_MISMATCH');
    if(processing&&statistics.domains?.processing?.items!==processing.report.summary.total)throw new Error('UNIFIED_STATISTICS_RESULT_MISMATCH');
    for(const [key,file] of Object.entries(quantity?.files||{}))if(statistics.domains?.['quantity-'+key]?.units!==file.rows)throw new Error('UNIFIED_STATISTICS_RESULT_MISMATCH');
    this.unified.insert(id,statistics,reads);
   }
   const insert=this.db.prepare('INSERT INTO snapshots(batch_id,dataset,ordinal,source_key,payload,sha256,read_at) VALUES (?,?,?,?,?,?,?)');
   for(const [key,meta] of Object.entries(DATASETS)){
    const read=reads.find(r=>r.dataset===key);if(!read||read.status!=='succeeded'||read.count!==datasets[key].length)throw new Error('SOURCE_COMPLETENESS_MISMATCH');
    datasets[key].forEach((row,i)=>{const payload=JSON.stringify(row);insert.run(id,key,i,String(row[meta.key]??''),payload,hash(payload),read.finishedAt);});
   }
   const insertRow=this.db.prepare('INSERT INTO ledger(batch_id,id,status,issue_count,search_text,payload) VALUES (?,?,?,?,?,?)');
   for(const row of result.rows){const payload=JSON.stringify(row);const search=[row.productionNumber,row.salesOrder,row.salesDetailId,row.productionOrder,row.productionDetailId,row.interfaceId,row.mesId,row.qualitySales,row.qualityProduction,row.qualityMes,row.inventoryCode,...row.issues.map(i=>i.label)].filter(x=>x!==null&&x!==undefined).join('\n');insertRow.run(id,row.id,row.status,row.issues.length,search,payload);}
   this.db.prepare('INSERT INTO anomaly_statistics(batch_id,payload) VALUES (?,?)').run(id,JSON.stringify(anomalyStatistics(id,result.rows,result.summary)));
   this.db.prepare("UPDATE batches SET status='succeeded',finished_at=?,summary_json=?,reads_json=?,coverage_json=? WHERE id=?").run(new Date().toISOString(),JSON.stringify(result.summary),JSON.stringify(reads),JSON.stringify(result.coverage),id);
   this.db.exec('COMMIT');
  }catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 quantityReview(id){
  const batch=this.get(id);if(batch?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const row=this.db.prepare('SELECT payload FROM quantity_reviews WHERE batch_id=?').get(id);
  if(!row)return {version:2,batchId:id,status:'not-collected',message:'该历史盘点未采集数量与BOM核查资料，未使用当前数据补算。'};
  return validateQuantityReport(JSON.parse(row.payload),id);
 }
 insertOrderChecks(id,{report,rows},reads,preserved){
  validateOrderChecks(report,rows,id);
  if(report.provenance.kind!==(preserved?'preserved_review':'full_inventory'))throw new Error('ORDER_CHECKS_INVALID');
  if(this.db.prepare('SELECT 1 FROM order_check_reviews WHERE batch_id=?').get(id))throw new Error('ORDER_CHECKS_ALREADY_SAVED');
  for(const key of checkSources)if(!report.sourceManifest.some(r=>r.dataset===key))throw new Error('ORDER_CHECKS_SOURCE_MISMATCH');
  for(const source of report.sourceManifest){const read=reads.find(r=>r.dataset===source.dataset);if(!read||read.status!=='succeeded'||read.sha256!==source.sha256||(source.count??source.rows)!==read.count||(!preserved&&source.querySha256!==read.querySha256))throw new Error('ORDER_CHECKS_SOURCE_MISMATCH');}
  this.db.prepare('INSERT INTO order_check_reviews(batch_id,payload) VALUES (?,?)').run(id,JSON.stringify(report));
  const insert=this.db.prepare('INSERT INTO order_checks(batch_id,id,classification,category,sales_order,sales_detail_id,payload) VALUES (?,?,?,?,?,?,?)');
  const reference=this.db.prepare('INSERT INTO order_check_production_orders(batch_id,case_id,production_order) VALUES (?,?,?)');
  for(const row of rows){insert.run(id,row.id,row.classification,row.category,row.salesOrder,row.salesDetailId,JSON.stringify(row));for(const order of row.productionOrders)reference.run(id,row.id,order);}
 }
 preserveOrderChecks(id,checks){
  this.db.exec('BEGIN IMMEDIATE');
  try{const batch=this.get(id);if(batch?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');this.insertOrderChecks(id,checks,batch.sourceReads,true);this.db.exec('COMMIT');}
  catch(error){this.db.exec('ROLLBACK');throw error;}
 }
 orderCheckReview(id){
  if(this.get(id)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const row=this.db.prepare('SELECT payload FROM order_check_reviews WHERE batch_id=?').get(id);
  return row?JSON.parse(row.payload):{batchId:id,status:'not-collected',message:'该盘点未保存逐单分类复核，未使用当前数据补算。'};
 }
 orderCheckWhere(id,filters){
  if(this.orderCheckReview(id).status==='not-collected')throw new Error('ORDER_CHECKS_NOT_COLLECTED');
  const params=[id],conditions=['c.batch_id=?'];
  if(filters.classification!=='all'){conditions.push('c.classification=?');params.push(filters.classification);}
  if(filters.salesOrder){conditions.push('instr(c.sales_order,?)>0');params.push(filters.salesOrder);}
  if(filters.productionOrder){conditions.push('EXISTS (SELECT 1 FROM order_check_production_orders p WHERE p.batch_id=c.batch_id AND p.case_id=c.id AND instr(p.production_order,?)>0)');params.push(filters.productionOrder);}
  return {where:' WHERE '+conditions.join(' AND '),params};
 }
 orderChecks(id,filters){
  const {where,params}=this.orderCheckWhere(id,filters);
  const total=this.db.prepare('SELECT COUNT(*) n FROM order_checks c'+where).get(...params).n;
  const rows=this.db.prepare('SELECT c.payload FROM order_checks c'+where+' ORDER BY c.sales_order,c.sales_detail_id,c.id LIMIT ? OFFSET ?').all(...params,filters.pageSize,(filters.page-1)*filters.pageSize).map(r=>JSON.parse(r.payload));
  return {rows,total,page:filters.page,pageSize:filters.pageSize};
 }
 orderCheck(id,caseId){
  this.orderCheckWhere(id,{classification:'all'});
  const row=this.db.prepare('SELECT payload FROM order_checks WHERE batch_id=? AND id=?').get(id,caseId);return row?JSON.parse(row.payload):null;
 }
 *exportOrderChecks(id,filters){
  const {where,params}=this.orderCheckWhere(id,filters);
  for(const row of this.db.prepare('SELECT c.payload FROM order_checks c'+where+' ORDER BY c.sales_order,c.sales_detail_id,c.id').iterate(...params))yield JSON.parse(row.payload);
 }
 anomalies(id){
  const batch=this.get(id);if(batch?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const cached=this.db.prepare('SELECT payload FROM anomaly_statistics WHERE batch_id=?').get(id);
  if(cached){const statistics=JSON.parse(cached.payload);if(statistics.statisticsVersion===2)return statistics;}
  const versioned=this.db.prepare('SELECT payload FROM anomaly_statistics_versions WHERE batch_id=? AND version=2').get(id);
  if(versioned)return JSON.parse(versioned.payload);
  // Older successful batches retain their evidence; only a reproducible aggregate is added.
  const rows=this.db.prepare('SELECT payload FROM ledger WHERE batch_id=?').iterate(id);
  const statistics=anomalyStatistics(id,(function*(){for(const row of rows)yield JSON.parse(row.payload);})(),batch.summary);
  this.db.prepare('INSERT INTO anomaly_statistics_versions(batch_id,version,payload) VALUES (?,2,?)').run(id,JSON.stringify(statistics));
  return statistics;
 }
 records(id,kind,q,page,pageSize){
  if(this.get(id)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const condition=kind==='findings'?' AND issue_count>0':kind==='unmatched'?" AND status='unmatched'":'';
  const params=[id];let search='';if(q){search=' AND instr(lower(search_text),lower(?))>0';params.push(q);}
  const where=' WHERE batch_id=?'+condition+search;
  const total=this.db.prepare('SELECT COUNT(*) AS n FROM ledger'+where).get(...params).n;
  const rows=this.db.prepare('SELECT payload FROM ledger'+where+' ORDER BY issue_count DESC,id LIMIT ? OFFSET ?').all(...params,pageSize,(page-1)*pageSize).map(x=>JSON.parse(x.payload));
  return {rows,total,page,pageSize};
 }
 record(id,recordId){
  if(this.get(id)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const row=this.db.prepare('SELECT payload FROM ledger WHERE batch_id=? AND id=?').get(id,recordId);
  return row?JSON.parse(row.payload):null;
 }
 *exportRows(id,kind,q){
  if(this.get(id)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const condition=kind==='findings'?' AND issue_count>0':kind==='unmatched'?" AND status='unmatched'":'';
  for(const row of this.db.prepare('SELECT payload FROM ledger WHERE batch_id=?'+condition+(q?' AND instr(lower(search_text),lower(?))>0':'')+' ORDER BY issue_count DESC,id').iterate(...(q?[id,q]:[id])))yield JSON.parse(row.payload);
 }
 close(){this.unified.close();this.db.close();}
}
