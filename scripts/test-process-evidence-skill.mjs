#!/usr/bin/env node
/**
 * Regression checks for the process-evidence-mapping skill contract.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillDir = resolve(root, '.agents/skills/process-evidence-mapping');
const skillPath = join(skillDir, 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const expectedSteps = [
  '仓库上下文',
  '源文件清单与可读性门',
  '证据切块',
  '可选语义检索',
  '通用流程与行为候选',
  '角色与对象链',
  '编译 document-structured-output-v2',
  '待确认问题与差异审计',
  '派生人工视图',
  '人工确认与发布边界',
  '验证与报告',
];

let previousIndex = -1;
for (const [index, step] of expectedSteps.entries()) {
  const heading = `### ${index + 1}. ${step}`;
  const currentIndex = skill.indexOf(heading);
  assert.notEqual(currentIndex, -1, `SKILL.md should include ordered heading: ${heading}`);
  assert.ok(currentIndex > previousIndex, `SKILL.md heading out of order: ${heading}`);
  previousIndex = currentIndex;

  const nextHeading = index + 1 < expectedSteps.length ? `### ${index + 2}. ${expectedSteps[index + 1]}` : '\n## ';
  const nextIndex = skill.indexOf(nextHeading, currentIndex + heading.length);
  const section = nextIndex === -1 ? skill.slice(currentIndex) : skill.slice(currentIndex, nextIndex);
  for (const label of ['输入', '动作', '输出', '不得做', '下一步条件']) {
    assert.ok(section.includes(`**${label}**`), `${heading} should contain **${label}**`);
  }
}

for (const required of [
  'document-structured-output-v2.json',
  'docs/contracts/document-structured-output.schema.json',
  'blocked_unreadable',
  'evidence_status=pending_review',
  'pending_issues[]',
  '不得自动生成 `verified` 证据',
  '不得默认写入',
  'validate-document-structured-output-v2.mjs',
  'npm run test:process-evidence-evolution',
]) {
  assert.ok(skill.includes(required), `SKILL.md should include ${required}`);
}

function textFiles(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const target = join(dir, name);
    if (statSync(target).isDirectory()) files.push(...textFiles(target));
    else if (/\.(?:md|mjs|py|ya?ml|jsonl?)$/i.test(name)) files.push(target);
  }
  return files;
}

const forbiddenRecognitionAcronym = new RegExp(['o', 'c', 'r'].join(''), 'i');
for (const file of textFiles(skillDir)) {
  const content = readFileSync(file, 'utf8');
  assert.equal(
    forbiddenRecognitionAcronym.test(content),
    false,
    `process-evidence-mapping must not contain image-to-text recognition paths: ${file}`,
  );
}

const workflow = readFileSync(join(skillDir, 'scripts/run-process-input-baseline-review-workflow.mjs'), 'utf8');
for (const financeSpecific of ['工资总额', '盈亏处理', '废品损失', '财务成本核算管理程序']) {
  assert.equal(workflow.includes(financeSpecific), false, `generic workflow must not hard-code ${financeSpecific}`);
}

console.log('Process evidence skill structure checks passed');
