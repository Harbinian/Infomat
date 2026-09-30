import React, { useEffect, useRef, useState } from 'react';
import './native-diagrams.css';
import { VersionSearch } from './VersionSearch';

let assets;
function loadAssets() {
  if (!assets) assets = (async () => {
    for (const [name, global] of [['cytoscape.min.js', 'cytoscape'], ['process-diagram.js', 'ProcessDiagram'], ['data-relation-diagram.js', 'DataRelationDiagram']]) {
      if (window[global]) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => fail(), 15000);
        const fail = () => { clearTimeout(timer); script.remove(); reject(new Error('图形组件加载失败，请刷新图形重试。')); };
        script.src = '/api/process-diagrams/assets/' + name;
        script.onload = () => { clearTimeout(timer); window[global] ? resolve() : fail(); };
        script.onerror = fail; document.head.appendChild(script);
      });
    }
  })().catch(error => { assets = null; throw error; });
  return assets;
}
const query = () => {
  const p = new URLSearchParams(location.search);
  return { caseId: p.get('diagramCase') || '', versionId: p.get('diagramVersion') || '', mode: p.get('diagramMode') === 'data' ? 'data' : 'process', dataRef: p.get('diagramData') || '' };
};
const shown = value => value === undefined || value === null || value === '' ? '原文未填写' : String(value);
function details(doc, kind, ref) {
  if (kind === 'behavior') {
    const row = doc.behaviors?.find(item => item.behavior_ref === ref);
    if (row) return { title: row.behavior_name, fields: [['执行角色', row.current_actor_role], ['业务说明', row.behavior_description], ['触发', row.trigger], ['前置条件', row.precondition], ['输入', row.input_description], ['完成标准', row.completion_standard], ['输出', row.output_description]] };
  }
  if (kind === 'data') {
    const row = doc.data_objects?.find(item => item.data_ref === ref);
    if (row) return { title: row.data_name, fields: [['说明', row.description], ['字段', (row.fields || []).map(field => field.field_name || field.name || field.field_ref).join('、')], ['关联行为数', (row.behavior_links || []).length]] };
  }
  if (kind === 'relation') {
    const row = doc.flow_relations?.find(item => item.relation_ref === ref);
    if (row) return { title: '流程关系', fields: [['条件', row.condition], ['关系类型', ({ sequence: '顺序', conditional: '条件', parallel: '并行', return: '返回' })[row.relation_type] || row.relation_type]] };
  }
  return null;
}

