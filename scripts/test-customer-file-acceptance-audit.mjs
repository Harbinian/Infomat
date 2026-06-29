#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const outPath = resolve(root, 'artifacts', 'customer-file-acceptance', 'test-impact-list.json');
const reportPath = resolve(root, 'artifacts', 'customer-file-acceptance', 'test-impact-report.md');

rmSync(dirname(outPath), { recursive: true, force: true });

execFileSync(process.execPath, [
  resolve(root, 'scripts', 'audit-customer-file-acceptance.mjs'),
  '--input', resolve(root, 'docs', 'company-sankey-data.json'),
  '--out', outPath,
  '--report', reportPath,
], {
  cwd: root,
  stdio: 'pipe',
  encoding: 'utf8',
});

assert.equal(existsSync(outPath), true, 'impact list JSON should be written');
assert.equal(existsSync(reportPath), true, 'impact report should be written');

const audit = JSON.parse(readFileSync(outPath, 'utf8'));
const report = readFileSync(reportPath, 'utf8');

assert.ok(audit.summary.total_tasks > 0, 'audit should generate customer-file acceptance tasks');
assert.ok(audit.summary.by_boundary.customer_requirement > 0, 'audit should count customer requirement refs');
assert.ok(Array.isArray(audit.tasks), 'audit tasks should be an array');
assert.equal(
  audit.tasks.every((task) => task.acceptance_task_type === '客户文件承接'),
  true,
  'all tasks should use the customer-file acceptance task type',
);
assert.equal(
  audit.tasks.every((task) => task.source_boundary_flag !== 'changxing_owned'),
  true,
  'GLTX/changxing-owned evidence should not become a customer-file acceptance task',
);
assert.ok(
  audit.tasks.some((task) => task.department === '工程技术部' && task.source_refs.some((ref) => /GLC120101|FM1201/.test(ref.citation))),
  'engineering GLC/FM references should be represented in acceptance tasks',
);
assert.ok(
  audit.tasks.some((task) => task.customer_acceptance_required === true && task.suggested_action.includes('昌兴')),
  'tasks should state that customer evidence needs Changxing acceptance evidence',
);
assert.match(report, /# 客户文件承接影响清单/);
assert.match(report, /本清单不改写已确认流程映射/);

console.log('Customer file acceptance audit checks passed');
