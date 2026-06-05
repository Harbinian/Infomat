/**
 * 校验流程地图驾驶舱的数据快照是否与生成文件一致。
 *
 * 用法: node scripts/check-dashboard-data.mjs
 */

import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = resolve(import.meta.dirname || '.', '..');
const DATA_PATH = resolve(ROOT, 'docs', 'company-sankey-data.json');
const DASHBOARD_PATH = resolve(ROOT, 'pmo', 'procedure-management', 'dashboard.html');

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
if (!fileData.crossDept) {
  fail('docs/company-sankey-data.json has no crossDept');
}

const cross = fileData.crossDept;
if (cross.stats?.totalChecked !== 168) {
  fail(`crossDept.stats.totalChecked expected 168, got ${cross.stats?.totalChecked}`);
}
if (cross.stats?.pendingConfirm !== 6) {
  fail(`crossDept.stats.pendingConfirm expected 6, got ${cross.stats?.pendingConfirm}`);
}
if (cross.stats?.highRisk !== 1) {
  fail(`crossDept.stats.highRisk expected 1, got ${cross.stats?.highRisk}`);
}
if (!Array.isArray(cross.risks) || cross.risks.length < 8) {
  fail('crossDept.risks should contain 工程技术部、复材车间和 6 条待确认项');
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

if (stableJson(embeddedSankey) !== stableJson(fileData)) {
  fail('#sankey-data is not identical to docs/company-sankey-data.json');
}
if (stableJson(embeddedCross) !== stableJson(fileData.crossDept)) {
  fail('#cross-dept-data is not identical to docs/company-sankey-data.json.crossDept');
}

console.log('Dashboard data check passed.');
