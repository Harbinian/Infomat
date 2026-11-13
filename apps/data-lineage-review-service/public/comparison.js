import { actions, roles, lineageInputs, recordState, noteComplete, notesComplete, hasMultipleA,
  selectionLabels, createSubmissionId, mergeReview, reviewPayload } from '/review-model.js';
import { fieldLabel, tableLabel, fieldLocation, describeLocation, referenceLabel, groupLabel } from '/field-presentation.js';

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const button = (text, listener, className = '') => {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', listener);
  return node;
};
const pathFor = id => '/api/fields/' + encodeURIComponent(id) + '/matrix';

export function bindComparison({ request, getCatalog, positions, drafts, pickPositions, openField, onSaved, showNameReference }) {
  const byId = id => document.getElementById(id);
  const board = byId('comparison');
  const list = byId('compare-list');
  const nameSelect = byId('compare-name');
  const nameSearch = byId('compare-name-search');
  const tableSearch = byId('compare-table-search');
  const systemSelect = byId('compare-system');
  const summary = byId('compare-summary');
  const saveAll = byId('compare-save-all');
  const message = byId('compare-message');
  const states = new Map();
  let entries = new Map();
  let groups = [];
  let originId;
  let groupName;
  let epoch = 0;
  let busy = false;
  let candidates;
  let candidateLoading;
  let candidatesFailed = false;

  function makeState(field, record) {
    const references = getCatalog().collection.tasks[field.id] ?? [];
    const value = recordState(record, references);
    const completed = record?.completed === true && notesComplete(value.lineageNotes);
    return { id: field.id, version: record?.version ?? 0, references, ...value,
      base: value.values, baseLineageNotes: value.lineageNotes, completed, baseCompleted: completed,
      completionIntent: null, ...drafts.get(field.id) };
  }

  function remember(entry, contentChanged = false) {
    const state = entry.state;
    const sameContent = JSON.stringify(state.values) === JSON.stringify(state.base) &&
      JSON.stringify(state.lineageNotes) === JSON.stringify(state.baseLineageNotes);
    if (contentChanged) state.completed = sameContent ? (state.completionIntent ?? state.baseCompleted) : false;
    const previous = drafts.get(state.id);
    if (sameContent && state.completed === state.baseCompleted) {
      drafts.delete(state.id);
      state.completionIntent = null;
    } else {
      const sameDraft = previous && JSON.stringify(previous.values) === JSON.stringify(state.values) &&
        JSON.stringify(previous.lineageNotes) === JSON.stringify(state.lineageNotes) && previous.completed === state.completed;
      const { id, references, ...draft } = state;
      drafts.set(id, { ...draft, submissionId: sameDraft ? previous.submissionId : createSubmissionId() });
    }
    entry.message.textContent = drafts.has(state.id) ? '修改尚未保存' : state.version ? '当前记录已保存' : '';
    if (entry.conflict) describeConflict(entry);
    updateEntry(entry);
    updateSummary();
  }

  function updateEntry(entry) {
    if (!entry.state) return;
    const state = entry.state;
    const dirty = drafts.has(state.id);
    entry.badge.textContent = dirty ? '未保存' : state.baseCompleted ? '已确认' : state.version ? '已收待确认' : '未收集';
    entry.badge.dataset.state = dirty ? 'dirty' : state.baseCompleted ? 'completed' : 'pending';
    for (const [action, row] of Object.entries(entry.cells)) {
      for (const [role, cell] of Object.entries(row)) {
        const value = selectionLabels(state.values, action, role, state, positions);
        cell.textContent = (state.values[action][role] === null ? '历史填写\n' :
          role === 'A' && state.values[action].A?.length > 1 ? '历史多选\n' : '') + (value || '选择岗位');
        cell.classList.toggle('empty', !value);
      }
    }
    const filled = Object.values(state.lineageNotes).filter(noteComplete).length;
    const missing = state.references.length - filled;
    entry.notesSummary.textContent = '血缘记录 · ' + filled + ' / ' + state.references.length + ' 条已填';
    entry.notesDetails.hidden = state.references.length === 0;
    entry.completion.checked = state.completed;
    entry.completion.disabled = busy || missing > 0;
    entry.completion.title = missing ? '请先补齐本字段每条血缘的写入时点和变更处理。' : '';
    entry.gap.hidden = !missing;
    entry.gap.textContent = '待补 ' + missing + ' 条血缘';
    entry.save.disabled = busy || !dirty || hasMultipleA(state) || Boolean(entry.conflict) || entry.recovery;
    entry.fieldset.disabled = busy;
    entry.single.disabled = busy;
    entry.retry.disabled = busy;
    entry.merge.disabled = busy;
    entry.retryConflict.disabled = busy;
    if (hasMultipleA(state)) entry.message.textContent = '历史 A 有多个岗位，请单选或清空后保存。';
  }

  function updateSummary() {
    const all = [...entries.values()];
    const visible = all.filter(entry => !entry.node.hidden);
    const dirty = all.filter(entry => drafts.has(entry.field.id)).length;
    const failed = all.filter(entry => entry.loadError).length;
    const loading = all.filter(entry => !entry.state && !entry.loadError).length;
    const confirmed = all.filter(entry => entry.state?.baseCompleted).length;
    summary.textContent = '显示 ' + visible.length + ' / ' + all.length + ' 张表 · 已确认 ' + confirmed +
      (loading ? ' · 正在读取 ' + loading + ' 项' : '') + (failed ? ' · 读取失败 ' + failed + ' 项' : '');
    const outside = drafts.size - dirty;
    byId('compare-drafts').textContent = '本组未保存 ' + dirty + ' 项' + (outside ? ' · 其他字段 ' + outside + ' 项未保存' : '');
    saveAll.textContent = busy ? '正在保存…' : dirty ? '保存本组修改（' + dirty + '）' : '保存本组修改';
    saveAll.disabled = busy || dirty === 0 || loading > 0;
    for (const input of [nameSearch, nameSelect, tableSearch, systemSelect, byId('compare-back')]) input.disabled = busy;
    if (busy) for (const entry of all) updateEntry(entry);
  }

  function filterTables() {
    const words = tableSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    for (const entry of entries.values()) {
      const text = (entry.field.system + ' ' + entry.field.table + ' ' + tableLabel(entry.field)).toLowerCase();
      entry.node.hidden = Boolean(systemSelect.value && entry.field.system !== systemSelect.value) || !words.every(word => text.includes(word));
    }
    byId('compare-empty').hidden = [...entries.values()].some(entry => !entry.node.hidden);
    updateSummary();
  }

  function renderNames() {
    const words = nameSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = groups.filter(([name, fields]) => words.every(word => (name + ' ' +
      fields.map(fieldLabel).join(' ')).toLowerCase().includes(word)));
    const selected = groups.find(([name]) => name === groupName);
    if (selected && !matches.includes(selected)) matches.unshift(selected);
    nameSelect.replaceChildren(...matches.map(([name, fields]) => new Option(groupLabel(name, fields) + ' · ' + fields.length + ' 张表', name)));
    nameSelect.value = groupName;
  }

  function referenceData(field) {
    const collected = (getCatalog().collection.tasks[field.id] ?? []).map(item => ({
      title: item.id + ' · ' + item.title, source: item.source, evidence: item.evidence,
      pending: item.pending, write: item.write, change: item.change,
    }));
    const target = candidates?.targets.find(item => item.fieldId === field.id);
    const candidateRefs = (target?.references ?? []).map(item => ({
      title: item.id + ' · 同名字段线索', source: describeLocation(item.parent.system, item.parent.table, field.name, getCatalog().fields),
      evidence: item.evidence, pending: item.pending,
    }));
    const origin = field.parentReference;
    const source = origin ? [{ title: '数据库视图列来源',
      source: describeLocation(origin.system, origin.table, origin.name, getCatalog().fields),
      evidence: origin.evidence, pending: '业务取值时点与变更处理仍需现场核对。' }] : [];
    return [...collected, ...source, ...candidateRefs];
  }

  function renderReferences(entry) {
    entry.references.replaceChildren();
    const references = referenceData(entry.field);
    if (!references.length) {
      entry.references.append(element('p', 'muted', candidates ? '暂无父级线索，需现场核对来源。' : candidatesFailed ?
        '候选线索读取失败，重新打开对照可重试。' : '正在读取父级线索…'));
      return;
    }
    for (const reference of references) {
      const section = element('section', 'compare-reference');
      section.append(element('p', 'reference-id', reference.title), element('p', 'compare-source', referenceLabel(reference.source, getCatalog().fields)));
      const details = element('details', 'compare-evidence');
      details.append(element('summary', '', '已有证据 / 待确认'));
      for (const [label, value] of [['已有证据', reference.evidence], ['写入线索', reference.write],
        ['变更线索', reference.change], ['待确认', reference.pending]]) {
        if (value) details.append(element('p', label === '待确认' ? 'pending-text' : '', label + '：' + referenceLabel(value, getCatalog().fields)));
      }
      section.append(details);
      entry.references.append(section);
    }
  }

  function renderNotes(entry) {
    entry.notesFields.replaceChildren();
    for (const item of entry.state.references) {
      const section = element('section', 'compare-note');
      section.append(element('h4', '', item.id + ' · ' + item.title));
      const row = element('div', 'compare-note-inputs');
      for (const [key, label] of Object.entries(lineageInputs)) {
        const wrapper = element('label', '', label);
        const input = element('textarea');
        input.maxLength = 2000;
        input.rows = 2;
        input.value = entry.state.lineageNotes[item.id][key];
        input.setAttribute('aria-label', tableLabel(entry.field) + ' · ' + item.id + ' · ' + label);
        input.addEventListener('input', () => {
          entry.state.lineageNotes = { ...entry.state.lineageNotes,
            [item.id]: { ...entry.state.lineageNotes[item.id], [key]: input.value } };
          remember(entry, true);
        });
        wrapper.append(input);
        row.append(wrapper);
      }
      section.append(row);
      entry.notesFields.append(section);
    }
  }

  function buildCard(field, index) {
    const node = element('article', 'compare-card');
    node.dataset.fieldId = field.id;
    node.setAttribute('aria-label', fieldLocation(field));
    const header = element('header', 'compare-card-heading');
    const identity = element('div', 'compare-card-identity');
    identity.append(element('span', 'compare-index', String(index + 1).padStart(2, '0')),
      element('span', 'compare-system-tag', field.system), element('h3', '', tableLabel(field)));
    identity.append(element('span', 'compare-field-label', fieldLabel(field)));
    const badge = element('span', 'state-badge', '正在读取');
    const single = button('单字段编辑 ↗', () => openField(field), 'text-button');
    header.append(identity, badge, button('名称依据', () => showNameReference(field), 'text-button'), single);
    const body = element('div', 'compare-card-body');
    const referenceColumn = element('aside', 'compare-parents');
    referenceColumn.append(element('p', 'eyebrow', '父级参考'));
    const references = element('div', 'compare-references');
    referenceColumn.append(references);
    const fieldset = element('fieldset', 'compare-fields');
    fieldset.disabled = true;
    fieldset.append(element('legend', 'sr-only', tableLabel(field) + ' 的矩阵与血缘记录'));
    const matrix = element('table', 'matrix-table compare-matrix');
    const head = element('thead');
    const headings = element('tr');
    for (const label of ['CRUD 动作', ...Object.values(roles)]) {
      const cell = element('th', '', label);
      cell.scope = 'col';
      headings.append(cell);
    }
    head.append(headings);
    const tbody = element('tbody');
    const cells = {};
    const entry = { field, node, badge, single, references, fieldset, cells, recovery: false };
    for (const [action, label] of Object.entries(actions)) {
      const row = element('tr');
      const heading = element('th', '', label);
      heading.scope = 'row';
      row.append(heading);
      cells[action] = {};
      for (const [role, roleLabel] of Object.entries(roles)) {
        const cell = element('td');
        const input = button('正在读取', () => {
          if (busy || !entry.state) return;
          pickPositions(action, role, { state: entry.state, context: tableLabel(field),
            apply(ids) {
              entry.state.values = { ...entry.state.values,
                [action]: { ...entry.state.values[action], [role]: ids } };
              remember(entry, true);
            } });
        }, 'position-cell empty');
        input.setAttribute('aria-label', tableLabel(field) + ' · ' + label + ' · ' + roleLabel);
        cells[action][role] = input;
        cell.append(input);
        row.append(cell);
      }
      tbody.append(row);
    }
    matrix.append(head, tbody);
    const notesDetails = element('details', 'compare-notes');
    const notesSummary = element('summary', '', '血缘记录');
    const notesFields = element('div');
    notesDetails.hidden = true;
    notesDetails.append(notesSummary, notesFields);
    fieldset.append(matrix, notesDetails);
    body.append(referenceColumn, fieldset);
    const footer = element('footer', 'compare-card-footer');
    const feedback = element('p', 'status', '正在读取记录…');
    feedback.setAttribute('role', 'status');
    const retry = button('重新读取', () => loadEntry(entry, epoch));
    retry.hidden = true;
    const gap = button('', () => {
      notesDetails.open = true;
      const inputs = [...notesFields.querySelectorAll('textarea')];
      (inputs.find(input => !input.value.trim()) ?? inputs[0])?.focus();
    }, 'text-button');
    gap.hidden = true;
    const completeLabel = element('label', 'completion-control');
    const completion = element('input');
    completion.type = 'checkbox';
    completion.disabled = true;
    completion.setAttribute('aria-label', tableLabel(field) + ' · 确认收集完成');
    completion.addEventListener('change', () => {
      entry.state.completed = completion.checked;
      entry.state.completionIntent = completion.checked;
      remember(entry);
    });
    completeLabel.append(completion, '确认完成');
    const save = button('保存本项', () => runSave([entry]), 'primary');
    save.disabled = true;
    footer.append(feedback, retry, gap, completeLabel, save);
    const conflict = element('section', 'conflict compare-conflict');
    conflict.hidden = true;
    const differences = element('p');
    const merge = button('核对后保留本次填写', () => applyMerge(entry));
    const retryConflict = button('重试读取最新记录', () => recoverConflict(entry));
    retryConflict.hidden = true;
    conflict.append(differences, merge, retryConflict);
    node.append(header, body, conflict, footer);
    Object.assign(entry, { notesDetails, notesSummary, notesFields, message: feedback, retry, gap, completion, save,
      conflictPanel: conflict, differences, merge, retryConflict });
    renderReferences(entry);
    return entry;
  }

  async function loadEntry(entry, ticket) {
    entry.retry.hidden = true;
    entry.loadError = false;
    entry.message.textContent = '正在读取记录…';
    entry.badge.textContent = '正在读取';
    try {
      let state = states.get(entry.field.id);
      if (!state) {
        const { review } = drafts.has(entry.field.id) ? { review: null } : await request(pathFor(entry.field.id));
        if (ticket !== epoch) return;
        state = makeState(entry.field, review);
        states.set(state.id, state);
      }
      if (ticket !== epoch) return;
      entry.state = state;
      renderNotes(entry);
      entry.message.textContent = drafts.has(state.id) ? '已恢复未保存的填写' : state.version ? '当前记录已保存' : '';
      updateEntry(entry);
    } catch (error) {
      if (ticket !== epoch) return;
      entry.loadError = true;
      entry.badge.textContent = '读取失败';
      entry.message.textContent = error.message || '读取失败，请重试。';
      entry.retry.hidden = false;
    }
    if (ticket === epoch) updateSummary();
  }

  function showGroup(name) {
    if (busy) return;
    groupName = name;
    const ticket = ++epoch;
    message.textContent = '';
    const fields = [...(groups.find(([key]) => key === name)?.[1] ?? [])];
    fields.sort((a, b) => Number(b.id === originId) - Number(a.id === originId));
    entries = new Map(fields.map((field, index) => [field.id, buildCard(field, index)]));
    list.replaceChildren(...[...entries.values()].map(entry => entry.node));
    const systems = [...new Set(fields.map(field => field.system))];
    systemSelect.replaceChildren(new Option('全部系统', ''), ...systems.map(system => new Option(system, system)));
    tableSearch.value = '';
    byId('compare-scroll').scrollTop = 0;
    renderNames();
    filterTables();
    let next = 0;
    // Limit concurrent reads while allowing every matching table to remain visible.
    const queue = [...entries.values()];
    Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (ticket === epoch && next < queue.length) await loadEntry(queue[next++], ticket);
    }));
  }

  function describeConflict(entry) {
    const { lines } = mergeReview(entry.state, entry.conflict, positions);
    entry.differences.textContent = ['其他窗口已保存新版本，请核对差异后合并。', ...lines].join('\n');
  }

  async function recoverConflict(entry) {
    entry.retryConflict.disabled = true;
    entry.recovery = true;
    entry.conflictPanel.hidden = false;
    entry.merge.hidden = true;
    entry.retryConflict.hidden = false;
    try {
      const { review } = await request(pathFor(entry.field.id));
      if (review?.version > entry.state.version) {
        entry.conflict = review;
        entry.recovery = false;
        describeConflict(entry);
        entry.merge.hidden = false;
        entry.retryConflict.hidden = true;
      } else {
        entry.differences.textContent = '未发现可合并的新版本。请核对字段清单和岗位是否更新；本项填写仍保留，可重新读取最新记录。';
      }
    } catch (error) {
      entry.differences.textContent = '读取最新记录失败，本项填写已保留。' + error.message;
    }
    entry.retryConflict.disabled = false;
    updateEntry(entry);
  }

  function applyMerge(entry) {
    const { merged, mergedNotes, state } = mergeReview(entry.state, entry.conflict, positions);
    const active = entry.state;
    Object.assign(active, { version: entry.conflict.version, base: state.values, baseLineageNotes: state.lineageNotes,
      baseCompleted: entry.conflict.completed === true && notesComplete(state.lineageNotes), completed: false,
      completionIntent: null, legacy: state.legacy, values: merged, lineageNotes: mergedNotes,
      priorOptions: new Map([...active.priorOptions, ...state.priorOptions]) });
    drafts.delete(active.id);
    entry.conflict = null;
    entry.recovery = false;
    entry.conflictPanel.hidden = true;
    renderNotes(entry);
    remember(entry);
    entry.message.textContent = '已合并，请重新核对并保存。';
  }

  async function persist(entry) {
    const draft = drafts.get(entry.field.id);
    if (!entry.state || !draft || hasMultipleA(entry.state) || entry.conflict || entry.recovery) return false;
    entry.message.textContent = '正在保存…';
    try {
      const { review } = await request(pathFor(entry.field.id), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewPayload(entry.field, getCatalog(), draft, entry.state.references)),
      });
      drafts.delete(entry.field.id);
      entry.state = makeState(entry.field, review);
      states.set(entry.field.id, entry.state);
      entry.message.textContent = review.completed ? '已保存，已计入完成' : '已保存，待现场确认';
      return true;
    } catch (error) {
      entry.message.textContent = error.message || '保存失败，本项填写已保留。';
      if (error.status === 409) await recoverConflict(entry);
      return false;
    }
  }

  async function runSave(selected) {
    if (busy) return;
    const pending = selected.filter(entry => drafts.has(entry.field.id));
    if (!pending.length) return;
    busy = true;
    updateSummary();
    let saved = 0;
    for (const entry of pending) if (await persist(entry)) saved++;
    busy = false;
    for (const entry of entries.values()) updateEntry(entry);
    updateSummary();
    message.textContent = '已保存 ' + saved + ' 项' + (saved < pending.length ? '，另有 ' + (pending.length - saved) + ' 项需处理，填写已保留。' : '。');
    if (saved) onSaved();
  }

  nameSearch.addEventListener('input', renderNames);
  nameSelect.addEventListener('change', () => showGroup(nameSelect.value));
  tableSearch.addEventListener('input', filterTables);
  systemSelect.addEventListener('change', filterTables);
  saveAll.addEventListener('click', () => runSave([...entries.values()]));
  byId('compare-back').addEventListener('click', () => {
    const field = getCatalog().fields.find(item => item.id === originId);
    if (!busy && field) openField(field);
  });

  return {
    get isOpen() { return !board.hidden; },
    get isBusy() { return busy; },
    saveAll() { return runSave([...entries.values()]); },
    hide() {
      if (busy) return false;
      board.hidden = true;
      document.body.classList.remove('comparison-open');
      return true;
    },
    open(field) {
      if (busy) return;
      const catalog = getCatalog();
      if (!catalog) return;
      originId = field.id;
      states.clear();
      const map = new Map();
      for (const option of catalog.fields) {
        if (!map.has(option.name)) map.set(option.name, []);
        map.get(option.name).push(option);
      }
      groups = [...map].filter(([name, fields]) => fields.length > 1 || name === field.name);
      groups.sort((a, b) => a[0].localeCompare(b[0], 'zh-CN'));
      nameSearch.value = '';
      board.hidden = false;
      document.body.classList.add('comparison-open');
      showGroup(field.name);
      nameSelect.focus();
      if (!candidateLoading) {
        candidatesFailed = false;
        candidateLoading = request('/api/lineage-candidates').then(value => {
          candidates = value;
        }).catch(() => {
          candidatesFailed = true;
          candidateLoading = null;
          message.textContent = '同名候选线索读取失败，可重新打开对照重试；已显示的收集样例仍可核对。';
        }).finally(() => {
          for (const entry of entries.values()) renderReferences(entry);
        });
      }
    },
  };
}
