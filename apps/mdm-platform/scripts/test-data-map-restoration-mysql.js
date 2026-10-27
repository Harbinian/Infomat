// Q10 request/withdrawal/restoration and Q9 cross-source assessment contracts on a fresh owner-labelled
// tmpfs MySQL only. Usage: node scripts/test-data-map-restoration-mysql.js [new artifacts output].
// No private config, existing service, formal migration, deployment or activation.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {digest,json,parse}=require('../server/dataMapHandoffPolicy');
const {readSnapshot,lockGraph}=require('../server/dataMapHandoffControl');
const reader=require('../server/dataMapEffectiveReader');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-03/restoration-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[],request=body=>({request_id:crypto.randomUUID(),...body});let owned,passed=false,failure;
const save=(name,data)=>fs.writeFileSync(path.join(output,name),JSON.stringify(data,null,2)+'\n');
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);}
async function main(){try{await withFreshMysql(async target=>{
  const {pool,owner,database,containerId,port}=target;owned={owner,database,containerId,port};
  const fixture=await seed(target),lead=fixture.session(11),steward=fixture.session(12),admin=fixture.session(13),contact=fixture.session(14),env={DATA_MAP_HANDOFF_ENABLED:'1',PROCESS_DATA_GOVERNANCE_READ_ONLY:'0'};
  const repo=createDataMapHandoffRepository(pool,{env}),read=async(sql,args=[])=>(await pool.execute(sql,args))[0];
  const denied=(work,code)=>assert.rejects(work,e=>code?e.code===code:e.statusCode===403);
  async function bind(number,opts={}){
    await fixture.packageSeed(number,opts);
    if(number===801||number===802){
      const documents=require('./testHelpers/dataMapSourceUpgradeFixture').documents('syn_801');
      for(const document of [documents.old,documents.next])document.data_objects[0].data_ref='source_1';
      const source=number===801?documents.old:documents.next,hash=digest(source),candidates=require('../server/processDataGovernance').buildGovernanceCandidates(source);
      await pool.execute('UPDATE process_design_versions SET process_content_json=?,content_hash=? WHERE id=?',[json(source),hash,String(number)]);
      await pool.execute('UPDATE process_data_governance_work_packages SET source_content_hash=? WHERE id=?',[hash,String(number)]);
      for(const [index,item] of candidates.entries()){
        const governance={basis:'synthetic independently checked fixed '+number+' '+item.detail_ref,scope:'synthetic exact scope '+item.detail_ref};
        const values=[item.detail_type,item.source_ref,item.parent_source_ref,item.source_digest,item.rule_code,json(item.candidate),json(governance),item.detail_ref==='object:source_1'?'confirmed':'not_applicable'];
        if(item.detail_ref==='object:source_1')await pool.execute(`UPDATE process_data_governance_details SET detail_type=?,source_ref=?,parent_source_ref=?,source_snapshot_digest=?,candidate_rule_code=?,candidate_json=?,governance_json=?,status=? WHERE id=?`,[...values,String(number)]);
        else await pool.execute(`INSERT INTO process_data_governance_details(id,work_package_id,detail_ref,responsible_department_id,detail_type,source_ref,parent_source_ref,source_snapshot_digest,candidate_rule_code,candidate_json,governance_json,status) VALUES(?,?,?,91,?,?,?,?,?,?,?,?)`,[String(number*1000+index),String(number),item.detail_ref,...values]);
      }
    }
    const intake=await repo.prepareIntake(String(number),request({expected_revision:0}),lead);
    return repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'synthetic current evidence',detail_evidence:intake.required_detail_evidence.map(d=>({...d,basis:'synthetic verified',evidence_refs:['synthetic:source']}))}),lead);
  }
  const dispositions=review=>review.detail_versions.filter(x=>x.status!=='confirmed').map(x=>({detail_ref:x.detail_ref,operation:x.status,basis:x.governance.basis}));
  async function assessUpgrade(draft,sourcePackageId){
    const current=await repo.get(draft.handoff_id,lead),comparison=await repo.sourceUpgradeStatus(lead,{packageId:String(sourcePackageId),targetVersionId:'802'});
    const [before]=await read('SELECT binding_id,snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=(SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=?)',[String(sourcePackageId)]);
    const [after]=await read('SELECT binding_id,snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[current.revision.binding_id]);
    const old=parse(before.snapshot_json),next=parse(after.snapshot_json),proof={basis:'synthetic Q9 current facts conclusions shared definitions and impact independently rechecked',evidence_refs:['synthetic:q10:q9-current-recheck']};
    assert.deepEqual(Object.keys(comparison.counts).filter(key=>comparison.counts[key]>0).sort(),['added','deleted','modified','unchanged']);
    const decisions=comparison.changes.map(change=>{
      const source=old.detail_versions.find(x=>x.detail_ref===change.detail_ref),target=next.detail_versions.find(x=>x.detail_ref===change.detail_ref);
      return {detail_ref:change.detail_ref,change_kind:change.change_kind,decision:change.change_kind==='unchanged'?'reference_and_recheck':change.change_kind==='deleted'?'remove':'recheck',
        ...(source?{source_detail_version_id:source.detail_version_id}:{}),...(target?{target_detail_version_id:target.detail_version_id}:{}),reuse_scope:change.change_kind==='unchanged'?['/scope']:[],...proof,
        rechecks:Object.fromEntries(['facts','conclusions','shared_definitions','impact'].map(key=>[key,{basis:'synthetic separate '+key+' recheck for '+change.detail_ref,evidence_refs:['synthetic:q10:q9:'+key+':'+change.detail_ref]}]))};
    });
    const assessed=await repo.assessSourceUpgrade(draft.handoff_id,request({expected_revision:Number(current.header.current_revision),source_package_id:String(sourcePackageId),source_binding_id:before.binding_id,comparison_digest:comparison.comparison_digest,...proof,decisions}),lead);
    const history=await repo.getSourceUpgradeAssessments(draft.handoff_id,lead),saved=history.assessments.at(-1).snapshot;
    assert.equal(saved.source_binding_id,before.binding_id);assert.equal(saved.target_binding_id,after.binding_id);assert.deepEqual(history.current.issues,[]);
    assert(saved.decisions.every(x=>Object.keys(x.rechecks).length===4));assert(saved.decisions.filter(x=>x.change_kind==='unchanged').every(x=>x.reused_values[0].value===old.detail_versions.find(d=>d.detail_ref===x.detail_ref).governance.scope));
    save('source-upgrade-comparison.json',comparison);save('source-upgrade-assessment.json',history);return assessed;
  }
  async function finish(draft,{upgradeSourcePackageId=null}={}){
    let value=await repo.get(draft.handoff_id,lead),body=value.revision.snapshot_json;
    const impacts=value.report.dependency_manifest.impacts.filter(x=>x.reference_kind!=='schema_not_installed');
    if(impacts.length){body={...body,impact_dispositions:impacts.map(x=>({reference_key:x.reference_key,decision:'compatible_fixed_reference',basis:'synthetic fixed history preserved',evidence_refs:['synthetic:impact']}))};draft=await repo.saveDraft(draft.handoff_id,request({expected_revision:draft.revision,draft:body}),lead);}
    if(upgradeSourcePackageId)draft=await assessUpgrade(draft,upgradeSourcePackageId);
    value=await repo.get(draft.handoff_id,lead);assert(value.report.ready_for_approval,JSON.stringify(value.report.gates));
    draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);
    value=await repo.get(draft.handoff_id,lead);
    const approved=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic exact approval',binding_digest:value.report.binding_digest}),lead);
    return repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approved.approval_id}),lead);
  }
  async function publish(number,opts={}){const binding=await bind(number,opts),[fixed]=await read('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=?',[binding.binding_id]),body=draftBody(opts.sourceStatus==='superseded'?'historical':'current');body.dispositions=dispositions(parse(fixed.snapshot_json));return finish(await repo.fromWorkPackage(String(number),request({expected_revision:0,binding_id:binding.binding_id,draft:body}),lead));}
  async function approveWithdraw(publication,who=lead){const report=await repo.withdrawalChecks(publication.publication_id,request({expected_revision:1,reason:'synthetic stop all new references'}),who);return repo.approveWithdrawal(publication.publication_id,request({expected_revision:1,reason:'synthetic stop all new references',basis:'synthetic complete impact approved',binding_digest:report.report.binding_digest}),who);}
  const original=await publish(801),object=original.items.find(i=>i.target_kind==='object');let withdrawalBody,withdrawn;
  await check('new publication inspection and withdrawal are leader-only, disabled/read-only never register a write',async()=>{
    assert.equal((await repo.getPublication(original.publication_id,lead)).event_revision,1);
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
    try { assert.deepEqual((await repo.getPublication(original.publication_id,lead)).allowed_actions,['read']); }
    finally { await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1"); }
    for(const who of [steward,admin,contact])await denied(()=>repo.withdrawalChecks(original.publication_id,request({expected_revision:1,reason:'synthetic'}),who));
    for(const flags of [{},{...env,PROCESS_DATA_GOVERNANCE_READ_ONLY:'1'}]){
      const stopped=createDataMapHandoffRepository(pool,{env:flags});
      assert.deepEqual((await stopped.getPublication(original.publication_id,lead)).allowed_actions,['read']);
      await denied(()=>stopped.withdrawalChecks(original.publication_id,request({expected_revision:1,reason:'synthetic'}),lead),flags.DATA_MAP_HANDOFF_ENABLED?'HANDOFF_READ_ONLY':'HANDOFF_DISABLED');
    }
  });
  await check('full withdrawal atomically saves original UUID, clears exact heads and terminal replay never executes again',async()=>{
    const approval=await approveWithdraw(original);withdrawalBody=request({expected_revision:1,reason:'synthetic stop all new references',withdrawal_approval_id:approval.withdrawal_approval_id});
    withdrawn=await repo.withdrawPublication(original.publication_id,withdrawalBody,lead);assert.equal(withdrawn.event_revision,2);
    assert.deepEqual(await repo.withdrawPublication(original.publication_id,withdrawalBody,lead),withdrawn);
    assert.equal((await repo.receipt(withdrawalBody.request_id,lead)).state,'committed');
    assert.equal((await read('SELECT COUNT(*) n FROM data_map_publication_events WHERE publication_id=?',[original.publication_id]))[0].n,2);
    const current=await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'current'});assert.equal(current.current,null);assert.equal(current.availability,'withdrawn');
    const old=await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'history',versionId:object.target_version_ref});assert.equal(old.definition.name,'Synthetic object');assert.equal(old.new_reference_allowed,false);
  });
  await check('changed UUID payload and another person cannot reuse a successful withdrawal receipt',async()=>{
    await denied(()=>repo.withdrawPublication(original.publication_id,{...withdrawalBody,reason:'different'},lead),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
    await denied(()=>repo.withdrawPublication(original.publication_id,withdrawalBody,fixture.session(15)),'HANDOFF_REQUEST_PAYLOAD_CONFLICT');
  });
  function restorationBody(targetPackageId,targetReview,scope='current'){
    const draft=draftBody(scope);
    draft.dispositions=dispositions(targetReview.snapshot);
    for(const item of draft.items){const old=original.items.find(x=>x.item_ref===item.item_ref);item.target_id=old.target_id;if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';item.base_version_ref=old.target_version_ref;}item.source_detail_refs=[targetReview.snapshot.detail_versions[0].detail_version_id];}
    return request({expected_revision:2,target_package_id:String(targetPackageId),expected_target_revision:0,scope_mode:scope,draft,basis:'synthetic explicit old-content adoption',evidence_refs:['synthetic:restoration'],item_mappings:original.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',basis:'synthetic same meaning with rebuilt fixed relationships',evidence_refs:['synthetic:adoption']}))});
  }
  let sameBody;
  await check('a restoration creates a new unapproved draft, and ordinary endpoints cannot mint, change or remove its lineage',async()=>{
    const bound=await read('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=(SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=801)');
    sameBody=restorationBody('801',{snapshot:parse(bound[0].snapshot_json)});const draft=await repo.restorePublication(original.publication_id,sameBody,steward);
    assert.equal(draft.state,'draft');assert.equal(draft.business_outcome,'restoration_draft_saved');assert.notEqual(draft.handoff_id,original.handoff_id);
    const current=await repo.get(draft.handoff_id,steward),forged=structuredClone(current.revision.snapshot_json);delete forged.restoration;delete forged.restores_publication_id;
    await denied(()=>repo.saveDraft(draft.handoff_id,request({expected_revision:draft.revision,draft:forged}),steward),'HANDOFF_RESTORATION_PROVENANCE_IMMUTABLE');
    await denied(()=>repo.fromWorkPackage('801',request({expected_revision:0,draft:current.revision.snapshot_json}),steward),'HANDOFF_RESTORATION_ENTRY_REQUIRED');
    assert.deepEqual(await repo.restorePublication(original.publication_id,sameBody,steward),draft);
    save('restoration-draft.json',current);sameBody.created=draft;
  });
  await check('adopted content can change only with explicit adjustment evidence in a new immutable revision',async()=>{
    const current=await repo.get(sameBody.created.handoff_id,lead),changed=structuredClone(current.revision.snapshot_json);
    changed.items.find(x=>x.item_ref==='object').definition.business_meaning='Synthetic explicitly reviewed adjustment';
    await denied(()=>repo.saveDraft(sameBody.created.handoff_id,request({expected_revision:sameBody.created.revision,draft:changed}),steward),'HANDOFF_RESTORATION_CONTENT_CHANGED');
    changed.restoration_adjustments=[{target_item_ref:'object',basis:'synthetic new fact requires meaning adjustment',evidence_refs:['synthetic:adjusted-fact']}];
    const saved=await repo.saveDraft(sameBody.created.handoff_id,request({expected_revision:sameBody.created.revision,draft:changed}),steward);
    assert.equal(saved.revision,2);assert.equal((await repo.get(saved.handoff_id,lead,{revisionNo:1})).revision.content_digest,current.revision.content_digest);
    // A later explicit revision may adopt the old content again; the adjustment record remains.
    const restoredBody=structuredClone(current.revision.snapshot_json);restoredBody.restoration_adjustments=changed.restoration_adjustments;
    sameBody.created=await repo.saveDraft(saved.handoff_id,request({expected_revision:saved.revision,draft:restoredBody}),steward);
  });
  let restored,latestConsumer;
  await check('restoration passes current gates and a new approval then produces new versions for all original producing items',async()=>{
    restored=await finish(sameBody.created);assert.equal(restored.business_outcome,'published_current');assert.notEqual(restored.publication_id,original.publication_id);
    for(const old of original.items){const next=restored.items.find(x=>x.item_ref===old.item_ref);assert.equal(next.target_id,old.target_id);assert.notEqual(next.target_version_ref,old.target_version_ref);assert.equal(next.produces_version,1);}
    const saved=await repo.getPublication(restored.publication_id,lead);assert.equal(saved.manifest.restores_publication_id,original.publication_id);assert.equal(saved.manifest.process_version_id,'801');
    assert.equal((await repo.getPublication(original.publication_id,lead)).state,'withdrawn');
    assert.equal((await reader.readDefinition(pool,{entityType:'object',entityId:object.target_id,view:'current'})).version_id,restored.items.find(x=>x.target_kind==='object').target_version_ref);
  });
  await check('historical restoration leaves all current heads and physical rows intact',async()=>{
    await pool.execute("UPDATE process_design_versions SET status='superseded' WHERE id=801");await pool.execute('UPDATE process_design_documents SET current_version_id=NULL WHERE id=801');
    const before=await read('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'),projection=await read('SELECT * FROM data_map_objects ORDER BY id');
    const bound=await read('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=(SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=801)');
    const body=restorationBody('801',{snapshot:parse(bound[0].snapshot_json)},'historical');
    const draft=await repo.restorePublication(original.publication_id,body,lead),result=await finish(draft);assert.equal(result.business_outcome,'published_historical');
    assert.deepEqual(await read('SELECT * FROM data_map_effective_heads ORDER BY subject_kind,subject_id'),before);assert.deepEqual(await read('SELECT * FROM data_map_objects ORDER BY id'),projection);
  });
  await check('old source cannot be restored current, but an explicitly selected active draft on the actual newer package can adopt it',async()=>{
    const targetReview=await bind(802,{documentId:801});
    const fixed=await read('SELECT snapshot_json FROM process_data_governance_review_bindings WHERE binding_id=(SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=802)');
    const body=restorationBody('802',{snapshot:parse(fixed[0].snapshot_json)});
    for(const item of body.draft.items)if(item.operation==='modify'){const heads=await read("SELECT effective_version_ref FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? AND availability='active'",[item.target_kind,item.target_id]);if(heads.length)item.base_version_ref=heads[0].effective_version_ref;}
    const old=restorationBody('801',{snapshot:parse(fixed[0].snapshot_json)});await denied(()=>repo.restorePublication(original.publication_id,old,lead),'HANDOFF_SCOPE_STALE');
    const active=await repo.fromWorkPackage('802',request({expected_revision:0,binding_id:targetReview.binding_id}),steward);
    await denied(()=>repo.restorePublication(original.publication_id,body,steward),'HANDOFF_ACTIVE_DRAFT_EXISTS');
    body.request_id=crypto.randomUUID();body.target_handoff_id=active.handoff_id;body.expected_target_revision=active.revision;
    const originalRevision=(await repo.get(active.handoff_id,lead,{revisionNo:1})).revision.content_digest;
    const draft=await repo.restorePublication(original.publication_id,body,steward);assert.equal(draft.revision,2);
    assert.equal((await repo.get(active.handoff_id,lead,{revisionNo:1})).revision.content_digest,originalRevision);
    const pending=await repo.get(draft.handoff_id,lead);assert(pending.report.gates[3].issues.includes('SOURCE_UPGRADE_ASSESSMENT_REQUIRED'));assert.equal((await repo.getSourceUpgradeAssessments(draft.handoff_id,lead)).assessments.length,0);
    const published=await finish(draft,{upgradeSourcePackageId:'801'}),manifest=(await repo.getPublication(published.publication_id,lead)).manifest;
    assert.equal(manifest.process_version_id,'802');const detailId=parse(fixed[0].snapshot_json).detail_versions[0].detail_version_id;
    assert(manifest.items.every(x=>x.source_detail_versions.includes(detailId)));
  });
  await check('withdrawal approval basis and authorized reverse restoration links are queryable without leaking an unassigned target',async()=>{
    const leadTrace=await repo.tracePublication(original.publication_id,lead);
    assert(leadTrace.approvals.some(x=>x.action==='withdraw_publication'&&x.basis==='synthetic complete impact approved'));
    assert(leadTrace.restoration_links.some(x=>x.package_id==='802'&&x.publication_id));
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=15,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=802 AND assignment_kind='steward'");
    const limited=await repo.tracePublication(original.publication_id,steward);assert(!limited.restoration_links.some(x=>x.package_id==='802'));
    await pool.execute("UPDATE process_governance_responsibilities SET person_id=12,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=802 AND assignment_kind='steward'");
  });
  await check('context list uses a single caller snapshot and source-upgrade pending entries do not cause a payload error',async()=>{
    let connections=0,outside=0;
    const counted={getConnection:async()=>{connections++;return pool.getConnection();},execute:async(...args)=>{outside++;return pool.execute(...args);}};
    const map=require('../server/dataMapMysqlRepository').makeDataMapMysqlRepository(counted);
    const contexts=await map.listContexts({view:'current'});assert(contexts.length>0);assert.equal(connections,1);assert.equal(outside,0);
    await pool.execute('UPDATE process_design_documents SET current_version_id=NULL WHERE id=801');
    const pending=await map.listContexts({view:'current'});assert.equal(pending.length,contexts.length);
    for(const value of pending){const fixed=contexts.find(x=>x.id===value.id);assert(fixed);assert.equal(value.version_ref,fixed.version_ref);assert.equal(value.process_version_id,'802');assert.equal(value.availability,'source_upgrade_pending');assert.equal(value.current,null);assert.equal(value.current_process_version_id,null);assert.equal(value.new_reference_allowed,false);assert.equal(value.referenceable,false);assert.equal(value.requires_attention,true);assert(value.reference_issues.some(x=>x.code==='HANDOFF_SOURCE_UPGRADE_PENDING'));assert(value.last_published_definition);}
    save('source-upgrade-pending-contexts.json',pending);
    await pool.execute('UPDATE process_design_documents SET current_version_id=802 WHERE id=801');
  });
  await check('dependent current contexts, fields and ledger remain readable with explicit attention flags after the producer is withdrawn',async()=>{
    const heads=await read("SELECT * FROM data_map_effective_heads WHERE subject_kind='data_element' AND availability='active'");
    const parentPublication=heads[0].publication_id,parent=await repo.getPublication(parentPublication,lead),element=parent.manifest.items.find(x=>x.target_kind==='data_element');
    const bound=await bind(803),body=draftBody(),shared=body.items.find(x=>x.item_ref==='element_a');
    // Keep this consumer's ledger scope distinct from the producer's wholly
    // withdrawn contexts. A whole-department export must not silently omit them.
    body.items.find(x=>x.target_kind==='context').definition.department_id='92';
    shared.operation='reuse';shared.target_id=element.target_id;shared.target_version_ref=element.target_version_ref;shared.definition=element.payload.definition;
    const consumer=await finish(await repo.fromWorkPackage('803',request({expected_revision:0,binding_id:bound.binding_id,draft:body}),lead));latestConsumer=consumer;
    const approval=await approveWithdraw(parent),stopped=await repo.withdrawPublication(parentPublication,request({expected_revision:1,reason:'synthetic stop all new references',withdrawal_approval_id:approval.withdrawal_approval_id}),lead);assert.equal(stopped.event_revision,2);
    const map=require('../server/dataMapMysqlRepository').makeDataMapMysqlRepository(pool),context=consumer.items.find(x=>x.target_kind==='context');
    const list=await map.listContexts({view:'current'}),retained=list.find(x=>x.id===context.target_id);
    assert(retained);assert.equal(retained.requires_attention,true);assert.equal(retained.new_reference_allowed,false);assert.equal(retained.dept_id,'92');
    const fields=await map.getFieldsByContext(context.target_id,{view:'current'});assert.equal(fields.length,2);assert(fields.every(x=>x.requires_attention&&!x.new_reference_allowed));
    const field=await map.getField(fields[0].id,{view:'current'});assert.equal(field.requires_attention,true);assert.equal(field.new_reference_allowed,false);
    const identity=await map.getFieldIdentity(fields[0].id,{view:'current'});assert.equal(identity.referenceable,false);assert.equal(identity.new_reference_allowed,false);assert.equal(identity.requires_attention,true);assert.deepEqual(identity.reference_issues,field.reference_issues);
    await assert.rejects(map.exportFieldLedger({departmentId:'91'},{view:'current'}),{code:'HANDOFF_CONTEXT_UNAVAILABLE'});
    const ledger=await map.exportFieldLedger({departmentId:'92'},{view:'current'});assert.equal(ledger.fields.length,2);assert(ledger.fields.every(x=>x.governance_status==='needs_reference_review'&&x.requires_attention&&!x.new_reference_allowed));
  });
  await check('actual v4 model performs controlled whole withdrawal and restoration through a new approval and publication',async()=>{
    const baseline=require('../server/accessModelV4Baseline');
    await pool.execute("UPDATE roles SET status='retired' WHERE role_code='hr_directory_manager'");
    for(const role of baseline.ROLE_GUIDES){
      await pool.execute("UPDATE roles SET model_version=?,status='active',role_name=?,description=? WHERE role_code=?",[baseline.ACCESS_MODEL_VERSION,role.name,role.description||null,role.code]);
      await pool.execute('DELETE rp FROM role_permissions rp JOIN roles r ON r.role_id=rp.role_id WHERE r.role_code=?',[role.code]);
      for(const permission of role.permissions){await pool.execute('INSERT IGNORE INTO permissions(perm_code,resource,action,default_scope) VALUES(?,?,?,?)',[permission.code,permission.resource,permission.action,permission.defaultScope||'department']);await pool.execute("INSERT INTO role_permissions(role_id,perm_id,effect) SELECT r.role_id,p.perm_id,'allow' FROM roles r JOIN permissions p ON p.perm_code=? WHERE r.role_code=?",[permission.code,role.code]);}
    }
    const approval=await approveWithdraw(latestConsumer);
    await repo.withdrawPublication(latestConsumer.publication_id,request({expected_revision:1,reason:'synthetic stop all new references',withdrawal_approval_id:approval.withdrawal_approval_id}),lead);
    const [fixed]=await read('SELECT r.snapshot_json FROM data_map_handoff_revisions r JOIN data_map_publications p ON p.handoff_revision_id=r.revision_id WHERE p.publication_id=?',[latestConsumer.publication_id]);
    const draft=parse(fixed.snapshot_json);
    for(const item of draft.items){const old=latestConsumer.items.find(x=>x.item_ref===item.item_ref);item.target_id=old.target_id;if(['object','field','data_element'].includes(item.target_kind)){item.operation='modify';delete item.target_version_ref;item.base_version_ref=old.target_version_ref;}}
    const prepared=await repo.restorePublication(latestConsumer.publication_id,request({expected_revision:2,target_package_id:'803',expected_target_revision:0,scope_mode:'current',draft,basis:'synthetic v4 restoration evidence',evidence_refs:['synthetic:v4'],item_mappings:latestConsumer.items.map(x=>({source_item_ref:x.item_ref,target_item_ref:x.item_ref,content_decision:'adopt',basis:'synthetic v4 exact content',evidence_refs:['synthetic:v4-item']}))}),steward);
    const published=await finish(prepared);assert.equal(published.business_outcome,'published_current');
    const publication=await repo.getPublication(published.publication_id,lead);assert.equal(publication.manifest.actor.model_version,baseline.ACCESS_MODEL_VERSION);
    save('v4-restored-publication.json',publication);
  });
  save('withdrawal-receipt.json',withdrawn);save('restored-publication.json',restored);
},{stage:'77',randomDatabase:true});owned.cleaned=true;passed=true;
}catch(error){failure={code:error.code,message:error.message,stack:error.stack};throw error;}
finally{save('results.json',{passed,checks,owned,failure,formal_database_connected:false,feature_activation:false,business_accepted:false});}
}
main().catch(error=>{console.error(error.code||error.message);if(error.code==='ERR_ASSERTION')console.error(error.message);process.exitCode=1;});
