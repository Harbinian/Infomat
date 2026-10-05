import React, { useMemo, useEffect, useRef } from 'react';
import { Select, Button, Table, Empty, Space, Tag, Typography } from 'antd';
import FieldInput from './FieldInput.jsx';
import { catalog } from './model.mjs';

const nameOf = row => row.data_name || row.form_name || row.area_title || row.item_name || row.field_name || row._row_id;
export const GRID_NAMES = { data_objects:'数据对象', data_fields:'对象字段', data_behavior_links:'数据与环节关系', data_source_relations:'数据来源', forms:'表单／记录', form_behavior_links:'表单与环节关系', form_areas:'表单区域', form_items:'表单字段', field_source_links:'字段取值来源' };

export function gridOptions(column, state, row) {
  const tables = state.session?.tables || {};
  const labels = globalThis.ProcessV7GridAdapter?.LABELS || {};
  if (column.editor === 'update-fields') return (tables.data_fields || []).filter(x => !x._deleted && x.data_ref === row.data_ref).map(x => ({value:x.field_ref,label:`${x.field_name || '未命名字段'} · ${x.field_ref}`}));
  if (!column.lookup) return column.values || column.options || [];
  let rows = tables[column.lookup] || [];
  if (column.lookup === 'behaviors' || column.lookup === 'dataBehaviors') rows = (state.document?.behaviors || []).filter(x => column.lookup !== 'dataBehaviors' || x.node_type === 'action' || x.node_type === 'decision' && row.operation === 'use');
  if (column.lookup === 'data_fields') rows = rows.filter(x => !row.business_data_ref || x.data_ref === row.business_data_ref);
  if (column.lookup === 'form_areas') rows = rows.filter(x => !row.form_ref || x.form_ref === row.form_ref);
  const refKey = { data_objects:'data_ref',data_fields:'field_ref',forms:'form_ref',form_areas:'area_ref',form_items:'item_ref',behaviors:'behavior_ref',dataBehaviors:'behavior_ref' }[column.lookup];
  const entries=catalog(state.gridDraftDocument||state.document);
  return rows.filter(x => !x._deleted).map(x => {const ambiguous=entries.filter(entry=>entry.ref===x[refKey]).length!==1||entries.some(entry=>entry.ref===x[refKey]&&entry.ambiguous);return { value:x[refKey],disabled:ambiguous, label:`${x.behavior_name || nameOf(x)} · ${x[refKey]}${x.data_ref && column.lookup === 'data_fields' ? ` · ${tables.data_objects?.find(o=>o.data_ref===x.data_ref)?.data_name || x.data_ref}` : ''}${ambiguous?'（⚠ 标识歧义）':''}` };});
}

