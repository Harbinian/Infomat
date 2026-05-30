import { parseDate, formatDate } from '../utils/dateUtils';

export default function TaskDetail({ task, onClose }) {
  if (!task) return null;

  const s = parseDate(task.start);
  const f = parseDate(task.finish);
  const isMilestone = task.milestone === '是' || task.duration === '0工作日';

  const fields = [
    { label: 'WBS', value: task.wbs || '-' },
    { label: '任务名称', value: task.name },
    { label: '任务类型', value: task.type || '-' },
    { label: '开始时间', value: formatDate(s) },
    { label: '完成时间', value: formatDate(f) },
    { label: '工期', value: task.duration || '-' },
    { label: '前置任务', value: task.predecessors || '-' },
    { label: '资源名称', value: task.resources || '-' },
    { label: '责任部门', value: task.department || '-' },
    { label: '供应商', value: task.vendor || '-' },
    { label: '审核人/审批组', value: task.reviewer || '-' },
    { label: '风险等级', value: task.risk || '中', badge: 'risk' },
    { label: '里程碑', value: isMilestone ? '是' : '否', badge: 'milestone' },
    { label: '交付物', value: task.deliverable || '-' },
    { label: '备注', value: task.notes || '-' }
  ];

  return (
    <div className="detail-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="detail-header">
        <h3>任务详情</h3>
        <button className="detail-close" onClick={onClose}>&times;</button>
      </div>
      <div className="detail-body">
        {fields.map((f, i) => (
          <div key={i} className="detail-field">
            <label>{f.label}</label>
            {f.badge === 'risk'
              ? <span className={`value badge risk-${f.value}`}>{f.value}</span>
              : f.badge === 'milestone' && f.value === '是'
                ? <span className="value badge tag-milestone">里程碑</span>
                : <span className="value">{f.value}</span>
            }
          </div>
        ))}
      </div>
    </div>
  );
}
