import { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardCards from './components/DashboardCards';
import FilterBar from './components/FilterBar';
import PMODatePicker from './components/PMODatePicker';
import WBSQualityBanner from './components/WBSQualityBanner';
import TaskTree from './components/TaskTree';
import GanttChart from './components/GanttChart';
import TaskDetail from './components/TaskDetail';
import MilestoneList from './components/MilestoneList';
import DeliverableLedger from './components/DeliverableLedger';
import PhaseGateView from './components/PhaseGateView';
import ThisWeekDeliverables from './components/ThisWeekDeliverables';
import OverdueDeliverables from './components/OverdueDeliverables';
import PMOWeeklyView from './components/PMOWeeklyView';
import DeliverableDetail from './components/DeliverableDetail';
import { buildTaskTree, applyFilters, normalizeTasks, analyzeTasks, computeProjectRange, formatDate, parseDate } from './utils/dateUtils';
import { normalizeDeliverables, loadDeliverableStatusOverrides } from './utils/deliverableUtils.js';
import { buildPhaseGates } from './utils/phaseGateUtils.js';
import './App.css';

const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '', wbsDepth: 'all' };
const EVIDENCE_STORAGE_KEY = 'pmo-deliverable-evidence-v1';
const EVIDENCE_DB_NAME = 'pmo-deliverable-evidence-db';
const EVIDENCE_STORE_NAME = 'evidenceFiles';
const PMO_VIEW_LABELS = [
  { key: 'pmo', label: 'PMO周会' },
  { key: 'deliverables', label: '交付物台账' },
  { key: 'phasegates', label: '阶段门' },
  { key: 'thisweek', label: '本周交付物' },
  { key: 'overdue', label: '延期交付物' },
];

function getInitialPage() {
  return window.location.hash === '#/pmo' ? 'pmo' : 'gantt';
}

