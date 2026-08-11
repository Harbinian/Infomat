'use strict';

const state = { identity: null, csrf: '', tasks: [], activeTaskId: null, context: null, answers: {}, revision: 0, directory: null, saveTimer: null, savePromise: null };
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
    button.onclick = () => openTask(task.taskId);
    root.append(button);
  });
  if (!state.tasks.length) root.innerHTML = '<p class="message">当前没有分配给你的填报任务。</p>';
}

async function openTask(taskId) {
  if (state.saveTimer) clearTimeout(state.saveTimer);
  state.activeTaskId = taskId;
  state.context = await api(`/api/v1/tasks/${taskId}`);
  state.answers = structuredClone(state.context.submission?.answers || {});
  state.revision = state.context.submission?.revision || 0;
  renderTasks();
  renderForm();
}

function renderForm() {
  const { task, schema, submission, files } = state.context;
  const editable = task.status === 'open' && submission?.status !== 'submitted';
  const submitted = submission?.status === 'submitted';
  $('#formArea').innerHTML = `
    <div class="form-head"><div><span class="status ${task.status}">${statusText(task.status)}</span><h2>${escapeHtml(task.name)}</h2><p>${escapeHtml(task.ownerDepartmentName || '')} · ${escapeHtml(schema.title)}</p></div><div><span id="saveState" class="save-state">${submission ? `服务器草稿修订 ${state.revision}` : '尚未开始'}</span></div></div>
    ${task.status !== 'open' ? '<div class="notice">当前任务不在填报时间内，答卷只能查看。</div>' : ''}
    ${submitted ? '<div class="notice">答卷已提交并计入完成。截止前如需修改，请先选择“修改已提交内容”。</div>' : ''}
    <div id="errorSummary"></div>
    <form id="answerForm">${schema.sections.map(section => renderSection(section, editable, files)).join('')}</form>
    <div class="form-actions"><span class="save-state">草稿只保存在服务器，不使用浏览器本地保存。</span><div>${submitted && task.status === 'open' ? '<button id="editButton">修改已提交内容</button>' : ''}${editable ? '<button id="saveButton">保存草稿</button> <button id="submitButton" class="primary">提交</button>' : ''}</div></div>`;
  bindFormEvents(editable);
}

function renderSection(section, editable, files) {
  return `<section class="section"><h3>${escapeHtml(section.title)}</h3>${section.description ? `<p class="section-description">${escapeHtml(section.description)}</p>` : ''}${section.fields.map(field => renderField(field, editable, files.filter(file => file.fieldKey === field.fieldKey))).join('')}</section>`;
}

