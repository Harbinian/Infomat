#!/usr/bin/env node
/**
 * Regression checks for the process-evidence-mapping skill contract.
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillDir = resolve(root, '.agents/skills/process-evidence-mapping');
const skillPath = join(skillDir, 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const referenceLinks = [...skill.matchAll(/\]\((references\/[^)#]+\.md)(?:#[^)]*)?\)/g)]
  .map(match => match[1]);
assert.ok(referenceLinks.length > 0, 'skill should route to its workflow references');
const references = [...new Set(referenceLinks)].map(relativePath => {
  const target = resolve(skillDir, relativePath);
  assert.ok(existsSync(target), `missing skill reference: ${relativePath}`);
  const content = readFileSync(target, 'utf8');
  assert.ok(content.trim(), `empty skill reference: ${relativePath}`);
  return content;
});
const guidance = [skill, ...references].join('\n');

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
  assert.ok(guidance.includes(required), `skill guidance should retain ${required}`);
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
