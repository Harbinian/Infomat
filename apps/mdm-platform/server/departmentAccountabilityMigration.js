// Explicit policy preparation for existing v4/v5 models. It never appoints people,
// changes person grants, changes the model version, or installs the separate HR role.
const crypto = require('node:crypto');
const { compareCreateStatements } = require('./processV7M0Baseline');
const baseline = require('./accessModelV4Baseline');
const { POLICY_VERSION, POLICY_MIGRATION_KEY, POLICY_BACKUP_TABLE, ROLE_CODE, ROLE_NAME, ROLE_DESCRIPTION } = require('./departmentAccountability');
const MODEL_VERSIONS = ['rbac-raci-v4-2026-10-19', 'rbac-raci-v5-2026-10-19'];
const PERMISSION_DESCRIPTIONS = {
  'governance:review-department': '部门负责人本人核对和退回本部门治理材料',
  'governance:record-department-decision': '由部门负责人本人作出并记录本部门最终确认'
};
const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS department_accountability_policy_backups (
  migration_key VARCHAR(128) PRIMARY KEY,
  snapshot_json MEDIUMTEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_department_accountability_backup_status CHECK (status IN ('prepared','applied','compensated'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
const eventTables = { governance_decision_records: 'decision_record_id', process_v7_preview_events: 'id', process_design_events: 'id' };
const fail = (code, inspection) => Object.assign(new Error(code), { code, statusCode: 409, ...(inspection ? { inspection } : {}) });
async function rows(db, sql, params = []) { return (await db.execute(sql, params))[0]; }
async function exists(db, table) { return (await rows(db, 'SELECT TABLE_COLLATION FROM information_schema.tables WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=?', [table]))[0] || null; }
async function cutoffs(db) {
  const result = {};
  for (const [table, column] of Object.entries(eventTables)) result[table] = await exists(db, table) ? (await rows(db, `SELECT CAST(COALESCE(MAX(${column}),0) AS CHAR) maximum_id FROM ${table}`))[0].maximum_id : null;
  return result;
}
async function grantFingerprint(db) {
  const data = await rows(db, `SELECT pr.*,CAST(pr.person_role_id AS CHAR) exact_person_role_id,CAST(pr.person_id AS CHAR) exact_person_id,
    CAST(pr.role_id AS CHAR) exact_role_id FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE r.role_code=? ORDER BY pr.person_role_id`, [ROLE_CODE]);
  return { count: data.length, sha256: crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex') };
}
async function responsibilityReadiness(db, modelVersion) {
  const departments = await rows(db, "SELECT CAST(id AS CHAR) department_id,CAST(final_responsible_person_id AS CHAR) final_responsible_person_id FROM departments WHERE status='active' ORDER BY id");
  const assignments = await rows(db, `SELECT CAST(pr.person_role_id AS CHAR) assignment_id,CAST(pr.person_id AS CHAR) person_id,
    pr.scope_type,CAST(pr.scope_department_id AS CHAR) scope_department_id,CAST(p.current_department_id AS CHAR) current_department_id,
    p.status person_status,p.employment_status,ua.account_status,ua.must_change_password,
    EXISTS(SELECT 1 FROM person_roles a JOIN roles ar ON ar.role_id=a.role_id WHERE a.person_id=pr.person_id AND ar.role_code='admin'
      AND ar.status='active' AND ar.model_version=? AND a.assignment_status='active' AND a.effective_from<=CURRENT_DATE AND (a.effective_to IS NULL OR a.effective_to>=CURRENT_DATE)) admin_overlap
    FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id LEFT JOIN person p ON p.person_id=pr.person_id
    LEFT JOIN user_accounts ua ON ua.person_id=pr.person_id WHERE r.role_code=? AND r.status='active' AND r.model_version=?
      AND pr.assignment_status='active' AND pr.effective_from IS NOT NULL AND pr.effective_from<=CURRENT_DATE AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    ORDER BY pr.person_role_id`, [modelVersion, ROLE_CODE, modelVersion]);
  const matches = (a, d) => a.scope_type === 'department' && a.scope_department_id === d.department_id && a.person_id === d.final_responsible_person_id &&
    a.current_department_id === d.department_id && a.person_status === 'active' && a.employment_status === 'active' && a.account_status === 'active' && !a.must_change_password && !Number(a.admin_overlap);
  const gaps = departments.flatMap(d => {
    if (!d.final_responsible_person_id) return [{ ...d, reason: 'DEPARTMENT_FINAL_RESPONSIBLE_UNSET' }];
    return assignments.some(a => matches(a,d)) ? [] : [{ ...d, reason: 'DEPARTMENT_ACCOUNTABILITY_ASSIGNMENT_UNREADY' }];
  });
  const unmatched = assignments.filter(a => !departments.some(d => matches(a,d))).map(a => ({ assignment_id:a.assignment_id,person_id:a.person_id,scope_department_id:a.scope_department_id,reason:'DEPARTMENT_ACCOUNTABILITY_AUTHORIZATION_MISMATCH' }));
  return { ready: !gaps.length && !unmatched.length, active_departments: departments.length, effective_assignments: assignments.length, gaps, unmatched_authorizations: unmatched };
}
async function inspectDepartmentAccountabilityPolicy(db) {
  const missing = [], drift = [];
  for (const table of ['departments','person','user_accounts','person_roles','roles','permissions','role_permissions','schema_migrations']) if (!await exists(db,table)) drift.push({dependency:table,reason:'missing'});
  const structure = await exists(db,POLICY_BACKUP_TABLE);
  if (!structure) missing.push(POLICY_BACKUP_TABLE);
  else {
    const [[ddl]] = await db.query('SHOW CREATE TABLE ' + POLICY_BACKUP_TABLE);
    const comparison = compareCreateStatements(SCHEMA_SQL,ddl['Create Table']);
    if (!comparison.matching || !/ENGINE=InnoDB/i.test(ddl['Create Table']) || /NOT ENFORCED/i.test(ddl['Create Table']) || structure.TABLE_COLLATION !== 'utf8mb4_unicode_ci') drift.push({table:POLICY_BACKUP_TABLE,reason:'structure_changed'});
  }
  if (drift.some(item=>item.dependency)) return {ready:false,missing,drift,policy_version:POLICY_VERSION,person_grants_changed:false};
  const roles = await rows(db,'SELECT CAST(role_id AS CHAR) role_id,role_code,role_name,description,status,model_version,parent_role_id FROM roles WHERE role_code IN (' + baseline.ROLE_GUIDES.map(()=>'?').join(',') + ')',baseline.ROLE_GUIDES.map(role=>role.code));
  const versions = new Set(roles.map(role=>role.model_version));
  const modelVersion = versions.size===1 ? [...versions][0] : null;
  if (versions.size!==1 || !MODEL_VERSIONS.includes(modelVersion)) drift.push({reason:'unsupported_or_mixed_model',supported_models:MODEL_VERSIONS});
  for (const expected of baseline.ROLE_GUIDES) {
    const actual=roles.find(role=>role.role_code===expected.code);
    if (!actual || actual.status!=='active' || actual.parent_role_id) { drift.push({role:expected.code,reason:'unsupported_baseline'}); continue; }
    const permissions=await rows(db,'SELECT p.perm_code,rp.effect FROM role_permissions rp JOIN permissions p ON p.perm_id=rp.perm_id WHERE rp.role_id=CAST(? AS SIGNED) ORDER BY p.perm_code',[actual.role_id]);
    if (JSON.stringify(permissions.map(p=>p.perm_code).sort())!==JSON.stringify(expected.permissions.map(p=>p.code).sort()) || permissions.some(p=>p.effect!=='allow')) drift.push({role:expected.code,reason:'permission_baseline_changed'});
  }
  const marker=(await rows(db,'SELECT migration_key FROM schema_migrations WHERE migration_key=?',[POLICY_MIGRATION_KEY]))[0];
  const backup=structure ? (await rows(db,`SELECT status,snapshot_json FROM ${POLICY_BACKUP_TABLE} WHERE migration_key=?`,[POLICY_MIGRATION_KEY]))[0] : null;
  const departmentRole=roles.find(role=>role.role_code===ROLE_CODE);
  const permissionDescriptions=await rows(db,'SELECT CAST(perm_id AS CHAR) perm_id,perm_code,description FROM permissions WHERE perm_code IN (?,?)',Object.keys(PERMISSION_DESCRIPTIONS));
  let snapshot;
  if (backup) try { snapshot=JSON.parse(backup.snapshot_json); } catch { drift.push({reason:'invalid_policy_snapshot'}); }
  if (snapshot && (snapshot.policy_version!==POLICY_VERSION || !snapshot.role || snapshot.role.role_id!==departmentRole?.role_id)) drift.push({reason:'policy_snapshot_role_mismatch'});
  const prepared=Boolean(marker && backup?.status==='applied' && departmentRole?.role_name===ROLE_NAME && departmentRole?.description===ROLE_DESCRIPTION && snapshot &&
    permissionDescriptions.length===2 && permissionDescriptions.every(permission=>permission.description===PERMISSION_DESCRIPTIONS[permission.perm_code]));
  if (marker && !prepared) drift.push({reason:'policy_record_inconsistent'});
  const responsibilities=MODEL_VERSIONS.includes(modelVersion) ? await responsibilityReadiness(db,modelVersion) : {ready:false,gaps:[],unmatched_authorizations:[]};
  return {ready:prepared&&!missing.length&&!drift.length,policy_prepared:prepared,policy_version:POLICY_VERSION,model_version:modelVersion,missing,drift,
    responsibility_ready:responsibilities.ready,responsibilities,person_grants_changed:false,automatic_appointments:[],automatic_grants:[]};
}
async function locked(db,work) {
  const [[lock]]=await db.execute("SELECT GET_LOCK('mdm_governance_responsibilities_v1',10) acquired");
  if(Number(lock.acquired)!==1)throw fail('DEPARTMENT_ACCOUNTABILITY_MIGRATION_BUSY');
  try{return await work();}finally{await db.execute("SELECT RELEASE_LOCK('mdm_governance_responsibilities_v1')");}
}
async function transaction(db,work) {
  await db.beginTransaction();let committing=false;
  try{const result=await work();committing=true;await db.commit();return result;}
  catch(error){if(!committing)await db.rollback();else throw fail('DEPARTMENT_ACCOUNTABILITY_COMMIT_UNKNOWN');throw error;}
}
async function applyDepartmentAccountabilityPolicy(db) {
  return locked(db,async()=>{
    const before=await inspectDepartmentAccountabilityPolicy(db);
    if(before.drift.length)throw fail('DEPARTMENT_ACCOUNTABILITY_SCHEMA_DRIFT',before);
    if(before.ready)return {...before,idempotent:true};
    if(before.missing.includes(POLICY_BACKUP_TABLE))await db.execute(SCHEMA_SQL);
    await transaction(db,async()=>{
      const role=(await rows(db,'SELECT CAST(role_id AS CHAR) role_id,role_code,role_name,description,model_version FROM roles WHERE role_code=? FOR UPDATE',[ROLE_CODE]))[0];
      const prior=(await rows(db,`SELECT status,snapshot_json FROM ${POLICY_BACKUP_TABLE} WHERE migration_key=? FOR UPDATE`,[POLICY_MIGRATION_KEY]))[0];
      const permissionDescriptions=await rows(db,'SELECT CAST(perm_id AS CHAR) perm_id,perm_code,description FROM permissions WHERE perm_code IN (?,?) FOR UPDATE',Object.keys(PERMISSION_DESCRIPTIONS));
      const snapshot={policy_version:POLICY_VERSION,role,permission_descriptions:permissionDescriptions,cutoffs:await cutoffs(db),grant_fingerprint:await grantFingerprint(db)};
      if(!prior)await db.execute(`INSERT INTO ${POLICY_BACKUP_TABLE}(migration_key,snapshot_json,status) VALUES (?,?,'prepared')`,[POLICY_MIGRATION_KEY,JSON.stringify(snapshot)]);
      else if(prior.status==='compensated'){
        const previous=JSON.parse(prior.snapshot_json);
        snapshot.previous_snapshots=[...(previous.previous_snapshots||[]),{...previous,previous_snapshots:undefined}];
        await db.execute(`UPDATE ${POLICY_BACKUP_TABLE} SET snapshot_json=?,status='prepared' WHERE migration_key=?`,[JSON.stringify(snapshot),POLICY_MIGRATION_KEY]);
      }
      // A new activation receives fresh cutoffs; earlier snapshots remain traceable.
      await db.execute('UPDATE roles SET role_name=?,description=? WHERE role_id=CAST(? AS SIGNED) AND role_code=?',[ROLE_NAME,ROLE_DESCRIPTION,role.role_id,ROLE_CODE]);
      for(const [code,description]of Object.entries(PERMISSION_DESCRIPTIONS))await db.execute('UPDATE permissions SET description=? WHERE perm_code=?',[description,code]);
      await db.execute(`UPDATE ${POLICY_BACKUP_TABLE} SET status='applied' WHERE migration_key=?`,[POLICY_MIGRATION_KEY]);
      await db.execute('INSERT IGNORE INTO schema_migrations(migration_key) VALUES (?)',[POLICY_MIGRATION_KEY]);
      const after=await inspectDepartmentAccountabilityPolicy(db);
      if(!after.ready)throw fail('DEPARTMENT_ACCOUNTABILITY_SCHEMA_DRIFT',after);
    });
    return inspectDepartmentAccountabilityPolicy(db);
  });
}
async function compensateDepartmentAccountabilityPolicy(db) {
  return locked(db,async()=>{
    const before=await inspectDepartmentAccountabilityPolicy(db);
    if(before.missing.length||before.drift.length)throw fail('DEPARTMENT_ACCOUNTABILITY_SCHEMA_DRIFT',before);
    return transaction(db,async()=>{
      await db.execute('SELECT migration_key FROM schema_migrations WHERE migration_key=? FOR UPDATE',[POLICY_MIGRATION_KEY]);
      const backup=(await rows(db,`SELECT status,snapshot_json FROM ${POLICY_BACKUP_TABLE} WHERE migration_key=? FOR UPDATE`,[POLICY_MIGRATION_KEY]))[0];
      if(!backup)throw fail('DEPARTMENT_ACCOUNTABILITY_BACKUP_REQUIRED');
      if(backup.status==='compensated')return {compensated:true,idempotent:true,retained_history:true};
      const snapshot=JSON.parse(backup.snapshot_json);
      const role=(await rows(db,'SELECT CAST(role_id AS CHAR) role_id,role_code,role_name,description,model_version FROM roles WHERE role_code=? FOR UPDATE',[ROLE_CODE]))[0];
      if(!role||role.role_id!==snapshot.role.role_id||role.model_version!==snapshot.role.model_version)throw fail('DEPARTMENT_ACCOUNTABILITY_COMPENSATION_BLOCKED');
      const currentCutoffs=await cutoffs(db),currentGrants=await grantFingerprint(db);
      if(JSON.stringify(currentCutoffs)!==JSON.stringify(snapshot.cutoffs)||JSON.stringify(currentGrants)!==JSON.stringify(snapshot.grant_fingerprint))throw fail('DEPARTMENT_ACCOUNTABILITY_COMPENSATION_BLOCKED');
      await db.execute('UPDATE roles SET role_name=?,description=? WHERE role_id=CAST(? AS SIGNED) AND role_code=?',[snapshot.role.role_name,snapshot.role.description,role.role_id,ROLE_CODE]);
      for(const permission of snapshot.permission_descriptions)await db.execute('UPDATE permissions SET description=? WHERE perm_id=CAST(? AS SIGNED) AND perm_code=?',[permission.description,permission.perm_id,permission.perm_code]);
      await db.execute(`UPDATE ${POLICY_BACKUP_TABLE} SET status='compensated' WHERE migration_key=?`,[POLICY_MIGRATION_KEY]);
      await db.execute('DELETE FROM schema_migrations WHERE migration_key=?',[POLICY_MIGRATION_KEY]);
      return {compensated:true,person_grants_changed:false,model_version_changed:false,retained_history:true,retained_tables:true};
    });
  });
}
module.exports={MIGRATION_KEY:POLICY_MIGRATION_KEY,MODEL_VERSIONS,SCHEMA_SQL,inspectDepartmentAccountabilityPolicy,applyDepartmentAccountabilityPolicy,compensateDepartmentAccountabilityPolicy};
