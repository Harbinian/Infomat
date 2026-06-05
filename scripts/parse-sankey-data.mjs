/**
 * 从 norms 目录下的部门映射文件解析全域映射表 + A1 行为明细，
 * 生成流程地图驾驶舱使用的数据快照。
 *
 * 用法: node scripts/parse-sankey-data.mjs
 * 输出:
 *   - stdout (紧凑 JSON)
 *   - docs/company-sankey-data.json
 *   - pmo/procedure-management/dashboard.html 内嵌数据快照
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const NORMS = resolve(import.meta.dirname || '.', '..', 'docs', 'norms');
const COMPANY_DATA_PATH = resolve(NORMS, '..', 'company-sankey-data.json');
const CROSS_DEPT_REPORT = resolve(NORMS, '流程治理', '跨部门完整性检查报告.md');
const CROSS_CHAIN_REPORT = resolve(NORMS, '流程治理', '跨部门流程识别报告.md');
const DASHBOARD_PATH = resolve(NORMS, '..', '..', 'pmo', 'procedure-management', 'dashboard.html');

// 组织架构: 部门 → 域 的映射
// 来源: docs/organization/组织架构和部门职责.md (以组织架构图为准)
//   总经理直辖: 工程技术部 / 质量管理部 / 财务部
//   经营副总: 行政人事部 / 经营发展部 / 物资保障部
//   生产副总: 项目管理部 / 复材车间 / 运维安环部
const DEPT_DOMAIN = {
  '经营发展部': '经营域',
  '行政人事部': '经营域',
  '物资保障部': '经营域',
  '财务部':     '总经理直辖域',  // 财务部归总经理直辖
  '工程技术部': '总经理直辖域',
  '质量管理部': '总经理直辖域',
  '项目管理部': '生产域',
  '复材车间': '生产域',
  '运维安环部': '生产域',
};

// 全域映射表文件名 — 自动发现 norms 目录下所有符合命名规范的文件
// 规范: {部门名}部门-能力-流程-系统映射关系.md
function discoverMappingFiles() {
  const result = [];
  const entries = readdirSync(NORMS, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('部门-能力-流程-系统映射关系.md')) {
      result.push(e.name);
    }
  }
  return result;
}

// ---- 解析工具 ----

/** 拆分中文顿号分隔的多值 S1，如 "OA、PLM、ERP" → ["OA","PLM","ERP"] */
function splitS1(raw) {
  if (!raw || raw.trim() === '') return [];
  const normalized = raw.trim();
  if (/^[-—–]+$/.test(normalized) || ['无', '不适用', 'NA', 'N/A'].includes(normalized.toUpperCase())) {
    return [];
  }
  return normalized.split(/[、，,]/).map(s => s.trim()).filter(Boolean);
}

/** 标准化 S1 名称 (PLM+MES → 拆成 PLM 和 MES) */
function normalizeSystem(s) {
  if (s.includes('+')) {
    return s.split('+').map(x => x.trim()).filter(Boolean);
  }
  return [s];
}

/** 拆分 Markdown 表格行，保留中间空单元格，避免列位左移 */
function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(c => c.trim());
}

/**
 * 从 md 文本中解析全域映射表 (Markdown table)。
 * 返回 { dept, l1, l2, l3, systems }[]
 *
 * 兼容两种表头格式:
 *   A: | 部门 | 能力域 | 业务能力 | 业务流程 | ... | 应用系统 |
 *   B: | 序号 | 部门 | 能力域 | 业务能力 | 业务流程 | ... | 应用系统 |
 */
