/**
 * 校验流程地图驾驶舱的数据快照是否与生成文件一致。
 *
 * 用法: node scripts/check-dashboard-data.mjs
 */

import { createHash } from 'crypto';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { extname, relative, resolve } from 'path';

const ROOT = resolve(import.meta.dirname || '.', '..');
const NORMS_PATH = resolve(ROOT, 'docs', 'norms');
const DATA_PATH = resolve(ROOT, 'docs', 'company-sankey-data.json');
const DASHBOARD_PATH = resolve(ROOT, 'pmo', 'procedure-management', 'dashboard.html');
const CROSS_DEPT_REPORT_PATH = resolve(NORMS_PATH, '流程治理', '跨部门完整性检查报告.md');
const CROSS_CHAIN_REPORT_PATH = resolve(NORMS_PATH, '流程治理', '跨部门流程识别报告.md');

function fail(message) {
  console.error(`Dashboard data check failed: ${message}`);
  process.exit(1);
}

function readJsonFile(path) {
  if (!existsSync(path)) {
    fail(`missing ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch (e) {
    fail(`cannot parse ${path}: ${e.message}`);
  }
}

function extractEmbeddedJson(html, id) {
  const re = new RegExp(`<script type="application/json" id="${id}">([\\s\\S]*?)</script>`);
  const match = html.match(re);
  if (!match) {
    fail(`missing embedded #${id}`);
  }
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    fail(`cannot parse embedded #${id}: ${e.message}`);
  }
}

function stableJson(value) {
  return JSON.stringify(value);
}

function toRepoPath(path) {
  return relative(ROOT, path).replace(/\\/g, '/');
}

const TEXT_SOURCE_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.txt', '.yaml', '.yml']);

function normalizedSourceBuffer(path) {
  const bytes = readFileSync(path);
  if (!TEXT_SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) return bytes;
  return Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
}

function sha256File(path) {
  return createHash('sha256').update(normalizedSourceBuffer(path)).digest('hex');
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function parseReportNumber(value, fallback = 0) {
  const match = String(value || '').replace(/,/g, '').match(/-?\d+/);
  return match ? Number(match[0]) : fallback;
}

function extractReportMetric(text, label, fallback = 0) {
  const re = new RegExp(`\\|\\s*${escapeRegExp(label)}\\s*\\|\\s*([^|]+)\\|`);
  const match = text.match(re);
  return match ? parseReportNumber(match[1], fallback) : fallback;
}

function readCrossDeptReportMetrics() {
  if (!existsSync(CROSS_DEPT_REPORT_PATH)) {
    fail(`missing ${CROSS_DEPT_REPORT_PATH}`);
  }
  const text = readFileSync(CROSS_DEPT_REPORT_PATH, 'utf-8');
  return {
    totalChecked: extractReportMetric(text, '检查的跨部门引用总数（内部）'),
    confirmed: extractReportMetric(text, '已确认有对应覆盖'),
    pendingConfirm: extractReportMetric(text, '待确认（需人工判断）'),
    highRisk: extractReportMetric(text, '🔴 高风险项'),
    mediumRisk: extractReportMetric(text, '🟡 中风险项'),
  };
}

function expectedCrossDeptSourceReports() {
  return [CROSS_DEPT_REPORT_PATH, CROSS_CHAIN_REPORT_PATH]
    .filter(existsSync)
    .map(path => ({
      path: toRepoPath(path),
      sha256: sha256File(path),
    }));
}

function assertCrossDeptSourceReports(cross) {
  if (!Array.isArray(cross.sourceReports)) {
    fail('crossDept.sourceReports must record source report fingerprints');
  }
  const actualByPath = new Map(cross.sourceReports.map(item => [item.path, item]));
  for (const expected of expectedCrossDeptSourceReports()) {
    const actual = actualByPath.get(expected.path);
    if (!actual) {
      fail(`crossDept.sourceReports missing ${expected.path}`);
    }
    if (actual.sha256 !== expected.sha256) {
      fail(`crossDept.sourceReports ${expected.path} sha256 expected ${expected.sha256}, got ${actual.sha256}`);
    }
  }
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map(cell => cell.trim());
}

function looksLikeA1Header(header) {
  const text = header.join('|');
  return (
    (text.includes('业务行为（A1）编号') || text.includes('A1编号')) &&
    text.includes('业务行为（A1）') &&
    text.includes('应用系统')
  );
}

function isSeparatorRow(line) {
  return /^\|[\s\-:|]+$/.test(line.trim());
}

function countA1RowsInMappingDoc(text) {
  const lines = text.split(/\r?\n/);
  let inBbm = false;
  let count = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed.startsWith('## 业务行为（A1）')) inBbm = true;
    if (!inBbm || !trimmed.startsWith('|')) continue;

    const header = splitMarkdownRow(trimmed);
    if (!looksLikeA1Header(header)) continue;

    for (let j = i + 1; j < lines.length; j += 1) {
      const row = lines[j].trim();
      if (!row) continue;
      if (!row.startsWith('|')) {
        i = j - 1;
        break;
      }
      if (isSeparatorRow(row)) continue;

      const cells = splitMarkdownRow(row);
      if (cells.join('|') === header.join('|')) continue;
      if (['序号', '指标', '业务行为（A1）编号'].includes(cells[0])) continue;
      count += 1;
    }
  }

  return count;
}

