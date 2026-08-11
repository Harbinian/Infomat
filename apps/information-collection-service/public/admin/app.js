'use strict';

const FIELD_LABELS = {
  short_text: '短文本', long_text: '长文本', integer: '整数', decimal: '小数', date: '日期', datetime: '日期时间',
  single_choice: '单选', multiple_choice: '多选', boolean: '是/否', person: '人员', department: '部门', attachment: '附件'
};

const state = {
  identity: null, csrf: '', directory: { departments: [], people: [] }, forms: [], tasks: [], grants: [],
  activeForm: null, activeSectionKey: null, activeFieldKey: null, activeTaskId: null
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];

async function api(url, options = {}) {
  const method = options.method || 'GET';
  if (!['GET', 'HEAD'].includes(method) && !state.csrf && url !== '/api/v1/auth/login') {
    const tokenResponse = await fetch('/api/v1/auth/csrf-token');
    if (!tokenResponse.ok) throw new Error('页面登录状态已失效');
    state.csrf = (await tokenResponse.json()).csrfToken;
  }
  const headers = { ...(options.headers || {}) };
  if (options.body && !(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  if (!['GET', 'HEAD'].includes(method) && url !== '/api/v1/auth/login') headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(url, { ...options, method, headers, body: options.body && !(options.body instanceof FormData) ? JSON.stringify(options.body) : options.body });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(body.error || `请求失败（${response.status}）`);
    err.code = body.code;
    err.details = body.details;
    throw err;
  }
  return body;
}

function showMessage(message, error = false) {
  const node = $('#globalMessage');
  node.textContent = message || '';
  node.style.color = error ? '#a12f2f' : '#39714b';
}

function hasAdmin() {
  return state.identity?.grants.some(grant => grant.roleCode === 'collection_admin');
}

function manageableDepartments() {
  if (hasAdmin()) return state.directory.departments;
  const ids = new Set(state.identity.grants.filter(grant => grant.roleCode === 'collection_designer').map(grant => Number(grant.scopeDepartmentId)));
  return state.directory.departments.filter(item => ids.has(item.departmentId));
}

async function enterApp(identity) {
  state.identity = identity;
  $('#loginView').classList.add('hidden');
  $('#appView').classList.remove('hidden');
  $('#identityText').textContent = `${identity.personName} · ${identity.departmentName || '未分配部门'}`;
  if (!hasAdmin()) $('[data-tab="grants"]').classList.add('hidden');
  await loadDirectory();
  await Promise.all([loadForms(), loadTasks(), hasAdmin() ? loadGrants() : Promise.resolve()]);
}

async function loadDirectory() {
  state.directory = await api('/api/v1/admin/directory');
  fillSelect($('#createForm select[name="ownerDepartmentId"]'), manageableDepartments(), 'departmentId', 'name');
  fillSelect($('#publishForm select[name="departmentIds"]'), state.directory.departments, 'departmentId', 'name');
  fillSelect($('#publishForm select[name="personIds"]'), state.directory.people.filter(person => person.accountAvailable), 'personId', item => `${item.employeeNo} · ${item.personName} · ${item.departmentName || '未分配部门'}`);
  fillSelect($('#grantForm select[name="personId"]'), state.directory.people.filter(person => person.accountAvailable), 'personId', item => `${item.employeeNo} · ${item.personName}`);
  fillSelect($('#grantForm select[name="departmentId"]'), state.directory.departments, 'departmentId', 'name');
}

function fillSelect(select, rows, valueKey, label) {
  select.innerHTML = '';
  rows.forEach(row => {
    const option = document.createElement('option');
    option.value = row[valueKey];
    option.textContent = typeof label === 'function' ? label(row) : row[label];
    select.append(option);
  });
}

async function loadForms() {
  state.forms = (await api('/api/v1/admin/forms')).forms;
  renderFormList();
}

function renderFormList() {
  const root = $('#formList');
  root.innerHTML = '';
  state.forms.forEach(form => {
    const button = document.createElement('button');
    button.className = `item ${state.activeForm?.formId === form.formId ? 'active' : ''}`;
    button.innerHTML = `<strong>${escapeHtml(form.name)}</strong><small>${escapeHtml(form.ownerDepartmentName || '')} · 设计稿 v${form.draftRevision}</small>`;
    button.onclick = () => selectForm(form.formId);
    root.append(button);
  });
  if (!state.forms.length) root.innerHTML = '<p class="message">当前部门还没有表单。</p>';
}

async function selectForm(formId) {
  const { form } = await api(`/api/v1/admin/forms/${formId}`);
  state.activeForm = structuredClone(form);
  const sections = state.activeForm.draftSchema.sections || [];
  state.activeSectionKey = sections[0]?.sectionKey || null;
  state.activeFieldKey = sections[0]?.fields?.[0]?.fieldKey || null;
  $('#builderEmpty').classList.add('hidden');
  $('#builder').classList.remove('hidden');
  renderFormList();
  renderBuilder();
}

function currentSection() {
  return state.activeForm?.draftSchema.sections.find(section => section.sectionKey === state.activeSectionKey) || null;
}

function currentField() {
  return currentSection()?.fields.find(field => field.fieldKey === state.activeFieldKey) || null;
}

function renderBuilder() {
  const form = state.activeForm;
  $('#formCode').textContent = form.formCode;
  $('#formTitle').textContent = form.draftSchema.title;
  $('#formMeta').textContent = `${form.ownerDepartmentName} · 设计稿修订 ${form.draftRevision}`;
  const sectionSelect = $('#sectionSelect');
  sectionSelect.innerHTML = '';
  form.draftSchema.sections.forEach(section => {
    const option = document.createElement('option');
    option.value = section.sectionKey;
    option.textContent = section.title;
    option.selected = section.sectionKey === state.activeSectionKey;
    sectionSelect.append(option);
  });
  renderFields();
  renderFieldEditor();
}

function renderFields() {
  const root = $('#fieldList');
  root.innerHTML = '';
  const fields = currentSection()?.fields || [];
  fields.forEach((field, index) => {
    const item = document.createElement('button');
    item.className = `item ${field.fieldKey === state.activeFieldKey ? 'active' : ''}`;
    item.innerHTML = `<span><strong>${escapeHtml(field.label || '未命名字段')}</strong><small>${FIELD_LABELS[field.type]}${field.required ? ' · 必填' : ''}</small></span><span class="order-buttons"><span>↑↓</span></span>`;
    item.onclick = () => { state.activeFieldKey = field.fieldKey; renderFields(); renderFieldEditor(); };
    root.append(item);
  });
  if (!fields.length) root.innerHTML = '<p class="message">当前分区还没有字段。</p>';
}

function renderFieldEditor() {
  const field = currentField();
  $('#fieldEditorEmpty').classList.toggle('hidden', Boolean(field));
  $('#fieldEditor').classList.toggle('hidden', !field);
  if (!field) return;
  const form = $('#fieldEditor');
  $('#fieldKey').textContent = field.fieldKey;
  form.elements.label.value = field.label || '';
  form.elements.helpText.value = field.helpText || '';
  form.elements.required.checked = Boolean(field.required);
  form.elements.options.value = (field.options || []).map(option => option.label).join('\n');
  $('#optionsRow').classList.toggle('hidden', !['single_choice', 'multiple_choice'].includes(field.type));
  const useLength = ['short_text', 'long_text'].includes(field.type);
  form.elements.min.value = useLength ? field.validation?.minLength ?? '' : field.validation?.min ?? '';
  form.elements.max.value = useLength ? field.validation?.maxLength ?? '' : field.validation?.max ?? '';
}

function addSection() {
  const title = prompt('请输入分区名称');
  if (!title?.trim()) return;
  const section = { sectionKey: crypto.randomUUID(), title: title.trim().slice(0, 100), description: '', fields: [] };
  state.activeForm.draftSchema.sections.push(section);
  state.activeSectionKey = section.sectionKey;
  state.activeFieldKey = null;
  renderBuilder();
}

function addField() {
  const section = currentSection();
  if (!section) return showMessage('请先新增一个分区', true);
  const type = $('#newFieldType').value;
  const field = {
    fieldKey: crypto.randomUUID(), type, label: FIELD_LABELS[type], helpText: '', required: false,
    options: ['single_choice', 'multiple_choice'].includes(type) ? [{ optionKey: crypto.randomUUID(), label: '选项一' }] : [],
    validation: { minLength: null, maxLength: null, min: null, max: null, decimalPlaces: null, minDate: null, maxDate: null, maxFiles: 5 }
  };
  section.fields.push(field);
  state.activeFieldKey = field.fieldKey;
  renderBuilder();
}

function moveField(offset) {
  const section = currentSection();
  const index = section?.fields.findIndex(field => field.fieldKey === state.activeFieldKey) ?? -1;
  const target = index + offset;
  if (index < 0 || target < 0 || target >= section.fields.length) return;
  [section.fields[index], section.fields[target]] = [section.fields[target], section.fields[index]];
  renderFields();
}

async function saveDraft() {
  const result = await api(`/api/v1/admin/forms/${state.activeForm.formId}/draft`, {
    method: 'PUT', body: { expectedRevision: state.activeForm.draftRevision, schema: state.activeForm.draftSchema }
  });
  state.activeForm.draftRevision = result.draftRevision;
  state.activeForm.draftSchema = result.schema;
  showMessage('设计稿已保存');
  await loadForms();
  renderBuilder();
}

function openPublish() {
  const form = $('#publishForm');
  form.reset();
  form.elements.name.value = state.activeForm.draftSchema.title;
  form.elements.openAt.value = localDateTime(new Date());
  $('#targetPreview').textContent = '发布前先预检查填报范围。';
  $('#publishDialog').showModal();
}

function audienceFromForm(form) {
  return {
    includeAllActive: form.elements.includeAllActive.checked,
    departmentIds: [...form.elements.departmentIds.selectedOptions].map(option => Number(option.value)),
    personIds: [...form.elements.personIds.selectedOptions].map(option => Number(option.value))
  };
}

async function previewTargets() {
  const audience = audienceFromForm($('#publishForm'));
  const result = await api('/api/v1/admin/tasks/target-preview', { method: 'POST', body: { audience } });
  $('#targetPreview').textContent = `可填报 ${result.eligibleCount} 人；未开户或账号不可用 ${result.ineligibleCount} 人。`;
}

async function publishTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const body = {
    formId: state.activeForm.formId, name: form.elements.name.value,
    openAt: new Date(form.elements.openAt.value).toISOString(),
    dueAt: form.elements.dueAt.value ? new Date(form.elements.dueAt.value).toISOString() : null,
    audience: audienceFromForm(form), clientRequestId: crypto.randomUUID()
  };
  const result = await api('/api/v1/admin/tasks', { method: 'POST', body });
  $('#publishDialog').close();
  showMessage(`任务 ${result.task.taskCode} 已发布，可填报 ${result.task.targetCount} 人`);
  await Promise.all([loadForms(), loadTasks()]);
}

