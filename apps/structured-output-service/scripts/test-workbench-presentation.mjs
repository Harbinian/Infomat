// Read-only business presentation checks. Stable identities and source documents must remain unchanged.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {catalog,businessLabel,referenceName,fields,messageForUser,clone,resolve,labelValue} from '../frontend/model.mjs';
const require=createRequire(import.meta.url);
const {createWorkbenchGraphFixture}=require('./workbench-graph-fixture.js');
let count=0;
const test=(name,run)=>{run();count+=1;console.log(`PASS ${name}`);};
test('all fixture object names hide identities while retaining valid targets',()=>{
  const doc=createWorkbenchGraphFixture(),before=JSON.stringify(doc),entries=catalog(doc);
  for(const entry of entries){const label=businessLabel(entries,entry);assert(label);for(const item of entries)assert(!label.includes(item.ref),label);assert.equal(resolve(doc,entry).status,'valid');}
  assert.equal(JSON.stringify(doc),before);
});
test('same-name fields show their actual business owners and keep exact lookup values',()=>{
  const doc=createWorkbenchGraphFixture(),copy=clone(doc.data_objects[0]);copy.data_ref='second_owner';copy.data_name='另一份台账';copy.fields[0].field_ref='second_field';doc.data_objects.push(copy);
  const entries=catalog(doc),a=entries.find(x=>x.ref==='graph_field_amount'),b=entries.find(x=>x.ref==='second_field');
  assert.notEqual(businessLabel(entries,a),businessLabel(entries,b));assert(businessLabel(entries,a).includes(doc.data_objects[0].data_name));assert(businessLabel(entries,b).includes('另一份台账'));
  const options=fields(doc,{kind:'form-item',ref:'graph_item_amount',parentRef:'graph_form'}).find(x=>x.key==='data_field_ref').options;
  assert(options.some(x=>x.value==='graph_field_amount'));assert(!options.some(x=>x.value==='second_field'));assert(!options.some(x=>x.label.includes(x.value)));
});
test('indistinguishable names have stable display cues independent of array order',()=>{
  const doc=createWorkbenchGraphFixture(),field=clone(doc.data_objects[0].fields[0]);field.field_ref='same_owner_second_field';doc.data_objects[0].fields.push(field);
  const labels=()=>Object.fromEntries(catalog(doc).filter(x=>x.kind==='data-field').map(x=>[x.ref,businessLabel(catalog(doc),x)]));
  const before=labels();assert.notEqual(before.graph_field_amount,before.same_owner_second_field);doc.data_objects[0].fields.reverse();assert.deepEqual(labels(),before);
});
test('ambiguous references stay disabled and are never replaced by same-name objects',()=>{
  const doc=createWorkbenchGraphFixture(),field=clone(doc.data_objects[0].fields[0]);doc.data_objects[0].fields.push(field);
  const before=JSON.stringify(doc),entries=catalog(doc);assert(referenceName(entries,field.field_ref).includes('无法唯一确定'));
  const options=fields(doc,{kind:'form-item',ref:'graph_item_amount',parentRef:'graph_form'}).find(x=>x.key==='data_field_ref').options;
  assert(options.filter(x=>x.value===field.field_ref).every(x=>x.disabled));assert.equal(JSON.stringify(doc),before);
});
test('missing and wrong-owner references retain their raw value behind a business warning',()=>{
  const doc=createWorkbenchGraphFixture();doc.forms[0].areas[0].items[0].data_field_ref='lost_field_identity';const before=JSON.stringify(doc);
  const spec=fields(doc,{kind:'form-item',ref:'graph_item_amount',parentRef:'graph_form'}).find(x=>x.key==='data_field_ref');
  const old=spec.options.find(x=>x.value==='lost_field_identity');assert(old.disabled);assert(!old.label.includes(old.value));assert(old.label.includes('原引用保留'));assert.equal(JSON.stringify(doc),before);
});
test('generated diagnostics hide reference keys and paths while preserving business numbers',()=>{
  const doc=createWorkbenchGraphFixture();doc.forms[0].areas[0].items[0].data_field_ref='missing.original[1]';
  const text=messageForUser(doc,'/forms/0/areas/0/items/0/data_field_ref: graph_field_amount 与 missing.original[1] 不一致，表单编号 TEST-GRAPH、制度 GLTX-JY-34');
  assert(!text.includes('graph_field_amount'));assert(!text.includes('missing.original[1]'));assert(!text.includes('/forms/'));assert(!text.includes('data_field_ref'));assert(text.includes('TEST-GRAPH'));assert(text.includes('GLTX-JY-34'));
  const duplicate=messageForUser(doc,'技术标识 graph_field_amount 在当前范围内重复；稳定标识存在歧义');assert(!/技术标识|稳定标识/.test(duplicate));assert(duplicate.includes('重复'));assert(duplicate.includes('关联无法唯一确定'));
});
test('formatting a short identity never corrupts a longer value',()=>{
  const doc=createWorkbenchGraphFixture();doc.process.process_ref='1';assert(messageForUser(doc,'1 与 10 的记录需核对').includes('10'));
});
test('unrecognized machine enums show a review cue without altering business codes',()=>{
  assert.equal(labelValue('unknown_lifecycle_action'),'原有选项待核对');assert.equal(labelValue('unknown'),'原有选项待核对');assert.equal(labelValue('GLTX-JY-34'),'GLTX-JY-34');assert.equal(labelValue('文本'),'文本');
});
console.log(`Workbench business presentation passed (${count} groups).`);
