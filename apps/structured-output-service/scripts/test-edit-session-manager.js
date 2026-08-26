const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const EditSessionManager = require('../public/edit-session-manager.js');

const moduleSource = fs.readFileSync(path.join(__dirname, '../public/edit-session-manager.js'), 'utf8');
const browserContext = {};
vm.runInNewContext(moduleSource, browserContext);
assert.equal(typeof browserContext.EditSessionManager?.createManager, 'function', 'the UMD module must expose its browser API');

function openDataObject(manager, overrides = {}) {
  return manager.open({
    candidateKey: 'candidate-a',
    editorKind: 'data-object-properties',
    entityRef: 'data-order',
    allowedFields: ['data_name', 'description', 'information_type'],
    baselineFields: {
      data_name: '订单',
      description: '已应用说明',
      information_type: 'business_information'
    },
    patch: {},
    canApply: true,
    focusTarget: { selector: '#data-name', scrollTop: 120 },
    ...overrides
  });
}

{
  const manager = EditSessionManager.createManager();
  const opened = openDataObject(manager);
  assert.equal(opened.ok, true);
  assert.equal(manager.isDirty(), false, 'an untouched property session must not be pending');
  assert.equal(manager.isDirty('candidate-b'), false, 'dirty state must be isolated by candidate');
  assert.equal(manager.canApply(), true);
  assert.deepEqual(manager.get().focusTarget, { selector: '#data-name', scrollTop: 120 });

  const next = manager.open({
    candidateKey: 'candidate-b',
    editorKind: 'behavior-properties',
    entityRef: 'behavior-review',
    allowedFields: ['behavior_name'],
    baselineFields: { behavior_name: '复核订单' }
  });
  assert.equal(next.ok, true, 'a clean session may be replaced atomically');
  assert.equal(manager.get().candidateKey, 'candidate-b');
}

{
  const manager = EditSessionManager.createManager();
  openDataObject(manager);
  const update = manager.updatePatch({ description: '用户刚输入的说明', fields: [{ field_ref: 'forbidden' }] });
  assert.equal(update.ok, true);
  assert.deepEqual(update.ignoredFields, ['fields'], 'an editor must reject fields it does not own');
  assert.equal(manager.isDirty(), true);
  assert.equal(manager.isDirty('candidate-a'), true);
  assert.equal(manager.get().patch.description, '用户刚输入的说明');
  assert.equal(Object.prototype.hasOwnProperty.call(manager.get().patch, 'fields'), false);

  const blocked = manager.open({
    candidateKey: 'candidate-b',
    editorKind: 'data-object-properties',
    entityRef: 'data-order',
    allowedFields: ['data_name'],
    baselineFields: { data_name: '另一个候选的订单' }
  });
  assert.equal(blocked.ok, false, 'a dirty session must not be replaced by another candidate');
  assert.equal(blocked.code, 'ACTIVE_EDIT_SESSION');
  assert.equal(manager.get().candidateKey, 'candidate-a');
  assert.equal(manager.get({ candidateKey: 'candidate-b' }), null);

  const reused = openDataObject(manager, { baselineFields: { data_name: '不能覆盖原工作副本' } });
  assert.equal(reused.ok, true);
  assert.equal(reused.reused, true, 'reopening the same dirty entity must preserve its work copy');
  assert.equal(manager.get().patch.description, '用户刚输入的说明');
}

{
  const manager = EditSessionManager.createManager();
  const baseline = {
    data_name: '订单',
    description: '旧说明',
    information_type: 'business_information'
  };
  openDataObject(manager, { baselineFields: baseline });
  manager.replacePatch({ data_name: '销售订单', description: '旧说明' });
  assert.equal(manager.isDirty(), true);

  const currentEntity = {
    data_ref: 'data-order',
    data_name: '订单',
    description: '旧说明',
    information_type: 'business_information',
    fields: [{ field_ref: 'field-amount', field_name: '金额' }],
    behavior_links: [{ link_ref: 'link-create', operation: 'create' }],
    source_relations: [{ source_ref: 'source-sales' }],
    lifecycle: { applicability: 'applicable', routes: [{ route_ref: 'route-1' }] }
  };
  const before = JSON.parse(JSON.stringify(currentEntity));
  const merged = manager.mergeCurrentEntity(currentEntity);
  assert.equal(merged.ok, true);
  assert.deepEqual(merged.changedFields, ['data_name']);
  assert.equal(merged.mergedEntity.data_name, '销售订单');
  assert.deepEqual(merged.mergedEntity.fields, currentEntity.fields, 'a field patch must preserve nested fields');
  assert.deepEqual(merged.mergedEntity.behavior_links, currentEntity.behavior_links);
  assert.deepEqual(merged.mergedEntity.source_relations, currentEntity.source_relations);
  assert.deepEqual(merged.mergedEntity.lifecycle, currentEntity.lifecycle);
  assert.deepEqual(currentEntity, before, 'merging must not mutate the current entity');

  merged.mergedEntity.fields[0].field_name = '修改返回值';
  assert.equal(currentEntity.fields[0].field_name, '金额', 'the merged entity must not share nested references');
}

