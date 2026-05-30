import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardCards from './components/DashboardCards';
import FilterBar from './components/FilterBar';
import TaskTree from './components/TaskTree';
import GanttChart from './components/GanttChart';
import TaskDetail from './components/TaskDetail';
import MilestoneList from './components/MilestoneList';
import { buildTaskTree, applyFilters } from './utils/dateUtils';
import './App.css';

const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '' };

export default function App() {
  const [allTasks, setAllTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('all');
  const [selectedWbs, setSelectedWbs] = useState(null);
  const [monthWidth, setMonthWidth] = useState(82);

  useEffect(() => {
    fetch('tasks.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(data => { setAllTasks(data); setLoading(false); })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const treeData = useMemo(() => buildTaskTree(allTasks), [allTasks]);

  const filteredTasks = useMemo(() => {
    if (!allTasks.length) return [];
    return applyFilters(allTasks, filters, view);
  }, [allTasks, filters, view]);

  const handleFilterChange = useCallback((newFilters) => { setFilters(newFilters); }, []);
  const handleViewChange = useCallback((newView) => {
    setView(newView);
    if (['2026', '2027', '2028'].includes(newView)) {
      setFilters(prev => ({ ...prev, year: newView }));
    } else {
      setFilters(prev => ({ ...prev, year: 'all' }));
    }
  }, []);

  const handleSelect = useCallback((wbs) => { setSelectedWbs(wbs); }, []);
  const handleToggle = useCallback((wbs) => {
    const node = treeData.map[wbs];
    if (node) node._expanded = !node._expanded;
    setSelectedWbs(prev => prev); // force re-render
  }, [treeData]);

  const handleZoom = useCallback((w) => {
    setMonthWidth(Math.max(24, Math.min(280, w)));
  }, []);

  const selectedTask = useMemo(() => selectedWbs ? treeData.map[selectedWbs] : null, [selectedWbs, treeData]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setSelectedWbs(null); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return <div className="loading">数据加载中</div>;
  if (error) return <div className="loading">数据加载失败：{error}</div>;

  return (
    <>
      <div className="header">
        <h1>数字化底座项目甘特图</h1>
        <div className="subtitle">2026.06.01 — 2028.01.31 ｜ 数据来源：信息化项目.csv ｜ React 版</div>
      </div>

      <DashboardCards tasks={filteredTasks} />

      <FilterBar tasks={allTasks} filters={filters} view={view}
        onFilterChange={handleFilterChange} onViewChange={handleViewChange} />

      <div className="main-container">
        <TaskTree tasks={filteredTasks} treeMap={treeData.map}
          selectedWbs={selectedWbs} onSelect={handleSelect} onToggle={handleToggle} />

        <GanttChart tasks={filteredTasks} treeMap={treeData.map}
          monthWidth={monthWidth} selectedWbs={selectedWbs}
          onSelect={handleSelect} onZoomChange={handleZoom} />
      </div>

      <MilestoneList tasks={filteredTasks} />

      {selectedTask && <TaskDetail task={selectedTask} onClose={() => setSelectedWbs(null)} />}
    </>
  );
}
