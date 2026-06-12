#!/usr/bin/env node

import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_CONTRACT = join(ROOT, 'docs', 'contracts', 'dcm-bbm-contract.json');

const BASIS_WORDS = ['依据', '根据', '基于', '参照', '按'];
const BASIS_OBJECT_WORDS = ['订单', '清单', '计划', '制度', '文件', '资料', '数据', '台账', '附件', '标准', '通知'];
const TRANSFER_WORDS = [
  '下发',
  '下达',
  '传递',
  '发送',
  '提交',
  '报送',
  '反馈',
  '通知',
  '签收',
  '签字',
  '接收',
  '领取',
  '移交',
  '交接',
  '递交',
  '分配',
  '流转',
  '上报',
  '转发',
  '同步',
  '确认',
  '回传',
  '提供',
  '出具',
  '沟通',
  '核对',
  '校对',
  '跟踪',
  '回执',
];
const GENERIC_DEPT_PATTERNS = [
  /相关/,
  /各/,
  /业务部门/,
  /职能部门/,
  /生产部门/,
  /使用部门/,
  /需求部门/,
  /责任部门/,
  /客户/,
  /供应商/,
  /外部/,
];
const ROLE_ONLY_WORDS = ['负责', '执行', '组织', '参与', '配合', '协同', '归档', '备案', '存档', '审批', '审核', '批准', '会签'];
const REVIEW_ORDER = { 待补证据: 0, 需部门确认: 1, 提示: 2 };

function todayStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultReportPath(root) {
  return join(root, 'docs', 'reports', `${todayStamp()}-a1-transfer-evidence-audit.md`);
}

