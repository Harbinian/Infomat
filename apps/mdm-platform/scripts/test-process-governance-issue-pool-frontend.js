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
  '今天没有需要你处理的问题',
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
  '需要补充依据',
  '建议修订',
  '请再确认',
  '存在不同意见',
  '术语统一',
  '可能有标准术语',
  '保留原表达，并说明原因',
  '提交 MDM 工作组裁决',
  '术语裁决结果将进入术语真源',
  '处理结论',
  '处理说明',
  '提交确认',
  'data-issue-point-submit',
  '/api/process-governance/issue-pool/points/',
  '/confirm',
  '请选择处理结论',
  '确认结果已提交'
].forEach(needle => assert.ok(html.includes(needle), `missing issue pool frontend hook ${needle}`));

assert.ok(!html.includes('mapping todo'), 'frontend should not expose mapping todo wording');
assert.ok(!html.includes('quality case'), 'frontend should not expose quality case wording');
['驳回', '错误', '不合格', '无效'].forEach(label => {
  assert.ok(!issuePoolSnippet.includes(label), `avoid harsh workflow wording ${label}`);
});

console.log('Process governance issue pool frontend hook test passed');
