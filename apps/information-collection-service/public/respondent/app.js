'use strict';

const state = { identity: null, csrf: '', tasks: [], activeTaskId: null, context: null, answers: {}, revision: 0, directory: null, saveTimer: null, savePromise: null, saveQueued: false, dirty: false, conflict: null, lastDetailPaste: null };
const $ = selector => document.querySelector(selector);

async function api(url, options = {}) {
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && !state.csrf && url !== '/api/v1/auth/login') {
    const response = await fetch('/api/v1/auth/csrf-token');
    if (!response.ok) throw new Error('页面登录状态已失效');
    state.csrf = (await response.json()).csrfToken;
  }
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && url !== '/api/v1/auth/login') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(url, { ...options, method, headers, body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error || `请求失败（${response.status}）`);
    err.code = body.code; err.details = body.details;
    throw err;
  }
  return body;
}

async function enter(identity) {
  state.identity = identity;
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#identityText').textContent = `${identity.personName} · ${identity.departmentName || '未分配部门'}`;
  await loadTasks();
}

async function loadTasks() {
  state.tasks = (await api('/api/v1/tasks')).tasks;
  renderTasks();
}

function renderTasks() {
  const root = $('#taskList');
  root.innerHTML = '';
  state.tasks.forEach(task => {
    const button = document.createElement('button');
    button.className = `task-card ${state.activeTaskId === task.taskId ? 'active' : ''}`;
    button.innerHTML = `<strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.ownerDepartmentName || '')}</small><small>${formatTime(task.openAt)}${task.dueAt ? ` 至 ${formatTime(task.dueAt)}` : ' 起，未设置截止时间'}</small><span class="status ${task.submissionStatus}">${statusText(task.submissionStatus)}</span>`;
    button.onclick = () => openTask(task.taskId).catch(showError);
    root.append(button);
  });
  if (!state.tasks.length) root.innerHTML = '<p class="message">当前没有分配给你的填报任务。</p>';
}

async function openTask(taskId) {
  if (state.activeTaskId) {
    if (state.conflict) {
      showMessage('请先处理当前答卷的版本冲突，再重新打开或切换任务。', true);
      return;
    }
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = null;
    if (state.dirty || state.savePromise) await saveDraft();
    if (state.conflict) return;
  }
  state.activeTaskId = taskId;
  state.context = await api(`/api/v1/tasks/${taskId}`);
  state.answers = structuredClone(state.context.submission?.answers || {});
  ensureDetailRows();
  state.revision = state.context.submission?.revision || 0;
  state.dirty = false;
  state.conflict = null;
  state.lastDetailPaste = null;
  renderTasks();
  renderForm();
}

function renderForm() {
  const { task, schema, submission, files } = state.context;
  const editable = task.status === 'open' && submission?.status !== 'submitted';
  const submitted = submission?.status === 'submitted';
  $('#formArea').innerHTML = `
    <div class="form-head"><div class="form-title-line"><span class="status ${task.status}">${statusText(task.status)}</span><div><h2>${escapeHtml(task.name)}</h2><p>${escapeHtml(task.ownerDepartmentName || '')} · ${escapeHtml(schema.title)}</p></div></div><div><span id="saveState" class="save-state">${submission ? `已同步修订 ${state.revision}` : '尚未开始'}</span></div></div>
    ${task.status !== 'open' ? '<div class="notice">当前任务不在填报时间内，答卷只能查看。</div>' : ''}
    ${submitted ? '<div class="notice">答卷已提交并计入完成。截止前如需修改，请先选择“修改已提交内容”。</div>' : ''}
    ${renderConflictNotice()}
    <div id="errorSummary"></div>
    <form id="answerForm">${schema.sections.map(section => renderSection(section, editable, files)).join('')}</form>
    <div class="form-actions"><span class="save-state">草稿只保存在服务器，不使用浏览器本地保存。</span><div>${submitted && task.status === 'open' ? '<button id="editButton">修改已提交内容</button>' : ''}${editable ? '<button id="saveButton">保存草稿</button> <button id="submitButton" class="primary">提交</button>' : ''}</div></div>`;
  bindFormEvents(editable);
}

