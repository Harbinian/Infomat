const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const issuePoolStart = html.indexOf('function loadProcessGovernanceIssueQueues');
const issuePoolEnd = html.indexOf('async function loadProcessGovernanceInputBaselineReview');
const issuePoolSnippet = issuePoolStart >= 0 && issuePoolEnd > issuePoolStart
  ? html.slice(issuePoolStart, issuePoolEnd)
  : '';

[
  'function loadProcessGovernanceIssueQueues',
  'function loadProcessGovernanceIssueList',
  'function renderProcessGovernanceIssueQueues',
  'function renderProcessGovernanceIssueDetail',
  '/api/process-governance/issue-pool/queues',
  '/api/process-governance/issue-pool/issues',
  '需要我确认',
  '需要我审核',
  '需要我协同',
  '等待别人',
  '待最终裁决',
  '已完成',
  '已提交，待审核',
  '等待协同',
  '等待裁决',
  '今天没有需要你处理的问题',
  '本队列已处理完',
  '数据正在准备，请稍后查看',
  '数据准备失败，请联系流程治理负责人',
  '业务行为',
  '这是什么问题',
  '为什么要你确认',
  '在哪发现',
  '谁负责处理',
  '什么时候处理',
  '怎么处理',
  '影响多大',
  '残留问题',
  '源文件编号',
  '制度或表单名称',
  'function issueSourcePositionDisplay',
  'function issueSourcePositionFallback',
  '来源依据不足：未标注可核对段落号',
  '源文件编号',
  '制度或表单名称',
  '大概位置',
  "facts['业务流程']",
  "facts['业务行为']",
  'pg-issue-stepper',
  'pg-issue-next-action',
  'pg-issue-achievement',
  'pg-issue-card--actionable',
  'pg-issue-card--submitted',
  'pg-issue-card--waiting',
  'pg-issue-card--done',
  'pg-issue-point-readonly',
  'pg-issue-side-nav',
  'pg-issue-side-nav-rail',
  '.pg-issue-side-nav.is-floating',
  'function syncIssueSideNavPosition',
  'function setupIssueSideNavScroll',
  'data-issue-nav-rail',
  'function renderIssueFactLines',
  'function renderIssueSourceCard',
  'function renderIssueDecisionCards',
  'function renderIssueHandlingControls',
  'function renderIssueReasonCards',
  'function renderIssuePointReadonly',
  'function renderIssueTermsNotice',
  '确认业务行为',
  '回到制度或表单源文件查看',
  '修改制度或表单源文件后重新导入',
  '这条核验项不是问题',
  '结论——含义',
  '处理结论',
  '处理方式',
  '问题原因',
  '怎么区分',
  '当前问题卡缺少来源证据',
  '制度或表单原文没写清',
  '只用于说明为什么这条核验项不是问题',
  '制度或表单原文',
  '缺少制度或表单原文摘录，本问题不能确认。',
  'function renderIssueOriginalEvidence',
  'function renderIssueDocumentStructureCard',
  '结构化字段确认',
  '结构化对象',
  '待确认字段',
  '当前值',
  '请你确认',
  'evidence.document_structure',
  '制度或表单原文已经写清楚',
  '这不是受控传递事项',
  '不属于本部门处理范围',
  '不会影响这个业务行为',
  '已被其他问题或来源覆盖',
  '处理历史',
  '提交确认',
  '提交复核',
  '提交协同意见',
  '提交工作室意见',
  '提交 MDM 裁决',
  '查看处理记录',
  '继续确认下一条',
  '查看需要我审核',
  '这一步已经提交，处理记录在下方',
  'data-issue-point-reason',
  'data-issue-point-submit',
  'data-issue-point-action',
  'data-issue-comment-submit',
  'data-issue-close',
  'data-issue-reopen',
  'data-issue-term-create',
  'data-issue-term-answer',
  'data-issue-term-decision',
  'function issuePointActionForStatus',
  'function issueDisplayStatus',
  'function issueCardClassName',
  'function issueSortWeight',
  'function sortProcessGovernanceIssuesForDisplay',
  'function processGovernanceFirstActionableIssue',
  'function issuePrimaryActionLabel',
  'function renderIssueAchievementBanner',
  'function submitIssuePointAction',
  'function submitIssueComment',
  'function closeOrReopenIssue',
  'function createIssueTermTask',
  'function answerIssueTermTask',
  'function decideIssueTermTask',
  '/api/process-governance/issue-pool/points/',
  '/confirm',
  '/review',
  '/collaborate',
  '/studio-review',
  '/mdm-decision',
  '/api/process-governance/issue-pool/issues/',
  '/comment',
  '/close',
  '/reopen',
  '/api/process-governance/issue-pool/term-tasks',
  '/answer',
  '/decision',
  '请选择处理结论',
  '已提交，进入部门审核'
].forEach(needle => assert.ok(html.includes(needle), `missing issue pool frontend hook ${needle}`));

