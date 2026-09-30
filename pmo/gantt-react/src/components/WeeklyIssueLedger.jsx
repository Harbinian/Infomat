import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDate, getPmoDeliveryWeekRange } from '../utils/dateUtils.js';
import {
  WEEKLY_ISSUE_STATUSES,
  WEEKLY_ISSUE_TYPES,
  applyWeeklyIssuePatch,
  buildWeeklyIssueSuggestions,
  createWeeklyIssueItem,
  getWeeklyIssueType,
  isWeeklyIssueOverdue,
  normalizeWeeklyIssueItems,
  summarizeWeeklyIssueItems,
} from '../utils/weeklyIssueUtils.js';
import { buildPublishTextForIssue } from '../utils/publishText.js';

// 周会事项的文件正本只在 dev / 容器（均跑 Vite dev server）下可用。
// 静态构建降级为浏览器本地台账，并在此前提示用户数据不会持久化。
const loadFsApi = import.meta.env.DEV
  ? () => import('../utils/weeklyIssueApi.js')
  : null;

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

export default function WeeklyIssueLedger({ tasks = [], deliverables = [], phaseGates = [], pmoDate, roster = [] }) {
  const [items, setItems] = useState([]);
  const [store, setStore] = useState({ mode: 'loading', mtime: 0, error: '' });
  const [draft, setDraft] = useState(() => makeInitialDraft(pmoDate));
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('active');
  const [search, setSearch] = useState('');
  const [actor, setActor] = useState(() => {
    try { return window.localStorage.getItem('pmo-actor') || 'PMO'; } catch { return 'PMO'; }
  });

  const referenceDate = useMemo(() => pmoDate || new Date(), [pmoDate]);
  const { start: weekStart, end: weekEnd } = useMemo(() => getPmoDeliveryWeekRange(referenceDate), [referenceDate]);

  const loadItems = useCallback(async () => {
    if (!loadFsApi) {
      setItems(loadStoredItems());
      setStore({ mode: 'local', mtime: 0, error: '' });
      return;
    }

    try {
      const api = await loadFsApi();
      const data = await api.listWeeklyIssues();
      let nextItems = normalizeWeeklyIssueItems(data.items);

      // 首次接入文件正本时，把浏览器里遗留的事项迁入，避免「升级即丢数据」。
      // localStorage 按 origin 隔离，5173 与 5174 各存各的，迁移只在正本为空时发生一次。
      if (!nextItems.length) {
        const legacy = loadStoredItems().filter(item => item.title);
        if (legacy.length) {
          for (const item of legacy) await api.createWeeklyIssue(item);
          const refreshed = await api.listWeeklyIssues();
          nextItems = normalizeWeeklyIssueItems(refreshed.items);
        }
      }

      setItems(nextItems);
      setStore({ mode: 'fs', mtime: data.mtime, error: '' });
    } catch (error) {
      setItems(loadStoredItems());
      setStore({ mode: 'local', mtime: 0, error: error.message });
    }
  }, []);

  useEffect(() => {
    // 与 App.jsx 的 loadProjectData 同约定：用 setTimeout 0 让首次 setState 脱离 effect 同步体
    const timer = window.setTimeout(() => { loadItems(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadItems]);

  // 只有本地模式回写 localStorage；文件正本模式由服务端负责持久化
  useEffect(() => {
    if (store.mode === 'local') saveStoredItems(items);
  }, [items, store.mode]);

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

  const runFs = useCallback(async (operation) => {
    try {
      return await operation();
    } catch (error) {
      if (error.code === 'WRITE_CONFLICT') {
        window.alert(`${error.message}\n已重新载入台账，请确认后重试。`);
        await loadItems();
        return null;
      }
      window.alert(error.message || '台账操作失败');
      return null;
    }
  }, [loadItems]);

  const addItem = async (input) => {
    const next = createWeeklyIssueItem(input);
    if (!next.title) return;

    if (store.mode !== 'fs') {
      setItems(prev => [next, ...prev]);
      return;
    }

    const { createWeeklyIssue } = await loadFsApi();
    const created = await runFs(() => createWeeklyIssue(next));
    if (!created) return;
    setItems(prev => [created.item, ...prev]);
    setStore(prev => ({ ...prev, mtime: created.mtime }));
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    addItem(draft);
    setDraft(makeInitialDraft(referenceDate));
  };

  const addSuggestion = (suggestion) => {
    addItem({ ...suggestion, id: undefined, status: 'open' });
  };

  /** 统一的更新入口：文件正本模式下规则校验由服务端执行，本地模式用同一纯函数。 */
  const updateItem = async (itemId, patch) => {
    const current = items.find(item => item.id === itemId);
    if (!current) return;

    if (store.mode !== 'fs') {
      try {
        const next = applyWeeklyIssuePatch(current, { ...patch, actor });
        setItems(prev => prev.map(item => (item.id === itemId ? next : item)));
      } catch (error) {
        window.alert(error.message);
      }
      return;
    }

    const { updateWeeklyIssue } = await loadFsApi();
    const updated = await runFs(() => updateWeeklyIssue(itemId, { ...patch, actor }, { ifMatch: store.mtime }));
    if (!updated) return;
    setItems(prev => prev.map(item => (item.id === itemId ? updated.item : item)));
    setStore(prev => ({ ...prev, mtime: updated.mtime }));
  };

  const handleStatusChange = (item, status) => {
    if (status === 'closed') {
      // 规则 6.4：没有结果或可核对依据的事项不得关闭
      const closureNote = window.prompt(
        '关闭结论（规则 6.4：需具备结果、材料位置、记录或明确结论）',
        item.closureNote || item.resultNote || '',
      );
      if (closureNote === null) return;
      updateItem(item.id, { closureNote: closureNote.trim(), status });
      return;
    }
    updateItem(item.id, { status });
  };

  const handleRegisterResult = (item) => {
    const resultNote = window.prompt('办理结果或材料位置（规则 6.3）', item.resultNote || '');
    if (resultNote === null) return;
    updateItem(item.id, { resultNote: resultNote.trim() });
  };

  const handleChangeDueDate = (item) => {
    const dueDate = window.prompt('新的截止时间（YYYY-MM-DD）', item.dueDate || '');
    if (!dueDate) return;
    const approvedBy = window.prompt('同意人（规则 8.1：在信息化工作群明确同意的人员）', '');
    if (!approvedBy) return;
    updateItem(item.id, { dueDate: dueDate.trim(), approvedBy: approvedBy.trim() });
  };

  const handleCopyPublishText = async (item) => {
    const text = buildPublishTextForIssue(item, { roster });
    try {
      await navigator.clipboard.writeText(text);
      window.alert('发布文本已复制，可粘贴到信息化工作群');
    } catch {
      window.alert(`复制失败，请手工复制：\n\n${text}`);
    }
  };

  return (
    <div className="weekly-issue-view">
      <div className="weekly-issue-header">
        <div>
          <h3>周会事项台账</h3>
          <span>{formatDate(weekStart)} - {formatDate(weekEnd)}</span>
          <span
            className={`weekly-store-badge is-${store.mode}`}
            title={store.mode === 'fs'
              ? '登记、状态流转与关闭结论写入 pmo/weekly-issues/ledger.json，随仓库版本管理'
              : `未接入文件正本，数据只存在当前浏览器（${store.error || '静态构建'}）`}
          >
            {store.mode === 'fs' ? '文件正本' : store.mode === 'loading' ? '载入中' : '仅本地'}
          </span>
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
        <input
          className="weekly-actor-input"
          value={actor}
          placeholder="操作人"
          aria-label="操作人"
          onChange={event => {
            setActor(event.target.value);
            try { window.localStorage.setItem('pmo-actor', event.target.value); } catch { /* 忽略存储失败 */ }
          }}
        />
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
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map(item => (
              <tr key={item.id} className={`weekly-issue-row ${item.status === 'closed' ? 'is-closed' : ''}`}>
                <td><span className="weekly-ledger-badge">{item.ledgerName}</span></td>
                <td className="dlv-name" title={item.title}>
                  {item.title}
                  {item.resultNote && <div className="weekly-issue-sub" title={item.resultNote}>结果：{item.resultNote}</div>}
                  {item.closureNote && <div className="weekly-issue-sub" title={item.closureNote}>关闭：{item.closureNote}</div>}
                </td>
                <td>{item.owner || '-'}</td>
                <td>
                  {item.dueDate || '-'}
                  {isWeeklyIssueOverdue(item, referenceDate) && <span className="weekly-overdue-badge">已逾期</span>}
                </td>
                <td>
                  <select className={statusClass(item.status)} value={item.status} onChange={event => handleStatusChange(item, event.target.value)}>
                    {WEEKLY_ISSUE_STATUSES.map(status => <option key={status.key} value={status.key}>{status.label}</option>)}
                  </select>
                </td>
                <td className="dlv-task" title={item.related}>{item.related || '-'}</td>
                <td className="dlv-task" title={item.source}>{item.source || '-'}</td>
                <td className="dlv-task" title={item.closeCriteria}>{item.closeCriteria || getWeeklyIssueType(item.type).closeRule}</td>
                <td className="weekly-issue-actions">
                  <button type="button" className="weekly-mini-btn" onClick={() => handleRegisterResult(item)}>登记结果</button>
                  <button type="button" className="weekly-mini-btn" onClick={() => handleChangeDueDate(item)}>期限调整</button>
                  <button type="button" className="weekly-mini-btn" onClick={() => handleCopyPublishText(item)}>复制发布文本</button>
                </td>
              </tr>
            ))}
            {visibleItems.length === 0 && <tr><td className="empty-row" colSpan={9}>无匹配事项</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
