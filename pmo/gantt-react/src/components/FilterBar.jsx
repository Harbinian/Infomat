export default function FilterBar({ tasks, filters, view, onFilterChange, onViewChange }) {
  const mainlines = [...new Set(tasks.map(t => String(t.wbs).split('.')[0]))].sort((a, b) => +a - +b);
  const departments = [...new Set(tasks.map(t => t.department).filter(Boolean))].sort();
  const vendors = [...new Set(tasks.map(t => t.vendor).filter(Boolean))].sort();
  const types = [...new Set(tasks.map(t => t.type).filter(Boolean))].sort();

  const views = [
    { key: 'all', label: '全部任务' },
    { key: 'overview', label: '总览视图' },
    { key: '2026', label: '2026年' },
    { key: '2027', label: '2027年' },
    { key: '2028', label: '2028年' },
    { key: 'milestones', label: '里程碑' },
    { key: 'highrisk', label: '高风险' },
    { key: 'toggleMilestonePanel', label: '关键里程碑', special: true }
  ];

  const update = (key, value) => onFilterChange({ ...filters, [key]: value });

  return (
    <div className="filter-bar">
      <select value={filters.year} onChange={e => { update('year', e.target.value); }}>
        <option value="all">全部年份</option>
        <option value="2026">2026年</option>
        <option value="2027">2027年</option>
        <option value="2028">2028年</option>
      </select>

      <select value={filters.mainline} onChange={e => update('mainline', e.target.value)}>
        <option value="all">全部主线</option>
        {mainlines.map(m => {
          const topTask = tasks.find(t => String(t.wbs).split('.')[0] === m && String(t.wbs).split('.').length === 1);
          return <option key={m} value={m}>{m}{topTask ? `-${topTask.name}` : ''}</option>;
        })}
      </select>

      <select value={filters.department} onChange={e => update('department', e.target.value)}>
        <option value="all">全部部门</option>
        {departments.map(d => <option key={d} value={d}>{d}</option>)}
      </select>

      <select value={filters.vendor} onChange={e => update('vendor', e.target.value)}>
        <option value="all">全部供应商</option>
        {vendors.map(v => <option key={v} value={v}>{v}</option>)}
      </select>

      <select value={filters.risk} onChange={e => update('risk', e.target.value)}>
        <option value="all">全部风险</option>
        <option value="高">高风险</option>
        <option value="中">中风险</option>
        <option value="低">低风险</option>
      </select>

      <select value={filters.type} onChange={e => update('type', e.target.value)}>
        <option value="all">全部类型</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>

      <select value={filters.milestone} onChange={e => update('milestone', e.target.value)}>
        <option value="all">全部任务</option>
        <option value="yes">仅里程碑</option>
      </select>

      <input type="text" placeholder="搜索任务名称/WBS..." value={filters.search}
        onChange={e => update('search', e.target.value)} />

      <div className="wbs-depth-btns">
        <span className="wbs-depth-label">WBS层级</span>
        {[
          { key: 'all', label: '全部' },
          { key: '1', label: '1级' },
          { key: '2', label: '2级' },
          { key: '3', label: '3级' },
        ].map(d => (
          <button key={d.key}
            className={`wbs-depth-btn${(filters.wbsDepth || 'all') === d.key ? ' active' : ''}`}
            onClick={() => update('wbsDepth', d.key)}
            title={`仅显示 WBS 层级 ≤ ${d.label}`}>{d.label}</button>
        ))}
      </div>

      <div className="view-btns">
        {views.map(v => (
          <button key={v.key}
            className={`${view === v.key ? 'active' : ''}${v.special ? ' ms-btn' : ''}`}
            onClick={() => onViewChange(v.key)}>{v.label}</button>
        ))}
      </div>
    </div>
  );
}
