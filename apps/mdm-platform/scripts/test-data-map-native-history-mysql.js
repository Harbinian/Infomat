// Input: a new owner-labelled tmpfs loopback MySQL created by freshMysql.
// Output: inspectable synthetic results below artifacts; all owned DBs removed.
// Side effects never include an existing DB, service, feature or formal data.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed}=require('./testHelpers/dataMapHandoffFixture');
const {makeProcessDataGovernanceRepository}=require('../server/processDataGovernanceRepository');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {digest}=require('../server/dataMapHandoffPolicy');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-02/native-history-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const checks=[],oldEnv=Object.fromEntries(['DATA_MAP_HANDOFF_ENABLED','PROCESS_DATA_GOVERNANCE_READ_ONLY'].map(key=>[key,process.env[key]]));
let owned,passed=false,failure;
async function check(name,action){await action();checks.push(name);console.log('PASS '+name);}
const uuid=()=>({request_id:crypto.randomUUID()});
async function main(){
  process.env.DATA_MAP_HANDOFF_ENABLED='0';process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='0';
  try{
    await withFreshMysql(async target=>{
      const {pool}=target;owned={owner:target.owner,database:target.database,port:target.port,containerId:target.containerId,storage:'tmpfs',address:'loopback'};
      const {session,packageSeed}=await seed(target),repo=makeProcessDataGovernanceRepository(pool),handoff=createDataMapHandoffRepository(pool);
      const read=async(sql,args=[])=>(await pool.execute(sql,args))[0];
      const revision=async pkg=>Number((await read('SELECT revision_no FROM process_data_governance_work_packages WHERE id=?',[pkg]))[0].revision_no);
      const details=async id=>read('SELECT detail_version_id,CAST(detail_id AS CHAR) detail_id,revision_no,snapshot_json,snapshot_digest,history_completeness,request_id,actor_json FROM process_data_governance_detail_versions WHERE detail_id=CAST(? AS SIGNED) ORDER BY revision_no',[String(id)]);
      const facts=async id=>read('SELECT fact_version_id,fact_id,revision_no,snapshot_json,snapshot_digest,request_id,actor_json FROM process_data_governance_fact_versions WHERE fact_id=? ORDER BY revision_no',[String(id)]);
      const decide=(pkg,rev,basis,options=uuid(),actor=session(12))=>repo.updateDetail(String(pkg),String(pkg),rev,{status:'confirmed',governance:{basis,nested:{value:basis}},responsible_department_id:'91'},actor,options);
      const askBody=pkg=>({detail_id:String(pkg),target_department_id:'91',requested_fact_type:'actual_fact',question_text:'Synthetic targeted question',request_reason:'Synthetic fact missing'});
      await packageSeed(701,{status:'mdm_governing'});
      await pool.execute("UPDATE process_data_governance_details SET revision_no=7,governance_json='{\"basis\":\"existing unrecorded old decision\"}',created_by_person_id=11,updated_by_person_id=15,updated_at='2026-01-01 08:00:00' WHERE id=701");
      const [legacyMetadata]=await read('SELECT updated_at FROM process_data_governance_details WHERE id=701');
      let first,firstRequest=uuid();
      await check('first native change captures only the actual legacy revision and appends the new revision, without fabricated earlier history',async()=>{
        first=await decide(701,1,'Synthetic first native decision',firstRequest);
        const versions=await details(701);assert.deepEqual(versions.map(x=>x.revision_no),[7,8]);
        assert.deepEqual(versions.map(x=>x.history_completeness),['captured_current_only','append_only_since_native_write']);
        assert.equal(versions[0].snapshot_json.governance.basis,'existing unrecorded old decision');
        assert(versions.every(x=>x.request_id===firstRequest.request_id&&digest(x.snapshot_json)===x.snapshot_digest));
        assert.equal(versions[0].actor_json.recorded_as,'capturing_actor_not_original_historical_author');assert.equal(await revision(701),2);
        assert.equal(versions[0].actor_json.original_projection_metadata.updated_by_person_id,'15');
        assert.equal(versions[0].actor_json.original_projection_metadata.updated_at,legacyMetadata.updated_at.toISOString());
        assert.deepEqual(versions[1].actor_json.previous_projection_metadata,versions[0].actor_json.original_projection_metadata);
        assert.equal(versions[1].actor_json.recorded_as,'current_write_actor');
      });
      await check('second native decision preserves prior immutable rows and same UUID replay returns the original receipt',async()=>{
        const saved=await details(701),next=await decide(701,2,'Synthetic second decision');
        assert.equal(next.package.revision_no,3);assert.deepEqual((await details(701)).slice(0,2),saved);
        assert.deepEqual(await decide(701,1,'Synthetic first native decision',firstRequest),first);
        await assert.rejects(decide(701,1,'Changed payload',firstRequest),{code:'HANDOFF_REQUEST_PAYLOAD_CONFLICT'});
        assert.equal((await details(701)).length,3);assert.equal(await revision(701),3);
      });
      let question,askId=uuid(),answer,answerId=uuid(),closed,closeId=uuid();
      await pool.execute('ALTER TABLE process_data_governance_fact_requests AUTO_INCREMENT=9007199254740993');
      await check('targeted fact creation preserves exact BIGINT identity and captures detail transition and immutable open fact atomically',async()=>{
        question=await repo.createFactRequest('701',3,askBody(701),session(12),askId);
        assert.equal(question.fact_request.id,'9007199254740993');assert.equal(question.fact_request.status,'open');
        assert.equal((await facts(question.fact_request.id))[0].snapshot_json.status,'open');assert.equal((await details(701)).at(-1).snapshot_json.status,'needs_business_fact');
        assert.deepEqual(await repo.createFactRequest('701',3,askBody(701),session(12),askId),question);
      });
      await check('target department answer appends the next immutable fact and can read or replay its receipt while handoff feature is off',async()=>{
        const input={answer_text:'Synthetic actual answer',evidence_ref:'synthetic:evidence'};
        answer=await repo.respondFactRequest(question.fact_request.id,4,input,session(14),answerId);
        assert.equal(answer.fact_request.status,'answered');assert.deepEqual((await facts(question.fact_request.id)).map(x=>x.snapshot_json.status),['open','answered']);
        assert.deepEqual(await repo.respondFactRequest(question.fact_request.id,4,input,session(14),answerId),answer);
        const receipt=await handoff.receipt(answerId.request_id,session(14));assert.equal(receipt.state,'committed');assert.deepEqual(receipt.result,answer);
        // The currently assigned MDM worker can read this package's answer,
        // while receipt lookup itself never extends that assignment scope.
        assert.deepEqual((await handoff.receipt(answerId.request_id,session(12))).result,answer);
        await pool.execute("UPDATE process_governance_responsibilities SET person_id=15 WHERE target_type='work_package' AND target_id=701");
        await assert.rejects(handoff.receipt(answerId.request_id,session(12)),{code:'HANDOFF_ACTION_DENIED'});
        await pool.execute("UPDATE process_governance_responsibilities SET person_id=12 WHERE target_type='work_package' AND target_id=701");
        await pool.execute("INSERT INTO person(person_id,employee_no,person_name,current_department_id) VALUES(16,'HANDOFF_SYN_16','Synthetic other department contact',92)");
        await pool.execute("INSERT INTO user_accounts(account_id,person_id,login_name,password_hash,account_status) VALUES(116,16,'HANDOFF_SYN_16','unusable-synthetic-hash','active')");
        await pool.execute("INSERT INTO person_roles(person_id,role_id,scope_type,scope_department_id,authorization_basis,effective_from) SELECT 16,role_id,'department',92,'synthetic other department',CURRENT_DATE FROM roles WHERE role_code='department_contact'");
        await assert.rejects(handoff.receipt(answerId.request_id,{personId:'16',accountId:'116',authVersion:'1'}),{code:'HANDOFF_ACTION_DENIED'});
      });
      await check('MDM closure preserves answer, appends closure basis, returns detail to pending and supports original UUID lookup',async()=>{
        closed=await repo.closeFactRequest(question.fact_request.id,5,{basis:'Synthetic answer adopted'},session(12),closeId);
        const versions=await facts(question.fact_request.id);assert.deepEqual(versions.map(x=>x.snapshot_json.status),['open','answered','closed']);assert.equal(versions[2].snapshot_json.close_basis,'Synthetic answer adopted');
        assert.equal((await details(701)).at(-1).snapshot_json.status,'pending');
        assert.deepEqual(await repo.closeFactRequest(question.fact_request.id,5,{basis:'Synthetic answer adopted'},session(12),closeId),closed);
        assert.deepEqual((await handoff.receipt(closeId.request_id,session(12))).result,closed);
        await assert.rejects(repo.closeFactRequest(question.fact_request.id,6,{basis:'Forbidden department close'},session(14),uuid()),{code:'HANDOFF_FACT_NOT_ANSWERED'});
      });
      await check('prepared receipt paired with already committed numeric native fact versions is rejected as inconsistent',async()=>{
        const [original]=await read('SELECT result_json,finished_at FROM data_map_handoff_requests WHERE request_id=?',[answerId.request_id]);
        await pool.execute("UPDATE data_map_handoff_requests SET state='prepared',result_json=NULL,finished_at=NULL WHERE request_id=?",[answerId.request_id]);
        await assert.rejects(handoff.receipt(answerId.request_id,session(14)),{code:'HANDOFF_RECEIPT_INCONSISTENT'});
        await pool.execute("UPDATE data_map_handoff_requests SET state='committed',result_json=?,finished_at=? WHERE request_id=?",[JSON.stringify(original.result_json),original.finished_at,answerId.request_id]);
      });
      await check('final original review fixes the latest detail and closed fact versions and does not rewrite their earlier history',async()=>{
        await decide(701,6,'Synthetic final confirmed decision');const before=await details(701),factBefore=await facts(question.fact_request.id);
        const completed=await repo.completeWorkPackage('701',7,'Synthetic final workgroup review',session(11),uuid());
        const [binding]=await read('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[completed.handoff.binding_id]);
        assert.equal(binding.snapshot_json.detail_versions[0].detail_version_id,before.at(-1).detail_version_id);
        assert.equal(binding.snapshot_json.current_fact_versions[0].fact_version_id,factBefore.at(-1).fact_version_id);
        assert.equal(binding.snapshot_json.facts[0].close_basis,'Synthetic answer adopted');assert.equal(binding.snapshot_json.facts[0].status,'closed');
        assert.deepEqual(await details(701),before);assert.deepEqual(await facts(question.fact_request.id),factBefore);
        await assert.rejects(decide(701,8,'Completed immutable package'),{code:'PROCESS_DATA_GOVERNANCE_PACKAGE_READ_ONLY'});
        assert.equal((await read('SELECT state FROM data_map_handoff_generation_tasks WHERE task_id=?',[completed.handoff.task_id]))[0].state,'pending');
      });
      await packageSeed(702,{status:'mdm_governing'});
      await check('all six native write actions explicitly reject missing UUID and leave physical data unchanged',async()=>{
        await assert.rejects(decide(702,1,'Missing UUID',{}),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        await assert.rejects(repo.createFactRequest('702',1,askBody(702),session(12)),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        await assert.rejects(repo.respondFactRequest(question.fact_request.id,8,{answer_text:'Missing'},session(14)),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        await assert.rejects(repo.closeFactRequest(question.fact_request.id,8,{basis:'Missing'},session(12)),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        await assert.rejects(repo.generateCandidates('702',1,session(12)),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        await assert.rejects(repo.completeWorkPackage('702',1,'Missing',session(11)),{code:'PROCESS_DATA_GOVERNANCE_REQUEST_ID_REQUIRED'});
        assert.equal(await revision(702),1);assert.deepEqual(await details(702),[]);
      });
      await check('revision conflict is a rejected original receipt without an audit or projection write',async()=>{
        const request=uuid();await assert.rejects(decide(702,9,'Stale revision',request),{code:'PROCESS_DATA_GOVERNANCE_REVISION_CONFLICT'});
        assert.equal((await handoff.receipt(request.request_id,session(12))).state,'rejected');assert.equal(await revision(702),1);assert.deepEqual(await details(702),[]);
      });
      await check('admin overlap, unassigned steward and department cannot form native governance conclusions',async()=>{
        for(const actor of [session(13),session(14)]) await assert.rejects(decide(702,1,'Forbidden actor',uuid(),actor),error=>['HANDOFF_ADMIN_READ_ONLY','HANDOFF_ACTION_DENIED'].includes(error.code));
        await pool.execute('UPDATE process_governance_responsibilities SET person_id=15 WHERE target_type=\'work_package\' AND target_id=702');
        await assert.rejects(decide(702,1,'No current assignment'),{code:'HANDOFF_ACTION_DENIED'});
        await pool.execute('UPDATE process_governance_responsibilities SET person_id=12 WHERE target_type=\'work_package\' AND target_id=702');
        assert.deepEqual(await details(702),[]);
      });
      await check('actual readonly field constraints include nested governance leaf and parent paths',async()=>{
        for(const field of ['governance.nested.value','governance','details.governance.nested.value','basis']){
          await pool.execute("UPDATE permissions SET field_constraints=? WHERE perm_code='governance:handle-assigned-work'",[JSON.stringify({readonly:[field]})]);
          await assert.rejects(decide(702,1,'Readonly field'),{code:'HANDOFF_FIELDS_READ_ONLY'});
        }
        await pool.execute("UPDATE permissions SET field_constraints=NULL WHERE perm_code='governance:handle-assigned-work'");assert.deepEqual(await details(702),[]);
      });
      await check('fixed source digest drift blocks registration and never rewrites the old digest or audit history',async()=>{
        const [original]=await read('SELECT content_hash FROM process_design_versions WHERE id=702');
        await pool.execute("UPDATE process_design_versions SET content_hash=REPEAT('a',64) WHERE id=702");
        await assert.rejects(decide(702,1,'Source changed'),{code:'HANDOFF_CONTENT_INTEGRITY_CONFLICT'});
        assert.deepEqual(await details(702),[]);assert.equal(await revision(702),1);
        await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=702',[original.content_hash]);
      });
      await check('READ_ONLY denies every native write before acquiring a business connection',async()=>{
        process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='1';let leases=0;const blocked=makeProcessDataGovernanceRepository({getConnection(){leases++;throw Error('must not connect');}});
        for(const action of [()=>blocked.updateDetail('702','702',1,{status:'confirmed',governance:{basis:'readonly'}},session(12),uuid()),()=>blocked.createFactRequest('702',1,askBody(702),session(12),uuid()),()=>blocked.respondFactRequest('1',1,{answer_text:'readonly'},session(14),uuid()),()=>blocked.closeFactRequest('1',1,{basis:'readonly'},session(12),uuid()),()=>blocked.generateCandidates('702',1,session(12),uuid()),()=>blocked.completeWorkPackage('702',1,'readonly',session(11),uuid())]) await assert.rejects(action,{code:'PROCESS_DATA_GOVERNANCE_READ_ONLY'});
        assert.equal(leases,0);process.env.PROCESS_DATA_GOVERNANCE_READ_ONLY='0';
      });
      await check('failure after the mutable update rolls it and before/after history back with no success receipt',async()=>{
        const request=uuid();let injected=false;const injecting={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(connection,key){if(key==='execute')return async(sql,args)=>{if(sql.includes('INSERT INTO process_data_governance_detail_versions')&&args[2]===2){injected=true;throw Object.assign(new Error('synthetic append failure'),{code:'SYNTHETIC_NATIVE_APPEND_FAILURE'});}return connection.execute(sql,args);};return typeof connection[key]==='function'?connection[key].bind(connection):connection[key];}});}};
        const broken=makeProcessDataGovernanceRepository(injecting);await assert.rejects(broken.updateDetail('702','702',1,{status:'confirmed',governance:{basis:'Rollback synthetic'}},session(12),request),{code:'SYNTHETIC_NATIVE_APPEND_FAILURE'});
        assert(injected);assert.equal(await revision(702),1);assert.deepEqual(await details(702),[]);assert.equal((await handoff.receipt(request.request_id,session(12))).state,'prepared');
        assert.equal((await read('SELECT governance_json FROM process_data_governance_details WHERE id=702'))[0].governance_json.basis,'synthetic confirmed fact');
      });
      await check('source withdrawal and authorization drift between prepared and business transactions fail closed',async()=>{
        for(const kind of ['source','authorization']){
          const request=uuid();let commits=0;const drifting={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(connection,key){if(key==='commit')return async()=>{await connection.commit();if(++commits===1){if(kind==='source')await pool.execute("UPDATE process_design_versions SET status='retired' WHERE id=702");else await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE account_id=112');}};return typeof connection[key]==='function'?connection[key].bind(connection):connection[key];}});}};
          await assert.rejects(makeProcessDataGovernanceRepository(drifting).updateDetail('702','702',1,{status:'confirmed',governance:{basis:'Drift'}},session(12),request),error=>['HANDOFF_SOURCE_NOT_FIXED','HANDOFF_SOURCE_DIGEST_MISMATCH','HANDOFF_ACCESS_CHANGED'].includes(error.code));
          if(kind==='source')await pool.execute("UPDATE process_design_versions SET status='published' WHERE id=702");else await pool.execute('UPDATE user_accounts SET auth_version=1 WHERE account_id=112');
          assert.deepEqual(await details(702),[]);assert.equal(await revision(702),1);
        }
      });
      await check('actual lost commit acknowledgement is recovered through original UUID without duplicating versions',async()=>{
        const request=uuid();let business=false,rolledBack=0,destroyed=0;const losing={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(connection,key){if(key==='execute')return async(sql,args)=>{if(sql.includes("SET state='committed',result_json"))business=true;return connection.execute(sql,args);};if(key==='commit')return async()=>{await connection.commit();if(business)throw Error('synthetic lost ACK');};if(key==='rollback')return async()=>{if(business)rolledBack++;return connection.rollback();};if(key==='destroy')return()=>{destroyed++;connection.destroy();};return typeof connection[key]==='function'?connection[key].bind(connection):connection[key];}});}};
        const payload={status:'confirmed',governance:{basis:'Lost ACK'}};await assert.rejects(makeProcessDataGovernanceRepository(losing).updateDetail('702','702',1,payload,session(12),request),{code:'HANDOFF_COMMIT_UNKNOWN'});
        assert.equal(rolledBack,0);assert.equal(destroyed,1);const receipt=await handoff.receipt(request.request_id,session(12));assert.equal(receipt.state,'committed');
        assert.deepEqual(await repo.updateDetail('702','702',1,payload,session(12),request),receipt.result);assert.equal((await details(702)).length,2);
      });
      await packageSeed(703,{status:'mdm_governing'});
      await check('legacy unversioned answered fact is captured as current only, then closed without fabricating its missing open history',async()=>{
        await pool.execute("INSERT INTO process_data_governance_fact_requests(request_ref,work_package_id,detail_id,target_department_id,requested_fact_type,question_text,request_reason,status,answer_text,requested_by_person_id,answered_by_person_id) VALUES('native-old-answered',703,703,91,'actual','Old question','Old reason','answered','Old recorded answer',12,14)");
        const id=(await read("SELECT CAST(id AS CHAR) id FROM process_data_governance_fact_requests WHERE request_ref='native-old-answered'"))[0].id;
        await repo.closeFactRequest(id,1,{basis:'Capture old answer without invention'},session(12),uuid());
        const chain=await facts(id);assert.deepEqual(chain.map(x=>x.snapshot_json.status),['answered','closed']);assert.equal(chain[0].snapshot_json.history_completeness,'captured_current_only');assert.equal(chain[0].snapshot_json.answered_at,null);assert.equal(chain[1].snapshot_json.close_basis,'Capture old answer without invention');
      });
      await packageSeed(704,{status:'mdm_governing'});
      await check('candidate creation adds immutable initial revisions and repeated generation never mutates existing decisions',async()=>{
        await pool.execute('UPDATE process_data_governance_work_packages SET rule_version=? WHERE id=704',[require('../server/processDataGovernance').RULE_VERSION]);
        const request=uuid(),result=await repo.generateCandidates('704',1,session(12),request);assert(result.created>0);
        const captured=await read('SELECT v.* FROM process_data_governance_detail_versions v JOIN process_data_governance_details d ON d.id=v.detail_id WHERE d.work_package_id=704 ORDER BY v.detail_version_id');assert.equal(captured.length,result.created);assert(captured.every(v=>v.history_completeness==='native_created_append_only'));
        assert.deepEqual(await repo.generateCandidates('704',1,session(12),request),result);
        const repeated=await repo.generateCandidates('704',2,session(12),uuid());assert.equal(repeated.created,0);assert.deepEqual(await read('SELECT v.* FROM process_data_governance_detail_versions v JOIN process_data_governance_details d ON d.id=v.detail_id WHERE d.work_package_id=704 ORDER BY v.detail_version_id'),captured);
      });
      await check('native package, detail, source and fact identities above safe integer remain exact throughout audit and receipts',async()=>{
        const large='9007199254741199';await packageSeed(large,{status:'mdm_governing'});const result=await decide(large,1,'Exact native IDs');
        assert.equal(result.package.id,large);assert.equal(result.package.process_version_id,large);assert.equal(result.detail.id,large);assert.equal(result.detail.work_package_id,large);assert.equal((await details(large))[0].snapshot_json.detail_id,large);
        const full=await repo.getWorkPackageDetail(large);assert.equal(full.package.process_version_id,large);assert.equal(full.source_version.process_version_id,large);assert.equal(full.details[0].id,large);
      });
      await packageSeed(805,{status:'mdm_governing'});
      await check('fact answer to another department and department self-closure are denied with no extra versions',async()=>{
        const wrong=await repo.createFactRequest('805',1,{...askBody(805),target_department_id:'92'},session(12),uuid());
        await assert.rejects(repo.respondFactRequest(wrong.fact_request.id,2,{answer_text:'Wrong department'},session(14),uuid()),{code:'HANDOFF_ACTION_DENIED'});
        assert.equal((await facts(wrong.fact_request.id)).length,1);
        await packageSeed(806,{status:'mdm_governing'});const own=await repo.createFactRequest('806',1,askBody(806),session(12),uuid());
        await repo.respondFactRequest(own.fact_request.id,2,{answer_text:'Synthetic department answer'},session(14),uuid());
        await assert.rejects(repo.closeFactRequest(own.fact_request.id,3,{basis:'Forbidden self closure'},session(14),uuid()),{code:'HANDOFF_ACTION_DENIED'});
        assert.equal((await facts(own.fact_request.id)).length,2);assert.equal(await revision(806),3);
      });
      await packageSeed(807,{status:'mdm_governing'});
      await check('fact append failure after answer update rolls question projection, package revision and new history back together',async()=>{
        const question=await repo.createFactRequest('807',1,askBody(807),session(12),uuid()),request=uuid();let injected=false;
        const injecting={async getConnection(){const db=await pool.getConnection();return new Proxy(db,{get(connection,key){if(key==='execute')return async(sql,args)=>{if(sql.includes('INSERT INTO process_data_governance_fact_versions')&&args[3]===2){injected=true;throw Object.assign(new Error('synthetic fact append failure'),{code:'SYNTHETIC_NATIVE_FACT_APPEND_FAILURE'});}return connection.execute(sql,args);};return typeof connection[key]==='function'?connection[key].bind(connection):connection[key];}});},execute:pool.execute.bind(pool)};
        await assert.rejects(makeProcessDataGovernanceRepository(injecting).respondFactRequest(question.fact_request.id,2,{answer_text:'Rollback fact answer'},session(14),request),{code:'SYNTHETIC_NATIVE_FACT_APPEND_FAILURE'});
        assert(injected);assert.equal((await facts(question.fact_request.id)).length,1);assert.equal(await revision(807),2);
        assert.equal((await read('SELECT status,answer_text FROM process_data_governance_fact_requests WHERE id=CAST(? AS SIGNED)',[question.fact_request.id]))[0].status,'open');
        assert.equal((await handoff.receipt(request.request_id,session(14))).state,'prepared');
      });
      await check('review and event readers order numeric IDs correctly across a decimal digit boundary',async()=>{
        for(const id of ['99','100']){
          await pool.execute("INSERT INTO process_data_governance_reviews(id,work_package_id,review_type,decision,basis_text,package_revision_no,actor_person_id,actor_role_code) VALUES(?,805,'mdm_workgroup','approved','Synthetic ordering fixture',2,11,'mdm_lead')",[id]);
          await pool.execute("INSERT INTO process_data_governance_events(id,work_package_id,event_type,actor_person_id,actor_role_code) VALUES(?,805,'synthetic_ordering_event',11,'mdm_lead')",[id]);
        }
        const detail=await repo.getWorkPackageDetail('805');assert.deepEqual(detail.reviews.slice(0,2).map(x=>x.id),[100,99]);assert.deepEqual(detail.events.slice(0,2).map(x=>x.id),[100,99]);
      });
      await check('actual v4 authority still handles native writes with the same history contract',async()=>{
        const baseline=require('../server/accessModelV4Baseline');
        await pool.execute("UPDATE roles SET status='retired' WHERE role_code='hr_directory_manager'");
        for(const role of baseline.ROLE_GUIDES){
          await pool.execute("UPDATE roles SET model_version=?,status='active',role_name=?,description=? WHERE role_code=?",[baseline.ACCESS_MODEL_VERSION,role.name,role.description||null,role.code]);
          await pool.execute('DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code=?',[role.code]);
          for(const permission of role.permissions){
            await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action,default_scope) VALUES(?,?,?,?)',[permission.code,permission.resource,permission.action,permission.defaultScope||'department']);
            await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?",[permission.code,role.code]);
          }
        }
        assert.deepEqual((await read("SELECT DISTINCT model_version FROM roles WHERE status='active'")).map(x=>x.model_version),[baseline.ACCESS_MODEL_VERSION]);
        const result=await decide(703,2,'Actual v4 native decision');assert.equal(result.package.revision_no,3);
        assert.equal((await details(703)).at(-1).actor_json.qualification.model_version,baseline.ACCESS_MODEL_VERSION);
      });
      await check('handoff remains disabled and no map publications or approvals are produced by native history writes',async()=>{
        assert.equal(process.env.DATA_MAP_HANDOFF_ENABLED,'0');for(const table of ['data_map_handoff_drafts','data_map_handoff_approvals','data_map_publications','data_map_effective_heads'])assert.equal(String((await read('SELECT COUNT(*) n FROM '+table))[0].n),'0');
      });
      save('native-detail-history.json',await details(701));save('native-fact-history.json',await facts(question.fact_request.id));
      save('receipts.json',{first,question,answer,closed});
    },{stage:'74',randomDatabase:true});owned.cleaned=true;passed=true;
  }catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
  finally{for(const[key,value]of Object.entries(oldEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;save('results.json',{passed,checks,owned,failure,formalDatabaseAccess:false,featureEnabled:false,businesoRgaepted:false});}
  console.log('PASS DATA_MAP_NATIVE_HISTORY_MYSQL '+checks.length+' checks; evidence '+output);
}
if(require.main===module)main().catch(error=>{console.error(error.code||error.message);process.exitCode=1;});
module.exports={main};
