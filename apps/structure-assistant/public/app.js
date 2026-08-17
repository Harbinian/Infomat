'use strict';

const IS_DSH_ENTRY = document.body.dataset.entryMode === 'dsh';
const IS_CLASSIC_ROUTE = window.location.pathname === '/classic';

const state = {
  user: null,
  csrfToken: '',
  apiKeyStatus: { configured: false },
  apiKeyBalanceWarning: false,
  context: null,
  fillDocument: null,
  fillValidation: null,
  fillJsonFileName: '',
  materials: [],
  messages: [],
  fieldStatuses: new Map(),
  fillDirty: false,
  reviewDocument: null,
  reviewValidation: null,
  reviewFileName: '',
  reviewIssues: [],
  dispositions: new Map(),
  reviewRunCompleted: false,
  reviewDirty: false,
  reviewPreviewMode: 'structure',
  reviewDiagramExpanded: false,
  locked: false,
  lockReason: null,
  downloadedAfterLock: false,
  pollTimer: null,
  activeView: 'fill',
  dshWorkspaceId: null,
  dshWorkspaceRevision: 0,
  dshWorkspaces: [],
  dshLastSnapshot: '',
  dshSaveInFlight: false,
  dshConflict: false,
  dshPollTimer: null
};

const byId = id => document.getElementById(id);
const MAX_IMPORTED_JSON_BYTES = 2 * 1024 * 1024;
let reviewDiagramView = null;

function showMessage(message, kind = '') {
  const box = byId('globalMessage');
  box.textContent = message;
  box.className = `global-message${kind ? ` ${kind}` : ''}`;
  box.hidden = false;
  window.clearTimeout(showMessage.timer);
  showMessage.timer = window.setTimeout(() => {
    box.hidden = true;
  }, 7000);
}

function setBusy(button, busy, busyText) {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.textContent = busyText || '处理中……';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalText || button.textContent;
    button.disabled = false;
  }
}

async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers || {}) };
  if (state.csrfToken && options.method && options.method !== 'GET') {
    headers['X-CSRF-Token'] = state.csrfToken;
  }
  if (options.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.json);
  }
  const requestPath = IS_DSH_ENTRY && path.startsWith('/api/')
    ? `/mdm-api${path.slice(4)}`
    : path;
  const response = await fetch(requestPath, {
    cache: 'no-store',
    credentials: 'same-origin',
    ...options,
    headers
  });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch (_) {
    body = { error: '服务返回了无法识别的内容。', code: 'INVALID_RESPONSE' };
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/auth/login') showLogin();
    if (body?.code === 'VERSION_CHANGED' || body?.code === 'MAINTENANCE_MODE') {
      lockForVersion(
        body.error,
        body.code === 'MAINTENANCE_MODE' ? 'maintenance' : 'version'
      );
    }
    if (body?.code === 'API_KEY_REQUIRED' || body?.code === 'MODEL_AUTH_FAILED') {
      state.apiKeyStatus = {
        configured: false,
        invalidated: body.code === 'MODEL_AUTH_FAILED'
      };
      state.apiKeyBalanceWarning = false;
      renderApiKeyStatus();
      openApiKeyDialog();
    }
    if (IS_DSH_ENTRY && ['DSH_RUNTIME_REQUIRED', 'DSH_RUNTIME_RESTARTED'].includes(body?.code)) {
      state.dshWorkspaceId = null;
      state.dshWorkspaces = [];
      state.dshConflict = false;
      renderWorkspaceControl();
    }
    const error = new Error(body?.error || `请求失败：HTTP ${response.status}`);
    error.code = body?.code || 'REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return body;
}

function expectedVersion() {
  return {
    app_commit: state.context?.app_commit || '',
    schema_digest: state.context?.schema_digest || ''
  };
}

function showLogin() {
  state.user = null;
  state.csrfToken = '';
  state.apiKeyStatus = { configured: false };
  state.apiKeyBalanceWarning = false;
  closeApiKeyDialog();
  byId('loginView').hidden = false;
  byId('appView').hidden = true;
  byId('topbarMeta').hidden = true;
  if (state.pollTimer) window.clearInterval(state.pollTimer);
}

function showApp() {
  byId('loginView').hidden = true;
  byId('appView').hidden = false;
  byId('topbarMeta').hidden = false;
  byId('currentUser').textContent = `${state.user.displayName} · ${state.user.department}`;
  byId('adminTab').hidden = state.user.role !== 'admin';
}

function shortDigest(value) {
  return value ? value.slice(0, 10) : '未知';
}

function updateContextDisplay() {
  if (!state.context) return;
  byId('versionPill').textContent =
    `${state.context.schema_version} · ${shortDigest(state.context.schema_digest)} · ${shortDigest(state.context.app_commit)}`;
}

function lockForVersion(message, reason = 'version') {
  state.locked = true;
  state.lockReason = reason;
  state.downloadedAfterLock = false;
  byId('versionAlert').hidden = false;
  byId('versionAlertText').textContent =
    message || '版本已更新，请先下载当前草稿，再刷新页面；刷新后可导入草稿继续。';
  updateActionAvailability();
}

function unlockVersion() {
  state.locked = false;
  state.lockReason = null;
  state.downloadedAfterLock = false;
  byId('versionAlert').hidden = true;
  updateActionAvailability();
}

function currentDraftForDownload() {
  if (state.activeView === 'review' && state.reviewDocument) return state.reviewDocument;
  return state.fillDocument || state.reviewDocument;
}

function updateActionAvailability() {
  const maintenance = Boolean(state.context?.maintenance_mode?.enabled);
  const modelUnavailable = !state.apiKeyStatus.configured;
  const workspaceUnavailable = IS_DSH_ENTRY && !state.dshWorkspaceId;
  byId('sendTurnButton').disabled = state.locked || maintenance || modelUnavailable || workspaceUnavailable || !state.fillDocument;
  byId('runReviewButton').disabled =
    state.locked || maintenance || modelUnavailable || workspaceUnavailable || !state.reviewDocument;
  byId('refreshBalanceButton').disabled = modelUnavailable;
  byId('versionDownloadButton').disabled = !currentDraftForDownload();
  const reviewComplete = state.reviewDocument
    && state.reviewRunCompleted
    && state.reviewValidation?.valid
    && state.reviewIssues.every(issue => state.dispositions.has(issue.id));
  byId('downloadReviewedJsonButton').disabled = !reviewComplete;
  byId('downloadReviewCsvButton').disabled = !reviewComplete;
}

