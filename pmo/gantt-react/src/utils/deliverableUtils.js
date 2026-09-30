// deliverableUtils.js — 交付物抽取、类型分类、等级分类、绑定解析
//
// 身份契约（2026-09 重构）：
//   受控交付物 = `pmo/deliverables/DLV-###-*.md` 正本文件存在。编号稳定，可发布行动项。
//   计划投影行 = 任务 deliverable 自由文本的投影，用 projectionKey(`task:<id>`) 标识。
//   投影行不占用 DLV 命名空间、不持久化、不可发布。
//
//   projectionKey 会随任务增删变化（regroup-wbs-semantic.mjs 会重排 taskId），
//   任何模块都不得把它当外键写入磁盘或跨会话引用。
//
// 重构前此处按 `DLV-${counter++}` 给投影行发号，counter 无条件递增，
// 导致影子编号与正本编号空间重叠（DLV-006/007 正本被静默丢弃、DLV-179 被顶替）。
// 现在的规则是：编号只来自正本文件，绑定只来自显式锚点，绝不靠文本相似度猜测。

import { parseDate } from './dateUtils.js';

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
const DLV_ID = /^DLV-\d{3}$/u;
const VIRTUAL_PARENT_MARK = '[自动生成的虚拟父节点]';
const PHASE_GATE_NAME_RE = /验收|上线|评审|蓝图|标准/;

/** 投影行状态：未纳入受控管理，因此不可发布行动项。 */
export const PROJECTION_STATUS = '未纳管';

export const BINDING_SOURCES = {
  taskField: 'task-field',
  frontmatter: 'frontmatter',
  none: 'none',
};

export function isControlledDeliverableId(value) {
  return DLV_ID.test(String(value || '').trim());
}

export function taskIdOf(task) {
  return task?.originalId ?? task?.id ?? null;
}

export function taskKeyOf(task) {
  const id = taskIdOf(task);
  return id == null ? '' : `task:${id}`;
}

// ===== 类型与等级分类（保留原口径） =====

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

export function isPhaseGateDeliverable(deliverableName, deliverableLevel) {
  return deliverableLevel === 'A' || PHASE_GATE_NAME_RE.test(String(deliverableName || ''));
}

// ===== 文本相似度（仅供对账建议，不再参与合并） =====

function compactMatchText(value) {
  return String(value || '').toLowerCase().replace(/[^\p{Script=Han}a-z0-9]/gu, '');
}

function longestCommonSubstringLength(left, right) {
  if (!left || !right) return 0;
  let longest = 0;
  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = left[i - 1] === right[j - 1] ? previous[j - 1] + 1 : 0;
      if (current[j] > longest) longest = current[j];
    }
    previous.splice(0, previous.length, ...current);
    current.fill(0);
  }
  return longest;
}

function scoreBindingCandidate(projection, frontmatter) {
  const reasons = [];
  let score = 0;

  const title = compactMatchText(frontmatter.title);
  const texts = [projection.candidateName, projection.taskName].map(compactMatchText).filter(Boolean);
  if (title && texts.length) {
    const overlap = Math.max(...texts.map(text => (
      title.includes(text) || text.includes(title) ? Math.max(title.length, text.length) : longestCommonSubstringLength(title, text)
    )));
    if (overlap >= 4) {
      score += overlap;
      reasons.push(`名称文本重叠 ${overlap} 字`);
    }
  }

  if (frontmatter.plannedFinish && projection.plannedFinish && frontmatter.plannedFinish === projection.plannedFinish) {
    score += 2;
    reasons.push(`计划完成日期相同（${frontmatter.plannedFinish}）`);
  }

  if (frontmatter.normalizedWbs && projection.normalizedWbs && String(frontmatter.normalizedWbs) === String(projection.normalizedWbs)) {
    score += 5;
    reasons.push(`WBS 相同（${frontmatter.normalizedWbs}）`);
  }

  return { score, reasons };
}

/**
 * 为一条投影行给出可绑定的受控交付物建议。
 *
 * 这是原 shouldMergeDeliverableFrontmatter 的降级形态：只产出建议供人工确认，
 * 绝不自动合并。命中「项目治理」这类 4 字巧合不再导致错误合并。
 */
export function suggestDeliverableBinding(projection, controlled = []) {
  return controlled
    .map(record => {
      const frontmatter = record.frontmatter || {};
      const { score, reasons } = scoreBindingCandidate(projection, frontmatter);
      return {
        deliverableId: frontmatter.deliverableId || '',
        deliverableName: frontmatter.title || '',
        score,
        reasons,
      };
    })
    .filter(candidate => candidate.deliverableId && candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.deliverableId.localeCompare(right.deliverableId));
}

