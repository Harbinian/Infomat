// phaseGateUtils.js — 阶段门定义、三层匹配、状态计算
import { parseDate } from './dateUtils.js';

const GATE_ALIAS_MAP = {
  '总体蓝图': ['蓝图文件', '总体方案'],
  '系统架构方案': ['架构方案', '技术架构方案'],
  'MES蓝图': ['MES总体蓝图', 'MES实施蓝图'],
  '联调报告': ['集成联调报告', '接口联调报告'],
  '试运行报告': ['试运行总结', '试运行总结报告'],
  '验收报告': ['验收总结报告', '阶段验收报告'],
  '培训材料': ['培训资料', '培训教材', '培训文档'],
  '测试报告': ['测试总结报告', '模块测试报告'],
  '正式上线报告': ['上线报告', '上线确认单'],
};

const GATE_DEFINITIONS = [
  {
    gateId: 'GATE-01',
    gateName: '总体蓝图评审',
    plannedDate: '',
    requiredDeliverables: ['总体蓝图', '系统架构方案', '总体实施计划', '评审材料'],
    blockingRule: '不通过不得进入详细建设'
  },
  {
    gateId: 'GATE-02',
    gateName: '数据标准V1.0发布',
    requiredDeliverables: ['主数据分类标准', '编码规则', '属性模板', '数据质量模板', '培训材料'],
    blockingRule: '不通过不得作为 MDM/MES 正式主数据依据'
  },
  {
    gateId: 'GATE-03',
    gateName: 'MDM一期上线',
    requiredDeliverables: ['主数据台账', '审批流', '版本管理', '数据分发', '质量校验', '数据质量看板', '试运行报告'],
    blockingRule: '不通过不得进入 MES 主数据联调'
  },
  {
    gateId: 'GATE-04',
    gateName: 'PLM基础深化验收',
    requiredDeliverables: ['EBOM规范', 'EBOM到MBOM转换规则', '工艺结构化模板', 'PLM-MDM接口', 'PLM-MES接口', '测试报告', '验收报告'],
    blockingRule: '不通过不得进入 MES 工艺/MBOM 联调'
  },
  {
    gateId: 'GATE-05',
    gateName: 'MES一期上线',
    requiredDeliverables: ['MES蓝图', '详细需求规格说明书', '详细设计说明书', '模块测试报告', '接口联调记录', '培训材料', '试运行报告', '正式上线报告'],
    blockingRule: '不通过不得进入生产现场全面推广'
  },
  {
    gateId: 'GATE-06',
    gateName: '流程导向低代码平台基础能力完成',
    requiredDeliverables: ['首批场景范围确认', '平台方案设计', '流程表单配置', '业务台账与审批流配置', '平台基础能力测试', '培训材料'],
    blockingRule: '不通过不得与 MES 等流程业务场景联动'
  },
  {
    gateId: 'GATE-07',
    gateName: '全系统集成联调完成',
    requiredDeliverables: ['联调方案', '联调记录', '问题清单', '整改关闭清单', '联调报告'],
    blockingRule: '不通过不得进入总体验收'
  },
  {
    gateId: 'GATE-08',
    gateName: '项目总体验收',
    requiredDeliverables: ['总体验收报告', '运维交接材料', '风险关闭清单', '问题关闭清单', '知识库归档'],
    blockingRule: '不通过不得关闭项目'
  }
];

const GATE_WBS_PREFIXES = {
  'GATE-01': ['1'],
  'GATE-02': ['3'],
  'GATE-03': ['4'],
  'GATE-04': ['6'],
  'GATE-05': ['8'],
  'GATE-06': ['8'],
  'GATE-07': ['9'],
  'GATE-08': ['10'],
};

function getMatchText(deliverable) {
  return `${deliverable.deliverableName || ''}${deliverable.taskName || ''}`.toLowerCase();
}

function exactMatch(deliverable, keyword) {
  return getMatchText(deliverable).includes(keyword.toLowerCase());
}

function sameMainlineMatch(deliverable, keyword, gateWbsPrefixes) {
  const deliverablePrefix = String(deliverable.normalizedWbs || deliverable.originalWbs || '').split('.')[0];
  if (!gateWbsPrefixes.includes(deliverablePrefix)) return false;

  const text = getMatchText(deliverable);
  const keywordChars = keyword.toLowerCase().replace(/\s+/g, '');
  if (!keywordChars) return false;

  let matchedChars = 0;
  for (const char of keywordChars) {
    if (text.includes(char)) matchedChars++;
  }
  return matchedChars >= keywordChars.length * 0.75;
}

function aliasMatch(deliverable, keyword) {
  const aliases = GATE_ALIAS_MAP[keyword] || [];
  const text = getMatchText(deliverable);
  return aliases.some(alias => text.includes(alias.toLowerCase()));
}

