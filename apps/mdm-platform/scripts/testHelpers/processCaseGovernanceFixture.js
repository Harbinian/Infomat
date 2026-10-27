// Synthetic fixture only: callers supply their owned fresh MySQL pool.
const crypto=require('node:crypto');
const {splitSqlStatements}=require('../../server/mysqlSchema');
async function seed(pool){
  await require('../../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
  for(const sql of splitSqlStatements(require('../../server/processV7PreviewReviewMigration').PROCESS_V7_PREVIEW_SCHEMA_SQL))await pool.execute(sql);
  for(const sql of splitSqlStatements(require('../../server/processV7FormalMigration').PROCESS_V7_FORMAL_SCHEMA_SQL))await pool.execute(sql);
  for(const sql of splitSqlStatements(require('../../server/processCaseGovernanceSchema').SCHEMA_SQL))await pool.execute(sql);
  await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES (?)',[require('../../server/processCaseGovernanceSchema').MIGRATION_KEY]);
  await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'CASE_SYN_A','Synthetic A'),(92,'CASE_SYN_B','Synthetic B'),(93,'CASE_SYN_C','Synthetic C')");
  const people=[[11,91,'mdm_lead'],[13,91,'admin'],[14,91,'department_contact'],[18,91,'department_mdm_reviewer'],[19,92,'department_contact'],[20,92,'department_mdm_reviewer'],[23,91,'department_mdm_reviewer'],[24,93,'department_contact'],[26,93,'department_mdm_reviewer']];
  for(const [person,dept,role] of people){
    await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,?)",[person,'CASE_SYN_'+person,'Synthetic '+person,dept]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,'unusable-synthetic-hash','active')",[person+100,person,'CASE_SYN_'+person]);
    const scoped=role.startsWith('department_');
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'synthetic governance fixture',CURRENT_DATE FROM roles WHERE role_code=?",[person,scoped?'department':'global',scoped?dept:null,role]);
  }
  for(const [dept,person] of [[91,18],[92,20],[93,26]])await pool.execute('UPDATE departments SET final_responsible_person_id=? WHERE id=?',[person,dept]);
  const policy=await pool.getConnection();try{await require('../../server/departmentAccountabilityMigration').applyDepartmentAccountabilityPolicy(policy);}finally{policy.release();}
  const session=person=>({personId:String(person),accountId:String(person+100),authVersion:'1'});
  return {lead:session(11),admin:session(13),contactA:session(14),headA:session(18),contactB:session(19),headB:session(20),replacementA:session(23),contactC:session(24),headC:session(26)};
}
function document(){
  const value={schema_version:'process-governance-v7',export_meta:{package_ref:'synthetic_package',exported_at:new Date().toISOString(),initiating_department:'Synthetic A',compiler:''},
    process:{process_ref:'',process_name:'',owning_department:'',purpose:'',scope:'',capability_domain:null,business_capability:null,classification_status:'unclassified'},
    behaviors:[],flow_relations:[],data_objects:[],forms:[],terms:[],migration:{source_schema_version:'process-governance-v7',source_process_ref:null,source_process_count:1,
      legacy_cross_department_records:[],reference_materials:[],internal_process_calls:[],work_roles:[],unresolved_actor_roles:[],unresolved_join_modes:[]}};
  value.process.process_ref='synthetic_case_'+crypto.randomUUID();value.process.process_name='Synthetic governance process';value.process.owning_department='Synthetic A';
  value.process.purpose='Synthetic purpose';value.process.scope='Synthetic scope';value.export_meta.compiler='Synthetic compiler';
  value.behaviors=[{behavior_ref:'synthetic_behavior',node_type:'action',behavior_name:'核对测试材料',behavior_description:'核对明确提供的测试材料。',
    current_actor_role:'Synthetic A核对人',actor_assignment_mode:'fixed_department',actor_department_data_ref:null,actor_position_rule:'',trigger:'收到测试材料',
    precondition:'',input_description:'',timing:null,completion_standard:'测试材料已经核对。',output_description:'',countersign_all_required:false,countersign_target_departments:[]}];
  value.flow_relations=[];return value;
}
function participants(ids=['91']){return ids.map(department_id=>({department_id:String(department_id),behavior_refs:[],responsibilities:'Synthetic explicitly supplied department scope',basis:'Synthetic explicit fixture decision'}));}
function submission(ids=['91']){return {sources:[{reference:'synthetic:source:1',title:'Synthetic source',basis:'Synthetic new process basis'}],purpose:'Synthetic purpose',revision_reason:'Synthetic revision reason',change_summary:'Synthetic precise change summary',participants:participants(ids)};}
async function act(repo,caseId,operation,actor,extra={},changeId=null){const detail=await repo.getCaseDetail(caseId);return repo.governanceAction(caseId,operation,changeId,{request_id:crypto.randomUUID(),expected_revision_no:detail.case.current_revision_no,expected_content_hash:detail.case.current_content_hash,basis:'Synthetic current first-person basis',...extra},actor);}
async function completeSidecar(repo,caseId,actors,ids=['91']){
  const heads={'91':actors.headA,'92':actors.headB,'93':actors.headC};
  for(const dept of ids)await act(repo,caseId,'submission_confirm',heads[dept]);
  const proposed=await act(repo,caseId,'propose',actors.lead,{kind:'deadline',reason:'Synthetic task agreement',due_date:'2026-12-31',department_ids:ids});
  const changeId=proposed.result.change_id;
  for(const dept of ids)await act(repo,caseId,'confirm',heads[dept],{},changeId);
  await act(repo,caseId,'register',actors.lead,{},changeId);
  return repo.getCaseDetail(caseId);
}
module.exports={seed,document,participants,submission,act,completeSidecar};