function formatDateTime(value) {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatBalance(balance) {
  if (balance?.insufficient) return '余额不足';
  if (balance?.totalBalance == null) return '未返回人民币余额';
  return `¥${balance.totalBalance.toFixed(2)}${balance.warning ? ' · 低于20元' : ''}`;
}

function renderApiKeyStatus() {
  const status = state.apiKeyStatus || { configured: false };
  const card = byId('apiKeyCard');
  const badge = byId('apiKeyStatusBadge');
  const text = byId('apiKeyStatusText');
  card.classList.toggle('configured', Boolean(status.configured));
  card.classList.toggle('warning', Boolean(status.configured && state.apiKeyBalanceWarning));
  if (status.configured) {
    badge.textContent = state.apiKeyBalanceWarning ? '余额偏低' : '已验证';
    text.textContent = `${status.fingerprint} · 配置时间 ${formatDateTime(status.configured_at)} · 会话到期 ${formatDateTime(status.expires_at)}`;
    byId('openApiKeyButton').textContent = '更换Key';
    byId('clearApiKeyButton').hidden = false;
  } else {
    badge.textContent = status.invalidated ? '已失效' : '未配置';
    text.textContent = status.invalidated
      ? 'DeepSeek已拒绝当前Key。系统已清除该会话Key；当前JSON和页面内容仍保留，请重新配置。'
      : '请配置本人API Key。未配置时仍可导入、编辑、校验和下载JSON，但不能发送对话或启动独立结构预审。';
    byId('openApiKeyButton').textContent = '配置Key';
    byId('clearApiKeyButton').hidden = true;
    byId('balanceValue').textContent = '配置Key后可查询';
  }
  updateActionAvailability();
}

function openApiKeyDialog() {
  if (!state.user) return;
  const modal = byId('apiKeyModal');
  const input = byId('apiKeyInput');
  input.value = '';
  modal.hidden = false;
  window.requestAnimationFrame(() => input.focus());
}

function closeApiKeyDialog() {
  const modal = byId('apiKeyModal');
  const input = byId('apiKeyInput');
  if (input) input.value = '';
  if (modal) modal.hidden = true;
}

async function loadApiKeyStatus({ promptIfMissing = false } = {}) {
  state.apiKeyStatus = await api('/api/account/api-key');
  state.apiKeyBalanceWarning = false;
  renderApiKeyStatus();
  if (!state.apiKeyStatus.configured && promptIfMissing) openApiKeyDialog();
}

async function configureApiKey(event) {
  event.preventDefault();
  const button = event.submitter;
  const input = byId('apiKeyInput');
  let value = input.value;
  setBusy(button, true, '正在验证……');
  try {
    const result = await api('/api/account/api-key', {
      method: 'PUT',
      json: { api_key: value }
    });
    state.apiKeyStatus = {
      configured: result.configured,
      fingerprint: result.fingerprint,
      configured_at: result.configured_at,
      expires_at: result.expires_at
    };
    state.apiKeyBalanceWarning = Boolean(result.balance?.warning);
    byId('balanceValue').textContent = formatBalance(result.balance);
    closeApiKeyDialog();
    renderApiKeyStatus();
    showMessage(
      result.balance?.warning
        ? 'API Key已用于当前登录会话，当前余额不足或低于20元，系统不会自动充值。'
        : 'API Key已验证，仅用于当前登录会话。',
      result.balance?.warning ? '' : 'success'
    );
  } finally {
    value = '';
    input.value = '';
    setBusy(button, false);
    updateActionAvailability();
  }
}

async function clearApiKey() {
  if (!window.confirm('清除后，本登录会话将不能继续调用模型。当前JSON和页面内容会保留。确定清除吗？')) return;
  await api('/api/account/api-key', { method: 'DELETE', json: {} });
  state.apiKeyStatus = { configured: false };
  state.apiKeyBalanceWarning = false;
  renderApiKeyStatus();
  openApiKeyDialog();
  showMessage('当前登录会话的API Key已清除，页面内容仍保留。', 'success');
}

async function loadContext({ initial = false } = {}) {
  const next = await api('/api/context');
  if (!initial && state.context && (
    next.app_commit !== state.context.app_commit
    || next.schema_digest !== state.context.schema_digest
  )) {
    lockForVersion('版本已更新，请先下载当前草稿，再刷新页面；刷新后可导入草稿继续。');
    return;
  }
  state.context = next;
  updateContextDisplay();
  if (next.maintenance_mode?.enabled) {
    lockForVersion(
      next.maintenance_mode.message || '系统正在集中发布新版本，请先下载当前草稿。',
      'maintenance'
    );
  } else if (initial || state.lockReason === 'maintenance') {
    unlockVersion();
  }
  updateActionAvailability();
}

async function loadTemplate() {
  const result = await api('/api/template');
  if (
    state.context
    && (
      result.app_commit !== state.context.app_commit
      || result.schema_digest !== state.context.schema_digest
    )
  ) {
    lockForVersion();
    return;
  }
  state.fillDocument = result.data;
  state.fillValidation = { valid: true, errors: [] };
  state.fillJsonFileName = '';
  state.fillDirty = false;
  renderFillJsonStatus();
  renderChecklist();
  updateActionAvailability();
}

function selectView(name) {
  state.activeView = name;
  for (const button of document.querySelectorAll('.tab[data-view]')) {
    button.classList.toggle('active', button.dataset.view === name);
  }
  byId('fillView').hidden = name !== 'fill';
  byId('reviewView').hidden = name !== 'review';
  byId('adminView').hidden = name !== 'admin';
  if (name !== 'review') {
    state.reviewDiagramExpanded = false;
    destroyReviewDiagram();
  } else if (state.reviewDocument) {
    renderReviewDocumentPreview();
  }
  if (name === 'admin' && state.user?.role === 'admin') loadAdminStatus();
}

function materialConsent() {
  const confirmed = byId('safeInputCheck').checked;
  return {
    authorized: confirmed,
    deidentified: confirmed
  };
}

function assertMaterialConsent() {
  const consent = materialConsent();
  if (!consent.authorized || !consent.deidentified) {
    throw new Error('发送或补充材料前，请确认输入内容已经授权并完成脱敏。');
  }
  return consent;
}

function renderMaterials() {
  const list = byId('materialList');
  list.replaceChildren();
  state.materials.forEach((material, index) => {
    const item = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = `${material.material_name} · ${material.readable_text.length}字`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'text-button';
    remove.textContent = '移除';
    remove.addEventListener('click', () => {
      state.materials.splice(index, 1);
      renderMaterials();
    });
    item.append(label, remove);
    list.append(item);
  });
  byId('materialCount').textContent = `${state.materials.length}份文字材料`;
}

function renderFillJsonStatus() {
  const status = byId('fillJsonStatus');
  if (!status) return;
  if (!state.fillJsonFileName) {
    status.textContent = '尚未导入JSON草稿';
    return;
  }
  const errorCount = state.fillValidation?.errors?.length || 0;
  status.textContent = state.fillValidation?.valid
    ? `${state.fillJsonFileName} · 当前草稿硬性结构通过`
    : `${state.fillJsonFileName} · 当前草稿有${errorCount}项硬性结构错误`;
}

async function addFileMaterial(file) {
  const consent = assertMaterialConsent();
  const body = new FormData();
  body.append('file', file);
  body.append('authorized', String(consent.authorized));
  body.append('deidentified', String(consent.deidentified));
  const result = await api('/api/source/upload', {
    method: 'POST',
    headers: { 'X-CSRF-Token': state.csrfToken },
    body
  });
  state.materials.push(result.material);
  renderMaterials();
  showMessage('材料已加入当前页面内存。刷新或关闭页面后会清空。', 'success');
}

async function addPastedMaterial() {
  const consent = assertMaterialConsent();
  const text = byId('pasteSourceInput').value;
  const result = await api('/api/source/paste', {
    method: 'POST',
    json: { text, ...consent }
  });
  state.materials.push(result.material);
  byId('pasteSourceInput').value = '';
  renderMaterials();
  showMessage('粘贴文字已加入当前页面内存。', 'success');
}

function appendChat(role, content, questions = []) {
  state.messages.push({
    role,
    content,
    questions: questions.map(item => ({ path: item.path, question: item.question }))
  });
  const container = byId('chatMessages');
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  const message = document.createElement('div');
  message.className = `chat-message ${role}`;
  const body = document.createElement('div');
  body.textContent = content;
  message.append(body);
  if (questions.length) {
    const list = document.createElement('ol');
    list.className = 'chat-questions';
    questions.forEach(item => {
      const row = document.createElement('li');
      row.textContent = item.question;
      list.append(row);
    });
    message.append(list);
  }
  container.append(message);
  container.scrollTop = container.scrollHeight;
}

function conversationPayload(messages) {
  return messages.map(message => ({
    role: message.role,
    content: message.questions?.length
      ? [
          message.content,
          '本轮主问题：',
          ...message.questions.map(item => item.question)
        ].join('\n')
      : message.content
  }));
}

function resetChatDisplay() {
  const container = byId('chatMessages');
  container.replaceChildren();
  const welcome = document.createElement('div');
  welcome.className = 'chat-message assistant chat-welcome';
  const title = document.createElement('strong');
  title.textContent = '我会一次问清一个问题';
  const body = document.createElement('p');
  body.textContent = '可以先说流程名称，也可以直接描述一个业务行为。我会沿着每项行为继续追问：何时发生、谁来做、使用哪些表单或记录、涉及哪些数据、数据从哪里来并交给谁。暂不清楚或确实不适用时，可以直接说明，我不会猜测。';
  welcome.append(title, body);
  container.append(welcome);
}

function hasPreviewValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return Boolean(value.trim());
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function createPreviewSection(title) {
  const section = document.createElement('section');
  section.className = 'preview-section';
  const heading = document.createElement('h3');
  heading.textContent = title;
  section.append(heading);
  return section;
}

function appendPreviewField(container, label, value, { wide = false } = {}) {
  const field = document.createElement('div');
  field.className = `preview-field${wide ? ' wide' : ''}`;
  const name = document.createElement('span');
  name.className = 'preview-label';
  name.textContent = label;
  const content = document.createElement('span');
  const present = hasPreviewValue(value);
  content.className = `preview-value${present ? '' : ' pending'}`;
  content.textContent = present ? String(value) : '待补充';
  field.append(name, content);
  container.append(field);
}

function renderDocumentPreview(container, documentValue, {
  emptyBehaviorText = '还没有形成业务行为。继续说明实际办理步骤后，这里会逐项显示。'
} = {}) {
  container.replaceChildren();
  const process = documentValue.process || {};
  const exportMeta = documentValue.export_meta || {};

  const overview = createPreviewSection('流程概况');
  const overviewGrid = document.createElement('div');
  overviewGrid.className = 'preview-grid';
  appendPreviewField(overviewGrid, '流程名称', process.process_name);
  appendPreviewField(overviewGrid, '发起部门', exportMeta.initiating_department);
  appendPreviewField(overviewGrid, '归口部门', process.owning_department);
  appendPreviewField(overviewGrid, '能力域', process.capability_domain);
  appendPreviewField(overviewGrid, '业务能力', process.business_capability);
  appendPreviewField(overviewGrid, '流程目的', process.purpose, { wide: true });
  appendPreviewField(overviewGrid, '适用范围', process.scope, { wide: true });
  overview.append(overviewGrid);
  container.append(overview);

  const counts = createPreviewSection('流程组成');
  const countGrid = document.createElement('div');
  countGrid.className = 'preview-count-grid';
  const collections = [
    ['业务行为', documentValue.behaviors],
    ['流程关系', documentValue.flow_relations],
    ['表单或记录', documentValue.forms],
    ['待治理数据', documentValue.data_objects],
    ['术语', documentValue.terms]
  ];
  collections.forEach(([label, value]) => {
    const item = document.createElement('div');
    item.className = 'preview-count';
    const number = document.createElement('strong');
    number.textContent = String(Array.isArray(value) ? value.length : 0);
    const name = document.createElement('span');
    name.textContent = label;
    item.append(number, name);
    countGrid.append(item);
  });
  counts.append(countGrid);
  container.append(counts);

  const behaviors = Array.isArray(documentValue.behaviors) ? documentValue.behaviors : [];
  const behaviorSection = createPreviewSection('业务行为');
  if (!behaviors.length) {
    const empty = document.createElement('p');
    empty.className = 'preview-empty';
    empty.textContent = emptyBehaviorText;
    behaviorSection.append(empty);
  } else {
    const list = document.createElement('ol');
    list.className = 'preview-list';
    behaviors.slice(0, 8).forEach(behavior => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = String(behavior?.behavior_name || '行为名称待补充');
      const actor = document.createElement('span');
      actor.textContent = String(behavior?.current_actor_role || '执行人待补充');
      item.append(name, actor);
      list.append(item);
    });
    if (behaviors.length > 8) {
      const more = document.createElement('li');
      more.className = 'preview-more';
      more.textContent = `另有${behaviors.length - 8}项业务行为`;
      list.append(more);
    }
    behaviorSection.append(list);
  }
  container.append(behaviorSection);
}

