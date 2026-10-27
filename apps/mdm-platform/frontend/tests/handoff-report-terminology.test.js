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
const {Report}=await import('../src/DataMapHandoffWorkspace.jsx');
const revisionId='7844e973-5bc0-4f22-a51e-f23f4b4a847c';
const url='/app/terms?target_type=handoff_revision&target_id='+revisionId;
const report={terminology_review_url:url,gates:[{gate:4,status:'blocked',issues:['TERMINOLOGY_REVIEW_REQUIRED:/items/field:internal/definition/name']}],ready_for_approval:false};
const render=props=>renderToStaticMarkup(React.createElement(Report,props));
const visible=html=>html.replace(/<[^>]*>/g,' ');
function find(node,predicate){
 if(!node||typeof node!=='object')return null;
 if(predicate(node))return node;
 for(const child of React.Children.toArray(node.props?.children)){const match=find(child,predicate);if(match)return match;}
 return null;
}

test('actual report renders the exact draft terminology entry and explains responsible person, recording and return steps',()=>{
 const before=structuredClone(report),html=render({report,revisionId}),text=visible(html);
 assert.match(text,/本草案尚未保存人工术语核对结果/);
 assert.match(text,/MDM工作组组长或本工作包已分派的MDM治理经办人/);
 assert.match(text,/核对本草案术语引用/);assert.match(text,/记录术语引用判断/);assert.match(text,/保存人工核对结果/);
 assert.match(text,/浏览器“返回”.*查看最新记录.*执行本次检查/);
 assert.match(text,/没有需要逐条引用的概念.*整体核对说明/);
 assert.doesNotMatch(text,/TERMINOLOGY_|handoff_revision|\/app\/terms|field:internal|\/items\/|7844e973/);
 assert.match(html,/href="\/app\/terms\?target_type=handoff_revision&amp;target_id=7844e973-5bc0-4f22-a51e-f23f4b4a847c"/);
 assert.deepEqual(report,before);
});

test('terminology entry uses the existing navigation callback so parent input protection remains in control',()=>{
 let called=0;const event={preventDefault(){}};
 const onNavigate=received=>{assert.equal(received,event);called++;};
 const tree=Report({report,revisionId,onNavigate}),anchor=find(tree,node=>node.type==='a');
 assert.equal(anchor.props.href,url);assert.equal(anchor.props.onClick,onNavigate);
 anchor.props.onClick(event);assert.equal(called,1);
});

test('external, disguised, duplicate, wrong-subject and mismatched-revision URLs never become actionable links',()=>{
 const other='aca788c8-381d-4a68-a7f4-556be6dc7ae1';
 const invalid=[
  'https://outside.invalid'+url,'//outside.invalid'+url,'javascript:alert(1)','data:text/html,test',
  '/app/terms-extra?target_type=handoff_revision&target_id='+revisionId,
  '/app/terms/../terms?target_type=handoff_revision&target_id='+revisionId,
  '/app/%74erms?target_type=handoff_revision&target_id='+revisionId,
  url+'#unsafe',url+'\n',url+'\\unsafe',url+'&next=https://outside.invalid',
  url+'&target_id='+other,url+'&target_type=handoff_revision',
  '/app/terms?target_type=work_package&target_id='+revisionId,
  '/app/terms?target_type=handoff_revision&target_id='+other,
  '/app/terms?target_type=handoff_revision',
  '/app/terms?target_type=handoff_revision&target_id=not-a-revision'
 ];
 for(const candidate of invalid){const html=render({report:{...report,terminology_review_url:candidate},revisionId});
  assert.doesNotMatch(html,/<a\b/,candidate);assert.match(visible(html),/未提供与本草案准确对应.*入口/);
  assert.doesNotMatch(visible(html),/outside\.invalid|not-a-revision|7844e973|javascript:/);
 }
 assert.doesNotMatch(render({report}),/<a\b/);
});

test('known terminology blockers receive separate readable causes while unknown internal codes and locations stay hidden',()=>{
 const issues=['TERMINOLOGY_SOURCE_CHANGED','TERMINOLOGY_TERM_CHANGED:/items/0','TERMINOLOGY_SUBSTANTIVE_CONFLICT:/definition/private_field','TERMINOLOGY_CANONICAL_NAME_REQUIRED:/definition/private_field','TERMINOLOGY_DEPARTMENT_CONFIRMATION_REQUIRED','TERMINOLOGY_DEPARTMENT_CONFIRMATION_STALE','TERMINOLOGY_FUTURE_UNKNOWN:/api/private'];
 const text=visible(render({revisionId,report:{...report,gates:[{gate:4,status:'blocked',issues}]}}));
 assert.match(text,/本草案内容已变化/);assert.match(text,/词条内容或可用状态已变化/);assert.match(text,/同一语境下的含义冲突/);
 assert.match(text,/回到草案编辑核对规范名称/);assert.match(text,/相应部门当前负责人本人确认/);assert.match(text,/原部门负责人确认已不能代表当前办理资格/);
 assert.match(text,/仍有需核对项/);assert.doesNotMatch(text,/TERMINOLOGY_|\/definition|private_field|\/api\/|\/items\//);
});

test('legacy reports without a terminology URL retain safe guidance and no report produces no output',()=>{
 const old={gates:report.gates,ready_for_approval:false};
 const html=render({report:old,revisionId});assert.doesNotMatch(html,/<a\b/);assert.match(visible(html),/查看最新记录/);
 const plain=render({report:{gates:[{gate:1,status:'blocked',issues:['来源材料需要重新核对']}],ready_for_approval:false},revisionId});
 assert.match(visible(plain),/来源材料需要重新核对/);assert.doesNotMatch(visible(plain),/本草案术语核对/);
 assert.equal(render({report:null,revisionId}),'');
});
