import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sampleDepartments = ['工程技术部', '项目管理部'];
const explicitConfirmers = {
  工程技术部: '池炳辉',
  项目管理部: '范秋南'
};

function argValue(name, fallback = '') {
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  const prefix = `${name}=`;
  const matched = process.argv.find(arg => arg.startsWith(prefix));
  return matched ? matched.slice(prefix.length) : fallback;
}

function readText(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf8') : '';
}

function parseMarkdownTableRows(text) {
  return text
    .split(/\r?\n/)
    .filter(line => /^\|.+\|$/.test(line.trim()))
    .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim()))
    .filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));
}

function countInputBaselineIssues() {
  const text = readText(path.join('docs', 'norms', '流程治理', '输入基线问题待办.md'));
  const rows = parseMarkdownTableRows(text).filter(row => row[0] !== '编号' && sampleDepartments.includes(row[1]));
  const byDepartment = new Map(sampleDepartments.map(department => [department, {
    total: 0,
    open: 0,
    byType: new Map()
  }]));

  for (const row of rows) {
    const department = row[1];
    const issueType = row[3] || '未分类';
    const status = row[7] || '待处理';
    const bucket = byDepartment.get(department);
    bucket.total += 1;
    if (!/已处理|已关闭|已解决/.test(status)) bucket.open += 1;
    bucket.byType.set(issueType, (bucket.byType.get(issueType) || 0) + 1);
  }
  return byDepartment;
}

function countQualityIssues() {
  const text = readText(path.join('docs', 'reports', 'dcm-bbm-quality-report.md'));
  const rows = parseMarkdownTableRows(text).filter(row => ['BLOCK', 'WARN', 'INFO'].includes(row[0]));
  const byDepartment = new Map(sampleDepartments.map(department => [department, {
    BLOCK: 0,
    WARN: 0,
    INFO: 0
  }]));

  for (const row of rows) {
    const mappingLocation = row[2] || '';
    const department = sampleDepartments.find(item => mappingLocation.includes(`docs/norms/${item}部门-能力-流程-系统映射关系.md`));
    if (!department) continue;
    byDepartment.get(department)[row[0]] += 1;
  }
  return byDepartment;
}

function emptyWorkbenchCounts() {
  return new Map(sampleDepartments.map(department => [department, {
    field_ledger_gap: 0,
    gold_source_confirmation: 0,
    process_quality: 0,
    input_baseline_issue: 0,
    pmo_review_gate: 0,
    overdue: 0
  }]));
}

function countWorkbenchSnapshot(snapshotPath) {
  const counts = emptyWorkbenchCounts();
  if (!snapshotPath) return { counts, source: '未提供工作台快照' };
  const fullPath = path.resolve(repoRoot, snapshotPath);
  if (!fs.existsSync(fullPath)) return { counts, source: `未找到工作台快照：${snapshotPath}` };

  const payload = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
  const workItems = Array.isArray(payload)
    ? payload
    : Array.isArray(payload.workItems)
      ? payload.workItems
      : [];
  for (const item of workItems) {
    const department = sampleDepartments.includes(item.department) ? item.department : null;
    if (!department) continue;
    const type = item.governanceType || item.sourceType || item.type;
    const bucket = counts.get(department);
    if (Object.prototype.hasOwnProperty.call(bucket, type)) bucket[type] += 1;
    if (item.overdue) bucket.overdue += 1;
  }
  return { counts, source: path.relative(repoRoot, fullPath).replace(/\\/g, '/') };
}

function formatTypeSummary(typeMap) {
  const entries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '无';
  return entries.slice(0, 4).map(([type, count]) => `${type} ${count}`).join('；');
}

