import { parseDate, unique } from '../utils/dateUtils';

export default function DashboardCards({ tasks }) {
  const now = new Date();
  const milestones = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  const highRisk = tasks.filter(t => t.risk === '高');
  const inProgress = tasks.filter(t => {
    const s = parseDate(t.start), f = parseDate(t.finish);
    if (!s || !f) return false;
    return s <= now && f >= now;
  });
  const crossYear = tasks.filter(t => {
    const s = parseDate(t.start), f = parseDate(t.finish);
    if (!s || !f) return false;
    return s.getFullYear() !== f.getFullYear();
  });
  const depts = unique(tasks.map(t => t.department).filter(Boolean));
  const vendors = unique(tasks.map(t => t.vendor).filter(Boolean));

  const cards = [
    { value: tasks.length, label: '总任务数', cls: '' },
    { value: milestones.length, label: '里程碑', cls: '' },
    { value: highRisk.length, label: '高风险任务', cls: 'highlight' },
    { value: inProgress.length, label: '当前进行中', cls: '' },
    { value: crossYear.length, label: '已跨年任务', cls: '' },
    { value: depts.length, label: '责任部门', cls: '' },
    { value: vendors.length, label: '供应商', cls: '' }
  ];

  return (
    <div className="dashboard">
      {cards.map((c, i) => (
        <div key={i} className={`stat-card ${c.cls}`}>
          <div className="stat-value">{c.value}</div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
