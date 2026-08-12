'use strict';

const FIELD_LABELS = {
  short_text: '短文本', long_text: '长文本', integer: '整数', decimal: '小数', date: '日期', datetime: '日期时间',
  single_choice: '单选', multiple_choice: '多选', boolean: '是/否', person: '人员', department: '部门', attachment: '附件'
};

const state = {
  identity: null, csrf: '', directory: { departments: [], people: [] }, forms: [], tasks: [], grants: [],
  activeForm: null, activeSectionKey: null, activeFieldKey: null, activeTaskId: null, formDirty: false
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
  state.formDirty = false;
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
  $('#deleteForm').classList.toggle('hidden', form.status !== 'draft');
  const sectionSelect = $('#sectionSelect');
  sectionSelect.innerHTML = '';
  form.draftSchema.sections.forEach(section => {
    const option = document.createElement('option');
    option.value = section.sectionKey;
    option.textContent = `${section.kind === 'detail' ? '[明细表]' : '[主表]'} ${section.title}`;
    option.selected = section.sectionKey === state.activeSectionKey;
    sectionSelect.append(option);
  });
  const activeSection = currentSection();
  $('#detailSettings').classList.toggle('hidden', activeSection?.kind !== 'detail');
  if (activeSection?.kind === 'detail') {
    $('#detailMinRows').value = activeSection.minRows ?? 1;
    $('#detailMaxRows').value = activeSection.maxRows ?? 100;
  }
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

function addSection(kind) {
  const title = prompt(kind === 'detail' ? '请输入明细表名称' : '请输入主表分区名称');
  if (!title?.trim()) return;
  const section = { sectionKey: crypto.randomUUID(), title: title.trim().slice(0, 100), description: '', kind, minRows: kind === 'detail' ? 1 : null, maxRows: kind === 'detail' ? 100 : null, fields: [] };
  state.activeForm.draftSchema.sections.push(section);
  state.activeSectionKey = section.sectionKey;
  state.activeFieldKey = null;
  state.formDirty = true;
  renderBuilder();
}

function addField() {
  const section = currentSection();
  if (!section) return showMessage('请先新增一个分区', true);
  const type = $('#newFieldType').value;
  if (section.kind === 'detail' && type === 'attachment') return showMessage('附件字段只能放在主表中', true);
  const field = {
    fieldKey: crypto.randomUUID(), type, label: FIELD_LABELS[type], helpText: '', required: false,
    options: ['single_choice', 'multiple_choice'].includes(type) ? [{ optionKey: crypto.randomUUID(), label: '选项一' }] : [],
    validation: { minLength: null, maxLength: null, min: null, max: null, decimalPlaces: null, minDate: null, maxDate: null, maxFiles: 5 }
  };
  section.fields.push(field);
  state.activeFieldKey = field.fieldKey;
  state.formDirty = true;
  renderBuilder();
}

function moveField(offset) {
  const section = currentSection();
  const index = section?.fields.findIndex(field => field.fieldKey === state.activeFieldKey) ?? -1;
  const target = index + offset;
  if (index < 0 || target < 0 || target >= section.fields.length) return;
  [section.fields[index], section.fields[target]] = [section.fields[target], section.fields[index]];
  state.formDirty = true;
  renderFields();
}

async function saveDraft() {
  const result = await api(`/api/v1/admin/forms/${state.activeForm.formId}/draft`, {
    method: 'PUT', body: { expectedRevision: state.activeForm.draftRevision, schema: state.activeForm.draftSchema }
  });
  state.activeForm.draftRevision = result.draftRevision;
  state.activeForm.draftSchema = result.schema;
  state.formDirty = false;
  showMessage('设计稿已保存');
  await loadForms();
  renderBuilder();
}

function syncCurrentFieldFromEditor({ announce = false } = {}) {
  const field = currentField();
  if (!field) return true;
  const form = $('#fieldEditor');
  if (!form.reportValidity()) return false;
  const before = JSON.stringify(field);
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
  if (JSON.stringify(field) !== before) {
    state.formDirty = true;
    renderBuilder();
  }
  if (announce) showMessage('字段设置已应用，请保存设计稿');
  return true;
}

function previewEntityOptions(type) {
  const rows = type === 'person' ? state.directory.people : state.directory.departments;
  const valueKey = type === 'person' ? 'personId' : 'departmentId';
  const label = type === 'person' ? item => `${item.employeeNo} · ${item.personName} · ${item.departmentName || '未分配部门'}` : item => item.name;
  return `<option value="">请选择</option>${rows.map(item => `<option value="${item[valueKey]}">${escapeHtml(label(item))}</option>`).join('')}`;
}

function renderPreviewField(field) {
  let control = '';
  if (field.type === 'short_text') control = '<input placeholder="请输入">';
  else if (field.type === 'long_text') control = '<textarea rows="4" placeholder="请输入"></textarea>';
  else if (field.type === 'integer') control = '<input type="number" step="1" placeholder="请输入整数">';
  else if (field.type === 'decimal') control = '<input type="number" step="any" placeholder="请输入数值">';
  else if (field.type === 'date') control = '<input type="date">';
  else if (field.type === 'datetime') control = '<input type="datetime-local">';
  else if (field.type === 'boolean') control = '<select><option value="">请选择</option><option>是</option><option>否</option></select>';
  else if (field.type === 'single_choice') control = `<div class="preview-choice-list">${field.options.map(option => `<label><input type="radio" name="preview-${escapeHtml(field.fieldKey)}"> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'multiple_choice') control = `<div class="preview-choice-list">${field.options.map(option => `<label><input type="checkbox"> ${escapeHtml(option.label)}</label>`).join('')}</div>`;
  else if (field.type === 'person') control = `<select>${previewEntityOptions('person')}</select>`;
  else if (field.type === 'department') control = `<select>${previewEntityOptions('department')}</select>`;
  else if (field.type === 'attachment') control = '<div class="preview-attachment">发布任务后，填报人可以在此处上传附件。</div>';
  return `<label class="preview-field ${field.required ? 'required' : ''}"><span class="preview-label">${escapeHtml(field.label || '未命名字段')}</span>${field.helpText ? `<span class="preview-help">${escapeHtml(field.helpText)}</span>` : ''}${control}</label>`;
}

