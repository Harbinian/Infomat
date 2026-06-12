import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const tasksPath = resolve(root, 'pmo', 'tasks.json');
const tasks = JSON.parse(readFileSync(tasksPath, 'utf8'));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function depthOf(wbs) {
  return String(wbs || '').split('.').filter(Boolean).length;
}

function parentWbsOf(wbs) {
  const parts = String(wbs || '').split('.');
  return parts.length > 1 ? parts.slice(0, -1).join('.') : '';
}

function minDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[0] || '';
}

function maxDate(values) {
  const dates = values.filter(Boolean).sort();
  return dates[dates.length - 1] || '';
}

const byWbs = new Map(tasks.map(task => [String(task.wbs), task]));
const childrenByWbs = new Map();

for (const task of tasks) {
  const parentWbs = parentWbsOf(task.wbs);
  if (!parentWbs) continue;
  if (!childrenByWbs.has(parentWbs)) childrenByWbs.set(parentWbs, []);
  childrenByWbs.get(parentWbs).push(task);
}

const directLeafNodes = tasks.filter(
  task => depthOf(task.wbs) === 2 && !childrenByWbs.has(String(task.wbs)) && task.type !== '摘要'
);
assert(
  directLeafNodes.length === 0,
  `Found ${directLeafNodes.length} level-2 leaf node(s): ${directLeafNodes.slice(0, 12).map(task => `${task.wbs} ${task.name}`).join(' | ')}`
);

const nonSummaryParents = [];
for (const [wbs, children] of childrenByWbs) {
  const parent = byWbs.get(wbs);
  assert(parent, `Missing parent node ${wbs}`);
  if (depthOf(wbs) === 2 && parent.type !== '摘要') {
    nonSummaryParents.push(`${parent.wbs} ${parent.name} (${parent.type || '-'})`);
  }

  const expectedStart = minDate(children.map(child => child.start));
  const expectedFinish = maxDate(children.map(child => child.finish));
  if (expectedStart && expectedFinish) {
    assert(
      parent.start <= expectedStart && parent.finish >= expectedFinish,
      `Parent ${parent.wbs} ${parent.name} does not cover children (${parent.start}..${parent.finish}, expected to cover ${expectedStart}..${expectedFinish})`
    );
  }
}

assert(
  nonSummaryParents.length === 0,
  `Found level-2 parent node(s) that are not 摘要: ${nonSummaryParents.slice(0, 12).join(' | ')}`
);

const maxDepth = Math.max(...tasks.map(task => depthOf(task.wbs)));
assert(maxDepth <= 3, `Expected WBS depth <= 3, got ${maxDepth}`);

console.log(`PMO WBS semantic-depth check passed: ${tasks.length} tasks, ${childrenByWbs.size} parent nodes`);
