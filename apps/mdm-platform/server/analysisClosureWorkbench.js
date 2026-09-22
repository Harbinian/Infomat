// Live projection of authorized actions, never a second todo store or cached source grant.
module.exports=async function(pool,session){
  const [ready]=await pool.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=?',[require('./analysisClosureSchema').MIGRATION_KEY]);
  if(!ready.length)return [];
  const {makeDataMapDefinitionRepository}=require('./dataMapDefinitionRepository');
  const repo=makeDataMapDefinitionRepository(pool),out=[];
  const [issues]=await pool.execute(`SELECT CAST(b.issue_id AS CHAR) issue_id FROM data_map_analysis_issue_bindings b JOIN departments d ON d.id=b.owner_department_id
    JOIN process_governance_issues i ON i.issue_id=b.issue_id WHERE i.display_status NOT IN ('closed','completed','not_in_scope') AND
    (d.final_responsible_person_id=? OR EXISTS(SELECT 1 FROM data_map_analysis_issue_closure_events e WHERE e.issue_id=b.issue_id
      AND JSON_UNQUOTE(JSON_EXTRACT(e.snapshot_json,'$.reviewer.person_id'))=?)) ORDER BY b.issue_id`,[session.personId,String(session.personId)]);
  for(const row of issues){
    try{
      const c=await repo.getAnalysisIssueClosure(session,row.issue_id);
      const designate=c.can_designate&&(!c.assignment||c.suspended);
      const review=c.can_review&&!c.tasks.some(t=>t.purpose!=='review'&&t.status!=='done');
      if(!designate&&!review)continue;
      const detail=await repo.getAnalysisIssue(session,row.issue_id),first=detail.links[0];if(!first)continue;
      out.push({id:'analysis-closure:'+row.issue_id,type:'analysis_issue_closure',title:'问题 '+row.issue_id+'：'+(designate?'指定复核人员与关闭条件':'逐项复核办理证据'),
        canAct:true,currentStatus:'pending',source:'逐问题复核',department:detail.issue.primary_dept_name,
        sourceRoles:[designate?'归口部门最终负责人本人':'本问题指定复核人员'],urgency:'medium',
        target:`/app/analysis#run=${first.run_id}&finding=${first.finding_id}`,actionLabel:designate?'指定复核人员':'复核问题',nextStep:designate?'确认人员与关闭条件':'核对固定来源及办理证据'});
    }catch(e){if([403,404].includes(e.statusCode))continue;throw e;}
  }
  return out;
};