function renderConflictNotice() {
  if (!state.conflict || state.conflict.taskId !== state.activeTaskId) return '';
  const serverRevision = state.conflict.serverContext?.submission?.revision;
  const savedAt = state.conflict.serverContext?.submission?.lastSavedAt;
  const serverSubmitted = state.conflict.serverContext?.submission?.status === 'submitted';
  const serverWritable = !serverSubmitted && state.conflict.serverContext?.task?.status === 'open';
  const message = serverSubmitted
    ? `服务器当前为已提交的修订 ${serverRevision}${savedAt ? `，保存时间 ${formatTime(savedAt)}` : ''}。本页不能直接覆盖已提交答卷；采用服务器内容后，可以按正常流程重新编辑。`
    : !serverWritable
      ? `服务器当前为修订 ${serverRevision}${savedAt ? `，保存时间 ${formatTime(savedAt)}` : ''}，任务已不能继续填写。本页不能覆盖服务器内容。`
    : `服务器当前为修订 ${serverRevision}${savedAt ? `，保存时间 ${formatTime(savedAt)}` : ''}。请选择保留哪一版后再继续编辑。`;
  return `<div class="conflict-notice" role="alert"><div><strong>检测到其他页面更新了同一答卷</strong><p>本页内容尚未丢失。${message}</p></div><div class="conflict-actions"><button type="button" id="useServerVersion">采用服务器内容</button>${serverWritable ? '<button type="button" id="keepLocalVersion" class="primary">保留本页内容并保存</button>' : ''}</div></div>`;
}

function ensureDetailRows() {
  const sections = state.context?.schema.sections.filter(section => section.kind === 'detail') || [];
  if (!sections.length) return;
  if (!state.answers.__detailRows || typeof state.answers.__detailRows !== 'object' || Array.isArray(state.answers.__detailRows)) state.answers.__detailRows = {};
  sections.forEach(section => {
    if (!Array.isArray(state.answers.__detailRows[section.sectionKey])) state.answers.__detailRows[section.sectionKey] = [];
    const rows = state.answers.__detailRows[section.sectionKey];
    while (rows.length < Number(section.minRows || 0)) rows.push({ rowKey: crypto.randomUUID(), values: {} });
  });
}

function renderSection(section, editable, files) {
  if (section.kind === 'detail') return renderDetailSection(section, editable);
  return `<section class="section"><h3>${escapeHtml(section.title)}</h3>${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ''}${section.fields.map(field => renderField(field, editable, files.filter(file => file.fieldKey === field.fieldKey), state.answers[field.fieldKey])).join('')}</section>`;
}

