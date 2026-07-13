// dateUtils.js — 日期解析、WBS 工具、数据规范化、任务树构建

export let PROJECT_START = new Date(2026, 5, 1);
export let PROJECT_END = new Date(2028, 1, 31);

export function computeProjectRange(tasks) {
  const dates = [];
  tasks.forEach(t => {
    const s = parseDate(t.start);
    const f = parseDate(t.finish);
    if (s) dates.push(s);
    if (f) dates.push(f);
  });
  if (!dates.length) return;
  let min = dates[0], max = dates[0];
  for (const d of dates) { if (d < min) min = d; if (d > max) max = d; }
  PROJECT_START = new Date(min.getFullYear(), min.getMonth(), 1);
  const totalMonths = (max.getFullYear() - min.getFullYear()) * 12 + (max.getMonth() - min.getMonth()) + 2;
  const endMonth = min.getMonth() + totalMonths;
  const endYear = min.getFullYear() + Math.floor(endMonth / 12);
  PROJECT_END = new Date(endYear, endMonth % 12, 0);
}

export const WBS_COLORS = {
  '1': '#b25638', '2': '#c97050', '3': '#9a7a30', '4': '#6f7d4e', '5': '#4a6b7e',
  '6': '#7e8e5b', '7': '#8f6d4d', '8': '#b88919', '9': '#9a8e7c', '10': '#5d7180'
};

export function getWbsColor(wbs) {
  const top = String(wbs).split('.')[0];
  return WBS_COLORS[top] || '#7a6a56';
}

export function getWbsLevel(wbs) {
  if (!wbs) return 1;
  return String(wbs).split('.').length;
}

export function getTopWbs(wbs) {
  return String(wbs).split('.')[0];
}

export function parseDate(str) {
  if (!str || str.trim() === '') return null;
  str = str.trim();
  let m = str.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  m = str.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}

export function formatDate(date) {
  if (!date) return '日期未设置';
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getPmoDeliveryWeekRange(date) {
  const current = date instanceof Date && !Number.isNaN(date.getTime()) ? new Date(date) : new Date();
  const daysSinceThursday = (current.getDay() + 3) % 7;
  const start = new Date(current);
  start.setDate(current.getDate() - daysSinceThursday);
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

export function getTotalMonths() {
  return (PROJECT_END.getFullYear() - PROJECT_START.getFullYear()) * 12
    + (PROJECT_END.getMonth() - PROJECT_START.getMonth()) + 1;
}

export function getMonthLabels() {
  const labels = [];
  let d = new Date(PROJECT_START);
  const total = getTotalMonths();
  for (let i = 0; i < total; i++) {
    labels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    d.setMonth(d.getMonth() + 1);
  }
  return labels;
}

export function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate(); }

export function getXForDate(date, monthWidth) {
  if (!date) return -1;
  const months = (date.getFullYear() - PROJECT_START.getFullYear()) * 12
    + (date.getMonth() - PROJECT_START.getMonth());
  const dayFrac = (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());
  return months * monthWidth + dayFrac * monthWidth;
}

export function unique(arr) { return [...new Set(arr)]; }

// ===== WBS 数字段排序 =====
export function compareWbs(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const va = pa[i] ?? -1;
    const vb = pb[i] ?? -1;
    if (va !== vb) return va - vb;
  }
  return 0;
}

// ===== 任务类型排序权重 =====
function getTaskSortWeight(task) {
  const typeMap = { '摘要':0, '启动':1, '调研':2, '需求':3, '设计':4, '开发准备':5, '开发':6, '配置':7, '联调':8, '测试':9, '培训':10, '上线':11, '验收':12, '里程碑':13, '方案评审':14, '招采':15, '合同':16, '进场':17, '管理':18, '修订':19, '评审':20, '缓冲':21, '整改':22, '修复':23, '推广':24, '试点':25, '试运行':26, '部署':27, '驾驶舱':28, 'AI应用':29 };
  const completionPattern = /(上线|验收|发布|就绪|完成|评审通过)/;
  if (task.milestone === '是' || isZeroWorkdayDuration(task.duration)) return 100;
  const nameWeight = completionPattern.test(task.name) ? 50 : 0;
  return (typeMap[task.type] ?? 30) + nameWeight;
}

