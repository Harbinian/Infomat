import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
}});
const {default:ConflictPanel,HandoffFactPanel}=await import('../src/HandoffConflictPanel.jsx');
const {default:FactTypeInput}=await import('../src/HandoffFactTypeInput.jsx');
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const visible=html=>html.replace(/<[^>]*>/g,' ');
const noop=()=>{};
const sourceRef='source_detail_internal';
const subject={item_ref:'field:internal',target_kind:'field',definition:{name:'合成申请号'},source_detail_refs:[sourceRef]};
const resource={conflict_id:'conflict-internal',handoff_id:'handoff-internal',current_handoff_revision:12,content_digest:'content-internal',history_complete:true,state:'open',subject_items:[subject],allowed_actions:[],conflict:{kind:'definition',severity:'ordinary',difference:'合成差异',impact:'合成影响',proposals:[],affected_department_ids:['9007199254740993'],facts:[],viewpoints:[],round_id:'round-internal'}};
const trace={bindings:[{binding_id:'binding-internal',snapshot_json:{detail_versions:[{detail_version_id:'version-internal',detail_ref:sourceRef,detail_type:'critical_field'}]}}],revisions:[{handoff_id:'handoff-internal',revision_no:12,content_digest:'content-internal',binding_id:'binding-internal'}],detail_sources:[{detail_version_id:'version-internal',source:{data_name:'合成申请记录',field_name:'合成申请号'}}]};
const draft=kind=>({kind,expected_revision:7,expected_handoff_revision:12,values:{basis:'合成办理依据',evidence:' 合成材料第一节\n合成材料第二节 ',detail_ref:sourceRef,target_department_id:'9007199254740993',fact_type:'unknown_legacy_code',question:'请核对合成申请号',reason:'本次合成检查',decision_person_id:'9007199254740995',assignee_person_id:'9007199254740997',viewpoint:'合成观点',resolution:'合成处理结果',not_applicable:false}});
const props={resource,trace,options:{departments:[{id:'9007199254740993',name:'合成目标部'}]},begin:noop,edit:noop,execute:noop,select:noop,busy:false};

function find(node,predicate){
  if(!node||typeof node!=='object')return null;
  if(predicate(node))return node;
  for(const child of React.Children.toArray(node.props?.children)){const match=find(child,predicate);if(match)return match;}
  return null;
}
function request(Component,values){
  let result;const tree=Component({...values,execute:write=>{assert.equal(result,undefined);result=write;}});
  const form=find(tree,node=>node.type==='form');assert.ok(form,'active action has its original form');
  form.props.onSubmit({preventDefault(){}});return result;
}

test('source, department and unknown fact type labels are readable while their exact controlled values survive rendering',()=>{
  const active=draft('conflict_open_fact'),before=structuredClone({resource,trace,active});
  const html=render(ConflictPanel,{...props,draft:active}),text=visible(html);
  assert.match(text,/合成申请号 · 合成申请记录 \/ 合成申请号/);assert.match(text,/合成目标部/);
  assert.match(text,/原事实类型（原值保留）/);assert.match(text,/提出定向事实核对问题/);
  assert.doesNotMatch(text,/source_detail_internal|9007199254740993|unknown_legacy_code|binding-internal|content-internal/);
  assert.match(html,/value="source_detail_internal" selected/);assert.match(html,/value="unknown_legacy_code" selected/);
  assert.deepEqual({resource,trace,active},before);
});

test('empty and colliding legacy fact types stay selected without silently choosing a known or custom value',()=>{
  const empty=render(FactTypeInput,{value:'',onChange:noop});assert.match(empty,/value="" selected/);assert.doesNotMatch(empty,/<input/);
  const legacy='__custom_business_fact_type__',html=render(FactTypeInput,{value:legacy,onChange:noop});
  assert.match(html,/value="__custom_business_fact_type__" selected/);
  assert.match(html,/value="__custom_business_fact_type_2__"/);assert.doesNotMatch(html,/<input/);
  assert.doesNotMatch(visible(html),/__custom_business_fact_type__/);
  const custom=render(FactTypeInput,{value:'合成办理条件',onChange:noop});
  assert.match(custom,/<input[^>]*aria-label="其他事实类型说明"[^>]*value="合成办理条件"/);
});