function parseMappingTable(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);

  let inTable = false;
  let headerDone = false;
  let s1ColIndex = 5; // 默认 S1 在第 5 列 (无序号表头)

  for (const line of lines) {
    const trimmed = line.trim();

    // 空行在不间断表格中可能是排版空白，允许通过（物资保障部等文件有大量空行）
    if (!trimmed) {
      // 如果已经在表体内，空行不打断表格
      if (inTable && headerDone) continue;
      continue;
    }

    // 检测表格开始: 以 | 开头且包含表头关键词
    if (!inTable && trimmed.startsWith('|') && (
      trimmed.includes('能力域') || trimmed.includes('业务能力') ||
      trimmed.includes('业务流程') || trimmed.includes('应用系统')
    )) {
      inTable = true;
      headerDone = false;
      // 判断有没有序号列
      if (trimmed.includes('| 序号') || trimmed.match(/^\| 序号/)) {
        s1ColIndex = 6;
      } else {
        s1ColIndex = 5;
      }
      continue;
    }

    if (inTable && !headerDone) {
      // 分隔行
      if (trimmed.startsWith('|-') || trimmed.startsWith('| :-') || trimmed.match(/^\|[\s\-:|]+$/)) {
        headerDone = true;
      }
      continue;
    }

    if (inTable && headerDone) {
      // 非表格行 → 表格结束
      if (!trimmed.startsWith('|')) break;

      // 分隔行（多余的 |---|---| 行）→ 跳过
      if (trimmed.match(/^\|[\s\-:|]+$/)) continue;

      const cells = splitMarkdownRow(trimmed);
      if (cells.length < 4) continue;

      // 跳过汇总统计行 (第一列是 "指标" 等)
      if (cells[0] === '指标' || cells[0] === '部门/角色数') break;
      // 跳过非数据行
      if (cells[0] === '部门（D1）' || cells[0] === '序号') continue;
      // 第一列是纯数字（序号）→ 部门在 cells[1]
      const isNumbered = /^\d+$/.test(cells[0]);
      const deptIdx = isNumbered ? 1 : 0;
      const l1Idx = isNumbered ? 2 : 1;
      const l2Idx = isNumbered ? 3 : 2;
      const l3Idx = isNumbered ? 4 : 3;

      const dept = cells[deptIdx];
      if (!dept) continue;

      const l1 = cells[l1Idx] || '';
      const l2 = cells[l2Idx] || '';
      const l3 = cells[l3Idx] || '';
      const systemsRaw = cells[s1ColIndex] || '';

      const systems = splitS1(systemsRaw).flatMap(normalizeSystem);

      rows.push({ dept, l1, l2, l3, systems });
    }
  }

  return rows;
}

/**
 * 解析 A1 行为明细。
 * 在 "## 业务行为（A1）映射" 节中，
 * 每个 L3 标题 (#####) 后跟 A1 表格。
 *
 * 通过表头检测列位置，兼容多种表头格式。
 *
 * 返回 { l3Name, a1Name, system }[]
 */
