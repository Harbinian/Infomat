/**
 * 校验部门流程真源清单与 DCM/BBM 合同、docs/norms canonical 三件套一致。
 *
 * 用法: node scripts/check-norms-source-manifest.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contractPath = resolve(root, 'docs', 'contracts', 'dcm-bbm-contract.json');
const normsSourceManifestPath = resolve(root, 'docs', 'reports', '2026-06-11-norms-source-manifest.md');
const engineeringManifestPath = resolve(root, 'docs', 'reports', '2026-06-11-engineering-source-manifest.md');

function readText(path) {
  assert.ok(existsSync(path), `missing ${path}`);
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  try {
    return JSON.parse(readText(path));
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells[0]?.trim() === '') cells.shift();
  if (cells[cells.length - 1]?.trim() === '') cells.pop();
  return cells.map(cell => cell.trim());
}

function parseManifestDepartmentRows(text) {
  const rows = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim().startsWith('|')) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < 6 || cells[0] === '部门' || /^-+$/.test(cells[0])) continue;
    rows.set(cells[0], {
      department: cells[0],
      domain: cells[1],
      mapping: cells[2],
      mdm: cells[3],
      html: cells[4],
      status: cells[5],
      raw: cells
    });
  }
  return rows;
}

function canonicalDeliverablesFor(department, suffixes) {
  return {
    mapping: `${department}${suffixes[0]}`,
    mdm: `${department}${suffixes[1]}`,
    html: `${department}${suffixes[2]}`
  };
}

function statusFor(path) {
  return existsSync(path) ? '已有' : '缺失';
}

const contract = readJson(contractPath);
const departments = Object.keys(contract.departments || {});
const suffixes = contract.deliverables?.canonicalSuffixes || [];

assert.equal(suffixes.length, 3, 'contract must define three canonical suffixes');
assert.ok(departments.length > 0, 'contract must define departments');

const normsDir = resolve(root, contract.paths?.normsDir || 'docs/norms');
assert.ok(existsSync(normsDir), `missing norms dir ${normsDir}`);

const manifestText = readText(normsSourceManifestPath);
const manifestRows = parseManifestDepartmentRows(manifestText);

for (const department of departments) {
  const row = manifestRows.get(department);
  assert.ok(row, `norms source manifest must list ${department}`);
  assert.equal(row.domain, contract.departments[department], `${department} domain must match contract`);

  const deliverables = canonicalDeliverablesFor(department, suffixes);
  const actual = {
    mapping: statusFor(resolve(normsDir, deliverables.mapping)),
    mdm: statusFor(resolve(normsDir, deliverables.mdm)),
    html: statusFor(resolve(normsDir, deliverables.html))
  };

  assert.equal(row.mapping, actual.mapping, `${department} mapping status must match filesystem`);
  assert.equal(row.mdm, actual.mdm, `${department} MDM status must match filesystem`);
  assert.equal(row.html, actual.html, `${department} HTML status must match filesystem`);

  const allPresent = actual.mapping === '已有' && actual.mdm === '已有' && actual.html === '已有';
  assert.equal(row.status, allPresent ? '覆盖' : '缺口', `${department} manifest status must match canonical deliverables`);
}

const knownGapDepartments = [...manifestRows.values()]
  .filter(row => row.status === '缺口')
  .map(row => row.department);

assert.deepEqual(
  knownGapDepartments,
  [],
  `known canonical gap departments should be empty, got ${knownGapDepartments.join(', ') || 'none'}`
);
assert.ok(
  existsSync(engineeringManifestPath),
  'engineering source manifest must remain available for engineering candidate-source review'
);

const canonicalNamePattern = new RegExp(
  `^(.+?)(${suffixes.map(suffix => suffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`
);
const canonicalFiles = readdirSync(normsDir, { withFileTypes: true })
  .filter(entry => entry.isFile())
  .map(entry => basename(entry.name))
  .filter(name => canonicalNamePattern.test(name));

for (const file of canonicalFiles) {
  const department = file.replace(canonicalNamePattern, '$1');
  assert.ok(
    departments.includes(department),
    `${file} uses department ${department}, which is not listed in contract departments`
  );
}

assert.ok(
  manifestText.includes('docs/reports/2026-06-11-engineering-source-manifest.md'),
  'norms source manifest must link the engineering source manifest'
);

console.log(`Norms source manifest check passed: ${departments.length} departments, known gaps ${knownGapDepartments.length}`);
