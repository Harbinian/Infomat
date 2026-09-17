// Existing browser harness conventions; owned Edge + synthetic HTTP sessions only.
const assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
module.exports=async({fixture,repo,lead,run,issueId,officeId,findingId,test,save,output})=>{
  let browser,server; const contexts=[],errors=[],consoleErrors=[];
  const wait=async fn=>{const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw Error('P17_BROWSER_WAIT_TIMEOUT');};
  try {
    let pw;try{pw=require('playwright');}catch{pw=require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}
    const net=require('node:net');let port;
    for(let i=0;i<20;i++){const listener=net.createServer(),p=crypto.randomInt(42000,49000);if(await new Promise(r=>{listener.once('error',()=>r(false));listener.listen(p,'127.0.0.1',()=>r(true));})){await new Promise(r=>listener.close(r));port=p;break;}}
    assert(port);server=await pw.chromium.launchServer({channel:'msedge',headless:true,host:'127.0.0.1',port});browser=await pw.chromium.connect(server.wsEndpoint());
    save('p17-browser-owner.json',{runner_pid:process.pid,browser_pid:server.process().pid,owned:true});
    async function login(who,url){const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});contexts.push(context);const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text());});await page.goto(fixture.baseURL+url);await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await page.getByRole('button',{name:'登录',exact:true}).click();await page.locator('#login-name').waitFor({state:'hidden'});return page;}
    const page=await login('lead',`/app/analysis#run=${run.run_id}&finding=${findingId}`);
    const button=n=>page.getByRole('button',{name:n,exact:true}),label=n=>page.getByLabel(n,{exact:true});
    await button('查看办理与交办').click();await label('承接办公室').waitFor();
    const instruction='P17浏览器合成整改：请补充明确接收条件和核验依据。'.repeat(25);
    await test('Edge dispatch draft survives navigation refusal, refresh and 401/403/409/503/network failures',async()=>{
      await label('承接办公室').selectOption(officeId);await label('办理用途').selectOption('correct');await label('必要办理说明').fill(instruction);
      let dialog=page.waitForEvent('dialog'),action=button('返回原筛选位置').click();await(await dialog).dismiss();await action;assert.equal(await label('必要办理说明').inputValue(),instruction);
      dialog=page.waitForEvent('dialog');action=page.reload().catch(()=>{});await(await dialog).dismiss();await action;assert.equal(await label('必要办理说明').inputValue(),instruction);
      const url=`**/api/analysis/issues/${issueId}/tasks`;
      for(const status of [403,409,503,0]){await page.route(url,r=>r.request().method()==='POST'?status?r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'合成失败'})}):r.abort():r.continue());await button('确认交办').click();await wait(async()=>!(await button('确认交办').isDisabled()));assert.equal(await label('必要办理说明').inputValue(),instruction);await page.unroute(url);}
      await page.route(url,r=>r.request().method()==='POST'?r.fulfill({status:401,contentType:'application/json',body:'{"error":"合成失效"}'}):r.continue());await button('确认交办').click();await page.locator('#login-name').waitFor();await page.unroute(url);
      await page.locator('#login-name').fill('SYNTHETIC_lead');await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await button('查看办理与交办').click();await label('必要办理说明').waitFor();assert.equal(await label('必要办理说明').inputValue(),instruction);
    });
    let task;
    await test('Edge desktop/mobile explicit office dispatch with no overflow and preserved return position',async()=>{
      for(const[width,height,name]of[[1699,828,'desktop'],[390,844,'mobile']]){await page.setViewportSize({width,height});assert.equal(await page.evaluate(()=>visualViewport.scale),1);await label('必要办理说明').focus();assert.equal(await label('必要办理说明').evaluate(e=>document.activeElement===e),true);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.getByLabel('问题办公室办理',{exact:true}).screenshot({path:path.join(output,`p17-${name}-dispatch.png`)});}
      await button('确认交办').click();await wait(async()=>{task=(await repo.getAnalysisIssueTasks(lead,issueId)).items.find(t=>t.purpose==='correct');return !!task;});
      await wait(async()=>(await label('必要办理说明').inputValue())==='');assert.equal(new URL(page.url()).hash,`#run=${run.run_id}&finding=${findingId}`);
    });
    const manager=await login('contact','/app');await manager.goto(fixture.baseURL+'/#/officeWorkbench?office_id='+officeId);
    let row=manager.locator('#officeTaskRows tr').filter({hasText:`问题 ${issueId} · 整改`});
    await test('Edge existing office manager assigns actual imported member',async()=>{
      await row.getByRole('button',{name:'分配人员',exact:true}).click();await manager.locator('#officeAssignee').selectOption('85');
      await manager.getByText('查看本次办理说明',{exact:true}).click();
      assert((await manager.getByLabel('问题办理上下文').innerText()).includes(instruction));await manager.locator('#officeSaveTask').click();
      await wait(async()=>(await repo.getAnalysisIssueTasks(lead,issueId)).items.find(t=>t.todo_id===task.todo_id).assignee_person_id==='85');
    });
    const member=await login('reviewB','/app');await member.goto(fixture.baseURL+'/#/officeWorkbench?office_id='+officeId);
    await test('Edge assigned member completes via existing workbench; failure retains input and issue remains open',async()=>{
      row=member.locator('#officeTaskRows tr').filter({hasText:`问题 ${issueId} · 整改`});await row.getByRole('button',{name:'填写结果并办结',exact:true}).click();
      const note='P17合成办理：已提交条件说明，仍需有权复核。'.repeat(12);await member.locator('#officeCompletionNote').fill(note);
      await member.getByRole('button',{name:'关闭窗口',exact:true}).click();await member.locator('#publicationKeepEditing').click();assert.equal(await member.locator('#officeCompletionNote').inputValue(),note);
      const url=`**/api/offices/tasks/${task.todo_id}/complete`;
      for(const status of [403,409,503]){await member.route(url,r=>r.fulfill({status,contentType:'application/json',body:JSON.stringify({error:'合成失败'})}));await member.locator('#officeSaveTask').click();await wait(async()=>!(await member.locator('#officeSaveTask').isDisabled()));assert.equal(await member.locator('#officeCompletionNote').inputValue(),note);await member.unroute(url);}
      await member.route(url,r=>r.fulfill({status:401,contentType:'application/json',body:'{"error":"合成失效"}'}));await member.locator('#officeSaveTask').click();await member.locator('#loginBox').waitFor({state:'visible'});await member.unroute(url);
      assert.equal(await member.locator('#officeCompletionNote').inputValue(),note);assert.equal(await member.locator('#publicationDialog').isVisible(),false);
      await member.locator('#employeeNo').fill('SYNTHETIC_reviewB');await member.locator('#password').fill(fixture.loginPassword);await member.locator('#loginBtn').click();await member.locator('#publicationDialog').waitFor({state:'visible'});assert.equal(await member.locator('#officeCompletionNote').inputValue(),note);
      for(const[width,height,name]of[[1699,828,'desktop'],[390,844,'mobile']]){await member.setViewportSize({width,height});await member.locator('#officeCompletionNote').focus();const geometry=await member.locator('#publicationDialog').evaluate(e=>({width:e.getBoundingClientRect().width,scroll:e.scrollWidth,client:e.clientWidth,screen:innerWidth}));assert(geometry.width<=width);assert(geometry.scroll<=geometry.client+1);await member.locator('#publicationDialog').screenshot({path:path.join(output,`p17-${name}-complete.png`)});}
      await member.locator('#officeSaveTask').click();await wait(async()=>(await repo.getAnalysisIssueTasks(lead,issueId)).items.find(t=>t.todo_id===task.todo_id).status==='done');
      assert.equal((await repo.getAnalysisIssue(lead,issueId)).issue.display_status,'waiting_my_action');
      await button('查看办理与交办').click();await page.getByText(note,{exact:true}).waitFor();await page.getByLabel('问题办公室办理',{exact:true}).screenshot({path:path.join(output,'p17-result.png')});
    });
    assert.deepEqual(errors,[]);assert(consoleErrors.every(e=>/Failed to load resource:.*(401|403|409|503|ERR_FAILED)/.test(e)),consoleErrors.join('\n'));save('p17-browser-results.json',{passed:true,page_errors:errors,expected_injected_console_errors:consoleErrors,viewports:['1699x828','390x844'],zoom:1,formal_review_executed:false,human_acceptance:false});
  } finally {
    let forced=false;
    const timer=setTimeout(()=>{forced=true;if(server&&process.platform==='win32'){const pid=server.process().pid;const script=`$owned = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($owned -and $owned.ParentProcessId -eq ${process.pid} -and $owned.Name -eq 'msedge.exe' -and $owned.CommandLine -like '*playwright_chromiumdev_profile-*') { $result = Invoke-CimMethod -InputObject $owned -MethodName Terminate; if ($result.ReturnValue -ne 0) { exit 1 } }`;try{require('node:child_process').execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,timeout:10000,stdio:'ignore'});}catch{}}server?.kill().catch(()=>{});},10000);
    try{for(const context of contexts)await context.close().catch(()=>{});await browser?.close().catch(()=>{});await server?.close();}finally{clearTimeout(timer);}
    save('p17-cleanup.json',{browser_closed:!browser||!browser.isConnected(),owned_browser_forced_shutdown:forced});
  }
};