function parseA1Section(text) {
  const results = [];
  const lines = text.split(/\r?\n/);

  // 找到 A1 节开始
  let a1Start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('## 业务行为（A1）')) {
      a1Start = i;
      break;
    }
  }
  if (a1Start === -1) return results;

  let currentL3 = null;
  let a1NameIdx = -1;
  let a1SysIdx = -1;
  let inTable = false;

  for (let i = a1Start; i < lines.length; i++) {
    const line = lines[i].trim();

      // 下一个 ## 大标题(非子标题),结束
      if (line.startsWith('## ') && !line.includes('业务行为') && !line.startsWith('###') && !line.startsWith('####') && !line.startsWith('#####')) {
        break;
      }

    // 检测 L3 标题 (##### 级别，含 "L3")
    if (line.startsWith('#####') && (line.includes('L3') || line.includes('业务流程'))) {
      // 提取 L3 名称
      // 格式: "##### 业务流程（L3）-0101 发展规划制定、调整、评审、发布与宣贯跟踪"
      // 或: "##### 业务流程（L3）-L3-01 安全基础..."
      currentL3 = line.replace(/^#####\s*/, '').replace(/业务流程（L3）[-\d]+\s*/, '').trim();
      inTable = false;
      a1NameIdx = -1;
      a1SysIdx = -1;
      continue;
    }

    // 检测 A1 表格表头
    // 修复:之前用 "含 A1 或 业务行为 或 执行角色" 太宽松,导致
    //       `#### 业务行为分布统计` / `#### 审批类型分布` / `### 汇总统计` 等子表
    //       被误识别为 A1 数据,产生大量伪 L3→A1 边(如 L3 → "应用系统" / L1 名 / "合计" / 审批类型 等)
    // 收紧:必须同时含 "业务行为" 和 "执行角色" 才重入(真 A1 表才同时有这两列)
    if (currentL3 && line.startsWith('|') && line.includes('业务行为') && line.includes('执行角色')) {
      const hdr = splitMarkdownRow(line);
      for (let j = 0; j < hdr.length; j++) {
        const c = hdr[j];
        // 行为名称列: 含"业务行为"但不含"编号"
        if (c.includes('业务行为') && !c.includes('编号')) a1NameIdx = j;
        // 备用: 行为名称
        if (c === '行为名称') a1NameIdx = j;
        // 系统列: 含"应用系统"或"S1"
        if (c.includes('应用系统') || c === 'S1') a1SysIdx = j;
      }
      inTable = true;
      continue;
    }

    // 分隔行
    if (inTable && line.match(/^\|[\s\-:|]+$/)) {
      continue;
    }

    // 数据行
    if (inTable && a1NameIdx >= 0 && line.startsWith('|')) {
      const cells = splitMarkdownRow(line);
      if (cells.length <= a1NameIdx) continue;

      const a1Name = cells[a1NameIdx];
      const sysRaw = a1SysIdx >= 0 && a1SysIdx < cells.length ? cells[a1SysIdx] : '';
      const systems = sysRaw ? splitS1(sysRaw).flatMap(normalizeSystem) : [];

      if (a1Name && a1Name.length > 1) {
        results.push({ l3Name: currentL3, a1Name, systems });
      }
    }

    // 非表格行且非空 → 退出当前表
    if (inTable && !line.startsWith('|') && line !== '') {
      inTable = false;
    }
  }

  return results;
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanMarkdownCell(raw) {
  return String(raw || '')
    .replace(/\*\*/g, '')
    .replace(/[🔴🟡🟢⚠✓△]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseReportNumber(raw, fallback = 0) {
  const match = String(raw || '').match(/\d+/);
  return match ? Number(match[0]) : fallback;
}

function extractReportMetric(text, label, fallback = 0) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([^|]+)\\|`);
  const match = text.match(re);
  return match ? parseReportNumber(match[1], fallback) : fallback;
}

function sectionForTarget(text, target) {
  const re = new RegExp(
    `###\\s+\\d+\\.\\d+[^\\n]*${escapeRegExp(target)}[^\\n]*\\n([\\s\\S]*?)(?=\\n---\\n|\\n###\\s+\\d+\\.\\d+|\\n##\\s+)`
  );
  const match = text.match(re);
  return match ? match[0] : '';
}

function extractStatus(section, fallback) {
  const match = section.match(/\*\*状态：([^*（]+)\*\*/);
  return match ? cleanMarkdownCell(match[1]) : fallback;
}

function extractRiskField(section, field) {
  for (const line of section.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length >= 2 && cleanMarkdownCell(cells[0]) === field) {
      return cleanMarkdownCell(cells[1]);
    }
  }
  return '';
}

function parseTargetSourceRows(section) {
  const rows = [];
  for (const line of section.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|') || /^[|\s:-]+$/.test(trimmed)) continue;
    const cells = splitMarkdownRow(trimmed);
    if (cells.length < 3) continue;

    const dept = cleanMarkdownCell(cells[0]);
    const count = parseReportNumber(cells[1], 0);
    if (DEPT_DOMAIN[dept] && count > 0) {
      rows.push({ dept, count });
    }
  }
  return rows;
}

function sourceGroupLabel(rows, fallback) {
  if (!rows.length) return fallback;
  if (rows.length === 1) return rows[0].dept;
  return `${rows[0].dept}等${rows.length}部门`;
}

function buildTargetRisk(text, target, risk, metricLabel, fallback) {
  const section = sectionForTarget(text, target);
  const rows = parseTargetSourceRows(section);
  const refs = extractReportMetric(text, metricLabel, rows.reduce((sum, row) => sum + row.count, 0));
  const status = extractStatus(section, fallback.status);
  const riskDesc = extractRiskField(section, '风险描述');
  const impact = extractRiskField(section, '影响范围');

  let desc = fallback.desc;
  if (target === '工程技术部' && impact) {
    desc = `所有指向工程技术部的A1在目标侧无对应流程，跨部门交互链在此节点断裂。${impact}`;
  } else if (riskDesc) {
    desc = riskDesc;
  }

  return {
    source: fallback.source || sourceGroupLabel(rows, '全部已映射部门'),
    target,
    a1: '—',
    refs,
    risk,
    desc,
    status,
  };
}