// ===== 摘要判定 =====
function isSummaryTask(task, allTasks) {
  if (task.type === '摘要') return true;
  const wbs = String(task.wbs);
  return allTasks.some(t => { const tw = String(t.wbs); return tw !== wbs && tw.startsWith(wbs + '.'); });
}

// ===== 里程碑判定 =====
export function isZeroWorkdayDuration(duration) {
  return /^0\s*工作日$/.test(String(duration || '').trim());
}

export function isMilestoneTask(task) {
  if (task.milestone === '是') return true;
  if (task.type === '里程碑') return true;
  if (isZeroWorkdayDuration(task.duration)) return true;
  return /(上线|验收$|发布|就绪|完成|评审通过$|正式进场)/.test(task.name);
}

// ===== 数据诊断 =====
export function analyzeTasks(tasks) {
  if (!import.meta.env.DEV) return;
  console.group('%c📊 甘特图数据诊断报告', 'font-weight:bold;font-size:14px;');

  const wbsMap = {};
  tasks.forEach(t => { const w = t.wbs; if (!wbsMap[w]) wbsMap[w] = []; wbsMap[w].push(t); });
  const dupes = Object.entries(wbsMap).filter(([, v]) => v.length > 1).sort(([a], [b]) => compareWbs(a, b));
  if (dupes.length) {
    console.group(`%c⚠ 重复 WBS：${dupes.length} 组`, 'color:#e74c3c;');
    dupes.forEach(([wbs, arr]) => { console.group(`WBS="${wbs}" (${arr.length} 次)`); arr.forEach(t => console.log(`  ID=${t.id} "${t.name}" type=${t.type} start=${t.start}`)); console.groupEnd(); });
    console.groupEnd();
  } else { console.log('%c✓ 无重复 WBS', 'color:#27ae60;'); }

  const sortedWbs = [...new Set(tasks.map(t => t.wbs))].sort();
  const numericSorted = [...new Set(tasks.map(t => t.wbs))].sort(compareWbs);
  const stringIssues = sortedWbs.filter((w, i) => w !== numericSorted[i]);
  if (stringIssues.length) {
    console.group(`%c⚠ WBS 字符串排序异常：${stringIssues.length} 处`, 'color:#e67e22;');
    stringIssues.slice(0, 10).forEach(w => { const idx = sortedWbs.indexOf(w); console.log(`  字符串序="${w}" → 数字序应为="${numericSorted[idx]}"`); });
    console.groupEnd();
  }

  const msWithChildren = tasks.filter(t => { const ms = isMilestoneTask(t); return ms && tasks.some(c => String(c.wbs).startsWith(String(t.wbs) + '.')); });
  if (msWithChildren.length) {
    console.group(`%c⚠ 里程碑占用父级编号：${msWithChildren.length} 个`, 'color:#e67e22;');
    msWithChildren.forEach(t => console.log(`  WBS=${t.wbs} "${t.name}" (type=${t.type}) 下有子任务`));
    console.groupEnd();
  }

  const allWbs = new Set(tasks.map(t => t.wbs));
  const orphans = tasks.filter(t => { const p = String(t.wbs).split('.'); return p.length > 1 && !allWbs.has(p.slice(0,-1).join('.')); });
  if (orphans.length) {
    console.group(`%c⚠ 缺少父节点：${orphans.length} 个`, 'color:#e67e22;');
    orphans.slice(0, 10).forEach(t => console.log(`  WBS=${t.wbs} "${t.name}" 缺少父节点 WBS=${String(t.wbs).split('.').slice(0,-1).join('.')}`));
    console.groupEnd();
  }

  const idSet = new Set(tasks.map(t => t.id));
  const backRefs = [];
  tasks.forEach(t => { if (!t.predecessors) return; String(t.predecessors).split(',').forEach(p => { const pid = parseInt(p.trim()); if (pid && idSet.has(pid) && pid > t.id) backRefs.push({ id: t.id, name: t.name, pred: pid }); }); });
  if (backRefs.length) {
    console.group(`%cℹ 后向前置引用：${backRefs.length} 处（需人工确认）`, 'color:#f39c12;');
    backRefs.slice(0, 10).forEach(b => console.log(`  ID=${b.id} "${b.name}" → 前置 ID=${b.pred} (后向)`));
    console.groupEnd();
  }
  console.groupEnd();
}

