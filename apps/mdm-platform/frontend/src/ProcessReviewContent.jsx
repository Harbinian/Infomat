import {BusinessDetails} from "./BusinessDetails.jsx";
import {businessStatus,businessText} from "./businessPresentation.js";
import {useState} from 'react';

const categories={behaviors:'环节',data_objects:'数据对象',forms:'表单／记录',terms:'术语'};
const nameOf=row=>row.behavior_name||row.data_name||row.form_name||row.term_name||'未命名内容';
const refOf=row=>row.behavior_ref||row.data_ref||row.form_ref||row.term_ref;
const text=value=>value===true?'是':value===false?'否':typeof value==='string'?businessText(value):'';
function Values({items}){return <dl className="review-values">{items.filter(([,value])=>text(value)).map(([label,value])=><div key={label}><dt>{label}</dt><dd>{text(value)}</dd></div>)}</dl>;}

// Read-only projection of the saved native document; no edits or inferred facts.
export function ProcessReviewContent({source,selectedBehavior,onBehaviorChange}){
  const [category,setCategory]=useState('behaviors'),[selected,setSelected]=useState(''),[search,setSearch]=useState('');
  const rows=source[category]||[],selectedRef=category==='behaviors'&&selectedBehavior?selectedBehavior:selected;
  const row=rows.find(value=>refOf(value)===selectedRef)||rows[0];
  const objects=category==='behaviors'?(source.data_objects||[]).filter(value=>value.behavior_links?.some(link=>link.behavior_ref===row?.behavior_ref)):[];
  return <section className="review-content" aria-label="流程内容查阅">
    <div className="review-content-list"><label>查找流程内容<input aria-label="查找流程内容" value={search} onChange={event=>setSearch(event.target.value)} placeholder="输入名称"/></label>
      <div className="review-categories" aria-label="内容分类">{Object.entries(categories).map(([key,title])=><button key={key} aria-pressed={category===key} onClick={()=>{setCategory(key);setSelected('');setSearch('');onBehaviorChange?.('');}}>{title}<small>{source[key]?.length||0}</small></button>)}</div>
      <div className="review-object-list" aria-label={categories[category]+'列表'}>{rows.filter(value=>nameOf(value).includes(search)).map(value=><button key={refOf(value)} aria-current={row===value?'true':undefined} onClick={()=>{setSelected(refOf(value));if(category==='behaviors')onBehaviorChange?.(refOf(value));}}>{nameOf(value)}</button>)}{!rows.filter(value=>nameOf(value).includes(search)).length&&<p>没有符合名称的内容。</p>}</div>
    </div>
    <article className="review-content-detail">{row?<><small>{categories[category]} · 原文只读</small><h2>{nameOf(row)}</h2>
      {category==='behaviors'&&<><Values items={[["执行角色",row.current_actor_role],["环节说明",row.behavior_description],["触发条件",row.trigger],["前置条件",row.precondition],["输入",row.input_description],["完成标准",row.completion_standard],["输出",row.output_description]]}/><h3>关联数据</h3>{objects.map(value=><details key={value.data_ref}><summary>{value.data_name}</summary><Values items={[["数据操作",value.behavior_links.filter(link=>link.behavior_ref===row.behavior_ref).map(link=>({create:'创建',use:'使用',update:'更新'})[link.operation]||businessStatus(link.operation)).join('、')],["说明",value.description]]}/><p>字段：{(value.fields||[]).map(field=>field.field_name).join('、')||'原文未登记'}</p></details>)}{!objects.length&&<p>原文未登记关联数据。</p>}</>}
      {category==='data_objects'&&<><Values items={[["说明",row.description]]}/><h3>字段</h3>{(row.fields||[]).map(field=><div className="review-field" key={field.field_ref}><strong>{field.field_name}</strong><Values items={[["定义",field.definition],["类型",businessStatus(field.field_type)]]}/></div>)}</>}
      {category==='forms'&&<><Values items={[["表单编号",row.form_no],["说明",row.description]]}/>{(row.areas||[]).map(area=><section key={area.area_ref}><h3>{area.area_title||businessStatus(area.area_type,'表单区域')}</h3>{(area.items||[]).map(item=><div className="review-field" key={item.item_ref}><strong>{item.item_name}</strong><Values items={[["必填",item.required],["填写说明",item.instructions]]}/></div>)}</section>)}</>}
      {category==='terms'&&<Values items={[["定义",row.definition],["说明",row.notes]]}/>}
      <details><summary>查看所选内容的完整说明</summary><BusinessDetails value={row}/></details>
    </>:<p>原文未登记此类内容。</p>}</article>
  </section>;
}
