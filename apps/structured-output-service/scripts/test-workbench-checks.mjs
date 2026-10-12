// Read-only source input; exercises checks, editing and downloads entirely in memory. Optional argument: user JSON path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { collectWorkbenchChecks } from '../frontend/checks.mjs';
import { createWorkbenchController } from '../frontend/controller.mjs';
import { DOMAIN_MODULE_FILES } from '../frontend/bridge.mjs';
import { clone, newEntity } from '../frontend/model.mjs';
const require = createRequire(import.meta.url);
const modules = Object.fromEntries(DOMAIN_MODULE_FILES.map(({ name, file }) => [name, require(`../public/${file}`)]));
const server = require('../server.js'), scoring = modules.StructureLearningScore;
const sourcePath = process.argv[2], sourceBytes = sourcePath && fs.readFileSync(sourcePath);
function fixture() {
  const document = server.createEmptyProcessGovernanceDocument();
  document.behaviors = ['到货类型判断', '到货类型判断', '类型A', '类型B', '类型C', '后续流程'].map((name, i) => ({
    ...newEntity('behavior', `sample_behavior_${i}`), behavior_name: name, node_type: i === 1 ? 'decision' : 'action',
    behavior_description: i === 0 ? '22' : i === 1 ? '111' : '', current_actor_role: i === 0 ? '222' : i === 1 ? '111' : ''
  }));
  document.flow_relations = [[0,1,'sequence'],[1,2,'condition'],[1,3,'condition'],[1,4,''],[2,5,'sequence'],[3,5,'sequence'],[4,5,'sequence']]
    .map(([from,to,type], i) => ({ relation_ref:`sample_relation_${i}`, from_behavior_ref:document.behaviors[from].behavior_ref,
      to_behavior_ref:document.behaviors[to].behavior_ref, relation_type:type, condition:'' }));
  return document;
}
const document = sourceBytes ? JSON.parse(sourceBytes.toString('utf8')) : fixture();
const check = doc => collectWorkbenchChecks(doc, server.processGovernanceValidationResult(doc), scoring);
let passed = 0;
async function test(name, run) { await run(); passed += 1; console.log(`PASS ${name}`); }
async function make(extra = {}) {
  const downloads = [];
  const controller = createWorkbenchController({ modules, template:clone(document), initialDirty:false,
    schema:require('../../../docs/contracts/process-governance-v8.schema.json'),
    enums:{fieldType:['文本','金额','部门','人员']},
    validate:async doc => ({ ...server.processGovernanceValidationResult(doc), data:clone(doc) }),
    digest:bytes => createHash('sha256').update(bytes).digest('hex'), downloadFile:async result => downloads.push(result), ...extra });
  assert.equal((await controller.dispatch('init')).ok, true);
  return { controller, downloads };
}
await test('the supplied incomplete JSON produces distinct groups without mutation', () => {
  const before = JSON.stringify(document), result = check(document);
  assert.deepEqual(result.counts, { technical:0, incomplete:32, confirmation:2 });
  assert.equal(result.contentStatus, 'ready'); assert.equal(result.valid, true);
  assert.equal(result.issues.filter(x => x.category === '逐动作可执行性').length, 5);
  assert.equal(JSON.stringify(document), before);
});
await test('blank branch conditions do not count as complete decision outlets', () => {
  const result = check(document);
  assert(result.issues.some(x => x.message.includes('0条完整出口')));
  assert.equal(result.issues.filter(x => x.message.includes('判断条件为空')).length, 2);
  assert(result.issues.some(x => x.path === '/flow_relations/3/relation_type'));
  const fixed = clone(document);
  fixed.flow_relations.slice(1,4).forEach((relation, i) => { relation.relation_type='condition'; relation.condition=`到货类型为${['A','B','C'][i]}`; });
  assert(!check(fixed).issues.some(x => x.category === '判断出口' || x.path === '/flow_relations/3/relation_type'));
});
await test('concrete actions resolve executability issues while abstract descriptions remain visible', () => {
  const doc = clone(document); doc.behaviors.filter(x => x.node_type === 'action').forEach(x => x.behavior_description='核对到货清单，登记核对结果。');
  assert.equal(check(doc).issues.filter(x => x.category === '逐动作可执行性').length, 0);
  doc.behaviors[0].behavior_description='保证记录真实性';
  assert(check(doc).issues.some(x => x.ruleCode === 'BEHAVIOR_EXECUTABILITY_ABSTRACT_QUALITATIVE_DESCRIPTION'));
});
await test('empty objects and forms are applicability questions, not mandatory invented records', () => {
  const pending = check(document).issues.filter(x => x.group === 'confirmation');
  assert.deepEqual(pending.map(x => x.category), ['数据对象','表单结构']);
  assert(pending.every(x => x.suggestions.some(suggestion => /保留现状|不.*虚构/.test(suggestion))));
});
await test('explicit pending values remain confirmation questions', () => {
  const doc = clone(document); doc.behaviors[0].completion_standard='待确认';
  assert.equal(check(doc).issues.find(x => x.path === '/behaviors/0/completion_standard').group, 'confirmation');
});
await test('technical failures and content-check failures cannot become an empty successful report', () => {
  const doc = clone(document); doc.flow_relations[3].relation_type='invalid_option';
  const result = check(doc); assert(result.counts.technical > 0); assert.equal(result.valid, false); assert(result.counts.incomplete > 0);
  const unavailable = collectWorkbenchChecks(doc, server.processGovernanceValidationResult(doc), { evaluateContent(){throw new Error('unavailable');}, behaviorExecutabilityDetails(){} });
  assert.equal(unavailable.contentStatus, 'unavailable'); assert(unavailable.counts.technical > 0); assert.equal(unavailable.counts.confirmation, 1);
});
await test('controller check and actual draft bytes preserve the complete supplied document', async () => {
  const { controller:c, downloads } = await make(); const before=JSON.stringify(c.getSnapshot().document);
  await c.dispatch('check'); assert.deepEqual(c.getSnapshot().checks.counts, { technical:0, incomplete:32, confirmation:2 });
  assert.equal(JSON.stringify(c.getSnapshot().document), before); assert.equal(c.getSnapshot().revision, 0); assert.equal(c.getSnapshot().dirty, false);
  assert.equal((await c.dispatch('download')).ok, true);
  const exported=JSON.parse(new TextDecoder().decode(downloads[0].bytes));
  assert.deepEqual(scoring.semanticProjection(exported), scoring.semanticProjection(document)); c.destroy();
});
await test('basic metadata issues locate an editable existing root and apply one reversible change', async () => {
  const { controller:c } = await make(); await c.dispatch('check');
  const issue=c.getSnapshot().checks.issues.find(x => x.path === '/export_meta/compiler');
  assert.equal((await c.dispatch({type:'focus-issue',issue})).ok, true);
  assert.equal(c.getSnapshot().focus.field, 'compiler'); assert.equal(c.getSnapshot().selection.kind, 'export-meta');
  const oldMeta=clone(c.getSnapshot().document.export_meta), oldProcess=clone(c.getSnapshot().document.process);
  await c.dispatch({type:'update',field:'compiler',value:'测试编制人'}); await c.dispatch('apply');
  assert.equal(c.getSnapshot().document.export_meta.compiler, '测试编制人'); assert.deepEqual(c.getSnapshot().document.process, oldProcess);
  assert.equal(c.getSnapshot().checks.stale, true); assert.equal((await c.dispatch({type:'focus-issue',issue})).ok, false);
  await c.dispatch('undo'); assert.deepEqual(c.getSnapshot().document.export_meta, oldMeta); c.destroy();
});
await test('branch and action issues locate their exact editable fields', async () => {
  const { controller:c } = await make(); await c.dispatch('check');
  for (const path of ['/flow_relations/1/condition','/behaviors/0/behavior_description']) {
    const issue=c.getSnapshot().checks.issues.find(x => x.path === path);
    assert.equal((await c.dispatch({type:'focus-issue',issue})).ok, true);
    assert.equal(c.getSnapshot().focus.field, path.split('/').at(-1));
  }
  const pending=c.getSnapshot().checks.issues.find(x => x.category === '表单结构');
  assert.equal((await c.dispatch({type:'focus-issue',issue:pending})).ok, true); assert.equal(c.getSnapshot().view, 'list'); c.destroy();
});
await test('checking never silently applies pending input and errors still permit downloading', async () => {
  const { controller:c, downloads } = await make({ validate:async()=>({valid:false,errors:[{path:'/process/process_name',message:'测试结构错误'}]}) });
  await c.dispatch('check'); assert.equal(c.getSnapshot().checks.counts.technical, 1);
  assert.equal((await c.dispatch('download')).ok, true); assert.equal(downloads.length, 1);
  await c.dispatch({type:'select',target:{kind:'behavior',ref:document.behaviors[0].behavior_ref}}); await c.dispatch('edit');
  await c.dispatch({type:'update',field:'behavior_description',value:'保留可见输入'});
  assert.equal((await c.dispatch('check')).guard, true); await c.dispatch({type:'resolve-guard',choice:'continue'});
  assert.equal(c.getSnapshot().session.values.behavior_description, '保留可见输入'); assert.equal(c.getSnapshot().document.behaviors[0].behavior_description, '22'); c.destroy();
});
if (sourceBytes) assert.deepEqual(fs.readFileSync(sourcePath), sourceBytes);
console.log(`Workbench checks passed (${passed} groups). Source unchanged; no database or saved draft used.`);
