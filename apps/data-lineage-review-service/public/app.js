import { bindCandidateBrowser } from '/candidates.js';
import { bindComparison } from '/comparison.js';
import { bindAuditViews } from '/audit-ui.js';
import { fieldLabel, tableLabel, referenceLabel } from '/field-presentation.js';
import { actions, roles, lineageInputs, recordState, noteComplete, notesComplete, createSubmissionId, selectionLabels, mergeReview, reviewPayload } from '/review-model.js';

const byId = id => document.getElementById(id);
const systemSelect = byId('system');
const tableSelect = byId('table');
const fieldSelect = byId('field');
const tableSearch = byId('table-search');
const fieldSearch = byId('field-search');
const editor = byId('editor');
const status = byId('status');
const save = byId('save');
const completion = byId('review-completed');
const catalogDialog = byId('catalog-dialog');
const catalogApply = byId('catalog-apply');
const reviewList = byId('review-progress');
const reviewListToggle = byId('toggle-review-list');
const progressSummary = byId('progress-summary');
const progressTitle = byId('progress-title');
const catalogSummary = byId('catalog-summary');
const batchBreakdown = byId('batch-breakdown');
const batchSearch = byId('batch-search');
const batchSelect = byId('collection-batch');
const batchStatus = byId('batch-status');
const batchTasks = byId('batch-tasks');
const batchResult = byId('batch-result');
const batchReport = byId('batch-report');
const nextTask = byId('next-task');
const editorState = byId('editor-state');
const candidateCurrent = byId('candidate-current');
const progressTable = byId('progress-table');
const progressRows = byId('progress-rows');
const lineageFields = byId('lineage-fields');
const lineageCount = byId('lineage-count');
const taskStates = { completed: '已确认', pending: '已收待确认', unreviewed: '未收集' };
const countFormat = new Intl.NumberFormat('zh-CN');
const percentFormat = new Intl.NumberFormat('zh-CN', { style: 'percent', maximumFractionDigits: 2 });
const multipleAMessage = '此矩阵有历史多选的 A。请选一个岗位或清空后保存。';
const cells = {};
const drafts = new Map();
const positionDialog = byId('position-dialog');
const departmentFilter = byId('position-department');
const positionSearch = byId('position-search');
const currentPositions = new Map();
let catalog;
let active;
let picker;
let loading = 0;
let saving = false;
let conflict = null;
let conflictRecovery = false;
let completionIntent = null;
let progressLoading = 0;
let batchProgress;
let batchCounts;
let activeBatchId = '';
let tasks = [];

const auditViews = bindAuditViews({ request });
const comparison = bindComparison({ request, getCatalog: () => catalog, positions: currentPositions, drafts,
  showNameReference: field => auditViews.showName(field),
  pickPositions: openPicker, openField, onSaved: refreshProgress });
byId('field-name-evidence').addEventListener('click', () => {
  const field = catalog?.fields.find(option => option.id === active?.id);
  if (field) auditViews.showName(field);
});
byId('open-comparison').addEventListener('click', () => {
  const field = catalog?.fields.find(option => option.id === active?.id);
  if (field && !saving) comparison.open(field);
});

const candidateBrowser = bindCandidateBrowser({
  request,
  getFields: () => catalog?.fields ?? [],
  compareTarget(id) {
    const field = catalog?.fields.find(option => option.id === id);
    if (field && !saving) comparison.open(field);
  },
  async openTarget(id) {
    const field = catalog?.fields.find(option => option.id === id);
    if (!field || saving) return;
    await openField(field);
    if (active?.id === id) byId('field-title').focus();
  },
});
candidateCurrent.addEventListener('click', () => {
  const field = catalog.fields.find(option => option.id === active?.id);
  if (field && !saving) {
    candidateBrowser.showField(field);
  }
});

function showTab(id, focus = false) {
  for (const tab of document.querySelectorAll('[role="tab"]')) {
    const selected = tab.id === id;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    byId(tab.getAttribute('aria-controls')).hidden = !selected;
    if (selected && focus) tab.focus();
  }
  document.querySelector('.editor-scroll').scrollTop = 0;
}
const tabs = [...document.querySelectorAll('[role="tab"]')];
for (const tab of tabs) {
  tab.addEventListener('click', () => showTab(tab.id));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length,
      Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    showTab(tabs[next].id, true);
  });
}
for (const button of document.querySelectorAll('[data-close]')) {
  button.addEventListener('click', () => byId(button.dataset.close).close());
}
function openCatalog() {
  if (saving || comparison.isBusy || !catalog || catalogDialog.open) return;
  if (active) syncPicker(catalog.fields.find(field => field.id === active.id));
  catalogApply.disabled = !fieldSelect.value;
  catalogDialog.showModal();
}
byId('open-catalog').addEventListener('click', openCatalog);
byId('empty-open-catalog').addEventListener('click', openCatalog);
function setReviewListOpen(open) {
  const restoreFocus = !open && reviewList.contains(document.activeElement);
  reviewList.hidden = !open;
  document.querySelector('.workspace').classList.toggle('review-list-open', open);
  reviewListToggle.setAttribute('aria-expanded', String(open));
  reviewListToggle.textContent = open ? '收起评审清单' : '展开评审清单';
  if (restoreFocus) reviewListToggle.focus();
}
reviewListToggle.addEventListener('click', () => setReviewListOpen(reviewList.hidden));
byId('close-review-list').addEventListener('click', () => setReviewListOpen(false));
byId('open-candidates').addEventListener('click', () => candidateBrowser.open());
byId('open-overview').addEventListener('click', () => {
  byId('overview-dialog').showModal();
  refreshProgress();
  auditViews.refreshAudit();
});
byId('completion-hint').addEventListener('click', () => {
  showTab('lineage-tab');
  const inputs = [...lineageFields.querySelectorAll('textarea')];
  (inputs.find(input => !input.value.trim()) ?? inputs[0])?.focus();
});
catalogApply.addEventListener('click', async () => {
  const field = catalog.fields.find(item => item.id === fieldSelect.value);
  if (!field || saving) return;
  catalogDialog.close();
  await openField(field);
  byId('field-title').focus();
});

