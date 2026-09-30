// publishText.js — 生成可复制到信息化工作群的行动项发布文本
//
// 规则依据《信息化项目协同工作规则》：
//   6.1 信息化工作群是正式沟通渠道，PMO 行动台账是正式跟踪记录 ——
//       看板不负责任送达，只产出可粘贴的正式文本 + 归档留痕。
//   6.3 轻量行动台账只记录「事项、责任部门、截止时间、当前状态」四要素，
//       实际执行人由部门内部安排、日常不报 PMO ——
//       因此文本刻意不带等级、风险、WBS、审核人等 PMO 内部字段。
//   6.2 发布后主对接人应在 1 个工作日内回复「已接收」。
//
// 纯函数：时间由调用方注入，便于 smoke 断言。

const REPLY_RULE = '说明：按《信息化项目协同工作规则》6.2，请主对接人在1个工作日内回复“已接收”；完成时在群内回复结果或材料位置。';

function line(label, value) {
  const text = String(value || '').trim();
  return text ? `${label}：${text}` : '';
}

function contactSuffix(department, roster = []) {
  const row = roster.find(item => item.department === department);
  if (!row) return '';
  const parts = [
    row.mainContact ? `主对接人：${row.mainContact}` : '',
    row.backup ? `备岗：${row.backup}` : '',
  ].filter(Boolean);
  return parts.length ? `（${parts.join('｜')}）` : '';
}

/**
 * 单条行动项的发布文本。
 *
 * 完成判定 / 证据要求优先取 action 内的 manual 值；此时为空则回落到绑定任务
 * 只读带入的值（criteriaSource === 'task' 的情形）。
 */
export function buildPublishTextForItem(item, { roster = [], includeContacts = true } = {}) {
  const action = item?.action || {};
  const department = action.assigneeDepartment || '';
  const departmentText = includeContacts
    ? `${department}${contactSuffix(department, roster)}`
    : department;

  return [
    `【行动项发布】${[item?.deliverableId, item?.deliverableName].filter(Boolean).join(' ')}`,
    line('责任部门', departmentText),
    line('截止时间', action.dueDate),
    line('完成判定', action.criteria || item?.completionCriteria),
    line('证据要求', action.evidenceRequirement || item?.evidenceRequirements),
    REPLY_RULE,
  ].filter(Boolean).join('\n');
}

/** 多条行动项的合并发布文本。 */
export function buildPublishText({ items = [], actor = '', date = '', roster = [], includeContacts = true } = {}) {
  const blocks = items.map(item => buildPublishTextForItem(item, { roster, includeContacts }));
  const footer = ['—— PMO', actor, date].filter(Boolean).join(' ');
  return `${blocks.join('\n\n')}\n\n${footer}\n`;
}

/**
 * 周会事项的发布文本。
 *
 * 与交付物行动项同源同格式 —— 两者都发到同一个信息化工作群，措辞必须一致。
 * 差异：事项用 owner 作责任方（自由文本，可能不在部门名册内，此时不附联系人），
 * 用 closeCriteria 代替完成判定。
 */
export function buildPublishTextForIssue(issue, { roster = [], includeContacts = true } = {}) {
  const owner = String(issue?.owner || '').trim();
  const ownerText = includeContacts ? `${owner}${contactSuffix(owner, roster)}` : owner;

  return [
    `【行动项发布】${String(issue?.title || '').trim()}`,
    line('责任方', ownerText),
    line('截止时间', issue?.dueDate),
    line('关闭标准', issue?.closeCriteria),
    REPLY_RULE,
  ].filter(Boolean).join('\n');
}

/** 多条周会事项的合并发布文本。 */
export function buildIssuePublishText({ issues = [], actor = '', date = '', roster = [], includeContacts = true } = {}) {
  const blocks = issues.map(issue => buildPublishTextForIssue(issue, { roster, includeContacts }));
  const footer = ['—— PMO', actor, date].filter(Boolean).join(' ');
  return `${blocks.join('\n\n')}\n\n${footer}\n`;
}

export const PUBLISH_TEXT_REPLY_RULE = REPLY_RULE;