test('missing decider candidates retain the old selection without asking for an internal person identifier',()=>{
  const html=render(ConflictPanel,{...props,draft:draft('conflict_escalate'),options:{...props.options,deciders:[]}}),text=visible(html);
  assert.match(text,/原选择的人选当前未提供，原值保留/);assert.match(text,/有权维护人员核对项目决策组成员及授权/);
  assert.doesNotMatch(html,/<input[^>]*aria-label="项目决策人员标识"/);assert.doesNotMatch(text,/9007199254740995/);
  assert.match(html,/value="9007199254740995" selected/);
});

test('history uses only captured names and labels current directory names separately from old evidence',()=>{
  const historical={...resource,conflict:{...resource.conflict,assignee_person_id:'11',viewpoints:[{viewpoint_id:'view-internal',viewpoint:'合成观点',basis:'合成依据',evidence_refs:['/api/synthetic'],actor:{person_id:'11',role_code:'data_conflict_handler'}}],facts:[{fact_id:'fact-internal',target_department_id:'9007199254740993',question_text:'合成事实问题',status:'open',round_id:'round-internal'}]},events:[{event_id:'event-internal',created_at:'2026-10-22T02:00:00Z',actor_json:{person_id:'11',role_code:'data_conflict_handler'},payload_json:{action:'viewpoint',snapshot:{basis:'/api/synthetic'}}}]};
  const html=render(ConflictPanel,{...props,resource:historical,options:{...props.options,handlers:[{person_id:'11',person_name:'当前改名合成人员'}]}}),text=visible(html);
  assert.match(text,/当前目录：当前改名合成人员/);assert.match(text,/当时办理人：原记录未留存姓名/);
  assert.match(text,/目标部门：合成目标部/);assert.doesNotMatch(text,/目标部门：合成事实问题/);
  assert.match(text,/2026-10-22 10:00:00（北京时间）/);assert.doesNotMatch(text,/\/api\/|event-internal|fact-internal|2026-10-22T/);
  const captured=render(ConflictPanel,{...props,resource:{...historical,events:[{...historical.events[0],payload_json:{action:'viewpoint',actor_snapshot:{person_name:'当时合成人员'}}}]}});
  assert.match(visible(captured),/当时办理人：当时合成人员/);
});

test('new conflict item and department labels conceal technical values without changing checkbox references',()=>{
  const opened={...draft('conflict_open'),values:{...draft('conflict_open').values,kind:'definition',severity:'ordinary',subject_refs:['field:internal'],affected_department_ids:['9007199254740993'],difference:'合成差异',proposals:'合成方案',impact:'合成影响'}};
  const bad={header:{handoff_id:'draft-internal',state:'draft'},revision:{snapshot_json:{items:[{...subject,definition:{name:'/api/private'}}]}}};
  const html=render(ConflictPanel,{...props,resource:bad,draft:opened,options:{departments:[{id:'9007199254740993',name:'/api/departments'}]}});
  assert.match(visible(html),/条目名称未记录/);assert.match(visible(html),/部门名称未记录/);assert.doesNotMatch(visible(html),/\/api\/|9007199254740993|field:internal/);
});

test('opening a directed fact keeps its old open-string type, exact references and concurrency body unchanged',()=>{
  const active=draft('conflict_open_fact'),before=structuredClone(active);
  assert.deepEqual(request(ConflictPanel,{...props,draft:active}),{url:'/api/data-map-handoffs/conflicts/conflict-internal/facts',method:'POST',body:{expected_revision:0,expected_handoff_revision:12,evidence_refs:['合成材料第一节','合成材料第二节'],expected_conflict_revision:7,detail_ref:sourceRef,target_department_id:'9007199254740993',requested_fact_type:'unknown_legacy_code',question_text:'请核对合成申请号',request_reason:'本次合成检查'}});
  assert.deepEqual(active,before);
});

