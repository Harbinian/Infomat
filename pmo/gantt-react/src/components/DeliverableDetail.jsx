import { useEffect, useMemo, useRef } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils';

const LEVEL_COLORS = { A: '#B88919', B: '#6E879F', C: '#6F8A6A', D: '#9A8F7A' };
const STATUS_COLORS = {
  未提交: '#9A8F7A',
  编制中: '#6E879F',
  已提交: '#C9872B',
  待评审: '#B88919',
  通过: '#6F8A6A',
  退回整改: '#B24A3A',
  已归档: '#6F7F8F'
};

function findRelatedGates(deliverable, phaseGates) {
  if (!phaseGates || !deliverable) return [];
  return phaseGates.filter(gate => {
    const matches = [...(gate.confirmed || []), ...(gate.suspected || [])];
    return matches.some(match => match.deliverable && match.deliverable.deliverableId === deliverable.deliverableId);
  });
}

function formatEvidenceTime(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

export default function DeliverableDetail({ deliverable, phaseGates, onClose }) {
  const panelRef = useRef(null);
  const relatedGates = useMemo(() => findRelatedGates(deliverable, phaseGates), [deliverable, phaseGates]);

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!panelRef.current || panelRef.current.contains(event.target)) return;
      onClose();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  if (!deliverable) return null;

  const fields = [
    { label: '交付物编号', value: deliverable.deliverableId },
    { label: '交付物名称', value: deliverable.deliverableName },
    { label: '交付物类型', value: deliverable.deliverableType },
    { label: '交付物等级', value: deliverable.deliverableLevel, badge: 'level' },
    { label: '关联任务', value: deliverable.taskName },
    { label: '原始WBS', value: deliverable.originalWbs },
    { label: '规范WBS', value: deliverable.normalizedWbs },
    { label: '责任部门', value: deliverable.department || '-' },
    { label: '供应商', value: deliverable.vendor || '-' },
    { label: '审核人/审批组', value: deliverable.reviewer || '-' },
    { label: '计划完成时间', value: deliverable.plannedFinish ? formatDate(parseDate(deliverable.plannedFinish)) : '-' },
    { label: '风险等级', value: deliverable.taskRisk || '中', badge: 'risk' },
    { label: '交付物状态', value: deliverable.deliverableStatus, badge: 'status' },
    { label: '上传凭证', value: deliverable.evidence?.fileName || '未上传' },
    { label: '凭证登记时间', value: formatEvidenceTime(deliverable.evidence?.uploadedAt) },
    { label: '是否阶段门交付物', value: deliverable.isPhaseGate ? '是' : '否' },
    { label: '关联阶段门', value: relatedGates.length ? relatedGates.map(gate => gate.gateName).join('、') : '-' },
  ];

  return (
    <div className="detail-overlay open" ref={panelRef}>
      <div className="detail-header">
        <h3>交付物详情</h3>
        <button className="detail-close" onClick={onClose} type="button">&times;</button>
      </div>
      <div className="detail-body">
        {fields.map(field => (
          <div key={field.label} className="detail-field">
            <label>{field.label}</label>
            {field.badge === 'level'
              ? <span className="value badge" style={{ background: `${LEVEL_COLORS[field.value]}22`, color: LEVEL_COLORS[field.value], border: `1px solid ${LEVEL_COLORS[field.value]}` }}>{field.value}类</span>
              : field.badge === 'risk'
                ? <span className={`value badge risk-${field.value}`}>{field.value}</span>
                : field.badge === 'status'
                  ? <span className="value badge" style={{ background: `${STATUS_COLORS[field.value] || '#9A8F7A'}22`, color: STATUS_COLORS[field.value] || '#9A8F7A' }}>{field.value}</span>
                  : <span className="value">{field.value}</span>
            }
          </div>
        ))}
        {deliverable.notes && (
          <div className="detail-field">
            <label>备注</label>
            <span className="value">{deliverable.notes}</span>
          </div>
        )}
      </div>
    </div>
  );
}
