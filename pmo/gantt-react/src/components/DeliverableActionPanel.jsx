import { useMemo, useState } from 'react';
import { buildPublishText } from '../utils/publishText.js';

const STATE_COLORS = {
  待接收: '#C9872B',
  已接收: '#6E879F',
  已提交待确认: '#B88919',
  已关闭: '#6F8A6A',
};

/** 本地日期，避免 toISOString() 在东八区把今天算成昨天。 */
function todayIso() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * 行动计划面板：把受控交付物作为行动项发布、跟踪与关闭。
 *
 * 状态语义来自《信息化项目协同工作规则》：
 *   6.3 只记事项、责任部门、截止时间、当前状态四要素，实际执行人由部门内部安排。
 *   6.4 没有结果或可核对依据的事项不得关闭。
 *   8.1 期限调整需指定同意人。
 */
export default function DeliverableActionPanel({
  deliverable,
  roster = [],
  actor = '',
  busy = false,
  onEvent,
  onArchiveText,
}) {
  const action = deliverable?.action || null;
  const state = action?.state || null;

  const [mode, setMode] = useState('');
  const [department, setDepartment] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [resultNote, setResultNote] = useState('');
  const [closureNote, setClosureNote] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [scope, setScope] = useState('normal');
  const [approvedBy, setApprovedBy] = useState('');
  const [manualCriteria, setManualCriteria] = useState(false);
  const [criteria, setCriteria] = useState('');
  const [evidenceRequirement, setEvidenceRequirement] = useState('');
  const [copied, setCopied] = useState('');

  const overdue = Boolean(action?.dueDate) && state !== '已关闭' && action.dueDate < todayIso();

  const departments = useMemo(
    () => [...new Set(roster.map(row => row.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [roster],
  );

  if (!deliverable || deliverable.recordKind !== 'controlled') return null;

  const reset = () => {
    setMode('');
    setResultNote('');
    setClosureNote('');
    setApprovedBy('');
  };

  const submit = async (payload) => {
    await onEvent?.({ ...payload, actor });
    reset();
  };

  const openPublish = () => {
    setDepartment(action?.assigneeDepartment || '');
    setDueDate(action?.dueDate || deliverable.plannedFinish || todayIso());
    setCriteria(deliverable.completionCriteria || '');
    setEvidenceRequirement(deliverable.evidenceRequirements || '');
    setManualCriteria(!deliverable.completionCriteria);
    setMode('publish');
  };

  const handleCopy = async () => {
    const text = buildPublishText({
      items: [deliverable],
      actor,
      date: todayIso(),
      roster,
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopied('已复制');
    } catch {
      setCopied('复制失败，请手工选择文本');
    }
    await onArchiveText?.(text);
    window.setTimeout(() => setCopied(''), 2000);
  };

  return (
    <div className="detail-field action-panel">
      <label>行动计划</label>

      {action ? (
        <div className="action-summary">
          <span
            className="action-state-badge"
            style={{ background: `${STATE_COLORS[state] || '#9A8F7A'}22`, color: STATE_COLORS[state] || '#9A8F7A' }}
          >
            {state}
          </span>
          {overdue && <span className="action-overdue-badge">已逾期</span>}
          <div className="action-summary-row">责任部门：{action.assigneeDepartment}</div>
          <div className="action-summary-row">
            截止时间：{action.dueDate}
            {action.ackDueDate ? `（接收回复截止 ${action.ackDueDate}）` : ''}
          </div>
          <div className="action-summary-row">
            完成判定：{(action.criteriaSource === 'manual' ? action.criteria : deliverable.completionCriteria) || '未设定'}
          </div>
          <div className="action-summary-row">
            证据要求：{(action.criteriaSource === 'manual' ? action.evidenceRequirement : deliverable.evidenceRequirements) || '未设定'}
          </div>
          {action.resultNote && <div className="action-summary-row">办理结果：{action.resultNote}</div>}
          {action.closureNote && <div className="action-summary-row">关闭结论：{action.closureNote}</div>}
          {action.publishedBy && (
            <div className="action-summary-meta">
              发布：{action.publishedBy}
              {action.acknowledgedBy ? ` · 接收：${action.acknowledgedBy}` : ''}
              {action.closedBy ? ` · 关闭：${action.closedBy}` : ''}
            </div>
          )}
        </div>
      ) : (
        <div className="action-empty">尚未发布为行动项</div>
      )}

      <div className="action-buttons">
        {!action && <button type="button" className="action-btn tone-primary" disabled={busy} onClick={openPublish}>发布行动项</button>}
        {state === '待接收' && (
          <button type="button" className="action-btn tone-primary" disabled={busy} onClick={() => submit({ action: 'acknowledge' })}>
            登记已接收
          </button>
        )}
        {(state === '待接收' || state === '已接收') && (
          <button type="button" className="action-btn tone-neutral" disabled={busy} onClick={() => setMode('submitResult')}>登记结果</button>
        )}
        {(state === '已接收' || state === '已提交待确认') && (
          <button type="button" className="action-btn tone-success" disabled={busy} onClick={() => setMode('close')}>确认关闭</button>
        )}
        {action && state !== '已关闭' && (
          <button type="button" className="action-btn tone-neutral" disabled={busy} onClick={() => { setNewDueDate(action.dueDate); setMode('dueDate'); }}>
            期限调整
          </button>
        )}
        {state === '已关闭' && (
          <button type="button" className="action-btn tone-neutral" disabled={busy} onClick={() => setMode('reopen')}>重新开启</button>
        )}
        {action && (
          <button type="button" className="action-btn tone-neutral" disabled={busy} onClick={handleCopy}>
            {copied || '复制群发布文本'}
          </button>
        )}
      </div>

      {mode === 'publish' && (
        <div className="action-form">
          <label className="action-form-row">
            <span>责任部门</span>
            <select value={department} onChange={event => setDepartment(event.target.value)}>
              <option value="">请选择责任部门</option>
              {departments.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
          <label className="action-form-row">
            <span>截止时间</span>
            <input type="date" value={dueDate} onChange={event => setDueDate(event.target.value)} />
          </label>
          <label className="action-form-row action-form-check">
            <input type="checkbox" checked={manualCriteria} onChange={event => setManualCriteria(event.target.checked)} />
            <span>本交付物无计划锚点，手工填写完成判定与证据要求</span>
          </label>
          {manualCriteria ? (
            <>
              <label className="action-form-row">
                <span>完成判定</span>
                <input type="text" value={criteria} onChange={event => setCriteria(event.target.value)} />
              </label>
              <label className="action-form-row">
                <span>证据要求</span>
                <input type="text" value={evidenceRequirement} onChange={event => setEvidenceRequirement(event.target.value)} />
              </label>
            </>
          ) : (
            <div className="action-form-hint">
              完成判定与证据要求取自绑定任务（计划真源），台账只读带入。
            </div>
          )}
          <div className="action-form-buttons">
            <button
              type="button"
              className="action-btn tone-primary"
              disabled={busy || !department || !dueDate}
              onClick={() => submit({
                action: 'publish',
                assigneeDepartment: department,
                dueDate,
                criteriaSource: manualCriteria ? 'manual' : 'task',
                criteria: manualCriteria ? criteria : '',
                evidenceRequirement: manualCriteria ? evidenceRequirement : '',
              })}
            >
              发布
            </button>
            <button type="button" className="action-btn tone-neutral" onClick={reset}>取消</button>
          </div>
        </div>
      )}

      {mode === 'submitResult' && (
        <div className="action-form">
          <label className="action-form-row">
            <span>结果或材料位置</span>
            <textarea rows={3} value={resultNote} onChange={event => setResultNote(event.target.value)} placeholder="按规则 6.3，写结果或材料位置" />
          </label>
          <div className="action-form-buttons">
            <button type="button" className="action-btn tone-primary" disabled={busy || !resultNote.trim()} onClick={() => submit({ action: 'submitResult', resultNote })}>
              登记
            </button>
            <button type="button" className="action-btn tone-neutral" onClick={reset}>取消</button>
          </div>
        </div>
      )}

      {mode === 'close' && (
        <div className="action-form">
          <label className="action-form-row">
            <span>关闭结论</span>
            <textarea rows={3} value={closureNote} onChange={event => setClosureNote(event.target.value)} placeholder="按规则 6.4，需具备结果、材料位置、记录或明确结论" />
          </label>
          <div className="action-form-hint">
            规则 6.4：没有结果或可核对依据的事项不得关闭。当前{action?.resultNote ? '已有办理结果' : '无办理结果'}、{deliverable.evidence ? '已上传凭证' : '未上传凭证'}。
          </div>
          <div className="action-form-buttons">
            <button type="button" className="action-btn tone-success" disabled={busy || !closureNote.trim()} onClick={() => submit({ action: 'close', closureNote })}>
              确认关闭
            </button>
            <button type="button" className="action-btn tone-neutral" onClick={reset}>取消</button>
          </div>
        </div>
      )}

      {mode === 'dueDate' && (
        <div className="action-form">
          <label className="action-form-row">
            <span>新的截止时间</span>
            <input type="date" value={newDueDate} onChange={event => setNewDueDate(event.target.value)} />
          </label>
          <label className="action-form-row">
            <span>调整范围</span>
            <select value={scope} onChange={event => setScope(event.target.value)}>
              <option value="normal">普通行动项（刘春含同意）</option>
              <option value="gate">跨部门/阶段门/项目基线（马成文或李洪哲同意）</option>
            </select>
          </label>
          <label className="action-form-row">
            <span>同意人</span>
            <input type="text" value={approvedBy} onChange={event => setApprovedBy(event.target.value)} placeholder="按规则 8.1 填写在信息化工作群明确同意的人员" />
          </label>
          <div className="action-form-hint">
            规则 8.2：调整生效后不追溯消除已经发生的逾期事实，原截止时间保留在操作记录中。
          </div>
          <div className="action-form-buttons">
            <button
              type="button"
              className="action-btn tone-primary"
              disabled={busy || !newDueDate || !approvedBy.trim()}
              onClick={() => submit({ action: 'changeDueDate', dueDate: newDueDate, scope, approvedBy })}
            >
              提交调整
            </button>
            <button type="button" className="action-btn tone-neutral" onClick={reset}>取消</button>
          </div>
        </div>
      )}

      {mode === 'reopen' && (
        <div className="action-form">
          <label className="action-form-row">
            <span>重新开启原因</span>
            <textarea rows={2} value={closureNote} onChange={event => setClosureNote(event.target.value)} />
          </label>
          <div className="action-form-buttons">
            <button type="button" className="action-btn tone-neutral" disabled={busy || !closureNote.trim()} onClick={() => submit({ action: 'reopen', note: closureNote })}>
              重新开启
            </button>
            <button type="button" className="action-btn tone-neutral" onClick={reset}>取消</button>
          </div>
        </div>
      )}
    </div>
  );
}
