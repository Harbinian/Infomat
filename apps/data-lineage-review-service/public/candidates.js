import { describeLocation, fieldLabel, tableLabel, referenceLabel } from '/field-presentation.js';

const scopeLabels = { first_batch: '首批目标', selectable: '底册内待选', missing: '待补底册', in_batch: '已纳入后续批次' };
const evidenceLabels = { has_evidence: '已有取值、生成或计算依据', needs_verification: '待核证' };
const canDraft = target => target.scope === 'selectable' || target.scope === 'missing';

export function bindCandidateBrowser({ request, openTarget, compareTarget, getFields }) {
  const byId = id => document.getElementById(id);
  const panel = byId('candidate-panel');
  const list = byId('candidate-list');
  const summary = byId('candidate-summary');
  const search = byId('candidate-search');
  const scope = byId('candidate-scope');
  const result = byId('candidate-result');
  const detail = byId('candidate-detail');
  const title = byId('candidate-title');
  const note = byId('candidate-note');
  const references = byId('candidate-references');
  const open = byId('candidate-open-field');
  const compare = byId('candidate-compare-field');
  const choose = byId('candidate-select');
  const download = byId('candidate-export');
  const importDraft = byId('candidate-import');
  const fileInput = byId('candidate-file');
  const checkDraft = byId('candidate-check');
  const checkMessage = byId('candidate-check-message');
  const previewPanel = byId('candidate-preview');
  const previewTitle = byId('candidate-preview-title');
  const previewCount = byId('candidate-preview-count');
  const previewTargets = byId('candidate-preview-targets');
  const merge = byId('candidate-merge');
  const batchName = byId('candidate-batch-name');
  const exportPlan = byId('candidate-plan');
  let loading;
  let data;
  let selected;
  let busy = false;
  let storageKey;
  let storageAvailable = true;
  let checking = false;
  let preview;
  let previewKind;
  const draft = new Set();
  title.tabIndex = -1;

  function describe(target) {
    return describeLocation(target.system, target.table, target.name, getFields());
  }

  function updateOpen() {
    open.disabled = busy || !selected?.fieldId;
    compare.disabled = busy || !selected?.fieldId;
  }

  function showDetail(target) {
    selected = target;
    detail.hidden = !target;
    if (!target) return;
    title.textContent = describe(target);
    note.textContent = scopeLabels[target.scope] + (target.fieldId ? '。父级供核证，选定目标字段后可打开矩阵。'
      : '。拟选后需先补入底册，才能打开矩阵。');
    references.replaceChildren(...target.references.map(reference => {
      const section = document.createElement('section');
      section.className = 'candidate-reference';
      const heading = document.createElement('h3');
      heading.textContent = reference.id + ' · ' + evidenceLabels[reference.evidenceStatus];
      const parent = document.createElement('p');
      parent.textContent = '父级参考　' + describe({ ...reference.parent, name: target.name });
      const evidence = document.createElement('p');
      evidence.textContent = '已有依据　' + referenceLabel(reference.evidence, getFields());
      const pending = document.createElement('p');
      pending.textContent = '待确认　' + referenceLabel(reference.pending, getFields());
      section.append(heading, parent, evidence, pending);
      return section;
    }));
    choose.checked = draft.has(target.id);
    choose.closest('label').hidden = !canDraft(target) && !draft.has(target.id);
    updateOpen();
  }

  function render() {
    const keywords = search.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const visible = data.targets.filter(target => {
      const included = scope.value === 'all' || scope.value === target.scope ||
        (scope.value === 'outside' && canDraft(target)) ||
        (scope.value === 'draft' && draft.has(target.id));
      const text = [describe(target), target.table + '.' + target.name, ...target.references.map(reference => reference.parent.table + '.' + target.name), ...target.references.map(reference =>
        describe({ ...reference.parent, name: target.name }))].join(' ').toLowerCase();
      return included && keywords.every(keyword => text.includes(keyword));
    });
    if (!visible.includes(selected)) showDetail(null);
    list.replaceChildren(...visible.map(target => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const label = document.createElement('span');
      const badge = document.createElement('small');
      button.type = 'button';
      button.dataset.candidateId = target.id;
      button.setAttribute('aria-current', String(target === selected));
      label.textContent = describe(target);
      badge.textContent = scopeLabels[target.scope] + (draft.has(target.id) ? ' · 已拟选' : '');
      button.append(label, badge);
      button.addEventListener('click', () => selectTarget(target));
      item.append(button);
      return item;
    }));
    if (!visible.length) {
      const empty = document.createElement('li');
      empty.className = 'empty-note';
      empty.textContent = '没有匹配的候选。';
      list.append(empty);
    }
    result.textContent = '显示 ' + visible.length + ' / ' + data.targets.length + ' 项 · 已拟选 ' + draft.size + ' 项' +
      (storageAvailable ? '' : ' · 请导出备查');
    download.disabled = draft.size === 0;
    checkDraft.disabled = checking || draft.size === 0;
    importDraft.disabled = checking;
    choose.disabled = checking;
    summary.textContent = data.targets.length + ' 个目标';
  }

  function selectTarget(target) {
    checkMessage.textContent = '';
    showDetail(target);
    for (const button of list.querySelectorAll('button')) {
      button.setAttribute('aria-current', String(button.dataset.candidateId === target.id));
    }
    title.focus();
  }

  function load() {
    if (loading) return loading;
    loading = request('/api/lineage-candidates').then(value => {
      data = value;
      storageKey = 'lineage-review:next-batch:' + (data.source?.sha256 ?? 'empty');
      try {
        const previous = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]');
        for (const target of data.targets) {
          if (Array.isArray(previous) && previous.includes(target.id)) draft.add(target.id);
        }
      } catch {
        storageAvailable = false;
      }
      search.disabled = scope.disabled = false;
      render();
      return true;
    }).catch(() => {
      result.textContent = '候选读取失败，请关闭后重试。';
      loading = null;
      return false;
    });
    return loading;
  }

  search.addEventListener('input', () => {
    if (checkMessage.textContent === '当前字段没有同名候选线索。') checkMessage.textContent = '';
    render();
  });
  scope.addEventListener('change', () => {
    if (checkMessage.textContent === '当前字段没有同名候选线索。') checkMessage.textContent = '';
    render();
  });
  open.addEventListener('click', () => {
    if (selected?.fieldId && !busy) {
      panel.close();
      openTarget(selected.fieldId);
    }
  });
  compare.addEventListener('click', () => {
    if (selected?.fieldId && !busy) {
      panel.close();
      compareTarget(selected.fieldId);
    }
  });
  function rememberDraft() {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify([...draft]));
    } catch {
      storageAvailable = false;
    }
    render();
  }

  function makeDraft() {
    return { format: 'field-review-batch-draft-v1', source: data.source, exportedAt: new Date().toISOString(),
      targets: data.targets.filter(target => draft.has(target.id)) };
  }

  function downloadJson(payload, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function updatePlanButton() {
    exportPlan.disabled = !preview || !batchName.value.trim() || !preview.targets.every(target => target.scope === 'selectable');
  }

  async function validate(payload, kind) {
    if (!await load() || checking) return;
    checking = true;
    preview = undefined;
    previewKind = undefined;
    previewPanel.hidden = true;
    updatePlanButton();
    checkMessage.textContent = '正在按当前底册核验。';
    render();
    try {
      preview = await request('/api/lineage-candidates/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      previewKind = kind;
      const verified = new Map(preview.targets.map(target => [target.id, target]));
      data.targets = data.targets.map(target => verified.get(target.id) ?? target);
      if (selected) showDetail(verified.get(selected.id) ?? selected);
      const ready = preview.targets.filter(target => target.scope === 'selectable').length;
      const missing = preview.targets.filter(target => target.scope === 'missing').length;
      previewCount.textContent = '可收集 ' + ready + ' 项 · 待补底册 ' + missing + ' 项 · 已在批次 ' +
        (preview.targets.length - ready - missing) + ' 项';
      previewTargets.replaceChildren(...preview.targets.map(target => {
        const row = document.createElement('li');
        row.textContent = describe(target) + ' · ' + (target.scope === 'selectable' ? '可收集' : scopeLabels[target.scope]);
        return row;
      }));
      merge.hidden = kind !== 'import' || !preview.targets.some(canDraft);
      batchName.value = '';
      updatePlanButton();
      checkMessage.textContent = '';
      previewPanel.hidden = false;
      previewTitle.focus();
    } catch (error) {
      checkMessage.textContent = error.message || '草案核验失败，请重试。';
    } finally {
      checking = false;
      render();
    }
  }

  choose.addEventListener('change', () => {
    if (choose.checked) draft.add(selected.id);
    else draft.delete(selected.id);
    if (previewKind === 'current') {
      preview = undefined;
      previewKind = undefined;
      previewPanel.hidden = true;
      updatePlanButton();
    }
    rememberDraft();
    if (detail.hidden) scope.focus();
  });
  download.addEventListener('click', () => downloadJson(makeDraft(), 'lineage-review-next-batch-draft.json'));
  checkDraft.addEventListener('click', () => validate(makeDraft(), 'current'));
  importDraft.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    preview = undefined;
    previewKind = undefined;
    previewPanel.hidden = true;
    updatePlanButton();
    try {
      if (file.size > 64 * 1024) throw new Error('草案超过 64 KB，请拆分后核验。');
      const payload = JSON.parse((await file.text()).replace(/^\uFEFF/, ''));
      await validate(payload, 'import');
    } catch (error) {
      checkMessage.textContent = error instanceof SyntaxError ? '草案无法读取，请选择导出的 JSON 文件。' : error.message;
    }
  });
  merge.addEventListener('click', () => {
    for (const target of preview.targets.filter(canDraft)) draft.add(target.id);
    search.value = '';
    scope.value = 'draft';
    rememberDraft();
    merge.hidden = true;
    checkMessage.textContent = '可拟选字段已并入本页草案。';
    scope.focus();
  });
  batchName.addEventListener('input', updatePlanButton);
  exportPlan.addEventListener('click', () => {
    if (!preview) return;
    const id = 'batch-' + Array.from(crypto.getRandomValues(new Uint8Array(8)),
      byte => byte.toString(16).padStart(2, '0')).join('');
    const batch = { id, name: batchName.value.trim(), sourceSha256: preview.source.sha256,
      targetIds: preview.targets.map(target => target.id) };
    downloadJson({ format: 'field-review-batches-v1', batches: [batch] }, 'lineage-review-batch-plan.json');
  });
  return {
    setBusy(value) { busy = value; updateOpen(); },
    async open() {
      if (busy) return;
      checkMessage.textContent = '';
      panel.showModal();
      if (await load()) search.focus();
    },
    async showField(field) {
      if (busy) return;
      checkMessage.textContent = '';
      panel.showModal();
      if (!await load()) return;
      scope.value = 'all';
      search.value = tableLabel(field) + ' ' + fieldLabel(field);
      render();
      const target = data.targets.find(item => item.fieldId === field.id);
      if (target) selectTarget(target);
      else {
        checkMessage.textContent = '当前字段没有同名候选线索。';
        search.focus();
      }
    },
  };
}