function renderDetailSection(section, editable) {
  const rows = state.answers.__detailRows?.[section.sectionKey] || [];
  const maxRows = Number(section.maxRows || 100);
  const displayRows = editable && rows.length < maxRows ? [...rows, { rowKey: '__new__', values: {} }] : rows;
  const canUndoPaste = editable && state.lastDetailPaste?.taskId === state.activeTaskId && state.lastDetailPaste?.sectionKey === section.sectionKey;
  return `<section class="section detail-section"><div class="detail-section-head"><div><h3>${escapeHtml(section.title)}</h3>${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ''}</div><span class="detail-count">${rows.length}/${maxRows} 行</span></div>${editable ? '<p class="detail-paste-help">可以从 Excel 复制连续单元格，点击下方起始单元格后直接粘贴。系统会先检查整块数据，检查通过后再一次性填入。</p>' : ''}<div class="detail-grid-shell"><table class="detail-grid"><thead><tr><th class="detail-index-column">序号</th>${section.fields.map(field => `<th><span class="${field.required ? 'required' : ''}">${escapeHtml(field.label)}</span>${field.helpText ? `<small>${escapeHtml(field.helpText)}</small>` : ''}</th>`).join('')}<th class="detail-action-column">操作</th></tr></thead><tbody>${displayRows.map((row, index) => `<tr class="${row.rowKey === '__new__' ? 'detail-ghost-row' : ''}"><th class="detail-index-column" scope="row">${index + 1}</th>${section.fields.map((field, columnIndex) => `<td>${renderDetailCell(field, editable, row.values?.[field.fieldKey], section.sectionKey, row.rowKey, index, columnIndex)}</td>`).join('')}<td class="detail-action-column">${editable && row.rowKey !== '__new__' ? `<div class="detail-row-actions"><button type="button" title="上移" aria-label="上移第 ${index + 1} 行" data-detail-action="up" data-section-key="${section.sectionKey}" data-row-key="${row.rowKey}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" title="下移" aria-label="下移第 ${index + 1} 行" data-detail-action="down" data-section-key="${section.sectionKey}" data-row-key="${row.rowKey}" ${index === rows.length - 1 ? 'disabled' : ''}>↓</button><button type="button" title="复制" aria-label="复制第 ${index + 1} 行" data-detail-action="copy" data-section-key="${section.sectionKey}" data-row-key="${row.rowKey}" ${rows.length >= maxRows ? 'disabled' : ''}>⧉</button><button type="button" class="danger-text" title="删除" aria-label="删除第 ${index + 1} 行" data-detail-action="remove" data-section-key="${section.sectionKey}" data-row-key="${row.rowKey}">×</button></div>` : '<span class="detail-empty-mark">—</span>'}</td></tr>`).join('')}</tbody></table></div>${editable ? `<div class="detail-toolbar"><button type="button" class="detail-add" data-detail-action="add" data-section-key="${section.sectionKey}" ${rows.length >= maxRows ? 'disabled' : ''}>＋ 新增一行</button>${canUndoPaste ? `<button type="button" data-detail-action="undo-paste" data-section-key="${section.sectionKey}">撤销上次粘贴</button>` : ''}<span>粘贴范围不能超过 ${maxRows} 行；不会读取或上传 Excel 文件。</span></div>` : ''}</section>`;
}

