import test from 'node:test';
import assert from 'node:assert/strict';
import {handoffImpactChoices} from '../src/handoffImpactPresentation.js';

const publications=[{publication_id:'publication-fixed',manifest:{items:[
  {item_ref:'old-object',target_kind:'object',target_id:'100',target_version_ref:'object-old',payload:{definition:{name:'历史资产卡片'}}},
  {item_ref:'old-field',target_kind:'field',target_id:'200',target_version_ref:'field-old',payload:{definition:{name:'历史资产编号'}}},
  {item_ref:'old-element',target_kind:'data_element',target_version_ref:'element-old',payload:{definition:{name:'资产编号定义'}}},
  {item_ref:'old-context',target_kind:'context',target_version_ref:'context-old',payload:{definition:{name:'入账登记'}}}
]}},{publication_id:'publication-new',manifest:{items:[{item_ref:'new-object',target_kind:'object',target_id:'100',target_version_ref:'object-new',payload:{definition:{name:'当前资产卡片名称'}}}]}}];

test('impact choices keep exact reference keys and use explicit fixed versions rather than current names or array order',()=>{
  const impacts=[
    {reference_key:'opaque-a',reference_kind:'definition_identifier',definition_version_id:'object-old',entity_type:'object',field_version_id:'field-old'},
    {reference_key:'opaque-b',reference_kind:'definition_parent',definition_version_id:'field-old',entity_type:'field',object_version_id:'object-old'},
    {reference_key:'opaque-c',reference_kind:'field_element_binding',field_version_id:'field-old',element_version_id:'element-old',context_version_ref:'context-old'},
    {reference_key:'opaque-d',reference_kind:'publication_item',publication_id:'publication-fixed',item_ref:'old-field',target_kind:'field'},
    {reference_key:'opaque-e',reference_kind:'prior_package_publication',publication_id:'publication-fixed'},
    {reference_key:'opaque-missing-table',reference_kind:'schema_not_installed'}
  ];
  const original=structuredClone(impacts),choices=handoffImpactChoices(impacts,publications);
  assert.deepEqual(choices.map(row=>row.value),['opaque-a','opaque-b','opaque-c','opaque-d','opaque-e']);
  assert(choices[0].name.includes('历史资产卡片 / 历史资产编号'));
  assert(choices[1].name.includes('历史资产编号 → 历史资产卡片'));
  assert(choices[2].name.includes('历史资产编号 → 资产编号定义（入账登记）'));
  assert(choices[3].name.includes('字段：历史资产编号'));
  assert(!choices.some(row=>row.name.includes('当前资产卡片名称')||row.name.includes('opaque-')));
  assert.deepEqual(handoffImpactChoices([...impacts].reverse(),[...publications].reverse()).reverse(),choices);
  assert.deepEqual(impacts,original);
});

test('missing fixed names remain explicit and machine names never become visible labels',()=>{
  const impacts=[{reference_key:'do-not-parse:object-old',reference_kind:'definition_parent',definition_version_id:'unknown',entity_type:'field',object_version_id:'missing'},{reference_key:'opaque-f',reference_kind:'unknown_reference_type',name:'/api/private/technical'}];
  const choices=handoffImpactChoices(impacts,publications);
  assert.equal(choices[0].name,'字段归属 · 历史名称未记录 → 历史名称未记录');
  assert.equal(choices[1].name,'已有引用 · 历史引用材料名称未记录');
  assert(!choices.some(row=>row.name.includes('do-not-parse')||row.name.includes('/api/')));
});
