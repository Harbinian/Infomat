#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const DEFAULT_CONTRACT = join(ROOT, 'docs', 'contracts', 'dcm-bbm-contract.json');
const DEFAULT_REPORT = join(ROOT, 'docs', 'norms', '_quality-report.md');
const SEVERITY_ORDER = { BLOCK: 0, WARN: 1, INFO: 2 };
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
  '跟踪',
  '回执',
];
const BASIS_WORDS = ['依据', '根据', '基于', '参照', '按'];
const BASIS_OBJECT_WORDS = ['订单', '清单', '计划', '制度', '文件', '资料', '数据', '台账', '附件', '标准', '通知'];
const ROLE_ONLY_WORDS = ['负责', '执行', '组织', '参与', '配合', '协同', '归档', '备案', '存档', '审批', '审核', '批准', '会签'];
const GENERIC_DEPT_PATTERNS = [
  /相关/,
  /各/,
  /等$/,
  /业务部门/,
  /职能部门/,
  /生产部门/,
  /生产部$/,
  /使用部门/,
  /需求部门/,
  /责任部门/,
  /客户/,
  /顾客/,
  /供应商/,
  /银行/,
  /保险公司/,
  /海关/,
  /总部/,
  /董事会/,
  /总经理/,
  /副总经理/,
  /外部/,
];

