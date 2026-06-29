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
import TaskLedger from './components/TaskLedger';
import { buildTaskTree, applyFilters, normalizeTasks, analyzeTasks, computeProjectRange, formatDate, parseDate, filterTasksByExpansion } from './utils/dateUtils';
import { normalizeDeliverables, loadDeliverableStatusOverrides } from './utils/deliverableUtils.js';
import { buildPhaseGates } from './utils/phaseGateUtils.js';
import { transitionDeliverableStatus } from './utils/deliverableWorkflow.js';
import { useDeliverableFsEvents } from './hooks/useDeliverableFs.js';
import './App.css';

const DEFAULT_FILTERS = { year: 'all', mainline: 'all', department: 'all', vendor: 'all', risk: 'all', type: 'all', milestone: 'all', search: '', wbsDepth: 'all', taskKind: 'all' };
const EVIDENCE_STORAGE_KEY = 'pmo-deliverable-evidence-v1';
const EVIDENCE_DB_NAME = 'pmo-deliverable-evidence-db';
const EVIDENCE_STORE_NAME = 'evidenceFiles';
const PMO_VIEW_LABELS = [
  { key: 'pmo', label: 'PMO周会' },
  { key: 'tasks', label: '任务清单' },
  { key: 'deliverables', label: '交付物台账' },
  { key: 'phasegates', label: '阶段门' },
  { key: 'thisweek', label: '本周交付物' },
  { key: 'overdue', label: '延期交付物' },
];

const TOP_LEVEL_PAGES = [
  { key: 'gantt', label: '甘特图' },
  { key: 'pmo', label: 'PMO看板' },
  { key: 'procedure', label: '流程地图' },
];

const PAGE_META = {
  gantt: { title: '数字化底座项目甘特图', hash: '#/gantt' },
  pmo: { title: '数字化底座 PMO 项目管控看板', hash: '#/pmo' },
  procedure: { title: '流程地图驾驶舱', hash: '#/procedure-dashboard' },
};

