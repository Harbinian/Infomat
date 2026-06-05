import { useEffect, useMemo, useRef, useState } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils';
import {
  DELIVERABLE_ACTIONS,
  canTransitionDeliverableStatus,
  transitionDeliverableStatus,
} from '../utils/deliverableWorkflow';

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

const ACTION_BUTTON_META = {
  draft: { label: '标记编制中', tone: 'neutral', needsNote: false },
  submit: { label: '提交', tone: 'primary', needsNote: false },
  startReview: { label: '进入评审', tone: 'primary', needsNote: false },
  approve: { label: '审核通过', tone: 'success', needsNote: true },
  reject: { label: '退回整改', tone: 'danger', needsNote: true },
  archive: { label: '归档', tone: 'neutral', needsNote: false },
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

function defaultActor() {
  try {
    return localStorage.getItem('pmo-actor') || '当前用户';
  } catch {
    return '当前用户';
  }
}

export default function DeliverableDetail({ deliverable, phaseGates, onClose, onTransition }) {
  const panelRef = useRef(null);
  const lastDeliverableKey = useRef(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [note, setNote] = useState('');
  const [actor, setActor] = useState(defaultActor);

  const currentKey = deliverable ? `${deliverable.deliverableId}::${deliverable.deliverableStatus || ''}` : null;
  if (currentKey !== lastDeliverableKey.current) {
    lastDeliverableKey.current = currentKey;
    if (pendingAction !== null) setPendingAction(null);
    if (note !== '') setNote('');
  }

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

  const status = deliverable.deliverableStatus || '未提交';
  const availableActions = Object.entries(DELIVERABLE_ACTIONS)
    .filter(([actionKey]) => canTransitionDeliverableStatus(status, actionKey))
    .map(([actionKey, def]) => ({ actionKey, ...def, ...ACTION_BUTTON_META[actionKey] }));

  const handleActionClick = (actionKey) => {
    if (!onTransition) return;
    const meta = ACTION_BUTTON_META[actionKey];
    if (meta?.needsNote) {
      setPendingAction(actionKey);
      return;
    }
    runTransition(actionKey, '', actor);
  };

  const runTransition = (actionKey, reviewNote, actorName) => {
    if (!onTransition) return;
    try {
      const updated = transitionDeliverableStatus(deliverable, {
        action: actionKey,
        actor: actorName,
        note: reviewNote,
        at: new Date().toISOString(),
      });
      onTransition(updated, {
        action: actionKey,
        actor: actorName,
        note: reviewNote,
        at: new Date().toISOString(),
      });
    } catch (error) {
      window.alert(error.message || '状态变更失败');
    }
  };

  const handleConfirmNote = () => {
    if (!pendingAction) return;
    runTransition(pendingAction, note.trim(), actor.trim() || '当前用户');
    setPendingAction(null);
    setNote('');
  };

  const handleCancelNote = () => {
    setPendingAction(null);
    setNote('');
  };

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
    { label: '交付物状态', value: status, badge: 'status' },
    { label: '实际提交日期', value: deliverable._actualSubmitDate || '-' },
    { label: '实际通过日期', value: deliverable._actualPassDate || '-' },
    { label: '审核意见', value: deliverable.reviewOpinion || '-' },
    { label: '上传凭证', value: deliverable.evidence?.fileName || '未上传' },
    { label: '凭证登记时间', value: formatEvidenceTime(deliverable.evidence?.uploadedAt) },
    { label: '是否阶段门交付物', value: deliverable.isPhaseGate ? '是' : '否' },
    { label: '关联阶段门', value: relatedGates.length ? relatedGates.map(gate => gate.gateName).join('、') : '-' },
  ];

  const history = Array.isArray(deliverable.workflowHistory) ? deliverable.workflowHistory : [];

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

        {availableActions.length > 0 && (
          <div className="detail-field detail-actions">
            <label>状态操作</label>
            <div className="action-buttons">
              {availableActions.map(action => (
                <button
                  key={action.actionKey}
                  type="button"
                  className={`action-btn tone-${action.tone}`}
                  onClick={() => handleActionClick(action.actionKey)}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {pendingAction && (
          <div className="detail-field detail-note">
            <label>{ACTION_BUTTON_META[pendingAction]?.label}意见</label>
            <div className="note-input-row">
              <input
                type="text"
                placeholder="操作人"
                value={actor}
                onChange={event => setActor(event.target.value)}
                className="note-actor"
                aria-label="操作人"
              />
              <textarea
                placeholder="请输入审核/退回意见"
                value={note}
                onChange={event => setNote(event.target.value)}
                className="note-textarea"
                rows={3}
                aria-label="审核意见"
              />
              <div className="note-buttons">
                <button type="button" className="action-btn tone-success" onClick={handleConfirmNote}>确认</button>
                <button type="button" className="action-btn tone-neutral" onClick={handleCancelNote}>取消</button>
              </div>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div className="detail-field detail-history">
            <label>操作记录</label>
            <ul className="workflow-history">
              {history.map((item, idx) => (
                <li key={`${item.at}-${idx}`} className={`history-item history-${item.action}`}>
                  <span className="history-action">{item.label || item.action}</span>
                  <span className="history-flow">{item.from} → {item.to}</span>
                  <span className="history-meta">{item.actor || '-'} · {formatEvidenceTime(item.at)}</span>
                  {item.note && <span className="history-note">{item.note}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

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
