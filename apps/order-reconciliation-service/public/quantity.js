const $=id=>document.getElementById(id);
const number=value=>Number(value||0).toLocaleString('zh-CN');
const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=String(text);if(className)node.className=className;return node;};
let report=null,request=0,batches=[],selected=new URLSearchParams(location.search).get('batch')||'',controller=null;
const date=value=>new Date(value).toLocaleString('zh-CN',{hour12:false,timeZone:'Asia/Shanghai'});
const batchLabel=batch=>`${date(batch.startedAt)} · ${{succeeded:'已完成',running:'盘点中',failed:'失败'}[batch.status]||batch.status}${batch.quantityStatus==='available'?' · 含数量核查':''}`;
const traceOnly=new Set(['销售明细编号','生产明细编号','用料明细编号','BOM子件行编号','子件物料编号','用友生产明细编号','计算路径','理论用量分数','需求数量分数','记录编号','明细编号','勤哲记录编号','订单采用BOM编号','记录更新计数（不代表业务变更次数）','原始资料（追溯用）','来源记录编号','关联BOM编号']);
const count=(key,state)=>report.counts[key]?.[state]||0;
function samples(){
 const key=$('sample-kind').value,rows=report.examples[key]||[];
 $('sample-note').textContent=`本项目展示 ${rows.length} 条已保留样例；全部 ${number(report.files[key].rows)} 条请下载完整明细。样例顺序不表示风险排序。`;
 $('sample-list').replaceChildren();
 for(const row of rows){const article=element('article',undefined,'sample-card'),list=element('dl');for(const [label,value] of Object.entries(row)){if(traceOnly.has(label))continue;const item=element('div');if(['说明','限制','更改描述','核查结论','核查结果'].includes(label))item.className='wide';item.append(element('dt',label),element('dd',value===null||value===''?'未填写':value));list.append(item);}article.append(list);$('sample-list').append(article);}
 if(!rows.length)$('sample-list').append(element('p','本项目没有保留差异样例；请结合完整明细及核查限制判断。'));
}
function render(){
 const s=report.summary;
 const dates=report.reads.map(r=>[r.startedAt,r.finishedAt]).flat().filter(Boolean).sort();
 $('read-window').textContent=`资料读取：${date(dates[0])} 至 ${date(dates.at(-1))}（北京时间）；${selected==='legacy'?'这是原独立核查历史报告，不属于任何盘点记录。':'这是所选盘点记录保存的数量核查结果。'}`;
 $('basis').textContent=report.basis;
 $('quantity-metrics').replaceChildren();
 for(const [title,value,note] of [
  ['销售与同物料生产数值不同',count('sales','数值不同'),'销售明细；分批范围待核实'],
  ['勤哲记录存在数值差异',count('mes','存在数值差异'),'已关联记录；重复记录逐条保留'],
  ['BOM 子件需求与生产数值不同',count('demand','数值不同'),'当前结构计算；历史适用性待核查'],
  ['BOM 修改晚于订单审核',s.bomChangedAfterOrder,'生产明细；不能用当前版本直接判错']
 ]){const card=element('article',undefined,'quantity-metric');card.append(element('span',title),element('strong',number(value)),element('small',note));$('quantity-metrics').append(card);}
 const facts={
  sales:`${number(count('sales','数值相同'))} 条数值相同，${number(count('sales','数值不同'))} 条不同，${number(count('sales','未取得同物料生产明细'))} 条未取得同物料生产明细。`,
  mes:`读取 ${number(s.mesRead)} 条，关联 ${number(s.mesLinked)} 条；${number(count('mes','存在数值差异'))} 条存在数值差异，${number(s.mesRepeatedProduction)} 条用友生产明细对应多条勤哲记录，未累加重复记录。`,
  bom:`检查 ${number(s.bomHeaders)} 份 BOM；${number(s.bomParentsWithMultipleVersions)} 个物料保留多版本。${number(s.bomMissing)} 条订单未取得所引用的 BOM；变更适用依据不足的继续待核查。`,
  allocation:`${number(count('allocation','数值不同'))} 条应领数量与订单保留用量的计算值不同，${number(count('allocation','精度或取整待核查'))} 条需核实精度或取整；${number(count('allocation_current','当前BOM找不到原子件行'))} 条在当前 BOM 中找不到原子件行。`,
  demand:`${number(count('demand','数值不同'))} 项与用友生产数量不同；${number(count('demand_mes','数值不同'))} 项与可唯一关联且单位名称相同的勤哲投产数量不同。未取得生产明细的材料不直接判缺件。`,
  changes:`找到 ${number(s.outlineChangeCandidates)} 条大纲更改线索，其中 ${number(s.outlineQuantityMentions)} 条提及数量或用量；尚未确认其对应 BOM 和订单适用范围。`,
  scope:'逐条保留未进入数量合计的勤哲记录，以及母件数量分配或BOM展开依据不足的销售明细；未关联不直接判漏传、缺件或漏单。',
  history:`本次保留 ${number(s.historyRecords)} 条 BOM 历史、工程变更、订单关联或相关日志，以及 ${number(s.substituteRecords)} 条替代子件。适用范围未明确的单列待核查；没有记录不代表未发生变更。`
 };
 $('review-rows').replaceChildren();$('sample-kind').replaceChildren();
 for(const [key,file] of Object.entries(report.files)){const row=element('tr'),link=element('a','下载 CSV');link.href=`/api/quantity-review/export?kind=${key}&batch=${encodeURIComponent(selected)}`;const cell=element('td');cell.append(link);row.append(element('td',file.label),element('td',facts[key]),element('td',number(file.rows)),cell);$('review-rows').append(row);const option=element('option',file.label);option.value=key;$('sample-kind').append(option);}
 $('scope').textContent=report.scope;$('limitations').replaceChildren(...report.limitations.map(text=>element('li',text)));
 $('coverage').textContent=`范围：${number(s.sales)} 条销售明细、${number(s.production)} 条生产明细、${number(s.orderAllocations)} 条生产用料明细。数值差异、变更线索和待核查记录可能重叠，不能相加为错单总数。`;
 samples();$('review-content').hidden=false;
}
async function load(){
 const current=++request;controller?.abort();controller=new AbortController();report=null;
 $('review-content').hidden=true;$('load-error').hidden=true;$('retry').disabled=true;$('read-window').textContent='正在读取核查记录…';
 const suffix=selected&&selected!=='legacy'?`?batch=${encodeURIComponent(selected)}`:'';
 $('ledger-link').href='/'+suffix;$('statistics-link').href='/statistics'+suffix;
 $('checks-link').href='/order-checks'+(selected==='legacy'?'':suffix);
 $('materials-link').href='/material-checks'+(selected==='legacy'?'':suffix);
 history.replaceState(null,'','/quantity-review?batch='+encodeURIComponent(selected));
 $('selection-note').textContent=selected==='legacy'?'原独立报告保留；没有补写到历史盘点。':'从订单核对明细“开始全量盘点”，每次一起只读重查。';
 try{
  const response=await fetch('/api/quantity-review?batch='+encodeURIComponent(selected),{signal:controller.signal});const value=await response.json();if(current!==request)return;
  if(!response.ok)throw new Error(value.error||'读取失败');
  if(value.status==='not-collected'){$('read-window').textContent=value.message;return;}
  if(![1,2].includes(value.version)||!value.files||!value.summary||(selected!=='legacy'&&value.batchId!==selected))throw new Error('数量核查资料与所选盘点不一致');
  report=value;render();
 }catch(error){if(current!==request||error.name==='AbortError')return;$('read-window').textContent='本次未能取得有效结果';$('load-error').textContent=error.message;$('load-error').hidden=false;}
 finally{if(current===request)$('retry').disabled=false;}
}
async function refresh(){
 const current=++request;controller?.abort();$('review-content').hidden=true;$('load-error').hidden=true;$('retry').disabled=true;
 try{const response=await fetch('/api/batches');if(!response.ok)throw new Error('盘点记录读取失败');const data=await response.json();if(current!==request)return;batches=data.batches||[];
  if(!selected)selected=batches.find(b=>b.status==='succeeded')?.id||'legacy';
  const select=$('batch-select');select.replaceChildren();for(const batch of batches){const option=element('option',batchLabel(batch));option.value=batch.id;select.append(option);}
  const legacy=element('option','2026/11/05 · 原独立核查历史报告');legacy.value='legacy';select.append(legacy);
  if(selected!=='legacy'&&!batches.some(b=>b.id===selected)){const absent=element('option','所选盘点不存在');absent.value=selected;select.append(absent);}
  select.value=selected;await load();
 }catch(error){if(current!==request)return;$('load-error').textContent=error.message;$('load-error').hidden=false;$('retry').disabled=false;}
}
$('retry').addEventListener('click',refresh);$('sample-kind').addEventListener('change',samples);$('batch-select').addEventListener('change',event=>{selected=event.target.value;load();});refresh();

const chainLink=document.getElementById("chain-link"),chainAnchor=document.getElementById("checks-link")||document.getElementById("quantity-link");
function syncChainLink(){const batch=new URL(chainAnchor.href).searchParams.get("batch");chainLink.href="/chain-checks"+(batch?"?batch="+encodeURIComponent(batch):"");document.getElementById("processing-link").href="/processing-checks"+(batch?"?batch="+encodeURIComponent(batch):"");}
new MutationObserver(syncChainLink).observe(chainAnchor,{attributes:true,attributeFilter:["href"]});syncChainLink();
