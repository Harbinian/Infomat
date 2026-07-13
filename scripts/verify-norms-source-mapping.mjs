#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';
import { sourceBoundaryFromCitation } from './source-boundary-rules.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(SCRIPT_DIR, '..');
const CONTRACT_PATH = join(ROOT, 'docs', 'contracts', 'dcm-bbm-contract.json');
const NORMS_DIR = join(ROOT, 'docs', 'norms');
const DEFAULT_REPORT = join(ROOT, 'docs', 'reports', `${todayStamp()}-norms-source-mapping-verification.md`);
const DEFAULT_OUT_DIR = join(ROOT, 'artifacts', 'norms-source-mapping-verify', runStamp());

const SOURCE_EXTENSIONS = new Set([
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.pdf',
  '.md',
  '.txt',
  '.jpg',
  '.jpeg',
  '.png',
  '.tif',
  '.tiff',
  '.vsd',
  '.vsdx',
]);

const TEXT_READABLE_EXTENSIONS = new Set(['.docx', '.xlsx', '.md', '.txt']);
const GENERATED_PATH_PARTS = ['/_extracted/', '/流程治理/', '/merged/'];
const GENERATED_NAME_PATTERNS = [
  /^~\$/i,
  /^_/,
  /^extract_/i,
  /^list_files\.py$/i,
  /^a1_js\.txt$/i,
  /^README\.md$/i,
  /^AGENTS\.md$/i,
  /^CLAUDE\.md$/i,
  /^_quality-report\.md$/i,
  /^部门能力流程系统映射使用说明\.md$/i,
  /^流程映射表字段说明\.md$/i,
  /部门-能力-流程-系统映射关系\.md$/i,
  /能力层与MDM建设要求\.md$/i,
  /部门能力流程系统桑基图\.html$/i,
];

const PLACEHOLDER_PATTERNS = [
  /待部门确认/,
  /旧模板未采集/,
  /待补/,
  /待分配编号/,
  /文件为空/,
  /文件未提供/,
  /上下文推断/,
  /分析拆分/,
  /原文不足/,
  /未采集/,
];

const EVIDENCE_FIELDS = [
  '制度依据（文件号/条款）',
  '制度依据',
  '执行角色依据',
  '触发情景依据',
  '前置条件依据',
  '验收标准依据',
];

const REQUIRED_DCM_HEADERS = [
  '部门（D1）',
  '能力域（L1）',
  '业务能力（L2）',
  '业务流程（L3）',
  '制度依据（文件号/条款）',
  '应用系统（S1）',
  '系统设计依据',
];

const REQUIRED_A1_HEADERS = [
  '业务行为（A1）编号',
  '业务行为（A1）',
  '执行角色',
  '触发情景',
  '前置条件',
  '审批类型',
  '应用系统（S1）',
  '制度依据',
  '证据类型',
  '验收标准',
  '核验提醒',
  '部门确认意见',
  '是否调整',
  '调整建议',
];

const sourceTextCache = new Map();

function parseArgs(argv) {
  const args = {
    contract: CONTRACT_PATH,
    outDir: DEFAULT_OUT_DIR,
    report: DEFAULT_REPORT,
    failOnBlock: false,
  };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg === '--fail-on-block') args.failOnBlock = true;
    else if (arg.startsWith('--contract=')) args.contract = resolve(ROOT, arg.slice('--contract='.length));
    else if (arg.startsWith('--out-dir=')) args.outDir = resolve(ROOT, arg.slice('--out-dir='.length));
    else if (arg.startsWith('--report=')) args.report = resolve(ROOT, arg.slice('--report='.length));
  }
  return args;
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function runStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function ensureDir(path) {
  mkdirSync(path, { recursive: true });
}

function writeJson(path, value) {
  ensureDir(dirname(path));
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function rel(path) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

function basenameOf(path) {
  return String(path).replace(/\\/g, '/').split('/').pop() || '';
}

function extLower(path) {
  return extname(path).toLowerCase();
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function normalizeForMatch(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/版/g, '')
    .replace(/[^\u4e00-\u9fa5A-Z0-9]+/g, '');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[，。；：、（）【】《》]/g, '')
    .toUpperCase();
}

function md(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
}

function shortText(value, max = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function unique(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function zipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  const centralSignature = 0x02014b50;
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);
  let eocdOffset = -1;
  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === eocdSignature) {
      eocdOffset = offset;
      break;
    }
  }
  if (eocdOffset < 0) return [];

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let offset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = [];
  for (let index = 0; index < entryCount && offset < buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== centralSignature) break;
    const compressionMethod = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localHeaderOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.slice(offset + 46, offset + 46 + nameLength).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function readZipEntry(buffer, entryName, entries = zipEntries(buffer)) {
  const localSignature = 0x04034b50;
  const entry = entries.find((item) => item.name === entryName);
  if (!entry) return null;
  if (buffer.readUInt32LE(entry.localHeaderOffset) !== localSignature) return null;
  const localNameLength = buffer.readUInt16LE(entry.localHeaderOffset + 26);
  const localExtraLength = buffer.readUInt16LE(entry.localHeaderOffset + 28);
  const dataOffset = entry.localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressed = buffer.slice(dataOffset, dataOffset + entry.compressedSize);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  return null;
}

