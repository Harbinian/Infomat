export const actions = { create: 'C 新建', read: 'R 查询', update: 'U 更新', retire: 'D 删除或停用' };
export const roles = { R: 'R 执行', A: 'A 最终负责', C: 'C 征询', I: 'I 知会' };
export const lineageInputs = { writeRule: '写入或取值时点', changeRule: '上游变更后的处理' };

export function recordState(record, references) {
  const priorOptions = new Map();
  const legacy = record?.matrix ?? {};
  const values = Object.fromEntries(Object.keys(actions).map(action => [action,
    Object.fromEntries(Object.keys(roles).map(role => {
      const positions = record?.positionSelections?.[action]?.[role];
      if (!Array.isArray(positions)) return [role, legacy[action]?.[role] ? null : []];
      for (const option of positions) priorOptions.set(option.id, option);
      return [role, positions.map(option => option.id)];
    })),
  ]));
  const lineageNotes = Object.fromEntries(references.map(({ id }) => [id,
    Object.fromEntries(Object.keys(lineageInputs).map(key => [key, record?.lineageNotes?.[id]?.[key] ?? '']))]));
  return { values, priorOptions, legacy, lineageNotes };
}

export const noteComplete = values => Object.values(values).every(value => value.trim());
export const notesComplete = notes => Object.values(notes).every(noteComplete);
export const hasMultipleA = state => Object.values(state.values).some(row => row.A?.length > 1);

export function selectionLabels(values, action, role, state, positions) {
  const selection = values[action][role];
  if (selection === null) return state.legacy[action][role];
  return selection.map(id => (positions.get(id) ?? state.priorOptions.get(id))?.label ?? '历史岗位').join('\n');
}

export function createSubmissionId() {
  // LAN HTTP supports getRandomValues without requiring a secure context.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function mergeReview(active, latest, positions) {
  const state = recordState(latest, active.references);
  const merged = structuredClone(state.values);
  const mergedNotes = structuredClone(state.lineageNotes);
  const lines = [];
  for (const action of Object.keys(actions)) {
    for (const role of Object.keys(roles)) {
      const value = active.values[action][role];
      const base = JSON.stringify(active.base[action][role]);
      if (JSON.stringify(value) === base) continue;
      const saved = merged[action][role];
      if (JSON.stringify(saved) !== base && JSON.stringify(saved) !== JSON.stringify(value)) {
        lines.push(actions[action] + ' · ' + roles[role] + '　已保存值为「' +
          (selectionLabels(merged, action, role, state, positions) || '空白') + '」');
      }
      merged[action][role] = value;
    }
  }
  for (const { id } of active.references) {
    for (const [key, name] of Object.entries(lineageInputs)) {
      const value = active.lineageNotes[id][key];
      const base = active.baseLineageNotes[id][key];
      if (value === base) continue;
      const saved = mergedNotes[id][key];
      if (saved !== base && saved !== value) lines.push(id + ' · ' + name + '　已保存值为「' + (saved || '空白') + '」');
      mergedNotes[id][key] = value;
    }
  }
  return { merged, mergedNotes, lines, state };
}

export function reviewPayload(field, catalog, draft, references) {
  return {
    catalogDigest: field.catalogDigest ?? (field.supplemental ? catalog.fieldCatalogDigest : catalog.catalogDigest),
    positionCatalogDigest: catalog.positionCatalog.digest,
    expectedVersion: draft.version, submissionId: draft.submissionId, selections: draft.values, completed: draft.completed,
    ...(references.length ? { lineageNotes: draft.lineageNotes } : {}),
  };
}
