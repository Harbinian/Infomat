import { parseDate, formatDate } from '../utils/dateUtils';

export default function MilestoneList({ tasks, show, onClose }) {
  const milestones = tasks.filter(t => t.isMilestone);

  return (
    <div className={`milestone-panel${show ? ' open' : ''}`}>
      <div className="ms-header">
        <h3>关键里程碑 ({milestones.length})</h3>
        <button className="ms-close" onClick={onClose} type="button">&times;</button>
      </div>
      <div className="milestone-list">
        {milestones.map(m => (
          <div key={m.id} className="milestone-item">
            <span className="ms-date">{formatDate(parseDate(m.finish))}</span>
            <span className="ms-name">{m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
