import {issueName, batchState} from './business-terms.js';
const $=id=>document.getElementById(id);
const state={batches:[],batchId:new URLSearchParams(location.search).get('batch')||'',typeKey:'',data:null,request:0};
const number=value=>Number(value).toLocaleString('zh-CN');
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
async function api(path){const response=await fetch(path,{cache:'no-store'}).catch(()=>{throw new Error('暂时无法连接订单核对工具，请稍后重试。');});let data;try{data=await response.json();}catch{throw new Error('未能读取查询结果，请重试。');}if(!response.ok||data.ok===false)throw new Error(data.error||`请求失败（${response.status}）`);return data;}
function message(text,error=false){$('statistics-status').textContent=text;$('statistics-status').className=`notice${error?' error':''}`;$('statistics-status').setAttribute('role',error?'alert':'status');}
function emptyRows(id,columns,text){const row=element('tr'),cell=element('td',text,'statistics-empty');cell.colSpan=columns;row.append(cell);$(id).replaceChildren(row);}
function clear(text){state.data=null;$('type-select').replaceChildren(element('option','全部异常'));$('type-select').disabled=true;for(const id of ['total-issues','affected-records','type-count','unknown-issues','type-total','type-record-total','month-total','month-record-total','monthly-total'])$(id).textContent='—';$('monthly-label').textContent='全部异常';$('month-timeline').replaceChildren(element('span',text));$('month-timeline').setAttribute('aria-label',text);$('scope-note').textContent='统计范围为所选盘点记录全部核对明细，与首页检索条件无关。关联待核查另列，不直接计作异常。';emptyRows('type-rows',3,text);emptyRows('month-rows',4,text);}
function bar(value,maximum){const namespace='http://www.w3.org/2000/svg',svg=document.createElementNS(namespace,'svg');svg.setAttribute('viewBox','0 0 1000 8');svg.setAttribute('preserveAspectRatio','none');svg.setAttribute('aria-hidden','true');svg.classList.add('type-bar');for(const [width,cls] of [[1000,'bar-track'],[maximum?value/maximum*1000:0,'bar-value']]){const rect=document.createElementNS(namespace,'rect');rect.setAttribute('width',String(width));rect.setAttribute('height','8');rect.setAttribute('rx','3');rect.classList.add(cls);svg.append(rect);}return svg;}
function validate(data,batch){
 const count=value=>Number.isSafeInteger(value)&&value>=0;
 const fail=()=>{throw new Error('总数、月度分布与本次盘点核对明细不一致，未展示统计结果。');};
 if(data.batchId!==batch.id||data.statisticsVersion!==2||data.monthlyBasis!=='u8-order-month'||data.basis!=='issue-count'||!Array.isArray(data.types)||!Array.isArray(data.months))fail();
 if(![data.totalIssueCount,data.affectedRecordCount,data.unmatchedRecordCount].every(count)||data.totalIssueCount!==batch.summary.findings||data.affectedRecordCount!==batch.summary.findingRecords||data.unmatchedRecordCount!==batch.summary.unmatched)fail();
 const typeKeys=new Set();
 for(const type of data.types){if(typeof type.key!=='string'||typeKeys.has(type.key)||typeof type.label!=='string'||!type.label||![type.issueCount,type.recordCount].every(count)||type.recordCount>type.issueCount)fail();typeKeys.add(type.key);}
 if(data.types.reduce((sum,type)=>sum+type.issueCount,0)!==data.totalIssueCount)fail();
 const totals={issues:0,records:0,rows:0,unmatched:0},byType=new Map(),months=new Set();
 for(const month of data.months){
  if((month.month!==null&&!/^\d{4}-(0[1-9]|1[0-2])$/.test(month.month))||months.has(month.month)||![month.issueCount,month.recordCount,month.ledgerRows,month.unmatchedRecordCount].every(count)||month.recordCount>month.ledgerRows||month.unmatchedRecordCount>month.ledgerRows||!Array.isArray(month.types))fail();
  months.add(month.month);const seen=new Set();let issues=0;
  for(const type of month.types){if(!typeKeys.has(type.key)||seen.has(type.key)||![type.issueCount,type.recordCount].every(count)||type.recordCount>type.issueCount||type.recordCount>month.recordCount)fail();seen.add(type.key);issues+=type.issueCount;const previous=byType.get(type.key)||{issues:0,records:0};previous.issues+=type.issueCount;previous.records+=type.recordCount;byType.set(type.key,previous);}
  if(issues!==month.issueCount)fail();totals.issues+=month.issueCount;totals.records+=month.recordCount;totals.rows+=month.ledgerRows;totals.unmatched+=month.unmatchedRecordCount;
 }
 if(totals.issues!==data.totalIssueCount||totals.records!==data.affectedRecordCount||totals.rows!==batch.summary.ledgerRows||totals.unmatched!==data.unmatchedRecordCount)fail();
 for(const type of data.types)if(byType.get(type.key)?.issues!==type.issueCount||byType.get(type.key)?.records!==type.recordCount)fail();
}
function timeline(months,label){
 const periods=months.filter(item=>item.month!==null).reverse(),container=$('month-timeline');
 container.replaceChildren();container.setAttribute('aria-label',`${label}的订单月份分布，准确数量见下方逐月表格`);
 if(!periods.length){container.append(element('span','没有可归月的核对明细记录'));return;}
 const namespace='http://www.w3.org/2000/svg',svg=document.createElementNS(namespace,'svg');svg.setAttribute('viewBox','0 0 700 104');svg.setAttribute('aria-hidden','true');
 const shape=(tag,attributes,text)=>{const node=document.createElementNS(namespace,tag);for(const [key,value] of Object.entries(attributes))node.setAttribute(key,String(value));if(text!==undefined)node.textContent=text;svg.append(node);return node;};
 const maximum=Math.max(0,...periods.map(item=>item.issueCount)),step=642/periods.length;
 shape('line',{x1:44,y1:76,x2:686,y2:76,class:'timeline-axis'});shape('text',{x:36,y:12,'text-anchor':'end'},number(maximum));shape('text',{x:36,y:79,'text-anchor':'end'},'0');
 for(let index=0;index<periods.length;index++){const period=periods[index],x=44+step*(index+.5),height=maximum?period.issueCount/maximum*64:0;
  const rect=shape('rect',{x:x-step*.31,y:76-height,width:step*.62,height,class:'bar-value'});const title=document.createElementNS(namespace,'title');title.textContent=`${period.month}：${number(period.issueCount)} 项`;rect.append(title);
  if(index%Math.max(1,Math.ceil(periods.length/6))===0||index===periods.length-1)shape('text',{x,y:95,'text-anchor':'middle'},period.month);
 }
 container.append(svg);
}
function renderMonths(){
 const data=state.data;if(!data)return;
 const type=data.types.find(item=>item.key===state.typeKey);
 const months=[...data.months.filter(item=>item.month!==null).reverse(),...data.months.filter(item=>item.month===null)].map(month=>({...month,...(type?(month.types.find(item=>item.key===type.key)||{issueCount:0,recordCount:0}):{})}));
 const maximum=Math.max(0,...months.map(item=>item.issueCount));
 timeline(months,type?issueName(type):'全部异常');
 $('monthly-label').textContent=type?issueName(type):'全部异常';$('monthly-total').textContent=`${number(type?.issueCount??data.totalIssueCount)} 项 · ${number(type?.recordCount??data.affectedRecordCount)} 行`;
 $('month-total').textContent=number(type?.issueCount??data.totalIssueCount);$('month-record-total').textContent=number(type?.recordCount??data.affectedRecordCount);
 const body=$('month-rows');body.replaceChildren();
 for(const month of months){const row=element('tr',undefined,month.month===null?'unknown-month':'');row.append(element('td',month.month??'月份未知'));const graphic=element('td');graphic.append(bar(month.issueCount,maximum));row.append(graphic,element('td',number(month.issueCount)),element('td',number(month.recordCount)));body.append(row);}
 if(!months.length)emptyRows('month-rows',4,'本次盘点没有核对明细记录。');
 for(const button of document.querySelectorAll('.type-button')){const selected=button.dataset.key===state.typeKey;button.setAttribute('aria-pressed',String(selected));button.closest('tr').classList.toggle('selected',selected);}
 $('type-select').value=state.typeKey;
}
function render(){
 const data=state.data;$('total-issues').textContent=number(data.totalIssueCount);$('affected-records').textContent=number(data.affectedRecordCount);$('type-count').textContent=number(data.types.length);$('unknown-issues').textContent=number(data.months.find(item=>item.month===null)?.issueCount??0);
 $('type-total').textContent=number(data.totalIssueCount);$('type-record-total').textContent=number(data.affectedRecordCount);
 $('scope-note').textContent=`本次盘点关联待核查 ${number(data.unmatchedRecordCount)} 行，未直接计作异常；其中已发现的问题仍计入对应异常类型。统计与首页检索条件无关。`;
 const select=$('type-select');select.replaceChildren();const all=element('option','全部异常');all.value='';select.append(all);
 const body=$('type-rows');body.replaceChildren();const maximum=Math.max(0,...data.types.map(item=>item.issueCount));
 for(const type of data.types){const row=element('tr'),cell=element('td'),button=element('button',issueName(type),'type-button');button.type='button';button.dataset.key=type.key;button.setAttribute('aria-pressed','false');button.addEventListener('click',()=>{state.typeKey=state.typeKey===type.key?'':type.key;renderMonths();});cell.append(button,bar(type.issueCount,maximum));row.append(cell,element('td',number(type.issueCount)),element('td',number(type.recordCount)));body.append(row);const option=element('option',issueName(type));option.value=type.key;select.append(option);}
 if(!data.types.length)emptyRows('type-rows',3,'未发现本次盘点已定义规则覆盖的问题条目。');
 if(!data.types.some(item=>item.key===state.typeKey))state.typeKey='';select.disabled=!data.types.length;renderMonths();
 message(data.totalIssueCount?'显示所选盘点记录的完整统计。左侧为各类总数，右侧可切换类型查看订单月份分布。':'本次盘点问题条目为0，不代表全部原单据内容已确认正确。');
}
function batchHeading(batch){
 $('batch-status').textContent=batch?batchState(batch.status):'尚无盘点记录';$('batch-status').className=`badge ${batch?({succeeded:'success',failed:'failed',running:'running'})[batch.status]:'neutral'}`;
 $('batch-time').textContent=batch?`${time(batch.startedAt)}${batch.finishedAt?` → ${time(batch.finishedAt)}`:''}（北京时间）`:'—';
 $('ledger-link').href=state.batchId?`/?batch=${encodeURIComponent(state.batchId)}`:'/';
 $('quantity-link').href=state.batchId?`/quantity-review?batch=${encodeURIComponent(state.batchId)}`:'/quantity-review';
 $('checks-link').href=state.batchId?`/order-checks?batch=${encodeURIComponent(state.batchId)}`:'/order-checks';
 $('materials-link').href=state.batchId?`/material-checks?batch=${encodeURIComponent(state.batchId)}`:'/material-checks';
 if(state.batchId)history.replaceState(null,'',`/legacy-statistics?batch=${encodeURIComponent(state.batchId)}`);
}
async function loadStatistics(){
 const request=++state.request,batch=state.batches.find(item=>item.id===state.batchId);batchHeading(batch);clear('正在读取统计…');
 if(batch?.status!=='succeeded'){const text=batch?.status==='failed'?'本次盘点失败，没有有效异常统计。':batch?.status==='running'?'本次盘点正在执行，全部必要读取和结果保存成功后才能统计。':'尚无盘点记录，请先从订单核对明细发起全量盘点。';clear(text);message(text,batch?.status==='failed');return;}
 message('正在读取所选盘点记录的统计…');
 try{const data=await api(`/api/batches/${encodeURIComponent(batch.id)}/anomalies`);if(request!==state.request)return;validate(data,batch);state.data=data;render();}catch(error){if(request!==state.request)return;clear('统计读取失败，请点击“刷新统计”重试。');message(error.message,true);}
}
async function refresh(){
 const request=++state.request;clear('正在读取盘点记录…');message('正在读取盘点记录…');
 try{const data=await api('/api/batches');if(request!==state.request)return;state.batches=data.batches||[];if(!state.batches.some(item=>item.id===state.batchId))state.batchId=state.batches.find(item=>item.status==='succeeded')?.id||state.batches[0]?.id||'';
  const select=$('batch-select');select.replaceChildren();for(const batch of state.batches){const option=element('option',`${time(batch.startedAt)} · ${batchState(batch.status)}`);option.value=batch.id;select.append(option);}if(!state.batches.length)select.append(element('option','尚无盘点记录'));select.value=state.batchId;await loadStatistics();
 }catch(error){if(request!==state.request)return;clear('盘点记录读取失败，请点击“刷新统计”重试。');message(error.message,true);}
}
$('type-select').addEventListener('change',event=>{state.typeKey=event.target.value;renderMonths();});
$('batch-select').addEventListener('change',event=>{state.batchId=event.target.value;state.typeKey='';loadStatistics();});
$('refresh-statistics').addEventListener('click',refresh);
refresh();

const chainLink=document.getElementById("chain-link"),chainAnchor=document.getElementById("checks-link")||document.getElementById("quantity-link");
function syncChainLink(){const batch=new URL(chainAnchor.href).searchParams.get("batch");chainLink.href="/chain-checks"+(batch?"?batch="+encodeURIComponent(batch):"");document.getElementById("processing-link").href="/processing-checks"+(batch?"?batch="+encodeURIComponent(batch):"");}
new MutationObserver(syncChainLink).observe(chainAnchor,{attributes:true,attributeFilter:["href"]});syncChainLink();
