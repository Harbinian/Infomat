import {businessFieldLabel,businessStatus,businessText,internalField} from './businessPresentation.js';

const fields={employee_no:'员工工号',person_name:'姓名',department_name:'所属部门',current_department_id:'所属部门',department_code:'所属部门',employment_status:'在职状态',mobile:'手机',email:'邮箱',office_ids:'办公室归属',office_codes:'办公室归属',unit_type:'组织类型',code:'组织编码',name:'组织名称',parent_id:'上级部门',parent_code:'上级部门',department_type:'部门类型',status:'状态',manager_person_id:'办公室负责人',manager_employee_no:'办公室负责人',department_id:'归口部门',owning_department_code:'归口部门'};
const references={current_department_id:['departments','id','所属部门'],department_code:['departments','code','所属部门'],department_id:['departments','id','归口部门'],parent_id:['departments','id','上级部门'],parent_code:['departments','code','上级部门'],owning_department_code:['departments','code','归口部门'],manager_person_id:['persons','person_id','负责人姓名'],manager_employee_no:['persons','employee_no','负责人姓名'],office_ids:['offices','id','办公室名称'],office_codes:['offices','code','办公室名称']};
const sourceFields={'工号':'employee_no','员工工号':'employee_no','姓名':'person_name','部门编码':'department_code','所属部门编码':'department_code','部门名称':'department_name','所属部门':'department_name','在职状态':'employment_status','办公室编码':'office_codes','归口部门编码':'owning_department_code','办公室负责人工号':'manager_employee_no','上级部门编码':'parent_code'};
const canonicalField=field=>sourceFields[field]||field;
export const directoryFieldLabel=field=>canonicalField(field)==='code'?'组织记录':fields[canonicalField(field)]||businessFieldLabel(field)||'其他资料';

// Current differences may resolve explicit references against the loaded snapshot.
// Historical references require recorded names; current names are not historical evidence.
export function directoryValue(field,value,snapshot={},historical=false){
 field=canonicalField(field);
 if(value==null||value==='')return '未设置';
 if(references[field]){
  const [collection,key,label]=references[field];
  if(historical)return '历史'+label+'未记录';
  const values=Array.isArray(value)?value:field==='office_codes'?String(value).split(';').map(part=>part.trim()).filter(Boolean):[value];
  return values.map(item=>{const row=(snapshot?.[collection]||[]).find(row=>String(row[key])===String(item));return row?businessText(row.person_name||row.name,label+'未记录'):label+'未记录';}).join('、')||'未设置';
 }
 if(field==='employment_status')return {active:'在职',leave:'离职',suspended:'停职',inactive:'停用'}[value]||'在职状态待核对';
 if(field==='status')return businessStatus(value);
 if(field==='unit_type')return {department:'部门',office:'办公室'}[value]||'组织类型待核对';
 return businessText(value,'该项内容暂无法展示，请核对原资料');
}

export function directoryColumns(headers){
 return (headers||[]).map((field,index)=>({field,index,label:directoryFieldLabel(field)})).filter(column=>canonicalField(column.field)!=='code'&&(Object.hasOwn(fields,column.field)||!internalField(column.field)));
}

// Keep source header values for mapping, but show business labels and source-column positions.
export function directoryImportColumns(headers,directory=true){
 return (headers||[]).flatMap((field,index)=>{
  let number=index+1,position='';while(number){number--;position=String.fromCharCode(65+number%26)+position;number=Math.floor(number/26);}
  const label=directory&&Object.hasOwn(fields,canonicalField(field))?directoryFieldLabel(field):businessFieldLabel(field)||'列名待核对';
  return [{field,index,label:`${label}（原文件${position}列）`}];
 });
}

export function directoryChangeName(change,snapshot={},historical=false) {
 const name=(change.fields||[]).find(field=>['name','person_name'].includes(field.field));
 if(name?.after||name?.before)return businessText(name.after||name.before,'本次目录记录');
 if(!historical){
  const row=[...(snapshot.persons||[]),...(snapshot.departments||[]),...(snapshot.offices||[])].find(row=>String(row.employee_no||row.code)===String(change.key));
  if(row)return businessText(row.person_name||row.name,'本次目录记录');
 }
 return '本次目录记录';
}