function renderPreviewDetailCell(field) {
  let control = '';
  if (field.type === 'long_text') control = '<textarea rows="1" placeholder="请输入"></textarea>';
  else if (field.type === 'integer') control = '<input type="number" step="1" placeholder="请输入整数">';
  else if (field.type === 'decimal') control = '<input type="number" step="any" placeholder="请输入数值">';
  else if (field.type === 'date') control = '<input type="date">';
  else if (field.type === 'datetime') control = '<input type="datetime-local">';
  else if (field.type === 'boolean') control = '<select><option>请选择</option><option>是</option><option>否</option></select>';
  else if (field.type === 'single_choice') control = `<select><option>请选择</option>${field.options.map(option => `<option>${escapeHtml(option.label)}</option>`).join('')}</select>`;
  else if (field.type === 'multiple_choice') control = `<select><option>${field.options.length ? '可选择多项' : '暂无选项'}</option></select>`;
  else if (field.type === 'person') control = `<select>${previewEntityOptions('person')}</select>`;
  else if (field.type === 'department') control = `<select>${previewEntityOptions('department')}</select>`;
  else control = '<input placeholder="请输入">';
  return `<td>${control}</td>`;
}

function openPreview() {
  if (!syncCurrentFieldFromEditor()) return;
  const schema = state.activeForm.draftSchema;
  $('#previewTitle').textContent = schema.title || state.activeForm.name;
  $('#previewContent').innerHTML = schema.sections.length
    ? schema.sections.map(section => section.kind === 'detail'
      ? `<section class="preview-section preview-detail"><h3>${escapeHtml(section.title)}<span class="section-kind detail">明细表</span></h3>${section.description ? `<p class="preview-section-description">${escapeHtml(section.description)}</p>` : ''}<p class="preview-detail-help">填报人可以逐格录入，也可以从 Excel 复制连续单元格后直接粘贴。</p>${section.fields.length ? `<div class="preview-detail-grid-shell"><table class="preview-detail-grid"><thead><tr><th>序号</th>${section.fields.map(field => `<th><span class="${field.required ? 'required' : ''}">${escapeHtml(field.label || '未命名字段')}</span>${field.helpText ? `<small>${escapeHtml(field.helpText)}</small>` : ''}</th>`).join('')}<th>操作</th></tr></thead><tbody><tr><th>1</th>${section.fields.map(renderPreviewDetailCell).join('')}<td>↑ ↓ ⧉ ×</td></tr></tbody></table></div>` : '<p class="preview-help">当前明细表还没有字段。</p>'}<button type="button" disabled>＋ 新增一行</button></section>`
      : `<section class="preview-section"><h3>${escapeHtml(section.title)}<span class="section-kind">主表</span></h3>${section.description ? `<p class="preview-section-description">${escapeHtml(section.description)}</p>` : ''}${section.fields.map(renderPreviewField).join('') || '<p class="preview-help">当前主表分区还没有字段。</p>'}</section>`).join('')
    : '<div class="preview-empty">当前表单还没有分区和字段。</div>';
  $('#previewDialog').showModal();
}