function renderField(field, editable, files) {
  const value = state.answers[field.fieldKey];
  const disabled = editable ? '' : 'disabled';
  const label = `<span class="${field.required ? 'required' : ''}">${escapeHtml(field.label)}</span>${field.helpText ? `<span class="help">${escapeHtml(field.helpText)}</span>` : ''}`;
  let control = '';
  if (field.type === 'short_text') control = `<input data-field="${field.fieldKey}" value="${escapeAttribute(value || '')}" ${disabled}>`;
  else if (field.type === 'long_text') control = `<textarea data-field="${field.fieldKey}" rows="5" ${disabled}>${escapeHtml(value || '')}</textarea>`;
  else if (field.type === 'integer' || field.type === 'decimal') control = `<input data-field="${field.fieldKey}" type="number" ${field.type === 'integer' ? 'step="1"' : 'step="any"'} value="${value ?? ''}" ${disabled}>`;
  else if (field.type === 'date') control = `<input data-field="${field.fieldKey}" type="date" value="${escapeAttribute(value || '')}" ${disabled}>`;
  else if (field.type === 'datetime') control = `<input data-field="${field.fieldKey}" type="datetime-local" value="${escapeAttribute(value ? String(value).slice(0, 16) : '')}" ${disabled}>`;
  else if (field.type === 'boolean') control = `<select data-field="${field.fieldKey}" ${disabled}><option value="">请选择</option><option value="true" ${value === true ? 'selected' : ''}>是</option><option value="false" ${value === false ? 'selected' : ''}>否</option></select>`;
  else if (field.type === 'single_choice') control = `<div class="choice-list">${field.options.map(option => `<label><input data-field="${field.fieldKey}" name="${field.fieldKey}" type="radio" value="${option.optionKey}" ${value === option.optionKey ? 'checked' : ''} ${disabled}> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'multiple_choice') control = `<div class="choice-list">${field.options.map(option => `<label><input data-field="${field.fieldKey}" type="checkbox" value="${option.optionKey}" ${Array.isArray(value) && value.includes(option.optionKey) ? 'checked' : ''} ${disabled}> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'person') control = `<select data-field="${field.fieldKey}" data-entity="person" ${disabled}>${entityOptions('person', value)}</select>`;
  else if (field.type === 'department') control = `<select data-field="${field.fieldKey}" data-entity="department" ${disabled}>${entityOptions('department', value)}</select>`;
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
    $('#saveButton').onclick = () => saveDraft().catch(showError);
    $('#submitButton').onclick = () => submit().catch(showError);
    document.querySelectorAll('[data-upload-field]').forEach(input => input.onchange = () => uploadFile(input).catch(showError));
    document.querySelectorAll('[data-remove-file]').forEach(button => button.onclick = () => removeFile(button).catch(showError));
  }
  if ($('#editButton')) $('#editButton').onclick = () => editSubmitted().catch(showError);
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
  const field = state.context.schema.sections.flatMap(section => section.fields).find(item => item.fieldKey === fieldKey);
  if (!field) return;
  if (field.type === 'multiple_choice') state.answers[fieldKey] = [...document.querySelectorAll(`[data-field="${fieldKey}"]:checked`)].map(input => input.value);
  else if (field.type === 'single_choice') state.answers[fieldKey] = document.querySelector(`[data-field="${fieldKey}"]:checked`)?.value || '';
  else if (field.type === 'boolean') state.answers[fieldKey] = target.value === '' ? '' : target.value === 'true';
  else if (field.type === 'integer' || field.type === 'decimal') state.answers[fieldKey] = target.value === '' ? '' : Number(target.value);
  else if (field.type === 'person') {
    const row = state.directory.people.find(item => Number(item.personId) === Number(target.value));
    state.answers[fieldKey] = row ? { personId: row.personId, employeeNo: row.employeeNo, personName: row.personName } : '';
  } else if (field.type === 'department') {
    const row = state.directory.departments.find(item => Number(item.departmentId) === Number(target.value));
    state.answers[fieldKey] = row ? { departmentId: row.departmentId, departmentName: row.name } : '';
  } else state.answers[fieldKey] = target.value;
  setSaveState('内容有变化，正在等待自动保存…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => saveDraft().catch(showError), 700);
}

async function saveDraft() {
  if (state.savePromise) return await state.savePromise;
  if (!state.context || state.context.submission?.status === 'submitted') return;
  setSaveState('正在保存到服务器…');
  state.savePromise = (async () => {
    const result = await api(`/api/v1/tasks/${state.activeTaskId}/submission`, { method: 'PUT', body: { expectedRevision: state.revision, answers: state.answers } });
    state.revision = result.submission.revision;
    state.context.submission = { ...(state.context.submission || {}), ...result.submission, answers: structuredClone(state.answers) };
    setSaveState(`已保存 · 修订 ${state.revision}`);
  })();
  try { return await state.savePromise; }
  finally { state.savePromise = null; }
}

async function submit() {
  clearTimeout(state.saveTimer);
  await saveDraft();
  if (!confirm('提交后将计入已完成。截止前仍可重新编辑，确认提交？')) return;
  const result = await api(`/api/v1/tasks/${state.activeTaskId}/submit`, { method: 'POST', body: { expectedRevision: state.revision } });
  state.revision = result.submission.revision;
  showMessage('答卷已提交');
  await Promise.all([loadTasks(), openTask(state.activeTaskId)]);
}

async function editSubmitted() {
  if (!confirm('重新编辑后，答卷会暂时恢复为草稿，重新提交后才计入已完成。确认修改？')) return;
  const result = await api(`/api/v1/tasks/${state.activeTaskId}/edit`, { method: 'POST', body: { expectedRevision: state.revision } });
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
  if (err.code === 'REVISION_CONFLICT') setSaveState('检测到其他页面已更新答卷。当前页面内容仍保留，请核对后刷新。');
}

function showMessage(message, error = false) { $('#globalMessage').textContent = message || ''; $('#globalMessage').style.color = error ? '#a12f2f' : '#39714b'; }
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
api('/api/v1/auth/me').then(result => enter(result.identity)).catch(() => {});
