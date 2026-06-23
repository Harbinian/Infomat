import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();

const files = {
  rootTasks: 'pmo/tasks.json',
  appTasks: 'pmo/gantt-react/public/tasks.json',
  rootManifest: 'pmo/pmo-source-manifest.json',
  appManifest: 'pmo/gantt-react/public/pmo-source-manifest.json'
};

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

assert(Array.isArray(tasks), `${files.rootTasks} must be a JSON array`);
assert(tasks.length > 0, `${files.rootTasks} must contain at least one task`);
assert(
  manifest?.taskSummary?.recordCount === tasks.length,
  `manifest taskSummary.recordCount (${manifest?.taskSummary?.recordCount}) must equal task count (${tasks.length})`
);
assert(
  Array.isArray(manifest.serviceOutputs) &&
    manifest.serviceOutputs.includes('tasks.json') &&
    manifest.serviceOutputs.includes('gantt-react/public/tasks.json'),
  'manifest serviceOutputs must list both PMO task outputs'
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

console.log(`PMO task data check passed: ${tasks.length} tasks, tasks ${taskHash.slice(0, 12)}, manifest ${manifestHash.slice(0, 12)}`);