function parseArgs(argv) {
  const args = { report: DEFAULT_REPORT, contract: DEFAULT_CONTRACT, fail: true };
  for (const arg of argv) {
    if (arg === '--self-test') args.selfTest = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--no-fail') args.fail = false;
    else if (arg.startsWith('--report=')) args.report = resolve(ROOT, arg.slice('--report='.length));
    else if (arg.startsWith('--contract=')) args.contract = resolve(ROOT, arg.slice('--contract='.length));
    else if (arg.startsWith('--root=')) args.root = resolve(arg.slice('--root='.length));
  }
  return args;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function rel(path, root = ROOT) {
  return relative(root, path).replace(/\\/g, '/');
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

function isBlankToken(value, contract) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return true;
  if (/^[-—–]+$/.test(normalized)) return true;
  return contract.systems.blankTokens.some((token) => token.toUpperCase() === normalized.toUpperCase());
}

function splitSystems(value, contract) {
  if (isBlankToken(value, contract)) return [];
  return String(value)
    .split(/[、，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitDeptRefs(value, contract) {
  if (isBlankToken(value, contract)) return [];
  return String(value)
    .split(/[、，,；;\/]/)
    .map((item) => item.trim())
    .filter((item) => item && !isBlankToken(item, contract));
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

function looksLikeMainHeader(header) {
  const text = header.join('|');
  return (
    text.includes('部门') &&
    text.includes('能力域') &&
    text.includes('业务能力') &&
    text.includes('业务流程') &&
    text.includes('应用系统')
  );
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
    if (cells[0] === '序号' || cells[0] === '指标' || cells[0] === '业务行为（A1）编号') continue;
    rows.push({ line: i + 1, cells });
  }

  return { header, rows, startLine: headerIndex + 1, endIndex: endIndex + 1 };
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

function extractL2FromHeading(line) {
  const trimmed = line.trim();
  if (!/^#{3,6}\s+L2-\d+\s+/.test(trimmed)) return '';

  return trimmed
    .replace(/^#+\s*/, '')
    .replace(/^L2-\d+\s+/, '')
    .trim();
}

function normalizeProcessName(value) {
  return String(value || '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .replace(/[【】\[\]《》"“”'‘’`*]/g, '')
    .replace(/[：:，,、；;\s]/g, '')
    .replace(/管理$/g, '')
    .trim();
}

function processNameScore(a, b) {
  const left = normalizeProcessName(a);
  const right = normalizeProcessName(b);
  if (!left || !right) return 0;
  if (left === right) return 1000;
  if (right.startsWith(left) || left.startsWith(right)) return 900 + Math.min(left.length, right.length);
  if (right.includes(left) || left.includes(right)) return 800 + Math.min(left.length, right.length);

  const leftChars = new Set([...left]);
  let common = 0;
  for (const ch of leftChars) {
    if (right.includes(ch)) common += 1;
  }
  return common / Math.max(left.length, right.length);
}

function resolveBbmL3(l3, l2, dcmMappings) {
  if (!l3) return null;

  const exact = dcmMappings.find((item) => item.l3 === l3);
  if (exact) return exact;

  const scored = dcmMappings
    .map((item) => ({ item, score: processNameScore(l3, item.l3) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 800 || (scored[0]?.score >= 0.55 && scored[0].score > (scored[1]?.score ?? 0) + 0.08)) {
    return scored[0].item;
  }

  if (l2) {
    const sameL2 = dcmMappings.filter((item) => normalizeProcessName(item.l2) === normalizeProcessName(l2));
    if (sameL2.length === 1) return sameL2[0];
  }

  return null;
}

function startsBbmSection(line, contract) {
  const trimmed = line.trim();
  return contract.bbm.sectionHeadingPatterns.some((pattern) => trimmed.startsWith(pattern));
}

function skipDataRow(row) {
  const first = row.cells[0] ?? '';
  return !first || first === '合计' || first === '统计' || first === '应用系统（S1）';
}

function addFinding(findings, severity, area, file, line, message, suggestion = '') {
  findings.push({ severity, area, file: file ? rel(file) : '', line, message, suggestion });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shortText(value, max = 100) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function hasTransferWord(text) {
  return TRANSFER_WORDS.some((word) => String(text).includes(word));
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

function isUncontrolledDeptRef(dept, contract) {
  const knownDepartments = new Set(Object.keys(contract.departments ?? {}));
  if (knownDepartments.has(dept)) return false;
  if (GENERIC_DEPT_PATTERNS.some((pattern) => pattern.test(dept))) return true;
  return /[()（）]/.test(dept) || !knownDepartments.has(dept);
}

function hasWeakCrossEvidence(rowText, evidenceType) {
  return /上下文推断|分析拆分|待确认|待补|未明确|不详|请部门确认/.test(`${evidenceType || ''} ${rowText}`);
}

function validateSystems({ findings, contract, raw, area, file, line, label }) {
  const systems = splitSystems(raw, contract);
  const allowed = new Set(contract.systems.allowedS1);
  for (const system of systems) {
    if (contract.systems.forbiddenS1.includes(system)) {
      addFinding(
        findings,
        'BLOCK',
        area,
        file,
        line,
        `${label} 含禁止作为 应用系统（S1） 的值: ${system}`,
        'MDM 只能进入能力层与数据治理要求，不能作为员工使用的 应用系统（S1）。',
      );
    } else if (!allowed.has(system)) {
      addFinding(
        findings,
        'BLOCK',
        area,
        file,
        line,
        `${label} 含非标准系统值: ${system}`,
        `仅允许 ${contract.systems.allowedS1.join('、')}，不适合时应留空并在说明字段解释。`,
      );
    }
  }
  return systems;
}

function parseMappingDoc(file, contract) {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const mainTables = [];
  const a1Tables = [];
  let inBbm = false;
  let currentL2 = '';
  let currentL3 = '';

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (startsBbmSection(line, contract)) inBbm = true;

    const headingL3 = inBbm ? extractL3FromHeading(line) : '';
    if (headingL3) currentL3 = headingL3;
    const headingL2 = inBbm ? extractL2FromHeading(line) : '';
    if (headingL2) currentL2 = headingL2;

    if (!trimmed.startsWith('|')) continue;
    const header = splitMarkdownRow(trimmed);
    if (!inBbm && looksLikeMainHeader(header)) {
      const table = collectTable(lines, i);
      mainTables.push(table);
      i = table.endIndex - 1;
    } else if (inBbm && looksLikeA1Header(header)) {
      const table = collectTable(lines, i);
      table.contextL2 = currentL2;
      table.contextL3 = currentL3;
      a1Tables.push(table);
      i = table.endIndex - 1;
    }
  }

  return { text, lines, mainTables, a1Tables, hasBbm: /##\s*业务行为（A1）映射/.test(text) };
}

function checkOrganization(findings, contract, root) {
  const canonical = join(root, contract.paths.canonicalOrganizationSource);
  const fallback = contract.paths.fallbackOrganizationSources
    .map((item) => join(root, item))
    .find((item) => existsSync(item));

  if (!existsSync(canonical)) {
    if (fallback) {
      addFinding(
        findings,
        'WARN',
        'ORG',
        fallback,
        1,
        `部门→域真源文件名与合同不一致，当前使用备用文件 ${rel(fallback, root)}`,
        `建议统一为 ${contract.paths.canonicalOrganizationSource}，避免脚本和提示词引用两套路径。`,
      );
    } else {
      addFinding(findings, 'BLOCK', 'ORG', canonical, 1, '部门→域真源文件不存在', '补齐组织真源后再校验部门域映射。');
      return;
    }
  }

  const source = existsSync(canonical) ? canonical : fallback;
  const text = readFileSync(source, 'utf8');
  const businessLine = text.match(/###\s*经营线条([\s\S]*?)(###\s*生产线条|$)/);
  if (businessLine && businessLine[1].includes('财务部') && contract.departments['财务部'] === '总经理直辖域') {
    addFinding(
      findings,
      'WARN',
      'ORG',
      source,
      59,
      '组织文件中“财务部”同时出现于经营线条说明，但合同要求为总经理直辖域',
      '建议修订组织真源正文，使组织图、部门职责表和 DEPT_DOMAIN 口径一致。',
    );
  }
}

function checkDeliverables(findings, contract, root) {
  const normsDir = join(root, contract.paths.normsDir);
  const files = readdirSync(normsDir);
  const patterns = contract.deliverables.forbiddenNamePatterns.map((pattern) => new RegExp(pattern));

  for (const name of files) {
    if (patterns.some((pattern) => pattern.test(name))) {
      addFinding(
        findings,
        'WARN',
        'DELIVERABLE',
        join(normsDir, name),
        1,
        `发现非标准交付物命名: ${name}`,
        'DCM/BBM 应合并回三件套，不保留行为层旁路文件。',
      );
    }
    if (!name.endsWith('.bak')) {
      const matchedSuffix = contract.deliverables.canonicalSuffixes.find((suffix) => name.endsWith(suffix));
      if (matchedSuffix) {
        const dept = name.slice(0, -matchedSuffix.length);
        if (!Object.prototype.hasOwnProperty.call(contract.departments, dept)) {
          addFinding(
            findings,
            'WARN',
            'DELIVERABLE',
            join(normsDir, name),
            1,
            `发现部门名不在组织合同中的标准形态文件: ${name}`,
            '按 docs/organization/组织架构和部门职责.md 的部门名称归并后再纳入三件套。',
          );
        }
      }
    }
  }

  for (const [dept] of Object.entries(contract.departments)) {
    const missing = contract.deliverables.canonicalSuffixes.filter((suffix) => !existsSync(join(normsDir, `${dept}${suffix}`)));
    const sourceDir = join(normsDir, `${dept}业务资料`);
    if (missing.length === contract.deliverables.canonicalSuffixes.length) {
      addFinding(
        findings,
        existsSync(sourceDir) ? 'WARN' : 'INFO',
        'DELIVERABLE',
        normsDir,
        1,
        `${dept} 尚未形成 DCM 三件套`,
        existsSync(sourceDir) ? '已有业务资料，应补齐标准三件套。' : '当前可作为未建模部门保留占位。',
      );
    } else if (missing.length) {
      addFinding(
        findings,
        'WARN',
        'DELIVERABLE',
        normsDir,
        1,
        `${dept} 三件套不完整，缺少: ${missing.join('、')}`,
        '补齐后再进入公司级统计或部门评审。',
      );
    }
  }

  const rootEcharts = join(root, contract.paths.rootEcharts);
  if (!existsSync(rootEcharts)) {
    addFinding(findings, 'BLOCK', 'ASSET', rootEcharts, 1, '项目根 echarts.min.js 不存在', 'PMO 驾驶舱需要引用项目根静态资产。');
  }
  const normsEcharts = join(root, contract.paths.normsEcharts ?? join(contract.paths.normsDir, 'echarts.min.js'));
  if (!existsSync(normsEcharts)) {
    addFinding(findings, 'BLOCK', 'ASSET', normsEcharts, 1, 'docs/norms/echarts.min.js 不存在', '部门桑基图 HTML 应统一引用同目录 echarts.min.js。');
  }
}

function checkDcmTable(findings, contract, file, dept, parsed) {
  if (!parsed.mainTables.length) {
    addFinding(findings, 'BLOCK', 'DCM', file, 1, '未找到 DCM 主映射表', '主表必须包含 部门（D1）/能力域（L1）/业务能力（L2）/业务流程（L3）/应用系统（S1）。');
    return { l3Set: new Set(), l3Rows: 0, mappings: [] };
  }

  const table = parsed.mainTables[0];
  const missingHeaders = contract.dcm.mainTableRequiredHeaders.filter((header) => findHeaderIndex(table.header, header) < 0);
  if (missingHeaders.length) {
    addFinding(findings, 'BLOCK', 'DCM', file, table.startLine, `DCM 主表缺少列: ${missingHeaders.join('、')}`, '按合同补齐标准列名。');
  }

  const l3Set = new Set();
  const mappings = [];
  let l3Rows = 0;
  for (const row of table.rows) {
    if (skipDataRow(row)) continue;
    const rowDept = cell(row, table.header, ['部门（D1）', '部门']);
    const l2 = cell(row, table.header, ['业务能力（L2）', '业务能力']);
    const l3 = cell(row, table.header, ['业务流程（L3）', '业务流程']);
    const evidence = cell(row, table.header, ['制度依据（文件号/条款）', '制度依据']);
    const systemRaw = cell(row, table.header, ['应用系统（S1）', '应用系统']);
    const designBasis = cell(row, table.header, ['系统设计依据']);

    if (!l3) continue;
    l3Rows += 1;
    l3Set.add(l3);
    mappings.push({ l2, l3 });

    if (rowDept && rowDept !== dept) {
      addFinding(findings, 'WARN', 'DCM', file, row.line, `主表部门列为 ${rowDept}，与文件名部门 ${dept} 不一致`, '确认是否复制表格时未替换部门名。');
    }
    if (!evidence) {
      addFinding(findings, 'BLOCK', 'DCM', file, row.line, `业务流程（L3）“${l3}”缺少制度依据`, '每个 L3 都应有文件号/版次/条款或待补说明。');
    } else if (!contract.dcm.evidenceShouldContain.some((token) => evidence.includes(token))) {
      addFinding(findings, 'WARN', 'DCM', file, row.line, `业务流程（L3）“${l3}”制度依据可能缺少条款号`, '建议使用 文件号-版次《文件名》§条款号。');
    }

    validateSystems({ findings, contract, raw: systemRaw, area: 'DCM', file, line: row.line, label: `业务流程（L3）“${l3}”` });
    if (!isBlankToken(systemRaw, contract) && !designBasis) {
      addFinding(findings, 'BLOCK', 'DCM', file, row.line, `业务流程（L3）“${l3}”缺少系统设计依据`, '非空 应用系统（S1） 必须说明落位依据。');
    }
    if (isBlankToken(systemRaw, contract) && !designBasis) {
      addFinding(findings, 'WARN', 'DCM', file, row.line, `业务流程（L3）“${l3}”未分配系统且缺少说明`, '留空可以，但需说明线下台账、外部平台或待部门确认原因。');
    }
  }

  if (!parsed.text.includes(contract.dcm.changeRecordHeading)) {
    addFinding(findings, 'WARN', 'DCM', file, 1, '缺少 DCM 变更记录章节', '增量更新时应保留 ## 变更记录。');
  }

  return { l3Set, l3Rows, mappings };
}

function normalizeEvidenceType(raw, contract) {
  const value = String(raw ?? '').trim();
  if (!value) return { status: 'empty', value };
  if (contract.bbm.evidenceTypes.includes(value)) return { status: 'ok', value };
  const base = contract.bbm.evidenceTypes.find((type) => value.startsWith(type));
  if (base) return { status: 'extended', value, base };
  return { status: 'invalid', value };
}

function checkControlledTransferEvidence(findings, contract, file, row, record) {
  const refs = [
    ...splitDeptRefs(record.inputDept, contract).map((dept) => ({ field: '输入来源部门', dept })),
    ...splitDeptRefs(record.outputDept, contract).map((dept) => ({ field: '输出目标部门', dept })),
  ];
  if (!refs.length) return;

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
    record.evidence,
    record.evidenceType,
    record.reminder,
    record.remark,
  ].join(' ');
  const basisText = [
    record.precondition,
    record.preconditionBasis,
    record.dataInput,
    record.roleBasis,
    record.evidence,
  ].join(' ');
  const transferInRow = hasTransferWord(rowText);

  for (const ref of refs) {
    const label = `A1 ${record.a1Id || record.behavior}`;

    if (isUncontrolledDeptRef(ref.dept, contract)) {
      addFinding(
        findings,
        'WARN',
        'CROSS_TRANSFER',
        file,
        row.line,
        `${label} 的 ${ref.field} 含非标准或不受控对象: ${ref.dept}`,
        '输入/输出部门应使用组织真源中的部门名称；外部客户、供应商、泛化部门或带括号用途说明的对象应放入备注/核验提醒。',
      );
    }

    if (hasBasisOnlyContext(basisText, ref.dept)) {
      addFinding(
        findings,
        'WARN',
        'CROSS_TRANSFER',
        file,
        row.line,
        `${label} 的 ${ref.field} 指向 ${ref.dept}，但当前证据更像依据来源而非受控传递`,
        `依据摘录：${shortText(basisText)}。仅看到“依据/订单/清单/台账来源”时，不应直接填写输入/输出部门；需补传递流程、接收角色、表单/台账或签收/通知记录。`,
      );
    }

    if (!transferInRow || !hasDeptSpecificTransfer(rowText, ref.dept)) {
      addFinding(
        findings,
        'WARN',
        'CROSS_TRANSFER',
        file,
        row.line,
        `${label} 的 ${ref.field} 指向 ${ref.dept}，未见部门定向受控传递证据`,
        `需在制度条款、流程图箭头、表单流转、台账交接、签收/通知/反馈记录中看到 ${ref.dept} 与具体输出物之间的传递关系；没有则标注“未见受控传递证据，待补”。`,
      );
    }

    if (hasWeakCrossEvidence(rowText, record.evidenceType)) {
      addFinding(
        findings,
        'WARN',
        'CROSS_TRANSFER',
        file,
        row.line,
        `${label} 的 ${ref.field} 指向 ${ref.dept}，但行内仍含推断/待确认语境`,
        '跨部门输入/输出不能仅凭上下文推断或部门参与关系固化；证据不足时应放入前置条件依据、制度依据、备注或核验提醒。',
      );
    }

    if (hasRoleOnlyContext(rowText, ref.dept) && !hasDeptSpecificTransfer(rowText, ref.dept)) {
      addFinding(
        findings,
        'WARN',
        'CROSS_TRANSFER',
        file,
        row.line,
        `${label} 的 ${ref.field} 指向 ${ref.dept}，疑似把职责/审批/归档关系写成输入输出`,
        '职责、审批、参与、协同和归档只说明过程角色，不能自动等同于受控输出物的输入来源或输出目标。',
      );
    }
  }
}

function checkBbmTables(findings, contract, file, dept, parsed, dcmMappings) {
  if (!parsed.hasBbm) {
    addFinding(findings, 'WARN', 'BBM', file, 1, '未找到 业务行为（A1）映射章节', 'BBM 应并入标准映射文档，而不是另建旁路文件。');
    return { a1Rows: 0 };
  }

  let a1Rows = 0;
  for (const table of parsed.a1Tables) {
    const missing = contract.bbm.coreRequiredHeaders.filter((header) => findHeaderIndex(table.header, header) < 0);
    if (missing.length) {
      addFinding(findings, 'BLOCK', 'BBM', file, table.startLine, `A1 表缺少核心列: ${missing.join('、')}`, '按 BBM 主记录字段补齐核心列。');
    }

    for (const row of table.rows) {
      if (skipDataRow(row)) continue;
      const a1Id = cell(row, table.header, ['业务行为（A1）编号', 'A1编号']);
      const behavior = cell(row, table.header, ['业务行为（A1）']);
      const role = cell(row, table.header, ['执行角色']);
      const roleBasis = cell(row, table.header, ['执行角色依据']);
      const trigger = cell(row, table.header, ['触发情景']);
      const triggerBasis = cell(row, table.header, ['触发情景依据']);
      const precondition = cell(row, table.header, ['前置条件']);
      const preconditionBasis = cell(row, table.header, ['前置条件依据']);
      const dataInput = cell(row, table.header, ['数据输入']);
      const dataOutput = cell(row, table.header, ['数据输出']);
      const approvalType = cell(row, table.header, ['审批类型']);
      const systemRaw = cell(row, table.header, ['应用系统（S1）', '应用系统']);
      const evidence = cell(row, table.header, ['制度依据']);
      const evidenceType = cell(row, table.header, ['证据类型']);
      const reminder = cell(row, table.header, ['核验提醒']);
      const inputDept = cell(row, table.header, ['输入来源部门']);
      const outputDept = cell(row, table.header, ['输出目标部门']);
      const remark = cell(row, table.header, ['备注']);
      const l2FromColumn = cell(row, table.header, ['业务能力（L2）', '业务能力']);
      const l3FromColumn = cell(row, table.header, ['业务流程（L3）', '业务流程']);
      const l2 = l2FromColumn || table.contextL2;
      const l3 = l3FromColumn || table.contextL3;

      if (!a1Id && !behavior) continue;
      a1Rows += 1;

      if (!a1Id) addFinding(findings, 'BLOCK', 'BBM', file, row.line, 'A1 行缺少 业务行为（A1）编号', '编号需要锚定稳定 L3 标识。');
      if (!behavior) addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id || ''} 缺少 业务行为（A1）`, '行为列必须是业务动作文本。');
      if (behavior && behavior === a1Id) {
        addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id} 的行为列使用了编号`, '业务行为（A1）编号只能放追溯列，行为列必须放动作文本。');
      }
      if (!role) addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id} 缺少执行角色`, 'A1 必须有执行角色；若来源不足，应保守填写并给出核验提醒。');
      if (!trigger) addFinding(findings, 'WARN', 'BBM', file, row.line, `A1 ${a1Id} 缺少触发情景`, '触发情景应与前置条件分开。');
      if (!precondition) addFinding(findings, 'WARN', 'BBM', file, row.line, `A1 ${a1Id} 缺少前置条件`, '前置条件应描述执行前必须满足的状态。');
      if (approvalType && !contract.bbm.approvalTypes.includes(approvalType)) {
        addFinding(findings, 'WARN', 'BBM', file, row.line, `A1 ${a1Id} 审批类型不在枚举中: ${approvalType}`, `建议使用 ${contract.bbm.approvalTypes.join('、')}。`);
      }
      validateSystems({ findings, contract, raw: systemRaw, area: 'BBM', file, line: row.line, label: `A1 ${a1Id || behavior}` });
      if (!evidence) {
        addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id} 缺少制度依据`, 'A1 行必须可追溯到制度条款、流程图或表单。');
      }

      const evidenceStatus = normalizeEvidenceType(evidenceType, contract);
      if (evidenceStatus.status === 'empty') {
        addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id} 缺少证据类型`, '证据类型必须来自 BBM 枚举。');
      } else if (evidenceStatus.status === 'extended') {
        addFinding(findings, 'WARN', 'BBM', file, row.line, `A1 ${a1Id} 证据类型带扩展说明: ${evidenceStatus.value}`, `主枚举建议保持为 ${evidenceStatus.base}，扩展说明放备注或依据字段。`);
      } else if (evidenceStatus.status === 'invalid') {
        addFinding(findings, 'BLOCK', 'BBM', file, row.line, `A1 ${a1Id} 证据类型不在枚举中: ${evidenceStatus.value}`, `仅允许 ${contract.bbm.evidenceTypes.join('、')}。`);
      }

      if (l3 && !resolveBbmL3(l3, l2, dcmMappings)) {
        addFinding(
          findings,
          'WARN',
          'CROSS',
          file,
          row.line,
          `A1 ${a1Id} 挂接的 业务流程（L3）未在 DCM 主表中找到: ${l3}`,
          'BBM 只能挂接到已完成的 DCM L3；若 L3 确实新增，应先更新 DCM 主表。',
        );
      }

      const hasCrossDept = !isBlankToken(inputDept, contract) || !isBlankToken(outputDept, contract);
      if (hasCrossDept && behavior && !behavior.includes(contract.bbm.crossDepartmentMarker)) {
        addFinding(
          findings,
          'WARN',
          'BBM',
          file,
          row.line,
          `A1 ${a1Id} 有跨部门输入/输出，但行为文本未显示跨部门标记`,
          '在 业务行为（A1） 文本或前端展示中加入【跨部门】标记，方便部门审核。',
        );
      }
      if (hasCrossDept) {
        checkControlledTransferEvidence(findings, contract, file, row, {
          a1Id,
          behavior,
          role,
          roleBasis,
          trigger,
          triggerBasis,
          precondition,
          preconditionBasis,
          dataInput,
          dataOutput,
          inputDept,
          outputDept,
          evidence,
          evidenceType,
          reminder,
          remark,
        });
      }

      if (role) {
        const isCollective = contract.bbm.collectiveRolePatterns.some((pattern) => new RegExp(pattern).test(role));
        if (isCollective && !/具体岗位|责任人|部门\/组织|部门或组织/.test(reminder)) {
          addFinding(
            findings,
            'WARN',
            'BBM',
            file,
            row.line,
            `A1 ${a1Id} 执行角色像集体组织: ${role}`,
            '保留集体角色可以，但核验提醒中应要求部门确认具体岗位/责任人。',
          );
        }
      }
    }
  }

  if (!parsed.a1Tables.length) {
    addFinding(findings, 'BLOCK', 'BBM', file, 1, '业务行为（A1）章节存在，但未找到 A1 主记录表', '确认 A1 表头是否包含 业务行为（A1）编号、业务行为（A1）、应用系统（S1）。');
  }

  return { a1Rows };
}

function checkHtml(findings, contract, root, dept) {
  const htmlPath = join(root, contract.paths.normsDir, `${dept}部门能力流程系统桑基图.html`);
  if (!existsSync(htmlPath)) return;
  const text = readFileSync(htmlPath, 'utf8');

  if (!text.includes(contract.html.requiredEchartsSrc)) {
    addFinding(
      findings,
      'BLOCK',
      'HTML',
      htmlPath,
      1,
      `${dept} 桑基图 HTML 未引用 ${contract.html.requiredEchartsSrc}`,
      '部门 HTML 应统一引用 docs/norms 同目录 ECharts。',
    );
  }

  for (const pattern of contract.html.forbiddenShorthandPatterns) {
    const regex = new RegExp(pattern);
    if (regex.test(text)) {
      addFinding(
        findings,
        'WARN',
        'HTML',
        htmlPath,
        1,
        `${dept} 桑基图 HTML 含非标准简写: ${pattern}`,
        '可见文本应使用 业务能力（L2）/业务流程（L3）/业务行为（A1）/应用系统（S1） 等正式术语。',
      );
    }
  }
}

function checkCompanyData(findings, contract, root, totals) {
  const dashPath = join(root, contract.paths.pmoDashboard);
  if (!existsSync(dashPath)) {
    addFinding(findings, 'WARN', 'COMPANY_DATA', dashPath, 1, 'PMO 驾驶舱文件不存在', '运行 scripts/parse-sankey-data.mjs 生成驾驶舱。');
    return;
  }

  const dashHtml = readFileSync(dashPath, 'utf8');
  const sankeyMatch = dashHtml.match(/<script type="application\/json" id="sankey-data">\s*([\s\S]*?)\s*<\/script>/);
  if (!sankeyMatch) {
    addFinding(findings, 'BLOCK', 'COMPANY_DATA', dashPath, 1, '驾驶舱 HTML 中缺少 sankey-data 内嵌数据', '运行 scripts/parse-sankey-data.mjs 注入数据。');
    return;
  }

  let data;
  try {
    data = JSON.parse(sankeyMatch[1]);
  } catch (e) {
    addFinding(findings, 'BLOCK', 'COMPANY_DATA', dashPath, 1, `驾驶舱 sankey-data JSON 解析失败: ${e.message}`, '检查 parse-sankey-data.mjs 输出。');
    return;
  }

  const allowed = new Set(contract.systems.allowedS1);
  for (const system of data.systems ?? []) {
    if (!allowed.has(system)) {
      addFinding(findings, 'BLOCK', 'COMPANY_DATA', dashPath, 1, `驾驶舱 sankey-data systems 含非标准系统: ${system}`, '公司级系统枚举只能来自合同 allowedS1。');
    }
  }

  if (data.stats?.mappings !== totals.l3Rows) {
    addFinding(
      findings,
      'WARN',
      'COMPANY_DATA',
      dashPath,
      1,
      `驾驶舱 sankey-data 的 L3 数 ${data.stats?.mappings ?? '未知'} 与源映射表 ${totals.l3Rows} 不一致`,
      '检查 parse-sankey-data.mjs 是否遗漏或重复解析 DCM 主表。',
    );
  }
  if (data.stats?.a1 !== totals.a1Rows) {
    addFinding(
      findings,
      'WARN',
      'COMPANY_DATA',
      dashPath,
      1,
      `驾驶舱 sankey-data 的 A1 数 ${data.stats?.a1 ?? '未知'} 与源 A1 主记录表 ${totals.a1Rows} 不一致`,
      '检查 A1 解析是否只识别部分标题格式，或是否有部门 A1 表未被纳入公司级数据。',
    );
  }

  const sources = new Set((data.links ?? []).map((link) => link.source));
  const suspiciousPatterns = contract.companyData.suspiciousSystemSinkPatterns.map((pattern) => new RegExp(pattern));
  for (const link of data.links ?? []) {
    const target = String(link.target ?? '');
    if (sources.has(target) || allowed.has(target) || target.startsWith('[空]')) continue;
    if (suspiciousPatterns.some((pattern) => pattern.test(target))) {
      addFinding(
        findings,
        'BLOCK',
        'COMPANY_DATA',
        dashPath,
        1,
        `驾驶舱 sankey-data 出现疑似误解析的系统/终端节点: ${target}`,
        '通常是 Markdown 表格空单元格丢失导致列位左移，应先修解析再重跑 parse-sankey-data.mjs。',
      );
    }
  }
}

function runChecks({ contractPath, reportPath, root }) {
  const contract = readJson(contractPath);
  const findings = [];
  const normsDir = join(root, contract.paths.normsDir);
  const deptStats = [];
  let totalL3Rows = 0;
  let totalA1Rows = 0;

  checkOrganization(findings, contract, root);
  checkDeliverables(findings, contract, root);

  for (const [dept] of Object.entries(contract.departments)) {
    const file = join(normsDir, `${dept}部门-能力-流程-系统映射关系.md`);
    if (!existsSync(file)) {
      checkHtml(findings, contract, root, dept);
      continue;
    }

    const parsed = parseMappingDoc(file, contract);
    const dcm = checkDcmTable(findings, contract, file, dept, parsed);
    const bbm = checkBbmTables(findings, contract, file, dept, parsed, dcm.mappings);
    checkHtml(findings, contract, root, dept);

    totalL3Rows += dcm.l3Rows;
    totalA1Rows += bbm.a1Rows;
    deptStats.push({ dept, l3Rows: dcm.l3Rows, a1Rows: bbm.a1Rows, hasBbm: parsed.hasBbm });
  }

  checkCompanyData(findings, contract, root, { l3Rows: totalL3Rows, a1Rows: totalA1Rows });

  findings.sort((a, b) => {
    const sev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (sev !== 0) return sev;
    return `${a.area}${a.file}${a.line}`.localeCompare(`${b.area}${b.file}${b.line}`, 'zh-CN');
  });

  const report = renderReport({ contractPath, findings, deptStats, totalL3Rows, totalA1Rows });
  writeFileSync(reportPath, report, 'utf8');

  return { contract, findings, deptStats, totalL3Rows, totalA1Rows, reportPath };
}

function countBySeverity(findings) {
  return findings.reduce((acc, finding) => {
    acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
    return acc;
  }, {});
}

function md(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function renderReport({ contractPath, findings, deptStats, totalL3Rows, totalA1Rows }) {
  const counts = countBySeverity(findings);
  const now = new Date().toISOString();
  const lines = [
    '# DCM/BBM 双合同质检报告',
    '',
    `- 生成时间：${now}`,
    `- 合同文件：\`${rel(contractPath)}\``,
    `- 源 L3 行数：${totalL3Rows}`,
    `- 源 A1 行数：${totalA1Rows}`,
    '- 跨部门输入/输出口径：仅当制度条款、流程图箭头、表单流转、台账交接、签收/通知/反馈等证据证明受控输出物传递时，才视为已确认；证据不足项以 `CROSS_TRANSFER` 标记为复核提示。',
    '',
    '## 汇总',
    '',
    '| 严重度 | 数量 |',
    '|---|---:|',
    `| BLOCK | ${counts.BLOCK ?? 0} |`,
    `| WARN | ${counts.WARN ?? 0} |`,
    `| INFO | ${counts.INFO ?? 0} |`,
    '',
    '## 部门统计',
    '',
    '| 部门 | DCM L3 行数 | BBM A1 行数 | BBM章节 |',
    '|---|---:|---:|---|',
  ];

  for (const stat of deptStats) {
    lines.push(`| ${md(stat.dept)} | ${stat.l3Rows} | ${stat.a1Rows} | ${stat.hasBbm ? '有' : '无'} |`);
  }

  lines.push('', '## 问题清单', '');
  if (!findings.length) {
    lines.push('未发现合同问题。');
    return `${lines.join('\n')}\n`;
  }

  lines.push('| 严重度 | 领域 | 位置 | 说明 | 建议 |');
  lines.push('|---|---|---|---|---|');
  for (const finding of findings) {
    const location = finding.file ? `${finding.file}${finding.line ? `:${finding.line}` : ''}` : '';
    lines.push(`| ${finding.severity} | ${md(finding.area)} | ${md(location)} | ${md(finding.message)} | ${md(finding.suggestion)} |`);
  }
  return `${lines.join('\n')}\n`;
}

function runSelfTest() {
  const contract = readJson(DEFAULT_CONTRACT);
  assert.deepEqual(splitMarkdownRow('| A |  | OA |  |'), ['A', '', 'OA', '']);
  assert.deepEqual(splitSystems('OA、MES, PLM', contract), ['OA', 'MES', 'PLM']);
  assert.deepEqual(splitSystems('—', contract), []);
  assert.equal(looksLikeMainHeader(splitMarkdownRow('| 部门（D1） | 能力域（L1） | 业务能力（L2） | 业务流程（L3） | 应用系统（S1） |')), true);
  assert.equal(looksLikeA1Header(splitMarkdownRow('| 业务行为（A1）编号 | 业务行为（A1） | 应用系统（S1） |')), true);
  assert.equal(looksLikeA1Header(splitMarkdownRow('| A1编号 | 业务行为（A1） | 应用系统（S1） |')), true);
  assert.equal(extractL3FromHeading('##### CW-L3-01 生产成本定额管理与指标分解'), '生产成本定额管理与指标分解');
  assert.equal(extractL3FromHeading('##### 业务流程（L3）-0101 发展规划制定、调整'), '发展规划制定、调整');
  assert.equal(extractL3FromHeading('###### ZL-01-01 内部审核策划与实施'), '内部审核策划与实施');
  assert.deepEqual(splitDeptRefs('经营发展部、物资保障部', contract), ['经营发展部', '物资保障部']);
  assert.equal(hasBasisOnlyContext('§5.2 "依据经营发展部下达的订单"', '经营发展部'), true);
  assert.equal(hasBasisOnlyContext('§5.2 "依据经营发展部下达的订单，与物资保障部沟通工装状态"', '物资保障部'), false);
  assert.equal(hasDeptSpecificTransfer('与物资保障部沟通工装状态是否满足投产要求', '物资保障部'), true);
  console.log('self-test passed');
}

const args = parseArgs(process.argv.slice(2));
if (args.selfTest) {
  runSelfTest();
} else {
  const root = args.root ?? ROOT;
  const result = runChecks({
    contractPath: args.contract,
    reportPath: args.report,
    root,
  });
  const counts = countBySeverity(result.findings);
  const summary = {
    report: rel(result.reportPath, root),
    block: counts.BLOCK ?? 0,
    warn: counts.WARN ?? 0,
    info: counts.INFO ?? 0,
    l3Rows: result.totalL3Rows,
    a1Rows: result.totalA1Rows,
  };

  if (args.json) {
    console.log(JSON.stringify({ ...summary, findings: result.findings }, null, 2));
  } else {
    console.log(`DCM/BBM check wrote ${summary.report}`);
    console.log(`BLOCK=${summary.block} WARN=${summary.warn} INFO=${summary.info} L3=${summary.l3Rows} A1=${summary.a1Rows}`);
  }

  if (args.fail && summary.block > 0) {
    process.exitCode = 1;
  }
}
