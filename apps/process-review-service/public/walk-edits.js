export const stepTypes = [
  { value: 'action', label: '办理' }, { value: 'decision', label: '判断' },
  { value: 'parallel_split', label: '并行开始' }, { value: 'parallel_join', label: '并行汇合' }
];
export const relationTypes = [
  { value: 'sequence', label: '顺序' }, { value: 'condition', label: '条件' },
  { value: 'loop', label: '回退' }, { value: 'parallel', label: '并行' }
];
export const assignmentModes = [
  { value: 'fixed_department', label: '固定部门' }, { value: 'company_wide', label: '全公司适用' },
  { value: 'dynamic_from_data', label: '依据业务数据确定' }
];

export const walkEditFields = {
  step: [
    { name: 'behavior_name', label: '步骤名称', required: true, max: 300, singleLine: true },
    { name: 'node_type', label: '节点类型', choices: stepTypes },
    { name: 'actor_assignment_mode', label: '部门分配方式', choices: assignmentModes },
    { name: 'current_actor_role', label: '办理角色', max: 1000 },
    { name: 'actor_position_rule', label: '部门分配规则' },
    { name: 'behavior_description', label: '办理说明' },
    { name: 'input_description', label: '输入' },
    { name: 'output_description', label: '输出' },
    { name: 'completion_standard', label: '完成标准' },
    { name: 'trigger', label: '触发条件' },
    { name: 'precondition', label: '前置条件' },
    { name: 'timing', label: '时限' }
  ],
  relation: [
    { name: 'from_behavior_ref', label: '起点', endpoint: true },
    { name: 'to_behavior_ref', label: '终点', endpoint: true },
    { name: 'relation_type', label: '关系类型', choices: relationTypes },
    { name: 'condition', label: '流转条件' }
  ]
};

const collections = { step: 'behaviors', relation: 'flow_relations' };
const sourceIndex = Symbol('walkSourceIndex');

export function walkElementIndex(document, kind, element) {
  return element?.[sourceIndex] ?? (document?.[collections[kind]] || []).indexOf(element);
}

export function walkElement(document, kind, index) {
  return document?.[collections[kind]]?.find((element, position) => (element?.[sourceIndex] ?? position) === index);
}

export function walkEndpoints(document) {
  const nodes = document?.behaviors || [];
  const counts = new Map();
  for (const {behavior_ref: ref} of nodes) counts.set(ref, (counts.get(ref) || 0) + 1);
  return nodes.flatMap(({behavior_ref: ref, behavior_name: name}, index) =>
    typeof ref === 'string' && ref && counts.get(ref) === 1
      ? [{value:ref,label:`${index + 1}. ${name || '未命名步骤'}`}]
      : []);
}

export function walkElementLabel(document,kind,element){
  if(kind==='step')return element.behavior_name||'未命名步骤';
  const endpoint=(reference,fallback)=>{
    const matches=(document.behaviors||[]).filter(node=>node?.behavior_ref===reference);
    return matches.length===1?matches[0].behavior_name||'未命名步骤':fallback;
  };
  const condition=element.condition?`（${element.condition}）`:'';
  return `${endpoint(element.from_behavior_ref,'起点待核对')} → ${endpoint(element.to_behavior_ref,'终点待核对')}${condition}`;
}

function containsWalkReference(value,pattern,reference){
  if(!value||typeof value!=='object')return false;
  return Object.entries(value).some(([key,item])=>
    (pattern.test(key)&&(item===reference||(Array.isArray(item)&&item.includes(reference))))||containsWalkReference(item,pattern,reference));
}

export function walkRemovalBlockers(document,kind,index,presenters=[]){
  const element=walkElement(document,kind,index);
  if(!element)return ['该元素已从共享走查图移除。'];
  const reference=element[kind==='step'?'behavior_ref':'relation_ref'];
  if(!reference)return [];
  const blockers=[];
  const collection=collections[kind],referenceKey=kind==='step'?'behavior_ref':'relation_ref';
  if(document[collection].filter(item=>item?.[referenceKey]===reference).length!==1)blockers.push('该元素的标识对应多条记录，请先核对。');
  if(kind==='step'){
    const lines=(document.flow_relations||[]).filter(line=>line?.from_behavior_ref===reference||line?.to_behavior_ref===reference);
    lines.forEach(line=>blockers.push(`该步骤仍有相连的连线：${walkElementLabel(document,'relation',line)}`));
    if(presenters.some(item=>item.nodeRef===reference))blockers.push('主持投屏仍定位到该步骤，请先切换投屏位置。');
  }
  const pattern=kind==='step'?/(^|_)behavior_refs?$/:/(^|_)relation_refs?$/;
  const labels={behaviors:'步骤',flow_relations:'连线',data_objects:'数据对象',forms:'表单',terms:'术语'};
  for(const [key,value] of Object.entries(document)){
    if(pattern.test(key)&&(value===reference||Array.isArray(value)&&value.includes(reference))){blockers.push('材料其他内容仍引用该元素。');continue;}
    if(Array.isArray(value)){
      for(const item of value){
        if(item===element||!containsWalkReference(item,pattern,reference))continue;
        if(kind==='step'&&key==='flow_relations'&&(item.from_behavior_ref===reference||item.to_behavior_ref===reference))continue;
        const name=item?.data_name||item?.form_name||item?.term_name||item?.behavior_name;
        blockers.push(`${labels[key]||'材料内容'}${name?`「${name}」`:''}仍引用该${kind==='step'?'步骤':'连线'}。`);
      }
    }else if(containsWalkReference({[key]:value},pattern,reference))blockers.push(`${key==='process'?'流程定义':'材料其他内容'}仍引用该${kind==='step'?'步骤':'连线'}。`);
  }
  return [...new Set(blockers)];
}

export function materialWalkEdits(audit, materialId) {
  return audit.filter(item => ['walk.edit', 'walk.create', 'walk.remove'].includes(item.operation) && item.detail.materialId === materialId);
}

export function projectWalkDocument(original, edits) {
  if (!edits.length) return original;
  const document = {
    ...original,
    behaviors: [...(original.behaviors || [])],
    flow_relations: [...(original.flow_relations || [])]
  };
  for (const { operation, detail: { kind, index, after } } of edits) {
    const entries = document[collections[kind]];
    entries[index] = operation === 'walk.remove' ? null : { ...entries[index], ...after };
  }
  // Keep ledger positions stable when a removal changes visible list positions.
  for (const collection of Object.values(collections)) {
    document[collection] = document[collection].flatMap((entry, index) => entry ? [{ ...entry, [sourceIndex]: index }] : []);
  }
  return document;
}

export function nextWalkIndex(original, edits, kind) {
  return edits.reduce((next, { detail }) => detail.kind === kind ? Math.max(next, detail.index + 1) : next,
    original[collections[kind]]?.length ?? 0);
}

export function walkEditText(value) {
  return (value ?? '').replace(/\r\n?/g, '\n');
}
