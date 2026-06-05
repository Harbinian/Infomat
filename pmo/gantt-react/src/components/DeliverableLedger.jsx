import { useMemo, useState } from 'react';
import { formatDate, parseDate, unique } from '../utils/dateUtils';
import { filterAndSortDeliverables } from '../utils/deliverableWorkflow';

const LEVEL_COLORS = { A: '#B88919', B: '#6E879F', C: '#6F8A6A', D: '#9A8F7A' };

const SORTABLE_KEYS = new Set([
  'plannedFinish', 'deliverableLevel', 'deliverableStatus', 'taskRisk',
  'department', 'reviewer', 'deliverableName', 'normalizedWbs',
]);

const COLUMNS = [
  { key: 'deliverableId', label: '编号' },
  { key: 'deliverableName', label: '交付物名称' },
  { key: 'deliverableType', label: '类型' },
  { key: 'deliverableLevel', label: '等级' },
  { key: 'taskName', label: '关联任务' },
  { key: 'normalizedWbs', label: '规范WBS' },
  { key: 'department', label: '责任部门' },
  { key: 'reviewer', label: '审核人' },
  { key: 'vendor', label: '供应商' },
  { key: 'plannedFinish', label: '计划完成' },
  { key: 'taskRisk', label: '风险' },
  { key: 'deliverableStatus', label: '状态' },
  { key: '__actions', label: '凭证' },
];

function formatFileSize(size) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatPlannedFinish(value) {
  const date = parseDate(value);
  return date ? formatDate(date) : '-';
}

function getCellValue(deliverable, key) {
  switch (key) {
    case 'plannedFinish':
      return formatPlannedFinish(deliverable.plannedFinish);
    case 'deliverableLevel':
      return deliverable.deliverableLevel;
    case 'deliverableStatus':
      return deliverable.deliverableStatus;
    case 'taskRisk':
      return deliverable.taskRisk;
    case 'department':
      return deliverable.department || '-';
    case 'reviewer':
      return deliverable.reviewer || '-';
    case 'deliverableName':
      return deliverable.deliverableName;
    case 'normalizedWbs':
      return deliverable.normalizedWbs;
    case 'vendor':
      return deliverable.vendor || '-';
    case 'deliverableType':
      return deliverable.deliverableType;
    case 'taskName':
      return deliverable.taskName;
    case 'deliverableId':
      return deliverable.deliverableId;
    default:
      return '-';
  }
}