function renderStructuredPreview() {
  renderDocumentPreview(byId('structuredPreview'), state.fillDocument || {});
}

function destroyReviewDiagram() {
  if (!reviewDiagramView) return;
  try {
    reviewDiagramView.destroy();
  } catch (_) {
    // The JSON preview and issue list must remain usable if the graph has already released its canvas.
  }
  reviewDiagramView = null;
}

function renderReviewDiagramWarnings(model) {
  const container = byId('reviewDiagramWarnings');
  container.replaceChildren();
  const groups = [];
  if (model.namedBehaviorCount > 0 && model.localEdgeCount === 0) {
    groups.push({
      title: '当前只有业务行为节点',
      items: ['JSON中尚无明确的本流程关系，因此业务行为之间没有箭头。']
    });
  }
  if (model.unresolvedItems?.length) {
    groups.push({
      title: `${model.unresolvedCount}项内容未绘制`,
      items: model.unresolvedItems.map(item => item.message)
    });
  }
  if (model.reviewItems?.length) {
    groups.push({
      title: '关系类型请核对',
      items: model.reviewItems.map(item => item.message)
    });
  }
  groups.forEach(group => {
    const block = document.createElement('section');
    block.className = 'diagram-warning-block';
    const heading = document.createElement('strong');
    heading.textContent = group.title;
    const list = document.createElement('ul');
    group.items.forEach(message => {
      const item = document.createElement('li');
      item.textContent = message;
      list.append(item);
    });
    block.append(heading, list);
    container.append(block);
  });
}

