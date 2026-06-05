import { useMemo } from 'react';
import { applyFilters, formatDate, parseDate } from '../utils/dateUtils';

const TASK_FILTER_DEFAULTS = {
  year: 'all',
  mainline: 'all',
  department: 'all',
  vendor: 'all',
  risk: 'all',
  type: 'all',
  milestone: 'all',
  search: '',
  wbsDepth: 'all',
  taskKind: 'all',
};

function compareWbs(a, b) {
  const la = String(a || '').split('.').map(Number);
  const lb = String(b || '').split('.').map(Number);
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if ((la[i] || 0) !== (lb[i] || 0)) return (la[i] || 0) - (lb[i] || 0);
  }
  return 0;
}

function describeType(task) {
  if (task.isMilestone) return '里程碑';
  if (task.isSummary) return '摘要';
  if (task.type) return task.type;
  return '普通';
}

export default function TaskLedger({ tasks = [], filters = {} }) {
  const mergedFilters = useMemo(
    () => ({ ...TASK_FILTER_DEFAULTS, ...filters }),
    [filters]
  );

  const filtered = useMemo(() => {
    if (!tasks.length) return [];
    return applyFilters(tasks, mergedFilters, 'all');
  }, [tasks, mergedFilters]);

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => compareWbs(a.wbs, b.wbs)),
    [filtered]
  );

  const summary = useMemo(() => {
    const highRisk = sorted.filter(t => t.risk === '高').length;
    const milestones = sorted.filter(t => t.isMilestone).length;
    const summaryTasks = sorted.filter(t => t.isSummary).length;
    return { highRisk, milestones, summaryTasks };
  }, [sorted]);

  const activeFilterChips = useMemo(() => {
    const chips = [];
    if (mergedFilters.taskKind && mergedFilters.taskKind !== 'all') {
      const map = { normal: '普通任务', summary: '摘要任务' };
      chips.push(map[mergedFilters.taskKind] || mergedFilters.taskKind);
    }
    if (mergedFilters.milestone === 'yes') chips.push('里程碑');
    if (mergedFilters.risk && mergedFilters.risk !== 'all') chips.push(`风险=${mergedFilters.risk}`);
    return chips;
  }, [mergedFilters]);

  return (
    <div className="task-ledger-view">
      <div className="week-header">
        <h3>任务清单 ({sorted.length})</h3>
        <span className="task-ledger-meta">
          {summary.highRisk > 0 && <span className="risk-text">高风险 {summary.highRisk}</span>}
          {summary.milestones > 0 && <span>里程碑 {summary.milestones}</span>}
          {summary.summaryTasks > 0 && <span>摘要 {summary.summaryTasks}</span>}
          {activeFilterChips.length > 0 && (
            <span className="filter-tag">筛选: {activeFilterChips.join(' / ')}</span>
          )}
        </span>
      </div>
      {sorted.length === 0 ? (
        <div className="empty-view">无匹配任务</div>
      ) : (
        <div className="dlv-table-wrap">
          <table className="dlv-table">
            <thead>
              <tr>
                <th>WBS</th>
                <th>任务名称</th>
                <th>责任部门</th>
                <th>类型</th>
                <th>风险</th>
                <th>计划开始</th>
                <th>计划完成</th>
                <th>工期</th>
                <th>关联交付物</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(task => (
                <tr
                  key={task.nodeKey || task.id || task.wbs}
                  className={`dlv-row ${task.risk === '高' ? 'dlv-high-risk' : ''} ${task.isMilestone ? 'type-milestone' : ''} ${task.isSummary ? 'type-summary' : ''}`}
                >
                  <td className="dlv-wbs">{task.normalizedWbs || task.wbs}</td>
                  <td className="dlv-name" title={task.name}>{task.name}</td>
                  <td>{task.department || '-'}</td>
                  <td>{describeType(task)}</td>
                  <td><span className={`dlv-risk risk-${task.risk || '低'}`}>{task.risk || '低'}</span></td>
                  <td>{formatDate(parseDate(task.start))}</td>
                  <td>{formatDate(parseDate(task.finish))}</td>
                  <td>{task.duration || '-'}</td>
                  <td className="dlv-task" title={task.deliverable}>{task.deliverable || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
