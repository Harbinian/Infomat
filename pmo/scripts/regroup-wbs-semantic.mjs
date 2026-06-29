import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pmoRoot = resolve(here, '..');
const planPath = resolve(pmoRoot, '信息化项目_计划管控真源.md');
const wbsPath = resolve(pmoRoot, '信息化项目_WBS结构真源.md');
const SNAPSHOT_DATE = '2026-06-12';

const SEMANTIC_GROUPS = [
  { wbs: '1.1', name: '项目启动与治理机制', members: ['1.1', '1.2', '1.3'] },
  { wbs: '1.2', name: '现状调研', members: ['1.4', '1.5', '1.6', '1.7', '1.8', '1.9'] },
  { wbs: '1.3', name: '总体蓝图与实施计划评审', members: ['1.10', '1.11', '1.12', '1.13', '1.14'] },

  { wbs: '3.10', name: '主数据版本发布与交底机制', members: ['3.10', '3.11', '3.12', '3.13', '3.14', '3.15', '3.16', '3.17', '3.18', '3.19'] },

  { wbs: '4.1', name: '范围与对象边界', members: ['4.1', '4.2'] },
  { wbs: '4.2', name: '模型与映射关系', members: ['4.3', '4.4'] },
  { wbs: '4.3', name: '治理角色与版本分发', members: ['4.5', '4.6'] },
  { wbs: '4.4', name: '数据质量规则与指标', members: ['4.7', '4.8'] },
  { wbs: '4.5', name: '治理资料库与台账样例', members: ['4.9', '4.10', '4.11', '4.12'] },
  { wbs: '4.6', name: '分发接口与质量校验口径', members: ['4.13', '4.14', '4.15', '4.16'] },
  { wbs: '4.7', name: 'AI辅助治理与跨系统评审', members: ['4.17', '4.18', '4.19', '4.20'] },
  { wbs: '4.8', name: '阶段评审与试运行验收', members: ['4.21', '4.22', '4.23', '4.24'] },

  { wbs: '5.10', name: '基础设施生产环境就绪确认', members: ['5.10'] },

  { wbs: '6.1', name: '规范草案与集成方案', members: ['6.1', '6.2', '6.3', '6.4', '6.5', '6.6', '6.7', '6.8'] },
  { wbs: '6.2', name: '供应商复核与配置方案确认', members: ['6.9', '6.10'] },
  { wbs: '6.3', name: '模块配置开发', members: ['6.11', '6.12', '6.13', '6.14'] },
  { wbs: '6.4', name: '联调与系统测试', members: ['6.15', '6.16', '6.17'] },
  { wbs: '6.5', name: '用户培训', members: ['6.18'] },
  { wbs: '6.6', name: '验收准备与阶段验收', members: ['6.19', '6.20'] },

  { wbs: '7.1', name: '现状分析与需求规格', members: ['7.1', '7.2', '7.3', '7.4', '7.5'] },
  { wbs: '7.2', name: '主数据与接口方案', members: ['7.6', '7.7'] },
  { wbs: '7.3', name: '模块配置开发与单元测试', members: ['7.8', '7.9', '7.10', '7.11', '7.12', '7.13'] },
  { wbs: '7.4', name: '联调、培训与验收', members: ['7.14', '7.15', '7.16'] },
  { wbs: '7.5', name: 'ERP扩容与割接观察', members: ['7.17', '7.18', '7.19', '7.20'] },
  { wbs: '7.6', name: 'OA统一入口与接口治理', members: ['7.21', '7.22', '7.23', '7.24', '7.25'] },

  { wbs: '8.1', name: 'MES蓝图与内部评审', members: ['8.1', '8.2', '8.3', '8.4', '8.5'] },

  { wbs: '9.1', name: '主数据与跨系统接口联调', members: ['9.1', '9.2', '9.3', '9.4', '9.5', '9.6'] },
  { wbs: '9.2', name: '跨系统业务场景测试与整改', members: ['9.7', '9.8', '9.9', '9.10', '9.11', '9.12'] },
  { wbs: '9.3', name: '现场推广与培训', members: ['9.13', '9.14', '9.15', '9.16', '9.17'] },
  { wbs: '9.4', name: '数据治理常态化', members: ['9.18', '9.19', '9.20'] },

  { wbs: '10.1', name: 'AI应用与数字员工试点', members: ['10.1', '10.2', '10.3', '10.4', '10.5', '10.6', '10.7', '10.8'] },
  { wbs: '10.2', name: '驾驶舱深化', members: ['10.9', '10.10'] },
  { wbs: '10.3', name: '总体验收与风险缓冲', members: ['10.11', '10.12', '10.13'] },
];

