export const clone = value => value == null ? value : JSON.parse(JSON.stringify(value));
const array = value => Array.isArray(value) ? value : [];
export const normalizeKind = kind => ({ area: 'form-area', field: 'data-field', item: 'form-item', 'form-field': 'form-item', flow_relation: 'relation' }[kind] || kind);
export const readPath = (entity, key) => key.split('.').reduce((value, segment) => value?.[segment], entity);
export function writePath(entity, key, value) {
  const parts = key.split('.'); let cursor = entity;
  parts.slice(0, -1).forEach(part => { cursor = cursor[part] ||= {}; });
  cursor[parts.at(-1)] = clone(value);
}
export const KIND_LABELS = { process: '流程', behavior: '环节', data: '数据对象', 'data-field': '对象字段', form: '表单／记录', 'form-area': '表单区域', 'form-item': '表单字段', term: '术语', relation: '环节流转', 'data-link': '数据与环节关系', 'data-source': '数据来源', 'form-link': '表单与环节关系', 'field-source': '字段取值来源', 'lifecycle-route': '生命周期路径', 'lifecycle-event': '生命周期事件' };
export function catalog(document) {
  const entries = [];
  function add(kind, entity, refKey, labelKey, path, collection = null, parent = null, parentRef = '', extra = {}) {
    if (!entity) return;
    entries.push({ kind, ref: entity[refKey], parentRef, label: entity[labelKey] || KIND_LABELS[kind], path, entity, collection, parent, refKey, ...extra });
  }
  add('process', document?.process, 'process_ref', 'process_name', '/process');
  array(document?.behaviors).forEach((entity, i) => add('behavior', entity, 'behavior_ref', 'behavior_name', `/behaviors/${i}`, document.behaviors));
  array(document?.flow_relations).forEach((entity, i) => add('relation', entity, 'relation_ref', 'condition', `/flow_relations/${i}`, document.flow_relations));
  array(document?.terms).forEach((entity, i) => add('term', entity, 'term_ref', 'term_name', `/terms/${i}`, document.terms));
  array(document?.data_objects).forEach((data, i) => {
    const path = `/data_objects/${i}`, ref = data.data_ref;
    add('data', data, 'data_ref', 'data_name', path, document.data_objects);
    for (const [key, kind, refKey, label] of [['fields','data-field','field_ref','field_name'], ['behavior_links','data-link','link_ref','operation'], ['source_relations','data-source','source_ref','source_data_name']]) {
      array(data[key]).forEach((entity, j) => add(kind, entity, refKey, label, `${path}/${key}/${j}`, data[key], data, ref, { dataRef: ref }));
    }
    array(data.lifecycle?.routes).forEach((route, j) => {
      const routePath = `${path}/lifecycle/routes/${j}`;
      add('lifecycle-route', route, 'route_ref', 'route_label', routePath, data.lifecycle.routes, data, ref, { dataRef: ref });
      array(route.events).forEach((event, k) => add('lifecycle-event', event, 'event_ref', 'action', `${routePath}/events/${k}`, route.events, route, route.route_ref, { dataRef: ref, routeRef: route.route_ref }));
    });
  });
  array(document?.forms).forEach((form, i) => {
    const path = `/forms/${i}`, ref = form.form_ref;
    add('form', form, 'form_ref', 'form_name', path, document.forms);
    array(form.behavior_links).forEach((entity,j) => add('form-link', entity, 'link_ref', 'notes', `${path}/behavior_links/${j}`, form.behavior_links, form, ref, { formRef: ref }));
    array(form.areas).forEach((area,j) => {
      const areaPath = `${path}/areas/${j}`;
      add('form-area', area, 'area_ref', 'area_title', areaPath, form.areas, form, ref, { formRef: ref });
      array(area.items).forEach((item,k) => {
        const itemPath = `${areaPath}/items/${k}`;
        // ElementReferences identifies a form item by its form owner; areaRef remains an explicit secondary owner.
        add('form-item', item, 'item_ref', 'item_name', itemPath, area.items, area, ref, { formRef: ref, areaRef: area.area_ref });
        array(item.source_links).forEach((entity,l) => add('field-source', entity, 'source_link_ref', 'source_data_name', `${itemPath}/source_links/${l}`, item.source_links, item, item.item_ref, { formRef: ref, areaRef: area.area_ref, itemRef: item.item_ref }));
      });
    });
  });
  const counts = new Map();
  entries.forEach(item => { if (item.ref) counts.set(item.ref, (counts.get(item.ref) || 0) + 1); });
  const extra = [document?.export_meta?.package_ref];
  for(const [key,refKey] of Object.entries({reference_materials:'material_ref',internal_process_calls:'call_ref',work_roles:'archive_ref',unresolved_actor_roles:'record_ref',unresolved_join_modes:'record_ref',legacy_cross_department_records:'record_ref'}))array(document?.migration?.[key]).forEach(item=>extra.push(item[refKey]));
  extra.filter(Boolean).forEach(ref=>counts.set(ref,(counts.get(ref)||0)+1));
  return entries.map(item => ({ ...item, ambiguous: !item.ref || counts.get(item.ref) !== 1 }));
}
export function resolve(document, target) {
  if (!target) return { status: 'missing', entity: null };
  const matches = catalog(document).filter(item => item.kind === normalizeKind(target.kind) && item.ref === target.ref);
  if (matches.length !== 1 || matches[0]?.ambiguous) return { status: matches.length ? 'ambiguous' : 'missing', entity: null };
  const result = matches[0];
  if (['data-field','data-link','data-source','form-area','form-link','form-item','field-source','lifecycle-route','lifecycle-event'].includes(result.kind) && !target.parentRef) return {status:'missing-parent',entity:null};
  if (target.parentRef && target.parentRef !== result.parentRef) return { status: 'wrong-parent', entity: null };
  for(const [key,ownKind] of [['formRef','form'],['areaRef','form-area'],['dataRef','data'],['routeRef','lifecycle-route']])if(target[key] && target[key] !== (result.kind===ownKind?result.ref:result[key]))return {status:'wrong-parent',entity:null};
  const owners=[result.parentRef,result.formRef,result.areaRef,result.dataRef,result.routeRef].filter(Boolean);
  if(owners.some(ref=>catalog(document).filter(item=>item.ref===ref).length!==1 || catalog(document).find(item=>item.ref===ref)?.ambiguous))return {status:'ambiguous-parent',entity:null};
  return { ...result, status: 'valid', index: result.collection?.indexOf(result.entity) ?? -1 };
}
const ENUM_LABELS = {
  action:'办理',decision:'判断',parallel_split:'并行开始',parallel_join:'并行汇合',sequence:'顺序',condition:'条件',loop:'循环',parallel:'并行',
  fixed_department:'固定部门',company_wide:'全公司',dynamic_from_data:'按前序数据确定部门',pending_confirmation:'待确认',
  business_information:'业务信息',business_conclusion:'业务结论',business_status:'业务状态',identifier:'标识符',file_attachment:'文件或附件',other_information_output:'其他信息输出',
  create:'创建',update:'更新',use:'使用',process_start:'流程开始时',at_behavior:'指定环节后',unspecified:'待确认',current_state:'现状',proposed_design:'设计建议',
  authoritative_input:'权威录入',reuse_existing:'沿用已有值',calculated:'计算取得',external_source:'外部来源',direct_current_process:'当前流程直接取得',depends_on_data:'依赖数据',
  process_data:'本流程数据',external_system:'外部系统',provides_value:'提供字段值',calculation_input:'参与计算',validation_basis:'校验依据',
  fill:'填写',modify:'修改',review:'复核',approve:'批准',confirm:'确认',read:'查阅',archive:'归档',void:'作废',
  applicable:'适用',not_applicable:'不适用',not_effective:'未生效',effective:'有效',deactivated:'停用',voided:'作废',expired:'过期',active_custody:'使用中',archived:'已归档',destroyed:'已销毁',identifiable:'可识别',irreversibly_anonymized:'不可逆匿名化',
  behavior:'环节',time_period:'时间周期',business_condition:'业务条件',external_process_notice:'外部流程通知',single:'单项',and:'同时满足',or:'任一满足',
  inherit_behavior:'沿用环节责任',explicit:'明确责任',record:'单条记录',version:'版本',batch:'批次',all_records:'全部记录',paper_original:'纸质原件',electronic_original:'电子原件',business_copy:'业务副本',paper_and_electronic:'纸质及电子',
  activate:'生效',deactivate:'停用',reactivate:'恢复生效',expire:'到期失效',restore_active_custody:'恢复使用',destroy:'销毁',irreversible_anonymize:'不可逆匿名化',
  auto_generated:'自动建议',confirmed:'已人工确认',needs_recheck:'需重新确认',rejected:'不采用',unclassified:'未分类',needs_review:'待核对',
  source_not_applicable:'来源不适用',duplicate_suggestion:'重复建议',semantic_mismatch:'语义不符',insufficient_evidence:'依据不足',conflicting_sources:'来源冲突',other:'其他'
};
export const labelValue = value => ENUM_LABELS[value] || (value === '' ? '待填写' : String(value));
const opts = values => values.map(value => ({value,label:labelValue(value)}));
const spec = (key,label,editor='text',values=null,extra={}) => ({ key,label,editor, ...(values ? {options:opts(values)} : {}), ...extra });
const stateFields = (prefix,label) => [
  spec(`${prefix}.business_validity`,`${label}业务有效性`,'select',['not_effective','effective','deactivated','voided','expired','pending_confirmation']),
  spec(`${prefix}.custody`,`${label}保管状态`,'select',['active_custody','archived','destroyed','pending_confirmation']),
  spec(`${prefix}.identifiability_applicability`,`${label}可识别性适用`,'select',['applicable','not_applicable','pending_confirmation']),
  spec(`${prefix}.identifiability`,`${label}可识别状态`,'select',['identifiable','irreversibly_anonymized','not_applicable','pending_confirmation'])
];
export function fields(document, target, enums = {}, modules = {}) {
  const kind = normalizeKind(target?.kind), current = resolve(document,target), entity = current.entity || {};
  const references = (type, nullable = false, owner = '') => [ ...(nullable ? [{value:null,label:'未指定'}] : []), ...catalog(document).filter(item => item.kind===type && (!owner || item.parentRef===owner)).map(item => ({value:item.ref,label:`${item.label} · ${item.ref}${item.ambiguous ? '（标识歧义）' : ''}`,disabled:item.ambiguous})) ];
  const ref = (key,label,type,nullable=false,owner='') => ({key,label,editor:'select',nullable,options:references(type,nullable,owner)});
  const types = enums.fieldType || enums.field_types || enums.fieldTypes || ['文本','长文本','数字','日期','日期时间','金额','枚举','布尔','部门','人员','文件编号','签名','图片','附件','二维码'];
  const definitions = {
    process:[spec('process_name','流程名称'),spec('owning_department','归属部门'),spec('purpose','目的','textarea'),spec('scope','适用范围','textarea'),spec('capability_domain','能力域','text',null,{nullable:true}),spec('business_capability','业务能力','text',null,{nullable:true}),spec('classification_status','分类状态','select',['unclassified','needs_review','confirmed'])],
    behavior:[spec('behavior_name','环节名称'),spec('node_type','环节类型','select',['','action','decision','parallel_split','parallel_join']),spec('behavior_description','具体动作说明','textarea'),spec('actor_assignment_mode','执行主体确定方式','select',['fixed_department','company_wide','dynamic_from_data']),spec('current_actor_role','执行部门与岗位'),ref('actor_department_data_ref','用于确定部门的前序数据','data',true),spec('actor_position_rule','岗位或责任人确定规则','textarea'),spec('trigger','流程启动条件','textarea'),spec('precondition','其他开始条件','textarea'),spec('timing','办理时限','text',null,{nullable:true}),spec('completion_standard','完成标准','textarea'),spec('input_description','补充输入说明','textarea'),spec('output_description','补充输出说明','textarea'),spec('countersign_all_required','要求全部会签','boolean'),spec('countersign_target_departments','会签目标部门','tags')],
    relation:[spec('relation_type','流转类型','select',['','sequence','condition','loop','parallel']),ref('from_behavior_ref','起点环节','behavior',true),ref('to_behavior_ref','终点环节','behavior',true),spec('condition','条件说明','textarea')],
    data:[spec('data_name','数据对象名称'),spec('information_type','信息类型','select',['pending_confirmation','business_information','business_conclusion','business_status','identifier','file_attachment','other_information_output']),spec('description','业务说明','textarea'),spec('lifecycle.applicability','生命周期适用','select',['applicable','not_applicable','pending_confirmation']),...stateFields('lifecycle.entry_state','初始'),spec('lifecycle.decision_reason','生命周期决定原因','select',['','no_lifecycle_in_current_process','reference_only','insufficient_evidence','other']),spec('lifecycle.decision_notes','生命周期说明','textarea')],
    'data-field':[spec('field_name','字段名称'),spec('field_type','字段类型','select',types),spec('definition','业务含义','textarea')],
    form:[spec('form_name','表单／记录名称'),spec('form_no','表单编号','text',null,{nullable:true}),spec('form_design_state','表单性质','select',['unspecified','current_state','proposed_design'])],
    'form-area':[spec('area_title','区域名称'),spec('area_type','区域类型','select',['','基本信息','明细清单'])],
    'form-item':[spec('item_name','显示名称'),spec('item_type','显示字段类型','select',types),spec('required','必填','boolean'),spec('instructions','填写说明','textarea'),ref('business_data_ref','业务数据归属','data',true),ref('data_field_ref','引用对象字段','data-field',true,entity.business_data_ref),spec('value_usage_mode','字段值使用方式','select',['authoritative_input','reuse_existing','calculated','external_source','pending_confirmation']),spec('value_origin_mode','取值方式','select',['direct_current_process','depends_on_data','pending_confirmation'])],
    term:[spec('term_name','术语名称'),spec('definition','术语定义','textarea')],
    'data-link':[ref('behavior_ref','关联环节','behavior'),spec('operation','数据操作','select',['create','update','use','pending_confirmation']),{key:'updated_field_refs',label:'更新字段',editor:'multi-select',options:references('data-field',false,current.parentRef)}],
    'data-source':[spec('source_department','来源部门'),spec('source_process_name','来源流程'),spec('source_behavior_name','来源环节'),spec('source_data_name','来源数据'),spec('availability_mode','可用时间','select',['process_start','at_behavior','pending_confirmation']),ref('available_from_behavior_ref','可用起点环节','behavior',true)],
    'form-link':[ref('behavior_ref','关联环节','behavior'),spec('operations','处理操作','multi-select',['create','fill','modify','review','approve','confirm','read','archive','void']),spec('notes','说明','textarea')],
    'field-source':[spec('source_type','来源类型','select',['process_data','external_system']),ref('source_data_ref','来源数据对象','data',true),spec('source_system_name','外部系统名称'),spec('source_data_name','来源数据名称'),spec('source_role','来源作用','select',['provides_value','calculation_input','validation_basis'])],
    'lifecycle-route':[spec('route_label','路径名称'),{key:'flow_relation_refs',label:'对应环节流转',editor:'multi-select',options:references('relation')},...stateFields('exit_state','退出')],
    'lifecycle-event':[spec('action','生命周期动作','select',['activate','deactivate','reactivate','void','expire','archive','restore_active_custody','destroy','irreversible_anonymize']),spec('trigger.mode','触发方式','select',['behavior','time_period','business_condition','external_process_notice','pending_confirmation']),spec('trigger.operator','组合方式','select',['single','and','or','pending_confirmation']),ref('trigger.behavior_ref','触发环节','behavior',true),spec('trigger.expression','触发表达说明','textarea'),...stateFields('result_state','结果'),spec('target_scope','影响范围','select',['record','version','batch','all_records','pending_confirmation']),spec('carrier_scope','载体范围','select',['paper_original','electronic_original','business_copy','paper_and_electronic','not_applicable','pending_confirmation']),spec('responsibility.mode','责任方式','select',['inherit_behavior','explicit','pending_confirmation']),spec('responsibility.department','责任部门'),spec('responsibility.position','责任岗位'),spec('exception_handling','异常处理','textarea'),spec('review_status','编制确认状态','select',['auto_generated','pending_confirmation','confirmed','needs_recheck','not_applicable','rejected']),spec('high_risk','高风险动作','boolean'),spec('decision_reason','决定原因','select',['','source_not_applicable','duplicate_suggestion','semantic_mismatch','insufficient_evidence','conflicting_sources','other']),spec('decision_notes','决定说明','textarea')]
  };
  const result = definitions[kind] || [];
  if(kind==='form-item' && entity.data_field_ref)result.find(field=>field.key==='item_type').readOnly=true;
  if (kind === 'behavior') {
    const available = dynamicDepartmentOptions(document, target.ref, modules);
    const field = result.find(item => item.key === 'actor_department_data_ref');
    field.options = [{value:null,label:'未指定'}, ...available];
  }
  // Preserve invalid existing values visibly; selecting an unrelated same-name object is always explicit.
  return result.map(field => {
    const value = readPath(entity,field.key);
    if (field.options && value != null && !Array.isArray(value) && !field.options.some(option => option.value === value)) return {...field,options:[...field.options,{value,label:`${value}（原值：缺失或不适用）`,disabled:true}]};
    return field;
  });
}
export function dynamicDepartmentOptions(document, behaviorRef, modules = {}) {
  const flow=modules.StructureLearningScore?.dataFlowConsistencyDetails(document);
  if(flow?.isAvailableBeforeBehavior)return catalog(document).filter(item=>item.kind==='data'&&!item.ambiguous&&flow.isAvailableBeforeBehavior(item.ref,behaviorRef)===true).map(item=>({value:item.ref,label:`${item.label} · ${item.ref}`}));
  // A missing domain module never authorizes a second, approximate availability rule.
  return [];
}
export const tableForTarget = target => ({data:'data_objects','data-field':'data_fields','data-link':'data_behavior_links','data-source':'data_source_relations',form:'forms','form-link':'form_behavior_links','form-area':'form_areas','form-item':'form_items','field-source':'field_source_links'}[normalizeKind(target?.kind)] || null);
export function gridTarget(document, tableId, row) {
  if (!row) return null;
  const kind = {data_objects:'data',data_fields:'data-field',data_behavior_links:'data-link',data_source_relations:'data-source',forms:'form',form_behavior_links:'form-link',form_areas:'form-area',form_items:'form-item',field_source_links:'field-source'}[tableId];
  const parentRef = row.data_ref && kind!=='data' ? row.data_ref : row.form_ref && kind!=='form' ? row.form_ref : row.item_ref && kind==='field-source' ? row.item_ref : '';
  return {kind,ref:row._row_id,parentRef,...(kind!=='form'?{areaRef:row.area_ref,formRef:row.form_ref}: {})};
}
export const pendingState = () => ({business_validity:'pending_confirmation',custody:'pending_confirmation',identifiability_applicability:'pending_confirmation',identifiability:'pending_confirmation'});
export const pendingLifecycle = () => ({applicability:'pending_confirmation',entry_state:pendingState(),routes:[],analysis:{analyzer_version:'',source_fingerprint:'',status:'not_analyzed'},decision_reason:'',decision_notes:''});
export function newEntity(kind, ref, modules = {}) {
  kind=normalizeKind(kind);
  return clone({
    behavior:{behavior_ref:ref,node_type:'action',behavior_name:'未命名环节',behavior_description:'',current_actor_role:'',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'',precondition:'',input_description:'',timing:null,completion_standard:'',output_description:'',countersign_all_required:false,countersign_target_departments:[]},
    data:{data_ref:ref,data_name:'未命名数据对象',description:'',information_type:'pending_confirmation',fields:[],behavior_links:[],source_relations:[],lifecycle:pendingLifecycle()},
    'data-field':{field_ref:ref,field_name:'未命名对象字段',field_type:'文本',definition:''},
    form:{form_ref:ref,form_name:'未命名表单／记录',form_no:null,form_design_state:'unspecified',behavior_links:[],areas:[]},
    'form-area':{area_ref:ref,area_type:'',area_title:'未命名区域',items:[]},
    'form-item':{item_ref:ref,item_name:'未命名表单字段',item_type:'文本',required:false,instructions:'',business_data_ref:null,data_field_ref:null,value_usage_mode:'pending_confirmation',value_origin_mode:'pending_confirmation',source_links:[]},
    term:{term_ref:ref,term_name:'未命名术语',definition:''},
    relation:{relation_ref:ref,relation_type:'',from_behavior_ref:null,to_behavior_ref:null,condition:''},
    'data-link':{link_ref:ref,behavior_ref:'',operation:'pending_confirmation',updated_field_refs:[]},
    'data-source':{source_ref:ref,source_department:'',source_process_name:'',source_behavior_name:'',source_data_name:'',availability_mode:'pending_confirmation',available_from_behavior_ref:null},
    'form-link':{link_ref:ref,behavior_ref:'',operations:[],notes:''},
    'field-source':{source_link_ref:ref,source_type:'process_data',source_data_ref:null,source_system_name:'',source_data_name:'',source_role:'provides_value'},
    'lifecycle-route':{route_ref:ref,route_label:'未命名生命周期路径',flow_relation_refs:[],events:[],exit_state:pendingState()},
    'lifecycle-event':{event_ref:ref,action:'activate',trigger:{mode:'pending_confirmation',operator:'pending_confirmation',behavior_ref:null,expression:''},result_state:{...pendingState(),business_validity:'effective'},target_scope:'pending_confirmation',carrier_scope:'not_applicable',responsibility:{mode:'pending_confirmation',department:'',position:''},exception_handling:'',review_status:'pending_confirmation',high_risk:false,decision_reason:'',decision_notes:'',provenance:{source_type:'user_confirmed',source_ref:null,source_path:'',basis:'',analyzer_version:'',source_fingerprint:''}}
  }[kind]);
}
export function createAddition(document, kind, parentRef, ref, modules = {}) {
  kind=normalizeKind(kind); const next=clone(document), entity=newEntity(kind,ref,modules);
  if (!entity) throw new Error('此对象类型没有新增入口');
  const top={behavior:'behaviors',data:'data_objects',form:'forms',term:'terms',relation:'flow_relations'}[kind];
  if (top) { (next[top] ||= []).push(entity);return {document:next,target:{kind,ref,parentRef:''}}; }
  const mapping={'data-field':['data','fields'],'data-link':['data','behavior_links'],'data-source':['data','source_relations'],'form-area':['form','areas'],'form-link':['form','behavior_links'],'form-item':['form-area','items'],'field-source':['form-item','source_links'],'lifecycle-route':['data','lifecycle.routes'],'lifecycle-event':['lifecycle-route','events']}[kind];
  const parentEntry=catalog(next).filter(item=>item.kind===mapping[0]&&item.ref===parentRef);
  const parent=resolve(next,{kind:mapping[0],ref:parentRef,parentRef:parentEntry.length===1?parentEntry[0].parentRef:undefined});
  if (parent.status!=='valid') throw new Error(`请明确选择唯一的${KIND_LABELS[mapping[0]]}后再新增${KIND_LABELS[kind]}`);
  let collection=readPath(parent.entity,mapping[1]);
  if (!collection) { collection=[];writePath(parent.entity,mapping[1],collection);collection=readPath(parent.entity,mapping[1]); }
  collection.push(entity);
  return {document:next,target:{kind,ref,parentRef:kind==='form-item'?parent.formRef:parentRef,areaRef:kind==='form-item'?parentRef:undefined,formRef:parent.formRef}};
}
export function deletionPlan(document,target,modules={}) {
  const current=resolve(document,target);
  if(current.status!=='valid') return {ok:false,message:'对象标识缺失、歧义或父级归属不符，不能删除',impacts:[]};
  if(current.kind==='process') return {ok:false,message:'流程对象不能删除，请从文件菜单新建流程',impacts:[]};
  const impacts=modules.GraphEditCommands?.analyzeDeletion(document,current.kind,current.ref) || [];
  const references=modules.ElementReferences?.buildCatalog(document)?.references || [];
  references.filter(item=>item.ref===current.ref && !item.external && !item.path.startsWith(`${current.path}/`)).forEach(item=>impacts.push({label:item.relationLabel || '引用',path:item.path,ref:item.ref}));
  // Ownership is never silently cascaded, including fields and lifecycle events not covered by old graph commands.
  catalog(document).filter(item=>item.path!==current.path && item.path.startsWith(`${current.path}/`)).forEach(item=>impacts.push({label:`所属${KIND_LABELS[item.kind]}`,ref:item.ref,path:item.path}));
  if(impacts.length) return {ok:false,message:`${KIND_LABELS[current.kind]}仍有关联或子记录，请先处理这些内容`,impacts};
  const next=clone(document),selected=resolve(next,target);selected.collection.splice(selected.index,1);
  return {ok:true,document:next,impacts:[],message:`删除${KIND_LABELS[current.kind]}“${current.label}”将形成一次可撤销修改`};
}
