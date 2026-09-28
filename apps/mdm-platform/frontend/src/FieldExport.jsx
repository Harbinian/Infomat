import React, { useEffect, useRef, useState } from 'react';

export function FieldExport({ api, user, disabled }) {
  const [state, setState] = useState({});
  const active = useRef(null);
  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);
  const global = user.permissions?.includes('governance:read-global');
  const allowed = global || (user.departmentId && user.permissions?.includes('governance:read-department'));
  function cancel() {
    active.current?.abort(); active.current = null;
    setState({ message: '已取消本次下载，尚未保存的输入保持不变。' });
  }
  async function download() {
    if (!allowed || disabled || active.current) return;
    const controller = new AbortController(); active.current = controller;
    setState({ busy: true });
    try {
      const blob = await api.request('/api/export/excel', { responseType: 'blob', signal: controller.signal });
      // Suspense may retain a previous page briefly after navigation.
      if (controller.signal.aborted || active.current !== controller || location.pathname.replace(/\/$/, '') !== '/app/data-map') return;
      if (!blob.size || !blob.type.includes('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')) throw new Error('服务器未返回有效的 Excel 文件，请重试。');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a'); link.href = url; link.download = 'mdm-data-map-field-ledger.xlsx';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      setState({ message: '已将 Excel 文件交给浏览器下载，请查看浏览器下载记录。尚未保存的输入没有提交。' });
    } catch (error) {
      if (controller.signal.aborted || active.current !== controller) return;
      setState({ error: `${error.message} 未生成下载文件，可手动重试；尚未保存的输入没有提交。` });
    } finally {
      if (active.current === controller) { active.current = null; setState(previous => ({ ...previous, busy: false })); }
    }
  }
  return <section className="card" aria-labelledby="field-export-heading">
    <h2 id="field-export-heading">导出字段台账与黄金源矩阵</h2>
    <p>导出范围：{global ? '当前账号有权查看的全部部门' : `本部门（${user.departmentName || '名称未提供'}）`}的已保存台账，不限于当前选择的上下文。</p>
    <p>一个 Excel 文件包含“字段台账”和“黄金源矩阵”两个工作表，沿用原有列名、数据及确认状态。空台账也会导出表头。</p>
    <p className="muted">下载不提交当前输入或待导入文件，不改变确认状态。原有“黄金源”和“是否确认”不代表新模板主数据或权威来源已经认定。</p>
    {!allowed && <p role="status">当前身份无权导出治理数据。</p>}
    <div className="actions">
      <button type="button" disabled={!allowed || disabled || state.busy} onClick={download}>{state.busy ? '正在准备台账…' : '下载可见范围台账'}</button>
      {state.busy && <button type="button" className="secondary" onClick={cancel}>取消台账下载</button>}
    </div>
    {state.error && <p role="alert" data-field-export-error>{state.error}</p>}
    {state.message && <p role="status" data-field-export-message>{state.message}</p>}
  </section>;
}
