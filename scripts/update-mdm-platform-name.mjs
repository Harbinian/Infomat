import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const planFile = 'pmo/信息化项目_计划管控真源.md';
const amendmentsFile = 'pmo/信息化项目_WBS增补记录.md';
const reviewDir = 'artifacts/pmo/project-initiation/outputs/01a176bc-3c7b-73e3-861a-fcf05fd3595c';
const reviewFiles = [
  'informatization-phase1-proposal-review-edition.md',
  'informatization-phase1-execution-wbs.md',
  'informatization-phase1-wbs-monthly-budget.md',
].map(file => `${reviewDir}/${file}`);
const explicitFiles = [
  'docs/glossary.md',
  'docs/contracts/AGENTS.md',
  'apps/mdm-platform/frontend/tests/business-presentation.test.js',
  'apps/mdm-platform/frontend/tests/workbench-review-presentation.test.js',
  ...[
    'data-map-handoff-integration-browser',
    'data-map-handoff-workspace-browser',
    'data-map-handoff-workspace-compat-browser',
    'frontend-shell-browser',
    'native-governance-receipts-browser-session',
    'process-authoring-browser',
    'process-review-presentation-browser',
    'quality-browser',
    'tech-ui-browser',
  ].map(test => `apps/mdm-platform/scripts/test-${test}.js`),
  'apps/structured-output-service/scripts/test-service-contract.js',
  ...reviewFiles,
];
const textFile = /\.(?:md|mjs|cjs|js|jsx|ts|tsx|html|ps1|py|ya?ml)$/i;
const maintained = /^(?:[^/]+|apps\/.*|scripts\/.*|pmo\/.*|shared\/.*|\.(?:agents|claude)\/skills\/.*)$/;
const excluded = /(?:^|\/)(?:\.git|history|historical|archive|archives|node_modules|dist|vendor|fixtures?|snapshots?|migrations?|tests?|test-results|coverage)(?:\/|$)|^pmo\/(?:deliverables|weekly-issues|procedure-management)\/|^apps\/structured-output-service\/public\/workbench\/|^apps\/mdm-platform\/server\/rules\/|(?:\.test|\.spec)\.[^/]+$|(?:Baseline|Migration)\.[^/]+$/i;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function read(file) {
  return decoder.decode(readFileSync(path.join(root, file)));
}

function isRegularFile(file) {
  return lstatSync(path.join(root, file), { throwIfNoEntry: false })?.isFile();
}