function loadStoredEvidence() {
  try {
    const raw = window.localStorage.getItem(EVIDENCE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredEvidence(evidenceMap) {
  try {
    window.localStorage.setItem(EVIDENCE_STORAGE_KEY, JSON.stringify(evidenceMap));
  } catch {
    // Storage quota or browser privacy mode should not block the dashboard.
  }
}

function openEvidenceDatabase() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error('当前浏览器不支持本地文件存储'));
      return;
    }

    const request = window.indexedDB.open(EVIDENCE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVIDENCE_STORE_NAME)) {
        db.createObjectStore(EVIDENCE_STORE_NAME, { keyPath: 'deliverableId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeEvidenceFile(deliverableId, file, evidence) {
  const db = await openEvidenceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EVIDENCE_STORE_NAME, 'readwrite');
    transaction.objectStore(EVIDENCE_STORE_NAME).put({ deliverableId, ...evidence, file });
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function readEvidenceFile(deliverableId) {
  const db = await openEvidenceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(EVIDENCE_STORE_NAME, 'readonly');
    const request = transaction.objectStore(EVIDENCE_STORE_NAME).get(deliverableId);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      db.close();
      reject(request.error);
    };
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

export default function App() {
  const [rawTasks, setRawTasks] = useState([]);
  const [allTasks, setAllTasks] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [page, setPage] = useState(getInitialPage);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [view, setView] = useState('all');
  const [pmoView, setPmoView] = useState('pmo');
  const [selectedNodeKey, setSelectedNodeKey] = useState(null);
  const [monthWidth, setMonthWidth] = useState(82);
  const [showMilestonePanel, setShowMilestonePanel] = useState(false);
  const [selectedDeliverable, setSelectedDeliverable] = useState(null);
  const [pmoDate, setPmoDate] = useState(new Date());
  const [projectStart, setProjectStart] = useState(null);
  const [expandedOverrides, setExpandedOverrides] = useState({});
  const [evidenceMap, setEvidenceMap] = useState(loadStoredEvidence);

  useEffect(() => {
    const onHashChange = () => setPage(getInitialPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = page === 'pmo' ? '数字化底座 PMO 项目管控看板' : '数字化底座项目甘特图';
  }, [page]);

  useEffect(() => {
    fetch('tasks.json')
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(async data => {
        setRawTasks(data);
        const normalized = normalizeTasks(data);
        computeProjectRange(normalized);
        analyzeTasks(data);
        setAllTasks(normalized);
        let normalizedDeliverables = normalizeDeliverables(normalized);
        normalizedDeliverables = await loadDeliverableStatusOverrides(normalizedDeliverables);
        setDeliverables(normalizedDeliverables);
        const starts = normalized.map(t => parseDate(t.start)).filter(Boolean);
        if (starts.length) {
          setProjectStart(new Date(Math.min(...starts.map(d => d.getTime()))));
        }
        setLoading(false);
      })
      .catch(err => { setError(err.message); setLoading(false); });
  }, []);

  const deliverablesWithEvidence = useMemo(() => deliverables.map(deliverable => {
    const evidence = evidenceMap[deliverable.deliverableId];
    if (!evidence) return deliverable;
    return {
      ...deliverable,
      evidence,
      deliverableStatus: deliverable.deliverableStatus === '未提交' ? '已提交' : deliverable.deliverableStatus,
      _actualSubmitDate: deliverable._actualSubmitDate || evidence.uploadedAt.slice(0, 10),
      notes: deliverable.notes || `已本地登记凭证：${evidence.fileName}`,
    };
  }), [deliverables, evidenceMap]);

  const treeData = useMemo(() => {
    const built = buildTaskTree(allTasks);
    Object.entries(expandedOverrides).forEach(([nodeKey, expanded]) => {
      if (built.map[nodeKey]) built.map[nodeKey]._expanded = expanded;
    });
    return built;
  }, [allTasks, expandedOverrides]);
  const phaseGates = useMemo(() => buildPhaseGates(deliverablesWithEvidence, pmoDate), [deliverablesWithEvidence, pmoDate]);

  const filteredTasks = useMemo(() => {
    if (!allTasks.length) return [];
    return applyFilters(allTasks, filters, view);
  }, [allTasks, filters, view]);

  const tasksWithDeliverableInfo = useMemo(() => {
    const byTaskId = {};
    const byNodeKey = {};
    deliverablesWithEvidence.forEach(deliverable => {
      if (deliverable.taskId != null) byTaskId[deliverable.taskId] = deliverable;
      if (deliverable.nodeKey) byNodeKey[deliverable.nodeKey] = deliverable;
    });
    return allTasks.map(task => {
      const deliverable = byTaskId[task.originalId] || byTaskId[task.id] || byNodeKey[task.nodeKey];
      if (!deliverable) return task;
      return {
        ...task,
        _deliverableId: deliverable.deliverableId,
        _deliverableName: deliverable.deliverableName,
        _deliverableType: deliverable.deliverableType,
        _deliverableLevel: deliverable.deliverableLevel,
        _deliverableStatus: deliverable.deliverableStatus,
        _isPhaseGate: deliverable.isPhaseGate,
      };
    });
  }, [allTasks, deliverablesWithEvidence]);

  const handleFilterChange = useCallback((newFilters) => { setFilters(newFilters); }, []);
  const handlePageChange = useCallback((nextPage) => {
    setSelectedNodeKey(null);
    setSelectedDeliverable(null);
    setShowMilestonePanel(false);
    setPage(nextPage);
    window.location.hash = nextPage === 'pmo' ? '#/pmo' : '#/gantt';
  }, []);

  const handleViewChange = useCallback((newView) => {
    if (newView === 'toggleMilestonePanel') { setShowMilestonePanel(prev => !prev); return; }
    setView(newView);
    if (['2026', '2027', '2028'].includes(newView)) { setFilters(prev => ({ ...prev, year: newView })); }
    else { setFilters(prev => ({ ...prev, year: 'all' })); }
  }, []);

  const handleSelect = useCallback((nodeKey) => { setSelectedNodeKey(nodeKey); }, []);
  const handleToggle = useCallback((nodeKey) => {
    const node = treeData.map[nodeKey];
    if (!node) return;
    const nextExpanded = !(node._expanded !== false);
    setExpandedOverrides(prev => ({ ...prev, [nodeKey]: nextExpanded }));
  }, [treeData]);

  const handleZoom = useCallback((w) => { setMonthWidth(Math.max(24, Math.min(280, w))); }, []);

  const selectedTask = useMemo(() => {
    if (!selectedNodeKey) return null;
    return tasksWithDeliverableInfo.find(t => t.nodeKey === selectedNodeKey) || treeData.map[selectedNodeKey] || null;
  }, [selectedNodeKey, treeData, tasksWithDeliverableInfo]);

  const handleSelectDeliverable = useCallback((deliverable) => { setSelectedDeliverable(deliverable); }, []);
  const handleUploadDeliverable = useCallback(async (deliverable, file) => {
    if (!deliverable || !file) return;
    const evidence = {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || 'unknown',
      uploadedAt: new Date().toISOString(),
      source: '浏览器本地存储',
    };

    try {
      await storeEvidenceFile(deliverable.deliverableId, file, evidence);
    } catch (error) {
      evidence.source = '浏览器本地登记';
      evidence.storageNote = error.message || '文件本体未写入本地存储';
    }

    setEvidenceMap(prev => {
      const next = {
        ...prev,
        [deliverable.deliverableId]: evidence,
      };
      saveStoredEvidence(next);
      return next;
    });
  }, []);

  const handleDownloadDeliverable = useCallback(async (deliverable) => {
    if (!deliverable?.deliverableId) return;
    try {
      const record = await readEvidenceFile(deliverable.deliverableId);
      if (!record?.file) {
        window.alert('当前只有凭证登记信息，未找到可下载的本地文件。');
        return;
      }
      const url = window.URL.createObjectURL(record.file);
      const link = document.createElement('a');
      link.href = url;
      link.download = record.fileName || deliverable.evidence?.fileName || `${deliverable.deliverableId}-evidence`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
    } catch {
      window.alert('读取本地凭证失败，请重新上传后再试。');
    }
  }, []);

  const subtitle = useMemo(() => {
    if (!allTasks.length) return '';
    const realTasks = allTasks.filter(t => !t.notes || !t.notes.includes('[自动生成的虚拟父节点]'));
    const starts = realTasks.map(t => parseDate(t.start)).filter(Boolean);
    const ends = realTasks.map(t => parseDate(t.finish)).filter(Boolean);
    if (!starts.length) return '';
    const ds = new Date(Math.min(...starts.map(d => d.getTime())));
    const de = new Date(Math.max(...ends.map(d => d.getTime())));
    return `${formatDate(ds)} - ${formatDate(de)} ｜ 交付物 ${deliverablesWithEvidence.length} 项`;
  }, [allTasks, deliverablesWithEvidence]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setSelectedNodeKey(null);
        setSelectedDeliverable(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  if (loading) return <div className="loading">数据加载中</div>;
  if (error) return <div className="loading">数据加载失败：{error}</div>;

  const renderPMOContent = () => {
    switch (pmoView) {
      case 'deliverables':
        return <DeliverableLedger deliverables={deliverablesWithEvidence} onSelectDeliverable={handleSelectDeliverable} onUploadDeliverable={handleUploadDeliverable} onDownloadDeliverable={handleDownloadDeliverable} />;
      case 'phasegates':
        return <PhaseGateView phaseGates={phaseGates} />;
      case 'thisweek':
        return <ThisWeekDeliverables deliverables={deliverablesWithEvidence} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
      case 'overdue':
        return <OverdueDeliverables deliverables={deliverablesWithEvidence} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
      case 'pmo':
        return <PMOWeeklyView deliverables={deliverablesWithEvidence} phaseGates={phaseGates} tasks={allTasks} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
      default:
        return <PMOWeeklyView deliverables={deliverablesWithEvidence} phaseGates={phaseGates} tasks={allTasks} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
    }
  };

  return (
    <>
      <div className="header">
        <div className="header-top">
          <div>
            <h1>{page === 'pmo' ? '数字化底座 PMO 项目管控看板' : '数字化底座项目甘特图'}</h1>
            <div className="subtitle">{subtitle}</div>
          </div>
          <div className="page-tabs">
            <button className={page === 'gantt' ? 'active' : ''} onClick={() => handlePageChange('gantt')} type="button">甘特图</button>
            <button className={page === 'pmo' ? 'active' : ''} onClick={() => handlePageChange('pmo')} type="button">PMO看板</button>
          </div>
        </div>
      </div>

      {page === 'gantt' ? (
        <>
          <FilterBar tasks={allTasks} filters={filters} view={view}
            onFilterChange={handleFilterChange} onViewChange={handleViewChange} />

          <div className="main-container">
            <TaskTree tasks={filteredTasks} treeMap={treeData.map}
              wbsDepth={filters.wbsDepth}
              selectedNodeKey={selectedNodeKey} onSelect={handleSelect} onToggle={handleToggle} />

            <GanttChart tasks={filteredTasks} treeMap={treeData.map}
              monthWidth={monthWidth} selectedNodeKey={selectedNodeKey}
              onSelect={handleSelect} onZoomChange={handleZoom} />
          </div>

          <MilestoneList tasks={filteredTasks} show={showMilestonePanel}
            onClose={() => setShowMilestonePanel(false)} />

          {selectedTask && <TaskDetail task={selectedTask} onClose={() => setSelectedNodeKey(null)} />}
        </>
      ) : (
        <div className="pmo-page">
          <WBSQualityBanner rawTasks={rawTasks} />
          <DashboardCards tasks={allTasks} deliverables={deliverablesWithEvidence} phaseGates={phaseGates} pmoDate={pmoDate} />
          <PMODatePicker pmoDate={pmoDate} onDateChange={setPmoDate} projectStart={projectStart} />
          <div className="pmo-view-tabs">
            {PMO_VIEW_LABELS.map(item => (
              <button key={item.key} className={pmoView === item.key ? 'active' : ''} onClick={() => setPmoView(item.key)} type="button">
                {item.label}
              </button>
            ))}
          </div>
          {renderPMOContent()}
          {selectedDeliverable && <DeliverableDetail deliverable={selectedDeliverable} phaseGates={phaseGates} onClose={() => setSelectedDeliverable(null)} />}
        </div>
      )}
    </>
  );
}