function renderDetailCell(field, editable, value, sectionKey, rowKey, rowIndex, columnIndex) {
  const disabled = editable ? '' : 'disabled';
  const attributes = `data-field="${field.fieldKey}" data-detail-section="${sectionKey}" data-row-key="${rowKey}" data-detail-cell data-row-index="${rowIndex}" data-column-index="${columnIndex}" aria-label="第 ${rowIndex + 1} 行，${escapeAttribute(field.label)}"`;
  if (field.type === 'long_text') return `<textarea ${attributes} rows="1" ${disabled}>${escapeHtml(value || '')}</textarea>`;
  if (field.type === 'integer' || field.type === 'decimal') return `<input ${attributes} type="number" ${field.type === 'integer' ? 'step="1"' : 'step="any"'} value="${value ?? ''}" ${disabled}>`;
  if (field.type === 'date') return `<input ${attributes} type="date" value="${escapeAttribute(value || '')}" ${disabled}>`;
  if (field.type === 'datetime') return `<input ${attributes} type="datetime-local" value="${escapeAttribute(value ? String(value).slice(0, 16) : '')}" ${disabled}>`;
  if (field.type === 'boolean') return `<select ${attributes} ${disabled}><option value="">请选择</option><option value="true" ${value === true ? 'selected' : ''}>是</option><option value="false" ${value === false ? 'selected' : ''}>否</option></select>`;
  if (field.type === 'single_choice') return `<select ${attributes} ${disabled}><option value="">请选择</option>${field.options.map(option => `<option value="${option.optionKey}" ${value === option.optionKey ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  if (field.type === 'multiple_choice') return `<select ${attributes} multiple title="按住 Ctrl 可选择多项" ${disabled}>${field.options.map(option => `<option value="${option.optionKey}" ${Array.isArray(value) && value.includes(option.optionKey) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  if (field.type === 'person') return `<select ${attributes} data-entity="person" ${disabled}>${entityOptions('person', value)}</select>`;
  if (field.type === 'department') return `<select ${attributes} data-entity="department" ${disabled}>${entityOptions('department', value)}</select>`;
  return `<input ${attributes} value="${escapeAttribute(value || '')}" ${disabled}>`;
}

function renderField(field, editable, files, value, detail = null) {
  const disabled = editable ? '' : 'disabled';
  const detailAttributes = detail ? ` data-detail-section="${detail.sectionKey}" data-row-key="${detail.rowKey}"` : '';
  const fieldAttribute = `data-field="${field.fieldKey}"${detailAttributes}`;
  const inputName = detail ? `${field.fieldKey}-${detail.rowKey}` : field.fieldKey;
  const label = `<span class="${field.required ? 'required' : ''}">${escapeHtml(field.label)}</span>${field.helpText ? `<span class="help">${escapeHtml(field.helpText)}</span>` : ''}`;
  let control = '';
  if (field.type === 'short_text') control = `<input ${fieldAttribute} value="${escapeAttribute(value || '')}" ${disabled}>`;
  else if (field.type === 'long_text') control = `<textarea ${fieldAttribute} rows="5" ${disabled}>${escapeHtml(value || '')}</textarea>`;
  else if (field.type === 'integer' || field.type === 'decimal') control = `<input ${fieldAttribute} type="number" ${field.type === 'integer' ? 'step="1"' : 'step="any"'} value="${value ?? ''}" ${disabled}>`;
  else if (field.type === 'date') control = `<input ${fieldAttribute} type="date" value="${escapeAttribute(value || '')}" ${disabled}>`;
  else if (field.type === 'datetime') control = `<input ${fieldAttribute} type="datetime-local" value="${escapeAttribute(value ? String(value).slice(0, 16) : '')}" ${disabled}>`;
  else if (field.type === 'boolean') control = `<select ${fieldAttribute} ${disabled}><option value="">请选择</option><option value="true" ${value === true ? 'selected' : ''}>是</option><option value="false" ${value === false ? 'selected' : ''}>否</option></select>`;
  else if (field.type === 'single_choice') control = `<div class="choice-list">${field.options.map(option => `<label><input ${fieldAttribute} name="${inputName}" type="radio" value="${option.optionKey}" ${value === option.optionKey ? 'checked' : ''} ${disabled}> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'multiple_choice') control = `<div class="choice-list">${field.options.map(option => `<label><input ${fieldAttribute} type="checkbox" value="${option.optionKey}" ${Array.isArray(value) && value.includes(option.optionKey) ? 'checked' : ''} ${disabled}> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'person') control = `<select ${fieldAttribute} data-entity="person" ${disabled}>${entityOptions('person', value)}</select>`;
  else if (field.type === 'department') control = `<select ${fieldAttribute} data-entity="department" ${disabled}>${entityOptions('department', value)}</select>`;
  else if (field.type === 'attachment') control = `<div class="attachment-box"><div>${files.map(file => `<div class="file-row"><a href="/api/v1/files/${file.fileId}">${escapeHtml(file.originalName)}</a><span>${formatBytes(file.sizeBytes)} ${editable ? `<button type="button" data-remove-file="${file.fileId}" data-field-key="${field.fieldKey}">移除</button>` : ''}</span></div>`).join('') || '<p class="help">尚未上传附件</p>'}</div>${editable ? `<input type="file" data-upload-field="${field.fieldKey}" accept=".pdf,.png,.jpg,.jpeg,.docx,.xlsx,.txt,.csv">` : ''}</div>`;
  return `<label class="field" data-field-wrap="${field.fieldKey}">${label}${control}</label>`;
}

function entityOptions(type, value) {
  const rows = type === 'person' ? state.directory?.people || [] : state.directory?.departments || [];
  const idKey = type === 'person' ? 'personId' : 'departmentId';
  const currentId = value?.[idKey];
  const label = type === 'person' ? row => `${row.employeeNo} · ${row.personName} · ${row.departmentName || ''}` : row => row.name;
  return `<option value="">请选择</option>${rows.map(row => `<option value="${row[idKey]}" ${Number(currentId) === Number(row[idKey]) ? 'selected' : ''}>${escapeHtml(label(row))}</option>`).join('')}`;
}

