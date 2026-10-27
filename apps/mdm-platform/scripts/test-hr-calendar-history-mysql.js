// Synthetic HTTP regression in a new owner-labelled tmpfs database only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const appRoot=path.resolve(__dirname,'..'),artifacts=path.resolve(appRoot,'../../artifacts');
const arg=process.argv.indexOf('--output'),output=path.resolve(arg>=0?process.argv[arg+1]:path.join(artifacts,'hr-calendar-history-'+Date.now()));
assert(output.startsWith(artifacts+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[];
const sourceFiles=['server/identityMysqlRepository.js','server/governanceAccessMysqlRepository.js','server/publicationRepository.js','server/routes/publications.js'];
const sourceHashes=()=>sourceFiles.map(file=>({path:file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(appRoot,file))).digest('hex')}));
const beforeSources=sourceHashes();fs.writeFileSync(path.join(output,'sources-before.json'),JSON.stringify(beforeSources,null,2));
async function main(){await withStage05Fixture(async({pool,expect})=>{
  const [[stored]]=await pool.execute("SELECT CAST(pr.effective_from AS CHAR) effective_from,CAST(pr.effective_to AS CHAR) effective_to FROM person_roles pr JOIN roles r ON r.role_id=pr.role_id WHERE pr.person_id=83 AND r.role_code='department_contact'");
  const account=await expect('admin','/api/org/accounts/83','GET');
  const assignment=account.roleAssignments.find(role=>role.roleCode==='department_contact');
  const me=await expect('contact','/api/org/me','GET');
  const current=me.roleAssignments.find(role=>role.code==='department_contact');
  const history=await require('../server/identityMysqlRepository').makeIdentityMysqlRepository(pool).getAssignedRoles(83);
  assert.equal(assignment.effectiveFrom,stored.effective_from);assert.equal(assignment.effectiveTo,stored.effective_to);
  assert.equal(current.effectiveFrom,stored.effective_from);assert.equal(current.effectiveTo,stored.effective_to);
  assert.equal(history.find(role=>role.role_code==='department_contact').effective_from,stored.effective_from);
  assert.equal(history.find(role=>role.role_code==='department_contact').effective_to,stored.effective_to);
  const expired=account.roleAssignments.find(role=>role.roleCode==='data_quality_auditor');
  assert.equal(expired.effectiveFrom,'2020-02-29');assert.equal(expired.effectiveTo,'2020-03-01');
  assert(!me.roleCodes.includes('data_quality_auditor'));
  assert.equal(account.roleAssignments.find(role=>role.roleCode==='mdm_steward').effectiveTo,null);
  fs.writeFileSync(path.join(output,'calendar-read.json'),JSON.stringify({stored,accountRole:assignment,currentRole:current,historicalRoles:history,serverCurrentDate:account.server_current_date,nodeTimezone:Intl.DateTimeFormat().resolvedOptions().timeZone},null,2));
  checks.push('DATE fields retain exact stored calendar days in account, current identity and historical role reads; expired and open-ended grants keep their existing semantics');
  const directory=await expect('hr','/api/directory/v1?include_contacts=true','GET');
  const body={entity:'person',operation:'create',values:{employee_no:'HR1022CAL',person_name:'合成历史原姓名',current_department_id:'91',employment_status:'active',mobile:'',email:'',office_ids:[]},reason:'合成历史可辨识核对',expected_snapshot_hash:directory.snapshot_hash};
  const preview=await expect('hr','/api/directory/preview','POST',body);
  const saved=await expect('hr','/api/directory/changes','POST',{...body,request_hash:preview.request_hash,request_id:crypto.randomUUID()},201);
  const [[before]]=await pool.execute('SELECT payload_json,content_hash FROM mdm_publications WHERE id=?',[saved.id]);
  const [[eventBefore]]=await pool.execute("SELECT metadata_json FROM mdm_version_log WHERE entity_type='publication' AND entity_id=?",[saved.id]);
  await pool.execute('UPDATE person SET person_name=? WHERE person_id=?',['合成之后的新姓名',saved.entity_id]);
  const hrList=await expect('hr','/api/publications?kind=roster','GET');
  const summary=hrList.rows.find(row=>String(row.id)===String(saved.id)).history_summary;
  assert.deepEqual(summary,{entity:'person',operation:'create',before:null,after:{employee_no:'HR1022CAL',person_name:'合成历史原姓名'},reason:body.reason});
  for(const actor of ['admin','adminMulti','lead']){
    const list=await expect(actor,'/api/publications?kind=roster','GET');
    assert(list.rows.every(row=>!Object.hasOwn(row,'history_summary')));
    await expect(actor,'/api/publications/'+saved.id,'GET',undefined,403);
  }
  const adminOverlay=await expect('adminMulti','/api/org/me','GET');
  assert(adminOverlay.roleCodes.includes('admin'));assert(adminOverlay.roleCodes.includes('hr_directory_manager'));
  await expect('contact','/api/publications?kind=roster','GET',undefined,403);
  await expect('contact','/api/publications/'+saved.id,'GET',undefined,403);
  const [[after]]=await pool.execute('SELECT payload_json,content_hash FROM mdm_publications WHERE id=?',[saved.id]);
  const [[eventAfter]]=await pool.execute("SELECT metadata_json FROM mdm_version_log WHERE entity_type='publication' AND entity_id=?",[saved.id]);
  assert.deepEqual(after,before);assert.deepEqual(eventAfter,eventBefore);
  checks.push('only directory-maintenance readers receive direct-change historical names; later renaming does not rewrite the saved summary, payload, hash or event');
  await pool.execute("INSERT INTO mdm_publications(publication_ref,request_id,kind,dataset_key,title,version_no,source_file_name,content_hash,payload_json,row_count,published_by_person_id) VALUES (?,?, 'roster','roster','人员目录直接维护',2,'directory-change.json',?,'{}',1,19081)",[crypto.randomUUID(),crypto.randomUUID(),'a'.repeat(64)]);
  const oldList=await expect('hr','/api/publications?kind=roster','GET');
  assert.equal(oldList.rows[0].history_summary,null);
  assert.equal(oldList.rows.find(row=>String(row.id)===String(saved.id)).history_summary.after.person_name,'合成历史原姓名');
  checks.push('old direct-maintenance rows without historical audit identity remain explicitly missing without blocking other rows');
  for(const [id,number,name] of [['9007199254741001','LARGE-A','合成大编号甲'],['9007199254741002','LARGE-B','合成大编号乙']]){
    await pool.execute("INSERT INTO mdm_publications(id,publication_ref,request_id,kind,dataset_key,title,version_no,source_file_name,content_hash,payload_json,row_count,published_by_person_id) VALUES (?,?,?,'roster','roster','人员目录直接维护',?,'directory-change.json',?,'{}',1,19081)",[id,crypto.randomUUID(),crypto.randomUUID(),number==='LARGE-A'?3:4,'a'.repeat(64)]);
    await pool.execute("INSERT INTO mdm_version_log(entity_type,entity_id,operation,operated_by_person_id,metadata_json) VALUES('publication',?,'directory_change',19081,?)",[id,JSON.stringify({entity:'person',operation:'create',after:{employee_no:number,person_name:name},reason:'合成大编号准确读取'})]);
  }
  const largeList=await expect('hr','/api/publications?kind=roster','GET');
  assert.equal(largeList.rows.find(row=>String(row.id)==='9007199254741001').history_summary.after.employee_no,'LARGE-A');
  assert.equal(largeList.rows.find(row=>String(row.id)==='9007199254741002').history_summary.after.employee_no,'LARGE-B');
  checks.push('large publication identities resolve their own recorded summary without rounding to an adjacent record');
  fs.writeFileSync(path.join(output,'history-read.json'),JSON.stringify({summary,legacySummary:oldList.rows[0].history_summary,checkedActors:['hr','admin','adminMulti','lead','contact'],adminOverlayRoles:adminOverlay.roleCodes,publishedPayloadAndEventUnchanged:true},null,2));
  const afterSources=sourceHashes();assert.deepEqual(afterSources,beforeSources);fs.writeFileSync(path.join(output,'sources-after.json'),JSON.stringify(afterSources,null,2));
  fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:true,checks},null,2));
},{randomDatabase:true,evidenceDir:output,beforeStart:async({pool})=>{
  await pool.execute("UPDATE person_roles SET effective_from=CURRENT_DATE,effective_to='2099-12-31' WHERE person_id=83");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from,effective_to) SELECT 83,role_id,'global','合成旧授权','2020-02-29','2020-03-01' FROM roles WHERE role_code='data_quality_auditor'");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from,effective_to) SELECT 83,role_id,'global','合成无结束日期授权',CURRENT_DATE,NULL FROM roles WHERE role_code='mdm_steward'");
  await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,authorization_basis,effective_from) SELECT 88,role_id,'global','合成管理员叠加人事只读核对',CURRENT_DATE FROM roles WHERE role_code='hr_directory_manager'");
}});console.log('HR_CALENDAR_HISTORY_PASS '+checks.length);}
main().catch(error=>{fs.writeFileSync(path.join(output,'failure.txt'),error.stack);console.error(error.stack);process.exitCode=1;});
