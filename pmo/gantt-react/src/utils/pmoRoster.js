// pmoRoster.js — PMO 责任部门名册与期限调整同意人
//
// 真源：
//   pmo/信息化项目_部门主备对接人名单.md  —— 部门 / 部门负责人 / 主对接人 / 备岗人员
//   pmo/信息化项目_协同工作规则.md §8.1   —— 期限调整同意人
//
// 本模块只做纯解析与派生，不读文件。服务端 GET /roster 读取 Markdown 后调用
// parseRosterMarkdown；浏览器端消费接口结果。两侧共用同一实现，避免口径分叉。

/**
 * 期限调整同意人（《信息化项目协同工作规则》8.1）。
 *
 * 普通行动项的优先级或期限调整由刘春含同意；
 * 跨部门冲突、阶段门、项目基线或重大资源调整由马成文或李洪哲同意。
 * smoke 断言这些姓名出现在协同工作规则正文中，防止硬编码漂移。
 */
export const APPROVERS = {
  normal: ['刘春含'],
  gate: ['马成文', '李洪哲'],
};

const ROSTER_REQUIRED_COLUMNS = ['部门', '主对接人'];
const DIVIDER_RE = /^:?-{2,}:?$/u;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/u;

/**
 * 解析《信息化项目部门主备对接人名单》的 Markdown 表格。
 *
 * 只认包含「部门」和「主对接人」表头的表格，避免误吞文档中的其它表格。
 * 主对接人与备岗允许为空 —— 名册当前状态为「待项目决策组确认」，多数备岗尚未填写。
 */
export function parseRosterMarkdown(markdown) {
  const rows = [];
  let header = null;

  for (const line of String(markdown || '').split(/\r?\n/u)) {
    if (!line.trim().startsWith('|')) {
      header = null;
      continue;
    }
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (!cells.length) continue;
    if (cells.every(cell => DIVIDER_RE.test(cell))) continue;

    if (!header) {
      header = cells;
      continue;
    }
    if (!ROSTER_REQUIRED_COLUMNS.every(column => header.includes(column))) continue;

    const row = Object.fromEntries(header.map((column, index) => [column, cells[index] || '']));
    if (!row['部门']) continue;

    rows.push({
      department: row['部门'],
      lead: row['部门负责人'] || '',
      mainContact: row['主对接人'] || '',
      backup: row['备岗人员'] || '',
    });
  }

  return rows;
}

/** 从名册行提取可选责任部门列表。 */
export function rosterDepartments(rows = []) {
  return rows.map(row => row.department).filter(Boolean);
}

/**
 * 从某个 ISO 日期起顺延若干个工作日。
 *
 * 已知近似：只跳过周末，没有节假日日历。规则 6.2 的「1 个工作日」在跨节假日时
 * 会偏早，需要在 UI 与文档中明示，由 PMO 按实际日历复核。
 */
export function addWorkingDays(isoDay, days = 1) {
  const match = ISO_DAY.exec(String(isoDay || ''));
  if (!match) return '';
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  let remaining = Math.max(0, Number(days) || 0);

  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }

  return date.toISOString().slice(0, 10);
}