async function ensureDirectory() {
  if (!state.directory) state.directory = await api('/api/v1/directory');
}

function bindFormEvents(editable) {
  if (editable) {
    $('#answerForm').addEventListener('input', readAnswersAndSchedule);
    $('#answerForm').addEventListener('change', readAnswersAndSchedule);
    $('#answerForm').addEventListener('paste', handleDetailPaste);
    $('#answerForm').addEventListener('keydown', handleDetailKeydown);
    $('#saveButton').onclick = () => saveDraft().catch(showError);
    $('#submitButton').onclick = () => submit().catch(showError);
    document.querySelectorAll('[data-detail-action]').forEach(button => button.onclick = () => changeDetailRows(button));
    document.querySelectorAll('[data-upload-field]').forEach(input => input.onchange = () => uploadFile(input).catch(showError));
    document.querySelectorAll('[data-remove-file]').forEach(button => button.onclick = () => removeFile(button).catch(showError));
  }
  if ($('#editButton')) $('#editButton').onclick = () => editSubmitted().catch(showError);
  if ($('#useServerVersion')) $('#useServerVersion').onclick = useServerVersion;
  if ($('#keepLocalVersion')) $('#keepLocalVersion').onclick = () => keepLocalVersion().catch(showError);
  ensureDirectory().then(() => {
    if (!state.context || state.context.task.taskId !== state.activeTaskId) return;
    const needsRerender = state.context.schema.sections.some(section => section.fields.some(field => ['person', 'department'].includes(field.type)));
    if (needsRerender && !document.querySelector('[data-entity] option:nth-child(2)')) renderForm();
  }).catch(showError);
}

function readAnswersAndSchedule(event) {
  const target = event.target;
  const fieldKey = target.dataset.field;
  if (!fieldKey) return;
  const section = target.dataset.detailSection
    ? state.context.schema.sections.find(item => item.sectionKey === target.dataset.detailSection && item.kind === 'detail')
    : state.context.schema.sections.find(item => item.kind !== 'detail' && item.fields.some(field => field.fieldKey === fieldKey));
  const field = section?.fields.find(item => item.fieldKey === fieldKey);
  if (!field) return;
  if (target.dataset.detailSection && target.dataset.rowKey === '__new__') {
    const rows = state.answers.__detailRows[target.dataset.detailSection];
    const newRow = { rowKey: crypto.randomUUID(), values: {} };
    rows.push(newRow);
    const tableRow = target.closest('tr');
    tableRow?.classList.remove('detail-ghost-row');
    tableRow?.querySelectorAll('[data-row-key="__new__"]').forEach(control => { control.dataset.rowKey = newRow.rowKey; });
  }
  const detailRow = target.dataset.detailSection
    ? state.answers.__detailRows?.[target.dataset.detailSection]?.find(row => row.rowKey === target.dataset.rowKey)
    : null;
  const values = detailRow?.values || state.answers;
  const detailSelector = detailRow ? `[data-detail-section="${target.dataset.detailSection}"][data-row-key="${target.dataset.rowKey}"]` : ':not([data-detail-section])';
  if (field.type === 'multiple_choice') values[fieldKey] = target.matches('select[multiple]') ? [...target.selectedOptions].map(option => option.value) : [...document.querySelectorAll(`[data-field="${fieldKey}"]${detailSelector}:checked`)].map(input => input.value);
  else if (field.type === 'single_choice') values[fieldKey] = target.matches('select') ? target.value : document.querySelector(`[data-field="${fieldKey}"]${detailSelector}:checked`)?.value || '';
  else if (field.type === 'boolean') values[fieldKey] = target.value === '' ? '' : target.value === 'true';
  else if (field.type === 'integer' || field.type === 'decimal') values[fieldKey] = target.value === '' ? '' : Number(target.value);
  else if (field.type === 'person') {
    const row = state.directory.people.find(item => Number(item.personId) === Number(target.value));
    values[fieldKey] = row ? { personId: row.personId, employeeNo: row.employeeNo, personName: row.personName } : '';
  } else if (field.type === 'department') {
    const row = state.directory.departments.find(item => Number(item.departmentId) === Number(target.value));
    values[fieldKey] = row ? { departmentId: row.departmentId, departmentName: row.name } : '';
  } else values[fieldKey] = target.value;
  if (target.dataset.detailSection) state.lastDetailPaste = null;
  scheduleSave();
}

