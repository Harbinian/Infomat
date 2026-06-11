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

assert.ok(
  manifestText.includes('不能直接等同工程技术部真源'),
  'engineering source manifest must keep candidate-source caution wording'
);
assert.ok(
  attributionChecklistText.includes('工程技术部候选源归属确认检查表'),
  'engineering source attribution checklist must exist'
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
  assert.equal(row.cells[1], '缺失', `${row.path} must be documented as 缺失`);
  assert.ok(!existsSync(resolve(root, row.path)), `${row.path} should still be absent before engineering DCM/BBM is created`);
}
assert.equal(canonicalRows.length, 4, 'engineering canonical gap table should list 4 missing items');

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

console.log('Engineering source manifest check passed: canonical gap plus 47 candidate files');
