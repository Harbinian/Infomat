import React from 'react';
export function HandoffChecks({detail}) {
  const checks=detail.relationship_checks;
  if(!checks)return null;
  const links=()=> <p><a href="#handoff-fixed-ends">两端流程与对象</a> · <a href="#handoff-fixed-fields">两端字段与版次</a> · <a href="#handoff-fixed-evidence">两端证据</a></p>;
  return <section aria-label="关系检查结果"><h3>关系检查结果</h3><p>本结果检查当前所示固定交接版本；未形成正式问题或主数据认定。页面检查不创建分析运行。</p>
    {[["definite_defect","确定缺陷"],["business_question","待业务核对"]].map(([type,title])=><div key={type}><h4>{title}</h4>{checks.rows.filter(r=>r.finding_type===type).length?checks.rows.filter(r=>r.finding_type===type).map((r,i)=><div key={i}><p>{r.message}</p>{links()}</div>):<p>本轮未检出此类结果，不表示业务验收通过。</p>}</div>)}
    <h4>本轮未覆盖范围</h4><ul>{checks.uncovered.map((r,i)=><li key={i}>{r.reason}</li>)}</ul>{links()}
    <p>已登记连接：{detail.source?.process_name||'来源待补'} → {detail.target?.process_name||'目标待补'}。多个接收方可以分别登记合法关系，不按名称或连接数量判错。</p>
  </section>;
}
