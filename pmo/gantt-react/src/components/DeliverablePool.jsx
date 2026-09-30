import { useMemo, useState } from 'react';
import { formatDate, parseDate } from '../utils/dateUtils';
import { deliverableRowKey } from '../utils/deliverableIndex.js';

const LEVEL_COLORS = { A: '#B88919', B: '#6E879F', C: '#6F8A6A', D: '#9A8F7A' };

const POOL_COLUMNS = [
  { key: 'projectionKey', label: '投影键' },
  { key: 'candidateName', label: '候选交付物' },
  { key: 'deliverableType', label: '类型' },
  { key: 'deliverableLevel', label: '等级' },
  { key: 'taskName', label: '关联任务' },
  { key: 'normalizedWbs', label: '规范WBS' },
  { key: 'department', label: '部门' },
  { key: 'plannedFinish', label: '计划完成' },
  { key: '__actions', label: '操作' },
];

function formatPlannedFinish(value) {
  const date = parseDate(value);
  return date ? formatDate(date) : '-';
}

/**
 * 计划候选池：任务 deliverable 字段的投影，尚未纳入受控管理。
 *
 * 投影行不可发布行动项 —— 只有提升为受控交付物（分配 DLV 编号并建立正本）之后，
 * 才进入受控台账并具备责任人、完成判定与行动项闭环。
 */
export default function DeliverablePool({ projections = [], suggestedNextId = '', onPromote }) {
  const [search, setSearch] = useState('');
  const [pendingKey, setPendingKey] = useState('');

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    if (!keyword) return projections;
    return projections.filter(row => [
      row.candidateName,
      row.taskName,
      row.normalizedWbs,
      row.department,
      row.projectionKey,
    ].some(value => String(value || '').toLowerCase().includes(keyword)));
  }, [projections, search]);

  const handlePromote = async (row) => {
    if (!onPromote) return;
    setPendingKey(deliverableRowKey(row));
    try {
      await onPromote(row);
    } finally {
      setPendingKey('');
    }
  };

  return (
    <div className="dlv-pool">
      <div className="dlv-pool-note">
        候选来自 PMO 计划任务的 <code>deliverable</code> 字段投影，尚未纳入受控管理。
        {suggestedNextId && <>提升时建议编号 <strong>{suggestedNextId}</strong>。</>}
        提升后会创建正本并带入该任务的完成判定与证据要求，随后才能发布行动项。
      </div>

      <div className="dlv-filter-bar">
        <input
          type="text"
          placeholder="搜索候选交付物/任务/WBS..."
          value={search}
          onChange={event => setSearch(event.target.value)}
          className="dlv-search"
        />
        <span className="dlv-count">共 {filtered.length} 项</span>
      </div>

      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>{POOL_COLUMNS.map(col => <th key={col.key}>{col.label}</th>)}</tr>
          </thead>
          <tbody>
            {filtered.map(row => {
              const rowKey = deliverableRowKey(row);
              return (
                <tr
                  key={rowKey}
                  className={`dlv-row dlv-level-${row.deliverableLevel} ${row.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                >
                  <td className="dlv-projection-key">{row.projectionKey}</td>
                  <td className="dlv-name" title={row.candidateName}>{row.candidateName}</td>
                  <td>{row.deliverableType}</td>
                  <td>
                    <span
                      className="dlv-level-badge"
                      style={{ color: LEVEL_COLORS[row.deliverableLevel], borderColor: LEVEL_COLORS[row.deliverableLevel] }}
                    >
                      {row.deliverableLevel}
                    </span>
                  </td>
                  <td className="dlv-task" title={row.taskName}>{row.taskName}</td>
                  <td className="dlv-wbs">{row.normalizedWbs || '-'}</td>
                  <td>{row.department || '-'}</td>
                  <td>{formatPlannedFinish(row.plannedFinish)}</td>
                  <td className="dlv-promote-cell">
                    <button
                      type="button"
                      className="dlv-promote-btn"
                      disabled={pendingKey === rowKey}
                      onClick={() => handlePromote(row)}
                      title="分配受控编号并创建正本骨架"
                    >
                      {pendingKey === rowKey ? '提升中…' : '提升为受控'}
                    </button>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={POOL_COLUMNS.length} className="empty-row">无匹配候选</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
