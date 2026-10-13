import { StatusPanel } from './components.jsx';

const groups = [['technical', '技术错误'], ['incomplete', '编制缺项'], ['confirmation', '待确认事项']];
export function ProcessChecks({ checks, allowLocate = true }) {
  if (!checks) return <StatusPanel title="当前修订检查尚未取得">请刷新重新读取检查结果；不能据此判断材料完整。</StatusPanel>;
  return <section className="card" data-process-checks style={{ overflowWrap: 'anywhere' }}>
    <h3>当前修订检查</h3>
    <p>按当前正文重新检查。编制缺项需要回3001修订；待确认事项由业务人员核实，不自动补造数据对象、表单或执行事实。未完成草稿仍可下载。</p>
    {checks.status !== 'ready' && <StatusPanel kind="error" title="业务内容检查未完成">{checks.status === 'not_run' ? '请先处理技术错误，再重新检查业务内容。' : '检查服务暂不可用，请联系维护人员。'} 没有检出问题不等于检查通过。</StatusPanel>}
    {groups.map(([key, title]) => <details key={key} open={Boolean(checks.counts?.[key])} data-check-group={key}>
      <summary>{title}：{checks.counts?.[key] || 0}项</summary>
      {!checks.issues?.some(issue => issue.group === key) && <p>{checks.status === 'ready' ? '本轮未检出此类问题。' : '尚不能形成完整检查结论。'}</p>}
      <ol>{checks.issues?.filter(issue => issue.group === key).map((issue, index) => <li key={index}>
        <strong>{issue.category}：</strong>{issue.message}
        {issue.path && <p>位置：<code>{issue.path}</code></p>}
        {allowLocate && issue.behavior_ref && <a href={'#source-' + issue.behavior_ref}>定位当前修订节点</a>}
        {!!issue.suggestions?.length && <p>处理建议：{issue.suggestions.join('；')}</p>}
      </li>)}</ol>
    </details>)}
  </section>;
}
