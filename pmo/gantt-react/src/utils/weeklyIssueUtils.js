import { formatDate, parseDate } from './dateUtils.js';

export const WEEKLY_ISSUE_TYPES = [
  {
    key: 'action',
    label: '周会行动项',
    ledgerName: '行动项台账',
    intakeRule: '会议形成明确动作、责任方、截止时间和输出物',
    closeRule: '输出物完成并被 PMO 确认，或形成可追溯的关闭说明',
  },
  {
    key: 'risk',
    label: '风险事项',
    ledgerName: '风险台账',
    intakeRule: '尚未发生但可能影响范围、时间、成本、质量或阶段门',
    closeRule: '风险消除、降级或应对措施完成，并确认不再影响本周期判断',
  },
  {
    key: 'issue',
    label: '问题事项',
    ledgerName: '问题台账',
    intakeRule: '已经发生的阻塞、逾期、材料缺口或阶段门缺口',
    closeRule: '处理结论、责任方、补充材料或整改结果已确认',
  },
  {
    key: 'change',
    label: '变更事项',
    ledgerName: '变更台账',
    intakeRule: '涉及范围、时间、资源、技术路线、依赖关系或验收口径调整',
    closeRule: '变更结论已审批，影响已同步到计划、交付物或执行口径',
  },
  {
    key: 'responsibility',
    label: '责任池事项',
    ledgerName: '责任池',
    intakeRule: '历史问题、责任边界不清、跨部门争议或暂不适合现场定责',
    closeRule: '责任边界、承接人、升级路径或默认处理口径已确认',
  },
];

export const WEEKLY_ISSUE_STATUSES = [
  { key: 'open', label: '待处理' },
  { key: 'doing', label: '处理中' },
  { key: 'blocked', label: '需升级' },
  { key: 'closed', label: '已关闭' },
];

const TYPE_BY_KEY = Object.fromEntries(WEEKLY_ISSUE_TYPES.map(type => [type.key, type]));
const STATUS_KEYS = new Set(WEEKLY_ISSUE_STATUSES.map(status => status.key));

function coerceDateText(value) {
  if (!value) return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) return formatDate(value);
  const parsed = typeof value === 'string' ? parseDate(value) : null;
  return parsed ? formatDate(parsed) : String(value).slice(0, 10);
}