function mountReviewDiagram() {
  destroyReviewDiagram();
  if (
    state.activeView !== 'review'
    || state.reviewPreviewMode !== 'diagram'
    || !state.reviewDocument
  ) {
    return;
  }
  const canvas = byId('reviewDiagramCanvas');
  const empty = byId('reviewDiagramEmpty');
  const failure = byId('reviewDiagramFailure');
  const notice = byId('reviewDiagramViewportNotice');
  failure.textContent = '';
  failure.classList.remove('show');
  notice.hidden = true;
  canvas.hidden = false;

  try {
    if (!window.ProcessDiagram?.buildGraphModel || !window.ProcessDiagram?.mount) {
      throw new Error('3001流程图组件未加载');
    }
    const model = window.ProcessDiagram.buildGraphModel(state.reviewDocument);
    renderReviewDiagramWarnings(model);
    if (!model.namedBehaviorCount) {
      canvas.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    reviewDiagramView = window.ProcessDiagram.mount({
      container: canvas,
      documentData: state.reviewDocument,
      onViewportModeChange(viewport) {
        notice.hidden = viewport?.mode !== 'start';
      }
    });
  } catch (error) {
    canvas.hidden = true;
    empty.hidden = true;
    failure.textContent = `流程图暂时无法生成：${error.message}。当前JSON和预审问题仍然保留。`;
    failure.classList.add('show');
  }
}

function renderReviewDocumentPreview() {
  if (!state.reviewDocument) return;
  const isDiagram = state.reviewPreviewMode === 'diagram';
  byId('reviewStructurePanel').hidden = isDiagram;
  byId('reviewDiagramPanel').hidden = !isDiagram;
  byId('reviewFormatBadge').textContent =
    state.reviewDocument.schema_version || '结构版本待确认';
  byId('reviewDiagramTitle').textContent =
    `${state.reviewDocument.process?.process_name || '未命名流程'} · 跨职能流程图`;
  byId('reviewPreviewCard').classList.toggle(
    'diagram-expanded',
    isDiagram && state.reviewDiagramExpanded
  );
  byId('expandReviewDiagramButton').textContent =
    state.reviewDiagramExpanded ? '退出展开' : '展开查看';
  for (const button of document.querySelectorAll('[data-review-preview]')) {
    const active = button.dataset.reviewPreview === state.reviewPreviewMode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  }
  renderDocumentPreview(
    byId('reviewStructuredPreview'),
    state.reviewDocument,
    { emptyBehaviorText: '当前JSON还没有业务行为。流程图也会保持空白，直到文件中形成已命名的业务行为。' }
  );
  byId('reviewJsonPreview').textContent = JSON.stringify(state.reviewDocument, null, 2);
  if (isDiagram) {
    window.requestAnimationFrame(mountReviewDiagram);
  } else {
    destroyReviewDiagram();
  }
}

function setReviewPreviewMode(mode) {
  state.reviewPreviewMode = mode === 'diagram' ? 'diagram' : 'structure';
  if (state.reviewPreviewMode !== 'diagram') state.reviewDiagramExpanded = false;
  renderReviewDocumentPreview();
}

function sectionStatus(path, value, errorCount) {
  if (errorCount > 0) return { label: '结构错误', kind: 'error' };
  const disposition = state.fieldStatuses.get(path);
  if (disposition?.status === 'not_applicable') return { label: '不适用', kind: 'complete' };
  if (disposition?.status === 'temporarily_missing') return { label: '暂缺', kind: 'pending' };
  if (Array.isArray(value)) return value.length ? { label: `已填${value.length}项`, kind: 'complete' } : { label: '待确认', kind: 'pending' };
  if (value && typeof value === 'object') {
    const filled = Object.values(value).filter(item => item !== '' && item !== null && (!Array.isArray(item) || item.length)).length;
    return filled ? { label: '已有内容', kind: 'complete' } : { label: '待补充', kind: 'pending' };
  }
  return value ? { label: '已有内容', kind: 'complete' } : { label: '待补充', kind: 'pending' };
}

function renderChecklist() {
  const container = byId('structureChecklist');
  container.replaceChildren();
  const documentValue = state.fillDocument || {};
  const errors = state.fillValidation?.errors || [];
  renderStructuredPreview();
  const sections = [
    ['流程基本信息', '/process', documentValue.process],
    ['业务行为', '/behaviors', documentValue.behaviors],
    ['流程关系', '/flow_relations', documentValue.flow_relations],
    ['待治理数据对象', '/data_objects', documentValue.data_objects],
    ['内部流程调用', '/internal_process_calls', documentValue.internal_process_calls],
    ['表单或记录', '/forms', documentValue.forms],
    ['术语', '/terms', documentValue.terms]
  ];
  for (const [label, path, value] of sections) {
    const relatedErrors = errors.filter(error => String(error.path || '/').startsWith(path));
    const status = sectionStatus(path, value, relatedErrors.length);
    const row = document.createElement('div');
    row.className = 'checklist-item';
    const name = document.createElement('strong');
    name.textContent = label;
    const badge = document.createElement('span');
    badge.className = `status-dot ${status.kind}`;
    badge.textContent = status.label;
    const note = document.createElement('small');
    note.textContent = relatedErrors[0]?.message || state.fieldStatuses.get(path)?.note || '状态只用于本次对话，不写入正式JSON。';
    row.append(name, badge, note);
    container.append(row);
  }

  const badge = byId('fillValidationBadge');
  if (state.fillValidation?.valid) {
    badge.textContent = '硬性结构通过';
    badge.className = 'validation-badge';
  } else if (state.fillValidation) {
    badge.textContent = `${errors.length}项结构错误`;
    badge.className = 'validation-badge';
  } else {
    badge.textContent = '待检查';
  }

  const statusList = byId('fieldStatusList');
  statusList.replaceChildren();
  if (!state.fieldStatuses.size) {
    const item = document.createElement('li');
    item.textContent = '模型尚未返回字段处置状态。';
    statusList.append(item);
  } else {
    for (const [path, value] of state.fieldStatuses.entries()) {
      const item = document.createElement('li');
      const left = document.createElement('span');
      left.textContent = path;
      const right = document.createElement('span');
      const labels = {
        confirmed: '已有明确值',
        temporarily_missing: '用户确认暂缺',
        not_applicable: '不适用'
      };
      right.textContent = `${labels[value.status] || value.status}${value.note ? ` · ${value.note}` : ''}`;
      item.append(left, right);
      statusList.append(item);
    }
  }
}

async function sendTurn() {
  if (state.locked) throw new Error('当前页面版本已变化，请先下载草稿。');
  const userMessage = byId('userMessageInput').value.trim();
  if (!userMessage) throw new Error('请输入本轮需要补充的信息。');
  const consent = assertMaterialConsent();
  const button = byId('sendTurnButton');
  setBusy(button, true, '正在按结构整理……');
  const previousMessages = conversationPayload(state.messages);
  appendChat('user', userMessage);
  byId('userMessageInput').value = '';
  try {
    const result = await api('/api/fill/turn', {
      method: 'POST',
      headers: { 'X-Request-ID': `web_${Date.now()}` },
      json: {
        expected_version: expectedVersion(),
        document: state.fillDocument,
        source_materials: state.materials,
        source_authorized: consent.authorized,
        source_deidentified: consent.deidentified,
        messages: previousMessages,
        field_statuses: [...state.fieldStatuses.values()],
        user_message: userMessage
      }
    });
    state.fillDocument = result.document;
    state.fillValidation = result.validation;
    state.fillDirty = true;
    result.field_statuses.forEach(item => state.fieldStatuses.set(item.path, item));
    appendChat('assistant', result.assistant_message, result.questions);
    renderFillJsonStatus();
    renderChecklist();
    showMessage(`右侧结构化预览已更新，本次模型用量为${result.usage?.total_tokens || 0}。`, 'success');
  } catch (error) {
    state.messages.pop();
    renderChatFromState();
    throw error;
  } finally {
    setBusy(button, false);
    updateActionAvailability();
  }
}

function renderChatFromState() {
  const messages = state.messages.slice();
  state.messages = [];
  resetChatDisplay();
  messages.forEach(message => appendChat(message.role, message.content, message.questions || []));
}

async function validateImportedDocument(documentValue) {
  const result = await api('/api/document/validate', {
    method: 'POST',
    json: {
      expected_version: expectedVersion(),
      document: documentValue
    }
  });
  return result;
}

async function importFillJson(file) {
  assertMaterialConsent();
  if (!file.name.toLowerCase().endsWith('.json')) {
    throw new Error('只支持导入.json文件。');
  }
  if (file.size > MAX_IMPORTED_JSON_BYTES) {
    throw new Error('JSON草稿超过2MB，暂不能处理。');
  }
  const hasCurrentWork = state.fillDirty
    || state.messages.length
    || state.materials.length
    || state.fillJsonFileName;
  if (
    hasCurrentWork
    && !window.confirm('导入后会用该JSON替换当前草稿，并清空现有对话和文字材料。确认继续吗？')
  ) {
    return;
  }
  const parsed = JSON.parse(await file.text());
  const validation = await validateImportedDocument(parsed);
  state.fillDocument = validation.data || parsed;
  state.fillValidation = { valid: validation.valid, errors: validation.errors };
  state.fillJsonFileName = file.name;
  state.fillDirty = false;
  state.materials = [];
  state.messages = [];
  state.fieldStatuses.clear();
  byId('pasteSourceInput').value = '';
  renderMaterials();
  resetChatDisplay();
  renderFillJsonStatus();
  renderChecklist();
  updateActionAvailability();
  showMessage(
    validation.valid
      ? '部分完成的3001格式JSON已导入，AI将从当前内容继续逐项追问。'
      : `JSON草稿已导入，当前有${validation.errors.length}项硬性结构错误；下一轮对话会先修复结构，再继续追问。`,
    validation.valid ? 'success' : 'error'
  );
}

function safeFilenamePart(value, fallback) {
  const cleaned = String(value || '')
    .trim()
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return cleaned || fallback;
}

function timestamp() {
  const date = new Date();
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function saveBlob(content, type, fileName) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadJson(documentValue, reviewed) {
  if (!documentValue) throw new Error('当前没有可下载的JSON。');
  const department = safeFilenamePart(documentValue.export_meta?.initiating_department, '未明确部门');
  const processName = safeFilenamePart(documentValue.process?.process_name, '未命名流程');
  const prefix = reviewed ? '结构预审后-未审核' : '未经独立预审-未审核';
  saveBlob(
    `${JSON.stringify(documentValue, null, 2)}\n`,
    'application/json;charset=utf-8',
    `${prefix}-${department}-${processName}-${timestamp()}.json`
  );
  if (documentValue === state.fillDocument) state.fillDirty = false;
  if (documentValue === state.reviewDocument) state.reviewDirty = false;
  if (state.locked) state.downloadedAfterLock = true;
}

async function resetFill() {
  if (
    (state.fillDirty || state.messages.length || state.materials.length || state.fillJsonFileName)
    && !window.confirm('当前页面内容不会自动保存。确认清空吗？')
  ) return;
  state.materials = [];
  state.messages = [];
  state.fieldStatuses.clear();
  state.fillJsonFileName = '';
  state.fillDirty = false;
  byId('safeInputCheck').checked = false;
  byId('pasteSourceInput').value = '';
  renderMaterials();
  resetChatDisplay();
  await loadTemplate();
}

async function loadReviewFile(file) {
  const parsed = JSON.parse(await file.text());
  const validation = await validateImportedDocument(parsed);
  state.reviewDocument = validation.data || parsed;
  state.reviewValidation = { valid: validation.valid, errors: validation.errors };
  state.reviewFileName = file.name;
  state.reviewIssues = [];
  state.dispositions.clear();
  state.reviewRunCompleted = false;
  state.reviewDirty = false;
  state.reviewPreviewMode = 'structure';
  state.reviewDiagramExpanded = false;
  byId('reviewFileStatus').textContent =
      `${file.name} · process-governance-v5 · ${validation.valid ? '当前硬性结构通过' : `${validation.errors.length}项硬性结构错误`}`;
  byId('reviewSummary').textContent =
    '文件已读取。开始独立结构预审后，这里会显示需要逐条处理的问题。';
  byId('reviewWorkspace').hidden = false;
  renderReviewIssues();
  renderReviewDocumentPreview();
  updateActionAvailability();
}

async function runReview() {
  const button = byId('runReviewButton');
  setBusy(button, true, '正在独立预审……');
  try {
    const result = await api('/api/review/run', {
      method: 'POST',
      headers: { 'X-Request-ID': `review_${Date.now()}` },
      json: {
        expected_version: expectedVersion(),
        document: state.reviewDocument
      }
    });
    state.reviewIssues = result.issues;
    state.reviewValidation = result.validation;
    state.dispositions.clear();
    state.reviewRunCompleted = true;
    byId('reviewSummary').textContent = result.summary || `共发现${result.issues.length}项结构问题。`;
    renderReviewIssues();
    renderReviewDocumentPreview();
    showMessage(`独立结构预审完成，本次模型用量为${result.usage?.total_tokens || 0}。`, 'success');
  } finally {
    setBusy(button, false);
    updateActionAvailability();
  }
}

function issueLabel(issue) {
  if (issue.severity === 'hard_error') return '硬性结构错误';
  return issue.category === 'object_split' ? '对象拆分建议' : '字段归位建议';
}

function renderReviewIssues() {
  const container = byId('reviewIssues');
  container.replaceChildren();
  if (!state.reviewIssues.length) {
    const empty = document.createElement('p');
    empty.textContent = state.reviewRunCompleted
      ? '未发现需要逐条处理的结构问题。'
      : '尚未开始独立结构预审。右侧可以先核对当前结构化内容和流程图。';
    container.append(empty);
  }
  state.reviewIssues.forEach(issue => {
    const disposition = state.dispositions.get(issue.id);
    const card = document.createElement('article');
    card.className = `issue-card ${issue.severity}${disposition ? ' resolved' : ''}`;
    const meta = document.createElement('div');
    meta.className = 'issue-meta';
    const type = document.createElement('span');
    type.textContent = issueLabel(issue);
    const path = document.createElement('code');
    path.textContent = issue.path || '/';
    meta.append(type, path);
    const title = document.createElement('h3');
    title.textContent = issue.title;
    const explanation = document.createElement('p');
    explanation.textContent = issue.explanation;
    card.append(meta, title, explanation);

    if (disposition) {
      const result = document.createElement('strong');
      result.textContent = disposition.action === 'apply'
        ? '已按建议修改'
        : `已保持原值；理由：${disposition.reason}`;
      card.append(result);
    } else {
      const actions = document.createElement('div');
      actions.className = 'button-row';
      const apply = document.createElement('button');
      apply.type = 'button';
      apply.className = 'button primary';
      apply.textContent = '按建议修改';
      apply.disabled = !issue.patch?.length;
      apply.addEventListener('click', () => {
        applyIssue(issue, 'apply', '').catch(error => showMessage(error.message, 'error'));
      });
      actions.append(apply);
      if (issue.severity === 'suggestion') {
        const keepRow = document.createElement('div');
        keepRow.className = 'keep-row';
        const reasonLabel = document.createElement('label');
        reasonLabel.textContent = '保持原值的理由';
        const reasonInput = document.createElement('input');
        reasonInput.placeholder = '说明为什么当前结构不调整';
        reasonLabel.append(reasonInput);
        const keep = document.createElement('button');
        keep.type = 'button';
        keep.className = 'button secondary';
        keep.textContent = '保持原值并记录理由';
        keep.addEventListener('click', () => {
          const reason = reasonInput.value.trim();
          if (!reason) {
            showMessage('保持原值时必须记录理由。', 'error');
            reasonInput.focus();
            return;
          }
          applyIssue(issue, 'keep', reason).catch(error => showMessage(error.message, 'error'));
        });
        keepRow.append(reasonLabel, keep);
        card.append(actions, keepRow);
      } else {
        if (!issue.patch?.length) {
          const note = document.createElement('p');
          note.textContent = '该硬性错误没有可自动执行的修复，请返回填报页修改JSON后重新预审。';
          card.append(actions, note);
        } else {
          card.append(actions);
        }
      }
    }
    container.append(card);
  });
  updateReviewCompletion();
}

async function applyIssue(issue, action, reason) {
  const result = await api('/api/review/apply', {
    method: 'POST',
    json: {
      expected_version: expectedVersion(),
      document: state.reviewDocument,
      issue,
      action,
      reason
    }
  });
  state.reviewDocument = result.document;
  state.reviewValidation = result.validation;
  state.dispositions.set(issue.id, result.disposition);
  state.reviewDirty = action === 'apply' || state.reviewDirty;
  renderReviewIssues();
  renderReviewDocumentPreview();
  showMessage(
    action === 'apply' ? '已按建议修改并重新校验。' : '已记录保持原值的理由。',
    'success'
  );
}

function updateReviewCompletion() {
  const pending = state.reviewIssues.filter(issue => !state.dispositions.has(issue.id)).length;
  const hardErrors = state.reviewValidation?.errors?.length || 0;
  const badge = byId('reviewValidationBadge');
  if (!state.reviewRunCompleted) {
    badge.textContent = state.reviewValidation?.valid
      ? '导入结构通过'
      : `${hardErrors}项结构错误`;
    byId('reviewCompletionText').textContent =
      '开始独立结构预审并处理完全部问题后，可以下载。';
    updateActionAvailability();
    return;
  }
  badge.textContent = state.reviewValidation?.valid ? '硬性结构通过' : `${hardErrors}项结构错误`;
  byId('reviewCompletionText').textContent = pending
    ? `还有${pending}项预审问题未确认。`
    : state.reviewValidation?.valid
      ? '全部预审问题已经确认，可下载预审后的JSON。'
      : `仍有${hardErrors}项硬性结构错误，请继续修改后重新预审。`;
  updateActionAvailability();
}

function csvCell(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function downloadReviewRecord() {
  if (!state.reviewIssues.length && !state.reviewFileName) throw new Error('当前没有预审记录。');
  const rows = [
    ['问题编号', '类型', '结构位置', '问题说明', '处理方式', '保持原值理由']
  ];
  state.reviewIssues.forEach(issue => {
    const disposition = state.dispositions.get(issue.id);
    rows.push([
      issue.id,
      issueLabel(issue),
      issue.path,
      `${issue.title}：${issue.explanation}`,
      disposition?.action === 'apply' ? '按建议修改' : disposition?.action === 'keep' ? '保持原值' : '未处理',
      disposition?.reason || ''
    ]);
  });
  saveBlob(
    `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\r\n')}\r\n`,
    'text/csv;charset=utf-8',
    `结构预审问题处理记录-${timestamp()}.csv`
  );
}

async function refreshBalance() {
  const button = byId('refreshBalanceButton');
  if (!state.apiKeyStatus.configured) {
    byId('balanceValue').textContent = '配置Key后可查询';
    updateActionAvailability();
    return;
  }
  button.disabled = true;
  try {
    const result = await api('/api/account/balance');
    state.apiKeyBalanceWarning = Boolean(result.warning);
    byId('balanceValue').textContent = formatBalance(result);
    renderApiKeyStatus();
  } finally {
    updateActionAvailability();
  }
}

function addMetric(container, label, value) {
  const card = document.createElement('div');
  card.className = 'admin-metric';
  const labelNode = document.createElement('span');
  labelNode.textContent = label;
  const valueNode = document.createElement('strong');
  valueNode.textContent = value;
  card.append(labelNode, valueNode);
  container.append(card);
}

async function loadAdminStatus() {
  const result = await api('/api/admin/status');
  const summary = byId('adminSummary');
  summary.replaceChildren();
  addMetric(summary, '应用提交', shortDigest(result.app_commit));
  addMetric(summary, '结构校验值', shortDigest(result.schema_digest));
  addMetric(summary, '模型请求数', String(result.usage.requestCount));
  addMetric(summary, '累计模型用量', String(result.usage.totalTokens));
  byId('maintenanceToggle').checked = Boolean(result.maintenance_mode.enabled);
  byId('maintenanceMessage').value = result.maintenance_mode.message || '';
  byId('entryModeSelect').value = result.entry_mode?.mode || 'dsh';
  byId('entryModeReason').value = '';
  const rows = byId('adminKeyStatusRows');
  rows.replaceChildren();
  const dshStatuses = new Map((result.account_dsh_statuses || []).map(item => [item.account_id, item]));
  result.account_key_statuses.forEach(status => {
    const row = document.createElement('tr');
    const values = [
      status.display_name,
      status.key_configured ? '存在有效Key会话' : '未配置',
      String(status.active_key_sessions),
      String(dshStatuses.get(status.account_id)?.active_dsh_runtimes || 0)
    ];
    values.forEach(value => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    rows.append(row);
  });
}

async function saveMaintenance() {
  const enabled = byId('maintenanceToggle').checked;
  const message = byId('maintenanceMessage').value;
  await api('/api/admin/maintenance', {
    method: 'POST',
    json: { enabled, message }
  });
  await loadContext({ initial: false });
  await loadAdminStatus();
  showMessage(enabled ? '维护状态已开启，新的模型请求已经停止。' : '维护状态已解除。', 'success');
}

async function saveEntryMode() {
  const mode = byId('entryModeSelect').value;
  const reason = byId('entryModeReason').value.trim();
  const result = await api('/api/admin/entry-mode', {
    method: 'PUT',
    json: { mode, reason }
  });
  await loadContext({ initial: false });
  await loadAdminStatus();
  showMessage(
    result.entry_mode.mode === 'dsh'
      ? '统一入口已切换为DSH治理工作区。'
      : '统一入口已切换为经典页面；现有DSH实例不会被终止。',
    'success'
  );
}

function workspaceContent() {
  return {
    fillDocument: state.fillDocument,
    fillValidation: state.fillValidation,
    fillJsonFileName: state.fillJsonFileName,
    materials: state.materials,
    messages: state.messages,
    fieldStatuses: [...state.fieldStatuses.entries()],
    fillDirty: state.fillDirty,
    reviewDocument: state.reviewDocument,
    reviewValidation: state.reviewValidation,
    reviewFileName: state.reviewFileName,
    reviewIssues: state.reviewIssues,
    dispositions: [...state.dispositions.entries()],
    reviewRunCompleted: state.reviewRunCompleted,
    reviewDirty: state.reviewDirty,
    reviewPreviewMode: state.reviewPreviewMode,
    activeView: state.activeView
  };
}

function renderWorkspaceControl() {
  if (!IS_DSH_ENTRY) return;
  const select = byId('dshWorkspaceSelect');
  const status = byId('dshWorkspaceStatus');
  select.replaceChildren();
  if (!state.dshWorkspaces.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '尚未创建治理工作区';
    select.append(option);
  } else {
    state.dshWorkspaces.forEach(workspace => {
      const option = document.createElement('option');
      option.value = workspace.id;
      option.textContent = `${workspace.name} · r${workspace.revision}`;
      option.selected = workspace.id === state.dshWorkspaceId;
      select.append(option);
    });
  }
  if (state.dshConflict) {
    status.textContent = '其他标签页已经保存新版本。当前未提交输入仍保留在本页；请重新选择当前案例以加载最新状态。';
  } else if (state.dshWorkspaceId) {
    const current = state.dshWorkspaces.find(item => item.id === state.dshWorkspaceId);
    status.textContent = `${current?.name || '当前案例'} · 版本r${state.dshWorkspaceRevision} · 仅保存在当前登录会话的DSH内存中`;
  } else {
    status.textContent = '先输入案例名称并新建工作区。未新建时仍可读取模板、导入、校验、编辑和下载，但不能调用模型。';
  }
  select.disabled = !state.dshWorkspaces.length;
  byId('reloadDshWorkspaceButton').hidden = !state.dshConflict;
  byId('endDshWorkspaceButton').disabled = !state.dshWorkspaceId;
  updateActionAvailability();
}

async function resetWorkspaceContent() {
  await loadTemplate();
  state.materials = [];
  state.messages = [];
  state.fieldStatuses.clear();
  state.reviewDocument = null;
  state.reviewValidation = null;
  state.reviewFileName = '';
  state.reviewIssues = [];
  state.dispositions.clear();
  state.reviewRunCompleted = false;
  state.reviewDirty = false;
  state.reviewPreviewMode = 'structure';
  state.activeView = 'fill';
  renderMaterials();
  renderChatFromState();
  renderChecklist();
  renderStructuredPreview();
  renderReviewIssues();
  updateReviewCompletion();
  selectView('fill');
}

async function applyWorkspaceState(result) {
  state.dshWorkspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
  state.dshWorkspaceId = result.active_workspace_id || null;
  state.dshWorkspaceRevision = Number(result.workspace?.revision || 0);
  state.dshConflict = false;
  const content = result.workspace?.content;
  if (!content) {
    await resetWorkspaceContent();
  } else {
    state.fillDocument = content.fillDocument || state.fillDocument;
    state.fillValidation = content.fillValidation || null;
    state.fillJsonFileName = String(content.fillJsonFileName || '');
    state.materials = Array.isArray(content.materials) ? content.materials : [];
    state.messages = Array.isArray(content.messages) ? content.messages : [];
    state.fieldStatuses = new Map(Array.isArray(content.fieldStatuses) ? content.fieldStatuses : []);
    state.fillDirty = Boolean(content.fillDirty);
    state.reviewDocument = content.reviewDocument || null;
    state.reviewValidation = content.reviewValidation || null;
    state.reviewFileName = String(content.reviewFileName || '');
    state.reviewIssues = Array.isArray(content.reviewIssues) ? content.reviewIssues : [];
    state.dispositions = new Map(Array.isArray(content.dispositions) ? content.dispositions : []);
    state.reviewRunCompleted = Boolean(content.reviewRunCompleted);
    state.reviewDirty = Boolean(content.reviewDirty);
    state.reviewPreviewMode = content.reviewPreviewMode === 'diagram' ? 'diagram' : 'structure';
    state.activeView = ['fill', 'review', 'admin'].includes(content.activeView) ? content.activeView : 'fill';
    renderMaterials();
    renderChatFromState();
    renderFillJsonStatus();
    renderChecklist();
    renderStructuredPreview();
    renderReviewIssues();
    updateReviewCompletion();
    if (state.reviewDocument) renderReviewDocumentPreview();
    selectView(state.activeView);
  }
  state.dshLastSnapshot = JSON.stringify(workspaceContent());
  renderWorkspaceControl();
}

async function loadDshWorkspaceState() {
  if (!IS_DSH_ENTRY) return;
  await applyWorkspaceState(await api('/infomat-state'));
}

async function flushDshWorkspace(options = {}) {
  if (!IS_DSH_ENTRY || !state.dshWorkspaceId || state.dshConflict || state.dshSaveInFlight) return;
  const content = workspaceContent();
  const snapshot = JSON.stringify(content);
  if (snapshot === state.dshLastSnapshot) return;
  state.dshSaveInFlight = true;
  try {
    const result = await api(`/infomat-state/workspaces/${encodeURIComponent(state.dshWorkspaceId)}`, {
      method: 'PUT',
      json: {
        expected_revision: state.dshWorkspaceRevision,
        content
      },
      keepalive: Boolean(options.keepalive)
    });
    state.dshWorkspaceRevision = Number(result.workspace?.revision || state.dshWorkspaceRevision + 1);
    state.dshWorkspaces = result.workspaces || state.dshWorkspaces;
    state.dshLastSnapshot = snapshot;
    renderWorkspaceControl();
  } catch (error) {
    if (error.code === 'STATE_CONFLICT') {
      state.dshConflict = true;
      renderWorkspaceControl();
      showMessage('其他标签页已经保存新版本。当前输入仍保留，请重新加载当前案例后再继续。', 'error');
      return;
    }
    throw error;
  } finally {
    state.dshSaveInFlight = false;
  }
}

async function createDshWorkspace() {
  const input = byId('dshWorkspaceName');
  const name = input.value.trim();
  const result = await api('/infomat-state/workspaces', {
    method: 'POST',
    json: { name }
  });
  input.value = '';
  state.dshWorkspaces = result.workspaces;
  state.dshWorkspaceId = result.active_workspace_id;
  state.dshWorkspaceRevision = Number(result.workspace?.revision || 0);
  state.dshLastSnapshot = '';
  state.dshConflict = false;
  renderWorkspaceControl();
  await flushDshWorkspace();
  showMessage('治理工作区已创建，当前草稿已绑定到该案例。', 'success');
}

async function switchDshWorkspace(workspaceId) {
  if (!workspaceId || workspaceId === state.dshWorkspaceId && !state.dshConflict) return;
  await flushDshWorkspace();
  const result = await api('/infomat-state/active', {
    method: 'PUT',
    json: { workspace_id: workspaceId }
  });
  await applyWorkspaceState(result);
}

async function reloadDshWorkspace() {
  if (!state.dshWorkspaceId) return;
  if (!window.confirm('重新加载会用DSH中的最新版本替换本页尚未提交的输入。确认继续吗？')) return;
  const result = await api('/infomat-state/active', {
    method: 'PUT',
    json: { workspace_id: state.dshWorkspaceId }
  });
  await applyWorkspaceState(result);
}

async function endDshWorkspace() {
  if (!state.dshWorkspaceId) return;
  const current = state.dshWorkspaces.find(item => item.id === state.dshWorkspaceId);
  if (!window.confirm(`结束“${current?.name || '当前案例'}”后，该案例的材料、对话和草稿将从当前会话内存中清除。请先下载需要保留的文件。确认继续吗？`)) return;
  const result = await api(`/infomat-state/workspaces/${encodeURIComponent(state.dshWorkspaceId)}`, {
    method: 'DELETE',
    json: {}
  });
  await applyWorkspaceState(result);
  showMessage('当前治理工作区已经结束。', 'success');
}

function startDshAutosave() {
  if (!IS_DSH_ENTRY || state.dshPollTimer) return;
  state.dshPollTimer = window.setInterval(() => {
    flushDshWorkspace().catch(error => showMessage(error.message, 'error'));
  }, 1000);
}

async function startDshAndEnter() {
  const result = await api('/api/dsh/runtime', { method: 'POST', json: {} });
  window.location.assign(result.entry_url);
}

async function initializeAuthenticated(user) {
  state.user = user;
  state.csrfToken = user.csrfToken;
  await loadContext({ initial: true });
  const shouldEnterDsh = !IS_DSH_ENTRY
    && state.context.entry_mode === 'dsh'
    && (!IS_CLASSIC_ROUTE || user.role !== 'admin');
  if (shouldEnterDsh) {
    try {
      await startDshAndEnter();
      return;
    } catch (error) {
      showMessage(`${error.message} 当前页面继续作为应急入口。`, 'error');
    }
  }
  if (IS_DSH_ENTRY) {
    try {
      await api('/api/dsh/runtime', { method: 'POST', json: {} });
    } catch (error) {
      if (error.code === 'ENTRY_MODE_CLASSIC' && state.context.classic_url) {
        window.location.assign(state.context.classic_url);
        return;
      }
      throw error;
    }
  }
  showApp();
  await loadTemplate();
  if (IS_DSH_ENTRY) {
    await loadDshWorkspaceState();
    startDshAutosave();
  }
  await loadApiKeyStatus({ promptIfMissing: true });
  renderMaterials();
  resetChatDisplay();
  renderChecklist();
  if (state.apiKeyStatus.configured) {
    refreshBalance().catch(error => {
      byId('balanceValue').textContent = error.message;
    });
  }
  state.pollTimer = window.setInterval(() => {
    loadContext({ initial: false }).catch(error => showMessage(error.message, 'error'));
  }, 30000);
}

async function tryExistingSession() {
  try {
    const result = await api('/api/auth/me');
    if (!result.authenticated || !result.user) {
      showLogin();
      return;
    }
    await initializeAuthenticated(result.user);
  } catch (_) {
    showLogin();
  }
}

byId('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.submitter;
  setBusy(button, true, '正在登录……');
  try {
    const result = await api('/api/auth/login', {
      method: 'POST',
      json: {
        username: byId('usernameInput').value,
        password: byId('passwordInput').value
      }
    });
    byId('passwordInput').value = '';
    await initializeAuthenticated(result.user);
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
});

byId('logoutButton').addEventListener('click', async () => {
  try {
    await api('/api/auth/logout', { method: 'POST', json: {} });
  } finally {
    window.location.reload();
  }
});

byId('openApiKeyButton').addEventListener('click', openApiKeyDialog);
byId('cancelApiKeyButton').addEventListener('click', closeApiKeyDialog);
byId('clearApiKeyButton').addEventListener('click', () => {
  clearApiKey().catch(error => showMessage(error.message, 'error'));
});
byId('apiKeyForm').addEventListener('submit', event => {
  configureApiKey(event).catch(error => showMessage(error.message, 'error'));
});

document.querySelectorAll('.tab[data-view]').forEach(button => {
  button.addEventListener('click', () => selectView(button.dataset.view));
});

byId('sourceFileInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    await addFileMaterial(file);
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

byId('addPasteButton').addEventListener('click', () => {
  addPastedMaterial().catch(error => showMessage(error.message, 'error'));
});

byId('sendTurnButton').addEventListener('click', () => {
  sendTurn().catch(error => showMessage(error.message, 'error'));
});

byId('userMessageInput').addEventListener('keydown', event => {
  if (event.isComposing || !event.ctrlKey || event.key !== 'Enter') return;
  event.preventDefault();
  sendTurn().catch(error => showMessage(error.message, 'error'));
});

byId('fillJsonInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    await importFillJson(file);
  } catch (error) {
    showMessage(`JSON导入失败：${error.message}`, 'error');
  }
});

byId('downloadDraftButton').addEventListener('click', () => {
  try {
    downloadJson(state.fillDocument, false);
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

byId('resetFillButton').addEventListener('click', () => {
  resetFill().catch(error => showMessage(error.message, 'error'));
});

byId('reviewJsonInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  try {
    await loadReviewFile(file);
  } catch (error) {
    showMessage(`JSON读取失败：${error.message}`, 'error');
  }
});

byId('runReviewButton').addEventListener('click', () => {
  runReview().catch(error => showMessage(error.message, 'error'));
});

for (const button of document.querySelectorAll('[data-review-preview]')) {
  button.addEventListener('click', () => {
    setReviewPreviewMode(button.dataset.reviewPreview);
  });
}

byId('fitReviewDiagramButton').addEventListener('click', () => {
  reviewDiagramView?.fit();
});

byId('resetReviewDiagramButton').addEventListener('click', () => {
  reviewDiagramView?.reset();
});

byId('expandReviewDiagramButton').addEventListener('click', () => {
  state.reviewDiagramExpanded = !state.reviewDiagramExpanded;
  renderReviewDocumentPreview();
});

byId('downloadReviewCsvButton').addEventListener('click', () => {
  try {
    downloadReviewRecord();
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

byId('downloadReviewedJsonButton').addEventListener('click', () => {
  try {
    downloadJson(state.reviewDocument, true);
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

byId('refreshBalanceButton').addEventListener('click', () => {
  refreshBalance().catch(error => showMessage(error.message, 'error'));
});

byId('openStructuredToolButton').addEventListener('click', () => {
  if (!state.context?.structured_tool_url) {
    showMessage('结构化工具入口尚未就绪。', 'error');
    return;
  }
  window.open(state.context.structured_tool_url, '_blank', 'noopener');
});

byId('refreshAdminButton').addEventListener('click', () => {
  loadAdminStatus().catch(error => showMessage(error.message, 'error'));
});

byId('saveMaintenanceButton').addEventListener('click', () => {
  saveMaintenance().catch(error => showMessage(error.message, 'error'));
});

byId('saveEntryModeButton').addEventListener('click', () => {
  saveEntryMode().catch(error => showMessage(error.message, 'error'));
});

if (IS_DSH_ENTRY) {
  byId('createDshWorkspaceButton').addEventListener('click', () => {
    createDshWorkspace().catch(error => showMessage(error.message, 'error'));
  });
  byId('dshWorkspaceSelect').addEventListener('change', event => {
    switchDshWorkspace(event.target.value).catch(error => showMessage(error.message, 'error'));
  });
  byId('reloadDshWorkspaceButton').addEventListener('click', () => {
    reloadDshWorkspace().catch(error => showMessage(error.message, 'error'));
  });
  byId('endDshWorkspaceButton').addEventListener('click', () => {
    endDshWorkspace().catch(error => showMessage(error.message, 'error'));
  });
}

byId('versionDownloadButton').addEventListener('click', () => {
  try {
    const documentValue = currentDraftForDownload();
    downloadJson(documentValue, documentValue === state.reviewDocument);
  } catch (error) {
    showMessage(error.message, 'error');
  }
});

byId('versionRefreshButton').addEventListener('click', () => {
  if ((state.fillDirty || state.reviewDirty) && !state.downloadedAfterLock) {
    showMessage('请先下载当前草稿，再刷新页面。', 'error');
    return;
  }
  window.location.reload();
});

window.addEventListener('beforeunload', event => {
  if (IS_DSH_ENTRY) void flushDshWorkspace({ keepalive: true });
  if (!state.fillDirty && !state.reviewDirty) return;
  event.preventDefault();
  event.returnValue = '';
});

tryExistingSession();
