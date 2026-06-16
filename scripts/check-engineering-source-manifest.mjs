/**
 * 校验工程技术部源文件清单初版仍与仓库现状一致。
 *
 * 用法: node scripts/check-engineering-source-manifest.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestPath = resolve(root, 'docs', 'reports', '2026-06-11-engineering-source-manifest.md');
const attributionChecklistPath = resolve(root, 'docs', 'reports', '2026-06-11-engineering-source-attribution-checklist.md');
const triageReportPath = resolve(root, 'docs', 'reports', '2026-06-10-full-repo-remediation-triage.md');
const crossDeptIdentificationPath = resolve(root, 'docs', 'norms', '流程治理', '跨部门流程识别报告.md');

const indexedSections = [
  {
    heading: '科技创新部一图三表与信息流图',
    baseDir: 'docs/外部参考/集成制造/科技创新部一图三表汇总及信息流图',
    expectedCount: 41,
  },
  {
    heading: '数字工程部一图三表与信息流图',
    baseDir: 'docs/外部参考/集成制造/数字工程部一图三表汇总及信息流图',
    expectedCount: 5,
  },
  {
    heading: '集成研发候选',
    baseDir: 'docs/外部参考/集成研发/集成研发业务域信息流图20251030',
    expectedCount: 1,
  },
];

function readText(path) {
  assert.ok(existsSync(path), `missing ${path}`);
  return readFileSync(path, 'utf8');
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map(cell => cell.trim());
}

function extractSection(text, heading) {
  const re = new RegExp(`^#{2,3}\\s+(?:\\d+\\.\\s+)?${heading}\\s*$([\\s\\S]*?)(?=^#{2,3}\\s+|(?![\\s\\S]))`, 'm');
  const match = text.match(re);
  assert.ok(match, `manifest must include section ${heading}`);
  return match[1];
}

function countFiles(dirPath) {
  let count = 0;
  for (const entry of readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) count += countFiles(fullPath);
    if (entry.isFile()) count += 1;
  }
  return count;
}

function parseBacktickedPathRows(sectionText) {
  return sectionText
    .split(/\r?\n/)
    .filter(line => line.trim().startsWith('|') && line.includes('`'))
    .map(line => {
      const cells = splitMarkdownRow(line);
      const pathMatch = cells[0]?.match(/`([^`]+)`/);
      return pathMatch ? { path: pathMatch[1], cells } : null;
    })
    .filter(Boolean);
}

const manifestText = readText(manifestPath);
const attributionChecklistText = readText(attributionChecklistPath);
const triageReportText = readText(triageReportPath);
const crossDeptIdentificationText = readText(crossDeptIdentificationPath);

assert.ok(
  manifestText.includes('不能直接等同工程技术部真源'),
  'engineering source manifest must keep candidate-source caution wording'
);
assert.ok(
  manifestText.includes('沈飞民机侧部门') && attributionChecklistText.includes('沈飞民机侧部门'),
  'engineering source docs must state 科技创新部 and 数字工程部 are Shenyang Aircraft Civil Aviation-side departments'
);
assert.ok(
  manifestText.includes('集成研发业务域') && attributionChecklistText.includes('集成研发业务域'),
  'engineering source docs must state 集成研发 is a business domain'
);
assert.ok(
  attributionChecklistText.includes('工程技术部候选源承接确认检查表'),
  'engineering source attribution checklist must exist'
);
assert.ok(
  !triageReportText.includes('工程技术部真源归属') && !triageReportText.includes('源文件归属确认'),
  'remediation triage should use acceptance confirmation wording, not ownership wording, for external engineering source candidates'
);
assert.ok(
  triageReportText.includes('工程技术部真源缺口与候选承接确认') &&
    triageReportText.includes('沈飞民机侧科技创新部') &&
    triageReportText.includes('沈飞民机侧数字工程部') &&
    triageReportText.includes('集成研发业务域'),
  'remediation triage should keep the external-department and business-domain acceptance sequence explicit'
);
assert.ok(
  crossDeptIdentificationText.includes('| **科技创新部** | 沈飞民机 |') &&
    crossDeptIdentificationText.includes('| **数字工程部** | 沈飞民机 |') &&
    crossDeptIdentificationText.includes('| **科创部** | 沈飞民机 | 即科技创新部的简称，非独立部门 |') &&
    crossDeptIdentificationText.includes('昌兴无此部门'),
  'cross-department identification report should classify 科技创新部/数字工程部 as Shenyang Aircraft Civil Aviation-side departments'
);
assert.ok(
  crossDeptIdentificationText.includes('由沈飞民机科技创新部发文，昌兴作为生产厂执行'),
  'cross-department identification report should preserve source-evidence wording for Shenyang Aircraft Civil Aviation technology documents'
);
for (const requiredGroup of ['科技创新部', '数字工程部', '集成研发']) {
  assert.ok(
    attributionChecklistText.includes(requiredGroup),
    `engineering source attribution checklist must cover ${requiredGroup}`
  );
}

const canonicalSection = extractSection(manifestText, 'Canonical 交付物缺口');
const canonicalRows = parseBacktickedPathRows(canonicalSection);
for (const row of canonicalRows) {
  const fullPath = resolve(root, row.path);
  if (row.path === 'docs/norms/工程技术部业务资料/') {
    assert.equal(row.cells[1], '已建立', `${row.path} must be documented as 已建立`);
    assert.ok(existsSync(fullPath), `${row.path} must exist after engineering source materials are added`);
    assert.equal(countFiles(fullPath), 536, `${row.path} file count must match the audited source directory`);
    continue;
  }
  if (row.path === 'docs/norms/工程技术部部门-能力-流程-系统映射关系.md') {
    assert.equal(row.cells[1], '已建立', `${row.path} must be documented as 已建立`);
    assert.ok(existsSync(fullPath), `${row.path} must exist after engineering DCM is created`);
    const mapping = readText(fullPath);
    assert.match(mapping, /保守版/, `${row.path} must declare conservative status`);
    assert.match(mapping, /应用承接待工程技术部确认/, `${row.path} must keep application landing as pending confirmation`);
    continue;
  }
  if (row.path === 'docs/norms/工程技术部部门能力流程系统桑基图.html') {
    assert.equal(row.cells[1], '模型预览已建立', `${row.path} must be documented as 模型预览已建立`);
    assert.ok(existsSync(fullPath), `${row.path} preview page must exist`);
    const html = readText(fullPath);
    assert.match(html, /模型预览/, `${row.path} must show preview status`);
    assert.match(html, /未经过映射复核，不作为正式结论/, `${row.path} must say unrevised maps are not final`);
    continue;
  }
  assert.equal(row.cells[1], '缺失', `${row.path} must be documented as 缺失`);
  assert.ok(!existsSync(fullPath), `${row.path} should still be absent until engineering MDM requirements are created`);
}
assert.equal(canonicalRows.length, 4, 'engineering source status table should list source directory, conservative DCM, missing MDM item, and preview Sankey');

const groupSection = extractSection(manifestText, '候选资料分组');
const groupRows = parseBacktickedPathRows(groupSection);
assert.ok(groupRows.length >= indexedSections.length, 'candidate group table must list indexed candidate groups');
for (const row of groupRows) {
  assert.equal(row.cells[3], '待复核', `${row.path} must remain 待复核`);
  const fullPath = resolve(root, row.path);
  assert.ok(existsSync(fullPath), `${row.path} must exist`);
  if (statSync(fullPath).isDirectory()) {
    const expected = Number(row.cells[1]);
    assert.equal(countFiles(fullPath), expected, `${row.path} file count must match manifest`);
  } else {
    assert.equal(row.cells[1], '1', `${row.path} file count must be 1`);
  }
}

for (const section of indexedSections) {
  const sectionText = extractSection(manifestText, section.heading);
  const rows = parseBacktickedPathRows(sectionText);
  assert.equal(rows.length, section.expectedCount, `${section.heading} index row count must match manifest summary`);
  for (const row of rows) {
    assert.equal(row.cells[2], '待复核', `${row.path} must remain 待复核`);
    assert.ok(
      existsSync(resolve(root, section.baseDir, row.path)),
      `${section.baseDir}/${row.path} must exist`
    );
  }
}

console.log('Engineering source manifest check passed: source directory, conservative DCM, preview Sankey, 1 canonical gap, and 47 candidate files');
