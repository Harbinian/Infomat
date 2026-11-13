import { readFileSync } from 'node:fs';
import { fieldId, ReviewError } from './store.mjs';

function isLocation(value) {
  return ['勤哲', 'KFU8QZ', '用友U8'].includes(value?.system) &&
    typeof value.table === 'string' && /^dbo\.[^.]+$/.test(value.table);
}

export function loadCandidates(path, selectableIds, batch) {
  if (!path) return { source: null, targets: [] };
  const { format, source, links } = JSON.parse(readFileSync(path, 'utf8'));
  if (format !== 'same-name-lineage-candidates-v1' || !Array.isArray(links) || !links.length ||
      typeof source?.file !== 'string' || !/^[a-f0-9]{64}$/.test(source.sha256)) {
    throw new Error('Invalid candidate catalog');
  }
  const targets = new Map();
  const edges = new Set();
  for (const link of links) {
    const { id, name, parent, target, evidenceStatus, evidence, pending } = link;
    if (!/^C\d+$/.test(id) || typeof name !== 'string' || !name.trim() ||
        !isLocation(parent) || !isLocation(target) || !['has_evidence', 'needs_verification'].includes(evidenceStatus) ||
        [evidence, pending].some(value => typeof value !== 'string' || !value.trim())) {
      throw new Error('Invalid candidate link');
    }
    const key = fieldId(target.system, target.table, name);
    const edge = key + fieldId(parent.system, parent.table, name);
    if (edges.has(edge)) throw new Error('Duplicate candidate link');
    edges.add(edge);
    if (!targets.has(key)) {
      const field = selectableIds.has(key) ? key : null;
      const scope = batch.has(key) ? 'first_batch' : field ? 'selectable' : 'missing';
      targets.set(key, { id: key, fieldId: field, ...target, name, scope, references: [] });
    }
    targets.get(key).references.push({ id, parent, evidenceStatus, evidence, pending });
  }
  return { source, targets: [...targets.values()] };
}

export function validateCandidateDraft(draft, candidates) {
  if (draft?.format !== 'field-review-batch-draft-v1' || !Array.isArray(draft.targets) || !draft.targets.length) {
    throw new ReviewError(400, '请选择包含拟选字段的下一批草案 JSON。');
  }
  if (!candidates.source || draft.source?.sha256 !== candidates.source.sha256) {
    throw new ReviewError(409, '草案对应的候选清单版本已变化，请核对当前候选后重新拟选。');
  }
  const current = new Map(candidates.targets.map(target => [target.id, target]));
  const seen = new Set();
  const targets = draft.targets.map(item => {
    if (!/^FIELD-[a-f0-9]{64}$/.test(item?.id) || seen.has(item.id)) {
      throw new ReviewError(400, '草案含无效或重复的目标字段。');
    }
    seen.add(item.id);
    const target = current.get(item.id);
    if (!target || ['system', 'table', 'name'].some(key => item[key] !== target[key])) {
      throw new ReviewError(400, '草案含无法与当前候选精确匹配的目标字段。');
    }
    return target;
  });
  return { source: candidates.source, targets };
}

export function loadBatchPlans(path, candidates, firstBatch, references) {
  const batches = [firstBatch];
  if (!path) return batches;
  const plans = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  if (plans.format !== 'field-review-batches-v1' || !Array.isArray(plans.batches)) {
    throw new Error('Invalid batch plans');
  }
  const byId = new Map(candidates.targets.map(target => [target.id, target]));
  for (const { id, name, sourceSha256, targetIds } of plans.batches) {
    if (!/^batch-[a-z0-9-]{1,45}$/.test(id) || batches.some(batch => batch.id === id) ||
        typeof name !== 'string' || !name.trim() || name.length > 80 ||
        !candidates.source || sourceSha256 !== candidates.source.sha256 ||
        !Array.isArray(targetIds) || !targetIds.length) {
      throw new Error('Invalid batch definition: ' + id);
    }
    for (const field of targetIds) {
      const target = byId.get(field);
      if (!target?.fieldId || target.scope !== 'selectable' || references.has(field)) {
        throw new Error('Batch target is unavailable or already collected: ' + field);
      }
      const targetName = target.system + ' ' + target.table + '.' + target.name;
      references.set(field, target.references.map(reference => ({
        id: reference.id,
        title: reference.evidenceStatus === 'needs_verification' ? '同名关系待核证' : '同名字段核证',
        source: reference.parent.system + ' ' + reference.parent.table + '.' + target.name,
        target: targetName,
        evidence: reference.evidence,
        pending: reference.pending,
      })));
      target.scope = 'in_batch';
    }
    batches.push({ id, name: name.trim(), fieldIds: targetIds });
  }
  return batches;
}
