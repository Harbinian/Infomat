import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_MARKDOWN_OUTPUT = path.join('docs', 'reports', 'project-governance-weekly-report.md');
const DEFAULT_JSON_OUTPUT = path.join('pmo', 'gantt-react', 'public', 'project-governance-weekly-report.json');
const INPUT_BASELINE_PATH = path.join('docs', 'norms', '流程治理', '输入基线问题待办.md');
const QUALITY_REPORT_PATH = path.join('docs', 'reports', 'dcm-bbm-quality-report.md');
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

function normalizeRelativePath(filePath) {
  return filePath.replace(/\\/g, '/');
}

function sourceStatus(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath)) ? 'present' : 'missing';
}

function parseMarkdownTableRows(text) {
  return text
    .split(/\r?\n/)
    .filter(line => /^\|.+\|$/.test(line.trim()))
    .map(line => line.trim().slice(1, -1).split('|').map(cell => cell.trim()))
    .filter(row => !row.every(cell => /^:?-{3,}:?$/.test(cell)));
}

function countInputBaselineIssues() {
  const text = readText(INPUT_BASELINE_PATH);
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
  const text = readText(QUALITY_REPORT_PATH);
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
  if (!snapshotPath) {
    return { counts, source: '未提供工作台快照', sourcePath: '', sourceStatus: 'not_provided' };
  }
  const fullPath = path.resolve(repoRoot, snapshotPath);
  const sourcePath = normalizeRelativePath(path.relative(repoRoot, fullPath));
  if (!fs.existsSync(fullPath)) {
    return { counts, source: `未找到工作台快照：${snapshotPath}`, sourcePath, sourceStatus: 'missing' };
  }

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
  return { counts, source: sourcePath, sourcePath, sourceStatus: 'present' };
}

function formatTypeSummary(typeMap) {
  const entries = [...typeMap.entries()].sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '无';
  return entries.slice(0, 4).map(([type, count]) => `${type} ${count}`).join('；');
}

function buildReportSnapshot({ date, workbenchSnapshot }) {
  const inputBaseline = countInputBaselineIssues();
  const quality = countQualityIssues();
  const { counts: workbench, source: workbenchSource, sourcePath: workbenchSourcePath, sourceStatus: workbenchSourceStatus } = countWorkbenchSnapshot(workbenchSnapshot);

  const departments = sampleDepartments.map(department => {
    const input = inputBaseline.get(department);
    const q = quality.get(department);
    const w = workbench.get(department);
    const nextStep = input.open > 0
      ? '先处理输入基线待确认问题，再进入字段和质量闭环'
      : '维护本周关闭记录并准备双周复盘';
    return {
      department,
      confirmPerson: explicitConfirmers[department],
      inputBaselineOpen: input.open,
      inputBaselineTypes: [...input.byType.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => ({ type, count })),
      qualityBlock: q.BLOCK,
      qualityWarn: q.WARN,
      fieldLedgerGap: w.field_ledger_gap,
      goldSourceConfirmation: w.gold_source_confirmation,
      overdue: w.overdue,
      nextStep
    };
  });

  const summary = departments.reduce((acc, row) => {
    acc.inputBaselineOpen += row.inputBaselineOpen;
    acc.qualityBlock += row.qualityBlock;
    acc.qualityWarn += row.qualityWarn;
    acc.fieldLedgerGap += row.fieldLedgerGap;
    acc.goldSourceConfirmation += row.goldSourceConfirmation;
    acc.overdue += row.overdue;
    return acc;
  }, {
    inputBaselineOpen: 0,
    qualityBlock: 0,
    qualityWarn: 0,
    fieldLedgerGap: 0,
    goldSourceConfirmation: 0,
    overdue: 0
  });

  return {
    schemaVersion: 1,
    generatedDate: date,
    scope: {
      type: 'sample',
      departments: [...sampleDepartments]
    },
    sources: [
      {
        key: 'inputBaselineIssues',
        path: normalizeRelativePath(INPUT_BASELINE_PATH),
        status: sourceStatus(INPUT_BASELINE_PATH)
      },
      {
        key: 'qualityReport',
        path: normalizeRelativePath(QUALITY_REPORT_PATH),
        status: sourceStatus(QUALITY_REPORT_PATH)
      },
      {
        key: 'workbenchSnapshot',
        path: workbenchSourcePath,
        status: workbenchSourceStatus,
        label: workbenchSource
      }
    ],
    summary,
    departments
  };
}

