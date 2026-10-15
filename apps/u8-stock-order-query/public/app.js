const $ = id => document.getElementById(id);
const state = { fields: [], reasons: {}, rows: [], page: 1, pageSize: 20, total: 0, filters: new URLSearchParams(), controller: null, busy: false };
const alerts = {rows:[],total:null,controller:null,checkedAt:null};
const columns = [
  ['VoucherType', '单据类型', 90], ['VoucherCode', '单据号', 150], ['InventoryCode', '物料', 140],
  ['SourceProductionNumber', '原生产编号', 150], ['AttributedProductionNumber', '实际归属编号', 150],
  ['ProductionOrderCode', '生产订单号', 120], ['QualityNumber', '质量编号', 85], ['U8PartNumber', 'U8 零件编号', 145],
  ['SalesOrderCode', '销售订单号', 120], ['ResolutionStatus', '解析状态', 80], ['CapturedAtUtc8', '首次捕获时间', 130]
];
function element(tag, className, text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
function displayValue(key, value) {
  if (value === null || value === undefined || value === '') return '未提供';
  if (key === 'VoucherType') return value === '10' ? '产成品入库' : '材料出库';
  if (key === 'AttributionRole') return value === 'origin' ? '入库来源' : '实际领用';
  if (key === 'ResolutionStatus') return value === 'resolved' ? '已解析' : '待确认';
  if (key === 'ResolutionReason') return state.reasons[value] || '未识别的解析原因';
  if (key === 'PartNumberCheck' || key === 'QualityNumberCheck') return ({same:'一致',different:'不一致',missing:'编号缺失',reference_unconfirmed:'引用待核查'})[value] || '待核查';
  if (key === 'SalesNumberReferenceStatus') return ({matched:'引用一致',sales_reference_missing:'销售明细引用缺失',sales_detail_not_found:'销售明细未找到',sales_order_missing:'销售订单号缺失',sales_order_disagreement:'销售订单不一致',production_sales_disagreement:'生产与销售引用不一致'})[value] || '引用待核查';
  if (key === 'NumberReferenceStatus') return ({matched:'引用一致',production_detail_not_found:'生产明细未找到',production_header_not_found:'生产订单未找到',production_order_missing:'归属订单号缺失',production_order_disagreement:'生产订单不一致',production_inventory_disagreement:'产出物料不一致',allocation_disagreement:'领用引用不一致'})[value] || '引用待核查';
  if (key.endsWith('Differs')) return value ? '不同' : '相同';
  return String(value);
}
function fieldValue(key, value) {
  if (key.endsWith('Differs') && value === null) return '无法比较';
  return displayValue(key, value);
}
async function api(path, signal) { const response = await fetch(path, { signal, cache: 'no-store' }); const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || '查询失败，请重试。'), {status: response.status}); return result; }
function setBusy(busy) {
  state.busy = busy; document.body.classList.toggle('busy', busy);
  $('submitQuery').disabled = busy; $('submitQuery').textContent = busy ? '查询中…' : '查询';
  $('previousPage').disabled = busy || state.page <= 1;
  $('nextPage').disabled = busy || state.page * state.pageSize >= state.total;
}
function renderHead() {
  const totalWidth = columns.reduce((sum, column) => sum + column[2], 0);
  for (const [key, label, width] of columns) {
    const th = element('th', '', label); th.style.width = `${width / totalWidth * 100}%`;
    const info = element('button', 'info-button', 'ⓘ'); info.type = 'button';
    info.title = state.fields.find(field => field.key === key)?.comment || '';
    info.setAttribute('aria-label', `查看${label}注释`);
    info.addEventListener('click', () => showFieldGuide(key)); th.append(info); $('tableHead').append(th);
  }
}
function renderRows() {
  $('tableBody').replaceChildren(); $('emptyState').hidden = state.rows.length !== 0;
  for (const row of state.rows) {
    const tr = element('tr', 'data-row'); tr.tabIndex = 0; tr.setAttribute('aria-label', `查看 ${row.VoucherCode || '未提供单据号'} 明细 ${row.DetailID}`);
    tr.addEventListener('click', () => showDetail(row));
    tr.addEventListener('keydown', event => { if (['Enter', ' '].includes(event.key)) { event.preventDefault(); showDetail(row); } });
    for (const [key] of columns) {
      const td = element('td'); const value = row[key];
      if (key === 'VoucherType') td.append(element('span', `type-badge ${value === '11' ? 'issue' : ''}`, displayValue(key, value)));
      else if (key === 'ResolutionStatus') td.append(element('span', `status-badge ${value === 'pending' ? 'pending' : ''}`, displayValue(key, value)));
      else {
        const main = element('span', `cell-main ${value ? 'code' : 'null'}`, displayValue(key, value)); main.title = displayValue(key, value); td.append(main);
        if (key === 'InventoryCode') { const sub = element('span', 'cell-sub', row.InventoryName || '物料名称未找到'); sub.title = row.InventoryName || ''; td.append(sub); }
        if (key === 'VoucherCode') td.append(element('span', 'cell-sub', row.VoucherDate || '日期未提供'));
        if (key === 'AttributedProductionNumber') td.append(element('span', 'cell-sub', displayValue('AttributionRole', row.AttributionRole)));
        if (key === 'QualityNumber' || key === 'U8PartNumber') {
          const check = key === 'QualityNumber' ? row.QualityNumberCheck : row.PartNumberCheck;
          const reference = key === 'QualityNumber' ? row.SalesNumberReferenceStatus : row.NumberReferenceStatus;
          const note = reference !== 'matched' ? '引用待核查' : check === 'different' ? key === 'QualityNumber' ? '与生产值不一致' : '与计算值不一致' : check === 'missing' ? '编号有缺项' : key === 'U8PartNumber' ? `行 ${row.ProductionLineSequence ?? '未提供'} · ${row.VoucherType === '11' ? '领用母件' : '产出零件'}` : '销售源头';
          td.append(element('span', `cell-sub ${check === 'different' || check === 'missing' || reference !== 'matched' ? 'number-warning' : ''}`, note));
        }
        if (key === 'CapturedAtUtc8' && value) { main.textContent = value.slice(0, 10); td.append(element('span', 'cell-sub code', `${value.slice(11, 19)} 北京时间`)); }
      }
      tr.append(td);
    }
    $('tableBody').append(tr);
  }
  const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
  $('resultSummary').textContent = `共 ${state.total} 条 · 按首次捕获时间倒序`;
  $('pageSummary').textContent = `${state.page} / ${pages}`;
  $('rangeSummary').textContent = state.total ? `显示 ${(state.page - 1) * state.pageSize + 1}–${Math.min(state.page * state.pageSize, state.total)} 条` : '显示 0 条';
  $('tableScroll').scrollTop = 0;
}
async function query() {
  state.controller?.abort(); const controller = new AbortController(); state.controller = controller;
  setBusy(true); $('errorNotice').hidden = true;
  void refreshAlerts();
  const params = new URLSearchParams(state.filters); params.set('page', state.page); params.set('pageSize', state.pageSize);
  try {
    const result = await api(`/api/mappings?${params}`, controller.signal);
    $('connectionDot').classList.remove('failed'); $('connectionDot').classList.add('ready'); $('connectionStatus').textContent = '账套 333 · 只读查询 · 已连接';
    state.rows = result.rows; state.total = result.totals.total;
    if (state.page > 1 && state.page > Math.max(1, Math.ceil(state.total / state.pageSize))) { state.page = Math.max(1, Math.ceil(state.total / state.pageSize)); return query(); }
    for (const [id, key] of [['statTotal', 'total'], ['statReceipts', 'receipts'], ['statIssues', 'issues'], ['statPending', 'pending']]) $(id).textContent = result.totals[key];
    $('lastQuery').textContent = `查询于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}`;
    renderRows();
  } catch (error) {
    if (error.name !== 'AbortError') {
      if (!error.status || error.status >= 500) { $('connectionDot').classList.remove('ready'); $('connectionDot').classList.add('failed'); $('connectionStatus').textContent = '账套连接暂不可用'; }
      state.rows = []; state.total = 0; $('tableBody').replaceChildren(); $('emptyState').hidden = true;
      $('errorNotice').textContent = `${error.message} 本次未返回数据，请重新查询。`; $('errorNotice').hidden = false;
      $('resultSummary').textContent = '本次查询未完成';
      for (const id of ['statTotal', 'statReceipts', 'statIssues', 'statPending']) $(id).textContent = '—';
      $('rangeSummary').textContent = ''; $('pageSummary').textContent = '—';
    }
  } finally { if (state.controller === controller) setBusy(false); }
}
async function refreshAlerts() {
  alerts.controller?.abort(); const controller = new AbortController(); alerts.controller = controller;
  $('refreshAlerts').disabled = true;
  try {
    const result = await api('/api/quality-alerts',controller.signal);
    alerts.rows=result.rows; alerts.total=result.total; alerts.checkedAt=result.checkedAtUtc8;
    $('qualityAlert').className=`quality-alert ${result.total ? 'has-differences' : 'clear'}`;
    $('alertIcon').textContent=result.total ? '!' : '✓';
    $('alertTitle').textContent=result.total ? `质量编号告警：${result.total} 条明细不一致` : '当前未发现质量编号不一致';
    $('alertSummary').textContent='销售源头与生产复制值分别保留。覆盖全部已捕获明细，不受筛选及分页影响。';
    $('alertCheckedAt').textContent=`核查于 ${result.checkedAtUtc8.slice(11,19)} 北京时间`;
    $('viewAlerts').disabled=result.total===0;
    if ($('alertDialog').open) renderAlerts();
  } catch(error) {
    if(error.name!=='AbortError') {
      alerts.rows=[];alerts.total=null;alerts.checkedAt=null;
      $('qualityAlert').className='quality-alert checking';$('alertIcon').textContent='?';
      $('alertTitle').textContent='质量编号告警暂不可用';
      $('alertSummary').textContent='本次核查未完成，请刷新告警。无法据此判断没有差异。';
      $('alertCheckedAt').textContent='';$('viewAlerts').disabled=true;
      if ($('alertDialog').open) renderAlerts();
    }
  } finally {if(alerts.controller===controller)$('refreshAlerts').disabled=false;}
}
function renderAlerts() {
  const content=$('alertContent'); content.replaceChildren();
  content.append(element('div','detail-summary',alerts.total===null?'本次告警核查未完成，请刷新后重试。':`共 ${alerts.total} 条质量编号不一致明细。${alerts.total>100?'这里显示最新 100 条，其余可用“质量编号核查”筛选查询。':''}点击单据可查看全部字段。`));
  for (const row of alerts.rows) {
    const item=element('button','alert-item'); item.type='button';
    item.append(element('strong','',`${row.VoucherCode} · ${displayValue('VoucherType',row.VoucherType)}`));
    item.append(element('span','alert-values',`销售源头：${row.QualityNumber}　→　生产明细：${row.ProductionQualityNumber}`));
    item.append(element('span','cell-sub',`生产订单 ${row.ProductionOrderCode || '未提供'} · 销售订单 ${row.SalesOrderCode || '未提供'} · 物料 ${row.InventoryCode} · 明细 ID ${row.DetailID}`));
    item.addEventListener('click',()=>{$('alertDialog').close();showDetail(row);}); content.append(item);
  }
}
function showFieldGuide(key) {
  $('guideTitle').textContent = key ? state.fields.find(field => field.key === key).label : '字段说明';
  const content = element('div', 'dictionary');
  const selected = key ? state.fields.filter(field => field.key === key) : state.fields;
  for (const field of selected) {
    const item = element('div', 'field-item'); item.append(element('div', 'field-label', field.label));
    const value = element('div', 'field-value', field.comment); value.append(element('div', 'field-comment', `${field.key} · ${field.storage === 'current' ? '当前关联值，未固化在映射表' : '映射表字段'}`)); item.append(value); content.append(item);
  }
  $('guideContent').replaceChildren(content); $('guideDialog').showModal();
}
function showDetail(row) {
  $('detailTitle').textContent = row.VoucherCode || '单据明细';
  const content = $('detailContent'); content.replaceChildren();
  content.append(element('div', 'detail-summary', `${displayValue('VoucherType', row.VoucherType)} · 明细 ID ${row.DetailID} · ${displayValue('ResolutionStatus', row.ResolutionStatus)}。${displayValue('ResolutionReason', row.ResolutionReason)}。以下时间均为北京时间。`));
  for (const group of [...new Set(state.fields.map(field => field.group))]) {
    const section = element('section', 'detail-group'); section.append(element('h3', '', group));
    for (const field of state.fields.filter(field => field.group === group)) {
      const item = element('div', 'field-item'); item.append(element('div', 'field-label', field.label));
      const value = element('div', 'field-value', fieldValue(field.key, row[field.key])); value.append(element('div', 'field-comment', field.comment)); item.append(value); section.append(item);
    }
    content.append(section);
  }
  $('detailDialog').showModal(); $('detailContent').scrollTop = 0;
}
function showUsage() {
  $('guideTitle').textContent = '使用说明';
  const content = element('div', 'usage');
  const sections = [
    ['如何查询', '选择单据类型，输入单据号、生产编号、生产订单号、销售订单号、物料编码、质量编号或 U8 零件编号，再点击“查询”。多个条件同时满足才显示。文本按包含匹配；日期筛选的是单据日期，包含起止两天。零件编号筛选查询 U8 保存的原编号。'],
    ['质量编号差异怎样告警', '顶部红色告警覆盖全部已捕获出入库明细，比较销售源头质量编号与生产复制值，不受当前筛选及分页影响。“查看告警”列出双方值及单据，点击可查看明细；“刷新告警”重新核查。页面可见时每 60 秒自动核查，查询也会刷新告警。告警查询失败时明确显示暂不可用，不显示为零条差异。'],
    ['如何只看差异', '在“质量编号核查”中选择“质量编号不一致”并点击查询。该筛选与其他输入同时生效；顶部全量告警仍独立显示。编号缺失和引用待核查可分别筛选，不视为两个有效编号不一致。告警反映当前值，没有发送外部消息或形成告警历史。'],
    ['如何核查一条明细', '点击结果行或聚焦后按回车，查看 24 个映射字段和 16 项当前关联信息及逐项注释。列名旁的 ⓘ 可以单独查看说明。“字段说明”区分映射表字段与当前关联值；“重置”清除查询条件并返回第一页。'],
    ['销售源头与生产复制值', '质量编号源头是销售订单子表 SO_SODetails.cDefine29，生产订单子表 mom_orderdetail.Define29 为复制值。页面并列显示两者及核对结果，缺失时不互相补填。质量编号筛选针对销售源头。通过销售明细 ID 查源头，不能按重复质量编号猜订单。U8 零件编号读取生产明细 Define28。'],
    ['编号属于哪个零件', '入库对应产出零件；材料出库对应实际领用订单的生产母件及其销售源头。母件质量编号和零件编号不能证明蜂窝等领用子件由哪个订单生产。读取前核查生产订单、物料及销售引用，引用不符时保留明细并显示“引用待核查”。销售源头物料可以是上层组件，不能要求它与领用子件或生产母件编码相同。'],
    ['零件编号与三种行号', '按当前账套记录，零件编号以生产订单号与生产明细 SortSeq 直接拼接，不加分隔符、不补零。以 CLCK2610140020 为例：SC2605180103 与生产明细行号 5 得到 SC26051801035；该明细的生产用料行号是 10，BOM 子件行号是 1。三个行号分别显示。计算编号只供核对，U8 原编号为空时不自动补填。'],
    ['来源归属和领用归属', '产成品入库记录产出的来源订单；材料出库按生产用料引用确定实际领用订单。原生产编号、原生产订单号保留原值。蜂窝由 A 生产、用于 B 时，实际领用归属应对应 B，不能用原编号猜填。'],
    ['原编号为空怎样看', '原生产编号为空不一定无法确定归属。材料出库有完整的生产用料、生产订单和销售明细引用时，仍可解析实际领用归属。生产编号差异显示“无法比较”，不能当作“相同”。'],
    ['已解析与待确认', '已解析仅表示订单归属解析条件满足，不代表单据已审核、BOM 完整或实物追溯完成。待确认行保留已取得的信息，解析原因显示第一个缺项。'],
    ['北京时间与更新范围', '首次捕获时间、最近同步时间直接保存和显示北京时间（UTC+8），无需换算。表保存当前状态：单据更新会刷新归属，删除会移除映射；它没有完整修改历史。'],
    ['关联资料与证据边界', '订单归属是最近一次出入库同步结果。生产、销售或用料资料单独变化不会自动刷新映射。质量编号、零件编号、行号、物料名称和生产母件按当前关联表读取，没有固化在映射表；重新查询可取得当前值。母件与领用子件关系应核对生产用料与 BOM，具体来源入库还需要出入库分配证据。']
  ];
  for (const [title, text] of sections) { content.append(element('h3', '', title)); content.append(element('p', '', text)); }
  content.append(element('div', 'note', '本服务只查询已捕获的记录，不写数据库、不补录历史，不自动修改待确认归属。筛选统计随本次查询条件变化。'));
  $('guideContent').replaceChildren(content); $('guideDialog').showModal();
}
$('queryForm').addEventListener('submit', event => { event.preventDefault(); state.filters = new URLSearchParams(); for (const [key, value] of new FormData(event.target)) if (String(value).trim()) state.filters.set(key, String(value).trim()); state.page = 1; query(); });
$('resetQuery').addEventListener('click', () => { $('queryForm').reset(); state.filters = new URLSearchParams(); state.page = 1; query(); });
$('previousPage').addEventListener('click', () => { state.page--; query(); });
$('nextPage').addEventListener('click', () => { state.page++; query(); });
$('pageSize').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; query(); });
$('fieldGuide').addEventListener('click', () => showFieldGuide()); $('usageGuide').addEventListener('click', showUsage);
$('refreshAlerts').addEventListener('click',refreshAlerts);
$('viewAlerts').addEventListener('click',()=>{renderAlerts();$('alertDialog').showModal();});
setInterval(()=>{if(document.visibilityState==='visible'&&!state.busy)void refreshAlerts();},60000);
for (const dialog of document.querySelectorAll('dialog')) { dialog.querySelector('.close').addEventListener('click', () => dialog.close()); dialog.addEventListener('click', event => { if (event.target === dialog) { const bounds = dialog.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close(); } }); }
try {
  const schema = await api('/api/schema'); state.fields = [...schema.relatedFields.filter(field => field.group === '质量与零件编号'), ...schema.fields, ...schema.relatedFields.filter(field => field.group !== '质量与零件编号')]; state.reasons = schema.reasons; renderHead();
  const health = await api('/api/health'); $('connectionDot').classList.add('ready'); $('connectionStatus').textContent = `账套 333 · 只读查询 · 已连接`;
  if (health.timeZone !== 'UTC+8') throw new Error('时间口径不一致，请联系维护人员。');
  await query();
} catch (error) { $('connectionDot').classList.add('failed'); $('connectionStatus').textContent = '账套连接暂不可用'; $('errorNotice').hidden = false; $('errorNotice').textContent = error.message; $('resultSummary').textContent = '暂未取得数据'; setBusy(false); }
