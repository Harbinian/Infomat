// deliverableUtils.js — 交付物抽取、类型分类、等级分类
import { parseDate } from './dateUtils.js';
import { applyDeliverableOverrides, validateDeliverableOverrides } from './deliverableWorkflow.js';

const TYPE_KEYWORDS = [
  { type: '方案规范类', keywords: ['方案', '规范', '模型', '规则', '模板', '蓝图', '架构', '设计', '口径', '标准'] },
  { type: '需求规格类', keywords: ['需求', '规格', '需求规格说明书'] },
  { type: '系统功能类', keywords: ['模块', '功能', '平台', '系统', '环境', '接口', '配置', '开发', '台账', '审批流', '版本管理', '分发', '看板', '代码仓库', '数据库', '中间件', '服务器', '虚拟化'] },
  { type: '测试联调类', keywords: ['测试', '联调', '演练', '恢复', '压测', '验证', '试运行'] },
  { type: '评审验收类', keywords: ['评审', '上线', '验收', '发布', '确认单', '就绪', '纪要'] },
  { type: '报告清单类', keywords: ['报告', '清单', '审计', '问题', '差距', '风险', '质量报告', '试点报告'] },
  { type: '培训手册类', keywords: ['培训', '手册', '操作手册', '运维手册', '材料'] },
  { type: '过程记录类', keywords: ['记录', '会议纪要', '调研记录', '流程材料', '映射'] },
];

const GATE_TASK_NAMES = [
  '蓝图评审', '数据标准V1.0', 'MDM平台一期上线', 'MDM一期验收',
  'PLM基础深化验收', 'MES蓝图评审', 'MES一期试运行', 'MES一期正式上线',
  '全系统集成联调完成', '生产现场全面推广完成', '数据治理常态化机制验收',
  'AI应用/数字员工试点完成', '项目总体验收'
];

const GATE_DELIVERABLE_NAMES = [
  '验收报告', '上线确认单', '评审意见', '总体蓝图', '数据标准V1.0'
];

const MAINLINE_WBS_PREFIXES = ['3', '4', '5', '6', '7', '8', '9', '10'];
const loadFsApi = import.meta.env?.DEV ? () => import('./deliverableFsApi.js') : null;

function mergeDeliverableWithFrontmatter(deliverable, record) {
  const fm = record?.frontmatter || {};
  return {
    ...deliverable,
    deliverableId: fm.deliverableId || deliverable.deliverableId,
    deliverableName: fm.title || deliverable.deliverableName,
    deliverableType: fm.deliverableType || deliverable.deliverableType,
    deliverableLevel: fm.deliverableLevel || deliverable.deliverableLevel,
    department: fm.department || deliverable.department,
    owner: fm.owner || deliverable.owner || '',
    reviewer: fm.reviewer || deliverable.reviewer,
    plannedFinish: fm.plannedFinish || deliverable.plannedFinish,
    taskRisk: fm.risk || deliverable.taskRisk,
    deliverableStatus: fm.status || deliverable.deliverableStatus,
    _actualSubmitDate: fm.actualSubmitDate || deliverable._actualSubmitDate || '',
    _actualPassDate: fm.actualPassDate || deliverable._actualPassDate || '',
    _actualArchiveDate: fm.actualArchiveDate || deliverable._actualArchiveDate || '',
    reviewOpinion: fm.reviewOpinion || deliverable.reviewOpinion || '',
    _ownerNote: fm.ownerNote || deliverable._ownerNote || '',
    evidence: fm.evidence || deliverable.evidence || null,
    workflowHistory: Array.isArray(fm.workflowHistory) ? fm.workflowHistory : (deliverable.workflowHistory || []),
    canonicalFileName: record.fileName || '',
    canonicalMtime: record.mtime || 0,
    canonicalBody: record.body || '',
    notes: fm.ownerNote || fm.reviewOpinion || deliverable.notes || '',
  };
}

export function classifyDeliverableType(task) {
  const text = `${task.name || ''}${task.deliverable || ''}${task.type || ''}`;
  for (const { type, keywords } of TYPE_KEYWORDS) {
    if (keywords.some(kw => text.includes(kw))) return type;
  }
  return '其他';
}

export function classifyDeliverableLevel(task, deliverableType) {
  if (task.isMilestone) return 'A';
  const text = `${task.name || ''}${task.deliverable || ''}`;
  if (GATE_TASK_NAMES.some(n => text.includes(n))) return 'A';
  if (GATE_DELIVERABLE_NAMES.some(n => text.includes(n))) return 'A';

  if (['系统功能类', '测试联调类', '需求规格类'].includes(deliverableType)) return 'B';
  if (task.risk === '高') return 'B';
  const topWbs = String(task.wbs || '').split('.')[0];
  if (MAINLINE_WBS_PREFIXES.includes(topWbs)) return 'B';
  if (/接口|模块|测试报告|联调记录|主数据模型|质量校验|看板/.test(task.deliverable || '')) return 'B';

  if (/调研记录|培训记录|会议纪要|操作手册|运维手册|流程材料/.test(text)) return 'C';
  if (deliverableType === '培训手册类' || deliverableType === '过程记录类') return 'C';
  if (/草案|初稿|内部材料|临时说明/.test(text)) return 'D';

  return 'C';
}