export default function DeliverableLedger({
  deliverables,
  filters: controlledFilters,
  sort: controlledSort,
  onFilterChange,
  onSortChange,
  onSelectDeliverable,
  onUploadDeliverable,
  onDownloadDeliverable,
}) {
  const [localFilters, setLocalFilters] = useState({});
  const [localSort, setLocalSort] = useState({ key: 'plannedFinish', direction: 'asc' });
  const [searchInput, setSearchInput] = useState('');

  const filters = controlledFilters !== undefined ? controlledFilters : localFilters;
  const sort = controlledSort !== undefined ? controlledSort : localSort;

  const types = useMemo(() => unique(deliverables.map(d => d.deliverableType)).sort(), [deliverables]);
  const departments = useMemo(() => unique(deliverables.map(d => d.department).filter(Boolean)).sort(), [deliverables]);
  const months = useMemo(() => {
    const values = new Set();
    deliverables.forEach(deliverable => {
      const finish = parseDate(deliverable.plannedFinish);
      if (finish) values.add(`${finish.getFullYear()}-${String(finish.getMonth() + 1).padStart(2, '0')}`);
    });
    return [...values].sort();
  }, [deliverables]);
  const statuses = useMemo(() => unique(deliverables.map(d => d.deliverableStatus).filter(Boolean)).sort(), [deliverables]);

  const filtered = useMemo(
    () => filterAndSortDeliverables(deliverables, { ...filters, search: searchInput || filters.search }, sort),
    [deliverables, filters, sort, searchInput]
  );

  const updateFilter = (key, value) => {
    const next = { ...filters, [key]: value };
    if (onFilterChange) onFilterChange(next);
    else setLocalFilters(next);
  };

  const handleSortClick = (columnKey) => {
    if (!SORTABLE_KEYS.has(columnKey)) return;
    const direction = sort.key === columnKey && sort.direction === 'asc' ? 'desc' : 'asc';
    const next = { key: columnKey, direction };
    if (onSortChange) onSortChange(next);
    else setLocalSort(next);
  };

  const handleUpload = (event, deliverable) => {
    const file = event.target.files?.[0];
    if (file && onUploadDeliverable) onUploadDeliverable(deliverable, file);
    event.target.value = '';
  };

  const sortIndicator = (columnKey) => {
    if (sort.key !== columnKey) return null;
    return sort.direction === 'asc' ? '▲' : '▼';
  };

  return (
    <div className="deliverable-view">
      <div className="dlv-filter-bar">
        <select value={filters.level || 'all'} onChange={event => updateFilter('level', event.target.value)}>
          <option value="all">全部等级</option>
          <option value="A">A类-阶段门</option>
          <option value="B">B类-关键建设</option>
          <option value="C">C类-支撑过程</option>
          <option value="D">D类-参考材料</option>
        </select>
        <select value={filters.type || 'all'} onChange={event => updateFilter('type', event.target.value)}>
          <option value="all">全部类型</option>
          {types.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filters.department || 'all'} onChange={event => updateFilter('department', event.target.value)}>
          <option value="all">全部部门</option>
          {departments.map(department => <option key={department} value={department}>{department}</option>)}
        </select>
        <select value={filters.month || 'all'} onChange={event => updateFilter('month', event.target.value)}>
          <option value="all">全部月份</option>
          {months.map(month => <option key={month} value={month}>{month}</option>)}
        </select>
        <select value={filters.status || 'all'} onChange={event => updateFilter('status', event.target.value)}>
          <option value="all">全部状态</option>
          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
        <input
          type="text"
          placeholder="搜索交付物/任务/WBS..."
          value={searchInput}
          onChange={event => setSearchInput(event.target.value)}
          className="dlv-search"
        />
        <span className="dlv-count">共 {filtered.length} 项</span>
      </div>

      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              {COLUMNS.map(col => {
                const sortable = SORTABLE_KEYS.has(col.key);
                const indicator = sortIndicator(col.key);
                if (!sortable) {
                  return <th key={col.key}>{col.label}</th>;
                }
                return (
                  <th
                    key={col.key}
                    className={`sortable${indicator ? ' sorted' : ''}`}
                    aria-sort={indicator ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => handleSortClick(col.key)}
                    title={`按 ${col.label} 排序`}
                  >
                    <span className="th-label">{col.label}</span>
                    {indicator && <span className="sort-indicator" aria-hidden="true">{indicator}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {filtered.map(deliverable => (
              <tr
                key={deliverable.deliverableId}
                className={`dlv-row dlv-level-${deliverable.deliverableLevel} ${deliverable.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                onClick={() => onSelectDeliverable && onSelectDeliverable(deliverable)}
              >
                {COLUMNS.map(col => {
                  if (col.key === '__actions') {
                    return (
                      <td key={col.key} className="dlv-upload-cell" onClick={event => event.stopPropagation()}>
                        {deliverable.evidence ? (
                          <>
                            <span
                              className="dlv-evidence-name"
                              title={`${deliverable.evidence.fileName} ${formatFileSize(deliverable.evidence.fileSize)}`}
                            >
                              {deliverable.evidence.fileName}
                            </span>
                            <button
                              className="dlv-download-btn"
                              type="button"
                              onClick={() => onDownloadDeliverable && onDownloadDeliverable(deliverable)}
                            >
                              下载
                            </button>
                          </>
                        ) : (
                          <span className="dlv-evidence-empty">未上传</span>
                        )}
                        <label className="dlv-upload-btn">
                          上传
                          <input
                            type="file"
                            onChange={event => handleUpload(event, deliverable)}
                            aria-label={`上传${deliverable.deliverableName}凭证`}
                          />
                        </label>
                      </td>
                    );
                  }
                  if (col.key === 'deliverableLevel') {
                    const level = deliverable.deliverableLevel;
                    return (
                      <td key={col.key}>
                        <span className="dlv-level-badge" style={{ color: LEVEL_COLORS[level], borderColor: LEVEL_COLORS[level] }}>{level}</span>
                      </td>
                    );
                  }
                  if (col.key === 'taskRisk') {
                    return (
                      <td key={col.key}>
                        <span className={`dlv-risk risk-${deliverable.taskRisk}`}>{deliverable.taskRisk}</span>
                      </td>
                    );
                  }
                  if (col.key === 'deliverableName') {
                    return <td key={col.key} className="dlv-name" title={deliverable.deliverableName}>{getCellValue(deliverable, col.key)}</td>;
                  }
                  if (col.key === 'taskName') {
                    return <td key={col.key} className="dlv-task" title={deliverable.taskName}>{getCellValue(deliverable, col.key)}</td>;
                  }
                  if (col.key === 'normalizedWbs') {
                    return <td key={col.key} className="dlv-wbs">{getCellValue(deliverable, col.key)}</td>;
                  }
                  if (col.key === 'reviewer') {
                    return <td key={col.key} className="dlv-reviewer" title={deliverable.reviewer}>{getCellValue(deliverable, col.key)}</td>;
                  }
                  return <td key={col.key}>{getCellValue(deliverable, col.key)}</td>;
                })}
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan={COLUMNS.length} className="empty-row">无匹配交付物</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
