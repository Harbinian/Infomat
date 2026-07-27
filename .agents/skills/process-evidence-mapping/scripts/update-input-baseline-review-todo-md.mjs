#!/usr/bin/env node
/**
 * Update the human-facing input baseline review todo markdown.
 *
 * The markdown is an unresolved-item panel, not the long-term record.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  TODO_TYPES,
  escapeMarkdownCell,
  mappingCovers,
  parseArgs,
  readJson,
  requireArg,
  shorten,
} from './review-item-utils.mjs';

const HEADERS = ['编号', '部门', '来源文件/条款', '问题类型', '问题内容', '当前映射位置', '建议动作', '处理状态', '负责人/确认对象'];
const STATUS_CORRUPTION_RE = /当前已确认流程映射|确认是否|补充到|回到原文|对照制度|核验原文|系统室|培训工作/;
const OWNER_CORRUPTION_RE = /^(待处理|处理中|已处理|暂缓)$/;
const TYPE_ORDER = new Map(TODO_TYPES.map((type, index) => [type, index + 1]));

function splitMarkdownRow(line) {
  const text = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const cells = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '\\' && next === '|') {
      cell += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(cell.trim());
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

function parseExistingRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!/^\| (?:IBR|DSO)-/.test(line)) continue;
    const cells = splitMarkdownRow(line);
    if (cells.length < HEADERS.length) continue;
    const status = cells[7] || '';
    const owner = cells[8] || '';
    rows.set(cells[0], {
      status: STATUS_CORRUPTION_RE.test(status) ? '' : status,
      owner: STATUS_CORRUPTION_RE.test(owner) || OWNER_CORRUPTION_RE.test(owner) ? '' : owner,
    });
  }
  return rows;
}

function unresolvedItems(items, mappingText) {
  const byKey = new Map();
  for (const sourceItem of items) {
    if (!sourceItem || !TODO_TYPES.includes(sourceItem.issue_type)) continue;
    const item = normalizeItem(sourceItem);
    if (mappingCovers(mappingText, item.content)) continue;
    byKey.set(item.stable_key || item.id, item);
  }
  return [...byKey.values()]
    .sort((a, b) => {
      const typeDiff = (TYPE_ORDER.get(a.issue_type) || 99) - (TYPE_ORDER.get(b.issue_type) || 99);
      if (typeDiff) return typeDiff;
      return `${a.source_file}${a.content}`.localeCompare(`${b.source_file}${b.content}`, 'zh-Hans-CN');
    });
}

function normalizeItem(item) {
  if (item.id && item.content) return item;
  const stableKey = String(item.stable_key || '').trim();
  return {
    id: `DSO-${stableKey.toUpperCase()}`,
    stable_key: stableKey,
    department: item.department || '',
    source_file: item.source_file || '',
    source_anchor: item.source_anchor || '',
    issue_type: item.issue_type,
    content: item.current_value || item.source_excerpt || item.question_for_user || '',
    mapping_location: `${item.target_block || ''}.${item.target_field || ''}`.replace(/^\./, ''),
    suggested_action: item.next_step || item.question_for_user || '',
    status: item.user_decision || '待处理',
    owner: item.suggested_handler || '待部门确认',
  };
}

function sourceLabel(item) {
  const fileName = String(item.source_file || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .pop() || '';
  return `${fileName} ${humanizeAnchor(item.source_anchor || '')}`.trim();
}

function humanizeAnchor(value) {
  return String(value || '')
    .replace(/§\s*([0-9]+(?:\.[0-9]+)*)/g, '第$1条')
    .replace(/\bT(\d+)R(\d+)\b/gi, '表$1第$2行')
    .replace(/\bP(\d+)\b/gi, '第$1页')
    .replace(/\bT(\d+)\b/gi, '表$1')
    .trim();
}

function buildMarkdown(items, existingRows) {
  const lines = [
    '# 输入基线问题待办',
    '',
    '> 该文件由 document-structured-output-v2 的 pending_issues 派生，只保留未解决问题，不作为流程输入基线或机器合同。',
    '',
    `问题类型固定为：${TODO_TYPES.join('、')}。`,
    '',
    '| 编号 | 部门 | 来源文件/条款 | 问题类型 | 问题内容 | 当前映射位置 | 建议动作 | 处理状态 | 负责人/确认对象 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (const item of items) {
    const existing = existingRows.get(item.id) || {};
    const row = [
      item.id,
      item.department,
      sourceLabel(item),
      item.issue_type,
      shorten(item.content, 220),
      item.mapping_location,
      item.suggested_action,
      existing.status || item.status || '待处理',
      existing.owner || item.owner || '待部门确认',
    ].map(escapeMarkdownCell);
    lines.push(`| ${row.join(' | ')} |`);
  }

  if (items.length === 0) {
    lines.push('| 暂无 | — | — | — | 当前无未解决待确认问题 | — | — | — | — |');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'reviewItems');
  requireArg(args, 'mapping');
  requireArg(args, 'todo');

  const payload = readJson(args.reviewItems);
  const reviewItems = Array.isArray(payload) ? payload : payload.pending_issues;
  if (!Array.isArray(reviewItems)) throw new Error('--review-items must point to an array or a document-structured-output-v2 object');
  const mappingText = fs.existsSync(args.mapping) ? fs.readFileSync(args.mapping, 'utf8') : '';
  const oldMarkdown = fs.existsSync(args.todo) ? fs.readFileSync(args.todo, 'utf8') : '';
  const existingRows = parseExistingRows(oldMarkdown);
  const items = unresolvedItems(reviewItems, mappingText);
  fs.mkdirSync(path.dirname(args.todo), { recursive: true });
  fs.writeFileSync(args.todo, buildMarkdown(items, existingRows), 'utf8');
  console.error(`todo_items=${items.length} out=${args.todo}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
