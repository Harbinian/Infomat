import React, { useEffect, useRef, useState } from 'react';
import { StatusPanel } from './components.jsx';
import { FieldImport } from './FieldImport.jsx';
import { FieldIdentity } from './FieldIdentity.jsx';
import { FieldExport } from './FieldExport.jsx';
import { NativeDiagrams } from './NativeDiagrams.jsx';
import './identity-directory.css';

const labels = { unchecked: '未检查', ok: '正常', approved: '已确认', warning: '需关注', warn: '需关注', error: '异常', blocked: '已阻断', pending: '待处理', rejected: '已驳回' };
const display = value => value === null || value === undefined || value === '' ? '未记录' : String(value);
function systems(value) {
  let parsed = value;
  if (typeof value === 'string') { try { parsed = JSON.parse(value); } catch { return value; } }
  return Array.isArray(parsed) ? (parsed.join('、') || '未记录') : value;
}
const selection = () => new URLSearchParams(location.search).get('context') || '';

export function DataMapRead({ api, user, draft, setDraft, fieldDraft, setFieldDraft, isFieldAttemptCurrent, identityDraft, setIdentityDraft, onLegacy, onQueryChange }) {
  const [contextId, setContextId] = useState(selection);
  const [writeState, setWriteState] = useState({});
  const [importBusy, setImportBusy] = useState(false);
  const writing = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const canCreate = Boolean(user?.departmentId && user.permissions?.includes('governance:draft-department'));
  function edit(name, value) {
    setDraft({ ...draft, [name]: value, dirty: true });
    setWriteState({});
  }
  async function create(event) {
    event.preventDefault();
    if (!canCreate || writing.current || importBusy) return;
    if (!draft?.title?.trim()) { setWriteState({ error: '请填写上下文标题。' }); return; }
    writing.current = true; setWriteState({ busy: true });
    try {
      const result = await api.request('/api/data-map/contexts', { method: 'POST', body: {
        title: draft.title.trim(), dept_id: user.departmentId, dept_name: user.departmentName || '',
        source_file: (draft.source_file || '').trim(), source_anchor: (draft.source_anchor || '').trim()
      } });
      if (!mounted.current) return;
      setDraft(null); choose(String(result.id)); setRevision(value => value + 1);
      setWriteState({ success: `已创建上下文 #${result.id}，可在下方查看关联字段。` });
    } catch (error) {
      if (mounted.current) setWriteState({ error: error.status === 409 ? '上下文已存在或请求冲突。输入已保留，请刷新列表核对，不要反复创建。' : `${error.message} 若结果不明确，请先刷新列表核对是否已经创建。` });
    } finally { writing.current = false; }
  }
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ busy: true });
  useEffect(() => {
    const update = () => setContextId(selection());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState({ busy: true });
    (async () => {
      const contexts = await api.request('/api/data-map/contexts', { signal: controller.signal });
      const selected = contexts.find(row => String(row.id) === contextId);
      const fields = selected ? await api.request('/api/field-entries/mapping/' + encodeURIComponent(selected.id), { signal: controller.signal }) : [];
      if (!controller.signal.aborted) setState({ contexts, selected, fields, contextId, readAt: Date.now() });
    })().catch(error => { if (!controller.signal.aborted) setState({ error }); });
    return () => controller.abort();
  }, [api, contextId, revision]);
  function choose(value) {
    const url = new URL(location.href);
    if (value) url.searchParams.set('context', value); else url.searchParams.delete('context');
    // Keep the shell's history index; local selections replace only this page's URL.
    history.replaceState(history.state, '', url);
    setContextId(value);
  }
  const pending = state.busy || (!state.error && state.contextId !== contextId);
  return <div className="identity-module" data-map-state={pending ? 'loading' : state.error ? 'error' : 'ready'}>
    <section className="card">
      <div className="section-heading"><h1>数据地图台账查阅</h1><button className="secondary" disabled={importBusy} onClick={() => setRevision(value => value + 1)}>刷新数据地图</button></div>
      <p>选择一个来源上下文，查看所属字段及原有质量状态。上下文用于定位材料和办理范围，不代表对象身份。</p>
      <p className="muted">具有本部门编制权限的人员可创建上下文并导入字段；台账可按当前权限范围导出，下方可查阅流程与数据关系图。字段身份与黄金源可在下方查阅、维护并由有权限人员确认；原有质量状态不代表新模板对象或权威来源已认定。</p>
      <a href="/#/dataMap" onClick={onLegacy}>打开原数据地图入口</a>
    </section>
    {canCreate && <section className="card"><h2>创建数据地图上下文</h2>
      <p>归口部门：{user.departmentName || '名称未提供'}。上下文只用于定位来源及办理范围，创建成功不表示对象已经认定。</p>
      <form onSubmit={create}>
        <fieldset disabled={writeState.busy || importBusy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          {[['title', '上下文标题', 255], ['source_file', '来源文件', 255], ['source_anchor', '来源位置', 255]].map(([name, label, maxLength]) => <label className="identity-field" key={name}>{label}<input aria-label={label} required={name === 'title'} maxLength={maxLength} value={draft?.[name] || ''} onChange={event => edit(name, event.target.value)} /></label>)}
          <button type="submit">{writeState.busy ? '正在创建…' : '创建数据地图上下文'}</button>
        </fieldset>
      </form>
      {draft?.dirty && <p className="input-notice">输入尚未提交，仅保留在当前页面。刷新列表及切换上下文不会清除输入。</p>}
      {writeState.error && <p role="alert" data-context-create-error>{writeState.error}</p>}
      {writeState.success && <p role="status">{writeState.success}</p>}
    </section>}
    {pending ? <StatusPanel kind="loading" title="正在读取数据地图…" /> : state.error ? <StatusPanel kind="error" title={state.error.status === 403 ? '无权查看数据地图' : '数据地图暂不可用'}>{state.error.message} 请刷新重试；读取失败不表示没有记录。</StatusPanel> : <>
      <section className="card"><h2>来源上下文</h2>
        <label className="identity-field">数据地图上下文<select aria-label="数据地图上下文" disabled={importBusy} value={contextId} onChange={event => choose(event.target.value)}>
          <option value="">请选择上下文</option>
          {state.contexts.map(row => <option key={row.id} value={row.id}>{row.title || row.context_key || `上下文 #${row.id}`}{row.dept_name ? `（${row.dept_name}）` : ''}</option>)}
        </select></label>
        {!state.contexts.length && <p>当前可见范围暂无上下文。</p>}
        {contextId && !state.selected && <p role="status">指定上下文不存在或不在当前可见范围，请重新选择。</p>}
        {state.selected && <dl style={{ overflowWrap: 'anywhere' }}><dt>上下文编号</dt><dd>{state.selected.id}</dd><dt>归口部门</dt><dd>{display(state.selected.dept_name)}</dd><dt>来源文件</dt><dd>{display(state.selected.source_file)}</dd><dt>来源位置</dt><dd>{display(state.selected.source_anchor)}</dd></dl>}
      </section>
      <section className="card"><h2>关联字段台账</h2>
        {!state.selected ? <p>请先选择上下文。</p> : !state.fields.length ? <p>当前上下文暂无字段。</p> : <>
          <p>共 {state.fields.length} 个字段</p>
          <div className="identity-table" tabIndex={0} aria-label="关联字段台账"><table style={{ tableLayout: 'fixed', minWidth: 980 }}>
            <thead><tr>{['字段编号', '中文字段名', '英文字段名', '数据对象', '字段类型', '同步方式', '消费系统', '质量状态'].map(title => <th scope="col" key={title}>{title}</th>)}</tr></thead>
            <tbody>{state.fields.map(row => <tr key={row.id}>{[row.id, row.field_name_cn, row.field_name_en, row.data_object, row.field_type, row.sync_mode, systems(row.consume_systems), labels[row.quality_status || row.status] || ((row.quality_status || row.status) ? `状态待识别（${row.quality_status || row.status}）` : '未记录')].map((value, index) => <td key={index} style={{ overflowWrap: 'anywhere' }}>{display(value)}</td>)}</tr>)}</tbody>
          </table></div></>}
      </section>
    </>}
    <FieldIdentity api={api} user={user} context={state.selected} fields={state.fields} pending={Boolean(pending || state.error)} readAt={state.readAt} draft={identityDraft} setDraft={setIdentityDraft} onQueryChange={onQueryChange} />
    <NativeDiagrams api={api} onQueryChange={onQueryChange} />
    <FieldExport api={api} user={user} disabled={importBusy || Boolean(writeState.busy)} />
    <FieldImport api={api} user={user} selected={!pending && !state.error ? state.selected : null} pending={Boolean(pending || state.error || writeState.busy)} lastReadAt={state.readAt} draft={fieldDraft} setDraft={setFieldDraft} busy={importBusy} setBusy={setImportBusy} isCurrentAttempt={isFieldAttemptCurrent} onImported={value => { choose(value); setRevision(current => current + 1); }} />
  </div>;
}