function renameLine(line, file) {
  if (/^\s*[-*]?\s*2026-10-27按用户授权/.test(line)) return line;
  if (file.endsWith('/ROLE_HANDOFFS.md') && /^\s*>/.test(line)) return line;
  const prose = file.endsWith('.md');
  return line
    .replace(/(?<![\w:./@-])(?:3000[ \t]*(?:及[ \t]*)?(?:主数据平台|治理平台|平台)|(?:流程与数据治理平台|MDM[ \t]*平台)[ \t]*[（(]3000[）)]|MDM[ \t]+平台)/g, 'MDM平台')
    .replace(/(?<=\.md#)3000(?=-内部集成路径)/g, 'mdm平台')
    .replace(/\bInfomat 3000\b/g, 'MDM平台')
    .replace(/(?<![\w:./@-])3000\/MDM(?![\w/-])/g, 'MDM平台')
    .replace(/\b3000(?=[ \t]+(?:Docker|Windows|RBAC|README|D-06[CD])\b)/g, 'MDM平台')
    .replace(/(?<=\b(?:Never modify or call|shared by) )3000(?=\/3001)/g, 'MDM platform')
    .replace(/(?<=调用或修改|不连接)3000(?=\/3001)/g, 'MDM平台')
    .replace(/指向正式 3000\/3001/g, '指向正式服务端口 3000/3001')
    .replace(/(?<![\w:./@-])3000(?![\w./-])/g, (value, index, current) => {
      const left = current.slice(0, index);
      const right = current.slice(index + value.length);
      if (/\b(?:PORT|MdmPort|port)\s*(?:=|:)\s*["']?\s*$|(?:端口(?:为)?|监听|拒绝(?:正式)?)\s*[:：=]?[ \t`]*$/.test(left)
        || /^[ \t`]*(?:(?:[／/、及和与]\s*\d{2,5}\s*)+|[是为](?:当前)?(?:服务)?)?(?:端口|毫秒|秒\b|ms\b|px\b|元|条|行|字节)/.test(right)
        || /['"]$/.test(left) && /^['"]/.test(right)) return value;
      if (/\b(?:Only the|Consumed by|known|Windows-only|No calls to)\s+$/.test(left)
        || /\bshared by\s+$/.test(left)) return 'MDM platform';
      if (prose && /^[ \t]*[|｜：、]/.test(right)) return 'MDM平台';
      if (/[\p{Script=Han}][ \t`]*$/u.test(left)
        || /^[ \t`]*[\p{Script=Han}]/u.test(right)) return 'MDM平台';
      return value;
    })
    .replace(/(?<=3001[\/／])3000(?=[\s`、）。，]|$)/g, 'MDM平台')
    .replace(/MDM平台[ \t]*主数据平台/g, 'MDM平台');
}

function rename(source, file) {
  const current = source.split(/(?<=\n)/).map(line => renameLine(line, file)).join('');
  return reviewFiles.includes(file) ? current.replace(/主数据平台/g, 'MDM平台') : current;
}

function sourceBlock(markdown, kind) {
  const block = markdown.match(new RegExp('<!-- pmo-' + kind + '-source:start -->\\s*```json\\s*([\\s\\S]*?)\\s*```'));
  if (!block) throw new Error(`Missing PMO ${kind} source block`);
  return block[1];
}

function recordPlanChanges(before, after, amendments) {
  const oldPlan = JSON.parse(sourceBlock(before, 'plan'));
  const newPlan = JSON.parse(sourceBlock(after, 'plan'));
  const fields = new Set([...read('pmo/build_pmo_task_data.py')
    .split('TASK_FIELD_MAP =')[0].matchAll(/^\s*\("([^"]+)", "[^"]+"\),$/gm)].map(match => match[1]));
  const records = oldPlan.tasks.flatMap((task, index) => {
    const updated = newPlan.tasks[index];
    const changes = Object.keys(task).filter(label => task[label] !== updated[label]);
    const displayChanges = changes.filter(label => fields.has(label));
    if (!displayChanges.length) return [];
    return [{
      taskId: String(task.ID),
      wbs: task.WBS,
      isSummary: task['任务类型'] === '摘要',
      fields: displayChanges.map(label => ({ field: label, before: task[label], after: updated[label] })),
    }];
  });
  if (!records.length) return amendments;
  const block = sourceBlock(amendments, 'amendments');
  const batches = JSON.parse(block).batches;
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const batchId = `wbs-${date.replaceAll('-', '')}-mdm-platform-name`;
  if (batches.some(batch => batch.date > date)) {
    throw new Error('Cannot append the terminology batch after the existing amendment dates');
  }
  const usedIds = new Set(batches.map(batch => batch.id));
  let id = batchId;
  for (let suffix = 2; usedIds.has(id); suffix++) id = `${batchId}-${suffix}`;
  const batch = {
    id,
    date,
    title: '统一MDM平台名称',
    scope: '统一平台称谓，沿用原有任务、排程、责任、依赖与交付物编号。',
    records,
  };
  const newline = amendments.includes('\r\n') ? '\r\n' : '\n';
  const batchText = JSON.stringify(batch, null, 2).split('\n').map(line => `    ${line}`).join(newline);
  const updatedBlock = block.replace(/(\r?\n  \]\s*})$/, `,${newline}${batchText}$1`);
  if (updatedBlock === block) throw new Error('Could not append the PMO terminology batch');
  JSON.parse(updatedBlock);
  return amendments.replace(block, () => updatedBlock);
}

const mode = process.argv[2] ?? '--preview';
if (!['--preview', '--check', '--apply'].includes(mode) || process.argv.length > 3) {
  throw new Error('Usage: node scripts/update-mdm-platform-name.mjs [--preview|--check|--apply]');
}
const gitFiles = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
  cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}).split('\0');
const candidates = [...new Set([...gitFiles.filter(file => textFile.test(file) && maintained.test(file)
  && !excluded.test(file) && file !== amendmentsFile && file !== 'scripts/update-mdm-platform-name.mjs'), ...explicitFiles])];
const changes = new Map();
for (const file of candidates.sort()) {
  if (!isRegularFile(file)) continue;
  const source = read(file);
  const result = rename(source, file);
  if (result !== source) changes.set(file, { source, result });
}
if (changes.has(planFile)) {
  const plan = changes.get(planFile);
  const source = read(amendmentsFile);
  const result = recordPlanChanges(plan.source, plan.result, source);
  if (result !== source) changes.set(amendmentsFile, { source, result });
}
for (const [file, change] of changes) {
  if (mode === '--apply') {
    if (read(file) !== change.source) throw new Error(`File changed since scan: ${file}`);
    writeFileSync(path.join(root, file), change.result, 'utf8');
  }
  console.log(file);
}
console.log(`${mode.slice(2)}: ${changes.size} file(s)`);
if (mode === '--check' && changes.size) process.exitCode = 1;
