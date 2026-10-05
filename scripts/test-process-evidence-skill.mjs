#!/usr/bin/env node
/**
 * Regression checks for the process-evidence-mapping skill contract.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const skillDir = resolve(root, '.agents/skills/process-evidence-mapping');
const skillPath = join(skillDir, 'SKILL.md');
const skill = readFileSync(skillPath, 'utf8');

const referenceLinks = [...skill.matchAll(/\]\((references\/[^)#]+\.md)(?:#[^)]*)?\)/g)]
  .map(match => match[1]);
assert.ok(referenceLinks.length > 0, 'skill should route to its workflow references');
for (const relativePath of new Set(referenceLinks)) {
  const target = resolve(skillDir, relativePath);
  assert.ok(existsSync(target), `missing skill reference: ${relativePath}`);
  const content = readFileSync(target, 'utf8');
  assert.ok(content.trim(), `empty skill reference: ${relativePath}`);
}
assert.match(skill, /^---\r?\nname: process-evidence-mapping\r?\n/, 'skill must retain its discoverable name');
const schema = JSON.parse(readFileSync(join(root, 'docs/contracts/document-structured-output.schema.json'), 'utf8'));
assert.ok(schema.$defs.evidenceStatus.enum.includes('pending_review'));
assert.ok(schema.$defs.pendingIssue.properties.issue_type.enum.includes('OCR/抽取待复核'));
// Observable evidence, provenance and partial-source behavior are covered by
// test-input-baseline-review-workflow.mjs, not wording or keyword prohibitions.

console.log('Process evidence skill structure checks passed');
