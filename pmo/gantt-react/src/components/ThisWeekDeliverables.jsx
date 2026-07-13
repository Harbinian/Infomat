import { useMemo } from 'react';
import { formatDate, getPmoDeliveryWeekRange, parseDate } from '../utils/dateUtils';

export default function ThisWeekDeliverables({ deliverables, pmoDate, onSelectDeliverable }) {
  const date = useMemo(() => pmoDate || new Date(), [pmoDate]);
  const { start: weekStart, end: weekEnd } = useMemo(() => getPmoDeliveryWeekRange(date), [date]);

  const weekDeliverables = useMemo(() => {
    return deliverables.filter(deliverable => {
      if (!deliverable.plannedFinish) return false;
      const finish = parseDate(deliverable.plannedFinish);
      return finish && finish >= weekStart && finish <= weekEnd;
    }).sort((a, b) => {
      const order = { A: 0, B: 1, C: 2, D: 3 };
      return (order[a.deliverableLevel] ?? 2) - (order[b.deliverableLevel] ?? 2);
    });
  }, [deliverables, weekStart, weekEnd]);

  const highPriority = weekDeliverables.filter(d => d.deliverableLevel === 'A' || d.deliverableLevel === 'B' || d.taskRisk === '高');

  if (weekDeliverables.length === 0) {
    return (
      <div className="empty-view">
        <h3>本周交付物 ({formatDate(weekStart)} - {formatDate(weekEnd)})</h3>
        <p>本周暂无计划完成的交付物</p>
      </div>
    );
  }

  return (
    <div className="thisweek-view">
      <div className="week-header">
        <h3>本周交付物 ({formatDate(weekStart)} - {formatDate(weekEnd)})</h3>
        <span className="week-count">共 {weekDeliverables.length} 项，重点 {highPriority.length} 项</span>
      </div>
      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>计划完成</th>
              <th>交付物名称</th>
              <th>等级</th>
              <th>关联任务</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>风险</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {weekDeliverables.map(deliverable => (
              <tr
                key={deliverable.deliverableId}
                className={`dlv-row dlv-level-${deliverable.deliverableLevel} ${deliverable.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                onClick={() => onSelectDeliverable && onSelectDeliverable(deliverable)}
              >
                <td>{formatDate(parseDate(deliverable.plannedFinish))}</td>
                <td className="dlv-name" title={deliverable.deliverableName}>{deliverable.deliverableName}</td>
                <td><span className={`dlv-level-badge level-${deliverable.deliverableLevel}`}>{deliverable.deliverableLevel}</span></td>
                <td className="dlv-task" title={deliverable.taskName}>{deliverable.taskName}</td>
                <td>{deliverable.department || '-'}</td>
                <td className="dlv-reviewer" title={deliverable.reviewer}>{deliverable.reviewer || '-'}</td>
                <td><span className={`dlv-risk risk-${deliverable.taskRisk}`}>{deliverable.taskRisk}</span></td>
                <td><span className="dlv-status">{deliverable.deliverableStatus}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