function readSourceBlock(path, sourceType) {
  const text = readFileSync(path, 'utf8');
  const start = `<!-- pmo-${sourceType}-source:start -->`;
  const end = `<!-- pmo-${sourceType}-source:end -->`;
  const startIdx = text.indexOf(start);
  const endIdx = text.indexOf(end);
  if (startIdx < 0 || endIdx < 0) throw new Error(`Source block ${sourceType} not found in ${path}`);
  const block = text.slice(startIdx + start.length, endIdx);
  const jsonStart = block.indexOf('```json');
  const jsonEnd = block.lastIndexOf('```');
  if (jsonStart < 0 || jsonEnd < 0) throw new Error(`JSON fence not found in ${path}`);
  return JSON.parse(block.slice(jsonStart + '```json'.length, jsonEnd).trim());
}

function replaceSourceBlock(text, sourceType, data) {
  const start = `<!-- pmo-${sourceType}-source:start -->`;
  const end = `<!-- pmo-${sourceType}-source:end -->`;
  const pattern = new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}`);
  const nextBlock = `${start}\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n${end}`;
  return text.replace(pattern, nextBlock);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compareWbs(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i += 1) {
    const va = pa[i] ?? -1;
    const vb = pb[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

function depthOf(wbs) {
  return String(wbs).split('.').length;
}

function topOf(wbs) {
  return String(wbs).split('.')[0];
}

function minDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || '';
}

function maxDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || '';
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function riskFromChildren(children) {
  if (children.some(row => row['风险等级'] === '高')) return '高';
  if (children.some(row => row['风险等级'] === '中')) return '中';
  return '低';
}

function isZeroWorkdayDuration(duration) {
  return /^0\s*工作日$/.test(String(duration || '').trim());
}

function isMilestone(row) {
  return row['里程碑'] === '是' || row['任务类型'] === '里程碑' || isZeroWorkdayDuration(row['工期']);
}

function collectSubtreeWbs(allWbs, rootWbs) {
  return allWbs
    .filter(wbs => wbs === rootWbs || wbs.startsWith(`${rootWbs}.`))
    .sort(compareWbs);
}

function appendNote(row, note) {
  const existing = row['修复说明'] || '';
  if (existing.includes(note)) return;
  row['修复说明'] = existing ? `${existing}；${note}` : note;
}

function createSummaryRow(columns, id, group, children) {
  const row = Object.fromEntries(columns.map(column => [column, '']));
  const commonResources = unique(children.map(child => child['资源名称'] || child['主责资源']));
  const commonDepartments = unique(children.map(child => child['责任部门']));
  const start = minDate(children.map(child => child['开始时间']));
  const finish = maxDate(children.map(child => child['完成时间']));

  row.ID = String(id);
  row.WBS = group.wbs;
  row['任务名称'] = group.name;
  row['任务类型'] = '摘要';
  row['工期'] = '';
  row['开始时间'] = start;
  row['完成时间'] = finish;
  row['前置任务'] = '';
  row['资源名称'] = commonResources.length === 1 ? commonResources[0] : '信息化项目组';
  row['主责资源'] = row['资源名称'];
  row['责任部门'] = commonDepartments.length === 1 ? commonDepartments[0] : '信息化项目组';
  row['审核人/审批组'] = '';
  row['风险等级'] = riskFromChildren(children);
  row['里程碑'] = '否';
  row['备注'] = '语义分组新增二级摘要；原二级任务已下沉到本工作包。';
  row['原资源名称'] = row['资源名称'];
  row['资源池导入建议'] = '资源名称仅保留主责资源；协作资源、供应商资源建议映射到文本字段，不导入Resource Names';
  row['原ID'] = String(id);
  row['原WBS'] = group.wbs;
  row['修复说明'] = '语义分组新增二级摘要';
  row['是否虚拟摘要'] = '是';
  row['校准前开始时间'] = start;
  row['校准前完成时间'] = finish;
  row['时间轴校准说明'] = `新增摘要节点时间自动汇总：${start}~${finish}`;
  row['时间依赖校准说明'] = row['时间轴校准说明'];

  return row;
}

function rebuildParentDates(rows) {
  const byWbs = new Map(rows.map(row => [String(row.WBS), row]));
  const childrenByWbs = new Map();
  for (const row of rows) {
    const parts = String(row.WBS).split('.');
    if (parts.length <= 1) continue;
    const parentWbs = parts.slice(0, -1).join('.');
    if (!childrenByWbs.has(parentWbs)) childrenByWbs.set(parentWbs, []);
    childrenByWbs.get(parentWbs).push(row);
  }

  const parentWbsList = [...childrenByWbs.keys()].sort((a, b) => depthOf(b) - depthOf(a) || compareWbs(a, b));
  for (const wbs of parentWbsList) {
    const parent = byWbs.get(wbs);
    if (!parent) throw new Error(`Missing parent row ${wbs}`);
    const children = childrenByWbs.get(wbs) || [];
    const start = minDate(children.map(child => child['开始时间']));
    const finish = maxDate(children.map(child => child['完成时间']));
    const oldStart = parent['开始时间'] || '';
    const oldFinish = parent['完成时间'] || '';

    parent['任务类型'] = '摘要';
    parent['工期'] = '';
    parent['里程碑'] = '否';
    parent['开始时间'] = start;
    parent['完成时间'] = finish;
    if (oldStart !== start || oldFinish !== finish) {
      parent['时间轴校准说明'] = `摘要任务时间自动汇总：${oldStart || '-'}~${oldFinish || '-'} → ${start}~${finish}`;
      parent['时间依赖校准说明'] = parent['时间轴校准说明'];
    }
  }
}

function buildMoveMap(rows) {
  const allWbs = rows.map(row => String(row.WBS));
  const usedOld = new Set();
  const moveMap = new Map();

  for (const group of SEMANTIC_GROUPS) {
    let seq = 1;
    for (const member of group.members) {
      const subtree = collectSubtreeWbs(allWbs, member);
      if (!subtree.length) throw new Error(`Group ${group.wbs} references missing WBS ${member}`);
      for (const oldWbs of subtree) {
        if (usedOld.has(oldWbs)) throw new Error(`WBS ${oldWbs} assigned to multiple semantic groups`);
        usedOld.add(oldWbs);
        moveMap.set(oldWbs, `${group.wbs}.${seq}`);
        seq += 1;
      }
    }
  }

  const newWbsSet = new Set();
  for (const newWbs of moveMap.values()) {
    if (newWbsSet.has(newWbs)) throw new Error(`Duplicate generated WBS ${newWbs}`);
    newWbsSet.add(newWbs);
  }

  return moveMap;
}

function updateRows(planData) {
  const columns = planData.columns;
  const rows = planData.tasks.map(row => ({ ...row }));
  const moveMap = buildMoveMap(rows);

  for (const row of rows) {
    const oldWbs = String(row.WBS);
    const newWbs = moveMap.get(oldWbs);
    if (!newWbs) continue;
    row.WBS = newWbs;
    appendNote(row, `语义分组WBS治理：${oldWbs}→${newWbs}`);
  }

  const maxId = Math.max(...rows.map(row => Number(row.ID) || 0));
  let nextId = maxId + 1;
  const rowsWithGroups = [...rows];

  for (const group of SEMANTIC_GROUPS) {
    const children = rowsWithGroups.filter(row => {
      const wbs = String(row.WBS);
      return wbs.startsWith(`${group.wbs}.`) && depthOf(wbs) === 3;
    }).sort((a, b) => compareWbs(a.WBS, b.WBS));
    if (!children.length) throw new Error(`No generated children for group ${group.wbs}`);
    rowsWithGroups.push(createSummaryRow(columns, nextId, group, children));
    nextId += 1;
  }

  rebuildParentDates(rowsWithGroups);

  rowsWithGroups.sort((a, b) => compareWbs(a.WBS, b.WBS) || (Number(a.ID) || 0) - (Number(b.ID) || 0));
  return rowsWithGroups;
}

function buildSummary(rows, previousSummary = {}) {
  const start = minDate(rows.map(row => row['开始时间']));
  const finish = maxDate(rows.map(row => row['完成时间']));
  return {
    ...previousSummary,
    sourceName: previousSummary.sourceName || '信息化项目计划管控真源',
    schemaVersion: previousSummary.schemaVersion || 'pmo-md-source-v1',
    snapshotDate: SNAPSHOT_DATE,
    recordCount: rows.length,
    fieldCount: previousSummary.fieldCount || 45,
    projectStart: start,
    projectFinish: finish,
    milestoneCount: rows.filter(isMilestone).length,
    virtualSummaryCount: rows.filter(row => row['是否虚拟摘要'] === '是').length,
    deliverableCount: rows.filter(row => row['交付物']).length,
    highRiskCount: rows.filter(row => row['风险等级'] === '高').length,
    mediumRiskCount: rows.filter(row => row['风险等级'] === '中').length,
    criticalControlCount: rows.filter(row => row['是否关键路径控制'] === '是').length,
    h5FocusCount: rows.filter(row => row['是否H5重点展示'] === '是').length,
    wbsSourceFile: '信息化项目_WBS结构真源.md',
    previousGeneratedFrom: previousSummary.previousGeneratedFrom || 'Markdown 真源；历史 XLSX/MPP 已废弃'
  };
}

function buildCurrentSummaryTable(summary) {
  return `## 当前摘要\n\n| 项目 | 值 |\n| --- | --- |\n| 记录数 | ${summary.recordCount} |\n| 字段数 | ${summary.fieldCount} |\n| 项目周期 | ${summary.projectStart} 至 ${summary.projectFinish} |\n| 里程碑数量 | ${summary.milestoneCount} |\n| 虚拟摘要数量 | ${summary.virtualSummaryCount} |\n| 交付物数量 | ${summary.deliverableCount} |\n| 高风险任务 | ${summary.highRiskCount} |\n| 关键路径控制任务 | ${summary.criticalControlCount} |\n| H5重点展示任务 | ${summary.h5FocusCount} |\n`;
}

