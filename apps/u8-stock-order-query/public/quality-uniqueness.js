const element = id => document.getElementById(id);
const state = {page:1,pageSize:20,total:0,filters:new URLSearchParams(),controller:null,busy:false,rows:[],meta:null};
const detail = {page:1,total:0,row:null,controller:null};
const statusLabels = {duplicate:'重复',unique:'未发现重复',pending:'缺失待核查'};
const display = value => value === null || value === undefined || value === '' ? '未提供' : String(value);
function node(tag,text,className) {const value=document.createElement(tag);if(text!==undefined)value.textContent=display(text);if(className)value.className=className;return value;}
async function api(url,signal) {const response=await fetch(url,{signal,cache:'no-store'});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||'核查暂不可用，请重试。');return result;}
function busy(value) {
  state.busy=value;
  for(const control of element('qualityForm').elements)control.disabled=value;
  element('qualityPageSize').disabled=value;
  element('qualityPrevious').disabled=value||state.page<=1;
  element('qualityNext').disabled=value||state.page*state.pageSize>=state.total;
}
function renderRows() {
  const fragment=document.createDocumentFragment();
  for(const row of state.rows) {
    const tr=node('tr',undefined,'data-row');tr.tabIndex=0;
    for(const key of ['ProductDrawing','QualityNumber','UnitCount','SourceDetailCount','SalesOrderCount']) {const td=node('td');td.append(node('span',row[key],key==='ProductDrawing'||key==='QualityNumber'?'cell-main code':'cell-main'));tr.append(td);}
    const td=node('td');td.append(node('span',statusLabels[row.CheckStatus],`quality-status ${row.CheckStatus}`));tr.append(td);
    tr.addEventListener('click',()=>openDetails(row));tr.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();openDetails(row);}});fragment.append(tr);
  }
  element('qualityBody').replaceChildren(fragment);element('qualityEmpty').hidden=state.rows.length!==0;
  const pages=Math.max(1,Math.ceil(state.total/state.pageSize));element('qualityPages').textContent=`${state.page} / ${pages}`;
  element('qualityRange').textContent=state.total?`显示 ${(state.page-1)*state.pageSize+1}–${Math.min(state.page*state.pageSize,state.total)} 条`:'共 0 条';
  element('qualitySummary').textContent=`共 ${state.total} 个组合`;
}
async function query() {
  state.controller?.abort();const controller=new AbortController();state.controller=controller;busy(true);element('qualityError').hidden=true;
  const params=new URLSearchParams(state.filters);params.set('page',state.page);params.set('pageSize',state.pageSize);
  try {
    const result=await api(`/api/quality-uniqueness?${params}`,controller.signal);
    if(state.controller!==controller)return;
    state.rows=result.rows;state.total=result.totals.total;state.meta=result.meta;
    if(state.page>Math.max(1,Math.ceil(state.total/state.pageSize))){state.page=Math.max(1,Math.ceil(state.total/state.pageSize));return query();}
    element('qualityRule').textContent=result.meta.ruleDescription;element('qualityUnitLabel').textContent=result.meta.unitLabel;
    for(const [id,key] of [['qualityTotal','total'],['qualityDuplicates','duplicates'],['qualityUnique','unique'],['qualityPending','pending']])element(id).textContent=result.totals[key];
    element('qualityConnection').textContent='账套 333 · 只读核查 · 已连接';element('qualityDot').className='dot ready';
    element('qualityCheckedAt').textContent=`核查于 ${result.checkedAtUtc8} 北京时间`;renderRows();
  } catch(error) {
    if(error.name!=='AbortError'&&state.controller===controller) {
      state.rows=[];state.total=0;element('qualityBody').replaceChildren();element('qualityEmpty').hidden=true;
      for(const id of ['qualityTotal','qualityDuplicates','qualityUnique','qualityPending'])element(id).textContent='—';
      element('qualityConnection').textContent='本次核查未完成';element('qualityDot').className='dot failed';element('qualitySummary').textContent='本次未返回结果';
      element('qualityCheckedAt').textContent='';element('qualityRange').textContent='';element('qualityPages').textContent='—';
      element('qualityError').textContent=error.message;element('qualityError').hidden=false;
      if(!state.meta)element('qualityRule').textContent='本次未能取得核查口径，请重新核查。';
    }
  } finally {if(state.controller===controller)busy(false);}
}
function renderHelp() {
  const content=element('qualityHelpContent');content.replaceChildren();
  content.append(node('h3','核查范围与判定'),node('p',state.meta?.ruleDescription||'核查口径尚未取得，请完成一次成功查询后查看。'));
  for(const item of state.meta?.fields||[])content.append(node('h3',item.label),node('p',item.comment));
  content.append(node('h3','操作方法'),node('p','输入图号、质量编号后点击“核查”。筛选按字面包含匹配，多个条件同时满足。组合先在完整核查范围内判定，再应用筛选与分页；筛选不会把重复组合改为未发现重复。点击组合或按回车查看关联源头明细。'),node('h3','结果边界'),node('p','重复结果用于核实编号使用情况，不自动修改源头编号。空号单列为缺失待核查。查询失败时本次结果清空并保留输入，不将零条结果视为核查通过。页面不保存查询输入，刷新会恢复默认条件。'));
  element('qualityHelpDialog').showModal();
}
async function openDetails(row) {detail.row=row;detail.page=1;element('qualityDetailDialog').showModal();await queryDetails();}
async function queryDetails() {
  detail.controller?.abort();const controller=new AbortController();detail.controller=controller;element('qualityDetailError').hidden=true;element('qualityDetailRows').replaceChildren();
  element('qualityDetailTitle').textContent=`${display(detail.row.ProductDrawing)} · ${display(detail.row.QualityNumber)}`;
  element('qualityDetailSummary').textContent='正在读取关联源头明细…';element('qualityDetailPrevious').disabled=true;element('qualityDetailNext').disabled=true;
  const params=new URLSearchParams({drawing:detail.row.ProductDrawing||'',qualityNumber:detail.row.QualityNumber||'',page:String(detail.page),pageSize:'50'});
  try {
    const result=await api(`/api/quality-uniqueness/details?${params}`,controller.signal);detail.total=result.total;
    if(detail.controller!==controller||!element('qualityDetailDialog').open)return;
    element('qualityDetailSummary').textContent=`本组合共 ${result.total} 条源头明细；本页保留编号原值，重复判定按主表所示核查口径。`;
    const fragment=document.createDocumentFragment();
    for(const row of result.rows) {
      const article=node('article',undefined,'quality-source');article.append(node('h3',`销售订单 ${display(row.SalesOrderCode)} · 明细 ${display(row.SalesDetailID)}`));const dl=node('dl');
      for(const field of result.fields){const label=node('dt',field.label);label.title=field.comment||'';dl.append(label,node('dd',row[field.key]));}article.append(dl);fragment.append(article);
    }
    element('qualityDetailRows').replaceChildren(fragment);element('qualityDetailPages').textContent=`${detail.page} / ${Math.max(1,Math.ceil(result.total/50))}`;
    element('qualityDetailPrevious').disabled=detail.page<=1;element('qualityDetailNext').disabled=detail.page*50>=result.total;
  } catch(error) {if(error.name!=='AbortError'&&detail.controller===controller&&element('qualityDetailDialog').open){element('qualityDetailSummary').textContent='本次源头明细查询未完成';element('qualityDetailPages').textContent='—';element('qualityDetailError').textContent=error.message;element('qualityDetailError').hidden=false;}}
}
element('qualityForm').addEventListener('submit',event=>{event.preventDefault();state.filters=new URLSearchParams(new FormData(event.currentTarget));state.page=1;void query();});
element('qualityReset').addEventListener('click',()=>{element('qualityForm').reset();state.filters=new URLSearchParams(new FormData(element('qualityForm')));state.page=1;void query();});
element('qualityPageSize').addEventListener('change',event=>{state.pageSize=Number(event.target.value);state.page=1;void query();});
element('qualityPrevious').addEventListener('click',()=>{if(state.page>1){state.page--;void query();}});element('qualityNext').addEventListener('click',()=>{if(state.page*state.pageSize<state.total){state.page++;void query();}});
element('qualityHelp').addEventListener('click',renderHelp);
for(const id of ['qualityHelpDialog','qualityDetailDialog'])element(id).querySelector('.dialog-header button').addEventListener('click',()=>element(id).close());
element('qualityDetailDialog').addEventListener('close',()=>detail.controller?.abort());
element('qualityDetailPrevious').addEventListener('click',()=>{if(detail.page>1){detail.page--;void queryDetails();}});element('qualityDetailNext').addEventListener('click',()=>{if(detail.page*50<detail.total){detail.page++;void queryDetails();}});
state.filters=new URLSearchParams(new FormData(element('qualityForm')));void query();
