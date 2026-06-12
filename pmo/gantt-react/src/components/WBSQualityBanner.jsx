import { isZeroWorkdayDuration } from '../utils/dateUtils';

export default function WBSQualityBanner({ rawTasks }) {
  if (!rawTasks || rawTasks.length === 0) return null;

  const wbsMap = {};
  rawTasks.forEach(task => {
    const wbs = task.wbs;
    if (!wbsMap[wbs]) wbsMap[wbs] = [];
    wbsMap[wbs].push(task);
  });
  const duplicateWbs = Object.entries(wbsMap).filter(([, tasks]) => tasks.length > 1);

  const allWbs = new Set(rawTasks.map(task => String(task.wbs)));
  const milestoneParents = rawTasks.filter(task => {
    const isMilestone = task.milestone === '是' || task.type === '里程碑' || isZeroWorkdayDuration(task.duration);
    return isMilestone && rawTasks.some(child => String(child.wbs).startsWith(String(task.wbs) + '.') && child.wbs !== task.wbs);
  });
  const toleratedMilestoneParents = milestoneParents.filter(task => /ERP-MES/.test(task.name || ''));
  const unexpectedMilestoneParents = milestoneParents.filter(task => !/ERP-MES/.test(task.name || ''));

  const orphans = rawTasks.filter(task => {
    const parts = String(task.wbs).split('.');
    return parts.length > 1 && !allWbs.has(parts.slice(0, -1).join('.'));
  });

  const backRefs = [];
  const idSet = new Set(rawTasks.map(task => task.id));
  rawTasks.forEach(task => {
    if (!task.predecessors) return;
    String(task.predecessors).split(',').forEach(pred => {
      const predId = parseInt(pred.trim(), 10);
      if (predId && idSet.has(predId) && predId > task.id) backRefs.push({ id: task.id, pred: predId });
    });
  });

  const issues = [];
  if (duplicateWbs.length > 0) issues.push(`${duplicateWbs.length} 组重复WBS`);
  if (unexpectedMilestoneParents.length > 0) issues.push(`${unexpectedMilestoneParents.length} 个里程碑占用父级编号`);
  if (orphans.length > 0) issues.push(`${orphans.length} 个子任务缺父级`);
  if (backRefs.length > 0) issues.push(`${backRefs.length} 处后向前置引用`);

  if (issues.length === 0) {
    return (
      <div className="wbs-quality-banner clean">
        <span>WBS 数据质量：通过</span>
        <span className="wbs-quality-detail">
          0重复WBS | 0孤儿节点 | {rawTasks.length}任务
          {toleratedMilestoneParents.length ? ` | ${toleratedMilestoneParents.length}个已确认父级里程碑` : ''}
        </span>
      </div>
    );
  }

  return (
    <div className="wbs-quality-banner warning">
      <span>WBS 数据质量：需关注（{issues.join('、')}）</span>
      <span className="wbs-quality-detail">源数据仍需治理，展示层已规范化处理</span>
    </div>
  );
}
