#!/usr/bin/env node
/**
 * Generate a read-only process-evidence-mapping skill evolution proposal.
 *
 * This script reads evolution cases and optional review run artifacts, then
 * writes a proposal under artifacts/process-evolution. It never edits
 * docs/norms formal mappings or skill files.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const defaultCases = join(root, '.agents', 'skills', 'process-evidence-mapping', 'references', 'evolution-cases.jsonl');

function parseArgs(argv) {
  const args = {
    cases: defaultCases,
    reviewRun: null,
    out: join(root, 'artifacts', 'process-evolution', new Date().toISOString().replace(/[:.]/g, '-')),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cases') {
      args.cases = resolve(root, argv[++index]);
    } else if (arg === '--review-run') {
      args.reviewRun = resolve(root, argv[++index]);
    } else if (arg === '--out') {
      args.out = resolve(root, argv[++index]);
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node .agents/skills/process-evidence-mapping/scripts/generate-evolution-proposal.mjs [options]

Options:
  --cases <path>          JSONL evolution cases. Defaults to references/evolution-cases.jsonl.
  --review-run <path>  Optional artifacts/process-input-baseline-review run directory.
  --out <path>            Output directory. Defaults to artifacts/process-evolution/<run-id>.
`);
}

function readJson(path, fallback) {
  if (!path || !existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path, fallback = '') {
  if (!path || !existsSync(path)) return fallback;
  return readFileSync(path, 'utf8');
}

function readJsonLines(path) {
  assert.equal(existsSync(path), true, `Missing evolution cases file: ${path}`);
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSONL at ${path}:${index + 1}: ${error.message}`);
      }
    });
}

function validateCase(item) {
  const requiredFields = [
    'id',
    'source_file',
    'expected_conclusion',
    'forbidden_conclusions',
    'evidence_anchors',
    'failure_type',
    'skill_rule',
    'verification_command',
  ];
  for (const field of requiredFields) {
    assert.ok(Object.hasOwn(item, field), `Evolution case ${item.id || '(missing id)'} missing ${field}`);
  }
  assert.ok(Array.isArray(item.forbidden_conclusions), `${item.id} forbidden_conclusions must be an array`);
  assert.ok(Array.isArray(item.evidence_anchors), `${item.id} evidence_anchors must be an array`);
}

function issueClass(issueType) {
  const mapping = {
    待确认L3: '漏判',
    待确认A1: '漏判',
    角色待确认: '证据不足',
    审批链待确认: '证据不足',
    受控传递待确认: '证据不足',
    验收标准待补: '规则缺失',
    归档要求待补: '规则缺失',
    系统落位待确认: '规则缺失',
    来源证据不足: '证据不足',
    原文定义不足: '规则缺失',
    'L3 结构待确认': '漏判',
    'A1 行为待确认': '漏判',
    角色责任待确认: '证据不足',
    跨部门承接待确认: '证据不足',
    表单字段待确认: '规则缺失',
    主数据需求待确认: '规则缺失',
    抽取结果待复核: '证据不足',
  };
  return mapping[issueType] || '测试缺失';
}

function markdownList(items) {
  if (!items.length) return '- 暂无';
  return items.map((item) => `- ${item}`).join('\n');
}

function tableRow(values) {
  return `| ${values.map((value) => String(value).replace(/\r?\n/g, '<br>')).join(' | ')} |`;
}

function buildProposal({ cases, reviewRun, reviewItems, embeddingManifest, diffReport }) {
  const failureTypes = new Map();
  for (const item of cases) {
    failureTypes.set(item.failure_type, (failureTypes.get(item.failure_type) || 0) + 1);
  }
  for (const item of reviewItems) {
    const type = issueClass(item.issue_type);
    failureTypes.set(type, (failureTypes.get(type) || 0) + 1);
  }

  const rules = [...new Set(cases.map((item) => item.skill_rule))];
  const tests = [...new Set(cases.map((item) => `${item.id}: ${item.verification_command}`))];
  const sourceFiles = [...new Set(cases.map((item) => item.source_file))];
  const issueTypes = [...new Set(reviewItems.map((item) => item.issue_type).filter(Boolean))];
  const embeddingStatus = embeddingManifest?.status || '未提供';
  const embeddingNotice = embeddingStatus === 'skipped'
    ? '本轮未使用向量检索；不得把降级结果说成向量评测通过。'
    : `向量检索状态：${embeddingStatus}。`;

  const lines = [
    '# 流程证据映射技能演进提案',
    '',
    '> 边界：只生成提案，不自动修改已确认流程映射、PMO 页面、MDM 接口或技能文件。正式结构块投影仍必须逐条回源核验并完成人工确认。',
    '',
    '## 输入概览',
    '',
    `- 演进案例数：${cases.length}`,
    `- 问题识别批次目录：${reviewRun ? reviewRun : '未提供'}`,
    `- 待确认问题数：${reviewItems.length}`,
    `- Embedding 状态：${embeddingStatus}`,
    `- ${embeddingNotice}`,
    '',
    '## 失败分类',
    '',
    tableRow(['失败类型', '数量']),
    tableRow(['---', '---:']),
    ...[...failureTypes.entries()].map(([type, count]) => tableRow([type, count])),
    '',
    '## 案例矩阵',
    '',
    tableRow(['案例', '失败类型', '期望结论', '禁止结论', '证据锚点']),
    tableRow(['---', '---', '---', '---', '---']),
    ...cases.map((item) => tableRow([
      item.id,
      item.failure_type,
      item.expected_conclusion,
      item.forbidden_conclusions.join('<br>'),
      item.evidence_anchors.join('<br>'),
    ])),
    '',
    '## 问题识别批次分类',
    '',
  ];

  if (reviewItems.length) {
    lines.push(
      tableRow(['稳定键', '问题类型', '分类', '问题内容', '建议动作']),
      tableRow(['---', '---', '---', '---', '---']),
      ...reviewItems.map((item) => tableRow([
        item.stable_key || item.id || '(无稳定键)',
        item.issue_type || '(未标注)',
        issueClass(item.issue_type),
        item.content || item.issue_content || item.current_value || item.question_for_user || '',
        item.suggested_action || item.next_step || item.question_for_user || '',
      ])),
      '',
    );
  } else {
    lines.push('- 未提供问题识别批次产物。', '');
  }

  lines.push(
    '## 应补规则',
    '',
    markdownList(rules),
    '',
    '## 应补测试',
    '',
    markdownList(tests),
    '',
    '## 可能影响范围',
    '',
    markdownList([
      `案例来源：${sourceFiles.join('；')}`,
      issueTypes.length ? `问题类型：${issueTypes.join('、')}` : '问题类型：未提供',
      '影响对象：技能说明、评测案例、待确认解释质量；不影响流程输入基线。',
    ]),
    '',
  );

  if (diffReport.includes('本轮未使用向量检索')) {
    lines.push('## 降级记录', '', '- 本轮未使用向量检索。', '- 相似度相关结论只能保留为待确认或待确认。', '');
  }

  return `${lines.join('\n')}\n`;
}

const args = parseArgs(process.argv.slice(2));
const outDir = resolve(root, args.out);
const relativeOut = outDir.slice(root.length).replace(/^[\\/]/, '');
assert.ok(
  relativeOut === 'artifacts' || relativeOut.startsWith(`artifacts${process.platform === 'win32' ? '\\' : '/'}`) || relativeOut.startsWith('artifacts/'),
  `Output must stay under artifacts/: ${outDir}`,
);

const cases = readJsonLines(args.cases);
cases.forEach(validateCase);

const reviewRun = args.reviewRun;
const structuredOutput = reviewRun
  ? readJson(join(reviewRun, 'document-structured-output-v2.json'), null)
  : null;
const reviewItems = Array.isArray(structuredOutput?.pending_issues)
  ? structuredOutput.pending_issues
  : (reviewRun ? readJson(join(reviewRun, 'mapping_diff_items.json'), []) : []);
const embeddingManifest = reviewRun
  ? readJson(join(reviewRun, 'embedding_manifest.json'), null)
  : null;
const diffReport = reviewRun
  ? readText(join(reviewRun, 'mapping_diff_report.md'))
  : '';

mkdirSync(outDir, { recursive: true });
const proposal = buildProposal({
  cases,
  reviewRun: reviewRun ? `${basename(reviewRun)}` : null,
  reviewItems: Array.isArray(reviewItems) ? reviewItems : [],
  embeddingManifest,
  diffReport,
});

const outputPath = join(outDir, 'evolution-proposal.md');
writeFileSync(outputPath, proposal, 'utf8');
console.log(outputPath);
