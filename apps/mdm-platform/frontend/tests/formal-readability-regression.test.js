import {test} from 'node:test';
import assert from 'node:assert/strict';
import {formalPrerequisites,formalReadOnlyChecks,formalIssueLocation,formalIssueLabel} from '../src/formalReadability.js';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';

const source=()=>({process:{process_name:'合成申请流程'},forms:[{form_ref:'hidden-form',form_name:'合成申请单',areas:[{area_title:'申请内容',items:[{item_ref:'hidden-item',item_name:'申请日期',instructions:'填写实际申请日期'}]},{area_title:'复核内容',items:[{item_name:'复核日期'}]}]}],behaviors:[{behavior_ref:'exact-behavior',behavior_name:'合成人员核对申请',input_description:'已保存的申请单'}]});
const issue=()=>({group:'confirmation',message:'合成申请单的字段1取值方式待确认',path:'/forms/0/areas/0/items/0/value_origin_mode',blocking:true,rule_code:'kept-rule',suggestions:['点击本项返回对应位置，补充并核对页面高亮的字段。','请核对原材料中的填写依据。']});

test('formal prerequisites reuse the exact same-revision issue path without changing stored checks',()=>{
  const document=source(),check=issue(),detail={revision:{document},content_checks:{status:'ready',counts:{confirmation:1},issues:[check]},handling_summary:{prerequisites:[check.message,'等待部门负责人确认。']}};
  const before=structuredClone(detail),values=formalPrerequisites(detail);
  assert.deepEqual(values,['《合成申请单》／申请内容：申请日期取值方式待确认','等待部门负责人确认。']);
  assert.deepEqual(detail,before);
});

test('ambiguous legacy messages retain all exact path matches and never guess a same-number item',()=>{
  const document=source(),first=issue(),second={...issue(),path:'/forms/0/areas/1/items/0/value_origin_mode'};
  const value=formalPrerequisites({revision:{document},content_checks:{issues:[first,second]},handling_summary:{prerequisites:[first.message]}})[0];
  assert.match(value,/申请内容：申请日期/);assert.match(value,/复核内容：复核日期/);assert.doesNotMatch(value,/字段1/);
});

test('missing paths or a missing document explain the gap instead of leaking an ordinal',()=>{
  for(const document of [source(),null]){
    const detail={revision:{document},content_checks:{issues:[]},handling_summary:{prerequisites:['合成申请单的字段991取值方式待确认']}};
    const value=formalPrerequisites(detail)[0];assert.match(value,/无法准确定位/);assert.doesNotMatch(value,/字段991/);
  }
});

test('read-only checks replace only unexecutable navigation advice and keep business advice and gates',()=>{
  const checks={status:'ready',counts:{confirmation:1},issues:[issue()]},before=structuredClone(checks);
  const result=formalReadOnlyChecks(checks,source());
  assert.equal(result.status,'ready');assert.deepEqual(result.counts,checks.counts);assert.equal(result.issues[0].blocking,true);assert.equal(result.issues[0].rule_code,'kept-rule');
  assert.match(result.issues[0].message,/申请日期/);assert.doesNotMatch(result.issues[0].suggestions[0],/点击本项|高亮/);assert.match(result.issues[0].suggestions[0],/查阅所选问题原文/);
  assert.equal(result.issues[0].suggestions[1],checks.issues[0].suggestions[1]);assert.deepEqual(checks,before);
  assert.doesNotMatch(formalReadOnlyChecks(checks,null).issues[0].message,/字段1/);
});

test('read-only source locations use exact saved item, row or unique behavior references',()=>{
  const document=source(),before=structuredClone(document);
  const location=formalIssueLocation(issue(),document);assert.equal(location.value,document.forms[0].areas[0].items[0]);assert.match(location.label,/申请日期/);
  assert.equal(formalIssueLocation({...issue(),path:'/forms/9/areas/0/items/0'},document),null);
  assert.equal(formalIssueLocation({path:'/behaviors/0/behavior_name'},document).value,document.behaviors[0]);
  assert.equal(formalIssueLocation({path:'/forms/0/form_name'},document).label,'合成申请单');
  assert.equal(formalIssueLocation({behavior_ref:'exact-behavior'},document).value,document.behaviors[0]);
  assert.equal(formalIssueLocation({path:'/unknown/0',behavior_ref:'missing'},document),null);
  assert.equal(formalIssueLocation({path:'/process/purpose'},document).value,document.process);
  assert.deepEqual(document,before);
});

test('technical item names stay hidden and duplicate behavior references do not select an arbitrary row',()=>{
  const document=source();document.forms[0].areas[0].items[0].item_name='person_id';
  assert.doesNotMatch(formalIssueLocation(issue(),document).label,/person_id/);
  document.behaviors.push({...document.behaviors[0],behavior_name:'另一个同引用环节'});
  assert.equal(formalIssueLocation({behavior_ref:'exact-behavior'},document),null);
  assert.doesNotMatch(formalIssueLabel({message:'GET /api/internal-read'}),/\/api\//);
});

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};return next(url,context);}});
const {FormalCheckLocations}=await import('../src/ProcessFormal.jsx');
const {ProcessChecks}=await import('../src/ProcessChecks.jsx');

test('formal check UI exposes an explicit read-only location control and the real case return route',()=>{
  const document=source(),checks=formalReadOnlyChecks({status:'ready',counts:{confirmation:1},issues:[issue()]},document);
  const html=renderToStaticMarkup(React.createElement(FormalCheckLocations,{checks,document,caseId:'synthetic-case',authoringEnabled:true,onLeave(){}}));
  assert.match(html,/需要查阅的问题/);assert.match(html,/查阅所选问题原文/);assert.match(html,/type="button" disabled/);
  assert.match(html,/href="\/app\/process-preview\?case=synthetic-case"/);assert.doesNotMatch(html,/href="\/app\/process-authoring|<form|type="submit"|字段1|hidden-form|hidden-item/);
  assert.match(html,/编制人员修改/);assert.match(html,/主对接人核对材料并提交/);assert.match(html,/同一案例的“流程预览与核对”/);
  const checksHtml=renderToStaticMarkup(React.createElement(ProcessChecks,{checks,allowLocate:false,authoringEnabled:true}));
  assert.doesNotMatch(checksHtml,/点击本项返回对应位置|页面高亮/);assert.match(checksHtml,/请核对原材料中的填写依据/);
});
