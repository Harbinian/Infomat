// Real desktop Edge scenario; source is imported into an independent page, never changed on disk.
async page => {
  const origin='__BASE_URL__', output='__OUTPUT_DIR__', fixture='__FIXTURE_PATH__';
  const checks=[], errors=[], remote=[], downloads=[];
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  page.on('dialog',dialog=>dialog.accept());
  await page.context().route('**/*',async route=>{const url=new URL(route.request().url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&url.origin!==origin){remote.push(url.origin+url.pathname);await route.abort();}else await route.continue();});
  await page.addInitScript(()=>{window.__checkStorageWrites=[];for(const key of ['setItem','removeItem','clear']){const original=Storage.prototype[key];Storage.prototype[key]=function(...args){window.__checkStorageWrites.push(key);return original.apply(this,args);};}const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.__checkStorageWrites.push('indexedDB.open');return open(...args);};});
  const detail=()=>page.getByRole('complementary',{name:'对象详情'});
  const drawer=()=>page.locator('.ant-drawer-open');
  const close=async()=>{await drawer().locator('.ant-drawer-close').click();await page.locator('.ant-drawer-content-wrapper:visible').waitFor({state:'hidden'});};
  const runCheck=async()=>{await page.getByRole('button',{name:'检查',exact:true}).click();await page.locator('[data-check-group="technical"]').waitFor();await page.waitForFunction(()=>{const bounds=document.querySelector('.ant-drawer-open .ant-drawer-content-wrapper')?.getBoundingClientRect();return bounds&&Math.abs(bounds.right-innerWidth)<1;});};
  const locate=async text=>{await page.locator('[data-check-group="incomplete"] .issue-item').filter({has:page.locator('p').filter({hasText:text})}).getByRole('button',{name:'定位此问题',exact:true}).click();await page.locator('.ant-drawer-content-wrapper:visible').waitFor({state:'hidden'});};
  const save=async name=>{const event=page.waitForEvent('download');await page.getByRole('button',{name:'↓ 下载草稿',exact:true}).click();const download=await event;await download.saveAs(`${output}/${name}.json`);await page.getByText('已发起本地草稿下载',{exact:true}).waitFor();downloads.push({name});await close();};
  try {
    await page.setViewportSize({width:1699,height:828});await page.goto(origin+'/workbench/',{waitUntil:'networkidle'});
    await page.locator('.busy-strip').waitFor({state:'hidden'});
    await page.getByLabel('导入文件',{exact:true}).setInputFiles(fixture);
    await page.getByRole('button',{name:'放弃未下载内容并继续',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.graph-canvas')?._cyreg?.cy.nodes().some(node=>(node.data('label')||'').includes('类型C')));
    await runCheck();
    assert(await page.getByRole('heading',{name:'技术错误 · 0 项',exact:true}).count()===1,'Technical group missing');
    assert(await page.getByRole('heading',{name:'编制缺项 · 32 项',exact:true}).count()===1,'Incomplete group/count mismatch');
    assert(await page.getByRole('heading',{name:'待确认事项 · 2 项',exact:true}).count()===1,'Confirmation group/count mismatch');
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert(viewport.width===1699&&viewport.height===828&&viewport.scale===1&&!viewport.overflow,'Edge viewport mismatch');
    await page.screenshot({path:`${output}/checks.png`,scale:'css'});
    await page.locator('[data-check-group="confirmation"]').scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/confirmation.png`,scale:'css'});
    assert(!/(?:behavior|relation|package)_[a-z0-9_]+|export_meta|flow_relations/.test(await drawer().innerText()),'Internal identities exposed');
    checks.push('three visible groups: 0 technical, 32 incomplete, 2 confirmation; no invented records');
    await close();await save('baseline');checks.push('incomplete original draft can be downloaded');
    await runCheck();await locate('流程关系2已选择“判断分支”，但判断条件为空');
    const condition=detail().getByRole('textbox',{name:'条件说明',exact:true});await condition.fill('到货类型为A');
    await page.getByRole('button',{name:'检查',exact:true}).click();await page.getByRole('dialog',{name:'先处理当前修改'}).waitFor();await page.getByRole('button',{name:'继续编辑',exact:true}).click();
    assert(await condition.inputValue()==='到货类型为A','Checking lost unapplied input');
    await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await page.getByText('检查结果已过期，请重新检查',{exact:true}).waitFor();
    await runCheck();assert(await page.getByRole('heading',{name:'编制缺项 · 31 项',exact:true}).count()===1,'Resolved condition was not reconciled');
    checks.push('condition issue locates editable field; checking guards input; applied edit invalidates old report');
    await locate('具体动作说明未写出可识别的具体业务动作');
    await detail().getByRole('textbox',{name:'具体动作说明',exact:true}).fill('核对到货清单，登记核对结果。');
    await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await page.locator('.busy-strip').waitFor({state:'hidden'});
    await runCheck();assert(await page.locator('[data-check-group="incomplete"] .issue-item .ant-tag').filter({hasText:'逐动作可执行性'}).count()===4,'Concrete action issue did not resolve');
    await locate('未填写编制人');await detail().getByRole('textbox',{name:'编制人',exact:true}).fill('测试编制人');
    await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await page.locator('.busy-strip').waitFor({state:'hidden'});await save('edited');
    checks.push('action description and compiler issues locate, apply and download');
    await page.route('**/api/validate',async route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({valid:false,errors:[{path:'/process/process_name',message:'测试：流程名称不符合结构规则'}]})}));
    await runCheck();assert(await page.getByRole('heading',{name:'技术错误 · 1 项',exact:true}).count()===1,'Technical failure was not grouped');
    await page.screenshot({path:`${output}/technical-error.png`,scale:'css'});await close();await save('technical-error');
    await page.unroute('**/api/validate');checks.push('isolated simulated technical error is visible and draft download remains available');
    const storage=await page.evaluate(()=>window.__checkStorageWrites);
    assert(!storage.length&&!remote.length&&!errors.length,'Browser storage/network/console boundary failed');
    checks.push('zero persistence writes, external requests and console/page errors');
    return {passed:true,checks,downloads,viewport,errors,remote,storage,expectedOriginalCounts:{technical:0,incomplete:32,confirmation:2}};
  } catch(error) {await page.screenshot({path:`${output}/failure.png`,scale:'css'}).catch(()=>{});return {passed:false,checks,downloads,errors,remote,error:String(error.stack||error)};}
}