async function archiveActiveForm() {
  const form = state.activeForm;
  if (!form) return;
  const warning = state.formDirty
    ? `确认归档“${form.name}”？当前未保存的修改不会保留。归档后，表单将从默认列表隐藏，历史任务和答卷不受影响。`
    : `确认归档“${form.name}”？归档后，表单将从默认列表隐藏，历史任务和答卷不受影响。`;
  if (!confirm(warning)) return;
  await api(`/api/v1/admin/forms/${form.formId}/archive`, { method: 'POST', body: {} });
  state.activeForm = null;
  state.activeSectionKey = null;
  state.activeFieldKey = null;
  state.formDirty = false;
  $('#builder').classList.add('hidden');
  $('#builderEmpty').classList.remove('hidden');
  await loadForms();
  showMessage('表单已归档，历史任务和答卷保持不变');
}

async function deleteActiveForm() {
  const form = state.activeForm;
  if (!form) return;
  const unsaved = state.formDirty ? '当前未保存的修改也会丢失。' : '';
  if (!confirm(`确认永久删除“${form.name}”？${unsaved}删除后不能恢复。已经发布过的表单不能删除，只能归档。`)) return;
  await api(`/api/v1/admin/forms/${form.formId}`, { method: 'DELETE' });
  state.activeForm = null;
  state.activeSectionKey = null;
  state.activeFieldKey = null;
  state.formDirty = false;
  $('#builder').classList.add('hidden');
  $('#builderEmpty').classList.remove('hidden');
  await loadForms();
  showMessage('表单已永久删除');
}

function openPublish() {
  if (!syncCurrentFieldFromEditor()) return;
  const form = $('#publishForm');
  form.reset();
  form.elements.name.value = state.activeForm.draftSchema.title;
  form.elements.openAt.value = localDateTime(new Date());
  $('#targetPreview').textContent = '发布前先预检查填报范围。';
  $('#targetPreview').classList.remove('error');
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
  $('#targetPreview').classList.remove('error');
}

