import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const files = {
  rootTasks: 'pmo/tasks.json',
  appTasks: 'pmo/gantt-react/public/tasks.json',
  rootManifest: 'pmo/pmo-source-manifest.json',
  appManifest: 'pmo/gantt-react/public/pmo-source-manifest.json',
  planSource: 'pmo/信息化项目_计划管控真源.md',
  wbsSource: 'pmo/信息化项目_WBS结构真源.md',
  pmoReadme: 'pmo/README.md',
  appReadme: 'pmo/gantt-react/README.md'
};
const activePmoBuildScript = 'pmo/build_pmo_task_data.py';
const expectedTaskCount = 516;
const expectedTaskFieldCount = 43;

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function sha256(text) {
  return createHash('sha256').update(text).digest('hex');
}

function readJson(relativePath) {
  try {
    return JSON.parse(readText(relativePath));
  } catch (error) {
    throw new Error(`${relativePath} is not valid JSON: ${error.message}`);
  }
}

function readMarkdownJsonBlock(relativePath, sourceType) {
  const pattern = new RegExp(
    `<!-- pmo-${sourceType}-source:start -->\\s*\x60\x60\x60json\\s*([\\s\\S]*?)\\s*\x60\x60\x60\\s*<!-- pmo-${sourceType}-source:end -->`
  );
  const match = readText(relativePath).match(pattern);
  assert(match, `${relativePath} must contain the pmo-${sourceType} machine source block`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    throw new Error(`${relativePath} machine source block is not valid JSON: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function compareTextHash(leftPath, rightPath) {
  const left = readText(leftPath);
  const right = readText(rightPath);
  const leftHash = sha256(left);
  const rightHash = sha256(right);

  assert(
    leftHash === rightHash,
    `${leftPath} and ${rightPath} are out of sync (${leftHash.slice(0, 12)} != ${rightHash.slice(0, 12)})`
  );

  return leftHash;
}

const taskHash = compareTextHash(files.rootTasks, files.appTasks);
const manifestHash = compareTextHash(files.rootManifest, files.appManifest);

const tasks = readJson(files.rootTasks);
const manifest = readJson(files.rootManifest);
const appManifest = readJson(files.appManifest);
const planSource = readMarkdownJsonBlock(files.planSource, 'plan');
const wbsSource = readMarkdownJsonBlock(files.wbsSource, 'wbs');
const planSourceText = readText(files.planSource);
const pmoReadmeText = readText(files.pmoReadme);
const appReadmeText = readText(files.appReadme);
const buildScriptText = readText(activePmoBuildScript);
const deprecatedPmoInputs = [
  'pmo/信息化项目_Project_H5最终执行版_导入表.xlsx',
  'pmo/信息化项目_Project_H5最终执行版_导入表_旧版备份.xlsx',
  'pmo/信息化项目组项目管理表.mpp',
  'pmo/信息化项目.csv',
  'pmo/md_to_xlsx.py',
];

assert(Array.isArray(tasks), `${files.rootTasks} must be a JSON array`);
assert(tasks.length > 0, `${files.rootTasks} must contain at least one task`);
assert(tasks.length === expectedTaskCount, `${files.rootTasks} must contain ${expectedTaskCount} tasks, got ${tasks.length}`);
const firstTaskFieldKeys = Object.keys(tasks[0]).sort();
assert(
  firstTaskFieldKeys.length === expectedTaskFieldCount,
  `${files.rootTasks} first task must contain ${expectedTaskFieldCount} fields, got ${firstTaskFieldKeys.length}`
);
const taskFieldUnion = new Set();
for (const [index, task] of tasks.entries()) {
  const rowKeys = Object.keys(task).sort();
  rowKeys.forEach((key) => taskFieldUnion.add(key));
  assert(
    rowKeys.length === firstTaskFieldKeys.length && rowKeys.every((key, keyIndex) => key === firstTaskFieldKeys[keyIndex]),
    `${files.rootTasks} task ${task.id || `row ${index + 1}`} field set differs from the 43-field contract`
  );
}
assert(
  taskFieldUnion.size === expectedTaskFieldCount,
  `${files.rootTasks} field union must contain ${expectedTaskFieldCount} fields, got ${taskFieldUnion.size}`
);
assert(Array.isArray(planSource.tasks), `${files.planSource} tasks must be an array`);
assert(Array.isArray(wbsSource.nodes), `${files.wbsSource} nodes must be an array`);
assert(planSource.tasks.length === tasks.length, `${files.planSource} task count must equal generated task count`);
assert(wbsSource.nodes.length === tasks.length, `${files.wbsSource} node count must equal generated task count`);
assert(existsSync(resolve(root, activePmoBuildScript)), `${activePmoBuildScript} must exist as the PMO Markdown truth-source builder`);
assert(/TASK_OUTPUT_FIELD_KEYS\s*=/.test(buildScriptText), `${activePmoBuildScript} must define TASK_OUTPUT_FIELD_KEYS`);
assert(!existsSync(resolve(root, 'pmo/convert_xlsx.py')), 'pmo/convert_xlsx.py has been renamed because it no longer reads XLSX');
assert(
  planSource?.summary?.recordCount === expectedTaskCount,
  `${files.planSource} summary.recordCount must be ${expectedTaskCount}, got ${planSource?.summary?.recordCount}`
);
assert(
  planSource?.summary?.fieldCount === expectedTaskFieldCount,
  `${files.planSource} summary.fieldCount must be ${expectedTaskFieldCount}, got ${planSource?.summary?.fieldCount}`
);
assert(
  /\|\s*字段数\s*\|\s*43\s*\|/.test(planSourceText),
  `${files.planSource} human-readable summary must state 43 fields`
);
assert(
  /\|\s*字段数\s*\|\s*43\s*\|/.test(pmoReadmeText),
  `${files.pmoReadme} must state 43 fields`
);
assert(
  /43个顶层字段/.test(appReadmeText),
  `${files.appReadme} must state 43 top-level fields`
);
assert(
  manifest?.taskSummary?.recordCount === tasks.length,
  `manifest taskSummary.recordCount (${manifest?.taskSummary?.recordCount}) must equal task count (${tasks.length})`
);
for (const [manifestPath, candidate] of [
  [files.rootManifest, manifest],
  [files.appManifest, appManifest],
]) {
  assert(
    candidate?.taskSummary?.fieldCount === expectedTaskFieldCount,
    `${manifestPath} taskSummary.fieldCount must be ${expectedTaskFieldCount}, got ${candidate?.taskSummary?.fieldCount}`
  );
  assert(
    candidate?.standardGovernance?.fieldCount === expectedTaskFieldCount,
    `${manifestPath} standardGovernance.fieldCount must be ${expectedTaskFieldCount}, got ${candidate?.standardGovernance?.fieldCount}`
  );
}
assert(
  manifest?.standardGovernance?.generatedBy === activePmoBuildScript,
  `manifest standardGovernance.generatedBy must be ${activePmoBuildScript}, got ${manifest?.standardGovernance?.generatedBy}`
);
assert(
  Array.isArray(manifest.serviceOutputs) &&
    manifest.serviceOutputs.includes('tasks.json') &&
    manifest.serviceOutputs.includes('gantt-react/public/tasks.json'),
  'manifest serviceOutputs must list both PMO task outputs'
);
assert(!manifest.legacyInput, 'manifest must not expose legacyInput for removed XLSX/MPP files');
for (const relativePath of deprecatedPmoInputs) {
  assert(!existsSync(resolve(root, relativePath)), `${relativePath} has been retired and must not exist`);
}

const planTaskByWbs = new Map(planSource.tasks.map((task) => [String(task.WBS), task]));
const wbsNodeByWbs = new Map(wbsSource.nodes.map((node) => [String(node.WBS), node]));
for (const task of tasks) {
  const planTask = planTaskByWbs.get(String(task.wbs));
  const wbsNode = wbsNodeByWbs.get(String(task.wbs));
  assert(planTask, `${files.planSource} is missing WBS ${task.wbs}`);
  assert(wbsNode, `${files.wbsSource} is missing WBS ${task.wbs}`);
  assert(String(planTask.ID) === String(task.id), `Plan task ID mismatch for WBS ${task.wbs}`);
  assert(planTask['开始时间'] === task.start, `Plan start mismatch for WBS ${task.wbs}`);
  assert(planTask['完成时间'] === task.finish, `Plan finish mismatch for WBS ${task.wbs}`);
  assert(String(wbsNode['任务ID']) === String(task.id), `WBS task ID mismatch for WBS ${task.wbs}`);
  assert(wbsNode['开始时间'] === task.start, `WBS start mismatch for WBS ${task.wbs}`);
  assert(wbsNode['完成时间'] === task.finish, `WBS finish mismatch for WBS ${task.wbs}`);
  assert(!task.start || !task.finish || task.start <= task.finish, `Task ${task.wbs} starts after it finishes`);
}

for (const overview of wbsSource.topLevelOverview || []) {
  const task = tasks.find((item) => String(item.wbs) === String(overview['一级WBS']));
  assert(task, `Top-level WBS ${overview['一级WBS']} is missing from generated tasks`);
  assert(overview['开始时间'] === task.start, `Top-level WBS ${task.wbs} start is out of sync`);
  assert(overview['完成时间'] === task.finish, `Top-level WBS ${task.wbs} finish is out of sync`);
}

const leaveStart = '2026-08-03';
const leaveEnd = '2026-08-07';
const leaveEndpointTasks = tasks.filter((task) =>
  [task.start, task.finish].some((value) => value && value >= leaveStart && value <= leaveEnd)
);
assert(
  leaveEndpointTasks.length === 0,
  `Task start/finish dates must not fall in the concentrated leave window: ${leaveEndpointTasks
    .slice(0, 8)
    .map((task) => `${task.wbs} ${task.name}`)
    .join(' | ')}`
);

const kickoffTask = tasks.find((task) => task.name === '项目启动会召开');
assert(kickoffTask, 'tasks must include 项目启动会召开');
assert(
  kickoffTask.start === '2026-06-23' && kickoffTask.finish === '2026-06-23',
  `项目启动会召开 must be scheduled on 2026-06-23, got ${kickoffTask.start} to ${kickoffTask.finish}`
);
assert(
  manifest?.taskSummary?.projectStart === '2026-06-16',
  `manifest taskSummary.projectStart must be 2026-06-16, got ${manifest?.taskSummary?.projectStart}`
);
assert(
  manifest?.taskSummary?.projectFinish === '2028-02-22',
  `manifest taskSummary.projectFinish must be 2028-02-22, got ${manifest?.taskSummary?.projectFinish}`
);

const holidayResumeTask = tasks.find((task) => task.wbs === '1.2.7.2');
assert(
  holidayResumeTask?.start === '2026-08-10' && holidayResumeTask?.finish === '2026-08-11',
  `WBS 1.2.7.2 must resume on 2026-08-10, got ${holidayResumeTask?.start} to ${holidayResumeTask?.finish}`
);

const crossHolidayTask = tasks.find((task) => task.wbs === '4.1.2');
assert(
  crossHolidayTask?.start === '2026-07-28' && crossHolidayTask?.finish === '2026-08-13',
  `WBS 4.1.2 must retain its start and extend to 2026-08-13, got ${crossHolidayTask?.start} to ${crossHolidayTask?.finish}`
);

const finalAcceptanceTask = tasks.find((task) => task.wbs === '10.3.3');
assert(
  finalAcceptanceTask?.start === '2028-02-22' && finalAcceptanceTask?.finish === '2028-02-22',
  `WBS 10.3.3 must be scheduled on 2028-02-22, got ${finalAcceptanceTask?.start} to ${finalAcceptanceTask?.finish}`
);

console.log(
  `PMO task data check passed: ${tasks.length} tasks, ${taskFieldUnion.size} fields, ` +
  `tasks ${taskHash.slice(0, 12)}, manifest ${manifestHash.slice(0, 12)}`
);
