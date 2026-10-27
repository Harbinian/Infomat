// Synthetic handoff fixture for a caller-owned fresh MySQL target. No private
// environment, formal database, external source document or running service.
const {digest,json}=require('../../server/dataMapHandoffPolicy');
async function seed(target,{handoff=true}={}){
  const {pool,owner,database}=target;
  await require('../../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).initSchema();
  for(const sql of require('../../server/dataMapDefinitionSchema').statements())await pool.execute(sql);
  await pool.execute('INSERT INTO schema_migrations(migration_key) VALUES(?)',[require('../../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  await require('../../server/processDataGovernanceMigration').applyProcessDataGovernance(pool);
  // This suite needs the real assignment table, not preview work-record tables.
  await pool.execute(require('../../server/mysqlSchema').splitSqlStatements(require('../../server/governanceResponsibilitiesMigration').SCHEMA_SQL)[0]);
  await pool.execute("INSERT INTO departments(id,code,name) VALUES(91,'HANDOFF_SYN_A','Synthetic A'),(92,'HANDOFF_SYN_B','Synthetic B')");
  const people=[['11','111','mdm_lead'],['12','112','mdm_steward'],['13','113','admin'],['14','114','department_contact'],['15','115','mdm_lead']];
  for(const [person,account,role] of people){
    await pool.execute('INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(?,?,?,91)',[person,'HANDOFF_SYN_'+person,'Synthetic '+person]);
    await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(?,?,?,'unusable-synthetic-hash','active')",[account,person,'HANDOFF_SYN_'+person]);
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT ?,role_id,?,?,'synthetic fixture',CURRENT_DATE FROM roles WHERE role_code=?",[person,role==='department_contact'?'department':'global',role==='department_contact'?'91':null,role]);
  }
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 13,role_id,'global','synthetic overlap',CURRENT_DATE FROM roles WHERE role_code='mdm_lead'");
  await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn,owner_dept_id,status) VALUES(301,'HANDOFF_LEGACY_OBJECT','Legacy original',91,'active')");
  const base=await require('../../server/dataMapDefinitionValues').snapshot(pool,'object','301');
  const def={name:'Legacy original',business_meaning:null,unknown_semantics:true};
  await pool.execute(`INSERT INTO data_map_definition_versions(version_id,entity_type,entity_id,version_no,schema_version,definition_json,base_snapshot_json,content_digest,base_digest,digest_algorithm,source_kind,created_at)
    VALUES(9007199254741001,'object',301,1,'data-map-definition-v1',?,?,?,?,'sha256-canonical-json-v1','legacy',UTC_TIMESTAMP(3))`,[json(def),json(base),digest(def),digest(base)]);
  await pool.execute("INSERT INTO data_map_definition_heads VALUES('object',301,9007199254741001,1)");
  const result=handoff?await require('../../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database}):null;
  if(handoff&&!result.ready)throw Object.assign(new Error('handoff schema verification failed'),{details:result});
  if(handoff)await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  const session=person=>{const p=people.find(x=>x[0]===String(person));return {personId:p[0],accountId:p[1],authVersion:'1'};};
  async function packageSeed(number,{schema='process-governance-v8',status='completed',sourceStatus='published',documentId=null}={}){
    const n=String(number),doc=String(documentId||number),source={schema_version:schema,process:{process_ref:'syn_'+doc,process_name:'Synthetic',owning_department:'Synthetic A'},data_objects:[],data_fields:[],behaviors:[],flow_relations:[]},hash=digest(source);
    await pool.execute("INSERT IGNORE INTO process_design_documents(id,document_no,document_title,owning_department_id,process_ref) VALUES(?,?, 'Synthetic',91,?)",[doc,'HANDOFF_DOC_'+doc,'syn_'+doc]);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(?,?,?,'Synthetic',?,'Synthetic','synthetic','synthetic','synthetic',91)",[n,doc,'HANDOFF_DOC_'+doc,n]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'Synthetic',?,?,91,?,?,?,?)",[n,n,doc,'HANDOFF_DOC_'+doc,n,'HANDOFF_VER_'+n,schema,json(source),hash,sourceStatus]);
    if(sourceStatus==='published')await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?',[n,doc]);
    await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status) VALUES(?,?,?,?,91,?,'synthetic-rule','{}',?)",[n,'HANDOFF_PKG_'+n,n,doc,hash,status]);
    await pool.execute("INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,detail_type,source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(?,?,'object:source_1','data_object_identity','source_1',91,?,'synthetic-rule','{}',?,'confirmed')",[n,n,digest({source_ref:'source_1'}),json({basis:'synthetic confirmed fact'})]);
    if(status==='completed')await pool.execute("INSERT INTO process_data_governance_reviews(work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(?,'mdm_workgroup','approved','synthetic old review',1,11,'mdm_lead')",[n]);
    await pool.execute("INSERT INTO process_governance_responsibilities(target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id) VALUES('work_package',?,'steward',?,12,91,1,'synthetic current assignment',11)",[n,'syn_'+doc]);
    return {packageId:n,source,hash};
  }
  return {session,packageSeed,schema:result};
}
function draftBody(scope='current'){
  const source_detail_refs=['object:source_1'],basis='synthetic evidence reviewed',evidence_refs=['synthetic:evidence:1'];
  const common={source_detail_refs,basis,evidence_refs};
  const authority=[{attribute_ref:'business_meaning',sor_system_ref:'synthetic-sor',manager_department_id:'91',basis,evidence_refs,not_applicable:false}];
  return {schema_version:'handoff-draft-v1',scope_mode:scope,basis,dispositions:[],impact_dispositions:[],items:[
    {...common,item_ref:'object',target_kind:'object',operation:'create',authority,definition:{name:'Synthetic object',business_meaning:'Synthetic object definition',owner_department_id:'91',unique_identifiers:[{kind:'composite',field_item_refs:['field_a','field_b'],basis}]}},
    {...common,item_ref:'context',target_kind:'context',operation:'context_link',definition:{name:'Synthetic context',department_id:'91',purpose:'Synthetic purpose',operations:['create','read']}},
    {...common,item_ref:'element_a',target_kind:'data_element',operation:'create',authority,definition:{name:'Synthetic key A',business_meaning:'Synthetic key A definition'}},
    {...common,item_ref:'element_b',target_kind:'data_element',operation:'create',authority,definition:{name:'Synthetic key B',business_meaning:'Synthetic key B definition'}},
    ...['a','b'].map(k=>({...common,item_ref:'field_'+k,target_kind:'field',operation:'create',authority,object_ref:'object',context_ref:'context',data_element_ref:'element_'+k,definition:{name:'Synthetic key '+k,business_meaning:'Synthetic field '+k,data_type:'string',required:true}})),
    {...common,item_ref:'rule',target_kind:'rule',operation:'rule',context_ref:'context',definition:{name:'Synthetic rule',stage:'create',operation:'record',trigger:'synthetic trigger',responsible_department_id:'91'}},
    {...common,item_ref:'authority',target_kind:'authority',operation:'authority',context_ref:'context',definition:{name:'Synthetic authority fact',basis}}
  ]};
}
module.exports={seed,draftBody};
