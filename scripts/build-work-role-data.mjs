#!/usr/bin/env node

/**
 * Build the read-only work-role snapshot consumed by document structured output.
 *
 * Inputs:
 * - docs/organization/工作角色目录与岗位映射.md (HR-owned truth)
 * - docs/organization/花名册.md (read-only department/position validation)
 *
 * Output:
 * - docs/work-role-data.json
 *
 * The output is replaced only after all parsing and validation succeeds. This
 * script never writes the roster, process baselines, databases, or applications.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_SOURCE_PATH = resolve(REPO_ROOT, 'docs/organization/工作角色目录与岗位映射.md');
const DEFAULT_ROSTER_PATH = resolve(REPO_ROOT, 'docs/organization/花名册.md');
const DEFAULT_OUTPUT_PATH = resolve(REPO_ROOT, 'docs/work-role-data.json');
const RECORD_STATUSES = new Set(['draft', 'active', 'retired']);

const TABLES = {
  roles: {
    heading: '正式工作角色目录',
    headers: ['工作角色编码', '工作角色名称', '定义', 'status', '生效开始日期', '生效结束日期', '制定依据'],
  },
  positionMappings: {
    heading: '工作角色与岗位映射',
    headers: ['工作角色编码', '部门', '岗位', 'status', '生效开始日期', '生效结束日期', '确认依据'],
  },
  aliases: {
    heading: '原文角色别名',
    headers: ['原文角色文本', '工作角色编码', '适用部门', 'status', '确认依据'],
  },
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, '\n');
}

function splitMarkdownRow(line) {
  const trimmed = line.trim();
  if (!trimmed.startsWith('|')) {
    throw new Error(`Expected Markdown table row, received: ${line}`);
  }

  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let current = '';
  let escaping = false;

  for (const character of body) {
    if (escaping) {
      current += character;
      escaping = false;
      continue;
    }
    if (character === '\\') {
      escaping = true;
      continue;
    }
    if (character === '|') {
      cells.push(normalizeText(current));
      current = '';
      continue;
    }
    current += character;
  }
  if (escaping) current += '\\';
  cells.push(normalizeText(current));
  return cells;
}

function isSeparatorRow(cells) {
  return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}

function parseTableAt(lines, headerIndex, expectedHeaders, label) {
  const headers = splitMarkdownRow(lines[headerIndex]);
  if (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])) {
    throw new Error(`${label} headers must be: ${expectedHeaders.join(' | ')}`);
  }

  let separatorIndex = headerIndex + 1;
  while (separatorIndex < lines.length && !lines[separatorIndex].trim()) separatorIndex += 1;
  if (separatorIndex >= lines.length || !lines[separatorIndex].trim().startsWith('|')) {
    throw new Error(`${label} is missing its Markdown separator row`);
  }
  const separators = splitMarkdownRow(lines[separatorIndex]);
  if (separators.length !== headers.length || !isSeparatorRow(separators)) {
    throw new Error(`${label} has an invalid Markdown separator row`);
  }

  const rows = [];
  for (let index = separatorIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) break;
    if (!line.startsWith('|')) break;
    const cells = splitMarkdownRow(lines[index]);
    if (cells.length !== headers.length) {
      throw new Error(`${label} row ${index + 1} has ${cells.length} cells; expected ${headers.length}`);
    }
    const row = {};
    headers.forEach((header, cellIndex) => {
      row[header] = cells[cellIndex];
    });
    rows.push({ row, lineNumber: index + 1 });
  }
  return rows;
}

function findSectionTable(markdown, { heading, headers }) {
  const lines = normalizeLineEndings(markdown).split('\n');
  const headingPattern = new RegExp(`^##\\s+(?:\\d+\\.\\s*)?${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
  const headingIndex = lines.findIndex(line => headingPattern.test(line.trim()));
  if (headingIndex < 0) throw new Error(`Missing section: ${heading}`);

  let headerIndex = headingIndex + 1;
  while (headerIndex < lines.length && !lines[headerIndex].trim().startsWith('|')) {
    if (/^##\s+/.test(lines[headerIndex].trim())) {
      throw new Error(`Section ${heading} is missing its table`);
    }
    headerIndex += 1;
  }
  if (headerIndex >= lines.length) throw new Error(`Section ${heading} is missing its table`);
  return parseTableAt(lines, headerIndex, headers, heading);
}

function requireCell(value, tableName, lineNumber, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) throw new Error(`${tableName} line ${lineNumber}: ${fieldName} must not be empty`);
  return normalized;
}

function validateStatus(value, tableName, lineNumber) {
  const status = requireCell(value, tableName, lineNumber, 'status');
  if (!RECORD_STATUSES.has(status)) {
    throw new Error(`${tableName} line ${lineNumber}: status must be draft, active, or retired`);
  }
  return status;
}

function validateDate(value, tableName, lineNumber, fieldName) {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`${tableName} line ${lineNumber}: ${fieldName} must use YYYY-MM-DD`);
  }
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`${tableName} line ${lineNumber}: ${fieldName} is not a valid calendar date`);
  }
  return normalized;
}

function validateEffectivePeriod(row, tableName, lineNumber, status) {
  const effectiveFrom = validateDate(row['生效开始日期'], tableName, lineNumber, '生效开始日期');
  const effectiveTo = validateDate(row['生效结束日期'], tableName, lineNumber, '生效结束日期');
  if ((status === 'active' || status === 'retired') && !effectiveFrom) {
    throw new Error(`${tableName} line ${lineNumber}: ${status} record requires 生效开始日期`);
  }
  if (status === 'retired' && !effectiveTo) {
    throw new Error(`${tableName} line ${lineNumber}: retired record requires 生效结束日期`);
  }
  if (effectiveFrom && effectiveTo && effectiveTo < effectiveFrom) {
    throw new Error(`${tableName} line ${lineNumber}: 生效结束日期 must not precede 生效开始日期`);
  }
  return { effectiveFrom, effectiveTo };
}

function assertUnique(seen, key, label) {
  if (seen.has(key)) throw new Error(`Duplicate ${label}: ${key.replaceAll('\u0000', ' / ')}`);
  seen.add(key);
}

export function parseRoster(markdown) {
  const lines = normalizeLineEndings(markdown).split('\n');
  let rosterRows = null;
  let rosterHeaders = null;

  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].trim().startsWith('|')) continue;
    const headers = splitMarkdownRow(lines[index]);
    const positionHeader = headers.includes('职务') ? '职务' : headers.includes('岗位') ? '岗位' : null;
    if (!headers.includes('部门') || !positionHeader) continue;
    rosterHeaders = { headers, positionHeader };
    rosterRows = parseTableAt(lines, index, headers, '花名册');
    break;
  }

  if (!rosterRows || !rosterHeaders) {
    throw new Error('Roster must contain a Markdown table with 部门 and 职务/岗位 columns');
  }

  const departments = new Set();
  const positions = new Set();
  for (const { row } of rosterRows) {
    const departmentName = normalizeText(row['部门']);
    const positionName = normalizeText(row[rosterHeaders.positionHeader]);
    if (!departmentName || !positionName) continue;
    departments.add(departmentName);
    positions.add(`${departmentName}\u0000${positionName}`);
  }

  if (positions.size === 0) throw new Error('Roster does not contain any usable department/position pairs');
  return { departments, positions };
}

export function parseWorkRoleSource(markdown, roster) {
  const roleRows = findSectionTable(markdown, TABLES.roles);
  const mappingRows = findSectionTable(markdown, TABLES.positionMappings);
  const aliasRows = findSectionTable(markdown, TABLES.aliases);

  const roleCodes = new Set();
  const roleNames = new Set();
  const rolesByCode = new Map();
  const workRoles = roleRows.map(({ row, lineNumber }, roleIndex) => {
    const workRoleCode = requireCell(row['工作角色编码'], TABLES.roles.heading, lineNumber, '工作角色编码');
    const expectedCode = `WR-${String(roleIndex + 1).padStart(4, '0')}`;
    if (!/^WR-\d{4}$/.test(workRoleCode)) {
      throw new Error(`${TABLES.roles.heading} line ${lineNumber}: 工作角色编码 must use WR-0001 format`);
    }
    if (workRoleCode !== expectedCode) {
      throw new Error(`${TABLES.roles.heading} line ${lineNumber}: 工作角色编码 must be sequential; expected ${expectedCode}`);
    }
    const workRoleName = requireCell(row['工作角色名称'], TABLES.roles.heading, lineNumber, '工作角色名称');
    const definition = requireCell(row['定义'], TABLES.roles.heading, lineNumber, '定义');
    const status = validateStatus(row.status, TABLES.roles.heading, lineNumber);
    const { effectiveFrom, effectiveTo } = validateEffectivePeriod(row, TABLES.roles.heading, lineNumber, status);
    const basis = requireCell(row['制定依据'], TABLES.roles.heading, lineNumber, '制定依据');
    assertUnique(roleCodes, workRoleCode, 'work role code');
    assertUnique(roleNames, workRoleName, 'work role name');
    const role = {
      work_role_code: workRoleCode,
      work_role_name: workRoleName,
      definition,
      status,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      basis,
    };
    rolesByCode.set(workRoleCode, role);
    return role;
  });

  const mappingKeys = new Set();
  const workRolePositionMappings = mappingRows.map(({ row, lineNumber }) => {
    const workRoleCode = requireCell(row['工作角色编码'], TABLES.positionMappings.heading, lineNumber, '工作角色编码');
    const departmentName = requireCell(row['部门'], TABLES.positionMappings.heading, lineNumber, '部门');
    const positionName = requireCell(row['岗位'], TABLES.positionMappings.heading, lineNumber, '岗位');
    const status = validateStatus(row.status, TABLES.positionMappings.heading, lineNumber);
    const { effectiveFrom, effectiveTo } = validateEffectivePeriod(row, TABLES.positionMappings.heading, lineNumber, status);
    const confirmationBasis = normalizeText(row['确认依据']);
    if (status !== 'draft' && !confirmationBasis) {
      throw new Error(`${TABLES.positionMappings.heading} line ${lineNumber}: ${status} record requires 确认依据`);
    }
    const role = rolesByCode.get(workRoleCode);
    if (!role) throw new Error(`${TABLES.positionMappings.heading} line ${lineNumber}: unknown work role code ${workRoleCode}`);
    if (status !== 'draft' && !roster.positions.has(`${departmentName}\u0000${positionName}`)) {
      throw new Error(`${TABLES.positionMappings.heading} line ${lineNumber}: roster has no exact position ${departmentName} / ${positionName}`);
    }
    if (status === 'active' && role.status !== 'active') {
      throw new Error(`${TABLES.positionMappings.heading} line ${lineNumber}: active mapping cannot reference non-active role ${workRoleCode}`);
    }
    assertUnique(mappingKeys, `${workRoleCode}\u0000${departmentName}\u0000${positionName}`, 'work role position mapping');
    return {
      work_role_code: workRoleCode,
      department_name: departmentName,
      position_name: positionName,
      status,
      effective_from: effectiveFrom,
      effective_to: effectiveTo,
      confirmation_basis: confirmationBasis || null,
    };
  });

  const aliasKeys = new Set();
  const workRoleAliases = aliasRows.map(({ row, lineNumber }) => {
    const sourceRoleText = requireCell(row['原文角色文本'], TABLES.aliases.heading, lineNumber, '原文角色文本');
    const workRoleCode = requireCell(row['工作角色编码'], TABLES.aliases.heading, lineNumber, '工作角色编码');
    const departmentName = requireCell(row['适用部门'], TABLES.aliases.heading, lineNumber, '适用部门');
    const status = validateStatus(row.status, TABLES.aliases.heading, lineNumber);
    const confirmationBasis = normalizeText(row['确认依据']);
    if (status !== 'draft' && !confirmationBasis) {
      throw new Error(`${TABLES.aliases.heading} line ${lineNumber}: ${status} record requires 确认依据`);
    }
    const role = rolesByCode.get(workRoleCode);
    if (!role) throw new Error(`${TABLES.aliases.heading} line ${lineNumber}: unknown work role code ${workRoleCode}`);
    if (status !== 'draft' && !roster.departments.has(departmentName)) {
      throw new Error(`${TABLES.aliases.heading} line ${lineNumber}: roster has no department ${departmentName}`);
    }
    if (status === 'active' && role.status !== 'active') {
      throw new Error(`${TABLES.aliases.heading} line ${lineNumber}: active alias cannot reference non-active role ${workRoleCode}`);
    }
    assertUnique(aliasKeys, `${sourceRoleText}\u0000${departmentName}`, 'department-scoped work role alias');
    return {
      source_role_text: sourceRoleText,
      work_role_code: workRoleCode,
      department_name: departmentName,
      status,
      confirmation_basis: confirmationBasis || null,
    };
  });

  return { workRoles, workRolePositionMappings, workRoleAliases };
}

export function computeSourceHash(workRoleSource, rosterSource) {
  return createHash('sha256')
    .update('work-role-source\u0000')
    .update(normalizeLineEndings(workRoleSource))
    .update('\u0000roster-source\u0000')
    .update(normalizeLineEndings(rosterSource))
    .digest('hex');
}

function writeJsonAtomically(outputPath, payload) {
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    renameSync(temporaryPath, outputPath);
  } finally {
    if (existsSync(temporaryPath)) rmSync(temporaryPath, { force: true });
  }
}

export function buildWorkRoleData({
  sourcePath = DEFAULT_SOURCE_PATH,
  rosterPath = DEFAULT_ROSTER_PATH,
  outputPath = DEFAULT_OUTPUT_PATH,
  generatedAt = new Date().toISOString(),
} = {}) {
  const workRoleSource = readFileSync(sourcePath, 'utf8');
  const rosterSource = readFileSync(rosterPath, 'utf8');
  const roster = parseRoster(rosterSource);
  const parsed = parseWorkRoleSource(workRoleSource, roster);
  const generatedDate = new Date(generatedAt);
  if (Number.isNaN(generatedDate.getTime())) throw new Error(`Invalid generatedAt value: ${generatedAt}`);

  const payload = {
    schemaVersion: 'work-role-data-v1',
    generatedAt: generatedDate.toISOString(),
    sourceHash: computeSourceHash(workRoleSource, rosterSource),
    workRoles: parsed.workRoles,
    workRolePositionMappings: parsed.workRolePositionMappings,
    workRoleAliases: parsed.workRoleAliases,
  };

  writeJsonAtomically(outputPath, payload);
  return payload;
}

function parseCliArgs(argv) {
  const options = {};
  const keys = new Map([
    ['--source', 'sourcePath'],
    ['--roster', 'rosterPath'],
    ['--out', 'outputPath'],
    ['--generated-at', 'generatedAt'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const optionName = keys.get(argv[index]);
    if (!optionName) throw new Error(`Unknown argument: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argv[index]}`);
    options[optionName] = optionName === 'generatedAt' ? value : resolve(value);
    index += 1;
  }
  return options;
}

const isCli = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isCli) {
  try {
    const options = parseCliArgs(process.argv.slice(2));
    const payload = buildWorkRoleData(options);
    console.log(
      `Built ${options.outputPath || DEFAULT_OUTPUT_PATH}: ${payload.workRoles.length} roles, ` +
        `${payload.workRolePositionMappings.length} position mappings, ${payload.workRoleAliases.length} aliases`,
    );
  } catch (error) {
    console.error(`[build-work-role-data] ${error.message}`);
    process.exitCode = 1;
  }
}
