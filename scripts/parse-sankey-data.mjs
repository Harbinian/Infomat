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

import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import { classifySourceBoundary, sourceBoundaryFromCitation } from './source-boundary-rules.mjs';

const NORMS = resolve(import.meta.dirname || '.', '..', 'docs', 'norms');
const REPO_ROOT = resolve(NORMS, '..', '..');
const COMPANY_DATA_PATH = resolve(NORMS, '..', 'company-sankey-data.json');
const CROSS_DEPT_REPORT = resolve(NORMS, '流程治理', '跨部门完整性检查报告.md');
const CROSS_CHAIN_REPORT = resolve(NORMS, '流程治理', '跨部门流程识别报告.md');
const DASHBOARD_PATH = resolve(NORMS, '..', '..', 'pmo', 'procedure-management', 'dashboard.html');
const ORGANIZATION_SOURCE = resolve(NORMS, '..', 'organization', '组织架构和部门职责.md');

function parseOrganizationDomainMap(text) {
  const blockMatch = text.match(/```([\s\S]*?)```/);
  if (!blockMatch) {
    throw new Error('组织真源缺少组织架构图代码块');
  }

  const result = {};
  let currentDomain = '总经理直辖域';
  for (const rawLine of blockMatch[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const nodeMatch = line.match(/[├└]──\s*(.+)$/);
    if (!nodeMatch) continue;

    const name = nodeMatch[1].replace(/（.*?）/g, '').trim();
    if (name === '经营副总') {
      currentDomain = '经营域';
      continue;
    }
    if (name === '生产副总') {
      currentDomain = '生产域';
      continue;
    }

    result[name] = currentDomain;
  }

  if (Object.keys(result).length === 0) {
    throw new Error('组织真源未解析出部门到域映射');
  }
  return result;
}

function buildDeptDomainMap() {
  return parseOrganizationDomainMap(readFileSync(ORGANIZATION_SOURCE, 'utf-8'));
}

const DEPT_DOMAIN = buildDeptDomainMap();

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

function discoverMdmRequirementFiles() {
  const result = [];
  const entries = readdirSync(NORMS, { withFileTypes: true });
  for (const e of entries) {
    if (e.isFile() && e.name.endsWith('能力层与MDM建设要求.md')) {
      result.push(e.name);
    }
  }
  return result;
}

function toRepoPath(filePath) {
  return relative(REPO_ROOT, filePath).replace(/\\/g, '/');
}

const TEXT_SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.yaml', '.yml']);

function normalizedSourceBuffer(filePath) {
  const bytes = readFileSync(filePath);
  if (!TEXT_SOURCE_EXTENSIONS.has(extname(filePath).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function normalizedSourceSize(filePath) {
  return normalizedSourceBuffer(filePath).length;
}

function sha256File(filePath) {
  return createHash('sha256').update(normalizedSourceBuffer(filePath)).digest('hex');
}

function extractReportHeader(text, label) {
  const re = new RegExp(`^>\\s*${label}：\\s*(.+)$`, 'm');
  const match = text.match(re);
  return match ? match[1].trim().replace(/`/g, '') : undefined;
}

function buildReportSourceMetadata(filePath, text) {
  const metadata = {
    path: toRepoPath(filePath),
    sha256: sha256File(filePath),
  };
  const declaredVersion = extractReportHeader(text, '版本');
  const declaredGeneratedDate = extractReportHeader(text, '生成日期');
  const declaredInput = extractReportHeader(text, '前置输入');
  if (declaredVersion) metadata.declaredVersion = declaredVersion;
  if (declaredGeneratedDate) metadata.declaredGeneratedDate = declaredGeneratedDate;
  if (declaredInput) metadata.declaredInput = declaredInput;
  return metadata;
}

function walkFiles(dirPath) {
  const files = [];
  if (!existsSync(dirPath)) return files;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function walkDirectories(dirPath) {
  const dirs = [];
  if (!existsSync(dirPath)) return dirs;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fullPath = join(dirPath, entry.name);
    dirs.push(fullPath);
    dirs.push(...walkDirectories(fullPath));
  }
  return dirs;
}

function discoverLeafDirectories(rootPath) {
  const dirs = [rootPath, ...walkDirectories(rootPath)];
  return dirs.filter(dirPath => {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return !entries.some(entry => entry.isDirectory());
  });
}

function sourceLeafDir(rootPath, filePath) {
  const rel = relative(rootPath, dirname(filePath)).replace(/\\/g, '/');
  return rel || '.';
}

function inferFileNo(fileName) {
  const name = basename(fileName);
  const gltx = name.match(/\b(GLTX-[A-Z]{1,4}-\d{2})(?:[-_ ]?([A-Z]))?/i);
  if (gltx) return { fileNo: gltx[1].toUpperCase(), revision: gltx[2] ? gltx[2].toUpperCase() : '?' };

  const qms = name.match(/\b(SYCXQMS-[A-Z0-9-]+|SYCX[/-]?QMS-[A-Z0-9-]+)(?:[-_ ]?([A-Z]))?/i);
  if (qms) return { fileNo: qms[1].replace('/', '-').toUpperCase(), revision: qms[2] ? qms[2].toUpperCase() : '?' };

  const form = name.match(/\b(FM[-_ ]?[A-Z0-9.-]+)\b/i);
  if (form) return { fileNo: form[1].replace(/[_ ]/g, '-').toUpperCase(), revision: '?' };

  return { fileNo: '待分配编号', revision: '?' };
}

function inferAssetType(repoPath) {
  const lower = repoPath.toLowerCase();
  const ext = extname(lower);
  const base = basename(lower);
  if (base.startsWith('~$') || base === 'thumbs.db') return 'temp';
  if (lower.includes('/_extracted/') || base.startsWith('_')) return 'generated';
  if (['.py', '.mjs', '.js'].includes(ext)) return 'helper_script';
  if (['.vsd', '.vsdx'].includes(ext)) return 'flow_model';
  if (['.xlsx', '.xls'].includes(ext)) return 'spreadsheet';
  if (['.jpg', '.jpeg', '.png'].includes(ext)) return 'image_or_template';
  if (['.doc', '.docx', '.pdf'].includes(ext)) return 'procedure';
  if (ext === '.md') return 'markdown_source';
  if (ext === '.txt') return 'extracted_text';
  return 'reference_copy';
}

function statusForAsset(assetType, repoPath) {
  if (['temp', 'generated', 'helper_script'].includes(assetType)) {
    return { status: '排除', reason: '临时、生成或辅助脚本文件，不作为流程证据' };
  }
  if (repoPath.includes('/_extracted/')) {
    return { status: '排除', reason: '正文抽取中间件，不作为独立流程证据' };
  }
  return { status: '纳入', reason: '纳入源文件覆盖清单，用于流程治理证据追溯' };
}

function buildSourceManifest(mappingFiles, mdmRequirementFiles) {
  const files = [];
  const leafDirectories = [];
  const seen = new Set();
  const seenLeafDirectories = new Set();

  function addLeafDirectory(dirPath, dept, sourceRoot) {
    if (!existsSync(dirPath)) return;
    const repoPath = toRepoPath(dirPath);
    if (seenLeafDirectories.has(repoPath)) return;
    seenLeafDirectories.add(repoPath);

    const directFiles = readdirSync(dirPath, { withFileTypes: true })
      .filter(entry => entry.isFile() && !entry.name.startsWith('~$'))
      .map(entry => join(dirPath, entry.name));
    const supportedFiles = directFiles.filter(filePath => {
      const assetType = inferAssetType(toRepoPath(filePath));
      return !['temp', 'generated', 'helper_script'].includes(assetType);
    });

    leafDirectories.push({
      path: repoPath,
      dept,
      leafDir: relative(sourceRoot, dirPath).replace(/\\/g, '/') || '.',
      fileCount: directFiles.length,
      supportedFileCount: supportedFiles.length,
      status: directFiles.length > 0 ? '纳入' : '待复核',
      reason: directFiles.length > 0
        ? '已递归到底层目录，目录内文件纳入逐项分类'
        : '空叶子目录，需确认是否缺少源文件或仅作分类占位',
    });
  }

  function addFile(filePath, dept, overrides = {}) {
    if (!existsSync(filePath)) return;
    const repoPath = toRepoPath(filePath);
    if (seen.has(repoPath)) return;
    seen.add(repoPath);

    const stat = statSync(filePath);
    const assetType = overrides.assetType || inferAssetType(repoPath);
    const inferred = inferFileNo(repoPath);
    const process = overrides.status && overrides.reason
      ? { status: overrides.status, reason: overrides.reason }
      : statusForAsset(assetType, repoPath);

    files.push({
      path: repoPath,
      dept,
      assetType,
      fileNo: overrides.fileNo || inferred.fileNo,
      revision: overrides.revision || inferred.revision,
      size: normalizedSourceSize(filePath),
      mtime: stat.mtime.toISOString(),
      sha256: sha256File(filePath),
      leafDir: overrides.sourceRoot ? sourceLeafDir(overrides.sourceRoot, filePath) : undefined,
      status: process.status,
      reason: process.reason,
      ...classifySourceBoundary({
        path: repoPath,
        fileName: basename(filePath),
        fileNo: overrides.fileNo || inferred.fileNo,
      }),
    });
  }

  addFile(ORGANIZATION_SOURCE, '全公司', {
    assetType: 'organization_source',
    fileNo: '组织真源',
    revision: '?',
    status: '纳入',
    reason: '部门清单与部门到域映射真源',
  });

  for (const file of mappingFiles) {
    const dept = file.replace('部门-能力-流程-系统映射关系.md', '');
    addFile(resolve(NORMS, file), dept, {
      assetType: 'mapping_markdown',
      fileNo: '流程映射文档',
      revision: '?',
      status: '纳入',
      reason: '部门 DCM/BBM 结构化映射真源',
    });
  }

  for (const file of mdmRequirementFiles) {
    const dept = file.replace('能力层与MDM建设要求.md', '');
    addFile(resolve(NORMS, file), dept, {
      assetType: 'mdm_requirement_markdown',
      fileNo: 'MDM建设要求',
      revision: '?',
      status: '纳入',
      reason: '部门主数据对象候选与治理要求来源',
    });
  }

  const deptSourceDirs = readdirSync(NORMS, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.endsWith('业务资料'))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  for (const dir of deptSourceDirs) {
    const dept = dir.name.replace('业务资料', '');
    const sourceRoot = resolve(NORMS, dir.name);
    for (const leafDir of discoverLeafDirectories(sourceRoot)) {
      addLeafDirectory(leafDir, dept, sourceRoot);
    }
    for (const filePath of walkFiles(sourceRoot)) {
      addFile(filePath, dept, { sourceRoot });
    }
  }

  const fileStats = files.reduce((acc, file) => {
    acc.total += 1;
    acc.byStatus[file.status] = (acc.byStatus[file.status] || 0) + 1;
    acc.byDept[file.dept] = (acc.byDept[file.dept] || 0) + 1;
    return acc;
  }, { total: 0, byStatus: {}, byDept: {} });

  const leafStats = leafDirectories.reduce((acc, dir) => {
    acc.total += 1;
    acc.byStatus[dir.status] = (acc.byStatus[dir.status] || 0) + 1;
    acc.byDept[dir.dept] = (acc.byDept[dir.dept] || 0) + 1;
    if (dir.fileCount === 0) acc.empty += 1;
    return acc;
  }, { total: 0, empty: 0, byStatus: {}, byDept: {} });

  return {
    files: files.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')),
    leafDirectories: leafDirectories.sort((a, b) => a.path.localeCompare(b.path, 'zh-CN')),
    stats: {
      ...fileStats,
      leafDirectories: leafStats,
    },
  };
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

function isMarkdownSeparatorRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(String(cell).trim()));
}

function headerIndex(headers, names) {
  for (const name of names) {
    const exact = headers.findIndex(header => cleanMarkdownCell(header) === name);
    if (exact !== -1) return exact;
  }
  for (const name of names) {
    const fuzzy = headers.findIndex(header => cleanMarkdownCell(header).includes(name));
    if (fuzzy !== -1) return fuzzy;
  }
  return -1;
}

function parseMarkdownTables(text) {
  const tables = [];
  let headers = null;
  let rows = [];

  function flush() {
    if (headers && rows.length) tables.push({ headers, rows });
    headers = null;
    rows = [];
  }

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) {
      if (line) flush();
      continue;
    }
    const cells = splitMarkdownRow(line);
    if (isMarkdownSeparatorRow(cells)) continue;
    if (!headers) {
      headers = cells;
      rows = [];
      continue;
    }
    if (cells.join('|') === headers.join('|')) continue;
    rows.push(cells);
  }
  flush();
  return tables;
}

function looksLikeA1Header(header) {
  const text = header.join('|');
  return (
    (text.includes('业务行为（A1）编号') || text.includes('A1编号')) &&
    text.includes('业务行为（A1）') &&
    text.includes('应用系统')
  );
}

function extractL3FromHeading(line) {
  const trimmed = line.trim();
  if (!/^#{3,6}\s+/.test(trimmed)) return '';

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
  if (!/^#{3,6}\s+/.test(trimmed)) return '';

  return trimmed
    .replace(/^#+\s*/, '')
    .replace(/^L2-\d+\s+/, '')
    .trim();
}

function shouldSkipA1DataRow(cells, header) {
  const first = cells[0] ?? '';
  if (!first || first === '合计' || first === '统计' || first === '应用系统（S1）') return true;
  if (first === '序号' || first === '指标' || first === '业务行为（A1）编号' || first === 'A1编号') return true;
  return cells.join('|') === header.join('|');
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

function resolveA1Mapping(a1, allMappings) {
  const candidates = allMappings.filter(m => m.dept === a1.dept);
  const exact = candidates.find(m => m.l3 === a1.l3Name);
  if (exact) return exact;

  const sameL2ByHeading = candidates.filter(m => normalizeProcessName(m.l2) === normalizeProcessName(a1.l3Name));
  if (sameL2ByHeading.length === 1) return sameL2ByHeading[0];

  const scored = candidates
    .map(m => ({ mapping: m, score: processNameScore(a1.l3Name, m.l3) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0]?.score >= 800 || (scored[0]?.score >= 0.55 && scored[0].score > (scored[1]?.score ?? 0) + 0.08)) {
    return scored[0].mapping;
  }

  if (a1.l2Name) {
    const sameL2 = candidates.filter(m => normalizeProcessName(m.l2) === normalizeProcessName(a1.l2Name));
    if (sameL2.length === 1) return sameL2[0];
  }

  return null;
}

function countMatchedA1(allA1, allMappings) {
  let matched = 0;
  for (const a of allA1) {
    if (resolveA1Mapping(a, allMappings)) matched += 1;
  }
  return matched;
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
  let evidenceColIndex = -1;

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
      const header = splitMarkdownRow(trimmed);
      // 判断有没有序号列
      if (trimmed.includes('| 序号') || trimmed.match(/^\| 序号/)) {
        s1ColIndex = 6;
      } else {
        s1ColIndex = 5;
      }
      const systemIdx = header.findIndex(cell => cell.includes('应用系统') || cell.includes('S1'));
      if (systemIdx !== -1) s1ColIndex = systemIdx;
      evidenceColIndex = header.findIndex(cell => cell.includes('制度依据'));
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
      const evidenceCitation = evidenceColIndex >= 0 ? cells[evidenceColIndex] || '' : '';

      const systems = splitS1(systemsRaw).flatMap(normalizeSystem);

      rows.push({ dept, l1, l2, l3, systems, evidenceCitation });
    }
  }

  return rows;
}

/**
 * 解析 A1 行为明细。
 * 在 "## 业务行为（A1）映射" 节中，
 * 每个 L3 标题后跟 A1 表格。
 *
 * 通过表头检测列位置，兼容多种表头格式。
 *
 * 返回 { l3Name, a1Name, system }[]
 */
function parseA1Section(text, diagnostics = null) {
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
  let currentL2 = null;
  let a1NameIdx = -1;
  let a1SysIdx = -1;
  let a1CodeIdx = -1;
  let a1EvidenceIdx = -1;
  let a1EvidenceTypeIdx = -1;
  let inTable = false;
  let currentHeader = [];

  for (let i = a1Start; i < lines.length; i++) {
    const line = lines[i].trim();

    // 下一个 ## 大标题(非子标题),结束
    if (line.startsWith('## ') && !line.includes('业务行为') && !line.startsWith('###')) {
      break;
    }

    const headingL3 = extractL3FromHeading(line);
    if (headingL3) {
      currentL3 = headingL3;
      inTable = false;
      a1NameIdx = -1;
      a1SysIdx = -1;
      a1CodeIdx = -1;
      a1EvidenceIdx = -1;
      a1EvidenceTypeIdx = -1;
      currentHeader = [];
      if (diagnostics) diagnostics.l3Headings += 1;
      continue;
    }
    if (line.startsWith('#') && /^#+\s+L2-\d+\s+/.test(line)) {
      currentL2 = extractL2FromHeading(line);
      continue;
    }

    // 检测 A1 表格表头
    if (currentL3 && line.startsWith('|')) {
      const hdr = splitMarkdownRow(line);
      if (looksLikeA1Header(hdr)) {
        for (let j = 0; j < hdr.length; j++) {
          const c = hdr[j];
          if ((c.includes('业务行为') && c.includes('编号')) || c === 'A1编号') a1CodeIdx = j;
          // 行为名称列: 含"业务行为"但不含"编号"
          if (c.includes('业务行为') && !c.includes('编号')) a1NameIdx = j;
          // 备用: 行为名称
          if (c === '行为名称') a1NameIdx = j;
          // 系统列: 含"应用系统"或"S1"
          if (c.includes('应用系统') || c === 'S1') a1SysIdx = j;
          if (c.includes('制度依据')) a1EvidenceIdx = j;
          if (c.includes('证据类型')) a1EvidenceTypeIdx = j;
        }
        currentHeader = hdr;
        inTable = true;
        if (diagnostics) diagnostics.a1Tables += 1;
        continue;
      }
      if (diagnostics && line.includes('业务行为')) diagnostics.rejectedHeaders += 1;
    }

    // 分隔行
    if (inTable && line.match(/^\|[\s\-:|]+$/)) {
      continue;
    }

    // 数据行
    if (inTable && a1NameIdx >= 0 && line.startsWith('|')) {
      const cells = splitMarkdownRow(line);
      if (shouldSkipA1DataRow(cells, currentHeader)) continue;
      if (cells.length <= a1NameIdx) continue;

      const a1Name = cells[a1NameIdx];
      const a1Code = a1CodeIdx >= 0 && a1CodeIdx < cells.length ? cells[a1CodeIdx] : '';
      const sysRaw = a1SysIdx >= 0 && a1SysIdx < cells.length ? cells[a1SysIdx] : '';
      const systems = sysRaw ? splitS1(sysRaw).flatMap(normalizeSystem) : [];
      const evidenceCitation = a1EvidenceIdx >= 0 && a1EvidenceIdx < cells.length ? cells[a1EvidenceIdx] : '';
      const evidenceType = a1EvidenceTypeIdx >= 0 && a1EvidenceTypeIdx < cells.length ? cells[a1EvidenceTypeIdx] : '';

      if (a1Name && a1Name.length > 1) {
        results.push({ l3Name: currentL3, l2Name: currentL2, a1Name, a1Code, evidenceCitation, evidenceType, systems });
        if (diagnostics) diagnostics.a1Rows += 1;
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

function buildMdmRequirements(files) {
  const items = [];
  for (const file of files) {
    const dept = file.replace('能力层与MDM建设要求.md', '');
    const sourceFile = `docs/norms/${file}`;
    const text = readFileSync(resolve(NORMS, file), 'utf-8');

    for (const table of parseMarkdownTables(text)) {
      const headers = table.headers.map(cleanMarkdownCell);
      const objectIdx = headerIndex(headers, ['主数据对象', '对象名称']);
      if (objectIdx === -1) continue;
      const keyFieldsIdx = headerIndex(headers, ['建议关键字段', '关键字段']);
      const governanceIdx = headerIndex(headers, ['治理要求', '建设要求']);
      if (keyFieldsIdx === -1 && governanceIdx === -1) continue;

      const sourceL2Idx = headerIndex(headers, ['来源业务能力（L2）', '来源业务能力', '业务能力（L2）', '业务能力']);
      const responsibleIdx = headerIndex(headers, ['数据责任部门', '责任部门']);
      const boundaryIdx = headerIndex(headers, ['系统边界', '系统边界说明']);

      for (const row of table.rows) {
        const masterDataObject = cleanMarkdownCell(row[objectIdx]);
        if (!masterDataObject || masterDataObject === '主数据对象') continue;
        items.push({
          dept,
          masterDataObject,
          sourceL2: sourceL2Idx >= 0 ? cleanMarkdownCell(row[sourceL2Idx]) : '',
          keyFields: keyFieldsIdx >= 0 ? cleanMarkdownCell(row[keyFieldsIdx]) : '',
          responsibleDept: responsibleIdx >= 0 ? cleanMarkdownCell(row[responsibleIdx]) : '',
          systemBoundary: boundaryIdx >= 0 ? cleanMarkdownCell(row[boundaryIdx]) : '',
          governanceRequirement: governanceIdx >= 0 ? cleanMarkdownCell(row[governanceIdx]) : '',
          sourceFile,
        });
      }
    }
  }
  return items;
}

function buildEvidenceRefs(allMappings, allA1, mdmRequirements) {
  const refs = [];
  const seen = new Set();

  function add(ref) {
    const key = [
      ref.refType,
      ref.dept,
      ref.l3Name || '',
      ref.a1Code || '',
      ref.masterDataObject || '',
      ref.sourceFile || '',
      ref.citation || '',
      ref.evidenceType || '',
    ].join('|');
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(ref);
  }

  for (const row of allMappings) {
    const boundary = sourceBoundaryFromCitation(row.evidenceCitation || row.sourceFile || '');
    add({
      refType: 'L3',
      dept: row.dept,
      l3Name: row.l3,
      a1Code: '',
      masterDataObject: '',
      evidenceType: '制度依据',
      sourceFile: row.sourceFile || `docs/norms/${row.dept}部门-能力-流程-系统映射关系.md`,
      citation: row.evidenceCitation || '',
      note: 'DCM 映射总表制度依据',
      ...boundary,
    });
  }

  for (const row of allA1) {
    const boundary = sourceBoundaryFromCitation(row.evidenceCitation || row.sourceFile || '');
    add({
      refType: 'A1',
      dept: row.dept,
      l3Name: row.l3Name,
      a1Code: row.a1Code || '',
      masterDataObject: '',
      evidenceType: row.evidenceType || '待复核',
      sourceFile: row.sourceFile || `docs/norms/${row.dept}部门-能力-流程-系统映射关系.md`,
      citation: row.evidenceCitation || '',
      note: '业务行为（A1）映射制度依据',
      ...boundary,
    });
  }

  for (const row of mdmRequirements) {
    const boundary = classifySourceBoundary({ path: row.sourceFile, citation: 'MDM建设要求' });
    add({
      refType: 'MDM',
      dept: row.dept,
      l3Name: '',
      a1Code: '',
      masterDataObject: row.masterDataObject,
      evidenceType: 'MDM建设要求',
      sourceFile: row.sourceFile,
      citation: '主数据对象识别',
      note: row.governanceRequirement || '部门能力层与 MDM 建设要求',
      ...boundary,
    });
  }

  return refs;
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
  if (riskDesc) {
    desc = riskDesc;
  } else if (target === '工程技术部' && impact) {
    desc = `所有指向工程技术部的A1在目标侧无对应流程，跨部门交互链在此节点断裂。${impact}`;
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
      breaks: ['工程技术部: BOM/工艺节点已完成目标侧建模,待跨部门受控传递证据复核'],
      status: 'partial',
    },
    {
      name: '成本管控链',
      breaks: ['工程技术部: BOM/技术方案输入已有目标侧流程骨架,待成本核算输入传递证据复核'],
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
    buildTargetRisk(text, '工程技术部', 'medium', '指向已映射待复核部门（工程技术部）', {
      source: '全部已映射部门',
      status: '已完成首轮 DCM/BBM 建模-待跨部门传递复核',
      desc: '工程技术部已完成首轮 DCM/BBM 建模，历史跨部门引用仍需逐条核验受控输出物传递证据。',
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

function printA1Diagnostics(perDeptDiagnostics, allMappings, allA1) {
  console.error('A1 parse diagnostics:');
  console.error('dept\tmappings\tparsedA1\tmatchedA1\tunmatchedA1\tl3Headings\ta1Tables\trejectedHeaders');

  for (const item of perDeptDiagnostics) {
    const deptA1 = allA1.filter(a => a.dept === item.dept);
    const matched = deptA1.filter(a => resolveA1Mapping(a, allMappings)).length;
    const unmatched = deptA1.length - matched;
    console.error([
      item.dept,
      item.mappings,
      deptA1.length,
      matched,
      unmatched,
      item.l3Headings,
      item.a1Tables,
      item.rejectedHeaders,
    ].join('\t'));
  }
}

// ---- 主流程 ----

function main() {
  const allMappings = []; // { dept, l1, l2, l3, systems }
  const allA1 = [];       // { dept, l3Name, a1Name }
  const perDeptDiagnostics = [];
  const diagnoseA1 = process.argv.includes('--diagnose-a1');

  const files = discoverMappingFiles();
  const mdmRequirementFiles = discoverMdmRequirementFiles();
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
    const diagnostics = { l3Headings: 0, a1Tables: 0, a1Rows: 0, rejectedHeaders: 0 };
    const a1Entries = parseA1Section(text, diagnostics);

    for (const m of mappings) {
      allMappings.push({ ...m, dept: deptName, sourceFile: `docs/norms/${file}` });
    }
    for (const a of a1Entries) {
      allA1.push({ dept: deptName, sourceFile: `docs/norms/${file}`, ...a });
    }
    perDeptDiagnostics.push({ dept: deptName, mappings: mappings.length, ...diagnostics });
  }

  const mdmRequirements = buildMdmRequirements(mdmRequirementFiles);
  const evidenceRefs = buildEvidenceRefs(allMappings, allA1, mdmRequirements);
  const sourceManifest = buildSourceManifest(files, mdmRequirementFiles);

  if (diagnoseA1) {
    printA1Diagnostics(perDeptDiagnostics, allMappings, allA1);
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
    const matched = resolveA1Mapping(a, allMappings);
    if (matched) {
      l3WithA1.add(`${matched.dept}||${matched.l3}`);
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

  const a1Matched = countMatchedA1(allA1, allMappings);

  const finalData = {
    snapshotDate: new Date().toISOString().slice(0, 10),
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
      a1Matched,
      a1Unmatched: allA1.length - a1Matched,
      departmentsWithData: deptsWithData.size,
      departmentsEmpty: Object.keys(DEPT_DOMAIN).length - deptsWithData.size,
    },
    sourceManifest,
    mdmRequirements,
    evidenceRefs,
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

  const crossDeptSourceReports = [
    buildReportSourceMetadata(CROSS_DEPT_REPORT, crossDeptReportText),
  ];
  if (crossChainReportText) {
    crossDeptSourceReports.push(buildReportSourceMetadata(CROSS_CHAIN_REPORT, crossChainReportText));
  }

  finalData.crossDept = {
    ...parseCrossDeptReport(crossDeptReportText, crossChainReportText),
    sourceReports: crossDeptSourceReports,
  };

  writeFileSync(COMPANY_DATA_PATH, `${JSON.stringify(finalData, null, 2)}\n`, 'utf-8');
  console.error(`Wrote ${COMPANY_DATA_PATH}`);

  // 输出到 stdout (管道友好)
  process.stdout.write(JSON.stringify(finalData));

  // 同步注入到 PMO 驾驶舱的内嵌 JSON 标签，使页面保持单文件可双击打开。
  try {
    let dash = readFileSync(DASHBOARD_PATH, 'utf-8');
    const sankeyTagRe = /(<script type="application\/json" id="sankey-data">)[\s\S]*?(<\/script>)/g;
    const crossTagRe = /(<script type="application\/json" id="cross-dept-data">)[\s\S]*?(<\/script>)/g;
    const sankeyDataBlocks = [...dash.matchAll(sankeyTagRe)];
    const crossDeptDataBlocks = [...dash.matchAll(crossTagRe)];

    if (sankeyDataBlocks.length !== 1) {
      throw new Error(`Expected exactly one sankey-data script tag in ${DASHBOARD_PATH}, found ${sankeyDataBlocks.length}`);
    }
    if (crossDeptDataBlocks.length !== 1) {
      throw new Error(`Expected exactly one cross-dept-data script tag in ${DASHBOARD_PATH}, found ${crossDeptDataBlocks.length}`);
    }

    dash = dash.replace(sankeyTagRe, `$1\n${JSON.stringify(finalData)}\n$2`);
    dash = dash.replace(crossTagRe, `$1\n${JSON.stringify(finalData.crossDept)}\n$2`);
    writeFileSync(DASHBOARD_PATH, dash, 'utf-8');
    const sizeKB = (Buffer.byteLength(dash, 'utf-8') / 1024).toFixed(0);
    console.error(`Inlined dashboard data into ${DASHBOARD_PATH} (${sizeKB} KB)`);
  } catch (e) {
    console.error(`内嵌 dashboard.html 失败: ${e.message}`);
    throw e;
  }
}

main();
