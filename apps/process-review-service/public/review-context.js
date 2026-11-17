import {escape as e,button as b,heading,empty,array} from './ui.js';
import {scopedMaterials,materialSource} from './material-scope.js';
const operation={create:'创建',use:'使用',update:'更新',retire:'停用',read:'读取',delete:'删除'};
const matrixLink=id=>`http://${globalThis.location?.hostname||'127.0.0.1'}:9992/matrix?field=${encodeURIComponent(id)}`;
const availability={process_start:'流程开始时提供',at_behavior:'在指定步骤提供',pending_confirmation:'提供时点待确认'};

function renderDeclaredLinks(document,ctx){
  const objects=array(document?.data_objects),links=[];
  array(document?.forms).forEach((form,fi)=>array(form.areas).forEach((area,ai)=>array(area.items).forEach((item,ii)=>{
    if(!item.data_field_ref)return;
    const candidates=objects.filter(data=>!item.business_data_ref||data.data_ref===item.business_data_ref)
      .flatMap(data=>array(data.fields).filter(field=>field.field_ref===item.data_field_ref).map(field=>`${data.data_name} / ${field.field_name}`));
    const target=candidates.length===1?candidates[0]:`引用未唯一定位：${item.business_data_ref||''} / ${item.data_field_ref}`;
    links.push(`<li>${e(form.form_name)} ／ ${e(area.area_title||area.area_name||'未命名区域')} ／ ${e(item.item_name)} → ${e(target)}<p class="subtle-text">/forms/${fi}/areas/${ai}/items/${ii}/data_field_ref · 字段引用声明，实际使用待核对。</p></li>`);
  })));
  return `<details class="disclosure"><summary>JSON声明的字段来源（${ctx.origins.length}）</summary><p>取值依赖与核验参考分别核对；材料声明不代表已发生复制或写入。</p><ul>${ctx.origins.map(x=>{
    const source=x.source||{},name=[source.source_system_name,x.sourceLocalName||source.source_data_name||source.source_data_ref].filter(Boolean).join(' / ')||'来源待核对';
    return `<li><strong>${e(name)} → ${e(x.targetDataName)} / ${e(x.targetFieldName)}</strong><p>${e(x.relation)}；${e(x.status)}</p><small>${e(x.evidence.pointer)}</small></li>`;
  }).join('')||'<li>本材料未声明字段来源链接。</li>'}</ul></details>`+
  `<details class="disclosure"><summary>表单项与数据字段引用（${links.length}）</summary><ul>${links.join('')||'<li>本材料未列出表单项的字段引用。</li>'}</ul></details>`;
}

export function renderContextPage(c){
  const evidence=c.state.reviewContext,available=scopedMaterials(c.state);
  const context=evidence?{...evidence,processModels:available.length,processes:available.map(material=>{const prior=evidence.processes.find(item=>item.sha256===material.sha256);return {...prior,materialId:material.id,sha256:material.sha256,processName:material.name,sourceFile:materialSource(material),department:material.sourceDepartment,scope:'week19',objects:prior?.objects??null,offlineMatches:prior?.offlineMatches??null,derivedTemplates:prior?.derivedTemplates??null,fieldMappings:prior?.fieldMappings??null,physicalColumns:prior?.physicalColumns??null};})}:null;
  if(!context)return heading('数据血缘评审','流程动作、线下原表与系统表字段共同核对。')+empty('尚未加载本轮评审材料');
  const f=c.filters.lineage,department=f.department||'',query=f.query.toLowerCase();
  const rows=context.processes.filter(p=>(!department||p.department===department)&&(!query||`${p.processName} ${p.sourceFile}`.toLowerCase().includes(query)));
  return heading('数据血缘评审','先核对数据怎样产生、引用、计算和传递；术语治理后置。')+
    `<section class="panel"><div class="panel-body"><p>本轮 ${context.processModels} 份流程模型；历史快照单独查看，原有血缘线索继续保留。</p><p>线下表单与用友、勤哲、KFU8QZ并列为数据来源，按表、字段进入同一数据矩阵。候选对应不代表实际同步。</p><details class="disclosure"><summary>材料范围与待核对事项</summary><ul>${context.warnings.map(x=>`<li>${e(x)}</li>`).join('')}</ul></details></div></section>`+
    `<div class="toolbar section-spacer"><input type="search" data-filter="lineage.query" aria-label="搜索血缘评审流程" placeholder="搜索流程或提交文件" value="${e(f.query)}"><select data-filter="lineage.department" aria-label="筛选血缘提交部门"><option value="">全部提交部门</option>${[...new Set(context.processes.map(p=>p.department))].map(d=>`<option ${d===department?'selected':''} value="${e(d)}">${e(d)}</option>`).join('')}</select><span data-filter-region="count">${rows.length} 份材料</span></div>`+
    `<section class="panel" data-filter-region="results"><div class="table-wrap"><table class="data-table"><thead><tr><th>流程材料与来源</th><th>数据对象</th><th>线下原表线索</th><th>系统字段候选</th><th>评审入口</th></tr></thead><tbody>${rows.map(p=>{
      const material=c.state.materials.find(m=>m.id===p.materialId);
      return `<tr><td><strong>${e(p.processName)}</strong><p>${e(p.department)} · ${p.scope==='week19'?'本轮材料':'第16周追溯材料'}</p><span class="file-path">${e(p.sourceFile)}</span></td><td>${p.objects??'待补证据'}</td><td>${p.offlineMatches===null?'暂无匹配的补充证据':`${p.offlineMatches} 项载体候选；${p.derivedTemplates} 项模板派生对应`}</td><td>${p.fieldMappings===null?'暂无匹配的补充证据':`${p.fieldMappings} 条字段对应；${p.physicalColumns} 处物理字段名声明`}</td><td>${material?b('进入血缘走查','open-lineage-material',material.id,{small:true}):'材料尚未导入'}</td></tr>`;
    }).join('')}</tbody></table></div></section><section class="panel section-spacer"><header class="panel-header"><h2>同批补充评审材料</h2></header><div class="panel-body"><p>保留方案和数据评阅记录的原文，按补充材料讨论；不把它们转换成流程或有效版本。</p>${array(context.supportingMaterials).map(p=>`<p><strong>${e(p.kind)}</strong> · ${e(p.department)}<br>${e(p.sourceFile)}<br><a href="/api/review-support/${p.sha256}" download>下载原始JSON ↗</a></p>`).join('')}</div></section>`;
}

