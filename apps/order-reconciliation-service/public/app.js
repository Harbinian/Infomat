import {sourceName, formName, fieldName, fieldValue, issueName, issueValues, businessText, batchState, batchFailure} from './business-terms.js';

const $ = id => document.getElementById(id);
const state = { batches: [], selected: '', kind: 'all', query: '', page: 1, pageSize: 50, total: 0, rows: [], active: false, loading: false, requestId: 0, starting: false, detailTrigger: null, detailRequestId: 0 };
const labels = {productionNumber:'生产编号',salesOrder:'销售订单号',productionOrder:'生产订单号',qualitySales:'销售质量编号',qualityProduction:'生产质量编号',qualityMes:'勤哲质量编号原值',inventoryCode:'存货编码'};
const formatNumber = value => value === null || value === undefined ? '—' : Number(value).toLocaleString('zh-CN');
const raw = value => value === null ? '未填写（空值）' : value === undefined ? '未采集' : value === '' ? '未填写（空文本）' : Array.isArray(value) ? value.map(raw).join('；') : typeof value === 'object' ? '详见导出原始资料' : String(value);
const time = value => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date); };
const shortTime = value => { if (!value) return '—'; const date = new Date(value); return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).format(date); };
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text); if (className) node.className = className; return node; }
function selectedBatch() { return state.batches.find(batch => batch.id === state.selected); }
function setError(message) { $('error-message').textContent = message || ''; $('error-message').hidden = !message; }
function setNotice(message) { $('global-status').textContent = message || ''; $('global-status').hidden = !message; }
async function api(path, options) { const response = await fetch(path, { cache:'no-store', ...options }).catch(()=>{throw new Error('暂时无法连接订单核对工具，请稍后重试。');}); let body; try { body = await response.json(); } catch { throw new Error('未能读取查询结果，请重试。'); } if (!response.ok || body.ok === false) throw new Error(typeof body.error === 'string' ? body.error : body.error?.message || body.message || `请求失败（${response.status}）`); return body; }
function renderBatches() {
  const select = $('batch-select'); select.replaceChildren();
  if (!state.batches.length) select.append(element('option', '尚无盘点记录'));
  for (const batch of state.batches) { const option = element('option', `${time(batch.startedAt)} · ${batchState(batch.status)}`); option.value = batch.id; select.append(option); }
  select.value = state.selected;
  const batch = selectedBatch(); const status = $('batch-status');
  $('statistics-link').href = state.selected ? `/statistics?batch=${encodeURIComponent(state.selected)}` : '/statistics';
  $('quantity-link').href = state.selected ? `/quantity-review?batch=${encodeURIComponent(state.selected)}` : '/quantity-review';
  $('checks-link').href = state.selected ? `/order-checks?batch=${encodeURIComponent(state.selected)}` : '/order-checks';
  $('materials-link').href = state.selected ? `/material-checks?batch=${encodeURIComponent(state.selected)}` : '/material-checks';
  status.textContent = batch ? batchState(batch.status) : '尚未开始';
  status.className = `badge ${batch ? ({running:'running',succeeded:'success',failed:'failed'})[batch.status] || 'neutral' : 'neutral'}`;
  $('batch-time').textContent = batch ? `${time(batch.startedAt)}${batch.finishedAt ? ` → ${time(batch.finishedAt)}` : ''}（北京时间）` : '手动发起，完整读取后发布本次盘点结果';
  state.active = state.batches.some(item => item.status === 'running');
  $('start-batch').disabled = state.active || state.starting;
  $('start-batch').textContent = state.starting ? '正在启动…' : state.active ? '全量盘点执行中…' : '开始全量盘点';
  $('export-button').disabled = batch?.status !== 'succeeded';
  $('coverage-button').disabled = batch?.status !== 'succeeded';
  for (const key of ['sales','production','interface','mes','findings','unmatched']) $('count-' + key).textContent = batch?.status === 'succeeded' ? formatNumber(batch.summary?.[key]) : '—';
  const reads = $('source-reads'); reads.replaceChildren();
  if (batch?.status === 'succeeded' && batch.sourceReads?.length) {
    const groups = new Map();
    for (const read of batch.sourceReads) { const group = groups.get(read.source) || {source:read.source,count:0,objects:0,startedAt:read.startedAt,finishedAt:read.finishedAt}; group.count += Number(read.count || 0); group.objects++; if (new Date(read.startedAt) < new Date(group.startedAt)) group.startedAt = read.startedAt; if (new Date(read.finishedAt) > new Date(group.finishedAt)) group.finishedAt = read.finishedAt; groups.set(read.source,group); }
    for (const read of groups.values()) reads.append(element('span', `${sourceName(read.source)} · ${read.objects} 类资料 / ${formatNumber(read.count)} 条 · ${shortTime(read.startedAt)}—${shortTime(read.finishedAt)}`, 'source-read'));
  }
  else reads.textContent = batch?.status === 'failed' ? '本次盘点失败，未发布有效业务结果。' : batch?.status === 'running' ? '正在读取并核对，全部成功后展示来源记录。' : '尚无完整读取记录。';
  if (batch?.status === 'failed') setNotice('本次盘点失败，没有有效业务盘点结果。请选择已完成的盘点记录查看以往证据，或重新发起盘点。');
  else if (batch?.status === 'running') setNotice('本次盘点正在执行。三套系统全部必需资料读取、逐项核查、全域统计及依据保存成功后，才展示本次盘点结果。');
  else if (state.active) setNotice('另有盘点正在执行。当前展示的是所选历史盘点记录，结果不会随原单据变化自动更新。');
  else if (batch) setNotice('当前展示所选盘点记录保存的数据；如需核对原单据最新状态，请手动发起新的盘点。');
  else setNotice('首次盘点会完整读取已确认范围。原单据内容中的空值、编号冲突等会作为问题保留，不会自动补填。');
  if (batch?.status === 'failed') setError(`本次盘点失败：${batchFailure}`);
}
function emptyTable(title, message) { const cell = element('td', undefined, 'empty-state'); cell.colSpan = 9; cell.append(element('strong', title), element('span', message)); const row = element('tr'); row.append(cell); $('records-body').replaceChildren(row); state.rows = []; state.total = 0; renderPagination(); }
function qualityText(record) {
  const values=[...new Set((record.evidence||[]).filter(item=>item.source==='mes'&&['dbo.生产订单中间表新_明细','dbo.产品制造大纲流转卡_主表','dbo.工艺清单汇总_主表'].includes(item.object)).map(item=>(item.object.includes('流转卡')?item.values?.类别质量编号:item.values?.质量编号)??null))];
  return values.length>1&&record.qualityMes===`多值 ${JSON.stringify(values)}` ? `多项原填内容：${values.map(raw).join('；')}` : record.qualityMes;
}
function valueCell(value, subvalue, code = false) { const td = element('td'); td.append(element('div', value === null || value === undefined || value === '' ? '—' : raw(value), value === null || value === undefined || value === '' ? 'missing' : code ? 'record-code' : '')); if (subvalue !== undefined && subvalue !== null && subvalue !== '') td.append(element('div', `明细行 ${raw(subvalue)}`, 'subline')); return td; }
function renderRows(rows) {
  const body = $('records-body'); body.replaceChildren();
  for (const record of rows) {
    const tr = element('tr');
    tr.append(valueCell(record.productionNumber, undefined, true), valueCell(record.salesOrder, record.evidence?.find(item=>item.source==='u8'&&item.object==='dbo.SO_SODetails')?.values?.iRowNo), valueCell(record.productionOrder, record.evidence?.find(item=>item.source==='u8'&&item.object==='dbo.mom_orderdetail')?.values?.SortSeq), valueCell(record.inventoryCode), valueCell(record.qualitySales), valueCell(record.qualityProduction), valueCell(qualityText(record)));
    const issues = element('td');
    if (record.issues?.length) for (const issue of record.issues.slice(0, 3)) issues.append(element('span', issueName(issue), 'issue-label'));
    else issues.append(element('span', record.status === 'unmatched' ? '关联待核查' : '未发现本次核对范围内的问题', record.status === 'unmatched' ? 'issue-label' : ''));
    if (record.issues?.length > 3) issues.append(element('div', `另有 ${record.issues.length - 3} 项，查看详情`, 'subline'));
    const action = element('td'); const button = element('button', '查看', 'detail-button'); button.type = 'button'; button.setAttribute('aria-label', `查看${record.productionNumber || '未提供生产编号记录'}的详情`); button.addEventListener('click', () => showDetails(record, button)); action.append(button); tr.append(issues, action); body.append(tr);
  }
}
function renderPagination() { const pages = Math.max(1, Math.ceil(state.total / state.pageSize)); $('page-label').textContent = state.total ? `${state.page} / ${pages}` : '—'; $('previous-page').disabled = state.loading || state.page <= 1 || !state.total; $('next-page').disabled = state.loading || state.page >= pages || !state.total; $('result-summary').textContent = selectedBatch()?.status === 'succeeded' ? `共 ${formatNumber(state.total)} 条记录` : '等待有效盘点结果'; }
async function loadRecords() {
  const requestId = ++state.requestId; const batch = selectedBatch();
  if (!batch || batch.status !== 'succeeded') { emptyTable(batch?.status === 'failed' ? '本次盘点失败' : batch?.status === 'running' ? '正在完成全量盘点' : '从第一次全量盘点开始', batch?.status === 'failed' ? '没有发布部分业务结果，可重新盘点或选择已完成的盘点记录。' : batch?.status === 'running' ? '完整读取三套系统、保存原始数据并核对完成后展示结果。' : '完整读取三套系统后，查看订单关联、差异和原始资料。'); return; }
  state.loading = true; renderPagination(); $('result-summary').textContent = '正在加载…';
  const params = new URLSearchParams({ batch:state.selected,kind:state.kind,q:state.query,page:String(state.page),pageSize:String(state.pageSize) });
  try { const data = await api(`/api/records?${params}`); if (requestId !== state.requestId) return; state.rows = data.rows || []; state.total = data.total || 0; state.page = data.page || state.page; if (state.rows.length) renderRows(state.rows); else { const total = state.total; emptyTable('当前范围没有记录', state.query ? '可调整查询线索，或清空条件查看完整范围。' : state.kind === 'all' ? '本次盘点在当前范围内未取得业务记录，请检查范围与原单据资料。' : '本次盘点在当前分类下没有记录。'); state.total = total; } } catch (error) { if (requestId !== state.requestId) return; setError(error.message); emptyTable('结果未能加载', '本次查询失败，请保留当前线索并重试。'); } finally { if (requestId === state.requestId) { state.loading = false; renderPagination(); } }
}
async function refreshBatches({reload=false} = {}) {
  const prior = selectedBatch(); const previousStatus = prior?.status; const previousId = state.selected;
  const data = await api('/api/batches'); state.batches = data.batches || [];
  if (!state.selected) state.selected = new URLSearchParams(location.search).get('batch') || '';
  if (!state.batches.some(batch => batch.id === state.selected)) state.selected = state.batches.find(batch => batch.status === 'running')?.id || state.batches[0]?.id || '';
  renderBatches();
  if (reload || state.selected !== previousId || selectedBatch()?.status !== previousStatus) await loadRecords();
}
function addGrid(section, entries) { const grid = element('dl', undefined, 'detail-grid'); for (const [key, value] of entries) grid.append(element('dt', key), element('dd', raw(value), 'raw-value')); section.append(grid); }
function section(title) { const node = element('section', undefined, 'detail-section'); node.append(element('h3', title)); return node; }
function formDate(value){return value===null||value===undefined||value===''?raw(value):String(value).replace('T',' ');}
function personName(person){
 if(person.mappingStatus==='current-directory')return `${person.name}（账号 ${raw(person.rawValue)}；当前用户档案中的姓名）`;
 if(person.mappingStatus==='source-name')return `${raw(person.rawValue)}（单据原填姓名）`;
 if(person.mappingStatus==='missing')return `未登记：${raw(person.rawValue)}`;
 return `${raw(person.rawValue)}（${person.mappingStatus==='ambiguous'?'同一账号查到多个姓名':'尚未查到对应姓名'}）`;
}
async function loadDetailEvidence(record,container,batchId){
 const requestId=++state.detailRequestId;container.replaceChildren(element('p','正在读取人员线索与表单日期…','drawer-note'));
 try{
  const data=await api(`/api/record-detail?${new URLSearchParams({batch:batchId,id:record.id})}`);
  if(requestId!==state.detailRequestId||batchId!==state.selected||$('drawer-overlay').hidden)return;
  if(data.batchId!==batchId||data.recordId!==record.id||!Array.isArray(data.forms)||!Array.isArray(data.people))throw new Error('人员及表单证据与当前记录不一致。');
  container.replaceChildren();
  const people=section('人员线索及对应操作环节');people.id='people-evidence';
  people.append(element('p','以下为单据登记人员，不认定处理负责人或过错责任。生产订单审核人名称已按用友当前生产订单配置核实。','detail-boundary'));
  if(data.userLookup.status==='available')people.append(element('p',`账号姓名来自用友用户档案，查询时间 ${time(data.userLookup.capturedAt)}（北京时间）。当前姓名对应关系不证明历史操作时的人员归属；未按同名人员推定身份。`,'drawer-note'));
  else people.append(element('p','当前未取得用户档案中的姓名对应关系，账号原值仍保留。','drawer-note'));
  for(const person of data.people.filter(person=>person.mappingStatus!=='missing')){const card=element('article',undefined,'person-evidence');card.append(element('strong',`${sourceName(person.source)} · ${businessText(person.stage)}`),element('div',personName(person),'person-name'),element('p',`${formName(person.source,person.object)}\n${fieldName(person.source,person.object,person.dateField)||'相关日期'}：${formDate(person.dateValue)}`,'drawer-note'));people.append(card);}
  const missingPeople=data.people.filter(person=>person.mappingStatus==='missing');if(missingPeople.length)people.append(element('p',`尚未登记的人员：${missingPeople.map(person=>`${businessText(person.stage)}：${raw(person.rawValue)}`).join('；')}。完整原值仍见下方原单据资料。`,'drawer-note'));
  if(!data.people.length)people.append(element('p','本次盘点所选表单未采集人员信息，不能补造经办人。','drawer-note'));
  container.append(people);
  const timeline=section('按表单日期排列的差异点');timeline.id='form-timeline';
  timeline.append(element('p','按每张表单的日期从早到晚排列；同日不判定执行先后，日期未知单列。以下编号、质量编号和差异均为本次盘点读取时的原值，不代表在所列日期发生了修改。','detail-boundary'));
  let day;
  for(const form of data.forms){
   if(form.day!==day){day=form.day;timeline.append(element('h4',day?`${day} · 同日先后未判定`:'日期未知／本次盘点未采集','timeline-day'));}
   const card=element('article',undefined,'form-evidence');card.dataset.formId=form.id;
   card.append(element('strong',`${sourceName(form.source)} · ${formName(form.source,form.object)}`));
   card.append(element('p',`排列所用日期：${fieldName(form.source,form.object,form.anchorField||'')||'日期未采集'} · ${formDate(form.anchorValue)}`,'form-anchor'));
   if(form.note)card.append(element('p',businessText(form.note),'drawer-note'));
   for(const date of form.dates){card.append(element('p',`${businessText(date.stage)}（${formName(form.source,date.object)}）：${formDate(date.value)}${date.day?(date.precision==='day-unspecified-time'?'；原值未提供日内先后依据':'；按源值展示，未转换时区'):'；未取得有效日期'}`,'form-date'));}
   addGrid(card,form.fields.map(item=>[fieldName(form.source,form.object,item.field),fieldValue(item.field,item.value)]).filter(([label])=>label));
   if(form.issueIndexes.length){card.append(element('h5','相关差异（本次盘点结果）'));for(const index of form.issueIndexes){const issue=record.issues[index];if(!issue)continue;const problem=element('div',undefined,'timeline-issue');problem.append(element('strong',issueName(issue)),element('p',issueValues(issue).map(([label,value])=>`${label}：${raw(value)}`).join('\n')));card.append(problem);}}
   else card.append(element('p','本次已发现的问题尚未对应到此表单，不代表表单内容全部正确。','drawer-note'));
   card.append(element('p',`本次盘点读取：${time(form.readAt)}（北京时间）；不能据此确定差异发生时间。`,'drawer-note'));timeline.append(card);
  }
  if(data.unassignedIssueIndexes?.length)timeline.append(element('p',`另有 ${data.unassignedIssueIndexes.length} 项检查未能按现有证据定位到表单，见下方完整核对结果。`,'drawer-note'));
  container.append(timeline);
 }catch(error){if(requestId!==state.detailRequestId||batchId!==state.selected||$('drawer-overlay').hidden)return;container.replaceChildren(element('p',`人员及日期证据读取失败：${error.message} 下方原始记录仍为所选盘点记录证据。`,'drawer-note'));const retry=element('button','重试人员与日期证据','secondary');retry.type='button';retry.addEventListener('click',()=>loadDetailEvidence(record,container,batchId));container.append(retry);}
}
function showDetails(record, trigger) {
  state.detailTrigger = trigger; const content = $('detail-content'); content.replaceChildren(); $('detail-title').textContent = record.productionNumber || '生产编号未提供';
  $('detail-drawer').classList.add('evidence-wide');const enrichment=element('div');enrichment.id='related-evidence';content.append(enrichment);
  const identity = section('订单及编号'); addGrid(identity, Object.entries(labels).filter(([key]) => key !== 'status').map(([key, label]) => [label, key==='qualityMes'?qualityText(record):record[key]])); if (record.evidence?.some(item => item.object?.includes('流转卡'))) identity.append(element('p', '流转卡的“类别质量编号”仅展示原值，尚未确认它与销售质量编号是否表示同一业务内容，原填内容见下方单据资料。', 'drawer-note')); content.append(identity);
  const association = section('关联依据'); association.append(element('p', businessText(record.associationBasis), 'drawer-note')); association.append(element('p', '处理责任：待补充。当前结果提供证据，不自动认定过错责任。', 'drawer-note')); content.append(association);
  const problems = section('核对结果');
  if (record.issues?.length) for (const issue of record.issues) { const card = element('article', undefined, 'issue-card'); card.append(element('strong', issueName(issue))); if (issue.values !== undefined) addGrid(card,issueValues(issue)); if (issue.basis) card.append(element('p', `核对说明：${businessText(issue.basis)}`)); problems.append(card); } else problems.append(element('p', '未发现本次盘点已定义检查规则覆盖的问题；这不等于所有原单据内容均正确。', 'drawer-note'));
  content.append(problems);
  const evidence = section('各系统原单据内容');
  if (record.evidence?.length) for (const item of record.evidence) {
    const card = element('article', undefined, 'evidence-card');
    card.append(element('div', `${sourceName(item.source)} · ${formName(item.source,item.object)}\n查询时间：${time(item.readAt)}（北京时间）`, 'evidence-heading'));
    if(item.source==='u8'&&item.object==='dbo.SO_SODetails') card.append(element('p','单据日期、审核及主单关闭人员和日期来自销售主单；明细关闭人员和日期来自销售明细。','drawer-note'));
    if(item.source==='u8'&&item.object==='dbo.mom_orderdetail') card.append(element('p','生产订单号及创建日期来自生产主单；所列人员及其操作日期来自生产明细。','drawer-note'));
    const values=Object.entries(item.values||{}).map(([key,value])=>[fieldName(item.source,item.object,key),fieldValue(key,value)]).filter(([label])=>label);
    addGrid(card,values); evidence.append(card);
  } else evidence.append(element('p','本记录尚未提供可展示的单据内容，不能补造操作历史。','drawer-note'));
  evidence.append(element('p','未填写（空值）、未填写（空文本）和未采集分别保留。名称尚待核实的原始内容、系统留存编号和完整依据请通过首页“导出当前范围”查看。本次保存的数据不能单独证明具体操作人、精确修改时间或修改原因。','drawer-note')); content.append(evidence);
  $('drawer-overlay').hidden = false; $('detail-content').scrollTop = 0; $('detail-drawer').scrollTop = 0; $('detail-drawer').focus({preventScroll:true});
  loadDetailEvidence(record,enrichment,state.selected);
}
function showCoverage() {
  const batch = selectedBatch(); if (batch?.status !== 'succeeded') return;
  state.detailRequestId++;$('detail-drawer').classList.remove('evidence-wide');
  state.detailTrigger = $('coverage-button'); const content = $('detail-content'); content.replaceChildren(); $('detail-title').textContent = '查询及核对范围';
  const scope = section('当前范围'); scope.append(element('p', '查询数量包含尚未对应到订单的记录。“纳入订单核对”表示本次已将该记录与用友订单核对，其中可能有关联不一致，详见订单详情。其余记录仍保存在本次盘点资料中，不直接判为漏传或错误。', 'drawer-note')); content.append(scope);
  const coverage = section('各类单据查询及核对数量');
  if (batch.coverage?.length) for (const item of batch.coverage) { const card = element('article',undefined,'evidence-card'); card.append(element('div',`${sourceName(item.source)} · ${formName(item.source,item.object)}`, 'evidence-heading')); addGrid(card,[['本次读取',item.read],['纳入订单核对',item.associated],['未纳入订单核对',Math.max(0,Number(item.read || 0)-Number(item.associated || 0))],['范围说明',item.source==='mes'?'勤哲生产编号与用友生产编号分别保留。尚未确认所属账套或对应订单的记录，不计为已关联订单。':'保留本次查询范围内的原始记录；尚未对应到已审核订单的记录，不据此认定已审核。']]); coverage.append(card); } else coverage.append(element('p','本次盘点未提供各类单据的查询及核对数量。','drawer-note'));
  content.append(coverage);
  const windows = section('各类资料查询时间（北京时间）');
  for (const read of batch.sourceReads || []) { const card = element('article',undefined,'evidence-card'); card.append(element('div',`${sourceName(read.source)} · ${formName(read.source,read.object)}`, 'evidence-heading')); addGrid(card,[['读取开始',time(read.startedAt)],['读取完成',time(read.finishedAt)],['读取记录数',read.count],['读取状态',read.status === 'succeeded' ? '成功' : read.status || '未提供']]); windows.append(card); }
  windows.append(element('p','同一次盘点采用固定规则；各类单据的读取时间可能不同。本次盘点成功表示必要读取与结果保存全部完成，不表示三系统处于同一时间点。','drawer-note')); content.append(windows);
  $('drawer-overlay').hidden = false; $('detail-content').scrollTop = 0; $('detail-drawer').scrollTop = 0; $('detail-drawer').focus({preventScroll:true});
}
function closeDrawer() { state.detailRequestId++;$('drawer-overlay').hidden = true; state.detailTrigger?.focus(); }
$('coverage-button').addEventListener('click',showCoverage);
$('close-drawer').addEventListener('click', closeDrawer);
$('drawer-overlay').addEventListener('click', event => { if (event.target === $('drawer-overlay')) closeDrawer(); });
document.addEventListener('keydown', event => { if ($('drawer-overlay').hidden) return; if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); } else if (event.key === 'Tab') { const items = [...$('detail-drawer').querySelectorAll('button,a[href],input,select,[tabindex="0"]')]; const first = items[0], last = items.at(-1); if (event.shiftKey && (document.activeElement === first || document.activeElement === $('detail-drawer'))) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } } });
$('batch-select').addEventListener('change', async event => { state.selected = event.target.value; state.page = 1; setError(''); closeDrawer(); renderBatches(); await loadRecords(); });
for (const button of document.querySelectorAll('[data-kind]')) button.addEventListener('click', () => { state.kind = button.dataset.kind; state.page = 1; for (const tab of document.querySelectorAll('[data-kind]')) tab.setAttribute('aria-selected',String(tab === button)); setError(''); loadRecords(); });
$('search-form').addEventListener('submit', event => { event.preventDefault(); state.query = $('query-input').value; state.page = 1; setError(''); loadRecords(); });
$('reset-search').addEventListener('click', () => { $('query-input').value = ''; state.query = ''; state.page = 1; setError(''); loadRecords(); });
$('previous-page').addEventListener('click', () => { if (state.page > 1 && !state.loading) { state.page--; loadRecords(); } });
$('next-page').addEventListener('click', () => { if (state.page * state.pageSize < state.total && !state.loading) { state.page++; loadRecords(); } });
$('export-button').addEventListener('click', () => { if (selectedBatch()?.status !== 'succeeded') return; const params = new URLSearchParams({batch:state.selected,kind:state.kind,q:state.query}); const link = element('a'); link.href = `/api/export?${params}`; link.download = ''; document.body.append(link); link.click(); link.remove(); });
$('start-batch').addEventListener('click', async () => { if (state.active || state.starting) return; state.starting = true; setError(''); renderBatches(); try { const data = await api('/api/batches', {method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'order-reconciliation'},body:'{}'}); state.selected = data.batchId; state.page = 1; await refreshBatches({reload:true}); } catch (error) { setError(error.message); } finally { state.starting = false; renderBatches(); } });
async function poll() { try { await refreshBatches(); } catch (error) { setError(`服务状态读取失败：${error.message} 当前展示的内容不代表一次新的成功读取。`); } finally { setTimeout(poll, state.active ? 2500 : 10000); } }
async function initialize() { try { await api('/api/health'); await refreshBatches({reload:true}); } catch (error) { setError(error.message); } poll(); }
initialize();

const chainLink=document.getElementById("chain-link"),chainAnchor=document.getElementById("checks-link")||document.getElementById("quantity-link");
function syncChainLink(){const batch=new URL(chainAnchor.href).searchParams.get("batch");chainLink.href="/chain-checks"+(batch?"?batch="+encodeURIComponent(batch):"");document.getElementById("processing-link").href="/processing-checks"+(batch?"?batch="+encodeURIComponent(batch):"");}
new MutationObserver(syncChainLink).observe(chainAnchor,{attributes:true,attributeFilter:["href"]});syncChainLink();
