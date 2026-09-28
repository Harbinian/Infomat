import React, { useEffect, useState } from 'react';
import { StatusPanel } from './components.jsx';
import './identity-directory.css';

// Both views use one scoped HTTP response; database snapshot semantics stay unchanged.
export function Quality({ api, onLegacy }) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ busy: true });
    api.request('/api/quality/field-identities/progress', { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ data }); })
      .catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, revision]);
  const overall = state.data?.overall;
  return <div className="identity-module" data-quality-state={state.busy ? 'loading' : state.error ? 'error' : 'ready'}>
    <section className="card">
      <div className="section-heading"><h1>数据质量</h1><button className="secondary" onClick={() => setRevision(value => value + 1)}>刷新确认进度</button></div>
      <p>查看当前身份可见的字段身份确认进度，以及各对象名称分组的确认情况。</p>
      <p className="muted">统计仅覆盖已有字段身份记录，未建立身份记录的字段不在分母中。“已确认”沿用原字段身份记录状态，不表示数据值质量合格，也不代表新模板对象或权威来源已正式认定。</p>
      <a href="/#/quality" onClick={event => onLegacy(event, '/#/quality')}>打开原数据质量入口</a>
    </section>
    {state.busy ? <StatusPanel kind="loading" title="正在读取确认进度…" /> : state.error ? <StatusPanel kind="error" title={state.error.status === 403 ? '无权查看确认进度' : '确认进度暂不可用'}>{state.error.message} 请核对当前身份或点击“刷新确认进度”重试；读取失败不表示没有记录。</StatusPanel> : <>
      <section className="card"><h2>总体确认进度</h2>
        <p data-quality-overall>{overall.confirmed} / {overall.total} 条已确认（{overall.pct}%）</p>
        <progress aria-label="总体确认进度" value={overall.confirmed} max={overall.total || 1} />
        {!overall.total && <p>当前可见范围暂无字段身份记录。</p>}
      </section>
      <section className="card"><h2>按对象分组明细</h2>
        <p className="muted">分组沿用原接口的对象名称口径；同名对象可能合并统计，未关联对象的记录列为“未归类”。</p>
        {!state.data.by_domain.length ? <p>暂无对象分组。</p> : <div className="identity-table" tabIndex={0} aria-label="对象分组确认进度"><table style={{ tableLayout: 'fixed' }}>
          <thead><tr><th scope="col">对象名称分组</th><th scope="col">已确认</th><th scope="col">记录总数</th><th scope="col">确认比例</th></tr></thead>
          <tbody>{state.data.by_domain.map((row, index) => <tr key={index}><th scope="row" style={{ overflowWrap: 'anywhere' }}>{row.domain || '未归类'}</th><td>{row.confirmed}</td><td>{row.total}</td><td>{row.pct}%</td></tr>)}</tbody>
        </table></div>}
      </section>
    </>}
  </div>;
}