// ===== 数据规范化 =====
export function normalizeTasks(rawTasks) {
  const sorted = [...rawTasks].sort((a, b) => {
    const wbsCmp = compareWbs(a.wbs, b.wbs);
    if (wbsCmp !== 0) return wbsCmp;
    const wa = getTaskSortWeight(a), wb = getTaskSortWeight(b);
    if (wa !== wb) return wa - wb;
    return a.id - b.id;
  });

  const wbsSeen = {}, dupeWbs = new Set();
  sorted.forEach(t => { const w = t.wbs; if (wbsSeen[w]) dupeWbs.add(w); wbsSeen[w] = (wbsSeen[w] || 0) + 1; });

  const wbsCounter = {};
  const normalized = sorted.map((t, idx) => {
    const wbs = String(t.wbs);
    const level = wbs.split('.').length;
    const parentWbs = level > 1 ? wbs.split('.').slice(0, -1).join('.') : '';
    const isMs = isMilestoneTask(t);
    const isSum = isSummaryTask(t, rawTasks);
    let displayWbs = wbs;
    if (dupeWbs.has(wbs)) { const cnt = (wbsCounter[wbs] || 0) + 1; wbsCounter[wbs] = cnt; if (cnt > 1) displayWbs = `${wbs}(${cnt})`; }
    else { wbsCounter[wbs] = 1; }
    return { ...t, displayIndex: idx, normalizedWbs: displayWbs, wbsLevel: level, parentWbs, isSummary: isSum, isMilestone: isMs, nodeKey: `${displayWbs}__${t.id}`, originalWbs: t.wbs, originalId: t.id };
  });

  const allNormWbs = new Set(normalized.map(t => t.normalizedWbs));
  const virtualParents = [];
  normalized.forEach(t => {
    if (!t.parentWbs) return;
    const pw = t.parentWbs;
    if (!allNormWbs.has(pw) && !virtualParents.find(v => v.normalizedWbs === pw)) {
      virtualParents.push({
        id: -1000 - virtualParents.length, wbs: pw, normalizedWbs: pw, originalWbs: pw, originalId: null,
        name: '(缺失的父模块)', type: '摘要', duration: '', start: '', finish: '', predecessors: '',
        resources: '', department: '', vendor: '', reviewer: '', risk: '', milestone: '否', deliverable: '', notes: '',
        displayIndex: normalized.length + virtualParents.length, wbsLevel: pw.split('.').length,
        parentWbs: pw.includes('.') ? pw.split('.').slice(0, -1).join('.') : '', isSummary: true, isMilestone: false,
        nodeKey: `${pw}__virtual`,
      });
    }
  });

  return [...normalized, ...virtualParents].sort((a, b) => a.displayIndex - b.displayIndex);
}