function dedupeSuspects(suspects) {
  const seen = new Set();
  return suspects.filter(item => {
    const key = `${item.required}:${item.deliverable.deliverableId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isApproved(deliverable) {
  return deliverable.deliverableStatus === '通过' || deliverable.deliverableStatus === '已归档';
}

function isSubmitted(deliverable) {
  return ['已提交', '待评审', '通过', '已归档'].includes(deliverable.deliverableStatus);
}

export function matchDeliverablesToGate(gate, deliverables) {
  const confirmed = [];
  const suspected = [];
  const missing = [];
  const wbsPrefixes = GATE_WBS_PREFIXES[gate.gateId] || [];

  for (const required of gate.requiredDeliverables) {
    const exact = deliverables.find(deliverable => exactMatch(deliverable, required));
    if (exact) {
      confirmed.push({ required, deliverable: exact, matchType: '精确' });
      continue;
    }

    const wbsSuspects = deliverables
      .filter(deliverable => sameMainlineMatch(deliverable, required, wbsPrefixes))
      .map(deliverable => ({ required, deliverable, matchType: 'WBS主线' }));

    if (wbsSuspects.length) {
      suspected.push(...dedupeSuspects(wbsSuspects));
      continue;
    }

    const aliasSuspects = deliverables
      .filter(deliverable => aliasMatch(deliverable, required))
      .map(deliverable => ({ required, deliverable, matchType: '别名表' }));

    if (aliasSuspects.length) {
      suspected.push(...dedupeSuspects(aliasSuspects));
    } else {
      missing.push(required);
    }
  }

  return { confirmed, suspected, missing };
}

function computeGateStatus(gate, confirmed, suspected, missing, referenceDate) {
  const now = referenceDate || new Date();
  const totalRequired = gate.requiredDeliverables.length;
  const confirmedCount = confirmed.length;
  const suspectedCount = suspected.length;
  const confirmedDeliverables = confirmed.map(({ deliverable }) => deliverable);
  const reviewReviewItems = [...confirmed, ...suspected].map(({ deliverable }) => deliverable);

  if (confirmedCount === 0 && suspectedCount === 0) return { status: '未开始', color: '#9A8F7A' };
  const hasOverdue = reviewReviewItems.some(deliverable => {
    const finish = parseDate(deliverable.plannedFinish);
    return finish && finish < now && !isApproved(deliverable);
  });
  if (hasOverdue) return { status: '风险', color: '#B24A3A' };

  if (confirmedCount === totalRequired) {
    const allApproved = confirmedDeliverables.every(isApproved);
    if (allApproved) return { status: '通过', color: '#6F8A6A' };
    const allSubmitted = confirmedDeliverables.every(isSubmitted);
    if (allSubmitted) return { status: '待评审', color: '#B88919' };
    return { status: '待提交', color: '#B88919' };
  }
  if (confirmedCount > 0 || suspectedCount > 0) {
    if (suspectedCount > 0 || missing.length > 0) return { status: '待确认', color: '#B88919' };
    if (confirmedDeliverables.some(isSubmitted)) return { status: '进行中', color: '#6E879F' };
    return { status: '待提交', color: '#B88919' };
  }

  return { status: '待确认', color: '#B88919' };
}

function summarizeGateEvidence(confirmed, suspected) {
  return [...confirmed, ...suspected].map(match => {
    const deliverable = match.deliverable;
    return {
      required: match.required,
      matchType: match.matchType,
      deliverableId: deliverable.deliverableId,
      deliverableName: deliverable.deliverableName,
      taskName: deliverable.taskName,
      normalizedWbs: deliverable.normalizedWbs,
      status: deliverable.deliverableStatus,
      evidenceFileName: deliverable.evidence?.fileName || '',
      evidenceUploadedAt: deliverable.evidence?.uploadedAt || '',
    };
  });
}

export function buildPhaseGates(deliverables, referenceDate) {
  return GATE_DEFINITIONS.map(gate => {
    const { confirmed, suspected, missing } = matchDeliverablesToGate(gate, deliverables);
    const { status, color } = computeGateStatus(gate, confirmed, suspected, missing, referenceDate);
    const confirmedApprovedCount = confirmed.filter(({ deliverable }) => isApproved(deliverable)).length;
    const confirmedSubmittedCount = confirmed.filter(({ deliverable }) => isSubmitted(deliverable)).length;
    return {
      ...gate,
      confirmed,
      suspected,
      missing,
      evidenceSummary: summarizeGateEvidence(confirmed, suspected),
      status,
      statusColor: color,
      confirmedCount: confirmed.length,
      suspectedCount: suspected.length,
      confirmedSubmittedCount,
      confirmedApprovedCount,
      totalRequired: gate.requiredDeliverables.length,
    };
  });
}

export function countGatesAtRisk(phaseGates) {
  return phaseGates.filter(gate => gate.status === '风险').length;
}
