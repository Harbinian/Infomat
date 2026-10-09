// Fictional data for association presentation and guarded navigation checks.
const fs = require('node:fs');
const { createWorkbenchGraphFixture } = require('./workbench-graph-fixture');
const document = createWorkbenchGraphFixture();
const data = document.data_objects[0], behaviorRef = document.behaviors[0].behavior_ref;
data.behavior_links = ['create','update','use'].map((operation,index) => ({ link_ref: `association_data_${index}`, behavior_ref: behaviorRef, operation, updated_field_refs: operation === 'update' ? [data.fields[0].field_ref] : [] }));
data.behavior_links.push({ link_ref: 'association_data_repeated', behavior_ref: behaviorRef, operation: 'use', updated_field_refs: [] });
const pendingData = structuredClone(data);
pendingData.data_ref = 'association_pending_data'; pendingData.data_name = '虚构待确认资料';
pendingData.fields[0].field_ref = 'association_pending_field';
pendingData.behavior_links = [{ link_ref: 'association_pending_link', behavior_ref: behaviorRef, operation: 'pending_confirmation', updated_field_refs: [] }];
document.data_objects.push(pendingData);
document.forms[0].behavior_links = [{ link_ref: 'association_form_fill', behavior_ref: behaviorRef, operations: ['fill','review'], notes: '仅用于界面验证' }, { link_ref: 'association_form_archive', behavior_ref: behaviorRef, operations: ['archive'], notes: '仅用于验证按对象归组' }];
if (!process.argv[2]) throw new Error('Supply an explicit output file.');
fs.writeFileSync(process.argv[2], JSON.stringify(document, null, 2) + '\n');
