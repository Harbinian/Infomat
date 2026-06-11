/**
 * 校验部门到域映射与组织真源一致。
 *
 * 用法: node scripts/check-dept-domain-mapping.mjs
 */

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const organizationPath = resolve(root, 'docs', 'organization', '组织架构和部门职责.md');
const contractPath = resolve(root, 'docs', 'contracts', 'dcm-bbm-contract.json');
const parserPath = resolve(root, 'scripts', 'parse-sankey-data.mjs');

function readText(path) {
  assert.ok(existsSync(path), `missing ${path}`);
  return readFileSync(path, 'utf8');
}

function readJson(path) {
  return JSON.parse(readText(path));
}

function parseOrganizationDomainMap(text) {
  const blockMatch = text.match(/```([\s\S]*?)```/);
  assert.ok(blockMatch, 'organization source must include an organization chart code block');

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

  return result;
}

function parseParserDeptDomain(text) {
  const match = text.match(/const\s+DEPT_DOMAIN\s*=\s*\{([\s\S]*?)\};/);
  assert.ok(match, 'parse-sankey-data.mjs must define DEPT_DOMAIN');

  const result = {};
  for (const entry of match[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) {
    result[entry[1]] = entry[2];
  }
  return result;
}

function assertSameDomainMap(actual, expected, label) {
  assert.deepEqual(
    Object.keys(actual).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    Object.keys(expected).sort((a, b) => a.localeCompare(b, 'zh-CN')),
    `${label} department list must match organization source`
  );

  for (const [department, domain] of Object.entries(expected)) {
    assert.equal(actual[department], domain, `${label} ${department} domain must be ${domain}`);
  }
}

const organizationMap = parseOrganizationDomainMap(readText(organizationPath));
const contract = readJson(contractPath);
const parserMap = parseParserDeptDomain(readText(parserPath));

assert.equal(Object.keys(organizationMap).length, 9, 'organization source should define 9 departments');
assert.ok(!Object.values(organizationMap).some(domain => domain.includes('直属')), 'organization domains must use 直辖, not 直属');
assertSameDomainMap(contract.departments || {}, organizationMap, 'dcm-bbm contract');
assertSameDomainMap(parserMap, organizationMap, 'parse-sankey-data DEPT_DOMAIN');

console.log(`Department domain mapping check passed: ${Object.keys(organizationMap).length} departments`);
