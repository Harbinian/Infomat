import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {explicitOfficeTarget,initialOfficeSelection,officeTargetAvailable,officeTargetChoices,officeWorkbenchSelection} from '../src/officeSelectionModel.js';

const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(frontend,'package.json'));
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};
  if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};
  return next(url,context);
}});
const {OfficeSelectionPanel}=await import('../src/OfficeWorkbench.jsx');
const first='9007199254740993', second='9007199254740995';
const data=()=>({
  offices:[
    {id:first,name:'合成第一办公室',department_id:'81',department_name:'合成甲部',status:'active',manager_name:null},
    {id:second,name:'合成第二办公室',department_id:'82',department_name:'合成乙部',status:'active',manager_name:'合成已登记负责人'},
    {id:'4',name:'合成停用办公室',department_id:'82',department_name:'合成乙部',status:'inactive'}
  ],
  selected_office_id:first,members:[{person_name:'第一办公室成员'}],
  tasks:[{id:'1',office_id:first,content:'第一办公室任务'}],
  versions:[],unallocated:[{id:'2',to_dept_id:'82'}],can_route:true,can_assign:true,can_complete:true
});
const render=(input,props={})=>renderToStaticMarkup(React.createElement(OfficeSelectionPanel,{data:input,officeId:'',loading:false,saving:false,checked:false,onChoose(){},onCheck(){},onStart(){},onReadChoices(){},...props}));

test('no explicit selection keeps the choice list but does not adopt API first-office tasks, members or assignment authority',()=>{
  const original=data(),before=structuredClone(original),shown=officeWorkbenchSelection(original,'');
  assert.equal(initialOfficeSelection(null,''),'');
  assert.equal(shown.selected_office_id,null);
  assert.equal(shown.office_selection_ready,false);
  assert.deepEqual(shown.tasks,[]);
  assert.deepEqual(shown.members,[]);
  assert.equal(shown.can_assign,false);
  assert.deepEqual(shown.offices,original.offices);
  assert.deepEqual(shown.unallocated,original.unallocated);
  assert.equal(shown.can_route,true);
  assert.deepEqual(original,before);
});

test('an exact large-integer deep link retains its office scope without rounding or selecting a neighbouring office',()=>{
  const original=data();original.selected_office_id=second;
  original.tasks=[{id:'8',office_id:second,content:'第二办公室任务'}];
  const choice=initialOfficeSelection(null,'?office_id='+second);
  const shown=officeWorkbenchSelection(original,choice);
  assert.equal(choice,second);
  assert.equal(shown.selected_office_id,second);
  assert.equal(shown.office_selection_ready,true);
  assert.deepEqual(shown.tasks,original.tasks);
  assert.notEqual(shown.selected_office_id,first);
});

test('a stale or mismatched requested scope never accepts a returned fallback office',()=>{
  const original=data(),before=structuredClone(original);
  for(const id of [second,'removed-office']){
    const shown=officeWorkbenchSelection(original,id);
    assert.equal(shown.office_selection_ready,false);
    assert.equal(shown.selected_office_id,null);
    assert.deepEqual(shown.tasks,[]);
    assert.deepEqual(shown.members,[]);
    assert.equal(shown.can_assign,false);
  }
  assert.deepEqual(original,before);
});

test('an in-memory old draft preserves its original context and target even when the URL or directory changes',()=>{
  const draft={officeId:first,office_id:second,content:'旧交办内容',note:'原办理结果',request_id:'retained-request',dirty:true};
  const before=structuredClone(draft);
  assert.equal(initialOfficeSelection(draft,'?office_id=other'),first);
  assert.equal(initialOfficeSelection({...draft,officeId:''},'?office_id='+second),'');
  assert.equal(officeTargetAvailable({...data(),offices:[]},draft.office_id),false);
  assert.deepEqual(draft,before);
});

