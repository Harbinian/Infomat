// Read-only maintenance, explicit injected target only. --prepare never opens MySQL.
// Never reads an env file, password hashes, session IDs/JSON, or identity backup payloads.
const fs = require('node:fs');
const path = require('node:path');
const { digest, inspectProcessV7M0Baseline, compareCreateStatements } = require('../server/processV7M0Baseline');
const { mdmMysqlSchemaSql, splitSqlStatements } = require('../server/mysqlSchema');
const { runtimeVersion } = require('../server/runtimeVersion');
const m1 = require('../server/processV7PreviewReviewMigration');
const m2 = require('../server/processV7FormalMigration');
const sessions = require('../server/sessionMigration');
const dg = require('../server/processDataGovernanceMigration');

const DATA_QUERIES = {
  process_design_documents:'SELECT * FROM process_design_documents ORDER BY id',
  process_design_drafts:'SELECT * FROM process_design_drafts ORDER BY id',
  process_design_versions:'SELECT * FROM process_design_versions ORDER BY id',
  process_design_review_tasks:'SELECT * FROM process_design_review_tasks ORDER BY id',
  process_design_events:'SELECT * FROM process_design_events ORDER BY id',
  process_v7_preview_cases:'SELECT * FROM process_v7_preview_cases ORDER BY id',
  process_v7_preview_revisions:'SELECT * FROM process_v7_preview_revisions ORDER BY id',
  process_v7_preview_review_items:'SELECT * FROM process_v7_preview_review_items ORDER BY id',
  process_v7_preview_events:'SELECT * FROM process_v7_preview_events ORDER BY id',
  process_v7_promotions:'SELECT * FROM process_v7_promotions ORDER BY id',
  person:'SELECT person_id,current_department_id,employment_status,status FROM person ORDER BY person_id',
  user_accounts:'SELECT account_id,person_id,account_status,must_change_password,auth_version FROM user_accounts ORDER BY account_id',
  person_roles:'SELECT person_role_id,person_id,role_id,scope_type,scope_department_id,assignment_status,effective_from,effective_to,assigned_by_person_id,revoked_by_person_id FROM person_roles ORDER BY person_role_id',
  departments:'SELECT id,parent_id,final_responsible_person_id,data_owner_person_id,status FROM departments ORDER BY id',
  roles:'SELECT role_id,role_code,status,model_version FROM roles ORDER BY role_id',
  role_permissions:'SELECT role_perm_id,role_id,perm_id,effect FROM role_permissions ORDER BY role_perm_id',
  permissions:'SELECT perm_id,perm_code,default_scope FROM permissions ORDER BY perm_id',
  identity_migration_batches:'SELECT batch_id,model_version,mode,status,started_at,completed_at FROM identity_migration_batches ORDER BY batch_id',
  identity_access_events:'SELECT event_id,event_type,actor_person_id,target_person_id,account_id,person_role_id,migration_batch_id,created_at FROM identity_access_events ORDER BY event_id',
  schema_migrations:'SELECT migration_key,applied_at FROM schema_migrations ORDER BY migration_key'
};
const REFERENCE_QUERIES = {
  review_draft_orphans:'SELECT COUNT(*) AS count FROM process_design_review_tasks t LEFT JOIN process_design_drafts d ON d.id=t.draft_id WHERE d.id IS NULL',
  event_draft_orphans:'SELECT COUNT(*) AS count FROM process_design_events e LEFT JOIN process_design_drafts d ON d.id=e.draft_id WHERE d.id IS NULL',
  preview_revision_case_orphans:'SELECT COUNT(*) AS count FROM process_v7_preview_revisions r LEFT JOIN process_v7_preview_cases c ON c.id=r.case_id WHERE c.id IS NULL',
  preview_current_revision_mismatch:'SELECT COUNT(*) AS count FROM process_v7_preview_cases c LEFT JOIN process_v7_preview_revisions r ON r.id=c.current_revision_id WHERE r.id IS NULL OR r.case_id<>c.id OR r.revision_no<>c.current_revision_no OR r.content_hash<>c.current_content_hash',
  preview_item_revision_mismatch:'SELECT COUNT(*) AS count FROM process_v7_preview_review_items i LEFT JOIN process_v7_preview_revisions r ON r.id=i.revision_id WHERE r.id IS NULL OR r.case_id<>i.case_id OR r.revision_no<>i.revision_no',
  preview_event_reference_mismatch:'SELECT COUNT(*) AS count FROM process_v7_preview_events e LEFT JOIN process_v7_preview_cases c ON c.id=e.case_id LEFT JOIN process_v7_preview_revisions r ON r.id=e.revision_id LEFT JOIN process_v7_preview_review_items i ON i.id=e.item_id WHERE c.id IS NULL OR (e.revision_id IS NOT NULL AND (r.id IS NULL OR r.case_id<>e.case_id)) OR (e.item_id IS NOT NULL AND (i.id IS NULL OR i.case_id<>e.case_id))',
  promotion_reference_mismatch:'SELECT COUNT(*) AS count FROM process_v7_promotions p LEFT JOIN process_v7_preview_revisions r ON r.id=p.preview_revision_id LEFT JOIN process_design_documents d ON d.id=p.document_id LEFT JOIN process_design_drafts f ON f.id=p.draft_id WHERE r.id IS NULL OR d.id IS NULL OR f.id IS NULL OR r.case_id<>p.preview_case_id OR r.revision_no<>p.preview_revision_no OR r.content_hash<>p.content_hash OR f.document_id<>p.document_id',
  current_v7_review_binding_mismatch:"SELECT COUNT(*) AS count FROM process_design_review_tasks t JOIN process_design_drafts d ON d.id=t.draft_id WHERE d.schema_version='process-governance-v7' AND t.status IN ('pending','approved') AND (t.draft_revision_no IS NULL OR t.content_hash IS NULL OR (t.draft_revision_no=d.revision_no AND t.content_hash<>d.content_hash))",
  account_person_orphans:'SELECT COUNT(*) AS count FROM user_accounts a LEFT JOIN person p ON p.person_id=a.person_id WHERE p.person_id IS NULL',
  person_department_orphans:'SELECT COUNT(*) AS count FROM person p LEFT JOIN departments d ON d.id=p.current_department_id WHERE p.current_department_id IS NOT NULL AND d.id IS NULL',
  role_assignment_orphans:'SELECT COUNT(*) AS count FROM person_roles a LEFT JOIN person p ON p.person_id=a.person_id LEFT JOIN roles r ON r.role_id=a.role_id WHERE p.person_id IS NULL OR r.role_id IS NULL',
  department_role_scope_mismatch:"SELECT COUNT(*) AS count FROM person_roles a JOIN person p ON p.person_id=a.person_id WHERE a.assignment_status='active' AND a.scope_type='department' AND (a.scope_department_id IS NULL OR p.current_department_id IS NULL OR a.scope_department_id<>p.current_department_id)",
  final_responsible_person_orphans:'SELECT COUNT(*) AS count FROM departments d LEFT JOIN person p ON p.person_id=d.final_responsible_person_id WHERE d.final_responsible_person_id IS NOT NULL AND p.person_id IS NULL'
};
const METADATA_QUERIES = {
  server:'SELECT DATABASE() AS database_name,@@hostname AS server_hostname,@@port AS server_port,@@server_uuid AS server_uuid,VERSION() AS mysql_version,@@transaction_isolation AS transaction_isolation,UTC_TIMESTAMP(6) AS checked_at',
  tables:'SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME',
  columns:'SELECT TABLE_NAME,COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION',
  indexes:'SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE,IS_VISIBLE,COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX',
  references:'SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION'
};

