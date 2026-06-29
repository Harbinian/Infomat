#!/usr/bin/env node
/**
 * Regression checks for the process-evidence-mapping skill document.
 *
 * Usage: node scripts/test-process-evidence-skill.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillPath = resolve(root, '.agents/skills/process-evidence-mapping/SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const expectedSteps = [
  '仓库上下文',
  '源文件清单',
  '可读性判断/OCR',
  'Evidence Chunks',
  'Embedding 检索',
  '输入基线解读',
  '角色抽取',
  '对象链',
  '输入基线问题',
  '待确认待办 Markdown',
  '当前映射差异审计',
  '受控入库',
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

assert.ok(skill.includes('docs/norms/流程治理/输入基线问题待办.md'), 'skill should name the input baseline review todo markdown path');
assert.ok(skill.includes('qwen3-embedding:latest'), 'skill should document the default embedding model');
assert.ok(skill.includes('1024'), 'skill should document embedding dimensions');
assert.ok(skill.includes('ocr_extracted_not_confirmed'), 'skill should keep OCR evidence status boundary');
assert.ok(skill.includes('allowed_downstream_use=review_only'), 'skill should keep review-only reviewItem boundary');
assert.ok(skill.includes('不得直接填写 `审批类型`、`输入来源部门`、`输出目标部门`'), 'skill should forbid reviewItem-to-formal field promotion');

const vectorBoundary = skill.indexOf('## Vectorization Boundary');
const ocrBoundary = skill.indexOf('## OCR Boundary');
assert.equal(vectorBoundary, -1, 'skill should not keep old standalone Vectorization Boundary section');
assert.equal(ocrBoundary, -1, 'skill should not keep old standalone OCR Boundary section');

console.log('Process evidence skill structure checks passed');
