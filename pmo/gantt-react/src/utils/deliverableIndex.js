// deliverableIndex.js — 交付物台账索引
//
// 把三个来源合成台账：
//   1. 受控交付物正本（服务端 scanDeliverables 扫描 pmo/deliverables/DLV-*.md）
//   2. 计划任务投影（tasks.json，纯前端计算）
//   3. 扫描与绑定议题（health）
//
// 受控行与投影行是两个互不相交的集合：受控行有稳定的 DLV 编号且可发布行动项，
// 投影行只有 projectionKey（会随任务增删变化），不可发布。

import {
  BINDING_SOURCES,
  buildProjectionCandidates,
  mergeControlledWithBinding,
  resolveDeliverableBindings,
  suggestProjectionBinding,
} from './deliverableUtils.js';

/** 建议议题的最低分阈值：低于此分不展示，避免噪声淹没真实问题。 */
const SUGGESTION_MIN_SCORE = 4;
const SUGGESTION_LIMIT = 3;

const SCAN_ERROR_SEVERITY = {
  FILE_SCHEMA_INVALID: 'error',
  FILE_DUPLICATE_ID: 'error',
  FILE_ID_MISMATCH: 'error',
};

/** 台账行的稳定 UI 键：受控行用编号，投影行用投影键。 */
export function deliverableRowKey(row) {
  if (row?.recordKind === 'controlled') return `controlled:${row.deliverableId}`;
  return row?.projectionKey || `unknown:${row?.deliverableId || row?.taskId || ''}`;
}

/**
 * 本地状态键：受控行沿用 DLV 编号，以兼容既有 localStorage 凭证与本地状态记录。
 * 投影行只有 projectionKey —— 它不稳定，不得用于跨会话持久化。
 */
export function deliverableStorageKey(row) {
  return row?.deliverableId || row?.projectionKey || '';
}

export function isControlledRow(row) {
  return row?.recordKind === 'controlled';
}

function compareControlledRows(left, right) {
  return String(left.deliverableId).localeCompare(String(right.deliverableId), 'zh-CN');
}

function toScanIssues(scanErrors, detectedAt) {
  return (Array.isArray(scanErrors) ? scanErrors : []).map(error => {
    const kind = SCAN_ERROR_SEVERITY[error?.code] ? error.code : 'FILE_SCHEMA_INVALID';
    return {
      issueId: `${kind}:${error?.fileName || error?.deliverableId || 'unknown'}`,
      kind,
      severity: SCAN_ERROR_SEVERITY[kind] || 'error',
      deliverableId: error?.deliverableId || '',
      projectionKey: '',
      fileName: error?.fileName || '',
      title: `${error?.fileName || '交付物正本'} 无法纳入台账`,
      detail: error?.message || '正本校验失败，已跳过该文件。',
      candidates: [],
      suggestedAction: 'fix-frontmatter',
      detectedAt,
    };
  });
}

function buildSuggestionIssues(controlledRows, projections, detectedAt) {
  const issues = [];

  for (const row of controlledRows) {
    if (row.bindingSource !== BINDING_SOURCES.none) continue;

    const candidates = suggestProjectionBinding(row, projections)
      .filter(candidate => candidate.score >= SUGGESTION_MIN_SCORE)
      .slice(0, SUGGESTION_LIMIT);
    if (!candidates.length) continue;

    const head = candidates[0];
    issues.push({
      issueId: `BINDING_SUGGESTED:${row.deliverableId}`,
      kind: 'BINDING_SUGGESTED',
      severity: 'warn',
      deliverableId: row.deliverableId,
      projectionKey: head.projectionKey,
      fileName: row.canonicalFileName || '',
      title: `${row.deliverableId} 可能与 task ${head.taskId} 关联`,
      detail: `候选依据：${head.reasons.join('；')}。确认后请补显式锚点，系统不会自动绑定。`,
      candidates: candidates.map(candidate => ({
        kind: 'task',
        taskId: candidate.taskId,
        wbs: candidate.normalizedWbs,
        name: candidate.taskName,
        score: candidate.score,
        reasons: candidate.reasons,
      })),
      suggestedAction: 'bind-task',
      detectedAt,
    });
  }

  return issues;
}

function summarizeHealth(issues) {
  const health = { error: 0, warn: 0, info: 0, total: issues.length, byKind: {} };

  for (const issue of issues) {
    if (health[issue.severity] != null) health[issue.severity] += 1;
    health.byKind[issue.kind] = (health.byKind[issue.kind] || 0) + 1;
  }

  return health;
}

/**
 * 构建交付物台账索引。
 *
 * @param tasks       已 normalizeTasks 处理过的任务数组
 * @param controlled  服务端扫描到的正本记录 [{fileName, frontmatter, body, mtime}]
 * @param scanErrors  服务端扫描时跳过的文件 [{code, fileName, message}]
 * @param detectedAt  议题检出时间（ISO），由调用方注入以便测试可复现
 */
export function buildDeliverableIndex({
  tasks = [],
  controlled = [],
  scanErrors = [],
  detectedAt = '',
} = {}) {
  const { bindings, issues: bindingIssues } = resolveDeliverableBindings({ tasks, controlled, detectedAt });

  const controlledRows = controlled
    .map(record => mergeControlledWithBinding(record, bindings.get(record?.frontmatter?.deliverableId)))
    .sort(compareControlledRows);

  // 已被受控行吸收的任务不再产出投影行
  const boundTaskIds = new Set(
    controlledRows
      .filter(row => row.taskId != null)
      .map(row => String(row.taskId)),
  );

  const projections = buildProjectionCandidates(tasks, { boundTaskIds });

  const issues = [
    ...toScanIssues(scanErrors, detectedAt),
    ...bindingIssues,
    ...buildSuggestionIssues(controlledRows, projections, detectedAt),
  ];

  return {
    controlled: controlledRows,
    projections,
    allRows: [...controlledRows, ...projections],
    issues,
    health: summarizeHealth(issues),
    generatedAt: detectedAt,
  };
}
