// Owned Edge continuation using real API; only failure responses are explicitly injected.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
module.exports=async({fixture,run,issueId,findingId,test,save,output,state})=>{
  let browser,server;const contexts=[],errors=[],consoleErrors=[];
  const wait=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('CLOSURE_BROWSER_TIMEOUT');};
  try {
    let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}
    const net=require('node:net');let port;for(let i=0;i<20;i++){const listener=net.createServer(),p=crypto.randomInt(42000,49000);if(await new Promise(r=>{listener.once('error',()=>r(false));listener.listen(p,'127.0.0.1',()=>r(true));})){await new Promise(r=>listener.close(r));port=p;break;}}
    assert(port);server=await pw.chromium.launchServer({channel:'msedge',headless:true,host:'127.0.0.1',port});browser=await pw.chromium.connect(server.wsEndpoint());
    async function login(who){const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});await page.goto(fixture.baseURL+`/app/analysis#run=${run.run_id}&finding=${findingId}`);await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#login-name').waitFor({state:'hidden'});return page;}
    const owner=await login('contact');let reviewer;
    const button=(p,name)=>p.getByRole('button',{name,exact:true}),label=(p,name)=>p.getByLabel(name,{exact:true});
    await button(owner,'查看复核与关闭').click();await label(owner,'复核人员').waitFor();
    await test('Edge owner designation protects input on return refresh auth and failed writes at desktop/mobile sizes',async()=>{
      await label(owner,'复核人员').selectOption('82');await label(owner,'关闭条件').fill('浏览器逐项核对接收条件');const reason='合成负责人本人确认关闭条件；保留输入直到明确提交。'.repeat(8);await label(owner,'复核决定依据').fill(reason);
      let dialog=owner.waitForEvent('dialog'),action=button(owner,'返回原筛选位置').click();await(await dialog).dismiss();await action;assert.equal(await label(owner,'复核决定依据').inputValue(),reason);
      dialog=owner.waitForEvent('dialog');action=owner.reload().catch(()=>{});await(await dialog).dismiss();await action;assert.equal(await label(owner,'复核决定依据').inputValue(),reason);
      const url=`**/api/analysis/issues/${issueId}/review`;
      for(const status of [403,409,503,0]){await owner.route(url,r=>status?r.fulfill({status,contentType:'application/json',body:'{"error":"合成失败"}'}):r.abort());await button(owner,'确认指定与关闭条件').click();await wait(async()=>!(await button(owner,'确认指定与关闭条件').isDisabled()));assert.equal(await label(owner,'复核决定依据').inputValue(),reason);await owner.unroute(url);}
      await owner.route(url,r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"合成失效"}'}));await button(owner,'确认指定与关闭条件').click();await owner.locator('#login-name').waitFor();await owner.unroute(url);await owner.locator('#login-name').fill('SYNTHETIC_contact');await owner.locator('#login-password').fill(fixture.loginPassword);await button(owner,'登录').click();await button(owner,'查看复核与关闭').click();await label(owner,'复核决定依据').waitFor();assert.equal(await label(owner,'复核决定依据').inputValue(),reason);
      for(const[width,height,name]of[[1699,828,'desktop'],[390,844,'mobile']]){await owner.setViewportSize({width,height});await label(owner,'复核决定依据').focus();assert(await label(owner,'复核决定依据').evaluate(e=>e===document.activeElement));assert.equal(await owner.evaluate(()=>visualViewport.scale),1);assert(await owner.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await owner.getByLabel('问题复核与关闭',{exact:true}).screenshot({path:path.join(output,`p17-closure-${name}-owner.png`)});}
      await button(owner,'确认指定与关闭条件').click();await wait(async()=>(await state()).assignment.conditions[0].text==='浏览器逐项核对接收条件');
    });
    await test('Edge designated reviewer rejects then explicitly checks fixed completion evidence and closes',async()=>{
      reviewer=await login('lead');
      await reviewer.goto(fixture.baseURL+'/#/roleWorkbench');
      await reviewer.getByRole('button',{name:'复核问题',exact:true}).first().click();
      await reviewer.waitForURL('**/app/analysis#run='+run.run_id+'&finding='+findingId);
      await button(reviewer,'查看复核与关闭').click();await label(reviewer,'条件 1 依据').fill('尚需核对完整接收条件');await label(reviewer,'复核决定依据').fill('复核不通过，请补充说明');await button(reviewer,'提交逐项复核').click();await wait(async()=>(await state()).events.at(-1).action==='reject');assert.equal((await state()).status,'waiting_my_action');
      await wait(async()=>(await label(reviewer,'复核决定依据').inputValue())==='');
      await label(reviewer,'条件 1 已满足').check();await label(reviewer,'条件 1 依据').fill('已重新核对办理结果摘录与固定来源');const s=await state(),t=s.tasks.filter(t=>t.status==='done'&&t.completion).at(-1);await label(reviewer,'条件 1 办理证据').selectOption(t.todo_id);await label(reviewer,'复核决定依据').fill('所有条件逐项满足，确认关闭');
      for(const[width,height,name]of[[1699,828,'desktop'],[390,844,'mobile']]){await reviewer.setViewportSize({width,height});assert(await reviewer.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await reviewer.getByLabel('问题复核与关闭',{exact:true}).screenshot({path:path.join(output,`p17-closure-${name}-review.png`)});}
      await button(reviewer,'提交逐项复核').click();await wait(async()=>(await state()).status==='closed');await reviewer.getByTestId('closure-status').filter({hasText:'问题已关闭'}).waitFor();
    });
    await test('Edge owner reopens with new evidence and renewed explicit appointment preserving prior close',async()=>{
      await button(owner,'查看复核与关闭').click();await label(owner,'重开证据').waitFor();await label(owner,'复核人员').selectOption('82');await label(owner,'关闭条件').fill('重新核对新增接收证据');await label(owner,'重开证据').fill('合成新增证据 B-03，原依据失效');await label(owner,'复核决定依据').fill('负责人本人确认重新打开');await button(owner,'确认重新打开').click();await wait(async()=>(await state()).events.at(-1).action==='reopen');assert.equal((await state()).status,'waiting_my_action');assert((await state()).events.some(e=>e.action==='close'));
      assert.equal(new URL(owner.url()).hash,`#run=${run.run_id}&finding=${findingId}`);await owner.getByLabel('问题复核与关闭',{exact:true}).screenshot({path:path.join(output,'p17-closure-reopened.png')});
    });
    assert.deepEqual(errors,[]);assert(consoleErrors.every(e=>/Failed to load resource:.*(401|403|409|503|ERR_FAILED)/.test(e)),consoleErrors.join('\n'));save('p17-closure-browser.json',{passed:true,page_errors:errors,expected_injected_console_errors:consoleErrors,viewports:['1699x828','390x844'],zoom:1,real_api_close_reopen:true,human_acceptance:false});
  }catch(error){
    for(let i=0;i<contexts.length;i++){const page=contexts[i].pages()[0];if(page&&!page.isClosed()){await page.screenshot({path:path.join(output,`p17-closure-failure-${i}.png`)}).catch(()=>{});save(`p17-closure-failure-${i}.json`,{message:error.message,url:page.url(),body:await page.locator('body').innerText().catch(()=>''),page_errors:errors});}}
    throw error;
  }finally{
    let forced=false;const timer=setTimeout(()=>{forced=true;if(server&&process.platform==='win32'){const pid=server.process().pid;const script=`$owned = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($owned -and $owned.ParentProcessId -eq ${process.pid} -and $owned.Name -eq 'msedge.exe' -and $owned.CommandLine -like '*playwright_chromiumdev_profile-*') { $result = Invoke-CimMethod -InputObject $owned -MethodName Terminate; if ($result.ReturnValue -ne 0) { exit 1 } }`;try{require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,stdio:'ignore'});}catch{}}server?.kill().catch(()=>{});},10000);
    try{for(const c of contexts)await c.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close();}finally{clearTimeout(timer);}save('p17-closure-cleanup.json',{browser_closed:!browser||!browser.isConnected(),owned_browser_forced_shutdown:forced});
  }
};