function renderReport({ date, outputPath, workbenchSnapshot }) {
  const inputBaseline = countInputBaselineIssues();
  const quality = countQualityIssues();
  const { counts: workbench, source: workbenchSource } = countWorkbenchSnapshot(workbenchSnapshot);

  const rows = sampleDepartments.map(department => {
    const input = inputBaseline.get(department);
    const q = quality.get(department);
    const w = workbench.get(department);
    const qualityText = `BLOCK ${q.BLOCK} / WARN ${q.WARN}`;
    const nextStep = input.open > 0
      ? '先处理输入基线待确认问题，再进入字段和质量闭环'
      : '维护本周关闭记录并准备双周复盘';
    return `| ${department} | ${explicitConfirmers[department]} | ${input.open} | ${qualityText} | ${w.field_ledger_gap} | ${w.gold_source_confirmation} | ${w.overdue} | ${nextStep} |`;
  });

  const lines = [
    '# 项目治理周报（双部门样板）',
    '',
    `- 生成日期：${date}`,
    '- 样板部门：工程技术部、项目管理部',
    '- MDM 定位：承接、分派、记录、追踪和验证；规则制定和发布仍由人工回源核验后受控完成。',
    `- 工作台快照：${workbenchSource}`,
    '',
    '## 本周治理看板',
    '',
    '| 指标 | 工程技术部 | 项目管理部 | 说明 |',
    '|---|---:|---:|---|',
    `| 输入基线待确认问题 | ${inputBaseline.get('工程技术部').open} | ${inputBaseline.get('项目管理部').open} | 来自 \`docs/norms/流程治理/输入基线问题待办.md\` |`,
    `| 资料质量 BLOCK | ${quality.get('工程技术部').BLOCK} | ${quality.get('项目管理部').BLOCK} | 来自 \`docs/reports/dcm-bbm-quality-report.md\` |`,
    `| 资料质量 WARN | ${quality.get('工程技术部').WARN} | ${quality.get('项目管理部').WARN} | 用于提示需回源复核的质量风险 |`,
    `| 字段台账缺口 | ${workbench.get('工程技术部').field_ledger_gap} | ${workbench.get('项目管理部').field_ledger_gap} | 来自角色工作台工作项快照 |`,
    `| 待确认黄金源 | ${workbench.get('工程技术部').gold_source_confirmation} | ${workbench.get('项目管理部').gold_source_confirmation} | 来自角色工作台工作项快照 |`,
    `| 超期事项 | ${workbench.get('工程技术部').overdue} | ${workbench.get('项目管理部').overdue} | 以工作项 dueDate 与当前日期判断 |`,
    '',
    '## 双部门治理台账',
    '',
    '| 部门 | 最终确认人 | 输入基线待处理 | 质量问题 | 字段台账缺口 | 待确认黄金源 | 超期事项 | 下一步 |',
    '|---|---|---:|---|---:|---:|---:|---|',
    ...rows,
    '',
    '## 输入基线问题分布',
    '',
    ...sampleDepartments.map(department => `- ${department}：${formatTypeSummary(inputBaseline.get(department).byType)}`),
    '',
    '## PMO 节奏',
    '',
    '- 每周：更新新增问题、关闭问题、超期问题、字段台账完整率、待确认黄金源进度和需决策事项。',
    '- 每两周：复盘进入已确认流程映射、继续留在问题池、需要回部门补证的事项。',
    '- 发布门：完成回源核验、责任确认和测试后，才刷新 PMO 驾驶舱和流程治理快照。',
    '',
    '## 本周需看住的事',
    '',
    '- 输入基线问题不直接改写已确认流程映射，先形成处理结论和证据链。',
    '- 字段台账缺口和待确认黄金源统一进入角色工作台，按责任人推进。',
    '- 质量问题关闭前必须能追溯到来源文件、处理记录和验证结果。',
    ''
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, lines.join('\n'), 'utf8');
  return outputPath;
}

const date = argValue('--date', new Date().toISOString().slice(0, 10));
const outputArg = argValue('--out', path.join('docs', 'reports', 'project-governance-weekly-report.md'));
const outputPath = path.resolve(repoRoot, outputArg);
const workbenchSnapshot = argValue('--workbench-json', '');
const written = renderReport({ date, outputPath, workbenchSnapshot });
console.log(`project_governance_report=${path.relative(repoRoot, written).replace(/\\/g, '/')}`);