function makeIssueId(prefix = 'W') {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${random}`;
}

export function getWeeklyIssueType(type) {
  return TYPE_BY_KEY[type] || TYPE_BY_KEY.action;
}

export function getWeeklyIssueStatus(status) {
  return WEEKLY_ISSUE_STATUSES.find(item => item.key === status) || WEEKLY_ISSUE_STATUSES[0];
}

export function createWeeklyIssueItem(input = {}) {
  const type = getWeeklyIssueType(input.type);
  const status = STATUS_KEYS.has(input.status) ? input.status : 'open';
  const now = new Date().toISOString();

  return {
    id: input.id || makeIssueId(type.key.toUpperCase()),
    type: type.key,
    ledgerName: type.ledgerName,
    title: String(input.title || '').trim(),
    owner: String(input.owner || '').trim() || 'PMO',
    dueDate: coerceDateText(input.dueDate),
    status,
    source: String(input.source || '').trim() || '周会现场',
    sourceKey: String(input.sourceKey || '').trim(),
    related: String(input.related || '').trim(),
    closeCriteria: String(input.closeCriteria || '').trim() || type.closeRule,
    note: String(input.note || '').trim(),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
  };
}

export function normalizeWeeklyIssueItems(rawItems) {
  const rows = Array.isArray(rawItems) ? rawItems : [];
  return rows
    .map(item => createWeeklyIssueItem(item))
    .filter(item => item.title);
}

export function summarizeWeeklyIssueItems(items = []) {
  const summary = {
    total: items.length,
    open: 0,
    closed: 0,
    byType: Object.fromEntries(WEEKLY_ISSUE_TYPES.map(type => [type.key, 0])),
    byStatus: Object.fromEntries(WEEKLY_ISSUE_STATUSES.map(status => [status.key, 0])),
  };

  for (const item of items) {
    if (item.status === 'closed') summary.closed += 1;
    else summary.open += 1;
    if (summary.byType[item.type] != null) summary.byType[item.type] += 1;
    if (summary.byStatus[item.status] != null) summary.byStatus[item.status] += 1;
  }

  return summary;
}

function isClosedDeliverable(deliverable) {
  return deliverable.deliverableStatus === '通过' || deliverable.deliverableStatus === '已归档';
}

function daysBetween(left, right) {
  return Math.floor((left.getTime() - right.getTime()) / (1000 * 60 * 60 * 24));
}

export function buildWeeklyIssueSuggestions({ tasks = [], deliverables = [], phaseGates = [], pmoDate = new Date() } = {}) {
  const referenceDate = pmoDate instanceof Date && !Number.isNaN(pmoDate.getTime()) ? pmoDate : new Date();
  const suggestions = [
    createWeeklyIssueItem({
      id: 'SUG-W-A03',
      type: 'action',
      title: '确认并试运行周会、风险、问题、变更、责任池模板',
      owner: 'PMO',
      dueDate: '2026-07-02',
      source: 'DLV-006 首次周例会行动项',
      sourceKey: 'W-A03',
      related: 'W-A03',
      note: '每类事项需要明确进入台账和关闭标准',
    }),
  ];

  tasks
    .filter(task => task.risk === '高' && !task.isSummary && !task.isMilestone)
    .slice(0, 8)
    .forEach(task => {
      suggestions.push(createWeeklyIssueItem({
        id: `SUG-TASK-${task.id || task.nodeKey || task.wbs}`,
        type: 'risk',
        title: `${task.wbs || task.normalizedWbs || ''} ${task.name || '高风险任务'}`.trim(),
        owner: task.department || task.reviewer || 'PMO',
        dueDate: task.finish,
        source: 'PMO 高风险任务',
        sourceKey: `task:${task.id || task.nodeKey || task.wbs}`,
        related: task.wbs || task.normalizedWbs || '',
        note: task.executionNote || task.notes || '',
      }));
    });

  deliverables
    .filter(deliverable => {
      const finish = parseDate(deliverable.plannedFinish);
      return finish && finish < referenceDate && !isClosedDeliverable(deliverable);
    })
    .slice(0, 8)
    .forEach(deliverable => {
      const finish = parseDate(deliverable.plannedFinish);
      const daysOverdue = finish ? Math.max(0, daysBetween(referenceDate, finish)) : 0;
      suggestions.push(createWeeklyIssueItem({
        id: `SUG-DLV-${deliverable.deliverableId}`,
        type: 'issue',
        title: `${deliverable.deliverableId || ''} ${deliverable.deliverableName || '延期交付物'}`.trim(),
        owner: deliverable.department || deliverable.reviewer || 'PMO',
        dueDate: deliverable.plannedFinish,
        source: 'PMO 延期交付物',
        sourceKey: `deliverable:${deliverable.deliverableId}`,
        related: deliverable.normalizedWbs || deliverable.taskName || '',
        note: daysOverdue ? `已延期 ${daysOverdue} 天` : '',
      }));
    });

  phaseGates
    .filter(gate => Array.isArray(gate.missing) && gate.missing.length > 0)
    .slice(0, 8)
    .forEach(gate => {
      suggestions.push(createWeeklyIssueItem({
        id: `SUG-GATE-${gate.gateId}`,
        type: 'issue',
        title: `阶段门缺失：${gate.gateName || gate.gateId}`,
        owner: 'PMO',
        source: 'PMO 阶段门缺失',
        sourceKey: `gate:${gate.gateId}`,
        related: gate.gateId || '',
        note: gate.missing.join('、'),
      }));
    });

  return suggestions;
}
