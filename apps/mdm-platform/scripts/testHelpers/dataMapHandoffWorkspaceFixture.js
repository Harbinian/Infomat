// Synthetic workspace sources and people in a caller-owned tmpfs MySQL only.
// Seeded prerequisites are recorded separately from actions exercised through Edge.
const crypto = require('node:crypto');
const {digest, json} = require('../../server/dataMapHandoffPolicy');
const {draftBody} = require('./dataMapHandoffFixture');
const {createDataMapHandoffRepository} = require('../../server/dataMapHandoffRepository');
const {withStage05Fixture} = require('../test-stage05-mysql-isolated');
const request = body => ({request_id: crypto.randomUUID(), ...body});
const proof = {basis: '合成材料：逐项核对当前来源及权限', evidence_refs: ['synthetic:workspace:verified-source']};
const lead = {personId:'82', accountId:'182', authVersion:'1'};
const steward = {personId:'89', accountId:'189', authVersion:'1'};

async function seed(target) {
  const {pool, owner, database} = target;
  await require('../../server/publicationSchema').managePublicationSchema(pool, 'apply');
  await require('../../server/officeSchema').manageOfficeSchema(pool, 'apply');
  for (const sql of require('../../server/dataMapDefinitionSchema').statements()) await pool.execute(sql);
  await pool.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES(?)', [require('../../server/dataMapDefinitionSchema').MIGRATION_KEY]);
  for (const sql of require('../../server/mysqlSchema').splitSqlStatements(require('../../server/governanceResponsibilitiesMigration').SCHEMA_SQL)) await pool.execute(sql);
  await require('../../server/dataMapHandoffSchema').applyHandoffSchema(pool, {owner, database});
  await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled',cutover_epoch=1 WHERE control_id=1");
  for (const [person, role] of [[86,'data_conflict_handler'], [87,'decision_group'], [88,'mdm_lead'], [88,'data_conflict_handler'], [88,'decision_group']]) {
    await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT ?,role_id,'global','synthetic workspace authorization',CURRENT_DATE FROM roles WHERE role_code=?", [person, role]);
  }
  const passwordHash = (await pool.execute('SELECT password_hash FROM user_accounts WHERE account_id=182'))[0][0].password_hash;
  await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(89,'SYNTHETIC_steward','合成承接经办人',91)");
  await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status,must_change_password) VALUES(189,89,'SYNTHETIC_steward',?,'active',0)", [passwordHash]);
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 89,role_id,'global','synthetic workspace assignment',CURRENT_DATE FROM roles WHERE role_code='mdm_steward'");
  const repo = createDataMapHandoffRepository(pool, {env:{DATA_MAP_HANDOFF_ENABLED:'1', PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
  const state = {prerequisites:[], drafts:{}, loginNames:{lead:'SYNTHETIC_lead',steward:'SYNTHETIC_steward',handler:'SYNTHETIC_outsider',decider:'SYNTHETIC_multi',contact:'SYNTHETIC_contact',reviewerA:'SYNTHETIC_reviewA',reviewerB:'SYNTHETIC_reviewB',admin:'SYNTHETIC_admin',adminMulti:'SYNTHETIC_adminMulti'}};
  for (const [key, n] of [['editing',501],['ordinary',502],['major',503],['receipt',504],['stale',505],['session',506],['legacy',507]]) {
    const source = {schema_version:'process-governance-v8', process:{process_ref:'workspace_syn_'+n, process_name:'合成承接'+key, owning_department:'合成甲部'}, data_objects:[],data_fields:[],behaviors:[],flow_relations:[]};
    const contentHash = digest(source), documentNo='SYN-WORKSPACE-'+n;
    await pool.execute("INSERT INTO process_design_documents(id,document_no,document_title,owning_department_id,process_ref) VALUES(?,?,'合成承接来源',91,?)", [n,documentNo,source.process.process_ref]);
    await pool.execute("INSERT INTO process_design_drafts(id,document_id,document_no,document_title,planned_edition,process_name,reason,basis_type,basis_description,department_id) VALUES(?,?,?,'合成承接来源','A','合成承接','synthetic','synthetic','synthetic',91)", [n,n,documentNo]);
    await pool.execute("INSERT INTO process_design_versions(id,draft_id,document_id,document_no,document_title,edition,version_no,department_id,schema_version,process_content_json,content_hash,status) VALUES(?,?,?,?,'合成承接来源','A',?,91,?,?,?,'published')", [n,n,n,documentNo,documentNo+'-A',source.schema_version,json(source),contentHash]);
    await pool.execute('UPDATE process_design_documents SET current_version_id=? WHERE id=?',[n,n]);
    await pool.execute("INSERT INTO process_data_governance_work_packages(id,package_ref,process_version_id,source_document_id,owning_department_id,source_content_hash,rule_version,risk_basis_json,status,created_by_person_id) VALUES(?,?,?,?,91,?,'synthetic-workspace','{}','completed',82)", [n,'SYN-WORKSPACE-PKG-'+n,n,n,contentHash]);
    await pool.execute("INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,detail_type,source_ref,responsible_department_id,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(?,?,'object:source_1','data_object_identity','source_1',91,?,'synthetic-workspace','{}',?,'confirmed')",[n,n,digest({source_ref:'source_1'}),json(proof)]);
    await pool.execute("INSERT INTO process_data_governance_reviews(work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(?,'mdm_workgroup','approved','合成固定审核',1,82,'mdm_lead')",[n]);
    await pool.execute("INSERT INTO process_governance_responsibilities(target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id) VALUES('work_package',?,'steward',?,89,91,1,'合成明确分派',82)",[n,source.process.process_ref]);
    if(key==='legacy'){state.legacy={package_id:String(n),original_source_hash:contentHash};state.prerequisites.push({kind:'completed_legacy_package_without_intake_or_binding',scenario:key,package_id:String(n),ui_exercised:false});continue;}
    const intake=await repo.prepareIntake(String(n),request({expected_revision:0}),lead);
    const reviewed=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:proof.basis,detail_evidence:intake.required_detail_evidence.map(x=>({...x,...proof}))}),lead);
    const body=draftBody();
    body.items.find(x=>x.item_ref==='object').definition.name='合成对象'+key;
    if(key==='editing')body.items.find(x=>x.item_ref==='field_a').definition.enum_values=[0,false,'Synthetic retained text'];
    state.drafts[key]={...(await repo.fromWorkPackage(String(n),request({expected_revision:0,binding_id:reviewed.binding_id,draft:body}),steward)),package_id:String(n)};
    state.prerequisites.push({kind:'reviewed_fixed_source_and_complete_draft',scenario:key,package_id:String(n),handoff_id:state.drafts[key].handoff_id,ui_exercised:false});
  }
  const upgrade = await require('./dataMapSourceUpgradeFixture').setup(target,{preseeded:true,lead,base:2900});
  const created = await upgrade.createNewPackage();
  await pool.execute("INSERT INTO process_governance_responsibilities(target_type,target_id,assignment_kind,process_ref,person_id,department_id,revision_no,basis_text,actor_person_id) VALUES('work_package',?,'steward',?,89,91,1,'合成新版分派',82)",[created.newPackageId,upgrade.source.processRef]);
  state.upgrade={source:upgrade.source,oldReview:upgrade.oldReview,created};
  state.prerequisites.push({kind:'old_review_and_new_native_reviewed_package',scenario:'upgrade',source_package_id:upgrade.source.oldPackageId,target_package_id:created.newPackageId,handoff_id:created.draft.handoff_id,ui_exercised:false});
  state.repo=repo; state.actors={lead,steward};
  return state;
}

async function withWorkspaceFixture(action, options={}) {
  if (options.beforeSeed !== undefined && typeof options.beforeSeed !== 'function') throw new TypeError('WORKSPACE_BEFORE_SEED_INVALID');
  let state;
  return withStage05Fixture(async value=>action({...value,state}), {
    randomDatabase:true,handoffEnabled:true,processDataGovernanceVersionId:901,completeSource:true,departmentAccountability:true,
    startupTimeoutMs:60000,
    createDocument:()=>({schema_version:'process-governance-v8',export_meta:{},process:{},behaviors:[],flow_relations:[],data_objects:[],data_fields:[],data_relations:[],forms:[]}),
    ...options,beforeStart:async target=>{if(options.beforeSeed)await options.beforeSeed(target);state=await seed(target);if(options.beforeStart)await options.beforeStart(target,state);}
  });
}
module.exports={withWorkspaceFixture,seed,request,proof};
