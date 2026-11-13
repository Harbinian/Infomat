import {inflateSync} from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createReadStream,createWriteStream,openSync,readSync,closeSync,statSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ALL_DATASETS} from './datasets.mjs';
const app=fileURLToPath(new URL('.',import.meta.url));
const validId=v=>typeof v==='string'&&/^[\w-]{1,100}$/.test(v);
const invalid=()=>{throw new Error('UNIFIED_STATISTICS_INVALID');};
const hash=v=>createHash('sha256').update(v).digest('hex');
export async function buildUnifiedStatistics(stage,batchId,frozen,result,persistenceInput=null){
 if(!result){
  await new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--max-old-space-size=1536',join(app,'statistics-inputs.mjs'),stage],{windowsHide:true,stdio:['ignore','ignore','pipe']});
   let diagnostics='',settled=false;const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};
   const timer=setTimeout(()=>{child.kill();finish(new Error('STATISTICS_INPUT_TIMEOUT'));},600000);
   child.stderr.on('data',b=>{diagnostics=(diagnostics+b).slice(-4000);});
   child.on('error',()=>finish(new Error('STATISTICS_INPUT_START_FAILED')));
   child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'statistics-input-error.txt'),diagnostics).catch(()=>{});finish(new Error('STATISTICS_INPUT_FAILED'));});
  });
 }else{
 const path=join(stage,'statistics-ledger.ndjson'),stream=createWriteStream(path,{flags:'wx'}),digest=createHash('sha256');
 const completion=once(stream,'finish');
 for(const row of result.rows){const {evidence,...small}=row;const line=JSON.stringify(small)+'\n';digest.update(line);if(!stream.write(line))await once(stream,'drain');}
 stream.end();await completion;
 const policy=JSON.parse(await readFile(join(app,'risk-policy.json'),'utf8'));
 await writeFile(join(stage,'unified-inputs.json'),JSON.stringify({batchId,queryHashes:frozen.queryHashes,sources:ALL_DATASETS,policy,sourceDispositions:result.sourceDispositions,ledger:{sha256:digest.digest('hex'),rows:result.rows.length}}),{flag:'wx'});
 }
 await new Promise((resolve,reject)=>{
  // Set before Python loads SQLite: changing os.environ after import is too late
  // for SQLite builds that initialize the Unix temporary directory at startup.
  const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','unified-statistics.py'),stage],{windowsHide:true,env:{...process.env,SQLITE_TMPDIR:stage},stdio:['ignore','ignore','pipe']});
  let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
  const timer=setTimeout(()=>{child.kill();finish(new Error('UNIFIED_STATISTICS_TIMEOUT'));},1800000);
  child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-6000);});
  child.on('error',()=>finish(new Error('UNIFIED_STATISTICS_START_FAILED')));
  child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'unified-statistics-error.txt'),diagnostics).catch(()=>{});finish(new Error('UNIFIED_STATISTICS_FAILED'));});
 });
 if(persistenceInput){
  await writeFile(join(stage,'persistence-inputs.json'),JSON.stringify(persistenceInput),{flag:'wx'});
  await new Promise((resolve,reject)=>{
   const child=spawn(process.platform==='win32'?'python':'python3',['-X','utf8',join(app,'scripts','check-persistence.py'),stage],{windowsHide:true,env:{...process.env,SQLITE_TMPDIR:stage},stdio:['ignore','ignore','pipe']});
   let diagnostics='',done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve();};
   const timer=setTimeout(()=>{child.kill();finish(new Error('PERSISTENCE_TIMEOUT'));},1800000);
   child.stderr.on('data',b=>{diagnostics=(diagnostics+b.toString('utf8')).slice(-6000);});
   child.on('error',()=>finish(new Error('PERSISTENCE_START_FAILED')));
   child.on('exit',async code=>{if(code===0)return finish();await writeFile(join(stage,'persistence-error.txt'),diagnostics).catch(()=>{});finish(new Error('PERSISTENCE_FAILED'));});
  });
 }
 const report=JSON.parse(await readFile(join(stage,'unified-statistics','review.json'),'utf8'));
 if(report.batchId!==batchId)invalid();
 const digestFile=createHash('sha256');for await(const chunk of createReadStream(join(stage,'unified-statistics','results.sqlite')))digestFile.update(chunk);
 if(digestFile.digest('hex')!==report.database?.sha256)invalid();
 return report;
}
export function statisticsFilters(params,{detail=false}={}){
 const allowed=detail?['batch','id']:['batch','family','classification','priority','category','salesOrder','productionOrder','month','page','pageSize'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)throw new Error('INVALID_QUERY');
 const batch=params.get('batch');if(!validId(batch))throw new Error('INVALID_QUERY');
 if(detail){const id=params.get('id');if(!id||id.length>1000)throw new Error('INVALID_QUERY');return {batch,id};}
 const f={batch};for(const key of ['family','classification','priority','category','salesOrder','productionOrder','month'])f[key]=params.get(key)||'';
 if(!['','confirmed_record_difference','pending_evidence'].includes(f.classification)||!['','P1','P2','P3','P4'].includes(f.priority)||!/^([a-z-]{1,60})?$/.test(f.family)||f.category.length>500||f.salesOrder.length>128||f.productionOrder.length>128||!/^(?:\d{4}-(?:0[1-9]|1[0-2])|unknown)?$/.test(f.month))throw new Error('INVALID_QUERY');
 f.page=Number(params.get('page')||1);f.pageSize=Number(params.get('pageSize')||50);
 if(!Number.isSafeInteger(f.page)||f.page<1||f.page>1000000||![20,50,100].includes(f.pageSize))throw new Error('INVALID_PAGE');return f;
}
export class UnifiedStore{
 constructor(db,getBatch,root){this.db=db;this.getBatch=getBatch;this.root=root;this.connections=new Map();db.exec('CREATE TABLE IF NOT EXISTS unified_reviews(batch_id TEXT PRIMARY KEY REFERENCES batches(id),payload TEXT NOT NULL);');}
 persistenceContext(batch,rules){
  const previous=this.db.prepare('SELECT id,status,started_at,finished_at,rules_json FROM batches WHERE rowid<(SELECT rowid FROM batches WHERE id=?) ORDER BY rowid DESC LIMIT 1').get(batch);
  const row=previous&&this.db.prepare('SELECT payload FROM unified_reviews WHERE batch_id=?').get(previous.id);
  return {batchId:batch,rules,previous:previous?{batchId:previous.id,status:previous.status,startedAt:previous.started_at,finishedAt:previous.finished_at,rules:JSON.parse(previous.rules_json),report:row?JSON.parse(row.payload):null}:null};
 }
 insert(batch,report,reads){
  if(report?.version!==1||report.batchId!==batch||report.status!=='available'||report.database?.file!=='results.sqlite'||!/^[a-f0-9]{64}$/.test(report.database.sha256)||!Array.isArray(report.sourceManifest)||!Array.isArray(report.sourceCoverage)||report.sourceManifest.length!==reads.length||new Set(report.sourceManifest.map(r=>r.dataset)).size!==reads.length)invalid();
  for(const r of reads){const a=report.sourceManifest.find(v=>v.dataset===r.dataset),c=report.sourceCoverage.filter(v=>v.dataset===r.dataset);if(!a||a.status!=='succeeded'||a.sha256!==r.sha256||a.querySha256!==r.querySha256||a.count!==r.count||c.length!==1||c[0].read!==r.count||Object.values(c[0].dispositions).reduce((n,v)=>n+v,0)!==r.count)invalid();}
  const connection=this.open(batch,report);
  if(connection.prepare('SELECT count(*) n FROM findings').get().n!==report.summary?.items)invalid();
  if(report.persistence&&(report.persistence.batchId!==batch||report.persistence.version!==1||report.persistence.summary.items!==report.summary.items||connection.prepare('SELECT count(*) n FROM persistence').get().n!==report.summary.items||connection.prepare('SELECT count(*) n FROM persistence p LEFT JOIN findings f ON f.id=p.case_id WHERE f.id IS NULL OR p.consecutive<1').get().n))invalid();
  if(report.persistence){
   const p=report.persistence,previous=this.persistenceContext(batch,{}).previous;
   if(p.identityVersion!=='stable-observation-v1'||(p.previousBatch?.batchId||null)!==(previous?.batchId||null)||(p.previousStatisticsSha256||null)!==(previous?.report?.database?.sha256||null))invalid();
   const counts=connection.prepare('SELECT count(*) items,coalesce(sum(consecutive>=2),0) continued,coalesce(sum(consecutive IS NULL),0) identityUnknown,coalesce(max(consecutive),0) maxConsecutive FROM persistence').get();
   for(const key of Object.keys(counts))if(counts[key]!==p.summary[key])invalid();
   const boundaries=Object.fromEntries(connection.prepare('SELECT boundary,count(*) FROM persistence GROUP BY boundary').all().map(r=>[r.boundary,r['count(*)']]));if(JSON.stringify(Object.entries(boundaries).sort())!==JSON.stringify(Object.entries(p.summary.boundaries).sort()))invalid();
  }
  for(const [column,summary] of [['classification','classifications'],['priority','priorities']]){const actual=Object.fromEntries(connection.prepare(`SELECT ${column} value,count(*) n FROM findings GROUP BY ${column}`).all().map(r=>[r.value,r.n]));if(JSON.stringify(Object.entries(actual).sort())!==JSON.stringify(Object.entries(report.summary[summary]).sort()))invalid();}
  this.db.prepare('INSERT INTO unified_reviews VALUES(?,?)').run(batch,JSON.stringify(report));
 }
 review(batch){
  if(!validId(batch))throw new Error('INVALID_BATCH');if(this.getBatch(batch)?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
  const r=this.db.prepare('SELECT payload FROM unified_reviews WHERE batch_id=?').get(batch);
  if(!r)return {batchId:batch,status:'not-collected',message:'该历史盘点未保存全域统计与分级，原核查结果仍保留；未用当前数据补算。'};
  const report=JSON.parse(r.payload);this.open(batch,report);return report;
 }
 open(batch,report){
  if(!validId(batch))invalid();const path=join(this.root,'batches',batch,'unified-statistics','results.sqlite'),info=statSync(path),signature=[report.database.sha256,info.size,info.mtimeMs].join(':');
  const old=this.connections.get(batch);if(old?.signature===signature)return old.db;
  if(old){old.db.close();this.connections.delete(batch);}
  const digest=createHash('sha256'),fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024);try{let count;while((count=readSync(fd,buffer,0,buffer.length,null)))digest.update(buffer.subarray(0,count));}finally{closeSync(fd);}
  if(digest.digest('hex')!==report.database.sha256)invalid();
  const database=new DatabaseSync(path,{readOnly:true,defensive:true});
  try{const saved=JSON.parse(database.prepare("SELECT payload FROM manifest WHERE name='report'").get()?.payload||'null');const {database:ignored,...expected}=report;if(hash(JSON.stringify(saved))!==hash(JSON.stringify(expected)))invalid();}
  catch(error){database.close();throw error;}
  if(this.connections.size>=3){const entry=[...this.connections].find(([,value])=>!value.pins);if(entry){entry[1].db.close();this.connections.delete(entry[0]);}}
  this.connections.set(batch,{db:database,signature,pins:0});return database;
 }
 connection(batch){const r=this.review(batch);if(r.status!=='available')throw new Error('UNIFIED_STATISTICS_NOT_COLLECTED');return this.open(batch,r);}
 where(f){const clauses=[],params=[];for(const key of ['family','classification','priority','category','month'])if(f[key]){clauses.push('c.'+key+'=?');params.push(f[key]);}if(f.salesOrder){clauses.push('instr(c.sales_order,?)>0');params.push(f.salesOrder);}if(f.productionOrder){clauses.push('EXISTS(SELECT 1 FROM production_orders p WHERE p.case_id=c.id AND instr(p.production_order,?)>0)');params.push(f.productionOrder);}return {sql:clauses.length?' WHERE '+clauses.join(' AND '):'',params};}
 map(row,db,detail=false,report=null){const data=JSON.parse(inflateSync(row.payload).toString('utf8'));Object.assign(data,{priority:row.priority,frequencyBand:row.frequency,score:row.score});data.persistence={status:'not-collected',consecutive:null,label:'该批未采集连续检出批数，历史结果未补写'};if(report?.persistence){const p=db.prepare('SELECT * FROM persistence WHERE case_id=?').get(row.id);if(!p)invalid();data.persistence={status:p.consecutive===null?'identity-unknown':'observed',consecutive:p.consecutive,firstBatch:p.first_batch,previousBatch:report.persistence.previousBatch?.batchId||null,previousItem:p.previous_id,boundary:p.boundary,label:report.persistence.boundaries[p.boundary],identityVersion:report.persistence.identityVersion};if(detail)data.persistence.identityBasis=p.basis?JSON.parse(p.basis):null;}if(detail){data.stageEvidence=data.stageKey?JSON.parse(db.prepare('SELECT payload FROM stages WHERE id=?').get(data.stageKey)?.payload||'null'):null;data.frequency=report?.categories.find(c=>c.family===data.family&&c.category===data.category);}else delete data.values;return data;}
 rows(f){const db=this.connection(f.batch),report=this.review(f.batch),{sql,params}=this.where(f);return {batchId:f.batch,total:db.prepare('SELECT count(*) n FROM findings c'+sql).get(...params).n,page:f.page,pageSize:f.pageSize,rows:db.prepare('SELECT c.* FROM findings c'+sql+' ORDER BY c.score DESC,c.sales_order,c.id LIMIT ? OFFSET ?').all(...params,f.pageSize,(f.page-1)*f.pageSize).map(r=>this.map(r,db,false,report))};}
 detail(batch,id){const db=this.connection(batch),row=db.prepare('SELECT * FROM findings WHERE id=?').get(id);return row?this.map(row,db,true,this.review(batch)):null;}
 months(f){const db=this.connection(f.batch),{sql,params}=this.where(f);return db.prepare('SELECT month,count(*) items,count(DISTINCT family||char(0)||unit) units FROM findings c'+sql+' GROUP BY month ORDER BY month DESC').all(...params);}
 *export(f){const db=this.connection(f.batch),report=this.review(f.batch),{sql,params}=this.where(f),entry=this.connections.get(f.batch);entry.pins++;try{for(const row of db.prepare('SELECT c.* FROM findings c'+sql+' ORDER BY c.score DESC,c.sales_order,c.id').iterate(...params))yield this.map(row,db,true,report);}finally{entry.pins--;}}
 close(){for(const c of this.connections.values())c.db.close();this.connections.clear();}
}