async function handleDetailPaste(event) {
  const target = event.target.closest('[data-detail-cell]');
  if (!target) return;
  event.preventDefault();
  const text = event.clipboardData?.getData('text/plain') || '';
  const matrix = DetailGrid.parseClipboardGrid(text);
  const section = state.context.schema.sections.find(item => item.kind === 'detail' && item.sectionKey === target.dataset.detailSection);
  if (!section) return;
  let result;
  const rows = state.answers.__detailRows[section.sectionKey];
  const previousRows = structuredClone(rows);
  try {
    await ensureDirectory();
    result = DetailGrid.applyPastedGrid({
      section,
      rows,
      startRow: Number(target.dataset.rowIndex),
      startColumn: Number(target.dataset.columnIndex),
      matrix,
      directory: state.directory,
      createRowKey: () => crypto.randomUUID()
    });
  } catch (err) {
    showError(err);
    return;
  }
  if (result.errors) {
    const details = result.errors.slice(0, 5).map(item => item.row ? `Excel 第 ${item.row} 行第 ${item.column} 列（${item.fieldLabel}）：${item.message}` : item.message);
    if (result.errors.length > 5) details.push(`另有 ${result.errors.length - 5} 个错误`);
    showError(new Error(`未粘贴任何内容。${details.join('；')}`));
    return;
  }
  state.answers.__detailRows[section.sectionKey] = result.rows;
  state.lastDetailPaste = { taskId: state.activeTaskId, sectionKey: section.sectionKey, rows: previousRows };
  renderForm();
  showMessage(`已粘贴 ${result.pastedRows} 行 × ${result.pastedColumns} 列，正在保存草稿`);
  scheduleSave();
}

function handleDetailKeydown(event) {
  const target = event.target.closest('[data-detail-cell]');
  if (!target || event.key !== 'Enter' || target.matches('textarea, select')) return;
  event.preventDefault();
  const section = state.context.schema.sections.find(item => item.sectionKey === target.dataset.detailSection);
  const rowIndex = Number(target.dataset.rowIndex);
  const columnIndex = Number(target.dataset.columnIndex);
  let next = document.querySelector(`[data-detail-section="${section.sectionKey}"][data-row-index="${rowIndex + 1}"][data-column-index="${columnIndex}"]`);
  if (!next && state.answers.__detailRows[section.sectionKey].length < Number(section.maxRows || 100)) {
    state.answers.__detailRows[section.sectionKey].push({ rowKey: crypto.randomUUID(), values: {} });
    state.lastDetailPaste = null;
    renderForm();
    scheduleSave();
    next = document.querySelector(`[data-detail-section="${section.sectionKey}"][data-row-index="${rowIndex + 1}"][data-column-index="${columnIndex}"]`);
  }
  next?.focus();
}

function scheduleSave() {
  state.dirty = true;
  if (state.conflict) {
    setSaveState('版本冲突待处理，本页修改尚未保存');
    return;
  }
  setSaveState('有修改，等待自动保存…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    saveDraft().catch(showError);
  }, 700);
}