function replaceSection(text, startHeading, endHeading, replacement) {
  const pattern = new RegExp(`${escapeRegExp(startHeading)}[\\s\\S]*?(?=${escapeRegExp(endHeading)})`);
  return text.replace(pattern, `${replacement}\n`);
}

function buildWbsData(rows, previousData = {}) {
  const byWbs = new Map(rows.map(row => [String(row.WBS), row]));
  const childrenByWbs = new Map();
  for (const row of rows) {
    const parts = String(row.WBS).split('.');
    if (parts.length <= 1) continue;
    const parentWbs = parts.slice(0, -1).join('.');
    if (!childrenByWbs.has(parentWbs)) childrenByWbs.set(parentWbs, []);
    childrenByWbs.get(parentWbs).push(row);
  }

  const sortedRows = [...rows].sort((a, b) => compareWbs(a.WBS, b.WBS));
  const topWbsList = sortedRows
    .filter(row => depthOf(row.WBS) === 1)
    .map(row => String(row.WBS))
    .sort(compareWbs);

  const topLevelOverview = topWbsList.map(wbs => {
    const topRows = sortedRows.filter(row => topOf(row.WBS) === wbs);
    const row = byWbs.get(wbs);
    return {
      '一级WBS': wbs,
      '节点名称': row?.['任务名称'] || '',
      '节点数': topRows.length,
      '开始时间': minDate(topRows.map(item => item['开始时间'])),
      '完成时间': maxDate(topRows.map(item => item['完成时间'])),
    };
  });

  const wbsCounts = new Map();
  for (const row of rows) wbsCounts.set(row.WBS, (wbsCounts.get(row.WBS) || 0) + 1);
  const duplicateWbsCount = [...wbsCounts.values()].filter(count => count > 1).length;
  const orphanCount = rows.filter(row => {
    const parts = String(row.WBS).split('.');
    if (parts.length <= 1) return false;
    return !byWbs.has(parts.slice(0, -1).join('.'));
  }).length;

  const nodes = sortedRows.map(row => {
    const wbs = String(row.WBS);
    const children = (childrenByWbs.get(wbs) || []).sort((a, b) => compareWbs(a.WBS, b.WBS));
    return {
      WBS: wbs,
      '父级WBS': wbs.includes('.') ? wbs.split('.').slice(0, -1).join('.') : '',
      '一级WBS': topOf(wbs),
      '层级': depthOf(wbs),
      '排序键': wbs.split('.').map(Number),
      '任务ID': String(row.ID || ''),
      '节点名称': row['任务名称'] || '',
      '任务类型': row['任务类型'] || '',
      '是否摘要': row['任务类型'] === '摘要' || children.length ? '是' : '否',
      '是否里程碑': isMilestone(row) ? '是' : '否',
      '是否虚拟摘要': row['是否虚拟摘要'] || '否',
      '子节点数': children.length,
      '子WBS': children.map(child => String(child.WBS)),
      '开始时间': row['开始时间'] || '',
      '完成时间': row['完成时间'] || '',
      '责任部门': row['责任部门'] || '',
    };
  });

  return {
    schemaVersion: previousData.schemaVersion || 'pmo-md-source-v1',
    sourceType: 'pmo-wbs-structure',
    snapshotDate: SNAPSHOT_DATE,
    policy: {
      ...(previousData.policy || {}),
      authoritativeFile: '信息化项目_WBS结构真源.md',
      planAuthoritativeFile: '信息化项目_计划管控真源.md',
      editingRule: '维护 WBS 编号、父子层级、节点名称和排序；任务排程与执行字段以计划管控真源为准。',
      sortRule: 'WBS 按数字段排序，例如 10 在 9 之后，7.14 在 7.9 之后。'
    },
    summary: {
      nodeCount: rows.length,
      topLevelCount: topWbsList.length,
      orphanCount,
      duplicateWbsCount,
      maxDepth: Math.max(...rows.map(row => depthOf(row.WBS))),
    },
    topLevelOverview,
    nodes,
  };
}

