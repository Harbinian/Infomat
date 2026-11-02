// Escalation completeness only; the project decision still reopens fact review.
const { identityInteger } = require('./sessionSubject');
function escalationMaterials(input, departments = []) {
  const fail=label=>{throw Object.assign(new Error('争议升级材料须包含'+label),{code:'PROCESS_DISPUTE_MATERIALS_REQUIRED',statusCode:422});};
  const nonempty=(value,label)=>{if(typeof value!=='string'||!value.trim()||value.length>4000)fail(label);return value.trim();};
  const value={issue_summary:nonempty(input?.issue_summary,'争议事项'),impact_scope:nonempty(input?.impact_scope,'影响范围'),coordination_history:nonempty(input?.coordination_history,'已协调情况')};
  if(!Array.isArray(input?.positions)||!input.positions.length||input.positions.length>100)fail('各方观点及依据');
  const seen=new Set();
  value.positions=input.positions.map(p=>{
    const departmentId=identityInteger(p?.department_id);
    if(departmentId===null||seen.has(String(departmentId)))fail('不重复的实际相关部门');
    seen.add(String(departmentId));
    return {department_id:String(departmentId),position:nonempty(p.position,'各方观点'),basis:nonempty(p.basis,'各方依据')};
  });
  if(departments.some(id=>!seen.has(String(id))))fail('全部相关部门的观点及依据');
  if(value.positions.some(p=>departments.length&&!departments.map(String).includes(p.department_id)))fail('本争议实际相关部门的观点及依据');
  return value;
}
module.exports={escalationMaterials};
