// Q10 withdrawal, fixed history and graph-impact checks use one newly owned
// tmpfs MySQL. No application service, environment file or formal database.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {handoffActor}=require('../server/dataMapHandoffAuthority');
const {lockGraph}=require('../server/dataMapHandoffControl');
const lifecycle=require('../server/dataMapPublicationLifecycle');
const reader=require('../server/dataMapEffectiveReader');
const {digest,json}=require('../server/dataMapHandoffPolicy');
const output=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/withdrawal-'+crypto.randomUUID());
if(process.argv[2]){assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output),'preserve previous evidence');}
const request=values=>({request_id:crypto.randomUUID(),...values}),checks=[];let targetRecord;
async function check(name,action){await action();checks.push({name,passed:true});console.log('PASS '+name);}
async function main(){await withFreshMysql(async target=>{
  const {pool,owner,database,containerId}=target;targetRecord={owner,database,container_id:containerId,mysql_version:(await pool.execute('SELECT VERSION() v'))[0][0].v};
  const fixture=await seed(target),lead=fixture.session(11),repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'}});
  async function tx(work,{commit=true}={}){const db=await pool.getConnection();try{await db.beginTransaction();await lockGraph(db);const value=await work(db);if(commit)await db.commit();else await db.rollback();return value;}catch(error){await db.rollback();throw error;}finally{db.release();}}
  async function actor(db,packageId){return handoffActor(db,lead,'withdraw',{packageId,writeFields:[]});}
  async function report(id,reason='synthetic controlled withdrawal'){return tx(db=>lifecycle.withdrawalReport(db,id,{reason}),{commit:false});}
  async function approve(r){return tx(async db=>lifecycle.approveWithdrawal(db,{report:r,actor:await actor(db,r.package_id),requestId:crypto.randomUUID(),basis:'synthetic complete withdrawal-impact approval'}));}
  async function withdraw(r,approval,options={}){return tx(async db=>lifecycle.withdrawPublication(db,{report:r,approval,actor:await actor(db,r.package_id),requestId:crypto.randomUUID(),reason:'synthetic controlled withdrawal'}),options);}
  async function publication(number,body=draftBody(),options={}){
    await fixture.packageSeed(number,options);
    const intake=await repo.prepareIntake(String(number),request({expected_revision:0}),lead);
    const reviewed=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'synthetic fixed review',detail_evidence:intake.required_detail_evidence.map(x=>({...x,basis:'synthetic fact verified',evidence_refs:['synthetic:review']}))}),lead);
    let draft=await repo.fromWorkPackage(String(number),request({expected_revision:0,binding_id:reviewed.binding_id,draft:body}),lead);
    const initial=await repo.get(draft.handoff_id,lead),impacts=initial.report.dependency_manifest.impacts.filter(x=>x.reference_kind!=='schema_not_installed');
    if(impacts.length){body={...body,impact_dispositions:impacts.map(x=>({reference_key:x.reference_key,decision:'compatible_fixed_reference',basis:'synthetic old references retained',evidence_refs:['synthetic:impact']}))};draft=await repo.saveDraft(draft.handoff_id,request({expected_revision:draft.revision,draft:body}),lead);}
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);
    const evaluated=await repo.get(draft.handoff_id,lead);assert.equal(evaluated.report.ready_for_approval,true,JSON.stringify(evaluated.report.gates));
    const approval=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic publication approval',binding_digest:evaluated.report.binding_digest}),lead);
    return repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),lead);
  }
  const original=await publication(751),object=original.items.find(x=>x.target_kind==='object');
  let first;
  await check('complete immutable manifest, fixed bodies, exact BIGINT identities and event 1 form the withdrawal report',async()=>{
    first=await report(original.publication_id);assert.equal(first.event_revision,1);assert.equal(first.state,'published');assert.equal(first.produced_items.length,8);assert.equal(first.reused_items.length,0);assert.equal(first.heads.filter(x=>x.will_clear).length,8);assert(BigInt(object.target_version_ref)>9007199254740991n);
    assert.equal(first.binding_digest,(await report(original.publication_id)).binding_digest);
  });
  await check('missing item, extra manifest item, malformed producer flag, fixed body drift and missing published event all fail closed',async()=>{
    const corruptions=[
      db=>db.execute('DELETE FROM data_map_publication_items WHERE publication_id=? AND item_ref=?',[original.publication_id,'authority']),
      async db=>{const [[r]]=await db.execute('SELECT manifest_json FROM data_map_publications WHERE publication_id=?',[original.publication_id]);const manifest=typeof r.manifest_json==='string'?JSON.parse(r.manifest_json):r.manifest_json;manifest.items.push({...manifest.items[0],item_ref:'extra'});await db.execute('UPDATE data_map_publications SET manifest_json=?,manifest_digest=? WHERE publication_id=?',[json(manifest),digest(manifest),original.publication_id]);},
      async db=>{const [[r]]=await db.execute('SELECT manifest_json FROM data_map_publications WHERE publication_id=?',[original.publication_id]);const manifest=typeof r.manifest_json==='string'?JSON.parse(r.manifest_json):r.manifest_json;manifest.handoff_revision_id=crypto.randomUUID();await db.execute('UPDATE data_map_publications SET manifest_json=?,manifest_digest=? WHERE publication_id=?',[json(manifest),digest(manifest),original.publication_id]);},
      db=>db.execute('UPDATE data_map_publication_items SET produces_version=0 WHERE publication_id=? AND item_ref=?',[original.publication_id,'object']),
      db=>db.execute("UPDATE data_map_definition_versions SET definition_json=JSON_SET(definition_json,'$.name','synthetic drift') WHERE version_id=?",[object.target_version_ref]),
      db=>db.execute('DELETE FROM data_map_publication_events WHERE publication_id=?',[original.publication_id])
    ];
    for(const corrupt of corruptions)await assert.rejects(()=>tx(async db=>{await corrupt(db);await lifecycle.withdrawalReport(db,original.publication_id,{reason:'synthetic controlled withdrawal'});},{commit:false}),error=>['HANDOFF_PUBLICATION_INTEGRITY_CONFLICT','HANDOFF_VERSION_INTEGRITY_CONFLICT'].includes(error.code));
    assert.equal((await report(original.publication_id)).binding_digest,first.binding_digest);
  });
  let initialApproval;
  await check('withdrawal approval binds the exact current report without advancing the publication event revision',async()=>{
    initialApproval=await approve(first);assert.equal(initialApproval.action,'withdraw_publication');assert.equal(initialApproval.binding_digest,first.binding_digest);assert.equal((await report(original.publication_id)).event_revision,1);assert.equal((await report(original.publication_id)).binding_digest,first.binding_digest);
  });
  await check('withdrawal reasons are required and frozen independently of the approval basis',async()=>{
    for(const reason of [undefined,null,'','  '])await assert.rejects(()=>tx(db=>lifecycle.withdrawalReport(db,original.publication_id,{reason}),{commit:false}),{code:'HANDOFF_REASON_REQUIRED'});
    assert.equal(first.reason,'synthetic controlled withdrawal');
    const changed=await report(original.publication_id,'synthetic different withdrawal cause');assert.notEqual(changed.binding_digest,first.binding_digest);
    await assert.rejects(()=>withdraw(changed,initialApproval),{code:'HANDOFF_WITHDRAWAL_REASON_CHANGED'});
    await assert.rejects(()=>tx(async db=>lifecycle.withdrawPublication(db,{report:changed,approval:initialApproval,actor:await actor(db,changed.package_id),requestId:crypto.randomUUID(),reason:changed.reason})),{code:'HANDOFF_WITHDRAWAL_APPROVAL_CHANGED'});
    await assert.rejects(()=>tx(async db=>lifecycle.withdrawPublication(db,{report:first,approval:initialApproval,actor:await actor(db,first.package_id),requestId:crypto.randomUUID(),reason:'synthetic different withdrawal cause'})),{code:'HANDOFF_WITHDRAWAL_REASON_CHANGED'});
    const stored=(await pool.execute('SELECT basis FROM data_map_handoff_approvals WHERE approval_id=?',[initialApproval.approval_id]))[0][0];assert.equal(stored.basis,'synthetic complete withdrawal-impact approval');assert.notEqual(stored.basis,first.reason);
  });
  const consumerBody=draftBody();
  for(const item of consumerBody.items)if(['object','data_element'].includes(item.target_kind)){
    const old=original.items.find(x=>x.item_ref===item.item_ref);item.operation='reuse';item.target_id=old.target_id;item.target_version_ref=old.target_version_ref;item.definition=old.payload.definition;
  }
  const consumer=await publication(752,consumerBody);
  await check('new reuse references invalidate the old withdrawal approval and appear in the complete produced-version closure',async()=>{
    const current=await report(original.publication_id);assert.notEqual(current.binding_digest,first.binding_digest);assert(current.impact_manifest.some(x=>x.publication_id===consumer.publication_id&&x.operation==='reuse'));
    await assert.rejects(()=>withdraw(first,initialApproval),{code:'HANDOFF_WITHDRAWAL_APPROVAL_CHANGED'});
  });
  await check('withdrawing a consumer clears its produced heads while every reused producer head stays active',async()=>{
    const producerBefore=await report(original.publication_id),producerApproval=await approve(producerBefore);
    const r=await report(consumer.publication_id);assert.equal(r.reused_items.length,3);assert.equal(r.produced_items.length,5);const a=await approve(r),done=await withdraw(r,a);assert.equal(done.event_revision,2);assert.equal(done.heads.filter(x=>x.action==='cleared').length,5);
    const head=(await pool.execute('SELECT publication_id,effective_version_ref,availability FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=?',['object',object.target_id]))[0][0];assert.equal(head.publication_id,original.publication_id);assert.equal(head.effective_version_ref,object.target_version_ref);assert.equal(head.availability,'active');
    const producerAfter=await report(original.publication_id);
    assert.equal(producerBefore.impact_digest,producerAfter.impact_digest);assert.notEqual(producerBefore.binding_digest,producerAfter.binding_digest);
    assert.equal(producerBefore.related_publications.find(x=>x.publication_id===consumer.publication_id).event_revision,1);
    assert.equal(producerAfter.related_publications.find(x=>x.publication_id===consumer.publication_id).state,'withdrawn');
    assert.equal(producerAfter.related_publications.find(x=>x.publication_id===consumer.publication_id).event_revision,2);
    await assert.rejects(()=>withdraw(producerBefore,producerApproval),{code:'HANDOFF_WITHDRAWAL_APPROVAL_CHANGED'});
  });
  const laterBody=draftBody();
  for(const item of laterBody.items){
    const old=original.items.find(x=>x.item_ref===item.item_ref);
    if(['object','field'].includes(item.target_kind)){item.operation='modify';item.target_id=old.target_id;item.base_version_ref=old.target_version_ref;}
    else if(item.target_kind==='data_element'){item.operation='reuse';item.target_id=old.target_id;item.target_version_ref=old.target_version_ref;item.definition=old.payload.definition;}
    else item.target_id=old.target_id;
  }
  const later=await publication(753,laterBody);
  let current,approval;
  await check('later publication heads are frozen by full publication and version tuple and are listed as preserved',async()=>{
    current=await report(original.publication_id);assert.equal(current.heads.filter(x=>x.will_clear).length,2);assert.equal(current.heads.filter(x=>x.head?.publication_id===later.publication_id).length,6);assert(current.impact_manifest.some(x=>x.publication_id===later.publication_id));approval=await approve(current);
  });
  await check('unrelated graph revision changes do not invalidate a withdrawal report',async()=>{
    await pool.execute('UPDATE data_map_governance_control SET graph_revision=graph_revision+7 WHERE control_id=1');assert.equal((await report(original.publication_id)).binding_digest,current.binding_digest);
  });
  await check('failure after head clearing rolls back every cleared head and appending event',async()=>{
    const before=(await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0];
    await assert.rejects(()=>tx(async db=>{const proxy=new Proxy(db,{get(t,key){if(key==='execute')return async(sql,args)=>{if(sql.includes('INSERT INTO data_map_publication_events'))throw Object.assign(Error('synthetic late withdrawal failure'),{code:'SYNTHETIC_WITHDRAWAL_FAILURE'});return t.execute(sql,args);};const v=t[key];return typeof v==='function'?v.bind(t):v;}});return lifecycle.withdrawPublication(proxy,{report:current,approval,actor:await actor(db,current.package_id),requestId:crypto.randomUUID(),reason:current.reason});}),{code:'SYNTHETIC_WITHDRAWAL_FAILURE'});
    assert.deepEqual((await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0],before);assert.equal((await report(original.publication_id)).event_revision,1);
  });
  await check('original source corruption does not prevent a valid stop of new references',async()=>{
    await pool.execute('UPDATE process_design_versions SET content_hash=? WHERE id=751',['0'.repeat(64)]);assert.equal((await report(original.publication_id)).binding_digest,current.binding_digest);
  });
  await check('whole withdrawal preserves subsequent heads, every fixed body, physical projection and existing references without fallback',async()=>{
    const definitions=(await pool.execute('SELECT CAST(version_id AS CHAR) version_id,definition_json,base_snapshot_json,content_digest FROM data_map_definition_versions ORDER BY version_id'))[0];
    const projection=await require('../server/dataMapDefinitionValues').snapshot(pool,'object',object.target_id),items=(await pool.execute('SELECT * FROM data_map_publication_items ORDER BY publication_id,item_ref'))[0];
    const done=await withdraw(current,approval);assert.equal(done.event_revision,2);assert.equal(done.heads.filter(x=>x.action==='cleared').length,2);assert.equal(done.heads.filter(x=>x.action==='preserved').length,6);
    assert.deepEqual((await pool.execute('SELECT CAST(version_id AS CHAR) version_id,definition_json,base_snapshot_json,content_digest FROM data_map_definition_versions ORDER BY version_id'))[0],definitions);
    assert.deepEqual(await require('../server/dataMapDefinitionValues').snapshot(pool,'object',object.target_id),projection);assert.deepEqual((await pool.execute('SELECT * FROM data_map_publication_items ORDER BY publication_id,item_ref'))[0],items);
    const element=original.items.find(x=>x.target_kind==='data_element'),head=(await pool.execute('SELECT * FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=?',['data_element',element.target_id]))[0][0];assert.equal(head.publication_id,null);assert.equal(head.effective_version_ref,null);assert.equal(head.availability,'withdrawn');assert.equal(head.head_revision,2);
    const laterHead=(await pool.execute('SELECT publication_id,effective_version_ref FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=?',['object',object.target_id]))[0][0];assert.equal(laterHead.publication_id,later.publication_id);
    const history=await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.equal(history.definition.name,'Synthetic object');assert.equal(history.referenceable,false);
    await assert.rejects(()=>reader.assertReferenceable(pool,{entityType:'object',entityId:object.target_id,versionId:object.target_version_ref}),{code:'HANDOFF_REFERENCE_UNAVAILABLE'});
    const inspected=await tx(db=>lifecycle.inspectPublication(db,original.publication_id),{commit:false});assert.equal(inspected.state,'withdrawn');assert.equal(inspected.event_revision,2);assert.equal(inspected.events[1].payload.approval_id,approval.approval_id);assert.equal(inspected.events[1].payload.head_results.length,8);
    await assert.rejects(()=>tx(async db=>lifecycle.approveWithdrawal(db,{report:await lifecycle.withdrawalReport(db,original.publication_id,{reason:current.reason}),actor:await actor(db,current.package_id),requestId:crypto.randomUUID(),basis:'synthetic repeated approval'})),{code:'HANDOFF_PUBLICATION_ALREADY_WITHDRAWN'});
  });
  await check('incomplete or relabelled withdrawal evidence cannot be treated as a restorable withdrawn publication',async()=>{
    for(const mutation of [payload=>{payload.head_results.pop();},payload=>{payload.withdrawal_report.produced_items.pop();},payload=>{payload.approval_id=crypto.randomUUID();},payload=>{payload.head_results[0].action=payload.head_results[0].action==='preserved'?'cleared':'preserved';}]){
      await assert.rejects(()=>tx(async db=>{
        const [[event]]=await db.execute('SELECT payload_json FROM data_map_publication_events WHERE publication_id=? AND event_no=2',[original.publication_id]);
        const payload=typeof event.payload_json==='string'?JSON.parse(event.payload_json):event.payload_json;mutation(payload);
        await db.execute('UPDATE data_map_publication_events SET payload_json=? WHERE publication_id=? AND event_no=2',[json(payload),original.publication_id]);
        return lifecycle.inspectPublication(db,original.publication_id);
      },{commit:false}),{code:'HANDOFF_PUBLICATION_INTEGRITY_CONFLICT'});
    }
  });
  await check('historical publication with no current heads can be withdrawn without changing any current head',async()=>{
    const historical=await publication(754,draftBody('historical'),{sourceStatus:'superseded'}),r=await report(historical.publication_id);assert(r.heads.every(x=>x.head===null));const a=await approve(r),before=(await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0];
    const done=await withdraw(r,a);assert.equal(done.heads.filter(x=>x.action==='absent').length,8);assert.deepEqual((await pool.execute('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'))[0],before);
  });
}, {stage:'75',randomDatabase:true});}
main().then(()=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({status:'passed',checks,target:targetRecord,owned_container_removed:true,formal_database_connected:false},null,2)+'\n');console.log('PUBLICATION_WITHDRAWAL_MYSQL_PASS '+checks.length+' '+output);}).catch(error=>{fs.mkdirSync(output,{recursive:true});fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({code:error.code,message:error.message,payload:error.payload,stack:error.stack},null,2)+'\n');console.error(error);process.exitCode=1;});
