// Real 3000 components, synthetic HTTP and owned Edge only. Never uses a database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {pathToFileURL}=require('node:url'),express=require('express');
require('./testHelpers/ownedBrowserRuntime.js');
const artifacts=path.resolve(__dirname,'../../../artifacts');
function arg(key){const index=process.argv.indexOf(key);assert(index>=0&&process.argv[index+1],key+' is required');const value=path.resolve(process.argv[index+1]);assert(value.startsWith(artifacts+path.sep));return value;}
const build=arg('--build'),output=arg('--output');assert(fs.existsSync(path.join(build,'index.html')));assert(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
async function main(){
 const frontend=path.resolve(__dirname,'../frontend'),html=path.join(output,'index.html'),fixture=path.join(frontend,'tests/ui-copy-harness.jsx').replaceAll('\\','/');
 fs.writeFileSync(html,`<!DOCTYPE html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="${fixture}"></script></html>`);
 const {build:bundle}=await import(pathToFileURL(require.resolve('vite',{paths:[frontend]})).href);
 await bundle({configFile:false,root:output,base:'/harness/',envDir:false,envPrefix:[],publicDir:false,resolve:{alias:{react:path.join(frontend,'node_modules/react'),'react-dom':path.join(frontend,'node_modules/react-dom')}},build:{outDir:path.join(output,'bundle'),rolldownOptions:{input:html},minify:false},logLevel:'error'});
 const secret='12345678-abcd-4321-9876-123456789abc',hash='a'.repeat(64),objectId='9007199254740999',fieldId='9007199254740998';
 const field={entity_id:fieldId,version_id:'9007199254740898',name:'资产原值',status:'draft'};
 const definition={name:'资产卡片',business_meaning:'记录固定资产的实际业务事实',enum_values:[0,false,'未完成'],unique_identifiers:[]};
 const current={entity_type:'object',entity_id:objectId,version_id:'9007199254740899',revision_no:37,definition,content_digest:hash,base_snapshot:{row:{status:'draft'}}};
 const app=express(),writes=[];app.use(express.json());
 const model={modelVersion:'INTERNAL_MODEL_V99',roles:[{code:'SYNTHETIC_ADMIN',name:'合成管理员',description:'查阅角色及授权记录',visibleTabs:[]}],activities:[],permissions:[]};
 app.use('/api',(req,res,next)=>{res.set('Cache-Control','no-store');if(req.method!=='GET')writes.push({path:req.path,body:req.body});next();});
 app.get('/api/csrf-token',(_,res)=>res.json({csrfToken:'synthetic'}));
 app.get('/api/org/csrf-token',(_,res)=>res.json({csrfToken:'synthetic'}));
 app.get('/api/org/session',(_,res)=>res.json({authenticated:true}));
 app.get('/api/org/me',(_,res)=>res.json({identityKind:'person',personId:42,departmentId:91,name:'合成验证人员',departmentName:'财务部',roleCodes:['SYNTHETIC_ADMIN'],rbacRoles:[{code:'SYNTHETIC_ADMIN',name:'合成管理员'}],permissions:['identity:read','governance:read-global','governance:draft-department']}));
 app.get('/api/org/me/password-status',(_,res)=>res.json({is_default_password:false}));
 app.get('/api/org/departments',(_,res)=>res.json([{id:'91',name:'财务部'}]));
 app.get('/api/org/persons/assignable',(_,res)=>res.json([{personId:'42',name:'合成验证人员',dept_name:'财务部'}]));
 app.get('/api/process-authoring/status',(_,res)=>res.json({enabled:false}));
 app.get('/api/data-map/contexts',(_,res)=>res.json([]));
 app.get('/api/rbac/model',(_,res)=>res.json(model));
 app.get('/api/rbac/department-role-requirements',(_,res)=>res.json({departments:[],role_codes:[],source:{file_name:'合成角色资料.xlsx'},department_roles:[]}));
 app.get('/api/role-workbench',(_,res)=>res.json({workItems:[]}));
 app.get('/api/terminology-governance/capabilities',(_,res)=>res.json({enabled:true,ready:true,allowed_actions:[]}));
 const term={term_id:secret,term:'资产',context:'固定资产管理',definition:'供长期使用的资产',source_kind:'custom',usable:true,adoption_status:'adopted',versions:[],events:[],allowed_actions:[]};
 app.get('/api/terminology-governance/terms',(_,res)=>res.json({items:[term]}));
 app.get('/api/terminology-governance/terms/:id/challenges',(_,res)=>res.json({items:[]}));
 app.get('/api/terminology-governance/terms/:id',(_,res)=>res.json(term));
 app.get('/api/analysis/materials/excel/:id',(req,res)=>res.json(req.query.sheet?{cells:[{address:'A1',raw_type:'s',normalized_value:'资产卡片'}],next_offset:null}:{source:{original_name:'资产清单.xlsx',raw_sha256:hash},coverage:{cell_count:1,formula_count:0,not_covered:[]},links:[],sheets:[{name:'资产',state:'visible',cell_count:1}]}));
 app.get('/api/field-identities/field/:id/history',(req,res)=>res.json({field_id:req.params.id,items:[{id:secret,description:'维护字段来源信息',operated_at:'2026-10-21 10:00',operated_by_person_id:objectId,changes:[{field_name:'owner_person_id',old_value:JSON.stringify(objectId),new_value:JSON.stringify(fieldId)},{field_name:'maintain_dept_id',old_value:'91',new_value:'92'}]}]}));
 app.get('/api/field-identities/field/:id',(req,res)=>res.json({id:secret,field_id:req.params.id,authoritative_system_name:'资产系统',authoritative_system_code:'INTERNAL_SYSTEM',confirmed:true,status:'confirmed',owner_person_id:objectId}));
 app.get('/api/roles',(_,res)=>res.json([{role_id:objectId,role_code:'SYNTHETIC_ADMIN',role_name:'合成管理员',status:'active'}]));
 app.get('/api/roles/:id/permissions',(_,res)=>res.json({matrix:[{perm_code:'GOVERNANCE_PUBLISH',description:'发布已审核的流程内容',assigned:true,effect:'allow'}]}));
 app.get('/api/roles/:id',(_,res)=>res.json({role_id:objectId,role_code:'SYNTHETIC_ADMIN',role_name:'合成管理员',status:'active',permissions:[{perm_code:'GOVERNANCE_PUBLISH',description:'发布已审核的流程内容',effect:'allow',field_constraints:{person_id:secret,description:'仅限授权范围'}}],users:[{name:'合成人员',employee_no:'E00042',dept_name:'财务部',assignment_status:'active',scope_type:'department',scope_department_id:'91',scope_department_name:'财务部'}]}));
 app.get('/api/data-map-definitions/capabilities',(_,res)=>res.json({person_id:42,department_id:91,can_write:true,groups:['基本信息'],schema:{object:[{path:'name',label:'对象名称',group:'基本信息'},{path:'enum_values',label:'允许填写的值',group:'基本信息',type:'nullable_array'}],field:[]},source_labels:{}}));
 app.get('/api/data-map-definitions/objects',(_,res)=>res.json({items:[{entity_id:objectId,name:'资产卡片',status:'draft'}],next:null}));
 app.get('/api/data-map-definitions/detail/object/:id',(req,res)=>res.json({current,fields:req.query.view==='current'?[field]:[],next:null}));
 app.get('/api/data-map-definitions/detail/field/:id',(_,res)=>res.json({current:{...field,definition:{name:field.name}}}));
 app.get('/api/data-map-definitions/history/object/:id',(_,res)=>res.json({items:[{version_id:current.version_id,revision_no:37,actor_person_id:'42',created_at:'2026-10-21 10:00'}],next:null}));
 app.get('/api/data-map-definitions/version/:id',(_,res)=>res.json(current));
 app.post('/api/data-map-definitions/save',(_,res)=>res.json({entity_type:'object',entity_id:objectId,revision_no:38}));
 app.get('/api/terminology-governance/usages',(_,res)=>res.json({enabled:false}));
 app.get('/api/master-data-template/capabilities',(_,res)=>res.json({personId:42}));
 app.get('/api/master-data-template/definition/object/:id',(_,res)=>res.json(current));
 app.get('/api/synthetic/detail',(_,res)=>res.json({id:secret,content_hash:hash,definition:{name:'采购订单',business_meaning:'申请采购的明细与金额'}}));
 app.get('/favicon.ico',(_,res)=>res.status(204).end());
 app.get('/logo.png',(_,res)=>res.sendFile(path.resolve(__dirname,'../public/logo.png')));
 app.use('/harness',express.static(path.join(output,'bundle')));
 app.use('/app',express.static(build));app.get(/^\/app(?:\/.*)?$/,(_,res)=>res.sendFile(path.join(build,'index.html')));
 app.use((req,res)=>res.status(404).json({error:'测试未登记读取',path:req.path}));
 const server=await new Promise(resolve=>{const owned=app.listen(0,'127.0.0.1',()=>resolve(owned));});let browser;
 const checks=[],errors=[],httpErrors=[];
 try{
  browser=await runtime().chromium.launch({channel:'msedge',headless:true});const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});const page=await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});page.on('response',response=>{if(response.status()>=400)httpErrors.push({url:response.url(),status:response.status()});});
  const base=`http://127.0.0.1:${server.address().port}`;
  const open=async screen=>{await page.goto(base+'/harness/?screen='+screen);await page.getByRole('heading',{name:'合成界面验证',exact:true}).waitFor();};
  async function clean(name){const inputValues=await page.locator('input:not([type=file]):not([type=checkbox]),textarea').evaluateAll(nodes=>nodes.map(node=>node.value).join(' '));const shown=(await page.locator('body').innerText())+' '+inputValues,labels=await page.locator('[aria-label],[title],[placeholder]').evaluateAll(nodes=>nodes.map(n=>[n.getAttribute('aria-label'),n.getAttribute('title'),n.getAttribute('placeholder')].filter(Boolean).join(' ')).join(' '));for(const token of [secret,hash,objectId,fieldId,'GOVERNANCE_PUBLISH','INTERNAL_MODEL_V99','schema_version','/api/','business_meaning'])assert(!(shown+' '+labels).includes(token),name+' leaked '+token);assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,name+' overflow');assert.equal(await page.locator('a[href^="/api/"]').count(),0);checks.push(name);}
  await open('details');await page.getByText('记录固定资产的原值与责任部门',{exact:true}).waitFor();await page.getByText('E00042',{exact:true}).waitFor();await clean('read-only content retains business facts and hides technical metadata');
  await page.getByRole('button',{name:'查阅关联内容',exact:true}).click();await page.getByText('申请采购的明细与金额',{exact:true}).waitFor();await clean('linked API result renders business content within the current page');await page.screenshot({path:path.join(output,'business-details.png'),fullPage:true});
  await open('values');await page.getByLabel('允许填写的值取值 1',{exact:true}).fill('无效数字');await page.getByRole('button',{name:'保存允许值',exact:true}).click();assert.equal(await page.evaluate(()=>window.copyEvidence.saved),undefined);assert.equal(await page.getByLabel('允许填写的值取值 1',{exact:true}).inputValue(),'无效数字');await page.getByLabel('允许填写的值取值 1',{exact:true}).fill('0');await page.getByLabel('允许填写的值取值 2',{exact:true}).selectOption('true');await page.getByRole('button',{name:'保存允许值',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window.copyEvidence.saved),[0,true,'未完成']);await clean('typed allowed values preserve zero and booleans; invalid numbers stay visible and block save');
  await open('picker');await page.getByRole('button',{name:'查找可选记录',exact:true}).click();await page.getByRole('option',{name:'资产卡片',exact:true}).waitFor({state:'attached'});await page.getByLabel('选择对象或字段',{exact:true}).selectOption(objectId);await page.getByRole('option',{name:'资产原值',exact:true}).waitFor({state:'attached'});await page.getByLabel('选择对象或字段',{exact:true}).selectOption(fieldId);await page.waitForFunction(()=>window.copyEvidence.selected==='9007199254740898');await clean('definition selection reads the selected field and preserves its exact reference');
  await open('reference');await page.getByLabel('选择要修改的字段',{exact:true}).selectOption('9007199254740998');assert.equal(await page.evaluate(()=>window.copyEvidence.selected),'9007199254740998');assert.equal(await page.getByRole('option',{name:'资产卡片',exact:true}).count(),0);await clean('field changes select fields rather than substituting an object identity');
  await open('withdrawal');await page.getByRole('button',{name:'办理整单撤回',exact:true}).click();assert(await page.getByRole('button',{name:'执行本次整单撤回',exact:true}).isDisabled());await page.getByLabel('撤回原因',{exact:true}).fill('来源材料需要更正');await page.getByRole('button',{name:'检查撤回影响',exact:true}).click();await page.getByLabel('批准依据及影响核对说明',{exact:true}).fill('已核对资产卡片及既有引用');await page.getByRole('button',{name:'批准本次整单撤回',exact:true}).click();assert(!(await page.getByRole('button',{name:'执行本次整单撤回',exact:true}).isDisabled()));await clean('withdrawal separates reason, impact check, approval and execution');await page.screenshot({path:path.join(output,'withdrawal-approved.png'),fullPage:true});await page.getByLabel('撤回原因',{exact:true}).fill('原因发生变化');assert(await page.getByRole('button',{name:'执行本次整单撤回',exact:true}).isDisabled());await page.getByText('撤回原因已修改，请重新检查撤回影响，核对结果后再批准本次整单撤回。',{exact:true}).waitFor();await page.getByRole('button',{name:'模拟来源变化',exact:true}).click();assert.equal(await page.getByLabel('撤回原因',{exact:true}).inputValue(),'原因发生变化');assert(await page.getByLabel('撤回原因',{exact:true}).isDisabled());checks.push('reason/source changes invalidate approval without discarding input');
  await open('objects');await page.getByRole('button',{name:'资产卡片 待核实',exact:false}).click();await page.getByRole('button',{name:'修订对象',exact:true}).click();await page.getByLabel('对象名称 *',{exact:true}).fill('资产卡片核对稿');await page.getByRole('button',{name:'保存对象',exact:true}).click();await page.getByText(/已保存对象“资产卡片核对稿”/).waitFor();assert.equal(writes.find(row=>row.path==='/data-map-definitions/save')?.body.entity_id,objectId);await clean('object save uses the existing large identity and reports a business name');
  await open('import');await page.getByLabel('采购订单入库方式',{exact:true}).selectOption('revision');await page.getByRole('button',{name:'查找可选记录',exact:true}).click();await page.getByRole('option',{name:'资产卡片',exact:true}).waitFor({state:'attached'});await page.getByLabel('选择已有对象',{exact:true}).selectOption(objectId);await page.getByRole('button',{name:'核对 名称未记录 关联',exact:true}).click();await page.getByText(/已核对：资产卡片/).waitFor();await clean('template import selects an existing object by name and keeps explicit target verification');
  await open('draft');await page.locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=true));await page.getByLabel('标识组1依据',{exact:true}).fill('按已确认的资产编码识别');assert.equal(await page.evaluate(()=>window.copyEvidence.draft.items[0].definition.unique_identifiers[0].basis),'按已确认的资产编码识别');await clean('identifier basis remains editable prose rather than an unrelated record picker');
  await open('excel');await page.getByLabel('证据工作表',{exact:true}).selectOption('资产');await page.getByRole('button',{name:'A1',exact:true}).waitFor();await clean('Excel source content retains worksheet positions without hashes or raw type codes');
  await open('identity');await page.getByLabel('选择字段',{exact:true}).selectOption(fieldId);await page.getByRole('button',{name:'查阅维护与确认记录',exact:true}).click();await page.locator('[data-field-identity-history] summary').click();await page.getByText('历史姓名未记录 → 历史姓名未记录',{exact:true}).waitFor();await clean('historical responsibility changes remain readable without substituting current names or exposing old person IDs');
  await open('terms');await page.getByRole('button',{name:/资产 固定资产管理/}).click();await page.locator('[data-term-governance-detail]').waitFor();await clean('terminology list and detail use the real term and context without internal identifiers');
  await open('guide');await page.getByRole('heading',{name:'合成管理员',exact:true}).waitFor();await clean('role guidance hides model and permission codes while retaining responsibilities');
  await page.goto(base+'/app/roles');await page.locator('[data-role-ready="true"]').waitFor();await page.getByRole('cell',{name:'发布已审核的流程内容',exact:true}).first().waitFor();await clean('built 3000 role page presents permissions and scope without internal codes');await page.screenshot({path:path.join(output,'roles-desktop.png'),fullPage:true});await page.getByRole('heading',{name:'角色权限详情',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,'role-permissions-desktop.png')});
  assert.deepEqual(errors,[],'browser errors');assert.deepEqual(httpErrors,[],'unexpected HTTP failures');fs.writeFileSync(path.join(output,'result.json'),JSON.stringify({status:'passed',environment:'synthetic HTTP, Edge 100%, 1699x828 CSS px',checks,errors,httpErrors,writes},null,2));
 }catch(error){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({error:error.stack,checks,errors,httpErrors},null,2));throw error;}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
 console.log(JSON.stringify({status:'passed',checks:checks.length,output}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
