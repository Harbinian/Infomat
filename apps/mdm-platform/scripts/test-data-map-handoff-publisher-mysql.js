// TECH-02 integration: actual additive DDL, immutable bindings, gates, MySQL
// CHECK/FK, preallocated BIGINT versions and full publication rollback. Synthetic
// owner-labelled tmpfs target only; no env files, formal migration or deployment.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {newId,json,digest,parse,snapshot}=require('../server/dataMapHandoffPolicy');
const {lockGraph}=require('../server/dataMapHandoffControl');
const {createLegacyAdapter,binding}=require('../server/dataMapHandoffBindings');
const {handoffActor}=require('../server/dataMapHandoffAuthority');
const gates=require('../server/dataMapHandoffGates'),publisher=require('../server/dataMapHandoffPublisher');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-01/publisher');
if(process.argv[2]){assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');}
const checks=[];let targetRecord;
async function check(name,action){await action();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,backup,restore}=target;targetRecord={owner,database,containerId,mysql_version:(await pool.execute('SELECT VERSION() v'))[0][0].v};
  const {session,packageSeed,schema}=await seed(target),lead=session(11),actor=await handoffActor(pool,lead,'read',{packageId:'501',lock:false});
  async function tx(work,commit=true){const db=await pool.getConnection();try{await db.beginTransaction();const control=await lockGraph(db),result=await work(db,control);if(commit)await db.commit();else await db.rollback();return result;}catch(e){await db.rollback();throw e;}finally{db.release();}}
  async function intake(number){await packageSeed(number);const api=createLegacyAdapter();const prepared=await tx(db=>api.prepareIntake(db,{expected_revision:0},lead,{request_id:newId(),package_id:String(number)}));return tx(db=>api.reviewIntake(db,{expected_revision:1,basis:'synthetic current review',detail_evidence:prepared.required_detail_evidence.map(d=>({...d,basis:'synthetic reviewed fact',evidence_refs:['synthetic:original']}))},lead,{request_id:newId(),intake_id:prepared.intake_id}));}
  const reviewed=await intake(501),body=snapshot(draftBody()),draft={handoff_id:newId(),package_id:'501'},revision={revision_id:newId(),binding_id:reviewed.binding_id,content_digest:digest(body),snapshot_json:body};
  const fixed=await tx(db=>binding(db,reviewed.binding_id,'501'),false);
  revision.dependency_manifest_json=await tx(db=>gates.dependencies(db,body,fixed.snapshot),false);
  await tx(async db=>{
    await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,501,1,'approved',1,11,?,UTC_TIMESTAMP(3))",[draft.handoff_id,json(actor.qualificationSnapshot)]);
    await db.execute('INSERT INTO data_map_handoff_revisions(revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at) VALUES(?,?,1,?,?,?,?,?,?,11,?,UTC_TIMESTAMP(3))',[revision.revision_id,draft.handoff_id,body.scope_mode,reviewed.binding_id,json(body),revision.content_digest,json(revision.dependency_manifest_json),json([]),json(actor.qualificationSnapshot)]);
  });
  const approval={approval_id:newId()};
  let evaluation;
  await check('real additive DDL matches and repeated apply preserves controlled state/high-water mark',async()=>{
    assert.equal(schema.ready,true);const before=(await pool.execute('SELECT * FROM data_map_governance_control'))[0];
    const again=await require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database});assert.equal(again.ready,true);assert.deepEqual((await pool.execute('SELECT * FROM data_map_governance_control'))[0],before);
    await assert.rejects(()=>require('../server/dataMapHandoffSchema').applyHandoffSchema(pool,{owner,database:'formal'}),{code:'HANDOFF_ISOLATED_TARGET_REQUIRED'});
  });
  await check('five-gate check allows approval before the final approval gate',async()=>{
    evaluation=await tx(db=>gates.evaluate(db,{draft,revision}),false);assert.equal(evaluation.report.ready_for_approval,true,JSON.stringify(evaluation.report.gates));assert.equal(evaluation.report.gates[4].status,'pending');
    await tx(db=>db.execute("INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at) VALUES(?,'publish',?,?,'approved','synthetic approval',?,?,UTC_TIMESTAMP(3))",[approval.approval_id,revision.revision_id,evaluation.report.binding_digest,json(actor.qualificationSnapshot),newId()]));
  });
  async function counts(){const names=['data_map_objects','data_map_fields','data_map_contexts','data_map_definition_versions','data_map_publications','data_map_publication_items','data_map_effective_heads','data_map_data_elements','data_map_data_element_versions','data_map_field_element_bindings'];return Promise.all(names.map(async name=>[name,(await pool.execute('SELECT COUNT(*) n FROM '+name))[0][0].n]));}
  await check('failure at the last relationship rolls back all versions, projections, heads and allocator',async()=>{
    const before=await counts(),control=(await pool.execute('SELECT CAST(next_definition_version_id AS CHAR) n FROM data_map_governance_control'))[0][0].n;
    await assert.rejects(()=>tx(async(db,ctrl)=>{const probe=new Proxy(db,{get(t,k){if(k==='execute')return async(sql,args)=>{if(sql.startsWith('INSERT INTO data_map_field_element_bindings'))throw Object.assign(Error('synthetic failure'),{code:'SYNTHETIC_LATE_FAILURE'});return t.execute(sql,args);};const v=t[k];return typeof v==='function'?v.bind(t):v;}});await publisher.publish(probe,{draft,revision,approval,evaluation,actor,control:ctrl,requestId:newId()});}),{code:'SYNTHETIC_LATE_FAILURE'});
    assert.deepEqual(await counts(),before);assert.equal((await pool.execute('SELECT CAST(next_definition_version_id AS CHAR) n FROM data_map_governance_control'))[0][0].n,control);
  });
  let published;
  await check('new object plus two fields and composite identifier commits with immediate parent FKs and exact BIGINT IDs',async()=>{
    published=await tx(async(db,control)=>publisher.publish(db,{draft,revision,approval,evaluation:await gates.evaluate(db,{draft,revision,phase:'publish',approvalProvided:true}),actor:await handoffActor(db,lead,'publish',{packageId:'501'}),control,requestId:newId()}));
    assert.equal(published.items.length,8);const object=published.items.find(i=>i.target_kind==='object'),fields=published.items.filter(i=>i.target_kind==='field');
    assert(BigInt(object.target_version_ref)>9007199254740991n);assert.equal(new Set([object,...fields].map(i=>i.target_version_ref)).size,3);
    const fixed=await require('../server/dataMapEffectiveReader').fixedVersion(pool,object.target_version_ref);assert.deepEqual(fixed.definition.unique_identifiers[0].field_version_ids,fields.map(i=>i.target_version_ref));
    for(const field of fields)assert.equal((await require('../server/dataMapEffectiveReader').fixedVersion(pool,field.target_version_ref)).object_version_id,object.target_version_ref);
    assert.equal((await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'current'})).publication_id,published.publication_id);
    assert.equal((await require('../server/dataMapEffectiveReader').contextFields(pool,{contextId:published.items.find(i=>i.target_kind==='context').target_id,view:'current'})).items.length,2);
  });
  await check('CHECK and FK reject malformed versions independently of application checks',async()=>{
    const ddl=(await pool.query('SHOW CREATE TABLE data_map_definition_versions'))[0][0]['Create Table'];assert.match(ddl,/governance/);assert.match(ddl,/FOREIGN KEY/);
    await assert.rejects(()=>pool.execute("UPDATE data_map_definition_versions SET source_kind='invalid' WHERE version_id=9007199254741001"),e=>e.code==='ER_CHECK_CONSTRAINT_VIOLATED');
    const field=published.items.find(i=>i.target_kind==='field');await assert.rejects(()=>pool.execute('UPDATE data_map_definition_versions SET object_version_id=1 WHERE version_id=?',[field.target_version_ref]),e=>e.code==='ER_NO_REFERENCED_ROW_2');
  });
  await check('legacy head and original body remain unapproved and absent from governed current',async()=>{
    assert.equal((await pool.execute("SELECT CAST(current_version_id AS CHAR) v FROM data_map_definition_heads WHERE entity_id=301"))[0][0].v,'9007199254741001');
    const value=await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:'301',view:'history',versionId:'9007199254741001'});assert.equal(value.definition.name,'Legacy original');assert.equal(value.referenceable,false);
    assert.equal((await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:'301',view:'current'})).current,null);
  });
  await check('data-element reuse rejects changed fixed content and non-boolean NA',async()=>{
    const element=published.items.find(i=>i.target_kind==='data_element'),copy=draftBody();
    copy.items[2]={...copy.items[2],operation:'reuse',target_id:element.target_id,target_version_ref:element.target_version_ref,definition:{...element.payload.definition,name:'Tampered'}};
    const body2=snapshot(copy),r2={...revision,snapshot_json:body2,content_digest:digest(body2)};
    const reviewed2=await intake(502);const b2=await tx(db=>binding(db,reviewed2.binding_id,'502'),false);r2.binding_id=reviewed2.binding_id;r2.dependency_manifest_json=await tx(db=>gates.dependencies(db,body2,b2.snapshot),false);
    const result=await tx(db=>gates.evaluate(db,{draft:{...draft,package_id:'502'},revision:r2}),false);assert(result.report.gates[2].issues.some(x=>x.startsWith('HANDOFF_REUSE_CONTENT_CHANGED')));
    const invalid=draftBody();invalid.items[0].authority[0].not_applicable='false';assert.throws(()=>snapshot(invalid),{code:'HANDOFF_AUTHORITY_INVALID'});
    const invalidCreate=draftBody();invalidCreate.items[0].target_id='301';assert.throws(()=>snapshot(invalidCreate),{code:'HANDOFF_CREATE_TARGET_INVALID'});
  });
  await check('historical publication preserves stable field parents and leaves all current projections and heads unchanged',async()=>{
    await packageSeed(503,{sourceStatus:'superseded'});
    const api=createLegacyAdapter(),prepared=await tx(db=>api.prepareIntake(db,{expected_revision:0},lead,{request_id:newId(),package_id:'503'}));
    const reviewed3=await tx(db=>api.reviewIntake(db,{expected_revision:1,basis:'synthetic historical review',detail_evidence:prepared.required_detail_evidence.map(d=>({...d,basis:'fixed source verified',evidence_refs:['synthetic:history']}))},lead,{request_id:newId(),intake_id:prepared.intake_id}));
    const hb=draftBody('historical');
    for(const item of hb.items){const old=published.items.find(x=>x.item_ref===item.item_ref);if(['object','field'].includes(item.target_kind)){item.operation='modify';item.target_id=old.target_id;item.base_version_ref=old.target_version_ref;}else if(item.target_kind==='context')item.target_id=old.target_id;else if(item.target_kind==='data_element'){item.operation='reuse';item.target_id=old.target_id;item.target_version_ref=old.target_version_ref;item.definition=old.payload.definition;}}
    const hd={handoff_id:newId(),package_id:'503'},hr={revision_id:newId(),binding_id:reviewed3.binding_id};
    const bound=await tx(db=>binding(db,reviewed3.binding_id,'503'),false);
    hr.dependency_manifest_json=await tx(db=>gates.dependencies(db,hb,bound.snapshot),false);
    hb.impact_dispositions=hr.dependency_manifest_json.impacts.filter(x=>x.reference_kind!=='schema_not_installed').map(x=>({reference_key:x.reference_key,decision:'compatible_fixed_reference',basis:'fixed old references retained',evidence_refs:['synthetic:impact']}));
    hr.snapshot_json=snapshot(hb);hr.content_digest=digest(hr.snapshot_json);
    const evaluated=await tx(db=>gates.evaluate(db,{draft:hd,revision:hr,phase:'publish',approvalProvided:true}),false);assert.equal(evaluated.report.publishable,true,JSON.stringify(evaluated.report.gates));
    const ha={approval_id:newId()};
    await tx(async db=>{
      await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,503,1,'approved',1,11,?,UTC_TIMESTAMP(3))",[hd.handoff_id,json(actor.qualificationSnapshot)]);
      await db.execute('INSERT INTO data_map_handoff_revisions(revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at) VALUES(?,?,1,?,?,?,?,?,?,11,?,UTC_TIMESTAMP(3))',[hr.revision_id,hd.handoff_id,'historical',hr.binding_id,json(hr.snapshot_json),hr.content_digest,json(hr.dependency_manifest_json),json(hr.dependency_manifest_json.impacts),json(actor.qualificationSnapshot)]);
      await db.execute("INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at) VALUES(?,'publish',?,?,'approved','historical approval',?,?,UTC_TIMESTAMP(3))",[ha.approval_id,hr.revision_id,evaluated.report.binding_digest,json(actor.qualificationSnapshot),newId()]);
    });
    const heads=(await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0],object=published.items.find(x=>x.target_kind==='object'),before=await require('../server/dataMapDefinitionValues').snapshot(pool,'object',object.target_id),beforeCount=await counts();
    const bad=structuredClone(evaluated);delete bad.body.items.find(x=>x.target_kind==='context').target_id;
    await assert.rejects(()=>tx((db,control)=>publisher.publish(db,{draft:hd,revision:hr,approval:ha,evaluation:bad,actor,control,requestId:newId()})),{code:'HANDOFF_FIELD_CONTEXT_CHANGED'});assert.deepEqual(await counts(),beforeCount);
    const historical=await tx((db,control)=>publisher.publish(db,{draft:hd,revision:hr,approval:ha,evaluation:evaluated,actor,control,requestId:newId()}));
    assert.equal(historical.scope_mode,'historical');assert.deepEqual((await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0],heads);assert.deepEqual(await require('../server/dataMapDefinitionValues').snapshot(pool,'object',object.target_id),before);
    const history=await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'history',versionId:historical.items.find(x=>x.target_kind==='object').target_version_ref});assert.equal(history.referenceable,false);assert.equal(history.definition.name,'Synthetic object');
  });
  await check('unversioned legacy identity adopts a verified capture without replacing its stable ID or inventing an old definition version',async()=>{
    await pool.execute("INSERT INTO data_map_objects(id,object_key,object_name_cn,description,owner_dept_id,status) VALUES(1601,'unversioned_synthetic','Original unversioned','Unknown old meaning',91,'active')");
    const original=await require('../server/dataMapDefinitionValues').snapshot(pool,'object','1601'),capture='capture:'+digest(original);
    await tx(db=>require('../server/dataMapHandoffCompatibility').captureLegacy(db,{assetKind:'object',assetId:'1601',versionRef:capture,snapshot:original,originalStatus:'active'}));
    const reviewed4=await intake(504),hb=draftBody();hb.items[0]={...hb.items[0],operation:'modify',target_id:'1601',base_version_ref:capture};
    const hd={handoff_id:newId(),package_id:'504'},hr={revision_id:newId(),binding_id:reviewed4.binding_id,snapshot_json:snapshot(hb)};hr.content_digest=digest(hr.snapshot_json);
    const bound=await tx(db=>binding(db,reviewed4.binding_id,'504'),false);hr.dependency_manifest_json=await tx(db=>gates.dependencies(db,hb,bound.snapshot),false);
    const evaluated=await tx(db=>gates.evaluate(db,{draft:hd,revision:hr,phase:'publish',approvalProvided:true}),false);assert.equal(evaluated.report.publishable,true,JSON.stringify(evaluated.report.gates));
    const ha={approval_id:newId()};await tx(async db=>{
      await db.execute("INSERT INTO data_map_handoff_drafts(handoff_id,package_id,current_revision,state,active_slot,created_by,created_actor_json,created_at) VALUES(?,504,1,'approved',1,11,?,UTC_TIMESTAMP(3))",[hd.handoff_id,json(actor.qualificationSnapshot)]);
      await db.execute('INSERT INTO data_map_handoff_revisions(revision_id,handoff_id,revision_no,scope_mode,binding_id,snapshot_json,content_digest,dependency_manifest_json,impact_manifest_json,created_by,created_actor_json,created_at) VALUES(?,?,1,?,?,?,?,?,?,11,?,UTC_TIMESTAMP(3))',[hr.revision_id,hd.handoff_id,'current',hr.binding_id,json(hr.snapshot_json),hr.content_digest,json(hr.dependency_manifest_json),json(hr.dependency_manifest_json.impacts),json(actor.qualificationSnapshot)]);
      await db.execute("INSERT INTO data_map_handoff_approvals(approval_id,action,revision_id,binding_digest,decision,basis,actor_json,request_id,created_at) VALUES(?,'publish',?,?,'approved','legacy adoption',?,?,UTC_TIMESTAMP(3))",[ha.approval_id,hr.revision_id,evaluated.report.binding_digest,json(actor.qualificationSnapshot),newId()]);
    });
    const adopted=await tx((db,control)=>publisher.publish(db,{draft:hd,revision:hr,approval:ha,evaluation:evaluated,actor,control,requestId:newId()})),object=adopted.items.find(x=>x.target_kind==='object');assert.equal(object.target_id,'1601');
    const version=await require('../server/dataMapEffectiveReader').fixedVersion(pool,object.target_version_ref);assert.equal(version.supersedes_version_id,null);assert.equal(version.version_no,1);assert.equal(version.source_kind,'governance');
    const old=await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:'1601',view:'legacy_in_use',versionId:capture});assert.deepEqual(old.snapshot,original);assert.equal(old.governance_status,'legacy_unapproved');
  });
  await check('later unresolved correction and precise new fact revision block an earlier approved binding',async()=>{
    const api=createLegacyAdapter(),correction=await tx(db=>api.createCorrection(db,{expected_revision:0,replaces_binding_id:reviewed.binding_id,reason:'new synthetic fact',evidence_refs:['synthetic:new']},lead,{request_id:newId(),package_id:'501'}));
    await tx(db=>api.createFact(db,{expected_revision:0,expected_parent_revision:1,correction_id:correction.correction_id,detail_id:'501',target_department_id:'91',question_text:'Synthetic question',request_reason:'Synthetic reason',requested_fact_type:'business_fact'},lead,{request_id:newId(),correction_id:correction.correction_id}));
    const changed=await tx(db=>gates.evaluate(db,{draft,revision,phase:'publish',approvalProvided:true}),false);assert(changed.report.gates[1].issues.includes('CURRENT_FACT_NOT_CLOSED'));assert(changed.report.gates[1].issues.includes('CURRENT_CORRECTION_NOT_REVIEWED'));assert(changed.report.gates[3].issues.includes('DEPENDENCIES_CHANGED'));
  });
  await check('backup/restore round-trip of this owned synthetic database preserves fixed publication digests',async()=>{
    const before=(await pool.execute('SELECT publication_id,manifest_digest FROM data_map_publications ORDER BY publication_id'))[0];const dump=backup();assert(dump.length>0);restore(dump);assert.deepEqual((await pool.execute('SELECT publication_id,manifest_digest FROM data_map_publications ORDER BY publication_id'))[0],before);
    const object=published.items.find(i=>i.target_kind==='object');assert.equal((await require('../server/dataMapEffectiveReader').readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'current'})).publication_id,published.publication_id);
  });
}, {stage:'61',randomDatabase:true});}
main().then(()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,target:targetRecord,owned_container_removed:true,formal_database_connected:false},null,2)+'\n');console.log('HANDOFF_PUBLISHER_MYSQL_PASS '+checks.length);}).catch(e=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({code:e.code,message:e.message,details:e.details,stack:e.stack},null,2));console.error(e);process.exitCode=1;});
