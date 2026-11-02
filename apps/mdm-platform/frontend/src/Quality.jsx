import {businessText,userMessage} from "./businessPresentation.js";
import {qualityProgress} from './qualityProgressModel.js';
import { qualityEntryNotice } from './rolePresentation.js';
import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './identity-directory.css';

// One explicit scoped read; current governance and legacy confirmation are not interchangeable.
export function Quality({ api, onNavigate }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ busy: true });
    api.request('/api/quality/field-identities/progress?view=current', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ data:qualityProgress(data) }); })
      .catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, revision]);
  const data = state.data;
  return <div className="identity-module" data-quality-state={state.busy ? 'loading' : state.error ? 'error' : 'ready'}>
    <section className="card">
      <div className="section-heading"><h1>数据质量</h1><button className="secondary" onClick={() => setRevision(value => value + 1)}>刷新字段统计</button></div>
      <p>查看当前身份可见的字段治理统计。现行受控台账、已登记的旧资料和历史身份确认记录分别说明，数量不代表数据值质量合格。</p>
      <p>数据质量审计人可点击“刷新字段统计”，核对当前查阅范围内的字段治理数量；结果显示在下方统计区。需要核对已发布的字段定义时，可进入<a href="/app/data-map" onClick={onNavigate}>数据地图台账</a>查阅。</p>
      <p role="note">{qualityEntryNotice}</p>
    </section>
    {state.busy ? <StatusPanel kind="loading" title="正在读取字段统计…" /> : state.error ? <StatusPanel kind="error" title={state.error.status === 403 ? '无权查看字段统计' : '字段统计暂不可用'}>{userMessage(state.error)} 请核对当前身份或点击“刷新字段统计”重试；读取失败不表示没有记录。</StatusPanel> : data.kind==='controlled' ? <>
      <section className="card"><h2>现行受控字段</h2>
        <p data-quality-controlled-total>{data.governed} 个字段已纳入现行受控台账，本次统计共 {data.total} 个字段。</p>
        {!data.total&&<p>当前可见范围暂无现行受控字段。</p>}
        <p>纳入受控台账表示已按数据地图发布结果登记，不表示字段中的数据值已经通过质量检查。</p>
      </section>
      <section className="card"><h2>旧资料待治理字段</h2><p data-quality-legacy-total>已登记的旧资料中，有 {data.legacyTotal} 个字段尚待完成受控治理。</p>{!data.legacyTotal&&<p>当前统计未发现已登记的旧资料字段；不能据此判断所有历史资料均已完成治理。</p>}<p>旧资料数量单独保留，不与现行受控字段合并为确认率，也不生成历史批准。</p></section>
    </> : <>
      <section className="card"><h2>历史字段身份确认记录</h2><p>以下沿用原身份记录的确认状态，不表示已经完成受控治理或数据值质量合格。尚未建立身份记录的字段不在统计中。</p>
        <p data-quality-overall>{data.confirmed} / {data.total} 条已确认{data.pct!=null?`（${data.pct}%）`:'（确认比例未提供）'}</p>
        <progress aria-label="历史字段身份确认进度" value={data.confirmed} max={data.total || 1} />
        {!data.total && <p>当前可见范围暂无字段身份记录。</p>}
      </section>
      <section className="card"><h2>按对象分组明细</h2>
        <p className="muted">按对象名称分组；同名对象可能合并统计，未关联对象的记录列为“未归类”。</p>
        {!data.groups.length ? <p>暂无对象分组。</p> : <div className="identity-table" tabIndex={0} aria-label="对象分组确认进度"><table style={{ tableLayout: 'fixed' }}>
          <thead><tr><th scope="col">对象名称分组</th><th scope="col">已确认</th><th scope="col">记录总数</th><th scope="col">确认比例</th></tr></thead>
          <tbody>{data.groups.map((row, index) => <tr key={index}><th scope="row" style={{ overflowWrap: 'anywhere' }}>{businessText(row.domain || '未归类')}</th><td>{row.confirmed}</td><td>{row.total}</td><td>{row.pct!=null?`${row.pct}%`:'未提供'}</td></tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </div>;
}
