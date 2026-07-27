#!/usr/bin/env node
/**
 * Build a human-readable review report from vector review evidence.
 */
import fs from 'node:fs';
import path from 'node:path';

function parseArgs(argv) {
  const args = {
    reviewItems: 'artifacts/evidence-index/latest/review_evidence.jsonl',
    out: 'artifacts/evidence-index/latest/review_evidence_report.md',
    title: '待确认证据召回报告',
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') { printHelp(); process.exit(0); }
    if (key === '--review-items') { args.reviewItems = value; i += 1; }
    else if (key === '--out') { args.out = value; i += 1; }
    else if (key === '--title') { args.title = value; i += 1; }
    else throw new Error(`Unknown argument: ${key}`);
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node .agents/skills/process-evidence-mapping/scripts/build-review-evidence-report.mjs --review-items artifacts/evidence-index/<run-id>/review_evidence.jsonl --out artifacts/evidence-index/<run-id>/review_evidence_report.md

The report is review-only. Similarity scores are ranking signals, not evidence strength.`);
}

function readJsonl(filePath) {
  return fs.readFileSync(filePath, 'utf8')
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function escapeCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/\|/g, '\\|');
}

function shorten(text, max = 180) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function relationLabel(type) {
  return {
    object_alias_review: '对象别名待确认',
    approval_chain_review: '审批链待确认',
    controlled_transfer_review: '受控传递待确认',
    archive_or_retention: '归档/保存关系',
    responsibility_or_participation: '职责/参与关系',
    reference_basis: '依据/参考关系',
    extraction_quality_issue: '抽取质量问题',
  }[type] || type || '待确认关系';
}

function statusLine(records) {
  const counts = new Map();
  for (const record of records) {
    const key = `${record.evidence_status || 'pending_review'} / ${record.verification_status || 'unverified'} / ${record.allowed_downstream_use || 'review_only'}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].map(([key, count]) => `- ${key}: ${count}`).join('\n');
}

function main() {
  const args = parseArgs(process.argv);
  if (!fs.existsSync(args.reviewItems)) throw new Error(`Review items file not found: ${args.reviewItems}`);
  const records = readJsonl(args.reviewItems);
  const byQuery = new Map();
  for (const record of records) {
    if (!byQuery.has(record.query)) byQuery.set(record.query, []);
    byQuery.get(record.query).push(record);
  }

  const lines = [
    `# ${args.title}`,
    '',
    `生成时间：${new Date().toISOString()}`,
    '',
    '> 本报告只用于待确认证据复核。相似度仅用于排序，不是证据强度；默认 allowed_downstream_use=review_only。',
    '',
    '## 状态汇总',
    '',
    statusLine(records) || '- 无待确认记录',
    '',
    '## 边界规则',
    '',
    '- `raw_text` 保留抽取原文，不自动修正缺字、空格或模板占位。',
    '- `normalized_review_text` 只用于检索提示，不能作为正式证据原句。',
    '- `pending_review/unverified/review_only` 只能进入 document-structured-output-v2 草稿，不能进入正式结构块投影。',
    '- 未命中不等于确认不存在，只能形成“当前源覆盖下未见证据，待补”。',
    '',
  ];

  for (const [query, items] of byQuery.entries()) {
    lines.push(`## 查询：${query}`, '');
    lines.push('| 排名 | 关系类型 | 抽取质量 | 核验状态 | 来源锚点 | 相似度 | 待确认原文 |');
    lines.push('|---:|---|---|---|---|---:|---|');
    for (const item of items) {
      lines.push([
        item.rank,
        relationLabel(item.relation_type),
        item.extraction_quality || 'clean',
        `${item.evidence_status || 'pending_review'} / ${item.verification_status || 'unverified'}`,
        `${item.source_file || ''} ${item.source_anchor || ''}`.trim(),
        item.retrieval_score ?? '',
        shorten(item.raw_text),
      ].map(escapeCell).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
    }
    lines.push('');
  }

  fs.mkdirSync(path.dirname(args.out), { recursive: true });
  fs.writeFileSync(args.out, `${lines.join('\n')}\n`, 'utf8');
  console.error(`report=${args.out} review_items=${records.length}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