function xmlText(xml) {
  return decodeXmlEntities(
    String(xml || '')
      .replace(/<w:tab\/>/g, ' ')
      .replace(/<br\/?>/g, ' ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

function readDocxText(file) {
  const buffer = readFileSync(file);
  const entries = zipEntries(buffer);
  const documentXml = readZipEntry(buffer, 'word/document.xml', entries);
  if (!documentXml) return '';
  return documentXml
    .toString('utf8')
    .split(/<\/w:p>/)
    .map((paragraphXml) =>
      [...paragraphXml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
        .map((match) => decodeXmlEntities(match[1]))
        .join('')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n');
}

function sharedStringsFromXlsx(buffer, entries) {
  const xml = readZipEntry(buffer, 'xl/sharedStrings.xml', entries);
  if (!xml) return [];
  return [...xml.toString('utf8').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]));
}

function sheetTextFromXml(xml, sharedStrings) {
  const values = [];
  for (const match of String(xml || '').matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
    const attrs = match[1] || '';
    const body = match[2] || '';
    const type = attrs.match(/\bt="([^"]+)"/)?.[1] || '';
    if (type === 's') {
      const idx = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1]);
      if (Number.isInteger(idx) && sharedStrings[idx]) values.push(sharedStrings[idx]);
      continue;
    }
    if (type === 'inlineStr') {
      const inline = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] || body;
      const text = xmlText(inline);
      if (text) values.push(text);
      continue;
    }
    const v = decodeXmlEntities(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '').trim();
    if (v) values.push(v);
  }
  return values.join('\n');
}

function readXlsxText(file) {
  const buffer = readFileSync(file);
  const entries = zipEntries(buffer);
  const sharedStrings = sharedStringsFromXlsx(buffer, entries);
  const sheets = entries
    .map((entry) => entry.name)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));
  return sheets
    .map((sheet) => {
      const xml = readZipEntry(buffer, sheet, entries);
      return xml ? sheetTextFromXml(xml.toString('utf8'), sharedStrings) : '';
    })
    .filter(Boolean)
    .join('\n');
}

function readSourceText(file) {
  if (sourceTextCache.has(file)) return sourceTextCache.get(file);
  const ext = extLower(file);
  let result;
  try {
    if (ext === '.docx') result = { status: 'readable', text: readDocxText(file), error: '' };
    else if (ext === '.xlsx') result = { status: 'readable', text: readXlsxText(file), error: '' };
    else if (ext === '.md' || ext === '.txt') result = { status: 'readable', text: readFileSync(file, 'utf8'), error: '' };
    else result = { status: 'unsupported', text: '', error: `暂未抽取 ${ext} 正文` };
  } catch (error) {
    result = { status: 'read_error', text: '', error: error.message };
  }
  result.charCount = result.text.length;
  sourceTextCache.set(file, result);
  return result;
}

function extractFileCodes(value) {
  const text = String(value || '');
  const patterns = [
    /\bGLTX[-_\s]?[A-Z0-9]{1,6}[-_\s]?\d{1,4}(?:[-_\s]?\d{1,4})?[-_\s]?[A-Z]\b/gi,
    /\bGL[BCG]\d{4,8}(?:[-_]\d{1,4})?(?:[-_\s]?[A-Z])?\b/gi,
    /\bFM\d{4,}(?:[-_.]\d+[A-Z]?)*(?:[-_\s]?[A-Z])?\b/gi,
    /\bSYCX[/-]QMS[-_\s]?[A-Z]\d?[-_\s]?\d{2}[-_\s]?[A-Z]\b/gi,
  ];
  return unique(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ''))));
}

function deptFromSourcePath(file) {
  const repoPath = rel(file);
  const part = repoPath.split('/').find((item) => item.endsWith('业务资料'));
  return part ? part.slice(0, -'业务资料'.length) : '';
}

function isGeneratedSource(file) {
  const repoPath = rel(file);
  const normalized = repoPath.replace(/\\/g, '/');
  const name = basenameOf(normalized);
  if (GENERATED_PATH_PARTS.some((part) => normalized.includes(part))) return true;
  return GENERATED_NAME_PATTERNS.some((pattern) => pattern.test(name));
}

function buildSourceInventory() {
  return walkFiles(NORMS_DIR)
    .filter((file) => SOURCE_EXTENSIONS.has(extLower(file)))
    .filter((file) => !isGeneratedSource(file))
    .map((file) => {
      const stats = statSync(file);
      const repoPath = rel(file);
      const name = basenameOf(repoPath);
      const ext = extLower(file);
      const textStatus = readSourceText(file);
      const rawCodes = extractFileCodes(`${repoPath} ${name}`);
      const boundary = sourceBoundaryFromCitation(`${repoPath} ${rawCodes.join(' ')}`);
      return {
        id: `SRC-${normalizeForMatch(repoPath).slice(0, 24)}-${stats.size}`,
        dept: deptFromSourcePath(file),
        repoPath,
        name,
        ext,
        size: stats.size,
        readable: textStatus.status === 'readable',
        textStatus: textStatus.status,
        charCount: textStatus.charCount,
        readError: textStatus.error,
        fileCodes: rawCodes,
        normalizedCodes: rawCodes.map(normalizeForMatch),
        normalizedPath: normalizeForMatch(repoPath),
        normalizedName: normalizeForMatch(name),
        sourceBoundary: boundary.source_boundary_flag,
        sourceBoundaryLabel: boundary.source_boundary_label,
      };
    });
}

