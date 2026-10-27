import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {formalFieldChoice,formalSourcePresentation} from '../src/formalSourcePresentation.js';
import {formalIssueLocation,formalReadOnlyChecks} from '../src/formalReadability.js';

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
}});
const {FormalCurrentChecks}=await import('../src/ProcessFormal.jsx');
const {ProcessChecks}=await import('../src/ProcessChecks.jsx');
const {BusinessDetails}=await import('../src/BusinessDetails.jsx');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const source=()=>({process:{process_name:'合成申请流程'},forms:[{form_ref:'private-form',form_name:'合成申请单',areas:[{area_title:'申请内容',items:[{item_ref:'private-item',item_name:'申请编号',item_type:'文件编号',required:true,instructions:'关联同一次申请',value_usage_mode:'pending_confirmation',value_origin_mode:'pending_confirmation',source_links:[]}]}]}]});
const issue=index=>({group:'confirmation',message:`合成核对问题第${index}项`,category:'表单结构',path:'/forms/0/areas/0/items/0/value_origin_mode',suggestions:['点击本项返回对应位置，补充并核对页面高亮的字段。',`请核对合成依据第${index}项。`]});

test('formal source lookup appears before a long issue list and all checks remain available',()=>{
  const document=source(),raw={status:'ready',counts:{technical:0,incomplete:0,confirmation:100},issues:Array.from({length:100},(_,index)=>issue(index))};
  const before=structuredClone(raw),checks=formalReadOnlyChecks(raw,document);
  const html=render(FormalCurrentChecks,{checks,document,caseId:'synthetic-case',authoringEnabled:true,onLeave(){}});
  assert(html.indexOf('data-check-summary')<html.indexOf('data-formal-check-locations'));
  assert(html.indexOf('data-formal-check-locations')<html.indexOf('data-check-group'));
  assert.match(html,/确认事项：100项/);
  assert.match(html,/查阅所选问题原文/);
  assert.match(html,/合成核对问题第99项/);
  assert.match(html,/请核对合成依据第99项/);
  assert.match(html,/href="\/app\/process-preview\?case=synthetic-case"/);
  const groupTags=html.match(/<details[^>]*data-check-group[^>]*>/g);
  assert.equal(groupTags.length,3);
  assert(groupTags.every(tag=>! /\bopen(?:\s|=|>)/.test(tag)));
  assert.equal((html.match(/查看本项处理建议/g)||[]).length,100);
  assert.doesNotMatch(html,/<form|type="submit"|private-form|private-item/);
  assert.deepEqual(raw,before);
});

test('other check views retain the original expanded groups and source-location links',()=>{
  const checks={status:'ready',counts:{incomplete:1},issues:[{...issue(1),group:'incomplete',behavior_ref:'saved-behavior'}]};
  const html=render(ProcessChecks,{checks});
  assert.match(html,/<details open="" data-check-group="incomplete">/);
  assert.match(html,/href="#source-saved-behavior"/);
  assert.match(html,/处理建议：/);
  assert.doesNotMatch(html,/查看本项处理建议|data-formal-check-locations/);
});

test('zero issues do not advertise a nonexistent source selection or editing control',()=>{
  const html=render(FormalCurrentChecks,{checks:{status:'ready',counts:{technical:0,incomplete:0,confirmation:0},issues:[]},document:source(),caseId:'synthetic-case',authoringEnabled:true});
  assert.doesNotMatch(html,/需要查阅的问题|查阅所选问题原文|完整问题按下方|<form/);
  assert.match(html,/编制缺项：0项/);
});

