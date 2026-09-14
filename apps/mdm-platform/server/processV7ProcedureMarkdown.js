// Read-only projection of an immutable V7 version. No draft lookup, inference,
// persistence, or conversion to an older process schema.
const labels = {
  action:'业务行为', decision:'条件判断', parallel_split:'并行分支', parallel_join:'并行汇合',
  fixed_department:'固定部门', company_wide:'全公司', dynamic_from_data:'由业务数据确定部门',
  sequence:'顺序', condition:'条件分支', loop:'循环', parallel:'并行',
  pending_confirmation:'待确认', unspecified:'未说明', current_state:'现状', proposed_design:'拟设计',
  create:'创建', update:'更新', use:'使用', fill:'填写', modify:'修改', review:'审核', approve:'批准', confirm:'确认', read:'读取', archive:'归档', void:'作废',
  authoritative_input:'本流程权威录入点', reuse_existing:'复用已有值', calculated:'计算得到', external_source:'外部来源',
  direct_current_process:'本流程直接形成', depends_on_data:'依赖已有数据', process_data:'流程数据', external_system:'外部系统',
  provides_value:'提供字段值', calculation_input:'计算输入', validation_basis:'校验依据',
  business_information:'业务信息', business_conclusion:'业务结论', business_status:'业务状态', identifier:'标识', file_attachment:'文件附件', other_information_output:'其他信息输出',
  process_start:'流程开始时', at_behavior:'指定业务行为发生时', applicable:'适用', not_applicable:'不适用',
  not_effective:'未生效', effective:'生效', deactivated:'停用', voided:'作废', expired:'到期', active_custody:'正在使用中保管', archived:'已归档', destroyed:'已销毁',
  identifiable:'可识别', irreversibly_anonymized:'不可逆匿名化', behavior:'业务行为', time_period:'时间条件', business_condition:'业务条件', external_process_notice:'外部流程通知',
  single:'单一条件', and:'同时满足', or:'任一满足', inherit_behavior:'继承关联业务行为', explicit:'明确指定',
  activate:'生效', deactivate:'停用', reactivate:'恢复生效', expire:'到期', restore_active_custody:'恢复在用保管', destroy:'销毁', irreversible_anonymize:'不可逆匿名化',
  record:'记录', version:'版本', batch:'批次', all_records:'全部记录', paper_original:'纸质原件', electronic_original:'电子原件', business_copy:'业务副本', paper_and_electronic:'纸质及电子',
  auto_generated:'系统建议', confirmed:'已确认', needs_recheck:'需重新核对', rejected:'已拒绝',
  published:'已发布', superseded:'已被后续版本替代', unclassified:'未分类', needs_review:'待核对'
};
function escapeMarkdown(value) {
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g,'\\$&').replace(/\r\n?/g,'\n').replace(/\n/g,'  \n');
}
function processV7ProcedureMarkdown(version) {
  const document=version.document;
  if (version.schema_version!=='process-governance-v7' || document?.schema_version!=='process-governance-v7') throw new Error('PROCEDURE_V7_REQUIRED');
  const list=value=>Array.isArray(value)?value:[];
  const names=new Map();
  const register=(items,key,name)=>list(items).forEach(item=>{if(item[key])names.set(item[key],item[name]||item[key]);});
  register(document.behaviors,'behavior_ref','behavior_name'); register(document.data_objects,'data_ref','data_name'); register(document.forms,'form_ref','form_name');
  list(document.data_objects).forEach(item=>register(item.fields,'field_ref','field_name'));
  const format=(value,enumValue=false)=>{
    if(value===null||value===undefined||value==='')return '未填写';
    if(value instanceof Date)return escapeMarkdown(value.toISOString());
    if(Array.isArray(value))return value.length?value.map(v=>format(v,enumValue)).join('；'):'未记录';
    if(typeof value==='boolean')return value?'是':'否';
    if(enumValue && labels[value])return labels[value];
    if(names.has(value))return escapeMarkdown(names.get(value))+'（'+escapeMarkdown(value)+'）';
    return escapeMarkdown(value);
  };
  const lines=[];
  const title=version.document_title||document.process?.process_name||'流程程序文件';
  const heading=(level,value)=>lines.push('#'.repeat(level)+' '+escapeMarkdown(value),'');
  const fields=(object,definitions)=>{for(const [key,label,enumValue] of definitions)lines.push('- '+label+'：'+format(object?.[key],enumValue));lines.push('');};
  const section=(title,items,render)=>{heading(2,title);if(!list(items).length)lines.push('正式版本未记录。','');else list(items).forEach(render);};
  heading(1,title);
  fields(version,[['document_no','文件编号'],['edition','版次'],['process_version_id','正式版本标识'],['version_no','正式版本号'],['status','版本状态',true],['published_at','发布时间'],['content_hash','来源内容摘要']]);
  heading(2,'目的与范围');fields(document.process,[['purpose','目的'],['scope','范围'],['owning_department','归口部门'],['process_ref','流程标识'],['capability_domain','能力域'],['business_capability','业务能力'],['classification_status','分类状态',true]]);
  section('术语',document.terms,(term,index)=>{heading(3,term.term_name||term.name||'术语 '+(index+1));fields(term,[['definition','定义']]);});
  section('业务行为',document.behaviors,(behavior,index)=>{
    heading(3,(index+1)+'. '+(behavior.behavior_name||'未命名业务行为'));
    fields(behavior,[['behavior_ref','行为标识'],['node_type','节点类型',true],['behavior_description','操作说明'],['current_actor_role','执行角色'],['actor_assignment_mode','部门确定方式',true],['actor_department_data_ref','部门来源数据'],['actor_position_rule','岗位确定规则'],['trigger','触发条件'],['precondition','前置条件'],['input_description','输入'],['timing','办理时机'],['completion_standard','完成标准'],['output_description','输出'],['countersign_all_required','是否要求全部会签'],['countersign_target_departments','会签部门']]);
  });
  section('流程关系',document.flow_relations,(relation,index)=>{
    heading(3,'关系 '+(index+1));fields(relation,[['relation_ref','关系标识'],['relation_type','关系类型',true],['from_behavior_ref','前序行为'],['to_behavior_ref','后续行为'],['condition','流转条件']]);
  });
  const stateFields=[['business_validity','业务有效性',true],['custody','保管状态',true],['identifiability_applicability','可识别性是否适用',true],['identifiability','可识别状态',true]];
  section('业务数据与生命周期',document.data_objects,(data,index)=>{
    heading(3,data.data_name||'业务数据 '+(index+1));fields(data,[['data_ref','数据标识'],['description','说明'],['information_type','信息类型',true]]);
    for(const field of list(data.fields)){heading(4,field.field_name||'数据字段');fields(field,[['field_ref','字段标识'],['field_type','字段类型'],['definition','定义']]);}
    for(const link of list(data.behavior_links))fields(link,[['behavior_ref','关联行为'],['operation','数据操作',true],['updated_field_refs','更新字段']]);
    for(const source of list(data.source_relations))fields(source,[['source_department','来源部门'],['source_process_name','来源流程'],['source_behavior_name','来源行为'],['source_data_name','来源数据'],['availability_mode','可用时机',true],['available_from_behavior_ref','开始可用的行为']]);
    const lifecycle=data.lifecycle;
    if(lifecycle){
      heading(4,'生命周期');fields(lifecycle,[['applicability','是否适用',true],['decision_notes','说明']]);
      lines.push('**进入本流程时的状态**','');fields(lifecycle.entry_state,stateFields);
      for(const route of list(lifecycle.routes)){
        heading(4,route.route_label||'生命周期路径');fields(route,[['route_ref','路径标识'],['flow_relation_refs','关联流程关系']]);
        for(const event of list(route.events)){
          lines.push('**'+format(event.action,true)+'**','');
          fields(event,[['event_ref','事件标识'],['review_status','核对状态',true],['target_scope','作用对象',true],['carrier_scope','载体范围',true],['high_risk','是否高风险'],['exception_handling','异常处理'],['decision_notes','核对说明']]);
          fields(event.trigger,[['mode','触发方式',true],['operator','条件组合',true],['behavior_ref','触发行为'],['expression','触发条件']]);
          fields(event.responsibility,[['mode','责任确定方式',true],['department','责任部门'],['position','责任岗位']]);
          fields(event.provenance,[['basis','来源依据']]);fields(event.result_state,stateFields);
        }
        lines.push('**离开该路径时的状态**','');fields(route.exit_state,stateFields);
      }
    }
  });
  section('表单与记录',document.forms,(form,index)=>{
    heading(3,form.form_name||'表单 '+(index+1));fields(form,[['form_ref','表单标识'],['form_no','表单编号'],['form_design_state','表单状态',true]]);
    for(const link of list(form.behavior_links))fields(link,[['behavior_ref','使用行为'],['operations','办理操作',true],['notes','说明']]);
    for(const area of list(form.areas)){
      heading(4,area.area_title||area.area_type||'表单区域');fields(area,[['area_ref','区域标识'],['area_type','区域类型']]);
      for(const item of list(area.items)){
        lines.push('**'+format(item.item_name)+'**','');fields(item,[['item_ref','表单项标识'],['item_type','类型'],['required','是否必填'],['instructions','填写说明'],['business_data_ref','业务数据'],['data_field_ref','数据字段'],['value_usage_mode','值使用方式',true],['value_origin_mode','值形成方式',true]]);
        for(const source of list(item.source_links))fields(source,[['source_type','来源类型',true],['source_data_ref','来源数据'],['source_system_name','来源系统'],['source_data_name','来源数据名称'],['source_role','来源用途',true]]);
      }
    }
  });
  return lines.join('\n').trimEnd()+'\n';
}
module.exports={processV7ProcedureMarkdown};