function parseArgs(argv) {
  const args = { contract: DEFAULT_CONTRACT, root: ROOT };
  for (const arg of argv) {
    if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--no-write') args.noWrite = true;
    else if (arg.startsWith('--report=')) args.report = resolve(args.root, arg.slice('--report='.length));
    else if (arg.startsWith('--contract=')) args.contract = resolve(args.root, arg.slice('--contract='.length));
    else if (arg.startsWith('--root=')) args.root = resolve(arg.slice('--root='.length));
  }
  if (!args.report) args.report = defaultReportPath(args.root);
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rel(path, root = ROOT) {
  return relative(root, path).replace(/\\/g, '/');
}

function md(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function short(value, max = 72) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  return /^\|[\s\-:|]+$/.test(line.trim());
}

function findHeaderIndex(header, names) {
  const expected = Array.isArray(names) ? names : [names];
  for (const name of expected) {
    const exact = header.findIndex((cell) => cell === name);
    if (exact >= 0) return exact;
  }
  for (const name of expected) {
    const fuzzy = header.findIndex((cell) => cell.includes(name));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

function cell(row, header, names) {
  const idx = findHeaderIndex(header, names);
  return idx >= 0 && idx < row.cells.length ? row.cells[idx].trim() : '';
}

function isBlankToken(value, contract) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return true;
  if (/^[-—–]+$/.test(normalized)) return true;
  const tokens = contract.systems?.blankTokens ?? ['', '-', '—', '–', '无', '不适用', 'NA', 'N/A'];
  return tokens.some((token) => String(token).toUpperCase() === normalized.toUpperCase());
}

function splitDeptList(value, contract) {
  if (isBlankToken(value, contract)) return [];
  return String(value)
    .split(/[、，,；;\/]/)
    .map((item) => item.trim())
    .filter((item) => item && !isBlankToken(item, contract));
}

function looksLikeA1Header(header) {
  const text = header.join('|');
  return (
    (text.includes('业务行为（A1）编号') || text.includes('A1编号')) &&
    text.includes('业务行为（A1）') &&
    text.includes('应用系统')
  );
}

function collectTable(lines, headerIndex) {
  const header = splitMarkdownRow(lines[headerIndex]);
  const rows = [];
  let endIndex = headerIndex;

  for (let i = headerIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!trimmed.startsWith('|')) break;
    endIndex = i;
    if (isSeparatorRow(trimmed)) continue;

    const cells = splitMarkdownRow(trimmed);
    if (cells.join('|') === header.join('|')) continue;
    if (cells[0] === '业务行为（A1）编号' || cells[0] === 'A1编号') continue;
    rows.push({ line: i + 1, cells });
  }

  return { header, rows, startLine: headerIndex + 1, endIndex: endIndex + 1 };
}

function startsBbmSection(line, contract) {
  const trimmed = line.trim();
  const patterns = contract.bbm?.sectionHeadingPatterns ?? ['## 业务行为（A1）映射'];
  return patterns.some((pattern) => trimmed.startsWith(pattern));
}

function extractL3FromHeading(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('#')) return '';
  let title = trimmed.replace(/^#+\s*/, '').trim();
  if (!/(业务流程（L3）|L3-|^[A-Z]{1,6}-\d{2}-\d{2}|^\d{4}\s)/.test(title)) return '';
  title = title
    .replace(/^业务流程（L3）[-—\s]*/, '')
    .replace(/^[A-Z]{1,6}-L3-\d+\s+/, '')
    .replace(/^[A-Z]{1,6}-\d{2}-\d{2}\s+/, '')
    .replace(/^L3-\d+\s+/, '')
    .replace(/^\d{4}\s+/, '')
    .trim();
  return title;
}

function parseMappingDoc(file, dept, contract) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const records = [];
  let inBbm = false;
  let currentL3 = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (startsBbmSection(line, contract)) inBbm = true;
    if (inBbm) {
      const headingL3 = extractL3FromHeading(line);
      if (headingL3) currentL3 = headingL3;
    }
    if (!inBbm || !line.trim().startsWith('|')) continue;

    const header = splitMarkdownRow(line);
    if (!looksLikeA1Header(header)) continue;
    const table = collectTable(lines, i);
    for (const row of table.rows) {
      const a1Id = cell(row, table.header, ['业务行为（A1）编号', 'A1编号']);
      const behavior = cell(row, table.header, ['业务行为（A1）']);
      if (!a1Id && !behavior) continue;
      records.push({
        dept,
        file,
        line: row.line,
        l3: cell(row, table.header, ['业务流程（L3）', '业务流程']) || currentL3,
        a1Id,
        behavior,
        role: cell(row, table.header, ['执行角色']),
        roleBasis: cell(row, table.header, ['执行角色依据']),
        trigger: cell(row, table.header, ['触发情景']),
        triggerBasis: cell(row, table.header, ['触发情景依据']),
        precondition: cell(row, table.header, ['前置条件']),
        preconditionBasis: cell(row, table.header, ['前置条件依据']),
        dataInput: cell(row, table.header, ['数据输入']),
        dataOutput: cell(row, table.header, ['数据输出']),
        inputDeptRaw: cell(row, table.header, ['输入来源部门']),
        outputDeptRaw: cell(row, table.header, ['输出目标部门']),
        approvalType: cell(row, table.header, ['审批类型']),
        evidenceBasis: cell(row, table.header, ['制度依据']),
        evidenceType: cell(row, table.header, ['证据类型']),
        reminder: cell(row, table.header, ['核验提醒']),
        remark: cell(row, table.header, ['备注']),
      });
    }
    i = table.endIndex - 1;
  }

  return records;
}