function buildWbsSummarySection(summary) {
  return `## 当前摘要\n\n| 项目 | 值 |\n| --- | --- |\n| WBS节点数 | ${summary.nodeCount} |\n| 一级WBS数量 | ${summary.topLevelCount} |\n| 最大层级 | ${summary.maxDepth} |\n| 重复WBS数量 | ${summary.duplicateWbsCount} |\n| 孤儿WBS数量 | ${summary.orphanCount} |\n`;
}

function buildTopOverviewSection(topLevelOverview) {
  const rows = topLevelOverview
    .map(row => `| ${row['一级WBS']} | ${row['节点名称']} | ${row['节点数']} | ${row['开始时间']} | ${row['完成时间']} |`)
    .join('\n');
  return `## 一级 WBS 概览\n\n| 一级WBS | 节点名称 | 节点数 | 开始时间 | 完成时间 |\n| --- | --- | --- | --- | --- |\n${rows}\n`;
}

function validateRows(rows) {
  const byWbs = new Map(rows.map(row => [String(row.WBS), row]));
  const wbsSet = new Set();
  for (const row of rows) {
    const wbs = String(row.WBS);
    if (wbsSet.has(wbs)) throw new Error(`Duplicate WBS ${wbs}`);
    wbsSet.add(wbs);
    const parts = wbs.split('.');
    if (parts.length > 3) throw new Error(`WBS ${wbs} exceeds max depth 3`);
    if (parts.length > 1 && !byWbs.has(parts.slice(0, -1).join('.'))) throw new Error(`WBS ${wbs} missing parent`);
  }
}