for (const [action, label] of Object.entries(actions)) {
  const row = document.createElement('tr');
  const heading = document.createElement('th');
  heading.scope = 'row';
  heading.textContent = label;
  row.append(heading);
  cells[action] = {};
  for (const [role, roleLabel] of Object.entries(roles)) {
    const cell = document.createElement('td');
    const input = document.createElement('button');
    input.type = 'button';
    input.className = 'position-cell';
    input.setAttribute('aria-label', label + ' · ' + roleLabel);
    input.addEventListener('click', () => openPicker(action, role));
    cells[action][role] = input;
    cell.append(input);
    row.append(cell);
  }
  byId('grid').append(row);
}

function renderLineage() {
  byId('lineage-empty').hidden = active.references.length > 0;
  byId('lineage-tab-count').textContent = active.references.length || '—';
  const legend = document.createElement('legend');
  legend.className = 'sr-only';
  legend.textContent = '所选字段的血缘与取值记录';
  lineageFields.replaceChildren(legend, ...active.references.map(item => {
    const section = document.createElement('section');
    section.className = 'lineage-card';
    const heading = document.createElement('h4');
    heading.textContent = item.id + ' · ' + item.title;
    const source = document.createElement('p');
    source.className = 'source-inline';
    source.textContent = '父级参考 · ' + referenceLabel(item.source, catalog.fields);
    const inputs = document.createElement('div');
    inputs.className = 'lineage-inputs';
    for (const [key, name] of Object.entries(lineageInputs)) {
      const label = document.createElement('label');
      const input = document.createElement('textarea');
      input.maxLength = 2000;
      input.placeholder = key === 'writeRule' ? '例如：在哪个业务动作发生时，由谁录入或从哪里取值…' : '例如：同步更新、保留当时值，或触发重新核对…';
      input.setAttribute('aria-label', item.id + ' · ' + name);
      input.value = active.lineageNotes[item.id][key];
      input.addEventListener('input', () => {
        active.lineageNotes = { ...active.lineageNotes, [item.id]: { ...active.lineageNotes[item.id], [key]: input.value } };
        markContentChanged();
        remember();
      });
      label.append(name, input);
      inputs.append(label);
    }
    section.append(heading, source, inputs);
    return section;
  }));
  byId('reference-list').replaceChildren(...active.references.map(item => {
    const card = document.createElement('section');
    card.className = 'reference-card';
    const id = document.createElement('p');
    id.className = 'reference-id';
    id.textContent = item.id + ' · 血缘线索';
    const heading = document.createElement('h4');
    heading.textContent = item.title;
    const sourceLabel = document.createElement('p');
    sourceLabel.className = 'reference-label';
    sourceLabel.textContent = '父级字段或来源';
    const source = document.createElement('p');
    source.className = 'reference-source';
    source.textContent = referenceLabel(item.source, catalog.fields);
    const evidence = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '已有证据与取值线索';
    evidence.append(summary);
    for (const [label, value] of [['已有证据', item.evidence], ['写入线索', item.write], ['变更线索', item.change], ['样例目标', item.target]]) {
      if (!value) continue;
      const paragraph = document.createElement('p');
      paragraph.textContent = label + '：' + referenceLabel(value, catalog.fields);
      evidence.append(paragraph);
    }
    card.append(id, heading, sourceLabel, source, evidence);
    if (item.pending) {
      const label = document.createElement('p');
      label.className = 'reference-label';
      label.textContent = '待确认';
      const pending = document.createElement('p');
      pending.className = 'reference-pending';
      pending.textContent = referenceLabel(item.pending, catalog.fields);
      card.append(label, pending);
    }
    return card;
  }));
  const currentField = catalog.fields.find(field => field.id === active.id);
  if (currentField?.parentReference) {
    const origin = currentField.parentReference;
    const card = document.createElement('section');
    card.className = 'reference-card';
    const title = document.createElement('h4');
    title.textContent = '数据库视图列来源';
    const source = document.createElement('p');
    source.className = 'reference-source';
    source.textContent = referenceLabel(origin.table + '.' + origin.name, catalog.fields);
    const evidence = document.createElement('p');
    evidence.className = 'muted';
    evidence.textContent = origin.evidence;
    card.append(title, source, evidence);
    byId('reference-list').append(card);
  }
  if (!active.references.length && !currentField?.parentReference) {
    const empty = document.createElement('p');
    empty.className = 'empty-note';
    empty.textContent = '当前字段暂无血缘样例。可通过「查看同名参考」查找相关候选。';
    byId('reference-list').append(empty);
  }
}

