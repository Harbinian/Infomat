import matter from 'gray-matter';

export const DELIVERABLE_STATUSES = ['未提交', '编制中', '已提交', '待评审', '通过', '退回整改', '已归档'];
export const DELIVERABLE_LEVELS = ['A', 'B', 'C', 'D'];
export const RISK_LEVELS = ['高', '中', '低'];

// 行动项（action 块）只在交付物被发布为行动项后出现，未发布的正本不含此块。
// 四要素对齐《信息化项目协同工作规则》6.3：事项、责任部门、截止时间、当前状态。
export const ACTION_STATES = ['待接收', '已接收', '已提交待确认', '已关闭'];
export const ACTION_CRITERIA_SOURCES = ['task', 'manual'];
const ACTION_DAY_FIELDS = ['dueDate', 'ackDueDate'];
const ACTION_INSTANT_FIELDS = ['publishedAt', 'acknowledgedAt', 'closedAt'];

const REQUIRED_FIELDS = [
  'deliverableId',
  'status',
  'title',
  'deliverableType',
  'deliverableLevel',
  'department',
  'plannedFinish',
];
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DLV_ID = /^DLV-\d{3}$/;
const CHANGE_LOG_HEADING = /(?:^|\n)##\s*[^\n]*变更记录[\s\S]*$/u;

export class DeliverableFsError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'DeliverableFsError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function toIsoDay(value) {
  if (!value) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString().slice(0, 10);
  }
  return value;
}

function toIsoInstant(value) {
  if (!value) return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? value : value.toISOString();
  }
  return value;
}

function normalizeEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object') return evidence || null;
  return {
    ...evidence,
    uploadedAt: toIsoInstant(evidence.uploadedAt) || '',
  };
}

/**
 * 归一化 action 块的日期字段。
 *
 * 必须递归处理：gray-matter 会把 `2026-10-15` 解析成 Date 对象，不归一化会让
 * round-trip 断言失败，且每次写回都把 YAML 漂移成完整 ISO 时间戳。
 */
function normalizeAction(action) {
  if (!action || typeof action !== 'object') return null;
  const normalized = { ...action };
  for (const key of ACTION_DAY_FIELDS) {
    if (key in normalized) normalized[key] = toIsoDay(normalized[key]) || '';
  }
  for (const key of ACTION_INSTANT_FIELDS) {
    if (key in normalized) normalized[key] = toIsoInstant(normalized[key]) || '';
  }
  return normalized;
}

function normalizeHistoryItem(item = {}) {
  return {
    action: item.action || '',
    label: item.label || item.action || '',
    from: item.from || '',
    to: item.to || item.status || '',
    actor: item.actor || '',
    at: toIsoInstant(item.at || item.time || item.createdAt) || '',
    note: item.note || item.reviewOpinion || '',
  };
}

export function normalizeDeliverableFrontmatter(frontmatter = {}) {
  const normalized = { ...frontmatter };
  for (const key of ['plannedFinish', 'actualSubmitDate', 'actualPassDate', 'actualArchiveDate']) {
    if (key in normalized) normalized[key] = toIsoDay(normalized[key]) || '';
  }
  if ('evidence' in normalized) normalized.evidence = normalizeEvidence(normalized.evidence);
  if ('action' in normalized) {
    const action = normalizeAction(normalized.action);
    if (action) normalized.action = action;
    else delete normalized.action;
  }
  if ('workflowHistory' in normalized) {
    normalized.workflowHistory = Array.isArray(normalized.workflowHistory)
      ? normalized.workflowHistory.map(normalizeHistoryItem)
      : [];
  }
  return normalized;
}

export function parseDeliverableFrontmatter(raw) {
  try {
    const parsed = matter(raw || '');
    return {
      frontmatter: normalizeDeliverableFrontmatter(parsed.data || {}),
      body: parsed.content || '',
      excerpt: parsed.excerpt || '',
    };
  } catch (error) {
    throw new DeliverableFsError('PARSE_FRONT_MATTER', `YAML 解析失败: ${error.message}`, error);
  }
}

export function stringifyDeliverableFrontmatter({ frontmatter, body }) {
  return matter.stringify((body || '').replace(/\s+$/u, '') + '\n', normalizeDeliverableFrontmatter(frontmatter || {}));
}

/**
 * action 块的条件校验：只有存在时才校验，缺失一律放行 ——
 * 未发布行动项的既有正本无需任何改动即可继续通过。
 */
function validateAction(action) {
  if (!ACTION_STATES.includes(action.state)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `action.state 枚举越界: ${action.state}`);
  }
  if (!String(action.assigneeDepartment || '').trim()) {
    throw new DeliverableFsError('SCHEMA_INVALID', 'action.assigneeDepartment 必填');
  }
  if (!ISO_DAY.test(String(action.dueDate || ''))) {
    throw new DeliverableFsError('SCHEMA_INVALID', `action.dueDate 必须是 ISO 日期 YYYY-MM-DD,当前: ${action.dueDate}`);
  }
  if (action.ackDueDate && !ISO_DAY.test(action.ackDueDate)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `action.ackDueDate 必须是 ISO 日期 YYYY-MM-DD,当前: ${action.ackDueDate}`);
  }
  if (action.criteriaSource && !ACTION_CRITERIA_SOURCES.includes(action.criteriaSource)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `action.criteriaSource 枚举越界: ${action.criteriaSource}`);
  }
}

