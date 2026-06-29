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
const jsonOutputPath = path.join(tmpDir, 'weekly-report.json');

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
  '--out', outputPath,
  '--json-out', jsonOutputPath
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

const snapshot = JSON.parse(fs.readFileSync(jsonOutputPath, 'utf8'));
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.generatedDate, '2026-06-29');
assert.deepEqual(snapshot.scope, {
  type: 'sample',
  departments: ['工程技术部', '项目管理部']
});
assert.ok(Array.isArray(snapshot.sources), 'JSON 快照必须登记来源');
assert.ok(snapshot.sources.some(source => source.key === 'workbenchSnapshot' && source.path.endsWith('workbench-snapshot.json')));
assert.equal(snapshot.summary.fieldLedgerGap, 1);
assert.equal(snapshot.summary.goldSourceConfirmation, 1);
assert.equal(snapshot.summary.overdue, 1);

const engineering = snapshot.departments.find(row => row.department === '工程技术部');
assert.ok(engineering, 'JSON 快照必须包含工程技术部');
assert.equal(engineering.confirmPerson, '池炳辉');
assert.equal(engineering.fieldLedgerGap, 1);
assert.equal(engineering.overdue, 1);
assert.ok(engineering.nextStep.includes('输入基线'));

const project = snapshot.departments.find(row => row.department === '项目管理部');
assert.ok(project, 'JSON 快照必须包含项目管理部');
assert.equal(project.confirmPerson, '范秋南');
assert.equal(project.goldSourceConfirmation, 1);

const appSource = fs.readFileSync(path.join(repoRoot, 'pmo', 'gantt-react', 'src', 'App.jsx'), 'utf8');
assert.match(appSource, /project-governance-weekly-report\.json/, 'PMO 应读取项目治理周报 JSON 快照');
assert.match(appSource, /projectGovernance/, 'PMO 应把项目治理快照传给周会视图');

const weeklyViewSource = fs.readFileSync(path.join(repoRoot, 'pmo', 'gantt-react', 'src', 'components', 'PMOWeeklyView.jsx'), 'utf8');
assert.match(weeklyViewSource, /项目治理闭环/, 'PMO 周会页应展示项目治理闭环区块');
assert.match(weeklyViewSource, /快照未生成/, 'PMO 周会页应处理项目治理快照缺失状态');

console.log('Project governance report test passed');