test('known native form choices render their business meaning instead of status placeholders or enum codes',()=>{
  const usage=[['authoritative_input','在本流程录入，并以此处的值为准'],['reuse_existing','沿用已有值'],['calculated','通过计算取得'],['external_source','从外部来源取得']];
  const origin=[['direct_current_process','在当前流程中直接填写或形成'],['depends_on_data','从已有数据中取得']];
  for(const [value,text] of usage)assert.equal(formalFieldChoice('value_usage_mode',value),text);
  for(const [value,text] of origin)assert.equal(formalFieldChoice('value_origin_mode',value),text);
  const document={...source(),schema_version:'process-governance-v9'};
  const item=document.forms[0].areas[0].items[0];
  item.value_usage_mode='reuse_existing';item.value_origin_mode='depends_on_data';
  item.source_links=[{source_type:'process_data',source_data_ref:'private-source',source_role:'provides_value',source_data_name:'已保存的申请记录'}];
  const before=structuredClone(document),projected=formalSourcePresentation(document);
  const html=render(BusinessDetails,{value:projected});
  assert.match(html,/填写值如何使用/);assert.match(html,/沿用已有值/);
  assert.match(html,/填写值从哪里取得/);assert.match(html,/从已有数据中取得/);
  assert.match(html,/流程中的业务数据/);assert.match(html,/提供填写值/);assert.match(html,/已保存的申请记录/);
  assert.doesNotMatch(html,/状态待核对|reuse_existing|depends_on_data|provides_value|process_data|private-source/);
  assert.deepEqual(document,before);
});

test('missing, explicitly pending and unknown choices remain distinct without guessing a source',()=>{
  const missing=formalFieldChoice('value_origin_mode',undefined),pending=formalFieldChoice('value_origin_mode','pending_confirmation'),unknown=formalFieldChoice('value_origin_mode','UNRECOGNIZED_PRIVATE_MODE');
  assert.match(missing,/原文未填写取值来源/);assert.match(pending,/取值来源尚待业务确认/);assert.match(unknown,/取值来源暂无法识别/);
  assert.equal(new Set([missing,pending,unknown]).size,3);
  assert.doesNotMatch([missing,pending,unknown].join(''),/UNRECOGNIZED|pending_confirmation|状态待核对/);
  for(const input of [0,false,{},[]])assert.match(formalFieldChoice('value_usage_mode',input),/使用方式暂无法识别/);
  assert.equal(formalFieldChoice('unrelated_field','reuse_existing'),null);
  for(const field of ['source_type','source_role']){
    assert.match(formalFieldChoice(field,'pending_confirmation'),/暂无法识别/);
    assert.doesNotMatch(formalFieldChoice(field,'pending_confirmation'),/尚待业务确认|pending_confirmation/);
  }
});

test('field-source vocabulary never changes lifecycle provenance or unrelated source records',()=>{
  const provenanceKinds=['user_confirmed','structured_relation','behavior_description','weak_keyword','migration'];
  for(const version of [7,8,9]){
    const document={...source(),schema_version:`process-governance-v${version}`,data_objects:[{data_name:'合成记录',lifecycle:{events:provenanceKinds.map(source_type=>({provenance:{source_type,basis:'部门已核实'}}))}}]};
    const original=structuredClone(document),projected=formalSourcePresentation(document);
    assert.deepEqual(projected.data_objects,original.data_objects);
    const html=render(BusinessDetails,{value:projected});
    assert.doesNotMatch(html,/原记录的来源类别暂无法识别/);
    assert.match(html,/部门已核实/);
    assert.deepEqual(document,original);
  }
  const unrelated={item_ref:'only-a-reference',source_type:'process_data',source_role:'provides_value',source_links:[{source_type:'user_confirmed'}]};
  assert.deepEqual(formalSourcePresentation(unrelated),unrelated);
});

test('read-only lookup preserves saved references and missing optional choices in V7 V8 and V9 documents',()=>{
  for(const version of [7,8,9]){
    const document={...source(),schema_version:`process-governance-v${version}`};
    const item=document.forms[0].areas[0].items[0];delete item.value_usage_mode;delete item.value_origin_mode;
    const before=structuredClone(document),location=formalIssueLocation(issue(1),document);
    assert.equal(location.value,item);
    const html=render(BusinessDetails,{value:formalSourcePresentation(location.value)});
    assert.match(html,/原文未填写使用方式/);assert.match(html,/原文未填写取值来源/);
    assert.doesNotMatch(html,/状态待核对|pending_confirmation|private-item|private-form/);
    assert.deepEqual(document,before);
  }
});