function changeDetailRows(button) {
  const section = state.context.schema.sections.find(item => item.sectionKey === button.dataset.sectionKey && item.kind === 'detail');
  if (!section) return;
  const rows = state.answers.__detailRows[section.sectionKey];
  const action = button.dataset.detailAction;
  if (action === 'undo-paste' && state.lastDetailPaste?.taskId === state.activeTaskId && state.lastDetailPaste?.sectionKey === section.sectionKey) {
    state.answers.__detailRows[section.sectionKey] = structuredClone(state.lastDetailPaste.rows);
    state.lastDetailPaste = null;
    renderForm();
    showMessage('已撤销上次粘贴，正在保存草稿');
    scheduleSave();
    return;
  }
  if (action === 'add') rows.push({ rowKey: crypto.randomUUID(), values: {} });
  else {
    const index = rows.findIndex(row => row.rowKey === button.dataset.rowKey);
    if (index < 0) return;
    if (action === 'remove') {
      if (!confirm(`确认删除“${section.title}”第 ${index + 1} 行？`)) return;
      rows.splice(index, 1);
    } else if (action === 'copy' && rows.length < Number(section.maxRows || 100)) rows.splice(index + 1, 0, { rowKey: crypto.randomUUID(), values: structuredClone(rows[index].values || {}) });
    else if (action === 'up' && index > 0) [rows[index - 1], rows[index]] = [rows[index], rows[index - 1]];
    else if (action === 'down' && index < rows.length - 1) [rows[index], rows[index + 1]] = [rows[index + 1], rows[index]];
  }
  state.lastDetailPaste = null;
  renderForm();
  scheduleSave();
}

async function saveDraft() {
  if (!state.context || state.context.submission?.status === 'submitted' || state.conflict) return;
  if (state.savePromise) {
    state.saveQueued = true;
    return await state.savePromise;
  }
  if (!state.dirty && state.context.submission) return;
  state.savePromise = (async () => {
    do {
      state.saveQueued = false;
      setSaveState('正在保存…');
      state.dirty = false;
      const taskId = state.activeTaskId;
      const answersSnapshot = structuredClone(state.answers);
      try {
        const result = await api(`/api/v1/tasks/${taskId}/submission`, { method: 'PUT', body: { expectedRevision: state.revision, answers: answersSnapshot } });
        if (state.activeTaskId !== taskId) return;
        state.revision = result.submission.revision;
        state.context.submission = { ...(state.context.submission || {}), ...result.submission, answers: answersSnapshot };
        setSaveState(`已保存 · 修订 ${state.revision}`);
      } catch (err) {
        state.dirty = true;
        if (err.code === 'REVISION_CONFLICT') {
          state.saveQueued = false;
          await handleRevisionConflict(taskId);
          return;
        }
        throw err;
      }
    } while (state.saveQueued);
  })();
  try { return await state.savePromise; }
  finally { state.savePromise = null; }
}

async function handleRevisionConflict(taskId) {
  if (state.activeTaskId !== taskId) return;
  const serverContext = await api(`/api/v1/tasks/${taskId}`);
  if (state.activeTaskId !== taskId) return;
  state.conflict = { taskId, serverContext };
  renderForm();
  showMessage('同一答卷已在其他页面保存。请选择保留服务器内容或本页内容。', true);
  setSaveState('版本冲突待处理，本页修改尚未保存');
}

function useServerVersion() {
  const serverContext = state.conflict?.serverContext;
  if (!serverContext) return;
  state.context = serverContext;
  state.answers = structuredClone(serverContext.submission?.answers || {});
  ensureDetailRows();
  state.revision = serverContext.submission?.revision || 0;
  state.dirty = false;
  state.conflict = null;
  state.lastDetailPaste = null;
  renderForm();
  showMessage(`已采用服务器修订 ${state.revision}`);
}

async function keepLocalVersion() {
  const serverContext = state.conflict?.serverContext;
  if (!serverContext) return;
  if (serverContext.submission?.status === 'submitted' || serverContext.task?.status !== 'open') {
    showMessage('服务器答卷当前不可直接覆盖。请采用服务器内容后按页面提供的操作继续处理。', true);
    return;
  }
  if (!confirm('此操作会用本页内容覆盖服务器上的较新草稿。确认保留本页内容并保存？')) return;
  state.context = { ...serverContext, submission: { ...(serverContext.submission || {}), answers: structuredClone(state.answers) } };
  state.revision = serverContext.submission?.revision || 0;
  state.conflict = null;
  state.dirty = true;
  renderForm();
  await saveDraft();
  if (!state.conflict) showMessage(`已保留本页内容并保存为修订 ${state.revision}`);
}