export default function GridWorkspace({ state, dispatch }) {
  const session = state.session;
  const wrapper = useRef(null);
  const definitions = session?.definitions || globalThis.ProcessV7GridAdapter?.definitions(state.document,{allowedFieldTypes:state.enums?.fieldType}) || [];
  const tableId = session?.tableId || state.gridTableId || 'data_objects';
  const definition = definitions.find(x => x.id === tableId) || definitions[0];
  const parentRef = session?.parentRef || '';
  const scrollKey=`${tableId}:${parentRef}`;
  const rows = (session?.tables?.[tableId] || []).filter(x => !x._deleted && (!definition?.parentKey || x[definition.parentKey] === parentRef));
  const parents = definition?.parentTableId ? (session?.tables?.[definition.parentTableId] || []).filter(x => !x._deleted) : [];
  const chooseTable = value => dispatch({type:'grid-table',tableId:value,parentRef:''});
  const columns = useMemo(() => !definition ? [] : definition.columns.filter(c => !c.readOnly && c.key !== definition.parentKey && c.key !== 'form_ref').map((column,columnIndex) => ({
    title:column.label, key:column.key, dataIndex:column.key, width:column.editor === 'textarea' ? 280 : column.editor === 'update-fields' ? 240 : 190,
    render:(value,row) => <FieldInput compact id={`cell-${tableId}-${row._row_id}-${column.key}`} field={{...column,readOnly:column.readOnly||tableId==='form_items'&&column.key==='item_type'&&Boolean(row.data_field_ref),options:gridOptions(column,state,row)}} value={value} onChange={v=>dispatch({type:'grid-update',tableId,rowId:row._row_id,column:column.key,value:v})} onPaste={e=>{
      if (e.nativeEvent?.isComposing) return;
      const text=e.clipboardData.getData('text/plain');
      if (!/[\t\r\n]/.test(text)) return;
      e.preventDefault();
      dispatch({type:'grid-paste',tableId,rowId:row._row_id,column:column.key,text,matrix:globalThis.NativeWebGrid.parseClipboardGrid(text)});
    }} />,
  })),[definition,tableId,session?.tables,state.document]);
  useEffect(()=>{
    if (!state.focus?.rowId || state.focus.tableId!==tableId) return;
    const input=state.focus.field?document.getElementById(`cell-${tableId}-${state.focus.rowId}-${state.focus.field}`):wrapper.current?.querySelector(`[id^="cell-${tableId}-${state.focus.rowId}-"]`);
    input?.focus();
  },[state.focus?.sequence,tableId]);
  useEffect(()=>{const body=wrapper.current?.querySelector('.ant-table-body');const saved=state.viewport?.grid?.[scrollKey];if(body){body.scrollTop=saved?.scrollTop||0;body.scrollLeft=saved?.scrollLeft||0;}},[scrollKey]);
  if (!session || session.kind !== 'grid') return <Empty description="打开批量表格后，在同一工作副本中连续整理。"><Button onClick={()=>dispatch({type:'grid-start'})}>打开批量表格</Button></Empty>;
  return <div className="grid-workspace" ref={wrapper} onScrollCapture={event=>{if(event.target.classList.contains('ant-table-body'))dispatch({type:'viewport',view:'grid',viewport:{...(state.viewport?.grid||{}),[scrollKey]:{scrollTop:event.target.scrollTop,scrollLeft:event.target.scrollLeft}}});}}>
    <div className="grid-toolbar"><Space><Select aria-label="当前表格" value={tableId} options={definitions.map(x=>({value:x.id,label:GRID_NAMES[x.id]||x.label}))} onChange={chooseTable} style={{width:200}} />
      {definition?.parentKey && <Select aria-label="所属区域" placeholder={`请选择${GRID_NAMES[definition.parentTableId]}`} value={parentRef || undefined} options={parents.map(x=>{const entries=catalog(state.gridDraftDocument||state.document).filter(entry=>entry.ref===x._row_id);const ambiguous=entries.length!==1||entries[0].ambiguous;return {value:x[definitions.find(d=>d.id===definition.parentTableId)?.refField],label:`${nameOf(x)} · ${x._row_id}${ambiguous?'（⚠ 标识歧义）':''}`,disabled:ambiguous};})} onChange={value=>dispatch({type:'grid-table',tableId,parentRef:value})} style={{width:290}} />}
      <Tag>{rows.length} 条记录</Tag></Space>
      <Button disabled={Boolean(definition?.parentKey && !parentRef)} onClick={()=>dispatch({type:'grid-add',tableId,parentRef})}>＋ 新增{GRID_NAMES[tableId]}</Button></div>
    <div className="grid-session-line"><span>所有表格与旁边详情共用一份工作副本。切换表格与记录会保留修改。</span><Space><Button aria-label="应用全部表格修改" type="primary" loading={state.busy} disabled={!state.pending} onClick={()=>dispatch({type:'grid-apply'})}>应用全部表格修改</Button><Button disabled={!state.pending || state.busy} onClick={()=>dispatch({type:'grid-cancel'})}>放弃全部表格修改</Button></Space></div>
    {definition?.parentKey && !parentRef ? <div className="empty-zone"><Empty description={`先选择${GRID_NAMES[definition.parentTableId]}，再维护${GRID_NAMES[tableId]}。不会自动选择第一个父级。`} /></div> : <Table className="editable-grid" rowKey="_row_id" columns={[{title:'记录',key:'record',width:74,fixed:'left',render:(_,row)=><Button size="small" aria-label={`查看记录 ${row._row_id}`} onClick={()=>dispatch({type:'grid-select',tableId,rowId:row._row_id})}>详情</Button>},...columns]} dataSource={rows} pagination={false} scroll={{x:'max-content',y:460}} rowClassName={row=>row._row_id===session.rowId?'selected-row':''} onRow={row=>({onDoubleClick:()=>dispatch({type:'grid-select',tableId,rowId:row._row_id})})} locale={{emptyText:<Empty description={`本区域尚无${GRID_NAMES[tableId]}`} />}} />}
    <Typography.Text className="grid-footnote">支持从单元格开始粘贴多行多列。原有标识与父级归属在详情中核对；引用选择保留标识以区分同名对象。</Typography.Text>
  </div>;
}
