// Synthetic ledger integration on an owner-labelled fresh tmpfs MySQL only.
// Usage: node scripts/test-data-map-ledger-integration-mysql.js <new artifacts output>.
// Writes only the owned fixture; never loads private configuration or deploys.
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {withFreshMysql}=require('./testHelpers/freshMysql');
const {seed,draftBody}=require('./testHelpers/dataMapHandoffFixture');
const {createDataMapHandoffRepository}=require('../server/dataMapHandoffRepository');
const {makeDataMapMysqlRepository}=require('../server/dataMapMysqlRepository');
const {digest,json}=require('../server/dataMapHandoffPolicy');
const output=path.resolve(process.argv[2]||path.join(__dirname,'../../../artifacts/mdm-data-governance-handoff-implementation-20261020-07/ledger-'+crypto.randomUUID()));
assert(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
const checks=[],save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const request=value=>({request_id:crypto.randomUUID(),...value});let owned,passed=false,error;
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);}
(async()=>{try{await withFreshMysql(async target=>{
  const {pool,owner,database,port,containerId}=target;owned={owner,database,port,containerId};
  const fixture=await seed(target),lead=fixture.session(11),repo=createDataMapHandoffRepository(pool,{env:{DATA_MAP_HANDOFF_ENABLED:'1'}}),ledger=makeDataMapMysqlRepository(pool);
  await fixture.packageSeed(6101);
  const intake=await repo.prepareIntake('6101',request({expected_revision:0}),lead);
  const review=await repo.reviewIntake(intake.intake_id,request({expected_revision:1,basis:'synthetic verified current review',detail_evidence:intake.required_detail_evidence.map(row=>({...row,basis:'synthetic fixed detail',evidence_refs:['synthetic:ledger:detail']}))}),lead);
  let draft=await repo.fromWorkPackage('6101',request({expected_revision:0,binding_id:review.binding_id,draft:draftBody()}),lead);
  const original=await repo.get(draft.handoff_id,lead);assert.equal(original.report.ready_for_approval,true);
  draft=await repo.submit(draft.handoff_id,request({expected_revision:draft.revision}),lead);
  const submitted=await repo.get(draft.handoff_id,lead);
  const approval=await repo.approve(draft.handoff_id,request({expected_revision:draft.revision,decision:'approved',basis:'synthetic exact approval',binding_digest:submitted.report.binding_digest}),lead);
  const publication=await repo.publish(draft.handoff_id,request({expected_revision:draft.revision,approval_id:approval.approval_id}),lead);
  const context=publication.items.find(row=>row.target_kind==='context'),contextId=context.target_id,version=context.target_version_ref;
  let currentFields;
  await check('explicit current ledger exposes exact context, immutable field versions and publication provenance',async()=>{
    const current=await ledger.getContext(contextId,{view:'current'}),list=await ledger.listContexts({view:'current'});
    assert.equal(current.referenceable,true);assert.equal(current.publication_id,publication.publication_id);
    assert.equal(list.find(row=>String(row.id)===contextId).version_ref,version);
    currentFields=await ledger.getFieldsByContext(contextId,{view:'current'});assert.equal(currentFields.length,2);
    assert(currentFields.every(row=>row.publication_id===publication.publication_id&&row.referenceable));
    save('current-ledger.json',{context:current,fields:currentFields});
  });
  await check('history requires its explicit context version and never grants current reference eligibility',async()=>{
    await assert.rejects(()=>ledger.getFieldsByContext(contextId,{view:'history'}),e=>e.code==='HANDOFF_CLIENT_UPGRADE_REQUIRED');
    const contextHistory=await ledger.getContext(contextId,{view:'history',version}),fields=await ledger.getFieldsByContext(contextId,{view:'history',version});
    assert.equal(contextHistory.referenceable,false);assert.equal(contextHistory.new_reference_allowed,false);
    assert.deepEqual(fields.map(row=>row.version_id),currentFields.map(row=>row.version_id));
    assert(fields.every(row=>row.referenceable===false&&row.new_reference_allowed===false&&row.governance_status==='governed_history'));
    save('fixed-history-ledger.json',{context:contextHistory,fields});
  });
  await check('source without a current published version remains pending and cannot provide old current fields',async()=>{
    await pool.execute('UPDATE process_design_documents SET current_version_id=NULL WHERE id=6101');
    try{
      const current=await ledger.getContext(contextId,{view:'current'}),list=await ledger.listContexts({view:'current'});
      assert.equal(current.current,null);assert.equal(current.availability,'source_upgrade_pending');
      assert.equal(list.find(row=>String(row.id)===contextId).availability,'source_upgrade_pending');
      await assert.rejects(()=>ledger.getFieldsByContext(contextId,{view:'current'}),e=>e.code==='HANDOFF_SOURCE_UPGRADE_PENDING');
      assert.equal((await ledger.getFieldsByContext(contextId,{view:'history',version})).length,2);
    }finally{await pool.execute('UPDATE process_design_documents SET current_version_id=6101 WHERE id=6101');}
  });
  const reason='synthetic stop this entire publication';
  const inspected=await repo.withdrawalChecks(publication.publication_id,request({expected_revision:1,reason}),lead);
  const withdrawalApproval=await repo.approveWithdrawal(publication.publication_id,request({expected_revision:1,reason,basis:'synthetic full impact checked',binding_digest:inspected.report.binding_digest}),lead);
  await repo.withdrawPublication(publication.publication_id,request({expected_revision:1,reason,withdrawal_approval_id:withdrawalApproval.withdrawal_approval_id}),lead);
  await check('withdrawn context stays discoverable as unavailable scope metadata without resurrecting its former definition',async()=>{
    const current=await ledger.getContext(contextId,{view:'current'}),list=await ledger.listContexts({view:'current'}),selected=list.find(row=>String(row.id)===contextId);
    assert.equal(current.current,null);assert.equal(current.availability,'withdrawn');assert.equal(current.new_reference_allowed,false);
    assert.equal(selected.availability,'withdrawn');assert.equal(selected.dept_id,'91');assert.equal(current.name,undefined);assert.equal(current.publication_id,undefined);
    await assert.rejects(()=>ledger.getFieldsByContext(contextId,{view:'current'}),e=>e.code==='HANDOFF_CONTEXT_UNAVAILABLE');
    const fields=await ledger.getFieldsByContext(contextId,{view:'history',version});
    assert.deepEqual(fields.map(row=>({id:row.id,name:row.field_name_cn,version:row.version_id})),currentFields.map(row=>({id:row.id,name:row.field_name_cn,version:row.version_id})));
    assert(fields.every(row=>row.new_reference_allowed===false));save('withdrawn-ledger.json',{context:current,list,fields});
  });
  await check('prepared maintenance still allows exact historical fields and cannot permit a current read',async()=>{
    await pool.execute("UPDATE data_map_governance_control SET cutover_state='prepared' WHERE control_id=1");
    try{assert.equal((await ledger.getFieldsByContext(contextId,{view:'history',version})).length,2);await assert.rejects(()=>ledger.getContext(contextId,{view:'current'}),e=>e.code==='HANDOFF_MAINTENANCE');}
    finally{await pool.execute("UPDATE data_map_governance_control SET cutover_state='controlled' WHERE control_id=1");}
  });
  await check('legacy snapshot retains its declared gap and rejects reconstruction from live field rows',async()=>{
    await pool.execute("INSERT INTO data_map_contexts(id,context_key,title,dept_id) VALUES(6109,'SYN_LEGACY_LEDGER','Synthetic legacy context',91)");
    const snapshot={row:{id:'6109',title:'Synthetic fixed legacy context',dept_id:'91'}};
    await pool.execute("INSERT INTO data_map_legacy_registry(asset_kind,asset_id,version_ref,snapshot_json,snapshot_digest,original_status,history_completeness,captured_at) VALUES('context','6109','synthetic-fixed-context',?,?,'legacy','captured_current_only',UTC_TIMESTAMP(3))",[json(snapshot),digest(snapshot)]);
    const legacy=await ledger.getContext('6109',{view:'legacy_in_use',version:'synthetic-fixed-context'});
    assert.equal(legacy.title,snapshot.row.title);assert.equal(legacy.history_completeness,'captured_current_only');assert.equal(legacy.new_reference_allowed,false);
    await assert.rejects(()=>ledger.getFieldsByContext('6109',{view:'legacy_in_use',version:'synthetic-fixed-context'}),e=>e.code==='HANDOFF_CLIENT_UPGRADE_REQUIRED');
    save('legacy-gap.json',legacy);
  });
  owned.cleaned=true;
},{stage:'07',randomDatabase:true});passed=true;}catch(e){error={name:e.name,message:e.message,code:e.code,stack:e.stack};console.error(e);process.exitCode=1;}finally{save('results.json',{passed,checks,owned,error,real_mysql:true,formal_database_connected:false,formal_migration:false,deployed:false,feature_activation:false,business_accepted:false});}})();
