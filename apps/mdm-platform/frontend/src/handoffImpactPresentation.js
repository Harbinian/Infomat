import {businessName,businessText} from './businessPresentation.js';

const kinds={object:'对象',field:'字段',data_element:'数据项定义',context:'数据使用范围',rule:'数据使用规则',authority:'数据来源认定'};
const references={definition_identifier:'对象标识',definition_parent:'字段归属',field_element_binding:'字段与数据项',prior_package_publication:'本工作包已有发布',publication_item:'已发布条目',source_mapping:'模板来源对应',mapping_version:'固定来源映射',design_handoff:'设计交接',analysis_input:'分析材料引用'};
const exact=(left,right)=>left!=null&&right!=null&&String(left)===String(right);

// Names come from the exact fixed publication/version, never the current object or key spelling.
export function handoffImpactChoices(impacts=[],publications=[]) {
  const items=publications.flatMap(publication=>(publication.manifest?.items||[]).map(item=>({publication,item})));
  const versionName=(kind,id)=>{
    const names=[...new Set(items.filter(({item})=>item.target_kind===kind&&exact(item.target_version_ref,id)).map(({item})=>businessName(item.payload?.definition,'历史名称未记录')))];
    return names.length===1?names[0]:'历史名称未记录';
  };
  const choices=[];
  for(const row of impacts) {
    if(!row.reference_key||row.reference_kind==='schema_not_installed')continue;
    let name;
    if(row.reference_kind==='definition_identifier')name=versionName(row.entity_type||'object',row.definition_version_id)+' / '+versionName('field',row.field_version_id);
    else if(row.reference_kind==='definition_parent')name=versionName(row.entity_type||'field',row.definition_version_id)+' → '+versionName('object',row.object_version_id);
    else if(row.reference_kind==='field_element_binding')name=versionName('field',row.field_version_id)+' → '+versionName('data_element',row.element_version_id)+'（'+versionName('context',row.context_version_ref)+'）';
    else if(row.reference_kind==='publication_item'){
      const fixed=items.filter(({publication,item})=>exact(publication.publication_id,row.publication_id)&&exact(item.item_ref,row.item_ref));
      name=(kinds[row.target_kind]||'发布内容')+'：'+(fixed.length===1?businessName(fixed[0].item.payload?.definition,'历史名称未记录'):'历史名称未记录');
    } else if(row.reference_kind==='prior_package_publication'){
      const publication=publications.find(publication=>exact(publication.publication_id,row.publication_id));
      name=publication?(publication.manifest?.items||[]).map(item=>businessName(item.payload?.definition,'历史名称未记录')).join('、')||'历史名称未记录':'历史名称未记录';
    } else name=businessName(row,'历史引用材料名称未记录');
    choices.push({value:String(row.reference_key),name:(references[row.reference_kind]||'已有引用')+' · '+businessText(name,'历史名称未记录')});
  }
  return choices;
}
