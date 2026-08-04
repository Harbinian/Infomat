(function installMdmProcessEditorAdapter() {
  const nativeFetch = window.fetch.bind(window);
  const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
  let csrfToken = '';
  let csrfPromise = null;
  const mdmState = {
    me: null,
    drafts: [],
    ready: false
  };

  function requestUrl(input) {
    if (typeof input === 'string') return input;
    return input && input.url ? input.url : '';
  }

  async function loadCsrfToken() {
    if (csrfToken) return csrfToken;
    if (!csrfPromise) {
      csrfPromise = nativeFetch('/api/csrf-token', { credentials: 'same-origin', cache: 'no-store' })
        .then(response => {
          if (!response.ok) throw new Error('无法取得安全校验信息');
          return response.json();
        })
        .then(body => {
          csrfToken = body.csrfToken || '';
          return csrfToken;
        })
        .finally(() => {
          csrfPromise = null;
        });
    }
    return csrfPromise;
  }

  window.fetch = async function mdmEditorFetch(input, options) {
    const requestOptions = { credentials: 'same-origin', ...(options || {}) };
    const method = String(requestOptions.method || (input && input.method) || 'GET').toUpperCase();
    const url = requestUrl(input);
    if (unsafeMethods.has(method) && url.indexOf('/api/') === 0 && url !== '/api/org/login') {
      const headers = new Headers(requestOptions.headers || {});
      const token = await loadCsrfToken();
      if (token) headers.set('X-CSRF-Token', token);
      requestOptions.headers = headers;
    }
    return nativeFetch(input, requestOptions);
  };

  async function api(path, options) {
    const response = await window.fetch(path, {
      cache: 'no-store',
      ...(options || {}),
      headers: {
        'Content-Type': 'application/json',
        ...((options && options.headers) || {})
      }
    });
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const body = contentType.includes('application/json') ? await response.json() : {};
    if (!response.ok) {
      const error = new Error(body.error || `请求失败（HTTP ${response.status}）`);
      error.status = response.status;
      error.code = body.code || '';
      error.payload = body;
      throw error;
    }
    return body;
  }

  function entry() {
    return typeof currentEntry === 'function' ? currentEntry() : null;
  }

  function roleCodes() {
    return Array.isArray(mdmState.me && mdmState.me.roleCodes) ? mdmState.me.roleCodes : [];
  }

  function canCreateOrEdit() {
    const roles = roleCodes();
    return roles.includes('department_contact') && !roles.includes('admin');
  }

  function entryCanEdit(value = entry()) {
    if (!value || !canCreateOrEdit()) return false;
    if (!value.mdmDraftId) return true;
    return ['draft', 'needs_changes'].includes(value.mdmStatus || 'draft');
  }

  function statusLabel(status) {
    return {
      draft: '草稿',
      submitted: '已提交',
      under_review: '审核中',
      needs_changes: '退回修改',
      approved: '已审核',
      published: '已发布',
      rejected: '已拒绝'
    }[status] || status || '草稿';
  }

  function draftLabel(draft) {
    const title = draft.process_name || draft.document_title || draft.document_no || `草稿 ${draft.id}`;
    return `${title} · ${statusLabel(draft.status)} · 修订 ${Number(draft.revision_no || 0)}`;
  }

  function optionHtml(value, label, selected) {
    return `<option value="${String(value).replace(/"/g, '&quot;')}"${selected ? ' selected' : ''}>${String(label)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')}</option>`;
  }

  function postStateToParent() {
    const current = entry();
    window.parent.postMessage({
      type: 'mdm-process-editor-state',
      dirty: Boolean(current && current.dirty),
      draftId: current && current.mdmDraftId || null
    }, window.location.origin);
  }

  function postHeightToParent() {
    const height = Math.max(
      document.documentElement.scrollHeight,
      document.body && document.body.scrollHeight || 0,
      720
    );
    window.parent.postMessage({ type: 'mdm-process-editor-height', height }, window.location.origin);
  }

  function scheduleParentUpdate() {
    window.requestAnimationFrame(() => {
      postStateToParent();
      postHeightToParent();
    });
  }

  function lockEditorForCurrentRole() {
    const editable = entryCanEdit();
    document.body.classList.toggle('mdm-readonly', Boolean(entry()) && !editable);
    document.querySelectorAll('#workspace [data-bind], #workspace [data-list-bind], #workspace [data-actor-department], #workspace [data-actor-position]')
      .forEach(control => {
        if (control.matches('input, select, textarea')) control.disabled = !editable;
      });
    document.querySelectorAll('#workspace [data-action]').forEach(button => {
      const action = button.dataset.action || '';
      if (action === 'new-process-inline') {
        button.disabled = !canCreateOrEdit();
      } else if (/^(add|remove|move)-/.test(action)) {
        button.disabled = !editable;
      }
    });
  }

  function updateToolbar() {
    const current = entry();
    const select = document.getElementById('mdmDraftSelect');
    if (select) {
      const selectedId = current && current.mdmDraftId ? String(current.mdmDraftId) : '';
      select.innerHTML = optionHtml('', mdmState.drafts.length ? '选择一条MDM草稿' : '暂无可查看草稿', !selectedId)
        + mdmState.drafts.map(draft => optionHtml(draft.id, draftLabel(draft), String(draft.id) === selectedId)).join('');
    }
    const canEdit = entryCanEdit(current);
    const hasDraft = Boolean(current && current.mdmDraftId);
    const saveButton = document.getElementById('mdmSaveButton');
    const submitButton = document.getElementById('mdmSubmitButton');
    const newButton = document.getElementById('newProcessButton');
    const importButton = document.getElementById('importJsonButton');
    const clearButton = document.getElementById('clearButton');
    if (saveButton) saveButton.disabled = !canEdit || !current || !current.dirty;
    if (submitButton) submitButton.disabled = !canEdit || !hasDraft || Boolean(current.dirty);
    if (newButton) newButton.disabled = !canCreateOrEdit();
    if (importButton) importButton.disabled = !canCreateOrEdit();
    if (clearButton) clearButton.disabled = !current;
    const meta = document.getElementById('mdmDraftMeta');
    if (meta) {
      meta.textContent = current
        ? `${hasDraft ? `MDM草稿 #${current.mdmDraftId}` : '尚未保存到MDM'} · ${statusLabel(current.mdmStatus)}`
          + `${hasDraft ? ` · 修订 ${Number(current.mdmRevision || 0)}` : ''}`
          + `${current.dirty ? ' · 有未保存修改' : ''}`
        : canCreateOrEdit()
          ? '新建流程，或选择已有草稿继续编制'
          : '当前账号只读，请选择已有草稿查看';
    }
    if (typeof updateCandidateBar === 'function' && current && candidateNote) {
      candidateNote.textContent = current.mdmDraftId
        ? `当前内容来自MDM草稿 #${current.mdmDraftId}；修改后必须点击“保存草稿”。`
        : '当前内容尚未保存到MDM。';
    }
    lockEditorForCurrentRole();
    scheduleParentUpdate();
  }

  async function refreshDrafts(preferredDraftId) {
    const result = await api('/api/process-design/drafts?limit=100');
    mdmState.drafts = Array.isArray(result.items) ? result.items : [];
    if (preferredDraftId) {
      const selected = mdmState.drafts.find(draft => Number(draft.id) === Number(preferredDraftId));
      if (selected && entry()) entry().mdmStatus = selected.status;
    }
    updateToolbar();
    return mdmState.drafts;
  }

  async function loadDraft(draftId) {
    if (!draftId) throw new Error('请先选择一条MDM草稿');
    if (typeof hasDirtyCandidates === 'function' && hasDirtyCandidates()) {
      throw new Error('当前还有未保存修改，请先保存草稿或关闭当前草稿');
    }
    if (typeof setBusy === 'function') setBusy(true, '正在读取MDM草稿……');
    try {
      const content = await api(`/api/process-design/drafts/${encodeURIComponent(draftId)}/content`);
      const draft = mdmState.drafts.find(item => Number(item.id) === Number(draftId)) || {};
      if (typeof destroyDiagram === 'function') destroyDiagram();
      candidates = [{
        data: normalizeV1(content.document),
        dirty: false,
        origin: 'mdm',
        mdmDraftId: Number(draftId),
        mdmRevision: Number(content.revision || 0),
        mdmStatus: draft.status || 'draft'
      }];
      currentIndex = 0;
      openedPreviewProcesses.clear();
      selectInitialTabAfterImport();
      render();
      showStatus(`已打开MDM草稿 #${draftId}，当前修订为 ${Number(content.revision || 0)}。`, 'success');
    } finally {
      if (typeof setBusy === 'function') setBusy(false);
      updateToolbar();
    }
  }

  async function saveWithVoidReasons(current, voidedHandoffs) {
    const content = clone(current.data);
    if (!String(content.process && content.process.process_name || '').trim()) {
      throw new Error('请先填写流程名称，再保存草稿');
    }
    if (!String(content.process && content.process.owning_department || '').trim()) {
      throw new Error('请先选择归口部门，再保存草稿');
    }
    if (current.mdmDraftId) {
      const result = await api(`/api/process-design/drafts/${encodeURIComponent(current.mdmDraftId)}/content`, {
        method: 'PUT',
        body: JSON.stringify({
          expected_revision: Number(current.mdmRevision || 0),
          content,
          voided_handoffs: voidedHandoffs || []
        })
      });
      current.mdmRevision = Number(result.revision || current.mdmRevision || 0);
      current.data = normalizeV1(result.document || content);
      return result;
    }
    const result = await api('/api/process-design/drafts/canonical', {
      method: 'POST',
      body: JSON.stringify({
        content,
        voided_handoffs: voidedHandoffs || []
      })
    });
    current.mdmDraftId = Number(result.draft && result.draft.id);
    current.mdmRevision = Number(result.content && result.content.revision || 0);
    current.mdmStatus = result.draft && result.draft.status || 'draft';
    current.data = normalizeV1(result.content && result.content.document || content);
    return result.content || result;
  }

  window.saveCurrentDraft = async function saveCurrentDraft() {
    const current = entry();
    if (!current) {
      showStatus('请先新建流程、导入3001文件或打开MDM草稿。', 'error');
      return false;
    }
    if (!entryCanEdit(current)) {
      showStatus('当前账号或草稿状态不允许修改。管理员对治理材料只读。', 'error');
      return false;
    }
    if (typeof setBusy === 'function') setBusy(true, '正在保存MDM草稿……');
    try {
      let result;
      try {
        result = await saveWithVoidReasons(current, []);
      } catch (error) {
        if (error.code !== 'HANDOFF_VOID_REASON_REQUIRED') throw error;
        const handoffRef = error.payload && error.payload.handoff_ref || '';
        const reason = window.prompt(`承接 ${handoffRef || ''} 已有治理记录，不能直接删除。请填写作废原因：`);
        if (!String(reason || '').trim()) throw new Error('未填写承接作废原因，草稿未保存');
        result = await saveWithVoidReasons(current, [{ handoff_ref: handoffRef, reason: String(reason).trim() }]);
      }
      current.dirty = false;
      current.mdmRevision = Number(result.revision || current.mdmRevision || 0);
      current.mdmStatus = current.mdmStatus || 'draft';
      await refreshDrafts(current.mdmDraftId);
      render();
      showStatus(`草稿已保存到MDM，当前修订为 ${current.mdmRevision}。`, 'success');
      return true;
    } catch (error) {
      if (error.code === 'DRAFT_REVISION_CONFLICT') {
        showStatus(`保存失败：草稿已被其他人员修改，服务器当前修订为 ${Number(error.payload.current_revision || 0)}。请重新打开草稿后再编辑。`, 'error');
      } else {
        showStatus(`保存失败：${error.message}`, 'error');
      }
      return false;
    } finally {
      if (typeof setBusy === 'function') setBusy(false);
      updateToolbar();
    }
  };

  async function submitCurrentDraft() {
    const current = entry();
    if (!current || !current.mdmDraftId) throw new Error('请先保存流程草稿');
    if (current.dirty) throw new Error('请先保存当前修改，再提交审核');
    if (!entryCanEdit(current)) throw new Error('当前账号或草稿状态不允许提交审核');
    const result = await api(`/api/process-design/drafts/${encodeURIComponent(current.mdmDraftId)}/submit`, {
      method: 'POST',
      body: JSON.stringify({ note: '从MDM单流程治理编制工作台提交审核' })
    });
    current.mdmStatus = result.draft && result.draft.status || 'submitted';
    await refreshDrafts(current.mdmDraftId);
    render();
    showStatus('草稿已提交归口部门审核。', 'success');
  }

  function installRuntimeHooks() {
    const originalRender = render;
    render = function renderWithMdmState() {
      originalRender();
      updateToolbar();
    };
    const originalTouch = touch;
    touch = function touchWithMdmState() {
      originalTouch();
      updateToolbar();
    };
    const originalNewProcess = startNewProcess;
    startNewProcess = async function startNewMdmProcess() {
      await originalNewProcess();
      const current = entry();
      if (current) {
        current.mdmDraftId = null;
        current.mdmRevision = 0;
        current.mdmStatus = 'draft';
        current.dirty = true;
      }
      updateToolbar();
    };
    const originalImport = importJson;
    importJson = async function importMdmProcess(file) {
      await originalImport(file);
      candidates.forEach(candidate => {
        candidate.mdmDraftId = null;
        candidate.mdmRevision = 0;
        candidate.mdmStatus = 'draft';
        candidate.dirty = true;
      });
      updateToolbar();
    };
  }

  async function initialize() {
    installRuntimeHooks();
    document.body.classList.add('mdm-embedded');
    document.getElementById('mdmOpenDraftButton').addEventListener('click', async () => {
      try {
        await loadDraft(document.getElementById('mdmDraftSelect').value);
      } catch (error) {
        showStatus(error.message, 'error');
      }
    });
    document.getElementById('mdmSaveButton').addEventListener('click', window.saveCurrentDraft);
    document.getElementById('mdmSubmitButton').addEventListener('click', async () => {
      try {
        await submitCurrentDraft();
      } catch (error) {
        showStatus(`提交失败：${error.message}`, 'error');
      } finally {
        updateToolbar();
      }
    });
    mdmState.me = await api('/api/org/me');
    await refreshDrafts();
    mdmState.ready = true;
    updateToolbar();
    if (typeof ResizeObserver === 'function') {
      new ResizeObserver(postHeightToParent).observe(document.body);
    }
    postHeightToParent();
  }

  window.addEventListener('DOMContentLoaded', () => {
    initialize().catch(error => {
      const status = document.getElementById('statusBox');
      if (status) {
        status.className = 'status error show';
        status.textContent = `MDM编制工作台加载失败：${error.message}`;
      }
    });
  });
})();
