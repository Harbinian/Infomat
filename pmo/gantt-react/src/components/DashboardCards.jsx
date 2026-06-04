import { useMemo } from 'react';
import { parseDate, unique } from '../utils/dateUtils';

export default function DashboardCards({ tasks, deliverables = [], phaseGates = [], pmoDate }) {
  const stats = useMemo(() => {
    const now = pmoDate || new Date();
    const milestones = tasks.filter(t => t.isMilestone);
    const highRisk = tasks.filter(t => t.risk === '高');
    const normalTasks = tasks.filter(t => !t.isSummary && !t.isMilestone);
    const summaryTasks = tasks.filter(t => t.isSummary);
    const inProgress = tasks.filter(t => {
      const start = parseDate(t.start);
      const finish = parseDate(t.finish);
      if (!start || !finish) return false;
      return start <= now && finish >= now;
    });
    const aLevel = deliverables.filter(d => d.deliverableLevel === 'A');
    const bLevel = deliverables.filter(d => d.deliverableLevel === 'B');
    const overdue = deliverables.filter(d => {
      if (!d.plannedFinish) return false;
      if (d.deliverableStatus === '通过' || d.deliverableStatus === '已归档') return false;
      const finish = parseDate(d.plannedFinish);
      return finish && finish < now;
    });
    const highRiskDeliverables = deliverables.filter(d => d.taskRisk === '高');
    const departments = unique(tasks.map(t => t.department).filter(Boolean));

    return {
      total: tasks.length,
      normalTaskCount: normalTasks.length,
      summaryTaskCount: summaryTasks.length,
      milestones: milestones.length,
      highRisk: highRisk.length,
      inProgress: inProgress.length,
      deliverableTotal: deliverables.length,
      aLevelCount: aLevel.length,
      bLevelCount: bLevel.length,
      overdueCount: overdue.length,
      gatesAtRisk: phaseGates.filter(gate => gate.status === '风险').length,
      highRiskDlvCount: highRiskDeliverables.length,
      departments: departments.length
    };
  }, [tasks, deliverables, phaseGates, pmoDate]);

  const cards = [
    { value: stats.total, label: '总任务数' },
    { value: stats.normalTaskCount, label: '普通任务' },
    { value: stats.summaryTaskCount, label: '摘要任务' },
    { value: stats.milestones, label: '里程碑' },
    { value: stats.highRisk, label: '高风险任务', highlight: true },
    { value: stats.inProgress, label: '观察日进行中' },
    { value: stats.deliverableTotal, label: '交付物总数' },
    { value: stats.aLevelCount, label: 'A类交付物', cls: 'stat-a' },
    { value: stats.bLevelCount, label: 'B类交付物', cls: 'stat-b' },
    { value: stats.overdueCount, label: '延期交付物', highlight: true },
    { value: stats.gatesAtRisk, label: '阶段门风险', highlight: true },
    { value: stats.highRiskDlvCount, label: '高风险交付物', highlight: true },
  ];

  return (
    <div className="dashboard">
      {cards.map((c, i) => (
        <div key={i} className={`stat-card ${c.highlight ? 'highlight' : ''} ${c.cls || ''}`}>
          <div className="stat-value">{c.value}</div>
          <div className="stat-label">{c.label}</div>
        </div>
      ))}
    </div>
  );
}
