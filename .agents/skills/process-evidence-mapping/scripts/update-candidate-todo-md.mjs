#!/usr/bin/env node
/**
 * Update the human-facing candidate todo markdown.
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
} from './candidate-utils.mjs';

const HEADERS = ['编号', '部门', '来源文件/条款', '候选类型', '候选内容', '当前映射位置', '建议动作', '处理状态', '负责人/确认对象'];

function parseExistingRows(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| CAND-')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((cell) => cell.trim().replace(/\\\|/g, '|'));
    if (cells.length < HEADERS.length) continue;
    rows.set(cells[0], {
      status: cells[7] || '待处理',
      owner: cells[8] || '待部门确认',
    });
  }
  return rows;
}

function unresolvedItems(items, mappingText) {
  const byKey = new Map();
  for (const item of items) {
    if (!item || !item.id || !TODO_TYPES.includes(item.candidate_type)) continue;
    if (mappingCovers(mappingText, item.content)) continue;
    byKey.set(item.stable_key || item.id, item);
  }
  return [...byKey.values()]
    .sort((a, b) => `${a.candidate_type}${a.source_file}${a.content}`.localeCompare(`${b.candidate_type}${b.source_file}${b.content}`, 'zh-Hans-CN'));
}

function buildMarkdown(items, existingRows) {
  const lines = [
    '# 候选映射待办',
    '',
    '> 该文件只保留未解决候选项，不作为流程真源；解决一条后直接删除该条。追溯依赖原始候选 JSON、正式映射变更记录和 git 历史。',
    '',
    `候选类型固定为：${TODO_TYPES.join('、')}。`,
    '',
    '| 编号 | 部门 | 来源文件/条款 | 候选类型 | 候选内容 | 当前映射位置 | 建议动作 | 处理状态 | 负责人/确认对象 |',
    '|---|---|---|---|---|---|---|---|---|',
  ];

  for (const item of items) {
    const existing = existingRows.get(item.id) || {};
    const row = [
      item.id,
      item.department,
      `${item.source_file || ''} ${item.source_anchor || ''}`.trim(),
      item.candidate_type,
      shorten(item.content, 220),
      item.mapping_location,
      item.suggested_action,
      existing.status || item.status || '待处理',
      existing.owner || item.owner || '待部门确认',
    ].map(escapeMarkdownCell);
    lines.push(`| ${row.join(' | ')} |`);
  }

  if (items.length === 0) {
    lines.push('| 暂无 | — | — | — | 当前无未解决候选项 | — | — | — | — |');
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

function main() {
  const args = parseArgs(process.argv);
  requireArg(args, 'candidates');
  requireArg(args, 'mapping');
  requireArg(args, 'todo');

  const candidates = readJson(args.candidates);
  if (!Array.isArray(candidates)) throw new Error('--candidates must point to a JSON array');
  const mappingText = fs.existsSync(args.mapping) ? fs.readFileSync(args.mapping, 'utf8') : '';
  const oldMarkdown = fs.existsSync(args.todo) ? fs.readFileSync(args.todo, 'utf8') : '';
  const existingRows = parseExistingRows(oldMarkdown);
  const items = unresolvedItems(candidates, mappingText);
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