function parsePendingConfirmItems(text) {
  const results = [];
  let inSection = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('## 四、待确认事项')) {
      inSection = true;
      continue;
    }
    if (inSection && trimmed.startsWith('---')) break;
    if (!inSection || !trimmed.startsWith('|') || /^[|\s:-]+$/.test(trimmed)) continue;

    const cells = splitMarkdownRow(trimmed);
    if (cells.length < 4 || cells[0] === '来源部门') continue;

    results.push({
      source: cleanMarkdownCell(cells[0]),
      a1: cleanMarkdownCell(cells[1]),
      target: cleanMarkdownCell(cells[2]),
      refs: 1,
      risk: 'low',
      desc: cleanMarkdownCell(cells[3]),
      status: '已映射-待确认',
    });
  }

  return results;
}

function parseInteractionChains(text) {
  // 图示链路来自 docs/norms/流程治理/跨部门流程识别报告.md 的“三、关键跨部门流程链”。
  // 当前报告使用方框图表达，先保留与驾驶舱兼容的摘要，避免把图示文本误解析成结构化风险项。
  const candidates = [
    {
      name: '客户订单→交付链',
      breaks: ['工程技术部: BOM/工艺节点断裂,无映射文档'],
      status: 'partial',
    },
    {
      name: '成本管控链',
      breaks: ['工程技术部: BOM/技术方案输入缺失,财务部无法完整核算'],
      status: 'partial',
    },
    {
      name: '工装全生命周期链',
      breaks: ['沈飞民机科技创新部为外部实体,昌兴侧物资保障部执行层已覆盖'],
      status: 'ok',
    },
  ];

  if (!text) return candidates;
  return candidates.filter(chain => text.includes(chain.name));
}

function parseCrossDeptReport(text, chainText = '') {
  const risks = [
    buildTargetRisk(text, '工程技术部', 'high', '指向未映射部门（工程技术部）', {
      source: '全部已映射部门',
      status: '未映射-无文档',
      desc: '所有指向工程技术部的A1在目标侧无对应流程，跨部门交互链在此断裂。',
    }),
    buildTargetRisk(text, '复材车间', 'low', '指向已映射待复核部门（复材车间）', {
      status: '已映射-待复核',
      desc: '复材车间已完成部门映射，历史指向复材车间的跨部门交互需按现有流程逐条复核闭环关系。',
    }),
    ...parsePendingConfirmItems(text),
  ];

  return {
    stats: {
      totalChecked: extractReportMetric(text, '检查的跨部门引用总数（内部）', 0),
      confirmed: extractReportMetric(text, '已确认有对应覆盖', 0),
      pendingConfirm: extractReportMetric(text, '待确认（需人工判断）', 0),
      highRisk: extractReportMetric(text, '🔴 高风险项', 0),
      mediumRisk: extractReportMetric(text, '🟡 中风险项', 0),
    },
    risks,
    interactionChains: parseInteractionChains(chainText),
    source: 'docs/norms/流程治理/跨部门完整性检查报告.md',
  };
}

// ---- 主流程 ----