function renderReport({ date, outputPath, jsonOutputPath, workbenchSnapshot }) {
  const snapshot = buildReportSnapshot({ date, workbenchSnapshot });

  const rows = snapshot.departments.map(row => {
    const qualityText = `BLOCK ${row.qualityBlock} / WARN ${row.qualityWarn}`;
    return `| ${row.department} | ${row.confirmPerson} | ${row.inputBaselineOpen} | ${qualityText} | ${row.fieldLedgerGap} | ${row.goldSourceConfirmation} | ${row.overdue} | ${row.nextStep} |`;
  });

  const lines = [
    '# 项目治理周报（双部门样板）',
    '',
    `- 生成日期：${date}`,
    '- 样板部门：工程技术部、项目管理部',
    '- MDM 定位：承接、分派、记录、追踪和验证；规则制定和发布仍由人工回源核验后受控完成。',
    `- 工作台快照：${snapshot.sources.find(source => source.key === 'workbenchSnapshot').label}`,
    '',
    '## 本周治理看板',
    '',
    '| 指标 | 工程技术部 | 项目管理部 | 说明 |',
    '|---|---:|---:|---|',
    `| 输入基线待确认问题 | ${snapshot.departments[0].inputBaselineOpen} | ${snapshot.departments[1].inputBaselineOpen} | 来自 \`docs/norms/流程治理/输入基线问题待办.md\` |`,
    `| 资料质量 BLOCK | ${snapshot.departments[0].qualityBlock} | ${snapshot.departments[1].qualityBlock} | 来自 \`docs/reports/dcm-bbm-quality-report.md\` |`,
    `| 资料质量 WARN | ${snapshot.departments[0].qualityWarn} | ${snapshot.departments[1].qualityWarn} | 用于提示需回源复核的质量风险 |`,
    `| 字段台账缺口 | ${snapshot.departments[0].fieldLedgerGap} | ${snapshot.departments[1].fieldLedgerGap} | 来自角色工作台工作项快照 |`,
    `| 待确认黄金源 | ${snapshot.departments[0].goldSourceConfirmation} | ${snapshot.departments[1].goldSourceConfirmation} | 来自角色工作台工作项快照 |`,
    `| 超期事项 | ${snapshot.departments[0].overdue} | ${snapshot.departments[1].overdue} | 以工作项 dueDate 与当前日期判断 |`,
    '',
    '## 双部门治理台账',
    '',
    '| 部门 | 最终确认人 | 输入基线待处理 | 质量问题 | 字段台账缺口 | 待确认黄金源 | 超期事项 | 下一步 |',
    '|---|---|---:|---|---:|---:|---:|---|',
    ...rows,
    '',
    '## 输入基线问题分布',
    '',
    ...snapshot.departments.map(row => {
      const typeMap = new Map(row.inputBaselineTypes.map(item => [item.type, item.count]));
      return `- ${row.department}：${formatTypeSummary(typeMap)}`;
    }),
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
  fs.mkdirSync(path.dirname(jsonOutputPath), { recursive: true });
  fs.writeFileSync(jsonOutputPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
  return { outputPath, jsonOutputPath };
}

const date = argValue('--date', new Date().toISOString().slice(0, 10));
const outputArg = argValue('--out', DEFAULT_MARKDOWN_OUTPUT);
const outputPath = path.resolve(repoRoot, outputArg);
const jsonOutputArg = argValue('--json-out', DEFAULT_JSON_OUTPUT);
const jsonOutputPath = path.resolve(repoRoot, jsonOutputArg);
const workbenchSnapshot = argValue('--workbench-json', '');
const written = renderReport({ date, outputPath, jsonOutputPath, workbenchSnapshot });
console.log(`project_governance_report=${normalizeRelativePath(path.relative(repoRoot, written.outputPath))}`);
console.log(`project_governance_snapshot=${normalizeRelativePath(path.relative(repoRoot, written.jsonOutputPath))}`);