async function loadTasks() {
  state.tasks = (await api('/api/v1/admin/tasks')).tasks;
  renderTaskList();
}

function renderTaskList() {
  const root = $('#taskList');
  root.innerHTML = '';
  state.tasks.forEach(task => {
    const button = document.createElement('button');
    button.className = `item ${state.activeTaskId === task.taskId ? 'active' : ''}`;
    button.innerHTML = `<strong>${escapeHtml(task.name)}</strong><small>${escapeHtml(task.ownerDepartmentName || '')} · ${statusText(task.status)} · ${task.submittedCount}/${task.targetCount}</small>`;
    button.onclick = () => selectTask(task.taskId);
    root.append(button);
  });
  if (!state.tasks.length) root.innerHTML = '<p class="message">还没有收集任务。</p>';
}

async function selectTask(taskId) {
  state.activeTaskId = taskId;
  renderTaskList();
  const dashboard = await api(`/api/v1/admin/tasks/${taskId}/dashboard`);
  const task = dashboard.task;
  $('#taskDetail').innerHTML = `
    <div class="workspace-head"><div><span class="tag">${escapeHtml(task.taskCode)}</span><h2>${escapeHtml(task.name)}</h2><p>${escapeHtml(task.ownerDepartmentName || '')} · ${statusText(task.status)}</p></div>
      <div class="actions"><a href="/api/v1/admin/tasks/${taskId}/export.xlsx"><button>导出 Excel</button></a><a href="/api/v1/admin/tasks/${taskId}/export.zip"><button>下载附件包</button></a></div></div>
    <div class="metric-grid"><div class="metric"><span>目标人数</span><strong>${dashboard.counts.total}</strong></div><div class="metric"><span>已提交</span><strong>${dashboard.counts.submitted}</strong></div><div class="metric"><span>草稿</span><strong>${dashboard.counts.draft}</strong></div><div class="metric"><span>未开始/逾期</span><strong>${dashboard.counts.notStarted + dashboard.counts.overdue}</strong></div></div>
    <h3>字段统计</h3><div class="stat-list">${dashboard.statistics.map(stat => `<div class="stat-card"><strong>${escapeHtml(stat.label)}</strong><p>已填写 ${stat.answered} 份</p>${stat.counts ? Object.entries(stat.counts).map(([label,count]) => `<div>${escapeHtml(label)}：${count}</div>`).join('') : ''}${stat.average != null ? `<div>平均值：${Number(stat.average).toFixed(2)}</div><div>范围：${stat.min}－${stat.max}</div>` : ''}</div>`).join('')}</div>
    <h3>任务操作</h3><div class="actions"><button data-task-action="close">关闭</button><button data-task-action="extend">延期</button><button data-task-action="reopen">重新开放</button><button data-task-action="cancel" class="danger">取消</button><button id="viewSubmissions">查看答卷</button></div>
    <div id="submissionTable"></div>`;
  $$('[data-task-action]').forEach(button => button.onclick = () => taskAction(button.dataset.taskAction));
  $('#viewSubmissions').onclick = showSubmissions;
}

