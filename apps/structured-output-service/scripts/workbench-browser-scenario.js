// Real Edge UI only; synthetic local fixture, explicit candidate URL supplied by the runner.
// Saves screenshots and actual downloaded JSON to the runner's evidence directory.
async page => {
  const checks=[], downloads=[], errors=[], remote=[], storage=[], actions=[];
  const output='__OUTPUT_DIR__', fixture='__FIXTURE_PATH__';
  const origin='__BASE_URL__';
  const assert=(condition,message)=>{if(!condition)throw new Error(message);};
  const check=(name)=>checks.push(name);
  const onError=error=>errors.push(error.message);
  const onConsole=message=>{if(message.type()==='error')errors.push(message.text());};
  page.on('pageerror',onError);page.on('console',onConsole);
  page.on('dialog',dialog=>dialog.accept());
  await page.context().route('**/*',async route=>{const url=new URL(route.request().url());if(['http:','https:','ws:','wss:'].includes(url.protocol)&&url.origin!==origin){remote.push(url.origin+url.pathname);await route.abort();}else await route.continue();});
  await page.addInitScript(()=>{
    window.__workbenchStorageWrites=[];
    for(const key of ['setItem','removeItem','clear']){const original=Storage.prototype[key];Storage.prototype[key]=function(...args){window.__workbenchStorageWrites.push(key);return original.apply(this,args);};}
    const open=indexedDB.open.bind(indexedDB);indexedDB.open=(...args)=>{window.__workbenchStorageWrites.push('indexedDB.open');return open(...args);};
  });
  const closeDrawer=async()=>{const close=page.locator('.ant-drawer-open .ant-drawer-close');if(await close.count()){await close.click();await page.locator('.ant-drawer-content-wrapper:visible').waitFor({state:'hidden'});}};
  const detail=()=>page.getByRole('complementary',{name:'对象详情'});
  const waitReady=async()=>{await page.locator('.busy-strip').waitFor({state:'hidden'});};
  const selectOption=async(label,text)=>{const input=page.getByRole('combobox',{name:label,exact:true});actions.push({label,text,before:await input.evaluate(element=>element.closest('.ant-select')?.textContent)});if(await input.evaluate((element,value)=>element.closest('.ant-select')?.textContent.includes(value),text))return;await input.locator('..').click();const listId=await input.getAttribute('aria-controls');const menu=page.locator('.ant-select-dropdown').filter({has:page.locator(`[id="${listId}"]`)});const option=menu.getByText(text,{exact:true});if(!await option.count()){await menu.hover();await page.mouse.wheel(0,-500);await option.waitFor({state:'visible'});}await option.click();await menu.waitFor({state:'hidden'});};
  const chooseTable=async(text)=>selectOption('当前表格',text);
  const chooseParent=async(text)=>{const input=page.getByRole('combobox',{name:'所属区域',exact:true});await input.locator('..').click();const listId=await input.getAttribute('aria-controls');const menu=page.locator('.ant-select-dropdown').filter({has:page.locator(`[id="${listId}"]`)});await menu.getByText(text,{exact:false}).click();await menu.waitFor({state:'hidden'});};
  const save=async(name)=>{
    const promise=page.waitForEvent('download');await page.getByRole('button',{name:'↓ 下载草稿',exact:true}).click();
    const download=await promise;await download.saveAs(`${output}/${name}.json`);
    await page.getByText('已发起本地草稿下载',{exact:true}).waitFor();
    const digest=(await page.locator('.ant-drawer-open dt').filter({hasText:'SHA-256'}).locator('..').locator('dd').innerText()).trim();
    const count=(await page.locator('.ant-drawer-open dt').filter({hasText:'字节数'}).locator('..').locator('dd').innerText()).trim();
    downloads.push({name,digest,byteLength:Number(count),suggestedFilename:download.suggestedFilename()});
    await closeDrawer();await page.getByText('✓ 实际当前内容已下载',{exact:true}).waitFor();
  };
  try {
    await page.setViewportSize({width:1699,height:828});await page.goto(origin+'/workbench/',{waitUntil:'networkidle'});await waitReady();
    const viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert(viewport.width===1699&&viewport.height===828&&viewport.scale===1&&!viewport.overflow,'Desktop viewport or horizontal overflow mismatch');
    await page.getByLabel('导入文件',{exact:true}).setInputFiles(fixture);
    await page.getByRole('button',{name:'放弃未下载内容并继续',exact:true}).waitFor();await page.getByRole('button',{name:'放弃未下载内容并继续',exact:true}).click();
    await page.getByRole('button',{name:'虚构测试：判断分支与并行阅读',exact:true}).waitFor();await waitReady();
    await page.screenshot({path:`${output}/flow.png`,scale:'css'});check('Edge100% 1699×828 candidate import and flow default');
    await save('baseline');check('Actual local download and current content baseline');
    await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click();
    await page.getByRole('button',{name:'测试起点：提交资料',exact:true}).click();
    assert(await detail().getByRole('button',{name:'编辑本对象',exact:true}).count()===1,'Single edit entry missing');
    assert(await detail().getByRole('textbox').count()===0,'First detail must be a summary');
    const width=await detail().evaluate(element=>element.getBoundingClientRect().width);assert(width===420,'Detail must be 420px');
    await page.waitForTimeout(250);await page.screenshot({path:`${output}/summary-420.png`,scale:'css'});check('Object first summary and one 420px detail');
    await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();
    const actionInput=detail().getByRole('textbox',{name:'具体动作说明',exact:true});
    await actionInput.fill('真实Edge候选验证：本对象修改');await actionInput.focus();
    await actionInput.evaluate(element=>{window.__workbenchInput=element;element.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));element.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',keyCode:229,isComposing:true,bubbles:true}));element.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
    assert(await actionInput.evaluate(element=>element===window.__workbenchInput&&document.activeElement===element),'IME event must preserve input identity and focus');
    await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click();await page.getByRole('dialog',{name:'先处理当前修改'}).waitFor();
    await page.getByRole('button',{name:'继续编辑',exact:true}).click();
    assert(await page.getByRole('radio',{name:'对象清单',exact:true}).isChecked(),'Canceled navigation changed view');assert(await actionInput.inputValue()==='真实Edge候选验证：本对象修改','Canceled navigation lost input');
    await page.screenshot({path:`${output}/object-edit.png`,scale:'css'});
    await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await waitReady();
    await page.getByRole('button',{name:'测试分支甲：核对金额',exact:true}).click();assert(await detail().getByRole('button',{name:'退出编辑',exact:true}).count()===1,'Explicit edit mode did not persist');
    await detail().getByRole('button',{name:'退出编辑',exact:true}).click();check('IME event identity, cancel navigation, explicit apply and persistent edit mode');
    await page.getByRole('button',{name:'虚构测试术语',exact:true}).click();await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();await detail().getByRole('textbox',{name:'术语定义',exact:true}).fill('真实Edge候选验证：术语定义');await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await waitReady();await detail().getByRole('button',{name:'退出编辑',exact:true}).click();
    await page.getByRole('radio',{name:'字段与区域',exact:true}).locator('..').click();await page.getByRole('button',{name:'测试基本区',exact:true}).click();await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();await detail().getByRole('textbox',{name:'区域名称',exact:true}).fill('真实Edge候选验证：表单区域');await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await waitReady();await detail().getByRole('button',{name:'退出编辑',exact:true}).click();
    await page.locator('.process-title').click();await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();await detail().getByRole('textbox',{name:'目的',exact:true}).fill('真实Edge候选验证：流程目的');await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await waitReady();await detail().getByRole('button',{name:'退出编辑',exact:true}).click();
    await save('objects');check('Process, term and form-area unified editing');
    await page.getByRole('radio',{name:'批量表格',exact:true}).locator('..').click();await chooseTable('数据对象');
    const dataCell=page.locator('#cell-data_objects-data_fixture_application-data_name');await dataCell.fill('跨表候选验证：资料');
    await page.getByRole('button',{name:'查看记录 data_fixture_application',exact:true}).click();assert(await detail().getByRole('textbox',{name:'数据对象名称',exact:true}).inputValue()==='跨表候选验证：资料','Grid detail does not use same draft');
    await detail().getByRole('textbox',{name:'说明',exact:true}).fill('详情与表格共用副本');assert(await page.locator('#cell-data_objects-data_fixture_application-description').inputValue()==='详情与表格共用副本','Detail edit not reflected in grid');
    await chooseTable('表单／记录');await page.locator('#cell-forms-graph_form-form_name').fill('跨表候选验证：表单');
    assert(await detail().getByRole('textbox',{name:'数据对象名称',exact:true}).inputValue()==='跨表候选验证：资料','Table switch lost selected mapped detail');
    await page.getByRole('button',{name:'收起详情',exact:true}).click();await chooseTable('对象字段');
    assert(await page.getByText(/先选择数据对象/).count()===1,'Empty parent must be explicit');assert(await page.getByRole('button',{name:'＋ 新增对象字段',exact:true}).isDisabled(),'Missing parent addition enabled');
    await chooseParent('跨表候选验证：资料');await page.locator('#cell-data_fields-graph_field-').count();
    const tables=[['数据与环节关系','跨表候选验证：资料'],['数据来源','跨表候选验证：资料'],['表单与环节关系','跨表候选验证：表单'],['表单区域','跨表候选验证：表单'],['表单字段','真实Edge候选验证：表单区域'],['字段取值来源','显示金额']];
    for(const [table,parent] of tables){await chooseTable(table);await chooseParent(parent);assert(await page.locator('.editable-grid').count()===1,`Multiple grids at ${table}`);}
    await chooseTable('数据对象');assert(await dataCell.inputValue()==='跨表候选验证：资料','Cross-table draft lost');
    await page.getByRole('button',{name:'查看记录 data_fixture_application',exact:true}).click();await page.screenshot({path:`${output}/grid-shared-detail.png`,scale:'css'});check('All nine tables, explicit parents, cross-table shared detail and close retention');
    await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert(await page.getByRole('radio',{name:'批量表格',exact:true}).isChecked(),'Canceled grid leave changed view');
    await page.getByRole('button',{name:'应用全部表格修改',exact:true}).click();await waitReady();await save('grid');
    await page.getByRole('button',{name:'文件 ▾',exact:true}).click();await page.getByRole('menuitem',{name:'撤销与重做',exact:true}).click();await page.getByRole('button',{name:'撤销上次应用',exact:true}).click();await closeDrawer();await save('undo-grid');check('Whole draft one commit and one undo');
    await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click();await page.getByRole('button',{name:'＋ 新增环节',exact:true}).click();await detail().getByRole('textbox',{name:'环节名称',exact:true}).fill('真实Edge新增再删除');await detail().getByRole('button',{name:'应用本对象修改',exact:true}).click();await waitReady();
    await detail().getByRole('button',{name:'更多 ▾',exact:true}).click();await page.getByRole('menuitem',{name:'删除环节',exact:true}).click();await page.getByRole('button',{name:'确认删除',exact:true}).click();await waitReady();check('New object usable edit/apply and confirmed safe delete');
    await page.getByRole('button',{name:/检\s*查/}).click();await page.getByText('结构检查不表示业务审核',{exact:true}).waitFor();await page.screenshot({path:`${output}/check.png`,scale:'css'});await closeDrawer();
    await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click();await page.getByRole('button',{name:'虚构测试：判断分支与并行阅读',exact:true}).last().click();if(await detail().getByRole('button',{name:'编辑本对象',exact:true}).count())await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();await detail().getByRole('textbox',{name:'目的',exact:true}).fill('未应用输入必须保留');
    await page.getByRole('button',{name:'↓ 下载草稿',exact:true}).click();await page.getByRole('button',{name:'继续编辑',exact:true}).click();assert(await detail().getByRole('textbox',{name:'目的',exact:true}).inputValue()==='未应用输入必须保留','Download cancellation lost input');
    await detail().getByRole('button',{name:'取消修改',exact:true}).click();await detail().getByRole('button',{name:'退出编辑',exact:true}).click();await save('final');check('Independent check, download cancellation and final baseline');
    await page.getByLabel('导入文件',{exact:true}).setInputFiles(`${output}/final.json`);await waitReady();await page.getByRole('button',{name:'虚构测试：判断分支与并行阅读',exact:true}).waitFor();await save('roundtrip');check('Actual downloaded V8 re-import and re-download');
    await page.getByRole('button',{name:'帮助与预览',exact:true}).click();await page.getByRole('button',{name:'术语使用关系',exact:false}).click();await page.getByRole('dialog',{name:'术语使用关系 · 预览'}).waitFor();await page.getByRole('button',{name:/^了\s*解$/}).click();await page.getByRole('dialog',{name:'术语使用关系 · 预览'}).waitFor({state:'hidden'});await page.screenshot({path:`${output}/warm-help.png`,scale:'css'});await closeDrawer();check('Central preview boundary and warm popup theme');
    await page.getByRole('radio',{name:'对象清单',exact:true}).locator('..').click();await page.getByRole('radio',{name:'字段与区域',exact:true}).locator('..').click();await page.getByRole('button',{name:'真实Edge候选验证：表单区域',exact:true}).click();await page.getByRole('button',{name:'引用已有对象字段',exact:true}).click();
    const reuseDialog=page.getByRole('dialog',{name:'引用已有对象字段',exact:true});await reuseDialog.getByRole('combobox',{name:'引用对象字段',exact:true}).click();await page.locator('.ant-select-dropdown:visible').getByText(/金额.*graph_field_amount/).click();await reuseDialog.getByRole('combobox',{name:'引用对象字段',exact:true}).press('Escape');assert(await reuseDialog.getByRole('button',{name:'建立所选引用',exact:true}).isDisabled(),'Required flag must not be defaulted');await reuseDialog.getByRole('combobox',{name:'必填性 graph_field_amount',exact:true}).locator('..').click();await page.locator('.ant-select-dropdown:visible').getByText('非必填',{exact:true}).click();assert(await reuseDialog.getByRole('button',{name:'建立所选引用',exact:true}).isEnabled(),'Explicit required flag must enable submission');await reuseDialog.getByRole('combobox',{name:'必填性 graph_field_amount',exact:true}).press('Escape');await page.waitForTimeout(250);await page.screenshot({path:`${output}/reuse-picker.png`,scale:'css'});await reuseDialog.getByRole('button',{name:'取消选择',exact:true}).click();await reuseDialog.waitFor({state:'hidden'});assert(await page.getByText('✓ 实际当前内容已下载',{exact:true}).count()===1,'Canceling picker changed downloaded document baseline');check('Unified field reuse picker requires explicit required flag and preserves download on cancel');
    await page.getByRole('radio',{name:'流程图',exact:true}).locator('..').click();await page.locator('.process-title').click();await detail().getByRole('button',{name:'编辑本对象',exact:true}).click();
    const pendingPurpose=detail().getByRole('textbox',{name:'目的',exact:true});await pendingPurpose.fill('导入失败后仍保留的输入');
    await page.getByLabel('导入文件',{exact:true}).setInputFiles({name:'invalid-fictional.json',mimeType:'application/json',buffer:Buffer.from('{invalid fictional json')});
    await page.getByRole('button',{name:'放弃并继续',exact:true}).click();await page.getByText('文件不是有效 JSON，当前内容和输入均保留',{exact:true}).waitFor();await page.waitForTimeout(500);
    assert(await page.getByText('文件不是有效 JSON，当前内容和输入均保留',{exact:true}).isVisible(),'Canvas viewport feedback cleared the failed import diagnosis');assert(await pendingPurpose.inputValue()==='导入失败后仍保留的输入','Failed import lost visible input');assert(await page.getByRole('radio',{name:'流程图',exact:true}).isChecked(),'Failed import changed the main view');
    await page.screenshot({path:`${output}/failed-import-retained.png`,scale:'css'});await detail().getByRole('button',{name:'取消修改',exact:true}).click();await detail().getByRole('button',{name:'退出编辑',exact:true}).click();check('Failed import retains diagnosis through viewport feedback and preserves visible inputs');
    const environment=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight,scale:visualViewport.scale},overflow:document.documentElement.scrollWidth>innerWidth,storage:window.__workbenchStorageWrites||[],local:localStorage.length,session:sessionStorage.length,legacyPage:typeof window.currentDocument,domainScripts:[...document.scripts].map(s=>s.getAttribute('src')).filter(Boolean),inputBg:getComputedStyle(document.querySelector('.ant-btn-default')).backgroundColor}));
    assert(!environment.overflow&&!environment.storage.length&&!environment.local&&!environment.session,'Storage or horizontal overflow detected');assert(environment.legacyPage==='undefined','Legacy page DOM controller loaded');assert(!remote.length,'Unexpected external requests');assert(!errors.length,`Browser errors: ${errors.join('; ')}`);check('No legacy page controller, persistent storage, external traffic, console error or page overflow');
    return {passed:true,browser:'Microsoft Edge',checks,downloads,environment,errors,remote};
  } catch(error) {await page.screenshot({path:`${output}/failure.png`,scale:'css'});return {passed:false,error:error.message,checks,downloads,errors,remote,actions,comboboxes:await page.getByRole('combobox').evaluateAll(elements=>elements.map(element=>({label:element.getAttribute('aria-label'),expanded:element.getAttribute('aria-expanded'),html:element.parentElement.outerHTML.slice(0,1000)})))};}
}