function splitMarkdownRow(line) {
  const cells = String(line).trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  return /^\|[\s\-:|]+$/.test(String(line).trim());
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

function classifyTable(header) {
  const text = header.join('|');
  if (text.includes('部门（D1）') && text.includes('业务流程（L3）') && text.includes('应用系统（S1）')) return 'DCM';
  if ((text.includes('业务行为（A1）编号') || text.includes('A1编号')) && text.includes('业务行为（A1）')) return 'A1';
  if ((text.includes('稳定编号') || text.includes('业务流程（L3）编号') || text.includes('流程编号')) && text.includes('业务流程（L3）')) return 'L3_INDEX';
  if (text.includes('文件名称') && (text.includes('来源') || text.includes('类型'))) return 'SOURCE_LIST';
  return 'OTHER';
}

function collectMarkdownTables(lines) {
  const tables = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const header = splitMarkdownRow(line);
    const tableType = classifyTable(header);
    if (tableType === 'OTHER') continue;
    const rows = [];
    let j = i + 1;
    while (j < lines.length) {
      const trimmed = lines[j].trim();
      if (!trimmed) {
        j += 1;
        continue;
      }
      if (!trimmed.startsWith('|')) break;
      if (!isSeparatorRow(lines[j])) {
        const cells = splitMarkdownRow(lines[j]);
        if (cells.join('|') !== header.join('|')) rows.push({ line: j + 1, cells });
      }
      j += 1;
    }
    tables.push({ header, rows, startLine: i + 1, endLine: j, tableType });
    i = j - 1;
  }
  return tables;
}

function deptFromMappingPath(file) {
  const suffix = '部门-能力-流程-系统映射关系.md';
  const name = basenameOf(file);
  return name.endsWith(suffix) ? name.slice(0, -suffix.length) : '';
}

function isBlankToken(value) {
  const text = String(value ?? '').trim();
  return !text || /^[-—–]+$/.test(text) || ['无', '不适用', 'NA', 'N/A'].some((token) => token.toUpperCase() === text.toUpperCase());
}

function extractL3CodeFromA1(a1Id) {
  const text = String(a1Id || '').trim();
  const match = text.match(/^(.+?)-A\d+/i);
  return match ? match[1] : '';
}

function addFinding(findings, severity, area, file, line, message, suggestion = '') {
  findings.push({ severity, area, file: file ? rel(file) : '', line, message, suggestion });
}