function labels(values, action, role, state = active) {
  return selectionLabels(values, action, role, state, currentPositions);
}

function showCells() {
  for (const [action, row] of Object.entries(cells)) {
    for (const [role, input] of Object.entries(row)) {
      const value = labels(active.values, action, role);
      input.textContent = value || '选择岗位';
      input.classList.toggle('empty', !value);
      if (active.values[action][role] === null) input.textContent = '历史填写\n' + value;
      if (role === 'A' && active.values[action].A?.length > 1) input.textContent = '历史多选\n' + value;
    }
  }
}

function openPicker(action, role, context) {
  const state = context?.state ?? active;
  const value = state.values[action][role];
  const single = role === 'A';
  const historicalMultiple = single && value?.length > 1;
  picker = { action, role, state, apply: context?.apply, single, initial: value, needsChoice: value === null || historicalMultiple,
    selected: new Set(historicalMultiple ? [] : value ?? []) };
  byId('position-title').textContent = actions[action] + ' · ' + roles[role] + '｜选择岗位';
  byId('position-source').textContent = (context?.context ? context.context + ' · ' : '') + '组织与岗位快照 ' + catalog.positionCatalog.source.date;
  const legacy = byId('position-legacy');
  legacy.hidden = !picker.needsChoice;
  legacy.textContent = historicalMultiple ? '历史多选。请选择一个岗位或清空本格。\n' + labels(state.values, action, role, state)
    : value === null ? '历史填写：' + state.legacy[action][role] : '';
  departmentFilter.value = '';
  positionSearch.value = '';
  renderPositions();
  positionDialog.showModal();
}

function updatePositionCount() {
  byId('position-count').textContent = '已选 ' + picker.selected.size + ' 个岗位' + (picker.single ? '（最多 1 个）' : '');
  byId('position-apply').disabled = picker.needsChoice && picker.selected.size === 0;
}

function renderPositions() {
  const options = [...currentPositions.values()];
  for (const id of picker.initial ?? []) {
    if (!currentPositions.has(id) && picker.state.priorOptions.has(id)) options.push(picker.state.priorOptions.get(id));
  }
  const searchTerm = positionSearch.value.trim().toLowerCase();
  const matches = options.filter(option => (!departmentFilter.value || option.department === departmentFilter.value)
    && option.label.toLowerCase().includes(searchTerm));
  byId('position-list').replaceChildren(...matches.map(option => {
    const row = document.createElement('label');
    const input = document.createElement('input');
    input.type = picker.single ? 'radio' : 'checkbox';
    if (picker.single) input.name = 'position-choice';
    input.checked = picker.selected.has(option.id);
    input.addEventListener('change', () => {
      if (picker.single) picker.selected.clear();
      if (input.checked) picker.selected.add(option.id);
      else picker.selected.delete(option.id);
      updatePositionCount();
    });
    row.append(input, option.label + (currentPositions.has(option.id) ? '' : '（原目录）'));
    return row;
  }));
  if (!matches.length) {
    const hint = document.createElement('p');
    hint.textContent = '未找到匹配的岗位。';
    byId('position-list').append(hint);
  }
  updatePositionCount();
}

function applyPositions(ids) {
  if (picker.apply) {
    picker.apply(ids);
    positionDialog.close();
    return;
  }
  const { action, role } = picker;
  const changed = JSON.stringify(active.values[action][role]) !== JSON.stringify(ids);
  active.values = { ...active.values, [action]: { ...active.values[action], [role]: ids } };
  if (changed) markContentChanged();
  positionDialog.close();
  showCells();
  remember();
  if (status.textContent === multipleAMessage && !hasMultipleA()) status.textContent = '';
  if (conflict) describeConflict();
}

departmentFilter.addEventListener('change', renderPositions);
positionSearch.addEventListener('input', renderPositions);
byId('position-apply').addEventListener('click', () => applyPositions([...picker.selected]));
byId('position-clear').addEventListener('click', () => applyPositions([]));
byId('position-cancel').addEventListener('click', () => positionDialog.close());

function setOptions(select, placeholder, options, selected = '') {
  select.replaceChildren(new Option(placeholder, ''), ...options);
  select.value = selected;
  select.disabled = options.length === 0;
}

