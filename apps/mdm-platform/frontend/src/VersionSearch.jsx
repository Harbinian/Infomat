import {businessFileName} from './businessPresentation.js';
import {BusinessDetails} from "./BusinessDetails.jsx";
import {businessStatus,userMessage} from "./businessPresentation.js";
import React, { useEffect, useRef, useState } from 'react';

const statusLabel = value => ({ published: '已发布', superseded: '历史已发布', retired: '已退役（仅查阅）' })[value] || businessStatus(value);
const fromUrl = () => {
  const params = new URLSearchParams(location.search);
  return { q: params.get('versionQuery') || '', before: params.get('versionBefore') || '', active: params.has('versionQuery') };
};

export function VersionSearch({ api, onQueryChange, onChoose }) {
  const [input, setInput] = useState(() => fromUrl().q);
  const [state, setState] = useState({});
  const [detail, setDetail] = useState({});
  const pending = useRef(null), sequence = useRef(0), pageRef = useRef({ q: '', before: '' });
  function cancel() { pending.current?.abort(); sequence.current++; }
  function begin() {
    cancel(); const controller = new AbortController(); pending.current = controller;
    return { controller, token: sequence.current };
  }
  function remember(q, before, push) {
    const url = new URL(location.href); url.searchParams.set('versionQuery', q);
    if (before) url.searchParams.set('versionBefore', before); else url.searchParams.delete('versionBefore');
    onQueryChange(url, push);
  }
  async function search(q, before = '', push = true) {
    const { controller, token } = begin(); pageRef.current = { q, before };
    remember(q, before, push); setDetail({}); setState({ loading: true });
    try {
      const params = new URLSearchParams({ q }); if (before) params.set('before_id', before);
      const result = await api.request('/api/process-design/versions?' + params, { signal: controller.signal });
      if (token !== sequence.current) return;
      if (!Array.isArray(result.items) || result.coverage !== 'visible_native_versions') throw new Error('版本列表响应无法核对，请重试。');
      setState({ rows: result.items, next: result.next_cursor });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setState({ error }); }
  }
  useEffect(() => {
    const restore = () => {
      const value = fromUrl(); setInput(value.q); cancel(); setState({}); setDetail({});
      if (value.active) search(value.q, value.before, false);
    };
    restore(); window.addEventListener('popstate', restore);
    return () => { cancel(); window.removeEventListener('popstate', restore); };
  }, [api]);
  async function read(row, download = false) {
    const { controller, token } = begin(); setDetail({ loading: true });
    try {
      const root = '/api/process-design/versions/' + encodeURIComponent(row.id);
      const content = await api.request(root + '/content', { signal: controller.signal });
      if (token !== sequence.current) return;
      if (String(content.process_version_id) !== row.id || String(content.document_id) !== row.document_id
        || !content.document_id || content.content_hash !== row.content_hash || content.content_hash_verified !== true
        || content.schema_version !== row.schema_version || content.document?.schema_version !== row.schema_version
        || content.status !== row.status) throw new Error('版本、主档、状态或摘要已变化，请重新检索核对。');
      if (download) {
        const result = await api.request(root + '/procedure-markdown', { signal: controller.signal });
        if (token !== sequence.current) return;
        if (String(result.process_version_id) !== row.id || result.content_hash !== content.content_hash || typeof result.markdown !== 'string') throw new Error('程序文件与所选版本不一致，已停止下载。');
        const url = URL.createObjectURL(new Blob([result.markdown], { type: 'text/markdown;charset=utf-8' }));
        const link = document.createElement('a'); link.href = url; link.download = businessFileName(row.document_title,'所选流程正文','md'); link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      setDetail({ content, downloaded: download });
    } catch (error) { if (token === sequence.current && !controller.signal.aborted) setDetail({ error }); }
  }
  return <section data-version-search style={{ overflowWrap: 'anywhere' }} aria-labelledby="version-search-heading">
    <h3 id="version-search-heading">检索正式版本</h3>
    <p>按制度编号或标题查找有权查阅的已发布流程。历史及退役记录不表示制度当前有效；每页20条，查看新记录请返回检索首页。</p>
    <form onSubmit={event => { event.preventDefault(); search(input); }}>
      <label className="identity-field" htmlFor="version-search-query">制度编号或标题
      <input id="version-search-query" maxLength={200} value={input} onChange={event => {
        const value = event.target.value; cancel(); setInput(value); setState({}); setDetail({}); remember(value, '', false);
      }} /></label>
      <button type="submit">检索版本</button>
    </form>
    {state.loading && <p role="status">正在检索版本…</p>}
    {state.error && <p role="alert">{userMessage(state.error)} 读取失败不代表没有版本。<button onClick={() => search(pageRef.current.q, pageRef.current.before, false)}>重试版本检索</button></p>}
    {state.rows && <>
      {!state.rows.length && <p>当前条件和权限范围内没有版本。</p>}
      <p>本页 {state.rows.length} 条。选择下方版本查阅正文、下载文件或查看图形。</p>
      <ul style={{ maxHeight: 320, overflowY: 'auto' }}>{state.rows.map(row => <li key={row.id} data-version-result={row.id}>
        <p>{row.document_no || '未记录制度编号'} · {row.document_title || '未记录标题'} · {row.edition} · {statusLabel(row.status)}</p>
        <div className="actions">
          <button onClick={() => read(row)}>查阅版本正文</button>
          <button disabled={row.status === 'retired'} onClick={() => read(row, true)}>下载所选流程文件</button>
          <button onClick={() => { cancel(); setDetail({}); onChoose(row.id); }}>查看版本图形</button>
        </div>
      </li>)}</ul>
      <div className="actions"><button onClick={() => search(input)}>返回检索首页</button><button disabled={!state.next} onClick={() => search(input, state.next)}>更早版本</button></div>
    </>}
    {detail.loading && <p role="status">正在核对固定版本…</p>}
    {detail.error && <p role="alert">{userMessage(detail.error)} 请重新检索或再次选择版本。</p>}
    {detail.content && <div data-version-search-content>
      <p>所选流程 · {statusLabel(detail.content.status)} · 已核对所选内容。{detail.downloaded && '已发起程序文件下载。'}</p>
      <details><summary>查看该版本的流程内容</summary><BusinessDetails value={detail.content.document}/></details>
    </div>}
    <p className="muted">检索条件保留在当前网址中；查阅不提交相邻台账输入。查阅时会重新核对权限及内容是否一致；下载文件按所选记录生成，原始上传文件仍保留。</p>
  </section>;
}
