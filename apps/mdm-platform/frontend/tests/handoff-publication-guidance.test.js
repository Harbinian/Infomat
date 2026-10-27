import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire,registerHooks} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
const frontend=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(path.join(frontend,'package.json'));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const {transformSync}=await import(pathToFileURL(path.join(frontend,'node_modules/rolldown/dist/utils-index.mjs')));
registerHooks({load(url,context,next){if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.css'))return {format:'module',source:'export default {};',shortCircuit:true};if(url.startsWith(pathToFileURL(frontend).href)&&url.endsWith('.jsx'))return {format:'module',source:transformSync(path.basename(fileURLToPath(url)),fs.readFileSync(fileURLToPath(url),'utf8'),{}).code,shortCircuit:true};return next(url,context);}});
const {default:Panel}=await import('../src/HandoffPublicationPanel.jsx');
const hidden='686cdad4-9850-44eb-91a5-99ed7ce414ea';
const render=props=>renderToStaticMarkup(React.createElement(Panel,{api(){},selection:{kind:'publication'},select(){},begin(){},edit(){},execute(){},trace:{revisions:[]},capabilities:{},...props}));
const visible=html=>html.replace(/<[^>]+>/g,'');
function publication(){return {publication_id:'pub',package_id:'508',state:'withdrawn',event_revision:2,allowed_actions:['prepare_restoration'],events:[],manifest:{scope_mode:'current',items:[{item_ref:hidden,target_kind:'object',payload:{definition:{name:'合成采购记录'}},produces_version:true}]}};}
test('restoration mappings identify the actual original business item without exposing its internal relation',()=>{
 const resource=publication(),draft={kind:'publication_restore',values:{publicationId:'pub',expectedRevision:2,targetPackageId:'508',targetBindingId:'binding',targetTrace:{package_id:'508',source:{process_name:'合成采购流程',edition:'B'},work_package:{status:'completed'},bindings:[],drafts:[]},candidateTargetPackageId:'508',candidateBindingId:'binding',restorationDraft:{scope_mode:'current',items:[],dispositions:[],impact_dispositions:[]},itemMappings:[{source_item_ref:hidden,target_item_ref:hidden,content_decision:'adopt',basis:'合成采用依据',evidence_refs:'合成材料第一节'}]}};
 const before=structuredClone({resource,draft}),html=render({resource,draft});
 for(const field of ['采用方式','采用依据','采用证据'])assert.match(visible(html),new RegExp(field+'：合成采购记录'));assert.match(html,/aria-label="恢复草案位置"/);assert.match(html,/aria-label="采用方式：合成采购记录"/);
 assert.doesNotMatch(visible(html),new RegExp(hidden));assert.match(visible(html),/恢复目标：合成采购流程/);assert.match(visible(html),/确认本次办理结果/);assert.match(visible(html),/结束本次办理并查看对应草案/);assert.deepEqual({resource,draft},before);
});
test('withdrawal history guards technical reasons and never labels unknown scope as historical',()=>{
 const resource=publication();resource.manifest.scope_mode='unknown_legacy_scope';resource.state='unknown_legacy_state';resource.events=[{event_no:1,event_type:'withdrawn',created_at:'2026-10-23T00:00:00Z',payload:{reason:'/api/private/'+hidden,withdrawal_report:{scope_mode:'unknown_legacy_scope',reason:'/api/private/'+hidden,produced_items:[],reused_items:[],impact_manifest:[],heads:[]}}}];const before=structuredClone(resource),text=visible(render({resource}));assert.match(text,/发布状态待核对/);assert.match(text,/适用范围尚未明确/);assert.match(text,/撤回原因含技术内容/);assert.doesNotMatch(text,/\/api\/|unknown_legacy|历史范围/);assert.deepEqual(resource,before);
});
test('stale restoration identifies restoration rather than directing the user to withdraw again',()=>{
 const resource=publication(),draft={kind:'publication_restore',values:{publicationId:'pub',expectedRevision:1,targetPackageId:'',itemMappings:[]}};const text=visible(render({resource,draft}));assert.match(text,/本次恢复暂不能继续/);assert.doesNotMatch(text,/当前无法继续撤回/);assert.match(text,/查看最新记录/);
});