function filterOptions(select, options, query, label) {
  const selected = options.find(option => option.value === select.value);
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = options.filter(option => keywords.every(word =>
    (option.text + ' ' + (option.dataset.searchText ?? '')).toLowerCase().includes(word)));
  const placeholder = matches.length ? '请选择' + label : '未找到匹配的' + label;
  if (selected && !matches.includes(selected)) {
    matches.unshift(new Option(selected.text + '（当前选中）', selected.value));
  }
  setOptions(select, placeholder, matches, selected?.value);
}

function showTableOptions() {
  const system = systemSelect.value;
  tableSearch.disabled = !system;
  if (!system) return setOptions(tableSelect, '请先选择系统', []);
  const tables = new Map(catalog.fields.filter(field => field.system === system).map(field => [field.table, field]));
  filterOptions(tableSelect, [...tables].map(([table, field]) => {
    const option = new Option(tableLabel(field), table);
    option.dataset.searchText = table;
    return option;
  }), tableSearch.value, '表名');
}

function showFieldOptions() {
  const table = tableSelect.value;
  fieldSearch.disabled = !table;
  if (!table) return setOptions(fieldSelect, '请先选择表名', []);
  const fields = catalog.fields.filter(field => field.system === systemSelect.value && field.table === table);
  const ordinary = [];
  const generated = [];
  for (const field of fields) {
    const labels = [];
    if (field.primaryKeyOrdinal) labels.push('主键');
    if (field.identity) labels.push('自增');
    if (field.computed) labels.push('计算列');
    if (field.likelyGenerated && !field.identity && !field.computed) labels.push('系统生成待核对');
    const label = fieldLabel(field) + (labels.length ? '（' + labels.join(' · ') + '）' : '');
    const options = field.identity || field.computed || field.likelyGenerated ? generated : ordinary;
    const option = new Option(label, field.id);
    option.dataset.searchText = field.name;
    options.push(option);
  }
  filterOptions(fieldSelect, [...ordinary, ...generated], fieldSearch.value, '字段');
}

async function request(path, options) {
  const requestOptions = { ...options };
  if (typeof AbortSignal?.timeout === 'function') requestOptions.signal = AbortSignal.timeout(20000);
  let response;
  try {
    response = await fetch(path, requestOptions);
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new Error('读取超时，请稍后重试。');
    }
    throw new Error('网络连接失败，请确认评审服务可用后重试。');
  }
  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('读取超时，请稍后重试。');
    data = null;
  }
  if (!response.ok) {
    const error = new Error(data?.message || '评审服务返回异常（HTTP ' + response.status + '），请稍后重试。');
    error.status = response.status;
    throw error;
  }
  if (!data) throw new Error('评审服务返回了无法识别的内容，请刷新页面后重试。');
  return data;
}

async function refreshProgress() {
  const ticket = ++progressLoading;
  try {
    const { total, systems, batch, batches } = await request('/api/progress');
    if (ticket !== progressLoading) return;
    batchCounts = batches ?? { 'outline-revision': batch };
    const remaining = total.total - total.completed;
    catalogSummary.textContent = '已完成 ' + countFormat.format(total.completed) + ' / ' +
      countFormat.format(total.total) + '（' + percentFormat.format(total.total ? total.completed / total.total : 0) +
      '） · 待完成 ' + countFormat.format(remaining);
    updateBatchProgress();
    progressRows.replaceChildren(...systems.map(system => {
      const row = document.createElement('tr');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.textContent = system.system;
      row.append(heading);
      const counts = [system.total, system.completed, system.pending, system.unreviewed, system.total - system.completed];
      const values = counts.map(count => countFormat.format(count));
      values.push(percentFormat.format(system.completed / system.total));
      for (const value of values) row.insertCell().textContent = value;
      return row;
    }));
    progressTable.hidden = false;
  } catch {
    if (ticket !== progressLoading) return;
    progressSummary.textContent = '统计读取失败，请打开收集概览重试';
    batchBreakdown.textContent = '暂时无法读取当前批次统计。';
    catalogSummary.textContent = '';
    progressTable.hidden = true;
  }
}

function updateBatchProgress() {
  batchProgress = batchCounts?.[activeBatchId];
  if (batchProgress) {
    const { completed, total, pending, unreviewed, lineagePending } = batchProgress;
    progressSummary.textContent = '已确认 ' + completed + ' / ' + total + ' · 待完成 ' + (total - completed);
    const percent = total ? Math.round(completed / total * 100) : 0;
    byId('batch-meter').setAttribute('aria-valuenow', String(percent));
    byId('batch-meter').firstElementChild.style.width = percent + '%';
    byId('batch-counts').replaceChildren(...[['未收集', unreviewed], ['待确认', pending], ['已确认', completed]].map(([label, count]) => {
      const span = document.createElement('span');
      const number = document.createElement('b');
      number.textContent = count;
      span.append(number, label);
      return span;
    }));
    const details = lineagePending === undefined ? '' : '（待补血缘 ' + lineagePending + '，记录齐待确认 ' +
      (pending - lineagePending) + '）';
    const batchName = catalog?.collection?.batches?.find(batch => batch.id === activeBatchId)?.name;
    batchBreakdown.textContent = (batchName ? '「' + batchName + '」' : '') + '应收 ' + total + ' · 已收待确认 ' +
      pending + details + ' · 未收 ' + unreviewed + '。按目标字段计数，父级供核对。';
    if (lineagePending !== undefined) {
      batchReport.href = '/api/collection-batches/' + encodeURIComponent(activeBatchId) + '/report.csv';
      batchReport.hidden = false;
    }
  } else {
    progressSummary.textContent = activeBatchId ? '正在读取清单进度…' : '';
    batchBreakdown.textContent = activeBatchId ? '所选清单进度暂不可用。' : '未选择评审清单；可直接从全部字段选择并评审。';
    byId('batch-meter').setAttribute('aria-valuenow', '0');
    byId('batch-meter').firstElementChild.style.width = '0%';
    byId('batch-counts').replaceChildren();
  }
  showBatchTasks();
  if (active) updateSaveButton();
}