test('existing conflict actions preserve original payload keys and exact decision or assignee identities',()=>{
  const cases=[['viewpoint',{viewpoint:'合成观点'}],['assign',{assignee_person_id:'9007199254740997'}],['escalate',{decision_person_id:'9007199254740995',severity:'major'}],['resolve',{resolution:'合成处理结果'}],['decide',{resolution:'合成处理结果'}],['reopen',{}],['verify',{}]];
  for(const [action,extra] of cases){const active=draft('conflict_'+action),before=structuredClone(active);
    assert.deepEqual(request(ConflictPanel,{...props,draft:active}),{url:'/api/data-map-handoffs/conflicts/conflict-internal/actions',method:'POST',body:{expected_revision:7,expected_handoff_revision:12,basis:'合成办理依据',evidence_refs:['合成材料第一节','合成材料第二节'],action,...extra}},action);
    assert.deepEqual(active,before);
  }
  const version=draft('conflict_verify');version.values.not_applicable=true;
  assert.deepEqual(request(ConflictPanel,{...props,draft:version}).body.fact_recheck,{not_applicable:true,basis:'合成办理依据',evidence_refs:['合成材料第一节','合成材料第二节']});
});

test('new conflict registration retains selected subject references, departments and original proposal splitting',()=>{
  const active=draft('conflict_open');Object.assign(active.values,{kind:'definition',severity:'ordinary',subject_refs:['field:internal'],affected_department_ids:['9007199254740993'],difference:'合成差异',proposals:'方案甲\n方案乙',impact:'合成影响'});
  assert.deepEqual(request(ConflictPanel,{...props,resource:{header:{handoff_id:'draft-internal'}},draft:active}),{url:'/api/data-map-handoffs/draft-internal/conflicts',method:'POST',body:{expected_revision:0,expected_handoff_revision:12,basis:'合成办理依据',evidence_refs:['合成材料第一节','合成材料第二节'],kind:'definition',severity:'ordinary',subject_refs:['field:internal'],affected_department_ids:['9007199254740993'],difference:'合成差异',proposals:['方案甲','方案乙'],impact:'合成影响'}});
});

test('fact answer, exact answer confirmation and closure preserve each parent concurrency contract',()=>{
  for(const parent_kind of ['handoff_conflict','legacy_intake'])for(const action of ['answer','confirm','close']){
    const fact={fact_id:'fact-internal',parent_kind,question_text:'合成问题',status:'answered',requested_fact_type:'business_meaning'};
    const active={kind:'fact_'+action,expected_revision:2,expected_conflict_revision:5,expected_handoff_revision:12,expected_parent_revision:3,answered_fact_version_id:'answer-version-exact',answered_snapshot_digest:'answer-digest-exact',values:{answer:'合成答复',basis:'合成办理依据',evidence:'合成依据第一节\n合成依据第二节'}};
    const before=structuredClone({fact,active});
    const body={expected_revision:2,evidence_refs:['合成依据第一节','合成依据第二节'],...(parent_kind==='handoff_conflict'?{expected_conflict_revision:5,expected_handoff_revision:12}:{expected_parent_revision:3}),...(action==='answer'?{answer_text:'合成答复'}:{basis:'合成办理依据'}),...(action==='confirm'?{answered_fact_version_id:'answer-version-exact',answered_snapshot_digest:'answer-digest-exact'}:{})};
    assert.deepEqual(request(HandoffFactPanel,{resource:fact,draft:active}),{url:'/api/data-map-handoffs/facts/fact-internal/'+{answer:'answers',confirm:'confirmations',close:'closures'}[action],method:'POST',body});
    assert.deepEqual({fact,active},before);
  }
});

test('readonly fact content uses safe business text and honors existing allowed actions without adding writes',()=>{
  const fact={fact_id:'fact-internal',parent_kind:'handoff_conflict',status:'answered',target_department_id:'9007199254740993',question_text:'合成问题',request_reason:'/api/synthetic',answer_text:'POST /api/synthetic',confirmation_basis:'SELECT value FROM private_table',close_basis:'request_id',requested_fact_type:'unknown_legacy_code',allowed_actions:[]};
  const html=render(HandoffFactPanel,{resource:fact,options:props.options,trace,execute:()=>assert.fail('render must not write')}),text=visible(html);
  assert.doesNotMatch(text,/\/api\/|request_id|unknown_legacy_code|9007199254740993|SELECT/);assert.doesNotMatch(html,/<button|<form/);
  assert.match(text,/目标部门：合成目标部/);assert.match(text,/来源名称未记录/);
});

