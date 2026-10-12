import React from 'react';
import { Alert, Button, Empty, Tag } from 'antd';
import { CHECK_GROUPS } from './checks.mjs';
import { messageForUser } from './model.mjs';

export default function CheckResults({ document, checks, onLocate }) {
  return <>
    <Alert title={checks?.stale ? '检查结果已过期，请重新检查' : '已检查当前编制内容'}
      description="技术错误、编制缺项和待确认事项分别列出。检查不表示业务审核通过，仍可下载未完成草稿。"
      type="info" showIcon />
    {checks?.contentStatus === 'unavailable' && <Alert className="content-check-status" title="业务内容检查未完成" type="warning" showIcon />}
    <div className="issue-list">{CHECK_GROUPS.map(group => {
      const issues = (checks?.issues || []).filter(issue => issue.group === group.key);
      return <section className="check-group" data-check-group={group.key} key={group.key} aria-label={group.label}>
        <h3>{group.label} · {issues.length} 项</h3><p className="helper">{group.description}</p>
        {issues.map((issue, index) => <div className="issue-item" key={issue.queueKey || issue.id || index}>
          <Tag color={group.color}>{issue.category || group.label}</Tag>
          <p>{messageForUser(document, issue.message || issue.error)}</p>
          {issue.suggestions?.length > 0 && <ul className="issue-suggestions">{issue.suggestions.map((suggestion, i) => <li key={i}>{messageForUser(document, suggestion)}</li>)}</ul>}
          {(issue.target || issue.navigation) && <Button disabled={checks?.stale} onClick={() => onLocate(issue)}>{issue.target ? '定位此问题' : '查看对应内容'}</Button>}
        </div>)}
        {!issues.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={checks?.stale ? '请检查当前内容后查看结果。' : `本轮未发现${group.label}。`} />}
      </section>;
    })}</div>
  </>;
}
