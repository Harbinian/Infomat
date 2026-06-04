import { useMemo, useState } from 'react';
import { formatDate, parseDate, unique } from '../utils/dateUtils';

const LEVEL_COLORS = { A: '#B88919', B: '#6E879F', C: '#6F8A6A', D: '#9A8F7A' };

function formatFileSize(size) {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export default function DeliverableLedger({ deliverables, onSelectDeliverable, onUploadDeliverable, onDownloadDeliverable }) {
  const [filterLevel, setFilterLevel] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [filterDept, setFilterDept] = useState('all');
  const [filterMonth, setFilterMonth] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

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

  const filtered = useMemo(() => {
    return deliverables.filter(deliverable => {
      if (filterLevel !== 'all' && deliverable.deliverableLevel !== filterLevel) return false;
      if (filterType !== 'all' && deliverable.deliverableType !== filterType) return false;
      if (filterDept !== 'all' && deliverable.department !== filterDept) return false;
      if (filterStatus !== 'all' && deliverable.deliverableStatus !== filterStatus) return false;
      if (filterMonth !== 'all') {
        const finish = parseDate(deliverable.plannedFinish);
        if (!finish) return false;
        const ym = `${finish.getFullYear()}-${String(finish.getMonth() + 1).padStart(2, '0')}`;
        if (ym !== filterMonth) return false;
      }
      return true;
    });
  }, [deliverables, filterLevel, filterType, filterDept, filterMonth, filterStatus]);

  const handleUpload = (event, deliverable) => {
    const file = event.target.files?.[0];
    if (file && onUploadDeliverable) onUploadDeliverable(deliverable, file);
    event.target.value = '';
  };

  return (
    <div className="deliverable-view">
      <div className="dlv-filter-bar">
        <select value={filterLevel} onChange={event => setFilterLevel(event.target.value)}>
          <option value="all">全部等级</option>
          <option value="A">A类-阶段门</option>
          <option value="B">B类-关键建设</option>
          <option value="C">C类-支撑过程</option>
          <option value="D">D类-参考材料</option>
        </select>
        <select value={filterType} onChange={event => setFilterType(event.target.value)}>
          <option value="all">全部类型</option>
          {types.map(type => <option key={type} value={type}>{type}</option>)}
        </select>
        <select value={filterDept} onChange={event => setFilterDept(event.target.value)}>
          <option value="all">全部部门</option>
          {departments.map(department => <option key={department} value={department}>{department}</option>)}
        </select>
        <select value={filterMonth} onChange={event => setFilterMonth(event.target.value)}>
          <option value="all">全部月份</option>
          {months.map(month => <option key={month} value={month}>{month}</option>)}
        </select>
        <select value={filterStatus} onChange={event => setFilterStatus(event.target.value)}>
          <option value="all">全部状态</option>
          {statuses.map(status => <option key={status} value={status}>{status}</option>)}
        </select>
        <span className="dlv-count">共 {filtered.length} 项</span>
      </div>

      <div className="dlv-table-wrap">
        <table className="dlv-table">
          <thead>
            <tr>
              <th>编号</th>
              <th>交付物名称</th>
              <th>类型</th>
              <th>等级</th>
              <th>关联任务</th>
              <th>规范WBS</th>
              <th>责任部门</th>
              <th>审核人</th>
              <th>供应商</th>
              <th>计划完成</th>
              <th>风险</th>
              <th>状态</th>
              <th>凭证</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(deliverable => (
              <tr
                key={deliverable.deliverableId}
                className={`dlv-row dlv-level-${deliverable.deliverableLevel} ${deliverable.taskRisk === '高' ? 'dlv-high-risk' : ''}`}
                onClick={() => onSelectDeliverable && onSelectDeliverable(deliverable)}
              >
                <td className="dlv-id">{deliverable.deliverableId}</td>
                <td className="dlv-name" title={deliverable.deliverableName}>{deliverable.deliverableName}</td>
                <td>{deliverable.deliverableType}</td>
                <td><span className="dlv-level-badge" style={{ color: LEVEL_COLORS[deliverable.deliverableLevel], borderColor: LEVEL_COLORS[deliverable.deliverableLevel] }}>{deliverable.deliverableLevel}</span></td>
                <td className="dlv-task" title={deliverable.taskName}>{deliverable.taskName}</td>
                <td className="dlv-wbs">{deliverable.normalizedWbs}</td>
                <td>{deliverable.department || '-'}</td>
                <td className="dlv-reviewer" title={deliverable.reviewer}>{deliverable.reviewer || '-'}</td>
                <td>{deliverable.vendor || '-'}</td>
                <td>{deliverable.plannedFinish ? formatDate(parseDate(deliverable.plannedFinish)) : '-'}</td>
                <td><span className={`dlv-risk risk-${deliverable.taskRisk}`}>{deliverable.taskRisk}</span></td>
                <td><span className="dlv-status">{deliverable.deliverableStatus}</span></td>
                <td className="dlv-upload-cell" onClick={event => event.stopPropagation()}>
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
              </tr>
            ))}
            {filtered.length === 0 && <tr><td colSpan="13" className="empty-row">无匹配交付物</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
