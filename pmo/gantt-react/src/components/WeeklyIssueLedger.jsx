import { useEffect, useMemo, useState } from 'react';
import { formatDate, getPmoDeliveryWeekRange } from '../utils/dateUtils.js';
import {
  WEEKLY_ISSUE_STATUSES,
  WEEKLY_ISSUE_TYPES,
  buildWeeklyIssueSuggestions,
  createWeeklyIssueItem,
  getWeeklyIssueType,
  normalizeWeeklyIssueItems,
  summarizeWeeklyIssueItems,
} from '../utils/weeklyIssueUtils.js';

const STORAGE_KEY = 'pmo-weekly-issue-ledger-v1';

function loadStoredItems() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return normalizeWeeklyIssueItems(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function saveStoredItems(items) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Browser storage failure should not block the meeting view.
  }
}

function makeInitialDraft(pmoDate) {
  const type = getWeeklyIssueType('action');
  return {
    type: type.key,
    title: '',
    owner: 'PMO',
    dueDate: formatDate(pmoDate || new Date()),
    source: '周会现场',
    related: '',
    closeCriteria: type.closeRule,
    note: '',
  };
}

function statusClass(status) {
  return `weekly-status status-${status || 'open'}`;
}

export default function WeeklyIssueLedger({ tasks = [], deliverables = [], phaseGates = [], pmoDate }) {
  const [items, setItems] = useState(loadStoredItems);
  const [draft, setDraft] = useState(() => makeInitialDraft(pmoDate));
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');

  const referenceDate = useMemo(() => pmoDate || new Date(), [pmoDate]);
  const { start: weekStart, end: weekEnd } = useMemo(() => getPmoDeliveryWeekRange(referenceDate), [referenceDate]);

  useEffect(() => {
    saveStoredItems(items);
  }, [items]);

  const suggestions = useMemo(() => {
    const existingSourceKeys = new Set(items.map(item => item.sourceKey).filter(Boolean));
    return buildWeeklyIssueSuggestions({ tasks, deliverables, phaseGates, pmoDate: referenceDate })
      .filter(item => !item.sourceKey || !existingSourceKeys.has(item.sourceKey))
      .slice(0, 10);
  }, [tasks, deliverables, phaseGates, referenceDate, items]);

  const summary = useMemo(() => summarizeWeeklyIssueItems(items), [items]);

  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return [...items]
      .filter(item => typeFilter === 'all' || item.type === typeFilter)
      .filter(item => {
        if (statusFilter === 'all') return true;
        if (statusFilter === 'active') return item.status !== 'closed';
        return item.status === statusFilter;
      })
      .filter(item => {
        if (!keyword) return true;
        return [
          item.title,
          item.owner,
          item.ledgerName,
          item.source,
          item.related,
          item.note,
        ].some(value => String(value || '').toLowerCase().includes(keyword));
      })
      .sort((a, b) => {
        if ((a.status === 'closed') !== (b.status === 'closed')) return a.status === 'closed' ? 1 : -1;
        return String(a.dueDate || '9999-99-99').localeCompare(String(b.dueDate || '9999-99-99'));
      });
  }, [items, search, statusFilter, typeFilter]);

  const updateDraftType = (typeKey) => {
    const type = getWeeklyIssueType(typeKey);
    setDraft(prev => ({
      ...prev,
      type: type.key,
      closeCriteria: type.closeRule,
    }));
  };

  const addItem = (input) => {
    const next = createWeeklyIssueItem(input);
    if (!next.title) return;
    setItems(prev => [next, ...prev]);
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    addItem(draft);
    setDraft(makeInitialDraft(referenceDate));
  };

  const addSuggestion = (suggestion) => {
    addItem({ ...suggestion, id: undefined, status: 'open' });
  };

  const updateStatus = (itemId, status) => {
    setItems(prev => prev.map(item => (
      item.id === itemId
        ? { ...item, status, updatedAt: new Date().toISOString() }
        : item
    )));
  };

  return (
    <div className="weekly-issue-view">
      <div className="weekly-issue-header">
        <div>
          <h3>周会事项台账</h3>
          <span>{formatDate(weekStart)} - {formatDate(weekEnd)}</span>
        </div>
        <div className="weekly-issue-kpis">
          <span>待处理 {summary.open}</span>
          <span>已关闭 {summary.closed}</span>
          <span>总计 {summary.total}</span>
        </div>
      </div>

      <div className="weekly-template-grid">
        {WEEKLY_ISSUE_TYPES.map(type => (
          <div className="weekly-template-card" key={type.key}>
            <div className="weekly-template-title">
              <span>{type.label}</span>
              <strong>{summary.byType[type.key] || 0}</strong>
            </div>
            <div className="weekly-template-meta">{type.ledgerName}</div>
            <div className="weekly-template-rule">{type.closeRule}</div>
          </div>
        ))}
      </div>

      <div className="weekly-issue-workspace">
        <form className="weekly-issue-panel weekly-issue-form" onSubmit={handleSubmit}>
          <div className="weekly-panel-title">现场登记</div>
          <div className="weekly-form-grid">
            <label>
              <span>类型</span>
              <select value={draft.type} onChange={event => updateDraftType(event.target.value)}>
                {WEEKLY_ISSUE_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
              </select>
            </label>
            <label>
              <span>责任方</span>
              <input value={draft.owner} onChange={event => setDraft(prev => ({ ...prev, owner: event.target.value }))} />
            </label>
            <label>
              <span>截止时间</span>
              <input type="date" value={draft.dueDate} onChange={event => setDraft(prev => ({ ...prev, dueDate: event.target.value }))} />
            </label>
            <label>
              <span>来源</span>
              <input value={draft.source} onChange={event => setDraft(prev => ({ ...prev, source: event.target.value }))} />
            </label>
          </div>
          <label className="weekly-wide-field">
            <span>事项</span>
            <input required value={draft.title} onChange={event => setDraft(prev => ({ ...prev, title: event.target.value }))} />
          </label>
          <label className="weekly-wide-field">
            <span>关联对象</span>
            <input value={draft.related} onChange={event => setDraft(prev => ({ ...prev, related: event.target.value }))} />
          </label>
          <label className="weekly-wide-field">
            <span>关闭标准</span>
            <textarea value={draft.closeCriteria} onChange={event => setDraft(prev => ({ ...prev, closeCriteria: event.target.value }))} />
          </label>
          <label className="weekly-wide-field">
            <span>备注</span>
            <textarea value={draft.note} onChange={event => setDraft(prev => ({ ...prev, note: event.target.value }))} />
          </label>
          <button className="weekly-primary-btn" type="submit">登记事项</button>
        </form>

        <div className="weekly-issue-panel weekly-suggestions">
          <div className="weekly-panel-title">建议登记</div>
          {suggestions.length === 0 ? (
            <div className="weekly-empty-inline">当前没有新的建议项</div>
          ) : (
            <div className="weekly-suggestion-list">
              {suggestions.map(item => {
                const type = getWeeklyIssueType(item.type);
                return (
                  <button key={item.id} type="button" className="weekly-suggestion-item" onClick={() => addSuggestion(item)}>
                    <span className="weekly-suggestion-type">{type.ledgerName}</span>
                    <span className="weekly-suggestion-title">{item.title}</span>
                    <span className="weekly-suggestion-meta">{item.owner} · {item.dueDate || item.source}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="weekly-filter-bar">
        <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)}>
          <option value="all">全部类型</option>
          {WEEKLY_ISSUE_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
        </select>
        <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)}>
          <option value="active">未关闭</option>
          <option value="all">全部状态</option>
          {WEEKLY_ISSUE_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
        </select>
        <input value={search} placeholder="搜索事项/责任方/来源" onChange={event => setSearch(event.target.value)} />
        <span>当前 {visibleItems.length} 项</span>
      </div>

      <div className="dlv-table-wrap weekly-issue-table-wrap">
        <table className="dlv-table weekly-issue-table">
          <thead>
            <tr>
              <th>台账</th>
              <th>事项</th>
              <th>责任方</th>
              <th>截止时间</th>
              <th>状态</th>
              <th>关联对象</th>
              <th>来源</th>
              <th>关闭标准</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map(item => (
              <tr key={item.id} className={`weekly-issue-row ${item.status === 'closed' ? 'is-closed' : ''}`}>
                <td><span className="weekly-ledger-badge">{item.ledgerName}</span></td>
                <td className="dlv-name" title={item.title}>{item.title}</td>
                <td>{item.owner || '-'}</td>
                <td>{item.dueDate || '-'}</td>
                <td>
                  <select className={statusClass(item.status)} value={item.status} onChange={event => updateStatus(item.id, event.target.value)}>
                    {WEEKLY_ISSUE_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
                  </select>
                </td>
                <td className="dlv-task" title={item.related}>{item.related || '-'}</td>
                <td className="dlv-task" title={item.source}>{item.source || '-'}</td>
                <td className="dlv-task" title={item.closeCriteria}>{item.closeCriteria || getWeeklyIssueType(item.type).closeRule}</td>
              </tr>
            ))}
            {visibleItems.length === 0 && <tr><td className="empty-row" colSpan={8}>无匹配事项</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