test('optional fact source names render safely without borrowing a name for an explicit gap or causing any reads',()=>{
  const base={fact_id:'fact-internal',parent_kind:'legacy_intake',question_text:'合成定向问题',status:'open',binding_id:'binding-internal',detail_ref:sourceRef,allowed_actions:[]};
  const oldText=visible(render(HandoffFactPanel,{resource:base,trace}));assert.match(oldText,/合成申请记录 \/ 合成申请号/);
  for(const detail_name of [null,'','   ',{name:'不是来源名称字段'},'/api/private-source','450b553c-541c-4727-906c-6ce9b234ed0b']){
    const fact={...base,detail_name,detail_name_source:'INTERNAL_UNKNOWN_ORIGIN'},before=structuredClone({fact,trace});
    const html=render(HandoffFactPanel,{resource:fact,trace,api:()=>assert.fail('name rendering must not read a package'),execute:()=>assert.fail('name rendering must not write')}),text=visible(html);
    assert.match(text,/来源名称未记录/);assert.doesNotMatch(text,/合成申请记录|不是来源名称字段|\/api\/|450b553c|INTERNAL_UNKNOWN_ORIGIN|\[object Object\]/);
    assert.doesNotMatch(html,/<button|<form/);assert.deepEqual({fact,trace},before);
  }
});

test('actual fact rendering distinguishes fixed source, original review and this intake or correction without claiming a current name',()=>{
  for(const [detail_name_source,parent_kind,caption] of [['fixed_source','handoff_conflict','固定流程版本中留存的名称'],['review_snapshot','handoff_conflict','原审核记录中留存的名称'],['parent_snapshot','intake','本问题提出时的接入核验记录中留存的名称'],['parent_snapshot','correction','本问题提出时的更正记录中留存的名称']]){
    const fact={fact_id:'fact-internal',parent_kind,detail_name:'准确记录中的合成对象名',detail_name_source,question_text:'合成事实问题',status:'open',allowed_actions:[]},before=structuredClone(fact);
    const html=render(HandoffFactPanel,{resource:fact,api:()=>assert.fail('source labels must not request a trace'),execute:()=>assert.fail('render must not write')}),text=visible(html);
    assert.match(text,/事实来源：准确记录中的合成对象名/);assert(text.includes('名称出处：'+caption));assert.match(text,/此处按所标注的记录显示，不能据此认定为现行名称/);
    assert(!text.includes(detail_name_source));assert.doesNotMatch(text,/fact-internal|<form|<button/);assert.deepEqual(fact,before);
  }
  const oldText=visible(render(HandoffFactPanel,{resource:{fact_id:'old-fact',parent_kind:'intake',question_text:'旧问题',status:'open',allowed_actions:[]}}));
  assert.match(oldText,/来源名称未记录/);assert.match(oldText,/名称出处未注明/);assert.doesNotMatch(oldText,/本问题提出时的接入核验记录中留存的名称/);
});

test('fact source display fields never become submitted answer fields or replace the original fact response',()=>{
  const fact={fact_id:'fact-internal',parent_kind:'legacy_intake',detail_name:'接入时记录的合成对象',detail_name_source:'INTERNAL_UNKNOWN_ORIGIN',question_text:'合成问题',status:'open'},active={kind:'fact_answer',expected_revision:2,expected_parent_revision:3,values:{answer:'合成答复',evidence:'合成材料第1页'}},before=structuredClone({fact,active});
  assert.deepEqual(request(HandoffFactPanel,{resource:fact,draft:active}),{url:'/api/data-map-handoffs/facts/fact-internal/answers',method:'POST',body:{expected_revision:2,expected_parent_revision:3,evidence_refs:['合成材料第1页'],answer_text:'合成答复'}});
  assert.deepEqual({fact,active},before);
});

test('unknown legacy enum names cannot become raw labels or inherited object properties',()=>{
  const old={...resource,conflict:{...resource.conflict,kind:'constructor'},subject_items:[{...subject,target_kind:'constructor'}],events:[{event_id:'old-event',created_at:null,payload_json:{action:'constructor'}}]};
  const text=visible(render(ConflictPanel,{...props,resource:old}));
  assert.match(text,/旧冲突/);assert.match(text,/业务条目/);assert.match(text,/历史办理记录/);
  assert.doesNotMatch(text,/constructor|function Object/);
});
