// Run: node apps/mdm-platform/scripts/test-native-governance-receipts-browser-session.js
// Optional input: --dist <candidate build inside artifacts> --output <new -02 directory>.
// Output: JSON requests/results, source/build hashes and screenshots in session-browser-UUID.
// Side effects: one owned random loopback static HTTP server and one owned Edge process,
// closed in finally. Serves an existing build without rebuilding or editing it; API and
// identities are synthetic. No MySQL, real service, private configuration or feature flag.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {randomUUID,createHash} = require('node:crypto');
const repository=path.resolve(__dirname,'../../..'),artifacts=path.join(repository,'artifacts');
const evidenceRoot=path.join(artifacts,'mdm-data-governance-handoff-implementation-20261020-02');
function argument(name,fallback){const i=process.argv.indexOf(name);return i<0?fallback:path.resolve(process.argv[i+1]||'');}
const dist=argument('--dist',path.join(evidenceRoot,'frontend-build'));
const output=argument('--output',path.join(evidenceRoot,'session-browser-'+randomUUID()));
assert.ok(dist.startsWith(artifacts+path.sep),'only explicit candidate builds under artifacts');
assert.ok(fs.existsSync(path.join(dist,'index.html')),'candidate build must exist');
assert.ok(output.startsWith(evidenceRoot+path.sep),'keep new evidence inside this increment');
assert.ok(!fs.existsSync(output),'preserve previous evidence');fs.mkdirSync(output,{recursive:true});
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
const root='/api/process-data-governance',basis='原身份专属的合成审核依据：此输入不能向其他人员或部门展示。';
const users={
  SYNTHETIC_A:{personId:'41',departmentId:'91',personName:'合成原办理人',departmentName:'合成甲部',employeeNo:'SYNTHETIC_A',permissions:['governance:read-global','governance:approve'],roleCodes:['mdm_group_leader']},
  SYNTHETIC_B:{personId:'42',departmentId:'92',personName:'合成另一人员',departmentName:'合成乙部',employeeNo:'SYNTHETIC_B',permissions:['governance:read-global','governance:approve'],roleCodes:['mdm_group_leader']},
  SYNTHETIC_C:{personId:'41',departmentId:'92',personName:'合成原人员其他部门',departmentName:'合成乙部',employeeNo:'SYNTHETIC_C',permissions:['governance:read-global','governance:approve'],roleCodes:['mdm_group_leader']}
};
let owner='SYNTHETIC_A',authenticated=true,expireNext=false,originalId;
const requests=[],checks=[],screenshots=[],pageErrors=[],consoleErrors=[],externalRequests=[];
function packageData(){return {package:{id:'100',process_version_id:'200',source_content_hash:'synthetic-fixed-digest',rule_version:'v7-deterministic-v4',revision_no:1,status:'mdm_review',process_name:'合成跨会话回执工作包',owning_department_name:'合成甲部'},details:[],fact_requests:[],source_version:{document_no:'SYNTHETIC-200',document_title:'合成固定流程',schema_version:'process-governance-v8'},allowed_actions:['complete_work_package'],reviews:[],events:[]};}
async function send(route,value,status=200){await route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});}
async function api(route){
  const request=route.request(),url=new URL(request.url()),pathname=url.pathname,method=request.method(),body=request.postData()?request.postDataJSON():null;
  requests.push({method,path:pathname+url.search,owner,body:body?.password?{...body,password:'[synthetic omitted]'}:body});
  if(pathname==='/api/org/session')return send(route,{authenticated});
  if(pathname==='/api/org/me')return send(route,users[owner]);
  if(pathname==='/api/org/me/password-status')return send(route,{is_default_password:false});
  if(pathname==='/api/org/login'){
    assert.ok(users[body.loginName]);owner=body.loginName;authenticated=true;return send(route,{ok:true});
  }
  if(pathname==='/api/org/logout'){authenticated=false;return send(route,{ok:true});}
  if(pathname==='/api/csrf-token')return send(route,{csrfToken:'synthetic-csrf'});
  if(pathname===root+'/status'){
    if(expireNext){expireNext=false;authenticated=false;return send(route,{code:'SESSION_AUTHORIZATION_CHANGED',error:'Synthetic session expiry'},401);}
    assert.equal(owner,'SYNTHETIC_A','blocked owner must not mount DataGovernance');return send(route,{enabled:true,read_only:false});
  }
  if(pathname===root+'/workbench')return send(route,{allowed_actions:[],published_versions:[],work_packages:[],fact_requests:[],work_items:[]});
  if(pathname===root+'/work-packages/100'&&method==='GET')return send(route,packageData());
  if(pathname===root+'/work-packages/100/complete'&&method==='POST'){
    assert.equal(owner,'SYNTHETIC_A');assert.equal(body.basis,basis);assert.equal(body.expected_revision,1);
    assert.match(body.request_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(originalId,undefined,'cross-session recovery must never create or resend a write');originalId=body.request_id;
    return send(route,{code:'HANDOFF_COMMIT_UNKNOWN',error:'Synthetic acknowledgement loss'},503);
  }
  if(pathname==='/api/data-map-handoffs/requests/'+originalId){assert.equal(owner,'SYNTHETIC_A');assert.equal(method,'GET');return send(route,{request_id:originalId,state:'committed',result:{request_id:originalId,business_outcome:'native_review_bound_pending_generation'}});}
  if(pathname==='/api/governance-responsibilities/work-packages/100')return send(route,{target_type:'work_package',target_id:'100',source_revision:1,source_hash:'synthetic-fixed-digest',allowed_actions:[],assignments:{},history:[],work_records:[]});
  if(pathname==='/api/terminology-governance/usages')return send(route,{enabled:false});
  throw new Error('Unexpected synthetic API '+method+' '+pathname);
}
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function buildFiles(directory){return fs.readdirSync(directory,{withFileTypes:true}).flatMap(item=>{const full=path.join(directory,item.name);return item.isDirectory()?item.name==='.vite'?[]:buildFiles(full):[{path:path.relative(dist,full).replaceAll('\\','/'),sha256:hash(full),bytes:fs.statSync(full).size}];});}
async function main(){
  let server,browserServer,browser,context,page,failure;
  const buildSnapshot=buildFiles(dist);
  try{
    const index=fs.readFileSync(path.join(dist,'index.html'),'utf8'),entry=index.match(/src="(\/app\/assets\/[^"]+\.js)"/);
    assert.ok(entry,'serve the actual built main entry');
    assert.ok(fs.readFileSync(path.join(dist,entry[1].replace('/app/','')),'utf8').includes('原身份的请求尚待核对'),'candidate must contain owner retention fix');
    const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.wasm':'application/wasm'};
    server=http.createServer((request,response)=>{
      const url=new URL(request.url,'http://127.0.0.1');let file;
      if(url.pathname==='/logo.png')file=path.join(repository,'apps/mdm-platform/public/logo.png');
      else if(url.pathname.startsWith('/app/assets/')){file=path.resolve(dist,'.'+decodeURIComponent(url.pathname.slice(4)));if(!file.startsWith(dist+path.sep)){response.writeHead(403);return response.end();}}
      else if(url.pathname.startsWith('/app/'))file=path.join(dist,'index.html');
      else{response.writeHead(404);return response.end();}
      try{response.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});response.end(fs.readFileSync(file));}catch{response.writeHead(404);response.end();}
    });
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const address=server.address();assert.equal(address.address,'127.0.0.1');assert.ok(![3000,3001,5173].includes(address.port));
    const base='http://127.0.0.1:'+address.port;fs.writeFileSync(path.join(output,'server-owner.json'),JSON.stringify({runner_pid:process.pid,address:address.address,port:address.port,owned:true},null,2));
    browserServer=await runtime().chromium.launchServer({channel:'msedge',headless:true});browser=await runtime().chromium.connect(browserServer.wsEndpoint());
    fs.writeFileSync(path.join(output,'browser-owner.json'),JSON.stringify({runner_pid:process.pid,browser_pid:browserServer.process().pid,owned:true},null,2));
    context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1,reducedMotion:'reduce'});page=await context.newPage();page.setDefaultTimeout(12000);
    page.on('pageerror',error=>pageErrors.push(error.message));page.on('console',message=>{if(message.type()==='error')consoleErrors.push(message.text());});
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url());if(url.origin!==base){externalRequests.push(url.href);return route.abort('blockedbyclient');}
      if(url.pathname.startsWith('/api/')){try{await api(route);}catch(error){pageErrors.push(error.stack||error.message);await send(route,{error:error.message},500);}}else await route.continue();
    });
    const button=name=>page.getByRole('button',{name,exact:true}),field=name=>page.getByLabel(name,{exact:true});
    async function idle(){await button('刷新工作包状态').waitFor();await page.waitForFunction(()=>![...document.querySelectorAll('button')].find(button=>button.textContent==='刷新工作包状态')?.disabled);}
    async function capture(name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.deepEqual(await page.evaluate(()=>({width:innerWidth,height:innerHeight})),{width:1699,height:828});const editor=page.locator('.data-governance > .preview-editor');if(await editor.count())await editor.scrollIntoViewIfNeeded();await page.screenshot({path:path.join(output,name+'.png'),fullPage:false});screenshots.push(name+'.png');fs.writeFileSync(path.join(output,name+'.txt'),await page.locator('body').innerText());}
    async function login(name){await page.locator('#login-name').fill(name);await page.locator('#login-password').fill('synthetic-test-only');await button('登录').click();await button('退出登录').waitFor();}
    async function noPersistentInput(){const storage=await page.evaluate(()=>JSON.stringify({local:{...localStorage},session:{...sessionStorage}}));assert.equal(storage.includes(basis),false);assert.equal(storage.includes(originalId),false);}
    await page.goto(base+'/app/data-governance?package=100');await idle();await button('完成工作包审核').click();await field('完成审核依据').fill(basis);await button('确认提交本次操作').click();await button('查询原请求回执').waitFor();await page.getByText('操作未完成',{exact:true}).waitFor();assert.equal(await field('完成审核依据').inputValue(),basis);assert.equal(await field('完成审核依据').isDisabled(),true);await capture('original-owner-unknown');
    checks.push('actual built main shell retains native review input and UUID after synthetic 503');
    expireNext=true;await button('刷新工作包状态').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();assert.equal(await page.locator('.data-governance').count(),0);assert.equal((await page.locator('body').textContent()).includes(basis),false);await capture('expired-login-no-input');
    checks.push('401 unmounts DataGovernance and moves to actual login without rendering retained business input');
    for(const next of ['SYNTHETIC_B','SYNTHETIC_C']){
      const before=requests.length;await login(next);await page.getByText('原身份的请求尚待核对',{exact:true}).waitFor();
      assert.equal(await page.locator('.data-governance').count(),0);assert.equal(await field('完成审核依据').count(),0);assert.equal(await button('查询原请求回执').count(),0);
      const text=await page.locator('body').textContent();assert.equal(text.includes(basis),false);assert.equal(text.includes(originalId),false);
      assert.equal(requests.slice(before).some(request=>request.path.startsWith(root)||request.path.startsWith('/api/data-map-handoffs/requests/')),false,'another owner must not load original workbench or receipts');await noPersistentInput();await capture(next==='SYNTHETIC_B'?'different-person-blocked':'different-department-blocked');
      page.once('dialog',dialog=>dialog.accept());await button('退出登录').click();await page.getByRole('heading',{name:'登录 MDM 平台',exact:true}).waitFor();
    }
    checks.push('different person and same-person different-department identities see only the ownership block, without original UUID/body or DataGovernance API reads');
    await login('SYNTHETIC_A');await idle();await field('完成审核依据').waitFor();assert.equal(await field('完成审核依据').inputValue(),basis);assert.equal(await field('完成审核依据').isDisabled(),true);await page.getByText(originalId,{exact:true}).waitFor();assert.equal(requests.filter(request=>request.path.endsWith('/complete')).length,1);await capture('original-owner-restored');
    checks.push('explicit logout and login as original owner restore identical input and UUID without a second write');
    const beforeQuery=requests.filter(request=>request.method==='POST'&&request.path.endsWith('/complete')).length;await button('查询原请求回执').click();await page.getByText('已查到本次操作的成功回执。请核对后确认结束本次输入。',{exact:true}).waitFor();assert.equal(await field('完成审核依据').inputValue(),basis);assert.equal(requests.filter(request=>request.method==='POST'&&request.path.endsWith('/complete')).length,beforeQuery);await capture('original-owner-committed-awaiting-confirmation');
    await button('确认结果并结束本次输入').click();await idle();assert.equal(await field('完成审核依据').count(),0);await page.getByText('工作包审核已保存，承接草案待生成；数据地图尚未发布。',{exact:true}).waitFor();assert.equal(requests.filter(request=>request.path.endsWith('/complete')).length,1);await noPersistentInput();
    checks.push('only original owner queries committed receipt; original input remains until explicit confirmation and no replay POST occurs');
    assert.deepEqual(pageErrors,[]);assert.deepEqual(externalRequests,[]);assert.deepEqual(consoleErrors.filter(text=>!/^Failed to load resource: the server responded with a status of (401|503)/.test(text)),[]);
    assert.deepEqual(buildFiles(dist),buildSnapshot,'candidate build remains untouched');
  }catch(error){failure=error;if(page){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});fs.writeFileSync(path.join(output,'failure-text.txt'),await page.locator('body').innerText().catch(()=>''));}}
  finally{
    if(context)await context.close().catch(()=>{});if(browser){let timer;await Promise.race([browser.close().catch(()=>{}),new Promise(resolve=>{timer=setTimeout(resolve,8000);})]).finally(()=>clearTimeout(timer));}if(browserServer)await browserServer.kill().catch(()=>{});if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
    const cleanup={browser_main_process_exited:!browserServer||browserServer.process().exitCode!==null||browserServer.process().signalCode!==null,server_stopped_listening:!server||!server.listening};
    if(!Object.values(cleanup).every(Boolean)&&!failure)failure=new Error('Owned resources did not fully close');
    const sourceFiles=['main.jsx','DataGovernance.jsx','nativeGovernanceRequest.js'].map(file=>({path:'apps/mdm-platform/frontend/src/'+file,sha256:hash(path.join(repository,'apps/mdm-platform/frontend/src',file))}));
    fs.writeFileSync(path.join(output,'requests.json'),JSON.stringify(requests,null,2));fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({passed:!failure,check_count:checks.length,checks,original_request_id:originalId,build:path.relative(repository,dist),build_files:buildSnapshot,sources:sourceFiles,screenshots,page_errors:pageErrors,console_errors:consoleErrors,external_requests:externalRequests,viewport:{width:1699,height:828,scale:1,browser:'Microsoft Edge'},synthetic_api:true,real_mysql:false,manual_ime_acceptance:false,cleanup,...(failure?{failure:{message:failure.message,stack:failure.stack}}:{})},null,2));console.log(JSON.stringify({passed:!failure,check_count:checks.length,output}));
  }
  if(failure)throw failure;
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1;});
