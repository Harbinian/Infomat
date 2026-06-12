#!/usr/bin/env node

/**
 * Conservatively harden A1 cross-department input/output fields.
 *
 * This script does not infer process facts. It only removes department names from
 * `输入来源部门` / `输出目标部门` when the same A1 row does not show controlled-transfer
 * evidence for that department, and preserves the removed value in `核验提醒`.
 */

import { readFileSync, readdirSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname || '.', '..');
const NORMS = join(ROOT, 'docs', 'norms');
const ORG_SOURCE = join(ROOT, 'docs', 'organization', '组织架构和部门职责.md');

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
  '核对',
  '校对',
];

const BASIS_WORDS = ['依据', '根据', '基于', '参照', '按'];

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function parseOrganizationDepartments() {
  const text = readFileSync(ORG_SOURCE, 'utf8');
  const departments = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/[├└]──\s*(.+)$/);
    if (!match) continue;
    const name = match[1].replace(/（.*?）/g, '').trim();
    if (!name || ['经营副总', '生产副总'].includes(name)) continue;
    departments.add(name);
  }
  return departments;
}

function splitMarkdownRow(line) {
  const cells = line.trim().split('|');
  if (cells.length && cells[0].trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop();
  return cells.map((cell) => cell.trim());
}

function isSeparatorRow(line) {
  return /^\|[\s\-:|]+$/.test(String(line || '').trim());
}

function joinMarkdownRow(cells) {
  return `| ${cells.map((cell) => String(cell ?? '').trim()).join(' | ')} |`;
}

function findIndex(headers, names) {
  const expected = Array.isArray(names) ? names : [names];
  for (const name of expected) {
    const exact = headers.findIndex((header) => header === name);
    if (exact >= 0) return exact;
  }
  for (const name of expected) {
    const fuzzy = headers.findIndex((header) => header.includes(name));
    if (fuzzy >= 0) return fuzzy;
  }
  return -1;
}

function isBlank(value) {
  const text = String(value ?? '').trim();
  return !text || /^[-—–]+$/.test(text) || ['无', '不适用', 'NA', 'N/A'].includes(text.toUpperCase());
}

function splitDeptList(value) {
  if (isBlank(value)) return [];
  return String(value)
    .split(/[、，,；;\/]/)
    .map((item) => item.trim())
    .filter((item) => item && !isBlank(item));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function looksLikeA1Header(headers) {
  const text = headers.join('|');
  return (
    (text.includes('业务行为（A1）编号') || text.includes('A1编号')) &&
    text.includes('业务行为（A1）') &&
    text.includes('输入来源部门') &&
    text.includes('输出目标部门')
  );
}

function valueAt(cells, headers, names) {
  const idx = findIndex(headers, names);
  return idx >= 0 && idx < cells.length ? cells[idx] : '';
}

function appendNote(existing, note) {
  const text = String(existing ?? '').trim();
  if (text.includes(note)) return text;
  if (!text || /^[-—–]+$/.test(text)) return note;
  return `${text}；${note}`;
}

function isBasisOnlyPhrase(part, dept) {
  const deptPattern = escapeRegExp(dept);
  return BASIS_WORDS.some((word) => new RegExp(`${word}.{0,12}${deptPattern}`).test(part));
}

function hasTransferWord(part) {
  return TRANSFER_WORDS.some((word) => part.includes(word));
}

function contextPartsForField(headers, cells, fieldName) {
  const common = [
    valueAt(cells, headers, ['业务行为（A1）']),
    valueAt(cells, headers, ['数据输入']),
    valueAt(cells, headers, ['数据输出']),
    valueAt(cells, headers, ['执行角色依据']),
    valueAt(cells, headers, ['触发情景依据']),
    valueAt(cells, headers, ['制度依据']),
    valueAt(cells, headers, ['核验提醒']),
    valueAt(cells, headers, ['备注']),
  ];
  if (fieldName === '输入来源部门') {
    common.push(valueAt(cells, headers, ['触发情景']));
  }
  if (fieldName === '输出目标部门') {
    common.push(valueAt(cells, headers, ['验收标准依据']));
  }
  return common.filter(Boolean);
}

function hasControlledTransferEvidence(dept, headers, cells, fieldName, validDepartments) {
  if (!validDepartments.has(dept)) return false;
  const deptPattern = escapeRegExp(dept);
  const parts = contextPartsForField(headers, cells, fieldName);

  return parts.some((part) => {
    const text = String(part || '');
    if (!text.includes(dept)) return false;
    if (!hasTransferWord(text)) return false;
    if (isBasisOnlyPhrase(text, dept)) return false;
    if (new RegExp(`(审批|审核|批准|会签|归档|备案).{0,10}${deptPattern}|${deptPattern}.{0,10}(审批|审核|批准|会签|归档|备案)`).test(text)) {
      return false;
    }
    return true;
  });
}

function hardenCells(headers, cells, validDepartments) {
  const inputIdx = findIndex(headers, ['输入来源部门']);
  const outputIdx = findIndex(headers, ['输出目标部门']);
  const reminderIdx = findIndex(headers, ['核验提醒']);
  const remarkIdx = findIndex(headers, ['备注']);
  if (inputIdx < 0 || outputIdx < 0 || reminderIdx < 0) return { cells, changed: false, removed: [] };

  const next = [...cells];
  while (next.length < headers.length) next.push('');
  const removed = [];

  for (const [fieldName, idx] of [['输入来源部门', inputIdx], ['输出目标部门', outputIdx]]) {
    const original = next[idx] || '';
    const depts = splitDeptList(original);
    if (!depts.length) continue;

    const kept = [];
    const dropped = [];
    for (const dept of depts) {
      if (hasControlledTransferEvidence(dept, headers, next, fieldName, validDepartments)) {
        kept.push(dept);
      } else {
        dropped.push(dept);
      }
    }

    if (dropped.length) {
      next[idx] = kept.length ? kept.join('、') : '—';
      const note = `原${fieldName}：${dropped.join('、')}，未见受控传递证据，待补`;
      next[reminderIdx] = appendNote(next[reminderIdx], note);
      if (remarkIdx >= 0) {
        next[remarkIdx] = appendNote(next[remarkIdx], '跨部门输入/输出字段已按受控传递证据口径退回核验');
      }
      removed.push({ fieldName, dropped, kept });
    }
  }

  return { cells: next, changed: removed.length > 0, removed };
}

function hardenFile(file, validDepartments) {
  const before = readFileSync(file, 'utf8');
  const lines = before.split(/\r?\n/);
  const changes = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim().startsWith('|')) continue;
    const headers = splitMarkdownRow(line);
    if (!looksLikeA1Header(headers)) continue;

    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const rowLine = lines[j];
      const trimmed = rowLine.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith('|')) break;
      if (isSeparatorRow(trimmed)) continue;

      const cells = splitMarkdownRow(rowLine);
      if (!cells.length || cells[0] === headers[0]) continue;
      const result = hardenCells(headers, cells, validDepartments);
      if (result.changed) {
        lines[j] = joinMarkdownRow(result.cells);
        changes.push({ line: j + 1, a1: result.cells[0], removed: result.removed });
      }
    }
    i = j - 1;
  }

  const after = lines.join('\n');
  return { file, before, after, changes };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const validDepartments = parseOrganizationDepartments();
  const files = readdirSync(NORMS)
    .filter((name) => name.endsWith('部门-能力-流程-系统映射关系.md'))
    .map((name) => join(NORMS, name));

  const results = files.map((file) => hardenFile(file, validDepartments));
  const changed = results.filter((result) => result.after !== result.before);
  const rowChanges = results.flatMap((result) => result.changes.map((change) => ({ file: result.file, ...change })));

  if (!args.dryRun) {
    for (const result of changed) {
      writeFileSync(result.file, result.after, 'utf8');
    }
  }

  console.log(JSON.stringify({
    mode: args.dryRun ? 'dry-run' : 'write',
    changedFiles: changed.length,
    changedRows: rowChanges.length,
    sample: rowChanges.slice(0, 12).map((row) => ({
      file: row.file.replace(`${ROOT}\\`, '').replace(/\\/g, '/'),
      line: row.line,
      a1: row.a1,
      removed: row.removed,
    })),
  }, null, 2));
}

main();
