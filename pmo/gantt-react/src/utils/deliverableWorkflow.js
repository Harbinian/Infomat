import { formatDate, parseDate } from './dateUtils.js';
import { APPROVERS, addWorkingDays } from './pmoRoster.js';

export const DELIVERABLE_STATUSES = ['未提交', '编制中', '已提交', '待评审', '通过', '退回整改', '已归档'];

const STATUS_ORDER = Object.fromEntries(DELIVERABLE_STATUSES.map((status, index) => [status, index]));
const LEVEL_ORDER = { A: 1, B: 2, C: 3, D: 4 };
const RISK_ORDER = { 高: 1, 中: 2, 低: 3 };
export const STANDARD_GAP_BUCKETS = ['必须补', '自动可补', '合理暂缓', '需拆分后补', '人工复核'];
export const ACTIONABLE_STANDARD_GAP_BUCKETS = ['必须补', '自动可补', '需拆分后补', '人工复核'];

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

const ISO_DAY_TEXT = /^\d{4}-\d{2}-\d{2}$/u;

/**
 * 校验并原样返回 ISO 日期文本。
 *
 * 刻意不走 Date 往返：parseDate 构造的是本地时区 Date，而 formatIsoDay 用
 * toISOString() 转 UTC，会让东八区的 `2026-10-20` 回退成 `2026-10-19`。
 * 行动项截止时间本来就是 YYYY-MM-DD 文本，只需要格式与真实性校验。
 */
