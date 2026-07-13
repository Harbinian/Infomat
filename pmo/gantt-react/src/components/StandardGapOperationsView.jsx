import { useMemo, useState } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils.js';
import { ACTIONABLE_STANDARD_GAP_BUCKETS, STANDARD_GAP_BUCKETS, isExecutionStandardGap } from '../utils/deliverableWorkflow.js';

function bucketCount(tasks, bucket) {
  return tasks.filter(task => task.standardsGapBucket === bucket).length;
}

function formatReasons(task) {
  const reasons = Array.isArray(task.standardsGapReasons) ? task.standardsGapReasons : [];
  return reasons.length ? reasons.join('、') : '-';
}

function isBoundStandard(task) {
  const standardId = String(task.executionStandardId || '').trim();
  return Boolean(standardId && standardId !== '暂缓');
}

function describeType(task) {
  if (task.isMilestone) return '里程碑';
  if (task.isSummary) return '摘要';
  return task.type || '普通';
}

export default function StandardGapOperationsView({ tasks = [], bucket = 'all', onOpenTask }) {
  const propBucket = bucket || 'all';
  const [bucketState, setBucketState] = useState(() => ({ propBucket, activeBucket: propBucket }));
  const activeBucket = bucketState.propBucket === propBucket ? bucketState.activeBucket : propBucket;
  const setActiveBucket = (nextBucket) => setBucketState({ propBucket, activeBucket: nextBucket });

  const metrics = useMemo(() => {
    const requires = tasks.filter(task => task.requiresExecutionStandard);
    const covered = tasks.filter(isBoundStandard);
    const actionable = tasks.filter(isExecutionStandardGap);
    const deferred = tasks.filter(task => task.standardsGapBucket === '合理暂缓');
    const coverage = requires.length ? Math.round((covered.length / requires.length) * 100) : 0;
    return { requires: requires.length, covered: covered.length, actionable: actionable.length, deferred: deferred.length, coverage };
  }, [tasks]);

  const bucketRows = useMemo(
    () => STANDARD_GAP_BUCKETS.map(item => ({ bucket: item, count: bucketCount(tasks, item) })),
    [tasks]
  );

  const queue = useMemo(() => {
    const rows = tasks.filter(task => {
      if (!ACTIONABLE_STANDARD_GAP_BUCKETS.includes(task.standardsGapBucket)) return false;
      if (activeBucket !== 'all' && task.standardsGapBucket !== activeBucket) return false;
      return true;
    });
    return rows
      .sort((a, b) => {
        if (b.standardsGapPriorityScore !== a.standardsGapPriorityScore) {
          return b.standardsGapPriorityScore - a.standardsGapPriorityScore;
        }
        return String(a.wbs || '').localeCompare(String(b.wbs || ''), 'zh-CN', { numeric: true });
      })
      .slice(0, 30);
  }, [tasks, activeBucket]);

  return (
    <div className="standard-governance-view">
      <div className="standard-governance-header">
        <div>
          <h3>标准治理</h3>
          <span>覆盖率快照 {metrics.coverage}% ｜ 真实缺口 {metrics.actionable}</span>
        </div>
      </div>

      <div className="standard-metric-grid">
        <div className="standard-metric">
          <span className="metric-value">{metrics.requires}</span>
          <span className="metric-label">需执行标准</span>
        </div>
        <div className="standard-metric">
          <span className="metric-value">{metrics.covered}</span>
          <span className="metric-label">已绑定标准</span>
        </div>
        <div className="standard-metric highlight">
          <span className="metric-value">{metrics.actionable}</span>
          <span className="metric-label">真实治理缺口</span>
        </div>
        <div className="standard-metric">
          <span className="metric-value">{metrics.deferred}</span>
          <span className="metric-label">合理暂缓</span>
        </div>
      </div>

      <div className="standard-bucket-bar">
        <button type="button" className={activeBucket === 'all' ? 'active' : ''} onClick={() => setActiveBucket('all')}>
          全部 {metrics.actionable}
        </button>
        {bucketRows.map(item => (
          <button
            key={item.bucket}
            type="button"
            className={activeBucket === item.bucket ? 'active' : ''}
            onClick={() => setActiveBucket(item.bucket)}
          >
            {item.bucket} {item.count}
          </button>
        ))}
      </div>

      <div className="standard-queue-panel">
        <div className="week-header compact">
          <h3>高风险缺标准优先队列 Top 30</h3>
          <span className="task-ledger-meta">当前显示 {queue.length} 项</span>
        </div>
        {queue.length === 0 ? (
          <div className="empty-view">无匹配任务</div>
        ) : (
          <div className="dlv-table-wrap">
            <table className="dlv-table standard-queue-table">
              <thead>
                <tr>
                  <th>WBS</th>
                  <th>任务名称</th>
                  <th>类型</th>
                  <th>风险</th>
                  <th>关键</th>
                  <th>阶段门</th>
                  <th>视图分类</th>
                  <th>开始</th>
                  <th>部门</th>
                  <th>确认人</th>
                  <th>缺口原因</th>
                  <th>建议标准</th>
                  <th>建议动作</th>
                  <th>分数</th>
                </tr>
              </thead>
              <tbody>
                {queue.map(task => (
                  <tr
                    key={task.nodeKey || task.id || task.wbs}
                    className={`dlv-row ${task.risk === '高' ? 'dlv-high-risk' : ''}`}
                    onClick={() => onOpenTask?.(task)}
                  >
                    <td className="dlv-wbs">{task.normalizedWbs || task.wbs}</td>
                    <td className="dlv-name" title={task.name}>{task.name}</td>
                    <td>{describeType(task)}</td>
                    <td><span className={`dlv-risk risk-${task.risk || '低'}`}>{task.risk || '-'}</span></td>
                    <td>{task.isCriticalControl === '是' ? '是' : '-'}</td>
                    <td>{task.phaseGateNo || '-'}</td>
                    <td>{task.viewCategory || '-'}</td>
                    <td>{formatDate(parseDate(task.start))}</td>
                    <td>{task.department || '-'}</td>
                    <td>{task.reviewer || '-'}</td>
                    <td className="dlv-task" title={formatReasons(task)}>{formatReasons(task)}</td>
                    <td className="standard-cell">{task.suggestedStandardId || '-'}</td>
                    <td className="dlv-action" title={task.suggestedAction}>{task.suggestedAction || '-'}</td>
                    <td className="standard-score">{task.standardsGapPriorityScore || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