function parseMappingDocs(contract) {
  const findings = [];
  const mappingRows = [];
  const l3ByDept = new Map();
  const a1Ids = new Map();

  for (const dept of Object.keys(contract.departments)) {
    const file = join(NORMS_DIR, `${dept}部门-能力-流程-系统映射关系.md`);
    if (!existsSync(file)) {
      addFinding(findings, 'BLOCK', 'MAPPING_FILE', file, 1, `${dept} 缺少标准映射表`, '补齐部门流程输入基线。');
      continue;
    }

    const text = readFileSync(file, 'utf8');
    const tables = collectMarkdownTables(text.split(/\r?\n/));
    const deptL3Codes = new Set();
    const deptL3Names = new Set();

    for (const table of tables) {
      if (table.tableType === 'DCM') {
        const missing = REQUIRED_DCM_HEADERS.filter((name) => findHeaderIndex(table.header, name) < 0);
        if (missing.length) {
          addFinding(findings, 'BLOCK', 'DCM_HEADER', file, table.startLine, `DCM 主表缺少字段: ${missing.join('、')}`, '按字段说明补齐表头。');
        }
        for (const row of table.rows) {
          const l3 = cell(row, table.header, ['业务流程（L3）', '业务流程']);
          const l2 = cell(row, table.header, ['业务能力（L2）', '业务能力']);
          const l1 = cell(row, table.header, ['能力域（L1）', '能力域']);
          if (!l3 || l3 === '业务流程（L3）') continue;
          deptL3Names.add(normalizeForMatch(l3));
          mappingRows.push({
            id: `${dept}-DCM-${row.line}`,
            dept,
            tableType: 'DCM',
            repoPath: rel(file),
            line: row.line,
            l1,
            l2,
            l3,
            a1Id: '',
            behavior: '',
            s1: cell(row, table.header, ['应用系统（S1）', '应用系统']),
            s2: '',
            fields: {
              '部门（D1）': cell(row, table.header, '部门（D1）'),
              '能力域（L1）': l1,
              '业务能力（L2）': l2,
              '业务流程（L3）': l3,
              '制度依据（文件号/条款）': cell(row, table.header, ['制度依据（文件号/条款）', '制度依据']),
              '应用系统（S1）': cell(row, table.header, ['应用系统（S1）', '应用系统']),
              '系统设计依据': cell(row, table.header, '系统设计依据'),
            },
          });
        }
      }

      if (table.tableType === 'L3_INDEX') {
        for (const row of table.rows) {
          const code = cell(row, table.header, ['稳定编号', '业务流程（L3）编号/标识符', '业务流程（L3）编号', '流程编号']);
          const l3 = cell(row, table.header, ['业务流程（L3）', '业务流程']);
          if (code) deptL3Codes.add(code);
          if (l3) deptL3Names.add(normalizeForMatch(l3));
        }
      }

      if (table.tableType === 'A1') {
        const missing = REQUIRED_A1_HEADERS.filter((name) => findHeaderIndex(table.header, name) < 0);
        if (missing.length) {
          addFinding(findings, 'BLOCK', 'A1_HEADER', file, table.startLine, `A1 表缺少核心字段: ${missing.join('、')}`, '按字段说明补齐 A1 主记录表头。');
        }
        for (const row of table.rows) {
          const a1Id = cell(row, table.header, ['业务行为（A1）编号', 'A1编号']);
          const behavior = cell(row, table.header, '业务行为（A1）');
          if (!a1Id && !behavior) continue;
          const l3Code = extractL3CodeFromA1(a1Id);
          const l3 = cell(row, table.header, ['业务流程（L3）', '业务流程']);
          if (a1Id) {
            const duplicateKey = `${dept}:${a1Id}`;
            if (a1Ids.has(duplicateKey)) {
              addFinding(findings, 'BLOCK', 'A1_DUPLICATE', file, row.line, `A1 编号重复: ${a1Id}`, `首次出现位置 ${a1Ids.get(duplicateKey)}。`);
            } else {
              a1Ids.set(duplicateKey, `${rel(file)}:${row.line}`);
            }
          }
          if (l3Code && deptL3Codes.size && !deptL3Codes.has(l3Code)) {
            addFinding(findings, 'WARN', 'A1_PARENT', file, row.line, `A1 ${a1Id} 的 L3 编号前缀未在本部门 L3 索引中登记: ${l3Code}`, '确认 A1 是否挂接到已确认 L3。');
          }
          if (l3 && deptL3Names.size && !deptL3Names.has(normalizeForMatch(l3))) {
            addFinding(findings, 'WARN', 'A1_PARENT', file, row.line, `A1 ${a1Id} 的业务流程（L3）未在 DCM 主表中找到: ${l3}`, 'A1 应挂接到 DCM 已确认 L3。');
          }
          mappingRows.push({
            id: `${dept}-A1-${a1Id || row.line}`,
            dept,
            tableType: 'A1',
            repoPath: rel(file),
            line: row.line,
            l1: '',
            l2: cell(row, table.header, ['业务能力（L2）', '业务能力']),
            l3,
            l3Code,
            a1Id,
            behavior,
            s1: cell(row, table.header, ['应用系统（S1）', '应用系统']),
            s2: cell(row, table.header, ['应用模块（S2）', '应用模块']),
            fields: {
              '业务行为（A1）编号': a1Id,
              '业务行为（A1）': behavior,
              '执行角色': cell(row, table.header, '执行角色'),
              '执行角色依据': cell(row, table.header, '执行角色依据'),
              '触发情景': cell(row, table.header, '触发情景'),
              '触发情景依据': cell(row, table.header, '触发情景依据'),
              '前置条件': cell(row, table.header, '前置条件'),
              '前置条件依据': cell(row, table.header, '前置条件依据'),
              '数据输入': cell(row, table.header, '数据输入'),
              '数据输出': cell(row, table.header, '数据输出'),
              '输入来源部门': cell(row, table.header, '输入来源部门'),
              '输出目标部门': cell(row, table.header, '输出目标部门'),
              '审批类型': cell(row, table.header, '审批类型'),
              '应用系统（S1）': cell(row, table.header, ['应用系统（S1）', '应用系统']),
              '应用模块（S2）': cell(row, table.header, ['应用模块（S2）', '应用模块']),
              '制度依据': cell(row, table.header, '制度依据'),
              '证据类型': cell(row, table.header, '证据类型'),
              '验收标准': cell(row, table.header, '验收标准'),
              '验收标准依据': cell(row, table.header, '验收标准依据'),
              '核验提醒': cell(row, table.header, '核验提醒'),
              '部门确认意见': cell(row, table.header, '部门确认意见'),
              '是否调整': cell(row, table.header, '是否调整'),
              '调整建议': cell(row, table.header, '调整建议'),
              '备注': cell(row, table.header, '备注'),
            },
          });
        }
      }
    }
    l3ByDept.set(dept, { codes: Array.from(deptL3Codes), names: Array.from(deptL3Names) });
  }

  return { mappingRows, findings, l3ByDept };
}

