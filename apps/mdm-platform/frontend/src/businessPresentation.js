// Presentation-only projections never change stored identifiers or request payloads.
const technicalToken = /(?:\/api(?:\/|\b)|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{40,}\b|\b[A-Z][A-Z0-9]+(?:_[A-Z0-9]+){1,}\b|\b(?:governance|identity|directory|process):[a-z-]+\b|\b(?:process-governance|document-structured-output|handoff-draft)-v\d+\b|\b(?:person|department|process|field|term|handoff|binding|request|revision|schema|permission)_[a-z_]+\b|\b(?:GET|POST|PATCH|PUT|DELETE)\s+\/|<\/?(?:script|html|div)\b|\b(?:SELECT|INSERT|UPDATE|DELETE)\s+\w+\s+(?:FROM|INTO|SET)\b)/i;
export function businessText(value, fallback = '相关内容暂无法展示，请联系维护人员核对。') {
  if (value == null || value === '') return '未记录';
  if (typeof value === 'boolean') return value ? '是' : '否';
  const text = String(value);
  const sourceLike=/<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?\s*>|\bfunction\s+[a-z_$][\w$]*\s*\(|=>|^\s*=[A-Z][\w.]*\s*\(/i.test(text);
  const internalLocation = /(?:^|\s)\/(?:data_objects|behaviors|forms|flow_relations|export_meta|terms)(?:\/|$)/.test(text);
  const internalSource = /\bauthoring-workspace\.json\b/.test(text);
  const internalReference = /\b(?:object|field|context|data_element|rule|authority|flow|lifecycle):[a-z0-9_.:-]+/i.test(text);
  return technicalToken.test(text) || sourceLike || internalLocation || internalSource || internalReference || /^\s*[\[{][\s\S]*[\]}]\s*$/.test(text) ? fallback : text;
}
export function userMessage(value, fallback = '本次操作结果暂未确认，请查看最新记录。填写的内容仍保留。') {
  const message = value?.serverMessage || value?.message || value;
  return typeof message === 'string' && /[\p{Script=Han}]/u.test(message) ? businessText(message, fallback) : fallback;
}
export function businessEvidence(value){
  if(Array.isArray(value))return value.map(businessEvidence).join('；');
  if(value==null||value==='')return '证据位置未记录';
  return /^\d+$/.test(String(value))?'证据位置尚未提供可读说明':businessText(value,'证据位置尚未提供可读说明，请核对来源材料。');
}
export function businessFileName(name,fallback,extension){return businessText(name||fallback,fallback).replace(/[\\/:*?"<>|]/g,'_')+'.'+extension;}
export function businessMaterialSource(value) {
  if (value === 'authoring-workspace.json') return '在3000编制并提交的流程材料';
  return value ? businessText(value, '原材料名称未记录') : '原材料名称未记录';
}
export function businessName(record, fallback = '名称未记录') {
  if (!record || typeof record !== 'object') return fallback;
  const value = record.process_name || record.process?.process_name || record.document?.process?.process_name || record.document_title || record.definition?.name || record.definition?.label || record.person_name || record.department_name || record.term || record.term_name || record.field_name_cn || record.object_name || record.field_name || record.data_name || record.behavior_name || record.subject_name || record.name || record.title || record.candidate_name || record.snapshot_json?.candidate_name || record.snapshot_json?.data_name || record.snapshot_json?.name || record.question_text || record.question;
  return value ? businessText(value, fallback) : fallback;
}
export function businessChoice(record, fallback) {
  const name = businessName(record, fallback);
  const scope = record?.department_name || record?.dept_name || record?.owning_department_name;
  const time = record?.updated_at || record?.created_at || record?.published_at;
  return [name, scope, time].filter(Boolean).map(value => businessText(value)).join(' · ');
}
const states = {
  active:'有效',inactive:'已停用',disabled:'未开启',enabled:'已开启',locked:'已锁定',pending_activation:'待启用',revoked:'已撤销',archived:'已归档',leave:'离职',suspended:'已暂停',
  draft:'草稿',submitted:'已提交',under_review:'审核中',approved:'已通过',rejected:'已拒绝',published:'已发布',superseded:'已被新版替代',withdrawn:'已撤回',needs_changes:'需要修改',pending:'待核对',confirmed:'已确认',not_applicable:'不适用',terminated:'已终止',completed:'已完成',closed:'已关闭',open:'待办理',cancelled:'已取消',answered:'已答复，待核对',
  current:'现行范围',historical:'历史范围',read_only:'只读',available:'可办理',not_prepared:'尚未准备',maintenance:'维护中',controlled:'已启用受控办理',legacy:'历史记录',
  create:'新建',modify:'修改',reuse:'沿用已有版本',update:'更新',use:'使用',delete:'删除',read:'查阅',approve:'批准',publish:'发布',save:'保存',submit:'提交',recheck:'重新核对',
  pass:'通过',blocked:'需先解决问题',error:'异常',warning:'需关注',warn:'需关注',ok:'正常',unchecked:'未检查',high:'高',medium:'中',low:'低',ordinary:'普通',major:'重大',
  coordinating:'协调中',escalated:'已升级处理',resolved:'已形成处理结果',verified:'已核验',disputed:'存在分歧',pending_evidence:'待补依据',needs_business_fact:'待补充业务事实',prepared:'已准备，待核验',
  mdm_preparing:'待MDM准备',mdm_governing:'MDM治理中',waiting_business_fact:'待部门补充事实',mdm_review:'待MDM审核',source_withdrawn:'来源已撤回',
  governed:'当前流程版本已完成数据地图发布',source_upgrade_pending:'新版流程的数据治理尚未完成',requires_attention:'已有数据地图内容需要核对',
  process_draft:'流程草稿',process_version:'已发布流程',data_definition:'数据定义',work_package:'数据治理工作包',handoff_revision:'数据地图草稿',
  object:'数据对象',field:'字段',data_element:'数据项定义',context:'数据使用范围',rule:'数据使用规则',authority:'数据来源认定',
  string:'文本',number:'数字',integer:'整数',boolean:'是或否',date:'日期',datetime:'日期时间',text:'文本',single:'单字段识别',composite:'多个字段共同识别',
  global:'全公司范围',department:'部门范围',allow:'允许',deny:'不允许',direct:'直接授权',inherited:'历史继承',
  action:'办理环节',sequence:'依次办理',conditional:'按条件办理',parallel:'并行办理',return:'退回前一环节',decision:'判断环节',
  single_instance:'单条业务记录',record_collection:'业务记录集合',new_instance:'本次新建的记录',current_instance:'当前记录',prior_records:'已有历史记录',collection_metadata:'整组记录的说明',
  if_exists:'已有记录时办理',required:'必须有记录',unknown:'尚未明确',not_declared:'未说明',not_required:'无此要求',independent:'独立填写',data_field:'引用对象字段',
};
export function businessStatus(value, fallback = '状态待核对') {
  if (value == null || value === '') return '未记录';
  if (states[value]) return states[value];
  return /[\p{Script=Han}]/u.test(String(value)) ? businessText(value, fallback) : fallback;
}
const labels = {
  normalized_value:'单元格内容',formatted_value:'显示内容',cached_value:'公式保存的结果',cell_address:'单元格位置',address:'单元格位置',sheet_name:'工作表',original_column:'原列名',source_row:'原行位置',
  process:'流程',process_name:'流程名称',document_title:'制度名称',document_no:'制度编号',form_no:'表单编号',employee_no:'工号',name:'名称',title:'标题',label:'名称',definition:'定义',description:'说明',business_meaning:'业务含义',notes:'备注',note:'说明',reason:'原因',basis:'依据',basis_text:'依据',conclusion:'结论',decision:'决定',status:'状态',state:'状态',scope_mode:'适用范围',scope:'适用范围',purpose:'使用目的',responsibilities:'责任说明',
  behaviors:'流程环节',behavior_name:'环节名称',behavior_description:'环节说明',current_actor_role:'执行角色',trigger:'触发条件',precondition:'前置条件',input_description:'输入',output_description:'输出',completion_standard:'完成标准',data_objects:'数据对象',data_name:'对象名称',fields:'字段',field_name:'字段名称',field_name_cn:'字段名称',field_type:'字段类型',data_type:'数据类型',data_format:'数据格式',length_precision:'长度与精度',required:'是否必填',enum_values:'允许填写的值',forms:'表单或记录',form_name:'表单名称',areas:'表单区域',area_title:'区域名称',area_type:'区域类型',items:'内容',item_name:'填写项',instructions:'填写说明',terms:'术语',term_name:'术语名称',term:'术语',
  created_at:'记录时间',updated_at:'保存时间',published_at:'发布时间',submitted_at:'提交时间',registered_at:'登记时间',decided_at:'确认时间',reviewed_at:'核对时间',started_at:'编制开始时间',completed_at:'完成时间',answered_at:'答复时间',closed_at:'关闭时间',content_updated_at:'正文保存时间',effective_from:'生效日期',effective_to:'失效日期',due_at:'截止时间',due_date:'截止日期',person_name:'姓名',actor_name:'办理人',department_name:'部门',owning_department_name:'归口部门',dept_name:'部门',actor:'办理信息',approval_actor:'批准人信息',
  evidence:'来源依据',evidence_refs:'证据位置',source_location:'来源位置',source_file_name:'来源文件',file_name:'文件名',original_name:'原文件名',locator:'原文位置',excerpt:'原文摘录',text:'原文内容',content:'内容',values:'原文内容',value:'取值',unit:'单位',format:'格式',operation:'操作',operations:'使用方式',stage:'使用阶段',category:'分类',sensitivity:'敏感等级',masking:'脱敏要求',manager_department_name:'维护部门',sor_system_name:'以哪个系统的记录为准',authority:'数据来源依据',
  recommendations:'处理建议',suggestions:'处理建议',issues:'需要处理的问题',message:'提示',problem:'具体问题',revision_request:'修改要求',change_summary:'本次变化',revision_reason:'修改原因',proposals:'可选方案',difference:'差异',impact:'影响',outcome:'处理结果',resolution:'处理结果',answer_text:'答复',question_text:'需要核实的问题',answer:'答复',question:'需要核实的问题',delivery_condition:'交付条件',reception_requirement:'接收要求',governance:'治理结论',payload:'记录内容',snapshot_json:'记录内容',document:'流程内容',summary:'概况',counts:'数量',comparison_complete:'对照是否完整',comparability_reasons:'对照说明',coverage:'检查覆盖',rules:'使用规则',lifecycle_rule:'数据使用规则',unique_identifiers:'如何识别同一条记录',kind:'类别',
  flow_relations:'环节之间的办理关系',node_type:'环节类型',actor_assignment_mode:'执行岗位的确定方式',actor_position_rule:'岗位确定条件',timing:'办理时限',countersign_all_required:'是否须全部会签',countersign_target_departments:'会签部门',relation_type:'办理关系类型',condition:'办理条件',record_scope:'涉及哪些记录',presence:'记录存在要求',source_department:'来源部门',source_process_name:'来源流程',source_behavior_name:'来源环节',source_data_name:'来源数据对象',availability_mode:'何时可以使用',information_type:'信息类别',behavior_links:'数据在哪些环节使用',source_relations:'外部数据来源',lifecycle:'数据产生与使用规则',record_model:'记录组织方式',business_validity:'记录何时有效',custody:'记录由谁保管',identifiability_applicability:'是否需要识别记录',identifiability:'如何识别记录',mode:'办理方式',operator:'判断方式',expression:'判断条件',department:'部门',position:'岗位',source_type:'来源类别',action:'办理动作',result_state:'办理后的状态',target_scope:'适用记录范围',carrier_scope:'涉及的表单范围',responsibility:'责任说明',exception_handling:'异常处理',review_status:'核对状态',high_risk:'是否高风险',decision_reason:'判断依据',decision_notes:'判断说明',provenance:'依据来源',route_label:'办理路线',events:'数据使用事项',exit_state:'结束状态',applicability:'适用条件',entry_state:'开始状态',routes:'办理路线',analysis:'检查说明',source_system_name:'来源系统',source_role:'来源角色',item_type:'填写项类型',value_usage_mode:'填写值如何使用',value_origin_mode:'填写值从哪里取得',source_links:'相关来源',form_design_state:'表单编制状态',source_handoff:'数据交接来源',conversion_status:'历史内容处理情况',conversion_reason:'历史内容处理依据',original_behavior_name:'原环节名称',work_role:'工作角色',raw_actor_role:'原执行角色说明',original_actor_assignment_mode:'原岗位确定方式',original_join_mode:'原会合方式',source_process_count:'来源流程数量',legacy_cross_department_records:'历史跨部门说明',reference_materials:'参考材料',internal_process_calls:'相关流程调用说明',work_roles:'历史责任说明',unresolved_actor_roles:'待明确的执行角色',unresolved_join_modes:'待明确的会合方式',owning_department:'归口部门',capability_domain:'能力领域',business_capability:'业务能力',classification_status:'分类核对状态',
};
const protectedBusinessKeys = new Set(['document_no','form_no','employee_no','evidence_refs','snapshot_json']);
export function internalField(key) {
  if (protectedBusinessKeys.has(key)) return false;
  return /(?:^|_)(?:id|ids|ref|refs|hash|digest|revision|schema|token|uuid|code|pointer|manifest|request|checksum)(?:_|$)|^(?:revision_no|version_no|event_no|edition_id|path|source_path|xml_path|part|parent_anchor|anchor_id|role_codes|permissions|auth_version|write_token|analyzer_version|source_fingerprint|export_meta)$/.test(key);
}
export const businessFieldLabel = key => labels[key] || (/^[\p{Script=Han}\s，、（）]+$/u.test(key)?key:'');
export function businessLocation(path, document) {
  if (!path) return '位置未记录';
  const names=[];
  for (const part of String(path).replaceAll('/','.').replaceAll('[','.').replaceAll(']','').split('.').filter(Boolean)) {
    if (/^\d+$/.test(part)) continue;
    const label=labels[part];if(label&&!names.includes(label))names.push(label);
  }
  return names.join(' → ') || '相关内容（请查看流程正文）';
}
// Labels come from authorized fixed records, never from an identifier's spelling or order.
export function publicationChoices(publications) {
  const objects=[],fields=[],versions=[];
  const seen=new Set();
  for(const publication of publications||[])for(const item of publication?.manifest?.items||[]){
    const key=item.target_kind+':'+item.target_id+':'+item.target_version_ref;
    if(seen.has(key))continue;seen.add(key);
    const name=businessName(item.payload?.definition,'名称未记录');
    const row={value:String(item.target_id),name,kind:item.target_kind,definition:item.payload?.definition};
    (item.target_kind==='field'?fields:objects).push(row);
    versions.push({...row,value:item.target_version_ref});
  }
  return {objects,fields,versions,fieldVersions:versions.filter(row=>row.kind==='field')};
}
export function withdrawalGuidance({stale,report,checkMatches,approvalMatches}){
  if(stale)return '这条发布记录的状态已变化，当前无法继续撤回。请重新打开记录核对当前状态。填写的内容仍保留。';
  if(!report)return '请填写撤回原因，然后点击“检查撤回影响”。';
  if(!checkMatches)return '撤回原因已修改，请重新点击“检查撤回影响”，核对结果后再批准本次整单撤回。';
  if(!approvalMatches)return '请核对撤回影响，填写“批准依据及影响核对说明”，然后点击“批准本次整单撤回”。批准成功后，才能执行撤回。';
  return '本次整单撤回已获批准，可以执行撤回。若原因或检查内容变化，须重新检查并批准。';
}