export function renderMaterialContext(c){
  const material=c.documents.get(c.view.materialId),ctx=material?.reviewContext;
  if(!ctx)return empty('本材料尚无本轮血缘补充证据','原数据与表单、意见和历史修订仍按本材料保留；不按同名流程套用其他快照。');
  const mapping=ctx.fieldMappings.map(x=>`<li>${e(x.offlineFile)} · ${e(x.offlineField)}（${e(x.offlinePositions.join('、'))}）<br><a href="${matrixLink(x.physicalFieldId)}" target="_blank" rel="noopener">${e(x.system+' / '+x.table+'.'+x.physicalColumn)} ↗</a><p class="subtle-text">字段对应候选；核对取值方向、关联键和时点。</p></li>`).join('');
  return `<section class="lineage-review-context"><h3>本流程数据血缘议题</h3><p class="subtle-text">${ctx.scope==='week19'?'第19周新增材料':'第16周追溯材料'} · 按本文件摘要定位，尚未认定有效版本。</p><ol>${ctx.questions.map(q=>`<li>${e(q)}</li>`).join('')}</ol>`+
    `${ctx.negativeStatements.length?`<div class="muted-block">${ctx.negativeStatements.map(x=>`<p>${e(x)}</p>`).join('')}</div>`:''}`+
    renderDeclaredLinks(material.document,ctx)+
    `<details class="disclosure" ${mapping?'open':''}><summary>线下、JSON与系统字段对应候选（${ctx.fieldMappings.length}）</summary><ul>${mapping||'<li>尚未定位三层字段对应，需核对具体原表、系统表与关联键。</li>'}</ul></details>`+
    `<details class="disclosure"><summary>线下原表与模板来源（${ctx.offlineMatches.length+ctx.derivedTemplates.length}）</summary><ul>${ctx.offlineMatches.map(x=>`<li>${e(x.form)} · ${e(x.offlineFile)} ／ ${e(x.offlinePart)}<p class="subtle-text">${e(x.matchBasis)}；属于载体对应候选。</p></li>`).join('')}${ctx.derivedTemplates.map(x=>`<li>${e(x.offlineFile)}<p>相同数据对象标识，${x.matchedFields.length} 个字段名对应。表单自述来源为流程JSON，需另核对实际业务流转。</p></li>`).join('')||'<li>本轮未匹配到指定目录中的原表。</li>'}</ul></details>`+
    `<details class="disclosure"><summary>JSON中的物理字段名声明（${ctx.physicalColumns.length}）</summary>${ctx.physicalColumns.map(x=>`<p>${e(x.snippet)}<br><small>${e(x.evidence.pointer)} · 材料声明，实际取数待核对。</small></p>`).join('')||'<p>尚无可精确定位的物理字段名。</p>'}</details>`+
    `<h4>逐数据对象核对</h4>${ctx.topics.map(t=>`<details class="walk-data-record"><summary>${e(t.name)} · ${t.fieldCount} 个字段</summary><div class="walk-data-record-body"><p>字段：${t.fields.map(x=>e(x.name)).join('、')||'未列明'}</p><p>材料声明的动作：</p><ul>${t.actions.map(a=>`<li>${e(a.behavior)} · ${e(operation[a.operation]||a.operation)}</li>`).join('')||'<li>尚未关联流程动作</li>'}</ul><p>材料声明的对象来源：</p><ul>${array(t.sourceRelations).map(r=>`<li>${[r.source_department,r.source_process_name,r.source_behavior_name,r.source_data_name].filter(Boolean).map(e).join(' ／ ')}<p class="subtle-text">${e(availability[r.availability_mode]||r.availability_mode||'提供时点待核对')}${r.available_from_behavior_ref?` · 步骤引用：${e(r.available_from_behavior_ref)}`:''}</p></li>`).join('')||'<li>未声明对象来源，需核对实际产生或取得方式。</li>'}</ul><p class="subtle-text">${e(t.pointer)}；创建／使用／更新是流程声明，需核对实际载体和取值。</p></div></details>`).join('')}</section>`;
}