function extractSections(value) {
  const text = String(value || '');
  const patterns = [
    /全文/g,
    /§\s*[0-9一二三四五六七八九十目的方式范围职责程序流程]+(?:[.．、]\d+)*(?:\([^)）]+\)|（[^）]+）)?(?:\s*[-—~至]\s*§?\s*[0-9一二三四五六七八九十目的方式范围职责程序流程]+(?:[.．、]\d+)*)?/g,
    /第\s*[0-9一二三四五六七八九十]+(?:[.．、]\d+)*\s*条/g,
    /表\s*[A-Z]?\d+(?:[.-]\d+)?/gi,
    /附件\s*\d+/g,
  ];
  return unique(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0].replace(/\s+/g, ''))));
}

function extractTitles(value) {
  return unique([...String(value || '').matchAll(/《([^》]+)》/g)].map((match) => match[1].trim()));
}

function extractExcerpts(value) {
  const text = String(value || '');
  const excerpts = [];
  for (const match of text.matchAll(/"([^"]{4,})"|“([^”]{4,})”|‘([^’]{4,})’/g)) {
    excerpts.push((match[1] || match[2] || match[3] || '').trim());
  }
  return unique(excerpts);
}

function splitEvidenceSegments(value) {
  return String(value || '')
    .split(/[；;]|(?:\s+\+\s+)/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function extractCitations(value, fallbackRefs = []) {
  const citations = [];
  for (const segment of splitEvidenceSegments(value)) {
    const codes = extractFileCodes(segment);
    const titles = extractTitles(segment);
    const sections = extractSections(segment);
    const excerpts = extractExcerpts(segment);
    const hasOwnSource = codes.length || titles.length;

    if (hasOwnSource) {
      const max = Math.max(codes.length || 1, titles.length || 1);
      for (let index = 0; index < max; index += 1) {
        citations.push({
          code: codes[index] || codes[0] || '',
          title: titles[index] || titles[0] || '',
          sections,
          excerpts,
          raw: segment,
          usedFallback: false,
        });
      }
      continue;
    }

    if ((sections.length || excerpts.length) && fallbackRefs.length === 1) {
      citations.push({
        code: fallbackRefs[0].code,
        title: fallbackRefs[0].title,
        sections,
        excerpts,
        raw: segment,
        usedFallback: true,
      });
    }
  }

  const seen = new Set();
  return citations.filter((item) => {
    const key = `${normalizeForMatch(item.code)}|${normalizeForMatch(item.title)}|${item.sections.join(',')}|${item.excerpts.join(',')}|${item.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function matchSource(citation, sourceInventory, rowDept) {
  const normalizedCode = normalizeForMatch(citation.code);
  const normalizedTitle = normalizeForMatch(citation.title);
  const matches = [];
  for (const source of sourceInventory) {
    let score = 0;
    if (rowDept && source.dept === rowDept) score += 30;
    for (const sourceCode of source.normalizedCodes) {
      if (normalizedCode && sourceCode === normalizedCode) score += 1500 + normalizedCode.length;
      if (normalizedCode && (sourceCode.includes(normalizedCode) || normalizedCode.includes(sourceCode))) score += 850 + Math.min(sourceCode.length, normalizedCode.length);
    }
    if (normalizedCode && source.normalizedName.includes(normalizedCode)) score += 1000 + normalizedCode.length;
    if (normalizedCode && source.normalizedPath.includes(normalizedCode)) score += 900 + normalizedCode.length;
    if (normalizedTitle && source.normalizedName.includes(normalizedTitle)) score += 700 + normalizedTitle.length;
    if (normalizedTitle && source.normalizedPath.includes(normalizedTitle)) score += 650 + normalizedTitle.length;
    if (score > 0) matches.push({ source, score });
  }
  matches.sort((a, b) => b.score - a.score || a.source.repoPath.length - b.source.repoPath.length);
  return matches[0]?.source || null;
}

function sectionTargets(section) {
  const raw = String(section || '').replace(/^第|条$/g, '').replace(/§/g, '');
  if (raw === '全文') return [];
  return raw
    .split(/[-—~至]/)
    .map((item) => item.replace(/[（）()].*$/g, '').trim())
    .filter(Boolean);
}

function sourceContainsTarget(rawText, target) {
  const text = String(rawText || '');
  const cleaned = String(target || '').replace(/^第|条$/g, '').trim();
  if (!cleaned) return false;
  if (/^\d+(?:[.．、]\d+)*$/.test(cleaned)) {
    const escaped = cleaned
      .split(/[.．、]/)
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('[.．、]');
    return new RegExp(`(^|[^0-9])(?:§\\s*)?${escaped}([^0-9]|$)|第\\s*${escaped}\\s*条`).test(text);
  }
  return normalizeText(text).includes(normalizeText(cleaned));
}

function verifyCitationAgainstSource(citation, source) {
  if (!source) {
    return { severity: 'BLOCK', result: 'source_missing', detail: '未在 docs/norms 源资料中匹配到制度或表单源文件。' };
  }
  const textStatus = readSourceText(join(ROOT, source.repoPath));
  if (textStatus.status !== 'readable') {
    return { severity: 'WARN', result: 'source_found_unreadable', detail: textStatus.error || '源文件已找到，但正文暂不能自动抽取。' };
  }

  const text = textStatus.text;
  const sourceNorm = normalizeText(text);
  const sectionResults = citation.sections.map((section) => {
    if (section === '全文') return { section, ok: true, detail: '全文引用，仅核验源文件存在。' };
    const targets = sectionTargets(section);
    const ok = targets.length > 0 && targets.every((target) => sourceContainsTarget(text, target));
    return { section, ok, detail: ok ? '章节锚点在源文件中可定位。' : '章节锚点未在源文件正文中定位。' };
  });
  const excerptResults = citation.excerpts.map((excerpt) => {
    const ok = normalizeText(excerpt).length >= 8 && sourceNorm.includes(normalizeText(excerpt));
    return { excerpt: shortText(excerpt, 80), ok, detail: ok ? '摘录文字在源文件中可定位。' : '摘录文字未在源文件中定位。' };
  });

  if (!citation.sections.length && !citation.excerpts.length) {
    return { severity: 'INFO', result: 'source_found_no_anchor', detail: '源文件已匹配，但该字段没有可自动核验的章节、表格或摘录锚点。', sectionResults, excerptResults };
  }
  if (sectionResults.some((item) => item.ok) || excerptResults.some((item) => item.ok)) {
    const hasFailedAnchor = sectionResults.some((item) => !item.ok) || excerptResults.some((item) => !item.ok);
    return {
      severity: hasFailedAnchor ? 'WARN' : 'OK',
      result: hasFailedAnchor ? 'anchor_partially_verified' : 'anchor_verified',
      detail: hasFailedAnchor ? '至少一个锚点已验证，但仍有章节或摘录未定位。' : '源文件和锚点均可定位。',
      sectionResults,
      excerptResults,
    };
  }
  return {
    severity: 'BLOCK',
    result: 'anchor_not_found',
    detail: '源文件已匹配，但章节/摘录锚点均未在源文件正文中定位。',
    sectionResults,
    excerptResults,
  };
}

function primaryRefsForRow(row) {
  const value = row.tableType === 'DCM' ? row.fields['制度依据（文件号/条款）'] : row.fields['制度依据'];
  return extractCitations(value);
}

function buildCitationChecks(mappingRows, sourceInventory) {
  const checks = [];
  for (const row of mappingRows) {
    const primaryRefs = primaryRefsForRow(row);
    for (const fieldName of EVIDENCE_FIELDS) {
      if (!(fieldName in row.fields)) continue;
      const value = row.fields[fieldName];
      const required =
        (row.tableType === 'DCM' && fieldName === '制度依据（文件号/条款）') ||
        (row.tableType === 'A1' && fieldName === '制度依据');

      if (isBlankToken(value)) {
        checks.push({
          severity: required ? 'BLOCK' : 'INFO',
          result: required ? 'required_evidence_blank' : 'optional_evidence_blank',
          fieldName,
          value,
          rowId: row.id,
          dept: row.dept,
          repoPath: row.repoPath,
          line: row.line,
          l3: row.l3,
          a1Id: row.a1Id,
          behavior: row.behavior,
          citation: null,
          source: null,
          detail: required ? '必填证据字段为空。' : '可选证据字段为空。',
        });
        continue;
      }

      const hasPlaceholder = PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value));
      if (hasPlaceholder) {
        checks.push({
          severity: 'WARN',
          result: 'evidence_placeholder',
          fieldName,
          value,
          rowId: row.id,
          dept: row.dept,
          repoPath: row.repoPath,
          line: row.line,
          l3: row.l3,
          a1Id: row.a1Id,
          behavior: row.behavior,
          citation: null,
          source: null,
          detail: '字段仍含待补、待确认或旧模板未采集口径。',
        });
      }

      const fallbackRefs = fieldName === '制度依据' || fieldName === '制度依据（文件号/条款）' ? [] : primaryRefs;
      const citations = extractCitations(value, fallbackRefs);
      if (!citations.length) {
        checks.push({
          severity: required ? 'WARN' : 'INFO',
          result: 'no_parseable_citation',
          fieldName,
          value,
          rowId: row.id,
          dept: row.dept,
          repoPath: row.repoPath,
          line: row.line,
          l3: row.l3,
          a1Id: row.a1Id,
          behavior: row.behavior,
          citation: null,
          source: null,
          detail: '未解析出源文件编号、制度/表单名称、章节、表格或摘录。',
        });
        continue;
      }

      for (const citation of citations) {
        const source = matchSource(citation, sourceInventory, row.dept);
        const verification = verifyCitationAgainstSource(citation, source);
        const boundary = sourceBoundaryFromCitation(citation.raw);
        checks.push({
          severity: verification.severity,
          result: verification.result,
          fieldName,
          value,
          rowId: row.id,
          dept: row.dept,
          repoPath: row.repoPath,
          line: row.line,
          l3: row.l3,
          a1Id: row.a1Id,
          behavior: row.behavior,
          citation: {
            code: citation.code,
            title: citation.title,
            sections: citation.sections,
            excerpts: citation.excerpts.map((item) => shortText(item, 120)),
            raw: citation.raw,
            usedFallback: citation.usedFallback,
            sourceBoundary: boundary.source_boundary_flag,
            sourceBoundaryLabel: boundary.source_boundary_label,
          },
          source: source
            ? {
                repoPath: source.repoPath,
                dept: source.dept,
                name: source.name,
                ext: source.ext,
                readable: source.readable,
                textStatus: source.textStatus,
                sourceBoundary: source.sourceBoundary,
                sourceBoundaryLabel: source.sourceBoundaryLabel,
              }
            : null,
          detail: verification.detail,
          sectionResults: verification.sectionResults || [],
          excerptResults: verification.excerptResults || [],
        });
      }
    }
  }
  return checks;
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function deptStats(contract, sourceInventory, mappingRows, citationChecks, mappingFindings = []) {
  return Object.keys(contract.departments).map((dept) => {
    const sources = sourceInventory.filter((item) => item.dept === dept);
    const rows = mappingRows.filter((item) => item.dept === dept);
    const checks = citationChecks.filter((item) => item.dept === dept);
    const findings = mappingFindings.filter((item) => deptFromMappingPath(item.file) === dept);
    const status = countBy(checks, (item) => item.severity);
    const findingStatus = countBy(findings, (item) => item.severity);
    return {
      dept,
      sourceFiles: sources.length,
      readableSourceFiles: sources.filter((item) => item.readable).length,
      dcmRows: rows.filter((item) => item.tableType === 'DCM').length,
      a1Rows: rows.filter((item) => item.tableType === 'A1').length,
      ok: status.OK || 0,
      info: status.INFO || 0,
      warn: (status.WARN || 0) + (findingStatus.WARN || 0),
      block: (status.BLOCK || 0) + (findingStatus.BLOCK || 0),
    };
  });
}

function topChecks(citationChecks, findings, limit = 120) {
  const severityOrder = { BLOCK: 0, WARN: 1, INFO: 2, OK: 3 };
  const convertedFindings = findings.map((item) => ({
    severity: item.severity,
    result: item.area,
    repoPath: item.file,
    line: item.line,
    dept: deptFromMappingPath(item.file),
    fieldName: '',
    l3: '',
    a1Id: '',
    source: null,
    detail: item.message,
    suggestion: item.suggestion,
  }));
  return [...convertedFindings, ...citationChecks.filter((item) => item.severity !== 'OK')]
    .sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity] || `${a.repoPath}:${a.line}`.localeCompare(`${b.repoPath}:${b.line}`, 'zh-CN'))
    .slice(0, limit);
}

function renderReport({ contract, sourceInventory, mappingRows, citationChecks, mappingFindings, outputs }) {
  const sourceByExt = countBy(sourceInventory, (item) => item.ext);
  const readableSources = sourceInventory.filter((item) => item.readable).length;
  const citationStatus = countBy(citationChecks, (item) => item.severity);
  const findingStatus = countBy(mappingFindings, (item) => item.severity);
  const status = {
    OK: citationStatus.OK || 0,
    INFO: citationStatus.INFO || 0,
    WARN: (citationStatus.WARN || 0) + (findingStatus.WARN || 0),
    BLOCK: (citationStatus.BLOCK || 0) + (findingStatus.BLOCK || 0),
  };
  const rowsByType = countBy(mappingRows, (item) => item.tableType);
  const stats = deptStats(contract, sourceInventory, mappingRows, citationChecks, mappingFindings);
  const issues = topChecks(citationChecks, mappingFindings);
  const unsupported = sourceInventory.filter((item) => !item.readable);

  const lines = [
    '# docs/norms 原文-映射表核验报告',
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 核验范围：\`docs/norms\` 下 9 个部门业务资料目录和 9 份标准映射表。`,
    `- 字段口径：\`docs/contracts/dcm-bbm-contract.json\`、\`docs/norms/流程映射表字段说明.md\`。`,
    `- 机器明细目录：\`${outputs.outDir}\``,
    `- 说明：本次只读核验，不修改部门流程输入基线；不能稳定抽取正文的 PDF、旧版 Word、图片和 VSD 只登记源文件存在及待 OCR/人工复核。`,
    '',
    '## 总览',
    '',
    '| 项目 | 数量 |',
    '|---|---:|',
    `| 源文件清单 | ${sourceInventory.length} |`,
    `| 可抽取正文/表格文本的源文件 | ${readableSources} |`,
    `| 需 OCR 或人工复核的源文件 | ${sourceInventory.length - readableSources} |`,
    `| DCM 主表行 | ${rowsByType.DCM || 0} |`,
    `| BBM/A1 主记录行 | ${rowsByType.A1 || 0} |`,
    `| 证据字段核验项 | ${citationChecks.length} |`,
    `| 映射结构核验发现 | ${mappingFindings.length} |`,
    `| OK | ${status.OK} |`,
    `| INFO | ${status.INFO} |`,
    `| WARN | ${status.WARN} |`,
    `| BLOCK | ${status.BLOCK} |`,
    '',
    '## 部门覆盖',
    '',
    '| 部门 | 源文件 | 可读源文件 | DCM行 | A1行 | OK | INFO | WARN | BLOCK |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];

  for (const item of stats) {
    lines.push(`| ${md(item.dept)} | ${item.sourceFiles} | ${item.readableSourceFiles} | ${item.dcmRows} | ${item.a1Rows} | ${item.ok} | ${item.info} | ${item.warn} | ${item.block} |`);
  }

  lines.push(
    '',
    '## 源文件类型',
    '',
    '| 扩展名 | 数量 |',
    '|---|---:|',
  );
  for (const [ext, count] of Object.entries(sourceByExt).sort((a, b) => a[0].localeCompare(b[0]))) {
    lines.push(`| ${md(ext || '(无扩展名)')} | ${count} |`);
  }

  lines.push(
    '',
    '## 主要待处理项',
    '',
    `下表最多列出 ${issues.length} 条；完整明细见 \`${outputs.citationChecks}\` 和 \`${outputs.mappingRows}\`。`,
    '',
    '| 严重度 | 结果 | 映射位置 | 字段 | 业务流程 | 业务行为 | 源文件 | 说明 |',
    '|---|---|---|---|---|---|---|---|',
  );
  if (!issues.length) {
    lines.push('| OK | 无 |  |  |  |  |  | 未发现待处理项 |');
  } else {
    for (const item of issues) {
      const location = item.repoPath ? `${item.repoPath}${item.line ? `:${item.line}` : ''}` : '';
      const source = item.source?.repoPath || '';
      lines.push(`| ${item.severity} | ${md(item.result)} | ${md(location)} | ${md(item.fieldName)} | ${md(shortText(item.l3, 60))} | ${md(shortText(item.a1Id || item.behavior, 60))} | ${md(source)} | ${md(item.detail)} |`);
    }
  }

  lines.push(
    '',
    '## 不可自动抽正文的源文件',
    '',
    '这些文件已纳入源文件清单；本轮不把它们当作“正文已验证”。后续可通过 OCR、人工打开原件或转换为受控文本后再复核。',
    '',
    '| 源文件 | 类型 | 原因 |',
    '|---|---|---|',
  );
  for (const item of unsupported.slice(0, 80)) {
    lines.push(`| ${md(item.repoPath)} | ${md(item.ext)} | ${md(item.readError || item.textStatus)} |`);
  }
  if (unsupported.length > 80) {
    lines.push(`| ... | ... | 其余 ${unsupported.length - 80} 个文件见 \`${outputs.sourceInventory}\` |`);
  }

  lines.push(
    '',
    '## 输出文件',
    '',
    `- 源文件清单：\`${outputs.sourceInventory}\``,
    `- 映射表行明细：\`${outputs.mappingRows}\``,
    `- 引用核验明细：\`${outputs.citationChecks}\``,
    '',
  );
  return `${lines.join('\n')}\n`;
}

function run() {
  const args = parseArgs(process.argv.slice(2));
  const contract = readJson(args.contract);
  ensureDir(args.outDir);
  ensureDir(dirname(args.report));

  const sourceInventory = buildSourceInventory();
  const { mappingRows, findings: mappingFindings } = parseMappingDocs(contract);
  const citationChecks = buildCitationChecks(mappingRows, sourceInventory);

  const outputs = {
    outDir: rel(args.outDir),
    sourceInventory: rel(join(args.outDir, 'source_inventory.json')),
    mappingRows: rel(join(args.outDir, 'mapping_rows.json')),
    citationChecks: rel(join(args.outDir, 'citation_checks.json')),
    report: rel(args.report),
  };

  writeJson(join(args.outDir, 'source_inventory.json'), sourceInventory);
  writeJson(join(args.outDir, 'mapping_rows.json'), mappingRows);
  writeJson(join(args.outDir, 'citation_checks.json'), citationChecks);
  writeFileSync(args.report, renderReport({ contract, sourceInventory, mappingRows, citationChecks, mappingFindings, outputs }), 'utf8');

  const citationStatus = countBy(citationChecks, (item) => item.severity);
  const findingStatus = countBy(mappingFindings, (item) => item.severity);
  const summary = {
    report: outputs.report,
    outDir: outputs.outDir,
    sourceFiles: sourceInventory.length,
    readableSourceFiles: sourceInventory.filter((item) => item.readable).length,
    mappingRows: mappingRows.length,
    dcmRows: mappingRows.filter((item) => item.tableType === 'DCM').length,
    a1Rows: mappingRows.filter((item) => item.tableType === 'A1').length,
    citationChecks: citationChecks.length,
    ok: citationStatus.OK || 0,
    info: citationStatus.INFO || 0,
    warn: (citationStatus.WARN || 0) + (findingStatus.WARN || 0),
    block: (citationStatus.BLOCK || 0) + (findingStatus.BLOCK || 0),
  };

  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else {
    console.log(`norms source mapping verification wrote ${summary.report}`);
    console.log(`sources=${summary.sourceFiles} readable=${summary.readableSourceFiles} DCM=${summary.dcmRows} A1=${summary.a1Rows}`);
    console.log(`checks=${summary.citationChecks} OK=${summary.ok} INFO=${summary.info} WARN=${summary.warn} BLOCK=${summary.block}`);
    console.log(`details=${summary.outDir}`);
  }

  if (args.failOnBlock && summary.block > 0) process.exitCode = 1;
}

run();
