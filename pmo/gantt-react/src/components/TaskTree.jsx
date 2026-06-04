import { getWbsLevel } from '../utils/dateUtils';

export default function TaskTree({ tasks, treeMap, wbsDepth, selectedNodeKey, onSelect, onToggle }) {
  const maxLevel = wbsDepth && wbsDepth !== 'all' ? parseInt(wbsDepth, 10) : Infinity;
  const visibleSet = new Set(tasks.map(t => t.wbs));
  tasks.forEach(t => {
    if (t.normalizedWbs) visibleSet.add(t.normalizedWbs);
    const parts = String(t.wbs).split('.');
    for (let i = 1; i < parts.length; i++) visibleSet.add(parts.slice(0, i).join('.'));
    if (t.normalizedWbs) {
      const np = String(t.normalizedWbs).replace(/\(\d+\)$/, '').split('.');
      for (let i = 1; i < np.length; i++) visibleSet.add(np.slice(0, i).join('.'));
    }
  });

  const roots = [];
  for (const nodeKey of Object.keys(treeMap)) {
    const node = treeMap[nodeKey];
    if (!node.parentWbs || node.wbsLevel <= 1) {
      if (visibleSet.has(node.normalizedWbs) || visibleSet.has(node.wbs)) roots.push(node);
    }
  }
  roots.sort((a, b) => {
    const la = String(a.wbs || '').split('.').map(Number);
    const lb = String(b.wbs || '').split('.').map(Number);
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if ((la[i] || 0) !== (lb[i] || 0)) return (la[i] || 0) - (lb[i] || 0);
    }
    return 0;
  });

  function renderNode(node) {
    const nwbs = node.normalizedWbs || node.wbs;
    if (!visibleSet.has(nwbs) && !visibleSet.has(node.wbs)) return null;
    const level = node.wbsLevel || getWbsLevel(node.wbs);
    if (level > maxLevel) return null;
    const hasChildren = node.children && node.children.length > 0;
    const expanded = node._expanded !== false;
    const isMs = node.isMilestone;
    const isHighRisk = node.risk === '高';
    const isSum = node.isSummary;
    const sel = node.nodeKey === selectedNodeKey ? ' selected' : '';
    const indent = Math.max(0, level - 1) * 14;

    return (
      <div key={node.nodeKey}>
        <div className={`tree-node level-${level}${isMs ? ' type-milestone' : ''}${isHighRisk ? ' risk-high' : ''}${isSum ? ' type-summary' : ''}${sel}`}
          style={{ paddingLeft: indent }}
          onClick={(e) => {
            if (e.target.closest('[data-action="toggle"]')) { onToggle(node.nodeKey); }
            else { onSelect(node.nodeKey); }
          }}>
          <span className="toggle-icon" data-action="toggle">
            {hasChildren ? (expanded ? '▼' : '▶') : ' '}
          </span>
          <span className="col-wbs">{node.originalWbs || node.wbs}</span>
          <span className="col-name" title={node.name}>{node.name}</span>
        </div>
        {hasChildren && expanded && node.children.map(child => renderNode(child))}
      </div>
    );
  }

  return (
    <div className="task-tree-panel" id="taskTreePanel"
      onClick={(e) => { if (e.target === e.currentTarget) onSelect(null); }}>
      <div className="tree-header">
        <span className="col-wbs">WBS</span>
        <span className="col-name">任务名称</span>
      </div>
      <div id="taskTree">
        {roots.map(root => renderNode(root))}
      </div>
    </div>
  );
}
