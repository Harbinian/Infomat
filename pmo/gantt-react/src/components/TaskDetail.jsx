import { useEffect, useRef } from 'react';
import { parseDate, formatDate } from '../utils/dateUtils';

export default function TaskDetail({ task, onClose }) {
  const panelRef = useRef(null);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!panelRef.current || panelRef.current.contains(event.target)) return;
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  if (!task) return null;

  const s = parseDate(task.start);
  const f = parseDate(task.finish);

  const fields = [
    { label: '原始ID', value: task.originalId != null ? String(task.originalId) : (task.id != null ? String(task.id) : '-') },
    { label: '原始WBS', value: task.originalWbs || task.wbs || '-' },
    { label: '规范WBS', value: task.normalizedWbs || task.wbs || '-' },
    { label: '展示序号', value: task.displayIndex != null ? String(task.displayIndex) : '-' },
    { label: '任务名称', value: task.name },
    { label: '是否摘要', value: task.isSummary ? '是' : '否' },
    { label: '是否里程碑', value: task.isMilestone ? '是' : '否' },
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
    { label: '交付物', value: task.deliverable || '-' },
    { label: '交付物编号', value: task._deliverableId || '-' },
    { label: '交付物类型', value: task._deliverableType || '-' },
    { label: '交付物等级', value: task._deliverableLevel ? `${task._deliverableLevel}类` : '-' },
    { label: '交付物状态', value: task._deliverableStatus || '-' },
    { label: '是否阶段门交付物', value: task._isPhaseGate ? '是' : '否' },
    { label: '备注', value: task.notes ? (task.notes.length > 60 ? task.notes.slice(0, 60) + '…' : task.notes) : '-' }
  ];

  return (
    <div className="detail-overlay open" ref={panelRef}>
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
