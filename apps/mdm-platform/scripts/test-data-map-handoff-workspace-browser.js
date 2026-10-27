// Real Edge workspace regression, synthetic people/materials and fresh owned
// tmpfs MySQL only. --candidate-root, --frontend-dist and a new --output point
// to local artifacts. The workspace fixture explicitly leaves terminology off.
// UI actions use the actual built React shell, session and CSRF backend.
const assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {withWorkspaceFixture,request,proof}=require('./testHelpers/dataMapHandoffWorkspaceFixture');
const root=path.resolve(__dirname,'../../..'),evidenceRoot=path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-06');
const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const dist=path.resolve(arg('--frontend-dist',path.join(evidenceRoot,'frontend-build')));
const candidateRoot=arg('--candidate-root',process.env.MDM_TEST_CANDIDATE_ROOT);
if(candidateRoot)assert(path.resolve(candidateRoot).startsWith(path.join(root,'artifacts')+path.sep)&&fs.existsSync(path.join(candidateRoot,'server/index.js')),'explicit local candidate backend required');
const output=path.resolve(arg('--output',path.join(evidenceRoot,'workspace-edge-'+randomUUID())));
const scenario=arg('--scenario','all');
assert(['all','permissions','editing','q6','upgrade','withdrawal','protection','legacy','session-race','inspect'].includes(scenario),'unknown workspace browser scenario');
assert(dist.startsWith(path.join(root,'artifacts')+path.sep));assert(fs.existsSync(path.join(dist,'index.html')),'candidate frontend must exist');
assert(output.startsWith(path.join(root,'artifacts')+path.sep),'output must stay below artifacts');assert(!fs.existsSync(output),'preserve previous evidence');fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(__filename,path.join(output,'runner-source.js'));
fs.copyFileSync(path.join(__dirname,'testHelpers/dataMapHandoffWorkspaceFixture.js'),path.join(output,'fixture-source.js'));
const save=(name,value)=>fs.writeFileSync(path.join(output,name),JSON.stringify(value,null,2)+'\n');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const sourceFiles=[__filename,path.join(__dirname,'testHelpers/dataMapHandoffWorkspaceFixture.js'),...fs.readdirSync(path.join(__dirname,'../server')).filter(file=>/^dataMap.*\.js$/u.test(file)).map(file=>path.join(__dirname,'../server',file))].map(file=>({path:path.relative(root,file).replaceAll('\\','/'),sha256:hash(file)}));
function buildFiles(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>{const full=path.join(directory,item.name);return item.isDirectory()?buildFiles(full):[{path:path.relative(dist,full).replaceAll('\\','/'),sha256:hash(full),bytes:fs.statSync(full).size}];});}
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
const checks=[],exchanges=[],screenshots=[],geometry=[],pageErrors=[],consoleErrors=[],externalRequests=[],networkFailures=[],dialogs=[];
const build=buildFiles(dist);let passed=false,failure,owned,browserServer,browser,context,page,state,pool,fixture,hook=null,raw;
const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
function sessionCookieHash(value){if(!value)return null;try{const decoded=decodeURIComponent(value);const sid=decoded.startsWith('s:')?decoded.slice(2).split('.')[0]:decoded;return createHash('sha256').update(sid).digest('hex');}catch{return null;}}
function cookieHeaderHash(value){const pair=String(value||'').split(';').find(x=>/\.sid=/u.test(x));if(!pair)return null;const trimmed=pair.trim();return sessionCookieHash(trimmed.slice(trimmed.indexOf('=')+1));}
async function snapshot(name){
  if(await page.locator('.handoff-heading button').count())await page.waitForFunction(()=>!document.querySelector('.handoff-heading button')?.disabled);
  await page.evaluate(()=>document.fonts.ready);
  const measured=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale,dpr:devicePixelRatio,documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,focus:{tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label')||document.activeElement?.id||null},overflow:[...document.querySelectorAll('main input,main textarea,main select,main button')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.left<0||r.right>innerWidth+1);}).map(el=>({tag:el.tagName,text:el.getAttribute('aria-label')||el.textContent?.slice(0,70)}))}));
  geometry.push({name,...measured});assert.equal(measured.width,1699);assert.equal(measured.height,828);assert.equal(measured.scale,1);assert.equal(measured.dpr,1);assert(measured.documentWidth<=1699,'horizontal page overflow: '+JSON.stringify(measured));assert.deepEqual(measured.overflow,[]);
  const visible=await page.locator('body').innerText();
  assert(!/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\b[a-f0-9]{64}\b|\/api\/|\bfield_a\b|\belement_a\b|object:source_1/iu.test(visible),'internal identities, endpoints and hashes must not be visible');
  await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});screenshots.push(name+'.png');fs.writeFileSync(path.join(output,name+'.txt'),visible);save('geometry.json',geometry);
}
async function check(name,work){await work();checks.push(name);console.log('PASS '+name);save('progress.json',{checks,exchanges,geometry});}
async function login(who){await page.locator('#login-name').fill(state.loginNames[who]);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();try{await button('退出登录').waitFor();}catch(error){const cookies=(await context.cookies()).map(x=>({name:x.name,sid_hash:sessionCookieHash(x.value),expires:x.expires}));const sessions=(await pool.execute("SELECT sid_hash,JSON_UNQUOTE(JSON_EXTRACT(session_json,'$.personId')) person_id,JSON_UNQUOTE(JSON_EXTRACT(session_json,'$.accountId')) account_id,expires_at FROM mdm_http_sessions"))[0];save('login-session-diagnostics.json',{login:who,cookies,sessions,exchanges});throw error;}}
async function dialogAction(action,accept=true){const pending=[];const handler=dialog=>{const record={type:dialog.type(),message:dialog.message(),decision:accept?'accept':'dismiss',url:page.url()};dialogs.push(record);save('dialogs.json',dialogs);pending.push((accept?dialog.accept():dialog.dismiss()).then(()=>{record.completed=true;save('dialogs.json',dialogs);}).catch(error=>{record.error=error.message;pageErrors.push(error.message);}));};page.on('dialog',handler);try{const result=await action();await Promise.all(pending);return result;}finally{page.off('dialog',handler);}}
async function within(promise,ms,label){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}finally{clearTimeout(timer);}}
async function logout(){await dialogAction(()=>button('退出登录').click());await page.getByRole('heading',{name:'登录 MDM 平台',exact:true}).waitFor();}
async function open(params={}){const search=new URLSearchParams(params);await page.goto(fixture.baseURL+'/app/data-map-handoffs'+(search.size?'?'+search:''));await page.locator('.data-map-handoffs').waitFor();await page.waitForFunction(()=>document.querySelector('.handoff-heading button')&&!document.querySelector('.handoff-heading button').disabled);}
async function as(who,params={}){if(await button('退出登录').count())await logout();await login(who);await open(params);}
async function readCurrent(id,who=state.actors.lead){return state.repo.get(id,who);}
async function noPersistentInput(text){const stored=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert(!stored.includes(text),'business input must remain memory-only');}
async function closeOwnedBrowser(){
  if(context){await context.close().catch(()=>{});context=null;}
  if(browser){let timer;await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,8000);})]).finally(()=>clearTimeout(timer));browser=null;}
  if(browserServer)await browserServer.kill().catch(()=>{});
}
async function captureFailure(){if(page&&!page.isClosed()){save('failure-location.json',{url:page.url(),dialogs});await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-text.txt'),await page.locator('body').innerText().catch(()=>''));fs.writeFileSync(path.join(output,'failure-dom.html'),await page.content().catch(()=>''));}}
async function settle(end=true){
  await button('确认本次办理结果').waitFor();await button('确认本次办理结果').click();
  if(end&&await button('结束本次办理').count())await dialogAction(()=>button('结束本次办理').click());
}
async function perform(name,{end=true}={}){
  const observed=page.waitForResponse(r=>r.request().method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/data-map-handoffs/'));
  await button(name).click();const response=await observed,value=await response.json();
  assert.equal(response.status(),200,JSON.stringify(value));assert(value.request_id);await settle(end);return value;
}
async function conflictProof(){await field('冲突办理依据').fill(proof.basis);await field('冲突证据（每行一条）').fill(proof.evidence_refs.join('\n'));}
async function finishPublication(id){
  await open({handoff:id});
  let current=await readCurrent(id);
  const missing=current.report.gates.flatMap(g=>g.issues).filter(issue=>issue.startsWith('IMPACT_UNRESOLVED:')).map(issue=>issue.slice('IMPACT_UNRESOLVED:'.length));
  if(missing.length){
    await button('编辑完整草案').click();let index=(current.revision.snapshot_json.impact_dispositions||[]).length;
    for(const key of missing){await button('新增影响处置').click();index++;const choice=page.getByLabel('影响'+index+'对象',{exact:true});await choice.selectOption(key);assert.equal(await choice.inputValue(),key);const selected=await choice.locator('option:checked').innerText();assert(selected.trim()&&!selected.includes(key),'impact choice must show a readable description while preserving the exact hidden key');assert(!/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|\b[a-f0-9]{64}\b|definition_identifier:|publication_item:/iu.test(selected));await field('影响'+index+'决定').selectOption('compatible_fixed_reference');await field('影响'+index+'依据').fill('合成固定历史引用保留，明确评估兼容性');await field('影响'+index+'证据（每行一条）').fill('synthetic:impact:fixed-history');}
    await perform('保存完整草案');current=await readCurrent(id);assert(current.report.ready_for_approval,JSON.stringify(current.report.gates));
  }
  await button('执行本次检查').click();await perform('确认本次办理');
  await button('提交本次草案').click();await perform('确认本次办理');
  await as('lead',{handoff:id});await button('批准本次草案').click();
  await field('本次办理依据').fill(proof.basis);await perform('确认本次办理');
  await button('整单执行发布').click();const published=await perform('确认本次办理');
  current=await readCurrent(id);assert.equal(current.header.state,'published');
  assert(published.publication_id);return published.publication_id;
}
async function permissionScenario(){
  const id=state.drafts.editing.handoff_id,current=await readCurrent(id);
  const before=Number((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests'))[0][0].n);
  for(const who of ['admin','adminMulti']){
    await as(who,{handoff:id});await page.getByRole('heading',{name:'承接草案 · 未提交草案',exact:true}).waitFor();
    for(const label of ['编辑完整草案','提交本次草案','批准准确草案','整单执行发布','登记本草案冲突','编制来源升级评估'])assert.equal(await button(label).count(),0,who+' must remain read only');
    const denied=await raw(who,'/api/data-map-handoffs/'+id+'/draft','PATCH',request({expected_revision:Number(current.header.current_revision),draft:current.revision.snapshot_json}));assert.equal(denied.status,403);assert.equal(denied.body.code,'HANDOFF_ADMIN_READ_ONLY');
    await snapshot(who+'-governance-read-only');
  }
  assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_requests'))[0][0].n),before);
  await as('contact',{handoff:id});await page.getByRole('heading',{name:'本次操作未完成',exact:true}).waitFor();assert.equal(await page.getByTestId('handoff-draft-editor').count(),0);assert(!(await page.locator('body').innerText()).includes('Synthetic object definition'));
  const limited=await raw('contact','/api/data-map-handoffs/workbench');assert.equal(limited.status,200);assert.deepEqual(limited.body.packages,[]);assert.deepEqual(limited.body.options,{departments:[],handlers:[],deciders:[]});
  await as('steward',{handoff:id});await button('编辑完整草案').waitFor();assert.equal(await button('批准准确草案').count(),0);assert.equal(await button('整单执行发布').count(),0);
  await check('actual admin and admin-overlap UI/HTTP remain governance-read-only, departments cannot read complete drafts or selector identities, and assigned steward has no approval/publication action',async()=>{await snapshot('assigned-steward-actions');});
}
async function discoveryPreflight(){
  const authenticated=await raw('steward','/api/org/login','POST',{loginName:state.loginNames.steward,password:fixture.loginPassword});assert.equal(authenticated.status,200);
  const jobs=[...Array.from({length:5},()=>({who:'steward',url:'/api/data-map-handoffs/workbench'})),{who:'lead',url:'/api/data-map-handoffs/workbench'},{who:'lead',url:'/api/data-map-handoffs/source-upgrades'}];
  const concurrent=await Promise.all(jobs.map(async job=>{const result=await raw(job.who,job.url);return{...job,status:result.status,body:result.body};}));
  for(const result of concurrent){assert.equal(result.status,200,JSON.stringify(result));exchanges.push({method:'GET',url:result.url,who:result.who,status:result.status,concurrent_preflight:true});}
  const expectedPackages=[...Object.values(state.drafts).map(x=>x.package_id),state.legacy.package_id,state.upgrade.created.newPackageId].sort();
  for(const result of concurrent.filter(x=>x.who==='steward'))assert.deepEqual(result.body.packages.map(x=>x.package_id).sort(),expectedPackages);
  const leader=concurrent.find(x=>x.who==='lead'&&x.url.endsWith('/workbench')).body;assert(leader.options.handlers.some(x=>x.person_id==='86'));assert(leader.options.deciders.some(x=>x.person_id==='87'));assert(!leader.options.handlers.some(x=>x.person_id==='88'));assert(!leader.options.deciders.some(x=>x.person_id==='88'));
  const roles=[];
  for(const who of ['admin','adminMulti','contact','reviewA','reviewB','outsider','multi']){
    const result=await raw(who,'/api/data-map-handoffs/workbench');assert.equal(result.status,200,JSON.stringify(result));roles.push({who,...result});
    if(who==='admin'||who==='adminMulti'){assert(result.body.packages.length>0);assert(result.body.packages.every(x=>JSON.stringify(x.allowed_actions)==='["read"]'));}
    else{assert.deepEqual(result.body.packages,[]);assert.deepEqual(result.body.options,{departments:[],handlers:[],deciders:[]});}
    exchanges.push({method:'GET',url:'/api/data-map-handoffs/workbench',who,status:result.status,role_preflight:true});
  }
  save('workbench-discovery-concurrency.json',{concurrent,roles});checks.push('five simultaneous assigned-steward discovery reads plus leader discovery/source-upgrade reads all return 200, preserve exact assignment scopes and exclude admin-overlap candidates');
}
async function withdrawalScenario(){
  if(!state.editingPublication){await as('lead',{handoff:state.drafts.editing.handoff_id});state.editingPublication=await finishPublication(state.drafts.editing.handoff_id);}
  const id=state.editingPublication,beforePublication=await state.repo.getPublication(state.editingPublication,state.actors.lead);await as('adminMulti',{publication:id});assert.equal(await button('办理整单撤回').count(),0);assert.equal(await button('准备恢复草稿').count(),0);
  await as('lead',{publication:id});await button('办理整单撤回').click();await field('撤回原因').fill('合成整单止损：本次发布暂停新引用');
  const checked=await perform('检查撤回影响',{end:false});assert.equal(checked.business_outcome,'withdrawal_checked');assert.equal(await field('撤回原因').inputValue(),'合成整单止损：本次发布暂停新引用');
  await field('批准依据及影响核对说明').fill('合成核对八项产生版本及全部固定引用影响，批准原因A本次整单撤回');const approvedA=await perform('批准本次整单撤回',{end:false});assert.equal(approvedA.business_outcome,'withdrawal_approved');
  await field('撤回原因').fill('合成原因B：按更新后的明确止损原因重新核对');assert.equal(await button('执行本次整单撤回').isDisabled(),true);
  const checkedB=await perform('检查撤回影响',{end:false});assert.equal(checkedB.report.reason,'合成原因B：按更新后的明确止损原因重新核对');assert.notEqual(checkedB.report.binding_digest,checked.report.binding_digest);assert.equal(await button('执行本次整单撤回').isDisabled(),true);
  await field('批准依据及影响核对说明').fill('合成明确批准原因B的准确新检查；原因A旧批准不能套用');const approved=await perform('批准本次整单撤回',{end:false});assert.notEqual(approved.withdrawal_approval_id,approvedA.withdrawal_approval_id);save('q10-reason-change-new-check-approval.json',{checkedA:checked,approvedA,checkedB,approvedB:approved});
  const withdrawn=await perform('执行本次整单撤回');assert.equal(withdrawn.business_outcome,'publication_withdrawn');
  let original=await state.repo.getPublication(id,state.actors.lead);assert.equal(original.state,'withdrawn');assert.equal(original.event_revision,2);save('q10-ui-withdrawn.json',original);
  assert.deepEqual(original.manifest,beforePublication.manifest);assert.equal(original.manifest_digest,beforePublication.manifest_digest);
  for(const item of original.manifest.items.filter(row=>row.produces_version))assert.equal((await pool.execute("SELECT COUNT(*) n FROM data_map_effective_heads WHERE subject_kind=? AND subject_id=? AND publication_id=? AND availability='active'",[item.target_kind,item.target_id,id]))[0][0].n,0,'whole withdrawal clears only its exact active heads');
  await snapshot('q10-withdrawn');checks.push('Q10 UI requires a new check and approval when reason A changes to B, then withdraws all eight produced items while admin overlap stays read-only');
  await open({publication:id});await button('准备恢复草稿').click();await field('恢复目标工作包').selectOption(state.drafts.editing.package_id);await button('读取恢复目标').click();
  const binding=(await pool.execute('SELECT binding_id FROM data_map_handoff_binding_heads WHERE package_id=?',[state.drafts.editing.package_id]))[0][0].binding_id;
  await field('目标准确审核依据').selectOption(binding);await field('恢复草案位置').selectOption('new');await button('按原发布内容准备候选草案').click();
  for(const item of original.manifest.items){const name=item.payload.definition.name,row=page.locator('.handoff-restore-mapping').filter({has:page.getByRole('heading',{name:new RegExp(' · '+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$','u')})});assert.equal(await row.count(),1,'exact source definition name must locate its mapping');await row.getByLabel(/^采用方式：/u).selectOption('adopt');await row.getByLabel(/^采用依据：/u).fill('合成逐项采用原准确内容及内部关系，保留稳定标识并建立新版本');await row.getByLabel(/^采用证据：/u).fill('synthetic:restore:'+item.item_ref);}
  await field('恢复依据').fill('合成专用恢复入口明确采用原发布内容，新批准后方可重新生效');await field('恢复证据').fill('synthetic:restore:all-items');await snapshot('q10-restoration-explicit-mappings');
  let staleBindingChecked=false;
  hook=async route=>{
    if(!route.request().url().endsWith('/restorations')||route.request().method()!=='POST')return false;
    hook=null;const body=route.request().postDataJSON();assert.equal(body.expected_target_binding_id,binding);
    const before=Number((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_drafts'))[0][0].n);
    const rejected=await route.fetch({postData:JSON.stringify({...body,request_id:randomUUID(),expected_target_binding_id:randomUUID()})});const value=await rejected.json();
    assert.equal(rejected.status(),409);assert.equal(value.code,'HANDOFF_REVIEW_BINDING_STALE');assert.equal(Number((await pool.execute('SELECT COUNT(*) n FROM data_map_handoff_drafts'))[0][0].n),before);
    save('q10-wrong-target-binding-http.json',{status:rejected.status(),body:value,drafts_before:before,drafts_after:before});staleBindingChecked=true;return false;
  };
  const restored=await perform('保存恢复草案');assert(staleBindingChecked);assert.equal(restored.business_outcome,'restoration_draft_saved');assert.notEqual(restored.handoff_id,original.manifest.handoff_id);
  const draft=await readCurrent(restored.handoff_id);assert.equal(draft.header.state,'draft');assert.equal(draft.header.current_approval_id,null);save('q10-ui-restoration-draft.json',draft);
  const nextId=await finishPublication(restored.handoff_id);const next=await state.repo.getPublication(nextId,state.actors.lead);original=await state.repo.getPublication(id,state.actors.lead);assert.equal(original.state,'withdrawn');assert.equal(next.manifest.restores_publication_id,id);
  for(const old of original.manifest.items){const item=next.manifest.items.find(x=>x.item_ref===old.item_ref);assert.equal(item.target_id,old.target_id);assert.notEqual(item.target_version_ref,old.target_version_ref);}
  save('q10-ui-restoration-publication.json',next);await snapshot('q10-restored-new-publication');checks.push('Q10 dedicated restoration UI explicitly maps all original items into a new unapproved draft and then obtains new exact approval/publication, preserving withdrawn original and stable identities');
}

async function editingScenario(){
  await as('steward',{handoff:state.drafts.editing.handoff_id});
  await button('编辑完整草案').click();
  const original=(await readCurrent(state.drafts.editing.handoff_id)).revision;
  await field('业务含义').fill('合成对象经本次完整结构化编辑明确业务含义');await field('对象归口部门').selectOption('91');
  assert.equal(await field('标识组1类型').inputValue(),'composite');await field('标识组1依据').fill('合成复合唯一标识：字段A和字段B联合识别');
  assert.equal(await page.getByLabel('Synthetic key a',{exact:true}).isChecked(),true);
  await field('条目办理依据').fill('合成逐项对象办理依据');await field('条目证据（每行一条）').fill(proof.evidence_refs[0]);
  const choose=name=>page.locator('.handoff-item-selector').getByRole('button',{name});
  await choose(/^数据使用范围：Synthetic context/).click();await field('使用目的').fill('合成本流程准确使用目的');await field('数据使用方式（每行一条）').fill('create\nread');
  await choose(/^数据项定义：Synthetic key A/).click();await field('业务含义').fill('合成数据元A统一业务含义');await field('数据元类型').fill('string');
  await choose(/^字段：Synthetic key a/).click();await field('业务含义').fill('合成字段A与数据元保持明确引用');await field('所属对象').selectOption('object');await field('数据使用范围').selectOption('context');await field('数据元引用').selectOption('element_a');await field('字段必填').selectOption('true');
  await field('允许值1').waitFor();assert.equal(await field('允许值1').inputValue(),'0');assert.equal(await field('允许值2').inputValue(),'false');await field('长度与精度').fill('synthetic-length-32');await field('标识属性用途').fill('synthetic-identifier');await field('敏感等级').fill('synthetic-internal');await field('脱敏方式').fill('synthetic-display-only-mask');
  await choose(/^生命周期规则：Synthetic rule/).click();await field('触发条件').fill('合成收到当前固定来源材料后触发');await field('规则责任部门').selectOption('91');
  await choose(/^数据来源认定：Synthetic authority fact/).click();await field('需要认定来源的属性').selectOption('business_meaning');await field('以哪个系统的记录为准').fill('synthetic-sor');await field('权威维护部门').selectOption('91');
  await snapshot('structured-draft-editor');
  await perform('保存完整草案');const saved=await readCurrent(state.drafts.editing.handoff_id);
  assert.equal(saved.header.current_revision,2);assert.equal(saved.revision.snapshot_json.items.length,8);
  assert.deepEqual(saved.revision.snapshot_json.items.find(x=>x.item_ref==='object').definition.unique_identifiers[0].field_item_refs,['field_a','field_b']);
  assert.deepEqual(saved.revision.snapshot_json.items.find(x=>x.item_ref==='field_a').definition.enum_values,[0,false,'Synthetic retained text']);
  save('structured-draft-ui-save.json',saved);checks.push('structured UI edits objects, composite identity, contexts, data elements, field references, lifecycle and SOR while preserving all eight complete items');
  state.editingPublication=await finishPublication(state.drafts.editing.handoff_id);await snapshot('structured-draft-published');checks.push('assigned MDM steward checks/submits and MDM leader newly approves/whole-publishes the exact edited draft through real UI');
  await open({handoff:state.drafts.editing.handoff_id,revision:'1'});await page.getByRole('heading',{name:'历史草稿（只读） · 已发布',exact:true}).waitFor();assert.equal(await button('编辑完整草案').count(),0);assert.equal(await button('登记本草案冲突').count(),0);assert.equal(await button('编制来源升级评估').count(),0);const fixed=await state.repo.get(state.drafts.editing.handoff_id,state.actors.lead,{revisionNo:1});assert.equal(fixed.revision.content_digest,original.content_digest);assert.deepEqual(fixed.revision.snapshot_json,original.snapshot_json);await snapshot('fixed-history-revision-read-only');checks.push('fixed historical draft revision remains exactly readable with original hash and no edit/conflict/upgrade actions after later publication');
}
async function legacyScenario(){
  const packageId=state.legacy.package_id;await as('steward',{package:packageId});await button('准备旧包接入核验').click();const intake=await perform('提交本次接入或更正办理');assert(intake.intake_id);
  await button('为此接入提出定向补核').click();await field('补核准确明细').selectOption({index:1});await field('补核目标部门').selectOption('91');await field('补核事实类型').fill('business_meaning');await field('补核明确问题').fill('合成旧接入：请按当前来源独立提供业务含义事实');await field('本次更正或补核原因').fill('合成接入核验需部门提供准确事实');const fact=await perform('提交本次接入或更正办理');
  await as('contact',{fact:fact.fact_id});assert.equal(await button('负责人确认准确答复').count(),0);await button('答复具体事实').click();await field('本次事实答复').fill('合成当前部门独立核实的旧接入事实');await field('事实证据（每行一条）').fill('synthetic:legacy:department-fact');await perform('提交本次事实办理');
  await as('steward',{fact:fact.fact_id});await button('MDM核对关闭').click();await field('本次事实办理依据').fill('合成核对部门答复及准确来源，保持旧事实合同');await field('事实证据（每行一条）').fill('synthetic:legacy:closure');await perform('提交本次事实办理');
  await as('lead',{package:packageId});await button('逐明细核验此接入').click();const basisFields=page.getByLabel(/^明细\d+核验依据$/u);for(let n=0;n<await basisFields.count();n++)await basisFields.nth(n).fill('合成本次按准确明细逐项核验，不补造历史作者');const evidenceFields=page.getByLabel(/^明细\d+核验证据（每行一条）$/u);for(let n=0;n<await evidenceFields.count();n++)await evidenceFields.nth(n).fill('synthetic:legacy:current-item-check');await field('本次审核依据').fill('合成确认本次接入核验与已关闭部门事实');const reviewed=await perform('提交本次接入或更正办理');assert(reviewed.binding_id);
  await as('steward',{package:packageId});await button('承接本次已审核工作包').click();await field('本次承接范围').selectOption('current');const created=await perform('提交本次接入或更正办理');const current=await readCurrent(created.handoff_id);assert.equal(current.header.state,'draft');assert.equal(current.header.current_approval_id,null);assert.equal(current.revision.binding_id,reviewed.binding_id);
  const [[original]]=await pool.execute('SELECT source_content_hash,status FROM process_data_governance_work_packages WHERE id=?',[packageId]);assert.equal(original.source_content_hash,state.legacy.original_source_hash);assert.equal(original.status,'completed');
  save('legacy-intake-ui-result.json',{intake,fact:await state.repo.getFact(fact.fact_id,state.actors.lead),reviewed,created,current,original});checks.push('completed legacy package without intake/binding is explicitly prepared, has a directed department fact answered and MDM-closed under its original contract, receives per-detail current review and creates an unapproved linked draft through UI');
  await open({package:packageId});await button('新建审核后更正').click();await field('本次更正或补核原因').fill('合成明确修正本次治理结论');await field('本次材料证据（每行一条）').fill('synthetic:legacy:correction');const correction=await perform('提交本次接入或更正办理');assert(correction.correction_id);
  await button('编辑本次更正明细').click();await page.getByLabel('本次明确更正 object:source_1',{exact:true}).check();await field('更正507状态').selectOption('confirmed');await field('更正507结论').fill('合成显式更正后的准确结论');await field('更正507依据').fill('合成当前事实与来源逐项核对');await field('更正507证据（每行一条）').fill('synthetic:legacy:corrected-item');await field('本次更正或补核原因').fill('合成已核实准确结论需要更新');await field('本次材料证据（每行一条）').fill('synthetic:legacy:corrected-review');await perform('提交本次接入或更正办理');
  await as('lead',{package:packageId});await button('审核此更正准确修订').click();await field('本次审核依据').fill('合成组长审核当前更正及部门事实');await field('本次材料证据（每行一条）').fill('synthetic:legacy:correction-approved');const corrected=await perform('提交本次接入或更正办理');assert.notEqual(corrected.binding_id,reviewed.binding_id);
  await as('steward',{handoff:created.handoff_id});await button('采用本次新审核绑定').click();await field('采用审核绑定标识').fill(corrected.binding_id);await field('本次办理依据').fill('合成主动采用新更正审核，不改写原审核及旧草案修订');await perform('确认本次办理');
  const rebased=await readCurrent(created.handoff_id);assert.equal(rebased.revision.binding_id,corrected.binding_id);assert.equal((await state.repo.get(created.handoff_id,state.actors.lead,{revisionNo:1})).revision.binding_id,reviewed.binding_id);save('legacy-correction-ui-result.json',{correction,corrected,rebased});await snapshot('legacy-correction-rebased');checks.push('UI creates, edits and separately reviews an explicit correction, then rebases to the new exact review while preserving the original intake binding and immutable old revision');
}
async function q6Scenario(){
  for(const severity of ['ordinary','major']){
    const draft=state.drafts[severity];await as('lead',{handoff:draft.handoff_id});await button('登记本草案冲突').click();
    await field('冲突类别').selectOption('cross_department');await field('冲突程度').selectOption(severity);
    await page.getByTestId('handoff-conflict-panel').getByLabel('合成对象'+severity+' · object',{exact:true}).check();
    await page.getByTestId('handoff-conflict-panel').getByLabel('合成甲部 · 91',{exact:true}).check();
    await page.getByTestId('handoff-conflict-panel').getByLabel('合成乙部 · 92',{exact:true}).check();
    await field('冲突差异').fill('合成冲突：不同部门对准确业务含义存在差异 '+severity);
    await field('可选方案（每行一条）').fill('按来源甲解释\n按来源乙解释，分别核对');await field('冲突影响').fill('影响本次对象及两个相关部门的事实核对');await conflictProof();
    const opened=await perform('提交登记冲突'),conflictId=opened.conflict_id;await open({conflict:conflictId});
    await button('分派冲突处理人').click();await field('当前冲突处理人').selectOption('86');await conflictProof();await perform('提交本次冲突办理');
    await as('handler',{conflict:conflictId});assert.equal(await button('编辑完整草案').count(),0);assert.equal((await page.locator('body').innerText()).includes('Synthetic key B definition'),false);
    await button('补充观点').click();await field('本次观点').fill('合成处理人：准确界定争议，保留部门分别核对');await conflictProof();await perform('提交本次冲突办理');
    if(severity==='major'){
      assert.equal(await button('形成普通协调结果').count(),0);
      await button('升级重大争议').click();await field('明确项目决策人').selectOption('87');await conflictProof();await perform('提交本次冲突办理');
      await as('decider',{conflict:conflictId});assert.equal(await button('编辑完整草案').count(),0);await button('记录项目决定').click();
    }else await button('形成普通协调结果').click();
    await field('明确处理结果').fill('合成明确处理结果：保留来源含义，两个相关部门分别重新答复和负责人确认');await conflictProof();await perform('提交本次冲突办理');
    let conflict=await state.repo.getConflict(conflictId,state.actors.lead);assert.equal(conflict.state,'resolved');assert.equal(conflict.conflict.facts.length,0);
    await check(severity+' conflict UI records coordination/decision without creating department confirmations',async()=>{await snapshot(severity+'-resolved-not-confirmed');});
    for(const department of ['91','92']){
      await as('steward',{conflict:conflictId});await button('提出定向事实重核').click();
      await field('事实准确来源明细').selectOption({index:1});await field('事实目标部门').selectOption(department);
      await field('本次事实类型').fill('business_meaning');await field('明确事实问题').fill('合成定向事实：请重新核对本次处理结果部门'+department);await field('提问原因').fill('合成处理结果后分别重核');await field('冲突证据（每行一条）').fill(proof.evidence_refs[0]);
      const fact=await perform('提交本次冲突办理');
      await as(department==='91'?'contact':'reviewerB',{fact:fact.fact_id});
      assert.equal(await button('负责人确认准确答复').count(),department==='91'?0:0); // An unanswered fact cannot be confirmed.
      assert.equal(await button('登记本草案冲突').count(),0);
      const directedText=await page.locator('body').innerText();assert(!directedText.includes('合成冲突：不同部门'));assert(!directedText.includes('按来源乙解释'));
      await button('答复具体事实').click();await field('本次事实答复').fill('合成部门'+department+'根据准确来源和本部门实际事实独立答复');await field('事实证据（每行一条）').fill('synthetic:department:'+department);await perform('提交本次事实办理');
      await as(department==='91'?'reviewerA':'reviewerB',{fact:fact.fact_id});await button('负责人确认准确答复').click();await field('本次事实办理依据').fill('合成当前最终负责人核对准确答复版本');await field('事实证据（每行一条）').fill('synthetic:final:'+department);await perform('提交本次事实办理');
      await as('steward',{fact:fact.fact_id});await button('MDM核对关闭').click();await field('本次事实办理依据').fill('合成MDM核对负责人当前确认及证据');await field('事实证据（每行一条）').fill('synthetic:closed:'+department);await perform('提交本次事实办理');
      assert.equal((await state.repo.getFact(fact.fact_id,state.actors.lead)).status,'closed');
    }
    await as('steward',{conflict:conflictId});await button('验证冲突重核结果').click();await conflictProof();await perform('提交本次冲突办理');
    conflict=await state.repo.getConflict(conflictId,state.actors.lead);assert.equal(conflict.state,'verified');assert.equal(conflict.current_handoff_revision,2);
    await check(severity+' conflict UI completes both departments answer/final-person confirmation/MDM close and same-content new revision verification',async()=>{await snapshot(severity+'-verified');});
    const publicationId=await finishPublication(draft.handoff_id);save(severity+'-published.json',{conflict:await state.repo.getConflict(conflictId,state.actors.lead),publication:await state.repo.getPublication(publicationId,state.actors.lead)});
    checks.push(severity+' verified conflict receives new exact approval and whole publication through the UI');
  }
}
async function upgradeScenario(){
  await as('lead',{handoff:state.upgrade.created.draft.handoff_id});
  async function currentPrompt(status){const details=page.locator('.handoff-upgrade-panel .handoff-fixed-details');await details.waitFor();if(!await details.evaluate(el=>el.open))await details.locator('summary').click();const row=details.locator('tbody tr').filter({hasText:state.upgrade.source.processRef});await row.getByRole('cell',{name:new RegExp('^'+status)}).waitFor();assert.equal(await row.getByRole('cell').nth(1).innerText(),state.upgrade.source.newVersionId);assert((await row.getByRole('cell').nth(3).innerText()).includes(state.upgrade.created.newPackageId));return{process_ref:state.upgrade.source.processRef,process_version_id:state.upgrade.source.newVersionId,package_id:state.upgrade.created.newPackageId,text:await row.innerText()};}
  const promptBefore=await currentPrompt('治理承接待完成');await page.locator('.handoff-upgrade-panel .handoff-fixed-details > summary').click();
  await button('编制来源升级评估').click();
  await field('原工作包编号').fill(state.upgrade.source.oldPackageId);await button('读取固定版本比较').click();
  await snapshot('source-upgrade-comparison');
  await field('原包准确审核依据').selectOption(state.upgrade.oldReview.binding_id);await button('展开逐项重核').click();
  const rows=page.locator('.handoff-upgrade-item');await rows.first().waitFor();assert(await rows.count()>3);
  const decisions=[];
  for(let index=0;index<await rows.count();index++){
    const row=rows.nth(index);if(!await row.evaluate(el=>el.open))await row.locator('summary').click();
    const choose=row.getByLabel(/^沿用决定：/),label=await choose.evaluate(el=>el.closest('label').textContent.split('引用旧字段')[0]);
    const options=await choose.locator('option').evaluateAll(options=>options.map(o=>o.value));
    if(options.includes('reference_and_recheck')){await choose.selectOption('reference_and_recheck');await row.getByRole('checkbox',{name:/^沿用字段 \/scope：/}).check();}
    await row.locator('textarea').evaluateAll(nodes=>nodes.map(el=>el.closest('label').childNodes[0]?.textContent));
    const textareas=row.locator('textarea');for(let n=0;n<await textareas.count();n++)await textareas.nth(n).fill(n%2?'synthetic:q9:explicit-current-recheck':'合成已逐项重新核对来源事实、结论、共用定义和影响');
    decisions.push({label,choice:await choose.inputValue()});
  }
  await field('升级评估依据').fill('合成新版全部差异逐项核对，沿用字段只作依据');await field('升级评估证据').fill('synthetic:q9:assessment');await snapshot('source-upgrade-explicit-rechecks');
  const result=await perform('保存来源升级评估');assert.equal(result.business_outcome,'source_upgrade_assessed');
  const recorded=await state.repo.getSourceUpgradeAssessments(state.upgrade.created.draft.handoff_id,state.actors.lead);assert.equal(recorded.assessments.length,1);assert.deepEqual(recorded.current.issues,[]);save('source-upgrade-ui-result.json',{decisions,result,recorded});
  checks.push('Q9 UI compares all four change categories, selects exact old review, chooses explicit unchanged field reuse and separately records four rechecks without automatic publication');
  const publicationId=await finishPublication(state.upgrade.created.draft.handoff_id);save('source-upgrade-ui-publication.json',await state.repo.getPublication(publicationId,state.actors.lead));
  checks.push('Q9 newly assessed source receives a new approval and complete publication through the UI');
  const promptResponse=page.waitForResponse(response=>response.request().method()==='GET'&&new URL(response.url()).pathname==='/api/data-map-handoffs/source-upgrades'&&!new URL(response.url()).search);await button('查看最新记录').click();const refreshed=await promptResponse;assert.equal(refreshed.status(),200);const freshBody=await refreshed.json(),freshProcess=freshBody.processes.find(x=>x.process_ref===state.upgrade.source.processRef);assert.equal(freshProcess.governance_status,'governed');assert.equal(String(freshProcess.current_process_version_id),state.upgrade.source.newVersionId);assert.equal(String(freshProcess.work_package_id),state.upgrade.created.newPackageId);const promptAfter=await currentPrompt('当前版本已承接');save('source-upgrade-prompt-refresh.json',{before:promptBefore,after:promptAfter,actual_refreshed_process:freshProcess});await page.locator('.handoff-upgrade-panel .handoff-fixed-details').scrollIntoViewIfNeeded();await snapshot('source-upgrade-refreshed-current-prompt');checks.push('explicit latest-record refresh after real publication updates the same current source version and work-package prompt from pending to governed');
}
async function protectionScenario(){
  const id=state.drafts.session.handoff_id,sentinel='合成原身份专属未提交内容，刷新和重新登录不得丢失或泄露';
  await as('steward',{handoff:id});await button('编辑完整草案').click();await field('业务含义').fill(sentinel);
  await field('名称').focus();await field('名称').dispatchEvent('compositionstart',{data:''});await page.keyboard.insertText('合成中文输入');await field('名称').dispatchEvent('compositionupdate',{data:'合成中文输入'});await field('名称').dispatchEvent('compositionend',{data:'合成中文输入'});
  const composed=await field('名称').inputValue();assert(composed.includes('合成中文输入'));
  await page.locator('.handoff-item-selector').getByRole('button',{name:/^使用上下文：/}).click();await page.locator('.handoff-item-selector').getByRole('button',{name:/^对象：/}).click();assert.equal(await field('业务含义').inputValue(),sentinel);assert.equal(await field('名称').inputValue(),composed);
  await button('查看最新记录').click();await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);
  const reloadBefore={url:page.url(),writes:exchanges.filter(x=>['POST','PATCH','DELETE','PUT'].includes(x.method)).length};let reloadDialog=null,reloadError=null;
  const dismissReload=async dialog=>{reloadDialog={type:dialog.type(),dismissed:false};await dialog.dismiss();reloadDialog.dismissed=true;};page.on('dialog',dismissReload);
  try{await page.reload({waitUntil:'domcontentloaded',timeout:3000});}catch(error){reloadError=error;}
  finally{page.off('dialog',dismissReload);}
  assert.deepEqual(reloadDialog,{type:'beforeunload',dismissed:true},'only an observed dismissed beforeunload allows cancelled-reload timeout');
  if(reloadError)assert.match(reloadError.message,/page\.reload:.*(?:Timeout|ERR_ABORTED|aborted|cancel)/iu);
  assert.equal(page.url(),reloadBefore.url);assert.equal(exchanges.filter(x=>['POST','PATCH','DELETE','PUT'].includes(x.method)).length,reloadBefore.writes);assert.equal(await field('业务含义').inputValue(),sentinel);save('cancelled-native-reload.json',{before:reloadBefore,dialog:reloadDialog,error:reloadError?.message.split('\n')[0]||null,url_after:page.url(),writes_after:reloadBefore.writes,input_preserved:true});
  const currentURL=page.url();await dialogAction(()=>page.locator('.handoff-work-list').getByRole('button',{name:/^SYN-WORKSPACE-PKG-505/}).click(),false);assert.equal(page.url(),currentURL);assert.equal(await field('业务含义').inputValue(),sentinel);
  await check('in-memory fields survive row selection, simulated composition and latest-record refresh; cancelling native page reload and resource change preserves exact input',async()=>{await noPersistentInput(sentinel);await snapshot('input-protection-composition-refresh');});
  await pool.execute("UPDATE process_governance_responsibilities SET person_id=86,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=506 AND assignment_kind='steward' AND person_id=89");
  await button('查看最新记录').click();await page.getByRole('heading',{name:'本次操作未完成',exact:true}).waitFor();assert.equal(await page.getByTestId('handoff-draft-editor').count(),0);assert.equal(await button('保存完整草案').count(),0);
  await pool.execute("UPDATE process_governance_responsibilities SET person_id=89,revision_no=revision_no+1 WHERE target_type='work_package' AND target_id=506 AND assignment_kind='steward' AND person_id=86");
  await button('查看最新记录').click();await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);assert.equal(await field('业务含义').isDisabled(),false);checks.push('actual package assignment revocation removes edit/submit access without clearing pending input; explicit synthetic reassignment restores the exact original owner values');
  const nav=page.locator('.sidebar a[href="/app/data-governance"]'),navStart=dialogs.length;await dialogAction(()=>nav.click(),false);assert.equal(page.url(),currentURL);assert.equal(dialogs.length,navStart+1);assert.equal(dialogs.at(-1).type,'confirm');assert.equal(dialogs.at(-1).completed,true);
  await dialogAction(()=>nav.click());assert.equal(dialogs.length,navStart+2);assert.equal(dialogs.at(-1).type,'confirm');assert.equal(dialogs.at(-1).completed,true);await page.waitForURL('**/app/data-governance');await page.locator('.data-governance').waitFor();await dialogAction(()=>page.locator('.sidebar a[href="/app/data-map-handoffs"]').click());await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);
  await page.evaluate(()=>{window.__handoffTestPops=[];window.addEventListener('popstate',event=>window.__handoffTestPops.push({url:location.href,index:event.state?.mdmIndex??null}));});
  async function historyAction(direction,accept,pathname){const beforeEvents=await page.evaluate(()=>window.__handoffTestPops.length);const waiting=page.waitForEvent('dialog');const move=page[direction]();const dialog=await waiting;const record={type:dialog.type(),message:dialog.message(),decision:accept?'accept':'dismiss',url:page.url(),history_direction:direction};dialogs.push(record);assert.equal(record.type,'confirm');await (accept?dialog.accept():dialog.dismiss());record.completed=true;save('dialogs.json',dialogs);await move;await page.waitForFunction(({beforeEvents,needed,pathname})=>window.__handoffTestPops.length>=beforeEvents+needed&&location.pathname===pathname,{beforeEvents,needed:accept?1:2,pathname});save('history-navigation.json',await page.evaluate(()=>window.__handoffTestPops));}
  await historyAction('goBack',false,'/app/data-map-handoffs');await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);
  await historyAction('goBack',true,'/app/data-governance');await page.locator('.data-governance').waitFor();await historyAction('goForward',true,'/app/data-map-handoffs');await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);
  await check('temporary actual sidebar navigation, cancelled browser back and accepted back/forward retain original owner input in application memory',async()=>{await snapshot('input-protection-navigation-back');});
  let originalBody,committed;
  hook=async route=>{if(route.request().method()!=='PATCH'||!route.request().url().endsWith('/'+id+'/draft'))return false;hook=null;originalBody=route.request().postDataJSON();const response=await route.fetch();committed=await response.json();assert.equal(response.status(),200);await route.abort('failed');return true;};
  const before=(await readCurrent(id)).header.current_revision;await button('保存完整草案').click();await page.getByRole('heading',{name:'本次操作未完成',exact:true}).waitFor();assert.equal((await readCurrent(id)).header.current_revision,before+1);assert.equal(await field('业务含义').inputValue(),sentinel);assert.equal(await field('业务含义').isDisabled(),true);assert(originalBody.request_id);save('lost-real-commit-ack.json',{request:originalBody,result:committed});
  const patchCount=()=>exchanges.filter(x=>x.method==='PATCH'&&x.url.endsWith('/'+id+'/draft')).length;
  const beforeExpiry=patchCount();await pool.execute("DELETE FROM mdm_http_sessions WHERE JSON_UNQUOTE(JSON_EXTRACT(session_json,'$.personId'))='89'");await button('查看最新记录').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes(sentinel));
  const readsBefore=exchanges.length;await login('lead');await page.getByText('原身份的承接输入已保留',{exact:true}).waitFor();assert.equal(await page.locator('.data-map-handoffs').count(),0);assert(!(await page.locator('body').innerText()).includes(sentinel));assert(!(await page.locator('body').innerText()).includes(originalBody.request_id));assert(!exchanges.slice(readsBefore).some(x=>x.url.startsWith('/api/data-map-handoffs/')));
  await logout();await login('steward');await field('业务含义').waitFor();assert.equal(await field('业务含义').inputValue(),sentinel);assert.equal(await field('业务含义').isDisabled(),true);assert.equal(patchCount(),beforeExpiry);await noPersistentInput(sentinel);await snapshot('input-owner-restored-after-real-401');
  await button('查询原请求回执').click();await button('核定原请求已完成').waitFor();assert.equal(patchCount(),beforeExpiry);assert.equal(await field('业务含义').inputValue(),sentinel);await settle();
  await check('real committed write with lost network acknowledgement retains original UUID/body, hides all input after actual session expiry and another login, restores only original owner and resolves committed receipt without replay',async()=>{const receipt=await state.repo.receipt(originalBody.request_id,state.actors.steward);assert.equal(receipt.state,'committed');assert.deepEqual(receipt.result,committed);await snapshot('original-uuid-committed-receipt-resolved');});
  const staleId=state.drafts.stale.handoff_id;await open({handoff:staleId});await button('编辑完整草案').click();const staleText='合成409后保留的准确输入';await field('业务含义').fill(staleText);let staleRequest;
  hook=async route=>{if(route.request().method()!=='PATCH'||!route.request().url().endsWith('/'+staleId+'/draft'))return false;hook=null;staleRequest=route.request().postDataJSON();const latest=await readCurrent(staleId),draft=structuredClone(latest.revision.snapshot_json);draft.basis='合成第二办理会话合法更新';await state.repo.saveDraft(staleId,request({expected_revision:Number(latest.header.current_revision),draft}),state.actors.lead);return false;};
  const staleResponse=page.waitForResponse(r=>r.request().method()==='PATCH'&&r.url().endsWith('/'+staleId+'/draft'));await button('保存完整草案').click();assert.equal((await staleResponse).status(),409);await page.getByRole('heading',{name:'本次操作未完成',exact:true}).waitFor();assert.equal(await field('业务含义').inputValue(),staleText);await button('查询原请求回执').click();await page.getByText('回执状态：已拒绝，可修订后另行提交',{exact:true}).waitFor();assert.equal(await field('业务含义').inputValue(),staleText);assert.equal(await button('保存完整草案').isDisabled(),true);await dialogAction(()=>button('结束本次办理').click());
  await check('actual concurrent immutable revision causes backend 409; original text/revision/UUID stay readable and rejected stale request cannot overwrite the newer draft',async()=>{assert.equal((await readCurrent(staleId)).header.current_revision,2);save('stale-real-request.json',{request:staleRequest,receipt:await state.repo.receipt(staleRequest.request_id,state.actors.steward)});});
  const retryId=state.drafts.receipt.handoff_id;await open({handoff:retryId});await button('编辑完整草案').click();await field('业务含义').fill('合成未送达请求的原载荷安全重试');const attempts=[];
  hook=async route=>{if(route.request().method()!=='PATCH'||!route.request().url().endsWith('/'+retryId+'/draft'))return false;attempts.push(route.request().postDataJSON());if(attempts.length===1){await route.abort('failed');return true;}return false;};
  await button('保存完整草案').click();await page.getByRole('heading',{name:'本次操作未完成',exact:true}).waitFor();assert.equal((await readCurrent(retryId)).header.current_revision,1);await button('查询原请求回执').click();await button('原标识原载荷重试').waitFor();await button('原标识原载荷重试').click();await button('核定原请求已完成').waitFor();hook=null;assert.equal(attempts.length,2);assert.deepEqual(attempts[0],attempts[1]);assert.equal((await readCurrent(retryId)).header.current_revision,2);await settle();save('safe-retry-original-uuid.json',{attempts,receipt:await state.repo.receipt(attempts[0].request_id,state.actors.steward)});
  checks.push('actual unobserved transport abort allows only original UUID and immutable payload retry after server receipt query, and commits exactly one new revision');
}
async function sessionRaceScenario(){
  const handoffId=state.drafts.session.handoff_id,historyPath='/api/data-map-handoffs/'+handoffId+'/source-upgrade-assessments';
  let release,historyReady,releaseDone;const released=new Promise(resolve=>{release=resolve;}),ready=new Promise(resolve=>{historyReady=resolve;}),done=new Promise(resolve=>{releaseDone=resolve;});
  const held=[],fetches=[];let accepting=true,remaining=0;
  hook=async route=>{
    const url=new URL(route.request().url());if(!accepting||route.request().method()!=='GET'||!['/api/data-map-handoffs/source-upgrades',historyPath].includes(url.pathname))return false;
    const entry={path:url.pathname,requested_at:Date.now()};held.push(entry);remaining++;let fetched;fetches.push(new Promise(resolve=>{fetched=resolve;}));
    try{const response=await route.fetch();entry.status=response.status();entry.response_cookie_sid_hash=cookieHeaderHash(response.headers()['set-cookie']);entry.fetched_at=Date.now();fetched();if(url.pathname===historyPath)historyReady();
      await released;try{await route.fulfill({response});entry.fulfilled=true;}catch(error){entry.fulfilled=false;entry.abort_observed=route.request().failure()?.errorText||null;entry.fulfill_error=error.message;}}
    catch(error){entry.fetch_error=error.message;fetched();if(url.pathname===historyPath)historyReady();await route.abort('aborted').catch(()=>{});}
    finally{entry.released_at=Date.now();remaining--;if(!remaining)releaseDone();}return true;
  };
  try{
    await open({handoff:handoffId});await within(ready,15000,'Old Q9 history read did not enter the controlled delay');accepting=false;await within(Promise.all(fetches),15000,'Old Q9 response bodies were not captured');assert(held.some(x=>x.path==='/api/data-map-handoffs/source-upgrades'));assert(held.some(x=>x.path===historyPath));assert(held.every(x=>x.status===200&&x.fetched_at&&x.response_cookie_sid_hash&&!x.fetch_error),'controlled delay must retain real successful old rolling-cookie responses');
    const newHistory=page.waitForResponse(response=>new URL(response.url()).pathname===historyPath&&response.status()===200);
    await logout();await login('steward');await newHistory;await page.waitForFunction(()=>document.querySelector('.handoff-heading button')&&!document.querySelector('.handoff-heading button').disabled);
    const before=(await context.cookies()).map(x=>({name:x.name,sid_hash:sessionCookieHash(x.value)}));release();await within(done,15000,'Delayed old Q9 requests did not settle');hook=null;
    const after=(await context.cookies()).map(x=>({name:x.name,sid_hash:sessionCookieHash(x.value)}));const sessions=(await pool.execute("SELECT sid_hash,JSON_UNQUOTE(JSON_EXTRACT(session_json,'$.personId')) person_id FROM mdm_http_sessions"))[0];save('delayed-old-session-response.json',{held,before_release:before,after_release:after,sessions});
    assert.deepEqual(after,before,'delayed old-generation read response must not replace the newly logged-in session cookie');
    await button('查看最新记录').click();await page.waitForFunction(()=>document.querySelector('.handoff-heading button')&&!document.querySelector('.handoff-heading button').disabled);assert.equal(await page.getByRole('heading',{name:'请重新登录',exact:true}).count(),0);assert((await page.locator('body').innerText()).includes('合成承接经办人'));await snapshot('old-generation-response-aborted-after-relogin');checks.push('deterministically delayed Q9 read responses across logout/new login cannot overwrite the new actual session cookie or cause a subsequent protected read to expire');
  }finally{accepting=false;release();hook=null;}
}

async function main(){
 try{
  await withWorkspaceFixture(async value=>{
   ({state,pool,fixture}=value);raw=value.request;owned={owner:value.owner,...JSON.parse(fs.readFileSync(path.join(output,'fixture/owned-target.json'),'utf8'))};
   save('fixture-prerequisites.json',{prerequisites:state.prerequisites,drafts:state.drafts,upgrade:{source:state.upgrade.source,created:state.upgrade.created.draft},ui_exercised:false});
   try{
   browserServer=await runtime().chromium.launchServer({channel:'msedge',headless:true});browser=await runtime().chromium.connect(browserServer.wsEndpoint());save('browser-owner.json',{runner_pid:process.pid,browser_pid:browserServer.process().pid,owned:true});
   context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1,reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(15000);
   page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});page.on('requestfailed',r=>networkFailures.push({method:r.method(),url:new URL(r.url()).pathname,failure:r.failure()?.errorText}));
   page.on('response',async response=>{const receivedAt=Date.now();try{const url=new URL(response.url());if(url.pathname.startsWith('/api/')){const req=response.request(),body=req.postDataJSON();let data;try{data=await response.json();}catch{}const [headers,requestHeaders]=await Promise.all([response.allHeaders(),req.allHeaders()]);exchanges.push({received_at:receivedAt,method:req.method(),url:url.pathname+url.search,status:response.status(),code:data?.code||null,request_id:body?.request_id||null,request_cookie_sid_hash:cookieHeaderHash(requestHeaders.cookie),response_cookie_sid_hash:cookieHeaderHash(headers['set-cookie']),...(response.status()>=400?{error_body:data}:{}),...(req.method()==='POST'||req.method()==='PATCH'?{body:url.pathname==='/api/org/login'?{loginName:body?.loginName,password:'[synthetic omitted]'}:body}:{}),...(data?.request_id?{result:data}:{})});}}catch(error){networkFailures.push({event:'response_observation',message:error.message});}});
   await page.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==fixture.baseURL){externalRequests.push(url.href);return route.abort('blockedbyclient');}if(hook&&await hook(route))return;await route.continue();});
   await page.goto(fixture.baseURL+'/app/data-map-handoffs');await page.getByRole('heading',{name:'登录 MDM 平台',exact:true}).waitFor();await login('lead');await page.locator('.data-map-handoffs').waitFor();
   await check('actual Microsoft Edge built workspace uses the required desktop geometry and authenticated server',async()=>{await snapshot('authenticated-workspace');assert.equal((await pool.execute('SELECT DATABASE() name'))[0][0].name,owned.database);const term=await raw('lead','/api/terminology-governance/capabilities'),handoff=await raw('lead','/api/data-map-handoffs/capabilities'),governance=await raw('lead','/api/process-data-governance/status');assert.equal(term.status,200);assert.equal(term.body.enabled,false);assert.equal(handoff.body.enabled,true);assert.equal(governance.body.enabled,true);save('fixture-flags.json',{terminology_enabled:term.body.enabled,handoff_enabled:handoff.body.enabled,work_package_enabled:governance.body.enabled,candidate_root:candidateRoot?path.resolve(candidateRoot):null,formal_database_connected:false});});
   if(scenario==='permissions'||scenario==='all')await discoveryPreflight();
   if(scenario==='permissions'||scenario==='all')await permissionScenario();
   if(scenario==='editing'||scenario==='all')await editingScenario();
   if(scenario==='q6'||scenario==='all')await q6Scenario();
   if(scenario==='upgrade'||scenario==='all')await upgradeScenario();
   if(scenario==='withdrawal'||scenario==='all')await withdrawalScenario();
   if(scenario==='protection'||scenario==='all'){await sessionRaceScenario();await protectionScenario();}
   if(scenario==='legacy'||scenario==='all')await legacyScenario();
   if(scenario==='session-race')await sessionRaceScenario();
   if(scenario==='inspect')await snapshot('workspace-inspection');
   assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(buildFiles(dist),build);
   const unexpected=consoleErrors.filter(text=>!/^Failed to load resource: (the server responded with a status of (401|403|409|422|503)|net::ERR_FAILED)/u.test(text));assert.deepEqual(unexpected,[]);
   }catch(error){await captureFailure();throw error;}finally{await closeOwnedBrowser();}
  },{frontendDist:dist,...(candidateRoot?{candidateRoot:path.resolve(candidateRoot),beforeStart:async target=>require('./testHelpers/prepareReviewFoundation')(target.pool)}:{}),testNodePath:path.join(root,'artifacts/mdm-data-governance-handoff-implementation-20261020-01/test-dependencies/node_modules'),evidenceDir:path.join(output,'fixture')});
  owned.cleaned=true;passed=true;
 }catch(error){failure={message:error.message,stack:error.stack,...(error.cause?{cause:{code:error.cause.code||null,message:error.cause.message}}:{})};await captureFailure();}
 finally{
  await closeOwnedBrowser();
  save('requests.json',exchanges);save('results.json',{passed,scenario,checks,check_count:checks.length,owned,build,sources_at_launch:sourceFiles,viewport:{width:1699,height:828,device_scale_factor:1,visual_viewport_scale:1,browser:'Microsoft Edge',channel:'msedge'},screenshots,geometry,dialogs,page_errors:pageErrors,console_errors:consoleErrors,external_requests:externalRequests,network_failures:networkFailures,real_mysql:true,synthetic_api:false,manual_ime_accepted:false,business_accepted:false,formal_database_connected:false,formal_migration:false,deployed:false,feature_activation:false,cleanup:{browser_main_process_exited:!browserServer||browserServer.process().exitCode!==null||browserServer.process().signalCode!==null},failure});
  console.log(JSON.stringify({passed,check_count:checks.length,output}));
 }
 if(!passed)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
