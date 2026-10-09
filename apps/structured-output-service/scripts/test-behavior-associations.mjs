import assert from 'node:assert/strict';
import { behaviorAssociations } from '../frontend/behavior-associations.mjs';

const target = { kind: 'behavior', ref: 'step' };
const fixture = () => ({ process: { process_ref: 'process', process_name: '测试流程' }, behaviors: [{ behavior_ref: 'step', behavior_name: '资料核对' }], data_objects: [
  { data_ref: 'data', data_name: '资料台账', fields: [{ field_ref: 'field', field_name: '金额' }], behavior_links: [
    { link_ref: 'create', behavior_ref: 'step', operation: 'create' },
    { link_ref: 'use', behavior_ref: 'step', operation: 'use' },
    { link_ref: 'update', behavior_ref: 'step', operation: 'update', updated_field_refs: ['field'] },
    { link_ref: 'pending', behavior_ref: 'step', operation: 'pending_confirmation' },
  ] },
], forms: [{ form_ref: 'form', form_name: '核对记录', behavior_links: [{ link_ref: 'form-link', behavior_ref: 'step', operations: ['fill', 'review'] }] }] });
const group = (doc, key) => behaviorAssociations(doc, target).groups.find(item => item.key === key);
let count = 0;
const test = (name, run) => { run(); count++; console.log(`PASS ${name}`); };
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
test('recorded operations group distinct owned objects without changing frozen source', () => {
  const doc = freeze(fixture()), before = JSON.stringify(doc), result = behaviorAssociations(doc, target);
  assert.equal(result.groups.length, 5);
  for (const key of ['create', 'update', 'use', 'pending', 'form']) assert.equal(group(doc, key).count, 1);
  assert.deepEqual(group(doc, 'form').items[0].operations, ['填写', '复核']);
  assert.deepEqual(group(doc, 'use').items[0].target, { kind: 'data', ref: 'data' });
  assert.equal(JSON.stringify(doc), before);
});
test('duplicate links count one object while preserving all recorded form operations', () => {
  const doc = fixture(); doc.data_objects[0].behavior_links.push({ link_ref: 'second-use', behavior_ref: 'step', operation: 'use' });
  doc.forms[0].behavior_links.push({ link_ref: 'second-form-link', behavior_ref: 'step', operations: ['review', 'archive'] });
  assert.equal(group(doc, 'use').count, 1); assert.equal(group(doc, 'form').count, 1);
  assert.deepEqual(group(doc, 'form').items[0].operations, ['填写', '复核', '归档']);
});
test('same business names retain separate stable targets regardless of order', () => {
  const doc = fixture(); doc.data_objects.push({ data_ref: 'other-data', data_name: '资料台账', description: '另一项业务定义', behavior_links: [{ link_ref: 'other-use', behavior_ref: 'step', operation: 'use' }] });
  const before = Object.fromEntries(group(doc, 'use').items.map(item => [item.target.ref, item.label]));
  assert.equal(group(doc, 'use').count, 2); assert.notEqual(before.data, before['other-data']);
  doc.data_objects.reverse(); assert.deepEqual(Object.fromEntries(group(doc, 'use').items.map(item => [item.target.ref, item.label])), before);
});
test('missing or ambiguous selected behavior cannot infer associations', () => {
  const doc = fixture(); assert.equal(behaviorAssociations(doc, { kind: 'behavior', ref: 'lost' }).groups.length, 0);
  doc.behaviors.push({ behavior_ref: 'step', behavior_name: '另一环节' });
  assert.equal(behaviorAssociations(doc, target).groups.length, 0);
  doc.behaviors.pop(); doc.process.process_ref = 'step'; assert.equal(behaviorAssociations(doc, target).groups.length, 0);
});
test('ambiguous source identity stays visible, disabled and unmodified', () => {
  const doc = fixture(); doc.forms[0].form_ref = 'data'; const before = JSON.stringify(doc);
  const item = group(doc, 'use').items[0]; assert(item.disabled); assert(item.warnings.length); assert(!item.label.includes('data'));
  assert.equal(JSON.stringify(doc), before);
});
test('missing or duplicate link identity remains a review cue, not a repaired record', () => {
  const doc = fixture(); doc.data_objects[0].behavior_links[1].link_ref = 'create';
  assert(group(doc, 'use').items[0].disabled);
  delete doc.data_objects[0].behavior_links[1].link_ref; assert(group(doc, 'use').items[0].disabled);
});
test('wrong-owner and missing updated fields retain original facts with a warning', () => {
  const doc = fixture(); doc.data_objects.push({ data_ref: 'other', fields: [{ field_ref: 'other-field', field_name: '金额' }] });
  doc.data_objects[0].behavior_links[2].updated_field_refs = ['other-field', 'lost']; const before = JSON.stringify(doc);
  assert(group(doc, 'update').items[0].disabled); assert(group(doc, 'update').items[0].warnings[0].includes('所属对象'));
  assert.equal(JSON.stringify(doc), before);
});
test('unrecognized and absent operations are retained behind Chinese review text', () => {
  const doc = fixture(); doc.data_objects[0].behavior_links[3].operation = 'old_unknown_action';
  doc.forms[0].behavior_links[0].operations = ['old_form_action']; const before = JSON.stringify(doc);
  assert(group(doc, 'pending').items[0].warnings.includes('原有数据操作待核对'));
  assert.deepEqual(group(doc, 'form').items[0].operations, ['原有选项待核对']);
  assert(!JSON.stringify(behaviorAssociations(doc, target)).includes('old_unknown_action'));
  assert.equal(JSON.stringify(doc), before);
});
test('an unrelated behavior produces four explicitly empty groups', () => {
  const doc = fixture(); doc.behaviors.push({ behavior_ref: 'empty', behavior_name: '结束' });
  const result = behaviorAssociations(doc, { kind: 'behavior', ref: 'empty' });
  assert.equal(result.groups.length, 4); assert(result.groups.every(item => item.count === 0));
});
console.log(`Behavior association presentation passed (${count} groups).`);
