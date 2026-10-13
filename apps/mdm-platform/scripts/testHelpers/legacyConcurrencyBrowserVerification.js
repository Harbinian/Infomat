// Desktop Edge only; HTTP failure injection is distinguished from actual backend writes.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
module.exports=async ({fixture,pool,expect,request,workbook,context,output,checks})=>{
 const browser=await runtime().chromium.launch({channel:'msedge',headless:true});
 const ctx=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1}),page=await ctx.newPage();page.setDefaultTimeout(10000);
 const errors=[],consoleErrors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
 const button=name=>page.getByRole('button',{name,exact:true});
 const termsReady=()=>page.locator('[data-terms-ready]').waitFor();
 const dataReady=()=>page.locator('[data-map-state="ready"]').waitFor();
 async function login(who){await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await button('退出登录').waitFor();}
 async function cancel(){page.once('dialog',d=>d.accept());await button('取消本次办理').click();}
 async function capture(name){assert.equal(await page.evaluate(()=>visualViewport.scale),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
 try {
  const term=await expect('contact','/api/terminology','POST',{term:'SYNTHETIC_BROWSER_TERM',term_type_code:'noun',definition:'browser original',process_id:501});
  await page.goto(fixture.baseURL+'/app/terms');await login('contact');await termsReady();await button('查看术语 '+term.id).click();await button('修改术语').click();await page.getByLabel('定义',{exact:true}).fill('保留的中文修改输入');
  // Return the old frontend GET while another real API commits after that GET.
  // This proves the POST transaction, rather than GET-before-write, rejects the loser.
  await page.route('**/api/terminology',async route=>{
   const original=await route.fetch(),rows=await original.json(),before=rows.find(t=>t.id===term.id);
   await expect('contact','/api/terminology/'+term.id,'PUT',{...before,definition:'real API winner after frontend GET',expected_token:before.write_token});
   await route.fulfill({response:original});
  },{times:1});
  const stale=page.waitForResponse(r=>r.request().method()==='PUT'&&r.url().endsWith('/api/terminology/'+term.id));await button('确认提交').click();assert.equal((await stale).status(),409);
  await page.getByText('原记录已变化，当前输入保留',{exact:true}).waitFor();assert.equal(await page.getByLabel('定义',{exact:true}).inputValue(),'保留的中文修改输入');assert.equal(await button('确认提交').isDisabled(),true);
  await button('刷新术语').click();await termsReady();assert.equal(await page.getByLabel('定义',{exact:true}).inputValue(),'保留的中文修改输入');
  page.once('dialog',d=>d.dismiss());await page.getByRole('link',{name:'冲突管理',exact:true}).first().click();assert.match(page.url(),/app\/terms/);
  await capture('term-cas-desktop');checks.push('Edge real POST 409 after old GET race keeps original token and Chinese input; refresh/cancelled leave safe');await cancel();
  await pool.execute("INSERT INTO mdm_term_conflicts(id,term,dept_a,dept_b,severity,status) VALUES(602,'SYNTHETIC_BROWSER_CONFLICT',91,92,'error','pending')");
  await button('退出登录').click();await login('lead');await page.getByRole('link',{name:'冲突管理',exact:true}).first().click();await button('查看冲突 term-602').click();await page.locator('[data-conflict-detail]').waitFor();
  const before=await expect('lead','/api/conflicts/602?type=term','GET');await button('指定责任人').click();await page.getByLabel('冲突处理人',{exact:true}).selectOption('85');
  await page.route('**/api/conflicts/602/assign?type=term',async route=>{const body=route.request().postDataJSON();assert.equal(body.expected_token,before.write_token);network.push({kind:'conflict_original_token',bound:true});await expect('lead','/api/conflicts/602/assign?type=term','POST',{assignee_user_id:85,expected_token:before.write_token});await route.continue();},{times:1});
  const conflictResponse=page.waitForResponse(r=>r.request().method()==='POST'&&r.url().includes('/602/assign'));await button('确认提交').click();assert.equal((await conflictResponse).status(),409);
  await page.getByText('原记录已变化，当前输入保留',{exact:true}).waitFor();assert.equal(await page.getByLabel('冲突处理人',{exact:true}).inputValue(),'85');assert.equal((await expect('lead','/api/conflicts/602?type=term','GET')).assignmentHistory.length,1);
  await capture('conflict-cas-desktop');checks.push('Edge conflict original token rejects concurrent assignment with input retained and one history');await cancel();await button('退出登录').click();await login('contact');
  await page.getByRole('link',{name:'数据地图台账',exact:true}).first().click();await dataReady();
  const target=await expect('contact','/api/data-map/contexts','POST',{title:'合成丢回执浏览器范围',dept_id:91},201);
  await button('刷新数据地图').click();await dataReady();await page.getByLabel('数据地图上下文',{exact:true}).selectOption(String(target.id));await dataReady();
  const file=await workbook([['BROWSER_LOST','note','BROWSER_LOST','browser_lost']]);
  await page.getByLabel('字段台账 Excel',{exact:true}).setInputFiles({name:'合成原文件.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:file});
  let originalRequest;
  await page.route('**/api/import/field-entries',async route=>{const r=await route.fetch();assert.equal(r.status(),200);const body=await r.json();originalRequest=body.receipt.request_id;network.push({kind:'actual_commit_response_dropped',receipt:body.receipt});await route.abort('failed');},{times:1});
  await button('导入字段台账').click();await page.locator('[data-field-import-error]').waitFor();assert.equal(await button('导入字段台账').isDisabled(),true);assert.equal(await button('选择字段台账文件').isDisabled(),true);assert.match(await page.locator('[data-field-import-file]').innerText(),/合成原文件/);
  assert.equal((await pool.query('SELECT * FROM data_map_import_batches WHERE context_id=?',[target.id]))[0].length,1);
  // A denied manual lookup must not erase the previous unknown commit.
  await page.route('**/api/import/field-entries',r=>r.fulfill({status:403,json:{error:'synthetic denied'}}),{times:1});page.once('dialog',d=>d.accept());await button('按原导入请求核对结果').click();await page.locator('[data-field-import-error]').waitFor();assert.equal(await button('选择字段台账文件').isDisabled(),true);assert.match(await page.locator('.input-notice').innerText(),new RegExp(originalRequest));
  await page.route('**/api/data-map/contexts',r=>r.fulfill({status:401,json:{code:'SESSION_AUTHORIZATION_CHANGED'}}),{times:1});await button('刷新数据地图').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('adminMulti');await dataReady();
  await page.getByText(/原导入请求仍绑定身份 83:91/).waitFor();assert.equal(await button('按原导入请求核对结果').count(),0);assert.equal(await page.locator('[data-field-import-file]').count(),0);
  await page.route('**/api/data-map/contexts',r=>r.fulfill({status:401,json:{code:'SESSION_AUTHORIZATION_CHANGED'}}),{times:1});await button('刷新数据地图').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('contact');await dataReady();
  if(String(await page.getByLabel('数据地图上下文',{exact:true}).inputValue())!==String(target.id)){await page.getByLabel('数据地图上下文',{exact:true}).selectOption(String(target.id));await dataReady();}
  await capture('import-unknown-desktop');
  await page.route('**/api/import/field-entries',async route=>{const r=await route.fetch(),body=await r.json();assert.equal(body.receipt.request_id,originalRequest);assert.equal(body.receipt.replayed,true);network.push({kind:'manual_same_request',receipt:body.receipt});await route.fulfill({response:r});},{times:1});
  page.once('dialog',d=>d.accept());await button('按原导入请求核对结果').click();await page.getByText('已导入 1 行',{exact:false}).waitFor();assert.equal((await pool.query('SELECT * FROM data_map_fields WHERE context_id=?',[target.id]))[0].length,1);assert.equal((await pool.query('SELECT * FROM data_map_import_batches WHERE context_id=?',[target.id]))[0].length,1);
  await capture('import-receipt-desktop');assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
  checks.push('Edge actual import committed then response dropped; file/request/identity frozen, 403 + identity replacement preserve uncertainty, explicit original POST returns receipt without duplicate');
  assert.deepEqual(errors,[]);const unexpected=consoleErrors.filter(m=>!/Failed to load resource|net::ERR_/.test(m));assert.deepEqual(unexpected,[]);
  fs.writeFileSync(path.join(output,'browser.json'),JSON.stringify({viewport:{width:1699,height:828},zoom:1,browser:'Microsoft Edge',errors,unexpectedConsole:unexpected,network,identityExpiry:'HTTP injection; backend real identity-wait tests separate'},null,2));
 }catch(e){fs.writeFileSync(path.join(output,'browser-failure.json'),JSON.stringify({message:e.message,stack:e.stack,errors},null,2));await page.screenshot({path:path.join(output,'browser-failure.png'),fullPage:true}).catch(()=>{});throw e;}
 finally{await browser.close();}
};
