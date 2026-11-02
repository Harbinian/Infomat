import {businessLocation,businessText,userMessage} from "./businessPresentation.js";
import { StatusPanel } from './components.jsx';

const groups = [['technical', '文件内容问题'], ['incomplete', '编制缺项'], ['confirmation', '待确认事项']];
export function ProcessChecks({ checks, allowLocate = true, onLocate, authoringEnabled = false, sourceLookup }) {
  if (!checks) return <StatusPanel title="当前修订检查尚未取得">请刷新重新读取检查结果；不能据此判断材料完整。</StatusPanel>;
  return <section className="card" data-process-checks style={{ overflowWrap: 'anywhere' }}>
    <h3>当前修订检查</h3>
    <p>按当前正文重新检查。编制缺项需要{authoringEnabled ? '在3000从原案例续修，保存并提交新修订后重新核对' : '完成修订后上传原案例'}；待确认事项由业务人员核实，不自动补造数据对象、表单或执行事实。未完成草稿仍可下载。</p>
    {checks.status !== 'ready' && <StatusPanel kind="error" title="业务内容检查未完成">{checks.status === 'not_run' ? '请先处理文件内容问题，再重新检查业务内容。' : '检查服务暂不可用，请联系维护人员。'} 没有检出问题不等于检查通过。</StatusPanel>}
    {sourceLookup && <><p data-check-summary>{groups.map(([key, title]) => `${title}：${checks.counts?.[key] || 0}项`).join('；')}</p>{sourceLookup}<p>完整问题按下方类别展开查阅；各项处理建议可单独展开。</p></>}
    {groups.map(([key, title]) => <details key={key} open={!sourceLookup && Boolean(checks.counts?.[key])} data-check-group={key}>
      <summary>{title}：{checks.counts?.[key] || 0}项</summary>
      {!checks.issues?.some(issue => issue.group === key) && <p>{checks.status === 'ready' ? '本轮未检出此类问题。' : '尚不能形成完整检查结论。'}</p>}
      <ol>{checks.issues?.filter(issue => issue.group === key).map((issue, index) => <li key={index}>
        <strong>{userMessage(issue.category,'需要核对')}：</strong>{userMessage(issue.message,'相关内容需要核对，请查看问题位置。')}
        {issue.blocking === true && <p><strong>须明确并完成修订后，方可继续正式流转。</strong></p>}
        {issue.path && <p>位置：{businessLocation(issue.path)}</p>}
        {allowLocate && issue.behavior_ref && <a href={'#source-' + issue.behavior_ref} onClick={event=>{if(onLocate){event.preventDefault();onLocate(issue.behavior_ref);}}}>查看问题所在环节</a>}
        {!!issue.suggestions?.length && (sourceLookup
          ? <details><summary>查看本项处理建议</summary><p>{issue.suggestions.map(item=>userMessage(item,'请核对相关内容后重新检查。')).join('；')}</p></details>
          : <p>处理建议：{issue.suggestions.map(item=>userMessage(item,'请核对相关内容后重新检查。')).join('；')}</p>)}
      </li>)}</ol>
    </details>)}
  </section>;
}
