// The generated value is an internal stable key, not a business organization number.
// It is created once with the draft and survives preview, retry and uncertain outcomes.
export function organizationInitialValues(entity,row,generate=()=>crypto.randomUUID()) {
  const code=row?row.code||'':'org-'+generate();
  if(entity==='department')return {code,name:row?.name||'',parent_id:row?.parent_id?String(row.parent_id):'',department_type:row?.department_type||'',status:row?.status||'active'};
  return {code,name:row?.name||'',department_id:row?.department_id?String(row.department_id):'',manager_person_id:row?.manager_person_id?String(row.manager_person_id):'',status:row?.status||'active'};
}
