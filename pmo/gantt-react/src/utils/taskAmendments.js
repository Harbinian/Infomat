// Amendment presentation is separate from task progress and controlled records.
const originalWbs = task => String(task.originalWbs || task.wbs || '');
const originalId = task => String(task.originalId ?? task.id ?? '');

export function buildAmendmentIndex(tasks, batch) {
  const direct = new Map();
  const descendants = new Map();
  const ancestorWbs = new Set();
  const issues = [];
  const byId = new Map(tasks.map(task => [originalId(task), task]));
  for (const record of batch?.records || []) {
    const task = byId.get(String(record.taskId));
    if (!task || originalWbs(task) !== record.wbs || direct.has(String(record.taskId))) {
      issues.push(record.wbs);
      continue;
    }
    direct.set(String(record.taskId), record);
    const parts = record.wbs.split('.');
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = parts.slice(0, depth).join('.');
      ancestorWbs.add(parent);
      if (!record.isSummary) {
        if (!descendants.has(parent)) descendants.set(parent, new Set());
        descendants.get(parent).add(String(record.taskId));
      }
    }
  }
  const records = [...direct.values()];
  return { direct, descendants, ancestorWbs, issues,
    leafCount: records.filter(record => !record.isSummary).length,
    summaryCount: records.filter(record => record.isSummary).length,
  };
}

export function taskAmendment(task, index) {
  const record = index?.direct.get(originalId(task));
  return record && record.wbs === originalWbs(task) ? record : null;
}

export function amendmentBadge(task, index, batch) {
  const record = taskAmendment(task, index);
  const count = index?.descendants.get(originalWbs(task))?.size || 0;
  if (record) {
    const date = String(batch?.date || '').slice(5).replace('-', '/');
    return { text: `${date}${record.isSummary ? '调整' : '增补'}`, outlined: record.isSummary,
      description: `${batch?.date || ''}本任务有${record.isSummary ? '调整' : '增补'}${count ? `，含${count}项下级任务增补` : ''}` };
  }
  return count ? { text: `含${count}项增补`, outlined: true, description: `${count}项下级任务有增补，本节点自身未调整` } : null;
}

export function filterAmendedTasks(tasks, index, includeAncestors = false, allTasks = tasks) {
  const matches = tasks.filter(task => taskAmendment(task, index));
  if (!includeAncestors) return matches;
  const visibleWbs = new Set(matches.map(originalWbs));
  for (const task of matches) {
    const parts = originalWbs(task).split('.');
    for (let depth = 1; depth < parts.length; depth++) visibleWbs.add(parts.slice(0, depth).join('.'));
  }
  return allTasks.filter(task => visibleWbs.has(originalWbs(task)));
}

export async function loadTaskAmendments() {
  try {
    const response = await fetch('task-amendments.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.schemaVersion !== 'pmo-task-amendments-v1' || !Array.isArray(data.batches)
      || data.batches.some(batch => !batch || typeof batch.id !== 'string' || !batch.id
        || !/^\d{4}-\d{2}-\d{2}$/.test(batch.date) || !Array.isArray(batch.records)
        || batch.records.some(record => !record || !record.taskId || typeof record.wbs !== 'string'
          || !Array.isArray(record.fields) || !record.fields.length
          || record.fields.some(field => !field || typeof field.key !== 'string'
            || !['added', 'extended', 'changed', 'removed'].includes(field.kind))))) {
      throw new Error('Invalid amendment data');
    }
    return { status: 'ready', data };
  } catch {
    return { status: 'missing', data: null };
  }
}
