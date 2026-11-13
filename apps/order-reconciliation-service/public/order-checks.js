const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const date=v=>v?new Date(v).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'}):'未记录',num=v=>Number(v).toLocaleString('zh-CN');
const initial=new URLSearchParams(location.search);
const state={batch:initial.get('batch')||'',classification:initial.get('classification')||'all',salesOrder:initial.get('salesOrder')||'',productionOrder:initial.get('productionOrder')||'',page:1,pageSize:50,total:0,review:null};
let seq=0,controller=null,detailSeq=0,returnFocus=null;
const clsName=v=>v==='confirmed_numeric_difference'?'已确认数值差异':'依据不足待核查';
const businessText=v=>String(v??'').replaceAll('UpperMoQty','用料行保留基数（业务名称未核实）').replaceAll('Define28','生产编号原字段').replaceAll('u8id+u8autoid+333范围','主单、明细及账套范围');
function params(){return new URLSearchParams({batch:state.batch,classification:state.classification,salesOrder:state.salesOrder,productionOrder:state.productionOrder,page:String(state.page),pageSize:String(state.pageSize)});}
function draftChanged(){return $('classification').value!==state.classification||$('sales-order').value!==state.salesOrder||$('production-order').value!==state.productionOrder;}
function navigation(){const batch=encodeURIComponent(state.batch);$('ledger-link').href='/?batch='+batch;$('statistics-link').href='/statistics?batch='+batch;$('quantity-link').href='/quantity-review?batch='+batch;$('materials-link').href='/material-checks?batch='+batch;history.replaceState(null,'','/order-checks?'+params());}
function clearResults(message='正在读取所选盘点…'){
 state.total=0;$('rows').replaceChildren();const tr=el('tr'),td=el('td',message,'checks-empty');td.colSpan=10;tr.append(td);$('rows').append(tr);
 $('prev').disabled=$('next').disabled=true;$('result-count').textContent=message;$('page-label').textContent='';$('export').setAttribute('aria-disabled','true');closeDetail();
}
async function json(url,signal){const response=await fetch(url,{signal});const data=await response.json();if(!response.ok)throw new Error(data.error||'读取失败');return data;}
function renderRows(data){
 state.total=data.total;$('rows').replaceChildren();
 for(const row of data.rows){
  const v=row.values,tr=el('tr'),status=el('td');status.append(el('span',clsName(row.classification),'check-status'+(row.classification==='pending_evidence'?' pending':'')));tr.append(status,el('td',row.category));
  const sales=el('td',row.salesOrder||'未取得'),production=el('td',row.productionOrders.slice(0,2).join('、')||'未取得');sales.append(el('div','第 '+(v['销售行号']||'未知')+' 行','subline'));if(row.productionOrders.length>2)production.append(el('div','共 '+row.productionOrders.length+' 张，详情查看','checks-order-summary'));tr.append(sales,production,el('td',v['核查物料']||'未取得'));
  for(const key of ['销售数量','生产数量','勤哲投产数量','当前BOM计算数量']){const cell=el('td',v[key]===null||v[key]===''?'—':v[key],'number');tr.append(cell);}
  const action=el('td'),button=el('button','查看','detail-button');button.type='button';button.addEventListener('click',()=>openDetail(row.id,button));action.append(button);tr.append(action);$('rows').append(tr);
 }
 if(!data.rows.length){const tr=el('tr'),td=el('td','当前筛选条件没有核查项；不代表历史业务已通过核查。','checks-empty');td.colSpan=10;tr.append(td);$('rows').append(tr);}
 const pages=Math.max(1,Math.ceil(data.total/data.pageSize));$('result-count').textContent=`筛选结果 ${num(data.total)} 项；销售单与生产单条件同时生效，按输入内容匹配。`;$('page-label').textContent=`第 ${state.page} / ${pages} 页`;$('prev').disabled=state.page<=1;$('next').disabled=state.page>=pages;
 $('export').href='/api/order-checks/export?'+params();$('export').setAttribute('aria-disabled',String(draftChanged()));if(draftChanged())$('result-count').textContent+=' 筛选条件已修改，点击“筛选”后生效。';
}
async function load(){
 const token=++seq;controller?.abort();controller=new AbortController();state.review=null;clearResults();$('load-error').hidden=true;$('unavailable').hidden=true;$('metrics').hidden=true;$('review-origin').textContent='';navigation();
 try{
  const review=await json('/api/order-checks/review?batch='+encodeURIComponent(state.batch),controller.signal);if(token!==seq)return;
  if(review.status==='not-collected'){$('unavailable').textContent=review.message;$('unavailable').hidden=false;$('read-window').textContent='所选历史盘点未保存逐单分类复核。';clearResults('未开展逐单分类复核，未用当前数据补算。');return;}
  state.review=review;const p=review.provenance,reads=p.kind==='preserved_review'?null:review.sourceManifest;const start=p.reviewedSourceStart||reads?.map(r=>r.startedAt).filter(Boolean).sort()[0],end=p.reviewedSourceEnd||reads?.map(r=>r.finishedAt).filter(Boolean).sort().at(-1);
  $('read-window').textContent=`原资料读取：${date(start)} 至 ${date(end)}（北京时间）`;
  $('review-origin').textContent=p.kind==='preserved_review'?`已保存的补充复核；补充资料读取至 ${date(p.supplementaryReads?.map(r=>r.finishedAt).sort().at(-1))}，原盘点未改写。`:'本次全量盘点一起只读复核并保存。';
  $('confirmed-count').textContent=num(review.summary.confirmed);$('pending-count').textContent=num(review.summary.pending);$('orders-count').textContent=num(review.summary.salesOrders);$('metrics').hidden=false;
  const data=await json('/api/order-checks?'+params(),controller.signal);if(token!==seq)return;renderRows(data);
 }catch(error){if(error.name==='AbortError'||token!==seq)return;clearResults('未取得结果，请重试。');$('metrics').hidden=true;$('load-error').textContent=error.message;$('load-error').hidden=false;}
}
function closeDetail(){detailSeq++;$('detail-overlay').hidden=true;const target=returnFocus;returnFocus=null;if(target?.isConnected)target.focus();}
function block(title,values,keys){const section=el('section',undefined,'check-detail-block');section.append(el('h3',title));const dl=el('dl',undefined,'detail-grid');for(const key of keys){let text=values[key]===null||values[key]===undefined||values[key]===''?'未取得 / 不适用':businessText(values[key]);if(key==='BOM修改日期')text=text.replace(/:(?:None|null)(?=；|;|$)/g,':未记录');dl.append(el('dt',key),el('dd',text));}section.append(dl);return section;}
async function openDetail(id,button){
 const token=++detailSeq,batch=state.batch;returnFocus=button;$('detail-overlay').hidden=false;$('detail-content').replaceChildren(el('p','正在读取数量及判断依据…'));$('detail-drawer').focus();
 try{const row=await json('/api/order-checks/detail?'+new URLSearchParams({batch,id}));if(token!==detailSeq||batch!==state.batch)return;const v=row.values,content=$('detail-content'),boundary=row.classification==='confirmed_numeric_difference'?state.review.boundary:'关联、BOM历史及变更适用或计算口径的依据仍不足；保留现有数量和计算，不据此判定业务正确或错误。';content.replaceChildren(el('p',clsName(row.classification)+'：'+boundary,'detail-boundary'));
  content.append(block('订单与数量',v,['核查项目','销售订单','销售行号','生产编号','销售物料','销售数量','生产订单','生产行号','生产物料','生产数量','生产数量口径','核查物料','物料单位','勤哲投产数量','勤哲数量（销售口径）','订单应领数量','订单用量理论数量','当前BOM计算数量','计算数量说明','差值（实际减基准）']));
  content.append(block('分类与判断依据',v,['数值事实','业务判定','待核查依据','补充只读证据']));
  content.append(block('BOM与变更依据',v,['BOM版本','订单审核日期','BOM修改日期','变更单及适用范围','关联大纲更改线索','大纲更改内容']));
  const section=el('section',undefined,'check-detail-block');section.append(el('h3','勤哲对应记录（逐条保留）'));const records=JSON.parse(v['勤哲记录逐条数量']||'[]');for(const record of records)section.append(el('p',`记录 ${record.record}，行 ${record.row}：投产数量 ${record.productionQty??'未取得'}，销售口径数量 ${record.salesQty??'未取得'}，单位 ${record.unit||'未取得'}`,'check-mes-row'));if(!records.length)section.append(el('p','未取得可核对记录。'));content.append(section,el('p','计算路径、精确分数和系统内引用保留在下载的明细中。','drawer-note'));
 }catch(error){if(token===detailSeq)$('detail-content').replaceChildren(el('p',error.message,'notice error'));}
}
$('classification').value=state.classification;$('sales-order').value=state.salesOrder;$('production-order').value=state.productionOrder;
$('filters').addEventListener('submit',event=>{event.preventDefault();state.classification=$('classification').value;state.salesOrder=$('sales-order').value;state.productionOrder=$('production-order').value;state.page=1;load();});
$('clear').addEventListener('click',()=>{$('classification').value='all';$('sales-order').value=$('production-order').value='';$('filters').requestSubmit();});
for(const id of ['classification','sales-order','production-order'])$(id).addEventListener('input',()=>{if(draftChanged()){$('export').setAttribute('aria-disabled','true');$('result-count').textContent='筛选条件已修改，点击“筛选”后生效。';}});
$('export').addEventListener('click',event=>{if($('export').getAttribute('aria-disabled')==='true')event.preventDefault();});
$('batch-select').addEventListener('change',()=>{state.batch=$('batch-select').value;state.page=1;load();});$('retry').addEventListener('click',load);
$('prev').addEventListener('click',()=>{state.page--;load();});$('next').addEventListener('click',()=>{state.page++;load();});
$('close-detail').addEventListener('click',closeDetail);$('detail-overlay').addEventListener('click',event=>{if(event.target===$('detail-overlay'))closeDetail();});
document.addEventListener('keydown',event=>{if($('detail-overlay').hidden)return;if(event.key==='Escape')closeDetail();if(event.key==='Tab'){event.preventDefault();$('close-detail').focus();}});
try{const data=await json('/api/batches');$('batch-select').replaceChildren();for(const b of data.batches){const option=el('option',`${date(b.startedAt)} · ${{succeeded:'已完成',running:'盘点中',failed:'失败'}[b.status]}${b.orderCheckStatus==='available'?' · 含逐单复核':''}`);option.value=b.id;$('batch-select').append(option);}if(!state.batch)state.batch=data.batches.find(b=>b.status==='succeeded')?.id||'';if(state.batch&&!data.batches.some(b=>b.id===state.batch))throw new Error('所选盘点记录不存在');$('batch-select').value=state.batch;$('batch-select').disabled=false;if(state.batch)await load();else clearResults('尚无盘点记录，请从首页开始全量盘点。');}catch(error){clearResults('未取得盘点记录');$('load-error').textContent=error.message;$('load-error').hidden=false;}

const chainLink=document.getElementById("chain-link"),chainAnchor=document.getElementById("checks-link")||document.getElementById("quantity-link");
function syncChainLink(){const batch=new URL(chainAnchor.href).searchParams.get("batch");chainLink.href="/chain-checks"+(batch?"?batch="+encodeURIComponent(batch):"");document.getElementById("processing-link").href="/processing-checks"+(batch?"?batch="+encodeURIComponent(batch):"");}
new MutationObserver(syncChainLink).observe(chainAnchor,{attributes:true,attributeFilter:["href"]});syncChainLink();