function chooseBatch(id) {
  const batch = catalog.collection.batches.find(option => option.id === id);
  if (id && !batch) return;
  activeBatchId = batch?.id ?? '';
  batchSelect.value = activeBatchId;
  progressTitle.textContent = batch ? batchCaption(batch) : '';
  byId('review-list-empty').hidden = Boolean(batch);
  byId('batch-details').hidden = byId('review-list-tasks').hidden = !batch;
  batchReport.hidden = !batch;
  if (batch) batchReport.href = '/api/collection-batches/' + encodeURIComponent(id) + '/report.csv';
  else batchReport.removeAttribute('href');
  const scope = new Set(batch?.fieldIds ?? []);
  tasks = catalog.fields.filter(field => scope.has(field.id));
  updateBatchProgress();
}

function batchCaption(batch) {
  return batch.name + (batch.id === 'outline-revision' ? '（样例）' : '');
}

function showBatchTasks() {
  if (!catalog) return;
  const keywords = batchSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const scope = batchStatus.value;
  const visible = tasks.filter(field => {
    const state = batchProgress?.tasks?.[field.id];
    const label = (field.table + '.' + field.name + ' ' + fieldLabel(field) + ' ' + tableLabel(field)).toLowerCase();
    const missing = batchProgress?.missingLineage?.[field.id];
    const matchesStatus = !scope || scope === state || (scope === 'open' && state !== 'completed') ||
      (scope === 'lineage_pending' && missing) ||
      (scope === 'confirmation_pending' && state === 'pending' && !missing && batchProgress.missingLineage);
    return matchesStatus && keywords.every(keyword => label.includes(keyword));
  });
  const focusedTask = document.activeElement?.dataset.taskId;
  const buttons = visible.map(field => {
    const state = taskStates[batchProgress?.tasks?.[field.id]] ?? '进度待读取';
    const missing = batchProgress?.missingLineage?.[field.id];
    const item = document.createElement('li');
    const button = document.createElement('button');
    const title = document.createElement('span');
    title.className = 'task-name';
    const table = document.createElement('span');
    table.className = 'task-table';
    const dot = document.createElement('span');
    dot.className = 'task-dot ' + (batchProgress?.tasks?.[field.id] ?? 'unreviewed');
    dot.setAttribute('aria-hidden', 'true');
    const badge = document.createElement('small');
    button.type = 'button';
    button.disabled = saving;
    button.dataset.taskId = field.id;
    button.setAttribute('aria-current', String(field.id === active?.id));
    title.append(fieldLabel(field), dot);
    table.textContent = tableLabel(field);
    badge.textContent = state + (missing ? ' · ' + missing + ' 条血缘待补' : '') +
      (drafts.has(field.id) ? ' · 未保存' : '');
    badge.classList.toggle('draft-mark', drafts.has(field.id));
    button.append(title, table, badge);
    button.addEventListener('click', () => enterTask(field));
    item.append(button);
    return item;
  });
  batchTasks.replaceChildren(...buttons);
  batchResult.textContent = visible.length ? '显示 ' + visible.length + ' / ' + tasks.length + ' 项' : '没有匹配的任务。';
  if (focusedTask && !saving) {
    const focused = buttons.find(item => item.firstChild.dataset.taskId === focusedTask)?.firstChild;
    (focused ?? batchStatus).focus({ preventScroll: true });
  }
}

async function enterTask(field) {
  if (!field || saving) return;
  await openField(field);
  if (active?.id === field.id) byId('field-title').focus();
}

function nextPendingTask() {
  if (!active || !batchProgress) return;
  const index = tasks.findIndex(field => field.id === active.id);
  if (index < 0) return;
  const otherTasks = [...tasks.slice(index + 1), ...tasks.slice(0, index)];
  return otherTasks.find(field => batchProgress.tasks[field.id] !== 'completed');
}

batchSearch.addEventListener('input', showBatchTasks);
batchStatus.addEventListener('change', showBatchTasks);
batchSelect.addEventListener('change', () => {
  batchSearch.value = '';
  chooseBatch(batchSelect.value);
});
nextTask.addEventListener('click', () => enterTask(nextPendingTask()));