const planData = readSourceBlock(planPath, 'plan');
const wbsData = readSourceBlock(wbsPath, 'wbs');
const nextRows = updateRows(planData);
validateRows(nextRows);

planData.snapshotDate = SNAPSHOT_DATE;
planData.summary = buildSummary(nextRows, planData.summary || {});
planData.tasks = nextRows;

let planText = readFileSync(planPath, 'utf8');
planText = replaceSection(planText, '## 当前摘要', '## 字段分组', buildCurrentSummaryTable(planData.summary));
planText = replaceSourceBlock(planText, 'plan', planData);
writeFileSync(planPath, planText, 'utf8');

const nextWbsData = buildWbsData(nextRows, wbsData);
let wbsText = readFileSync(wbsPath, 'utf8');
wbsText = replaceSection(wbsText, '## 当前摘要', '## 一级 WBS 概览', buildWbsSummarySection(nextWbsData.summary));
wbsText = replaceSection(wbsText, '## 一级 WBS 概览', '## 机器真源数据', buildTopOverviewSection(nextWbsData.topLevelOverview));
wbsText = replaceSourceBlock(wbsText, 'wbs', nextWbsData);
writeFileSync(wbsPath, wbsText, 'utf8');

console.log(`Regrouped PMO WBS semantically: ${nextRows.length} plan rows, ${SEMANTIC_GROUPS.length} new summary groups`);
