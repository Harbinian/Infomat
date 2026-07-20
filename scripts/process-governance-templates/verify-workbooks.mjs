import fs from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SpreadsheetFile } from '@oai/artifact-tool';

const SHEETS = [
  '00_填写说明',
  '01_流程总览',
  '02_业务行为',
  '03_数据字典',
  '04_证据索引',
  '05_完整性检查',
  '98_下拉选项',
  '99_来源快照',
];

function parseArgs(argv) {
  const args = { data: '', output: '', report: '' };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--data') args.data = resolve(argv[++index] || '');
    else if (argv[index] === '--output') args.output = resolve(argv[++index] || '');
    else if (argv[index] === '--report') args.report = resolve(argv[++index] || '');
  }
  if (!args.data || !args.output || !args.report) {
    throw new Error('Usage: node verify-workbooks.mjs --data <json> --output <dir> --report <json>');
  }
  return args;
}

function parseInspect(ndjson) {
  const lines = String(ndjson || '').split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    const value = JSON.parse(line);
    if (value.kind === 'table') return value;
  }
  throw new Error(`Table inspect result missing: ${ndjson}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const args = parseArgs(process.argv.slice(2));
const pkg = JSON.parse(await fs.readFile(args.data, 'utf8'));
const packageDate = String(pkg.generatedAt || pkg.snapshotDate).slice(0, 10);
const reports = [];

for (const department of pkg.departments) {
  const fileName = `${department.name}_流程与数据梳理模板_${packageDate}.xlsx`;
  const filePath = join(args.output, fileName);
  const workbook = await SpreadsheetFile.importXlsx(await fs.readFile(filePath));
  for (const name of SHEETS) assert(workbook.worksheets.getItem(name), `${department.name}: sheet missing ${name}`);

  const processTitleInspect = parseInspect((await workbook.inspect({
    kind: 'table',
    range: `'01_流程总览'!G4:G${3 + department.counts.processes}`,
    include: 'values',
    tableMaxRows: department.counts.processes + 2,
    tableMaxCols: 2,
    maxChars: 200000,
  })).ndjson);
  const behaviorTitleInspect = parseInspect((await workbook.inspect({
    kind: 'table',
    range: `'02_业务行为'!H4:H${3 + department.counts.behaviors}`,
    include: 'values',
    tableMaxRows: department.counts.behaviors + 2,
    tableMaxCols: 2,
    maxChars: 400000,
  })).ndjson);
  const processTitles = processTitleInspect.values.flat().map(value => String(value || '').trim());
  const behaviorTitles = behaviorTitleInspect.values.flat().map(value => String(value || '').trim());
  const missingProcessTitles = processTitles.filter(value => !value || value === '未提供制度原文（待部门补证）').length;
  const missingBehaviorTitles = behaviorTitles.filter(value => !value || value === '未提供制度原文（待部门补证）').length;

  const summary = parseInspect((await workbook.inspect({
    kind: 'table',
    range: `'05_完整性检查'!A4:C16`,
    include: 'values,formulas',
    tableMaxRows: 20,
    tableMaxCols: 5,
    maxChars: 10000,
  })).ndjson);
  const metrics = Object.fromEntries(summary.values.slice(1).map(row => [row[0], row[1]]));
  const formulaScan = await workbook.inspect({
    kind: 'match',
    searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A',
    options: { useRegex: true, maxResults: 100 },
    summary: `${department.name} final formula error scan`,
    maxChars: 5000,
  });

  assert(processTitles.length === department.counts.processes, `${department.name}: process title row count mismatch`);
  assert(behaviorTitles.length === department.counts.behaviors, `${department.name}: behavior title row count mismatch`);
  assert(missingProcessTitles === 0, `${department.name}: ${missingProcessTitles} process titles missing`);
  assert(missingBehaviorTitles === 0, `${department.name}: ${missingBehaviorTitles} behavior titles missing`);
  assert(Number(metrics['L3流程总数']) === department.counts.processes, `${department.name}: L3 summary mismatch`);
  assert(Number(metrics['A1业务行为总数']) === department.counts.behaviors, `${department.name}: A1 summary mismatch`);
  assert(Number(metrics['系统承接待确认']) === department.counts.unmappedProcesses, `${department.name}: unmapped system count mismatch`);
  assert(Number(metrics['流程缺原文证据']) === department.counts.blockingProcessEvidence, `${department.name}: process evidence blocker count mismatch`);
  assert(Number(metrics['A1缺原文证据']) === department.counts.blockingBehaviorEvidence, `${department.name}: behavior evidence blocker count mismatch`);
  assert(String(formulaScan.ndjson).includes('matched 0 entries'), `${department.name}: formula error found`);

  reports.push({
    department: department.name,
    fileName,
    sheets: SHEETS.length,
    processes: department.counts.processes,
    behaviors: department.counts.behaviors,
    unmappedProcesses: department.counts.unmappedProcesses,
    missingProcessTitles,
    missingBehaviorTitles,
    ambiguousProcessTitles: department.counts.ambiguousProcessTitles,
    ambiguousBehaviorTitles: department.counts.ambiguousBehaviorTitles,
    blockingProcessEvidence: department.counts.blockingProcessEvidence,
    blockingBehaviorEvidence: department.counts.blockingBehaviorEvidence,
    formulaErrors: 0,
  });
  process.stdout.write(`${department.name}: verified\n`);
}

const totals = reports.reduce((result, item) => ({
  processes: result.processes + item.processes,
  behaviors: result.behaviors + item.behaviors,
  unmappedProcesses: result.unmappedProcesses + item.unmappedProcesses,
  blockingProcessEvidence: result.blockingProcessEvidence + item.blockingProcessEvidence,
  blockingBehaviorEvidence: result.blockingBehaviorEvidence + item.blockingBehaviorEvidence,
  formulaErrors: result.formulaErrors + item.formulaErrors,
}), { processes: 0, behaviors: 0, unmappedProcesses: 0, blockingProcessEvidence: 0, blockingBehaviorEvidence: 0, formulaErrors: 0 });
assert(totals.processes === pkg.totals.processes, 'Final process total mismatch');
assert(totals.behaviors === pkg.totals.behaviors, 'Final behavior total mismatch');
assert(totals.unmappedProcesses === pkg.totals.unmappedProcesses, 'Final unmapped process total mismatch');
assert(totals.blockingProcessEvidence === pkg.totals.blockingProcessEvidence, 'Final process evidence blocker total mismatch');
assert(totals.blockingBehaviorEvidence === pkg.totals.blockingBehaviorEvidence, 'Final behavior evidence blocker total mismatch');

await fs.writeFile(args.report, `${JSON.stringify({ packageDate, snapshotDate: pkg.snapshotDate, totals, reports }, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ report: args.report, totals })}\n`);