/**
 * 反向建议：为一份未绑定的受控交付物找出可能的计划投影行。
 *
 * 与 suggestDeliverableBinding 共用同一套评分，同样只作人工确认的输入，不自动绑定。
 */
export function suggestProjectionBinding(deliverableRow, projections = []) {
  const frontmatter = {
    title: deliverableRow?.deliverableName || '',
    plannedFinish: deliverableRow?.plannedFinish || '',
  };

  return projections
    .map(projection => {
      const { score, reasons } = scoreBindingCandidate(projection, frontmatter);
      return {
        projectionKey: projection.projectionKey,
        taskId: projection.taskId,
        candidateName: projection.candidateName,
        taskName: projection.taskName,
        normalizedWbs: projection.normalizedWbs,
        score,
        reasons,
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((left, right) => right.score - left.score || String(left.projectionKey).localeCompare(String(right.projectionKey)));
}

// ===== 计划投影行 =====

function collectTaskWbsKeys(task) {
  return [...new Set([task.normalizedWbs, task.originalWbs, task.wbs]
    .map(value => String(value || '').trim())
    .filter(Boolean))];
}

/**
 * 从任务数据投影出候选交付物行。
 *
 * @param boundTaskIds 已被受控交付物吸收的任务 id 集合（字符串）。这些任务不再产出投影行。
 */
export function buildProjectionCandidates(normalizedTasks = [], { boundTaskIds = new Set() } = {}) {
  const projections = [];

  for (const task of normalizedTasks) {
    const candidateName = String(task.deliverable || '').trim();
    if (!candidateName) continue;
    if (task.notes && task.notes.includes(VIRTUAL_PARENT_MARK)) continue;

    const taskId = taskIdOf(task);
    if (taskId != null && boundTaskIds.has(String(taskId))) continue;

    const deliverableType = classifyDeliverableType(task);
    const deliverableLevel = classifyDeliverableLevel(task, deliverableType);

    projections.push({
      recordKind: 'projection',
      projectionKey: taskKeyOf(task),
      deliverableId: '',
      taskId,
      taskName: task.name || '',
      originalWbs: task.originalWbs || task.wbs || '',
      normalizedWbs: task.normalizedWbs || task.wbs || '',
      nodeKey: task.nodeKey || '',
      candidateName,
      deliverableName: candidateName,
      deliverableType,
      deliverableLevel,
      department: task.department || '',
      owner: '',
      reviewer: task.reviewer || '',
      vendor: task.vendor || '',
      plannedFinish: task.finish || '',
      planFinishSource: 'task',
      taskRisk: task.risk || '中',
      deliverableStatus: PROJECTION_STATUS,
      bindingSource: BINDING_SOURCES.none,
      action: null,
      completionCriteria: task.completionCriteria || '',
      evidenceRequirements: task.evidenceRequirements || '',
      checklistId: task.checklistId || '',
      evidence: null,
      workflowHistory: [],
      isPhaseGate: false,
      isRequiredForGate: false,
      notes: '',
    });
  }

  return projections;
}

// ===== 绑定解析 =====

function makeIssue({ kind, severity, deliverableId = '', projectionKey = '', fileName = '', title, detail, candidates = [], suggestedAction = 'none', detectedAt = '' }) {
  return {
    issueId: `${kind}:${deliverableId || projectionKey || fileName}`,
    kind,
    severity,
    deliverableId,
    projectionKey,
    fileName,
    title,
    detail,
    candidates,
    suggestedAction,
    detectedAt,
  };
}

function indexTasks(tasks) {
  const byTaskId = new Map();
  const byWbs = new Map();

  for (const task of tasks) {
    const taskId = taskIdOf(task);
    if (taskId != null) byTaskId.set(String(taskId), task);
    for (const key of collectTaskWbsKeys(task)) {
      if (!byWbs.has(key)) byWbs.set(key, new Set());
      byWbs.get(key).add(task);
    }
  }

  return { byTaskId, byWbs };
}

function wbsCandidates(byWbs, value) {
  const key = String(value || '').trim();
  if (!key) return [];
  return [...(byWbs.get(key) || [])];
}

/**
 * 解析受控交付物与计划任务的绑定关系。
 *
 * 解析顺序（显式优先，绝不猜）：
 *   1. 任务侧 `受控交付物编号` 命中且正本存在 → task-field
 *   2. 正本 frontmatter 的 normalizedWbs / wbs 命中唯一任务 → frontmatter
 *   3. 仅正本 frontmatter.taskId 命中 → frontmatter（弱锚点）
 *   4. 多任务声明同一编号，或两侧指向不同任务 → BINDING_CONFLICT，不静默择一
 *   5. 都无 → none
 */
export function resolveDeliverableBindings({ tasks = [], controlled = [], detectedAt = '' } = {}) {
  const issues = [];
  const { byTaskId, byWbs } = indexTasks(tasks);

  const declaredByDlv = new Map();
  for (const task of tasks) {
    const declared = String(task.deliverableId || '').trim();
    if (!isControlledDeliverableId(declared)) continue;
    if (!declaredByDlv.has(declared)) declaredByDlv.set(declared, []);
    declaredByDlv.get(declared).push(task);
  }

  const controlledIds = new Set(
    controlled.map(record => record?.frontmatter?.deliverableId).filter(Boolean),
  );

  // 任务声明了受控编号，但没有正本文件 —— 悬空引用
  for (const [deliverableId, owners] of declaredByDlv) {
    if (controlledIds.has(deliverableId)) continue;
    for (const task of owners) {
      const taskId = taskIdOf(task);
      issues.push(makeIssue({
        kind: 'BINDING_DANGLING',
        severity: 'error',
        deliverableId,
        projectionKey: taskKeyOf(task),
        title: `${deliverableId} 被任务引用但缺少正本`,
        detail: `task ${taskId}（WBS ${task.normalizedWbs || task.wbs}）声明了受控交付物编号 ${deliverableId}，但 pmo/deliverables/ 下没有对应正本，该绑定不生效。`,
        suggestedAction: 'create-file',
        detectedAt,
      }));
    }
  }

  const bindings = new Map();

  for (const record of controlled) {
    const frontmatter = record?.frontmatter || {};
    const deliverableId = frontmatter.deliverableId;
    if (!deliverableId) continue;

    const fromTaskField = declaredByDlv.get(deliverableId) || [];
    const fromWbs = wbsCandidates(byWbs, frontmatter.normalizedWbs);
    const fromWbsFallback = fromWbs.length ? fromWbs : wbsCandidates(byWbs, frontmatter.wbs);
    const fromTaskId = frontmatter.taskId != null ? [byTaskId.get(String(frontmatter.taskId))].filter(Boolean) : [];

    let task = null;
    let source = BINDING_SOURCES.none;

    if (fromTaskField.length > 1) {
      task = fromTaskField[0];
      source = BINDING_SOURCES.taskField;
      issues.push(makeIssue({
        kind: 'BINDING_CONFLICT',
        severity: 'error',
        deliverableId,
        fileName: record.fileName || '',
        title: `${deliverableId} 被多个任务声明`,
        detail: `计划真源中有 ${fromTaskField.length} 个任务填写了受控交付物编号 ${deliverableId}（task ${fromTaskField.map(taskIdOf).join('、')}），无法判断归属；台账按 task ${taskIdOf(task)} 显示。`,
        candidates: fromTaskField.map(item => ({ kind: 'task', taskId: taskIdOf(item), wbs: item.normalizedWbs || item.wbs, name: item.name })),
        suggestedAction: 'fix-frontmatter',
        detectedAt,
      }));
    } else if (fromTaskField.length === 1) {
      task = fromTaskField[0];
      source = BINDING_SOURCES.taskField;
      const conflictsWithFrontmatter = (fromWbsFallback.length && !fromWbsFallback.includes(task))
        || (fromTaskId.length && fromTaskId[0] !== task);
      if (conflictsWithFrontmatter) {
        const other = fromWbsFallback.find(item => item !== task) || fromTaskId[0];
        issues.push(makeIssue({
          kind: 'BINDING_CONFLICT',
          severity: 'error',
          deliverableId,
          fileName: record.fileName || '',
          title: `${deliverableId} 两侧锚点指向不同任务`,
          detail: `计划真源声明 task ${taskIdOf(task)}，正本 frontmatter 指向 task ${taskIdOf(other)}；台账按计划真源显示，请修正其中一侧。`,
          candidates: [
            { kind: 'task', taskId: taskIdOf(task), wbs: task.normalizedWbs || task.wbs, name: task.name },
            { kind: 'task', taskId: taskIdOf(other), wbs: other.normalizedWbs || other.wbs, name: other.name },
          ],
          suggestedAction: 'fix-frontmatter',
          detectedAt,
        }));
      }
    } else if (fromWbsFallback.length === 1) {
      task = fromWbsFallback[0];
      source = BINDING_SOURCES.frontmatter;
    } else if (fromWbsFallback.length > 1) {
      task = fromWbsFallback[0];
      source = BINDING_SOURCES.frontmatter;
      issues.push(makeIssue({
        kind: 'BINDING_WEAK_ANCHOR',
        severity: 'warn',
        deliverableId,
        fileName: record.fileName || '',
        title: `${deliverableId} 的 WBS 锚点命中多个任务`,
        detail: `frontmatter.normalizedWbs=${frontmatter.normalizedWbs} 命中 ${fromWbsFallback.length} 个任务，台账按 task ${taskIdOf(task)} 显示。`,
        candidates: fromWbsFallback.map(item => ({ kind: 'task', taskId: taskIdOf(item), wbs: item.normalizedWbs || item.wbs, name: item.name })),
        suggestedAction: 'fix-frontmatter',
        detectedAt,
      }));
    } else if (fromTaskId.length === 1) {
      task = fromTaskId[0];
      source = BINDING_SOURCES.frontmatter;
      issues.push(makeIssue({
        kind: 'BINDING_WEAK_ANCHOR',
        severity: 'warn',
        deliverableId,
        fileName: record.fileName || '',
        title: `${deliverableId} 仅有 taskId 弱锚点`,
        detail: `frontmatter 只声明了 taskId=${frontmatter.taskId}，缺少 normalizedWbs；建议补齐 WBS 锚点以免任务重排后失配。`,
        candidates: [{ kind: 'task', taskId: taskIdOf(task), wbs: task.normalizedWbs || task.wbs, name: task.name }],
        suggestedAction: 'bind-file',
        detectedAt,
      }));
    } else {
      issues.push(makeIssue({
        kind: 'UNBOUND_DELIVERABLE',
        severity: 'info',
        deliverableId,
        fileName: record.fileName || '',
        title: `${deliverableId} 尚未绑定计划任务`,
        detail: frontmatter.ownerNote
          ? `正本存在但无显式锚点。ownerNote 声明：${frontmatter.ownerNote}`
          : '正本存在但无显式锚点；该交付物按正本自身日期跟踪，不参与计划任务联动。',
        suggestedAction: 'bind-task',
        detectedAt,
      }));
    }

    bindings.set(deliverableId, {
      deliverableId,
      taskId: task ? taskIdOf(task) : null,
      normalizedWbs: task ? String(task.normalizedWbs || task.wbs || '') : String(frontmatter.normalizedWbs || ''),
      bindingSource: source,
      task: task || null,
    });
  }

  return { bindings, issues };
}

// ===== 受控行构造 =====

/**
 * 把正本记录与绑定结果合成一条受控台账行。
 *
 * plannedFinish 口径：绑定了计划任务时以任务 finish 为准（计划真源优先），
 * 无锚点时退回正本自身日期。行动项截止时间另立 action.dueDate，不受此影响。
 */
export function mergeControlledWithBinding(record, binding) {
  const frontmatter = record?.frontmatter || {};
  const task = binding?.task || null;
  const deliverableId = frontmatter.deliverableId || '';
  const deliverableLevel = frontmatter.deliverableLevel || 'C';
  const deliverableName = frontmatter.title || deliverableId;

  return {
    recordKind: 'controlled',
    deliverableId,
    deliverableName,
    deliverableId_isControlled: true,
    deliverableType: frontmatter.deliverableType || '',
    deliverableLevel,
    department: frontmatter.department || '',
    owner: frontmatter.owner || '',
    reviewer: frontmatter.reviewer || '',
    vendor: task?.vendor || '',
    plannedFinish: task?.finish || frontmatter.plannedFinish || '',
    planFinishSource: task ? 'task' : 'frontmatter',
    taskRisk: frontmatter.risk || '中',
    deliverableStatus: frontmatter.status || '未提交',
    workflowHistory: Array.isArray(frontmatter.workflowHistory) ? frontmatter.workflowHistory : [],
    evidence: frontmatter.evidence || null,
    reviewOpinion: frontmatter.reviewOpinion || '',
    ownerNote: frontmatter.ownerNote || '',
    _actualSubmitDate: frontmatter.actualSubmitDate || '',
    _actualPassDate: frontmatter.actualPassDate || '',
    _actualArchiveDate: frontmatter.actualArchiveDate || '',
    _ownerNote: frontmatter.ownerNote || '',
    canonicalFileName: record.fileName || '',
    canonicalMtime: record.mtime || 0,
    canonicalBody: record.body || '',
    taskId: binding?.taskId ?? null,
    taskName: task?.name || '',
    originalWbs: task ? String(task.originalWbs || task.wbs || '') : '',
    normalizedWbs: task ? String(task.normalizedWbs || task.wbs || '') : String(frontmatter.normalizedWbs || ''),
    nodeKey: task?.nodeKey || '',
    bindingSource: binding?.bindingSource || BINDING_SOURCES.none,
    action: frontmatter.action || null,
    completionCriteria: task?.completionCriteria || '',
    evidenceRequirements: task?.evidenceRequirements || '',
    checklistId: task?.checklistId || '',
    isPhaseGate: isPhaseGateDeliverable(deliverableName, deliverableLevel),
    isRequiredForGate: false,
    notes: frontmatter.ownerNote || frontmatter.reviewOpinion || '',
  };
}

// ===== 统计（保留原口径） =====

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