function requireIsoDay(value, field, deliverableId) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${deliverableId || '交付物'} 的 ${field} 不能为空`);
  const parsed = ISO_DAY_TEXT.test(text) ? parseDate(text) : null;
  if (!parsed || formatDate(parsed) !== text) {
    throw new Error(`${deliverableId || '交付物'} 的 ${field} 必须是有效日期 YYYY-MM-DD，当前: ${text}`);
  }
  return text;
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

  const EVIDENCE_REQUIRED_ACTIONS = ['startReview', 'approve', 'archive'];
  if (EVIDENCE_REQUIRED_ACTIONS.includes(command.action) && !deliverable.evidence) {
    throw new Error(`执行“${actionDef.label}”前需先上传凭证`);
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

function hasBoundExecutionStandard(task) {
  const standardId = String(task.executionStandardId || '').trim();
  return Boolean(standardId && standardId !== '暂缓');
}

export function getExecutionStandardDiagnostics(task) {
  if (task?.standardsGapBucket) {
    if (!ACTIONABLE_STANDARD_GAP_BUCKETS.includes(task.standardsGapBucket)) return [];
    return [...new Set([task.standardsGapBucket, ...(task.standardsGapReasons || [])])];
  }
  if (!task || task.isSummary || task.isMilestone) return [];

  const diagnostics = [];
  const standardId = String(task.executionStandardId || '').trim();
  const deferredReason = String(task.standardDeferredReason || '').trim();
  const isDeferred = standardId === '暂缓' || String(task.standardGapFlag || '').trim() === '暂缓';
  const hasStandard = hasBoundExecutionStandard(task);

  if (!hasStandard && !isDeferred) diagnostics.push('缺标准');
  if (task.risk === '高' && !hasStandard) diagnostics.push('高风险缺标准');
  if (task.isCriticalControl === '是' && !hasStandard) diagnostics.push('关键路径缺标准');
  if (isDeferred && !deferredReason) diagnostics.push('暂缓原因缺失');

  return [...new Set(diagnostics)];
}

export function isExecutionStandardGap(task) {
  if (task?.standardsGapBucket) return ACTIONABLE_STANDARD_GAP_BUCKETS.includes(task.standardsGapBucket);
  return getExecutionStandardDiagnostics(task).length > 0;
}

export function createDashboardCardIntents({ tasks = [], deliverables = [], phaseGates = [], pmoDate = new Date() }) {
  const referenceDate = coerceDate(pmoDate) || new Date();
  const normalTasks = tasks.filter(task => !task.isSummary && !task.isMilestone);
  const summaryTasks = tasks.filter(task => task.isSummary);
  const milestones = tasks.filter(task => task.isMilestone);
  const highRiskTasks = tasks.filter(task => task.risk === '高');
  const standardGapTasks = tasks.filter(task => isExecutionStandardGap(task));
  const highRiskStandardGapTasks = standardGapTasks.filter(task => task.risk === '高');
  const criticalStandardGapTasks = standardGapTasks.filter(task => task.isCriticalControl === '是');
  const phaseGateStandardGapTasks = standardGapTasks.filter(task => task.phaseGateNo || task.phaseGateName);
  const aLevel = deliverables.filter(deliverable => deliverable.deliverableLevel === 'A');
  const bLevel = deliverables.filter(deliverable => deliverable.deliverableLevel === 'B');
  const overdue = deliverables.filter(deliverable => isOverdue(deliverable, referenceDate));
  const highRiskDeliverables = deliverables.filter(deliverable => deliverable.taskRisk === '高');
  const gateRisks = phaseGates.filter(gate => gate.status === '风险');

  return [
    { key: 'totalTasks', value: tasks.length, label: '总任务数', target: { page: 'pmo', pmoView: 'tasks', taskFilters: {} } },
    { key: 'normalTasks', value: normalTasks.length, label: '普通任务', target: { page: 'pmo', pmoView: 'tasks', taskFilters: { taskKind: 'normal' } } },
    { key: 'summaryTasks', value: summaryTasks.length, label: '摘要任务', target: { page: 'pmo', pmoView: 'tasks', taskFilters: { taskKind: 'summary' } } },
    { key: 'milestones', value: milestones.length, label: '里程碑', target: { page: 'pmo', pmoView: 'tasks', taskFilters: { milestone: 'yes' } } },
    { key: 'highRiskTasks', value: highRiskTasks.length, label: '高风险任务', target: { page: 'pmo', pmoView: 'tasks', taskFilters: { risk: '高' } }, highlight: true },
    { key: 'standardGap', value: standardGapTasks.length, label: '执行标准缺口', target: { page: 'pmo', pmoView: 'standard-governance' }, highlight: standardGapTasks.length > 0 },
    { key: 'standardGapHighRisk', value: highRiskStandardGapTasks.length, label: '高风险缺标准', target: { page: 'pmo', pmoView: 'standard-governance', standardBucket: '必须补' }, highlight: highRiskStandardGapTasks.length > 0 },
    { key: 'standardGapCritical', value: criticalStandardGapTasks.length, label: '关键控制缺标准', target: { page: 'pmo', pmoView: 'standard-governance', standardBucket: '必须补' }, highlight: criticalStandardGapTasks.length > 0 },
    { key: 'standardGapGate', value: phaseGateStandardGapTasks.length, label: '阶段门缺标准', target: { page: 'pmo', pmoView: 'standard-governance', standardBucket: '必须补' }, highlight: phaseGateStandardGapTasks.length > 0 },
    { key: 'deliverableTotal', value: deliverables.length, label: '交付物总数', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: {} } },
    { key: 'aLevelDeliverables', value: aLevel.length, label: 'A类交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { level: 'A' } }, cls: 'stat-a' },
    { key: 'bLevelDeliverables', value: bLevel.length, label: 'B类交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { level: 'B' } }, cls: 'stat-b' },
    { key: 'overdueDeliverables', value: overdue.length, label: '延期交付物', target: { page: 'pmo', pmoView: 'overdue' }, highlight: true },
    { key: 'gateRisks', value: gateRisks.length, label: '阶段门风险', target: { page: 'pmo', pmoView: 'phasegates', gateStatus: '风险' }, highlight: true },
    { key: 'highRiskDeliverables', value: highRiskDeliverables.length, label: '高风险交付物', target: { page: 'pmo', pmoView: 'deliverables', ledgerFilters: { risk: '高' } }, highlight: true },
  ];
}

// ===== 行动项事件（双轴状态模型的第二轴）=====
//
// 轴一 status：交付物自身的编制/评审进度，沿用 DELIVERABLE_ACTIONS（本文件上半部分，未改动）。
// 轴二 action.state：行动项的承接与关闭，由本组事件驱动。两轴互不干扰。
//
// 逾期不是状态而是派生态（dueDate < today && state !== '已关闭'）——事实写进
// workflowHistory，徽标由计算得出，符合《协同工作规则》8.2「标记逾期并说明事实和影响」。

export const DELIVERABLE_EVENTS = {
  publish: { label: '发布行动项', to: '待接收', from: [null] },
  acknowledge: { label: '已接收', to: '已接收', from: ['待接收'] },
  submitResult: { label: '提交结果', to: '已提交待确认', from: ['待接收', '已接收'] },
  close: { label: '确认关闭', to: '已关闭', from: ['已接收', '已提交待确认'] },
  reopen: { label: '重新开启', to: '已接收', from: ['已关闭', '已提交待确认'] },
  changeDueDate: { label: '期限调整', to: null, from: ['待接收', '已接收', '已提交待确认'] },
  markOverdue: { label: '标记逾期', to: null, from: ['待接收', '已接收', '已提交待确认'] },
};

export function canApplyDeliverableEvent(state, action) {
  const definition = DELIVERABLE_EVENTS[action];
  if (!definition) return false;
  return definition.from.includes(state || null);
}

function requireText(value, message) {
  const text = String(value || '').trim();
  if (!text) throw new Error(message);
  return text;
}

function resolveNextAction(action, current, command, deliverable, at, { departments, approvers } = {}) {
  switch (action) {
    case 'publish': {
      const assigneeDepartment = requireText(command.assigneeDepartment, '发布行动项必须指定责任部门');
      if (Array.isArray(departments) && departments.length && !departments.includes(assigneeDepartment)) {
        throw new Error(`责任部门不在主备对接人名单内: ${assigneeDepartment}`);
      }
      const dueDate = requireIsoDay(command.dueDate, 'dueDate', deliverable?.deliverableId);

      const manualCriteria = command.criteriaSource === 'manual';
      return {
        assigneeDepartment,
        dueDate,
        state: DELIVERABLE_EVENTS.publish.to,
        publishedAt: at,
        publishedBy: String(command.actor || '').trim(),
        // 规则 6.2：主对接人应在 1 个工作日内回复「已接收」。固化下来以便对账。
        ackDueDate: command.ackDueDate || addWorkingDays(at.slice(0, 10), 1),
        acknowledgedAt: '',
        acknowledgedBy: '',
        resultNote: '',
        closedAt: '',
        closedBy: '',
        closureNote: '',
        criteriaSource: manualCriteria ? 'manual' : 'task',
        criteria: manualCriteria ? String(command.criteria || '') : '',
        evidenceRequirement: manualCriteria ? String(command.evidenceRequirement || '') : '',
      };
    }

    case 'acknowledge':
      return {
        ...current,
        state: DELIVERABLE_EVENTS.acknowledge.to,
        acknowledgedAt: at,
        acknowledgedBy: String(command.actor || '').trim(),
      };

    case 'submitResult':
      return {
        ...current,
        state: DELIVERABLE_EVENTS.submitResult.to,
        resultNote: requireText(command.resultNote, '提交结果必须填写结果或材料位置'),
      };

    case 'close': {
      const closureNote = requireText(command.closureNote, '确认关闭必须填写关闭结论');
      // 规则 6.4：没有结果或可核对依据的事项不得关闭
      const hasResult = Boolean(String(current?.resultNote || '').trim());
      const hasEvidence = Boolean(deliverable?.evidence);
      if (!hasResult && !hasEvidence) {
        throw new Error('缺少可核对依据：需先登记办理结果或上传凭证，才能确认关闭');
      }
      return {
        ...current,
        state: DELIVERABLE_EVENTS.close.to,
        closedAt: at,
        closedBy: String(command.actor || '').trim(),
        closureNote,
      };
    }

    case 'reopen':
      return {
        ...current,
        state: DELIVERABLE_EVENTS.reopen.to,
        closedAt: '',
        closedBy: '',
        closureNote: '',
      };

    case 'changeDueDate': {
      const dueDate = requireIsoDay(command.dueDate, 'dueDate', deliverable?.deliverableId);

      const scope = command.scope === 'gate' ? 'gate' : 'normal';
      const approvedBy = requireText(command.approvedBy, '期限调整必须记录同意人');
      const allowed = (approvers && approvers[scope]) || APPROVERS[scope];
      if (allowed && !allowed.includes(approvedBy)) {
        const scopeLabel = scope === 'gate' ? '跨部门/阶段门/项目基线' : '普通行动项';
        throw new Error(`${scopeLabel}的期限调整需由 ${allowed.join(' 或 ')} 同意后生效`);
      }
      // 规则 8.2：调整生效，但不得追溯消除已经发生的逾期事实 ——
      // 原截止时间保留在 workflowHistory 的历史条目里，此处只更新当前期限。
      return { ...current, dueDate };
    }

    case 'markOverdue':
      return { ...current };

    default:
      throw new Error(`未实现的交付物事件: ${action}`);
  }
}

/**
 * 应用一次行动项事件。
 *
 * @param options.departments  可选责任部门列表；提供时校验归属（服务端总是传入）
 * @param options.approvers    期限调整同意人；缺省用 APPROVERS 常量
 */
export function applyDeliverableEvent(deliverable, command, options = {}) {
  const action = command?.action;
  const definition = DELIVERABLE_EVENTS[action];
  if (!definition) throw new Error(`未知交付物事件: ${action || ''}`);

  const current = deliverable?.action || null;
  const fromState = current?.state || null;
  if (!definition.from.includes(fromState)) {
    throw new Error(`不允许从“${fromState || '未发布'}”执行“${definition.label}”`);
  }

  const at = formatIsoInstant(command.at);
  const nextAction = resolveNextAction(action, current, command, deliverable, at, options);

  const historyItem = {
    action,
    label: definition.label,
    from: fromState || '未发布',
    to: nextAction.state || fromState || '未发布',
    actor: command.actor || '',
    at,
    note: command.note || '',
  };

  return {
    ...deliverable,
    action: nextAction,
    workflowHistory: [...(deliverable.workflowHistory || []), historyItem],
  };
}

/**
 * 单一分派入口：状态迁移与行动项事件共用 /transition 端点。
 * 保持既有调用方（前端与 smoke-writeback）零改动。
 */
export function applyDeliverableCommand(deliverable, command, options) {
  if (DELIVERABLE_ACTIONS[command?.action]) {
    return transitionDeliverableStatus(deliverable, command);
  }
  if (DELIVERABLE_EVENTS[command?.action]) {
    return applyDeliverableEvent(deliverable, command, options);
  }
  throw new Error(`未知交付物动作: ${command?.action || ''}`);
}