// ===== 任务树构建（使用规范化数据） =====
export function buildTaskTree(tasks) {
  const map = {};
  const roots = [];
  tasks.forEach(t => { map[t.nodeKey] = { ...t, children: [], _visible: true, _expanded: true }; });
  tasks.forEach(t => {
    const node = map[t.nodeKey];
    if (!node) return;
    if (!t.parentWbs || t.wbsLevel <= 1) { roots.push(node); }
    else {
      const parent = tasks.find(p => p.normalizedWbs === t.parentWbs || p.wbs === t.parentWbs);
      if (parent && map[parent.nodeKey]) { map[parent.nodeKey].children.push(node); }
      else { roots.push(node); }
    }
  });
  function sortChildren(nodes) {
    nodes.sort((a, b) => { const c = compareWbs(a.wbs, b.wbs); return c !== 0 ? c : getTaskSortWeight(a) - getTaskSortWeight(b); });
    nodes.forEach(n => { if (n.children && n.children.length) sortChildren(n.children); });
  }
  sortChildren(roots);
  roots.forEach(r => { if (r.children && r.children.length) sortChildren(r.children); });
  function walk(nodes) { nodes.forEach(n => { if (n.wbsLevel >= 3) n._expanded = false; walk(n.children); }); }
  walk(roots);
  return { roots, map };
}

// 根据 WBS 收起/展开状态过滤任务 — 让甘特图进度条与左侧任务树联动
export function filterTasksByExpansion(tasks, treeMap) {
  if (!tasks || !tasks.length) return tasks || [];
  if (!treeMap) return tasks;
  const nodeByWbs = new Map();
  Object.values(treeMap).forEach(node => {
    if (node.wbs) nodeByWbs.set(String(node.wbs), node);
    if (node.normalizedWbs) nodeByWbs.set(String(node.normalizedWbs), node);
  });
  return tasks.filter(task => {
    let parentWbs = task.parentWbs;
    while (parentWbs) {
      const parent = nodeByWbs.get(String(parentWbs));
      if (!parent) break;
      if (parent._expanded === false) return false;
      parentWbs = parent.parentWbs;
    }
    return true;
  });
}

// ===== 筛选 =====
export function applyFilters(allTasks, filters, view) {
  let tasks = [...allTasks];
  if (filters.year !== 'all') {
    const yr = parseInt(filters.year);
    tasks = tasks.filter(t => { const s = parseDate(t.start), f = parseDate(t.finish); if (!s && !f) return false; return (s && s.getFullYear() === yr) || (f && f.getFullYear() === yr); });
  }
  if (view === 'overview') { tasks = tasks.filter(t => { const lvl = t.wbsLevel || getWbsLevel(t.wbs); return lvl <= 2 || t.isMilestone; }); }
  else if (view === 'milestones') { tasks = tasks.filter(t => t.isMilestone); }
  else if (view === 'highrisk') { tasks = tasks.filter(t => t.risk === '高'); }
  if (filters.wbsDepth && filters.wbsDepth !== 'all') {
    const maxLevel = parseInt(filters.wbsDepth, 10);
    if (Number.isFinite(maxLevel)) {
      tasks = tasks.filter(t => {
        const lvl = t.wbsLevel || getWbsLevel(t.wbs);
        return lvl <= maxLevel;
      });
    }
  }
  if (filters.mainline !== 'all') tasks = tasks.filter(t => getTopWbs(t.wbs) === filters.mainline);
  if (filters.department !== 'all') tasks = tasks.filter(t => t.department === filters.department);
  if (filters.vendor !== 'all') tasks = tasks.filter(t => t.vendor === filters.vendor);
  if (filters.risk !== 'all') tasks = tasks.filter(t => t.risk === filters.risk);
  if (filters.type !== 'all') tasks = tasks.filter(t => t.type === filters.type);
  if (filters.taskKind === 'normal') tasks = tasks.filter(t => !t.isSummary && !t.isMilestone);
  else if (filters.taskKind === 'summary') tasks = tasks.filter(t => t.isSummary);
  if (filters.milestone === 'yes') tasks = tasks.filter(t => t.isMilestone);
  if (filters.search.trim()) { const kw = filters.search.trim().toLowerCase(); tasks = tasks.filter(t => t.name.toLowerCase().includes(kw) || t.wbs.includes(kw)); }
  return tasks;
}
