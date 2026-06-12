import { isMilestoneTask, normalizeTasks } from '../gantt-react/src/utils/dateUtils.js';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const normalTenDayTask = {
  id: 8,
  wbs: '1.2.4',
  name: '业务现状调研-MES/低代码平台',
  type: '调研',
  duration: '10工作日',
  milestone: '否',
};

const normalTwentyDayTask = {
  id: 427,
  wbs: '10.1.6',
  name: '数字员工低风险场景原型',
  type: 'AI应用',
  duration: '20工作日',
  milestone: '否',
};

const explicitZeroDurationTask = {
  id: 3,
  wbs: '1.1.2',
  name: '项目启动会召开',
  type: '启动',
  duration: '0工作日',
  milestone: '否',
};

const explicitMilestoneTask = {
  id: 434,
  wbs: '10.3.3',
  name: '项目总体验收',
  type: '里程碑',
  duration: '0工作日',
  milestone: '是',
};

assert(!isMilestoneTask(normalTenDayTask), '10工作日的普通调研任务不应被判定为里程碑');
assert(!isMilestoneTask(normalTwentyDayTask), '20工作日的普通任务不应被判定为里程碑');
assert(isMilestoneTask(explicitZeroDurationTask), '明确 0工作日的任务应被判定为里程碑');
assert(isMilestoneTask(explicitMilestoneTask), '里程碑字段/类型明确标记的任务应被判定为里程碑');

const normalized = normalizeTasks([
  { ...normalTenDayTask, start: '2026-07-15', finish: '2026-07-28' },
  { ...explicitZeroDurationTask, start: '2026-06-08', finish: '2026-06-08' },
]);
const task124 = normalized.find(task => task.wbs === '1.2.4');
assert(task124 && task124.isMilestone === false, '规范化后的 1.2.4 不应带 isMilestone');

console.log('PMO milestone rule smoke passed');