function pathFor(id) {
  return '/api/fields/' + encodeURIComponent(id) + '/matrix';
}

function setActive(id, record, draft) {
  const references = catalog.collection.tasks[id] ?? [];
  const state = recordState(record, references);
  const completed = record?.completed === true && notesComplete(state.lineageNotes);
  active = { id, version: record?.version ?? 0, base: state.values, baseCompleted: completed,
    completed, references, baseLineageNotes: state.lineageNotes, ...state, ...draft };
  completionIntent = draft ? (draft.completionIntent ?? null) : null;
  showCells();
  renderLineage();
  editor.hidden = false;
  byId('editor-empty').hidden = true;
  byId('load-message').textContent = '';
  const field = catalog.fields.find(option => option.id === id);
  byId('field-title').textContent = fieldLabel(field);
  byId('field-context').textContent = field.system + ' / ' + tableLabel(field);
  byId('field-description').textContent = field.labelSource ? '名称依据 · ' + field.labelSource : '';
  byId('open-comparison').hidden = false;
  byId('field-name-evidence').hidden = !field.labelSource;
  byId('open-comparison').textContent = '同名对照（' + catalog.fields.filter(option => option.name === field.name).length + '）';
  byId('reference-list').scrollTop = 0;
  showBatchTasks();
  updateSaveButton();
  status.textContent = hasMultipleA() ? multipleAMessage : draft ? '已恢复该字段未保存的填写' : active.version ? '当前记录已保存' : '填写岗位或血缘后保存';
}

async function selectField(id) {
  const ticket = ++loading;
  active = null;
  conflict = null;
  conflictRecovery = false;
  byId('conflict').hidden = true;
  editor.hidden = true;
  byId('editor-empty').hidden = false;
  editorState.hidden = true;
  candidateCurrent.hidden = true;
  byId('open-comparison').hidden = true;
  byId('field-name-evidence').hidden = true;
  showTab('matrix-tab');
  status.textContent = '';
  if (!id) return;
  const draft = drafts.get(id);
  if (draft) return setActive(id, null, draft);
  byId('load-message').textContent = '正在读取记录…';
  try {
    const { review } = await request(pathFor(id));
    if (ticket === loading) setActive(id, review);
  } catch (error) {
    if (ticket !== loading) return;
    fieldSelect.value = '';
    byId('field-context').textContent = '字段底册';
    byId('load-message').textContent = (error.message || '读取失败。') + ' 请重新选定字段。';
  }
}

systemSelect.addEventListener('change', () => {
  tableSearch.value = fieldSearch.value = '';
  tableSelect.value = '';
  fieldSelect.value = '';
  showTableOptions();
  showFieldOptions();
  catalogApply.disabled = true;
});
tableSelect.addEventListener('change', () => {
  fieldSearch.value = fieldSelect.value = '';
  showFieldOptions();
  catalogApply.disabled = true;
});
tableSearch.addEventListener('input', showTableOptions);
fieldSearch.addEventListener('input', showFieldOptions);
fieldSelect.addEventListener('change', () => { catalogApply.disabled = !fieldSelect.value; });

function hasMultipleA() {
  return Object.values(active.values).some(row => row.A?.length > 1);
}

function updateSaveButton() {
  const dirty = drafts.has(active.id);
  const collected = Object.values(active.lineageNotes).filter(noteComplete).length;
  const currentState = active.baseCompleted ? '已确认' : active.version ? '已收待确认' : '未收';
  editorState.textContent = currentState + (dirty ? ' · 有未保存修改' : '');
  editorState.dataset.state = dirty ? 'dirty' : active.baseCompleted ? 'completed' : 'pending';
  editorState.hidden = false;
  candidateCurrent.hidden = false;
  candidateCurrent.disabled = saving;
  byId('open-comparison').disabled = saving;
  lineageCount.textContent = '已填 ' + collected + ' / ' + active.references.length + ' 条';
  const missing = active.references.length - collected;
  byId('completion-hint').hidden = !missing;
  byId('completion-hint').textContent = '还需补齐 ' + missing + ' 条血缘记录，去填写 →';
  if (!status.textContent) status.textContent = dirty ? '修改尚未保存' : active.version ? '当前记录已保存' : '填写岗位或血缘后保存';
  completion.checked = active.completed;
  completion.disabled = saving || collected < active.references.length;
  completion.title = completion.disabled && !saving ? '请先填写每条血缘的写入时点和上游变更后的处理。' : '';
  nextTask.hidden = !tasks.some(field => field.id === active.id);
  nextTask.disabled = saving || dirty || !nextPendingTask();
  nextTask.title = dirty ? '请先保存。也可从任务列表切换，本页草稿会保留。' : '';
  save.disabled = saving || Boolean(conflict) || conflictRecovery || !dirty || hasMultipleA();
}

