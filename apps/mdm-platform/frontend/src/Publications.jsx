import React, { useEffect, useState } from 'react';
import { DirectoryPublication } from './DirectoryPublication.jsx';
import { IdentityField as Field } from './IdentityShared.jsx';

const labels = { master_data: '主数据', organization: '组织架构', roster: '花名册' };
function selection() {
  const query = new URLSearchParams(location.search);
  return { kind: Object.hasOwn(labels, query.get('kind')) ? query.get('kind') : 'master_data', id: /^\d+$/.test(query.get('id') || '') ? query.get('id') : '' };
}
export function Publications({ api, draft, setDraft, onLegacy, onQueryChange }) {
  const [selected, setSelected] = useState(selection);
  useEffect(() => {
    if (!draft?.dirty) setSelected(selection());
    const changed = () => { if (!draft?.dirty) setSelected(selection()); };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, [draft]);
  function select(next) {
    if (draft?.dirty && !window.confirm('放弃当前尚未发布的导入内容并切换发布类型？')) return;
    setDraft(null); setSelected(next);
    const query = new URLSearchParams({ kind: next.kind });
    if (next.id) query.set('id', next.id);
    onQueryChange('/app/publications?' + query.toString(), true);
  }
  return <div className="identity-module">
    <section className="card"><h2>主数据发布与版本查阅</h2><p>选择一份文件，核对唯一标识和版本变化，再由有发布权限的人员确认。历史版本可以查看和下载；发布记录不替代对象台账的治理认定。</p>
      <a href="/#/publications" onClick={onLegacy}>原主数据发布入口</a>
      <Field label="发布类型"><select value={selected.kind} onChange={e => select({ kind: e.target.value, id: '' })}>{Object.entries(labels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
    </section>
    <DirectoryPublication key={selected.kind} api={api} kind={selected.kind} draft={draft} setDraft={setDraft} selectedId={selected.id} onSelect={id => select({ ...selected, id: String(id) })} onPublished={() => {}} />
  </div>;
}
