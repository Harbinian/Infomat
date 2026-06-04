import { useMemo } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils';

function getSuggestAction(deliverable) {
  switch (deliverable.deliverableLevel) {
    case 'A': return '提交 PMO 周会和项目决策组';
    case 'B': return '工作组说明原因并给出恢复计划';
    case 'C': return '阶段内补齐归档';
    case 'D': return '可延后处理';
    default: return '评估影响';
  }
}

export default function OverdueDeliverables({ deliverables, pmoDate, onSelectDeliverable }) {
  const now = useMemo(() => pmoDate || new Date(), [pmoDate]);
  const overdue = useMemo(() => {
    return deliverables.filter(deliverable => {
      if (!deliverable.plannedFinish) return false;
      if (deliverable.deliverableStatus === '通过' || deliverable.deliverableStatus === '已归档') return false;
      const finish = parseDate(deliverable.plannedFinish);
      return finish && finish < now;
    }).map(deliverable => {
      const finish = parseDate(deliverable.plannedFinish);
      const daysOverdue = finish ? Math.floor((now - finish) / (1000 * 60 * 60 * 24)) : 0;
      return { ...deliverable, daysOverdue, suggestAction: getSuggestAction(deliverable) };
    }).sort((a, b) => b.daysOverdue - a.daysOverdue);
  }, [deliverables, now]);

  if (overdue.length === 0) {
    return (
      <div className="empty-view">
        <h3>延期交付物</h3>
        <p>当前无延期交付物</p>
      </div>
    );
  }

  return (
    <div className="overdue-view">
      <div className="week-header">
        <h3>延期交付物 ({overdue.length})</h3>
      </div>
      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>延期天数</th>
              <th>计划完成</th>
              <th>交付物名称</th>
              <th>等级</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>关联任务</th>
              <th>风险</th>
              <th>建议动作</th>
            </tr>
          </thead>
          <tbody>
            {overdue.map(deliverable => (
              <tr
                key={deliverable.deliverableId}
                className={`dlv-row dlv-level-${deliverable.deliverableLevel} ${deliverable.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                onClick={() => onSelectDeliverable && onSelectDeliverable(deliverable)}
              >
                <td><span className="overdue-days">{deliverable.daysOverdue}天</span></td>
                <td>{formatDate(parseDate(deliverable.plannedFinish))}</td>
                <td className="dlv-name" title={deliverable.deliverableName}>{deliverable.deliverableName}</td>
                <td><span className={`dlv-level-badge level-${deliverable.deliverableLevel}`}>{deliverable.deliverableLevel}</span></td>
                <td>{deliverable.department || '-'}</td>
                <td className="dlv-reviewer" title={deliverable.reviewer}>{deliverable.reviewer || '-'}</td>
                <td className="dlv-task" title={deliverable.taskName}>{deliverable.taskName}</td>
                <td><span className={`dlv-risk risk-${deliverable.taskRisk}`}>{deliverable.taskRisk}</span></td>
                <td className="dlv-action">{deliverable.suggestAction}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