function contentMatchesBase() {
  return JSON.stringify(active.values) === JSON.stringify(active.base) &&
    JSON.stringify(active.lineageNotes) === JSON.stringify(active.baseLineageNotes);
}

function markContentChanged() {
  const unchanged = contentMatchesBase();
  if (unchanged) active.completed = completionIntent ?? active.baseCompleted;
  else active.completed = false;
}

function remember() {
  const { id, values, base, version, legacy, priorOptions, completed, baseCompleted, lineageNotes, baseLineageNotes } = active;
  const serialized = JSON.stringify(values);
  const serializedNotes = JSON.stringify(lineageNotes);
  if (serialized === JSON.stringify(base) && completed === baseCompleted &&
      serializedNotes === JSON.stringify(baseLineageNotes)) {
    drafts.delete(id);
  } else {
    const previous = drafts.get(id);
    const submissionId = previous && JSON.stringify(previous.values) === serialized && previous.completed === completed &&
      JSON.stringify(previous.lineageNotes) === serializedNotes
      ? previous.submissionId : createSubmissionId();
    drafts.set(id, { version, base, values, legacy, priorOptions, completed, baseCompleted, lineageNotes, baseLineageNotes, submissionId, completionIntent });
  }
  if (!drafts.has(id)) completionIntent = null;
  updateSaveButton();
  status.textContent = drafts.has(active.id) ? '修改尚未保存' : active.version ? '当前记录已保存' : '填写岗位或血缘后保存';
  showBatchTasks();
  if (conflict) describeConflict();
}

completion.addEventListener('change', () => {
  active.completed = completion.checked;
  completionIntent = completion.checked;
  remember();
});

function mergeDraft(latest) {
  return mergeReview(active, latest, currentPositions);
}

function describeConflict() {
  const { lines } = mergeDraft(conflict);
  byId('differences').textContent = ['其他窗口已保存新版本。核对后可把本次修改合并到最新版本。', ...lines].join('\n');
}

function showConflictMerge(latest) {
  conflict = latest;
  conflictRecovery = false;
  byId('conflict-retry').hidden = true;
  byId('rebase').hidden = false;
  describeConflict();
  byId('conflict').hidden = false;
  byId('conflict').scrollIntoView({ block: 'nearest' });
  status.textContent = '已读取最新记录，请核对差异后合并。';
  refreshProgress();
}

function showConflictRecovery(message) {
  conflictRecovery = true;
  byId('differences').textContent = message;
  byId('conflict-retry').hidden = false;
  byId('rebase').hidden = true;
  byId('conflict').hidden = false;
  byId('conflict').scrollIntoView({ block: 'nearest' });
  status.textContent = message;
  updateSaveButton();
}

async function refreshLatestConflict() {
  if (!active) return;
  const fieldId = active.id;
  const version = active.version;
  const ticket = loading;
  status.textContent = '正在读取最新记录…';
  const latest = await request(pathFor(fieldId)).catch(() => null);
  if (ticket !== loading || active?.id !== fieldId) return;
  if (latest === null) {
    showConflictRecovery('其他窗口可能已保存新版本，但读取最新记录失败。本次填写仍保留在页面上，可重试读取或刷新页面。');
    return;
  }
  if (latest.review?.version > version) {
    showConflictMerge(latest.review);
    return;
  }
  conflictRecovery = false;
  conflict = null;
  byId('conflict').hidden = true;
  byId('rebase').hidden = false;
  byId('conflict-retry').hidden = true;
  status.textContent = '未发现可合并的新版本。如评审清单或岗位已在后台更新，请刷新页面后重新核对；本次填写仍保留在页面上。';
  updateSaveButton();
}

byId('conflict-retry').addEventListener('click', async () => {
  const button = byId('conflict-retry');
  button.disabled = true;
  try {
    await refreshLatestConflict();
  } catch (error) {
    status.textContent = error.message || '读取最新记录失败，请重试。';
  } finally {
    button.disabled = false;
  }
});

byId('rebase').addEventListener('click', () => {
  const { merged, mergedNotes, state } = mergeDraft(conflict);
  active.version = conflict.version;
  active.base = state.values;
  active.baseCompleted = conflict.completed === true && notesComplete(state.lineageNotes);
  active.completed = false;
  active.legacy = state.legacy;
  active.priorOptions = new Map([...active.priorOptions, ...state.priorOptions]);
  active.values = merged;
  active.baseLineageNotes = state.lineageNotes;
  active.lineageNotes = mergedNotes;
  drafts.delete(active.id);
  conflict = null;
  conflictRecovery = false;
  completionIntent = null;
  byId('conflict').hidden = true;
  showCells();
  renderLineage();
  remember();
  status.textContent = hasMultipleA() ? multipleAMessage : '已合并本次填写。请重新核对矩阵及完成状态。';
});