test('a new create or legacy-receive target is never inferred from list order or an unrelated department',()=>{
  const original=data(),before=structuredClone(original),oldTodo={id:'2',to_dept_id:'82'};
  assert.equal(explicitOfficeTarget(original,''),'');
  assert.equal(explicitOfficeTarget(original,'missing'),'');
  assert.equal(explicitOfficeTarget(original,first,oldTodo),'');
  assert.equal(explicitOfficeTarget(original,second,oldTodo),second);
  assert.equal(explicitOfficeTarget(original,'4',oldTodo),'');
  assert.deepEqual(officeTargetChoices(original,oldTodo).map(office=>office.id),[second]);
  assert.equal(officeTargetAvailable(original,first),true);
  assert.deepEqual(original,before);
});

test('initial rendered choice is an actual empty option and new routing stays disabled until an explicit office is checked',()=>{
  const shown=officeWorkbenchSelection(data(),'');
  const html=render(shown);
  assert.match(html,/<option value="" selected="">请选择办公室<\/option>/);
  assert.match(html,/<button class="primary" disabled="">交办到办公室<\/button>/);
  assert.match(html,/系统不会按办公室列表顺序替您选择/);
  assert.doesNotMatch(html,/归口部门：.*办公室负责人：/);
});

test('a missing manager is disclosed and must be checked, but does not invent a new prohibition on routing',()=>{
  const shown=officeWorkbenchSelection(data(),first);
  const unchecked=render(shown,{officeId:first});
  assert.match(unchecked,/办公室负责人：尚未指定/);
  assert.match(unchecked,/向行政人事信息维护员核对负责人安排/);
  assert.match(unchecked,/<input type="checkbox"/);
  assert.match(unchecked,/<button class="primary" disabled="">交办到办公室<\/button>/);
  const checked=render(shown,{officeId:first,checked:true});
  assert.match(checked,/<button class="primary">交办到办公室<\/button>/);
  assert.match(checked,/保存后在所选办公室的任务列表查看/);
  assert.doesNotMatch(checked,/负责人未登记.*不能交办/);
});

test('an existing exact office link shows the saved manager and never exposes the internal office identifier as visible copy',()=>{
  const original=data();original.selected_office_id=second;
  const html=render(officeWorkbenchSelection(original,second),{officeId:second,checked:true});
  assert.match(html,new RegExp('<option value="'+second+'" selected="">合成乙部 / 合成第二办公室<\\/option>'));
  assert.match(html,/办公室负责人：合成已登记负责人/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,''),new RegExp(first+'|'+second));
});

test('a retired choice stays visible as a neutral retained option instead of switching to the first office',()=>{
  const html=render(officeWorkbenchSelection(data(),''),{officeId:'retired-private-id',checked:true});
  assert.match(html,/<option value="retired-private-id" selected="">原办公室当前不可查看，请重新选择<\/option>/);
  assert.match(html,/原选择仍保留/);
  assert.match(html,/<button class="primary" disabled="">交办到办公室<\/button>/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,''),/retired-private-id/);
});

test('a read-only actor can choose a readable office without receiving a routing or acknowledgement control',()=>{
  const original=data();original.can_route=false;
  const html=render(officeWorkbenchSelection(original,first),{officeId:first});
  assert.match(html,/合成第一办公室/);
  assert.doesNotMatch(html,/type="checkbox"|>交办到办公室<|保存后在所选办公室/);
});

test('an inaccessible deep link offers an explicit choice-list read while retaining the original neutral selection',()=>{
  const calls=[],tree=OfficeSelectionPanel({data:null,officeId:'retired-private-id',loading:false,saving:false,checked:false,onChoose(){},onCheck(){},onStart(){},onReadChoices(){calls.push('read-options');}});
  const find=node=>!React.isValidElement(node)?[]:[node,...React.Children.toArray(node.props.children).flatMap(find)];
  const button=find(tree).find(node=>node.type==='button'&&node.props.children==='读取可选办公室');
  assert(button);button.props.onClick();assert.deepEqual(calls,['read-options']);
  const html=render(null,{officeId:'retired-private-id'});
  assert.match(html,/读取可选办公室/);
  assert.doesNotMatch(html.replace(/<[^>]+>/g,''),/retired-private-id/);
});

