#!/usr/bin/env node
/**
 * Regression checks for the process-evidence-mapping skill evolution loop.
 *
 * Usage: node .agents/skills/process-evidence-mapping/scripts/test-evolution-workflow.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../../..');
const skillDir = join(root, '.agents', 'skills', 'process-evidence-mapping');
const casesPath = join(skillDir, 'references', 'evolution-cases.jsonl');
const generatorPath = join(skillDir, 'scripts', 'generate-evolution-proposal.mjs');
const runDir = join(root, 'artifacts', 'process-evolution', 'test-evolution-workflow');
const candidateRunDir = join(root, 'artifacts', 'process-candidates', 'test-evolution-input');
const proposalPath = join(runDir, 'evolution-proposal.md');

function readJsonLines(path) {
  return readFileSync(path, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

rmSync(runDir, { recursive: true, force: true });
rmSync(candidateRunDir, { recursive: true, force: true });
mkdirSync(candidateRunDir, { recursive: true });

writeFileSync(
  join(candidateRunDir, 'mapping_diff_items.json'),
  JSON.stringify(
    [
      {
        stable_key: 'test-candidate-missing-a1',
        department: '经营发展部',
        source_anchor: 'GLTX-JY-05-D §5.4.3',
        candidate_type: '候选A1',
        content: '编制/核算公司月度综合打分表',
        current_mapping_location: 'JY-L3-04',
        suggested_action: '回源核验后补充对象链说明',
      },
      {
        stable_key: 'test-candidate-transfer',
        department: '经营发展部',
        source_anchor: 'GLTX-JY-05-D §5.4.4',
        candidate_type: '受控传递待确认',
        content: '各部门反馈绩效评分数据至经营发展部',
        current_mapping_location: 'JY-L3-04',
        suggested_action: '确认泛称部门是否允许拆分',
      },
    ],
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  join(candidateRunDir, 'embedding_manifest.json'),
  JSON.stringify(
    {
      status: 'skipped',
      model: 'qwen3-embedding:latest',
      dimensions: 1024,
      reason: 'test fixture uses keyword fallback',
    },
    null,
    2,
  ),
  'utf8',
);
writeFileSync(
  join(candidateRunDir, 'mapping_diff_report.md'),
  [
    '# 测试候选差异报告',
    '',
    '- 本轮未使用向量检索。',
    '- 相似度仅用于候选排序，不是证据强度。',
    '',
  ].join('\n'),
  'utf8',
);

assert.equal(existsSync(casesPath), true, 'evolution-cases.jsonl should exist');
const cases = readJsonLines(casesPath);
assert.ok(cases.length >= 3, 'evolution cases should include at least three seed cases');

for (const item of cases) {
  for (const field of [
    'id',
    'source_file',
    'expected_conclusion',
    'forbidden_conclusions',
    'evidence_anchors',
    'failure_type',
    'skill_rule',
    'verification_command',
  ]) {
    assert.ok(Object.hasOwn(item, field), `${item.id || 'case'} should include ${field}`);
  }
  assert.ok(Array.isArray(item.forbidden_conclusions), `${item.id} forbidden_conclusions should be an array`);
  assert.ok(Array.isArray(item.evidence_anchors), `${item.id} evidence_anchors should be an array`);
}

const caseIds = cases.map((item) => item.id);
assert.ok(caseIds.includes('GLTX-JY-05-object-chain'), 'should seed GLTX-JY-05 object-chain case');
assert.ok(caseIds.includes('minimal-vector-similarity-boundary'), 'should seed vector boundary case');
assert.ok(caseIds.includes('candidate-run-classification'), 'should seed candidate run classification case');

execFileSync(
  process.execPath,
  [
    generatorPath,
    '--cases',
    casesPath,
    '--candidate-run',
    candidateRunDir,
    '--out',
    runDir,
  ],
  {
    cwd: root,
    stdio: 'pipe',
    encoding: 'utf8',
  },
);

assert.equal(existsSync(proposalPath), true, 'generator should write evolution-proposal.md');
const proposal = readFileSync(proposalPath, 'utf8');

for (const required of [
  '# 流程证据映射技能演进提案',
  '只生成提案，不自动修改正式映射',
  'GLTX-JY-05-object-chain',
  'minimal-vector-similarity-boundary',
  'candidate-run-classification',
  '候选A1',
  '受控传递待确认',
  '本轮未使用向量检索',
  '应补规则',
  '应补测试',
  '可能影响范围',
]) {
  assert.ok(proposal.includes(required), `proposal should include ${required}`);
}

assert.equal(
  existsSync(join(root, 'docs', 'norms', '流程治理', 'evolution-proposal.md')),
  false,
  'evolution proposal must not be written into docs/norms formal truth area',
);

const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
assert.equal(
  packageJson.scripts['test:process-evidence-evolution'],
  'node .agents/skills/process-evidence-mapping/scripts/test-evolution-workflow.mjs',
  'package.json should expose test:process-evidence-evolution',
);

const skill = readFileSync(join(skillDir, 'SKILL.md'), 'utf8');
assert.ok(skill.includes('技能演进评测'), 'SKILL.md should document the skill evolution loop');
assert.ok(skill.includes('evolution-cases.jsonl'), 'SKILL.md should name evolution-cases.jsonl');
assert.ok(skill.includes('evolution-proposal.md'), 'SKILL.md should name evolution-proposal.md');
assert.ok(skill.includes('不得自动修改正式映射'), 'SKILL.md should forbid automatic formal mapping edits');
assert.ok(skill.includes('npm run test:process-evidence-evolution'), 'SKILL.md verification should include evolution test');

console.log('Process evidence evolution workflow checks passed');