editor.addEventListener('submit', async event => {
  event.preventDefault();
  if (!active || saving || conflict || hasMultipleA()) return;
  const draft = drafts.get(active.id);
  if (!draft) return;
  const field = catalog.fields.find(item => item.id === active.id);
  saving = true;
  candidateBrowser.setBusy(true);
  candidateCurrent.disabled = true;
  completion.disabled = nextTask.disabled = true;
  batchSearch.disabled = batchStatus.disabled = batchSelect.disabled = lineageFields.disabled = true;
  showBatchTasks();
  tableSearch.disabled = fieldSearch.disabled = true;
  systemSelect.disabled = tableSelect.disabled = fieldSelect.disabled = byId('matrix').disabled = save.disabled = true;
  status.textContent = '正在保存。';
  try {
    const { review } = await request(pathFor(active.id), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(reviewPayload(field, catalog, draft, active.references)),
    });
    drafts.delete(active.id);
    setActive(active.id, review);
    status.textContent = review.completed ? '已保存，已计入完成' : '已保存，待现场确认';
    refreshProgress();
  } catch (error) {
    status.textContent = error.message || '保存失败，本次填写已保留。';
    if (error.status === 409) {
      const latest = await request(pathFor(active.id)).catch(() => null);
      if (latest === null) {
        showConflictRecovery('其他窗口可能已保存新版本，但读取最新记录失败。本次填写仍保留在页面上，可重试读取或刷新页面。');
      } else if (latest.review?.version > active.version) {
        showConflictMerge(latest.review);
      } else {
        byId('conflict').hidden = true;
        status.textContent = error.message +
          ' 本次填写仍保留在页面上；如评审清单或岗位已在后台更新，请刷新页面后重新核对。';
      }
    }
  } finally {
    saving = false;
    candidateBrowser.setBusy(false);
    lineageFields.disabled = false;
    batchSearch.disabled = batchStatus.disabled = batchSelect.disabled = false;
    showBatchTasks();
    tableSearch.disabled = fieldSearch.disabled = false;
    systemSelect.disabled = tableSelect.disabled = fieldSelect.disabled = byId('matrix').disabled = false;
    showTableOptions();
    showFieldOptions();
    updateSaveButton();
  }
});

window.addEventListener('beforeunload', event => {
  if (drafts.size) event.preventDefault();
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (document.querySelector('dialog[open]')) return;
    if (comparison.isOpen) comparison.saveAll();
    else if (!save.disabled && active) editor.requestSubmit();
  }
});
function syncPicker(field) {
  systemSelect.value = field.system;
  tableSearch.value = fieldSearch.value = '';
  showTableOptions();
  tableSelect.value = field.table;
  showFieldOptions();
  fieldSelect.value = field.id;
}
function openField(field) {
  if (!comparison.hide()) return;
  syncPicker(field);
  return selectField(field.id);
}

refreshProgress();
let catalogLoading = false;

async function initializeCatalog() {
  if (catalogLoading) return;
  catalogLoading = true;
  byId('retry-catalog').hidden = true;
  byId('field-context').textContent = '正在读取字段清单…';
  byId('load-message').textContent = '正在读取字段清单…';
  try {
    const data = await request('/api/fields');
    catalog = data;
    data.collection.batches ??= [{ id: 'outline-revision', name: data.collection.name, fieldIds: Object.keys(data.collection.tasks) }];
    batchSelect.replaceChildren(new Option('请选择评审清单', ''),
      ...data.collection.batches.map(batch => new Option(batchCaption(batch) + ' · ' + batch.fieldIds.length + ' 项', batch.id)));
    batchSelect.disabled = false;
    chooseBatch(activeBatchId);
    for (const option of data.positionCatalog.options) currentPositions.set(option.id, option);
    const departments = new Set(data.positionCatalog.options.map(option => option.department));
    departmentFilter.replaceChildren(new Option('全部部门', ''),
      ...[...departments].map(department => new Option(department, department)));
    const systems = new Set(data.fields.map(field => field.system));
    setOptions(systemSelect, '请选择系统', [...systems].map(system => new Option(system, system)));
    batchSearch.disabled = batchStatus.disabled = false;
    showBatchTasks();
    byId('load-message').textContent = '';
    byId('catalog-title').textContent = '从全部 ' + countFormat.format(data.fields.length) + ' 个字段中选择';
    const requested = new URLSearchParams(window.location.search).get('field');
    if (requested === null) {
      byId('field-context').textContent = '全部字段';
      byId('field-title').textContent = '选择要评审的字段';
      openCatalog();
      return;
    }
    const field = data.fields.find(option => option.id === requested);
    if (!field) {
      byId('field-title').textContent = '未找到字段';
      byId('field-context').textContent = '字段底册';
      byId('field-description').textContent = '';
      byId('load-message').textContent = '当前底册未找到链接指定的字段，请从全部字段中重新选择。';
      return;
    }
    await openField(field);
  } catch (error) {
    byId('field-context').textContent = '字段底册';
    byId('load-message').textContent = error.message || '无法读取字段清单。';
    byId('retry-catalog').hidden = false;
  } finally {
    catalogLoading = false;
  }
}

byId('retry-catalog').addEventListener('click', () => {
  refreshProgress();
  initializeCatalog();
});

initializeCatalog();