{
  const manager = EditSessionManager.createManager();
  openDataObject(manager);
  manager.updatePatch({ description: '面板修改' });
  const currentEntity = {
    data_ref: 'data-order',
    data_name: '订单',
    description: '其他入口已经修改',
    information_type: 'business_information',
    fields: [{ field_ref: 'field-amount' }]
  };
  const before = JSON.parse(JSON.stringify(currentEntity));
  const result = manager.mergeCurrentEntity(currentEntity);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'FIELD_CONFLICT');
  assert.deepEqual(result.conflicts.map(item => item.field), ['description']);
  assert.equal(result.conflicts[0].baselineValue, '已应用说明');
  assert.equal(result.conflicts[0].currentValue, '其他入口已经修改');
  assert.equal(result.conflicts[0].patchValue, '面板修改');
  assert.deepEqual(result.mergedEntity, currentEntity, 'a conflicting patch must not partially merge');
  assert.deepEqual(currentEntity, before, 'conflict detection must not mutate the input entity');
}

{
  const manager = EditSessionManager.createManager();
  openDataObject(manager);
  manager.updatePatch({ data_name: '销售订单' });
  const currentEntity = {
    data_ref: 'data-order',
    data_name: '订单',
    description: '已应用说明',
    information_type: 'business_information',
    fields: [{ field_ref: 'field-added-later' }],
    lifecycle: { analysis: { status: 'analyzed' } }
  };
  const merged = manager.mergeCurrentEntity(currentEntity);
  assert.equal(merged.ok, true, 'changes outside the editor-owned fields must not cause a conflict');
  assert.equal(merged.mergedEntity.data_name, '销售订单');
  assert.deepEqual(merged.mergedEntity.fields, [{ field_ref: 'field-added-later' }]);
  assert.deepEqual(merged.mergedEntity.lifecycle, { analysis: { status: 'analyzed' } });
}

{
  const manager = EditSessionManager.createManager();
  manager.open({
    candidateKey: 'candidate-a',
    editorKind: 'new-flow-relation-wizard',
    entityRef: 'new-flow-relation',
    allowedFields: ['relation_type', 'from_behavior_ref', 'to_behavior_ref'],
    baselineFields: {},
    patch: {},
    started: true,
    canApply: false,
    focusTarget: { selector: '#relation-type' }
  });
  assert.equal(manager.isDirty(), true, 'a started wizard is pending even before it has a patch');
  assert.equal(manager.canApply(), false);
  assert.equal(manager.mergeCurrentEntity({}).code, 'SESSION_NOT_APPLICABLE');

  manager.updatePatch({ relation_type: 'sequence' });
  manager.setCanApply(true);
  assert.equal(manager.canApply(), true);
  assert.equal(manager.get().patch.relation_type, 'sequence');

  const discarded = manager.discard();
  assert.equal(discarded.editorKind, 'new-flow-relation-wizard');
  assert.equal(manager.get(), null);
  assert.equal(manager.isDirty(), false);
}

{
  const manager = EditSessionManager.createManager();
  openDataObject(manager);
  manager.updatePatch({ data_name: '临时名称' });
  manager.reset();
  assert.equal(manager.get(), null);
  assert.equal(manager.canApply(), false);
  assert.equal(manager.updatePatch({ data_name: '不得恢复' }).code, 'NO_ACTIVE_SESSION');
}

{
  const baselineFields = { name: '原名称', protected: '不属于面板' };
  const patch = { name: '新名称', protected: '不得应用' };
  const currentEntity = { ref: 'entity-1', name: '原名称', protected: '最新受保护内容' };
  const result = EditSessionManager.mergeAllowedPatch({
    currentEntity,
    baselineFields,
    patch,
    allowedFields: ['name']
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.mergedEntity, { ref: 'entity-1', name: '新名称', protected: '最新受保护内容' });
  assert.deepEqual(baselineFields, { name: '原名称', protected: '不属于面板' });
  assert.deepEqual(patch, { name: '新名称', protected: '不得应用' });
  assert.deepEqual(currentEntity, { ref: 'entity-1', name: '原名称', protected: '最新受保护内容' });
}

console.log('edit session manager tests passed');
