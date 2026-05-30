import { getWbsLevel } from '../utils/dateUtils';

export default function TaskTree({ tasks, treeMap, selectedWbs, onSelect, onToggle }) {
  // 收集可见 WBS 及其祖先
  const visibleSet = new Set(tasks.map(t => t.wbs));
  tasks.forEach(t => {
    const parts = String(t.wbs).split('.');
    for (let i = 1; i < parts.length; i++) {
      visibleSet.add(parts.slice(0, i).join('.'));
    }
  });

  // 从 treeMap 中找顶层节点（roots 需要在 App 中维护）
  const roots = [];
  for (const wbs of visibleSet) {
    const parts = String(wbs).split('.');
    if (parts.length === 1 && treeMap[wbs]) {
      roots.push(treeMap[wbs]);
    }
  }
  roots.sort((a, b) => {
    const la = String(a.wbs).split('.').map(Number);
    const lb = String(b.wbs).split('.').map(Number);
    for (let i = 0; i < Math.max(la.length, lb.length); i++) {
      if ((la[i] || 0) !== (lb[i] || 0)) return (la[i] || 0) - (lb[i] || 0);
    }
    return 0;
  });

  function renderNode(node) {
    if (!visibleSet.has(node.wbs)) return null;
    const level = getWbsLevel(node.wbs);
    const hasChildren = node.children && node.children.length > 0;
    const expanded = node._expanded !== false;
    const isMilestone = node.milestone === '是' || node.duration === '0工作日';
    const isHighRisk = node.risk === '高';
    const sel = node.wbs === selectedWbs ? ' selected' : '';
    const indent = Math.max(0, level - 1) * 14;

    return (
      <div key={node.wbs}>
        <div className={`tree-node level-${level}${isMilestone ? ' type-milestone' : ''}${isHighRisk ? ' risk-high' : ''}${sel}`}
          style={{ paddingLeft: indent }}
          onClick={(e) => {
            if (e.target.closest('[data-action="toggle"]')) {
              onToggle(node.wbs);
            } else {
              onSelect(node.wbs);
            }
          }}>
          <span className="toggle-icon" data-action="toggle">
            {hasChildren ? (expanded ? '▼' : '▶') : ' '}
          </span>
          <span className="col-wbs">{node.wbs}</span>
          <span className="col-name" title={node.name}>{node.name}</span>
        </div>
        {hasChildren && expanded && node.children.map(child => renderNode(child))}
      </div>
    );
  }

  return (
    <div className="task-tree-panel" id="taskTreePanel">
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
