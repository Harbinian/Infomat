// Read-only discovery for the browser workspace. Existing resource readers and
// authority checks decide visibility; list membership never grants write access.
const {failure,id}=require('./dataMapHandoffPolicy');
const {readSnapshot,readControl}=require('./dataMapHandoffControl');
const {handoffActor,probeHandoffActor,inspectHandoffAccessModel}=require('./dataMapHandoffAuthority');
const {sessionSubject}=require('./sessionSubject');
const {inspectHandoffSchema,statements,CONTRACT_VERSION}=require('./dataMapHandoffSchema');
const {projectHandoffWorkItems}=require('./dataMapHandoffWorkItems');
const {selectSnapshot}=require('./dataMapHandoffReadSnapshot');
const one=async(db,sql,args=[])=>(await db.execute(sql,args))[0][0]||null;
const rows=async(db,sql,args=[])=>(await db.execute(sql,args))[0];
const hidden=error=>[403,404].includes(error.statusCode);
function createHandoffWorkbench(pool,repository,{env=process.env}={}){
 async function read(session){
  const result=await readSnapshot(pool,async db=>{
   if(!['0','1'].includes(String(env.DATA_MAP_HANDOFF_ENABLED||'0'))||!['0','1'].includes(String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')))throw failure('HANDOFF_CONFIGURATION_INVALID',503);
   const enabled=String(env.DATA_MAP_HANDOFF_ENABLED||'0')==='1',readOnly=String(env.PROCESS_DATA_GOVERNANCE_READ_ONLY||'0')==='1';
   const tableNames=statements().map(sql=>sql.match(/^CREATE TABLE IF NOT EXISTS (\w+)/)[1]);
   const installed=await rows(db,`SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN (${tableNames.map(()=>'?').join(',')})`,tableNames);
   // An explicitly disabled, uninstalled module must not break the existing
   // workbench. A prepared module's schema/identity errors still fail closed.
   const schema=installed.length?await inspectHandoffSchema(db):{ready:false,tables:tableNames.map(table=>({table,status:'missing'}))};
   if(!schema.ready){
    if(enabled||schema.tables.some(x=>x.status==='drifted')||!schema.tables.some(x=>x.status==='missing'))throw failure('HANDOFF_SCHEMA_UNAVAILABLE',503);
    const missing=schema.tables.find(x=>x.status==='missing').table;
    // information_schema hides inaccessible tables. Confirm actual absence
    // through one fixed contract table; permission errors are not "uninstalled".
    if(!tableNames.includes(missing))throw failure('HANDOFF_SCHEMA_UNAVAILABLE',503);
    try{await db.execute('SELECT 1 FROM `'+missing+'` WHERE 1=0');throw failure('HANDOFF_SCHEMA_UNAVAILABLE',503);}
    catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;}
    return {capabilities:{contract_version:CONTRACT_VERSION,enabled,read_only:readOnly,schema_ready:false,global_source_read:false,role_codes:[]},
      availability:{state:'not_prepared',code:'HANDOFF_SCHEMA_NOT_PREPARED'},packages:[],conflict_ids:[],fact_ids:[]};
   }
   const control=await readControl(selectSnapshot(db)),model=await inspectHandoffAccessModel(db,{lock:false}),subject=sessionSubject(session);
   let identity;
   if(subject.kind==='system_admin')identity=await handoffActor(db,session,'read',{lock:false});
   else{
    // Discovery uses a consistent snapshot throughout qualification probes.
    // Actual mutations separately retain their locked authority path.
    const authority=await require('./identityMysqlRepository').readPersonAuthority(db,session,id(subject.personId),{currentRead:false,includeFieldConstraints:true,accessModelVersion:model});
    if(!authority.valid||!authority.department||authority.department.status!=='active'||authority.user?.employment_status!=='active')throw failure('HANDOFF_ACCESS_CHANGED',401);
    identity={roleCodes:authority.roleCodes,permissions:authority.permissions};
   }
   const capabilities={contract_version:CONTRACT_VERSION,enabled,read_only:readOnly,cutover_state:control.cutover_state,
    schema_ready:true,access_model:model,role_codes:[...identity.roleCodes]};
   capabilities.global_source_read=false;
   try{await handoffActor(db,session,'read',{lock:false});capabilities.global_source_read=true;}catch(error){if(!hidden(error))throw error;}
   const writable=capabilities.enabled&&!capabilities.read_only&&control.cutover_state==='controlled'&&capabilities.schema_ready;
   const packages=[];
   const candidates=await rows(db,`SELECT CAST(p.id AS CHAR) package_id,p.package_ref,CAST(p.process_version_id AS CHAR) process_version_id,p.status,p.revision_no,
    p.source_content_hash,p.rule_version,v.document_title,v.version_no,v.schema_version,CAST(v.document_id AS CHAR) document_id
    FROM process_data_governance_work_packages p JOIN process_design_versions v ON v.id=p.process_version_id ORDER BY p.id DESC`);
   for(const pkg of candidates){
    try{await handoffActor(db,session,'read',{packageId:pkg.package_id,lock:false});}catch(error){if(hidden(error))continue;throw error;}
    const allowed=['read'];
    if(writable)for(const action of ['prepare','review']){
     try{await probeHandoffActor(db,session,action,{packageId:pkg.package_id,writeFields:[]});allowed.push(action);}catch(error){if(!hidden(error))throw error;}
    }
    const head=await one(db,'SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=?',[pkg.package_id]);
    const drafts=await rows(db,`SELECT d.handoff_id,d.current_revision revision,d.state,d.current_approval_id,r.binding_id FROM data_map_handoff_drafts d
     JOIN data_map_handoff_revisions r ON r.handoff_id=d.handoff_id AND r.revision_no=d.current_revision WHERE d.package_id=? ORDER BY d.created_at,d.handoff_id`,[pkg.package_id]);
    const publications=await rows(db,`SELECT p.publication_id,p.scope_mode,r.handoff_id,r.revision_no revision,r.binding_id FROM data_map_publications p
     JOIN data_map_handoff_revisions r ON r.revision_id=p.handoff_revision_id WHERE JSON_UNQUOTE(JSON_EXTRACT(p.manifest_json,'$.package_id'))=? ORDER BY p.publication_id`,[pkg.package_id]);
    const intakes=await rows(db,'SELECT intake_id,current_revision revision,state FROM process_data_governance_intakes WHERE package_id=? ORDER BY created_at,intake_id',[pkg.package_id]);
    const corrections=await rows(db,'SELECT correction_id,current_revision revision,state,replaces_binding_id FROM process_data_governance_corrections WHERE package_id=? ORDER BY created_at,correction_id',[pkg.package_id]);
    packages.push({...pkg,binding_id:head?.binding_id||null,drafts,publications,intakes,corrections,allowed_actions:allowed});
   }
   const availability=!enabled?{state:'disabled',code:'HANDOFF_DISABLED'}:readOnly?{state:'read_only',code:'HANDOFF_READ_ONLY'}:control.cutover_state!=='controlled'?{state:'maintenance',code:'HANDOFF_MAINTENANCE'}:{state:'available',code:null};
   return {capabilities,availability,packages,conflict_ids:await rows(db,'SELECT conflict_id FROM data_map_handoff_conflicts ORDER BY conflict_id'),
    fact_ids:await rows(db,"SELECT DISTINCT fact_id FROM process_data_governance_fact_versions WHERE correction_id IS NOT NULL OR intake_id IS NOT NULL OR JSON_UNQUOTE(JSON_EXTRACT(snapshot_json,'$.parent_kind'))='handoff_conflict' ORDER BY fact_id")};
  });
  // Each reader takes its own short controlled snapshot and rechecks current
  // scope. Do not nest a second connection under the metadata/authority locks.
  const conflicts=[],facts=[],drafts=[];
  for(const pkg of result.packages)for(const item of pkg.drafts){
   try{drafts.push(await repository.get(item.handoff_id,session));}catch(error){if(!hidden(error))throw error;}
  }
  for(const item of result.conflict_ids){
   try{
    const value=await repository.getConflict(item.conflict_id,session);
    conflicts.push({conflict_id:value.conflict_id,handoff_id:value.handoff_id,package_id:value.package_id,revision:value.revision,state:value.state,
     difference:value.conflict?.difference||null,severity:value.conflict?.severity||null,allowed_actions:value.allowed_actions});
   }catch(error){if(!hidden(error))throw error;}
  }
  for(const item of result.fact_ids){try{facts.push(await repository.getFact(item.fact_id,session));}catch(error){if(!hidden(error))throw error;}}
  const mayPrepare=result.packages.some(x=>x.allowed_actions.includes('prepare'));
  const mayEscalate=conflicts.some(x=>x.allowed_actions.includes('escalate'));
  const options={departments:[],handlers:[],deciders:[]};
  if(mayPrepare||mayEscalate)await readSnapshot(pool,async db=>{
   await readControl(selectSnapshot(db));
   // Recheck why this caller may see the minimal selection options now.
   if(mayPrepare){const pkg=result.packages.find(x=>x.allowed_actions.includes('prepare'));await probeHandoffActor(db,session,'prepare',{packageId:pkg.package_id,writeFields:[]});}
   else{const conflict=conflicts.find(x=>x.allowed_actions.includes('escalate'));await probeHandoffActor(db,session,'escalate',{packageId:conflict.package_id,conflictId:conflict.conflict_id,writeFields:[]});}
   if(mayPrepare)options.departments=await rows(db,"SELECT CAST(id AS CHAR) id,name FROM departments WHERE status='active' ORDER BY id");
   const select=async role=>rows(db,`SELECT DISTINCT CAST(p.person_id AS CHAR) person_id,p.person_name
    FROM person p JOIN user_accounts a ON a.person_id=p.person_id JOIN person_roles pr ON pr.person_id=p.person_id
    JOIN roles r ON r.role_id=pr.role_id JOIN departments d ON d.id=p.current_department_id
    WHERE p.status='active' AND p.employment_status='active' AND a.account_status='active' AND a.must_change_password=0 AND d.status='active'
    AND pr.assignment_status='active' AND pr.effective_from IS NOT NULL AND pr.effective_from<=CURRENT_DATE AND (pr.effective_to IS NULL OR pr.effective_to>=CURRENT_DATE)
    AND r.role_code=? AND r.status='active' AND r.model_version=?
    AND NOT EXISTS(SELECT 1 FROM person_roles ar JOIN roles rr ON rr.role_id=ar.role_id WHERE ar.person_id=p.person_id
      AND ar.assignment_status='active' AND (ar.effective_from IS NULL OR ar.effective_from<=CURRENT_DATE) AND (ar.effective_to IS NULL OR ar.effective_to>=CURRENT_DATE) AND rr.role_code='admin')
    ORDER BY person_id`,[role,result.capabilities.access_model]);
   if(mayPrepare)options.handlers=await select('data_conflict_handler');
   options.deciders=await select('decision_group');
  });
  const workItems=projectHandoffWorkItems({...result,drafts,conflicts,facts});
  return {capabilities:result.capabilities,availability:result.availability,packages:result.packages,conflicts,facts,options,work_items:workItems,truncated:false};
 }
 return {read};
}
module.exports={createHandoffWorkbench};
