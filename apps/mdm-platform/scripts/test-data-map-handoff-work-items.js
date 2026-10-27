const test=require('node:test'),assert=require('node:assert/strict');
const {projectHandoffWorkItems:project}=require('../server/dataMapHandoffWorkItems');
const {selectSnapshot}=require('../server/dataMapHandoffReadSnapshot');
const capabilities={enabled:true,read_only:false,cutover_state:'controlled',schema_ready:true,role_codes:['mdm_lead']};
const base=extra=>({capabilities,...extra});
test('only exact resource actions become actionable items and selectors preserve IDs',()=>{
  const value=project(base({drafts:[{header:{handoff_id:'exact-draft',package_id:'9007199254741001',state:'submitted',current_revision:3},allowed_actions:['read','approve','needs_changes','checks']}],
    facts:[{fact_id:'exact-fact',package_id:'9',status:'open',question_text:'precise question',allowed_actions:['read','answer']}],
    conflicts:[{conflict_id:'exact-conflict',package_id:'9',handoff_id:'exact-draft',state:'escalated',allowed_actions:['read','decide']},{conflict_id:'read-only',state:'resolved',allowed_actions:['read','reopen']}] }));
  assert.equal(value.length,3);
  assert.equal(value.find(x=>x.type==='data_map_handoff_draft').target,'/app/data-map-handoffs?handoff=exact-draft');
  assert.equal(value.find(x=>x.type==='data_map_handoff_draft').package_id,'9007199254741001');
  assert.equal(value.find(x=>x.type==='data_map_handoff_conflict').roleHint,'decision_group');
  assert(value.every(x=>x.canAct&&x.sourceType==='data_map_handoff'&&!('related_mapping_id' in x)));
});
test('disabled maintenance readonly unready and administrator overlaps never create actions',()=>{
  for(const change of [{enabled:false},{read_only:true},{schema_ready:false},{cutover_state:'prepared'},{role_codes:['admin','mdm_lead']}])
    assert.deepEqual(project({capabilities:{...capabilities,...change},facts:[{fact_id:'f',allowed_actions:['answer']}]}),[]);
});
test('draft headers without per-resource allowed actions cannot fabricate work',()=>{
  assert.deepEqual(project(base({drafts:[{header:{handoff_id:'a',state:'draft'},allowed_actions:['read']},{header:{handoff_id:'b',state:'published'},allowed_actions:['read']}]})),[]);
});
test('legacy intake and corrections use exact package selection without generic completed-package tasks',()=>{
  const packages=[{package_id:'7',status:'completed',allowed_actions:['prepare'],intakes:[],drafts:[]},
    {package_id:'8',status:'completed',binding_id:'binding',allowed_actions:['prepare'],drafts:[{binding_id:'binding',state:'published'}],publications:[]},
    {package_id:'9',status:'completed',allowed_actions:['review'],intakes:[{intake_id:'exact-intake',state:'prepared'}]}];
  const items=project(base({packages}));assert.equal(items.length,2);
  assert.equal(items.find(x=>x.package_id==='7').target,'/app/data-map-handoffs?package=7');
  assert.equal(items.find(x=>x.package_id==='9').intake_id,'exact-intake');
});
test('department projection contains the directed question identifiers without package body',()=>{
  const items=project({capabilities:{...capabilities,role_codes:['department_mdm_reviewer']},facts:[{fact_id:'f',package_id:'7',status:'answered',target_department_id:'91',allowed_actions:['read','confirm'],snapshot_json:{secret:'never projected'},events:['never projected']} ]});
  assert.equal(items[0].roleHint,'department_mdm_reviewer');assert.deepEqual(items[0].allowed_actions,['confirm']);
  assert.equal(items[0].target,'/app/data-map-handoffs?fact=f');assert(!('snapshot_json' in items[0]));assert(!('events' in items[0]));
});
test('discovery facade only exposes SELECT and removes tail locks without exposing transaction or write capability',async()=>{
  const calls=[],reader=selectSnapshot({async execute(sql,params){calls.push({sql,params});return[[]];},commit(){throw Error('not exposed');}});
  assert.deepEqual(Object.keys(reader),['execute']);assert.equal(reader.commit,undefined);assert.equal(reader.getConnection,undefined);
  await reader.execute('SELECT id FROM fixed_table WHERE id=? FOR UPDATE',['exact-id']);
  await reader.execute('SELECT id FROM fixed_table FOR SHARE');
  assert.equal(calls[0].sql,'SELECT id FROM fixed_table WHERE id=?');assert.deepEqual(calls[0].params,['exact-id']);assert.equal(calls[1].sql,'SELECT id FROM fixed_table');
  for(const sql of ['UPDATE x SET id=1','COMMIT','SHOW CREATE TABLE x','SELECT 1; DELETE FROM x','SELECT 1 INTO OUTFILE \'x\'','SELECT GET_LOCK(\'x\',1)','SELECT 1 /* invalid path */'])
    await assert.rejects(()=>reader.execute(sql),TypeError);
  assert.equal(calls.length,2);
});