export function NativeDiagrams({ api, onQueryChange }) {
  const [selection, setSelection] = useState(query);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState({ busy: true });
  const [state, setState] = useState({});
  const [rendered, setRendered] = useState({});
  const [focus, setFocus] = useState(null);
  const [downloadState, setDownloadState] = useState({});
  const canvas = useRef(null), instance = useRef(null), downloadToken = useRef(null);
  const { caseId, versionId, mode, dataRef } = selection;
  const directVersion = !caseId && Boolean(versionId);
  const directRevision = directVersion ? revision : 0;
  useEffect(() => {
    const update = () => setSelection(query());
    window.addEventListener('popstate', update);
    return () => window.removeEventListener('popstate', update);
  }, []);
  function choose(patch) {
    const next = { ...selection, ...patch }, url = new URL(location.href);
    for (const [name, value] of Object.entries({ diagramCase: next.caseId, diagramVersion: next.versionId, diagramMode: next.mode, diagramData: next.dataRef })) {
      if (value) url.searchParams.set(name, value); else url.searchParams.delete(name);
    }
    onQueryChange(url, Object.hasOwn(patch, 'versionId')); setSelection(next);
  }
  useEffect(() => {
    const controller = new AbortController();
    if (directVersion) return () => controller.abort();
    setList({ busy: true });
    api.request('/api/process-v7-preview/cases?limit=100', { signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setList({ rows: result.items || result.cases || [] });
    }).catch(error => { if (!controller.signal.aborted) setList({ error }); });
    return () => controller.abort();
  }, [api, revision, directVersion]);
  useEffect(() => {
    const controller = new AbortController();
    setState(previous => ({ versions: previous.caseId === caseId ? previous.versions : [], caseId }));
    if (directVersion) {
      if (!/^[1-9]\d{0,19}$/.test(versionId)) {
        setState({ error: new Error('正式版本编号须为正十进制整数，请核对来源链接。') });
        return () => controller.abort();
      }
      setState({ busy: true, caseId, versionId });
      api.request('/api/process-design/versions/' + encodeURIComponent(versionId) + '/content', { signal: controller.signal }).then(version => {
        if (controller.signal.aborted) return;
        if (String(version.process_version_id) !== versionId || !version.document_id
          || !['published', 'superseded', 'retired'].includes(version.status)
          || !['process-governance-v7', 'process-governance-v8'].includes(version.schema_version)
          || version.document?.schema_version !== version.schema_version || version.content_hash_verified !== true) {
          throw new Error('固定版本的标识、状态、原生格式或摘要未核对通过，无法绘图。');
        }
        setState({ doc: version.document, caseId, versionId,
          source: `${version.status === 'published' ? '已发布' : `历史版本（${version.status}）`} · 正式版本 ${version.process_version_id} · ${version.document_no || '未记录制度编号'}` });
      }).catch(error => { if (!controller.signal.aborted) setState({ error }); });
      return () => controller.abort();
    }
    if (list.busy || list.error || !caseId) return () => controller.abort();
    if (!list.rows.some(row => String(row.id) === caseId)) { setState({ error: new Error('所选流程不在本次可见列表中，请重新选择。') }); return () => controller.abort(); }
    setState(previous => ({ ...previous, busy: true }));
    (async () => {
      const detail = await api.request('/api/process-v7-preview/cases/' + encodeURIComponent(caseId), { signal: controller.signal });
      const current = detail.formal_promotion?.current_version;
      const draftId = detail.formal_promotion?.draft?.id;
      let versions = [];
      if (draftId) {
        const formal = await api.request('/api/process-design/drafts/' + encodeURIComponent(draftId), { signal: controller.signal });
        versions = (formal.versions || []).filter(row => ['process-governance-v7', 'process-governance-v8'].includes(row.schema_version));
      }
      if (controller.signal.aborted) return;
      setState({ busy: true, versions, caseId });
      if (versionId && !versions.some(row => String(row.id) === versionId)) throw new Error('所选正式版本不在该流程可见版本列表中，请重新选择。');
      let doc = detail.revision?.document;
      let source = `预览修订 ${detail.revision?.revision_no} · 尚未形成正式发布结论`;
      const targetId = versionId || (current?.status === 'published' ? current.id : null);
      if (targetId) {
        const version = await api.request('/api/process-design/versions/' + encodeURIComponent(targetId) + '/content', { signal: controller.signal });
        if (String(version.process_version_id) !== String(targetId) || String(version.document_id) !== String(detail.formal_promotion.document.id)) throw new Error('正式版本与所选流程不一致，无法绘图。');
        if (!['process-governance-v7', 'process-governance-v8'].includes(version.schema_version) || !version.content_hash_verified) throw new Error('正式版本的原生格式或摘要未核对通过，无法绘图。');
        doc = version.document;
        source = `${version.status === 'published' ? '已发布' : `历史版本（${version.status}）`} · 正式版本 ${version.process_version_id} · ${version.document_no}`;
      }
      if (!doc || !['process-governance-v7', 'process-governance-v8'].includes(doc.schema_version)) throw new Error('当前内容不是受支持的原生流程格式，无法绘图。');
      if (!controller.signal.aborted) setState({ doc, source, caseId, versionId, versions });
    })().catch(error => { if (!controller.signal.aborted) setState(previous => ({ versions: previous.versions, caseId, error })); });
    return () => controller.abort();
  }, [api, caseId, versionId, list, directVersion, directRevision]);
  // Render only the selected response. Replacing a chart also invalidates an unfinished PNG.
  const doc = (directVersion || (!list.busy && !list.error)) && state.caseId === caseId && state.versionId === versionId ? state.doc : null;
  useEffect(() => {
    let active = true, observer;
    setFocus(null); setRendered({}); setDownloadState({}); downloadToken.current = null;
    if (doc && !(mode === 'data' && !doc.data_objects?.length)) {
      loadAssets().then(() => {
        if (!active || !canvas.current) return;
        const onFocus = (kind, ref) => setFocus(details(doc, kind, ref));
        const options = { container: canvas.current, documentData: doc, editable: false };
        const chart = mode === 'process' ? window.ProcessDiagram.mount({ ...options, onFocus }) : window.DataRelationDiagram.mount({ ...options, selectedDataRef: dataRef || doc.data_objects[0].data_ref, onFocus: node => onFocus(node.kind, node.ref) });
        instance.current = chart; chart.fit(); setRendered({ ready: true });
        observer = new ResizeObserver(() => { chart.cy.resize(); chart.fit(); }); observer.observe(canvas.current);
      }).catch(error => { if (active) setRendered({ error }); });
    }
    return () => { active = false; observer?.disconnect(); downloadToken.current = null; instance.current?.destroy(); instance.current = null; };
  }, [doc, mode, dataRef]);
  async function download() {
    const chart = instance.current;
    if (!chart || downloadToken.current) return;
    const token = {}; downloadToken.current = token; setDownloadState({ busy: true });
    const valid = () => downloadToken.current === token && instance.current === chart && location.pathname.replace(/\/$/, '') === '/app/data-map';
    try {
      const picture = new Image(); picture.src = chart.cy.png({ full: true, scale: 1, bg: '#ffffff', maxWidth: 6000, maxHeight: 6000 }); await picture.decode();
      if (!valid()) return;
      const output = document.createElement('canvas'); output.width = Math.max(1000, picture.width); output.height = picture.height + 100;
      const context = output.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, output.width, output.height);
      context.fillStyle = '#172b45'; context.font = 'bold 20px "Microsoft YaHei",sans-serif';
      const title = doc.process?.process_name || '未命名流程', label = mode === 'data' ? '数据关系图' : '流程图';
      context.fillText(title + ' · ' + label, 24, 34, output.width - 48);
      context.fillStyle = '#53647b'; context.font = '16px "Microsoft YaHei",sans-serif'; context.fillText(state.source, 24, 68, output.width - 48); context.drawImage(picture, 0, 100);
      const blob = await new Promise(resolve => output.toBlob(resolve, 'image/png'));
      if (!valid()) return;
      if (!blob) throw new Error('未能生成图片，请重试。');
      const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = title + '-' + label + '.png'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setDownloadState({ message: '已将含流程名称及版本来源的 PNG 交给浏览器下载。' });
    } catch (error) { if (valid()) setDownloadState({ error: error.message }); }
    finally { if (valid()) { downloadToken.current = null; setDownloadState(previous => ({ ...previous, busy: false })); } }
  }
  const error = (!directVersion && list.error) || state.error || rendered.error;
  const noData = doc && mode === 'data' && !doc.data_objects?.length;
  return <section className="card native-diagrams" aria-labelledby="native-diagrams-heading" data-diagram-state={error ? 'error' : doc && (rendered.ready || noData) ? 'ready' : 'idle'}>
    <div className="section-heading"><h2 id="native-diagrams-heading">流程与数据关系图</h2><button type="button" className="secondary" onClick={() => setRevision(value => value + 1)}>刷新图形</button></div>
    <p>按当前有权查看的流程记录绘图。默认优先读取当前已发布版本，否则标明预览修订；也可独立选择历史正式版本。内容修订仍回到 3001 办理。</p>
    <VersionSearch api={api} onQueryChange={onQueryChange} onChoose={id => choose({ caseId: '', versionId: id, dataRef: '' })} />
    {directVersion ? <p data-direct-version>正在按固定版本 #{versionId} 独立查阅，无需先选择案例。历史版本不代表当前有效制度。<button type="button" className="secondary" onClick={() => choose({ caseId: '', versionId: '', dataRef: '' })}>返回案例选图</button></p> : <p className="muted">本次列出接口返回的最多 100 个案例；不代表全部流程。图形查阅和下载不会提交台账输入。</p>}
    {!directVersion && (list.busy ? <p role="status">正在读取流程列表…</p> : !list.error && <label className="identity-field">图形流程<select aria-label="图形流程" value={caseId} onChange={event => choose({ caseId: event.target.value, versionId: '', dataRef: '' })}>
      <option value="">请选择流程</option>{list.rows.map(row => <option key={row.id} value={row.id}>{row.process_name} · 修订 {row.current_revision_no}</option>)}
    </select></label>)}
    {caseId && <label className="identity-field">图形版本<select aria-label="图形版本" value={versionId} onChange={event => choose({ versionId: event.target.value, dataRef: '' })}>
      <option value="">自动选择当前来源</option>
      {versionId && !state.versions?.some(row => String(row.id) === versionId) && <option value={versionId}>待核对版本 {versionId}</option>}
      {(state.caseId === caseId ? state.versions || [] : []).map(row => <option key={row.id} value={row.id}>正式版本 {row.id} · {row.edition || row.version_no} · {({ published: '已发布', superseded: '历史已发布', retired: '已退役（仅查阅）' })[row.status] || row.status}</option>)}
    </select></label>}
    {!directVersion && list.rows?.length === 0 && <p>当前可见范围暂无流程。</p>}
    {state.busy && <p role="status">正在读取流程内容…</p>}
    {error && <p role="alert">{error.message} 请刷新图形重试；读取失败不表示没有记录。</p>}
    {doc && <>
      <h3>{doc.process?.process_name || '未命名流程'}</h3><p data-diagram-source>{state.source}</p>
      <div className="actions"><label>图形视图<select aria-label="图形视图" value={mode} onChange={event => choose({ mode: event.target.value })}><option value="process">流程图</option><option value="data">数据关系图</option></select></label>
        {mode === 'data' && !!doc.data_objects?.length && <label>图形数据对象<select aria-label="图形数据对象" value={dataRef && doc.data_objects.some(row => row.data_ref === dataRef) ? dataRef : doc.data_objects[0].data_ref} onChange={event => choose({ dataRef: event.target.value })}>{doc.data_objects.map(row => <option key={row.data_ref} value={row.data_ref}>{row.data_name}</option>)}</select></label>}
        <button type="button" className="secondary" disabled={!rendered.ready} onClick={() => instance.current?.fit()}>完整视图</button>
        <button type="button" className="secondary" disabled={!rendered.ready} onClick={() => instance.current?.reset()}>清晰视图</button>
        <button type="button" disabled={!rendered.ready || downloadState.busy} onClick={download}>{downloadState.busy ? '正在生成图片…' : '下载图形 PNG'}</button>
      </div>
      {noData ? <p>当前流程没有数据对象，无法绘制数据关系。</p> : <div className="native-diagram-grid">
        <div ref={canvas} className="native-diagram-viewport" aria-label="流程与数据关系图画布" />
        <div className="native-diagram-inspector" role="status">{focus ? <><strong>{focus.title}</strong><dl>{focus.fields.map(([label, value]) => <React.Fragment key={label}><dt>{label}</dt><dd>{shown(value)}</dd></React.Fragment>)}</dl></> : <p>点击图中节点查看原始内容。拖动空白处平移，滚轮缩放。</p>}</div>
      </div>}
      <details><summary>键盘查阅原始内容</summary><div className="actions">{(mode === 'process' ? doc.behaviors || [] : doc.data_objects || []).map(row => <button type="button" className="secondary" key={row.behavior_ref || row.data_ref} onClick={() => setFocus(details(doc, mode === 'process' ? 'behavior' : 'data', row.behavior_ref || row.data_ref))}>{row.behavior_name || row.data_name}</button>)}</div></details>
      {downloadState.message && <p role="status">{downloadState.message}</p>}{downloadState.error && <p role="alert">{downloadState.error}</p>}
    </>}
  </section>;
}
