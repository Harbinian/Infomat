import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {draftValueText,draftValueFromText} from '../src/handoffDraftValuePresentation.js';
import {upgradeAssessmentBody,restorationRequestBody} from '../src/handoffUpgradePublicationModel.js';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};return next(url,context);}});
const {HandoffDraftFields}=await import('../src/HandoffDraftEditor.jsx');
const {default:Upgrade}=await import('../src/HandoffSourceUpgradePanel.jsx');
const {default:Publication}=await import('../src/HandoffPublicationPanel.jsx');
const render=(component,props)=>renderToStaticMarkup(React.createElement(component,props));
const visible=html=>html.replace(/<[^>]+>/g,'');
const hidden='ed42c921-75d5-415b-bc54-cf617c1bd4a2';
const proof={basis:'合成核对依据',evidence_refs:'合成检查表第一节'};

test('known draft values are readable and explicit edits preserve original aliases and open business descriptions',()=>{
  assert.equal(draftValueText('data_type','int'),'整数');
  assert.equal(draftValueFromText('data_type','整数','int'),'int');
  assert.equal(draftValueFromText('data_type','整数','integer'),'integer');
  assert.equal(draftValueText('operations',['read','update']),'读取\n更新');
  assert.equal(draftValueFromText('operations','读取\n更新',['read','update']),'read\nupdate');
  assert.equal(draftValueText('data_type','legacy_private_machine_type'),'');
  assert.equal(draftValueFromText('data_type','按业务约定填写的其他类型','old'),'按业务约定填写的其他类型');
});

test('actual draft fields render business values without changing their saved technical tokens',()=>{
  const value={scope_mode:'current',items:[{item_ref:hidden,target_kind:'field',operation:'create',definition:{name:'合成订单编号',data_type:'string',required:true,sensitivity:'internal',masking:'none'},source_detail_refs:[],evidence_refs:[]}],dispositions:[],impact_dispositions:[]};
  const before=structuredClone(value),html=render(HandoffDraftFields,{value,onChange(){}});
  assert.match(html,/value="文本"/);assert.match(html,/value="内部使用"/);assert.match(html,/value="不脱敏"/);
  assert.doesNotMatch(html,/<input[^>]+value="(?:string|internal|none)"/);
  assert.doesNotMatch(visible(html),new RegExp(hidden));assert.deepEqual(value,before);
});

test('upgrade errors identify business material and serialization remains exact',()=>{
  const input={expectedRevision:2,sourcePackageId:'507',sourceBindingId:hidden,sourceBindingsExist:true,comparison:{source_package_id:'507',comparison_digest:'digest',changes:[{}]},...proof,decisions:[{detail_ref:hidden,change_kind:'unchanged',decision:'',reuse_scope:[],rechecks:{}}]};
  const before=structuredClone(input);
  assert.throws(()=>upgradeAssessmentBody(input,()=> '合成订单编号'),error=>error.message.includes('合成订单编号')&&!error.message.includes(hidden));
  input.decisions[0]={...input.decisions[0],decision:'recheck',...proof,rechecks:Object.fromEntries(['facts','conclusions','shared_definitions','impact'].map(key=>[key,proof]))};
  const raw=upgradeAssessmentBody(input),named=upgradeAssessmentBody(input,()=> '合成订单编号');
  assert.deepEqual(named,raw);assert.equal(named.decisions[0].detail_ref,hidden);assert.equal(before.decisions[0].decision,'');
});

test('restoration errors never use source identifiers as names and valid bodies remain exact',()=>{
  const input={expectedRevision:1,targetPackageId:'507',targetTrace:{package_id:'507',drafts:[]},targetBindingId:hidden,targetMode:'new',scopeMode:'current',restorationDraft:{items:[]},...proof,itemMappings:[{source_item_ref:hidden,target_item_ref:'target',content_decision:'',...proof}]};
  assert.throws(()=>restorationRequestBody(input,()=> '合成订单记录'),error=>error.message.includes('合成订单记录')&&!error.message.includes(hidden));
  input.itemMappings[0].content_decision='adopt';const before=structuredClone(input);
  assert.deepEqual(restorationRequestBody(input,()=> '合成订单记录'),restorationRequestBody(input));assert.deepEqual(input,before);
});

test('upgrade and restoration retain unavailable original choices without selecting another review',()=>{
  const source={process_name:'合成订单流程'},binding={binding_id:'visible-choice',created_at:'2026-10-22T05:02:03.000Z',snapshot_json:{detail_versions:[]}};
  const resource={header:{handoff_id:'draft',current_revision:1},revision:{binding_id:'visible-choice'},allowed_actions:['source_upgrade_assessment']};
  const trace={source,bindings:[binding],revisions:[]};
  const values={handoffId:'draft',expectedRevision:1,sourcePackageId:'507',sourceBindingId:hidden,sourceTrace:{source,bindings:[binding]},comparison:{source_package_id:'507',counts:{}},decisions:[],basis:'',evidence_refs:''};
  const before=structuredClone(values),up=render(Upgrade,{api(){},selection:{kind:'handoff'},resource,trace,capabilities:{},draft:{kind:'upgrade_assessment',values},begin(){},edit(){},execute(){}});
  assert.match(up,/原选择的审核材料当前没有可读说明/);assert.match(up,new RegExp('value="'+hidden+'"[^>]*selected'));assert.doesNotMatch(visible(up),new RegExp(hidden));assert.deepEqual(values,before);
  const publication={publication_id:'pub',event_revision:1,allowed_actions:['prepare_restoration'],manifest:{items:[]},events:[]};
  const restoration={publicationId:'pub',expectedRevision:1,targetPackageId:'507',targetBindingId:hidden,targetTrace:{package_id:'507',work_package:{},source,bindings:[binding],drafts:[]},scopeMode:'current',targetMode:'new'};
  const restoreBefore=structuredClone(restoration),html=render(Publication,{api(){},selection:{kind:'publication'},resource:publication,trace,capabilities:{},draft:{kind:'publication_restore',values:restoration},begin(){},edit(){},execute(){}});
  assert.match(html,/原选择的审核材料当前没有可读说明/);assert.doesNotMatch(visible(html),new RegExp(hidden));assert.deepEqual(restoration,restoreBefore);
});

const {readablePackageChoices}=await import('../src/HandoffPackagePicker.jsx');
test('package choices use bounded authorized reads, preserve order and identify incomplete material',async()=>{
 const packages=Array.from({length:9},(_,i)=>({package_id:String(i+1),status:'completed'}));let active=0,max=0;const observed=[];
 const api=async(url,{signal})=>{assert.equal(signal.aborted,false);const id=url.split('/').at(-2);observed.push(id);active++;max=Math.max(max,active);await new Promise(resolve=>setTimeout(resolve,3));active--;if(id==='3')throw Error('synthetic unreadable');return {source:{process_name:'合成同名流程',version_no:Number(id),status:id==='1'?'superseded':'published'}};};
 const controller=new AbortController(),result=await readablePackageChoices(api,packages,controller.signal);
 assert.equal(max,4);assert.equal(observed.length,9);assert.equal(result.incomplete,true);assert.deepEqual(result.items.map(row=>row.value),packages.map(row=>row.package_id));assert.match(result.items[0].label,/合成同名流程/);assert.match(result.items[2].label,/来源说明暂未读取/);
});
test('package choices abort before starting reads when their visible context expires',async()=>{
 const controller=new AbortController();controller.abort();let called=0;await assert.rejects(()=>readablePackageChoices(async()=>{called++;},[{package_id:'507'}],controller.signal),error=>error.name==='AbortError');assert.equal(called,0);
});
