import http from 'node:http';
import {issueName,queryText} from './public/business-terms.js';
import {readFile} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import {readQuantityReview,quantityExport} from './quantity-review.mjs';
import {networkInterfaces} from 'node:os';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {once} from 'node:events';
import {isIP} from 'node:net';
import {Store} from './store.mjs';
import {Runner} from './collector.mjs';
import {checkFilters} from './order-checks.mjs';
import {materialFilters} from './material-checks.mjs';
import {chainFilters} from './chain-checks.mjs';
import {processingFilters} from './processing-checks.mjs';
import {statisticsFilters} from './unified-statistics.mjs';
import {buildDetailEvidence,validateDirectory} from './detail-evidence.mjs';
const app=fileURLToPath(new URL('.',import.meta.url));
const root=process.env.ORDER_DATA_ROOT?resolve(process.env.ORDER_DATA_ROOT):resolve(app,'../../artifacts/order-reconciliation-9998');
const store=new Store(join(root,'results.sqlite'));
const runner=new Runner(store,root);
let userDirectory=null;
try{userDirectory=validateDirectory(JSON.parse(await readFile(join(root,'user-evidence.json'),'utf8')));}catch{console.warn('USER_EVIDENCE_UNAVAILABLE');}
const port=9998;
const access=process.env.ORDER_ACCESS==='lan'?'lan':'current-host-only';
const local=new Set(['127.0.0.1','::1',...Object.values(networkInterfaces()).flat().filter(x=>x?.family==='IPv4').map(x=>x.address)]);
const hosts=new Set(['localhost','127.0.0.1','[::1]',...local].map(x=>`${x}:${port}`));
function validHost(value){
 if(access!=='lan')return hosts.has(value);
 try{const parsed=new URL(`http://${value}`);const hostname=parsed.hostname.replace(/^\[|\]$/g,'');return parsed.port===String(port)&&(hostname==='localhost'||isIP(hostname)>0)&&parsed.username===''&&parsed.password==='';}catch{return false;}
}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
function queryFilters(url){
 const allowed=['batch','kind','q','page','pageSize'];for(const k of url.searchParams.keys())if(!allowed.includes(k))throw new Error('INVALID_QUERY');
 const batch=url.searchParams.get('batch');if(!batch||batch.length>80)throw new Error('INVALID_BATCH');
 const kind=url.searchParams.get('kind')||'all';if(!['all','findings','unmatched'].includes(kind))throw new Error('INVALID_KIND');
 const q=url.searchParams.get('q')||'';if(q.length>250)throw new Error('QUERY_TOO_LONG');
 const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||50);
 if(!Number.isSafeInteger(page)||page<1||page>1000000||![20,50,100].includes(pageSize))throw new Error('INVALID_PAGE');
 return {batch,kind,q:queryText(q),page,pageSize};
}
const staticFiles={'/business-terms.js':['business-terms.js','text/javascript'],'/':['index.html','text/html'],'/index.html':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/style.css':['style.css','text/css'],'/statistics':['unified-statistics.html','text/html'],'/statistics.html':['unified-statistics.html','text/html'],'/statistics.js':['statistics.js','text/javascript'],'/statistics.css':['statistics.css','text/css']};
Object.assign(staticFiles,{'/quantity-review':['quantity.html','text/html'],'/quantity.js':['quantity.js','text/javascript'],'/quantity.css':['quantity.css','text/css']});
Object.assign(staticFiles,{'/order-checks':['order-checks.html','text/html'],'/order-checks.js':['order-checks.js','text/javascript'],'/order-checks.css':['order-checks.css','text/css']});
Object.assign(staticFiles,{'/material-checks':['material-checks.html','text/html'],'/material-checks.js':['material-checks.js','text/javascript'],'/material-checks.css':['material-checks.css','text/css']});
const csvCell=v=>{let text=v===null||v===undefined?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+\-@\t\r]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
Object.assign(staticFiles,{'/chain-checks':['chain-checks.html','text/html'],'/chain-checks.js':['chain-checks.js','text/javascript'],'/chain-checks.css':['chain-checks.css','text/css']});
Object.assign(staticFiles,{'/processing-checks':['processing-checks.html','text/html'],'/processing-checks.js':['processing-checks.js','text/javascript'],'/processing-checks.css':['processing-checks.css','text/css']});
Object.assign(staticFiles,{'/legacy-statistics':['legacy-statistics.html','text/html'],'/legacy-statistics.js':['legacy-statistics.js','text/javascript'],'/unified-statistics.js':['unified-statistics.js','text/javascript'],'/unified-statistics.css':['unified-statistics.css','text/css']});
const server=http.createServer(async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
 res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
 const remote=(req.socket.remoteAddress||'').replace(/^::ffff:/,'');
 if(access!=='lan'&&!local.has(remote)){send(res,403,{ok:false,error:'当前运行模式仅允许本机访问'});return;}
 if(!validHost(req.headers.host)){send(res,403,{ok:false,error:'访问地址不在本服务范围'});return;}
 if(req.headers['sec-fetch-site']==='cross-site'){send(res,403,{ok:false,error:'请从订单核对页面访问'});return;}
 if(req.headers.origin && req.headers.origin!==`http://${req.headers.host}`){send(res,403,{ok:false,error:'请从当前订单核对页面操作'});return;}
 try{
  const url=new URL(req.url,`http://${req.headers.host}`);
  if(req.method==='GET'&&url.pathname==='/api/processing-checks/review'){
   if([...url.searchParams.keys()].some(k=>k!=='batch'))throw new Error('INVALID_QUERY');
   const f=processingFilters(url.searchParams);send(res,200,store.processing.review(f.batch));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/processing-checks'){
   const f=processingFilters(url.searchParams);send(res,200,store.processing.rows(f.batch,f));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/processing-checks/detail'){
   if([...url.searchParams.keys()].some(k=>!['batch','id'].includes(k))||url.searchParams.getAll('batch').length!==1||url.searchParams.getAll('id').length!==1)throw new Error('INVALID_QUERY');
   const id=url.searchParams.get('id');if(!id||id.length>400)throw new Error('INVALID_QUERY');
   const f=processingFilters(new URLSearchParams({batch:url.searchParams.get('batch')||''})),row=store.processing.detail(f.batch,id);
   send(res,row?200:404,row||{ok:false,error:'所选盘点中没有此加工流转明细'});return;
  }
  if(req.method==='GET'&&url.pathname==='/api/processing-checks/export'){
   const f=processingFilters(url.searchParams),report=store.processing.review(f.batch);store.processing.where(f.batch,f);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="processing-checks-${f.batch}.csv"`});
   res.write('\uFEFF'+report.columns.map(csvCell).join(',')+'\r\n');
   for(const row of store.processing.export(f.batch,f))if(!res.write(report.columns.map(k=>csvCell(row.values[k])).join(',')+'\r\n'))await once(res,'drain');
   res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/api/unified-statistics/review'){
   for(const key of url.searchParams.keys())if(key!=='batch')throw new Error('INVALID_QUERY');
   const f=statisticsFilters(url.searchParams);send(res,200,store.unified.review(f.batch));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/unified-statistics'){
   const f=statisticsFilters(url.searchParams);send(res,200,{...store.unified.rows(f),months:store.unified.months(f)});return;
  }
  if(req.method==='GET'&&url.pathname==='/api/unified-statistics/detail'){
   const f=statisticsFilters(url.searchParams,{detail:true}),row=store.unified.detail(f.batch,f.id);
   send(res,row?200:404,row||{ok:false,error:'该盘点没有此核查项'});return;
  }
  if(req.method==='GET'&&url.pathname==='/api/unified-statistics/export'){
   const f=statisticsFilters(url.searchParams);store.unified.connection(f.batch);
   const fields=[['核查项编号',r=>r.id],['核查类别',r=>r.label],['分类',r=>r.classification==='confirmed_record_difference'?'已确认记录差异':'依据不足待核查'],['核查优先级（初拟）',r=>r.priority],['潜在影响等级',r=>r.severity],['距交付阶段',r=>r.stageEvidence?.label||'阶段依据不足'],['真实发生频次',()=> '未知'],['连续可确认检出批数',r=>r.persistence?.consecutive],['连续性依据',r=>r.persistence],['本批同类检出率及分母',r=>r.frequency],['销售订单',r=>r.salesOrder],['生产订单',r=>r.productionOrders],['订单月份',r=>r.month],['核查依据',r=>r.values],['阶段凭据',r=>r.stageEvidence],['原始结果定位',r=>r.reference]];
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="unified-statistics-${f.batch}.csv"`});
   res.write('\uFEFF'+fields.map(([name])=>csvCell(name)).join(',')+'\r\n');
   for(const row of store.unified.export(f))if(!res.write(fields.map(([,get])=>csvCell(get(row))).join(',')+'\r\n'))await once(res,'drain');
   res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/api/chain-checks/review'){
   if([...url.searchParams.keys()].some(k=>k!=='batch'))throw new Error('INVALID_QUERY');
   const f=chainFilters(url.searchParams);send(res,200,store.chain.review(f.batch));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/chain-checks'){
   const f=chainFilters(url.searchParams);send(res,200,store.chain.rows(f.batch,f));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/chain-checks/detail'){
   if([...url.searchParams.keys()].some(k=>!['batch','id'].includes(k))||url.searchParams.getAll('batch').length!==1||url.searchParams.getAll('id').length!==1)throw new Error('INVALID_QUERY');
   const id=url.searchParams.get('id');if(!id||id.length>220)throw new Error('INVALID_QUERY');
   const f=chainFilters(new URLSearchParams({batch:url.searchParams.get('batch')||''})),row=store.chain.detail(f.batch,id);
   if(!row){send(res,404,{ok:false,error:'所选盘点中没有此链路明细'});return;}send(res,200,row);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/chain-checks/export'){
   const f=chainFilters(url.searchParams),review=store.chain.review(f.batch);store.chain.where(f.batch,f);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="chain-checks-${f.batch}.csv"`});
   res.write('\uFEFF'+review.columns.map(csvCell).join(',')+'\r\n');
   for(const r of store.chain.export(f.batch,f))if(!res.write(review.columns.map(k=>csvCell(r.values[k])).join(',')+'\r\n'))await once(res,'drain');
   res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/api/material-checks/reviews'){
   if(url.search)throw new Error('INVALID_QUERY');send(res,200,{reviews:store.material.list()});return;
  }
  if(req.method==='GET'&&url.pathname==='/api/material-checks/review'){
   if([...url.searchParams.keys()].some(k=>k!=='review'))throw new Error('INVALID_QUERY');
   const f=materialFilters(url.searchParams);send(res,200,store.material.review(f.review));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/material-checks'){
   const f=materialFilters(url.searchParams);send(res,200,store.material.rows(f.review,f));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/material-checks/detail'){
   if([...url.searchParams.keys()].some(k=>!['review','id'].includes(k))||url.searchParams.getAll('review').length!==1||url.searchParams.getAll('id').length!==1)throw new Error('INVALID_QUERY');
   const id=url.searchParams.get('id');if(!id||id.length>220)throw new Error('INVALID_QUERY');
   const f=materialFilters(new URLSearchParams({review:url.searchParams.get('review')||''})),row=store.material.detail(f.review,id);
   if(!row){send(res,404,{ok:false,error:'所选复核记录中没有此明细'});return;}send(res,200,row);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/material-checks/export'){
   const f=materialFilters(url.searchParams),review=store.material.review(f.review);store.material.where(f.review,f);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="material-checks-${f.review}.csv"`});
   res.write('\uFEFF'+review.columns.map(csvCell).join(',')+'\r\n');
   for(const r of store.material.export(f.review,f))if(!res.write(review.columns.map(k=>csvCell(r.values[k])).join(',')+'\r\n'))await once(res,'drain');
   res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/api/order-checks/review'){
   if([...url.searchParams.keys()].some(k=>k!=='batch'))throw new Error('INVALID_QUERY');
   const f=checkFilters(url.searchParams);send(res,200,store.orderCheckReview(f.batch));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/order-checks'){
   const f=checkFilters(url.searchParams);send(res,200,store.orderChecks(f.batch,f));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/order-checks/detail'){
   if([...url.searchParams.keys()].some(k=>!['batch','id'].includes(k))||url.searchParams.getAll('id').length!==1||url.searchParams.getAll('batch').length!==1)throw new Error('INVALID_QUERY');
   const id=url.searchParams.get('id');if(!id||id.length>220)throw new Error('INVALID_QUERY');
   const f=checkFilters(new URLSearchParams({batch:url.searchParams.get('batch')||''})),row=store.orderCheck(f.batch,id);
   if(!row){send(res,404,{ok:false,error:'所选盘点中没有此核查明细'});return;}send(res,200,row);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/order-checks/export'){
   const f=checkFilters(url.searchParams),review=store.orderCheckReview(f.batch);store.orderCheckWhere(f.batch,f);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="order-checks-${f.batch}.csv"`});
   res.write('\uFEFF'+review.columns.map(csvCell).join(',')+'\r\n');
   for(const row of store.exportOrderChecks(f.batch,f))if(!res.write(review.columns.map(k=>csvCell(row.values[k])).join(',')+'\r\n'))await once(res,'drain');
   res.end();return;
  }
  if(req.method==='GET'&&url.pathname==='/api/quantity-review'){
   if([...url.searchParams.keys()].some(key=>key!=='batch')||url.searchParams.getAll('batch').length>1)throw new Error('INVALID_QUERY');
   const batch=url.searchParams.get('batch');if(batch&&batch!=='legacy'&&!/^[\w-]{1,80}$/.test(batch))throw new Error('INVALID_BATCH');
   send(res,200,!batch||batch==='legacy'?await readQuantityReview(root):store.quantityReview(batch));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/quantity-review/export'){
   if([...url.searchParams.keys()].some(key=>!['kind','batch'].includes(key))||url.searchParams.getAll('kind').length!==1||url.searchParams.getAll('batch').length>1)throw new Error('INVALID_QUERY');
   const batch=url.searchParams.get('batch');if(batch&&batch!=='legacy'&&!/^[\w-]{1,80}$/.test(batch))throw new Error('INVALID_BATCH');
   const report=batch&&batch!=='legacy'?store.quantityReview(batch):null;
   if(report?.status==='not-collected')throw new Error('QUANTITY_REVIEW_NOT_COLLECTED');
   const file=await quantityExport(root,url.searchParams.get('kind'),report);
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="${file.name}"`,'Content-Length':file.size});
   await pipeline(createReadStream(file.path),res);return;
  }
  if(req.method==='GET'&&url.pathname==='/api/health'){const batches=store.list();send(res,200,{ok:true,service:'order-reconciliation',version:'0.14.0',port,readOnlySources:true,sourceDriver:process.env.ORDER_DB_DRIVER==='node'?'node-mssql':'windows-powershell',runtime:process.version,storage:'sqlite',access,activeBatch:runner.active,latestSuccessfulBatch:batches.find(b=>b.status==='succeeded')??null});return;}
  if(req.method==='GET'&&url.pathname==='/api/batches'){send(res,200,{batches:store.list()});return;}
  if(req.method==='POST'&&url.pathname==='/api/batches'){
   if(req.headers['x-requested-with']!=='order-reconciliation'||!String(req.headers['content-type']||'').startsWith('application/json')){send(res,403,{ok:false,error:'请从本服务页面发起盘点'});return;}
   let body='';for await(const part of req){body+=part.toString('utf8');if(body.length>128)throw new Error('INVALID_REQUEST');}
   const value=JSON.parse(body||'{}');if(Object.keys(value).length)throw new Error('INVALID_REQUEST');
   const id=await runner.start();send(res,202,{batchId:id,status:'running'});return;
  }
  if(req.method==='GET'&&/^\/api\/batches\/[\w-]+\/anomalies$/.test(url.pathname)){const id=url.pathname.split('/').at(-2);if(!store.get(id)){send(res,404,{ok:false,error:'盘点记录不存在'});return;}send(res,200,store.anomalies(id));return;}
  if(req.method==='GET'&&/^\/api\/batches\/[\w-]+$/.test(url.pathname)){const batch=store.get(url.pathname.split('/').at(-1));send(res,batch?200:404,batch?{batch}:{ok:false,error:'盘点记录不存在'});return;}
  if(req.method==='GET'&&url.pathname==='/api/records'){const f=queryFilters(url);send(res,200,store.records(f.batch,f.kind,f.q,f.page,f.pageSize));return;}
  if(req.method==='GET'&&url.pathname==='/api/record-detail'){
   for(const key of url.searchParams.keys())if(!['batch','id'].includes(key))throw new Error('INVALID_QUERY');
   const batch=url.searchParams.get('batch'),id=url.searchParams.get('id');
   if(!batch||batch.length>80||!id||id.length>160)throw new Error('INVALID_QUERY');
   const record=store.record(batch,id);if(!record){send(res,404,{ok:false,error:'本次订单核对明细不存在'});return;}
   send(res,200,buildDetailEvidence(record,batch,userDirectory));return;
  }
  if(req.method==='GET'&&url.pathname==='/api/export'){
   const f=queryFilters(url),batch=store.get(f.batch);if(batch?.status!=='succeeded')throw new Error('NO_VALID_BATCH_RESULT');
   const fields=[['盘点记录编号',()=>f.batch],['核对规则版本（追溯用）',()=>batch.ruleVersion],['生产编号',r=>r.productionNumber],['销售订单',r=>r.salesOrder],['销售明细系统内编号',r=>r.salesDetailId],['生产订单',r=>r.productionOrder],['生产明细系统内编号',r=>r.productionDetailId],['转换记录系统内编号',r=>r.interfaceId],['勤哲记录系统内编号',r=>r.mesId],['销售质量编号',r=>r.qualitySales],['生产质量编号',r=>r.qualityProduction],['勤哲质量编号原值',r=>r.qualityMes],['存货编码',r=>r.inventoryCode],['状态',r=>({matched:'已关联',difference:'存在差异',unmatched:'关联待核查'}[r.status])],['核对问题',r=>r.issues.map(issueName).join('；')],['原始检查及依据（追溯用）',r=>r.issues],['原始关联依据（追溯用）',r=>r.associationBasis],['原单据资料（追溯用）',r=>r.evidence]];
   res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':`attachment; filename="order-inventory-${f.batch}-${f.kind}.csv"`});
   res.write('\uFEFF'+fields.map(([name])=>csvCell(name)).join(',')+'\r\n');
   for(const row of store.exportRows(f.batch,f.kind,f.q)){if(!res.write(fields.map(([,get])=>csvCell(get(row))).join(',')+'\r\n'))await once(res,'drain');}
   res.end();return;
  }
  if(req.method==='GET'&&staticFiles[url.pathname]){const [file,type]=staticFiles[url.pathname];res.writeHead(200,{'Content-Type':`${type}; charset=utf-8`});res.end(await readFile(join(app,'public',file)));return;}
  send(res,404,{ok:false,error:'入口不存在'});
 }catch(error){
  if(res.headersSent){res.destroy();return;}
  if(error.message==='UNIFIED_STATISTICS_NOT_COLLECTED'){send(res,409,{ok:false,error:'该历史盘点未保存全域统计与分级，原核查结果仍保留'});return;}
  if(error.message==='UNIFIED_STATISTICS_INVALID'){send(res,503,{ok:false,error:'统计依据或文件校验失败，未提供部分结果'});return;}
  if(error.message==='CHAIN_CHECKS_NOT_COLLECTED'){send(res,409,{ok:false,error:'所选历史盘点未采集链路风险，未使用当前数据补算'});return;}
  if(error.message==='PROCESSING_CHECKS_NOT_COLLECTED'){send(res,409,{ok:false,error:'所选历史盘点未采集加工流转核查，不能解释为没有缺口'});return;}
  if(error.message==='PROCESSING_CHECKS_INVALID'){send(res,503,{ok:false,error:'加工流转核查依据或汇总校验失败，未提供部分结果'});return;}
  if(error.message==='MATERIAL_CHECKS_NOT_COLLECTED'){send(res,409,{ok:false,error:'所选盘点未保存入库与领料核查，未使用当前数据补算'});return;}
  if(error.message==='QUANTITY_REVIEW_NOT_COLLECTED'){send(res,409,{ok:false,error:'该历史盘点未采集数量与BOM资料，没有可导出的数量核查结果'});return;}
  if(error.message==='ORDER_CHECKS_NOT_COLLECTED'){send(res,409,{ok:false,error:'该历史盘点未保存逐单分类复核，未使用当前数据补算'});return;}
  if(error.message==='QUANTITY_REVIEW_UNAVAILABLE'||error.message==='QUANTITY_REVIEW_INVALID'){send(res,503,{ok:false,error:error.message==='QUANTITY_REVIEW_UNAVAILABLE'?'尚未取得独立数量核查结果；请联系维护人员核查':'数量核查资料不完整或汇总不一致，未提供结果'});return;}
  const known={BATCH_ALREADY_RUNNING:'已有盘点正在执行，请等待完成',UNSUPPORTED_RULE_CONFIG:'本次盘点设置暂不可用，尚未查询原单据，请联系维护人员核查',IMPLEMENTATION_RESTART_REQUIRED:'订单核对工具已更新，请联系维护人员完成重启后再开始盘点',NO_VALID_BATCH_RESULT:'本次没有可用结果；盘点中或失败的记录不提供部分结果',INVALID_QUERY:'查询条件不支持，请重新选择或填写',INVALID_BATCH:'所选盘点记录无效，请重新选择',INVALID_KIND:'查询范围无效，请重新选择',QUERY_TOO_LONG:'查询内容不能超过250个字符',INVALID_PAGE:'页码无效，请重新选择',INVALID_REQUEST:'未能识别盘点请求，请从页面重新发起'};
  if(error.message==='ANOMALY_STATISTICS_MISMATCH'){send(res,500,{ok:false,error:'异常统计与本次订单核对明细汇总不一致，未提供统计结果'});return;}
  send(res,error.message==='BATCH_ALREADY_RUNNING'?409:400,{ok:false,error:known[error.message]||'操作未完成，请重试；如仍失败，请联系维护人员核查'});
 }
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.on('error',()=>{console.error('9998_START_FAILED');store.close();process.exitCode=1;});
server.listen(port,'0.0.0.0',()=>{store.recoverInterrupted();console.log(JSON.stringify({service:'order-reconciliation',port,sourceAccess:'SELECT-only',access,ready:true}));});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close(()=>{store.close();process.exit(0);});});
