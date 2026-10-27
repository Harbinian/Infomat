// P21 publication import and history: synthetic files/actors, owned tmpfs MySQL,
// random loopback HTTP and Edge. Input --output is a new artifacts directory.
// No private env, existing DB, production service or notifications are used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {withStage05Fixture}=require('./test-stage05-mysql-isolated');
const {managePublicationSchema}=require('../server/publicationSchema');
function runtime(){try{return require('playwright');}catch{return require(path.join(process.env.APPDATA,'npm/node_modules/@playwright/cli/node_modules/playwright'));}}
const arg=process.argv.indexOf('--output');assert.ok(arg>=0&&process.argv[arg+1]);const output=path.resolve(process.argv[arg+1]);
assert.ok(output.startsWith(path.resolve(__dirname,'../../../artifacts')+path.sep));assert.ok(!fs.existsSync(output));fs.mkdirSync(output,{recursive:true});
async function main(){await withStage05Fixture(async({fixture,pool,expect,request})=>{
  await managePublicationSchema(pool,'apply');
  const browser=await runtime().chromium.launch({channel:'msedge',headless:true});
  const context=await browser.newContext({viewport:{width:1699,height:828},deviceScaleFactor:1});
  const page=await context.newPage();page.setDefaultTimeout(15000);
  const checks=[],pageErrors=[],consoleErrors=[],downloads=[];
  page.on('pageerror',e=>pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.on('download',download=>downloads.push(download));
  const button=name=>page.getByRole('button',{name,exact:true});
  const ready=()=>page.locator('[data-publication-catalog]').waitFor();
  const detail=()=>page.locator('[data-publication-detail]').waitFor();
  async function login(who){await page.locator('#login-name').fill('SYNTHETIC_'+who);await page.locator('#login-password').fill(fixture.loginPassword);await button('登录').click();await button('退出登录').waitFor();}
  async function switchUser(who){await button('退出登录').click();await login(who);await ready();}
  const file=content=>page.getByLabel('选择目录文件').setInputFiles({name:'synthetic-master.csv',mimeType:'text/csv',buffer:Buffer.from('\ufeff'+content)});
  async function read(){await button('读取文件').click();await page.getByRole('heading',{name:'确认列对应关系',exact:true}).waitFor();}
  async function preview(){await button('核对导入内容').click();await page.locator('[data-directory-checked]').waitFor();}
  async function publish(){await page.getByLabel('我已核对文件、列对应关系和变更结果，确认发布此版本。').check();await button('发布此主数据版本').click();await page.locator('[data-directory-import]').waitFor({state:'detached'});await ready();}
  async function cancel(){page.once('dialog',d=>d.accept());await button('取消目录导入').click();}
  async function capture(name){assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>visualViewport.scale),1);await page.screenshot({path:path.join(output,name+'.png'),fullPage:true});}
  async function failedDownload(name,endpoint,status){
    const before=downloads.length,response=page.waitForResponse(r=>new URL(r.url()).pathname+new URL(r.url()).search===endpoint);
    await button(name).click();assert.equal((await response).status(),status);await page.getByText('下载未完成',{exact:true}).waitFor();
    assert.match(await page.getByRole('alert').textContent(),/未生成下载文件/);assert.equal(downloads.length,before);
  }
  try{
    assert.equal((await fetch(fixture.baseURL+'/app/publications')).status,200);
    await page.goto(fixture.baseURL+'/app/publications');await login('lead');await ready();
    const spreadsheet=require('../server/publicationSpreadsheet');
    for(const [kind,label]of [['organization','组织架构'],['roster','花名册'],['master_data','主数据']]){
      await page.getByLabel('发布类型').selectOption(kind);await ready();
      let responseBytes;
      await page.route('**/api/publications/template?kind='+kind,async route=>{
        const response=await route.fetch();responseBytes=await response.body();await route.fulfill({response,body:responseBytes});
      },{times:1});
      const received=page.waitForResponse(r=>r.url().endsWith('/api/publications/template?kind='+kind)),saved=page.waitForEvent('download');
      await button('下载'+label+'空白模板').click();const response=await received,download=await saved;
      assert.equal(response.status(),200);assert.equal(download.suggestedFilename(),kind+'-template.xlsx');
      const target=path.join(output,download.suggestedFilename());await download.saveAs(target);
      assert.deepEqual(fs.readFileSync(target),responseBytes,'saved template retains the exact response bytes');
      const book=new(require('exceljs').Workbook)();await book.xlsx.load(fs.readFileSync(target));
      assert.deepEqual(book.worksheets[0].getRow(1).values.slice(1),kind==='master_data'?['唯一标识','名称']:spreadsheet.FIELDS[kind].map(f=>f.label));
      assert.equal(book.worksheets[0].rowCount,1);
    }
    checks.push('three empty XLSX templates retain filenames, headers and exact response bytes');
    let releaseTemplate,enteredTemplate,finishedTemplate;
    const heldTemplate=new Promise(r=>releaseTemplate=r),arrivedTemplate=new Promise(r=>enteredTemplate=r),settledTemplate=new Promise(r=>finishedTemplate=r);
    await page.route('**/api/publications/template?kind=master_data',async route=>{
      const response=await route.fetch();enteredTemplate();await heldTemplate;await route.fulfill({response}).catch(()=>{});finishedTemplate();
    },{times:1});
    const beforeCancelled=downloads.length;await button('下载主数据空白模板').click();await arrivedTemplate;
    assert.equal(await button('下载主数据空白模板').isDisabled(),true);await button('取消下载').click();releaseTemplate();await settledTemplate;
    assert.equal(downloads.length,beforeCancelled);await page.getByText('已取消本次下载。当前导入输入保持不变。',{exact:true}).waitFor();
    checks.push('pending download disables repeats; cancellation suppresses a late successful response');
    let releaseSwitched,enteredSwitched,finishedSwitched;
    const heldSwitched=new Promise(r=>releaseSwitched=r),arrivedSwitched=new Promise(r=>enteredSwitched=r),settledSwitched=new Promise(r=>finishedSwitched=r);
    await page.route('**/api/publications/template?kind=master_data',async route=>{
      const response=await route.fetch();enteredSwitched();await heldSwitched;await route.fulfill({response}).catch(()=>{});finishedSwitched();
    },{times:1});
    const beforeSwitched=downloads.length;await button('下载主数据空白模板').click();await arrivedSwitched;
    await page.getByLabel('发布类型').selectOption('organization');await ready();releaseSwitched();await settledSwitched;
    assert.equal(downloads.length,beforeSwitched);assert.equal(await page.getByText('正在准备下载…',{exact:true}).count(),0);
    await page.getByLabel('发布类型').selectOption('master_data');await ready();
    checks.push('switching publication kind suppresses the previous template response and download state');
    await button('手工导入主数据').click();await file('编码,名称,补充说明\n001,合成长名称,保留原值\n002,合成旧项,旧值\n');await read();
    await page.getByLabel('唯一标识列（必填）').selectOption('编码');await preview();await capture('import-desktop');
    await pool.execute("UPDATE person_roles SET assignment_status='revoked' WHERE person_id=82");
    try{await failedDownload('下载主数据空白模板','/api/publications/template?kind=master_data',403);}
    finally{await pool.execute("UPDATE person_roles SET assignment_status='active' WHERE person_id=82");}
    assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');assert.equal(await page.locator('[data-directory-checked]').count(),1);
    assert.match(await page.locator('[data-directory-import]').textContent(),/synthetic-master.csv/);await capture('template-denied-desktop');
    await page.route('**/api/publications/template?kind=master_data',route=>route.fulfill({status:200,json:{error:'synthetic invalid file'}}),{times:1});
    await failedDownload('下载主数据空白模板','/api/publications/template?kind=master_data',200);
    await page.route('**/api/publications/template?kind=master_data',route=>route.fulfill({status:503,json:{}}),{times:1});
    await failedDownload('下载主数据空白模板','/api/publications/template?kind=master_data',503);
    const beforeOffline=downloads.length;await context.setOffline(true);await button('下载主数据空白模板').click();await page.getByText('下载未完成',{exact:true}).waitFor();await button('取消下载').waitFor({state:'detached'});await context.setOffline(false);
    assert.equal(downloads.length,beforeOffline);assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');
    checks.push('actual permission loss returns 403 with no file; 200 JSON and 503 cannot become XLSX; file/mapping/review inputs retained');
    await page.setViewportSize({width:1699,height:828});
    page.once('dialog',d=>d.dismiss());await page.getByLabel('发布类型').selectOption('organization');assert.equal(await page.getByLabel('发布类型').inputValue(),'master_data');assert.equal(await page.locator('[data-directory-checked]').count(),1);
    await button('刷新发布记录').click();await ready();assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');
    await publish();let records=await expect('lead','/api/publications?kind=master_data','GET');assert.equal(records.rows.length,1);const first=await expect('lead','/api/publications/'+records.rows[0].id,'GET');
    assert.equal(first.content.rows[0][0],'001');assert.equal(first.content.rows[0][2],'保留原值');
    await button('查看发布记录 '+first.id).click();await detail();await page.reload();await ready();await detail();assert.ok((await page.locator('[data-publication-detail]').textContent()).includes('保留原值'));
    const downloaded=page.waitForEvent('download');await button('下载完整记录 JSON').click();const download=await downloaded;assert.equal(download.suggestedFilename(),first.title+'-v1.json');await download.saveAs(path.join(output,'synthetic-v1.json'));assert.deepEqual(JSON.parse(fs.readFileSync(path.join(output,'synthetic-v1.json'))).content,first.content);
    const xlsxDownload=page.waitForEvent('download');await button('下载此版本 Excel').click();const versionDownload=await xlsxDownload;assert.equal(versionDownload.suggestedFilename(),first.title+'-v1.xlsx');await versionDownload.saveAs(path.join(output,'synthetic-v1.xlsx'));
    const parsed=await require('../server/publicationSpreadsheet').parseSpreadsheet(fs.readFileSync(path.join(output,'synthetic-v1.xlsx')),'synthetic-v1.xlsx');assert.deepEqual(parsed.rows,first.content.rows);
    checks.push('real CSV parse/preview/publish; literal identifiers and extra columns preserved; JSON/XLSX downloads and deep-link reload');
    for(const [name,suffix]of [['下载此版本 Excel',''],['下载完整记录 JSON','?format=json']]){
      const endpoint='/api/publications/'+first.id+'/download'+suffix;
      await page.route('**'+endpoint,route=>route.fulfill({status:403,json:{code:'PUBLICATION_ACCESS_DENIED'}}),{times:1});
      await failedDownload(name,endpoint,403);
    }
    checks.push('historical Excel and JSON downloads show 403 without saving error files');
    await button('导入新版 '+first.id).click();await file('编码,名称,补充说明\n001,合成更新,更新值\n003,合成新增,新增值\n');await read();assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');await preview();
    const checkedText=await page.locator('[data-directory-checked]').textContent();assert.match(checkedText,/新版移除 1 行/);await publish();
    records=await expect('lead','/api/publications?kind=master_data','GET');const second=await expect('lead','/api/publications/'+records.rows[0].id,'GET');assert.equal(second.version_no,2);assert.equal(second.dataset_key,first.dataset_key);assert.equal(second.previous_publication_id,first.id);assert.deepEqual((await expect('lead','/api/publications/'+first.id,'GET')).content,first.content);
    await button('查看发布记录 '+first.id).click();await detail();await button('查看发布记录 '+second.id).click();await detail();await page.goBack();await detail();assert.ok(page.url().includes('id='+first.id));await page.goForward();await detail();assert.ok(page.url().includes('id='+second.id));
    await capture('history-desktop');await page.setViewportSize({width:1699,height:828});
    checks.push('same dataset new version; additions/updates/removals; immutable original; selected-version back/forward');
    await button('导入新版 '+second.id).click();await file('编码,名称\n001,合成第三版\n');await read();await preview();
    const repo=require('../server/publicationRepository').makePublicationRepository(pool);
    const concurrent=require('../server/publicationSpreadsheet').normalizePublication({...second.content,sourceRows:[2],rows:[['001','并发版本','合成并发值']]});
    const concurrentChecked=await repo.preview(concurrent,second.dataset_key);
    await repo.publish({...concurrentChecked,content:concurrent.content,datasetKey:second.dataset_key,requestId:require('node:crypto').randomUUID()},{personId:82,accountId:182,authVersion:1});
    await page.getByLabel('我已核对文件、列对应关系和变更结果，确认发布此版本。').check();await button('发布此主数据版本').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();assert.equal(await page.locator('[data-directory-checked]').count(),0);assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');
    await preview();
    let writes=0;await page.route('**/api/publications/publish',async route=>{writes++;await route.fetch();await route.fulfill({status:503,json:{}});},{times:1});
    await page.getByLabel('我已核对文件、列对应关系和变更结果，确认发布此版本。').check();await button('发布此主数据版本').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();await publish();records=await expect('lead','/api/publications?kind=master_data','GET');assert.equal(records.rows.length,4);assert.equal(writes,1);
    checks.push('real stale baseline returns 409 and retains file/key; committed response lost then idempotent retry creates one version');
    await button('手工导入主数据').click();await file('编码,名称\na,合成一\n A ,合成重复\n');await read();await page.getByLabel('唯一标识列（必填）').selectOption('编码');await button('核对导入内容').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();assert.equal(await button('发布此主数据版本').isDisabled(),true);await cancel();
    await switchUser('adminMulti');await button('手工导入主数据').click();await file('编码,名称\nx,只核对\n');await read();await page.getByLabel('唯一标识列（必填）').selectOption('编码');await preview();await page.getByLabel('我已核对文件、列对应关系和变更结果，确认发布此版本。').check();assert.equal(await button('发布此主数据版本').isDisabled(),true);assert.equal((await request('adminMulti','/api/publications/publish','POST',{})).status,403);
    await page.getByLabel('发布名称',{exact:true}).fill('同身份保留发布草稿');await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=88');
    const beforeExpired=downloads.length,expiredResponse=page.waitForResponse(r=>r.url().endsWith('/api/publications/template?kind=master_data'));
    await button('下载主数据空白模板').click();assert.equal((await expiredResponse).status(),401);await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();assert.equal(downloads.length,beforeExpired);
    await login('adminMulti');await ready();assert.equal(await page.getByLabel('发布名称',{exact:true}).inputValue(),'同身份保留发布草稿');assert.equal(await page.getByLabel('唯一标识列（必填）').inputValue(),'编码');assert.match(await page.locator('[data-directory-import]').textContent(),/synthetic-master.csv/);
    checks.push('actual expired session during template download returns 401 with no file; same-identity login restores import input');
    await pool.execute('UPDATE user_accounts SET auth_version=auth_version+1 WHERE person_id=88');await button('刷新发布记录').click();await page.getByRole('heading',{name:'请重新登录',exact:true}).waitFor();await login('contact');await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();assert.equal(await page.locator('[data-directory-import]').count(),0);assert.equal((await request('contact','/api/publications?kind=master_data')).status,403);
    assert.equal(await button('下载主数据空白模板').count(),0);
    checks.push('duplicate keys rejected; admin business read-only; actual unauthorized access; same-identity recovery and cross-identity clearing');
    await switchUser('lead');
    let release,entered;const held=new Promise(r=>release=r),arrived=new Promise(r=>entered=r);
    await page.route('**/api/publications/'+first.id,async route=>{entered();await held;await route.fulfill({json:{...first,title:'STALE_FORBIDDEN'}}).catch(()=>{});},{times:1});
    await button('查看发布记录 '+first.id).click();await arrived;await button('查看发布记录 '+second.id).click();await detail();release();await page.waitForTimeout(150);assert.ok(!(await page.locator('[data-publication-detail]').textContent()).includes('STALE_FORBIDDEN'));
    const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();for(const name of ['合成一','合成二']){const sheet=book.addWorksheet(name);sheet.addRow(['编码','名称']);sheet.addRow(['X',name]);}
    await button('手工导入主数据').click();assert.equal(await page.getByLabel('发布名称',{exact:true}).evaluate(el=>el===document.activeElement),true);
    await page.getByLabel('选择目录文件').setInputFiles({name:'synthetic-sheets.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:Buffer.from(await book.xlsx.writeBuffer())});await read();await page.getByLabel('唯一标识列（必填）').selectOption('编码');await preview();
    page.once('dialog',d=>d.dismiss());await page.getByLabel('工作表',{exact:true}).selectOption('合成二');assert.equal(await page.getByLabel('工作表',{exact:true}).inputValue(),'合成一');
    page.once('dialog',d=>d.accept());await page.getByLabel('工作表',{exact:true}).selectOption('合成二');assert.equal(await page.locator('[data-directory-checked]').count(),0);await read();assert.equal(await page.getByLabel('工作表',{exact:true}).inputValue(),'合成二');
    await preview();page.once('dialog',d=>d.dismiss());await file('编码,名称\nx,替换文件\n');assert.equal(await page.locator('[data-directory-checked]').count(),1);assert.match(await page.locator('[data-directory-import]').textContent(),/synthetic-sheets.xlsx/);
    assert.equal(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented;}),true);
    const current=page.url();page.once('dialog',d=>d.dismiss());await page.evaluate(()=>history.back());await page.waitForTimeout(250);assert.equal(page.url(),current);assert.equal(await page.locator('[data-directory-import]').count(),1);
    await page.getByLabel('发布名称',{exact:true}).fill('未提交的合成长名称'.repeat(12));await capture('long-form-desktop');await page.setViewportSize({width:1699,height:828});
    await page.getByLabel('发布名称',{exact:true}).fill('合成待发布表');await preview();await page.getByLabel('我已核对文件、列对应关系和变更结果，确认发布此版本。').check();
    await page.route('**/api/publications/publish',route=>route.fulfill({status:403,json:{}}),{times:1});await button('发布此主数据版本').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();assert.equal(await page.getByLabel('发布名称',{exact:true}).inputValue(),'合成待发布表');await cancel();
    checks.push('late detail ignored; multi-sheet XLSX switching/file replacement confirmation; focus, cancelled back, unload protection, long text and failed-write retention');
    for(const status of [403,409,503]){await page.route('**/api/publications?kind=master_data',route=>route.fulfill({status,json:{}}),{times:1});await button('刷新发布记录').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();assert.equal(await page.locator('[data-publication-catalog]').count(),0);assert.equal(await page.locator('[data-publication-detail]').count(),0);await button('刷新发布记录').click();await ready();}
    await context.setOffline(true);await button('刷新发布记录').click();await page.getByText('目录导入或读取未完成',{exact:true}).waitFor();await context.setOffline(false);await button('刷新发布记录').click();await ready();
    await page.getByLabel('发布类型').selectOption('organization');await ready();await page.reload();await ready();assert.equal(await page.getByLabel('发布类型').inputValue(),'organization');await page.getByLabel('发布类型').selectOption('roster');await ready();await page.getByText('还没有花名册发布版本',{exact:true}).waitFor();
    assert.equal(await page.locator('a[href*="/#/"]').count(),0);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
    checks.push('injected error/offline/empty feedback, no stale details, cross-kind filter reload and retained old entry');
    const unexpectedConsole=consoleErrors.filter(v=>!/Failed to load resource|net::ERR_|server responded with a status of (401|403|409|422|503)/.test(v));assert.deepEqual(pageErrors,[]);assert.deepEqual(unexpectedConsole,[]);
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,pageErrors,unexpectedConsole,expectedConsole:consoleErrors},null,2));console.log('P21_PUBLICATIONS_BROWSER_PASS',checks.length);
  }catch(e){fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({message:e.message,checks,pageErrors},null,2));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true}).catch(()=>{});throw e;}
  finally{
    // Edge can disconnect before acknowledging download cleanup. Bound this wait
    // so the owned HTTP server and temporary MySQL still reach their cleanup.
    let timer;
    try{await Promise.race([browser.close(),new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{
        if(browser.isConnected())return reject(new Error('Owned Edge did not disconnect within the cleanup deadline'));
        fs.writeFileSync(path.join(output,'browser-cleanup.json'),JSON.stringify({disconnected:true,closeAcknowledgementTimedOut:true},null,2));resolve();
      },10000);
    })]);}finally{clearTimeout(timer);}
  }
},{evidenceDir:output,randomDatabase:true});}
// main resolves only after the owned HTTP/MySQL cleanup. Do not retain a
// disconnected Edge transport's pending acknowledgement in this test process.
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
