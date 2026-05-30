import { parseDate, formatDate } from '../utils/dateUtils';

export default function MilestoneList({ tasks }) {
  const milestones = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');

  return (
    <div className="milestone-panel">
      <h3>关键里程碑 ({milestones.length})</h3>
      <div className="milestone-list">
        {milestones.map((m, i) => (
          <div key={i} className="milestone-item">
            <span className="ms-date">{formatDate(parseDate(m.finish))}</span>
            <span className="ms-name">{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