function countSourceA1Rows() {
  return readdirSync(NORMS_PATH, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('部门-能力-流程-系统映射关系.md'))
    .reduce((sum, entry) => {
      const text = readFileSync(resolve(NORMS_PATH, entry.name), 'utf-8');
      return sum + countA1RowsInMappingDoc(text);
    }, 0);
}

const fileData = readJsonFile(DATA_PATH);

if (!Array.isArray(fileData.nodes) || fileData.nodes.length === 0) {
  fail('docs/company-sankey-data.json has no nodes');
}
if (!Array.isArray(fileData.links) || fileData.links.length === 0) {
  fail('docs/company-sankey-data.json has no links');
}
if (!fileData.stats || typeof fileData.stats.mappings !== 'number') {
  fail('docs/company-sankey-data.json has no stats.mappings');
}
if (fileData.stats.a1 !== countSourceA1Rows()) {
  fail(`docs/company-sankey-data.json stats.a1 expected ${countSourceA1Rows()} from source A1 rows, got ${fileData.stats.a1}`);
}
if (fileData.stats.a1Unmatched !== 0) {
  fail(`docs/company-sankey-data.json stats.a1Unmatched expected 0, got ${fileData.stats.a1Unmatched}`);
}
if (!fileData.crossDept) {
  fail('docs/company-sankey-data.json has no crossDept');
}
if (!Array.isArray(fileData.evidenceRefs) || !fileData.evidenceRefs.some(ref => ref.customer_acceptance_required)) {
  fail('docs/company-sankey-data.json should include customer acceptance evidence refs');
}

const cross = fileData.crossDept;
const reportCrossStats = readCrossDeptReportMetrics();
for (const [field, expected] of Object.entries(reportCrossStats)) {
  if (cross.stats?.[field] !== expected) {
    fail(`crossDept.stats.${field} expected ${expected} from 跨部门完整性检查报告.md, got ${cross.stats?.[field]}`);
  }
}
assertCrossDeptSourceReports(cross);
const expectedMinimumRisks = 2 + reportCrossStats.pendingConfirm;
if (!Array.isArray(cross.risks) || cross.risks.length < expectedMinimumRisks) {
  fail(`crossDept.risks should contain at least 工程技术部、复材车间 and ${reportCrossStats.pendingConfirm} pending items`);
}

const allowedRisks = new Set(['high', 'medium', 'low']);
for (const risk of cross.risks) {
  if (!allowedRisks.has(risk.risk)) {
    fail(`invalid risk enum: ${risk.risk}`);
  }
}

if (!existsSync(DASHBOARD_PATH)) {
  fail(`missing ${DASHBOARD_PATH}`);
}

const dashboardHtml = readFileSync(DASHBOARD_PATH, 'utf-8');
const embeddedSankey = extractEmbeddedJson(dashboardHtml, 'sankey-data');
const embeddedCross = extractEmbeddedJson(dashboardHtml, 'cross-dept-data');

const ordinaryScripts = Array.from(
  dashboardHtml.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/gi)
)
  .map(match => match[1])
  .filter(script => script.trim());

for (const [idx, script] of ordinaryScripts.entries()) {
  try {
    new Function(script);
  } catch (e) {
    fail(`ordinary script ${idx + 1} has syntax error: ${e.message}`);
  }
}

if (/type\s*:\s*['"]sankey['"]|renderSankey|公司级桑基|全公司桑基/i.test(dashboardHtml)) {
  fail('dashboard appears to contain company-level sankey rendering code');
}

const prohibitedCopy = [
  '系统最忙',
  '承载最多',
  '主用系统',
  '复材车间</b> 待建模',
  '复材车间</b> 待补充',
];

for (const phrase of prohibitedCopy) {
  if (dashboardHtml.includes(phrase)) {
    fail(`dashboard contains prohibited copy: ${phrase}`);
  }
}

for (const required of [
  'id="kpiCustomerAcceptance"',
  '客户文件承接',
  '客户要求-待承接',
  'customerAcceptance',
]) {
  if (!dashboardHtml.includes(required)) {
    fail(`dashboard missing customer file acceptance marker: ${required}`);
  }
}

if (stableJson(embeddedSankey) !== stableJson(fileData)) {
  fail('#sankey-data is not identical to docs/company-sankey-data.json');
}
if (stableJson(embeddedCross) !== stableJson(fileData.crossDept)) {
  fail('#cross-dept-data is not identical to docs/company-sankey-data.json.crossDept');
}

console.log('Dashboard data check passed.');
