// Isolated policy/adapter tests only. No configured database, HTTP or service.
const test=require('node:test'),assert=require('node:assert/strict');
const {reviewEvidence,platformVersionNo,publicationMeaning}=require('../server/processFormalControlPolicy');
const {contentBlockingIssues}=require('../server/processContentChecks');
const {escalationMaterials}=require('../server/processDisputeMaterials');
const {normalizeInput,appendControl,readControls}=require('../server/processFormalControls');
const migration=require('../server/processFormalControlMigration');
const {makeProcessDesignMysqlRepository}=require('../server/processDesignMysqlRepository');
test('negative decisions reject empty generic notes while explicit evidence survives unchanged',()=>{
  for(const decision of ['reject','needs_changes']){
    assert.throws(()=>reviewEvidence(decision,{}),e=>e.payload?.code==='FORMAL_REVIEW_EVIDENCE_REQUIRED');
    assert.deepEqual(reviewEvidence(decision,{problem:'问题',basis:'依据',revision_request:'修改'}),{problem:'问题',basis:'依据',revision_request:'修改'});
  }
});
test('unknown required content blocks even when old evaluators only labeled confirmation',()=>{
  const issues=[{group:'confirmation',message:'执行责任待确认'}, {group:'incomplete',message:'依据缺失'}];
  assert.deepEqual(contentBlockingIssues({status:'ready',issues}).map(i=>i.code),['CONTENT_CONFIRMATION_REQUIRED','CONTENT_INCOMPLETE']);
});
test('platform version and enterprise approval remain distinct for legacy and new rows',()=>{
  assert.equal(platformVersionNo({id:42,revision_no:3}),'PV42-R3');
  for(const version of [{status:'published',edition:'B',effective_at:'2026-10-20'}, {status:'published',edition:null,effective_at:null}]) {
    const meaning=publicationMeaning(version);assert.equal(meaning.enterprise_approval_status,'unknown');assert.equal(meaning.institution_edition,null);assert.equal(meaning.legacy_edition,version.edition);
  }
});
test('published version reads preserve old non-null edition/effective values and accept new null metadata without rewriting',async()=>{
  for(const legacy of [true,false]) {
    const stored={id:9,draft_id:4,document_id:2,department_id:91,document_no:'SYNTHETIC',document_title:'合成制度',edition:legacy?'B':null,effective_at:legacy?'2026-01-01':null,
      version_no:legacy?'SYNTHETIC-B':'PV4-R2',schema_version:'process-governance-v8',process_content_json:'{"schema_version":"process-governance-v8"}',content_hash:'a'.repeat(64),status:'published',source_revision_no:2,published_at_epoch:1};
    const original=structuredClone(stored),queries=[];
    const db={execute:async sql=>{queries.push(sql);if(sql.includes('FROM process_design_versions'))return [[structuredClone(stored)]];if(sql.includes('FROM process_design_events'))return [legacy?[]:[{payload_json:JSON.stringify({publication_context:{sources:[{reference:'材料-1'}]}})}]];throw Error('unexpected query');}};
    const result=await makeProcessDesignMysqlRepository(db).getVersionContent(9);
    assert.equal(result.edition,stored.edition);assert.equal(result.effective_at,stored.effective_at);assert.equal(result.publication_meaning.enterprise_approval_status,'unknown');assert.deepEqual(stored,original);
    assert.equal(result.publication_context?.sources?.[0]?.reference,legacy?undefined:'材料-1');assert.equal(queries.every(sql=>/^\s*SELECT/i.test(sql)),true);
  }
});
test('escalation needs all parties, evidence, impact and coordination before project decision',()=>{
  const materials={issue_summary:'分歧',impact_scope:'甲乙部门接口',coordination_history:'两次协调未一致',positions:[{department_id:'91',position:'甲方观点',basis:'甲方事实'},{department_id:'92',position:'乙方观点',basis:'乙方事实'}]};
  assert.equal(escalationMaterials(materials,['91','92']).positions.length,2);
  for(const alter of [m=>delete m.impact_scope,m=>delete m.coordination_history,m=>m.positions.pop(),m=>m.positions[0].basis='']) {
    const copy=structuredClone(materials);alter(copy);assert.throws(()=>escalationMaterials(copy,['91','92']),{code:'PROCESS_DISPUTE_MATERIALS_REQUIRED'});
  }
});
test('independent suggestions require scope, evidence and a reason they do not block current facts',()=>{
  const input={action:'add_suggestion',request_id:'00000000-0000-4000-8000-000000000001',title:'减少重复录入',affected_scope:'已确认的现行录入步骤',basis:'两部门事实核对',non_blocking_reason:'本次如实记录现有步骤，优化另行修订'};
  assert.equal(normalizeInput(input).status,'open');
  assert.throws(()=>normalizeInput({...input,non_blocking_reason:''}));
});
test('explicit migration is idempotent, modifies only nullability/defaults and preserves legacy values',async()=>{
  const rows=[{TABLE_NAME:'process_design_drafts',COLUMN_NAME:'planned_edition',COLUMN_TYPE:'varchar(16)',EXTRA:'',IS_NULLABLE:'NO',COLUMN_DEFAULT:null}, {TABLE_NAME:'process_design_versions',COLUMN_NAME:'edition',COLUMN_TYPE:'varchar(16)',EXTRA:'',IS_NULLABLE:'NO',COLUMN_DEFAULT:null},{TABLE_NAME:'process_design_versions',COLUMN_NAME:'effective_at',COLUMN_TYPE:'timestamp',EXTRA:'DEFAULT_GENERATED',IS_NULLABLE:'NO',COLUMN_DEFAULT:'CURRENT_TIMESTAMP'}];
  const legacy={edition:'B',planned_edition:'C',effective_at:'2026-01-01'};const original=structuredClone(legacy),writes=[];
  const db={execute:async(sql)=>{if(sql.includes('information_schema.COLUMNS'))return [structuredClone(rows)];writes.push(sql);if(sql.startsWith('ALTER TABLE')){const parts=sql.split(' ');const row=rows.find(r=>r.TABLE_NAME===parts[2]&&r.COLUMN_NAME===parts[5]);row.IS_NULLABLE='YES';row.COLUMN_DEFAULT=null;row.EXTRA='';}return [{affectedRows:1}];}};
  await assert.rejects(migration.applyMigration(db),/AUTHORIZATION_REQUIRED/);assert.equal(writes.length,0);
  assert.equal((await migration.applyMigration(db,{authorized:true})).changed,3);assert.deepEqual(legacy,original);
  assert.equal((await migration.applyMigration(db,{authorized:true})).changed,0);assert.equal(writes.some(sql=>/^UPDATE|DELETE|DROP/i.test(sql)),false);
  for(const alter of [r=>r.COLUMN_TYPE='varchar(255)',r=>r.COLUMN_DEFAULT='A',r=>r.EXTRA='on update CURRENT_TIMESTAMP']) {
    const drifted=structuredClone(rows);alter(drifted[0]);const driftDb={execute:async()=>[drifted]};
    const inspection=await migration.inspectSchema(driftDb);assert.equal(inspection.ready,false);assert.equal(inspection.drift.length,1);assert.deepEqual(inspection.statements,[]);
    await assert.rejects(migration.applyMigration(driftDb,{authorized:true}),/SCHEMA_DRIFT/);
  }
});
test('suggestion history preserves proposer, rejects stale and unauthorized disposition, and resolves uncertain retry idempotently',async()=>{
  const events=[],row={id:'1',current_revision_id:'9',current_revision_no:3,current_content_hash:'a'.repeat(64),owning_department_id:'91'};
  const db={execute:async(sql,params)=>{
    if(sql.startsWith('SELECT payload_json'))return [events.filter(e=>JSON.parse(e.payload_json).request_id===params[2])];
    if(sql.startsWith('SELECT CAST(id'))return [structuredClone(events)];
    if(sql.startsWith('INSERT INTO process_v7_preview_events')){events.push({event_id:String(events.length+1),actor_person_id:params[4],payload_json:params[8],created_at:'2026-10-20'});return [{affectedRows:1}];}
    throw Error('Unexpected storage operation');
  }};
  const contact={personId:'83',departmentId:'91',roleCodes:new Set(['department_contact']),permissions:new Set(['governance:draft-department','governance:submit-department'])};
  const lead={personId:'88',departmentId:'92',roleCodes:new Set(['mdm_lead']),permissions:new Set(['governance:assign-work'])};
  const input={action:'add_suggestion',request_id:'00000000-0000-4000-8000-000000000001',expected_event_id:'0',expected_revision_no:3,expected_content_hash:row.current_content_hash,basis:'已确认现状存在重复录入',title:'后续减少重复录入',affected_scope:'录入步骤',non_blocking_reason:'当前事实和责任已经准确记录'};
  const first=await appendControl(db,row,contact,input);assert.equal(first.suggestions.length,1);
  assert.equal((await appendControl(db,row,contact,input)).idempotent,true);assert.equal(events.length,1);
  const dispose={action:'dispose_suggestion',request_id:'00000000-0000-4000-8000-000000000002',expected_event_id:'1',expected_revision_no:3,expected_content_hash:row.current_content_hash,suggestion_id:input.request_id,status:'planned',basis:'后续修订安排',disposition:'下轮收集部门意见'};
  await assert.rejects(appendControl(db,row,contact,dispose),e=>e.payload?.code==='FORMAL_CONTROL_ACTION_DENIED');assert.equal(events.length,1);
  await assert.rejects(appendControl(db,row,lead,{...dispose,expected_content_hash:'b'.repeat(64)}),e=>e.payload?.code==='FORMAL_CONTROL_SOURCE_CHANGED');assert.equal(events.length,1);
  const final=await appendControl(db,row,lead,dispose);assert.equal(final.suggestions[0].actor_person_id,'83');assert.equal(final.suggestions[0].history.length,2);assert.equal(final.suggestions[0].status,'planned');
  assert.equal((await readControls(db,{...row,current_revision_no:4,current_content_hash:'new'})).suggestions.length,1);
});
