import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-governance-report-'));
const snapshotPath = path.join(tmpDir, 'workbench-snapshot.json');
const outputPath = path.join(tmpDir, 'weekly-report.md');

fs.writeFileSync(snapshotPath, JSON.stringify({
  workItems: [
    {
      governanceType: 'field_ledger_gap',
      sourceType: 'field_ledger_gap',
      department: '工程技术部',
      overdue: true
    },
    {
      governanceType: 'gold_source_confirmation',
      sourceType: 'gold_source_confirmation',
      department: '项目管理部',
      overdue: false
    },
    {
      governanceType: 'pmo_review_gate',
      sourceType: 'pmo_review_gate',
      department: '工程技术部',
      overdue: false
    }
  ]
}, null, 2), 'utf8');

execFileSync(process.execPath, [
  path.join(repoRoot, 'scripts', 'build-project-governance-report.mjs'),
  '--date', '2026-06-29',
  '--workbench-json', path.relative(repoRoot, snapshotPath),
  '--out', outputPath
], { cwd: repoRoot, stdio: 'pipe' });

const report = fs.readFileSync(outputPath, 'utf8');
assert.match(report, /# 项目治理周报（双部门样板）/);
assert.match(report, /工程技术部/);
assert.match(report, /项目管理部/);
assert.match(report, /池炳辉/);
assert.match(report, /范秋南/);
assert.match(report, /字段台账缺口/);
assert.match(report, /待确认黄金源/);
assert.match(report, /每两周/);
assert.match(report, /发布门/);
[
  '候' + '选',
  '流程真' + '源',
  '正式映' + '射',
  'candi' + 'date',
  'Candi' + 'date'
].forEach(term => {
  assert.equal(report.includes(term), false, `报告不能出现禁用术语: ${term}`);
});

console.log('Project governance report test passed');