export function normalizeDeliverables(normalizedTasks) {
  const deliverables = [];
  let counter = 1;

  for (const task of normalizedTasks) {
    const deliverableName = (task.deliverable || '').trim();
    if (!deliverableName) continue;
    if (task.notes && task.notes.includes('[自动生成的虚拟父节点]')) continue;

    const deliverableType = classifyDeliverableType(task);
    const deliverableLevel = classifyDeliverableLevel(task, deliverableType);

    deliverables.push({
      deliverableId: `DLV-${String(counter).padStart(3, '0')}`,
      taskId: task.originalId ?? task.id,
      taskName: task.name,
      originalWbs: task.originalWbs || task.wbs,
      normalizedWbs: task.normalizedWbs || task.wbs,
      nodeKey: task.nodeKey,
      deliverableName,
      deliverableType,
      deliverableLevel,
      department: task.department || '',
      reviewer: task.reviewer || '',
      vendor: task.vendor || '',
      plannedFinish: task.finish || '',
      taskRisk: task.risk || '中',
      deliverableStatus: '未提交',
      isPhaseGate: deliverableLevel === 'A',
      isRequiredForGate: false,
      notes: ''
    });
    counter++;
  }

  for (const d of deliverables) {
    if (d.deliverableLevel === 'A' || /验收|上线|评审|蓝图|标准/.test(d.deliverableName)) {
      d.isPhaseGate = true;
    }
  }

  console.log(
    `%c✓ 交付物抽取完成：${deliverables.length} 个 (A:${deliverables.filter(d => d.deliverableLevel === 'A').length} B:${deliverables.filter(d => d.deliverableLevel === 'B').length} C:${deliverables.filter(d => d.deliverableLevel === 'C').length} D:${deliverables.filter(d => d.deliverableLevel === 'D').length})`,
    'color:#27ae60;'
  );
  return deliverables;
}

export function calcDeliverableStats(deliverables, tasks, referenceDate = new Date()) {
  const aLevel = deliverables.filter(d => d.deliverableLevel === 'A');
  const bLevel = deliverables.filter(d => d.deliverableLevel === 'B');
  const overdue = deliverables.filter(d => {
    if (!d.plannedFinish) return false;
    if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
    const finish = parseDate(d.plannedFinish);
    return finish && finish < referenceDate;
  });
  const highRiskDeliverables = deliverables.filter(d => d.taskRisk === '高');
  const highRiskTasks = tasks.filter(t => t.risk === '高');
  const normalTasks = tasks.filter(t => !t.isSummary && !t.isMilestone);
  const summaryTasks = tasks.filter(t => t.isSummary);
  const milestones = tasks.filter(t => t.isMilestone);

  return {
    totalTasks: tasks.length,
    normalTaskCount: normalTasks.length,
    summaryTaskCount: summaryTasks.length,
    milestoneCount: milestones.length,
    deliverableTotal: deliverables.length,
    aLevelCount: aLevel.length,
    bLevelCount: bLevel.length,
    overdueCount: overdue.length,
    highRiskTaskCount: highRiskTasks.length,
    highRiskDlvCount: highRiskDeliverables.length,
  };
}

export async function loadDeliverableStatusOverrides(deliverables) {
  if (loadFsApi) {
    try {
      const { listDeliverables } = await loadFsApi();
      const records = await listDeliverables();
      const recordMap = new Map((records || []).map(record => [record.deliverableId, record]));
      const updated = deliverables.map(deliverable => {
        const record = recordMap.get(deliverable.deliverableId);
        return record ? mergeDeliverableWithFrontmatter(deliverable, record) : deliverable;
      });
      const changed = updated.filter(item => recordMap.has(item.deliverableId));
      if (changed.length) {
        console.log(`%c✓ 加载交付物正本文件：${changed.length} 项`, 'color:#27ae60;');
      } else {
        console.log('%cℹ 未读取到交付物正本文件，继续使用旧覆盖层/默认字段', 'color:#8b90a0;');
      }
      return updated;
    } catch (error) {
      console.warn('加载交付物正本文件失败，尝试旧覆盖层:', error.message);
    }
  }

  try {
    const response = await fetch('deliverable-status.json');
    if (!response.ok) {
      console.log('%cℹ 未找到 deliverable-status.json，使用默认状态', 'color:#8b90a0;');
      return deliverables;
    }

    const rawOverrides = await response.json();
    const overrides = validateDeliverableOverrides(rawOverrides);
    const updated = applyDeliverableOverrides(deliverables, overrides);
    const overrideIds = new Set(overrides.map(item => item.deliverableId));
    const changed = updated.filter(deliverable => overrideIds.has(deliverable.deliverableId));
    console.log(`%c✓ 加载交付物状态覆盖：${changed.length} 项`, 'color:#27ae60;');
    return updated;
  } catch (error) {
    console.warn('加载 deliverable-status.json 失败:', error.message);
    return deliverables;
  }
}
