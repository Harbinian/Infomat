const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=String(text);if(cls)n.className=cls;return n;};
const initial=new URLSearchParams(location.search),date=v=>v?new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'未记录',num=v=>Number(v).toLocaleString('zh-CN');
const kinds={zero_required_no_issue:'BOM有正用量、应领为零且无出库',zero_required_zero_issue_record:'应领为零、存在零数量出库',nonpositive_issue_record:'材料出库净量非正',current_bom_material_not_allocated:'BOM子件未进入用料清单',no_allocation:'无生产用料清单',bom_basis_unavailable:'用料缺少可用BOM对照',positive_required_no_issue:'正应领物料无对应出库',issue_awaiting_audit:'已有出库、审核依据不足',issue_reference_conflict:'材料出库引用不一致',receipt_reference_conflict:'产品入库引用待核查',quantity_basis_unavailable:'数量依据不足',issue_net_shortfall:'已审核净出库小于应领'};
const state={review:initial.get('review')||'',batch:initial.get('batch')||'',category:initial.get('category')||'all',salesOrder:initial.get('salesOrder')||'',productionOrder:initial.get('productionOrder')||'',material:initial.get('material')||'',page:1,pageSize:50,meta:null};
let seq=0,detailSeq=0,controller,focus,loaded=false;
const fields={category:'category',salesOrder:'sales-order',productionOrder:'production-order',material:'material'};
const sourceNames={'u8-bom-history':'BOM历史','u8-component-history':'BOM子件历史','u8-order-bom':'订单BOM关联','u8-ecn-details':'工程变更明细','u8-ecn-bom':'变更BOM','u8-ecn-components':'变更子件','u8-ecn-notes':'变更通知','u8-ecn':'工程变更单','u8-bom-log':'相关操作日志'};
function businessText(value,key){let text=String(value);for(const [code,label] of Object.entries(sourceNames))text=text.replaceAll(code,label);if(/日期|时间/.test(key))text=text.replace(/(\d{4}-\d{2}-\d{2})T00:00:00(?:\.0+)?/g,'$1').replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.\d+)?/g,'$1 $2');return text;}
for(const [key,label] of Object.entries(kinds)){const o=el('option',label);o.value=key;$('category').append(o);}
function params(){return new URLSearchParams({review:state.review,category:state.category,salesOrder:state.salesOrder,productionOrder:state.productionOrder,material:state.material,page:state.page,pageSize:state.pageSize});}
function dirty(){return Object.entries(fields).some(([k,id])=>$(id).value!==state[k]);}
async function json(url,signal){const r=await fetch(url,{signal}),d=await r.json();if(!r.ok)throw new Error(d.error||'读取失败');return d;}
function close(){detailSeq++;$('detail-overlay').hidden=true;if(focus?.isConnected)focus.focus();focus=null;}
function clear(message){state.meta=null;$('metrics').hidden=true;$('rows').replaceChildren();const tr=el('tr'),td=el('td',message,'checks-empty');td.colSpan=9;tr.append(td);$('rows').append(tr);$('result-count').textContent=message;$('page-label').textContent='';$('prev').disabled=$('next').disabled=true;$('export').setAttribute('aria-disabled','true');$('export').removeAttribute('href');close();}
function navigate(){const b=encodeURIComponent(state.batch);$('ledger-link').href='/?batch='+b;$('statistics-link').href='/statistics?batch='+b;$('quantity-link').href='/quantity-review?batch='+b;$('checks-link').href='/order-checks?batch='+b;history.replaceState(null,'','/material-checks?'+params());}
function block(title,v,keys){const section=el('section',undefined,'check-detail-block'),dl=el('dl',undefined,'detail-grid');section.append(el('h3',title));for(const k of keys)if(k in v)dl.append(el('dt',k),el('dd',v[k]===null||v[k]===undefined||v[k]===''?'未取得 / 不适用':businessText(v[k],k)));section.append(dl);return section;}
function clueList(title,items,describe){const section=el('section',undefined,'check-detail-block');section.append(el('h3',title));for(const r of items)section.append(el('p',describe(r),'material-clue'));if(!items.length)section.append(el('p','本次未取得对应线索；不证明历史上不存在。','material-summary'));return section;}
async function detail(id,button){
 const token=++detailSeq,review=state.review;focus=button;$('detail-overlay').hidden=false;$('detail-content').replaceChildren(el('p','正在读取已保存依据…'));$('detail-drawer').focus();
 try{const r=await json('/api/material-checks/detail?'+new URLSearchParams({review,id}));if(token!==detailSeq||review!==state.review)return;const v=r.values,e=r.evidence||{},content=$('detail-content');content.replaceChildren(el('p','业务判定：依据不足待核查。'+state.meta.boundary,'detail-boundary'));
  content.append(block('订单、入库及物料数量',v,['核查情形','销售订单','销售数量','生产订单','生产行号','订单类别','生产状态','产品编码','产品名称','生产数量','已审核入库数量','已审核入库单号','已审核入库日期','入库类别','物料编码','物料名称','物料单位','存货分类','订单应领数量','订单原应领数量','订单用料已领汇总','对应材料出库记录数','对应材料出库数量','对应材料出库单号','已审核材料出库净量','当前BOM按已审核入库计算数量']));
  content.append(block('已确认事实与仍缺少的依据',v,['数值及记录事实','业务判定','变更及必要性依据','订单采用BOM','BOM版本','BOM建立日期','BOM修改日期','订单审核日期','BOM及变更依据','供应类型','表外领料标志']));
  content.append(block('继续追查结果',v,['追查分类','旧保留表证据','历史记录限制','当前同产品BOM','同产品BOM建立日期','当前BOM建立日期','保留表数量','保留表中审核日期','后建BOM线索','直接下级生产明细数','同销售明细其他领料单','相关领料所属生产明细','跨明细领料判断','其他出库线索','其他出库限制','关联历史或替代线索数','结论限制','证据限制']));
  content.append(clueList('其他生产明细的领料依据',e.otherDetailIssues||e.crossDetailClues||[],r=>r.IssueCode?`领料单 ${r.IssueCode}；所属生产单 ${r.VerifiedProductionCode} / ${r.SortSeq}；本条数量 ${r.iQuantity}，本行应领 ${r.RequiredQty}，本行出库净量 ${r.OwnAllocationNetIssueQty}。无明确调剂依据，不自动抵扣。`:`领料单 ${r['领料单号']}；所属生产单 ${r['领料所属生产订单']} / ${r['领料所属生产行号']}；出库 ${r['领料数量']}，所属明细应领 ${r['领料所属明细应领数量']}。${r['结论']}`));
  const link=el('a','查看该订单的数量与勤哲逐单复核');link.href='/order-checks?'+new URLSearchParams({batch:state.batch,salesOrder:r.salesOrder,productionOrder:r.productionOrder});content.append(link,el('p','完整原值、技术引用和读取来源保留在下载明细中；补充复核的读取时间与原盘点分开保存。','drawer-note'));
 }catch(e){if(token===detailSeq&&review===state.review)$('detail-content').replaceChildren(el('p',e.message,'notice error'));}
}
async function load(){
 const token=++seq;controller?.abort();controller=new AbortController();clear('正在读取所选复核…');$('load-error').hidden=$('unavailable').hidden=true;$('review-origin').textContent='';$('read-window').textContent='正在读取保存的复核结果…';
 try{
  if(!loaded){const [reviews,batches]=await Promise.all([json('/api/material-checks/reviews',controller.signal),json('/api/batches',controller.signal)]);if(token!==seq)return;$('review-select').replaceChildren();
   for(const r of reviews.reviews){const option=el('option',`${date(r.createdAt)} · ${r.provenance.kind==='preserved_review'?'已保存的补充复核':'全量盘点复核'}`);option.value=r.reviewId;option.dataset.batch=r.batchId;$('review-select').append(option);}
   for(const b of batches.batches)if(!reviews.reviews.some(r=>r.batchId===b.id&&r.provenance.kind==='full_inventory')){const option=el('option',`${date(b.startedAt)} · ${b.status==='succeeded'?'未采集入库领料核查':b.status==='running'?'盘点中，尚无结果':'失败，无有效结果'}`);option.value='batch:'+b.id;option.dataset.batch=b.id;$('review-select').append(option);}
   if(!state.review)state.review=state.batch?(reviews.reviews.find(r=>r.batchId===state.batch&&r.provenance.kind==='full_inventory')?.reviewId||'batch:'+state.batch):(reviews.reviews[0]?.reviewId||$('review-select').options[0]?.value||'');
   if(![...$('review-select').options].some(o=>o.value===state.review))throw new Error('所选复核记录不存在');$('review-select').disabled=false;loaded=true;
  }
  $('review-select').value=state.review;state.batch=$('review-select').selectedOptions[0]?.dataset.batch||state.batch;navigate();
  if(state.review.startsWith('batch:')){clear('该盘点尚无有效入库领料核查结果，未用当前资料补算。');$('unavailable').textContent='可选择已保存的补充复核，或在首页开始新的全量盘点。';$('unavailable').hidden=false;$('read-window').textContent='未采集不等于零差异。';return;}
  const report=await json('/api/material-checks/review?review='+encodeURIComponent(state.review),controller.signal);if(token!==seq)return;state.meta=report;
  const start=report.provenance.readStart||report.sourceManifest.map(r=>r.startedAt).filter(Boolean).sort()[0],end=report.provenance.readEnd||report.sourceManifest.map(r=>r.finishedAt).filter(Boolean).sort().at(-1);
  $('read-window').textContent=`资料读取：${date(start)} 至 ${date(end)}（北京时间）`;$('review-origin').textContent=report.provenance.kind==='preserved_review'?'已保存的补充复核；保留两次探查时间及原始依据，原盘点未改写。':'本次全量盘点共同只读复核并保存。';
  for(const o of $('category').options)if(o.value!=='all')o.textContent=(kinds[o.value]||o.value)+'（'+num(report.categories[o.value]||0)+'）';
  const data=await json('/api/material-checks?'+params(),controller.signal);if(token!==seq)return;
  $('pending-count').textContent=num(report.summary.pending);$('production-count').textContent=num(report.summary.productionOrders);$('sales-count').textContent=num(report.summary.salesOrders);$('metrics').hidden=false;$('rows').replaceChildren();
  for(const r of data.rows){const v=r.values,tr=el('tr'),fact=el('td',r.categoryLabel);fact.append(el('small','业务判定：依据不足待核查'));const p=el('td',r.productionOrder||'未取得');p.append(el('small','第 '+(v['生产行号']||'未知')+' 行'));const mat=el('td',r.materialCode||'必要物料尚未确定');mat.append(el('small',[v['物料名称'],v['物料单位']].filter(Boolean).join(' / ')));tr.append(fact,el('td',r.salesOrder||'未取得'),p,mat);
   for(const k of ['已审核入库数量','订单应领数量','对应材料出库数量','当前BOM按已审核入库计算数量'])tr.append(el('td',v[k]===null||v[k]===undefined||v[k]===''?'—':v[k],'number'));
   const a=el('td'),button=el('button','查看','detail-button');button.type='button';button.addEventListener('click',()=>detail(r.id,button));a.append(button);tr.append(a);$('rows').append(tr);}
  if(!data.rows.length){const tr=el('tr'),td=el('td','当前筛选没有核查项；不代表历史业务已通过核查。','checks-empty');td.colSpan=9;tr.append(td);$('rows').append(tr);}
  $('result-count').textContent=`筛选结果 ${num(data.total)} 项；已应用条件同时生效。`+(dirty()?' 条件已修改，点击“筛选”后生效。':'');$('page-label').textContent=`第 ${state.page} / ${Math.max(1,Math.ceil(data.total/state.pageSize))} 页`;$('prev').disabled=state.page<=1;$('next').disabled=state.page*state.pageSize>=data.total;$('export').href='/api/material-checks/export?'+params();$('export').setAttribute('aria-disabled',String(dirty()));navigate();
 }catch(e){if(e.name==='AbortError'||token!==seq)return;clear('未取得结果，请重试。');$('read-window').textContent='读取失败，未展示上次结果。';$('load-error').textContent=e.message;$('load-error').hidden=false;}
}
for(const [k,id] of Object.entries(fields)){$(id).value=state[k];$(id).addEventListener('input',()=>{$('export').setAttribute('aria-disabled','true');$('result-count').textContent='筛选条件已修改，点击“筛选”后生效。';});}
$('filters').addEventListener('submit',e=>{e.preventDefault();for(const [k,id] of Object.entries(fields))state[k]=$(id).value;state.page=1;load();});
$('clear').addEventListener('click',()=>{for(const [k,id] of Object.entries(fields))$(id).value=k==='category'?'all':'';$('filters').requestSubmit();});
$('review-select').addEventListener('change',()=>{state.review=$('review-select').value;state.page=1;load();});$('retry').addEventListener('click',()=>{loaded=false;load();});
$('prev').addEventListener('click',()=>{state.page--;load();});$('next').addEventListener('click',()=>{state.page++;load();});$('export').addEventListener('click',e=>{if($('export').getAttribute('aria-disabled')==='true')e.preventDefault();});
$('close-detail').addEventListener('click',close);$('detail-overlay').addEventListener('click',e=>{if(e.target===$('detail-overlay'))close();});document.addEventListener('keydown',e=>{if($('detail-overlay').hidden)return;if(e.key==='Escape')close();if(e.key==='Tab'){const nodes=[...$('detail-drawer').querySelectorAll('button,a[href]')];if(!nodes.length)return;const i=nodes.indexOf(document.activeElement);e.preventDefault();nodes[(i+(e.shiftKey?-1:1)+nodes.length)%nodes.length].focus();}});
await load();

const chainLink=document.getElementById("chain-link"),chainAnchor=document.getElementById("checks-link")||document.getElementById("quantity-link");
function syncChainLink(){const batch=new URL(chainAnchor.href).searchParams.get("batch");chainLink.href="/chain-checks"+(batch?"?batch="+encodeURIComponent(batch):"");document.getElementById("processing-link").href="/processing-checks"+(batch?"?batch="+encodeURIComponent(batch):"");}
new MutationObserver(syncChainLink).observe(chainAnchor,{attributes:true,attributeFilter:["href"]});syncChainLink();