async function publishTask(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const fieldCount = state.activeForm.draftSchema.sections.reduce((total, section) => total + section.fields.length, 0);
  if (fieldCount === 0) {
    $('#targetPreview').textContent = '发布前至少新增一个分区和一个字段，并保存设计稿。';
    $('#targetPreview').classList.add('error');
    return;
  }
  const audience = audienceFromForm(form);
  if (!audience.includeAllActive && audience.departmentIds.length === 0 && audience.personIds.length === 0) {
    $('#targetPreview').textContent = '请选择全体有效账号、至少一个部门或至少一名人员。';
    $('#targetPreview').classList.add('error');
    return;
  }
  if (state.formDirty) await saveDraft();
  const body = {
    formId: state.activeForm.formId, name: form.elements.name.value,
    openAt: new Date(form.elements.openAt.value).toISOString(),
    dueAt: form.elements.dueAt.value ? new Date(form.elements.dueAt.value).toISOString() : null,
    audience, clientRequestId: crypto.randomUUID()
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
    <h3>字段统计</h3><div class="stat-list">${dashboard.statistics.map(stat => `<div class="stat-card"><strong>${escapeHtml(stat.label)}</strong><p>${stat.sectionKind === 'detail' ? `${escapeHtml(stat.sectionTitle)} · ` : ''}已填写 ${stat.answered} ${stat.unit || '份'}</p>${stat.counts ? Object.entries(stat.counts).map(([label,count]) => `<div>${escapeHtml(label)}：${count}</div>`).join('') : ''}${stat.average != null ? `<div>平均值：${Number(stat.average).toFixed(2)}</div><div>范围：${stat.min}－${stat.max}</div>` : ''}</div>`).join('')}</div>
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
    const createFormElement = event.currentTarget;
    const submitButton = createFormElement.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(createFormElement));
      body.ownerDepartmentId = Number(body.ownerDepartmentId);
      const { form } = await api('/api/v1/admin/forms', { method: 'POST', body });
      createFormElement.reset();
      await loadForms();
      await selectForm(form.formId);
    } catch (err) {
      showMessage(formatError(err), true);
    } finally {
      submitButton.disabled = false;
    }
  };
  $('#refreshForms').onclick = loadForms;
  $('#refreshTasks').onclick = loadTasks;
  $('#refreshGrants').onclick = loadGrants;
  $('#sectionSelect').onchange = event => { state.activeSectionKey = event.target.value; state.activeFieldKey = currentSection()?.fields?.[0]?.fieldKey || null; renderBuilder(); };
  $('#addMainSection').onclick = () => addSection('main');
  $('#addDetailSection').onclick = () => addSection('detail');
  $('#applyDetailSettings').onclick = () => {
    const section = currentSection();
    if (!section || section.kind !== 'detail') return;
    const minRows = Math.max(0, Math.min(100, Number($('#detailMinRows').value)));
    const maxRows = Math.max(1, Math.min(100, Number($('#detailMaxRows').value)));
    if (minRows > maxRows) return showMessage('明细表最少行数不能大于最多行数', true);
    section.minRows = minRows;
    section.maxRows = maxRows;
    state.formDirty = true;
    renderBuilder();
    showMessage('明细行规则已应用，请保存设计稿');
  };
  $('#renameSection').onclick = () => { const section = currentSection(); if (!section) return; const name = prompt('请输入新的分区名称', section.title); if (name?.trim()) { section.title = name.trim().slice(0, 100); state.formDirty = true; renderBuilder(); } };
  $('#addField').onclick = addField;
  $('#fieldEditor').onsubmit = event => {
    event.preventDefault();
    syncCurrentFieldFromEditor({ announce: true });
  };
  $('#moveUp').onclick = () => moveField(-1);
  $('#moveDown').onclick = () => moveField(1);
  $('#removeField').onclick = () => { const section = currentSection(); if (!section || !confirm('确认删除当前字段？')) return; section.fields = section.fields.filter(field => field.fieldKey !== state.activeFieldKey); state.activeFieldKey = section.fields[0]?.fieldKey || null; state.formDirty = true; renderBuilder(); };
  $('#saveDraft').onclick = () => saveDraft().catch(err => showMessage(formatError(err), true));
  $('#previewForm').onclick = openPreview;
  $('#closePreview').onclick = () => $('#previewDialog').close();
  $('#archiveForm').onclick = () => archiveActiveForm().catch(err => showMessage(formatError(err), true));
  $('#deleteForm').onclick = () => deleteActiveForm().catch(err => showMessage(formatError(err), true));
  $('#openPublish').onclick = openPublish;
  $('#closePublish').onclick = () => $('#publishDialog').close();
  $('#previewTargets').onclick = () => previewTargets().catch(err => {
    $('#targetPreview').textContent = formatError(err);
    $('#targetPreview').classList.add('error');
  });
  $('#publishForm').onsubmit = event => publishTask(event).catch(err => {
    const message = formatError(err);
    $('#targetPreview').textContent = message;
    $('#targetPreview').classList.add('error');
    showMessage(message, true);
  });
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
api('/api/v1/auth/session').then(result => {
  if (result.authenticated && result.identity) return enterApp(result.identity);
}).catch(() => {});