function main() {
  const allMappings = []; // { dept, l1, l2, l3, systems }
  const allA1 = [];       // { dept, l3Name, a1Name }

  const files = discoverMappingFiles();
  if (files.length === 0) {
    console.error('No mapping files found in norms directory.');
    process.exit(1);
  }
  console.error(`Found ${files.length} mapping file(s): ${files.join(', ')}`);
  for (const file of files) {
    const filePath = resolve(NORMS, file);
    let text;
    try {
      text = readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error(`Cannot read ${filePath}: ${e.message}`);
      continue;
    }

    const deptName = file.replace('部门-能力-流程-系统映射关系.md', '');
    const mappings = parseMappingTable(text);
    const a1Entries = parseA1Section(text);

    for (const m of mappings) {
      allMappings.push({ ...m, dept: deptName });
    }
    for (const a of a1Entries) {
      allA1.push({ dept: deptName, ...a });
    }
  }

  // ---- 构建桑基图数据 ----
  // 7 层: 昌兴复材 → 域 → 部门 → L2 → L3 → A1 → S1
  // ECharts sankey 格式: [{ source: 'name', target: 'name', value: n }]
  // 同名 source+target 合并 value

  const links = []; // { source, target, value }

  function addLink(source, target, value = 1) {
    links.push({ source, target, value });
  }

  const ROOT = '昌兴复材';

  // Layer 0→1: 昌兴复材 → 三个域
  const domains = new Set(Object.values(DEPT_DOMAIN));
  for (const d of domains) {
    addLink(ROOT, d, 1); // 等权重
  }

  // Layer 1→2: 域 → 部门
  for (const [dept, domain] of Object.entries(DEPT_DOMAIN)) {
    addLink(domain, dept, 1);
  }

  // Layer 2→3: 部门 → L2 (业务能力)
  const l2Set = new Set();
  for (const m of allMappings) {
    const l2Key = `${m.dept}||${m.l2}`;
    if (!l2Set.has(l2Key)) {
      l2Set.add(l2Key);
      addLink(m.dept, m.l2, 1);
    } else {
      // 增加已有 link 的 value
      const existing = links.find(l => l.source === m.dept && l.target === m.l2);
      if (existing) existing.value += 1;
    }
  }

  // Layer 3→4: L2 → L3 (每个 L2 到其 L3 是一对一关系，value=1)
  for (const m of allMappings) {
    addLink(m.l2, m.l3, 1);
  }

  // Layer 4→5: L3 → A1 (如果有 A1 数据)
  // A1 可能有自己的系统指定，也可能从 L3 继承
  const l3WithA1 = new Set(); // dept||l3Name

  for (const a of allA1) {
    // 精确匹配 L3 名称
    const matched = allMappings.find(m =>
      m.dept === a.dept && m.l3 === a.l3Name
    );
    if (matched) {
      l3WithA1.add(`${a.dept}||${a.l3Name}`);
      addLink(matched.l3, a.a1Name, 1);

      // Layer 5→6: A1 → S1
      // 优先用 A1 自己的系统列，否则用 L3 的系统
      const aSystems = a.systems && a.systems.length > 0 ? a.systems : matched.systems;
      for (const sys of aSystems) {
        addLink(a.a1Name, sys, 1);
      }
    }
  }

  // Layer 4→6: L3 → S1 (直接，对于没有 A1 数据的 L3)
  for (const m of allMappings) {
    const key = `${m.dept}||${m.l3}`;
    if (!l3WithA1.has(key)) {
      for (const sys of m.systems) {
        addLink(m.l3, sys, 1);
      }
    }
  }

  // 合并重复的 source+target (累加 value)
  const merged = new Map();
  for (const l of links) {
    const k = `${l.source}|||${l.target}`;
    if (merged.has(k)) {
      merged.get(k).value += l.value;
    } else {
      merged.set(k, { source: l.source, target: l.target, value: l.value });
    }
  }

  // 收集所有节点
  const nodeSet = new Set();
  for (const l of merged.values()) {
    nodeSet.add(l.source);
    nodeSet.add(l.target);
  }

  // 构建最终数据
  const nodes = Array.from(nodeSet).map(name => ({ name }));
  const finalLinks = Array.from(merged.values());

  // 给空部门加虚拟连线 (从域 → 部门 已经在上面加了，需要从部门到下一层)
  // 空部门: 不在 allMappings 中的部门
  const deptsWithData = new Set(allMappings.map(m => m.dept));
  for (const [dept, domain] of Object.entries(DEPT_DOMAIN)) {
    if (!deptsWithData.has(dept)) {
      // 从部门画一根虚拟线到占位节点
      const ghostNode = `[空]${dept}`;
      addLink(dept, ghostNode, 0.001);
    }
  }

  // 重新合并
  const merged2 = new Map();
  for (const l of links) {
    const k = `${l.source}|||${l.target}`;
    if (merged2.has(k)) {
      merged2.get(k).value += l.value;
    } else {
      merged2.set(k, { source: l.source, target: l.target, value: l.value });
    }
  }

  const allNodes = new Set();
  for (const l of merged2.values()) {
    allNodes.add(l.source);
    allNodes.add(l.target);
  }

  const finalData = {
    nodes: Array.from(allNodes).map(name => ({ name })),
    links: Array.from(merged2.values()),
    systems: (() => {
      function looksLikeSystemName(name) {
        if (!name) return false;
        const s = String(name).trim();
        if (s.length < 2 || s.length > 18) return false;
        if (!/[A-Za-z]/.test(s)) return false;
        if (!/^[A-Za-z0-9][A-Za-z0-9+._-]*$/.test(s)) return false;
        if (/^GL[A-Z]{0,6}-/i.test(s)) return false;
        return true;
      }

      const outgoing = new Set(Array.from(merged2.values()).map(l => l.source));
      const sinkCounts = new Map();
      for (const l of merged2.values()) {
        const target = l.target;
        if (!target || outgoing.has(target)) continue;
        if (!looksLikeSystemName(target)) continue;
        sinkCounts.set(target, (sinkCounts.get(target) || 0) + (Number(l.value) || 0));
      }

      return Array.from(sinkCounts.entries())
        .filter(([, count]) => count >= 2)
        .map(([name]) => name)
        .sort((a, b) => a.localeCompare(b, 'zh-CN'));
    })(),
    stats: {
      mappings: allMappings.length,
      a1: allA1.length,
      departmentsWithData: deptsWithData.size,
      departmentsEmpty: Object.keys(DEPT_DOMAIN).length - deptsWithData.size,
    },
  };

  let crossDeptReportText;
  try {
    crossDeptReportText = readFileSync(CROSS_DEPT_REPORT, 'utf-8');
  } catch (e) {
    console.error(`Cannot read ${CROSS_DEPT_REPORT}: ${e.message}`);
    process.exit(1);
  }

  let crossChainReportText = '';
  try {
    crossChainReportText = readFileSync(CROSS_CHAIN_REPORT, 'utf-8');
  } catch (e) {
    console.error(`WARN: Cannot read ${CROSS_CHAIN_REPORT}: ${e.message}`);
  }

  finalData.crossDept = parseCrossDeptReport(crossDeptReportText, crossChainReportText);

  writeFileSync(COMPANY_DATA_PATH, `${JSON.stringify(finalData, null, 2)}\n`, 'utf-8');
  console.error(`Wrote ${COMPANY_DATA_PATH}`);

  // 输出到 stdout (管道友好)
  process.stdout.write(JSON.stringify(finalData));

  // 同步注入到 PMO 驾驶舱的内嵌 JSON 标签，使页面保持单文件可双击打开。
  try {
    let dash = readFileSync(DASHBOARD_PATH, 'utf-8');
    const sankeyTagRe = /(<script type="application\/json" id="sankey-data">)[\s\S]*?(<\/script>)/;
    const crossTagRe = /(<script type="application\/json" id="cross-dept-data">)[\s\S]*?(<\/script>)/;

    if (sankeyTagRe.test(dash)) {
      dash = dash.replace(sankeyTagRe, `$1\n${JSON.stringify(finalData)}\n$2`);
    } else {
      console.error(`WARN: ${DASHBOARD_PATH} 没有 sankey-data 标签, 跳过内嵌`);
    }

    if (crossTagRe.test(dash)) {
      dash = dash.replace(crossTagRe, `$1\n${JSON.stringify(finalData.crossDept)}\n$2`);
    } else {
      console.error(`WARN: ${DASHBOARD_PATH} 没有 cross-dept-data 标签, 跳过内嵌`);
    }

    writeFileSync(DASHBOARD_PATH, dash, 'utf-8');
    const sizeKB = (Buffer.byteLength(dash, 'utf-8') / 1024).toFixed(0);
    console.error(`Inlined dashboard data into ${DASHBOARD_PATH} (${sizeKB} KB)`);
  } catch (e) {
    console.error(`WARN: 内嵌 dashboard.html 失败: ${e.message}`);
  }
}

main();