async function submit() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  await saveDraft();
  if (state.conflict) return;
  if (!confirm('提交后将计入已完成。截止前仍可重新编辑，确认提交？')) return;
  let result;
  try {
    result = await api(`/api/v1/tasks/${state.activeTaskId}/submit`, { method: 'POST', body: { expectedRevision: state.revision } });
  } catch (err) {
    if (err.code === 'REVISION_CONFLICT') {
      await handleRevisionConflict(state.activeTaskId);
      return;
    }
    throw err;
  }
  state.revision = result.submission.revision;
  showMessage('答卷已提交');
  await Promise.all([loadTasks(), openTask(state.activeTaskId)]);
}

async function editSubmitted() {
  if (!confirm('重新编辑后，答卷会暂时恢复为草稿，重新提交后才计入已完成。确认修改？')) return;
  let result;
  try {
    result = await api(`/api/v1/tasks/${state.activeTaskId}/edit`, { method: 'POST', body: { expectedRevision: state.revision } });
  } catch (err) {
    if (err.code === 'REVISION_CONFLICT') {
      await handleRevisionConflict(state.activeTaskId);
      return;
    }
    throw err;
  }
  state.revision = result.submission.revision;
  await Promise.all([loadTasks(), openTask(state.activeTaskId)]);
}

async function uploadFile(input) {
  const file = input.files?.[0];
  if (!file) return;
  const fieldKey = input.dataset.uploadField;
  const body = new FormData();
  body.append('fieldKey', fieldKey);
  body.append('file', file);
  setSaveState('正在上传并检查附件…');
  const result = await api(`/api/v1/tasks/${state.activeTaskId}/files`, { method: 'POST', body });
  state.context.files.push(result.file);
  const values = Array.isArray(state.answers[fieldKey]) ? state.answers[fieldKey] : [];
  state.answers[fieldKey] = [...values, result.file.fileId];
  await saveDraft();
  await openTask(state.activeTaskId);
}

async function removeFile(button) {
  if (!confirm('移除后，该附件仍保留审计记录，但不再属于当前答卷。确认移除？')) return;
  const result = await api(`/api/v1/tasks/${state.activeTaskId}/files/${button.dataset.removeFile}`, { method: 'DELETE', body: { expectedRevision: state.revision } });
  state.revision = result.file.revision;
  state.answers[button.dataset.fieldKey] = (state.answers[button.dataset.fieldKey] || []).filter(id => id !== result.file.fileId);
  await openTask(state.activeTaskId);
}

function showError(err) {
  const summary = $('#errorSummary');
  const message = err.details?.length ? `${err.message}：${err.details.map(item => item.message).join('；')}` : err.message;
  if (summary) summary.innerHTML = `<div class="error-summary">${escapeHtml(message)}</div>`;
  showMessage(message, true);
}

function showMessage(message, error = false) { const node = $('#globalMessage'); node.textContent = message || ''; node.classList.toggle('error', Boolean(error)); }
function setSaveState(message) { const node = $('#saveState'); if (node) node.textContent = message; }
function statusText(value) { return ({ scheduled: '未开始', open: '进行中', closed: '已关闭', cancelled: '已取消', draft: '草稿', submitted: '已提交', overdue: '逾期未提交', not_started: '未开始' })[value] || value; }
function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function formatBytes(value) { const size = Number(value || 0); return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`; }
function escapeHtml(value) { return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function escapeAttribute(value) { return escapeHtml(value); }

$('#loginForm').onsubmit = async event => {
  event.preventDefault();
  $('#loginMessage').textContent = '';
  try { const result = await api('/api/v1/auth/login', { method: 'POST', body: Object.fromEntries(new FormData(event.currentTarget)) }); await enter(result.identity); }
  catch (err) { $('#loginMessage').textContent = err.message; }
};
$('#logoutButton').onclick = async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); location.reload(); };
$('#refreshTasks').onclick = loadTasks;
api('/api/v1/auth/session').then(result => {
  if (result.authenticated && result.identity) return enter(result.identity);
}).catch(() => {});
