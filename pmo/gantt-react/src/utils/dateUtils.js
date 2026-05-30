// dateUtils.js — 日期解析、WBS 工具、任务树构建

export const PROJECT_START = new Date(2026, 5, 1);
export const PROJECT_END = new Date(2028, 1, 31);

export const WBS_COLORS = {
  '1': '#4A90D9', '2': '#5C8AD8', '3': '#00BCD4', '4': '#9C27B0', '5': '#607D8B',
  '6': '#4CAF50', '7': '#E91E63', '8': '#FF9800', '9': '#795548', '10': '#7C4DFF'
};

export function getWbsColor(wbs) {
  const top = String(wbs).split('.')[0];
  return WBS_COLORS[top] || '#6b7194';
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

export function daysInMonth(y, m) {
  return new Date(y, m + 1, 0).getDate();
}

export function getXForDate(date, monthWidth) {
  if (!date) return -1;
  const months = (date.getFullYear() - PROJECT_START.getFullYear()) * 12
    + (date.getMonth() - PROJECT_START.getMonth());
  const dayFrac = (date.getDate() - 1) / daysInMonth(date.getFullYear(), date.getMonth());
  return months * monthWidth + dayFrac * monthWidth;
}

export function unique(arr) { return [...new Set(arr)]; }

export function buildTaskTree(tasks) {
  const map = {};
  const roots = [];
  tasks.forEach(t => { map[t.wbs] = { ...t, children: [], _expanded: true }; });
  tasks.forEach(t => {
    const node = map[t.wbs];
    const parts = String(t.wbs).split('.');
    if (parts.length <= 1) {
      roots.push(node);
    } else {
      const parentWbs = parts.slice(0, -1).join('.');
      const parent = map[parentWbs];
      if (parent) parent.children.push(node);
      else roots.push(node);
    }
  });
  function walk(nodes) {
    nodes.forEach(n => {
      if (getWbsLevel(n.wbs) >= 3) n._expanded = false;
      walk(n.children);
    });
  }
  walk(roots);
  return { roots, map };
}

export function applyFilters(allTasks, filters, view) {
  let tasks = [...allTasks];

  if (filters.year !== 'all') {
    const yr = parseInt(filters.year);
    tasks = tasks.filter(t => {
      const s = parseDate(t.start);
      const f = parseDate(t.finish);
      if (!s && !f) return false;
      return (s && s.getFullYear() === yr) || (f && f.getFullYear() === yr);
    });
  }

  if (view === 'overview') {
    tasks = tasks.filter(t => {
      const lvl = getWbsLevel(t.wbs);
      return lvl <= 2 || t.milestone === '是' || t.duration === '0工作日';
    });
  } else if (view === 'milestones') {
    tasks = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  } else if (view === 'highrisk') {
    tasks = tasks.filter(t => t.risk === '高');
  }

  if (filters.mainline !== 'all') tasks = tasks.filter(t => getTopWbs(t.wbs) === filters.mainline);
  if (filters.department !== 'all') tasks = tasks.filter(t => t.department === filters.department);
  if (filters.vendor !== 'all') tasks = tasks.filter(t => t.vendor === filters.vendor);
  if (filters.risk !== 'all') tasks = tasks.filter(t => t.risk === filters.risk);
  if (filters.type !== 'all') tasks = tasks.filter(t => t.type === filters.type);
  if (filters.milestone === 'yes') tasks = tasks.filter(t => t.milestone === '是' || t.duration === '0工作日');
  if (filters.search.trim()) {
    const kw = filters.search.trim().toLowerCase();
    tasks = tasks.filter(t => t.name.toLowerCase().includes(kw) || t.wbs.includes(kw));
  }

  return tasks;
}