function targetConfig(args, env) {
  for(const name of ['MYSQL_HOST','MYSQL_PORT','MYSQL_USER','MYSQL_PASSWORD','MYSQL_DATABASE']) if(!env[name]) throw Error('STAGE06_EXPLICIT_ENV_REQUIRED');
  const port=Number(env.MYSQL_PORT);
  if(!Number.isInteger(port)||port<1||port>65535||!/^[a-zA-Z0-9_]+$/.test(env.MYSQL_DATABASE)) throw Error('STAGE06_TARGET_INVALID');
  const target=`${env.MYSQL_HOST}:${env.MYSQL_PORT}/${env.MYSQL_DATABASE}`;
  if(!args.includes('--target')||args[args.indexOf('--target')+1]!==target) throw Error('STAGE06_TARGET_CONFIRMATION_REQUIRED');
  return {host:env.MYSQL_HOST,port,user:env.MYSQL_USER,password:env.MYSQL_PASSWORD,database:env.MYSQL_DATABASE,connectionLimit:1,connectTimeout:5000};
}

async function inspectTarget(connection) {
  const report={kind:'read-only',generatedAt:new Date().toISOString(),localSource:runtimeVersion(),runningApplication:{status:'pending',sourceDigest:null,checkoutHead:null,publicOrigin:null},formalRestoreVerified:false,ddlAuthorized:false,metadata:{},profiles:{},references:{},migrations:{},unavailable:[]};
  for(const [name,sql] of Object.entries(METADATA_QUERIES)) report.metadata[name]=(await connection.execute(sql))[0];
  const available=new Set(report.metadata.tables.map(t=>t.TABLE_NAME));
  const read=async(name,sql)=>{
    try{return (await connection.execute(sql))[0];}
    catch(error){if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code)){report.unavailable.push({name,code:error.code});return null;}throw error;}
  };
  for(const [name,sql] of Object.entries(DATA_QUERIES)) {
    const rows=await read(name,sql); if(!rows)continue;
    const keys=report.metadata.indexes.filter(i=>i.TABLE_NAME===name&&i.INDEX_NAME==='PRIMARY').map(i=>i.COLUMN_NAME);
    report.profiles[name]={count:rows.length,rowDigest:digest(rows),stableIdDigest:digest(rows.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]])))),stableIdColumns:keys,stateCounts:{}};
    for(const field of ['status','schema_version','account_status','assignment_status','model_version']) {
      if(rows.some(row=>field in row)) report.profiles[name].stateCounts[field]=rows.reduce((counts,row)=>{const key=String(row[field]??'(null)');counts[key]=(counts[key]||0)+1;return counts;},{});
    }
    if(name==='schema_migrations'||name==='identity_migration_batches') report.migrations[name]=rows;
    if(name==='process_v7_preview_revisions') report.previewContentHashes=rows.map(row=>{let calculated=null;try{calculated=digest(typeof row.content_json==='string'?JSON.parse(row.content_json):row.content_json);}catch{}return {id:row.id,revision_no:row.revision_no,matching:calculated===row.content_hash};});
  }
  for(const [name,sql] of Object.entries(REFERENCE_QUERIES)) {const rows=await read(name,sql);if(rows)report.references[name]=Number(rows[0].count);}
  if(available.has('mdm_http_sessions')) {
    // Deliberately do not fetch session JSON, hashes or CSRF metadata.
    report.sessions=(await connection.execute('SELECT COUNT(*) AS count,SUM(expires_at<=UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000) AS expired FROM mdm_http_sessions'))[0][0];
  }
  report.expectedBaseSchema={};
  for(const sql of splitSqlStatements(mdmMysqlSchemaSql())) {
    const match=sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/i);if(!match)continue;
    if(!available.has(match[1])) {report.expectedBaseSchema[match[1]]={state:'missing'};continue;}
    const rows=(await connection.execute(`SHOW CREATE TABLE \`${match[1]}\``))[0];
    report.expectedBaseSchema[match[1]]=compareCreateStatements(sql,rows[0]['Create Table']);
  }
  for(const [name,action] of Object.entries({m0:()=>inspectProcessV7M0Baseline(connection),m1:()=>m1.inspectProcessV7PreviewReview(connection),m2:()=>m2.inspectProcessV7FormalFoundation(connection),sessions:()=>sessions.inspectSessionSchema(connection),downstream:()=>dg.inspectProcessDataGovernance(connection)})) {
    try {report.migrations[name]=await action();}
    catch(error){if(['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(error.code))report.unavailable.push({name,code:error.code});else throw error;}
  }
  if(report.migrations.m0) {delete report.migrations.m0.gate; report.migrations.m0.target.application_commit_kind='local checkout only';}
  report.metadataStable=true;
  for(const name of ['tables','columns','indexes','references']) {
    const after=(await connection.execute(METADATA_QUERIES[name]))[0];
    if(digest(after)!==digest(report.metadata[name]))report.metadataStable=false;
  }
  report.limitations=['Only metadata and approved business/identity fields; no credential/session payload reads.','Local source digest does not identify the running deployment.','Schema differences require migration-specific adjudication; this report never authorizes DDL.','Consistent data snapshot requires quiescent DDL and an approved read window.','No formal backup or historical recovery is established by this report.'];
  return report;
}

function prepare(directory) {
  const template={stage:'06',status:'pending_formal_authorization',target:{server:null,port:null,database:null,serverUuid:null},configuredCandidate:'localhost:3307/infomat_mdm (configuration only; not an approved target)',runningApplication:{sourceDigest:null,checkoutHead:null,version:null,origin:null},readAuthorization:null,backup:{authorization:null,startedAt:null,finishedAt:null,controlledPath:null,sha256:null,restoreTarget:null,restoredAndCompared:false},results:null,ddlAuthorized:false};
  fs.writeFileSync(path.join(directory,'inspection-report.template.json'),JSON.stringify(template,null,2)+'\n',{flag:'wx'});
  const sql=['-- Stage06: execute only on the separately approved exact target, during a quiescent DDL window.','-- Output may contain approved business records; retain in the approved controlled location only.','-- Absent tables/columns are exceptions to report, never a reason to init or repair.','SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;','START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY;',...Object.entries(METADATA_QUERIES).map(([name,value])=>`-- ${name}\n${value};`),...Object.entries(DATA_QUERIES).map(([name,value])=>`-- ${name}: program computes digest; raw SQL result must remain controlled\n${value};`),...Object.entries(REFERENCE_QUERIES).map(([name,value])=>`-- ${name}\n${value};`),'ROLLBACK;'].join('\n\n')+'\n';
  fs.writeFileSync(path.join(directory,'inspection-plan.sql'),sql,{flag:'wx'});
}
async function main(args=process.argv.slice(2),env=process.env) {
  const allowed=new Set(['--prepare','--inspect','--output','--target']);
  for(let i=0;i<args.length;i++){if(!allowed.has(args[i]))throw Error('STAGE06_ARGUMENT_INVALID');if(['--output','--target'].includes(args[i])){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('STAGE06_ARGUMENT_INVALID');i++;}}
  if(Number(args.includes('--prepare'))+Number(args.includes('--inspect'))!==1||!args.includes('--output'))throw Error('STAGE06_MODE_AND_OUTPUT_REQUIRED');
  const directory=path.resolve(args[args.indexOf('--output')+1]);
  if(args.includes('--prepare')) {fs.mkdirSync(directory,{recursive:true});prepare(directory);console.log('STAGE06_PREPARED_NO_DATABASE_CONNECTION');return;}
  const config=targetConfig(args,env);
  const destination=path.join(directory,'inspection-report.json');
  if(fs.existsSync(destination))throw Error('STAGE06_OUTPUT_ALREADY_EXISTS');
  const connection=await require('mysql2/promise').createConnection(config);
  const timer=setTimeout(()=>connection.destroy(),60000);
  try{
    await connection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await connection.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    const report=await inspectTarget(connection);
    if(report.metadata.server[0].database_name!==config.database)throw Error('STAGE06_DATABASE_MISMATCH');
    report.connectionTarget={host:config.host,port:config.port,database:config.database};
    await connection.rollback();
    fs.mkdirSync(directory,{recursive:true});fs.writeFileSync(destination,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
    console.log('STAGE06_READ_ONLY_REPORT_WRITTEN');
  }finally{clearTimeout(timer);await connection.end();}
}
if(require.main===module)main().catch(error=>{console.error(/^STAGE06_/.test(error.message)?error.message:'STAGE06_INSPECTION_FAILED');process.exitCode=1;});
module.exports={targetConfig,inspectTarget,prepare,DATA_QUERIES,REFERENCE_QUERIES};
