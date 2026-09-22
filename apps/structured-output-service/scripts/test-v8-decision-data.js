// Run: node scripts/test-v8-decision-data.js [user JSON path]. Uses copies only; no database or source writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { processGovernanceValidationResult: validate } = require('../server');
const Migration = require('../public/process-governance-migration');
const Commands = require('../public/graph-edit-commands');
const Diagram = require('../public/data-relation-diagram');
const { createProcessVersionFixture } = require('./process-version-fixtures');
const { validateAndProjectV7 } = require('../../mdm-platform/server/processV7PreviewReview');
const clone = x => JSON.parse(JSON.stringify(x));
const doc = Migration.migrateDocument(createProcessVersionFixture('process-governance-v6'))[0];
assert.equal(validate(doc).valid, true, JSON.stringify(validate(doc)));
const data = doc.data_objects[0];
const node = doc.behaviors[0];
data.behavior_links = [{ link_ref: 'link_decision_basis', behavior_ref: node.behavior_ref, operation: 'use', updated_field_refs: [] }];
node.node_type = 'decision';
assert.equal(validate(doc).valid, true, JSON.stringify(validate(doc)));
assert.deepEqual(validateAndProjectV7(doc, [{id:1,name:doc.process.owning_department}]).errors, []);
const historical = clone(doc); historical.schema_version = 'process-governance-v7';
assert.ok(validate(historical).errors.some(e=>e.rule_code === 'DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'));
const migrated = Migration.migrateDocument(historical)[0];
assert.deepEqual(migrated, doc);
assert.deepEqual(Migration.migrateDocument(migrated)[0], migrated);
for (const kind of ['action','decision','parallel_split','parallel_join']) {
 for (const operation of ['use','create','update','pending_confirmation']) {
  const test = clone(doc);test.behaviors[0].node_type=kind;test.data_objects[0].behavior_links[0].operation=operation;
  const errors=validate(test).errors.filter(e=>e.rule_code==='DATA_RELATION_ACTION_BEHAVIOR_REQUIRED');
  assert.equal(errors.length>0,kind!=='action' && !(kind==='decision'&&operation==='use'), `${kind}+${operation}`);
  if(kind==='decision'&&operation!=='use')assert.match(errors[0].message,/判断节点仅允许使用.*实际执行步骤/);
 }
}
for (const mutate of [
 d=>d.data_objects[0].behavior_links[0].behavior_ref='missing_node',
 d=>{d.data_objects[0].behavior_links[0].operation='update';d.behaviors[0].node_type='action';d.data_objects[0].behavior_links[0].updated_field_refs=['missing_field'];},
 d=>{d.behaviors[0].actor_department_data_ref='missing_data';},
 d=>d.data_objects[0].behavior_links.push(clone(d.data_objects[0].behavior_links[0])),
 d=>d.data_objects[0].behavior_links[0].operation='invented'
]) {const test=clone(doc);mutate(test);assert.equal(validate(test).valid,false);}
const before=clone(doc);
const blocked=Commands.applyCommand(doc,{type:'set_data_operations',dataRef:data.data_ref,behaviorRef:node.behavior_ref,operations:['update'],refFactory:()=> 'new_link'});
assert.equal(blocked.ok,false);assert.deepEqual(doc,before);
const passed=Commands.applyCommand(doc,{type:'set_data_operations',dataRef:data.data_ref,behaviorRef:node.behavior_ref,operations:['use'],refFactory:()=> 'new_link'});
assert.equal(passed.ok,true);assert.deepEqual(passed.document,doc);
assert.throws(()=>Migration.migrateDocument(historical,{validateTarget:()=>({valid:false,errors:[{message:'isolated failure'}]})}),/isolated failure/);
assert.equal(historical.schema_version,'process-governance-v7');
for(const version of [1,2,3,4,5,6]) {
 const source=createProcessVersionFixture(`process-governance-v${version}`),snapshot=clone(source);
 const upgraded=Migration.migrateDocument(source)[0];
 assert.equal(validate(upgraded).valid,true,JSON.stringify(validate(upgraded)));
 assert.deepEqual(Migration.migrateDocument(upgraded)[0],upgraded);assert.deepEqual(source,snapshot);
}
if(process.argv[2]) {
 const bytes=fs.readFileSync(process.argv[2]);const digest=crypto.createHash('sha256').update(bytes).digest('hex');
 const source=JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,''));const sample=clone(source);
 const proof=sample.data_objects.find(d=>d.data_name==='软件合格证明');assert.ok(proof);
 const link=proof.behavior_links[1];assert.equal(link.operation,'use');
 const behavior=sample.behaviors.find(b=>b.behavior_ref===link.behavior_ref);assert.ok(behavior);behavior.node_type='decision';
 const path='/data_objects/0/behavior_links/1/behavior_ref';
 assert.ok(validate(sample).errors.some(e=>e.path===path&&e.rule_code==='DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'));
 const target=Migration.migrateDocument(sample)[0];const result=validate(target);
 assert.ok(!result.errors.some(e=>e.path===path&&e.rule_code==='DATA_RELATION_ACTION_BEHAVIOR_REQUIRED'));
 assert.deepEqual({...target,schema_version:sample.schema_version},sample);
 assert.deepEqual(Migration.migrateDocument(JSON.parse(JSON.stringify(target)))[0],target);
 assert.equal(crypto.createHash('sha256').update(fs.readFileSync(process.argv[2])).digest('hex'),digest);
 console.log(JSON.stringify({case_sha256:digest,counts:{behaviors:target.behaviors.length,relations:target.flow_relations.length,data:target.data_objects.length,dataLinks:target.data_objects.reduce((n,d)=>n+d.behavior_links.length,0)},remaining_errors:result.errors},null,2));
}
console.log('V8 decision data matrix, historical boundary, migration, identity, 3000 shared validation passed');