function getInitialPage() {
  if (window.location.hash === '#/pmo') return 'pmo';
  if (['#/procedure-dashboard', '#/procedure'].includes(window.location.hash)) return 'procedure';
  return 'gantt';
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

const loadDeliverableFsApi = import.meta.env.DEV
  ? () => import('./utils/deliverableFsApi.js')
  : async () => {
    const error = new Error('dev-only deliverable fs api unavailable');
    error.code = 'HTTP_ERROR';
    error.status = 404;
    throw error;
  };

async function loadProjectGovernanceSnapshot() {
  try {
    const response = await fetch('project-governance-weekly-report.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return {
      status: 'ready',
      data: await response.json(),
      error: null,
    };
  } catch (error) {
    return {
      status: 'missing',
      data: null,
      error: error.message || '项目治理快照未生成',
    };
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
  const [ledgerFilters, setLedgerFilters] = useState({});
  const [ledgerSort, setLedgerSort] = useState({ key: 'plannedFinish', direction: 'asc' });
  const [taskFilters, setTaskFilters] = useState({});
  const [localTransitions, setLocalTransitions] = useState({});
  const [projectGovernance, setProjectGovernance] = useState({ status: 'loading', data: null, error: null });

  const loadProjectData = useCallback(async ({ showLoading = false } = {}) => {
    if (showLoading) setLoading(true);
    try {
      const [response, projectGovernanceSnapshot] = await Promise.all([
        fetch('tasks.json'),
        loadProjectGovernanceSnapshot(),
      ]);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      setProjectGovernance(projectGovernanceSnapshot);
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
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const onHashChange = () => setPage(getInitialPage());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = PAGE_META[page]?.title || PAGE_META.gantt.title;
  }, [page]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadProjectData({ showLoading: false });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadProjectData]);

  useDeliverableFsEvents(() => {
    loadProjectData({ showLoading: false });
  });

  const deliverablesWithEvidence = useMemo(() => deliverables.map(deliverable => {
    const evidence = evidenceMap[deliverable.deliverableId];
    const transition = localTransitions[deliverable.deliverableId];
    const merged = transition ? { ...deliverable, ...transition } : deliverable;
    if (!evidence) return merged;
    return {
      ...merged,
      evidence,
      deliverableStatus: merged.deliverableStatus === '未提交' ? '已提交' : merged.deliverableStatus,
      _actualSubmitDate: merged._actualSubmitDate || evidence.uploadedAt.slice(0, 10),
      notes: merged.notes || `已本地登记凭证：${evidence.fileName}`,
    };
  }), [deliverables, evidenceMap, localTransitions]);

  const treeData = useMemo(() => {
    const built = buildTaskTree(allTasks);
    Object.entries(expandedOverrides).forEach(([nodeKey, expanded]) => {
      if (built.map[nodeKey]) built.map[nodeKey]._expanded = expanded;
    });
    return built;
  }, [allTasks, expandedOverrides]);
  const phaseGates = useMemo(() => buildPhaseGates(deliverablesWithEvidence, pmoDate), [deliverablesWithEvidence, pmoDate]);

  const selectedDisplayDeliverable = useMemo(() => {
    if (!selectedDeliverable?.deliverableId) return null;
    return deliverablesWithEvidence.find(item => item.deliverableId === selectedDeliverable.deliverableId) || selectedDeliverable;
  }, [deliverablesWithEvidence, selectedDeliverable]);

  const filteredTasks = useMemo(() => {
    if (!allTasks.length) return [];
    return applyFilters(allTasks, filters, view);
  }, [allTasks, filters, view]);

  const displayTasks = useMemo(
    () => filterTasksByExpansion(filteredTasks, treeData.map),
    [filteredTasks, treeData]
  );

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
    const normalizedPage = PAGE_META[nextPage] ? nextPage : 'gantt';
    setPage(normalizedPage);
    window.location.hash = PAGE_META[normalizedPage].hash;
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
    try {
      const { uploadDeliverableEvidence } = await loadDeliverableFsApi();
      await uploadDeliverableEvidence(deliverable.deliverableId, file, { deliverable });
      setEvidenceMap(prev => {
        if (!prev[deliverable.deliverableId]) return prev;
        const next = { ...prev };
        delete next[deliverable.deliverableId];
        saveStoredEvidence(next);
        return next;
      });
      await loadProjectData({ showLoading: false });
      return;
    } catch (error) {
      if (!['HTTP_ERROR', 'NOT_FOUND'].includes(error.code) && error.status !== 404) {
        window.alert(error.message || '上传凭证失败');
        return;
      }
    }

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
  }, [loadProjectData]);

  const handleDownloadDeliverable = useCallback(async (deliverable) => {
    if (!deliverable?.deliverableId) return;
    try {
      const { getDeliverableRaw } = await loadDeliverableFsApi();
      const raw = await getDeliverableRaw(deliverable.deliverableId);
      const blob = new Blob([raw], { type: 'text/markdown;charset=utf-8' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = deliverable.canonicalFileName || `${deliverable.deliverableId}-${deliverable.deliverableName || '正本'}.md`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 0);
      return;
    } catch {
      // Dev plugin unavailable: fall back to old browser-local evidence storage.
    }

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

  const handleDashboardCardNavigate = useCallback((target) => {
    if (!target) return;
    if (target.page === 'gantt') {
      handlePageChange('gantt');
      if (target.view) {
        handleViewChange(target.view);
      } else {
        handleViewChange('all');
      }
      setFilters(prev => {
        const taskFilters = target.taskFilters || {};
        const next = { ...prev, ...taskFilters, year: 'all' };
        if (taskFilters.taskKind == null) next.taskKind = 'all';
        if (taskFilters.milestone == null) next.milestone = 'all';
        if (taskFilters.risk == null) next.risk = 'all';
        return next;
      });
      return;
    }
    if (target.page === 'pmo') {
      handlePageChange('pmo');
      if (target.pmoView) setPmoView(target.pmoView);
      if (target.ledgerFilters) setLedgerFilters(target.ledgerFilters);
      if (target.gateStatus) setLedgerFilters(prev => ({ ...prev, gateStatus: target.gateStatus }));
      if (target.taskFilters) setTaskFilters(target.taskFilters);
    }
  }, [handlePageChange, handleViewChange]);

  const handleLedgerFilterChange = useCallback((next) => {
    setLedgerFilters(next);
  }, []);

  const handleLedgerSortChange = useCallback((next) => {
    setLedgerSort(next);
  }, []);

  const handleDeliverableTransition = useCallback((deliverable, command) => {
    if (!deliverable?.deliverableId || !command?.action) return;
    loadDeliverableFsApi()
      .then(({ transitionDeliverable }) => transitionDeliverable(deliverable.deliverableId, command, { ifMatch: deliverable.canonicalMtime }))
      .then(() => loadProjectData({ showLoading: false }))
      .catch(error => {
        if (!['HTTP_ERROR', 'NOT_FOUND'].includes(error.code) && error.status !== 404) {
          window.alert(error.message || '状态变更失败');
          return;
        }
        try {
          const next = transitionDeliverableStatus(deliverable, command);
          setLocalTransitions(prev => ({ ...prev, [deliverable.deliverableId]: next }));
        } catch (fallbackError) {
          window.alert(fallbackError.message || '状态变更失败');
        }
      });
  }, [loadProjectData]);

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

  if (page !== 'procedure' && loading) return <div className="loading">数据加载中</div>;
  if (page !== 'procedure' && error) return <div className="loading">数据加载失败：{error}</div>;

  const renderPMOContent = () => {
    switch (pmoView) {
      case 'tasks':
        return <TaskLedger tasks={allTasks} filters={taskFilters} />;
      case 'deliverables':
        return <DeliverableLedger
          deliverables={deliverablesWithEvidence}
          filters={ledgerFilters}
          sort={ledgerSort}
          onFilterChange={handleLedgerFilterChange}
          onSortChange={handleLedgerSortChange}
          onSelectDeliverable={handleSelectDeliverable}
          onUploadDeliverable={handleUploadDeliverable}
          onDownloadDeliverable={handleDownloadDeliverable}
        />;
      case 'phasegates':
        return <PhaseGateView phaseGates={phaseGates} gateStatusFilter={ledgerFilters.gateStatus} />;
      case 'thisweek':
        return <ThisWeekDeliverables deliverables={deliverablesWithEvidence} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
      case 'overdue':
        return <OverdueDeliverables deliverables={deliverablesWithEvidence} pmoDate={pmoDate} onSelectDeliverable={handleSelectDeliverable} />;
      case 'pmo':
        return <PMOWeeklyView deliverables={deliverablesWithEvidence} phaseGates={phaseGates} tasks={allTasks} pmoDate={pmoDate} projectGovernance={projectGovernance} onSelectDeliverable={handleSelectDeliverable} />;
      default:
        return <PMOWeeklyView deliverables={deliverablesWithEvidence} phaseGates={phaseGates} tasks={allTasks} pmoDate={pmoDate} projectGovernance={projectGovernance} onSelectDeliverable={handleSelectDeliverable} />;
    }
  };

  const pageTitle = PAGE_META[page]?.title || PAGE_META.gantt.title;
  const headerSubtitle = page === 'procedure' ? '' : subtitle;

  return (
    <>
      <div className="header">
        <div className="header-top">
          <div>
            <h1>{pageTitle}</h1>
            {headerSubtitle && <div className="subtitle">{headerSubtitle}</div>}
          </div>
          <div className="page-tabs">
            {TOP_LEVEL_PAGES.map(item => (
              <button key={item.key} className={page === item.key ? 'active' : ''} onClick={() => handlePageChange(item.key)} type="button">
                {item.label}
              </button>
            ))}
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

            <GanttChart tasks={displayTasks} treeMap={treeData.map}
              monthWidth={monthWidth} selectedNodeKey={selectedNodeKey}
              onSelect={handleSelect} onZoomChange={handleZoom} />
          </div>

          <MilestoneList tasks={filteredTasks} show={showMilestonePanel}
            onClose={() => setShowMilestonePanel(false)} />

          {selectedTask && <TaskDetail task={selectedTask} onClose={() => setSelectedNodeKey(null)} />}
        </>
      ) : page === 'procedure' ? (
        <div className="procedure-page">
          <iframe className="procedure-dashboard-frame" src="/procedure-management/dashboard.html" title="流程地图驾驶舱" />
        </div>
      ) : (
        <div className="pmo-page">
          <WBSQualityBanner rawTasks={rawTasks} />
          <DashboardCards tasks={allTasks} deliverables={deliverablesWithEvidence} phaseGates={phaseGates} pmoDate={pmoDate} onCardClick={handleDashboardCardNavigate} />
          <PMODatePicker pmoDate={pmoDate} onDateChange={setPmoDate} projectStart={projectStart} />
          <div className="pmo-view-tabs">
            {PMO_VIEW_LABELS.map(item => (
              <button key={item.key} className={pmoView === item.key ? 'active' : ''} onClick={() => { setPmoView(item.key); if (item.key !== 'phasegates') setLedgerFilters(prev => { if (!prev.gateStatus) return prev; const next = { ...prev }; delete next.gateStatus; return next; }); }} type="button">
                {item.label}
              </button>
            ))}
          </div>
          {renderPMOContent()}
          {selectedDisplayDeliverable && <DeliverableDetail deliverable={selectedDisplayDeliverable} phaseGates={phaseGates} onClose={() => setSelectedDeliverable(null)} onTransition={handleDeliverableTransition} onDownloadDeliverable={handleDownloadDeliverable} />}
        </div>
      )}
    </>
  );
}
