import matter from 'gray-matter';

export const DELIVERABLE_STATUSES = ['未提交', '编制中', '已提交', '待评审', '通过', '退回整改', '已归档'];
export const DELIVERABLE_LEVELS = ['A', 'B', 'C', 'D'];
export const RISK_LEVELS = ['高', '中', '低'];

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

export function validateDeliverableFrontmatter(frontmatter) {
  const anf = normalizeDeliverableFrontmatter(frontmatter || {});
  for (const key of REQUIRED_FIELDS) {
    if (!anf[key]) throw new DeliverableFsError('SCHEMA_INVALID', `${key} 必填,缺失或为空`);
  }
  if (!DLV_ID.test(anf.deliverableId)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `deliverableId 必须形如 DLV-001,当前: ${anf.deliverableId}`);
  }
  if (!DELIVERABLE_STATUSES.includes(anf.status)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `status 状态枚举越界: ${anf.status}`);
  }
  if (!DELIVERABLE_LEVELS.includes(anf.deliverableLevel)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `deliverableLevel 枚举越界: ${anf.deliverableLevel}`);
  }
  if (anf.risk && !RISK_LEVELS.includes(anf.risk)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `risk 枚举越界: ${anf.risk}`);
  }
  if (!ISO_DAY.test(anf.plannedFinish)) {
    throw new DeliverableFsError('SCHEMA_INVALID', `plannedFinish 必须是 ISO 日期 YYYY-MM-DD,当前: ${anf.plannedFinish}`);
  }
  for (const key of ['actualSubmitDate', 'actualPassDate', 'actualArchiveDate']) {
    if (anf[key] && !ISO_DAY.test(anf[key])) {
      throw new DeliverableFsError('SCHEMA_INVALID', `${key} 必须是 ISO 日期 YYYY-MM-DD,当前: ${anf[key]}`);
    }
  }
  if (anf.workflowHistory && !Array.isArray(anf.workflowHistory)) {
    throw new DeliverableFsError('SCHEMA_INVALID', 'workflowHistory 必须是数组');
  }
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

export function frontmatterToDeliverablePatch(frontmatter, record = {}) {
  const anf = normalizeDeliverableFrontmatter(frontmatter || {});
  return {
    deliverableId: anf.deliverableId,
    deliverableName: anf.title || '',
    deliverableType: anf.deliverableType || '',
    deliverableLevel: anf.deliverableLevel || '',
    department: anf.department || '',
    owner: anf.owner || '',
    reviewer: anf.reviewer || '',
    plannedFinish: anf.plannedFinish || '',
    taskRisk: anf.risk || '中',
    deliverableStatus: anf.status || '未提交',
    _actualSubmitDate: anf.actualSubmitDate || '',
    _actualPassDate: anf.actualPassDate || '',
    _actualArchiveDate: anf.actualArchiveDate || '',
    reviewOpinion: anf.reviewOpinion || '',
    _ownerNote: anf.ownerNote || '',
    evidence: anf.evidence || null,
    workflowHistory: anf.workflowHistory || [],
    canonicalFileName: record.fileName || '',
    canonicalMtime: record.mtime || 0,
    canonicalBody: record.body || '',
  };
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
    workflowHistory: deliverable.workflowHistory || existing.workflowHistory || [],
  });
}

export function mergeDeliverableWithFrontmatter(deliverable, record) {
  if (!record?.frontmatter) return deliverable;
  return {
    ...deliverable,
    ...frontmatterToDeliverablePatch(record.frontmatter, record),
    taskId: deliverable.taskId,
    taskName: deliverable.taskName,
    originalWbs: deliverable.originalWbs,
    normalizedWbs: deliverable.normalizedWbs,
    nodeKey: deliverable.nodeKey,
    vendor: deliverable.vendor,
    isPhaseGate: deliverable.isPhaseGate,
    isRequiredForGate: deliverable.isRequiredForGate,
    notes: record.frontmatter.ownerNote || record.frontmatter.reviewOpinion || deliverable.notes || '',
  };
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