function discoverMappingFiles(root, contract) {
  const normsDir = join(root, contract.paths?.normsDir ?? 'docs/norms');
  return readdirSync(normsDir)
    .filter((name) => name.endsWith('部门-能力-流程-系统映射关系.md'))
    .map((name) => {
      const dept = name.replace(/部门-能力-流程-系统映射关系\.md$/, '');
      return { dept, file: join(normsDir, name) };
    })
    .sort((a, b) => a.dept.localeCompare(b.dept, 'zh-CN'));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTransferWord(text) {
  return TRANSFER_WORDS.some((word) => text.includes(word));
}

function hasDeptSpecificTransfer(text, dept) {
  const d = escapeRegExp(dept);
  const word = TRANSFER_WORDS.join('|');
  return [
    new RegExp(`${d}[^。；;|]{0,32}(${word})`),
    new RegExp(`(${word})[^。；;|]{0,32}${d}`),
    new RegExp(`(与|向|由|从|至|给|到)${d}[^。；;|]{0,32}(${word})`),
  ].some((pattern) => pattern.test(text));
}

function hasBasisOnlyContext(text, dept) {
  const d = escapeRegExp(dept);
  const basis = BASIS_WORDS.join('|');
  const objects = BASIS_OBJECT_WORDS.join('|');
  const patterns = [
    new RegExp(`(${basis})[^，,、。；;|]{0,40}${d}`),
    new RegExp(`${d}[^，,、。；;|]{0,30}(${objects})[^，,、。；;|]{0,30}(作为|为|已|完成|来源|依据|前置|准备)`),
    new RegExp(`(${objects})[^，,、。；;|]{0,24}(来源|依据|前置|准备)[^，,、。；;|]{0,24}${d}`),
  ];
  return String(text)
    .split(/[，,、。；;|"“”]+/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .some((segment) => patterns.some((pattern) => pattern.test(segment)));
}

function hasRoleOnlyContext(text, dept) {
  const d = escapeRegExp(dept);
  const words = ROLE_ONLY_WORDS.join('|');
  return new RegExp(`${d}[^。；;|]{0,28}(${words})|(${words})[^。；;|]{0,28}${d}`).test(text);
}

function hasWeakEvidence(record) {
  const text = [
    record.roleBasis,
    record.triggerBasis,
    record.preconditionBasis,
    record.dataInput,
    record.dataOutput,
    record.evidenceBasis,
    record.evidenceType,
  ].join(' ');
  return /上下文推断|分析拆分|待确认|待补|未明确|不详|请部门确认/.test(text);
}

function makeFinding({ level, type, record, field, dept, evidence, suggestion }) {
  return {
    level,
    type,
    sourceDept: record.dept,
    file: rel(record.file),
    line: record.line,
    l3: record.l3,
    a1Id: record.a1Id,
    behavior: record.behavior,
    field,
    dept,
    inputDept: record.inputDeptRaw,
    outputDept: record.outputDeptRaw,
    dataInput: record.dataInput,
    dataOutput: record.dataOutput,
    evidenceType: record.evidenceType,
    evidence,
    suggestion,
  };
}

function analyzeDeptReference(record, field, dept, knownDepartments) {
  const findings = [];
  const rowText = [
    record.behavior,
    record.role,
    record.roleBasis,
    record.trigger,
    record.triggerBasis,
    record.precondition,
    record.preconditionBasis,
    record.dataInput,
    record.dataOutput,
    record.evidenceBasis,
    record.reminder,
    record.remark,
  ].join(' ');
  const basisText = [record.precondition, record.preconditionBasis, record.dataInput, record.roleBasis, record.evidenceBasis].join(' ');
  const deptSpecificTransfer = hasDeptSpecificTransfer(rowText, dept);
  const transferInRow = hasTransferWord(rowText);

  if (GENERIC_DEPT_PATTERNS.some((pattern) => pattern.test(dept)) || (!knownDepartments.has(dept) && !dept.includes('车间'))) {
    findings.push(
      makeFinding({
        level: '需部门确认',
        type: '部门对象不够受控',
        record,
        field,
        dept,
        evidence: `字段值“${dept}”不像标准部门名称或包含泛化/外部对象。`,
        suggestion: '输入/输出部门应落到受控组织名称；外部客户、供应商或泛化对象放入备注或核验提醒。',
      }),
    );
  }

  if (hasBasisOnlyContext(basisText, dept)) {
    findings.push(
      makeFinding({
        level: '待补证据',
        type: '依据来源疑似误填',
        record,
        field,
        dept,
        evidence: short(basisText, 110),
        suggestion: `仅看到“依据/订单/清单/台账来源”语境时，不应直接把 ${dept} 写入 ${field}；需补“传给谁、何时、通过何表单/台账/流程签收”的受控传递证据。`,
      }),
    );
  }

  if (!deptSpecificTransfer && hasWeakEvidence(record)) {
    findings.push(
      makeFinding({
        level: '需部门确认',
        type: '推断证据仍填输入输出',
        record,
        field,
        dept,
        evidence: `${record.evidenceType || '证据类型为空'}；${short(record.reminder || record.preconditionBasis || record.roleBasis, 90)}`,
        suggestion: `若 ${field} 来自上下文推断或分析拆分，应先放入备注/核验提醒并标注“未见受控传递证据，待补”。`,
      }),
    );
  }

  if (!transferInRow || !deptSpecificTransfer) {
    findings.push(
      makeFinding({
        level: '待补证据',
        type: '未见部门定向传递证据',
        record,
        field,
        dept,
        evidence: short(rowText, 120),
        suggestion: `需在制度条款、流程图箭头、表单流转、台账交接、签收/通知/反馈记录中看到 ${dept} 与具体输出物之间的定向传递关系。`,
      }),
    );
  }

  if (hasRoleOnlyContext(rowText, dept) && !deptSpecificTransfer) {
    findings.push(
      makeFinding({
        level: '提示',
        type: '职责/审批/归档关系疑似误填',
        record,
        field,
        dept,
        evidence: short(rowText, 110),
        suggestion: '职责、审批、参与、归档只能说明过程角色，不能自动等同于输入来源或输出目标。',
      }),
    );
  }

  return findings;
}

function analyzeRecord(record, contract, knownDepartments) {
  const findings = [];
  const refs = [
    ...splitDeptList(record.inputDeptRaw, contract).map((dept) => ({ field: '输入来源部门', dept })),
    ...splitDeptList(record.outputDeptRaw, contract).map((dept) => ({ field: '输出目标部门', dept })),
  ];

  for (const ref of refs) {
    findings.push(...analyzeDeptReference(record, ref.field, ref.dept, knownDepartments));
  }

  return findings;
}

function summarize(records, findings) {
  const stats = new Map();
  for (const record of records) {
    if (!stats.has(record.dept)) stats.set(record.dept, { dept: record.dept, a1Rows: 0, crossRows: 0, findings: 0 });
    const stat = stats.get(record.dept);
    stat.a1Rows += 1;
    if (record.inputDeptRaw || record.outputDeptRaw) stat.crossRows += 1;
  }
  for (const finding of findings) {
    if (!stats.has(finding.sourceDept)) stats.set(finding.sourceDept, { dept: finding.sourceDept, a1Rows: 0, crossRows: 0, findings: 0 });
    stats.get(finding.sourceDept).findings += 1;
  }
  return [...stats.values()].sort((a, b) => a.dept.localeCompare(b.dept, 'zh-CN'));
}

function countBy(values, key) {
  return values.reduce((acc, item) => {
    const value = item[key] || '未分类';
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function renderReport({ records, findings, stats, reportPath, root }) {
  const now = new Date().toISOString();
  const counts = countBy(findings, 'level');
  const typeCounts = countBy(findings, 'type');
  const lines = [
    '# A1 跨部门输入/输出受控传递证据审计',
    '',
    `- 生成时间：${now}`,
    `- 报告位置：\`${rel(reportPath, root)}\``,
    '- 审计口径：只检查已填写 `输入来源部门` / `输出目标部门` 的 A1 行是否存在“受控输出物传递”证据线索。',
    '- 使用边界：本报告不自动判错、不修改真源；用于把需补证据、需部门确认的 A1 拉出复核。',
    '- 受控传递证据示例：制度条款、流程图箭头、表单流转、台账交接、签收、通知、下发、反馈、接收等。',
    '',
    '## 汇总',
    '',
    `- A1 行数：${records.length}`,
    `- 已填写跨部门输入/输出的 A1 行数：${records.filter((item) => item.inputDeptRaw || item.outputDeptRaw).length}`,
    `- 复核提示数：${findings.length}`,
    `- 待补证据：${counts.待补证据 ?? 0}`,
    `- 需部门确认：${counts.需部门确认 ?? 0}`,
    `- 提示：${counts.提示 ?? 0}`,
    '',
    '## 类型分布',
    '',
    '| 类型 | 数量 |',
    '|---|---:|',
  ];

  for (const [type, count] of Object.entries(typeCounts).sort((a, b) => b[1] - a[1])) {
    lines.push(`| ${md(type)} | ${count} |`);
  }

  lines.push('', '## 部门统计', '', '| 部门 | A1 行数 | 已填输入/输出行数 | 复核提示数 |', '|---|---:|---:|---:|');
  for (const stat of stats) {
    lines.push(`| ${md(stat.dept)} | ${stat.a1Rows} | ${stat.crossRows} | ${stat.findings} |`);
  }

  lines.push('', '## 复核清单', '');
  if (!findings.length) {
    lines.push('未发现需复核的跨部门输入/输出证据项。');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| 等级 | 类型 | 位置 | A1 | 字段 | 部门 | 当前输入/输出 | 证据摘录 | 复核建议 |');
  lines.push('|---|---|---|---|---|---|---|---|---|');
  for (const finding of findings) {
    const location = `${finding.file}:${finding.line}`;
    const current = `输入=${finding.inputDept || '—'}；输出=${finding.outputDept || '—'}`;
    lines.push(
      `| ${md(finding.level)} | ${md(finding.type)} | ${md(location)} | ${md(finding.a1Id || finding.behavior)} | ${md(finding.field)} | ${md(finding.dept)} | ${md(current)} | ${md(finding.evidence)} | ${md(finding.suggestion)} |`,
    );
  }

  return `${lines.join('\n')}\n`;
}

function runAudit({ contractPath, reportPath, root, noWrite = false }) {
  const contract = readJson(contractPath);
  const knownDepartments = new Set(Object.keys(contract.departments ?? {}));
  const records = [];
  for (const { dept, file } of discoverMappingFiles(root, contract)) {
    if (!existsSync(file)) continue;
    records.push(...parseMappingDoc(file, dept, contract));
  }

  const findings = records.flatMap((record) => analyzeRecord(record, contract, knownDepartments));
  findings.sort((a, b) => {
    const level = REVIEW_ORDER[a.level] - REVIEW_ORDER[b.level];
    if (level !== 0) return level;
    return `${a.file}:${a.line}:${a.field}:${a.dept}`.localeCompare(`${b.file}:${b.line}:${b.field}:${b.dept}`, 'zh-CN');
  });

  const stats = summarize(records, findings);
  const report = renderReport({ records, findings, stats, reportPath, root });
  if (!noWrite) {
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report, 'utf8');
  }
  return { records, findings, stats, report, reportPath };
}

function runSelfTest() {
  const contract = {
    systems: { blankTokens: ['', '-', '—', '–', '无', '不适用'] },
    paths: { normsDir: 'docs/norms' },
    departments: { 经营发展部: '经营域', 物资保障部: '经营域', 复材车间: '生产域' },
    bbm: { sectionHeadingPatterns: ['## 业务行为（A1）映射'] },
  };
  assert.deepEqual(splitMarkdownRow('| A |  | B |'), ['A', '', 'B']);
  assert.equal(isBlankToken('—', contract), true);
  assert.deepEqual(splitDeptList('经营发展部、物资保障部', contract), ['经营发展部', '物资保障部']);
  assert.equal(hasBasisOnlyContext('§5.2 依据经营发展部下达的订单', '经营发展部'), true);
  assert.equal(hasDeptSpecificTransfer('与物资保障部沟通工装状态是否满足投产要求', '物资保障部'), true);

  const record = {
    dept: '复材车间',
    file: join(ROOT, 'docs', 'norms', '复材车间部门-能力-流程-系统映射关系.md'),
    line: 93,
    l3: '罐前计划编制',
    a1Id: 'FC-L3-01-A04',
    behavior: '与物资保障部沟通确认工装状态满足投产要求',
    role: '复材车间项目助理',
    roleBasis: '§5.2 "依据经营发展部下达的订单，与物资保障部沟通工装状态是否满足投产要求"',
    trigger: '排罐前工装状态核查',
    precondition: '经营发展部订单已下达',
    preconditionBasis: '§5.2 "依据经营发展部下达的订单"',
    dataInput: '经营发展部销售订单',
    dataOutput: '工装状态确认',
    inputDeptRaw: '经营发展部、物资保障部',
    outputDeptRaw: '—',
    evidenceBasis: '内部排罐管理程序 §5.2',
    evidenceType: '原文明确-正文',
    reminder: '',
    remark: '跨部门跟踪至物资保障部使工装合格',
  };
  const findings = analyzeRecord(record, contract, new Set(Object.keys(contract.departments)));
  assert.equal(findings.some((item) => item.a1Id === 'FC-L3-01-A04' && item.dept === '经营发展部' && item.type === '依据来源疑似误填'), true);
  assert.equal(findings.some((item) => item.a1Id === 'FC-L3-01-A04' && item.dept === '物资保障部' && item.type === '依据来源疑似误填'), false);
  console.log('self-test passed');
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  runSelfTest();
} else {
  const result = runAudit({
    contractPath: args.contract,
    reportPath: args.report,
    root: args.root,
    noWrite: args.noWrite,
  });
  const counts = countBy(result.findings, 'level');
  const summary = {
    report: rel(result.reportPath, args.root),
    a1Rows: result.records.length,
    findings: result.findings.length,
    needEvidence: counts.待补证据 ?? 0,
    needConfirmation: counts.需部门确认 ?? 0,
    hints: counts.提示 ?? 0,
  };

  if (args.json) {
    console.log(JSON.stringify({ ...summary, findings: result.findings }, null, 2));
  } else {
    if (!args.noWrite) console.log(`A1 transfer evidence audit wrote ${summary.report}`);
    else console.log('A1 transfer evidence audit completed without writing report');
    console.log(
      `A1=${summary.a1Rows} findings=${summary.findings} 待补证据=${summary.needEvidence} 需部门确认=${summary.needConfirmation} 提示=${summary.hints}`,
    );
  }
}