assert.ok(
  issuePoolSnippet.includes("window.addEventListener('scroll', scheduleSync") &&
  issuePoolSnippet.includes("window.addEventListener('resize', scheduleSync"),
  'issue card side navigation should track scroll and resize'
);
assert.ok(issuePoolSnippet.includes("requestAnimationFrame(function()"), 'issue card side navigation should throttle scroll updates');
const priorityIssueStart = issuePoolSnippet.indexOf('function renderProcessGovernancePriorityIssue');
const priorityIssueEnd = issuePoolSnippet.indexOf('function updateProcessGovernanceTaskEntries', priorityIssueStart);
const priorityIssueSnippet = priorityIssueStart >= 0 && priorityIssueEnd > priorityIssueStart
  ? issuePoolSnippet.slice(priorityIssueStart, priorityIssueEnd)
  : '';
assert.ok(
  priorityIssueSnippet.includes('processGovernanceFirstActionableIssue(data)'),
  'priority issue should use the first actionable issue, not submitted or completed cards'
);
assert.ok(
  issuePoolSnippet.includes('sortProcessGovernanceIssuesForDisplay(items)'),
  'issue list should sort submitted and completed cards behind actionable work'
);
assert.ok(
  issuePoolSnippet.includes('renderIssuePoints(detail.points || [], issue)'),
  'issue detail should pass issue status into point rendering'
);
assert.ok(
  issuePoolSnippet.includes("var issueStatus = String(issue && issue.display_status || '')") &&
  issuePoolSnippet.includes("issueStatus !== 'waiting_my_action'"),
  'submitted or waiting issue details should render points as read-only instead of repeat action forms'
);
assert.ok(
  !issuePoolSnippet.includes("showToast('确认结果已提交')"),
  'confirmation success should use closed-loop wording instead of the old generic toast'
);

assert.ok(!html.includes('mapping todo'), 'frontend should not expose mapping todo wording');
assert.ok(!html.includes('quality case'), 'frontend should not expose quality case wording');
assert.ok(!issuePoolSnippet.includes('相关原文段落'), 'issue card should not hide missing evidence behind vague related-paragraph wording');
[
  '需要补充依据',
  '建议修订',
  '请再确认',
  '存在不同意见',
  '<textarea rows="2" data-issue-point-note',
  '固定原因',
  '需要补证据',
  '制度未写清',
  '段落或位置待补',
  '制度或表单源文件待补',
  '需要补充制度、表单、条款或页码',
  '回源',
  '原输出目标部门'
].forEach(label => {
  assert.ok(!issuePoolSnippet.includes(label), `issue card should not expose legacy wording/control ${label}`);
});
['驳回', '错误', '不合格', '无效'].forEach(label => {
  assert.ok(!issuePoolSnippet.includes(label), `avoid harsh workflow wording ${label}`);
});

console.log('Process governance issue pool frontend hook test passed');