export function validateDeliverableFrontmatter(frontmatter) {
  const fm = normalizeDeliverableFrontmatter(frontmatter || {});
  for (const key of REQUIRED_FIELDS) {
    if (!fm[key]) throw new DeliverableFsError('SCHEMA_INVALID', `${key} 必填,缺失或为空`);
  }
  if (!DLV_ID.test(fm.deliverableId)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `deliverableId 必须形如 DLV-001,当前: ${fm.deliverableId}`);
  }
  if (!DELIVERABLE_STATUSES.includes(fm.status)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `status 状态枚举越界: ${fm.status}`);
  }
  if (!DELIVERABLE_LEVELS.includes(fm.deliverableLevel)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `deliverableLevel 枚举越界: ${fm.deliverableLevel}`);
  }
  if (fm.risk && !RISK_LEVELS.includes(fm.risk)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `risk 枚举越界: ${fm.risk}`);
  }
  if (!ISO_DAY.test(fm.plannedFinish)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `plannedFinish 必须是 ISO 日期 YYYY-MM-DD,当前: ${fm.plannedFinish}`);
  }
  for (const key of ['actualSubmitDate', 'actualPassDate', 'actualArchiveDate']) {
    if (fm[key] && !ISO_DAY.test(fm[key])) {
      throw new DeliverableFsError('SCHEMA_INVALID', `${key} 必须是 ISO 日期 YYYY-MM-DD,当前: ${fm[key]}`);
    }
  }
  if (fm.workflowHistory && !Array.isArray(fm.workflowHistory)) {
    throw new DeliverableFsError('SCHEMA_INVALID', 'workflowHistory 必须是数组');
  }
  if (fm.action) validateAction(fm.action);
  return true;
}

function cell(value) {
  return String(value || '-').replace(/\|/g, '/').replace(/\r?\n/g, ' ').trim() || '-';
}

function historyDate(value) {
  const instant = toIsoInstant(value);
  if (!instant) return '';
  const direct = String(instant).match(/^\d{4}-\d{2}-\d{2}/u);
  return direct ? direct[0] : instant;
}

export function buildChangeLogTable(history = []) {
  const rows = (Array.isArray(history) ? history : []).map((item, index) => {
    const version = `V0.${index + 1}`;
    return `| ${version} | ${cell(item.to)} | ${cell(item.label || item.action)} | ${cell(item.actor)} | ${cell(historyDate(item.at))} | ${cell(item.note)} |`;
  });
  return [
    '## 变更记录',
    '| 版本 | 状态 | 动作 | 责任人 | 时间 | 备注 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

export function stripChangeLogTable(body = '') {
  return String(body || '').replace(CHANGE_LOG_HEADING, '').trimEnd();
}

export function upsertChangeLogTable(body = '', history = []) {
  const mainBody = stripChangeLogTable(body);
  return `${mainBody.trimEnd()}\n\n${buildChangeLogTable(history)}\n`;
}

export function deliverableToFrontmatter(deliverable, existing = {}) {
  return normalizeDeliverableFrontmatter({
    ...existing,
    deliverableId: deliverable.deliverableId || existing.deliverableId,
    title: deliverable.deliverableName || deliverable.title || existing.title || '',
    status: deliverable.deliverableStatus || existing.status || '未提交',
    deliverableType: deliverable.deliverableType || existing.deliverableType || '过程记录类',
    deliverableLevel: deliverable.deliverableLevel || existing.deliverableLevel || 'C',
    department: deliverable.department || existing.department || '',
    owner: deliverable.owner || existing.owner || '',
    reviewer: deliverable.reviewer || existing.reviewer || '',
    plannedFinish: deliverable.plannedFinish || existing.plannedFinish || '',
    actualSubmitDate: deliverable._actualSubmitDate || deliverable.actualSubmitDate || existing.actualSubmitDate || '',
    actualPassDate: deliverable._actualPassDate || deliverable.actualPassDate || existing.actualPassDate || '',
    actualArchiveDate: deliverable._actualArchiveDate || deliverable.actualArchiveDate || existing.actualArchiveDate || '',
    risk: deliverable.taskRisk || deliverable.risk || existing.risk || '中',
    reviewOpinion: deliverable.reviewOpinion || existing.reviewOpinion || '',
    ownerNote: deliverable._ownerNote || deliverable.ownerNote || existing.ownerNote || '',
    evidence: deliverable.evidence || existing.evidence || null,
    action: deliverable.action || existing.action || null,
    workflowHistory: deliverable.workflowHistory || existing.workflowHistory || [],
  });
}

export function safeDeliverableFileName(deliverableId, title) {
  const safeTitle = Array.from(String(title || '交付物正本'))
    .map(char => (char.charCodeAt(0) < 32 ? '-' : char))
    .join('')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || '交付物正本';
  return `${deliverableId}-${safeTitle}.md`;
}
