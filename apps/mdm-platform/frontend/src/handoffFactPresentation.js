import {businessText} from './businessPresentation.js';

export const knownFactTypes=Object.freeze([
  {value:'business_meaning',label:'业务含义'},
  {value:'source_evidence',label:'来源依据'}
]);
const exactIdentity=value=>typeof value==='number'&&!Number.isSafeInteger(value)?null:value==null?null:String(value);

// Resolve only the explicitly addressed department; a question is not a name.
export function factDepartmentName(fact, {departments = [], user} = {}) {
  if (fact?.target_department_name) return businessText(fact.target_department_name, '部门名称待核对');
  const id = fact?.target_department_id;
  if (id == null || id === '') return '部门名称未记录';
  const key=exactIdentity(id);
  if(key==null)return '部门名称未记录';
  const match = departments.find(row => exactIdentity(row.id) === key);
  if (match?.name) return businessText(match.name, '部门名称待核对');
  const currentId = user?.departmentId ?? user?.department?.id;
  const currentName = user?.departmentName || user?.department?.name;
  if (currentId != null && exactIdentity(currentId) === key && currentName) return businessText(currentName, '部门名称待核对');
  return '部门名称未记录';
}

export function factTypeName(value) {
  const known=knownFactTypes.find(row=>row.value===value);
  if (known) return known.label;
  if (!value) return '事实类型未记录';
  return /[\p{Script=Han}]/u.test(String(value)) ? businessText(value, '事实类型待核对') : '事实类型待核对';
}

// Unknown stored values are selected by their exact value without showing it.
// Choosing a different type is explicit; this projection never rewrites a body.
export function factTypeChoices(value) {
  const choices=knownFactTypes.map(row=>({...row}));
  if(value&&!choices.some(row=>row.value===value))choices.push({value,label:'原事实类型（原值保留）'});
  return choices;
}
export function editableCustomFactType(value) {
  return typeof value==='string'&&!knownFactTypes.some(row=>row.value===value)&&/[\p{Script=Han}]/u.test(value)&&businessText(value,'')===value;
}
