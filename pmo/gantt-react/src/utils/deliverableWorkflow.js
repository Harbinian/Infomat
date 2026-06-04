import { parseDate } from './dateUtils.js';

export const DELIVERABLE_STATUSES = ['未提交', '编制中', '已提交', '待评审', '通过', '退回整改', '已归档'];

const STATUS_ORDER = Object.fromEntries(DELIVERABLE_STATUSES.map((status, index) => [status, index]));
const LEVEL_ORDER = { A: 1, B: 2, C: 3, D: 4 };
const RISK_ORDER = { 高: 1, 中: 2, 低: 3 };

export const DELIVERABLE_ACTIONS = {
  draft: {
    label: '标记编制中',
    to: '编制中',
    from: ['未提交', '退回整改'],
  },
  submit: {
    label: '提交',
    to: '已提交',
    from: ['未提交', '编制中', '退回整改'],
  },
  startReview: {
    label: '进入评审',
    to: '待评审',
    from: ['已提交'],
  },
  approve: {
    label: '审核通过',
    to: '通过',
    from: ['已提交', '待评审'],
  },
  reject: {
    label: '退回整改',
    to: '退回整改',
    from: ['已提交', '待评审'],
  },
  archive: {
    label: '归档',
    to: '已归档',
    from: ['通过'],
  },
};

function normalizeStatus(status) {
  return DELIVERABLE_STATUSES.includes(status) ? status : '未提交';
}

function coerceDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const parsedProjectDate = parseDate(value);
    if (parsedProjectDate) return parsedProjectDate;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function formatIsoDay(value) {
  const date = coerceDate(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

function formatIsoInstant(value) {
  const date = coerceDate(value) || new Date();
  return date.toISOString();
}

function validateProjectDate(value, field, deliverableId) {
  if (!value) return '';
  const day = formatIsoDay(value);
  if (!day) {
    throw new Error(`${deliverableId || '交付物'} 的 ${field} 日期无效: ${value}`);
  }
  return day;
}

function normalizeHistoryItem(item) {
  return {
    action: item.action || '',
    label: item.label || DELIVERABLE_ACTIONS[item.action]?.label || item.action || '',
    from: item.from || '',
    to: item.to || item.status || '',
    actor: item.actor || '',
    at: formatIsoInstant(item.at || item.time || item.createdAt),
    note: item.note || item.reviewOpinion || '',
  };
}

export function canTransitionDeliverableStatus(status, action) {
  const actionDef = DELIVERABLE_ACTIONS[action];
  if (!actionDef) return false;
  return actionDef.from.includes(normalizeStatus(status));
}

export function transitionDeliverableStatus(deliverable, command) {
  const actionDef = DELIVERABLE_ACTIONS[command?.action];
  if (!actionDef) {
    throw new Error(`未知交付物动作: ${command?.action || ''}`);
  }

  const from = normalizeStatus(deliverable.deliverableStatus);
  if (!canTransitionDeliverableStatus(from, command.action)) {
    throw new Error(`不允许从“${from}”执行“${actionDef.label}”`);
  }

  const at = formatIsoInstant(command.at);
  const note = command.note || '';
  const historyItem = {
    action: command.action,
    label: actionDef.label,
    from,
    to: actionDef.to,
    actor: command.actor || '',
    at,
    note,
  };

  const next = {
    ...deliverable,
    deliverableStatus: actionDef.to,
    workflowHistory: [...(deliverable.workflowHistory || []), historyItem],
  };

  if (command.action === 'submit') {
    next._actualSubmitDate = next._actualSubmitDate || formatIsoDay(at);
  }
  if (command.action === 'approve') {
    next._actualPassDate = formatIsoDay(at);
    next.reviewOpinion = note || next.reviewOpinion || '';
  }
  if (command.action === 'reject') {
    next.reviewOpinion = note || next.reviewOpinion || '';
  }
  if (command.action === 'archive') {
    next._actualArchiveDate = formatIsoDay(at);
  }

  return next;
}

export function validateDeliverableOverrides(rawOverrides) {
  const rows = Array.isArray(rawOverrides) ? rawOverrides : rawOverrides?.items;
  if (!Array.isArray(rows)) {
    throw new Error('deliverable-status.json 必须是数组，或包含 items 数组');
  }

  return rows.map((item, index) => {
    if (!item || !item.deliverableId) {
      throw new Error(`第 ${index + 1} 条状态覆盖缺少 deliverableId`);
    }
    const status = item.status || item.deliverableStatus || '';
    if (status && !DELIVERABLE_STATUSES.includes(status)) {
      throw new Error(`${item.deliverableId} 的交付物状态无效: ${status}`);
    }

    return {
      deliverableId: item.deliverableId,
      status: status || '',
      actualSubmitDate: validateProjectDate(item.actualSubmitDate || item._actualSubmitDate, 'actualSubmitDate', item.deliverableId),
      actualPassDate: validateProjectDate(item.actualPassDate || item._actualPassDate, 'actualPassDate', item.deliverableId),
      actualArchiveDate: validateProjectDate(item.actualArchiveDate || item._actualArchiveDate, 'actualArchiveDate', item.deliverableId),
      reviewer: item.reviewer || '',
      ownerNote: item.ownerNote || '',
      reviewOpinion: item.reviewOpinion || '',
      evidence: item.evidence || null,
      workflowHistory: Array.isArray(item.workflowHistory) ? item.workflowHistory.map(normalizeHistoryItem) : [],
    };
  });
}

export function applyDeliverableOverrides(deliverables, rawOverrides) {
  const overrides = validateDeliverableOverrides(rawOverrides);
  const overrideMap = new Map(overrides.map(item => [item.deliverableId, item]));

  return deliverables.map(deliverable => {
    const override = overrideMap.get(deliverable.deliverableId);
    if (!override) return deliverable;

    return {
      ...deliverable,
      deliverableStatus: override.status || deliverable.deliverableStatus,
      reviewer: override.reviewer || deliverable.reviewer,
      evidence: override.evidence || deliverable.evidence,
      _actualSubmitDate: override.actualSubmitDate || deliverable._actualSubmitDate || '',
      _actualPassDate: override.actualPassDate || deliverable._actualPassDate || '',
      _actualArchiveDate: override.actualArchiveDate || deliverable._actualArchiveDate || '',
      _ownerNote: override.ownerNote || deliverable._ownerNote || '',
      reviewOpinion: override.reviewOpinion || deliverable.reviewOpinion || override.ownerNote || '',
      workflowHistory: override.workflowHistory.length ? override.workflowHistory : (deliverable.workflowHistory || []),
      notes: override.ownerNote || override.reviewOpinion || deliverable.notes || '',
    };
  });
}

function getMonth(value) {
  const date = coerceDate(value);
  if (!date) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function includesText(value, keyword) {
  return String(value || '').toLowerCase().includes(keyword);
}

function filterDeliverable(deliverable, filters) {
  const level = filters.level || filters.filterLevel || 'all';
  const type = filters.type || filters.filterType || 'all';
  const department = filters.department || filters.filterDept || 'all';
  const status = filters.status || filters.filterStatus || 'all';
  const month = filters.month || filters.filterMonth || 'all';
  const reviewer = filters.reviewer || 'all';
  const risk = filters.risk || 'all';
  const search = String(filters.search || '').trim().toLowerCase();

  if (level !== 'all' && deliverable.deliverableLevel !== level) return false;
  if (type !== 'all' && deliverable.deliverableType !== type) return false;
  if (department !== 'all' && deliverable.department !== department) return false;
  if (status !== 'all' && deliverable.deliverableStatus !== status) return false;
  if (reviewer !== 'all' && deliverable.reviewer !== reviewer) return false;
  if (risk !== 'all' && deliverable.taskRisk !== risk) return false;
  if (month !== 'all' && getMonth(deliverable.plannedFinish) !== month) return false;
  if (search) {
    const fields = [
      deliverable.deliverableId,
      deliverable.deliverableName,
      deliverable.taskName,
      deliverable.normalizedWbs,
      deliverable.department,
      deliverable.reviewer,
      deliverable.vendor,
    ];
    if (!fields.some(field => includesText(field, search))) return false;
  }
  return true;
}

function getSortValue(deliverable, key) {
  switch (key) {
    case 'plannedFinish':
      return coerceDate(deliverable.plannedFinish)?.getTime() ?? Number.POSITIVE_INFINITY;
    case 'deliverableLevel':
      return LEVEL_ORDER[deliverable.deliverableLevel] ?? 99;
    case 'deliverableStatus':
      return STATUS_ORDER[deliverable.deliverableStatus] ?? 99;
    case 'taskRisk':
      return RISK_ORDER[deliverable.taskRisk] ?? 99;
    case 'department':
    case 'reviewer':
    case 'deliverableName':
    case 'normalizedWbs':
      return String(deliverable[key] || '');
    default:
      return String(deliverable[key] || '');
  }
}

export function filterAndSortDeliverables(deliverables, filters = {}, sort = {}) {
  const sortKey = sort.key || 'plannedFinish';
  const direction = sort.direction === 'desc' ? -1 : 1;

  return deliverables
    .filter(deliverable => filterDeliverable(deliverable, filters))
    .sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * direction;
      return String(av).localeCompare(String(bv), 'zh-CN') * direction;
    });
}

function isOverdue(deliverable, referenceDate) {
  const finish = coerceDate(deliverable.plannedFinish);
  if (!finish) return false;
  if (deliverable.deliverableStatus === '通过' || deliverable.deliverableStatus === '已归档') return false;
  return finish < referenceDate;
}

export function createDashboardCardIntents({ tasks = [], deliverables = [], phaseGates = [], pmoDate = new Date() }) {
  const referenceDate = coerceDate(pmoDate) || new Date();
  const normalTasks = tasks.filter(task => !task.isSummary && !task.isMilestone);
  const summaryTasks = tasks.filter(task => task.isSummary);
  const milestones = tasks.filter(task => task.isMilestone);
  const highRiskTasks = tasks.filter(task => task.risk === '高');
  const aLevel = deliverables.filter(deliverable => deliverable.deliverableLevel === 'A');
  const bLevel = deliverables.filter(deliverable => deliverable.deliverableLevel === 'B');
  const overdue = deliverables.filter(deliverable => isOverdue(deliverable, referenceDate));
  const highRiskDeliverables = deliverables.filter(deliverable => deliverable.taskRisk === '高');
  const gateRisks = phaseGates.filter(gate => gate.status === '风险');

  return [
    { key: 'totalTasks', value: tasks.length, label: '总任务数', target: { page: 'gantt', taskFilters: {} } },
    { key: 'normalTasks', value: normalTasks.length, label: '普通任务', target: { page: 'gantt', taskFilters: { type: 'normal' } } },
    { key: 'summaryTasks', value: summaryTasks.length, label: '摘要任务', target: { page: 'gantt', taskFilters: { type: 'summary' } } },
    { key: 'milestones', value: milestones.length, label: '里程碑', target: { page: 'gantt', view: 'milestones', taskFilters: { milestone: 'yes' } } },
    { key: 'highRiskTasks', value: highRiskTasks.length, label: '高风险任务', target: { page: 'gantt', view: 'highrisk', taskFilters: { risk: '高' } }, highlight: true },
    { key: 'deliverableTotal', value: deliverables.length, label: '交付物总数', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: {} } },
    { key: 'aLevelDeliverables', value: aLevel.length, label: 'A类交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { level: 'A' } }, cls: 'stat-a' },
    { key: 'bLevelDeliverables', value: bLevel.length, label: 'B类交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { level: 'B' } }, cls: 'stat-b' },
    { key: 'overdueDeliverables', value: overdue.length, label: '延期交付物', target: { page: 'pmo', pmoView: 'overdue' }, highlight: true },
    { key: 'gateRisks', value: gateRisks.length, label: '阶段门风险', target: { page: 'pmo', pmoView: 'phasegates', gateStatus: '风险' }, highlight: true },
    { key: 'highRiskDeliverables', value: highRiskDeliverables.length, label: '高风险交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { risk: '高' } }, highlight: true },
  ];
}