async function taskAction(action) {
  const body = {};
  if (['extend', 'reopen'].includes(action)) {
    const value = prompt('请输入新的截止时间，例如 2026-08-31 18:00；留空表示重新开放且不设截止时间');
    if (action === 'extend' && !value) return;
    body.dueAt = value ? new Date(value.replace(' ', 'T')).toISOString() : null;
  }
  if (action === 'cancel' && !confirm('取消后所有答卷将只读保留，确认取消？')) return;
  await api(`/api/v1/admin/tasks/${state.activeTaskId}/${action}`, { method: 'POST', body });
  await loadTasks();
  await selectTask(state.activeTaskId);
  showMessage('任务状态已更新');
}

async function showSubmissions() {
  const rows = (await api(`/api/v1/admin/tasks/${state.activeTaskId}/submissions`)).submissions;
  $('#submissionTable').innerHTML = `<div class="table-wrap"><table><thead><tr><th>工号</th><th>姓名</th><th>部门</th><th>状态</th><th>提交时间</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.employeeNo)}</td><td>${escapeHtml(row.personName)}</td><td>${escapeHtml(row.departmentName || '')}</td><td>${statusText(row.status)}</td><td>${formatTime(row.submittedAt)}</td></tr>`).join('')}</tbody></table></div>`;
}

async function loadGrants() {
  if (!hasAdmin()) return;
  state.grants = (await api('/api/v1/admin/grants')).grants;
  $('#grantRows').innerHTML = state.grants.map(grant => `<tr><td>${escapeHtml(grant.employeeNo)} · ${escapeHtml(grant.personName)}</td><td>${grant.roleCode === 'collection_admin' ? '信息收集管理员' : '部门设计者'}</td><td>${escapeHtml(grant.scopeDepartmentName || '全局')}</td><td>${grant.status === 'active' ? '有效' : '已撤销'}</td><td>${grant.status === 'active' ? `<button data-revoke="${grant.grantId}" class="danger">撤销</button>` : ''}</td></tr>`).join('');
  $$('[data-revoke]').forEach(button => button.onclick = async () => {
    if (!confirm('确认撤销该权限？该人员现有的后台会话将立即失效。')) return;
    await api(`/api/v1/admin/grants/${button.dataset.revoke}/revoke`, { method: 'POST', body: {} });
    await loadGrants();
  });
}

function bindEvents() {
  $('#loginForm').onsubmit = async event => {
    event.preventDefault();
    $('#loginMessage').textContent = '';
    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const result = await api('/api/v1/auth/login', { method: 'POST', body });
      await enterApp(result.identity);
    } catch (err) { $('#loginMessage').textContent = err.message; }
  };
  $('#logoutButton').onclick = async () => { await api('/api/v1/auth/logout', { method: 'POST', body: {} }); location.reload(); };
  $$('.tabs button').forEach(button => button.onclick = () => {
    $$('.tabs button').forEach(item => item.classList.toggle('active', item === button));
    ['forms', 'tasks', 'grants'].forEach(name => $(`#${name}Panel`).classList.toggle('hidden', name !== button.dataset.tab));
  });
  $('#createForm').onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.ownerDepartmentId = Number(body.ownerDepartmentId);
    const { form } = await api('/api/v1/admin/forms', { method: 'POST', body });
    event.currentTarget.reset();
    await loadForms();
    await selectForm(form.formId);
  };
  $('#refreshForms').onclick = loadForms;
  $('#refreshTasks').onclick = loadTasks;
  $('#refreshGrants').onclick = loadGrants;
  $('#sectionSelect').onchange = event => { state.activeSectionKey = event.target.value; state.activeFieldKey = currentSection()?.fields?.[0]?.fieldKey || null; renderBuilder(); };
  $('#addSection').onclick = addSection;
  $('#renameSection').onclick = () => { const section = currentSection(); if (!section) return; const name = prompt('请输入新的分区名称', section.title); if (name?.trim()) { section.title = name.trim().slice(0, 100); renderBuilder(); } };
  $('#addField').onclick = addField;
  $('#fieldEditor').onsubmit = event => {
    event.preventDefault();
    const field = currentField();
    const form = event.currentTarget;
    field.label = form.elements.label.value.trim();
    field.helpText = form.elements.helpText.value.trim();
    field.required = form.elements.required.checked;
    if (['single_choice', 'multiple_choice'].includes(field.type)) {
      const old = field.options || [];
      field.options = form.elements.options.value.split(/\r?\n/).map(label => label.trim()).filter(Boolean).slice(0, 100).map((label, index) => ({ optionKey: old[index]?.optionKey || crypto.randomUUID(), label }));
    }
    const min = form.elements.min.value === '' ? null : Number(form.elements.min.value);
    const max = form.elements.max.value === '' ? null : Number(form.elements.max.value);
    if (['short_text', 'long_text'].includes(field.type)) { field.validation.minLength = min; field.validation.maxLength = max; }
    else { field.validation.min = min; field.validation.max = max; }
    state.activeForm.draftSchema.title = state.activeForm.draftSchema.title || state.activeForm.name;
    renderBuilder();
    showMessage('字段设置已应用，请保存设计稿');
  };
  $('#moveUp').onclick = () => moveField(-1);
  $('#moveDown').onclick = () => moveField(1);
  $('#removeField').onclick = () => { const section = currentSection(); if (!section || !confirm('确认删除当前字段？')) return; section.fields = section.fields.filter(field => field.fieldKey !== state.activeFieldKey); state.activeFieldKey = section.fields[0]?.fieldKey || null; renderBuilder(); };
  $('#saveDraft').onclick = () => saveDraft().catch(err => showMessage(formatError(err), true));
  $('#openPublish').onclick = openPublish;
  $('#closePublish').onclick = () => $('#publishDialog').close();
  $('#previewTargets').onclick = () => previewTargets().catch(err => $('#targetPreview').textContent = formatError(err));
  $('#publishForm').onsubmit = event => publishTask(event).catch(err => showMessage(formatError(err), true));
  $('#grantForm select[name="roleCode"]').onchange = event => $('#grantDepartmentRow').classList.toggle('hidden', event.target.value === 'collection_admin');
  $('#grantForm').onsubmit = async event => {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    body.personId = Number(body.personId); body.departmentId = body.roleCode === 'collection_admin' ? null : Number(body.departmentId);
    await api('/api/v1/admin/grants', { method: 'POST', body });
    await loadGrants();
    showMessage('权限已授予');
  };
}

function formatError(err) {
  if (!err.details?.length) return err.message;
  return `${err.message}：${err.details.map(item => item.message).join('；')}`;
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}

function statusText(value) {
  return ({ scheduled: '未开始', open: '进行中', closed: '已关闭', cancelled: '已取消', draft: '草稿', submitted: '已提交', overdue: '逾期未提交', not_started: '未开始' })[value] || value;
}

function formatTime(value) { return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—'; }
function localDateTime(date) { const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

Object.entries(FIELD_LABELS).forEach(([value, label]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; $('#newFieldType').append(option); });
bindEvents();
api('/api/v1/auth/me').then(result => enterApp(result.identity)).catch(() => {});
