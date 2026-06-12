#!/usr/bin/env node
/**
 * Generate a read-only process-evidence-mapping skill evolution proposal.
 *
 * This script reads evolution cases and optional candidate run artifacts, then
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
    candidateRun: null,
    out: join(root, 'artifacts', 'process-evolution', new Date().toISOString().replace(/[:.]/g, '-')),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cases') {
      args.cases = resolve(root, argv[++index]);
    } else if (arg === '--candidate-run') {
      args.candidateRun = resolve(root, argv[++index]);
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
  --candidate-run <path>  Optional artifacts/process-candidates run directory.
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

function candidateClass(candidateType) {
  const mapping = {
    候选L3: '漏判',
    候选A1: '漏判',
    角色待确认: '证据不足',
    审批链待确认: '证据不足',
    受控传递待确认: '证据不足',
    OCR待复核: '证据不足',
    验收标准待补: '规则缺失',
    归档要求待补: '规则缺失',
    系统落位待确认: '规则缺失',
  };
  return mapping[candidateType] || '测试缺失';
}

function markdownList(items) {
  if (!items.length) return '- 暂无';
  return items.map((item) => `- ${item}`).join('\n');
}

function tableRow(values) {
  return `| ${values.map((value) => String(value).replace(/\r?\n/g, '<br>')).join(' | ')} |`;
}

function buildProposal({ cases, candidateRun, candidates, embeddingManifest, diffReport }) {
  const failureTypes = new Map();
  for (const item of cases) {
    failureTypes.set(item.failure_type, (failureTypes.get(item.failure_type) || 0) + 1);
  }
  for (const item of candidates) {
    const type = candidateClass(item.candidate_type);
    failureTypes.set(type, (failureTypes.get(type) || 0) + 1);
  }

  const rules = [...new Set(cases.map((item) => item.skill_rule))];
  const tests = [...new Set(cases.map((item) => `${item.id}: ${item.verification_command}`))];
  const sourceFiles = [...new Set(cases.map((item) => item.source_file))];
  const candidateTypes = [...new Set(candidates.map((item) => item.candidate_type).filter(Boolean))];
  const embeddingStatus = embeddingManifest?.status || '未提供';
  const embeddingNotice = embeddingStatus === 'skipped'
    ? '本轮未使用向量检索；不得把降级结果说成向量评测通过。'
    : `向量检索状态：${embeddingStatus}。`;

  const lines = [
    '# 流程证据映射技能演进提案',
    '',
    '> 边界：只生成提案，不自动修改正式映射、PMO 页面、MDM 接口或技能文件。任何 DCM/BBM 入库仍必须逐条回源核验。',
    '',
    '## 输入概览',
    '',
    `- 演进案例数：${cases.length}`,
    `- 候选运行目录：${candidateRun ? candidateRun : '未提供'}`,
    `- 候选项数：${candidates.length}`,
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
    '## 候选运行分类',
    '',
  ];

  if (candidates.length) {
    lines.push(
      tableRow(['稳定键', '候选类型', '分类', '候选内容', '建议动作']),
      tableRow(['---', '---', '---', '---', '---']),
      ...candidates.map((item) => tableRow([
        item.stable_key || item.id || '(无稳定键)',
        item.candidate_type || '(未标注)',
        candidateClass(item.candidate_type),
        item.content || item.candidate_content || '',
        item.suggested_action || '',
      ])),
      '',
    );
  } else {
    lines.push('- 未提供候选运行产物。', '');
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
      candidateTypes.length ? `候选类型：${candidateTypes.join('、')}` : '候选类型：未提供',
      '影响对象：技能说明、评测案例、候选解释质量；不影响正式流程真源。',
    ]),
    '',
  );

  if (diffReport.includes('本轮未使用向量检索')) {
    lines.push('## 降级记录', '', '- 本轮未使用向量检索。', '- 相似度相关结论只能保留为候选或待确认。', '');
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

const candidateRun = args.candidateRun;
const candidates = candidateRun
  ? readJson(join(candidateRun, 'mapping_diff_items.json'), [])
  : [];
const embeddingManifest = candidateRun
  ? readJson(join(candidateRun, 'embedding_manifest.json'), null)
  : null;
const diffReport = candidateRun
  ? readText(join(candidateRun, 'mapping_diff_report.md'))
  : '';

mkdirSync(outDir, { recursive: true });
const proposal = buildProposal({
  cases,
  candidateRun: candidateRun ? `${basename(candidateRun)}` : null,
  candidates: Array.isArray(candidates) ? candidates : [],
  embeddingManifest,
  diffReport,
});

const outputPath = join(outDir, 'evolution-proposal.md');
writeFileSync(outputPath, proposal, 'utf8');
console.log(outputPath);
